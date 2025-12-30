/**
 * MWI Tools - Main Entry Point
 * Refactored modular version
 */

import storage from './core/storage.js';
import config from './core/config.js';
import webSocketHook from './core/websocket.js';
import domObserver from './core/dom-observer.js';
import dataManager from './core/data-manager.js';
import featureRegistry from './core/feature-registry.js';
import networkAlert from './features/market/network-alert.js';
import * as combatSimIntegration from './features/combat/combat-sim-integration.js';
import * as profileExportButton from './features/combat/profile-export-button.js';
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
    // Initialize combat sim integration only
    combatSimIntegration.initialize();

    // Skip all other initialization
} else {
    // === GAME PAGE ===

    // CRITICAL: Install WebSocket hook FIRST, before game connects
    webSocketHook.install();

    // CRITICAL: Start centralized DOM observer SECOND, before features initialize
    domObserver.start();

    // Initialize network alert (must be early, before market features)
    networkAlert.initialize();

    // Start capturing client data from localStorage (for Combat Sim export)
    webSocketHook.captureClientDataFromLocalStorage();

    // Initialize profile export button (always available)
    profileExportButton.initialize();

    // Initialize storage and config THIRD (async)
    (async () => {
        try {
            // Initialize storage (opens IndexedDB)
            await storage.initialize();

            // Initialize config (loads settings from storage)
            await config.initialize();

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
            console.error('[Toolasha] Storage/config initialization failed:', error);
            // Initialize anyway
            dataManager.initialize();
        }
    })();

    dataManager.on('character_initialized', (data) => {
        // Initialize all features using the feature registry
        setTimeout(async () => {
            try {
                await featureRegistry.initializeFeatures();
            } catch (error) {
                console.error('[Toolasha] Feature initialization failed:', error);
            }
        }, 1000);
    });

    // Expose minimal user-facing API
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    targetWindow.Toolasha = {
        version: '0.4.5',

        // Feature toggle API (for users to manage settings via console)
        features: {
            list: () => config.getFeaturesByCategory(),
            enable: (key) => config.setFeatureEnabled(key, true),
            disable: (key) => config.setFeatureEnabled(key, false),
            toggle: (key) => config.toggleFeature(key),
            status: (key) => config.isFeatureEnabled(key),
            info: (key) => config.getFeatureInfo(key)
        }
    };
}
