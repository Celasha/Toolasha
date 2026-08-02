/**
 * Inline XP/hour display helpers for Alchemy and Enhancing action panels.
 *
 * The game renders the native Experience row with the
 * SkillActionDetail_expOnSuccess class. Toolasha appends one compact rate to
 * that exact row, preserving the native amount and XP icon.
 */

import config from '../../core/config.js';
import { formatKMB3Digits, formatWithSeparator } from '../../utils/formatters.js';

const INLINE_RATE_SELECTOR = '[data-mwi-inline-xp-rate]';

/**
 * Find the native Experience row owned by an Alchemy or Enhancing component.
 * @param {HTMLElement} panel
 * @returns {HTMLElement|null}
 */
export function findNativeExperienceRow(panel) {
    if (!panel) return null;

    const rows = Array.from(panel.querySelectorAll('[class*="SkillActionDetail_expOnSuccess"]')).filter(
        (row) => row.isConnected
    );

    return rows.length === 1 ? rows[0] : null;
}

/**
 * Render or update an inline XP/hour value after the native Experience value.
 * @param {HTMLElement} panel
 * @param {number} xpPerHour
 * @param {{ approximate?: boolean, owner: string }} options
 * @returns {HTMLElement|null}
 */
export function renderInlineXpRate(panel, xpPerHour, { approximate = false, owner } = {}) {
    const existing = panel?.querySelector(`${INLINE_RATE_SELECTOR}[data-mwi-inline-xp-owner="${owner || ''}"]`);

    if (!Number.isFinite(xpPerHour) || xpPerHour <= 0) {
        existing?.remove();
        return null;
    }

    const experienceRow = findNativeExperienceRow(panel);
    if (!experienceRow) {
        existing?.remove();
        return null;
    }

    // A React rerender can replace the native row while leaving a stale Toolasha
    // node elsewhere in the panel. Always keep exactly one node on the live row.
    panel.querySelectorAll(`${INLINE_RATE_SELECTOR}[data-mwi-inline-xp-owner="${owner || ''}"]`).forEach((node) => {
        if (node.parentElement !== experienceRow) node.remove();
    });

    const rate =
        experienceRow.querySelector(`${INLINE_RATE_SELECTOR}[data-mwi-inline-xp-owner="${owner || ''}"]`) ||
        document.createElement('span');

    rate.setAttribute('data-mwi-inline-xp-rate', 'true');
    rate.setAttribute('data-mwi-inline-xp-owner', owner || '');
    rate.style.cssText = `
        margin-left: 6px;
        color: ${config.COLOR_XP_RATE};
        white-space: nowrap;
        font-size: 0.95em;
    `;

    const roundedRate = Math.round(xpPerHour);
    rate.textContent = `· ${approximate ? '~' : ''}${formatKMB3Digits(roundedRate)} XP/hr`;
    rate.title = `${approximate ? 'Expected: ' : ''}${formatWithSeparator(roundedRate)} XP/hr`;
    rate.setAttribute('aria-label', rate.title);

    if (!rate.isConnected) experienceRow.appendChild(rate);
    return rate;
}

/**
 * Remove an inline rate owned by one feature.
 * @param {HTMLElement|Document} root
 * @param {string} owner
 */
export function removeInlineXpRate(root, owner) {
    root?.querySelectorAll?.(`${INLINE_RATE_SELECTOR}[data-mwi-inline-xp-owner="${owner}"]`).forEach((node) => {
        node.remove();
    });
}
