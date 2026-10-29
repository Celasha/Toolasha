/**
 * The quick-input panel must size its queue from the same atomic equipment+drinks context the
 * queue display uses, not current gear mixed with saved-loadout drinks.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    calculateActionStats: vi.fn(),
    resolveActionContext: vi.fn(),
    getEquipment: vi.fn(),
    getActionDrinkSlots: vi.fn(),
    getInventory: vi.fn(),
}));

vi.mock('../../utils/action-calculator.js', () => ({ calculateActionStats: mocks.calculateActionStats }));
vi.mock('../../utils/action-context.js', () => ({ resolveActionContext: mocks.resolveActionContext }));
vi.mock('../../core/data-manager.js', () => ({
    default: {
        getEquipment: mocks.getEquipment,
        getSkills: () => [],
        getActionDrinkSlots: mocks.getActionDrinkSlots,
        getInventory: mocks.getInventory,
    },
}));

import { QuickInputButtons } from './quick-input-buttons.js';

const loadoutEquipment = new Map([['/item_locations/back', { itemHrid: '/items/gatherer_cape' }]]);
const loadoutDrinks = [{ itemHrid: '/items/efficiency_tea' }];

describe('QuickInputButtons uses the resolved action context', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getEquipment.mockReturnValue(new Map());
        mocks.getActionDrinkSlots.mockReturnValue([]);
        mocks.getInventory.mockReturnValue([]);
        mocks.resolveActionContext.mockReturnValue({ equipment: loadoutEquipment, drinks: loadoutDrinks });
        mocks.calculateActionStats.mockReturnValue({ actionTime: 10, totalEfficiency: 0 });
    });

    test('calculateActionMetrics passes the resolved context, not current gear', () => {
        const feature = new QuickInputButtons();
        const actionDetails = { hrid: '/actions/foraging/x', type: '/action_types/foraging' };

        feature.calculateActionMetrics(actionDetails, {});

        expect(mocks.resolveActionContext).toHaveBeenCalledWith('/action_types/foraging');
        const options = mocks.calculateActionStats.mock.calls[0][1];
        expect(options.equipment).toBe(loadoutEquipment);
        expect(options.actionContext.drinks).toBe(loadoutDrinks);
        expect(mocks.getEquipment).not.toHaveBeenCalled();
    });

    test('an explicit context is used as given', () => {
        const feature = new QuickInputButtons();
        const context = { equipment: new Map(), drinks: [] };

        feature.calculateActionMetrics({ hrid: '/actions/a', type: '/action_types/foraging' }, {}, context);

        expect(mocks.resolveActionContext).not.toHaveBeenCalled();
        expect(mocks.calculateActionStats.mock.calls[0][1].actionContext).toBe(context);
    });

    test('speed breakdown tea lookup uses the supplied drinks, not current slots', () => {
        const feature = new QuickInputButtons();
        mocks.getActionDrinkSlots.mockReturnValue([{ itemHrid: '/items/enhancing_tea' }]);

        const result = feature.getConsumableSpeed({ type: '/action_types/enhancing' }, new Map(), {}, []);

        expect(result).toEqual([]);
        expect(mocks.getActionDrinkSlots).not.toHaveBeenCalled();
    });
});
