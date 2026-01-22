/**
 * Alchemy Profit Calculator Module
 * Calculates real-time profit for alchemy actions accounting for:
 * - Success rate (failures consume materials but not catalyst)
 * - Efficiency bonuses
 * - Tea buff costs and duration
 * - Market prices (ask/bid based on pricing mode)
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import { parseTeaEfficiency, getDrinkConcentration, parseTeaSkillLevelBonus } from '../../utils/tea-parser.js';
import { stackAdditive } from '../../utils/efficiency.js';

class AlchemyProfit {
    constructor() {
        this.cachedData = null;
        this.lastFingerprint = null;
    }

    /**
     * Extract alchemy action data from the DOM
     * @returns {Object|null} Action data or null if extraction fails
     */
    async extractActionData() {
        try {
            const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
            if (!alchemyComponent) return null;

            // Get success rate with breakdown
            const successRateBreakdown = this.extractSuccessRate();
            if (successRateBreakdown === null) return null;

            // Get action time (base 20 seconds)
            const actionSpeedBreakdown = this.extractActionSpeed();
            const actionTime = 20 / (1 + actionSpeedBreakdown.total);

            // Get efficiency
            const efficiencyBreakdown = this.extractEfficiency();

            // Get rare find
            const rareFindBreakdown = this.extractRareFind();

            // Get essence find
            const essenceFindBreakdown = this.extractEssenceFind();

            // Get requirements (inputs)
            const requirements = await this.extractRequirements();

            // Get drops (outputs)
            const drops = await this.extractDrops();

            // Get catalyst
            const catalyst = await this.extractCatalyst();

            // Get consumables (tea/drinks)
            const consumables = await this.extractConsumables();
            const teaDuration = this.extractTeaDuration();

            return {
                successRate: successRateBreakdown.total,
                successRateBreakdown,
                actionTime,
                efficiency: efficiencyBreakdown.total,
                efficiencyBreakdown,
                actionSpeedBreakdown,
                rareFindBreakdown,
                essenceFindBreakdown,
                requirements,
                drops,
                catalyst,
                consumables,
                teaDuration
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract action data:', error);
            return null;
        }
    }

    /**
     * Extract success rate with breakdown from the DOM and active buffs
     * @returns {Object} Success rate breakdown { total, base, tea }
     */
    extractSuccessRate() {
        try {
            const element = document.querySelector('[class*="SkillActionDetail_successRate"] [class*="SkillActionDetail_value"]');
            if (!element) return null;

            const text = element.textContent.trim();
            const match = text.match(/(\d+\.?\d*)/);
            if (!match) return null;

            const totalSuccessRate = parseFloat(match[1]) / 100;

            // Calculate tea bonus from active drinks
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return {
                    total: totalSuccessRate,
                    base: totalSuccessRate,
                    tea: 0
                };
            }

            const actionTypeHrid = '/action_types/alchemy';
            const drinkSlots = dataManager.getActionDrinkSlots(actionTypeHrid);
            const equipment = dataManager.getEquipment();

            // Get drink concentration from equipment
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Calculate tea success rate bonus
            let teaBonus = 0;

            if (drinkSlots && drinkSlots.length > 0) {
                for (const drink of drinkSlots) {
                    if (!drink || !drink.itemHrid) continue;

                    const itemDetails = gameData.itemDetailMap[drink.itemHrid];
                    if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                        continue;
                    }

                    // Check for alchemy_success buff
                    for (const buff of itemDetails.consumableDetail.buffs) {
                        if (buff.typeHrid === '/buff_types/alchemy_success') {
                            // ratioBoost is a percentage multiplier (e.g., 0.05 = 5% of base)
                            // It scales with drink concentration
                            const ratioBoost = buff.ratioBoost * (1 + drinkConcentration);
                            teaBonus += ratioBoost;
                        }
                    }
                }
            }

            // Calculate base success rate (before tea bonus)
            // Formula: total = base × (1 + tea_ratio_boost)
            // So: base = total / (1 + tea_ratio_boost)
            const baseSuccessRate = totalSuccessRate / (1 + teaBonus);

            return {
                total: totalSuccessRate,
                base: baseSuccessRate,
                tea: teaBonus
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract success rate:', error);
            return null;
        }
    }

    /**
     * Extract action speed buff using dataManager (matches Action Panel pattern)
     * @returns {Object} Action speed breakdown { total, equipment, tea }
     */
    extractActionSpeed() {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return { total: 0, equipment: 0, tea: 0 };
            }

            const equipment = dataManager.getEquipment();
            const actionTypeHrid = '/action_types/alchemy';

            // Parse equipment speed bonuses using utility
            const equipmentSpeed = parseEquipmentSpeedBonuses(
                equipment,
                actionTypeHrid,
                gameData.itemDetailMap
            );

            // TODO: Add tea speed bonuses when tea-parser supports it
            const teaSpeed = 0;

            const total = equipmentSpeed + teaSpeed;

            return {
                total,
                equipment: equipmentSpeed,
                tea: teaSpeed
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract action speed:', error);
            return { total: 0, equipment: 0, tea: 0 };
        }
    }

    /**
     * Extract efficiency using dataManager (matches Action Panel pattern)
     * @returns {Object} Efficiency breakdown { total, level, house, tea, equipment, community }
     */
    extractEfficiency() {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return { total: 0, level: 0, house: 0, tea: 0, equipment: 0, community: 0 };
            }

            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const houseRooms = Array.from(dataManager.getHouseRooms().values());
            const actionTypeHrid = '/action_types/alchemy';

            // Get required level from the DOM (action-specific)
            const requiredLevel = this.extractRequiredLevel();

            // Get current alchemy level from character skills
            let currentLevel = requiredLevel;
            for (const skill of skills) {
                if (skill.skillHrid === '/skills/alchemy') {
                    currentLevel = skill.level;
                    break;
                }
            }

            // Calculate house efficiency bonus (room level × 1.5%)
            let houseEfficiency = 0;
            for (const room of houseRooms) {
                const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
                if (roomDetail?.usableInActionTypeMap?.[actionTypeHrid]) {
                    houseEfficiency += (room.level || 0) * 1.5;
                }
            }

            // Get equipped drink slots for alchemy
            const drinkSlots = dataManager.getActionDrinkSlots(actionTypeHrid);

            // Get drink concentration from equipment
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Parse tea efficiency bonus using utility
            const teaEfficiency = parseTeaEfficiency(
                actionTypeHrid,
                drinkSlots,
                gameData.itemDetailMap,
                drinkConcentration
            );

            // Parse tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
            const teaLevelBonus = parseTeaSkillLevelBonus(
                actionTypeHrid,
                drinkSlots,
                gameData.itemDetailMap,
                drinkConcentration
            );

            // Calculate level efficiency bonus (+1% per level above requirement)
            // Apply tea level bonus to effective level
            const effectiveLevel = currentLevel + teaLevelBonus;
            const levelEfficiency = Math.max(0, effectiveLevel - requiredLevel);

            // Calculate equipment efficiency bonus using utility
            const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
                equipment,
                actionTypeHrid,
                gameData.itemDetailMap
            );

            // Get community buff efficiency (Production Efficiency)
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            let communityEfficiency = 0;
            if (communityBuffLevel > 0) {
                // Formula: 0.14 + ((level - 1) × 0.003) = 14% base, +0.3% per level
                const flatBoost = 0.14;
                const flatBoostLevelBonus = 0.003;
                const communityBonus = flatBoost + ((communityBuffLevel - 1) * flatBoostLevelBonus);
                communityEfficiency = communityBonus * 100; // Convert to percentage
            }

            // Get achievement buffs (Adept tier: +2% efficiency per tier)
            const achievementBuffs = dataManager.getAchievementBuffs(actionTypeHrid);
            const achievementEfficiency = (achievementBuffs.efficiency || 0) * 100; // Convert to percentage

            // Stack all efficiency bonuses additively
            const totalEfficiency = stackAdditive(
                levelEfficiency,
                houseEfficiency,
                teaEfficiency,
                equipmentEfficiency,
                communityEfficiency,
                achievementEfficiency
            );

            return {
                total: totalEfficiency / 100, // Convert percentage to decimal
                level: levelEfficiency,
                house: houseEfficiency,
                tea: teaEfficiency,
                equipment: equipmentEfficiency,
                community: communityEfficiency,
                achievement: achievementEfficiency
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract efficiency:', error);
            return { total: 0, level: 0, house: 0, tea: 0, equipment: 0, community: 0, achievement: 0 };
        }
    }

    /**
     * Extract rare find bonus from equipment and buffs
     * @returns {Object} Rare find breakdown { total, equipment, achievement }
     */
    extractRareFind() {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return { total: 0, equipment: 0, achievement: 0 };
            }

            const equipment = dataManager.getEquipment();
            const actionTypeHrid = '/action_types/alchemy';

            // Parse equipment rare find bonuses
            let equipmentRareFind = 0;
            for (const slot of equipment) {
                if (!slot || !slot.itemHrid) continue;

                const itemDetail = gameData.itemDetailMap[slot.itemHrid];
                if (!itemDetail?.noncombatStats?.rareFind) continue;

                const enhancementLevel = slot.enhancementLevel || 0;
                const enhancementBonus = this.getEnhancementBonus(enhancementLevel);
                const slotMultiplier = this.getSlotMultiplier(itemDetail.equipmentType);

                equipmentRareFind += itemDetail.noncombatStats.rareFind * (1 + enhancementBonus * slotMultiplier);
            }

            // Get achievement rare find bonus (Veteran tier: +2%)
            const achievementBuffs = dataManager.getAchievementBuffs(actionTypeHrid);
            const achievementRareFind = (achievementBuffs.rareFind || 0) * 100; // Convert to percentage

            const total = equipmentRareFind + achievementRareFind;

            return {
                total: total / 100, // Convert to decimal
                equipment: equipmentRareFind,
                achievement: achievementRareFind
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract rare find:', error);
            return { total: 0, equipment: 0, achievement: 0 };
        }
    }

    /**
     * Extract essence find bonus from equipment and buffs
     * @returns {Object} Essence find breakdown { total, equipment }
     */
    extractEssenceFind() {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return { total: 0, equipment: 0 };
            }

            const equipment = dataManager.getEquipment();

            // Parse equipment essence find bonuses
            let equipmentEssenceFind = 0;
            for (const slot of equipment) {
                if (!slot || !slot.itemHrid) continue;

                const itemDetail = gameData.itemDetailMap[slot.itemHrid];
                if (!itemDetail?.noncombatStats?.essenceFind) continue;

                const enhancementLevel = slot.enhancementLevel || 0;
                const enhancementBonus = this.getEnhancementBonus(enhancementLevel);
                const slotMultiplier = this.getSlotMultiplier(itemDetail.equipmentType);

                equipmentEssenceFind += itemDetail.noncombatStats.essenceFind * (1 + enhancementBonus * slotMultiplier);
            }

            return {
                total: equipmentEssenceFind / 100, // Convert to decimal
                equipment: equipmentEssenceFind
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract essence find:', error);
            return { total: 0, equipment: 0 };
        }
    }

    /**
     * Get enhancement bonus percentage for a given enhancement level
     * @param {number} enhancementLevel - Enhancement level (0-20)
     * @returns {number} Enhancement bonus as decimal
     */
    getEnhancementBonus(enhancementLevel) {
        const bonuses = {
            0: 0, 1: 0.02, 2: 0.042, 3: 0.066, 4: 0.092, 5: 0.12,
            6: 0.15, 7: 0.182, 8: 0.216, 9: 0.252, 10: 0.29,
            11: 0.334, 12: 0.384, 13: 0.44, 14: 0.502, 15: 0.57,
            16: 0.644, 17: 0.724, 18: 0.81, 19: 0.902, 20: 1.0
        };
        return bonuses[enhancementLevel] || 0;
    }

    /**
     * Get slot multiplier for enhancement bonuses
     * @param {string} equipmentType - Equipment type HRID
     * @returns {number} Multiplier (1 or 5)
     */
    getSlotMultiplier(equipmentType) {
        // 5× multiplier for accessories, back, trinket, charm, pouch
        const fiveXSlots = [
            '/equipment_types/neck',
            '/equipment_types/ring',
            '/equipment_types/earrings',
            '/equipment_types/back',
            '/equipment_types/trinket',
            '/equipment_types/charm',
            '/equipment_types/pouch'
        ];
        return fiveXSlots.includes(equipmentType) ? 5 : 1;
    }

    /**
     * Extract required level from notes
     * @returns {number} Required alchemy level
     */
    extractRequiredLevel() {
        try {
            const notesEl = document.querySelector('[class*="SkillActionDetail_notes"]');
            if (!notesEl) return 0;

            const text = notesEl.textContent;
            const match = text.match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract required level:', error);
            return 0;
        }
    }

    /**
     * Extract tea buff duration from React props
     * @returns {number} Duration in seconds (default 300)
     */
    extractTeaDuration() {
        try {
            const container = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
            if (!container || !container._reactProps) {
                return 300;
            }

            let fiber = container._reactProps;
            for (let key in fiber) {
                if (key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')) {
                    fiber = fiber[key];
                    break;
                }
            }

            let current = fiber;
            let depth = 0;

            while (current && depth < 20) {
                if (current.memoizedProps?.actionBuffs) {
                    const buffs = current.memoizedProps.actionBuffs;

                    for (const buff of buffs) {
                        if (buff.uniqueHrid && buff.uniqueHrid.endsWith('tea')) {
                            const duration = buff.duration || 0;
                            return duration / 1e9; // Convert nanoseconds to seconds
                        }
                    }
                    break;
                }

                current = current.return;
                depth++;
            }

            return 300; // Default 5 minutes
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract tea duration:', error);
            return 300;
        }
    }

    /**
     * Extract requirements (input materials) from the DOM
     * @returns {Promise<Array>} Array of requirement objects
     */
    async extractRequirements() {
        try {
            const elements = document.querySelectorAll('[class*="SkillActionDetail_itemRequirements"] [class*="Item_itemContainer"]');
            const requirements = [];

            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                const itemData = await this.extractItemData(el, true, i);
                if (itemData) {
                    requirements.push(itemData);
                }
            }

            return requirements;
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract requirements:', error);
            return [];
        }
    }

    /**
     * Extract drops (outputs) from the DOM
     * @returns {Promise<Array>} Array of drop objects
     */
    async extractDrops() {
        try {
            const elements = document.querySelectorAll('[class*="SkillActionDetail_dropTable"] [class*="Item_itemContainer"]');
            const drops = [];

            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                const itemData = await this.extractItemData(el, false, i);
                if (itemData) {
                    drops.push(itemData);
                }
            }

            return drops;
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract drops:', error);
            return [];
        }
    }

    /**
     * Extract catalyst from the DOM
     * @returns {Promise<Object>} Catalyst object with prices
     */
    async extractCatalyst() {
        try {
            const element = document.querySelector('[class*="SkillActionDetail_catalystItemInputContainer"] [class*="ItemSelector_itemContainer"]') ||
                           document.querySelector('[class*="SkillActionDetail_catalystItemInputContainer"] [class*="SkillActionDetail_itemContainer"]');

            if (!element) {
                return { ask: 0, bid: 0 };
            }

            const itemData = await this.extractItemData(element, false, -1);
            return itemData || { ask: 0, bid: 0 };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract catalyst:', error);
            return { ask: 0, bid: 0 };
        }
    }

    /**
     * Extract consumables (tea/drinks) from the DOM
     * @returns {Promise<Array>} Array of consumable objects
     */
    async extractConsumables() {
        try {
            const elements = document.querySelectorAll('[class*="ActionTypeConsumableSlots_consumableSlots"] [class*="Item_itemContainer"]');
            const consumables = [];

            for (const el of elements) {
                const itemData = await this.extractItemData(el, false, -1);
                if (itemData && itemData.itemHrid !== '/items/coin') {
                    consumables.push(itemData);
                }
            }

            return consumables;
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract consumables:', error);
            return [];
        }
    }

    /**
     * Calculate the cost to create an enhanced item
     * @param {string} itemHrid - Item HRID
     * @param {number} targetLevel - Target enhancement level
     * @param {string} priceType - 'ask' or 'bid'
     * @returns {number} Total cost to create the enhanced item
     */
    calculateEnhancementCost(itemHrid, targetLevel, priceType) {
        if (targetLevel === 0) {
            const priceData = marketAPI.getPrice(itemHrid, 0);
            return priceType === 'ask' ? (priceData?.ask || 0) : (priceData?.bid || 0);
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const itemData = gameData.itemDetailMap?.[itemHrid];
        if (!itemData) return 0;

        // Start with base item cost
        const basePriceData = marketAPI.getPrice(itemHrid, 0);
        let totalCost = priceType === 'ask' ? (basePriceData?.ask || 0) : (basePriceData?.bid || 0);

        // Add enhancement material costs for each level
        const enhancementMaterials = itemData.enhancementCosts;
        if (!enhancementMaterials || !Array.isArray(enhancementMaterials)) {
            return totalCost;
        }

        // Enhance from level 0 to targetLevel
        for (let level = 0; level < targetLevel; level++) {
            for (const cost of enhancementMaterials) {
                const materialHrid = cost.itemHrid;
                const materialCount = cost.count || 0;

                if (materialHrid === '/items/coin') {
                    totalCost += materialCount; // Coins are 1:1
                } else {
                    const materialPrice = marketAPI.getPrice(materialHrid, 0);
                    const price = priceType === 'ask' ? (materialPrice?.ask || 0) : (materialPrice?.bid || 0);
                    totalCost += price * materialCount;
                }
            }
        }

        return totalCost;
    }

    /**
     * Calculate value recovered from decomposing an enhanced item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {string} priceType - 'ask' or 'bid'
     * @returns {number} Total value recovered from decomposition
     */
    calculateDecompositionValue(itemHrid, enhancementLevel, priceType) {
        if (enhancementLevel === 0) return 0;

        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const itemDetails = gameData.itemDetailMap?.[itemHrid];
        if (!itemDetails) return 0;

        let totalValue = 0;

        // 1. Base item decomposition outputs
        if (itemDetails.decompositionDetail?.results) {
            for (const result of itemDetails.decompositionDetail.results) {
                const priceData = marketAPI.getPrice(result.itemHrid, 0);
                if (priceData) {
                    const price = priceType === 'ask' ? priceData.ask : priceData.bid;
                    totalValue += price * result.amount * 0.98; // 2% market tax
                }
            }
        }

        // 2. Enhancing Essence from enhancement level
        // Formula: round(2 × (0.5 + 0.1 × (1.05^itemLevel)) × (2^enhancementLevel))
        const itemLevel = itemDetails.itemLevel || 1;
        const essenceAmount = Math.round(2 * (0.5 + 0.1 * Math.pow(1.05, itemLevel)) * Math.pow(2, enhancementLevel));

        const essencePriceData = marketAPI.getPrice('/items/enhancing_essence', 0);
        if (essencePriceData) {
            const essencePrice = priceType === 'ask' ? essencePriceData.ask : essencePriceData.bid;
            totalValue += essencePrice * essenceAmount * 0.98; // 2% market tax
        }

        return totalValue;
    }

    /**
     * Extract item data (HRID, prices, count, drop rate) from DOM element
     * @param {HTMLElement} element - Item container element
     * @param {boolean} isRequirement - True if this is a requirement (has count), false if drop (has drop rate)
     * @param {number} index - Index in the list (for extracting count/rate text)
     * @returns {Promise<Object|null>} Item data object or null
     */
    async extractItemData(element, isRequirement, index) {
        try {
            // Get item HRID from SVG use element
            const use = element.querySelector('svg use');
            if (!use) return null;

            const href = use.getAttribute('href');
            if (!href) return null;

            const itemId = href.split('#')[1];
            if (!itemId) return null;

            const itemHrid = `/items/${itemId}`;

            // Get enhancement level
            let enhancementLevel = 0;
            if (isRequirement) {
                const enhEl = element.querySelector('[class*="Item_enhancementLevel"]');
                if (enhEl) {
                    const match = enhEl.textContent.match(/\+(\d+)/);
                    enhancementLevel = match ? parseInt(match[1]) : 0;
                }
            }

            // Get market prices
            let ask = 0, bid = 0;
            if (itemHrid === '/items/coin') {
                ask = bid = 1;
            } else {
                // Check if this is an openable container (loot crate)
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (itemDetails?.isOpenable) {
                    // Use expected value calculator for openable containers
                    const containerValue = expectedValueCalculator.getCachedValue(itemHrid);
                    if (containerValue !== null && containerValue > 0) {
                        ask = bid = containerValue;
                    } else {
                        // Fallback to marketplace if EV not available
                        const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);
                        ask = priceData?.ask || 0;
                        bid = priceData?.bid || 0;
                    }
                } else {
                    // Regular item - use marketplace price
                    const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);
                    if (priceData && (priceData.ask > 0 || priceData.bid > 0)) {
                        // Market data exists for this specific enhancement level
                        ask = priceData.ask || 0;
                        bid = priceData.bid || 0;
                    } else {
                        // No market data for this enhancement level - calculate cost
                        ask = this.calculateEnhancementCost(itemHrid, enhancementLevel, 'ask');
                        bid = this.calculateEnhancementCost(itemHrid, enhancementLevel, 'bid');
                    }
                }
            }

            const result = { itemHrid, ask, bid, enhancementLevel };

            // Get count or drop rate
            if (isRequirement && index >= 0) {
                // Extract count from requirement
                const countElements = document.querySelectorAll('[class*="SkillActionDetail_itemRequirements"] [class*="SkillActionDetail_inputCount"]');
                if (countElements[index]) {
                    const text = countElements[index].textContent.trim();
                    const cleaned = text.replace(/,/g, '');
                    result.count = parseFloat(cleaned) || 1;
                }
            } else if (!isRequirement) {
                // Extract count and drop rate from drop by matching item HRID
                // Search through all drop elements to find the one containing this item
                const dropElements = document.querySelectorAll('[class*="SkillActionDetail_drop"]');

                for (const dropElement of dropElements) {
                    // Check if this drop element contains our item
                    const dropItemElement = dropElement.querySelector('[class*="Item_itemContainer"] svg use');
                    if (dropItemElement) {
                        const dropHref = dropItemElement.getAttribute('href');
                        const dropItemId = dropHref ? dropHref.split('#')[1] : null;
                        const dropItemHrid = dropItemId ? `/items/${dropItemId}` : null;

                        if (dropItemHrid === itemHrid) {
                            // Found the matching drop element
                            const text = dropElement.textContent.trim();

                            // Extract count (at start of text)
                            const countMatch = text.match(/^([\d\s,.]+)/);
                            if (countMatch) {
                                const cleaned = countMatch[1].replace(/,/g, '').trim();
                                result.count = parseFloat(cleaned) || 1;
                            } else {
                                result.count = 1;
                            }

                            // Extract drop rate percentage (handles both "7.29%" and "~7.29%")
                            const rateMatch = text.match(/~?([\d,.]+)%/);
                            if (rateMatch) {
                                const cleaned = rateMatch[1].replace(/,/g, '');
                                result.dropRate = parseFloat(cleaned) / 100 || 1;
                            } else {
                                result.dropRate = 1;
                            }

                            break; // Found it, stop searching
                        }
                    }
                }

                // If we didn't find a matching drop element, set defaults
                if (result.count === undefined) {
                    result.count = 1;
                }
                if (result.dropRate === undefined) {
                    result.dropRate = 1;
                }
            }

            return result;
        } catch (error) {
            console.error('[AlchemyProfit] Failed to extract item data:', error);
            return null;
        }
    }

    /**
     * Calculate profit based on extracted data and pricing mode
     * @param {Object} data - Action data from extractActionData()
     * @returns {Object|null} { profitPerHour, profitPerDay } or null
     */
    calculateProfit(data) {
        try {
            if (!data) return null;

            // Get pricing mode
            const pricingMode = config.getSetting('profitCalc_pricingMode') || 'hybrid';

            // Determine buy/sell price types
            let buyType, sellType;
            if (pricingMode === 'conservative') {
                buyType = 'ask';  // Instant buy (Ask)
                sellType = 'bid'; // Instant sell (Bid)
            } else if (pricingMode === 'hybrid') {
                buyType = 'ask';  // Instant buy (Ask)
                sellType = 'ask'; // Patient sell (Ask)
            } else { // optimistic
                buyType = 'bid';  // Patient buy (Bid)
                sellType = 'ask'; // Patient sell (Ask)
            }

            // Calculate material cost (accounting for failures and decomposition value)
            const materialCost = data.requirements.reduce((sum, req) => {
                const price = buyType === 'ask' ? req.ask : req.bid;
                const itemCost = price * (req.count || 1);

                // Subtract decomposition value for enhanced items
                const decompValue = this.calculateDecompositionValue(req.itemHrid, req.enhancementLevel || 0, buyType);
                const netCost = itemCost - decompValue;

                return sum + netCost;
            }, 0);

            // Calculate cost per attempt (materials consumed on failure, materials + catalyst on success)
            const catalystPrice = buyType === 'ask' ? data.catalyst.ask : data.catalyst.bid;
            const costPerAttempt = (materialCost * (1 - data.successRate)) +
                                   ((materialCost + catalystPrice) * data.successRate);

            // Calculate income per attempt
            const incomePerAttempt = data.drops.reduce((sum, drop, index) => {
                // Special handling for coins (no marketplace price)
                let price;
                if (drop.itemHrid === '/items/coin') {
                    price = 1; // Coins are worth 1 coin each
                } else {
                    price = sellType === 'ask' ? drop.ask : drop.bid;
                }

                // Identify drop type
                const isEssence = (index === data.drops.length - 2); // Second-to-last
                const isRare = (index === data.drops.length - 1);     // Last

                // Get base drop rate
                let effectiveDropRate = drop.dropRate || 1;

                // Apply Rare Find bonus to rare drops
                if (isRare && data.rareFindBreakdown) {
                    effectiveDropRate = effectiveDropRate * (1 + data.rareFindBreakdown.total);
                }

                let income;
                if (isEssence) {
                    // Essence doesn't multiply by success rate
                    income = price * effectiveDropRate * (drop.count || 1);
                } else {
                    // Normal and rare drops multiply by success rate
                    income = price * effectiveDropRate * (drop.count || 1) * data.successRate;
                }

                // Apply market tax (2% fee)
                if (drop.itemHrid !== '/items/coin') {
                    income *= 0.98;
                }

                return sum + income;
            }, 0);

            // Calculate net profit per attempt
            const netProfitPerAttempt = incomePerAttempt - costPerAttempt;

            // Calculate profit per second (accounting for efficiency)
            const profitPerSecond = (netProfitPerAttempt * (1 + data.efficiency)) / data.actionTime;

            // Calculate tea cost per second
            let teaCostPerSecond = 0;
            if (data.consumables.length > 0 && data.teaDuration > 0) {
                const totalTeaCost = data.consumables.reduce((sum, consumable) => {
                    const price = buyType === 'ask' ? consumable.ask : consumable.bid;
                    return sum + price;
                }, 0);
                teaCostPerSecond = totalTeaCost / data.teaDuration;
            }

            // Final profit accounting for tea costs
            const finalProfitPerSecond = profitPerSecond - teaCostPerSecond;
            const profitPerHour = finalProfitPerSecond * 3600;
            const profitPerDay = finalProfitPerSecond * 86400;

            // Calculate actions per hour
            const actionsPerHour = (3600 / data.actionTime) * (1 + data.efficiency);

            // Build detailed requirement costs breakdown
            const requirementCosts = data.requirements.map(req => {
                const price = buyType === 'ask' ? req.ask : req.bid;
                const costPerAction = price * (req.count || 1);
                const costPerHour = costPerAction * actionsPerHour;

                // Calculate decomposition value
                const decompositionValue = this.calculateDecompositionValue(req.itemHrid, req.enhancementLevel || 0, buyType);
                const decompositionValuePerHour = decompositionValue * actionsPerHour;

                return {
                    itemHrid: req.itemHrid,
                    count: req.count || 1,
                    price: price,
                    costPerAction: costPerAction,
                    costPerHour: costPerHour,
                    enhancementLevel: req.enhancementLevel || 0,
                    decompositionValue: decompositionValue,
                    decompositionValuePerHour: decompositionValuePerHour
                };
            });

            // Build detailed drop revenues breakdown
            const dropRevenues = data.drops.map((drop, index) => {
                // Special handling for coins (no marketplace price)
                let price;
                if (drop.itemHrid === '/items/coin') {
                    price = 1; // Coins are worth 1 coin each
                } else {
                    price = sellType === 'ask' ? drop.ask : drop.bid;
                }
                const isEssence = (index === data.drops.length - 2);
                const isRare = (index === data.drops.length - 1);

                // Get base drop rate
                const baseDropRate = drop.dropRate || 1;
                let effectiveDropRate = baseDropRate;

                // Apply Rare Find bonus to rare drops
                if (isRare && data.rareFindBreakdown) {
                    effectiveDropRate = baseDropRate * (1 + data.rareFindBreakdown.total);
                }

                let revenuePerAttempt;
                if (isEssence) {
                    // Essence doesn't multiply by success rate
                    revenuePerAttempt = price * effectiveDropRate * (drop.count || 1);
                } else {
                    // Normal and rare drops multiply by success rate
                    revenuePerAttempt = price * effectiveDropRate * (drop.count || 1) * data.successRate;
                }

                // Apply market tax for non-coin items
                const revenueAfterTax = (drop.itemHrid !== '/items/coin') ? revenuePerAttempt * 0.98 : revenuePerAttempt;
                const revenuePerHour = revenueAfterTax * actionsPerHour;

                return {
                    itemHrid: drop.itemHrid,
                    count: drop.count || 1,
                    dropRate: baseDropRate,              // Base drop rate (before Rare Find)
                    effectiveDropRate: effectiveDropRate, // Effective drop rate (after Rare Find)
                    price: price,
                    isEssence: isEssence,
                    isRare: isRare,
                    revenuePerAttempt: revenueAfterTax,
                    revenuePerHour: revenuePerHour,
                    dropsPerHour: effectiveDropRate * (drop.count || 1) * actionsPerHour * (isEssence ? 1 : data.successRate)
                };
            });

            // Build catalyst cost detail
            const catalystCost = {
                itemHrid: data.catalyst.itemHrid,
                price: catalystPrice,
                costPerSuccess: catalystPrice,
                costPerAttempt: catalystPrice * data.successRate,
                costPerHour: catalystPrice * data.successRate * actionsPerHour
            };

            // Build consumable costs breakdown
            const consumableCosts = data.consumables.map(c => {
                const price = buyType === 'ask' ? c.ask : c.bid;
                const drinksPerHour = data.teaDuration > 0 ? 3600 / data.teaDuration : 0;
                const costPerHour = price * drinksPerHour;

                return {
                    itemHrid: c.itemHrid,
                    price: price,
                    drinksPerHour: drinksPerHour,
                    costPerHour: costPerHour
                };
            });

            // Calculate total costs per hour for summary
            const materialCostPerHour = materialCost * actionsPerHour;
            const catalystCostPerHour = catalystCost.costPerHour;
            const totalTeaCostPerHour = teaCostPerSecond * 3600;

            // Calculate total revenue per hour
            const revenuePerHour = incomePerAttempt * actionsPerHour;

            return {
                // Summary totals
                profitPerHour,
                profitPerDay,
                revenuePerHour,

                // Actions and rates
                actionsPerHour,

                // Per-attempt economics
                materialCost,
                catalystPrice,
                costPerAttempt,
                incomePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour,

                // Detailed breakdowns
                requirementCosts,      // Array of material cost details
                dropRevenues,          // Array of drop revenue details
                catalystCost,          // Single catalyst cost detail
                consumableCosts,       // Array of tea/drink details

                // Core stats
                successRate: data.successRate,
                actionTime: data.actionTime,
                efficiency: data.efficiency,
                teaDuration: data.teaDuration,

                // Modifier breakdowns
                successRateBreakdown: data.successRateBreakdown,
                efficiencyBreakdown: data.efficiencyBreakdown,
                actionSpeedBreakdown: data.actionSpeedBreakdown,
                rareFindBreakdown: data.rareFindBreakdown,
                essenceFindBreakdown: data.essenceFindBreakdown,

                // Pricing info
                pricingMode,
                buyType,
                sellType
            };
        } catch (error) {
            console.error('[AlchemyProfit] Failed to calculate profit:', error);
            return null;
        }
    }

    /**
     * Generate state fingerprint for change detection
     * @returns {string} Fingerprint string
     */
    getStateFingerprint() {
        try {
            const successRate = document.querySelector('[class*="SkillActionDetail_successRate"] [class*="SkillActionDetail_value"]')?.textContent || '';
            const consumables = Array.from(document.querySelectorAll('[class*="ActionTypeConsumableSlots_consumableSlots"] [class*="Item_itemContainer"]'))
                .map(el => el.querySelector('svg use')?.getAttribute('href') || 'empty')
                .join('|');

            // Get catalyst (from the catalyst input container)
            const catalyst = document.querySelector('[class*="SkillActionDetail_catalystItemInputContainer"] svg use')?.getAttribute('href') || 'none';

            // Get requirements (input materials)
            const requirements = Array.from(document.querySelectorAll('[class*="SkillActionDetail_itemRequirements"] [class*="Item_itemContainer"]'))
                .map(el => {
                    const href = el.querySelector('svg use')?.getAttribute('href') || 'empty';
                    const enh = el.querySelector('[class*="Item_enhancementLevel"]')?.textContent || '0';
                    return `${href}${enh}`;
                })
                .join('|');

            // Don't include infoText - it contains our profit display which causes update loops
            return `${successRate}:${consumables}:${catalyst}:${requirements}`;
        } catch (error) {
            return '';
        }
    }
}

// Create and export singleton instance
const alchemyProfit = new AlchemyProfit();

export default alchemyProfit;
