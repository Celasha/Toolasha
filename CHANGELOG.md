# Changelog

All notable changes to the MWI Tools refactoring project.

## [Unreleased]

### Added - December 21, 2024

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

**Version:** 25.1-refactor
**Build Date:** December 21, 2024
