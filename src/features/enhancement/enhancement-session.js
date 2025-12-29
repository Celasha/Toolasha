/**
 * Enhancement Session Data Structure
 * Represents a single enhancement tracking session for one item
 */

/**
 * Session states
 */
export const SessionState = {
    IDLE: 'idle',           // No active session
    TRACKING: 'tracking',   // Currently tracking enhancements
    COMPLETED: 'completed', // Target reached or manually stopped
    ARCHIVED: 'archived'    // Historical session (read-only)
};

/**
 * Create a new enhancement session
 * @param {string} itemHrid - Item HRID being enhanced
 * @param {string} itemName - Display name of item
 * @param {number} startLevel - Starting enhancement level
 * @param {number} targetLevel - Target enhancement level (1-20)
 * @param {number} protectFrom - Level to start using protection items (0 = never)
 * @returns {Object} New session object
 */
export function createSession(itemHrid, itemName, startLevel, targetLevel, protectFrom = 0) {
    const now = Date.now();

    return {
        // Session metadata
        id: `session_${now}`,
        state: SessionState.TRACKING,
        itemHrid,
        itemName,
        startLevel,
        targetLevel,
        currentLevel: startLevel,
        protectFrom,

        // Timestamps
        startTime: now,
        lastUpdateTime: now,
        endTime: null,

        // Last attempt tracking (for detecting success/failure)
        lastAttempt: {
            attemptNumber: 0,
            level: startLevel,
            timestamp: now
        },

        // Attempt tracking (per level)
        // Format: { 1: { success: 5, fail: 3, successRate: 0.625 }, ... }
        attemptsPerLevel: {},

        // Cost tracking
        materialCosts: {}, // Format: { itemHrid: { count: 10, totalCost: 50000 } }
        coinCost: 0,
        coinCount: 0, // Track number of times coins were spent
        protectionCost: 0,
        protectionCount: 0,
        protectionItemHrid: null, // Track which protection item is being used
        totalCost: 0,

        // Statistics
        totalAttempts: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        totalXP: 0, // Total XP gained from enhancements
        longestSuccessStreak: 0,
        longestFailureStreak: 0,
        currentStreak: { type: null, count: 0 }, // 'success' or 'fail'

        // Milestones reached
        milestonesReached: [], // [5, 10, 15, 20]

        // Enhancement predictions (optional - calculated at session start)
        predictions: null // { expectedAttempts, expectedProtections, ... }
    };
}

/**
 * Initialize attempts tracking for a level
 * @param {Object} session - Session object
 * @param {number} level - Enhancement level
 */
export function initializeLevelTracking(session, level) {
    if (!session.attemptsPerLevel[level]) {
        session.attemptsPerLevel[level] = {
            success: 0,
            fail: 0,
            successRate: 0
        };
    }
}

/**
 * Update success rate for a level
 * @param {Object} session - Session object
 * @param {number} level - Enhancement level
 */
export function updateSuccessRate(session, level) {
    const levelData = session.attemptsPerLevel[level];
    if (!levelData) return;

    const total = levelData.success + levelData.fail;
    levelData.successRate = total > 0 ? levelData.success / total : 0;
}

/**
 * Record a successful enhancement attempt
 * @param {Object} session - Session object
 * @param {number} previousLevel - Level before enhancement (level that succeeded)
 * @param {number} newLevel - New level after success
 */
export function recordSuccess(session, previousLevel, newLevel) {
    // Initialize tracking if needed for the level that succeeded
    initializeLevelTracking(session, previousLevel);

    // Record success at the level we enhanced FROM
    session.attemptsPerLevel[previousLevel].success++;
    session.totalAttempts++;
    session.totalSuccesses++;

    // Update success rate for this level
    updateSuccessRate(session, previousLevel);

    // Update current level
    session.currentLevel = newLevel;

    // Update streaks
    if (session.currentStreak.type === 'success') {
        session.currentStreak.count++;
    } else {
        session.currentStreak = { type: 'success', count: 1 };
    }

    if (session.currentStreak.count > session.longestSuccessStreak) {
        session.longestSuccessStreak = session.currentStreak.count;
    }

    // Check for milestones
    if ([5, 10, 15, 20].includes(newLevel) && !session.milestonesReached.includes(newLevel)) {
        session.milestonesReached.push(newLevel);
    }

    // Update timestamp
    session.lastUpdateTime = Date.now();

    // Check if target reached
    if (newLevel >= session.targetLevel) {
        session.state = SessionState.COMPLETED;
        session.endTime = Date.now();
    }
}

