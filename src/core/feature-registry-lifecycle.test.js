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

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
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

        await mocks.handlers.get('character_switching')({ oldId: 'a', newId: 'b' });
        const switched = mocks.handlers.get('character_switched')({ oldId: 'a', newId: 'b' });
        await vi.advanceTimersByTimeAsync(50);
        await switched;

        expect(featureModule.cleanup).toHaveBeenCalledTimes(1);
        expect(featureModule.initialize).toHaveBeenCalledTimes(2);
        expect(mocks.loadSettings).toHaveBeenCalledWith({ notifyChanges: false });
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
