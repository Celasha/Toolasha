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
import storage from '../../core/storage.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import { parseEquipmentSpeedBonuses, debugEquipmentSpeedBonuses } from '../../utils/equipment-parser.js';
import { parseArtisanBonus, getDrinkConcentration } from '../../utils/tea-parser.js';
import { formatPercentage, timeReadable, formatWithSeparator, formatKMB } from '../../utils/formatters.js';
import { calculateExperienceMultiplier } from '../../utils/experience-parser.js';
import { setReactInputValue } from '../../utils/react-input.js';
import { calculateExpPerHour, calculateMultiLevelProgress } from '../../utils/experience-calculator.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { calculateActionsPerHour, calculateEffectiveActionsPerHour } from '../../utils/profit-helpers.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';
import { MIN_ACTION_TIME_SECONDS } from '../../utils/profit-constants.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import scrollSimulator from '../combat/scroll-simulator.js';
import { SCROLL_BUFF_ITEMS } from '../../utils/scroll-buff-values.js';

let _qibSpriteUrl = null;
function scrollSpriteHtml(buffTypeHrid, size = 14) {
    if (_qibSpriteUrl === null) {
        const el = document.querySelector('use[href*="items_sprite"]');
        _qibSpriteUrl = el ? el.getAttribute('href').split('#')[0] : '';
    }
    const itemSuffix = SCROLL_BUFF_ITEMS[buffTypeHrid];
    if (!_qibSpriteUrl || !itemSuffix) return '';
    return (
        `<svg width="${size}" height="${size}" style="vertical-align:middle;margin-right:3px">` +
        `<use href="${_qibSpriteUrl}#${itemSuffix}"></use></svg>`
    );
}

/**
 * Compute wall-clock seconds for a queue, accounting for efficiency gains as levels are gained.
 * Each level gained adds 1% efficiency (game mechanic: efficiency = effective_level − requirement).
 * @param {number} queueCount - Number of queued actions
 * @param {Object} levelContext - From _buildLevelContext: { currentLevel, currentXP, modifiedXP, levelExperienceTable }
 * @param {number} baseEfficiency - Current efficiency percentage (e.g., 131.02)
 * @param {number} actionTime - Seconds per time-consuming action
 * @returns {number} Total wall-clock seconds
 */
function computeProgressiveQueueTime(queueCount, levelContext, baseEfficiency, actionTime) {
    let remaining = queueCount;
    let totalTime = 0;
    let level = levelContext.currentLevel;
    let xp = levelContext.currentXP;
    let levelsGained = 0;
    const { levelExperienceTable, modifiedXP } = levelContext;

    while (remaining > 0) {
        const effMult = 1 + (baseEfficiency + levelsGained) / 100;
        const nextLevelXP = levelExperienceTable[level + 1];

        if (!nextLevelXP) {
            totalTime += (remaining / effMult) * actionTime;
            break;
        }

        const xpToNextLevel = nextLevelXP - xp;
        const queueActionsToLevel = xpToNextLevel / modifiedXP;

        if (remaining <= queueActionsToLevel) {
            totalTime += (remaining / effMult) * actionTime;
            break;
        }

        totalTime += (queueActionsToLevel / effMult) * actionTime;
        remaining -= queueActionsToLevel;
        level++;
        xp = nextLevelXP;
        levelsGained++;
    }

    return totalTime;
}

/**
 * QuickInputButtons class manages quick input button injection
 */
class QuickInputButtons {
    constructor() {
        this.isInitialized = false;
        this.addMode = false;
        this.unregisterObserver = null;
        this.presetHours = [0.5, 1, 2, 3, 4, 5, 6, 10, 12, 24];
        this.presetValues = [10, 100, 1000];
        this.cleanupRegistry = createCleanupRegistry();
        this._targetLevelByAction = new Map();
    }

