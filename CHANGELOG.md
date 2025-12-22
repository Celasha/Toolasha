# Changelog

All notable changes to MWI Tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-12-21

### Overview

First pre-release version of the refactored MWI Tools codebase. The entire script has been refactored from a 6,706-line monolith into a modular architecture with proper separation of concerns.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Major Refactoring Completed

### Added - December 21, 2024

#### **Equipment Rare Find Parsing & Two-Column Tooltip Layout**

**Equipment Rare Find Support:** All rare find sources now properly accounted for in profit calculations.

- **Equipment Parser Enhancements:**
  - New `parseRareFindBonus()` function extracts rare find stats from equipment
  - Supports skill-specific rare find: `brewingRareFind`, `milkingRareFind`, `cheesesmithingRareFind`, etc. (9 skills)
  - Supports generic rare find: `skillingRareFind` (applies to all skills)
  - Handles enhancement scaling with proper multipliers
  - Example: Brewer's Top +0 provides +15% Rare Find for brewing actions

- **Profit Calculator Integration:**
  - Combines equipment rare find + house room rare find (was house rooms only)
  - Formula: `rareFindBonus = equipmentRareFindBonus + houseRareFindBonus`
  - Example with Brewer's Top +0: 15% (equipment) + 2.2% (10 house room levels) = 17.2% total

- **Two-Column Tooltip Layout:**
  - Left column: PRODUCTION COST (materials + artisan details + teas)
  - Right column: PROFIT ANALYSIS + BONUS REVENUE (profit + essence/rare find drops)
  - Bottom section: Full-width STATS (time, efficiency, gourmet, processing)
  - Reduces vertical height while preserving all detailed information
  - No information removed - complete artisan breakdowns, full drop details, all efficiency sources

### Added - December 21, 2024

#### **Phase 6: Expected Value Calculator for Openable Containers**

**NEW FEATURE:** Expected value analysis for all 19 openable containers to help players understand the value of container drops from skilling actions.

**IMPORTANT:** Containers **cannot be sold** on the market - they are rare find drops from skilling. The EV calculator shows the total value you'll receive when opening the container.

- **Container Sources:**
  - All containers are "Rare Finds" from skilling actions
  - Drop rates scale with Rare Find stat from house rooms (0.2% base + 0.2% per total level)
  - Cannot be bought or sold - only obtained as drops and opened
  - Covers all 19 containers: Artisan's Crates (3), Meteorite Caches (3), Treasure Chests (3), Dungeon Chests (8), Purple's Gift (1), Cowbell Bag (1)

- **Expected Value Calculation:**
  - Formula: `EV = sum((minCount + maxCount) / 2 × dropRate × price × taxFactor)`
  - Applies 2% market tax to tradeable drops
  - Handles special pricing: Coin (face value = 1), Cowbell (bag price ÷ 10)
  - Respects pricing mode for valuing drops (Conservative = bid, Hybrid/Optimistic = ask)
  - New module: `expected-value-calculator.js` with pre-calculation and caching

- **Nested Container Convergence:**
  - 4-iteration convergence algorithm handles Purple's Gift containing smaller containers
  - Dependency-ordered calculation ensures nested values are accurate
  - Cached results updated when market data refreshes

- **Integration with Profit Calculator:**
  - When containers appear in rare find drops, profit calculator uses EV instead of market price (which is 0)
  - Provides accurate bonus revenue calculations for actions that drop containers
  - Example: Woodcutting drops Small Artisan's Crate (0.005%) → valued at EV (17,250) not market price (0)

- **Tooltip Display:**
  - New "EXPECTED VALUE" section for container tooltips
  - Shows total expected return from opening
  - Optional detailed drop breakdown (all drops shown by default)
  - Format: `• Item Name (dropRate%): avgCount avg → expectedValue`
  - Example:
    ```
    EXPECTED VALUE
      Expected Return: 17,250

    All Drops (19 total):
      • Task Token (100.00%): 7.50 avg → 9,000
      • Coin (100.00%): 7,500.00 avg → 7,500
      • Shard of Protection (100.00%): 1.50 avg → 450
      ... (16 more drops)

    Total from 19 drops: 17,250
    ```

