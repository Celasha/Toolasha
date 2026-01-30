# Missing Materials Marketplace Feature

## Feature Overview

When viewing a production action panel (e.g., Spaceberry Cake), if materials are missing from inventory, a button appears that:

1. Opens the Marketplace
2. Creates custom tabs for each missing material
3. Shows quantity missing on each tab
4. Clicking a tab opens that item's order book directly

## User Requirements Summary

### Screenshots Reference

- **a1.webp**: Shows Spaceberry Cake action panel with missing materials (Egg: 266, Wheat: 266, Spaceberry: 532)
- **a2.webp**: Mockup of custom marketplace tabs (colors/appearance not final - use MUI defaults)

### Scope & Behavior

**1. Button Placement**

- ✅ Show on ALL production action panels (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
- ❌ NOT on gathering actions (Foraging, Woodcutting, Milking)
- Button text: "Missing Mats Marketplace"
- Visibility: Always show button, even if no materials missing

**2. Market Navigation**

- Simulate click on marketplace navbar element:

    ```html
    <div class="NavigationBar_nav__3uuUl">
        <svg role="img" aria-label="navigationBar.marketplace">...</svg>
        <div class="NavigationBar_label__1uH-y">Marketplace</div>
    </div>
    ```

- Default tab: Leave as-is (likely "Market Listings")

**3. Custom Tab Persistence**

- **Within marketplace**: Tabs persist while staying in marketplace
- **Navigation away**: Tabs disappear when leaving marketplace
- **Re-accessing**: Only way to get tabs back is clicking button again
- **New action**: Clicking button from different action **REPLACES** all previous tabs
- **Same action again**: Not possible (requires leaving marketplace to access action panel)

**4. Tab Click Behavior**

- Clicking custom tab → Opens item's order book directly
- Reference: Shift+click item in action panel opens order book (e.g., a1.webp Egg icon)
- Similar to MWI Combat Suite: Click item image → opens order book

**5. Missing Quantity Display**

- **Preference**: Live updates (concern: performance/implementation complexity)
- **Discussion needed**: Static vs live update tradeoffs

**6. Non-Tradeable Items**

- If material cannot be bought on market → Gray out tab (different styling)
- Don't skip entirely, visually indicate unavailability

**7. Zero Inventory Items**

- No differentiation between "have zero" vs "never obtained"
- Both treated as "Missing: [full amount]"

**8. Styling Standards**

- Use **game's default MUI tab styling** (match existing tabs)
- Not custom Toolasha colors

---

## Technical Analysis

### Existing Code Structure

**Core Files:**

- `src/features/actions/panel-observer.js` - Detects action panels
- `src/features/actions/production-profit.js` - Production profit calculations
- `src/features/market/profit-calculator.js` - Parses `inputItems` for materials
- `src/core/data-manager.js` - Inventory access via `getInventory()`

**Material Detection (Already Exists):**

```javascript
// Actions have inputItems structure
actionDetails.inputItems[] = {
  itemHrid: '/items/egg',
  count: 500
}

// Inventory structure
dataManager.getInventory() = [{
  itemLocationHrid: '/item_locations/inventory',
  itemHrid: '/items/egg',
  count: 234
}]

// Missing calculation
missing = required - (inventoryCount || 0)
```

**Market Tab Structure:**

```html
<div class="MuiTabs-flexContainer css-k008qs" role="tablist">
    <button class="MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary Mui-selected" role="tab" aria-selected="true">
        <span class="MuiBadge-root TabsComponent_badge__1Du26"> Market Listings </span>
    </button>
    <button class="MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary" role="tab" aria-selected="false">
        <span class="MuiBadge-root TabsComponent_badge__1Du26"> My Listings </span>
    </button>
</div>
```

**Navigation Pattern:**

```javascript
// No existing code navigates programmatically to marketplace
// All market features use DOM observers waiting for elements to appear
// Navbar marketplace element selector:
'.NavigationBar_nav__3uuUl' + contains '[aria-label="navigationBar.marketplace"]'
```

**Order Book Access:**

- Shift+click on item in action panel → opens order book
- MWI Combat Suite pattern: Single click item image → order book
- Need to determine: How does shift+click work internally? DOM event simulation?

---

## Implementation Plan

### Phase 1: Button Creation & Material Detection

**New Module:** `src/features/actions/missing-materials-button.js`

**Integration Point:** `panel-observer.js` → `handleActionPanel()` function

**Steps:**

1. Check if action is production type (`PRODUCTION_TYPES`)
2. Parse `actionDetails.inputItems[]` to get required materials
3. Query `dataManager.getInventory()` for current counts
4. Calculate missing amounts for each material
5. Create button: "Missing Mats Marketplace"
6. Inject button into action panel (positioning TBD - ask user)

**Material Detection Function:**

```javascript
function getMissingMaterials(actionHrid) {
    const actionDetails = dataManager.getActionDetails(actionHrid);
    const inventory = dataManager.getInventory();
    const gameData = dataManager.getInitClientData();

    if (!actionDetails?.inputItems) return [];

    const missing = [];
    for (const input of actionDetails.inputItems) {
        const required = input.count || input.amount || 1;
        const inventoryItem = inventory.find((i) => i.itemHrid === input.itemHrid);
        const have = inventoryItem?.count || 0;
        const missingAmount = Math.max(0, required - have);

        const itemDetails = gameData.itemDetailMap[input.itemHrid];

        missing.push({
            itemHrid: input.itemHrid,
            itemName: itemDetails?.name || 'Unknown',
            required: required,
            have: have,
            missing: missingAmount,
            isTradeable: checkIfTradeable(itemDetails), // TODO: Define logic
        });
    }

    return missing;
}
```

### Phase 2: Marketplace Navigation

**Challenge:** Game is SPA, no existing code navigates programmatically

**Approach:** Simulate click on navbar marketplace element

**Steps:**

1. Find navbar marketplace button: `.NavigationBar_nav__3uuUl` with `[aria-label="navigationBar.marketplace"]`
2. Trigger click event (React may require special handling)
3. Wait for marketplace panel to appear (DOM observer or polling)
4. Proceed to tab creation once marketplace is open

**Navigation Function:**

```javascript
async function navigateToMarketplace() {
    // Find marketplace navbar button
    const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
    const marketplaceButton = Array.from(navButtons).find((nav) => {
        const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
        return svg !== null;
    });

    if (!marketplaceButton) {
        console.error('[MissingMats] Marketplace navbar button not found');
        return false;
    }

    // Simulate click (may need React event handling)
    marketplaceButton.click();

    // Wait for marketplace panel to appear
    return await waitForMarketplace();
}

async function waitForMarketplace() {
    // Poll for marketplace panel (with timeout)
    const maxAttempts = 50;
    const delayMs = 100;

    for (let i = 0; i < maxAttempts; i++) {
        const marketPanel = document.querySelector('[class*="MarketplacePanel"]');
        if (marketPanel) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.error('[MissingMats] Marketplace did not open within timeout');
    return false;
}
```

### Phase 3: Custom Tab Creation

**Challenge:** Inject custom tabs into MUI tabs container, match game styling

**DOM Target:** `.MuiTabs-flexContainer[role="tablist"]`

**Tab Structure:** Clone existing MUI tab button, customize content

**Steps:**

1. Wait for marketplace to open (Phase 2)
2. Find tabs container: `.MuiTabs-flexContainer`
3. Store reference to missing materials (from button click context)
4. Create custom tab for each missing material
5. Add click handlers to each tab
6. Insert tabs after "My Listings" tab

**Tab Creation Function:**

```javascript
function createMissingMaterialTabs(missingMaterials) {
    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');

    if (!tabsContainer) {
        console.error('[MissingMats] Tabs container not found');
        return;
    }

    // Remove any existing custom tabs first
    removeMissingMaterialTabs();

    // Get reference tab for cloning (use "My Listings" as template)
    const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));

    if (!referenceTab) {
        console.error('[MissingMats] Reference tab not found');
        return;
    }

    // Create tab for each missing material
    for (const material of missingMaterials) {
        const tab = createCustomTab(material, referenceTab);
        tabsContainer.appendChild(tab);
    }
}

function createCustomTab(material, referenceTab) {
    // Clone reference tab structure
    const tab = referenceTab.cloneNode(true);

    // Mark as custom tab for later identification
    tab.setAttribute('data-mwi-custom-tab', 'true');
    tab.setAttribute('data-item-hrid', material.itemHrid);

    // Update text content
    const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
    if (badgeSpan) {
        badgeSpan.innerHTML = `
      <div style="text-align: center;">
        <div>${material.itemName.toUpperCase()}</div>
        <div style="font-size: 0.75em; color: ${material.missing > 0 ? 'red' : 'green'};">
          Missing: ${material.missing}
        </div>
      </div>
    `;
    }

    // Gray out if not tradeable
    if (!material.isTradeable) {
        tab.style.opacity = '0.5';
        tab.style.cursor = 'not-allowed';
    }

    // Remove selected state
    tab.classList.remove('Mui-selected');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');

    // Add click handler
    tab.addEventListener('click', (e) => {
        if (material.isTradeable) {
            e.preventDefault();
            e.stopPropagation();
            openOrderBook(material.itemHrid);
        }
    });

    return tab;
}

function removeMissingMaterialTabs() {
    const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
    customTabs.forEach((tab) => tab.remove());
}
```

### Phase 4: Order Book Navigation

**✅ SOLVED - MCS Research Complete!**

**Source:** `/Users/kennydean/Downloads/MWI/mcs-master/modules/CRack.js` lines 1859-1883

**Mechanism:** Shift+click on item in inventory opens order book

1. Find the inventory panel (`.Inventory_inventory__17CH2`)
2. Search for item element by matching sprite ID in `<use>` href
3. Create MouseEvent with `shiftKey: true`
4. Dispatch event on item element

**Implementation:**

```javascript
function openOrderBook(itemHrid) {
    // Extract sprite ID from HRID
    const spriteId = itemHrid.replace('/items/', '');

    // Find inventory panel
    const inventoryPanel = document.querySelector('.Inventory_inventory__17CH2');
    if (!inventoryPanel) {
        console.error('[MissingMats] Inventory panel not found');
        return false;
    }

    // Find all clickable items in inventory
    const inventoryItems = inventoryPanel.querySelectorAll('.Item_item__2De2O.Item_clickable__3viV6');

    for (const itemElement of inventoryItems) {
        const useElement = itemElement.querySelector('use');
        if (useElement) {
            const href = useElement.getAttribute('href');

            // Match item by sprite ID
            if (href && href.includes(`#${spriteId}`)) {
                // Simulate shift+click to open order book
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    shiftKey: true, // KEY: This triggers order book
                });

                itemElement.dispatchEvent(clickEvent);
                return true;
            }
        }
    }

    console.warn('[MissingMats] Item not found in inventory:', itemHrid);
    return false;
}
```

**Critical Note:** Item must exist in player's inventory to open order book!

**Implications:**

- If player has zero of a material, shift+click won't work
- Need to handle this edge case:
    - Option A: Show warning message to user
    - Option B: Disable/gray out tab if item not in inventory
    - Option C: Use alternative navigation (manual marketplace search?)

**Recommendation:** For missing materials with zero inventory count, we should still create the tab but handle the click gracefully with a fallback message like "Add at least 1 to inventory to view order book"

### Phase 5: Cleanup & Persistence

**Tab Cleanup Triggers:**

- User navigates away from marketplace
- User clicks "Missing Mats Marketplace" button again (new materials)

**Cleanup Implementation:**

```javascript
// Watch for marketplace panel removal
function setupCleanupObserver() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const removedNode of mutation.removedNodes) {
                if (removedNode.classList?.contains('MarketplacePanel_container')) {
                    // Marketplace closed, remove custom tabs
                    removeMissingMaterialTabs();
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}
```

### Phase 6: Live Updates (Optional/Future)

**Performance Concerns:**

- Inventory updates trigger `items_updated` event from dataManager
- Could cause frequent re-calculations on every inventory change
- May need throttling/debouncing

**Implementation Options:**

**Option A: Event-driven updates**

```javascript
dataManager.on('items_updated', () => {
    updateMissingMaterialTabCounts();
});

function updateMissingMaterialTabCounts() {
    const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
    const inventory = dataManager.getInventory();

    customTabs.forEach((tab) => {
        const itemHrid = tab.getAttribute('data-item-hrid');
        const required = tab.getAttribute('data-required'); // Store during creation
        const inventoryItem = inventory.find((i) => i.itemHrid === itemHrid);
        const have = inventoryItem?.count || 0;
        const missing = Math.max(0, required - have);

        // Update tab display
        const missingDiv = tab.querySelector('[data-missing-count]');
        if (missingDiv) {
            missingDiv.textContent = `Missing: ${missing}`;
            missingDiv.style.color = missing > 0 ? 'red' : 'green';
        }
    });
}
```

**Option B: Polling (less efficient)**

```javascript
let updateInterval = null;

function startLiveUpdates() {
    updateInterval = setInterval(() => {
        updateMissingMaterialTabCounts();
    }, 5000); // Update every 5 seconds
}

function stopLiveUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}
```

**Recommendation:**

- Start with **static counts** (calculated once on button click)
- Add live updates as enhancement if user requests it
- Performance impact minimal if properly throttled

---

## Open Questions & Research Needed

### 1. Button Placement in Action Panel

**Question:** Where exactly should "Missing Mats Marketplace" button appear?

- Above drop table?
- Below drop table?
- Near "Start Now" button?
- Other location?

**User input needed:** Screenshot or description of preferred location

### 2. Order Book Navigation

**Critical Research:** How does shift+click on item icon open order book?

**Investigation steps:**

1. Open Spaceberry Cake action panel (a1.webp)
2. Open browser DevTools → Elements tab
3. Inspect Egg icon element
4. Shift+click Egg icon
5. Observe:
    - DOM changes
    - Network requests
    - Console logs
    - URL changes
    - React component updates

**Alternative:** Check MWI Combat Suite source code

- Location: `/Users/kennydean/Downloads/MWI/mcs-master`
- Search for order book / marketplace navigation logic
- File likely in features or utilities folder

### 3. Tradeable Item Detection

**Question:** How to determine if item is tradeable on marketplace?

**Possible approaches:**

- Check `itemDetails.isTradeable` flag (if exists)
- Check if item appears in market API data
- Hardcoded list of non-tradeable item categories
- Check item category HRIDs (e.g., `/item_categories/quest_items`)

**Research needed:** Inspect init_client_data.json for relevant fields

### 4. React Event Handling

**Question:** Does clicking cloned MUI button trigger React properly?

**Considerations:**

- MUI tabs likely have React event handlers
- Cloning DOM may not clone React handlers
- May need to trigger React's `onClick` directly via `_reactProps`
- Or re-implement tab switching logic ourselves

**Testing needed:** Verify cloned tabs respond to clicks correctly

---

## Testing Plan

### Manual Testing Checklist

**Phase 1 Tests:**

- [ ] Button appears on Brewing action panels
- [ ] Button appears on Cooking action panels
- [ ] Button appears on Crafting action panels
- [ ] Button appears on Tailoring action panels
- [ ] Button appears on Cheesesmithing action panels
- [ ] Button does NOT appear on Foraging panels
- [ ] Button does NOT appear on Woodcutting panels
- [ ] Button does NOT appear on Milking panels
- [ ] Button appears even when no materials missing
- [ ] Material detection correctly calculates missing counts

**Phase 2 Tests:**

- [ ] Clicking button navigates to marketplace
- [ ] Navigation works from different locations
- [ ] Marketplace opens to default tab
- [ ] No errors in console during navigation

**Phase 3 Tests:**

- [ ] Custom tabs appear after navigation
- [ ] Tab count matches number of missing materials
- [ ] Tab styling matches game's MUI tabs
- [ ] Tab text formatting is correct (item name + missing count)
- [ ] Non-tradeable items are grayed out
- [ ] Clicking button again replaces existing tabs
- [ ] Tabs persist while staying in marketplace
- [ ] Tabs disappear when leaving marketplace

**Phase 4 Tests:**

- [ ] Clicking custom tab opens correct order book
- [ ] Order book shows correct item
- [ ] Navigation works for all material types
- [ ] Grayed out tabs do not open order books

**Phase 5 Tests:**

- [ ] Cleanup triggers when marketplace closes
- [ ] No memory leaks from observers
- [ ] No duplicate tabs created

### Edge Cases

**Test Scenarios:**

1. Action with 0 missing materials
2. Action with 1 missing material
3. Action with 5+ missing materials
4. Material with 0 inventory vs never obtained
5. Material that's non-tradeable
6. Material with negative inventory (if possible)
7. Rapid button clicking
8. Opening marketplace manually before clicking button
9. Switching between multiple production actions quickly
10. Browser refresh while custom tabs exist

---

## Settings Integration

**New Setting:** `src/features/settings/settings-config.js`

```javascript
{
  id: 'actions_missingMaterialsButton',
  label: 'Show "Missing Mats Marketplace" button',
  type: 'checkbox',
  default: true,
  dependencies: [],
  help: 'Adds button to production panels that opens marketplace with tabs for missing materials',
}
```

**Feature Registry:** `src/core/feature-registry.js`

```javascript
{
  name: 'Missing Materials Button',
  module: () => import('../features/actions/missing-materials-button.js'),
  initialize: (module) => module.initialize(),
  cleanup: (module) => module.cleanup(),
  setting: 'actions_missingMaterialsButton'
}
```

---

## Code Style Guidelines

**Follow Toolasha patterns:**

- 4 spaces indentation
- Single quotes
- Semicolons required
- 120 char line length
- JSDoc comments for all functions
- Async/await (not .then())
- Module-prefixed console logs: `[MissingMats]`

**File structure:**

```javascript
/**
 * Missing Materials Marketplace Button
 * Adds button to production panels that opens marketplace with tabs for missing materials
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import { waitForElement } from '../../utils/dom.js';

// Module-level state
let activeButton = null;
let currentMaterials = [];

/**
 * Initialize missing materials button feature
 */
