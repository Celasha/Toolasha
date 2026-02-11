/**
 * Combat Statistics Feature
 * Main entry point for combat statistics tracking and display
 */

import combatStatsDataCollector from './combat-stats-data-collector.js';
import combatStatsUI from './combat-stats-ui.js';

/**
 * Initialize combat statistics feature
 */
async function initialize() {
    // Initialize data collector (WebSocket listener + load persisted state)
    await combatStatsDataCollector.initialize();

    // Initialize UI (button injection and popup)
    combatStatsUI.initialize();
}

/**
 * Cleanup combat statistics feature
 */
function cleanup() {
    combatStatsDataCollector.cleanup();
    combatStatsUI.cleanup();
}

export default {
    name: 'Combat Statistics',
    initialize,
    cleanup,
};
