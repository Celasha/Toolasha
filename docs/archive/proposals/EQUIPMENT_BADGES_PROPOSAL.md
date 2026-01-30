# Enable Badges and Sorting for All Equipment

## Current Behavior

**Equipment category has special restrictions:**

- Only charms get price badges
- All other equipment (weapons, armor, etc.) excluded
- Equipment category cannot be sorted by price (always "None" order)

**Code location:** `src/features/inventory/inventory-sort.js`

- Lines 324-340: Charm-only filter
- Line 266: Sorting disabled for Equipment category

## Proposed Change

**Enable badges and sorting for ALL equipment items**

## Implementation

**Option 2 (Recommended): Full Feature Enablement**

1. **Remove charm filter** (lines 324-340):

```javascript
// DELETE THIS BLOCK:
if (isEquipmentCategory) {
    const itemDetails = gameData.itemDetailMap[itemHrid];
    const isCharm = itemDetails?.equipmentDetail?.type === '/equipment_types/charm';
    if (!isCharm) {
        itemElem.dataset.askValue = 0;
        itemElem.dataset.bidValue = 0;
        continue;
    }
    // Skip trainee charms...
}
```

1. **Enable sorting** (line 266):

```javascript
// BEFORE:
const shouldSort = !isEquipmentCategory;

// AFTER:
const shouldSort = true;
```

## Benefits

- Equipment items have wildly different values (base vs enhanced, different tiers)
- Useful to sort "which is my most valuable weapon?"
- Consistency - Equipment should work like other categories
- Users can still select "None" for default order

## Performance Impact

**Negligible:**

- Market lookups already cached
- Equipment category = 10-20 items max
- Badge rendering is lightweight

## Code Changes

**Total:** Remove ~16 lines + change 1 line = minimal

**Files Modified:**

- `src/features/inventory/inventory-sort.js` only

---

**Status:** Documented - not yet implemented
**Date:** 2026-01-05
