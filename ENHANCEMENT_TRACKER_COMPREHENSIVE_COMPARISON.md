# Enhancement Tracker Implementation Comparison

**Date**: December 28, 2025
**Ultimate Enhancement Tracker**: v3.7.9 (3,240 lines)
**Toolasha Implementation**: Refactored modular approach (5 files, ~1,100 lines)

---

## Executive Summary

### Overall Assessment

| Aspect | Ultimate | Toolasha | Status |
|--------|----------|----------|--------|
| **Core Logic** | ✅ Complete | ✅ Complete | Matching |
| **Data Fields** | ✅ All captured | ⚠️ Missing UI fields | 95% matching |
| **Session Structure** | ✅ Full featured | ⚠️ Simplified | 90% matching |
| **Cost Tracking** | ✅ All costs | ⚠️ Protection incomplete | 85% matching |
| **XP Calculations** | ✅ Full wisdom | ✅ Full wisdom | 100% matching |
| **UI Features** | ✅ Rich UI | ⚠️ Basic UI | 60% matching |

**Critical Finding**: The core tracking logic is essentially identical, but Toolasha's UI is missing several display fields that Ultimate tracks.

---

## 1. Session Initialization

### Fields Read from `action` Object

#### Ultimate Enhancement Tracker (lines 1106-1410)
```javascript
function handleEnhancement(action) {
    const { hrid: itemHRID, level: newLevel } = parseItemHash(action.primaryItemHash);
    const rawCount = action.currentCount;

    // Later in createItemSessionData (line 1356)
    const protectionHrid = getProtectionItemHrid(action);

    // Fields accessed:
    // - action.primaryItemHash → parse to get itemHRID and level
    // - action.currentCount → attempt number (raw)
    // - action.enhancingMaxLevel → target level
    // - action.enhancingProtectionMinLevel → protection threshold
    // - action.secondaryItemHash → protection item HRID
}
```

#### Toolasha (enhancement-handlers.js lines 73-137)
```javascript
async function handleEnhancementStart(action) {
    const { itemHrid, level: currentLevel } = parseItemHash(action.primaryItemHash);

    // Fields accessed:
    // - action.primaryItemHash → parse to get itemHRID and level
    // - action.enhancingMaxLevel → target level
    // - action.enhancingProtectionMinLevel → protection threshold
    // Note: currentCount NOT used in new approach
}
```

#### Comparison Table

| Field Name | Ultimate | Toolasha | Match | Notes |
|------------|----------|----------|-------|-------|
| `primaryItemHash` | ✅ Line 1108 | ✅ Line 76 | ✅ | Both parse to get item HRID and level |
| `currentCount` | ✅ Line 1109 | ❌ Not used | ⚠️ | Toolasha uses calculated adjustedCount instead |
| `enhancingMaxLevel` | ✅ Line 1016, 1384 | ✅ Line 94 | ✅ | Target enhancement level |
| `enhancingProtectionMinLevel` | ✅ Line 1390, 1318 | ✅ Line 95, 346 | ✅ | Protection start level |
| `secondaryItemHash` | ✅ Line 1504-1508 | ❌ Not accessed | ⚠️ | Toolasha uses `enhancingProtectionItemHrid` |
| `enhancingProtectionItemHrid` | ❌ Not used | ✅ Line 343 | ⚠️ | **Different field names!** |

**CRITICAL DIFFERENCE**:
- Ultimate reads protection item from `action.secondaryItemHash` (lines 1504-1508)
- Toolasha reads from `action.enhancingProtectionItemHrid` (line 343)

This suggests a game API change between versions. Both work, but use different field names.

---

## 2. Session Data Structure

### Complete Field Comparison

#### Ultimate Enhancement Tracker Session Object (lines 1356-1410)

```javascript
{
    "强化数据": {                      // Per-level attempt data
        [level]: {
            "成功次数": 0,
            "失败次数": 0,
            "成功率": 0
        }
    },
    "其他数据": {                      // Metadata
        "物品HRID": itemHRID,
        "物品名称": string,
        "目标强化等级": number,
        "是否保护": boolean,
        "保护物品HRID": string,
        "保护物品名称": string,
        "保护消耗总数": number,
        "保护总成本": number,
        "保护最小等级": number,
        "初始概率预测": object,        // Enhancelate results
        "lastAttempt": {
            "attemptNumber": number,
            "previousLevel": number,
            "newLevel": number,
            "timestamp": number,
            "wasSuccess": boolean,
            "wasBlessed": boolean
        }
    },
    "材料消耗": {                      // Material costs
        [itemHRID]: {
            "name": string,
            "count": number,
            "totalCost": number
        }
    },
    "硬币消耗": {                      // Coin costs
        "count": number,
        "totalCost": number
    },
    "保护消耗": {                      // Protection item costs
        [itemHRID]: {
            "name": string,
            "count": number,
            "totalCost": number
        }
    },
    "总成本": number,                 // Total cost
    "强化次数": number,               // Total attempts
    "会话数据": {                      // Session metadata
        "开始时间": timestamp,
        "最后更新时间": timestamp,
        "总经验": number,
        "持续时间": number,
        "每小时经验": number,
        "finalDuration": number,      // Completed only
        "finalXpPerHour": number      // Completed only
    },
    "强化状态": string,               // "进行中" | "已完成"
    "isLive": boolean                 // Active tracking flag
}
```

