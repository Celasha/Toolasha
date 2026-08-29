/**
 * Efficiency Utilities Module
 * Calculations for efficiency stacking and breakdowns
 */

import dataManager from '../core/data-manager.js';
import { resolveActionContext } from './action-context.js';
import {
    parseEquipmentSpeedBonuses,
    parseEquipmentEfficiencyBonuses,
    parseEquipmentEfficiencyBreakdown,
} from './equipment-parser.js';
import {
    parseTeaEfficiency,
    parseGourmetBonus,
    parseProcessingBonus,
    parseGatheringBonus,
    getDrinkConcentration,
    parseTeaSkillLevelBonus,
    parseActionLevelBonus,
    parseArtisanBonus,
} from './tea-parser.js';
import { calculateHouseEfficiency } from './house-efficiency.js';
import { GATHERING_TYPES, PRODUCTION_TYPES } from './profit-constants.js';

/**
 * Stack additive bonuses (most game bonuses)
 * @param {number[]} bonuses - Array of bonus percentages
 * @returns {number} Total stacked bonus percentage
 *
 * @example
 * stackAdditive([10, 20, 5])
 * // Returns: 35
 * // Because: 10% + 20% + 5% = 35%
 */
export function stackAdditive(...bonuses) {
    return bonuses.reduce((total, bonus) => total + bonus, 0);
}

/**
 * Calculate efficiency multiplier from efficiency percentage
 * Efficiency gives bonus action completions per time-consuming action
 *
 * @param {number} efficiencyPercent - Efficiency as percentage (e.g., 150 for 150%)
 * @returns {number} Multiplier (e.g., 2.5 for 150% efficiency)
 *
 * @example
 * calculateEfficiencyMultiplier(0)   // Returns 1.0 (no bonus)
 * calculateEfficiencyMultiplier(50)  // Returns 1.5
 * calculateEfficiencyMultiplier(150) // Returns 2.5
 */
export function calculateEfficiencyMultiplier(efficiencyPercent) {
    return 1 + (efficiencyPercent || 0) / 100;
}

/**
 * Calculate efficiency breakdown from supplied sources
 * @param {Object} params - Efficiency inputs
 * @param {number} params.requiredLevel - Action required level
 * @param {number} params.skillLevel - Player skill level
 * @param {number} [params.teaSkillLevelBonus=0] - Bonus skill levels from tea
 * @param {number} [params.actionLevelBonus=0] - Action level bonus from tea (affects requirement)
 * @param {number} [params.houseEfficiency=0] - House room efficiency bonus
 * @param {number} [params.equipmentEfficiency=0] - Equipment efficiency bonus
 * @param {number} [params.teaEfficiency=0] - Tea efficiency bonus
 * @param {number} [params.communityEfficiency=0] - Community buff efficiency bonus
 * @param {number} [params.achievementEfficiency=0] - Achievement efficiency bonus
 * @param {number} [params.personalEfficiency=0] - Personal buff (seal) efficiency bonus
 * @returns {Object} Efficiency breakdown
 */
export function calculateEfficiencyBreakdown({
    requiredLevel,
    skillLevel,
    teaSkillLevelBonus = 0,
    actionLevelBonus = 0,
    houseEfficiency = 0,
    equipmentEfficiency = 0,
    teaEfficiency = 0,
    communityEfficiency = 0,
    achievementEfficiency = 0,
    personalEfficiency = 0,
    guildEfficiency = 0,
}) {
    // Published MWI evidence (calcGatheringProductionLevelEfficiencyBuff) computes level
    // efficiency from the real boosted skill level versus the effective requirement directly -
    // it never clamps a below-requirement base skill level up to the requirement before adding
    // a tea/buff level bonus. A tea that doesn't close the whole gap on its own must not be
    // credited as if it did (e.g. skill 18, requirement 20, tea +3 -> boosted level 21 -> only
    // +1% level efficiency, not +3%).
    const effectiveRequirement = (requiredLevel || 0) + actionLevelBonus;
    const effectiveLevel = (skillLevel || 0) + teaSkillLevelBonus;
    const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
    const totalEfficiency = stackAdditive(
        levelEfficiency,
        houseEfficiency,
        equipmentEfficiency,
        teaEfficiency,
        communityEfficiency,
        achievementEfficiency,
        personalEfficiency,
        guildEfficiency
    );

    return {
        totalEfficiency,
        levelEfficiency,
        effectiveRequirement,
        effectiveLevel,
        breakdown: {
            houseEfficiency,
            equipmentEfficiency,
            teaEfficiency,
            communityEfficiency,
            achievementEfficiency,
            personalEfficiency,
            guildEfficiency,
            actionLevelBonus,
            teaSkillLevelBonus,
        },
    };
}

