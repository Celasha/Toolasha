/**
 * Tests for tea-optimizer.js's shared-context composition and scenario math (TLA-024).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const FORAGING_TYPE = '/action_types/foraging';

const mocks = vi.hoisted(() => ({
    skills: [{ skillHrid: '/skills/foraging', level: 5 }],
    prices: {},
    personalBuffs: {}, // buffTypeHrid -> decimal flat boost
    guildBuffs: {}, // actionType -> [{typeHrid, flatBoost}]
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
        getCommunityBuffLevel: vi.fn(() => 0),
        getAchievementBuffFlatBoost: vi.fn(() => 0),
        getPersonalBuffFlatBoost: vi.fn((_actionType, buffType) => mocks.personalBuffs[buffType] || 0),
        getMooPassBuffs: vi.fn(() => []),
        get characterData() {
            return { guildActionTypeBuffsMap: mocks.guildBuffs };
        },
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
};

const { calculateSkillPerformance, findOptimalTeas, scoreEquipmentSetup } = await import('./tea-optimizer.js');

describe('tea-optimizer scenario math (TLA-024)', () => {
    beforeEach(() => {
        mocks.skills = [{ skillHrid: '/skills/foraging', level: 5 }];
        mocks.prices = { [GOOD_DROP]: 100, [BAD_DROP]: 0.001 };
        mocks.personalBuffs = {};
        mocks.guildBuffs = {};
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

    test('scoreEquipmentSetup: a fixed cohort of selected actions averages signed scores, including losses', () => {
        const bothSelected = new Set(['/actions/foraging/good', '/actions/foraging/bad']);
        const goodOnly = scoreEquipmentSetup('Foraging', 'gold', new Map(), 5, new Set(['/actions/foraging/good']));
        const both = scoreEquipmentSetup('Foraging', 'gold', new Map(), 5, bothSelected);

        expect(both).toBeLessThan(goodOnly);
        expect(both).toBeGreaterThan(0);
    });

    test('scoreEquipmentSetup: goal=gold for Alchemy never returns an XP value (OPT-22)', () => {
        mocks.skills = [{ skillHrid: '/skills/alchemy', level: 30 }];
        mocks.itemDetailMap['/items/alchemy_item'] = { name: 'Alchemy Item', itemLevel: 10, alchemyDetail: {} };

        const goldScore = scoreEquipmentSetup('Alchemy', 'gold', new Map(), 30);

        expect(goldScore).toBe(0);
    });
});
