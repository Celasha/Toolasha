/**
 * Networth Feature - Main Coordinator
 * Manages networth calculation and display updates
 */

import config from '../../core/config.js';
import { calculateNetworth } from './networth-calculator.js';
import { networthHeaderDisplay, networthInventoryDisplay } from './networth-display.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class NetworthFeature {
    constructor() {
        this.isActive = false;
        this.updateInterval = null;
        this.currentData = null;
        this.timerRegistry = createTimerRegistry();
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

        // Start update interval (every 30 seconds)
        this.updateInterval = setInterval(() => this.recalculate(), 30000);
        this.timerRegistry.registerInterval(this.updateInterval);

        // Initial calculation
        await this.recalculate();

        this.isActive = true;
    }

    /**
     * Recalculate networth and update displays
     */
    async recalculate() {
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
}

const networthFeature = new NetworthFeature();

export default networthFeature;
