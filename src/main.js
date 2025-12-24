/**
 * MWI Tools - Main Entry Point
 * Refactored modular version
 */

import { numberFormatter, timeReadable } from './utils/formatters.js';
import storage from './core/storage.js';
import config from './core/config.js';
import webSocketHook from './core/websocket.js';
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
import actionTimeDisplay from './features/actions/action-time-display.js';
import * as enhancementGearDetector from './utils/enhancement-gear-detector.js';
import { getEnhancingParams } from './utils/enhancement-config.js';
import * as enhancementCalculator from './utils/enhancement-calculator.js';
// Debug utilities - only available via window.MWITools, not auto-run
// import * as gameMechanicsAudit from './utils/game-mechanics-audit.js';
// import { debugEnhancementSpeed } from './utils/debug-enhancement-speed.js';

// CRITICAL: Install WebSocket hook FIRST, before game connects
webSocketHook.install();

// Initialize Data Manager after a delay (let game load localStorageUtil)
setTimeout(() => {
    dataManager.initialize();
}, 1000);

// Test core modules
try {
    // Test formatters
    numberFormatter(1500);
    timeReadable(3661);

    // Test storage
    storage.set('test_key', 'test_value');
    storage.getJSON('test_json');

    // Test config
    config.getSetting('totalActionTime');

    // Test utilities
    efficiency.calculateEfficiency(150);
    dom.createColoredText('Test', 'main');
} catch (error) {
    console.error('❌ Module test failed:', error);
}

dataManager.on('character_initialized', (data) => {
    // Initialize market features after character data loads
    setTimeout(async () => {
        try {
            await tooltipPrices.initialize();
            await expectedValueCalculator.initialize();
            await tooltipConsumables.initialize();

            initActionPanelObserver();

            actionTimeDisplay.initialize();
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
    profitCalculator,
    gatheringProfitCalculator: { calculateGatheringProfit },
    expectedValueCalculator,
    marketAPI,
    config,
    storage,
    actionTimeDisplay,
    enhancementGearDetector,
    getEnhancingParams,
    enhancementCalculator,
    // Debug utilities available manually via console
    // gameMechanicsAudit,
    // debugEnhancementSpeed,
    version: '0.4.4'
};
