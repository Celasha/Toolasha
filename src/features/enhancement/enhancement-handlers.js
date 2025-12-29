/**
 * Enhancement Event Handlers
 * Automatically detects and tracks enhancement events from WebSocket messages
 */

import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import enhancementTracker from './enhancement-tracker.js';
import enhancementUI from './enhancement-ui.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import { calculateSuccessXP, calculateFailureXP, calculateAdjustedAttemptCount } from './enhancement-xp.js';

/**
 * Setup enhancement event handlers
 */
export function setupEnhancementHandlers() {
    // Listen for action_completed (when enhancement completes)
    webSocketHook.on('action_completed', handleActionCompleted);

    // Listen for wildcard to catch all messages for debugging
    webSocketHook.on('*', handleDebugMessage);

    console.log('[Enhancement Handlers] Event handlers registered');
}

/**
 * Debug handler to log all messages temporarily
 * @param {Object} data - WebSocket message data
 */
function handleDebugMessage(data) {
    if (data.type === 'action_completed' && data.endCharacterAction) {
        console.log('[Enhancement Debug] action_completed received:', {
            type: data.type,
            actionHrid: data.endCharacterAction.actionHrid,
            primaryItemHash: data.endCharacterAction.primaryItemHash
        });
    }
}

/**
 * Handle action_completed message (detects enhancement results)
 * @param {Object} data - WebSocket message data
 */
async function handleActionCompleted(data) {
    if (!config.getSetting('enhancementTracker')) return;
    if (!enhancementTracker.isInitialized) return;

    const action = data.endCharacterAction;
    if (!action) return;

    // Check if this is an enhancement action
    // Ultimate Enhancement Tracker checks: actionHrid === "/actions/enhancing/enhance"
    if (action.actionHrid !== '/actions/enhancing/enhance') {
        return;
    }

    console.log('[Enhancement Handlers] Enhancement action completed:', {
        actionHrid: action.actionHrid,
        primaryItemHash: action.primaryItemHash,
        secondaryItemHash: action.secondaryItemHash,
        enhancingMaxLevel: action.enhancingMaxLevel,
        enhancingProtectionMinLevel: action.enhancingProtectionMinLevel
    });

    // Handle the enhancement
    await handleEnhancementResult(action, data);
}

/**
 * Extract protection item HRID from action data
 * @param {Object} action - Enhancement action data
 * @returns {string|null} Protection item HRID or null
 */
function getProtectionItemHrid(action) {
    console.log('[Enhancement Handlers] getProtectionItemHrid called:', {
        enhancingProtectionMinLevel: action.enhancingProtectionMinLevel,
        secondaryItemHash: action.secondaryItemHash,
        enhancingProtectionItemHrid: action.enhancingProtectionItemHrid
    });

    // Check if protection is enabled
    if (!action.enhancingProtectionMinLevel || action.enhancingProtectionMinLevel < 2) {
        console.log('[Enhancement Handlers] Protection not enabled (minLevel < 2)');
        return null;
    }

    // Extract protection item from secondaryItemHash (Ultimate Tracker method)
    if (action.secondaryItemHash) {
        const parts = action.secondaryItemHash.split('::');
        console.log('[Enhancement Handlers] secondaryItemHash parts:', parts);
        if (parts.length >= 3 && parts[2].startsWith('/items/')) {
            console.log('[Enhancement Handlers] Protection item detected:', parts[2]);
            return parts[2];
        }
    }

    // Fallback: check if there's a direct enhancingProtectionItemHrid field
    if (action.enhancingProtectionItemHrid) {
        console.log('[Enhancement Handlers] Using direct enhancingProtectionItemHrid:', action.enhancingProtectionItemHrid);
        return action.enhancingProtectionItemHrid;
    }

    console.log('[Enhancement Handlers] No protection item found');
    return null;
}

/**
 * Handle enhancement action start
 * @param {Object} action - Enhancement action data
 */
