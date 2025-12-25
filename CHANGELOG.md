# Changelog

All notable changes to MWI Tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### **Production Actions: Bonus Revenue from Essence & Rare Find Drops**

**NEW FEATURE:** Production actions now display bonus revenue from essence and rare find drops, matching gathering profit calculator.

- **Bonus Revenue Display:**
  - Split into "Essence Drops" and "Rare Finds" subsections
  - Each subsection shows relevant bonus percentage (Essence Find % or Rare Find %)
  - Item-by-item breakdown with drop rate and revenue per hour
  - Format: `• Item: drops/hr (dropRate%) → revenue/hr`
  - Progressive disclosure pattern matching gathering profit display

- **Integration:**
  - Added to production profit display in `panel-observer.js`
  - Reuses existing bonus revenue calculation from `profit-calculator.js`
  - Total bonus revenue added to net profit calculation
  - Adjusted profit shown with bonus revenue included

- **Example Display:**
  ```
  ▼ 💰 Profitability
    Actions: 251.2/hr
    Net Profit: 1,053,773/hr, 25,290,552/day

    ▼ 📊 Detailed Breakdown
      Revenue: 2,150,000/hr
        ▶ Base Output: 1,950,000/hr
        ▶ Gourmet Bonus: 177,451/hr (13.4% gourmet)
        ▶ Essence Drops: 16,035/hr (1 item, 10.0% essence find)
        ▶ Rare Finds: 6,514/hr (1 item, 2.4% rare find)
  ```

- **Files Modified:**
  - `src/features/actions/panel-observer.js` (lines 908-1023)

**Result:** Complete revenue transparency for production actions showing all income sources including essence and rare find drops.

### Changed

#### **Action Panel Efficiency Display Reorganization**

**UX IMPROVEMENT:** Comprehensive reorganization of efficiency and modifier displays for better clarity and reduced redundancy.

- **Action Speed & Time Section Enhancement (quick-input-buttons.js):**
  - **Moved efficiency breakdown** from Profitability/Modifiers to this section
  - **Individual tea breakdown** instead of lumping teas together:
    - Each active tea shown on its own line with contribution percentage
    - **Drink Concentration contribution shown as sub-line** for each tea
    - Example: "Efficiency Tea: +11.2%" with sub-line "Drink Concentration: +1.2%"
    - Example: "Ultra Cheesesmithing Tea: +6.7%" with sub-line "Drink Concentration: +0.7%"
    - No longer shows "Tea: +17.9%" lumped together
  - **Action Level bonus tea display:**
    - Shows teas that raise effective requirement (e.g., Artisan Tea)
    - Displays progression: Raw level delta → Artisan Tea impact → DC impact
    - **Raw level delta:** Shows efficiency before any Action Level bonuses (e.g., 100 - 1 = +99.0%)
    - **Tea impact:** Shows reduction from base tea effect (e.g., -5.0% from Artisan Tea)
    - **DC impact:** Shows additional reduction from Drink Concentration scaling (e.g., -0.6%)
    - Makes explicit how Action Level bonuses REDUCE level efficiency by raising effective requirement
    - Example: "Raw level delta: +99.0% → Artisan Tea: -5.0% → DC: -0.6% = Final: +93.4%"
  - **Detailed component display:**
    - Level efficiency with levels above requirement
    - Action Level bonus teas with DC breakdown (if present)
    - House efficiency with room name and level (e.g., "Forge level 1")
    - Equipment efficiency percentage
    - Individual teas with their contributions (broken out)
    - Drink Concentration sub-line for each tea (if > 0)
    - Community efficiency with tier level (e.g., "Production Efficiency T20")
  - **Format:**
    ```
    Efficiency: +123.655% → Output: ×2.24 (561/hr)
      - Level: +73.355%
        - Raw level delta: +79.000% (100 - 21 base requirement)
        - Artisan Tea impact: -5.000% (raises requirement)
          - Drink Concentration: -0.645%
      - House: +1.500% (Forge level 1)
      - Equipment: +2.000%
      - Efficiency Tea: +10.000%
        - Drink Concentration: +1.300%
      - Ultra Cheesesmithing Tea: +14.000%
        - Drink Concentration: +1.800%
      - Community: +19.700% (Production Efficiency T20)
    ```
  - **All top-level items are additive:** 73.355 + 1.500 + 2.000 + 10.000 + 1.300 + 14.000 + 1.800 + 19.700 = 123.655%
  - Each component on separate line with specific details
  - 3 decimal precision throughout for verification

- **Material Costs Display Enhancement (panel-observer.js):**
  - **Embedded Artisan tea information** directly in material lines
  - **Format:** `amount/hr (base amount -X% 🍵) @ price → total/hr`
  - **Example:** `• Verdant Sword: 237.5/hr (267.9 base -11.3% 🍵) @ 28,500 → 6,769,349/hr`
  - Only shows when Artisan tea is active and material has baseAmount
  - Cleaner display eliminating redundant Artisan section

- **Modifiers Section Simplification (panel-observer.js):**
  - **Removed efficiency display** (moved to Action Speed & Time)
  - **Kept Artisan and Gourmet** for quick reference
  - No longer duplicates efficiency information shown elsewhere

- **Profitability Summary Cleanup (panel-observer.js):**
  - **Simplified top-level line** to just "Actions: X/hr"
  - **Removed efficiency percentage** (now in Action Speed & Time section)
  - Cleaner, less cluttered summary

- **Files Modified:**
  - `src/features/actions/quick-input-buttons.js` (lines 17, 240-264, 503-567)
    - Imported `parseTeaEfficiencyBreakdown` and `parseActionLevelBonusBreakdown` functions
    - Enhanced `calculateActionMetrics()` to use tea breakdown and Action Level breakdown
    - Returns `teaBreakdown` and `actionLevelBreakdown` arrays in efficiencyBreakdown
    - Display each tea on separate line with DC contribution sub-line
    - Display Action Level bonus progression: Raw delta → Tea impact → DC impact
    - Shows negative impact values to clarify reduction in level efficiency
  - `src/utils/tea-parser.js` (lines 125-202, 330-392)
    - Added `parseTeaEfficiencyBreakdown()` function
    - Returns array of `{name, efficiency, baseEfficiency, dcContribution}` objects
    - Added `parseActionLevelBonusBreakdown()` function
    - Returns array of `{name, actionLevel, baseActionLevel, dcContribution}` objects
    - Tracks both base values and DC scaling for detailed display
  - `src/features/actions/panel-observer.js` (lines 1039-1053, 1089-1119, 1121-1125)
    - Embedded Artisan info in Material Costs lines
    - Removed efficiency from Modifiers section
    - Simplified Profitability summary line

