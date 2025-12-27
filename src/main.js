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
import zoneIndices from './features/combat/zone-indices.js';
import combatScore from './features/profile/combat-score.js';
import taskProfitDisplay from './features/tasks/task-profit-display.js';
import taskRerollTracker from './features/tasks/task-reroll-tracker.js';
import * as enhancementGearDetector from './utils/enhancement-gear-detector.js';
import { getEnhancingParams } from './utils/enhancement-config.js';
import * as enhancementCalculator from './utils/enhancement-calculator.js';

// CRITICAL: Install WebSocket hook FIRST, before game connects
webSocketHook.install();

// CRITICAL: Start centralized DOM observer SECOND, before features initialize
domObserver.start();

// Initialize storage and config THIRD (async)
(async () => {
    try {
        // Initialize storage (opens IndexedDB)
        await storage.initialize();

        // Initialize config (loads settings from storage)
        await config.initialize();

        console.log('✅ Storage and config initialized');

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
            await tooltipPrices.initialize();
            await expectedValueCalculator.initialize();
            await tooltipConsumables.initialize();

            initActionPanelObserver();

            actionTimeDisplay.initialize();
            quickInputButtons.initialize();
            abilityBookCalculator.initialize();
            equipmentLevelDisplay.initialize();
            alchemyItemDimming.initialize();
            zoneIndices.initialize();
            combatScore.initialize();
            taskProfitDisplay.initialize();
            await taskRerollTracker.initialize(); // Now async with IndexedDB
        } catch (error) {
            console.error('❌ Feature initialization failed:', error);
        }
    }, 1000);
});

// Expose modules to window for debugging/testing
// Use unsafeWindow for userscript managers (Tampermonkey/Violentmonkey)
const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

targetWindow.MWITools = {
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
    enhancementGearDetector,
    getEnhancingParams,
    enhancementCalculator,
    version: '0.4.5'
};
