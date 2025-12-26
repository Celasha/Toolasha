/**
 * Task Profit Display
 * Shows profit calculation on task cards
 * Expandable breakdown on click
 */

import config from '../../core/config.js';
import { numberFormatter } from '../../utils/formatters.js';
import { calculateTaskProfit } from './task-profit-calculator.js';

/**
 * TaskProfitDisplay class manages task profit UI
 */
class TaskProfitDisplay {
    constructor() {
        this.isActive = false;
        this.observer = null;
    }

    /**
     * Initialize task profit display
     */
    initialize() {
        if (!config.getSetting('taskProfitCalculator')) {
            return;
        }

        // Set up MutationObserver to watch for task panel changes
        this.setupTaskPanelObserver();

        this.isActive = true;
    }

    /**
     * Set up observer to watch for task panel updates
     */
    setupTaskPanelObserver() {
        this.observer = new MutationObserver(() => {
            this.updateTaskProfits();
        });

        // Start observing the document body for changes
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial update
        this.updateTaskProfits();
    }

    /**
     * Update all task profit displays
     */
    updateTaskProfits() {
        if (!config.getSetting('taskProfitCalculator')) {
            return;
        }

        const taskListNode = document.querySelector('.TasksPanel_taskList__2xh4k');
        if (!taskListNode) return;

        const taskNodes = taskListNode.querySelectorAll('.RandomTask_taskInfo__1uasf');
        for (const taskNode of taskNodes) {
            // Skip if already processed
            if (taskNode.querySelector('.mwi-task-profit')) {
                continue;
            }

            this.addProfitToTask(taskNode);
        }
    }

    /**
     * Add profit display to a task card
     * @param {Element} taskNode - Task card DOM element
     */
    addProfitToTask(taskNode) {
        // Parse task data from DOM
        const taskData = this.parseTaskData(taskNode);
        if (!taskData) {
            return;
        }

        // Calculate profit
        const profitData = calculateTaskProfit(taskData);

        // Don't show anything for combat tasks
        if (profitData === null) {
            return;
        }

        // Display profit
        this.displayTaskProfit(taskNode, profitData);
    }

    /**
     * Parse task data from DOM
     * @param {Element} taskNode - Task card DOM element
     * @returns {Object|null} {description, coinReward, taskTokenReward}
     */
    parseTaskData(taskNode) {
        // Get task description
        const nameNode = taskNode.querySelector('.RandomTask_name__1hl1b');
        if (!nameNode) return null;

        const description = nameNode.textContent.trim();

        // Get rewards
        const rewardsNode = taskNode.querySelector('.RandomTask_rewards__YZk7D');
        if (!rewardsNode) return null;

        let coinReward = 0;
        let taskTokenReward = 0;

        const itemContainers = rewardsNode.querySelectorAll('.Item_itemContainer__x7kH1');
        for (const container of itemContainers) {
            const useElement = container.querySelector('use');
            if (!useElement) continue;

            const href = useElement.href.baseVal;

            if (href.includes('coin')) {
                const countNode = container.querySelector('.Item_count__1HVvv');
                if (countNode) {
                    coinReward = this.parseItemCount(countNode.textContent);
                }
            } else if (href.includes('task_token')) {
                const countNode = container.querySelector('.Item_count__1HVvv');
                if (countNode) {
                    taskTokenReward = this.parseItemCount(countNode.textContent);
                }
            }
        }

        return {
            description,
            coinReward,
            taskTokenReward
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
     * Display profit on task card
     * @param {Element} taskNode - Task card DOM element
     * @param {Object} profitData - Profit calculation result
     */
    displayTaskProfit(taskNode, profitData) {
        const actionNode = taskNode.querySelector('.RandomTask_action__3eC6o');
        if (!actionNode) return;

        // Create profit container
        const profitContainer = document.createElement('div');
        profitContainer.className = 'mwi-task-profit';
        profitContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
        `;

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

        // Create main profit display
        const profitLine = document.createElement('div');
        profitLine.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            cursor: pointer;
            user-select: none;
        `;
        profitLine.textContent = `💰 Total Profit: ${numberFormatter(profitData.totalProfit)} ▸`;

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

        // Toggle breakdown on click
        profitLine.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = breakdownSection.style.display === 'none';
            breakdownSection.style.display = isHidden ? 'block' : 'none';
            profitLine.textContent = `💰 Total Profit: ${numberFormatter(profitData.totalProfit)} ${isHidden ? '▾' : '▸'}`;
        });

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

        // Task Rewards section
        lines.push('<div style="margin-bottom: 4px; color: #aaa;">Task Rewards:</div>');
        lines.push(`<div style="margin-left: 10px;">Coins: ${numberFormatter(profitData.rewards.coins)}</div>`);
        lines.push(`<div style="margin-left: 10px;">Task Tokens: ${numberFormatter(profitData.rewards.taskTokens)}</div>`);
        lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.rewards.breakdown.tokensReceived} tokens @ ${numberFormatter(profitData.rewards.breakdown.tokenValue.toFixed(0))} each)</div>`);
        lines.push(`<div style="margin-left: 10px;">Purple's Gift: ${numberFormatter(profitData.rewards.purpleGift)}</div>`);
        lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${numberFormatter(profitData.rewards.breakdown.giftPerTask.toFixed(0))} per task)</div>`);

        // Action profit section
        lines.push('<div style="margin-top: 6px; margin-bottom: 4px; color: #aaa;">Action Profit:</div>');

        if (profitData.type === 'gathering') {
            lines.push(`<div style="margin-left: 10px;">Gathering Value: ${numberFormatter(profitData.action.totalValue)}</div>`);
            lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${numberFormatter(profitData.action.breakdown.perAction.toFixed(0))} each)</div>`);
        } else if (profitData.type === 'production') {
            lines.push(`<div style="margin-left: 10px;">Output Value: ${numberFormatter(profitData.action.breakdown.outputValue)}</div>`);
            lines.push(`<div style="margin-left: 10px;">Material Cost: ${numberFormatter(profitData.action.breakdown.materialCost)}</div>`);
            lines.push(`<div style="margin-left: 10px;">Net Production: ${numberFormatter(profitData.action.totalProfit)}</div>`);
            lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${numberFormatter(profitData.action.breakdown.perAction.toFixed(0))} each)</div>`);
        }

        // Total
        lines.push('<div style="border-top: 1px solid #555; margin-top: 6px; padding-top: 4px;"></div>');
        lines.push(`<div style="font-weight: bold; color: ${config.SCRIPT_COLOR_MAIN};">Total Profit: ${numberFormatter(profitData.totalProfit)}</div>`);

        return lines.join('');
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Remove all profit displays
        document.querySelectorAll('.mwi-task-profit').forEach(el => el.remove());

        this.isActive = false;
    }
}

// Create and export singleton instance
const taskProfitDisplay = new TaskProfitDisplay();

export default taskProfitDisplay;
