/**
 * Feature Registry
 * Centralized feature initialization system
 */

import config from './config.js';
import dataManager from './data-manager.js';
import performanceMonitor from '../utils/performance-monitor.js';
import { marketplaceSession } from './marketplace-session.js';

/**
 * Feature Registry
 * Populated at runtime by the entrypoint to avoid bundling feature code in core.
 */
const featureRegistry = [];

/**
 * Per-feature instance store: key → returned value from initialize()
 * Used to thread the instance into cleanup(instance) at teardown time.
 */
const featureInstances = new Map();

/**
 * Initialize all enabled features
 * @param {Object} [options] - Optional lifecycle guard
 * @param {Function} [options.shouldContinue] - Returns false when initialization has become stale
 * @returns {Promise<void>}
 */
async function initializeFeatures({ shouldContinue = () => true } = {}) {
    // Block feature initialization during character switch
    if (dataManager.getIsCharacterSwitching() || !shouldContinue()) {
        return;
    }

    const errors = [];

    for (const feature of featureRegistry) {
        if (!shouldContinue()) {
            break;
        }

        try {
            const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

            if (!isEnabled) {
                continue;
            }

            // Skip if already initialized (idempotency — same-character resync guard)
            if (featureInstances.has(feature.key)) {
                continue;
            }

            // Initialize feature; always await the result so async flag is not required for correctness
            const start = performance.now();
            const instance = await Promise.resolve(feature.initialize());
            const elapsed = performance.now() - start;
            performanceMonitor.snapshot(`init:${feature.key}`, elapsed);

            // Store the returned instance (may be undefined for module-singleton features)
            featureInstances.set(feature.key, instance ?? null);
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
 * Tear down all initialized features, threading their stored instance into cleanup.
 * Clears the instance store so features can be re-initialized afterward.
 * @returns {Promise<void>}
 */
async function cleanupFeatures() {
    const cleanupPromises = [];

    for (const feature of featureRegistry) {
        if (!featureInstances.has(feature.key)) continue;

        const instance = featureInstances.get(feature.key);
        featureInstances.delete(feature.key);
        performanceMonitor.clearSnapshot(`init:${feature.key}`);

        try {
            const featureModule = feature.module || feature;
            let result;

            if (typeof featureModule.cleanup === 'function') {
                result = featureModule.cleanup(instance);
            } else if (typeof featureModule.disable === 'function') {
                result = featureModule.disable(instance);
            } else if (instance && typeof instance.disable === 'function') {
                result = instance.disable();
            } else if (instance && typeof instance.cleanup === 'function') {
                result = instance.cleanup();
            }

            if (result && typeof result.then === 'function') {
                cleanupPromises.push(
                    result.catch((error) => {
                        console.error(`[FeatureRegistry] Failed to clean up ${feature.name}:`, error);
                    })
                );
            }
        } catch (error) {
            console.error(`[FeatureRegistry] Failed to clean up ${feature.name}:`, error);
        }
    }

    if (cleanupPromises.length > 0) {
        await Promise.all(cleanupPromises);
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
    // Character switch lifecycle work is serialized through one queue. A monotonic
    // generation lets stale reinits stop when a newer switch arrives (A → B → A).
    // This prevents both dropped switch events and late cleanup from touching the
    // newest character's freshly initialized features.
    let lifecycleGeneration = 0;
    let lifecycleQueue = Promise.resolve();

    const enqueueLifecycleTask = (label, task) => {
        lifecycleQueue = lifecycleQueue
            .catch((error) => {
                console.error('[FeatureRegistry] Previous lifecycle task failed:', error);
            })
            .then(task)
            .catch((error) => {
                console.error(`[FeatureRegistry] ${label} lifecycle task failed:`, error);
            });

        return lifecycleQueue;
    };

    // Handle character_switching event (cleanup phase)
    dataManager.on('character_switching', (_data) => {
        lifecycleGeneration += 1;

        // Clear config cache immediately, before any asynchronous cleanup starts,
        // so code still running from the departing character cannot read its settings.
        if (config && typeof config.clearSettingsCache === 'function') {
            config.clearSettingsCache();
        }

        return enqueueLifecycleTask('character cleanup', async () => {
            // End any active marketplace session before features clean up.
            marketplaceSession.endAll();
            marketplaceSession.clearAllMarketplaceUI();

            await cleanupFeatures();
        });
    });

    // Handle character_switched event (re-initialization phase)
    dataManager.on('character_switched', (data) => {
        const generation = lifecycleGeneration;
        const targetCharacterId = data?.newId ? String(data.newId) : null;

        const isCurrentGeneration = () => {
            if (generation !== lifecycleGeneration) {
                return false;
            }

            const currentCharacterId = dataManager.getCurrentCharacterId?.();
            if (targetCharacterId && currentCharacterId != null) {
                return String(currentCharacterId) === targetCharacterId;
            }

            return true;
        };

        return enqueueLifecycleTask('character reinitialization', async () => {
            // A newer switch may have arrived while this task waited in the queue.
            if (!isCurrentGeneration()) {
                return;
            }

            // CRITICAL: Load settings BEFORE any feature initialization
            // This ensures all features see the new character's settings
            await config.loadSettings({ notifyChanges: false });

            // Loading IndexedDB can take long enough for another character switch.
            // Never apply or initialize settings that no longer belong to the active character.
            if (!isCurrentGeneration()) {
                return;
            }

            config.applyColorSettings();

            // Small delay to ensure game state is stable
            await new Promise((resolve) => setTimeout(resolve, 50));

            if (!isCurrentGeneration()) {
                return;
            }

            // Now re-initialize all features with fresh settings
            await initializeFeatures({ shouldContinue: isCurrentGeneration });
        });
    });
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

        // Clear stale instance state so initializeFeatures won't skip it
        featureInstances.delete(feature.key);

        try {
            const instance = await Promise.resolve(feature.initialize());
            featureInstances.set(feature.key, instance ?? null);

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
