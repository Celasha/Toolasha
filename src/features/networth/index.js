/**
 * Networth Feature - Main Coordinator
 * Manages networth calculation and display updates
 */

import config from '../../core/config.js';
import connectionState from '../../core/connection-state.js';
import { calculateNetworth } from './networth-calculator.js';
import { networthHeaderDisplay, networthInventoryDisplay } from './networth-display.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createPauseRegistry } from '../../utils/pause-registry.js';

class NetworthFeature {
    constructor() {
        this.isActive = false;
        this.updateInterval = null;
        this.currentData = null;
        this.timerRegistry = createTimerRegistry();
        this.pauseRegistry = null;
    }

    /**
     * Initialize the networth feature
     */
    async initialize() {
        if (this.isActive) return;

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
                'networth-update-interval',
                () => this.stopAutoRefresh(),
                () => this.resumeAutoRefresh()
            );
        }

        // Start update interval (every 30 seconds)
        if (connectionState.isConnected()) {
            this.startAutoRefresh();
        }

        // Initial calculation
        if (connectionState.isConnected()) {
            await this.recalculate();
        }

        this.isActive = true;
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
        if (this.pauseRegistry) {
            this.pauseRegistry.unregister('networth-update-interval');
            this.pauseRegistry.cleanup();
            this.pauseRegistry = null;
        }

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        this.timerRegistry.clearAll();

        networthHeaderDisplay.disable();
        networthInventoryDisplay.disable();

        this.currentData = null;
        this.isActive = false;
    }

    startAutoRefresh() {
        if (this.updateInterval) {
            return;
        }

        this.updateInterval = setInterval(() => this.recalculate(), 30000);
        this.timerRegistry.registerInterval(this.updateInterval);
    }

    stopAutoRefresh() {
        if (!this.updateInterval) {
            return;
        }

        clearInterval(this.updateInterval);
        this.updateInterval = null;
    }

    resumeAutoRefresh() {
        this.startAutoRefresh();
        this.recalculate();
    }
}

const networthFeature = new NetworthFeature();

export default networthFeature;
