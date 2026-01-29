# WebSocket Message Reference

Complete documentation of WebSocket messages for combat tracking, dungeon features, and game state monitoring.

---

## Table of Contents

1. [new_battle](#new_battle) - Wave start, party/enemy state
2. [action_completed](#action_completed) - Action progress, loot drops, XP gains
3. [Time Formats](#time-formats)
4. [Use Cases](#use-cases)

---

## new_battle

**Fires:** At the start of each combat wave (dungeon wave, zone encounter)

**Purpose:** Provides complete snapshot of all party members and enemies at wave start

### Message Structure

```javascript
{
  "type": "new_battle",
  "combatStartTime": "2026-01-07T17:48:14.750413389Z",  // ISO timestamp
  "battleId": 1213,                                      // Unique battle ID
  "wave": 0,                                             // Current wave number (0-indexed)
  "players": [ /* Player objects */ ],
  "monsters": [ /* Monster objects */ ]
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `wave` | number | Current wave number (0-indexed, 0 = first wave) |
| `combatStartTime` | string | ISO timestamp when this wave started |
| `battleId` | number | Unique identifier for this battle session |
| `players` | array | All party members (including you) |
| `monsters` | array | All enemies in this wave |

### Player Object

```javascript
{
  "isActive": true,                    // Currently in combat
  "isPlayer": true,                    // True for players, false for monsters
  "name": "NightFury",

  // Character Info
  "character": {
    "id": 424725,
    "userID": 411082,
    "name": "NightFury",
    "chatIconHrid": "/chat_icons/jackalope",
    "nameColorHrid": "/name_colors/fancy_burble",
    "isOnline": true,
    "createdAt": "2025-06-23T10:46:37Z"
    // ... more fields
  },

  // Combat Status
  "currentHitpoints": 1650,
  "maxHitpoints": 1650,
  "currentManapoints": 1348,
  "maxManapoints": 1878,
  "deathCount": 0,

  // Combat State
  "isBlinded": false,
  "isSilenced": false,
  "isStunned": false,
  "attackAttemptCounter": 9622,
  "isPreparingAutoAttack": false,
  "preparingAbilityHrid": "/abilities/frost_surge",

  // Abilities
  "combatAbilities": [
    {
      "abilityHrid": "/abilities/critical_aura",
      "level": 41,
      "experience": 41192.5,
      "availableTime": "2026-01-07T22:44:23.319967298Z"  // When off cooldown
    }
  ],

  // Consumables
  "combatConsumables": [
    {
      "itemHrid": "/items/spaceberry_cake",
      "enhancementLevel": 0,
      "count": 1424,
      "availableTime": "2026-01-07T22:43:25.889872129Z"  // When off cooldown
    }
  ],

  // Active Buffs
  "combatBuffMap": {
    "/buff_uniques/attack_coffee": {
      "uniqueHrid": "/buff_uniques/attack_coffee",
      "typeHrid": "/buff_types/attack_level",
      "ratioBoost": 0.24464,
      "flatBoost": 3.336,
      "startTime": "2026-01-07T22:40:31.357959307Z",
      "duration": 269784172661                          // Nanoseconds remaining
    }
  },

  // XP Tracking (cumulative for entire run)
  "totalAbilityExperienceMap": {
    "/abilities/critical_aura": 14.7
  },
  "totalSkillExperienceMap": {
    "/skills/magic": 1084847.73
  },

  // Loot Tracking (cumulative for entire run)
  "totalLootMap": {
    "424725::/item_locations/inventory::/items/apple_gummy::0": {
      "itemHrid": "/items/apple_gummy",
      "enhancementLevel": 0,
      "count": 226
    }
  },

  // Detailed Combat Stats
  "combatDetails": {
    "combatLevel": 131.1,
    "attackInterval": 2771976750,               // Nanoseconds between attacks
    "totalCastSpeed": 0.369,

    // Accuracy by Combat Style
    "stabAccuracyRating": 173.916,
    "slashAccuracyRating": 173.916,
    "smashAccuracyRating": 173.916,
    "rangedAccuracyRating": 173.916,
    "magicAccuracyRating": 704.527,

    // Max Damage by Style
    "stabMaxDamage": 51,
    "slashMaxDamage": 51,
    "smashMaxDamage": 51,
    "rangedMaxDamage": 111,
    "magicMaxDamage": 574.959,

    // Evasion by Combat Style
    "stabEvasionRating": 432.646,
    "slashEvasionRating": 432.646,
    "smashEvasionRating": 432.646,
    "rangedEvasionRating": 381.427,
    "magicEvasionRating": 407.936,

    // Resistances
    "totalArmor": 25.4,
    "totalWaterResistance": 125.847,
    "totalNatureResistance": 102.162,
    "totalFireResistance": 125.847,

    // Skill Levels
    "staminaLevel": 127,
    "intelligenceLevel": 124,
    "attackLevel": 163.916,
    "meleeLevel": 41,
    "defenseLevel": 127,
    "rangedLevel": 101,
    "magicLevel": 177.607,

    // Combat Stats Detail
    "combatStats": {
      "combatStyleHrids": ["/combat_styles/magic"],
      "damageType": "/damage_types/water",
      "abilityDamage": 0.223,
      "castSpeed": 0.165,
      "abilityHaste": 16.044,
      "criticalRate": 0.113,
      "criticalDamage": 0.054,

      // Amplify
      "waterAmplify": 1.697,
      "natureAmplify": 0.998,
      "fireAmplify": 0.998,
      "healingAmplify": 0.129,

      // Penetration
      "waterPenetration": 0.278,
      "naturePenetration": 0.129,
      "firePenetration": 0.129,

      // Regeneration (per 10 seconds)
      "hpRegenPer10": 0.011,
      "mpRegenPer10": 0.020,

      // Drop Bonuses
      "drinkConcentration": 0.112,
      "combatDropRate": 0.167,
      "combatDropQuantity": 0.295,
      "combatRareFind": 0.06,

      // Training
      "primaryTraining": "/skills/magic",
      "focusTraining": "/skills/magic",

      // Experience Bonuses
      "combatExperience": 0.33,
      "magicExperience": 0.067,

      // Consumable Slots
      "foodSlots": 2,
      "drinkSlots": 2
    }
  }
}
```

### Monster Object

```javascript
{
  "isActive": true,                    // Currently alive
  "isPlayer": false,                   // Always false for monsters
  "hrid": "/monsters/black_bear",
  "name": "Black Bear",

  // Monster Stats
  "experience": 570,                   // XP reward on kill
  "difficultyTier": 4,                 // Base monster tier (dungeon tier adds to this)
  "currentHitpoints": 1055,
  "maxHitpoints": 4100,
  "currentManapoints": 4100,
  "maxManapoints": 4100,
  "deathCount": 0,

  // Enrage System
  "isEnraged": false,
  "enrageTimerDuration": 180000000000, // Nanoseconds (180s = 3 minutes to enrage)
  "spawnTime": "2026-01-07T22:43:56.33212713Z",

  // Combat State
  "isBlinded": false,
  "isSilenced": false,
  "isStunned": false,
  "isPreparingAutoAttack": true,
  "preparingAbilityHrid": "",

  // Monster Abilities
  "combatAbilities": [
    {
      "abilityHrid": "/abilities/frenzy",
      "level": 4,
      "availableTime": "2026-01-07T22:44:19.643579538Z"
    }
  ],

  // Combat Details (same structure as players)
  "combatDetails": {
    "combatLevel": 416.8,
    "attackInterval": 2622950819,
    "stabAccuracyRating": 450,
    "magicAccuracyRating": 450,
    // ... (same fields as players)

    "combatStats": {
      "combatStyleHrids": ["/combat_styles/stab"],
      "damageType": "/damage_types/physical",
      "attackInterval": 3200000000,

      // Monster-specific stat bonuses (only non-zero values)
      "stabEvasion": 0.3,
      "magicEvasion": -0.2,
      "fireResistance": -10
    }
  }
}
```

---

## action_completed

**Fires:** Every time an action completes (combat encounter, crafting action, gathering action)

**Purpose:** Updates action progress, inventory changes, XP gains

### Message Structure

```javascript
{
  "type": "action_completed",
  "endCharacterAction": { /* Action state */ },
  "endCharacterItems": [ /* Inventory updates */ ],
  "endCharacterAbilities": [ /* Ability XP updates */ ],
  "endCharacterSkills": [ /* Skill XP updates */ ],
  "endCharacterQuests": [ /* Quest progress updates */ ] // or null
}
```

### endCharacterAction

Action state after completion.

```javascript
{
  "id": 170043168,
  "characterID": 27393,
  "partyID": 395779,                           // Party ID (0 if solo)
  "actionHrid": "/actions/combat/bear_with_it", // Action being performed
  "difficultyTier": 4,                         // Selected tier

  // Progress Tracking
  "hasMaxCount": false,                        // True if limited count action
  "maxCount": 0,                               // Max count (0 if unlimited)
  "currentCount": 1235,                        // Times completed
  "wave": 0,                                   // Current wave (for dungeons)

  // Action State
  "primaryItemHash": "",                       // For crafting/enhancing
  "secondaryItemHash": "",                     // For some actions
  "enhancingMaxLevel": 0,                      // For enhancing actions
  "enhancingProtectionMinLevel": 0,            // For enhancing actions
  "characterLoadoutID": 327843,                // Equipment loadout ID
  "ordinal": 0,                                // Queue position

  // Completion Status
  "isDone": false,                             // True when action fully complete
  "createdAt": "2026-01-07T17:48:00Z",
  "updatedAt": "2026-01-07T22:49:27.803903038Z"
}
```

### endCharacterItems

Inventory updates from this action completion.

**CRITICAL:** This is how inventory updates during combat! Not from separate `items_updated` message.

```javascript
[
  {
    "id": 57969462,
    "characterID": 27393,
    "itemLocationHrid": "/item_locations/inventory",
    "itemHrid": "/items/beast_hide",
    "enhancementLevel": 0,
    "count": 4498,                              // New total count
    "offlineCount": 0,
    "hash": "27393::/item_locations/inventory::/items/beast_hide::0",
    "createdAt": "2025-08-15T04:10:43Z",
    "updatedAt": "2026-01-07T22:49:27.792789497Z"
  },
  {
    "id": 51444524,
    "characterID": 27393,
    "itemLocationHrid": "/item_locations/inventory",
    "itemHrid": "/items/coin",
    "enhancementLevel": 0,
    "count": 802378572,                         // Gold total
    "offlineCount": 0,
    "hash": "27393::/item_locations/inventory::/items/coin::0",
    "createdAt": "2025-07-06T01:34:57Z",
    "updatedAt": "2026-01-07T22:49:27.794059911Z"
  }
  // ... more items (tea leaves, berries, etc.)
]
```

**Item Locations:**
- `/item_locations/inventory` - Inventory
- `/item_locations/equipment_head` - Head slot
- `/item_locations/equipment_body` - Body slot
- `/item_locations/equipment_legs` - Legs slot
- `/item_locations/equipment_feet` - Feet slot
- `/item_locations/equipment_hands` - Hands slot
- `/item_locations/equipment_main_hand` - Main hand
- `/item_locations/equipment_two_hand` - Two-handed weapon
- `/item_locations/equipment_off_hand` - Off-hand/shield
- `/item_locations/equipment_pouch` - Pouch slot
- `/item_locations/equipment_back` - Back slot

### endCharacterAbilities

Ability XP gains from this action.

```javascript
[
  {
    "characterID": 27393,
    "abilityHrid": "/abilities/entangle",
    "experience": 937131.9,                     // Total XP (not gained this action)
    "level": 73,
    "slotNumber": 5,                            // Ability bar slot
    "createdAt": "2025-08-20T02:46:09Z",
    "updatedAt": "2026-01-07T22:49:27.800723926Z"
  },
  {
    "characterID": 27393,
    "abilityHrid": "/abilities/natures_veil",
    "experience": 299319.4,
    "level": 61,
    "slotNumber": 4,
    "createdAt": "2025-08-20T02:46:35Z",
    "updatedAt": "2026-01-07T22:49:27.801362589Z"
  }
  // ... more abilities
]
```

### endCharacterSkills

Skill XP gains from this action.

```javascript
[
  {
    "characterID": 27393,
    "skillHrid": "/skills/magic",
    "experience": 294290014.93,                 // Total XP (not gained this action)
    "level": 134,
    "offlineExperience": 0,
    "createdAt": "2023-01-17T18:43:58Z",
    "updatedAt": "2026-01-07T22:49:27.802529136Z"
  },
  {
    "characterID": 27393,
    "skillHrid": "/skills/total_level",
    "experience": 717845653.13,
    "level": 1414,
    "offlineExperience": 0,
    "createdAt": "2023-05-01T07:46:59Z",
    "updatedAt": "2026-01-07T22:49:27.803142427Z"
  }
]
```

### endCharacterQuests

Quest progress updates (null if no quest progress).

```javascript
null  // or array of quest objects
```

---

## Time Formats

### Timestamps

All timestamps are ISO 8601 format:
```javascript
"2026-01-07T22:43:56.33212713Z"
```

Convert to Date object:
```javascript
const timestamp = new Date("2026-01-07T22:43:56.33212713Z");
```

### Durations

All durations are in **nanoseconds**:
- 1 second = 1,000,000,000 nanoseconds (1e9)
- 1 millisecond = 1,000,000 nanoseconds (1e6)

**Conversion:**
```javascript
const durationNanos = 180000000000;
const durationSeconds = durationNanos / 1e9;        // 180 seconds
const durationMillis = durationNanos / 1e6;         // 180,000 milliseconds
const durationMinutes = durationNanos / 1e9 / 60;   // 3 minutes
```

**Common Durations:**
- Attack interval: ~2.5-3.5 seconds (2.5e9 - 3.5e9 nanoseconds)
- Enrage timer: 180 seconds (180e9 nanoseconds = 3 minutes)
- Buff duration: 240-300 seconds (240e9 - 300e9 nanoseconds = 4-5 minutes)

---

## Use Cases

### Dungeon Wave Tracking

**Track current wave and progress:**
```javascript
// From new_battle message
const currentWave = message.wave + 1;        // Convert to 1-indexed (wave 0 = "Wave 1")
const maxWaves = 50;                         // From init_client_data dungeonInfo
const progress = (currentWave / maxWaves) * 100;

console.log(`Wave ${currentWave}/${maxWaves} (${progress.toFixed(1)}%)`);
```

**Detect boss waves:**
```javascript
// Boss waves are every 5th wave (5, 10, 15, 20, ...)
const isBossWave = currentWave % 5 === 0;

// Or check enemy HP
const hasBoss = message.monsters.some(m => m.maxHitpoints > 5000);
```

**Calculate wave duration:**
```javascript
// Store wave start time from new_battle
let waveStartTime = new Date(message.combatStartTime);

// On action_completed, calculate elapsed
const now = new Date();
const waveDuration = (now - waveStartTime) / 1000;  // seconds
```

**Estimate time remaining:**
```javascript
// Track average wave time
let totalWaveTime = 0;
let completedWaves = message.wave + 1;
let avgWaveTime = totalWaveTime / completedWaves;

// Calculate ETA
let remainingWaves = maxWaves - completedWaves;
let estimatedTimeRemaining = avgWaveTime * remainingWaves;  // seconds
```

### Loot Tracking

**Track drops from action_completed:**
```javascript
// Compare endCharacterItems with previous state
const previousCount = previousInventory[itemHash]?.count || 0;
const newCount = message.endCharacterItems.find(i => i.hash === itemHash)?.count || 0;
const gained = newCount - previousCount;

if (gained > 0) {
  console.log(`+${gained} ${itemName}`);
}
```

**Track gold per wave:**
```javascript
const goldItem = message.endCharacterItems.find(i => i.itemHrid === "/items/coin");
const goldGained = goldItem.count - previousGold;
const goldPerWave = goldGained / (message.endCharacterAction.currentCount);
```

### XP Tracking

**Calculate XP gained:**
```javascript
// From action_completed
const previousXP = previousAbilityXP[abilityHrid] || 0;
const newXP = message.endCharacterAbilities.find(a => a.abilityHrid === abilityHrid)?.experience || 0;
const xpGained = newXP - previousXP;
```

**Track XP per hour:**
```javascript
const elapsedSeconds = (Date.now() - startTime) / 1000;
const elapsedHours = elapsedSeconds / 3600;
const xpPerHour = totalXPGained / elapsedHours;
```

### Party Monitoring

**Track party health:**
```javascript
// From new_battle
const partyHP = message.players.reduce((sum, p) => sum + p.currentHitpoints, 0);
const partyMaxHP = message.players.reduce((sum, p) => sum + p.maxHitpoints, 0);
const partyHealthPercent = (partyHP / partyMaxHP) * 100;

if (partyHealthPercent < 50) {
  console.warn("Party health critical!");
}
```

**Track deaths:**
```javascript
const deaths = message.players.reduce((sum, p) => sum + p.deathCount, 0);
const deathsThisRun = deaths - previousDeaths;
```

**Track alive count:**
```javascript
const aliveCount = message.players.filter(p => p.currentHitpoints > 0).length;
const totalPlayers = message.players.length;
console.log(`${aliveCount}/${totalPlayers} players alive`);
```

### Combat Progress

**Track enemy HP remaining:**
```javascript
const enemyHP = message.monsters.reduce((sum, m) => sum + m.currentHitpoints, 0);
const enemyMaxHP = message.monsters.reduce((sum, m) => sum + m.maxHitpoints, 0);
const waveProgress = 1 - (enemyHP / enemyMaxHP);
console.log(`Wave ${(waveProgress * 100).toFixed(1)}% complete`);
```

**Detect enrage:**
```javascript
const enragedEnemies = message.monsters.filter(m => m.isEnraged);
if (enragedEnemies.length > 0) {
  console.warn("Enemies enraged!");
}
```

### Action Queue Monitoring

**Track action progress:**
```javascript
// From action_completed
const action = message.endCharacterAction;
if (action.hasMaxCount) {
  const progress = (action.currentCount / action.maxCount) * 100;
  console.log(`${action.currentCount}/${action.maxCount} (${progress.toFixed(1)}%)`);
} else {
  // Unlimited action (dungeon/zone combat)
  console.log(`${action.currentCount} completions, Wave ${action.wave + 1}`);
}
```

**Detect action completion:**
```javascript
if (message.endCharacterAction.isDone) {
  console.log("Action complete!");
  // Dungeon finished, action removed from queue, etc.
}
```

---

## Message Flow Examples

### Starting a Dungeon

1. **User clicks "Start Dungeon"** → Action added to queue
2. **`new_battle` fires** → Wave 0 starts, get all player/monster data
3. **Combat progresses...** → HP changes, abilities used
4. **`action_completed` fires** → Wave 0 complete, get loot/XP
5. **`new_battle` fires** → Wave 1 starts
6. **Repeat** until final wave
7. **`action_completed` with `isDone: true`** → Dungeon complete

### Tracking a Full Dungeon Run

```javascript
// Store dungeon start
let dungeonStart = null;
let currentWave = 0;
let waveStartTimes = [];
let waveLoot = [];

// Listen for new_battle
webSocketHook.on('new_battle', (data) => {
  if (data.wave === 0) {
    // First wave - dungeon started
    dungeonStart = new Date(data.combatStartTime);
  }

  currentWave = data.wave;
  waveStartTimes[currentWave] = new Date(data.combatStartTime);

  console.log(`Wave ${currentWave + 1}/50 started`);
});

// Listen for action_completed
webSocketHook.on('action_completed', (data) => {
  const action = data.endCharacterAction;

  // Track wave time
  const waveEnd = new Date();
  const waveStart = waveStartTimes[action.wave];
  const waveDuration = (waveEnd - waveStart) / 1000;

  console.log(`Wave ${action.wave + 1} completed in ${waveDuration.toFixed(1)}s`);

  // Track loot
  waveLoot[action.wave] = data.endCharacterItems;

  // Check if dungeon complete
  if (action.isDone) {
    const totalTime = (waveEnd - dungeonStart) / 1000;
    console.log(`Dungeon completed in ${totalTime.toFixed(1)}s`);
  }
});
```

---

## Notes

**Data Persistence:**
- XP values in `action_completed` are **total**, not gained this action
- Item counts in `endCharacterItems` are **total**, not gained this action
- Must track previous values to calculate gains
- `new_battle` provides snapshot at wave start
- `action_completed` provides updates after each encounter

**Wave Numbering:**
- Wave numbers are **0-indexed** in messages (0 = first wave)
- Display as **1-indexed** to users (Wave 1, Wave 2, etc.)
- Final wave: `wave = maxWaves - 1` (e.g., wave 49 for 50-wave dungeon)

**Party Data:**
- `new_battle` includes all party members
- Solo play: `players.length === 1`
- Party play: `players.length > 1`
- Track party member names/IDs for proper attribution

**Missing Data:**
- ❌ Dungeon name/tier (not in these messages - must track from action start)
- ❌ Cumulative dungeon stats (must calculate from wave data)
- ❌ Individual drop amounts per action (only total counts provided)

---

**Last Updated:** 2026-01-07
**Version:** Based on game version 1.20251205.0
