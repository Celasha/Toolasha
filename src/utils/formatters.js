/**
 * Formatting Utilities
 * Pure functions for formatting numbers and time
 */

/**
 * Format large numbers with K/M/B suffixes
 * @param {number} num - The number to format
 * @param {number} digits - Number of decimal places (default: 1)
 * @returns {string} Formatted number (e.g., "1.2M", "500k")
 *
 * @example
 * numberFormatter(1500) // "1.5k"
 * numberFormatter(1500000) // "1.5M"
 * numberFormatter(1500000000) // "1.5B"
 */
export function numberFormatter(num, digits = 1) {
    if (num === null || num === undefined) {
        return null;
    }
    if (num < 0) {
        return "-" + numberFormatter(-num, digits);
    }
    const lookup = [
        { value: 1, symbol: "" },
        { value: 1e3, symbol: "k" },
        { value: 1e6, symbol: "M" },
        { value: 1e9, symbol: "B" },
    ];
    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    var item = lookup
        .slice()
        .reverse()
        .find(function (item) {
            return num >= item.value;
        });
    return item ? (num / item.value).toFixed(digits).replace(rx, "$1") + item.symbol : "0";
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
