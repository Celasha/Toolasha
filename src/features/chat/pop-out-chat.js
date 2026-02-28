/**
 * Pop-Out Chat Window
 * Opens game chat in a separate browser window with multi-channel split-pane support.
 * Game tab relays WebSocket messages via BroadcastChannel; pop-out is a pure UI shell.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import domObserver from '../../core/dom-observer.js';
import { formatKMB } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const RELAY_CHANNEL = 'mwi-chat-relay';
const SEND_CHANNEL = 'mwi-chat-send';
const MAX_BUFFER = 500;
const PING_INTERVAL_MS = 10_000;

const CHANNELS = [
    { hrid: '/chat_channel_types/general', name: 'General' },
    { hrid: '/chat_channel_types/trade', name: 'Trade' },
    { hrid: '/chat_channel_types/global', name: 'Global' },
    { hrid: '/chat_channel_types/local', name: 'Local' },
    { hrid: '/chat_channel_types/party', name: 'Party' },
    { hrid: '/chat_channel_types/guild', name: 'Guild' },
    { hrid: '/chat_channel_types/whisper', name: 'Whisper' },
    { hrid: '/chat_channel_types/beginner', name: 'Beginner' },
    { hrid: '/chat_channel_types/recruit', name: 'Recruit' },
    { hrid: '/chat_channel_types/ironcow', name: 'Ironcow' },
];

const CHANNEL_NAME_MAP = Object.fromEntries(CHANNELS.map((c) => [c.hrid, c.name]));

const SKILL_HRID_TO_NAME = {
    '/skills/total_level': 'Total Level',
    '/skills/milking': 'Milking',
    '/skills/foraging': 'Foraging',
    '/skills/woodcutting': 'Woodcutting',
    '/skills/cheesesmithing': 'Cheesesmithing',
    '/skills/crafting': 'Crafting',
    '/skills/tailoring': 'Tailoring',
    '/skills/cooking': 'Cooking',
    '/skills/brewing': 'Brewing',
    '/skills/alchemy': 'Alchemy',
    '/skills/enhancing': 'Enhancing',
    '/skills/stamina': 'Stamina',
    '/skills/intelligence': 'Intelligence',
    '/skills/attack': 'Attack',
    '/skills/melee': 'Melee',
    '/skills/defense': 'Defense',
    '/skills/ranged': 'Ranged',
    '/skills/magic': 'Magic',
};

/**
 * Resolve a system message with systemMetadata into a human-readable string.
 * @param {string} messageKey - e.g. "systemChatMessage.characterLeveledUp"
 * @param {Object} meta - Parsed systemMetadata
 * @returns {string|null} Rendered string, or null if unrecognized
 */
function resolveSystemMessage(messageKey, meta) {
    if (messageKey === 'systemChatMessage.characterLeveledUp') {
        const skillName = SKILL_HRID_TO_NAME[meta.skillHrid] || meta.skillHrid.split('/').pop().replace(/_/g, ' ');
        return `🎉 ${meta.name} reached ${skillName} ${meta.level}!`;
    }
    return null;
}

/**
 * Resolve a single linksMetadata link entry to a display string.
 * @param {Object} link
 * @returns {string}
 */
