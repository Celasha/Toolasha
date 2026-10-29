/**
 * Scroll Planner logic
 * Pure helpers: which items count as scrolls, plan normalization, and run construction.
 *
 * A run is a list of steps, one per scroll type. Each step stores `targetCount`, the inventory
 * count at which the step is finished (owned at run start minus the planned quantity). Because
 * inventory is the source of truth, completion is just `owned <= targetCount`, which also makes a
 * run resumable after a reload without storing an index.
 */

const SCROLL_CATEGORY_HRID = '/item_categories/scroll';
const INVENTORY_LOCATION_HRID = '/item_locations/inventory';

/**
 * Scroll item HRIDs in the game's own sort order.
 * @param {Object} itemDetailMap - init_client_data itemDetailMap
 * @returns {string[]}
 */
export function getScrollHrids(itemDetailMap) {
    if (!itemDetailMap) {
        return [];
    }
    return Object.entries(itemDetailMap)
        .filter(([, item]) => item?.categoryHrid === SCROLL_CATEGORY_HRID && item.isOpenable)
        .sort(([, a], [, b]) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
        .map(([hrid]) => hrid);
}

/**
 * @param {Array} characterItems
 * @param {string} itemHrid
 * @returns {number} Unenhanced inventory count of the item
 */
export function getOwnedCount(characterItems, itemHrid) {
    if (!Array.isArray(characterItems)) {
        return 0;
    }
    let total = 0;
    for (const item of characterItems) {
        if (
            item?.itemHrid === itemHrid &&
            item.itemLocationHrid === INVENTORY_LOCATION_HRID &&
            !(item.enhancementLevel > 0)
        ) {
            total += item.count || 0;
        }
    }
    return total;
}

/**
 * Keep only positive whole-number quantities for known scrolls.
 * @param {*} rawPlan - Possibly stale or malformed stored plan
 * @param {string[]} scrollHrids - Valid scroll HRIDs
 * @returns {Object<string, number>}
 */
export function normalizePlan(rawPlan, scrollHrids) {
    const valid = new Set(scrollHrids);
    const plan = {};
    if (!rawPlan || typeof rawPlan !== 'object') {
        return plan;
    }
    for (const [hrid, quantity] of Object.entries(rawPlan)) {
        const whole = Math.floor(Number(quantity));
        if (valid.has(hrid) && whole > 0) {
            plan[hrid] = whole;
        }
    }
    return plan;
}

/**
 * Build a run from a plan against what this character owns.
 * @param {Object<string, number>} plan
 * @param {string[]} scrollHrids - Ordering of steps
 * @param {Array} characterItems
 * @returns {{steps: Array<{itemHrid: string, quantity: number, planned: number, targetCount: number, skipped: boolean}>,
 *   shortfalls: Array<{itemHrid: string, planned: number, owned: number}>}}
 */
export function buildRun(plan, scrollHrids, characterItems) {
    const steps = [];
    const shortfalls = [];
    for (const itemHrid of scrollHrids) {
        const planned = plan[itemHrid];
        if (!(planned > 0)) {
            continue;
        }
        const owned = getOwnedCount(characterItems, itemHrid);
        const quantity = Math.min(planned, owned);
        if (quantity < planned) {
            shortfalls.push({ itemHrid, planned, owned });
        }
        if (quantity > 0) {
            steps.push({ itemHrid, quantity, planned, targetCount: owned - quantity, skipped: false });
        }
    }
    return { steps, shortfalls };
}

/**
 * @param {{itemHrid: string, targetCount: number, skipped: boolean}} step
 * @param {Array} characterItems
 * @returns {boolean}
 */
export function isStepFinished(step, characterItems) {
    return step.skipped || getOwnedCount(characterItems, step.itemHrid) <= step.targetCount;
}

/**
 * First unfinished step, or null when the run is complete.
 * @param {Array} steps
 * @param {Array} characterItems
 * @returns {{step: Object, index: number}|null}
 */
export function getCurrentStep(steps, characterItems) {
    for (let index = 0; index < steps.length; index++) {
        if (!isStepFinished(steps[index], characterItems)) {
            return { step: steps[index], index };
        }
    }
    return null;
}

/**
 * Scrolls still to open for a step (shrinks as the player opens them).
 * @param {{itemHrid: string, targetCount: number}} step
 * @param {Array} characterItems
 * @returns {number}
 */
export function getRemainingQuantity(step, characterItems) {
    return Math.max(0, getOwnedCount(characterItems, step.itemHrid) - step.targetCount);
}
