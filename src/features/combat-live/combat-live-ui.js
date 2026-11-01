/**
 * Combat Live UI
 *
 * One draggable floating panel with three tabs (Damage, Damage taken, Mana). The display logic is a
 * pure model builder (`buildTabModel`) so it can be tested without a DOM; the panel only turns that
 * model into elements. Text is always set with textContent: player and monster names come from the
 * game and are never interpolated into HTML.
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import { t } from '../../core/i18n.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { formatLargeNumber, timeReadable } from '../../utils/formatters.js';
import { getAbilityName, getMonsterName } from '../../utils/game-i18n.js';

const PANEL_ID = 'toolasha-combat-live';
const STORAGE_STORE = 'settings';
const POSITION_KEY = 'combatLive_position';
const COLLAPSED_KEY = 'combatLive_collapsed';
const TAB_KEY = 'combatLive_tab';
const REFRESH_MS = 500;
// The panel hides when no combat message has arrived for this long
const IDLE_HIDE_MS = 60000;

export const TABS = ['damage', 'taken', 'mana'];

const number = (value) => formatLargeNumber(Math.round(value));
const rate = (value) => formatLargeNumber(value, 1);

function prettyHrid(hrid) {
    return String(hrid || '')
        .split('/')
        .pop()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Build what a tab shows from a BattleStats summary.
 * @param {Object} summary - BattleStats.getSummary()
 * @param {string} tab - 'damage' | 'taken' | 'mana'
 * @param {{estimateParty?: boolean}} [options] - estimateParty: show the per-player damage estimate in a party
 * @returns {{stats: Array<[string, string]>, secondary: ?{title: string, headers: string[], rows: Array<{kind: string, cells: string[]}>}, headers: string[], rows: Array<{kind: string, cells: string[]}>, note: string}}
 */
export function buildTabModel(summary, tab, options = {}) {
    const { party, players, monsters } = summary;
    const model = { stats: [], secondary: null, headers: [], rows: [], note: '' };

    if (tab === 'damage') {
        const solo = summary.attributionExact && summary.dealt.length > 0 ? summary.dealt[0].name : null;
        const estimating = Boolean(options.estimateParty) && !summary.attributionExact;
        model.stats = [
            [solo ? t('combatLive.dpsFor', { name: solo }) : t('combatLive.partyDps'), rate(party.dps)],
            [t('combatLive.trueDps'), rate(party.trueDps)],
            [t('combatLive.totalDamage'), number(party.damage)],
            [t('combatLive.hitsCritsMisses'), `${party.hits} / ${party.crits} / ${party.misses}`],
            [t('combatLive.kills'), String(party.kills)],
            [t('combatLive.time'), timeReadable(summary.seconds)],
        ];
        model.headers = [t('combatLive.colEnemy'), t('combatLive.colDamage'), t('combatLive.colKills')];
        model.rows = monsters.map((monster) => ({
            kind: 'row',
            cells: [
                getMonsterName(monster.hrid, prettyHrid(monster.hrid)),
                number(monster.damage),
                String(monster.kills),
            ],
        }));
        if (estimating) {
            const share = (value) => `${Math.round(value * 100)}%`;
            model.stats.push([t('combatLive.unattributed'), share(summary.unattributed.share)]);
            model.secondary = {
                title: t('combatLive.estimateTitle'),
                headers: [
                    t('combatLive.colPlayer'),
                    t('combatLive.colDamage'),
                    t('combatLive.colDps'),
                    t('combatLive.colShare'),
                ],
                rows: summary.dealt.map((player) => ({
                    kind: 'row',
                    cells: [
                        player.name || '?',
                        `~${number(player.damage)}`,
                        `~${rate(player.dps)}`,
                        party.damage > 0 ? `~${share(player.damage / party.damage)}` : '~0%',
                    ],
                })),
            };
        }
        model.note = solo ? '' : estimating ? t('combatLive.estimateNote') : t('combatLive.partyNote');
    } else if (tab === 'taken') {
        model.headers = [
            t('combatLive.colPlayer'),
            t('combatLive.colTaken'),
            t('combatLive.colPerSecond'),
            t('combatLive.colHealed'),
            t('combatLive.colDeaths'),
            t('combatLive.colDeathsPerHour'),
        ];
        model.rows = players.map((player) => ({
            kind: 'row',
            cells: [
                player.name || '?',
                number(player.damage),
                rate(player.damageTakenPerSecond),
                number(player.healed),
                String(player.deaths),
                rate(player.deathsPerHour),
            ],
        }));
    } else {
        model.headers = [t('combatLive.colAbility'), t('combatLive.colMana'), t('combatLive.colPerSecond')];
        for (const player of players) {
            model.rows.push({
                kind: 'player',
                cells: [
                    player.name || '?',
                    t('combatLive.manaSpentGained', {
                        spent: number(player.manaSpent),
                        gained: number(player.manaGained),
                    }),
                    rate(player.manaSpentPerSecond),
                ],
            });
            for (const ability of player.abilityMana) {
                model.rows.push({
                    kind: 'ability',
                    cells: [
                        ability.abilityHrid
                            ? getAbilityName(ability.abilityHrid, prettyHrid(ability.abilityHrid))
                            : t('combatLive.noAbility'),
                        number(ability.mana),
                        rate(ability.perSecond),
                    ],
                });
            }
        }
    }

    return model;
}

