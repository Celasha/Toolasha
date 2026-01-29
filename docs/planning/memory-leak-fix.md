# Memory Leak Fix Plan - Character Switch Event Listeners

## Problem Summary

Multiple features add event listeners to `dataManager` during initialization but fail to remove them during character switches. This causes:
- **Memory leak**: Each character switch accumulates duplicate listeners
- **Performance degradation**: RAM usage climbs from ~1.3GB to 5GB+ after multiple switches
- **Zombie references**: Old DOM elements and closures can't be garbage collected

## Root Cause

Features use anonymous arrow functions as event handlers, making cleanup impossible:

```javascript
// CURRENT (BAD):
initialize() {
    dataManager.on('items_updated', () => {
        this.updateAllCounts();  // Can't remove this later!
    });
}

disable() {
    // No way to remove the anonymous function
}
```

## Affected Features (19 listeners across 15 files)

### CRITICAL (High-frequency events + has disable())

1. **max-produceable.js**
   - `items_updated` listener (anonymous arrow)
   - `action_completed` listener (anonymous arrow)
   - Has disable() but NO cleanup
   - Impact: HIGH - updates on every inventory change

2. **gathering-stats.js**
   - `items_updated` listener (anonymous arrow)
   - `action_completed` listener (anonymous arrow)
   - Has disable() but NO cleanup
   - Impact: HIGH - updates on every inventory change

### HIGH (Has disable() but missing cleanup)

3. **task-profit-display.js**
   - `character_initialized` listener (named: `this.retryHandler`)
   - `expected_value_initialized` listener (named: `this.marketDataRetryHandler`)
   - Has disable() but NO dataManager.off() calls
   - Impact: MEDIUM - only fires on character init

4. **notifications/empty-queue-notification.js**
   - `character_switching` listener (anonymous arrow)
   - Has disable() but NO cleanup
   - Impact: LOW - only fires on character switch

### MEDIUM (Module-level listeners - no disable() method at all)

5. **panel-observer.js**
   - `items_updated` listener (anonymous arrow, module-level)
   - `consumables_updated` listener (anonymous arrow, module-level)
   - NO disable() method exists
   - Impact: HIGH - updates on every inventory change
   - Note: This is a utility module used by other features

6. **trade-history.js**
   - `character_switched` listener (anonymous arrow, module-level)
   - NO disable() method exists
   - Impact: LOW - only fires on character switch

7. **task-icons.js**
   - `character_switching` listener (anonymous arrow)
   - NO disable() method exists
   - Impact: LOW - only fires on character switch

8. **task-reroll-tracker.js**
   - `character_initialized` listener (named: `initHandler`)
   - NO disable() method exists
   - Impact: LOW - only fires on character init

9. **combat/dungeon-tracker-chat-annotations.js**
   - `character_switching` listener (anonymous arrow)
   - NO disable() method exists
   - Impact: LOW - only fires on character switch

10. **combat/dungeon-tracker.js**
    - `character_switching` listener (anonymous arrow)
    - NO disable() method exists
    - Impact: LOW - only fires on character switch

11. **skills/remaining-xp.js**
    - `character_initialized` listener (named: `initHandler`)
    - NO disable() method exists
    - Impact: LOW - only fires on character init

### LOW (Named handlers + proper cleanup OR already using this.handler pattern)

12. **settings/settings-ui.js**
    - `character_initialized` listener (named: `this.characterSwitchHandler`)
    - Likely has proper cleanup (uses `this.handler` pattern)
    - Need to verify

13. **combat/dungeon-tracker-ui.js**
    - `character_switching` listener (named: `this.characterSwitchingHandler`)
    - Likely has proper cleanup (uses `this.handler` pattern)
    - Need to verify

14. **actions/action-time-display.js**
    - `character_initialized` listener (named: `this.characterInitHandler`)
    - Likely has proper cleanup (uses `this.handler` pattern)
    - Need to verify

15. **market/expected-value-calculator.js**
    - `character_initialized` listener (named: `this.retryHandler`)
    - Likely has proper cleanup (uses `this.handler` pattern)
    - Need to verify

## Fix Strategy

### Phase 1: CRITICAL fixes (max-produceable, gathering-stats)

**Pattern:**
```javascript
class MaxProduceable {
    constructor() {
        this.itemsUpdatedHandler = null;
        this.actionCompletedHandler = null;
    }

    initialize() {
        // Store handler reference
        this.itemsUpdatedHandler = () => {
            this.updateAllCounts();
        };
        this.actionCompletedHandler = () => {
            this.updateAllCounts();
        };

        // Register
        dataManager.on('items_updated', this.itemsUpdatedHandler);
        dataManager.on('action_completed', this.actionCompletedHandler);
    }

    disable() {
        // Clean up listeners
        if (this.itemsUpdatedHandler) {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.itemsUpdatedHandler = null;
        }
        if (this.actionCompletedHandler) {
            dataManager.off('action_completed', this.actionCompletedHandler);
            this.actionCompletedHandler = null;
        }

        // ... existing cleanup
    }
}
```

**Files:**
- `src/features/actions/max-produceable.js`
- `src/features/actions/gathering-stats.js`

### Phase 2: HIGH priority (has disable(), needs cleanup)