    /**
     * Initialize the quick input buttons feature
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.addMode = await storage.get('quickInput_addMode', 'settings', false);

        // Start observing for action panels
        this.startObserving();
        this.isInitialized = true;
    }

    /**
     * Format an hours value into a compact combined label e.g. "1mo2w3d4h30m"
     * @param {number} totalHours
     * @returns {string}
     */
    _formatHoursLabel(totalHours) {
        const months = Math.floor(totalHours / 720);
        let rem = totalHours % 720;
        const weeks = Math.floor(rem / 168);
        rem %= 168;
        const days = Math.floor(rem / 24);
        rem %= 24;
        const hours = Math.floor(rem);
        const mins = Math.round((rem - hours) * 60);

        let result = '';
        if (months) result += `${months}mo`;
        if (weeks) result += `${weeks}w`;
        if (days) result += `${days}d`;
        if (hours) result += `${hours}h`;
        if (mins) result += `${mins}m`;
        return result || '0h';
    }

    /**
     * Parse a comma-separated preset string into a sorted array of positive numbers.
     * Returns defaults if the string is blank or yields no valid values.
     * Capped at 8 entries to avoid UI overflow.
     * @param {string} raw - Comma-separated string from settings
     * @param {number[]} defaults - Fallback values
     * @returns {number[]}
     */
    _parsePresets(raw, defaults) {
        if (!raw || !raw.trim()) return defaults;
        const parsed = raw
            .split(',')
            .map((s) => parseFloat(s.trim()))
            .filter((n) => isFinite(n) && n > 0);
        if (parsed.length === 0) return defaults;
        return [...new Set(parsed)].sort((a, b) => a - b).slice(0, 8);
    }

