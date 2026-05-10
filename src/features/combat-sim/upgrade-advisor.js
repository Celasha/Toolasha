/**
 * Upgrade Advisor for Combat Sim
 *
 * Generates equipment upgrade candidates, calculates their costs,
 * and runs simulations to rank them by "Gold per 0.01% improvement".
 */

import { buildGameDataPayload, calculateSimRevenue } from './combat-sim-adapter.js';
import { runSimulation } from './combat-sim-runner.js';
import { resolveItemPrice } from '../../utils/profit-helpers.js';
import { getItemPrices, getItemPrice } from '../../utils/market-data.js';
import { calculateEnhancement } from '../../utils/enhancement-calculator.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { getCheapestProtectionPrice, getProductionCost } from '../enhancement/tooltip-enhancement.js';

/** Enhancement breakpoints: the next target level from any given current level */
const BREAKPOINTS = [7, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];

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
 * @param {number} currentLevel - Current enhancement level
 * @returns {number|null} Next breakpoint level, or null if already at max
 */
function getNextBreakpoint(currentLevel) {
    for (const bp of BREAKPOINTS) {
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
 * @returns {number} Expected gold cost
 */
function calculateEnhancementCost(itemHrid, startLevel, targetLevel, gameData) {
    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails?.enhancementCosts || itemDetails.enhancementCosts.length === 0) {
        return 0;
    }

    const enhancingParams = getEnhancingParams();
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

    // Check for primary offensive stats
    const melee = (combatStats.stabDamage || 0) + (combatStats.slashDamage || 0) + (combatStats.smashDamage || 0);
    const ranged = combatStats.rangedDamage || 0;
    const magic = combatStats.magicDamage || 0;

    // If item has offensive damage stats, classify by highest
    if (melee > 0 || ranged > 0 || magic > 0) {
        if (ranged >= melee && ranged >= magic) return 'ranged';
        if (magic >= melee && magic >= ranged) return 'magic';
        return 'melee';
    }

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
 * Generate upgrade candidates for a player's equipment and/or abilities.
 * @param {Object} playerDTO - Player DTO with equipment
 * @param {Object} gameData - Game data from buildGameDataPayload()
 * @param {string} [mode='equipment'] - 'equipment' or 'abilities'
 * @param {number} [abilityTargetLevel=0] - Target level for ability upgrades (0 = use default breakpoints)
 * @returns {Array} Candidates: [{slot, currentHrid, currentLevel, upgradeHrid, upgradeLevel, description, type}]
 */
export function generateCandidates(playerDTO, gameData, mode = 'equipment', abilityTargetLevel = 0) {
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
            if (!hasCombatStats(itemDetails)) continue;

            // Enhancement upgrade: next breakpoint
            const nextBP = getNextBreakpoint(currentLevel);
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
                if (slotItems) {
                    const currentIdx = slotItems.findIndex((item) => item.hrid === currentHrid);
                    if (currentIdx >= 0 && currentIdx < slotItems.length - 1) {
                        const nextTier = slotItems[currentIdx + 1];
                        const nextName = nextTier.name || nextTier.hrid.split('/').pop();
                        const currentName = gameData.itemDetailMap[currentHrid]?.name || currentHrid.split('/').pop();
                        candidates.push({
                            slot,
                            currentHrid,
                            currentLevel,
                            upgradeHrid: nextTier.hrid,
                            upgradeLevel: currentLevel,
                            description: `${currentName} → ${nextName} (+${currentLevel})`,
                            type: 'tier',
                        });
                    }
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
                const targetLevel =
                    abilityTargetLevel > ability.level ? abilityTargetLevel : getNextAbilityBreakpoint(ability.level);
                if (targetLevel && targetLevel <= 200) {
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
        // Cost = (targetLevel - currentLevel) * book market price
        const bookHrid = candidate.currentHrid.replace('/abilities/', '/items/');
        const bookPrice = getItemPrice(bookHrid, { mode: 'ask', context: 'profit', side: 'buy' }) || 0;
        return bookPrice * (candidate.upgradeLevel - candidate.currentLevel);
    }

    if (candidate.type === 'ability_swap') {
        // Cost = targetLevel * book price for new ability (books are consumed, not recoverable)
        const bookHrid = candidate.upgradeHrid.replace('/abilities/', '/items/');
        const bookPrice = getItemPrice(bookHrid, { mode: 'ask', context: 'profit', side: 'buy' }) || 0;
        return bookPrice * candidate.upgradeLevel;
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
            gameData
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
        abilityTargetLevel,
    } = params;
    const { abortSignal } = options;
    const gameData = buildGameDataPayload();
    if (!gameData) throw new Error('No game data available');

    const playerDTO = playerDTOs[playerIndex];
    const playerHrid = playerDTO.hrid;

    // Generate candidates and compute costs
    const candidates = generateCandidates(playerDTO, gameData, upgradeMode, abilityTargetLevel);
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
        dps: totalXpPerHour, // Total combat XP/hr as DPS proxy
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

export default {
    generateCandidates,
    calculateUpgradeCost,
    runUpgradeAnalysis,
    getEquipmentTierProgression,
};
