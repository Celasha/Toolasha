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
 * Whether an item grants Drink Concentration - the specific stat behind the Guzzling Pouch/tea
 * interaction FAIL B targets (a DC item's value is entirely tea-dependent, so it needs the joint
 * re-check in runEquipmentSlotRound rather than a plain fixed-tea score).
 * @param {string} itemHrid
 * @param {Object} itemDetailMap
 * @returns {boolean}
 */
function candidateHasDrinkConcentration(itemHrid, itemDetailMap) {
    return (itemDetailMap[itemHrid]?.equipmentDetail?.noncombatStats?.drinkConcentration ?? 0) > 0;
}

/**
 * FAIL C / OPT-27: a candidate with an unresolved required price (hasMissingPrice) is an
 * incomplete Gold number, not a verified exact one - it must never beat a complete candidate no
 * matter how favorable its raw score looks. Only when every candidate seen so far is incomplete
 * does a higher incomplete score still win (there's no complete alternative to prefer instead).
 * For 'xp' goal, hasMissingPrice is always false on both sides, so this degenerates to a plain
 * score comparison.
 * @param {number} score
 * @param {boolean} hasMissingPrice
 * @param {number} bestScoreSoFar
 * @param {boolean} bestHasMissingPriceSoFar
 * @returns {boolean}
 */