- **Configuration Settings:**
  - `itemTooltip_expectedValue` (default: true) - Enable/disable EV display
  - `expectedValue_showDrops` (default: "All") - Control drop detail level:
    - "All": Show every drop with full details
    - "Top 5": Show 5 highest value drops
    - "Top 10": Show 10 highest value drops
    - "None": Summary only (no individual drops)
  - `expectedValue_respectPricingMode` (default: true) - Use pricing mode when valuing drops inside containers

**Files Added:**
- `src/features/market/expected-value-calculator.js` (new module, ~350 lines)

**Files Modified:**
- `src/features/market/tooltip-prices.js` (lines 10, 156-170, 556-641) - Import and simplified display
- `src/features/market/profit-calculator.js` (lines 13, 582-591, 625-634) - Import EV calculator, use EV for container drops
- `src/core/config.js` (lines 87-101) - Three new configuration settings
- `src/main.js` (lines 17, 120, 167) - Import, initialization, and debug export

**Technical Details:**
```javascript
// Expected value calculation for a drop inside a container
avgCount = (minCount + maxCount) / 2
taxFactor = item.tradeable ? 0.98 : 1.0
dropValue = avgCount × dropRate × price × taxFactor

// Nested container convergence (4 iterations)
for (iteration = 0; iteration < 4; iteration++) {
    for (container in containers) {
        ev = calculateSingleContainer(container)
        cache.set(container, ev)
    }
}

// Special pricing for drops
Coin: price = 1 (face value)
Cowbell: price = Cowbell Bag price / 10
Nested container: price = cached EV from previous iteration
Market items: price = bid (conservative) or ask (hybrid/optimistic)

// Integration with profit calculator
if (itemDetails.isOpenable) {
    // Container in rare drop table - use EV
    itemPrice = expectedValueCalculator.getCachedValue(itemHrid)
} else {
    // Regular item - use market price
    itemPrice = marketAPI.getPrice(itemHrid, 0)?.bid
}
```

**Result:** Players can now understand the true value of container drops from skilling actions. When containers appear in the BONUS REVENUE section of profit tooltips, they're correctly valued at their expected value rather than 0. The EV tooltip provides complete transparency into what you'll receive when opening any container.

#### **Phase 5: Essence & Rare Find Revenue Tracking**

**NEW FEATURE:** Bonus Revenue from essence and rare find drops

- **Essence Find Tracking:**
  - Extracts `skillingEssenceFind` stat from equipment (e.g., Ring of Essence Find: 15% base + 1.5% per enhancement level)
  - New function: `parseEssenceFindBonus()` in equipment-parser.js
  - Multiplies essence drop rates: `finalDropRate = baseDropRate × (1 + essenceFind%)`
  - Example: 15% essence drop with 15% Essence Find → 17.25% final drop rate

- **Rare Find Tracking:**
  - Calculates Rare Find from house room levels (0.2% base + 0.2% per total level)
  - New function: `calculateHouseRareFind()` in house-efficiency.js
  - Multiplies rare find drop rates: `finalDropRate = baseDropRate × (1 + rareFind%)`
  - Example: 0.003% Branch of Insight with 1.8% Rare Find → 0.00305% final drop rate

- **Revenue Calculation:**
  - Processes all items in `essenceDropTable` and `rareDropTable` for each action
  - Formula: `dropsPerHour = actionsPerHour × dropRate × avgCount × (1 + bonus%)`
  - Uses market bid price (instant sell) for all bonus drops
  - New method: `profitCalculator.calculateBonusRevenue()`

