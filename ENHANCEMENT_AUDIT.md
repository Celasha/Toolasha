# Enhancement Mechanics Audit System

## Problem Statement

During development of the Enhancement Calculator, we systematically missed **secondary effects** on game mechanics:

### Issues Discovered

1. **House Rooms (Observatory):**
   - ✅ Success Rate: +0.05% per level (detected)
   - ❌ Action Speed: +1% per level (MISSED initially)

2. **Enhancing Teas:**
   - ✅ Level Bonus: +3/+6/+8 (detected)
   - ❌ Action Speed: +2%/+4%/+6% (MISSED initially)

3. **Community Buffs:**
   - ❌ Entire system missed initially

4. **Level Advantage:**
   - ❌ +1% speed per level above item (MISSED initially)

### Root Cause

**Pattern:** When implementing game mechanic detection, we focused on the obvious/documented effect and overlooked secondary effects in the data structures.

**Data Structure Patterns We Missed:**
- Arrays named `buffs` (plural) → multiple effects to process
- Objects with `actionBuffs` array → multiple buff types
- Equipment with multiple `*Bonus` fields → check ALL fields
- Consumable effects scale with `drinkConcentration`

---

## Solution: Automated Validation System

### Architecture

**File:** `/Users/kennydean/Downloads/MWI/MWI Tools/src/utils/enhancement-audit.js`

**Purpose:** Systematically validate that ALL expected effects from game mechanics are being detected and processed.

### Features

1. **Expected Effect Definitions:**
   - House rooms: All actionBuffs for Observatory
   - Teas: All buffs array entries for each tea type
   - Equipment: All noncombat stat fields
   - Community buffs: All enhancing-related buffs

2. **Automatic Validation:**
   - Runs on page load (integrated into main.js)
   - Compares expected effects vs actual game data
   - Warns about missing effects in console
   - Reports successful detections

3. **Manual Testing:**
   - Exposed via MWITools debug object
   - Can be run anytime in console
   - Detailed audit results with warnings and info

---

## Usage

### Automatic (On Page Load)

The audit runs automatically when MWI Tools initializes:

```
[MWI Tools] 🔍 Running Enhancement Mechanics Audit...

[MWI Tools] === HOUSEROOMS ===
[MWI Tools] ℹ️ Observatory: All expected buffs found (2 buffs)
[MWI Tools] ℹ️   → Enhancing Success: /skills/enhancing (+0.05)
[MWI Tools] ℹ️   → Action Speed: /skills/enhancing (+1)

[MWI Tools] === TEAS ===
[MWI Tools] ℹ️ Enhancing Tea: All expected buffs found (2 buffs)
[MWI Tools] ℹ️   → Skill Level Change: /skills/enhancing (+3)
[MWI Tools] ℹ️   → Action Speed: /skills/enhancing (+0.02)

[MWI Tools] === EQUIPMENT ===
[MWI Tools] ℹ️ Found 45 items with enhancing stats
[MWI Tools] ℹ️ Stats found: enhancingSuccess, enhancingSpeed, enhancingRareFind, enhancingExperience, drinkConcentration

[MWI Tools] === COMMUNITYBUTTS ===
[MWI Tools] ℹ️ Enhancing Speed: Found in game data
[MWI Tools] ℹ️   → Base: 20%
[MWI Tools] ℹ️   → Per level: 0.5%

[MWI Tools] ✅ Audit complete: No issues found!
```

### Manual (Console Command)

Run the audit manually anytime:

```javascript
// Full audit with all categories
MWITools.enhancementAudit.runFullAudit(MWITools.dataManager.getInitClientData())

// Individual category audits
const gameData = MWITools.dataManager.getInitClientData();
MWITools.enhancementAudit.auditHouseRoomBuffs(gameData)
MWITools.enhancementAudit.auditTeaBuffs(gameData)
MWITools.enhancementAudit.auditEquipmentStats(gameData)
MWITools.enhancementAudit.auditCommunityBuffs(gameData)
```

---

## Expected Effects Reference

