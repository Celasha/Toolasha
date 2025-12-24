/**
 * Quick Input Buttons Module
 *
 * Adds quick action buttons (10, 100, 1000, Max) to action panels
 * for fast queue input without manual typing.
 *
 * Features:
 * - Preset buttons: 10, 100, 1000
 * - Max button (fills to maximum inventory amount)
 * - Works on all action panels (gathering, production, combat)
 * - Uses React's internal _valueTracker for proper state updates
 * - Auto-detects input fields and injects buttons
 */

import dataManager from '../../core/data-manager.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import { parseTeaEfficiency, getDrinkConcentration, parseActionLevelBonus } from '../../utils/tea-parser.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { stackAdditive } from '../../utils/efficiency.js';
import { timeReadable } from '../../utils/formatters.js';

/**
 * QuickInputButtons class manages quick input button injection
 */
class QuickInputButtons {
    constructor() {
        this.isInitialized = false;
        this.observer = null;
        this.presetHours = [0.5, 1, 2, 3, 4, 5, 6, 10, 12, 24];
        this.presetValues = [10, 100, 1000];
    }

    /**
     * Initialize the quick input buttons feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        // Start observing for action panels
        this.startObserving();
        this.isInitialized = true;
    }

    /**
     * Start MutationObserver to detect action panels
     */
    startObserving() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // Look for main action detail panel (not sub-elements)
                    const actionPanel = node.querySelector?.('[class*="SkillActionDetail_skillActionDetail"]');
                    if (actionPanel) {
                        this.injectButtons(actionPanel);
                    } else if (node.className && typeof node.className === 'string' &&
                               node.className.includes('SkillActionDetail_skillActionDetail')) {
                        this.injectButtons(node);
                    }
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Inject quick input buttons into action panel
     * @param {HTMLElement} panel - Action panel element
     */
    injectButtons(panel) {
        try {
            // Check if already injected
            if (panel.querySelector('.mwi-quick-input-buttons')) {
                return;
            }

            // Find the number input field
            let numberInput = panel.querySelector('input[type="number"]');
            if (!numberInput) {
                // Try finding input within maxActionCountInput container
                const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
                if (inputContainer) {
                    numberInput = inputContainer.querySelector('input');
                }
            }
            if (!numberInput) {
                return;
            }

            // Get action details for time-based calculations
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!actionNameElement) {
                return;
            }

            const actionName = actionNameElement.textContent.trim();
            const actionDetails = this.getActionDetailsByName(actionName);
            if (!actionDetails) {
                return;
            }

            // Calculate action duration and efficiency
            const { actionTime, totalEfficiency } = this.calculateActionMetrics(actionDetails);
            const efficiencyMultiplier = 1 + (totalEfficiency / 100);

            // Find the container to insert after (same as original MWI Tools)
            const inputContainer = numberInput.parentNode.parentNode.parentNode;
            if (!inputContainer) {
                return;
            }

            // Create total time display div (inserted before buttons)
            const totalTimeDiv = document.createElement('div');
            totalTimeDiv.className = 'mwi-total-time-display';
            totalTimeDiv.style.cssText = `
                margin-top: 4px;
                margin-bottom: 4px;
                text-align: left;
                color: var(--text-color-main, #6fb8e8);
                font-weight: 500;
            `;

            // Function to update total time display
            const updateTotalTime = () => {
                const inputValue = numberInput.value;

                // Check for infinity (∞ symbol when infinity is selected)
                if (inputValue === '∞') {
                    totalTimeDiv.textContent = 'Total time: ∞';
                    return;
                }

                const queueCount = parseInt(inputValue) || 0;
                if (queueCount > 0) {
                    // Account for efficiency reducing actions needed
                    const actualActionsNeeded = queueCount / efficiencyMultiplier;
                    const totalSeconds = actualActionsNeeded * actionTime;
                    totalTimeDiv.textContent = `Total time: ${timeReadable(totalSeconds)}`;
                } else {
                    totalTimeDiv.textContent = 'Total time: 0s';
                }
            };

            // Initial update
            updateTotalTime();

            // Watch for input changes using MutationObserver (game uses attribute mutations)
            const inputObserver = new MutationObserver(() => {
                updateTotalTime();
            });

            inputObserver.observe(numberInput, {
                attributes: true,
                attributeFilter: ['value']
            });

            // Also listen to input/change events for manual typing
            numberInput.addEventListener('input', updateTotalTime);
            numberInput.addEventListener('change', updateTotalTime);

            // Listen to panel clicks (buttons, etc.)
            panel.addEventListener('click', () => {
                setTimeout(updateTotalTime, 50);
            });

            // Insert total time display
            inputContainer.insertAdjacentElement('afterend', totalTimeDiv);

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'mwi-quick-input-buttons';
            buttonContainer.style.cssText = `
                margin-top: 4px;
                margin-bottom: 4px;
                text-align: left;
                color: var(--text-color-secondary, #888);
            `;

            // FIRST ROW: Time-based buttons (hours)
            buttonContainer.appendChild(document.createTextNode('Do '));

            this.presetHours.forEach(hours => {
                const button = this.createButton(hours === 0.5 ? '0.5' : hours.toString(), () => {
                    // Calculate: (hours * 3600 seconds * efficiency) / action duration = number of actions
                    const actionCount = Math.round((hours * 60 * 60 * efficiencyMultiplier) / actionTime);
                    this.setInputValue(numberInput, actionCount);
                });
                buttonContainer.appendChild(button);
            });

            buttonContainer.appendChild(document.createTextNode(' hours'));

            // Line break between rows
            buttonContainer.appendChild(document.createElement('div'));

            // SECOND ROW: Count-based buttons (times)
            buttonContainer.appendChild(document.createTextNode('Do '));

            this.presetValues.forEach(value => {
                const button = this.createButton(value.toLocaleString(), () => {
                    this.setInputValue(numberInput, value);
                });
                buttonContainer.appendChild(button);
            });

            // Add Max button
            const maxButton = this.createButton('Max', () => {
                const maxValue = this.calculateMaxValue(panel);
                if (maxValue > 0) {
                    this.setInputValue(numberInput, maxValue);
                }
            });
            buttonContainer.appendChild(maxButton);

            buttonContainer.appendChild(document.createTextNode(' times'));

            // Insert buttons after total time display
            totalTimeDiv.insertAdjacentElement('afterend', buttonContainer);

        } catch (error) {
            console.error('[MWI Tools] Error injecting quick input buttons:', error);
        }
    }

    /**
     * Get action details by name
     * @param {string} actionName - Display name of the action
     * @returns {Object|null} Action details or null if not found
     */
    getActionDetailsByName(actionName) {
        const actionDetailMap = dataManager.getInitClientData()?.actionDetailMap;
        if (!actionDetailMap) {
            return null;
        }

        // Find action by matching name
        for (const [hrid, details] of Object.entries(actionDetailMap)) {
            if (details.name === actionName) {
                return details;
            }
        }

        return null;
    }

    /**
     * Calculate action time and efficiency for current character state
     * @param {Object} actionDetails - Action details from game data
     * @returns {Object} {actionTime, totalEfficiency}
     */
    calculateActionMetrics(actionDetails) {
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

        // Calculate actual action time (with speed)
        const actionTime = baseTime / (1 + speedBonus);

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

        return { actionTime, totalEfficiency };
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
     * Create a quick input button
     * @param {string} label - Button label
     * @param {Function} onClick - Click handler
     * @returns {HTMLElement} Button element
     */
    createButton(label, onClick) {
        const button = document.createElement('button');
        button.textContent = label;
        button.className = 'mwi-quick-input-btn';
        button.style.cssText = `
            background-color: white;
            color: black;
            padding: 1px 6px;
            margin: 1px;
            border: 1px solid #ccc;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.9em;
        `;

        // Hover effect
        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#f0f0f0';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'white';
        });

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        return button;
    }

    /**
     * Set input value using React's internal _valueTracker
     * This is the critical "hack" to make React recognize the change
     * @param {HTMLInputElement} input - Number input element
     * @param {number} value - Value to set
     */
    setInputValue(input, value) {
        // Save the current value
        const lastValue = input.value;

        // Set the new value directly on the DOM
        input.value = value;

        // Create input event
        const event = new Event('input', { bubbles: true });
        event.simulated = true;

        // This is the critical part: React stores an internal _valueTracker
        // We need to set it to the old value before dispatching the event
        // so React sees the difference and updates its state
        const tracker = input._valueTracker;
        if (tracker) {
            tracker.setValue(lastValue);
        }

        // Dispatch the event - React will now recognize the change
        input.dispatchEvent(event);

        // Focus the input to show the value
        input.focus();
    }

    /**
     * Calculate maximum possible value based on inventory
     * @param {HTMLElement} panel - Action panel element
     * @returns {number} Maximum value
     */
    calculateMaxValue(panel) {
        try {
            // For now, return a sensible default max (10000)
            // TODO: Calculate based on actual inventory/materials available
            return 10000;
        } catch (error) {
            console.error('[MWI Tools] Error calculating max value:', error);
            return 10000;
        }
    }
}

// Create and export singleton instance
const quickInputButtons = new QuickInputButtons();

export default quickInputButtons;