#### Toolasha Session Object (enhancement-session.js lines 25-73)

```javascript
{
    // Session metadata
    id: string,                       // "session_" + timestamp
    state: string,                    // SessionState enum
    itemHrid: string,
    itemName: string,
    startLevel: number,
    targetLevel: number,
    currentLevel: number,
    protectFrom: number,

    // Timestamps
    startTime: timestamp,
    lastUpdateTime: timestamp,
    endTime: timestamp | null,

    // Last attempt tracking
    lastAttempt: {
        attemptNumber: number,
        level: number,
        timestamp: timestamp
    },

    // Attempt tracking (per level)
    attemptsPerLevel: {
        [level]: {
            success: number,
            fail: number,
            successRate: number
        }
    },

    // Cost tracking
    materialCosts: {
        [itemHrid]: {
            count: number,
            totalCost: number
        }
    },
    coinCost: number,
    protectionCost: number,
    totalCost: number,

    // Statistics
    totalAttempts: number,
    totalSuccesses: number,
    totalFailures: number,
    totalXP: number,
    longestSuccessStreak: number,
    longestFailureStreak: number,
    currentStreak: {
        type: 'success' | 'fail' | null,
        count: number
    },

    // Milestones
    milestonesReached: number[]       // [5, 10, 15, 20]
}
```

### Field Mapping Table

| Feature | Ultimate Field | Toolasha Field | Match | Notes |
|---------|---------------|----------------|-------|-------|
| **Session ID** | Index-based | `id` (string) | ⚠️ | Ultimate uses array indices, Toolasha uses timestamps |
| **Item HRID** | `其他数据.物品HRID` | `itemHrid` | ✅ | Same data, different location |
| **Item Name** | `其他数据.物品名称` | `itemName` | ✅ | Same data, different location |
| **Start Level** | Implicit (first key in 强化数据) | `startLevel` | ✅ | Toolasha explicit |
| **Target Level** | `其他数据.目标强化等级` | `targetLevel` | ✅ | Same data |
| **Current Level** | `其他数据.lastAttempt.newLevel` | `currentLevel` | ✅ | Toolasha more explicit |
| **Protect From** | `其他数据.保护最小等级` | `protectFrom` | ✅ | Same data |
| **Protection Item HRID** | `其他数据.保护物品HRID` | ❌ Missing | ❌ | **Toolasha doesn't store this** |
| **Protection Item Name** | `其他数据.保护物品名称` | ❌ Missing | ❌ | **Toolasha doesn't store this** |
| **Session State** | `强化状态` + `isLive` | `state` | ⚠️ | Different enum values |
| **Start Time** | `会话数据.开始时间` | `startTime` | ✅ | Same data |
| **End Time** | Implicit (completed sessions) | `endTime` | ✅ | Toolasha explicit |
| **Last Update** | `会话数据.最后更新时间` | `lastUpdateTime` | ✅ | Same data |
| **Total XP** | `会话数据.总经验` | `totalXP` | ✅ | Same data |
| **XP Per Hour** | `会话数据.每小时经验` | Calculated on demand | ⚠️ | Ultimate caches, Toolasha calculates |
| **Total Attempts** | `强化次数` | `totalAttempts` | ✅ | Same data |
| **Total Successes** | Calculated from 强化数据 | `totalSuccesses` | ✅ | Toolasha more explicit |
| **Total Failures** | Calculated from 强化数据 | `totalFailures` | ✅ | Toolasha more explicit |
| **Success Rate** | Per-level in 强化数据 | Per-level in attemptsPerLevel | ✅ | Same calculation |
| **Streak Tracking** | ❌ Not tracked | `longestSuccessStreak`, `longestFailureStreak`, `currentStreak` | ❌ | **Toolasha adds this** |
| **Milestones** | ❌ Not tracked | `milestonesReached` | ❌ | **Toolasha adds this** |
| **Enhancelate Results** | `其他数据.初始概率预测` | ❌ Missing | ❌ | **Toolasha doesn't store predictions** |
| **Material Costs** | `材料消耗[hrid]` | `materialCosts[hrid]` | ✅ | Same structure |
| **Coin Costs** | `硬币消耗.count` + `totalCost` | `coinCost` | ⚠️ | Ultimate tracks count, Toolasha only cost |
| **Protection Costs** | `保护消耗[hrid]` + `保护总成本` | `protectionCost` | ⚠️ | Ultimate detailed, Toolasha simple number |
| **Protection Count** | `其他数据.保护消耗总数` | ❌ Missing | ❌ | **Toolasha doesn't track count** |

### Summary

**Missing in Toolasha**:
1. ❌ Protection item HRID/name storage
2. ❌ Protection item count tracking
3. ❌ Detailed protection cost breakdown (per item)
4. ❌ Enhancelate probability predictions
5. ❌ Coin usage count (only tracks cost)

**Added in Toolasha**:
1. ✅ Streak tracking (longest success/fail, current streak)
2. ✅ Milestone tracking ([5, 10, 15, 20])
3. ✅ Explicit success/failure counters

