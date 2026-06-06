/**
 * Task Profit Display
 * Shows profit calculation on task cards
 * Expandable breakdown on click
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import { setReactInputValue } from '../../utils/react-input.js';
import { findActionInput } from '../../utils/action-panel-helper.js';
import { calculateTaskProfit, calculateTaskRewardValue } from './task-profit-calculator.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { timeReadable, formatPercentage, formatKMB } from '../../utils/formatters.js';
import { GAME, TOOLASHA } from '../../utils/selectors.js';
import { calculateSecondsForActions, calculateEffectiveActionsPerHour } from '../../utils/profit-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { runSimulation } from '../combat-sim/combat-sim-runner.js';
import {
    buildAllPlayerDTOs,
    buildGameDataPayload,
    getCommunityBuffs,
    applyLoadoutSnapshotToDTO,
    calculateSimRevenue,
} from '../combat-sim/combat-sim-adapter.js';
// Lazy accessor: in production multi-bundle builds, the UI bundle loads after Combat.
// Resolve at runtime via window.Toolasha.Combat to share the initialized instance,
// with a fallback to the static import for dev single-bundle builds.
import loadoutSnapshotLocal from '../combat/loadout-snapshot.js';
function getLoadoutSnapshot() {
    return window.Toolasha?.Combat?.loadoutSnapshot || loadoutSnapshotLocal;
}

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
    const baseActionsNeeded = Math.ceil(remainingActions / (efficiencyMultiplier > 0 ? efficiencyMultiplier : 1));

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

/**
 * Build a materials availability badge for production tasks
 * Shows how many actions the player can complete with current inventory
 * @param {Object} profitData - Profit calculation result
 * @returns {HTMLElement|null} Badge element or null if not applicable
 */
/**
 * Build inventory lookup map (itemHrid → count) for inventory location only
 * @returns {Object} Map of itemHrid to count
 */
function buildInventoryMap() {
    const inventory = dataManager.getInventory();
    const invMap = {};
    if (inventory) {
        for (const item of inventory) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                invMap[item.itemHrid] = (invMap[item.itemHrid] || 0) + item.count;
            }
        }
    }
    return invMap;
}

/**
 * Calculate materials availability from material list and inventory map
 * @param {Array} materials - Array of { h: itemHrid, a: amountPerAction, n: name }
 * @param {number} remaining - Remaining actions needed
 * @param {Object} invMap - Inventory map (itemHrid → count)
 * @returns {Object} { craftable, details: [{ name, have, need, enough }] }
 */
function calcMaterialsAvailability(materials, remaining, invMap) {
    let craftable = Infinity;
    const details = [];
    for (const mat of materials) {
        const have = invMap[mat.h] || 0;
        const need = mat.a * remaining;
        const canDo = Math.floor(have / mat.a);
        if (canDo < craftable) craftable = canDo;
        details.push({ name: mat.n, have, need, enough: have >= need });
    }
    if (craftable === Infinity) craftable = 0;
    return { craftable, details };
}

function buildMaterialsBadge(profitData) {
    if (profitData.type !== 'production') return null;

    const materialCosts = profitData.action?.details?.materialCosts;
    if (!materialCosts || materialCosts.length === 0) return null;

    const remaining = Math.max((profitData.taskInfo?.quantity || 0) - (profitData.taskInfo?.currentProgress || 0), 0);
    if (remaining <= 0) return null;

    const invMap = buildInventoryMap();

    // Build materials data with names for display
    const materialsJson = [];
    for (const mat of materialCosts) {
        if (!mat.amount || mat.amount <= 0) continue;
        materialsJson.push({ h: mat.itemHrid, a: mat.amount, n: mat.itemName || mat.itemHrid });
    }
    if (materialsJson.length === 0) return null;

    const { craftable, details } = calcMaterialsAvailability(materialsJson, remaining, invMap);
    const enough = craftable >= remaining;

    // Container
    const container = document.createElement('div');
    container.className = 'mwi-task-materials';
    container.style.cssText = 'margin-top: 2px; font-size: 0.7rem;';

    // Store data for live inventory updates
    container.dataset.materials = JSON.stringify(materialsJson);
    container.dataset.remaining = remaining;

    // Clickable summary line
    const summary = document.createElement('div');
    summary.style.cssText = 'cursor: pointer; user-select: none;';
    summary.style.color = enough ? '#4ade80' : config.COLOR_WARNING;
    summary.textContent = `\u{1F4E6} ${craftable}/${remaining} \u25B8`;
    summary.setAttribute('data-materials-summary', 'true');
    container.appendChild(summary);

    // Expandable detail section (hidden by default)
    const detailSection = document.createElement('div');
    detailSection.setAttribute('data-materials-detail', 'true');
    detailSection.style.cssText =
        'display: none; margin-top: 4px; padding: 4px 6px; background: rgba(0,0,0,0.2); border-radius: 4px;';
    renderMaterialDetails(detailSection, details);
    container.appendChild(detailSection);

    // Toggle detail on click
    summary.addEventListener('click', (e) => {
        e.stopPropagation();
        const hidden = detailSection.style.display === 'none';
        detailSection.style.display = hidden ? 'block' : 'none';
        const prefix = `\u{1F4E6} ${summary.dataset.craftable || craftable}/${remaining}`;
        summary.textContent = `${prefix} ${hidden ? '\u25BE' : '\u25B8'}`;
    });

    summary.dataset.craftable = craftable;

    return container;
}

/**
 * Render material detail lines into a container
 * @param {HTMLElement} container - Detail section element
 * @param {Array} details - Array of { name, have, need, enough }
 */
function renderMaterialDetails(container, details) {
    container.innerHTML = '';
    for (const d of details) {
        const line = document.createElement('div');
        line.style.color = d.enough ? '#4ade80' : config.COLOR_WARNING;
        line.textContent = `${d.name}: ${formatKMB(d.have)} / ${formatKMB(d.need)}`;
        container.appendChild(line);
    }
}

/**
 * Recalculate all visible materials badges using fresh inventory data
 */
