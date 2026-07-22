/**
 * Upgrade Advisor for Combat Sim
 *
 * Generates equipment upgrade candidates, calculates their costs,
 * and runs simulations to rank them by "Gold per 0.01% improvement".
 */

import dataManager from '../../core/data-manager.js';
import { buildGameDataPayload, calculateSimRevenue } from './combat-sim-adapter.js';
import { runSimulation, runLabyrinthSimulation } from './combat-sim-runner.js';
import labyrinthClearRate from '../combat/labyrinth-clear-rate.js';
import { resolveItemPrice } from '../../utils/profit-helpers.js';
import { getItemPrices } from '../../utils/market-data.js';
import { calculateEnhancement } from '../../utils/enhancement-calculator.js';
import { getEnhancingParams, getAutoDetectedParams } from '../../utils/enhancement-config.js';
import { getCheapestProtectionPrice, getProductionCost } from '../enhancement/tooltip-enhancement.js';
import { calculateAbilityLevelUpCost } from '../../utils/ability-cost-calculator.js';
import { buildOverridesForSkill } from './skilling-sim-helpers.js';

/** Enhancement breakpoints by slot type */
const BREAKPOINTS_DEFAULT = [7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const BREAKPOINTS_JEWELRY = [5, 7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const BREAKPOINTS_BACK = [3, 5, 7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const BREAKPOINTS_REFINED = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const JEWELRY_SLOTS = new Set(['/equipment_types/earrings', '/equipment_types/ring', '/equipment_types/neck']);

/**
 * Get the next ability level target (next multiple of 10) above the current level.
 * Used as fallback when no explicit target level is provided.
 * @param {number} currentLevel - Current ability level
 * @returns {number|null} Next target level, or null if at max (200)
 */
function getNextAbilityBreakpoint(currentLevel) {
    const next = Math.ceil((currentLevel + 1) / 10) * 10;
    return next <= 200 ? next : null;
}

/**
 * Get the next enhancement breakpoint above the current level.
 * Uses slot-specific breakpoints: jewelry gets +5, back gets +3/+5,
 * refined items always start at +10 minimum.
 * @param {number} currentLevel - Current enhancement level
 * @param {string} slot - Equipment slot HRID
 * @param {string} itemHrid - Item HRID (used to detect refined items)
 * @returns {number|null} Next breakpoint level, or null if already at max
 */
function getNextBreakpoint(currentLevel, slot, itemHrid) {
    let breakpoints;
    if (itemHrid.includes('_refined')) {
        breakpoints = BREAKPOINTS_REFINED;
    } else if (JEWELRY_SLOTS.has(slot)) {
        breakpoints = BREAKPOINTS_JEWELRY;
    } else if (slot === '/equipment_types/back') {
        breakpoints = BREAKPOINTS_BACK;
    } else {
        breakpoints = BREAKPOINTS_DEFAULT;
    }

    for (const bp of breakpoints) {
        if (bp > currentLevel) return bp;
    }
    return null;
}

/**
 * Get the player's primary combat style from their weapon.
 * @param {Object} playerDTO
 * @param {Object} gameData
 * @returns {string} e.g., 'slash', 'stab', 'smash', 'ranged', 'magic'
 */
function getPlayerCombatStyle(playerDTO, gameData) {
    const weapon = playerDTO.equipment['/equipment_types/main_hand'];
    if (!weapon) return 'unknown';
    const weaponDetails = gameData.itemDetailMap[weapon.hrid];
    const stats = weaponDetails?.equipmentDetail?.combatStats;
    if (!stats) return 'unknown';

    if (stats.rangedDamage > 0) return 'ranged';
    if (stats.magicDamage > 0) return 'magic';
    if (stats.stabDamage > 0) return 'stab';
    if (stats.slashDamage > 0) return 'slash';
    if (stats.smashDamage > 0) return 'smash';
    return 'unknown';
}

/**
 * Get the combat style of an ability from its effects.
 * Uses combatStyleHrid for damage abilities, buff typeHrid/skill multipliers for buffs.
 * @param {Object} abilityDetail - From abilityDetailMap
 * @returns {string} 'stab', 'slash', 'smash', 'ranged', 'magic', 'melee', 'physical', or 'universal'
 */
function getAbilityCombatStyle(abilityDetail) {
    // Check for direct combat style on damage/heal effects
    for (const effect of abilityDetail.abilityEffects || []) {
        if (effect.combatStyleHrid) {
            return effect.combatStyleHrid.split('/').pop();
        }
    }

    // For buff abilities, analyze buff types and skill multipliers
    const buffTypes = new Set();
    const skillMultipliers = new Set();

    for (const effect of abilityDetail.abilityEffects || []) {
        if (effect.effectType?.includes('heal')) return 'universal';
        if (!effect.buffs) continue;
        for (const buff of effect.buffs) {
            if (buff.typeHrid) buffTypes.add(buff.typeHrid);
            if (buff.multiplierForSkillHrid) skillMultipliers.add(buff.multiplierForSkillHrid);
        }
    }

    // Skill multiplier is the strongest signal
    if (skillMultipliers.has('/skills/magic')) return 'magic';
    if (skillMultipliers.has('/skills/melee')) return 'melee';
    if (skillMultipliers.has('/skills/ranged')) return 'ranged';

    // Buff type analysis
    const hasElementalAmp =
        buffTypes.has('/buff_types/water_amplify') ||
        buffTypes.has('/buff_types/nature_amplify') ||
        buffTypes.has('/buff_types/fire_amplify');
    if (hasElementalAmp) return 'magic';

    const hasPhysicalAmp = buffTypes.has('/buff_types/physical_amplify');
    if (hasPhysicalAmp) return 'physical';

    // Attack speed without cast speed = physical only
    const hasAttackSpeed = buffTypes.has('/buff_types/attack_speed');
    const hasCastSpeed = buffTypes.has('/buff_types/cast_speed');
    if (hasAttackSpeed && !hasCastSpeed) return 'physical';

    // Universal buffs: attack_speed+cast_speed, damage, accuracy, evasion, armor, thorns, etc.
    return 'universal';
}

/**
 * Check if an ability is compatible with a player's weapon style.
 * @param {string} abilityStyle - From getAbilityCombatStyle()
 * @param {string} weaponStyle - From getPlayerCombatStyle()
 * @returns {boolean}
 */
function isAbilityCompatible(abilityStyle, weaponStyle) {
    // Universal abilities work for everyone
    if (abilityStyle === 'universal') return true;

    // Magic abilities only for magic weapons
    if (abilityStyle === 'magic') return weaponStyle === 'magic';

    // Ranged abilities only for ranged weapons
    if (abilityStyle === 'ranged') return weaponStyle === 'ranged';

    // Physical (non-elemental amplify) works for all melee and ranged
    const meleeStyles = ['stab', 'slash', 'smash'];
    if (abilityStyle === 'physical') {
        return meleeStyles.includes(weaponStyle) || weaponStyle === 'ranged';
    }

    // Melee-specific (e.g., fierce aura with /skills/melee multiplier)
    if (abilityStyle === 'melee') return meleeStyles.includes(weaponStyle);

    // Specific melee sub-styles (stab/slash/smash abilities) work with any melee weapon
    if (meleeStyles.includes(abilityStyle)) return meleeStyles.includes(weaponStyle);

    return abilityStyle === weaponStyle;
}

/**
 * Calculate the gold cost of enhancing an item from startLevel to targetLevel.
 * Uses incremental cost approach: cost(0→target) - cost(0→start), matching
 * the tooltip's enhancement path calculation exactly.
 * @param {string} itemHrid - Item HRID
 * @param {number} startLevel - Starting enhancement level
 * @param {number} targetLevel - Target enhancement level
 * @param {Object} gameData - Game data from buildGameDataPayload()
 * @param {Object} [options] - Options
 * @param {string} [options.slot] - Equipment slot HRID (forces auto-detect for back items)
 * @returns {number} Expected gold cost
 */
function calculateEnhancementCost(itemHrid, startLevel, targetLevel, gameData, options = {}) {
    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails?.enhancementCosts || itemDetails.enhancementCosts.length === 0) {
        return 0;
    }

    // Back items are non-tradeable, always use player's actual enhancing stats
    const enhancingParams = options.slot === '/equipment_types/back' ? getAutoDetectedParams() : getEnhancingParams();
    const itemLevel = itemDetails.itemLevel || 1;

    // Calculate per-attempt material cost (matches tooltip-enhancement pricing)
    let perAttemptCost = 0;
    for (const material of itemDetails.enhancementCosts) {
        let price = 0;
        if (material.itemHrid.startsWith('/items/trainee_')) {
            price = 250000;
        } else if (material.itemHrid === '/items/coin') {
            price = 1;
        } else {
            const marketPrice = getItemPrices(material.itemHrid, 0);
            if (marketPrice) {
                let ask = marketPrice.ask;
                let bid = marketPrice.bid;
                if (ask > 0 && bid < 0) bid = ask;
                if (bid > 0 && ask < 0) ask = bid;
                if (ask > 0) {
                    price = ask;
                }
            }
            // Fallback if no valid market ask
            if (price === 0) {
                const itemDetail = gameData.itemDetailMap[material.itemHrid];
                price = getProductionCost(material.itemHrid, 'ask') || itemDetail?.sellPrice || 0;
            }
        }
        perAttemptCost += price * material.count;
    }

    // Get cheapest protection price
    const { price: protPrice } = getCheapestProtectionPrice(itemHrid);

    // Calculate full path cost for each level from 1 to targetLevel
    // Find optimal protectFrom for each level (same approach as tooltip)
    // Then: incremental cost = fullCost(targetLevel) - fullCost(startLevel)
    const fullCost = new Array(targetLevel + 1).fill(0);

    for (let level = 1; level <= targetLevel; level++) {
        let bestCost = Infinity;

        // Try all protection strategies: no protection, protect from 2, 3, ..., level
        const protectOptions = [0];
        for (let pf = 2; pf <= level; pf++) {
            protectOptions.push(pf);
        }

        for (const protectFrom of protectOptions) {
            try {
                const result = calculateEnhancement({
                    enhancingLevel: enhancingParams.enhancingLevel,
                    toolBonus: enhancingParams.toolBonus,
                    speedBonus: enhancingParams.speedBonus || 0,
                    itemLevel,
                    targetLevel: level,
                    protectFrom,
                    blessedTea: enhancingParams.teas?.blessed || false,
                    guzzlingBonus: enhancingParams.guzzlingBonus || 1.0,
                });

                const materialCost = perAttemptCost * result.attempts;
                const protectionCost = protPrice * (result.protectionCount || 0);
                const totalForLevel = materialCost + protectionCost;

                if (totalForLevel < bestCost) {
                    bestCost = totalForLevel;
                }
            } catch {
                // Skip this strategy if calculation fails
            }
        }

        fullCost[level] = bestCost === Infinity ? 0 : bestCost;
    }

    // Incremental cost = cost to reach targetLevel - cost to reach startLevel
    return Math.max(0, Math.round(fullCost[targetLevel] - fullCost[startLevel]));
}

/**
 * Classify an item's combat role based on its primary offensive/defensive stats.
 * Items with the same role are valid tier comparison targets.
 * @param {Object} combatStats - equipmentDetail.combatStats
 * @returns {string} Role identifier
 */
function getItemRole(combatStats) {
    if (!combatStats) return 'unknown';

    // Check for elemental amplify — sub-classifies magic gear by element
    const fireAmp = combatStats.fireAmplify || 0;
    const natureAmp = combatStats.natureAmplify || 0;
    const waterAmp = combatStats.waterAmplify || 0;

    if (fireAmp > 0 || natureAmp > 0 || waterAmp > 0) {
        if (fireAmp >= natureAmp && fireAmp >= waterAmp) return 'magic_fire';
        if (natureAmp >= fireAmp && natureAmp >= waterAmp) return 'magic_nature';
        return 'magic_water';
    }

    // Check for primary offensive stats (exclude defensiveDamage — it's a tank stat)
    const melee = (combatStats.stabDamage || 0) + (combatStats.slashDamage || 0) + (combatStats.smashDamage || 0);
    const ranged = combatStats.rangedDamage || 0;
    const magic = combatStats.magicDamage || 0;

    // If item has offensive damage stats, classify by highest
    if (melee > 0 || ranged > 0 || magic > 0) {
        if (ranged >= melee && ranged >= magic) return 'ranged';
        if (magic >= melee && magic >= ranged) return 'magic';
        return 'melee';
    }

    // Items with only defensiveDamage and no offensive damage are tanks
    if (combatStats.defensiveDamage > 0) return 'defensive';

    // Check accuracy as secondary signal
    const meleeAcc =
        (combatStats.stabAccuracy || 0) + (combatStats.slashAccuracy || 0) + (combatStats.smashAccuracy || 0);
    const rangedAcc = combatStats.rangedAccuracy || 0;
    const magicAcc = combatStats.magicAccuracy || 0;

    if (meleeAcc > 0 || rangedAcc > 0 || magicAcc > 0) {
        if (rangedAcc >= meleeAcc && rangedAcc >= magicAcc) return 'ranged';
        if (magicAcc >= meleeAcc && magicAcc >= rangedAcc) return 'magic';
        return 'melee';
    }

    // Defensive/utility gear — armor, evasion, HP
    return 'defensive';
}

/**
 * Get equipment tier progression for a given slot, grouped by role.
 * @param {Object} gameData - Game data from buildGameDataPayload()
 * @returns {Object} Map of "slot|role" → sorted item entries (weakest to strongest)
 */
export function getEquipmentTierProgression(gameData) {
    const progression = {};

    for (const [itemHrid, item] of Object.entries(gameData.itemDetailMap)) {
        if (!item.equipmentDetail?.type) continue;
        if (!item.equipmentDetail.combatStats) continue;
        if (!hasCombatStats(item)) continue;

        const slot = item.equipmentDetail.type;
        const role = getItemRole(item.equipmentDetail.combatStats);
        const key = `${slot}|${role}`;
        if (!progression[key]) {
            progression[key] = [];
        }

        progression[key].push({
            hrid: itemHrid,
            itemLevel: item.itemLevel || 0,
            sortIndex: item.sortIndex ?? 9999,
            name: item.name,
        });
    }

    // Sort each group by itemLevel (primary), then refined after non-refined, then sortIndex
    for (const key of Object.keys(progression)) {
        progression[key].sort((a, b) => {
            if (a.itemLevel !== b.itemLevel) return a.itemLevel - b.itemLevel;
            const aRefined = a.hrid.endsWith('_refined') ? 1 : 0;
            const bRefined = b.hrid.endsWith('_refined') ? 1 : 0;
            if (aRefined !== bRefined) return aRefined - bRefined;
            return a.sortIndex - b.sortIndex;
        });
    }

    return progression;
}

/** Combat-relevant stats that affect simulation outcomes */
const COMBAT_STATS = new Set([
    'stabAccuracy',
    'slashAccuracy',
    'smashAccuracy',
    'rangedAccuracy',
    'magicAccuracy',
    'stabDamage',
    'slashDamage',
    'smashDamage',
    'rangedDamage',
    'magicDamage',
    'defensiveDamage',
    'taskDamage',
    'physicalAmplify',
    'waterAmplify',
    'natureAmplify',
    'fireAmplify',
    'healingAmplify',
    'stabEvasion',
    'slashEvasion',
    'smashEvasion',
    'rangedEvasion',
    'magicEvasion',
    'armor',
    'waterResistance',
    'natureResistance',
    'fireResistance',
    'maxHitpoints',
    'maxManapoints',
    'lifeSteal',
    'hpRegenPer10',
    'mpRegenPer10',
    'physicalThorns',
    'elementalThorns',
    'criticalRate',
    'criticalDamage',
    'armorPenetration',
    'waterPenetration',
    'naturePenetration',
    'firePenetration',
    'abilityHaste',
    'tenacity',
    'manaLeech',
    'castSpeed',
    'threat',
    'parry',
    'mayhem',
    'pierce',
    'curse',
    'fury',
    'weaken',
    'ripple',
    'bloom',
    'blaze',
    'attackSpeed',
    'autoAttackDamage',
    'abilityDamage',
    'retaliation',
    'maxHitpointsRatio',
    'maxManapointsRatio',
]);

/**
 * Check if an item has any combat-relevant stats (not just utility like foodSlots).
 * @param {Object} itemDetails - Item detail from itemDetailMap
 * @returns {boolean}
 */
function hasCombatStats(itemDetails) {
    if (!itemDetails?.equipmentDetail?.combatStats) return false;
    for (const stat of Object.keys(itemDetails.equipmentDetail.combatStats)) {
        if (COMBAT_STATS.has(stat) && itemDetails.equipmentDetail.combatStats[stat] !== 0) {
            return true;
        }
    }
    return false;
}

/**
 * Build a map of valid tier upgrades based on crafting/production chains.
 * An item X can upgrade to item Y if Y's crafting action uses X as:
 *   - upgradeItemHrid (direct upgrade chain), OR
 *   - one of its inputItems (combination recipes like Philosopher's)
 *
 * Only considers equipment outputs and equipment inputs.
 * @param {Object} gameData
 * @returns {Map<string, Set<string>>} itemHrid → Set of possible upgrade output hrids
 */
function buildUpgradeMap(gameData) {
    const map = new Map();

    for (const action of Object.values(gameData.actionDetailMap)) {
        if (!action.outputItems?.length) continue;
        const outputHrid = action.outputItems[0].itemHrid;

        // Only consider equipment outputs
        const outputItem = gameData.itemDetailMap[outputHrid];
        if (!outputItem?.equipmentDetail?.type) continue;

        // upgradeItemHrid → output (direct upgrade chain)
        if (action.upgradeItemHrid) {
            const upgradeItem = gameData.itemDetailMap[action.upgradeItemHrid];
            if (upgradeItem?.equipmentDetail?.type) {
                if (!map.has(action.upgradeItemHrid)) map.set(action.upgradeItemHrid, new Set());
                map.get(action.upgradeItemHrid).add(outputHrid);
            }
        }

        // inputItems → output (combination recipes like Philosopher's)
        if (action.inputItems) {
            for (const input of action.inputItems) {
                const inputItem = gameData.itemDetailMap[input.itemHrid];
                if (!inputItem?.equipmentDetail?.type) continue;

                if (!map.has(input.itemHrid)) map.set(input.itemHrid, new Set());
                map.get(input.itemHrid).add(outputHrid);
            }
        }
    }

    return map;
}

/**
 * Get the primary damage style of an item's combat stats.
 * @param {Object} combatStats - Item combat stats
 * @returns {string} 'slash', 'stab', 'smash', 'ranged', 'magic', or 'unknown'
 */
function getItemDamageStyle(combatStats) {
    if (!combatStats) return 'unknown';
    const slash = combatStats.slashDamage || 0;
    const stab = combatStats.stabDamage || 0;
    const smash = combatStats.smashDamage || 0;
    const ranged = combatStats.rangedDamage || 0;
    const magic = combatStats.magicDamage || 0;

    if (slash >= stab && slash >= smash && slash >= ranged && slash >= magic && slash > 0) return 'slash';
    if (stab >= slash && stab >= smash && stab >= ranged && stab >= magic && stab > 0) return 'stab';
    if (smash >= slash && smash >= stab && smash >= ranged && smash >= magic && smash > 0) return 'smash';
    if (ranged >= slash && ranged >= stab && ranged >= smash && ranged >= magic && ranged > 0) return 'ranged';
    if (magic > 0) return 'magic';
    return 'unknown';
}

/**
 * Find candidate off-hand items for a given combat style and level range.
 * Returns up to two options (deduped):
 *  - Style-matched: highest-itemLevel off-hand whose offensive stats match the
 *    weapon's damage style (e.g. Manticore Shield for ranged).
 *  - Highest-itemLevel: the strongest off-hand by item level overall, regardless
 *    of style fit (e.g. Knight's Aegis for any cross-slot upgrade).
 * @param {Object} gameData - Game data
 * @param {string} damageStyle - Primary damage style of the weapon
 * @param {number} maxItemLevel - Maximum item level to consider
 * @returns {Array<{hrid: string, itemLevel: number}>}
 */
function findBestOffHand(gameData, damageStyle, maxItemLevel) {
    const isMagic = damageStyle === 'magic';
    const isRanged = damageStyle === 'ranged';
    const isMelee = damageStyle === 'slash' || damageStyle === 'stab' || damageStyle === 'smash';

    let styleMatched = null; // highest-itemLevel off-hand with style-matched stats
    let highest = null; // highest-itemLevel off-hand overall (with magic-exclusion for non-magic)

    for (const [itemHrid, item] of Object.entries(gameData.itemDetailMap)) {
        const eq = item.equipmentDetail;
        if (!eq || eq.type !== '/equipment_types/off_hand') continue;
        if (!hasCombatStats(item)) continue;
        if ((item.itemLevel || 0) > maxItemLevel) continue;

        const level = item.itemLevel || 0;
        const stats = eq.combatStats || {};
        const hasMagicStats = (stats.magicDamage || 0) > 0 || (stats.magicAccuracy || 0) > 0;

        // Build "highest overall" candidate (mirrors original behavior)
        if (isMagic) {
            if (!highest) {
                highest = { hrid: itemHrid, itemLevel: level, isMagic: hasMagicStats };
            } else if (hasMagicStats && !highest.isMagic) {
                highest = { hrid: itemHrid, itemLevel: level, isMagic: true };
            } else if (hasMagicStats === highest.isMagic && level > highest.itemLevel) {
                highest = { hrid: itemHrid, itemLevel: level, isMagic: hasMagicStats };
            }
        } else if (!hasMagicStats && (!highest || level > highest.itemLevel)) {
            // For non-magic, exclude off-hands with magic stats from "highest"
            highest = { hrid: itemHrid, itemLevel: level };
        }

        // Build "style-matched" candidate — highest itemLevel among off-hands whose
        // offensive stats match the weapon's damage style.
        let styleMatch = false;
        if (isMagic) {
            styleMatch = hasMagicStats;
        } else if (isRanged) {
            styleMatch = (stats.rangedDamage || 0) > 0 || (stats.rangedAccuracy || 0) > 0;
        } else if (isMelee) {
            const meleeDmg = (stats.stabDamage || 0) + (stats.slashDamage || 0) + (stats.smashDamage || 0);
            const meleeAcc = (stats.stabAccuracy || 0) + (stats.slashAccuracy || 0) + (stats.smashAccuracy || 0);
            styleMatch = meleeDmg > 0 || meleeAcc > 0;
        }
        if (styleMatch && (!styleMatched || level > styleMatched.itemLevel)) {
            styleMatched = { hrid: itemHrid, itemLevel: level };
        }
    }

    const out = [];
    if (styleMatched) out.push({ hrid: styleMatched.hrid, itemLevel: styleMatched.itemLevel });
    if (highest && (!styleMatched || highest.hrid !== styleMatched.hrid)) {
        out.push({ hrid: highest.hrid, itemLevel: highest.itemLevel });
    }
    return out;
}

/**
 * Generate upgrade candidates for a player's equipment and/or abilities.
 * @param {Object} playerDTO - Player DTO with equipment
 * @param {Object} gameData - Game data from buildGameDataPayload()
 * @param {string} [mode='equipment'] - 'equipment' or 'abilities'
 * @param {number} [abilityTargetLevel=0] - Target level or increment for ability upgrades
 * @param {string} [abilityLevelType='increment'] - 'increment' (add N levels) or 'target' (absolute level)
 * @returns {Array} Candidates: [{slot, currentHrid, currentLevel, upgradeHrid, upgradeLevel, description, type}]
 */
export function generateCandidates(
    playerDTO,
    gameData,
    mode = 'equipment',
    abilityTargetLevel = 0,
    abilityLevelType = 'increment',
    skipBackSlot = false
) {
    const candidates = [];

    if (mode === 'equipment') {
        const tierProgression = getEquipmentTierProgression(gameData);
        const upgradeMap = buildUpgradeMap(gameData);

        for (const [slot, equip] of Object.entries(playerDTO.equipment)) {
            if (!equip) continue;

            const currentHrid = equip.hrid;
            const currentLevel = equip.enhancementLevel || 0;
            const itemDetails = gameData.itemDetailMap[currentHrid];

            // Skip trinkets and items with no combat stats (tools, etc.)
            if (slot === '/equipment_types/trinket') continue;
            if (skipBackSlot && slot === '/equipment_types/back') continue;
            if (!hasCombatStats(itemDetails)) continue;

            // Enhancement upgrade: next breakpoint
            const nextBP = getNextBreakpoint(currentLevel, slot, currentHrid);
            if (nextBP) {
                const itemName = gameData.itemDetailMap[currentHrid]?.name || currentHrid.split('/').pop();
                candidates.push({
                    slot,
                    currentHrid,
                    currentLevel,
                    upgradeHrid: currentHrid,
                    upgradeLevel: nextBP,
                    description: `${itemName} +${currentLevel} → +${nextBP}`,
                    type: 'enhancement',
                });
            }

            // Tier upgrade
            const role = getItemRole(itemDetails?.equipmentDetail?.combatStats);

            if (role === 'defensive') {
                // Defensive items: use crafting chain (upgrade path + combination recipes)
                const upgrades = upgradeMap.get(currentHrid);
                if (upgrades) {
                    for (const upgradeHrid of upgrades) {
                        const upgradeItem = gameData.itemDetailMap[upgradeHrid];
                        if (!upgradeItem?.equipmentDetail) continue;
                        if (upgradeItem.equipmentDetail.type !== slot) continue;
                        const upgradeRole = getItemRole(upgradeItem.equipmentDetail?.combatStats);
                        if (upgradeRole !== 'defensive') continue;

                        const upgradeName = upgradeItem.name || upgradeHrid.split('/').pop();
                        const currentName = itemDetails?.name || currentHrid.split('/').pop();
                        candidates.push({
                            slot,
                            currentHrid,
                            currentLevel,
                            upgradeHrid,
                            upgradeLevel: currentLevel,
                            description: `${currentName} → ${upgradeName} (+${currentLevel})`,
                            type: 'tier',
                        });
                    }
                }
            } else {
                // Offensive items: keep existing role-based tier progression
                const slotKey = `${slot}|${role}`;
                const slotItems = tierProgression[slotKey];
                const offensiveCurrentName = itemDetails?.name || currentHrid.split('/').pop();
                const offensiveCandidateHrids = new Set();
                if (slotItems) {
                    const currentIdx = slotItems.findIndex((item) => item.hrid === currentHrid);
                    if (currentIdx >= 0 && currentIdx < slotItems.length - 1) {
                        const nextTier = slotItems[currentIdx + 1];
                        const nextName = nextTier.name || nextTier.hrid.split('/').pop();
                        candidates.push({
                            slot,
                            currentHrid,
                            currentLevel,
                            upgradeHrid: nextTier.hrid,
                            upgradeLevel: currentLevel,
                            description: `${offensiveCurrentName} → ${nextName} (+${currentLevel})`,
                            type: 'tier',
                        });
                        offensiveCandidateHrids.add(nextTier.hrid);

                        // Also suggest the highest non-refined item in the same slot|role
                        // when the player is already wearing high-tier gear (T60+). This
                        // surfaces direct T95 jumps (e.g. Sighted → Marksman) that the
                        // single-step progression would otherwise hide behind T75 stepping
                        // stones.
                        const currentItemLevel = itemDetails?.itemLevel || 0;
                        if (currentItemLevel >= 60) {
                            let highestNonRefined = null;
                            for (let i = slotItems.length - 1; i >= 0; i--) {
                                if (!slotItems[i].hrid.endsWith('_refined')) {
                                    highestNonRefined = slotItems[i];
                                    break;
                                }
                            }
                            if (
                                highestNonRefined &&
                                highestNonRefined.hrid !== currentHrid &&
                                highestNonRefined.hrid !== nextTier.hrid &&
                                highestNonRefined.itemLevel > currentItemLevel
                            ) {
                                const highestName = highestNonRefined.name || highestNonRefined.hrid.split('/').pop();
                                candidates.push({
                                    slot,
                                    currentHrid,
                                    currentLevel,
                                    upgradeHrid: highestNonRefined.hrid,
                                    upgradeLevel: currentLevel,
                                    description: `${offensiveCurrentName} → ${highestName} (+${currentLevel})`,
                                    type: 'tier',
                                });
                                offensiveCandidateHrids.add(highestNonRefined.hrid);
                            }
                        }
                    }
                }

                // Also walk the crafting-chain upgradeMap for offensive items so that
                // direct upgrade-action targets — most importantly the refined version
                // of the current weapon (e.g. Furious Spear → Furious Spear ★) — surface
                // even when the role-grouped progression would step sideways to a
                // different damage style first.
                const offensiveUpgrades = upgradeMap.get(currentHrid);
                if (offensiveUpgrades) {
                    for (const upgradeHrid of offensiveUpgrades) {
                        if (offensiveCandidateHrids.has(upgradeHrid)) continue;
                        if (upgradeHrid === currentHrid) continue;
                        const upgradeItem = gameData.itemDetailMap[upgradeHrid];
                        if (!upgradeItem?.equipmentDetail) continue;
                        if (upgradeItem.equipmentDetail.type !== slot) continue;
                        const upgradeRole = getItemRole(upgradeItem.equipmentDetail?.combatStats);
                        if (upgradeRole !== role) continue;

                        const upgradeName = upgradeItem.name || upgradeHrid.split('/').pop();
                        candidates.push({
                            slot,
                            currentHrid,
                            currentLevel,
                            upgradeHrid,
                            upgradeLevel: currentLevel,
                            description: `${offensiveCurrentName} → ${upgradeName} (+${currentLevel})`,
                            type: 'tier',
                        });
                        offensiveCandidateHrids.add(upgradeHrid);
                    }
                }
            }
        }

        // Cross-slot candidates: two_hand ↔ main_hand + off_hand
        const twoHandEquip = playerDTO.equipment['/equipment_types/two_hand'];
        const mainHandEquip = playerDTO.equipment['/equipment_types/main_hand'];
        const offHandEquip = playerDTO.equipment['/equipment_types/off_hand'];

        if (twoHandEquip) {
            // Case A: Player has two_hand → suggest main_hand + best off_hand
            const twoHandItem = gameData.itemDetailMap[twoHandEquip.hrid];
            const twoHandStats = twoHandItem?.equipmentDetail?.combatStats;
            const damageStyle = getItemDamageStyle(twoHandStats);

            if (damageStyle !== 'unknown') {
                const twoHandLevel = twoHandItem?.itemLevel || 0;
                const enhLevel = twoHandEquip.enhancementLevel || 0;

                // Find main_hand weapons with matching style at or above current level
                for (const [itemHrid, item] of Object.entries(gameData.itemDetailMap)) {
                    const eq = item.equipmentDetail;
                    if (!eq || eq.type !== '/equipment_types/main_hand') continue;
                    if (!hasCombatStats(item)) continue;
                    if ((item.itemLevel || 0) < twoHandLevel) continue;

                    const style = getItemDamageStyle(eq.combatStats);
                    if (style !== damageStyle) continue;

                    // Find candidate off-hands at this tier (may return 1 or 2 options:
                    // style-matched and/or highest-itemLevel).
                    const offHandCandidates = findBestOffHand(gameData, damageStyle, item.itemLevel || 999);
                    if (!offHandCandidates.length) continue;

                    const mainName = item.name || itemHrid.split('/').pop();
                    const currentName = twoHandItem?.name || twoHandEquip.hrid.split('/').pop();

                    for (const bestOH of offHandCandidates) {
                        const ohItem = gameData.itemDetailMap[bestOH.hrid];
                        const ohName = ohItem?.name || bestOH.hrid.split('/').pop();

                        candidates.push({
                            slot: '/equipment_types/two_hand',
                            currentHrid: twoHandEquip.hrid,
                            currentLevel: enhLevel,
                            upgradeHrid: itemHrid,
                            upgradeLevel: enhLevel,
                            addedSlots: {
                                '/equipment_types/main_hand': { hrid: itemHrid, enhancementLevel: enhLevel },
                                '/equipment_types/off_hand': { hrid: bestOH.hrid, enhancementLevel: enhLevel },
                            },
                            clearedSlots: ['/equipment_types/two_hand'],
                            description: `${currentName} → ${mainName} + ${ohName} (+${enhLevel})`,
                            type: 'cross_slot',
                        });
                    }
                }
            }
        } else if (mainHandEquip) {
            // Case B: Player has main_hand (+off_hand) → suggest best two_hand
            const mainHandItem = gameData.itemDetailMap[mainHandEquip.hrid];
            const mainHandStats = mainHandItem?.equipmentDetail?.combatStats;
            const damageStyle = getItemDamageStyle(mainHandStats);

            if (damageStyle !== 'unknown') {
                const mainHandLevel = mainHandItem?.itemLevel || 0;
                const enhLevel = mainHandEquip.enhancementLevel || 0;

                // Find two_hand weapons with matching style above current main_hand level
                for (const [itemHrid, item] of Object.entries(gameData.itemDetailMap)) {
                    const eq = item.equipmentDetail;
                    if (!eq || eq.type !== '/equipment_types/two_hand') continue;
                    if (!hasCombatStats(item)) continue;
                    if ((item.itemLevel || 0) <= mainHandLevel) continue;

                    const style = getItemDamageStyle(eq.combatStats);
                    if (style !== damageStyle) continue;
                    if (getItemRole(eq.combatStats) === 'defensive') continue;

                    const twoHandName = item.name || itemHrid.split('/').pop();
                    const currentName = mainHandItem?.name || mainHandEquip.hrid.split('/').pop();

                    const clearedSlots = ['/equipment_types/main_hand'];
                    if (offHandEquip) clearedSlots.push('/equipment_types/off_hand');

                    candidates.push({
                        slot: '/equipment_types/main_hand',
                        currentHrid: mainHandEquip.hrid,
                        currentLevel: enhLevel,
                        upgradeHrid: itemHrid,
                        upgradeLevel: enhLevel,
                        addedSlots: {
                            '/equipment_types/two_hand': { hrid: itemHrid, enhancementLevel: enhLevel },
                        },
                        clearedSlots,
                        description: `${currentName} → ${twoHandName} (+${enhLevel})`,
                        type: 'cross_slot',
                    });
                }
            }
        }
    } else if (mode === 'ability_level' || mode === 'ability_swap') {
        const playerStyle = getPlayerCombatStyle(playerDTO, gameData);
        const equippedAbilityHrids = new Set(playerDTO.abilities.filter((a) => a).map((a) => a.hrid));

        for (let slotIdx = 0; slotIdx < playerDTO.abilities.length; slotIdx++) {
            const ability = playerDTO.abilities[slotIdx];
            if (!ability) continue;

            const abilityDetail = gameData.abilityDetailMap[ability.hrid];
            if (!abilityDetail) continue;
            const abilityName = abilityDetail.name || ability.hrid.split('/').pop();

            if (mode === 'ability_level') {
                // Level upgrade candidate
                let targetLevel;
                if (abilityLevelType === 'target') {
                    targetLevel =
                        abilityTargetLevel > ability.level
                            ? abilityTargetLevel
                            : getNextAbilityBreakpoint(ability.level);
                } else {
                    const increment = abilityTargetLevel > 0 ? abilityTargetLevel : 5;
                    targetLevel = ability.level + increment;
                }
                targetLevel = Math.min(targetLevel, 200);
                if (targetLevel > ability.level) {
                    candidates.push({
                        slot: `ability_${slotIdx}`,
                        currentHrid: ability.hrid,
                        currentLevel: ability.level,
                        upgradeHrid: ability.hrid,
                        upgradeLevel: targetLevel,
                        description: `${abilityName} Lv${ability.level} → Lv${targetLevel}`,
                        type: 'ability_level',
                    });
                }
            } else {
                // Swap candidates: other compatible abilities not already equipped
                for (const [abHrid, abDetail] of Object.entries(gameData.abilityDetailMap)) {
                    if (equippedAbilityHrids.has(abHrid)) continue;
                    if (abDetail.isSpecialAbility && slotIdx !== 0) continue;
                    if (!abDetail.isSpecialAbility && slotIdx === 0) continue;
                    if (abHrid === '/abilities/promote') continue;

                    const abStyle = getAbilityCombatStyle(abDetail);
                    if (!isAbilityCompatible(abStyle, playerStyle)) continue;

                    const swapName = abDetail.name || abHrid.split('/').pop();
                    candidates.push({
                        slot: `ability_${slotIdx}`,
                        currentHrid: ability.hrid,
                        currentLevel: ability.level,
                        upgradeHrid: abHrid,
                        upgradeLevel: ability.level,
                        description: `${abilityName} → ${swapName} (Lv${ability.level})`,
                        type: 'ability_swap',
                    });
                }
            }
        }
    }

    return candidates;
}

/**
 * Calculate the total gold cost for a candidate upgrade.
 * Uses market prices as primary source (buy upgraded - sell current).
 * Falls back to enhancement cost estimate if market data unavailable.
 * @param {Object} candidate - Candidate from generateCandidates()
 * @param {Object} gameData - Game data
 * @returns {number} Total gold cost
 */
export function calculateUpgradeCost(candidate, gameData) {
    if (candidate.type === 'ability_level') {
        const levelXpTable = gameData.levelExperienceTable || [];
        const currentXp = levelXpTable[candidate.currentLevel] || 0;
        return calculateAbilityLevelUpCost(
            candidate.currentHrid,
            candidate.currentLevel,
            currentXp,
            candidate.upgradeLevel
        );
    }

    if (candidate.type === 'ability_swap') {
        return calculateAbilityLevelUpCost(candidate.upgradeHrid, 0, 0, candidate.upgradeLevel);
    }

    if (candidate.type === 'cross_slot') {
        let buyCost = 0;
        for (const [, item] of Object.entries(candidate.addedSlots)) {
            const price = resolveItemPrice(item.hrid, {
                side: 'buy',
                enhancementLevel: item.enhancementLevel,
            });
            buyCost += price.price;
        }
        const sellPrice = resolveItemPrice(candidate.currentHrid, {
            side: 'sell',
            enhancementLevel: candidate.currentLevel,
        }).price;
        return Math.max(0, buyCost - sellPrice);
    }

    if (candidate.type === 'enhancement') {
        // Primary: market price delta (buy at target level - sell at current level)
        // Only use if BOTH levels have actual market listings
        const upgradedMarket = getItemPrices(candidate.currentHrid, candidate.upgradeLevel);
        const currentMarket = getItemPrices(candidate.currentHrid, candidate.currentLevel);

        if (upgradedMarket?.ask > 0 && currentMarket?.bid > 0) {
            return Math.max(0, upgradedMarket.ask - currentMarket.bid);
        }

        // Fallback: enhancement cost estimate with protection
        return calculateEnhancementCost(
            candidate.currentHrid,
            candidate.currentLevel,
            candidate.upgradeLevel,
            gameData,
            { slot: candidate.slot }
        );
    }

    // Tier upgrade: buy new item at same enhancement - sell current item
    const buyPrice = resolveItemPrice(candidate.upgradeHrid, {
        side: 'buy',
        enhancementLevel: candidate.upgradeLevel,
    }).price;
    const sellPrice = resolveItemPrice(candidate.currentHrid, {
        side: 'sell',
        enhancementLevel: candidate.currentLevel,
    }).price;

    return Math.max(0, buyPrice - sellPrice);
}

/**
 * Run the full upgrade analysis: baseline sim + one sim per candidate.
 * @param {Object} params - { playerDTOs, playerIndex, zoneHrid, difficultyTier, hours, communityBuffs, upgradeMode }
 * @param {Function} onProgress - Called with { current, total, description }
 * @param {Object} [options] - { abortSignal: () => boolean }
 * @returns {Promise<Object>} { baseline, results: [{candidate, cost, metrics, deltas, goldPer}] }
 */
export async function runUpgradeAnalysis(params, onProgress, options = {}) {
    const {
        playerDTOs,
        playerIndex,
        zoneHrid,
        difficultyTier,
        hours,
        communityBuffs,
        upgradeMode,
        abilityLevelType,
        abilityTargetLevel,
        skipBackSlot,
    } = params;
    const { abortSignal } = options;
    const gameData = buildGameDataPayload();
    if (!gameData) throw new Error('No game data available');

    const playerDTO = playerDTOs[playerIndex];
    const playerHrid = playerDTO.hrid;

    // Generate candidates and compute costs
    const candidates = generateCandidates(
        playerDTO,
        gameData,
        upgradeMode,
        abilityTargetLevel,
        abilityLevelType,
        skipBackSlot
    );
    const candidatesWithCost = candidates.map((c) => ({
        ...c,
        cost: calculateUpgradeCost(c, gameData),
    }));

    const total = candidatesWithCost.length + 1; // +1 for baseline
    let current = 0;

    // Run baseline sim
    onProgress?.({ current: 0, total, description: 'Running baseline...' });
    const baselineResult = await runSimulation(
        { gameData, playerDTOs, zoneHrid, difficultyTier, hours, communityBuffs },
        null
    );
    current++;

    if (abortSignal?.()) return { baseline: null, results: [] };

    onProgress?.({ current, total, description: 'Baseline complete' });

    // Calculate baseline metrics
    const baselineMetrics = computeMetrics(baselineResult, gameData, playerHrid, hours);

    // Run sim for each candidate
    const results = [];
    for (const candidate of candidatesWithCost) {
        if (abortSignal?.()) break;

        onProgress?.({ current, total, description: `Simulating: ${candidate.description}` });

        // Clone playerDTOs and apply candidate upgrade
        const modifiedDTOs = JSON.parse(JSON.stringify(playerDTOs));

        if (candidate.slot.startsWith('ability_')) {
            // Ability upgrade/swap
            const slotIdx = parseInt(candidate.slot.split('_')[1]);
            modifiedDTOs[playerIndex].abilities[slotIdx] = {
                hrid: candidate.upgradeHrid,
                level: candidate.upgradeLevel,
                triggers: null,
            };
        } else {
            // Equipment upgrade
            modifiedDTOs[playerIndex].equipment[candidate.slot] = {
                hrid: candidate.upgradeHrid,
                enhancementLevel: candidate.upgradeLevel,
            };
        }

        const simResult = await runSimulation(
            { gameData, playerDTOs: modifiedDTOs, zoneHrid, difficultyTier, hours, communityBuffs },
            null
        );

        if (abortSignal?.()) break;

        const metrics = computeMetrics(simResult, gameData, playerHrid, hours);
        const deltas = computeDeltas(baselineMetrics, metrics);
        const goldPer = computeGoldPerImprovement(candidate.cost, deltas);

        results.push({ candidate, cost: candidate.cost, metrics, deltas, goldPer });
        current++;
        onProgress?.({ current, total, description: candidate.description });
    }

    // Sort by best value (lowest gold per 0.01% DPS improvement)
    results.sort((a, b) => {
        const aVal = a.goldPer.dps === Infinity ? Number.MAX_VALUE : a.goldPer.dps;
        const bVal = b.goldPer.dps === Infinity ? Number.MAX_VALUE : b.goldPer.dps;
        return aVal - bVal;
    });

    return { baseline: baselineMetrics, results };
}

/**
 * Compute key metrics from a sim result.
 */
function computeMetrics(simResult, gameData, playerHrid, hours) {
    const simHours = (simResult.simulatedTime || 0) / (3600 * 1e9) || hours;
    const xp = simResult.experienceGained?.[playerHrid] || {};
    const totalXpPerHour = Object.values(xp).reduce((s, v) => s + v, 0) / simHours;
    const deaths = (simResult.deaths?.[playerHrid] || 0) / simHours;
    const encounters = (simResult.encounters || 0) / simHours;

    // Profit/hr
    const revenue = calculateSimRevenue(simResult, gameData, playerHrid, simHours);

    return {
        xpPerHour: totalXpPerHour,
        profitPerHour: revenue.netPerHour,
        deathsPerHour: deaths,
        encountersPerHour: encounters,
        dps: (simResult.totalDamageDealt?.[playerHrid] || 0) / (simHours * 3600),
    };
}

/**
 * Compute percentage deltas between baseline and upgraded metrics.
 */
function computeDeltas(baseline, upgraded) {
    const pctDelta = (base, upg) => {
        if (base === 0) return upg > 0 ? 100 : 0;
        return ((upg - base) / Math.abs(base)) * 100;
    };

    return {
        dps: pctDelta(baseline.dps, upgraded.dps),
        xp: pctDelta(baseline.xpPerHour, upgraded.xpPerHour),
        profit: pctDelta(baseline.profitPerHour, upgraded.profitPerHour),
        deaths: pctDelta(baseline.deathsPerHour, upgraded.deathsPerHour),
        encounters: pctDelta(baseline.encountersPerHour, upgraded.encountersPerHour),
    };
}

/**
 * Compute gold per 0.1% improvement for each metric.
 * Lower = better value.
 */
function computeGoldPerImprovement(cost, deltas) {
    const goldPer = (pctDelta) => {
        if (pctDelta <= 0) return Infinity;
        // Gold per 0.1% = cost / (pctDelta * 10)
        // pctDelta is already in percent (e.g., 2 = 2%)
        return cost / (pctDelta * 10);
    };

    // For deaths, fewer is better — use negative delta (reduction)
    const goldPerReduction = (pctDelta) => {
        if (pctDelta >= 0) return Infinity; // Deaths didn't decrease
        return cost / (Math.abs(pctDelta) * 10);
    };

    return {
        dps: goldPer(deltas.dps),
        xp: goldPer(deltas.xp),
        profit: goldPer(deltas.profit),
        encounters: goldPer(deltas.encounters),
        deaths: goldPerReduction(deltas.deaths),
    };
}

// ─── Labyrinth Buff Upgrade Candidates ──────────────────────────────────────

const LABYRINTH_BUFF_DEFS = [
    {
        key: 'labyrinthCombatDamageLevel',
        name: 'Combat Damage',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'combat',
        uniqueKey: 'combat_damage',
        typeHrid: '/buff_types/damage',
        valueKey: 'ratioBoost',
    },
    {
        key: 'labyrinthAttackSpeedLevel',
        name: 'Attack Speed',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'combat',
        uniqueKey: 'attack_speed',
        typeHrid: '/buff_types/attack_speed',
        valueKey: 'ratioBoost',
    },
    {
        key: 'labyrinthCastSpeedLevel',
        name: 'Cast Speed',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'combat',
        uniqueKey: 'cast_speed',
        typeHrid: '/buff_types/cast_speed',
        valueKey: 'flatBoost',
    },
    {
        key: 'labyrinthCriticalRateLevel',
        name: 'Critical Rate',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'combat',
        uniqueKey: 'critical_rate',
        typeHrid: '/buff_types/critical_rate',
        valueKey: 'flatBoost',
    },
    {
        key: 'labyrinthSkillActionSpeedLevel',
        name: 'Skilling Speed',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'skilling',
        metric: 'actionSpeedBonus',
    },
    {
        key: 'labyrinthSkillingEfficiencyLevel',
        name: 'Skilling Efficiency',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'skilling',
        metric: 'efficiencyBonus',
    },
    {
        key: 'labyrinthSkillingSuccessLevel',
        name: 'Success Rate',
        step: 0.005,
        maxLevel: 12,
        tokenCost: 40,
        category: 'skilling',
        metric: 'successBonus',
    },
    {
        key: 'labyrinthSkillingDoubleProgressLevel',
        name: 'Double Progress',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 40,
        category: 'skilling',
        metric: 'doubleProgressBonus',
    },
    {
        key: 'labyrinthExperienceLevel',
        name: 'Experience',
        step: 0.01,
        maxLevel: 12,
        tokenCost: 80,
        category: 'experience',
    },
];

const LABYRINTH_SKILLS = [
    '/skills/woodcutting',
    '/skills/foraging',
    '/skills/milking',
    '/skills/cooking',
    '/skills/brewing',
    '/skills/cheesesmithing',
    '/skills/crafting',
    '/skills/tailoring',
    '/skills/alchemy',
    '/skills/enhancing',
];

/**
 * Generate labyrinth buff upgrade candidates from characterInfo.
 * @returns {Array} Buff candidates with type 'labyrinth_buff'
 */
export function generateLabyrinthBuffCandidates() {
    const info = dataManager.characterData?.characterInfo;
    if (!info) return [];

    const candidates = [];
    for (const def of LABYRINTH_BUFF_DEFS) {
        const currentLevel = Math.max(0, Math.floor(Number(info[def.key]) || 0));
        if (currentLevel >= def.maxLevel) continue;

        candidates.push({
            type: 'labyrinth_buff',
            category: def.category,
            buffKey: def.key,
            currentLevel,
            step: def.step,
            tokenCost: def.tokenCost * (currentLevel + 1),
            description: `${def.name} Lv${currentLevel}\u2192${currentLevel + 1}`,
            uniqueKey: def.uniqueKey,
            typeHrid: def.typeHrid,
            valueKey: def.valueKey,
            metric: def.metric,
        });
    }
    return candidates;
}

/**
 * Clone labyrinth combat buffs with +1 to a specific buff.
 * @param {Array} baseBuffs - Current labyrinth combat buffs
 * @param {Object} candidate - Buff candidate with uniqueKey/typeHrid/valueKey/step
 * @returns {Array} Modified buffs array
 */
function buildModifiedCombatBuffs(baseBuffs, candidate) {
    const uniqueHrid = `/buff_uniques/labyrinth_upgrade_${candidate.uniqueKey}`;
    const modified = JSON.parse(JSON.stringify(baseBuffs));

    const existing = modified.find((b) => b.uniqueHrid === uniqueHrid);
    if (existing) {
        existing[candidate.valueKey] += candidate.step;
    } else {
        const buff = {
            uniqueHrid,
            typeHrid: candidate.typeHrid,
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            startTime: '0001-01-01T00:00:00Z',
            duration: 0,
        };
        buff[candidate.valueKey] = candidate.step;
        modified.push(buff);
    }
    return modified;
}

/**
 * Run labyrinth upgrade analysis: baseline sim + equipment sims + buff sims.
 * Ranks upgrades by win rate / clear rate delta, grouped by cost type (token vs gold).
 * @param {Object} params
 * @param {Array} params.playerDTOs - Player DTOs (only first used — labyrinth is solo)
 * @param {number} params.playerIndex - Index of the player to analyze
 * @param {string} params.monsterHrid - Labyrinth monster HRID
 * @param {number} params.roomLevel - Room level to test at
 * @param {string[]} params.crates - Crate item HRIDs
 * @param {number} params.hours - Hours to simulate per candidate
 * @param {Object} params.communityBuffs - Community buffs
 * @param {Array} [params.labyrinthCombatBuffs] - Combat buffs from labyrinth upgrades
 * @param {string} params.upgradeMode - 'equipment', 'ability_level', or 'ability_swap'
 * @param {number} [params.abilityTargetLevel] - Target ability level
 * @param {Function} onProgress - Called with { current, total, description }
 * @param {Object} [options] - { abortSignal: () => boolean }
 * @returns {Promise<Object>} { baseline, results: [{candidate, costType, ...}] }
 */
export async function runLabyrinthUpgradeAnalysis(params, onProgress, options = {}) {
    const {
        playerDTOs,
        playerIndex,
        monsterHrid,
        roomLevel,
        crates,
        hours,
        communityBuffs,
        labyrinthCombatBuffs = [],
        upgradeMode,
        abilityLevelType,
        abilityTargetLevel,
        skipBackSlot,
    } = params;
    const { abortSignal } = options;
    const gameData = buildGameDataPayload();
    if (!gameData) throw new Error('No game data available');

    const playerDTO = playerDTOs[playerIndex];

    const zoneHrid =
        Object.keys(gameData.actionDetailMap).find((k) => k.includes('/actions/combat/')) || '/actions/combat/fly';

    // Generate equipment candidates
    const candidates = generateCandidates(
        playerDTO,
        gameData,
        upgradeMode,
        abilityTargetLevel,
        abilityLevelType,
        skipBackSlot
    );
    const candidatesWithCost = candidates.map((c) => ({
        ...c,
        cost: calculateUpgradeCost(c, gameData),
    }));

    // Generate buff candidates (skilling buffs handled in skilling tab)
    const buffCandidates = generateLabyrinthBuffCandidates();
    const combatBuffCandidates = buffCandidates.filter((c) => c.category === 'combat');
    const experienceBuffCandidates = buffCandidates.filter((c) => c.category === 'experience');

    const total = candidatesWithCost.length + combatBuffCandidates.length + experienceBuffCandidates.length + 1;
    let current = 0;

    // Run baseline labyrinth sim
    onProgress?.({ current: 0, total, description: 'Running baseline...' });
    const baselineResult = await runLabyrinthSimulation({
        gameData,
        playerDTOs: [playerDTOs[playerIndex]],
        zoneHrid,
        monsterHrid,
        roomLevel,
        crates,
        hours,
        communityBuffs,
        labyrinthCombatBuffs,
    });
    current++;

    if (abortSignal?.()) return { baseline: null, results: [] };

    const baselineAttempts = baselineResult.labyAttemptCount || 1;
    const baselineEncounters = baselineResult.encounters || 0;
    const baselineWinRate = baselineEncounters / baselineAttempts;

    onProgress?.({ current, total, description: `Baseline: ${(baselineWinRate * 100).toFixed(1)}%` });

    const results = [];

    // ── Equipment / ability sims ──
    for (const candidate of candidatesWithCost) {
        if (abortSignal?.()) break;

        onProgress?.({ current, total, description: `Simulating: ${candidate.description}` });

        const modifiedDTO = JSON.parse(JSON.stringify(playerDTOs[playerIndex]));

        if (candidate.slot.startsWith('ability_')) {
            const slotIdx = parseInt(candidate.slot.split('_')[1]);
            modifiedDTO.abilities[slotIdx] = {
                hrid: candidate.upgradeHrid,
                level: candidate.upgradeLevel,
                triggers: null,
            };
        } else if (candidate.type === 'cross_slot') {
            for (const slot of candidate.clearedSlots) {
                modifiedDTO.equipment[slot] = null;
            }
            for (const [slot, item] of Object.entries(candidate.addedSlots)) {
                modifiedDTO.equipment[slot] = item;
            }
        } else {
            modifiedDTO.equipment[candidate.slot] = {
                hrid: candidate.upgradeHrid,
                enhancementLevel: candidate.upgradeLevel,
            };
        }

        const simResult = await runLabyrinthSimulation({
            gameData,
            playerDTOs: [modifiedDTO],
            zoneHrid,
            monsterHrid,
            roomLevel,
            crates,
            hours,
            communityBuffs,
            labyrinthCombatBuffs,
        });

        if (abortSignal?.()) break;

        const attempts = simResult.labyAttemptCount || 1;
        const encounters = simResult.encounters || 0;
        const winRate = encounters / attempts;
        const winRateDelta = winRate - baselineWinRate;

        results.push({
            candidate,
            costType: 'gold',
            cost: candidate.cost,
            winRate,
            winRateDelta,
            goldPerWinRate: winRateDelta > 0 ? candidate.cost / (winRateDelta * 100) : Infinity,
            metricType: 'winRate',
        });
        current++;
        onProgress?.({ current, total, description: candidate.description });
    }

    // ── Combat buff sims ──
    for (const buffCandidate of combatBuffCandidates) {
        if (abortSignal?.()) break;

        onProgress?.({ current, total, description: `Simulating: ${buffCandidate.description}` });

        const modifiedBuffs = buildModifiedCombatBuffs(labyrinthCombatBuffs, buffCandidate);
        const simResult = await runLabyrinthSimulation({
            gameData,
            playerDTOs: [playerDTOs[playerIndex]],
            zoneHrid,
            monsterHrid,
            roomLevel,
            crates,
            hours,
            communityBuffs,
            labyrinthCombatBuffs: modifiedBuffs,
        });

        if (abortSignal?.()) break;

        const attempts = simResult.labyAttemptCount || 1;
        const encounters = simResult.encounters || 0;
        const winRate = encounters / attempts;
        const winRateDelta = winRate - baselineWinRate;

        results.push({
            candidate: buffCandidate,
            costType: 'token',
            tokenCost: buffCandidate.tokenCost,
            winRate,
            winRateDelta,
            metricType: 'winRate',
        });
        current++;
        onProgress?.({ current, total, description: buffCandidate.description });
    }

    // ── Experience buff (flat % increase, no sim needed) ──
    for (const buffCandidate of experienceBuffCandidates) {
        const currentBonus = buffCandidate.currentLevel * buffCandidate.step;
        const newBonus = (buffCandidate.currentLevel + 1) * buffCandidate.step;
        const xpDeltaPct = ((1 + newBonus) / (1 + currentBonus) - 1) * 100;

        results.push({
            candidate: buffCandidate,
            costType: 'token',
            tokenCost: buffCandidate.tokenCost,
            xpDeltaPct,
            metricType: 'experience',
        });
        current++;
        onProgress?.({ current, total, description: buffCandidate.description });
    }

    // Sort: token results first, then gold; within each group by best delta descending
    results.sort((a, b) => {
        if (a.costType !== b.costType) return a.costType === 'token' ? -1 : 1;
        const aDelta = a.winRateDelta ?? a.clearRateDelta ?? a.xpDeltaPct ?? 0;
        const bDelta = b.winRateDelta ?? b.clearRateDelta ?? b.xpDeltaPct ?? 0;
        return bDelta - aDelta;
    });

    return {
        baseline: {
            winRate: baselineWinRate,
            encounters: baselineEncounters,
            attempts: baselineAttempts,
        },
        results,
    };
}

// ─── Editor-Based Skilling Analysis ──────────────────────────────────────────

const SKILLING_DTO_KEYS = {
    '/skills/woodcutting': 'woodcuttingLevel',
    '/skills/foraging': 'foragingLevel',
    '/skills/milking': 'milkingLevel',
    '/skills/cooking': 'cookingLevel',
    '/skills/brewing': 'brewingLevel',
    '/skills/cheesesmithing': 'cheesesmithingLevel',
    '/skills/crafting': 'craftingLevel',
    '/skills/tailoring': 'tailoringLevel',
    '/skills/alchemy': 'alchemyLevel',
    '/skills/enhancing': 'enhancingLevel',
};

/**
 * Compute per-skill clear results from editor state.
 * @param {number} roomLevel
 * @param {Object} editorDTO - Player DTO from editor
 * @param {string[]} crateHrids - Selected crate HRIDs
 * @param {Object} gameData - From buildGameDataPayload()
 * @param {Object} [skillEquipmentMap] - Per-skill equipment overrides { '/skills/X': { slot: { hrid, enhancementLevel } } }
 * @returns {Array<Object>} Per-skill results with skill name, clear chance, etc.
 */
export function computeSkillingClearRatesFromEditor(
    roomLevel,
    editorDTO,
    crateHrids,
    gameData,
    skillEquipmentMap = {}
) {
    const results = [];

    for (const skillHrid of LABYRINTH_SKILLS) {
        const skillId = skillHrid.replace('/skills/', '');
        const actionTypeHrid = `/action_types/${skillId}`;
        const dtoKey = SKILLING_DTO_KEYS[skillHrid];
        const baseLevel = editorDTO[dtoKey] || 1;

        const editorState = {
            equipment: skillEquipmentMap[skillHrid] || editorDTO.equipment,
            houseRooms: editorDTO.houseRooms,
            tokenUpgrades: editorDTO.tokenUpgrades,
            communityBuffLevels: editorDTO.communityBuffLevels,
        };

        const overrides = buildOverridesForSkill(editorState, actionTypeHrid, crateHrids, gameData);
        const metrics = labyrinthClearRate.getSkillingMetricsFromOverrides(skillId, actionTypeHrid, overrides);

        let result;
        if (skillHrid === '/skills/enhancing') {
            result = labyrinthClearRate.computeEnhancingClearWithParams(metrics, baseLevel, roomLevel);
        } else {
            result = labyrinthClearRate.computeSkillingClearWithParams(metrics, baseLevel, roomLevel);
        }
        result.skillHrid = skillHrid;
        result.skillId = skillId;
        result.skillName = skillId.charAt(0).toUpperCase() + skillId.slice(1);
        results.push(result);
    }

    return results;
}

/**
 * Compute average skilling clear rate from editor state.
 * @param {number} roomLevel
 * @param {Object} editorDTO - Player DTO from editor
 * @param {string[]} crateHrids - Selected crate HRIDs
 * @param {Object} gameData - From buildGameDataPayload()
 * @param {Object} [options]
 * @param {Object} [options.metricOverride] - { key, delta } to add to one metric across all skills
 * @param {Object} [options.skillEquipmentMap] - Per-skill equipment overrides
 * @returns {number} Average clear rate (0-1)
 */
function computeAverageSkillingClearRateFromEditor(roomLevel, editorDTO, crateHrids, gameData, options = {}) {
    const { metricOverride = null, skillEquipmentMap = {}, targetSkill = null } = options;

    let total = 0;
    let count = 0;

    const skillsToEval = targetSkill ? [targetSkill] : LABYRINTH_SKILLS;

    for (const skillHrid of skillsToEval) {
        const skillId = skillHrid.replace('/skills/', '');
        const actionTypeHrid = `/action_types/${skillId}`;
        const dtoKey = SKILLING_DTO_KEYS[skillHrid];
        const baseLevel = editorDTO[dtoKey] || 1;

        const editorState = {
            equipment: skillEquipmentMap[skillHrid] || editorDTO.equipment,
            houseRooms: editorDTO.houseRooms,
            tokenUpgrades: editorDTO.tokenUpgrades,
            communityBuffLevels: editorDTO.communityBuffLevels,
        };

        const overrides = buildOverridesForSkill(editorState, actionTypeHrid, crateHrids, gameData);
        const metrics = labyrinthClearRate.getSkillingMetricsFromOverrides(skillId, actionTypeHrid, overrides);

        if (metricOverride) {
            metrics[metricOverride.key] = (metrics[metricOverride.key] || 0) + metricOverride.delta;
        }

        let clearChance;
        if (skillHrid === '/skills/enhancing') {
            clearChance = labyrinthClearRate.computeEnhancingClearWithParams(metrics, baseLevel, roomLevel).clearChance;
        } else {
            clearChance = labyrinthClearRate.computeSkillingClearWithParams(metrics, baseLevel, roomLevel).clearChance;
        }

        total += clearChance;
        count++;
    }

    return count > 0 ? total / count : 0;
}

/**
 * Generate labyrinth buff candidates from editor token upgrade levels.
 * @param {Object} tokenUpgrades - { speed, efficiency, success, doubleProgress }
 * @returns {Array} Buff candidates with type 'labyrinth_buff'
 */
function generateLabyrinthBuffCandidatesFromEditor(tokenUpgrades) {
    const skillingDefs = LABYRINTH_BUFF_DEFS.filter((d) => d.category === 'skilling');
    const editorKeyMap = {
        labyrinthSkillActionSpeedLevel: 'speed',
        labyrinthSkillingEfficiencyLevel: 'efficiency',
        labyrinthSkillingSuccessLevel: 'success',
        labyrinthSkillingDoubleProgressLevel: 'doubleProgress',
    };

    const candidates = [];
    for (const def of skillingDefs) {
        const editorKey = editorKeyMap[def.key];
        const currentLevel = Math.max(0, Math.floor(Number(tokenUpgrades?.[editorKey]) || 0));
        if (currentLevel >= def.maxLevel) continue;

        candidates.push({
            type: 'labyrinth_buff',
            category: def.category,
            buffKey: def.key,
            editorKey,
            currentLevel,
            step: def.step,
            tokenCost: def.tokenCost * (currentLevel + 1),
            description: `${def.name} Lv${currentLevel}\u2192${currentLevel + 1}`,
            metric: def.metric,
        });
    }
    return candidates;
}

/**
 * Generate skilling equipment enhancement candidates from editor equipment.
 * Considers per-skill equipment overrides to find all unique items that need upgrading.
 * @param {Object} editorDTO - Player DTO from editor
 * @param {Object} gameData - From buildGameDataPayload()
 * @param {Object} [skillEquipmentMap] - Per-skill equipment overrides
 * @returns {Array} Enhancement candidates with gold cost
 */
export function generateSkillingEquipmentCandidates(editorDTO, gameData, skillEquipmentMap = {}) {
    const itemDetailMap = gameData.itemDetailMap || {};
    const candidates = [];
    const seen = new Set();

    const equipmentSets = [editorDTO.equipment || {}];
    for (const skillEquip of Object.values(skillEquipmentMap)) {
        if (skillEquip) equipmentSets.push(skillEquip);
    }

    for (const equipment of equipmentSets) {
        for (const [slot, equip] of Object.entries(equipment)) {
            if (!equip?.hrid) continue;
            if (slot === '/equipment_types/trinket' || slot === '/equipment_types/charm') continue;
            const dedupKey = `${slot}:${equip.hrid}:${equip.enhancementLevel || 0}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            const itemDetails = itemDetailMap[equip.hrid];
            if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

            const hasNoncombat = Object.values(itemDetails.equipmentDetail.noncombatStats).some((v) => v > 0);
            if (!hasNoncombat) continue;

            const currentLevel = equip.enhancementLevel || 0;
            const nextBP = getNextBreakpoint(currentLevel, slot, equip.hrid);
            if (!nextBP) continue;

            const itemName = itemDetails.name || equip.hrid.split('/').pop();
            const candidate = {
                slot,
                currentHrid: equip.hrid,
                currentLevel,
                upgradeHrid: equip.hrid,
                upgradeLevel: nextBP,
                description: `${itemName} +${currentLevel} \u2192 +${nextBP}`,
                type: 'enhancement',
            };
            candidate.cost = calculateUpgradeCost(candidate, gameData);
            candidates.push(candidate);
        }
    }

    return candidates;
}

/**
 * Run skilling upgrade analysis from editor state.
 * @param {Object} params
 * @param {Object} params.editorDTO - Player DTO from editor
 * @param {number} params.roomLevel - Room level
 * @param {string[]} params.crateHrids - Selected crate HRIDs
 * @param {Object} [params.skillEquipmentMap] - Per-skill equipment overrides
 * @param {Function} onProgress - Called with { current, total, description }
 * @param {Object} [options] - { abortSignal: () => boolean }
 * @returns {Object} { baseline, results }
 */
export function runSkillingUpgradeAnalysis(params, onProgress, options = {}) {
    const { editorDTO, roomLevel, crateHrids, skillEquipmentMap = {}, targetSkill = null } = params;
    const { abortSignal } = options;
    const gameData = buildGameDataPayload();
    if (!gameData) throw new Error('No game data available');

    const tokenUpgrades = editorDTO.tokenUpgrades || {};
    const buffCandidates = generateLabyrinthBuffCandidatesFromEditor(tokenUpgrades);
    const equipCandidates = generateSkillingEquipmentCandidates(editorDTO, gameData, skillEquipmentMap);
    const clearRateOpts = { skillEquipmentMap, targetSkill };

    const total = buffCandidates.length + equipCandidates.length + 1;
    let current = 0;

    onProgress?.({ current: 0, total, description: 'Computing baseline...' });
    const baselineClearRate = computeAverageSkillingClearRateFromEditor(
        roomLevel,
        editorDTO,
        crateHrids,
        gameData,
        clearRateOpts
    );
    current++;

    if (abortSignal?.()) return { baseline: null, results: [] };

    onProgress?.({ current, total, description: `Baseline: ${(baselineClearRate * 100).toFixed(1)}%` });

    const results = [];

    for (const buffCandidate of buffCandidates) {
        if (abortSignal?.()) break;

        onProgress?.({ current, total, description: `Evaluating: ${buffCandidate.description}` });

        const modifiedDTO = JSON.parse(JSON.stringify(editorDTO));
        modifiedDTO.tokenUpgrades[buffCandidate.editorKey] = buffCandidate.currentLevel + 1;

        const modifiedClearRate = computeAverageSkillingClearRateFromEditor(
            roomLevel,
            modifiedDTO,
            crateHrids,
            gameData,
            clearRateOpts
        );
        const clearRateDelta = modifiedClearRate - baselineClearRate;

        results.push({
            candidate: buffCandidate,
            costType: 'token',
            tokenCost: buffCandidate.tokenCost,
            clearRate: modifiedClearRate,
            clearRateDelta,
            metricType: 'clearRate',
        });
        current++;
        onProgress?.({ current, total, description: buffCandidate.description });
    }

    for (const candidate of equipCandidates) {
        if (abortSignal?.()) break;

        onProgress?.({ current, total, description: `Evaluating: ${candidate.description}` });

        const modifiedDTO = JSON.parse(JSON.stringify(editorDTO));
        const modifiedSkillEquipMap = JSON.parse(JSON.stringify(skillEquipmentMap));
        const upgradePayload = { hrid: candidate.upgradeHrid, enhancementLevel: candidate.upgradeLevel };

        if (modifiedDTO.equipment?.[candidate.slot]?.hrid === candidate.currentHrid) {
            modifiedDTO.equipment[candidate.slot] = upgradePayload;
        }
        for (const skillEquip of Object.values(modifiedSkillEquipMap)) {
            if (skillEquip?.[candidate.slot]?.hrid === candidate.currentHrid) {
                skillEquip[candidate.slot] = upgradePayload;
            }
        }

        const modifiedClearRate = computeAverageSkillingClearRateFromEditor(
            roomLevel,
            modifiedDTO,
            crateHrids,
            gameData,
            { skillEquipmentMap: modifiedSkillEquipMap, targetSkill }
        );
        const clearRateDelta = modifiedClearRate - baselineClearRate;

        results.push({
            candidate,
            costType: 'gold',
            cost: candidate.cost,
            clearRate: modifiedClearRate,
            clearRateDelta,
            goldPerClearRate: clearRateDelta > 0 ? candidate.cost / (clearRateDelta * 100) : Infinity,
            metricType: 'clearRate',
        });
        current++;
        onProgress?.({ current, total, description: candidate.description });
    }

    results.sort((a, b) => {
        if (a.costType !== b.costType) return a.costType === 'token' ? -1 : 1;
        return (b.clearRateDelta ?? 0) - (a.clearRateDelta ?? 0);
    });

    return {
        baseline: { clearRate: baselineClearRate },
        results,
    };
}

export default {
    generateCandidates,
    calculateUpgradeCost,
    runUpgradeAnalysis,
    runLabyrinthUpgradeAnalysis,
    generateLabyrinthBuffCandidates,
    getEquipmentTierProgression,
    computeSkillingClearRatesFromEditor,
    generateSkillingEquipmentCandidates,
    runSkillingUpgradeAnalysis,
};