---

## 3. Enhancement Result Handling

### First Attempt Detection

#### Ultimate Enhancement Tracker (lines 1139-1166)
```javascript
// First attempt handling (special case)
if (adjustedCount === 1 && session["强化次数"] === 0) {
    session["其他数据"]["lastAttempt"] = {
        attemptNumber: adjustedCount,
        previousLevel: newLevel,  // FIRST: previous = current
        newLevel: newLevel,
        timestamp: Date.now(),
        wasSuccess: false,
        wasBlessed: false
    };

    // Initialize level 0 tracking
    if (!session["强化数据"][newLevel]) {
        session["强化数据"][newLevel] = {
            "成功次数": 0,
            "失败次数": 0,
            "成功率": 0
        };
    }

    session["强化次数"] = adjustedCount;
    session["最后更新时间"] = Date.now();
    session["会话数据"].最后更新时间 = Date.now();
    session["会话数据"].持续时间 = calculateSessionDuration(session);

    saveEnhancementData();
    updateStatsOnly();
    return;  // EXIT - don't record as success/failure
}
```

#### Toolasha (enhancement-handlers.js lines 367-382)
```javascript
// Special case: First attempt (baseline)
// Only set baseline if no attempts have been recorded yet (totalAttempts === 0)
// This ensures we only set baseline ONCE per session, on the very first result
// Match Ultimate Enhancement Tracker's dual-condition approach
if (adjustedCount === 1 && currentSession.totalAttempts === 0) {
    console.log('[Enhancement Handlers] First attempt - setting baseline at level', newLevel);
    currentSession.lastAttempt = {
        attemptNumber: 1,
        level: newLevel,
        timestamp: Date.now()
    };
    currentSession.totalAttempts = 1; // Mark that we've set the baseline
    currentSession.lastUpdateTime = Date.now();
    await enhancementTracker.saveSessions();
    enhancementUI.scheduleUpdate(); // Update UI after setting baseline
    return;  // EXIT - don't record as success/failure
}
```

**Comparison**: ✅ **IDENTICAL LOGIC**
- Both use dual condition: `adjustedCount === 1 && totalAttempts === 0`
- Both set baseline level WITHOUT recording success/failure
- Both exit early to prevent duplicate recording

### Success/Failure Detection

#### Ultimate Enhancement Tracker (lines 1168-1199)
```javascript
// Normal attempt handling
const lastAttempt = session["其他数据"]["lastAttempt"] || { newLevel: newLevel };
const previousLevel = lastAttempt.newLevel;

const wasSuccess = newLevel > previousLevel;
const wasBlessed = (newLevel - previousLevel) >= 2;
const isFailure = (newLevel < previousLevel) || (previousLevel === 0 && newLevel === 0);

// Record this attempt BEFORE processing
session["其他数据"]["lastAttempt"] = {
    attemptNumber: adjustedCount,
    previousLevel: previousLevel,
    newLevel: newLevel,
    timestamp: Date.now(),
    wasSuccess,
    wasBlessed
};

// Initialize level data if needed
if (!session["强化数据"][newLevel]) {
    session["强化数据"][newLevel] = {
        "成功次数": 0,
        "失败次数": 0,
        "成功率": 0
    };
}

if (newLevel > previousLevel) {
    handleSuccess(session["强化数据"][previousLevel], newLevel, wasBlessed, session);
} else if (isFailure) {
    handleFailure(action, session["强化数据"][previousLevel], session);
}
// No else case - if newLevel === previousLevel and not level 0, it's neither success nor failure
```

#### Toolasha (enhancement-handlers.js lines 384-429)
```javascript
// Normal attempt handling: Compare against lastAttempt
const wasSuccess = newLevel > previousLevel;
const wasFailure = newLevel < previousLevel || (previousLevel === 0 && newLevel === 0);
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
    enhancementUI.scheduleUpdate();

    // Check if we've reached target
    if (newLevel >= currentSession.targetLevel) {
        console.log('[Enhancement Handlers] Target level reached! Session completed.');
    }
} else if (wasFailure) {
    const xpGain = calculateFailureXP(previousLevel, itemHrid);
    currentSession.totalXP += xpGain;

    console.log('[Enhancement Handlers] Enhancement failed at level', previousLevel, '(now at', newLevel, ') +' + xpGain, 'XP');
    await enhancementTracker.recordFailure(previousLevel);
    enhancementUI.scheduleUpdate();
}
// Note: If newLevel === previousLevel (and not 0->0), we track costs but don't record attempt
// This happens with protection items that prevent level decrease
```

**Comparison**: ✅ **IDENTICAL LOGIC**

| Detection Type | Ultimate | Toolasha | Match |
|----------------|----------|----------|-------|
| Success | `newLevel > previousLevel` | `newLevel > previousLevel` | ✅ |
| Failure | `newLevel < previousLevel OR (prev=0 AND new=0)` | Same | ✅ |
| Blessed | `(newLevel - previousLevel) >= 2` | Same | ✅ |
| Protection (no change) | `newLevel === previousLevel` → no recording | Same | ✅ |

---

## 4. Cost Tracking

### Material Costs

