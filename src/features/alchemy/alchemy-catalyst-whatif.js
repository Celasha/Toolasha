/**
 * Alchemy catalyst what-if state
 * The catalyst the player wants to compare in the Alchemy panel, which may differ from the one
 * equipped. 'equipped' means no what-if. The profit display publishes the resulting catalyst and
 * success rate so Missing Mats can size the catalyst for it.
 */

export const CATALYST_CHOICES = ['equipped', 'none', 'typeSpecific', 'prime'];

let choice = 'equipped';
let result = null;
const listeners = new Set();

function notify() {
    for (const listener of Array.from(listeners)) {
        listener();
    }
}

/**
 * @returns {'equipped'|'none'|'typeSpecific'|'prime'} Current choice
 */
export function getCatalystChoice() {
    return choice;
}

/**
 * @param {'equipped'|'none'|'typeSpecific'|'prime'} next - Catalyst to compare
 */
export function setCatalystChoice(next) {
    if (!CATALYST_CHOICES.includes(next) || next === choice) return;
    choice = next;
    result = null;
    notify();
}

/**
 * Catalyst and success rate the what-if produced, or null when no what-if is active.
 * @returns {{catalystHrid: string|null, successRate: number}|null}
 */
export function getCatalystWhatIfResult() {
    return choice === 'equipped' ? null : result;
}

/**
 * @param {{catalystHrid: string|null, successRate: number}|null} next - Published by the profit display
 */
export function publishCatalystWhatIfResult(next) {
    const unchanged =
        (next === null && result === null) ||
        (next && result && next.catalystHrid === result.catalystHrid && next.successRate === result.successRate);
    if (unchanged) return;
    result = next;
    notify();
}

/**
 * @param {Function} listener - Called whenever the choice or published result changes
 * @returns {Function} Unsubscribe
 */
export function onCatalystWhatIfChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function resetCatalystWhatIf() {
    choice = 'equipped';
    result = null;
    listeners.clear();
}