/**
 * Build the shared efficiency context for a production or gathering action.
 * Consolidates equipment lookup, tea parsing, house bonus, skill level, and
 * efficiency breakdown calculation that would otherwise be duplicated across
 * profit-calculator.js (production) and gathering-profit.js (gathering).
 *
 * @param {Object} actionDetails - Action detail object from dataManager
 * @param {Object} [options={}] - Configuration flags
 * @param {boolean} [options.isProduction=false] - True for production actions.
 *   When true: includes artisanBonus, actionLevelBonus, uses calculateHouseEfficiency.
 *   When false (gathering): uses inline houseRooms loop, includes gatheringQuantity.
 * @param {Object} [options.gameData=null] - Pre-fetched gameData (required for gathering path).
 * @param {number} [options.communityEfficiency=0] - Community buff efficiency (production only).
 *   Caller computes this via their own method (e.g. calculateCommunityBuffBonus) and passes it in.
 * @param {{equipment: Map, drinks: Array}|null} [options.actionContextOverride=null] - Exact proven
 *   live context supplied by a caller such as the Current Action Bar (see resolveCurrentActionContext).
 *   Takes priority over equipmentOverride/drinksOverride and the live/saved resolveActionContext()
 *   path - keeps a caller's atomic current-equipment+current-drinks pairing intact.
 * @param {Map|null} [options.equipmentOverride=null] - When provided (together with
 *   drinksOverride), scores this exact hypothetical equipment instead of resolving the
 *   live/saved action context - for a what-if scenario (e.g. the Skilling Optimizer/Simulator),
 *   never for live play. All current/global modifiers below (house, community, achievement,
 *   personal, guild) still apply as-is; only equipment/drinks/skill level become hypothetical.
 * @param {Array|null} [options.drinksOverride=null] - Hypothetical drink slots
 *   (`[{itemHrid}, ...]`) to use instead of the live/saved action context's drinks. Only takes
 *   effect together with equipmentOverride.
 * @param {number|null} [options.skillLevelOverride=null] - Hypothetical skill level (e.g. a
 *   Simulator "Level" field) instead of the character's real current level for this skill.
 * @returns {Object} Efficiency context with all computed values
 */
