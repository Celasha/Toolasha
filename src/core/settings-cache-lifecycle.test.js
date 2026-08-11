/**
 * Regression coverage for config-cache ownership during character switches.
 *
 * Background: settings-ui.js registers its own `character_initialized` listener
 * (settings-ui.js initialize(), ~line 63-69) that calls cleanupDOM(), which used to call
 * config.clearSettingsCache() (settings-ui.js cleanupDOM(), previously ~line 134-135).
 * That mutation of config.settingsMap happened completely independently of the
 * authoritative character-switch lifecycle owned by feature-registry.js, which:
 *   - clears the cache synchronously on `character_switching` (feature-registry.js:213-221)
 *   - reloads it via `await config.loadSettings({notifyChanges:false})` on `character_switched`
 *     (feature-registry.js:242-288)
 *
 * dataManager.emit() (data-manager.js:1079-1118) only treats `character_switching` as
 * synchronous/critical. Both `character_switched` and `character_initialized` are deferred via
 * `setTimeout(fn, 0)`, scheduled back-to-back within the same synchronous `init_character_data`
 * handling block (data-manager.js:207-282) — `character_switched` first, `character_initialized`
 * second.
 *
 * These tests drive the REAL config.js and data-manager.js modules (only their leaf
 * dependencies — settings-storage.js, websocket.js, storage.js — are mocked) to prove:
 *
 *   1. With today's real storage backend (an IndexedDB request, which completes via a genuine
 *      task/macrotask — storage.js get(): a `db.transaction(...).objectStore(...).get(key)`
 *      request whose `onsuccess` fires as a task, not a microtask), the already-queued
 *      `character_initialized` macrotask runs BEFORE that task fires. A clearSettingsCache()
 *      call from a `character_initialized` listener therefore lands on a still-empty map and is
 *      a harmless no-op; the subsequent reload still repopulates it correctly.
 *
 *   2. If settingsStorage.loadSettings() ever resolves via microtasks only — which is a real,
 *      reachable code path today: storage.js's `get()` returns its default synchronously
 *      (resolving the wrapping async function via microtasks, with no task/macrotask boundary)
 *      whenever `this.db` is falsy (storage.js:182-185), and `this.db` is nulled out at runtime
 *      by the `onclose`/`onversionchange` handlers (storage.js:551-562, e.g. another tab
 *      upgrading/dropping the shared IndexedDB connection) — then the reload can finish
 *      *before* the already-queued `character_initialized` macrotask runs. A
 *      clearSettingsCache() call from that listener then wipes the freshly reloaded
 *      settingsMap back to `{}` with nothing left to repair it, since that listener owns no
 *      reload of its own.
 *
 * This demonstrates that the correctness of having two independent, unsynchronized owners of
 * the settings cache was never guaranteed by the architecture — only incidentally true because
 * of today's storage backend's async characteristics. The fix removes the second owner
 * (settings-ui.js's clearSettingsCache() call) so feature-registry.js is the sole owner of the
 * character-switch cache lifecycle.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const settingsStorageMocks = vi.hoisted(() => ({
    loadSettings: vi.fn(),
}));

vi.mock('./settings-storage.js', () => ({
    default: {
        setCharacterId: vi.fn(),
        loadSettings: settingsStorageMocks.loadSettings,
        buildDefaults: vi.fn(() => ({})),
    },
}));

vi.mock('./settings-schema.js', () => ({ settingsGroups: {} }));

vi.mock('./websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn(), onSocketEvent: vi.fn(), offSocketEvent: vi.fn() },
}));

vi.mock('./storage.js', () => ({ default: {} }));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Settings cache lifecycle ownership during character switch', () => {
    test('today: a macrotask-resolving reload (real IndexedDB shape) makes an extra character_initialized clear a harmless no-op', async () => {
        const { default: config } = await import('./config.js');
        const { default: dataManager } = await import('./data-manager.js');
        vi.spyOn(dataManager, 'getCurrentCharacterId').mockReturnValue('char-b');
        vi.spyOn(dataManager, 'getCurrentCharacterName').mockReturnValue('CharB');

        // Simulate storage.js's real get() path: an IndexedDB request whose completion is a
        // genuine task, not a microtask (storage.js:187-205).
        settingsStorageMocks.loadSettings.mockImplementation(
            () => new Promise((resolveLoad) => setTimeout(() => resolveLoad({ myFlag: { isTrue: true } }), 0))
        );

        // feature-registry.js:213-221 (character_switching phase — authoritative clear)
        config.clearSettingsCache();
        expect(config.settingsMap).toEqual({});

        // feature-registry.js:242-288 (character_switched phase — authoritative reload)
        dataManager.on('character_switched', () => {
            config.loadSettings({ notifyChanges: false });
        });
        // Reproduces the second, unsynchronized owner this investigation is about:
        // settings-ui.js's character_initialized listener calling clearSettingsCache() with no
        // reload of its own.
        dataManager.on('character_initialized', () => {
            config.clearSettingsCache();
        });

        dataManager.emit('character_switched', { newId: 'char-b' });
        dataManager.emit('character_initialized', { newId: 'char-b' });

        // Drain both deferred emit() macrotasks and the mocked storage round trip.
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));

        expect(config.settingsMap).toEqual({ myFlag: { isTrue: true } });
    });

    test('DEFECT (unsynchronized clear): a microtask-only reload (storage.js !this.db fallback shape) lets an extra character_initialized clear permanently wipe the freshly reloaded cache', async () => {
        const { default: config } = await import('./config.js');
        const { default: dataManager } = await import('./data-manager.js');
        vi.spyOn(dataManager, 'getCurrentCharacterId').mockReturnValue('char-b');
        vi.spyOn(dataManager, 'getCurrentCharacterName').mockReturnValue('CharB');

        // Simulate storage.js's `if (!this.db) return defaultValue;` fallback (storage.js:182-185)
        // — a real, reachable state when the IndexedDB connection has been dropped
        // (storage.js:551-562's onclose/onversionchange handlers null out `this.db` at runtime).
        // This resolves purely through microtasks, with no task/macrotask boundary.
        settingsStorageMocks.loadSettings.mockImplementation(() => Promise.resolve({ myFlag: { isTrue: true } }));

        config.clearSettingsCache();
        expect(config.settingsMap).toEqual({});

        dataManager.on('character_switched', () => {
            config.loadSettings({ notifyChanges: false });
        });
        dataManager.on('character_initialized', () => {
            config.clearSettingsCache();
        });

        dataManager.emit('character_switched', { newId: 'char-b' });
        dataManager.emit('character_initialized', { newId: 'char-b' });

        await new Promise((resolveWait) => setTimeout(resolveWait, 10));

        // This is the defect: the reload already completed (via microtasks) before the
        // already-queued character_initialized macrotask ran, so the second clear wiped the
        // freshly repopulated map with nothing left to restore it.
        expect(config.settingsMap).toEqual({});
    });
});

describe('settings-ui.js does not own a second character-switch cache-clear path', () => {
    test('cleanupDOM()/handleCharacterSwitch() no longer call config.clearSettingsCache()', () => {
        const content = readFileSync(
            resolve(new URL('.', import.meta.url).pathname, '../features/settings/settings-ui.js'),
            'utf8'
        );

        // Strip full-line comments so the explanatory comment documenting the removal (which
        // necessarily mentions the method name) doesn't trip up the "no real call" check below.
        const codeOnly = content
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');

        // feature-registry.js remains the sole owner of the character-switch cache lifecycle.
        expect(codeOnly).not.toContain('config.clearSettingsCache');
    });
});
