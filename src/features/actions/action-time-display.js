/**
 * Action Time Display Module
 *
 * Displays estimated completion time for queued actions in a dedicated panel.
 * Uses WebSocket data from data-manager instead of DOM scraping.
 *
 * Features:
 * - Shows current action with queue count
 * - Displays time per action (with speed breakdown)
 * - Shows actions per hour (with efficiency)
 * - Estimates total time remaining
 * - Shows estimated completion time (clock format)
 * - Updates automatically on action changes
 * - Queue tooltip enhancement (time for each action + total)
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import { parseTeaEfficiency, getDrinkConcentration, parseActionLevelBonus } from '../../utils/tea-parser.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { timeReadable } from '../../utils/formatters.js';
import { stackAdditive } from '../../utils/efficiency.js';
import domObserver from '../../core/dom-observer.js';

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
                    this.injectQueueTimes(queueMenu);

                    // Reconnect to continue watching
                    this.queueMenuObserver.observe(queueMenu, {
                        childList: true,
                        subtree: true
                    });
                });

                this.queueMenuObserver.observe(queueMenu, {
                    childList: true,
                    subtree: true
                });
            }
        );
    }

    /**
     * Handle character switch
     * Clean up old observers and re-initialize for new character's action panel
     */
    handleCharacterSwitch() {
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
        // Try to find action name element
        const actionNameElement = document.querySelector('div.Header_actionName__31-L2');

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
            subtree: true
        });
    }

    /**
     * Create the display panel in the DOM
     */
    createDisplayPanel() {
        if (this.displayElement) {
            return; // Already created
        }

        // Find the action name container
        const actionNameContainer = document.querySelector('div.Header_actionName__31-L2');
        if (!actionNameContainer) {
            return;
        }

        // Create display element
        this.displayElement = document.createElement('div');
        this.displayElement.id = 'mwi-action-time-display';
        this.displayElement.style.cssText = `
            font-size: 0.9em;
            color: var(--text-color-secondary, #888);
            margin-top: 2px;
            line-height: 1.4;
            text-align: left;
        `;

        // Insert after action name
        actionNameContainer.parentNode.insertBefore(
            this.displayElement,
            actionNameContainer.nextSibling
        );

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
        const actionNameElement = document.querySelector('div.Header_actionName__31-L2');
        if (!actionNameElement || !actionNameElement.textContent) {
            this.displayElement.innerHTML = '';
            return;
        }

        // Parse action name from DOM
        // Format can be: "Action Name (#123)", "Action Name (123)", "Action Name: Item (123)", etc.
        const actionNameText = actionNameElement.textContent.trim();

        // Extract inventory count from parentheses (e.g., "Coinify: Item (4312)" -> 4312)
        const inventoryCountMatch = actionNameText.match(/\((\d+)\)$/);
        const inventoryCount = inventoryCountMatch ? parseInt(inventoryCountMatch[1]) : null;

        // Find the matching action in cache
        const cachedActions = dataManager.getCurrentActions();
        let action;

        // Parse the action name, handling special formats like "Coinify: Item Name (count)"
        const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\(#?\d+\))?$/);
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

        // Match action from cache
        action = cachedActions.find(a => {
            const actionDetails = dataManager.getActionDetails(a.actionHrid);
            if (!actionDetails || actionDetails.name !== actionNameFromDom) {
                return false;
            }

            // If there's an item name (like "Foraging Essence" from "Coinify: Foraging Essence"),
            // we need to match on primaryItemHash
            if (itemNameFromDom && a.primaryItemHash) {
                // Convert display name to item HRID format (lowercase with underscores)
                const itemHrid = '/items/' + itemNameFromDom.toLowerCase().replace(/\s+/g, '_');
                return a.primaryItemHash.includes(itemHrid);
            }

            // No item name specified, just match on action name
            return true;
        });

        if (!action) {
            this.displayElement.innerHTML = '';
            return;
        }

        const actionDetails = dataManager.getActionDetails(action.actionHrid);
        if (!actionDetails) {
            return;
        }

        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

        // Calculate action time
        const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

        // Get equipment speed bonus
        const speedBonus = parseEquipmentSpeedBonuses(
            equipment,
            actionDetails.type,
            itemDetailMap
        );

        // Calculate actual action time (speed only)
        const actionTime = baseTime / (1 + speedBonus);
        const actionsPerHour = 3600 / actionTime;

        // Calculate efficiency
        const skillLevel = this.getSkillLevel(skills, actionDetails.type);
        const baseRequirement = actionDetails.levelRequirement?.level || 1;

        // Get drink concentration
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

        // Get active drinks for this action type
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

        // Calculate Action Level bonus from teas
        const actionLevelBonus = parseActionLevelBonus(
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Calculate efficiency components
        const effectiveRequirement = baseRequirement + actionLevelBonus;
        const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);
        const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
        const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
            equipment,
            actionDetails.type,
            itemDetailMap
        );
        const teaEfficiency = parseTeaEfficiency(
            actionDetails.type,
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Total efficiency
        const totalEfficiency = stackAdditive(
            levelEfficiency,
            houseEfficiency,
            equipmentEfficiency,
            teaEfficiency
        );

        // Get queue size for display (total queued, doesn't change)
        // For infinite actions with inventory count, use that; otherwise use maxCount or Infinity
        let queueSizeDisplay;
        if (action.hasMaxCount) {
            queueSizeDisplay = action.maxCount;
        } else if (inventoryCount !== null) {
            queueSizeDisplay = inventoryCount;
        } else {
            queueSizeDisplay = Infinity;
        }

        // Get remaining actions for time calculation
        // For infinite actions, use inventory count if available
        let remainingActions;
        if (action.hasMaxCount) {
            remainingActions = action.maxCount - action.currentCount;
        } else if (inventoryCount !== null) {
            remainingActions = inventoryCount - action.currentCount;
        } else {
            remainingActions = Infinity;
        }

        // Calculate total time
        // Note: Efficiency does NOT reduce time - it only increases outputs
        // The queue count represents ACTIONS to perform, not outputs wanted
        const totalTimeSeconds = remainingActions * actionTime;

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
                hour12: true
            });
        } else {
            // Future date: Show date and time in 12-hour format
            clockTime = completionTime.toLocaleString('en-US', {
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        }

        // Build display HTML
        const lines = [];

        // Action icon (SVG sprite, matches game's icon display)
        const skillType = actionDetails.type; // e.g., "/action_types/milking"
        if (skillType) {
            // Extract skill name from type (e.g., "/action_types/milking" → "milking")
            const skillName = skillType.replace('/action_types/', '');

            // Get sprite URL from existing game SVG (to get correct hash)
            const existingSvg = document.querySelector('svg[role="img"] use[href*="skills_sprite"]');
            if (existingSvg) {
                const spriteUrl = existingSvg.getAttribute('href').split('#')[0]; // Get base URL with hash
                lines.push(`<svg role="img" aria-label="Icon" class="Icon_icon__2LtL_ Icon_tiny__nLKFY Icon_inline__1Idwv" width="20px" height="20px" style="vertical-align: middle; margin-right: 4px;"><use href="${spriteUrl}#${skillName}"></use></svg>`);
            }
        }

        // Action info
        const actionName = actionDetails.name || 'Unknown Action';
        lines.push(`<span style="color: var(--text-color-primary, #fff);">${actionName}</span>`);

        // Queue size (with thousand separators)
        if (queueSizeDisplay !== Infinity) {
            lines.push(` <span style="color: var(--text-color-secondary, #888);">(${queueSizeDisplay.toLocaleString()} queued)</span>`);
        } else {
            lines.push(` <span style="color: var(--text-color-secondary, #888);">(∞)</span>`);
        }

        // Show time info if we have a finite number of remaining actions
        // This includes both finite actions (hasMaxCount) and infinite actions with inventory count
        if (remainingActions !== Infinity && !isNaN(remainingActions) && remainingActions > 0) {
            lines.push('<br>');

            // Time per action and actions/hour on same line (simplified - no percentages)
            lines.push(`<span style="color: var(--text-color-secondary, #888);">`);
            lines.push(`${actionTime.toFixed(2)}s/action · ${actionsPerHour.toFixed(0)}/hr`);
            lines.push('</span><br>');

            // Total time and completion time
            lines.push(`<span style="color: var(--text-color-primary, #fff);">`);
            lines.push(`⏱ ${timeStr} → ${clockTime}`);
            lines.push('</span>');
        }

        this.displayElement.innerHTML = lines.join('');
    }

    /**
     * Get character skill level for a skill type
     * @param {Array} skills - Character skills array
     * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
     * @returns {number} Skill level
     */
    getSkillLevel(skills, skillType) {
        // Map action type to skill HRID
        const skillHrid = skillType.replace('/action_types/', '/skills/');
        const skill = skills.find(s => s.skillHrid === skillHrid);
        return skill?.level || 1;
    }

    /**
     * Calculate action time for a given action
     * @param {Object} actionDetails - Action details from data manager
     * @returns {Object} {actionTime, totalEfficiency} or null if calculation fails
     */
    calculateActionTime(actionDetails) {
        try {
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

            // Calculate base action time
            const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

            // Get equipment speed bonus
            const speedBonus = parseEquipmentSpeedBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate actual action time (speed only)
            const actionTime = baseTime / (1 + speedBonus);

            // Calculate efficiency for output calculations
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);
            const baseRequirement = actionDetails.levelRequirement?.level || 1;

            // Get drink concentration
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas
            const actionLevelBonus = parseActionLevelBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate efficiency components
            const effectiveRequirement = baseRequirement + actionLevelBonus;
            const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);
            const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
            const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );
            const teaEfficiency = parseTeaEfficiency(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Total efficiency
            const totalEfficiency = stackAdditive(
                levelEfficiency,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency
            );

            return { actionTime, totalEfficiency };
        } catch (error) {
            console.error('[MWI Tools] Error calculating action time:', error);
            return null;
        }
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

        // Get the text content (format: "#3Coinify: Foraging Essence" - no space after number!)
        const fullText = firstChildDiv.textContent.trim();

        // Remove position number: "#3Coinify: Foraging Essence" → "Coinify: Foraging Essence"
        // Note: No space after the number in the actual text
        const actionNameText = fullText.replace(/^#\d+/, '').trim();

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
        return cachedActions.find(a => {
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

            // Clear all existing time displays to prevent duplicates
            queueMenu.querySelectorAll('.mwi-queue-action-time').forEach(el => el.remove());
            const existingTotal = document.querySelector('#mwi-queue-total-time');
            if (existingTotal) {
                existingTotal.remove();
            }

            let accumulatedTime = 0;
            let hasInfinite = false;

            // First, calculate time for current action to include in total
            // Read from DOM to get the actual current action (not from cache)
            const actionNameElement = document.querySelector('div.Header_actionName__31-L2');
            if (actionNameElement && actionNameElement.textContent) {
                const actionNameText = actionNameElement.textContent.trim();

                // Parse action name (same logic as main display)
                const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\(#?\d+\))?$/);
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
                const currentAction = currentActions.find(a => {
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

                        if (isInfinite) {
                            hasInfinite = true;
                        } else {
                            const count = currentAction.maxCount - currentAction.currentCount;
                            const timeData = this.calculateActionTime(actionDetails);
                            if (timeData) {
                                const { actionTime } = timeData;
                                const totalTime = count * actionTime;
                                accumulatedTime += totalTime;
                            }
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
                        color: var(--text-color-secondary, #888);
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

                if (isInfinite) {
                    hasInfinite = true;
                }

                // Only calculate count for finite actions
                let count = 0;
                if (!isInfinite) {
                    count = actionObj.maxCount - actionObj.currentCount;
                }

                // Calculate action time
                const timeData = this.calculateActionTime(actionDetails);
                if (!timeData) continue;

                const { actionTime } = timeData;

                // Calculate total time for this action
                // Efficiency doesn't affect time - queue count is ACTIONS, not outputs
                let totalTime;
                if (isInfinite) {
                    totalTime = Infinity;
                } else {
                    totalTime = count * actionTime;
                    accumulatedTime += totalTime;
                }

                // Format completion time
                let completionText = '';
                if (!hasInfinite && !isInfinite) {
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
                    color: var(--text-color-secondary, #888);
                    font-size: 0.85em;
                    margin-top: 2px;
                `;

                if (isInfinite) {
                    timeDiv.textContent = '[∞]';
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
            }

            // Add total time at bottom (includes current action + all queued)
            const totalDiv = document.createElement('div');
            totalDiv.id = 'mwi-queue-total-time';
            totalDiv.style.cssText = `
                color: var(--text-color-primary, #fff);
                font-weight: bold;
                margin-top: 12px;
                padding: 8px;
                border-top: 1px solid var(--border-color, #444);
                text-align: center;
            `;

            if (hasInfinite) {
                totalDiv.textContent = 'Total time: [∞]';
            } else {
                totalDiv.textContent = `Total time: [${timeReadable(accumulatedTime)}]`;
            }

            // Insert after queue menu
            queueMenu.insertAdjacentElement('afterend', totalDiv);

        } catch (error) {
            console.error('[MWI Tools] Error injecting queue times:', error);
        }
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
