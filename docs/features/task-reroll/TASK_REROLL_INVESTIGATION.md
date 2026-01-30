# Task Reroll System Investigation Guide

## Overview

This document guides you through investigating the task reroll cost tracking system in Milky Way Idle.

## Known Information

### Reroll Cost Behavior

- **Initial Costs:**
    - Gold: 10,000
    - Cowbells: 1

- **Cost Progression (Exponential Doubling):**
    - Gold: 10k → 20k → 40k → 80k → 160k → 320k...
    - Cowbells: 1 → 2 → 4 → 8 → 16 → 32...

### Reroll UI Flow

1. Click "Reroll" button on task card
2. Two payment options appear on the right side:
    - "Pay X Cowbells"
    - "Pay X Gold"
3. Click one option to reroll the task
4. Task changes, but **profit does NOT automatically update**
5. Each subsequent reroll increases the cost (doubles)

## Investigation Tools

### Tool 1: Built-in Diagnostic (Recommended)

**Setup:**

```javascript
// 1. Build and install MWI Tools
npm run build

// 2. Reload the game page

// 3. In browser console, start diagnostic:
MWITools.diagnostics.startTaskRerollDiagnostic()

// 4. Perform reroll actions (click buttons, pay costs, etc.)

// 5. Stop diagnostic and review results:
MWITools.diagnostics.stopTaskRerollDiagnostic()
```

**What It Captures:**

- All WebSocket messages containing "task", "reroll", or "cowbell"
- DOM elements related to reroll UI
- Button clicks and state changes before/after
- Cost displays and their changes

### Tool 2: Manual WebSocket Inspection

**Steps:**

1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter: WS (WebSocket)
4. Select the MWI WebSocket connection
5. Monitor Messages tab while performing rerolls
6. Look for messages containing:
    - "task"
    - "reroll"
    - "cowbell"
    - Cost values (10000, 20000, etc.)

### Tool 3: DOM Inspection

**Steps:**

1. Open a task that can be rerolled
2. Right-click "Reroll" button → Inspect Element
3. Note the button's structure:
    - Class names
    - Parent container classes
    - Data attributes
4. Click Reroll and inspect the payment option elements:
    - How are costs displayed?
    - What changes when you select an option?
    - Are costs stored in data attributes or just text?

### Tool 4: Browser Console Queries

**Useful Queries:**

```javascript
// Find all task-related elements
document.querySelectorAll('[class*="Task"]');

// Find reroll buttons
Array.from(document.querySelectorAll('button')).filter((btn) => btn.textContent.toLowerCase().includes('reroll'));

// Find cowbell/gold cost displays
Array.from(document.querySelectorAll('*')).filter(
    (el) => el.textContent.match(/Cowbell|Gold/) && el.textContent.match(/\d+/)
);

// Check for task data in game state
window.gameState; // or similar global objects
localStorage; // check for task-related keys
```

## Information to Gather

### Critical Questions

1. **Where is reroll cost stored?**
    - [ ] WebSocket message field?
    - [ ] Local state in React component?
    - [ ] DOM data attribute?
    - [ ] Browser localStorage?
    - [ ] Not stored (calculated each time)?

2. **How is cost progression tracked?**
    - [ ] Server tracks reroll count per task?
    - [ ] Client tracks reroll count locally?
    - [ ] Cost is in a data field we can read?
    - [ ] Must be calculated from some counter?

3. **What triggers cost updates?**
    - [ ] WebSocket message after reroll?
    - [ ] React state update?
    - [ ] DOM mutation?
    - [ ] No update needed (calculated on-demand)?

4. **Task identification:**
    - [ ] How are tasks uniquely identified?
    - [ ] Task HRID?
    - [ ] Task slot index?
    - [ ] Something else?

5. **Cost reset behavior:**
    - [ ] When do costs reset to initial values?
    - [ ] New task assignment?
    - [ ] Task completion?
    - [ ] Daily reset?

### Data Structures to Look For

**WebSocket Messages:**

```javascript
// Example structure to look for:
{
  type: "task_update" | "task_reroll" | "character_task_update",
  data: {
    taskHrid: "/tasks/...",
    rerollCount: 2,
    rerollCostGold: 40000,
    rerollCostCowbell: 4,
    // ... other fields
  }
}
```

**DOM Attributes:**

```html
<!-- Example structures to look for -->
<button data-task-id="..." data-reroll-count="2">Reroll</button>
<div data-cost-gold="40000" data-cost-cowbell="4">Pay 40,000 Gold</div>
```

**Game State Objects:**

```javascript
// Check these in console:
window.gameState?.tasks;
window.gameState?.characterTasks;
window.gameState?.rerollCosts;
localStorage.getItem('tasks');
localStorage.getItem('rerollData');
```

## Investigation Checklist

### Phase 1: WebSocket Analysis

- [ ] Start diagnostic tool
- [ ] Accept a new task (capture initial state)
- [ ] Click Reroll button (capture reroll UI appearance)
- [ ] Pay with Gold (capture first reroll)
- [ ] Click Reroll again (capture cost increase)
- [ ] Pay with Cowbells (capture cost increase)
- [ ] Click Reroll again (capture further cost increase)
- [ ] Stop diagnostic and review all captured messages

### Phase 2: DOM Analysis

- [ ] Inspect Reroll button structure
- [ ] Inspect payment option elements
- [ ] Check for data-\* attributes
- [ ] Check for hidden input fields
- [ ] Monitor DOM changes during reroll

### Phase 3: State Analysis

- [ ] Check localStorage for task data
- [ ] Check window.gameState (or similar)
- [ ] Check React DevTools if available
- [ ] Look for task-related global variables

### Phase 4: Cost Calculation Testing

- [ ] Perform 10 consecutive rerolls
- [ ] Document cost at each step
- [ ] Verify doubling pattern
- [ ] Check if costs reset after task completion
- [ ] Check if costs reset on page reload

## Expected Outcomes

After investigation, we should be able to answer:

1. **Data Source:** Where reroll cost information comes from
2. **Tracking Method:** How to track the reroll count/cost
3. **Update Trigger:** When to update our display
4. **Display Strategy:** How to show costs to users

## Next Steps

Once investigation is complete:

1. Document findings in this file
2. Design the reroll cost tracking system
3. Implement display feature
4. Test with various reroll scenarios

## Notes Section

**Document your findings below:**

---

### Investigation Date: [DATE]

#### WebSocket Messages Found

```
[Paste relevant WebSocket messages here]
```

#### DOM Structure

```
[Paste relevant DOM structure here]
```

#### Cost Progression Observed

```
Reroll 1: Gold=_____, Cowbell=_____
Reroll 2: Gold=_____, Cowbell=_____
Reroll 3: Gold=_____, Cowbell=_____
...
```

#### Key Findings

-
-
-

#### Proposed Implementation

-
-
-
