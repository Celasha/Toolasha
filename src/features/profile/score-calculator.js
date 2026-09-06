/**
 * Combat/Skiller Score Calculator (TLA-041)
 *
 * Estimated cost for the viewer to reproduce the viewed persistent build now, using current
 * acquisition prices and the viewer's own current/manual Enhancing setup. Deliberately
 * viewer-relative: two different viewers looking at the same profile can get different numbers.
 *
 * Combat Score  = Houses + equipped Abilities + Combat/shared Equipment + personal Combat Shrines
 * Skiller Score = Skilling Houses + Skilling/shared Equipment + personal Skilling Shrines
 * No Achievements component. No Combat + Skiller grand total.
 *
 * Composition root only - the actual valuation logic lives in `./score/*.js`.
 */

import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { calculateHouseScore } from './score/house-score.js';
import { calculateAbilityScore } from './score/ability-score.js';
import { calculateEquipmentScore } from './score/equipment-score.js';
import { calculateShrineScore } from './score/shrine-score.js';
import { mergeCategory } from './score/score-result.js';

/**
 * Calculate combat/skiller score from profile data.
 * @param {Object} profileData - Profile data from game
 * @returns {Promise<Object>} {total, complete, house, houseComplete, ability, abilityComplete,
 *   equipment, equipmentComplete, shrine, shrineComplete, breakdown, skillerTotal, skillerComplete,
 *   skillerHouse, skillerHouseComplete, skillerEquipment, skillerEquipmentComplete, skillerShrine,
 *   skillerShrineComplete, skillerBreakdown, equipmentHidden, hasEquipmentData}
 */
export async function calculateCombatScore(profileData) {
    try {
        const enhancingParams = getEnhancingParams();

        const houses = calculateHouseScore(profileData);
        const abilities = calculateAbilityScore(profileData);
        const shrines = calculateShrineScore(profileData);
        const equipment = await calculateEquipmentScore(profileData, enhancingParams);

        const combat = mergeCategory([houses.combat, abilities, equipment.combat, shrines.combat]);
        const skiller = mergeCategory([houses.skiller, equipment.skiller, shrines.skiller]);

        return {
            // Combat score (houses + abilities + combat equipment + combat shrines)
            total: combat.score,
            complete: combat.complete,
            house: houses.combat.score,
            houseComplete: houses.combat.complete,
            ability: abilities.score,
            abilityComplete: abilities.complete,
            equipment: equipment.combat.score,
            equipmentComplete: equipment.combat.complete,
            shrine: shrines.combat.score,
            shrineComplete: shrines.combat.complete,
            equipmentHidden: profileData.profile?.hideWearableItems || false,
            hasEquipmentData: equipment.hasEquipmentData,
            breakdown: {
                houses: houses.combat.breakdown,
                abilities: abilities.breakdown,
                equipment: equipment.combat.breakdown,
                shrines: shrines.combat.breakdown,
            },
            // Skiller score (skilling houses + skilling equipment + skilling shrines)
            skillerTotal: skiller.score,
            skillerComplete: skiller.complete,
            skillerHouse: houses.skiller.score,
            skillerHouseComplete: houses.skiller.complete,
            skillerEquipment: equipment.skiller.score,
            skillerEquipmentComplete: equipment.skiller.complete,
            skillerShrine: shrines.skiller.score,
            skillerShrineComplete: shrines.skiller.complete,
            skillerBreakdown: {
                houses: houses.skiller.breakdown,
                equipment: equipment.skiller.breakdown,
                shrines: shrines.skiller.breakdown,
            },
        };
    } catch (error) {
        console.error('[CombatScore] Error calculating score:', error);
        return {
            total: 0,
            complete: false,
            house: 0,
            houseComplete: false,
            ability: 0,
            abilityComplete: false,
            equipment: 0,
            equipmentComplete: false,
            shrine: 0,
            shrineComplete: false,
            equipmentHidden: false,
            hasEquipmentData: false,
            breakdown: { houses: [], abilities: [], equipment: [], shrines: [] },
            skillerTotal: 0,
            skillerComplete: false,
            skillerHouse: 0,
            skillerHouseComplete: false,
            skillerEquipment: 0,
            skillerEquipmentComplete: false,
            skillerShrine: 0,
            skillerShrineComplete: false,
            skillerBreakdown: { houses: [], equipment: [], shrines: [] },
        };
    }
}
