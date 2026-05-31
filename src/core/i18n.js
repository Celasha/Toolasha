/**
 * Internationalization (i18n) Module
 * Lightweight translation layer with English-as-key fallback.
 *
 * Usage:
 *   import { t, registerLocale } from '../core/i18n.js';
 *   t('Market Prices in Tooltips')  →  '市场价格提示' (if translated)
 *   t('Market Prices in Tooltips')  →  'Market Prices in Tooltips' (fallback)
 *   t('Cost: {0}/hr', '100K')       →  '花费: 100K/时'
 */

/** @type {Record<string, string>} */
const translations = {};

/**
 * Register a locale dictionary.
 * Merges into existing translations (last write wins for duplicate keys).
 * @param {string} _localeCode - Locale identifier (e.g., 'zh-CN'), reserved for future multi-locale support
 * @param {Record<string, string>} dict - Key-value translation pairs
 */
export function registerLocale(_localeCode, dict) {
    Object.assign(translations, dict);
}

/**
 * Translate a string. Returns the Chinese translation if available, otherwise the English key itself.
 * Supports positional interpolation with {0}, {1}, etc.
 *
 * @param {string} str - English key string
 * @param {...(string|number)} args - Positional arguments for interpolation
 * @returns {string} Translated or fallback string
 *
 * @example
 *   t('Hello')                          // '你好'
 *   t('Unknown key')                    // 'Unknown key' (fallback)
 *   t('Profit: {0}/hr', '12.3K')        // '利润: 12.3K/时'
 */
export function t(str, ...args) {
    const translated = translations[str] !== undefined ? translations[str] : str;

    if (args.length === 0) {
        return translated;
    }

    return translated.replace(/\{(\d+)\}/g, (_, index) => {
        const arg = args[parseInt(index, 10)];
        return arg !== undefined ? String(arg) : `{${index}}`;
    });
}

export default { t, registerLocale };
