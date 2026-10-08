import { t } from '../../core/i18n.js';
import dataManager from '../../core/data-manager.js';
import { getGuildShrineName } from '../../utils/game-i18n.js';

/**
 * Normalize the text captured from a Guild shrine modal for the Marketplace Return tab.
 * The game renders adjacent shrine/domain labels without guaranteed whitespace, so insert
 * camel-case boundaries before extracting the exact user-facing destination.
 *
 * Under a non-English client the modal text is fully localized, so the English
 * regexes below will not match. As a fallback we walk the game's
 * guildShrineDetailMap and return the first shrine name (English or translated)
 * that appears in the modal text — that yields a specific shrine label rather
 * than the generic "Guild" fallback.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeGuildShrineReturnLabel(text) {
    const normalized = String(text || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    return (
        normalized.match(/Shrine of [A-Za-z]+ (?:Combat|Skilling) Level/)?.[0] ||
        normalized.match(/Shrine of [A-Za-z]+/)?.[0] ||
        matchTranslatedShrineName(normalized) ||
        t('guildCreditValue.returnLabelFallback')
    );
}

/**
 * Walk the game's guildShrineDetailMap and return the first shrine name
 * (translated or English) that appears in the modal text. Returns '' if no
 * match is found, so the caller falls through to the generic label.
 * @param {string} text
 * @returns {string}
 */
export function matchTranslatedShrineName(text) {
    if (!text) return '';
    const shrineMap = dataManager.getInitClientData()?.guildShrineDetailMap;
    if (!shrineMap) return '';
    for (const [hrid, details] of Object.entries(shrineMap)) {
        const enName = details?.name;
        if (enName && text.includes(enName)) return enName;
        const translated = getGuildShrineName(hrid, enName || '');
        if (translated && translated !== enName && text.includes(translated)) return translated;
    }
    return '';
}
