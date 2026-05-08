/**
 * i18n utility
 * Automatically detects the game language setting to switch between English and Chinese
 */

export const isZH = localStorage.getItem("i18nextLng")?.toLowerCase()?.startsWith("zh") ?? false;

/**
 * Returns the translated string if Chinese is active, otherwise the English string.
 * @param {string} enText English text
 * @param {string} zhText Chinese text
 * @returns {string} The localized text
 */
export function t(enText, zhText) {
    return isZH && zhText ? zhText : enText;
}
