# MWI Tools Refactoring Project

## Project Overview

This project aims to break apart the monolithic MWITools-25.0.user.js (~6,700 lines) into modular, maintainable, and efficient components.

**Original File:** MWITools-25.0.user.js (466KB, 6706 lines)
**Original Version:** 25.0 (last monolithic version)
**Current Version:** 0.1.0 (refactored, pre-release)
**Author:** bot7420
**Updated By:** Celasha and Claude
**License:** CC-BY-NC-SA-4.0

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Goals

1. **Modularity**: Separate concerns into distinct, reusable modules
2. **Readability**: Improve code organization and documentation
3. **Efficiency**: Optimize performance-critical sections
4. **Maintainability**: Make future updates easier to implement
5. **Testing**: Enable better unit testing capabilities

## Current Status

- [x] Initial analysis complete
- [ ] Module structure defined
- [ ] Core utilities extracted
- [ ] Feature modules separated
- [ ] Testing framework established
- [ ] Integration testing complete
- [ ] Documentation complete

## Table of Contents - Major Functional Areas

### 1. Core System & Configuration

**Lines: 1-264, 5225-5256**

- Settings management (settingsMap with 30+ options)
- Color customization (SCRIPT_COLOR_MAIN, SCRIPT_COLOR_TOOLTIP)
- Locale detection (isZH, isZHInGameSetting)
- Number formatting utilities (THOUSAND_SEPERATOR, DECIMAL_SEPERATOR)
- Settings save/read functions
- Equipment checking system

**Key Functions:**

- `saveSettings()` - Save user preferences
- `readSettings()` - Load user preferences
- `checkEquipment()` - Validate equipped items for notifications
- `notificate()` - GM_notification system for alerts

---

### 2. Data Management & WebSocket Hooking

**Lines: 2048-2448**

- WebSocket message interception
- Game data extraction and processing
- InitClientData decompression (LZ-string)
- Translation system (EN/ZH name mappings)

**Key Functions:**

- `hookWS()` - Intercepts WebSocket messages
- `handleMessage(message)` - Processes game state updates
- `decompressInitClientData(compressedData)` - LZ-string decompression
- `inverseKV(obj)` - Key-value inversion for translations
- `getItemEnNameFromZhName(zhName)` - Item name translation
- `getActionEnNameFromZhName(zhName)` - Action name translation

**Message Types Handled:**

- `init_character_data` - Player data
- `init_client_data` - Game data
- `actions_updated` - Action queue changes
- `action_completed` - Action completion
- `battle_unit_fetched` - Combat unit data
- `items_updated` - Inventory changes
- `new_battle` - Combat start
- `profile_shared` - Profile viewing
- `battle_updated` - Combat state changes

---

### 3. Market System & API Integration

**Lines: 2702-2792, 3601-3710, 4349-4503**

- Market API fetching (milkywayidle.com/game_data/marketplace.json)
- Price data validation and caching
- Market filters (level, skill requirements, location)
- Inventory sorting (by ask/bid price)

**Key Functions:**

- `fetchMarketJSON(forceFetch)` - Fetch market data with caching
- `validateMarketJsonFetch(jsonStr, isSave)` - Validate API response
- `addInvSortButton(invElem)` - Add sort buttons to inventory
- `sortItemsBy(order)` - Sort items by price
- `addMarketFilterButtons()` - Add market filter controls
- `handleMarketItemFilter(div, itemDetail)` - Apply market filters
- `getWeightedMarketPrice(marketPrices, ratio)` - Calculate weighted average price

**Market Filter Types:**

- Level range filtering
- Skill requirement filtering
- Item location filtering (inventory/equipped)

---

### 4. Networth & Build Score System

**Lines: 2448-3065, 2794-3048**

- Total networth calculation (inventory + equipment + market listings)
- Build score algorithm (by Ratatatata)
- House upgrade cost calculation
- Ability book value calculation
- Equipment value with enhancement levels
- Profile analysis for other players

**Key Functions:**

- `calculateNetworth()` - Calculate player networth
- `getSelfBuildScores(equippedNetworth)` - Calculate build scores
- `calculateAbilityScore()` - Value of learned abilities
- `calculateEquipment(profile)` - Equipment value calculation
- `calculateSkill(profile)` - Ability book value
- `getHouseFullBuildPrice(house)` - House upgrade total cost
- `showBuildScoreOnProfile(profile)` - Display on other profiles
- `getBuildScoreByProfile(profile)` - Calculate from profile data

**Score Components:**

- House Score: Battle-related room upgrades
- Ability Score: Combat ability books (in millions)
- Equipment Score: Current equipment value (in millions)