### House Rooms (Observatory)

```javascript
'/house_rooms/observatory': [
    '/buff_types/enhancing_success',  // +0.05% per level
    '/buff_types/action_speed',       // +1% per level
]
```

**Data Location:** `gameData.houseRoomDetailMap['/house_rooms/observatory'].actionBuffs`

**Key Pattern:** `actionBuffs` is an ARRAY - check ALL elements, not just first!

---

### Enhancing Teas

```javascript
'/items/enhancing_tea': [
    '/buff_types/skill_level_change',  // +3 levels
    '/buff_types/action_speed',        // +2% speed
]

'/items/super_enhancing_tea': [
    '/buff_types/skill_level_change',  // +6 levels
    '/buff_types/action_speed',        // +4% speed
]

'/items/ultra_enhancing_tea': [
    '/buff_types/skill_level_change',  // +8 levels
    '/buff_types/action_speed',        // +6% speed
]

'/items/blessed_tea': [
    '/buff_types/double_enhancement_jump',  // 1% double jump
]
```

**Data Location:** `gameData.itemDetailMap[teaHrid].buffs`

**Key Pattern:** Field is named `buffs` (PLURAL) not `buff` (singular) - indicates array!

**Important:** Speed bonuses scale with Drink Concentration:
```javascript
const baseSpeed = 6;  // Ultra Tea base
const concentration = 0.216;  // 21.6% from Guzzling Pouch
const finalSpeed = baseSpeed * (1 + concentration);  // 7.3%
```

---

### Equipment Stats

```javascript
const EXPECTED_EQUIPMENT_STATS = [
    'enhancingSuccess',      // Success rate bonus
    'enhancingSpeed',        // Action speed bonus
    'enhancingRareFind',     // Rare find bonus
    'enhancingExperience',   // Experience bonus
    'drinkConcentration',    // Scales consumable effects
];
```

**Data Location:** `gameData.itemDetailMap[itemHrid].equipmentDetail.noncombatStats`

**Key Pattern:** Multiple fields on same object - check ALL stat fields, not just one!

---

### Community Buffs

```javascript
const EXPECTED_COMMUNITY_BUFFS = [
    '/community_buff_types/enhancing_speed',  // 20% + 0.5% per level
];
```

**Data Location:** `gameData.communityBuffTypeDetailMap`

**Formula:** `20% + (level - 1) × 0.5%` (max 29.5% at T20)

---

## Data Structure Patterns

### Pattern 1: Arrays Indicate Multiple Effects

```javascript
// ❌ WRONG: Reading singular field
const buff = item.buff;  // Misses other buffs!

// ✅ CORRECT: Reading plural array
const buffs = item.buffs;  // Array of all buffs
buffs.forEach(buff => {
    // Process ALL buffs
});
```

### Pattern 2: ActionBuffs Array

```javascript
// ❌ WRONG: Only checking first buff
const firstBuff = room.actionBuffs[0];

// ✅ CORRECT: Iterating all buffs
room.actionBuffs.forEach(buff => {
    // Process each buff type
});
```

### Pattern 3: Multiple Fields on Same Object

```javascript
// ❌ WRONG: Only reading one field
const success = stats.enhancingSuccess;

// ✅ CORRECT: Reading all relevant fields
const success = stats.enhancingSuccess || 0;
const speed = stats.enhancingSpeed || 0;
const rareFind = stats.enhancingRareFind || 0;
const experience = stats.enhancingExperience || 0;
```

### Pattern 4: Scaling Factors

```javascript
// ❌ WRONG: Using base value directly
const teaSpeed = 6;  // Ultra Tea base

// ✅ CORRECT: Applying scaling factor
const drinkConcentration = 0.216;  // From equipment
const teaSpeed = 6 * (1 + drinkConcentration);  // 7.3%
```

---

## Implementation Checklist

When implementing detection for new game mechanics, use this checklist:

