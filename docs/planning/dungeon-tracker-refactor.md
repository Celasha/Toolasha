# Dungeon Tracker Refactor Plan

**Created:** 2025-01-11
**Status:** Planning Phase
**Goal:** Migrate run history from WebSocket tracking to party chat message parsing

---

## Executive Summary

The dungeon tracker currently uses WebSocket messages for real-time tracking AND run history storage, which causes data corruption during computer hibernation/sleep (e.g., 625-minute runs). We will migrate to a hybrid approach: WebSocket for live UI only, party chat messages for authoritative run history (like the working DRT scripts).

---

## Current State Analysis

### WebSocket Tracking System

**Location:** `src/features/combat/dungeon-tracker.js`

**What it does:**

- Listens to `new_battle` (wave start), `action_completed` (wave end)
- Tracks elapsed time using `Date.now()` (wall-clock)
- Captures party message timestamps (`firstKeyCountTimestamp`, `lastKeyCountTimestamp`)
- Saves runs to IndexedDB on completion via `completeDungeon()`
- Provides live UI updates (elapsed time, wave counter, progress bar)

**Current duration logic (line 945-946):**

```javascript
// Use party message duration if available (authoritative), otherwise use tracked duration
const totalTime = validated ? partyMessageDuration : trackedTotalTime;
```

**Problem:** If party messages missing (hibernation/disconnect), falls back to wall-clock time which includes sleep duration.

### Party Chat Annotation System

**Location:** `src/features/combat/dungeon-tracker-chat-annotations.js`

**What it does:**

- Monitors DOM for party chat messages
- Parses timestamps from message text
- Extracts "Key counts", "Party failed", "Battle ended" events
- Annotates messages with colored timers and averages
- Uses server timestamps (immune to hibernation)

**Current approach:** Only adds visual annotations, doesn't manage run history

### Run History Section (UI)

**Location:** `src/features/combat/dungeon-tracker-ui.js`

**What it shows:**

- Organized by dungeon HRID + tier
- Individual run times with validation status (✓/?)
- Delete button per run
- Stats: Avg/Last/Fastest/Slowest

**Data source:** `dungeonTrackerStorage.getRunHistory(dungeonHrid, tier)`

### Team History Section (UI)

**Location:** `src/features/combat/dungeon-tracker-ui.js`

**What it shows:**

- Organized by team composition (sorted player names)
- Aggregate stats per team
- Backfill button to scan party chat
- Clear team history button

**Data source:** `dungeonTrackerStorage.getAllTeamStats()`

---

## Problems Identified

### 1. Hibernation Corruption (Critical)

**Symptom:** 625-minute run recorded when computer hibernated for 10 hours

**Root cause:**

- WebSocket tracking uses `Date.now()` for elapsed time
- Computer hibernation pauses JavaScript but doesn't reset Date.now()
- On wake: `endTime - startTime` includes sleep duration
- Party messages missed during hibernation (WebSocket disconnect)
- Falls back to corrupted wall-clock time

**Impact:** Skews average, becomes "slowest run", pollutes statistics

### 2. Backfill Counts Failed Runs (Critical)

**Symptom:** 1:59 run in stats (impossible fast time)

**Root cause (line 1177-1200 in dungeon-tracker.js):**

```javascript
for (let i = 0; i < keyCountEvents.length - 1; i++) {
    const current = keyCountEvents[i];
    const next = keyCountEvents[i + 1];

    // BUG: Counts ANY consecutive key counts as valid run
    // Doesn't check if "Party failed" or "Battle ended" in between
    let duration = next.timestamp - current.timestamp;
    // ...saves it
}
```

**Should be:** Only count key→key pairs, exclude key→fail and key→cancel

### 3. Duplicate Tracking Systems

- WebSocket tracking: For live UI AND history
- Party chat parsing: For annotations AND team history
- Two sources of truth cause maintenance burden and bugs

### 4. UI Split Between Run History and Team History

- Users want to see runs grouped by team OR dungeon
- Current split forces choosing one dimension
- Can't answer "How does Team A perform on Dungeon X?"

---

## Proposed Solution

### Architecture: Hybrid Approach

**WebSocket Role:** Live UI feedback ONLY

- Track current wave, elapsed time, progress
- Display key counts in real-time
- NO saving to history

**Party Chat Role:** Authoritative history source

