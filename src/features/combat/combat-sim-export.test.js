import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    characterData: null,
}));

// Mirrors the real game's guildBuffDetailMap shape - one "_combat" entry per shrine, each
// carrying a shrineHrid grouping field and an isCombat flag.
const GUILD_BUFF_DETAIL_MAP = {
    '/guild_buffs/force_combat': { shrineHrid: '/guild_shrines/force', isCombat: true },
    '/guild_buffs/tempo_combat': { shrineHrid: '/guild_shrines/tempo', isCombat: true },
    '/guild_buffs/spirit_combat': { shrineHrid: '/guild_shrines/spirit', isCombat: true },
    '/guild_buffs/rarity_combat': { shrineHrid: '/guild_shrines/rarity', isCombat: true },
    '/guild_buffs/scholar_combat': { shrineHrid: '/guild_shrines/scholar', isCombat: true },
};

vi.mock('../../core/data-manager.js', () => ({
    default: {
        get characterData() {
            return mocks.characterData;
        },
        get battleData() {
            return null;
        },
        getInitClientData: vi.fn(() => ({
            itemDetailMap: {},
            actionDetailMap: {},
            guildBuffDetailMap: GUILD_BUFF_DETAIL_MAP,
        })),
    },
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        available: false,
        getJSON: vi.fn(),
    },
}));

import { constructExportObject } from './combat-sim-export.js';

function baseCharacter(overrides = {}) {
    return {
        character: { id: 'self-1', name: 'Self' },
        characterSkills: [],
        characterItems: [],
        characterAchievements: [],
        characterActions: [],
        actionTypeFoodSlotsMap: {},
        actionTypeDrinkSlotsMap: {},
        characterHouseRoomMap: {},
        characterGuildBuffMap: {},
        guildBuildingLevelMap: {},
        ...overrides,
    };
}

describe('constructExportObject - Guild Shrine levels (guildCombatBuffLevels)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.characterData = null;
    });

    test('solo export includes guildCombatBuffLevels, clamped to the shrine building unlocked cap', async () => {
        mocks.characterData = baseCharacter({
            characterGuildBuffMap: {
                '/guild_buffs/force_combat': { level: 10 },
                '/guild_buffs/scholar_combat': { level: 3 },
            },
            guildBuildingLevelMap: {
                '/guild_shrines/force': 5, // purchased 10, clamped down to unlocked cap 5
                '/guild_shrines/scholar': 20,
            },
        });

        const result = await constructExportObject(null, true);

        expect(result.exportObj.guildCombatBuffLevels).toEqual({
            force: 5,
            tempo: 0,
            spirit: 0,
            rarity: 0,
            scholar: 3,
        });
    });

    test('a character in no guild (empty maps) exports all-zero guildCombatBuffLevels, not an error', async () => {
        mocks.characterData = baseCharacter();

        const result = await constructExportObject(null, true);

        expect(result.exportObj.guildCombatBuffLevels).toEqual({
            force: 0,
            tempo: 0,
            spirit: 0,
            rarity: 0,
            scholar: 0,
        });
    });

    test('all five shrine keys are always present, even when only one is purchased', async () => {
        mocks.characterData = baseCharacter({
            characterGuildBuffMap: { '/guild_buffs/rarity_combat': { level: 2 } },
            guildBuildingLevelMap: { '/guild_shrines/rarity': 20 },
        });

        const result = await constructExportObject(null, true);

        expect(Object.keys(result.exportObj.guildCombatBuffLevels).sort()).toEqual([
            'force',
            'rarity',
            'scholar',
            'spirit',
            'tempo',
        ]);
        expect(result.exportObj.guildCombatBuffLevels.rarity).toBe(2);
    });
});
