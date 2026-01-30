# MWI Tools - Original Code Index

> **Note:** This is a historical reference document from the original MWITools-25.0 codebase. It is kept for reference during refactoring but does not reflect the current Toolasha architecture.

## Quick Reference Guide

This document provides a detailed breakdown of all major functions in MWITools-25.0.user.js for refactoring reference.

---

## 1. Core System & Configuration (Lines 1-264, 5225-5256)

### Settings & Configuration

| Function           | Lines     | Description                             |
| ------------------ | --------- | --------------------------------------- |
| `saveSettings()`   | 5225-5230 | Save user settings to IndexedDB (async) |
| `readSettings()`   | 5232-5245 | Load settings from IndexedDB (async)    |
| `checkEquipment()` | 5256-5305 | Check for specific equipped items       |
| `notificate()`     | 5317-5352 | Send GM notifications                   |

### Settings Object (settingsMap)

30+ configurable options including:

- `useOrangeAsMainColor` - Color theme
- `totalActionTime` - Top-left time display
- `actionPanel_totalTime` - Action panel time/XP
- `actionPanel_quickInputs` - Quick number buttons
- `showMarketPrices` - Tooltip market prices
- `showEnhancementCost` - Enhancement calculations
- `showCombatSummary` - Battle summaries
- `showDPSPanel` - Real-time DPS tracking
- And 20+ more toggles...

---

## 2. Data Management & WebSocket (Lines 2048-2448)

### Translation & Name Mapping

| Function                            | Lines     | Description                               |
| ----------------------------------- | --------- | ----------------------------------------- |
| `inverseKV(obj)`                    | 2048-2058 | Invert key-value pairs for lookups        |
| `getItemEnNameFromZhName(zhName)`   | 2060-2072 | Translate Chinese item names to English   |
| `getActionEnNameFromZhName(zhName)` | 2074-2086 | Translate Chinese action names to English |
| `getOthersFromZhName(zhName)`       | 2088-2102 | Translate other Chinese terms             |

### WebSocket & Data Processing

| Function                                   | Lines     | Description                    |
| ------------------------------------------ | --------- | ------------------------------ |
| `decompressInitClientData(compressedData)` | 2104-2160 | Decompress LZ-string game data |
| `hookWS()`                                 | 2162-2187 | Intercept WebSocket messages   |
| `handleMessage(message)`                   | 2189-2446 | Process all game message types |

### Message Types Handled

- **init_character_data** (Line 2191) - Player data
- **init_client_data** (Line 2230) - Full game data
- **actions_updated** (Line 2243) - Action queue changes
- **action_completed** (Line 2275) - Action finish
- **battle_unit_fetched** (Line 2284) - Combat unit data
- **items_updated** (Line 2288) - Inventory updates
- **new_battle** (Line 2301) - Combat start
- **profile_shared** (Line 2346) - Profile viewing
- **battle_updated** (Line 2380) - Combat state

---

## 3. Market System (Lines 2702-2792, 3601-3710, 4349-4503)

### Market API

| Function                                      | Lines     | Description                                |
| --------------------------------------------- | --------- | ------------------------------------------ |
| `fetchMarketJSON(forceFetch)`                 | 3601-3696 | Fetch market data with caching             |
| `validateMarketJsonFetch(jsonStr, isSave)`    | 3561-3599 | Validate API response                      |
| `getWeightedMarketPrice(marketPrices, ratio)` | 2848-2860 | Calculate weighted average (default 50/50) |
| `getItemMarketPrice(hrid, price_data)`        | 5142-5163 | Get market price for specific item         |

### Inventory & Sorting

| Function                    | Lines     | Description                     |
| --------------------------- | --------- | ------------------------------- |
| `addInvSortButton(invElem)` | 2702-2791 | Add sort buttons to inventory   |
| `sortItemsBy(order)`        | 2739-2789 | Sort by "ask", "bid", or "none" |

