/**
 * Enhancement Feature Wrapper
 * Manages initialization and cleanup of all enhancement-related components
 * Fixes handler accumulation by coordinating tracker, UI, and handlers
 */

import enhancementTracker from './enhancement-tracker.js';
import enhancementUI from './enhancement-ui.js';
import { setupEnhancementHandlers, cleanupEnhancementHandlers } from './enhancement-handlers.js';

class EnhancementFeature {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize all enhancement components
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Initialize tracker (async)
        await enhancementTracker.initialize();

        // Setup WebSocket handlers
        setupEnhancementHandlers();

        // Initialize UI
        enhancementUI.initialize();
    }

    /**
     * Cleanup all enhancement components
     */
    disable() {
        // Cleanup WebSocket handlers
        cleanupEnhancementHandlers();

        // Cleanup UI
        enhancementUI.cleanup();

        // Cleanup tracker (has its own disable method)
        if (enhancementTracker.disable) {
            enhancementTracker.disable();
        }

        this.isInitialized = false;
    }
}

const enhancementFeature = new EnhancementFeature();

export default enhancementFeature;