async function handleEnhancementStart(action) {
    try {
        // Parse item hash to get HRID and level
        const { itemHrid, level: currentLevel } = parseItemHash(action.primaryItemHash);

        if (!itemHrid) {
            console.warn('[Enhancement Handlers] No item HRID found in action');
            return;
        }

        console.log('[Enhancement Handlers] Enhancement started:', itemHrid, 'Level:', currentLevel);
        console.log('[Enhancement Handlers] Game UI settings:', {
            maxLevel: action.enhancingMaxLevel,
            protectionMinLevel: action.enhancingProtectionMinLevel
        });

        // Check if auto-start is enabled
        const autoStart = config.getSetting('enhancementTracker_autoStart');

        // Get target level from game UI (what the user set in the enhancement slider)
        // If not available, default to +5
        const targetLevel = action.enhancingMaxLevel || Math.min(currentLevel + 5, 20);
        const protectFrom = action.enhancingProtectionMinLevel || 0;

        // Priority 1: Check for matching TRACKING session (resume incomplete session)
        const matchingSessionId = enhancementTracker.findMatchingSession(
            itemHrid,
            currentLevel,
            targetLevel,
            protectFrom
        );

        if (matchingSessionId) {
            console.log('[Enhancement Handlers] Resuming tracking session');
            await enhancementTracker.resumeSession(matchingSessionId);
            return;
        }

        // Priority 2: Check for COMPLETED session that can be extended
        const extendableSessionId = enhancementTracker.findExtendableSession(itemHrid, currentLevel);

        if (extendableSessionId) {
            console.log('[Enhancement Handlers] Extending completed session to new target');
            // Extend by 5 levels (or to 20, whichever is lower)
            const newTarget = Math.min(currentLevel + 5, 20);
            await enhancementTracker.extendSessionTarget(extendableSessionId, newTarget);
            return;
        }

        // Priority 3: Different item or level - finalize any active session
        const currentSession = enhancementTracker.getCurrentSession();
        if (currentSession) {
            console.log('[Enhancement Handlers] Different item/level, finalizing previous session');
            await enhancementTracker.finalizeCurrentSession();
        }

        // Priority 4: Start new session if auto-start enabled
        if (autoStart) {
            await enhancementTracker.startSession(itemHrid, currentLevel, targetLevel, protectFrom);
            console.log('[Enhancement Handlers] Auto-started new session with target:', targetLevel, 'protectFrom:', protectFrom);
        }

    } catch (error) {
        console.error('[Enhancement Handlers] Error handling enhancement start:', error);
    }
}

/**
 * Parse item hash to extract HRID and level
 * Based on Ultimate Enhancement Tracker's parseItemHash function
 * @param {string} primaryItemHash - Item hash from action
 * @returns {Object} {itemHrid, level}
 */
function parseItemHash(primaryItemHash) {
    try {
        // Handle different possible formats:
        // 1. "/item_locations/inventory::/items/enhancers_bottoms::0" (level 0)
        // 2. "161296::/item_locations/inventory::/items/enhancers_bottoms::5" (level 5)
        // 3. Direct HRID like "/items/enhancers_bottoms" (no level)

        let itemHrid = null;
        let level = 0; // Default to 0 if not specified

        // Split by :: to parse components
        const parts = primaryItemHash.split('::');

        // Find the part that starts with /items/
        const itemPart = parts.find(part => part.startsWith('/items/'));
        if (itemPart) {
            itemHrid = itemPart;
        }
        // If no /items/ found but it's a direct HRID
        else if (primaryItemHash.startsWith('/items/')) {
            itemHrid = primaryItemHash;
        }

        // Try to extract enhancement level (last part after ::)
        const lastPart = parts[parts.length - 1];
        if (lastPart && !lastPart.startsWith('/')) {
            const parsedLevel = parseInt(lastPart, 10);
            if (!isNaN(parsedLevel)) {
                level = parsedLevel;
            }
        }

        return { itemHrid, level };
    } catch (error) {
        console.error('[Enhancement Handlers] Error parsing item hash:', error);
        return { itemHrid: null, level: 0 };
    }
}

/**
 * Get enhancement materials and costs for an item
 * Based on Ultimate Enhancement Tracker's getEnhancementMaterials function
 * @param {string} itemHrid - Item HRID
 * @returns {Array|null} Array of [hrid, count] pairs or null
 */
function getEnhancementMaterials(itemHrid) {
    try {
        const gameData = dataManager.getInitClientData();
        const itemData = gameData?.itemDetailMap?.[itemHrid];

        if (!itemData) {
            console.warn('[Enhancement Handlers] Item not found:', itemHrid);
            return null;
        }

        // Get the costs array
        const costs = itemData.enhancementCosts;

        if (!costs) {
            console.warn('[Enhancement Handlers] No enhancement costs found for:', itemHrid);
            return null;
        }

        let materials = [];

        // Case 1: Array of objects (current format)
        if (Array.isArray(costs) && costs.length > 0 && typeof costs[0] === 'object') {
            materials = costs.map(cost => [cost.itemHrid, cost.count]);
        }
        // Case 2: Already in correct format [["/items/foo", 30], ["/items/bar", 20]]
        else if (Array.isArray(costs) && costs.length > 0 && Array.isArray(costs[0])) {
            materials = costs;
        }
        // Case 3: Object format {"/items/foo": 30, "/items/bar": 20}
        else if (typeof costs === 'object' && !Array.isArray(costs)) {
            materials = Object.entries(costs);
        }

        // Filter out any invalid entries
        materials = materials.filter(m =>
            Array.isArray(m) &&
            m.length === 2 &&
            typeof m[0] === 'string' &&
            typeof m[1] === 'number'
        );

        return materials.length > 0 ? materials : null;
    } catch (error) {
        console.error('[Enhancement Handlers] Error getting materials:', error);
        return null;
    }
}

