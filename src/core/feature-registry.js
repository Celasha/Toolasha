/**
 * Feature Registry
 * Centralized feature initialization system
 */

import config from './config.js';
import dataManager from './data-manager.js';

// Import all features
import tooltipPrices from '../features/market/tooltip-prices.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import tooltipConsumables from '../features/market/tooltip-consumables.js';
import marketFilter from '../features/market/market-filter.js';
import autoFillPrice from '../features/market/auto-fill-price.js';
import itemCountDisplay from '../features/market/item-count-display.js';
import listingPriceDisplay from '../features/market/listing-price-display.js';
import estimatedListingAge from '../features/market/estimated-listing-age.js';
import marketOrderTotals from '../features/market/market-order-totals.js';
import marketHistoryViewer from '../features/market/market-history-viewer.js';
import tradeHistory from '../features/market/trade-history.js';
import tradeHistoryDisplay from '../features/market/trade-history-display.js';
import { initActionPanelObserver } from '../features/actions/panel-observer.js';
import actionTimeDisplay from '../features/actions/action-time-display.js';
import quickInputButtons from '../features/actions/quick-input-buttons.js';
import outputTotals from '../features/actions/output-totals.js';
import maxProduceable from '../features/actions/max-produceable.js';
import gatheringStats from '../features/actions/gathering-stats.js';
import requiredMaterials from '../features/actions/required-materials.js';
import missingMaterialsButton from '../features/actions/missing-materials-button.js';
import abilityBookCalculator from '../features/abilities/ability-book-calculator.js';
import zoneIndices from '../features/combat/zone-indices.js';
import combatScore from '../features/profile/combat-score.js';
import characterCardButton from '../features/profile/character-card-button.js';
import equipmentLevelDisplay from '../features/ui/equipment-level-display.js';
import alchemyItemDimming from '../features/ui/alchemy-item-dimming.js';
import skillExperiencePercentage from '../features/ui/skill-experience-percentage.js';
import externalLinks from '../features/ui/external-links.js';
import taskProfitDisplay from '../features/tasks/task-profit-display.js';
import taskRerollTracker from '../features/tasks/task-reroll-tracker.js';
import taskSorter from '../features/tasks/task-sorter.js';
import taskIcons from '../features/tasks/task-icons.js';
import remainingXP from '../features/skills/remaining-xp.js';
import housePanelObserver from '../features/house/house-panel-observer.js';
import networthFeature from '../features/networth/index.js';
import inventoryBadgeManager from '../features/inventory/inventory-badge-manager.js';
import inventorySort from '../features/inventory/inventory-sort.js';
import inventoryBadgePrices from '../features/inventory/inventory-badge-prices.js';
import enhancementFeature from '../features/enhancement/enhancement-feature.js';
import emptyQueueNotification from '../features/notifications/empty-queue-notification.js';
import dungeonTracker from '../features/combat/dungeon-tracker.js';
import dungeonTrackerUI from '../features/combat/dungeon-tracker-ui.js';
import dungeonTrackerChatAnnotations from '../features/combat/dungeon-tracker-chat-annotations.js';
import combatSummary from '../features/combat/combat-summary.js';
import combatStats from '../features/combat-stats/combat-stats.js';
import alchemyProfitDisplay from '../features/alchemy/alchemy-profit-display.js';
import transmuteRates from '../features/dictionary/transmute-rates.js';
import dungeonTokenTooltips from '../features/inventory/dungeon-token-tooltips.js';

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
        async: true,
    },
    {
        key: 'expectedValueCalculator',
        name: 'Expected Value Calculator',
        category: 'Market',
        initialize: () => expectedValueCalculator.initialize(),
        async: true,
    },
    {
        key: 'tooltipConsumables',
        name: 'Tooltip Consumables',
        category: 'Market',
        initialize: () => tooltipConsumables.initialize(),
        async: true,
    },
    {
        key: 'dungeonTokenTooltips',
        name: 'Dungeon Token Tooltips',
        category: 'Inventory',
        initialize: () => dungeonTokenTooltips.initialize(),
        async: true,
    },
    {
        key: 'marketFilter',
        name: 'Market Filter',
        category: 'Market',
        initialize: () => marketFilter.initialize(),
        async: false,
    },
    {
        key: 'fillMarketOrderPrice',
        name: 'Auto-Fill Market Price',
        category: 'Market',
        initialize: () => autoFillPrice.initialize(),
        async: false,
    },
    {
        key: 'market_visibleItemCount',
        name: 'Market Item Count Display',
        category: 'Market',
        initialize: () => itemCountDisplay.initialize(),
        async: false,
    },
    {
        key: 'market_showListingPrices',
        name: 'Market Listing Price Display',
        category: 'Market',
        initialize: () => listingPriceDisplay.initialize(),
        async: false,
    },
    {
        key: 'market_showEstimatedListingAge',
        name: 'Estimated Listing Age',
        category: 'Market',
        initialize: () => estimatedListingAge.initialize(),
        async: true, // Uses IndexedDB storage
    },
    {
        key: 'market_showOrderTotals',
        name: 'Market Order Totals',
        category: 'Market',
        initialize: () => marketOrderTotals.initialize(),
        async: true, // Uses dataManager and WebSocket hooks
    },
    {
        key: 'market_showHistoryViewer',
        name: 'Market History Viewer',
        category: 'Market',
        initialize: () => marketHistoryViewer.initialize(),
        async: true,
    },
    {
        key: 'market_tradeHistory',
        name: 'Personal Trade History',
        category: 'Market',
        initialize: async () => {
            await tradeHistory.initialize();
            tradeHistoryDisplay.initialize();
        },
        async: true,
    },

    // Action Features
    {
        key: 'actionPanelProfit',
        name: 'Action Panel Profit',
        category: 'Actions',
        initialize: () => initActionPanelObserver(),
        async: false,
        healthCheck: null, // This feature has no DOM presence to check
    },
    {
        key: 'actionTimeDisplay',
        name: 'Action Time Display',
        category: 'Actions',
        initialize: () => actionTimeDisplay.initialize(),
        async: false,
        healthCheck: () => {
            // Check if the display element exists in the action header
            const displayElement = document.querySelector('#mwi-action-time-display');
            if (displayElement) return true;

            // If queue is open, check for injected time displays
            const queueMenu = document.querySelector('div[class*="QueuedActions_queuedActionsEditMenu"]');
            if (!queueMenu) return null; // Queue not open, can't verify via queue

            // Look for our injected time displays (using actual class name)
            const timeDisplays = queueMenu.querySelectorAll('.mwi-queue-action-time');
            return timeDisplays.length > 0;
        },
    },
    {
        key: 'quickInputButtons',
        name: 'Quick Input Buttons',
        category: 'Actions',
        initialize: () => quickInputButtons.initialize(),
        async: false,
        healthCheck: () => {
            // Find action panels that have queue inputs (excludes Enhancing, Alchemy, etc.)
            const actionPanels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');

            // Find panels with number inputs (regular gathering/production actions)
            const panelsWithInputs = Array.from(actionPanels).filter((panel) => {
                const hasInput = !!panel.querySelector('input[type="number"]');
                const hasInputContainer = !!panel.querySelector('[class*="maxActionCountInput"]');
                return hasInput || hasInputContainer;
            });

            if (panelsWithInputs.length === 0) {
                return null; // No applicable panels open, can't verify
            }

            // Check first applicable panel for our buttons
            const panel = panelsWithInputs[0];
            const buttons = panel.querySelector('.mwi-quick-input-btn');
            const sections = panel.querySelector('.mwi-collapsible-section');
            return !!(buttons || sections);
        },
    },
    {
        key: 'actionPanel_outputTotals',
        name: 'Output Totals Display',
        category: 'Actions',
        initialize: () => outputTotals.initialize(),
        async: false,
        healthCheck: () => {
            // Check if any action detail panels are open with output totals
            const actionPanels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');
            if (actionPanels.length === 0) {
                return null; // No panels open, can't verify
            }

            // Look for our injected total elements
            const totalElements = document.querySelectorAll('.mwi-output-total');
            return totalElements.length > 0 || null; // null if panels open but no input entered yet
        },
    },
    {
        key: 'actionPanel_maxProduceable',
        name: 'Max Produceable Display',
        category: 'Actions',
        initialize: () => maxProduceable.initialize(),
        async: false,
        healthCheck: () => {
            // Check for skill action panels in skill screens
            const skillPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
            if (skillPanels.length === 0) {
                return null; // No skill panels visible, can't verify
            }

            // Look for our injected max produceable displays
            const maxProduceElements = document.querySelectorAll('.mwi-max-produceable');
            return maxProduceElements.length > 0 || null; // null if no crafting actions visible
        },
    },
    {
        key: 'actionPanel_gatheringStats',
        name: 'Gathering Stats Display',
        category: 'Actions',
        initialize: () => gatheringStats.initialize(),
        async: false,
        healthCheck: () => {
            // Check for skill action panels in skill screens
            const skillPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
            if (skillPanels.length === 0) {
                return null; // No skill panels visible, can't verify
            }

            // Look for our injected gathering stats displays
            const gatheringElements = document.querySelectorAll('.mwi-gathering-stats');
            return gatheringElements.length > 0 || null; // null if no gathering actions visible
        },
    },
    {
        key: 'requiredMaterials',
        name: 'Required Materials Display',
        category: 'Actions',
        initialize: () => requiredMaterials.initialize(),
        async: false,
        healthCheck: () => {
            // Check if any action detail panels are open with required materials
            const actionPanels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');
            if (actionPanels.length === 0) {
                return null; // No panels open, can't verify
            }

            // Look for our injected required materials displays
            const materialsElements = document.querySelectorAll('.mwi-required-materials');
            return materialsElements.length > 0 || null; // null if panels open but no input entered yet
        },
    },
    {
        key: 'alchemy_profitDisplay',
        name: 'Alchemy Profit Calculator',
        category: 'Actions',
        initialize: () => alchemyProfitDisplay.initialize(),
        async: false,
        healthCheck: () => {
            // Check if alchemy panel is open
            const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
            if (!alchemyComponent) {
                return null; // Not on alchemy screen, can't verify
            }

            // Look for our injected profit display
            const profitDisplay = document.querySelector('.mwi-alchemy-profit');
            return profitDisplay !== null;
        },
    },
    {
        key: 'actions_missingMaterialsButton',
        name: 'Missing Materials Button',
        category: 'Actions',
        initialize: () => missingMaterialsButton.initialize(),
        async: false,
        healthCheck: null, // Button added by panel observer, no standalone health check
    },

    // Combat Features
    {
        key: 'abilityBookCalculator',
        name: 'Ability Book Calculator',
        category: 'Combat',
        initialize: () => abilityBookCalculator.initialize(),
        async: false,
    },
    {
        key: 'zoneIndices',
        name: 'Zone Indices',
        category: 'Combat',
        initialize: () => zoneIndices.initialize(),
        async: false,
    },
    {
        key: 'combatScore',
        name: 'Combat Score',
        category: 'Combat',
        initialize: () => combatScore.initialize(),
        async: false,
    },
    {
        key: 'characterCard',
        name: 'Character Card Button',
        category: 'Combat',
        initialize: () => characterCardButton.initialize(),
        async: false,
    },
    {
        key: 'dungeonTracker',
        name: 'Dungeon Tracker',
        category: 'Combat',
        initialize: () => {
            dungeonTracker.initialize();
            dungeonTrackerUI.initialize();
            dungeonTrackerChatAnnotations.initialize();
        },
        async: false,
    },
    {
        key: 'combatSummary',
        name: 'Combat Summary',
        category: 'Combat',
        initialize: () => combatSummary.initialize(),
        async: false,
    },
    {
        key: 'combatStats',
        name: 'Combat Statistics',
        category: 'Combat',
        initialize: () => combatStats.initialize(),
        cleanup: () => combatStats.cleanup(),
        async: true,
    },

    // UI Features
    {
        key: 'equipmentLevelDisplay',
        name: 'Equipment Level Display',
        category: 'UI',
        initialize: () => equipmentLevelDisplay.initialize(),
        async: false,
    },
    {
        key: 'alchemyItemDimming',
        name: 'Alchemy Item Dimming',
        category: 'UI',
        initialize: () => alchemyItemDimming.initialize(),
        async: false,
    },
    {
        key: 'skillExperiencePercentage',
        name: 'Skill Experience Percentage',
        category: 'UI',
        initialize: () => skillExperiencePercentage.initialize(),
        async: false,
    },
    {
        key: 'ui_externalLinks',
        name: 'External Links',
        category: 'UI',
        initialize: () => externalLinks.initialize(),
        disable: () => externalLinks.disable(),
        async: false,
    },

    // Task Features
    {
        key: 'taskProfitDisplay',
        name: 'Task Profit Display',
        category: 'Tasks',
        initialize: () => taskProfitDisplay.initialize(),
        async: false,
    },
    {
        key: 'taskRerollTracker',
        name: 'Task Reroll Tracker',
        category: 'Tasks',
        initialize: () => taskRerollTracker.initialize(),
        async: true,
    },
    {
        key: 'taskSorter',
        name: 'Task Sorting',
        category: 'Tasks',
        initialize: () => taskSorter.initialize(),
        async: false,
    },
    {
        key: 'taskIcons',
        name: 'Task Icons',
        category: 'Tasks',
        initialize: () => taskIcons.initialize(),
        async: false,
    },

    // Skills Features
    {
        key: 'skillRemainingXP',
        name: 'Remaining XP Display',
        category: 'Skills',
        initialize: () => remainingXP.initialize(),
        async: false,
    },

    // House Features
    {
        key: 'houseCostDisplay',
        name: 'House Cost Display',
        category: 'House',
        initialize: () => housePanelObserver.initialize(),
        async: true,
    },

    // Economy Features
    {
        key: 'networth',
        name: 'Net Worth',
        category: 'Economy',
        initialize: () => networthFeature.initialize(),
        async: true,
        // Also initialize if inventorySummary is enabled
        customCheck: () => config.isFeatureEnabled('networth') || config.isFeatureEnabled('inventorySummary'),
    },

    // Inventory Badge Manager (must initialize before inventory features)
    {
        key: 'inventoryBadgeManager',
        name: 'Inventory Badge Manager',
        category: 'Economy',
        initialize: () => inventoryBadgeManager.initialize(),
        async: false,
        alwaysEnabled: true, // Core infrastructure, always enabled
    },
    {
        key: 'inventorySort',
        name: 'Inventory Sort',
        category: 'Economy',
        initialize: () => inventorySort.initialize(),
        async: true,
    },
    {
        key: 'inventoryBadgePrices',
        name: 'Inventory Price Badges',
        category: 'Economy',
        initialize: () => inventoryBadgePrices.initialize(),
        async: false,
    },

    // Enhancement Features
    {
        key: 'enhancementTracker',
        name: 'Enhancement Tracker',
        category: 'Enhancement',
        initialize: async () => {
            await enhancementFeature.initialize();
        },
        async: true,
    },

    // Notification Features
    {
        key: 'notifiEmptyAction',
        name: 'Empty Queue Notification',
        category: 'Notifications',
        initialize: () => emptyQueueNotification.initialize(),
        async: true,
    },

    // Dictionary Features
    {
        key: 'itemDictionary_transmuteRates',
        name: 'Item Dictionary Transmute Rates',
        category: 'UI',
        initialize: () => transmuteRates.initialize(),
        async: false,
    },
];

