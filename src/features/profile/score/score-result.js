/**
 * Score Result Plumbing
 *
 * Shared {score, complete, unpricedCount, breakdown} shape used by every TLA-041 Score
 * category (Houses/Abilities/Equipment/Shrines) and by the Combat/Skiller top-level totals.
 * `complete: false` means at least one contributing leaf could not be priced — the category's
 * `score` is then a lower bound, never a substituted zero.
 */

/**
 * @returns {{score: number, complete: boolean, unpricedCount: number, breakdown: Array<{name: string, value: string}>}}
 */
export function emptyCategory() {
    return { score: 0, complete: true, unpricedCount: 0, breakdown: [] };
}

/**
 * Add one priced leaf into a category, in place.
 * @param {{score: number, complete: boolean, unpricedCount: number, breakdown: Array}} category
 * @param {{name: string, cost: number|null, complete: boolean}} leaf - cost is in raw coins
 */
export function attribute(category, leaf) {
    if (!leaf.complete || !(leaf.cost > 0)) {
        category.complete = category.complete && leaf.complete;
        if (!leaf.complete) category.unpricedCount += 1;
        if (!(leaf.cost > 0)) return;
    }

    const scoreValue = leaf.cost / 1_000_000;
    category.score += scoreValue;
    category.breakdown.push({ name: leaf.name, value: scoreValue.toFixed(1) });
}

/**
 * Combine several category results (e.g. Houses + Abilities + Equipment + Shrines into a
 * top-level Combat/Skiller total).
 * @param {Array<{score: number, complete: boolean, unpricedCount: number, breakdown: Array}>} parts
 */
export function mergeCategory(parts) {
    const merged = emptyCategory();
    for (const part of parts) {
        merged.score += part.score;
        merged.complete = merged.complete && part.complete;
        merged.unpricedCount += part.unpricedCount;
        merged.breakdown.push(...part.breakdown);
    }
    merged.breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
    return merged;
}

/**
 * Format a Score-point number for display, with a "+" lower-bound suffix when incomplete.
 * @param {number} score
 * @param {boolean} complete
 * @returns {string}
 */
export function formatScoreValue(score, complete) {
    return `${score.toFixed(1)}${complete ? '' : '+'}`;
}
