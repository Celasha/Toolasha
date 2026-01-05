# localStorage API Usage Analysis

## Executive Summary

**Problem:** Toolasha is manually decompressing data from localStorage in some places, instead of using the official game API `localStorageUtil.getInitClientData()`.

**Key Understanding:**
- **WebSocket messages** (init_character_data, init_client_data) → Already JSON strings (NOT compressed)
- **localStorage items** ('character', 'initClientData') → Compressed with LZ-string

**Impact:**
- Manual decompression adds complexity
- Requires including LZString library
- Could break if game changes compression method
- Official API handles all edge cases

---

## Data Flow Understanding

### Path 1: WebSocket Messages (Uncompressed)
```
Game Server → WebSocket → JSON string → Save to GM storage
                          ↑ Already JSON, no decompression needed
```

**Example:**
```javascript
// WebSocket message arrives as JSON string
webSocketHook.on('init_client_data', (data) => {
    // data is already a parsed object or JSON string
    GM_setValue('toolasha_init_client_data', message); // ✅ Correct
});
```

### Path 2: localStorage Items (Compressed)
```
Game → localStorage.setItem('initClientData', compressed) → LZ-compressed string
                                                             ↓ Manual decompression
                                                    LZ.decompressFromUTF16()
                                                             ↓
                                                        JSON string
```

**OR using official API:**
```
Game → localStorage.setItem('initClientData', compressed)
                                ↓
                    localStorageUtil.getInitClientData() ✅ Game handles decompression
                                ↓
                          Parsed object
```

---

## Instances Found

### 1. ✅ CORRECT: WebSocket Message Handling (websocket.js lines 121-130)

**Location:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/websocket.js`

**Current Code:**
```javascript
saveCombatSimData(messageType, message) {
    // Save full character data (on login/refresh)
    if (messageType === 'init_character_data') {
        GM_setValue('toolasha_init_character_data', message);  // ✅ CORRECT
        console.log('[WebSocket Hook] init_character_data received and saved');
    }

    // Save client data (for ability special detection)
    if (messageType === 'init_client_data') {
        GM_setValue('toolasha_init_client_data', message);  // ✅ CORRECT
        console.log('[Toolasha] Client data saved for Combat Sim export');
    }
}
```

**Status:** ✅ Already correct - WebSocket messages are already JSON strings, no decompression needed

---

### 2. ✅ CORRECT: Using Official API (data-manager.js lines 124-127)

**Location:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/data-manager.js`

**Current Code:**
```javascript
tryLoadStaticData() {
    try {
        if (typeof localStorageUtil !== 'undefined' &&
            typeof localStorageUtil.getInitClientData === 'function') {
            const data = localStorageUtil.getInitClientData();  // ✅ CORRECT
            if (data && Object.keys(data).length > 0) {
                this.initClientData = data;
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('[Data Manager] Failed to load init_client_data:', error);
        return false;
    }
}
```

**Status:** ✅ Already using official API correctly for reading from localStorage

---

### 3. ❌ INCORRECT: Manual localStorage Decompression (websocket.js lines 177-209)

