/**
 * Task Reroll Protection
 * Prevents accidental rerolling of desirable tasks by highlighting protected tasks
 * and requiring a confirmation click before rerolling.
 *
 * Users configure which action/monster HRIDs to protect. When a task matches,
 * it gets a green border and the reroll buttons require a double-click to proceed.
 */

import { t } from '../../core/i18n.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';

const STORAGE_KEY_PREFIX = 'taskProtectedHrids';

/**
 * Get character-scoped storage key.
 * @returns {string}
 */
function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

class TaskRerollProtection {
    constructor() {
        this.isInitialized = false;
        this.protectedHrids = new Set();
        this.unregisterHandlers = [];
        this.confirmTimers = new WeakMap(); // taskCard → timeout ID
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('taskRerollProtection')) return;

        this.isInitialized = true;

        // Load protected list from storage
        const saved = await storage.getJSON(getStorageKey(), 'settings', []);
        this.protectedHrids = new Set(saved);

        // Watch for task cards appearing
        const unregister = domObserver.onClass('TaskRerollProtection', 'RandomTask_randomTask', (taskNode) => {
            setTimeout(() => this._processTaskCard(taskNode), 150);
        });
        this.unregisterHandlers.push(unregister);

        // Re-process on quest updates (task content may change after reroll)
        const questHandler = () => {
            setTimeout(() => this._processAllCards(), 300);
        };
        webSocketHook.on('quests_updated', questHandler);
        this.unregisterHandlers.push(() => webSocketHook.off('quests_updated', questHandler));

        // Inject shield config button into task panel
        const unregisterPanel = domObserver.onClass(
            'TaskRerollProtection-Panel',
            'TasksPanel_taskSlotCount',
            (panel) => {
                this._injectConfigButton(panel);
            }
        );
        this.unregisterHandlers.push(unregisterPanel);

