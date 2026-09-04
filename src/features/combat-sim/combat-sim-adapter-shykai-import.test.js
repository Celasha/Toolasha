import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getUsableSnapshotByName: vi.fn(() => null),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
    },
}));

import { parseShykaiImport } from './combat-sim-adapter.js';

function slotPlayer(overrides = {}) {
    return {
        player: {
            attackLevel: 50,
            magicLevel: 1,
            meleeLevel: 1,
            rangedLevel: 1,
            defenseLevel: 1,
            staminaLevel: 1,
            intelligenceLevel: 1,
            equipment: [],
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: [],
        triggerMap: {},
        houseRooms: {},
        ...overrides,
    };
}

describe('parseShykaiImport - Guild Shrines (guildCombatBuffLevels)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('single-player format: guildCombatBuffLevels maps short keys to full shrine hrids', () => {
        const json = JSON.stringify(
            slotPlayer({
                guildCombatBuffLevels: { force: 3, tempo: 3, spirit: 1, rarity: 0, scholar: 3 },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].shrineLevels).toEqual({
            '/guild_shrines/force': 3,
            '/guild_shrines/tempo': 3,
            '/guild_shrines/spirit': 1,
            '/guild_shrines/scholar': 3,
        });
    });

    test('a shrine at level 0 is omitted rather than stored as 0', () => {
        const json = JSON.stringify(
            slotPlayer({
                guildCombatBuffLevels: { force: 0, tempo: 0, spirit: 0, rarity: 0, scholar: 0 },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].shrineLevels).toEqual({});
    });

    test('multi-slot format: each player keeps their own independent shrine levels', () => {
        const parsed = {
            1: JSON.stringify(
                slotPlayer({ guildCombatBuffLevels: { force: 5, tempo: 0, spirit: 0, rarity: 0, scholar: 0 } })
            ),
            2: JSON.stringify(
                slotPlayer({ guildCombatBuffLevels: { force: 0, tempo: 0, spirit: 0, rarity: 0, scholar: 8 } })
            ),
        };

        const result = parseShykaiImport(JSON.stringify(parsed));

        expect(result.players[0].shrineLevels).toEqual({ '/guild_shrines/force': 5 });
        expect(result.players[1].shrineLevels).toEqual({ '/guild_shrines/scholar': 8 });
    });

    test('a Shykai export with no guildCombatBuffLevels field at all leaves shrineLevels empty, not an error', () => {
        const json = JSON.stringify(slotPlayer());

        const result = parseShykaiImport(json);

        expect(result.players[0].shrineLevels).toEqual({});
    });

    test('non-finite/negative shrine values are ignored rather than propagated', () => {
        const json = JSON.stringify(
            slotPlayer({
                guildCombatBuffLevels: { force: -1, tempo: null, spirit: 'x', rarity: undefined, scholar: 4 },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].shrineLevels).toEqual({ '/guild_shrines/scholar': 4 });
    });
});
