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
}

/**
 * Debug handler to log all messages temporarily
 * @param {Object} _data - WebSocket message data
 */
function handleDebugMessage(_data) {
    // Debug logging removed
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

    // Handle the enhancement
    await handleEnhancementResult(action, data);
}

/**
 * Extract protection item HRID from action data
 * @param {Object} action - Enhancement action data
 * @returns {string|null} Protection item HRID or null
 */
function getProtectionItemHrid(action) {
    // Check if protection is enabled
    if (!action.enhancingProtectionMinLevel || action.enhancingProtectionMinLevel < 2) {
        return null;
    }

    // Extract protection item from secondaryItemHash (Ultimate Tracker method)
    if (action.secondaryItemHash) {
        const parts = action.secondaryItemHash.split('::');
        if (parts.length >= 3 && parts[2].startsWith('/items/')) {
            return parts[2];
        }
    }

    // Fallback: check if there's a direct enhancingProtectionItemHrid field
    if (action.enhancingProtectionItemHrid) {
        return action.enhancingProtectionItemHrid;
    }

    return null;
}

/**
 * Handle enhancement action start
 * @param {Object} action - Enhancement action data
 */
async function _handleEnhancementStart(action) {
    try {
        // Parse item hash to get HRID and level
        const { itemHrid, level: currentLevel } = parseItemHash(action.primaryItemHash);

        if (!itemHrid) {
            return;
        }

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
            await enhancementTracker.resumeSession(matchingSessionId);
            enhancementUI.scheduleUpdate();
            return;
        }

        // Priority 2: Check for COMPLETED session that can be extended
        const extendableSessionId = enhancementTracker.findExtendableSession(itemHrid, currentLevel);

        if (extendableSessionId) {
            // Extend by 5 levels (or to 20, whichever is lower)
            const newTarget = Math.min(currentLevel + 5, 20);
            await enhancementTracker.extendSessionTarget(extendableSessionId, newTarget);
            enhancementUI.switchToSession(extendableSessionId);
            enhancementUI.scheduleUpdate();
            return;
        }

        // Priority 3: Different item or level - finalize any active session
        const currentSession = enhancementTracker.getCurrentSession();
        if (currentSession) {
            await enhancementTracker.finalizeCurrentSession();
        }

        // Priority 4: Always start new session when tracker is enabled
        const sessionId = await enhancementTracker.startSession(itemHrid, currentLevel, targetLevel, protectFrom);
        enhancementUI.switchToSession(sessionId);
        enhancementUI.scheduleUpdate();
    } catch {
        // Silent failure
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
        const itemPart = parts.find((part) => part.startsWith('/items/'));
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
    } catch {
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
            return null;
        }

        // Get the costs array
        const costs = itemData.enhancementCosts;

        if (!costs) {
            return null;
        }

        let materials = [];

        // Case 1: Array of objects (current format)
        if (Array.isArray(costs) && costs.length > 0 && typeof costs[0] === 'object') {
            materials = costs.map((cost) => [cost.itemHrid, cost.count]);
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
        materials = materials.filter(
            (m) => Array.isArray(m) && m.length === 2 && typeof m[0] === 'string' && typeof m[1] === 'number'
        );

        return materials.length > 0 ? materials : null;
    } catch {
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
            const unitCost = priceData ? priceData.ask || priceData.bid || 0 : 0;
            materialCost += unitCost * count;
        }
    }

    return { materialCost, coinCost };
}

/**
 * Handle enhancement result (success or failure)
 * @param {Object} action - Enhancement action data
 * @param {Object} _data - Full WebSocket message data
 */
