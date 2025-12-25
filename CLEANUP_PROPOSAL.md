# MWI Tools - Cleanup Proposal

## Summary
After reviewing the 10,663 lines of code across 30 JavaScript files, I've identified several areas for improvement:

## 1. Console Logs to Remove

**Total console statements: 91**
- **console.log (debug): 47** ← Should be removed
- **console.error/warn: 44** ← Keep these (important for debugging)

### Files with console.log (to clean):

#### `src/features/actions/production-profit.js` (10 console.log statements)
**Lines 30, 37, 41, 45, 50, 57, 63, 69, 73, 78**
- All are debug trace logs like "Calculating for action:", "Got profit data:", etc.
- **Action:** Remove all 10 console.log statements
- **Impact:** File is only 111 lines, removing logs will make it 10% smaller

#### `src/utils/debug-enhancement-speed.js` (37 console.log statements)
- This is a **debug utility** meant to be run manually via `MWITools.debugEnhancementSpeed()`
- Console.log statements are intentional (user-facing debug output)
- **Action:** Keep as-is (not part of production code path)

#### `src/utils/game-mechanics-audit.js` (Similar to debug file)
- Audit utility for testing game mechanics
- Console.log statements are intentional
- **Action:** Keep as-is (not part of production code path)

## 2. Code Duplication

### 2.1 `createCollapsibleSection()` Function - DUPLICATED

**Found in:**
1. `src/features/actions/panel-observer.js` (lines 520-610, 91 lines)
2. `src/features/actions/quick-input-buttons.js` (lines 76-158, 83 lines)

**Differences:**
- `panel-observer.js` version has `indent` parameter for nested sections
- `quick-input-buttons.js` version has `id` parameter (unused in practice)
- Logic is 95% identical

**Recommendation:**
- Extract to shared utility: `src/utils/ui-components.js`
- Merge features from both versions (keep indent support)
- Both files import and use the shared version
- **Impact:** Reduces ~90 lines of duplicate code

### 2.2 Display Formatting Patterns

**Pattern:** Similar profit display logic in multiple files

**Files with similar display code:**
1. `src/features/actions/panel-observer.js` - displayGatheringProfit() (lines 612-871)
2. `src/features/actions/panel-observer.js` - displayProductionProfit() (lines 873-1178)

**Observations:**
- Both functions have similar structure:
  - Create collapsible sections (Revenue, Costs, Modifiers)
  - Format numbers with formatWithSeparator()
  - Build nested subsections (Base Output, Bonus Drops, etc.)
- ~300 lines of similar display logic

**Recommendation:**
- These are complex enough that extracting shared logic might make code HARDER to read
- **Keep as-is** for now - duplication is acceptable here for clarity
- Consider refactoring only if we add more action types (combat, alchemy, etc.)

## 3. Potential Over-Engineering

### 3.1 Unused Parameters

#### `createCollapsibleSection()` in quick-input-buttons.js
- Has `id` parameter that is never used
- **Action:** Remove unused `id` parameter

### 3.2 Excessive Precision in Comments

**Example from quick-input-buttons.js:**
```javascript
// Calculate efficiency components
// Action Level bonuses scale with DC but get floored (can't have fractional level requirements)
const effectiveRequirement = baseRequirement + Math.floor(actionLevelBonus);
```

**Status:** Actually good - explains non-obvious floor mechanic
**Action:** Keep as-is

### 3.3 Complex Nested Observers

**File:** `src/features/actions/panel-observer.js`
- 200+ lines of MutationObserver setup (lines 100-196)
- Watches for: attribute changes, node additions, item changes, input changes
- Multiple nested loops and conditionals

**Analysis:**
- This complexity is necessary due to game's dynamic DOM updates
- No obvious way to simplify without breaking functionality
- **Action:** Keep as-is

## 4. File Size Analysis

### Largest Files (potential refactor candidates):
1. **panel-observer.js** - 1,236 lines
   - Contains: gathering profit display (260 lines) + production profit display (306 lines) = 566 lines of display code
   - **Could split:** Move display functions to separate files?

2. **quick-input-buttons.js** - 914 lines
   - Contains: button injection + efficiency calculations + level progress display
   - **Already well-organized** - multiple focused functions

3. **tooltip-prices.js** - 706 lines
   - Handles item tooltip price overlays
   - **Already well-organized** - single focused responsibility

**Recommendation:** panel-observer.js could benefit from splitting display functions

## 5. Proposed Changes Summary

### High Priority (Clear Wins):

1. **Remove console.log from production-profit.js**
   - Lines: 30, 37, 41, 45, 50, 57, 63, 69, 73, 78
   - Impact: Cleaner console output, smaller file size
   - Risk: None
   - Effort: 5 minutes

2. **Extract createCollapsibleSection() to shared utility**
   - Create: `src/utils/ui-components.js`
   - Update imports in panel-observer.js and quick-input-buttons.js
   - Impact: -90 lines of duplication
   - Risk: Low (well-tested functionality)
   - Effort: 15 minutes

3. **Remove unused `id` parameter from createCollapsibleSection**
   - In quick-input-buttons.js
   - Impact: Cleaner API
   - Risk: None
   - Effort: 2 minutes

### Medium Priority (Improvements):

4. **Split panel-observer.js display functions**
   - Create: `src/features/actions/profit-display.js`
   - Move: displayGatheringProfit() and displayProductionProfit()
   - Impact: Better organization, easier to maintain
   - Risk: Low (just moving code)
   - Effort: 20 minutes

### Low Priority (Optional):

5. **Review and document complex observer logic**
   - Add more detailed comments to panel-observer.js MutationObserver setup
   - Impact: Easier for future maintenance
   - Risk: None
   - Effort: 10 minutes

## 6. What NOT to Change

### Keep These Patterns:
1. **Debug utilities** (debug-enhancement-speed.js, game-mechanics-audit.js)
   - Intentional console.log for manual debugging

2. **Error/warning logs** (44 console.error/warn statements)
   - Critical for debugging production issues

3. **Display code duplication** in profit displays
   - Complex enough that extracting shared code would hurt readability

4. **Complex MutationObserver setup**
   - Necessary due to game's dynamic DOM structure

## 7. Estimated Impact

### Before Cleanup:
- Total lines: 10,663
- Console.log statements: 47 (in production code)
- Duplicated code: ~90 lines (createCollapsibleSection)

### After Cleanup:
- Total lines: ~10,550 (-113 lines, 1% reduction)
- Console.log statements: 0 (in production code)
- Duplicated code: 0 (extracted to shared utility)

### Benefits:
- ✅ Cleaner console output (no debug spam)
- ✅ Easier to maintain UI components (single source of truth)
- ✅ Better code organization
- ✅ No functionality changes (zero risk to users)

## 8. Implementation Order

If approved, implement in this order:
1. Remove console.log from production-profit.js (safest change)
2. Extract createCollapsibleSection to shared utility (clear win)
3. Remove unused `id` parameter (cleanup)
4. Split panel-observer.js display functions (if time allows)

Total estimated time: **45-60 minutes**

## Questions?

1. **Should we keep debug utilities?** (Recommend: Yes, they're useful for manual testing)
2. **Should we split panel-observer.js?** (Recommend: Yes, but lower priority)
3. **Any other files you want me to review?** (Happy to deep-dive into specific areas)
