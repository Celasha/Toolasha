/**
 * Tests for Combat Zone Bottleneck calculation
 */

import { describe, test, expect } from 'vitest';
import { computeZoneBottleneck } from './task-zone-bottleneck.js';

describe('computeZoneBottleneck', () => {
    test('returns null for an empty zone task list', () => {
        expect(computeZoneBottleneck([], { encounters: 0 }, 1)).toBe(null);
    });

    test('single quest in the zone resolves directly as the bottleneck', () => {
        const zoneTasks = [
            { hrid: '/monsters/slime', name: 'Slime', remaining: 50, killsPerHour: 100, hoursNeeded: 0.5 },
        ];
        const simResult = { encounters: 100 };

        expect(computeZoneBottleneck(zoneTasks, simResult, 1)).toEqual({
            hoursNeeded: 0.5,
            fightsNeeded: 50,
            bottleneckHrid: '/monsters/slime',
            bottleneckName: 'Slime',
        });
    });

    test('picks the quest with the longest remaining time as the bottleneck', () => {
        const zoneTasks = [
            { hrid: '/monsters/slime', name: 'Slime', remaining: 10, killsPerHour: 100, hoursNeeded: 0.1 },
            { hrid: '/monsters/ooze', name: 'Ooze', remaining: 300, killsPerHour: 100, hoursNeeded: 3 },
        ];
        const simResult = { encounters: 200 };

        const result = computeZoneBottleneck(zoneTasks, simResult, 1);
        expect(result.bottleneckHrid).toBe('/monsters/ooze');
        expect(result.hoursNeeded).toBe(3);
        // total fight rate (200/hr) * bottleneck hours (3) = 600 total fights across the zone
        expect(result.fightsNeeded).toBe(600);
    });

    test('boss quest bottleneck uses the sim-derived kill rate as-is (already reflects real spawn cadence)', () => {
        const zoneTasks = [
            { hrid: '/monsters/slime', name: 'Slime', remaining: 50, killsPerHour: 100, hoursNeeded: 0.5 },
            { hrid: '/monsters/boss', name: 'Boss', remaining: 5, killsPerHour: 2, hoursNeeded: 2.5 },
        ];
        const simResult = { encounters: 102 };

        const result = computeZoneBottleneck(zoneTasks, simResult, 1);
        expect(result.bottleneckHrid).toBe('/monsters/boss');
        expect(result.hoursNeeded).toBe(2.5);
        expect(result.fightsNeeded).toBe(255); // 102/hr * 2.5h, rounded
    });

    test('returns Infinity hours/fights when the bottleneck monster is never killed', () => {
        const zoneTasks = [
            { hrid: '/monsters/dragon', name: 'Dragon', remaining: 20, killsPerHour: 0, hoursNeeded: Infinity },
        ];
        const simResult = { encounters: 0 };

        const result = computeZoneBottleneck(zoneTasks, simResult, 1);
        expect(result.hoursNeeded).toBe(Infinity);
        expect(result.fightsNeeded).toBe(Infinity);
    });

    test('divides by simHours to get a per-hour fight rate when the sim ran for more than 1 hour', () => {
        const zoneTasks = [{ hrid: '/monsters/slime', name: 'Slime', remaining: 50, killsPerHour: 50, hoursNeeded: 1 }];
        const simResult = { encounters: 200 }; // 200 encounters over a 2-hour sim = 100/hr

        const result = computeZoneBottleneck(zoneTasks, simResult, 2);
        expect(result.fightsNeeded).toBe(100); // 100/hr * 1h bottleneck
    });

    test('uses true encounter count, not deaths - a wipe (0 kills) still counts as a fight', () => {
        const zoneTasks = [
            { hrid: '/monsters/slime', name: 'Slime', remaining: 10, killsPerHour: 50, hoursNeeded: 0.2 },
        ];
        // 10 kills but 12 encounters (2 wipes with zero kills) - encounters is the true fight count.
        const simResult = { deaths: { '/monsters/slime': 10, player: 2 }, encounters: 12 };

        const result = computeZoneBottleneck(zoneTasks, simResult, 1);
        expect(result.fightsNeeded).toBe(2); // 12/hr * 0.2h, rounded - not inflated by the player-death key
    });
});
