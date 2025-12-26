# MWI Tools - Session Context

**Last Updated:** 2025-12-25

## === LAST SESSION ===

**Alchemy Item Dimming Implementation**
- Implemented item dimming for alchemy selector based on player Alchemy level
- Compares player level to itemLevel requirement (not equipment level)
- Visual: 0.5 opacity, items remain clickable for tooltips
- MutationObserver detects ItemSelector dropdown (MuiTooltip)
- WeakSet tracking prevents duplicate processing
- Config setting: alchemyItemDimming (default: true)
- Fixed initial implementation: Changed from modal detection to ItemSelector_menu class
- Cleaned up all debug console.log statements
- Files:
  - NEW: `src/features/ui/alchemy-item-dimming.js` (168 lines)
  - Modified: `src/core/config.js` (added alchemyItemDimming setting)
  - Modified: `src/main.js` (import, initialization, export)
  - Updated: `CHANGELOG.md` (documented feature)
- Status: Complete, built successfully, committed to git (3b7ca86)

## === NEXT PRIORITY ===

Test alchemy item dimming in-game:
- Verify items above player level are dimmed (0.5 opacity)
- Verify items at/below player level are not dimmed
- Verify dimming updates when leveling up
- Check all three alchemy tabs (Transmute, Decompose, Coinify)
- Test with various Alchemy levels

## === ESSENTIAL FILES ===

1. **README.md** - Feature status (✅/❌), module list, "Action Panel Features Summary"
2. **CHANGELOG.md** - Version history, [Unreleased] section for WIP
3. **package.json** - Current version (0.4.5 = pre-release)
4. **src/main.js** - Lines 1-27 (imports), 62-79 (init), 87-108 (exports)

## === CRITICAL PATTERNS (Will cause bugs if wrong) ===

**React Input Updates** (src/features/actions/quick-input-buttons.js):
```javascript
lastValue = input.value; input.value = newValue;
tracker = input._valueTracker; if (tracker) tracker.setValue(lastValue);
input.dispatchEvent(new Event('input', {bubbles: true}));
```

**Data Access:** Always use dataManager methods, never direct localStorage
- `dataManager.getInitClientData()` - Static game data
- `dataManager.getEquipment()` - Equipped items only
- `dataManager.getSkills()` - Character skill levels
- `dataManager.getCurrentActions()` - Player's action queue

**Efficiency:** Additive (level+house+tea+equip), reduces actions needed, NOT time

**MutationObserver:** Clean up observers to prevent memory leaks

## === COMMON UTILITIES ===

**Formatting:** src/utils/formatters.js
- `timeReadable(seconds)` - "1 day 5h 45m"
- `numberFormatter(num)` - "1,234,567" with commas

**UI:** createCollapsibleSection(icon, title, content, defaultOpen)
- Used in: quick-input-buttons.js, panel-observer.js
- Features: ▶▼ arrows, click to toggle, summary when collapsed

## === DEV WORKFLOW ===

1. Update CHANGELOG.md [Unreleased] for new features
2. Update README.md feature status when completing modules
3. Semantic commits: feat:/fix:/docs:/refactor:
4. Build and test: `npm run build`
5. Push to local git when applicable

## === REFERENCE DOCS (if needed) ===

- **PROJECT_DOCS.md** - Original refactoring plan, module structure (lines 1-6706 analysis)
- **CONTRIBUTING.md** - Release process, version management
- **CLAUDE.md** - Project overview, game mechanics, wiki formatting standards

## === KNOWN ISSUES ===

None currently

## === SESSION HISTORY ===

**2025-12-25 - Alchemy Item Dimming**
- Implemented alchemy item dimming feature for level requirements
- Items requiring higher Alchemy level than player has are dimmed (0.5 opacity)
- Fixed initial modal detection bug → uses ItemSelector_menu class
- Cleaned up all debug console.log statements
- Files: alchemy-item-dimming.js (NEW), config.js, main.js, CHANGELOG.md

**2025-12-25 - Task Profit Calculator**
- Implemented task profit calculator with expandable breakdown
- Added Task Token valuation system (best Task Shop item)
- Added Purple's Gift prorated value calculation
- Integrated with existing gathering and production profit calculators
- Files: task-profit-calculator.js, task-profit-display.js

**2025-12-24 - Enhancement Tooltip Market Defaults**
- Changed default from auto-detect to manual mode (professional enhancer stats)
- Added 11 config settings: enhanceSim_* in config.js
- Files: config.js, enhancement-config.js, tooltip-enhancement.js

**2025-12-23 - Combat Score Feature**
- Implemented combat score display on player profiles
- Shows house score, ability score, equipment score
- Three-level expandable UI with detailed breakdown
- Files: combat-score.js, score-calculator.js

**2025-12-22 - Zone Indices**
- Added combat zone index numbers to maps and tasks
- Format: "1. Zone Name" on maps, "Z1" on task cards
- Files: zone-indices.js