---

### 5. Action Panel Enhancements

**Lines: 3757-4021, 3066-3121**

- Total action time display
- Quick input buttons (50, 100, 500, 1k, 10k, 100k, 1m, ∞)
- Experience per hour calculation
- Skill level progression calculator
- Efficiency buff integration

**Key Functions:**

- `handleActionPanel(panel)` - Main action panel handler
- `calculateTotalTime()` - Calculate total action time
- `showTotalActionTime()` - Display in top-left corner
- `getTotalEffiPercentage(actionHrid)` - Calculate total efficiency
- `getTotalTimeStr(input, duration, effBuff)` - Format time string
- `reactInputTriggerHack(inputElem, value)` - Trigger React onChange

**Features:**

- Estimated completion time
- Actions needed to reach target level
- XP/hour display
- Quick input number buttons

---

### 6. Tooltip System

**Lines: 3122-3560**

- Enhanced item tooltips
- Market price display on hover
- Enhancement cost information
- Consumable effect calculations
- Production profit calculations

**Key Functions:**

- `tooltipObserver` - MutationObserver for tooltips
- `handleTooltipItem(tooltip)` - Process item tooltips
- `getToolsSpeedBuffByActionHrid(actionHrid)` - Tool speed bonuses
- `getItemEffiBuffByActionHrid(actionHrid)` - Item efficiency bonuses
- `getHousesEffBuffByActionHrid(actionHrid)` - House efficiency bonuses
- `getTeaBuffsByActionHrid(actionHrid)` - Tea buff calculations
- `fixOverflow(tooltip)` - Ensure tooltip visibility

**Tooltip Enhancements:**

- Market prices (ask/bid)
- Enhancement level with costs
- Consumable buffs and duration
- Production material costs
- Hourly profit/loss calculations
- Efficiency calculations

---

### 7. Enhancement System & Optimization

**Lines: 4927-5165, 5057-5225**

- Enhancement cost calculation
- Best enhancement strategy finder (Enhancelate algorithm)
- Markov chain analysis for success rates
- Material and protection cost optimization
- Base item production cost calculation

**Key Functions:**

- `findBestEnhanceStrat(input_data)` - Find optimal enhancement path
- `Enhancelate(input_data, protect_at)` - Markov chain simulation
- `getCosts(hrid, price_data)` - Calculate enhancement material costs
- `getRealisticBaseItemPrice(hrid, price_data)` - Base item pricing
- `getItemMarketPrice(hrid, price_data)` - Market price lookup
- `getBaseItemProductionCost(itemName, price_data)` - Crafting cost
- `handleItemTooltipWithEnhancementLevel(tooltip)` - Enhancement tooltip

**Features:**

- Optimal protection item usage
- Total cost calculation (materials + time)
- Success rate analysis
- Tea buff integration (Blessed Tea)
- Action time per enhancement

**Customizable Parameters (input_data):**

- `enhancing_level` - Player Enhancing skill level
- `laboratory_level` - House room level
- `enhancer_bonus` - Tool bonus percentage
- `glove_bonus` - Glove speed bonus
- `tea_enhancing` - Enhancing Tea buff
- `tea_blessed` - Blessed Tea buff

---

### 8. Combat Statistics & DPS Tracking

**Lines: 5380-5808**

- Real-time DPS calculation per player
- Hit chance tables vs each monster
- Damage breakdown by source (abilities, auto-attacks)
- Draggable statistics panel
- Chart.js visualization
- Player aura skill detection

**Key Functions:**

- `getStatisticsDom()` - Create DPS panel DOM
- `updateStatisticsPanel()` - Update combat statistics
- `calculateHitChance(accuracy, evasion)` - Hit chance formula
- Event listeners for panel dragging (mouse/touch)

**Features:**

- Real-time DPS per player with color-coded bars
- Damage breakdown (auto-attack vs abilities)
- Hit chance % vs each enemy (by combat style)
- Enemy HP display
- Player aura skill highlighting
- Draggable/collapsible panel
- Chart.js pie chart visualization

**Data Tracked:**

- `monstersHP` - Current monster HP
- `damageByPlayer` - Total damage per player
- `damageByAttackType` - Auto vs ability damage
- `abilityDamageByPlayer` - Per-ability damage tracking
- Monster evasion ratings by combat style

---

### 9. Battle Summary & Loot Tracking

**Lines: 4118-4270**

- Combat encounter summaries
- Loot tracking with drop rates
- Combat time and kill count
- Average income per encounter
- Average experience per encounter

**Key Functions:**

- `handleBattleSummary(message)` - Process battle results
- Display in collapsible panel below combat zone

