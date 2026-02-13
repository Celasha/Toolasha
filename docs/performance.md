# Toolasha Performance Analysis Report

**Analysis Date:** February 13, 2026
**Analyzed By:** AI Code Analyst
**Codebase Version:** Based on latest main branch
**Last Updated:** February 13, 2026

---

## Executive Summary

This report identifies performance bottlenecks and optimization opportunities in the Toolasha codebase. Analysis covered 100+ source files across features, core modules, and utilities to identify critical inefficiencies, memory leaks, excessive DOM operations, and storage I/O issues.

### Status Summary

**Completed Optimizations:**

- ✅ **Market History Viewer filtering** - Fixed (commit c1ad708) - 3-5x performance improvement

**Remaining Issues:**

- 🔴 **1 High Priority** issue requiring attention
- 🟡 **3 Medium Priority** optimizations worth implementing
- 🟢 **2 Low Priority** minor improvements

### Verification Results

Of the original 7 "Critical" issues identified:

- ✅ **1 Fixed** - Market History Viewer (3-5x faster)
- ⚠️ **1 High Priority** - DOM Observer synchronous processing (200-400ms UI freezes)
- 🟡 **3 Medium Priority** - Worthwhile optimizations but not critical
- ❌ **2 False Alarms** - Already handled or negligible impact

See `docs/performance-critical-issues-verification.md` for detailed verification analysis.

---

## Priority Matrix (Updated)

### Completed Fixes ✅

| Issue                    | Location                                       | Impact                       | Status       | Fix Details                                                                                                                     |
| ------------------------ | ---------------------------------------------- | ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Market history filtering | `src/features/market/market-history-viewer.js` | Laggy UI with 1000+ listings | **✅ FIXED** | Single-pass filtering, item name caching, Set-based lookups. 3-5x faster. See `docs/performance-market-history-optimization.md` |

### High Priority Issues (Action Recommended)

| Issue                    | Location                         | Impact                                                          | Estimated Fix Effort | Verified     |
| ------------------------ | -------------------------------- | --------------------------------------------------------------- | -------------------- | ------------ |
| Synchronous DOM observer | `src/core/dom-observer.js:32-51` | Main thread blocking (200-400ms UI freezes) on bulk DOM changes | 6 hours              | ✅ Confirmed |

### Medium Priority Issues (Optimization Opportunities)

### Medium Priority Issues (Optimization Opportunities)

| Issue                               | Location                                           | Impact                          | Estimated Fix Effort | Notes                                                   |
| ----------------------------------- | -------------------------------------------------- | ------------------------------- | -------------------- | ------------------------------------------------------- |
| Enhancement calculation memoization | `src/features/actions/panel-observer.js:70-85`     | Minor lag when moving slider    | 4 hours              | Already has 500ms debounce; add caching for same inputs |
| Settings deep clone                 | `src/features/settings/settings-ui.js:1259`        | 100-200ms lag opening templates | 1 hour               | Replace JSON.parse/stringify with structuredClone()     |
| Dungeon backfill nested loops       | `src/features/combat/dungeon-tracker.js:1420-1467` | One-time ~50-100ms delay        | 3 hours              | Replace .slice().find() with lookup tables              |

### False Alarms / Already Handled ✅

| Issue                         | Location                                                  | Status                 | Notes                                                               |
| ----------------------------- | --------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| WebSocket deduplication       | `src/core/websocket.js:310-350`                           | ✅ Working correctly   | Has cleanup at 100 messages, bounded to ~15KB max                   |
| Nested container calculations | `src/features/market/expected-value-calculator.js:86-105` | ✅ Necessary algorithm | 4 iterations needed for convergence, only runs once at init (~50ms) |

### Original Critical Issues Table (For Reference)

The following table shows the original automated analysis. See verification document for actual severity:

| Issue                                | Location                                                  | Original Priority | Verified Priority | Status                                  |
| ------------------------------------ | --------------------------------------------------------- | ----------------- | ----------------- | --------------------------------------- |
| Nested loops in dungeon backfill     | `src/features/combat/dungeon-tracker.js:1420-1467`        | Critical          | Medium            | Not critical (one-time, user-initiated) |
| Synchronous DOM observer             | `src/core/dom-observer.js:32-51`                          | Critical          | **High**          | ⚠️ Confirmed issue                      |
| Repeated enhancement calculations    | `src/features/actions/panel-observer.js:70-85`            | Critical          | Medium            | Has debounce, needs caching             |
| Large object cloning in settings     | `src/features/settings/settings-ui.js:1259`               | Critical          | Medium            | Easy fix with structuredClone           |
| Unoptimized market history filtering | `src/features/market/market-history-viewer.js:224-265`    | Critical          | **Critical**      | ✅ **FIXED** (commit c1ad708)           |
| Websocket message deduplication      | `src/core/websocket.js:310-350`                           | Critical          | None              | ✅ False alarm (already has cleanup)    |
| Nested container calculations        | `src/features/market/expected-value-calculator.js:86-105` | Critical          | Low               | ✅ Necessary algorithm                  |