- Parse chat messages for completed runs
- Extract dungeon name, team composition, timestamps
- Save to IndexedDB immediately after parsing
- Backfill from historical messages

### Why This Works

**Advantages of party chat timestamps:**

1. **Hibernation-immune:** Server timestamps don't include sleep time
2. **Self-correcting:** Re-scanning chat rebuilds accurate history
3. **Simple validation:** Only save key→key pairs (completed runs)
4. **Matches DRT approach:** Proven to work in production scripts

**What we keep from WebSocket:**

- Live UI updates (players want to see progress)
- Wave-level tracking (for per-wave stats)
- Key counts display (real-time party member progress)

---

## Data Extraction from Party Chat

### Message Types to Capture

**1. Battle Started (Optional but Preferred)**

```
[01/11 10:30:45] Battle started: Chimerical Den
```

- Message type: `systemChatMessage.partyBattleStarted`
- Extract: `dungeonName` from `systemMetadata.name`
- Use: Label runs with dungeon name

**2. Key Counts (Required - Start)**

```
[01/11 10:30:50] Key counts: [Player1 - 1234] [Player2 - 5678]
```

- Message type: `systemChatMessage.partyKeyCount`
- Extract: Timestamp, team composition (player names)
- Marks: Run start if first after Battle Started

**3. Key Counts (Required - End)**

```
[01/11 10:35:22] Key counts: [Player1 - 1240] [Player2 - 5684]
```

- Same format as start
- Marks: Run completion
- Duration: `endTimestamp - startTimestamp`

**4. Party Failed (Invalidates Run)**

```
[01/11 10:33:15] Party failed on wave 25
```

- Message type: `systemChatMessage.partyFailed`
- Effect: Key counts before this are NOT a completed run

**5. Battle Ended (Invalidates Run)**

```
[01/11 10:33:20] Battle ended: Fled
```

- Text pattern: `Battle ended:`
- Effect: Key counts before this are NOT a completed run

### Extraction Logic

```javascript
// Pseudo-code for chat parsing
const events = [];

for (const message of partyMessages) {
    if (message.m === 'systemChatMessage.partyBattleStarted') {
        events.push({
            type: 'battle_start',
            timestamp: new Date(message.t),
            dungeonName: JSON.parse(message.systemMetadata).name,
        });
    }

    if (message.m === 'systemChatMessage.partyKeyCount') {
        const team = parseTeamFromKeyCount(message.systemMetadata.keyCountString);
        events.push({
            type: 'key',
            timestamp: new Date(message.t),
            team: team.sort(),
        });
    }

    if (message.m === 'systemChatMessage.partyFailed') {
        events.push({ type: 'fail', timestamp: new Date(message.t) });
    }

    if (message.text?.includes('Battle ended:')) {
        events.push({ type: 'cancel', timestamp: new Date(message.t) });
    }
}

// Build runs from events
const runs = [];
for (let i = 0; i < events.length; i++) {
    if (events[i].type !== 'key') continue;

    const next = events[i + 1];
    if (!next) break;

    // Only count key→key as valid run
    if (next.type === 'key') {
        const duration = next.timestamp - events[i].timestamp;

        // Find nearest battle_start before this run
        const battleStart = events
            .slice(0, i)
            .reverse()
            .find((e) => e.type === 'battle_start');

        runs.push({
            timestamp: events[i].timestamp.toISOString(),
            duration: duration,
            dungeonName: battleStart?.dungeonName || 'Unknown',
            team: events[i].team,
            teamKey: events[i].team.join(','),
            validated: true,
            source: 'chat',
        });
    }
    // key→fail or key→cancel = skip (not a completed run)
}
```

### Dungeon Name Matching

**Strategy:** Find nearest "Battle started" message BEFORE the run's first key count

**Cases:**

1. **Battle started found:** Use dungeon name from message
2. **Battle started missing:** Label as "Unknown"
    - Happens when: Chat scrolled, mid-session join, backfilling old runs
    - **User preference:** Save these runs anyway with "Unknown" label

**No tier detection needed:** Battle started message doesn't include tier information

---

## Storage Structure

### Current State

**Run History Storage:**

```javascript
// IndexedDB: dungeonRuns store
// Key: `${dungeonHrid}_${tier}`
{
  runs: [
    {
      startTime: 1234567890,
      endTime: 1234567890,
      totalTime: 300000, // milliseconds
      trackedDuration: 300000,
      partyMessageDuration: 300000,
      validated: true,
      avgWaveTime: 6000,
      fastestWave: 5000,
      slowestWave: 7000,
      wavesCompleted: 50,
      waveTimes: [...],
      keyCountMessages: [...]
    }
  ]
}
```

