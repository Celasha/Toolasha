/**
 * Tests for Combat Zone Bottleneck calculation
 */

import { describe, test, expect } from 'vitest';
import { binomialAtLeast, computeZoneBottleneck, fightsForQuantile } from './task-zone-bottleneck.js';

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
            percentile: null,
            medianFightsNeeded: null,
            medianHoursNeeded: null,
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

describe('binomialAtLeast', () => {
    test('matches a hand-computed binomial tail', () => {
        expect(binomialAtLeast(10, 0.5, 5)).toBeCloseTo(0.623046875, 9);
    });

    test('is 1 when no kills are needed and 0 when more kills are needed than fights', () => {
        expect(binomialAtLeast(10, 0.5, 0)).toBe(1);
        expect(binomialAtLeast(3, 0.5, 4)).toBe(0);
    });
});

describe('fightsForQuantile', () => {
    // Reference values cross-checked against exact binomial arithmetic: for K=27, q=0.053,
    // P(X>=27) is 0.4965 at n=502 / 0.5007 at n=503 and 0.8993 at n=634 / 0.9009 at n=635.
    test('finds the smallest fight count reaching the requested coverage', () => {
        expect(fightsForQuantile(27, 0.053, 0.5)).toBe(503);
        expect(fightsForQuantile(27, 0.053, 0.9)).toBe(635);
    });

    test('higher coverage never needs fewer fights', () => {
        const p80 = fightsForQuantile(27, 0.053, 0.8);
        const p90 = fightsForQuantile(27, 0.053, 0.9);
        const p95 = fightsForQuantile(27, 0.053, 0.95);
        expect(p80).toBeLessThan(p90);
        expect(p90).toBeLessThan(p95);
    });

    test('single kill needed: 1 - (1-q)^n crosses the target', () => {
        expect(fightsForQuantile(1, 0.5, 0.9)).toBe(4); // 0.875 at n=3, 0.9375 at n=4
    });

    test('is null when the binomial model does not apply (q <= 0 or q >= 1)', () => {
        expect(fightsForQuantile(5, 0, 0.9)).toBeNull();
        expect(fightsForQuantile(5, 1, 0.9)).toBeNull();
        expect(fightsForQuantile(5, 1.4, 0.9)).toBeNull();
    });
});

describe('computeZoneBottleneck percentile reporting', () => {
    // 27 kills still needed at 5.3 kills per 100 fights, 2h sim: 1000 fights/hr overall.
    const zoneTasks = [{ hrid: '/monsters/rare', name: 'Rare', remaining: 27, killsPerHour: 53, hoursNeeded: 27 / 53 }];
    const simResult = { encounters: 2000 };

    test('reports the requested percentile for fights and derives time from the same quantile', () => {
        const result = computeZoneBottleneck(zoneTasks, simResult, 2, 0.9);
        expect(result.percentile).toBe(0.9);
        expect(result.fightsNeeded).toBe(635);
        expect(result.hoursNeeded).toBeCloseTo(635 / 1000);
    });

    test('always carries the median alongside, from the same model', () => {
        const result = computeZoneBottleneck(zoneTasks, simResult, 2, 0.9);
        expect(result.medianFightsNeeded).toBe(503);
        expect(result.medianHoursNeeded).toBeCloseTo(503 / 1000);
    });

    test('selecting the median makes the main figure the median', () => {
        const result = computeZoneBottleneck(zoneTasks, simResult, 2, 0.5);
        expect(result.percentile).toBe(0.5);
        expect(result.fightsNeeded).toBe(result.medianFightsNeeded);
    });

    test('no percentile requested keeps the mean-based estimate', () => {
        const result = computeZoneBottleneck(zoneTasks, simResult, 2);
        expect(result.percentile).toBeNull();
        expect(result.fightsNeeded).toBe(Math.round(1000 * (27 / 53)));
        expect(result.hoursNeeded).toBeCloseTo(27 / 53);
    });

    test('falls back to the mean-based estimate when the monster averages one or more kills per fight', () => {
        const common = [
            { hrid: '/monsters/common', name: 'Common', remaining: 50, killsPerHour: 150, hoursNeeded: 1 / 3 },
        ];
        const result = computeZoneBottleneck(common, { encounters: 100 }, 1, 0.9);
        expect(result.percentile).toBeNull();
        expect(result.fightsNeeded).toBe(33);
        expect(result.hoursNeeded).toBeCloseTo(1 / 3);
        expect(result.medianFightsNeeded).toBeNull();
    });

    test('never-killed bottleneck stays Infinity with a percentile requested', () => {
        const dragon = [
            { hrid: '/monsters/dragon', name: 'Dragon', remaining: 20, killsPerHour: 0, hoursNeeded: Infinity },
        ];
        const result = computeZoneBottleneck(dragon, { encounters: 100 }, 1, 0.9);
        expect(result.percentile).toBeNull();
        expect(result.fightsNeeded).toBe(Infinity);
        expect(result.hoursNeeded).toBe(Infinity);
    });
});
