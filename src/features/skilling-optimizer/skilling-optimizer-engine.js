/**
 * Skilling Optimizer Engine
 * Per-slot independent optimization: for each equipment slot, finds the best item
 * at each enhancement breakpoint. Uses the same breakpoint tables as the combat
 * upgrade advisor.
 */

import dataManager from '../../core/data-manager.js';
import {
    scoreEquipmentSetup,
    findOptimalTeas,
    getSkillActionsForDisplay,
    calculateSkillPerformance,
} from '../../utils/tea-optimizer.js';

export { getSkillActionsForDisplay, calculateSkillPerformance, findOptimalTeas };

// Equipment type → item location mapping (two_hand maps to main_hand slot)
const EQUIPMENT_TYPE_TO_LOCATION = {
    '/equipment_types/back': '/item_locations/back',
    '/equipment_types/head': '/item_locations/head',
    '/equipment_types/trinket': '/item_locations/trinket',
    '/equipment_types/main_hand': '/item_locations/main_hand',
    '/equipment_types/two_hand': '/item_locations/main_hand',
    '/equipment_types/body': '/item_locations/body',
    '/equipment_types/off_hand': '/item_locations/off_hand',
    '/equipment_types/hands': '/item_locations/hands',
    '/equipment_types/legs': '/item_locations/legs',
    '/equipment_types/pouch': '/item_locations/pouch',
    '/equipment_types/feet': '/item_locations/feet',
    '/equipment_types/neck': '/item_locations/neck',
    '/equipment_types/earrings': '/item_locations/earrings',
    '/equipment_types/ring': '/item_locations/ring',
    '/equipment_types/charm': '/item_locations/charm',
    // Skill-specific tool slots
    '/equipment_types/milking_tool': '/item_locations/milking_tool',
    '/equipment_types/foraging_tool': '/item_locations/foraging_tool',
    '/equipment_types/woodcutting_tool': '/item_locations/woodcutting_tool',
    '/equipment_types/cheesesmithing_tool': '/item_locations/cheesesmithing_tool',
    '/equipment_types/crafting_tool': '/item_locations/crafting_tool',
    '/equipment_types/tailoring_tool': '/item_locations/tailoring_tool',
    '/equipment_types/cooking_tool': '/item_locations/cooking_tool',
    '/equipment_types/brewing_tool': '/item_locations/brewing_tool',
    '/equipment_types/alchemy_tool': '/item_locations/alchemy_tool',
};

// Build reverse map: location → [equipment types]
const LOCATION_TO_EQUIPMENT_TYPES = {};
for (const [eqType, loc] of Object.entries(EQUIPMENT_TYPE_TO_LOCATION)) {
    if (!LOCATION_TO_EQUIPMENT_TYPES[loc]) LOCATION_TO_EQUIPMENT_TYPES[loc] = [];
    LOCATION_TO_EQUIPMENT_TYPES[loc].push(eqType);
}

