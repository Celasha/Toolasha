/**
 * Task Sorter
 * Sorts tasks in the task board by skill type
 */

import { GAME } from '../../utils/selectors.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';

class TaskSorter {
    constructor() {
        this.initialized = false;
        this.sortButton = null;

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

        console.log('[TaskSorter] Initializing...');

        // Wait for DOM to be ready, then add sort button
        this.waitForTaskPanel();

        this.initialized = true;
    }

    /**
     * Wait for task panel to appear, then add sort button
     */
    waitForTaskPanel() {
        const checkPanel = () => {
            const taskPanelHeader = document.querySelector(GAME.TASK_PANEL);
            if (taskPanelHeader) {
                this.addSortButton(taskPanelHeader);
            } else {
                // Check again in 100ms
                setTimeout(checkPanel, 100);
            }
        };

        checkPanel();
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
        console.log('[TaskSorter] Sort button added');
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
            console.log('[TaskSorter] Task list not found');
            return;
        }

        // Get all task cards
        const taskCards = Array.from(taskList.querySelectorAll(GAME.TASK_CARD));
        if (taskCards.length === 0) {
            console.log('[TaskSorter] No tasks to sort');
            return;
        }

        console.log(`[TaskSorter] Sorting ${taskCards.length} tasks...`);

        // Sort the cards
        taskCards.sort((a, b) => this.compareTaskCards(a, b));

        // Re-append in sorted order
        taskCards.forEach(card => taskList.appendChild(card));

        console.log('[TaskSorter] Tasks sorted');
    }

    /**
     * Cleanup
     */
    cleanup() {
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
