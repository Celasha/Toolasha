/**
 * Formatting Utilities
 * Pure functions for formatting numbers and time
 */

import config from '../core/config.js';

/**
 * Format numbers with thousand separators
 * @param {number} num - The number to format
 * @param {number} digits - Number of decimal places (default: 0 for whole numbers)
 * @returns {string} Formatted number (e.g., "1,500", "1,500,000")
 *
 * @example
 * numberFormatter(1500) // "1,500"
 * numberFormatter(1500000) // "1,500,000"
 * numberFormatter(1500.5, 1) // "1,500.5"
 */
export function numberFormatter(num, digits = 0) {
    if (num === null || num === undefined) {
        return null;
    }

    // Round to specified decimal places
    const rounded = digits > 0 ? num.toFixed(digits) : Math.round(num);

    // Format with thousand separators
    return new Intl.NumberFormat().format(rounded);
}

/**
 * Convert seconds to human-readable time format
 * @param {number} sec - Seconds to convert
 * @returns {string} Formatted time (e.g., "1h 23m 45s" or "3 years 5 months 3 days")
 *
 * @example
 * timeReadable(3661) // "1h 01m 01s"
 * timeReadable(90000) // "1 day"
 * timeReadable(31536000) // "1 year"
 * timeReadable(100000000) // "3 years 2 months 3 days"
 */
export function timeReadable(sec) {
    // For times >= 1 year, show in years/months/days
    if (sec >= 31536000) { // 365 days
        const years = Math.floor(sec / 31536000);
        const remainingAfterYears = sec - (years * 31536000);
        const months = Math.floor(remainingAfterYears / 2592000); // 30 days
        const remainingAfterMonths = remainingAfterYears - (months * 2592000);
        const days = Math.floor(remainingAfterMonths / 86400);

        const parts = [];
        if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
        if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

        return parts.join(' ');
    }

    // For times >= 1 day, show in days/hours/minutes
    if (sec >= 86400) {
        const days = Math.floor(sec / 86400);
        const remainingAfterDays = sec - (days * 86400);
        const hours = Math.floor(remainingAfterDays / 3600);
        const remainingAfterHours = remainingAfterDays - (hours * 3600);
        const minutes = Math.floor(remainingAfterHours / 60);

        const parts = [];
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);

        return parts.join(' ');
    }

    // For times < 1 day, show as HH:MM:SS
    const d = new Date(Math.round(sec * 1000));
    function pad(i) {
        return ("0" + i).slice(-2);
    }

    const hours = d.getUTCHours();
    const minutes = d.getUTCMinutes();
    const seconds = d.getUTCSeconds();

    // For times < 1 minute, just show seconds
    if (hours === 0 && minutes === 0) {
        return seconds + "s";
    }

    let str = hours + "h " + pad(minutes) + "m " + pad(seconds) + "s";
    return str;
}

/**
 * Format a number with thousand separators based on locale
 * @param {number} num - The number to format
 * @returns {string} Formatted number with separators
 *
 * @example
 * formatWithSeparator(1000000) // "1,000,000" (US locale)
 */
export function formatWithSeparator(num) {
    return new Intl.NumberFormat().format(num);
}

/**
 * Format large numbers in K/M/B notation
 * @param {number} num - The number to format
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted number (e.g., "1.5K", "2.3M", "1.2B")
 *
 * @example
 * formatKMB(1500) // "1.5K"
 * formatKMB(2300000) // "2.3M"
 * formatKMB(1234567890) // "1.2B"
 */
export function formatKMB(num, decimals = 1) {
    if (num === null || num === undefined) {
        return null;
    }

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (absNum >= 1e9) {
        return sign + (absNum / 1e9).toFixed(decimals) + 'B';
    } else if (absNum >= 1e6) {
        return sign + (absNum / 1e6).toFixed(decimals) + 'M';
    } else if (absNum >= 1e3) {
        return sign + (absNum / 1e3).toFixed(decimals) + 'K';
    } else {
        return sign + absNum.toFixed(0);
    }
}

/**
 * Format large numbers in K/M/B notation with 3 significant digits
 * @param {number} num - The number to format
 * @returns {string} Formatted number (e.g., "999", "1.25K", "82.1K", "825K", "1.25M")
 *
 * Handles rounding edge cases properly:
 * - 9999 rounds to "10.0K" (not "10.00K")
 * - 99999 rounds to "100K" (not "100.0K")
 * - 999999 promotes to "1.00M" (not "1000K")
 *
 * @example
 * formatKMB3Digits(999) // "999"
 * formatKMB3Digits(1250) // "1.25K"
 * formatKMB3Digits(8210) // "8.21K"
 * formatKMB3Digits(9999) // "10.0K"
 * formatKMB3Digits(82100) // "82.1K"
 * formatKMB3Digits(99999) // "100K"
 * formatKMB3Digits(825000) // "825K"
 * formatKMB3Digits(999999) // "1.00M"
 * formatKMB3Digits(1250000) // "1.25M"
 * formatKMB3Digits(82300000) // "82.3M"
 */
