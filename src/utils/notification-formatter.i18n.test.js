/**
 * Tests for game-name localization in the infoNotification.* formatter: nested $t(table.{{var}})
 * names must resolve through the game's i18next bridge (utils/game-i18n.js) with the English
 * detail-map name as fallback, and humanizeHrid as the final fallback.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockTranslateGameName = vi.fn();

vi.mock('./game-i18n.js', () => ({
    translateGameName: mockTranslateGameName,
}));

const mockGetItemDetails = vi.fn();
const mockGetInitClientData = vi.fn();

vi.mock('../core/data-manager.js', () => ({
    default: {
        getItemDetails: mockGetItemDetails,
        getInitClientData: mockGetInitClientData,
    },
}));

// Fixture mirroring the real notificationFormatter locale keys exercised here. Unknown keys
// return the key string, matching i18n.js's real missing-key contract.
const TEMPLATES_FIXTURE = {
    'notificationFormatter.soldItem': 'Sold {{count}} $t(itemNames.{{itemHrid}})',
    'notificationFormatter.characterLeveledUp': 'You have reached level {{level}} $t(skillNames.{{skillHrid}})!',
    'notificationFormatter.guildPromotedTo': 'You have been promoted to guild $t(guildCharacterRoleNames.{{role}})',
    'notificationFormatter.chatIconUnlocked': 'Unlocked chat icon: $t(chatIconNames.{{iconHrid}})',
};

vi.mock('../core/i18n.js', () => ({
    default: { getLocale: () => 'en' },
    t: (key) => TEMPLATES_FIXTURE[key] ?? key,
}));

describe('nested game-name localization', () => {
    beforeEach(() => {
        mockTranslateGameName.mockReset();
        mockGetItemDetails.mockReset();
        mockGetInitClientData.mockReset();
    });

    test('resolves item names through the game i18next bridge with the English name as fallback', async () => {
        mockGetItemDetails.mockReturnValue({ name: 'Basic Torch' });
        mockTranslateGameName.mockImplementation((_namespace, _hrid, fallback) => `译·${fallback}`);
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.soldItem', [
            { name: 'count', data: '1' },
            { name: 'itemHrid', data: '/items/basic_torch' },
        ]);

        expect(mockTranslateGameName).toHaveBeenCalledWith('itemNames', '/items/basic_torch', 'Basic Torch');
        expect(text).toBe('Sold 1 译·Basic Torch');
    });

    test('falls back to the English detail-map name when the game has no translation', async () => {
        mockGetInitClientData.mockReturnValue({
            skillDetailMap: { '/skills/milking': { name: 'Milking' } },
        });
        mockTranslateGameName.mockImplementation((_namespace, _hrid, fallback) => fallback);
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.characterLeveledUp', [
            { name: 'level', data: '50' },
            { name: 'skillHrid', data: '/skills/milking' },
        ]);

        expect(mockTranslateGameName).toHaveBeenCalledWith('skillNames', '/skills/milking', 'Milking');
        expect(text).toBe('You have reached level 50 Milking!');
    });

    test('falls back to humanizeHrid when neither the game nor a detail map knows the hrid', async () => {
        mockGetItemDetails.mockReturnValue(null);
        mockTranslateGameName.mockImplementation((_namespace, _hrid, fallback) => fallback);
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.soldItem', [
            { name: 'count', data: '1' },
            { name: 'itemHrid', data: '/items/mystery_tea' },
        ]);

        // English lookup misses must still route through the bridge, with '' as fallback — a
        // "detail-map miss short-circuits straight to humanizeHrid" implementation is a bug.
        expect(mockTranslateGameName).toHaveBeenCalledWith('itemNames', '/items/mystery_tea', '');
        expect(text).toBe('Sold 1 Mystery Tea');
    });

    test('tables without a detail map (chatIconNames) pass an empty fallback and land on humanizeHrid', async () => {
        mockTranslateGameName.mockImplementation((_namespace, _hrid, fallback) => fallback);
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.chatIconUnlocked', [
            { name: 'iconHrid', data: '/chat_icons/milk' },
        ]);

        expect(mockTranslateGameName).toHaveBeenCalledWith('chatIconNames', '/chat_icons/milk', '');
        expect(text).toBe('Unlocked chat icon: Milk');
    });

    test('guildCharacterRoleNames is keyed by the plain role string, not a hrid', async () => {
        mockGetInitClientData.mockReturnValue({
            guildCharacterRoleDetailMap: { officer: { name: 'Officer' } },
        });
        mockTranslateGameName.mockImplementation((_namespace, _hrid, fallback) => `译·${fallback}`);
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.guildPromotedTo', [{ name: 'role', data: 'officer' }]);

        expect(mockTranslateGameName).toHaveBeenCalledWith('guildCharacterRoleNames', 'officer', 'Officer');
        expect(text).toBe('You have been promoted to guild 译·Officer');
    });
});
