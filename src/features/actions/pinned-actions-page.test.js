/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => false), getSettingValue: vi.fn((key, fallback) => fallback) },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/data-manager.js', () => ({ default: { getItemDetails: vi.fn(() => ({ itemLevel: 10 })) } }));
vi.mock('../../core/i18n.js', () => ({ t: vi.fn((key) => key) }));
vi.mock('./action-panel-sort.js', () => ({ default: {} }));
vi.mock('./gathering-profit.js', () => ({ calculateGatheringProfit: vi.fn() }));
vi.mock('./production-profit.js', () => ({ calculateProductionProfit: vi.fn() }));
vi.mock('../../utils/experience-calculator.js', () => ({ calculateExpPerHour: vi.fn() }));
vi.mock('../../utils/experience-parser.js', () => ({
    calculateExperienceMultiplier: vi.fn(() => ({ totalMultiplier: 1 })),
}));
vi.mock('../../utils/formatters.js', () => ({ numberFormatter: vi.fn((v) => String(v)) }));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: vi.fn(() => ({ registerInterval: vi.fn(), registerTimeout: vi.fn(), clearAll: vi.fn() })),
}));
vi.mock('../../utils/material-calculator.js', () => ({ calculateMaterialRequirements: vi.fn() }));
vi.mock('../../utils/asset-manifest.js', () => ({ default: {} }));
vi.mock('../../utils/game-i18n.js', () => ({ getActionName: vi.fn((h) => h), getItemName: vi.fn((h) => h) }));
vi.mock('../../utils/action-context.js', () => ({ resolveActionContext: vi.fn() }));
vi.mock('../market/alchemy-profit-calculator.js', () => ({
    default: {
        calculateCoinifyProfit: vi.fn(),
        calculateDecomposeProfit: vi.fn(),
        calculateTransmuteProfit: vi.fn(),
    },
}));

import pinnedActionsPage from './pinned-actions-page.js';
import alchemyProfitCalculator from '../market/alchemy-profit-calculator.js';
import { resolveActionContext } from '../../utils/action-context.js';

describe('PinnedActionsPage._computeAlchemyStats loadout prediction', () => {
    const savedLoadoutContext = { equipment: new Map([['/item_locations/alchemy_tool', {}]]), drinks: [] };
    const profit = { profitPerHour: 1000, successRate: 0.5, actionsPerHour: 100 };

    beforeEach(() => {
        vi.clearAllMocks();
        resolveActionContext.mockReturnValue(savedLoadoutContext);
        alchemyProfitCalculator.calculateCoinifyProfit.mockReturnValue(profit);
        alchemyProfitCalculator.calculateDecomposeProfit.mockReturnValue(profit);
        alchemyProfitCalculator.calculateTransmuteProfit.mockReturnValue(profit);
    });

    test('coinify is calculated with the resolved alchemy action context', () => {
        const stats = pinnedActionsPage._computeAlchemyStats('coinify', '/items/test_item');

        expect(resolveActionContext).toHaveBeenCalledWith('/action_types/alchemy');
        expect(alchemyProfitCalculator.calculateCoinifyProfit).toHaveBeenCalledWith(
            '/items/test_item',
            0,
            false,
            null,
            savedLoadoutContext
        );
        expect(stats.profitPerHour).toBe(1000);
    });

    test('decompose is calculated with the resolved alchemy action context', () => {
        pinnedActionsPage._computeAlchemyStats('decompose', '/items/test_item');

        expect(alchemyProfitCalculator.calculateDecomposeProfit).toHaveBeenCalledWith(
            '/items/test_item',
            0,
            false,
            null,
            savedLoadoutContext
        );
    });

    test('transmute is calculated with the resolved alchemy action context', () => {
        pinnedActionsPage._computeAlchemyStats('transmute', '/items/test_item');

        expect(alchemyProfitCalculator.calculateTransmuteProfit).toHaveBeenCalledWith(
            '/items/test_item',
            false,
            null,
            null,
            savedLoadoutContext
        );
    });
});
