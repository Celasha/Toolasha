/**
 * Shop Max Buy Helper
 * Pure functions for resolving a buy modal's cost line(s) to item hrids and computing the
 * most affordable quantity. Used by shop-max-buy-button.js's "Max" button injection.
 *
 * Cost-line detection is purely structural (the cost row is always the quantity input's next
 * sibling) rather than matching an English "You Pay" string, so it keeps working on non-English
 * clients - the same class of bug fixed in PR #750 for other name/HRID lookups.
 */

import dataManager from '../core/data-manager.js';
import { getItemHridFromName } from './game-lookups.js';

const INVENTORY_LOCATION = '/item_locations/inventory';
const COWBELL_HRID = '/items/cowbell';
const BUFF_TYPE_PREFIX = '/buff_types/';
const AMOUNT_RE = /\d[\d.,\s]*\d|\d/;

/**
 * Resolve the owned count of an item from inventory, summed across all enhancement levels.
 * @param {string} itemHrid
 * @returns {number}
 */
function getOwnedCount(itemHrid) {
    const inventory = dataManager.getInventory();
    if (!inventory) return 0;

    let total = 0;
    for (const item of inventory) {
        if (item?.itemHrid === itemHrid && item.itemLocationHrid === INVENTORY_LOCATION) {
            total += item.count || 0;
        }
    }
    return total;
}

/**
 * Parse a locale-formatted amount (digits plus thousands separators/whitespace) into an integer.
 * @param {string} text
 * @returns {{amount: number, matchEnd: number}|null}
 */
function matchAmount(text) {
    const match = text.match(AMOUNT_RE);
    if (!match) return null;

    const digitsOnly = match[0].replace(/[.,\s]/g, '');
    const amount = parseInt(digitsOnly, 10);
    if (!Number.isFinite(amount)) return null;

    return { amount, matchEnd: match.index + match[0].length };
}

/**
 * Find the innermost divs inside the cost row that contain a digit (one per currency the
 * item costs). "Innermost" excludes any div whose descendant div also contains a digit, so a
 * wrapper around multiple cost lines doesn't get treated as one.
 * @param {Element} costContainer
 * @returns {Array<Element>}
 */
function getCandidateRows(costContainer) {
    const divs = Array.from(costContainer.querySelectorAll('div'));
    const pool = divs.length ? divs : [costContainer];

    return pool.filter((el) => {
        if (!/\d/.test(el.textContent || '')) return false;
        return !Array.from(el.querySelectorAll('div')).some((d) => /\d/.test(d.textContent || ''));
    });
}

/**
 * Resolve a buy modal's cost line(s) to item hrids + per-unit amounts.
 * @param {Element} inputContainer - the *Panel_inputContainer element the Max button is attached to
 * @param {'text'|'icon'} costStyle - 'text' for Shop tab ("You Pay: 5,000 Coin" as plain text),
 *   'icon' for Task Shop/Labyrinth Shop/Cowbell Store ("You Pay: 50" + a currency sprite icon)
 * @returns {Array<{itemHrid: string, perUnitAmount: number}>}
 */
export function resolveCostLines(inputContainer, costStyle) {
    const costContainer = inputContainer?.nextElementSibling;
    if (!costContainer) return [];

    const lines = [];

    for (const row of getCandidateRows(costContainer)) {
        const parsed = matchAmount(row.textContent);
        if (!parsed) continue;

        if (costStyle === 'icon') {
            const use = row.querySelector('svg use');
            const href = use?.getAttribute('href') || use?.getAttribute('xlink:href');
            const fragment = href?.split('#')[1];
            if (!fragment) continue;

            lines.push({ itemHrid: `/items/${fragment}`, perUnitAmount: parsed.amount });
        } else {
            const itemName = row.textContent.slice(parsed.matchEnd).trim();
            const itemHrid = itemName ? getItemHridFromName(itemName) : null;
            if (!itemHrid) continue;

            lines.push({ itemHrid, perUnitAmount: parsed.amount });
        }
    }

    return lines;
}

/**
 * Compute the max quantity affordable across every cost line (min of each line's
 * floor(owned / perUnitAmount)), clamped to >= 1.
 * @param {Array<{itemHrid: string, perUnitAmount: number}>} costLines
 * @returns {number|null} null if there are no resolvable cost lines, or owned < 1 unit's cost
 *   on any line (the caller should leave the input untouched in that case).
 */
export function computeMaxAffordable(costLines) {
    if (!costLines.length) return null;

    let max = Infinity;
    for (const { itemHrid, perUnitAmount } of costLines) {
        if (!perUnitAmount || perUnitAmount <= 0) return null;
        const owned = getOwnedCount(itemHrid);
        max = Math.min(max, Math.floor(owned / perUnitAmount));
    }

    return max >= 1 ? max : null;
}

/**
 * Resolve the Cowbell Store's Community Buff dialog to its per-minute cowbell cost from game data.
 * The dialog's "You Pay" row shows the cost of whatever quantity is typed in (it opens at 10
 * minutes), so it can't be read as a unit price. The buff is identified by the dialog's icon
 * (`buffs_sprite.svg#<name>`), which matches each buff's `buff.typeHrid` minus `/buff_types/`.
 * @param {Element} inputContainer - the CowbellStorePanel_inputContainer element
 * @returns {Array<{itemHrid: string, perUnitAmount: number}>|null} null when this isn't a
 *   Community Buff dialog or the buff/cost can't be resolved
 */
export function resolveCommunityBuffCostLines(inputContainer) {
    const modal = inputContainer?.parentElement;
    const use = modal?.querySelector('[class*="CommunityBuff_communityBuff"] svg use');
    const href = use?.getAttribute('href') || use?.getAttribute('xlink:href');
    const iconName = href?.split('#')[1];
    if (!iconName) return null;

    const detailMap = dataManager.getInitClientData()?.communityBuffTypeDetailMap;
    if (!detailMap) return null;

    const buffType = Object.values(detailMap).find(
        (detail) => detail?.buff?.typeHrid === `${BUFF_TYPE_PREFIX}${iconName}`
    );
    const cost = buffType?.cowbellCost;
    if (!(cost > 0)) return null;

    return [{ itemHrid: COWBELL_HRID, perUnitAmount: cost }];
}

/**
 * Convert cost lines read from a dialog that shows the total for the typed quantity into
 * per-unit lines. Returns the lines unchanged when the quantity isn't a positive integer that
 * divides every amount exactly (nothing reliable to normalise by).
 * @param {Array<{itemHrid: string, perUnitAmount: number}>} costLines
 * @param {number} quantity - the quantity currently typed into the dialog
 * @returns {Array<{itemHrid: string, perUnitAmount: number}>}
 */
export function normalizeCostLinesToUnit(costLines, quantity) {
    if (!Number.isInteger(quantity) || quantity <= 1) return costLines;
    if (costLines.some((line) => line.perUnitAmount % quantity !== 0)) return costLines;
    return costLines.map((line) => ({ ...line, perUnitAmount: line.perUnitAmount / quantity }));
}
