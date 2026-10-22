/**
 * Tests for consumable reconciliation
 */

import { describe, test, expect } from 'vitest';
import {
    classifyItem,
    reconcileSnapshot,
    wavesElapsed,
    estimateFightingSeconds,
    UNOBSERVED_GAP_SECONDS,
} from './consumable-reconcile.js';

const GUMMY_RATE = 1 / 60; // 60 second cooldown
const COFFEE_RATE = 1 / 250; // 300s / 1.2 drink concentration

describe('classifyItem', () => {
    test('no difference changes nothing', () => {
        expect(
            classifyItem({ lastKnown: 100, snapshot: 100, effectiveGapSeconds: 13, maxRatePerSecond: GUMMY_RATE })
        ).toEqual({ action: 'none', credited: 0, missed: 0 });
    });

    test('an item never seen before only sets a baseline', () => {
        expect(
            classifyItem({ lastKnown: undefined, snapshot: 100, effectiveGapSeconds: 60, maxRatePerSecond: GUMMY_RATE })
        ).toEqual({ action: 'baseline', credited: 0, missed: 0 });
    });

    test('a plausible drop over a long gap is credited in full', () => {
        const result = classifyItem({
            lastKnown: 1000,
            snapshot: 700,
            effectiveGapSeconds: 300 * 60, // 5 hours: up to 300 gummies at 1/min
            maxRatePerSecond: GUMMY_RATE,
        });
        expect(result).toEqual({ action: 'credit', credited: 300, missed: 300 });
    });

    test('a drop beyond the cooldown limit is rejected', () => {
        // 3,885 coffees in 11 hours is impossible: at most ~158 at the fastest cooldown
        const result = classifyItem({
            lastKnown: 5552,
            snapshot: 1667,
            effectiveGapSeconds: 11 * 3600,
            maxRatePerSecond: COFFEE_RATE,
        });
        expect(result.action).toBe('reject');
        expect(result.credited).toBe(0);
        expect(result.missed).toBe(3885);
    });

    test('a count that went up is a restock and credits nothing', () => {
        expect(
            classifyItem({ lastKnown: 1961, snapshot: 2262, effectiveGapSeconds: 100, maxRatePerSecond: GUMMY_RATE })
        ).toEqual({ action: 'restock', credited: 0, missed: -301 });
    });

    test('a single missed event is credited even over a very short gap', () => {
        expect(
            classifyItem({ lastKnown: 10, snapshot: 9, effectiveGapSeconds: 0, maxRatePerSecond: GUMMY_RATE }).action
        ).toBe('credit');
    });
});

