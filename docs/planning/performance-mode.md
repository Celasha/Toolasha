# Performance Mode Implementation Plan

**Feature**: Add performance/low memory mode to Toolasha
**Source**: Mands' implementation in `/Users/kennydean/Downloads/MWI/Mands/script.js`
**Goal**: Reduce memory/CPU usage by disabling heavy features with single toggle

---

## Overview

Performance mode allows users experiencing lag to disable memory-intensive features with a single checkbox. Features are:

1. Prevented from initializing if mode is already enabled (startup optimization)
2. Disabled at runtime if user enables mode while script is running (cleanup)

---

## Features to Disable in Performance Mode

Based on Mands' implementation, these are the heavy features:

1. **market_showEstimatedListingAge** - IndexedDB tracking of listing IDs over time
2. **dungeonTracker** - Real-time dungeon progress tracking with statistics
3. **enhancementTracker** - Enhancement session tracking with IndexedDB storage
4. **networth** - Continuous inventory value calculations
5. **inventoryBadgePrices** - Price badge overlays on every inventory item
6. **skillRemainingXP** - Continuous XP calculations for all skills
7. ~~**actionPanel_smartAdvisor**~~ - Not in Toolasha (Mands-specific feature)

**Total**: 6 features disabled when performance mode enabled

---

## Files to Modify

### 1. **src/features/settings/settings-config.js**

- Add `lowMemoryMode` setting to `general` group
- Location: After `networkAlert` setting (line 16)

### 2. **src/core/feature-registry.js**

- Add `LOW_MEMORY_DISABLED_FEATURES` constant
- Add `isLowMemoryModeEnabled()` helper
- Add `shouldSkipFeatureInLowMemory()` check function
- Add `disableFeaturesByKey()` method
- Modify `initializeFeatures()` to skip features in low memory mode
- Export `disableFeaturesByKey` in default export

### 3. **src/features/settings/settings-ui.js**

- Add performance banner UI element
- Add performance chip (toolbar button)
- Add `updatePerformanceBanner()` method
- Add `updatePerformanceChip()` method
- Add `toggleLowMemoryMode()` method
- Update `addToolbar()` to include performance chip
- Update `handleSettingChange()` to update banner/chip when mode changes

### 4. **src/features/settings/settings-styles.css**

- Add `.toolasha-performance-banner` styles
- Add `.toolasha-settings-chip.active` styles (if not exists)

### 5. **src/main.js**

- Add `lowMemoryMode` change listener after config initialization
- Listener calls `featureRegistry.disableFeaturesByKey()` when enabled

---

## Implementation Steps

### Step 1: Add Setting Definition

**File**: `src/features/settings/settings-config.js`

**Location**: Line 16 (after `networkAlert`)

```javascript
lowMemoryMode: {
    id: 'lowMemoryMode',
    label: 'Performance mode (reduce memory/CPU usage)',
    type: 'checkbox',
    default: false,
    help: 'Disables heavier features (market listing age, dungeon tracker, enhancement tracker, networth, remaining XP, inventory badges)'
}
```

---

### Step 2: Add Feature Registry Logic

**File**: `src/core/feature-registry.js`

**Location**: Top of file (after imports, before featureRegistry array ~line 58)

```javascript
/**
 * Features disabled in low memory/performance mode
 * These are the most memory and CPU intensive features
 */
const LOW_MEMORY_DISABLED_FEATURES = new Set([
    'market_showEstimatedListingAge',
    'dungeonTracker',
    'enhancementTracker',
    'networth',
    'inventoryBadgePrices',
    'skillRemainingXP',
]);

/**
 * Check if low memory mode is enabled
 * @returns {boolean}
 */
function isLowMemoryModeEnabled() {
    return config.getSetting('lowMemoryMode') === true;
}

/**
 * Check if feature should be skipped in low memory mode
 * @param {string} featureKey - Feature key to check
 * @returns {boolean}
 */
function shouldSkipFeatureInLowMemory(featureKey) {
    return isLowMemoryModeEnabled() && LOW_MEMORY_DISABLED_FEATURES.has(featureKey);
}
```

**Location**: Inside `initializeFeatures()` function (~line 456, before feature enable check)

```javascript
async function initializeFeatures() {
    // Block feature initialization during character switch
    if (dataManager.getIsCharacterSwitching()) {
        return;
    }

    const errors = [];

    for (const feature of featureRegistry) {
        try {
            // Skip heavy features if low memory mode enabled
            if (shouldSkipFeatureInLowMemory(feature.key)) {
                continue;
            }

            // Check if feature is enabled
            const isEnabled = feature.customCheck
                ? feature.customCheck()
                : config.isFeatureEnabled(feature.key);

            // ... rest of function
```

**Location**: After `retryFailedFeatures()` function (~line 691)

```javascript
/**
 * Disable features by key (runtime cleanup)
 * @param {string[]} keys - Feature keys to disable
 */
function disableFeaturesByKey(keys) {
    for (const key of keys) {
        const instance = getFeatureInstance(key);
        if (instance && typeof instance.disable === 'function') {
            try {
                instance.disable();
                console.log(`[Toolasha] Disabled feature: ${key}`);
            } catch (error) {
                console.error(`[Toolasha] Failed to disable feature: ${key}`, error);
            }
        }
    }
}
```

