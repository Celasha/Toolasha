import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    concentration: 0,
    slots: [],
    inventory: [],
    itemDetailMap: {},
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: () => ({ itemDetailMap: mocks.itemDetailMap }),
        getActionDrinkSlots: () => mocks.slots,
        getInventory: () => mocks.inventory,
    },
}));
vi.mock('./tea-parser.js', () => ({ getDrinkConcentration: () => mocks.concentration }));
vi.mock('./action-context.js', () => ({ resolveActionContext: () => ({ equipment: {} }) }));
vi.mock('./action-calculator.js', () => ({ calculateActionStats: vi.fn() }));
vi.mock('./efficiency.js', () => ({ calculateEfficiencyMultiplier: vi.fn() }));

const { calculateDrinkRemainingSeconds } = await import('./drink-calculator.js');

describe('calculateDrinkRemainingSeconds', () => {
    beforeEach(() => {
        mocks.concentration = 0;
        mocks.itemDetailMap = {
            '/items/artisan_tea': { name: 'Artisan Tea', consumableDetail: { buffs: [{ duration: 300e9 }] } },
        };
        mocks.slots = [{ itemHrid: '/items/artisan_tea', isActive: false, duration: 0 }];
        mocks.inventory = [{ itemHrid: '/items/artisan_tea', count: 253 }];
    });

    test('without concentration each tea lasts its full 300 seconds', () => {
        const [artisan] = calculateDrinkRemainingSeconds('/action_types/crafting');

        expect(artisan.totalSeconds).toBe(253 * 300);
    });

    test('concentration makes each tea last fewer seconds, not more: 300 s becomes about 268 s at +12%', () => {
        mocks.concentration = 0.12;

        const [artisan] = calculateDrinkRemainingSeconds('/action_types/crafting');

        expect(artisan.totalSeconds).toBeCloseTo(253 * (300 / 1.12), 5);
        // 18h 49m, not the 23h 38m the timer used to show
        expect(Math.floor(artisan.totalSeconds / 3600)).toBe(18);
        expect(Math.floor((artisan.totalSeconds % 3600) / 60)).toBe(49);
    });

    test('the activation already running is counted as the server reports it, without scaling', () => {
        mocks.concentration = 0.12;
        mocks.slots = [{ itemHrid: '/items/artisan_tea', isActive: true, duration: 100e9 }];
        mocks.inventory = [{ itemHrid: '/items/artisan_tea', count: 2 }];

        const [artisan] = calculateDrinkRemainingSeconds('/action_types/crafting');

        expect(artisan.totalSeconds).toBeCloseTo(100 + 2 * (300 / 1.12), 5);
    });

    test('a tea in two slots is counted once, and a tea with no listed duration falls back to 5 minutes', () => {
        mocks.itemDetailMap['/items/plain_tea'] = { name: 'Plain Tea' };
        mocks.slots = [
            { itemHrid: '/items/plain_tea', isActive: false, duration: 0 },
            { itemHrid: '/items/plain_tea', isActive: false, duration: 0 },
        ];
        mocks.inventory = [{ itemHrid: '/items/plain_tea', count: 10 }];

        const results = calculateDrinkRemainingSeconds('/action_types/crafting');

        expect(results).toHaveLength(1);
        expect(results[0].totalSeconds).toBe(10 * 300);
    });
});
