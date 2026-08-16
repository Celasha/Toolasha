import { describe, test, expect, vi } from 'vitest';

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
