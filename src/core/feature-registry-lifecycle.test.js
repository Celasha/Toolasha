import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const mocks = vi.hoisted(() => ({
    handlers: new Map(),
    loadSettings: vi.fn(async () => {}),
    clearSettingsCache: vi.fn(),
    applyColorSettings: vi.fn(),
    endAll: vi.fn(),
    clearAllMarketplaceUI: vi.fn(),
    currentCharacterId: 'a',
}));

vi.mock('./config.js', () => ({
    default: {
        isFeatureEnabled: vi.fn(() => true),
        loadSettings: mocks.loadSettings,
        clearSettingsCache: mocks.clearSettingsCache,
        applyColorSettings: mocks.applyColorSettings,
    },
}));

vi.mock('./data-manager.js', () => ({
    default: {
        getIsCharacterSwitching: vi.fn(() => false),
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        on: vi.fn((event, handler) => mocks.handlers.set(event, handler)),
    },
}));

vi.mock('../utils/performance-monitor.js', () => ({
    default: { snapshot: vi.fn(), clearSnapshot: vi.fn() },
}));

vi.mock('./marketplace-session.js', () => ({
    marketplaceSession: {
        endAll: mocks.endAll,
        clearAllMarketplaceUI: mocks.clearAllMarketplaceUI,
    },
}));

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.currentCharacterId = 'a';
    mocks.loadSettings.mockImplementation(async () => {});
});

afterEach(() => {
    vi.useRealTimers();
});

