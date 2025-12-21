# MWI Tools - Tooltip Format Standards

This document defines the visual and structural standards for all tooltip enhancements in MWI Tools.

## Core Principles

1. **Consistency** - All tooltip additions follow the same visual language
2. **Clarity** - Information is easy to scan and understand at a glance
3. **Compactness** - Remove redundancy, use abbreviations where clear
4. **Visual Hierarchy** - Use separators, headers, and indentation to organize info

## Standard Format (Option 1 Enhanced)

All tooltip content additions follow this structure:

```
[Top Separator Line]

SECTION HEADER
  Content line 1
  Content line 2
  • Bullet item (for lists)

[Middle Separator Line]

SECOND SECTION HEADER
  Content line 1
  Content line 2
```

### Visual Elements

**Separators:**
```html
<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 8px 0;"></div>
```

**Section Headers:**
```html
<div style="font-weight: bold; margin-bottom: 4px;">SECTION NAME</div>
```

**Content Container:**
```html
<div style="font-size: 0.9em; margin-left: 8px;">
  <!-- content here -->
</div>
```

**Bullet Lists:**
```html
<div>• Item Name ×quantity @ unit_price → total_cost</div>
```

**Color-Coded Values:**
- **Positive/Profit:** `lime`
- **Negative/Loss:** `red`
- **Script Color:** `config.SCRIPT_COLOR_TOOLTIP` (orange/darkgreen based on settings)

## Text Formatting Standards

### Abbreviations
- Use `/hr` instead of `/hour`
- Use `/item` instead of `/per item`
- Use `s` instead of `seconds` (e.g., `3.2s`)
- Numbers: Use `numberFormatter()` for all currency/large numbers

### Number Display
- **Small numbers (<1000):** Show full number (e.g., `580`)
- **Medium numbers (1k-1M):** Use K suffix (e.g., `10.4k`)
- **Large numbers (1M+):** Use M/B suffix (e.g., `295M`)
- **Decimals:** 1 decimal place max (e.g., `3.2s`, `+86.0%`)

### Quantity Display
```
• ItemName ×quantity @ unit_price → total_cost
```
Example: `• Cheese ×18 @ 580 → 10.4k`

### Percentages
- Always include `%` symbol
- Use `+` for bonuses (e.g., `+86%`)
- No sign for neutral percentages (e.g., `50%`)

## Section Templates

### Production Cost Section
```
PRODUCTION COST
• Material1 ×qty @ price → total
• Material2 ×qty @ price → total
Total: XXX (only if multiple materials)
```

### Profit Analysis Section
```
PROFIT ANALYSIS
Net: ±X/item (±X/hr)
Sell: X | Cost: X
Time: Xs (X/hr)
Efficiency: +X%
```

### Consumable Stats Section (Food/Drinks)
```
CONSUMABLE STATS
Restores: X HP/s (or X MP/s)
Cost: X per HP (or X per MP)
Daily Max: X
Duration: Xs
```

### Combat Stats Section
```
COMBAT STATS
DPS: X
Hit Rate: X%
Crit Rate: X%
```

## CSS Classes

### Injected Content Markers
Always add a class to injected elements to:
1. Prevent duplicate injection
2. Allow easy cleanup
3. Enable future styling updates

```javascript
// Profit calculator
<div class="market-profit-injected">...</div>

// Price display
<div class="market-price-injected">...</div>

// Consumable stats
<div class="consumable-stats-injected">...</div>
```

### Scrollable Tooltips
```css
.MuiTooltip-tooltip {
    max-height: calc(100vh - 20px);
    overflow-y: auto;
}
```

## DOM Injection Pattern

All tooltip enhancements follow this pattern:

```javascript
injectTooltipSection(tooltipElement, data) {
    // Find tooltip text container
    const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

    if (!tooltipText) {
        return;
    }

    // Check if already injected (prevent duplicates)
    if (tooltipText.querySelector('.unique-class-name')) {
        return;
    }

    // Create container
    const sectionDiv = dom.createStyledDiv(
        { color: config.SCRIPT_COLOR_TOOLTIP, marginTop: '8px' },
        '',
        'unique-class-name'
    );

    // Build HTML content
    let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

    // SECTION HEADER
    html += '<div style="font-weight: bold; margin-bottom: 4px;">SECTION NAME</div>';
    html += '<div style="font-size: 0.9em; margin-left: 8px;">';

    // Content lines
    html += '<div>Content line</div>';

    html += '</div>';
    html += '</div>';

    sectionDiv.innerHTML = html;

    // Append to tooltip
    tooltipText.appendChild(sectionDiv);
}
```

## Examples

### Example 1: Profit Calculator (Current Implementation)
```
Price: 5.2k / 4.9k
─────────────────────────
PRODUCTION COST
• Cheese ×18 @ 580 → 10.4k
• Milk ×5 @ 120 → 600
Total: 11k

─────────────────────────
PROFIT ANALYSIS
Net: -5.6k/item (-6.3M/hr)
Sell: 4.8k | Cost: 11k
Time: 3.2s (1.1k/hr)
Efficiency: +86%
```

### Example 2: Consumable Tooltip (To Implement)
```
Price: 1.2k / 1.1k
─────────────────────────
CONSUMABLE STATS
Restores: 50 HP/s
Cost: 22 per HP
Daily Max: 1.9M
Duration: 300s
```

### Example 3: Enhancement Tooltip (Future)
```
Price: 295M / 250M (+10)
─────────────────────────
ENHANCEMENT INFO
Success Rate: 15.2%
Cost: 210M in materials
Expected Cost: 1.4B (6.7 attempts)
Protection: 35M (recommended)
```

## Testing Checklist

When implementing a new tooltip feature:

- [ ] Follows Option 1 Enhanced format
- [ ] Uses standard separators and headers
- [ ] Has unique CSS class to prevent duplicates
- [ ] Uses `numberFormatter()` for all large numbers
- [ ] Uses standard abbreviations (hr, s, etc.)
- [ ] Properly indented (8px margin-left for content)
- [ ] Color-coded appropriately (lime/red for good/bad)
- [ ] Tested with various screen sizes
- [ ] No console errors
- [ ] No duplicate injections on hover

## Maintenance

When updating tooltip formats:
1. Update this document first
2. Apply changes to all affected modules
3. Test each module independently
4. Document any breaking changes in README

---

**Last Updated:** December 20, 2025
**Current Standard:** Option 1 Enhanced
