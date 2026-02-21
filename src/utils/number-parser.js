/**
 * Number Parser Utility
 * Shared utilities for parsing numeric values from text, including item counts
 */

/**
 * Parse item count from text
 * Handles various formats including:
 * - Plain numbers: "100", "1000"
 * - K/M suffixes: "1.5K", "2M"
 * - International formats with separators: "1,000", "1 000"
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

    // Remove all whitespace and comma separators (handles international formats)
    text = text.replace(/[\s,]/g, '');

    // Handle K/M/B suffixes
    if (text.includes('k')) {
        return parseFloat(text.replace('k', '')) * 1000;
    } else if (text.includes('m')) {
        return parseFloat(text.replace('m', '')) * 1000000;
    } else if (text.includes('b')) {
        return parseFloat(text.replace('b', '')) * 1000000000;
    }

    // Parse plain number
    const parsed = parseFloat(text);
    return isNaN(parsed) ? defaultValue : parsed;
}