describe('reconcileSnapshot', () => {
    const item = (overrides = {}) => ({
        itemHrid: '/items/dragon_fruit_gummy',
        lastKnown: 1000,
        snapshot: 1000,
        maxRatePerSecond: GUMMY_RATE,
        ...overrides,
    });

    test('first observation baselines every item and excludes no time', () => {
        const result = reconcileSnapshot({ items: [item()], gapSeconds: null, fightingSeconds: null });
        expect(result.items[0].action).toBe('baseline');
        expect(result.excludeSeconds).toBe(0);
    });

    test('a normal gap with no difference excludes nothing', () => {
        const result = reconcileSnapshot({ items: [item()], gapSeconds: 13, fightingSeconds: null });
        expect(result.unobserved).toBe(false);
        expect(result.excludeSeconds).toBe(0);
        expect(result.items[0].action).toBe('none');
    });

    test('dungeon-length silences are not treated as unobserved', () => {
        const result = reconcileSnapshot({ items: [item()], gapSeconds: 98, fightingSeconds: null });
        expect(result.unobserved).toBe(false);
    });

    test('an unobserved gap with credited consumption keeps the whole gap in the time base', () => {
        const result = reconcileSnapshot({
            items: [item({ snapshot: 940 })],
            gapSeconds: 3600,
            fightingSeconds: null,
        });
        expect(result.unobserved).toBe(true);
        expect(result.items[0]).toMatchObject({ action: 'credit', credited: 60 });
        expect(result.excludeSeconds).toBe(0);
    });

    test('fighting time shorter than the gap excludes the remainder', () => {
        const result = reconcileSnapshot({
            items: [item({ snapshot: 940 })],
            gapSeconds: 20 * 3600,
            fightingSeconds: 10 * 3600,
        });
        expect(result.items[0].action).toBe('credit');
        expect(result.excludeSeconds).toBe(10 * 3600);
    });

    test('fighting time clamps the plausibility limit for the gap', () => {
        // 600 gummies would pass over 20 wall-clock hours, but not over 5 fighting hours
        const result = reconcileSnapshot({
            items: [item({ snapshot: 400 })],
            gapSeconds: 20 * 3600,
            fightingSeconds: 5 * 3600,
        });
        expect(result.items[0].action).toBe('reject');
    });

    test('an unobserved gap with nothing credited is excluded entirely', () => {
        const result = reconcileSnapshot({ items: [item()], gapSeconds: 3600, fightingSeconds: null });
        expect(result.unobserved).toBe(true);
        expect(result.excludeSeconds).toBe(3600);
    });

    test('a rejected drop excludes the whole gap', () => {
        const result = reconcileSnapshot({
            items: [item({ snapshot: 0 })],
            gapSeconds: UNOBSERVED_GAP_SECONDS + 1,
            fightingSeconds: null,
        });
        expect(result.items[0].action).toBe('reject');
        expect(result.excludeSeconds).toBe(UNOBSERVED_GAP_SECONDS + 1);
    });

    test('one credited item keeps the gap even when another item is rejected', () => {
        const result = reconcileSnapshot({
            items: [item({ snapshot: 940 }), item({ itemHrid: '/items/ultra_magic_coffee', snapshot: 0 })],
            gapSeconds: 3600,
            fightingSeconds: null,
        });
        expect(result.items.map((entry) => entry.action)).toEqual(['credit', 'reject']);
        expect(result.excludeSeconds).toBe(0);
    });
});

describe('wavesElapsed', () => {
    test('regular zones advance battleId once per wave', () => {
        expect(
            wavesElapsed({ previousBattleId: 2, previousWave: null, battleId: 205, wave: null, dungeonMaxWaves: null })
        ).toBe(203);
    });

    test('dungeons combine run and wave changes across a run boundary', () => {
        expect(
            wavesElapsed({ previousBattleId: 30, previousWave: 60, battleId: 31, wave: 5, dungeonMaxWaves: 65 })
        ).toBe(10);
    });

    test('dungeons across several whole runs', () => {
        expect(
            wavesElapsed({ previousBattleId: 30, previousWave: 31, battleId: 33, wave: 31, dungeonMaxWaves: 65 })
        ).toBe(195);
    });

    test('returns null when nothing advanced or the previous state is unknown', () => {
        expect(
            wavesElapsed({ previousBattleId: 5, previousWave: null, battleId: 5, wave: null, dungeonMaxWaves: null })
        ).toBe(null);
        expect(
            wavesElapsed({ previousBattleId: null, previousWave: null, battleId: 5, wave: null, dungeonMaxWaves: null })
        ).toBe(null);
        expect(
            wavesElapsed({ previousBattleId: 30, previousWave: null, battleId: 31, wave: 5, dungeonMaxWaves: 65 })
        ).toBe(null);
    });
});

describe('estimateFightingSeconds', () => {
    test('multiplies waves by the average observed wave time', () => {
        expect(estimateFightingSeconds(203, { sum: 245, count: 10 })).toBeCloseTo(4973.5);
    });

    test('is null without enough samples', () => {
        expect(estimateFightingSeconds(203, { sum: 24, count: 2 })).toBe(null);
        expect(estimateFightingSeconds(203, null)).toBe(null);
        expect(estimateFightingSeconds(null, { sum: 245, count: 10 })).toBe(null);
    });
});