### Market Filters

| Function                                  | Lines     | Description                   |
| ----------------------------------------- | --------- | ----------------------------- |
| `addMarketFilterButtons()`                | 4349-4460 | Add filter controls to market |
| `handleMarketItemFilter(div, itemDetail)` | 4461-4502 | Apply filtering logic         |

**Filter Options:**

- Level range (from/to)
- Skill requirements (Melee/Ranged/Magic/Others/All)
- Item location (All/Inventory/Equipped)

---

## 4. Networth & Build Score (Lines 2448-3065)

### Networth Calculation

| Function                       | Lines     | Description                     |
| ------------------------------ | --------- | ------------------------------- |
| `calculateNetworth()`          | 2448-2633 | Calculate total player networth |
| `addInventorySummery(invElem)` | 2537-2625 | Display networth summary UI     |

**Networth Components:**

- Equipped items (with enhancement)
- Inventory items
- Market listings (buy/sell orders)
- Unclaimed market coins

### Build Score System

| Function                               | Lines     | Description                         |
| -------------------------------------- | --------- | ----------------------------------- |
| `getSelfBuildScores(equippedNetworth)` | 2794-2822 | Calculate self build scores         |
| `getBuildScoreByProfile(profile)`      | 2943-2978 | Calculate from other player profile |
| `showBuildScoreOnProfile(profile)`     | 2909-2941 | Display build score on profiles     |

### Score Components

| Function                        | Lines     | Description                   |
| ------------------------------- | --------- | ----------------------------- |
| `getHouseFullBuildPrice(house)` | 2824-2846 | Calculate house upgrade costs |
| `calculateAbilityScore()`       | 2862-2897 | Value of learned abilities    |
| `calculateEquipment(profile)`   | 3016-3048 | Equipment value calculation   |
| `calculateSkill(profile)`       | 2980-3013 | Ability book value            |

**Build Score Formula:**

- House Score: Battle room upgrade costs (in coins)
- Ability Score: Combat ability books (in millions)
- Equipment Score: Current equipment value (in millions)

---

## 5. Action Panel (Lines 3066-4021, 3757-3940)

### Time & Display

| Function                                    | Lines     | Description                         |
| ------------------------------------------- | --------- | ----------------------------------- |
| `calculateTotalTime()`                      | 3066-3097 | Calculate current action total time |
| `showTotalActionTime()`                     | 3051-3064 | Display in top-left corner          |
| `timeReadable(sec)`                         | 3099-3120 | Convert seconds to HH:MM:SS         |
| `getTotalTimeStr(input, duration, effBuff)` | 4062-4069 | Format time with efficiency         |

### Action Panel Enhancements

| Function                                  | Lines     | Description                   |
| ----------------------------------------- | --------- | ----------------------------- |
| `handleActionPanel(panel)`                | 3775-4020 | Main action panel handler     |
| `reactInputTriggerHack(inputElem, value)` | 4071-4082 | Trigger React onChange events |
| `calculateNeedToLevel()`                  | 3883-3922 | Actions needed to reach level |

**Features Added:**

- Total action time display
- Quick input buttons (50, 100, 500, 1K, 10K, 100K, 1M, ∞)
- XP/hour calculation
- Actions until target level
- Foraging total profit

### Efficiency Calculations

| Function                                    | Lines     | Description                  |
| ------------------------------------------- | --------- | ---------------------------- |
| `getTotalEffiPercentage(actionHrid, debug)` | 4022-4061 | Calculate total efficiency % |
| `getToolsSpeedBuffByActionHrid(actionHrid)` | 3185-3196 | Tool speed bonuses           |
| `getItemEffiBuffByActionHrid(actionHrid)`   | 3198-3230 | Item efficiency bonuses      |
| `getHousesEffBuffByActionHrid(actionHrid)`  | 3232-3242 | House efficiency bonuses     |
| `getTeaBuffsByActionHrid(actionHrid)`       | 3244-3282 | Tea buff calculations        |

