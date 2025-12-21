/**
 * Formatting Utilities
 * Pure functions for formatting numbers and time
 */

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
 * @returns {string} Formatted time (e.g., "1h 23m 45s" or "2.5 days")
 *
 * @example
 * timeReadable(3661) // "1h 01m 01s"
 * timeReadable(90000) // "1.0 days"
 */
export function timeReadable(sec) {
    // For times >= 1 day, show in days
    if (sec >= 86400) {
        return Number(sec / 86400).toFixed(1) + " days";
    }

    // For times < 1 day, show as HH:MM:SS
    const d = new Date(Math.round(sec * 1000));
    function pad(i) {
        return ("0" + i).slice(-2);
    }
    let str = d.getUTCHours() + "h " + pad(d.getUTCMinutes()) + "m " + pad(d.getUTCSeconds()) + "s";
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