function resolveLink(link) {
    if (link.linkType === '/chat_link_types/market_listing') {
        const itemDetails = dataManager.getItemDetails(link.itemHrid);
        const itemName = itemDetails?.name || link.itemHrid.split('/').pop().replace(/_/g, ' ');
        const enhancement = link.itemEnhancementLevel > 0 ? ` +${link.itemEnhancementLevel}` : '';
        const count = link.itemCount > 1 ? ` ×${link.itemCount}` : '';
        const price = formatKMB(link.price);
        const side = link.isSell ? 'Sell' : 'Buy';
        return `[${itemName}${enhancement}${count} @ ${price} ${side}]`;
    }
    if (link.linkType === '/chat_link_types/item') {
        const itemDetails = dataManager.getItemDetails(link.itemHrid);
        const itemName = itemDetails?.name || link.itemHrid.split('/').pop().replace(/_/g, ' ');
        const enhancement = link.itemEnhancementLevel > 0 ? ` +${link.itemEnhancementLevel}` : '';
        const count = link.itemCount > 1 ? ` ×${link.itemCount}` : '';
        return `[${itemName}${enhancement}${count}]`;
    }
    if (link.linkType === '/chat_link_types/ability') {
        const abilityDetails = dataManager.getInitClientData()?.abilityDetailMap?.[link.abilityHrid];
        const abilityName = abilityDetails?.name || link.abilityHrid.split('/').pop().replace(/_/g, ' ');
        return `[${abilityName} Lv.${link.abilityLevel}]`;
    }
    if (link.linkType === '/chat_link_types/skill') {
        const skillName = SKILL_HRID_TO_NAME[link.skillHrid] || link.skillHrid.split('/').pop().replace(/_/g, ' ');
        return `[${skillName} Lv.${link.skillLevel}]`;
    }
    if (link.linkType === '/chat_link_types/party') {
        const actionDetails = dataManager.getActionDetails(link.partyActionHrid);
        const zoneName = actionDetails?.name || link.partyActionHrid.split('/').pop().replace(/_/g, ' ');
        const tier = ` T${link.partyDifficultyTier ?? 0}`;
        return `[Party: ${zoneName}${tier}]`;
    }
    if (link.linkType === '/chat_link_types/collection') {
        const itemDetails = dataManager.getItemDetails(link.itemHrid);
        const itemName = itemDetails?.name || link.itemHrid.split('/').pop().replace(/_/g, ' ');
        return `[Collection: ${itemName} ×${formatKMB(link.itemCount)}]`;
    }
    if (link.linkType === '/chat_link_types/bestiary') {
        const monsterDetails = dataManager.getInitClientData()?.combatMonsterDetailMap?.[link.monsterHrid];
        const monsterName = monsterDetails?.name || link.monsterHrid.split('/').pop().replace(/_/g, ' ');
        return `[Bestiary: ${monsterName} ×${link.monsterCount}]`;
    }
    // Fallback: humanize the HRID
    return `[${link.linkType.split('/').pop().replace(/_/g, ' ')}]`;
}

/**
 * Resolve a raw WebSocket message into a serializable relay object.
 * @param {Object} message - Raw message from chat_message_received
 * @returns {Object}
 */
function resolveMessage(message) {
    let renderedLinks = [];
    if (message.linksMetadata) {
        try {
            const links = JSON.parse(message.linksMetadata);
            renderedLinks = links.map(resolveLink);
        } catch {
            // ignore malformed linksMetadata
        }
    }

    let resolvedText = message.m || '';
    if (message.isSystemMessage && message.systemMetadata) {
        try {
            const meta = JSON.parse(message.systemMetadata);
            const rendered = resolveSystemMessage(message.m || '', meta);
            if (rendered !== null) {
                resolvedText = rendered;
            }
        } catch {
            // ignore malformed systemMetadata
        }
    }

    return {
        type: 'chat_message',
        channel: message.chan || '',
        sName: message.sName || '',
        m: resolvedText,
        t: message.t || '',
        isSystem: !!message.isSystemMessage,
        renderedLinks,
    };
}

class PopOutChat {
    constructor() {
        this.relayChannel = null;
        this.sendChannel = null;
        this.popoutWindow = null;
        this.messageBuffer = new Map(); // hrid → Array<resolved message>
        this.discoveredChannels = new Map(); // hrid → {hrid, name} for channels seen via messages but not in DOM
        this.wsHandler = null;
        this.initialized = false;
        this.timerRegistry = createTimerRegistry();
        this.unregisterObserver = null;
        this.popoutBtn = null;
    }