**Team History Storage:**

```javascript
// IndexedDB: teamRuns store
// Key: sorted player names joined by comma
{
    runs: [
        {
            timestamp: '2025-01-11T10:00:00Z',
            duration: 300000,
        },
    ];
}
```

### Proposed Unified Structure

**Single Storage System:**

```javascript
// IndexedDB: dungeonRuns store
// Key: timestamp (for chronological ordering)
// OR: Keep per-dungeon keys for query performance
{
    runs: [
        {
            // Identity
            timestamp: '2025-01-11T10:00:00Z',

            // Dungeon Info
            dungeonName: 'Chimerical Den', // or "Unknown"
            dungeonHrid: null, // Cannot reliably determine from name
            tier: null, // Not available in chat messages

            // Team Info
            team: ['Player1', 'Player2'], // Sorted array
            teamKey: 'Player1,Player2', // For filtering/grouping

            // Timing
            duration: 300000, // milliseconds

            // Metadata
            validated: true, // Always true for chat-based
            source: 'chat', // vs "websocket" (legacy)

            // Optional future expansion
            waveTimes: null, // WebSocket-only data
            avgWaveTime: null,
        },
    ];
}
```

**Storage Organization Decision:**

**Option A: Flat chronological list**

- Single array of all runs across all dungeons/teams
- Filter in-memory when displaying
- Simpler to implement
- Con: Slower queries for large datasets

**Option B: Keep dungeon-keyed storage**

- Key: `${dungeonName}` (since no HRID/tier available)
- Con: "Unknown" dungeons all share one key
- Con: Need to scan all keys to get team-filtered view

**Option C: Dual indexing**

- Primary: Chronological array
- Secondary: In-memory indexes by dungeon/team
- Rebuild indexes on data load
- Best query performance

**Recommendation:** Start with Option A (flat list), migrate to Option C if performance issues arise

---

## UI Changes

### Merged Run History Section

**Current state:** Two separate sections (Run History, Team History)

**New state:** Single unified "Run History" section

### UI Controls

```
┌─────────────────────────────────────────────┐
│ Run History                           ▼ □   │
│ ┌─────────────────────────────────────────┐ │
│ │ Group by: [Team ▼]                      │ │
│ │ Filter:                                 │ │
│ │   Dungeon: [All Dungeons ▼]            │ │
│ │   Team:    [All Teams ▼]               │ │
│ │ [⟳ Backfill]  [✕ Clear All]            │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Player1, Player2 (12 runs)                  │
│   Avg: 4m 32s | Best: 3m 12s | Worst: 5m 45s│
│   Dungeons: Chimerical Den (8), Unknown (4) │
│   ▼ [Show runs]                             │
│                                             │
│ Player1, Player3 (5 runs)                   │
│   Avg: 6m 15s | Best: 5m 01s | Worst: 7m 30s│
│   Dungeons: Sinister Circus (5)            │
│   ▼ [Show runs]                             │
└─────────────────────────────────────────────┘
```

**When grouped by Team (default):**

- Shows each unique team composition
- Aggregated stats per team (across all dungeons)
- Lists which dungeons this team ran
- Expandable to show individual runs

**When grouped by Dungeon:**

- Shows each dungeon name (including "Unknown")
- Aggregated stats per dungeon (across all teams)
- Lists which teams ran this dungeon
- Expandable to show individual runs

**When filters applied:**

- Stats recalculated for filtered subset
- Empty state: "No runs match filters"

### Individual Run Display

**Expanded run list:**

```
┌─────────────────────────────────────────────┐
│ Player1, Player2 (12 runs)            ▲     │
│   Avg: 4m 32s | Best: 3m 12s | Worst: 5m 45s│
│   Dungeons: Chimerical Den (8), Unknown (4) │
│                                             │
│   #12  4m 32s  Chimerical Den  [✕]         │
│   #11  3m 12s  Chimerical Den  [✕]  ← Best │
│   #10  4m 45s  Unknown         [✕]         │
│   #9   5m 01s  Chimerical Den  [✕]         │
│   ...                                       │
└─────────────────────────────────────────────┘
```

