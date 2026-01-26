# AGENTS.md - Toolasha Developer Guide

Guide for AI coding agents working on this Tampermonkey userscript for Milky Way Idle.

## Build & Test Commands

```bash
npm install          # Install dependencies
npm test             # Run test suite (143 tests)
npm run test:watch   # Watch mode for tests

npm run build        # Build userscript → dist/Toolasha.user.js
npm run build:check  # Build and verify dist is in sync with source
npm run watch        # Watch mode (auto-rebuild on changes)
npm run dev          # Alias for watch

npm run lint         # Check for code issues (errors fail, warnings don't)
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code with Prettier
npm run format:check # Check formatting without changes

npm run version:sync  # Sync version from package.json → userscript-header.txt
npm run version:patch # Bump patch version (0.5.9 → 0.5.10)
npm run version:minor # Bump minor version (0.5.9 → 0.6.0)
npm run version:major # Bump major version (0.5.9 → 1.0.0)
```

**Testing:** Vitest with 143 tests covering utility modules (formatters, efficiency, enhancement-multipliers). Tests run automatically on commit and in CI.

**Manual testing:** Install `dist/Toolasha.user.js` in Tampermonkey, visit https://www.milkywayidle.com/game

**Pre-commit hooks:** ESLint, Prettier, tests, and auto-rebuild run automatically on commit.

## Project Structure

```
src/
├── main.js           # Entry point
├── core/             # Core systems (storage, config, websocket, data-manager)
├── features/         # Feature modules (market, actions, combat, tasks, etc.)
├── api/              # External API integrations (marketplace)
└── utils/            # Utility functions (formatters, dom, efficiency)
```

## Code Style

### Imports

- **Always use `.js` extension** in imports
- **Import order:** core → api → features → utils

```javascript
import storage from './core/storage.js';
import { formatWithSeparator } from './utils/formatters.js';
```

### Naming Conventions

- **Files:** `kebab-case.js` (e.g., `data-manager.js`)
- **Classes:** `PascalCase` (e.g., `DataManager`)
- **Functions/variables:** `camelCase` (e.g., `calculateProfit`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `SAVE_DEBOUNCE_DELAY`)

### Formatting (Prettier)

- 4 spaces indentation
- 120 char line length
- Single quotes, semicolons required
- Trailing commas (ES5 style)
- LF line endings

### Async/Await

**Always use async/await**, never `.then()` chains:

```javascript
// ✅ Good
async function initialize() {
    await storage.initialize();
    await config.initialize();
}

// ❌ Bad
function initialize() {
    storage.initialize().then(() => config.initialize());
}
```

### Error Handling

Use try-catch with module-prefixed console logging:

```javascript
try {
    const result = await someAsyncOperation();
    return result;
} catch (error) {
    console.error('[ModuleName] Operation failed:', error);
    return null;
}
```

### JSDoc Documentation

Document all public functions:

```javascript
/**
 * Calculate profit for a crafted item
 * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
 * @returns {Promise<Object|null>} Profit data or null if not craftable
 */
async calculateProfit(itemHrid) { }
```

## Architecture Patterns

### Singleton Pattern (Core Modules)

```javascript
class DataManager {
    constructor() {
        this.data = null;
    }
}
const dataManager = new DataManager();
export default dataManager;
```

### Feature Interface

```javascript
export default {
    name: 'Feature Name',
    initialize: async () => {
        /* setup */
    },
    cleanup: () => {
        /* teardown */
    },
};
```

### Data Access - Use DataManager

```javascript
import dataManager from './core/data-manager.js';

const itemDetails = dataManager.getItemDetails(itemHrid);
const equipment = dataManager.getEquipment();
const skills = dataManager.getSkills();
```

### Storage - Use storage module

```javascript
import storage from './core/storage.js';

await storage.set('key', value, 'storeName');
const value = await storage.get('key', 'storeName', defaultValue);
await storage.setJSON('key', object, 'storeName');
```

### DOM - Use dom utilities

```javascript
import { waitForElement, createStyledDiv } from './utils/dom.js';

const element = await waitForElement('.selector');
const div = createStyledDiv({ color: 'red' }, 'Text');
```

## Anti-Patterns to Avoid

- ❌ `.then()` chains → use async/await
- ❌ Direct `localStorage` access → use storage module
- ❌ Direct game data access → use dataManager
- ❌ `var` keyword → use `const` or `let`
- ❌ Mutating function parameters
- ❌ Abbreviations in names (`calc` → `calculate`)
- ❌ Missing `.js` extension in imports
- ❌ K/M/B abbreviations in user-facing numbers → use full numbers with separators

## Key Files

| File                           | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `src/main.js`                  | Entry point, initialization order              |
| `src/core/data-manager.js`     | Game data access (items, actions, player data) |
| `src/core/storage.js`          | IndexedDB persistence with debouncing          |
| `src/core/config.js`           | Feature settings management                    |
| `src/core/websocket.js`        | WebSocket message interception                 |
| `src/core/feature-registry.js` | Feature initialization system                  |
| `src/utils/formatters.js`      | Number/time formatting utilities               |

## Globals Available

Tampermonkey: `GM_addStyle`, `GM`, `unsafeWindow`
External libs: `math`, `Chart`, `ChartDataLabels`, `LZString`
Game: `localStorageUtil`
