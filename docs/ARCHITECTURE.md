# Toolasha Architecture

High-level overview of Toolasha's architecture and design patterns.

## Overview

Toolasha is a modular Tampermonkey userscript built with modern JavaScript (ES6+). It uses a feature-based architecture where each feature is an independent module that can be enabled/disabled via settings.

## Core Principles

1. **Modularity** - Features are independent and self-contained
2. **Maintainability** - Clear separation of concerns
3. **Performance** - Efficient data access and minimal DOM manipulation
4. **Extensibility** - Easy to add new features
5. **Reliability** - Comprehensive error handling and testing

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         main.js                              │
│                    (Entry Point)                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ├─────────────────────────────────────┐
                         │                                     │
                         ▼                                     ▼
            ┌────────────────────────┐          ┌─────────────────────────┐
            │    Core Systems        │          │   Feature Registry      │
            │                        │          │                         │
            │  • storage.js          │          │  Initializes features   │
            │  • config.js           │◄─────────┤  in dependency order    │
            │  • data-manager.js     │          │                         │
            │  • websocket.js        │          └─────────────────────────┘
            │  • dom-observer.js     │                      │
            └────────────────────────┘                      │
                         ▲                                  │
                         │                                  │
                         │                                  ▼
            ┌────────────┴────────────┐          ┌─────────────────────────┐
            │    Utils                │          │   Feature Modules       │
            │                         │          │                         │
            │  • formatters.js        │          │  • market/              │
            │  • dom.js               │          │  • combat/              │
            │  • efficiency.js        │          │  • enhancement/         │
            │  • selectors.js         │          │  • actions/             │
            └─────────────────────────┘          │  • networth/            │
                                                 │  • settings/            │
                                                 │  • ... etc              │
                                                 └─────────────────────────┘
```

## Core Systems

### 1. Storage (`src/core/storage.js`)

**Purpose**: Persistent data storage using IndexedDB

**Key Features**:

- Async operations with Promise-based API
- Debounced writes (3-second delay) to reduce I/O
- Multiple object stores for different data types
- Automatic initialization

**Usage**:

```javascript
import storage from './core/storage.js';

// Initialize (done automatically on startup)
await storage.initialize();

// Store data
await storage.set('key', value, 'storeName');

// Retrieve data
const value = await storage.get('key', 'storeName', defaultValue);

// JSON helpers
await storage.setJSON('key', object, 'storeName');
const object = await storage.getJSON('key', 'storeName', {});
```

**Object Stores**:

- `settings` - User configuration
- `rerollSpending` - Task reroll tracking
- `dungeonRuns` - Dungeon run history
- `teamRuns` - Team composition history
- `enhancementSessions` - Enhancement tracking

### 2. Config (`src/core/config.js`)

**Purpose**: Settings management and feature configuration

**Key Features**:

- Centralized settings access
- Setting change listeners
- Default values
- Type validation

**Usage**:

```javascript
import config from './core/config.js';

// Get setting value
const enabled = config.getSettingValue('myFeature', true);

// Listen for changes
config.onSettingChange('myFeature', (newValue) => {
    console.log('Setting changed:', newValue);
});
```

### 3. Data Manager (`src/core/data-manager.js`)

**Purpose**: Access to game data and player state

**Key Features**:

- Centralized game data access
- Caches frequently accessed data
- Provides helper methods for common queries
- Event system for data updates

**Usage**:

```javascript
import dataManager from './core/data-manager.js';

// Get item details
const item = dataManager.getItemDetails('/items/cheese');

// Get player inventory
const inventory = dataManager.getInventory();

// Get equipped items
const equipment = dataManager.getEquipment();

// Listen for updates
dataManager.on('items_updated', () => {
    console.log('Inventory changed');
});
```

**Data Sources**:

- `init_character_data` - Initial game state
- `itemDetailMap` - All item definitions
- `actionDetailMap` - All action definitions
- Player inventory, equipment, skills, etc.

### 4. WebSocket Hook (`src/core/websocket.js`)

**Purpose**: Intercept and monitor game WebSocket messages

**Key Features**:

- Non-invasive message interception
- Event-based message handling
- Multiple listeners per message type
- Automatic cleanup

**Usage**:

```javascript
import webSocketHook from './core/websocket.js';

// Listen for specific message types
const unregister = webSocketHook.register('items_updated', (message) => {
    console.log('Items updated:', message);
});

