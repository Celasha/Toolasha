# Testing House Room Efficiency System

## Quick Test Instructions

### Prerequisites
1. Browser with MWI Tools userscript installed (Tampermonkey/Greasemonkey)
2. Logged into https://www.milkywayidle.com
3. Character with at least one house room unlocked (not required but better for testing)

### Running the Test

**Option 1: Quick Console Test (Recommended)**

1. **Load the game:** Navigate to https://www.milkywayidle.com
2. **Wait for initialization:**
   - Game fully loads (you see your character stats)
   - Console shows: `🎉 MWI Tools (Refactored) - Ready!`
3. **Open browser console:** Press F12 (Chrome/Firefox) or Cmd+Option+I (Mac)
4. **Copy and paste:** Copy the entire contents of `test-house-efficiency.js`
5. **Run:** Press Enter

**Option 2: Manual Verification**

Open browser console and run these commands:

```javascript
// Check house rooms loaded
dataManager.getHouseRooms()
// Should show Map with your house room levels

// Check a specific room (Brewery example)
dataManager.getHouseRoomLevel('/house_rooms/brewery')
// Should return a number 0-8

// Calculate profit for Cheese (tests integration)
profitCalculator.calculateProfit('/items/cheese')
// Should return object with houseEfficiency field
```

### Expected Test Output

**If you have house rooms:**
```
========== HOUSE EFFICIENCY TEST ==========

TEST 1: Check house room data loaded from WebSocket
------------------------------------------------
✅ House rooms loaded: 9 rooms

House Room Levels:
  - brewery: Level 5
  - forge: Level 3
  - kitchen: Level 0
  ...

TEST 2: Test house efficiency calculations
------------------------------------------------
✅ Brewing: Level 5 → +7.5% efficiency
✅ Cheesesmithing: Level 3 → +4.5% efficiency
...

TEST 3: Test profit calculator integration
------------------------------------------------
✅ Profit calculator working

Example: Cheese Production
  Level Efficiency: +10.0%
  House Efficiency: +4.5%
  Total Efficiency: +14.5%
  Efficiency Multiplier: ×1.15
  Output: 72.5 items/hour

...

========== TEST SUMMARY ==========
Total tests: 4
✅ Passed: 4
❌ Failed: 0

🎉 ALL TESTS PASSED! House efficiency system working correctly.
```

**If you don't have house rooms yet:**
```
TEST 1: Check house room data loaded from WebSocket
------------------------------------------------
✅ House rooms loaded: 0 rooms
⚠️ No house rooms found - character may not have any rooms yet
   This is normal if you haven't unlocked house rooms in-game
```

### What the Test Verifies

1. **WebSocket Data Loading:**
   - Checks if `characterHouseRoomMap` data loaded from game
   - Verifies dataManager correctly parses and stores room data

2. **House Efficiency Calculation:**
   - Tests all 9 house room mappings (Brewery, Forge, Kitchen, etc.)
   - Verifies formula: `houseLevel × 1.5%`

3. **Profit Calculator Integration:**
   - Tests that profit calculator includes house efficiency
   - Verifies breakdown shows both level and house efficiency separately

4. **Data Structure Integrity:**
   - Confirms WebSocket message structure is correct
   - Validates data access methods work

### Troubleshooting

**"dataManager not found"**
- MWI Tools hasn't loaded yet - wait a few more seconds and retry

**"No house rooms found"**
- This is normal if you haven't unlocked house rooms in-game yet
- The system will work correctly when you do unlock them

**"Could not calculate profit for test item"**
- Market data may not have loaded yet
- Try again in a few seconds

**"characterHouseRoomMap not found"**
- Game data hasn't loaded yet via WebSocket
- Refresh the page and wait for full initialization

### Manual Inspection in Game

After running the test, you can verify in-game:

1. **Open a production action** (e.g., Milk a Cow)
2. **Hover over a craftable item** to see tooltip
3. **Check the Efficiency section:**
   ```
   Efficiency: +18.0%
     - Level Advantage: +10.0%
     - House Room: +7.5%  ← This should match your Dairy Barn level × 1.5%
   Output: ×1.18 (71/hr)
   ```

### Next Steps After Testing

Once all tests pass:
- ✅ House room efficiency is working correctly
- ✅ Ready to move to next phase (equipment efficiency bonuses)
- ✅ Can commit test script to repository

If tests fail, check the console output for specific error messages.
