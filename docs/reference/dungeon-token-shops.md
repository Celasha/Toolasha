# Dungeon Token Shop Data - Implementation Notes

**Date:** January 25, 2026
**Purpose:** Reference for implementing dungeon token shop features in Toolasha

---

## Data Source

**File:** `/Users/kennydean/Downloads/MWI/Monster_Stats/init_client_data_new.json`
**Data Structure:** `shopItemDetailMap` (top-level key)

---

## Shop Item Data Structure

```json
{
    "hrid": "/shop_items/acrobats_ribbon",
    "category": "/shop_categories/dungeon",
    "itemHrid": "/items/acrobats_ribbon",
    "costs": [
        {
            "itemHrid": "/items/sinister_token",
            "count": 2000
        }
    ],
    "sortIndex": 44
}
```

**Key Fields:**

- `hrid`: Unique shop item identifier
- `category`: Shop category (dungeon items use `/shop_categories/dungeon`)
- `itemHrid`: The actual item being purchased
- `costs`: Array of cost objects (typically 1 entry for dungeon shops)
    - `costs[0].itemHrid`: Currency item (e.g., `/items/sinister_token`)
    - `costs[0].count`: Amount of currency required
- `sortIndex`: In-game display order

---

## Complete Dungeon Token Shop Data

### CHIMERICAL TOKEN (`/items/chimerical_token`)

```
sortIndex  Item                           Cost
0          chimerical_essence             1
600        griffin_leather                600
1000       manticore_sting                1,000
1200       jackalope_antler               1,200
3000       dodocamel_plume                3,000
3000       griffin_talon                  3,000
35000      chimerical_quiver              35,000
```

### SINISTER TOKEN (`/items/sinister_token`)

```
sortIndex  Item                           Cost
43         sinister_essence               1
44         acrobats_ribbon                2,000
45         magicians_cloth                2,000
46         chaotic_chain                  3,000
47         cursed_ball                    3,000
48         sinister_cape                  27,000
```

### ENCHANTED TOKEN (`/items/enchanted_token`)

```
sortIndex  Item                           Cost
enchanted_essence              1
royal_cloth                    2,000
knights_ingot                  2,000
bishops_scroll                 2,000
regal_jewel                    3,000
sundering_jewel                3,000
enchanted_cloak                27,000
```

### PIRATE TOKEN (`/items/pirate_token`)

```
sortIndex  Item                           Cost
pirate_essence                 1
marksman_brooch                2,000
corsair_crest                  2,000
damaged_anchor                 2,000
maelstrom_plating              2,000
kraken_leather                 2,000
kraken_fang                    3,000
```

---

## jq Query Commands

### Get all items for a specific token

```bash
jq '.shopItemDetailMap | to_entries | map(select(.value.costs[0].itemHrid == "/items/sinister_token")) | sort_by(.value.sortIndex)' /Users/kennydean/Downloads/MWI/Monster_Stats/init_client_data_new.json
```

### Get formatted list with item names and costs

```bash
jq -r '.shopItemDetailMap | to_entries | map(select(.value.costs[0].itemHrid == "/items/sinister_token")) | sort_by(.value.sortIndex) | .[] | [(.value.itemHrid | sub(".*/"; "")), .value.costs[0].count] | @tsv' /Users/kennydean/Downloads/MWI/Monster_Stats/init_client_data_new.json
```

### Get all dungeon token types

```bash
jq '.shopItemDetailMap | to_entries | map(.value.costs[0].itemHrid) | unique | .[] | select(contains("_token"))' /Users/kennydean/Downloads/MWI/Monster_Stats/init_client_data_new.json
```

---

## Implementation Patterns

### For Currency Page Generation (already implemented in generate_item_pages.py)

**Dungeon Token Info Map:**

```python
dungeon_info = {
    'chimerical': {
        'name': 'Chimerical Den',
        'icon': 'chimerical_den_(action).svg',
        'chest': 'Chimerical Chest'
    },
    'sinister': {
        'name': 'Sinister Circus',
        'icon': 'sinister_circus_(action).svg',
        'chest': 'Sinister Chest'
    },
    'enchanted': {
        'name': 'Enchanted Fortress',
        'icon': 'enchanted_fortress_(action).svg',
        'chest': 'Enchanted Chest'
    },
    'pirate': {
        'name': 'Pirate Cove',
        'icon': 'pirate_cove_(action).svg',
        'chest': 'Pirate Chest'
    }
}
```

### For JavaScript/Userscript Implementation

**Access via dataManager:**

```javascript
const gameData = dataManager.getInitClientData();
const shopItems = gameData.shopItemDetailMap;

// Get all items purchasable with Sinister Tokens
const sinisterShop = Object.values(shopItems)
    .filter((item) => item.costs[0]?.itemHrid === '/items/sinister_token')
    .sort((a, b) => a.sortIndex - b.sortIndex);
```

**Get item details:**

```javascript
const itemDetails = gameData.itemDetailMap[shopItem.itemHrid];
```

---

## Key Observations

1. **Essence Items:** Every dungeon token shop has an "essence" item for 1 token (used for crafting)

2. **Price Tiers:**
    - Essences: 1 token
    - Mid-tier materials: 600-3,000 tokens
    - High-tier equipment: 27,000-35,000 tokens

3. **Dungeon Association:**
    - Token drop source: Dungeon chests (100% drop rate, 250-500 base + 5% chance for bonus)
    - Shop category: All dungeon items use `/shop_categories/dungeon`

4. **sortIndex Pattern:**
    - Chimerical: Low indices (not in 40s range)
    - Sinister: 43-48
    - Enchanted: Unknown (need to check)
    - Pirate: Unknown (need to check)

5. **Wiki Naming:**
    - Item names drop apostrophes: "Acrobat's Ribbon" → "Acrobats Ribbon"
    - Use `get_item_wiki_name()` helper for correct wiki links

---

## Potential Use Cases

1. **Shop Display UI:** Show available items and costs when viewing dungeon token inventory
2. **Purchase Planning:** Calculate how many dungeon runs needed for specific items
3. **Wiki Page Generation:** Already implemented in `generate_item_pages.py`
4. **Tooltip Enhancement:** Show what items can be purchased when hovering over tokens
5. **Shopping List:** Track progress toward expensive items (e.g., Chimerical Quiver at 35k)

---

## Related Files

- **Wiki Generator:** `/Users/kennydean/Downloads/MWI/Wiki/generate_item_pages.py`
    - Function: `generate_currency_page()` (handles dungeon token pages)
    - Lines: 3255-3400 (approximate)

- **Game Data:** `/Users/kennydean/Downloads/MWI/Monster_Stats/init_client_data_new.json`
    - `shopItemDetailMap`: All shop items
    - `itemDetailMap`: Item details (names, descriptions, stats)
    - `openableLootDropMap`: Chest drop rates for tokens

- **Toolasha Data Manager:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/data-manager.js`
    - Use `getInitClientData()` to access game data at runtime

---

## Quick Reference - All 4 Dungeon Token HRIDs

```
/items/chimerical_token
/items/sinister_token
/items/enchanted_token
/items/pirate_token
```

---

**Last Updated:** January 25, 2026
**Version:** v0.5.04 codebase