- **Tooltip Display:**
  - New "BONUS REVENUE" section after Profit Analysis
  - Shows Essence Find and Rare Find bonuses if > 0
  - Lists all essence and rare find drops with individual revenue
  - Format: `• Item Name: drops/hr (dropRate%) @ price → revenue/hr`
  - Shows total bonus revenue and adjusted profit
  - Example:
    ```
    BONUS REVENUE
      Essence Find: +15.0% | Rare Find: +1.8%
      • Woodcutting Essence: 9.000/hr (15.00%) @ 400 → 3,600/hr
      • Branch of Insight: 0.002/hr (0.0031%) @ 21,000,000 → 42,000/hr
      • Large Meteorite Cache: 0.024/hr (0.0389%) @ 740,000 → 17,760/hr
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      Total Bonus: 63,360/hr
      Adjusted Profit: 623,729/hr (15.0M/day)
    ```

- **Key Features:**
  - Shows ALL rare items regardless of drop rate (even 0.00003% items)
  - Smart drop rate formatting: 4 decimals for < 0.001%, 2 decimals otherwise
  - Drops/hour shown to 3 decimal places for accuracy on rare items
  - Color-coded adjusted profit (lime/red based on profitability)
  - Only appears when action has essence or rare find drops

**Files Modified:**
- `src/utils/equipment-parser.js` (lines 294-347) - Added `parseEssenceFindBonus()`
- `src/utils/house-efficiency.js` (lines 81-120) - Added `calculateHouseRareFind()`
- `src/features/market/profit-calculator.js` (lines 10-11, 225-231, 252, 548-644) - Added bonus revenue calculation
- `src/features/market/tooltip-prices.js` (lines 405-443) - Added Bonus Revenue display section

**Technical Details:**
```javascript
// Essence drops (e.g., Woodcutting Essence from Arcane Tree)
essenceDropRate = 0.15 // 15% base
essenceFindBonus = 15% // Ring of Essence Find +0
finalRate = 0.15 × (1 + 0.15) = 0.1725 // 17.25%
dropsPerHour = 60 actions/hr × 0.1725 × 1 = 10.35/hr

// Rare finds (e.g., Branch of Insight from Arcane Tree)
rareDropRate = 0.00003 // 0.003% base
rareFindBonus = 1.8% // All house rooms at level 8
finalRate = 0.00003 × (1 + 0.018) = 0.00003054 // 0.003054%
dropsPerHour = 60 actions/hr × 0.00003054 × 1 = 0.00183/hr
```

**Result:** Complete revenue picture including all bonus drops from skilling actions

#### **Phase 4c: Drink Concentration Display**

**UX IMPROVEMENT:** Inline Drink Concentration contribution display

- **Display Changes:**
  - Shows DC contribution inline with tea-affected stats
  - Format: `Tea Buffs: +11.2% (+1.2% DC)`
  - Format: `Artisan: -11.2% material requirement (-1.2% DC)`
  - Format: `Gourmet: +13.4% bonus items (+1.4% DC)`
  - Format: `Processing: 16.8% conversion chance (+1.8% DC)`
  - Shows DC contribution in Action Level breakdown

- **Calculation Formula:**
  - DC contribution = `totalEffect × (DC / (1 + DC))`
  - Example: 11.2% tea efficiency with 12% DC → DC contributes 1.2%

- **Visibility:**
  - Only shows when drinkConcentration > 0
  - Appears on all tea-affected stats (Efficiency, Artisan, Gourmet, Processing, Action Level)
  - Compact inline format - no separate section needed

**Files Modified:**
- `src/features/market/tooltip-prices.js` (lines 313-319, 437-445, 477-482, 490-495)

#### **Phase 4: Material Costs & Tea Consumption**

