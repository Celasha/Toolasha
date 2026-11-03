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
import { createTimerRegistry } from '../../utils/timer-registry.js';
import performanceMonitor from '../../utils/performance-monitor.js';
import { formatLargeNumber, timeReadable } from '../../utils/formatters.js';
import { getAbilityName, getMonsterName } from '../../utils/game-i18n.js';
import {
    OTHER_KEY,
    TAPE_HEIGHT,
    TAPE_WIDTH,
    abilityColor,
    buildAbilityBar,
    buildPaceModel,
    buildTapeModel,
    drawHitTape,
} from './combat-live-chart.js';

const PANEL_ID = 'toolasha-combat-live';
const STORAGE_STORE = 'settings';
const POSITION_KEY = 'combatLive_position';
const COLLAPSED_KEY = 'combatLive_collapsed';
const TAB_KEY = 'combatLive_tab';
const SECTIONS_KEY = 'combatLive_collapsedSections';
const HIDDEN_COLUMNS_KEY = 'combatLive_hiddenColumns';
export const CHART_SECTION = 'damage.chart';
const REFRESH_MS = 500;
// Each party member's tape is shorter than the single one, so several fit
const PLAYER_TAPE_HEIGHT = 30;
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

const SOURCE_LABELS = {
    auto: () => t('combatLive.autoAttack'),
    reflect: () => t('combatLive.reflected'),
    'reflect-guess': () => t('combatLive.reflectedGuess'),
    'over-time': () => t('combatLive.overTime'),
};

/**
 * @param {string} key - Ability hrid or one of the special damage sources (auto, reflect, over-time)
 * @returns {string} Display name
 */
function sourceName(key) {
    const special = SOURCE_LABELS[key];
    if (special) return special();
    return key ? getAbilityName(key, prettyHrid(key)) : t('combatLive.unknownAbility');
}

const percent = (value) => `${Math.round(value * 100)}%`;

/**
 * @param {{hits: number, misses: number}} tally - Hits include the misses
 * @returns {string} Share of hits that landed, or a dash with nothing to measure
 */
const accuracy = ({ hits, misses }) => (hits > 0 ? percent((hits - misses) / hits) : '–');

/**
 * Leave out a column until some row has something to show in it, so a table starts narrow and grows as
 * data arrives (no DPS or kill time before the first kill, no death columns before the first death).
 * The first column names the row and always stays. Rows without `blank` flags count as having data.
 * @param {string[]} headers
 * @param {Array<{kind: string, cells: string[], blank?: boolean[]}>} rows
 * @param {string[]} [keys] - Stable column ids, pruned along with the headers
 * @returns {{headers: string[], rows: Array<{kind: string, cells: string[]}>, keys?: string[]}} Nothing at
 *     all when no data column is left, because a table of names alone says nothing
 */
export function pruneEmptyColumns(headers, rows, keys) {
    const keep = headers.map((_, index) => index === 0 || rows.some((row) => !row.blank?.[index]));
    if (!keep.some((kept, index) => index > 0 && kept)) return { headers: [], rows: [], keys: keys && [] };
    return {
        headers: headers.filter((_, index) => keep[index]),
        rows: rows.map((row) => ({ kind: row.kind, cells: row.cells.filter((_, index) => keep[index]) })),
        keys: keys?.filter((_, index) => keep[index]),
    };
}

/**
 * Build what a tab shows from a BattleStats summary.
 * @param {Object} summary - BattleStats.getSummary()
 * @param {string} tab - 'damage' | 'taken' | 'mana'
 * @param {{showPartyDamage?: boolean}} [options] - showPartyDamage: split damage per party member in a party
 * @returns {{stats: Array<[string, string]>, secondary: ?{title: string, headers: string[], rows: Array<{kind: string, cells: string[]}>}, headers: string[], rows: Array<{kind: string, cells: string[]}>, note: string}}
 */
