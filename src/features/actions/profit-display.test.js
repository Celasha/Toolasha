import { describe, expect, it } from 'vitest';

import {
    formatMissingLabel,
    getBonusDropPerHourTotals,
    getBonusDropTotalsForActions,
    formatMarketTaxText,
} from './profit-display.js';

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

describe('formatMarketTaxText', () => {
    it('shows the taxed amount when not excluded and not missing', () => {
        const result = formatMarketTaxText(false, false, 1000, '/hr');

        expect(result.line).toContain('4%');
        expect(result.line).toContain('1.00K/hr');
        expect(result.section).toContain('1.00K/hr');
    });

    it('shows a missing placeholder when the price is missing, regardless of amount', () => {
        const result = formatMarketTaxText(false, true, 1000, '/hr');

        expect(result.line).toContain('-- ⚠');
        expect(result.section).toContain('-- ⚠');
    });

    it('shows Excluded wording when excludeSellTax is on, ignoring missing/amount entirely', () => {
        const result = formatMarketTaxText(true, true, 1000, '/hr');

        expect(result.line).not.toContain('-- ⚠');
        expect(result.line).not.toContain('1.00K');
        expect(result.section).not.toContain('1.00K');
    });

    it('appends a warning glyph when estimated and not excluded/missing', () => {
        const normal = formatMarketTaxText(false, false, 1000, '/hr', false);
        const estimated = formatMarketTaxText(false, false, 1000, '/hr', true);

        expect(estimated.line).not.toBe(normal.line);
        expect(estimated.line).toContain('⚠');
    });
});