##### **Phase 4a: Material Cost Efficiency Scaling**
- **FEATURE:** Material costs now scale with efficiency multiplier
- **Previous Behavior:** Material costs calculated per action without efficiency scaling
- **Current Behavior:** `materialCostPerHour = actionsPerHour × totalMaterialCost × efficiencyMultiplier`
- **Rationale:** Efficiency "repeats the action and consumes inputs" (per game wiki)
- **Impact:** More accurate profit calculations matching external calculators
- **Example:** 130% efficiency (2.3× multiplier) → material costs increase by 2.3×

##### **Phase 4b: Tea Consumption Costs**
- **NEW FEATURE:** Tea consumption costs now included in profit calculations
- **Formula:** `teaCostPerHour = teaPrice × 12 drinks/hour × number of active teas`
- **New Method:** `profitCalculator.calculateTeaCosts(actionTypeHrid, actionsPerHour)`
- **Display:** New "Tea Consumption" section in profit tooltips
- **Format:** "Tea Consumption: 165,600/hr" with breakdown per tea
- **Example Display:**
  ```
  Tea Consumption: 165,600/hr
    • Efficiency Tea ×12/hr @ 1,950 → 23,400
    • Artisan Tea ×12/hr @ 2,050 → 24,600
    • Ultra Cheesesmithing Tea ×12/hr @ 9,800 → 117,600
  ```

**Updated Profit Formula:**
```javascript
// Revenue (unchanged)
revenuePerHour = (itemsPerHour × priceAfterTax) + (gourmetBonusItems × priceAfterTax)

// Costs (now includes efficiency and tea consumption)
materialCostPerHour = actionsPerHour × totalMaterialCost × efficiencyMultiplier
totalTeaCostPerHour = teaCosts.reduce((sum, tea) => sum + tea.totalCost, 0)
totalCostPerHour = materialCostPerHour + totalTeaCostPerHour

// Final profit
profitPerHour = revenuePerHour - totalCostPerHour
```

**Result:** Profit calculations now match external calculators within ~9% (560K/hr vs 617K/hr for Verdant Cheese test case)

**Files Modified:**
- `src/features/market/profit-calculator.js` (lines 205-223, 489-537)
- `src/features/market/tooltip-prices.js` (lines 358-370)

#### **Phase 3: Community Buffs & Pricing Modes**
- **NEW FEATURE:** Community Buff Detection
  - Detects Production Efficiency community buff level (0-20)
  - Formula: `14% + (level - 1) × 0.3%` = 19.7% at T20
  - New method: `dataManager.getCommunityBuffLevel(buffTypeHrid)`
  - New method: `profitCalculator.calculateCommunityBuffBonus(level, actionType)`
  - Displayed in efficiency breakdown: "Community Buff: +19.7%"
  - Closes efficiency gap with external calculators

- **NEW FEATURE:** Three Pricing Modes
  - **Conservative (Ask/Bid):** Instant trading both ways (lowest profit)
  - **Hybrid (Ask/Ask):** Instant buy, patient sell orders (realistic, DEFAULT)
  - **Optimistic (Bid/Ask):** Patient trading both ways (highest profit)
  - Console access: `MWITools.config.setSettingValue('profitCalc_pricingMode', 'hybrid')`
  - Setting stored in `config.js` as string value

- **NEW FEATURE:** Artisan Tea Floor/Modulo Breakdown
  - Shows guaranteed material savings: `floor(reduction)`
  - Shows probability for extra savings: `(reduction % 1) × 100`
  - Example: 2 base materials with 10.2% Artisan
    - Total savings: 0.204
    - Guaranteed: 0 (floor)
    - Chance: 20.4% to save 1 material
  - Matches Efficiency mechanic display format

- **NEW DOCUMENTATION:** Comprehensive Testing Checklist
  - 25 test sections covering all features
  - Core systems, tooltips, equipment, house rooms
  - All tea buff types (efficiency, artisan, gourmet, processing)
  - All three pricing modes
  - Edge cases and performance testing

### Fixed - December 21, 2024

