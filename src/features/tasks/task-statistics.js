/**
 * Task Statistics
 * Adds a Statistics button to the Tasks panel tab bar
 * Shows task overflow time, expected rewards, and completion estimates
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { calculateTaskProfit, calculateTaskTokenValue, calculateTaskRewardValue } from './task-profit-calculator.js';
import { calculateTaskCompletionSeconds } from './task-profit-display.js';
import { computeAllZoneProgress } from './task-zone-progress.js';
import { timeReadable, formatKMB, formatDateTime } from '../../utils/formatters.js';
import { getActionName, getMonsterName } from '../../utils/game-i18n.js';
import { TOOLASHA } from '../../utils/selectors.js';

/**
 * Find the game's root React component instance that exposes handleGoToAction, by walking
 * the fiber tree. Same pattern used by crafting-plan-display.js / pinned-actions-page.js.
 */
function getGameObject() {
    const root = document.getElementById('root');
    const rootFiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    const stack = [rootFiber];
    while (stack.length > 0) {
        const fiber = stack.pop();
        if (typeof fiber?.stateNode?.handleGoToAction === 'function') return fiber.stateNode;
        if (fiber?.sibling) stack.push(fiber.sibling);
        if (fiber?.child) stack.push(fiber.child);
    }
    return null;
}

