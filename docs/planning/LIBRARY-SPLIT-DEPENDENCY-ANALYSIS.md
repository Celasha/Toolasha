# Library Split - Dependency Analysis

**Date:** 2026-02-03
**Purpose:** Analyze dependencies to determine safe library split boundaries
**Script Size:** 2,117,431 bytes (100.97% of 2MB limit - OVER by 20,279 bytes)

## Critical Findings

### 1. Core → Features Dependencies (BLOCKS "Core First" Strategy)

**Problem:** Core modules import from features, creating circular dependency risk.

#### core/config.js → features/settings/\*

```javascript
import settingsStorage from '../features/settings/settings-storage.js';
import { settingsGroups } from '../features/settings/settings-config.js';
```

**Usage:**

- `settingsStorage.loadSettings()` - Load user settings from IndexedDB
- `settingsStorage.saveSettings()` - Persist settings changes
- `settingsGroups` - Iterate over setting groups for validation

**Impact:** Config cannot be in a standalone "Core" library without also including settings modules.

#### core/websocket.js → features/combat/profile-cache.js

```javascript
import { setCurrentProfile } from '../features/combat/profile-cache.js';
```

**Usage:**

- Called when `/init_client_data` message received
- Stores current character profile for combat calculations

**Impact:** Websocket cannot be in a standalone "Core" library without also including profile-cache.

#### core/feature-registry.js → ALL features (48 imports)

```javascript
import tooltipPrices from '../features/market/tooltip-prices.js';
import actionTimeDisplay from '../features/actions/action-time-display.js';
// ... 46 more feature imports
```

**Usage:**

- Bootstraps all features on script startup
- Manages feature lifecycle (initialize/disable)

**Impact:** Feature registry is the integration point and must load AFTER all libraries.

### 2. Feature → Feature Dependencies

#### market/market-history-viewer.js → settings/settings-ui.js

```javascript
import settingsUI from '../settings/settings-ui.js';
```

**Usage:**

- Opens settings panel from market history viewer
- UI integration between features

**Impact:** Market library must load after Settings library, OR settings-ui must be split out.

### 3. Utils Usage (60+ files)

**Widely imported utilities:**

- `utils/formatters.js` - Number/time formatting (40+ imports)
- `utils/profit-helpers.js` - Profit calculations (20+ imports)
- `utils/efficiency.js` - Efficiency math (15+ imports)
- `utils/dom-observer-helpers.js` - DOM utilities (10+ imports)
- `utils/timer-registry.js` - NEW from remediation (12+ imports)
- `utils/cleanup-registry.js` - NEW from remediation (8+ imports)

**Impact:** Utils must be in the first library or duplicated across libraries.

## Module Size Analysis

| Directory            | Lines  | Files | Estimated Size    |
| -------------------- | ------ | ----- | ----------------- |
| features/actions     | 9,540  | 14    | ~450KB            |
| features/market      | 8,194  | 15    | ~400KB            |
| features/combat      | 6,811  | 15    | ~350KB            |
| utils                | 6,641  | 35    | ~300KB            |
| features/tasks       | 3,327  | 7     | ~150KB            |
| features/enhancement | 3,344  | 8     | ~150KB            |
| core                 | 3,303  | 7     | ~150KB            |
| features/settings    | 2,963  | 3     | ~200KB (UI-heavy) |
| features/alchemy     | 1,920  | 2     | ~100KB            |
| features/networth    | 1,446  | 4     | ~80KB             |
| features/inventory   | 1,550  | 4     | ~80KB             |
| features/house       | 1,189  | 3     | ~60KB             |
| features/profile     | 1,799  | 4     | ~90KB             |
| Other features       | ~2,500 | ~18   | ~150KB            |

**Total:** ~56,000 lines, ~2.1MB

## Proposed Solutions

### Option A: Move Dependencies Into Core Library ✅ RECOMMENDED

**Strategy:** Bundle core + settings + profile-cache together as "Foundation Library"

**Library 1: Foundation (~500KB)**

- `core/*` (config, data-manager, websocket, storage, dom-observer, feature-registry stub)
- `utils/*` (all shared utilities)
- `api/*` (marketplace API)
- `features/settings/*` (settings-storage, settings-config, settings-ui)
- `features/combat/profile-cache.js` (just the profile cache, not all combat)

**Library 2: Market (~400KB)**

- `features/market/*` (all market features)

**Library 3: Actions & Alchemy (~550KB)**

- `features/actions/*`
- `features/alchemy/*`

**Library 4: Combat & Tasks (~500KB)**

- `features/combat/*` (except profile-cache, which is in Foundation)
- `features/combat-stats/*`
- `features/tasks/*`

**Library 5: UI & Misc (~400KB)**

- `features/enhancement/*`
- `features/inventory/*`
- `features/house/*`
- `features/networth/*`
- `features/profile/*`
- `features/ui/*`
- `features/skills/*`
- `features/notifications/*`
- `features/abilities/*`
- `features/dictionary/*`

**Entrypoint (~50KB)**

- Metadata block with `@require` list
- Feature registry (imports all features and calls initialize)
- Global namespace setup
- Version compatibility checks

**Pros:**

- No code refactoring needed
- Clean dependency order: Foundation → Features → Entrypoint
- Settings available to all features (via Foundation)
- No circular dependencies

**Cons:**

- Foundation library is larger (~500KB vs ~300KB)
- Settings is "UI-heavy" but lives in Foundation

---

### Option B: Break Circular Dependencies (Refactor First)

**Strategy:** Extract data/schema from UI modules before splitting

**Changes needed:**

1. Extract `settingsStorage` and `settingsGroups` into `core/settings-schema.js`
2. Extract `setCurrentProfile` into `core/profile-manager.js`
3. Leave `settings-ui.js` as UI-only in features

**Library 1: Core (~400KB)**

- `core/*` (including new settings-schema.js and profile-manager.js)
- `utils/*`
- `api/*`

**Library 2-5: Features (~400-550KB each)**

- Market, Actions, Combat, UI (no dependency issues)

**Entrypoint (~50KB)**

- Feature registry + bootstrap

**Pros:**

- Clean architecture (core is truly "core")
- Smaller Foundation library
- Better separation of concerns

**Cons:**

- Requires refactoring before split (2-4 hours work)
- Risk of breaking features during refactor
- Delays the Greasyfork sync fix

---

### Option C: Duplicate Core/Utils Across Libraries ❌ NOT RECOMMENDED

**Strategy:** Include a copy of core/utils in each library

**Why not:**

- Violates DRY principle
- State synchronization nightmare (config changes, storage, websocket)
- Wastes bundle size (5 copies of utils = +1.5MB)
- Runtime conflicts (multiple config instances)

## Recommendation

**Choose Option A** for immediate Greasyfork sync restoration.

**Rationale:**

1. **Fastest path to working split** (no refactoring required)
2. **Low risk** (no code changes, just bundling changes)
3. **Backwards compatible** (can refactor later if needed)
4. **Meets size requirements** (all libraries < 600KB)

**Later:** After split is stable, consider Option B refactoring as technical debt cleanup.

## Next Steps

1. **Define global namespace contracts** (window.Toolasha structure)
2. **Create rollup config for multi-bundle build**
3. **Test production build locally**
4. **Publish libraries to Greasyfork**
5. **Update entrypoint @require URLs**
6. **Verify in Tampermonkey**

## Dependencies Summary

**Foundation Library depends on:** (nothing - loads first)

**Feature Libraries depend on:** Foundation

**Entrypoint depends on:** Foundation + all Feature libraries

**Load Order:** Foundation → Market → Actions → Combat → UI → Entrypoint
