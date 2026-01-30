# Inventory Badge Prices Feature

**Status:** ✅ Implemented and Built Successfully

## Overview

Added an independent badge price display feature that shows ask/bid prices on inventory item icons. This feature works completely independently from the inventory sorting feature, allowing users to see prices without enabling sorting.

## Implementation Details

### Files Created

- `/Users/kennydean/Downloads/MWI/Toolasha/src/features/inventory/inventory-badge-prices.js` (606 lines)

### Files Modified

1. `/Users/kennydean/Downloads/MWI/Toolasha/src/features/settings/settings-config.js`
    - Added `invBadgePrices` setting (checkbox, default: false)
    - Added `invBadgePrices_type` setting (dropdown: None/Ask/Bid, default: Ask)

2. `/Users/kennydean/Downloads/MWI/Toolasha/src/core/config.js`
    - Added `inventoryBadgePrices` feature to registry

3. `/Users/kennydean/Downloads/MWI/Toolasha/src/core/feature-registry.js`
    - Imported and initialized the new feature

## How It Works

### User Interface

When enabled, the feature adds UI controls above the inventory:

```
Badge Prices: [Ask] [Bid] [None]
```

Users can click buttons to toggle between:

- **Ask**: Shows ask price (buying/replacement cost) on each stack
- **Bid**: Shows bid price (selling/quick liquidation value) on each stack
- **None**: Hides all badges

### Badge Display

- **Position**: Top-left corner of item icon (2px, 2px)
- **Styling**:
    - Uses script accent color (green by default)
    - Small font (0.7rem)
    - Bold weight
    - Text shadow for readability
- **Format**: KMB format (e.g., "1.23M" instead of "1,234,567")

### Pricing Logic

The feature uses the same comprehensive pricing system as inventory sorting:

1. **Trainee items**: Uses vendor price for charms, 0 for others
2. **Openable containers**: Uses expected value if available
3. **Enhanced equipment**:
    - Uses enhancement cost for high-level items (+13 and above by default)
    - Falls back to market price with enhancement cost fill-in
4. **Unenhanced equipment**: Uses market price or crafting cost
5. **Regular items**: Uses market prices

### Settings Location

- **Main Toggle**: Settings → Economy & Inventory → "Show price badges on item icons"
- **Price Type**: Settings → Economy & Inventory → "Badge price type to display"

### Independence from Sorting

- Works with sorting disabled
- Has its own UI controls
- Maintains separate state (saved to `toolasha_inventory_badge_prices` localStorage key)
- Uses distinct CSS class (`.mwi-badge-price`) to avoid conflicts with sorting badges

## Key Features

✅ **Independent Operation**: Does not require inventory sorting to be enabled
✅ **Persistent Settings**: User preferences saved across sessions
✅ **Smart Pricing**: Uses enhancement costs for highly enhanced items
✅ **Performance Optimized**: Batch price lookups, debounced updates
✅ **Market Data Integration**: Auto-refreshes when market data loads
✅ **Category Filtering**: Respects excluded categories (Currencies)

## Testing Instructions

1. **Enable the Feature**:
    - Open Toolasha settings
    - Navigate to "Economy & Inventory" section
    - Check "Show price badges on item icons"
    - Select "Ask" or "Bid" from the dropdown

2. **Open Inventory**:
    - You should see badge price controls above the inventory grid
    - Badges should appear on all items (except currencies)

3. **Toggle Price Types**:
    - Click "Ask", "Bid", or "None" buttons
    - Badges should update immediately
    - Selection should persist across inventory close/reopen

4. **Verify Pricing**:
    - Check that prices match market values
    - Enhanced equipment should show reasonable costs
    - Openable containers should show EV values

## Differences from MWI Tools

**MWI Tools Implementation**:

- Badge display is tied to sorting functionality
- Only shows badges when actively sorting by Ask/Bid
- Badges disappear when "None" sorting is selected

**Toolasha Implementation (Option A)**:

- Badge display is completely independent
- Can show badges without enabling sorting
- User explicitly chooses price type (Ask/Bid/None)
- More flexible and straightforward UX

## Future Enhancements (Optional)

- [ ] Badge positioning preference (top-left, top-right, bottom-left, bottom-right)
- [ ] Badge color customization
- [ ] Toggle between total stack value and per-item price
- [ ] Badge size adjustment
- [ ] Integration with sorting feature (auto-sync price type)

## Version

- **Added in**: v0.4.927
- **Build Status**: ✅ Successful (480ms)
- **Lines of Code**: 606
