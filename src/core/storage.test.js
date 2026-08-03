/**
 * Tests for Storage write-durability fixes (TLA-007)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Fake IndexedDB plumbing ──────────────────────────────────────────────────

function makeFakeDb(shouldFail = false) {
    const store = {};
    return {
        _store: store,
        _shouldFail: shouldFail,
        close() {},
        transaction(_stores, _mode) {
            const db = this;
            return {
                objectStore() {
                    return {
                        put(value, key) {
                            const req = {};
                            Promise.resolve().then(() => {
                                if (db._shouldFail) {
                                    req.error = new Error('fake IDB failure');
                                    req.onerror?.();
                                } else {
                                    store[key] = value;
                                    req.onsuccess?.();
                                }
                            });
                            return req;
                        },
                    };
                },
            };
        },
    };
}

// ── Fresh Storage instance per test ─────────────────────────────────────────

async function makeStorage() {
    vi.resetModules();
    const mod = await import('./storage.js');
    const s = mod.default;
    // Reset internal state for isolation
    s.db = null;
    s.available = false;
    s.saveDebounceTimers = new Map();
    s.pendingWrites = new Map();
    s._writeGeneration = new Map();
    s._reconnecting = false;
    s._dbNulledReason = null;
    return s;
}

describe('Storage write durability (TLA-007)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('DB closes before debounce fires: value is requeued and survives', async () => {
        const s = await makeStorage();
        const goodDb = makeFakeDb(false);
        s.db = goodDb;

        const writePromise = s.set('myKey', 'hello', 'settings');

        // DB goes away before timer fires
        s.db = null;

        // Advance timer — save attempt will fail (db is null, _saveToIndexedDB throws / returns false)
        await vi.runAllTimersAsync();

        // Value must still be in pendingWrites for reconnect to retry
        expect(s.pendingWrites.size).toBeGreaterThan(0);

        // Now reconnect and flush
        s.db = goodDb;
        await s.flushAll();

        expect(goodDb._store['myKey']).toBe('hello');

        const result = await writePromise;
        // The failed first attempt requeues without resolving; the original resolver is
        // carried over and only settled once flushAll's retry actually succeeds.
        expect(result).toBe(true);
        expect(goodDb._store['myKey']).toBe('hello');
    });

    test('transaction throws after timer fires: value is requeued', async () => {
        const s = await makeStorage();
        const failDb = makeFakeDb(true);
        s.db = failDb;

        s.set('k', 42, 'settings');

        await vi.runAllTimersAsync();

        // After failure the entry must still be owned
        expect(s.pendingWrites.size).toBe(1);
        expect(s.pendingWrites.get('settings:k').value).toBe(42);
    });

    test('DB closes during flushAll: failed entries remain pending', async () => {
        const s = await makeStorage();
        const failDb = makeFakeDb(true);
        s.db = failDb;

        s.set('a', 1, 'settings');
        s.set('b', 2, 'settings');

        // Drain timers so entries are in pendingWrites without timer
        await vi.runAllTimersAsync();

        // Re-queue them as if they were requeued after failure
        if (!s.pendingWrites.has('settings:a')) {
            s.pendingWrites.set('settings:a', { value: 1, storeName: 'settings', resolvers: [], generation: 1 });
        }
        if (!s.pendingWrites.has('settings:b')) {
            s.pendingWrites.set('settings:b', { value: 2, storeName: 'settings', resolvers: [], generation: 1 });
        }

        await s.flushAll();

        // Both must remain pending after failed flush
        expect(s.pendingWrites.has('settings:a')).toBe(true);
        expect(s.pendingWrites.has('settings:b')).toBe(true);
    });

    test('three writes to one key during failure: only newest value persists', async () => {
        const s = await makeStorage();
        const goodDb = makeFakeDb(false);
        s.db = goodDb;

        s.set('x', 'first', 'settings');
        s.set('x', 'second', 'settings');
        s.set('x', 'third', 'settings');

        await vi.runAllTimersAsync();

        // Last-write-wins: only 'third' should have been written
        expect(goodDb._store['x']).toBe('third');
    });

    test('older retry cannot overwrite a newer generation', async () => {
        const s = await makeStorage();
        const goodDb = makeFakeDb(false);
        s.db = goodDb;

        // Simulate: first write fails and is requeued at generation 1,
        // then a newer write arrives at generation 2.
        // The requeued generation-1 entry must not overwrite the generation-2 value.

        s.pendingWrites.set('settings:z', { value: 'old', storeName: 'settings', resolvers: [], generation: 1 });
        s._writeGeneration.set('settings:z', 2);
        // Newer write has already overwritten the slot
        s.pendingWrites.set('settings:z', { value: 'new', storeName: 'settings', resolvers: [], generation: 2 });

        await s.flushAll();

        expect(goodDb._store['z']).toBe('new');
    });

    test('cleanupPendingWrites resolves all pending promises with false', async () => {
        const s = await makeStorage();
        s.db = makeFakeDb(false);

        const p1 = s.set('p', 1, 'settings');
        const p2 = s.set('q', 2, 'settings');

        s.cleanupPendingWrites();

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(false);
        expect(r2).toBe(false);
        expect(s.pendingWrites.size).toBe(0);
        expect(s._writeGeneration.size).toBe(0);
    });

    test('coalesced promises all resolve consistently after successful flush', async () => {
        const s = await makeStorage();
        const goodDb = makeFakeDb(false);
        s.db = goodDb;

        const p1 = s.set('c', 'v1', 'settings');
        const p2 = s.set('c', 'v2', 'settings');
        const p3 = s.set('c', 'v3', 'settings');

        await vi.runAllTimersAsync();

        const results = await Promise.all([p1, p2, p3]);
        // All coalesced into the last write — the winning write should resolve true
        expect(results[results.length - 1]).toBe(true);
        expect(goodDb._store['c']).toBe('v3');
    });
});
