/**
 * Task Token Threshold
 * Flags visible tasks whose Task Token reward falls below a configurable cutoff with the
 * same red-outline/badge reminder used by the manual Task Auto-Reroll list — but computed
 * automatically per task instance instead of a hand-curated HRID list, since token reward
 * varies per task instance rather than per action/monster.
 *
 * Never clicks or rerolls anything automatically — purely a visual classification aid.
 * Per-character configuration stored in IndexedDB.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import taskProfitDisplay from './task-profit-display.js';

const THRESHOLD_STORAGE_KEY_PREFIX = 'taskTokenThreshold_value';
// storage.get's own defaultValue param defaults to null, so passing `undefined` to mean
// "no value" would be swallowed by its own default substitution before we could inspect it.
const NO_THRESHOLD_CONFIGURED = Symbol('no-token-threshold-configured');

/**
 * Get a character-scoped storage key for the given prefix.
 * @param {string} prefix
 * @returns {string}
 */
function getCharacterScopedKey(prefix) {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${prefix}_${charId}`;
}

class TaskTokenThreshold {
    constructor() {
        this.isInitialized = false;
        this.threshold = null;
        this.unregisterHandlers = [];
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('taskTokenThreshold')) return;

        this.isInitialized = true;

        const saved = await storage.get(
            getCharacterScopedKey(THRESHOLD_STORAGE_KEY_PREFIX),
            'settings',
            NO_THRESHOLD_CONFIGURED
        );
        this.threshold = saved === NO_THRESHOLD_CONFIGURED ? null : saved;

        const unregister = domObserver.onClass('TaskTokenThreshold', 'RandomTask_randomTask', (taskNode) => {
            setTimeout(() => this._processTaskCard(taskNode), 150);
        });
        this.unregisterHandlers.push(unregister);

        const questHandler = () => {
            setTimeout(() => this._processAllCards(), 300);
        };
        webSocketHook.on('quests_updated', questHandler);
        this.unregisterHandlers.push(() => webSocketHook.off('quests_updated', questHandler));

        const unregisterPanel = domObserver.onClass('TaskTokenThreshold-Panel', 'TasksPanel_taskSlotCount', (panel) => {
            this._injectConfigButton(panel);
        });
        this.unregisterHandlers.push(unregisterPanel);

        this._processAllCards();
    }

    /**
     * Process all visible task cards.
     * @private
     */
    _processAllCards() {
        const cards = document.querySelectorAll('[class*="RandomTask_randomTask"]');
        for (const card of cards) {
            this._processTaskCard(card);
        }
    }

    /**
     * Inject a config button into the task panel header.
     * @param {HTMLElement} panel - The TasksPanel_taskSlotCount element
     * @private
     */
    _injectConfigButton(panel) {
        const parent = panel.parentElement;
        if (!parent || parent.querySelector('.mwi-task-token-threshold-btn')) return;

        const btn = document.createElement('span');
        btn.className = 'mwi-task-token-threshold-btn';
        btn.textContent = '\u{1FA99}';
        btn.title = 'Configure Task Token reroll threshold';
        btn.style.cssText = 'cursor:pointer; font-size:16px; margin-left:6px; opacity:0.7; transition:opacity 0.1s;';
        btn.addEventListener('mouseover', () => {
            btn.style.opacity = '1';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.opacity = '0.7';
        });
        btn.addEventListener('click', () => this.openConfigPopup());

        parent.appendChild(btn);
    }

    /**
     * Process a single task card — classify it against the configured token threshold.
     * @param {HTMLElement} taskCard
     * @private
     */
    _processTaskCard(taskCard) {
        const hasOwnBadge = !!taskCard.querySelector('.mwi-token-badge');

        if (this.threshold === null) {
            if (hasOwnBadge) this._clearBadge(taskCard);
            return;
        }

        const data = taskProfitDisplay.parseTaskData(taskCard);
        if (!data) return;

        // Never override manual protection (green outline from Task Reroll Protection).
        const isProtected =
            taskCard.dataset.mwiRerollProtection === '1' && taskCard.style.outline?.includes('76, 175, 80');

        // Don't stack a second red badge on top of the manual Auto-Reroll reminder.
        const hasManualBadge = !!taskCard.querySelector('.mwi-autoreroll-badge');

        const belowThreshold = data.taskTokenReward < this.threshold;

        if (belowThreshold && !isProtected && !hasManualBadge) {
            taskCard.style.setProperty('outline', '2px solid rgba(239, 68, 68, 0.7)', 'important');
            taskCard.style.setProperty('outline-offset', '-2px');
            taskCard.style.setProperty('box-shadow', '0 0 8px 2px rgba(239, 68, 68, 0.3)', 'important');
            this._showBadge(taskCard);
        } else if (hasOwnBadge) {
            taskCard.style.removeProperty('outline');
            taskCard.style.removeProperty('outline-offset');
            taskCard.style.removeProperty('box-shadow');
            this._clearBadge(taskCard);
        }
    }

    /**
     * Show the "Low tokens!" badge on a task card.
     * @param {HTMLElement} taskCard
     * @private
     */
    _showBadge(taskCard) {
        if (taskCard.querySelector('.mwi-token-badge')) return;

        const badge = document.createElement('div');
        badge.className = 'mwi-token-badge';
        badge.textContent = 'Low tokens!';
        badge.style.cssText = `
            position: absolute;
            top: 4px;
            right: 4px;
            font-size: 10px;
            font-weight: 700;
            color: #fff;
            background: rgba(239, 68, 68, 0.85);
            padding: 2px 6px;
            border-radius: 3px;
            z-index: 10;
            pointer-events: none;
        `;

        const currentPos = getComputedStyle(taskCard).position;
        if (currentPos === 'static') {
            taskCard.style.position = 'relative';
        }

        taskCard.appendChild(badge);
    }

    /**
     * Clear the "Low tokens!" badge from a task card.
     * @param {HTMLElement} taskCard
     * @private
     */
    _clearBadge(taskCard) {
        const badge = taskCard.querySelector('.mwi-token-badge');
        if (badge) badge.remove();
    }

    /**
     * Set and persist the token threshold, then re-process all visible cards.
     * @param {number|null} value
     */
    async setThreshold(value) {
        this.threshold = value;
        await storage.set(getCharacterScopedKey(THRESHOLD_STORAGE_KEY_PREFIX), value, 'settings');
        this._processAllCards();
    }

    /**
     * Open the configuration popup for setting the token threshold.
     */
    openConfigPopup() {
        const existing = document.getElementById('mwi-task-token-threshold-popup');
        if (existing) {
            existing.remove();
            return;
        }

        const popup = document.createElement('div');
        popup.id = 'mwi-task-token-threshold-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 99999;
            background: rgba(10, 10, 20, 0.97);
            border: 2px solid rgba(239, 68, 68, 0.5);
            border-radius: 10px;
            width: 320px;
            font-family: 'Segoe UI', sans-serif;
            color: #e0e0e0;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(239, 68, 68, 0.3);
        `;
        header.innerHTML = `
            <span style="font-weight:700; font-size:14px; color:#ef4444;">Task Token Threshold</span>
            <button id="mwi-task-token-threshold-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">×</button>
        `;

        const body = document.createElement('div');
        body.style.cssText = 'padding: 12px 14px; display:flex; flex-direction:column; gap:10px;';
        body.innerHTML = `
            <div style="color:#aaa;">Flag tasks below this Task Token reward for reroll.</div>
            <div style="display:flex; align-items:center; gap:8px;">
                <span>Below</span>
                <input id="mwi-token-threshold-input" type="number" min="0" step="1" placeholder="e.g. 8" style="
                    width: 70px;
                    padding: 4px 6px;
                    background: rgba(255,255,255,0.08);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px;
                    color: #e0e0e0;
                    font-size: 13px;
                    font-family: inherit;
                    outline: none;
                ">
                <span>tokens</span>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="mwi-token-threshold-save" style="
                    flex:1; padding:6px 10px; background:rgba(239,68,68,0.25);
                    border:1px solid rgba(239,68,68,0.5); border-radius:6px;
                    color:#e0e0e0; cursor:pointer; font-size:13px;">Save</button>
                <button id="mwi-token-threshold-clear" style="
                    flex:1; padding:6px 10px; background:rgba(255,255,255,0.06);
                    border:1px solid rgba(255,255,255,0.15); border-radius:6px;
                    color:#aaa; cursor:pointer; font-size:13px;">Disable</button>
            </div>
        `;

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(popup);

        const input = popup.querySelector('#mwi-token-threshold-input');
        if (this.threshold !== null) input.value = String(this.threshold);
        input.focus();

        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99998;';
        const closePopup = () => {
            popup.remove();
            backdrop.remove();
        };
        backdrop.addEventListener('click', closePopup);
        document.body.appendChild(backdrop);

        popup.querySelector('#mwi-task-token-threshold-close').addEventListener('click', closePopup);

        popup.querySelector('#mwi-token-threshold-save').addEventListener('click', async () => {
            const value = parseInt(input.value, 10);
            if (!Number.isNaN(value) && value >= 0) {
                await this.setThreshold(value);
            }
            closePopup();
        });

        popup.querySelector('#mwi-token-threshold-clear').addEventListener('click', async () => {
            await this.setThreshold(null);
            closePopup();
        });
    }

    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        const cards = document.querySelectorAll('[class*="RandomTask_randomTask"]');
        for (const card of cards) {
            if (card.querySelector('.mwi-token-badge')) {
                card.style.removeProperty('outline');
                card.style.removeProperty('outline-offset');
                card.style.removeProperty('box-shadow');
                this._clearBadge(card);
            }
        }

        this.isInitialized = false;
    }
}

const taskTokenThreshold = new TaskTokenThreshold();

export default {
    name: 'Task Token Threshold',
    initialize: async () => {
        await taskTokenThreshold.initialize();
    },
    cleanup: () => {
        taskTokenThreshold.disable();
    },
    disable: () => {
        taskTokenThreshold.disable();
    },
};
export { TaskTokenThreshold };
