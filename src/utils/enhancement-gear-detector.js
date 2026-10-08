/**
 * Skill Gear Detector
 *
 * Auto-detects gear and buffs from character equipment for any skill.
 * Originally designed for enhancing, now works generically for all skills.
 */

import { getEnhancementMultiplier } from './enhancement-multipliers.js';

/**
 * Detect best gear for a specific skill by equipment slot
 * @param {string} skillName - Skill name (e.g., 'enhancing', 'cooking', 'milking')
 * @param {Map} equipment - Character equipment map (equipped items only)
 * @param {Object} itemDetailMap - Item details map from init_client_data
 * @returns {Object} Best gear per slot with bonuses
 */
export function detectSkillGear(skillName, equipment, itemDetailMap) {
    const gear = {
        // Totals for calculations
        toolBonus: 0,
        speedBonus: 0,
        rareFindBonus: 0,
        experienceBonus: 0,

        // Per-slot breakdown for display
        slotBreakdown: [],

        // Best items per slot for display
        toolSlot: null, // main_hand or two_hand
        bodySlot: null, // body
        legsSlot: null, // legs
        handsSlot: null, // hands
    };

    // Get items to scan - only use equipment map (already filtered to equipped items only)
    let itemsToScan = [];

    if (equipment) {
        // Scan only equipped items from equipment map
        itemsToScan = Array.from(equipment.values()).filter((item) => item && item.itemHrid);
    }

    // Track best item per slot (by item level, then enhancement level)
    const slotCandidates = {
        tool: [], // main_hand or two_hand or skill-specific tool
        body: [], // body
        legs: [], // legs
        hands: [], // hands
        neck: [], // neck (accessories have 5× multiplier)
        ring: [], // ring (accessories have 5× multiplier)
        earrings: [], // earrings (accessories have 5× multiplier)
        back: [], // back (capes)
        charm: [], // charm (5× multiplier)
    };

    // Dynamic stat names based on skill
    const successStat = `${skillName}Success`;
    const speedStat = `${skillName}Speed`;
    const rareFindStat = `${skillName}RareFind`;
    const experienceStat = `${skillName}Experience`;

    // Search all items for skill-related bonuses and group by slot
    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats) {
            continue;
        }

        const stats = itemDetails.equipmentDetail.noncombatStats;
        const enhancementLevel = item.enhancementLevel || 0;
        const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
        const equipmentType = itemDetails.equipmentDetail.type;

        // Generic stat calculation: Loop over ALL stats and apply multiplier
        const allStats = {};
        for (const [statName, statValue] of Object.entries(stats)) {
            if (typeof statValue !== 'number') continue; // Skip non-numeric values
            allStats[statName] = statValue * 100 * multiplier;
        }

        // Check if item has any skill-related stats (including universal skills)
        const hasSkillStats =
            allStats[successStat] ||
            allStats[speedStat] ||
            allStats[rareFindStat] ||
            allStats[experienceStat] ||
            allStats.skillingSpeed ||
            allStats.skillingRareFind ||
            allStats.skillingExperience;

        if (!hasSkillStats) {
            continue;
        }

        // Calculate bonuses for this item (backward-compatible output)
        const itemBonuses = {
            item: item,
            itemDetails: itemDetails,
            itemLevel: itemDetails.itemLevel || 0,
            enhancementLevel: enhancementLevel,
            // Named bonuses (dynamic based on skill)
            toolBonus: allStats[successStat] || 0,
            speedBonus: (allStats[speedStat] || 0) + (allStats.skillingSpeed || 0), // Combine speed sources
            rareFindBonus: (allStats[rareFindStat] || 0) + (allStats.skillingRareFind || 0),
            experienceBonus: (allStats[experienceStat] || 0) + (allStats.skillingExperience || 0), // Combine experience sources
            // Generic access to all stats
            allStats: allStats,
        };

        // Group by slot
        // Tool slots: skill-specific tools (e.g., enhancing_tool, cooking_tool) plus main_hand/two_hand
        const skillToolType = `/equipment_types/${skillName}_tool`;
        if (
            equipmentType === skillToolType ||
            equipmentType === '/equipment_types/main_hand' ||
            equipmentType === '/equipment_types/two_hand'
        ) {
            slotCandidates.tool.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/body') {
            slotCandidates.body.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/legs') {
            slotCandidates.legs.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/hands') {
            slotCandidates.hands.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/neck') {
            slotCandidates.neck.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/ring') {
            slotCandidates.ring.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/earrings') {
            slotCandidates.earrings.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/back') {
            slotCandidates.back.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/charm') {
            slotCandidates.charm.push(itemBonuses);
        }
    }

    // Select best item per slot (highest item level, then highest enhancement level)
    const selectBest = (candidates) => {
        if (candidates.length === 0) return null;

        return candidates.reduce((best, current) => {
            // Compare by item level first
            if (current.itemLevel > best.itemLevel) return current;
            if (current.itemLevel < best.itemLevel) return best;

            // If item levels are equal, compare by enhancement level
            if (current.enhancementLevel > best.enhancementLevel) return current;
            return best;
        });
    };

    const bestTool = selectBest(slotCandidates.tool);
    const bestBody = selectBest(slotCandidates.body);
    const bestLegs = selectBest(slotCandidates.legs);
    const bestHands = selectBest(slotCandidates.hands);
    const bestNeck = selectBest(slotCandidates.neck);
    const bestRing = selectBest(slotCandidates.ring);
    const bestEarrings = selectBest(slotCandidates.earrings);
    const bestBack = selectBest(slotCandidates.back);
    const bestCharm = selectBest(slotCandidates.charm);

    // Add bonuses from best items in each slot
    const addSlot = (best) => {
        if (!best) return;
        gear.toolBonus += best.toolBonus;
        gear.speedBonus += best.speedBonus;
        gear.rareFindBonus += best.rareFindBonus;
        gear.experienceBonus += best.experienceBonus;
        gear.slotBreakdown.push({
            itemHrid: best.item?.itemHrid || best.itemDetails?.hrid || '',
            name: best.itemDetails.name,
            enhancementLevel: best.enhancementLevel,
            success: best.toolBonus,
            speed: best.speedBonus,
            rareFind: best.rareFindBonus,
            experience: best.experienceBonus,
        });
        return {
            itemHrid: best.item?.itemHrid || best.itemDetails?.hrid || '',
            name: best.itemDetails.name,
            enhancementLevel: best.enhancementLevel,
        };
    };

    gear.toolSlot = addSlot(bestTool) || null;
    gear.bodySlot = addSlot(bestBody) || null;
    gear.legsSlot = addSlot(bestLegs) || null;
    gear.handsSlot = addSlot(bestHands) || null;
    addSlot(bestNeck);
    addSlot(bestRing);
    addSlot(bestEarrings);
    addSlot(bestBack);
    addSlot(bestCharm);

    return gear;
}

