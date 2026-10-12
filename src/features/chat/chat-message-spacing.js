/**
 * Chat Message Spacing
 * Adds breathing room between the sender name and message text in native chat channels, a
 * follow-up polish request on #774. Pure CSS against the native username element - no DOM
 * mutation or observer needed, so there is no React re-render to fight.
 */

import config from '../../core/config.js';
import { addStyles, removeStyles } from '../../utils/dom.js';

const STYLE_ID = 'mwi-chat-message-spacing-css';
const CSS = `
    [class*="ChatMessage_username"] { margin-right: 6px; }
`;

class ChatMessageSpacing {
    constructor() {
        this.isInitialized = false;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('chat_messageSpacing')) return;

        this.isInitialized = true;
        addStyles(CSS, STYLE_ID);
    }

    disable() {
        removeStyles(STYLE_ID);
        this.isInitialized = false;
    }
}

const chatMessageSpacing = new ChatMessageSpacing();
export default chatMessageSpacing;
export { ChatMessageSpacing };
