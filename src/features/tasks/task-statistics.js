/**
 * Task Statistics
 * Adds a Statistics button to the Tasks panel tab bar
 * Shows task overflow time, expected rewards, and completion estimates
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { calculateTaskProfit, calculateTaskTokenValue, calculateTaskRewardValue } from './task-profit-calculator.js';
import { calculateTaskCompletionSeconds } from './task-profit-display.js';
import { numberFormatter, timeReadable } from '../../utils/formatters.js';
import { TOOLASHA } from '../../utils/selectors.js';

class TaskStatistics {
    constructor() {
        this.isInitialized = false;
        this.overlay = null;
        this.unregisterHandlers = [];
    }

    /**
     * Setup setting change listener (always active)
     */
    setupSettingListener() {
        config.onSettingChange('taskStatistics', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });
    }

    /**
     * Initialize the task statistics feature
     */
    initialize() {
        if (!config.getSetting('taskStatistics')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Try to inject button immediately
        this.injectButton();

        // Watch for Tasks panel appearing
        const unregister = domObserver.onClass('TaskStatistics', 'TasksPanel_tabsComponentContainer', () => {
            this.injectButton();
        });
        this.unregisterHandlers.push(unregister);
    }

    /**
     * Inject Statistics button into Tasks panel tab bar
     */
    injectButton() {
        // Find the tab container within the Tasks panel
        const tabsComponentContainer = document.querySelector('[class*="TasksPanel_tabsComponentContainer"]');
        if (!tabsComponentContainer) {
            return;
        }

        const tabsContainer = tabsComponentContainer.querySelector(
            '[class*="TabsComponent_tabsContainer"] > div > div > div'
        );
        if (!tabsContainer) {
            return;
        }

        // Check if button already exists
        if (tabsContainer.querySelector(TOOLASHA.TASK_STATS_BTN)) {
            return;
        }

        // Create button matching MUI tab styling
        const button = document.createElement('div');
        button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary css-1q2h7u5 toolasha-task-stats-btn';
        button.textContent = 'Statistics';
        button.style.cursor = 'pointer';
        button.onclick = () => this.showPopup();

        // Insert after last tab
        const lastTab = tabsContainer.children[tabsContainer.children.length - 1];
        tabsContainer.insertBefore(button, lastTab.nextSibling);
    }

    /**
     * Remove Statistics button
     */
    removeButton() {
        const buttons = document.querySelectorAll(TOOLASHA.TASK_STATS_BTN);
        for (const button of buttons) {
            button.remove();
        }
    }

    /**
     * Show statistics popup
     */
    async showPopup() {
        // Close any existing popup
        this.closePopup();

        // Ensure market data is loaded for token valuation
        if (!marketAPI.isLoaded()) {
            await marketAPI.fetch();
        }

        const statsData = await this.calculateAllStatistics();
        this.createPopup(statsData);
    }

    /**
     * Calculate all statistics
     * @returns {Object} Statistics data
     */
    async calculateAllStatistics() {
        const overflowData = this.calculateOverflowTime();
        const slotStatus = this.calculateSlotStatus();
        const rewardsSummary = await this.calculateRewardsSummary();

        return {
            overflow: overflowData,
            slots: slotStatus,
            rewards: rewardsSummary,
        };
    }

    /**
     * Get active random tasks from characterQuests
     * @returns {Array} Active random task quests
     */
    getActiveTasks() {
        return (dataManager.characterQuests || []).filter(
            (q) => q.category === '/quest_category/random_task' && q.status === '/quest_status/in_progress'
        );
    }

    /**
     * Calculate task overflow time
     * @returns {Object} Overflow time data
     */
    calculateOverflowTime() {
        const characterInfo = dataManager.characterData?.characterInfo;
        if (!characterInfo) {
            return { error: 'Character info not available' };
        }

        const taskSlotCap = characterInfo.taskSlotCap;
        const taskCooldownHours = characterInfo.taskCooldownHours;
        const lastTaskTimestamp = characterInfo.lastTaskTimestamp;
        const unreadTaskCount = characterInfo.unreadTaskCount || 0;
        const activeTaskCount = this.getActiveTasks().length;

        const taskCount = unreadTaskCount + activeTaskCount;
        const availableSlots = taskSlotCap - taskCount;
        const taskCooldownMs = taskCooldownHours * 3.6e6;
        const lastTaskDate = new Date(lastTaskTimestamp).getTime();
        const overflowDate = new Date(lastTaskDate + (availableSlots + 1) * taskCooldownMs);

        const now = Date.now();
        const msUntilOverflow = overflowDate.getTime() - now;

        return {
            overflowDate,
            msUntilOverflow,
            isOverflowing: msUntilOverflow <= 0,
            taskSlotCap,
            taskCooldownHours,
            usedSlots: taskCount,
            availableSlots,
        };
    }

    /**
     * Calculate slot status
     * @returns {Object} Slot status data
     */
    calculateSlotStatus() {
        const characterInfo = dataManager.characterData?.characterInfo;
        if (!characterInfo) {
            return { error: 'Character info not available' };
        }

        const unreadTaskCount = characterInfo.unreadTaskCount || 0;
        const activeTaskCount = this.getActiveTasks().length;

        return {
            used: unreadTaskCount + activeTaskCount,
            total: characterInfo.taskSlotCap,
            unread: unreadTaskCount,
            active: activeTaskCount,
        };
    }

    /**
     * Calculate aggregated rewards summary across all active tasks
     * @returns {Object} Rewards summary
     */
    async calculateRewardsSummary() {
        const activeTasks = this.getActiveTasks();

        let totalCoins = 0;
        let totalTokens = 0;
        const taskDetails = [];

        // Parse rewards from itemRewardsJSON
        for (const quest of activeTasks) {
            let coinReward = 0;
            let tokenReward = 0;

            if (quest.itemRewardsJSON) {
                try {
                    const rewards = JSON.parse(quest.itemRewardsJSON);
                    for (const reward of rewards) {
                        if (reward.itemHrid === '/items/coin') {
                            coinReward = reward.count;
                        } else if (reward.itemHrid === '/items/task_token') {
                            tokenReward = reward.count;
                        }
                    }
                } catch (error) {
                    console.error('[TaskStatistics] Failed to parse itemRewardsJSON:', error);
                }
            }

            totalCoins += coinReward;
            totalTokens += tokenReward;

            // Determine task type and description
            const isCombat = quest.type === '/quest_type/monster';
            const actionHrid = quest.actionHrid || '';
            const monsterHrid = quest.monsterHrid || '';

            // Get display name
            let taskName = '';
            if (isCombat && monsterHrid) {
                const monsterDetails = dataManager.getInitClientData()?.combatMonsterDetailMap?.[monsterHrid];
                taskName = monsterDetails?.name || monsterHrid.split('/').pop();
            } else if (actionHrid) {
                const actionDetails = dataManager.getInitClientData()?.actionDetailMap?.[actionHrid];
                taskName = actionDetails?.name || actionHrid.split('/').pop();
            }

            // Calculate action profit for non-combat tasks
            let actionProfit = null;
            let completionSeconds = null;

            if (!isCombat && actionHrid) {
                try {
                    const taskData = {
                        description: taskName,
                        coinReward,
                        taskTokenReward: tokenReward,
                        quantity: quest.goalCount,
                        currentProgress: quest.currentCount || 0,
                    };
                    const profitData = await calculateTaskProfit(taskData);
                    if (profitData && profitData.action) {
                        actionProfit = profitData.action.totalValue || profitData.action.totalProfit || 0;
                        completionSeconds = calculateTaskCompletionSeconds(profitData);
                    }
                } catch (error) {
                    console.error('[TaskStatistics] Failed to calculate profit for task:', taskName, error);
                }
            }

            taskDetails.push({
                name: taskName,
                isCombat,
                coinReward,
                tokenReward,
                actionProfit,
                completionSeconds,
                goalCount: quest.goalCount,
                currentCount: quest.currentCount || 0,
            });
        }

        // Token valuation
        const tokenValue = calculateTaskTokenValue();
        const rewardValue = calculateTaskRewardValue(totalCoins, totalTokens);

        // Sum action profits
        let totalActionProfit = 0;
        let totalCompletionSeconds = 0;
        let hasActionProfit = false;

        for (const detail of taskDetails) {
            if (detail.actionProfit !== null) {
                totalActionProfit += detail.actionProfit;
                hasActionProfit = true;
            }
            if (detail.completionSeconds !== null) {
                totalCompletionSeconds += detail.completionSeconds;
            }
        }

        return {
            totalCoins,
            totalTokens,
            tokenValue,
            rewardValue,
            totalActionProfit: hasActionProfit ? totalActionProfit : null,
            totalCompletionSeconds: totalCompletionSeconds > 0 ? totalCompletionSeconds : null,
            combinedTotal: rewardValue.total + (hasActionProfit ? totalActionProfit : 0),
            taskDetails,
        };
    }

    /**
     * Create and display the statistics popup
     * @param {Object} statsData - Calculated statistics data
     */
    createPopup(statsData) {
        const textColor = config.COLOR_TEXT_PRIMARY;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'toolasha-task-stats-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Create popup container
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #1a1a1a;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            padding: 20px;
            max-width: 500px;
            max-height: 90%;
            overflow-y: auto;
            color: ${textColor};
            min-width: 360px;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #3a3a3a;
            padding-bottom: 10px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'Task Statistics';
        title.style.cssText = `margin: 0; color: ${textColor}; font-size: 24px;`;

        const closeButton = document.createElement('button');
        closeButton.textContent = '\u00d7';
        closeButton.style.cssText = `
            background: none;
            border: none;
            color: ${textColor};
            font-size: 32px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        `;
        closeButton.onclick = () => this.closePopup();

        header.appendChild(title);
        header.appendChild(closeButton);
        popup.appendChild(header);

        // Content sections
        popup.appendChild(this.createOverflowSection(statsData.overflow, textColor));
        popup.appendChild(this.createRewardsSection(statsData.rewards, textColor));
        popup.appendChild(this.createActionProfitSection(statsData.rewards));
        popup.appendChild(this.createCompletionTimeSection(statsData.rewards, textColor));

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.closePopup();
            }
        };

        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    /**
     * Create a section card element
     * @param {string} titleText - Section title
     * @returns {HTMLElement} Section container
     */
    createSection(titleText) {
        const section = document.createElement('div');
        section.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #3a3a3a;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        `;

        const sectionTitle = document.createElement('div');
        sectionTitle.textContent = titleText;
        sectionTitle.style.cssText = `
            color: ${config.COLOR_ACCENT};
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
        `;
        section.appendChild(sectionTitle);

        return section;
    }

    /**
     * Create a row with label and value
     * @param {string} label - Row label
     * @param {string} value - Row value
     * @param {string} valueColor - Value text color
     * @returns {HTMLElement} Row element
     */
    createRow(label, value, valueColor = config.COLOR_TEXT_PRIMARY) {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 3px 0;
            font-size: 13px;
        `;

        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.style.color = config.COLOR_TEXT_SECONDARY;

        const valueSpan = document.createElement('span');
        valueSpan.textContent = value;
        valueSpan.style.color = valueColor;

        row.appendChild(labelSpan);
        row.appendChild(valueSpan);

        return row;
    }

    /**
     * Create overflow time section
     * @param {Object} overflow - Overflow data
     * @param {string} textColor - Text color
     * @returns {HTMLElement} Section element
     */
    createOverflowSection(overflow, textColor) {
        const section = this.createSection('Task Slots');

        if (overflow.error) {
            section.appendChild(this.createRow('Status', overflow.error, config.COLOR_LOSS));
            return section;
        }

        section.appendChild(this.createRow('Slots Used', `${overflow.usedSlots} / ${overflow.taskSlotCap}`, textColor));
        section.appendChild(this.createRow('Available', `${overflow.availableSlots}`, textColor));
        section.appendChild(
            this.createRow('Cooldown', `${overflow.taskCooldownHours}h per task`, config.COLOR_TEXT_SECONDARY)
        );

        // Overflow time
        if (overflow.isOverflowing) {
            section.appendChild(this.createRow('Status', 'Tasks full!', config.COLOR_LOSS));
        } else {
            const overflowTimeStr = timeReadable(overflow.msUntilOverflow / 1000);
            const overflowDateStr = overflow.overflowDate.toLocaleString();
            section.appendChild(this.createRow('Full in', overflowTimeStr, config.COLOR_INFO));
            section.appendChild(this.createRow('Full at', overflowDateStr, config.COLOR_TEXT_SECONDARY));
        }

        return section;
    }

    /**
     * Create rewards summary section
     * @param {Object} rewards - Rewards data
     * @param {string} textColor - Text color
     * @returns {HTMLElement} Section element
     */
    createRewardsSection(rewards, textColor) {
        const section = this.createSection('Expected Rewards');

        section.appendChild(this.createRow('Total Coins', numberFormatter(rewards.totalCoins), config.COLOR_GOLD));
        section.appendChild(this.createRow('Total Task Tokens', String(rewards.totalTokens), textColor));

        if (!rewards.rewardValue.error) {
            const tokenValueStr = `${numberFormatter(Math.round(rewards.rewardValue.breakdown.tokenValue))} each`;
            section.appendChild(this.createRow('Token Value', tokenValueStr, config.COLOR_TEXT_SECONDARY));
            section.appendChild(
                this.createRow(
                    'Tokens Value',
                    numberFormatter(Math.round(rewards.rewardValue.taskTokens)),
                    config.COLOR_PROFIT
                )
            );
            section.appendChild(
                this.createRow(
                    "Purple's Gift",
                    numberFormatter(Math.round(rewards.rewardValue.purpleGift)),
                    config.COLOR_ESSENCE
                )
            );

            // Separator
            const separator = document.createElement('div');
            separator.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
            section.appendChild(separator);

            section.appendChild(
                this.createRow(
                    'Total Reward Value',
                    numberFormatter(Math.round(rewards.rewardValue.total)),
                    config.COLOR_ACCENT
                )
            );
        } else {
            section.appendChild(this.createRow('Token Value', 'Loading...', config.COLOR_TEXT_SECONDARY));
        }

        return section;
    }

    /**
     * Create action profit section with per-task breakdown
     * @param {Object} rewards - Rewards data with task details
     * @returns {HTMLElement} Section element
     */
    createActionProfitSection(rewards) {
        const section = this.createSection('Action Profit');

        for (const detail of rewards.taskDetails) {
            const profitStr = detail.isCombat
                ? 'N/A (combat)'
                : detail.actionProfit !== null
                  ? numberFormatter(Math.round(detail.actionProfit))
                  : 'N/A';

            const profitColor = detail.isCombat
                ? config.COLOR_TEXT_SECONDARY
                : detail.actionProfit !== null && detail.actionProfit >= 0
                  ? config.COLOR_PROFIT
                  : detail.actionProfit !== null
                    ? config.COLOR_LOSS
                    : config.COLOR_TEXT_SECONDARY;

            section.appendChild(this.createRow(detail.name, profitStr, profitColor));
        }

        // Separator and total
        const separator = document.createElement('div');
        separator.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
        section.appendChild(separator);

        const totalStr =
            rewards.totalActionProfit !== null ? numberFormatter(Math.round(rewards.totalActionProfit)) : 'N/A';
        const totalColor =
            rewards.totalActionProfit !== null && rewards.totalActionProfit >= 0
                ? config.COLOR_PROFIT
                : rewards.totalActionProfit !== null
                  ? config.COLOR_LOSS
                  : config.COLOR_TEXT_SECONDARY;

        section.appendChild(this.createRow('Total Action Profit', totalStr, totalColor));

        // Combined total
        const separator2 = document.createElement('div');
        separator2.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
        section.appendChild(separator2);

        section.appendChild(
            this.createRow('Combined Total', numberFormatter(Math.round(rewards.combinedTotal)), config.COLOR_ACCENT)
        );

        return section;
    }

    /**
     * Create completion time section
     * @param {Object} rewards - Rewards data with task details
     * @param {string} textColor - Text color
     * @returns {HTMLElement} Section element
     */
    createCompletionTimeSection(rewards, textColor) {
        const section = this.createSection('Completion Time');

        for (const detail of rewards.taskDetails) {
            const timeStr = detail.isCombat
                ? 'N/A (combat)'
                : detail.completionSeconds !== null
                  ? timeReadable(detail.completionSeconds)
                  : 'N/A';

            const progressStr = detail.currentCount > 0 ? ` (${detail.currentCount}/${detail.goalCount})` : '';

            section.appendChild(
                this.createRow(
                    detail.name + progressStr,
                    timeStr,
                    detail.isCombat ? config.COLOR_TEXT_SECONDARY : textColor
                )
            );
        }

        // Separator and total
        const separator = document.createElement('div');
        separator.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
        section.appendChild(separator);

        const totalTimeStr =
            rewards.totalCompletionSeconds !== null ? timeReadable(rewards.totalCompletionSeconds) : 'N/A';

        section.appendChild(this.createRow('Total (non-combat)', totalTimeStr, config.COLOR_INFO));

        return section;
    }

    /**
     * Close the statistics popup
     */
    closePopup() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    /**
     * Disable and cleanup
     */
    disable() {
        this.closePopup();
        this.removeButton();

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        this.isInitialized = false;
    }
}

const taskStatistics = new TaskStatistics();

taskStatistics.setupSettingListener();

export default taskStatistics;
