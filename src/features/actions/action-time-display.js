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
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import { parseTeaEfficiency, getDrinkConcentration, parseActionLevelBonus } from '../../utils/tea-parser.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { timeReadable } from '../../utils/formatters.js';
import { stackAdditive } from '../../utils/efficiency.js';

/**
 * ActionTimeDisplay class manages the time display panel
 */
class ActionTimeDisplay {
    constructor() {
        this.displayElement = null;
        this.isInitialized = false;
        this.updateTimer = null;
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
            console.log('[ActionTimeDisplay] Feature disabled in settings');
            return;
        }

        // Wait for action name element to exist
        this.waitForActionPanel();

        // Listen to action updates
        dataManager.on('actions_updated', () => this.updateDisplay());
        dataManager.on('action_completed', () => this.updateDisplay());

        this.isInitialized = true;
        console.log('[ActionTimeDisplay] Initialized');
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

        console.log('[ActionTimeDisplay] Display panel created');
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

        // Get queue size
        const queueSize = action.hasMaxCount ? action.maxCount : action.currentCount;

        // Calculate total actions needed (accounting for efficiency)
        // Efficiency repeats the action, so we need fewer queue items
        const efficiencyMultiplier = 1 + (totalEfficiency / 100);
        const actualActionsNeeded = queueSize / efficiencyMultiplier;

        // Calculate total time
        const totalTimeSeconds = actualActionsNeeded * actionTime;

        // Calculate completion time
        const completionTime = new Date();
        completionTime.setSeconds(completionTime.getSeconds() + totalTimeSeconds);

        // Format time strings
        const timeStr = totalTimeSeconds >= 86400
            ? `${(totalTimeSeconds / 86400).toFixed(1)} days`
            : timeReadable(totalTimeSeconds);

        const clockTime = `${String(completionTime.getHours()).padStart(2, '0')}:${String(completionTime.getMinutes()).padStart(2, '0')}:${String(completionTime.getSeconds()).padStart(2, '0')}`;

        // Build display HTML
        const lines = [];

        // Action info
        const actionName = actionDetails.name || 'Unknown Action';
        lines.push(`<span style="color: var(--text-color-primary, #fff);">${actionName}</span>`);

        // Queue size
        if (action.hasMaxCount) {
            lines.push(` <span style="color: var(--text-color-secondary, #888);">(${queueSize} queued)</span>`);
        } else {
            lines.push(` <span style="color: var(--text-color-secondary, #888);">(∞)</span>`);
        }

        // Only show time info if we have a finite queue
        if (action.hasMaxCount) {
            lines.push('<br>');

            // Time per action and actions/hour on same line (simplified - no percentages)
            lines.push(`<span style="color: var(--text-color-secondary, #888);">`);
            lines.push(`${actionTime.toFixed(1)}s/action · ${actionsPerHour.toFixed(0)}/hr`);
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
}

// Create and export singleton instance
const actionTimeDisplay = new ActionTimeDisplay();

export default actionTimeDisplay;