function isBetterCandidate(score, hasMissingPrice, bestScoreSoFar, bestHasMissingPriceSoFar) {
    if (hasMissingPrice !== bestHasMissingPriceSoFar) return !hasMissingPrice;
    return score > bestScoreSoFar;
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
 * Score a single candidate item in a slot at a specific enhancement level. When `baseEquipment`
 * is provided (a Compare loadout is active), the candidate replaces only this one location in an
 * otherwise-full copy of that loadout - never an otherwise-empty Map - so every other slot's
 * interaction (Wisdom, Drink Concentration, etc.) is held constant, matching the baseline.
 * @param {string} itemHrid
 * @param {string} locationHrid
 * @param {string} skillName
 * @param {string} goal
 * @param {number} enhancementLevel
 * @param {number} playerLevel
 * @param {Set<string>|null} selectedActionHrids
 * @param {Map} [baseEquipment] - Full loadout equipment to copy and overwrite one slot in
 * @param {string[]} [teaHrids] - Drinks to score alongside (the base loadout's own drinks)
 * @returns {{score: number, hasMissingPrice: boolean}}
 */
function scoreCandidate(
    itemHrid,
    locationHrid,
    skillName,
    goal,
    enhancementLevel,
    playerLevel,
    selectedActionHrids,
    baseEquipment = null,
    teaHrids = []
) {
    const equipment = new Map(baseEquipment || []);
    equipment.set(locationHrid, { itemHrid, enhancementLevel });
    return scoreEquipmentSetup(skillName, goal, equipment, playerLevel, selectedActionHrids, teaHrids);
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
        `${key}Experience`,
        'skillingSpeed',
        'skillingEfficiency',
        'skillingRareFind',
        'skillingEssenceFind',
        'skillingExperience',
        'drinkConcentration',
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
 * @param {{equipment: Map, drinks: string[]}|null} [compareLoadout] - When provided, BASELINE is
 *   the full loadout (equipment + its drinks) and every CANDIDATE is an exact copy of that same
 *   loadout with only the one slot under test replaced - never an otherwise-empty Map. When null
 *   (no Compare loadout selected), preserves the original empty-baseline/no-drinks behavior.
 * @returns {Object|null}
 */
/**
 * Run one full per-slot equipment optimization pass, holding the given tea combination fixed for
 * every candidate score (except a narrow Drink-Concentration joint re-check, see FAIL B below).
 * Extracted from optimizeSkill() so it can be re-run against successive tea winners (see the
 * coordinate-ascent loop in optimizeSkill) without duplicating the breakpoint scan.
 * @returns {{slots: Object, optimalEquipmentAtMax: Map}}
 */
function runEquipmentSlotRound(
    skillName,
    goal,
    playerLevel,
    selectedActionHrids,
    itemDetailMap,
    playerLevels,
    compareEquipment,
    teaHridsForRound,
    baseline,
    baselineHasMissingPrice,
    xpBaseline,
    goldBaseline
) {
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
            let bestHasMissingPrice = baselineHasMissingPrice;
            let bestEffectiveLevel = bp;
            let bestItemTeaHrids = teaHridsForRound;

            for (const candidate of candidates) {
                // Refined items are essentially never enhanced below +10 in practice (doing so
                // wastes materials for no benefit), so credit them at a realistic minimum of +10
                // even when checking lower breakpoint buckets - bestEffectiveLevel below records
                // what was actually scored, since it can differ from the nominal bucket `bp`.
                const effectiveLevel = candidate.hrid.includes('_refined') ? Math.max(bp, 10) : bp;
                const candidateResult = scoreCandidate(
                    candidate.hrid,
                    locationHrid,
                    skillName,
                    goal,
                    effectiveLevel,
                    playerLevel,
                    selectedActionHrids,
                    compareEquipment,
                    teaHridsForRound
                );
                let candidateScore = candidateResult.score;
                let candidateHasMissingPrice = candidateResult.hasMissingPrice;
                let candidateTeaHrids = teaHridsForRound;

                // FAIL B / OPT-25: Drink Concentration only pays off once a DC-amplified tea is
                // actually active, so scoring this candidate against the round's fixed tea
                // assumption can systematically undervalue it (e.g. it loses under no-tea/an
                // unrelated tea, but a jointly-chosen tea would make it win). Narrowly re-check
                // DC-bearing candidates against their own best tea response - scoped to just these
                // rare items rather than a full per-candidate tea search for every item in every
                // slot, which would be far too expensive to run interactively.
                if (candidateHasDrinkConcentration(candidate.hrid, itemDetailMap)) {
                    const jointEquipment = new Map(compareEquipment);
                    jointEquipment.set(locationHrid, { itemHrid: candidate.hrid, enhancementLevel: effectiveLevel });
                    const jointTeaResult = findOptimalTeas(
                        skillName,
                        goal,
                        null,
                        null,
                        null,
                        null,
                        jointEquipment,
                        selectedActionHrids,
                        playerLevel
                    );
                    if (
                        jointTeaResult?.optimal &&
                        isBetterCandidate(
                            jointTeaResult.optimal.avgScore,
                            jointTeaResult.optimal.hasMissingPrice,
                            candidateScore,
                            candidateHasMissingPrice
                        )
                    ) {
                        candidateScore = jointTeaResult.optimal.avgScore;
                        candidateHasMissingPrice = jointTeaResult.optimal.hasMissingPrice;
                        candidateTeaHrids = jointTeaResult.optimal.teas.map((tea) => tea.hrid);
                    }
                }

                if (isBetterCandidate(candidateScore, candidateHasMissingPrice, bestScore, bestHasMissingPrice)) {
                    bestScore = candidateScore;
                    bestHasMissingPrice = candidateHasMissingPrice;
                    bestItem = candidate;
                    bestEffectiveLevel = effectiveLevel;
                    bestItemTeaHrids = candidateTeaHrids;
                }
            }

            progression.push({
                breakpoint: bp,
                enhancementLevel: bestItem ? bestEffectiveLevel : bp,
                itemHrid: bestItem?.hrid ?? null,
                itemName: bestItem?.name ?? null,
                score: bestScore,
                // FAIL C / OPT-27: whether this breakpoint's winning score rests on an unresolved
                // required price - an incomplete number, not a verified exact one. Always false
                // for XP-goal skills (XP never touches market prices).
                hasMissingPrice: bestHasMissingPrice,
                xpScore: (() => {
                    if (!bestItem) return xpBaseline;
                    if (goal === 'xp') return bestScore;
                    return scoreCandidate(
                        bestItem.hrid,
                        locationHrid,
                        skillName,
                        'xp',
                        bestEffectiveLevel,
                        playerLevel,
                        selectedActionHrids,
                        compareEquipment,
                        bestItemTeaHrids
                    ).score;
                })(),
                goldScore: (() => {
                    if (!bestItem) return goldBaseline;
                    if (goal === 'gold') return bestScore;
                    return scoreCandidate(
                        bestItem.hrid,
                        locationHrid,
                        skillName,
                        'gold',
                        bestEffectiveLevel,
                        playerLevel,
                        selectedActionHrids,
                        compareEquipment,
                        bestItemTeaHrids
                    ).score;
                })(),
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

    return { slots, optimalEquipmentAtMax };
}

export function optimizeSkill(skillName, playerLevel, selectedActionHrids = null, compareLoadout = null) {
    // Gathering skills: score for Gold — captures gathering quantity, rare/essence find + speed/efficiency.
    // Production skills: score for XP — more reliable since it doesn't depend on market prices.
    const goal = GATHERING_SKILLS.has(skillName.toLowerCase()) ? 'gold' : 'xp';
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) return null;

    const { itemDetailMap } = gameData;
    const playerLevels = buildPlayerLevelMap(skillName, playerLevel);

    const compareEquipment = compareLoadout?.equipment ?? new Map();
    const compareDrinks = compareLoadout?.drinks ?? [];

    const xpBaselineResult = scoreEquipmentSetup(
        skillName,
        'xp',
        compareEquipment,
        playerLevel,
        selectedActionHrids,
        compareDrinks
    );
    const goldBaselineResult = scoreEquipmentSetup(
        skillName,
        'gold',
        compareEquipment,
        playerLevel,
        selectedActionHrids,
        compareDrinks
    );
    const xpBaseline = xpBaselineResult.score;
    const goldBaseline = goldBaselineResult.score;
    const baseline = goal === 'xp' ? xpBaseline : goldBaseline;
    const baselineHasMissingPrice =
        goal === 'xp' ? xpBaselineResult.hasMissingPrice : goldBaselineResult.hasMissingPrice;

    // FAIL B / OPT-25: equipment and tea choices can interact - e.g. Guzzling Pouch's Drink
    // Concentration stat only pays off once the tea combo that benefits from it is actually in
    // play, so a single equipment-then-tea pass can permanently miss it (the pouch loses when
    // scored with no tea, and equipment is never revisited after tea search runs). This alternates
    // a full per-slot equipment pass (holding tea fixed) with a full tea search (holding equipment
    // fixed) for a few rounds, feeding each round's tea winner into the next equipment pass. This
    // is coordinate ascent, not exhaustive search: each pass fully re-optimizes its own dimension
    // against the other's current fixed choice, which can surface genuine equipment<->tea
    // interactions, but it proves only a local joint equilibrium (neither side can unilaterally
    // improve further) - never a certified global optimum over the full equipment x tea
    // combination space, which is combinatorially far too large to search exhaustively here.
    // (runEquipmentSlotRound additionally jointly re-checks Drink-Concentration candidates
    // specifically against their own best tea, so this loop isn't the only defense against a
    // pouch-style interaction slipping through a single fixed-tea assumption.)
    //
    // A Compare loadout is a different product concept: "which single-slot swap beats this exact
    // real loadout, holding everything else - including its own real drinks - constant" (the
    // already-accepted TLA-024 one-slot-replacement invariant). So when compareLoadout is active,
    // the round below runs exactly once against compareDrinks, unchanged from the original
    // single-pass behavior - the iterative tea search only applies to the no-Compare, free
    // equipment+tea recommendation scenario.
    const hasCompareLoadout = compareLoadout != null;
    const MAX_ROUNDS = hasCompareLoadout ? 1 : 3;

    let teaHridsForRound = compareDrinks;
    let slots = {};
    let optimalEquipmentAtMax = new Map();
    let teaResult = null;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const roundOutcome = runEquipmentSlotRound(
            skillName,
            goal,
            playerLevel,
            selectedActionHrids,
            itemDetailMap,
            playerLevels,
            compareEquipment,
            teaHridsForRound,
            baseline,
            baselineHasMissingPrice,
            xpBaseline,
            goldBaseline
        );
        slots = roundOutcome.slots;
        optimalEquipmentAtMax = roundOutcome.optimalEquipmentAtMax;

        teaResult = findOptimalTeas(
            skillName,
            goal,
            null,
            null,
            null,
            null,
            optimalEquipmentAtMax,
            selectedActionHrids,
            playerLevel
        );
        const nextTeaHrids = (teaResult?.optimal?.teas || []).map((tea) => tea.hrid);

        // Fixed point: this round's equipment produced the same winning tea combo it was seeded
        // with - another round would just rediscover the identical equipment set.
        const previousTeaHrids = teaHridsForRound;
        const isSameTeaSet =
            nextTeaHrids.length === previousTeaHrids.length &&
            nextTeaHrids.every((hrid) => previousTeaHrids.includes(hrid));
        if (isSameTeaSet) break;
        teaHridsForRound = nextTeaHrids;
    }

    const otherGoal = goal === 'xp' ? 'gold' : 'xp';
    const otherTeaResult = findOptimalTeas(
        skillName,
        otherGoal,
        null,
        null,
        null,
        null,
        optimalEquipmentAtMax,
        selectedActionHrids,
        playerLevel
    );
    const xpTeaResult = goal === 'xp' ? teaResult : otherTeaResult;
    const goldTeaResult = goal === 'gold' ? teaResult : otherTeaResult;

    return {
        skill: skillName,
        playerLevel,
        goal,
        xpBaseline,
        goldBaseline,
        slots,
        xpTeaResult: xpTeaResult?.error ? null : xpTeaResult,
        goldTeaResult: goldTeaResult?.error ? null : goldTeaResult,
    };
}
