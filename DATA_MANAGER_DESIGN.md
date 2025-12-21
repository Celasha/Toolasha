# Data Manager Design Document

## ⚠️ CRITICAL: Game Data Access

**ALWAYS use the official game API to access init client data:**

```javascript
const gameData = localStorageUtil.getInitClientData();
```

**DO NOT:**
- ❌ Access `localStorage` directly
- ❌ Manually decompress LZ-string
- ❌ Cache and parse localStorage keys yourself

**Why?**
- ✅ **Official API** - Maintained by game developers
- ✅ **Safe** - Won't break on game updates
- ✅ **Simple** - Handles decompression automatically
- ✅ **Clean** - No manual localStorage access needed

## Overview

The Data Manager is the central hub for accessing game data in MWI Tools. It:
- Provides clean API for accessing player stats, inventory, skills, etc.
- Emits events when data changes (via WebSocket updates)
- Caches frequently accessed data for performance
- Serves as "single source of truth" for game state

## Architecture

```
Game Data Flow:
┌─────────────────────────────────────┐
│  localStorageUtil.getInitClientData() │  ← Official Game API
└──────────────┬──────────────────────┘
               │
               ▼
         ┌─────────────┐
         │ Data Manager│  ← Our module
         └─────┬───────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
[Networth] [Tooltips] [Market]  ← Features
```

## Design Principles

1. **Use Official API** - Call `localStorageUtil.getInitClientData()` for data access
2. **Event-Driven** - Emit events when data changes (features subscribe)
3. **Lazy Loading** - Only fetch data when requested
4. **Immutable Access** - Return copies, never direct references
5. **Error Handling** - Gracefully handle missing/invalid data

## API Design (Proposed)

```javascript
class DataManager {
    constructor() {
        this.initData = null;
        this.eventListeners = new Map();
    }

    // Core data access
    getInitData() {
        // Call official API
        if (!this.initData) {
            this.initData = localStorageUtil.getInitClientData();
        }
        return this.initData;
    }

    // Convenience getters
    getPlayerSkills() { /* ... */ }
    getPlayerInventory() { /* ... */ }
    getPlayerEquipment() { /* ... */ }
    getPlayerStats() { /* ... */ }

    // Market data
    getMarketPrices() { /* ... */ }
    getItemDetails(itemHrid) { /* ... */ }

    // Event system
    on(event, callback) { /* ... */ }
    emit(event, data) { /* ... */ }

    // Update handling (called by WebSocket hook)
    updateData(messageData) { /* ... */ }
}
```

## Data Structure (from initClientData)

The game data contains these major sections:

```javascript
{
    // Static game data
    itemDetailMap: {},           // All item definitions
    actionDetailMap: {},         // All action definitions
    combatMonsterDetailMap: {},  // All monster definitions
    abilityBookDetailMap: {},    // All ability book definitions

    // Player data (from server)
    characterId: "...",
    characterName: "...",
    houseId: "...",

    // Player stats
    skillExperience: {},
    actionQueue: [],
    inventory: [],
    equipment: {},

    // Other player data
    coins: 0,
    cowbells: 0,
    locationHrid: "...",
    // ... etc
}
```

## Integration with WebSocket Hook

The WebSocket hook will update the Data Manager:

```javascript
// In websocket.js
WebSocket.prototype.send = new Proxy(WebSocket.prototype.send, {
    apply: function(target, thisArg, args) {
        const message = JSON.parse(args[0]);

        // After receiving response from game
        if (message.type === 'update') {
            dataManager.updateData(message.data);
        }

        return target.apply(thisArg, args);
    }
});
```

## Next Steps

1. Build WebSocket hook first (understand what data updates look like)
2. Design event system based on actual update patterns
3. Build Data Manager with getters for common data needs
4. Add caching/performance optimizations as needed

## References

- CLAUDE.md - "InitClientData Extraction" section (line 194)
- Original code - Lines 5264-5437 (data access patterns)
- Developer guidance - Use `localStorageUtil.getInitClientData()`
