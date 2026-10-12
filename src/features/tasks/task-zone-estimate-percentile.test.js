/**
 * Tests for the zone fight estimate percentile helpers
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockGetSettingValue } = vi.hoisted(() => ({ mockGetSettingValue: vi.fn() }));

vi.mock('../../core/config.js', () => ({ default: { getSettingValue: mockGetSettingValue } }));
vi.mock('../../core/i18n.js', () => {
    const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
    return { default: { t }, t };
});

import {
    createMedianHint,
    formatPercentileSuffix,
    getZoneEstimatePercentile,
} from './task-zone-estimate-percentile.js';

describe('getZoneEstimatePercentile', () => {
    beforeEach(() => {
        mockGetSettingValue.mockReset();
    });

    test.each([
        ['50', 0.5],
        ['80', 0.8],
        ['90', 0.9],
        ['95', 0.95],
    ])('maps the "%s" setting value to %s', (value, expected) => {
        mockGetSettingValue.mockReturnValue(value);
        expect(getZoneEstimatePercentile()).toBe(expected);
    });

    test('defaults to 90% when the setting is unset or not one of the offered values', () => {
        mockGetSettingValue.mockReturnValue(undefined);
        expect(getZoneEstimatePercentile()).toBe(0.9);
        mockGetSettingValue.mockReturnValue('73');
        expect(getZoneEstimatePercentile()).toBe(0.9);
    });
});

describe('formatPercentileSuffix', () => {
    test('is empty for the mean fallback (no percentile)', () => {
        expect(formatPercentileSuffix(null)).toBe('');
    });

    test('passes the whole-number percent to the locale string', () => {
        expect(formatPercentileSuffix(0.9)).toContain('"percent":90');
        expect(formatPercentileSuffix(0.95)).toContain('"percent":95');
    });
});

describe('createMedianHint', () => {
    const estimate = { percentile: 0.9, medianFightsNeeded: 503, medianHoursNeeded: 0.5 };

    test('builds a circled ? whose tooltip carries the median fights and time', () => {
        const hint = createMedianHint(estimate);
        expect(hint.textContent).toBe('?');
        expect(hint.style.borderRadius).toBe('50%');
        expect(hint.title).toContain('"percent":90');
        expect(hint.title).toContain('"fights":"503"');
    });

    test('clicking the hint does not bubble to a clickable parent row', () => {
        const parent = document.createElement('div');
        const onClick = vi.fn();
        parent.addEventListener('click', onClick);
        const hint = createMedianHint(estimate);
        parent.appendChild(hint);
        hint.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onClick).not.toHaveBeenCalled();
    });

    test('returns null when the main figure already is the median', () => {
        expect(createMedianHint({ ...estimate, percentile: 0.5 })).toBeNull();
    });

    test('returns null for the mean fallback or when no median could be computed', () => {
        expect(createMedianHint({ ...estimate, percentile: null })).toBeNull();
        expect(createMedianHint({ ...estimate, medianFightsNeeded: null })).toBeNull();
        expect(createMedianHint({ ...estimate, medianHoursNeeded: Infinity })).toBeNull();
    });
});