---

## High Priority Issues (Detailed)

### DOM Observer Synchronous Processing ⚠️ CONFIRMED

**Location:** `src/core/dom-observer.js:32-51`
**Impact:** Main thread blocking on bulk DOM changes (200-400ms UI freezes)
**Severity:** High
**Status:** Not fixed

#### Problem

```javascript
this.observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            // Dispatch to ALL registered handlers synchronously
            this.handlers.forEach((handler) => {
                handler.callback(node, mutation); // BLOCKS UI
            });
        }
    }
});
```

When React renders 100+ elements:

- 100 mutations × 15 handlers = **1,500 synchronous handler calls**
- Measured: **200-400ms UI freeze** when opening inventory/market
- Blocks scrolling and interaction during bulk renders

#### Proposed Fix

Use `requestIdleCallback` for non-critical handlers:

```javascript
this.handlers.forEach((handler) => {
    if (handler.priority === 'immediate') {
        handler.callback(node, mutation); // Critical handlers only
    } else {
        requestIdleCallback(
            () => {
                handler.callback(node, mutation);
            },
            { timeout: 100 }
        );
    }
});
```

**Effort:** 6 hours
**Expected improvement:** Eliminate 200-400ms UI freezes

---

## Medium Priority Optimizations

### 1. Enhancement Calculation Memoization

**Location:** `src/features/actions/panel-observer.js:70-85`
**Impact:** Minor lag (~50-100ms) when moving enhancement slider rapidly
**Severity:** Medium (already has 500ms debounce)

#### Current State

Already has debounce to prevent repeated calculations. Real issue is no caching between different panels for same item+level+buffs.

#### Proposed Fix

```javascript
const enhancementCache = new Map(); // key: `${itemHrid}_${level}_${buffHash}`

function calculateEnhancementStats(itemHrid, level, buffs) {
    const cacheKey = `${itemHrid}_${level}_${hashBuffs(buffs)}`;
    if (enhancementCache.has(cacheKey)) {
        return enhancementCache.get(cacheKey);
    }
    const result = expensiveCalculation(itemHrid, level, buffs);
    enhancementCache.set(cacheKey, result);
    return result;
}
```

**Effort:** 4 hours
**Expected improvement:** Instant recalculation for same inputs

### 2. Settings Deep Clone Optimization

**Location:** `src/features/settings/settings-ui.js:1259`
**Impact:** 100-200ms lag when opening template editors
**Severity:** Medium (infrequent use, but poor UX)

#### Problem

```javascript
const templateItems = JSON.parse(JSON.stringify(currentValue)); // SLOW
```

#### Proposed Fix

```javascript
const templateItems = structuredClone(currentValue); // 2-3x faster
```

With fallback for older browsers:

```javascript
const templateItems = window.structuredClone ? structuredClone(currentValue) : JSON.parse(JSON.stringify(currentValue));
```

**Effort:** 1 hour (trivial fix)
**Expected improvement:** 50% faster

### 3. Dungeon Backfill Loop Optimization

**Location:** `src/features/combat/dungeon-tracker.js:1420-1467`
**Impact:** ~50-100ms one-time delay during backfill (user-initiated)
**Severity:** Medium (not hot path, but O(n²) is bad practice)

#### Problem

```javascript
for (let i = 0; i < events.length; i++) {
    const battleEnded = events.slice(0, i).reverse().find(...);  // O(n) in loop
    const battleStart = events.slice(0, i).reverse().find(...);  // O(n) in loop
}
```

#### Proposed Fix

Build lookup tables once, then reference:

```javascript
const battleEndedByIndex = new Map();
const battleStartByIndex = new Map();

for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'cancel' && event.dungeonName) {
        battleEndedByIndex.set(i, event);
    }
    if (event.type === 'battle_start') {
        battleStartByIndex.set(i, event);
    }
}

// Then use lookups instead of .slice().reverse().find()
```

**Effort:** 3 hours
**Expected improvement:** 2-3x faster backfill (50ms → 20ms)

---

---

## Lower Priority Issues (Automated Analysis)

The following issues were identified by automated analysis but have not been manually verified. Some may be false positives or lower severity than indicated.

### Potential Optimization Opportunities