// Cleanup when done
unregister();
```

**Common Message Types**:

- `init_character_data` - Initial game load
- `items_updated` - Inventory changes
- `actions_updated` - Action queue changes
- `market_listings_updated` - Market changes
- `new_battle` - Combat wave start
- `action_completed` - Action finished

### 5. DOM Observer (`src/core/dom-observer.js`)

**Purpose**: Centralized DOM mutation observation

**Key Features**:

- Single MutationObserver for entire app
- Selector-based callbacks
- Automatic cleanup
- Performance optimized

**Usage**:

```javascript
import domObserver from './core/dom-observer.js';

// Watch for specific elements
const unregister = domObserver.observe('.item-icon', (element) => {
    console.log('Item icon added:', element);
});

// Cleanup
unregister();
```

## Feature Architecture

### Feature Module Pattern

Each feature follows a standard interface:

```javascript
// src/features/my-feature/my-feature.js
export default {
    name: 'My Feature',

    // Called when feature is enabled
    initialize: async () => {
        // Setup code
        // Register event listeners
        // Initialize UI
    },

    // Called when feature is disabled
    cleanup: () => {
        // Remove event listeners
        // Clean up UI
        // Reset state
    },
};
```

### Feature Registration

Features are registered in `src/core/feature-registry.js`:

```javascript
const features = [
    {
        key: 'myFeature', // Unique identifier
        name: 'My Feature', // Display name
        category: 'UI Enhancements', // Category for organization
        initialize: () => myFeature.initialize(),
        async: false, // Whether initialization is async
    },
];
```

### Feature Lifecycle

1. **Registration** - Feature added to registry
2. **Initialization** - `initialize()` called on startup (if enabled)
3. **Active** - Feature running, listening to events
4. **Cleanup** - `cleanup()` called when disabled or on shutdown

## Data Flow

### Game Data Flow

```
Game WebSocket
      │
      ▼
WebSocket Hook (intercept)
      │
      ├──────────────────┐
      │                  │
      ▼                  ▼
Data Manager      Feature Modules
      │                  │
      │                  ▼
      │            Update UI
      │                  │
      ▼                  ▼
  Storage          DOM Changes
```

### Settings Flow

```
User Changes Setting
      │
      ▼
Settings UI
      │
      ▼
Config Module
      │
      ├──────────────────┐
      │                  │
      ▼                  ▼
  Storage         Setting Listeners
                         │
                         ▼
                   Feature Updates
```

## UI Integration

### DOM Injection Strategy

Toolasha injects UI elements into the game's DOM:

1. **Wait for target elements** - Use `waitForElement()` helper
2. **Create styled elements** - Use `createStyledDiv()` helper
3. **Insert into DOM** - Append to appropriate containers
4. **Track references** - Store for cleanup

**Example**:

```javascript
import { waitForElement, createStyledDiv } from './utils/dom.js';

async function injectUI() {
    // Wait for game element
    const container = await waitForElement('.game-panel');

    // Create our element
    const myElement = createStyledDiv({ color: 'green', padding: '10px' }, 'My Feature UI');

    // Inject
    container.appendChild(myElement);

    // Store reference for cleanup
    this.uiElement = myElement;
}

function cleanup() {
    if (this.uiElement) {
        this.uiElement.remove();
        this.uiElement = null;
    }
}
```

### CSS Styling

- Inline styles for dynamic values
- CSS classes for reusable styles
- Use game's existing styles where possible
- Prefix custom classes with `mwi-` or `toolasha-`

## Performance Considerations

### Optimization Strategies

1. **Debounced Operations**
    - Storage writes debounced (3 seconds)
    - UI updates throttled
    - Event handlers debounced where appropriate

2. **Efficient DOM Access**
    - Cache DOM references
    - Use specific selectors
    - Minimize DOM queries

3. **Data Caching**
    - Cache frequently accessed game data
    - Invalidate cache on updates
    - Use WeakMap for element associations

4. **Lazy Initialization**
    - Initialize features only when needed
    - Defer heavy operations
    - Load data on-demand

### Memory Management

- Remove event listeners in cleanup
- Clear DOM references
- Avoid circular references
- Use WeakMap for temporary associations

## Error Handling

### Error Handling Strategy

1. **Try-Catch Blocks**
    - Wrap async operations
    - Log errors with module prefix
    - Provide fallback behavior

2. **Graceful Degradation**
    - Feature fails → disable gracefully
    - Missing data → use defaults
    - API errors → retry or skip

3. **User Feedback**
    - Console logging for developers
    - In-game notifications for users
    - Error messages in UI

**Example**:

```javascript
try {
    const data = await fetchData();
    processData(data);
} catch (error) {
    console.error('[MyFeature] Failed to fetch data:', error);
    // Fallback behavior
    useDefaultData();
}
```

## Testing Strategy

### Test Coverage

- **Unit Tests** - Utility functions, calculations
- **Integration Tests** - Feature interactions
- **Manual Tests** - UI and game integration

### Test Structure

```
tests/
├── formatters.test.js           # Number/time formatting
├── efficiency.test.js           # Game mechanics calculations
├── enhancement-multipliers.test.js  # Enhancement calculations
└── ... (more tests)
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch   # Watch mode
```

## Build Process

### Build Pipeline

```
Source Files (src/)
      │
      ▼
