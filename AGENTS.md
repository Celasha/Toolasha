# AGENTS.md - Toolasha Developer Guide

Guide for AI coding agents working on this Tampermonkey userscript for Milky Way Idle.

## Build, Lint, and Test Commands

```bash
npm install            # Install dependencies
npm run build:dev       # Build dev standalone → dist/Toolasha-dev.user.js
npm run build           # Build production bundles → dist/Toolasha.user.js + dist/libraries
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
**Manual testing:** Install `dist/Toolasha-dev.user.js` in Tampermonkey and open <https://www.milkywayidle.com/game>.

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

### Stateful Cross-Bundle Services

- Stateful services must have exactly one owning bundle. Cross-bundle consumers must reference the owner through Rollup externals / the `window.Toolasha` namespace, never bundle another stateful copy.
- Constructors of stateful services must be side-effect free. Register WebSocket/data/DOM listeners only in explicit lifecycle methods and remove them symmetrically.
- `src/core/loadout-state.js` is the sole owner of saved MWI loadout state and exact/highest enhancement semantics. Feature code must consume resolved/effective snapshots and must not interpret `useExactEnhancement` or mutate raw snapshots.
- Raw saved loadout state is server/cache evidence. Effective equipment is resolved at read time against current character ownership. Never use `enhancementLevel === 0` as a marker for highest-enhancement mode; exact +0 is valid.
- Fresh structured server state outranks local cache, including an explicitly empty server map. Character switches must fail closed against prior-character state.
- Treat accepted `init_character_data` as both character and WebSocket ownership. `loadouts_updated` does not reliably carry a character id, so reject updates from a socket other than the one that established the current accepted server state. WebSocket content deduplication must remain socket-scoped.
- Keep the post-build `npm run check:loadout-state` gate green; it protects the production split bundles from silently reintroducing duplicate stateful loadout instances.

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