**Efficiency Sources:**

- Level advantage (over requirement)
- House room bonuses
- Tea buffs (Efficiency Tea, skill teas)
- Special equipment (Red Chef's Hat, Eye Watch, etc.)

---

## 6. Tooltip System (Lines 3122-3560)

### Tooltip Observer

| Function                     | Lines     | Description                       |
| ---------------------------- | --------- | --------------------------------- |
| `tooltipObserver`            | 3122-3182 | MutationObserver for all tooltips |
| `handleTooltipItem(tooltip)` | 3284-3544 | Process item tooltips             |
| `fixOverflow(tooltip)`       | 3547-3558 | Ensure tooltip stays in viewport  |

### Tooltip Enhancements

**Market Prices** (Lines 3315-3329)

- Ask/bid prices with color coding
- Enhanced item level display

**Consumable Effects** (Lines 3331-3355)

- HP/MP restoration calculations
- Buff durations with Guzzling Pouch

**Production Costs** (Lines 3357-3543)

- Material costs (with Artisan Tea reduction)
- Hourly profit calculations
- Efficiency buff integration
- Drink consumption costs

---

## 7. Enhancement System (Lines 4927-5225)

### Enhancement Algorithm (Enhancelate)

| Function                                         | Lines     | Description                   |
| ------------------------------------------------ | --------- | ----------------------------- |
| `findBestEnhanceStrat(input_data)`               | 4927-4956 | Find optimal enhancement path |
| `Enhancelate(input_data, protect_at)`            | 4958-5036 | Markov chain simulation       |
| `handleItemTooltipWithEnhancementLevel(tooltip)` | 4853-4925 | Display enhancement info      |

**Enhancelate Algorithm:**

- Uses Markov chain matrix analysis
- Calculates expected attempts
- Determines optimal protection usage
- Factors in success rates per level
- Considers tea buffs (Enhancing Tea, Blessed Tea)

### Cost Calculations

| Function                                          | Lines     | Description                          |
| ------------------------------------------------- | --------- | ------------------------------------ |
| `getCosts(hrid, price_data)`                      | 5057-5101 | Calculate enhancement material costs |
| `getRealisticBaseItemPrice(hrid, price_data)`     | 5103-5140 | Base item pricing strategy           |
| `getBaseItemProductionCost(itemName, price_data)` | 5165-5223 | Crafting cost calculation            |

**Cost Components:**

- Base item cost (market or production)
- Protection items
- Enhancement materials
- Action time (speed buffs considered)

### Customizable Parameters (input_data, Lines 5040-5055)

```javascript
{
    item_hrid: null,
    stop_at: null,
    enhancing_level: 125,      // Player skill level
    laboratory_level: 6,        // House room level
    enhancer_bonus: 5.42,       // Tool bonus %
    glove_bonus: 12.9,          // Speed bonus %
    tea_enhancing: false,       // Enhancing Tea buff
    tea_blessed: false,         // Blessed Tea buff
    protect_at: 15,             // Start protection at +X
    use_protection: true        // Use protection items
}
```

---

## 8. Combat Statistics (Lines 5380-5808)

### DPS Panel

| Function                                | Lines     | Description                                                      |
| --------------------------------------- | --------- | ---------------------------------------------------------------- |
| `getStatisticsDom()`                    | 5418-5562 | Create DPS panel DOM structure                                   |
| `updateStatisticsPanel()`               | 5650-5807 | Update combat statistics                                         |
| `calculateHitChance(accuracy, evasion)` | 5413-5416 | Hit chance formula (accuracy^1.4 / (accuracy^1.4 + evasion^1.4)) |

**Features:**

- Real-time DPS per player
- Color-coded damage bars
- Damage breakdown (auto-attack vs abilities)
- Hit chance tables (per combat style vs each monster)
- Enemy HP display
- Player aura skill highlighting
- Draggable panel (mouse & touch)
- Chart.js pie chart visualization

**Data Tracked:**

- `monstersHP` - Current monster HP
- `damageByPlayer` - Total damage per player
- `damageByAttackType` - Auto vs ability damage
- `abilityDamageByPlayer` - Damage per ability per player
- Monster evasion ratings (Stab/Slash/Smash/Ranged/Magic)

---

## 9. Battle Summary (Lines 4118-4270)

### Battle Tracking

| Function                       | Lines     | Description               |
| ------------------------------ | --------- | ------------------------- |
| `handleBattleSummary(message)` | 4118-4269 | Process battle completion |

**Summary Display:**

- Combat duration
- Number of encounters/kills
- Loot obtained (with quantities)
- Total coins earned (ask/bid pricing)
- Experience gained (per skill)
- Average income per encounter
- Average XP per encounter

---

## 10. Combat Simulator Integration (Lines 5810-6308)

### Data Export

| Function                                              | Lines     | Description                     |
| ----------------------------------------------------- | --------- | ------------------------------- |
| `addImportButtonForAmvoidguy()`                       | 5810-5835 | Add import button to simulator  |
| `importDataForAmvoidguy(button)`                      | 5837-5902 | Import player data to simulator |
| `constructGroupExportObj()`                           | 5904-5981 | Export party/group data         |
| `constructSelfPlayerExportObjFromInitCharacterData()` | 5983-6096 | Export self player data         |
| `constructPlayerExportObjFromStoredProfile()`         | 6098-6306 | Export from stored profile      |
| `observeResultsForAmvoidguy()`                        | 6308-6339 | Monitor simulation results      |
| `handleResultForAmvoidguy()`                          | 6341-6454 | Process simulation output       |

**Export Data Includes:**

- Player skill levels (all combat + support skills)
- Equipment with enhancement levels
- Food/drink slots configuration
- Ability loadouts with levels
- Ability trigger mappings
- House room bonuses
- Community buff levels

**Supported Simulators:**

- Amvoidguy's simulator (<https://amvoidguy.github.io/MWICombatSimulatorTest/>)
- Shykai's simulator (<https://shykai.github.io/MWICombatSimulatorTest/dist/>)

---

## 11. Mooneycalc Integration (Lines 6456-6706)

### XP Calculator

| Function                         | Lines     | Description                    |
| -------------------------------- | --------- | ------------------------------ |
| `addImportButtonForMooneycalc()` | 6564-6650 | Add import button              |
| `calculateAfterDays()`           | 6493-6529 | Project levels after X days    |
| `calculateTill()`                | 6531-6562 | Calculate days to target level |

**Features:**

- Import current skill levels
- Import XP/hour rates
- Multi-skill progression calculation
- Days-until-target-level estimation
- Real-time XP rate tracking from current actions

---

## 12. UI Enhancements (Lines 4271-4761)

### Visual Improvements

| Function             | Lines     | Description                 |
| -------------------- | --------- | --------------------------- |
| `addItemLevels()`    | 4271-4347 | Display item level on icons |
| `handleTaskCard()`   | 4504-4557 | Task monitoring display     |
| `addIndexToMaps()`   | 4558-4573 | Add combat map indices      |
| `add3rdPartyLinks()` | 4675-4759 | Add external tool links     |

### Item Dictionary

| Function                | Lines     | Description              |
| ----------------------- | --------- | ------------------------ |
| `handleItemDict(panel)` | 4596-4673 | Ability book calculator  |
| `getNeedBooksToLevel()` | 4627-4661 | Books needed calculation |

**Item Dictionary Features:**

- Current ability level display
- Books needed to reach target level
- Total book count calculation
- Quick target level input

---

## 13. Action Queue (Lines 4761-4853)

### Queue Management

| Function                                     | Lines     | Description                    |
| -------------------------------------------- | --------- | ------------------------------ |
| `handleActionQueueMenue(added)`              | 4761-4772 | Monitor queue changes          |
| `handleActionQueueMenueCalculateTime(added)` | 4774-4838 | Calculate total queue time     |
| `getOriTextFromElement(elem)`                | 4840-4851 | Extract original text from DOM |

**Features:**

- Total queue time display
- Efficiency integration
- Multi-action time calculation
- Queue completion estimates

---

## 14. Market Orders (Lines 5333-5378)

### Order Notifications

| Function                     | Lines     | Description               |
| ---------------------------- | --------- | ------------------------- |
| `handleMarketNewOrder(node)` | 5355-5378 | Process new market orders |

---

## 15. Utility Functions

### Number & Text Formatting

| Function                          | Lines     | Description                      |
| --------------------------------- | --------- | -------------------------------- |
| `numberFormatter(num, digits)`    | 3710-3725 | Format numbers (K/M/B suffixes)  |
| `timeReadable(sec)`               | 3099-3120 | Convert seconds to HH:MM:SS      |
| `getActionHridFromItemName(name)` | 3733-3751 | Convert item name to action HRID |

### Observer Helpers

| Function                     | Lines     | Description                |
| ---------------------------- | --------- | -------------------------- |
| `waitForActionPanelParent()` | 3753-3773 | Wait for action panel load |
| `waitForProgressBar()`       | 4084-4116 | Wait for progress bar      |
| `waitForItemDict()`          | 4574-4594 | Wait for item dictionary   |
| `waitForSetttins()`          | 5188-5223 | Wait for settings menu     |
| `waitForMarketOrders()`      | 5333-5353 | Wait for market orders     |

---

## Global Data Structures

### Key Variables

| Variable                       | Description           |
| ------------------------------ | --------------------- |
| `initData_actionDetailMap`     | All game actions      |
| `initData_itemDetailMap`       | All items             |
| `initData_characterData`       | Player character data |
| `initData_clientData`          | Full game data        |
| `initData_characterItems`      | Inventory items       |
| `initData_characterSkills`     | Skill levels          |
| `initData_characterAbilities`  | Learned abilities     |
| `initData_characterHouseRooms` | House rooms           |
| `currentActionsHridList`       | Current action queue  |
| `currentEquipmentMap`          | Equipped items        |
| `marketAPIJson`                | Cached market data    |

### Combat Tracking

| Variable                | Description                     |
| ----------------------- | ------------------------------- |
| `monstersHP`            | Array of current monster HP     |
| `damageByPlayer`        | Total damage per player         |
| `damageByAttackType`    | Damage by source (auto/ability) |
| `abilityDamageByPlayer` | Damage per ability per player   |

---

## Dependencies

### External Libraries

- **mathjs** v12.4.2 - Matrix operations for Enhancelate
- **Chart.js** v3.7.0 - DPS visualization
- **chartjs-plugin-datalabels** v2.0.0 - Chart labels
- **lz-string** v1.5.0 - Data decompression

### Greasemonkey APIs

- `GM_addStyle` - CSS injection
- `GM.xmlHttpRequest` / `GM_xmlhttpRequest` - HTTP requests
- `GM_notification` - Desktop notifications
- `IndexedDB` - Persistent storage (async with debounced writes)

---

## Attribution

### Code Contributors

- **bot7420** - Main author
- **Stella** - Networth summary, chart visualization
- **ponchain** - Damage statistics
- **Truth_Light** - Player avatar numbers
- **Ratatatata** - Build score algorithm, group export
- **daluo** - Market sorting contributions

### External Resources

- Enhancelate algorithm: <https://doh-nuts.github.io/Enhancelator/>
- Build score system: <https://greasyfork.org/scripts/511240>
- Group export: <https://greasyfork.org/scripts/507255>

---

**Document Version:** 1.0
**Last Updated:** 2025-12-20
