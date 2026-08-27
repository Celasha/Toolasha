import { describe, test, expect, vi, afterEach } from 'vitest';

const BACK_LOCATION = '/item_locations/back';
const REFINED_HRID = '/items/chance_cape_refined';
const NONREFINED_HRID = '/items/chance_cape';

const itemDetailMap = {
    [REFINED_HRID]: {
        name: 'Chance Cape ★',
        equipmentDetail: {
            type: '/equipment_types/back',
            noncombatStats: { skillingSpeed: 0.05 },
            levelRequirements: [],
        },
    },
    [NONREFINED_HRID]: {
        name: 'Chance Cape',
        equipmentDetail: {
            type: '/equipment_types/back',
            noncombatStats: { skillingSpeed: 0.02 },
            levelRequirements: [],
        },
    },
};

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap })),
        getSkills: vi.fn(() => [{ skillHrid: '/skills/crafting', level: 50 }]),
    },
}));

// Refined items keep their per-level XP contribution even when clamped to their effective
// level, so a regression back to scoring at the nominal breakpoint is numerically detectable.
vi.mock('../../utils/tea-optimizer.js', () => ({
    scoreEquipmentSetup: vi.fn((skillName, goal, equipment) => {
        const entry = equipment.get(BACK_LOCATION);
        if (!entry) return 0;
        const isRefined = entry.itemHrid === REFINED_HRID;
        const xpRaw = isRefined ? 100 + 1 * entry.enhancementLevel : 0 + 12 * entry.enhancementLevel;
        return goal === 'xp' ? xpRaw : xpRaw * 2;
    }),
    findOptimalTeas: vi.fn(() => null),
    getSkillActionsForDisplay: vi.fn(),
    calculateSkillPerformance: vi.fn(),
}));

const { optimizeSkill } = await import('./skilling-optimizer-engine.js');
const { scoreEquipmentSetup } = await import('../../utils/tea-optimizer.js');

describe('optimizeSkill - refined item breakpoint labeling', () => {
    test('records the effective scored level separately from the nominal breakpoint bucket', () => {
        const result = optimizeSkill('Crafting', 50, null);
        const progression = result.slots[BACK_LOCATION].progression;

        const byBreakpoint = new Map(progression.map((entry) => [entry.breakpoint, entry]));

        // Below the refined item's real minimum (+10), it still wins on the strength of its
        // higher base stats - but is only ever actually scored at its effective level (+10),
        // not at the nominal bucket shown in `breakpoint`.
        for (const bp of [3, 5, 7]) {
            const entry = byBreakpoint.get(bp);
            expect(entry.itemHrid).toBe(REFINED_HRID);
            expect(entry.breakpoint).toBe(bp);
            expect(entry.enhancementLevel).toBe(10);
        }

        // Once the nominal bucket reaches/exceeds +10, the non-refined item's steeper
        // per-level scaling overtakes the refined item, and no clamping applies to either.
        for (const bp of [10, 12]) {
            const entry = byBreakpoint.get(bp);
            expect(entry.itemHrid).toBe(NONREFINED_HRID);
            expect(entry.breakpoint).toBe(bp);
            expect(entry.enhancementLevel).toBe(bp);
        }
    });

    test('computes the non-primary goal score at the effective level, not the nominal breakpoint', () => {
        const result = optimizeSkill('Crafting', 50, null);
        const progression = result.slots[BACK_LOCATION].progression;
        const entry = progression.find((e) => e.breakpoint === 3);

        // xpScore is the primary goal (Crafting -> 'xp'), computed at the effective level (10):
        // 100 + 1*10 = 110. goldScore must reuse that same effective level, not the nominal
        // bucket (3) - which would have wrongly produced (100 + 1*3) * 2 = 206 instead of 220.
        expect(entry.xpScore).toBe(110);
        expect(entry.goldScore).toBe(220);
    });
});

