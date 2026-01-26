/**
 * Tests for Formatting Utilities
 * Testing pure functions for formatting numbers and time
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    numberFormatter,
    timeReadable,
    formatWithSeparator,
    formatKMB,
    formatKMB3Digits,
    coinFormatter,
    formatRelativeTime,
    networthFormatter,
    formatPercentage,
    formatCurrency,
    formatCompactNumber,
    formatLargeNumber,
} from './formatters.js';

// Mock config module for formatLargeNumber tests
vi.mock('../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => {
            if (key === 'formatting_useKMBFormat') return true;
            return undefined;
        }),
    },
}));

describe('numberFormatter', () => {
    test('formats whole numbers with thousand separators', () => {
        expect(numberFormatter(1500)).toBe('1,500');
        expect(numberFormatter(1500000)).toBe('1,500,000');
    });

    test('formats numbers with decimal places', () => {
        expect(numberFormatter(1500.5, 1)).toBe('1,500.5');
        expect(numberFormatter(1234.567, 2)).toBe('1,234.57');
    });

    test('handles zero', () => {
        expect(numberFormatter(0)).toBe('0');
        expect(numberFormatter(0, 2)).toBe('0'); // Intl.NumberFormat strips trailing zeros
    });

    test('handles null and undefined', () => {
        expect(numberFormatter(null)).toBe(null);
        expect(numberFormatter(undefined)).toBe(null);
    });

    test('rounds to specified decimal places', () => {
        expect(numberFormatter(1234.999, 0)).toBe('1,235');
        expect(numberFormatter(1234.999, 1)).toBe('1,235'); // Intl.NumberFormat strips trailing zeros
    });
});

describe('timeReadable', () => {
    describe('seconds format (< 1 minute)', () => {
        test('formats seconds only', () => {
            expect(timeReadable(30)).toBe('30s');
            expect(timeReadable(59)).toBe('59s');
        });
    });

    describe('hours:minutes:seconds format (< 1 day)', () => {
        test('formats hours, minutes, and seconds', () => {
            expect(timeReadable(3661)).toBe('1h 01m 01s');
            expect(timeReadable(3600)).toBe('1h 00m 00s');
        });

        test('formats minutes and seconds without hours', () => {
            expect(timeReadable(125)).toBe('0h 02m 05s');
        });
    });

    describe('days format (>= 1 day, < 1 year)', () => {
        test('formats single day', () => {
            expect(timeReadable(86400)).toBe('1 day');
        });

        test('formats days with hours and minutes', () => {
            expect(timeReadable(90000)).toBe('1 day 1h'); // Minutes omitted when 0
        });

        test('formats multiple days', () => {
            expect(timeReadable(172800)).toBe('2 days');
        });

        test('formats days, hours, and minutes', () => {
            expect(timeReadable(93600)).toBe('1 day 2h'); // Minutes omitted when 0
        });
    });

    describe('years format (>= 1 year)', () => {
        test('formats single year', () => {
            expect(timeReadable(31536000)).toBe('1 year');
        });

        test('formats years, months, and days', () => {
            expect(timeReadable(100000000)).toContain('year');
            expect(timeReadable(100000000)).toContain('month');
        });

        test('formats multiple years', () => {
            const result = timeReadable(63072000); // 2 years
            expect(result).toBe('2 years');
        });
    });
});

describe('formatWithSeparator', () => {
    test('formats numbers with thousand separators', () => {
        expect(formatWithSeparator(1000000)).toBe('1,000,000');
        expect(formatWithSeparator(1234567)).toBe('1,234,567');
    });

    test('handles small numbers', () => {
        expect(formatWithSeparator(100)).toBe('100');
        expect(formatWithSeparator(999)).toBe('999');
    });
});

describe('formatKMB', () => {
    test('formats thousands with K suffix', () => {
        expect(formatKMB(1500)).toBe('1.5K');
        expect(formatKMB(1000)).toBe('1.0K');
    });

    test('formats millions with M suffix', () => {
        expect(formatKMB(2300000)).toBe('2.3M');
        expect(formatKMB(1000000)).toBe('1.0M');
    });

    test('formats billions with B suffix', () => {
        expect(formatKMB(1234567890)).toBe('1.2B');
        expect(formatKMB(5000000000)).toBe('5.0B');
    });

    test('formats small numbers without suffix', () => {
        expect(formatKMB(999)).toBe('999');
        expect(formatKMB(500)).toBe('500');
    });

    test('respects decimal parameter', () => {
        expect(formatKMB(1500, 2)).toBe('1.50K');
        expect(formatKMB(1500, 0)).toBe('2K');
    });

    test('handles negative numbers', () => {
        expect(formatKMB(-1500)).toBe('-1.5K');
        expect(formatKMB(-2300000)).toBe('-2.3M');
    });

    test('handles null and undefined', () => {
        expect(formatKMB(null)).toBe(null);
        expect(formatKMB(undefined)).toBe(null);
    });
});

describe('formatKMB3Digits', () => {
    test('formats numbers under 1000 as raw numbers', () => {
        expect(formatKMB3Digits(999)).toBe('999');
        expect(formatKMB3Digits(500)).toBe('500');
        expect(formatKMB3Digits(1)).toBe('1');
    });

    test('formats thousands with appropriate decimals', () => {
        expect(formatKMB3Digits(1250)).toBe('1.25K');
        expect(formatKMB3Digits(8210)).toBe('8.21K');
        expect(formatKMB3Digits(82100)).toBe('82.1K');
        expect(formatKMB3Digits(825000)).toBe('825K');
    });

    test('handles rounding edge cases for K', () => {
        expect(formatKMB3Digits(9999)).toBe('10.0K');
        expect(formatKMB3Digits(99999)).toBe('100K');
    });

    test('promotes to M when reaching 1000K', () => {
        expect(formatKMB3Digits(999999)).toBe('1.00M');
    });

    test('formats millions with appropriate decimals', () => {
        expect(formatKMB3Digits(1250000)).toBe('1.25M');
        expect(formatKMB3Digits(82300000)).toBe('82.3M');
        expect(formatKMB3Digits(825000000)).toBe('825M');
    });

    test('formats billions with appropriate decimals', () => {
        expect(formatKMB3Digits(1250000000)).toBe('1.25B');
        expect(formatKMB3Digits(82300000000)).toBe('82.3B');
    });

    test('handles negative numbers', () => {
        expect(formatKMB3Digits(-1250)).toBe('-1.25K');
        expect(formatKMB3Digits(-1250000)).toBe('-1.25M');
    });

    test('handles null and undefined', () => {
        expect(formatKMB3Digits(null)).toBe(null);
        expect(formatKMB3Digits(undefined)).toBe(null);
    });
});

describe('coinFormatter', () => {
    test('formats 0-999 as raw numbers', () => {
        expect(coinFormatter(999)).toBe('999');
        expect(coinFormatter(500)).toBe('500');
        expect(coinFormatter(0)).toBe('0');
    });

    test('formats 1,000-9,999 with comma', () => {
        expect(coinFormatter(1000)).toBe('1,000');
        expect(coinFormatter(9999)).toBe('9,999');
        expect(coinFormatter(5000)).toBe('5,000');
    });

    test('formats 10K-9,999K range', () => {
        expect(coinFormatter(10000)).toBe('10K');
        expect(coinFormatter(999999)).toBe('999K');
        expect(coinFormatter(1000000)).toBe('1,000K');
        expect(coinFormatter(9999999)).toBe('9,999K');
    });

    test('formats 10M-9,999M range', () => {
        expect(coinFormatter(10000000)).toBe('10M');
        expect(coinFormatter(999999999)).toBe('999M');
        expect(coinFormatter(1000000000)).toBe('1,000M');
    });

    test('formats 10B-9,999B range', () => {
        expect(coinFormatter(10000000000)).toBe('10B');
        expect(coinFormatter(999999999999)).toBe('999B');
    });

    test('formats 10T+ range', () => {
        expect(coinFormatter(10000000000000)).toBe('10T');
        expect(coinFormatter(1000000000000000)).toBe('1,000T');
    });

    test('handles negative numbers', () => {
        expect(coinFormatter(-1000)).toBe('-1,000');
        expect(coinFormatter(-10000)).toBe('-10K');
    });

    test('handles null and undefined', () => {
        expect(coinFormatter(null)).toBe(null);
        expect(coinFormatter(undefined)).toBe(null);
    });
});

describe('formatRelativeTime', () => {
    test('formats "Just now" for < 1 minute', () => {
        expect(formatRelativeTime(30000)).toBe('Just now');
        expect(formatRelativeTime(59999)).toBe('Just now');
    });

    test('formats minutes only', () => {
        expect(formatRelativeTime(300000)).toBe('5m');
        expect(formatRelativeTime(600000)).toBe('10m');
    });

    test('formats hours and minutes', () => {
        expect(formatRelativeTime(7200000)).toBe('2h 0m');
        expect(formatRelativeTime(9000000)).toBe('2h 30m');
    });

    test('formats days and hours', () => {
        expect(formatRelativeTime(93600000)).toBe('1d 2h');
        expect(formatRelativeTime(172800000)).toBe('2d 0h');
    });

    test('formats days only for > 7 days', () => {
        expect(formatRelativeTime(864000000)).toBe('10d');
        expect(formatRelativeTime(1296000000)).toBe('15d');
    });

    test('formats "30+ days" for > 30 days', () => {
        expect(formatRelativeTime(2678400000)).toBe('30+ days');
        expect(formatRelativeTime(5000000000)).toBe('30+ days');
    });
});

describe('networthFormatter', () => {
    test('formats numbers under 1000 as raw numbers', () => {
        expect(networthFormatter(999)).toBe('999');
        expect(networthFormatter(500)).toBe('500');
    });

    test('formats thousands with 2 decimals', () => {
        expect(networthFormatter(1234)).toBe('1.23K');
        expect(networthFormatter(45678)).toBe('45.68K');
    });

    test('formats millions with 2 decimals', () => {
        expect(networthFormatter(1234567)).toBe('1.23M');
        expect(networthFormatter(89012345)).toBe('89.01M');
    });

    test('formats billions with 2 decimals', () => {
        expect(networthFormatter(1234567890)).toBe('1.23B');
        expect(networthFormatter(89012345678)).toBe('89.01B');
    });

    test('handles negative numbers', () => {
        expect(networthFormatter(-1234)).toBe('-1.23K');
        expect(networthFormatter(-1234567)).toBe('-1.23M');
    });

    test('handles null and undefined', () => {
        expect(networthFormatter(null)).toBe(null);
        expect(networthFormatter(undefined)).toBe(null);
    });
});

describe('formatPercentage', () => {
    test('formats decimal as percentage with 1 decimal', () => {
        expect(formatPercentage(0.05)).toBe('5.0%');
        expect(formatPercentage(0.125)).toBe('12.5%');
    });

    test('respects decimal parameter', () => {
        expect(formatPercentage(0.00123, 2)).toBe('0.12%');
        expect(formatPercentage(0.00123, 3)).toBe('0.123%');
    });

    test('handles whole percentages', () => {
        expect(formatPercentage(1.0)).toBe('100.0%');
        expect(formatPercentage(0.5)).toBe('50.0%');
    });

    test('handles null and undefined', () => {
        expect(formatPercentage(null)).toBe(null);
        expect(formatPercentage(undefined)).toBe(null);
    });
});

describe('formatCurrency', () => {
    test('defaults to game style', () => {
        expect(formatCurrency(1500)).toBe('1,500');
        expect(formatCurrency(1500000)).toBe('1,500K');
    });

    test('formats with game style', () => {
        expect(formatCurrency(1500, { style: 'game' })).toBe('1,500');
        expect(formatCurrency(1500000, { style: 'game' })).toBe('1,500K');
    });

    test('formats with compact style', () => {
        expect(formatCurrency(1500000, { style: 'compact' })).toBe('1.5M');
        expect(formatCurrency(1500000, { style: 'compact', decimals: 2 })).toBe('1.50M');
    });

    test('formats with networth style', () => {
        expect(formatCurrency(1234, { style: 'networth' })).toBe('1.23K');
        expect(formatCurrency(1234567, { style: 'networth' })).toBe('1.23M');
    });

    test('formats with full style', () => {
        expect(formatCurrency(1500000, { style: 'full' })).toBe('1,500,000');
        expect(formatCurrency(1234567, { style: 'full' })).toBe('1,234,567');
    });
});

describe('formatCompactNumber', () => {
    test('is an alias for formatKMB', () => {
        expect(formatCompactNumber(1500)).toBe('1.5K');
        expect(formatCompactNumber(2300000)).toBe('2.3M');
        expect(formatCompactNumber(1234567890)).toBe('1.2B');
    });

    test('respects decimal parameter', () => {
        expect(formatCompactNumber(1500, 2)).toBe('1.50K');
        expect(formatCompactNumber(1500, 0)).toBe('2K');
    });
});

describe('formatLargeNumber', () => {
    test('uses K/M/B format when enabled', () => {
        expect(formatLargeNumber(1500000)).toBe('1.5M');
        expect(formatLargeNumber(2300)).toBe('2.3K');
    });

    test('respects decimal parameter', () => {
        expect(formatLargeNumber(1500000, 2)).toBe('1.50M');
        expect(formatLargeNumber(2300, 0)).toBe('2K');
    });
});
