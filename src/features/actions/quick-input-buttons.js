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
import { timeReadable, formatWithSeparator } from '../../utils/formatters.js';
import { calculateExperienceMultiplier } from '../../utils/experience-parser.js';

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
     * Create a collapsible section
     * @param {string} id - Unique ID for the section
     * @param {string} icon - Icon/emoji for the section
     * @param {string} title - Section title
     * @param {string} summary - Summary text (shown when collapsed)
     * @param {HTMLElement} content - Content element to show/hide
     * @param {boolean} defaultOpen - Whether section starts open
     * @returns {HTMLElement} Section container
     */
    createCollapsibleSection(id, icon, title, summary, content, defaultOpen = true) {
        const section = document.createElement('div');
        section.className = 'mwi-collapsible-section';
        section.style.cssText = `
            margin-top: 8px;
            margin-bottom: 8px;
        `;

        // Create header
        const header = document.createElement('div');
        header.className = 'mwi-section-header';
        header.style.cssText = `
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            padding: 4px 0;
            color: var(--text-color-primary, #fff);
            font-weight: 500;
        `;

        const arrow = document.createElement('span');
        arrow.textContent = defaultOpen ? '▼' : '▶';
        arrow.style.cssText = `
            margin-right: 6px;
            font-size: 0.7em;
            transition: transform 0.2s;
        `;

        const label = document.createElement('span');
        label.textContent = `${icon} ${title}`;

        header.appendChild(arrow);
        header.appendChild(label);

        // Create summary (shown when collapsed)
        const summaryDiv = document.createElement('div');
        summaryDiv.style.cssText = `
            margin-left: 16px;
            margin-top: 2px;
            color: var(--text-color-secondary, #888);
            font-size: 0.9em;
            display: ${defaultOpen ? 'none' : 'block'};
        `;
        if (summary) {
            summaryDiv.textContent = summary;
        }

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'mwi-section-content';
        contentWrapper.style.cssText = `
            display: ${defaultOpen ? 'block' : 'none'};
            margin-left: 16px;
            margin-top: 4px;
        `;
        contentWrapper.appendChild(content);

        // Toggle functionality
        header.addEventListener('click', () => {
            const isOpen = contentWrapper.style.display === 'block';
            contentWrapper.style.display = isOpen ? 'none' : 'block';
            if (summary) {
                summaryDiv.style.display = isOpen ? 'block' : 'none';
            }
            arrow.textContent = isOpen ? '▶' : '▼';
        });

        section.appendChild(header);
        if (summary) {
            section.appendChild(summaryDiv);
        }
        section.appendChild(contentWrapper);

        return section;
    }

    /**
     * Inject quick input buttons into action panel
     * @param {HTMLElement} panel - Action panel element
     */
    injectButtons(panel) {
        try {
            // Check if already injected
            if (panel.querySelector('.mwi-collapsible-section')) {
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

            // Get equipment details for display
            const equipment = dataManager.getEquipment();
            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

            // Calculate speed breakdown
            const baseTime = actionDetails.baseTimeCost / 1e9;
            const speedBonus = parseEquipmentSpeedBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );

            // ===== SECTION 1: Action Speed & Time =====
            const speedContent = document.createElement('div');
            speedContent.style.cssText = `
                color: var(--text-color-secondary, #888);
                font-size: 0.9em;
                line-height: 1.6;
            `;

            const speedLines = [];
            speedLines.push(`Base: ${baseTime.toFixed(2)}s → ${actionTime.toFixed(2)}s`);
            if (speedBonus > 0) {
                speedLines.push(`Speed: +${(speedBonus * 100).toFixed(1)}% | ${(3600 / actionTime).toFixed(0)}/hr`);
            } else {
                speedLines.push(`${(3600 / actionTime).toFixed(0)}/hr`);
            }

            // Total time (dynamic)
            const totalTimeLine = document.createElement('div');
            totalTimeLine.style.cssText = `
                color: var(--text-color-main, #6fb8e8);
                font-weight: 500;
                margin-top: 4px;
            `;

            const updateTotalTime = () => {
                const inputValue = numberInput.value;

                if (inputValue === '∞') {
                    totalTimeLine.textContent = 'Total time: ∞';
                    return;
                }

                const queueCount = parseInt(inputValue) || 0;
                if (queueCount > 0) {
                    // Input is number of ACTIONS, not items
                    // Total time = actions × time per action
                    const totalSeconds = queueCount * actionTime;
                    totalTimeLine.textContent = `Total time: ${timeReadable(totalSeconds)}`;
                } else {
                    totalTimeLine.textContent = 'Total time: 0s';
                }
            };

            speedLines.push(''); // Empty line before total time
            speedContent.innerHTML = speedLines.join('<br>');
            speedContent.appendChild(totalTimeLine);

            // Initial update
            updateTotalTime();

            // Watch for input changes
            const inputObserver = new MutationObserver(() => {
                updateTotalTime();
            });

            inputObserver.observe(numberInput, {
                attributes: true,
                attributeFilter: ['value']
            });

            numberInput.addEventListener('input', updateTotalTime);
            numberInput.addEventListener('change', updateTotalTime);
            panel.addEventListener('click', () => {
                setTimeout(updateTotalTime, 50);
            });

            // Create initial summary for Action Speed & Time
            const actionsPerHour = (3600 / actionTime).toFixed(0);
            const initialSummary = `${actionsPerHour}/hr | Total time: 0s`;

            const speedSection = this.createCollapsibleSection(
                'speed-time',
                '⏱',
                'Action Speed & Time',
                initialSummary,
                speedContent,
                false // Collapsed by default
            );

            // Get the summary div to update it dynamically
            const speedSummaryDiv = speedSection.querySelector('.mwi-section-header + div');

            // Enhanced updateTotalTime to also update the summary
            const originalUpdateTotalTime = updateTotalTime;
            const enhancedUpdateTotalTime = () => {
                originalUpdateTotalTime();

                // Update summary when collapsed
                if (speedSummaryDiv) {
                    const inputValue = numberInput.value;
                    if (inputValue === '∞') {
                        speedSummaryDiv.textContent = `${actionsPerHour}/hr | Total time: ∞`;
                    } else {
                        const queueCount = parseInt(inputValue) || 0;
                        if (queueCount > 0) {
                            const totalSeconds = queueCount * actionTime;
                            speedSummaryDiv.textContent = `${actionsPerHour}/hr | Total time: ${timeReadable(totalSeconds)}`;
                        } else {
                            speedSummaryDiv.textContent = `${actionsPerHour}/hr | Total time: 0s`;
                        }
                    }
                }
            };

            // Replace all updateTotalTime calls with enhanced version
            inputObserver.disconnect();
            inputObserver.observe(numberInput, {
                attributes: true,
                attributeFilter: ['value']
            });

            const newInputObserver = new MutationObserver(() => {
                enhancedUpdateTotalTime();
            });
            newInputObserver.observe(numberInput, {
                attributes: true,
                attributeFilter: ['value']
            });

            numberInput.removeEventListener('input', updateTotalTime);
            numberInput.removeEventListener('change', updateTotalTime);
            numberInput.addEventListener('input', enhancedUpdateTotalTime);
            numberInput.addEventListener('change', enhancedUpdateTotalTime);

            panel.removeEventListener('click', () => {
                setTimeout(updateTotalTime, 50);
            });
            panel.addEventListener('click', () => {
                setTimeout(enhancedUpdateTotalTime, 50);
            });

            // Initial update with enhanced version
            enhancedUpdateTotalTime();

            // ===== SECTION 2: Level Progress =====
            const levelProgressSection = this.createLevelProgressSection(
                actionDetails,
                actionTime
            );

            // ===== SECTION 3: Quick Queue Setup =====
            const queueContent = document.createElement('div');
            queueContent.style.cssText = `
                color: var(--text-color-secondary, #888);
                font-size: 0.9em;
                margin-top: 8px;
                margin-bottom: 8px;
            `;

            // FIRST ROW: Time-based buttons (hours)
            queueContent.appendChild(document.createTextNode('Do '));

            this.presetHours.forEach(hours => {
                const button = this.createButton(hours === 0.5 ? '0.5' : hours.toString(), () => {
                    // How many actions fit in X hours?
                    // Time (seconds) = hours × 3600
                    // Actions = Time / actionTime
                    const actionCount = Math.round((hours * 60 * 60) / actionTime);
                    this.setInputValue(numberInput, actionCount);
                });
                queueContent.appendChild(button);
            });

            queueContent.appendChild(document.createTextNode(' hours'));
            queueContent.appendChild(document.createElement('div')); // Line break

            // SECOND ROW: Count-based buttons (times)
            queueContent.appendChild(document.createTextNode('Do '));

            this.presetValues.forEach(value => {
                const button = this.createButton(value.toLocaleString(), () => {
                    this.setInputValue(numberInput, value);
                });
                queueContent.appendChild(button);
            });

            const maxButton = this.createButton('Max', () => {
                const maxValue = this.calculateMaxValue(panel);
                if (maxValue > 0) {
                    this.setInputValue(numberInput, maxValue);
                }
            });
            queueContent.appendChild(maxButton);

            queueContent.appendChild(document.createTextNode(' times'));

            // Insert sections: inputContainer -> queueContent -> speedSection -> levelProgressSection
            inputContainer.insertAdjacentElement('afterend', queueContent);
            queueContent.insertAdjacentElement('afterend', speedSection);
            if (levelProgressSection) {
                speedSection.insertAdjacentElement('afterend', levelProgressSection);
            }

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

    /**
     * Create level progress section
     * @param {Object} actionDetails - Action details from game data
     * @param {number} actionTime - Time per action in seconds
     * @returns {HTMLElement|null} Level progress section or null if not applicable
     */
    createLevelProgressSection(actionDetails, actionTime) {
        try {
            // Get XP information from action
            const experienceGain = actionDetails.experienceGain;
            if (!experienceGain || !experienceGain.skillHrid || experienceGain.value <= 0) {
                return null; // No XP gain for this action
            }

            const skillHrid = experienceGain.skillHrid;
            const xpPerAction = experienceGain.value;

            // Get character skills
            const skills = dataManager.getSkills();
            if (!skills) {
                return null;
            }

            // Find the skill
            const skill = skills.find(s => s.skillHrid === skillHrid);
            if (!skill) {
                return null;
            }

            // Get level experience table
            const gameData = dataManager.getInitClientData();
            const levelExperienceTable = gameData?.levelExperienceTable;
            if (!levelExperienceTable) {
                return null;
            }

            // Current level and XP
            const currentLevel = skill.level;
            const currentXP = skill.experience || 0;

            // XP needed for next level
            const nextLevel = currentLevel + 1;
            const xpForNextLevel = levelExperienceTable[nextLevel];

            if (!xpForNextLevel) {
                // Max level reached
                return null;
            }

            // Calculate progress (XP gained this level / XP needed for this level)
            const xpForCurrentLevel = levelExperienceTable[currentLevel] || 0;
            const xpGainedThisLevel = currentXP - xpForCurrentLevel;
            const xpNeededThisLevel = xpForNextLevel - xpForCurrentLevel;
            const progressPercent = (xpGainedThisLevel / xpNeededThisLevel) * 100;
            const xpNeeded = xpForNextLevel - currentXP;

            // Calculate XP multipliers and breakdown (MUST happen before calculating actions/rates)
            const xpData = calculateExperienceMultiplier(skillHrid, actionDetails.type);

            // Calculate modified XP per action (base XP × multiplier)
            const baseXP = xpPerAction;
            const modifiedXP = xpPerAction * xpData.totalMultiplier;

            // Calculate actions and time needed (using modified XP)
            const actionsNeeded = Math.ceil(xpNeeded / modifiedXP);
            const timeNeeded = actionsNeeded * actionTime;

            // Calculate rates (using modified XP)
            const actionsPerHour = 3600 / actionTime;
            const xpPerHour = actionsPerHour * modifiedXP;
            const xpPerDay = xpPerHour * 24;

            // Calculate daily level progress
            const dailyLevelProgress = xpPerDay / xpNeededThisLevel;

            // Create content
            const content = document.createElement('div');
            content.style.cssText = `
                color: var(--text-color-secondary, #888);
                font-size: 0.9em;
                line-height: 1.6;
            `;

            const lines = [];

            // Current level and progress
            lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(1)}% to Level ${nextLevel}`);
            lines.push('');

            // Action details
            lines.push(`XP per action: ${formatWithSeparator(baseXP.toFixed(1))} base → ${formatWithSeparator(modifiedXP.toFixed(1))} (×${xpData.totalMultiplier.toFixed(2)})`);

            // XP breakdown (if any bonuses exist)
            if (xpData.totalWisdom > 0 || xpData.charmExperience > 0) {
                const totalXPBonus = xpData.totalWisdom + xpData.charmExperience;
                lines.push(`  Total XP Bonus: +${totalXPBonus.toFixed(1)}%`);

                // List all sources that contribute

                // Equipment skill-specific XP (e.g., Celestial Shears foragingExperience)
                if (xpData.charmBreakdown && xpData.charmBreakdown.length > 0) {
                    for (const item of xpData.charmBreakdown) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(1)}%`);
                    }
                }

                // Equipment wisdom (e.g., Philosopher's Necklace skillingExperience)
                if (xpData.breakdown.equipmentWisdom > 0) {
                    lines.push(`    • Philosopher's Equipment: +${xpData.breakdown.equipmentWisdom.toFixed(1)}%`);
                }

                // House rooms
                if (xpData.breakdown.houseWisdom > 0) {
                    lines.push(`    • House Rooms: +${xpData.breakdown.houseWisdom.toFixed(1)}%`);
                }

                // Community buff
                if (xpData.breakdown.communityWisdom > 0) {
                    lines.push(`    • Community Buff: +${xpData.breakdown.communityWisdom.toFixed(1)}%`);
                }

                // Tea/Coffee
                if (xpData.breakdown.consumableWisdom > 0) {
                    lines.push(`    • Wisdom Tea: +${xpData.breakdown.consumableWisdom.toFixed(1)}%`);
                }
            }

            lines.push('');
            lines.push(`Actions to level: ${formatWithSeparator(actionsNeeded)} actions`);
            lines.push(`Time to level: ${timeReadable(timeNeeded)}`);
            lines.push(`XP/hour: ${formatWithSeparator(Math.round(xpPerHour))} | XP/day: ${formatWithSeparator(Math.round(xpPerDay))}`);

            content.innerHTML = lines.join('<br>');

            // Create summary for collapsed view (time to next level)
            const summary = `${timeReadable(timeNeeded)} to Level ${nextLevel}`;

            // Create collapsible section
            return this.createCollapsibleSection(
                'level-progress',
                '📈',
                'Level Progress',
                summary,
                content,
                false // Collapsed by default
            );
        } catch (error) {
            console.error('[MWI Tools] Error creating level progress section:', error);
            return null;
        }
    }
}

// Create and export singleton instance
const quickInputButtons = new QuickInputButtons();

export default quickInputButtons;