export function formatKMB3Digits(num) {
    if (num === null || num === undefined) {
        return null;
    }

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (absNum >= 1e9) {
        const value = absNum / 1e9;
        // Round to 2 decimals first to check actual display value
        const rounded = parseFloat(value.toFixed(2));
        let decimals = 2;
        if (rounded >= 100) decimals = 0;
        else if (rounded >= 10) decimals = 1;
        return sign + value.toFixed(decimals) + 'B';
    } else if (absNum >= 1e6) {
        const value = absNum / 1e6;
        const rounded = parseFloat(value.toFixed(2));
        if (rounded >= 1000) {
            // Promote to B (e.g., 999999999 -> 1.00B not 1000M)
            return sign + (value / 1000).toFixed(2) + 'B';
        }
        let decimals = 2;
        if (rounded >= 100) decimals = 0;
        else if (rounded >= 10) decimals = 1;
        return sign + value.toFixed(decimals) + 'M';
    } else if (absNum >= 1e3) {
        const value = absNum / 1e3;
        const rounded = parseFloat(value.toFixed(2));
        if (rounded >= 1000) {
            // Promote to M (e.g., 999999 -> 1.00M not 1000K)
            return sign + (value / 1000).toFixed(2) + 'M';
        }
        let decimals = 2;
        if (rounded >= 100) decimals = 0;
        else if (rounded >= 10) decimals = 1;
        return sign + value.toFixed(decimals) + 'K';
    } else {
        return sign + Math.floor(absNum).toString();
    }
}

/**
 * Format numbers using game-style coin notation (4-digit maximum display)
 * @param {number} num - The number to format
 * @returns {string} Formatted number (e.g., "999", "1,000", "10K", "9,999K", "10M")
 *
 * Game formatting rules (4-digit bounded notation):
 * - 0-999: Raw number (no formatting)
 * - 1,000-9,999: Comma format
 * - 10,000-9,999,999: K suffix (10K to 9,999K)
 * - 10,000,000-9,999,999,999: M suffix (10M to 9,999M)
 * - 10,000,000,000-9,999,999,999,999: B suffix (10B to 9,999B)
 * - 10,000,000,000,000+: T suffix (10T+)
 *
 * Key rule: Display never exceeds 4 numeric digits. When a 5th digit is needed,
 * promote to the next unit (K→M→B→T).
 *
 * @example
 * coinFormatter(999) // "999"
 * coinFormatter(1000) // "1,000"
 * coinFormatter(9999) // "9,999"
 * coinFormatter(10000) // "10K"
 * coinFormatter(999999) // "999K"
 * coinFormatter(1000000) // "1,000K"
 * coinFormatter(9999999) // "9,999K"
 * coinFormatter(10000000) // "10M"
 */
export function coinFormatter(num) {
    if (num === null || num === undefined) {
        return null;
    }

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    // 0-999: raw number
    if (absNum < 1000) {
        return sign + Math.floor(absNum).toString();
    }
    // 1,000-9,999: comma format
    if (absNum < 10000) {
        return sign + new Intl.NumberFormat().format(Math.floor(absNum));
    }
    // 10K-9,999K (10,000 to 9,999,999)
    if (absNum < 10000000) {
        const val = Math.floor(absNum / 1000);
        const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
        return sign + formatted + 'K';
    }
    // 10M-9,999M (10,000,000 to 9,999,999,999)
    if (absNum < 10000000000) {
        const val = Math.floor(absNum / 1000000);
        const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
        return sign + formatted + 'M';
    }
    // 10B-9,999B (10,000,000,000 to 9,999,999,999,999)
    if (absNum < 10000000000000) {
        const val = Math.floor(absNum / 1000000000);
        const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
        return sign + formatted + 'B';
    }
    // 10T+ (10,000,000,000,000+)
    const val = Math.floor(absNum / 1000000000000);
    const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
    return sign + formatted + 'T';
}

/**
 * Format milliseconds as relative time
 * @param {number} ageMs - Age in milliseconds
 * @returns {string} Formatted relative time (e.g., "5m", "2h 30m", "3d 12h", "14d")
 *
 * @example
 * formatRelativeTime(30000) // "Just now" (< 1 min)
 * formatRelativeTime(300000) // "5m" (5 minutes)
 * formatRelativeTime(7200000) // "2h 0m" (2 hours)
 * formatRelativeTime(93600000) // "1d 2h" (26 hours)
 * formatRelativeTime(864000000) // "10d" (10 days)
 * formatRelativeTime(2678400000) // "30+ days" (31 days)
 */
