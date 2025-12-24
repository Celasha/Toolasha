# MWI Tools - Refactoring Project

![Version](https://img.shields.io/badge/version-0.4.5-orange?style=flat-square) ![Status](https://img.shields.io/badge/status-pre--release-yellow?style=flat-square) ![License](https://img.shields.io/badge/license-CC--BY--NC--SA--4.0-blue?style=flat-square)

Modular, maintainable rewrite of MWITools userscript for Milky Way Idle.

## 🚀 Quick Start

### Build the userscript
```bash
npm run build
```

This creates `dist/MWITools-refactor.user.js` which you can install in Tampermonkey.

### Watch mode (auto-rebuild on changes)
```bash
npm run watch
```

### Run tests
```bash
# Test formatters
node tests/formatters.test.js

# Test storage
node tests/storage.test.js
```

## 📁 Project Structure

```
MWI Tools/
├── src/
│   ├── main.js                    # Entry point
│   ├── core/                      # Core systems
│   │   └── storage.js            ✅ EXTRACTED
│   ├── api/                       # External API integrations
│   ├── features/                  # Feature modules
│   │   ├── actions/              # Action panel enhancements
│   │   ├── combat/               # Combat statistics & DPS
│   │   ├── enhancement/          # Enhancement optimizer
│   │   ├── integration/          # Combat sim & calculator integrations
│   │   ├── market/               # Market system
│   │   ├── networth/             # Networth & build scores
│   │   └── tooltips/             # Tooltip enhancements
│   ├── ui/                        # UI components
│   └── utils/                     # Utility functions
│       └── formatters.js         ✅ EXTRACTED
├── tests/                         # Test files
│   ├── formatters.test.js        ✅ CREATED
│   └── storage.test.js           ✅ CREATED
├── dist/                          # Built userscript (gitignored)
├── MWITools-25.0.user.js         # Original monolith (reference)
├── package.json                   # NPM configuration
└── rollup.config.js              # Build configuration
```

## ✅ Completed Modules

### Core
- **storage.js** - GM_getValue/GM_setValue wrapper with clean API
  - `storage.get(key, defaultValue)` - Get value from storage
  - `storage.set(key, value)` - Set value in storage
  - `storage.getJSON(key, defaultValue)` - Get JSON object
  - `storage.setJSON(key, value)` - Set JSON object
  - `storage.has(key)` - Check if key exists
  - `storage.delete(key)` - Delete key
  - Designed for easy IndexedDB migration later

### Utils
- **formatters.js** - Number and time formatting utilities
  - `numberFormatter(num, digits)` - Format with thousand separators (1,500,000)
  - `timeReadable(sec)` - Convert seconds to readable format
  - `formatWithSeparator(num)` - Add thousand separators
  - **Note:** Changed from K/M/B abbreviations to full numbers for clarity

- **dom.js** - DOM manipulation helpers ✅
  - `waitForElement(selector)` - Wait for element to appear
  - `waitForElements(selector, minCount)` - Wait for multiple elements
  - `createStyledDiv/Span(styles, text, className)` - Create styled elements
  - `createColoredText(text, colorType)` - Create colored text spans
  - `insertBefore/After(newEl, refEl)` - Insert elements
  - `removeElements(selector)` - Remove elements by selector
  - `getOriginalText(element)` - Get text without injected content
  - `addStyles/removeStyles(css, id)` - Inject/remove CSS

- **efficiency.js** - Game mechanics calculators ✅
  - `calculateEfficiency(percent)` - Floor + modulo system
  - `calculateExpectedOutput(percent)` - Expected output with efficiency
  - `calculateActionTime(baseTime, speedPercent)` - Action time with speed buffs
  - `calculateTotalTime(actionTime, count, efficiency)` - Total time calculations
  - `calculateActionsForTarget(target, efficiency)` - Actions needed for target
  - `calculateXpPerHour(xpPerAction, actionTime)` - XP/hour calculation
  - `calculateLevelProgress(currentXp, xpNeeded)` - Level progress percentage
  - `stackAdditive/Multiplicative(...bonuses)` - Buff stacking

### Core Infrastructure
- **websocket.js** - WebSocket message interceptor ✅
  - `webSocketHook.install()` - Install hook (call before game loads)
  - `webSocketHook.on(messageType, handler)` - Register message handler
  - `webSocketHook.off(messageType, handler)` - Unregister handler
  - Intercepts all WebSocket messages from MWI game server
  - Event-driven architecture for message processing
  - Non-invasive: Returns original messages unchanged

- **data-manager.js** - Game data manager ✅
  - `dataManager.initialize()` - Load static game data
  - `dataManager.getInitClientData()` - Get all static game data
  - `dataManager.getItemDetails(hrid)` - Get item details by HRID
  - `dataManager.getActionDetails(hrid)` - Get action details by HRID
  - `dataManager.getCurrentActions()` - Get player's action queue
  - `dataManager.getEquipment()` - Get player's equipment
  - `dataManager.getSkills()` - Get player's skills
  - `dataManager.getInventory()` - Get player's inventory
  - `dataManager.on(event, handler)` - Listen to data updates
  - Uses official API: `localStorageUtil.getInitClientData()`
  - Listens to WebSocket messages for player data updates
  - Event system: `character_initialized`, `actions_updated`, `items_updated`

## 📋 Next Steps

### Phase C: Core Infrastructure ✅ COMPLETE!
- [x] `storage.js` - Storage wrapper ✅
- [x] `config.js` - Settings and constants ✅
- [x] `websocket.js` - WebSocket message hooking ✅
- [x] `data-manager.js` - Game data management ✅

**All core infrastructure is now in place!** Features can now access game data, settings, and real-time updates.

### Phase 2: Utilities ✅ COMPLETE!
- [x] `dom.js` - DOM manipulation helpers ✅
- [x] `efficiency.js` - Buff and efficiency calculators ✅

**All utilities are now in place!** DOM helpers provide UI building blocks, and Efficiency calculators implement game mechanics.

### Phase 3: Feature Modules

#### Market System ✅ COMPLETE!
- **marketplace.js** - Market price API client ✅
  - `marketAPI.fetch(forceFetch)` - Fetch market data (with caching)
  - `marketAPI.getPrice(itemHrid, enhancementLevel)` - Get item price
  - `marketAPI.getPrices(itemHrids)` - Get multiple prices
  - `marketAPI.isLoaded()` - Check if data is loaded
  - `marketAPI.getDataAge()` - Get age of cached data
  - 1-hour cache with automatic expiration
  - Falls back to expired cache on network errors
  - Error logging and recovery

- **profit-calculator.js** - Production cost and profit analysis ✅
  - `profitCalculator.calculateProfit(itemHrid)` - Calculate profit for craftable items
  - Calculates: material costs, action time, profit per item/hour
  - Accounts for: market tax (2%), level efficiency bonus, equipment speed bonuses
  - Returns comprehensive profit data including all inputs/outputs

- **equipment-parser.js** - Equipment speed bonus parser ✅
  - `parseEquipmentSpeedBonuses(equipment, actionType, itemMap)` - Parse speed bonuses
  - Maps action types to speed fields (craftingSpeed, brewingSpeed, etc.)
  - Handles enhancement scaling (+0.1 per level)
  - Sums all matching equipment bonuses

- **tooltip-prices.js** - Market prices in tooltips ✅
  - Displays ask/bid prices with thousand separators
  - Shows total prices for stacks
  - Profit analysis section with production costs, material breakdown
  - Equipment speed bonus display
  - Intelligent handling of missing market data (shows "-" for unavailable)
  - CSS scrolling + JavaScript repositioning to prevent cutoff
  - MutationObserver watches for tooltip appearance

- **tooltip-consumables.js** - Consumable stats in tooltips ✅
  - HP/MP restoration rates (per second or instant)
  - Cost efficiency (coins per HP/MP)
  - Daily maximum restoration
  - Duration display
  - Market price integration for cost calculations
  - Same tooltip overflow fix as prices

**Market Features Summary:**
- Real-time market prices from official API
- Production profit analysis with material costs
- Equipment speed calculations for accurate action times
- Smart tooltip positioning that never cuts off
- All prices use full numbers with thousand separators (not K/M/B)
- **Three pricing modes:** Conservative, Hybrid (default), Optimistic
- **Community buff detection:** Automatic T20 Production Efficiency integration
- **Artisan Tea breakdown:** Shows floor/modulo material savings mechanics

**Efficiency System Status:**
The profit calculator accounts for:
- ✅ **Phase 1 COMPLETE:** Equipment speed bonuses (skill-specific, with enhancement scaling)
- ✅ **Phase 1 COMPLETE:** Level advantage efficiency (+1% per level above requirement)
- ✅ **Phase 2 COMPLETE:** Community buff efficiency (14-19.7% based on tier 0-20) - Auto-detected via WebSocket
- ✅ **Phase 2 COMPLETE:** House room efficiency (1.5-13.5% based on level 0-8) - Auto-detected via WebSocket
- ✅ **Phase 3 COMPLETE:** Tea buff efficiency (Efficiency Tea +10%, skill teas +2-6%) - Auto-detected
- ✅ **Phase 3 COMPLETE:** Artisan Tea material reduction (10% base, scaled by Drink Concentration)
- ✅ **Phase 3 COMPLETE:** Gourmet Tea bonus items (12% base, scaled by Drink Concentration)
- ✅ **Phase 3 COMPLETE:** Action Level bonuses from teas (e.g., Artisan Tea +5)

All efficiency sources are automatically detected from character data - no manual configuration needed!

#### Action Panel Enhancements ✅ PARTIAL!
- **panel-observer.js** - Action panel detection and MutationObserver ✅
  - Detects when skill action panels appear
  - Filters out combat action panels (only enhances skilling)
  - MutationObserver watches for panel modal appearance

- **gathering-profit.js** - Comprehensive gathering profit calculator ✅
  - `calculateGatheringProfit(actionHrid)` - Calculate hourly and daily profit
  - **Supports all gathering skills:** Foraging, Woodcutting, Milking
  - Accounts for: Drop table items, market prices, drink costs, equipment speed, efficiency bonuses
  - Efficiency sources: Level advantage, house rooms, tea buffs, equipment stats
  - **Gathering Quantity:** Tea (15% base) + Community Buff (20-29.5%) with detailed breakdown
  - **Processing Tea:** 15% conversion chance with value gain per proc (raw → processed items)
  - **Gourmet Tea integration:** Bonus items for production skills (not gathering)
  - **Essence drops:** Essence drops with Essence Find equipment bonus
  - **Rare find drops:** Detailed breakdown with drop rates and items/hour
  - **Bonus revenue display:** Item-by-item breakdown with rates and revenue
  - Rare Find sources: Equipment + house rooms (combined, additive)
  - Market tax: 2% selling fee applied to all revenue
  - Returns: profitPerHour, profitPerDay, revenuePerHour, drinkCostPerHour, actionsPerHour, efficiency breakdown, bonus revenue details, gathering/processing breakdowns

**Action Panel Features Summary:**
- ✅ **Gathering profit calculator** - Comprehensive economic analysis for Foraging, Woodcutting, Milking
- ✅ **Total action time** - Current action display in header + queue tooltip with individual/cumulative times
- ✅ **Quick input buttons** - Preset buttons (10, 100, 1000, Max) for fast queue input with React _valueTracker integration
- ❌ **Level progression calculator** - Not yet implemented
- ❌ **XP per hour display** - Not yet implemented

#### Remaining Features
- [ ] Networth calculation
- [ ] Enhancement optimizer
- [ ] Combat statistics
- [ ] And more...

## 🧪 Testing

Each module has a corresponding test file in `tests/`. Run tests with:

```bash
node tests/MODULE_NAME.test.js
```

**Note**: Storage tests use mocks since `GM_getValue/GM_setValue` are only available in the userscript environment.

## 📚 Documentation

- **README.md** - This file (project overview and quick start)
- **CHANGELOG.md** - Version history and release notes
- **CONTRIBUTING.md** - Contributor guide with version management and workflow
- **PROJECT_DOCS.md** - Complete project overview and refactoring plan
- **TABLE_OF_CONTENTS.md** - Detailed function index of original code
- **EXCLUDED_FEATURES.md** - Features intentionally excluded (Chinese language support)
- **TESTING_CHECKLIST.md** - Comprehensive testing guide for all features
- **TOOLTIP_FORMAT_STANDARDS.md** - Tooltip formatting conventions

## 🔧 Development Workflow

1. **Identify module to extract** (see PROJECT_DOCS.md)
2. **Create module file** in appropriate `src/` subdirectory
3. **Write tests** in `tests/`
4. **Import in main.js** and test
5. **Build**: `npm run build`
6. **Test in browser** with Tampermonkey
7. **Commit** once verified working

## 🎯 Design Principles

- **Modularity**: Small, focused modules with clear responsibilities
- **Testability**: Pure functions where possible, dependency injection
- **Backwards Compatibility**: Use same GM storage keys as original
- **Future-Proof**: Design for IndexedDB migration, async support
- **Clean API**: Simple, intuitive interfaces

## 📝 Notes

- Original file: 6,706 lines, 466KB
- Build output: Significantly smaller and more maintainable
- All external dependencies loaded via `@require` in userscript header
- ES6 modules bundled into single IIFE for userscript compatibility
- Chinese language support removed (see EXCLUDED_FEATURES.md)

## 🎯 Goals

- ✅ Modular architecture
- ✅ Better code organization
- ✅ Easier testing
- ✅ Improved maintainability
- ⏳ Performance optimization opportunities

---

**Version:** 0.4.0 (Pre-release)
**Status:** Development/Testing
**Original Author:** bot7420
**Updated By:** Celasha and Claude
**License:** CC-BY-NC-SA-4.0

## Version Management

This project uses [Semantic Versioning](https://semver.org/):
- **0.x.x** = Pre-release/development versions (current status)
- **1.0.0** = First stable release (after production testing)
- **MAJOR.MINOR.PATCH** after 1.0.0:
  - MAJOR: Breaking changes
  - MINOR: New features (backwards compatible)
  - PATCH: Bug fixes and refactorings

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.
