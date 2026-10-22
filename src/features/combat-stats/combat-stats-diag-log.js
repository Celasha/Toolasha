/**
 * Temporary console diagnostics for the consumable tracking investigation (#803).
 * Every line starts with DIAG_TAG so it can be filtered in the browser console.
 * Remove once the tracking redesign settles.
 */

export const DIAG_TAG = '[ToolashaDiag]';

/**
 * @param {string} kind - Short event name
 * @param {Object} fields - JSON-serialisable details
 */
export function diagLog(kind, fields = {}) {
    console.log(DIAG_TAG, kind, JSON.stringify({ at: new Date().toISOString(), ...fields }));
}