    /**
     * Initialize the pop-out chat feature.
     */
    async initialize() {
        if (this.initialized) return;
        if (!config.getSetting('chat_popOut')) return;

        this.initialized = true;

        // Set up BroadcastChannels
        this.relayChannel = new BroadcastChannel(RELAY_CHANNEL);
        this.sendChannel = new BroadcastChannel(SEND_CHANNEL);

        // Listen for messages from pop-out
        this.sendChannel.onmessage = ({ data }) => this._onSendChannelMessage(data);

        // Listen for incoming chat messages from WebSocket
        this.wsHandler = (data) => this._onChatMessage(data);
        webSocketHook.on('chat_message_received', this.wsHandler);

        // Start keepalive ping
        const pingTimer = setInterval(() => {
            this.relayChannel?.postMessage({ type: 'ping' });
        }, PING_INTERVAL_MS);
        this.timerRegistry.registerInterval(pingTimer);

        // Inject pop-out button next to the ▼ collapse button in the chat tabs row
        this.unregisterObserver = domObserver.onClass('PopOutChat', 'Chat_tabsComponentContainer', (container) => {
            const parent = container.parentElement;
            if (parent) this._injectButton(parent);
        });

        // Handle existing container
        const existing = document.querySelector('[class*="Chat_tabsComponentContainer"]');
        if (existing?.parentElement) this._injectButton(existing.parentElement);
    }

    /**
     * Inject the pop-out button next to the overflow arrow in the chat tabs row.
     * @param {HTMLElement} container - parent of Chat_tabsComponentContainer
     */
    _injectButton(container) {
        if (container.querySelector('[data-mwi-popout-chat]')) return;

        const btn = document.createElement('button');
        btn.setAttribute('data-mwi-popout-chat', 'true');
        btn.textContent = '⧉';
        btn.title = 'Pop out chat';
        btn.style.cssText = `
            padding: 2px 6px;
            font-size: 13px;
            background: none;
            color: #8b949e;
            border: none;
            cursor: pointer;
            user-select: none;
            flex-shrink: 0;
            line-height: 1;
            opacity: 0.75;
        `;
        btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
        btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.75'));
        btn.addEventListener('click', () => this._openPopout());

        // Insert into the same parent as the expandCollapseButton, after it
        const collapseBtn = container.querySelector('[class*="TabsComponent_expandCollapseButton"]');
        if (collapseBtn?.parentElement) {
            collapseBtn.parentElement.insertBefore(btn, collapseBtn.nextSibling);
        } else {
            // Fallback: append to the tabsComponentContainer
            const tabsContainer = container.querySelector('[class*="Chat_tabsComponentContainer"]') || container;
            tabsContainer.appendChild(btn);
        }

        this.popoutBtn = btn;
    }

    /**
     * Handle an incoming chat_message_received WebSocket event.
     * @param {Object} data
     */
    _onChatMessage(data) {
        const message = data?.message;
        if (!message || !message.chan) return;

        const resolved = resolveMessage(message);

        // Track channels seen via messages that aren't in the hardcoded list
        if (!CHANNELS.some((c) => c.hrid === resolved.channel) && !this.discoveredChannels.has(resolved.channel)) {
            const name = resolved.channel
                .split('/')
                .pop()
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
            this.discoveredChannels.set(resolved.channel, { hrid: resolved.channel, name });
            // Notify pop-out of the updated channel list
            if (this.relayChannel) {
                this.relayChannel.postMessage({ type: 'channels_updated', channels: this._getLiveChannels() });
            }
        }

        // Buffer the message
        if (!this.messageBuffer.has(resolved.channel)) {
            this.messageBuffer.set(resolved.channel, []);
        }
        const buf = this.messageBuffer.get(resolved.channel);
        buf.push(resolved);
        if (buf.length > MAX_BUFFER) buf.shift();

        // Relay to pop-out if open
        if (this.relayChannel) {
            this.relayChannel.postMessage(resolved);
        }
    }

    /**
     * Handle messages received from the pop-out window.
     * @param {Object} data
     */
    _onSendChannelMessage(data) {
        if (!data?.type) return;

        if (data.type === 'ready') {
            this._sendInit();
        } else if (data.type === 'send') {
            this._executeSend(data.channel, data.text);
        }
    }