**Run row format:**

- Run number (descending, most recent = highest)
- Duration (formatted as "4m 32s")
- Dungeon name
- Delete button (✕)
- Optional badge: "Best" / "Worst" for team

### Stats Calculation

**Stats shown depend on grouping:**

**By Team:**

- Per-team stats: Average of all runs for this team (any dungeon)
- Filter by dungeon: Recalculate for team on that dungeon only

**By Dungeon:**

- Per-dungeon stats: Average of all runs on this dungeon (any team)
- Filter by team: Recalculate for this team on this dungeon

**Always shown:**

- Total run count
- Average duration
- Best (fastest) duration
- Worst (slowest) duration

**Header stats (always visible):**

```
Last Run: 4m 32s
Avg Run: 4m 45s
Runs: 67
Keys: 1234 (current player's key count from live tracking)
```

These show stats for **active filters** (or all runs if no filter)

---

## Implementation Plan

### Phase 1: Fix Backfill (Critical Bug Fix)

**Goal:** Stop counting failed/canceled runs in backfill

**Files to modify:**

- `src/features/combat/dungeon-tracker.js` (backfillFromChatHistory function)

**Changes:**

1. Extract ALL event types (key, fail, cancel) from chat
2. Loop through events
3. Only create run for key→key pairs
4. Skip key→fail and key→cancel pairs

**Testing:**

- Backfill with chat containing failed run
- Verify 1:59 ghost runs don't appear

**Estimated effort:** 1 hour

### Phase 2: Add Dungeon Name Extraction

**Goal:** Capture dungeon name from "Battle started" messages

**Files to modify:**

- `src/features/combat/dungeon-tracker.js` (backfillFromChatHistory)
- `src/features/combat/dungeon-tracker-chat-annotations.js` (extractChatEvents)

**Changes:**

1. Add battle_start event extraction
2. Match runs to nearest preceding battle_start
3. Store dungeonName in run object
4. Default to "Unknown" if no battle_start found

**Testing:**

- Complete dungeon, verify name captured
- Backfill old runs, verify "Unknown" for missing battle_start
- Switch dungeons mid-run, verify correct dungeon matched

**Estimated effort:** 2 hours

### Phase 3: Migrate Storage Structure

**Goal:** Unify run and team storage into single structure

**Files to modify:**

- `src/features/combat/dungeon-tracker-storage.js`

**Changes:**

1. Create migration function to convert old data
2. Update saveRun() to use new structure
3. Update getRunHistory() to filter/group by dungeon or team
4. Add getAllRuns() for unfiltered access
5. Keep backward compatibility for existing data

**Migration strategy:**

```javascript
// One-time migration on first load
async migrateToUnifiedStorage() {
    const oldRuns = await getAllOldFormatRuns();
    const oldTeamRuns = await getAllTeamRuns();

    const migratedRuns = [];

    // Convert WebSocket runs (mark as unvalidated legacy)
    for (const run of oldRuns) {
        migratedRuns.push({
            timestamp: new Date(run.startTime).toISOString(),
            dungeonName: run.dungeonName || 'Unknown',
            dungeonHrid: run.dungeonHrid,
            tier: run.tier,
            team: [], // Unknown for old WebSocket runs
            teamKey: '',
            duration: run.totalTime,
            validated: run.validated,
            source: 'websocket_legacy'
        });
    }

    // Convert team runs (mark as validated)
    for (const [teamKey, runs] of oldTeamRuns) {
        for (const run of runs) {
            migratedRuns.push({
                timestamp: run.timestamp,
                dungeonName: 'Unknown', // Old format didn't store this
                dungeonHrid: null,
                tier: null,
                team: teamKey.split(','),
                teamKey: teamKey,
                duration: run.duration,
                validated: true,
                source: 'chat'
            });
        }
    }

    await saveUnifiedRuns(migratedRuns);
    await markMigrationComplete();
}
```

**Testing:**

- Create test data in old format
- Run migration
- Verify all runs present in new format
- Verify no data loss

**Estimated effort:** 4 hours

### Phase 4: Rebuild UI with Grouping/Filtering

**Goal:** Single merged section with group-by and filters

**Files to modify:**

- `src/features/combat/dungeon-tracker-ui.js`

**Changes:**

