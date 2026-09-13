/**
 * Openable Analytics Feature
 * Main entry point for Actual vs Expected Value + Luck tracking on openable containers.
 */

import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import openableAnalyticsUI from './openable-analytics-ui.js';
import openableAnalyticsSidePanel from './openable-analytics-side-panel.js';

async function initialize() {
    await openableAnalyticsDataCollector.initialize();
    openableAnalyticsUI.initialize();
    openableAnalyticsSidePanel.initialize();
}

function cleanup() {
    openableAnalyticsDataCollector.cleanup();
    openableAnalyticsUI.cleanup();
    openableAnalyticsSidePanel.cleanup();
}

export default {
    name: 'Openable Analytics',
    initialize,
    cleanup,
};
