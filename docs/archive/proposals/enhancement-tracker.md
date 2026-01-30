# Enhancement Tracker UI Improvements Proposal

**Date:** January 3, 2026
**Feature:** Enhancement Tracker Floating Panel
**File:** `src/features/enhancement/enhancement-ui.js`

---

## Current State Analysis

### Existing Features ✅

- **Draggable panel** with header-based drag functionality
- **Session navigation** (◀/▶ buttons to switch between sessions)
- **Cost details collapsible** (expandable material costs section)
- **Screen-aware visibility** (optional show-only-on-enhancing-screen setting)
- **Auto-refresh** during active sessions (1-second interval)
- **Styled UI** matching Ultimate Enhancement Tracker aesthetics

### Current Limitations ❌

1. **Not collapsible** - Entire panel cannot be minimized/collapsed
2. **Left-side positioning** - Fixed at `left: 50px` (user wants right side)
3. **No persistent position** - Position resets on page reload
4. **Always full-height** - Takes up vertical space even when not needed

---

## Proposed Changes

### 1. Panel Collapsibility 🎯

**Goal:** Add collapse/expand toggle to minimize panel when not actively monitoring.

**Implementation:**

#### A. Add Collapse Button to Header

```javascript
// New button in header (next to 🗑️ clear button)
const collapseButton = document.createElement('button');
collapseButton.innerHTML = '▼'; // Down arrow when expanded
collapseButton.title = 'Collapse/Expand';
collapseButton.id = 'enhancementCollapseButton';
```

#### B. Track Collapsed State

```javascript
constructor() {
    // ... existing properties
    this.isCollapsed = false; // New property
}
```

#### C. Toggle Functionality

```javascript
toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    const content = document.getElementById('enhancementPanelContent');
    const button = document.getElementById('enhancementCollapseButton');

    if (this.isCollapsed) {
        // Collapsed state
        content.style.display = 'none';
        button.innerHTML = '▶'; // Right arrow
        button.title = 'Expand';
        this.floatingUI.style.width = '250px'; // Narrower when collapsed
    } else {
        // Expanded state
        content.style.display = 'block';
        button.innerHTML = '▼'; // Down arrow
        button.title = 'Collapse';
        this.floatingUI.style.width = '350px'; // Full width
    }

    // Save state to localStorage
    this.saveUIState();
}
```

#### D. Collapsed State Display

When collapsed, show compact summary:

- Item name + target level (+15)
- Current level progress badge
- Success count / Total attempts
- Status indicator (🟢 tracking / ✅ completed)

**Benefits:**

- Quick glance at progress without full panel
- Reduces screen clutter during long enhancement sessions
- Easy toggle with single click

---

### 2. Right-Side Default Positioning 🎯

**Goal:** Position panel on right side of screen by default (instead of left).

**Implementation:**

#### A. Update Default Position

```javascript
// Current (LEFT side):
top: '50px',
left: '50px',

// New (RIGHT side):
top: '50px',
right: '50px',    // Changed from left to right
left: 'auto',     // Override left
```

#### B. Adjust Drag Behavior

Dragging logic needs update to handle `right` positioning:

```javascript
makeDraggable(header) {
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
        this.isDragging = true;

        // Calculate offset from panel's current screen position
        const rect = this.floatingUI.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        const onMouseMove = (e) => {
            if (this.isDragging) {
                const newLeft = e.clientX - offsetX;
                const newTop = e.clientY - offsetY;

                // Use absolute positioning during drag
                this.floatingUI.style.left = `${newLeft}px`;
                this.floatingUI.style.right = 'auto';
                this.floatingUI.style.top = `${newTop}px`;
            }
        };

        const onMouseUp = () => {
            this.isDragging = false;
            this.saveUIState(); // Save new position
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}
```

**Benefits:**

