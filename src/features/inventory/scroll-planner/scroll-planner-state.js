/**
 * Scroll Planner run state
 * Tiny shared flag so other Inventory features (Auto All Button) can stand down while a guided
 * scroll run owns the item action menu and its quantity field.
 */

let runActive = false;

/**
 * @param {boolean} active
 */
export function setScrollRunActive(active) {
    runActive = Boolean(active);
}

/**
 * @returns {boolean} True while a guided scroll run is in progress
 */
export function isScrollRunActive() {
    return runActive;
}