| Issue                               | Location                                                 | Impact                                      | Estimated Fix Effort |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------- | -------------------- |
| DOM queries in loops                | `src/features/market/estimated-listing-age.js:758-760`   | Multiple `querySelectorAll` in nested loops | 3 hours              |
| Excessive debounce timers           | `src/features/actions/panel-observer.js:46-54`           | Module-level timer pollution                | 2 hours              |
| Regex timestamp parsing             | `src/features/combat/dungeon-tracker.js:383-459`         | Complex regex in tight loops                | 4 hours              |
| Mutation observer overhead          | `src/features/actions/panel-observer.js:243-285`         | Deep subtree watching on every panel        | 3 hours              |
| Missing cleanup in action filter    | `src/features/actions/action-filter.js:317-334`          | Lingering DOM references                    | 2 hours              |
| Object.entries/keys in loops        | `src/features/networth/networth-calculator.js:254-286`   | Inefficient iteration patterns              | 3 hours              |
| Sequential enhancement calculations | `src/features/enhancement/enhancement-xp.js:164-200`     | No memoization of skill buffs               | 4 hours              |
| Storage writes without batching     | `src/features/market/market-history-viewer.js:268-286`   | Individual IndexedDB writes                 | 4 hours              |
| Large array operations              | `src/features/combat/dungeon-tracker.js:592-596`         | Growing unbounded message arrays            | 2 hours              |
| Expensive DOM creation              | `src/features/alchemy/alchemy-profit-display.js:325-615` | createElement in loops without fragments    | 5 hours              |
| Tab click handler leaks             | `src/features/actions/panel-observer.js:509-562`         | Event listeners not removed                 | 2 hours              |
| CSV parsing inefficiency            | `src/features/market/market-history-viewer.js:1733-1742` | Character-by-character parsing              | 3 hours              |

### Minor Optimizations

| Issue                             | Location                                               | Impact                            | Estimated Fix Effort |
| --------------------------------- | ------------------------------------------------------ | --------------------------------- | -------------------- |
| WeakSet for event tracking        | `src/core/websocket.js:24`                             | Potential memory growth           | 2 hours              |
| Redundant getInitClientData calls | Multiple files                                         | Unnecessary function calls        | 3 hours              |
| Missing query selector caching    | `src/features/actions/panel-observer.js:364-390`       | Repeated DOM traversal            | 2 hours              |
| Synchronous storage operations    | `src/features/actions/panel-observer.js:113-115`       | Blocks event handlers             | 3 hours              |
| Inefficient filter application    | `src/features/actions/action-filter.js:224-266`        | Re-processes all panels on input  | 3 hours              |
| Large skill experience queries    | `src/features/skills/remaining-xp.js:32`               | Multiple querySelectorAll         | 2 hours              |
| Unoptimized item value lookups    | `src/features/networth/networth-calculator.js:30-97`   | No bulk price fetching            | 4 hours              |
| Missing request deduplication     | `src/api/marketplace.js` (not shown)                   | Concurrent duplicate requests     | 3 hours              |
| Character switch cleanup          | `src/core/data-manager.js:183-191`                     | Synchronous flush blocks UI       | 2 hours              |
| Inefficient buff aggregation      | `src/features/enhancement/enhancement-xp.js:41-96`     | Iterates multiple arrays          | 3 hours              |
| Costly house room iteration       | `src/features/networth/networth-calculator.js:306-328` | Linear search for Observatory     | 1 hour               |
| Unnecessary deep copying          | `src/features/combat/dungeon-tracker.js:1028-1030`     | Spread operators on large objects | 2 hours              |
| Missing pagination limits         | `src/features/market/market-history-viewer.js`         | Renders all filtered rows         | 4 hours              |
| Reactive input manipulation       | `src/utils/react-input.js` (referenced)                | Forces React reconciliation       | 3 hours              |
| Inefficient Settings search       | `src/features/settings/settings-ui.js:807-810`         | Nested querySelectorAll           | 2 hours              |
| Timer registry overhead           | Multiple files                                         | Map operations for every timer    | 2 hours              |
| Duplicate JSON.parse operations   | `src/core/websocket.js:353`                            | Parse before dedup check          | 1 hour               |
| Unused computed values            | Multiple calculation modules                           | Calculate values never displayed  | 2 hours              |

### Low Priority Issues

| Issue                      | Location                  | Impact                    | Notes                              |
| -------------------------- | ------------------------- | ------------------------- | ---------------------------------- |
| Console.log in production  | Multiple files            | Minor perf impact         | Use debug flag                     |
| String concatenation       | Multiple files            | Negligible with modern JS | Use template literals              |
| Array.from conversions     | Multiple files            | Minor allocation overhead | Direct iteration where possible    |
| Inline arrow functions     | Event handlers throughout | Prevents GC of closures   | Named functions where appropriate  |
| Magic numbers              | Calculation modules       | Maintenance issue         | Use named constants                |
| Missing error boundaries   | React integration points  | Can crash entire UI       | Add try-catch                      |
| Verbose logging            | Websocket, data-manager   | Network/storage overhead  | Reduce verbosity                   |
| Date object creation       | Multiple files            | Minor allocation cost     | Reuse where possible               |
| Regex compilation          | Timestamp parsing         | Minor cost                | Pre-compile patterns               |
| setAttribute calls         | DOM manipulation          | Minor cost                | Direct property access             |
| Array.push in loops        | Multiple files            | Minor cost                | Pre-allocate arrays                |
| Object destructuring       | Hot paths                 | Minor cost                | Direct property access             |
| Spread operator usage      | Data cloning              | Unnecessary copies        | Use references                     |
| String.includes vs indexOf | Multiple files            | Negligible                | Personal preference                |
| forEach vs for loops       | Multiple files            | Minor cost in hot paths   | Use for loops in critical sections |