/**
 * Initialize all enabled features
 * @returns {Promise<void>}
 */
async function initializeFeatures() {
    // Block feature initialization during character switch
    if (dataManager.getIsCharacterSwitching()) {
        return;
    }

    const errors = [];

    for (const feature of featureRegistry) {
        try {
            const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

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
                error: error.message,
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
    return featureRegistry.find((f) => f.key === key) || null;
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
    return featureRegistry.filter((f) => f.category === category);
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
        const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

        if (!isEnabled) continue;

        try {
            const result = feature.healthCheck();

            // null = can't verify (DOM not ready), false = failed, true = healthy
            if (result === false) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: 'Health check returned false',
                });
            }
        } catch (error) {
            failed.push({
                key: feature.key,
                name: feature.name,
                reason: `Health check error: ${error.message}`,
            });
        }
    }

    return failed;
}

/**
 * Setup character switch handler
 * Re-initializes all features when character switches
 */
function setupCharacterSwitchHandler() {
    // Guard against overlapping switches
    let isSwitching = false;
    let reinitScheduled = false;
    let reinitTimeoutId = null;

    // Handle character_switching event (cleanup phase)
    dataManager.on('character_switching', async (_data) => {
        // Prevent overlapping switches
        if (isSwitching) {
            console.warn('[FeatureRegistry] Character switch already in progress - ignoring rapid switch');
            return;
        }

        isSwitching = true;

        try {
            // Clear config cache to prevent stale settings
            if (config && typeof config.clearSettingsCache === 'function') {
                config.clearSettingsCache();
            }

            // Disable all active features (cleanup DOM elements, event listeners, etc.)
            // IMPORTANT: Await all disable() calls to ensure cleanup completes
            for (const feature of featureRegistry) {
                try {
                    const featureInstance = getFeatureInstance(feature.key);
                    if (featureInstance && typeof featureInstance.disable === 'function') {
                        const result = featureInstance.disable();
                        // Await if disable() returns a promise
                        if (result && typeof result.then === 'function') {
                            await result;
                        }
                    }
                } catch (error) {
                    console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                }
            }
        } catch (error) {
            console.error('[FeatureRegistry] Error during character switch cleanup:', error);
        } finally {
            // Always reset flag to allow next character switch
            isSwitching = false;
        }
    });

    // Handle character_switched event (re-initialization phase)
    dataManager.on('character_switched', async (_data) => {
        // Prevent multiple overlapping reinits
        if (reinitScheduled) {
            console.warn('[FeatureRegistry] Reinit already scheduled - ignoring duplicate');
            return;
        }

        reinitScheduled = true;

        // Force cleanup of dungeon tracker UI (safety measure)
        if (dungeonTrackerUI && typeof dungeonTrackerUI.cleanup === 'function') {
            dungeonTrackerUI.cleanup();
        }

        // Settings UI manages its own character switch lifecycle via character_initialized event
        // No need to call settingsUI.initialize() here

        // Re-initialize features
        const reinit = async () => {
            try {
                // Reload config settings first (settings were cleared during cleanup)
                await config.loadSettings();
                config.applyColorSettings();

                // Now re-initialize all features with fresh settings
                await initializeFeatures();
            } catch (error) {
                console.error('[FeatureRegistry] Error during feature reinitialization:', error);
            } finally {
                // Reset flags to allow next switch
                isSwitching = false;
                reinitScheduled = false;
                if (reinitTimeoutId) {
                    clearTimeout(reinitTimeoutId);
                    reinitTimeoutId = null;
                }
            }
        };

        // Use requestIdleCallback for non-blocking re-init
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => reinit(), { timeout: 2000 });
        } else {
            // Fallback for browsers without requestIdleCallback
            if (reinitTimeoutId) {
                clearTimeout(reinitTimeoutId);
            }
            reinitTimeoutId = setTimeout(() => reinit(), 300); // Longer delay for game to stabilize
        }
    });
}

