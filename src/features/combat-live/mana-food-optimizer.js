/**
 * Mana food optimizer
 *
 * Given how much mana per minute you want from food, finds the cheapest set of mana foods that gets
 * there. Pure logic over the game's item data and a price function: nothing here is a hand-kept list of
 * foods.
 *
 * What the game does (from its data and the combat simulator): a mana food restores a fixed amount, can
 * be used again once its cooldown (60 s for every one, shortened by food haste) has passed, and by
 * default fires when the player is missing at least that much mana. Used as often as it can be, an item
 * gives restore / cooldown per minute, so that is the most an item can contribute. Each food slot holds
 * one item.
 */

const NS_PER_MS = 1e6;
const SECONDS_PER_DAY = 86400;

/**
 * Every item that restores mana and can be used in combat.
 * @param {Object<string, Object>} itemDetailMap
 * @returns {Array<{hrid: string, restore: number, cooldownMs: number}>}
 */
export function findManaFoods(itemDetailMap) {
    const foods = [];
    for (const [hrid, item] of Object.entries(itemDetailMap || {})) {
        const detail = item?.consumableDetail;
        if (!(detail?.manapointRestore > 0)) continue;
        if (item.usableInActionTypeMap && !item.usableInActionTypeMap['/action_types/combat']) continue;
        foods.push({ hrid, restore: detail.manapointRestore, cooldownMs: (detail.cooldownDuration || 0) / NS_PER_MS });
    }
    return foods.filter((food) => food.cooldownMs > 0);
}

/**
 * @param {{restore: number, cooldownMs: number}} food
 * @param {number} foodHaste - 0.1 for 10% faster cooldowns
 * @returns {{usesPerDay: number, perMinute: number}} The most this food can give, used on every cooldown
 */
export function foodRate(food, foodHaste = 0) {
    const cooldownSeconds = food.cooldownMs / 1000 / (1 + foodHaste);
    return {
        usesPerDay: SECONDS_PER_DAY / cooldownSeconds,
        perMinute: (food.restore * 60) / cooldownSeconds,
    };
}

/**
 * @param {Array} items
 * @param {number} size
 * @returns {Array[]} Every combination of `size` items
 */
function combinations(items, size) {
    if (size === 0) return [[]];
    const result = [];
    items.forEach((item, index) => {
        for (const rest of combinations(items.slice(index + 1), size - 1)) result.push([item, ...rest]);
    });
    return result;
}

/**
 * The cheapest set of at most `slots` different foods that reaches the target. When nothing can, the set
 * that gives the most mana.
 * @param {Object} options
 * @param {Array<{hrid: string, restore: number, cooldownMs: number}>} options.foods
 * @param {function(string): ?{price: number, isOutlier?: boolean}} options.priceOf - null when unpriced
 * @param {number} options.targetPerMinute - Mana per minute wanted from food
 * @param {number} options.slots - Food slots available for mana food
 * @param {number} [options.foodHaste]
 * @param {number} [options.maxMana] - A food that restores more than this can never fire, so it is left out
 * @returns {{reachable: boolean, items: Array, totalPerMinute: number, totalCostPerDay: number, deficit: number, unpriced: string[]}}
 */
export function optimizeManaFood({ foods, priceOf, targetPerMinute, slots, foodHaste = 0, maxMana = Infinity }) {
    const unpriced = [];
    const candidates = [];
    for (const food of foods) {
        if (food.restore > maxMana) continue;
        const priced = priceOf(food.hrid);
        if (!priced || !(priced.price > 0)) {
            unpriced.push(food.hrid);
            continue;
        }
        const { usesPerDay, perMinute } = foodRate(food, foodHaste);
        candidates.push({
            hrid: food.hrid,
            restore: food.restore,
            unitPrice: priced.price,
            isOutlier: Boolean(priced.isOutlier),
            usesPerDay,
            perMinute,
            costPerDay: usesPerDay * priced.price,
        });
    }

    const size = Math.max(0, Math.min(Math.floor(slots), candidates.length));
    let best = null;
    let richest = null;
    for (let count = 1; count <= size; count++) {
        for (const set of combinations(candidates, count)) {
            const perMinute = set.reduce((sum, item) => sum + item.perMinute, 0);
            const cost = set.reduce((sum, item) => sum + item.costPerDay, 0);
            if (!richest || perMinute > richest.perMinute || (perMinute === richest.perMinute && cost < richest.cost)) {
                richest = { set, perMinute, cost };
            }
            if (
                perMinute >= targetPerMinute &&
                (!best || cost < best.cost || (cost === best.cost && set.length < best.set.length))
            ) {
                best = { set, perMinute, cost };
            }
        }
    }

    const chosen = best || richest;
    return {
        reachable: Boolean(best),
        items: chosen ? [...chosen.set].sort((a, b) => b.perMinute - a.perMinute) : [],
        totalPerMinute: chosen ? chosen.perMinute : 0,
        totalCostPerDay: chosen ? chosen.cost : 0,
        deficit: best || !richest ? 0 : Math.max(0, targetPerMinute - richest.perMinute),
        unpriced,
    };
}

export default optimizeManaFood;
