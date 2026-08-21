import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ threshold: 12 }));

vi.mock('../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn((_key, def) => mocks.threshold ?? def),
        onSettingChange: vi.fn(),
    },
}));
vi.mock('../../core/data-manager.js', () => ({ default: { getInitClientData: vi.fn(() => ({})) } }));
vi.mock('../../api/marketplace.js', () => ({ default: { on: vi.fn(), getPrice: vi.fn() } }));
vi.mock('./combat-stats-data-collector.js', () => ({ default: {} }));
vi.mock('../market/expected-value-calculator.js', () => ({ default: { resolveSellSideValue: vi.fn(() => null) } }));

import { formatRunway, formatRunwayExact, formatQuantity, getRunwayColor } from './combat-stats-ui.js';

beforeEach(() => {
    mocks.threshold = 12;
});

describe('formatRunway', () => {
    test('formats no-usage/Infinity as a non-misleading state, not a bogus duration', () => {
        expect(formatRunway(Infinity)).toBe('No usage observed');
    });

    test('formats a legitimate 0 (already out) distinctly from unknown', () => {
        expect(formatRunway(0)).toBe('Out now');
    });

    test('formats sub-hour runway in minutes', () => {
        expect(formatRunway(90)).toBe('~2m');
    });

    test('formats sub-day runway in hours and minutes', () => {
        expect(formatRunway(3 * 3600 + 30 * 60)).toBe('~3h 30m');
    });

    test('formats multi-day runway in days and hours', () => {
        expect(formatRunway(17 * 86400 + 5 * 3600)).toBe('~17d 5h');
    });

    test('caps extremely long runway at >1y instead of an unreadable exact day count', () => {
        expect(formatRunway(1612 * 86400 + 22 * 3600)).toBe('>1y');
    });

    test('does not cap a runway just under one year', () => {
        expect(formatRunway(364 * 86400)).toBe('~364d');
    });
});

describe('formatRunwayExact', () => {
    test('is uncapped for extremely long runway, for use as a tooltip', () => {
        expect(formatRunwayExact(1612 * 86400 + 22 * 3600)).toBe('~1612d 22h');
    });

    test('matches formatRunway for ordinary short runway', () => {
        expect(formatRunwayExact(90)).toBe(formatRunway(90));
    });
});

describe('getRunwayColor', () => {
    test('is alerting red when already out', () => {
        expect(getRunwayColor(0)).toBe('#ff6b6b');
    });

    test('is amber when below the configured warning threshold', () => {
        mocks.threshold = 12;
        expect(getRunwayColor(6 * 3600)).toBe('#f0a830');
    });

    test('threshold 0 disables the visual warning - never amber regardless of runway', () => {
        mocks.threshold = 0;
        expect(getRunwayColor(6 * 3600)).toBe('#888');
        expect(getRunwayColor(1)).toBe('#888');
    });

    test('is muted gray when comfortably above the warning threshold', () => {
        mocks.threshold = 12;
        expect(getRunwayColor(30 * 3600)).toBe('#888');
    });

    test('is muted gray (never amber) when the warning threshold is disabled (0)', () => {
        mocks.threshold = 0;
        expect(getRunwayColor(1 * 3600)).toBe('#888');
    });

    test('is muted gray for no-usage/Infinity', () => {
        expect(getRunwayColor(Infinity)).toBe('#888');
    });
});

describe('formatQuantity', () => {
    const formatNum = (n) => String(Math.round(n));

    test('never silently rounds a small non-zero rare-drop expectation down to a misleading 0', () => {
        expect(formatQuantity(0.04, formatNum)).toBe('0.04');
        expect(formatQuantity(0.17, formatNum)).toBe('0.17');
    });

    test('shows one decimal for quantities between 1 and 10', () => {
        expect(formatQuantity(6.2, formatNum)).toBe('6.2');
    });

    test('shows <0.01 rather than 0.00 for extremely tiny non-zero values', () => {
        expect(formatQuantity(0.001, formatNum)).toBe('<0.01');
    });

    test('is exactly 0 for a genuine zero', () => {
        expect(formatQuantity(0, formatNum)).toBe('0');
    });

    test('prints an already-whole number as a plain integer, not with a spurious decimal', () => {
        expect(formatQuantity(5, formatNum)).toBe('5');
        expect(formatQuantity(1200, formatNum)).toBe('1200');
    });

    test('falls back to the provided formatter for large quantities', () => {
        expect(formatQuantity(12345.6, formatNum)).toBe(formatNum(12345.6));
    });
});