function refreshMaterialsBadges() {
    const containers = document.querySelectorAll('.mwi-task-materials');
    if (containers.length === 0) return;

    const invMap = buildInventoryMap();

    for (const container of containers) {
        let materials;
        try {
            materials = JSON.parse(container.dataset.materials);
        } catch {
            continue;
        }

        const remaining = parseInt(container.dataset.remaining, 10) || 0;
        const { craftable, details } = calcMaterialsAvailability(materials, remaining, invMap);
        const enough = craftable >= remaining;

        // Update summary line
        const summary = container.querySelector('[data-materials-summary]');
        if (summary) {
            const detailSection = container.querySelector('[data-materials-detail]');
            const expanded = detailSection && detailSection.style.display !== 'none';
            summary.style.color = enough ? '#4ade80' : config.COLOR_WARNING;
            summary.textContent = `\u{1F4E6} ${craftable}/${remaining} ${expanded ? '\u25BE' : '\u25B8'}`;
            summary.dataset.craftable = craftable;
        }

        // Update detail section if visible
        const detailSection = container.querySelector('[data-materials-detail]');
        if (detailSection && detailSection.style.display !== 'none') {
            renderMaterialDetails(detailSection, details);
        }
    }
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
        this.timerRegistry = createTimerRegistry();
        this.marketDataInitPromise = null; // Guard against duplicate market data inits
        this._simQueue = Promise.resolve();
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('taskProfitCalculator', (value) => {
            if (value) {
                this.initialize();
                this.updateTaskProfits(true);
            } else if (
                config.getSetting('taskGoMerge') ||
                config.getSetting('taskQueuedIndicator') ||
                config.getSetting('taskMaterialsIndicator') ||
                config.getSetting('taskEfficiencyRating')
            ) {
                this.updateTaskProfits(true);
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

        config.onSettingChange('taskQueuedIndicator', (value) => {
            if (this.isInitialized) {
                if (value) {
                    this.updateQueuedIndicators();
                } else {
                    // Remove all queued indicators
                    document.querySelectorAll('.mwi-task-queued-indicator').forEach((el) => el.remove());
                }
            } else if (value) {
                this.initialize();
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

        if (
            !config.getSetting('taskProfitCalculator') &&
            !config.getSetting('taskGoMerge') &&
            !config.getSetting('taskQueuedIndicator') &&
            !config.getSetting('taskMaterialsIndicator') &&
            !config.getSetting('taskEfficiencyRating')
        ) {
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
        this.updateQueuedIndicators();

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
            const updateTimeout = setTimeout(() => {
                this.updateTaskProfits();
            }, 250);
            this.timerRegistry.registerTimeout(updateTimeout);
        };

        webSocketHook.on('quests_updated', questsHandler);

        this.unregisterHandlers.push(() => {
            webSocketHook.off('quests_updated', questsHandler);
        });

        // Listen for action queue changes to update queued indicators
        const actionsHandler = () => {
            const indicatorTimeout = setTimeout(() => {
                this.updateQueuedIndicators();
            }, 250);
            this.timerRegistry.registerTimeout(indicatorTimeout);
        };

        dataManager.on('actions_updated', actionsHandler);

        this.unregisterHandlers.push(() => {
            dataManager.off('actions_updated', actionsHandler);
        });

        // Refresh materials badges when inventory changes
        const materialsHandler = () => {
            const materialsTimeout = setTimeout(() => refreshMaterialsBadges(), 250);
            this.timerRegistry.registerTimeout(materialsTimeout);
        };

        dataManager.on('items_updated', materialsHandler);

        this.unregisterHandlers.push(() => {
            dataManager.off('items_updated', materialsHandler);
        });

        // Refresh combat estimate loadout dropdowns when snapshots arrive
        const loadoutsHandler = () => {
            document.querySelectorAll('.mwi-combat-est-loadout').forEach((select) => {
                const container = select.closest('.mwi-task-profit');
                const taskNode = container?.closest('[class*="RandomTask_randomTask"]');
                if (!taskNode) return;
                const taskData = this.parseTaskData(taskNode);
                if (taskData) this._renderCombatEstimateConfig(container, taskData);
            });
        };

        getLoadoutSnapshot().onUpdate(loadoutsHandler);

        this.unregisterHandlers.push(() => {
            getLoadoutSnapshot().offUpdate(loadoutsHandler);
        });
    }

    /**
     * Register DOM observers
     */
    registerDOMObservers() {
        // Watch for task list appearing
        const unregisterTaskList = domObserver.onClass('TaskProfitDisplay-TaskList', 'TasksPanel_taskList', () => {
            this.updateTaskProfits();
            this.updateQueuedIndicators();
        });
        this.unregisterHandlers.push(unregisterTaskList);

        // Watch for individual tasks appearing
        const unregisterTask = domObserver.onClass('TaskProfitDisplay-Task', 'RandomTask_randomTask', (taskNode) => {
            this._setupTaskNode(taskNode);
            const queuedTimeout = setTimeout(() => this.updateQueuedIndicators(), 150);
            this.timerRegistry.registerTimeout(queuedTimeout);
        });
        this.unregisterHandlers.push(unregisterTask);

        // Initial scan for task nodes already in the DOM (handles race condition
        // where tasks render before observer registers)
        const existingTaskNodes = document.querySelectorAll('[class*="RandomTask_randomTask"]');
        for (const taskNode of existingTaskNodes) {
            this._setupTaskNode(taskNode);
        }
    }

    /**
     * Set up a task node with profit display and Go button merge handler
     * @param {HTMLElement} taskNode
     */
    _setupTaskNode(taskNode) {
        // Small delay to let task data settle
        const taskTimeout = setTimeout(() => this.updateTaskProfits(), 100);
        this.timerRegistry.registerTimeout(taskTimeout);

        // Merge duplicate task Go buttons: sum goalCount - currentCount across all
        // in-progress tasks with the same actionHrid/monsterHrid and overwrite the input
        const goBtn = taskNode.querySelector('button.Button_success__6d6kU');
        if (goBtn) {
            // Skip if already attached
            if (goBtn.dataset.mwiGoMerge) return;
            goBtn.dataset.mwiGoMerge = '1';

            goBtn.addEventListener(
                'click',
                () => {
                    if (!config.getSetting('taskGoMerge')) return;

                    // Extract the quest for this task card from the fiber tree
                    const rootEl = document.getElementById('root');
                    const rootFiber =
                        rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
                    if (!rootFiber) return;

                    function walk(fiber, target) {
                        if (!fiber) return null;
                        if (fiber.stateNode === target) return fiber;
                        return walk(fiber.child, target) || walk(fiber.sibling, target);
                    }

                    const btnFiber = walk(rootFiber, goBtn);
                    if (!btnFiber) return;

                    let f = btnFiber.return;
                    let thisQuest = null;
                    while (f) {
                        if (f.memoizedProps?.characterQuest && f.memoizedProps?.rerollRandomTaskHandler) {
                            thisQuest = f.memoizedProps.characterQuest;
                            break;
                        }
                        f = f.return;
                    }
                    if (!thisQuest) return;

                    const hrid = thisQuest.actionHrid || thisQuest.monsterHrid;
                    if (!hrid) return;

                    const allQuests = dataManager.characterQuests || [];

                    const matchingQuests = allQuests.filter(
                        (q) =>
                            q.status === '/quest_status/in_progress' &&
                            q.category === '/quest_category/random_task' &&
                            (q.actionHrid === hrid || q.monsterHrid === hrid)
                    );

                    if (matchingQuests.length <= 1) {
                        return;
                    }

                    const total = matchingQuests.reduce((sum, q) => sum + (q.goalCount - q.currentCount), 0);
                    const isBoss = thisQuest.monsterHrid && dataManager.isBossMonster(thisQuest.monsterHrid);
                    const adjustedTotal = isBoss ? total * 10 : total;

                    // Wait for the game to navigate and render the input field
                    setTimeout(() => {
                        const inputEl = findActionInput(document);
                        if (inputEl) {
                            setReactInputValue(inputEl, adjustedTotal);
                        }
                    }, 300);
                },
                true
            );
        }
    }

    /**
     * Update all task profit displays
     */
    updateTaskProfits(forceRefresh = false) {
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

        this.timerRegistry.clearAll();

        for (const taskNode of pendingNodes) {
            // Check if node still exists in DOM
            if (document.contains(taskNode)) {
                this.addProfitToTask(taskNode);
            }
        }
    }

    /**
     * Ensure expected value calculator is initialized when task profits need market data
     * @returns {Promise<boolean>} True if initialization completed
     */
    async ensureMarketDataInitialized() {
        if (expectedValueCalculator.isInitialized) {
            return true;
        }

        if (!this.marketDataInitPromise) {
            this.marketDataInitPromise = (async () => {
                try {
                    return await expectedValueCalculator.initialize();
                } catch (error) {
                    console.error('[Task Profit Display] Market data initialization failed:', error);
                    return false;
                } finally {
                    this.marketDataInitPromise = null;
                }
            })();
        }

        return this.marketDataInitPromise;
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

            if (!expectedValueCalculator.isInitialized) {
                const initialized = await this.ensureMarketDataInitialized();
                if (!initialized || !expectedValueCalculator.isInitialized) {
                    this.pendingTaskNodes.add(taskNode);
                    this.displayLoadingState(taskNode, taskData);
                    return;
                }
            }

            // Calculate profit
            const profitData = await calculateTaskProfit(taskData);

            // Show combat estimate UI for combat tasks
            if (profitData === null) {
                // Hidden marker for reroll detection (still needed)
                const combatMarker = document.createElement('div');
                combatMarker.className = 'mwi-task-profit';
                combatMarker.style.display = 'none';
                combatMarker.dataset.taskKey = `${taskData.description}|${taskData.quantity}`;

                const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
                if (actionNode) {
                    actionNode.appendChild(combatMarker);
                }

                if (config.getSetting('taskCombatEstimate')) {
                    const estimateContainer = document.createElement('div');
                    estimateContainer.className = 'mwi-task-profit';
                    estimateContainer.style.cssText = 'margin-top: 4px; font-size: 0.75rem;';

                    if (config.getSetting('combatSim_autoEstimate')) {
                        const defaultLoadout = config.getSettingValue('combatSim_defaultLoadout', '');
                        this._simQueue = this._simQueue.then(() =>
                            this._runCombatSimEstimate(estimateContainer, taskData, defaultLoadout)
                        );
                    } else {
                        this._renderCombatEstimateConfig(estimateContainer, taskData);
                    }

                    if (actionNode) {
                        actionNode.appendChild(estimateContainer);
                    }
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

        // Exclude zone-index spans injected by Toolasha (e.g. <span class="script_taskMapIndex">Z9</span>)
        // so they don't pollute the description with "Arcane LumberZ9"
        const zoneSpan = nameNode.querySelector('span.script_taskMapIndex');
        const description = zoneSpan
            ? nameNode.textContent.replace(zoneSpan.textContent, '').trim()
            : nameNode.textContent.trim();

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
     * Render the pre-run config state for the combat task estimate.
     * Shows a loadout dropdown and an "Estimate" button.
     * @param {Element} container - Container element to render into
     * @param {Object} taskData - Parsed task data
     * @private
     */
    _renderCombatEstimateConfig(container, taskData) {
        container.innerHTML = '';
        const snapshots = getLoadoutSnapshot()
            .getAllSnapshots()
            .filter((s) => !s.actionTypeHrid || s.actionTypeHrid === '/action_types/combat');

        const defaultLoadout = config.getSettingValue('combatSim_defaultLoadout', '');

        let html = '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">';
        html +=
            '<select class="mwi-combat-est-loadout" style="font-size:11px; background:#1a1a1a; color:#ccc; border:1px solid #444; border-radius:3px; padding:2px 4px;">';
        html += `<option value=""${!defaultLoadout ? ' selected' : ''}>— Current Gear —</option>`;
        for (const s of snapshots) {
            const selected = s.name === defaultLoadout ? ' selected' : '';
            html += `<option value="${s.name}"${selected}>${s.name}</option>`;
        }
        html += '</select>';
        html +=
            '<button class="mwi-combat-est-mode" data-mode="solo" title="Solo: simulate only target monster. Zone: simulate full zone spawn table." style="font-size:11px; padding:2px 6px; background:#1a1a1a; color:#ccc; border:1px solid #444; border-radius:3px; cursor:pointer;">Solo</button>';
        html +=
            '<button class="mwi-combat-est-btn" style="font-size:11px; padding:2px 8px; background:#1a3a5c; color:#4a9eff; border:1px solid #4a9eff44; border-radius:3px; cursor:pointer;">⚔ Estimate</button>';
        html += '</div>';
        container.innerHTML = html;

        const modeBtn = container.querySelector('.mwi-combat-est-mode');
        modeBtn.addEventListener('click', () => {
            const current = modeBtn.dataset.mode;
            if (current === 'solo') {
                modeBtn.dataset.mode = 'zone';
                modeBtn.textContent = 'Zone';
                modeBtn.style.color = '#aaddff';
                modeBtn.style.borderColor = '#4a9eff44';
            } else {
                modeBtn.dataset.mode = 'solo';
                modeBtn.textContent = 'Solo';
                modeBtn.style.color = '#ccc';
                modeBtn.style.borderColor = '#444';
            }
        });

        container.querySelector('.mwi-combat-est-btn').addEventListener('click', () => {
            const loadoutName = container.querySelector('.mwi-combat-est-loadout').value;
            const mode = modeBtn.dataset.mode;
            this._runCombatSimEstimate(container, taskData, loadoutName, mode);
        });
    }

    /**
     * Run the combat sim to estimate task completion time.
     * @param {Element} container - Container element to render into
     * @param {Object} taskData - Parsed task data
     * @param {string} loadoutName - Loadout snapshot name (empty = current gear)
     * @param {string} mode - 'solo' (single monster) or 'zone' (full spawn table)
     * @private
     */
    async _runCombatSimEstimate(container, taskData, loadoutName, mode = 'solo') {
        // Extract monster name from "Defeat - Monster Name" description
        const match = taskData.description.match(/^Defeat\s*-\s*(.+)$/i);
        const monsterName = match?.[1]?.trim() || null;

        const initClientData = dataManager.getInitClientData();
        const monsterMap = initClientData?.combatMonsterDetailMap;
        const monsterHrid = monsterName ? dataManager.getMonsterHridFromName(monsterName) : null;

        if (!monsterHrid) {
            const knownNames = monsterMap
                ? Object.values(monsterMap)
                      .map((m) => m.name)
                      .sort()
                : null;
            console.warn('[TaskProfit] Could not identify monster', {
                description: taskData.description,
                extractedName: monsterName,
                initClientDataLoaded: !!initClientData,
                monsterMapSize: monsterMap ? Object.keys(monsterMap).length : 0,
                closeMatches: knownNames
                    ? knownNames.filter(
                          (n) => monsterName && n.toLowerCase().includes(monsterName.toLowerCase().split(' ')[0])
                      )
                    : [],
            });
            container.innerHTML = '<span style="color:#f87171; font-size:11px;">Could not identify monster.</span>';
            return;
        }

        const zoneHrid = dataManager.getCombatZoneForMonster(monsterHrid);
        if (!zoneHrid) {
            container.innerHTML = '<span style="color:#f87171; font-size:11px;">No zone found for monster.</span>';
            return;
        }

        container.innerHTML = '<span style="color:#888; font-size:11px;">⏳ Simulating…</span>';

        try {
            const gameData = buildGameDataPayload();
            if (!gameData) throw new Error('No game data');

            const { players } = await buildAllPlayerDTOs();
            if (!players.length) throw new Error('No player data');

            if (loadoutName) {
                applyLoadoutSnapshotToDTO(players[0], loadoutName, gameData);
            }

            const zoneAction = gameData.actionDetailMap[zoneHrid];
            const allSpawns = zoneAction.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
            const bossSpawns = zoneAction.combatZoneInfo?.fightInfo?.bossSpawns || [];
            const isBossTarget = bossSpawns.some((s) => s.combatMonsterHrid === monsterHrid);

            let simGameData;
            if (mode === 'zone' || isBossTarget) {
                // Zone mode or boss target: use full unfiltered spawn table
                // Bosses need the full zone (9 regular fights per boss spawn)
                simGameData = gameData;
            } else {
                // Solo mode: filter spawn table to only the target monster
                const monsterSpawn = allSpawns.find((s) => s.combatMonsterHrid === monsterHrid) || {
                    combatMonsterHrid: monsterHrid,
                    rate: 1,
                    strength: 1,
                    difficultyTier: 0,
                };
                simGameData = {
                    ...gameData,
                    actionDetailMap: {
                        ...gameData.actionDetailMap,
                        [zoneHrid]: {
                            ...zoneAction,
                            combatZoneInfo: {
                                ...zoneAction.combatZoneInfo,
                                fightInfo: {
                                    ...zoneAction.combatZoneInfo.fightInfo,
                                    randomSpawnInfo: {
                                        ...zoneAction.combatZoneInfo.fightInfo.randomSpawnInfo,
                                        spawns: [monsterSpawn],
                                    },
                                    bossSpawns: [],
                                },
                            },
                        },
                    },
                };
            }

            const SIM_HOURS = 1;
            const simResult = await runSimulation({
                gameData: simGameData,
                playerDTOs: players,
                zoneHrid,
                difficultyTier: 0,
                hours: SIM_HOURS,
                communityBuffs: getCommunityBuffs(),
            });

            const kills = simResult.deaths?.[monsterHrid] ?? 0;
            const killsPerHour = Math.round(kills / SIM_HOURS);
            const remaining = Math.max((taskData.quantity ?? 0) - (taskData.currentProgress ?? 0), 0);
            const completionSeconds = killsPerHour > 0 ? Math.round((remaining / killsPerHour) * 3600) : null;
            const timeEstimate = completionSeconds !== null ? timeReadable(completionSeconds) : '???';

            const playerHrid = players[0]?.hrid || 'player1';
            const { netPerHour, dropEntries, consumableEntries } = calculateSimRevenue(
                simResult,
                simGameData,
                playerHrid,
                SIM_HOURS
            );

            // Task completion rewards (one-time: coins + token value + Purple's Gift)
            const rewardValue = calculateTaskRewardValue(taskData.coinReward, taskData.taskTokenReward);

            this._renderCombatEstimateResult(
                container,
                taskData,
                monsterName,
                killsPerHour,
                timeEstimate,
                completionSeconds,
                loadoutName,
                netPerHour,
                rewardValue,
                dropEntries,
                consumableEntries,
                mode,
                simResult,
                zoneHrid
            );
        } catch (e) {
            console.error('[TaskProfit] Combat estimate failed:', e);
            container.innerHTML = '<span style="color:#f87171; font-size:11px;">Estimate failed. </span>';
            const retry = document.createElement('span');
            retry.textContent = 'Retry';
            retry.style.cssText = 'color:#4a9eff; cursor:pointer; font-size:11px;';
            retry.addEventListener('click', () => this._renderCombatEstimateConfig(container, taskData));
            container.appendChild(retry);
        }
    }

    /**
     * Render the result state after a combat sim estimate completes.
     * @param {Element} container - Container element to render into
     * @param {Object} taskData - Parsed task data
     * @param {string} monsterName - Monster display name
     * @param {number} killsPerHour - Kills per hour from sim
     * @param {string} timeEstimate - Formatted time estimate string
     * @param {number|null} completionSeconds - Seconds to completion (for task sorter)
     * @param {string} loadoutName - Loadout name used (empty = current gear)
     * @param {number} netGoldPerHour - Net gold/hr (drops - consumable costs)
     * @param {Array} dropEntries - Array of {name, count, unitValue, totalValue} per drop
     * @param {Array} consumableEntries - Array of {name, count, unitCost, totalCost} per consumable
     * @private
     */
    _renderCombatEstimateResult(
        container,
        taskData,
        monsterName,
        killsPerHour,
        timeEstimate,
        completionSeconds,
        loadoutName,
        netPerHour,
        rewardValue,
        dropEntries,
        consumableEntries,
        mode,
        simResult,
        zoneHrid
    ) {
        container.innerHTML = '';
        if (completionSeconds !== null) {
            container.dataset.completionSeconds = completionSeconds;
        }

        // Convert per-hour rates to totals for the task duration (matching skilling format)
        const completionHours = completionSeconds > 0 ? completionSeconds / 3600 : 0;
        const totalDropValue = dropEntries.reduce((s, d) => s + d.totalValue * completionHours, 0);
        const totalConsumableCost = consumableEntries.reduce((s, c) => s + c.totalCost * completionHours, 0);
        const totalProfit = Math.round(totalDropValue - totalConsumableCost + rewardValue.total);

        const profitColor = totalProfit >= 0 ? '#4ade80' : config.COLOR_LOSS;

        const mainLine = document.createElement('div');
        mainLine.style.cssText = `color: ${profitColor}; cursor: pointer; user-select: none;`;
        mainLine.innerHTML = `⚔ ${formatKMB(totalProfit)} | <span style="display:inline-block; margin-right:0.25em;">⏱</span> ${timeEstimate} ▸`;

        const breakdown = document.createElement('div');
        breakdown.className = 'mwi-task-profit-breakdown';
        breakdown.style.cssText = `
            display: none;
            margin-top: 6px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.7rem;
            color: #ddd;
        `;

        const remaining = Math.max((taskData.quantity ?? 0) - (taskData.currentProgress ?? 0), 0);
        const lines = [];
        lines.push('<div style="font-weight: bold; margin-bottom: 4px;">Task Profit Breakdown</div>');
        lines.push('<div style="border-bottom: 1px solid #555; margin-bottom: 4px;"></div>');
        lines.push(
            `<div style="margin-bottom: 2px; color: #aaa;">Monster: ${monsterName} × ${remaining.toLocaleString()} kills (${formatKMB(killsPerHour)}/hr)</div>`
        );
        lines.push(`<div style="margin-bottom: 4px; color: #aaa;">Loadout: ${loadoutName || 'Current Gear'}</div>`);

        // Task Rewards — matching skilling section exactly
        lines.push('<div style="margin-bottom: 4px; color: #aaa;">Task Rewards:</div>');
        lines.push(`<div style="margin-left: 10px;">Coins: ${formatKMB(rewardValue.coins)}</div>`);
        if (!rewardValue.error) {
            lines.push(`<div style="margin-left: 10px;">Task Tokens: ${formatKMB(rewardValue.taskTokens)}</div>`);
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${rewardValue.breakdown.tokensReceived} tokens @ ${formatKMB(Math.round(rewardValue.breakdown.tokenValue))} each)</div>`
            );
            lines.push(`<div style="margin-left: 10px;">Purple's Gift: ${formatKMB(rewardValue.purpleGift)}</div>`);
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${formatKMB(Math.round(rewardValue.breakdown.giftPerTask))} per task)</div>`
            );
        }

        // Drops — total over task duration
        if (dropEntries.length > 0) {
            lines.push(
                `<div style="margin-top: 6px; margin-bottom: 4px; color: #aaa;">Drops: ${formatKMB(Math.round(totalDropValue))}</div>`
            );
            for (const d of dropEntries.slice(0, 8)) {
                const taskCount = d.countPerHour * completionHours;
                const taskTotal = d.totalValue * completionHours;
                lines.push(
                    `<div style="margin-left: 10px;">${d.name}: ${taskCount.toFixed(1)} @ ${formatKMB(Math.round(d.unitValue))} = ${formatKMB(Math.round(taskTotal))}</div>`
                );
            }
        }

        // Consumables — total over task duration
        if (consumableEntries.length > 0) {
            lines.push(
                `<div style="margin-top: 6px; margin-bottom: 4px; color: #aaa;">Consumables: -${formatKMB(Math.round(totalConsumableCost))}</div>`
            );
            for (const c of consumableEntries) {
                const taskCount = c.countPerHour * completionHours;
                const taskTotal = c.totalCost * completionHours;
                lines.push(
                    `<div style="margin-left: 10px;">${c.name}: ${taskCount.toFixed(1)} @ ${formatKMB(Math.round(c.unitCost))} = -${formatKMB(Math.round(taskTotal))}</div>`
                );
            }
        }

        breakdown.innerHTML = lines.join('');

        const rerunBtn = document.createElement('button');
        rerunBtn.textContent = 'Re-run';
        rerunBtn.style.cssText =
            'margin-top:6px; font-size:11px; padding:2px 8px; background:#1a3a5c; color:#4a9eff; border:1px solid #4a9eff44; border-radius:3px; cursor:pointer;';
        rerunBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._renderCombatEstimateConfig(container, taskData);
        });
        breakdown.appendChild(rerunBtn);

        mainLine.addEventListener('click', () => {
            const hidden = breakdown.style.display === 'none';
            breakdown.style.display = hidden ? 'block' : 'none';
            mainLine.innerHTML = `⚔ ${formatKMB(totalProfit)} | <span style="display:inline-block; margin-right:0.25em;">⏱</span> ${timeEstimate} ${hidden ? '▾' : '▸'}`;
        });

        container.appendChild(mainLine);

        // Efficiency rating (tokens/hr or gold/hr) — matching skilling task format
        if (config.getSetting('taskEfficiencyRating') && completionSeconds > 0) {
            const ratingMode = config.getSettingValue('taskEfficiencyRatingMode', RATING_MODE_TOKENS);
            const hours = completionSeconds / 3600;
            let ratingValue, unitLabel;

            if (ratingMode === RATING_MODE_GOLD) {
                ratingValue = totalProfit / hours;
                unitLabel = 'gold/hr';
            } else {
                const tokensReceived = rewardValue.breakdown?.tokensReceived ?? 0;
                ratingValue = tokensReceived / hours;
                unitLabel = 'tokens/hr';
            }

            const ratingLine = document.createElement('div');
            ratingLine.className = 'mwi-task-profit-rating';
            ratingLine.style.cssText = 'margin-top: 2px; font-size: 0.7rem;';
            ratingLine.dataset.ratingValue = `${ratingValue}`;
            ratingLine.dataset.ratingMode = ratingMode;
            ratingLine.style.color = config.COLOR_ACCENT;
            ratingLine.textContent = `⚡ ${formatKMB(ratingValue)} ${unitLabel}`;
            container.appendChild(ratingLine);

            this.updateEfficiencyGradientColors();
        }

        container.appendChild(breakdown);

        // Zone summary: show aggregate time to clear all tasks in this zone
        if (mode === 'zone' && simResult && zoneHrid) {
            const taskListNode = document.querySelector(GAME.TASK_LIST);
            const allTaskInfos = taskListNode ? taskListNode.querySelectorAll(GAME.TASK_INFO) : [];
            const zoneTasks = [];

            for (const node of allTaskInfos) {
                const td = this.parseTaskData(node);
                if (!td) continue;
                const m = td.description.match(/^Defeat\s*-\s*(.+)$/i);
                if (!m) continue;
                const mName = m[1].trim();
                const mHrid = dataManager.getMonsterHridFromName(mName);
                if (!mHrid) continue;
                const mZone = dataManager.getCombatZoneForMonster(mHrid);
                if (mZone !== zoneHrid) continue;

                const rem = Math.max((td.quantity ?? 0) - (td.currentProgress ?? 0), 0);
                const mKills = simResult.deaths?.[mHrid] ?? 0;
                const mKillsPerHour = mKills / 1; // SIM_HOURS = 1
                const hoursNeeded = mKillsPerHour > 0 ? rem / mKillsPerHour : Infinity;
                zoneTasks.push({ name: mName, remaining: rem, killsPerHour: mKillsPerHour, hoursNeeded });
            }

            if (zoneTasks.length > 1) {
                const bottleneck = zoneTasks.reduce((a, b) => (a.hoursNeeded > b.hoursNeeded ? a : b));
                const totalSeconds = Math.round(bottleneck.hoursNeeded * 3600);
                const totalFightsPerHour = Object.values(simResult.deaths).reduce((s, v) => s + v, 0);
                const fightsNeeded = Math.round(totalFightsPerHour * bottleneck.hoursNeeded);

                const summary = document.createElement('div');
                summary.style.cssText =
                    'margin-top: 4px; font-size: 0.7rem; color: #aaddff; border-top: 1px solid #333; padding-top: 4px;';
                const zoneName = dataManager.getInitClientData()?.actionDetailMap?.[zoneHrid]?.name || 'Zone';
                summary.textContent = `${zoneName}: ~${formatKMB(fightsNeeded)} fights | ${timeReadable(totalSeconds)} (bottleneck: ${bottleneck.name})`;
                container.appendChild(summary);
            }
        }
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

        // Store machine-readable value for task sorter
        if (completionSeconds !== null) {
            profitContainer.dataset.completionSeconds = completionSeconds;
        }

        const showProfit = config.getSetting('taskProfitCalculator');
        const listeners = new Map();

        if (showProfit) {
            const profitLine = document.createElement('div');
            const profitLineColor = profitData.hasMissingPrices
                ? config.COLOR_ACCENT
                : profitData.totalProfit >= 0
                  ? '#4ade80'
                  : config.COLOR_LOSS;
            profitLine.style.cssText = `
                color: ${profitLineColor};
                cursor: pointer;
                user-select: none;
            `;
            const totalProfitLabel = profitData.hasMissingPrices
                ? '-- ⚠'
                : formatKMB(Math.round(profitData.totalProfit));
            profitLine.innerHTML = `💰 ${totalProfitLabel} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ▸`;

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
            breakdownSection.innerHTML = this.buildBreakdownHTML(profitData);

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
                        const currentText = header.textContent;
                        header.textContent = currentText.replace(isHidden ? '▸' : '▾', isHidden ? '▾' : '▸');
                    }
                };
                header.addEventListener('click', listener);
                listeners.set(header, listener);
            });

            const profitLineListener = (e) => {
                e.stopPropagation();
                const isHidden = breakdownSection.style.display === 'none';
                breakdownSection.style.display = isHidden ? 'block' : 'none';
                const updatedProfitLabel = profitData.hasMissingPrices
                    ? '-- ⚠'
                    : formatKMB(Math.round(profitData.totalProfit));
                profitLine.innerHTML = `💰 ${updatedProfitLabel} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ${isHidden ? '▾' : '▸'}`;
            };
            profitLine.addEventListener('click', profitLineListener);
            listeners.set(profitLine, profitLineListener);

            profitContainer.appendChild(profitLine);
            profitContainer.appendChild(breakdownSection);
        } else if (completionSeconds !== null) {
            const timeLine = document.createElement('div');
            timeLine.style.cssText = `color: ${config.COLOR_ACCENT};`;
            timeLine.innerHTML = `<span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate}`;
            profitContainer.appendChild(timeLine);
        }

        this.eventListeners.set(profitContainer, listeners);

        if (config.getSetting('taskMaterialsIndicator')) {
            const materialsBadge = buildMaterialsBadge(profitData);
            if (materialsBadge) {
                profitContainer.appendChild(materialsBadge);
            }
        }

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
                const ratingValue = formatKMB(ratingData.value);
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
                const value = Number.parseFloat(line.dataset.ratingValue);
                line.style.color = value < 0 ? config.COLOR_LOSS : config.COLOR_ACCENT;
            });
            return;
        }

        if (ratingValues.length === 1) {
            ratingLines.forEach((line) => {
                const value = Number.parseFloat(line.dataset.ratingValue);
                line.style.color = value < 0 ? config.COLOR_LOSS : config.COLOR_ACCENT;
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
        const formatTotalValue = (value) => (showTotals ? formatKMB(value) : '-- ⚠');
        const formatPerActionValue = (value) => (showTotals ? formatKMB(Math.round(value)) : '-- ⚠');

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
        lines.push(`<div style="margin-left: 10px;">Coins: ${formatKMB(profitData.rewards.coins)}</div>`);

        if (!profitData.rewards.error) {
            lines.push(
                `<div style="margin-left: 10px;">Task Tokens: ${formatKMB(profitData.rewards.taskTokens)}</div>`
            );
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.rewards.breakdown.tokensReceived} tokens @ ${formatKMB(Math.round(profitData.rewards.breakdown.tokenValue))} each)</div>`
            );
            lines.push(
                `<div style="margin-left: 10px;">Purple's Gift: ${formatKMB(profitData.rewards.purpleGift)}</div>`
            );
            lines.push(
                `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${formatKMB(Math.round(profitData.rewards.breakdown.giftPerTask))} per task)</div>`
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
                            `<div>• ${output.name} (Base): ${itemsForTask.toFixed(1)} items @ ${formatKMB(Math.round(output.priceEach))}${missingPriceNote} = ${formatKMB(Math.round(revenueForTask))}${dropRateText}</div>`
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
                            `<div>• ${output.name} (Gourmet ${formatPercentage(details.gourmetBonus || 0, 1)}): ${itemsForTask.toFixed(1)} items @ ${formatKMB(Math.round(output.priceEach))}${missingPriceNote} = ${formatKMB(Math.round(revenueForTask))}</div>`
                        );
                    }
                }

                if (details.processingConversions && details.processingConversions.length > 0) {
                    const processingBonusTotal = (details.processingRevenueBonusPerAction || 0) * quantity;
                    const processingLabel = `${processingBonusTotal >= 0 ? '+' : '-'}${formatKMB(Math.abs(Math.round(processingBonusTotal)))}`;
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
                            `<div style="margin-left: 10px;">• ${conversion.rawItem} consumed: -${totalConsumed.toFixed(1)} items @ ${formatKMB(Math.round(conversion.rawPriceEach))}${missingPriceNote} = -${formatKMB(Math.round(consumedRevenue))}</div>`
                        );
                        lines.push(
                            `<div style="margin-left: 10px;">• ${conversion.processedItem} produced: ${totalProduced.toFixed(1)} items @ ${formatKMB(Math.round(conversion.processedPriceEach))}${missingPriceNote} = ${formatKMB(Math.round(producedRevenue))}</div>`
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
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatKMB(Math.round(drop.priceEach))}${missingPriceNote} = ${formatKMB(Math.round(revenueForTask))}</div>`
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
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatKMB(Math.round(drop.priceEach))}${missingPriceNote} = ${formatKMB(Math.round(revenueForTask))}</div>`
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
                    `<div>• ${details.itemName} (Base): ${totalItems.toFixed(1)} items @ ${formatKMB(details.priceEach)}${outputPriceNote} = ${formatKMB(Math.round(totalItems * details.priceEach))}</div>`
                );

                if (details.gourmetBonus > 0) {
                    const bonusItems = outputAmount * details.gourmetBonus * profitData.action.breakdown.quantity;
                    lines.push(
                        `<div>• ${details.itemName} (Gourmet +${formatPercentage(details.gourmetBonus, 1)}): ${bonusItems.toFixed(1)} items @ ${formatKMB(details.priceEach)}${outputPriceNote} = ${formatKMB(Math.round(bonusItems * details.priceEach))}</div>`
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
                            `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatKMB(Math.round(drop.priceEach))}${missingPriceNote} = ${formatKMB(Math.round(revenueForTask))}</div>`
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
                            `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatKMB(Math.round(drop.priceEach))}${missingPriceNote} = ${formatKMB(Math.round(revenueForTask))}</div>`
                        );
                    }
                }
            }

            if (details?.materialCosts) {
                const actionsNeeded = profitData.action.breakdown.quantity;
                const effectiveActionsPerHour = calculateEffectiveActionsPerHour(
                    details.actionsPerHour,
                    details.efficiencyMultiplier || 1
                );
                const hoursNeeded = effectiveActionsPerHour > 0 ? actionsNeeded / effectiveActionsPerHour : 0;
                lines.push(
                    `<div style="margin-top: 4px; color: #aaa;">Material Costs: ${formatTotalValue(profitData.action.breakdown.materialCost)}</div>`
                );

                for (const mat of details.materialCosts) {
                    const totalAmount = mat.amount * actionsNeeded;
                    const totalCost = mat.totalCost * actionsNeeded;
                    const missingPriceNote = mat.missingPrice ? ' ⚠' : '';
                    lines.push(
                        `<div>• ${mat.itemName}: ${totalAmount.toFixed(1)} @ ${formatKMB(Math.round(mat.askPrice))}${missingPriceNote} = ${formatKMB(Math.round(totalCost))}</div>`
                    );
                }

                if (details.teaCosts && details.teaCosts.length > 0) {
                    for (const tea of details.teaCosts) {
                        const drinksNeeded = tea.drinksPerHour * hoursNeeded;
                        const totalCost = tea.totalCost * hoursNeeded;
                        const missingPriceNote = tea.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${tea.itemName}: ${drinksNeeded.toFixed(1)} drinks @ ${formatKMB(Math.round(tea.pricePerDrink))}${missingPriceNote} = ${formatKMB(Math.round(totalCost))}</div>`
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
        const totalProfitColor = profitData.hasMissingPrices
            ? config.COLOR_ACCENT
            : profitData.totalProfit >= 0
              ? '#4ade80'
              : config.COLOR_LOSS;
        lines.push(
            `<div style="font-weight: bold; color: ${totalProfitColor};">Total Profit: ${formatTotalValue(profitData.totalProfit)}</div>`
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
     * Update queued/active indicators on all task cards
     * Compares task action HRIDs against the player's action queue
     */
    updateQueuedIndicators() {
        if (!config.getSetting('taskQueuedIndicator')) {
            document.querySelectorAll('.mwi-task-queued-indicator').forEach((el) => el.remove());
            return;
        }

        const taskListNode = document.querySelector(GAME.TASK_LIST);
        if (!taskListNode) return;

        // Build a Set of actionHrids in the queue, and track which is first (active)
        const currentActions = dataManager.getCurrentActions();
        const queuedActionHrids = new Set(currentActions.map((a) => a.actionHrid));
        const activeActionHrid = currentActions.length > 0 ? currentActions[0].actionHrid : null;

        // Get React fiber root for quest extraction
        const rootEl = document.getElementById('root');
        const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;

        const taskCards = taskListNode.querySelectorAll(GAME.TASK_CARD);
        for (const taskCard of taskCards) {
            this._updateQueuedIndicatorForCard(taskCard, rootFiber, queuedActionHrids, activeActionHrid);
        }
    }

    /**
     * Update queued indicator for a single task card
     * @param {HTMLElement} taskCard - Task card DOM element
     * @param {Object|null} rootFiber - React fiber root
     * @param {Set<string>} queuedActionHrids - Set of action HRIDs in the queue
     * @param {string|null} activeActionHrid - The first (active) action HRID
     */
    _updateQueuedIndicatorForCard(taskCard, rootFiber, queuedActionHrids, activeActionHrid) {
        const existingIndicator = taskCard.querySelector('.mwi-task-queued-indicator');

        // Extract quest data from React fiber tree
        const quest = this._getQuestFromFiber(taskCard, rootFiber);
        if (!quest) {
            if (existingIndicator) existingIndicator.remove();
            return;
        }

        // Determine the actionHrid to match against the queue
        let matchActionHrid = quest.actionHrid || null;

        // For combat tasks, resolve monsterHrid to zone actionHrid
        if (!matchActionHrid && quest.monsterHrid) {
            matchActionHrid = dataManager.getCombatZoneForMonster(quest.monsterHrid);
        }

        if (!matchActionHrid || !queuedActionHrids.has(matchActionHrid)) {
            // Not in queue — remove indicator if present
            if (existingIndicator) existingIndicator.remove();
            return;
        }

        // Determine if active (first in queue) or queued
        const isActive = matchActionHrid === activeActionHrid;
        const label = isActive ? '▶ Active' : '⏸ Queued';
        const color = isActive ? config.COLOR_ACCENT : config.SCRIPT_COLOR_SECONDARY;

        if (existingIndicator) {
            // Update existing indicator's inner badge
            const badge = existingIndicator.querySelector('.mwi-task-queued-badge') || existingIndicator;
            badge.textContent = label;
            badge.style.color = color;
            return;
        }

        // Create wrapper for centering
        const wrapper = document.createElement('div');
        wrapper.className = 'mwi-task-queued-indicator';
        wrapper.style.cssText = `
            display: flex;
            justify-content: center;
            margin-top: 4px;
        `;

        // Create the label badge (shrink-to-fit)
        const badge = document.createElement('span');
        badge.className = 'mwi-task-queued-badge';
        badge.style.cssText = `
            font-size: 0.85rem;
            padding: 2px 8px;
            border-radius: 3px;
            background: rgba(0, 0, 0, 0.3);
        `;
        badge.style.color = color;
        badge.textContent = label;
        wrapper.appendChild(badge);

        // Insert after reroll cost display if present, otherwise as first child of content
        const taskContent = taskCard.querySelector(GAME.TASK_CONTENT);
        if (taskContent) {
            const rerollDisplay = taskCard.querySelector(TOOLASHA.REROLL_COST_DISPLAY);
            if (rerollDisplay && rerollDisplay.nextSibling) {
                taskContent.insertBefore(wrapper, rerollDisplay.nextSibling);
            } else if (rerollDisplay) {
                taskContent.appendChild(wrapper);
            } else {
                taskContent.insertBefore(wrapper, taskContent.firstChild);
            }
        }
    }

    /**
     * Extract quest data from a task card's React fiber tree
     * @param {HTMLElement} taskCard - Task card DOM element
     * @param {Object|null} rootFiber - React fiber root
     * @returns {Object|null} Quest object or null
     */
    _getQuestFromFiber(taskCard, rootFiber) {
        if (!rootFiber) return null;

        const goBtn = taskCard.querySelector('button.Button_success__6d6kU');
        if (!goBtn) return null;

        function walk(fiber, target) {
            if (!fiber) return null;
            if (fiber.stateNode === target) return fiber;
            return walk(fiber.child, target) || walk(fiber.sibling, target);
        }

        const btnFiber = walk(rootFiber, goBtn);
        if (!btnFiber) return null;

        let f = btnFiber.return;
        while (f) {
            if (f.memoizedProps?.characterQuest && f.memoizedProps?.rerollRandomTaskHandler) {
                return f.memoizedProps.characterQuest;
            }
            f = f.return;
        }
        return null;
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
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

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

        // Remove queued indicators
        document.querySelectorAll('.mwi-task-queued-indicator').forEach((el) => el.remove());

        this.isActive = false;
        this.isInitialized = false;
    }
}

const taskProfitDisplay = new TaskProfitDisplay();
taskProfitDisplay.setupSettingListener();

export { calculateTaskCompletionSeconds, calculateTaskEfficiencyRating, getRelativeEfficiencyGradientColor };
export default taskProfitDisplay;
