import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    calculateExpectedDrops: vi.fn(() => new Map([['/items/log', 42]])),
}));

import { calculateExpectedDrops } from '../combat-sim/combat-sim-adapter.js';
import ExpectedLootTracker from './expected-loot-tracker.js';

describe('ExpectedLootTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = new ExpectedLootTracker();
        vi.clearAllMocks();
    });

    test('has no data before any encounter completes', () => {
        expect(tracker.hasData()).toBe(false);
        expect(tracker.getExpectedDrops({})).toEqual(new Map());
    });

    test('accumulates kill counts across multiple completed encounters in the same zone', () => {
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat', '/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        expect(tracker.deaths['/monsters/rat']).toBe(3);
        expect(tracker.getSampleSize()).toBe(2);
        expect(tracker.hasData()).toBe(true);
    });

    test('passes the accumulated deaths map and live multipliers straight through to the shared Combat Sim helper', () => {
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 2,
            numberOfPlayers: 3,
            dropRateMultiplier: 1.5,
            rareFindMultiplier: 2,
            combatDropQuantity: 0.1,
            debuffOnLevelGap: -0.2,
        });

        const gameData = { combatMonsterDetailMap: {}, actionDetailMap: {} };
        tracker.getExpectedDrops(gameData);

        expect(calculateExpectedDrops).toHaveBeenCalledWith(
            expect.objectContaining({
                isDungeon: false,
                zoneName: '/actions/combat/rat',
                deaths: { '/monsters/rat': 1 },
                numberOfPlayers: 3,
                difficultyTier: 2,
                dropRateMultiplier: { player1: 1.5 },
                rareFindMultiplier: { player1: 2 },
                combatDropQuantity: { player1: 0.1 },
                debuffOnLevelGap: { player1: -0.2 },
            }),
            gameData,
            'player1'
        );
    });

    test('a zone change resets accumulated deaths so Actual and Expected never mix samples across zones', () => {
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/alligator',
            monsterHrids: ['/monsters/alligator'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        expect(tracker.deaths['/monsters/rat']).toBeUndefined();
        expect(tracker.deaths['/monsters/alligator']).toBe(1);
        expect(tracker.getSampleSize()).toBe(1);
    });

    test('switching from a regular zone to a dungeon resets accumulated deaths (never per-monster drops inside dungeons)', () => {
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        tracker.recordDungeonCompletion({
            zoneHrid: '/actions/combat/chimerical_den',
            difficultyTier: 2,
            numberOfPlayers: 1,
            combatDropQuantity: 0,
        });

        expect(Object.keys(tracker.deaths)).toHaveLength(0);
        expect(tracker.dungeonsCompleted).toBe(1);
        expect(tracker.isDungeon).toBe(true);
    });

    test('accumulates dungeon completions across multiple runs of the same dungeon', () => {
        tracker.recordDungeonCompletion({
            zoneHrid: '/actions/combat/chimerical_den',
            difficultyTier: 2,
            numberOfPlayers: 1,
            combatDropQuantity: 0,
        });
        tracker.recordDungeonCompletion({
            zoneHrid: '/actions/combat/chimerical_den',
            difficultyTier: 2,
            numberOfPlayers: 1,
            combatDropQuantity: 0,
        });

        expect(tracker.dungeonsCompleted).toBe(2);
        expect(tracker.getSampleSize()).toBe(2);
    });

    test('dungeon completion request builds a simResult with isDungeon true and no deaths map contribution', () => {
        tracker.recordDungeonCompletion({
            zoneHrid: '/actions/combat/chimerical_den',
            difficultyTier: 2,
            numberOfPlayers: 2,
            combatDropQuantity: 0.05,
        });

        tracker.getExpectedDrops({ combatMonsterDetailMap: {}, actionDetailMap: {} });

        expect(calculateExpectedDrops).toHaveBeenCalledWith(
            expect.objectContaining({
                isDungeon: true,
                zoneName: '/actions/combat/chimerical_den',
                dungeonsCompleted: 1,
                numberOfPlayers: 2,
                difficultyTier: 2,
                combatDropQuantity: { player1: 0.05 },
            }),
            expect.anything(),
            'player1'
        );
    });

    test('reset() clears every accumulated field (character switch safety)', () => {
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        tracker.reset();

        expect(tracker.hasData()).toBe(false);
        expect(tracker.deaths).toEqual({});
        expect(tracker.dungeonsCompleted).toBe(0);
        expect(tracker.zoneHrid).toBeNull();
    });
});
