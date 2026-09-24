/**
 * Task Skill Groups
 *
 * Shared skill-type classification for bulk "select all <Skill>" toggles in
 * Task Reroll Protection and Task Auto-Reroll. Deliberately excludes Combat —
 * combat already has its own per-zone bulk toggle in both popups.
 */

// Same 10 non-combat skill types as task-sorter.js's TASK_ORDER, keyed by the
// action_type HRID so classification doesn't depend on parsing display text.
export const TASK_SKILL_TYPES = {
    '/action_types/milking': 'Milking',
    '/action_types/foraging': 'Foraging',
    '/action_types/woodcutting': 'Woodcutting',
    '/action_types/cheesesmithing': 'Cheesesmithing',
    '/action_types/crafting': 'Crafting',
    '/action_types/tailoring': 'Tailoring',
    '/action_types/cooking': 'Cooking',
    '/action_types/brewing': 'Brewing',
    '/action_types/alchemy': 'Alchemy',
    '/action_types/enhancing': 'Enhancing',
};

/**
 * Resolve a task's action HRID to its skill type HRID, or null if it isn't
 * one of the bulk-selectable skills (e.g. combat, or an unrecognized type).
 * @param {string} actionHrid
 * @param {Object} gameData - dataManager.getInitClientData() result
 * @returns {string|null} Skill type key (e.g. '/action_types/brewing') or null
 */
export function getActionSkillType(actionHrid, gameData) {
    const action = gameData?.actionDetailMap?.[actionHrid];
    const type = action?.type;
    return type && TASK_SKILL_TYPES[type] ? type : null;
}

/**
 * Count how many actions currently exist for each bulk-selectable skill type.
 * @param {Object} gameData - dataManager.getInitClientData() result
 * @returns {Record<string, number>} Skill type key -> action count
 */
export function countActionsBySkillType(gameData) {
    const counts = {};
    for (const skillType of Object.keys(TASK_SKILL_TYPES)) {
        counts[skillType] = 0;
    }
    for (const action of Object.values(gameData?.actionDetailMap || {})) {
        if (action.type && TASK_SKILL_TYPES[action.type] !== undefined) {
            counts[action.type]++;
        }
    }
    return counts;
}
