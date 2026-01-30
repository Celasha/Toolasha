# Testing Handler Accumulation Fix

## Quick Test (Recommended)

1. **Load game and open DevTools Console**
2. **Run baseline check:**

    ```javascript
    Toolasha.debug.runTest();
    ```

3. **Switch character 3 times** (wait 2-3 seconds between each)
4. **Run check again:**

    ```javascript
    Toolasha.debug.runTest();
    ```

### Alternative Individual Commands

```javascript
// Check DOM observer handlers
Toolasha.debug.domHandlers();

// Check WebSocket handlers
Toolasha.debug.wsHandlers();

// Get DOM observer stats
Toolasha.debug.domStats();
```

### Expected Results

**DOM Observer:**

- Handler count should be IDENTICAL before and after switches
- Example: "Total handlers: 42" → stays at 42 after switches

**WebSocket:**

- Handler counts per event type should be IDENTICAL
- Example: "init_character_data: 5 handlers" → stays at 5 after switches

### What the Fix Prevents

**Before fix (broken behavior):**

```
Initial:  Total handlers: 42
Switch 1: Total handlers: 48  ❌ (6 duplicates added)
Switch 2: Total handlers: 54  ❌ (6 more duplicates)
Switch 3: Total handlers: 60  ❌ (exponential growth)
```

**After fix (correct behavior):**

```
Initial:  Total handlers: 42
Switch 1: Total handlers: 42  ✅ (duplicates blocked)
Switch 2: Total handlers: 42  ✅ (duplicates blocked)
Switch 3: Total handlers: 42  ✅ (stable)
```

## Console Messages to Watch For

When switching characters, you should see in console:

```
[ListingPriceDisplay] 🧹 Cleaning up handlers
[ListingPriceDisplay] ⚠️ BLOCKED duplicate initialization (fix working!)
```

If you see "✓ Initializing (first time)" on EVERY character switch, the fix is NOT working.

## Detailed Performance Test

1. **Record baseline memory:**

    ```javascript
    console.log('Memory:', (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB');
    ```

2. **Switch characters 5 times**

3. **Check memory again:**

    ```javascript
    console.log('Memory:', (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB');
    ```

**Expected:** Memory growth should be minimal (<5 MB from normal game activity)

**Before fix:** Memory would grow 10-20 MB from handler accumulation

## Automated Test Script

Copy/paste this into console for automated testing:

```javascript
// Automated Handler Accumulation Test
(function () {
    console.log('🧪 Starting Handler Accumulation Test...\n');

    // Record initial state
    const initialDOM = Toolasha.debug.domStats().handlerCount;

    console.log('📊 Initial State:');
    console.log(`  DOM handlers: ${initialDOM}`);

    Toolasha.debug.domHandlers();
    Toolasha.debug.wsHandlers();

    console.log('\n👉 Now switch characters 3 times, then run: Toolasha.debug.runTest()\n');
})();
```

## Troubleshooting

**If handlers are still accumulating:**

1. Check console for "BLOCKED" messages - if missing, guard isn't running
2. Verify `isInitialized` flag is being set correctly
3. Check that `disable()` is resetting `isInitialized = false`
4. Ensure build completed successfully (check dist/Toolasha.user.js timestamp)

**If no messages appear at all:**

1. Features might be disabled in settings
2. Check that character switch actually triggered feature re-initialization
3. Try enabling market features explicitly in settings

**If "Toolasha is not defined":**

1. Make sure you've installed the updated userscript
2. Refresh the page completely
3. Check browser console for any script loading errors

## Memory Leak Visual Test

Open Chrome DevTools → Performance tab:

1. Click Record
2. Switch characters 5 times (wait 2-3s between each)
3. Stop recording
4. Look at timeline

**Healthy pattern:** Flat timeline with consistent activity
**Broken pattern:** Growing timeline with increasing activity after each switch
