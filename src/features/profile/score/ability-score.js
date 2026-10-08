/**
 * Ability Score (TLA-041)
 *
 * Combat-only category (equipped abilities only, matching current scope). Cost per ability book
 * is data-driven (`abilityBookDetail.experienceGain`) and Ask-only (F-11).
 */

import dataManager from '../../../core/data-manager.js';
import { calculateAbilityBookCostDataDriven } from '../../../utils/ability-cost-calculator.js';
import { emptyCategory, attribute } from './score-result.js';
import { getAbilityName } from '../../../utils/game-i18n.js';

/**
 * @param {Object} profileData - Profile data from game
 * @returns {Object} category result {score, complete, unpricedCount, breakdown}
 */
export function calculateAbilityScore(profileData) {
    // Use equippedAbilities (not characterAbilities) to match MCS behavior.
    const equippedAbilities = profileData.profile?.equippedAbilities || [];
    const abilityDetailMap = dataManager.getInitClientData()?.abilityDetailMap || {};

    const category = emptyCategory();

    for (const ability of equippedAbilities) {
        if (!ability.abilityHrid || ability.level === 0) continue;

        const { cost, complete, isOutlier } = calculateAbilityBookCostDataDriven(ability.abilityHrid, ability.level);

        const hridFallbackName = ability.abilityHrid
            .replace('/abilities/', '')
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        const abilityName = getAbilityName(
            ability.abilityHrid,
            abilityDetailMap[ability.abilityHrid]?.name || hridFallbackName
        );

        attribute(category, { name: `${abilityName} ${ability.level}`, cost, complete, isOutlier });
    }

    return category;
}
