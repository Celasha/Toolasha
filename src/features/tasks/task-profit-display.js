/**
 * Task Profit Display
 * Shows profit calculation on task cards
 * Expandable breakdown on click
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import { calculateTaskProfit } from './task-profit-calculator.js';
import { numberFormatter, timeReadable, formatPercentage } from '../../utils/formatters.js';
import { GAME, TOOLASHA } from '../../utils/selectors.js';
import { calculateSecondsForActions } from '../../utils/profit-helpers.js';

// Compiled regex pattern (created once, reused for performance)
const REGEX_TASK_PROGRESS = /(\d+)\s*\/\s*(\d+)/;

/**
 * TaskProfitDisplay class manages task profit UI
 */
class TaskProfitDisplay {
    constructor() {
        this.isActive = false;
        this.unregisterHandlers = []; // Store unregister functions
        this.retryHandler = null; // Retry handler reference for cleanup
        this.marketDataRetryHandler = null; // Market data retry handler
        this.pendingTaskNodes = new Set(); // Track task nodes waiting for data
        this.eventListeners = new WeakMap(); // Store listeners for cleanup
        this.isInitialized = false;
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('taskProfitCalculator', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize task profit display
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('taskProfitCalculator')) {
            return;
        }

        // Set up retry handler for when game data loads
        if (!dataManager.getInitClientData()) {
            if (!this.retryHandler) {
                this.retryHandler = () => {
                    // Retry all pending task nodes
                    this.retryPendingTasks();
                };
                dataManager.on('character_initialized', this.retryHandler);
            }
        }

        // Set up retry handler for when market data loads
        if (!this.marketDataRetryHandler) {
            this.marketDataRetryHandler = () => {
                // Retry all pending task nodes when market data becomes available
                this.retryPendingTasks();
            };
            dataManager.on('expected_value_initialized', this.marketDataRetryHandler);
        }

        // Register WebSocket listener for task updates
        this.registerWebSocketListeners();

        // Register DOM observers for task panel appearance
        this.registerDOMObservers();

        // Initial update
        this.updateTaskProfits();

        this.isActive = true;
        this.isInitialized = true;
    }

    /**
     * Register WebSocket message listeners
     */
    registerWebSocketListeners() {
        const questsHandler = (data) => {
            if (!data.endCharacterQuests) return;

            // Wait for game to update DOM before recalculating profits
            setTimeout(() => {
                this.updateTaskProfits();
            }, 250);
        };

        webSocketHook.on('quests_updated', questsHandler);

        // Store handler for cleanup
        this.unregisterHandlers.push(() => {
            webSocketHook.off('quests_updated', questsHandler);
        });
    }

    /**
     * Register DOM observers
     */
    registerDOMObservers() {
        // Watch for task list appearing
        const unregisterTaskList = domObserver.onClass('TaskProfitDisplay-TaskList', 'TasksPanel_taskList', () => {
            this.updateTaskProfits();
        });
        this.unregisterHandlers.push(unregisterTaskList);

        // Watch for individual tasks appearing
        const unregisterTask = domObserver.onClass('TaskProfitDisplay-Task', 'RandomTask_randomTask', () => {
            // Small delay to let task data settle
            setTimeout(() => this.updateTaskProfits(), 100);
        });
        this.unregisterHandlers.push(unregisterTask);
    }

