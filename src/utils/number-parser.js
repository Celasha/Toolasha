/**
 * Number Parser Utility
 * Shared utilities for parsing numeric values from text, including item counts
 */

/**
 * Parse item count from text
 * Handles various formats including:
 * - Plain numbers: "100", "1000"
 * - K/M suffixes: "1.5K", "2M"
 * - International formats with separators: "1,000", "1 000", "1.000"
 * - Mixed decimal formats: "1.234,56" (European) or "1,234.56" (US)
 * - Prefixed formats: "x5", "Amount: 1000", "Amount: 1 000"
 *
 * @param {string} text - Text containing a number
 * @param {number} defaultValue - Value to return if parsing fails (default: 1)
 * @returns {number} Parsed numeric value
 */
export function parseItemCount(text, defaultValue = 1) {
    if (!text) {
        return defaultValue;
    }

    // Convert to string and normalize
    text = String(text).toLowerCase().trim();

    // Extract number from common patterns like "x5", "Amount: 1000"
    const prefixMatch = text.match(/x([\d,\s.kmb]+)|amount:\s*([\d,\s.kmb]+)/i);
    if (prefixMatch) {
        text = prefixMatch[1] || prefixMatch[2];
    }

    // Determine whether periods and commas are thousands separators or decimal points.
    // Rules:
    // 1. If both exist: the one appearing first (or multiple times) is the thousands separator.
    //    e.g. "1.234,56" → period is thousands, comma is decimal → 1234.56
    //    e.g. "1,234.56" → comma is thousands, period is decimal → 1234.56
    // 2. If only commas exist and comma is followed by exactly 3 digits at end: thousands separator.
    //    e.g. "1,234" → 1234
    // 3. If only periods exist and period is followed by exactly 3 digits at end: thousands separator.
    //    e.g. "1.234" → 1234
    // 4. Otherwise treat as decimal separator.
    //    e.g. "1.5" → 1.5,  "1,5" → 1.5

    const hasPeriod = text.includes('.');
    const hasComma = text.includes(',');

    if (hasPeriod && hasComma) {
        // Both present — whichever comes last is the decimal separator
        const lastPeriod = text.lastIndexOf('.');
        const lastComma = text.lastIndexOf(',');
        if (lastPeriod > lastComma) {
            // Period is decimal: remove commas as thousands separators
            text = text.replace(/,/g, '');
        } else {
            // Comma is decimal: remove periods as thousands separators, replace comma with period
            text = text.replace(/\./g, '').replace(',', '.');
        }
    } else if (hasComma) {
        // Only commas: thousands separator if followed by exactly 3 digits at end, else decimal
        if (/,\d{3}$/.test(text)) {
            text = text.replace(/,/g, '');
        } else {
            text = text.replace(',', '.');
        }
    } else if (hasPeriod) {
        // Only periods: thousands separator if followed by exactly 3 digits at end, else decimal
        if (/\.\d{3}$/.test(text)) {
            text = text.replace(/\./g, '');
        }
        // else leave as-is (valid decimal like "1.5")
    }

    // Remove remaining whitespace separators
    text = text.replace(/\s/g, '');

    // Handle K/M/B suffixes (must end with the suffix letter)
    if (/\d[kmb]$/.test(text)) {
        if (text.endsWith('k')) {
            return parseFloat(text) * 1000;
        } else if (text.endsWith('m')) {
            return parseFloat(text) * 1000000;
        } else if (text.endsWith('b')) {
            return parseFloat(text) * 1000000000;
        }
    }

    // Parse plain number
    const parsed = parseFloat(text);
    return isNaN(parsed) ? defaultValue : parsed;
}