    /**
     * Create the count preset row (add-mode toggle + count buttons + Max + "times" label)
     * @param {HTMLElement} panel - Action panel element
     * @param {HTMLElement} numberInput - The queue input element
     * @param {Object} gameData - Cached game data
     * @param {Object} actionDetails - Action details object
     * @returns {DocumentFragment} Fragment containing the row elements
     */
    _createCountPresetRow(panel, numberInput, gameData, actionDetails) {
        const fragment = document.createDocumentFragment();

        const applyToggleStyle = (btn, active) => {
            if (active) {
                btn.style.background = 'rgba(215, 183, 255, 0.2)';
                btn.style.color = '#d7b7ff';
                btn.style.borderColor = '#d7b7ff';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = 'rgba(215, 183, 255, 0.5)';
                btn.style.borderColor = 'rgba(215, 183, 255, 0.3)';
            }
        };

        const addToggle = document.createElement('button');
        addToggle.textContent = '+';
        addToggle.title = 'Toggle add mode: click to accumulate counts instead of setting them';
        addToggle.style.cssText = `
            font-size: 11px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 4px;
            border: 1px solid rgba(215, 183, 255, 0.3);
            background: transparent;
            color: rgba(215, 183, 255, 0.5);
            cursor: pointer;
            margin-right: 4px;
            line-height: 1.4;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        `;
        applyToggleStyle(addToggle, this.addMode);
        addToggle.addEventListener('click', () => {
            this.addMode = !this.addMode;
            applyToggleStyle(addToggle, this.addMode);
            storage.set('quickInput_addMode', this.addMode, 'settings');
        });
        fragment.appendChild(addToggle);

        fragment.appendChild(document.createTextNode('Do '));

        const activePresetValues = this._parsePresets(
            config.getSettingValue('actionPanel_quickInputs_countPresets', ''),
            [10, 100, 1000]
        );
        activePresetValues.forEach((value) => {
            const button = this.createButton(formatKMB(value), () => {
                const currentInput =
                    panel.querySelector('[class*="maxActionCountInput"] input') ||
                    panel.querySelector('input[type="number"]') ||
                    numberInput;
                if (this.addMode) {
                    const current = parseInt(currentInput.value) || 0;
                    this.setInputValue(currentInput, current + value);
                } else {
                    this.setInputValue(currentInput, value);
                }
            });
            fragment.appendChild(button);
        });

        const maxButton = this.createButton('Max', () => {
            const currentInput =
                panel.querySelector('[class*="maxActionCountInput"] input') ||
                panel.querySelector('input[type="number"]') ||
                numberInput;
            const nameEl = panel.querySelector('[class*="SkillActionDetail_name"]');
            const currentName = nameEl?.textContent?.trim();
            const currentDetails =
                currentName && currentName !== actionDetails.name
                    ? this.getActionDetailsByName(currentName, gameData) || actionDetails
                    : actionDetails;
            const maxValue = this.calculateMaxValue(panel, currentDetails, gameData);
            if (maxValue === '∞' || maxValue > 0) {
                this.setInputValue(currentInput, maxValue);
            }
        });
        fragment.appendChild(maxButton);

        fragment.appendChild(document.createTextNode(' times'));

        return fragment;
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

        this.cleanupRegistry.registerCleanup(() => {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
        });

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
        let actionDetails = null;
        try {
            // Check if already injected for this same action
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            const currentActionName = actionNameElement?.textContent?.trim() || '';
            const previousActionName = panel.dataset.mwiInjectedAction || '';

            if (panel.querySelector('.mwi-collapsible-section') || panel.querySelector('.mwi-quick-input-btn')) {
                if (currentActionName && currentActionName === previousActionName) {
                    return;
                }
                // Action changed (React reused the panel) — remove old injections
                panel.querySelectorAll('.mwi-collapsible-section').forEach((el) => el.remove());
                panel.querySelectorAll('.mwi-quick-input-btn').forEach((el) => el.remove());
            }

            // Find the queue input field - prioritize maxActionCountInput container
            // to avoid matching other number inputs (e.g., crafting plan gold/hr input)
            let numberInput = null;
            const maxInputContainer = panel.querySelector('[class*="maxActionCountInput"]');
            if (maxInputContainer) {
                numberInput = maxInputContainer.querySelector('input');
            }
            if (!numberInput) {
                numberInput = panel.querySelector('input[type="number"]');
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
            if (!actionNameElement) {
                console.warn('[Quick Input Buttons] No action name element found');
                return;
            }

            const actionName = currentActionName;
            actionDetails = this.getActionDetailsByName(actionName, gameData);
            if (!actionDetails) {
                console.warn('[Quick Input Buttons] No action details found for:', actionName);
                return;
            }

            // Stamp panel so we can detect when React swaps the action content
            panel.dataset.mwiInjectedAction = actionName;

            // Check if this action has normal XP gain (skip speed section for combat)
            const experienceGain = actionDetails.experienceGain;
            const hasNormalXP = experienceGain && experienceGain.skillHrid && experienceGain.value > 0;

            // Arm scroll simulation for this action type
            dataManager.setScrollSimulation(
                actionDetails.type,
                scrollSimulator.getScrollSetForActionType(actionDetails.type)
            );

            // Calculate action duration and efficiency
            const { actionTime, totalEfficiency, efficiencyBreakdown } = this.calculateActionMetrics(
                actionDetails,
                gameData
            );
            const efficiencyMultiplier = 1 + totalEfficiency / 100;
            let levelContext = null;

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
            const equipmentSpeedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);
            const personalSpeedBonus = dataManager.getPersonalBuffFlatBoost(
                actionDetails.type,
                '/buff_types/action_speed'
            );
            const speedBonus = equipmentSpeedBonus + personalSpeedBonus;

            let speedSection = null;

            if (hasNormalXP) {
                levelContext = this._buildLevelContext(actionDetails, gameData);

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
                const displayTimeAfterEquipment = Math.max(MIN_ACTION_TIME_SECONDS, timeAfterEquipment);
                const equipmentClampSuffix =
                    timeAfterEquipment < MIN_ACTION_TIME_SECONDS ? ` (${timeAfterEquipment.toFixed(2)}s)` : '';

                speedLines.push(
                    `Base: ${baseTime.toFixed(2)}s → ${displayTimeAfterEquipment.toFixed(2)}s${equipmentClampSuffix}`
                );
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
                                ? ` (${item.baseSpeed.toFixed(2)}% × ${(1 + item.drinkConcentration / 100).toFixed(2)})`
                                : '';
                        speedLines.push(`  - ${item.name}: +${item.speed.toFixed(2)}%${detailText}`);
                    }

                    // Personal buff (Scroll of Action Speed)
                    if (personalSpeedBonus > 0) {
                        const simSprite = dataManager.isBuffBeingSimulated(
                            actionDetails.type,
                            '/buff_types/action_speed'
                        )
                            ? scrollSpriteHtml('/buff_types/action_speed')
                            : '';
                        speedLines.push(
                            `  - ${simSprite}Scroll of Action Speed: +${formatPercentage(personalSpeedBonus, 1)}`
                        );
                    }
                }

                // Task Speed section (multiplicative, separate from equipment speed)
                if (isTaskAction && taskSpeedBonus > 0) {
                    speedLines.push(''); // Empty line separator
                    speedLines.push(
                        `<span style="font-weight: 500;">Task Speed (multiplicative): +${taskSpeedBonus.toFixed(2)}%</span>`
                    );
                    speedLines.push(
                        `${displayTimeAfterEquipment.toFixed(2)}s${equipmentClampSuffix} → ${actionTime.toFixed(2)}s | ${calculateActionsPerHour(actionTime).toFixed(0)}/hr`
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
                                    ? ` (${(baseTaskSpeed * 100).toFixed(2)}% + ${(enhancementBonus * enhancementLevel * 100).toFixed(2)}%)`
                                    : '';

                            speedLines.push(
                                `  - ${itemDetails.name}${enhText}: +${taskSpeedBonus.toFixed(2)}%${detailText}`
                            );
                        }
                    }
                }

