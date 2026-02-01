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
const RATING_MODE_TOKENS = 'tokens';
const RATING_MODE_GOLD = 'gold';

/**
 * Calculate task completion time in seconds based on task progress and action rates
 * @param {Object} profitData - Profit calculation result
 * @returns {number|null} Completion time in seconds or null if unavailable
 */
function calculateTaskCompletionSeconds(profitData) {
    const actionsPerHour = profitData?.action?.details?.actionsPerHour;
    const totalQuantity = profitData?.taskInfo?.quantity;

    if (!actionsPerHour || !totalQuantity) {
        return null;
    }

    const currentProgress = profitData.taskInfo.currentProgress || 0;
    const remainingActions = Math.max(totalQuantity - currentProgress, 0);
    if (remainingActions <= 0) {
        return 0;
    }

    const efficiencyMultiplier = profitData.action.details.efficiencyMultiplier || 1;
    const baseActionsNeeded = efficiencyMultiplier > 0 ? remainingActions / efficiencyMultiplier : remainingActions;

    return calculateSecondsForActions(baseActionsNeeded, actionsPerHour);
}

/**
 * Calculate task efficiency rating data
 * @param {Object} profitData - Profit calculation result
 * @param {string} ratingMode - Rating mode (tokens or gold)
 * @returns {Object|null} Rating data or null if unavailable
 */
function calculateTaskEfficiencyRating(profitData, ratingMode) {
    const completionSeconds = calculateTaskCompletionSeconds(profitData);
    if (!completionSeconds || completionSeconds <= 0) {
        return null;
    }

    const hours = completionSeconds / 3600;

    if (ratingMode === RATING_MODE_GOLD) {
        if (profitData.rewards?.error || profitData.totalProfit === null || profitData.totalProfit === undefined) {
            return {
                value: null,
                unitLabel: 'gold/hr',
                error: profitData.rewards?.error || 'Missing price data',
            };
        }

        return {
            value: profitData.totalProfit / hours,
            unitLabel: 'gold/hr',
            error: null,
        };
    }

    const tokensReceived = profitData.rewards?.breakdown?.tokensReceived ?? 0;
    return {
        value: tokensReceived / hours,
        unitLabel: 'tokens/hr',
        error: null,
    };
}

const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

/**
 * Convert a hex color to RGB
 * @param {string} hex - Hex color string
 * @returns {Object|null} RGB values or null when invalid
 */
function parseHexColor(hex) {
    if (!hex || !HEX_COLOR_PATTERN.test(hex)) {
        return null;
    }

    const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
    };
}

/**
 * Convert RGB values to a CSS color string
 * @param {Object} rgb - RGB values
 * @returns {string} CSS rgb color string
 */
