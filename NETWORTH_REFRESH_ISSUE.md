# Networth Value Changes After Page Refresh - Analysis

## User Report

"After a refresh, after some time, networth changes pretty significantly."

## Current Behavior

**Timeline:**

```
0:00  - User refreshes page
0:01  - Networth calculates with old cached market data (could be up to 14min old)
0:05  - Some feature (tooltip-prices/expected-value/tooltip-consumables) force-fetches fresh market data
0:30  - Networth 30s refresh runs, detects market hash changed
0:31  - Networth cache invalidates → recalculates ALL enhanced items → value changes
```

**Root Cause:**

- Networth uses cached market data on init: `marketAPI.fetch()` (no force)
- Other features force fresh market data: `marketAPI.fetch(true)`
- When networth's 30s refresh detects new market data, it invalidates enhancement cache
- Enhanced items (+10 to +20) have exponential cost differences with price changes
- This causes significant networth swings shortly after page load

## Technical Details

### Market Data Caching

- **Cache duration:** 15 minutes (`marketplace.js:18`)
- **Location:** IndexedDB via `storage.setJSON()`
- **Invalidation:** Hash of first 10 items' ask/bid prices (`networth-cache.js:30-42`)

### Features That Force Fresh Fetch

1. `tooltip-prices.js:65` → `marketAPI.fetch(true)`
2. `expected-value-calculator.js:68` → `marketAPI.fetch(true)`
3. `tooltip-consumables.js:41` → `marketAPI.fetch(true)`

### Networth Update Cycle

- **Initial:** `networth/index.js:37` - Calls `recalculate()` on init
- **Recurring:** `networth/index.js:34` - `setInterval(..., 30000)` every 30s
- **Calculation:** `networth-calculator.js:407` - Uses `marketAPI.fetch()` (no force)

### Enhancement Cost Cache

- **Size:** 100 items LRU cache (`networth-cache.js:8`)
- **Invalidation:** Clears entire cache when market hash changes (`networth-cache.js:48-57`)
- **Impact:** Forces recalculation of ALL enhanced items in inventory

## Proposed Solutions

### Option 1: Force Fresh Market Data on Networth Init ✅ RECOMMENDED

**Change:** `networth-calculator.js:407`

```javascript
// Current:
const marketData = await marketAPI.fetch();

// Proposed:
const marketData = await marketAPI.fetch(true);
```

**Pros:**

- Fixes user-reported issue (changes happening shortly after refresh)
- Networth shows correct value immediately on page load
- Consistent with other features

**Cons:**

- Adds 4th redundant HTTP request on page load (see Option 4)

---

### Option 2: Reduce Market Cache Duration

**Change:** `marketplace.js:18`

```javascript
// Current:
this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Proposed:
this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
```

**Pros:**

- More frequent market data updates
- Reduces staleness window

**Cons:**

- More frequent HTTP requests
- Doesn't solve immediate post-refresh issue
- Increases API load

---

### Option 3: Show "Updating..." Indicator

**Add UI feedback when market data refreshes**

**Pros:**

- User understands value is recalculating
- No performance impact

**Cons:**

- Doesn't prevent the sudden change
- Just makes it more visible

---

### Option 4: Request Deduplication (Performance Fix) ✅ RECOMMENDED

**Change:** `marketplace.js` - Add request deduplication

```javascript
class MarketAPI {
    constructor() {
        // ... existing code
        this.pendingFetch = null; // Track in-flight request
    }

    async fetch(forceFetch = false) {
        // If fetch already in progress, return existing promise
        if (this.pendingFetch) {
            return await this.pendingFetch;
        }

        // Check cache first (unless force fetch)
        if (!forceFetch) {
            const cached = await this.getCachedData();
            if (cached) {
                this.marketData = cached.data;
                this.lastFetchTimestamp = cached.timestamp;
                networkAlert.hide();
                return this.marketData;
            }
        }

        // Start new fetch and store promise
        this.pendingFetch = this.fetchFromAPI()
            .then((response) => {
                this.pendingFetch = null; // Clear on completion
                if (response) {
                    this.cacheData(response);
                    this.marketData = response.marketData;
                    this.lastFetchTimestamp = response.timestamp;
                    networkAlert.hide();
                    return this.marketData;
                }
                throw new Error('Fetch failed');
            })
            .catch((error) => {
                this.pendingFetch = null; // Clear on error
                this.logError('Fetch failed', error);
                // Fallback logic...
                throw error;
            });

        return await this.pendingFetch;
    }
}
```

**Pros:**

- Eliminates 3 redundant HTTP requests on page load
- Allows networth to force-fetch without performance cost
- All features get same fresh data simultaneously

**Cons:**

- Slightly more complex code
- Requires careful promise management

**Current requests on page load:** 3
**After deduplication:** 1

---

## Recommended Implementation

**Combine Option 1 + Option 4:**

1. Add request deduplication to `marketplace.js`
2. Change networth to force-fetch in `networth-calculator.js`

**Result:**

- ✅ Fixes user-reported issue (no sudden changes after refresh)
- ✅ Improves performance (3 requests → 1)
- ✅ All features get fresh data consistently
- ✅ No additional API load

**Timeline with fix:**

```
0:00  - User refreshes page
0:01  - All 4 features request fresh data → deduped to 1 HTTP request
0:02  - Networth calculates with fresh data → Shows $48M
0:30  - Networth 30s refresh, market unchanged → Shows $48M
15:00 - Market cache expires
15:30 - Networth fetches new data (prices changed) → Shows $46M ← Expected behavior
```

## Files to Modify

1. **`src/api/marketplace.js`** - Add request deduplication
2. **`src/features/networth/networth-calculator.js:407`** - Change to `fetch(true)`

## Testing Checklist

- [ ] Page refresh shows stable networth value
- [ ] No sudden changes within first 2 minutes
- [ ] Console shows only 1 marketplace.json request on page load (not 3-4)
- [ ] Networth updates correctly every 30 seconds
- [ ] Market data changes after 15+ minutes reflect in networth

## Related Code References

- **Networth refresh:** `src/features/networth/index.js:34` (30s interval)
- **Market cache:** `src/api/marketplace.js:18` (15 min duration)
- **Enhancement cache:** `src/features/networth/networth-cache.js:48-57` (invalidation)
- **Force-fetch features:** See "Features That Force Fresh Fetch" section above

---

**Status:** Not yet implemented
**Priority:** Medium (user-visible issue, but not breaking)
**Estimated effort:** 30 minutes