// Enhancement breakpoints — same as combat upgrade advisor
const BREAKPOINTS_DEFAULT = [7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const BREAKPOINTS_JEWELRY = [5, 7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const BREAKPOINTS_BACK = [3, 5, 7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const BREAKPOINTS_REFINED = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const JEWELRY_LOCATIONS = new Set(['/item_locations/neck', '/item_locations/ring', '/item_locations/earrings']);

export const SKILLING_LOCATIONS = [
    // Skill-specific tools (shown first)
    '/item_locations/milking_tool',
    '/item_locations/foraging_tool',
    '/item_locations/woodcutting_tool',
    '/item_locations/cheesesmithing_tool',
    '/item_locations/crafting_tool',
    '/item_locations/tailoring_tool',
    '/item_locations/cooking_tool',
    '/item_locations/brewing_tool',
    '/item_locations/alchemy_tool',
    // General equipment slots
    '/item_locations/main_hand',
    '/item_locations/off_hand',
    '/item_locations/head',
    '/item_locations/body',
    '/item_locations/legs',
    '/item_locations/hands',
    '/item_locations/feet',
    '/item_locations/back',
    '/item_locations/neck',
    '/item_locations/ring',
    '/item_locations/earrings',
    '/item_locations/trinket',
    '/item_locations/pouch',
    '/item_locations/charm',
];

export const SLOT_DISPLAY_NAMES = {
    '/item_locations/milking_tool': 'Milking Tool',
    '/item_locations/foraging_tool': 'Foraging Tool',
    '/item_locations/woodcutting_tool': 'Woodcutting Tool',
    '/item_locations/cheesesmithing_tool': 'Cheesesmithing Tool',
    '/item_locations/crafting_tool': 'Crafting Tool',
    '/item_locations/tailoring_tool': 'Tailoring Tool',
    '/item_locations/cooking_tool': 'Cooking Tool',
    '/item_locations/brewing_tool': 'Brewing Tool',
    '/item_locations/alchemy_tool': 'Alchemy Tool',
    '/item_locations/main_hand': 'Main Hand',
    '/item_locations/off_hand': 'Off Hand',
    '/item_locations/head': 'Head',
    '/item_locations/body': 'Body',
    '/item_locations/legs': 'Legs',
    '/item_locations/hands': 'Hands',
    '/item_locations/feet': 'Feet',
    '/item_locations/back': 'Back',
    '/item_locations/neck': 'Neck',
    '/item_locations/ring': 'Ring',
    '/item_locations/earrings': 'Earrings',
    '/item_locations/trinket': 'Trinket',
    '/item_locations/pouch': 'Pouch',
    '/item_locations/charm': 'Charm',
};

export const SKILL_TOOL_LOCATION = {
    Milking: '/item_locations/milking_tool',
    Foraging: '/item_locations/foraging_tool',
    Woodcutting: '/item_locations/woodcutting_tool',
    Cheesesmithing: '/item_locations/cheesesmithing_tool',
    Crafting: '/item_locations/crafting_tool',
    Tailoring: '/item_locations/tailoring_tool',
    Cooking: '/item_locations/cooking_tool',
    Brewing: '/item_locations/brewing_tool',
    Alchemy: '/item_locations/alchemy_tool',
};

const GATHERING_SKILLS = new Set(['milking', 'foraging', 'woodcutting']);

export const SKILL_NAMES = [
    'Milking',
    'Foraging',
    'Woodcutting',
    'Cheesesmithing',
    'Crafting',
    'Tailoring',
    'Cooking',
    'Brewing',
    'Alchemy',
];

/**
 * Get the player's current level for a skill.
 * @param {string} skillName
 * @returns {number}
 */
export function getPlayerSkillLevel(skillName) {
    const skills = dataManager.getSkills();
    const skillHrid = `/skills/${skillName.toLowerCase()}`;
    return skills?.find((s) => s.skillHrid === skillHrid)?.level ?? 1;
}

/**
 * Get breakpoints for a location/item combination.
 * @param {string} locationHrid
 * @param {string} itemHrid
 * @returns {number[]}
 */
function getBreakpoints(locationHrid, itemHrid) {
    if (itemHrid.includes('_refined')) return BREAKPOINTS_REFINED;
    if (JEWELRY_LOCATIONS.has(locationHrid)) return BREAKPOINTS_JEWELRY;
    if (locationHrid === '/item_locations/back') return BREAKPOINTS_BACK;
    return BREAKPOINTS_DEFAULT;
}

/**
 * Build a map of all player skill levels, with the target skill overridden.
 * @param {string} skillName
 * @param {number} overrideLevel
 * @returns {Map<string, number>}
 */
function buildPlayerLevelMap(skillName, overrideLevel) {
    const skills = dataManager.getSkills() || [];
    const map = new Map(skills.map((s) => [s.skillHrid, s.level]));
    map.set(`/skills/${skillName.toLowerCase()}`, overrideLevel);
    return map;
}

/**
 * Check if the player meets all level requirements for an item.
 * @param {Object} itemDetail
 * @param {Map<string, number>} playerLevels
 * @returns {boolean}
 */
function meetsLevelRequirements(itemDetail, playerLevels) {
    for (const req of itemDetail.equipmentDetail?.levelRequirements || []) {
        if (!req.levelTypeHrid) continue;
        const skillHrid = req.levelTypeHrid.replace('/level_types/', '/skills/');
        const playerLevel = playerLevels.get(skillHrid) ?? 1;
        if (playerLevel < req.level) return false;
    }
    return true;
}

/**
 * Get all equipment candidates for a slot that the player can equip.
 * @param {string} locationHrid
 * @param {Map<string, number>} playerLevels
 * @param {Object} itemDetailMap
 * @returns {Array<{ hrid: string, name: string }>}
 */
function getCandidatesForSlot(locationHrid, playerLevels, itemDetailMap) {
    const validEqTypes = new Set(LOCATION_TO_EQUIPMENT_TYPES[locationHrid] || []);
    if (!validEqTypes.size) return [];

    return Object.entries(itemDetailMap)
        .filter(([_hrid, detail]) => {
            if (!detail.equipmentDetail) return false;
            if (!validEqTypes.has(detail.equipmentDetail.type)) return false;
            if (!detail.equipmentDetail.noncombatStats) return false;
            return meetsLevelRequirements(detail, playerLevels);
        })
        .map(([hrid, detail]) => ({ hrid, name: detail.name }));
}

/**
 * Score a single candidate item in a slot at a specific enhancement level.
 * @param {string} itemHrid
 * @param {string} locationHrid
 * @param {string} skillName
 * @param {string} goal
 * @param {number} enhancementLevel
 * @param {number} playerLevel
 * @returns {number}
 */
function scoreCandidate(itemHrid, locationHrid, skillName, goal, enhancementLevel, playerLevel, selectedActionHrids) {
    const equipment = new Map([[locationHrid, { itemHrid, enhancementLevel }]]);
    return scoreEquipmentSetup(skillName, goal, equipment, playerLevel, selectedActionHrids);
}

/**
 * Build the set of noncombatStats field names that are relevant to a skill.
 * @param {string} skillName
 * @returns {Set<string>}
 */
function getRelevantStatsForSkill(skillName) {
    const key = skillName.toLowerCase();
    const fields = new Set([
        `${key}Speed`,
        `${key}Efficiency`,
        `${key}RareFind`,
        'skillingSpeed',
        'skillingEfficiency',
        'skillingRareFind',
        'skillingEssenceFind',
    ]);
    if (GATHERING_SKILLS.has(key)) fields.add('gatheringQuantity');
    return fields;
}

/**
 * Get all equippable items for a slot that have stats relevant to the given skill.
 * Availability is based on the player's actual skill levels.
 * @param {string} locationHrid
 * @param {string} skillName
 * @returns {Array<{ hrid, name, available, maxReq, itemLevel }>} Sorted by itemLevel descending
 */
export function getItemsForSlot(locationHrid, skillName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) return [];

    const validEqTypes = new Set(LOCATION_TO_EQUIPMENT_TYPES[locationHrid] || []);
    if (!validEqTypes.size) return [];

    const skills = dataManager.getSkills() || [];
    const playerLevels = new Map(skills.map((s) => [s.skillHrid, s.level]));
    const relevantStats = getRelevantStatsForSkill(skillName);

    const result = [];
    for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
        if (!detail.equipmentDetail) continue;
        if (!validEqTypes.has(detail.equipmentDetail.type)) continue;
        const stats = detail.equipmentDetail.noncombatStats;
        if (!stats) continue;
        // Only include items with at least one relevant non-zero stat for this skill
        if (!Object.entries(stats).some(([field, val]) => val > 0 && relevantStats.has(field))) continue;

        let available = true;
        let maxReq = 1;
        for (const req of detail.equipmentDetail.levelRequirements || []) {
            if (!req.levelTypeHrid) continue;
            const skillHrid = req.levelTypeHrid.replace('/level_types/', '/skills/');
            if (req.level > maxReq) maxReq = req.level;
            if ((playerLevels.get(skillHrid) ?? 1) < req.level) available = false;
        }

        result.push({ hrid, name: detail.name, available, maxReq, itemLevel: detail.itemLevel || 0 });
    }

    return result.sort((a, b) => b.itemLevel - a.itemLevel || a.name.localeCompare(b.name));
}

const SKILLING_BUFF_TYPES = new Set([
    '/buff_types/efficiency',
    '/buff_types/wisdom',
    '/buff_types/gathering',
    '/buff_types/processing',
    '/buff_types/artisan',
    '/buff_types/gourmet',
    '/buff_types/action_level',
    '/buff_types/alchemy_success',
]);

/**
 * Get all consumable drink items that provide skilling-relevant buffs.
 * @returns {Array<{ hrid, name }>} Sorted by name
 */
export function getSkillDrinkItems() {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) return [];

    const result = [];
    for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
        if (!detail.consumableDetail?.buffs?.length) continue;
        const hasSkillBuff = detail.consumableDetail.buffs.some(
            (b) => SKILLING_BUFF_TYPES.has(b.typeHrid) || b.typeHrid?.endsWith('_level')
        );
        if (!hasSkillBuff) continue;
        result.push({ hrid, name: detail.name });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Optimize a skill for the given player level and selected actions.
 * Equipment is always scored for XP (efficiency/speed benefit both goals equally).
 * Returns per-slot progression plus tea results for both XP and Gold goals.
 *
 * @param {string} skillName
 * @param {number} playerLevel
 * @param {Set<string>|null} selectedActionHrids - HRIDs of actions to score against, or null for all
 * @returns {Object|null}
 */
export function optimizeSkill(skillName, playerLevel, selectedActionHrids = null) {
    // Gathering skills: score for Gold — captures gathering quantity, rare/essence find + speed/efficiency.
    // Production skills: score for XP — more reliable since it doesn't depend on market prices.
    const goal = GATHERING_SKILLS.has(skillName.toLowerCase()) ? 'gold' : 'xp';
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) return null;

    const { itemDetailMap } = gameData;
    const playerLevels = buildPlayerLevelMap(skillName, playerLevel);

    // Baseline: empty equipment — all slot results must beat this to be shown
    const baseline = scoreEquipmentSetup(skillName, goal, new Map(), playerLevel, selectedActionHrids);

    const slots = {};
    const optimalEquipmentAtMax = new Map();

    for (const locationHrid of SKILLING_LOCATIONS) {
        const candidates = getCandidatesForSlot(locationHrid, playerLevels, itemDetailMap);
        if (!candidates.length) continue;

        // Collect union of all breakpoints across candidates (refined items differ)
        const allBreakpoints = new Set();
        for (const candidate of candidates) {
            for (const bp of getBreakpoints(locationHrid, candidate.hrid)) {
                allBreakpoints.add(bp);
            }
        }
        const sortedBreakpoints = [...allBreakpoints].sort((a, b) => a - b);

        const progression = [];
        let lastWinnerHrid = null;

        for (const bp of sortedBreakpoints) {
            let bestItem = null;
            let bestScore = baseline;

            for (const candidate of candidates) {
                // Refined items can't be enhanced below +10
                const effectiveLevel = candidate.hrid.includes('_refined') ? Math.max(bp, 10) : bp;
                const score = scoreCandidate(
                    candidate.hrid,
                    locationHrid,
                    skillName,
                    goal,
                    effectiveLevel,
                    playerLevel,
                    selectedActionHrids
                );

                if (score > bestScore) {
                    bestScore = score;
                    bestItem = candidate;
                }
            }

            progression.push({
                breakpoint: bp,
                itemHrid: bestItem?.hrid ?? null,
                itemName: bestItem?.name ?? null,
                score: bestScore,
                isChange: (bestItem?.hrid ?? null) !== lastWinnerHrid,
            });

            lastWinnerHrid = bestItem?.hrid ?? null;
        }

        // Only include slots where at least one item beats the baseline
        if (!progression.some((p) => p.itemHrid !== null)) continue;

        slots[locationHrid] = {
            name: SLOT_DISPLAY_NAMES[locationHrid] || locationHrid,
            candidateCount: candidates.length,
            progression,
        };

        // Record the optimal item at max breakpoint for tea optimization
        const maxEntry = progression[progression.length - 1];
        if (maxEntry?.itemHrid) {
            optimalEquipmentAtMax.set(locationHrid, { itemHrid: maxEntry.itemHrid, enhancementLevel: 20 });
        }
    }

    // Run tea optimizer for both goals with optimal equipment at max enhancement
    const xpTeaResult = findOptimalTeas(
        skillName,
        'xp',
        null,
        null,
        null,
        null,
        optimalEquipmentAtMax,
        selectedActionHrids
    );
    const goldTeaResult = findOptimalTeas(
        skillName,
        'gold',
        null,
        null,
        null,
        null,
        optimalEquipmentAtMax,
        selectedActionHrids
    );

    return {
        skill: skillName,
        playerLevel,
        slots,
        xpTeaResult: xpTeaResult?.error ? null : xpTeaResult,
        goldTeaResult: goldTeaResult?.error ? null : goldTeaResult,
    };
}
