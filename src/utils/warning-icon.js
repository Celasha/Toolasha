/**
 * Shared warning-icon helper
 * Produces the inline ⚠ markup used throughout Toolasha to flag estimated/overridden values,
 * matching the existing pattern (orange COLOR_WARNING span with a title tooltip).
 */

import config from '../core/config.js';
import { t } from '../core/i18n.js';

/**
 * Build a bare ⚠ warning icon span with a tooltip.
 * @param {string} tooltipText
 * @returns {string} HTML string, e.g. `<span style="color: #ffa500;" title="...">⚠</span>`
 */
export function buildWarningIcon(tooltipText) {
    return `<span style="color: ${config.COLOR_WARNING};" title="${tooltipText}">⚠</span>`;
}

/**
 * Build the icon (with a leading space, ready to append after a displayed value) flagging that
 * a price was substituted by the market-data outlier guard, or an empty string when it wasn't.
 * @param {boolean} isOutlier
 * @returns {string}
 */
export function buildOutlierPriceWarningIcon(isOutlier) {
    if (!isOutlier) {
        return '';
    }
    return ' ' + buildWarningIcon(t('marketData.outlierPriceWarningTooltip'));
}
