/**
 * Action Time Display Module
 *
 * Displays estimated completion time for queued actions.
 * Uses WebSocket data from data-manager instead of DOM scraping.
 *
 * Features:
 * - Appends stats to game's action name (queue count, time/action, actions/hr)
 * - Shows time estimates below (total time → completion time)
 * - Updates automatically on action changes
 * - Queue tooltip enhancement (time for each action + total)
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import profitCalculator from '../market/profit-calculator.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import { timeReadable, formatWithSeparator } from '../../utils/formatters.js';
import {
    parseArtisanBonus,
    getDrinkConcentration,
    parseGatheringBonus,
    parseGourmetBonus,
} from '../../utils/tea-parser.js';
import { calculateQueueProfitBreakdown, calculateActionsPerHour } from '../../utils/profit-helpers.js';

/**
 * ActionTimeDisplay class manages the time display panel and queue tooltips
 */
class ActionTimeDisplay {
    constructor() {
        this.displayElement = null;
        this.isInitialized = false;
        this.updateTimer = null;
        this.unregisterQueueObserver = null;
        this.actionNameObserver = null;
        this.queueMenuObserver = null; // Observer for queue menu mutations
        this.characterInitHandler = null; // Handler for character switch
        this.activeProfitCalculationId = null; // Track active profit calculation to prevent race conditions
    }

    /**
     * Initialize the action time display
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        // Check if feature is enabled
        const enabled = config.getSettingValue('totalActionTime', true);
        if (!enabled) {
            return;
        }

        // Set up handler for character switching
        if (!this.characterInitHandler) {
            this.characterInitHandler = () => {
                this.handleCharacterSwitch();
            };
            dataManager.on('character_initialized', this.characterInitHandler);
        }

        // Wait for action name element to exist
        this.waitForActionPanel();

        // Initialize queue tooltip observer
        this.initializeQueueObserver();

        this.isInitialized = true;
    }

    /**
     * Initialize observer for queue tooltip
     */
    initializeQueueObserver() {
        // Register with centralized DOM observer to watch for queue menu
        this.unregisterQueueObserver = domObserver.onClass(
            'ActionTimeDisplay-Queue',
            'QueuedActions_queuedActionsEditMenu',
            (queueMenu) => {
                this.injectQueueTimes(queueMenu);

                // Set up mutation observer to watch for queue reordering
                if (this.queueMenuObserver) {
                    this.queueMenuObserver.disconnect();
                }

                this.queueMenuObserver = new MutationObserver(() => {
                    // Disconnect to prevent infinite loop (our injection triggers mutations)
                    this.queueMenuObserver.disconnect();

                    // Queue DOM changed (reordering) - re-inject times
                    // NOTE: Reconnection happens inside injectQueueTimes after async completes
                    this.injectQueueTimes(queueMenu);
                });

                this.queueMenuObserver.observe(queueMenu, {
                    childList: true,
                    subtree: true,
                });
            }
        );
    }

    /**
     * Handle character switch
     * Clean up old observers and re-initialize for new character's action panel
     */
    handleCharacterSwitch() {
        // Cancel any active profit calculations to prevent stale data
        this.activeProfitCalculationId = null;

        // Clear appended stats from old character's action panel (before it's removed)
        const oldActionNameElement = document.querySelector('div[class*="Header_actionName"]');
        if (oldActionNameElement) {
            this.clearAppendedStats(oldActionNameElement);
        }

        // Disconnect old action name observer (watching removed element)
        if (this.actionNameObserver) {
            this.actionNameObserver.disconnect();
            this.actionNameObserver = null;
        }

        // Clear display element reference (already removed from DOM by game)
        this.displayElement = null;

        // Re-initialize action panel display for new character
        this.waitForActionPanel();
    }

    /**
     * Wait for action panel to exist in DOM
     */
    async waitForActionPanel() {
        // Try to find action name element (use wildcard for hash-suffixed class)
        const actionNameElement = document.querySelector('div[class*="Header_actionName"]');

        if (actionNameElement) {
            this.createDisplayPanel();
            this.setupActionNameObserver(actionNameElement);
            this.updateDisplay();
        } else {
            // Not found, try again in 200ms
            setTimeout(() => this.waitForActionPanel(), 200);
        }
    }

    /**
     * Setup MutationObserver to watch action name changes
     * @param {HTMLElement} actionNameElement - The action name DOM element
     */
    setupActionNameObserver(actionNameElement) {
        // Watch for text content changes in the action name element
        this.actionNameObserver = new MutationObserver(() => {
            this.updateDisplay();
        });

        this.actionNameObserver.observe(actionNameElement, {
            childList: true,
            characterData: true,
            subtree: true,
        });
    }

    /**
     * Create the display panel in the DOM
     */
    createDisplayPanel() {
        if (this.displayElement) {
            return; // Already created
        }

        // Find the action name container (use wildcard for hash-suffixed class)
        const actionNameContainer = document.querySelector('div[class*="Header_actionName"]');
        if (!actionNameContainer) {
            return;
        }

        // NOTE: Width overrides are now applied in updateDisplay() after we know if it's combat
        // This prevents HP/MP bar width issues when loading directly on combat actions

        // Create display element
        this.displayElement = document.createElement('div');
        this.displayElement.id = 'mwi-action-time-display';
        this.displayElement.style.cssText = `
            font-size: 0.9em;
            color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
            margin-top: 2px;
            line-height: 1.4;
            text-align: left;
            white-space: pre-wrap;
        `;

        // Insert after action name
        actionNameContainer.parentNode.insertBefore(this.displayElement, actionNameContainer.nextSibling);
    }

