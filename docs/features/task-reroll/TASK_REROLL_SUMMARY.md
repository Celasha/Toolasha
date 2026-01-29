# Task Reroll Investigation - Summary

## What We Created

We've built a comprehensive diagnostic system to investigate the task reroll cost tracking without making assumptions.

### Files Created

1. **`diagnostics/task-reroll-diagnostic.js`** (460 lines)
   - Automated diagnostic tool
   - Captures WebSocket messages
   - Monitors DOM changes
   - Tracks button clicks
   - Logs state before/after rerolls

2. **`docs/TASK_REROLL_INVESTIGATION.md`**
   - Full investigation guide
   - Checklist of things to test
   - Questions to answer
   - Data structures to look for
   - Template for documenting findings

3. **`docs/TASK_REROLL_QUICKSTART.md`**
   - Quick reference for running diagnostic
   - Console commands
   - Troubleshooting tips
   - Alternative manual logging methods

### Files Modified

1. **`src/main.js`**
   - Imported diagnostic tool
   - Exposed `webSocketHook` for diagnostics
   - Added `MWITools.diagnostics.taskReroll` object
   - Added convenience methods:
     - `MWITools.diagnostics.startTaskRerollDiagnostic()`
     - `MWITools.diagnostics.stopTaskRerollDiagnostic()`

## How It Works

### Data Capture Strategy

The diagnostic tool uses a multi-layered approach:

1. **WebSocket Monitoring**
   - Hooks into existing WebSocket listener
   - Filters for task/reroll/cowbell keywords
   - Captures all relevant messages

2. **DOM Observation**
   - MutationObserver watches for new elements
   - Identifies task/reroll UI elements
   - Records HTML structure and class names

3. **Click Tracking**
   - Attaches listeners to reroll buttons
   - Captures state before click
   - Captures state 1 second after click
   - Logs differences

4. **State Snapshots**
   - Captures task cards
   - Finds reroll buttons
   - Identifies cost displays
   - Records current values

### What We're Looking For

The investigation will reveal:

1. **Data Source**
   - Is reroll cost sent via WebSocket?
   - Is it stored in DOM attributes?
   - Is it calculated client-side?

2. **Tracking Method**
   - Server-side reroll counter?
   - Client-side state tracking?
   - Inferred from cost display?

3. **Update Trigger**
   - When does cost information update?
   - What event triggers it?

4. **Cost Progression**
   - Confirm doubling pattern
   - Find where counter resets
   - Identify edge cases

## Usage Instructions

### Quick Start (3 steps)

```bash
# 1. Build
cd "/Users/kennydean/Downloads/MWI/MWI Tools"
npm run build

# 2. Reload game page

# 3. Run in console
MWITools.diagnostics.startTaskRerollDiagnostic()

# ... perform reroll actions ...

MWITools.diagnostics.stopTaskRerollDiagnostic()
```

### What to Test

Suggested test sequence:

1. **First Reroll** (Initial costs)
   - Open a task
   - Click Reroll
   - Note displayed costs: Gold=10k, Cowbell=1
   - Pay with Gold

2. **Second Reroll** (Cost doubling)
   - Click Reroll again
   - Note costs: Gold=20k, Cowbell=2
   - Pay with Cowbells this time

3. **Third Reroll** (Progression)
   - Click Reroll again
   - Note costs: Gold=40k, Cowbell=4
   - Try clicking away without paying

4. **Cost Reset Test**
   - Complete the task
   - Accept new task
   - Check if costs reset to 10k/1

5. **Page Reload Test**
   - Reload page while task has high reroll cost
   - Check if cost persists or resets

## Expected Outcomes

After running the diagnostic, we'll have:

1. **Complete message logs** showing all WebSocket traffic
2. **DOM structure** of reroll UI elements
3. **State snapshots** before/after each reroll
4. **Cost progression data** with exact values

This data will tell us:
- ✅ **If** we can track reroll costs
- ✅ **How** to track them (WebSocket vs DOM vs calculation)
- ✅ **When** to update displays
- ✅ **Where** to store the data

## Next Steps

### After Investigation

1. **Review Results**
   - Check console output
   - Examine `window.__taskRerollDiagnosticResults`
   - Document findings in TASK_REROLL_INVESTIGATION.md

2. **Design Implementation**
   - Based on findings, design tracking system
   - Decide on display format
   - Plan integration with existing task system

3. **Implement Feature**
   - Create tracking module
   - Add display to task cards
   - Test with various scenarios

## No Assumptions

We're **not assuming**:
- ❌ That cost data is in WebSocket messages
- ❌ That we can read DOM attributes
- ❌ That costs are stored anywhere accessible
- ❌ That the pattern is strictly exponential
- ❌ That costs reset on task completion

We're **investigating**:
- ✅ What data sources exist
- ✅ What tracking methods are possible
- ✅ What the actual behavior is
- ✅ What edge cases exist
- ✅ What implementation options we have

## Troubleshooting

### If diagnostic doesn't capture data

See `docs/TASK_REROLL_QUICKSTART.md` for:
- Alternative manual logging methods
- Browser DevTools techniques
- Network tab inspection
- React DevTools usage

### If reroll costs aren't accessible

We may need to:
- Track costs manually by observing UI
- Calculate costs from progression pattern
- Store reroll counts client-side
- Parse text from DOM elements

## Summary

**Goal:** Understand task reroll cost system completely before implementing

**Approach:** Multi-layered diagnostic tool + comprehensive investigation guide

**Deliverables:**
1. Diagnostic tool (automated)
2. Investigation guide (manual)
3. Quick start guide (reference)

**Next Action:** Run the diagnostic while performing rerolls and review the captured data.