### 1. Data Structure Discovery
- [ ] Locate the data in `init_client_data_new.json`
- [ ] Check if field is an ARRAY (plural name is a hint)
- [ ] Check if object has MULTIPLE relevant fields
- [ ] Look for scaling factors (concentration, level advantage, etc.)

### 2. Expected Effects Definition
- [ ] Add expected effects to `enhancement-audit.js`
- [ ] Document all buff types / stat fields
- [ ] Include formulas and scaling information

### 3. Detection Implementation
- [ ] Iterate ALL elements in arrays
- [ ] Read ALL relevant fields on objects
- [ ] Apply scaling factors (don't forget!)
- [ ] Verify against game data

### 4. Validation
- [ ] Run audit to check for warnings
- [ ] Verify calculations match in-game values
- [ ] Test with different configurations

---

## Common Mistakes

### ❌ Don't Do This

```javascript
// 1. Reading singular field instead of array
const buff = tea.buff;  // WRONG: Field is "buffs" (plural)

// 2. Only checking first element
const firstBuff = buffs[0];  // WRONG: Ignoring other buffs

// 3. Using wrong field name
const type = item.equipmentType;  // WRONG: Field is "type"

// 4. Forgetting to scale
const teaSpeed = 6;  // WRONG: Doesn't scale with concentration

// 5. Not checking all fields
const bonus = stats.enhancingSuccess;  // WRONG: Missing speedBonus, rareFindBonus, etc.
```

### ✅ Do This Instead

```javascript
// 1. Read correct array field
const buffs = tea.buffs;  // CORRECT: Plural field name

// 2. Iterate all elements
buffs.forEach(buff => { ... });  // CORRECT: Process all

// 3. Use correct field name
const type = item.equipmentDetail.type;  // CORRECT: Direct access

// 4. Apply scaling factors
const scaled = baseSpeed * (1 + concentration);  // CORRECT: Scaled

// 5. Check all relevant fields
const success = stats.enhancingSuccess || 0;
const speed = stats.enhancingSpeed || 0;
const rareFind = stats.enhancingRareFind || 0;
const experience = stats.enhancingExperience || 0;
// CORRECT: All fields checked
```

---

## Extending the Audit System

### Adding New Mechanics

To add validation for new game mechanics:

1. **Define expected effects** in `enhancement-audit.js`:
```javascript
const EXPECTED_NEW_MECHANIC = {
    '/items/new_item': [
        '/buff_types/expected_buff_1',
        '/buff_types/expected_buff_2',
    ]
};
```

2. **Create audit function**:
```javascript
export function auditNewMechanic(gameData) {
    const results = {
        valid: true,
        warnings: [],
        info: []
    };

    // Validation logic here

    return results;
}
```

3. **Add to full audit**:
```javascript
export function runFullAudit(gameData) {
    const results = {
        houseRooms: auditHouseRoomBuffs(gameData),
        teas: auditTeaBuffs(gameData),
        equipment: auditEquipmentStats(gameData),
        communityBuffs: auditCommunityBuffs(gameData),
        newMechanic: auditNewMechanic(gameData),  // ADD THIS
    };
    // ...
}
```

---

## Benefits

1. **Prevents Systematic Bugs:** Catches missing effects early
2. **Documentation:** Expected effects are clearly defined in code
3. **Confidence:** Audit confirms all effects are detected
4. **Debugging:** Easy to identify what's missing vs what's expected
5. **Maintenance:** Adding new mechanics follows clear pattern

---

## Future Improvements

Potential enhancements to the audit system:

1. **Automated Testing:** Run audit in CI/CD pipeline
2. **JSON Schema Validation:** Validate game data structure changes
3. **Diff Detection:** Alert when game data structure changes
4. **Coverage Reports:** Track which mechanics have validation
5. **Auto-fix Suggestions:** Propose code fixes for missing effects

---

## Conclusion

This audit system provides a **systematic solution** to prevent missing secondary effects. By clearly defining expected effects and validating against game data, we can confidently detect all mechanics without relying on manual testing alone.

**Key Takeaway:** When data structures have arrays or multiple fields, check ALL elements/fields, not just the first/obvious one!
