/**
 * Tests for Task Profit Display helpers
 */

import { describe, test, expect } from 'vitest';
import {
    calculateTaskCompletionSeconds,
    calculateTaskEfficiencyRating,
    getRelativeEfficiencyGradientColor,
} from './task-profit-display.js';

const createProfitData = ({
    actionsPerHour = 600,
    efficiencyMultiplier = 1,
    quantity = 100,
    currentProgress = 0,
    rewardTotal = 0,
    rewardError = null,
    tokensReceived = 0,
    totalProfit = rewardTotal,
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
    totalProfit,
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
            totalProfit: 1200,
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

    test('returns warning when total profit is unavailable', () => {
        const profitData = createProfitData({
            actionsPerHour: 60,
            quantity: 60,
            totalProfit: null,
        });

        const result = calculateTaskEfficiencyRating(profitData, 'gold');
        expect(result).toEqual({ value: null, unitLabel: 'gold/hr', error: 'Missing price data' });
    });
});

describe('getRelativeEfficiencyGradientColor', () => {
    test('returns fallback color for invalid values', () => {
        expect(getRelativeEfficiencyGradientColor(Number.NaN, 0, 10, '#ff0000', '#00ff00', '#888')).toBe('#888');
        expect(getRelativeEfficiencyGradientColor(5, 10, 10, '#ff0000', '#00ff00', '#888')).toBe('#888');
        expect(getRelativeEfficiencyGradientColor(5, 0, 10, '#ff', '#00ff00', '#888')).toBe('#888');
    });

    test('maps relative values to gradient', () => {
        expect(getRelativeEfficiencyGradientColor(-5, 0, 10, '#ff0000', '#00ff00', '#888')).toBe('rgb(255, 0, 0)');
        expect(getRelativeEfficiencyGradientColor(10, 0, 10, '#ff0000', '#00ff00', '#888')).toBe('rgb(0, 255, 0)');
        expect(getRelativeEfficiencyGradientColor(5, 0, 10, '#ff0000', '#00ff00', '#888')).toBe('rgb(128, 128, 0)');
        expect(getRelativeEfficiencyGradientColor(0, 0, 10, '#ff0000', '#00ff00', '#888')).toBe('rgb(255, 0, 0)');
    });
});