    /**
     * Read the currently visible channel tabs from the game DOM.
     * Falls back to the hardcoded CHANNELS list if the DOM isn't ready.
     * @returns {Array<{hrid: string, name: string}>}
     */
    _getLiveChannels() {
        const tabButtons = Array.from(
            document.querySelectorAll('[class*="Chat_tabsComponentContainer"] button[role="tab"]')
        );

        let domChannels;
        if (tabButtons.length === 0) {
            domChannels = CHANNELS;
        } else {
            domChannels = tabButtons
                .map((btn) => {
                    const hrid = btn.getAttribute('data-mention-channel');
                    const name = btn.textContent?.trim().replace(/\d+$/, '').trim();
                    return hrid && name ? { hrid, name } : null;
                })
                .filter(Boolean);
        }

        // Merge in any channels discovered via incoming messages (e.g. language channels without data-mention-channel)
        const knownHrids = new Set(domChannels.map((c) => c.hrid));
        const extra = Array.from(this.discoveredChannels.values()).filter((c) => !knownHrids.has(c.hrid));

        return [...domChannels, ...extra];
    }

    /**
     * Send initialization data to the pop-out.
     */
    _sendInit() {
        if (!this.relayChannel) return;

        // Serialize buffer: Map → plain object
        const bufferSnapshot = {};
        for (const [hrid, messages] of this.messageBuffer.entries()) {
            bufferSnapshot[hrid] = [...messages];
        }

        this.relayChannel.postMessage({
            type: 'init',
            channels: this._getLiveChannels(),
            characterName: dataManager.getCurrentCharacterName() || '',
            messageBuffer: bufferSnapshot,
        });
    }

    /**
     * Open the pop-out window and write the self-contained HTML into it.
     */
    _openPopout() {
        // Re-focus if already open
        if (this.popoutWindow && !this.popoutWindow.closed) {
            this.popoutWindow.focus();
            return;
        }

        this.popoutWindow = window.open('', 'mwi-chat-popout', 'width=960,height=720,resizable=yes');

        if (!this.popoutWindow) {
            console.error('[PopOutChat] window.open() blocked — allow pop-ups for this site');
            return;
        }

        const html = this._buildPopoutHTML();
        this.popoutWindow.document.open();
        this.popoutWindow.document.write(html);
        this.popoutWindow.document.close();
    }

    /**
     * Execute a send request from the pop-out: switch to the right channel tab,
     * set the input value, and dispatch Enter.
     * @param {string} channelHrid
     * @param {string} text
     */
    _executeSend(channelHrid, text) {
        if (!text?.trim()) return;

        const chatPanel = document.querySelector('[class*="GamePage_chatPanel"]');
        if (!chatPanel) return;

        const channelName = CHANNEL_NAME_MAP[channelHrid];
        if (!channelName) return;

        const tabButtons = Array.from(chatPanel.querySelectorAll('button[role="tab"]'));
        const tabBtn = tabButtons.find((btn) => {
            const label = btn.textContent?.trim().replace(/\d+$/, '').trim();
            return label === channelName;
        });

        const doSend = () => {
            const input = chatPanel.querySelector('[class*="Chat_chatInputContainer"] input');
            if (!input) return;

            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, text.trim());
            input.dispatchEvent(new Event('input', { bubbles: true }));

            // Yield to let React process the state update, then fire Enter
            const t = setTimeout(() => {
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            }, 0);
            this.timerRegistry.registerTimeout(t);
        };