    /**
     * Update all task profit displays
     */
    updateTaskProfits() {
        if (!config.getSetting('taskProfitCalculator')) {
            return;
        }

        const taskListNode = document.querySelector(GAME.TASK_LIST);
        if (!taskListNode) return;

        const taskNodes = taskListNode.querySelectorAll(GAME.TASK_INFO);
        for (const taskNode of taskNodes) {
            // Get current task description to detect changes
            const taskData = this.parseTaskData(taskNode);
            if (!taskData) continue;

            const currentTaskKey = `${taskData.description}|${taskData.quantity}`;

            // Check if already processed
            const existingProfit = taskNode.querySelector(TOOLASHA.TASK_PROFIT);
            if (existingProfit) {
                // Check if task has changed (rerolled)
                const savedTaskKey = existingProfit.dataset.taskKey;
                if (savedTaskKey === currentTaskKey) {
                    continue; // Same task, skip
                }

                // Task changed - clean up event listeners before removing
                const listeners = this.eventListeners.get(existingProfit);
                if (listeners) {
                    listeners.forEach((listener, element) => {
                        element.removeEventListener('click', listener);
                    });
                    this.eventListeners.delete(existingProfit);
                }

                // Remove ALL old profit displays (visible + hidden markers)
                taskNode.querySelectorAll(TOOLASHA.TASK_PROFIT).forEach((el) => el.remove());
            }

            this.addProfitToTask(taskNode);
        }
    }

    /**
     * Retry processing pending task nodes after data becomes available
     */
    retryPendingTasks() {
        if (!dataManager.getInitClientData()) {
            return; // Data still not ready
        }

        // Remove retry handler - we're ready now
        if (this.retryHandler) {
            dataManager.off('character_initialized', this.retryHandler);
            this.retryHandler = null;
        }

        // Process all pending tasks
        const pendingNodes = Array.from(this.pendingTaskNodes);
        this.pendingTaskNodes.clear();

        for (const taskNode of pendingNodes) {
            // Check if node still exists in DOM
            if (document.contains(taskNode)) {
                this.addProfitToTask(taskNode);
            }
        }
    }

    /**
     * Add profit display to a task card
     * @param {Element} taskNode - Task card DOM element
     */
    async addProfitToTask(taskNode) {
        try {
            // Check if game data is ready
            if (!dataManager.getInitClientData()) {
                // Game data not ready - add to pending queue
                this.pendingTaskNodes.add(taskNode);
                return;
            }

            // Double-check we haven't already processed this task
            // (check again in case another async call beat us to it)
            if (taskNode.querySelector(TOOLASHA.TASK_PROFIT)) {
                return;
            }

            // Parse task data from DOM
            const taskData = this.parseTaskData(taskNode);
            if (!taskData) {
                return;
            }

            // Calculate profit
            const profitData = await calculateTaskProfit(taskData);

            // Don't show anything for combat tasks, but mark them so we detect rerolls
            if (profitData === null) {
                // Add hidden marker for combat tasks to enable reroll detection
                const combatMarker = document.createElement('div');
                combatMarker.className = 'mwi-task-profit';
                combatMarker.style.display = 'none';
                combatMarker.dataset.taskKey = `${taskData.description}|${taskData.quantity}`;

                const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
                if (actionNode) {
                    actionNode.appendChild(combatMarker);
                }
                return;
            }

            // Handle market data not loaded - add to pending queue
            if (
                profitData.error === 'Market data not loaded' ||
                (profitData.rewards && profitData.rewards.error === 'Market data not loaded')
            ) {
                // Add to pending queue
                this.pendingTaskNodes.add(taskNode);

                // Show loading state instead of error
                this.displayLoadingState(taskNode, taskData);
                return;
            }

            // Check one more time before adding (another async call might have added it)
            if (taskNode.querySelector(TOOLASHA.TASK_PROFIT)) {
                return;
            }

            // Display profit
            this.displayTaskProfit(taskNode, profitData);
        } catch (error) {
            console.error('[Task Profit Display] Failed to calculate profit:', error);

            // Display error state in UI
            this.displayErrorState(taskNode, 'Unable to calculate profit');

            // Remove from pending queue if present
            this.pendingTaskNodes.delete(taskNode);
        }
    }

