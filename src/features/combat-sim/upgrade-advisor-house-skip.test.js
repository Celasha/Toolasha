/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    skipSkillingRooms: true,
    simCalls: [],
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => (key === 'combatSim_upgradeSkipSkillingRooms' ? mocks.skipSkillingRooms : false)),
        getSettingValue: vi.fn((key, fallback) => fallback),
    },
}));

vi.mock('./combat-sim-adapter.js', () => ({
    buildGameDataPayload: vi.fn(() => ({
        houseRoomDetailMap: {
            '/house_rooms/armory': {
                name: 'Armory',
                usableInActionTypeMap: { '/action_types/combat': true },
                upgradeCostsMap: { 1: [] },
            },
            '/house_rooms/garden': {
                name: 'Garden',
                usableInActionTypeMap: { '/action_types/foraging': true },
                upgradeCostsMap: { 1: [] },
            },
        },
    })),
    calculateSimRevenue: vi.fn(() => ({ netPerHour: 0 })),
}));

vi.mock('./combat-sim-runner.js', () => ({
    runSimulation: vi.fn(async ({ playerDTOs }) => {
        mocks.simCalls.push(playerDTOs[0].houseRooms);
        return { experienceGained: { player1: {} }, deaths: {}, encounters: 0, totalDamageDealt: {} };
    }),
    runLabyrinthSimulation: vi.fn(),
    buildExtraBuffs: vi.fn(() => []),
}));

import { runUpgradeAnalysis } from './upgrade-advisor.js';

describe('runUpgradeAnalysis - House Rooms mode skips skilling-only rooms when the setting is on', () => {
    function playerDTOs() {
        return [{ hrid: 'player1', houseRooms: { '/house_rooms/armory': 0, '/house_rooms/garden': 0 } }];
    }

    const baseParams = {
        playerIndex: 0,
        zoneHrid: '/actions/combat/test',
        difficultyTier: 0,
        hours: 1,
        communityBuffs: {},
        upgradeMode: 'house',
    };

    beforeEach(() => {
        mocks.simCalls.length = 0;
    });

    afterEach(() => {
        mocks.skipSkillingRooms = true;
    });

    test('with the setting on, only the combat-relevant room (Armory) is simulated, not Garden', async () => {
        mocks.skipSkillingRooms = true;
        const results = await runUpgradeAnalysis({ ...baseParams, playerDTOs: playerDTOs() });

        expect(results.results).toHaveLength(1);
        expect(results.results[0].candidate.currentHrid).toBe('/house_rooms/armory');
        // 1 baseline sim + 1 candidate sim (Armory only) = 2 total runSimulation calls
        expect(mocks.simCalls).toHaveLength(2);
    });

    test('with the setting off, both rooms are simulated', async () => {
        mocks.skipSkillingRooms = false;
        const results = await runUpgradeAnalysis({ ...baseParams, playerDTOs: playerDTOs() });

        expect(results.results).toHaveLength(2);
        const simulatedHrids = results.results.map((r) => r.candidate.currentHrid).sort();
        expect(simulatedHrids).toEqual(['/house_rooms/armory', '/house_rooms/garden']);
        // 1 baseline sim + 2 candidate sims = 3 total runSimulation calls
        expect(mocks.simCalls).toHaveLength(3);
    });

    test('the setting has no effect on non-house modes', async () => {
        mocks.skipSkillingRooms = true;
        const results = await runUpgradeAnalysis({
            ...baseParams,
            upgradeMode: 'ability_level',
            playerDTOs: [{ hrid: 'player1', houseRooms: {}, abilities: [], equipment: {} }],
        });
        // No ability candidates generated from an empty abilities array - just confirms the mode
        // guard doesn't throw or misbehave outside 'house'.
        expect(results.results).toHaveLength(0);
    });
});