/**
 * Get feature instance from imported module
 * @param {string} key - Feature key
 * @returns {Object|null} Feature instance or null
 * @private
 */
function getFeatureInstance(key) {
    // Map feature keys to their imported instances
    const instanceMap = {
        tooltipPrices: tooltipPrices,
        expectedValueCalculator: expectedValueCalculator,
        tooltipConsumables: tooltipConsumables,
        dungeonTokenTooltips: dungeonTokenTooltips,
        marketFilter: marketFilter,
        fillMarketOrderPrice: autoFillPrice,
        market_visibleItemCount: itemCountDisplay,
        market_showListingPrices: listingPriceDisplay,
        market_showEstimatedListingAge: estimatedListingAge,
        market_showOrderTotals: marketOrderTotals,
        market_showHistoryViewer: marketHistoryViewer,
        market_tradeHistory: tradeHistory,
        actionTimeDisplay: actionTimeDisplay,
        quickInputButtons: quickInputButtons,
        actionPanel_outputTotals: outputTotals,
        actionPanel_maxProduceable: maxProduceable,
        actionPanel_gatheringStats: gatheringStats,
        requiredMaterials: requiredMaterials,
        alchemy_profitDisplay: alchemyProfitDisplay,
        actions_missingMaterialsButton: missingMaterialsButton,
        abilityBookCalculator: abilityBookCalculator,
        zoneIndices: zoneIndices,
        combatScore: combatScore,
        characterCard: characterCardButton,
        dungeonTracker: dungeonTracker,
        combatSummary: combatSummary,
        equipmentLevelDisplay: equipmentLevelDisplay,
        alchemyItemDimming: alchemyItemDimming,
        skillExperiencePercentage: skillExperiencePercentage,
        ui_externalLinks: externalLinks,
        taskProfitDisplay: taskProfitDisplay,
        taskRerollTracker: taskRerollTracker,
        taskSorter: taskSorter,
        taskIcons: taskIcons,
        skillRemainingXP: remainingXP,
        houseCostDisplay: housePanelObserver,
        networth: networthFeature,
        inventorySort: inventorySort,
        inventoryBadgePrices: inventoryBadgePrices,
        enhancementTracker: enhancementFeature,
        notifiEmptyAction: emptyQueueNotification,
    };

    return instanceMap[key] || null;
}

/**
 * Retry initialization for specific features
 * @param {Array<Object>} failedFeatures - Array of failed feature objects
 * @returns {Promise<void>}
 */
async function retryFailedFeatures(failedFeatures) {
    for (const failed of failedFeatures) {
        const feature = getFeature(failed.key);
        if (!feature) continue;

        try {
            if (feature.async) {
                await feature.initialize();
            } else {
                feature.initialize();
            }

            // Verify the retry actually worked by running health check
            if (feature.healthCheck) {
                const healthResult = feature.healthCheck();
                if (healthResult === false) {
                    console.warn(`[Toolasha] ${feature.name} retry completed but health check still fails`);
                }
            }
        } catch (error) {
            console.error(`[Toolasha] ${feature.name} retry failed:`, error);
        }
    }
}

export default {
    initializeFeatures,
    setupCharacterSwitchHandler,
    checkFeatureHealth,
    retryFailedFeatures,
    getFeature,
    getAllFeatures,
    getFeaturesByCategory,
};