        // Process existing cards
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
     * Inject a shield config button into the task panel header.
     * @param {HTMLElement} panel - The TasksPanel_taskSlotCount element
     * @private
     */
    _injectConfigButton(panel) {
        const parent = panel.parentElement;
        if (!parent || parent.querySelector('.mwi-task-protection-btn')) return;

        const btn = document.createElement('span');
        btn.className = 'mwi-task-protection-btn';
        btn.textContent = '🛡️';
        btn.title = t('Configure task reroll protection');
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
     * Process a single task card — check protection status and wire interception.
     * @param {HTMLElement} taskCard
     * @private
     */
    _processTaskCard(taskCard) {
        // Get quest data via fiber traversal
        const quest = this._getQuestFromCard(taskCard);
        const hrid = quest?.actionHrid || quest?.monsterHrid || '';
        const isProtected = hrid && this.protectedHrids.has(hrid);

        // Update visual state
        if (isProtected && !config.getSetting('taskRerollProtection_hideHighlight')) {
            taskCard.style.setProperty('outline', '2px solid rgba(76, 175, 80, 0.7)', 'important');
            taskCard.style.setProperty('outline-offset', '-2px');
            taskCard.style.setProperty('box-shadow', '0 0 8px 2px rgba(76, 175, 80, 0.3)', 'important');
        } else {
            taskCard.style.removeProperty('outline');
            taskCard.style.removeProperty('outline-offset');
            taskCard.style.removeProperty('box-shadow');
        }

        // Wire reroll button interception (only once per card)
        if (!taskCard.dataset.mwiRerollProtection) {
            taskCard.dataset.mwiRerollProtection = '1';
            this._wireRerollInterception(taskCard);
        }
    }

    /**
     * Extract quest data from a task card via React fiber traversal.
     * Tries multiple anchor elements to find the quest in the fiber tree.
     * @param {HTMLElement} taskCard
     * @returns {Object|null} Quest object with actionHrid/monsterHrid
     * @private
     */
    _getQuestFromCard(taskCard) {
        const rootEl = document.getElementById('root');
        const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
        if (!rootFiber) return null;

        function walk(fiber, target) {
            if (!fiber) return null;
            if (fiber.stateNode === target) return fiber;
            return walk(fiber.child, target) || walk(fiber.sibling, target);
        }

        function findQuestInFiber(startFiber) {
            let f = startFiber?.return;
            while (f) {
                if (f.memoizedProps?.characterQuest) {
                    return f.memoizedProps.characterQuest;
                }
                f = f.return;
            }
            return null;
        }

        // Try multiple anchor elements: Go button, any button, the card itself
        const anchors = [
            taskCard.querySelector('button.Button_success__6d6kU'),
            taskCard.querySelector('button'),
            taskCard.querySelector('[class*="RandomTask_name"]'),
            taskCard,
        ];

        for (const anchor of anchors) {
            if (!anchor) continue;
            const fiber = walk(rootFiber, anchor);
            if (fiber) {
                const quest = findQuestInFiber(fiber);
                if (quest) return quest;
            }
        }

        return null;
    }

    /**
     * Wire click interception on reroll buttons within a task card.
     * Blocks all button clicks except Go (success) and Claim (buy) on protected tasks.
     * Uses document-level capturing to intercept before React's delegated event system.
     * @param {HTMLElement} taskCard
     * @private
     */
    _wireRerollInterception(_taskCard) {
        // Only wire the document-level interceptor once
        if (!this._documentInterceptorAttached) {
            this._documentInterceptorAttached = true;

            document.addEventListener(
                'click',
                (e) => {
                    if (!config.getSetting('taskRerollProtection')) return;

                    const btn = e.target.closest('button');
                    if (!btn) return;

                    // Allow Go buttons and Claim buttons through
                    if (btn.classList.contains('Button_success__6d6kU')) return;
                    if (btn.classList.contains('Button_buy__3s24l')) return;

                    // Only intercept actual reroll actions (Pay / Free Reroll), not the initial "Reroll" expand button
                    const btnText = btn.textContent?.trim() || '';
                    const isPayButton = btnText.startsWith('Pay');
                    const isFreeReroll = btnText.toLowerCase().includes('free');
                    if (!isPayButton && !isFreeReroll) return;

                    // Find the parent task card
                    const card = btn.closest('[class*="RandomTask_randomTask"]');
                    if (!card) return;

                    // Check if this task is protected
                    const quest = this._getQuestFromCard(card);
                    const hrid = quest?.actionHrid || quest?.monsterHrid || '';
                    if (!hrid || !this.protectedHrids.has(hrid)) return;

                    // Phase 2: confirmation window is open — allow the reroll through
                    if (card.dataset.mwiRerollConfirmed === '1') {
                        card.dataset.mwiRerollConfirmed = '';
                        this._clearWarning(card);
                        return;
                    }

                    // Always block during any protection state (lockdown or waiting for confirm)
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    // Phase 1: lockdown active — absorb click silently
                    if (card.dataset.mwiRerollLocked === '1') return;

                    // Initial click — start 3s lockdown
                    card.dataset.mwiRerollLocked = '1';
                    this._showWarning(card, t('Protected task! Unlocks in 3s...'));

                    // Clear any existing timers for this card
                    const existingTimer = this.confirmTimers.get(card);
                    if (existingTimer) clearTimeout(existingTimer);

                    // After 3s lockdown → open confirmation window
                    const lockdownTimer = setTimeout(() => {
                        card.dataset.mwiRerollLocked = '';
                        card.dataset.mwiRerollConfirmed = '1';
                        this._showWarning(card, t('Click reroll now to confirm.'));

                        // Auto-clear confirmation after another 3s
                        const confirmTimer = setTimeout(() => {
                            card.dataset.mwiRerollConfirmed = '';
                            this._clearWarning(card);
                        }, 3000);
                        this.confirmTimers.set(card, confirmTimer);
                    }, 3000);
                    this.confirmTimers.set(card, lockdownTimer);
                },
                true // Capturing phase — runs before React's delegation on root
            );
        }
    }

    /**
     * Show warning overlay on a task card.
     * @param {HTMLElement} taskCard
     * @param {string} [message='Protected task! Unlocks in 3s...']
     * @private
     */
    _showWarning(taskCard, message = t('Protected task! Unlocks in 3s...')) {
        this._clearWarning(taskCard);

        const warning = document.createElement('div');
        warning.className = 'mwi-reroll-warning';
        warning.style.cssText = `
            position: absolute;
            bottom: 4px;
            left: 0;
            right: 0;
            text-align: center;
            font-size: 11px;
            font-weight: 700;
            color: #ff6b6b;
            background: rgba(0, 0, 0, 0.85);
            padding: 3px 8px;
            border-radius: 4px;
            z-index: 10;
            pointer-events: none;
            animation: mwi-blink 0.5s ease-in-out 2;
        `;
        warning.textContent = message;

        // Ensure task card has relative positioning for absolute child
        const currentPos = getComputedStyle(taskCard).position;
        if (currentPos === 'static') {
            taskCard.style.position = 'relative';
        }

        taskCard.appendChild(warning);
    }

    /**
     * Clear warning overlay from a task card.
     * @param {HTMLElement} taskCard
     * @private
     */
    _clearWarning(taskCard) {
        const existing = taskCard.querySelector('.mwi-reroll-warning');
        if (existing) existing.remove();
    }

    /**
     * Add an HRID to the protected list.
     * @param {string} hrid - Action or monster HRID
     */
    async addProtected(hrid) {
        this.protectedHrids.add(hrid);
        await this._save();
        this._processAllCards();
    }

    /**
     * Remove an HRID from the protected list.
     * @param {string} hrid - Action or monster HRID
     */
    async removeProtected(hrid) {
        this.protectedHrids.delete(hrid);
        await this._save();
        this._processAllCards();
    }

    /**
     * Toggle an HRID in the protected list.
     * @param {string} hrid
     * @returns {boolean} New state (true = protected)
     */
    async toggleProtected(hrid) {
        if (this.protectedHrids.has(hrid)) {
            this.protectedHrids.delete(hrid);
        } else {
            this.protectedHrids.add(hrid);
        }
        await this._save();
        this._processAllCards();
        return this.protectedHrids.has(hrid);
    }

    /**
     * Get all protected HRIDs.
     * @returns {Set<string>}
     */
    getProtectedHrids() {
        return this.protectedHrids;
    }

    /**
     * Save protected list to storage.
     * @private
     */
    async _save() {
        await storage.setJSON(getStorageKey(), Array.from(this.protectedHrids), 'settings', true);
    }

    /**
     * Open the configuration popup for managing protected tasks.
     */
    openConfigPopup() {
        // Remove existing popup
        const existing = document.getElementById('mwi-task-protection-popup');
        if (existing) {
            existing.remove();
            return;
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        // Build list of all possible task targets (actions + monsters + zones)
        const items = [];
        const zoneMonsters = {}; // zoneHrid → [monsterHrid, ...]

        // Actions (gathering, production, etc.)
        for (const [hrid, action] of Object.entries(gameData.actionDetailMap || {})) {
            if (action.type === '/action_types/combat') {
                // Build zone → monster mapping
                const monsterHrids = new Set();
                const fightInfo = action.combatZoneInfo?.fightInfo;
                if (fightInfo) {
                    for (const spawn of fightInfo.randomSpawnInfo?.spawns || []) {
                        if (spawn.combatMonsterHrid) monsterHrids.add(spawn.combatMonsterHrid);
                    }
                    for (const spawn of fightInfo.bossSpawns || []) {
                        if (spawn.combatMonsterHrid) monsterHrids.add(spawn.combatMonsterHrid);
                    }
                }
                const dungeonInfo = action.combatZoneInfo?.dungeonInfo;
                if (dungeonInfo) {
                    for (const wave of Object.values(dungeonInfo.fixedSpawnsMap || {})) {
                        for (const spawn of wave) {
                            if (spawn.combatMonsterHrid) monsterHrids.add(spawn.combatMonsterHrid);
                        }
                    }
                    for (const spawnInfo of Object.values(dungeonInfo.randomSpawnInfoMap || {})) {
                        for (const spawn of spawnInfo.spawns || []) {
                            if (spawn.combatMonsterHrid) monsterHrids.add(spawn.combatMonsterHrid);
                        }
                    }
                }
                if (monsterHrids.size > 1) {
                    zoneMonsters[hrid] = [...monsterHrids];
                    items.push({ hrid, name: action.name, type: 'zone', isZone: true });
                }
                continue;
            }
            items.push({ hrid, name: action.name, type: action.type?.split('/').pop() || 'other' });
        }

        // Combat monsters
        for (const [hrid, monster] of Object.entries(gameData.combatMonsterDetailMap || {})) {
            items.push({ hrid, name: monster.name, type: 'combat' });
        }

        items.sort((a, b) => a.name.localeCompare(b.name));

        // Build popup
        const popup = document.createElement('div');
        popup.id = 'mwi-task-protection-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 99999;
            background: rgba(10, 10, 20, 0.97);
            border: 2px solid rgba(74, 158, 255, 0.5);
            border-radius: 10px;
            width: 400px;
            max-height: 500px;
            display: flex;
            flex-direction: column;
            font-family: 'Segoe UI', sans-serif;
            color: #e0e0e0;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(74, 158, 255, 0.3);
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <span style="font-weight:700; font-size:14px; color:#4a9eff;">${t('Protected Tasks')}</span>
            <button id="mwi-task-protection-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">×</button>
        `;

        // Search input
        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding: 8px 14px; flex-shrink: 0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = t('Search actions, monsters, zones...');
        searchInput.style.cssText = `
            width: 100%;
            padding: 6px 10px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 6px;
            color: #e0e0e0;
            font-size: 13px;
            font-family: inherit;
            outline: none;
        `;
        searchDiv.appendChild(searchInput);

        // List container
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'flex: 1; overflow-y: auto; padding: 4px 14px;';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query
                ? items.filter((i) => i.name.toLowerCase().includes(lower))
                : items.filter((i) => {
                      if (i.isZone) {
                          // Show zone if any of its monsters are protected
                          return zoneMonsters[i.hrid]?.some((m) => this.protectedHrids.has(m));
                      }
                      return this.protectedHrids.has(i.hrid);
                  });

            let html = '';
            if (!query && filtered.length === 0) {
                html = `<div style="color:#666; text-align:center; padding:20px 0;">${t('No protected tasks yet. Search to add.')}</div>`;
            }

            for (const item of filtered.slice(0, 50)) {
                let checkmark, checkColor, nameColor, typeLabel;

                if (item.isZone) {
                    const monsters = zoneMonsters[item.hrid] || [];
                    const protectedCount = monsters.filter((m) => this.protectedHrids.has(m)).length;
                    const allProtected = protectedCount === monsters.length;
                    checkmark = allProtected ? '✓' : protectedCount > 0 ? '~' : '';
                    checkColor = protectedCount > 0 ? '#4a9eff' : '#444';
                    nameColor = protectedCount > 0 ? '#e0e0e0' : '#aaa';
                    typeLabel = 'Zone (' + monsters.length + ')';
                } else {
                    const isProtected = this.protectedHrids.has(item.hrid);
                    checkmark = isProtected ? '✓' : '';
                    checkColor = isProtected ? '#4caf50' : '#444';
                    nameColor = isProtected ? '#e0e0e0' : '#aaa';
                    typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
                }

                const borderColor = item.isZone ? '#2a2a4e' : '#1a1a2e';
                html += `<div data-hrid="${item.hrid}" ${item.isZone ? 'data-zone="1"' : ''} style="
                    display:flex; align-items:center; gap:8px; padding:5px 4px;
                    cursor:pointer; border-bottom:1px solid ${borderColor};
                    transition: background 0.1s;
                " onmouseover="this.style.background='rgba(255,255,255,0.04)'"
                   onmouseout="this.style.background=''">
                    <span style="width:18px; text-align:center; color:${checkColor}; font-weight:700;">${checkmark}</span>
                    <span style="flex:1; color:${nameColor};">${item.name}</span>
                    <span style="color:#666; font-size:11px;">${typeLabel}</span>
                </div>`;
            }

            if (filtered.length > 50) {
                html += `<div style="color:#666; text-align:center; padding:8px;">...${filtered.length - 50} ${t('more (refine search)')}</div>`;
            }

            listContainer.innerHTML = html;

            // Wire click handlers
            listContainer.querySelectorAll('[data-hrid]').forEach((row) => {
                row.addEventListener('click', async () => {
                    if (row.dataset.zone === '1') {
                        // Zone click — toggle all monsters in zone
                        const monsters = zoneMonsters[row.dataset.hrid] || [];
                        const allProtected = monsters.every((m) => this.protectedHrids.has(m));
                        for (const m of monsters) {
                            if (allProtected) {
                                this.protectedHrids.delete(m);
                            } else {
                                this.protectedHrids.add(m);
                            }
                        }
                        await this._save();
                        this._processAllCards();
                    } else {
                        await this.toggleProtected(row.dataset.hrid);
                    }
                    renderList(searchInput.value.trim());
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        popup.appendChild(header);
        popup.appendChild(searchDiv);
        popup.appendChild(listContainer);
        document.body.appendChild(popup);

        // Initial render — show protected items
        renderList('');
        searchInput.focus();

        // Close handler
        popup.querySelector('#mwi-task-protection-close').addEventListener('click', () => popup.remove());

        // Click outside to close
        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99998;';
        backdrop.addEventListener('click', () => {
            popup.remove();
            backdrop.remove();
        });
        document.body.appendChild(backdrop);
    }

    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        // Remove all visual changes
        const cards = document.querySelectorAll('[class*="RandomTask_randomTask"]');
        for (const card of cards) {
            card.style.removeProperty('outline');
            card.style.removeProperty('outline-offset');
            card.style.removeProperty('box-shadow');
            this._clearWarning(card);
        }

        this.isInitialized = false;
    }
}

const taskRerollProtection = new TaskRerollProtection();

export default {
    name: t('Task Reroll Protection'),
    initialize: async () => {
        await taskRerollProtection.initialize();
    },
    cleanup: () => {
        taskRerollProtection.disable();
    },
    disable: () => {
        taskRerollProtection.disable();
    },
    openConfigPopup: () => {
        taskRerollProtection.openConfigPopup();
    },
};
