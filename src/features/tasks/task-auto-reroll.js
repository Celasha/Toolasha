/**
 * Task Auto-Reroll Reminder
 * Highlights tasks that the user wants to reroll with a red/orange indicator.
 * Inverse of task reroll protection — instead of preventing rerolls,
 * it reminds the user to reroll unwanted tasks.
 *
 * Per-character configuration stored in IndexedDB.
 */

import { t } from '../../core/i18n.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';

const STORAGE_KEY_PREFIX = 'taskAutoRerollHrids';

function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

class TaskAutoReroll {
    constructor() {
        this.isInitialized = false;
        this.autoRerollHrids = new Set();
        this.unregisterHandlers = [];
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('taskAutoReroll')) return;

        this.isInitialized = true;

        const saved = await storage.getJSON(getStorageKey(), 'settings', []);
        this.autoRerollHrids = new Set(saved);

        const unregister = domObserver.onClass('TaskAutoReroll', 'RandomTask_randomTask', (taskNode) => {
            setTimeout(() => this._processTaskCard(taskNode), 150);
        });
        this.unregisterHandlers.push(unregister);

        const questHandler = () => {
            setTimeout(() => this._processAllCards(), 300);
        };
        webSocketHook.on('quests_updated', questHandler);
        this.unregisterHandlers.push(() => webSocketHook.off('quests_updated', questHandler));

