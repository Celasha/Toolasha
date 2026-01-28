# Market Price Safeguards TODO

## Issue
Market manipulation when items are bought out - last ask listing at absurd price (e.g., 100B for 10K item)

## Solution
1.5x threshold: If market ask > crafting cost × 1.5, use crafting cost instead

## Status

### ✅ COMPLETED
1. **Profit Calculator** (`profit-calculator.js`)
   - Added `getReliablePrice()` helper
   - Used in `calculateMaterialCosts()` and `calculateTeaCosts()`
   - Visual indicators: `(calc)` on items, `⚠️ Market unreliable` warning

2. **Networth Calculator** (`networth-calculator.js`)
   - Added 1.5x check in `getMarketPrice()` lines 126-133
   - Applies to base items only (enhancementLevel === 0)
   - Naturally handles recursive checking via `calculateCraftingCost()`

3. **Enhancement Path Calculator** (`tooltip-enhancement.js`)
   - Updated `getRealisticBaseItemPrice()` function
   - Changed from 30% bid/ask spread to 1.5x threshold against crafting cost
   - Uses `getProductionCost()` for crafting cost calculation
   - Applies to base items used in enhancement paths

4. **Alchemy Profit Calculator** (`alchemy-profit-calculator.js`)
   - Added `getReliablePrice()` helper method (lines 54-94)
   - Added `calculateSimpleCraftingCost()` helper method (lines 96-154)
   - Updated all price lookups to use `getReliablePrice()`:
     - Tea costs (line 269)
     - Coinify input prices (line 301)
     - Decompose input/output prices (lines 371, 385, 399)
     - Transmute input/output prices (lines 472, 484)

5. **Expected Value Calculator** (`expected-value-calculator.js`)
   - Added `calculateSimpleCraftingCost()` helper method (lines 166-232)
   - Updated `getDropPrice()` function (lines 234-284)
   - Added 1.5x threshold check for regular market items
   - Applies to all chest/crate drop valuations

6. **Gathering Profit Calculator** (`gathering-profit.js`)
   - Added `calculateSimpleCraftingCost()` helper method (lines 42-105)
   - Added `getReliablePrice()` helper method (lines 107-132)
   - Updated `getCachedPrice()` to use `getReliablePrice()` (line 205)
   - Applies to all gathered resource prices and processing conversions

7. **Task Token Valuation** (`task-profit-calculator.js`)
   - Already protected via Expected Value Calculator
   - Uses `expectedValueCalculator.calculateExpectedValue()` which has 1.5x safeguards
   - Applies to Task Shop chest valuations (Large Artisan's Crate, Large Meteorite Cache, Large Treasure Chest)

8. **Dungeon Token Valuation** (`token-valuation.js`)
   - Added `calculateSimpleCraftingCost()` helper method (lines 10-67)
   - Added `getReliableMarketPrice()` helper method (lines 69-100)
   - Updated `calculateDungeonTokenValue()` to use reliable prices (lines 133-175)
   - Applies to all dungeon shop item prices and essence fallback prices

### 🔴 NEEDS IMPLEMENTATION

**None - All systems protected!**

## Implementation Notes

**Consistent Approach:**
All 8 systems now use the same 1.5x threshold pattern:
1. Get market price
2. Calculate crafting cost (if item is craftable)
3. If market price > crafting cost × 1.5 → use crafting cost
4. Otherwise use market price

**Recursive Safety:**
Crafting cost calculations naturally check material prices recursively, so if materials are also manipulated, the system handles it properly.

**Shared Helpers:**
Each module has its own `calculateSimpleCraftingCost()` helper to avoid circular dependencies. They all follow the same pattern with Artisan Tea reduction (0.9x) applied to input materials.

## Testing Checklist

- [x] Enhancement path shows reasonable costs for manipulated base items
- [x] Alchemy profit calculations don't show absurd values
- [x] Expected value for chests remains reasonable
- [x] Gathering profit not affected by market manipulation
- [x] Task/dungeon token values stay consistent
- [x] All existing tests still pass (187/187)
- [x] Networth and profit tooltips still working correctly
- [x] Build successful with no errors or warnings

---

**Created:** 2026-01-27
**Last Updated:** 2026-01-27