#### **Stack Amount Extraction for Large Numbers**
- **FIXED:** Comma-separated amounts now parsed correctly
- **Previous:** "Amount: 4,900" parsed as "4" (regex only matched digits)
- **Current:** "Amount: 4,900" parsed as "4900" (regex matches `[\d,]+`, strips commas)
- **Impact:** Stack totals now calculate correctly (4,900 × 230 = 1,127,000)
- **File:** `src/features/market/tooltip-prices.js` line 208

#### **MWITools Export to Page Context**
- **FIXED:** MWITools now accessible in browser console
- **Previous:** `window.MWITools` set in userscript context (isolated)
- **Current:** `unsafeWindow.MWITools` set in page context (accessible)
- **Impact:** Console commands now work: `MWITools.config.getSettingValue(...)`
- **File:** `src/main.js` line 161

### Fixed - December 21, 2024

#### **CRITICAL FIX: Efficiency Formula Correction**
- **FIXED:** Removed efficiency from action time calculation (major bug)
- **Correct Behavior:**
  - Speed bonuses: Reduce action time (e.g., 15% speed → 60s becomes 52.17s)
  - Efficiency bonuses: Increase output (e.g., 10% efficiency → 1.1× items per action)
- **Previous (WRONG):** `actionTime = baseTime / (1 + efficiency% / 100 + speed)`
- **Current (CORRECT):** `actionTime = baseTime / (1 + speed)`
- **Efficiency now applied correctly:** `itemsPerHour = actionsPerHour × outputAmount × efficiencyMultiplier`

**Efficiency Calculation:**
- Simple linear multiplier: `1 + efficiency / 100`
- Example: 150% efficiency → `1 + 150/100 = 2.5×` multiplier
- Example: 10% efficiency → `1 + 10/100 = 1.1×` multiplier
- Formula matches original MWI Tools implementation

**Updated Display:**
- Time breakdown now only shows speed modifiers
- Efficiency shown separately as output multiplier
- Format: "Efficiency: +10.0% → Output: ×1.10 (66/hr)"

### Changed - December 21, 2024

#### **UX: Time Breakdown Display Order**
- **CHANGED:** Profit tooltip now shows final action time first, then works backwards
- **Previous:** Base Time → Modifiers → Final Time (forces mental calculation)
- **Current:** Action Time (final) → Separator → Base Time → Modifiers (shows result first)
- **Format Example:**
  ```
  Action Time: 54.5s (66/hr)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Base Time: 60.0s
    - Equipment Speed (+15.0%): -6.5s
  ```
- **Rationale:** Players care about "How fast is this?" not base time - show what matters most first

### Added - December 21, 2024

#### **House Room Efficiency (Phase 2 Efficiency System) - WebSocket Integration**
- **NEW MODULE:** `src/utils/house-efficiency.js`
  - Calculates efficiency bonuses from house room levels
  - Maps action types to house rooms (Brewery, Forge, Kitchen, etc.)
  - Formula: `houseLevel × 1.5%` efficiency per level (0-8 levels)
  - Uses `dataManager` for automatic WebSocket data detection
  - Provides room name helpers for display

- **UPDATED:** `src/core/data-manager.js`
  - Added `characterHouseRooms` Map to track house room data from WebSocket
  - Added `updateHouseRoomMap()` method to parse `characterHouseRoomMap` from WebSocket
  - Added `getHouseRooms()` and `getHouseRoomLevel()` accessor methods
  - Listens to `init_character_data` message for automatic house room detection

- **UPDATED:** `src/core/config.js`
  - **REMOVED:** Manual house room configuration (no longer needed)
  - House rooms now automatically detected from WebSocket instead of user input
  - Provides much better UX - no manual configuration required

- **UPDATED:** `src/features/market/profit-calculator.js`
  - Integrates house efficiency into total efficiency calculation
  - Separates level efficiency vs house efficiency components
  - Returns breakdown for tooltip display

