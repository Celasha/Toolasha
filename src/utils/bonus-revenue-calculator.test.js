import { describe, test, expect, vi, beforeEach } from 'vitest';

import marketAPI from '../api/marketplace.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import { parseEssenceFindBonus, parseRareFindBonus } from './equipment-parser.js';
import { calculateHouseRareFind } from './house-efficiency.js';
import { calculateBonusRevenue } from './bonus-revenue-calculator.js';

vi.mock('../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn(),
    },
}));

vi.mock('../features/market/expected-value-calculator.js', () => ({
    default: {
        getCachedValue: vi.fn(),
    },
}));

vi.mock('./equipment-parser.js', () => ({
    parseEssenceFindBonus: vi.fn(),
    parseRareFindBonus: vi.fn(),
}));

vi.mock('./house-efficiency.js', () => ({
    calculateHouseRareFind: vi.fn(),
}));

describe('calculateBonusRevenue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parseEssenceFindBonus.mockReturnValue(0);
        parseRareFindBonus.mockReturnValue(0);
        calculateHouseRareFind.mockReturnValue(0);
        marketAPI.getPrice.mockReturnValue({ bid: 50 });
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
});