/**
 * Record a failed enhancement attempt
 * @param {Object} session - Session object
 * @param {number} previousLevel - Level that failed (level we tried to enhance from)
 */
export function recordFailure(session, previousLevel) {
    // Initialize tracking if needed for the level that failed
    initializeLevelTracking(session, previousLevel);

    // Record failure at the level we enhanced FROM
    session.attemptsPerLevel[previousLevel].fail++;
    session.totalAttempts++;
    session.totalFailures++;

    // Update success rate for this level
    updateSuccessRate(session, previousLevel);

    // Update streaks
    if (session.currentStreak.type === 'fail') {
        session.currentStreak.count++;
    } else {
        session.currentStreak = { type: 'fail', count: 1 };
    }

    if (session.currentStreak.count > session.longestFailureStreak) {
        session.longestFailureStreak = session.currentStreak.count;
    }

    // Update timestamp
    session.lastUpdateTime = Date.now();
}

/**
 * Add material cost to session
 * @param {Object} session - Session object
 * @param {string} itemHrid - Material item HRID
 * @param {number} count - Quantity used
 * @param {number} unitCost - Cost per item (from market)
 */
export function addMaterialCost(session, itemHrid, count, unitCost) {
    if (!session.materialCosts[itemHrid]) {
        session.materialCosts[itemHrid] = {
            count: 0,
            totalCost: 0
        };
    }

    session.materialCosts[itemHrid].count += count;
    session.materialCosts[itemHrid].totalCost += count * unitCost;

    // Update total cost
    recalculateTotalCost(session);
}

/**
 * Add coin cost to session
 * @param {Object} session - Session object
 * @param {number} amount - Coin amount spent
 */
export function addCoinCost(session, amount) {
    session.coinCost += amount;
    session.coinCount += 1;
    recalculateTotalCost(session);
}

/**
 * Add protection item cost to session
 * @param {Object} session - Session object
 * @param {string} protectionItemHrid - Protection item HRID
 * @param {number} cost - Protection item cost
 */
export function addProtectionCost(session, protectionItemHrid, cost) {
    session.protectionCost += cost;
    session.protectionCount += 1;

    // Store the protection item HRID if not already set
    if (!session.protectionItemHrid) {
        session.protectionItemHrid = protectionItemHrid;
    }

    recalculateTotalCost(session);
}

/**
 * Recalculate total cost from all sources
 * @param {Object} session - Session object
 */
function recalculateTotalCost(session) {
    const materialTotal = Object.values(session.materialCosts)
        .reduce((sum, m) => sum + m.totalCost, 0);

    session.totalCost = materialTotal + session.coinCost + session.protectionCost;
}

/**
 * Get session duration in seconds
 * @param {Object} session - Session object
 * @returns {number} Duration in seconds
 */
export function getSessionDuration(session) {
    const endTime = session.endTime || Date.now();
    return Math.floor((endTime - session.startTime) / 1000);
}

/**
 * Calculate success rate for a specific level
 * @param {Object} session - Session object
 * @param {number} level - Enhancement level
 * @returns {number} Success rate percentage (0-100)
 */
export function getLevelSuccessRate(session, level) {
    const attempts = session.attemptsPerLevel[level];
    if (!attempts) return 0;

    const total = attempts.success + attempts.fail;
    if (total === 0) return 0;

    return (attempts.success / total) * 100;
}

