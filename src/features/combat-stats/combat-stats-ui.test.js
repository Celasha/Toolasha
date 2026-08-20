import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({ default: { getSettingValue: vi.fn(), onSettingChange: vi.fn() } }));
vi.mock('../../api/marketplace.js', () => ({ default: {} }));
vi.mock('./combat-stats-data-collector.js', () => ({ default: {} }));
vi.mock('../market/expected-value-calculator.js', () => ({ default: {} }));

import { formatRunway } from './combat-stats-ui.js';

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
});