function formatRgbColor({ r, g, b }) {
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Interpolate between two RGB colors
 * @param {Object} startColor - RGB start color
 * @param {Object} endColor - RGB end color
 * @param {number} ratio - Interpolation ratio
 * @returns {Object} RGB color
 */
function interpolateRgbColor(startColor, endColor, ratio) {
    return {
        r: Math.round(startColor.r + (endColor.r - startColor.r) * ratio),
        g: Math.round(startColor.g + (endColor.g - startColor.g) * ratio),
        b: Math.round(startColor.b + (endColor.b - startColor.b) * ratio),
    };
}

/**
 * Convert a rating value into a relative gradient color
 * @param {number} value - Rating value
 * @param {number} minValue - Minimum rating value
 * @param {number} maxValue - Maximum rating value
 * @param {string} minColor - CSS color for lowest value
 * @param {string} maxColor - CSS color for highest value
 * @param {string} fallbackColor - Color to use when value is invalid
 * @returns {string} CSS color value
 */
function getRelativeEfficiencyGradientColor(value, minValue, maxValue, minColor, maxColor, fallbackColor) {
    if (!Number.isFinite(value) || !Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
        return fallbackColor;
    }

    const startColor = parseHexColor(minColor);
    const endColor = parseHexColor(maxColor);
    if (!startColor || !endColor) {
        return fallbackColor;
    }

    const normalized = (value - minValue) / (maxValue - minValue);
    const clamped = Math.min(Math.max(normalized, 0), 1);
    const blendedColor = interpolateRgbColor(startColor, endColor, clamped);
    return formatRgbColor(blendedColor);
}

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

        config.onSettingChange('taskEfficiencyRating', () => {
            if (this.isInitialized) {
                this.updateTaskProfits(true);
            }
        });

        config.onSettingChange('taskEfficiencyRatingMode', () => {
            if (this.isInitialized) {
                this.updateTaskProfits(true);
            }
        });

        config.onSettingChange('taskEfficiencyGradient', () => {
            if (this.isInitialized) {
                this.updateEfficiencyGradientColors();
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
    updateTaskProfits(forceRefresh = false) {
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
                if (!forceRefresh && savedTaskKey === currentTaskKey) {
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
        const completionSeconds = calculateTaskCompletionSeconds(profitData);
        const timeEstimate = completionSeconds !== null ? timeReadable(completionSeconds) : '???';

        // Create main profit display (Option B format: compact with time)
        const profitLine = document.createElement('div');
        profitLine.style.cssText = `
            color: ${config.COLOR_ACCENT};
            cursor: pointer;
            user-select: none;
        `;
        const totalProfitLabel = profitData.hasMissingPrices ? '-- ⚠' : numberFormatter(profitData.totalProfit);
        profitLine.innerHTML = `💰 ${totalProfitLabel} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ▸`;

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
            const updatedProfitLabel = profitData.hasMissingPrices ? '-- ⚠' : numberFormatter(profitData.totalProfit);
            profitLine.innerHTML = `💰 ${updatedProfitLabel} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ${isHidden ? '▾' : '▸'}`;
        };

        profitLine.addEventListener('click', profitLineListener);
        listeners.set(profitLine, profitLineListener);

        // Store all listeners for cleanup
        this.eventListeners.set(profitContainer, listeners);

        profitContainer.appendChild(profitLine);

        profitContainer.appendChild(breakdownSection);

        if (config.getSetting('taskEfficiencyRating')) {
            const ratingMode = config.getSettingValue('taskEfficiencyRatingMode', RATING_MODE_TOKENS);
            const ratingData = calculateTaskEfficiencyRating(profitData, ratingMode);
            const ratingLine = document.createElement('div');
            ratingLine.className = 'mwi-task-profit-rating';
            ratingLine.style.cssText = 'margin-top: 2px; font-size: 0.7rem;';

            if (!ratingData || ratingData.value === null) {
                const warningText = ratingData?.error ? ' ⚠' : '';
                ratingLine.style.color = config.COLOR_WARNING;
                ratingLine.textContent = `⚡ --${warningText} ${ratingData?.unitLabel || ''}`.trim();
            } else {
                const ratingValue = numberFormatter(ratingData.value, 2);
                ratingLine.dataset.ratingValue = `${ratingData.value}`;
                ratingLine.dataset.ratingMode = ratingMode;
                ratingLine.style.color = config.COLOR_ACCENT;
                ratingLine.textContent = `⚡ ${ratingValue} ${ratingData.unitLabel}`;
            }

            profitContainer.appendChild(ratingLine);
        }
        actionNode.appendChild(profitContainer);

        this.updateEfficiencyGradientColors();
    }

    /**
     * Update efficiency rating colors based on relative performance
     */
    updateEfficiencyGradientColors() {
        const ratingMode = config.getSettingValue('taskEfficiencyRatingMode', RATING_MODE_TOKENS);
        const ratingLines = Array.from(document.querySelectorAll('.mwi-task-profit-rating')).filter((line) => {
            return line.dataset.ratingMode === ratingMode && line.dataset.ratingValue;
        });

        if (ratingLines.length === 0) {
            return;
        }

        const ratingValues = ratingLines
            .map((line) => Number.parseFloat(line.dataset.ratingValue))
            .filter((value) => Number.isFinite(value));

        if (ratingValues.length === 0) {
            return;
        }

        if (!config.getSetting('taskEfficiencyGradient')) {
            ratingLines.forEach((line) => {
                line.style.color = config.COLOR_ACCENT;
            });
            return;
        }

        if (ratingValues.length === 1) {
            ratingLines.forEach((line) => {
                line.style.color = config.COLOR_ACCENT;
            });
            return;
        }

        const sortedValues = [...ratingValues].sort((a, b) => a - b);
        const lastIndex = sortedValues.length - 1;
        const percentileLookup = new Map();
        const resolvedPercentile = (value) => {
            if (percentileLookup.has(value)) {
                return percentileLookup.get(value);
            }

            const firstIndex = sortedValues.indexOf(value);
            const lastValueIndex = sortedValues.lastIndexOf(value);
            const averageRank = (firstIndex + lastValueIndex) / 2;
            const percentile = lastIndex > 0 ? averageRank / lastIndex : 1;
            percentileLookup.set(value, percentile);
            return percentile;
        };

        ratingLines.forEach((line) => {
            const value = Number.parseFloat(line.dataset.ratingValue);
            const percentile = resolvedPercentile(value);
            line.style.color = getRelativeEfficiencyGradientColor(
                percentile,
                0,
                1,
                config.COLOR_LOSS,
                config.COLOR_ACCENT,
                config.COLOR_ACCENT
            );
        });
    }

    /**
     * Build breakdown HTML
     * @param {Object} profitData - Profit calculation result
     * @returns {string} HTML string
     */
    buildBreakdownHTML(profitData) {
        const lines = [];
        const showTotals = !profitData.hasMissingPrices;
        const formatTotalValue = (value) => (showTotals ? numberFormatter(value) : '-- ⚠');
        const formatPerActionValue = (value) => (showTotals ? numberFormatter(value.toFixed(0)) : '-- ⚠');

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
                `<div class="mwi-expandable-header" data-section="gathering" style="margin-left: 10px; cursor: pointer; user-select: none;">Gathering Value: ${formatTotalValue(profitData.action.totalValue)} ▸</div>`
            );
            lines.push(
                `<div class="mwi-expandable-section" data-section="gathering" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
            );

            if (profitData.action.details) {
                const details = profitData.action.details;
                const quantity = profitData.action.breakdown.quantity;
                const actionsPerHour = details.actionsPerHour;

                // Primary output (base + gourmet + processing)
                if (details.baseOutputs && details.baseOutputs.length > 0) {
                    const baseRevenueTotal = details.baseOutputs.reduce((sum, output) => {
                        const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
                        return sum + revenuePerAction * quantity;
                    }, 0);
                    const gourmetRevenueTotal = (details.gourmetRevenueBonusPerAction || 0) * quantity;
                    const processingRevenueTotal = (details.processingRevenueBonusPerAction || 0) * quantity;
                    const primaryOutputTotal = baseRevenueTotal + gourmetRevenueTotal + processingRevenueTotal;
                    lines.push(
                        `<div style="margin-top: 2px; color: #aaa;">Primary Outputs: ${formatTotalValue(Math.round(primaryOutputTotal))}</div>`
                    );
                    for (const output of details.baseOutputs) {
                        const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
                        const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
                        const itemsForTask = itemsPerAction * quantity;
                        const revenueForTask = revenuePerAction * quantity;
                        const dropRateText =
                            output.dropRate < 1.0 ? ` (${formatPercentage(output.dropRate, 1)} drop)` : '';
                        const missingPriceNote = output.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${output.name} (Base): ${itemsForTask.toFixed(1)} items @ ${numberFormatter(Math.round(output.priceEach))}${missingPriceNote} = ${numberFormatter(Math.round(revenueForTask))}${dropRateText}</div>`
                        );
                    }
                }

                if (details.gourmetBonuses && details.gourmetBonuses.length > 0) {
                    for (const output of details.gourmetBonuses) {
                        const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
                        const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
                        const itemsForTask = itemsPerAction * quantity;
                        const revenueForTask = revenuePerAction * quantity;
                        const missingPriceNote = output.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${output.name} (Gourmet ${formatPercentage(details.gourmetBonus || 0, 1)}): ${itemsForTask.toFixed(1)} items @ ${numberFormatter(Math.round(output.priceEach))}${missingPriceNote} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                        );
                    }
                }

                if (details.processingConversions && details.processingConversions.length > 0) {
                    const processingBonusTotal = (details.processingRevenueBonusPerAction || 0) * quantity;
                    const processingLabel = `${processingBonusTotal >= 0 ? '+' : '-'}${numberFormatter(Math.abs(Math.round(processingBonusTotal)))}`;
                    lines.push(
                        `<div>• Processing (${formatPercentage(details.processingBonus || 0, 1)} proc): Net ${processingLabel}</div>`
                    );

                    for (const conversion of details.processingConversions) {
                        const conversionsPerAction =
                            conversion.conversionsPerAction ?? conversion.conversionsPerHour / actionsPerHour;
                        const rawConsumedPerAction =
                            conversion.rawConsumedPerAction ?? conversion.rawConsumedPerHour / actionsPerHour;
                        const totalConsumed = rawConsumedPerAction * quantity;
                        const totalProduced = conversionsPerAction * quantity;
                        const consumedRevenue = totalConsumed * conversion.rawPriceEach;
                        const producedRevenue = totalProduced * conversion.processedPriceEach;
                        const missingPriceNote = conversion.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div style="margin-left: 10px;">• ${conversion.rawItem} consumed: -${totalConsumed.toFixed(1)} items @ ${numberFormatter(Math.round(conversion.rawPriceEach))}${missingPriceNote} = -${numberFormatter(Math.round(consumedRevenue))}</div>`
                        );
                        lines.push(
                            `<div style="margin-left: 10px;">• ${conversion.processedItem} produced: ${totalProduced.toFixed(1)} items @ ${numberFormatter(Math.round(conversion.processedPriceEach))}${missingPriceNote} = ${numberFormatter(Math.round(producedRevenue))}</div>`
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
                    const essenceDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'essence');
                    const rareFindDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'rare_find');

                    if (essenceDrops.length > 0) {
                        const totalEssenceRevenue = essenceDrops.reduce(
                            (sum, drop) => sum + (drop.revenuePerAction || 0) * quantity,
                            0
                        );
                        lines.push(
                            `<div style="margin-top: 4px; color: #aaa;">Essence Drops: ${formatTotalValue(Math.round(totalEssenceRevenue))}</div>`
                        );
                        for (const drop of essenceDrops) {
                            const dropsForTask = (drop.dropsPerAction || 0) * quantity;
                            const revenueForTask = (drop.revenuePerAction || 0) * quantity;
                            const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }

                    if (rareFindDrops.length > 0) {
                        const totalRareRevenue = rareFindDrops.reduce(
                            (sum, drop) => sum + (drop.revenuePerAction || 0) * quantity,
                            0
                        );
                        lines.push(
                            `<div style="margin-top: 4px; color: #aaa;">Rare Finds: ${formatTotalValue(Math.round(totalRareRevenue))}</div>`
                        );
                        for (const drop of rareFindDrops) {
                            const dropsForTask = (drop.dropsPerAction || 0) * quantity;
                            const revenueForTask = (drop.revenuePerAction || 0) * quantity;
                            const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }
                }
            }

            lines.push(`</div>`);
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${formatPerActionValue(profitData.action.breakdown.perAction)} each)</div>`
            );
        } else if (profitData.type === 'production') {
            const details = profitData.action.details;
            const bonusDrops = details?.bonusRevenue?.bonusDrops || [];
            const netProductionValue = profitData.action.totalProfit;

            // Net Production (expandable)
            lines.push(
                `<div class="mwi-expandable-header" data-section="production" style="margin-left: 10px; cursor: pointer; user-select: none;">Net Production: ${formatTotalValue(netProductionValue)} ▸</div>`
            );
            lines.push(
                `<div class="mwi-expandable-section" data-section="production" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
            );

            if (details) {
                const outputAmount = details.outputAmount || 1;
                const totalItems = outputAmount * profitData.action.breakdown.quantity;
                const outputPriceNote = details.outputPriceMissing ? ' ⚠' : '';
                const baseRevenueTotal = totalItems * details.priceEach;
                const gourmetRevenueTotal = details.gourmetBonus
                    ? outputAmount * details.gourmetBonus * profitData.action.breakdown.quantity * details.priceEach
                    : 0;
                const primaryOutputTotal = baseRevenueTotal + gourmetRevenueTotal;

                lines.push(
                    `<div style="margin-top: 2px; color: #aaa;">Primary Outputs: ${formatTotalValue(Math.round(primaryOutputTotal))}</div>`
                );

                lines.push(
                    `<div>• ${details.itemName} (Base): ${totalItems.toFixed(1)} items @ ${numberFormatter(details.priceEach)}${outputPriceNote} = ${numberFormatter(Math.round(totalItems * details.priceEach))}</div>`
                );

                if (details.gourmetBonus > 0) {
                    const bonusItems = outputAmount * details.gourmetBonus * profitData.action.breakdown.quantity;
                    lines.push(
                        `<div>• ${details.itemName} (Gourmet +${formatPercentage(details.gourmetBonus, 1)}): ${bonusItems.toFixed(1)} items @ ${numberFormatter(details.priceEach)}${outputPriceNote} = ${numberFormatter(Math.round(bonusItems * details.priceEach))}</div>`
                    );
                }
            }

            if (bonusDrops.length > 0) {
                const essenceDrops = bonusDrops.filter((d) => d.type === 'essence');
                const rareFindDrops = bonusDrops.filter((d) => d.type === 'rare_find');

                if (essenceDrops.length > 0) {
                    const totalEssenceRevenue = essenceDrops.reduce(
                        (sum, drop) => sum + (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity,
                        0
                    );
                    lines.push(
                        `<div style="margin-top: 4px; color: #aaa;">Essence Drops: ${formatTotalValue(Math.round(totalEssenceRevenue))}</div>`
                    );
                    for (const drop of essenceDrops) {
                        const dropsForTask = (drop.dropsPerAction || 0) * profitData.action.breakdown.quantity;
                        const revenueForTask = (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity;
                        const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                        );
                    }
                }

                if (rareFindDrops.length > 0) {
                    const totalRareRevenue = rareFindDrops.reduce(
                        (sum, drop) => sum + (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity,
                        0
                    );
                    lines.push(
                        `<div style="margin-top: 4px; color: #aaa;">Rare Finds: ${formatTotalValue(Math.round(totalRareRevenue))}</div>`
                    );
                    for (const drop of rareFindDrops) {
                        const dropsForTask = (drop.dropsPerAction || 0) * profitData.action.breakdown.quantity;
                        const revenueForTask = (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity;
                        const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${numberFormatter(Math.round(revenueForTask))}</div>`
                        );
                    }
                }
            }

            if (details?.materialCosts) {
                const actionsNeeded = profitData.action.breakdown.quantity;
                const hoursNeeded = actionsNeeded / (details.actionsPerHour * (details.efficiencyMultiplier || 1));
                lines.push(
                    `<div style="margin-top: 4px; color: #aaa;">Material Costs: ${formatTotalValue(profitData.action.breakdown.materialCost)}</div>`
                );

                for (const mat of details.materialCosts) {
                    const totalAmount = mat.amount * actionsNeeded;
                    const totalCost = mat.totalCost * actionsNeeded;
                    const missingPriceNote = mat.missingPrice ? ' ⚠' : '';
                    lines.push(
                        `<div>• ${mat.itemName}: ${totalAmount.toFixed(1)} @ ${numberFormatter(Math.round(mat.askPrice))}${missingPriceNote} = ${numberFormatter(Math.round(totalCost))}</div>`
                    );
                }

                if (details.teaCosts && details.teaCosts.length > 0) {
                    for (const tea of details.teaCosts) {
                        const drinksNeeded = tea.drinksPerHour * hoursNeeded;
                        const totalCost = tea.totalCost * hoursNeeded;
                        const missingPriceNote = tea.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${tea.itemName}: ${drinksNeeded.toFixed(1)} drinks @ ${numberFormatter(Math.round(tea.pricePerDrink))}${missingPriceNote} = ${numberFormatter(Math.round(totalCost))}</div>`
                        );
                    }
                }
            }

            lines.push(`</div>`);

            // Net Production now shown in header
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${formatPerActionValue(profitData.action.breakdown.perAction)} each)</div>`
            );
        }

        // Total
        lines.push('<div style="border-top: 1px solid #555; margin-top: 6px; padding-top: 4px;"></div>');
        lines.push(
            `<div style="font-weight: bold; color: ${config.COLOR_ACCENT};">Total Profit: ${formatTotalValue(profitData.totalProfit)}</div>`
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

export { calculateTaskCompletionSeconds, calculateTaskEfficiencyRating, getRelativeEfficiencyGradientColor };
export default taskProfitDisplay;
