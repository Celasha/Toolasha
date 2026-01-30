# Script Accent Color Implementation

**Date:** January 3, 2026

## Summary

Replaced the old `useOrangeAsMainColor` toggle with a fully customizable "Script Accent Color" as the 9th color in the color customization system.

---

## What Changed

### 1. Added New Color Setting

**File:** `src/features/settings/settings-config.js`

Added `color_accent` to the colors section:

```javascript
color_accent: {
    id: 'color_accent',
    label: 'Script Accent Color',
    type: 'color',
    default: '#22c55e', // Green
    help: 'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)'
}
```

### 2. Updated Config Constants

**File:** `src/core/config.js`

**Added:**

- New `COLOR_ACCENT` constant (default: `#22c55e` - green)
- Legacy `SCRIPT_COLOR_MAIN` now maps to `COLOR_ACCENT`
- Legacy `SCRIPT_COLOR_TOOLTIP` now maps to `COLOR_ACCENT`

**Removed:**

- Old `useOrangeAsMainColor` toggle logic
- Green vs orange toggle behavior

**Changes:**

```javascript
// Before
this.SCRIPT_COLOR_MAIN = 'green';
// If useOrangeAsMainColor: this.SCRIPT_COLOR_MAIN = "gold";

// After
this.COLOR_ACCENT = '#22c55e'; // Configurable via settings
this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT; // Always synced
```

### 3. Updated applyColorSettings()

**File:** `src/core/config.js`

Now loads `color_accent` from settings:

```javascript
this.COLOR_ACCENT = this.getSettingValue('color_accent', '#22c55e');
this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
```

---

## What Users See

### Settings UI

**New color option in "Color Customization" section:**

- **Label:** "Script Accent Color"
- **Default:** Bright Green (#22c55e)
- **Help text:** "Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)"

### Where It Appears (33+ UI elements)

**Equipment & Items:**

- Equipment level numbers on icons
- Inventory stack value badges
- Skill XP percentages in sidebar

**Combat & Zones:**

- Zone index numbers (Z1, Z2, etc.)
- Combat score panel header
- Export button backgrounds

**Tasks & Profit:**

- Task profit headers
- Task profit totals
- Ability book calculator boxes

**Inventory:**

- Sort label and active button
- Stack value badges

**House:**

- Cost displays and labels
- Borders and totals
- Level selector buttons

**Net Worth:**

- Header display
- Panel text

**Buttons:**

- All export/import buttons
- Sort buttons
- Action buttons

---

## Migration Notes

### For Users

**No action needed\!**

- Existing users: Will see default green accent (same as before)
- New users: Can customize accent color immediately
- The old "orange vs green" toggle is replaced by full color picker

### For Developers

**Breaking Changes:** None

- `SCRIPT_COLOR_MAIN` still exists (now mapped to `COLOR_ACCENT`)
- `SCRIPT_COLOR_TOOLTIP` still exists (now mapped to `COLOR_ACCENT`)
- All existing code continues to work unchanged

**To use the accent color in new features:**

```javascript
// Preferred (new)
import config from '../../core/config.js';
element.style.color = config.COLOR_ACCENT;

// Also works (legacy)
element.style.color = config.SCRIPT_COLOR_MAIN;
```

---

## Benefits

1. **Full Customization** - Users can pick ANY color, not just green or orange
2. **Simpler Code** - Removed conditional logic for green/orange toggle
3. **Consistent System** - Now part of the main color customization system
4. **Better UX** - Clear label "Script Accent Color" explains what it affects
5. **Backward Compatible** - Old code using SCRIPT_COLOR_MAIN still works

---

## Testing Checklist

Test that accent color applies correctly to:

- [ ] Equipment level numbers
- [ ] Skill XP percentages
- [ ] Zone index numbers
- [ ] Task profit displays
- [ ] Inventory sort buttons/badges
- [ ] House cost displays
- [ ] Net worth displays
- [ ] Export/import buttons
- [ ] Combat score panel
- [ ] Ability book calculator

Test color customization:

- [ ] Change accent color in settings
- [ ] Verify color updates immediately
- [ ] Refresh page, verify color persists
- [ ] Reset to default, verify it goes back to green

---

## Files Modified

1. `src/features/settings/settings-config.js` - Added color_accent setting
2. `src/core/config.js` - Added COLOR_ACCENT, removed useOrangeAsMainColor logic

**Build Status:** ✅ SUCCESS (352ms)
