/**
 * Tests for Task Profit Display helpers
 */

import { describe, test, expect } from 'vitest';
import {
    calculateTaskCompletionSeconds,
    calculateTaskEfficiencyRating,
    getEfficiencyGradientColor,
} from './task-profit-display.js';

const createProfitData = ({
    actionsPerHour = 600,
    efficiencyMultiplier = 1,
    quantity = 100,
    currentProgress = 0,
    rewardTotal = 0,
    rewardError = null,
    tokensReceived = 0,
} = {}) => ({
    action: {
        details: {
            actionsPerHour,
            efficiencyMultiplier,
        },
    },
    taskInfo: {
        quantity,
        currentProgress,
    },
    rewards: {
        total: rewardTotal,
        error: rewardError,
        breakdown: {
            tokensReceived,
        },
    },
});

describe('calculateTaskCompletionSeconds', () => {
    test('returns null when required data is missing', () => {
        expect(calculateTaskCompletionSeconds({})).toBe(null);
        expect(calculateTaskCompletionSeconds(createProfitData({ actionsPerHour: 0 }))).toBe(null);
        expect(calculateTaskCompletionSeconds(createProfitData({ quantity: 0 }))).toBe(null);
    });

    test('returns 0 when task is already complete', () => {
        const profitData = createProfitData({ quantity: 50, currentProgress: 50 });
        expect(calculateTaskCompletionSeconds(profitData)).toBe(0);
    });

    test('calculates seconds using efficiency multiplier', () => {
        const profitData = createProfitData({
            actionsPerHour: 600,
            quantity: 100,
            currentProgress: 40,
            efficiencyMultiplier: 2,
        });

        expect(calculateTaskCompletionSeconds(profitData)).toBe(180);
    });
});

describe('calculateTaskEfficiencyRating', () => {
    test('returns null when completion time is unavailable', () => {
        const profitData = createProfitData({ actionsPerHour: 0 });
        expect(calculateTaskEfficiencyRating(profitData, 'tokens')).toBe(null);
    });

    test('calculates token efficiency per hour', () => {
        const profitData = createProfitData({
            actionsPerHour: 60,
            quantity: 60,
            tokensReceived: 30,
        });

        const result = calculateTaskEfficiencyRating(profitData, 'tokens');
        expect(result).toEqual({ value: 30, unitLabel: 'tokens/hr', error: null });
    });

    test('calculates gold efficiency per hour', () => {
        const profitData = createProfitData({
            actionsPerHour: 30,
            quantity: 60,
            rewardTotal: 1200,
        });

        const result = calculateTaskEfficiencyRating(profitData, 'gold');
        expect(result).toEqual({ value: 600, unitLabel: 'gold/hr', error: null });
    });

    test('returns warning when gold rewards are unavailable', () => {
        const profitData = createProfitData({
            actionsPerHour: 60,
            quantity: 60,
            rewardError: 'Market data not loaded',
        });

        const result = calculateTaskEfficiencyRating(profitData, 'gold');
        expect(result).toEqual({ value: null, unitLabel: 'gold/hr', error: 'Market data not loaded' });
    });
});

describe('getEfficiencyGradientColor', () => {
    test('returns fallback color for invalid values', () => {
        expect(getEfficiencyGradientColor(0, 'tokens', '#888')).toBe('#888');
        expect(getEfficiencyGradientColor(-5, 'gold', '#888')).toBe('#888');
        expect(getEfficiencyGradientColor(Number.NaN, 'tokens', '#888')).toBe('#888');
    });

    test('maps token efficiency to green gradient', () => {
        expect(getEfficiencyGradientColor(10, 'tokens', '#888')).toBe('hsl(120 70% 50%)');
        expect(getEfficiencyGradientColor(5, 'tokens', '#888')).toBe('hsl(60 70% 50%)');
    });

    test('clamps gold efficiency to max gradient', () => {
        expect(getEfficiencyGradientColor(1000000, 'gold', '#888')).toBe('hsl(120 70% 50%)');
    });
});
