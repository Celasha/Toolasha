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

        // Wait for action name element to exist
        this.waitForActionPanel();

        // Listen to action updates
        dataManager.on('actions_updated', () => this.updateDisplay());
        dataManager.on('action_completed', () => this.updateDisplay());

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
            }
        );
    }

    /**
     * Wait for action panel to exist in DOM
     */
    async waitForActionPanel() {
        // Try to find action name element
        const actionNameElement = document.querySelector('div.Header_actionName__31-L2');

        if (actionNameElement) {
            this.createDisplayPanel();
            this.updateDisplay();
        } else {
            // Not found, try again in 200ms
            setTimeout(() => this.waitForActionPanel(), 200);
        }
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

        // Get current actions
        const currentActions = dataManager.getCurrentActions();
        if (!currentActions || currentActions.length === 0) {
            this.displayElement.innerHTML = '';
            return;
        }

        // Get first action (currently executing)
        const action = currentActions[0];
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
        const queueSizeDisplay = action.hasMaxCount ? action.maxCount : Infinity;

        // Get remaining actions for time calculation
        const remainingActions = action.hasMaxCount
            ? (action.maxCount - action.currentCount)
            : Infinity;

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
        if (action.hasMaxCount) {
            lines.push(` <span style="color: var(--text-color-secondary, #888);">(${queueSizeDisplay.toLocaleString()} queued)</span>`);
        } else {
            lines.push(` <span style="color: var(--text-color-secondary, #888);">(∞)</span>`);
        }

        // Only show time info if we have a finite queue
        if (action.hasMaxCount) {
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

            // First, calculate time for current action (index 0) to include in total
            // but don't display it in the queue tooltip
            if (currentActions.length > 0) {
                const currentAction = currentActions[0];
                const actionDetails = dataManager.getActionDetails(currentAction.actionHrid);

                if (!actionDetails) {
                    console.warn('[Action Time Display] Unknown action:', currentAction.actionHrid);
                    // Continue processing other actions in queue
                } else {
                    const count = currentAction.maxCount - currentAction.currentCount;
                    const isInfinite = count === 0 || currentAction.actionHrid.includes('/combat/');

                    if (isInfinite) {
                        hasInfinite = true;
                    } else {
                        const timeData = this.calculateActionTime(actionDetails);
                        if (timeData) {
                            const { actionTime } = timeData;
                            // Efficiency doesn't affect time - queue count is ACTIONS, not outputs
                            const totalTime = count * actionTime;
                            accumulatedTime += totalTime;
                        }
                    }
                }
            }

            // Now process queued actions (starting from index 1)
            // Map to actionDivs (which only show queued items, not current)
            for (let i = 1; i < currentActions.length; i++) {
                const actionObj = currentActions[i];
                const divIndex = i - 1; // Queue divs are offset by 1 (no div for current action)

                if (divIndex >= actionDivs.length) break;

                const actionDetails = dataManager.getActionDetails(actionObj.actionHrid);
                if (!actionDetails) {
                    console.warn('[Action Time Display] Unknown queued action:', actionObj.actionHrid);

                    // Show unknown action in tooltip
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'mwi-queue-action-time';
                    timeDiv.style.cssText = `
                        color: var(--text-color-secondary, #888);
                        font-size: 0.85em;
                        margin-top: 2px;
                    `;
                    timeDiv.textContent = '[Unknown action]';

                    // Find the actionText container and append inside it
                    const actionTextContainer = actionDivs[divIndex].querySelector('[class*="QueuedActions_actionText"]');
                    if (actionTextContainer) {
                        actionTextContainer.appendChild(timeDiv);
                    } else {
                        // Fallback: append to action div
                        actionDivs[divIndex].appendChild(timeDiv);
                    }

                    continue; // Skip time calculation for this action
                }

                // Calculate count remaining
                const count = actionObj.maxCount - actionObj.currentCount;
                const isInfinite = count === 0 || actionObj.actionHrid.includes('/combat/');

                if (isInfinite) {
                    hasInfinite = true;
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
                const actionTextContainer = actionDivs[divIndex].querySelector('[class*="QueuedActions_actionText"]');
                if (actionTextContainer) {
                    actionTextContainer.appendChild(timeDiv);
                } else {
                    // Fallback: append to action div
                    actionDivs[divIndex].appendChild(timeDiv);
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
        // Unregister queue observer
        if (this.unregisterQueueObserver) {
            this.unregisterQueueObserver();
            this.unregisterQueueObserver = null;
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

        // Remove event listeners (DataManager cleanup)
        dataManager.off('actions_updated');
        dataManager.off('action_completed');

        this.isInitialized = false;
    }
}

// Create and export singleton instance
const actionTimeDisplay = new ActionTimeDisplay();

export default actionTimeDisplay;