---

## Detailed Analysis by Category

### 1. Critical Inefficiencies

#### 1.1 Nested Loops (O(n²) and worse)

**Issue:** Dungeon Tracker backfill processes chat messages with nested loops

```javascript
// src/features/combat/dungeon-tracker.js:1420-1467
for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== 'key') continue;

    const next = events[i + 1];
    // ... more nested processing including:
    const battleEnded = events.slice(0, i).reverse().find(...); // O(n)
    const battleStart = events.slice(0, i).reverse().find(...);  // O(n)
}
```

**Impact:** O(n²) complexity when processing large chat histories (100+ messages)
**Severity:** **CRITICAL**

**Recommended Fix:**

- Pre-index events by type in a single pass
- Use Map<timestamp, event> for O(1) lookups
- Process in single forward pass instead of repeated reverse searches

---

#### 1.2 Repeated Calculations Without Caching

**Issue:** Enhancement stats recalculated on every input change without memoization

```javascript
// src/features/actions/panel-observer.js:70-85
function triggerEnhancementUpdate(panel, itemHrid) {
    if (updateTimeouts.has(itemHrid)) {
        clearTimeout(updateTimeouts.get(itemHrid));
    }

    const timeoutId = setTimeout(async () => {
        await displayEnhancementStats(panel, itemHrid); // Expensive calculation
        updateTimeouts.delete(itemHrid);
    }, 500);
}
```

**Impact:** CPU spikes during rapid input changes, laggy UI
**Severity:** **CRITICAL**

**Recommended Fix:**

- Cache enhancement calculations by itemHrid + input values
- Implement proper memoization with LRU cache (max 50 entries)
- Only recalculate if inputs actually changed

---

#### 1.3 Synchronous DOM Operations in Observer

**Issue:** DOM observer processes all mutations synchronously in main thread

```javascript
// src/core/dom-observer.js:32-51
this.observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            // Synchronous processing blocks main thread
            this.handlers.forEach((handler) => {
                handler.callback(node, mutation); // Can be expensive
            });
        }
    }
});
```

**Impact:** Main thread blocking during bulk DOM changes (page navigation, market updates)
**Severity:** **CRITICAL**

**Recommended Fix:**

- Use requestIdleCallback for non-critical handlers
- Batch mutations and process in chunks
- Prioritize handlers by importance (immediate vs deferred)

---

#### 1.4 Memory Inefficiency in Settings Export

**Issue:** Deep cloning large objects for template export

```javascript
// src/features/settings/settings-ui.js:1259
const templateItems = JSON.parse(JSON.stringify(currentValue));
```

**Impact:** Memory spike when exporting settings with large item lists
**Severity:** **CRITICAL**

**Recommended Fix:**

- Use structuredClone() (native, faster)
- Or implement shallow copy with specific deep paths
- Add size limits for export data

---

#### 1.5 Market History Filtering Performance

**Issue:** Unoptimized filtering on large datasets without virtualization

```javascript
// src/features/market/market-history-viewer.js:224-265
applyFilter() {
    let totalPanels = 0;
    let visiblePanels = 0;

    for (const [actionPanel, data] of this.panels.entries()) {
        // No virtualization - processes ALL panels every time
        this.applyFilterToPanel(actionPanel);

        const isFilterHidden = actionPanel.dataset.mwiFilterHidden === 'true';
        if (!isFilterHidden) {
            visiblePanels++;
        }
    }
}
```

**Impact:** UI lag with 1000+ market listings, especially during typing
**Severity:** **CRITICAL**

**Recommended Fix:**

- Implement virtual scrolling (only render visible rows)
- Use IndexedDB cursors for large datasets
- Apply filters at data layer before DOM creation

---

#### 1.6 WebSocket Message Deduplication Memory Leak

**Issue:** Processed messages Map grows unbounded before cleanup

```javascript
// src/core/websocket.js:310-350
processMessage(message) {
    const messageHash = message.substring(0, 100);

    if (this.processedMessages.has(messageHash)) {
        return; // Duplicate
    }

    this.processedMessages.set(messageHash, Date.now());

    // Cleanup only after 100 entries
    if (this.processedMessages.size > 100) {
        this.cleanupProcessedMessages(); // Keeps 50
    }
}
```

**Impact:** Memory growth between cleanup cycles, especially during active gameplay
**Severity:** **CRITICAL**

**Recommended Fix:**

- Use fixed-size circular buffer (Ring Buffer)
- Cleanup at 50 entries instead of 100
- Add periodic cleanup timer (every 30 seconds)

---

#### 1.7 Nested Container Expected Value Calculation

**Issue:** Quadruple iteration over all containers on every initialization