**Summary Components:**

- Total combat time
- Number of encounters/kills
- Loot obtained with quantities
- Coins earned (ask/bid prices)
- Experience gained per skill
- Averages per encounter

---

### 10. Combat Simulator Integration

**Lines: 5810-6308**

- Data export for combat simulators (Amvoidguy, Shykai)
- Group export functionality
- Character profile construction
- Equipment/food/drink/ability export
- House room integration
- Profile storage and retrieval

**Key Functions:**

- `addImportButtonForAmvoidguy()` - Add import button to simulator
- `importDataForAmvoidguy(button)` - Import player data
- `constructGroupExportObj()` - Export party data
- `constructSelfPlayerExportObjFromInitCharacterData()` - Self export
- `constructPlayerExportObjFromStoredProfile()` - Profile export
- `observeResultsForAmvoidguy()` - Monitor simulation results
- `handleResultForAmvoidguy()` - Process simulation output

**Export Data:**

- Player levels (all skills)
- Equipment with enhancement levels
- Food/drink slots
- Ability loadouts and levels
- Ability triggers
- House room bonuses
- Community buffs

---

### 11. Mooneycalc Integration

**Lines: 6308-6706**

- XP calculator integration
- Skill level projection
- Multi-skill XP calculation
- Days-until-level estimation
- Real-time XP rate tracking

**Key Functions:**

- `addImportButtonForMooneycalc()` - Add import button
- `calculateAfterDays()` - Project levels after X days
- `calculateTill()` - Calculate days to target level
- Import player skill levels and XP rates

---

### 12. UI Enhancements

**Lines: 4271-4349, 4504-4558, 4558-4675, 4675-4761**

- Item level display on icons
- Task card monitoring
- Combat map indexing
- Item dictionary enhancements
- Ability book calculator
- Navigation shortcuts

**Key Functions:**

- `addItemLevels()` - Show item level on icons
- `handleTaskCard()` - Task monitoring display
- `addIndexToMaps()` - Add map indices
- `handleItemDict(panel)` - Item dictionary calculator
- `add3rdPartyLinks()` - Add external tool links
- `handleMarketNewOrder(node)` - Market order notifications

---

### 13. Action Queue Management

**Lines: 4761-4853**

- Action queue time calculation
- Multi-action planning
- Efficiency integration
- Queue completion estimates

**Key Functions:**

- `handleActionQueueMenue(added)` - Monitor queue changes
- `handleActionQueueMenueCalculateTime(added)` - Calculate queue time

---

### 14. Utility Functions

**Lines: 3099-3121, 3710-3752, 4062-4083, 4840-4853**

- Number formatting with localization
- Time formatting (seconds to readable)
- Text extraction from DOM elements
- React input manipulation

**Key Functions:**

- `numberFormatter(num, digits)` - Format large numbers (K/M/B)
- `timeReadable(sec)` - Convert seconds to HH:MM:SS
- `getOriTextFromElement(elem)` - Extract original text
- `getActionHridFromItemName(name)` - HRID lookup

---

## Technical Architecture

### Dependencies

- **mathjs** (v12.4.2) - Matrix operations for Enhancelate
- **Chart.js** (v3.7.0) - DPS visualization
- **chartjs-plugin-datalabels** (v2.0.0) - Chart labels
- **lz-string** (v1.5.0) - Data decompression

### Browser APIs Used

- **GM_addStyle** - Custom CSS injection
- **GM.xmlHttpRequest** / **GM_xmlhttpRequest** - Market API fetching
- **GM_notification** - Desktop notifications
- **IndexedDB** - Persistent storage (async with debounced writes)
- **MutationObserver** - DOM change monitoring
- **WebSocket** - Game communication interception

### Key Data Structures

**Global Variables:**

- `initData_actionDetailMap` - All game actions
- `initData_itemDetailMap` - All items
- `initData_characterData` - Player data
- `initData_clientData` - Full game data
- `initData_characterItems` - Inventory
- `initData_characterSkills` - Skill levels
- `marketAPIJson` - Market price data
- `currentActionsHridList` - Active actions
- `currentEquipmentMap` - Equipped items

**Storage Keys:**

- `profile_export_list` - Stored player profiles
- `script_dpsPanel_isExpanded` - UI state
- `script_settings` - User preferences
- Market data with timestamps

---

## Module Breakdown Plan

### Proposed Module Structure

