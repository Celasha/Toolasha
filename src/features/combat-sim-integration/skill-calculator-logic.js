/**
 * Skill Calculator Logic
 * Calculation functions for skill progression and combat level
 */

/**
 * Calculate time required to reach target level
 * @param {number} currentExp - Current experience
 * @param {number} targetLevel - Target level to reach
 * @param {number} expPerHour - Experience gained per hour
 * @param {Object} levelExpTable - Level experience table from init_client_data
 * @returns {Object|null} { hours, days, remainingHours, readable } or null if invalid
 */
export function calculateTimeToLevel(currentExp, targetLevel, expPerHour, levelExpTable) {
    if (!levelExpTable || expPerHour <= 0 || targetLevel < 1) {
        return null;
    }

    const targetExp = levelExpTable[targetLevel];
    if (targetExp === undefined) {
        return null;
    }

    const expNeeded = targetExp - currentExp;
    if (expNeeded <= 0) {
        return { hours: 0, days: 0, remainingHours: 0, readable: 'Already achieved' };
    }

    const hoursNeeded = expNeeded / expPerHour;
    const days = Math.floor(hoursNeeded / 24);
    const remainingHours = Math.floor(hoursNeeded % 24);
    const remainingMinutes = Math.floor((hoursNeeded % 1) * 60);

    return {
        hours: hoursNeeded,
        days,
        remainingHours,
        remainingMinutes,
        readable: formatTime(days, remainingHours, remainingMinutes),
    };
}

/**
 * Calculate projected levels after X days
 * @param {Object} skills - Character skills object (from dataManager)
 * @param {Object} expRates - Exp/hour rates for each skill
 * @param {number} days - Number of days to project
 * @param {Object} levelExpTable - Level experience table
 * @returns {Object} Projected levels and combat level
 */
export function calculateLevelsAfterDays(skills, expRates, days, levelExpTable) {
    if (!skills || !expRates || !levelExpTable || days < 0) {
        return null;
    }

    const results = {};
    const skillNames = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];

    for (const skillName of skillNames) {
        const skill = skills.find((s) => s.skillHrid.includes(skillName));
        if (!skill) {
            results[skillName] = { level: 1, exp: 0, percentage: 0 };
            continue;
        }

        const currentExp = skill.experience;
        const expRate = expRates[skillName] || 0;
        const expGained = expRate * days * 24;
        const finalExp = currentExp + expGained;

        // Find level from exp table
        let level = 1;
        while (level < 200 && levelExpTable[level + 1] <= finalExp) {
            level++;
        }

        // Calculate percentage through current level
        const minExpAtLevel = levelExpTable[level];
        const maxExpAtLevel = levelExpTable[level + 1] - 1;
        const expSpanInLevel = maxExpAtLevel - minExpAtLevel;
        const percentage = expSpanInLevel > 0 ? ((finalExp - minExpAtLevel) / expSpanInLevel) * 100 : 0;

        results[skillName] = {
            level,
            exp: finalExp,
            percentage: Number(percentage.toFixed(1)),
        };
    }

    // Calculate combat level
    results.combatLevel = calculateCombatLevel(results);

    return results;
}

/**
 * Calculate combat level from skill levels
 * Formula: 0.1 * (Stamina + Intelligence + Attack + Defense + MAX(Melee, Ranged, Magic)) + 0.5 * MAX(Attack, Defense, Melee, Ranged, Magic)
 * @param {Object} skills - Skill levels object
 * @returns {number} Combat level
 */
export function calculateCombatLevel(skills) {
    const stamina = skills.stamina?.level || 1;
    const intelligence = skills.intelligence?.level || 1;
    const attack = skills.attack?.level || 1;
    const melee = skills.melee?.level || 1;
    const defense = skills.defense?.level || 1;
    const ranged = skills.ranged?.level || 1;
    const magic = skills.magic?.level || 1;

    const maxCombatSkill = Math.max(melee, ranged, magic);
    const maxAllCombat = Math.max(attack, defense, melee, ranged, magic);

    return 0.1 * (stamina + intelligence + attack + defense + maxCombatSkill) + 0.5 * maxAllCombat;
}

/**
 * Format time as readable string
 * @param {number} days - Number of days
 * @param {number} hours - Remaining hours
 * @param {number} minutes - Remaining minutes
 * @returns {string} Formatted time string
 */
function formatTime(days, hours, minutes) {
    const parts = [];

    if (days > 0) {
        parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    }
    if (hours > 0) {
        parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0 || parts.length === 0) {
        parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }

    return parts.join(' ');
}

/**
 * Get current level from experience
 * @param {number} exp - Current experience
 * @param {Object} levelExpTable - Level experience table
 * @returns {number} Current level
 */
export function getLevelFromExp(exp, levelExpTable) {
    let level = 1;
    while (level < 200 && levelExpTable[level + 1] <= exp) {
        level++;
    }
    return level;
}