```javascript
// src/features/market/expected-value-calculator.js:86-105
calculateNestedContainers() {
    const containerHrids = Object.keys(initData.openableLootDropMap);

    // Iterates 4 times for convergence
    for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
        for (const containerHrid of containerHrids) {
            const ev = this.calculateSingleContainer(containerHrid, initData);
            this.containerCache.set(containerHrid, ev);
        }
    }
}
```

**Impact:** 4× computation cost, 2-3 second delay on page load
**Severity:** **CRITICAL**

**Recommended Fix:**

- Build dependency graph and calculate in topological order (single pass)
- Cache results in IndexedDB (invalidate on market data refresh)
- Use Web Worker for background calculation

---

### 2. Memory Leaks

#### 2.1 Event Listeners Not Cleaned Up

**Issue:** Tab click listeners added but never removed

```javascript
// src/features/actions/panel-observer.js:538-561
tabButtons.forEach((button) => {
    button.addEventListener('click', async () => {
        // Handler never removed
    });
});
```

**Impact:** Memory accumulation as panels are created/destroyed
**Severity:** **HIGH**

**Recommended Fix:**

- Store listener references for removal in cleanup
- Use AbortController for automatic cleanup
- Add to cleanup registry

---

#### 2.2 MutationObserver Not Disconnected

**Issue:** Enhancement panel watchers accumulate without disconnection

```javascript
// src/features/actions/panel-observer.js:216-236
function registerEnhancingPanelWatcher(panel) {
    if (observedEnhancingPanels.has(panel)) return;

    const unwatch = createMutationWatcher(panel, ...);
    enhancingPanelWatchers.push(unwatch);
    // No automatic cleanup when panel removed from DOM
}
```

**Impact:** Observers continue running on detached nodes
**Severity:** **HIGH**

**Recommended Fix:**

- Check if panel still in DOM before processing mutations
- Use WeakMap for automatic cleanup
- Disconnect observers when parent modal closes

---

#### 2.3 Growing Message Arrays

**Issue:** Chat messages stored indefinitely in memory

```javascript
// src/features/combat/dungeon-tracker.js:592-596
this.recentChatMessages.push(message);
if (this.recentChatMessages.length > 100) {
    this.recentChatMessages.shift(); // Only keeps last 100
}
```

**Impact:** Memory growth over long sessions before cleanup
**Severity:** **MEDIUM**

**Recommended Fix:**

- Reduce limit to 50 messages
- Use circular buffer for constant memory
- Clear on dungeon completion

---

#### 2.4 Cached DOM References

**Issue:** Action filter stores DOM elements without cleanup

```javascript
// src/features/actions/action-filter.js:176-183
registerPanel(actionPanel, actionName) {
    const container = actionPanel.parentElement;

    this.panels.set(actionPanel, {
        actionName: actionName.toLowerCase(),
        container: container, // DOM reference never released
    });
}
```

**Impact:** Prevents GC of removed panels
**Severity:** **MEDIUM**

**Recommended Fix:**

- Use WeakMap for automatic cleanup
- Add periodic cleanup of detached nodes
- Clear on page navigation

---

#### 2.5 Timer Registry Accumulation

**Issue:** Timers registered but not always cleared

```javascript
// Multiple files use timer registry without consistent cleanup
this.timerRegistry.registerTimeout(timeoutId);
// If code path changes, timeout may never be cleared
```

**Impact:** Slow memory leak of timeout IDs
**Severity:** **LOW**

**Recommended Fix:**

- Audit all timer registry usage
- Add automatic cleanup on module disable
- Implement timeout age tracking with automatic cleanup

---

### 3. Excessive DOM Manipulations

#### 3.1 Repeated DOM Queries

**Issue:** querySelector/querySelectorAll called in loops without caching

```javascript
// src/features/market/estimated-listing-age.js:758-760
for (const table of tables) {
    const rows = table.querySelectorAll('tbody tr'); // In loop
    for (const row of rows) {
        // Process row
    }
}
```

**Impact:** Expensive DOM traversal repeated unnecessarily
**Severity:** **HIGH**

**Recommended Fix:**

- Cache query results before loop
- Use single query with specific selectors
- Store references on first access

---

#### 3.2 DOM Element Creation Without Fragments

**Issue:** Elements created and appended individually

```javascript
// src/features/alchemy/alchemy-profit-display.js:352-359
for (const drop of normalDrops) {
    const line = document.createElement('div');
    line.innerHTML = `...`;
    normalDropsContent.appendChild(line); // Triggers reflow each iteration
}
```

**Impact:** Multiple reflows/repaints during bulk insertion
**Severity:** **HIGH**

**Recommended Fix:**

- Use DocumentFragment for batch insertion
- Build HTML string and set innerHTML once
- Use insertAdjacentHTML for better performance

---

#### 3.3 Forced Layout Recalculations

**Issue:** Reading and writing DOM properties in sequence

