/**
 * Tests for calculateExperienceMultiplier's scenario-override support (TLA-024/OPT-4)
 */

import { describe, test, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    liveEquipment: new Map(),
    liveDrinks: [],
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: mocks.itemDetailMap })),
        getHouseRooms: vi.fn(() => new Map()),
        getCommunityBuffLevel: vi.fn(() => 0),
        getAchievementBuffFlatBoost: vi.fn(() => 0),
        getMooPassBuffs: vi.fn(() => []),
        getPersonalBuffFlatBoost: vi.fn(() => 0),
        characterData: {},
    },
}));

vi.mock('./action-context.js', () => ({
    resolveActionContext: vi.fn(() => ({ equipment: mocks.liveEquipment, drinks: mocks.liveDrinks })),
}));

const WISDOM_CHARM = '/items/live_wisdom_charm';
const HYPOTHETICAL_CHARM = '/items/candidate_wisdom_charm';

mocks.itemDetailMap = {
    [WISDOM_CHARM]: {
        name: 'Live Wisdom Charm',
        equipmentDetail: { noncombatStats: { skillingExperience: 0.1, foragingExperience: 0.05 } },
    },
    [HYPOTHETICAL_CHARM]: {
        name: 'Candidate Wisdom Charm',
        equipmentDetail: { noncombatStats: { skillingExperience: 0.3, foragingExperience: 0.2 } },
    },
    '/items/live_tea': {
        name: 'Live Tea',
        consumableDetail: { buffs: [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.5 }] },
    },
};

const { calculateExperienceMultiplier } = await import('./experience-parser.js');

describe('calculateExperienceMultiplier scenario override (TLA-024/OPT-4)', () => {
    test('without an override, resolves equipment/drinks from the live/saved action context', () => {
        mocks.liveEquipment = new Map([['/item_locations/charm', { itemHrid: WISDOM_CHARM, enhancementLevel: 0 }]]);
        mocks.liveDrinks = [{ itemHrid: '/items/live_tea' }];

        const result = calculateExperienceMultiplier('/skills/foraging', '/action_types/foraging');

        expect(result.breakdown.equipmentWisdom).toBeCloseTo(10, 5); // 0.1 * 100
        expect(result.charmExperience).toBeCloseTo(5, 5); // 0.05 * 100
        expect(result.breakdown.consumableWisdom).toBeGreaterThan(0);
    });

    test('with an override, hypothetical candidate equipment/drinks are used instead of the live context', () => {
        // Live context has the live charm + a live tea - a hypothetical calculation must not see either.
        mocks.liveEquipment = new Map([['/item_locations/charm', { itemHrid: WISDOM_CHARM, enhancementLevel: 0 }]]);
        mocks.liveDrinks = [{ itemHrid: '/items/live_tea' }];

        const candidateEquipment = new Map([
            ['/item_locations/charm', { itemHrid: HYPOTHETICAL_CHARM, enhancementLevel: 0 }],
        ]);

        const result = calculateExperienceMultiplier('/skills/foraging', '/action_types/foraging', {
            equipment: candidateEquipment,
            drinks: [],
        });

        // Candidate charm's Wisdom/Charm XP, not the live charm's.
        expect(result.breakdown.equipmentWisdom).toBeCloseTo(30, 5); // 0.3 * 100
        expect(result.charmExperience).toBeCloseTo(20, 5); // 0.2 * 100
        // drinks: [] means no consumable wisdom leaks in from the live tea.
        expect(result.breakdown.consumableWisdom).toBe(0);
    });

    test('an override with no equipment/drinks at all still returns global (house/community/achievement/personal/guild) sources', () => {
        mocks.liveEquipment = new Map([['/item_locations/charm', { itemHrid: WISDOM_CHARM, enhancementLevel: 0 }]]);
        mocks.liveDrinks = [{ itemHrid: '/items/live_tea' }];

        const result = calculateExperienceMultiplier('/skills/foraging', '/action_types/foraging', {});

        expect(result.breakdown.equipmentWisdom).toBe(0);
        expect(result.charmExperience).toBe(0);
        expect(result.breakdown.consumableWisdom).toBe(0);
    });
});
