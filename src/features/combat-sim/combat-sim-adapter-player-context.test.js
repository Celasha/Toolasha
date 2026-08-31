import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    characterData: null,
    guildBuildingLevelMap: {},
    personalActionTypeBuffsMap: {},
    mooPassBuffs: [],
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getUsableSnapshotByName: vi.fn(() => null),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        get characterData() {
            return mocks.characterData;
        },
        get personalActionTypeBuffsMap() {
            return mocks.personalActionTypeBuffsMap;
        },
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
        getCommunityBuffLevel: vi.fn(() => 0),
        getGuildBuildingLevel: vi.fn((hrid) => mocks.guildBuildingLevelMap[hrid] || 0),
        getMooPassBuffs: vi.fn(() => mocks.mooPassBuffs),
        characterEquipment: undefined,
    },
}));

import { buildPlayerDTO, buildPlayerDTOFromProfile, COMBAT_SHRINE_HRIDS } from './combat-sim-adapter.js';

function baseCharacterData(overrides = {}) {
    return {
        characterSkills: [],
        characterItems: [],
        characterAchievements: [],
        characterBuffs: [],
        ...overrides,
    };
}

describe('buildPlayerDTO - per-player Shrine/MooPass/achievement/personal-buff context (CSIM-AUD-019/021)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.characterData = baseCharacterData();
        mocks.guildBuildingLevelMap = {};
        mocks.personalActionTypeBuffsMap = {};
        mocks.mooPassBuffs = [];
    });

    test('shrineLevels is seeded from live guildBuildingLevelMap for all 5 known shrines, level 0 omitted', () => {
        mocks.guildBuildingLevelMap = {
            '/guild_shrines/spirit': 20,
            '/guild_shrines/force': 0,
        };

        const dto = buildPlayerDTO();

        expect(dto.shrineLevels).toEqual({ '/guild_shrines/spirit': 20 });
        expect(Object.keys(dto.shrineLevels)).not.toContain('/guild_shrines/force');
    });

    test('never carries the old frozen guildCombatBuffs field - Shrine effects are shrineLevels-only', () => {
        const dto = buildPlayerDTO();
        expect(dto.guildCombatBuffs).toBeUndefined();
    });

    test('hasMooPass reflects live getMooPassBuffs()', () => {
        mocks.mooPassBuffs = [{ typeHrid: '/buff_types/wisdom' }];
        expect(buildPlayerDTO().hasMooPass).toBe(true);

        mocks.mooPassBuffs = [];
        expect(buildPlayerDTO().hasMooPass).toBe(false);
    });

    test('characterAchievements is preserved verbatim from live character data', () => {
        mocks.characterData = baseCharacterData({
            characterAchievements: [{ achievementHrid: '/achievements/x', isCompleted: true }],
        });
        expect(buildPlayerDTO().characterAchievements).toEqual([
            { achievementHrid: '/achievements/x', isCompleted: true },
        ]);
    });

    test('personalCombatBuffs stays permanent (remainingDurationNs: null) when there is no expiry evidence', () => {
        mocks.personalActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }],
        };
        mocks.characterData = baseCharacterData({ characterBuffs: [] });

        const dto = buildPlayerDTO();
        expect(dto.personalCombatBuffs.buffs).toHaveLength(1);
        expect(dto.personalCombatBuffs.remainingDurationNs).toBeNull();
    });

    test('personalCombatBuffs models the remaining lifetime from characterBuffs.expiresAt', () => {
        mocks.personalActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }],
        };
        const now = Date.now();
        mocks.characterData = baseCharacterData({
            characterBuffs: [{ hrid: '/personal_buffs/x', expiresAt: new Date(now + 60_000).toISOString() }],
        });

        const dto = buildPlayerDTO();
        expect(dto.personalCombatBuffs.remainingDurationNs).toBeGreaterThan(0);
        expect(dto.personalCombatBuffs.remainingDurationNs).toBeLessThanOrEqual(60_000 * 1e6);
    });

    test('an empty personal combat buff aggregate never fabricates an expiry', () => {
        mocks.personalActionTypeBuffsMap = {};
        const dto = buildPlayerDTO();
        expect(dto.personalCombatBuffs).toEqual({ buffs: [], remainingDurationNs: null });
    });
});

describe('buildPlayerDTOFromProfile (teammate) - never inherits self/Player 1 context (CSIM-AUD-019)', () => {
    test('teammate shrineLevels come from their own shared profile.guildBuffLevelMap, never self', () => {
        const profileData = {
            profile: {
                characterSkills: [],
                guildBuffLevelMap: { '/guild_shrines/scholar': 15 },
                characterAchievements: [{ achievementHrid: '/achievements/teammate_only' }],
                sharableCharacter: { hasMooPass: true },
            },
        };

        const dto = buildPlayerDTOFromProfile(profileData);

        expect(dto.shrineLevels).toEqual({ '/guild_shrines/scholar': 15 });
        expect(dto.hasMooPass).toBe(true);
        expect(dto.characterAchievements).toEqual([{ achievementHrid: '/achievements/teammate_only' }]);
        // Personal/scroll buff lifetime evidence is not present in a shared-profile payload -
        // stays explicitly neutral/unknown, never inherited from self.
        expect(dto.personalCombatBuffs).toEqual({ buffs: [], remainingDurationNs: null });
    });

    test('a teammate with no guild/MooPass/achievement evidence stays neutral, not fabricated from self', () => {
        const profileData = { profile: { characterSkills: [] } };
        const dto = buildPlayerDTOFromProfile(profileData);

        expect(dto.shrineLevels).toEqual({});
        expect(dto.hasMooPass).toBe(false);
        expect(dto.characterAchievements).toEqual([]);
    });

    test('all 5 known shrine hrids are candidates for prefill, unrelated hrids in guildBuffLevelMap are ignored', () => {
        const profileData = {
            profile: {
                characterSkills: [],
                guildBuffLevelMap: { '/guild_shrines/unrelated_hrid': 99, '/guild_shrines/force': 10 },
            },
        };
        const dto = buildPlayerDTOFromProfile(profileData);
        expect(dto.shrineLevels).toEqual({ '/guild_shrines/force': 10 });
        expect(COMBAT_SHRINE_HRIDS).toContain('/guild_shrines/force');
        expect(COMBAT_SHRINE_HRIDS).not.toContain('/guild_shrines/unrelated_hrid');
    });
});
