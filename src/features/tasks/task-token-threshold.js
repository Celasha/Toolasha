/**
 * Task Token Threshold
 * Flags visible tasks whose Task Token reward crosses a configurable cutoff (below or above)
 * with the same red-outline/badge reminder used by the manual Task Auto-Reroll list — but
 * computed automatically per task instance instead of a hand-curated HRID list, since token
 * reward varies per task instance rather than per action/monster.
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
import { repaintTaskCard } from './task-card-visual-state.js';

const THRESHOLD_STORAGE_KEY_PREFIX = 'taskTokenThreshold_value';
const DIRECTION_STORAGE_KEY_PREFIX = 'taskTokenThreshold_direction';
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
        this.direction = 'below';
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

        const savedDirection = await storage.get(
            getCharacterScopedKey(DIRECTION_STORAGE_KEY_PREFIX),
            'settings',
            'below'
        );
        this.direction = savedDirection === 'above' ? 'above' : 'below';

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
        if (this.threshold === null) {
            taskCard.dataset.mwiTokenFlag = '';
            repaintTaskCard(taskCard);
            return;
        }

        const data = taskProfitDisplay.parseTaskData(taskCard);
        if (!data) return;

        const qualifies =
            this.direction === 'above' ? data.taskTokenReward > this.threshold : data.taskTokenReward < this.threshold;

        // Write this feature's own signal; repaintTaskCard resolves the final border/badge
        // considering Task Reroll Protection and Task Auto-Reroll Reminder too — qualifying here
        // always wins the red border/badge, even over manual protection's green border.
        taskCard.dataset.mwiTokenFlag = qualifies ? '1' : '';
        taskCard.dataset.mwiTokenFlagText = this.direction === 'above' ? 'High tokens!' : 'Low tokens!';
        repaintTaskCard(taskCard);
    }

    /**
     * Set and persist the token threshold and direction, then re-process all visible cards.
     * @param {number|null} value
     * @param {'below'|'above'} [direction]
     */
    async setThreshold(value, direction = this.direction) {
        this.threshold = value;
        this.direction = direction === 'above' ? 'above' : 'below';
        await storage.set(getCharacterScopedKey(THRESHOLD_STORAGE_KEY_PREFIX), value, 'settings', true);
        await storage.set(getCharacterScopedKey(DIRECTION_STORAGE_KEY_PREFIX), this.direction, 'settings', true);
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
            <div style="color:#aaa;">Flag tasks whose Task Token reward crosses this cutoff for reroll.</div>
            <div style="display:flex; align-items:center; gap:8px;">
                <select id="mwi-token-threshold-direction" style="
                    padding: 4px 6px;
                    background: rgba(255,255,255,0.08);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px;
                    color: #e0e0e0;
                    font-size: 13px;
                    font-family: inherit;
                    cursor: pointer;
                ">
                    <option value="below">Below</option>
                    <option value="above">Above</option>
                </select>
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

        const directionSelect = popup.querySelector('#mwi-token-threshold-direction');
        directionSelect.value = this.direction;

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
            const direction = directionSelect.value === 'above' ? 'above' : 'below';
            if (!Number.isNaN(value) && value >= 0) {
                await this.setThreshold(value, direction);
            }
            closePopup();
        });

        popup.querySelector('#mwi-token-threshold-clear').addEventListener('click', async () => {
            const direction = directionSelect.value === 'above' ? 'above' : 'below';
            await this.setThreshold(null, direction);
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
            card.dataset.mwiTokenFlag = '';
            repaintTaskCard(card);
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
