/**
 * Tests for tea-optimizer.js's shared-context composition and scenario math (TLA-024).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const FORAGING_TYPE = '/action_types/foraging';

const mocks = vi.hoisted(() => ({
    skills: [{ skillHrid: '/skills/foraging', level: 5 }],
    prices: {},
    personalBuffs: {}, // buffTypeHrid -> decimal flat boost
    guildBuffs: {}, // actionType -> [{typeHrid, flatBoost}]
    currentActions: [], // character action queue, for resolveActiveAlchemyItemContext
    alchemyProfit: { coinify: null, decompose: null, transmute: null, unrefine: null }, // stubbed profit results
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({
            itemDetailMap: mocks.itemDetailMap,
            actionDetailMap: mocks.actionDetailMap,
        })),
        getSkills: vi.fn(() => mocks.skills),
        getEquipment: vi.fn(() => new Map()),
        getHouseRooms: vi.fn(() => new Map()),
        getHouseRoomLevel: vi.fn(() => 0),
        getCommunityBuffLevel: vi.fn(() => 0),
        getAchievementBuffFlatBoost: vi.fn(() => 0),
        getPersonalBuffFlatBoost: vi.fn((_actionType, buffType) => mocks.personalBuffs[buffType] || 0),
        getMooPassBuffs: vi.fn(() => []),
        getCurrentActions: vi.fn(() => mocks.currentActions),
        get characterData() {
            return { guildActionTypeBuffsMap: mocks.guildBuffs };
        },
    },
}));

vi.mock('../features/market/alchemy-profit-calculator.js', () => ({
    default: {
        calculateCoinifyProfit: vi.fn(() => mocks.alchemyProfit.coinify),
        calculateDecomposeProfit: vi.fn(() => mocks.alchemyProfit.decompose),
        calculateTransmuteProfit: vi.fn(() => mocks.alchemyProfit.transmute),
        calculateUnrefineProfit: vi.fn(() => mocks.alchemyProfit.unrefine),
    },
}));

vi.mock('./market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid) => (itemHrid in mocks.prices ? mocks.prices[itemHrid] : null)),
}));

vi.mock('./bonus-revenue-calculator.js', () => ({
    calculateBonusRevenue: vi.fn(() => ({ totalBonusRevenue: 0, hasMissingPrices: false })),
}));

const GOOD_DROP = '/items/good_drop';
const BAD_DROP = '/items/bad_drop';
const EFFICIENCY_TEA = '/items/efficiency_tea';
const FORAGING_TEA = '/items/foraging_tea';
const LOCKED_ACTION = '/actions/foraging/locked';

mocks.itemDetailMap = {
    [GOOD_DROP]: { name: 'Good Drop' },
    [BAD_DROP]: { name: 'Bad Drop' },
    [EFFICIENCY_TEA]: {
        name: 'Efficiency Tea',
        consumableDetail: { buffs: [{ typeHrid: '/buff_types/efficiency', flatBoost: 0.3 }] },
    },
};

mocks.actionDetailMap = {
    '/actions/foraging/good': {
        type: FORAGING_TYPE,
        name: 'Good Action',
        levelRequirement: { level: 1 },
        baseTimeCost: 10e9,
        dropTable: [{ itemHrid: GOOD_DROP, dropRate: 1, minCount: 1, maxCount: 1 }],
        experienceGain: { value: 10, skillHrid: '/skills/foraging' },
    },
    '/actions/foraging/bad': {
        type: FORAGING_TYPE,
        name: 'Bad Action',
        levelRequirement: { level: 1 },
        baseTimeCost: 10e9,
        dropTable: [{ itemHrid: BAD_DROP, dropRate: 1, minCount: 1, maxCount: 1 }],
        experienceGain: { value: 10, skillHrid: '/skills/foraging' },
    },
    [LOCKED_ACTION]: {
        type: FORAGING_TYPE,
        name: 'Tea-Unlocked Action',
        levelRequirement: { level: 8 },
        baseTimeCost: 10e9,
        dropTable: [{ itemHrid: GOOD_DROP, dropRate: 1, minCount: 1, maxCount: 1 }],
        experienceGain: { value: 100, skillHrid: '/skills/foraging' },
    },
};

const {
    calculateSkillPerformance,
    findOptimalTeas,
    scoreEquipmentSetup,
    getSkillActionsForDisplay,
    resolveActiveAlchemyItemContext,
} = await import('./tea-optimizer.js');
const { default: alchemyProfitCalculator } = await import('../features/market/alchemy-profit-calculator.js');

describe('tea-optimizer scenario math (TLA-024)', () => {
    beforeEach(() => {
        mocks.skills = [{ skillHrid: '/skills/foraging', level: 5 }];
        mocks.prices = { [GOOD_DROP]: 100, [BAD_DROP]: 0.001, [FORAGING_TEA]: 1 };
        mocks.personalBuffs = {};
        mocks.guildBuffs = {};
        mocks.currentActions = [];
        mocks.alchemyProfit = { coinify: null, decompose: null, transmute: null, unrefine: null };
    });

    test('OPT-5/6: Force (guild efficiency) + Tempo (guild speed) + Personal Gathering flow into the local efficiency context', () => {
        const without = calculateSkillPerformance('Foraging', new Map(), [], 5, new Set(['/actions/foraging/good']));

        mocks.guildBuffs = {
            [FORAGING_TYPE]: [
                { typeHrid: '/buff_types/efficiency', flatBoost: 0.5 }, // Force
                { typeHrid: '/buff_types/action_speed', flatBoost: 1.0 }, // Tempo
            ],
        };
        mocks.personalBuffs = { '/buff_types/gathering': 0.5 };

        const withBuffs = calculateSkillPerformance('Foraging', new Map(), [], 5, new Set(['/actions/foraging/good']));

        // Tempo doubles actions/hr, Force adds +50% efficiency on top - both must be reflected.
        expect(withBuffs.xpPerHour).toBeGreaterThan(without.xpPerHour * 2.5);
        expect(withBuffs.goldPerHour).toBeGreaterThan(without.goldPerHour * 2.5);
    });

    test('OPT-8/10: a mixed profitable/unprofitable selected cohort averages over both, signed, never dropping the loss', () => {
        const bothSelected = new Set(['/actions/foraging/good', '/actions/foraging/bad']);
        const goodOnly = calculateSkillPerformance('Foraging', new Map(), [], 5, new Set(['/actions/foraging/good']));
        const both = calculateSkillPerformance('Foraging', new Map(), [], 5, bothSelected);

        // Bad Action's tiny drop value makes it a real loss once market tax is applied; including
        // it must pull the average down from the good-only figure, not leave it unchanged.
        expect(both.goldPerHour).toBeLessThan(goodOnly.goldPerHour);
        expect(both.goldPerHour).toBeGreaterThan(0);
        // Roughly half of Good Action's solo figure (average of a big positive + a tiny negative).
        expect(both.goldPerHour).toBeGreaterThan(goodOnly.goldPerHour * 0.4);
        expect(both.goldPerHour).toBeLessThan(goodOnly.goldPerHour * 0.6);
    });

    test('OPT-12/OPT-19: no-tea can beat every paid tea and win the ranking', () => {
        // Astronomically expensive tea: any real efficiency gain is dwarfed by its own cost.
        mocks.prices[EFFICIENCY_TEA] = 1_000_000;

        const result = findOptimalTeas(
            'Foraging',
            'gold',
            null,
            null,
            null,
            null,
            new Map(),
            new Set(['/actions/foraging/good'])
        );

        expect(result.optimal.teas).toEqual([]);
        expect(result.optimal.avgScore).toBeGreaterThan(0);
    });

    test('OPT-20: an incomplete (missing-price) candidate never wins an exact Gold ranking over a complete one', () => {
        // The tea's price is unresolved (not in the price map at all) - its raw score would look
        // like a big win (tea cost coerced toward 0 internally) but it must not be selectable as
        // the winner while a complete alternative (no tea) exists.
        delete mocks.prices[EFFICIENCY_TEA];

        const result = findOptimalTeas(
            'Foraging',
            'gold',
            null,
            null,
            null,
            null,
            new Map(),
            new Set(['/actions/foraging/good'])
        );

        expect(result.optimal.teas).toEqual([]);
        expect(result.optimal.hasMissingPrice).toBe(false);
        const incompleteCandidate = result.allResults.find((r) => r.teas.length > 0);
        expect(incompleteCandidate?.hasMissingPrice).toBe(true);
    });

    test('OPT-13: an explicit simulated Level override is used instead of silently re-reading the real character level', () => {
        mocks.skills = [{ skillHrid: '/skills/foraging', level: 5 }];

        const result = findOptimalTeas(
            'Foraging',
            'xp',
            null,
            null,
            null,
            null,
            new Map(),
            new Set(['/actions/foraging/good']),
            42
        );

        expect(result.playerLevel).toBe(42);
    });

    describe('REOPEN - tea-unlocked explicitly selected actions', () => {
        // Scoped to this describe only: adding a Foraging skill tea to the shared itemDetailMap
        // would otherwise leak into every other Foraging test in this file (e.g. OPT-12/19/20's
        // "no tea wins" assumptions, which depend on no cheap skill tea being available).
        beforeEach(() => {
            mocks.itemDetailMap[FORAGING_TEA] = {
                name: 'Foraging Tea',
                consumableDetail: { buffs: [{ typeHrid: '/buff_types/foraging_level', flatBoost: 3 }] },
            };
            mocks.prices[FORAGING_TEA] = 1;
        });

        afterEach(() => {
            delete mocks.itemDetailMap[FORAGING_TEA];
        });

        test('REOPEN/OPT-22: an explicitly selected locked action can be evaluated when the tea combo actually unlocks it', () => {
            mocks.skills = [{ skillHrid: '/skills/foraging', level: 5 }];

            const result = findOptimalTeas(
                'Foraging',
                'xp',
                null,
                null,
                null,
                null,
                new Map(),
                new Set([LOCKED_ACTION]),
                5
            );

            // Base level 5 cannot run requirement 8, but Foraging Tea +3 makes the explicit scenario
            // executable. Pre-reopen source fails before combinations are evaluated because
            // getActionsForSkill() removes LOCKED_ACTION at base level.
            expect(result.error).toBeUndefined();
            expect(result.actionsEvaluated).toBe(1);
            expect(result.optimal.teas.map((tea) => tea.hrid)).toContain(FORAGING_TEA);
        });

        test('REOPEN/OPT-23: a non-unlocking tea combination is invalid for an explicitly selected locked action, never silently drops it', () => {
            const result = findOptimalTeas(
                'Foraging',
                'xp',
                null,
                null,
                null,
                null,
                new Map(),
                new Set([LOCKED_ACTION]),
                5
            );

            expect(result.error).toBeUndefined();
            expect(result.allResults.some((candidate) => candidate.teas.length === 0)).toBe(false);
            expect(result.allResults.every((candidate) => candidate.teas.includes('Foraging Tea'))).toBe(true);
        });

        test('REOPEN: a fixed (non-searched) tea combo that fails to unlock a selected locked action scores it as 0, not a reduced-but-nonzero rate', () => {
            // scoreEquipmentSetup/calculateSkillPerformance take a FIXED tea combo (not a search), so
            // a combo that fails to unlock must credit exactly 0 for that action - never the raw
            // formula's reduced efficiency number, which would imply the action ran (just less well)
            // when it actually couldn't run at all.
            const withoutTea = scoreEquipmentSetup('Foraging', 'xp', new Map(), 5, new Set([LOCKED_ACTION]), []);
            expect(withoutTea.score).toBe(0);

            const perf = calculateSkillPerformance('Foraging', new Map(), [], 5, new Set([LOCKED_ACTION]));
            expect(perf.xpPerHour).toBe(0);

            // The same fixed action, unlocked by the right tea, scores normally (nonzero).
            const withTea = scoreEquipmentSetup('Foraging', 'xp', new Map(), 5, new Set([LOCKED_ACTION]), [
                FORAGING_TEA,
            ]);
            expect(withTea.score).toBeGreaterThan(0);
        });
    });

    test('scoreEquipmentSetup: a fixed cohort of selected actions averages signed scores, including losses', () => {
        const bothSelected = new Set(['/actions/foraging/good', '/actions/foraging/bad']);
        const goodOnly = scoreEquipmentSetup('Foraging', 'gold', new Map(), 5, new Set(['/actions/foraging/good']));
        const both = scoreEquipmentSetup('Foraging', 'gold', new Map(), 5, bothSelected);

        expect(both.score).toBeLessThan(goodOnly.score);
        expect(both.score).toBeGreaterThan(0);
    });

    test('scoreEquipmentSetup: goal=gold for Alchemy never returns an XP value (OPT-22)', () => {
        mocks.skills = [{ skillHrid: '/skills/alchemy', level: 30 }];
        mocks.itemDetailMap['/items/alchemy_item'] = { name: 'Alchemy Item', itemLevel: 10, alchemyDetail: {} };

        const goldScore = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30);

        expect(goldScore.score).toBe(0);
    });
});

describe('resolveActiveAlchemyItemContext + item-aware Alchemy Gold/XP scoring', () => {
    const ITEM = '/items/moonstone';

    beforeEach(() => {
        mocks.skills = [{ skillHrid: '/skills/alchemy', level: 30 }];
        mocks.itemDetailMap[ITEM] = {
            name: 'Moonstone',
            itemLevel: 10,
            alchemyDetail: { isCoinifiable: true, transmuteSuccessRate: 0.5 },
            sellPrice: 100,
        };
        mocks.actionDetailMap = {
            '/actions/alchemy/coinify': { type: '/action_types/alchemy', name: 'Coinify', baseTimeCost: 20e9 },
            '/actions/alchemy/decompose': { type: '/action_types/alchemy', name: 'Decompose', baseTimeCost: 20e9 },
            '/actions/alchemy/transmute': { type: '/action_types/alchemy', name: 'Transmute', baseTimeCost: 20e9 },
            '/actions/alchemy/unrefine': { type: '/action_types/alchemy', name: 'Unrefine', baseTimeCost: 20e9 },
        };
        mocks.currentActions = [];
        mocks.alchemyProfit = { coinify: null, decompose: null, transmute: null, unrefine: null };
    });

    test('returns null with an empty action queue', () => {
        expect(resolveActiveAlchemyItemContext()).toBeNull();
    });

    test('returns null when the front-of-queue action is not Alchemy', () => {
        mocks.currentActions = [{ ordinal: 0, actionHrid: '/actions/foraging/good', primaryItemHash: '' }];
        expect(resolveActiveAlchemyItemContext()).toBeNull();
    });

    test('parses actionType/item/enhancement level from the lowest-ordinal (front) queue entry, ignoring later ones', () => {
        mocks.currentActions = [
            {
                ordinal: 1,
                actionHrid: '/actions/alchemy/coinify',
                primaryItemHash: `c::/item_locations/inventory::${ITEM}::0`,
            },
            {
                ordinal: 0,
                actionHrid: '/actions/alchemy/decompose',
                primaryItemHash: `c::/item_locations/inventory::${ITEM}::7`,
            },
        ];

        expect(resolveActiveAlchemyItemContext()).toEqual({
            actionType: 'decompose',
            itemHrid: ITEM,
            enhancementLevel: 7,
        });
    });

    test('scoreEquipmentSetup: Alchemy Gold with a resolved context prices a real item instead of failing closed to 0', () => {
        mocks.alchemyProfit.decompose = { profitPerHour: 500 };
        const context = { actionType: 'decompose', itemHrid: ITEM, enhancementLevel: 0 };

        const result = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30, null, [], context);

        expect(result.score).toBe(500);
        expect(result.hasMissingPrice).toBe(false);
    });

    test('scoreEquipmentSetup: Alchemy Gold without a context still fails closed to 0 (pre-existing behavior preserved)', () => {
        const result = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30);

        expect(result.score).toBe(0);
        expect(result.hasMissingPrice).toBe(false);
    });

    test('scoreEquipmentSetup: Alchemy Gold reports hasMissingPrice when the profit calculator has no price for the item', () => {
        mocks.alchemyProfit.decompose = null; // e.g. no market data for this item
        const context = { actionType: 'decompose', itemHrid: ITEM, enhancementLevel: 0 };

        const result = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30, null, [], context);

        expect(result.score).toBe(0);
        expect(result.hasMissingPrice).toBe(true);
    });

    test('scoreEquipmentSetup: Alchemy XP scores real actionType-specific formula against a resolved context', () => {
        const withContext = scoreEquipmentSetup('Alchemy', 'xp', new Map(), 30, null, [], {
            actionType: 'decompose',
            itemHrid: ITEM,
            enhancementLevel: 0,
        });

        expect(withContext.score).toBeGreaterThan(0);
        expect(withContext.hasMissingPrice).toBe(false);
    });

    test('resolveActiveAlchemyItemContext recognizes Unrefine as a valid 4th action type', () => {
        mocks.currentActions = [
            {
                ordinal: 0,
                actionHrid: '/actions/alchemy/unrefine',
                primaryItemHash: `c::/item_locations/inventory::${ITEM}::12`,
            },
        ];

        expect(resolveActiveAlchemyItemContext()).toEqual({
            actionType: 'unrefine',
            itemHrid: ITEM,
            enhancementLevel: 12,
        });
    });

    test('scoreEquipmentSetup: Alchemy Gold routes Unrefine to calculateUnrefineProfit, not the generic 0 fallback', () => {
        mocks.alchemyProfit.unrefine = { profitPerHour: 750 };
        const context = { actionType: 'unrefine', itemHrid: ITEM, enhancementLevel: 12 };

        const result = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30, null, [], context);

        expect(result.score).toBe(750);
        expect(result.hasMissingPrice).toBe(false);
    });

    test('scoreEquipmentSetup: Alchemy XP for Unrefine uses the same 1.4x formula as Decompose (AlchemyExpMultiplierMap)', () => {
        const unrefine = scoreEquipmentSetup('Alchemy', 'xp', new Map(), 30, null, [], {
            actionType: 'unrefine',
            itemHrid: ITEM,
            enhancementLevel: 0,
        });
        const decompose = scoreEquipmentSetup('Alchemy', 'xp', new Map(), 30, null, [], {
            actionType: 'decompose',
            itemHrid: ITEM,
            enhancementLevel: 0,
        });

        // Both share baseXP = itemLevel*1.4+14, but Unrefine's fixed 100% base success rate
        // (vs Decompose's 60%) means its expected XP per action is strictly higher.
        expect(unrefine.score).toBeGreaterThan(decompose.score);
        expect(unrefine.hasMissingPrice).toBe(false);
    });

    test('scoreEquipmentSetup: Alchemy Gold scores the candidate/baseline equipment actually under test, never falls back to live gear/drinks', () => {
        // Regression: calculateAlchemyGoldPerHour used to call the profit calculator with no
        // actionContext at all, so it silently fell back to dataManager.getEquipment() (the
        // player's LIVE gear) for every candidate - making Gold identical regardless of which
        // item was actually being scored, and double-counting tea cost against whatever the
        // player happens to be drinking live, on top of the caller's own teaCostPerHour deduction.
        mocks.alchemyProfit.decompose = { profitPerHour: 500 };
        alchemyProfitCalculator.calculateDecomposeProfit.mockClear();
        const context = { actionType: 'decompose', itemHrid: ITEM, enhancementLevel: 0 };
        const testedEquipment = new Map([
            ['/item_locations/alchemy_tool', { itemHrid: '/items/holy_alembic', enhancementLevel: 5 }],
        ]);

        scoreEquipmentSetup('Alchemy', 'gold', testedEquipment, 30, null, [], context);

        expect(alchemyProfitCalculator.calculateDecomposeProfit).toHaveBeenCalledTimes(1);
        const [, , , , actionContext] = alchemyProfitCalculator.calculateDecomposeProfit.mock.calls[0];
        expect(actionContext.equipment).toBe(testedEquipment);
        expect(actionContext.drinks).toEqual([]);
    });

    test('scoreEquipmentSetup: Alchemy Gold passes the exact combo being scored as drinks (not empty, not live) so its own efficiency/wisdom contribution is credited, and never double-subtracts tea cost', () => {
        // Regression: passing drinks:[] unconditionally fixed the live-gear/live-drink leak, but
        // also zeroed out the ACTUAL combo's own tea-derived efficiency (e.g. Efficiency Tea)
        // since calculateActionStats reads efficiency straight off actionContext.drinks - every
        // combo was scored as if it had no tea efficiency at all, regardless of which teas it
        // contained, systematically undervaluing efficiency-relevant combos.
        mocks.alchemyProfit.decompose = { profitPerHour: 1000 };
        alchemyProfitCalculator.calculateDecomposeProfit.mockClear();
        const context = { actionType: 'decompose', itemHrid: ITEM, enhancementLevel: 0 };
        const teaHrids = ['/items/efficiency_tea', '/items/catalytic_tea'];

        const result = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30, null, teaHrids, context);

        const [, , , , actionContext] = alchemyProfitCalculator.calculateDecomposeProfit.mock.calls[0];
        expect(actionContext.drinks).toEqual([
            { itemHrid: '/items/efficiency_tea' },
            { itemHrid: '/items/catalytic_tea' },
        ]);
        // The mocked profitPerHour (1000) must be used as-is - never additionally reduced by a
        // second, external teaCostPerHour subtraction, which would double-charge this combo's own
        // tea cost on top of what the underlying calculator already charged via activeDrinks.
        expect(result.score).toBe(1000);
    });
});

describe('REOPEN/OPT-28 architecture: shared getActionEfficiencyContext ownership', () => {
    test('hypothetical scoring routes through getActionEfficiencyContext rather than a second independent global-buff collector', async () => {
        const { readFileSync } = await import('fs');
        const source = readFileSync(new URL('./tea-optimizer.js', import.meta.url), 'utf8');

        expect(source).toContain('getActionEfficiencyContext');
        // The old duplicate collector (its own houseRoomDetailMap loop, its own guildBuffs/personal
        // buff re-derivation) is gone - house/achievement/personal/guild all flow through the one
        // shared function now, not a parallel from-scratch reimplementation.
        expect(source).not.toContain('function getOtherEfficiencySources(');
        expect(source).not.toMatch(/houseRoomDetailMap\?\.\[room\.houseRoomHrid\]/);
    });
});

describe('getSkillActionsForDisplay sort order', () => {
    const MILKING_TYPE = '/action_types/milking';
    const originalActionDetailMap = mocks.actionDetailMap;

    afterEach(() => {
        mocks.actionDetailMap = originalActionDetailMap;
    });

    test('sorts by the game sortIndex rather than level+name, matching the combat zone dropdown convention', () => {
        // Egg/Wheat/Sugar/Cotton/Farmland all share level 1 in the real game data, but the
        // game's own sortIndex order does not match alphabetical - a naive level+name sort would
        // put Cotton before Egg, which is the "unusual" order this is fixing.
        mocks.actionDetailMap = {
            '/actions/milking/cotton': {
                type: MILKING_TYPE,
                name: 'Cotton',
                levelRequirement: { level: 1 },
                sortIndex: 4,
            },
            '/actions/milking/egg': { type: MILKING_TYPE, name: 'Egg', levelRequirement: { level: 1 }, sortIndex: 1 },
            '/actions/milking/farmland': {
                type: MILKING_TYPE,
                name: 'Farmland',
                levelRequirement: { level: 1 },
                sortIndex: 5,
            },
            '/actions/milking/sugar': {
                type: MILKING_TYPE,
                name: 'Sugar',
                levelRequirement: { level: 1 },
                sortIndex: 3,
            },
            '/actions/milking/wheat': {
                type: MILKING_TYPE,
                name: 'Wheat',
                levelRequirement: { level: 1 },
                sortIndex: 2,
            },
        };

        const result = getSkillActionsForDisplay('milking', 1);

        expect(result.map((a) => a.name)).toEqual(['Egg', 'Wheat', 'Sugar', 'Cotton', 'Farmland']);
    });

    test('actions with no sortIndex fall back to name order rather than crashing', () => {
        mocks.actionDetailMap = {
            '/actions/milking/b': { type: MILKING_TYPE, name: 'B Cow', levelRequirement: { level: 1 } },
            '/actions/milking/a': { type: MILKING_TYPE, name: 'A Cow', levelRequirement: { level: 1 } },
        };

        const result = getSkillActionsForDisplay('milking', 1);

        expect(result.map((a) => a.name)).toEqual(['A Cow', 'B Cow']);
    });
});
