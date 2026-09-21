import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    characterData: null,
    inventory: [],
    itemDetailMap: {},
    mooPassBuffs: [],
    selfEquipment: [],
    selfAbilities: [],
    partyEquipment: [],
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInventory: vi.fn(() => mocks.inventory),
        getMooPassBuffs: vi.fn(() => mocks.mooPassBuffs),
    },
}));

vi.mock('./combat-sim-export.js', () => ({
    getCharacterData: vi.fn(() => mocks.characterData),
    getClientData: vi.fn(() => ({ itemDetailMap: mocks.itemDetailMap })),
    getBattleData: vi.fn(() => null),
    getProfileList: vi.fn(async () => [
        { characterID: 'party-1', characterName: 'Teammate', profile: { characterSkills: mocks.partySkills } },
    ]),
    constructSelfPlayer: vi.fn(() => ({
        player: {
            attackLevel: 100,
            magicLevel: 1,
            meleeLevel: 1,
            rangedLevel: 1,
            defenseLevel: 100,
            staminaLevel: 100,
            intelligenceLevel: 1,
            equipment: mocks.selfEquipment,
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: mocks.selfAbilities,
        triggerMap: {},
        houseRooms: {},
        guildCombatBuffLevels: { force: 0, tempo: 0, spirit: 0, rarity: 0, scholar: 0 },
        achievements: {},
    })),
    constructPartyPlayer: vi.fn(() => ({
        player: {
            attackLevel: 50,
            magicLevel: 1,
            meleeLevel: 1,
            rangedLevel: 1,
            defenseLevel: 50,
            staminaLevel: 50,
            intelligenceLevel: 1,
            equipment: mocks.partyEquipment,
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: [],
        triggerMap: {},
        houseRooms: {},
        guildCombatBuffLevels: { force: 0, tempo: 0, spirit: 0, rarity: 0, scholar: 0 },
        achievements: {},
    })),
}));

import {
    constructMetzCharacterExport,
    constructMetzTeamExport,
    applyLoadoutOverrideToMetzCharacter,
} from './combat-sim-export-metz.js';

const ENHANCER_ITEM = { equipmentDetail: { type: '/equipment_types/enhancing_tool' } };
const SPEED_NECKLACE_ITEM = {
    equipmentDetail: { type: '/equipment_types/neck', noncombatStats: { skillingSpeed: 0.04 } },
};
const COMBAT_BODY_ITEM = { equipmentDetail: { type: '/equipment_types/body' } };

function baseCharacter(overrides = {}) {
    return {
        character: { id: 'self-1', name: 'Self' },
        characterSkills: [],
        characterAbilities: [],
        combatUnit: { combatAbilities: [] },
        partyInfo: { partySlotMap: {} },
        ...overrides,
    };
}

describe('Metz export - skilling/owned blocks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.characterData = null;
        mocks.inventory = [];
        mocks.itemDetailMap = {};
        mocks.mooPassBuffs = [];
        mocks.selfEquipment = [];
        mocks.selfAbilities = [];
        mocks.partyEquipment = [];
        mocks.partySkills = [];
    });

    test('self export moves enhancing/alchemy tools out of player.equipment and into skilling', async () => {
        mocks.characterData = baseCharacter({
            characterSkills: [
                { skillHrid: '/skills/enhancing', level: 42 },
                { skillHrid: '/skills/alchemy', level: 33 },
            ],
        });
        mocks.selfEquipment = [
            { itemLocationHrid: '/item_locations/body', itemHrid: '/items/plate_body', enhancementLevel: 5 },
            {
                itemLocationHrid: '/item_locations/enhancing_tool',
                itemHrid: '/items/celestial_enhancer',
                enhancementLevel: 10,
            },
            {
                itemLocationHrid: '/item_locations/alchemy_tool',
                itemHrid: '/items/celestial_alembic',
                enhancementLevel: 8,
            },
        ];

        const character = await constructMetzCharacterExport();

        expect(character.player.equipment).toEqual([
            { itemLocationHrid: '/item_locations/body', itemHrid: '/items/plate_body', enhancementLevel: 5 },
        ]);
        expect(character.skilling).toEqual({
            enhancingLevel: 42,
            alchemyLevel: 33,
            enhancingTool: { itemHrid: '/items/celestial_enhancer', enhancementLevel: 10 },
            alchemyTool: { itemHrid: '/items/celestial_alembic', enhancementLevel: 8 },
            speedGear: [],
        });
    });

    test('self export finds speed gear anywhere in the full inventory, not just equipped', async () => {
        mocks.characterData = baseCharacter();
        mocks.itemDetailMap = {
            '/items/philosophers_necklace': SPEED_NECKLACE_ITEM,
            '/items/plate_body': COMBAT_BODY_ITEM,
        };
        mocks.inventory = [
            {
                itemHrid: '/items/philosophers_necklace',
                enhancementLevel: 12,
                itemLocationHrid: '/item_locations/inventory',
                count: 1,
            },
            {
                itemHrid: '/items/plate_body',
                enhancementLevel: 0,
                itemLocationHrid: '/item_locations/inventory',
                count: 1,
            },
        ];

        const character = await constructMetzCharacterExport();

        expect(character.skilling.speedGear).toEqual([
            { itemHrid: '/items/philosophers_necklace', enhancementLevel: 12 },
        ]);
    });

    test('self export builds owned block from spare combat gear and unequipped abilities, dropping spare tools', async () => {
        mocks.characterData = baseCharacter({
            characterAbilities: [
                { abilityHrid: '/abilities/equipped_one', level: 90 },
                { abilityHrid: '/abilities/spare_one', level: 50 },
            ],
            combatUnit: { combatAbilities: [{ abilityHrid: '/abilities/equipped_one' }] },
        });
        mocks.itemDetailMap = {
            '/items/spare_cloak': COMBAT_BODY_ITEM,
            '/items/spare_hammer': ENHANCER_ITEM,
        };
        mocks.inventory = [
            {
                itemHrid: '/items/spare_cloak',
                enhancementLevel: 3,
                itemLocationHrid: '/item_locations/inventory',
                count: 2,
            },
            {
                itemHrid: '/items/spare_hammer',
                enhancementLevel: 1,
                itemLocationHrid: '/item_locations/inventory',
                count: 1,
            },
        ];

        const character = await constructMetzCharacterExport();

        expect(character.owned.equipment).toEqual([
            { itemHrid: '/items/spare_cloak', enhancementLevel: 3, count: 2, equipped: false },
        ]);
        expect(character.owned.abilities).toEqual([
            { abilityHrid: '/abilities/spare_one', level: 50, equipped: false },
        ]);
        expect(typeof character.owned.capturedAt).toBe('string');
    });

    test('self export omits skilling and owned entirely when nothing qualifies', async () => {
        mocks.characterData = baseCharacter();

        const character = await constructMetzCharacterExport();

        expect('skilling' in character).toBe(false);
        expect('owned' in character).toBe(false);
    });

    test('party members get best-effort skilling from shared profile skills, but never owned/speedGear', async () => {
        mocks.characterData = baseCharacter({
            partyInfo: { partySlotMap: { a: { characterID: 'party-1' } } },
        });
        mocks.partySkills = [{ skillHrid: '/skills/enhancing', level: 77 }];

        const team = await constructMetzTeamExport();
        const teammate = team.find((p) => p.name === 'Teammate');

        expect(teammate.skilling).toEqual({
            enhancingLevel: 77,
            enhancingTool: null,
            alchemyTool: null,
            speedGear: [],
        });
        expect('owned' in teammate).toBe(false);
        expect('hasMooPass' in teammate).toBe(false);
    });
});

