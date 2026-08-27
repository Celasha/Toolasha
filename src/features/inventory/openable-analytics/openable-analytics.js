/**
 * Openable Analytics Feature
 * Main entry point for Actual vs Expected Value + Luck tracking on openable containers.
 */

import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import openableAnalyticsUI from './openable-analytics-ui.js';

async function initialize() {
    await openableAnalyticsDataCollector.initialize();
    openableAnalyticsUI.initialize();
}

function cleanup() {
    openableAnalyticsDataCollector.cleanup();
    openableAnalyticsUI.cleanup();
}

export default {
    name: 'Openable Analytics',
    initialize,
    cleanup,
};