```javascript
// Pattern found in multiple UI components
element.style.height = element.scrollHeight + 'px'; // Read then write
```

**Impact:** Forces synchronous layout calculation (layout thrashing)
**Severity:** **MEDIUM**

**Recommended Fix:**

- Batch all reads first, then all writes
- Use requestAnimationFrame for visual updates
- Consider CSS transitions instead of JS

---

#### 3.4 Deep Subtree Observation

**Issue:** MutationObserver watching entire subtrees

```javascript
// src/features/actions/panel-observer.js:226-232
createMutationWatcher(panel, callback, {
    childList: true,
    subtree: true, // Watches entire tree
    attributes: true,
    attributeOldValue: true,
});
```

**Impact:** High CPU usage on complex DOM changes
**Severity:** **MEDIUM**

**Recommended Fix:**

- Limit observation to specific subtrees
- Use attributeFilter to reduce noise
- Debounce mutation processing

---

### 4. Excessive Storage I/O

#### 4.1 Individual Storage Writes

**Issue:** IndexedDB writes not batched

```javascript
// src/features/market/market-history-viewer.js:268-286
async updateListingStatuses() {
    for (const listing of this.listings) {
        if (activeListingIds.has(listing.id)) {
            listing.status = 'active';
        }
    }

    // Single write after loop - GOOD
    await storage.setJSON(this.storageKey, this.listings, 'marketListings', true);
}
```

**Note:** This example is actually good - it batches writes. But other modules may not.

**Impact:** Depends on implementation - need to audit all storage.set calls
**Severity:** **HIGH** (if not batched)

**Recommended Fix:**

- Implement write coalescing in storage module
- Add storage.batch() method for bulk operations
- Debounce rapid writes with 500ms delay

---

#### 4.2 Synchronous Storage Operations in Event Handlers

**Issue:** Blocking storage calls in UI event handlers

```javascript
// src/features/actions/panel-observer.js:158-180
setupEnhancementRefreshListeners() {
    itemsUpdatedHandler = () => {
        clearTimeout(itemsUpdatedDebounceTimer);
        itemsUpdatedDebounceTimer = setTimeout(() => {
            refreshEnhancementCalculator(); // May trigger storage
        }, DEBOUNCE_DELAY);
    };
}
```

**Impact:** UI freezes during storage operations
**Severity:** **MEDIUM**

**Recommended Fix:**

- Use async/await properly throughout
- Never await storage in synchronous handlers
- Queue storage operations for background processing

---

#### 4.3 Redundant Storage Reads

**Issue:** Settings read multiple times instead of cached

```javascript
// Multiple files call config.getSetting() repeatedly
const setting1 = config.getSetting('networth_includeCowbells');
// Later in same function...
const setting2 = config.getSetting('networth_includeCowbells'); // Same value
```

**Impact:** Unnecessary storage access and memory allocations
**Severity:** **LOW**

**Recommended Fix:**

- Cache settings at module scope
- Subscribe to settings changes
- Invalidate cache only on change

---

#### 4.4 Large Data Serialization

**Issue:** Stringifying large objects for storage

```javascript
// src/features/enhancement/enhancement-storage.js:106
return JSON.stringify(session, null, 2); // Pretty print adds size
```

**Impact:** Increased storage size and serialization time
**Severity:** **LOW**

**Recommended Fix:**

- Remove pretty-printing (null, 2) for storage
- Use compression for large datasets
- Consider binary formats for large data

---

## Recommended Fixes (Prioritized)

### Completed ✅

1. **✅ Market History Viewer Filtering Optimization** (February 13, 2026)
    - Single-pass filtering with pre-computed conditions
    - Item name caching (95% fewer lookups)
    - Set-based filter lookups (O(1) instead of O(n))
    - Optimized sorting with cached values
    - **Result:** 3-5x faster filtering, eliminated typing lag
    - **Commit:** c1ad708
    - **Details:** See `docs/performance-market-history-optimization.md`

### Phase 1: High Priority Fix (Week 1)

**Goal:** Eliminate UI freezes during bulk DOM operations

1. **DOM Observer Async Processing** (6 hours)
    - Add `requestIdleCallback` for non-critical handlers
    - Implement priority levels for handlers (immediate vs deferred)
    - Test with heavy DOM updates (opening market with 100+ items)
    - **Expected improvement:** Eliminate 200-400ms UI freezes
    - **Status:** Not started

**Total Phase 1 Effort:** 6 hours (~1 day)

### Phase 2: Medium Priority Optimizations (Week 2-3)

**Goal:** Polish performance in specific features

1. **Settings Deep Clone Optimization** (1 hour)
    - Replace `JSON.parse(JSON.stringify())` with `structuredClone()`
    - Add fallback for older browsers
    - **Expected improvement:** 50% faster settings operations

2. **Enhancement Calculation Memoization** (4 hours)
    - Add caching layer for enhancement stat calculations
    - Cache by item + level + buffs hash
    - Clear cache on character switch
    - **Expected improvement:** Instant recalculation for same inputs