```
mwi-tools/
├── core/
│   ├── config.js           # Settings, constants, localization
│   ├── websocket.js        # WebSocket hooking and message handling
│   ├── data-manager.js     # Game data storage and access
│   ├── dom-observer.js     # Centralized MutationObserver system
│   └── storage.js          # IndexedDB wrapper with debounced writes
│
├── api/
│   ├── market-api.js       # Market data fetching and caching
│   └── validators.js       # API response validation
│
├── features/
│   ├── networth/
│   │   ├── calculator.js   # Networth calculation
│   │   ├── build-score.js  # Build score system
│   │   └── ui.js           # Networth display components
│   │
│   ├── actions/
│   │   ├── panel.js        # Action panel enhancements
│   │   ├── calculator.js   # Time/XP calculations
│   │   └── quick-inputs.js # Quick input buttons
│   │
│   ├── enhancement/
│   │   ├── enhancelate.js  # Markov chain algorithm
│   │   ├── calculator.js   # Cost calculations
│   │   └── optimizer.js    # Best strategy finder
│   │
│   ├── combat/
│   │   ├── statistics.js   # DPS tracking
│   │   ├── summary.js      # Battle summaries
│   │   └── hit-chance.js   # Accuracy calculations
│   │
│   ├── market/
│   │   ├── filters.js      # Market filtering
│   │   ├── sorting.js      # Inventory sorting
│   │   └── ui.js           # Market UI enhancements
│   │
│   ├── tooltips/
│   │   ├── observer.js     # Tooltip MutationObserver
│   │   ├── item.js         # Item tooltip handler
│   │   └── calculations.js # Tooltip calculations
│   │
│   └── integration/
│       ├── combat-sim.js   # Combat simulator export
│       └── mooneycalc.js   # XP calculator integration
│
├── utils/
│   ├── formatters.js       # Number/time formatting
│   ├── translations.js     # EN/ZH mappings
│   ├── dom.js              # DOM manipulation helpers
│   └── efficiency.js       # Buff/efficiency calculations
│
├── ui/
│   ├── components/         # Reusable UI components
│   ├── observers/          # MutationObserver instances
│   └── styles.js           # GM_addStyle injection
│
└── main.js                 # Entry point, module initialization
```

---

## Refactoring Priorities

### Phase 1: Core Infrastructure

1. Extract configuration and settings system
2. Separate WebSocket hooking logic
3. Create data manager for game state
4. Build IndexedDB storage wrapper with async operations

### Phase 2: Utility Separation

1. Number/time formatters
2. Translation system
3. DOM helpers
4. Efficiency calculators

### Phase 3: Feature Modules

1. Market system (API + UI)
2. Networth/build score
3. Action panel enhancements
4. Tooltip system

### Phase 4: Complex Systems

1. Enhancement optimizer (Enhancelate)
2. Combat statistics
3. Combat simulator integration
4. Battle summaries

### Phase 5: Polish & Testing

1. UI components consolidation
2. Performance optimization
3. Unit tests
4. Integration tests
5. Documentation

---

## Performance Considerations

### Current Bottlenecks

1. **Tooltip Observer** - Fires on every tooltip (use debouncing)
2. **Market API Fetching** - 10-minute cache, but could be optimized
3. **Enhancement Calculations** - Matrix operations are expensive
4. **Real-time DPS Tracking** - Updates every battle message

### Optimization Opportunities

1. Lazy-load heavy modules (Chart.js, mathjs)
2. Debounce tooltip calculations
3. Cache enhancement strategy results
4. Use Web Workers for heavy calculations
5. Minimize DOM queries with cached selectors

---

## Testing Strategy

### Unit Tests

- Utility functions (formatters, calculators)
- Enhancement algorithm
- Market price calculations
- Efficiency calculations

### Integration Tests

- WebSocket message handling
- Market API integration
- Tooltip system
- Combat statistics

### E2E Tests

- Full user workflow scenarios
- Settings persistence
- Multi-feature interactions

---

## Documentation Requirements

Each module should include:

1. Purpose and scope
2. Dependencies
3. Public API documentation
4. Example usage
5. Known limitations
6. Performance notes

---

## Migration Plan

1. **Create new repository structure**
2. **Extract one module at a time**
3. **Test in isolation**
4. **Integrate with main script**
5. **Verify functionality**
6. **Remove from monolith**
7. **Repeat**

---

## References

- Original script: <https://greasyfork.org/scripts/494467>
- Enhancelate algorithm: <https://doh-nuts.github.io/Enhancelator/>
- Build score: Ratatatata (<https://greasyfork.org/scripts/511240>)
- Combat statistics: ponchain, Stella, Truth_Light
- Group export: Ratatatata (<https://greasyfork.org/scripts/507255>)

---

**Last Updated:** 2025-12-20
**Document Version:** 1.0