class CombatLiveUI {
    constructor() {
        this.timerRegistry = createTimerRegistry();
        this.panel = null;
        this.deps = null;
        this.tab = 'damage';
        this.collapsed = false;
        this.lastSignature = '';
        this.elements = {};
    }

    async initialize(deps) {
        if (this.panel) return;
        this.deps = deps;

        this.tab = await storage.get(TAB_KEY, STORAGE_STORE, 'damage');
        if (!TABS.includes(this.tab)) this.tab = 'damage';
        this.collapsed = Boolean(await storage.get(COLLAPSED_KEY, STORAGE_STORE, false));
        // cleanup() may have run while the saved state was loading
        if (!this.deps) return;

        this.buildPanel();
        const savedPosition = await storage.get(POSITION_KEY, STORAGE_STORE, null);
        if (this.panel && savedPosition) this.applyPosition(savedPosition.left, savedPosition.top);

        this.timerRegistry.registerInterval(setInterval(() => this.refresh(), REFRESH_MS));
    }

    buildPanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed; top: 120px; right: 20px; z-index: ${config.Z_FLOATING_PANEL};
            display: none; flex-direction: column; width: 320px; max-height: 70vh;
            background: rgba(10, 10, 20, 0.95); border: 1px solid rgba(0, 200, 150, 0.45);
            border-radius: 8px; color: #e0e0e0; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.55);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: grab;
            background: rgba(0, 200, 150, 0.12); border-radius: 7px 7px 0 0; user-select: none;
        `;
        const title = this.textEl('span', t('combatLive.panelTitle'), 'font-weight:700; color:#00c896;');
        const summary = this.textEl('span', '', 'margin-left:auto; color:#aaa;');
        const resetButton = this.buttonEl('↺', t('combatLive.resetTooltip'), () => {
            this.deps.onReset();
            this.lastSignature = '';
            this.refresh();
        });
        const copyButton = this.buttonEl('⧉', t('combatLive.copyRecordingTooltip'), () => this.copyRecording());
        copyButton.style.display = 'none';
        const collapseButton = this.buttonEl('', t('combatLive.collapseTooltip'), () => this.toggleCollapsed());
        header.append(title, summary, copyButton, resetButton, collapseButton);

        const tabBar = document.createElement('div');
        tabBar.style.cssText = 'display:flex; border-bottom:1px solid #222;';
        const tabButtons = {};
        for (const tab of TABS) {
            const button = this.textEl('button', t(`combatLive.tab_${tab}`), '');
            button.addEventListener('click', () => this.selectTab(tab));
            tabButtons[tab] = button;
            tabBar.appendChild(button);
        }

        const body = document.createElement('div');
        body.style.cssText = 'overflow-y:auto; padding:6px 10px;';

        panel.append(header, tabBar, body);
        document.body.appendChild(panel);
        registerFloatingPanel(panel);
        panel.addEventListener('mousedown', () => bringPanelToFront(panel));
        this.setupDrag(header, panel);

        this.panel = panel;
        this.elements = { summary, copyButton, collapseButton, tabBar, tabButtons, body };
        this.applyChrome();
    }

    textEl(tag, text, css) {
        const element = document.createElement(tag);
        element.textContent = text;
        if (css) element.style.cssText = css;
        return element;
    }

    buttonEl(label, tooltip, onClick) {
        const button = this.textEl(
            'button',
            label,
            'background:none; border:none; color:#aaa; cursor:pointer; font-size:14px; padding:0 2px;'
        );
        button.title = tooltip;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick();
        });
        button.addEventListener('mousedown', (event) => event.stopPropagation());
        return button;
    }

    async copyRecording() {
        const recording = this.deps?.getRecording();
        if (!recording) return;
        const button = this.elements.copyButton;
        try {
            await navigator.clipboard.writeText(recording);
            button.textContent = '✓';
        } catch (error) {
            console.error('[CombatLive] Failed to copy recording:', error);
            button.textContent = '✗';
        }
        this.timerRegistry.registerTimeout(
            setTimeout(() => {
                button.textContent = '⧉';
            }, 1500)
        );
    }

    selectTab(tab) {
        this.tab = tab;
        storage.set(TAB_KEY, tab, STORAGE_STORE);
        this.lastSignature = '';
        this.applyChrome();
        this.refresh();
    }

    toggleCollapsed() {
        this.collapsed = !this.collapsed;
        storage.set(COLLAPSED_KEY, this.collapsed, STORAGE_STORE);
        this.applyChrome();
        this.refresh();
    }

    applyChrome() {
        const { collapseButton, tabBar, tabButtons, body } = this.elements;
        collapseButton.textContent = this.collapsed ? '▸' : '▾';
        tabBar.style.display = this.collapsed ? 'none' : 'flex';
        body.style.display = this.collapsed ? 'none' : 'block';
        for (const tab of TABS) {
            const active = tab === this.tab;
            tabButtons[tab].style.cssText = `
                flex:1; padding:5px 0; cursor:pointer; background:none; border:none;
                border-bottom:2px solid ${active ? '#00c896' : 'transparent'};
                color:${active ? '#00c896' : '#888'}; font-size:12px; font-weight:600;
            `;
        }
    }

    setupDrag(header, panel) {
        header.addEventListener('mousedown', (event) => {
            const rect = panel.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            header.style.cursor = 'grabbing';

            const onMove = (moveEvent) => this.applyPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
            const onUp = () => {
                header.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const finalRect = panel.getBoundingClientRect();
                storage.set(POSITION_KEY, { left: finalRect.left, top: finalRect.top }, STORAGE_STORE);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /**
     * Place the panel, keeping its header inside the window.
     * @param {number} left
     * @param {number} top
     */
    applyPosition(left, top) {
        if (!this.panel) return;
        const maxLeft = Math.max(0, window.innerWidth - 80);
        const maxTop = Math.max(0, window.innerHeight - 40);
        this.panel.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
        this.panel.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
        this.panel.style.right = 'auto';
    }

    refresh() {
        if (!this.panel || !this.deps) return;

        const lastMessageAt = this.deps.getLastMessageAt();
        const active = lastMessageAt > 0 && Date.now() - lastMessageAt <= IDLE_HIDE_MS;
        this.panel.style.display = active ? 'flex' : 'none';
        if (!active || document.hidden) return;

        this.elements.copyButton.style.display = this.deps.isRecording() ? '' : 'none';
        const summary = this.deps.getSummary();
        this.elements.summary.textContent = t('combatLive.headerSummary', { dps: rate(summary.party.dps) });
        if (this.collapsed) return;

        const model = buildTabModel(summary, this.tab, {
            estimateParty: Boolean(config.getSetting('combatLive_estimateParty')),
        });
        const signature = JSON.stringify([this.tab, model]);
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.renderModel(model);
    }

    buildTable(headers, rows) {
        const table = document.createElement('div');
        table.style.cssText = 'margin-bottom:6px;';
        const columns = `grid-template-columns: 1.6fr repeat(${headers.length - 1}, 1fr);`;
        const headerRow = document.createElement('div');
        headerRow.style.cssText = `display:grid; ${columns} gap:4px; color:#888; font-size:11px; border-bottom:1px solid #222;`;
        headers.forEach((heading, index) =>
            headerRow.appendChild(this.textEl('span', heading, index ? 'text-align:right;' : ''))
        );
        table.appendChild(headerRow);