                // Add Efficiency breakdown
                speedLines.push(''); // Empty line
                speedLines.push(
                    `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Efficiency: +${totalEfficiency.toFixed(2)}% → Output: ×${efficiencyMultiplier.toFixed(2)} (${Math.round(calculateActionsPerHour(actionTime) * efficiencyMultiplier)}/hr)</span>`
                );

                // Detailed efficiency breakdown
                if (
                    efficiencyBreakdown.levelEfficiency > 0 ||
                    (efficiencyBreakdown.actionLevelBreakdown && efficiencyBreakdown.actionLevelBreakdown.length > 0)
                ) {
                    // Calculate raw level delta (before any Action Level bonuses)
                    const rawLevelDelta = efficiencyBreakdown.skillLevel - efficiencyBreakdown.baseRequirement;

                    // Show final level efficiency
                    speedLines.push(`  - Level: +${efficiencyBreakdown.levelEfficiency.toFixed(2)}%`);

                    // Show raw level delta (what you'd get without Action Level bonuses)
                    speedLines.push(
                        `    - Raw level delta: +${rawLevelDelta.toFixed(2)}% (${efficiencyBreakdown.skillLevel} - ${efficiencyBreakdown.baseRequirement} base requirement)`
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
                                `    - ${tea.name} impact: ${baseTeaImpact.toFixed(2)}% (raises requirement)`
                            );

                            // Show DC contribution as additional reduction if > 0
                            if (tea.dcContribution > 0) {
                                const dcImpact = -tea.dcContribution;
                                speedLines.push(`      - Drink Concentration: ${dcImpact.toFixed(2)}%`);
                            }
                        }
                    }
                }
                if (efficiencyBreakdown.houseEfficiency > 0) {
                    // Get house room name
                    const houseRoomName = this.getHouseRoomName(actionDetails.type);
                    speedLines.push(
                        `  - House: +${efficiencyBreakdown.houseEfficiency.toFixed(2)}% (${houseRoomName})`
                    );
                }
                if (efficiencyBreakdown.equipmentEfficiency > 0) {
                    speedLines.push(`  - Equipment: +${efficiencyBreakdown.equipmentEfficiency.toFixed(2)}%`);
                }
                if (efficiencyBreakdown.achievementEfficiency > 0) {
                    speedLines.push(`  - Achievement: +${efficiencyBreakdown.achievementEfficiency.toFixed(2)}%`);
                }
                // Break out individual teas - show BASE efficiency on main line, DC as sub-line
                if (efficiencyBreakdown.teaBreakdown && efficiencyBreakdown.teaBreakdown.length > 0) {
                    for (const tea of efficiencyBreakdown.teaBreakdown) {
                        // Show BASE efficiency (without DC scaling) on main line
                        speedLines.push(`  - ${tea.name}: +${tea.baseEfficiency.toFixed(2)}%`);
                        // Show DC contribution as sub-line if > 0
                        if (tea.dcContribution > 0) {
                            speedLines.push(`    - Drink Concentration: +${tea.dcContribution.toFixed(2)}%`);
                        }
                    }
                }
                if (efficiencyBreakdown.communityEfficiency > 0) {
                    const communityBuffLevel = dataManager.getCommunityBuffLevel(
                        '/community_buff_types/production_efficiency'
                    );
                    speedLines.push(
                        `  - Community: +${efficiencyBreakdown.communityEfficiency.toFixed(2)}% (Production Efficiency T${communityBuffLevel})`
                    );
                }
                if (efficiencyBreakdown.personalEfficiency > 0) {
                    const simSprite = dataManager.isBuffBeingSimulated(actionDetails.type, '/buff_types/efficiency')
                        ? scrollSpriteHtml('/buff_types/efficiency')
                        : '';
                    speedLines.push(`  - ${simSprite}Seal: +${efficiencyBreakdown.personalEfficiency.toFixed(2)}%`);
                }

                // Total time (dynamic)
                const totalTimeLine = document.createElement('div');
                totalTimeLine.style.cssText = `
                color: var(--text-color-main, ${config.COLOR_INFO});
                font-weight: 500;
                margin-top: 4px;
            `;

                const computeTotalSeconds = (queueCount) =>
                    levelContext
                        ? computeProgressiveQueueTime(queueCount, levelContext, totalEfficiency, actionTime)
                        : Math.ceil(queueCount / efficiencyMultiplier) * actionTime;

                const updateTotalTime = () => {
                    const inputValue = numberInput.value;

                    if (inputValue === '∞') {
                        totalTimeLine.textContent = 'Total time: ∞';
                        return;
                    }

                    const queueCount = parseInt(inputValue) || 0;
                    if (queueCount > 0) {
                        const totalSeconds = computeTotalSeconds(queueCount);
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
                let inputObserverCleanup = createMutationWatcher(
                    numberInput,
                    () => {
                        updateTotalTime();
                    },
                    {
                        attributes: true,
                        attributeFilter: ['value'],
                    }
                );
                this.cleanupRegistry.registerCleanup(() => {
                    if (inputObserverCleanup) {
                        inputObserverCleanup();
                        inputObserverCleanup = null;
                    }
                });

                const updateOnInput = () => updateTotalTime();
                const updateOnChange = () => updateTotalTime();
                const updateOnClick = () => {
                    const clickTimeout = setTimeout(updateTotalTime, 50);
                    this.cleanupRegistry.registerTimeout(clickTimeout);
                };

                numberInput.addEventListener('input', updateOnInput);
                numberInput.addEventListener('change', updateOnChange);
                panel.addEventListener('click', updateOnClick);

                this.cleanupRegistry.registerListener(numberInput, 'input', updateOnInput);
                this.cleanupRegistry.registerListener(numberInput, 'change', updateOnChange);
                this.cleanupRegistry.registerListener(panel, 'click', updateOnClick);

                // Create initial summary for Action Speed & Time
                const actionsPerHourWithEfficiency = Math.round(
                    calculateEffectiveActionsPerHour(calculateActionsPerHour(actionTime), efficiencyMultiplier)
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
                                const totalSeconds = computeTotalSeconds(queueCount);
                                speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: ${timeReadable(totalSeconds)}`;
                            } else {
                                speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: 0s`;
                            }
                        }
                    }
                };

                // Replace all updateTotalTime calls with enhanced version
                if (inputObserverCleanup) {
                    inputObserverCleanup();
                    inputObserverCleanup = null;
                }

                const newInputObserverCleanup = createMutationWatcher(
                    numberInput,
                    () => {
                        enhancedUpdateTotalTime();
                    },
                    {
                        attributes: true,
                        attributeFilter: ['value'],
                    }
                );
                this.cleanupRegistry.registerCleanup(() => {
                    newInputObserverCleanup();
                });

                numberInput.removeEventListener('input', updateOnInput);
                numberInput.removeEventListener('change', updateOnChange);
                panel.removeEventListener('click', updateOnClick);

                const updateOnInputEnhanced = () => enhancedUpdateTotalTime();
                const updateOnChangeEnhanced = () => enhancedUpdateTotalTime();
                const updateOnClickEnhanced = () => {
                    const clickTimeout = setTimeout(enhancedUpdateTotalTime, 50);
                    this.cleanupRegistry.registerTimeout(clickTimeout);
                };

                numberInput.addEventListener('input', updateOnInputEnhanced);
                numberInput.addEventListener('change', updateOnChangeEnhanced);
                panel.addEventListener('click', updateOnClickEnhanced);

                this.cleanupRegistry.registerListener(numberInput, 'input', updateOnInputEnhanced);
                this.cleanupRegistry.registerListener(numberInput, 'change', updateOnChangeEnhanced);
                this.cleanupRegistry.registerListener(panel, 'click', updateOnClickEnhanced);

                // Initial update with enhanced version
                enhancedUpdateTotalTime();
            } // End hasNormalXP check - speedSection only created for non-combat

            const levelProgressSection = this.createLevelProgressSection(
                actionDetails,
                actionTime,
                gameData,
                numberInput,
                totalEfficiency,
                levelContext
            );

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

                const activePresetHours = this._parsePresets(
                    config.getSettingValue('actionPanel_quickInputs_hourPresets', ''),
                    [0.5, 1, 2, 3, 4, 5, 6, 10, 12, 24]
                );
                activePresetHours.forEach((hours) => {
                    const button = this.createButton(this._formatHoursLabel(hours), () => {
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

                queueContent.appendChild(document.createTextNode(' '));
                queueContent.appendChild(document.createElement('div')); // Line break

                // SECOND ROW: Count-based buttons (times)
                queueContent.appendChild(this._createCountPresetRow(panel, numberInput, gameData, actionDetails));
            } else {
                // Combat: count presets only (no hour-based buttons)
                queueContent = document.createElement('div');
                queueContent.style.cssText = `
                    color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                    font-size: 0.9em;
                    margin-top: 8px;
                    margin-bottom: 8px;
                `;
                queueContent.appendChild(this._createCountPresetRow(panel, numberInput, gameData, actionDetails));
            }

            // Insert sections into DOM
            const hideSpeedTime = !config.getSetting('actionPanel_showSpeedTime');
            const hideLevelProgress = !config.getSetting('actionPanel_showLevelProgress');

            inputContainer.insertAdjacentElement('afterend', queueContent);
            let lastInserted = queueContent;

            if (speedSection && !hideSpeedTime) {
                lastInserted.insertAdjacentElement('afterend', speedSection);
                lastInserted = speedSection;
            }

            if (levelProgressSection && !hideLevelProgress) {
                lastInserted.insertAdjacentElement('afterend', levelProgressSection);
            }

            // Merge top and bottom into a single scrolling unit.
            // The game splits the panel into a scrollable top (SkillActionDetail_content)
            // and a fixed bottom (SkillActionDetail_actionContainer). We unify them by:
            // 1. Removing the top section's independent scroll
            // 2. Removing our previous bottom-only scroll constraint
            // 3. Constraining the parent (regularComponent) as the single scroll container
            const actionContainer = inputContainer.parentElement;
            const regularComponent = actionContainer?.closest('[class*="SkillActionDetail_regularComponent"]');
            if (actionContainer && regularComponent) {
                const contentEl = regularComponent.querySelector('[class*="SkillActionDetail_content"]');
                if (contentEl) {
                    contentEl.style.overflow = 'visible';
                }
                actionContainer.style.maxHeight = '';
                actionContainer.style.overflowY = '';
                const maxH = Math.max(300, Math.floor(window.innerHeight * 0.96 - 20));
                regularComponent.style.maxHeight = maxH + 'px';
                regularComponent.style.overflowY = 'auto';
            }
        } catch (error) {
            console.error('[Toolasha] Error injecting quick input buttons:', error);
        } finally {
            // Clear scroll simulation regardless of success/failure
            if (actionDetails?.type) dataManager.clearScrollSimulation(actionDetails.type);
        }
    }

    /**
     * Disable quick input buttons and cleanup observers/listeners
     */
    disable() {
        this.cleanupRegistry.cleanupAll();
        document.querySelectorAll('.mwi-collapsible-section').forEach((section) => section.remove());
        document.querySelectorAll('.mwi-quick-input-btn').forEach((button) => button.remove());
        document.querySelectorAll('[class*="SkillActionDetail_regularComponent"]').forEach((el) => {
            el.style.maxHeight = '';
            el.style.overflowY = '';
            const content = el.querySelector('[class*="SkillActionDetail_content"]');
            if (content) content.style.overflow = '';
        });
        this.isInitialized = false;
    }

    /**
     * Get action details by name
     * @param {string} actionName - Display name of the action
     * @param {Object} gameData - Cached game data from dataManager
     * @returns {Object|null} Action details or null if not found
     */
    getActionDetailsByName(actionName, gameData) {
        const hrid = getActionHridFromName(actionName);
        if (!hrid) {
            return null;
        }

        const details = gameData?.actionDetailMap?.[hrid];
        if (!details) {
            return null;
        }

        // Include hrid in returned object for task detection
        return { ...details, hrid };
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
                    achievementEfficiency: 0,
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
        if (!skill) {
            console.error(`[QuickInputButtons] Skill not found: ${skillHrid}`);
        }
        return skill?.level || 1;
    }

    /**
     * Build the level context object needed for level progress display and progressive time estimation.
     * Returns null if the action has no XP gain, the player is at max level, or required data is missing.
     * @param {Object} actionDetails
     * @param {Object} gameData
     * @returns {Object|null}
     */
    _buildLevelContext(actionDetails, gameData) {
        const experienceGain = actionDetails.experienceGain;
        if (!experienceGain || !experienceGain.skillHrid || experienceGain.value <= 0) {
            return null;
        }

        const skillHrid = experienceGain.skillHrid;
        const skills = dataManager.getSkills();
        if (!skills) return null;

        const skill = skills.find((s) => s.skillHrid === skillHrid);
        if (!skill) return null;

        const levelExperienceTable = gameData?.levelExperienceTable;
        if (!levelExperienceTable) return null;

        const currentLevel = skill.level;
        const currentXP = skill.experience || 0;

        if (!levelExperienceTable[currentLevel + 1]) return null; // max level

        const xpData = calculateExperienceMultiplier(skillHrid, actionDetails.type);
        const baseXP = experienceGain.value;
        const modifiedXP = baseXP * xpData.totalMultiplier;

        return { skillHrid, skill, currentLevel, currentXP, levelExperienceTable, xpData, baseXP, modifiedXP };
    }

    /**
     * Create level progress section
     * @param {Object} actionDetails - Action details from game data
     * @param {number} actionTime - Time per action in seconds
     * @param {Object} gameData - Cached game data from dataManager
     * @param {HTMLInputElement} numberInput - Queue input element
     * @param {number} totalEfficiency - Current efficiency percentage
     * @param {Object|null} levelContext - Pre-computed from _buildLevelContext; null returns null
     * @returns {HTMLElement|null} Level progress section or null if not applicable
     */
    createLevelProgressSection(actionDetails, actionTime, gameData, numberInput, totalEfficiency, levelContext) {
        try {
            if (!levelContext) {
                return null;
            }

            const { currentLevel, currentXP, levelExperienceTable, xpData, baseXP, modifiedXP } = levelContext;
            const nextLevel = currentLevel + 1;
            const xpForNextLevel = levelExperienceTable[nextLevel];

            // Calculate progress (XP gained this level / XP needed for this level)
            const xpForCurrentLevel = levelExperienceTable[currentLevel] || 0;
            const xpGainedThisLevel = currentXP - xpForCurrentLevel;
            const xpNeededThisLevel = xpForNextLevel - xpForCurrentLevel;
            const progressPercent = (xpGainedThisLevel / xpNeededThisLevel) * 100;
            const xpNeeded = xpForNextLevel - currentXP;

            // Calculate actions and time needed (using modified XP)
            const actionsNeeded = Math.ceil(xpNeeded / modifiedXP);

            // Calculate rates using shared utility (includes efficiency)
            const expData = calculateExpPerHour(actionDetails.hrid);
            const xpPerHour =
                expData?.expPerHour || (actionsNeeded > 0 ? calculateActionsPerHour(actionTime) * modifiedXP : 0);
            const xpPerDay = xpPerHour * 24;

            // Create content
            const content = document.createElement('div');
            content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

            const lines = [];

            // Current level and progress
            lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(2)}% to Level ${nextLevel}`);
            lines.push('');

            // Action details
            lines.push(
                `XP per action: ${formatWithSeparator(baseXP.toFixed(2))} base → ${formatWithSeparator(modifiedXP.toFixed(2))} (×${xpData.totalMultiplier.toFixed(2)})`
            );

            // XP breakdown (if any bonuses exist)
            if (xpData.totalWisdom > 0 || xpData.charmExperience > 0) {
                const totalXPBonus = xpData.totalWisdom + xpData.charmExperience;
                lines.push(`  Total XP Bonus: +${totalXPBonus.toFixed(2)}%`);

                // List all sources that contribute

                // Equipment skill-specific XP (e.g., Celestial Shears foragingExperience)
                if (xpData.charmBreakdown && xpData.charmBreakdown.length > 0) {
                    for (const item of xpData.charmBreakdown) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(2)}%`);
                    }
                }

                // Equipment wisdom (e.g., Necklace Of Wisdom, Philosopher's Necklace skillingExperience)
                if (xpData.wisdomBreakdown && xpData.wisdomBreakdown.length > 0) {
                    for (const item of xpData.wisdomBreakdown) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(2)}%`);
                    }
                }

                // House rooms
                if (xpData.breakdown.houseWisdom > 0) {
                    lines.push(`    • House Rooms: +${xpData.breakdown.houseWisdom.toFixed(2)}%`);
                }

                // Community buff
                if (xpData.breakdown.communityWisdom > 0) {
                    lines.push(`    • Community Buff: +${xpData.breakdown.communityWisdom.toFixed(2)}%`);
                }

                // Tea/Coffee
                if (xpData.breakdown.consumableWisdom > 0) {
                    lines.push(`    • Wisdom Tea: +${xpData.breakdown.consumableWisdom.toFixed(2)}%`);
                }

                // Achievement wisdom
                if (xpData.breakdown.achievementWisdom > 0) {
                    lines.push(`    • Achievement: +${xpData.breakdown.achievementWisdom.toFixed(2)}%`);
                }

                // MooPass wisdom
                if (xpData.breakdown.mooPassWisdom > 0) {
                    lines.push(`    • MooPass: +${xpData.breakdown.mooPassWisdom.toFixed(2)}%`);
                }

                // Personal buff (Scroll of Wisdom)
                if (xpData.breakdown.personalWisdom > 0) {
                    const simSprite = dataManager.isBuffBeingSimulated(actionDetails.type, '/buff_types/wisdom')
                        ? scrollSpriteHtml('/buff_types/wisdom')
                        : '';
                    lines.push(`    • ${simSprite}Scroll of Wisdom: +${xpData.breakdown.personalWisdom.toFixed(2)}%`);
                }
            }

            lines.push('');

            // Single level progress (always shown)
            const singleLevel = calculateMultiLevelProgress(
                currentLevel,
                currentXP,
                nextLevel,
                totalEfficiency,
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
            const savedTargetLevel = this._targetLevelByAction.get(actionDetails.hrid);
            const initialTargetLevel =
                savedTargetLevel && savedTargetLevel > currentLevel ? savedTargetLevel : nextLevel;
            lines.push(
                `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Target Level Calculator:</span>`
            );
            lines.push(`<div style="margin-top: 4px;">
                <span>To level </span>
                <input
                    type="number"
                    id="mwi-target-level-input"
                    value="${initialTargetLevel}"
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
                this._targetLevelByAction.set(actionDetails.hrid, targetLevel);

                if (targetLevel > currentLevel && targetLevel <= 200) {
                    const result = calculateMultiLevelProgress(
                        currentLevel,
                        currentXP,
                        targetLevel,
                        totalEfficiency,
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

            // If restoring a saved target level, compute and display the result immediately
            if (initialTargetLevel !== nextLevel) {
                updateTargetLevel();
            }

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

const quickInputButtons = new QuickInputButtons();

export default quickInputButtons;