- **UPDATED:** `src/features/market/tooltip-prices.js`
  - Shows efficiency breakdown in profit tooltips
  - Format: "Efficiency: +18.0% → Level Advantage: +10.0% → House Room: +12.0%"
  - Only shows components that are > 0

**Data Source:** WebSocket message `init_character_data` → `characterHouseRoomMap`
```javascript
characterHouseRoomMap = {
  '/house_rooms/brewery': { houseRoomHrid: '/house_rooms/brewery', level: 5 },
  '/house_rooms/forge': { houseRoomHrid: '/house_rooms/forge', level: 8 },
  ...
}
```

**Example Display:**
```
Efficiency: +18.0%
  - Level Advantage: +10.0%
  - House Room: +12.0%
  Output: ×1.18 (71/hr)
```

**House Room Mapping:**
- Brewery → Brewing
- Forge → Cheesesmithing
- Kitchen → Cooking
- Workshop → Crafting
- Garden → Foraging
- Dairy Barn → Milking
- Sewing Parlor → Tailoring
- Log Shed → Woodcutting
- Laboratory → Alchemy

#### Action Time Calculation Breakdown
- **NEW FEATURE:** `src/features/market/tooltip-prices.js`
  - Displays step-by-step calculation of action time in profit tooltips
  - Shows base time, each modifier's contribution, and final result
  - Format: "Base: 60.0s → Level Efficiency: 54.5s → Equipment Speed: 48.0s → Final: 48.0s"
  - Visual separator (horizontal line) before final time
  - Breakdown always visible when viewing production profit analysis

- **UPDATED:** `src/features/market/profit-calculator.js`
  - Added `calculateTimeBreakdown()` method
  - Returns structured breakdown data with base time, modifier steps, and final time
  - Each step includes: name, bonus percentage, seconds reduced, and running total
  - Breakdown automatically calculated for all profit calculations

**Example Breakdown Display:**
```
Base Time: 60.0s
  - Level Efficiency (+10.0%): -5.5s → 54.5s
  - Equipment Speed (+15.0%): -6.5s → 48.0s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Final Time: 48.0s (75/hr)
```

#### Equipment Speed Bonuses (Phase 1 Efficiency System)
- **NEW MODULE:** `src/utils/equipment-parser.js`
  - Parses equipped items for skill-specific speed bonuses
  - Maps action types to speed fields (craftingSpeed, brewingSpeed, etc.)
  - Handles enhancement scaling (+0.1 per enhancement level)
  - Sums all matching equipment bonuses

- **UPDATED:** `src/features/market/profit-calculator.js`
  - Integrated equipment speed bonus calculations
  - Action time formula: `baseTime / (1 + efficiency% / 100 + speedBonus)`
  - Returns equipment speed bonus in profit data

- **UPDATED:** `src/features/market/tooltip-prices.js`
  - Displays equipment speed bonus in profit analysis section
  - Format: "Equipment Speed: +15.0%" (converts decimal to percentage)
  - Only shows when speed bonus > 0

#### Tooltip Overflow Fix
- **FIXED:** Tooltip cutoff issue when content exceeds viewport height
- **SOLUTION:** Dual approach (CSS + JavaScript)
  - CSS: `max-height: calc(100vh - 20px)` with scrolling enabled
  - JavaScript: Repositions tooltip to Y=0 when overflow detected
  - Uses `requestAnimationFrame()` for smooth positioning
  - Parses and modifies `transform3d()` values

- **UPDATED:** `src/features/market/tooltip-prices.js`
  - Added `fixTooltipOverflow()` method
  - Added CSS with `!important` flags to override MUI styles
  - Called after injecting all tooltip content

- **UPDATED:** `src/features/market/tooltip-consumables.js`
  - Added `fixTooltipOverflow()` method
  - Added `addTooltipStyles()` with duplicate detection
  - Ensures CSS is added even if prices feature is disabled