class TaskStatistics {
    constructor() {
        this.isInitialized = false;
        this.overlay = null;
        this.unregisterHandlers = [];
        this.popupGeneration = 0;
        this.sections = {};
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
        button.textContent = t('combatStatsUi.statisticsButtonLabel');
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
     * Show statistics popup: render the skeleton synchronously, then fill sections
     * progressively as their data arrives. A generation token discards stale async
     * results after the popup has been closed and reopened.
     */
    async showPopup() {
        // Close any existing popup
        this.closePopup();
        const generation = ++this.popupGeneration;

        this.createPopupSkeleton();

        await Promise.all([this.fillRewardSections(generation), this.fillZoneProgressSection(generation)]);
    }

    /**
     * Whether an async filler may still write to the DOM.
     * @param {number} generation - Generation captured when the filler started
     * @returns {boolean} True when this popup instance is still the current one
     */
    isGenerationCurrent(generation) {
        return generation === this.popupGeneration && this.overlay !== null;
    }

    /**
     * Build the popup skeleton: overlay, popup, header, grid content, and the five
     * sections. Task slots are filled synchronously; the rest show placeholders.
     */
    createPopupSkeleton() {
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

        // Create popup container: responsive width, two columns on wide screens
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #1a1a1a;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            padding: 20px;
            width: min(860px, 94vw);
            max-height: 90%;
            overflow-y: auto;
            color: ${textColor};
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
        title.textContent = t('taskStatistics.popupTitle');
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

        // Responsive grid content: two columns on wide screens, one on narrow/mobile
        const content = document.createElement('div');
        content.className = 'toolasha-task-stats-content';
        content.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 12px;
            align-items: start;
        `;

        this.sections = {};

        // Task slots: pure sync data, real values immediately
        const overflowSection = this.createOverflowSection(this.calculateOverflowTime(), textColor);
        overflowSection.style.marginBottom = '0';
        this.sections.overflow = overflowSection;
        content.appendChild(overflowSection);

        // Everything else starts as a placeholder and fills in asynchronously
        const placeholderTitles = {
            rewards: t('taskStatistics.expectedRewardsHeader'),
            actionProfit: this.notApplicableHeader(t('taskStatistics.actionProfitHeader')),
            completionTime: this.notApplicableHeader(t('taskStatistics.completionTimeHeader')),
            zoneProgress: t('taskStatistics.zoneProgressHeader'),
        };
        for (const key of ['rewards', 'actionProfit', 'completionTime', 'zoneProgress']) {
            const section = this.createSection(placeholderTitles[key]);
            section.style.marginBottom = '0';
            if (key === 'zoneProgress') {
                section.style.gridColumn = '1 / -1';
            }
            section.appendChild(this.createPlaceholderRow());
            this.sections[key] = section;
            content.appendChild(section);
        }

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.closePopup();
            }
        };

        popup.appendChild(content);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    /**
     * Section header for computations that cannot cover combat tasks.
     * The bracketed suffix is part of the localized string itself (each locale
     * supplies its own punctuation/spacing), so nothing is hardcoded here.
     * @param {string} titleText - Base section title
     * @returns {string} Title with the "not applicable to combat" suffix
     */
    notApplicableHeader(titleText) {
        return `${titleText}${t('taskStatistics.combatNotApplicableLabel')}`;
    }

    /**
     * Placeholder row shown while a section's data is being computed.
     * @returns {HTMLElement} Row element
     */
    createPlaceholderRow() {
        return this.createRow('', t('taskStatistics.computingPlaceholder'), config.COLOR_TEXT_SECONDARY);
    }

    /**
     * Build an error section for a failed async computation.
     * @param {string} titleText - Section title
     * @returns {HTMLElement} Section element with an error row
     */
    createErrorSection(titleText) {
        const section = this.createSection(titleText);
        section.style.marginBottom = '0';
        section.appendChild(
            this.createRow(t('marketHistory.columnStatus'), t('taskStatistics.computeFailedMessage'), config.COLOR_LOSS)
        );
        return section;
    }

    /**
     * Replace a registered section element in the DOM and update the registry.
     * @param {string} key - Key in this.sections
     * @param {HTMLElement} newSection - Replacement section
     */
    swapSection(key, newSection) {
        const current = this.sections[key];
        if (!current) return;
        current.replaceWith(newSection);
        this.sections[key] = newSection;
    }

    /**
     * Compute the rewards summary and fill the three reward-derived sections.
     * @param {number} generation - Generation token captured at popup open
     */
    async fillRewardSections(generation) {
        try {
            // Ensure market data is loaded for token valuation
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch();
            }
            const rewardsSummary = await this.calculateRewardsSummary();
            if (!this.isGenerationCurrent(generation)) return;

            const textColor = config.COLOR_TEXT_PRIMARY;
            this.swapSection('rewards', this.createRewardsSection(rewardsSummary, textColor));
            this.swapSection('actionProfit', this.createActionProfitSection(rewardsSummary));
            this.swapSection('completionTime', this.createCompletionTimeSection(rewardsSummary, textColor));
        } catch (error) {
            console.error('[TaskStatistics] Reward sections failed:', error);
            if (!this.isGenerationCurrent(generation)) return;

            this.swapSection('rewards', this.createErrorSection(t('taskStatistics.expectedRewardsHeader')));
            this.swapSection(
                'actionProfit',
                this.createErrorSection(this.notApplicableHeader(t('taskStatistics.actionProfitHeader')))
            );
            this.swapSection(
                'completionTime',
                this.createErrorSection(this.notApplicableHeader(t('taskStatistics.completionTimeHeader')))
            );
        }
    }

    /**
     * Compute per-planet combat task progress and fill (or remove) its section.
     * @param {number} generation - Generation token captured at popup open
     */
    async fillZoneProgressSection(generation) {
        try {
            const zoneProgress = await computeAllZoneProgress();
            if (!this.isGenerationCurrent(generation)) return;

            if (zoneProgress.length === 0) {
                this.sections.zoneProgress?.remove();
                this.sections.zoneProgress = null;
                return;
            }
            this.swapSection('zoneProgress', this.createZoneProgressSection(zoneProgress, config.COLOR_TEXT_PRIMARY));
        } catch (error) {
            console.error('[TaskStatistics] Zone progress section failed:', error);
            if (!this.isGenerationCurrent(generation)) return;
            this.swapSection('zoneProgress', this.createErrorSection(t('taskStatistics.zoneProgressHeader')));
        }
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
            return { error: t('taskStatistics.characterInfoNotAvailable') };
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
            return { error: t('taskStatistics.characterInfoNotAvailable') };
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
                taskName = getMonsterName(monsterHrid, monsterDetails?.name || monsterHrid.split('/').pop());
            } else if (actionHrid) {
                const actionDetails = dataManager.getInitClientData()?.actionDetailMap?.[actionHrid];
                taskName = getActionName(actionHrid, actionDetails?.name || actionHrid.split('/').pop());
            }

            // Calculate action profit for non-combat tasks
            let actionProfit = null;
            let completionSeconds = null;

            if (!isCombat && actionHrid) {
                try {
                    // Locale-independent quest info straight from the quest data
                    const questInfo = {
                        actionHrid: quest.actionHrid || null,
                        monsterHrid: quest.monsterHrid || null,
                    };

                    // Get action details to build proper task description
                    const actionDetails = dataManager.getInitClientData()?.actionDetailMap?.[actionHrid];
                    if (actionDetails) {
                        // Build description in format "Skill - Action Name" as a text fallback
                        // Extract skill name from type field like '/action_types/foraging'
                        const skillName = actionDetails.type?.split('/').pop() || '';
                        const formattedSkill =
                            skillName.charAt(0).toUpperCase() + skillName.slice(1).replace(/_/g, ' ');
                        const actionName = actionDetails.name;
                        const description = `${formattedSkill} - ${actionName}`;

                        const taskData = {
                            description,
                            coinReward,
                            taskTokenReward: tokenReward,
                            quantity: quest.goalCount,
                            currentProgress: quest.currentCount || 0,
                        };
                        const profitData = await calculateTaskProfit(taskData, questInfo);
                        if (profitData && profitData.action) {
                            actionProfit = profitData.action.totalValue || profitData.action.totalProfit || 0;
                            completionSeconds = calculateTaskCompletionSeconds(profitData);
                        }
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
        const section = this.createSection(t('taskStatistics.taskSlotsHeader'));

        if (overflow.error) {
            section.appendChild(this.createRow(t('marketHistory.columnStatus'), overflow.error, config.COLOR_LOSS));
            return section;
        }

        section.appendChild(
            this.createRow(
                t('taskStatistics.slotsUsedLabel'),
                `${overflow.usedSlots} / ${overflow.taskSlotCap}`,
                textColor
            )
        );
        section.appendChild(
            this.createRow(t('taskStatistics.availableLabel'), `${overflow.availableSlots}`, textColor)
        );
        section.appendChild(
            this.createRow(
                t('labSim.buffCooldown'),
                t('taskStatistics.cooldownPerTaskValue', { hours: overflow.taskCooldownHours }),
                config.COLOR_TEXT_SECONDARY
            )
        );

        // Overflow time
        if (overflow.isOverflowing) {
            section.appendChild(
                this.createRow(t('marketHistory.columnStatus'), t('taskStatistics.tasksFullMessage'), config.COLOR_LOSS)
            );
        } else {
            const overflowTimeStr = timeReadable(overflow.msUntilOverflow / 1000);
            const overflowDateStr = formatDateTime(overflow.overflowDate);
            section.appendChild(this.createRow(t('taskStatistics.fullInLabel'), overflowTimeStr, config.COLOR_INFO));
            section.appendChild(
                this.createRow(t('taskStatistics.fullAtLabel'), overflowDateStr, config.COLOR_TEXT_SECONDARY)
            );
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
        const section = this.createSection(t('taskStatistics.expectedRewardsHeader'));

        section.appendChild(
            this.createRow(t('taskStatistics.totalCoinsLabel'), formatKMB(rewards.totalCoins), config.COLOR_GOLD)
        );
        section.appendChild(
            this.createRow(t('taskStatistics.totalTaskTokensLabel'), String(rewards.totalTokens), textColor)
        );

        if (!rewards.rewardValue.error) {
            const tokenValueStr = t('taskStatistics.tokenValueEachSuffix', {
                value: formatKMB(Math.round(rewards.rewardValue.breakdown.tokenValue)),
            });
            section.appendChild(
                this.createRow(t('taskStatistics.tokenValueLabel'), tokenValueStr, config.COLOR_TEXT_SECONDARY)
            );
            section.appendChild(
                this.createRow(
                    t('taskStatistics.tokensValueLabel'),
                    formatKMB(Math.round(rewards.rewardValue.taskTokens)),
                    config.COLOR_PROFIT
                )
            );
            section.appendChild(
                this.createRow(
                    t('taskStatistics.purpleGiftLabel'),
                    formatKMB(Math.round(rewards.rewardValue.purpleGift)),
                    config.COLOR_ESSENCE
                )
            );

            // Separator
            const separator = document.createElement('div');
            separator.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
            section.appendChild(separator);

            section.appendChild(
                this.createRow(
                    t('taskStatistics.totalRewardValueLabel'),
                    formatKMB(Math.round(rewards.rewardValue.total)),
                    config.COLOR_ACCENT
                )
            );
        } else {
            section.appendChild(
                this.createRow(
                    t('taskStatistics.tokenValueLabel'),
                    t('taskProfitDisplay.loadingEllipsis'),
                    config.COLOR_TEXT_SECONDARY
                )
            );
        }

        return section;
    }

    /**
     * Create action profit section with per-task breakdown
     * @param {Object} rewards - Rewards data with task details
     * @returns {HTMLElement} Section element
     */
    createActionProfitSection(rewards) {
        const section = this.createSection(this.notApplicableHeader(t('taskStatistics.actionProfitHeader')));

        // Combat tasks cannot produce action profit; they are represented by the
        // header suffix instead of individual N/A rows.
        const nonCombatDetails = rewards.taskDetails.filter((detail) => !detail.isCombat);

        for (const detail of nonCombatDetails) {
            const profitStr =
                detail.actionProfit !== null
                    ? formatKMB(Math.round(detail.actionProfit))
                    : t('combatSimUi.notAvailableLabel');

            const profitColor =
                detail.actionProfit !== null && detail.actionProfit >= 0
                    ? config.COLOR_PROFIT
                    : detail.actionProfit !== null
                      ? config.COLOR_LOSS
                      : config.COLOR_TEXT_SECONDARY;

            section.appendChild(this.createRow(detail.name, profitStr, profitColor));
        }

        if (nonCombatDetails.length === 0) return section;

        // Separator and total
        const separator = document.createElement('div');
        separator.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
        section.appendChild(separator);

        const totalStr =
            rewards.totalActionProfit !== null
                ? formatKMB(Math.round(rewards.totalActionProfit))
                : t('combatSimUi.notAvailableLabel');
        const totalColor =
            rewards.totalActionProfit !== null && rewards.totalActionProfit >= 0
                ? config.COLOR_PROFIT
                : rewards.totalActionProfit !== null
                  ? config.COLOR_LOSS
                  : config.COLOR_TEXT_SECONDARY;

        section.appendChild(this.createRow(t('taskStatistics.totalActionProfitLabel'), totalStr, totalColor));

        // Combined total
        const separator2 = document.createElement('div');
        separator2.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
        section.appendChild(separator2);

        section.appendChild(
            this.createRow(
                t('taskStatistics.combinedTotalLabel'),
                formatKMB(Math.round(rewards.combinedTotal)),
                config.COLOR_ACCENT
            )
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
        const section = this.createSection(this.notApplicableHeader(t('taskStatistics.completionTimeHeader')));

        // Combat tasks cannot produce completion time estimates; they are represented
        // by the header suffix instead of individual N/A rows.
        const nonCombatDetails = rewards.taskDetails.filter((detail) => !detail.isCombat);

        for (const detail of nonCombatDetails) {
            const timeStr =
                detail.completionSeconds !== null
                    ? timeReadable(detail.completionSeconds)
                    : t('combatSimUi.notAvailableLabel');

            const progressStr =
                detail.currentCount > 0
                    ? t('taskStatistics.progressSuffix', { current: detail.currentCount, goal: detail.goalCount })
                    : '';

            section.appendChild(this.createRow(detail.name + progressStr, timeStr, textColor));
        }

        if (nonCombatDetails.length === 0) return section;

        // Separator and total
        const separator = document.createElement('div');
        separator.style.cssText = 'border-top: 1px solid #3a3a3a; margin: 6px 0;';
        section.appendChild(separator);

        const totalTimeStr =
            rewards.totalCompletionSeconds !== null
                ? timeReadable(rewards.totalCompletionSeconds)
                : t('combatSimUi.notAvailableLabel');

        section.appendChild(this.createRow(t('taskStatistics.totalNonCombatLabel'), totalTimeStr, config.COLOR_INFO));

        return section;
    }

    /**
     * Create per-zone combat task progress section: for every zone with at least one active
     * combat task, shows the total fights needed to clear everything there and the time that
     * will take. Clicking a row navigates to that zone with the fight count pre-filled.
     * @param {Array<Object>} zoneProgress - Per-zone progress data from computeAllZoneProgress()
     * @param {string} textColor - Text color
     * @returns {HTMLElement} Section element
     */
    createZoneProgressSection(zoneProgress, textColor) {
        const section = this.createSection(t('taskStatistics.zoneProgressHeader'));
        // Full-width row in the popup grid: values are long and rows are clickable
        section.style.gridColumn = '1 / -1';

        for (const zone of zoneProgress) {
            const timeStr = Number.isFinite(zone.hoursNeeded)
                ? timeReadable(Math.round(zone.hoursNeeded * 3600))
                : '???';
            const fightsStr = Number.isFinite(zone.fightsNeeded) ? formatKMB(zone.fightsNeeded) : '???';
            const value = t('taskStatistics.zoneProgressRowValue', {
                fights: fightsStr,
                time: timeStr,
                bottleneckName: zone.bottleneckName,
            });

            const row = this.createRow(zone.zoneName, value, textColor);
            row.style.cursor = 'pointer';
            row.onclick = () => {
                this.closePopup();
                const game = getGameObject();
                if (!game) return;
                // The combat page only opens the zone-select window for monster-based jumps;
                // handleGoToAction merely switches to the combat tab without opening anything.
                const anchor = zone.anchor;
                if (typeof game.handleGoToMonster === 'function' && anchor) {
                    const count = anchor.isBoss
                        ? Math.max(1, Math.round(zone.fightsNeeded / (anchor.battlesPerBoss || 10)))
                        : Math.round(zone.fightsNeeded);
                    game.handleGoToMonster(anchor.monsterHrid, count);
                    return;
                }
                if (!game.handleGoToAction) return;
                const numActions = Number.isFinite(zone.fightsNeeded) ? Math.round(zone.fightsNeeded) : undefined;
                game.handleGoToAction(zone.zoneHrid, numActions);
            };
            section.appendChild(row);
        }

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
