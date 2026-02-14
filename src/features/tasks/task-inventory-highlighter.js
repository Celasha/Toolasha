/**
 * Task Inventory Highlighter
 * Dims inventory items that are NOT needed for current non-combat tasks
 */

import domObserver from '../../core/dom-observer.js';
import { calculateTaskProfit } from './task-profit-calculator.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { GAME } from '../../utils/selectors.js';

class TaskInventoryHighlighter {
    constructor() {
        this.initialized = false;
        this.highlightButton = null;
        this.unregisterObserver = null;
        this.isHighlightActive = false;
        this.timerRegistry = createTimerRegistry();
        this.neededItems = new Map(); // Map<itemHrid, quantity>
    }

    /**
     * Initialize the feature
     */
    initialize() {
        if (this.initialized) return;

        // Watch for task panel header to add button
        this.watchTaskPanel();

        this.initialized = true;
    }

    /**
     * Watch for task panel to appear
     */
    watchTaskPanel() {
        this.unregisterObserver = domObserver.onClass(
            'TaskInventoryHighlighter',
            'TasksPanel_taskSlotCount',
            (headerElement) => {
                this.addHighlightButton(headerElement);
            }
        );
    }

    /**
     * Add highlight button to task panel header
     */
    addHighlightButton(headerElement) {
        // Check if button already exists
        if (this.highlightButton && document.contains(this.highlightButton)) {
            return;
        }

        // Create button
        this.highlightButton = document.createElement('button');
        this.highlightButton.className = 'Button_button__1Fe9z Button_small__3fqC7';
        this.highlightButton.textContent = 'Highlight Task Items';
        this.highlightButton.style.marginLeft = '8px';
        this.highlightButton.setAttribute('data-mwi-task-highlight', 'true');

        // Button click handler
        this.highlightButton.addEventListener('click', () => this.toggleHighlight());

        // Insert after Sort Tasks button if it exists, otherwise append
        const sortButton = headerElement.querySelector('[data-mwi-task-sort]');
        if (sortButton) {
            sortButton.after(this.highlightButton);
        } else {
            headerElement.appendChild(this.highlightButton);
        }
    }

    /**
     * Toggle inventory highlighting on/off
     */
    async toggleHighlight() {
        if (this.isHighlightActive) {
            this.clearHighlight();
        } else {
            await this.applyHighlight();
        }
    }

    /**
     * Apply highlighting to inventory
     */
    async applyHighlight() {
        // Calculate needed materials from all tasks
        await this.calculateNeededMaterials();

        if (this.neededItems.size === 0) {
            console.warn('[TaskInventoryHighlighter] No materials needed for current tasks');
            return;
        }

        // Apply opacity to inventory items
        this.applyInventoryOpacity();

        // Update button state
        this.isHighlightActive = true;
        this.highlightButton.textContent = 'Clear Highlight';
        this.highlightButton.style.backgroundColor = '#22c55e';
    }

    /**
     * Clear inventory highlighting
     */
    clearHighlight() {
        // Reset all inventory item opacities
        const inventoryItems = document.querySelectorAll('[class*="Inventory_items"] [class*="Item_item"]');
        for (const item of inventoryItems) {
            item.style.opacity = '';
        }

        // Clear needed items map
        this.neededItems.clear();

        // Update button state
        this.isHighlightActive = false;
        this.highlightButton.textContent = 'Highlight Task Items';
        this.highlightButton.style.backgroundColor = '';
    }

    /**
     * Calculate materials needed for all non-combat tasks
     */
    async calculateNeededMaterials() {
        this.neededItems.clear();

        // Get task list container
        const taskListNode = document.querySelector(GAME.TASK_LIST);
        if (!taskListNode) {
            return;
        }

        // Get all task info nodes
        const taskNodes = taskListNode.querySelectorAll(GAME.TASK_INFO);

        for (const taskNode of taskNodes) {
            const taskData = this.parseTaskCard(taskNode);

            if (!taskData || taskData.isCombat) {
                continue; // Skip combat tasks
            }

            // Calculate profit data (which includes material costs)
            const profitData = await calculateTaskProfit(taskData);

            if (!profitData || !profitData.action) {
                continue;
            }

            // Extract materials from profitData
            this.extractMaterialsFromProfitData(profitData);
        }
    }