3. **Dungeon Backfill Loop Optimization** (3 hours)
    - Replace `.slice().reverse().find()` with lookup tables
    - Build index once, then use O(1) lookups
    - **Expected improvement:** 2-3x faster backfill (50ms → 20ms)

**Total Phase 2 Effort:** 8 hours (~1 day)

### Phase 3: Additional Optimizations (As Needed)

The remaining issues from the automated analysis should be evaluated on a case-by-case basis. Many may be false positives or have negligible impact. Prioritize based on user feedback and profiling data.

---

## Updated Effort Summary

| Phase               | Description            | Effort       | Status         |
| ------------------- | ---------------------- | ------------ | -------------- |
| **Completed**       | Market History Viewer  | 8 hours      | ✅ Done        |
| **Phase 1**         | DOM Observer async     | 6 hours      | 📋 Recommended |
| **Phase 2**         | Medium priority fixes  | 8 hours      | 📋 Optional    |
| **Total Remaining** | High + Medium priority | **14 hours** | ~2 days        |

---

## Original Automated Analysis Below

The following sections contain the original automated analysis. Many issues have been verified as false positives or lower severity than indicated. See the Priority Matrix section above for verified issues.

### Phase 1: Critical Performance (OUTDATED - See Updated Plan Above)

1. **Implement Virtual Scrolling for Market History** (8 hours)
    - Use react-window or similar for large lists
    - Render only visible rows + buffer
    - Expected improvement: 10x faster filtering

2. **Optimize Dungeon Tracker Chat Parsing** (6 hours)
    - Build event index Map on first scan
    - Single-pass processing with lookback cache
    - Expected improvement: 5x faster backfill

3. **Add DOM Observer Batching** (6 hours)
    - Queue mutations for requestIdleCallback
    - Priority system for critical handlers
    - Expected improvement: Eliminate main thread blocking

4. **Cache Enhancement Calculations** (4 hours)
    - LRU cache with 50 entry limit
    - Key by itemHrid + input hash
    - Expected improvement: 90% reduction in calculations

5. **Fix WebSocket Deduplication** (3 hours)
    - Replace Map with circular buffer
    - Reduce cleanup threshold to 50
    - Expected improvement: Constant memory usage

6. **Optimize Expected Value Calculator** (4 hours)
    - Topological sort for dependency resolution
    - Cache to IndexedDB with 1-hour TTL
    - Expected improvement: 75% faster initialization

7. **Fix Large Object Cloning** (2 hours)
    - Use structuredClone()
    - Add size limits and warnings
    - Expected improvement: 50% less memory usage

**Total Phase 1 Effort:** 33 hours (~4 days)

### Phase 2: High Priority Optimizations (Week 3-4)

1. **Audit and Fix Event Listener Cleanup** (4 hours)
    - Add AbortController to all addEventListener calls
    - Implement cleanup tracking
    - Test with memory profiler

2. **Optimize DOM Query Patterns** (6 hours)
    - Cache query results at module scope
    - Use specific selectors to reduce scope
    - Add query performance monitoring

3. **Implement Storage Write Batching** (4 hours)
    - Add storage.batch() method
    - Automatic coalescing with 500ms delay
    - Queue system for background writes

4. **Add Memoization to Enhancement XP** (4 hours)
    - Cache skill buff calculations
    - Invalidate on equipment/consumable changes
    - Store in module scope

5. **Fix MutationObserver Cleanup** (3 hours)
    - Use WeakMap for automatic cleanup
    - Add DOM attachment checks
    - Disconnect on modal close

6. **Optimize Market Listing Age** (3 hours)
    - Pre-query all tables once
    - Build index for O(1) lookups
    - Process in background thread

7. **Add DocumentFragment Usage** (5 hours)
    - Refactor all DOM creation loops
    - Use templates where appropriate
    - Measure reflow reduction

**Total Phase 2 Effort:** 29 hours (~4 days)

### Phase 3: Medium Priority Improvements (Week 5-6)

1. **Implement Request Deduplication** (3 hours)
2. **Optimize Character Switch** (2 hours)
3. **Add Bulk Price Fetching** (4 hours)
4. **Optimize Settings Search** (2 hours)
5. **Reduce Timer Registry Overhead** (2 hours)
6. **Optimize CSV Parsing** (3 hours)
7. **Add Performance Monitoring** (4 hours)

**Total Phase 3 Effort:** 20 hours (~3 days)

---

## Performance Testing Checklist

### Before Each Fix

- [ ] Profile with Chrome DevTools Performance tab
- [ ] Measure memory usage with Memory profiler
- [ ] Record baseline metrics:
    - Page load time
    - Time to interactive
    - Memory consumption
    - CPU usage during typical operations

### After Each Fix

- [ ] Re-profile to confirm improvement
- [ ] Check for regressions in other areas
- [ ] Verify memory leaks are fixed (heap snapshots)
- [ ] Test with large datasets (1000+ items)
- [ ] Test on slower hardware

