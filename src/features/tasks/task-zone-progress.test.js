/**
 * Tests for Per-Zone Combat Task Progress aggregation
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const {
    mockGetCombatZoneForMonster,
    mockBuildAllPlayerDTOs,
    mockBuildGameDataPayload,
    mockGetCommunityBuffs,
    mockRunAllZonesSimulation,
} = vi.hoisted(() => ({
    mockGetCombatZoneForMonster: vi.fn(),
    mockBuildAllPlayerDTOs: vi.fn(),
    mockBuildGameDataPayload: vi.fn(),
    mockGetCommunityBuffs: vi.fn(() => ({ mooPass: false, comExp: 0, comDrop: 0 })),
    mockRunAllZonesSimulation: vi.fn(),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        characterQuests: [],
        getCombatZoneForMonster: mockGetCombatZoneForMonster,
    },
}));

vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    buildAllPlayerDTOs: mockBuildAllPlayerDTOs,
    buildGameDataPayload: mockBuildGameDataPayload,
    getCommunityBuffs: mockGetCommunityBuffs,
}));

vi.mock('../combat-sim/all-zones-runner.js', () => ({
    runAllZonesSimulation: mockRunAllZonesSimulation,
}));

vi.mock('../../utils/game-i18n.js', () => ({
    getActionName: (_hrid, fallback) => fallback,
    getMonsterName: (_hrid, fallback) => fallback,
}));

import dataManager from '../../core/data-manager.js';
import { buildZoneSpawnSets, computeAllZoneProgress, findPlanetForMonster } from './task-zone-progress.js';

function quest({ monsterHrid, goalCount = 100, currentCount = 0 }) {
    return {
        category: '/quest_category/random_task',
        status: '/quest_status/in_progress',
        monsterHrid,
        goalCount,
        currentCount,
    };
}

describe('computeAllZoneProgress', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCommunityBuffs.mockReturnValue({ mooPass: false, comExp: 0, comDrop: 0 });
        mockBuildGameDataPayload.mockReturnValue({
            actionDetailMap: {
                '/actions/combat/zone_a': { name: 'Zone A' },
                '/actions/combat/zone_b': { name: 'Zone B' },
            },
            combatMonsterDetailMap: {
                '/monsters/slime': { name: 'Slime' },
                '/monsters/ooze': { name: 'Ooze' },
            },
        });
        mockBuildAllPlayerDTOs.mockResolvedValue({ players: [{ hrid: 'player1' }] });
    });

    test('returns [] without running any simulation when there are no active combat quests', async () => {
        dataManager.characterQuests = [];

        const result = await computeAllZoneProgress();

        expect(result).toEqual([]);
        expect(mockRunAllZonesSimulation).not.toHaveBeenCalled();
    });

    test('skips quests whose monster has no resolvable combat zone', async () => {
        dataManager.characterQuests = [quest({ monsterHrid: '/monsters/unknown' })];
        mockGetCombatZoneForMonster.mockReturnValue(null);

        const result = await computeAllZoneProgress();

        expect(result).toEqual([]);
        expect(mockRunAllZonesSimulation).not.toHaveBeenCalled();
    });

    test('groups quests by zone and computes per-zone bottleneck, sorted soonest-to-clear first', async () => {
        dataManager.characterQuests = [
            quest({ monsterHrid: '/monsters/slime', goalCount: 1000, currentCount: 0 }),
            quest({ monsterHrid: '/monsters/ooze', goalCount: 50, currentCount: 0 }),
        ];
        mockGetCombatZoneForMonster.mockImplementation((hrid) =>
            hrid === '/monsters/slime' ? '/actions/combat/zone_a' : '/actions/combat/zone_b'
        );
        mockRunAllZonesSimulation.mockResolvedValue([
            { deaths: { '/monsters/slime': 100 } }, // zone_a: 1000 remaining / 100 per hr = 10h
            { deaths: { '/monsters/ooze': 100 } }, // zone_b: 50 remaining / 100 per hr = 0.5h
        ]);

        const result = await computeAllZoneProgress();

        expect(mockRunAllZonesSimulation).toHaveBeenCalledWith(
            expect.objectContaining({
                zones: [
                    { zoneHrid: '/actions/combat/zone_a', difficultyTier: 0 },
                    { zoneHrid: '/actions/combat/zone_b', difficultyTier: 0 },
                ],
                hours: 1,
            })
        );

        expect(result).toHaveLength(2);
        // zone_b (0.5h) should sort before zone_a (10h)
        expect(result[0].zoneHrid).toBe('/actions/combat/zone_b');
        expect(result[0].hoursNeeded).toBeCloseTo(0.5);
        expect(result[0].fightsNeeded).toBe(50);
        expect(result[1].zoneHrid).toBe('/actions/combat/zone_a');
        expect(result[1].hoursNeeded).toBeCloseTo(10);
    });

    test('skips a zone whose sim result is missing', async () => {
        dataManager.characterQuests = [quest({ monsterHrid: '/monsters/slime' })];
        mockGetCombatZoneForMonster.mockReturnValue('/actions/combat/zone_a');
        mockRunAllZonesSimulation.mockResolvedValue([null]);

        const result = await computeAllZoneProgress();

        expect(result).toEqual([]);
    });

    test('merges solo-zone quests into their planet row and simulates only the planet', async () => {
        mockBuildGameDataPayload.mockReturnValue({
            actionDetailMap: {
                '/actions/combat/eye_solo_a': {
                    type: '/action_types/combat',
                    combatZoneInfo: {
                        fightInfo: { randomSpawnInfo: { spawns: [{ combatMonsterHrid: '/monsters/cyclops' }] } },
                    },
                },
                '/actions/combat/eye_planet': {
                    type: '/action_types/combat',
                    combatZoneInfo: {
                        fightInfo: {
                            randomSpawnInfo: {
                                spawns: [
                                    { combatMonsterHrid: '/monsters/cyclops' },
                                    { combatMonsterHrid: '/monsters/compound_eye' },
                                ],
                            },
                        },
                    },
                },
            },
            combatMonsterDetailMap: {
                '/monsters/cyclops': { name: 'Cyclops' },
                '/monsters/compound_eye': { name: 'Compound Eye' },
            },
        });
        dataManager.characterQuests = [
            quest({ monsterHrid: '/monsters/cyclops', goalCount: 100 }),
            quest({ monsterHrid: '/monsters/compound_eye', goalCount: 397 }),
        ];
        // 不应再依赖 getCombatZoneForMonster 的任意首匹配
        mockGetCombatZoneForMonster.mockReturnValue('/actions/combat/should_not_be_used');
        mockRunAllZonesSimulation.mockResolvedValue([
            { deaths: { '/monsters/cyclops': 100, '/monsters/compound_eye': 50 } },
        ]);

        const result = await computeAllZoneProgress();

        expect(mockRunAllZonesSimulation).toHaveBeenCalledWith(
            expect.objectContaining({
                zones: [{ zoneHrid: '/actions/combat/eye_planet', difficultyTier: 0 }],
                hours: 1,
            })
        );
        expect(result).toHaveLength(1);
        expect(result[0].zoneHrid).toBe('/actions/combat/eye_planet');
        // 瓶颈：cyclops 100/100 = 1h；compound_eye 397/50 = 7.94h → 后者是瓶颈
        expect(result[0].hoursNeeded).toBeCloseTo(7.94);
        expect(result[0].fightsNeeded).toBe(Math.round(150 * 7.94));
    });
});

describe('planet identification', () => {
    // eye 星球：spawns 含 solo 区域的怪 + 星球专属怪 + boss
    const actionDetailMap = {
        '/actions/combat/eye_solo_a': {
            type: '/action_types/combat',
            combatZoneInfo: {
                fightInfo: { randomSpawnInfo: { spawns: [{ combatMonsterHrid: '/monsters/cyclops' }] } },
            },
        },
        '/actions/combat/eye_solo_b': {
            type: '/action_types/combat',
            combatZoneInfo: {
                fightInfo: { randomSpawnInfo: { spawns: [{ combatMonsterHrid: '/monsters/stacked_eye' }] } },
            },
        },
        '/actions/combat/eye_planet': {
            type: '/action_types/combat',
            combatZoneInfo: {
                fightInfo: {
                    randomSpawnInfo: {
                        spawns: [
                            { combatMonsterHrid: '/monsters/cyclops' },
                            { combatMonsterHrid: '/monsters/stacked_eye' },
                            { combatMonsterHrid: '/monsters/compound_eye' },
                        ],
                    },
                    bossSpawns: [{ combatMonsterHrid: '/monsters/eye_boss' }],
                },
            },
        },
        '/actions/combat/standalone': {
            type: '/action_types/combat',
            combatZoneInfo: {
                fightInfo: { randomSpawnInfo: { spawns: [{ combatMonsterHrid: '/monsters/novice' }] } },
            },
        },
        '/actions/combat/some_dungeon': {
            type: '/action_types/combat',
            combatZoneInfo: {
                isDungeon: true,
                fightInfo: { randomSpawnInfo: { spawns: [{ combatMonsterHrid: '/monsters/cyclops' }] } },
            },
        },
    };

    test('buildZoneSpawnSets collects non-dungeon combat zone monster sets', () => {
        const sets = buildZoneSpawnSets(actionDetailMap);
        expect(sets.get('/actions/combat/eye_solo_a')).toEqual(new Set(['/monsters/cyclops']));
        expect(sets.get('/actions/combat/eye_planet')).toEqual(
            new Set(['/monsters/cyclops', '/monsters/stacked_eye', '/monsters/compound_eye', '/monsters/eye_boss'])
        );
        expect(sets.has('/actions/combat/some_dungeon')).toBe(false);
    });

    test('a zone whose spawn set strictly contains another zone is a planet', () => {
        const sets = buildZoneSpawnSets(actionDetailMap);
        expect(findPlanetForMonster('/monsters/cyclops', sets)).toBe('/actions/combat/eye_planet');
        expect(findPlanetForMonster('/monsters/stacked_eye', sets)).toBe('/actions/combat/eye_planet');
    });

    test('planet-exclusive monsters resolve to the planet itself', () => {
        const sets = buildZoneSpawnSets(actionDetailMap);
        expect(findPlanetForMonster('/monsters/compound_eye', sets)).toBe('/actions/combat/eye_planet');
        expect(findPlanetForMonster('/monsters/eye_boss', sets)).toBe('/actions/combat/eye_planet');
    });

    test('monsters with no containing planet return null (standalone zones keep legacy rows)', () => {
        const sets = buildZoneSpawnSets(actionDetailMap);
        expect(findPlanetForMonster('/monsters/novice', sets)).toBeNull();
        expect(findPlanetForMonster('/monsters/unknown', sets)).toBeNull();
    });

    test('the smallest containing planet wins when planets nest', () => {
        const nested = new Map([
            ['tiny', new Set(['m1'])],
            ['small', new Set(['m1', 'm2'])],
            ['big', new Set(['m1', 'm2', 'm3'])],
        ]);
        // small 与 big 都是星球（严格包含 tiny）；m1 归属最小的星球 small
        expect(findPlanetForMonster('m1', nested)).toBe('small');
    });

    test('equal sets do not make planets of each other', () => {
        const twins = new Map([
            ['twin_a', new Set(['m1'])],
            ['twin_b', new Set(['m1'])],
        ]);
        expect(findPlanetForMonster('m1', twins)).toBeNull();
    });
});