export function buildTabModel(summary, tab, options = {}) {
    const { party, players, monsters } = summary;
    const model = { stats: [], secondary: null, headers: [], keys: [], rows: [], note: '', info: '' };

    if (tab === 'damage') {
        const solo = summary.attributionExact && summary.dealt.length > 0 ? summary.dealt[0] : null;
        const splitParty = Boolean(options.showPartyDamage) && !solo;
        model.stats = [
            [solo ? t('combatLive.dpsFor', { name: solo.name }) : t('combatLive.partyDps'), rate(party.dps)],
            [t('combatLive.trueDps'), rate(party.trueDps)],
            [t('combatLive.totalDamage'), number(party.damage)],
            [t('combatLive.hitsCritsMisses'), `${party.hits} / ${party.crits} / ${party.misses}`],
            [t('combatLive.kills'), String(party.kills)],
            [t('combatLive.time'), timeReadable(summary.seconds)],
        ];
        model.headers = [
            t('combatLive.colEnemy'),
            t('combatLive.colDamage'),
            t('combatLive.colDps'),
            t('combatLive.colKillTime'),
            t('combatLive.colKills'),
        ];
        model.keys = ['enemy', 'damage', 'dps', 'killTime', 'kills'];
        model.rows = monsters.map((monster) => ({
            kind: 'row',
            cells: [
                getMonsterName(monster.hrid, prettyHrid(monster.hrid)),
                number(monster.damage),
                monster.dps > 0 ? rate(monster.dps) : '–',
                Number.isFinite(monster.killTime)
                    ? t('combatLive.seconds', { value: monster.killTime.toFixed(1) })
                    : '–',
                String(monster.kills),
            ],
            blank: [
                false,
                !(monster.damage > 0),
                !(monster.dps > 0),
                !Number.isFinite(monster.killTime),
                !(monster.kills > 0),
            ],
        }));

        const abilityRows = (player) =>
            player.abilities.map((ability) => ({
                kind: 'ability',
                cells: [
                    sourceName(ability.key),
                    number(ability.damage),
                    rate(ability.dps),
                    percent(ability.share),
                    accuracy(ability),
                ],
            }));
        const damageHeaders = [
            t('combatLive.colAbility'),
            t('combatLive.colDamage'),
            t('combatLive.colDps'),
            t('combatLive.colShare'),
            t('combatLive.colAccuracy'),
        ];
        const damageKeys = ['ability', 'damage', 'dps', 'share', 'accuracy'];

        if (solo) {
            model.secondary = {
                title: t('combatLive.byAbilityTitle'),
                headers: damageHeaders,
                keys: damageKeys,
                rows: abilityRows(solo),
            };
        } else if (splitParty) {
            model.secondary = {
                title: t('combatLive.byPlayerTitle'),
                headers: damageHeaders,
                keys: damageKeys,
                rows: summary.dealt.flatMap((player) => [
                    {
                        kind: 'player',
                        cells: [
                            player.name || '?',
                            number(player.damage),
                            rate(player.dps),
                            party.damage > 0 ? percent(player.damage / party.damage) : '0%',
                            accuracy(player),
                        ],
                    },
                    ...abilityRows(player),
                ]),
            };
            model.stats.push([t('combatLive.unattributed'), percent(summary.unattributed.share)]);
        }

        // The standing explanation lives behind an info button; the note is only what changes with the data
        if (splitParty) {
            const { overTime, reflected, unclear } = summary.unattributed;
            model.info = t('combatLive.attributionNote');
            if (summary.unattributed.damage > 0) {
                model.note = t('combatLive.unattributedBreakdown', {
                    overTime: number(overTime),
                    reflected: number(reflected),
                    unclear: number(unclear),
                });
            }
        } else if (!solo) {
            model.info = t('combatLive.partyNote');
        }
    } else if (tab === 'taken') {
        model.headers = [
            t('combatLive.colPlayer'),
            t('combatLive.colTaken'),
            t('combatLive.colPerSecond'),
            t('combatLive.colHealed'),
            t('combatLive.colDeaths'),
            t('combatLive.colDeathsPerHour'),
        ];
        model.keys = ['player', 'taken', 'perSecond', 'healed', 'deaths', 'deathsPerHour'];
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
            blank: [
                false,
                !(player.damage > 0),
                !(player.damageTakenPerSecond > 0),
                !(player.healed > 0),
                !(player.deaths > 0),
                !(player.deathsPerHour > 0),
            ],
        }));
    } else {
        model.headers = [
            t('combatLive.colAbility'),
            t('combatLive.colSpent'),
            t('combatLive.colGained'),
            t('combatLive.colPerSecond'),
            t('combatLive.colRefused'),
        ];
        model.keys = ['ability', 'spent', 'gained', 'perSecond', 'refused'];
        model.info = t('combatLive.refusedInfo');
        for (const player of players) {
            model.rows.push({
                kind: 'player',
                cells: [
                    player.name || '?',
                    number(player.manaSpent),
                    number(player.manaGained),
                    rate(player.manaSpentPerSecond),
                    player.refusedCasts > 0 ? number(player.refusedCasts) : '',
                ],
                blank: [false, false, false, false, !(player.refusedCasts > 0)],
            });
            for (const ability of player.abilityMana) {
                model.rows.push({
                    kind: 'ability',
                    cells: [
                        ability.abilityHrid
                            ? getAbilityName(ability.abilityHrid, prettyHrid(ability.abilityHrid))
                            : t('combatLive.unknownAbility'),
                        number(ability.mana),
                        // Mana gained is not tracked per ability
                        '',
                        rate(ability.perSecond),
                        ability.refused > 0 ? number(ability.refused) : '',
                    ],
                    blank: [false, false, false, false, !(ability.refused > 0)],
                });
            }
        }
    }

    ({
        headers: model.headers,
        rows: model.rows,
        keys: model.keys,
    } = pruneEmptyColumns(model.headers, model.rows, model.keys));
    return model;
}