        const unregisterPanel = domObserver.onClass('TaskAutoReroll-Panel', 'TasksPanel_taskSlotCount', (panel) => {
            this._injectConfigButton(panel);
        });
        this.unregisterHandlers.push(unregisterPanel);
    }

    _processAllCards() {
        const cards = document.querySelectorAll('[class*="RandomTask_randomTask"]');
        for (const card of cards) {
            this._processTaskCard(card);
        }
    }

    _injectConfigButton(panel) {
        const parent = panel.parentElement;
        if (!parent || parent.querySelector('.mwi-task-autoreroll-btn')) return;

        const btn = document.createElement('span');
        btn.className = 'mwi-task-autoreroll-btn';
        btn.textContent = '\u{1F3AF}';
        btn.title = t('Configure task auto-reroll reminders');
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

    _processTaskCard(taskCard) {
        const quest = this._getQuestFromCard(taskCard);
        const hrid = quest?.actionHrid || quest?.monsterHrid || '';
        const shouldReroll = hrid && this.autoRerollHrids.has(hrid);

        // Don't show reroll reminder if task is also in protection list (green outline = protected)
        const isProtected =
            taskCard.dataset.mwiRerollProtection === '1' && taskCard.style.outline?.includes('76, 175, 80');

        if (shouldReroll && !isProtected) {
            taskCard.style.setProperty('outline', '2px solid rgba(239, 68, 68, 0.7)', 'important');
            taskCard.style.setProperty('outline-offset', '-2px');
            taskCard.style.setProperty('box-shadow', '0 0 8px 2px rgba(239, 68, 68, 0.3)', 'important');
            this._showBadge(taskCard);
        } else if (taskCard.querySelector('.mwi-autoreroll-badge')) {
            taskCard.style.removeProperty('outline');
            taskCard.style.removeProperty('outline-offset');
            taskCard.style.removeProperty('box-shadow');
            this._clearBadge(taskCard);
        }
    }

    _showBadge(taskCard) {
        if (taskCard.querySelector('.mwi-autoreroll-badge')) return;

        const badge = document.createElement('div');
        badge.className = 'mwi-autoreroll-badge';
        badge.textContent = t('Reroll!');
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

    _clearBadge(taskCard) {
        const badge = taskCard.querySelector('.mwi-autoreroll-badge');
        if (badge) badge.remove();
    }

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

    async toggleHrid(hrid) {
        if (this.autoRerollHrids.has(hrid)) {
            this.autoRerollHrids.delete(hrid);
        } else {
            this.autoRerollHrids.add(hrid);
        }
        await this._save();
        this._processAllCards();
        return this.autoRerollHrids.has(hrid);
    }

    async _save() {
        await storage.setJSON(getStorageKey(), Array.from(this.autoRerollHrids), 'settings', true);
    }

    openConfigPopup() {
        const existing = document.getElementById('mwi-task-autoreroll-popup');
        if (existing) {
            existing.remove();
            return;
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        const items = [];
        const zoneMonsters = {};

        for (const [hrid, action] of Object.entries(gameData.actionDetailMap || {})) {
            if (action.type === '/action_types/combat') {
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

        for (const [hrid, monster] of Object.entries(gameData.combatMonsterDetailMap || {})) {
            items.push({ hrid, name: monster.name, type: 'combat' });
        }

        items.sort((a, b) => a.name.localeCompare(b.name));

        const popup = document.createElement('div');
        popup.id = 'mwi-task-autoreroll-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 99999;
            background: rgba(10, 10, 20, 0.97);
            border: 2px solid rgba(239, 68, 68, 0.5);
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

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(239, 68, 68, 0.3);
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <span style="font-weight:700; font-size:14px; color:#ef4444;">${t('Auto-Reroll List')}</span>
            <button id="mwi-task-autoreroll-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">\u00d7</button>
        `;

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

        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'flex: 1; overflow-y: auto; padding: 4px 14px;';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query
                ? items.filter((i) => i.name.toLowerCase().includes(lower))
                : items.filter((i) => {
                      if (i.isZone) {
                          return zoneMonsters[i.hrid]?.some((m) => this.autoRerollHrids.has(m));
                      }
                      return this.autoRerollHrids.has(i.hrid);
                  });

            let html = '';
            if (!query && filtered.length === 0) {
                html = `<div style="color:#666; text-align:center; padding:20px 0;">${t('No auto-reroll tasks yet. Search to add.')}</div>`;
            }

            for (const item of filtered.slice(0, 50)) {
                let checkmark, checkColor, nameColor, typeLabel;

                if (item.isZone) {
                    const monsters = zoneMonsters[item.hrid] || [];
                    const markedCount = monsters.filter((m) => this.autoRerollHrids.has(m)).length;
                    const allMarked = markedCount === monsters.length;
                    checkmark = allMarked ? '\u2713' : markedCount > 0 ? '~' : '';
                    checkColor = markedCount > 0 ? '#ef4444' : '#444';
                    nameColor = markedCount > 0 ? '#e0e0e0' : '#aaa';
                    typeLabel = 'Zone (' + monsters.length + ')';
                } else {
                    const isMarked = this.autoRerollHrids.has(item.hrid);
                    checkmark = isMarked ? '\u2713' : '';
                    checkColor = isMarked ? '#ef4444' : '#444';
                    nameColor = isMarked ? '#e0e0e0' : '#aaa';
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

            listContainer.querySelectorAll('[data-hrid]').forEach((row) => {
                row.addEventListener('click', async () => {
                    if (row.dataset.zone === '1') {
                        const monsters = zoneMonsters[row.dataset.hrid] || [];
                        const allMarked = monsters.every((m) => this.autoRerollHrids.has(m));
                        for (const m of monsters) {
                            if (allMarked) {
                                this.autoRerollHrids.delete(m);
                            } else {
                                this.autoRerollHrids.add(m);
                            }
                        }
                        await this._save();
                        this._processAllCards();
                    } else {
                        await this.toggleHrid(row.dataset.hrid);
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

        renderList('');
        searchInput.focus();

        popup.querySelector('#mwi-task-autoreroll-close').addEventListener('click', () => {
            popup.remove();
            backdrop.remove();
        });

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

        const cards = document.querySelectorAll('[class*="RandomTask_randomTask"]');
        for (const card of cards) {
            if (card.querySelector('.mwi-autoreroll-badge')) {
                card.style.removeProperty('outline');
                card.style.removeProperty('outline-offset');
                card.style.removeProperty('box-shadow');
                this._clearBadge(card);
            }
        }

        this.isInitialized = false;
    }
}

const taskAutoReroll = new TaskAutoReroll();

export default {
    name: t('Task Auto-Reroll Reminder'),
    initialize: async () => {
        await taskAutoReroll.initialize();
    },
    cleanup: () => {
        taskAutoReroll.disable();
    },
    disable: () => {
        taskAutoReroll.disable();
    },
};
