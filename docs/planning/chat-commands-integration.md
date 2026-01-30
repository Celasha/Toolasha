# Chat Commands Integration Proposal

**Source:** MWI Game Commands userscript by Mists (v3.1.1)
**Location:** `/Users/kennydean/Downloads/MWI/chatcommands/Chatcommands.txt`

## Overview

Add chat commands for quick navigation:

- `/item <name>` - Opens Item Dictionary
- `/wiki <name>` - Opens wiki page in new tab
- `/market <name>` - Opens marketplace for item

## Current Implementation Issues

### Architecture Conflicts

1. **Direct localStorage access** - Should use `dataManager.getInitClientData()`
2. **Global window pollution** - Uses `window.MWI_GAME_CORE`, `window.GAME_COMMAND_DATA`
3. **Hard-coded selectors** - Chat input selector vulnerable to game updates
4. **No settings integration** - Not toggleable
5. **Standalone init** - Doesn't use Toolasha lifecycle

### Brittle Code Examples

```javascript
// CURRENT: Direct localStorage (wrong)
const initClientData = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem('initClientData')));

// CURRENT: Brittle selector (breaks on updates)
const CHAT_INPUT_SELECTOR =
    '#root > div > div > div.GamePage_gamePanel__3uNKN > div.GamePage_contentPanel__Zx4FH > div.GamePage_middlePanel__uDts7 > div.GamePage_chatPanel__mVaVt > div > div.Chat_chatInputContainer__2euR8 > form > input';

// CURRENT: Global pollution
window.MWI_GAME_CORE = core;
window.GAME_COMMAND_DATA = itemData;
```

## Proposed Toolasha Integration

### File Structure

**New Files:**

- `src/features/chat/chat-commands.js` - Main module

**Modified Files:**

- `src/features/settings/settings-config.js` - Add settings
- `src/core/feature-registry.js` - Register feature
- `userscript-header.txt` - Version bump
- `package.json` - Version bump

### Architecture Changes

#### 1. Data Access (Use Data Manager)

```javascript
// BEFORE (standalone)
const initClientData = JSON.parse(
    LZString.decompressFromUTF16(localStorage.getItem('initClientData'))
);

// AFTER (Toolasha)
import dataManager from '../../core/data-manager.js';

loadItemData() {
    const initClientData = dataManager.getInitClientData();
    if (!initClientData) return null;

    // Build item name to HRID mapping
    const itemNameToHrid = {};
    const itemHridToName = {};

    for (const [hrid, item] of Object.entries(initClientData.itemDetailMap)) {
        if (item?.name) {
            itemNameToHrid[item.name.toLowerCase()] = hrid;
            itemHridToName[hrid] = item.name;
        }
    }

    return { itemNameToHrid, itemHridToName };
}
```

#### 2. Resilient Selectors

```javascript
// BEFORE (brittle)
const CHAT_INPUT_SELECTOR = '#root > div > div > div.GamePage_gamePanel__3uNKN...';

// AFTER (flexible)
const CHAT_INPUT_SELECTOR = '[class*="Chat_chatInputContainer"] input';
```

#### 3. Settings Integration

```javascript
// Add to src/features/settings/settings-config.js
{
    id: 'chatCommands',
    label: 'Chat Commands',
    description: 'Enable /item, /wiki, /market commands in chat',
    type: 'checkbox',
    defaultValue: true,
    category: 'Quality of Life'
}
```

#### 4. Feature Module Pattern

