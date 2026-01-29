# Market Features Implementation Plan
## Ranged Way Idle → Toolasha Integration

**Status Overview:**
- ✅ **Feature 1: Visible Item Count** - IMPLEMENTED & WORKING
- ❌ **Feature 2: Total Listing Funds** - NOT YET IMPLEMENTED (future)
- ✅ **Feature 3: Individual Listing Price Display** - IMPLEMENTED & WORKING
- ❌ **Feature 4: Listing Lifespan Display** - NOT YET IMPLEMENTED (future)

This document provides detailed implementation specifications for porting market features from Ranged Way Idle into Toolasha.

---

## FEATURE 1: Visible Item Count in Market

**✅ STATUS: IMPLEMENTED** - This feature is complete and working in `src/features/market/item-count-display.js`. We are not planning further updates at this time but keeping this documentation for potential future enhancements.

**Description:** Display inventory counts on market item tiles/cards, showing how many of each item you own.

**Technical Implementation:**
- **DOM Target:** Market item cards/tiles (likely class contains `MarketItem` or similar)
- **Data Source:** `dataManager.getInventory()` for inventory items
- **Equipped Items:** `dataManager.getEquipment()` for currently equipped gear
- **Update Triggers:**
  - `items_updated` event from dataManager
  - `market_item_order_books_updated` WebSocket event
  - DOM observer when market UI opens

**Display Logic:**
```javascript
// For each market item tile:
// 1. Get itemHrid from tile
// 2. Count from inventory (all enhancement levels)
// 3. If setting enabled, add equipped count
// 4. Create overlay element with count
// 5. Apply opacity based on: count > 0 ? 1.0 : settingValue
```

**CSS Styling:**
- Position: absolute top-right corner of item tile
- Background: semi-transparent badge (e.g., `rgba(0,0,0,0.8)`)
- Font: Small, bold, white text
- Border-radius: rounded badge
- Z-index: Layer above item image

**Settings:**
```javascript
market_visibleItemCount: {
    id: 'market_visibleItemCount',
    label: 'Market: Show inventory count on items',
    type: 'checkbox',
    default: true,
    help: 'Displays how many of each item you own when browsing the market'
}

market_visibleItemCountOpacity: {
    id: 'market_visibleItemCountOpacity',
    label: 'Market: Opacity for items not in inventory',
    type: 'slider',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    dependencies: ['market_visibleItemCount'],
    help: 'How transparent item tiles appear when you own zero of that item'
}

market_visibleItemCountIncludeEquipped: {
    id: 'market_visibleItemCountIncludeEquipped',
    label: 'Market: Count equipped items',
    type: 'checkbox',
    default: true,
    dependencies: ['market_visibleItemCount'],
    help: 'Include currently equipped items in the displayed count'
}
```

**File Location:** `src/features/market/item-count-display.js`

**Module Structure:**
```javascript
class ItemCountDisplay {
    constructor() {
        this.itemElements = new Map(); // marketTile → displayElement
        this.unregisterObserver = null;
    }

    initialize() { /* setup observer, event listeners */ }
    injectCountDisplay(marketTile) { /* add count badge */ }
    updateCount(marketTile) { /* recalculate and update */ }
    updateAllCounts() { /* bulk update */ }
    disable() { /* cleanup */ }
}
```

**Edge Cases:**
- Handle items with multiple enhancement levels (sum all levels)
- Handle stackable vs non-stackable items
- Market UI lazy loading (items added as you scroll)
- Equipped items may have different enhancement levels than inventory

---

## FEATURE 2: Total Listing Funds

**Description:** Display aggregate summary showing total coins locked in buy orders, expected revenue from sell orders, and unclaimed coins.