export function formatRelativeTime(ageMs) {
    const minutes = Math.floor(ageMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    // Edge cases
    if (minutes < 1) return 'Just now';
    if (days > 30) return '30+ days';

    // Format based on age
    if (days > 7) return `${days}d`;
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}

/**
 * Format numbers for networth display with decimal precision
 * Uses 2 decimal places for better readability in detailed breakdowns
 * @param {number} num - The number to format
 * @returns {string} Formatted number (e.g., "1.23K", "45.67M", "89.01B")
 *
 * @example
 * networthFormatter(1234) // "1.23K"
 * networthFormatter(45678) // "45.68K"
 * networthFormatter(1234567) // "1.23M"
 * networthFormatter(89012345) // "89.01M"
 * networthFormatter(1234567890) // "1.23B"
 */
export function networthFormatter(num) {
    if (num === null || num === undefined) {
        return null;
    }

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    // 0-999: raw number (no decimals needed)
    if (absNum < 1000) {
        return sign + Math.floor(absNum).toString();
    }
    // 1,000-999,999: K with 2 decimals
    if (absNum < 1000000) {
        return sign + (absNum / 1000).toFixed(2) + 'K';
    }
    // 1M-999,999,999: M with 2 decimals
    if (absNum < 1000000000) {
        return sign + (absNum / 1000000).toFixed(2) + 'M';
    }
    // 1B+: B with 2 decimals
    return sign + (absNum / 1000000000).toFixed(2) + 'B';
}

/**
 * Format a decimal value as a percentage
 * @param {number} value - The decimal value to format (e.g., 0.05 for 5%)
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage (e.g., "5.0%", "12.5%")
 *
 * @example
 * formatPercentage(0.05) // "5.0%"
 * formatPercentage(0.125, 1) // "12.5%"
 * formatPercentage(0.00123, 2) // "0.12%"
 * formatPercentage(0.00123, 3) // "0.123%"
 */
export function formatPercentage(value, decimals = 1) {
    if (value === null || value === undefined) {
        return null;
    }

    return (value * 100).toFixed(decimals) + '%';
}

/**
 * Format currency/coin amounts intelligently based on context
 * @param {number} amount - The amount to format
 * @param {Object} options - Formatting options
 * @param {string} options.style - 'game' (4-digit), 'compact' (K/M/B), 'full' (thousand separators), 'networth' (2 decimals)
 * @param {number} options.decimals - Decimal places for compact style (default: 1)
 * @returns {string} Formatted currency string
 *
 * @example
 * formatCurrency(1500, {style: 'game'}) // "1,500"
 * formatCurrency(1500000, {style: 'game'}) // "1,500K"
 * formatCurrency(1500000, {style: 'compact'}) // "1.5M"
 * formatCurrency(1500000, {style: 'full'}) // "1,500,000"
 * formatCurrency(1234, {style: 'networth'}) // "1.23K"
 */
export function formatCurrency(amount, options = {}) {
    const style = options.style || 'game';
    const decimals = options.decimals !== undefined ? options.decimals : 1;

    switch (style) {
        case 'game':
            return coinFormatter(amount);
        case 'compact':
            return formatKMB(amount, decimals);
        case 'networth':
            return networthFormatter(amount);
        case 'full':
            return formatWithSeparator(amount);
        default:
            return coinFormatter(amount);
    }
}

/**
 * Format numbers in compact notation (K/M/B)
 * Alias for formatKMB for clearer naming
 * @param {number} value - The number to format
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted number (e.g., "1.5K", "2.3M", "1.2B")
 *
 * @example
 * formatCompactNumber(1500) // "1.5K"
 * formatCompactNumber(2300000) // "2.3M"
 * formatCompactNumber(1234567890) // "1.2B"
 */
export function formatCompactNumber(value, decimals = 1) {
    return formatKMB(value, decimals);
}

/**
 * Format large numbers based on user preference
 * Uses K/M/B notation or full numbers depending on setting
 * @param {number} value - The number to format
 * @param {number} decimals - Number of decimal places for K/M/B format (default: 1)
 * @returns {string} Formatted number (e.g., "1.5M" or "1,500,000")
 *
 * @example
 * // With K/M/B enabled (default)
 * formatLargeNumber(1500000) // "1.5M"
 * formatLargeNumber(2300) // "2.3K"
 *
 * // With K/M/B disabled
 * formatLargeNumber(1500000) // "1,500,000"
 * formatLargeNumber(2300) // "2,300"
 */
export function formatLargeNumber(value, decimals = 1) {
    const useAbbreviations = config.getSetting('formatting_useKMBFormat') !== false;
    return useAbbreviations ? formatKMB(value, decimals) : formatWithSeparator(value);
}
