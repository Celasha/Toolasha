/**
 * Regression test: config.onSettingsLoaded fires whenever loadSettings() repopulates
 * settingsMap from storage, even when notifyChanges is false (the character-switch path).
 * Long-lived infrastructure outside the feature registry (e.g. the persistent Action
 * Filter) relies on this to resync after a character switch, since per-setting
 * onSettingChange callbacks are intentionally suppressed during that reinitialization.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./settings-storage.js', () => ({
    default: {
        getSetting: vi.fn(() => null),
        onSettingChange: vi.fn(),
        setCharacterId: vi.fn(),
        loadSettings: vi.fn(async () => ({})),
        buildDefaults: vi.fn(() => ({})),
    },
}));
vi.mock('./settings-schema.js', () => ({ settingsGroups: [] }));
vi.mock('./data-manager.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        getCurrentCharacterId: vi.fn(() => 'char-1'),
        getCurrentCharacterName: vi.fn(() => 'TestCharacter'),
    },
}));

const { default: config } = await import('./config.js');
const { default: settingsStorage } = await import('./settings-storage.js');

describe('Config — onSettingsLoaded (character-switch settings resync)', () => {
    beforeEach(() => {
        config.settingsMap = {};
        config.settingsLoadedCallbacks = [];
        config.settingChangeCallbacks = {};
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test('fires after loadSettings() completes, even when notifyChanges is false', async () => {
        settingsStorage.loadSettings.mockResolvedValueOnce({
            profitCalc_pricingMode: { value: 'optimistic' },
        });
        const loadedSpy = vi.fn();
        config.onSettingsLoaded(loadedSpy);

        await config.loadSettings({ notifyChanges: false });

        expect(loadedSpy).toHaveBeenCalledTimes(1);
    });

    test('fires after loadSettings() completes when notifyChanges is true (default)', async () => {
        settingsStorage.loadSettings.mockResolvedValueOnce({
            profitCalc_pricingMode: { value: 'optimistic' },
        });
        const loadedSpy = vi.fn();
        config.onSettingsLoaded(loadedSpy);

        await config.loadSettings();

        expect(loadedSpy).toHaveBeenCalledTimes(1);
    });

    test('does not preserve or restore per-setting onSettingChange suppression: those callbacks stay suppressed when notifyChanges is false', async () => {
        config.settingsMap = { profitCalc_pricingMode: { value: 'hybrid' } };
        settingsStorage.loadSettings.mockResolvedValueOnce({
            profitCalc_pricingMode: { value: 'optimistic' },
        });
        const changeSpy = vi.fn();
        config.onSettingChange('profitCalc_pricingMode', changeSpy);

        await config.loadSettings({ notifyChanges: false });

        expect(changeSpy).not.toHaveBeenCalled();
    });

    test('CA-50: fires within the synchronous tail of loadSettings(), strictly before anything the caller sequences after awaiting it (e.g. character-scoped feature init)', async () => {
        settingsStorage.loadSettings.mockResolvedValueOnce({
            profitCalc_pricingMode: { value: 'optimistic' },
        });
        const order = [];
        // Mirrors character-activity-account-prefs-sync.js registering via onSettingsLoaded to
        // keep the account preference mirror fresh before Character Activity's character-scoped
        // feature initializes.
        config.onSettingsLoaded(() => order.push('account-prefs-mirror-synced'));

        const loadPromise = config.loadSettings({ notifyChanges: false });
        order.push('load-in-flight');
        await loadPromise;
        // Caller code (main.js / feature-registry.js) always sequences feature initialization
        // strictly after awaiting loadSettings() - simulated here as the next step.
        order.push('character-scoped-feature-init');

        expect(order).toEqual(['load-in-flight', 'account-prefs-mirror-synced', 'character-scoped-feature-init']);
    });

    test('offSettingsLoaded unregisters the callback', async () => {
        settingsStorage.loadSettings.mockResolvedValueOnce({
            profitCalc_pricingMode: { value: 'optimistic' },
        });
        const loadedSpy = vi.fn();
        config.onSettingsLoaded(loadedSpy);
        config.offSettingsLoaded(loadedSpy);

        await config.loadSettings({ notifyChanges: false });

        expect(loadedSpy).not.toHaveBeenCalled();
    });

    test('does not fire when characterId is unknown (settingsMap only populated with schema defaults)', async () => {
        const dataManager = (await import('./data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValueOnce(null);
        const loadedSpy = vi.fn();
        config.onSettingsLoaded(loadedSpy);

        await config.loadSettings({ notifyChanges: false });

        expect(loadedSpy).not.toHaveBeenCalled();
    });
});