/**
 * Track material costs for current attempt
 * Based on Ultimate Enhancement Tracker's trackMaterialCosts function
 * @param {string} itemHrid - Item HRID
 * @returns {Promise<{materialCost: number, coinCost: number}>}
 */
async function trackMaterialCosts(itemHrid) {
    const materials = getEnhancementMaterials(itemHrid) || [];
    let materialCost = 0;
    let coinCost = 0;

    for (const [resourceHrid, count] of materials) {
        // Check if this is coins
        if (resourceHrid.includes('/items/coin')) {
            // Track coins for THIS ATTEMPT ONLY
            coinCost = count; // Coins are 1:1 value
            await enhancementTracker.trackCoinCost(count);
        } else {
            // Track material costs
            await enhancementTracker.trackMaterialCost(resourceHrid, count);
            // Add to material cost total
            const priceData = marketAPI.getPrice(resourceHrid, 0);
            const unitCost = priceData ? (priceData.ask || priceData.bid || 0) : 0;
            materialCost += unitCost * count;
        }
    }

    return { materialCost, coinCost };
}

/**
 * Handle enhancement result (success or failure)
 * @param {Object} action - Enhancement action data
 * @param {Object} data - Full WebSocket message data
 */
async function handleEnhancementResult(action, data) {
    try {
        const { itemHrid, level: newLevel } = parseItemHash(action.primaryItemHash);
        const rawCount = action.currentCount || 0;

        if (!itemHrid) {
            console.warn('[Enhancement Handlers] No item HRID found in result');
            return;
        }

        console.log('[Enhancement Handlers] Enhancement result:', {
            item: itemHrid,
            newLevel,
            rawCount
        });

        // On first attempt (rawCount === 1), start session if auto-start is enabled
        // BUT: Ignore if we already have an active session (handles out-of-order events)
        let currentSession = enhancementTracker.getCurrentSession();
        if (rawCount === 1) {
            if (currentSession && currentSession.itemHrid === itemHrid) {
                // Already have a session for this item, ignore this late rawCount=1 event
                console.log('[Enhancement Handlers] Ignoring late rawCount=1 event, session already exists');
                return;
            }

            if (!currentSession) {
                // CRITICAL: On first event, primaryItemHash shows RESULT level, not starting level
                // We need to infer the starting level from the result
                const protectFrom = action.enhancingProtectionMinLevel || 0;
                let startLevel = newLevel;

                // If result > 0 and below protection threshold, must have started one level lower
                if (newLevel > 0 && newLevel < Math.max(2, protectFrom)) {
                    startLevel = newLevel - 1; // Successful enhancement (e.g., 0→1)
                }
                // Otherwise, started at same level (e.g., 0→0 failure, or protected failure)

                console.log('[Enhancement Handlers] First attempt - inferred start level:', startLevel, 'result level:', newLevel);

                const autoStart = config.getSetting('enhancementTracker_autoStart');
                if (autoStart) {
                    const targetLevel = action.enhancingMaxLevel || Math.min(newLevel + 5, 20);
                    await enhancementTracker.startSession(itemHrid, startLevel, targetLevel, protectFrom);
                    currentSession = enhancementTracker.getCurrentSession();
                    console.log('[Enhancement Handlers] Auto-started new session with target:', targetLevel, 'protectFrom:', protectFrom);
                }

                if (!currentSession) {
                    console.log('[Enhancement Handlers] No session started, auto-start disabled');
                    return;
                }
            }
        }

        // If no active session, check if we can extend a completed session
        if (!currentSession) {
            // Try to extend a completed session for the same item
            const extendableSessionId = enhancementTracker.findExtendableSession(itemHrid, newLevel);
            if (extendableSessionId) {
                console.log('[Enhancement Handlers] Extending completed session mid-enhancement');
                const newTarget = Math.min(newLevel + 5, 20);
                await enhancementTracker.extendSessionTarget(extendableSessionId, newTarget);
                currentSession = enhancementTracker.getCurrentSession();
            } else {
                console.log('[Enhancement Handlers] No active session for result');
                return;
            }
        }

        // Calculate adjusted attempt count (resume-proof)
        const adjustedCount = calculateAdjustedAttemptCount(currentSession);
        console.log('[Enhancement Handlers] Adjusted attempt count:', adjustedCount, '(raw:', rawCount, ')');

        // Track costs for EVERY attempt (including first)
        const { materialCost, coinCost } = await trackMaterialCosts(itemHrid);
        console.log('[Enhancement Handlers] Costs tracked:', { materialCost, coinCost });

        // Get previous level from lastAttempt
        const previousLevel = currentSession.lastAttempt?.level ?? currentSession.startLevel;

        console.log('[Enhancement Handlers] DEBUG - totalAttempts:', currentSession.totalAttempts,
                    'adjustedCount:', adjustedCount, 'previousLevel:', previousLevel, 'newLevel:', newLevel);

        // Check protection item usage BEFORE recording attempt
        // Track protection cost if protection item exists in action data
        // Protection items are consumed when:
        // 1. Level would have decreased (Mirror of Protection prevents decrease, level stays same)
        // 2. Level increased (Philosopher's Mirror guarantees success)
        const protectionItemHrid = getProtectionItemHrid(action);
        if (protectionItemHrid) {
            // Only track if we're at a level where protection might be used
            // (either level stayed same when it could have decreased, or succeeded at high level)
            const protectFrom = currentSession.protectFrom || 0;
            const shouldTrack = previousLevel >= Math.max(2, protectFrom);

            if (shouldTrack && (newLevel <= previousLevel || newLevel === previousLevel + 1)) {
                // Use market price (like Ultimate Tracker) instead of vendor price
                const marketPrice = marketAPI.getPrice(protectionItemHrid, 0);
                let protectionCost = marketPrice?.ask || marketPrice?.bid || 0;

                // Fall back to vendor price if market price unavailable
                if (protectionCost === 0) {
                    const gameData = dataManager.getInitClientData();
                    const protectionItem = gameData?.itemDetailMap?.[protectionItemHrid];
                    protectionCost = protectionItem?.vendorSellPrice || 0;
                }

                await enhancementTracker.trackProtectionCost(protectionItemHrid, protectionCost);
                console.log('[Enhancement Handlers] Protection item used:', protectionItemHrid, protectionCost);
            }
        }

        // Determine result type
        const wasSuccess = newLevel > previousLevel;

        // Failure detection:
        // 1. Level decreased (1→0, 5→4, etc.)
        // 2. Stayed at 0 (0→0 fail)
        // 3. Stayed at non-zero level WITH protection item (protected failure)
        const levelDecreased = newLevel < previousLevel;
        const failedAtZero = previousLevel === 0 && newLevel === 0;
        const protectedFailure = previousLevel > 0 && newLevel === previousLevel && protectionItemHrid !== null;
        const wasFailure = levelDecreased || failedAtZero || protectedFailure;

        const wasBlessed = wasSuccess && (newLevel - previousLevel) >= 2; // Blessed tea detection

        console.log('[Enhancement Handlers] Result:', {
            previousLevel,
            newLevel,
            wasSuccess,
            wasFailure,
            wasBlessed,
            adjustedCount
        });

        // Update lastAttempt BEFORE recording (so next attempt compares correctly)
        currentSession.lastAttempt = {
            attemptNumber: adjustedCount,
            level: newLevel,
            timestamp: Date.now()
        };

        // Record the result and track XP
        if (wasSuccess) {
            const xpGain = calculateSuccessXP(previousLevel, itemHrid);
            currentSession.totalXP += xpGain;

            console.log('[Enhancement Handlers] Enhancement succeeded:', previousLevel, '→', newLevel,
                        wasBlessed ? '(BLESSED!)' : '', '+' + xpGain, 'XP');
            await enhancementTracker.recordSuccess(previousLevel, newLevel);
            enhancementUI.scheduleUpdate(); // Update UI after success

            // Check if we've reached target
            if (newLevel >= currentSession.targetLevel) {
                console.log('[Enhancement Handlers] Target level reached! Session completed.');
            }
        } else if (wasFailure) {
            const xpGain = calculateFailureXP(previousLevel, itemHrid);
            currentSession.totalXP += xpGain;

            console.log('[Enhancement Handlers] Enhancement failed at level', previousLevel, '(now at', newLevel, ') +' + xpGain, 'XP');
            await enhancementTracker.recordFailure(previousLevel);
            enhancementUI.scheduleUpdate(); // Update UI after failure
        }
        // Note: If newLevel === previousLevel (and not 0->0), we track costs but don't record attempt
        // This happens with protection items that prevent level decrease

    } catch (error) {
        console.error('[Enhancement Handlers] Error handling enhancement result:', error);
    }
}

/**
 * Cleanup event handlers
 */
export function cleanupEnhancementHandlers() {
    webSocketHook.off('action_completed', handleActionCompleted);
    webSocketHook.off('*', handleDebugMessage);
    console.log('[Enhancement Handlers] Event handlers removed');
}
