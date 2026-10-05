import { describe, test, expect, vi, beforeEach } from 'vitest';

import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import { parseEssenceFindBonus, parseRareFindBonus, parseRareFindBreakdown } from './equipment-parser.js';
import { calculateHouseRareFind } from './house-efficiency.js';
import { getItemPriceOutlierInfo } from './market-data.js';
import { calculateBonusRevenue } from './bonus-revenue-calculator.js';

vi.mock('./market-data.js', () => ({
    getItemPriceOutlierInfo: vi.fn(),
}));

vi.mock('../features/market/expected-value-calculator.js', () => ({
    default: {
        getCachedValue: vi.fn(),
    },
}));

vi.mock('./equipment-parser.js', () => ({
    parseEssenceFindBonus: vi.fn(),
    parseRareFindBonus: vi.fn(),
    parseRareFindBreakdown: vi.fn(),
}));

vi.mock('./house-efficiency.js', () => ({
    calculateHouseRareFind: vi.fn(),
}));

describe('calculateBonusRevenue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parseEssenceFindBonus.mockReturnValue(0);
        parseRareFindBonus.mockReturnValue(0);
        parseRareFindBreakdown.mockReturnValue([]);
        calculateHouseRareFind.mockReturnValue(0);
        getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: false });
        expectedValueCalculator.getCachedValue.mockReturnValue(200);
    });

    test('calculates bonus drops from base actions per hour', () => {
        const actionDetails = {
            type: '/action_types/gathering',
            essenceDropTable: [{ itemHrid: '/items/essence', minCount: 1, maxCount: 3, dropRate: 0.1 }],
            rareDropTable: [{ itemHrid: '/items/cache', minCount: 1, maxCount: 1, dropRate: 0.05 }],
        };
        const itemDetailMap = {
            '/items/essence': { name: 'Essence', isOpenable: false },
            '/items/cache': { name: 'Cache', isOpenable: true },
        };

        const result = calculateBonusRevenue(actionDetails, 100, new Map(), itemDetailMap);

        expect(result.totalBonusRevenue).toBe(2000);
        expect(result.bonusDrops).toHaveLength(2);

        const essenceDrop = result.bonusDrops.find((drop) => drop.itemHrid === '/items/essence');
        expect(essenceDrop.dropsPerHour).toBe(20);
        expect(essenceDrop.revenuePerHour).toBe(1000);

        const rareDrop = result.bonusDrops.find((drop) => drop.itemHrid === '/items/cache');
        expect(rareDrop.dropsPerHour).toBe(5);
        expect(rareDrop.revenuePerHour).toBe(1000);
    });

    test('flags an essence drop as outlier when the bid price was substituted, instead of reading marketAPI.getPrice raw', () => {
        getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: true });
        const actionDetails = {
            type: '/action_types/gathering',
            essenceDropTable: [{ itemHrid: '/items/essence', minCount: 1, maxCount: 3, dropRate: 0.1 }],
        };
        const itemDetailMap = { '/items/essence': { name: 'Essence', isOpenable: false } };

        const result = calculateBonusRevenue(actionDetails, 100, new Map(), itemDetailMap);

        expect(result.bonusDrops[0].isOutlier).toBe(true);
        expect(getItemPriceOutlierInfo).toHaveBeenCalledWith('/items/essence', { mode: 'bid' });
    });

    test('flags a rare find drop as outlier when the bid price was substituted', () => {
        getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: true });
        const actionDetails = {
            type: '/action_types/gathering',
            rareDropTable: [{ itemHrid: '/items/gem', minCount: 1, maxCount: 1, dropRate: 0.05 }],
        };
        const itemDetailMap = { '/items/gem': { name: 'Gem', isOpenable: false } };

        const result = calculateBonusRevenue(actionDetails, 100, new Map(), itemDetailMap);

        expect(result.bonusDrops[0].isOutlier).toBe(true);
    });

    test('does not flag isOutlier when the price is missing entirely', () => {
        getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });
        const actionDetails = {
            type: '/action_types/gathering',
            essenceDropTable: [{ itemHrid: '/items/essence', minCount: 1, maxCount: 3, dropRate: 0.1 }],
        };
        const itemDetailMap = { '/items/essence': { name: 'Essence', isOpenable: false } };

        const result = calculateBonusRevenue(actionDetails, 100, new Map(), itemDetailMap);

        expect(result.bonusDrops[0].missingPrice).toBe(true);
        expect(result.bonusDrops[0].isOutlier).toBe(false);
        expect(result.hasMissingPrices).toBe(true);
    });

    test('openable-container drops (EV-derived) are never flagged as outlier', () => {
        const actionDetails = {
            type: '/action_types/gathering',
            rareDropTable: [{ itemHrid: '/items/cache', minCount: 1, maxCount: 1, dropRate: 0.05 }],
        };
        const itemDetailMap = { '/items/cache': { name: 'Cache', isOpenable: true } };

        const result = calculateBonusRevenue(actionDetails, 100, new Map(), itemDetailMap);

        expect(result.bonusDrops[0].isOutlier).toBe(false);
        expect(getItemPriceOutlierInfo).not.toHaveBeenCalled();
    });
});