**Location**: Default export (~line 693)

```javascript
export default {
    initializeFeatures,
    setupCharacterSwitchHandler,
    checkFeatureHealth,
    retryFailedFeatures,
    disableFeaturesByKey, // ADD THIS LINE
    getFeature,
    getAllFeatures,
    getFeaturesByCategory,
};
```

---

### Step 3: Add UI Elements

**File**: `src/features/settings/settings-ui.js`

**Location**: Constructor (~line 13)

```javascript
constructor() {
    this.config = config;
    this.characterSwitchHandler = null;
    this.settingsContainer = null;
    this.filterText = '';
    this.filterEnabledOnly = false;
    this.filterMeta = null;
    this.performanceBanner = null;  // ADD THIS LINE
    this.performanceChip = null;     // ADD THIS LINE
    this.emptyState = null;
}
```

**Location**: After `addToolbar(card);` in `injectSettingsTab()` (~line 105)

```javascript
// Toolbar and performance banner
this.addToolbar(card);
this.addPerformanceBanner(card); // ADD THIS LINE

// Generate settings from config
this.generateSettings(card);
```

**Location**: After `addToolbar()` method (~line 195)

```javascript
/**
 * Add performance banner when low memory mode is enabled
 * @param {HTMLElement} container - Settings container
 */
addPerformanceBanner(container) {
    this.performanceBanner = document.createElement('div');
    this.performanceBanner.className = 'toolasha-performance-banner';
    this.performanceBanner.textContent = 'Performance mode is enabled. Heavy features are disabled to reduce memory/CPU. Refresh to re-enable.';
    container.appendChild(this.performanceBanner);
    this.updatePerformanceBanner();
}

/**
 * Update performance mode banner visibility
 */
updatePerformanceBanner() {
    if (!this.performanceBanner) return;
    const enabled = this.config.getSetting('lowMemoryMode');
    this.performanceBanner.style.display = enabled ? 'block' : 'none';
}

/**
 * Update performance mode chip label/state
 */
updatePerformanceChip() {
    if (!this.performanceChip) return;
    const enabled = this.config.getSetting('lowMemoryMode');
    this.performanceChip.textContent = enabled ? 'Performance mode: ON' : 'Performance mode: OFF';
    this.performanceChip.classList.toggle('active', enabled);
}

/**
 * Toggle low memory mode from toolbar
 */
toggleLowMemoryMode() {
    const input = document.getElementById('lowMemoryMode');
    if (!input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.updatePerformanceChip();
    this.updatePerformanceBanner();
}
```

**Location**: Inside `addToolbar()` method, after `enabledOnly` button (~line 158)

```javascript
enabledOnly.addEventListener('click', () => {
    this.filterEnabledOnly = !this.filterEnabledOnly;
    enabledOnly.classList.toggle('active', this.filterEnabledOnly);
    this.applyFilter();
});

// ADD PERFORMANCE CHIP HERE
this.performanceChip = document.createElement('button');
this.performanceChip.type = 'button';
this.performanceChip.className = 'toolasha-settings-chip';
this.performanceChip.addEventListener('click', () => this.toggleLowMemoryMode());

this.filterMeta = document.createElement('div');
this.filterMeta.className = 'toolasha-settings-meta';

left.appendChild(search);
left.appendChild(enabledOnly);
left.appendChild(this.performanceChip); // ADD THIS LINE
left.appendChild(this.filterMeta);
```

**Location**: End of `addToolbar()` method, before closing brace

```javascript
toolbar.appendChild(left);
toolbar.appendChild(right);
container.appendChild(toolbar);

this.updatePerformanceChip(); // ADD THIS LINE
this.updateFilterMeta(0, 0);
```

**Location**: Inside `handleSettingChange()` method, after `updateDependencies()` call (~line 390)

```javascript
// Update dependencies
this.updateDependencies();

// ADD THIS BLOCK
if (settingId === 'lowMemoryMode') {
    this.updatePerformanceBanner();
    this.updatePerformanceChip();
}

if (this.filterEnabledOnly) {
    this.applyFilter();
}
```

---

### Step 4: Add CSS Styles

**File**: `src/features/settings/settings-styles.css`

**Location**: After `.toolasha-settings-chip` styles (~line 140)

```css
.toolasha-performance-banner {
    background: linear-gradient(135deg, rgba(27, 94, 32, 0.25), rgba(11, 15, 11, 0.6));
    border: 1px solid rgba(46, 125, 50, 0.35);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 11px;
    color: var(--sly-silver);
    margin-bottom: 6px;
}
```

**Note**: `.toolasha-settings-chip.active` styles should already exist. If not, add:

```css
.toolasha-settings-chip.active {
    background: rgba(212, 175, 55, 0.2);
    border-color: rgba(212, 175, 55, 0.6);
    color: var(--sly-gold);
}
```

---

### Step 5: Add Runtime Disable Logic

**File**: `src/main.js`