```javascript
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';

class ChatCommands {
    constructor() {
        this.gameCore = null;
        this.itemData = null;
        this.chatInput = null;
        this.boundKeydownHandler = null;
    }

    /**
     * Setup settings listener for feature toggle
     */
    setupSettingListener() {
        config.onSettingChange('chatCommands', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });
    }

    /**
     * Initialize chat commands feature
     */
    initialize() {
        if (!config.getSetting('chatCommands')) return;

        this.loadItemData();
        this.setupGameCore();
        this.waitForChatInput().then(() => {
            this.attachChatListener();
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.chatInput && this.boundKeydownHandler) {
            this.chatInput.removeEventListener('keydown', this.boundKeydownHandler, true);
            this.chatInput = null;
            this.boundKeydownHandler = null;
        }
    }

    /**
     * Load item data from game
     */
    loadItemData() {
        const initClientData = dataManager.getInitClientData();
        if (!initClientData) {
            console.warn('[Chat Commands] Failed to load item data');
            return;
        }

        this.itemData = {
            itemNameToHrid: {},
            itemHridToName: {},
        };

        for (const [hrid, item] of Object.entries(initClientData.itemDetailMap)) {
            if (item?.name) {
                const normalizedName = item.name.toLowerCase();
                this.itemData.itemNameToHrid[normalizedName] = hrid;
                this.itemData.itemHridToName[hrid] = item.name;
            }
        }
    }

    /**
     * Setup game core access (React Fiber traversal)
     */
    setupGameCore() {
        try {
            const el = document.querySelector('[class*="GamePage_gamePage"]');
            if (!el) return;

            const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
            if (!k) return;

            let f = el[k];
            while (f) {
                if (f.stateNode?.sendPing) {
                    this.gameCore = f.stateNode;
                    return;
                }
                f = f.return;
            }
        } catch (error) {
            console.error('[Chat Commands] Error accessing game core:', error);
        }
    }

    /**
     * Wait for chat input to be available
     */
    async waitForChatInput() {
        for (let i = 0; i < 50; i++) {
            const input = document.querySelector('[class*="Chat_chatInputContainer"] input');
            if (input) {
                this.chatInput = input;
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        console.warn('[Chat Commands] Chat input not found');
    }

    /**
     * Attach keydown listener to chat input
     */
    attachChatListener() {
        if (!this.chatInput) return;

        this.boundKeydownHandler = (event) => this.handleKeydown(event);
        this.chatInput.addEventListener('keydown', this.boundKeydownHandler, true);
    }

    /**
     * Handle keydown on chat input
     */
    handleKeydown(event) {
        if (event.key !== 'Enter') return;

        const command = this.parseCommand(event.target.value);
        if (!command) return;

        // Prevent chat submission
        event.preventDefault();
        event.stopPropagation();

        // Execute command
        this.executeCommand(command);

        // Clear input
        this.clearChatInput(event.target);
    }

    /**
     * Parse command from input
     */
    parseCommand(inputValue) {
        const trimmed = inputValue.trim();

        if (trimmed.startsWith('/item ')) {
            return { type: 'item', itemName: trimmed.substring(6).trim() };
        }
        if (trimmed.startsWith('/wiki ')) {
            return { type: 'wiki', itemName: trimmed.substring(6).trim() };
        }
        if (trimmed.startsWith('/market ')) {
            return { type: 'market', itemName: trimmed.substring(8).trim() };
        }

        return null;
    }

    /**
     * Execute command
     */
    executeCommand(command) {
        const normalizedName = this.normalizeItemName(command.itemName);
        if (!normalizedName) return;

        const lowerName = normalizedName.replace(/_/g, ' ').toLowerCase();
        const itemHrid = this.itemData?.itemNameToHrid[lowerName];

        switch (command.type) {
            case 'item':
                if (itemHrid) this.openItemDictionary(itemHrid);
                break;
            case 'wiki':
                window.open(`https://milkywayidle.wiki.gg/wiki/${normalizedName}`, '_blank');
                break;
            case 'market':
                if (itemHrid) this.openMarketplace(itemHrid);
                break;
        }
    }

    /**
     * Normalize item name with fuzzy matching
     */
    normalizeItemName(itemName) {
        if (!this.itemData) return null;

        const lowerName = itemName.toLowerCase();

        // Exact match
        if (this.itemData.itemNameToHrid[lowerName]) {
            const hrid = this.itemData.itemNameToHrid[lowerName];
            return this.itemData.itemHridToName[hrid].replace(/ /g, '_');
        }

        // Fuzzy match
        const allNames = Object.keys(this.itemData.itemNameToHrid);
        const matches = allNames.filter((name) => name.includes(lowerName));

        if (matches.length === 1) {
            const hrid = this.itemData.itemNameToHrid[matches[0]];
            return this.itemData.itemHridToName[hrid].replace(/ /g, '_');
        }

        if (matches.length > 1) {
            this.showMultipleMatches(matches);
            return null;
        }

        // Best effort normalization
        return itemName
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('_');
    }

    /**
     * Show multiple match warning in chat
     */
    showMultipleMatches(matches) {
        const chatHistory = document.querySelector('[class*="ChatHistory_chatHistory"]');
        if (!chatHistory) return;

        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            padding: 8px;
            margin: 4px 0;
            background: rgba(255, 100, 100, 0.2);
            border-left: 3px solid #ff6464;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            color: #ffcccc;
        `;

        const matchList = matches.slice(0, 5).join(', ') + (matches.length > 5 ? '...' : '');
        messageDiv.textContent = `Multiple items match: ${matchList}. Be more specific.`;

        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    /**
     * Open Item Dictionary
     */
    openItemDictionary(itemHrid) {
        if (!this.gameCore?.handleOpenItemDictionary) return;

        try {
            this.gameCore.handleOpenItemDictionary(itemHrid);
        } catch (error) {
            console.error('[Chat Commands] Failed to open Item Dictionary:', error);
        }
    }

    /**
     * Open marketplace
     */
    openMarketplace(itemHrid) {
        if (!this.gameCore?.handleGoToMarketplace) return;

        try {
            this.gameCore.handleGoToMarketplace(itemHrid, 0);
        } catch (error) {
            console.error('[Chat Commands] Failed to open marketplace:', error);
        }
    }

    /**
     * Clear chat input (React-compatible)
     */
    clearChatInput(inputElement) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        nativeInputValueSetter.call(inputElement, '');
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// Create and export singleton instance
const chatCommands = new ChatCommands();
chatCommands.setupSettingListener();

export default chatCommands;
```

## Additional Improvements

### Phase 1: Core Enhancements

1. **Command Aliases**

    ```javascript
    '/i' → '/item'
    '/w' → '/wiki'
    '/m' → '/market'
    ```

2. **Help Command**

    ```javascript
    /help or /?
    Shows: Available commands, aliases, usage examples
    ```

3. **In-Chat Feedback**

    ```javascript
    Success: 'Opening marketplace for Radiant Fiber...';
    Error: 'Item not found. Did you mean: Radiant Fabric?';
    ```

### Phase 2: Advanced Features

1. **Command Registration System**

    ```javascript
    // Extensibility for other Toolasha features
    chatCommands.register('/export', handleExport, {
        description: 'Export combat data',
        requiresProfile: true,
    });
    ```

2. **Command History**
    - Up/down arrows to cycle through previous commands
    - Stored in Toolasha storage (persists across sessions)
    - Max 50 commands

3. **Real-Time Validation**
    - Show suggestions as you type
    - "radiant f" → Shows: "Radiant Fiber, Radiant Fabric"

4. **Performance Caching**

    ```javascript
    // LRU cache for recently searched items (50 item limit)
    const itemLookupCache = new Map();
    ```

### Phase 3: Power User Features

1. **Bookmark System**

    ```javascript
    /bookmark add radiant fiber
    /bookmark list
    /b radiant → Quick access
    ```

2. **Extended Commands**

    ```javascript
    /ability <name> - Open ability dictionary
    /action <name> - Navigate to gathering/production
    /monster <name> - Open monster info
    ```

3. **Typo Handling**

    ```javascript
    // Levenshtein distance algorithm
    "radint fiber" → "Did you mean: Radiant Fiber?"
    ```

4. **HRID Support (Advanced)**

    ```javascript
    /item /items/radiant_fiber
    // Skip name lookup, use HRID directly
    ```

5. **Recent Items**

    ```javascript
    /recent - Shows last 5 searched items
    // Persists across sessions
    ```

## Implementation Checklist

- [ ] Create `src/features/chat/chat-commands.js`
- [ ] Add settings to `settings-config.js`
- [ ] Register in `feature-registry.js`
- [ ] Test with item names (exact, fuzzy, multiple matches)
- [ ] Test with all command types (item, wiki, market)
- [ ] Test settings toggle (enable/disable)
- [ ] Test React input compatibility
- [ ] Verify no memory leaks (event listener cleanup)
- [ ] Version bump (3 files)
- [ ] Build and test in-game

## Testing Scenarios

1. **Exact match:** `/item Radiant Fiber` → Opens Item Dictionary
2. **Fuzzy match:** `/item radiant f` → Shows suggestions or opens if unique
3. **Multiple matches:** `/item fiber` → Shows list of matches
4. **Case insensitive:** `/ITEM RADIANT FIBER` → Works correctly
5. **Wiki command:** `/wiki radiant fiber` → Opens wiki in new tab
6. **Market command:** `/market radiant fiber` → Opens marketplace
7. **Invalid item:** `/item zzzzz` → Shows error in chat
8. **Settings toggle:** Disable → Commands stop working
9. **React compatibility:** Input clears properly after command
10. **No memory leaks:** Disable → Event listeners removed

## Risks & Mitigations

| Risk                        | Mitigation                              |
| --------------------------- | --------------------------------------- |
| Chat input selector changes | Use partial matching `[class*="Chat_"]` |
| React Fiber access breaks   | Try/catch with graceful degradation     |
| Game core API changes       | Null checks, try/catch on method calls  |
| Performance issues          | Cache item lookups (LRU, max 50 items)  |
| Memory leaks                | Remove event listeners in disable()     |

## Estimated Effort

- **Core Integration:** 2-3 hours
- **Phase 1 Enhancements:** 1-2 hours
- **Phase 2 Advanced:** 3-4 hours
- **Phase 3 Power User:** 4-5 hours
- **Total:** 10-14 hours for full implementation

## References

- Original script: `/Users/kennydean/Downloads/MWI/chatcommands/Chatcommands.txt`
- Data Manager: `src/core/data-manager.js`
- Settings Config: `src/features/settings/settings-config.js`
- Feature Registry: `src/core/feature-registry.js`