**Technical Implementation (from RWI lines 1728-1792):**
- **Data Source:** `market_listings_updated` WebSocket event + `init_character_data`
- **Display Approach:** Clone existing coin stack UI elements (NOT a custom box)
- **DOM Target:** `.MarketplacePanel_marketplacePanel` container
- **Coin Stack Element:** `.MarketplacePanel_coinStack` (game's existing coin display)

**Calculations:**
```javascript
totalUnclaimedCoins = sum(listing.unclaimedCoinCount)
totalPrepaidCoins = sum(listing.coinsAvailable)  // Coins locked in buy orders
totalSellResultCoins = sum for sell listings:
    const tax = listing.itemHrid === "/items/bag_of_10_cowbells" ? 0.82 : 0.98
    (orderQuantity - filledQuantity) * floor(price * tax)
```

**Display Layout (2x2 Grid using absolute positioning):**
```
[Current Coins]      [Prepaid Coins]
[Unclaimed Coins]    [Sell Result Coins]

Position coordinates (rem):
- Current:     left: 0,   top: 0
- Unclaimed:   left: 0,   top: 1.5
- Prepaid:     left: 8,   top: 0
- Sell Result: left: 8,   top: 1.5
```

**Implementation Details:**
```javascript
// Clone the existing coin stack element 3 times
const currentCoinNode = marketplacePanelNode.querySelector(".MarketplacePanel_coinStack__1l0UD");
const totalUnclaimedCoinsNode = currentCoinNode.cloneNode(true);
const totalPrepaidCoinsNode = currentCoinNode.cloneNode(true);
const totalSellResultCoinsNode = currentCoinNode.cloneNode(true);

// Update count text (.Item_count__1HVvv)
totalUnclaimedCoinsNode.querySelector(".Item_count__1HVvv").textContent = formatItemCount(totalUnclaimedCoins, precision);

// Update label text (.Item_name__2C42x) with blue color
totalUnclaimedCoinsNode.querySelector(".Item_name__2C42x").textContent = "Unclaimed";
totalUnclaimedCoinsNode.querySelector(".Item_name__2C42x").style.color = "#66CCFF";

// Position using absolute positioning
totalUnclaimedCoinsNode.style.left = "0rem";
totalUnclaimedCoinsNode.style.top = "1.5rem";

// Add tracking class
totalUnclaimedCoinsNode.classList.add("RangedWayIdleTotalListingFunds");

// Insert into DOM
marketplacePanelNode.insertBefore(totalUnclaimedCoinsNode, currentCoinNode.nextSibling);
```

**Settings:**
```javascript
market_totalListingFunds: {
    id: 'market_totalListingFunds',
    label: 'Market: Show total listing funds summary',
    type: 'checkbox',
    default: true,
    help: 'Displays total prepaid coins, expected revenue, and unclaimed coins'
}

market_totalListingFundsPrecision: {
    id: 'market_totalListingFundsPrecision',
    label: 'Market: Decimal precision for listing funds',
    type: 'number',
    default: 0,
    min: 0,
    max: 2,
    dependencies: ['market_totalListingFunds'],
    help: 'Number of decimal places to show (0 = whole numbers)'
}
```

**File Location:** `src/features/market/listing-funds-summary.js`

**Module Structure:**
```javascript
class ListingFundsSummary {
    constructor() {
        this.allListings = {}; // Maintained listing state
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
    }

    initialize() {
        // Listen for WebSocket events
        // Setup DOM observer for market panel
    }

    handleListing(listing) {
        // Store/update listing data
        // Filter out cancelled and fully claimed listings
    }

    calculateTotals() {
        // Sum unclaimed, prepaid, and sell result coins
        // Apply tax calculation (0.82 for cowbells, 0.98 for others)
    }

    injectCoinDisplays(marketPanel) {
        // Clone existing coin stack element
        // Position 3 new displays in 2x2 grid
        // Update counts and labels
    }

    disable() {
        // Remove injected elements (.RangedWayIdleTotalListingFunds)
        // Unregister listeners
    }
}
```

**WebSocket Event Fields:**
```javascript
// init_character_data event:
{
    myMarketListings: [...]
}

// market_listings_updated event:
{
    endMarketListings: [
        {
            id: 123,
            isSell: true,
            itemHrid: "/items/cheese",
            enhancementLevel: 0,
            orderQuantity: 100,
            filledQuantity: 25,
            price: 1000,
            coinsAvailable: 75000,  // Prepaid coins for buy orders
            unclaimedItemCount: 0,
            unclaimedCoinCount: 25000,  // Unclaimed coins from filled sells
            createdTimestamp: "2025-01-12T10:00:00Z",
            status: "/market_listing_status/active"
        }
    ]
}
```

**Edge Cases:**
- Cowbell listings use 0.82 tax rate (vs 0.98 for other items)
- Cancelled listings: Remove from tracking (status check)
- Fully claimed listings: Remove when unclaimedItemCount and unclaimedCoinCount both zero
- Partially filled sell orders: Use (orderQuantity - filledQuantity) for expected revenue
- DOM cleanup: Remove all elements with tracking class on WebSocket update

---

## FEATURE 3: Individual Listing Price Display

**✅ STATUS: IMPLEMENTED** - This feature is complete and working in `src/features/market/listing-price-display.js`. We are not planning further updates at this time but keeping this documentation for potential future enhancements.

**Description:** Show price per unit and total value for each active listing in your listings panel.

**Technical Implementation:**
- **DOM Target:** Listing rows in "My Listings" panel
- **Data Source:** Same `market_listings_updated` WebSocket data
- **Display:** Inject price text into each listing row

**Display Format:**
```
[Item Icon] Iron Bar x50
           12,345 each → 617,250 total
```

**Settings:**
```javascript
market_showListingPrices: {
    id: 'market_showListingPrices',
    label: 'Market: Show prices on individual listings',
    type: 'checkbox',
    default: true,
    help: 'Displays per-unit price and total value on each listing'
}

market_listingPricePrecision: {
    id: 'market_listingPricePrecision',
    label: 'Market: Price decimal precision',
    type: 'number',
    default: 2,
    min: 0,
    max: 4,
    dependencies: ['market_showListingPrices'],
    help: 'Number of decimal places to show for prices'
}
```

**File Location:** `src/features/market/listing-price-display.js`

**Module Structure:**
```javascript
class ListingPriceDisplay {
    constructor() {
        this.listingElements = new Map(); // listingRow → priceElement
        this.unregisterObserver = null;
    }

    initialize() { /* WebSocket listener, DOM observer */ }
    injectPriceDisplay(listingRow, listingData) { /* add price text */ }
    updatePrice(listingRow, listingData) { /* recalculate */ }
    updateAllPrices() { /* bulk update */ }
    disable() { /* cleanup */ }
}
```

**CSS Styling:**
- Font size: slightly smaller than item name
- Color: different colors for buy (blue) vs sell (green) orders
- Format: Use formatWithSeparator for thousand separators

**Edge Cases:**
- Partially filled listings (show remaining quantity × price)
- Very large numbers (use KMB formatting option)
- Listings completing mid-view (update in real-time)

---

## FEATURE 4: Listing Lifespan Display

**Description:** Show relative time ("3h ago") instead of absolute timestamp ("2:30 PM") for listing creation times.

**Technical Implementation:**
- **Data Source:** Listing timestamp from WebSocket data
- **Calculation:**
  ```javascript
  const ageMs = Date.now() - listing.timestamp;
  const formatted = formatRelativeTime(ageMs);
  // Examples: "5m", "2h 30m", "3d 12h", "14d"
  ```
- **Update Frequency:** Every 1 minute (setInterval)

**Display Format:**
```
Created: 3h 45m ago    (vs. "Created: 2:30 PM")
```

**Time Format Rules:**
- < 1 hour: "Xm" (minutes only)
- 1-24 hours: "Xh Ym" (hours and minutes)
- 1-7 days: "Xd Yh" (days and hours)
- > 7 days: "Xd" (days only)

**Settings:**
```javascript
market_showListingLifespan: {
    id: 'market_showListingLifespan',
    label: 'Market: Show listing age as relative time',
    type: 'checkbox',
    default: false,
    dependencies: ['market_showListingPrices'],
    help: 'Display "3h ago" instead of "2:30 PM" for listing creation times'
}
```

**File Location:** `src/features/market/listing-price-display.js` (extend existing module)

**Implementation:**
- Add to existing ListingPriceDisplay module
- Create `formatRelativeTime(ageMs)` utility function
- Add periodic update timer (clear on disable)

**Utility Function:**
```javascript
function formatRelativeTime(ageMs) {
    const minutes = Math.floor(ageMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) return `${days}d`;
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}
```

**Edge Cases:**
- Very new listings (< 1 minute): Show "Just now"
- Very old listings (> 30 days): Show "30+ days"
- Timezone handling (use UTC timestamps)

---

## Feature Registry Integration

Add to `src/core/feature-registry.js`:

```javascript
// Market Features (add to registry array)
{
    key: 'market_visibleItemCount',
    name: 'Market Item Count Display',
    category: 'Market',
    initialize: () => itemCountDisplay.initialize(),
    async: false
},
{
    key: 'market_totalListingFunds',
    name: 'Market Listing Funds Summary',
    category: 'Market',
    initialize: () => listingFundsSummary.initialize(),
    async: false
},
{
    key: 'market_showListingPrices',
    name: 'Market Listing Price Display',
    category: 'Market',
    initialize: () => listingPriceDisplay.initialize(),
    async: false
}
```

---

## Testing Checklist

**✅ FEATURE 1 (Item Count Display) - TESTED & WORKING:**
- [x] Settings appear in Toolasha settings panel
- [x] Settings persist after page refresh
- [x] Feature works on initial page load
- [x] Feature works when navigating to market after page load
- [x] Updates occur when inventory/listings change
- [x] No console errors
- [x] Performance is acceptable (no lag)
- [x] Disabling setting removes UI elements
- [x] Works with existing Toolasha features (no conflicts)
- [x] Opacity slider fixed and working correctly
- [x] Tested with 0 items, 1 item, many items, equipped items, enhanced items

**✅ FEATURE 3 (Listing Price Display) - TESTED & WORKING:**
- [x] Settings appear in Toolasha settings panel
- [x] Settings persist after page refresh
- [x] Feature works on initial page load
- [x] Feature works when navigating to market after page load
- [x] Updates occur when inventory/listings change
- [x] No console errors
- [x] Performance is acceptable (no lag)
- [x] Disabling setting removes UI elements
- [x] Works with existing Toolasha features (no conflicts)
- [x] K/M suffix parsing fixed (340K → 340,000)
- [x] KMB formatting matches game UI
- [x] Batch pricing optimization implemented
- [x] Tested with very large numbers, partially filled listings

**❌ FEATURE 2 (Listing Funds Summary) - NOT YET IMPLEMENTED:**
- [ ] Settings appear in Toolasha settings panel
- [ ] Settings persist after page refresh
- [ ] Feature works on initial page load
- [ ] Feature works when navigating to market after page load
- [ ] Updates occur when inventory/listings change
- [ ] No console errors
- [ ] Performance is acceptable (no lag)
- [ ] Disabling setting removes UI elements
- [ ] Works with existing Toolasha features (no conflicts)
- [ ] Test with no listings, buy orders, sell orders, mixed, filled/unclaimed

**❌ FEATURE 4 (Lifespan Display) - NOT YET IMPLEMENTED:**
- [ ] Settings appear in Toolasha settings panel
- [ ] Settings persist after page refresh
- [ ] Feature works on initial page load
- [ ] Feature works when navigating to market after page load
- [ ] Updates occur when inventory/listings change
- [ ] No console errors
- [ ] Performance is acceptable (no lag)
- [ ] Disabling setting removes UI elements
- [ ] Works with existing Toolasha features (no conflicts)
- [ ] Test with brand new listings, old listings, across day boundaries

---

## Dependencies & Imports

**Required Imports:**
```javascript
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import webSocketHook from '../../core/websocket.js';
import { formatWithSeparator, formatKMB } from '../../utils/formatters.js';
```

**WebSocket Events Used:**
- `market_listings_updated`: Listing changes (create, fill, cancel)
- `market_item_order_books_updated`: Order book updates (affects item count display)
- `items_updated`: Inventory changes

---

## Performance Considerations

**Optimization Strategies:**
1. **Debounce Updates:** Don't update on every keystroke/inventory change
2. **Lazy Loading:** Only inject displays for visible elements
3. **Cached Calculations:** Store computed totals, only recalc on data change
4. **Efficient Selectors:** Use specific class names, avoid expensive DOM queries
5. **Cleanup:** Remove event listeners and DOM elements on disable

**Memory Management:**
- Use WeakMap for element references where possible
- Clear stale references when DOM elements are removed
- Limit storage of historical data (don't store all order book history)

---

## Implementation Order

**✅ Completed:**
1. ✅ Feature #1: Visible Item Count in Market (`item-count-display.js`)
2. ✅ Feature #3: Individual Listing Price Display (`listing-price-display.js`)

**📋 Remaining:**
3. ❌ Feature #2: Total Listing Funds Summary (easiest, high value - marked for future implementation)
4. ❌ Feature #4: Listing Lifespan Display (quick enhancement to #3 - marked for future implementation)