        for (const row of rows) {
            const rowEl = document.createElement('div');
            const weight = row.kind === 'player' ? 'font-weight:700; color:#00c896;' : '';
            const indent = row.kind === 'ability' ? 'padding-left:10px; color:#bbb;' : '';
            rowEl.style.cssText = `display:grid; ${columns} gap:4px; padding:1px 0; ${weight}`;
            row.cells.forEach((cell, index) =>
                rowEl.appendChild(this.textEl('span', cell, index ? 'text-align:right;' : indent))
            );
            table.appendChild(rowEl);
        }
        return table;
    }

    renderModel(model) {
        const children = [];

        if (model.stats.length) {
            const list = document.createElement('div');
            list.style.cssText = 'display:grid; grid-template-columns:1fr auto; gap:2px 12px; margin-bottom:6px;';
            for (const [label, value] of model.stats) {
                list.appendChild(this.textEl('span', label, 'color:#888;'));
                list.appendChild(this.textEl('span', value, 'text-align:right; font-weight:600;'));
            }
            children.push(list);
        }

        if (model.secondary?.rows.length) {
            children.push(this.textEl('div', model.secondary.title, 'font-weight:700; color:#00c896; margin-top:4px;'));
            children.push(this.buildTable(model.secondary.headers, model.secondary.rows));
        }
        if (model.rows.length) {
            children.push(this.buildTable(model.headers, model.rows));
        }

        if (model.note) {
            children.push(this.textEl('div', model.note, 'margin-top:6px; color:#777; font-size:11px;'));
        }

        this.elements.body.replaceChildren(...children);
    }

    cleanup() {
        this.timerRegistry.clearAll();
        if (this.panel) {
            unregisterFloatingPanel(this.panel);
            this.panel.remove();
        }
        this.panel = null;
        this.deps = null;
        this.elements = {};
        this.lastSignature = '';
    }
}

const combatLiveUI = new CombatLiveUI();
export default combatLiveUI;