- More natural for right-handed users
- Keeps panel away from left sidebar (game's skill menu)
- Reduces overlap with game's primary UI elements

---

### 3. Persistent UI State 🎯

**Goal:** Remember user's position, size, and collapsed state across page reloads.

**Implementation:**

#### A. Save State to LocalStorage

```javascript
saveUIState() {
    const state = {
        position: {
            top: this.floatingUI.style.top,
            left: this.floatingUI.style.left,
            right: this.floatingUI.style.right
        },
        isCollapsed: this.isCollapsed,
        width: this.floatingUI.style.width
    };

    localStorage.setItem('toolasha_enhancementUI_state', JSON.stringify(state));
}
```

#### B. Load State on Initialization

```javascript
loadUIState() {
    const savedState = localStorage.getItem('toolasha_enhancementUI_state');
    if (!savedState) {
        return null;
    }

    try {
        return JSON.parse(savedState);
    } catch (error) {
        console.error('[Enhancement Tracker] Failed to load UI state:', error);
        return null;
    }
}
```

#### C. Apply Saved State

```javascript
createFloatingUI() {
    // ... create panel ...

    // Load and apply saved state
    const savedState = this.loadUIState();
    if (savedState) {
        // Restore position
        if (savedState.position.right !== 'auto') {
            this.floatingUI.style.right = savedState.position.right;
            this.floatingUI.style.left = 'auto';
        } else {
            this.floatingUI.style.left = savedState.position.left;
            this.floatingUI.style.right = 'auto';
        }
        this.floatingUI.style.top = savedState.position.top;

        // Restore collapsed state
        this.isCollapsed = savedState.isCollapsed || false;
        if (this.isCollapsed) {
            // Apply collapsed styling immediately
            setTimeout(() => this.toggleCollapse(), 100);
        }
    }

    // ... rest of initialization ...
}
```

**Benefits:**

- User's preferred position persists across sessions
- Collapsed state remembered
- Better UX (no need to reposition every reload)

---

### 4. Always Open by Default ✅

**Current Status:** Already implemented
**Confirmation:** Panel is visible by default unless `enhancementTracker_showOnlyOnEnhancingScreen` setting is enabled.

**No changes needed** - this requirement is already met.

---

## Visual Mockup

### Expanded State (Right Side)

```
┌─────────────────────────────────────────────────────────┐
│                                    [Enhancement Tracker ▼◀▶🗑️]│
│                                    Item: Celestial Trident    │
│                                    Target: +15  Prot: +10      │
│                                    Status: In Progress         │
│                                                                │
│                                    [Level | Success | Fail | %]│
│                                    [ 14   |   3     |  7   |30%]│
│                                    [ 13   |   5     |  2   |71%]│
│                                    [ 12   |   8     |  1   |89%]│
│                                                                │
│                                    Total Attempts: 26          │
│                                    XP/Hour: 145,200           │
│                                    💰 Total Cost: 2,450,000    │
└─────────────────────────────────────────────────────────┘
```

### Collapsed State (Right Side)

```
┌───────────────────────────────┐
│ [Enhancement Tracker ▶◀▶🗑️]   │
│ Celestial Trident → +15       │
│ 🟢 26/50 attempts | 61% rate  │
└───────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Right-Side Positioning

1. ✅ Update default position from `left: 50px` to `right: 50px`
2. ✅ Fix drag behavior to handle right-side positioning
3. ✅ Test drag-and-drop functionality

### Phase 2: Collapsibility

1. ✅ Add collapse button to header
2. ✅ Implement toggle functionality
3. ✅ Create collapsed state UI (compact summary)
4. ✅ Add smooth transition animation (CSS)

### Phase 3: State Persistence

1. ✅ Implement `saveUIState()` and `loadUIState()`
2. ✅ Call save on drag end, collapse toggle
3. ✅ Apply saved state on panel creation
4. ✅ Add migration for users with no saved state (use new defaults)

### Phase 4: Testing & Polish

1. ✅ Test dragging from right side to left side
2. ✅ Test collapsed/expanded state persistence
3. ✅ Verify auto-refresh works in collapsed state
4. ✅ Ensure session navigation works in collapsed state
5. ✅ Test with multiple sessions

---

## Breaking Changes

**None** - All changes are backward compatible.

**Migration:**

- Existing users: Panel will appear on right side on first load after update
- Position can be dragged to left side if preferred
- No data loss or session corruption

---

## Code Changes Summary

**Files Modified:**

1. `src/features/enhancement/enhancement-ui.js` (primary changes)

**Approximate Line Changes:**

- +150 lines (new collapse functionality)
- +80 lines (state persistence)
- ~30 lines modified (positioning changes)

**Total Impact:** ~260 lines (mostly additions, minimal modifications)

---

## Benefits Summary

### User Experience

- ✅ **Less cluttered screen** - Collapsible when not actively monitoring
- ✅ **Better positioning** - Right side keeps panel away from game UI
- ✅ **Persistent preferences** - Position and state remembered
- ✅ **Quick monitoring** - Collapsed state shows key stats at a glance

### Technical

- ✅ **Backward compatible** - No breaking changes
- ✅ **Clean implementation** - Reuses existing drag/state patterns
- ✅ **Minimal performance impact** - LocalStorage is fast, no new intervals

---

## Alternative Considerations

### Alternative 1: Dockable Panel

**Idea:** Allow docking to screen edges (snap-to-edge behavior)
**Pros:** Professional feel, prevents accidental off-screen positioning
**Cons:** More complex implementation, may feel restrictive
**Decision:** Defer to Phase 2 (after core collapsibility is proven)

### Alternative 2: Minimize to Icon

**Idea:** Collapse to small icon in corner (like chat widgets)
**Pros:** Maximum space savings
**Cons:** Loses at-a-glance stats, harder to re-open quickly
**Decision:** Rejected - compact summary provides better UX

### Alternative 3: Settings Integration

**Idea:** Add "Default Position" option in settings (Left/Right/Custom)
**Pros:** User choice from settings panel
**Cons:** Adds complexity, drag-to-position is more intuitive
**Decision:** Not needed - drag-and-drop + persistence is sufficient

---

## Recommended Next Steps

1. **User Approval** - Review and approve this proposal
2. **Prototype** - Implement Phase 1 + Phase 2 (positioning + collapsibility)
3. **User Testing** - Test with 1-2 enhancement sessions
4. **Iterate** - Adjust based on feedback
5. **Phase 3** - Add state persistence once core functionality is proven
6. **Ship It** 🚀

---

## Questions for User

1. **Collapsed State Content:** Should collapsed state show:
    - A) Current level + progress (as proposed)
    - B) Just item name + minimize indicator
    - C) Custom compact view (specify what you want)

2. **Default State:** Should panel start:
    - A) Expanded (show all stats)
    - B) Collapsed (show compact summary)

3. **Collapse Button Position:** Where should collapse button be?
    - A) Header right (next to 🗑️ button) ← **Recommended**
    - B) Header left (next to title)
    - C) Bottom of panel

4. **Animation:** Should collapse/expand be:
    - A) Instant (no animation)
    - B) Smooth slide (0.2s transition) ← **Recommended**
    - C) Fade (opacity transition)

---

**End of Proposal**