**Location**: After `await config.initialize();` (~line 47)

```javascript
// Initialize config (loads settings from storage)
await config.initialize();

// ADD THIS BLOCK
// Setup performance mode listener (disable features when enabled)
config.onSettingChange('lowMemoryMode', (enabled) => {
    if (enabled) {
        featureRegistry.disableFeaturesByKey([
            'market_showEstimatedListingAge',
            'dungeonTracker',
            'enhancementTracker',
            'networth',
            'inventoryBadgePrices',
            'skillRemainingXP',
        ]);
    }
});

config.applyColorSettings();
```

---

## Feature Disable Methods Verification

All target features must have `disable()` methods. Verify these exist:

### ✅ Already Implemented

1. **market_showEstimatedListingAge** - `src/features/market/estimated-listing-age.js` has `disable()`
2. **dungeonTracker** - `src/features/combat/dungeon-tracker.js` has `disable()`
3. **enhancementTracker** - `src/features/enhancement/enhancement-tracker.js` has `disable()`
4. **networth** - `src/features/networth/index.js` has `disable()`
5. **skillRemainingXP** - Need to check
6. **inventoryBadgePrices** - Need to check

### ⚠️ May Need Implementation

- **skillRemainingXP** (`src/features/skills/remaining-xp.js`)
- **inventoryBadgePrices** (`src/features/inventory/inventory-badge-prices.js`)

---

## Testing Checklist

### Initialization Testing

- [ ] Enable performance mode in settings
- [ ] Refresh browser
- [ ] Verify heavy features do NOT initialize (check console logs)
- [ ] Verify UI banner appears at top of settings

### Runtime Testing

- [ ] Start with performance mode OFF
- [ ] Let all features load normally
- [ ] Enable performance mode via checkbox
- [ ] Verify banner appears
- [ ] Verify features are disabled (check DOM elements removed)

### Toolbar Testing

- [ ] Performance chip shows "Performance mode: OFF" initially
- [ ] Click chip → toggles to ON, banner appears
- [ ] Click chip again → toggles to OFF, banner hides
- [ ] Verify chip has gold highlight when active

### Feature-Specific Testing

- [ ] **Market listing age**: Ages should disappear when disabled
- [ ] **Dungeon tracker**: UI panel should disappear
- [ ] **Enhancement tracker**: Tracker panel should disappear
- [ ] **Networth**: Top-right networth display should disappear
- [ ] **Inventory badges**: Price badges should disappear
- [ ] **Remaining XP**: XP text under skill bars should disappear

### Edge Cases

- [ ] Enable mode → refresh → disable mode → verify features re-enable
- [ ] Character switch with mode enabled → verify mode persists
- [ ] Fast toggle (on/off/on) → verify no errors

---

## Performance Impact

**Expected Improvements** (with performance mode ON):

- **Memory**: ~30-50% reduction (no IndexedDB caching, fewer DOM observers)
- **CPU**: ~20-30% reduction (no continuous calculations for networth/XP)
- **Startup**: ~10-15% faster (6 fewer features to initialize)

**Most Impactful Disables**:

1. `market_showEstimatedListingAge` - IndexedDB writes on every market data update
2. `enhancementTracker` - IndexedDB writes on every enhancement attempt
3. `networth` - Continuous inventory value calculations
4. `dungeonTracker` - Real-time stat tracking and message parsing

---

## Implementation Order

**Recommended sequence**:

1. **Step 2** (Feature Registry) - Core logic for skipping/disabling features
2. **Step 1** (Settings Config) - Add the toggle setting
3. **Step 5** (Main.js) - Wire up runtime disable
4. **Step 4** (CSS) - Add visual styles
5. **Step 3** (Settings UI) - Add banner/chip UI elements

**Rationale**: Implement backend logic first (can test via console), then add UI on top.

---

## Alternative Approaches Considered

### 1. Individual Feature Toggles

- **Pros**: More granular control
- **Cons**: Overwhelming for average user, doesn't solve "my game is slow" problem
- **Decision**: Rejected - single toggle is better UX

### 2. Auto-Detection

- **Pros**: Could detect low-end devices automatically
- **Cons**: Hard to reliably detect, users prefer explicit control
- **Decision**: Rejected - manual toggle is safer

### 3. Performance Levels (Low/Medium/High)

- **Pros**: Could offer tiered optimization
- **Cons**: Complex to implement, hard to communicate differences
- **Decision**: Rejected - binary on/off is clearer

---

## Notes

- Performance mode banner uses green gradient (matches Toolasha theme)
- Chip button uses existing `.toolasha-settings-chip` styles
- Feature list matches Mands' implementation (6 features, excluding Smart Advisor)
- Refresh required to re-enable features (noted in banner text)
- `disable()` method cleanup is best-effort (some features may not fully clean up)

---

## Future Enhancements

Potential additions if performance mode proves popular:

1. **Performance metrics display** - Show actual memory/CPU savings
2. **Auto-suggest mode** - Detect slow performance and suggest enabling
3. **Custom feature selection** - Advanced users pick which heavy features to disable
4. **Performance profile export** - Share optimal settings with other users