    /**
     * Extract required materials from profit calculation data
     * @param {Object} profitData - Profit calculation result
     */
    extractMaterialsFromProfitData(profitData) {
        const action = profitData.action;
        const quantity = action.breakdown?.quantity || 0;

        if (quantity <= 0) {
            return;
        }

        const details = action.details;
        if (!details) {
            return;
        }

        // Extract materials from production tasks (materialCosts)
        if (details.materialCosts) {
            for (const material of details.materialCosts) {
                if (!material.itemHrid) {
                    continue;
                }

                // Material amount is per-action, multiply by task quantity
                const neededQty = material.amount * quantity;

                // Add to needed items map
                const currentQty = this.neededItems.get(material.itemHrid) || 0;
                this.neededItems.set(material.itemHrid, currentQty + neededQty);
            }
        }

        // Extract tea/drink costs (teaCosts are per hour, need to calculate hours)
        if (details.teaCosts && details.teaCosts.length > 0) {
            // Calculate hours needed for task
            const actionsPerHour = details.actionsPerHour || 0;
            const efficiencyMultiplier = details.efficiencyMultiplier || 1;
            const effectiveActionsPerHour = actionsPerHour * efficiencyMultiplier;
            const hoursNeeded = effectiveActionsPerHour > 0 ? quantity / effectiveActionsPerHour : 0;

            for (const tea of details.teaCosts) {
                if (!tea.itemHrid) {
                    continue;
                }

                const neededQty = tea.drinksPerHour * hoursNeeded;
                const currentQty = this.neededItems.get(tea.itemHrid) || 0;
                this.neededItems.set(tea.itemHrid, currentQty + neededQty);
            }
        }
    }

    /**
     * Apply opacity to inventory items based on needed materials
     */
    applyInventoryOpacity() {
        // Query all inventory items (Item_itemContainer contains the item)
        const inventoryItems = document.querySelectorAll('[class*="Inventory_items"] [class*="Item_itemContainer"]');

        for (const itemContainer of inventoryItems) {
            const itemHrid = this.getItemHridFromContainer(itemContainer);

            if (!itemHrid) {
                continue;
            }

            // Get the icon element to apply opacity
            const iconElement = itemContainer.querySelector('[class*="Item_item"]');
            if (!iconElement) {
                continue;
            }

            // If item is NOT needed for tasks, dim it
            if (!this.neededItems.has(itemHrid)) {
                iconElement.style.opacity = '0.25';
            } else {
                // Item IS needed, keep full opacity
                iconElement.style.opacity = '1';
            }
        }
    }

    /**
     * Get item HRID from inventory item container element
     * @param {HTMLElement} itemContainer - Inventory item container element
     * @returns {string|null} Item HRID or null
     */
    getItemHridFromContainer(itemContainer) {
        // Find the <use> element inside the container's SVG
        const useElement = itemContainer.querySelector('svg use');
        if (!useElement) {
            return null;
        }

        const href = useElement.getAttribute('href');
        if (!href) {
            return null;
        }

        // Extract item name from href (e.g., #radiant_fiber)
        const match = href.match(/#(.+)$/);
        if (!match) {
            return null;
        }

        const itemName = match[1];
        const itemHrid = `/items/${itemName}`;
        return itemHrid;
    }

    /**
     * Parse task node to extract task data
     * @param {HTMLElement} taskNode - Task info node element
     * @returns {Object|null} Task data or null
     */
    parseTaskCard(taskNode) {
        // Get task description
        const nameNode = taskNode.querySelector(GAME.TASK_NAME_DIV);
        if (!nameNode) {
            return null;
        }

        const description = nameNode.textContent.trim();

        // Check if combat task (contains "Defeat")
        const isCombat = description.includes('Defeat');

        // Get quantity from progress (plain div with text "Progress: 0 / 1562")
        let quantity = 0;
        let currentProgress = 0;
        const taskInfoDivs = taskNode.querySelectorAll('div');
        for (const div of taskInfoDivs) {
            const text = div.textContent.trim();
            if (text.startsWith('Progress:')) {
                const progressMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
                if (progressMatch) {
                    currentProgress = parseInt(progressMatch[1], 10);
                    quantity = parseInt(progressMatch[2], 10);
                }
                break;
            }
        }

        // Get rewards
        const rewardsNode = taskNode.querySelector(GAME.TASK_REWARDS);
        if (!rewardsNode) {
            return null;
        }

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

        return {
            description,
            coinReward,
            taskTokenReward,
            quantity,
            currentProgress,
            isCombat,
        };
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
     * Cleanup when disabled
     */
    cleanup() {
        this.clearHighlight();

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.highlightButton && this.highlightButton.parentElement) {
            this.highlightButton.remove();
        }

        this.highlightButton = null;
        this.timerRegistry.clearAll();
        this.initialized = false;
    }

    /**
     * Disable the feature
     */
    disable() {
        this.cleanup();
    }
}

const taskInventoryHighlighter = new TaskInventoryHighlighter();

export default taskInventoryHighlighter;
