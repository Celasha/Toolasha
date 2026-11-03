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

export default { getDotDurationMs };
