/**
 * Combat Level Progress Calculator
 * Derives a continuous (fractional) Combat Level for display purposes only.
 *
 * MWI's native player Combat Level is an integer, computed as:
 *   raw = 0.1 * (Stamina + Intelligence + Attack + Defense + max(Melee, Ranged, Magic))
 *       + 0.5 * max(Attack, Defense, Melee, Ranged, Magic)
 *   nativeCombatLevel = floor(raw)
 *
 * This module applies the same weighting to fractional skill levels (integer level + XP
 * progress toward the next level) to produce a "weighted progress toward the next level"
 * score, e.g. 94.80. This value must never replace or contradict the native integer level -
 * see clampDisplayCombatLevel().
 */

export const COMBAT_SKILL_HRIDS = {
    stamina: '/skills/stamina',
    intelligence: '/skills/intelligence',
    attack: '/skills/attack',
    defense: '/skills/defense',
    melee: '/skills/melee',
    ranged: '/skills/ranged',
    magic: '/skills/magic',
};

/**
 * Fractional skill level: integer level + XP progress toward the next level, clamped to
 * [level, level + 1). Falls back to the plain integer level if the table has no next-level
 * entry (max level) or the table is unavailable.
 * @param {number} level - Native integer skill level
 * @param {number} experience - Current skill XP
 * @param {Array<number>|undefined} levelExperienceTable - Native level -> XP table
 * @returns {number}
 */
export function calculateFractionalSkillLevel(level, experience, levelExperienceTable) {
    const currentThreshold = levelExperienceTable?.[level];
    const nextThreshold = levelExperienceTable?.[level + 1];

    if (
        typeof currentThreshold !== 'number' ||
        typeof nextThreshold !== 'number' ||
        nextThreshold <= currentThreshold
    ) {
        return level;
    }

    const progress = (experience - currentThreshold) / (nextThreshold - currentThreshold);
    return level + Math.min(Math.max(progress, 0), 0.999999999);
}

/**
 * Apply MWI's native Combat Level weighting to a set of skill levels (integer or fractional -
 * the formula is identical either way).
 * @param {{stamina: number, intelligence: number, attack: number, defense: number, melee: number, ranged: number, magic: number}} levels
 * @returns {number}
 */
export function calculateWeightedCombatScore(levels) {
    const { stamina, intelligence, attack, defense, melee, ranged, magic } = levels;
    const combatStyleMax = Math.max(melee, ranged, magic);
    const primaryMax = Math.max(attack, defense, melee, ranged, magic);
    return 0.1 * (stamina + intelligence + attack + defense + combatStyleMax) + 0.5 * primaryMax;
}

/**
 * Clamp a continuous combat score for display so it never contradicts the native integer
 * Combat Level: bounded to [nativeLevel, nativeLevel + 0.99], truncated (never rounded) to
 * two decimals so a value like N.995 displays as N.99, not N+1.00.
 * @param {number} continuousScore
 * @param {number} nativeCombatLevel
 * @returns {number}
 */
export function clampDisplayCombatLevel(continuousScore, nativeCombatLevel) {
    const clamped = Math.min(Math.max(continuousScore, nativeCombatLevel), nativeCombatLevel + 0.99);
    return Math.floor(clamped * 100) / 100;
}

/**
 * Compute the precise (continuous, display-only) Combat Level for a set of live skills.
 * @param {Array<{skillHrid: string, level: number, experience: number}>|null} skills - dataManager.getSkills() shape
 * @param {Array<number>|undefined} levelExperienceTable - Native level -> XP table
 * @returns {{nativeCombatLevel: number, preciseValue: number}|null} null if required skill/table data is missing
 */
export function calculatePreciseCombatLevel(skills, levelExperienceTable) {
    if (!skills || !levelExperienceTable) return null;

    const skillByHrid = {};
    for (const skill of skills) {
        skillByHrid[skill.skillHrid] = skill;
    }

    const integerLevels = {};
    const fractionalLevels = {};
    for (const [key, hrid] of Object.entries(COMBAT_SKILL_HRIDS)) {
        const skill = skillByHrid[hrid];
        if (!skill || typeof skill.level !== 'number') return null;
        integerLevels[key] = skill.level;
        fractionalLevels[key] = calculateFractionalSkillLevel(skill.level, skill.experience, levelExperienceTable);
    }

    const nativeCombatLevel = Math.floor(calculateWeightedCombatScore(integerLevels));
    const continuousScore = calculateWeightedCombatScore(fractionalLevels);
    const preciseValue = clampDisplayCombatLevel(continuousScore, nativeCombatLevel);

    return { nativeCombatLevel, preciseValue };
}
