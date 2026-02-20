/**
 * Networth Feature - Main Coordinator
 * Manages networth calculation and display updates
 */

import config from '../../core/config.js';
import connectionState from '../../core/connection-state.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { calculateNetworth } from './networth-calculator.js';
import { networthHeaderDisplay, networthInventoryDisplay } from './networth-display.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createPauseRegistry } from '../../utils/pause-registry.js';
import networthCache from './networth-cache.js';

class NetworthFeature {
    constructor() {
        this.isActive = false;
        this.currentData = null;
        this.timerRegistry = createTimerRegistry();
        this.pauseRegistry = null;
        this.priceUpdateHandler = null;
        this.itemsUpdateHandler = null;
        this.priceUpdateDebounceTimer = null;
        this.itemsUpdateDebounceTimer = null;
    }

    /**
     * Initialize the networth feature
     */
    async initialize() {
        if (this.isActive) return;

        // Set reference in display components so they can trigger recalculation
        networthHeaderDisplay.setNetworthFeature(this);

        // Initialize header display (always enabled with networth feature)
        if (config.isFeatureEnabled('networth')) {
            networthHeaderDisplay.initialize();
        }

        // Initialize inventory panel display (separate toggle)
        if (config.isFeatureEnabled('inventorySummary')) {
            networthInventoryDisplay.initialize();
        }

        if (!this.pauseRegistry) {
            this.pauseRegistry = createPauseRegistry();
            this.pauseRegistry.register(
                'networth-event-listeners',
                () => this.pauseListeners(),
                () => this.resumeListeners()
            );
        }

        // Set up event-driven updates instead of polling
        this.setupEventListeners();

        // Initial calculation
        if (connectionState.isConnected()) {
            await this.recalculate();
        }

        this.isActive = true;
    }

    /**
     * Set up event listeners for automatic updates
     */
    setupEventListeners() {
        // Listen for market price updates
        this.priceUpdateHandler = () => {
            // Debounce price updates to avoid excessive recalculation
            clearTimeout(this.priceUpdateDebounceTimer);
            this.priceUpdateDebounceTimer = setTimeout(() => {
                if (this.isActive && connectionState.isConnected()) {
                    console.log('[Networth] Market prices updated, recalculating');
                    this.recalculate();
                }
            }, 1000); // 1 second debounce for price updates
        };

        marketAPI.on(this.priceUpdateHandler);

        // Listen for inventory changes
        this.itemsUpdateHandler = () => {
            // Debounce item updates
            clearTimeout(this.itemsUpdateDebounceTimer);
            this.itemsUpdateDebounceTimer = setTimeout(() => {
                if (this.isActive && connectionState.isConnected()) {
                    this.recalculate();
                }
            }, 500); // 500ms debounce for inventory changes
        };

        dataManager.on('items_updated', this.itemsUpdateHandler);
    }

    /**
     * Pause event listeners (called when tab is hidden)
     */
    pauseListeners() {
        // Clear any pending debounce timers
        clearTimeout(this.priceUpdateDebounceTimer);
        clearTimeout(this.itemsUpdateDebounceTimer);
    }

    /**
     * Resume event listeners (called when tab is visible)
     */
    resumeListeners() {
        // Recalculate immediately when resuming
        if (this.isActive && connectionState.isConnected()) {
            this.recalculate();
        }
    }

    /**
     * Recalculate networth and update displays
     */
    async recalculate() {
        if (!connectionState.isConnected()) {
            return;
        }

        try {
            // Calculate networth
            const networthData = await calculateNetworth();
            this.currentData = networthData;

            // Update displays
            if (config.isFeatureEnabled('networth')) {
                networthHeaderDisplay.update(networthData);
            }

            if (config.isFeatureEnabled('inventorySummary')) {
                networthInventoryDisplay.update(networthData);
            }
        } catch (error) {
            console.error('[Networth] Error calculating networth:', error);
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        // Clear debounce timers
        clearTimeout(this.priceUpdateDebounceTimer);
        clearTimeout(this.itemsUpdateDebounceTimer);

        // Unregister event listeners
        if (this.priceUpdateHandler) {
            marketAPI.off(this.priceUpdateHandler);
            this.priceUpdateHandler = null;
        }

        if (this.itemsUpdateHandler) {
            dataManager.off('items_updated', this.itemsUpdateHandler);
            this.itemsUpdateHandler = null;
        }

        if (this.pauseRegistry) {
            this.pauseRegistry.unregister('networth-event-listeners');
            this.pauseRegistry.cleanup();
            this.pauseRegistry = null;
        }

        this.timerRegistry.clearAll();

        networthHeaderDisplay.disable();
        networthInventoryDisplay.disable();

        // Clear the enhancement cost cache (character-specific)
        networthCache.clear();

        this.currentData = null;
        this.isActive = false;
    }
}

const networthFeature = new NetworthFeature();

export default networthFeature;
