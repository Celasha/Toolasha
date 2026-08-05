/**
 * Enhancement Feature Wrapper
 * Manages initialization and cleanup of all enhancement-related components
 * Fixes handler accumulation by coordinating tracker, UI, and handlers
 */

import enhancementTracker from './enhancement-tracker.js';
import enhancementUI from './enhancement-ui.js';
import { setupEnhancementHandlers, cleanupEnhancementHandlers } from './enhancement-handlers.js';

export class EnhancementFeature {
    constructor() {
        this.isInitialized = false;
        this.lifecycleGeneration = 0;
    }

    /**
     * Initialize all enhancement components
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        const generation = ++this.lifecycleGeneration;
        this.isInitialized = true;

        // Initialize tracker (async)
        await enhancementTracker.initialize();

        if (generation !== this.lifecycleGeneration || !enhancementTracker.isInitialized) {
            if (generation === this.lifecycleGeneration) {
                this.isInitialized = false;
            }
            return;
        }

        // Setup WebSocket handlers
        setupEnhancementHandlers();

        // Initialize UI
        enhancementUI.initialize();
    }

    /**
     * Cleanup all enhancement components
     */
    disable() {
        this.lifecycleGeneration += 1;

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
