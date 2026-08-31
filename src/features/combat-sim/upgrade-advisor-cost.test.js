import { describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    resolveItemPrice: vi.fn(),
}));

vi.mock('../../utils/profit-helpers.js', () => ({
    resolveItemPrice: (...args) => mocks.resolveItemPrice(...args),
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrices: vi.fn(() => null),
}));

vi.mock('../../utils/ability-cost-calculator.js', () => ({
    calculateAbilityLevelUpCost: vi.fn(() => 1000),
}));

import { calculateUpgradeCost } from './upgrade-advisor.js';

describe('calculateUpgradeCost - missing-price propagation (CSIM-AUD-013)', () => {
    test('a tier upgrade with a fully resolved buy/sell price is not marked incomplete', () => {
        mocks.resolveItemPrice.mockImplementation((hrid, { side }) =>
            side === 'buy' ? { price: 1000, missing: false } : { price: 500, missing: false }
        );

        const result = calculateUpgradeCost(
            {
                type: 'tier',
                upgradeHrid: '/items/sword2',
                currentHrid: '/items/sword1',
                upgradeLevel: 0,
                currentLevel: 0,
            },
            {}
        );

        expect(result.cost).toBeCloseTo(500);
        expect(result.costIsIncomplete).toBe(false);
    });

    test('an unresolvable buy price marks the candidate incomplete instead of a silent exact-looking cost', () => {
        mocks.resolveItemPrice.mockImplementation((hrid, { side }) =>
            side === 'buy' ? { price: 0, missing: true } : { price: 500, missing: false }
        );

        const result = calculateUpgradeCost(
            {
                type: 'tier',
                upgradeHrid: '/items/unpriced',
                currentHrid: '/items/sword1',
                upgradeLevel: 0,
                currentLevel: 0,
            },
            {}
        );

        expect(result.costIsIncomplete).toBe(true);
    });

    test('a cross_slot candidate with one unresolvable added-slot item is marked incomplete', () => {
        mocks.resolveItemPrice.mockImplementation((hrid) =>
            hrid === '/items/unpriced' ? { price: 0, missing: true } : { price: 100, missing: false }
        );

        const result = calculateUpgradeCost(
            {
                type: 'cross_slot',
                currentHrid: '/items/greatsword',
                currentLevel: 0,
                addedSlots: {
                    '/equipment_types/main_hand': { hrid: '/items/unpriced', enhancementLevel: 0 },
                    '/equipment_types/off_hand': { hrid: '/items/buckler', enhancementLevel: 0 },
                },
            },
            {}
        );

        expect(result.costIsIncomplete).toBe(true);
    });

    test('a cross_slot candidate where every price resolves is not marked incomplete', () => {
        mocks.resolveItemPrice.mockReturnValue({ price: 100, missing: false });

        const result = calculateUpgradeCost(
            {
                type: 'cross_slot',
                currentHrid: '/items/greatsword',
                currentLevel: 0,
                addedSlots: {
                    '/equipment_types/main_hand': { hrid: '/items/dagger', enhancementLevel: 0 },
                },
            },
            {}
        );

        expect(result.costIsIncomplete).toBe(false);
    });

    test('a house candidate with an unresolvable material price is marked incomplete', () => {
        mocks.resolveItemPrice.mockImplementation((hrid) =>
            hrid === '/items/unpriced_material' ? { price: 0, missing: true } : { price: 10, missing: false }
        );

        const gameData = {
            houseRoomDetailMap: {
                '/house_rooms/armory': {
                    upgradeCostsMap: {
                        5: [
                            { itemHrid: '/items/coin', count: 1000 },
                            { itemHrid: '/items/unpriced_material', count: 5 },
                        ],
                    },
                },
            },
        };

        const result = calculateUpgradeCost(
            { type: 'house', currentHrid: '/house_rooms/armory', upgradeLevel: 5 },
            gameData
        );

        expect(result.costIsIncomplete).toBe(true);
    });

    test('ability_level and ability_swap candidates are never marked incomplete (book cost has its own zero-fallback contract)', () => {
        const levelResult = calculateUpgradeCost(
            { type: 'ability_level', currentHrid: '/abilities/x', currentLevel: 5, currentXp: 100, upgradeLevel: 10 },
            {}
        );
        const swapResult = calculateUpgradeCost(
            { type: 'ability_swap', upgradeHrid: '/abilities/y', upgradeLevel: 1 },
            {}
        );

        expect(levelResult.costIsIncomplete).toBe(false);
        expect(swapResult.costIsIncomplete).toBe(false);
    });
});
