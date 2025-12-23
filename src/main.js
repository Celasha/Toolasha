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
import * as enhancementAudit from './utils/enhancement-audit.js';

console.log('MWI Tools (Refactored) v0.4.0 - Initializing...');

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
    console.log('✅ Formatters');

    // Test storage
    storage.set('test_key', 'test_value');
    storage.getJSON('test_json');
    console.log('✅ Storage');

    // Test config
    config.getSetting('totalActionTime');
    console.log('✅ Config');

    // Test utilities
    efficiency.calculateEfficiency(150);
    dom.createColoredText('Test', 'main');
    console.log('✅ Utilities');
} catch (error) {
    console.error('❌ Module test failed:', error);
}

dataManager.on('character_initialized', (data) => {
    console.log('✅ Character data loaded');

    // Run enhancement mechanics audit
    const gameData = dataManager.getInitClientData();
    if (gameData) {
        enhancementAudit.runFullAudit(gameData);
    }

    // Initialize market features after character data loads
    setTimeout(async () => {
        try {
            await tooltipPrices.initialize();
            await expectedValueCalculator.initialize();
            await tooltipConsumables.initialize();
            console.log('✅ Market features');

            initActionPanelObserver();
            console.log('✅ Action panel observer');

            actionTimeDisplay.initialize();
            console.log('✅ Action time display');

            console.log('🎉 MWI Tools v0.4.1 - Ready!');
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
    enhancementAudit,
    version: '0.4.1'
};

console.log('🔧 Debug: Access modules via MWITools (exposed to page context)');
console.log('   Example: MWITools.dataManager.getHouseRooms()');
console.log('   Audit: MWITools.enhancementAudit.runFullAudit(MWITools.dataManager.getInitClientData())');
