import { describe, expect, test } from 'vitest';
import { calculateExpectedDrops } from '../combat-sim/combat-sim-adapter.js';
import ExpectedLootTracker from './expected-loot-tracker.js';

const GAME_DATA = {
    combatMonsterDetailMap: {
        '/monsters/rat': {
            dropTable: [{ itemHrid: '/items/rat_tail', dropRate: 0.5, minCount: 1, maxCount: 1 }],
            rareDropTable: [{ itemHrid: '/items/rat_whisker', dropRate: 0.01, minCount: 1, maxCount: 1 }],
        },
    },
    actionDetailMap: {},
};

describe('ExpectedLootTracker parity with the real Combat Sim helper (no duplicated formulas)', () => {
    test('produces the exact same expected-drop map as calling calculateExpectedDrops directly with equivalent inputs', () => {
        const tracker = new ExpectedLootTracker();
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat', '/monsters/rat', '/monsters/rat'],
            difficultyTier: 1,
            numberOfPlayers: 2,
            dropRateMultiplier: 1.2,
            rareFindMultiplier: 1.5,
            combatDropQuantity: 0.1,
            debuffOnLevelGap: 0,
        });

        const fromTracker = tracker.getExpectedDrops(GAME_DATA);

        const equivalentSimResult = {
            isDungeon: false,
            deaths: { '/monsters/rat': 3 },
            numberOfPlayers: 2,
            difficultyTier: 1,
            dropRateMultiplier: { player1: 1.2 },
            rareFindMultiplier: { player1: 1.5 },
            combatDropQuantity: { player1: 0.1 },
            debuffOnLevelGap: { player1: 0 },
        };
        const fromDirectCall = calculateExpectedDrops(equivalentSimResult, GAME_DATA, 'player1');

        expect(fromTracker).toEqual(fromDirectCall);
        expect(fromTracker.get('/items/rat_tail')).toBeGreaterThan(0);
    });

    test('rare Find multiplier scales the rare-drop table entry, matching the shared helper exactly', () => {
        const tracker = new ExpectedLootTracker();
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 3,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        const baselineTracker = new ExpectedLootTracker();
        baselineTracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        const rareFindResult = tracker.getExpectedDrops(GAME_DATA).get('/items/rat_whisker');
        const baselineResult = baselineTracker.getExpectedDrops(GAME_DATA).get('/items/rat_whisker');

        expect(rareFindResult).toBeCloseTo(baselineResult * 3, 10);
    });

    test('a modifier change mid-sample never retroactively reprices already-completed encounters', () => {
        const tracker = new ExpectedLootTracker();

        // Encounter 1 completes under one modifier signature (e.g. before a gear/party change).
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

        // Encounter 2 completes under a different modifier signature (Combat Drop Rate changed
        // mid-sample, e.g. a gear swap). A recalculation-with-newest-modifiers bug would run BOTH
        // encounters' deaths through this new modifier instead of only encounter 2's.
        tracker.recordCompletedEncounter({
            zoneHrid: '/actions/combat/rat',
            monsterHrids: ['/monsters/rat', '/monsters/rat', '/monsters/rat'],
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1.5,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        });

        const combined = tracker.getExpectedDrops(GAME_DATA);

        const encounter1Alone = calculateExpectedDrops(
            {
                isDungeon: false,
                deaths: { '/monsters/rat': 2 },
                numberOfPlayers: 1,
                difficultyTier: 0,
                dropRateMultiplier: { player1: 1 },
                rareFindMultiplier: { player1: 1 },
                combatDropQuantity: { player1: 0 },
                debuffOnLevelGap: { player1: 0 },
            },
            GAME_DATA,
            'player1'
        );
        const encounter2Alone = calculateExpectedDrops(
            {
                isDungeon: false,
                deaths: { '/monsters/rat': 3 },
                numberOfPlayers: 1,
                difficultyTier: 0,
                dropRateMultiplier: { player1: 1.5 },
                rareFindMultiplier: { player1: 1 },
                combatDropQuantity: { player1: 0 },
                debuffOnLevelGap: { player1: 0 },
            },
            GAME_DATA,
            'player1'
        );
        const expectedSum =
            (encounter1Alone.get('/items/rat_tail') || 0) + (encounter2Alone.get('/items/rat_tail') || 0);

        expect(combined.get('/items/rat_tail')).toBeCloseTo(expectedSum, 10);

        // The bug this guards against: running all 5 combined deaths through only encounter 2's
        // modifier would NOT equal the correct per-bucket sum computed above.
        const buggyRecalculation = calculateExpectedDrops(
            {
                isDungeon: false,
                deaths: { '/monsters/rat': 5 },
                numberOfPlayers: 1,
                difficultyTier: 0,
                dropRateMultiplier: { player1: 1.5 },
                rareFindMultiplier: { player1: 1 },
                combatDropQuantity: { player1: 0 },
                debuffOnLevelGap: { player1: 0 },
            },
            GAME_DATA,
            'player1'
        );
        expect(combined.get('/items/rat_tail')).not.toBeCloseTo(buggyRecalculation.get('/items/rat_tail'), 5);
    });
});