**Location:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/websocket.js`

**Current Code:**
```javascript
captureClientDataFromLocalStorage() {
    try {
        if (typeof GM_setValue === 'undefined') {
            return;
        }

        const initClientData = localStorage.getItem('initClientData');  // ❌ Reading compressed data
        if (!initClientData) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        let clientDataStr = initClientData;
        let isCompressed = false;

        // Check if compressed
        try {
            JSON.parse(initClientData);
        } catch (e) {
            isCompressed = true;
        }

        // Decompress if needed
        if (isCompressed) {
            if (typeof window.LZString === 'undefined' && typeof LZString === 'undefined') {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 500);
                return;
            }

            try {
                const LZ = window.LZString || LZString;
                clientDataStr = LZ.decompressFromUTF16(initClientData);  // ❌ Manual decompression
            } catch (e) {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                return;
            }
        }

        // Parse and save
        try {
            const clientDataObj = JSON.parse(clientDataStr);
            if (clientDataObj?.type === 'init_client_data') {
                GM_setValue('toolasha_init_client_data', clientDataStr);
                console.log('[Toolasha] Client data captured from localStorage');
            }
        } catch (e) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }
    } catch (error) {
        console.error('[WebSocket] Failed to capture client data from localStorage:', error);
    }
}
```

**Purpose:**
- Saves init_client_data to GM storage for Combat Simulator export
- Used as **fallback** when WebSocket doesn't deliver init_client_data message
- Called from main.js line 45
- Reads compressed data from localStorage (not from WebSocket)

**Issues:**
- Manual localStorage access to compressed data
- Manual compression detection
- Manual LZString decompression
- Waits for LZString library to load
- Complex error handling and retries

---

### 4. ⚠️ DIFFERENT DATA: Character Data Fallback (data-manager.js lines 81-83)

**Location:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/data-manager.js`

**Current Code:**
```javascript
// Fallback initialization polling (runs every 500ms)
const rawData = localStorage.getItem('character');  // Note: 'character', not 'initClientData'
if (rawData) {
    const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));  // ❌ Manual decompression
    if (characterData && characterData.characterSkills) {
        console.log('[DataManager] Fallback: Found character data in localStorage');
        // ... process character data
    }
}
```

**Purpose:**
- Fallback when WebSocket's `init_character_data` message is missed
- Polls every 500ms up to 20 times (10 seconds total)
- Different data: character data (localStorage key 'character'), not client data (localStorage key 'initClientData')

**Status:** ⚠️ Different localStorage key - need to investigate if there's an official API for 'character' data

---

## Official Game API

### Available APIs

According to `/Users/kennydean/Downloads/MWI/CLAUDE.md`:

```javascript
// ✅ Official API for init_client_data (from localStorage 'initClientData')
const gameData = localStorageUtil.getInitClientData();
```

**Benefits:**
- ✅ Official API - Maintained by game developers
- ✅ Safe - Won't break on game updates
- ✅ Simple - Handles decompression automatically from localStorage
- ✅ Clean - No manual localStorage access needed
- ✅ Returns parsed object (not JSON string)

**Unknown:**
- ❓ Is there a `localStorageUtil.getCharacterData()` or similar for 'character' localStorage key?
- ❓ Need to check game's localStorageUtil object for available methods

---

## Proposed Changes

### Change 1: Fix websocket.js (lines 177-209)

**Purpose of this function:**
- Fallback to capture init_client_data when WebSocket message doesn't arrive
- Saves to GM storage for Combat Sim export
- Should use official API instead of manual localStorage decompression

**BEFORE:**
```javascript
captureClientDataFromLocalStorage() {
    try {
        if (typeof GM_setValue === 'undefined') {
            return;
        }

        const initClientData = localStorage.getItem('initClientData');
        if (!initClientData) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        let clientDataStr = initClientData;
        let isCompressed = false;

        // Check if compressed
        try {
            JSON.parse(initClientData);
        } catch (e) {
            isCompressed = true;
        }

        // Decompress if needed
        if (isCompressed) {
            if (typeof window.LZString === 'undefined' && typeof LZString === 'undefined') {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 500);
                return;
            }

            try {
                const LZ = window.LZString || LZString;
                clientDataStr = LZ.decompressFromUTF16(initClientData);
            } catch (e) {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                return;
            }
        }

        // Parse and save
        try {
            const clientDataObj = JSON.parse(clientDataStr);
            if (clientDataObj?.type === 'init_client_data') {
                GM_setValue('toolasha_init_client_data', clientDataStr);
                console.log('[Toolasha] Client data captured from localStorage');
            }
        } catch (e) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }
    } catch (error) {
        console.error('[WebSocket] Failed to capture client data from localStorage:', error);
    }
}
```

