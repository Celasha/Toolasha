/**
 * UI Library
 * UI enhancements, tasks, skills, house, settings, and misc features
 *
 * Exports to: window.Toolasha.UI
 */

// UI features
import equipmentLevelDisplay from '../features/ui/equipment-level-display.js';
import alchemyItemDimming from '../features/ui/alchemy-item-dimming.js';
import skillExperiencePercentage from '../features/ui/skill-experience-percentage.js';
import externalLinks from '../features/ui/external-links.js';
import hideLabyrinthBadge from '../features/ui/hide-labyrinth-badge.js';
import hideGuildBadge from '../features/ui/hide-guild-badge.js';
import tabReorder from '../features/ui/tab-reorder.js';

// Navigation features
import altClickNavigation from '../features/navigation/alt-click-navigation.js';
import collectionNavigation from '../features/collection/collection-navigation.js';
import collectionFilters from '../features/collection/collection-filters.js';

// Chat features
import chatCommands from '../features/chat/chat-commands.js';
import mentionTracker from '../features/chat/mention-tracker.js';
import popOutChat from '../features/chat/pop-out-chat.js';
import chatBlockList from '../features/chat/chat-block-list.js';
import chatHistoryExtender from '../features/chat/chat-history-extender.js';

// Task features
import taskProfitDisplay from '../features/tasks/task-profit-display.js';
import taskRerollTracker from '../features/tasks/task-reroll-tracker.js';
import taskSorter from '../features/tasks/task-sorter.js';
import taskIcons from '../features/tasks/task-icons.js';
import taskInventoryHighlighter from '../features/tasks/task-inventory-highlighter.js';
import taskStatistics from '../features/tasks/task-statistics.js';
import taskClaimCollector from '../features/tasks/task-claim-collector.js';
import taskRerollProtection from '../features/tasks/task-reroll-protection.js';
import taskAutoReroll from '../features/tasks/task-auto-reroll.js';

// Skills
import remainingXP from '../features/skills/remaining-xp.js';
import xpTracker from '../features/skills/xp-tracker.js';

// Action features
import lootLogStats from '../features/actions/loot-log-stats.js';

// House
import housePanelObserver from '../features/house/house-panel-observer.js';

// Settings UI
import settingsUI from '../features/settings/settings-ui.js';

// Dictionary
import transmuteRates from '../features/dictionary/transmute-rates.js';
import viewActionButton from '../features/dictionary/view-action-button.js';

// Alchemy History
import transmuteHistoryTracker from '../features/alchemy/transmute-history-tracker.js';
import transmuteHistoryViewer from '../features/alchemy/transmute-history-viewer.js';
import coinifyHistoryTracker from '../features/alchemy/coinify-history-tracker.js';
import coinifyHistoryViewer from '../features/alchemy/coinify-history-viewer.js';
import decomposeHistoryTracker from '../features/alchemy/decompose-history-tracker.js';
import decomposeHistoryViewer from '../features/alchemy/decompose-history-viewer.js';
import alchemyActionProtection from '../features/alchemy/alchemy-action-protection.js';

// Enhancement
import enhancementFeature from '../features/enhancement/enhancement-feature.js';
import xphCalculator from '../features/enhancement/xph-calculator.js';

// Guild
import guildXPTracker from '../features/guild/guild-xp-tracker.js';
import guildXPDisplay from '../features/guild/guild-xp-display.js';
import guildCreditValue from '../features/guild/guild-credit-value.js';

// Notifications
import emptyQueueNotification from '../features/notifications/empty-queue-notification.js';

// Queue Monitor
import queueMonitor from '../features/queue-monitor/queue-monitor.js';

// Dev tools
import pformancePanel from '../features/dev/pformance-panel.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.UI = {
    equipmentLevelDisplay,
    alchemyItemDimming,
    skillExperiencePercentage,
    externalLinks,
    hideLabyrinthBadge,
    hideGuildBadge,
    tabReorder,
    altClickNavigation,
    collectionNavigation,
    collectionFilters,
    chatCommands,
    mentionTracker,
    popOutChat,
    chatBlockList,
    chatHistoryExtender,
    taskProfitDisplay,
    taskRerollTracker,
    taskSorter,
    taskIcons,
    taskInventoryHighlighter,
    taskStatistics,
    taskClaimCollector,
    taskRerollProtection,
    taskAutoReroll,
    remainingXP,
    xpTracker,
    lootLogStats,
    housePanelObserver,
    settingsUI,
    transmuteRates,
    viewActionButton,
    transmuteHistoryTracker,
    transmuteHistoryViewer,
    coinifyHistoryTracker,
    coinifyHistoryViewer,
    decomposeHistoryTracker,
    decomposeHistoryViewer,
    alchemyActionProtection,
    enhancementFeature,
    xphCalculator,
    guildXPTracker,
    guildXPDisplay,
    guildCreditValue,
    emptyQueueNotification,
    queueMonitor,
    pformancePanel,
};

console.log('[Toolasha] UI library loaded');