describe('applyLoadoutOverrideToMetzCharacter - skilling stays authoritative from live equipment', () => {
    test('leaves skilling untouched - combat loadouts never carry tools, so live-equipped tools stay authoritative', () => {
        const character = {
            player: { equipment: [] },
            skilling: {
                enhancingLevel: 42,
                alchemyLevel: 33,
                enhancingTool: { itemHrid: '/items/celestial_enhancer', enhancementLevel: 10 },
                alchemyTool: null,
                speedGear: [],
            },
        };

        const overridden = applyLoadoutOverrideToMetzCharacter(character, {
            equipment: [
                { itemLocationHrid: '/item_locations/body', itemHrid: '/items/plate_body', enhancementLevel: 2 },
            ],
            abilities: [],
            triggerMap: {},
            food: [],
            drinks: [],
        });

        expect(overridden.player.equipment).toEqual([
            { itemLocationHrid: '/item_locations/body', itemHrid: '/items/plate_body', enhancementLevel: 2 },
        ]);
        expect(overridden.skilling).toEqual(character.skilling);
    });

    test('still strips a stray tool entry out of the loadout equipment defensively, without touching skilling', () => {
        const character = {
            player: { equipment: [] },
            skilling: {
                enhancingTool: { itemHrid: '/items/celestial_enhancer', enhancementLevel: 10 },
                alchemyTool: null,
                speedGear: [],
            },
        };

        const overridden = applyLoadoutOverrideToMetzCharacter(character, {
            equipment: [
                {
                    itemLocationHrid: '/item_locations/alchemy_tool',
                    itemHrid: '/items/unexpected',
                    enhancementLevel: 3,
                },
            ],
            abilities: [],
            triggerMap: {},
            food: [],
            drinks: [],
        });

        expect(overridden.player.equipment).toEqual([]);
        expect(overridden.skilling).toEqual(character.skilling);
    });

    test('a character with no skilling to begin with stays without one', () => {
        const character = { player: { equipment: [] } };

        const overridden = applyLoadoutOverrideToMetzCharacter(character, {
            equipment: [
                { itemLocationHrid: '/item_locations/body', itemHrid: '/items/plate_body', enhancementLevel: 0 },
            ],
            abilities: [],
            triggerMap: {},
            food: [],
            drinks: [],
        });

        expect('skilling' in overridden).toBe(false);
    });
});
