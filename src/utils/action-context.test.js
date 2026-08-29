import { beforeEach, describe, expect, test, vi } from 'vitest';

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import loadoutState from '../core/loadout-state.js';
import { resolveActionContext, resolveCurrentActionContext } from './action-context.js';

vi.mock('../core/config.js', () => ({
    default: {
        getSetting: vi.fn(),
    },
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getEquipment: vi.fn(),
        getActionDrinkSlots: vi.fn(),
        getInventory: vi.fn(),
    },
}));

vi.mock('../core/loadout-state.js', () => ({
    default: {
        findCalculationSelectionForActionType: vi.fn(),
    },
}));

const TYPE = '/action_types/cooking';
const CURRENT_EQ = new Map([['/item_locations/main_hand', { itemHrid: '/items/current_pan' }]]);
const CURRENT_DRINKS = [{ itemHrid: '/items/current_tea' }];
const SNAPSHOT_EQ = [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/snapshot_pan' }];
const SNAPSHOT_DRINKS = [{ itemHrid: '/items/snapshot_tea' }];

function snapshot(overrides = {}) {
    return {
        name: 'Cooking',
        isDefault: true,
        equipment: SNAPSHOT_EQ,
        drinks: SNAPSHOT_DRINKS,
        ...overrides,
    };
}

describe('resolveActionContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        config.getSetting.mockReturnValue(true);
        dataManager.getEquipment.mockReturnValue(CURRENT_EQ);
        dataManager.getActionDrinkSlots.mockReturnValue(CURRENT_DRINKS);
        dataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/current_tea', count: 5 },
            { itemHrid: '/items/snapshot_tea', count: 3 },
        ]);
    });

    test('resolveCurrentActionContext ignores saved-loadout mode and returns one current equipment+drinks context', () => {
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({ status: 'usable', snapshot: snapshot() });

        const result = resolveCurrentActionContext(TYPE);

        expect(result.equipment).toBe(CURRENT_EQ);
        expect(result.drinks).toEqual(CURRENT_DRINKS);
        expect(result.source).toBe('current');
        expect(result.loadoutSelection).toBeNull();
        expect(loadoutState.findCalculationSelectionForActionType).not.toHaveBeenCalled();
    });

    test('resolveCurrentActionContext stock-validates current drinks without falling through to saved drinks', () => {
        dataManager.getInventory.mockReturnValue([{ itemHrid: '/items/current_tea', count: 0 }]);
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({ status: 'usable', snapshot: snapshot() });

        expect(resolveCurrentActionContext(TYPE).drinks).toEqual([]);
        expect(loadoutState.findCalculationSelectionForActionType).not.toHaveBeenCalled();
    });

    test('uses one canonical resolved snapshot for equipment and drinks', () => {
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({ status: 'usable', snapshot: snapshot() });

        const result = resolveActionContext(TYPE);

        expect(result.equipment).toEqual(new Map([[SNAPSHOT_EQ[0].itemLocationHrid, SNAPSHOT_EQ[0]]]));
        expect(result.drinks).toEqual(SNAPSHOT_DRINKS);
        expect(loadoutState.findCalculationSelectionForActionType).toHaveBeenCalledWith(TYPE);
        // Saved consumables have already been stock-validated by Core LoadoutState.
        expect(dataManager.getInventory).not.toHaveBeenCalled();
    });

    test('falls back to current equipment and drinks only when no matching snapshot exists', () => {
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({ status: 'none', snapshot: null });

        const result = resolveActionContext(TYPE);

        expect(result.equipment).toBe(CURRENT_EQ);
        expect(result.drinks).toEqual(CURRENT_DRINKS);
        expect(dataManager.getEquipment).toHaveBeenCalled();
        expect(dataManager.getActionDrinkSlots).toHaveBeenCalledWith(TYPE);
    });

    test('an intentional empty saved equipment set stays empty instead of inheriting current gear', () => {
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({
            status: 'usable',
            snapshot: snapshot({ equipment: [] }),
        });

        const result = resolveActionContext(TYPE);

        expect(result.equipment).toEqual(new Map());
        expect(dataManager.getEquipment).not.toHaveBeenCalled();
    });

    test('an intentional no-drink saved loadout stays empty instead of inheriting current drinks', () => {
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({
            status: 'usable',
            snapshot: snapshot({ drinks: [] }),
        });

        const result = resolveActionContext(TYPE);

        expect(result.drinks).toEqual([]);
        expect(dataManager.getActionDrinkSlots).not.toHaveBeenCalled();
    });

    test('a slotted drink with an equipped/no-count inventory representation remains available', () => {
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({ status: 'usable', snapshot: snapshot() });
        dataManager.getInventory.mockReturnValue([{ itemHrid: '/items/snapshot_tea' }]);

        expect(resolveActionContext(TYPE).drinks).toEqual(SNAPSHOT_DRINKS);
    });

    test('a matching but unavailable saved loadout fails closed to current state and stays distinguishable from no match', () => {
        const unavailable = snapshot({
            isUsableForCalculation: false,
            hasUnavailableEquipment: true,
            unavailableEquipment: [{ itemHrid: '/items/missing_pan' }],
        });
        loadoutState.findCalculationSelectionForActionType.mockReturnValue({
            status: 'unavailable',
            snapshot: unavailable,
        });

        const result = resolveActionContext(TYPE);

        expect(result.equipment).toBe(CURRENT_EQ);
        expect(result.drinks).toEqual(CURRENT_DRINKS);
        expect(result.source).toBe('current');
        expect(result.loadoutSelection).toEqual({ status: 'unavailable', snapshot: unavailable });
    });

    test('disabling automatic saved-loadout calculations does not query loadout state', () => {
        config.getSetting.mockReturnValue(false);

        const result = resolveActionContext(TYPE);

        expect(loadoutState.findCalculationSelectionForActionType).not.toHaveBeenCalled();
        expect(result.equipment).toBe(CURRENT_EQ);
        expect(result.drinks).toEqual(CURRENT_DRINKS);
    });
});
