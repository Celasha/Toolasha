/**
 * Vitest setup: in-memory localStorage fallback.
 *
 * jsdom 29 only provides localStorage on non-opaque origins, and vitest 4's
 * jsdom environment ends up with `window.localStorage === undefined`, breaking
 * every test that touches Storage (i18n locale persistence, openable
 * analytics). Install a Map-backed Storage only when the environment lacks a
 * usable one; environments that already provide localStorage are untouched.
 */
function createMemoryStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(String(key)) ? store.get(String(key)) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        },
        clear() {
            store.clear();
        },
        key(index) {
            return Array.from(store.keys())[index] ?? null;
        },
        get length() {
            return store.size;
        },
    };
}

function defineStorage(target, storage) {
    Object.defineProperty(target, 'localStorage', { value: storage, configurable: true, writable: true });
}

let needsShim = false;
try {
    needsShim = typeof window !== 'undefined' && typeof window.localStorage === 'undefined';
} catch {
    // Opaque-origin SecurityError also means the native storage is unusable.
    needsShim = true;
}

if (needsShim) {
    const storage = createMemoryStorage();
    defineStorage(window, storage);
    if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage === 'undefined') {
        defineStorage(globalThis, storage);
    }
}