**Result:** Efficiency information consolidated in one place (Action Speed & Time) with detailed breakdown, while material costs show embedded Artisan savings inline. No information lost, better organization.

### Fixed

#### **Community Buff Efficiency Integration in Quick Input Buttons**

**BUG FIX:** Added missing community buff efficiency calculation to Action Speed & Time section.

- **Issue:** Community buff efficiency was calculated in profit-calculator.js but missing from quick-input-buttons.js
- **Impact:** Efficiency display in Action Speed & Time may have been 0.6% lower than actual
- **Fix:** Added community buff detection and calculation to `calculateActionMetrics()`
- **Formula:** `(0.14 + ((level - 1) × 0.003)) × 100` for Production Efficiency buff
- **Display:** Shows tier level in breakdown (e.g., "Production Efficiency T20")
- **File:** `src/features/actions/quick-input-buttons.js` (lines 519-521, 524-530)

**Result:** Action Speed & Time section now shows complete efficiency breakdown matching profit calculator.

#### **Level Progress Calculator**

**NEW FEATURE:** Action panels now display comprehensive level progression tracking with XP breakdown and time estimates.

- **Collapsed Summary:**
  - Shows time to next level (e.g., "2.5 days to Level 51")
  - Quick at-a-glance reference for leveling progress

- **Expanded View:**
  - **Current Progress:** "Level 100 | 26.5% to Level 101"
    - Simplified single-line format
    - Progress calculated as: (XP gained this level) / (XP needed for this level)
    - Matches game's native progress calculation

  - **XP Per Action:**
    - Format: "55.0 base → 75.4 (×1.37)"
    - Shows base XP from action data
    - Shows modified XP after all bonuses applied
    - Displays total multiplier

  - **Comprehensive XP Bonus Breakdown:**
    - Total XP Bonus displayed at top (e.g., "+37.1%")
    - Individual sources listed with percentages:
      - **Celestial Shears:** Skill-specific equipment XP (e.g., +4.0% Foraging XP)
      - **Philosopher's Equipment:** General wisdom bonus (+3.0% base, scales 5× with enhancement for accessories)
      - **House Rooms:** +0.05% per level, all rooms contribute (e.g., +0.6% for 12 total levels)
      - **Community Buff:** 20% base + 0.5% per tier (max 29.5% at T20)
      - **Wisdom Tea:** 12% base, scales with Drink Concentration (e.g., +13.5% with Guzzling Pouch +8)
    - Shows enhancement levels for equipped items (e.g., "Philosopher's Necklace +10")

  - **Progress to Next Level:**
    - Actions to level: Number of actions needed
    - Time to level: Human-readable time estimate
    - XP/hour and XP/day: Combined single-line format "18,912 | 453,878"

- **XP Calculation Formula:**
  - Skilling: `Final XP = Base XP × (1 + Total Wisdom + Charm Experience)`
  - All XP sources are additive (Wisdom + Charm XP)
  - Uses modified XP for all downstream calculations (actions needed, XP/hour, etc.)

- **Technical Implementation:**
  - NEW: `src/utils/experience-parser.js` (287 lines)
    - `parseEquipmentWisdom()` - Philosopher's items (skillingExperience stat)
    - `parseCharmExperience()` - Skill-specific XP (e.g., foragingExperience)
    - `parseHouseRoomWisdom()` - +0.05% per house level
    - `parseCommunityBuffWisdom()` - 20% + 0.5% per tier
    - `parseConsumableWisdom()` - Wisdom Tea/Coffee with DC scaling
    - `calculateExperienceMultiplier()` - Combines all sources with breakdown
  - Modified: `src/features/actions/quick-input-buttons.js`
    - `createLevelProgressSection()` - Creates collapsible level progress display
    - Added summary parameter to `createCollapsibleSection()` for collapsed summaries
    - Removed visual progress bar (game already has one on side panel)

- **Files:**
  - NEW: `src/utils/experience-parser.js` (287 lines)
  - Modified: `src/features/actions/quick-input-buttons.js`
  - Modified: `src/main.js` (import experience parser)

**Result:** Complete level progression tracking showing exactly when you'll level up, how much XP you're gaining per hour, and detailed breakdown of all XP bonus sources.

#### **Progressive Disclosure Profit Display (Option C)**

**UX IMPROVEMENT:** Complete redesign of gathering profit display with nested collapsible sections.

- **Collapsed Summary:**
  - Shows profit/hr and profit/day only (no revenue/costs breakdown)
  - Format: `985,313/hr, 23,647,512/day`
  - Clean and concise for quick reference

- **Progressive Disclosure Structure:**
  ```
  ▼ 💰 Profitability
    Actions: 334.1/hr | Efficiency: +33.2%
    Net Profit: 985,313/hr (always visible when expanded)

    ▼ 📊 Detailed Breakdown
      Revenue: 1,061,249/hr
        ▶ Base Output: 763,133/hr (1 item)
        ▶ Essence Drops: 16,035/hr (1 item, 10.0% essence find)
        ▶ Rare Finds: 282,081/hr (2 items, 2.4% rare find)

      Costs: 75,936/hr
        ▶ Drink Costs: 75,936/hr (2 drinks)

      Modifiers:
        • Efficiency: +33.2% (20% level, 11.2% tea, 2.0% equip)
        • Gathering Quantity: +29.5% (29.5% community)
  ```

- **Key Features:**
  - Net Profit line always visible at top level (not hidden in Detailed Breakdown)
  - Color-coded profit (green if positive, red if negative)
  - Split bonus drops into Essence Drops and Rare Finds subsections
  - Essence Find % only shown with essence drops (not misleading)
  - Rare Find % only shown with rare find drops
  - Each subsection independently collapsible
  - Pattern: "Subtotal first, detailed breakdown nested below"

- **Files Modified:**
  - `src/features/actions/panel-observer.js` (complete rewrite of displayGatheringProfit)
  - `src/features/actions/gathering-profit.js` (added priceEach and revenuePerHour to baseOutputs)

#### **Production Profit Calculator**

**NEW FEATURE:** Comprehensive profit analysis for production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing) with same progressive disclosure pattern as gathering profit.

- **Collapsed Summary:**
  - Shows profit/hr and profit/day only
  - Format: `985,313/hr, 23,647,512/day`
  - Quick reference matching gathering profit display

