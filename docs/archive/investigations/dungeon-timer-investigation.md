# Dungeon Timer Investigation

## Summary

Investigated feasibility of adding a dungeon timer feature to Toolasha. Discovered significant limitations in what data is available from the game, but found an existing solution (DungeonRunTimer) that works around these limitations using a clever approach.

---

## Game Data Available

### Static Data (from init_client_data.json)

✅ **Available:**

- `maxWaves` for each dungeon (Chimerical Den: 50, Sinister Circus: 60, Enchanted Fortress: 65, Pirate Cove: 65)
- `fixedSpawnsMap` - which waves have boss spawns (every 5th wave)
- `randomSpawnInfoMap` - monster pools for different wave ranges
- `isDungeon` flag to detect if current action is a dungeon
- Dungeon tier selection (T0, T1, T2)

### Runtime Data (from WebSocket events)

✅ **Available:**

- `init_character_data` - Initial game state
- `actions_updated` - When actions are added/removed from queue
- `action_completed` - When an action finishes
- `new_battle` - Fires when each encounter/wave starts
- `battle_updated` - Combat state updates
- Party chat messages (`systemChatMessage.partyBattleStarted`, `systemChatMessage.partyKeyCount`)

❌ **NOT Available:**

- **Current wave number** - The game does not expose which wave you're currently on
- **Dungeon progress percentage** - No state variable for "wave 23/65"
- **Wave history after page refresh** - If you refresh mid-dungeon, no way to know which wave you're on
- **Reliable wave count synchronization** - Can't recover from late initialization

---

## What We CANNOT Build

### Option 1: Live Wave Progress Tracker

**Why it fails:**

- We could count `new_battle` events manually to track waves
- BUT if the page refreshes mid-dungeon, we lose the count
- BUT if Toolasha loads late (after some waves complete), we miss early battles
- No way to synchronize with actual game state
- Result: Would show incorrect wave numbers frequently

**Example failure:**

1. Start dungeon, script counts to wave 15
2. User refreshes page
3. Script resets to wave 0, but user is actually on wave 15
4. Display shows "Wave 0/65" when user is on wave 15

### Option 2: Accurate ETA Calculator

**Why it fails:**

- Requires knowing current wave number (not available)
- Requires average time per wave (could calculate, but...)
- Without accurate wave count, ETA would be wildly wrong
- Boss waves take longer than regular waves (could account for this, but still...)
- No way to recover from desync

---

## What We CAN Build (But Limited Value)

### Option: Simple Elapsed Time Tracker

**What it would show:**

- Time since dungeon started
- Dungeon name + tier
- Maybe: "Time alive" (similar to combat summary)

**Limitations:**

- Not much more useful than the game's built-in action timer
- No progress indication
- No ETA
- Loses state on page refresh

---

## How DungeonRunTimer Solves This

**Author:** sentientmilk
**File:** `/Users/kennydean/Downloads/MWI/drt/DungeonRunTimer.txt`

### The Clever Approach

Instead of tracking game state or waves, it monitors **Party Chat system messages**.

### Key System Messages

1. `systemChatMessage.partyBattleStarted` - When dungeon starts
2. `systemChatMessage.partyKeyCount` - When keys are consumed (dungeon completion)

### How It Works

1. **WebSocket Interception:**
    - Wraps `unsafeWindow.WebSocket` at `document-start` (before game loads)
    - Captures all WebSocket messages before the game processes them
    - Maintains own listener alongside game's listener

2. **Message Processing:**
    - Stores last 100 party chat messages in memory
    - Identifies dungeon runs:
        - **Start:** First "Key counts" message after "Battle started"
        - **End:** Next "Key counts" message
    - Calculates duration: Time between consecutive "Key counts" messages

3. **Display:**
    - Appends run time directly after "Key counts:" message in Party Chat
    - Shows in orange text: `15m 23s`
    - Shows rolling average if multiple runs: `Average: 16m 12s`

4. **Persistence:**
    - Uses chat history (survives page refreshes)
    - Loads `partyChatHistory` from `init_character_data`
    - Keeps rolling window of last 100 messages

### Example Output

```
[12:34:56] Key counts: Chimerical Den T2 - 5 keys consumed 15m 23s Average: 16m 12s
                                                            ↑ Added by script ↑
```

### Strengths

✅ No wave tracking needed (uses chat as event log)
✅ Survives page refreshes (uses persistent chat history)
✅ Historical data (rolling average over multiple runs)
✅ No synchronization issues (chat messages are authoritative)

### Limitations