class CombatLiveUI {
    constructor() {
        this.timerRegistry = createTimerRegistry();
        this.panel = null;
        this.deps = null;
        this.tab = 'damage';
        this.collapsed = false;
        // Sections the user folded away, as `<tab>.<section>` ids (the chart is 'damage.chart')
        this.collapsedSections = new Set();
        // Columns the user hid, as `<tab>.<section>.<column>` ids, and which column pickers are open
        this.hiddenColumns = new Set();
        this.openPickers = new Set();
        this.openInfo = new Set();
        this.lastSignature = '';
        this.elements = {};
    }

    async initialize(deps) {
        if (this.panel) return;
        this.deps = deps;

        this.tab = await storage.get(TAB_KEY, STORAGE_STORE, 'damage');
        if (!TABS.includes(this.tab)) this.tab = 'damage';
        this.collapsed = Boolean(await storage.get(COLLAPSED_KEY, STORAGE_STORE, false));
        const savedSections = await storage.get(SECTIONS_KEY, STORAGE_STORE, []);
        this.collapsedSections = new Set(Array.isArray(savedSections) ? savedSections : []);
        const savedColumns = await storage.get(HIDDEN_COLUMNS_KEY, STORAGE_STORE, []);
        this.hiddenColumns = new Set(Array.isArray(savedColumns) ? savedColumns : []);
        // cleanup() may have run while the saved state was loading
        if (!this.deps) return;

        this.buildPanel();
        const savedPosition = await storage.get(POSITION_KEY, STORAGE_STORE, null);
        if (this.panel && savedPosition) this.applyPosition(savedPosition.left, savedPosition.top);

        this.timerRegistry.registerInterval(
            setInterval(
                performanceMonitor.wrap('combatLive:refresh', () => this.refresh()),
                REFRESH_MS
            )
        );
    }

    buildPanel() {
        // A live meter, not a window: it sits above the game's page but under every game popup and modal
        // (those run from 200 up), and under the toolasha floating panels, so it is not registered for
        // bring-to-front, which would lift it to their layer.
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed; top: 120px; right: 20px; z-index: ${config.Z_HUD};
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

        const chart = this.buildChartBlock();

        const body = document.createElement('div');
        body.style.cssText = 'overflow-y:auto; padding:6px 10px;';

        panel.append(header, tabBar, chart.block, body);
        document.body.appendChild(panel);
        this.setupDrag(header, panel);

        this.panel = panel;
        this.elements = { summary, copyButton, collapseButton, tabBar, tabButtons, body, chart };
        this.applyChrome();
    }