describe('optimizeSkill - Compare is a one-slot replacement of the full loadout (TLA-024/OPT-1/2/3)', () => {
    const HEAD_LOCATION = '/item_locations/head';
    const OTHER_ITEM_HRID = '/items/other_helm';

    const compareEquipment = new Map([
        [BACK_LOCATION, { itemHrid: NONREFINED_HRID, enhancementLevel: 5 }],
        [HEAD_LOCATION, { itemHrid: OTHER_ITEM_HRID, enhancementLevel: 3 }],
    ]);
    const compareDrinks = ['/items/compare_tea'];

    const originalImpl = scoreEquipmentSetup.getMockImplementation();

    afterEach(() => {
        scoreEquipmentSetup.mockImplementation(originalImpl);
    });

    test('baseline and every candidate score the full loadout equipment + its drinks, only the tested slot replaced', () => {
        const calls = [];
        scoreEquipmentSetup.mockImplementation(
            (skillName, goal, equipment, playerLevel, selectedActionHrids, teaHrids) => {
                calls.push({ equipment: new Map(equipment), teaHrids });
                // Score by total slot count so a call receiving the full loadout differs measurably
                // from one receiving an otherwise-empty/one-item Map.
                return equipment.size * 100 + (equipment.get(BACK_LOCATION)?.enhancementLevel ?? 0);
            }
        );

        const result = optimizeSkill('Crafting', 50, null, { equipment: compareEquipment, drinks: compareDrinks });

        // The baseline call (empty candidate loop hasn't started yet) must see all 2 loadout slots.
        expect(calls[0].equipment.size).toBe(2);
        expect(calls[0].equipment.get(HEAD_LOCATION)?.itemHrid).toBe(OTHER_ITEM_HRID);
        expect(calls[0].teaHrids).toEqual(compareDrinks);

        // Every candidate call for the BACK slot must still carry the untouched HEAD slot from
        // the same loadout - never an otherwise-empty Map with just the candidate in it.
        const backSlotCalls = calls.filter((c) => c.equipment.has(BACK_LOCATION) && c.equipment.size >= 2);
        expect(backSlotCalls.length).toBeGreaterThan(0);
        for (const call of backSlotCalls) {
            expect(call.equipment.get(HEAD_LOCATION)?.itemHrid).toBe(OTHER_ITEM_HRID);
            expect(call.teaHrids).toEqual(compareDrinks);
        }

        expect(result.xpBaseline).toBe(calls[0].equipment.size * 100 + 5);
    });

    test('an intentionally empty compared slot is distinct from no comparison at all', () => {
        scoreEquipmentSetup.mockImplementation((skillName, goal, equipment) => equipment.size * 100);

        // HEAD_LOCATION is intentionally absent from this loadout (an empty slot), never carried
        // over from the default Map() no-comparison baseline used when compareLoadout is null.
        const emptySlotLoadout = new Map([[BACK_LOCATION, { itemHrid: NONREFINED_HRID, enhancementLevel: 1 }]]);
        const withEmptySlot = optimizeSkill('Crafting', 50, null, { equipment: emptySlotLoadout, drinks: [] });
        const withNoComparison = optimizeSkill('Crafting', 50, null, null);

        expect(withEmptySlot.xpBaseline).toBe(100); // one real slot present
        expect(withNoComparison.xpBaseline).toBe(0); // truly empty Map, no comparison at all
    });

    test('without a compareLoadout, baseline/candidates preserve the original empty-Map/no-drinks behavior', () => {
        const calls = [];
        scoreEquipmentSetup.mockImplementation(
            (skillName, goal, equipment, playerLevel, selectedActionHrids, teaHrids) => {
                calls.push({ size: equipment.size, teaHrids });
                return equipment.size;
            }
        );

        optimizeSkill('Crafting', 50, null);

        expect(calls[0].size).toBe(0);
        expect(calls[0].teaHrids).toEqual([]);
    });
});

describe('getRelevantStatsForSkill via getItemsForSlot (TLA-024/OPT-17)', () => {
    test('includes skillingExperience, skill-specific Experience, and drinkConcentration fields', async () => {
        const wisdomCharmHrid = '/items/wisdom_charm_test';
        const skillCharmHrid = '/items/crafting_charm_test';
        const pouchHrid = '/items/guzzling_pouch_test';

        const extendedItemDetailMap = {
            ...itemDetailMap,
            [wisdomCharmHrid]: {
                name: 'Wisdom Charm',
                equipmentDetail: {
                    type: '/equipment_types/charm',
                    noncombatStats: { skillingExperience: 0.1 },
                    levelRequirements: [],
                },
            },
            [skillCharmHrid]: {
                name: 'Crafting Charm',
                equipmentDetail: {
                    type: '/equipment_types/charm',
                    noncombatStats: { craftingExperience: 0.1 },
                    levelRequirements: [],
                },
            },
            [pouchHrid]: {
                name: 'Guzzling Pouch',
                equipmentDetail: {
                    type: '/equipment_types/pouch',
                    noncombatStats: { drinkConcentration: 0.1 },
                    levelRequirements: [],
                },
            },
        };

        vi.doMock('../../core/data-manager.js', () => ({
            default: {
                getInitClientData: vi.fn(() => ({ itemDetailMap: extendedItemDetailMap })),
                getSkills: vi.fn(() => [{ skillHrid: '/skills/crafting', level: 50 }]),
            },
        }));
        vi.resetModules();
        const { getItemsForSlot } = await import('./skilling-optimizer-engine.js');

        const charmItems = getItemsForSlot('/item_locations/charm', 'Crafting').map((i) => i.hrid);
        expect(charmItems).toContain(wisdomCharmHrid);
        expect(charmItems).toContain(skillCharmHrid);

        const pouchItems = getItemsForSlot('/item_locations/pouch', 'Crafting').map((i) => i.hrid);
        expect(pouchItems).toContain(pouchHrid);
    });
});
