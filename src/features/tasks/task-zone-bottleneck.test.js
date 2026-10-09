/**
 * Tests for Combat Zone Bottleneck calculation
 */

import { describe, test, expect } from 'vitest';
import { computeZoneBottleneck } from './task-zone-bottleneck.js';

describe('computeZoneBottleneck', () => {
    test('returns null for an empty zone task list', () => {
        expect(computeZoneBottleneck([], { deaths: {} })).toBe(null);
    });

    test('single quest in the zone resolves directly as the bottleneck', () => {
        const zoneTasks = [
            { hrid: '/monsters/slime', name: 'Slime', remaining: 50, killsPerHour: 100, hoursNeeded: 0.5 },
        ];
        const simResult = { deaths: { '/monsters/slime': 100 } };

        expect(computeZoneBottleneck(zoneTasks, simResult)).toEqual({
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
        const simResult = { deaths: { '/monsters/slime': 100, '/monsters/ooze': 100 } };

        const result = computeZoneBottleneck(zoneTasks, simResult);
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
        const simResult = { deaths: { '/monsters/slime': 100, '/monsters/boss': 2 } };

        const result = computeZoneBottleneck(zoneTasks, simResult);
        expect(result.bottleneckHrid).toBe('/monsters/boss');
        expect(result.hoursNeeded).toBe(2.5);
        expect(result.fightsNeeded).toBe(255); // 102/hr * 2.5h, rounded
    });

    test('returns Infinity hours/fights when the bottleneck monster is never killed', () => {
        const zoneTasks = [
            { hrid: '/monsters/dragon', name: 'Dragon', remaining: 20, killsPerHour: 0, hoursNeeded: Infinity },
        ];
        const simResult = { deaths: {} };

        const result = computeZoneBottleneck(zoneTasks, simResult);
        expect(result.hoursNeeded).toBe(Infinity);
        expect(result.fightsNeeded).toBe(Infinity);
    });
});
