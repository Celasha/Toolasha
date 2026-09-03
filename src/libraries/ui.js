/**
 * UI Library
 * Tasks, chat, collection, skills, and settings features. Split from the remaining UI features
 * (see ui2.js) to stay under the jsDelivr/Tampermonkey @require size cap (2 MiB).
 *
 * Exports to: window.Toolasha.UI (ui2.js merges its own features into the same namespace)
 */

// UI features
import skillExperiencePercentage from '../features/ui/skill-experience-percentage.js';
import hideGuildBadge from '../features/ui/hide-guild-badge.js';
import draggableModals from '../features/ui/draggable-modals.js';

// Navigation features
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
import taskTokenThreshold from '../features/tasks/task-token-threshold.js';

// Skills
import remainingXP from '../features/skills/remaining-xp.js';
import xpTracker from '../features/skills/xp-tracker.js';

// Settings UI
import settingsUI from '../features/settings/settings-ui.js';

// Dev tools
import pformancePanel from '../features/dev/pformance-panel.js';

// Character Select — always-on bootstrap dependency (started unconditionally before any
// feature/character logic in entrypoint.js), kept in the primary bundle rather than the
// secondary one so it never lands on the tail @require.
import characterSelectRenderer from '../features/character-activity/character-select-renderer.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.UI = {
    skillExperiencePercentage,
    hideGuildBadge,
    draggableModals,
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
    taskTokenThreshold,
    remainingXP,
    xpTracker,
    settingsUI,
    pformancePanel,
    characterSelectRenderer,
};

console.log('[Toolasha] UI library loaded');
