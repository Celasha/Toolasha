/**
 * Task Sorter
 * Sorts tasks in the task board by skill type
 */

import { GAME } from '../../utils/selectors.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import taskIcons from './task-icons.js';
import taskIconFilters from './task-icon-filters.js';
import domObserver from '../../core/dom-observer.js';

class TaskSorter {
    constructor() {
        this.initialized = false;
        this.sortButton = null;
        this.unregisterObserver = null;

        // Task type ordering (combat tasks go to bottom)
        this.TASK_ORDER = {
            Milking: 1,
            Foraging: 2,
            Woodcutting: 3,
            Cheesesmithing: 4,
            Crafting: 5,
            Tailoring: 6,
            Cooking: 7,
            Brewing: 8,
            Alchemy: 9,
            Enhancing: 10,
            Defeat: 99, // Combat tasks at bottom
        };
    }

    /**
     * Initialize the task sorter
     */
    initialize() {
        if (this.initialized) return;

        // Use DOM observer to watch for task panel appearing
        this.watchTaskPanel();

        this.initialized = true;
    }

    /**
     * Watch for task panel to appear
     */
    watchTaskPanel() {
        // Register observer for task panel header (watch for the class name, not the selector)
        this.unregisterObserver = domObserver.onClass(
            'TaskSorter',
            'TasksPanel_taskSlotCount', // Just the class name, not [class*="..."]
            (headerElement) => {
                this.addSortButton(headerElement);
            }
        );
    }

    /**
     * Add sort button to task panel header
     */
    addSortButton(headerElement) {
        // Check if button already exists
        if (this.sortButton && document.contains(this.sortButton)) {
            return;
        }

        // Create sort button
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'Button_button__1Fe9z Button_small__3fqC7';
        this.sortButton.textContent = 'Sort Tasks';
        this.sortButton.style.marginLeft = '8px';
        this.sortButton.setAttribute('data-mwi-task-sort', 'true');
        this.sortButton.addEventListener('click', () => this.sortTasks());

        headerElement.appendChild(this.sortButton);

        // Add task icon filters if enabled
        if (config.isFeatureEnabled('taskIcons')) {
            taskIconFilters.addFilterBar(headerElement);
        }
    }

    /**
     * Parse task card to extract skill type and task name
     */
    parseTaskCard(taskCard) {
        const nameElement = taskCard.querySelector('[class*="RandomTask_name"]');
        if (!nameElement) return null;

        const fullText = nameElement.textContent.trim();

        // Format is "SkillType - TaskName"
        const match = fullText.match(/^(.+?)\s*-\s*(.+)$/);
        if (!match) return null;

        const [, skillType, taskName] = match;

        return {
            skillType: skillType.trim(),
            taskName: taskName.trim(),
            fullText,
        };
    }

    /**
     * Check if task is completed (has Claim Reward button)
     */
    isTaskCompleted(taskCard) {
        const claimButton = taskCard.querySelector('button.Button_button__1Fe9z.Button_buy__3s24l');
        return claimButton && claimButton.textContent.includes('Claim Reward');
    }

    /**
     * Get sort order for a task
     */
    getTaskOrder(taskCard) {
        const parsed = this.parseTaskCard(taskCard);
        if (!parsed) {
            return { skillOrder: 999, taskName: '', isCombat: false, monsterSortIndex: 999, isCompleted: false };
        }

        const skillOrder = this.TASK_ORDER[parsed.skillType] || 999;
        const isCombat = parsed.skillType === 'Defeat';
        const isCompleted = this.isTaskCompleted(taskCard);

        // For combat tasks, get monster sort index from game data
        let monsterSortIndex = 999;
        if (isCombat) {
            // Extract monster name from task name (e.g., "Granite GolemZ9" -> "Granite Golem")
            const monsterName = this.extractMonsterName(parsed.taskName);
            if (monsterName) {
                const monsterHrid = dataManager.getMonsterHridFromName(monsterName);
                if (monsterHrid) {
                    monsterSortIndex = dataManager.getMonsterSortIndex(monsterHrid);
                }
            }
        }

        return {
            skillOrder,
            taskName: parsed.taskName,
            skillType: parsed.skillType,
            isCombat,
            monsterSortIndex,
            isCompleted,
        };
    }

    /**
     * Extract monster name from combat task name
     * @param {string} taskName - Task name (e.g., "Granite Golem Z9")
     * @returns {string|null} Monster name or null if not found
     */
    extractMonsterName(taskName) {
        // Combat task format from parseTaskCard: "[Monster Name]Z[number]" (may or may not have space)
        // Strip the zone suffix "Z\d+" from the end
        const match = taskName.match(/^(.+?)\s*Z\d+$/);
        if (match) {
            return match[1].trim();
        }

        // Fallback: return as-is if no zone suffix found
        return taskName.trim();
    }

    /**
     * Compare two task cards for sorting
     */
    compareTaskCards(cardA, cardB) {
        const orderA = this.getTaskOrder(cardA);
        const orderB = this.getTaskOrder(cardB);

        // First: Sort by completion status (incomplete tasks first, completed tasks last)
        if (orderA.isCompleted !== orderB.isCompleted) {
            return orderA.isCompleted ? 1 : -1;
        }

        // Second: Sort by skill type (combat vs non-combat)
        if (orderA.skillOrder !== orderB.skillOrder) {
            return orderA.skillOrder - orderB.skillOrder;
        }

        // Third: Within combat tasks, sort by zone progression (sortIndex)
        if (orderA.isCombat && orderB.isCombat) {
            if (orderA.monsterSortIndex !== orderB.monsterSortIndex) {
                return orderA.monsterSortIndex - orderB.monsterSortIndex;
            }
        }

        // Fourth: Within same skill type (or same zone for combat), sort alphabetically by task name
        return orderA.taskName.localeCompare(orderB.taskName);
    }

    /**
     * Sort all tasks in the task board
     */
    sortTasks() {
        const taskList = document.querySelector(GAME.TASK_LIST);
        if (!taskList) {
            return;
        }

        // Get all task cards
        const taskCards = Array.from(taskList.querySelectorAll(GAME.TASK_CARD));
        if (taskCards.length === 0) {
            return;
        }

        // Sort the cards
        taskCards.sort((a, b) => this.compareTaskCards(a, b));

        // Re-append in sorted order
        taskCards.forEach((card) => taskList.appendChild(card));

        // After sorting, React may re-render task cards and remove our icons
        // Clear the processed markers and force icon re-processing
        if (config.isFeatureEnabled('taskIcons')) {
            // Use taskIcons module's method to clear markers
            taskIcons.clearAllProcessedMarkers();

            // Trigger icon re-processing
            // Use setTimeout to ensure React has finished any re-rendering
            setTimeout(() => {
                taskIcons.processAllTaskCards();
            }, 100);
        }
    }

    /**
     * Cleanup
     */
    cleanup() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.sortButton && document.contains(this.sortButton)) {
            this.sortButton.remove();
        }
        this.sortButton = null;
        this.initialized = false;
    }
}

// Create singleton instance
const taskSorter = new TaskSorter();

export default taskSorter;
