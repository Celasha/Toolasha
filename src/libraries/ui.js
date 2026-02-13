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

// Chat features
import chatCommands from '../features/chat/chat-commands.js';

// Task features
import taskProfitDisplay from '../features/tasks/task-profit-display.js';
import taskRerollTracker from '../features/tasks/task-reroll-tracker.js';
import taskSorter from '../features/tasks/task-sorter.js';
import taskIcons from '../features/tasks/task-icons.js';

// Skills
import remainingXP from '../features/skills/remaining-xp.js';

// House
import housePanelObserver from '../features/house/house-panel-observer.js';

// Settings UI
import settingsUI from '../features/settings/settings-ui.js';

// Dictionary
import transmuteRates from '../features/dictionary/transmute-rates.js';

// Enhancement
import enhancementFeature from '../features/enhancement/enhancement-feature.js';

// Notifications
import emptyQueueNotification from '../features/notifications/empty-queue-notification.js';

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
    chatCommands,
    taskProfitDisplay,
    taskRerollTracker,
    taskSorter,
    taskIcons,
    remainingXP,
    housePanelObserver,
    settingsUI,
    transmuteRates,
    enhancementFeature,
    emptyQueueNotification,
};

console.log('[Toolasha] UI library loaded');
