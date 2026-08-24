/**
 * Combat Level formula helpers.
 *
 * MWI's official Combat Level formula (per the in-game Game Guide) is:
 *   raw = 0.1 * (Stamina + Intelligence + Attack + Defense + max(Melee, Ranged, Magic))
 *       + 0.5 * max(Attack, Defense, Melee, Ranged, Magic)
 *
 * Applied to current whole skill levels, `raw` naturally has at most one meaningful decimal
 * digit (the 0.1/0.5 coefficients on integer inputs cannot produce more). MWI's native sidebar
 * floors this to an integer for display; this module exposes the unfloored value so the decimal
 * sidebar display can show it (e.g. 133.2 next to a native 133). This same raw/unfloored value is
 * SERVER-CONFIRMED (direct MWI developer evidence) to also be the Level Malus mechanic input -
 * see calculateLevelGapDebuff()'s doc comment in combat-sim-adapter.js - not the floored native
 * integer.
 *
 * This must never be confused with XP-within-level interpolation: inventing a fractional skill
 * level from XP progress toward the next level is a different, invalid metric for this mechanic
 * and must not feed into this formula.
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
 * Apply MWI's official Combat Level formula to a set of whole skill levels, rounded to one
 * decimal place. The rounding only clears IEEE-754 float noise from the 0.1/0.5 coefficients
 * (e.g. 0.1 * 3 === 0.30000000000000004 in JS) - it never discards real precision, since integer
 * inputs cannot produce more than one meaningful decimal digit.
 * @param {{stamina: number, intelligence: number, attack: number, defense: number, melee: number, ranged: number, magic: number}} levels
 * @returns {number}
 */
export function calculateRawCombatLevel(levels) {
    const { stamina, intelligence, attack, defense, melee, ranged, magic } = levels;
    const combatStyleMax = Math.max(melee, ranged, magic);
    const primaryMax = Math.max(attack, defense, melee, ranged, magic);
    const raw = 0.1 * (stamina + intelligence + attack + defense + combatStyleMax) + 0.5 * primaryMax;
    return Math.round(raw * 10) / 10;
}

/**
 * Compute the raw (unfloored) Combat Level from a live skills list, using only whole skill
 * levels - no XP-within-level interpolation and no dependency on the level/XP table.
 * @param {Array<{skillHrid: string, level: number}>|null} skills - dataManager.getSkills() shape
 * @returns {number|null} null if required combat skill data is missing
 */
export function calculateCombatLevelFromSkills(skills) {
    if (!skills) return null;

    const skillByHrid = {};
    for (const skill of skills) {
        skillByHrid[skill.skillHrid] = skill;
    }

    const levels = {};
    for (const [key, hrid] of Object.entries(COMBAT_SKILL_HRIDS)) {
        const skill = skillByHrid[hrid];
        if (!skill || typeof skill.level !== 'number') return null;
        levels[key] = skill.level;
    }

    return calculateRawCombatLevel(levels);
}
