/**
 * Task Reroll Cost Tracker
 * Tracks and displays reroll costs for tasks using WebSocket messages
 */

import { numberFormatter } from '../../utils/formatters.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import { GAME, TOOLASHA } from '../../utils/selectors.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class TaskRerollTracker {
    constructor() {
        this.taskRerollData = new Map(); // key: taskId, value: { coinRerollCount, cowbellRerollCount }
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.storeName = 'rerollSpending';
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize the tracker
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load saved data from IndexedDB
        await this.loadFromStorage();

        // Register WebSocket listener
        this.registerWebSocketListeners();

        // Register DOM observer for display updates
        this.registerDOMObservers();

        this.isInitialized = true;
    }

    /**
     * Load task reroll data from IndexedDB
     */
    async loadFromStorage() {
        try {
            const savedData = await storage.getJSON('taskRerollData', this.storeName, {});

            // Convert saved object back to Map
            for (const [taskId, data] of Object.entries(savedData)) {
                this.taskRerollData.set(parseInt(taskId), data);
            }
        } catch (error) {
            console.error('[Task Reroll Tracker] Failed to load from storage:', error);
        }
    }

    /**
     * Save task reroll data to IndexedDB
     */
    async saveToStorage() {
        try {
            // Convert Map to plain object for storage
            const dataToSave = {};
            for (const [taskId, data] of this.taskRerollData.entries()) {
                dataToSave[taskId] = data;
            }

            await storage.setJSON('taskRerollData', dataToSave, this.storeName, true);
        } catch (error) {
            console.error('[Task Reroll Tracker] Failed to save to storage:', error);
        }
    }

    /**
     * Clean up observers and handlers
     */
    cleanup() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.timerRegistry.clearAll();
        this.isInitialized = false;
    }

    disable() {
        this.cleanup();
    }

    /**
     * Clean up old task data that's no longer active
     * Keeps only tasks that are currently in characterQuests
     */
    cleanupOldTasks() {
        if (!dataManager.characterData || !dataManager.characterData.characterQuests) {
            return;
        }

        const activeTaskIds = new Set(dataManager.characterData.characterQuests.map((quest) => quest.id));

        let hasChanges = false;

        // Remove tasks that are no longer active
        for (const taskId of this.taskRerollData.keys()) {
            if (!activeTaskIds.has(taskId)) {
                this.taskRerollData.delete(taskId);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this.saveToStorage();
        }
    }

    /**
     * Register WebSocket message listeners
     */
    registerWebSocketListeners() {
        const questsHandler = (data) => {
            if (!data.endCharacterQuests) {
                return;
            }

            let hasChanges = false;

            // Update our task reroll data from server data
            for (const quest of data.endCharacterQuests) {
                const existingData = this.taskRerollData.get(quest.id);
                const newCoinCount = quest.coinRerollCount || 0;
                const newCowbellCount = quest.cowbellRerollCount || 0;

                // Only update if counts increased or task is new
                if (
                    !existingData ||
                    newCoinCount > existingData.coinRerollCount ||
                    newCowbellCount > existingData.cowbellRerollCount
                ) {
                    this.taskRerollData.set(quest.id, {
                        coinRerollCount: Math.max(existingData?.coinRerollCount || 0, newCoinCount),
                        cowbellRerollCount: Math.max(existingData?.cowbellRerollCount || 0, newCowbellCount),
                        monsterHrid: quest.monsterHrid || '',
                        actionHrid: quest.actionHrid || '',
                        goalCount: quest.goalCount || 0,
                    });
                    hasChanges = true;
                }
            }

            // Save to storage if data changed
            if (hasChanges) {
                this.saveToStorage();
            }

            // Clean up old tasks periodically (every 10th update)
            if (Math.random() < 0.1) {
                this.cleanupOldTasks();
            }

            // Wait for game to update DOM before updating displays
            const updateTimeout = setTimeout(() => {
                this.updateAllTaskDisplays();
            }, 250);
            this.timerRegistry.registerTimeout(updateTimeout);
        };

        webSocketHook.on('quests_updated', questsHandler);

        this.unregisterHandlers.push(() => {
            webSocketHook.off('quests_updated', questsHandler);
        });

        // Load existing quest data from DataManager (which receives init_character_data early)
        const initHandler = (data) => {
            if (!data.characterQuests) {
                return;
            }

            let hasChanges = false;

            // Load all quest data into the map
            for (const quest of data.characterQuests) {
                const existingData = this.taskRerollData.get(quest.id);
                const newCoinCount = quest.coinRerollCount || 0;
                const newCowbellCount = quest.cowbellRerollCount || 0;

                // Only update if counts increased or task is new
                if (
                    !existingData ||
                    newCoinCount > existingData.coinRerollCount ||
                    newCowbellCount > existingData.cowbellRerollCount
                ) {
                    this.taskRerollData.set(quest.id, {
                        coinRerollCount: Math.max(existingData?.coinRerollCount || 0, newCoinCount),
                        cowbellRerollCount: Math.max(existingData?.cowbellRerollCount || 0, newCowbellCount),
                        monsterHrid: quest.monsterHrid || '',
                        actionHrid: quest.actionHrid || '',
                        goalCount: quest.goalCount || 0,
                    });
                    hasChanges = true;
                }
            }

            // Save to storage if data changed
            if (hasChanges) {
                this.saveToStorage();
            }

            // Clean up old tasks after loading character data
            this.cleanupOldTasks();

            // Wait for DOM to be ready before updating displays
            const initTimeout = setTimeout(() => {
                this.updateAllTaskDisplays();
            }, 500);
            this.timerRegistry.registerTimeout(initTimeout);
        };

        dataManager.on('character_initialized', initHandler);

        // Check if character data already loaded (in case we missed the event)
        if (dataManager.characterData && dataManager.characterData.characterQuests) {
            initHandler(dataManager.characterData);
        }

        this.unregisterHandlers.push(() => {
            dataManager.off('character_initialized', initHandler);
        });
    }

    /**
     * Register DOM observers for display updates
     */
    registerDOMObservers() {
        // Watch for task list appearing
        const unregisterTaskList = domObserver.onClass('TaskRerollTracker-TaskList', 'TasksPanel_taskList', () => {
            this.updateAllTaskDisplays();
        });
        this.unregisterHandlers.push(unregisterTaskList);

        // Watch for individual tasks appearing
        const unregisterTask = domObserver.onClass('TaskRerollTracker-Task', 'RandomTask_randomTask', () => {
            // Small delay to let task data settle
            const taskTimeout = setTimeout(() => this.updateAllTaskDisplays(), 100);
            this.timerRegistry.registerTimeout(taskTimeout);
        });
        this.unregisterHandlers.push(unregisterTask);
    }

    /**
     * Calculate cumulative gold spent from coin reroll count
     * Formula: 10K, 20K, 40K, 80K, 160K, 320K (doubles, caps at 320K)
     * @param {number} rerollCount - Number of gold rerolls
     * @returns {number} Total gold spent
     */
    calculateGoldSpent(rerollCount) {
        if (rerollCount === 0) return 0;

        let total = 0;
        let cost = 10000; // Start at 10K

        for (let i = 0; i < rerollCount; i++) {
            total += cost;
            // Double the cost, but cap at 320K
            cost = Math.min(cost * 2, 320000);
        }

        return total;
    }

    /**
     * Calculate cumulative cowbells spent from cowbell reroll count
     * Formula: 1, 2, 4, 8, 16, 32 (doubles, caps at 32)
     * @param {number} rerollCount - Number of cowbell rerolls
     * @returns {number} Total cowbells spent
     */
    calculateCowbellSpent(rerollCount) {
        if (rerollCount === 0) return 0;

        let total = 0;
        let cost = 1; // Start at 1

        for (let i = 0; i < rerollCount; i++) {
            total += cost;
            // Double the cost, but cap at 32
            cost = Math.min(cost * 2, 32);
        }

        return total;
    }

    /**
     * Get task ID from DOM element by matching task description
     * @param {Element} taskElement - Task DOM element
     * @returns {number|null} Task ID or null if not found
     */
    getTaskIdFromElement(taskElement) {
        // Get task description and goal count from DOM
        const nameEl = taskElement.querySelector(GAME.TASK_NAME);
        const description = nameEl ? nameEl.textContent.trim() : '';

        if (!description) {
            return null;
        }

        // Get quantity from progress text
        const progressDivs = taskElement.querySelectorAll('div');
        let goalCount = 0;
        for (const div of progressDivs) {
            const text = div.textContent.trim();
            if (text.startsWith('Progress:')) {
                const match = text.match(/Progress:\s*\d+\s*\/\s*(\d+)/);
                if (match) {
                    goalCount = parseInt(match[1]);
                    break;
                }
            }
        }

        // Match against stored task data
        for (const [taskId, taskData] of this.taskRerollData.entries()) {
            // Check if goal count matches
            if (taskData.goalCount !== goalCount) continue;

            // Extract monster/action name from description
            // Description format: "Kill X" or "Do action X times"
            const descLower = description.toLowerCase();

            // For monster tasks, check monsterHrid
            if (taskData.monsterHrid) {
                const monsterName = taskData.monsterHrid.replace('/monsters/', '').replace(/_/g, ' ');
                if (descLower.includes(monsterName.toLowerCase())) {
                    return taskId;
                }
            }

            // For action tasks, check actionHrid
            if (taskData.actionHrid) {
                const actionParts = taskData.actionHrid.split('/');
                const actionName = actionParts[actionParts.length - 1].replace(/_/g, ' ');
                if (descLower.includes(actionName.toLowerCase())) {
                    return taskId;
                }
            }
        }

        return null;
    }

    /**
     * Update display for a specific task
     * @param {Element} taskElement - Task DOM element
     */
    updateTaskDisplay(taskElement) {
        const taskId = this.getTaskIdFromElement(taskElement);
        if (!taskId) {
            // Remove display if task not found in our data
            const existingDisplay = taskElement.querySelector('.mwi-reroll-cost-display');
            if (existingDisplay) {
                existingDisplay.remove();
            }
            return;
        }

        const taskData = this.taskRerollData.get(taskId);
        if (!taskData) {
            return;
        }

        // Calculate totals
        const goldSpent = this.calculateGoldSpent(taskData.coinRerollCount);
        const cowbellSpent = this.calculateCowbellSpent(taskData.cowbellRerollCount);

        // Find or create display element
        let displayElement = taskElement.querySelector(TOOLASHA.REROLL_COST_DISPLAY);

        if (!displayElement) {
            displayElement = document.createElement('div');
            displayElement.className = 'mwi-reroll-cost-display';
            displayElement.style.cssText = `
                color: ${config.SCRIPT_COLOR_SECONDARY};
                font-size: 0.75rem;
                margin-top: 4px;
                padding: 2px 4px;
                border-radius: 3px;
                background: rgba(0, 0, 0, 0.3);
            `;

            // Insert at top of task card
            const taskContent = taskElement.querySelector(GAME.TASK_CONTENT);
            if (taskContent) {
                taskContent.insertBefore(displayElement, taskContent.firstChild);
            } else {
                taskElement.insertBefore(displayElement, taskElement.firstChild);
            }
        }

        // Format display text
        const parts = [];
        if (cowbellSpent > 0) {
            parts.push(`${cowbellSpent}🔔`);
        }
        if (goldSpent > 0) {
            parts.push(`${numberFormatter(goldSpent)}💰`);
        }

        if (parts.length > 0) {
            displayElement.textContent = `Reroll spent: ${parts.join(' + ')}`;
            displayElement.style.display = 'block';
        } else {
            displayElement.style.display = 'none';
        }
    }

    /**
     * Update all task displays
     */
    updateAllTaskDisplays() {
        const taskList = document.querySelector(GAME.TASK_LIST);
        if (!taskList) {
            return;
        }

        const allTasks = taskList.querySelectorAll(GAME.TASK_CARD);
        allTasks.forEach((task) => {
            this.updateTaskDisplay(task);
        });
    }
}

const taskRerollTracker = new TaskRerollTracker();

export default taskRerollTracker;
