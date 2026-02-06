/**
 * Feature Registry
 * Centralized feature initialization system
 */

import config from './config.js';
import dataManager from './data-manager.js';

/**
 * Feature Registry
 * Populated at runtime by the entrypoint to avoid bundling feature code in core.
 */
const featureRegistry = [];

/**
 * Initialize all enabled features
 * @returns {Promise<void>}
 */
async function initializeFeatures() {
    // Block feature initialization during character switch
    if (dataManager.getIsCharacterSwitching()) {
        return;
    }

    const errors = [];

    for (const feature of featureRegistry) {
        try {
            const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

            if (!isEnabled) {
                continue;
            }

            // Initialize feature
            if (feature.async) {
                await feature.initialize();
            } else {
                feature.initialize();
            }
        } catch (error) {
            errors.push({
                feature: feature.name,
                error: error.message,
            });
            console.error(`[Toolasha] Failed to initialize ${feature.name}:`, error);
        }
    }

    // Log errors if any occurred
    if (errors.length > 0) {
        console.error(`[Toolasha] ${errors.length} feature(s) failed to initialize`, errors);
    }
}

/**
 * Get feature by key
 * @param {string} key - Feature key
 * @returns {Object|null} Feature definition or null
 */
function getFeature(key) {
    return featureRegistry.find((f) => f.key === key) || null;
}

/**
 * Get all features
 * @returns {Array} Feature registry
 */
function getAllFeatures() {
    return [...featureRegistry];
}

/**
 * Get features by category
 * @param {string} category - Category name
 * @returns {Array} Features in category
 */
function getFeaturesByCategory(category) {
    return featureRegistry.filter((f) => f.category === category);
}

/**
 * Check health of all initialized features
 * @returns {Array<Object>} Array of failed features with details
 */
function checkFeatureHealth() {
    const failed = [];

    for (const feature of featureRegistry) {
        // Skip if feature has no health check
        if (!feature.healthCheck) continue;

        // Skip if feature is not enabled
        const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

        if (!isEnabled) continue;

        try {
            const result = feature.healthCheck();

            // null = can't verify (DOM not ready), false = failed, true = healthy
            if (result === false) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: 'Health check returned false',
                });
            }
        } catch (error) {
            failed.push({
                key: feature.key,
                name: feature.name,
                reason: `Health check error: ${error.message}`,
            });
        }
    }

    return failed;
}

/**
 * Setup character switch handler
 * Re-initializes all features when character switches
 */
function setupCharacterSwitchHandler() {
    // Guard against overlapping switches
    let isSwitching = false;
    let reinitScheduled = false;
    let reinitTimeoutId = null;

    // Handle character_switching event (cleanup phase)
    dataManager.on('character_switching', async (_data) => {
        // Prevent overlapping switches
        if (isSwitching) {
            console.warn('[FeatureRegistry] Character switch already in progress - ignoring rapid switch');
            return;
        }

        isSwitching = true;

        // Defer cleanup to next tick to prevent main thread blocking
        setTimeout(async () => {
            try {
                // Clear config cache to prevent stale settings
                if (config && typeof config.clearSettingsCache === 'function') {
                    config.clearSettingsCache();
                }

                // Disable all active features (cleanup DOM elements, event listeners, etc.)
                // Process all features without awaiting to avoid blocking
                const cleanupPromises = [];
                for (const feature of featureRegistry) {
                    try {
                        const featureInstance = getFeatureInstance(feature.key);
                        if (featureInstance && typeof featureInstance.disable === 'function') {
                            const result = featureInstance.disable();
                            // Collect promises but don't await them synchronously
                            if (result && typeof result.then === 'function') {
                                cleanupPromises.push(
                                    result.catch((error) => {
                                        console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                                    })
                                );
                            }
                        }
                    } catch (error) {
                        console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                    }
                }

                // Wait for all cleanup in parallel (non-blocking)
                if (cleanupPromises.length > 0) {
                    await Promise.all(cleanupPromises);
                }
            } catch (error) {
                console.error('[FeatureRegistry] Error during character switch cleanup:', error);
            } finally {
                // Always reset flag to allow next character switch
                isSwitching = false;
            }
        }, 0);
    });

    // Handle character_switched event (re-initialization phase)
    dataManager.on('character_switched', async (_data) => {
        // Prevent multiple overlapping reinits
        if (reinitScheduled) {
            console.warn('[FeatureRegistry] Reinit already scheduled - ignoring duplicate');
            return;
        }

        reinitScheduled = true;

        // Force cleanup of dungeon tracker UI (safety measure)
        const dungeonTrackerFeature = getFeature('dungeonTrackerUI');
        if (dungeonTrackerFeature && typeof dungeonTrackerFeature.cleanup === 'function') {
            dungeonTrackerFeature.cleanup();
        }

        // Settings UI manages its own character switch lifecycle via character_initialized event
        // No need to call settingsUI.initialize() here

        // Re-initialize features
        const reinit = async () => {
            try {
                // Reload config settings first (settings were cleared during cleanup)
                await config.loadSettings();
                config.applyColorSettings();

                // Now re-initialize all features with fresh settings
                await initializeFeatures();
            } catch (error) {
                console.error('[FeatureRegistry] Error during feature reinitialization:', error);
            } finally {
                // Reset flags to allow next switch
                isSwitching = false;
                reinitScheduled = false;
                if (reinitTimeoutId) {
                    clearTimeout(reinitTimeoutId);
                    reinitTimeoutId = null;
                }
            }
        };

        // Use requestIdleCallback for non-blocking re-init
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => reinit(), { timeout: 2000 });
        } else {
            // Fallback for browsers without requestIdleCallback
            if (reinitTimeoutId) {
                clearTimeout(reinitTimeoutId);
            }
            reinitTimeoutId = setTimeout(() => reinit(), 300); // Longer delay for game to stabilize
        }
    });
}

/**
 * Get feature instance from imported module
 * @param {string} key - Feature key
 * @returns {Object|null} Feature instance or null
 * @private
 */
function getFeatureInstance(key) {
    const feature = getFeature(key);
    if (!feature) {
        return null;
    }

    return feature.module || feature;
}

/**
 * Retry initialization for specific features
 * @param {Array<Object>} failedFeatures - Array of failed feature objects
 * @returns {Promise<void>}
 */
async function retryFailedFeatures(failedFeatures) {
    for (const failed of failedFeatures) {
        const feature = getFeature(failed.key);
        if (!feature) continue;

        try {
            if (feature.async) {
                await feature.initialize();
            } else {
                feature.initialize();
            }

            // Verify the retry actually worked by running health check
            if (feature.healthCheck) {
                const healthResult = feature.healthCheck();
                if (healthResult === false) {
                    console.warn(`[Toolasha] ${feature.name} retry completed but health check still fails`);
                }
            }
        } catch (error) {
            console.error(`[Toolasha] ${feature.name} retry failed:`, error);
        }
    }
}

/**
 * Replace the feature registry (for library split)
 * @param {Array} newFeatures - New feature registry array
 */
function replaceFeatures(newFeatures) {
    featureRegistry.length = 0; // Clear existing array
    featureRegistry.push(...newFeatures); // Add new features
}

export default {
    initializeFeatures,
    setupCharacterSwitchHandler,
    checkFeatureHealth,
    retryFailedFeatures,
    getFeature,
    getAllFeatures,
    replaceFeatures,
    getFeaturesByCategory,
};