export function getActionEfficiencyContext(actionDetails, options = {}) {
    const {
        isProduction = false,
        gameData = null,
        communityEfficiency = 0,
        actionContextOverride = null,
        equipmentOverride = null,
        drinksOverride = null,
        skillLevelOverride = null,
    } = options;

    const skills = dataManager.getSkills();
    // A hypothetical scenario (Optimizer/Simulator) supplies its own equipment+drinks and must
    // never fall through to resolveActionContext()'s live/saved resolution - that would silently
    // mix real character state into a what-if calculation.
    const isHypothetical = equipmentOverride != null || drinksOverride != null;
    const { equipment, drinks: drinkSlots } = actionContextOverride
        ? actionContextOverride
        : isHypothetical
          ? { equipment: equipmentOverride ?? new Map(), drinks: drinksOverride ?? [] }
          : resolveActionContext(actionDetails.type);
    const itemDetailMap = gameData?.itemDetailMap ?? dataManager.getInitClientData()?.itemDetailMap ?? {};

    // Drink concentration
    const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

    // Action time (nanoseconds → seconds)
    const baseTimePerActionSec = actionDetails.baseTimeCost / 1e9;
    const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);
    const personalSpeedBonus = dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/action_speed');

    const guildBuffs = dataManager.characterData?.guildActionTypeBuffsMap?.[actionDetails.type] || [];
    const guildSpeedBonus = guildBuffs.reduce(
        (sum, b) => (b.typeHrid === '/buff_types/action_speed' ? sum + (b.flatBoost || 0) + (b.ratioBoost || 0) : sum),
        0
    );
    const guildEfficiency = guildBuffs.reduce(
        (sum, b) =>
            b.typeHrid === '/buff_types/efficiency' ? sum + ((b.flatBoost || 0) + (b.ratioBoost || 0)) * 100 : sum,
        0
    );

    const actionTime = baseTimePerActionSec / (1 + speedBonus + personalSpeedBonus + guildSpeedBonus);

    // Skill level
    const baseRequirement = actionDetails.levelRequirement?.level || 1;
    const skillHrid = actionDetails.levelRequirement?.skillHrid;
    let skillLevel = baseRequirement;
    if (skillLevelOverride != null) {
        skillLevel = skillLevelOverride;
    } else if (skills) {
        for (const skill of skills) {
            if (skill.skillHrid === skillHrid) {
                skillLevel = skill.level;
                break;
            }
        }
    }

    // Tea bonuses (shared by both paths)
    const teaSkillLevelBonus = parseTeaSkillLevelBonus(
        actionDetails.type,
        drinkSlots,
        itemDetailMap,
        drinkConcentration
    );
    const teaEfficiency = parseTeaEfficiency(actionDetails.type, drinkSlots, itemDetailMap, drinkConcentration);
    const processingBonus = GATHERING_TYPES.includes(actionDetails.type)
        ? parseProcessingBonus(drinkSlots, itemDetailMap, drinkConcentration) +
          dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/processing')
        : 0;
    const gourmetBonus = PRODUCTION_TYPES.includes(actionDetails.type)
        ? parseGourmetBonus(drinkSlots, itemDetailMap, drinkConcentration) +
          dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/gourmet')
        : 0;

    // Equipment efficiency
    const equipmentEfficiency = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap);
    const equipmentEfficiencyItems = parseEquipmentEfficiencyBreakdown(equipment, actionDetails.type, itemDetailMap);
    const achievementEfficiency =
        dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;
    const personalEfficiency = dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

    // Production-specific: artisan bonus, action level bonus, house via calculateHouseEfficiency
    // Gathering-specific: house via inline houseRooms loop
    let artisanBonus = 0;
    let actionLevelBonus = 0;
    let houseEfficiency = 0;

    if (isProduction) {
        artisanBonus = parseArtisanBonus(drinkSlots, itemDetailMap, drinkConcentration);
        actionLevelBonus = parseActionLevelBonus(drinkSlots, itemDetailMap, drinkConcentration);
        houseEfficiency = calculateHouseEfficiency(actionDetails.type);
    } else {
        // Gathering: compute house efficiency from houseRooms + houseRoomDetailMap
        const houseRooms = Array.from(dataManager.getHouseRooms().values());
        const initData = gameData ?? dataManager.getInitClientData();
        for (const room of houseRooms) {
            const roomDetail = initData?.houseRoomDetailMap?.[room.houseRoomHrid];
            if (roomDetail?.usableInActionTypeMap?.[actionDetails.type]) {
                houseEfficiency += (room.level || 0) * 1.5;
            }
        }
    }

    // Gathering-only: gathering quantity bonuses
    let totalGathering = 0;
    let gatheringDetails = null;

    if (!isProduction && GATHERING_TYPES.includes(actionDetails.type)) {
        const gatheringTea = parseGatheringBonus(drinkSlots, itemDetailMap, drinkConcentration);
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
        const communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;
        const achievementGathering = dataManager.getAchievementBuffFlatBoost(
            actionDetails.type,
            '/buff_types/gathering'
        );
        const personalGathering = dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/gathering');
        totalGathering = gatheringTea + communityGathering + achievementGathering + personalGathering;
        gatheringDetails = { gatheringTea, communityGathering, achievementGathering, personalGathering };
    }

    // Build efficiency breakdown
    const efficiencyBreakdown = calculateEfficiencyBreakdown({
        requiredLevel: baseRequirement,
        skillLevel,
        teaSkillLevelBonus,
        actionLevelBonus,
        houseEfficiency,
        equipmentEfficiency,
        teaEfficiency,
        communityEfficiency,
        achievementEfficiency,
        personalEfficiency,
        guildEfficiency,
    });

    const efficiencyMultiplier = calculateEfficiencyMultiplier(efficiencyBreakdown.totalEfficiency);

    return {
        // Equipment / drinks
        equipment,
        drinkSlots,
        drinkConcentration,
        itemDetailMap,
        // Timing
        actionTime,
        speedBonus,
        personalSpeedBonus,
        guildSpeedBonus,
        baseTimePerActionSec,
        // Skill
        skillLevel,
        baseRequirement,
        // Tea bonuses
        teaSkillLevelBonus,
        teaEfficiency,
        processingBonus,
        gourmetBonus,
        // Equipment efficiency
        equipmentEfficiency,
        equipmentEfficiencyItems,
        achievementEfficiency,
        personalEfficiency,
        guildEfficiency,
        // Production-only (zero for gathering)
        artisanBonus,
        actionLevelBonus,
        houseEfficiency,
        communityEfficiency,
        // Gathering-only (zero/null for production)
        totalGathering,
        gatheringDetails,
        // Final efficiency results
        efficiencyBreakdown,
        efficiencyMultiplier,
    };
}

export default {
    stackAdditive,
    calculateEfficiencyMultiplier,
    calculateEfficiencyBreakdown,
    getActionEfficiencyContext,
};
