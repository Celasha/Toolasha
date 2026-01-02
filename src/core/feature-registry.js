/**
 * Feature Registry
 * Centralized feature initialization system
 */

import config from './config.js';

// Import all features
import tooltipPrices from '../features/market/tooltip-prices.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import tooltipConsumables from '../features/market/tooltip-consumables.js';
import marketFilter from '../features/market/market-filter.js';
import autoFillPrice from '../features/market/auto-fill-price.js';
import { initActionPanelObserver } from '../features/actions/panel-observer.js';
import actionTimeDisplay from '../features/actions/action-time-display.js';
import quickInputButtons from '../features/actions/quick-input-buttons.js';
import abilityBookCalculator from '../features/abilities/ability-book-calculator.js';
import zoneIndices from '../features/combat/zone-indices.js';
import combatScore from '../features/profile/combat-score.js';
import equipmentLevelDisplay from '../features/ui/equipment-level-display.js';
import alchemyItemDimming from '../features/ui/alchemy-item-dimming.js';
import skillExperiencePercentage from '../features/ui/skill-experience-percentage.js';
import taskProfitDisplay from '../features/tasks/task-profit-display.js';
import taskRerollTracker from '../features/tasks/task-reroll-tracker.js';
import housePanelObserver from '../features/house/house-panel-observer.js';
import networthFeature from '../features/networth/index.js';
import inventorySort from '../features/inventory/inventory-sort.js';
import enhancementTracker from '../features/enhancement/enhancement-tracker.js';
import { setupEnhancementHandlers } from '../features/enhancement/enhancement-handlers.js';
import enhancementUI from '../features/enhancement/enhancement-ui.js';
import emptyQueueNotification from '../features/notifications/empty-queue-notification.js';

/**
 * Feature Registry
 * Maps feature keys to their initialization functions and metadata
 */
const featureRegistry = [
    // Market Features
    {
        key: 'tooltipPrices',
        name: 'Tooltip Prices',
        category: 'Market',
        initialize: () => tooltipPrices.initialize(),
        async: true
    },
    {
        key: 'expectedValueCalculator',
        name: 'Expected Value Calculator',
        category: 'Market',
        initialize: () => expectedValueCalculator.initialize(),
        async: true
    },
    {
        key: 'tooltipConsumables',
        name: 'Tooltip Consumables',
        category: 'Market',
        initialize: () => tooltipConsumables.initialize(),
        async: true
    },
    {
        key: 'marketFilter',
        name: 'Market Filter',
        category: 'Market',
        initialize: () => marketFilter.initialize(),
        async: false
    },
    {
        key: 'fillMarketOrderPrice',
        name: 'Auto-Fill Market Price',
        category: 'Market',
        initialize: () => autoFillPrice.initialize(),
        async: false
    },

    // Action Features
    {
        key: 'actionPanelProfit',
        name: 'Action Panel Profit',
        category: 'Actions',
        initialize: () => initActionPanelObserver(),
        async: false,
        healthCheck: null // This feature has no DOM presence to check
    },
    {
        key: 'actionTimeDisplay',
        name: 'Action Time Display',
        category: 'Actions',
        initialize: () => actionTimeDisplay.initialize(),
        async: false,
        healthCheck: () => {
            // Check if time display is working by looking for injected time elements
            const queueMenu = document.querySelector('div[class*="QueuedActions_queuedActionsEditMenu"]');
            if (!queueMenu) return null; // Queue not open, can't verify

            // Look for our injected time displays
            const timeDisplays = queueMenu.querySelectorAll('[data-mwi-action-time]');
            return timeDisplays.length > 0;
        }
    },
    {
        key: 'quickInputButtons',
        name: 'Quick Input Buttons',
        category: 'Actions',
        initialize: () => quickInputButtons.initialize(),
        async: false,
        healthCheck: () => {
            // Check if quick input buttons exist on any action panel
            const actionPanel = document.querySelector('[class*="SkillActionDetail_skillActionDetail"]');
            if (!actionPanel) return null; // No action panel open, can't verify

            // Look for our injected button container
            const buttons = actionPanel.querySelector('.mwi-quick-input-buttons');
            return !!buttons;
        }
    },

    // Combat Features
    {
        key: 'abilityBookCalculator',
        name: 'Ability Book Calculator',
        category: 'Combat',
        initialize: () => abilityBookCalculator.initialize(),
        async: false
    },
    {
        key: 'zoneIndices',
        name: 'Zone Indices',
        category: 'Combat',
        initialize: () => zoneIndices.initialize(),
        async: false
    },
    {
        key: 'combatScore',
        name: 'Combat Score',
        category: 'Combat',
        initialize: () => combatScore.initialize(),
        async: false
    },

    // UI Features
    {
        key: 'equipmentLevelDisplay',
        name: 'Equipment Level Display',
        category: 'UI',
        initialize: () => equipmentLevelDisplay.initialize(),
        async: false
    },
    {
        key: 'alchemyItemDimming',
        name: 'Alchemy Item Dimming',
        category: 'UI',
        initialize: () => alchemyItemDimming.initialize(),
        async: false
    },
    {
        key: 'skillExperiencePercentage',
        name: 'Skill Experience Percentage',
        category: 'UI',
        initialize: () => skillExperiencePercentage.initialize(),
        async: false
    },

    // Task Features
    {
        key: 'taskProfitDisplay',
        name: 'Task Profit Display',
        category: 'Tasks',
        initialize: () => taskProfitDisplay.initialize(),
        async: false
    },
    {
        key: 'taskRerollTracker',
        name: 'Task Reroll Tracker',
        category: 'Tasks',
        initialize: () => taskRerollTracker.initialize(),
        async: true
    },

    // House Features
    {
        key: 'houseCostDisplay',
        name: 'House Cost Display',
        category: 'House',
        initialize: () => housePanelObserver.initialize(),
        async: true
    },

    // Economy Features
    {
        key: 'networth',
        name: 'Net Worth',
        category: 'Economy',
        initialize: () => networthFeature.initialize(),
        async: true,
        // Also initialize if inventorySummary is enabled
        customCheck: () => config.isFeatureEnabled('networth') || config.isFeatureEnabled('inventorySummary')
    },
    {
        key: 'inventorySort',
        name: 'Inventory Sort',
        category: 'Economy',
        initialize: () => inventorySort.initialize(),
        async: false
    },

    // Enhancement Features
    {
        key: 'enhancementTracker',
        name: 'Enhancement Tracker',
        category: 'Enhancement',
        initialize: async () => {
            await enhancementTracker.initialize();
            setupEnhancementHandlers();
            enhancementUI.initialize();
        },
        async: true
    },

    // Notification Features
    {
        key: 'notifiEmptyAction',
        name: 'Empty Queue Notification',
        category: 'Notifications',
        initialize: () => emptyQueueNotification.initialize(),
        async: true
    }
];