- **Progressive Disclosure Structure:**
  ```
  ▼ 💰 Profitability
    Actions: 251.2/hr | Efficiency: +33.2%
    Net Profit: 985,313/hr, 23,647,512/day (always visible when expanded)

    ▼ 📊 Detailed Breakdown
      Revenue: 2,150,000/hr
        ▶ Base Output: 1,950,000/hr (251.2 items @ 7,765 each)
        ▶ Gourmet Bonus: 200,000/hr (13.4% gourmet)

      Costs: 1,164,687/hr
        ▶ Material Costs: 1,089,751/hr (3 materials)
        ▶ Drink Costs: 74,936/hr (3 drinks)

      Modifiers:
        • Efficiency: +33.2% (20% level, 11.2% tea, 2.0% equip)
        • Artisan: -11.2% material requirement
        • Gourmet: +13.4% bonus items
  ```

- **Key Features:**
  - Net Profit line always visible at top level (not hidden in Detailed Breakdown)
  - Color-coded profit (green if positive, red if negative)
  - Revenue breakdown: Base Output + Gourmet Bonus (when applicable)
  - Costs breakdown: Materials + Teas (both with detailed item-by-item lists)
  - Modifiers: Efficiency, Artisan, Gourmet bonuses
  - Each subsection independently collapsible
  - Pattern: "Subtotal first, detailed breakdown nested below"

- **Calculation:**
  - Reuses existing `profit-calculator.js` for all calculations
  - Accurate material costs with Artisan Tea reduction
  - Tea consumption costs (12 drinks/hour per active tea)
  - Efficiency scaling on outputs and material costs
  - Gourmet Tea bonus items factored into revenue

- **Technical Implementation:**
  - NEW: `src/features/actions/production-profit.js` (111 lines)
    - `calculateProductionProfit()` - Calls profit-calculator, adds profitPerDay
    - `formatProfitDisplay()` - Formats data for display (optional helper)
  - Modified: `src/features/actions/panel-observer.js` (lines 14, 30-36, 274-280, 873-1099)
    - Added PRODUCTION_TYPES constant
    - Added production detection in handleActionPanel()
    - Added displayProductionProfit() function with progressive disclosure

- **Files:**
  - NEW: `src/features/actions/production-profit.js` (111 lines)
  - Modified: `src/features/actions/panel-observer.js`
  - Modified: `src/main.js` (import production-profit)

**Result:** Production actions now show comprehensive profit analysis with same UX as gathering profit, making it easy to compare different recipes and optimize production chains.

#### **Quick Input Buttons**

**NEW FEATURE:** Action panels now include quick input buttons for fast queue setup with real-time total time display.

- **Total Time Display:**
  - Shows "Total time: [duration]" above buttons
  - Updates automatically when input changes
  - Format: "1h 23m 45s" using timeReadable()
  - Simple calculation: actions × actionTime (efficiency affects OUTPUT, not time)
  - Blue color matching game's main theme

- **Two-Row Layout:**
  - **First row (time-based):** 0.5, 1, 2, 3, 4, 5, 6, 10, 12, 24 hours
  - **Second row (count-based):** 10, 100, 1,000, Max
  - Layout:
    ```
    [Input field: 1000]
    Total time: 1h 23m 45s
    Do [0.5] [1] [2] [3] [4] [5] [6] [10] [12] [24] hours
    Do [10] [100] [1,000] [Max] times
    ```

- **Time-Based Calculation:**
  - Formula: `actionCount = Math.round((hours × 3600) / actionTime)`
  - Example: "1 hour" button calculates how many actions fit in 1 hour
  - Dynamically adjusts based on character state (gear, skills, buffs)
  - **CRITICAL:** Input box is for NUMBER OF ACTIONS (not output items)

- **Positioning:**
  - Buttons appear inside the action panel modal
  - Located directly below the queue input field
  - Organized in collapsible sections

- **React Integration:**
  - Uses React's internal `_valueTracker` for proper state updates
  - `setInputValue()` function mimics original `reactInputTriggerHack()`
  - Saves old value, sets new value, updates tracker, dispatches event
  - React recognizes the DOM value change and updates component state

- **Files:**
  - NEW: `src/features/actions/quick-input-buttons.js` (520 lines)
  - Modified: `src/main.js` (import, initialize, export to window.MWITools)

**Result:** Fast queue input with both time-based and count-based options plus real-time feedback. Click "1 hour" and see exactly how long it will take.

### Fixed

#### **Rare Find Calculation Correction**

**BUG FIX:** House room rare find bonus was incorrectly including 0.2% base bonus.

- **Previous Formula:** 0.2% base + (totalLevels × 0.2%) = 2.6% for 12 levels ❌
- **Correct Formula:** totalLevels × 0.2% = 2.4% for 12 levels ✓
- **Maximum:** 64 levels (8 rooms × 8 levels) × 0.2% = 12.8%
- **Source:** Game data and wiki documentation confirm no base bonus
- **File:** `src/utils/house-efficiency.js`

#### **Time Calculation Fixes**

**CRITICAL BUG FIX:** Total time and time-based buttons were incorrectly using efficiency in calculations.

- **Root Cause:** Misunderstood that input is for ACTIONS, not output items
- **Key Insight:** Efficiency affects OUTPUT (items per action), not TIME or action count
- **Previous Behavior:**
  - Total Time: 1 action ÷ 1.33 efficiency × 14.35s = 10s ❌
  - Time buttons: 1hr × 1.33 efficiency ÷ 14.35s = 334 actions ❌
- **Correct Behavior:**
  - Total Time: 1 action × 14.35s = 14.35s ✓
  - Time buttons: 1hr (3600s) ÷ 14.35s = 251 actions ✓
- **Example:** 100 actions at 14.35s = 1,435s total time, outputs 133 items (with 33% efficiency)
- **File:** `src/features/actions/quick-input-buttons.js`

#### **Base Output Display Fix**

**BUG FIX:** Base Output showing 0/hr due to missing price and revenue fields.

- **Issue:** baseOutputs array lacked priceEach and revenuePerHour fields
- **Fix:** Added both fields to all baseOutputs entries (processing and non-processing paths)
- **Result:** Base Output now correctly displays item breakdowns with prices
- **File:** `src/features/actions/gathering-profit.js`

#### **Level Progress Calculator Fixes**

**BUG FIXES:** Multiple issues corrected in XP calculation and display.

