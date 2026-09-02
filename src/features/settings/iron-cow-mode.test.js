import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/storage.js', () => ({
    default: {
        setJSON: vi.fn(async () => {}),
        getJSON: vi.fn(async () => null),
        delete: vi.fn(async () => {}),
    },
}));
vi.mock('../../core/data-manager.js', () => ({
    default: { getCurrentCharacterId: vi.fn(() => 'char-1') },
}));

import config from '../../core/config.js';
import storageMock from '../../core/storage.js';
import ironCowMode, { IRON_COW_SETTINGS } from './iron-cow-mode.js';

function checkboxEntry(value) {
    return { type: 'checkbox', isTrue: value };
}

function selectEntry(value) {
    return { type: 'select', value };
}

describe('Iron Cow Mode - date/time format persistence (TLA-034)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        config.settingsMap = {
            market_listingDateFormat: selectEntry('DD-MM'),
            market_listingTimeFormat: selectEntry('12hour'),
            networkAlert: checkboxEntry(true),
        };
        storageMock.getJSON.mockResolvedValue(null);
    });

    test('date/time format IDs are no longer classified as Iron Cow settings', () => {
        expect(IRON_COW_SETTINGS.has('market_listingDateFormat')).toBe(false);
        expect(IRON_COW_SETTINGS.has('market_listingTimeFormat')).toBe(false);
    });

    test('market_listingAgeFormat remains in Iron Cow scope (marketplace-specific)', () => {
        expect(IRON_COW_SETTINGS.has('market_listingAgeFormat')).toBe(true);
    });

    test('non-default date/time formats survive enable', async () => {
        await ironCowMode.enable();

        expect(config.settingsMap.market_listingDateFormat.value).toBe('DD-MM');
        expect(config.settingsMap.market_listingTimeFormat.value).toBe('12hour');
    });

    test('default date/time formats also remain stable through enable', async () => {
        config.settingsMap.market_listingDateFormat = selectEntry('MM-DD');
        config.settingsMap.market_listingTimeFormat = selectEntry('24hour');

        await ironCowMode.enable();

        expect(config.settingsMap.market_listingDateFormat.value).toBe('MM-DD');
        expect(config.settingsMap.market_listingTimeFormat.value).toBe('24hour');
    });

    test('Iron Cow still force-disables actual market/profit settings', async () => {
        await ironCowMode.enable();

        expect(config.settingsMap.networkAlert.isTrue).toBe(false);
    });

    test('a full enable/disable cycle preserves the chosen date/time formats', async () => {
        // config.setSetting()/setSettingValue() also persist the whole settingsMap under an
        // unrelated key (this.saveSettings()); only capture writes to the Iron Cow snapshot key.
        let savedSnapshot = null;
        storageMock.setJSON.mockImplementation(async (key, value) => {
            if (key.startsWith('toolasha_ironCowSnapshot')) savedSnapshot = value;
        });
        storageMock.getJSON.mockImplementation(async (key) =>
            key.startsWith('toolasha_ironCowSnapshot') ? savedSnapshot : null
        );

        await ironCowMode.enable();
        await ironCowMode.disable();

        expect(config.settingsMap.market_listingDateFormat.value).toBe('DD-MM');
        expect(config.settingsMap.market_listingTimeFormat.value).toBe('12hour');
        expect(config.settingsMap.networkAlert.isTrue).toBe(true);
    });

    test('legacy snapshot entries for date/time format are ignored on disable', async () => {
        // Simulates an old snapshot saved before these two IDs were removed from IRON_COW_SETTINGS.
        storageMock.getJSON.mockResolvedValue({
            market_listingDateFormat: { type: 'select', value: 'MM-DD' },
            market_listingTimeFormat: { type: 'select', value: '24hour' },
            networkAlert: { type: 'checkbox', value: true },
        });
        config.settingsMap.market_listingDateFormat = selectEntry('DD-MM');
        config.settingsMap.market_listingTimeFormat = selectEntry('12hour');
        config.settingsMap.networkAlert = checkboxEntry(false);

        await ironCowMode.disable();

        // Stale date/time entries must not overwrite the user's current values.
        expect(config.settingsMap.market_listingDateFormat.value).toBe('DD-MM');
        expect(config.settingsMap.market_listingTimeFormat.value).toBe('12hour');
        // A genuine Iron Cow setting is still restored from the snapshot.
        expect(config.settingsMap.networkAlert.isTrue).toBe(true);
    });
});
