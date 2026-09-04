/**
 * Notification Log
 * Adds a "Log" tab to the chat panel, logging `infoNotification.*` WebSocket messages
 * (item trades, level-ups, guild events, house construction, purchases, etc.) so they aren't
 * missed once the game's own toast disappears.
 *
 * Tab injection clones a real chat tab button/panel (inheriting the game's own MUI classes
 * instead of a hand-maintained stylesheet that would drift from them) and toggles visibility
 * via one CSS class on the chat panel root - never touching the game's own React tab-selection
 * state, which fights React's own re-render of that state on every render. Any click on a real
 * game tab hands control straight back. This is the same technique the "MWI Community Guild
 * Chat" userscript uses for its own injected tab, adapted to Toolasha's domObserver/storage APIs.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import { addStyles, removeStyles } from '../../utils/dom.js';
import { GAME } from '../../utils/selectors.js';
import {
    formatNotificationMessage,
    getNotificationCategory,
    getAllNotificationCategories,
} from '../../utils/notification-formatter.js';

const ENTRIES_KEY_PREFIX = 'notificationLog_entries';
const FILTERS_KEY_PREFIX = 'notificationLog_filters';
const TAB_ID = 'mwi-notification-log-tab';
const PANEL_ID = 'mwi-notification-log-panel';
const ACTIVE_CLASS = 'mwi-notification-log-active';
const STYLE_ID = 'mwi-notification-log-css';
const TAB_LABEL = 'Log';
const DEFAULT_MAX_ENTRIES = 100;

const CSS = `
    #${PANEL_ID} { display: none; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
    [class*="GamePage_chatPanel"].${ACTIVE_CLASS} #${PANEL_ID} { display: flex; }
    [class*="GamePage_chatPanel"].${ACTIVE_CLASS} ${GAME.TAB_PANEL}:not(#${PANEL_ID}) { display: none !important; }
    [class*="GamePage_chatPanel"].${ACTIVE_CLASS} [class*="Chat_chatInputContainer"] { display: none !important; }
    [class*="GamePage_chatPanel"].${ACTIVE_CLASS} button[role="tab"].Mui-selected:not(#${TAB_ID}) { opacity: .5; }
    #${PANEL_ID} .mwi-notiflog-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        flex-shrink: 0;
    }
    #${PANEL_ID} .mwi-notiflog-filter { display: flex; align-items: center; gap: 3px; font-size: 11px; cursor: pointer; user-select: none; }
    #${PANEL_ID} .mwi-notiflog-filter input { margin: 0; cursor: pointer; }
    #${PANEL_ID} .mwi-notiflog-clear-all {
        margin-left: auto;
        background: none;
        border: 1px solid rgba(248, 113, 113, 0.4);
        color: #f87171;
        cursor: pointer;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 3px;
        line-height: 1;
        flex-shrink: 0;
    }
    #${PANEL_ID} .mwi-notiflog-clear-all:hover { background: rgba(248, 113, 113, 0.15); }
    #${PANEL_ID} .mwi-notiflog-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
    #${PANEL_ID} .mwi-notiflog-row {
        display: flex;
        align-items: baseline;
        gap: 4px;
        padding: 3px 2px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 12px;
    }
    #${PANEL_ID} .mwi-notiflog-row-text { flex: 1; }
    #${PANEL_ID} .mwi-notiflog-time { color: #8b949e; margin-right: 6px; }
    #${PANEL_ID} .mwi-notiflog-empty { color: #8b949e; font-style: italic; padding: 8px; }
    #${PANEL_ID} .mwi-notiflog-delete {
        background: none;
        border: none;
        color: #666;
        cursor: pointer;
        font-size: 12px;
        padding: 0 4px;
        border-radius: 3px;
        line-height: 1.4;
        flex-shrink: 0;
    }
    #${PANEL_ID} .mwi-notiflog-delete:hover { color: #f87171; background: rgba(248, 113, 113, 0.15); }
`;

function getCharacterScopedKey(prefix) {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${prefix}_${charId}`;
}

function formatTimestamp(ts) {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

class NotificationLog {
    constructor() {
        this.isInitialized = false;
        this.entries = [];
        this.activeFilters = new Set(getAllNotificationCategories());
        this.wsHandler = null;
        this.unregisterObserver = null;
        this.tabButton = null;
        this.panel = null;
        this.listEl = null;
        this.tabActive = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('notificationLog')) return;
        this.isInitialized = true;

        const entriesKey = getCharacterScopedKey(ENTRIES_KEY_PREFIX);
        this.entries = await storage.getJSON(entriesKey, 'settings', []);

        const filtersKey = getCharacterScopedKey(FILTERS_KEY_PREFIX);
        const savedFilters = await storage.getJSON(filtersKey, 'settings', null);
        this.activeFilters = new Set(Array.isArray(savedFilters) ? savedFilters : getAllNotificationCategories());

        addStyles(CSS, STYLE_ID);

        this.wsHandler = (data) => this._onInfoMessage(data);
        webSocketHook.on('info', this.wsHandler);

        this.unregisterObserver = domObserver.onClass('NotificationLog', 'Chat_tabsComponentContainer', (container) => {
            this._ensureTabInjected(container);
        });

        const existing = document.querySelector('[class*="Chat_tabsComponentContainer"]');
        if (existing) this._ensureTabInjected(existing);
    }

    disable() {
        if (this.wsHandler) {
            webSocketHook.off('info', this.wsHandler);
            this.wsHandler = null;
        }
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        this._removeTab();
        removeStyles(STYLE_ID);
        this.isInitialized = false;
    }

    _getMaxEntries() {
        const raw = parseInt(config.getSettingValue('notificationLog_maxEntries'), 10);
        return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_ENTRIES;
    }

    /**
     * Handle a captured `type: "info"` WebSocket message.
     * @param {Object} data
     */
    _onInfoMessage(data) {
        const message = data?.message;
        if (!message) return;

        this.entries.unshift({
            timestamp: Date.now(),
            message,
            variables: Array.isArray(data.variables) ? data.variables : [],
        });

        const maxEntries = this._getMaxEntries();
        if (this.entries.length > maxEntries) {
            this.entries.length = maxEntries;
        }

        this._renderList();

        // storage.setJSON's returned promise only resolves once the debounced write actually
        // flushes (3s by default) - awaiting it here would delay the render above by that long,
        // even though rendering only ever depends on the in-memory `this.entries` array.
        this._persistEntries();
    }

    /* ------------------------------------------------------------ tab injection */

    _ensureTabInjected(container) {
        const root = container.closest('[class*="GamePage_chatPanel"]');
        if (!root) return;

        if (!document.getElementById(TAB_ID)) {
            const flexContainer = container.querySelector(GAME.TABS_FLEX_CONTAINER) || container;
            const existingTabs = Array.from(flexContainer.querySelectorAll('button[role="tab"]'));
            if (existingTabs.length === 0) return;

            this.tabButton = this._createTabButton(existingTabs[0]);
            flexContainer.appendChild(this.tabButton);
            this._bindGameTabs(flexContainer);
        }

        if (!document.getElementById(PANEL_ID)) {
            const panelsContainer =
                root.querySelector(GAME.TAB_PANELS_CONTAINER) || root.querySelector(GAME.TAB_PANEL)?.parentElement;
            if (!panelsContainer) return;

            const template = panelsContainer.querySelector(GAME.TAB_PANEL);
            this.panel = this._createPanel(template);
            panelsContainer.appendChild(this.panel);
            this._renderList();
        }
    }

    _createTabButton(template) {
        // Cloning a real tab inherits the game's exact MUI classes/sizing, which no
        // hand-written class list keeps up with across game updates.
        const button = template.cloneNode(true);
        button.querySelectorAll('span, div').forEach((node) => {
            if (node.querySelector('span, div')) return;
            node.textContent = '';
        });
        const badge = button.querySelector('[class*="MuiBadge-badge"]');
        if (badge) badge.remove();
        const target = button.querySelector('[class*="MuiTab-wrapper"], span, div') || button;
        target.textContent = TAB_LABEL;

        button.id = TAB_ID;
        button.style.minWidth = '0';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', 'false');
        button.setAttribute('tabindex', '-1');
        button.classList.remove('Mui-selected');
        button.title = 'Log of item trades, level-ups, guild events, and other notifications';
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this._activateTab();
        });
        return button;
    }

    _createPanel(template) {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        if (template?.className) panel.className = template.className;
        panel.setAttribute('role', 'tabpanel');

        const filtersEl = this._createFilters();
        this.listEl = document.createElement('div');
        this.listEl.className = 'mwi-notiflog-list';

        panel.appendChild(filtersEl);
        panel.appendChild(this.listEl);
        return panel;
    }

    _createFilters() {
        const filtersEl = document.createElement('div');
        filtersEl.className = 'mwi-notiflog-filters';

        for (const category of getAllNotificationCategories()) {
            const label = document.createElement('label');
            label.className = 'mwi-notiflog-filter';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.activeFilters.has(category);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.activeFilters.add(category);
                } else {
                    this.activeFilters.delete(category);
                }
                storage.setJSON(getCharacterScopedKey(FILTERS_KEY_PREFIX), [...this.activeFilters], 'settings');
                this._renderList();
            });

            const text = document.createElement('span');
            text.textContent = category.charAt(0).toUpperCase() + category.slice(1);

            label.appendChild(checkbox);
            label.appendChild(text);
            filtersEl.appendChild(label);
        }

        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'mwi-notiflog-clear-all';
        clearAllBtn.textContent = 'Clear All';
        clearAllBtn.title = 'Delete all logged notifications';
        clearAllBtn.addEventListener('click', () => this._clearAll());
        filtersEl.appendChild(clearAllBtn);

        return filtersEl;
    }

    /**
     * Remove a single entry after the user clicks its X button.
     * @param {Object} entry
     */
    _removeEntry(entry) {
        const index = this.entries.indexOf(entry);
        if (index === -1) return;
        this.entries.splice(index, 1);
        this._persistEntries();
        this._renderList();
    }

    /**
     * Delete every logged notification, after a confirmation prompt.
     */
    _clearAll() {
        if (this.entries.length === 0) return;
        const confirmed = confirm(`Delete all ${this.entries.length} logged notifications? This cannot be undone.`);
        if (!confirmed) return;

        this.entries = [];
        this._persistEntries();
        this._renderList();
    }

    _persistEntries() {
        storage.setJSON(getCharacterScopedKey(ENTRIES_KEY_PREFIX), this.entries, 'settings').catch((error) => {
            console.error('[NotificationLog] Failed to persist entries:', error);
        });
    }

    _bindGameTabs(flexContainer) {
        flexContainer.querySelectorAll('button[role="tab"]').forEach((button) => {
            if (button.id === TAB_ID || button.dataset.mwiNotifLogBound) return;
            button.dataset.mwiNotifLogBound = '1';
            button.addEventListener('click', () => this._deactivateTab());
        });
    }

    _activateTab() {
        this.tabActive = true;
        const root = document.querySelector('[class*="GamePage_chatPanel"]');
        if (root) root.classList.add(ACTIVE_CLASS);
        if (this.tabButton) {
            this.tabButton.classList.add('Mui-selected');
            this.tabButton.setAttribute('aria-selected', 'true');
            this.tabButton.setAttribute('tabindex', '0');
        }
    }

    _deactivateTab() {
        if (!this.tabActive) return;
        this.tabActive = false;
        const root = document.querySelector('[class*="GamePage_chatPanel"]');
        if (root) root.classList.remove(ACTIVE_CLASS);
        if (this.tabButton) {
            this.tabButton.classList.remove('Mui-selected');
            this.tabButton.setAttribute('aria-selected', 'false');
            this.tabButton.setAttribute('tabindex', '-1');
        }
    }

    _removeTab() {
        this._deactivateTab();
        document.getElementById(TAB_ID)?.remove();
        document.getElementById(PANEL_ID)?.remove();
        this.tabButton = null;
        this.panel = null;
        this.listEl = null;
    }

    /* ------------------------------------------------------------------ rendering */

    _renderList() {
        if (!this.listEl) return;

        // Chat-log convention: oldest at top, newest at bottom. Keep the view pinned to the
        // bottom across re-renders if the user was already there, so new entries stay visible
        // without yanking them away from history they scrolled up to read.
        const wasScrolledToBottom = this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight < 4;
        this.listEl.textContent = '';

        // this.entries is stored newest-first (see _onInfoMessage); reverse only for display.
        const visible = this.entries
            .filter((entry) => this.activeFilters.has(getNotificationCategory(entry.message)))
            .slice()
            .reverse();

        if (visible.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'mwi-notiflog-empty';
            empty.textContent = 'No notifications match the current filters.';
            this.listEl.appendChild(empty);
            return;
        }

        for (const entry of visible) {
            const row = document.createElement('div');
            row.className = 'mwi-notiflog-row';

            const time = document.createElement('span');
            time.className = 'mwi-notiflog-time';
            time.textContent = formatTimestamp(entry.timestamp);

            const text = document.createElement('span');
            text.className = 'mwi-notiflog-row-text';
            text.textContent = formatNotificationMessage(entry.message, entry.variables);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'mwi-notiflog-delete';
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Delete this notification';
            deleteBtn.addEventListener('click', () => this._removeEntry(entry));

            row.appendChild(time);
            row.appendChild(text);
            row.appendChild(deleteBtn);
            this.listEl.appendChild(row);
        }

        if (wasScrolledToBottom) {
            this.listEl.scrollTop = this.listEl.scrollHeight;
        }
    }
}

const notificationLog = new NotificationLog();
export default notificationLog;
export { NotificationLog };
