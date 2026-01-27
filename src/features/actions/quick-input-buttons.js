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
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import {
    parseEquipmentSpeedBonuses,
    parseEquipmentEfficiencyBonuses,
    debugEquipmentSpeedBonuses,
} from '../../utils/equipment-parser.js';
import {
    parseArtisanBonus,
    getDrinkConcentration,
    parseActionLevelBonus,
    parseTeaEfficiencyBreakdown,
    parseTeaSkillLevelBonus,
} from '../../utils/tea-parser.js';
import { formatPercentage, timeReadable, formatWithSeparator } from '../../utils/formatters.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { stackAdditive } from '../../utils/efficiency.js';
import { calculateExperienceMultiplier } from '../../utils/experience-parser.js';
import { setReactInputValue } from '../../utils/react-input.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { calculateActionsPerHour } from '../../utils/profit-helpers.js';

/**
 * QuickInputButtons class manages quick input button injection
 */
class QuickInputButtons {
    constructor() {
        this.isInitialized = false;
        this.unregisterObserver = null;
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
     * Start observing for action panels using centralized observer
     */
    startObserving() {
        // Register with centralized DOM observer
        this.unregisterObserver = domObserver.onClass(
            'QuickInputButtons',
            'SkillActionDetail_skillActionDetail',
            (panel) => {
                this.injectButtons(panel);
            }
        );

        // Check for existing action panels that may already be open
        const existingPanels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');
        existingPanels.forEach((panel) => {
            this.injectButtons(panel);
        });
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

            // Find the number input field first to skip panels that don't have queue inputs
            // (Enhancing, Alchemy, etc.)
            let numberInput = panel.querySelector('input[type="number"]');
            if (!numberInput) {
                // Try finding input within maxActionCountInput container
                const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
                if (inputContainer) {
                    numberInput = inputContainer.querySelector('input');
                }
            }
            if (!numberInput) {
                // This is a panel type that doesn't have queue inputs (Enhancing, Alchemy, etc.)
                // Skip silently - not an error, just not applicable
                return;
            }

            // Cache game data once for all method calls
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                console.warn('[Quick Input Buttons] No game data available');
                return;
            }

            // Get action details for time-based calculations
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!actionNameElement) {
                console.warn('[Quick Input Buttons] No action name element found');
                return;
            }

            const actionName = actionNameElement.textContent.trim();
            const actionDetails = this.getActionDetailsByName(actionName, gameData);
            if (!actionDetails) {
                console.warn('[Quick Input Buttons] No action details found for:', actionName);
                return;
            }

            // Check if this action has normal XP gain (skip speed section for combat)
            const experienceGain = actionDetails.experienceGain;
            const hasNormalXP = experienceGain && experienceGain.skillHrid && experienceGain.value > 0;

            // Calculate action duration and efficiency
            const { actionTime, totalEfficiency, efficiencyBreakdown } = this.calculateActionMetrics(
                actionDetails,
                gameData
            );
            const efficiencyMultiplier = 1 + totalEfficiency / 100;

            // Find the container to insert after (same as original MWI Tools)
            const inputContainer = numberInput.parentNode.parentNode.parentNode;
            if (!inputContainer) {
                return;
            }

            // Get equipment details for display
            const equipment = dataManager.getEquipment();
            const itemDetailMap = gameData.itemDetailMap || {};