async function handleEnhancementResult(action, _data) {
    try {
        const { itemHrid, level: newLevel } = parseItemHash(action.primaryItemHash);
        const rawCount = action.currentCount || 0;

        if (!itemHrid) {
            return;
        }

        // Check for item changes on EVERY attempt (not just rawCount === 1)
        let currentSession = enhancementTracker.getCurrentSession();
        let justCreatedNewSession = false;

        // If session exists but is for a different item, finalize and start new session
        if (currentSession && currentSession.itemHrid !== itemHrid) {
            await enhancementTracker.finalizeCurrentSession();
            currentSession = null;

            // Create new session for the new item
            const protectFrom = action.enhancingProtectionMinLevel || 0;
            const targetLevel = action.enhancingMaxLevel || Math.min(newLevel + 5, 20);

            // Infer starting level from current level
            let startLevel = newLevel;
            if (newLevel > 0 && newLevel < Math.max(2, protectFrom)) {
                startLevel = newLevel - 1;
            }

            const sessionId = await enhancementTracker.startSession(itemHrid, startLevel, targetLevel, protectFrom);
            currentSession = enhancementTracker.getCurrentSession();
            justCreatedNewSession = true; // Flag that we just created this session

            // Switch UI to new session and update display
            enhancementUI.switchToSession(sessionId);
            enhancementUI.scheduleUpdate();
        }

        // On first attempt (rawCount === 1), start session if auto-start is enabled
        // BUT: Don't create a new session if we already have one for this item
        if (rawCount === 1 && !justCreatedNewSession && !currentSession) {
            // CRITICAL: On first event, primaryItemHash shows RESULT level, not starting level
            // We need to infer the starting level from the result
            const protectFrom = action.enhancingProtectionMinLevel || 0;
            let startLevel = newLevel;

            // If result > 0 and below protection threshold, must have started one level lower
            if (newLevel > 0 && newLevel < Math.max(2, protectFrom)) {
                startLevel = newLevel - 1; // Successful enhancement (e.g., 0→1)
            }
            // Otherwise, started at same level (e.g., 0→0 failure, or protected failure)

            // Always start new session when tracker is enabled
            const targetLevel = action.enhancingMaxLevel || Math.min(newLevel + 5, 20);
            const sessionId = await enhancementTracker.startSession(itemHrid, startLevel, targetLevel, protectFrom);
            currentSession = enhancementTracker.getCurrentSession();

            // Switch UI to new session and update display
            enhancementUI.switchToSession(sessionId);
            enhancementUI.scheduleUpdate();

            if (!currentSession) {
                return;
            }
        }

        // If no active session, check if we can extend a completed session
        if (!currentSession) {
            // Try to extend a completed session for the same item
            const extendableSessionId = enhancementTracker.findExtendableSession(itemHrid, newLevel);
            if (extendableSessionId) {
                const newTarget = Math.min(newLevel + 5, 20);
                await enhancementTracker.extendSessionTarget(extendableSessionId, newTarget);
                currentSession = enhancementTracker.getCurrentSession();

                // Switch UI to extended session and update display
                enhancementUI.switchToSession(extendableSessionId);
                enhancementUI.scheduleUpdate();
            } else {
                return;
            }
        }

        // Calculate adjusted attempt count (resume-proof)
        const adjustedCount = calculateAdjustedAttemptCount(currentSession);

        // Track costs for EVERY attempt (including first)
        const { materialCost: _materialCost, coinCost: _coinCost } = await trackMaterialCosts(itemHrid);

        // Get previous level from lastAttempt
        const previousLevel = currentSession.lastAttempt?.level ?? currentSession.startLevel;

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

        const _wasBlessed = wasSuccess && newLevel - previousLevel >= 2; // Blessed tea detection

        // Update lastAttempt BEFORE recording (so next attempt compares correctly)
        currentSession.lastAttempt = {
            attemptNumber: adjustedCount,
            level: newLevel,
            timestamp: Date.now(),
        };

        // Record the result and track XP
        if (wasSuccess) {
            const xpGain = calculateSuccessXP(previousLevel, itemHrid);
            currentSession.totalXP += xpGain;

            await enhancementTracker.recordSuccess(previousLevel, newLevel);
            enhancementUI.scheduleUpdate(); // Update UI after success

            // Check if we've reached target
            if (newLevel >= currentSession.targetLevel) {
                // Target reached - session will auto-complete on next UI update
            }
        } else if (wasFailure) {
            const xpGain = calculateFailureXP(previousLevel, itemHrid);
            currentSession.totalXP += xpGain;

            await enhancementTracker.recordFailure(previousLevel, newLevel);
            enhancementUI.scheduleUpdate(); // Update UI after failure
        }
        // Note: If newLevel === previousLevel (and not 0->0), we track costs but don't record attempt
        // This happens with protection items that prevent level decrease
    } catch {
        // Silent failure
    }
}

/**
 * Cleanup event handlers
 */
export function cleanupEnhancementHandlers() {
    webSocketHook.off('action_completed', handleActionCompleted);
    webSocketHook.off('*', handleDebugMessage);
}
