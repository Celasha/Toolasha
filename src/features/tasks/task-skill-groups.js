/**
 * Task Skill Groups
 *
 * Shared skill-type classification for bulk "select all <Skill>" toggles in
 * Task Reroll Protection and Task Auto-Reroll. Deliberately excludes Combat —
 * combat already has its own per-zone bulk toggle in both popups.
 */

import { t } from '../../core/i18n.js';

// Same 10 non-combat skill types as task-sorter.js's TASK_ORDER, keyed by the
// action_type HRID so classification doesn't depend on parsing display text.
// Resolved via t() at module load — safe because MWI's own language selection
// (which Toolasha mirrors) only changes on a full page reload, so the locale
// active at load time is the locale active for the lifetime of this module.
export const TASK_SKILL_TYPES = {
    '/action_types/milking': t('labSim.skillMilking'),
    '/action_types/foraging': t('labSim.skillForaging'),
    '/action_types/woodcutting': t('labSim.skillWoodcutting'),
    '/action_types/cheesesmithing': t('labSim.skillCheesesmithing'),
    '/action_types/crafting': t('labSim.skillCrafting'),
    '/action_types/tailoring': t('labSim.skillTailoring'),
    '/action_types/cooking': t('labSim.skillCooking'),
    '/action_types/brewing': t('labSim.skillBrewing'),
    '/action_types/alchemy': t('labSim.skillAlchemy'),
    '/action_types/enhancing': t('labSim.skillEnhancing'),
};

// Display label for a task item's type slug (last segment of its action_type HRID,
// or 'combat'/'other' for monsters/unclassified actions respectively). Shared by
// Task Auto-Reroll and Task Reroll Protection's popup list rendering, which both
// derive this same slug from `action.type?.split('/').pop() || 'other'`.
const TASK_TYPE_LABELS = {
    milking: t('labSim.skillMilking'),
    foraging: t('labSim.skillForaging'),
    woodcutting: t('labSim.skillWoodcutting'),
    cheesesmithing: t('labSim.skillCheesesmithing'),
    crafting: t('labSim.skillCrafting'),
    tailoring: t('labSim.skillTailoring'),
    cooking: t('labSim.skillCooking'),
    brewing: t('labSim.skillBrewing'),
    alchemy: t('labSim.skillAlchemy'),
    enhancing: t('labSim.skillEnhancing'),
    combat: t('guildCreditValue.buffLabelCombat'),
    other: t('taskSkillGroups.otherTypeLabel'),
};

/**
 * Resolve a task item's type slug (e.g. 'combat', 'milking', 'other') to its display label.
 * @param {string} type
 * @returns {string}
 */
export function getTaskTypeLabel(type) {
    return TASK_TYPE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

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
