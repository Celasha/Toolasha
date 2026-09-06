/**
 * Score Result Plumbing
 *
 * Shared {score, complete, unpricedCount, breakdown} shape used by every TLA-041 Score
 * category (Houses/Abilities/Equipment/Shrines) and by the Combat/Skiller top-level totals.
 * `complete: false` means at least one contributing leaf could not be priced — the category's
 * `score` is then a lower bound, never a substituted zero.
 *
 * Every leaf is preserved in `breakdown`, priced or not (TLA-041C) - the top-level `+` alone
 * cannot tell a viewer which House room / Ability / Equipment item / Shrine caused the lower
 * bound, so a leaf with no defensible price stays visible as `value: null` ("N/A") instead of
 * silently disappearing.
 */

/**
 * @returns {{score: number, complete: boolean, unpricedCount: number, breakdown: Array<{name: string, value: string|null, complete: boolean, reason: string|null}>}}
 */
export function emptyCategory() {
    return { score: 0, complete: true, unpricedCount: 0, breakdown: [] };
}

/**
 * Add one leaf into a category, in place. The leaf is always preserved in `breakdown`, priced or
 * not - only its `value` (null for "no defensible price") and `complete` flag record that.
 * @param {{score: number, complete: boolean, unpricedCount: number, breakdown: Array}} category
 * @param {{name: string, cost: number|null, complete: boolean, reason?: string}} leaf - cost is in raw coins
 */
export function attribute(category, leaf) {
    const complete = leaf.complete !== false;
    category.complete = category.complete && complete;
    if (!complete) category.unpricedCount += 1;

    const hasKnownValue = Number.isFinite(leaf.cost) && leaf.cost > 0;
    const scoreValue = hasKnownValue ? leaf.cost / 1_000_000 : null;
    if (scoreValue !== null) category.score += scoreValue;

    category.breakdown.push({
        name: leaf.name,
        value: scoreValue === null ? null : scoreValue.toFixed(1),
        complete,
        reason: leaf.reason || null,
    });
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
    // N/A (value: null) leaves sink to the bottom deterministically instead of comparing via NaN.
    merged.breakdown.sort((a, b) => (parseFloat(b.value) || -Infinity) - (parseFloat(a.value) || -Infinity));
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
