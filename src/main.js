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
import settingsUI from './features/settings/settings-ui.js';
import { setupScrollTooltipDismissal } from './utils/dom.js';

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

    // Set up scroll listener to dismiss stuck tooltips
    setupScrollTooltipDismissal();

    // Initialize network alert (must be early, before market features)
    networkAlert.initialize();

    // Start capturing client data from localStorage (for Combat Sim export)
    webSocketHook.captureClientDataFromLocalStorage();

    // Initialize storage and config THIRD (async)
    (async () => {
        try {
            // Initialize storage (opens IndexedDB)
            await storage.initialize();

            // Initialize config (loads settings from storage)
            await config.initialize();

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

    // Setup character switch handler once (NOT inside character_initialized listener)
    featureRegistry.setupCharacterSwitchHandler();

    dataManager.on('character_initialized', (_data) => {
        // Initialize all features using the feature registry
        setTimeout(async () => {
            try {
                // Reload config settings with character-specific data
                await config.loadSettings();
                config.applyColorSettings();

                // Initialize Settings UI after character data is loaded
                await settingsUI.initialize().catch((error) => {
                    console.error('[Toolasha] Settings UI initialization failed:', error);
                });

                await featureRegistry.initializeFeatures();

                // Health check after initialization
                setTimeout(async () => {
                    const failedFeatures = featureRegistry.checkFeatureHealth();

                    // Note: Settings tab health check removed - tab only appears when user opens settings panel

                    if (failedFeatures.length > 0) {
                        console.warn(
                            '[Toolasha] Health check found failed features:',
                            failedFeatures.map((f) => f.name)
                        );

                        setTimeout(async () => {
                            await featureRegistry.retryFailedFeatures(failedFeatures);

                            // Final health check
                            const stillFailed = featureRegistry.checkFeatureHealth();
                            if (stillFailed.length > 0) {
                                console.warn(
                                    '[Toolasha] These features could not initialize:',
                                    stillFailed.map((f) => f.name)
                                );
                                console.warn(
                                    '[Toolasha] Try refreshing the page or reopening the relevant game panels'
                                );
                            }
                        }, 1000);
                    }
                }, 500); // Wait 500ms after initialization to check health
            } catch (error) {
                console.error('[Toolasha] Feature initialization failed:', error);
            }
        }, 100);
    });

    // Expose minimal user-facing API
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    targetWindow.Toolasha = {
        version: '0.9.1',

        // Feature toggle API (for users to manage settings via console)
        features: {
            list: () => config.getFeaturesByCategory(),
            enable: (key) => config.setFeatureEnabled(key, true),
            disable: (key) => config.setFeatureEnabled(key, false),
            toggle: (key) => config.toggleFeature(key),
            status: (key) => config.isFeatureEnabled(key),
            info: (key) => config.getFeatureInfo(key),
        },
    };
}
