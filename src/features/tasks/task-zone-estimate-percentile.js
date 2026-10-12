/**
 * Shared helpers for the percentile-based combat zone fight estimates (task cards and the
 * task statistics popup): reads the coverage setting and builds the percentile label and the
 * "median" hover hint.
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import { timeReadable, formatKMB } from '../../utils/formatters.js';

const ALLOWED_PERCENTS = [50, 80, 90, 95];
const DEFAULT_PERCENT = 90;

/**
 * @returns {number} Selected coverage as a fraction (0.5 - 0.95)
 */
export function getZoneEstimatePercentile() {
    const raw = Number(config.getSettingValue('taskCombatEstimatePercentile', String(DEFAULT_PERCENT)));
    return (ALLOWED_PERCENTS.includes(raw) ? raw : DEFAULT_PERCENT) / 100;
}

/**
 * @param {number|null} percentile - Coverage actually used, or null when the mean fallback was used
 * @returns {string} Localized suffix such as " (90%)", or '' for the mean fallback
 */
export function formatPercentileSuffix(percentile) {
    if (percentile === null || percentile === undefined) return '';
    return t('taskProfitDisplay.zonePercentileSuffix', { percent: Math.round(percentile * 100) });
}

/**
 * Build the circled "?" indicator whose tooltip shows the median estimate next to the
 * conservative figure on the main line.
 * @param {{percentile: number|null, medianFightsNeeded: number|null, medianHoursNeeded: number|null}} estimate
 * @returns {HTMLElement|null} Null when the main line already is the median, or no median exists
 */
export function createMedianHint(estimate) {
    if (estimate.percentile === null || estimate.percentile === undefined) return null;
    if (estimate.percentile === 0.5) return null;
    if (!Number.isFinite(estimate.medianFightsNeeded) || !Number.isFinite(estimate.medianHoursNeeded)) return null;

    const hint = document.createElement('span');
    hint.className = 'mwi-zone-estimate-hint';
    hint.textContent = '?';
    hint.title = t('taskProfitDisplay.zoneMedianHint', {
        percent: Math.round(estimate.percentile * 100),
        fights: formatKMB(estimate.medianFightsNeeded),
        time: timeReadable(Math.round(estimate.medianHoursNeeded * 3600)),
    });
    hint.addEventListener('click', (e) => e.stopPropagation());
    hint.style.cssText =
        'display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; margin-left: 4px; border: 1px solid currentColor; border-radius: 50%; font-size: 9px; line-height: 1; cursor: help; opacity: 0.8;';
    return hint;
}
