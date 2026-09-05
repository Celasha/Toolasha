/**
 * Tests for the account-preference mirror sync (TLA-025 item 17): the mirror must stay fresh via
 * config's own settings-loaded/change infrastructure, independent of whether the character-scoped
 * Character Activity collector is currently running.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    settingsLoadedCallbacks: [],
    settingChangeCallbacks: {},
    settingValue: true,
    savedPrefs: null,
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => mocks.settingValue),
        getSettingValue: vi.fn((key, defaultValue) => defaultValue),
        onSettingsLoaded: vi.fn((cb) => mocks.settingsLoadedCallbacks.push(cb)),
        onSettingChange: vi.fn((key, cb) => {
            (mocks.settingChangeCallbacks[key] ||= []).push(cb);
        }),
    },
}));

vi.mock('./character-activity-storage.js', () => ({
    saveAccountPreferences: vi.fn(async (prefs) => {
        mocks.savedPrefs = prefs;
        return true;
    }),
}));

vi.mock('./character-select-renderer.js', () => ({
    default: { refreshNow: vi.fn(async () => {}) },
}));

const { startAccountPreferencesSync } = await import('./character-activity-account-prefs-sync.js');
const { saveAccountPreferences } = await import('./character-activity-storage.js');
const { default: config } = await import('../../core/config.js');
const { default: characterSelectRenderer } = await import('./character-select-renderer.js');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsLoadedCallbacks = [];
    mocks.settingChangeCallbacks = {};
    mocks.settingValue = true;
    mocks.savedPrefs = null;
});

describe('startAccountPreferencesSync', () => {
    test('registers an onSettingsLoaded listener and one onSettingChange listener per relevant setting', () => {
        startAccountPreferencesSync();

        expect(config.onSettingsLoaded).toHaveBeenCalledTimes(1);
        expect(config.onSettingChange).toHaveBeenCalledWith('characterActivityStatus', expect.any(Function));
        expect(config.onSettingChange).toHaveBeenCalledWith('market_listingDateFormat', expect.any(Function));
        expect(config.onSettingChange).toHaveBeenCalledWith('market_listingTimeFormat', expect.any(Function));
    });

    test('onSettingsLoaded firing writes the mirror immediately and then refreshes the renderer', async () => {
        startAccountPreferencesSync();

        await mocks.settingsLoadedCallbacks[0]();

        expect(saveAccountPreferences).toHaveBeenCalledWith(
            { enabled: true, dateFormat: 'MM-DD', timeFormat: '24hour' },
            true
        );
        expect(characterSelectRenderer.refreshNow).toHaveBeenCalledTimes(1);
    });

    test('toggling characterActivityStatus off refreshes the mirror with the new value, with no active collector involved', async () => {
        startAccountPreferencesSync();
        mocks.settingValue = false;

        await mocks.settingChangeCallbacks.characterActivityStatus[0]();

        expect(mocks.savedPrefs.enabled).toBe(false);
        expect(characterSelectRenderer.refreshNow).toHaveBeenCalledTimes(1);
    });

    test('changing the date/time format settings also refreshes the mirror', async () => {
        startAccountPreferencesSync();

        await mocks.settingChangeCallbacks.market_listingDateFormat[0]();
        expect(saveAccountPreferences).toHaveBeenCalled();

        await mocks.settingChangeCallbacks.market_listingTimeFormat[0]();
        expect(saveAccountPreferences).toHaveBeenCalledTimes(2);
    });

    test('TLA-025 DEV4 fix: a slow immediate write does not skip the renderer refresh', async () => {
        startAccountPreferencesSync();
        let releaseSave;
        saveAccountPreferences.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseSave = () => resolve(true);
                })
        );

        const syncPromise = mocks.settingsLoadedCallbacks[0]();
        // Let the queued `.then()` actually invoke saveAccountPreferences before asserting.
        await Promise.resolve();
        await Promise.resolve();
        expect(characterSelectRenderer.refreshNow).not.toHaveBeenCalled();

        releaseSave();
        await syncPromise;

        expect(characterSelectRenderer.refreshNow).toHaveBeenCalledTimes(1);
    });

    test('TLA-025 DEV4 fix: a failed immediate write does not trigger a renderer refresh', async () => {
        startAccountPreferencesSync();
        saveAccountPreferences.mockResolvedValueOnce(false);

        await mocks.settingsLoadedCallbacks[0]();

        expect(characterSelectRenderer.refreshNow).not.toHaveBeenCalled();
    });

    test('TLA-025 DEV4 fix: two rapid setting changes complete in callback order even if the first persist resolves slowly', async () => {
        startAccountPreferencesSync();
        const order = [];
        let releaseFirst;
        saveAccountPreferences.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirst = () => {
                        order.push('first-saved');
                        resolve(true);
                    };
                })
        );
        saveAccountPreferences.mockImplementationOnce(async () => {
            order.push('second-saved');
            return true;
        });
        characterSelectRenderer.refreshNow.mockImplementation(async () => {
            order.push('refresh');
        });

        mocks.settingValue = false;
        const first = mocks.settingChangeCallbacks.characterActivityStatus[0]();
        mocks.settingValue = true;
        const second = mocks.settingChangeCallbacks.characterActivityStatus[0]();

        // Let the first task's saveAccountPreferences() call actually start before releasing it.
        await Promise.resolve();
        await Promise.resolve();
        releaseFirst();
        await Promise.all([first, second]);

        expect(order).toEqual(['first-saved', 'refresh', 'second-saved', 'refresh']);
    });
});
