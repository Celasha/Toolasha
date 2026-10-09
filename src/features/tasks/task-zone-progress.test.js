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
import { computeAllZoneProgress } from './task-zone-progress.js';

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
});