Rollup Bundler
      │
      ├─ Resolve imports
      ├─ Bundle modules
      ├─ Add userscript header
      └─ Generate sourcemap
      │
      ▼
dist/Toolasha.user.js (production entrypoint)
dist/Toolasha-dev.user.js (dev standalone)
dist/Toolasha.steam.user.js (Steam bundle)
dist/libraries/*.js (production libraries)
```

### Build Configuration

- **Dev standalone**: `src/dev-entrypoint.js` → `dist/Toolasha-dev.user.js` (bundles libraries + entrypoint)
- **Production**: `src/entrypoint.js` → `dist/Toolasha.user.js` + `dist/libraries/*.js` (libraries loaded via @require)
- **Steam**: `src/dev-entrypoint.js` → `dist/Toolasha.steam.user.js` (single bundle with vendor libs inline)
- **Format**: IIFE (Immediately Invoked Function Expression)
- **Sourcemap**: Inline for debugging

### Build Commands

```bash
npm run build:dev   # One-time dev standalone build
npm run build       # Production bundles (entrypoint + libraries)
npm run build:steam # Steam bundle (single file with vendor libs)
npm run build:all   # Build both production and Steam versions
npm run watch       # Watch mode (auto-rebuild)
npm run dev         # Alias for watch
```

## Deployment

### Release Process

This project uses [release-please](https://github.com/googleapis/release-please) with [Conventional Commits](https://www.conventionalcommits.org/).

1. **Write Conventional Commits** - Use commit messages like:
    - `feat: add new feature` (triggers minor bump)
    - `fix: resolve bug` (triggers patch bump)
    - `feat!: breaking change` or `BREAKING CHANGE:` in body (triggers major bump)
2. **Push to `main`** - Release-please analyzes commits
3. **Release PR** - Release-please opens/updates a PR with version bump + changelog
4. **Merge Release PR** - Creates GitHub Release with entrypoint + libraries attached
5. **Releases branch** - Built artifacts committed and entrypoint @require URLs pinned to the release commit SHA
6. **Distribution** - Users update via Tampermonkey

### Conventional Commit Types

- `feat` - New feature (minor version bump)
- `fix` - Bug fix (patch version bump)
- `docs` - Documentation only
- `style` - Formatting, no code change
- `refactor` - Code change, no feature/fix
- `perf` - Performance improvement
- `test` - Adding/fixing tests
- `chore` - Maintenance tasks

### Version Management

- **Patch** (0.5.9 → 0.5.10) - `fix:` commits
- **Minor** (0.5.9 → 0.6.0) - `feat:` commits
- **Major** (0.5.9 → 1.0.0) - Breaking changes (`feat!:` or `BREAKING CHANGE:`)

## Extension Points

### Adding New Features

1. Create feature module in `src/features/`
2. Register in `src/core/feature-registry.js`
3. Add settings in `src/core/settings-schema.js`
4. Write tests in `tests/`

### Adding New Core Systems

1. Create module in `src/core/`
2. Export singleton instance
3. Initialize in `src/main.js`
4. Document in this file

### Adding New Utilities

1. Create utility in `src/utils/`
2. Export functions
3. Write tests
4. Document usage

## Utility Modules

### Shared Calculation Helpers

Toolasha provides shared utility modules for common calculations to avoid duplication across features.

#### Efficiency Utilities (`utils/efficiency.js`)

Pure functions for calculating efficiency breakdowns and multipliers:

```javascript
import { calculateEfficiencyBreakdown, calculateEfficiencyMultiplier } from './utils/efficiency.js';

const breakdown = calculateEfficiencyBreakdown({
    requiredLevel: 50,
    skillLevel: 75,
    teaSkillLevelBonus: 5,
    actionLevelBonus: 0,
    houseEfficiency: 10,
    equipmentEfficiency: 20,
    teaEfficiency: 15,
    communityEfficiency: 5,
    achievementEfficiency: 3,
});

// Returns:
// {
//   totalEfficiency: 78,
//   levelEfficiency: 30,
//   effectiveRequirement: 50,
//   effectiveLevel: 80,
//   breakdown: { houseEfficiency: 10, equipmentEfficiency: 20, ... }
// }

const multiplier = calculateEfficiencyMultiplier(150); // 2.5x
```

**Key Features:**

- Handles all efficiency sources (level, house, equipment, tea, community, achievements)
- Calculates effective level and requirement with bonuses
- Converts efficiency percentage to action speed multiplier
- Returns detailed breakdown for UI display
- Pure functions - no side effects

#### Profit Helpers (`utils/profit-helpers.js`)

Shared profit and rate calculation functions used across multiple features:

**Rate Conversions:**

```javascript
import { calculateActionsPerHour, calculateHoursForActions } from './utils/profit-helpers.js';

const actionsPerHour = calculateActionsPerHour(6); // 600 actions/hr
const hoursNeeded = calculateHoursForActions(1200, 600); // 2 hours
```

**Efficiency Calculations:**

```javascript
import { calculateEfficiencyMultiplier } from './utils/efficiency.js';

const multiplier = calculateEfficiencyMultiplier(150); // 2.5x
```

**Tea Cost Calculations:**

```javascript
import { calculateTeaCostsPerHour } from './utils/profit-helpers.js';

const teaCosts = calculateTeaCostsPerHour({
    drinkSlots: player.drinkSlots,
    drinkConcentration: 0.15,
    itemDetailMap,
    getItemPrice: (hrid) => marketPrices.get(hrid),
});

// Returns:
// {
//   costs: [{ itemHrid, itemName, pricePerDrink, drinksPerHour, totalCost, missingPrice }],
//   totalCostPerHour: 12500,
//   hasMissingPrices: false,
//   drinksPerHour: 13.8
// }
```

**Profit Calculations:**

```javascript
import { calculateProfitPerAction, calculateTotalProfitForActions } from './utils/profit-helpers.js';

const profitPerAction = calculateProfitPerAction(75000, 600); // 125 per action
const totalProfit = calculateTotalProfitForActions(75000, 600, 100); // 12,500 for 100 actions
```

**Action-Based Totals:**

```javascript
import { calculateProductionActionTotalsFromBase } from './utils/profit-helpers.js';

const totals = calculateProductionActionTotalsFromBase({
    actionsCount: 100,
    actionsPerHour: 600,
    outputAmount: 1,
    outputPrice: 1000,
    gourmetBonus: 0.1,
    bonusDrops: [],
    materialCosts: [],
    totalTeaCostPerHour: 12000,
    efficiencyMultiplier: 2.5,
});

// Returns: { totalRevenue, totalCosts, totalProfit, hoursNeeded, ... }
```

**Key Features:**

- Consolidates duplicated calculations from multiple features
- Pure functions with clear inputs/outputs
- Handles edge cases (zero division, missing data)
- Comprehensive JSDoc documentation with examples

#### Profit Constants (`utils/profit-constants.js`)

Shared constants for profit calculations:

```javascript
import {
    MARKET_TAX, // 0.02 (2%)
    DRINKS_PER_HOUR_BASE, // 12
    SECONDS_PER_HOUR, // 3600
    HOURS_PER_DAY, // 24
    GATHERING_TYPES, // ['/action_types/foraging', ...]
    PRODUCTION_TYPES, // ['/action_types/brewing', ...]
} from './utils/profit-constants.js';
```

**Usage Pattern:**

- Import only the constants you need
- Use for consistent calculations across features
- Centralized location for game mechanic constants

## Best Practices

### Do's

✅ Use async/await for asynchronous operations
✅ Always include `.js` extension in imports
✅ Use DataManager for game data access
✅ Use Storage module for persistence
✅ Clean up event listeners in cleanup()
✅ Prefix console logs with module name
✅ Write tests for utility functions
✅ Document public APIs with JSDoc

### Don'ts

❌ Don't use `.then()` chains
❌ Don't access localStorage directly
❌ Don't mutate game data
❌ Don't create global variables
❌ Don't use `var` keyword
❌ Don't forget to clean up in cleanup()
❌ Don't hardcode selectors (use constants)

## Troubleshooting

### Common Issues

**Feature not initializing:**

- Check if registered in feature-registry.js
- Check if setting is enabled
- Check console for errors

**Data not updating:**

- Check WebSocket hook registration
- Check DataManager event listeners
- Verify message type names

**UI not appearing:**

- Check if target element exists
- Check CSS selectors
- Check z-index conflicts

**Storage not persisting:**

- Check IndexedDB in DevTools
- Verify store name is correct
- Check for quota errors

## Further Reading

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [AGENTS.md](../AGENTS.md) - AI agent development guide
- [FEATURES.md](../FEATURES.md) - Complete feature list
- [DOCUMENTATION.md](../DOCUMENTATION.md) - Documentation index
