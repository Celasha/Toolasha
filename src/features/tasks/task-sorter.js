/**
 * Task Sorter
 * Sorts tasks in the task board by skill type
 */

import { GAME } from '../../utils/selectors.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import taskIcons from './task-icons.js';
import domObserver from '../../core/dom-observer.js';

class TaskSorter {
    constructor() {
        this.initialized = false;
        this.sortButton = null;
        this.unregisterObserver = null;

        // Task type ordering (combat tasks go to bottom)
        this.TASK_ORDER = {
            'Milking': 1,
            'Foraging': 2,
            'Woodcutting': 3,
            'Cheesesmithing': 4,
            'Crafting': 5,
            'Tailoring': 6,
            'Cooking': 7,
            'Brewing': 8,
            'Alchemy': 9,
            'Enhancing': 10,
            'Defeat': 99  // Combat tasks at bottom
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
        // Register observer for task panel header
        this.unregisterObserver = domObserver.onSelector(
            'TaskSorter',
            GAME.TASK_PANEL,
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
        this.sortButton.addEventListener('click', () => this.sortTasks());

        headerElement.appendChild(this.sortButton);
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
            fullText
        };
    }

    /**
     * Get sort order for a task
     */
    getTaskOrder(taskCard) {
        const parsed = this.parseTaskCard(taskCard);
        if (!parsed) return 999; // Unknown tasks go to end

        const skillOrder = this.TASK_ORDER[parsed.skillType] || 999;

        return {
            skillOrder,
            taskName: parsed.taskName,
            skillType: parsed.skillType
        };
    }

    /**
     * Compare two task cards for sorting
     */
    compareTaskCards(cardA, cardB) {
        const orderA = this.getTaskOrder(cardA);
        const orderB = this.getTaskOrder(cardB);

        // First sort by skill type
        if (orderA.skillOrder !== orderB.skillOrder) {
            return orderA.skillOrder - orderB.skillOrder;
        }

        // Within same skill type, sort alphabetically by task name
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
        taskCards.forEach(card => taskList.appendChild(card));

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