1. Remove separate Team History section
2. Add grouping dropdown (Team/Dungeon)
3. Add filter dropdowns (Dungeon/Team)
4. Implement grouping logic
5. Implement filtering logic
6. Update stats calculation to respect filters
7. Update delete button to work with new storage

**UI State Management:**

```javascript
class DungeonTrackerUI {
    constructor() {
        // ...existing...
        this.groupBy = 'team'; // or 'dungeon'
        this.filterDungeon = 'all'; // or specific dungeon name
        this.filterTeam = 'all'; // or specific team key
        this.isRunHistoryExpanded = false;
    }

    async updateRunHistory() {
        const allRuns = await dungeonTrackerStorage.getAllRuns();

        // Apply filters
        let filteredRuns = allRuns;
        if (this.filterDungeon !== 'all') {
            filteredRuns = filteredRuns.filter((r) => r.dungeonName === this.filterDungeon);
        }
        if (this.filterTeam !== 'all') {
            filteredRuns = filteredRuns.filter((r) => r.teamKey === this.filterTeam);
        }

        // Group runs
        const groups = this.groupBy === 'team' ? this.groupByTeam(filteredRuns) : this.groupByDungeon(filteredRuns);

        // Calculate stats per group
        const groupsWithStats = groups.map((group) => ({
            ...group,
            stats: this.calculateStats(group.runs),
        }));

        // Render UI
        this.renderRunHistory(groupsWithStats);
    }
}
```

**Testing:**

- Switch between Team/Dungeon grouping
- Apply dungeon filter, verify team stats update
- Apply team filter, verify dungeon stats update
- Delete run, verify stats recalculate
- Expand/collapse groups

**Estimated effort:** 6 hours

### Phase 5: Remove WebSocket saveRun Calls

**Goal:** Stop saving runs via WebSocket completion

**Files to modify:**

- `src/features/combat/dungeon-tracker.js` (completeDungeon function)

**Changes:**

1. Comment out or remove `dungeonTrackerStorage.saveRun()` call
2. Keep WebSocket tracking for live UI only
3. Add comment explaining why we don't save here

**Before:**

```javascript
async completeDungeon() {
    // ...state cleanup...

    const completedRun = { /* build run object */ };

    // Save to storage
    await dungeonTrackerStorage.saveRun(completedRun);

    // ...notify completion...
}
```

**After:**

```javascript
async completeDungeon() {
    // ...state cleanup...

    // NOTE: We no longer save runs here. Run history is built from
    // party chat messages by dungeon-tracker-chat-annotations.js
    // This prevents hibernation-corrupted durations from polluting stats.

    // Keep live UI data for current session
    const completedRun = { /* build run object */ };

    // ...notify completion for UI updates only...
}
```

**Also update chat annotation to save on parse:**

```javascript
async annotateAllMessages() {
    const events = this.extractChatEvents();
    const runs = this.buildRunsFromEvents(events);

    // Save parsed runs to storage
    await dungeonTrackerStorage.saveRunsFromChat(runs);

    // Continue with annotation...
}
```

**Testing:**

- Complete dungeon, verify run appears in history from chat (not WebSocket)
- Hibernate during run, complete after wake, verify duration correct
- Check storage, verify no WebSocket-based runs saved

**Estimated effort:** 2 hours

### Phase 6: Testing & Validation

**Integration testing:**

1. Fresh install (no existing data)
2. Complete 5 dungeons with different teams
3. Fail 2 dungeons mid-run
4. Hibernate during run, complete after wake
5. Backfill historical chat data
6. Test all grouping/filtering combinations
7. Delete runs, verify stats update
8. Clear all history, verify clean state

**Backward compatibility testing:**

1. Existing user with old data format
2. Migration runs automatically
3. Old data visible in new UI
4. Can delete old runs
5. New runs use new format

**Performance testing:**

1. Load with 1000+ runs
2. Verify UI responsive
3. Verify filtering fast
4. Verify stats calculation fast

**Estimated effort:** 4 hours

---

## Edge Cases

### 1. Battle Started Missing

**Scenario:** Key counts appear but no preceding "Battle started" message

**Causes:**

- Chat scrolled (> 100 messages ago)
- Mid-session join (dungeon started before script loaded)
- Backfilling old runs

**Solution:**

- Label dungeon as "Unknown"
- Still save the run (per user preference)
- User can filter by "Unknown" to see these runs

**UI consideration:** Show count of Unknown runs prominently

### 2. Dungeon Switching Mid-Run

