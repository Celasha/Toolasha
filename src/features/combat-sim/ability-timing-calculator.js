/**
 * Ability Timing Calculator
 * Computes the current character's LIVE effective ability cooldown/cast time,
 * accounting for Ability Haste, Cast Speed, and Attack level - values the native
 * ability tooltip never applies (it only ever shows the static base numbers).
 */

import dataManager from '../../core/data-manager.js';
import { buildGameDataPayload, buildPlayerDTO } from './combat-sim-adapter.js';
import { setGameData } from './engine/game-data.js';
import Player from './engine/player.js';

const COMBAT_ACTION_TYPE = '/action_types/combat';
const CAST_SPEED_BUFF_TYPE = '/buff_types/cast_speed';

// House and equipment are already reconstructed by Player.generatePermanentBuffs(), so summing
// them again here would double-count. Only the remaining live buff-map sources are added.
const LIVE_CAST_SPEED_BUFF_MAPS = [
    'consumableActionTypeBuffsMap',
    'personalActionTypeBuffsMap',
    'achievementActionTypeBuffsMap',
    'mooPassActionTypeBuffsMap',
    'communityActionTypeBuffsMap',
    'guildActionTypeBuffsMap',
];

/**
 * Sum the /buff_types/cast_speed flat boost currently active for combat, across every live
 * buff-map source other than equipment/house (those are already covered by the reconstructed
 * Player's permanent buffs).
 * @param {Object} characterData - dataManager.characterData
 * @returns {number} Combined flat boost (e.g. 0.12 for Channeling Coffee)
 */
function getLiveCastSpeedFlatBoost(characterData) {
    let total = 0;
    for (const mapName of LIVE_CAST_SPEED_BUFF_MAPS) {
        const buffs = characterData?.[mapName]?.[COMBAT_ACTION_TYPE];
        if (!Array.isArray(buffs)) continue;
        for (const buff of buffs) {
            if (buff?.typeHrid === CAST_SPEED_BUFF_TYPE) {
                total += buff.flatBoost || 0;
            }
        }
    }
    return total;
}

/**
 * Compute the current character's live effective combat stats relevant to ability timing.
 * Reconstructs a Player instance from current equipment + house rooms (same engine Combat Sim
 * uses), then adds active temporary buffs (consumables, seals, achievements, moo pass,
 * community, guild) that the reconstruction itself doesn't cover.
 * @returns {{abilityHaste: number, castSpeed: number, attackLevel: number}|null}
 */
export function getCurrentAbilityTimingStats() {
    const gameData = buildGameDataPayload();
    if (!gameData) return null;

    const dto = buildPlayerDTO();
    if (!dto) return null;

    setGameData(gameData);
    const player = Player.createFromDTO(dto);
    // Base CombatUnit defaults zoneBuffs/extraBuffs to {} (not arrays); generatePermanentBuffs()
    // calls .forEach() on them, so they must be real arrays even though no zone/labyrinth is
    // in play here. Only equipment/house-room buffs are relevant to this standalone reconstruction.
    player.zoneBuffs = [];
    player.extraBuffs = [];
    player.generatePermanentBuffs();
    player.clearBuffs();

    const liveCastSpeedBoost = getLiveCastSpeedFlatBoost(dataManager.characterData);

    return {
        abilityHaste: player.combatDetails.combatStats.abilityHaste,
        castSpeed: player.combatDetails.combatStats.castSpeed + liveCastSpeedBoost,
        attackLevel: player.attackLevel,
    };
}

/**
 * Compute effective cooldown/cast time (seconds) for an ability, given base durations in
 * nanoseconds (as stored in abilityDetailMap) and live combat stats.
 * @param {number} baseCooldownNs - abilityDetailMap.cooldownDuration (nanoseconds)
 * @param {number} baseCastDurationNs - abilityDetailMap.castDuration (nanoseconds)
 * @param {{abilityHaste: number, castSpeed: number}} stats - Live combat stats
 * @returns {{baseCooldown: number, effectiveCooldown: number, baseCastTime: number, effectiveCastTime: number}}
 */
export function calculateEffectiveAbilityTiming(baseCooldownNs, baseCastDurationNs, stats) {
    const baseCooldown = baseCooldownNs / 1e9;
    const baseCastTime = baseCastDurationNs / 1e9;

    const effectiveCooldown = stats.abilityHaste > 0 ? (baseCooldown * 100) / (100 + stats.abilityHaste) : baseCooldown;
    const effectiveCastTime = baseCastTime / (1 + stats.castSpeed);

    return { baseCooldown, effectiveCooldown, baseCastTime, effectiveCastTime };
}