**AFTER:**
```javascript
captureClientDataFromLocalStorage() {
    try {
        if (typeof GM_setValue === 'undefined') {
            return;
        }

        // Use official game API instead of manual localStorage access
        if (typeof localStorageUtil === 'undefined' ||
            typeof localStorageUtil.getInitClientData !== 'function') {
            // API not ready yet, retry
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        // API returns parsed object and handles decompression automatically
        const clientDataObj = localStorageUtil.getInitClientData();
        if (!clientDataObj || Object.keys(clientDataObj).length === 0) {
            // Data not available yet, retry
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        // Verify it's init_client_data
        if (clientDataObj?.type === 'init_client_data') {
            // Save as JSON string for Combat Sim export
            const clientDataStr = JSON.stringify(clientDataObj);
            GM_setValue('toolasha_init_client_data', clientDataStr);
            console.log('[Toolasha] Client data captured from localStorage via official API');
        }
    } catch (error) {
        console.error('[WebSocket] Failed to capture client data from localStorage:', error);
        // Retry on error
        setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
    }
}
```

**Benefits:**
- ✅ Removes ~40 lines of complex compression logic
- ✅ Uses official API
- ✅ No longer depends on LZString being loaded
- ✅ Simpler error handling
- ✅ More reliable (game handles all edge cases)
- ✅ Game handles decompression of localStorage 'initClientData'

---

### Change 2: Investigate Character Data API (data-manager.js line 81-83)

**Current Code:**
```javascript
const rawData = localStorage.getItem('character');  // localStorage key 'character'
if (rawData) {
    const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
    // ... process
}
```

**Investigation Needed:**
Check if there's an official API like:
- `localStorageUtil.getCharacterData()`
- `localStorageUtil.getCharacter()`
- Or similar method for localStorage 'character' key

**If Official API Exists:**
Replace with official API call (same pattern as Change 1)

**If NO Official API Exists:**
Keep current manual decompression, but add comment explaining why:
```javascript
// Note: Using manual decompression for localStorage 'character' data as there is no
// official localStorageUtil API for character data (only for initClientData).
// This is a fallback when WebSocket init_character_data message is missed.
// WebSocket message: init_character_data (JSON string, not compressed)
// localStorage item: 'character' (LZ-compressed)
const rawData = localStorage.getItem('character');
if (rawData) {
    const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
    // ... process
}
```

---

## Impact Assessment

### Files to Modify

1. ✅ **websocket.js** (lines 177-209) - Replace manual decompression with official API
2. ⚠️ **data-manager.js** (lines 81-83) - Investigate if official API exists for 'character' localStorage key

### Code Reduction

- **Remove:** ~30 lines of compression detection and decompression logic
- **Replace with:** ~15 lines using official API
- **Net savings:** ~15 lines, reduced complexity

### Dependencies

**BEFORE:**
- Requires LZString library to be loaded
- Must wait for window.LZString or LZString to exist
- Complex retry logic for library loading

