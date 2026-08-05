import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    characterId: 'character-a',
    loadedSettings: {},
    loadSettings: vi.fn(),
    setCharacterId: vi.fn(),
}));

vi.mock('./settings-storage.js', () => ({
    default: {
        buildDefaults: vi.fn(() => ({})),
        loadSettings: mocks.loadSettings,
        setCharacterId: mocks.setCharacterId,
        saveSettings: vi.fn(),
    },
}));

vi.mock('./settings-schema.js', () => ({ settingsGroups: {} }));

vi.mock('./data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => mocks.characterId),
        getCurrentCharacterName: vi.fn(() => 'Character A'),
    },
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.characterId = 'character-a';
    mocks.loadedSettings = {};
    mocks.loadSettings.mockImplementation(async () => mocks.loadedSettings);
});

describe('Config settings reload lifecycle', () => {
    test('notifies changed settings during a normal load', async () => {
        const { default: config } = await import('./config.js');
        const callback = vi.fn();
        config.settingsMap = { queueMonitor: { isTrue: false } };
        config.settingChangeCallbacks = { queueMonitor: [callback] };
        mocks.loadedSettings = { queueMonitor: { isTrue: true } };

        await config.loadSettings();

        expect(callback).toHaveBeenCalledWith(true);
    });

    test('suppresses setting callbacks during a full character reinitialization', async () => {
        const { default: config } = await import('./config.js');
        const callback = vi.fn();
        config.settingsMap = { queueMonitor: { isTrue: false } };
        config.settingChangeCallbacks = { queueMonitor: [callback] };
        mocks.loadedSettings = { queueMonitor: { isTrue: true } };

        await config.loadSettings({ notifyChanges: false });

        expect(config.settingsMap.queueMonitor.isTrue).toBe(true);
        expect(callback).not.toHaveBeenCalled();
    });
});