        if (tabBtn) {
            tabBtn.click();
            const t = setTimeout(doSend, 80);
            this.timerRegistry.registerTimeout(t);
        } else {
            doSend();
        }
    }

    /**
     * Build the self-contained HTML string for the pop-out window.
     * @returns {string}
     */
    _buildPopoutHTML() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MWI Chat</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0b0e14;
    --topbg: #0d1117;
    --accent: #d7b7ff;
    --text: #cfd6e6;
    --muted: #8b949e;
    --border: rgba(255,255,255,0.07);
    --input-bg: #0f1216;
    --send-bg: #238636;
    --system: #8b949e;
  }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; font-size: 13px; overflow: hidden; }

  /* Top bar */
  #topbar {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; height: 46px;
    background: var(--topbg); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  #topbar-title { font-weight: 700; color: var(--accent); font-size: 13px; }
  #topbar-name { color: var(--muted); font-size: 11px; }
  #add-pane-btn {
    margin-left: 4px; padding: 4px 10px; font-size: 11px;
    background: rgba(215,183,255,0.1); color: var(--accent);
    border: 1px solid rgba(215,183,255,0.25); border-radius: 6px; cursor: pointer;
  }
  #add-pane-btn:hover { background: rgba(215,183,255,0.2); }
  #add-pane-btn:disabled { opacity: 0.4; cursor: default; }
  #vertical-label {
    display: flex; align-items: center; gap: 4px;
    font-size: 12px; color: #8b949e; cursor: pointer; user-select: none;
  }
  #vertical-label input { cursor: pointer; accent-color: #d7b7ff; }
  #disconnect-banner {
    display: none; margin-left: auto;
    padding: 3px 10px; background: rgba(220,50,50,0.2);
    border: 1px solid rgba(220,50,50,0.4); border-radius: 5px;
    color: #ff9999; font-size: 11px;
  }
  #disconnect-banner.visible { display: block; }

  /* Pane grid */
  #panes {
    display: grid;
    grid-template-rows: 1fr;
    height: calc(100vh - 46px);
    gap: 0;
    overflow: hidden;
  }

  /* Individual pane */
  .pane {
    display: flex; flex-direction: column;
    border-right: 1px solid var(--border);
    min-width: 0; overflow: hidden;
  }
  .pane:last-child { border-right: none; }

  /* Pane header */
  .pane-header {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 10px; background: var(--topbg);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .pane-drag-handle {
    color: var(--muted); font-size: 14px; cursor: grab;
    padding: 0 2px; line-height: 1; user-select: none; flex-shrink: 0;
  }
  .pane-drag-handle:active { cursor: grabbing; }
  .pane-channel-select {
    flex: 1; background: var(--input-bg); color: var(--text);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 5px;
    padding: 4px 6px; font-size: 12px; outline: none; cursor: pointer;
  }
  .pane-close-btn {
    background: none; border: none; color: var(--muted);
    font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1;
  }
  .pane-close-btn:hover { color: var(--text); }
  .pane.drag-over-before { box-shadow: -3px 0 0 0 var(--accent); }
  .pane.drag-over-after  { box-shadow:  3px 0 0 0 var(--accent); }
  .pane.drag-over-before.vertical-drop { box-shadow: 0 -3px 0 0 var(--accent); }
  .pane.drag-over-after.vertical-drop  { box-shadow: 0  3px 0 0 var(--accent); }

  /* Message list */
  .pane-messages {
    flex: 1; overflow-y: auto; padding: 8px 10px;
    display: flex; flex-direction: column; gap: 3px;
    scroll-behavior: smooth;
  }
  .msg { line-height: 1.45; padding: 2px 4px; border-radius: 3px; word-break: break-word; }
  .msg:hover { background: rgba(255,255,255,0.03); }
  .msg-time { color: var(--muted); font-size: 10px; margin-right: 5px; }
  .msg-name { color: var(--accent); font-weight: 600; margin-right: 4px; }
  .msg-text { color: var(--text); }
  .msg-link { color: #60a5fa; font-size: 11px; margin-left: 4px; }
  .msg-system { color: var(--system); font-style: italic; }

  /* Footer / input */
  .pane-footer {
    display: flex; gap: 6px; align-items: center;
    padding: 8px 10px; border-top: 1px solid var(--border);
    background: var(--topbg); flex-shrink: 0;
  }
  .pane-input {
    flex: 1; background: var(--input-bg); color: var(--text);
    border: 1px solid #30363d; border-radius: 5px;
    padding: 7px 10px; font-size: 13px; outline: none;
    font-family: inherit;
  }
  .pane-input:focus { border-color: rgba(215,183,255,0.4); }
  .pane-send-btn {
    background: var(--send-bg); color: #fff;
    border: none; border-radius: 5px;
    padding: 7px 14px; font-size: 12px; font-weight: bold; cursor: pointer;
    white-space: nowrap;
  }
  .pane-send-btn:hover { opacity: 0.85; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
</style>
</head>
<body>
<div id="topbar">
  <span id="topbar-title">MWI Chat</span>
  <span id="topbar-name"></span>
  <button id="add-pane-btn">+ Pane</button>
  <label id="vertical-label"><input type="checkbox" id="vertical-toggle"> Vertical</label>
  <div id="disconnect-banner">⚠ Disconnected from game tab</div>
</div>
<div id="panes"></div>

<script>
(function () {
  'use strict';

  const RELAY = '${RELAY_CHANNEL}';
  const SEND  = '${SEND_CHANNEL}';
  const MAX_PER_CHANNEL = 500;
  const STORAGE_KEY = 'mwi-chat-popout-layout';

  const relay  = new BroadcastChannel(RELAY);
  const sendCh = new BroadcastChannel(SEND);

  let channels     = [];
  let characterName = '';
  let messageBuffer = {}; // hrid → Array<msg>
  let panes        = [];
  let pingTimeout  = null;
  let paneIdSeq    = 0;

  // ── DOM refs ──────────────────────────────────────────────────
  const panesEl        = document.getElementById('panes');
  const addPaneBtn     = document.getElementById('add-pane-btn');
  const verticalToggle = document.getElementById('vertical-toggle');
  const nameEl         = document.getElementById('topbar-name');
  const disconnectEl   = document.getElementById('disconnect-banner');

  // ── Ping watchdog ─────────────────────────────────────────────
  function resetPingWatchdog() {
    clearTimeout(pingTimeout);
    disconnectEl.classList.remove('visible');
    pingTimeout = setTimeout(() => disconnectEl.classList.add('visible'), 15000);
  }

  // ── BroadcastChannel messages ─────────────────────────────────
  relay.onmessage = ({ data }) => {
    if (data.type === 'ping') {
      resetPingWatchdog();
      return;
    }
    if (data.type === 'init') {
      channels      = data.channels || [];
      characterName = data.characterName || '';
      messageBuffer = data.messageBuffer || {};
      nameEl.textContent = characterName ? '— ' + characterName : '';
      panes.forEach(p => refreshPaneSelect(p));
      resetPingWatchdog();
      return;
    }
    if (data.type === 'channels_updated') {
      channels = data.channels || [];
      panes.forEach(p => refreshPaneSelect(p));
      return;
    }
    if (data.type === 'chat_message') {
      // Buffer incoming
      if (!messageBuffer[data.channel]) messageBuffer[data.channel] = [];
      messageBuffer[data.channel].push(data);
      if (messageBuffer[data.channel].length > MAX_PER_CHANNEL) {
        messageBuffer[data.channel].shift();
      }
      // Route to matching panes
      panes.forEach(p => {
        if (p.channelHrid === data.channel) appendMessage(p, data);
      });
    }
  };

  // Signal ready
  sendCh.postMessage({ type: 'ready' });
  resetPingWatchdog();

  // ── Pane management ───────────────────────────────────────────
  function createPane(initialHrid) {
    const id = ++paneIdSeq;
    const hrid = initialHrid || (channels[0]?.hrid || '');

    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.dataset.paneId = id;

    // Header
    const header = document.createElement('div');
    header.className = 'pane-header';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'pane-drag-handle';
    dragHandle.textContent = '⠿';
    dragHandle.title = 'Drag to reorder';

    const select = document.createElement('select');
    select.className = 'pane-channel-select';
    populateSelect(select, channels, hrid);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pane-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close pane';
    closeBtn.addEventListener('click', () => removePane(id));

    header.appendChild(dragHandle);
    header.appendChild(select);
    header.appendChild(closeBtn);

    // Messages
    const messages = document.createElement('div');
    messages.className = 'pane-messages';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'pane-footer';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pane-input';
    input.placeholder = 'Type a message...';
    input.maxLength = 500;

    const sendBtn = document.createElement('button');
    sendBtn.className = 'pane-send-btn';
    sendBtn.textContent = 'SEND';

    const doSend = () => {
      const text = input.value.trim();
      if (!text || !paneObj.channelHrid) return;
      sendCh.postMessage({ type: 'send', channel: paneObj.channelHrid, text });
      input.value = '';
      input.focus();
    };

    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    footer.appendChild(input);
    footer.appendChild(sendBtn);

    pane.appendChild(header);
    pane.appendChild(messages);
    pane.appendChild(footer);

    // Drag-to-reorder
    pane.draggable = true;
    pane.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(id));
      // Use the handle as the drag image anchor so the whole pane moves naturally
      setTimeout(() => pane.style.opacity = '0.5', 0);
    });
    pane.addEventListener('dragend', () => {
      pane.style.opacity = '';
      clearDragOver();
    });
    pane.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDragOver();
      const vertical = verticalToggle.checked;
      const rect = pane.getBoundingClientRect();
      const mid = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
      const before = vertical ? e.clientY < mid : e.clientX < mid;
      pane.classList.add(before ? 'drag-over-before' : 'drag-over-after');
      if (vertical) pane.classList.add('vertical-drop');
    });
    pane.addEventListener('dragleave', () => clearDragOver());
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      const srcId = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (srcId === id) return;
      const srcIdx = panes.findIndex(p => p.id === srcId);
      const tgtIdx = panes.findIndex(p => p.id === id);
      if (srcIdx === -1 || tgtIdx === -1) return;
      const vertical = verticalToggle.checked;
      const rect = pane.getBoundingClientRect();
      const mid = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
      const insertBefore = vertical ? e.clientY < mid : e.clientX < mid;
      // Reorder DOM
      if (insertBefore) {
        panesEl.insertBefore(panes[srcIdx].pane, pane);
      } else {
        pane.insertAdjacentElement('afterend', panes[srcIdx].pane);
      }
      // Sync panes array to match DOM order
      const [moved] = panes.splice(srcIdx, 1);
      const newTgtIdx = panes.findIndex(p => p.id === id);
      panes.splice(insertBefore ? newTgtIdx : newTgtIdx + 1, 0, moved);
      clearDragOver();
      saveLayout();
    });

    panesEl.appendChild(pane);

    const paneObj = { id, pane, select, messages, input, channelHrid: hrid };
    panes.push(paneObj);

    select.addEventListener('change', () => {
      paneObj.channelHrid = select.value;
      messages.innerHTML = '';
      (messageBuffer[paneObj.channelHrid] || []).forEach(msg => appendMessage(paneObj, msg));
      saveLayout();
    });

    // Pre-populate with buffered messages
    (messageBuffer[hrid] || []).forEach(msg => appendMessage(paneObj, msg));

    updateGrid();
    updateAddButton();
    return paneObj;
  }

  function removePane(id) {
    if (panes.length <= 1) return; // Keep at least one pane
    const idx = panes.findIndex(p => p.id === id);
    if (idx === -1) return;
    panes[idx].pane.remove();
    panes.splice(idx, 1);
    updateGrid();
    updateAddButton();
    saveLayout();
  }

  function clearDragOver() {
    document.querySelectorAll('.pane').forEach(el => {
      el.classList.remove('drag-over-before', 'drag-over-after', 'vertical-drop');
    });
  }

  function updateGrid() {
    const vertical = document.getElementById('vertical-toggle')?.checked;
    if (vertical) {
      panesEl.style.gridTemplateRows = '1fr';
      panesEl.style.gridTemplateColumns = panes.map(() => '1fr').join(' ');
    } else {
      panesEl.style.gridTemplateColumns = '1fr';
      panesEl.style.gridTemplateRows = panes.map(() => '1fr').join(' ');
    }
  }

  function updateAddButton() {
    // No pane limit
  }

  function populateSelect(select, channelList, activeHrid) {
    select.innerHTML = '';
    channelList.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.hrid;
      opt.textContent = ch.name;
      if (ch.hrid === activeHrid) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function refreshPaneSelect(paneObj) {
    const current = paneObj.channelHrid;
    populateSelect(paneObj.select, channels, current);
    paneObj.select.value = current;
  }

  // ── Message rendering ─────────────────────────────────────────
  function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function linkifyText(el, text) {
    // Use RegExp constructor to avoid literal slashes being misread by document.write HTML parser
    const URL_RE = new RegExp('https?://[^ \\t\\r\\n<>\\x22\\x27]+', 'g');
    let last = 0;
    let match;
    while ((match = URL_RE.exec(text)) !== null) {
      if (match.index > last) {
        el.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      const a = document.createElement('a');
      a.href = match[0];
      a.textContent = match[0];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.cssText = 'color: #60a5fa; word-break: break-all;';
      el.appendChild(a);
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      el.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function appendMessage(paneObj, msg) {
    const { messages } = paneObj;
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;

    const row = document.createElement('div');
    row.className = msg.isSystem ? 'msg msg-system' : 'msg';

    if (msg.isSystem) {
      const timeEl = document.createElement('span');
      timeEl.className = 'msg-time';
      timeEl.textContent = formatTime(msg.t);
      const textEl = document.createElement('span');
      textEl.className = 'msg-text';
      textEl.textContent = msg.m;
      row.appendChild(timeEl);
      row.appendChild(textEl);
    } else {
      const timeEl = document.createElement('span');
      timeEl.className = 'msg-time';
      timeEl.textContent = formatTime(msg.t);

      const nameEl = document.createElement('span');
      nameEl.className = 'msg-name';
      nameEl.textContent = msg.sName;

      const textEl = document.createElement('span');
      textEl.className = 'msg-text';
      linkifyText(textEl, msg.m);

      row.appendChild(timeEl);
      row.appendChild(nameEl);
      row.appendChild(textEl);

      if (msg.renderedLinks && msg.renderedLinks.length > 0) {
        msg.renderedLinks.forEach(linkStr => {
          const linkEl = document.createElement('span');
          linkEl.className = 'msg-link';
          linkEl.textContent = linkStr;
          row.appendChild(linkEl);
        });
      }
    }

    messages.appendChild(row);

    // Trim to MAX_PER_CHANNEL rendered rows
    while (messages.children.length > MAX_PER_CHANNEL) {
      messages.removeChild(messages.firstChild);
    }

    if (atBottom) messages.scrollTop = messages.scrollHeight;
  }

  // ── Layout persistence ────────────────────────────────────────
  function saveLayout() {
    try {
      const layout = {
        vertical: verticalToggle.checked,
        panes: panes.map(p => ({ channelHrid: p.channelHrid })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch { /* ignore */ }
  }

  function loadLayout() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // ── Init ──────────────────────────────────────────────────────
  verticalToggle.addEventListener('change', () => { updateGrid(); saveLayout(); });

  addPaneBtn.addEventListener('click', () => {
    // Pick a channel not already in use if possible
    const usedHrids = new Set(panes.map(p => p.channelHrid));
    const next = channels.find(c => !usedHrids.has(c.hrid)) || channels[0];
    createPane(next?.hrid);
    saveLayout();
  });

  // Restore saved layout, or create a single default pane
  const savedLayout = loadLayout();
  if (savedLayout) {
    if (savedLayout.vertical) {
      verticalToggle.checked = true;
    }
    const savedPanes = savedLayout.panes || [];
    if (savedPanes.length > 0) {
      savedPanes.forEach(p => createPane(p.channelHrid));
    } else {
      createPane(channels[0]?.hrid || '/chat_channel_types/general');
    }
  } else {
    // Create initial pane (default to General, or first available)
    const defaultHrid = channels[0]?.hrid || '/chat_channel_types/general';
    createPane(defaultHrid);
  }

})();
</script>
</body>
</html>`;
    }

    /**
     * Disable the feature and clean up all resources.
     */
    disable() {
        if (this.wsHandler) {
            webSocketHook.off('chat_message_received', this.wsHandler);
            this.wsHandler = null;
        }

        if (this.relayChannel) {
            this.relayChannel.close();
            this.relayChannel = null;
        }

        if (this.sendChannel) {
            this.sendChannel.close();
            this.sendChannel = null;
        }

        if (this.popoutWindow && !this.popoutWindow.closed) {
            this.popoutWindow.close();
        }
        this.popoutWindow = null;

        this.timerRegistry.clearAll();

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.popoutBtn && document.contains(this.popoutBtn)) {
            this.popoutBtn.remove();
        }
        this.popoutBtn = null;

        this.messageBuffer.clear();
        this.initialized = false;
    }
}

export default {
    name: 'Pop-Out Chat',
    initialize: async () => {
        const instance = new PopOutChat();
        await instance.initialize();
        return instance;
    },
    cleanup: (instance) => {
        if (instance) instance.disable();
    },
};