            // Calculate speed breakdown
            const baseTime = actionDetails.baseTimeCost / 1e9;
            const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);

            // ===== SECTION 1: Action Speed & Time (Skip for combat) =====
            let speedSection = null;

            if (hasNormalXP) {
                const speedContent = document.createElement('div');
                speedContent.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

                const speedLines = [];

                // Check if task speed applies (need to calculate before display)
                const isTaskAction = actionDetails.hrid && dataManager.isTaskAction(actionDetails.hrid);
                const taskSpeedBonus = isTaskAction ? dataManager.getTaskSpeedBonus() : 0;

                // Calculate intermediate time (after equipment speed, before task speed)
                const timeAfterEquipment = baseTime / (1 + speedBonus);

                speedLines.push(`Base: ${baseTime.toFixed(2)}s → ${timeAfterEquipment.toFixed(2)}s`);
                if (speedBonus > 0) {
                    speedLines.push(
                        `Speed: +${formatPercentage(speedBonus, 1)} | ${calculateActionsPerHour(timeAfterEquipment).toFixed(0)}/hr`
                    );
                } else {
                    speedLines.push(`${calculateActionsPerHour(timeAfterEquipment).toFixed(0)}/hr`);
                }

                // Add speed breakdown
                const speedBreakdown = this.calculateSpeedBreakdown(actionDetails, equipment, itemDetailMap);
                if (speedBreakdown.total > 0) {
                    // Equipment and tools (combined from debugEquipmentSpeedBonuses)
                    for (const item of speedBreakdown.equipmentAndTools) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        const detailText =
                            item.enhancementBonus > 0
                                ? ` (${formatPercentage(item.baseBonus, 1)} + ${formatPercentage(item.enhancementBonus * item.enhancementLevel, 1)})`
                                : '';
                        speedLines.push(
                            `  - ${item.itemName}${enhText}: +${formatPercentage(item.scaledBonus, 1)}${detailText}`
                        );
                    }

                    // Consumables
                    for (const item of speedBreakdown.consumables) {
                        const detailText =
                            item.drinkConcentration > 0
                                ? ` (${item.baseSpeed.toFixed(1)}% × ${(1 + item.drinkConcentration / 100).toFixed(2)})`
                                : '';
                        speedLines.push(`  - ${item.name}: +${item.speed.toFixed(1)}%${detailText}`);
                    }
                }

                // Task Speed section (multiplicative, separate from equipment speed)
                if (isTaskAction && taskSpeedBonus > 0) {
                    speedLines.push(''); // Empty line separator
                    speedLines.push(
                        `<span style="font-weight: 500;">Task Speed (multiplicative): +${taskSpeedBonus.toFixed(1)}%</span>`
                    );
                    speedLines.push(
                        `${timeAfterEquipment.toFixed(2)}s → ${actionTime.toFixed(2)}s | ${calculateActionsPerHour(actionTime).toFixed(0)}/hr`
                    );

                    // Find equipped task badge for details
                    const trinketSlot = equipment.get('/item_locations/trinket');
                    if (trinketSlot && trinketSlot.itemHrid) {
                        const itemDetails = itemDetailMap[trinketSlot.itemHrid];
                        if (itemDetails) {
                            const enhText = trinketSlot.enhancementLevel > 0 ? ` +${trinketSlot.enhancementLevel}` : '';

                            // Calculate breakdown
                            const baseTaskSpeed = itemDetails.equipmentDetail?.noncombatStats?.taskSpeed || 0;
                            const enhancementBonus =
                                itemDetails.equipmentDetail?.noncombatEnhancementBonuses?.taskSpeed || 0;
                            const enhancementLevel = trinketSlot.enhancementLevel || 0;

                            const detailText =
                                enhancementBonus > 0
                                    ? ` (${(baseTaskSpeed * 100).toFixed(1)}% + ${(enhancementBonus * enhancementLevel * 100).toFixed(1)}%)`
                                    : '';

                            speedLines.push(
                                `  - ${itemDetails.name}${enhText}: +${taskSpeedBonus.toFixed(1)}%${detailText}`
                            );
                        }
                    }
                }

                // Add Efficiency breakdown
                speedLines.push(''); // Empty line
                speedLines.push(
                    `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Efficiency: +${totalEfficiency.toFixed(1)}% → Output: ×${efficiencyMultiplier.toFixed(2)} (${Math.round(calculateActionsPerHour(actionTime) * efficiencyMultiplier)}/hr)</span>`
                );

                // Detailed efficiency breakdown
                if (
                    efficiencyBreakdown.levelEfficiency > 0 ||
                    (efficiencyBreakdown.actionLevelBreakdown && efficiencyBreakdown.actionLevelBreakdown.length > 0)
                ) {
                    // Calculate raw level delta (before any Action Level bonuses)
                    const rawLevelDelta = efficiencyBreakdown.skillLevel - efficiencyBreakdown.baseRequirement;

                    // Show final level efficiency
                    speedLines.push(`  - Level: +${efficiencyBreakdown.levelEfficiency.toFixed(1)}%`);

                    // Show raw level delta (what you'd get without Action Level bonuses)
                    speedLines.push(
                        `    - Raw level delta: +${rawLevelDelta.toFixed(1)}% (${efficiencyBreakdown.skillLevel} - ${efficiencyBreakdown.baseRequirement} base requirement)`
                    );

                    // Show Action Level bonus teas that reduce level efficiency
                    if (
                        efficiencyBreakdown.actionLevelBreakdown &&
                        efficiencyBreakdown.actionLevelBreakdown.length > 0
                    ) {
                        for (const tea of efficiencyBreakdown.actionLevelBreakdown) {
                            // Calculate impact: base tea effect reduces efficiency
                            const baseTeaImpact = -tea.baseActionLevel;
                            speedLines.push(
                                `    - ${tea.name} impact: ${baseTeaImpact.toFixed(1)}% (raises requirement)`
                            );

                            // Show DC contribution as additional reduction if > 0
                            if (tea.dcContribution > 0) {
                                const dcImpact = -tea.dcContribution;
                                speedLines.push(`      - Drink Concentration: ${dcImpact.toFixed(1)}%`);
                            }
                        }
                    }
                }
                if (efficiencyBreakdown.houseEfficiency > 0) {
                    // Get house room name
                    const houseRoomName = this.getHouseRoomName(actionDetails.type);
                    speedLines.push(
                        `  - House: +${efficiencyBreakdown.houseEfficiency.toFixed(1)}% (${houseRoomName})`
                    );
                }
                if (efficiencyBreakdown.equipmentEfficiency > 0) {
                    speedLines.push(`  - Equipment: +${efficiencyBreakdown.equipmentEfficiency.toFixed(1)}%`);
                }
                // Break out individual teas - show BASE efficiency on main line, DC as sub-line
                if (efficiencyBreakdown.teaBreakdown && efficiencyBreakdown.teaBreakdown.length > 0) {
                    for (const tea of efficiencyBreakdown.teaBreakdown) {
                        // Show BASE efficiency (without DC scaling) on main line
                        speedLines.push(`  - ${tea.name}: +${tea.baseEfficiency.toFixed(1)}%`);
                        // Show DC contribution as sub-line if > 0
                        if (tea.dcContribution > 0) {
                            speedLines.push(`    - Drink Concentration: +${tea.dcContribution.toFixed(1)}%`);
                        }
                    }
                }
                if (efficiencyBreakdown.communityEfficiency > 0) {
                    const communityBuffLevel = dataManager.getCommunityBuffLevel(
                        '/community_buff_types/production_efficiency'
                    );
                    speedLines.push(
                        `  - Community: +${efficiencyBreakdown.communityEfficiency.toFixed(1)}% (Production Efficiency T${communityBuffLevel})`
                    );
                }

                // Total time (dynamic)
                const totalTimeLine = document.createElement('div');
                totalTimeLine.style.cssText = `
                color: var(--text-color-main, ${config.COLOR_INFO});
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
                        // Input is number of ACTIONS to complete
                        // With efficiency, queued actions complete more quickly
                        // Calculate time-consuming actions needed
                        const baseActionsNeeded = Math.ceil(queueCount / efficiencyMultiplier);
                        const totalSeconds = baseActionsNeeded * actionTime;
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
                    attributeFilter: ['value'],
                });

                numberInput.addEventListener('input', updateTotalTime);
                numberInput.addEventListener('change', updateTotalTime);
                panel.addEventListener('click', () => {
                    setTimeout(updateTotalTime, 50);
                });

                // Create initial summary for Action Speed & Time
                const actionsPerHourWithEfficiency = Math.round(
                    calculateActionsPerHour(actionTime) * efficiencyMultiplier
                );
                const initialSummary = `${actionsPerHourWithEfficiency}/hr | Total time: 0s`;

                speedSection = createCollapsibleSection(
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
                            speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: ∞`;
                        } else {
                            const queueCount = parseInt(inputValue) || 0;
                            if (queueCount > 0) {
                                const baseActionsNeeded = Math.ceil(queueCount / efficiencyMultiplier);
                                const totalSeconds = baseActionsNeeded * actionTime;
                                speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: ${timeReadable(totalSeconds)}`;
                            } else {
                                speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: 0s`;
                            }
                        }
                    }
                };

                // Replace all updateTotalTime calls with enhanced version
                inputObserver.disconnect();
                inputObserver.observe(numberInput, {
                    attributes: true,
                    attributeFilter: ['value'],
                });

                const newInputObserver = new MutationObserver(() => {
                    enhancedUpdateTotalTime();
                });
                newInputObserver.observe(numberInput, {
                    attributes: true,
                    attributeFilter: ['value'],
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
            } // End hasNormalXP check - speedSection only created for non-combat

            // ===== SECTION 2: Level Progress =====
            const levelProgressSection = this.createLevelProgressSection(
                actionDetails,
                actionTime,
                gameData,
                numberInput
            );

            // ===== SECTION 3: Quick Queue Setup (Skip for combat) =====
            let queueContent = null;

            if (hasNormalXP) {
                queueContent = document.createElement('div');
                queueContent.style.cssText = `
                    color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                    font-size: 0.9em;
                    margin-top: 8px;
                    margin-bottom: 8px;
                `;

                // FIRST ROW: Time-based buttons (hours)
                queueContent.appendChild(document.createTextNode('Do '));

                this.presetHours.forEach((hours) => {
                    const button = this.createButton(hours === 0.5 ? '0.5' : hours.toString(), () => {
                        // How many actions fit in X hours?
                        // With efficiency, queued actions complete more quickly
                        // Time (seconds) = hours × 3600
                        // Time-consuming actions = Time / actionTime
                        // Queue count (actions) = Time-consuming actions × efficiencyMultiplier
                        // Round to whole number (input doesn't accept decimals)
                        const totalSeconds = hours * 60 * 60;
                        const baseActions = totalSeconds / actionTime;
                        const actionCount = Math.round(baseActions * efficiencyMultiplier);
                        this.setInputValue(numberInput, actionCount);
                    });
                    queueContent.appendChild(button);
                });

                queueContent.appendChild(document.createTextNode(' hours'));
                queueContent.appendChild(document.createElement('div')); // Line break

                // SECOND ROW: Count-based buttons (times)
                queueContent.appendChild(document.createTextNode('Do '));

                this.presetValues.forEach((value) => {
                    const button = this.createButton(value.toLocaleString(), () => {
                        this.setInputValue(numberInput, value);
                    });
                    queueContent.appendChild(button);
                });

                const maxButton = this.createButton('Max', () => {
                    const maxValue = this.calculateMaxValue(panel, actionDetails, gameData);
                    // Handle both infinity symbol and numeric values
                    if (maxValue === '∞' || maxValue > 0) {
                        this.setInputValue(numberInput, maxValue);
                    }
                });
                queueContent.appendChild(maxButton);

                queueContent.appendChild(document.createTextNode(' times'));
            } // End hasNormalXP check - queueContent only created for non-combat

            // Insert sections into DOM
            if (queueContent) {
                // Non-combat: Insert queueContent first
                inputContainer.insertAdjacentElement('afterend', queueContent);

                if (speedSection) {
                    queueContent.insertAdjacentElement('afterend', speedSection);
                    if (levelProgressSection) {
                        speedSection.insertAdjacentElement('afterend', levelProgressSection);
                    }
                } else if (levelProgressSection) {
                    queueContent.insertAdjacentElement('afterend', levelProgressSection);
                }
            } else if (levelProgressSection) {
                // Combat: Insert levelProgressSection directly after inputContainer
                inputContainer.insertAdjacentElement('afterend', levelProgressSection);
            }
        } catch (error) {
            console.error('[Toolasha] Error injecting quick input buttons:', error);
        }
    }

    /**
     * Get action details by name
     * @param {string} actionName - Display name of the action
     * @param {Object} gameData - Cached game data from dataManager
     * @returns {Object|null} Action details or null if not found
     */
    getActionDetailsByName(actionName, gameData) {
        const actionDetailMap = gameData?.actionDetailMap;
        if (!actionDetailMap) {
            return null;
        }

        // Find action by matching name
        for (const [hrid, details] of Object.entries(actionDetailMap)) {
            if (details.name === actionName) {
                // Include hrid in returned object for task detection
                return { ...details, hrid };
            }
        }

        return null;
    }

    /**
     * Calculate action time and efficiency for current character state
     * Uses shared calculator with community buffs and detailed breakdown
     * @param {Object} actionDetails - Action details from game data
     * @param {Object} gameData - Cached game data from dataManager
     * @returns {Object} {actionTime, totalEfficiency, efficiencyBreakdown}
     */
    calculateActionMetrics(actionDetails, gameData) {
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const itemDetailMap = gameData?.itemDetailMap || {};

        // Use shared calculator with community buffs and breakdown
        const stats = calculateActionStats(actionDetails, {
            skills,
            equipment,
            itemDetailMap,
            actionHrid: actionDetails.hrid, // Pass action HRID for task detection
            includeCommunityBuff: true,
            includeBreakdown: true,
            floorActionLevel: true,
        });

        if (!stats) {
            // Fallback values
            return {
                actionTime: 1,
                totalEfficiency: 0,
                efficiencyBreakdown: {
                    levelEfficiency: 0,
                    houseEfficiency: 0,
                    equipmentEfficiency: 0,
                    teaEfficiency: 0,
                    teaBreakdown: [],
                    communityEfficiency: 0,
                    skillLevel: 1,
                    baseRequirement: 1,
                    actionLevelBonus: 0,
                    actionLevelBreakdown: [],
                    effectiveRequirement: 1,
                },
            };
        }

        return stats;
    }

    /**
     * Get house room name for an action type
     * @param {string} actionType - Action type HRID
     * @returns {string} House room name with level
     */
    getHouseRoomName(actionType) {
        const houseRooms = dataManager.getHouseRooms();
        const roomMapping = {
            '/action_types/cheesesmithing': '/house_rooms/forge',
            '/action_types/cooking': '/house_rooms/kitchen',
            '/action_types/crafting': '/house_rooms/workshop',
            '/action_types/foraging': '/house_rooms/garden',
            '/action_types/milking': '/house_rooms/dairy_barn',
            '/action_types/tailoring': '/house_rooms/sewing_parlor',
            '/action_types/woodcutting': '/house_rooms/log_shed',
            '/action_types/brewing': '/house_rooms/brewery',
        };

        const roomHrid = roomMapping[actionType];
        if (!roomHrid) return 'Unknown Room';

        const room = houseRooms.get(roomHrid);
        const roomName = roomHrid
            .split('/')
            .pop()
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        const level = room?.level || 0;

        return `${roomName} level ${level}`;
    }

    /**
     * Calculate speed breakdown from all sources
     * @param {Object} actionData - Action data
     * @param {Map} equipment - Equipment map
     * @param {Object} itemDetailMap - Item detail map from game data
     * @returns {Object} Speed breakdown by source
     */
    calculateSpeedBreakdown(actionData, equipment, itemDetailMap) {
        const breakdown = {
            equipmentAndTools: [],
            consumables: [],
            total: 0,
        };

        // Get all equipment speed bonuses using the existing parser
        const allSpeedBonuses = debugEquipmentSpeedBonuses(equipment, itemDetailMap);

        // Determine which speed types are relevant for this action
        const actionType = actionData.type;
        const skillName = actionType.replace('/action_types/', '');
        const skillSpecificSpeed = skillName + 'Speed';

        // Filter for relevant speeds (skill-specific or generic skillingSpeed)
        const relevantSpeeds = allSpeedBonuses.filter((item) => {
            return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
        });

        // Add to breakdown
        for (const item of relevantSpeeds) {
            breakdown.equipmentAndTools.push(item);
            breakdown.total += item.scaledBonus * 100; // Convert to percentage
        }

        // Consumables (teas)
        const consumableSpeed = this.getConsumableSpeed(actionData, equipment, itemDetailMap);
        breakdown.consumables = consumableSpeed;
        breakdown.total += consumableSpeed.reduce((sum, c) => sum + c.speed, 0);

        return breakdown;
    }

    /**
     * Get consumable speed bonuses (Enhancing Teas only)
     * @param {Object} actionData - Action data
     * @param {Map} equipment - Equipment map
     * @param {Object} itemDetailMap - Item detail map
     * @returns {Array} Consumable speed info
     */
    getConsumableSpeed(actionData, equipment, itemDetailMap) {
        const actionType = actionData.type;
        const drinkSlots = dataManager.getActionDrinkSlots(actionType);
        if (!drinkSlots || drinkSlots.length === 0) return [];

        const consumables = [];

        // Only Enhancing is relevant (all actions except combat)
        if (actionType === '/action_types/combat') {
            return consumables;
        }

        // Get drink concentration using existing utility
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

        // Check drink slots for Enhancing Teas
        const enhancingTeas = {
            '/items/enhancing_tea': { name: 'Enhancing Tea', baseSpeed: 0.02 },
            '/items/super_enhancing_tea': { name: 'Super Enhancing Tea', baseSpeed: 0.04 },
            '/items/ultra_enhancing_tea': { name: 'Ultra Enhancing Tea', baseSpeed: 0.06 },
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
                    speed: scaledSpeed * 100,
                });
            }
        }

        return consumables;
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
     * Set input value using React utility
     * @param {HTMLInputElement} input - Number input element
     * @param {number} value - Value to set
     */
    setInputValue(input, value) {
        setReactInputValue(input, value, { focus: true });
    }

    /**
     * Calculate maximum possible value based on inventory
     * @param {HTMLElement} panel - Action panel element
     * @param {Object} actionDetails - Action details from game data
     * @param {Object} gameData - Cached game data from dataManager
     * @returns {number|string} Maximum value (number for production, '∞' for gathering)
     */
    calculateMaxValue(panel, actionDetails, gameData) {
        try {
            // Gathering actions (no materials needed) - return infinity symbol
            if (!actionDetails.inputItems && !actionDetails.upgradeItemHrid) {
                return '∞';
            }

            // Production actions - calculate based on available materials
            const inventory = dataManager.getInventory();
            if (!inventory) {
                return 0; // No inventory data available
            }

            // Get Artisan Tea reduction if active
            const equipment = dataManager.getEquipment();
            const itemDetailMap = gameData?.itemDetailMap || {};
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
            const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            let maxActions = Infinity;

            // Check upgrade item first (e.g., Crimson Staff → Azure Staff)
            if (actionDetails.upgradeItemHrid) {
                // Upgrade recipes require base item (enhancement level 0)
                const upgradeItem = inventory.find(
                    (item) => item.itemHrid === actionDetails.upgradeItemHrid && item.enhancementLevel === 0
                );
                const availableAmount = upgradeItem?.count || 0;
                const baseRequirement = 1; // Upgrade items always require exactly 1

                // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                // Materials are consumed PER ACTION (including instant repeats)
                // Efficiency gives bonus actions for FREE (no material cost)
                const materialsPerAction = baseRequirement;

                if (materialsPerAction > 0) {
                    const possibleActions = Math.floor(availableAmount / materialsPerAction);
                    maxActions = Math.min(maxActions, possibleActions);
                }
            }

            // Check regular input items (materials like lumber, etc.)
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                for (const input of actionDetails.inputItems) {
                    // Find ALL items with this HRID (different enhancement levels stack separately)
                    const allMatchingItems = inventory.filter((item) => item.itemHrid === input.itemHrid);

                    // Sum up counts across all enhancement levels
                    const availableAmount = allMatchingItems.reduce((total, item) => total + (item.count || 0), 0);
                    const baseRequirement = input.count;

                    // Apply Artisan reduction
                    // Materials are consumed PER ACTION (including instant repeats)
                    // Efficiency gives bonus actions for FREE (no material cost)
                    const materialsPerAction = baseRequirement * (1 - artisanBonus);

                    if (materialsPerAction > 0) {
                        const possibleActions = Math.floor(availableAmount / materialsPerAction);
                        maxActions = Math.min(maxActions, possibleActions);
                    }
                }
            }

            // If we couldn't calculate (no materials found), return 0
            if (maxActions === Infinity) {
                return 0;
            }

            return maxActions;
        } catch (error) {
            console.error('[Toolasha] Error calculating max value:', error);
            return 10000; // Safe fallback on error
        }
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
        const skill = skills.find((s) => s.skillHrid === skillHrid);
        return skill?.level || 1;
    }

    /**
     * Get total efficiency percentage for current action
     * @param {Object} actionDetails - Action details
     * @param {Object} gameData - Game data
     * @returns {number} Total efficiency percentage
     */
    getTotalEfficiency(actionDetails, gameData) {
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const itemDetailMap = gameData?.itemDetailMap || {};

        // Calculate all efficiency components (reuse existing logic)
        const skillLevel = this.getSkillLevel(skills, actionDetails.type);
        const baseRequirement = actionDetails.levelRequirement?.level || 1;

        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

        const actionLevelBonus = parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);
        const effectiveRequirement = baseRequirement + Math.floor(actionLevelBonus);

        // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
        const teaSkillLevelBonus = parseTeaSkillLevelBonus(
            actionDetails.type,
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Apply tea skill level bonus to effective player level
        const effectiveLevel = skillLevel + teaSkillLevelBonus;
        const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
        const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
        const equipmentEfficiency = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap);

        const teaBreakdown = parseTeaEfficiencyBreakdown(
            actionDetails.type,
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );
        const teaEfficiency = teaBreakdown.reduce((sum, tea) => sum + tea.efficiency, 0);

        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
        const communityEfficiency = communityBuffLevel ? (0.14 + (communityBuffLevel - 1) * 0.003) * 100 : 0;

        return stackAdditive(levelEfficiency, houseEfficiency, equipmentEfficiency, teaEfficiency, communityEfficiency);
    }

    /**
     * Calculate actions and time needed to reach target level
     * Accounts for progressive efficiency gains (+1% per level)
     * Efficiency reduces actions needed (each action gives more XP) but not time per action
     * @param {number} currentLevel - Current skill level
     * @param {number} currentXP - Current experience points
     * @param {number} targetLevel - Target skill level
     * @param {number} baseEfficiency - Starting efficiency percentage
     * @param {number} actionTime - Time per action in seconds
     * @param {number} xpPerAction - Modified XP per action (with multipliers)
     * @param {Object} levelExperienceTable - XP requirements per level
     * @returns {Object} {actionsNeeded, timeNeeded}
     */
    calculateMultiLevelProgress(
        currentLevel,
        currentXP,
        targetLevel,
        baseEfficiency,
        actionTime,
        xpPerAction,
        levelExperienceTable
    ) {
        let totalActions = 0;
        let totalTime = 0;

        for (let level = currentLevel; level < targetLevel; level++) {
            // Calculate XP needed for this level
            let xpNeeded;
            if (level === currentLevel) {
                // First level: Account for current progress
                xpNeeded = levelExperienceTable[level + 1] - currentXP;
            } else {
                // Subsequent levels: Full level requirement
                xpNeeded = levelExperienceTable[level + 1] - levelExperienceTable[level];
            }

            // Progressive efficiency: +1% per level gained during grind
            const levelsGained = level - currentLevel;
            const progressiveEfficiency = baseEfficiency + levelsGained;
            const efficiencyMultiplier = 1 + progressiveEfficiency / 100;

            // Calculate XP per performed action (base XP × efficiency multiplier)
            // Efficiency means each action repeats, giving more XP per performed action
            const xpPerPerformedAction = xpPerAction * efficiencyMultiplier;

            // Calculate time-consuming actions needed for this level
            const baseActionsForLevel = Math.ceil(xpNeeded / xpPerPerformedAction);

            // Convert time-consuming actions to queued actions (instant repeats count toward queue total)
            const actionsToQueue = Math.round(baseActionsForLevel * efficiencyMultiplier);
            totalActions += actionsToQueue;

            // Time is based on time-consuming actions, not instant repeats
            totalTime += baseActionsForLevel * actionTime;
        }

        return { actionsNeeded: totalActions, timeNeeded: totalTime };
    }

    /**
     * Create level progress section
     * @param {Object} actionDetails - Action details from game data
     * @param {number} actionTime - Time per action in seconds
     * @param {Object} gameData - Cached game data from dataManager
     * @param {HTMLInputElement} numberInput - Queue input element
     * @returns {HTMLElement|null} Level progress section or null if not applicable
     */
    createLevelProgressSection(actionDetails, actionTime, gameData, numberInput) {
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
            const skill = skills.find((s) => s.skillHrid === skillHrid);
            if (!skill) {
                return null;
            }

            // Get level experience table
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
            const _timeNeeded = actionsNeeded * actionTime;

            // Calculate rates using shared utility (includes efficiency)
            const expData = calculateExpPerHour(actionDetails.hrid);
            const xpPerHour =
                expData?.expPerHour || (actionsNeeded > 0 ? calculateActionsPerHour(actionTime) * modifiedXP : 0);
            const xpPerDay = xpPerHour * 24;

            // Calculate daily level progress
            const _dailyLevelProgress = xpPerDay / xpNeededThisLevel;

            // Create content
            const content = document.createElement('div');
            content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

            const lines = [];

            // Current level and progress
            lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(1)}% to Level ${nextLevel}`);
            lines.push('');

            // Action details
            lines.push(
                `XP per action: ${formatWithSeparator(baseXP.toFixed(1))} base → ${formatWithSeparator(modifiedXP.toFixed(1))} (×${xpData.totalMultiplier.toFixed(2)})`
            );

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

                // Equipment wisdom (e.g., Necklace Of Wisdom, Philosopher's Necklace skillingExperience)
                if (xpData.wisdomBreakdown && xpData.wisdomBreakdown.length > 0) {
                    for (const item of xpData.wisdomBreakdown) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(1)}%`);
                    }
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

            // Get base efficiency for this action
            const baseEfficiency = this.getTotalEfficiency(actionDetails, gameData);

            lines.push('');

            // Single level progress (always shown)
            const singleLevel = this.calculateMultiLevelProgress(
                currentLevel,
                currentXP,
                nextLevel,
                baseEfficiency,
                actionTime,
                modifiedXP,
                levelExperienceTable
            );

            lines.push(
                `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">To Level ${nextLevel}:</span>`
            );
            lines.push(`  Actions: ${formatWithSeparator(singleLevel.actionsNeeded)}`);
            lines.push(`  Time: ${timeReadable(singleLevel.timeNeeded)}`);

            lines.push('');

            // Multi-level calculator (interactive section)
            lines.push(
                `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Target Level Calculator:</span>`
            );
            lines.push(`<div style="margin-top: 4px;">
                <span>To level </span>
                <input
                    type="number"
                    id="mwi-target-level-input"
                    value="${nextLevel}"
                    min="${nextLevel}"
                    max="200"
                    style="
                        width: 50px;
                        padding: 2px 4px;
                        background: var(--background-secondary, #2a2a2a);
                        color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});
                        border: 1px solid var(--border-color, ${config.COLOR_BORDER});
                        border-radius: 3px;
                        font-size: 0.9em;
                    "
                >
                <span>:</span>
            </div>`);

            // Dynamic result line (will be updated by JS)
            lines.push(`<div id="mwi-target-level-result" style="margin-top: 4px; margin-left: 8px;">
                ${formatWithSeparator(singleLevel.actionsNeeded)} actions | ${timeReadable(singleLevel.timeNeeded)}
            </div>`);

            lines.push('');
            lines.push(
                `XP/hour: ${formatWithSeparator(Math.round(xpPerHour))} | XP/day: ${formatWithSeparator(Math.round(xpPerDay))}`
            );

            content.innerHTML = lines.join('<br>');

            // Set up event listeners for interactive calculator
            const targetLevelInput = content.querySelector('#mwi-target-level-input');
            const targetLevelResult = content.querySelector('#mwi-target-level-result');

            const updateTargetLevel = () => {
                const targetLevel = parseInt(targetLevelInput.value);

                if (targetLevel > currentLevel && targetLevel <= 200) {
                    const result = this.calculateMultiLevelProgress(
                        currentLevel,
                        currentXP,
                        targetLevel,
                        baseEfficiency,
                        actionTime,
                        modifiedXP,
                        levelExperienceTable
                    );

                    targetLevelResult.innerHTML = `
                        ${formatWithSeparator(result.actionsNeeded)} actions | ${timeReadable(result.timeNeeded)}
                    `;
                    targetLevelResult.style.color = 'var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY})';

                    // Auto-fill queue input when target level changes
                    this.setInputValue(numberInput, result.actionsNeeded);
                } else {
                    targetLevelResult.textContent = 'Invalid level';
                    targetLevelResult.style.color = 'var(--color-error, #ff4444)';
                }
            };

            targetLevelInput.addEventListener('input', updateTargetLevel);
            targetLevelInput.addEventListener('change', updateTargetLevel);

            // Create summary for collapsed view (time to next level)
            const summary = `${timeReadable(singleLevel.timeNeeded)} to Level ${nextLevel}`;

            // Create collapsible section
            return createCollapsibleSection(
                '📈',
                'Level Progress',
                summary,
                content,
                false // Collapsed by default
            );
        } catch (error) {
            console.error('[Toolasha] Error creating level progress section:', error);
            return null;
        }
    }

    /**
     * Disable quick input buttons (cleanup)
     */
    disable() {
        // Disconnect main observer
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Note: inputObserver and newInputObserver are created locally in injectQuickInputButtons()
        // and attached to panels, which will be garbage collected when panels are removed.
        // They cannot be explicitly disconnected here, but this is acceptable as they're
        // short-lived observers tied to specific panel instances.

        this.isActive = false;
    }
}

// Create and export singleton instance
const quickInputButtons = new QuickInputButtons();

export default quickInputButtons;
