/**
 * Ability effects Combat Live needs from the game's static data.
 */

import dataManager from '../../core/data-manager.js';

const NS_PER_MS = 1e6;

/**
 * How long an ability keeps damaging its targets after the cast.
 * @param {string} abilityHrid
 * @returns {number} Longest damage-over-time duration among its effects in ms, 0 when it has none
 */
export function getDotDurationMs(abilityHrid) {
    const effects = dataManager.getInitClientData()?.abilityDetailMap?.[abilityHrid]?.abilityEffects || [];
    let longest = 0;
    for (const effect of effects) {
        if (effect.damageOverTimeRatio > 0 && effect.damageOverTimeDuration > longest) {
            longest = effect.damageOverTimeDuration;
        }
    }
    return longest / NS_PER_MS;
}

/**
 * @param {string} abilityHrid
 * @returns {?{manaCost: number, cooldownMs: number}} What the ability costs and how long before it can be
 *     cast again, null when the game data does not know it
 */
export function getAbilityTiming(abilityHrid) {
    const detail = dataManager.getInitClientData()?.abilityDetailMap?.[abilityHrid];
    if (!detail) return null;
    return { manaCost: detail.manaCost || 0, cooldownMs: (detail.cooldownDuration || 0) / NS_PER_MS };
}

/**
 * @param {string} abilityHrid
 * @returns {Object[]} The ability's effects as the game data lists them (empty when unknown)
 */
export function getAbilityEffects(abilityHrid) {
    return dataManager.getInitClientData()?.abilityDetailMap?.[abilityHrid]?.abilityEffects || [];
}

export default { getDotDurationMs, getAbilityTiming, getAbilityEffects };