    /**
     * Parse task data from DOM
     * @param {Element} taskNode - Task card DOM element
     * @returns {Object|null} {description, coinReward, taskTokenReward, quantity}
     */
    parseTaskData(taskNode) {
        // Get task description
        const nameNode = taskNode.querySelector(GAME.TASK_NAME_DIV);
        if (!nameNode) return null;

        const description = nameNode.textContent.trim();

        // Get quantity from progress (plain div with text "Progress: 0 / 1562")
        // Find all divs in taskInfo and look for the one containing "Progress:"
        let quantity = 0;
        let currentProgress = 0;
        const taskInfoDivs = taskNode.querySelectorAll('div');
        for (const div of taskInfoDivs) {
            const text = div.textContent.trim();
            if (text.startsWith('Progress:')) {
                const match = text.match(REGEX_TASK_PROGRESS);
                if (match) {
                    currentProgress = parseInt(match[1]); // Current progress
                    quantity = parseInt(match[2]); // Total quantity
                }
                break;
            }
        }

        // Get rewards
        const rewardsNode = taskNode.querySelector(GAME.TASK_REWARDS);
        if (!rewardsNode) return null;

        let coinReward = 0;
        let taskTokenReward = 0;

        const itemContainers = rewardsNode.querySelectorAll(GAME.ITEM_CONTAINER);

        for (const container of itemContainers) {
            const useElement = container.querySelector('use');
            if (!useElement) continue;

            const href = useElement.href.baseVal;

            if (href.includes('coin')) {
                const countNode = container.querySelector(GAME.ITEM_COUNT);
                if (countNode) {
                    coinReward = this.parseItemCount(countNode.textContent);
                }
            } else if (href.includes('task_token')) {
                const countNode = container.querySelector(GAME.ITEM_COUNT);
                if (countNode) {
                    taskTokenReward = this.parseItemCount(countNode.textContent);
                }
            }
        }

        const taskData = {
            description,
            coinReward,
            taskTokenReward,
            quantity,
            currentProgress,
        };

        return taskData;
    }

    /**
     * Parse item count from text (handles K/M suffixes)
     * @param {string} text - Count text (e.g., "1.5K")
     * @returns {number} Parsed count
     */
    parseItemCount(text) {
        text = text.trim();

        if (text.includes('K')) {
            return parseFloat(text.replace('K', '')) * 1000;
        } else if (text.includes('M')) {
            return parseFloat(text.replace('M', '')) * 1000000;
        }

        return parseFloat(text) || 0;
    }