**Scenario:** Battle started for Dungeon A, but completed Dungeon B

**Causes:**

- Extremely rare edge case
- Would require leaving dungeon, starting new one, both in quick succession

**Solution:**

- Accept nearest Battle started (likely correct 99.9% of time)
- Run will be mislabeled as Dungeon A instead of B
- User can manually delete if noticed

**Alternative:** Add heuristic checking if duration is unreasonable (> 60 minutes)

### 3. Chat Scroll Limit

**Scenario:** Chat only shows last ~100 messages, older runs scroll away

**Impact:**

- Cannot backfill runs older than ~100 messages
- If chat very active, might lose runs within hours

**Mitigation:**

- Save to IndexedDB immediately on each chat parse
- Once saved, doesn't matter if message scrolls away
- Backfill on page load captures everything visible

**User guidance:** Run backfill periodically if doing many runs

### 4. Solo Runs

**Scenario:** User completes dungeon solo (no party)

**Behavior:**

- No party chat messages generated
- WebSocket tracking still works for live UI
- Run NOT saved to history (per user preference)

**UI consideration:** Show message "Solo runs not tracked in history"

**Future enhancement:** Could add option to save solo runs with team = [username]

### 5. Multiple Characters

**Scenario:** User switches between characters on same browser

**Current behavior:**

- characterId extracted from URL
- Storage namespaced per character
- Chat messages are character-specific

**Verification needed:**

- Ensure party chat from Character A doesn't pollute Character B's history
- Ensure characterId properly isolated in storage keys

### 6. Party Member Changes Mid-Run

**Scenario:** Player leaves/joins party during dungeon

**Chat messages:**

- First Key counts: [Player1, Player2, Player3]
- Last Key counts: [Player1, Player2, Player4]

**Solution:**

- Use team from FIRST key counts (run start)
- Ignore changes mid-run
- Duration still valid (based on timestamps, not team)

**Alternative:** Could detect team changes and mark run specially

### 7. Duplicate Runs in Backfill

**Scenario:** Same run appears multiple times in chat history

**Prevention:**

```javascript
// Check for duplicates before saving
const isDuplicate = existingRuns.some(
    (existing) =>
        existing.timestamp === newRun.timestamp &&
        existing.teamKey === newRun.teamKey &&
        Math.abs(existing.duration - newRun.duration) < 1000 // Within 1 second
);

if (!isDuplicate) {
    saveRun(newRun);
}
```

### 8. Negative Duration (Midnight Rollover)

**Scenario:** Run starts 11:59 PM, ends 12:01 AM

**Current handling (already implemented):**

```javascript
let duration = next.timestamp - e.timestamp;
if (duration < 0) {
    duration += 24 * 60 * 60 * 1000; // Add 24 hours
}
```

**Verify:** This logic preserved in new implementation

### 9. Very Long Runs (Legitimate)

**Scenario:** Party takes 90+ minutes on hard dungeon (learning mechanics)

**Current system:** Would be flagged as suspicious if we add max duration cap

**Solution:**

- No hard cap on duration
- Runs sourced from chat are trusted (server timestamps authoritative)
- Only flag WebSocket-based runs (legacy) over threshold

### 10. WebSocket Reconnection Mid-Run

**Scenario:** Network drops during dungeon, reconnects before completion

**Behavior:**

- WebSocket tracking loses state
- Chat messages on reconnect should still capture both key counts
- Run history unaffected (chat-based)
- Live UI might show incorrect elapsed time

**Mitigation:** Live UI is best-effort, history is authoritative

---

## User Preferences (From Discussion)

### 1. Unknown Dungeons

**Question:** Save runs where battle started is missing?
**Answer:** Yes, save them with label "Unknown"

**Rationale:**

- Better to have data labeled Unknown than lose it
- User can still see team performance
- Can filter by "Unknown" to investigate

### 2. Default Grouping

**Question:** Group by Team or Dungeon by default?
**Answer:** By Team

**Rationale:**

- Teams are the primary variable players control
- Want to see which team compositions work well
- Dungeon grouping is secondary analysis

### 3. Tier Detection

**Question:** Try to determine tier from dungeon name?
**Answer:** No

**Rationale:**

- Battle started message format doesn't include tier
- Example: "Battle started: Chimerical Den" (no "- Tier 2" suffix)
- Not worth the complexity to try to infer

---

## Migration Strategy