❌ Not a live timer (only shows time AFTER completion)
❌ No progress/ETA during the run
❌ Only visible when Party chat is open
❌ Only works in party (solo dungeons don't generate these system messages)
❌ Requires `unsafeWindow` and `document-start` timing

---

## Technical Implementation Notes

### WebSocket Wrapping Pattern

```javascript
const OriginalWebSocket = unsafeWindow.WebSocket;
let ws;
function listener(e) {
    const message = JSON.parse(e.data);
    handle(message);
}
const WrappedWebSocket = function (...args) {
    ws = new OriginalWebSocket(...args);
    ws.addEventListener('message', listener);
    return ws;
};

// Preserve static properties
WrappedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
WrappedWebSocket.OPEN = OriginalWebSocket.OPEN;
WrappedWebSocket.CLOSED = OriginalWebSocket.CLOSED;

unsafeWindow.WebSocket = WrappedWebSocket;
```

**Why this works:**

- Runs at `document-start` before game loads
- Game's WebSocket calls go through the wrapped version
- Script gets all messages without interfering with game

**Why Toolasha can't easily do this:**

- Toolasha uses normal `@match` timing (after page load)
- Game's WebSocket is already created by then
- Would need architecture change to support `document-start` hooks

---

## Possible Toolasha Implementations

### Option A: Post-Run Display (Similar to DungeonRunTimer)

**What:**

- Listen for "Key counts" messages in party chat
- Calculate and display run time after completion
- Show in Toolasha's UI (not chat)

**Challenges:**

- Need to intercept WebSocket messages (architecture change)
- Need to parse chat messages
- Only works in party, not solo

**Value:** Medium (useful for tracking performance, but no live feedback)

---

### Option B: Simple Live Timer

**What:**

- Detect dungeon start (action starts)
- Show elapsed time in top bar
- Reset on dungeon completion

**Challenges:**

- Simple to implement
- Works solo and party
- But very limited value (just elapsed time, no progress)

**Value:** Low (not much better than game's built-in timer)

---

### Option C: Hybrid Approach

**What:**

- Live elapsed time during run (top bar)
- Post-run summary with historical average (in UI panel)
- Store last N runs in settings/indexedDB

**Challenges:**

- Moderate complexity
- Still no wave progress/ETA
- Need to detect dungeon completion reliably

**Value:** Medium-High (combines live feedback with historical tracking)

---

## Recommendation

**For Now:** Document and defer

**Reasons:**

1. DungeonRunTimer already exists and works well for its use case
2. A proper live timer with wave progress is not feasible with available data
3. A simple elapsed timer has limited value
4. Architecture changes needed for WebSocket interception are significant

**If Implementing Later:**

- Consider Option C (Hybrid) for best value
- Store run history for trends/comparisons
- Display in Toolasha UI (not chat) for solo compatibility
- Consider MCP server approach for WebSocket access if that becomes available

---

## Data Structure Examples

### Dungeon Info from Game Data

```json
{
    "actionHrid": "/actions/combat/chimerical_den",
    "name": "Chimerical Den",
    "combatZoneInfo": {
        "isDungeon": true,
        "dungeonInfo": {
            "keyItemHrid": "/items/chimerical_entry_key",
            "maxWaves": 50,
            "fixedSpawnsMap": {
                "5": [{ "combatMonsterHrid": "/monsters/butterjerry" }],
                "10": [{ "combatMonsterHrid": "/monsters/jackalope" }],
                "50": [{ "combatMonsterHrid": "/monsters/griffin" }]
            }
        }
    }
}
```

### Party Chat Message (Battle Started)

```json
{
    "type": "chat_message_received",
    "message": {
        "id": 123456,
        "isSystemMessage": true,
        "chan": "/chat_channel_types/party",
        "m": "systemChatMessage.partyBattleStarted",
        "t": "2026-01-05T04:30:00.000Z"
    }
}
```

### Party Chat Message (Key Count)

```json
{
    "type": "chat_message_received",
    "message": {
        "id": 123457,
        "isSystemMessage": true,
        "chan": "/chat_channel_types/party",
        "m": "systemChatMessage.partyKeyCount",
        "t": "2026-01-05T04:45:23.000Z"
    }
}
```

---

## Related Files

- DungeonRunTimer source: `/Users/kennydean/Downloads/MWI/drt/DungeonRunTimer.txt`
- Game data: `/Users/kennydean/Downloads/MWI/Monster_Stats/init_client_data_new.json`
- Toolasha data manager: `/Users/kennydean/Downloads/MWI/Toolasha/src/core/data-manager.js`

---

**Date:** 2026-01-05
**Status:** Investigation complete, implementation deferred
