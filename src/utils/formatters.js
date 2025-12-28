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