### Data Preservation

**Existing user data must not be lost**

**Old format runs:**

- WebSocket-based runs in dungeonRuns store
- Team runs in teamRuns store

**Migration approach:**

1. Detect if migration needed (check for migration flag)
2. Read all old format data
3. Convert to new unified format
4. Save converted data to new structure
5. Set migration complete flag
6. Keep old data (don't delete) for safety

**Rollback plan:**

- Old data preserved
- Can write converter to go back if needed
- User can manually export data before upgrade

### Version Compatibility

**Script version tracking:**

```javascript
const STORAGE_VERSION = 2;

async function checkAndMigrate() {
    const currentVersion = await storage.get('storageVersion', 'settings', 1);

    if (currentVersion < 2) {
        await migrateV1toV2();
        await storage.set('storageVersion', 2, 'settings');
    }
}
```

**Future-proofing:**

- Version number in storage
- Migration functions for each version jump
- Can add more migrations later (v2→v3, etc.)

---

## Success Criteria

### Functional Requirements

**Must have:**

- ✅ No hibernation-corrupted runs in history
- ✅ No failed/canceled runs counted as completions
- ✅ Dungeon name captured when available
- ✅ Team composition captured for all runs
- ✅ Grouping by Team or Dungeon
- ✅ Filtering by dungeon and/or team
- ✅ Stats accurate for filtered view
- ✅ Delete individual runs
- ✅ Backfill from historical chat
- ✅ Clear all history

**Nice to have:**

- Export run data as CSV/JSON
- Chart/graph of run times over time
- Personal best tracking per dungeon
- Record book (fastest ever, most runs, etc.)

### Performance Requirements

- UI responsive with 1000+ runs
- Filtering updates in < 100ms
- Stats calculation in < 50ms
- Chat parsing in < 200ms
- Storage saves in < 100ms

### Data Integrity Requirements

- No duplicate runs
- No negative durations
- No impossible durations (< 30 seconds, > 2 hours flagged)
- All runs have valid timestamps
- Team composition properly sorted/deduplicated

---

## Future Enhancements (Out of Scope)

### Phase 7: Enhanced Analytics

- Run time trends (improving/declining)
- Team comparison charts
- Dungeon difficulty ranking by average time
- Personal records tracking

### Phase 8: Export/Import

- Export run history as CSV
- Import runs from file
- Share team statistics

### Phase 9: Achievements

- Fastest run achievements
- Consistency achievements (10 runs within 10% of average)
- Endurance achievements (100 runs on one dungeon)

### Phase 10: Integration

- Cross-reference with DRT scripts
- Merge data from multiple sources
- API for external tools

---

## Open Questions

### 1. Storage Keys

**Question:** How to organize IndexedDB keys for new unified structure?

**Options:**

- A: Single key "allRuns" with giant array
- B: Keys by timestamp: "run_2025-01-11T10:00:00Z"
- C: Keys by date: "runs_2025-01-11" (all runs that day)

**Recommendation:** Option A for simplicity, migrate to C if performance issues

### 2. Legacy WebSocket Data

**Question:** What to do with old WebSocket-based runs after migration?

**Options:**

- A: Keep in storage but mark as "legacy" source
- B: Delete after migration
- C: Keep separate, don't show in new UI

**Recommendation:** Option A (keep but mark) for data preservation

### 3. Refresh Frequency

**Question:** How often to re-parse chat for new runs?

**Current:** On every new chat message (aggressive)

**Options:**

- A: Keep current behavior (most accurate, highest CPU)
- B: Debounce to every 5 seconds
- C: Only on "Key counts" messages

**Recommendation:** Option A (current behavior works well)

### 4. Unknown Dungeon Merging

**Question:** Should all "Unknown" runs be grouped together?

**Scenario:** Could have runs from different dungeons all labeled Unknown

**Options:**

- A: Group all Unknown together (simpler)
- B: Try to separate by team changes (if team same = likely same dungeon)
- C: Show as separate Unknown entries with IDs

**Recommendation:** Option A (simpler, user can investigate if needed)

### 5. UI Space Constraints

**Question:** Run history section getting very large with filters/grouping

**Options:**

- A: Make it a modal/popup
- B: Add pagination (10 groups per page)
- C: Add virtual scrolling for large lists
- D: Keep current scrollable div

**Recommendation:** Start with D, add B if user feedback indicates need

---

## Dependencies & Risks

### External Dependencies

**Browser APIs:**

- IndexedDB (storage)
- MutationObserver (DOM monitoring)
- WebSocket (game messages)

**Game Stability:**

- Party chat message format stability
- WebSocket message format stability
- Chat scroll behavior

### Risk Assessment

**HIGH RISK:**

- Data migration failure (mitigation: backup old data)
- Performance degradation with large datasets (mitigation: profiling before release)

**MEDIUM RISK:**

- Game updates breaking chat message parsing (mitigation: version checking, fallback)
- User confusion with UI changes (mitigation: clear labeling, help text)

**LOW RISK:**

- Edge cases not handled (mitigation: comprehensive testing)
- Browser compatibility (mitigation: test on Chrome, Firefox, Safari)

---

## Rollout Plan

### Phase 1: Development

1. Implement on feature branch
2. Local testing with synthetic data
3. Code review

### Phase 2: Alpha Testing

1. Deploy to test character
2. Run 50+ dungeons with various teams
3. Test all edge cases
4. Verify migration from old data

### Phase 3: Beta Testing

1. Deploy to main character
2. Use alongside old system (both running)
3. Compare results
4. Collect user feedback

### Phase 4: Release

1. Merge to main branch
2. Update version number
3. Build and deploy
4. Monitor for issues

### Phase 5: Cleanup

1. Remove old WebSocket save code after 2 weeks
2. Remove backward compatibility after 1 month
3. Mark migration complete

---

## Appendix: Code Patterns

### Chat Message Parsing Pattern

```javascript
// Extract all party chat events
function extractChatEvents() {
    const messages = [...document.querySelectorAll('[class^="ChatMessage_chatMessage"]')];
    const events = [];

    for (const msg of messages) {
        if (msg.dataset.processed === '1') continue;

        const text = msg.textContent.trim();
        const timestamp = getTimestampFromMessage(msg);
        if (!timestamp) continue;

        // Battle started
        if (text.includes('Battle started:')) {
            const dungeonName = text.split('Battle started:')[1].trim();
            events.push({ type: 'battle_start', timestamp, dungeonName, msg });
        }

        // Key counts
        else if (text.includes('Key counts:')) {
            const team = getTeamFromMessage(msg);
            events.push({ type: 'key', timestamp, team, msg });
        }

        // Party failed
        else if (text.match(/Party failed on wave \d+/)) {
            events.push({ type: 'fail', timestamp, msg });
            msg.dataset.processed = '1';
        }

        // Battle ended
        else if (text.includes('Battle ended:')) {
            events.push({ type: 'cancel', timestamp, msg });
            msg.dataset.processed = '1';
        }
    }

    return events;
}
```

### Run Building Pattern

```javascript
function buildRunsFromEvents(events) {
    const runs = [];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event.type !== 'key') continue;

        const next = events[i + 1];
        if (!next || next.type !== 'key') continue; // Only key→key pairs

        // Calculate duration
        let duration = next.timestamp - event.timestamp;
        if (duration < 0) duration += 24 * 60 * 60 * 1000; // Midnight rollover

        // Find nearest battle_start
        const battleStart = events
            .slice(0, i)
            .reverse()
            .find((e) => e.type === 'battle_start');

        runs.push({
            timestamp: event.timestamp.toISOString(),
            duration: duration,
            dungeonName: battleStart?.dungeonName || 'Unknown',
            team: event.team.sort(),
            teamKey: event.team.sort().join(','),
            validated: true,
            source: 'chat',
        });

        // Mark as processed
        event.msg.dataset.processed = '1';
    }

    return runs;
}
```

### Stats Calculation Pattern

```javascript
function calculateStats(runs) {
    if (!runs || runs.length === 0) {
        return { avgTime: 0, fastestTime: 0, slowestTime: 0, totalRuns: 0 };
    }

    const durations = runs.map((r) => r.duration);
    const total = durations.reduce((sum, d) => sum + d, 0);

    return {
        avgTime: Math.floor(total / runs.length),
        fastestTime: Math.min(...durations),
        slowestTime: Math.max(...durations),
        totalRuns: runs.length,
    };
}
```

---

## Document Maintenance

**Last updated:** 2025-01-11
**Status:** Planning complete, awaiting implementation approval
**Next review:** After Phase 1 completion

**Changelog:**

- 2025-01-11: Initial document creation