**AFTER:**
- Only requires localStorageUtil (game's own API)
- Simpler retry logic (just wait for API availability)
- No external library dependency for this specific operation

### Risk Assessment

**Low Risk:**
- localStorageUtil.getInitClientData() is the official, documented API
- Already used successfully in data-manager.js (line 126)
- Game maintains this API for userscript compatibility
- Widely used by other userscripts (MWI Tools, etc.)

**Testing Required:**
1. Verify Combat Sim export still works (GM_getValue('toolasha_init_client_data'))
2. Verify data is saved correctly as JSON string
3. Test retry logic when page loads slowly
4. Test with and without LZString loaded (should work either way now)

---

## Implementation Order

### Phase 1: Investigation (5 minutes)
1. Check if `localStorageUtil.getCharacterData()` or similar exists
2. Console.log `Object.keys(localStorageUtil)` in browser
3. Document findings

### Phase 2: Fix websocket.js (10 minutes)
1. Replace manual localStorage decompression with official API
2. Test Combat Sim export functionality
3. Verify GM_setValue saves correct format

### Phase 3: Fix or Document data-manager.js (5 minutes)
1. If character API exists: Replace with official API
2. If no API exists: Add explanatory comment
3. Test fallback initialization

### Phase 4: Cleanup (5 minutes)
1. Update CLAUDE.md if needed
2. Add comments explaining API usage
3. Version bump and commit

**Total Time Estimate:** ~25 minutes

---

## Testing Checklist

- [ ] Combat Sim export still works after changes
- [ ] GM_getValue('toolasha_init_client_data') returns valid JSON string
- [ ] Data loads correctly on fresh page load
- [ ] Data loads correctly after page refresh
- [ ] Retry logic works when API not immediately available
- [ ] No console errors related to init_client_data
- [ ] Character data fallback still works (if kept as-is)

---

## Related Documentation

- **CLAUDE.md:** Lines 193-254 (InitClientData Extraction section)
- **data-manager.js:** Lines 1-10 (file header explains official API usage)
- **websocket.js:** Lines 167-170 (comment describes current purpose)

---

**Date:** 2026-01-05
**Status:** ✅ IMPLEMENTATION COMPLETE - All changes applied in v0.4.879

**Changes Applied:**
1. ✅ websocket.js (lines 167-209): Replaced manual decompression with `localStorageUtil.getInitClientData()`
2. ✅ data-manager.js (lines 81-88): Added explanatory comments (no official API exists for character data)
3. ✅ Built and verified in dist/Toolasha.user.js v0.4.879

**Implementation Summary:**
- Reduced ~40 lines of complex compression/decompression logic in websocket.js
- Now uses official game API for init_client_data access
- No longer depends on LZString library for this specific operation
- Character data decompression retained with clear documentation explaining why

**Location:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/websocket.js`

**Current Code:**
```javascript
captureClientDataFromLocalStorage() {
    try {
        if (typeof GM_setValue === 'undefined') {
            return;
        }

        const initClientData = localStorage.getItem('initClientData');  // ❌ WRONG
        if (!initClientData) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        let clientDataStr = initClientData;
        let isCompressed = false;

        // Check if compressed
        try {
            JSON.parse(initClientData);
        } catch (e) {
            isCompressed = true;
        }

        // Decompress if needed
        if (isCompressed) {
            if (typeof window.LZString === 'undefined' && typeof LZString === 'undefined') {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 500);
                return;
            }

            try {
                const LZ = window.LZString || LZString;
                clientDataStr = LZ.decompressFromUTF16(initClientData);  // ❌ WRONG
            } catch (e) {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                return;
            }
        }

        // Parse and save
        try {
            const clientDataObj = JSON.parse(clientDataStr);
            if (clientDataObj?.type === 'init_client_data') {
                GM_setValue('toolasha_init_client_data', clientDataStr);
                console.log('[Toolasha] Client data captured from localStorage');
            }
        } catch (e) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }
    } catch (error) {
        console.error('[WebSocket] Failed to capture client data from localStorage:', error);
    }
}
```

**Purpose:**
- Saves init_client_data to GM storage for Combat Simulator export
- Used as fallback when WebSocket doesn't deliver init_client_data message
- Called from main.js line 45

**Issues:**
- Manual localStorage access
- Manual compression detection
- Manual LZString decompression
- Waits for LZString library to load
- Complex error handling and retries

---

### 3. ⚠️ DIFFERENT DATA: data-manager.js (lines 81-83)

**Location:** `/Users/kennydean/Downloads/MWI/Toolasha/src/core/data-manager.js`

**Current Code:**
```javascript
// Fallback initialization polling (runs every 500ms)
const rawData = localStorage.getItem('character');  // Note: 'character', not 'initClientData'
if (rawData) {
    const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
    if (characterData && characterData.characterSkills) {
        console.log('[DataManager] Fallback: Found character data in localStorage');
        // ... process character data
    }
}
```

**Purpose:**
- Fallback when WebSocket's `init_character_data` message is missed
- Polls every 500ms up to 20 times (10 seconds total)
- Different data: character data, not client data

**Status:** ⚠️ Different localStorage key ('character' not 'initClientData')
- Need to investigate if there's an official API for character data
- Might need to remain as manual decompression if no API exists

---

## Official Game API

### Available APIs

According to `/Users/kennydean/Downloads/MWI/CLAUDE.md`:

```javascript
// ✅ Official API for init_client_data
const gameData = localStorageUtil.getInitClientData();
```

**Benefits:**
- ✅ Official API - Maintained by game developers
- ✅ Safe - Won't break on game updates
- ✅ Simple - Handles decompression automatically
- ✅ Clean - No manual localStorage access needed

**Unknown:**
- ❓ Is there a `localStorageUtil.getCharacterData()` or similar for character data?
- ❓ Need to check game's localStorageUtil object for available methods

---

## Proposed Changes

### Change 1: Fix websocket.js (lines 177-209)

**BEFORE:**
```javascript
captureClientDataFromLocalStorage() {
    try {
        if (typeof GM_setValue === 'undefined') {
            return;
        }

        const initClientData = localStorage.getItem('initClientData');
        if (!initClientData) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        let clientDataStr = initClientData;
        let isCompressed = false;

        // Check if compressed
        try {
            JSON.parse(initClientData);
        } catch (e) {
            isCompressed = true;
        }

        // Decompress if needed
        if (isCompressed) {
            if (typeof window.LZString === 'undefined' && typeof LZString === 'undefined') {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 500);
                return;
            }

            try {
                const LZ = window.LZString || LZString;
                clientDataStr = LZ.decompressFromUTF16(initClientData);
            } catch (e) {
                setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                return;
            }
        }

        // Parse and save
        try {
            const clientDataObj = JSON.parse(clientDataStr);
            if (clientDataObj?.type === 'init_client_data') {
                GM_setValue('toolasha_init_client_data', clientDataStr);
                console.log('[Toolasha] Client data captured from localStorage');
            }
        } catch (e) {
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }
    } catch (error) {
        console.error('[WebSocket] Failed to capture client data from localStorage:', error);
    }
}
```

**AFTER:**
```javascript
captureClientDataFromLocalStorage() {
    try {
        if (typeof GM_setValue === 'undefined') {
            return;
        }

        // Use official game API instead of manual localStorage access
        if (typeof localStorageUtil === 'undefined' ||
            typeof localStorageUtil.getInitClientData !== 'function') {
            // API not ready yet, retry
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        const clientDataObj = localStorageUtil.getInitClientData();
        if (!clientDataObj || Object.keys(clientDataObj).length === 0) {
            // Data not available yet, retry
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
            return;
        }

        // Verify it's init_client_data
        if (clientDataObj?.type === 'init_client_data') {
            // Save as JSON string for Combat Sim export
            const clientDataStr = JSON.stringify(clientDataObj);
            GM_setValue('toolasha_init_client_data', clientDataStr);
            console.log('[Toolasha] Client data captured from localStorage');
        }
    } catch (error) {
        console.error('[WebSocket] Failed to capture client data from localStorage:', error);
        // Retry on error
        setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
    }
}
```

**Benefits:**
- ✅ Removes ~40 lines of complex compression logic
- ✅ Uses official API
- ✅ No longer depends on LZString being loaded
- ✅ Simpler error handling
- ✅ More reliable (game handles all edge cases)

---

### Change 2: Investigate Character Data API (data-manager.js line 81-83)

**Current Code:**
```javascript
const rawData = localStorage.getItem('character');
if (rawData) {
    const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
    // ... process
}
```

**Investigation Needed:**
Check if there's an official API like:
- `localStorageUtil.getCharacterData()`
- `localStorageUtil.getCharacter()`
- Or similar method

**If Official API Exists:**
Replace with official API call (same pattern as Change 1)

**If NO Official API Exists:**
Keep current manual decompression, but add comment explaining why:
```javascript
// Note: Using manual decompression for 'character' data as there is no
// official localStorageUtil API for character data (only for initClientData).
// This is a fallback when WebSocket init_character_data message is missed.
const rawData = localStorage.getItem('character');
if (rawData) {
    const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
    // ... process
}
```

---

## Impact Assessment

### Files to Modify

1. ✅ **websocket.js** (lines 177-209) - Replace manual decompression with official API
2. ⚠️ **data-manager.js** (lines 81-83) - Investigate if official API exists for character data

### Code Reduction

- **Remove:** ~30 lines of compression detection and decompression logic
- **Replace with:** ~15 lines using official API
- **Net savings:** ~15 lines, reduced complexity

### Dependencies

**BEFORE:**
- Requires LZString library to be loaded
- Must wait for window.LZString or LZString to exist
- Complex retry logic for library loading

**AFTER:**
- Only requires localStorageUtil (game's own API)
- Simpler retry logic (just wait for API availability)
- No external library dependency for this specific operation

### Risk Assessment

**Low Risk:**
- localStorageUtil.getInitClientData() is the official, documented API
- Already used successfully in data-manager.js (line 126)
- Game maintains this API for userscript compatibility
- Widely used by other userscripts (MWI Tools, etc.)

**Testing Required:**
1. Verify Combat Sim export still works (GM_getValue('toolasha_init_client_data'))
2. Verify data is saved correctly as JSON string
3. Test retry logic when page loads slowly
4. Test with and without LZString loaded (should work either way now)

---

## Implementation Order

### Phase 1: Investigation (5 minutes)
1. Check if `localStorageUtil.getCharacterData()` or similar exists
2. Console.log `Object.keys(localStorageUtil)` in browser
3. Document findings

### Phase 2: Fix websocket.js (10 minutes)
1. Replace manual decompression with official API
2. Test Combat Sim export functionality
3. Verify GM_setValue saves correct format

### Phase 3: Fix or Document data-manager.js (5 minutes)
1. If character API exists: Replace with official API
2. If no API exists: Add explanatory comment
3. Test fallback initialization

### Phase 4: Cleanup (5 minutes)
1. Update CLAUDE.md if needed
2. Add comments explaining API usage
3. Version bump and commit

**Total Time Estimate:** ~25 minutes

---

## Testing Checklist

- [ ] Combat Sim export still works after changes
- [ ] GM_getValue('toolasha_init_client_data') returns valid JSON
- [ ] Data loads correctly on fresh page load
- [ ] Data loads correctly after page refresh
- [ ] Retry logic works when API not immediately available
- [ ] No console errors related to init_client_data
- [ ] Character data fallback still works (if kept as-is)

---

## Related Documentation

- **CLAUDE.md:** Lines 193-254 (InitClientData Extraction section)
- **data-manager.js:** Lines 1-10 (file header explains official API usage)
- **websocket.js:** Lines 167-170 (comment describes current purpose)

---

**Date:** 2026-01-05
**Status:** ✅ IMPLEMENTATION COMPLETE - All changes applied in v0.4.879

**Changes Applied:**
1. ✅ websocket.js (lines 167-209): Replaced manual decompression with `localStorageUtil.getInitClientData()`
2. ✅ data-manager.js (lines 81-88): Added explanatory comments (no official API exists for character data)
3. ✅ Built and verified in dist/Toolasha.user.js v0.4.879

**Implementation Summary:**
- Reduced ~40 lines of complex compression/decompression logic in websocket.js
- Now uses official game API for init_client_data access
- No longer depends on LZString library for this specific operation
- Character data decompression retained with clear documentation explaining why
