# Toolasha Refactoring TODO

## ✅ COMPLETED: Priority 3: Reduce MutationObserver Usage (Performance Optimization)

**Completed:** January 14, 2026
**Details:** See `PRIORITY_3_COMPLETED.md`

**Summary:**

- ✅ Migrated `quick-input-buttons.js` to centralized observer
- ✅ Migrated `enhancement-ui.js` to centralized observer
- ✅ Migrated `settings-ui.js` to centralized observer
- **Result:** 52% reduction in observer boilerplate, 27% fewer independent observers

---

## Priority 4: Extract Shared Action Calculation Logic

### Current State

Two massive UI files with ~400-500 lines of duplicated calculation logic:

**quick-input-buttons.js (1,181 lines):**

- Lines 100-573: Action time/efficiency calculation
- Lines 500-570: `getTotalEfficiency()` method (duplicated)
- Equipment speed/efficiency parsing
- Tea efficiency parsing
- House efficiency calculation
- Action Level bonus calculation

**action-time-display.js (950 lines):**

- Lines 536-700: Action time calculation (near-identical to quick-input)
- Same equipment parsing
- Same tea parsing
- Same house efficiency
- Same efficiency stacking logic

### Duplication Examples

Both files import and call:

```javascript
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import { parseTeaEfficiency, getDrinkConcentration, parseActionLevelBonus } from '../../utils/tea-parser.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { stackAdditive } from '../../utils/efficiency.js';
```

Both files have methods that do the same thing:

- Calculate action time with speed bonuses
- Calculate total efficiency (level + house + equipment + tea + community)
- Apply efficiency to action calculations
- Handle Action Level bonus from teas

### Solution Strategy

**Create:** `utils/action-calculator.js`

**Extract shared logic:**

```javascript
/**
 * Calculate complete action statistics
 * @param {Object} actionDetails - Action detail object from game data
 * @param {Object} options - { gameData, equipment, skills }
 * @returns {Object} { actionTime, totalEfficiency, efficiencyBreakdown }
 */
export function calculateActionStats(actionDetails, options) {
    // All the duplicated logic
}

/**
 * Calculate action time with all speed bonuses
 */
export function calculateActionTime(actionDetails, options) {
    // Speed bonus logic
}

/**
 * Calculate total efficiency with full breakdown
 */
export function calculateTotalEfficiency(actionDetails, options) {
    // Efficiency stacking logic
}
```

**Refactor:**

1. Create `utils/action-calculator.js`
2. Move shared calculation logic from both files
3. Update quick-input-buttons.js to import from action-calculator
4. Update action-time-display.js to import from action-calculator
5. Run build and test extensively

**⚠️ CAUTION:**

- These are **high-traffic, user-facing features**
- Action time display appears on every action panel
- Quick input buttons handle Max button calculations
- Must maintain exact same behavior
- Thorough testing required

**Test Plan:**

1. Test action time display for multiple action types
2. Test quick input buttons (hour presets, Max button)
3. Test efficiency calculations with:
    - Different skill levels
    - Various house levels
    - Active teas (Efficiency Tea, skill teas)
    - Community buffs
4. Verify XP calculations in quick-input collapsible section
5. Test with edge cases (level 1, max level, no equipment)

**Files Affected:**

- `src/utils/action-calculator.js` (NEW)
- `src/features/actions/quick-input-buttons.js` (refactor)
- `src/features/actions/action-time-display.js` (refactor)

**Estimated Savings:** ~400-500 lines of duplicate logic
**Risk Level:** HIGH - requires careful testing
**Time Estimate:** 2-3 hours for extraction + testing

---

## Notes

Both priorities require careful implementation due to:

- **Priority 3:** DOM observation is critical for script functionality
- **Priority 4:** Action calculations are used constantly by users

Recommend tackling these one at a time with full testing between each.