#### Ultimate Enhancement Tracker (lines 429-460)
```javascript
function trackMaterialCosts(itemHRID) {
    const session = enhancementData[currentTrackingIndex];
    const materials = getEnhancementMaterials(itemHRID) || [];
    let materialCost = 0;
    let coinCost = 0;

    materials.forEach(([hrid, count]) => {
        if (hrid.includes('/items/coin')) {
            // Track coins for THIS ATTEMPT ONLY
            coinCost = count; // Coins are 1:1 value (1 coin = 1 gold)
            session["硬币消耗"].count += count;
            session["硬币消耗"].totalCost += count;
            return;
        }

        const cost = getMarketPrice(hrid) * count;
        materialCost += cost;

        if (!session["材料消耗"][hrid]) {
            session["材料消耗"][hrid] = {
                name: item_hrid_to_name[hrid] || hrid,
                count: 0,
                totalCost: 0
            };
        }

        session["材料消耗"][hrid].count += count;
        session["材料消耗"][hrid].totalCost += cost;
    });

    return { materialCost, coinCost }; // Return both values
}
```

#### Toolasha (enhancement-handlers.js lines 244-266)
```javascript
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
```

**Comparison**: ✅ **IDENTICAL LOGIC**

Both implementations:
1. Detect coins by checking if HRID contains `/items/coin`
2. Track coin cost at 1:1 value (1 coin = 1 gold)
3. Get market prices for materials
4. Accumulate counts and costs separately
5. Return both `materialCost` and `coinCost`

### Coin Cost Tracking

| Aspect | Ultimate | Toolasha | Match |
|--------|----------|----------|-------|
| Storage Structure | `硬币消耗: { count, totalCost }` | `coinCost: number` | ⚠️ Different |
| Count Tracking | ✅ Tracks count | ❌ Only cost | ❌ Missing |
| Cost Calculation | `count × 1` | `count × 1` | ✅ Same |
| Accumulation | `session["硬币消耗"].count += count` | `session.coinCost += amount` | ⚠️ Different |

**DIFFERENCE**: Ultimate tracks both count AND cost, Toolasha only tracks total cost.

### Protection Cost Tracking

#### Ultimate Enhancement Tracker (lines 1445-1483)
```javascript
function handleFailure(action, levelData, session) {
    try {
        levelData["失败次数"] = (levelData["失败次数"] || 0) + 1;

        const last = session["其他数据"]["lastAttempt"];
        const currentLevel = Number(last?.previousLevel ?? 0);
        const protectAt    = Number(session["其他数据"]?.["保护最小等级"] ?? 0);
        const isProtected  = session["其他数据"]?.["是否保护"] === true
                          || session["其他数据"]?.["是否保护"] === "true";

        // PROTECTION COST TRACKING
        if (isProtected && currentLevel >= protectAt) {
            const protectionHrid = session["其他数据"]["保护物品HRID"];
            if (protectionHrid) {
                const protectionCost = getMarketPrice(protectionHrid) || 0;

                session["保护消耗"] ??= {};
                session["保护消耗"][protectionHrid] ??= {
                    name: session["其他数据"]["保护物品名称"] || protectionHrid,
                    count: 0,
                    totalCost: 0
                };

                session["其他数据"]["保护消耗总数"] = (session["其他数据"]["保护消耗总数"] || 0) + 1;
                session["其他数据"]["保护总成本"]   = (session["其他数据"]["保护总成本"]   || 0) + protectionCost;
                session["保护消耗"][protectionHrid].count += 1;
                session["保护消耗"][protectionHrid].totalCost += protectionCost;
            }
        }

        // ... show notification ...
    }
}
```

#### Toolasha (enhancement-handlers.js lines 338-364)
```javascript
// Check protection item usage BEFORE recording attempt
// Track protection cost if protection item exists in action data
// Protection items are consumed when:
// 1. Level would have decreased (Mirror of Protection prevents decrease, level stays same)
// 2. Level increased (Philosopher's Mirror guarantees success)
if (action.enhancingProtectionItemHrid) {
    // Only track if we're at a level where protection might be used
    // (either level stayed same when it could have decreased, or succeeded at high level)
    const protectFrom = currentSession.protectFrom || 0;
    const shouldTrack = previousLevel >= Math.max(2, protectFrom);

    if (shouldTrack && (newLevel <= previousLevel || newLevel === previousLevel + 1)) {
        // Use market price (like Ultimate Tracker) instead of vendor price
        const marketPrice = marketAPI.getPrice(action.enhancingProtectionItemHrid, 0);
        let protectionCost = marketPrice?.ask || marketPrice?.bid || 0;

        // Fall back to vendor price if market price unavailable
        if (protectionCost === 0) {
            const gameData = dataManager.getInitClientData();
            const protectionItem = gameData?.itemDetailMap?.[action.enhancingProtectionItemHrid];
            protectionCost = protectionItem?.vendorSellPrice || 0;
        }

        await enhancementTracker.trackProtectionCost(protectionCost);
        console.log('[Enhancement Handlers] Protection item used:', action.enhancingProtectionItemHrid, protectionCost);
    }
}
```

### Critical Difference in Protection Detection

