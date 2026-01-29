# Dungeon Tracker - Future Features

This document tracks potential enhancements for the Dungeon Tracker that are not part of the initial implementation.

---

## Wave Time Analysis

**Status:** Future exploration

**Description:** Track and analyze wave completion times to identify patterns and bottlenecks.

**Potential Features:**

### 1. Wave Performance Heatmap
- Visual display showing which waves consistently take longer
- Color-coded grid: Green (fast) → Yellow (average) → Red (slow)
- Helps identify problem waves across multiple runs
- Example: "Wave 23 is always slow - maybe we need better cooldown management"

### 2. Wave Time Distribution
- Chart showing time distribution across all waves
- Identify outliers (unusually fast or slow waves)
- Compare current run to historical average per wave
- Example: "This Wave 15 took 2:30, but it usually takes 1:45"

### 3. Boss vs Regular Wave Comparison
- Separate statistics for boss waves (5, 10, 15, 20, etc.) vs regular waves
- Average boss wave time vs average regular wave time
- Identify if boss waves are disproportionately slow
- Help optimize boss strategies

### 4. Progressive Difficulty Analysis
- Track if waves get progressively slower as dungeon continues
- Identify fatigue points (when performance drops)
- Example: "Waves 40-50 average 15% slower than waves 1-10"

### 5. Party Composition Impact
- Compare wave times across different party compositions
- Track which party setups clear specific waves faster
- Requires linking party member data to run history

**Implementation Considerations:**
- Requires storing per-wave timing data (not just run totals)
- May need separate IndexedDB store for wave-level granularity
- UI space needed for charts/visualizations (possibly dedicated panel)
- Data aggregation across multiple runs needed for meaningful patterns

---

## Boss Wave Highlighting

**Status:** Future exploration

**Description:** Provide visual and informational enhancements specifically for boss waves.

**Potential Features:**

### 1. Visual Indicators
- Special icon or color for boss wave counter
- Example: "Wave 20/50 👑" or colored progress bar segment
- Flash/pulse animation when entering boss wave
- Different progress bar color for boss waves (gold instead of blue)

### 2. Boss Wave Countdown
- "Next boss in X waves" indicator
- Helps players prepare cooldowns and consumables
- Example: "Wave 23/50 (Next boss: 2 waves)"

### 3. Boss Wave Performance Tracking
- Separate stats section for boss waves only
- Boss wave average time vs overall average
- Fastest/slowest boss wave this run
- Boss wave completion rate (if wipes can occur)

### 4. Boss Identification
- Display boss monster name when available
- Use monster data from `new_battle.monsters` to identify boss
- Example: "Wave 25/50 - Elder Dragon"
- Requires detecting boss enemies (likely by HP threshold or monster tier)

### 5. Boss Wave Strategy Reminders
- User-configurable notes per dungeon+tier+wave
- Example: "Wave 30: Save burst for second phase"
- Popup reminder when entering specific boss waves
- Stored in IndexedDB per character

**Implementation Considerations:**
- Boss detection logic needed (currently just mathematical: wave % 5 === 0)
- May want to verify boss presence via monster HP/stats from `new_battle` data
- UI elements need to be non-intrusive but visible
- Some features may require dedicated UI space (tooltips, modals, or panels)

---

## Additional Future Ideas

### 1. Death Tracking
- Track party deaths per wave from `new_battle.players[].deathCount`
- Identify dangerous waves across runs
- Death heatmap similar to wave time analysis

### 2. Ability Usage Patterns
- Track which abilities are used on boss waves vs regular waves
- Requires monitoring ability cooldowns from `new_battle.players[].combatAbilities`
- Help optimize rotation strategies

### 3. Enrage Detection
- Track if monsters reach enrage status (`new_battle.monsters[].isEnraged`)
- Flag waves where enrage occurs frequently
- Suggest faster strategies for problematic waves

### 4. Party Health Monitoring
- Track party HP percentage across waves
- Identify waves where party health drops critically low
- Suggest defensive cooldown usage

### 5. Dungeon Comparison Tool
- Compare performance across different dungeons at same tier
- Example: "You're 15% faster at Chimerical Den T1 than Sinister Circus T1"
- Help players choose most efficient dungeon for their gear/party

### 6. Export/Share Functionality
- Export run data for analysis in external tools
- Share run summaries with party members
- Compare runs with other players (leaderboard-style)

---

**Document Created:** January 7, 2026

**Note:** All features in this document are subject to feasibility assessment and may require significant additional WebSocket data analysis before implementation.
