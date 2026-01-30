# AGENTS.md - Toolasha Developer Guide

Guide for AI coding agents working on this Tampermonkey userscript for Milky Way Idle.

## Build & Test Commands

```bash
npm install          # Install dependencies
npm run build        # Build userscript → dist/Toolasha.user.js
npm run dev          # Watch mode (auto-rebuild on changes)

npm test             # Run all tests (143 tests)
npm run test:watch   # Watch mode for tests

# Run a single test file
npm test -- src/utils/formatters.test.js

# Run tests matching a pattern
npm test -- -t "numberFormatter"

npm run lint         # Check for code issues
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code and markdown with Prettier

npm run lint:md        # Check markdown formatting
npm run lint:md:fix    # Auto-fix markdown issues
npm run lint:md:links  # Check for broken links

npm run version:patch  # Bump patch version (0.5.9 → 0.5.10)
npm run version:minor  # Bump minor version (0.5.9 → 0.6.0)
```

**Pre-commit hooks:** ESLint, Prettier, tests, and build run automatically on commit.

**Manual testing:** Install `dist/Toolasha.user.js` in Tampermonkey, visit <https://www.milkywayidle.com/game>

## Project Structure

```
src/
├── main.js           # Entry point
├── core/             # Core systems (storage, config, websocket, data-manager)
├── features/         # Feature modules (market, actions, combat, tasks, etc.)
├── api/              # External API integrations (marketplace)
└── utils/            # Utility functions (formatters, dom, efficiency)
```

Tests are co-located with source files: `formatters.js` → `formatters.test.js`

## Code Style

### Imports

- **Always use `.js` extension** in imports
- **Import order:** core → api → features → utils

```javascript
import storage from './core/storage.js';
import { formatWithSeparator } from './utils/formatters.js';
```

### Naming Conventions

| Type      | Convention         | Example               |
| --------- | ------------------ | --------------------- |
| Files     | `kebab-case.js`    | `data-manager.js`     |
| Classes   | `PascalCase`       | `DataManager`         |
| Functions | `camelCase`        | `calculateProfit`     |
| Constants | `UPPER_SNAKE_CASE` | `SAVE_DEBOUNCE_DELAY` |

### Formatting (Prettier)

- 4 spaces indentation, 120 char line length
- Single quotes, semicolons required
- Trailing commas (ES5 style), LF line endings

### Async/Await

**Always use async/await**, never `.then()` chains:

```javascript
// ✅ Good
async function initialize() {
    await storage.initialize();
    await config.initialize();
}

// ❌ Bad - never use .then() chains
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

### Data Access

```javascript
import dataManager from './core/data-manager.js';
const itemDetails = dataManager.getItemDetails(itemHrid);
```

### Storage

```javascript
import storage from './core/storage.js';
await storage.set('key', value, 'storeName');
const value = await storage.get('key', 'storeName', defaultValue);
```

### DOM Utilities

```javascript
import { waitForElement, createStyledDiv } from './utils/dom.js';
const element = await waitForElement('.selector');
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

**Tampermonkey:** `GM_addStyle`, `GM`, `unsafeWindow`
**External libs:** `math`, `Chart`, `ChartDataLabels`, `LZString`
**Game:** `localStorageUtil`

## ESLint Rules

Key rules enforced (see `eslint.config.js` for full list):

- `no-var: error` - Use `const` or `let`
- `no-undef: error` - No undefined variables
- `eqeqeq: warn` - Use `===` instead of `==`
- `no-eval: error` - No eval()
- `prefer-const: warn` - Use const when not reassigned
- `no-duplicate-imports: error` - No duplicate imports
