/**
 * UI Library 2
 * Secondary UI features split out of the UI library so each bundle stays under the
 * jsDelivr/Tampermonkey @require size cap (2 MiB) — dictionary, house, guild, leaderboard,
 * notifications, alchemy history, risk of ruin, enhancement, queue/character activity, and
 * assorted smaller UI toggles.
 *
 * Exports to: window.Toolasha.UI (merged alongside the primary UI library — this library must
 * be @required AFTER toolasha-ui.js so the merge target already exists)
 */

// UI features
import equipmentLevelDisplay from '../features/ui/equipment-level-display.js';
import alchemyItemDimming from '../features/ui/alchemy-item-dimming.js';
import combatLevelProgress from '../features/ui/combat-level-progress.js';
import externalLinks from '../features/ui/external-links.js';
import hideLabyrinthBadge from '../features/ui/hide-labyrinth-badge.js';
import hideNavBarGlow from '../features/ui/hide-nav-bar-glow.js';
import tabReorder from '../features/ui/tab-reorder.js';

// Navigation features
import altClickNavigation from '../features/navigation/alt-click-navigation.js';

// Action features
import lootLogStats from '../features/actions/loot-log-stats.js';

// House
import housePanelObserver from '../features/house/house-panel-observer.js';

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

// Risk of Ruin
import riskOfRuinUI from '../features/risk-of-ruin/risk-of-ruin-ui.js';

// Guild
import guildXPTracker from '../features/guild/guild-xp-tracker.js';
import guildXPDisplay from '../features/guild/guild-xp-display.js';
import guildCreditValue from '../features/guild/guild-credit-value.js';

// Leaderboard
import leaderboardXPTracker from '../features/leaderboard/leaderboard-xp-tracker.js';
import leaderboardXPDisplay from '../features/leaderboard/leaderboard-xp-display.js';

// Notifications
import emptyQueueNotification from '../features/notifications/empty-queue-notification.js';

// Queue Monitor
import queueMonitor from '../features/queue-monitor/queue-monitor.js';
import characterActivity from '../features/character-activity/character-activity.js';

// Export to global namespace (merge into the UI namespace the primary UI library created)
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.UI = Object.assign(toolashaRoot.UI || {}, {
    equipmentLevelDisplay,
    alchemyItemDimming,
    combatLevelProgress,
    externalLinks,
    hideLabyrinthBadge,
    hideNavBarGlow,
    tabReorder,
    altClickNavigation,
    lootLogStats,
    housePanelObserver,
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
    riskOfRuinUI,
    guildXPTracker,
    guildXPDisplay,
    guildCreditValue,
    leaderboardXPTracker,
    leaderboardXPDisplay,
    emptyQueueNotification,
    queueMonitor,
    characterActivity,
});

console.log('[Toolasha] UI library 2 loaded');