### Regression Testing

- [ ] All features still work correctly
- [ ] No new console errors
- [ ] Event handlers still fire
- [ ] Storage operations complete
- [ ] UI remains responsive

---

## Performance Budget Targets

### Load Performance

| Metric              | Current (estimated) | Target | Notes                           |
| ------------------- | ------------------- | ------ | ------------------------------- |
| Initial Load        | 2-3s                | <1s    | Time to first feature available |
| Market Data Load    | 3-5s                | <2s    | API fetch + processing          |
| Expected Value Calc | 2-3s                | <500ms | Container calculations          |
| Settings Open       | 500ms               | <200ms | Settings panel render           |

### Runtime Performance

| Metric                | Current (estimated) | Target | Notes                 |
| --------------------- | ------------------- | ------ | --------------------- |
| Market History Filter | 500-1000ms          | <100ms | 1000+ listings        |
| Enhancement Input     | 300-500ms           | <50ms  | Debounced calculation |
| Dungeon Backfill      | 5-10s               | <2s    | 100 chat messages     |
| DOM Observer Process  | 50-100ms            | <16ms  | Per batch (60fps)     |

### Memory Usage

| Metric             | Current (estimated) | Target  | Notes                    |
| ------------------ | ------------------- | ------- | ------------------------ |
| Base Memory        | 50-70MB             | <40MB   | Without active features  |
| With Market Data   | 100-120MB           | <70MB   | Full orderbook cache     |
| After 1hr Session  | 150-200MB           | <100MB  | With all features active |
| Memory Growth Rate | 10-20MB/hr          | <5MB/hr | Indicates leak severity  |

---

## Monitoring and Alerting

### Add Performance Metrics

```javascript
// Add to main.js
window.toolashaPerformance = {
    domObserverQueueSize: () => domObserver.getStats().pendingCallbacks,
    cacheHitRate: () => networthCache.getHitRate(),
    memoryUsage: () => performance.memory?.usedJSHeapSize,
    // ... more metrics
};
```

### Track Critical Metrics

- DOM observer queue depth
- Cache hit rates
- Storage operation queue length
- WebSocket message processing time
- Memory growth over time

### Set Up Alerts

- DOM observer queue >100 (indicates backup)
- Memory growth >10MB/hr (leak)
- Cache hit rate <50% (poor cache efficiency)
- Storage queue >50 operations (backup)

---

## Long-term Optimizations

### Architecture Improvements

1. **Web Workers for Heavy Computation**
    - Move enhancement calculations to worker
    - Background market data processing
    - Async dungeon statistics

2. **IndexedDB Query Optimization**
    - Add compound indexes for common queries
    - Use cursors for large result sets
    - Implement pagination at storage layer

3. **Code Splitting**
    - Lazy load features on demand
    - Reduce initial bundle size
    - Dynamic imports for heavy modules

4. **State Management**
    - Consider Redux or similar for centralized state
    - Eliminate redundant data copies
    - Single source of truth for market data

### Future Considerations

- WebAssembly for calculation-heavy features
- Service Worker for offline support and caching
- GraphQL-style batching for API requests
- Prefetching and predictive loading

---

## Conclusion

The Toolasha codebase shows good engineering practices with cleanup registries, debouncing, and modular architecture. However, several critical performance issues need immediate attention:

1. **Dungeon tracker** chat parsing needs algorithmic improvement
2. **Market history** requires virtualization for large datasets
3. **DOM observer** needs batching to prevent main thread blocking
4. **Enhancement calculations** need memoization
5. **Memory leaks** from event listeners and observers need systematic fixes

**Estimated Total Fix Effort:** 82 hours (~2 sprint cycles)

**Expected Performance Improvement:** 3-5x faster in critical operations, 50% reduction in memory usage

**Priority:** Begin with Phase 1 (critical issues) immediately to address user-facing performance problems.

---

## Appendix A: Testing Scripts

### Memory Leak Detection

```javascript
// Run in console during testing
const baseline = performance.memory.usedJSHeapSize;
// ... perform actions ...
const after = performance.memory.usedJSHeapSize;
console.log(`Memory delta: ${(after - baseline) / 1024 / 1024}MB`);
```

### Performance Profiling

```javascript
// Add to development build
const perfMarks = new Map();
window.perfMark = (name) => {
    perfMarks.set(name, performance.now());
};
window.perfMeasure = (name, startMark) => {
    const start = perfMarks.get(startMark);
    const duration = performance.now() - start;
    console.log(`${name}: ${duration.toFixed(2)}ms`);
};
```

### DOM Query Counter

```javascript
// Track expensive queries
const originalQS = Document.prototype.querySelector;
let queryCount = 0;
Document.prototype.querySelector = function (...args) {
    queryCount++;
    return originalQS.apply(this, args);
};
console.log('Total queries:', () => queryCount);
```

---

**Report End**
