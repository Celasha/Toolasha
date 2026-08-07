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
});
