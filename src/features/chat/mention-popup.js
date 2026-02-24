/**
 * Mention Popup
 * Draggable popup showing all @mention messages for a chat channel
 */

import config from '../../core/config.js';

class MentionPopup {
    constructor() {
        this.container = null;
        this.currentChannel = null;
        this.onCloseFn = null;

        // Dragging state
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.dragMoveHandler = null;
        this.dragUpHandler = null;
    }

    /**
     * Format a UTC ISO timestamp string using the user's market date/time settings
     * @param {string} isoString - ISO 8601 timestamp (e.g. "2026-02-24T16:59:59.046Z")
     * @returns {string} Formatted date/time string
     */
    formatTimestamp(isoString) {
        if (!isoString) return '';

        const timeFormat = config.getSettingValue('market_listingTimeFormat', '24hour');
        const dateFormat = config.getSettingValue('market_listingDateFormat', 'MM-DD');
        const use12Hour = timeFormat === '12hour';

        const date = new Date(isoString);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const datePart = dateFormat === 'DD-MM' ? `${day}-${month}` : `${month}-${day}`;

        const timePart = date
            .toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: use12Hour,
            })
            .trim();

        return `${datePart} ${timePart}`;
    }

    /**
     * Open (or replace) the popup for a given channel
     * @param {string} channel - Channel HRID
     * @param {Array<{sName: string, m: string, t: string}>} mentions - Mention list
     * @param {string} channelDisplayName - Human-readable channel name
     * @param {Function} onClose - Callback when popup is closed (to clear mentions)
     */
    open(channel, mentions, channelDisplayName, onClose) {
        this.currentChannel = channel;
        this.onCloseFn = onClose;

        if (this.container) {
            // Already open — replace content for new channel
            this._updateContent(mentions, channelDisplayName);
            return;
        }

        this._build(mentions, channelDisplayName);
    }

    /**
     * Close the popup and invoke the onClose callback
     */
    close() {
        if (this.onCloseFn) {
            this.onCloseFn();
            this.onCloseFn = null;
        }

        this._teardown();
    }

    /**
     * Build and insert the popup DOM
     * @param {Array} mentions
     * @param {string} channelDisplayName
     */
    _build(mentions, channelDisplayName) {
        this.container = document.createElement('div');
        this.container.id = 'mwi-mention-popup';
        this.container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999;
            min-width: 420px;
            max-width: 600px;
            background: rgba(0, 0, 0, 0.92);
            border: 2px solid ${config.COLOR_ACCENT};
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            user-select: none;
        `;

        // Header
        const header = document.createElement('div');
        header.id = 'mwi-mention-popup-header';
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            cursor: grab;
            border-radius: 6px 6px 0 0;
            background: rgba(255,255,255,0.05);
        `;

        const title = document.createElement('span');
        title.id = 'mwi-mention-popup-title';
        title.style.cssText = `
            font-size: 0.9rem;
            font-weight: 600;
            color: ${config.COLOR_ACCENT};
        `;
        title.textContent = `Mentions — ${channelDisplayName}`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #aaa;
            font-size: 1.2rem;
            line-height: 1;
            cursor: pointer;
            padding: 0 2px;
        `;
        closeBtn.addEventListener('mouseenter', () => (closeBtn.style.color = '#fff'));
        closeBtn.addEventListener('mouseleave', () => (closeBtn.style.color = '#aaa'));
        closeBtn.addEventListener('click', () => this.close());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.id = 'mwi-mention-popup-body';
        body.style.cssText = `
            max-height: 400px;
            overflow-y: auto;
            padding: 8px 0;
        `;

        this._renderMentions(body, mentions);

        this.container.appendChild(header);
        this.container.appendChild(body);
        document.body.appendChild(this.container);

        this._setupDragging(header);
    }

    /**
     * Update title and body content without rebuilding the whole popup
     * @param {Array} mentions
     * @param {string} channelDisplayName
     */
    _updateContent(mentions, channelDisplayName) {
        const title = this.container.querySelector('#mwi-mention-popup-title');
        if (title) title.textContent = `Mentions — ${channelDisplayName}`;

        const body = this.container.querySelector('#mwi-mention-popup-body');
        if (body) {
            body.innerHTML = '';
            this._renderMentions(body, mentions);
        }
    }

    /**
     * Render mention rows into the body element
     * @param {HTMLElement} body
     * @param {Array<{sName: string, m: string, t: string}>} mentions
     */
    _renderMentions(body, mentions) {
        if (!mentions || mentions.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = `
                padding: 16px 14px;
                color: #888;
                font-size: 0.85rem;
                text-align: center;
            `;
            empty.textContent = 'No mentions';
            body.appendChild(empty);
            return;
        }

        for (const mention of mentions) {
            const row = document.createElement('div');
            row.style.cssText = `
                padding: 7px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                font-size: 0.85rem;
                line-height: 1.4;
                user-select: text;
            `;
            row.style.cursor = 'default';

            const timestamp = document.createElement('span');
            timestamp.style.cssText = `
                color: #888;
                font-size: 0.78rem;
                margin-right: 8px;
                white-space: nowrap;
            `;
            timestamp.textContent = this.formatTimestamp(mention.t);

            const sender = document.createElement('span');
            sender.style.cssText = `
                color: ${config.COLOR_ACCENT};
                font-weight: 600;
                margin-right: 6px;
            `;
            sender.textContent = mention.sName;

            const msg = document.createElement('span');
            msg.style.cssText = `color: #e7e7e7;`;
            msg.textContent = mention.m;

            row.appendChild(timestamp);
            row.appendChild(sender);
            row.appendChild(msg);
            body.appendChild(row);
        }
    }

    /**
     * Set up drag behaviour on the header element
     * @param {HTMLElement} header
     */
    _setupDragging(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            this.isDragging = true;

            // Switch from transform-based centering to explicit coordinates
            const rect = this.container.getBoundingClientRect();
            this.container.style.transform = 'none';
            this.container.style.top = `${rect.top}px`;
            this.container.style.left = `${rect.left}px`;

            this.dragOffset = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        this.dragMoveHandler = (e) => {
            if (!this.isDragging) return;

            let x = e.clientX - this.dragOffset.x;
            let y = e.clientY - this.dragOffset.y;

            const minVisible = 80;
            y = Math.max(0, Math.min(y, window.innerHeight - minVisible));
            x = Math.max(-this.container.offsetWidth + minVisible, Math.min(x, window.innerWidth - minVisible));

            this.container.style.top = `${y}px`;
            this.container.style.left = `${x}px`;
        };

        this.dragUpHandler = () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            header.style.cursor = 'grab';
        };

        document.addEventListener('mousemove', this.dragMoveHandler);
        document.addEventListener('mouseup', this.dragUpHandler);
    }

    /**
     * Remove popup from DOM and clean up event listeners
     */
    _teardown() {
        if (this.dragMoveHandler) {
            document.removeEventListener('mousemove', this.dragMoveHandler);
            this.dragMoveHandler = null;
        }
        if (this.dragUpHandler) {
            document.removeEventListener('mouseup', this.dragUpHandler);
            this.dragUpHandler = null;
        }

        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.currentChannel = null;
        this.isDragging = false;
    }
}

const mentionPopup = new MentionPopup();

export default mentionPopup;
