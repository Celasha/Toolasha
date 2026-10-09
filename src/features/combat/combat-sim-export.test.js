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

import { constructExportObject, constructSelfPlayer, constructPartyPlayer } from './combat-sim-export.js';

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

describe('constructSelfPlayer - equipped ability slot ordering', () => {
    test('orders normal-ability slots by slotNumber, not combatUnit.combatAbilities message order', () => {
        const clientObj = {
            abilityDetailMap: {
                '/abilities/aura': { isSpecialAbility: true },
                '/abilities/a': { isSpecialAbility: false },
                '/abilities/b': { isSpecialAbility: false },
                '/abilities/c': { isSpecialAbility: false },
            },
        };
        const characterObj = baseCharacter({
            // Deliberately out of slot order, as the game is not guaranteed to send
            // combatUnit.combatAbilities pre-sorted.
            combatUnit: {
                combatAbilities: [
                    { abilityHrid: '/abilities/c', level: 3 },
                    { abilityHrid: '/abilities/aura', level: 9 },
                    { abilityHrid: '/abilities/a', level: 1 },
                    { abilityHrid: '/abilities/b', level: 2 },
                ],
            },
            characterAbilities: [
                { abilityHrid: '/abilities/aura', slotNumber: 1 },
                { abilityHrid: '/abilities/a', slotNumber: 2 },
                { abilityHrid: '/abilities/b', slotNumber: 3 },
                { abilityHrid: '/abilities/c', slotNumber: 4 },
            ],
        });

        const result = constructSelfPlayer(characterObj, clientObj);

        expect(result.abilities).toEqual([
            { abilityHrid: '/abilities/aura', level: 9 },
            { abilityHrid: '/abilities/a', level: 1 },
            { abilityHrid: '/abilities/b', level: 2 },
            { abilityHrid: '/abilities/c', level: 3 },
            { abilityHrid: '', level: 1 },
        ]);
    });
});

describe('constructPartyPlayer - equipped ability slot ordering', () => {
    test("orders normal-ability slots by each row's own slotNumber", () => {
        const clientObj = {
            abilityDetailMap: {
                '/abilities/aura': { isSpecialAbility: true },
                '/abilities/a': { isSpecialAbility: false },
                '/abilities/b': { isSpecialAbility: false },
            },
        };
        const profile = {
            characterID: 'party-1',
            profile: {
                characterSkills: [],
                equippedAbilities: [
                    { abilityHrid: '/abilities/b', level: 5, slotNumber: 2 },
                    { abilityHrid: '/abilities/aura', level: 9, slotNumber: 1 },
                    { abilityHrid: '/abilities/a', level: 4, slotNumber: 3 },
                ],
            },
        };

        const result = constructPartyPlayer(profile, clientObj, null);

        expect(result.abilities).toEqual([
            { abilityHrid: '/abilities/aura', level: 9 },
            { abilityHrid: '/abilities/b', level: 5 },
            { abilityHrid: '/abilities/a', level: 4 },
            { abilityHrid: '', level: 1 },
            { abilityHrid: '', level: 1 },
        ]);
    });
});

describe('constructPartyPlayer - drink detection uses categoryHrid, not a nonexistent "type" field', () => {
    test('a drink with no coffee/drinks-path hint in its hrid is still detected via categoryHrid', () => {
        const clientObj = {
            itemDetailMap: {
                '/items/gourmet_tea': { categoryHrid: '/item_categories/drink' },
                '/items/star_fruit_gummy': { categoryHrid: '/item_categories/food' },
            },
        };
        const profile = {
            characterID: 'party-1',
            profile: {
                characterSkills: [],
                consumableCombatTriggersMap: {
                    '/items/gourmet_tea': null,
                    '/items/star_fruit_gummy': null,
                },
            },
        };

        const result = constructPartyPlayer(profile, clientObj, null);

        expect(result.drinks['/action_types/combat'][0]).toEqual({ itemHrid: '/items/gourmet_tea' });
        expect(result.food['/action_types/combat'][0]).toEqual({ itemHrid: '/items/star_fruit_gummy' });
    });
});
