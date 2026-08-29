/**
 * Tests for calculateGatheringProfit's actionContext option (TLA-027).
 *
 * The Current Action Bar needs to pass its exact live {equipment, drinks} context through to the
 * shared efficiency context builder rather than letting gathering-profit resolve its own
 * live/saved context - otherwise the displayed Profit could use a different context than the
 * action time shown right next to it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const getActionEfficiencyContextMock = vi.fn();
vi.mock('../../utils/efficiency.js', () => ({
    getActionEfficiencyContext: getActionEfficiencyContextMock,
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({
            actionDetailMap: {
                '/actions/foraging/test': {
                    type: '/action_types/foraging',
                    dropTable: [{ itemHrid: '/items/output', minCount: 1, maxCount: 1, dropRate: 1 }],
                },
            },
            itemDetailMap: {},
        })),
    },
}));

vi.mock('../../utils/bonus-revenue-calculator.js', () => ({
    calculateBonusRevenue: vi.fn(() => ({ totalBonusRevenue: 0, hasMissingPrices: false })),
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn(() => null),
}));

vi.mock('../../utils/profit-helpers.js', () => ({
    calculateProfitPerAction: vi.fn(() => 0),
    calculateProfitPerDay: vi.fn(() => 0),
    calculateActionsPerHour: vi.fn(() => 0),
    calculateTeaCostsPerHour: vi.fn(() => ({ totalCostPerHour: 0, costs: [] })),
    createPriceCache: vi.fn((fn) => fn),
}));

const { calculateGatheringProfit } = await import('./gathering-profit.js');

function baseEffCtx() {
    return {
        equipment: new Map(),
        drinkSlots: [],
        drinkConcentration: 0,
        actionTime: 10,
        speedBonus: 0,
        gourmetBonus: 0,
        processingBonus: 0,
        equipmentEfficiency: 0,
        equipmentEfficiencyItems: [],
        houseEfficiency: 0,
        teaEfficiency: 0,
        achievementEfficiency: 0,
        personalEfficiency: 0,
        totalGathering: 0,
        gatheringDetails: {},
        efficiencyBreakdown: { totalEfficiency: 0, levelEfficiency: 0 },
        efficiencyMultiplier: 1,
    };
}

describe('calculateGatheringProfit actionContext passthrough (TLA-027)', () => {
    beforeEach(() => {
        getActionEfficiencyContextMock.mockReset();
        getActionEfficiencyContextMock.mockReturnValue(baseEffCtx());
    });

    test('an explicit actionContext is forwarded to getActionEfficiencyContext as actionContextOverride', async () => {
        const liveContext = { equipment: new Map(), drinks: [] };

        await calculateGatheringProfit('/actions/foraging/test', { actionContext: liveContext });

        expect(getActionEfficiencyContextMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ actionContextOverride: liveContext })
        );
    });

    test('omitting actionContext forwards null (no override) so the predictive live/saved context is used', async () => {
        await calculateGatheringProfit('/actions/foraging/test');

        expect(getActionEfficiencyContextMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ actionContextOverride: null })
        );
    });
});
