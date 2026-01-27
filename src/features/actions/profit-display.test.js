import { describe, expect, it } from 'vitest';

import { formatMissingLabel, getBonusDropPerHourTotals, getBonusDropTotalsForActions } from './profit-display.js';

describe('formatMissingLabel', () => {
    it('returns the provided value when not missing', () => {
        const label = formatMissingLabel(false, '123/hr');

        expect(label).toBe('123/hr');
    });

    it('returns a missing placeholder when data is missing', () => {
        const label = formatMissingLabel(true, '123/hr');

        expect(label).toBe('-- ⚠');
    });
});

describe('getBonusDropPerHourTotals', () => {
    it('scales per-hour drops and revenue by efficiency', () => {
        const drop = { dropsPerHour: 10, revenuePerHour: 50 };

        const result = getBonusDropPerHourTotals(drop, 1.5);

        expect(result.dropsPerHour).toBe(15);
        expect(result.revenuePerHour).toBe(75);
    });
});

describe('getBonusDropTotalsForActions', () => {
    it('uses per-action values when provided', () => {
        const drop = { dropsPerAction: 0.5, revenuePerAction: 2 };

        const result = getBonusDropTotalsForActions(drop, 100, 50);

        expect(result.totalDrops).toBe(50);
        expect(result.totalRevenue).toBe(200);
    });

    it('falls back to per-hour values when per-action missing', () => {
        const drop = { dropsPerHour: 20, revenuePerHour: 40 };

        const result = getBonusDropTotalsForActions(drop, 3, 10);

        expect(result.totalDrops).toBe(6);
        expect(result.totalRevenue).toBe(12);
    });

    it('aligns per-hour scaling with action totals over time', () => {
        const drop = { dropsPerHour: 10, revenuePerHour: 50 };
        const efficiencyMultiplier = 1.5;
        const actionsPerHour = 100;
        const actionsCount = 150;

        const perHour = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
        const actionTotals = getBonusDropTotalsForActions(drop, actionsCount, actionsPerHour);
        const hoursNeeded = actionsCount / (actionsPerHour * efficiencyMultiplier);

        expect(actionTotals.totalDrops).toBeCloseTo(perHour.dropsPerHour * hoursNeeded, 6);
        expect(actionTotals.totalRevenue).toBeCloseTo(perHour.revenuePerHour * hoursNeeded, 6);
    });
});