    /**
     * The DPS visual: pace line, hit tape, damage-by-ability bar and its legend. Built once and updated
     * in place, because the tape moves every tick.
     * @returns {Object} The block and the parts that get updated
     */
    buildChartBlock() {
        const block = document.createElement('div');
        block.style.cssText = 'display:none; padding:6px 10px 0;';

        const paceLine = document.createElement('div');
        paceLine.style.cssText =
            'display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;';
        const paceNow = this.textEl('span', '', 'font-weight:700; font-size:13px;');
        const paceTrend = this.textEl('span', '', 'font-weight:600;');
        const paceBest = this.textEl('span', '', 'color:#888;');
        paceLine.append(paceNow, paceTrend, paceBest);

        const canvas = document.createElement('canvas');
        canvas.style.cssText = `display:block; width:${TAPE_WIDTH}px; max-width:100%; height:${TAPE_HEIGHT}px;`;
        canvas.title = t('combatLive.tapeTooltip');

        const abilityBar = document.createElement('div');
        abilityBar.style.cssText =
            'display:flex; height:8px; margin-top:4px; border-radius:2px; overflow:hidden; background:rgba(255,255,255,0.06);';
        const legend = this.textEl(
            'div',
            '',
            'margin-top:3px; color:#9aa4b2; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;'
        );

        const content = document.createElement('div');
        // Alone (or with per-player damage off) one chart follows you; in a party each member gets their own
        const single = document.createElement('div');
        single.append(paceLine, canvas, abilityBar, legend);
        const players = document.createElement('div');
        players.style.display = 'none';
        content.append(single, players);
        const header = this.sectionHeader(CHART_SECTION, t('combatLive.sectionChart'));
        block.append(header, content);
        return {
            block,
            header,
            content,
            paceNow,
            paceTrend,
            paceBest,
            canvas,
            abilityBar,
            legend,
            single,
            players,
            playerBlocks: new Map(),
            playerOrder: '',
            barSignature: '',
        };
    }