/**
 * Detect active enhancing teas from drink slots
 * @param {Array} drinkSlots - Active drink slots for enhancing action type
 * @param {Object} itemDetailMap - Item details map from init_client_data
 * @returns {Object} Active teas { enhancing, superEnhancing, ultraEnhancing, blessed }
 */
export function detectEnhancingTeas(drinkSlots, _itemDetailMap) {
    const teas = {
        enhancing: false, // Enhancing Tea (+3 levels)
        superEnhancing: false, // Super Enhancing Tea (+6 levels)
        ultraEnhancing: false, // Ultra Enhancing Tea (+8 levels)
        blessed: false, // Blessed Tea (1% double jump)
    };

    if (!drinkSlots || drinkSlots.length === 0) {
        return teas;
    }

    // Tea HRIDs to check for
    const teaMap = {
        '/items/enhancing_tea': 'enhancing',
        '/items/super_enhancing_tea': 'superEnhancing',
        '/items/ultra_enhancing_tea': 'ultraEnhancing',
        '/items/blessed_tea': 'blessed',
    };

    for (const drink of drinkSlots) {
        if (!drink || !drink.itemHrid) continue;

        const teaKey = teaMap[drink.itemHrid];
        if (teaKey) {
            teas[teaKey] = true;
        }
    }

    return teas;
}

/**
 * Get enhancing tea level bonus
 * @param {Object} teas - Active teas from detectEnhancingTeas()
 * @returns {number} Total level bonus from teas
 */
export function getEnhancingTeaLevelBonus(teas) {
    // Teas don't stack - highest one wins
    if (teas.ultraEnhancing) return 8;
    if (teas.superEnhancing) return 6;
    if (teas.enhancing) return 3;

    return 0;
}

/**
 * Get enhancing tea speed bonus (base, before concentration)
 * @param {Object} teas - Active teas from detectEnhancingTeas()
 * @returns {number} Base speed bonus % from teas
 */
export function getEnhancingTeaSpeedBonus(teas) {
    // Teas don't stack - highest one wins
    // Base speed bonuses (before drink concentration):
    if (teas.ultraEnhancing) return 6; // +6% base
    if (teas.superEnhancing) return 4; // +4% base
    if (teas.enhancing) return 2; // +2% base

    return 0;
}

/**
 * Backward-compatible wrapper for enhancing gear detection
 * @param {Map} equipment - Character equipment map (equipped items only)
 * @param {Object} itemDetailMap - Item details map from init_client_data
 * @returns {Object} Best enhancing gear per slot with bonuses
 */
export function detectEnhancingGear(equipment, itemDetailMap) {
    return detectSkillGear('enhancing', equipment, itemDetailMap);
}