    /**
     * Update the display with current action data
     */
    updateDisplay() {
        if (!this.displayElement) {
            return;
        }

        // Get current action - read from game UI which is always correct
        // The game updates the DOM immediately when actions change
        // Use wildcard selector to handle hash-suffixed class names
        const actionNameElement = document.querySelector('div[class*="Header_actionName"]');

        // CRITICAL: Disconnect observer before making changes to prevent infinite loop
        if (this.actionNameObserver) {
            this.actionNameObserver.disconnect();
        }

        if (!actionNameElement || !actionNameElement.textContent) {
            this.displayElement.innerHTML = '';
            // Clear any appended stats from the game's div
            this.clearAppendedStats(actionNameElement);
            // Reconnect observer
            this.reconnectActionNameObserver(actionNameElement);
            return;
        }

        // Parse action name from DOM
        // Format can be: "Action Name (#123)", "Action Name (123)", "Action Name: Item (123)", etc.
        // First, strip any stats we previously appended
        const actionNameText = this.getCleanActionName(actionNameElement);

        // Check if no action is running ("Doing nothing...")
        if (actionNameText.includes('Doing nothing')) {
            this.displayElement.innerHTML = '';
            this.clearAppendedStats(actionNameElement);
            // Reconnect observer
            this.reconnectActionNameObserver(actionNameElement);
            return;
        }

        // Extract inventory count from parentheses (e.g., "Coinify: Item (4312)" -> 4312)
        const inventoryCountMatch = actionNameText.match(/\((\d+)\)$/);
        const inventoryCount = inventoryCountMatch ? parseInt(inventoryCountMatch[1]) : null;

        // Find the matching action in cache
        const cachedActions = dataManager.getCurrentActions();
        let action;

        // Parse the action name, handling special formats like "Coinify: Item Name (count)"
        // Also handles combat zones like "Farmland (276K)" or "Zone (1.2M)"
        const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\([^)]+\))?$/);
        const fullNameFromDom = actionNameMatch ? actionNameMatch[1].trim() : actionNameText;

        // Check if this is a format like "Coinify: Item Name"
        let actionNameFromDom, itemNameFromDom;
        if (fullNameFromDom.includes(':')) {
            const parts = fullNameFromDom.split(':');
            actionNameFromDom = parts[0].trim();
            itemNameFromDom = parts.slice(1).join(':').trim(); // Handle multiple colons
        } else {
            actionNameFromDom = fullNameFromDom;
            itemNameFromDom = null;
        }

        // ONLY match against the first action (current action), not queued actions
        // This prevents showing stats from queued actions when party combat interrupts
        if (cachedActions.length > 0) {
            const currentAction = cachedActions[0];
            const actionDetails = dataManager.getActionDetails(currentAction.actionHrid);

            if (actionDetails && actionDetails.name === actionNameFromDom) {
                // If there's an item name (like "Foraging Essence" from "Coinify: Foraging Essence"),
                // we need to match on primaryItemHash
                if (itemNameFromDom && currentAction.primaryItemHash) {
                    // Convert display name to item HRID format (lowercase with underscores)
                    const itemHrid = '/items/' + itemNameFromDom.toLowerCase().replace(/\s+/g, '_');
                    if (currentAction.primaryItemHash.includes(itemHrid)) {
                        action = currentAction;
                    }
                } else if (!itemNameFromDom) {
                    // No item name specified, match on action name alone
                    action = currentAction;
                }
            }
        }

        if (!action) {
            this.displayElement.innerHTML = '';
            // Reconnect observer
            this.reconnectActionNameObserver(actionNameElement);
            return;
        }

        const actionDetails = dataManager.getActionDetails(action.actionHrid);
        if (!actionDetails) {
            // Reconnect observer
            this.reconnectActionNameObserver(actionNameElement);
            return;
        }

        // Skip combat actions - no time display for combat
        if (actionDetails.type === '/action_types/combat') {
            this.displayElement.innerHTML = '';
            this.clearAppendedStats(actionNameElement);

            // REMOVE CSS overrides for combat to restore normal HP/MP bar width
            actionNameElement.style.removeProperty('overflow');
            actionNameElement.style.removeProperty('text-overflow');
            actionNameElement.style.removeProperty('white-space');
            actionNameElement.style.removeProperty('max-width');
            actionNameElement.style.removeProperty('width');
            actionNameElement.style.removeProperty('min-width');

            // Remove from parent chain as well
            let parent = actionNameElement.parentElement;
            let levels = 0;
            while (parent && levels < 5) {
                parent.style.removeProperty('overflow');
                parent.style.removeProperty('text-overflow');
                parent.style.removeProperty('white-space');
                parent.style.removeProperty('max-width');
                parent.style.removeProperty('width');
                parent.style.removeProperty('min-width');
                parent = parent.parentElement;
                levels++;
            }

            this.reconnectActionNameObserver(actionNameElement);
            return;
        }

        // Re-apply CSS override on every update to prevent game's CSS from truncating text
        // ONLY for non-combat actions (combat needs normal width for HP/MP bars)
        // Use setProperty with 'important' to ensure we override game's styles
        actionNameElement.style.setProperty('overflow', 'visible', 'important');
        actionNameElement.style.setProperty('text-overflow', 'clip', 'important');
        actionNameElement.style.setProperty('white-space', 'nowrap', 'important');
        actionNameElement.style.setProperty('max-width', 'none', 'important');
        actionNameElement.style.setProperty('width', 'auto', 'important');
        actionNameElement.style.setProperty('min-width', 'max-content', 'important');

        // Apply to entire parent chain (up to 5 levels)
        let parent = actionNameElement.parentElement;
        let levels = 0;
        while (parent && levels < 5) {
            parent.style.setProperty('overflow', 'visible', 'important');
            parent.style.setProperty('text-overflow', 'clip', 'important');
            parent.style.setProperty('white-space', 'nowrap', 'important');
            parent.style.setProperty('max-width', 'none', 'important');
            parent.style.setProperty('width', 'auto', 'important');
            parent.style.setProperty('min-width', 'max-content', 'important');
            parent = parent.parentElement;
            levels++;
        }

        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

        // Use shared calculator
        const stats = calculateActionStats(actionDetails, {
            skills,
            equipment,
            itemDetailMap,
            actionHrid: action.actionHrid, // Pass action HRID for task detection
            includeCommunityBuff: true,
            includeBreakdown: false,
            floorActionLevel: true,
        });

        if (!stats) {
            // Reconnect observer
            this.reconnectActionNameObserver(actionNameElement);
            return;
        }

        const { actionTime, totalEfficiency } = stats;
        const baseActionsPerHour = calculateActionsPerHour(actionTime);

        // Calculate average actions per attempt from efficiency
        const guaranteedActions = 1 + Math.floor(totalEfficiency / 100);
        const chanceForExtra = totalEfficiency % 100;
        const avgActionsPerAttempt = guaranteedActions + chanceForExtra / 100;

        // Calculate actions per hour WITH efficiency (total action completions including free repeats)
        const actionsPerHourWithEfficiency = baseActionsPerHour * avgActionsPerAttempt;

        // Calculate items per hour based on action type
        let itemsPerHour;

        // Gathering action types (need special handling for dropTable)
        const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

        // Production action types that benefit from Gourmet Tea
        const PRODUCTION_TYPES = ['/action_types/brewing', '/action_types/cooking'];

        if (
            actionDetails.dropTable &&
            actionDetails.dropTable.length > 0 &&
            GATHERING_TYPES.includes(actionDetails.type)
        ) {
            // Gathering action - use dropTable with gathering quantity bonus
            const mainDrop = actionDetails.dropTable[0];
            const baseAvgAmount = (mainDrop.minCount + mainDrop.maxCount) / 2;

            // Calculate gathering quantity bonus (same as gathering-profit.js)
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
            const gatheringTea = parseGatheringBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Community buff
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
            const communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

            // Achievement buffs
            const achievementBuffs = dataManager.getAchievementBuffs(actionDetails.type);
            const achievementGathering = achievementBuffs.gatheringQuantity || 0;

            // Total gathering bonus (all additive)
            const totalGathering = gatheringTea + communityGathering + achievementGathering;

            // Apply gathering bonus to average amount
            const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

            // Items per hour = actions × drop rate × avg amount × efficiency
            itemsPerHour = baseActionsPerHour * mainDrop.dropRate * avgAmountPerAction * avgActionsPerAttempt;
        } else if (actionDetails.outputItems && actionDetails.outputItems.length > 0) {
            // Production action - use outputItems
            const outputAmount = actionDetails.outputItems[0].count || 1;
            itemsPerHour = baseActionsPerHour * outputAmount * avgActionsPerAttempt;

            // Apply Gourmet bonus for brewing/cooking (extra items chance)
            if (PRODUCTION_TYPES.includes(actionDetails.type)) {
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
                const gourmetBonus = parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration);

                // Gourmet gives a chance for extra items (e.g., 0.1344 = 13.44% more items)
                const gourmetBonusItems = itemsPerHour * gourmetBonus;
                itemsPerHour += gourmetBonusItems;
            }
        } else {
            // Fallback - no items produced
            itemsPerHour = actionsPerHourWithEfficiency;
        }

        // Calculate material limit for infinite actions
        let materialLimit = null;
        if (!action.hasMaxCount) {
            // Get inventory and calculate Artisan bonus
            const inventory = dataManager.getInventory();
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
            const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate max actions based on materials (pass efficiency to account for free repeat actions)
            materialLimit = this.calculateMaterialLimit(
                actionDetails,
                inventory,
                artisanBonus,
                totalEfficiency,
                action
            );
        }

        // Get queue size for display (total queued, doesn't change)
        // For infinite actions with inventory count, use that; otherwise use maxCount or Infinity
        let queueSizeDisplay;
        if (action.hasMaxCount) {
            queueSizeDisplay = action.maxCount;
        } else if (materialLimit !== null) {
            // Material-limited infinite action - show infinity but we'll add "max: X" separately
            queueSizeDisplay = Infinity;
        } else if (inventoryCount !== null) {
            queueSizeDisplay = inventoryCount;
        } else {
            queueSizeDisplay = Infinity;
        }

        // Get remaining actions for time calculation
        // For infinite actions, use material limit if available, then inventory count
        let remainingActions;
        if (action.hasMaxCount) {
            // Finite action: maxCount is the target, currentCount is progress toward that target
            remainingActions = action.maxCount - action.currentCount;
        } else if (materialLimit !== null) {
            // Infinite action limited by materials (materialLimit is attempts, not actions)
            remainingActions = materialLimit;
        } else if (inventoryCount !== null) {
            // Infinite action: currentCount is lifetime total, so just use inventory count directly
            remainingActions = inventoryCount;
        } else {
            remainingActions = Infinity;
        }

        // Calculate actual attempts needed (time-consuming operations)
        // NOTE: materialLimit returns attempts, but finite/inventory counts are items
        let actualAttempts;
        if (!action.hasMaxCount && materialLimit !== null) {
            // Material-limited infinite action - materialLimit is already attempts
            actualAttempts = materialLimit;
        } else {
            // Finite action or inventory-count infinite - remainingActions is items, convert to attempts
            actualAttempts = Math.ceil(remainingActions / avgActionsPerAttempt);
        }
        const totalTimeSeconds = actualAttempts * actionTime;

        // Calculate completion time
        const completionTime = new Date();
        completionTime.setSeconds(completionTime.getSeconds() + totalTimeSeconds);

        // Format time strings (timeReadable handles days/hours/minutes properly)
        const timeStr = timeReadable(totalTimeSeconds);

        // Format completion time
        const now = new Date();
        const isToday = completionTime.toDateString() === now.toDateString();

        let clockTime;
        if (isToday) {
            // Today: Just show time in 12-hour format
            clockTime = completionTime.toLocaleString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
            });
        } else {
            // Future date: Show date and time in 12-hour format
            clockTime = completionTime.toLocaleString('en-US', {
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
            });
        }

        // Build display HTML
        // Line 1: Append stats to game's action name div
        const statsToAppend = [];

        // Queue size (with thousand separators)
        if (queueSizeDisplay !== Infinity) {
            statsToAppend.push(`(${queueSizeDisplay.toLocaleString()} queued)`);
        } else if (materialLimit !== null) {
            // Show infinity with optional material limit
            statsToAppend.push(`(∞ · max: ${this.formatLargeNumber(materialLimit)})`);
        } else {
            statsToAppend.push(`(∞)`);
        }

        // Time per action and actions/hour
        statsToAppend.push(`${actionTime.toFixed(2)}s/action`);

        // Show both actions/hr (with efficiency) and items/hr (actual item output)
        statsToAppend.push(
            `${actionsPerHourWithEfficiency.toFixed(0)} actions/hr (${itemsPerHour.toFixed(0)} items/hr)`
        );

        // Append to game's div (with marker for cleanup)
        this.appendStatsToActionName(actionNameElement, statsToAppend.join(' · '));

        // Line 2: Time estimates in our div
        // Show time info if we have a finite number of remaining actions
        // This includes both finite actions (hasMaxCount) and infinite actions with inventory count
        if (remainingActions !== Infinity && !isNaN(remainingActions) && remainingActions > 0) {
            this.displayElement.innerHTML = `<span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeStr} → ${clockTime}`;
        } else {
            this.displayElement.innerHTML = '';
        }

        // Reconnect observer to watch for game's updates
        this.reconnectActionNameObserver(actionNameElement);
    }

    /**
     * Reconnect action name observer after making our changes
     * @param {HTMLElement} actionNameElement - Action name element
     */
    reconnectActionNameObserver(actionNameElement) {
        if (!actionNameElement || !this.actionNameObserver) {
            return;
        }

        this.actionNameObserver.observe(actionNameElement, {
            childList: true,
            characterData: true,
            subtree: true,
        });
    }

    /**
     * Get clean action name from element, stripping any stats we appended
     * @param {HTMLElement} actionNameElement - Action name element
     * @returns {string} Clean action name text
     */
    getCleanActionName(actionNameElement) {
        // Find our marker span (if it exists)
        const markerSpan = actionNameElement.querySelector('.mwi-appended-stats');
        if (markerSpan) {
            // Remove the marker span temporarily to get clean text
            const cleanText = actionNameElement.textContent.replace(markerSpan.textContent, '').trim();
            return cleanText;
        }
        // No marker found, return as-is
        return actionNameElement.textContent.trim();
    }

    /**
     * Clear any stats we previously appended to action name
     * @param {HTMLElement} actionNameElement - Action name element
     */
    clearAppendedStats(actionNameElement) {
        if (!actionNameElement) return;
        const markerSpan = actionNameElement.querySelector('.mwi-appended-stats');
        if (markerSpan) {
            markerSpan.remove();
        }
    }

    /**
     * Append stats to game's action name element
     * @param {HTMLElement} actionNameElement - Action name element
     * @param {string} statsText - Stats text to append
     */
    appendStatsToActionName(actionNameElement, statsText) {
        // Clear any previous appended stats
        this.clearAppendedStats(actionNameElement);

        // Create marker span for our additions
        const statsSpan = document.createElement('span');
        statsSpan.className = 'mwi-appended-stats';
        statsSpan.style.cssText = `color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});`;
        statsSpan.textContent = ' ' + statsText;

        // Append to action name element
        actionNameElement.appendChild(statsSpan);
    }

    /**
     * Calculate action time for a given action
     * @param {Object} actionDetails - Action details from data manager
     * @param {string} actionHrid - Action HRID for task detection (optional)
     * @returns {Object} {actionTime, totalEfficiency} or null if calculation fails
     */
    calculateActionTime(actionDetails, actionHrid = null) {
        const skills = dataManager.getSkills();
        const equipment = dataManager.getEquipment();
        const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

        // Use shared calculator with same parameters as main display
        return calculateActionStats(actionDetails, {
            skills,
            equipment,
            itemDetailMap,
            actionHrid, // Pass action HRID for task detection
            includeCommunityBuff: true,
            includeBreakdown: false,
            floorActionLevel: true,
        });
    }

    /**
     * Format a number with K/M suffix for large values
     * @param {number} num - Number to format
     * @returns {string} Formatted string (e.g., "1.23K", "5.67M")
     */
    formatLargeNumber(num) {
        if (num < 10000) {
            return num.toLocaleString(); // Under 10K: show full number with commas
        } else if (num < 1000000) {
            return (num / 1000).toFixed(1) + 'K'; // 10K-999K: show with K
        } else {
            return (num / 1000000).toFixed(2) + 'M'; // 1M+: show with M
        }
    }

    /**
     * Calculate maximum actions possible based on inventory materials
     * @param {Object} actionDetails - Action detail object
     * @param {Array} inventory - Character inventory items
     * @param {number} artisanBonus - Artisan material reduction (0-1 decimal)
     * @param {number} totalEfficiency - Total efficiency percentage (e.g., 150 for 150%)
     * @param {Object} actionObj - Character action object (for primaryItemHash)
     * @returns {number|null} Max actions possible, or null if unlimited/no materials required
     */
    calculateMaterialLimit(actionDetails, inventory, artisanBonus, totalEfficiency, actionObj = null) {
        if (!actionDetails || !inventory) {
            return null;
        }

        // Calculate average actions per material-consuming attempt based on efficiency
        // Efficiency formula: Guaranteed = 1 + floor(eff/100), Chance = eff % 100
        // Average actions per attempt = 1 + floor(eff/100) + (eff%100)/100
        const guaranteedActions = 1 + Math.floor(totalEfficiency / 100);
        const chanceForExtra = totalEfficiency % 100;
        const _avgActionsPerAttempt = guaranteedActions + chanceForExtra / 100;

        // Check for primaryItemHash (ONLY for Alchemy actions: Coinify, Decompose, Transmute)
        // Crafting actions also have primaryItemHash but should use the standard input/upgrade logic
        // Format: "characterID::itemLocation::itemHrid::enhancementLevel"
        const isAlchemyAction = actionDetails.type === '/action_types/alchemy';
        if (isAlchemyAction && actionObj && actionObj.primaryItemHash) {
            const parts = actionObj.primaryItemHash.split('::');
            if (parts.length >= 3) {
                const itemHrid = parts[2]; // Extract item HRID
                const enhancementLevel = parts.length >= 4 ? parseInt(parts[3]) : 0;

                // Find item in inventory
                const inventoryItem = inventory.find(
                    (item) =>
                        item.itemHrid === itemHrid &&
                        item.itemLocationHrid === '/item_locations/inventory' &&
                        (item.enhancementLevel || 0) === enhancementLevel
                );

                const availableCount = inventoryItem?.count || 0;

                // Get bulk multiplier from item details (how many items per action)
                const itemDetails = dataManager.getItemDetails(itemHrid);
                const bulkMultiplier = itemDetails?.alchemyDetail?.bulkMultiplier || 1;

                // Calculate max attempts (how many times we can perform the action)
                // NOTE: Return attempts, not total actions - efficiency is applied separately in time calc
                const maxAttempts = Math.floor(availableCount / bulkMultiplier);

                return maxAttempts;
            }
        }

        // Check if action requires input materials
        const hasInputItems = actionDetails.inputItems && actionDetails.inputItems.length > 0;
        const hasUpgradeItem = actionDetails.upgradeItemHrid;

        if (!hasInputItems && !hasUpgradeItem) {
            return null; // No materials required - unlimited
        }

        let minLimit = Infinity;

        // Check input items (affected by Artisan Tea)
        if (hasInputItems) {
            for (const inputItem of actionDetails.inputItems) {
                // Find item in inventory
                const inventoryItem = inventory.find(
                    (item) =>
                        item.itemHrid === inputItem.itemHrid && item.itemLocationHrid === '/item_locations/inventory'
                );

                const availableCount = inventoryItem?.count || 0;

                // Apply Artisan reduction to required materials
                const requiredPerAction = inputItem.count * (1 - artisanBonus);

                // Calculate max attempts for this material
                // NOTE: Return attempts, not total actions - efficiency is applied separately in time calc
                const maxAttempts = Math.floor(availableCount / requiredPerAction);

                minLimit = Math.min(minLimit, maxAttempts);
            }
        }

        // Check upgrade item (NOT affected by Artisan Tea)
        if (hasUpgradeItem) {
            const inventoryItem = inventory.find(
                (item) => item.itemHrid === hasUpgradeItem && item.itemLocationHrid === '/item_locations/inventory'
            );

            const availableCount = inventoryItem?.count || 0;

            // NOTE: Return attempts, not total actions - efficiency is applied separately in time calc
            minLimit = Math.min(minLimit, availableCount);
        }

        return minLimit === Infinity ? null : minLimit;
    }

    /**
     * Match an action from cache by reading its name from a queue div
     * @param {HTMLElement} actionDiv - The queue action div element
     * @param {Array} cachedActions - Array of actions from dataManager
     * @returns {Object|null} Matched action object or null
     */
    matchActionFromDiv(actionDiv, cachedActions) {
        // Find the action text element within the div
        const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
        if (!actionTextContainer) {
            return null;
        }

        // The first child div contains the action name: "#3 🧪 Coinify: Foraging Essence"
        const firstChildDiv = actionTextContainer.querySelector('[class*="QueuedActions_text__"]');
        if (!firstChildDiv) {
            return null;
        }

        // Check if this is an enhancing action by looking at the SVG icon
        const svgIcon = firstChildDiv.querySelector('svg use');
        const isEnhancingAction = svgIcon && svgIcon.getAttribute('href')?.includes('#enhancing');

        // Get the text content (format: "#3Coinify: Foraging Essence" - no space after number!)
        const fullText = firstChildDiv.textContent.trim();

        // Remove position number: "#3Coinify: Foraging Essence" → "Coinify: Foraging Essence"
        // Note: No space after the number in the actual text
        const actionNameText = fullText.replace(/^#\d+/, '').trim();

        // Handle enhancing actions specially
        if (isEnhancingAction) {
            // For enhancing, the text is just the item name (e.g., "Cheese Sword")
            const itemName = actionNameText;
            const itemHrid = '/items/' + itemName.toLowerCase().replace(/\s+/g, '_');

            // Find enhancing action matching this item
            return cachedActions.find((a) => {
                const actionDetails = dataManager.getActionDetails(a.actionHrid);
                if (!actionDetails || actionDetails.type !== '/action_types/enhancing') {
                    return false;
                }

                // Match on primaryItemHash (the item being enhanced)
                return a.primaryItemHash && a.primaryItemHash.includes(itemHrid);
            });
        }

        // Parse action name (same logic as main display)
        let actionNameFromDiv, itemNameFromDiv;
        if (actionNameText.includes(':')) {
            const parts = actionNameText.split(':');
            actionNameFromDiv = parts[0].trim();
            itemNameFromDiv = parts.slice(1).join(':').trim();
        } else {
            actionNameFromDiv = actionNameText;
            itemNameFromDiv = null;
        }

        // Match action from cache (same logic as main display)
        return cachedActions.find((a) => {
            const actionDetails = dataManager.getActionDetails(a.actionHrid);
            if (!actionDetails || actionDetails.name !== actionNameFromDiv) {
                return false;
            }

            // If there's an item name, match on primaryItemHash
            if (itemNameFromDiv && a.primaryItemHash) {
                const itemHrid = '/items/' + itemNameFromDiv.toLowerCase().replace(/\s+/g, '_');
                return a.primaryItemHash.includes(itemHrid);
            }

            return true;
        });
    }

    /**
     * Inject time display into queue tooltip
     * @param {HTMLElement} queueMenu - Queue menu container element
     */
    injectQueueTimes(queueMenu) {
        // Track if we need to reconnect observer at the end
        let shouldReconnectObserver = false;

        try {
            // Get all queued actions
            const currentActions = dataManager.getCurrentActions();
            if (!currentActions || currentActions.length === 0) {
                return;
            }

            // Find all action divs in the queue (individual actions only, not wrapper or text containers)
            const actionDivs = queueMenu.querySelectorAll('[class^="QueuedActions_action__"]');
            if (actionDivs.length === 0) {
                return;
            }

            // Clear all existing time and profit displays to prevent duplicates
            queueMenu.querySelectorAll('.mwi-queue-action-time').forEach((el) => el.remove());
            queueMenu.querySelectorAll('.mwi-queue-action-profit').forEach((el) => el.remove());
            const existingTotal = document.querySelector('#mwi-queue-total-time');
            if (existingTotal) {
                existingTotal.remove();
            }

            // Observer is already disconnected by callback - we'll reconnect in finally
            shouldReconnectObserver = true;

            let accumulatedTime = 0;
            let hasInfinite = false;
            const actionsToCalculate = []; // Store actions for async profit calculation (with time in seconds)

            // First, calculate time for current action to include in total
            // Read from DOM to get the actual current action (not from cache)
            const actionNameElement = document.querySelector('div[class*="Header_actionName"]');
            if (actionNameElement && actionNameElement.textContent) {
                // Use getCleanActionName to strip any stats we previously appended
                const actionNameText = this.getCleanActionName(actionNameElement);

                // Parse action name (same logic as main display)
                // Also handles formatted numbers like "Farmland (276K)" or "Zone (1.2M)"
                const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\([^)]+\))?$/);
                const fullNameFromDom = actionNameMatch ? actionNameMatch[1].trim() : actionNameText;

                let actionNameFromDom, itemNameFromDom;
                if (fullNameFromDom.includes(':')) {
                    const parts = fullNameFromDom.split(':');
                    actionNameFromDom = parts[0].trim();
                    itemNameFromDom = parts.slice(1).join(':').trim();
                } else {
                    actionNameFromDom = fullNameFromDom;
                    itemNameFromDom = null;
                }

                // Match current action from cache
                const currentAction = currentActions.find((a) => {
                    const actionDetails = dataManager.getActionDetails(a.actionHrid);
                    if (!actionDetails || actionDetails.name !== actionNameFromDom) {
                        return false;
                    }

                    if (itemNameFromDom && a.primaryItemHash) {
                        const itemHrid = '/items/' + itemNameFromDom.toLowerCase().replace(/\s+/g, '_');
                        return a.primaryItemHash.includes(itemHrid);
                    }

                    return true;
                });

                if (currentAction) {
                    const actionDetails = dataManager.getActionDetails(currentAction.actionHrid);
                    if (actionDetails) {
                        // Check if infinite BEFORE calculating count
                        const isInfinite = !currentAction.hasMaxCount || currentAction.actionHrid.includes('/combat/');

                        let actionTimeSeconds = 0; // Time spent on this action (for profit calculation)
                        let count = 0; // Item/action count for profit calculation
                        let actualAttempts = 0; // Actual attempts for profit calculation

                        if (isInfinite) {
                            // Check for material limit on infinite actions
                            const inventory = dataManager.getInventory();
                            const equipment = dataManager.getEquipment();
                            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};
                            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
                            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                            const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                            // Calculate action stats to get efficiency
                            const timeData = this.calculateActionTime(actionDetails, currentAction.actionHrid);
                            if (timeData) {
                                const { actionTime, totalEfficiency } = timeData;
                                const materialLimit = this.calculateMaterialLimit(
                                    actionDetails,
                                    inventory,
                                    artisanBonus,
                                    totalEfficiency,
                                    currentAction
                                );

                                if (materialLimit !== null) {
                                    // Material-limited infinite action - calculate time
                                    // NOTE: materialLimit is already attempts, not actions
                                    actualAttempts = materialLimit;
                                    count = materialLimit; // For infinite actions, count = attempts
                                    const totalTime = actualAttempts * actionTime;
                                    accumulatedTime += totalTime;
                                    actionTimeSeconds = totalTime;
                                }
                            } else {
                                // Could not calculate action time
                                hasInfinite = true;
                            }
                        } else {
                            count = currentAction.maxCount - currentAction.currentCount;
                            const timeData = this.calculateActionTime(actionDetails, currentAction.actionHrid);
                            if (timeData) {
                                const { actionTime, totalEfficiency } = timeData;

                                // Calculate average actions per attempt from efficiency
                                const guaranteedActions = 1 + Math.floor(totalEfficiency / 100);
                                const chanceForExtra = totalEfficiency % 100;
                                const avgActionsPerAttempt = guaranteedActions + chanceForExtra / 100;

                                // Calculate actual attempts needed
                                actualAttempts = Math.ceil(count / avgActionsPerAttempt);
                                const totalTime = actualAttempts * actionTime;
                                accumulatedTime += totalTime;
                                actionTimeSeconds = totalTime;
                            }
                        }

                        // Store action for profit calculation (done async after UI renders)
                        if (actionTimeSeconds > 0 && !isInfinite) {
                            actionsToCalculate.push({
                                actionHrid: currentAction.actionHrid,
                                timeSeconds: actionTimeSeconds,
                                count: count,
                                actualAttempts: actualAttempts,
                            });
                        }
                    }
                }
            }

            // Now process queued actions by reading from each div
            // Each div shows a queued action, and we match it to cache by name
            for (let divIndex = 0; divIndex < actionDivs.length; divIndex++) {
                const actionDiv = actionDivs[divIndex];

                // Match this div's action from the cache
                const actionObj = this.matchActionFromDiv(actionDiv, currentActions);

                if (!actionObj) {
                    // Could not match action - show unknown
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'mwi-queue-action-time';
                    timeDiv.style.cssText = `
                        color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                        font-size: 0.85em;
                        margin-top: 2px;
                    `;
                    timeDiv.textContent = '[Unknown action]';

                    const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
                    if (actionTextContainer) {
                        actionTextContainer.appendChild(timeDiv);
                    } else {
                        actionDiv.appendChild(timeDiv);
                    }

                    continue;
                }

                const actionDetails = dataManager.getActionDetails(actionObj.actionHrid);
                if (!actionDetails) {
                    console.warn('[Action Time Display] Unknown queued action:', actionObj.actionHrid);
                    continue;
                }

                // Check if infinite BEFORE calculating count
                const isInfinite = !actionObj.hasMaxCount || actionObj.actionHrid.includes('/combat/');

                // Calculate action time first to get efficiency
                const timeData = this.calculateActionTime(actionDetails, actionObj.actionHrid);
                if (!timeData) continue;

                const { actionTime, totalEfficiency } = timeData;

                // Calculate material limit for infinite actions
                let materialLimit = null;
                if (isInfinite) {
                    const inventory = dataManager.getInventory();
                    const equipment = dataManager.getEquipment();
                    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};
                    const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
                    const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                    const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                    materialLimit = this.calculateMaterialLimit(
                        actionDetails,
                        inventory,
                        artisanBonus,
                        totalEfficiency,
                        actionObj
                    );
                }

                // Determine if truly infinite (no material limit)
                const isTrulyInfinite = isInfinite && materialLimit === null;

                if (isTrulyInfinite) {
                    hasInfinite = true;
                }

                // Calculate count for finite actions or material-limited infinite actions
                let count = 0;
                if (!isInfinite) {
                    count = actionObj.maxCount - actionObj.currentCount;
                } else if (materialLimit !== null) {
                    count = materialLimit;
                }

                // Calculate total time for this action
                let totalTime;
                let actionTimeSeconds = 0; // Time spent on this action (for profit calculation)
                let actualAttempts = 0; // Actual attempts for profit calculation
                if (isTrulyInfinite) {
                    totalTime = Infinity;
                } else {
                    // Calculate actual attempts needed
                    // NOTE: materialLimit returns attempts, but finite counts are items
                    if (materialLimit !== null) {
                        // Material-limited - count is already attempts
                        actualAttempts = count;
                    } else {
                        // Finite action - count is items, convert to attempts
                        const guaranteedActions = 1 + Math.floor(totalEfficiency / 100);
                        const chanceForExtra = totalEfficiency % 100;
                        const avgActionsPerAttempt = guaranteedActions + chanceForExtra / 100;
                        actualAttempts = Math.ceil(count / avgActionsPerAttempt);
                    }
                    totalTime = actualAttempts * actionTime;
                    accumulatedTime += totalTime;
                    actionTimeSeconds = totalTime;
                }

                // Store action for profit calculation (done async after UI renders)
                if (actionTimeSeconds > 0 && !isTrulyInfinite) {
                    actionsToCalculate.push({
                        actionHrid: actionObj.actionHrid,
                        timeSeconds: actionTimeSeconds,
                        count: count,
                        actualAttempts: actualAttempts,
                        divIndex: divIndex, // Store index to match back to DOM element
                    });
                }

                // Format completion time
                let completionText = '';
                if (!hasInfinite && !isTrulyInfinite) {
                    const completionDate = new Date();
                    completionDate.setSeconds(completionDate.getSeconds() + accumulatedTime);

                    const hours = String(completionDate.getHours()).padStart(2, '0');
                    const minutes = String(completionDate.getMinutes()).padStart(2, '0');
                    const seconds = String(completionDate.getSeconds()).padStart(2, '0');

                    completionText = ` Complete at ${hours}:${minutes}:${seconds}`;
                }

                // Create time display element
                const timeDiv = document.createElement('div');
                timeDiv.className = 'mwi-queue-action-time';
                timeDiv.style.cssText = `
                    color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                    font-size: 0.85em;
                    margin-top: 2px;
                `;

                if (isTrulyInfinite) {
                    timeDiv.textContent = '[∞]';
                } else if (isInfinite && materialLimit !== null) {
                    // Material-limited infinite action
                    const timeStr = timeReadable(totalTime);
                    timeDiv.textContent = `[${timeStr} · max: ${this.formatLargeNumber(materialLimit)}]${completionText}`;
                } else {
                    const timeStr = timeReadable(totalTime);
                    timeDiv.textContent = `[${timeStr}]${completionText}`;
                }

                // Find the actionText container and append inside it
                const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
                if (actionTextContainer) {
                    actionTextContainer.appendChild(timeDiv);
                } else {
                    // Fallback: append to action div
                    actionDiv.appendChild(timeDiv);
                }

                // Create empty profit div for this action (will be populated asynchronously)
                if (!isTrulyInfinite && actionTimeSeconds > 0) {
                    const profitDiv = document.createElement('div');
                    profitDiv.className = 'mwi-queue-action-profit';
                    profitDiv.dataset.divIndex = divIndex;
                    profitDiv.style.cssText = `
                        color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                        font-size: 0.85em;
                        margin-top: 2px;
                    `;
                    // Leave empty - will be filled by async calculation
                    profitDiv.textContent = '';

                    if (actionTextContainer) {
                        actionTextContainer.appendChild(profitDiv);
                    } else {
                        actionDiv.appendChild(profitDiv);
                    }
                }
            }

            // Add total time at bottom (includes current action + all queued)
            const totalDiv = document.createElement('div');
            totalDiv.id = 'mwi-queue-total-time';
            totalDiv.style.cssText = `
                color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});
                font-weight: bold;
                margin-top: 12px;
                padding: 8px;
                border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
                text-align: center;
            `;

            // Build total time text
            let totalText = '';
            if (hasInfinite) {
                // Show finite time first, then add infinity indicator
                if (accumulatedTime > 0) {
                    totalText = `Total time: ${timeReadable(accumulatedTime)} + [∞]`;
                } else {
                    totalText = 'Total time: [∞]';
                }
            } else {
                totalText = `Total time: ${timeReadable(accumulatedTime)}`;
            }

            totalDiv.innerHTML = totalText;

            // Insert after queue menu
            queueMenu.insertAdjacentElement('afterend', totalDiv);

            // Calculate profit asynchronously (non-blocking)
            if (actionsToCalculate.length > 0 && marketAPI.isLoaded()) {
                // Async will handle observer reconnection after updates complete
                shouldReconnectObserver = false;
                this.calculateAndDisplayTotalProfit(totalDiv, actionsToCalculate, totalText, queueMenu);
            }
        } catch (error) {
            console.error('[MWI Tools] Error injecting queue times:', error);
        } finally {
            // Reconnect observer only if async didn't take over
            if (shouldReconnectObserver && this.queueMenuObserver) {
                this.queueMenuObserver.observe(queueMenu, {
                    childList: true,
                    subtree: true,
                });
            }
        }
    }

    /**
     * Calculate and display total profit asynchronously (non-blocking)
     * @param {HTMLElement} totalDiv - The total display div element
     * @param {Array} actionsToCalculate - Array of {actionHrid, timeSeconds, count, actualAttempts, divIndex} objects
     * @param {string} baseText - Base text (time) to prepend
     * @param {HTMLElement} queueMenu - Queue menu element to reconnect observer after updates
     */
    async calculateAndDisplayTotalProfit(totalDiv, actionsToCalculate, baseText, queueMenu) {
        // Generate unique ID for this calculation to prevent race conditions
        const calculationId = Date.now() + Math.random();
        this.activeProfitCalculationId = calculationId;

        try {
            let totalProfit = 0;
            let hasProfitData = false;

            // Create all profit calculation promises at once (parallel execution)
            const profitPromises = actionsToCalculate.map(
                (action) =>
                    Promise.race([
                        this.calculateProfitForAction(action),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500)),
                    ]).catch(() => null) // Convert rejections to null
            );

            // Wait for all calculations to complete in parallel
            const results = await Promise.allSettled(profitPromises);

            // Check if this calculation is still valid (character might have switched)
            if (this.activeProfitCalculationId !== calculationId) {
                console.log('[Action Time Display] Profit calculation cancelled (character switched)');
                return;
            }

            // Aggregate results and update individual action profit displays
            results.forEach((result, index) => {
                const actionProfit = result.status === 'fulfilled' && result.value !== null ? result.value : null;

                if (actionProfit !== null) {
                    totalProfit += actionProfit;
                    hasProfitData = true;

                    // Update individual action's profit display
                    const action = actionsToCalculate[index];
                    if (action.divIndex !== undefined) {
                        const profitDiv = document.querySelector(
                            `.mwi-queue-action-profit[data-div-index="${action.divIndex}"]`
                        );
                        if (profitDiv) {
                            const profitColor =
                                actionProfit >= 0
                                    ? config.getSettingValue('color_profit', '#4ade80')
                                    : config.getSettingValue('color_loss', '#f87171');
                            const profitSign = actionProfit >= 0 ? '+' : '';
                            profitDiv.innerHTML = `Profit: <span style="color: ${profitColor};">${profitSign}${formatWithSeparator(Math.round(actionProfit))}</span>`;
                        }
                    }
                }
            });

            // Update display with value
            if (hasProfitData) {
                // Get value mode setting to determine label and color
                const valueMode = config.getSettingValue('actionQueue_valueMode', 'profit');
                const isEstimatedValue = valueMode === 'estimated_value';

                // Estimated value is always positive (revenue), so always use profit color
                // Profit can be negative, so use appropriate color
                const valueColor =
                    isEstimatedValue || totalProfit >= 0
                        ? config.getSettingValue('color_profit', '#4ade80')
                        : config.getSettingValue('color_loss', '#f87171');
                const valueSign = totalProfit >= 0 ? '+' : '';
                const valueLabel = isEstimatedValue ? 'Estimated value' : 'Total profit';
                const valueText = `<br>${valueLabel}: <span style="color: ${valueColor};">${valueSign}${formatWithSeparator(Math.round(totalProfit))}</span>`;
                totalDiv.innerHTML = baseText + valueText;
            }
        } catch (error) {
            console.warn('[Action Time Display] Error calculating total profit:', error);
        } finally {
            // CRITICAL: Reconnect mutation observer after ALL DOM updates are complete
            // This prevents infinite loop by ensuring observer only reconnects once all profit divs are updated
            if (this.queueMenuObserver && queueMenu) {
                this.queueMenuObserver.observe(queueMenu, {
                    childList: true,
                    subtree: true,
                });
            }
        }
    }

    /**
     * Calculate profit or estimated value for a single action based on action count
     * @param {Object} action - Action object with {actionHrid, timeSeconds, count, actualAttempts}
     * @returns {Promise<number|null>} Total value (profit or revenue) or null if unavailable
     */
    async calculateProfitForAction(action) {
        const actionDetails = dataManager.getActionDetails(action.actionHrid);
        if (!actionDetails) {
            return null;
        }

        const valueMode = config.getSettingValue('actionQueue_valueMode', 'profit');

        // Get profit data (already has profitPerAction calculated)
        let profitData = null;
        const gatheringProfit = await calculateGatheringProfit(action.actionHrid);
        if (gatheringProfit) {
            profitData = gatheringProfit;
        } else if (actionDetails.outputItems?.[0]?.itemHrid) {
            profitData = await profitCalculator.calculateProfit(actionDetails.outputItems[0].itemHrid);
        }

        if (!profitData) {
            return null;
        }

        const attemptsForValue = action.actualAttempts ?? action.count ?? 0;
        if (!attemptsForValue) {
            return 0;
        }

        if (typeof profitData.actionsPerHour !== 'number') {
            return null;
        }

        const breakdown = calculateQueueProfitBreakdown({
            profitPerHour: profitData.profitPerHour,
            actionsPerHour: profitData.actionsPerHour,
            actionCount: attemptsForValue,
            revenuePerHour: profitData.revenuePerHour,
            valueMode,
        });

        return breakdown.totalProfit;
    }

    /**
     * Disable the action time display (cleanup)
     */
    disable() {
        // Disconnect action name observer
        if (this.actionNameObserver) {
            this.actionNameObserver.disconnect();
            this.actionNameObserver = null;
        }

        // Disconnect queue menu observer
        if (this.queueMenuObserver) {
            this.queueMenuObserver.disconnect();
            this.queueMenuObserver = null;
        }

        // Unregister queue observer
        if (this.unregisterQueueObserver) {
            this.unregisterQueueObserver();
            this.unregisterQueueObserver = null;
        }

        // Unregister character switch handler
        if (this.characterInitHandler) {
            dataManager.off('character_initialized', this.characterInitHandler);
            this.characterInitHandler = null;
        }

        // Clear update timer
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }

        // Clear appended stats from game's action name div
        const actionNameElement = document.querySelector('div[class*="Header_actionName"]');
        if (actionNameElement) {
            this.clearAppendedStats(actionNameElement);
        }

        // Remove display element
        if (this.displayElement && this.displayElement.parentNode) {
            this.displayElement.parentNode.removeChild(this.displayElement);
            this.displayElement = null;
        }

        this.isInitialized = false;
    }
}

// Create and export singleton instance
const actionTimeDisplay = new ActionTimeDisplay();

export default actionTimeDisplay;
