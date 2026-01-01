/**
 * Action Speed Breakdown Module
 * Shows detailed breakdown of action speed sources
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';

class ActionSpeedBreakdown {
    constructor() {
        this.isInitialized = false;
        this.currentActionHrid = null;
    }

    /**
     * Initialize the action speed breakdown feature
     */
    initialize() {
        console.log('[ActionSpeedBreakdown] Initializing...');

        const setting = config.getSetting('actionPanel_speedBreakdown');
        console.log('[ActionSpeedBreakdown] Setting value:', setting);

        if (!setting) {
            console.log('[ActionSpeedBreakdown] Feature disabled by setting');
            return;
        }

        // Wait for action panels to appear
        domObserver.observeNewElement(
            'ActionSpeedBreakdown',
            'div[class*="SkillActionDetail_skillActionDetail"]',
            (actionPanel) => {
                console.log('[ActionSpeedBreakdown] Observer triggered! Panel detected:', actionPanel);
                this.injectSpeedBreakdown(actionPanel);
            }
        );

        console.log('[ActionSpeedBreakdown] Observer registered for selector: div[class*="SkillActionDetail_skillActionDetail"]');
        this.isInitialized = true;
        console.log('[ActionSpeedBreakdown] Initialization complete');
    }

    /**
     * Inject speed breakdown into action panel
     * @param {HTMLElement} actionPanel - The action panel element
     */
    injectSpeedBreakdown(actionPanel) {
        // Check if already injected
        if (actionPanel.querySelector('.mwi-speed-breakdown')) {
            return;
        }

        try {
            // Get action info
            const actionNameElement = actionPanel.querySelector('[class*="SkillActionDetail_skillName"]');
            if (!actionNameElement) {
                console.warn('[ActionSpeedBreakdown] Could not find action name element');
                return;
            }

            const actionName = actionNameElement.textContent.trim();
            const actionHrid = this.getActionHridFromName(actionName);
            if (!actionHrid) {
                console.warn('[ActionSpeedBreakdown] Could not find action HRID for:', actionName);
                return;
            }

            const actionData = dataManager.getActionData(actionHrid);
            if (!actionData) {
                console.warn('[ActionSpeedBreakdown] Could not find action data for:', actionHrid);
                return;
            }

            // Calculate speed breakdown
            const breakdown = this.calculateSpeedBreakdown(actionData);

            // Create breakdown UI
            const breakdownElement = this.createBreakdownUI(breakdown, actionData);

            // Find insertion point (after action time display or action name)
            const insertAfter = actionPanel.querySelector('.mwi-action-time-display') ||
                               actionNameElement.parentElement;

            if (insertAfter) {
                insertAfter.insertAdjacentElement('afterend', breakdownElement);
                console.log('[ActionSpeedBreakdown] Injected speed breakdown for:', actionName);
            } else {
                console.warn('[ActionSpeedBreakdown] Could not find insertion point');
            }
        } catch (error) {
            console.error('[ActionSpeedBreakdown] Error injecting breakdown:', error);
        }
    }

    /**
     * Calculate speed breakdown from all sources
     * @param {Object} actionData - Action data from dataManager
     * @returns {Object} Speed breakdown by source
     */
    calculateSpeedBreakdown(actionData) {
        const breakdown = {
            equipment: [],
            tool: [],
            consumables: [],
            total: 0
        };

        // Equipment (Skilling Speed)
        const equipment = dataManager.getEquipment();
        for (const [slot, item] of Object.entries(equipment)) {
            if (!item) continue;

            const itemData = dataManager.getItemData(item.itemHrid);
            if (!itemData?.equipmentDetail?.noncombatStats?.skillingSpeed) continue;

            const baseSpeed = itemData.equipmentDetail.noncombatStats.skillingSpeed * 100;
            const enhancementBonus = this.getEnhancementBonus(item, itemData);
            const totalSpeed = baseSpeed * (1 + enhancementBonus);

            breakdown.equipment.push({
                name: itemData.name,
                enhancement: item.augmentations?.augmentationLevel || 0,
                baseSpeed: baseSpeed,
                enhancementBonus: enhancementBonus * 100,
                totalSpeed: totalSpeed
            });

            breakdown.total += totalSpeed;
        }

        // Tool (action-specific speed)
        const toolSpeed = this.getToolSpeed(actionData);
        if (toolSpeed.speed > 0) {
            breakdown.tool.push(toolSpeed);
            breakdown.total += toolSpeed.totalSpeed;
        }

        // Consumables (teas)
        const consumableSpeed = this.getConsumableSpeed(actionData);
        breakdown.consumables = consumableSpeed;
        breakdown.total += consumableSpeed.reduce((sum, c) => sum + c.speed, 0);

        return breakdown;
    }

    /**
     * Get enhancement bonus multiplier for equipment
     * @param {Object} item - Equipped item
     * @param {Object} itemData - Item data
     * @returns {number} Enhancement bonus multiplier (0.145 for +10 accessory = 145% bonus)
     */
    getEnhancementBonus(item, itemData) {
        const enhancementLevel = item.augmentations?.augmentationLevel || 0;
        if (enhancementLevel === 0) return 0;

        // Enhancement bonus table
        const bonusTable = [
            0, 0.02, 0.042, 0.066, 0.092, 0.12, 0.15, 0.182, 0.216, 0.252, 0.29,
            0.334, 0.384, 0.44, 0.502, 0.57, 0.644, 0.724, 0.81, 0.902, 1.0
        ];

        const bonus = bonusTable[enhancementLevel] || 0;

        // Check if accessory (5× multiplier)
        const isAccessory = ['/equipment_types/neck', '/equipment_types/ring', 
                            '/equipment_types/earrings', '/equipment_types/back',
                            '/equipment_types/trinket', '/equipment_types/charm'].includes(
            itemData.equipmentDetail.type
        );

        return bonus * (isAccessory ? 5 : 1);
    }

    /**
     * Get tool speed for the action
     * @param {Object} actionData - Action data
     * @returns {Object} Tool speed info
     */
    getToolSpeed(actionData) {
        const equipment = dataManager.getEquipment();
        const toolSlot = equipment['/equipment_types/tool'];
        
        if (!toolSlot) return { speed: 0 };

        const toolData = dataManager.getItemData(toolSlot.itemHrid);
        if (!toolData) return { speed: 0 };

        // Check for action-specific speed (e.g., woodcuttingSpeed, miningSpeed)
        const actionType = actionData.type;
        const speedStat = this.getSpeedStatForAction(actionType);
        
        if (!speedStat) return { speed: 0 };

        const baseSpeed = toolData.equipmentDetail?.noncombatStats?.[speedStat];
        if (!baseSpeed) return { speed: 0 };

        const enhancementBonus = this.getEnhancementBonus(toolSlot, toolData);
        const totalSpeed = baseSpeed * 100 * (1 + enhancementBonus);

        return {
            name: toolData.name,
            enhancement: toolSlot.augmentations?.augmentationLevel || 0,
            baseSpeed: baseSpeed * 100,
            enhancementBonus: enhancementBonus * 100,
            totalSpeed: totalSpeed,
            speed: totalSpeed
        };
    }

    /**
     * Get the speed stat name for an action type
     * @param {string} actionType - Action type HRID
     * @returns {string|null} Speed stat name
     */
    getSpeedStatForAction(actionType) {
        const mapping = {
            // Gathering skills
            '/action_types/woodcutting': 'woodcuttingSpeed',
            '/action_types/foraging': 'foragingSpeed',
            '/action_types/milking': 'milkingSpeed',
            // Production skills
            '/action_types/brewing': 'brewingSpeed',
            '/action_types/cheesesmithing': 'cheesesmithingSpeed',
            '/action_types/cooking': 'cookingSpeed',
            '/action_types/crafting': 'craftingSpeed',
            '/action_types/tailoring': 'tailoringSpeed',
            '/action_types/alchemy': 'alchemySpeed'
        };
        return mapping[actionType] || null;
    }

    /**
     * Get consumable speed bonuses (Enhancing Teas only)
     * @param {Object} actionData - Action data
     * @returns {Array} Consumable speed info
     */
    getConsumableSpeed(actionData) {
        const drinkSlots = dataManager.getDrinkSlots();
        if (!drinkSlots) return [];

        const actionType = actionData.type;
        const consumables = [];

        // Only Enhancing is relevant (all actions except combat)
        if (actionType === '/action_types/combat') {
            return consumables;
        }

        // Get drink concentration bonus from Guzzling Pouch
        const equipment = dataManager.getEquipment();
        let drinkConcentration = 0;
        for (const [slot, item] of Object.entries(equipment)) {
            if (!item) continue;
            const itemData = dataManager.getItemData(item.itemHrid);
            if (itemData?.equipmentDetail?.noncombatStats?.drinkConcentration) {
                const baseDrinkConc = itemData.equipmentDetail.noncombatStats.drinkConcentration;
                const enhancementBonus = this.getEnhancementBonus(item, itemData);
                drinkConcentration += baseDrinkConc * (1 + enhancementBonus);
            }
        }

        // Check drink slots for Enhancing Teas with action_speed buff
        const enhancingTeas = {
            '/items/enhancing_tea': { name: 'Enhancing Tea', baseSpeed: 0.02 },
            '/items/super_enhancing_tea': { name: 'Super Enhancing Tea', baseSpeed: 0.04 },
            '/items/ultra_enhancing_tea': { name: 'Ultra Enhancing Tea', baseSpeed: 0.06 }
        };

        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue;

            const teaInfo = enhancingTeas[drink.itemHrid];
            if (teaInfo) {
                const scaledSpeed = teaInfo.baseSpeed * (1 + drinkConcentration);
                consumables.push({
                    name: teaInfo.name,
                    baseSpeed: teaInfo.baseSpeed * 100,
                    drinkConcentration: drinkConcentration * 100,
                    speed: scaledSpeed * 100
                });
            }
        }

        return consumables;
    }

    /**
     * Get action HRID from action name
     * @param {string} actionName - Action name
     * @returns {string|null} Action HRID
     */
    getActionHridFromName(actionName) {
        const initClientData = dataManager.getInitClientData();
        if (!initClientData?.actionDetailMap) return null;

        for (const [hrid, action] of Object.entries(initClientData.actionDetailMap)) {
            if (action.name === actionName) {
                return hrid;
            }
        }
        return null;
    }

    /**
     * Create breakdown UI element
     * @param {Object} breakdown - Speed breakdown data
     * @param {Object} actionData - Action data
     * @returns {HTMLElement} Breakdown UI element
     */
    createBreakdownUI(breakdown, actionData) {
        const container = document.createElement('div');
        container.className = 'mwi-speed-breakdown';
        container.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.875rem;
            color: #ccc;
        `;

        // Header (collapsible)
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            font-weight: bold;
            color: ${config.SCRIPT_COLOR_MAIN};
        `;
        
        const arrow = document.createElement('span');
        arrow.textContent = '▼';
        arrow.style.marginRight = '6px';
        arrow.style.fontSize = '0.7em';
        arrow.style.transition = 'transform 0.2s';

        const title = document.createElement('span');
        title.textContent = `Action Speed: +${breakdown.total.toFixed(1)}%`;

        header.appendChild(arrow);
        header.appendChild(title);

        // Content (collapsible)
        const content = document.createElement('div');
        content.style.cssText = `
            margin-top: 8px;
            margin-left: 12px;
            line-height: 1.6;
        `;

        // Add each source category
        if (breakdown.equipment.length > 0) {
            content.appendChild(this.createSourceSection('Equipment', breakdown.equipment));
        }

        if (breakdown.tool.length > 0) {
            content.appendChild(this.createSourceSection('Tool', breakdown.tool));
        }

        if (breakdown.consumables.length > 0) {
            content.appendChild(this.createSourceSection('Consumables', breakdown.consumables));
        } else {
            const noBuffs = document.createElement('div');
            noBuffs.textContent = '└─ Consumables: No active speed buffs';
            noBuffs.style.color = '#888';
            content.appendChild(noBuffs);
        }

        // Calculate base and actual time
        const baseTime = actionData.baseTimeCost / 1000; // Convert ms to seconds
        const actualTime = baseTime / (1 + breakdown.total / 100);
        
        const timeInfo = document.createElement('div');
        timeInfo.style.cssText = `
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            font-weight: bold;
        `;
        timeInfo.textContent = `Base Time: ${baseTime.toFixed(1)}s → Actual Time: ${actualTime.toFixed(2)}s`;
        content.appendChild(timeInfo);

        // Toggle functionality
        let isOpen = false;
        content.style.display = 'none';

        header.addEventListener('click', () => {
            isOpen = !isOpen;
            content.style.display = isOpen ? 'block' : 'none';
            arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
        });

        // Start collapsed
        arrow.style.transform = 'rotate(-90deg)';

        container.appendChild(header);
        container.appendChild(content);

        return container;
    }

    /**
     * Create a source section (Equipment, Tool, Consumables)
     * @param {string} categoryName - Category name
     * @param {Array} items - Items in this category
     * @returns {HTMLElement} Source section element
     */
    createSourceSection(categoryName, items) {
        const section = document.createElement('div');
        section.style.marginBottom = '4px';

        const categoryHeader = document.createElement('div');
        categoryHeader.textContent = `├─ ${categoryName}`;
        categoryHeader.style.fontWeight = 'bold';
        section.appendChild(categoryHeader);

        items.forEach((item, index) => {
            const isLast = index === items.length - 1;
            const prefix = isLast ? '    └─ ' : '    ├─ ';

            const itemLine = document.createElement('div');
            itemLine.style.marginLeft = '8px';

            let text = `${prefix}${item.name}`;
            if (item.enhancement > 0) {
                text += ` +${item.enhancement}`;
            }

            // Speed display varies by source type
            if (item.speed !== undefined) {
                text += `: +${item.speed.toFixed(1)}%`;
            } else if (item.totalSpeed !== undefined) {
                text += `: +${item.totalSpeed.toFixed(1)}%`;
            }

            // Additional info
            if (item.baseSpeed && item.enhancementBonus > 0) {
                text += ` (${item.baseSpeed.toFixed(1)}% base × ${(1 + item.enhancementBonus / 100).toFixed(2)})`;
            } else if (item.baseSpeed && item.drinkConcentration > 0) {
                text += ` (${item.baseSpeed.toFixed(1)}% base × ${(1 + item.drinkConcentration / 100).toFixed(2)})`;
            } else if (item.level) {
                text += ` (Level ${item.level})`;
            }

            itemLine.textContent = text;
            section.appendChild(itemLine);
        });

        return section;
    }

    /**
     * Cleanup
     */
    disable() {
        domObserver.unregister('ActionSpeedBreakdown');
        this.isInitialized = false;
    }
}

const actionSpeedBreakdown = new ActionSpeedBreakdown();
export default actionSpeedBreakdown;