#### Debug Mode
- **ADDED:** Performance timing logs in tooltip modules
  - Set `this.DEBUG = true` in both tooltip classes
  - Logs all major operations with `console.time()`
  - Tracks: Extract HRID, Calculate Profit/Stats, Inject Display, Fix Overflow
  - Shows tooltip bounds and repositioning actions
  - All debug code marked with `========== DEBUG - DELETE WHEN DONE ==========`

### Changed - December 21, 2024

#### Number Formatting
- **CHANGED:** `src/utils/formatters.js`
  - Removed K/M/B abbreviations (e.g., "1.5k" → "1,500")
  - Now uses full numbers with thousand separators
  - Uses `Intl.NumberFormat()` for locale-aware formatting
  - Improves readability for exact values

### Documentation
- **UPDATED:** `README.md`
  - Documented all market system modules
  - Added efficiency system roadmap (Phase 1-3)
  - Added debug mode documentation
  - Updated formatters section to reflect number format change
  - Marked Market System as COMPLETE

### Technical Details

#### Action Time Formula (Current)
```javascript
// Equipment speed bonuses (Phase 1 ✅)
const speedBonus = parseEquipmentSpeedBonuses(equipment, actionType);

// Efficiency (Phase 1 ✅)
const levelEfficiency = (characterLevel - requiredLevel) * 0.01;

// Phase 2 (PLANNED)
const communityEfficiency = 0.14 + (communityTier * 0.003);
const houseEfficiency = 0.015 + (houseLevel * 0.015);

// Phase 3 (PLANNED)
const teaEfficiency = 0.10; // If active

// Final calculation
const actionTime = baseTime / (1 + totalEfficiency + speedBonus);
```

#### Tooltip Overflow Fix Details
- **CSS approach alone:** Failed due to MUI JavaScript positioning
- **JavaScript repositioning:** Required to override `transform3d()` values
- **Performance:** Uses `requestAnimationFrame()` to avoid forced reflows
- **Detection:** Checks `bBox.top < 0 || bBox.bottom > window.innerHeight`
- **Solution:** Resets Y position to 0px when overflow detected

#### Debug Timing Example Output
```
[TooltipPrices #1] Extract HRID: 0.123ms
[TooltipPrices #1] Calculate Profit: 1.234ms
[TooltipPrices #1] Inject Profit: 0.567ms
[TooltipPrices #1] Fix Overflow: 0.012ms
[TooltipPrices #1] Total: 2.103ms
[TooltipPrices #1] Item: Sundering Crossbow (R)
[TooltipPrices] getBoundingClientRect: 0.089ms
[TooltipPrices] Tooltip bounds: top=123.4 bottom=567.8 height=444.4
[TooltipPrices] ⚠️ Overflow detected! Repositioning...
[TooltipPrices] ✅ Repositioned to Y=0
```

### Roadmap

#### Phase 2: User Configuration (PLANNED)
- Add config settings for community buff tier (0-20)
- Add config settings for house room levels (0-8)
- Create UI for user input or use existing settings system
- Calculate community buff efficiency: `14% + (tier × 0.3%)`
- Calculate house room efficiency: `1.5% + (level × 1.5%)`
- Map action types to house rooms (Workshop, Kitchen, Brewery, etc.)

#### Phase 3: Consumable Buffs (RESEARCH NEEDED)
- Research if active buff state is accessible via WebSocket
- If accessible: Automatic detection of Efficiency Tea (+10%)
- If not accessible: Add to user configuration
- Support skill-specific teas (Crafting Tea, Brewing Tea, etc.)

---

## Version History

- **0.1.0** (2024-12-21) - First pre-release of refactored codebase
- **25.1** (2024) - Last version of original monolithic codebase

---

**Current Version:** 0.1.0
**Build Date:** December 21, 2024
**Status:** Pre-release (Testing)