    /**
     * A clickable section title with a fold arrow.
     * @param {string} id - Section id (`<tab>.<section>`)
     * @param {string} title
     * @returns {HTMLElement}
     */
    sectionHeader(id, title) {
        const header = document.createElement('div');
        header.setAttribute('role', 'button');
        header.tabIndex = 0;
        header.dataset.section = id;
        header.style.cssText =
            'display:flex; align-items:center; gap:6px; margin-top:6px; padding:2px 0; cursor:pointer; user-select:none; font-weight:700; color:#00c896;';
        header.append(
            this.textEl('span', '', 'color:#888; width:10px; font-size:11px;'),
            this.textEl('span', title, '')
        );
        const toggle = () => this.toggleSection(id);
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', (event) => {
            if (event.target === header && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                toggle();
            }
        });
        this.applySectionState(header, this.collapsedSections.has(id));
        return header;
    }

    applySectionState(header, collapsed) {
        header.firstChild.textContent = collapsed ? '▸' : '▾';
        header.setAttribute('aria-expanded', String(!collapsed));
    }

    toggleSection(id) {
        if (this.collapsedSections.has(id)) this.collapsedSections.delete(id);
        else this.collapsedSections.add(id);
        storage.set(SECTIONS_KEY, [...this.collapsedSections], STORAGE_STORE);

        if (id === CHART_SECTION) {
            const chart = this.elements.chart;
            const collapsed = this.collapsedSections.has(id);
            this.applySectionState(chart.header, collapsed);
            chart.content.style.display = collapsed ? 'none' : 'block';
        }
        // Re-render the tab on the next refresh, and redraw the chart now that it is showing again
        this.lastSignature = '';
        this.refresh();
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
        this.updateChart(summary);
        if (this.collapsed) return;

        const model = buildTabModel(summary, this.tab, {
            showPartyDamage: Boolean(config.getSetting('combatLive_estimateParty')),
        });
        const signature = JSON.stringify([this.tab, model]);
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.renderModel(model);
    }

    /**
     * Redraw the DPS visual, or hide it when it does not apply (other tab, collapsed, setting off, or
     * no player to follow).
     * @param {Object} summary - BattleStats.getSummary()
     */
    updateChart(summary) {
        const chart = this.elements.chart;
        const partyCharts = this.partyCharts(summary);
        const visible =
            this.tab === 'damage' &&
            !this.collapsed &&
            config.getSetting('combatLive_showChart') !== false &&
            Boolean(summary.chart || partyCharts);
        chart.block.style.display = visible ? 'block' : 'none';
        if (!visible) return;
        const folded = this.collapsedSections.has(CHART_SECTION);
        chart.content.style.display = folded ? 'none' : 'block';
        if (folded) return;

        chart.single.style.display = partyCharts ? 'none' : 'block';
        chart.players.style.display = partyCharts ? 'block' : 'none';

        const label = (key) => (key === OTHER_KEY ? t('combatLive.otherAbilities') : sourceName(key));
        const segmentEls = (segments) =>
            segments.map((segment) => {
                const part = document.createElement('div');
                part.style.cssText = `flex:${segment.share} 1 0; background:${abilityColor(segment.key)};`;
                part.title = `${label(segment.key)} ${percent(segment.share)}`;
                return part;
            });
        if (partyCharts) {
            this.updateChartPlayers(partyCharts, summary, segmentEls);
            return;
        }

        const data = summary.chart;
        const pace = buildPaceModel(data);
        const trendColor = { up: '#4ade80', down: '#f87171', flat: '#9aa4b2' }[pace.direction];
        chart.paceNow.textContent = t('combatLive.dpsNow', { dps: rate(data.currentDps) });
        chart.paceTrend.textContent = t('combatLive.paceVsAverage', { arrow: pace.arrow, percent: pace.percent });
        chart.paceTrend.style.color = trendColor;
        chart.paceBest.textContent = data.bestDps > 0 ? t('combatLive.bestDps', { dps: rate(data.bestDps) }) : '';

        drawHitTape(chart.canvas, buildTapeModel(data.hits, data.now));

        const player = summary.dealt.find((row) => row.name === data.player);
        const segments = buildAbilityBar(player?.abilities || []);
        const signature = JSON.stringify(segments);
        if (signature === chart.barSignature) return;
        chart.barSignature = signature;

        chart.abilityBar.replaceChildren(...segmentEls(segments));
        chart.legend.textContent = segments
            .filter((segment) => segment.key !== OTHER_KEY)
            .slice(0, 3)
            .map((segment) => `${label(segment.key)} ${percent(segment.share)}`)
            .join(' · ');
    }

    /**
     * @param {Object} summary - BattleStats.getSummary()
     * @returns {?Object[]} One chart per party member (you first) when each should get their own, else null
     */
    partyCharts(summary) {
        const charts = summary.charts || [];
        const wanted = !summary.attributionExact && Boolean(config.getSetting('combatLive_estimateParty'));
        return wanted && charts.length > 1 ? charts : null;
    }

    /**
     * Build the pieces of one party member's chart: a foldable title with their pace, a tape and an
     * ability bar.
     * @param {string} name
     * @returns {Object}
     */
    buildPlayerChart(name) {
        const id = `${CHART_SECTION}.player.${name}`;
        const wrap = document.createElement('div');
        const header = this.sectionHeader(id, name);
        const pace = this.textEl('span', '', 'margin-left:auto; font-weight:600; font-size:11px;');
        header.append(pace);
        const content = document.createElement('div');
        const canvas = document.createElement('canvas');
        canvas.style.cssText = `display:block; width:${TAPE_WIDTH}px; max-width:100%; height:${PLAYER_TAPE_HEIGHT}px;`;
        canvas.title = t('combatLive.tapeTooltip');
        const bar = document.createElement('div');
        bar.style.cssText =
            'display:flex; height:6px; margin-top:3px; border-radius:2px; overflow:hidden; background:rgba(255,255,255,0.06);';
        content.append(canvas, bar);
        wrap.append(header, content);
        return { id, wrap, header, pace, content, canvas, bar, barSignature: '' };
    }

    /**
     * In a party, one chart per member. Blocks are built when the party changes and updated in place.
     * @param {Object[]} charts - summary.charts
     * @param {Object} summary - BattleStats.getSummary()
     * @param {function(Object[]): HTMLElement[]} segmentEls - Builds the coloured bar parts
     */
    updateChartPlayers(charts, summary, segmentEls) {
        const chart = this.elements.chart;
        const order = JSON.stringify(charts.map((data) => data.player));
        if (order !== chart.playerOrder) {
            chart.playerOrder = order;
            chart.playerBlocks = new Map(charts.map((data) => [data.player, this.buildPlayerChart(data.player)]));
            chart.players.replaceChildren(...[...chart.playerBlocks.values()].map((block) => block.wrap));
        }

        for (const data of charts) {
            const block = chart.playerBlocks.get(data.player);
            const folded = this.collapsedSections.has(block.id);
            this.applySectionState(block.header, folded);
            block.content.style.display = folded ? 'none' : 'block';

            const pace = buildPaceModel(data);
            block.pace.textContent = `${t('combatLive.dpsNow', { dps: rate(data.currentDps) })} ${pace.arrow} ${pace.percent}%`;
            block.pace.style.color = { up: '#4ade80', down: '#f87171', flat: '#9aa4b2' }[pace.direction];
            if (folded) continue;

            drawHitTape(block.canvas, buildTapeModel(data.hits, data.now), TAPE_WIDTH, PLAYER_TAPE_HEIGHT);
            const player = summary.dealt.find((row) => row.name === data.player);
            const segments = buildAbilityBar(player?.abilities || []);
            const signature = JSON.stringify(segments);
            if (signature === block.barSignature) continue;
            block.barSignature = signature;
            block.bar.replaceChildren(...segmentEls(segments));
        }
    }

    buildTable(headers, rows, keys, sectionId) {
        const shown = headers.map((_, index) => index === 0 || !this.hiddenColumns.has(`${sectionId}.${keys[index]}`));
        const visible = (cells) => cells.filter((_, index) => shown[index]);
        const shownHeaders = visible(headers);

        const table = document.createElement('div');
        table.style.cssText = 'margin-bottom:6px;';
        const columns = `grid-template-columns: 1.6fr repeat(${shownHeaders.length - 1}, 1fr);`;
        const headerRow = document.createElement('div');
        headerRow.style.cssText = `display:grid; ${columns} gap:4px; color:#888; font-size:11px; border-bottom:1px solid #222;`;
        shownHeaders.forEach((heading, index) =>
            headerRow.appendChild(this.textEl('span', heading, index ? 'text-align:right;' : ''))
        );
        table.appendChild(headerRow);

        let foldedPlayer = false;
        rows.forEach((row, rowIndex) => {
            if (row.kind === 'ability' && foldedPlayer) return;
            const hasAbilities = row.kind === 'player' && rows[rowIndex + 1]?.kind === 'ability';
            const foldId = `${sectionId}.player.${row.cells[0]}`;
            if (row.kind === 'player') foldedPlayer = hasAbilities && this.collapsedSections.has(foldId);

            const rowEl = document.createElement('div');
            const weight = row.kind === 'player' ? 'font-weight:700; color:#00c896;' : '';
            const indent = row.kind === 'ability' ? 'padding-left:10px; color:#bbb;' : '';
            rowEl.style.cssText = `display:grid; ${columns} gap:4px; padding:1px 0; ${weight}`;
            visible(row.cells).forEach((cell, index) => {
                const label = index === 0 && hasAbilities ? `${foldedPlayer ? '▸' : '▾'} ${cell}` : cell;
                rowEl.appendChild(this.textEl('span', label, index ? 'text-align:right;' : indent));
            });
            if (hasAbilities) {
                rowEl.style.cursor = 'pointer';
                rowEl.title = t('combatLive.playerFoldTooltip');
                rowEl.addEventListener('click', () => this.toggleSection(foldId));
            }
            table.appendChild(rowEl);
        });
        return table;
    }

    toggleColumn(id) {
        if (this.hiddenColumns.has(id)) this.hiddenColumns.delete(id);
        else this.hiddenColumns.add(id);
        storage.set(HIDDEN_COLUMNS_KEY, [...this.hiddenColumns], STORAGE_STORE);
        this.lastSignature = '';
        this.refresh();
    }

    togglePicker(sectionId) {
        if (this.openPickers.has(sectionId)) this.openPickers.delete(sectionId);
        else this.openPickers.add(sectionId);
        this.lastSignature = '';
        this.refresh();
    }

    toggleInfo(sectionId) {
        if (this.openInfo.has(sectionId)) this.openInfo.delete(sectionId);
        else this.openInfo.add(sectionId);
        this.lastSignature = '';
        this.refresh();
    }

    /**
     * The button that opens a table's column picker, and the picker itself: one chip per column.
     * @param {string} sectionId
     * @param {{headers: string[], keys: string[]}} table
     * @returns {{button: HTMLElement, picker: ?HTMLElement}}
     */
    buildColumnPicker(sectionId, table) {
        const button = this.buttonEl('▦', t('combatLive.columnsTooltip'), () => this.togglePicker(sectionId));
        button.style.fontSize = '12px';
        if (!this.openPickers.has(sectionId)) return { button, picker: null };

        const picker = document.createElement('div');
        picker.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; margin:2px 0 4px;';
        table.headers.forEach((heading, index) => {
            if (index === 0) return;
            const id = `${sectionId}.${table.keys[index]}`;
            const hidden = this.hiddenColumns.has(id);
            const chip = this.textEl(
                'button',
                `${hidden ? '' : '✓ '}${heading}`,
                `cursor:pointer; font-size:11px; padding:1px 6px; border-radius:9px; background:none; border:1px solid ${
                    hidden ? '#444' : '#00c896'
                }; color:${hidden ? '#777' : '#00c896'};`
            );
            chip.addEventListener('click', () => this.toggleColumn(id));
            picker.appendChild(chip);
        });
        return { button, picker };
    }

    /**
     * Wrap one part of a tab in a section the user can fold away. Only an open section builds its
     * content.
     * @param {string} id - Section id (`<tab>.<section>`)
     * @param {string} title
     * @param {function(): HTMLElement} buildContent
     * @param {?HTMLElement} note - A footnote that belongs with this section
     * @param {?{headers: string[], keys: string[]}} table - Set when the section is a table, which adds a
     *     column picker
     * @param {string} [info] - Standing explanation, opened by an info button in the title
     * @returns {HTMLElement}
     */
    buildSection(id, title, buildContent, note, table, info) {
        const wrap = document.createElement('div');
        const header = this.sectionHeader(id, title);
        const folded = this.collapsedSections.has(id);
        const { button, picker } = table && !folded ? this.buildColumnPicker(id, table) : {};
        const infoButton =
            info && !folded ? this.buttonEl('ⓘ', t('combatLive.infoTooltip'), () => this.toggleInfo(id)) : null;
        const actions = [infoButton, button].filter(Boolean);
        if (actions.length) {
            const group = this.textEl('span', '', 'margin-left:auto; display:flex; gap:4px;');
            group.append(...actions);
            header.append(group);
        }
        wrap.append(header);
        if (!folded) {
            if (info && this.openInfo.has(id)) {
                wrap.append(this.textEl('div', info, 'margin:2px 0 4px; color:#9aa4b2; font-size:11px;'));
            }
            if (picker) wrap.append(picker);
            wrap.append(buildContent());
            if (note) wrap.append(note);
        }
        return wrap;
    }

    renderModel(model) {
        const sections = [];
        const hasSecondary = Boolean(model.secondary?.rows.length);
        // The footnote travels with the part it explains
        const noteHome = hasSecondary ? 'secondary' : model.stats.length ? 'totals' : 'main';
        const infoFor = (home) => (noteHome === home ? model.info : '');
        const noteFor = (home) =>
            model.note && noteHome === home
                ? this.textEl('div', model.note, 'margin-top:6px; color:#777; font-size:11px;')
                : null;
        const mainTitle = {
            damage: t('combatLive.sectionEnemies'),
            taken: t('combatLive.tab_taken'),
            mana: t('combatLive.tab_mana'),
        }[this.tab];

        if (model.stats.length) {
            sections.push(
                this.buildSection(
                    `${this.tab}.totals`,
                    t('combatLive.sectionTotals'),
                    () => {
                        const list = document.createElement('div');
                        list.style.cssText =
                            'display:grid; grid-template-columns:1fr auto; gap:2px 12px; margin-bottom:6px;';
                        for (const [label, value] of model.stats) {
                            list.appendChild(this.textEl('span', label, 'color:#888;'));
                            list.appendChild(this.textEl('span', value, 'text-align:right; font-weight:600;'));
                        }
                        return list;
                    },
                    noteFor('totals'),
                    null,
                    infoFor('totals')
                )
            );
        }
        if (hasSecondary) {
            sections.push(
                this.buildSection(
                    `${this.tab}.secondary`,
                    model.secondary.title,
                    () =>
                        this.buildTable(
                            model.secondary.headers,
                            model.secondary.rows,
                            model.secondary.keys,
                            `${this.tab}.secondary`
                        ),
                    noteFor('secondary'),
                    model.secondary,
                    infoFor('secondary')
                )
            );
        }
        if (model.rows.length) {
            sections.push(
                this.buildSection(
                    `${this.tab}.main`,
                    mainTitle,
                    () => this.buildTable(model.headers, model.rows, model.keys, `${this.tab}.main`),
                    noteFor('main'),
                    model,
                    infoFor('main')
                )
            );
        }

        this.elements.body.replaceChildren(...sections);
    }

    cleanup() {
        this.timerRegistry.clearAll();
        if (this.panel) {
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
