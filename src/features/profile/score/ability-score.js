/**
 * Ability Score (TLA-041)
 *
 * Combat-only category (equipped abilities only, matching current scope). Cost per ability book
 * is data-driven (`abilityBookDetail.experienceGain`) and Ask-only (F-11).
 */

import { calculateAbilityBookCostDataDriven } from '../../../utils/ability-cost-calculator.js';
import { emptyCategory, attribute } from './score-result.js';

/**
 * @param {Object} profileData - Profile data from game
 * @returns {Object} category result {score, complete, unpricedCount, breakdown}
 */
export function calculateAbilityScore(profileData) {
    // Use equippedAbilities (not characterAbilities) to match MCS behavior.
    const equippedAbilities = profileData.profile?.equippedAbilities || [];

    const category = emptyCategory();

    for (const ability of equippedAbilities) {
        if (!ability.abilityHrid || ability.level === 0) continue;

        const { cost, complete } = calculateAbilityBookCostDataDriven(ability.abilityHrid, ability.level);

        const abilityName = ability.abilityHrid
            .replace('/abilities/', '')
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        attribute(category, { name: `${abilityName} ${ability.level}`, cost, complete });
    }

    return category;
}