/**
 * Calculate overall success rate
 * @param {Object} session - Session object
 * @returns {number} Success rate percentage (0-100)
 */
export function getOverallSuccessRate(session) {
    if (session.totalAttempts === 0) return 0;
    return (session.totalSuccesses / session.totalAttempts) * 100;
}

/**
 * Get total attempts for a specific level
 * @param {Object} session - Session object
 * @param {number} level - Enhancement level
 * @returns {number} Total attempts
 */
export function getLevelAttempts(session, level) {
    const attempts = session.attemptsPerLevel[level];
    if (!attempts) return 0;
    return attempts.success + attempts.fail;
}

/**
 * Finalize session (mark as completed)
 * @param {Object} session - Session object
 */
export function finalizeSession(session) {
    session.state = SessionState.COMPLETED;
    session.endTime = Date.now();
}

/**
 * Archive session (mark as read-only historical data)
 * @param {Object} session - Session object
 */
export function archiveSession(session) {
    session.state = SessionState.ARCHIVED;
    if (!session.endTime) {
        session.endTime = Date.now();
    }
}

/**
 * Check if session matches given item and level criteria (for resume logic)
 * @param {Object} session - Session object
 * @param {string} itemHrid - Item HRID
 * @param {number} currentLevel - Current enhancement level
 * @param {number} targetLevel - Target level
 * @param {number} protectFrom - Protection level
 * @returns {boolean} True if session matches
 */
export function sessionMatches(session, itemHrid, currentLevel, targetLevel, protectFrom = 0) {
    // Must be same item
    if (session.itemHrid !== itemHrid) return false;

    // Can only resume tracking sessions (not completed/archived)
    if (session.state !== SessionState.TRACKING) return false;

    // Must match protection settings exactly (Ultimate Tracker requirement)
    if (session.protectFrom !== protectFrom) return false;

    // Must match target level exactly (Ultimate Tracker requirement)
    if (session.targetLevel !== targetLevel) return false;

    // Must match current level (with small tolerance for out-of-order events)
    const levelDiff = Math.abs(session.currentLevel - currentLevel);
    if (levelDiff <= 1) {
        return true;
    }

    return false;
}

/**
 * Check if a completed session can be extended
 * @param {Object} session - Session object
 * @param {string} itemHrid - Item HRID
 * @param {number} currentLevel - Current enhancement level
 * @returns {boolean} True if session can be extended
 */
export function canExtendSession(session, itemHrid, currentLevel) {
    // Must be same item
    if (session.itemHrid !== itemHrid) return false;

    // Must be completed
    if (session.state !== SessionState.COMPLETED) return false;

    // Current level should match where session ended (or close)
    const levelDiff = Math.abs(session.currentLevel - currentLevel);
    if (levelDiff <= 1) {
        return true;
    }

    return false;
}

/**
 * Extend a completed session to a new target level
 * @param {Object} session - Session object
 * @param {number} newTargetLevel - New target level
 */
export function extendSession(session, newTargetLevel) {
    session.state = SessionState.TRACKING;
    session.targetLevel = newTargetLevel;
    session.endTime = null;
    session.lastUpdateTime = Date.now();
}

/**
 * Validate session data integrity
 * @param {Object} session - Session object
 * @returns {boolean} True if valid
 */
export function validateSession(session) {
    if (!session || typeof session !== 'object') return false;

    // Required fields
    if (!session.id || !session.itemHrid || !session.itemName) return false;
    if (typeof session.startLevel !== 'number' || typeof session.targetLevel !== 'number') return false;
    if (typeof session.currentLevel !== 'number') return false;

    // Validate level ranges
    if (session.startLevel < 0 || session.startLevel > 20) return false;
    if (session.targetLevel < 1 || session.targetLevel > 20) return false;
    if (session.currentLevel < 0 || session.currentLevel > 20) return false;

    // Validate costs are non-negative
    if (session.totalCost < 0 || session.coinCost < 0 || session.protectionCost < 0) return false;

    return true;
}
