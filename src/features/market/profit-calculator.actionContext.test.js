/**
 * Tests for calculateProfit's actionContext option (TLA-027).
 *
 * The Current Action Bar needs to pass its exact live {equipment, drinks} context through to the
 * shared efficiency context builder rather than letting profit-calculator resolve its own
 * live/saved context - otherwise the displayed Profit could use a different context than the
 * action time shown right next to it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getItemPrice, getItemPriceOutlierInfo } from '../../utils/market-data.js';
import { resolveItemPrice } from '../../utils/profit-helpers.js';

const getActionEfficiencyContextMock = vi.fn();
vi.mock('../../utils/efficiency.js', () => ({
    getActionEfficiencyContext: getActionEfficiencyContextMock,
}));

const ITEM_HRID = '/items/test_output';
const ACTION_HRID = '/actions/cheesesmithing/test';

const dataManagerMock = {
    getItemDetails: vi.fn(() => ({ name: 'Test Item' })),
    getSkills: vi.fn(() => [{ skillHrid: '/skills/cheesesmithing', level: 10 }]),
    getActionDetails: vi.fn(() => ({
        type: '/action_types/cheesesmithing',
        baseTimeCost: 10e9,
        levelRequirement: { level: 1 },
    })),
    getInitClientData: vi.fn(() => ({
        actionDetailMap: {
            [ACTION_HRID]: {
                type: '/action_types/cheesesmithing',
                outputItems: [{ itemHrid: ITEM_HRID, count: 1 }],
            },
        },
        itemDetailMap: {},
        communityBuffTypeDetailMap: {},
    })),
    getCommunityBuffLevel: vi.fn(() => 0),
};
vi.mock('../../core/data-manager.js', () => ({ default: dataManagerMock }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => false), getSettingValue: vi.fn() } }));
vi.mock('../../api/marketplace.js', () => ({ default: { getPrice: vi.fn(() => ({ ask: 0, bid: 0 })) } }));
vi.mock('../../utils/house-efficiency.js', () => ({ calculateHouseEfficiency: vi.fn(() => 0) }));
vi.mock('../../utils/bonus-revenue-calculator.js', () => ({
    calculateBonusRevenue: vi.fn(() => ({ totalBonusRevenue: 0, hasMissingPrices: false })),
}));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({
    getProductionCost: vi.fn(() => 0),
    getProductionChainTime: vi.fn(() => 0),
}));
vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn(() => null),
    getItemPrices: vi.fn(() => null),
    getItemPriceOutlierInfo: vi.fn(() => ({ value: null, isOutlier: false })),
}));
vi.mock('../../utils/profit-helpers.js', () => ({
    calculateActionsPerHour: vi.fn(() => 0),
    calculatePriceAfterTax: vi.fn((p) => p),
    calculateProfitPerAction: vi.fn(() => 0),
    calculateProfitPerDay: vi.fn(() => 0),
    calculateTeaCostsPerHour: vi.fn(() => ({ totalCostPerHour: 0, costs: [], hasOutlierPrices: false })),
    createPriceCache: vi.fn((fn) => fn),
    resolveItemPrice: vi.fn(() => ({ price: 0, isOutlier: false })),
}));

const { default: profitCalculator } = await import('./profit-calculator.js');

function baseEffCtx() {
    return {
        equipment: new Map(),
        drinkSlots: [],
        drinkConcentration: 0,
        itemDetailMap: {},
        actionTime: 10,
        artisanBonus: 0,
        gourmetBonus: 0,
        processingBonus: 0,
        equipmentEfficiency: 0,
        equipmentEfficiencyItems: [],
        houseEfficiency: 0,
        teaEfficiency: 0,
        achievementEfficiency: 0,
        personalEfficiency: 0,
        actionLevelBonus: 0,
        teaSkillLevelBonus: 0,
        baseRequirement: 1,
        speedBonus: 0,
        personalSpeedBonus: 0,
        efficiencyBreakdown: { totalEfficiency: 0, levelEfficiency: 0, effectiveRequirement: 1 },
        efficiencyMultiplier: 1,
    };
}

describe('calculateProfit actionContext passthrough (TLA-027)', () => {
    beforeEach(() => {
        getActionEfficiencyContextMock.mockReset();
        getActionEfficiencyContextMock.mockReturnValue(baseEffCtx());
    });

    test('an explicit actionContext is forwarded to getActionEfficiencyContext as actionContextOverride', async () => {
        const liveContext = { equipment: new Map(), drinks: [] };

        await profitCalculator.calculateProfit(ITEM_HRID, { actionContext: liveContext });

        expect(getActionEfficiencyContextMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ actionContextOverride: liveContext })
        );
    });

    test('omitting actionContext forwards null (no override) so the predictive live/saved context is used', async () => {
        await profitCalculator.calculateProfit(ITEM_HRID);

        expect(getActionEfficiencyContextMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ actionContextOverride: null })
        );
    });
});

describe('calculateProfit outlier flag propagation', () => {
    beforeEach(() => {
        getActionEfficiencyContextMock.mockReset();
        getActionEfficiencyContextMock.mockReturnValue(baseEffCtx());
        getItemPrice.mockReturnValue(100);
        getItemPriceOutlierInfo.mockReturnValue({ value: 100, isOutlier: false });
        resolveItemPrice.mockReturnValue({ price: 10, custom: false, missing: false, isOutlier: false });
    });

    test('flags hasOutlierPrices and outputPriceOutlier when the output price was substituted', async () => {
        getItemPriceOutlierInfo.mockReturnValue({ value: 100, isOutlier: true });

        const result = await profitCalculator.calculateProfit(ITEM_HRID);

        expect(result.outputPriceOutlier).toBe(true);
        expect(result.hasOutlierPrices).toBe(true);
    });

    test('flags hasOutlierPrices when a material price was substituted, independent of the output price', async () => {
        dataManagerMock.getActionDetails.mockReturnValueOnce({
            type: '/action_types/cheesesmithing',
            baseTimeCost: 10e9,
            levelRequirement: { level: 1 },
            inputItems: [{ itemHrid: '/items/material', count: 1 }],
        });
        resolveItemPrice.mockReturnValue({ price: 10, custom: false, missing: false, isOutlier: true });

        const result = await profitCalculator.calculateProfit(ITEM_HRID);

        expect(result.materialCosts[0].isOutlier).toBe(true);
        expect(result.hasOutlierPrices).toBe(true);
    });

    test('does not flag hasOutlierPrices when nothing was substituted', async () => {
        const result = await profitCalculator.calculateProfit(ITEM_HRID);

        expect(result.outputPriceOutlier).toBe(false);
        expect(result.hasOutlierPrices).toBe(false);
    });
});