- **Null Drink Slots Error:**
  - **Issue:** `parseConsumableWisdom()` crashed when drink slots contained null entries
  - **Fix:** Added null check: `if (!drink || !drink.itemHrid) continue;`
  - **File:** `src/utils/experience-parser.js`

- **Backwards XP Display:**
  - **Issue:** Showing "40.1 base → 55" when it should be "55 base → 75.4"
  - **Root Cause:** XP multiplier calculated too late, dividing instead of multiplying
  - **Fix:**
    - Moved `calculateExperienceMultiplier()` before calculations
    - Changed to: `modifiedXP = baseXP × totalMultiplier`
    - Used modified XP for all downstream calculations (actions needed, XP/hour)
  - **Example:** Star Fruit with 37.1% bonus: 55 base → 75.4 modified
  - **File:** `src/features/actions/quick-input-buttons.js`

- **Progress Percentage Calculation:**
  - **Issue:** Progress calculated as `currentXP / xpForNextLevel` (total XP vs. threshold)
  - **Fix:** Changed to `(xpGainedThisLevel) / (xpNeededThisLevel)` (matches game's display)
  - **Example:** Level 50 (10,000 XP) with 12,000 current XP → 40% progress (not 80%)
  - **File:** `src/features/actions/quick-input-buttons.js`

#### **Drink Concentration Enhancement Scaling Fix**

**CRITICAL BUG FIX:** Drink Concentration was using incorrect linear scaling instead of proper enhancement multiplier table.

- **Root Cause:** Used additive per-level formula instead of multiplicative enhancement table
- **Previous Formula:** `base + (bonus × level)` - treated enhancement as linear scaling ❌
- **Correct Formula:** `base × ENHANCEMENT_MULTIPLIERS[level]` - uses proper enhancement table ✓
- **Impact:**
  - Guzzling Pouch +10: Was calculating 12.0% instead of 12.9%
  - Processing Tea: Was showing 16.8% instead of 16.94%
  - All tea effects (Efficiency, Artisan, Gourmet, Wisdom) were undervalued
- **Fix:**
  - Replaced manual enhancement calculation with `getEnhancementMultiplier()` function
  - Now uses same enhancement system as all other equipment stats
  - Proper slot multipliers applied (1× for pouch, 5× for accessories)
- **Example:** Guzzling Pouch +10 (1× slot): 10% base × 1.29 multiplier = 12.9% ✓
- **File:** `src/utils/tea-parser.js` (lines 12, 165-173)

#### **Max Button Implementation**

**NEW FEATURE:** Max button now intelligently calculates maximum queue based on action type and available materials.

- **Gathering Actions** (Foraging, Woodcutting, Milking):
  - Returns infinity symbol (`∞`) to match game's infinity button behavior
  - No material constraints, allows unlimited queuing

- **Production Actions** (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing):
  - Calculates based on available inventory materials
  - Finds bottleneck material (minimum across all required inputs)
  - **Artisan Tea Integration:** Accounts for material reduction when Artisan Tea is active
    - Uses expected value formula: `effectiveCost = baseRequirement × (1 - artisanBonus)`
    - Example: 10 materials with 11.2% Artisan → 8.88 effective cost per action
    - Accurate over many actions (probabilistic savings average out)
  - Formula: `Math.floor(available / effectiveRequirement)` for each material
  - Returns 0 if no materials available
  - **No artificial cap** - respects actual inventory quantities

- **Example:**
  ```
  Crafting "Azure Staff" (without Artisan Tea):
  - Requires: 5 Azure Lumber, 2 Branch of Insight
  - Inventory: 50 Azure Lumber, 3 Branch of Insight

  Calculation:
  - Azure Lumber: 50 / 5 = 10 possible
  - Branch of Insight: 3 / 2 = 1 possible (bottleneck)
  - Max = min(10, 1) = 1

  With 11.2% Artisan Tea:
  - Azure Lumber: 50 / (5 × 0.888) = 50 / 4.44 = 11 possible
  - Branch of Insight: 3 / (2 × 0.888) = 3 / 1.776 = 1 possible (still bottleneck)
  - Max = min(11, 1) = 1
  ```

- **Error Handling:**
  - Returns 10000 as safe fallback on calculation errors
  - Handles missing inventory data with null check
  - Uses `.find()` to search inventory array (not Map.get())
  - Skips division by zero with guard clause

- **Files Modified:**
  - `src/features/actions/quick-input-buttons.js` (lines 17, 396-399, 589-640)

**Result:** Max button provides accurate, intelligent queue sizing based on actual game state instead of arbitrary 10000 value.

### Changed

#### **Profit Display Improvements**

**UX IMPROVEMENTS:** Multiple enhancements to profit display clarity and organization.

- **Simplified Collapsed Summary:**
  - Removed revenue and costs from collapsed state
  - Shows only profit/hr and profit/day
  - More concise and easier to read at a glance

- **Net Profit Positioning:**
  - Moved from inside Detailed Breakdown to top level
  - Always visible when Profitability section expanded
  - Color-coded: green if positive, red if negative

- **Title Simplification:**
  - Changed from "Profitability (Gathering)" to just "Profitability"
  - Cleaner appearance

- **Bonus Drops Split:**
  - Separated into "Essence Drops" and "Rare Finds" subsections
  - Each shows only relevant bonus percentage
  - Essence Find % with essence drops only
  - Rare Find % with rare find drops only
  - Eliminates confusion about which bonuses affect which items

#### **Level Progress Display Simplification**

**UX IMPROVEMENTS:** Streamlined level progress display for better readability and consistency.

- **Removed Visual Progress Bar:**
  - Eliminated Unicode progress bar (████████░░░░░░░░░░░░░░░░░░░░)
  - Game already shows progress bar on side panel (no duplication needed)
  - Kept percentage text: "26.5% to Level 101"

- **Simplified Current Level Display:**
  - Combined two lines into one: "Level 100 | 26.5% to Level 101"
  - Removed XP numbers (10,371,822/11,404,976)
  - More concise and easier to scan

- **Streamlined Progress-to-Level Section:**
  - Removed horizontal separator bar (visual clutter)
  - Removed "At current rate:" header (redundant)
  - Combined XP rates into single line: "XP/hour: 18,912 | XP/day: 453,878"
  - Changed "Daily gain: 453,878 XP (0.3 levels)" to simpler "XP/day: 453,878"
  - Cleaner, more compact layout

- **Added Collapsed Summary:**
  - Shows time to next level when section collapsed
  - Format: "2.5 days to Level 51" or "45m 30s to Level 32"
  - Quick at-a-glance reference without expanding section

- **File:** `src/features/actions/quick-input-buttons.js`

## [0.4.5] - 2025-12-23

### Overview

Minor release adding queue time display to the total action time feature.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Added

#### **Queue Time Display Enhancement**

**NEW FEATURE:** Queue tooltip now shows time for each individual queued action plus total time.

- **Queue Tooltip Time Display:**
  - Shows `[time] Complete at HH:MM:SS` for each queued action
  - Cumulative completion times (each action shows when it will finish)
  - Total time at bottom of queue: `Total time: [total]`
  - Handles infinite queues with ∞ symbol
  - Auto-updates when queue changes via WebSocket

- **Implementation Details:**
  - Added to existing `action-time-display.js` module (lines 33, 58-90, 327-517)
  - Uses MutationObserver to detect queue tooltip appearance
  - Watches for `[class*="QueuedActions_queuedActionsEditMenu"]` selector
  - Reuses existing time calculation utilities (speed, efficiency)
  - Properly accounts for efficiency reducing actions needed

- **Display Format:**
  ```
  Action 1: [5m 30s] Complete at 14:35:22
  Action 2: [10m 15s] Complete at 14:45:37
  Action 3: [2h 5m] Complete at 16:50:42
  ───────────────────────────────────────────
  Total time: [2h 20m 50s]
  ```

- **Key Features:**
  - ✅ Time for each queued action
  - ✅ Cumulative completion time (HH:MM:SS format)
  - ✅ Total time at bottom of queue
  - ✅ Handles infinite queues (∞)
  - ✅ Auto-updates via WebSocket events
  - ✅ Reuses existing calculation logic

**Technical Details:**
- `initializeQueueObserver()` - MutationObserver for tooltip detection
- `injectQueueTimes()` - Calculates and injects time displays
- `calculateActionTime()` - Helper for action time calculations
- Efficiency-aware: Divides queue count by efficiency multiplier
- Matches original MWI Tools behavior from lines 4774-4850

**Files Modified:**
- `src/features/actions/action-time-display.js` (lines 1-517)
  - Added queue observer initialization
  - Added queue time calculation and injection
  - Extended module documentation

**Result:** Complete action time visibility - header shows current action, queue tooltip shows all queued actions with cumulative times.

## [0.4.4] - 2025-12-23

### Overview

Patch release fixing critical Drink Concentration (Guzzling Pouch) detection bugs.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Fixed

#### **CRITICAL: Drink Concentration Detection Fixes**

**BUG FIX:** Guzzling Pouch enhancement levels now correctly affect Drink Concentration calculations.

- **Enhancement Multiplier Bug (CRITICAL):**
  - **Previous behavior:** Drink Concentration ignored enhancement levels entirely
  - **Example:** Guzzling Pouch +0 and +10 both gave 8% (WRONG!)
  - **Root cause:** Line 51 in enhancement-config.js used `concentration * 100` without multiplier
  - **Fix:** Now applies proper enhancement scaling: `concentration * 100 * multiplier`
  - **Result:**
    - Guzzling Pouch +0: 8% × 1.00 = 8.00% ✓
    - Guzzling Pouch +10: 8% × 1.29 = 10.32% ✓
  - File: `src/utils/enhancement-config.js` lines 50-58

- **Inventory Scanning Bug (CRITICAL):**
  - **Previous behavior:** Scanned all 106 inventory items (including unequipped)
  - **Impact:** Always picked highest pouch in inventory, swapping pouches had no effect
  - **Root cause:** Used `inventory.filter()` instead of `equipment.values()`
  - **Fix:** Now only scans equipped items (like all other equipment detection)
  - **Result:** Correctly detects only the equipped pouch, updates on swap
  - File: `src/utils/enhancement-config.js` line 44

### Changed

#### **Code Cleanup: Equipment Scanning Consistency**

**REFACTOR:** Removed misleading comments and unused parameters.

- **Removed unused inventory parameter:**
  - Removed `inventory` parameter from `detectSkillGear()` (line 17)
  - Removed `inventory` parameter from `detectEnhancingGear()` (line 283)
  - Removed unused `inventory` variable from `getAutoDetectedParams()` (line 33)
  - All functions now clearly document "equipped items only"
  - File: `src/utils/enhancement-gear-detector.js`, `src/utils/enhancement-config.js`

- **Updated JSDoc comments:**
  - Changed misleading "all items including equipped" to "equipped items only"
  - Clarified that equipment map contains only equipped items
  - Consistent documentation across all equipment scanning functions

**Technical Details:**
- Added `getEnhancementMultiplier` import to enhancement-config.js
- Pouch slot uses 1× multiplier (armor slot, not accessory)
- Guzzling Pouch +8: 8% × 1.22 = 9.76%
- Guzzling Pouch +10: 8% × 1.29 = 10.32%

## [0.4.3] - 2025-12-23

### Overview

Patch release fixing enhancement calculator display issues and improving material cost formatting.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Fixed

#### **Enhancement Calculator Display Fixes**

**BUG FIX:** Enhancement calculator now only appears on the "Enhance" tab and when an item is selected.

- **Tab Detection Fix:**
  - Calculator no longer appears on "Current Action" tab
  - Uses reliable Material-UI indicators: `aria-selected`, `Mui-selected` class, and `tabindex`
  - Walks up DOM tree to find tab buttons using `button[role="tab"]` selector
  - File: `src/features/actions/panel-observer.js` lines 261-322

- **Item Selection Check:**
  - Calculator no longer appears when no item is selected (empty state)
  - Checks for item icon presence in outputs section
  - Removes existing calculator display when switching to empty state
  - File: `src/features/actions/panel-observer.js` lines 327-338

### Changed

#### **Material Cost Format Improvements**

**UX IMPROVEMENT:** Material breakdown now shows complete pricing information.

- **Material Breakdown Format:**
  - Changed from `256,249 (189.81×)` to `189.81 × 1,350 → 256,249`
  - Format: `quantity × unit price → total cost`
  - Shows all three values: how many items, price per item, total cost
  - File: `src/features/actions/enhancement-display.js` lines 257-271

- **Thousands Separators:**
  - Added `unitPrice` to breakdown object for display
  - Applied `toLocaleString()` to all quantities, unit prices, and costs
  - Handles both integer and decimal quantities with proper fraction digits
  - File: `src/features/actions/enhancement-display.js` lines 172-182, 200-206

**Technical Details:**
- Tab detection uses triple-check approach: aria-selected, CSS class, tabindex
- Material breakdown stores quantity, unit price, and total cost for each material
- Diagnostic script created for future tab detection debugging (`tab-detection-diagnostic.js`)

### Performance

**OPTIMIZATION:** Tab button caching to eliminate redundant DOM queries.

- **Tab Button Caching:**
  - Added `findCurrentActionTab()` / `getCurrentActionTabButton()` functions
  - Caches tab button reference on panel element: `panel._cachedCurrentActionTab`
  - DOM walk happens only once per panel, subsequent checks use cached reference
  - Files: `src/features/actions/enhancement-display.js` lines 545-571, `src/features/actions/panel-observer.js` lines 266-292

- **Performance Impact:**
  - Before: ~0.3ms per check (multiple DOM walks with querySelectorAll)
  - After: ~0.05ms per check (one DOM walk, then cached property access)
  - ~83% performance improvement on tab detection checks

- **Implementation:**
  - `enhancement-display.js`: Added `findCurrentActionTab()` with caching in `injectDisplay()`
  - `panel-observer.js`: Refactored to `getCurrentActionTabButton()` and updated `isEnhanceTabActive()`
  - Caching strategy preserves existing tab button reference across multiple calculations

## [0.4.2] - 2025-12-23

### Overview

Patch release implementing guzzling bonus scaling for blessed tea in the enhancement calculator.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Fixed

#### **Blessed Tea Guzzling Bonus Implementation**

**BUG FIX:** Blessed tea skip chance now correctly scales with Guzzling Pouch drink concentration.

- **Guzzling Bonus Calculation:**
  - Added `guzzlingBonus` parameter to enhancement config (1.0 + drinkConcentration / 100)
  - Guzzling level 0 (no pouch): 1.0× multiplier (no change to current behavior)
  - Guzzling Pouch +8 (12.16% concentration): 1.1216× multiplier
  - Formula: `guzzlingBonus = 1 + drinkConcentration / 100`
  - File: `src/utils/enhancement-config.js` lines 134-146

- **Blessed Tea Skip Chance Scaling:**
  - Base skip chance: 1% (hardcoded in game)
  - Scaled skip chance: `successChance × 0.01 × guzzlingBonus`
  - Remaining success chance: `successChance × (1 - 0.01 × guzzlingBonus)`
  - Example: With 1.1216× guzzling, 53.065% success becomes:
    - Skip to +2: 53.065% × 0.01 × 1.1216 = 0.595%
    - Normal +1: 53.065% × (1 - 0.01 × 1.1216) = 52.47%
  - File: `src/utils/enhancement-calculator.js` lines 118-127

- **Integration:**
  - Config detects drink concentration from Guzzling Pouch in inventory
  - Calculates guzzling bonus and passes to all calculator calls
  - Markov chain transition probabilities updated to scale blessed tea effect
  - Files: `enhancement-config.js`, `enhancement-calculator.js`, `enhancement-display.js`

**BUG FIX:** Enhancement calculator now updates when changing the item to enhance.

- **Item Change Detection:**
  - Added `href` attribute change detection on `<use>` elements (item sprite changes)
  - Removed `attributeFilter` restriction to watch ALL attribute changes
  - When item sprite `href` changes (e.g., `#celestial_enhancer` → `#azure_pickaxe`), calculator recalculates
  - Previously only watched `value` and `class` attributes, missed item selection changes
  - File: `src/features/actions/panel-observer.js` lines 104-112, 179

- **Console Cleanup:**
  - Removed 4 debug logs from enhancement panel detection
  - "Enhancement panel found but no outputs section"
  - "Could not find item name element in outputs"
  - "Could not extract item name from outputs"
  - "Could not find item HRID for: ${itemName}"

**BUG FIX:** Enhancement calculator now recalculates when equipping/unequipping gear.

- **Equipment Detection Fix:**
  - **CRITICAL:** Gear detector was scanning entire inventory (98 items) instead of only equipped items (10 slots)
  - Unequipped items in inventory were incorrectly treated as equipped
  - Now only scans equipment map which contains only equipped items
  - Removed inventory parameter scanning from `detectSkillGear()`
  - Result: Equipment changes (equip/unequip) now properly trigger recalculation
  - File: `src/utils/enhancement-gear-detector.js` lines 33-41

### Changed

#### **Display Improvements**

**UX IMPROVEMENT:** Show exact decimal attempts instead of rounded integers.

- **Attempts Display:**
  - Changed from rounded integers (13) to exact decimals (12.64)
  - Matches Enhancelator display format (2 decimal places)
  - More accurate representation of expected values
  - Example: +3 now shows "12.64" instead of "13"
  - **Added thousands separator:** 1,234.56 instead of 1234.56
  - Applied to both Attempts and Protection columns
  - File: `src/features/actions/enhancement-display.js`

**UX IMPROVEMENT:** Improved time formatting for long durations.

- **Time Display Enhancements:**
  - **>= 1 year:** "3 years 5 months 3 days"
  - **>= 1 day:** "5 days 12h 30m"
  - **< 1 day:** "1h 23m 45s" (unchanged)
  - More readable for very long enhancement times
  - Proper pluralization (1 year vs 2 years)
  - File: `src/utils/formatters.js`

**UX IMPROVEMENT:** Removed verbose console logging during normal operation.

- **Console Output Cleanup:**
  - Removed "Input changed, re-calculating enhancement stats..."
  - Removed "Protect From: +X"
  - Removed "Protection item detected: /items/..."
  - Removed "✅ Enhancement calculator displayed successfully!"
  - Error logs preserved for debugging
  - Files: `enhancement-display.js` (3 logs), `panel-observer.js` (1 log)
  - Reduces console spam during normal use

**MAJOR CLEANUP:** Removed 54 verbose console statements across all modules (~41% reduction).

- **Console Spam Elimination:**
  - Removed all initialization success messages ("✅ Module loaded", "🎉 Ready!")
  - Removed all feature status logs ("Initializing...", "Started", "Disabled")
  - Removed all WebSocket message type logs ("Received: init_character_data")
  - Removed all market fetch status logs ("Fetching...", "Using cached data")
  - **Kept all error/warning logs** (37 statements) for debugging
  - **Debug utilities commented out** (not auto-run, available manually via console)
  - **Reduction:** 132 → 78 console statements (54 removed, 41% cleanup)
  - Files: `main.js`, `websocket.js`, `data-manager.js`, `marketplace.js`, `panel-observer.js`, all tooltip/feature modules
  - Result: Clean console output during normal operation, critical errors still visible

### Performance

**OPTIMIZATION:** Removed redundant Markov chain calculations.

- **Enhancement Calculator Optimization:**
  - Removed 3 unused calculations (target10, target15, target20)
  - target15 and target20 were never used
  - target10 only used for perActionTime (simple division, doesn't need Markov chain)
  - Added `calculatePerActionTime()` helper function for simple time calculation
  - **Reduction:** 23 → 20 Markov chain calculations per render (~13% improvement)
  - Each Markov chain involves expensive 20×20 matrix operations (create, invert, multiply)
  - Files: `enhancement-calculator.js` (new helper), `enhancement-display.js` (simplified)
  - Zero functional changes - just removes waste

**OPTIMIZATION:** Cache protection item detection to eliminate redundant DOM queries.

- **Protection Item Caching:**
  - Call `getProtectionItemFromUI()` once per render instead of 21 times
  - Pass cached `protectionItemHrid` as parameter to functions
  - **Reduction:** 42 DOM queries eliminated per render (2 querySelector calls × 21 iterations)
  - DOM queries are expensive - each call traverses the entire DOM tree
  - Files: `enhancement-display.js` (function signatures, parameter passing)
  - Zero functional changes - pure performance optimization

### Technical Details

**Markov Chain Updates:**
```javascript
if (blessedTea) {
    const skipChance = successChance * 0.01 * guzzlingBonus;
    const remainingSuccess = successChance * (1 - 0.01 * guzzlingBonus);

    markov.set([i, i + 2], skipChance);
    markov.set([i, i + 1], remainingSuccess);
    markov.set([i, failureDestination], 1 - successChance);
}
```

**Accuracy:**
- Matches Enhancelator reference implementation
- Preserves exact decimal precision in attempt calculations
- Skip chance scales proportionally with drink concentration
- No change to behavior when guzzling bonus = 1.0 (backward compatible)

## [0.4.1] - 2025-12-22

### Overview

Patch release with critical bug fixes for the enhancement calculator display and equipment detection system.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Fixed

#### **Enhancement Calculator Display Improvements**

**BUG FIX:** Multiple display and calculation issues resolved in enhancement system.

- **Observatory House Room Fix:**
  - Corrected house room reference from Laboratory → Observatory
  - Laboratory is for Alchemy, Observatory is for Enhancing
  - Affects success rate calculation: +0.05% per level (max +0.4% at level 8)
  - File: `src/utils/enhancement-config.js` line 50

- **Slot-Based Equipment Display:**
  - Changed from stat-based to slot-based equipment selection
  - Now shows best item per equipment slot (Tool, Body, Legs, Hands)
  - Selection priority: Item level first, then enhancement level as tiebreaker
  - Display format: "Tool: Celestial Enhancer +10"
  - Files: `src/utils/enhancement-gear-detector.js` (complete rewrite), `src/features/actions/enhancement-display.js`

- **Removed Redundant Information:**
  - Eliminated duplicate "Expected Enhancement Costs" table
  - Removed redundant total cost calculations
  - Kept comprehensive "Costs by Enhancement Level" table (all 20 levels)
  - Simplified "Materials Per Attempt" section for quick reference
  - File: `src/features/actions/enhancement-display.js`

- **Removed Verbose Debug Logging:**
  - Cleaned up 7 verbose `[MWI Tools DEBUG]` console statements
  - Kept important logs for initialization and errors
  - Reduced console spam during normal operation
  - File: `src/features/actions/panel-observer.js`

### Technical Details

**Enhancement Gear Detection Rewrite:**
- Groups items by equipment slot (tool, body, legs, hands) instead of by stat type
- Scans all items in inventory (including equipped items)
- Returns slot objects: `{name: "Item Name", enhancementLevel: 10}`
- Accumulates bonuses from best item in each slot
- Handles enhancement multipliers correctly (1× for armor, 5× for accessories)

**Git Commits:**
- 9de3771: Fix: Enhancement system now shows slot-based equipment display
- be74488: Revert "Show all equipped enhancing items instead of just one"
- 39ce6c5: Remove redundant information from enhancement calculator display
- 95ae424: Remove verbose debug logging

## [0.3.0] - 2025-12-22

### Overview

Third pre-release version featuring comprehensive gathering profit enhancements with detailed breakdown displays for all gathering skills (Foraging, Woodcutting, Milking).

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Added

#### **Gathering Quantity Support - Full Tea & Community Buff Integration**

**NEW FEATURE:** Gathering Quantity bonus now fully implemented with detailed breakdown display.

- **Gathering Quantity Calculation:**
  - Parses Gathering Tea bonus (15% base, scales with Drink Concentration)
  - Detects Community Buff level for gathering quantity (20% base + 0.5% per level)
  - Stacks all bonuses additively (tea + community + achievements when available)
  - Formula: `avgAmount = baseAmount × (1 + totalGathering)`
  - Affects all drop quantities (increases items received per action)

- **Display Format:**
  ```
  Gathering: +46.0% quantity (15.0% tea + 31.0% community)
  ```
  - Shows total percentage with component breakdown
  - Only displays when totalGathering > 0
  - Helps players understand all sources contributing to quantity bonuses

- **Integration:**
  - New method: `parseGatheringBonus()` in tea-parser.js (lines 252-268)
  - Community buff detection via `dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity')`
  - Applied to drop table calculations in gathering-profit.js (lines 146-165, 261-263)
  - Returns breakdown components: `gatheringTea`, `communityGathering`, `totalGathering`

#### **Detailed Bonus Revenue Display - Item-by-Item Breakdown**

**UX IMPROVEMENT:** Bonus revenue now shows individual drops with complete details.

- **Enhanced Bonus Revenue Section:**
  - Shows total bonus revenue with percentages (essence find, rare find)
  - Lists each bonus drop item individually:
    - Item name
    - Drop rate (formatted to 2-3 decimal places)
    - Drops per hour (formatted to 1 decimal)
  - Format: `• Medium Meteorite Cache: 0.04% drop, ~0.7/hour`
  - Indented sub-items with smaller font (0.85em) and lower opacity (0.7)

- **Display Example:**
  ```
  Bonus revenue: 90,633/hour (2.2% rare find)
    • Medium Meteorite Cache: 0.04% drop, ~0.7/hour
  ```

#### **Processing Tea Details - Conversion Breakdown**

**UX IMPROVEMENT:** Processing Tea now shows exactly what's being converted and the value gained.

- **Enhanced Processing Section:**
  - Shows total processing revenue with conversion chance
  - Lists each conversion individually:
    - Raw item → Processed item
    - Value gain per successful proc
  - Format: `• Rainbow Milk → Rainbow Cheese: +1,358 value per proc`
  - Helps players understand which items are being converted

- **Display Example:**
  ```
  Processing: +185,555/hour (16.5% conversion)
    • Rainbow Milk → Rainbow Cheese: +1,358 value per proc
  ```

- **Technical Implementation:**
  - Tracks conversion details during calculation (lines 289-298)
  - Stores: rawItem name, processedItem name, valueGain per proc
  - Returns array: `processingConversions` for display formatting

### Changed

#### **Module Rename: foraging-profit.js → gathering-profit.js**

**BREAKING CHANGE:** Renamed module to reflect support for all gathering skills.

- **Scope Expansion:**
  - Previously: Foraging only
  - Now: Foraging, Woodcutting, Milking (all 3 gathering skills)
  - Function renamed: `calculateForagingProfit()` → `calculateGatheringProfit()`
  - Module renamed: `foraging-profit.js` → `gathering-profit.js`

- **Behavior:**
  - Same calculation logic applies to all gathering skills
  - Efficiency, speed, tea buffs work consistently across all three
  - Processing Tea conversions:
    - Foraging: 5 conversions (Cotton → Cotton Fabric, etc.)
    - Woodcutting: 7 conversions (Log → Lumber, etc.)
    - Milking: 7 conversions (Milk → Cheese, etc.)

- **Updated References:**
  - panel-observer.js: Import and function call updated
  - main.js: Import path updated
  - README.md: Documentation updated to reflect all gathering skills

### Technical Details

#### Gathering Quantity Formula
```javascript
// Parse Gathering Tea (15% base, scales with Drink Concentration)
gatheringTea = parseGatheringBonus(drinkSlots, itemDetailMap, drinkConcentration)

// Get Community Buff level (0-20)
communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity')
communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel * 0.005) : 0

// Stack additively
totalGathering = gatheringTea + communityGathering

// Apply to drop amounts
avgAmount = baseAmount × (1 + totalGathering)
```

#### Option D Display Format
```
Overall Profit: 468,476/hour, 11,243,417/day
(+46.0% efficiency: 35% level, 11.0% tea)
Bonus revenue: 90,633/hour (2.2% rare find)
  • Medium Meteorite Cache: 0.04% drop, ~0.7/hour
Processing: +185,555/hour (16.5% conversion)
  • Rainbow Milk → Rainbow Cheese: +1,358 value per proc
Gathering: +46.0% quantity (15.0% tea + 31.0% community)
```

### Files Modified

**Core:**
- `src/features/actions/gathering-profit.js` (renamed from foraging-profit.js)
  - Lines 146-165: Gathering quantity calculation
  - Lines 261-298: Processing conversion tracking with details
  - Lines 311-347: Return object with breakdown components
  - Lines 523-580: Enhanced display formatting (Option D)

**Utilities:**
- `src/utils/tea-parser.js` (lines 252-268, 277)
  - Added `parseGatheringBonus()` function
  - Added to exports

**Integration:**
- `src/features/actions/panel-observer.js` (line 12)
  - Updated import: gathering-profit.js
  - Updated function call: calculateGatheringProfit()

- `src/main.js` (line 18)
  - Updated import path

**Documentation:**
- `README.md` (lines 3, 208-228, 289)
  - Updated version badges to 0.3.0
  - Updated module name and function names
  - Added gathering quantity, processing details, bonus revenue details

**Result:** Complete transparency into all gathering profit components with detailed breakdowns for every bonus type.

## [0.2.0] - 2025-12-21

### Overview

Second pre-release version featuring Action Panel Enhancements with comprehensive Foraging profit calculator.

**Status:** Development/Testing (Version < 1.0.0 = pre-release)

### Added

#### **Action Panel Enhancements - Foraging Profit Calculator**

**NEW FEATURE:** Comprehensive profit analysis for Foraging actions with multiple drops. Automatically displays when opening Foraging action panels.

- **Action Panel Observer (`panel-observer.js`):**
  - MutationObserver detects when action panels appear
  - Filters out combat action panels (only processes skilling actions)
  - Checks for XP gain element to identify skilling vs combat
  - Automatically triggers profit calculation for eligible Foraging actions

- **Foraging Profit Calculator (`foraging-profit.js`):**
  - Calculates hourly and daily profit with full economic analysis
  - **Revenue Factors:**
    - All drop table items at market bid prices
    - Average drop amounts with drop rates
    - Market tax (2% selling fee)
    - Gourmet Tea bonus items (+12% base, scales with Drink Concentration)
  - **Cost Factors:**
    - Drink consumption (12 drinks/hour at market ask price)
  - **Efficiency Bonuses (all additive):**
    - Level advantage (+1% per level above requirement)
    - House room efficiency (+1.5% per room level)
    - Tea efficiency (Efficiency Tea, skill teas with Drink Concentration scaling)
    - Equipment efficiency (charms, accessories with enhancement scaling)
  - **Equipment Speed Bonuses:**
    - Reduces action time (not efficiency)
    - Accounts for skill-specific speed stats
  - **Essence Drops:**
    - Foraging Essence (15% base drop rate)
    - Applies Essence Find equipment bonus
    - Example: 10% Essence Find → 15% × 1.10 = 16.5% drop rate
  - **Rare Find Drops:**
    - Branch of Insight, Large Meteorite Cache, Thread of Expertise
    - Applies Rare Find bonus from equipment + house rooms
    - House rooms: +0.2% per total house room level
    - Example: 1.8% Rare Find → 0.003% × 1.018 = 0.003054%
  - **Container Pricing:**
    - Openable containers (caches) use Expected Value calculator
    - Regular items use market bid prices
  - **Display Format:**
    ```
    Overall Profit:
    1,250,000/hour, 30,000,000/day
    (+15.5% efficiency: 5% level, 4.5% house, 3.0% tea, 3.0% equip)
    Bonus revenue: 125,000/hour (10.0% essence find, 1.8% rare find)
    ```

**Technical Implementation:**
- Reuses existing utilities: equipment-parser, tea-parser, house-efficiency, expected-value-calculator
- Lazy-loads market data (no performance impact until panel opens)
- Non-invasive: Inserts display below drop table without modifying game UI
- Follows same architecture as production profit calculator

**Integration:**
- Initialized after character data loads in main.js
- Automatically active for all Foraging actions with multiple drops
- No configuration required - works out of the box

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
