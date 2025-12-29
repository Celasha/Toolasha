/**
 * MWI Tools - Main Entry Point
 * Refactored modular version
 */

import { numberFormatter, timeReadable } from './utils/formatters.js';
import storage from './core/storage.js';
import config from './core/config.js';
import webSocketHook from './core/websocket.js';
import domObserver from './core/dom-observer.js';
import dataManager from './core/data-manager.js';
import dom from './utils/dom.js';
import * as efficiency from './utils/efficiency.js';
import marketAPI from './api/marketplace.js';
import tooltipPrices from './features/market/tooltip-prices.js';
import tooltipConsumables from './features/market/tooltip-consumables.js';
import profitCalculator from './features/market/profit-calculator.js';
import expectedValueCalculator from './features/market/expected-value-calculator.js';
import { initActionPanelObserver } from './features/actions/panel-observer.js';
import { calculateGatheringProfit } from './features/actions/gathering-profit.js';
import { calculateProductionProfit } from './features/actions/production-profit.js';
import actionTimeDisplay from './features/actions/action-time-display.js';
import quickInputButtons from './features/actions/quick-input-buttons.js';
import abilityBookCalculator from './features/abilities/ability-book-calculator.js';
import equipmentLevelDisplay from './features/ui/equipment-level-display.js';
import alchemyItemDimming from './features/ui/alchemy-item-dimming.js';
import skillExperiencePercentage from './features/ui/skill-experience-percentage.js';
import zoneIndices from './features/combat/zone-indices.js';
import combatScore from './features/profile/combat-score.js';
import taskProfitDisplay from './features/tasks/task-profit-display.js';
import taskRerollTracker from './features/tasks/task-reroll-tracker.js';
import housePanelObserver from './features/house/house-panel-observer.js';
import networthFeature from './features/networth/index.js';
import inventorySort from './features/inventory/inventory-sort.js';
import enhancementTracker from './features/enhancement/enhancement-tracker.js';
import { setupEnhancementHandlers } from './features/enhancement/enhancement-handlers.js';
import enhancementUI from './features/enhancement/enhancement-ui.js';
import * as enhancementGearDetector from './utils/enhancement-gear-detector.js';
import { getEnhancingParams } from './utils/enhancement-config.js';
import * as enhancementCalculator from './utils/enhancement-calculator.js';
import * as combatSimIntegration from './features/combat/combat-sim-integration.js';
import settingsUI from './features/settings/settings-ui.js';

/**
 * Detect if running on Combat Simulator page
 * @returns {boolean} True if on Combat Simulator
 */
function isCombatSimulatorPage() {
    const url = window.location.href;
    // Only work on test Combat Simulator for now
    return url.includes('shykai.github.io/MWICombatSimulatorTest/dist/');
}

