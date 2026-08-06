// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockCalculateActionStats, mockCalculateEfficiencyMultiplier, mockCalculateExpPerHour, mockDataManager } =
    vi.hoisted(() => ({
        mockCalculateActionStats: vi.fn(),
        mockCalculateEfficiencyMultiplier: vi.fn(),
        mockCalculateExpPerHour: vi.fn(),
        mockDataManager: {
            getInitClientData: vi.fn(),
            getSkills: vi.fn(),
            getEquipment: vi.fn(),
        },
    }));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(),
        getSettingValue: vi.fn(),
        setSetting: vi.fn(),
        setSettingValue: vi.fn(),
    },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn() } }));
vi.mock('../../core/data-manager.js', () => ({ default: mockDataManager }));
vi.mock('../../core/marketplace-session.js', () => ({
    MARKETPLACE_OWNER: { CRAFTING_PLAN: 'CRAFTING_PLAN' },
    marketplaceSession: { isActive: vi.fn(), end: vi.fn(), start: vi.fn() },
}));
vi.mock('./crafting-plan-calculator.js', () => ({ computeBestCraftingPlan: vi.fn() }));
vi.mock('../../utils/ui-components.js', () => ({ createCollapsibleSection: vi.fn() }));
vi.mock('../../utils/formatters.js', () => ({
    formatKMB: vi.fn((value) => (value === 1700 ? '1.7K' : String(value))),
    formatWithSeparator: vi.fn((value) => String(value)),
    timeReadable: vi.fn((value) => {
        if (value === 133.4) return '0h 02m 13s';
        if (value === 70) return '0h 01m 10s';
        return `${value}s`;
    }),
}));
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn() }));
vi.mock('../../utils/action-panel-helper.js', () => ({ findActionInput: vi.fn() }));
vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: vi.fn(),
    removeMaterialTabsForOwner: vi.fn(),
    getVisibleMarketplaceTabContainer: vi.fn(),
    setupMarketplaceCleanupObserver: vi.fn(),
    navigateToMarketplace: vi.fn(),
    updateTabBadge: vi.fn(),
    watchNativeTabExit: vi.fn(),
    clickMarketplaceNavigationButton: vi.fn(),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(),
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({
    createAutofillManager: vi.fn(() => ({
        initialize: vi.fn(),
        startSession: vi.fn(),
        arm: vi.fn(),
        exitSession: vi.fn(),
        cleanup: vi.fn(),
    })),
}));
vi.mock('../../utils/action-calculator.js', () => ({ calculateActionStats: mockCalculateActionStats }));
vi.mock('../../utils/efficiency.js', () => ({ calculateEfficiencyMultiplier: mockCalculateEfficiencyMultiplier }));
vi.mock('../../utils/experience-calculator.js', () => ({ calculateExpPerHour: mockCalculateExpPerHour }));
vi.mock('../actions/production-tools-layout.js', () => ({ compactActionPanelSection: vi.fn((section) => section) }));

import { calculateCraftingPlanMetrics, formatCraftingPlanSummary } from './crafting-plan-display.js';

const ACTION_HRID = '/actions/cooking/marsberry_cake';

beforeEach(() => {
    vi.clearAllMocks();
    mockDataManager.getInitClientData.mockReturnValue({
        actionDetailMap: { [ACTION_HRID]: { hrid: ACTION_HRID } },
        itemDetailMap: {},
    });
    mockDataManager.getSkills.mockReturnValue(new Map());
    mockDataManager.getEquipment.mockReturnValue(new Map());
    mockCalculateActionStats.mockReturnValue({ actionTime: 5.53, totalEfficiency: 0 });
    mockCalculateEfficiencyMultiplier.mockReturnValue(1);
    mockCalculateExpPerHour.mockReturnValue(null);
});

describe('calculateCraftingPlanMetrics', () => {
    test('sums every step into the same total used by the expanded plan', () => {
        const secondActionHrid = '/actions/tailoring/umbral_chaps';
        mockDataManager.getInitClientData.mockReturnValue({
            actionDetailMap: {
                [ACTION_HRID]: { hrid: ACTION_HRID },
                [secondActionHrid]: { hrid: secondActionHrid },
            },
            itemDetailMap: {},
        });
        mockCalculateActionStats
            .mockReturnValueOnce({ actionTime: 5, totalEfficiency: 0 })
            .mockReturnValueOnce({ actionTime: 20, totalEfficiency: 0 });

        const metrics = calculateCraftingPlanMetrics([
            { itemName: 'Marsberry Cake', actionHrid: ACTION_HRID, actionsNeeded: 2, quantity: 2 },
            { itemName: 'Umbral Chaps', actionHrid: secondActionHrid, actionsNeeded: 3, quantity: 3 },
        ]);

        expect(metrics.totalCraftSeconds).toBe(70);
        expect(metrics.steps.map((step) => step.totalSeconds)).toEqual([10, 60]);
    });
});

describe('formatCraftingPlanSummary', () => {
    test('shows the formatted total time for the full multi-step plan', () => {
        expect(formatCraftingPlanSummary({ strategy: 'craft', unitCost: 1700 }, 133.4)).toBe('1.7K/ea · 2m 13s');
    });

    test('shows cost only when the plan has no craft time', () => {
        expect(formatCraftingPlanSummary({ strategy: 'buy', unitCost: 1700 }, 0)).toBe('1.7K/ea');
    });
});
