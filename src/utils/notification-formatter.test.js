/**
 * Tests for the infoNotification.* message formatter used by the Notification Log tab.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockGetItemDetails = vi.fn();
const mockGetInitClientData = vi.fn();

vi.mock('../core/data-manager.js', () => ({
    default: {
        getItemDetails: mockGetItemDetails,
        getInitClientData: mockGetInitClientData,
    },
}));

describe('formatNotificationMessage', () => {
    beforeEach(() => {
        mockGetItemDetails.mockReset();
        mockGetInitClientData.mockReset();
    });

    test('substitutes plain {{var}} placeholders', async () => {
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.addedFriend', [{ name: 'name', data: 'Celasha' }]);

        expect(text).toBe('Added friend: Celasha');
    });

    test('resolves a nested $t(itemNames.{{itemHrid}}) reference via dataManager', async () => {
        mockGetItemDetails.mockReturnValue({ name: 'Basic Torch' });
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.soldItem', [
            { name: 'count', data: '1' },
            { name: 'itemHrid', data: '/items/basic_torch' },
        ]);

        expect(text).toBe('Sold 1 Basic Torch');
        expect(mockGetItemDetails).toHaveBeenCalledWith('/items/basic_torch');
    });

    test('falls back to a humanized hrid tail when dataManager has no entry for it', async () => {
        mockGetItemDetails.mockReturnValue(null);
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.soldItem', [
            { name: 'count', data: '1' },
            { name: 'itemHrid', data: '/items/basic_torch' },
        ]);

        expect(text).toBe('Sold 1 Basic Torch');
    });

    test('resolves houseRoomNames, buyableUpgradeNames, and skillNames tables', async () => {
        mockGetInitClientData.mockReturnValue({
            houseRoomDetailMap: { '/house_rooms/kitchen': { name: 'Kitchen' } },
            buyableUpgradeDetailMap: { '/buyable_upgrades/action_queue_cap_1': { name: '+1 Action Queue' } },
            skillDetailMap: { '/skills/milking': { name: 'Milking' } },
        });
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        expect(
            formatNotificationMessage('infoNotification.houseConstructed', [
                { name: 'level', data: '3' },
                { name: 'roomHrid', data: '/house_rooms/kitchen' },
            ])
        ).toBe('Level 3 Kitchen constructed');

        expect(
            formatNotificationMessage('infoNotification.upgradePurchased', [
                { name: 'upgradeHrid', data: '/buyable_upgrades/action_queue_cap_1' },
                { name: 'count', data: '2' },
            ])
        ).toBe('Upgrade purchased: +1 Action Queue (x2)');

        expect(
            formatNotificationMessage('infoNotification.characterLeveledUp', [
                { name: 'level', data: '50' },
                { name: 'skillHrid', data: '/skills/milking' },
            ])
        ).toBe('You have reached level 50 Milking!');
    });

    test('guildCharacterRoleNames is keyed by plain role string, not a hrid', async () => {
        mockGetInitClientData.mockReturnValue({
            guildCharacterRoleDetailMap: { officer: { name: 'Officer' } },
        });
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.guildPromotedTo', [{ name: 'role', data: 'officer' }]);

        expect(text).toBe('You have been promoted to guild Officer');
    });

    test('unknown message keys still render readable text instead of throwing', async () => {
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        const text = formatNotificationMessage('infoNotification.someBrandNewNotification', [
            { name: 'foo', data: 'bar' },
        ]);

        expect(text).toContain('Some Brand New Notification');
        expect(text).toContain('foo: bar');
    });

    test('handles a message with no variables', async () => {
        const { formatNotificationMessage } = await import('./notification-formatter.js');

        expect(formatNotificationMessage('infoNotification.partyCreated', [])).toBe('Party created');
        expect(formatNotificationMessage('infoNotification.partyCreated', undefined)).toBe('Party created');
    });
});

describe('getNotificationCategory', () => {
    test('classifies known keys into their category', async () => {
        const { getNotificationCategory } = await import('./notification-formatter.js');

        expect(getNotificationCategory('infoNotification.soldItem')).toBe('trading');
        expect(getNotificationCategory('infoNotification.guildJoined')).toBe('guild');
        expect(getNotificationCategory('infoNotification.characterLeveledUp')).toBe('progression');
    });

    test('falls back to "other" for an unrecognized key', async () => {
        const { getNotificationCategory } = await import('./notification-formatter.js');

        expect(getNotificationCategory('infoNotification.somethingNew')).toBe('other');
    });
});

describe('getAllNotificationCategories', () => {
    test('returns a stable, deduplicated list including every used category', async () => {
        const { getAllNotificationCategories } = await import('./notification-formatter.js');

        const categories = getAllNotificationCategories();

        expect(categories).toContain('trading');
        expect(categories).toContain('guild');
        expect(categories.length).toBe(new Set(categories).size);
    });
});
