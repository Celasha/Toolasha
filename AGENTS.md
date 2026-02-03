# AGENTS.md - Toolasha Developer Guide

Guide for AI coding agents working on this Tampermonkey userscript for Milky Way Idle.

## Build, Lint, and Test Commands

```bash
npm install            # Install dependencies
npm run build          # Build userscript → dist/Toolasha.user.js
npm run dev            # Watch mode (auto-rebuild)

npm run lint           # Lint code
npm run lint:fix       # Auto-fix lint issues
npm run format         # Prettier (JS/MD)

npm run lint:md        # Markdown lint
npm run lint:md:fix    # Auto-fix markdown
npm run lint:md:links  # Link check

npm test               # Run all tests
npm run test:watch     # Test watch mode

# Single test file
npm test -- src/utils/formatters.test.js

# Single test by pattern
npm test -- -t "numberFormatter"
```

**Pre-commit hooks:** ESLint + Prettier + tests + build run on commit.
**Manual testing:** Install `dist/Toolasha.user.js` in Tampermonkey and open <https://www.milkywayidle.com/game>.

## Project Structure (High-Level)

```
src/
├── main.js           # Entry point
├── core/             # Core systems (storage, config, websocket, data-manager)
├── features/         # Feature modules (market, actions, combat, tasks, etc.)
├── api/              # External API integrations (marketplace)
└── utils/            # Shared utilities (formatters, dom, efficiency, profit-helpers)
```

Tests are co-located: `formatters.js` → `formatters.test.js`.

## Code Style & Conventions

### Imports

- **Always use `.js` extension** in imports.
- **Order:** core → api → features → utils.

```js
import config from '../core/config.js';
import marketAPI from '../api/marketplace.js';
import someFeature from '../features/foo/bar.js';
import { formatWithSeparator } from '../utils/formatters.js';
```

### Formatting

- 4 spaces indentation
- 120-char line length
- Single quotes, semicolons required
- Trailing commas (ES5), LF line endings

### Naming

- Files: `kebab-case.js`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Async/Await

- **Use async/await** only (no `.then()` chains).

### Error Handling

- Use try/catch with module-prefixed logs.

```js
try {
    const result = await someAsyncOperation();
    return result;
} catch (error) {
    console.error('[ModuleName] Operation failed:', error);
    return null;
}
```

### JSDoc

- Document public functions and exported helpers with JSDoc.

## Architecture Patterns

### Singleton Core Modules

```js
class DataManager {
    constructor() {
        this.data = null;
    }
}
const dataManager = new DataManager();
export default dataManager;
```

### Feature Interface

```js
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

```js
import dataManager from '../core/data-manager.js';
const itemDetails = dataManager.getItemDetails(itemHrid);
```

### Storage

```js
import storage from '../core/storage.js';
await storage.set('key', value, 'storeName');
const value = await storage.get('key', 'storeName', defaultValue);
```

## Lifecycle & Cleanup

- Prefer `createCleanupRegistry()` for timers/observers.
- Use `createTimerRegistry()` for intervals/timeouts.
- Remove observers/listeners on `cleanup()` or `disable()`.

## Anti-Patterns to Avoid

- ❌ `.then()` chains
- ❌ Direct `localStorage` access → use storage module
- ❌ Direct game data access → use dataManager
- ❌ `var`
- ❌ Mutating function parameters
- ❌ Missing `.js` in imports

## Key Files

- `src/main.js` (entry/init)
- `src/core/data-manager.js` (game data access)
- `src/core/storage.js` (IndexedDB)
- `src/core/websocket.js` (WS interception)
- `src/core/feature-registry.js` (feature bootstrapping)
- `src/utils/formatters.js` (number/time formatting)
- `src/utils/efficiency.js` (efficiency math)
- `src/utils/profit-helpers.js` (profit/rate helpers)

## Tooling Rules

- ESLint: no `var`, no `eval`, prefer `const`, no duplicate imports.

## Cursor / Copilot Rules

- No `.cursorrules` or `.github/copilot-instructions.md` found in this repo.

```

```
