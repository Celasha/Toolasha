import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    actions: [],
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentActions: vi.fn(() => mocks.actions),
    },
}));

vi.mock('../../api/marketplace.js', () => ({ default: {} }));
vi.mock('../market/expected-value-calculator.js', () => ({ default: {} }));
vi.mock('../../utils/equipment-parser.js', () => ({
    parseEquipmentSpeedBonuses: vi.fn(() => 0),
    parseEquipmentEfficiencyBonuses: vi.fn(() => 0),
}));
vi.mock('../../utils/tea-parser.js', () => ({
    parseTeaEfficiency: vi.fn(() => 0),
    getDrinkConcentration: vi.fn(() => 0),
    parseTeaSkillLevelBonus: vi.fn(() => 0),
}));
vi.mock('../../utils/efficiency.js', () => ({
    calculateEfficiencyBreakdown: vi.fn(() => ({ totalEfficiency: 0, levelEfficiency: 0 })),
}));
vi.mock('../../utils/profit-helpers.js', () => ({
    calculatePriceAfterTax: vi.fn((value) => value),
}));

const { default: alchemyProfit } = await import('./alchemy-profit.js');

describe('Alchemy current-action subtype resolution', () => {
    beforeEach(() => {
        mocks.actions = [];
    });

    test('uses the front Coinify action instead of a queued Transmute action', () => {
        mocks.actions = [
            { id: 'pirate', ordinal: 0, isDone: false, actionHrid: '/actions/alchemy/coinify' },
            { id: 'moonstone', ordinal: 1, isDone: false, actionHrid: '/actions/alchemy/transmute' },
        ];

        expect(alchemyProfit.getCurrentActionHrid()).toBe('/actions/alchemy/coinify');
    });

    test('uses the front Transmute action instead of a queued Coinify action', () => {
        mocks.actions = [
            { id: 'moonstone', ordinal: 0, isDone: false, actionHrid: '/actions/alchemy/transmute' },
            { id: 'pirate', ordinal: 1, isDone: false, actionHrid: '/actions/alchemy/coinify' },
        ];

        expect(alchemyProfit.getCurrentActionHrid()).toBe('/actions/alchemy/transmute');
    });

    test('does not treat a queued Alchemy action as current while another action is at the front', () => {
        mocks.actions = [
            { id: 'twilight', ordinal: 0, isDone: false, actionHrid: '/actions/combat/twilight_zone' },
            { id: 'moonstone', ordinal: 1, isDone: false, actionHrid: '/actions/alchemy/transmute' },
        ];

        expect(alchemyProfit.getCurrentActionHrid()).toBeNull();
    });
});