/**
 * Initialize all enabled features
 * @returns {Promise<void>}
 */
async function initializeFeatures() {
    const errors = [];

    for (const feature of featureRegistry) {
        try {
            // Check if feature is enabled
            const isEnabled = feature.customCheck
                ? feature.customCheck()
                : config.isFeatureEnabled(feature.key);

            if (!isEnabled) {
                continue;
            }

            // Initialize feature
            if (feature.async) {
                await feature.initialize();
            } else {
                feature.initialize();
            }

        } catch (error) {
            errors.push({
                feature: feature.name,
                error: error.message
            });
            console.error(`[Toolasha] Failed to initialize ${feature.name}:`, error);
        }
    }

    // Log errors if any occurred
    if (errors.length > 0) {
        console.error(`[Toolasha] ${errors.length} feature(s) failed to initialize`, errors);
    }
}

/**
 * Get feature by key
 * @param {string} key - Feature key
 * @returns {Object|null} Feature definition or null
 */
function getFeature(key) {
    return featureRegistry.find(f => f.key === key) || null;
}

/**
 * Get all features
 * @returns {Array} Feature registry
 */
function getAllFeatures() {
    return [...featureRegistry];
}

/**
 * Get features by category
 * @param {string} category - Category name
 * @returns {Array} Features in category
 */
function getFeaturesByCategory(category) {
    return featureRegistry.filter(f => f.category === category);
}

/**
 * Check health of all initialized features
 * @returns {Array<Object>} Array of failed features with details
 */
function checkFeatureHealth() {
    const failed = [];

    for (const feature of featureRegistry) {
        // Skip if feature has no health check
        if (!feature.healthCheck) continue;

        // Skip if feature is not enabled
        const isEnabled = feature.customCheck
            ? feature.customCheck()
            : config.isFeatureEnabled(feature.key);

        if (!isEnabled) continue;

        try {
            const result = feature.healthCheck();

            // null = can't verify (DOM not ready), false = failed, true = healthy
            if (result === false) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: 'Health check returned false'
                });
            }
        } catch (error) {
            failed.push({
                key: feature.key,
                name: feature.name,
                reason: `Health check error: ${error.message}`
            });
        }
    }

    return failed;
}

/**
 * Retry initialization for specific features
 * @param {Array<Object>} failedFeatures - Array of failed feature objects
 * @returns {Promise<void>}
 */
async function retryFailedFeatures(failedFeatures) {
    console.log('[Toolasha] Retrying failed features...');

    for (const failed of failedFeatures) {
        const feature = getFeature(failed.key);
        if (!feature) continue;

        try {
            console.log(`[Toolasha] Retrying ${feature.name}...`);

            if (feature.async) {
                await feature.initialize();
            } else {
                feature.initialize();
            }

            console.log(`[Toolasha] ✓ ${feature.name} retry successful`);
        } catch (error) {
            console.error(`[Toolasha] ✗ ${feature.name} retry failed:`, error);
        }
    }
}

export default {
    initializeFeatures,
    checkFeatureHealth,
    retryFailedFeatures,
    getFeature,
    getAllFeatures,
    getFeaturesByCategory
};