// === COMBAT SIMULATOR PAGE ===
if (isCombatSimulatorPage()) {
    console.log('[Toolasha] Detected Combat Simulator page');

    // Initialize combat sim integration only
    combatSimIntegration.initialize();

    // Skip all other initialization
} else {
    // === GAME PAGE ===
    console.log('[Toolasha] Detected game page');

    // CRITICAL: Install WebSocket hook FIRST, before game connects
    webSocketHook.install();

    // CRITICAL: Start centralized DOM observer SECOND, before features initialize
    domObserver.start();

    // Start capturing client data from localStorage (for Combat Sim export)
    webSocketHook.captureClientDataFromLocalStorage();

    // Initialize storage and config THIRD (async)
    (async () => {
        try {
            // Initialize storage (opens IndexedDB)
            await storage.initialize();

            // Initialize config (loads settings from storage)
            await config.initialize();

            console.log('✅ Storage and config initialized');

            // Initialize Settings UI (injects tab into game settings panel)
            settingsUI.initialize();

            // Add beforeunload handler to flush all pending writes
            window.addEventListener('beforeunload', () => {
                storage.flushAll();
            });

            // Initialize Data Manager immediately
            // Don't wait for localStorageUtil - it handles missing data gracefully
            dataManager.initialize();
        } catch (error) {
            console.error('❌ Storage/config initialization failed:', error);
            // Initialize anyway
            dataManager.initialize();
        }
    })();

    dataManager.on('character_initialized', (data) => {
        // Initialize market features after character data loads
        setTimeout(async () => {
            try {
                // Market features
                if (config.isFeatureEnabled('tooltipPrices')) {
                    await tooltipPrices.initialize();
                }
                if (config.isFeatureEnabled('expectedValueCalculator')) {
                    await expectedValueCalculator.initialize();
                }
                if (config.isFeatureEnabled('tooltipConsumables')) {
                    await tooltipConsumables.initialize();
                }

                // Action features
                if (config.isFeatureEnabled('actionPanelProfit')) {
                    initActionPanelObserver();
                }
                if (config.isFeatureEnabled('actionTimeDisplay')) {
                    actionTimeDisplay.initialize();
                }
                if (config.isFeatureEnabled('quickInputButtons')) {
                    quickInputButtons.initialize();
                }

                // Combat features
                if (config.isFeatureEnabled('abilityBookCalculator')) {
                    abilityBookCalculator.initialize();
                }
                if (config.isFeatureEnabled('zoneIndices')) {
                    zoneIndices.initialize();
                }
                if (config.isFeatureEnabled('combatScore')) {
                    combatScore.initialize();
                }

                // UI features
                if (config.isFeatureEnabled('equipmentLevelDisplay')) {
                    equipmentLevelDisplay.initialize();
                }
                if (config.isFeatureEnabled('alchemyItemDimming')) {
                    alchemyItemDimming.initialize();
                }
                if (config.isFeatureEnabled('skillExperiencePercentage')) {
                    skillExperiencePercentage.initialize();
                }

                // Task features
                if (config.isFeatureEnabled('taskProfitDisplay')) {
                    taskProfitDisplay.initialize();
                }
                if (config.isFeatureEnabled('taskRerollTracker')) {
                    await taskRerollTracker.initialize();
                }

                // House features
                if (config.isFeatureEnabled('houseCostDisplay')) {
                    await housePanelObserver.initialize();
                }

                // Economy features
                if (config.isFeatureEnabled('networth') || config.isFeatureEnabled('inventorySummary')) {
                    await networthFeature.initialize();
                }
                if (config.isFeatureEnabled('inventorySort')) {
                    inventorySort.initialize();
                }

                // Enhancement features
                if (config.isFeatureEnabled('enhancementTracker')) {
                    await enhancementTracker.initialize();
                    // Setup WebSocket event handlers for automatic tracking
                    setupEnhancementHandlers();
                    // Initialize floating UI panel
                    enhancementUI.initialize();
                }
            } catch (error) {
                console.error('❌ Feature initialization failed:', error);
            }
        }, 1000);
    });

    // Expose modules to window for debugging/testing
    // Use unsafeWindow for userscript managers (Tampermonkey/Violentmonkey)
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    targetWindow.Toolasha = {
        dataManager,
        domObserver, // Expose centralized observer for debugging
        profitCalculator,
        gatheringProfitCalculator: { calculateGatheringProfit },
        productionProfitCalculator: { calculateProductionProfit },
        expectedValueCalculator,
        marketAPI,
        config,
        storage,
        websocket: webSocketHook, // Expose websocket for diagnostics
        actionTimeDisplay,
        quickInputButtons,
        abilityBookCalculator,
        equipmentLevelDisplay,
        alchemyItemDimming,
        zoneIndices,
        combatScore,
        taskProfitDisplay,
        taskRerollTracker,
        housePanelObserver,
        networthFeature,
        inventorySort,
        enhancementTracker,
        enhancementGearDetector,
        getEnhancingParams,
        enhancementCalculator,

        // Feature toggle API
        features: {
            list: () => config.getFeaturesByCategory(),
            enable: (key) => config.setFeatureEnabled(key, true),
            disable: (key) => config.setFeatureEnabled(key, false),
            toggle: (key) => config.toggleFeature(key),
            status: (key) => config.isFeatureEnabled(key),
            info: (key) => config.getFeatureInfo(key),
            keys: () => config.getFeatureKeys()
        },

        version: '0.4.5'
    };
}
