# Priority 3: MutationObserver Consolidation - Implementation Proposal

**Goal:** Reduce DOM observation overhead by migrating individual MutationObservers to the centralized `dom-observer.js` system.

---

## Current State Analysis

### Files with MutationObserver (11 total)

**Already using centralized `domObserver`:**
✅ `house-panel-observer.js` - Already migrated, uses `domObserver.onClass()`
✅ Other features (ability-book-calculator, gathering-stats, etc.) - Already using centralized system

**Need migration (3 files):**

1. ❌ `quick-input-buttons.js` - Own observer watching for action panels
2. ❌ `enhancement-ui.js` - Own observer watching for enhancement UI
3. ❌ `settings-ui.js` - Own observer watching for settings panel

**Keep as-is (specialized observers - 2 files):**
⚠️ `action-time-display.js` - Two specialized observers with disconnect/reconnect logic (lines 82, 151)
⚠️ Other files - Short-lived cleanup observers or special-purpose watchers

**Note:** Files like `combat-score.js`, `dungeon-tracker-chat-annotations.js`, `profile-export-button.js`, `panel-observer.js`, `enhancement-display.js`, `listing-price-display.js` need individual review but are lower priority.

---

## Implementation Strategy

### Phase 1: Migrate `quick-input-buttons.js`

**Current behavior (lines 55-93):**

- Creates own MutationObserver watching document.body
- Looks for `SkillActionDetail_skillActionDetail` class
- Calls `injectButtons()` when found

**Migration approach:**

```javascript
// BEFORE (lines 55-93)
this.observer = new MutationObserver((mutations) => {
    // ... mutation handling logic
    const actionPanel = node.querySelector('[class*="SkillActionDetail_skillActionDetail"]');
    if (actionPanel) {
        this.injectButtons(actionPanel);
    }
});

// AFTER
this.unregister = domObserver.onClass('QuickInputButtons', 'SkillActionDetail_skillActionDetail', (panel) => {
    this.injectButtons(panel);
});
```

**Changes required:**

1. Import `domObserver` from `../../core/dom-observer.js`
2. Replace `startObserving()` method with registration call
3. Store unregister function for cleanup
4. Remove observer disconnect logic
5. Keep existing panel scanning logic intact

**Risk level:** LOW

- Centralized observer already handles the same DOM watching
- No behavior changes, just different triggering mechanism
- Easy to rollback if issues occur

---

### Phase 2: Migrate `enhancement-ui.js`

**Current behavior:**

- Creates own MutationObserver for enhancement UI detection
- Watches for specific enhancement-related class names

**Migration approach:**
Similar to Phase 1, replace with `domObserver.onClass()` registration

**Changes required:**

1. Import `domObserver`
2. Identify target class names for enhancement UI
3. Replace observer creation with `domObserver.onClass()`
4. Store unregister function

**Risk level:** LOW

- Similar pattern to quick-input-buttons
- Well-defined target elements

---

### Phase 3: Migrate `settings-ui.js`

**Current behavior:**

- Creates own MutationObserver for settings panel detection
- Watches for settings tab/panel appearance

**Migration approach:**
Replace with `domObserver.onClass()` for settings-related elements

**Changes required:**

1. Import `domObserver`
2. Identify settings panel class names
3. Replace observer with centralized registration
4. Store unregister function

**Risk level:** LOW

- Settings panel has well-defined structure
- Less frequent DOM changes than action panels

---

## Files to Keep as Specialized Observers

### `action-time-display.js` - TWO observers (Keep)

**Reasons to keep:**

1. **Queue Menu Observer (line 82):** Requires disconnect/reconnect logic when action queue is reordered
2. **Action Name Observer (line 151):** Watches specific element for changes, needs precise control

**Justification:**

- Specialized behavior not suited for centralized system
- Disconnect/reconnect pattern is intentional optimization
- Low frequency operations (only during user actions)

---

## Testing Strategy

### For Each Migration

**1. Functional Testing:**

- [ ] Feature initializes without errors
- [ ] UI elements appear correctly
- [ ] All buttons/inputs work as expected
- [ ] No duplicate injections
- [ ] No missing injections

**2. Performance Verification:**

- [ ] No console errors about observer
- [ ] Check `domObserver.getStats()` shows handler registered
- [ ] Verify no memory leaks (handlers cleaned up properly)

**3. Edge Cases:**

- [ ] Test with rapid panel opening/closing
- [ ] Test with multiple panels open simultaneously
- [ ] Test after page refresh
- [ ] Test with feature disabled/re-enabled

**4. Browser Console Check:**

```javascript
// Should show all registered handlers
domObserver.getStats();
```

---

## Rollback Plan

Each migration is isolated and can be reverted independently:

1. **If issues occur:** Revert specific file to original observer pattern
2. **Git workflow:** Each phase should be a separate commit
3. **Build verification:** Run `npm run build` after each phase
4. **In-game testing:** Test each feature after each phase before moving to next

---

## Expected Benefits

**Performance:**

- Reduce from ~8-11 independent observers to 1 centralized observer + 2 specialized
- ~73-82% reduction in observer count
- Less redundant DOM traversal
- Better browser optimization (single observer)

**Maintainability:**

- Consistent pattern across features
- Centralized debugging (all handlers in one place)
- Easier to add debouncing if needed
- Cleaner code (less boilerplate)

**Developer Experience:**

- `domObserver.getStats()` shows all active handlers
- Centralized error handling
- Easier to track observer-related issues

---

## Implementation Order (Recommended)

1. **Phase 1:** `quick-input-buttons.js` (most commonly used, easiest to test)
2. **Build & Test** → Verify in-game for 1-2 days
3. **Phase 2:** `enhancement-ui.js` (medium usage frequency)
4. **Build & Test** → Verify in-game
5. **Phase 3:** `settings-ui.js` (lowest risk, infrequent usage)
6. **Final Build & Test** → Full regression testing

**Total estimated time:** 1-2 hours implementation + testing per phase

---

## Questions for Approval

1. **Scope:** Proceed with 3-phase migration (quick-input-buttons, enhancement-ui, settings-ui)?
2. **Approach:** Approve the `domObserver.onClass()` migration strategy?
3. **Specialized observers:** Agree to keep action-time-display.js observers as-is?
4. **Testing:** Acceptable to test each phase independently before moving to next?
5. **Timeline:** Proceed with Phase 1 immediately, or prefer to review implementation first?

---

## Success Criteria

✅ All migrated features work identically to before
✅ No console errors related to observers
✅ `domObserver.getStats()` shows 3 new handlers registered
✅ Build size unchanged or slightly reduced
✅ No performance regressions (should be slight improvement)
✅ Code is cleaner and more maintainable