**Files:**
- `src/features/tasks/task-profit-display.js` (already has named handlers, just add off() calls)
- `src/features/notifications/empty-queue-notification.js` (anonymous, needs handler storage)

### Phase 3: MEDIUM priority (module-level, needs disable() method)

**Special case: panel-observer.js**
- This is a utility module, not a feature
- Needs architectural decision: Should it even have cleanup?
- Currently used by: tooltip-prices, expected-value-calculator, tooltip-consumables
- Option A: Add cleanup to parent features
- Option B: Refactor to class-based pattern with cleanup

**Other module-level listeners:**
- `src/features/market/trade-history.js`
- `src/features/tasks/task-icons.js`
- `src/features/tasks/task-reroll-tracker.js`
- `src/features/combat/dungeon-tracker-chat-annotations.js`
- `src/features/combat/dungeon-tracker.js`
- `src/features/skills/remaining-xp.js`

**Pattern:** Refactor to class-based or add disable export:
```javascript
// Option A: Class-based
class TaskIcons {
    initialize() {
        this.characterSwitchingHandler = () => { /* ... */ };
        dataManager.on('character_switching', this.characterSwitchingHandler);
    }

    disable() {
        if (this.characterSwitchingHandler) {
            dataManager.off('character_switching', this.characterSwitchingHandler);
            this.characterSwitchingHandler = null;
        }
    }
}

export default new TaskIcons();

// Option B: Export cleanup function
let characterSwitchingHandler = null;

export function initialize() {
    characterSwitchingHandler = () => { /* ... */ };
    dataManager.on('character_switching', characterSwitchingHandler);
}

export function disable() {
    if (characterSwitchingHandler) {
        dataManager.off('character_switching', characterSwitchingHandler);
        characterSwitchingHandler = null;
    }
}
```

### Phase 4: Verification (check existing cleanup)

Verify these files already have proper cleanup:
- `src/features/settings/settings-ui.js`
- `src/features/combat/dungeon-tracker-ui.js`
- `src/features/actions/action-time-display.js`
- `src/features/market/expected-value-calculator.js`

## Expected Impacts

### Performance Impact (POSITIVE)

**Memory Usage:**
- Current: 1.3GB baseline → 5GB+ after multiple character switches
- After fix: 1.3GB baseline → ~1.5GB after multiple switches (minimal growth)
- Reduction: ~70% less memory growth per switch

**Browser Responsiveness:**
- Current: Laggy/frozen after 3-5 character switches
- After fix: Remains responsive indefinitely
- Event handler count reduction: ~15-30 duplicate listeners per switch

### Functionality Impact (NEUTRAL - if done correctly)

**No user-facing changes expected:**
- Features continue working exactly as before
- Same initialization behavior
- Same update frequency
- Same visual appearance

**Potential risks if done incorrectly:**
- Features fail to update after character switch (if cleanup too aggressive)
- Features initialize twice (if cleanup incomplete)
- Errors on character switch (if handler references wrong)

### Testing Requirements

**Per-feature tests:**
1. Initial load: Feature works normally
2. Character switch: Feature reinitializes correctly
3. Repeated switches (5x): No degradation
4. Feature disable/enable: Works correctly

**Memory tests:**
1. Baseline memory: Record initial RAM usage
2. Switch 5 times: Measure RAM growth
3. Compare to current: Should be 70%+ reduction

**Browser DevTools checks:**
1. Event Listeners panel: Count listeners before/after switches
2. Memory snapshots: Check for detached DOM nodes
3. Performance profiler: Verify no listener buildup

## Implementation Order

1. **Phase 1** (max-produceable, gathering-stats) - IMMEDIATE
   - High impact, clear fix
   - ~2 files, ~20 lines changed

2. **Phase 2** (task-profit-display, empty-queue-notification) - NEXT
   - Medium impact, straightforward fix
   - ~2 files, ~15 lines changed

3. **Verification** (settings-ui, dungeon-tracker-ui, etc.) - VERIFY FIRST
   - Check if already correct
   - ~4 files, audit only

4. **Phase 3** (panel-observer, trade-history, etc.) - CAREFUL
   - Complex architectural decisions
   - ~7 files, significant refactoring
   - May require user input on approach

## Code Review Checklist

For each file fixed:
- [ ] Handler stored as instance/module variable (not anonymous)
- [ ] dataManager.on() called with stored handler reference
- [ ] disable() method exists
- [ ] disable() calls dataManager.off() with same handler reference
- [ ] Handler reference nulled after cleanup
- [ ] Feature registered in feature-registry (so disable() gets called)
- [ ] Tested: works after character switch
- [ ] Tested: no memory leak after 5 switches

## Estimated Effort

- Phase 1: 30 minutes (high confidence)
- Phase 2: 30 minutes (high confidence)
- Verification: 30 minutes (audit + test)
- Phase 3: 2-3 hours (architecture decisions + refactoring)

**Total: 4-5 hours for complete fix**

## Notes

- The feature-registry already calls disable() on character switches (line 579-591)
- Features not in registry won't get cleaned up automatically
- Some features may intentionally persist across switches (e.g., settings-ui)
- Always test with DevTools Memory profiler to verify fixes