    /**
     * Display profit on task card
     * @param {Element} taskNode - Task card DOM element
     * @param {Object} profitData - Profit calculation result
     */
    displayTaskProfit(taskNode, profitData) {
        const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
        if (!actionNode) return;

        // Create profit container
        const profitContainer = document.createElement('div');
        profitContainer.className = 'mwi-task-profit';
        profitContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
        `;

        // Store task key for reroll detection
        if (profitData.taskInfo) {
            const taskKey = `${profitData.taskInfo.description}|${profitData.taskInfo.quantity}`;
            profitContainer.dataset.taskKey = taskKey;
        }

        // Check for error state
        if (profitData.error) {
            profitContainer.innerHTML = `
                <div style="color: ${config.SCRIPT_COLOR_ALERT};">
                    Unable to calculate profit
                </div>
            `;
            actionNode.appendChild(profitContainer);
            return;
        }

        // Calculate time estimate for task completion
        let timeEstimate = '???';
        if (profitData.action?.details?.actionsPerHour && profitData.taskInfo?.quantity) {
            const actionsPerHour = profitData.action.details.actionsPerHour;
            const totalQuantity = profitData.taskInfo.quantity;
            const currentProgress = profitData.taskInfo.currentProgress || 0;
            const remainingActions = totalQuantity - currentProgress;
            const efficiencyMultiplier = profitData.action.details.efficiencyMultiplier || 1;

            // Efficiency reduces the number of actions needed
            const actualActionsNeeded = remainingActions / efficiencyMultiplier;
            const totalSeconds = calculateSecondsForActions(actualActionsNeeded, actionsPerHour);
            timeEstimate = timeReadable(totalSeconds);
        }

        // Create main profit display (Option B format: compact with time)
        const profitLine = document.createElement('div');
        profitLine.style.cssText = `
            color: ${config.COLOR_ACCENT};
            cursor: pointer;
            user-select: none;
        `;
        profitLine.innerHTML = `💰 ${numberFormatter(profitData.totalProfit)} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ▸`;

        // Create breakdown section (hidden by default)
        const breakdownSection = document.createElement('div');
        breakdownSection.className = 'mwi-task-profit-breakdown';
        breakdownSection.style.cssText = `
            display: none;
            margin-top: 6px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.7rem;
            color: #ddd;
        `;

        // Build breakdown HTML
        breakdownSection.innerHTML = this.buildBreakdownHTML(profitData);

        // Store listener references for cleanup
        const listeners = new Map();

        // Add click handlers for expandable sections
        breakdownSection.querySelectorAll('.mwi-expandable-header').forEach((header) => {
            const listener = (e) => {
                e.stopPropagation();
                const section = header.getAttribute('data-section');
                const detailSection = breakdownSection.querySelector(
                    `.mwi-expandable-section[data-section="${section}"]`
                );

                if (detailSection) {
                    const isHidden = detailSection.style.display === 'none';
                    detailSection.style.display = isHidden ? 'block' : 'none';

                    // Update arrow
                    const currentText = header.textContent;
                    header.textContent = currentText.replace(isHidden ? '▸' : '▾', isHidden ? '▾' : '▸');
                }
            };

            header.addEventListener('click', listener);
            listeners.set(header, listener);
        });

        // Toggle breakdown on click
        const profitLineListener = (e) => {
            e.stopPropagation();
            const isHidden = breakdownSection.style.display === 'none';
            breakdownSection.style.display = isHidden ? 'block' : 'none';
            profitLine.innerHTML = `💰 ${numberFormatter(profitData.totalProfit)} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ${isHidden ? '▾' : '▸'}`;
        };

        profitLine.addEventListener('click', profitLineListener);
        listeners.set(profitLine, profitLineListener);

        // Store all listeners for cleanup
        this.eventListeners.set(profitContainer, listeners);

        profitContainer.appendChild(profitLine);
        profitContainer.appendChild(breakdownSection);
        actionNode.appendChild(profitContainer);
    }

    /**
     * Build breakdown HTML
     * @param {Object} profitData - Profit calculation result
     * @returns {string} HTML string
     */
    buildBreakdownHTML(profitData) {
        const lines = [];

        lines.push('<div style="font-weight: bold; margin-bottom: 4px;">Task Profit Breakdown</div>');
        lines.push('<div style="border-bottom: 1px solid #555; margin-bottom: 4px;"></div>');

        // Show warning if market data unavailable
        if (profitData.rewards.error) {
            lines.push(
                `<div style="color: ${config.SCRIPT_COLOR_ALERT}; margin-bottom: 6px; font-style: italic;">⚠ ${profitData.rewards.error} - Token values unavailable</div>`
            );
        }

        // Task Rewards section
        lines.push('<div style="margin-bottom: 4px; color: #aaa;">Task Rewards:</div>');
        lines.push(`<div style="margin-left: 10px;">Coins: ${numberFormatter(profitData.rewards.coins)}</div>`);

        if (!profitData.rewards.error) {
            lines.push(
                `<div style="margin-left: 10px;">Task Tokens: ${numberFormatter(profitData.rewards.taskTokens)}</div>`
            );
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.rewards.breakdown.tokensReceived} tokens @ ${numberFormatter(profitData.rewards.breakdown.tokenValue.toFixed(0))} each)</div>`
            );
            lines.push(
                `<div style="margin-left: 10px;">Purple's Gift: ${numberFormatter(profitData.rewards.purpleGift)}</div>`
            );
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${numberFormatter(profitData.rewards.breakdown.giftPerTask.toFixed(0))} per task)</div>`
            );
        } else {
            lines.push(
                `<div style="margin-left: 10px; color: #888; font-style: italic;">Task Tokens: Loading...</div>`
            );
            lines.push(
                `<div style="margin-left: 10px; color: #888; font-style: italic;">Purple's Gift: Loading...</div>`
            );
        }
        // Action profit section
        lines.push('<div style="margin-top: 6px; margin-bottom: 4px; color: #aaa;">Action Profit:</div>');

        if (profitData.type === 'gathering') {
            // Gathering Value (expandable)
            lines.push(
                `<div class="mwi-expandable-header" data-section="gathering" style="margin-left: 10px; cursor: pointer; user-select: none;">Gathering Value: ${numberFormatter(profitData.action.totalValue)} ▸</div>`
            );
            lines.push(
                `<div class="mwi-expandable-section" data-section="gathering" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
            );

            if (profitData.action.details) {
                const details = profitData.action.details;
                const quantity = profitData.action.breakdown.quantity;
                const actionsPerHour = details.actionsPerHour;
                const hoursNeeded = quantity / actionsPerHour;

                // Base outputs (gathered items)
                if (details.baseOutputs && details.baseOutputs.length > 0) {
                    lines.push(`<div style="margin-top: 2px; color: #aaa;">Items Gathered:</div>`);
                    for (const output of details.baseOutputs) {
                        const itemsForTask = (output.itemsPerHour / actionsPerHour) * quantity;
                        const revenueForTask = output.revenuePerHour * hoursNeeded;
                        const dropRateText =
                            output.dropRate < 1.0 ? ` (${formatPercentage(output.dropRate, 1)} drop)` : '';
                        const processingText = output.isProcessed
                            ? ` [${formatPercentage(output.processingChance, 1)} processed]`
                            : '';
                        lines.push(
                            `<div>• ${output.name}: ${itemsForTask.toFixed(1)} items @ ${numberFormatter(Math.round(output.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}${dropRateText}${processingText}</div>`
                        );
                    }
                }

                // Bonus Revenue (essence and rare finds)
                if (
                    details.bonusRevenue &&
                    details.bonusRevenue.bonusDrops &&
                    details.bonusRevenue.bonusDrops.length > 0
                ) {
                    const bonusRevenue = details.bonusRevenue;
                    const efficiencyMultiplier = details.efficiencyMultiplier || 1;
                    const totalBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier * hoursNeeded;

                    lines.push(
                        `<div style="margin-top: 4px; color: #aaa;">Bonus Drops: ${numberFormatter(Math.round(totalBonusRevenue))}</div>`
                    );

                    // Group drops by type
                    const essenceDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'essence');
                    const rareFindDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'rare_find');

                    // Show essence drops
                    if (essenceDrops.length > 0) {
                        for (const drop of essenceDrops) {
                            const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                            const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                            lines.push(
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }

                    // Show rare find drops
                    if (rareFindDrops.length > 0) {
                        for (const drop of rareFindDrops) {
                            const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                            const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                            lines.push(
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }
                }

                // Processing conversions (raw → processed)
                if (details.processingConversions && details.processingConversions.length > 0) {
                    const processingBonus = details.processingRevenueBonus * hoursNeeded;
                    lines.push(
                        `<div style="margin-top: 4px; color: #aaa;">Processing Bonus: ${numberFormatter(Math.round(processingBonus))}</div>`
                    );
                    for (const conversion of details.processingConversions) {
                        const conversionsForTask = conversion.conversionsPerHour * hoursNeeded;
                        const revenueForTask = conversion.revenuePerHour * hoursNeeded;
                        lines.push(
                            `<div>• ${conversion.rawItem} → ${conversion.processedItem}: ${conversionsForTask.toFixed(1)} conversions, +${numberFormatter(Math.round(conversion.valueGain))} each = ${numberFormatter(Math.round(revenueForTask))}</div>`
                        );
                    }
                }
            }

            lines.push(`</div>`);
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${numberFormatter(profitData.action.breakdown.perAction.toFixed(0))} each)</div>`
            );
        } else if (profitData.type === 'production') {
            // Output Value (expandable)
            lines.push(
                `<div class="mwi-expandable-header" data-section="output" style="margin-left: 10px; cursor: pointer; user-select: none;">Output Value: ${numberFormatter(profitData.action.breakdown.outputValue)} ▸</div>`
            );
            lines.push(
                `<div class="mwi-expandable-section" data-section="output" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
            );

            if (profitData.action.details) {
                const details = profitData.action.details;
                const itemsPerAction = details.itemsPerAction || 1;
                const totalItems = itemsPerAction * profitData.action.breakdown.quantity;

                lines.push(
                    `<div>• Base Production: ${totalItems.toFixed(1)} items @ ${numberFormatter(details.priceEach)} = ${numberFormatter(Math.round(totalItems * details.priceEach))}</div>`
                );

                if (details.gourmetBonusItems > 0) {
                    const bonusItems =
                        (details.gourmetBonusItems / details.actionsPerHour) * profitData.action.breakdown.quantity;
                    lines.push(
                        `<div>• Gourmet Bonus: ${bonusItems.toFixed(1)} items @ ${numberFormatter(details.priceEach)} = ${numberFormatter(Math.round(bonusItems * details.priceEach))}</div>`
                    );
                }
            }

            lines.push(`</div>`);

            // Bonus Revenue (expandable) - Essence and Rare Find drops
            if (
                profitData.action.details?.bonusRevenue &&
                profitData.action.details.bonusRevenue.bonusDrops &&
                profitData.action.details.bonusRevenue.bonusDrops.length > 0
            ) {
                const details = profitData.action.details;
                const bonusRevenue = details.bonusRevenue;
                const hoursNeeded = profitData.action.breakdown.quantity / details.actionsPerHour;
                const efficiencyMultiplier = details.efficiencyMultiplier || 1;
                const totalBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier * hoursNeeded;

                lines.push(
                    `<div class="mwi-expandable-header" data-section="bonus" style="margin-left: 10px; cursor: pointer; user-select: none;">Bonus Revenue: ${numberFormatter(totalBonusRevenue)} ▸</div>`
                );
                lines.push(
                    `<div class="mwi-expandable-section" data-section="bonus" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
                );

                // Group drops by type
                const essenceDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'essence');
                const rareFindDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'rare_find');

                // Show essence drops
                if (essenceDrops.length > 0) {
                    lines.push(`<div style="margin-top: 2px; color: #aaa;">Essence Drops:</div>`);
                    for (const drop of essenceDrops) {
                        const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                        const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                        lines.push(
                            `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                        );
                    }
                }

                // Show rare find drops
                if (rareFindDrops.length > 0) {
                    if (essenceDrops.length > 0) {
                        lines.push(`<div style="margin-top: 4px; color: #aaa;">Rare Find Drops:</div>`);
                    }
                    for (const drop of rareFindDrops) {
                        const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                        const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                        lines.push(
                            `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                        );
                    }
                }

                lines.push(`</div>`);
            }

            // Material Cost (expandable)
            lines.push(
                `<div class="mwi-expandable-header" data-section="materials" style="margin-left: 10px; cursor: pointer; user-select: none;">Material Cost: ${numberFormatter(profitData.action.breakdown.materialCost)} ▸</div>`
            );
            lines.push(
                `<div class="mwi-expandable-section" data-section="materials" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
            );

            if (profitData.action.details && profitData.action.details.materialCosts) {
                const details = profitData.action.details;
                const actionsNeeded = profitData.action.breakdown.quantity;

                for (const mat of details.materialCosts) {
                    const totalAmount = mat.amount * actionsNeeded;
                    const totalCost = mat.totalCost * actionsNeeded;
                    lines.push(
                        `<div>• ${mat.itemName}: ${totalAmount.toFixed(1)} @ ${numberFormatter(Math.round(mat.askPrice))} = ${numberFormatter(Math.round(totalCost))}</div>`
                    );
                }

                if (details.teaCosts && details.teaCosts.length > 0) {
                    const hoursNeeded = actionsNeeded / details.actionsPerHour;
                    for (const tea of details.teaCosts) {
                        const drinksNeeded = tea.drinksPerHour * hoursNeeded;
                        const totalCost = tea.totalCost * hoursNeeded;
                        lines.push(
                            `<div>• ${tea.itemName}: ${drinksNeeded.toFixed(1)} drinks @ ${numberFormatter(Math.round(tea.pricePerDrink))} = ${numberFormatter(Math.round(totalCost))}</div>`
                        );
                    }
                }
            }

            lines.push(`</div>`);

            // Net Production
            lines.push(
                `<div style="margin-left: 10px;">Net Production: ${numberFormatter(profitData.action.totalProfit)}</div>`
            );
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${numberFormatter(profitData.action.breakdown.perAction.toFixed(0))} each)</div>`
            );
        }

        // Total
        lines.push('<div style="border-top: 1px solid #555; margin-top: 6px; padding-top: 4px;"></div>');
        lines.push(
            `<div style="font-weight: bold; color: ${config.COLOR_ACCENT};">Total Profit: ${numberFormatter(profitData.totalProfit)}</div>`
        );

        return lines.join('');
    }

    /**
     * Display error state when profit calculation fails
     * @param {Element} taskNode - Task card DOM element
     * @param {string} message - Error message to display
     */
    displayErrorState(taskNode, message) {
        const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
        if (!actionNode) return;

        // Create error container
        const errorContainer = document.createElement('div');
        errorContainer.className = 'mwi-task-profit mwi-task-profit-error';
        errorContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            color: ${config.SCRIPT_COLOR_ALERT};
            font-style: italic;
        `;
        errorContainer.textContent = `⚠ ${message}`;

        actionNode.appendChild(errorContainer);
    }

    /**
     * Display loading state while waiting for market data
     * @param {Element} taskNode - Task card DOM element
     * @param {Object} taskData - Task data for reroll detection
     */
    displayLoadingState(taskNode, taskData) {
        const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
        if (!actionNode) return;

        // Create loading container
        const loadingContainer = document.createElement('div');
        loadingContainer.className = 'mwi-task-profit mwi-task-profit-loading';
        loadingContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            color: #888;
            font-style: italic;
        `;
        loadingContainer.textContent = '⏳ Loading market data...';

        // Store task key for reroll detection
        const taskKey = `${taskData.description}|${taskData.quantity}`;
        loadingContainer.dataset.taskKey = taskKey;

        actionNode.appendChild(loadingContainer);
    }

    /**
     * Refresh colors on existing task profit displays
     */
    refresh() {
        // Update all profit line colors
        const profitLines = document.querySelectorAll('.mwi-task-profit > div:first-child');
        profitLines.forEach((line) => {
            line.style.color = config.COLOR_ACCENT;
        });

        // Update all total profit colors in breakdowns
        const totalProfits = document.querySelectorAll('.mwi-task-profit-breakdown > div:last-child');
        totalProfits.forEach((total) => {
            total.style.color = config.COLOR_ACCENT;
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        // Unregister all handlers
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        // Unregister retry handlers
        if (this.retryHandler) {
            dataManager.off('character_initialized', this.retryHandler);
            this.retryHandler = null;
        }

        if (this.marketDataRetryHandler) {
            dataManager.off('expected_value_initialized', this.marketDataRetryHandler);
            this.marketDataRetryHandler = null;
        }

        // Clear pending tasks
        this.pendingTaskNodes.clear();

        // Clean up event listeners before removing profit displays
        document.querySelectorAll(TOOLASHA.TASK_PROFIT).forEach((el) => {
            const listeners = this.eventListeners.get(el);
            if (listeners) {
                listeners.forEach((listener, element) => {
                    element.removeEventListener('click', listener);
                });
                this.eventListeners.delete(el);
            }
            el.remove();
        });

        this.isActive = false;
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const taskProfitDisplay = new TaskProfitDisplay();
taskProfitDisplay.setupSettingListener();

export default taskProfitDisplay;