export function initialize() {
    // Setup code
}

/**
 * Cleanup function
 */
export function cleanup() {
    // Cleanup code
}

export default {
    initialize,
    cleanup,
};
```

---

## Performance Considerations

**Concerns:**

1. DOM queries for tabs container (mitigate with caching)
2. Live updates frequency (use throttling if implemented)
3. Memory leaks from observers (proper cleanup in feature.cleanup())
4. Multiple button instances if user switches actions quickly

**Optimizations:**

- Cache DOM queries where possible
- Use event delegation instead of multiple listeners
- Debounce/throttle inventory update handlers
- Clear state on cleanup

---

## Next Steps

**Immediate Actions:**

1. **USER DECISION:** Where should button appear in action panel?
2. **RESEARCH:** How does shift+click open order book? (inspect game or check MCS source)
3. **RESEARCH:** How to detect tradeable items? (check init_client_data fields)
4. **DECISION:** Static vs live quantity updates? (implement static first, add live later?)

**Implementation Order:**

1. Create button + material detection (can test independently)
2. Add marketplace navigation (can test independently)
3. Add custom tab creation (requires #1 and #2)
4. Add order book navigation (requires research)
5. Add cleanup logic
6. Add live updates (optional enhancement)
7. Add tests
8. Add documentation

**Timeline Estimate:**

- Phase 1-2: 2-3 hours (button + navigation)
- Phase 3: 2-3 hours (tab creation + styling)
- Phase 4: 1-4 hours (depends on order book complexity)
- Phase 5-6: 1-2 hours (cleanup + optional live updates)
- Testing: 1-2 hours
- **Total: 7-14 hours** (highly dependent on order book research)
