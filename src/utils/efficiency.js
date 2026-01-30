/**
 * Efficiency Utilities Module
 * Calculations for efficiency stacking and breakdowns
 */

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
}) {
    const effectiveRequirement = (requiredLevel || 0) + actionLevelBonus;
    const baseSkillLevel = Math.max(skillLevel || 0, requiredLevel || 0);
    const effectiveLevel = baseSkillLevel + teaSkillLevelBonus;
    const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
    const totalEfficiency = stackAdditive(
        levelEfficiency,
        houseEfficiency,
        equipmentEfficiency,
        teaEfficiency,
        communityEfficiency,
        achievementEfficiency
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
            actionLevelBonus,
            teaSkillLevelBonus,
        },
    };
}

export default {
    stackAdditive,
    calculateEfficiencyMultiplier,
    calculateEfficiencyBreakdown,
};
