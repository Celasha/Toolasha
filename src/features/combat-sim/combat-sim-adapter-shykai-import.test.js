import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getUsableSnapshotByName: vi.fn(() => null),
    },
}));

const mockItemDetailMap = {};

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: mockItemDetailMap })),
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

describe('parseShykaiImport - Achievements (TLA044-10/11)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('TLA044-10: slotData.achievements true/false map is normalized into characterAchievements', () => {
        const json = JSON.stringify(
            slotPlayer({
                achievements: {
                    '/achievements/novice_x': true,
                    '/achievements/elite_y': false,
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].characterAchievements).toEqual(
            expect.arrayContaining([
                { achievementHrid: '/achievements/novice_x', isCompleted: true },
                { achievementHrid: '/achievements/elite_y', isCompleted: false },
            ])
        );
    });

    test('TLA044-11: no slotData.achievements field leaves characterAchievements empty, not an error, and never borrows self state', () => {
        const json = JSON.stringify(slotPlayer());

        const result = parseShykaiImport(json);

        expect(result.players[0].characterAchievements).toEqual([]);
    });

    test('multi-slot format: each player keeps their own independent achievement completion', () => {
        const parsed = {
            1: JSON.stringify(slotPlayer({ achievements: { '/achievements/novice_x': true } })),
            2: JSON.stringify(slotPlayer({ achievements: { '/achievements/novice_x': false } })),
        };

        const result = parseShykaiImport(JSON.stringify(parsed));

        expect(result.players[0].characterAchievements).toEqual([
            { achievementHrid: '/achievements/novice_x', isCompleted: true },
        ]);
        expect(result.players[1].characterAchievements).toEqual([
            { achievementHrid: '/achievements/novice_x', isCompleted: false },
        ]);
    });
});

describe('parseShykaiImport - Equipment slot normalization (TLA-045)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mockItemDetailMap)) delete mockItemDetailMap[key];
    });

    test('TLA045-01: raw two-hand location is canonicalized to the item metadata slot', () => {
        mockItemDetailMap['/items/griffin_bulwark_refined'] = {
            equipmentDetail: { type: '/equipment_types/two_hand' },
        };
        const json = JSON.stringify(
            slotPlayer({
                player: {
                    ...slotPlayer().player,
                    equipment: [
                        {
                            itemLocationHrid: '/item_locations/two_hand',
                            itemHrid: '/items/griffin_bulwark_refined',
                            enhancementLevel: 13,
                        },
                    ],
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].equipment['/equipment_types/two_hand']).toEqual({
            hrid: '/items/griffin_bulwark_refined',
            enhancementLevel: 13,
        });
        expect(result.players[0].equipment['/item_locations/two_hand']).toBeUndefined();
    });

    test('TLA045-02: authoritative metadata beats a disagreeing raw location', () => {
        // Deliberately disagreeing fixture: raw location claims off_hand, current item
        // metadata says the item is actually a pouch. The final key must follow metadata,
        // proving this isn't string substitution or raw-key preference.
        mockItemDetailMap['/items/some_pouch'] = {
            equipmentDetail: { type: '/equipment_types/pouch' },
        };
        const json = JSON.stringify(
            slotPlayer({
                player: {
                    ...slotPlayer().player,
                    equipment: [
                        {
                            itemLocationHrid: '/item_locations/off_hand',
                            itemHrid: '/items/some_pouch',
                            enhancementLevel: 0,
                        },
                    ],
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].equipment['/equipment_types/pouch']).toEqual({
            hrid: '/items/some_pouch',
            enhancementLevel: 0,
        });
        expect(result.players[0].equipment['/equipment_types/off_hand']).toBeUndefined();
        expect(result.players[0].equipment['/item_locations/off_hand']).toBeUndefined();
    });

    test('TLA045-04: enhancement level is preserved through normalization', () => {
        mockItemDetailMap['/items/griffin_bulwark_refined'] = {
            equipmentDetail: { type: '/equipment_types/two_hand' },
        };
        const json = JSON.stringify(
            slotPlayer({
                player: {
                    ...slotPlayer().player,
                    equipment: [
                        {
                            itemLocationHrid: '/item_locations/two_hand',
                            itemHrid: '/items/griffin_bulwark_refined',
                            enhancementLevel: 13,
                        },
                    ],
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].equipment['/equipment_types/two_hand'].enhancementLevel).toBe(13);
    });

    test('TLA045-05: canonicalization does not mutate hrid/enhancement or duplicate the item', () => {
        mockItemDetailMap['/items/griffin_bulwark_refined'] = {
            equipmentDetail: { type: '/equipment_types/two_hand' },
        };
        const json = JSON.stringify(
            slotPlayer({
                player: {
                    ...slotPlayer().player,
                    equipment: [
                        {
                            itemLocationHrid: '/item_locations/two_hand',
                            itemHrid: '/items/griffin_bulwark_refined',
                            enhancementLevel: 13,
                        },
                    ],
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(Object.keys(result.players[0].equipment)).toEqual(['/equipment_types/two_hand']);
        expect(result.players[0].equipment['/equipment_types/two_hand'].hrid).toBe('/items/griffin_bulwark_refined');
        expect(result.players[0].equipment['/equipment_types/two_hand'].enhancementLevel).toBe(13);
    });

    test('TLA045-06: generic current equipment-slot coverage across the full canonical slot set', () => {
        const slots = [
            'head',
            'body',
            'legs',
            'feet',
            'hands',
            'main_hand',
            'off_hand',
            'pouch',
            'back',
            'neck',
            'earrings',
            'ring',
            'charm',
        ];
        const equipment = slots.map((slot) => {
            const hrid = `/items/fixture_${slot}`;
            mockItemDetailMap[hrid] = { equipmentDetail: { type: `/equipment_types/${slot}` } };
            return { itemLocationHrid: `/item_locations/${slot}`, itemHrid: hrid, enhancementLevel: 0 };
        });
        const json = JSON.stringify(slotPlayer({ player: { ...slotPlayer().player, equipment } }));

        const result = parseShykaiImport(json);

        for (const slot of slots) {
            expect(result.players[0].equipment[`/equipment_types/${slot}`]).toEqual({
                hrid: `/items/fixture_${slot}`,
                enhancementLevel: 0,
            });
            expect(result.players[0].equipment[`/item_locations/${slot}`]).toBeUndefined();
        }
    });

    test('TLA045-07: unresolved/non-equipment HRID fails closed with a diagnosable warning, no crash', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // No entry in mockItemDetailMap for this hrid - unresolved.
        const json = JSON.stringify(
            slotPlayer({
                player: {
                    ...slotPlayer().player,
                    equipment: [
                        {
                            itemLocationHrid: '/item_locations/two_hand',
                            itemHrid: '/items/unknown_item',
                            enhancementLevel: 5,
                        },
                    ],
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].equipment).toEqual({});
        expect(result.players[0].equipment['/item_locations/two_hand']).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/items/unknown_item'));
        warnSpy.mockRestore();
    });

    test('TLA045-07b: an item resolved but lacking equipmentDetail.type also fails closed', () => {
        mockItemDetailMap['/items/non_equipment_item'] = {};
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const json = JSON.stringify(
            slotPlayer({
                player: {
                    ...slotPlayer().player,
                    equipment: [
                        {
                            itemLocationHrid: '/item_locations/two_hand',
                            itemHrid: '/items/non_equipment_item',
                            enhancementLevel: 0,
                        },
                    ],
                },
            })
        );

        const result = parseShykaiImport(json);

        expect(result.players[0].equipment).toEqual({});
        warnSpy.mockRestore();
    });
});
