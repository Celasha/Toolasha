# High Enhancement Item Networth Calculation Options

## Problem Statement

For enhancement levels +13 and above, market prices are unreliable due to:

- Thin markets (low trading volume)
- Price manipulation / panic selling
- Inaccurate representation of actual investment

Currently, networth uses market price when available, which can significantly misvalue high enhancement items.

## Recommended Solution: Always Use Enhancement Cost

For items at enhancement level ≥13, **always use calculated enhancement cost, ignore market price entirely**.

**Rationale:** If market data isn't reliable, there's no point in comparing or using thresholds. Enhancement cost represents actual investment.

---

## Implementation Plan

### 1. Settings Configuration (settings-config.js)

Add two new settings:

```javascript
// Primary toggle
networth_highEnhancementUseCost: {
    id: 'networth_highEnhancementUseCost',
    label: 'Net Worth: Use enhancement cost for highly enhanced items',
    type: 'checkbox',
    default: true,
    help: 'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.'
}

// Configurable minimum level (optional - could hardcode at 13)
networth_highEnhancementMinLevel: {
    id: 'networth_highEnhancementMinLevel',
    label: 'Net Worth: Minimum enhancement level to use cost',
    type: 'dropdown',
    default: 13,
    options: [
        { value: 10, label: '+10 and above' },
        { value: 11, label: '+11 and above' },
        { value: 12, label: '+12 and above' },
        { value: 13, label: '+13 and above (recommended)' },
        { value: 15, label: '+15 and above' }
    ],
    help: 'Enhancement level at which to stop trusting market prices'
}
```

### 2. Code Changes (networth-calculator.js)

Modify `calculateItemValue()` function (lines 28-69):

```javascript
export async function calculateItemValue(item, pricingMode = 'ask') {
    const { itemHrid, enhancementLevel = 0, count = 1 } = item;

    let itemValue = 0;

    // Check if high enhancement cost mode is enabled
    const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
    const minLevel = config.getSettingValue('networth_highEnhancementMinLevel', 13);

    // For enhanced items (1+)
    if (enhancementLevel >= 1) {
        // For high enhancement levels, use cost instead of market price
        if (useHighEnhancementCost && enhancementLevel >= minLevel) {
            // Check cache first
            const cachedCost = networthCache.get(itemHrid, enhancementLevel);
            if (cachedCost !== null) {
                itemValue = cachedCost;
            } else {
                // Calculate enhancement cost (ignore market price)
                const enhancementParams = getEnhancingParams();
                const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                if (enhancementPath && enhancementPath.optimalStrategy) {
                    itemValue = enhancementPath.optimalStrategy.totalCost;
                    // Cache the result
                    networthCache.set(itemHrid, enhancementLevel, itemValue);
                } else {
                    // Enhancement calculation failed, fallback to base item price
                    console.warn('[Networth] Enhancement calculation failed for:', itemHrid, '+' + enhancementLevel);
                    itemValue = getMarketPrice(itemHrid, 0, pricingMode);
                }
            }
        } else {
            // Normal logic for lower enhancement levels: try market price first, then calculate
            const marketPrice = getMarketPrice(itemHrid, enhancementLevel, pricingMode);

            if (marketPrice > 0) {
                itemValue = marketPrice;
            } else {
                // No market data, calculate enhancement cost
                const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                if (cachedCost !== null) {
                    itemValue = cachedCost;
                } else {
                    const enhancementParams = getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        itemValue = enhancementPath.optimalStrategy.totalCost;
                        networthCache.set(itemHrid, enhancementLevel, itemValue);
                    } else {
                        console.warn(
                            '[Networth] Enhancement calculation failed for:',
                            itemHrid,
                            '+' + enhancementLevel
                        );
                        itemValue = getMarketPrice(itemHrid, 0, pricingMode);
                    }
                }
            }
        }
    } else {
        // Unenhanced items: use market price or crafting cost
        itemValue = getMarketPrice(itemHrid, enhancementLevel, pricingMode);
    }

    return itemValue * count;
}
```

---

## Alternative Options (Considered but Not Recommended)

### Option B: Use Cost if Market < Cost (Prevents Undervaluation)

```javascript
if (enhancementLevel >= 13) {
    const marketPrice = getMarketPrice(itemHrid, enhancementLevel, pricingMode);
    const enhancementCost = calculateEnhancementCost(itemHrid, enhancementLevel);

    // Use whichever is higher (prevents loss on your investment)
    itemValue = Math.max(marketPrice, enhancementCost);
}
```

**Pros:** Never undervalues your investment
**Cons:** Still uses unreliable market data when inflated; asymmetric logic

---

### Option C: Use Cost if Difference Exceeds Threshold

```javascript
if (enhancementLevel >= 13) {
    const marketPrice = getMarketPrice(itemHrid, enhancementLevel, pricingMode);
    const enhancementCost = calculateEnhancementCost(itemHrid, enhancementLevel);

    // Calculate percentage difference
    const difference = Math.abs(marketPrice - enhancementCost) / enhancementCost;
    const threshold = 0.25; // 25% difference threshold

    if (difference > threshold) {
        itemValue = enhancementCost; // Market unreliable, use cost
    } else {
        itemValue = marketPrice; // Market reasonable, use it
    }
}
```

**Pros:** Uses market when reliable, cost when unreliable
**Cons:** If market is fundamentally unreliable for +13, why use it at all? Adds complexity for minimal benefit.

**Additional settings required:**

```javascript
networth_highEnhancementThreshold: {
    id: 'networth_highEnhancementThreshold',
    label: 'Net Worth: Market price difference threshold',
    type: 'dropdown',
    default: 25,
    options: [
        { value: 15, label: '15% - Strict (trust cost more)' },
        { value: 25, label: '25% - Balanced (recommended)' },
        { value: 50, label: '50% - Moderate (trust market more)' },
        { value: 75, label: '75% - Loose (trust market most)' }
    ],
    help: 'If market price differs from enhancement cost by more than this percentage, use cost instead'
}
```

---

## Decision

**Recommended:** Option A (Always use cost for +13 and above)

**Reasoning:**

- Market data is fundamentally unreliable at these enhancement levels
- Enhancement cost represents actual player investment
- Simpler implementation, fewer settings
- No need for threshold comparisons if market data is unreliable

**Settings:** 2 settings (on/off toggle + configurable minimum level)

**Settings Category:** Economy or Net Worth section