describe('FeatureRegistry character-switch lifecycle ownership', () => {
    test('cleans each registered feature once and reloads settings without callbacks', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const featureModule = {
            initialize: vi.fn(),
            cleanup: vi.fn(),
        };

        registry.replaceFeatures([
            {
                key: 'dungeonTrackerUI',
                name: 'Dungeon Tracker UI',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        await registry.initializeFeatures();
        registry.setupCharacterSwitchHandler();

        mocks.currentCharacterId = 'b';
        await mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        const switched = mocks.handlers.get('character_switched')({ oldId: 'a', newId: 'b' });
        await vi.advanceTimersByTimeAsync(50);
        await switched;

        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);
        expect(mocks.loadSettings).toHaveBeenCalledWith({ notifyChanges: false });
    });

    test('starts departing-character cleanup synchronously before the switch callback returns', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const cleanupGate = createDeferred();
        const featureModule = {
            initialize: vi.fn(),
            cleanup: vi.fn(() => cleanupGate.promise),
        };

        registry.replaceFeatures([
            {
                key: 'itemCountDisplay',
                name: 'Item Count Display',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        await registry.initializeFeatures();
        registry.setupCharacterSwitchHandler();

        mocks.currentCharacterId = 'b';
        const switching = mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });

        // This assertion intentionally happens before yielding to Promise jobs.
        // The game's WebSocket handler must not be allowed to process the new
        // character while old feature cleanup is still waiting to start.
        expect(mocks.clearSettingsCache).toHaveBeenCalledTimes(1);
        expect(mocks.endAll).toHaveBeenCalledTimes(1);
        expect(mocks.clearAllMarketplaceUI).toHaveBeenCalledTimes(1);
        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);

        cleanupGate.resolve();
        await switching;
    });

    test('coalesces rapid A → B → A switches to the latest character', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const cleanupGate = createDeferred();
        const initializedFor = [];
        const featureModule = {
            initialize: vi.fn(() => initializedFor.push(mocks.currentCharacterId)),
            cleanup: vi.fn(() => cleanupGate.promise),
        };

        registry.replaceFeatures([
            {
                key: 'itemCountDisplay',
                name: 'Item Count Display',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        await registry.initializeFeatures();
        registry.setupCharacterSwitchHandler();

        mocks.currentCharacterId = 'b';
        mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        mocks.handlers.get('character_switched')({ oldId: 'a', newId: 'b' });

        mocks.currentCharacterId = 'a';
        mocks.handlers.get('character_switching')({ oldId: 'b', newId: 'a' });
        const finalSwitch = mocks.handlers.get('character_switched')({ oldId: 'b', newId: 'a' });

        cleanupGate.resolve();
        await vi.advanceTimersByTimeAsync(50);
        await finalSwitch;

        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);
        expect(initializedFor).toEqual(['a', 'a']);
        expect(mocks.loadSettings).toHaveBeenCalledTimes(1);
        expect(mocks.applyColorSettings).toHaveBeenCalledTimes(1);
    });

    test('does not initialize new-character features before slow cleanup completes', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const cleanupGate = createDeferred();
        const featureModule = {
            initialize: vi.fn(),
            cleanup: vi.fn(() => cleanupGate.promise),
        };

        registry.replaceFeatures([
            {
                key: 'itemCountDisplay',
                name: 'Item Count Display',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        await registry.initializeFeatures();
        registry.setupCharacterSwitchHandler();

        mocks.currentCharacterId = 'b';
        mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        const switched = mocks.handlers.get('character_switched')({ oldId: 'a', newId: 'b' });

        await vi.advanceTimersByTimeAsync(550);
        expect(mocks.loadSettings).not.toHaveBeenCalled();
        expect(featureModule.initialize).toHaveBeenCalledTimes(1);

        cleanupGate.resolve();
        await vi.advanceTimersByTimeAsync(50);
        await switched;

        expect(mocks.loadSettings).toHaveBeenCalledTimes(1);
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);
    });

    test('abandons settings loaded for a character that becomes stale mid-load', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const firstLoadGate = createDeferred();
        const initializedFor = [];
        const featureModule = {
            initialize: vi.fn(() => initializedFor.push(mocks.currentCharacterId)),
            cleanup: vi.fn(),
        };
        mocks.loadSettings.mockImplementationOnce(() => firstLoadGate.promise).mockImplementationOnce(async () => {});

        registry.replaceFeatures([
            {
                key: 'itemCountDisplay',
                name: 'Item Count Display',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        await registry.initializeFeatures();
        registry.setupCharacterSwitchHandler();

        mocks.currentCharacterId = 'b';
        mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        mocks.handlers.get('character_switched')({ oldId: 'a', newId: 'b' });
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.loadSettings).toHaveBeenCalledTimes(1);

        mocks.currentCharacterId = 'a';
        mocks.handlers.get('character_switching')({ oldId: 'b', newId: 'a' });
        const finalSwitch = mocks.handlers.get('character_switched')({ oldId: 'b', newId: 'a' });

        firstLoadGate.resolve();
        await vi.advanceTimersByTimeAsync(50);
        await finalSwitch;

        expect(mocks.loadSettings).toHaveBeenCalledTimes(2);
        expect(mocks.applyColorSettings).toHaveBeenCalledTimes(1);
        expect(initializedFor).toEqual(['a', 'a']);
    });

    test('dungeon modules do not own additional character_switching cleanup listeners', () => {
        const files = [
            '../features/combat/dungeon-tracker.js',
            '../features/combat/dungeon-tracker-ui.js',
            '../features/combat/dungeon-tracker-chat-annotations.js',
        ];

        for (const file of files) {
            const content = readFileSync(resolve(new URL('.', import.meta.url).pathname, file), 'utf8');
            expect(content).not.toContain("dataManager.on('character_switching'");
        }
    });

    test('TLA-025: a character switch beginning mid-initialize still finds and cleans up the in-flight feature', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const initGate = createDeferred();
        const featureModule = {
            initialize: vi.fn(() => initGate.promise),
            cleanup: vi.fn(),
        };

        registry.replaceFeatures([
            {
                key: 'slowFeature',
                name: 'Slow Feature',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        registry.setupCharacterSwitchHandler();

        // initialize() is still pending - featureInstances must already know about this feature.
        const initPromise = registry.initializeFeatures();

        mocks.currentCharacterId = 'b';
        mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });

        // cleanupFeatures() runs its synchronous work before any await - this assertion
        // intentionally happens before yielding to Promise jobs.
        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);

        initGate.resolve();
        await initPromise;
    });

    test('CA-54: a concurrent second init pass cannot start the same feature twice', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const initGate = createDeferred();
        const featureModule = {
            initialize: vi.fn(() => initGate.promise),
            cleanup: vi.fn(),
        };

        registry.replaceFeatures([
            {
                key: 'concurrentFeature',
                name: 'Concurrent Feature',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);

        // Ownership is claimed synchronously before the first await, so a second call made before
        // the first one yields must see the key already owned and skip it entirely.
        const first = registry.initializeFeatures();
        const second = registry.initializeFeatures();

        initGate.resolve();
        await Promise.all([first, second]);

        expect(featureModule.initialize).toHaveBeenCalledTimes(1);
    });

    test('CA-55: a stale resolve from a cleaned-up initialize cannot overwrite ownership reclaimed by a later init pass', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const firstGate = createDeferred();
        const secondGate = createDeferred();
        const firstInstance = { tag: 'first' };
        const secondInstance = { tag: 'second' };
        let callCount = 0;
        const featureModule = {
            initialize: vi.fn(() => {
                callCount += 1;
                return callCount === 1 ? firstGate.promise : secondGate.promise;
            }),
            cleanup: vi.fn(),
        };

        registry.replaceFeatures([
            {
                key: 'raceFeature',
                name: 'Race Feature',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);
        registry.setupCharacterSwitchHandler();

        const firstInit = registry.initializeFeatures();

        mocks.currentCharacterId = 'b';
        mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        // cleanupFeatures() ran synchronously above: it saw the provisional ownership token (the
        // real instance never arrived yet), called module cleanup with `null`, and removed ownership.
        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);
        expect(featureModule.cleanup).toHaveBeenLastCalledWith(null);

        // A later init pass reclaims the now-empty key with a brand-new ownership token while the
        // FIRST initialize() call is still pending.
        const secondInit = registry.initializeFeatures();
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);

        // The stale first call resolves after the second pass has already reclaimed ownership -
        // it must not resurrect/overwrite the newer owner.
        firstGate.resolve(firstInstance);
        await firstInit;

        secondGate.resolve(secondInstance);
        await secondInit;

        // Prove which instance actually ended up owning the slot by cleaning up again: it must be
        // the second (current) instance, never the stale first instance the cleaned-up call
        // resolved with.
        mocks.currentCharacterId = 'a';
        const switching = mocks.handlers.get('character_switching')({ oldId: 'b', newId: 'a' });
        expect(featureModule.cleanup).toHaveBeenLastCalledWith(secondInstance);
        await switching;
    });

    test('CA-56: releasing provisional ownership on rejection only happens if this attempt still owns the key', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const featureModule = {
            initialize: vi.fn(() => Promise.reject(new Error('boom'))),
            cleanup: vi.fn(),
        };

        registry.replaceFeatures([
            {
                key: 'rejectingFeature',
                name: 'Rejecting Feature',
                module: featureModule,
                initialize: featureModule.initialize,
            },
        ]);

        await registry.initializeFeatures();
        expect(featureModule.initialize).toHaveBeenCalledTimes(1);

        // Ownership must have been released on rejection (never left dangling forever) so a later
        // init pass can retry the feature instead of silently treating it as already-initialized.
        await registry.initializeFeatures();
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);
    });

    test('CA-57: retryFailedFeatures() claims ownership before awaiting and cannot resurrect after cleanup reclaims the key', async () => {
        const registry = (await import('./feature-registry.js')).default;
        const retryGate = createDeferred();
        const reclaimInstance = { tag: 'reclaimed' };
        let initCallCount = 0;
        const featureModule = {
            initialize: vi.fn(() => {
                initCallCount += 1;
                return initCallCount === 1 ? retryGate.promise : Promise.resolve(reclaimInstance);
            }),
            cleanup: vi.fn(),
        };

        registry.replaceFeatures([
            {
                key: 'retryFeature',
                name: 'Retry Feature',
                module: featureModule,
                initialize: featureModule.initialize,
                healthCheck: () => true,
            },
        ]);
        registry.setupCharacterSwitchHandler();

        const retryPromise = registry.retryFailedFeatures([{ key: 'retryFeature' }]);

        // retryFailedFeatures() must have claimed ownership synchronously before awaiting - a
        // character switch beginning mid-retry must still find and clean up the in-flight feature.
        mocks.currentCharacterId = 'b';
        mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);

        // A fresh init pass reclaims the key with a new token while the stale retry call is still pending.
        await registry.initializeFeatures();
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);

        // The stale retry resolves after reclaim - it must not overwrite the freshly claimed ownership.
        retryGate.resolve({ tag: 'stale' });
        await retryPromise;

        mocks.currentCharacterId = 'a';
        const switching = mocks.handlers.get('character_switching')({ oldId: 'b', newId: 'a' });
        expect(featureModule.cleanup).toHaveBeenLastCalledWith(reclaimInstance);
        await switching;
    });
});
