import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    characterData: null,
    characterGuildBuffMap: {},
    personalActionTypeBuffsMap: {},
    mooPassBuffs: [],
}));

// Mirrors the real game's guildBuffDetailMap shape: one "_combat" and one "_skilling" entry per
// shrine, each carrying a shrineHrid grouping field and an isCombat flag - the same shape
// getCombatGuildBuffHridForShrine() resolves against.
const GUILD_BUFF_DETAIL_MAP = {
    '/guild_buffs/force_combat': { shrineHrid: '/guild_shrines/force', isCombat: true },
    '/guild_buffs/force_skilling': { shrineHrid: '/guild_shrines/force', isCombat: false },
    '/guild_buffs/tempo_combat': { shrineHrid: '/guild_shrines/tempo', isCombat: true },
    '/guild_buffs/tempo_skilling': { shrineHrid: '/guild_shrines/tempo', isCombat: false },
    '/guild_buffs/spirit_combat': { shrineHrid: '/guild_shrines/spirit', isCombat: true },
    '/guild_buffs/spirit_skilling': { shrineHrid: '/guild_shrines/spirit', isCombat: false },
    '/guild_buffs/rarity_combat': { shrineHrid: '/guild_shrines/rarity', isCombat: true },
    '/guild_buffs/rarity_skilling': { shrineHrid: '/guild_shrines/rarity', isCombat: false },
    '/guild_buffs/scholar_combat': { shrineHrid: '/guild_shrines/scholar', isCombat: true },
    '/guild_buffs/scholar_skilling': { shrineHrid: '/guild_shrines/scholar', isCombat: false },
};

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
        getInitClientData: vi.fn(() => ({ itemDetailMap: {}, guildBuffDetailMap: GUILD_BUFF_DETAIL_MAP })),
        getCommunityBuffLevel: vi.fn(() => 0),
        getCharacterGuildBuffLevel: vi.fn((hrid) => mocks.characterGuildBuffMap[hrid] || 0),
        getMooPassBuffs: vi.fn(() => mocks.mooPassBuffs),
        characterEquipment: undefined,
    },
}));

import {
    buildPlayerDTO,
    buildPlayerDTOFromProfile,
    COMBAT_SHRINE_HRIDS,
    getCombatGuildBuffHridForShrine,
} from './combat-sim-adapter.js';

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
        mocks.characterGuildBuffMap = {};
        mocks.personalActionTypeBuffsMap = {};
        mocks.mooPassBuffs = [];
    });

    test('shrineLevels is seeded from the purchased/active combat guild-buff level, not the shrine building cap', () => {
        // Spirit's combat buff is purchased to 20; Force's combat buff is at 0 (never purchased),
        // even though its skilling variant (unrelated buff hrid, not read here) might be nonzero.
        mocks.characterGuildBuffMap = {
            '/guild_buffs/spirit_combat': 20,
            '/guild_buffs/force_combat': 0,
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
    test('teammate shrineLevels come from their own shared profile.guildBuffLevelMap, keyed by combat guild-buff hrid', () => {
        const profileData = {
            profile: {
                characterSkills: [],
                guildBuffLevelMap: { '/guild_buffs/scholar_combat': 15, '/guild_buffs/scholar_skilling': 99 },
                characterAchievements: [{ achievementHrid: '/achievements/teammate_only' }],
                sharableCharacter: { hasMooPass: true },
            },
        };

        const dto = buildPlayerDTOFromProfile(profileData);

        // Only the combat variant feeds combat-sim shrineLevels - the skilling variant (99) at the
        // same shrine must never leak in as if it were the combat level.
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

    test('all 5 known shrines resolve to their own combat guild-buff hrid, unrelated buff hrids are ignored', () => {
        const profileData = {
            profile: {
                characterSkills: [],
                guildBuffLevelMap: { '/guild_buffs/unrelated_hrid': 99, '/guild_buffs/force_combat': 10 },
            },
        };
        const dto = buildPlayerDTOFromProfile(profileData);
        expect(dto.shrineLevels).toEqual({ '/guild_shrines/force': 10 });
        expect(COMBAT_SHRINE_HRIDS).toContain('/guild_shrines/force');
    });

    test('a shrine hrid used directly as a guildBuffLevelMap key (the pre-fix bug shape) is never read', () => {
        // Regression guard: guildBuffLevelMap is keyed by guild-buff hrid, never by shrine hrid -
        // this shape never actually occurs in real payloads and must stay ignored.
        const profileData = {
            profile: {
                characterSkills: [],
                guildBuffLevelMap: { '/guild_shrines/force': 10 },
            },
        };
        const dto = buildPlayerDTOFromProfile(profileData);
        expect(dto.shrineLevels).toEqual({});
    });
});

describe('getCombatGuildBuffHridForShrine', () => {
    test('resolves a shrine hrid to its own combat guild-buff hrid, never the skilling variant', () => {
        expect(getCombatGuildBuffHridForShrine('/guild_shrines/tempo', GUILD_BUFF_DETAIL_MAP)).toBe(
            '/guild_buffs/tempo_combat'
        );
    });

    test('returns null for a shrine with no matching combat buff entry', () => {
        expect(getCombatGuildBuffHridForShrine('/guild_shrines/unknown', GUILD_BUFF_DETAIL_MAP)).toBeNull();
    });

    test('returns null for a missing/empty guildBuffDetailMap rather than throwing', () => {
        expect(getCombatGuildBuffHridForShrine('/guild_shrines/force', {})).toBeNull();
        expect(getCombatGuildBuffHridForShrine('/guild_shrines/force', null)).toBeNull();
        expect(getCombatGuildBuffHridForShrine('/guild_shrines/force', undefined)).toBeNull();
    });
});