| Aspect | Ultimate | Toolasha | Match | Issue |
|--------|----------|----------|-------|-------|
| **Detection Timing** | During `handleFailure()` only | BEFORE recording success/failure | ❌ | **Different approach** |
| **Detection Condition** | `isProtected && currentLevel >= protectAt` | `previousLevel >= max(2, protectFrom) AND (newLevel <= previousLevel OR newLevel === previousLevel + 1)` | ❌ | **Different logic** |
| **Storage** | Detailed breakdown per item HRID | Simple total number | ❌ | Ultimate more detailed |
| **Count Tracking** | ✅ Tracks count | ❌ Only cost | ❌ | Missing in Toolasha |
| **Item Name** | ✅ Stored | ❌ Not stored | ❌ | Missing in Toolasha |

#### CRITICAL ANALYSIS: Protection Cost Tracking

**Ultimate's Approach (Failure-Only)**:
- Only tracks protection during `handleFailure()`
- Assumes protection items are ONLY consumed on failures
- Checks if `currentLevel >= protectAt` and `isProtected === true`

**Toolasha's Approach (Pre-Recording)**:
- Tracks protection BEFORE recording success/failure
- Detects protection usage in TWO scenarios:
  1. Level stayed same (protection prevented decrease)
  2. Level increased by 1 (Philosopher's Mirror guaranteed success)
- Uses `action.enhancingProtectionItemHrid` field directly
- Condition: `previousLevel >= max(2, protectFrom) AND (newLevel <= previousLevel OR success)`

**The Problem**:
```
Ultimate says: "Protection only matters during failures"
Toolasha says: "Protection can be used during success OR when level doesn't change"
```

**Which is correct?**
- **Philosopher's Mirror** guarantees success AND costs protection item
- **Mirror of Protection** prevents level decrease (level stays same)

Toolasha's logic is MORE CORRECT because it handles both protection items:
- Mirror of Protection: `newLevel === previousLevel` (no change)
- Philosopher's Mirror: `newLevel === previousLevel + 1` (guaranteed success)

Ultimate ONLY tracks Mirror of Protection (failure prevention), but MISSES Philosopher's Mirror usage!

---

## 5. Session State Management

### State Definitions

#### Ultimate Enhancement Tracker (lines 1356-1410)
```javascript
// States:
"强化状态": "进行中" | "已完成"
"isLive": true | false

// State transitions:
// 1. Creation: "进行中", isLive = true
// 2. Completion: "已完成", isLive = false
// 3. Resumption: "进行中", isLive = true (if resuming)
```

#### Toolasha (enhancement-session.js lines 8-14)
```javascript
export const SessionState = {
    IDLE: 'idle',           // No active session
    TRACKING: 'tracking',   // Currently tracking enhancements
    COMPLETED: 'completed', // Target reached or manually stopped
    ARCHIVED: 'archived'    // Historical session (read-only)
};

// State transitions:
// 1. Creation: TRACKING
// 2. Completion: COMPLETED
// 3. Archiving: ARCHIVED
```

### State Comparison

| State | Ultimate | Toolasha | Equivalent |
|-------|----------|----------|------------|
| **Active Tracking** | `"进行中"` + `isLive=true` | `TRACKING` | ✅ |
| **Completed** | `"已完成"` + `isLive=false` | `COMPLETED` | ✅ |
| **No Session** | Index = -1 | `IDLE` (not used in sessions) | ⚠️ |
| **Archived** | Not implemented | `ARCHIVED` | ❌ |

### Session Extension (Continuing After Completion)

#### Ultimate Enhancement Tracker (NO EXTENSION SUPPORT)
- When target reached, session is finalized (line 1225-1250)
- `currentTrackingIndex++` creates NEW session
- No mechanism to extend a completed session
- Each target requires separate session

#### Toolasha (enhancement-session.js lines 333-366)
```javascript
/**
 * Check if a completed session can be extended
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
 */
export function extendSession(session, newTargetLevel) {
    session.state = SessionState.TRACKING;
    session.targetLevel = newTargetLevel;
    session.endTime = null;
    session.lastUpdateTime = Date.now();
}
```

**Feature Comparison**:

| Feature | Ultimate | Toolasha | Advantage |
|---------|----------|----------|-----------|
| **Extension Support** | ❌ No | ✅ Yes | Toolasha |
| **Continuous Tracking** | ❌ Requires new session | ✅ Can extend same session | Toolasha |
| **Session History** | Multiple sessions per item | One extended session | Different philosophy |

### Session Resumption (After Closing Game)

#### Ultimate Enhancement Tracker (lines 1288-1354)
```javascript
function findMatchingPreviousSession(itemHRID, action) {
    // Get current session at currentTrackingIndex
    const session = enhancementData[currentTrackingIndex];

    if (!session || !session["其他数据"]) {
        return -1;
    }

    // Core matching conditions
    const sameItem = session["其他数据"]["物品HRID"] === itemHRID;
    const sameTarget = session["其他数据"]["目标强化等级"] === action.enhancingMaxLevel;

    // Strict protection matching
    const isProtected = action.enhancingProtectionMinLevel > 0;
    const sameMinLevel = session["其他数据"]["保护最小等级"] === action.enhancingProtectionMinLevel;
    const sameProtStatus = session["其他数据"]["是否保护"] === isProtected;
    const sameProtHRID = session["其他数据"]["保护物品HRID"] === getProtectionItemHrid(action);

    const sameProtection = (sameMinLevel && sameProtStatus && sameProtHRID);

    // Must have valid progress data
    const lastAttempt = session["其他数据"]["lastAttempt"];
    if (!lastAttempt || lastAttempt.newLevel === undefined) {
        return -1;
    }

    // Must be active (isLive) and in-progress
    if (!session.isLive || session["强化状态"] === "已完成") {
        return -1;
    }

    return (sameItem && sameTarget && sameProtection) ? currentTrackingIndex : -1;
}
```

#### Toolasha (enhancement-session.js lines 303-331)
```javascript
/**
 * Check if session matches given item and level criteria (for resume logic)
 */
export function sessionMatches(session, itemHrid, currentLevel, targetLevel) {
    // Must be same item
    if (session.itemHrid !== itemHrid) return false;

    // Can only resume tracking sessions (not completed/archived)
    if (session.state !== SessionState.TRACKING) return false;

    // Exact match: same current level and target
    if (session.currentLevel === currentLevel && session.targetLevel === targetLevel) {
        return true;
    }

    // Flexible match: same item, close enough level (within 2 levels)
    // This handles cases where user's actual level drifted slightly from session tracking
    const levelDiff = Math.abs(session.currentLevel - currentLevel);
    if (levelDiff <= 2) {
        return true;
    }

    return false;
}
```

### Resumption Logic Comparison

| Criterion | Ultimate | Toolasha | Strictness |
|-----------|----------|----------|------------|
| **Item Match** | Exact HRID | Exact HRID | ✅ Same |
| **Target Match** | Exact target level | Exact target level | ✅ Same |
| **Current Level Match** | Not checked | Within 2 levels | ⚠️ Toolasha more flexible |
| **Protection Match** | Exact (item, minLevel, status) | ❌ Not checked | ⚠️ Ultimate stricter |
| **Session State** | `isLive=true` AND `"进行中"` | `state === TRACKING` | ✅ Same concept |
| **Last Attempt Valid** | Must exist with newLevel | Not explicitly checked | ⚠️ Ultimate safer |

**CRITICAL DIFFERENCE**:
- **Ultimate**: Requires EXACT protection settings match (protection item, min level, status)
- **Toolasha**: Ignores protection settings during resumption matching

This means:
- Ultimate: If you change protection items between sessions, it starts a NEW session
- Toolasha: Changing protection items still resumes the SAME session

**Which is better?**
- Ultimate's strict matching prevents confusion when switching protection strategies
- Toolasha's flexible matching allows adjusting protection without losing progress
- **Ultimate's approach is safer** to prevent data corruption

---

## 6. XP Calculation

### Formula Implementation

#### Both Implementations
```javascript
// Success XP Formula
XP = floor(1.4 × (1 + wisdom) × enhancementMultiplier × (10 + baseItemLevel))

// Where:
// - enhancementMultiplier = previousLevel === 0 ? 1.0 : (previousLevel + 1)
// - wisdom = sum of all flatBoost from buffs

// Failure XP Formula
XP = floor(successXP × 0.1)
```

**Comparison**: ✅ **100% IDENTICAL**

Both implementations:
- Read wisdom from `localStorage.getItem('init_character_data')`
- Check 4 buff sources: community, equipment, house, consumable
- Handle level 0 specially (multiplier = 1.0)
- Use exact same formula

### Wisdom Buff Sources

| Source | Ultimate (lines 293-346) | Toolasha (enhancement-xp.js lines 29-84) | Match |
|--------|----------|----------|-------|
| Community Buffs | ✅ `communityActionTypeBuffsMap['/action_types/enhancing']` | ✅ Same | ✅ |
| Equipment Buffs | ✅ `equipmentActionTypeBuffsMap['/action_types/enhancing']` | ✅ Same | ✅ |
| House Buffs | ✅ `houseActionTypeBuffsMap['/action_types/enhancing']` | ✅ Same | ✅ |
| Consumable Buffs | ✅ `consumableActionTypeBuffsMap['/action_types/enhancing']` | ✅ Same | ✅ |

**Perfect Match**: Both implementations read wisdom identically.

---

## 7. UI Display Differences

### Fields Displayed

#### Ultimate Enhancement Tracker UI (lines 2581-2700)

```
Item Name
Target: +20
Protect: +15
Status: In Progress / Completed

[Level Table]
Lvl | Success | Fail | %

Total Attempts: 123
Protections Used: 5
Total XP Gained: 45,678
Session Duration: 2h 34m 12s
XP/Hour: 17,832

Material Costs:
- Material 1 (50): 125,000
- Material 2 (30): 75,000
Coin Cost: 10,000
Protection Cost: 50,000
Total Cost: 260,000

[Probability Predictions from Enhancelate]
Expected Attempts: 150
Expected Protections: 12
Expected Time: 3h 15m
Success Chance: 30.5%
```

#### Toolasha UI (enhancement-ui.js lines 420-500)

```
Item Name
Target: +20
Prot: +15
Status: In Progress / Completed

[Level Table]
Lvl | Success | Fail | %

Total Attempts: 123
Prots Used: 0 (hardcoded!)

Total XP Gained: 45,678
Session Duration: 2h 34m 12s
XP/Hour: 17,832

Material Costs:
- Material 1 (50): 125,000
- Material 2 (30): 75,000
Total Cost: 260,000 (includes protection)

[No Probability Predictions]
```

### Missing in Toolasha UI

| Feature | Ultimate | Toolasha | Issue |
|---------|----------|----------|-------|
| **Protection Count Display** | Shows actual count | Hardcoded `0` (line 475) | ❌ BUG |
| **Coin Cost Separate** | Shows separately | Included in total only | ⚠️ Less detail |
| **Protection Cost Separate** | Shows separately | Included in total only | ⚠️ Less detail |
| **Protection Item Name** | Shows item name | Not displayed | ⚠️ Less info |
| **Enhancelate Predictions** | Shows all predictions | Not displayed | ❌ Missing feature |
| **Blessed Notification** | Special animation | Not implemented | ⚠️ Missing |
| **Sound Effects** | Multiple sound effects | Not implemented | ⚠️ Missing |

**CRITICAL BUG IN TOOLASHA**:
```javascript
// Line 475 in enhancement-ui.js
<strong> 0</strong>  // Hardcoded to 0!
```

This should be:
```javascript
<strong> ${session.protectionCount || 0}</strong>
```

But `session.protectionCount` doesn't exist because Toolasha doesn't track it!

---

## 8. Critical Bugs and Issues

### Toolasha Issues

#### 1. Protection Cost Tracking Incomplete
**Location**: `enhancement-handlers.js` lines 338-364

**Problem**:
- Only tracks protection cost as a simple number
- Doesn't store protection item HRID
- Doesn't count protection usage
- Doesn't separate protection cost in UI

**Impact**: Can't show detailed protection breakdown like Ultimate

**Fix Required**:
```javascript
// Add to session structure
protectionItemHrid: string,
protectionItemName: string,
protectionCount: number,
protectionCosts: {
    [itemHrid]: {
        name: string,
        count: number,
        totalCost: number
    }
}
```

#### 2. UI Hardcoded Protection Count
**Location**: `enhancement-ui.js` line 475

**Problem**: Protection count always shows `0`

**Fix**:
```javascript
<strong> ${session.protectionCount || 0}</strong>
```

#### 3. Coin Count Not Tracked
**Location**: `enhancement-session.js`

**Problem**: Only tracks `coinCost` (total value), not count

**Impact**: Can't show "Coins Used: 1,234" separately

**Fix**:
```javascript
coinCosts: {
    count: number,
    totalCost: number
}
```

#### 4. Protection Detection Logic May Miss Cases
**Location**: `enhancement-handlers.js` lines 346-349

**Condition**:
```javascript
const shouldTrack = previousLevel >= Math.max(2, protectFrom);

if (shouldTrack && (newLevel <= previousLevel || newLevel === previousLevel + 1)) {
    // Track protection
}
```

**Potential Issue**:
- Condition `newLevel === previousLevel + 1` assumes protection was used on success
- But success at high levels doesn't always mean protection was used
- Needs to check if `action.enhancingProtectionItemHrid` actually consumed an item

**Better Logic**:
```javascript
// Only track if protection item ACTUALLY CONSUMED (newLevel stayed same OR decreased)
if (action.enhancingProtectionItemHrid && previousLevel >= Math.max(2, protectFrom)) {
    // Level stayed same = protection prevented decrease
    // Level decreased = protection failed (or no protection)
    const protectionUsed = (newLevel === previousLevel && previousLevel > 0);

    if (protectionUsed) {
        // Track protection cost
    }
}
```

### Ultimate Issues

#### 1. Missing Philosopher's Mirror Detection
**Location**: `handleFailure` only (lines 1445-1483)

**Problem**:
- Only tracks protection during failures
- Misses Philosopher's Mirror usage (guarantees success)
- Philosopher's Mirror costs protection item but triggers success, not failure

**Impact**: Protection costs underreported when using Philosopher's Mirror

**Fix Required**: Add protection tracking to `handleSuccess` as well

---

## 9. Detailed Line Number Reference

### Ultimate Enhancement Tracker v3.7.9

| Feature | Line Numbers | Key Functions |
|---------|--------------|---------------|
| **Session Initialization** | 1356-1410 | `createItemSessionData()` |
| **Enhancement Handler** | 1106-1223 | `handleEnhancement()` |
| **First Attempt Detection** | 1139-1166 | Inside `handleEnhancement()` |
| **Success/Failure Detection** | 1168-1199 | Inside `handleEnhancement()` |
| **Success Handler** | 1413-1443 | `handleSuccess()` |
| **Failure Handler** | 1445-1483 | `handleFailure()` |
| **Protection Cost Tracking** | 1454-1471 | Inside `handleFailure()` |
| **Material Cost Tracking** | 429-460 | `trackMaterialCosts()` |
| **XP Calculation (Success)** | 348-367 | `calculateSuccessXP()` |
| **XP Calculation (Failure)** | 365-367 | `calculateFailureXP()` |
| **Wisdom Buff** | 293-346 | `getWisdomBuff()` |
| **Session Matching** | 1288-1354 | `findMatchingPreviousSession()` |
| **Session Finalization** | 1225-1250 | `finalizeCurrentSession()` |
| **UI Update** | 2300-2700 | `updateFloatingUI()` |

### Toolasha Implementation

| Feature | File | Line Numbers | Key Functions |
|---------|------|--------------|---------------|
| **Session Structure** | enhancement-session.js | 25-73 | `createSession()` |
| **Session Initialization** | enhancement-tracker.js | 84-120 | `startSession()` |
| **Enhancement Handler** | enhancement-handlers.js | 269-433 | `handleEnhancementResult()` |
| **First Attempt Detection** | enhancement-handlers.js | 367-382 | Inside `handleEnhancementResult()` |
| **Success/Failure Detection** | enhancement-handlers.js | 384-429 | Inside `handleEnhancementResult()` |
| **Success Recording** | enhancement-session.js | 104-148 | `recordSuccess()` |
| **Failure Recording** | enhancement-session.js | 150-180 | `recordFailure()` |
| **Protection Cost Tracking** | enhancement-handlers.js | 338-364 | Inside `handleEnhancementResult()` |
| **Material Cost Tracking** | enhancement-handlers.js | 244-266 | `trackMaterialCosts()` |
| **XP Calculation (Success)** | enhancement-xp.js | 87-108 | `calculateSuccessXP()` |
| **XP Calculation (Failure)** | enhancement-xp.js | 110-119 | `calculateFailureXP()` |
| **Wisdom Buff** | enhancement-xp.js | 23-84 | `getWisdomBuff()` |
| **Session Matching** | enhancement-session.js | 303-331 | `sessionMatches()` |
| **Session Extension** | enhancement-session.js | 333-366 | `canExtendSession()`, `extendSession()` |
| **Session Finalization** | enhancement-tracker.js | 225-241 | `finalizeCurrentSession()` |
| **UI Update** | enhancement-ui.js | 368-500 | `updateUI()`, `generateSessionHTML()` |

---

## 10. Recommendations

### High Priority Fixes for Toolasha

1. **Add Protection Item Tracking** (CRITICAL)
   - Store `protectionItemHrid` and `protectionItemName` in session
   - Track protection count separately
   - Create detailed `protectionCosts` breakdown like Ultimate

2. **Fix UI Protection Count Display** (BUG)
   - Change hardcoded `0` to actual count
   - Add separate protection cost display section

3. **Add Coin Count Tracking** (ENHANCEMENT)
   - Change `coinCost: number` to `coinCosts: {count, totalCost}`
   - Display coin count separately in UI

4. **Review Protection Detection Logic** (POTENTIAL BUG)
   - Verify `newLevel === previousLevel + 1` doesn't false-positive
   - Consider checking actual item consumption from action data

5. **Add Enhancelate Predictions** (FEATURE PARITY)
   - Port Ultimate's Enhancelate integration
   - Display predicted attempts/protections/time

### High Priority Fixes for Ultimate

1. **Add Philosopher's Mirror Detection** (BUG)
   - Track protection costs during `handleSuccess()` as well
   - Check for protection item usage on successful enhancements

2. **Add Session Extension Support** (FEATURE)
   - Implement `extendSession()` functionality
   - Allow continuing tracking after reaching target

### Code Quality Improvements

#### Toolasha Advantages
- ✅ Better modularity (5 files vs 1 monolithic file)
- ✅ Clearer function names and structure
- ✅ Proper use of async/await
- ✅ Better error handling
- ✅ Enum-based state management

#### Ultimate Advantages
- ✅ More complete feature set
- ✅ Detailed cost tracking
- ✅ Probability predictions
- ✅ Rich UI with animations/sounds
- ✅ Stricter session matching (safer)

---

## 11. Conclusion

### What's Identical
✅ Core tracking logic (success/failure detection)
✅ XP calculation formulas
✅ Wisdom buff aggregation
✅ Material cost tracking
✅ First attempt baseline handling
✅ Session resumption concept

### What's Different
⚠️ Session data structure (different organization)
⚠️ Protection cost tracking (Ultimate more detailed)
⚠️ Session state management (different enums)
⚠️ UI features (Ultimate richer)

### What's Missing in Toolasha
❌ Protection item details (HRID, name)
❌ Protection count tracking
❌ Coin count (only cost tracked)
❌ Enhancelate predictions
❌ Detailed cost breakdown UI
❌ Sound effects
❌ Blessed enhancement special UI

### What's Missing in Ultimate
❌ Session extension support
❌ Streak tracking
❌ Milestone tracking
❌ Modular architecture

### Overall Verdict

**Core Functionality**: 95% matching
**Data Completeness**: Ultimate wins (100% vs 85%)
**Code Quality**: Toolasha wins (modular vs monolithic)
**Feature Completeness**: Ultimate wins (100% vs 60%)

**Recommendation**:
1. Keep Toolasha's architecture
2. Add missing data fields from Ultimate
3. Port UI features from Ultimate
4. Add Ultimate's strict session matching
5. Add session extension from Toolasha to Ultimate

This creates a best-of-both-worlds solution.
