/**
 * Scroll Planner storage
 * - The last plan used is account-wide, so it can be loaded on any character.
 * - An in-progress run is per character (it describes that character's inventory).
 */

import storage from '../../../core/storage.js';

const STORE_NAME = 'settings';
const LAST_PLAN_KEY = 'scrollPlanner_lastPlan';

function runKey(characterId) {
    return `scrollPlanner_run:${characterId}`;
}

/**
 * @returns {Promise<Object|null>} Last plan used (itemHrid -> quantity), or null
 */
export async function loadLastPlan() {
    return storage.getJSON(LAST_PLAN_KEY, STORE_NAME, null);
}

/**
 * @param {Object<string, number>} plan
 * @returns {Promise<boolean>}
 */
export async function saveLastPlan(plan) {
    return storage.setJSON(LAST_PLAN_KEY, plan, STORE_NAME, true);
}

/**
 * @param {string} characterId
 * @returns {Promise<Object|null>} Saved in-progress run for this character, or null
 */
export async function loadRun(characterId) {
    if (!characterId) {
        return null;
    }
    return storage.getJSON(runKey(characterId), STORE_NAME, null);
}

/**
 * @param {string} characterId
 * @param {Object} run
 * @returns {Promise<boolean>}
 */
export async function saveRun(characterId, run) {
    if (!characterId) {
        return false;
    }
    return storage.setJSON(runKey(characterId), run, STORE_NAME, true);
}

/**
 * @param {string} characterId
 * @returns {Promise<boolean>}
 */
export async function clearRun(characterId) {
    if (!characterId) {
        return false;
    }
    return storage.setJSON(runKey(characterId), null, STORE_NAME, true);
}
