/**
 * Task Reroll Cost Tracker
 * Tracks and displays reroll costs for tasks
 */

import { numberFormatter } from '../../utils/formatters.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';

class TaskRerollTracker {
    constructor() {
        this.rerollSpending = new Map(); // key: slotIndex, value: { goldSpent: total, cowbellSpent: total }
        this.taskIdentities = new Map(); // key: slotIndex, value: "description|quantity" for tracking task identity
        this.previousTaskCount = 0; // Track task count to detect deletions/completions
        this.unregisterHandlers = []; // Store unregister functions
        this.isInitialized = false;
        this.isUpdatingAllDisplays = false; // Guard flag to prevent double updates
    }

    /**
     * Initialize the tracker (async to load from IndexedDB)
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            // Load saved spending data from centralized storage
            await this.loadFromStorage();

            // Register with centralized DOM observer
            this.registerObservers();

            // Add initial displays to existing tasks
            this.updateAllTaskDisplays();

            // Attach listeners to any reroll containers already in the DOM
            this.attachExistingRerollListeners();

            // Add beforeunload handler to force immediate save when page closes
            window.addEventListener('beforeunload', () => {
                this.forceSave();
            });

            this.isInitialized = true;
        } catch (error) {
            console.error('[Task Reroll Tracker] Initialization failed:', error);
            // Fall back to in-memory only if storage fails
            this.isInitialized = true;
        }
    }

    /**
     * Clean up observers and handlers
     */
    cleanup() {
        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];
        this.isInitialized = false;
    }

    /**
     * Attach listeners to reroll containers already in DOM at initialization
     */
    attachExistingRerollListeners() {
        const rerollContainers = document.querySelectorAll('[class*="rerollOptionsContainer"]');
        rerollContainers.forEach(container => {
            this.handleRerollOptionsAppeared(container);
        });
    }

    /**
     * Load spending data from storage
     * @returns {Promise<void>}
     */
    async loadFromStorage() {
        try {
            const data = await storage.get('spending_data', 'rerollSpending', null);
            if (data) {
                this.rerollSpending = new Map(data);
            }
        } catch (error) {
            console.error('[Task Reroll Tracker] Failed to load from storage:', error);
            this.rerollSpending = new Map();
        }
    }

    /**
     * Save spending data to storage (debounced)
     */
    saveToStorage() {
        const data = Array.from(this.rerollSpending.entries());
        storage.set('spending_data', data, 'rerollSpending'); // Debounced by default
    }

    /**
     * Force immediate save (used on page unload)
     */
    forceSave() {
        const data = Array.from(this.rerollSpending.entries());
        storage.set('spending_data', data, 'rerollSpending', true); // Immediate save
    }

    /**
     * Register observers with centralized DOM observer
     */
    registerObservers() {
        // Watch for task list appearing (user navigated to tasks panel)
        const unregisterTaskList = domObserver.onClass(
            'TaskRerollTracker-TaskList',
            'TasksPanel_taskList',
            () => {
                this.updateAllTaskDisplays();
                this.snapshotTaskIdentities(); // Initial snapshot
            }
        );
        this.unregisterHandlers.push(unregisterTaskList);

        // Watch for reroll options container appearing
        const unregisterReroll = domObserver.onClass(
            'TaskRerollTracker-RerollOptions',
            'rerollOptionsContainer',
            (container) => {
                this.handleRerollOptionsAppeared(container);
            }
        );
        this.unregisterHandlers.push(unregisterReroll);

        // Watch for task changes (additions, removals, rerolls)
        const unregisterTaskChanges = domObserver.onClass(
            'TaskRerollTracker-TaskChanges',
            'RandomTask_randomTask',
            () => {
                this.handleTaskChange();
            }
        );
        this.unregisterHandlers.push(unregisterTaskChanges);
    }

    /**
     * Handle reroll options container appearing
     */
    handleRerollOptionsAppeared(container) {
        // Find which task this belongs to
        const taskElement = container.closest('[class*="RandomTask_randomTask"]');
        if (!taskElement) return;

        const slotIndex = this.getTaskSlotIndex(taskElement);
        if (slotIndex === -1) return;

        // Attach click listeners to payment buttons
        this.attachPaymentListeners(container, slotIndex);

        // Update display
        this.updateTaskDisplay(taskElement, slotIndex);
    }

    /**
     * Get currency type from button SVG icon
     * @param {Element} button - Button element
     * @returns {string|null} 'gold', 'cowbell', or null
     */
    getCurrencyFromButton(button) {
        const svg = button.querySelector('svg use');
        const href = svg ? svg.getAttribute('href') : null;
        if (!href) return null;

        if (href.includes('cowbell')) return 'cowbell';
        if (href.includes('coin') || href.includes('gold')) return 'gold';
        return null;
    }

    /**
     * Attach click listeners to payment buttons
     */
    attachPaymentListeners(container, slotIndex) {
        const buttons = container.querySelectorAll('button');

        buttons.forEach(button => {
            const currency = this.getCurrencyFromButton(button);
            if (!currency) return;

            // Use capturing phase and immediately defer all work
            button.addEventListener('click', () => {
                // Capture cost immediately (synchronously) before button text changes
                const buttonText = button.textContent || '';
                const costMatch = buttonText.match(/([\d.]+)\s*([KM])?/);

                let cost = null;
                if (costMatch) {
                    const number = parseFloat(costMatch[1]);
                    const suffix = costMatch[2];

                    if (suffix === 'K') {
                        cost = Math.floor(number * 1000);
                    } else if (suffix === 'M') {
                        cost = Math.floor(number * 1000000);
                    } else {
                        cost = Math.floor(number);
                    }
                }

                if (!cost) return;

                // Defer ALL work to next event loop to avoid blocking game UI
                queueMicrotask(() => {
                    try {
                        // Record spending
                        this.recordSpending(slotIndex, currency, cost);

                        // Defer display update even further
                        setTimeout(() => {
                            try {
                                const taskElement = container.closest('[class*="RandomTask_randomTask"]');
                                if (taskElement && document.body.contains(taskElement)) {
                                    this.updateTaskDisplay(taskElement, slotIndex);
                                }
                            } catch (error) {
                                console.error('[Task Reroll Tracker] Error updating display:', error);
                            }
                        }, 500);
                    } catch (error) {
                        console.error('[Task Reroll Tracker] Error recording spending:', error);
                    }
                });
            }, { passive: true }); // Passive listener to avoid blocking
        });
    }

    /**
     * Record spending for a slot
     */
    recordSpending(slotIndex, currency, cost) {
        if (!this.rerollSpending.has(slotIndex)) {
            this.rerollSpending.set(slotIndex, { goldSpent: 0, cowbellSpent: 0 });
        }

        const spending = this.rerollSpending.get(slotIndex);
        if (currency === 'gold') {
            spending.goldSpent += cost;
        } else if (currency === 'cowbell') {
            spending.cowbellSpent += cost;
        }

        // Debounced save to storage (waits 3 seconds of inactivity)
        this.saveToStorage();
    }

    /**
     * Get task slot index from DOM position
     */
    getTaskSlotIndex(taskElement) {
        const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
        if (!taskList) return -1;

        const allTasks = Array.from(taskList.querySelectorAll('[class*="RandomTask_randomTask"]'));
        return allTasks.indexOf(taskElement);
    }

    /**
     * Update display for a specific task
     */
    updateTaskDisplay(taskElement, slotIndex) {
        // Get spending totals
        const spending = this.rerollSpending.get(slotIndex) || { goldSpent: 0, cowbellSpent: 0 };

        // Find or create display element
        let displayElement = taskElement.querySelector('.mwi-reroll-cost-display');

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
            const taskContent = taskElement.querySelector('[class*="RandomTask_content"]');
            if (taskContent) {
                taskContent.insertBefore(displayElement, taskContent.firstChild);
            } else {
                taskElement.insertBefore(displayElement, taskElement.firstChild);
            }
        }

        // Format display text - show total spent
        const parts = [];
        if (spending.cowbellSpent > 0) {
            parts.push(`${spending.cowbellSpent}🔔`);
        }
        if (spending.goldSpent > 0) {
            parts.push(`${numberFormatter(spending.goldSpent)}💰`);
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
        // Guard against double execution
        if (this.isUpdatingAllDisplays) return;
        this.isUpdatingAllDisplays = true;

        const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
        if (taskList) {
            const allTasks = taskList.querySelectorAll('[class*="RandomTask_randomTask"]');
            allTasks.forEach((task, index) => {
                this.updateTaskDisplay(task, index);
            });
        }

        this.isUpdatingAllDisplays = false;
    }

    /**
     * Handle task changes (detect rerolls vs deletions/completions)
     */
    handleTaskChange() {
        const currentCount = document.querySelectorAll('[class*="RandomTask_randomTask"]').length;

        if (currentCount < this.previousTaskCount) {
            // Task count decreased = deletion or completion
            this.handleTaskRemoval();
        } else if (currentCount > 0) {
            // Task count same or increased = reroll or new task
            // Just update identities snapshot for next comparison
            this.snapshotTaskIdentities();
        }

        this.previousTaskCount = currentCount;
    }

    /**
     * Snapshot current task identities for tracking
     */
    snapshotTaskIdentities() {
        this.taskIdentities.clear();

        const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
        if (!taskList) return;

        const allTasks = taskList.querySelectorAll('[class*="RandomTask_randomTask"]');
        allTasks.forEach((task, slot) => {
            const taskKey = this.getTaskKey(task);
            if (taskKey) {
                this.taskIdentities.set(slot, taskKey);
            }
        });

        this.previousTaskCount = allTasks.length;
    }

    /**
     * Handle task removal - preserve costs for remaining tasks
     */
    handleTaskRemoval() {
        // Build map of task identities to their costs
        const costsByIdentity = new Map();
        for (const [slot, taskKey] of this.taskIdentities.entries()) {
            const costs = this.rerollSpending.get(slot);
            if (costs) {
                costsByIdentity.set(taskKey, costs);
            }
        }

        // Build new cost map based on current tasks
        const newCosts = new Map();
        const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
        if (taskList) {
            const allTasks = taskList.querySelectorAll('[class*="RandomTask_randomTask"]');
            allTasks.forEach((task, newSlot) => {
                const taskKey = this.getTaskKey(task);

                // If this task existed before, keep its costs
                if (taskKey && costsByIdentity.has(taskKey)) {
                    newCosts.set(newSlot, costsByIdentity.get(taskKey));
                }
                // If it's a new task, it starts at 0 (not in map)
            });
        }

        // Replace cost map
        this.rerollSpending = newCosts;

        // Update identities for next comparison
        this.snapshotTaskIdentities();

        // Update displays
        this.updateAllTaskDisplays();

        // Save to storage immediately (not debounced) to prevent data loss on quick refresh
        this.forceSave();
    }

    /**
     * Extract task identity key from DOM element
     * @param {Element} taskElement - Task DOM element
     * @returns {string|null} Task key as "description|quantity"
     */
    getTaskKey(taskElement) {
        const nameEl = taskElement.querySelector('[class*="RandomTask_name"]');
        const description = nameEl ? nameEl.textContent.trim() : '';

        if (!description) return null;

        // Get quantity from progress text
        const progressDivs = taskElement.querySelectorAll('div');
        let quantity = 0;
        for (const div of progressDivs) {
            const text = div.textContent.trim();
            if (text.startsWith('Progress:')) {
                const match = text.match(/Progress:\s*\d+\s*\/\s*(\d+)/);
                if (match) {
                    quantity = parseInt(match[1]);
                    break;
                }
            }
        }

        return `${description}|${quantity}`;
    }

    /**
     * Reset reroll spending for a task slot
     */
    resetSlot(slotIndex) {
        this.rerollSpending.delete(slotIndex);
        this.saveToStorage();
    }

    /**
     * Reset all reroll spending
     */
    resetAll() {
        this.rerollSpending.clear();
        this.saveToStorage();
        this.updateAllTaskDisplays();
    }
}

// Create singleton instance
const taskRerollTracker = new TaskRerollTracker();

export default taskRerollTracker;
