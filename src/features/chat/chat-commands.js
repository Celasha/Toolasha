/**
 * Chat Commands Module
 * Adds /item, /wiki, and /market commands to in-game chat
 * Port of MWI Game Commands by Mists, integrated into Toolasha architecture
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class ChatCommands {
    constructor() {
        this.gameCore = null;
        this.itemData = null;
        this.chatInput = null;
        this.boundKeydownHandler = null;
        this.initialized = false;
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize chat commands feature
     */
    async initialize() {
        if (this.initialized) return;

        const enabled = config.getSetting('chatCommands');
        if (!enabled) return;

        this.loadItemData();
        this.setupGameCore();
        await this.waitForChatInput();

        if (this.chatInput) {
            this.attachChatListener();
            this.initialized = true;
        }

        // Listen for character switch to cleanup
        dataManager.on('character_switching', () => {
            this.cleanup();
        });
    }

    /**
     * Disable the feature and cleanup
     */
    disable() {
        if (this.chatInput && this.boundKeydownHandler) {
            this.chatInput.removeEventListener('keydown', this.boundKeydownHandler, true);
            this.chatInput = null;
            this.boundKeydownHandler = null;
        }
        this.initialized = false;
    }

    /**
     * Cleanup when disabling or character switching
     */
    cleanup() {
        this.disable();
        this.timerRegistry.clearAll();
    }

    /**
     * Load item data from dataManager
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
     * Setup game core access via React Fiber traversal
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
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 200);
                this.timerRegistry.registerTimeout(timeout);
            });
        }
        console.warn('[Chat Commands] Chat input not found after 10 seconds');
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
     * @param {KeyboardEvent} event - Keyboard event
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
     * Parse command from chat input
     * @param {string} inputValue - Chat input value
     * @returns {Object|null} Command object or null if not a command
     */
    parseCommand(inputValue) {
        const trimmed = inputValue.trim();
        const lower = trimmed.toLowerCase();

        if (lower.startsWith('/item ')) {
            const itemName = trimmed.substring(6).trim();
            if (!itemName) return null;
            return { type: 'item', itemName };
        }

        if (lower.startsWith('/wiki ')) {
            const itemName = trimmed.substring(6).trim();
            if (!itemName) return null;
            return { type: 'wiki', itemName };
        }

        if (lower.startsWith('/market ')) {
            const itemName = trimmed.substring(8).trim();
            if (!itemName) return null;
            return { type: 'market', itemName };
        }

        return null;
    }

    /**
     * Execute parsed command
     * @param {Object} command - Command object {type, itemName}
     */
    executeCommand(command) {
        const normalizedName = this.normalizeItemName(command.itemName);

        // normalizedName is null when there are multiple matches (already shown to user)
        if (!normalizedName) return;

        const lowerName = normalizedName.replace(/_/g, ' ').toLowerCase();
        const itemHrid = this.itemData?.itemNameToHrid[lowerName];

        switch (command.type) {
            case 'item':
                if (itemHrid) {
                    this.openItemDictionary(itemHrid);
                } else {
                    // Item not found in game data (best effort normalization was used)
                    this.showError(`Item "${command.itemName}" not found in game data`);
                }
                break;

            case 'wiki':
                // Wiki always works (uses best effort normalization if no match)
                window.open(`https://milkywayidle.wiki.gg/wiki/${normalizedName}`, '_blank');
                break;

            case 'market':
                if (itemHrid) {
                    this.openMarketplace(itemHrid);
                } else {
                    // Item not found in game data (best effort normalization was used)
                    this.showError(`Item "${command.itemName}" not found in game data`);
                }
                break;
        }
    }

    /**
     * Normalize item name with fuzzy matching
     * @param {string} itemName - Raw item name from user
     * @returns {string|null} Normalized name for URL/HRID lookup, or null if multiple matches
     */
    normalizeItemName(itemName) {
        if (!this.itemData) {
            return null;
        }

        const lowerName = itemName.toLowerCase();

        // Try exact match first
        if (this.itemData.itemNameToHrid[lowerName]) {
            const hrid = this.itemData.itemNameToHrid[lowerName];
            return this.itemData.itemHridToName[hrid].replace(/ /g, '_');
        }

        // Try fuzzy match
        const allNames = Object.keys(this.itemData.itemNameToHrid);
        const matches = allNames.filter((name) => name.includes(lowerName));

        if (matches.length === 1) {
            // Single match found
            const hrid = this.itemData.itemNameToHrid[matches[0]];
            return this.itemData.itemHridToName[hrid].replace(/ /g, '_');
        }

        if (matches.length > 1) {
            // Multiple matches - show user
            this.showMultipleMatches(matches);
            return null;
        }

        // No matches - do best effort normalization for wiki
        return itemName
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('_');
    }

    /**
     * Show multiple match warning in chat
     * @param {Array<string>} matches - Array of matching item names (lowercase keys)
     */
    showMultipleMatches(matches) {
        // Find all chat history elements
        const allChatHistories = document.querySelectorAll('[class*="ChatHistory_chatHistory"]');

        // Find the visible one by checking if the grandparent TabPanel is not hidden
        let chatHistory = null;
        for (const history of allChatHistories) {
            const grandparent = history.parentElement?.parentElement;
            if (grandparent && !grandparent.classList.contains('TabPanel_hidden__26UM3')) {
                chatHistory = history;
                break;
            }
        }

        if (!chatHistory) {
            console.warn('[Chat Commands] No visible chat history found');
            return;
        }

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

        // Convert lowercase keys to proper item names
        const properNames = matches.map((lowerName) => {
            const hrid = this.itemData.itemNameToHrid[lowerName];
            return this.itemData.itemHridToName[hrid];
        });

        const matchList = properNames.slice(0, 5).join(', ') + (properNames.length > 5 ? '...' : '');
        messageDiv.textContent = `Multiple items match: ${matchList}. Please be more specific.`;

        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    /**
     * Show error message in chat
     * @param {string} message - Error message to display
     */
    showError(message) {
        // Find all chat history elements
        const allChatHistories = document.querySelectorAll('[class*="ChatHistory_chatHistory"]');

        // Find the visible one by checking if the grandparent TabPanel is not hidden
        let chatHistory = null;
        for (const history of allChatHistories) {
            const grandparent = history.parentElement?.parentElement;
            if (grandparent && !grandparent.classList.contains('TabPanel_hidden__26UM3')) {
                chatHistory = history;
                break;
            }
        }

        if (!chatHistory) {
            console.warn('[Chat Commands] No visible chat history found');
            return;
        }

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

        messageDiv.textContent = message;

        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    /**
     * Open Item Dictionary for specific item
     * @param {string} itemHrid - Item HRID (e.g., "/items/radiant_fiber")
     */
    openItemDictionary(itemHrid) {
        if (!this.gameCore?.handleOpenItemDictionary) {
            this.showError('Unable to open Item Dictionary (game core not accessible)');
            return;
        }

        try {
            this.gameCore.handleOpenItemDictionary(itemHrid);
        } catch (error) {
            console.error('[Chat Commands] Failed to open Item Dictionary:', error);
            this.showError('Failed to open Item Dictionary');
        }
    }

    /**
     * Open marketplace for specific item
     * @param {string} itemHrid - Item HRID (e.g., "/items/radiant_fiber")
     */
    openMarketplace(itemHrid) {
        if (!this.gameCore?.handleGoToMarketplace) {
            this.showError('Unable to open marketplace (game core not accessible)');
            return;
        }

        try {
            this.gameCore.handleGoToMarketplace(itemHrid, 0);
        } catch (error) {
            console.error('[Chat Commands] Failed to open marketplace:', error);
            this.showError('Failed to open marketplace');
        }
    }

    /**
     * Clear chat input using React-compatible method
     * @param {HTMLInputElement} inputElement - Chat input element
     */
    clearChatInput(inputElement) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        nativeInputValueSetter.call(inputElement, '');
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// Export as feature module
export default {
    name: 'Chat Commands',
    initialize: async () => {
        const chatCommands = new ChatCommands();
        await chatCommands.initialize();
        return chatCommands;
    },
    cleanup: (instance) => {
        if (instance) {
            instance.cleanup();
        }
    },
};
