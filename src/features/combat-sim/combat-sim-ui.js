/**
 * Combat Simulator UI
 * Floating panel for configuring and running combat simulations.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import { formatWithSeparator, formatKMB } from '../../utils/formatters.js';
import {
    buildGameDataPayload,
    buildAllPlayerDTOs,
    getCombatZones,
    getCurrentCombatZone,
    getCommunityBuffs,
    calculateExpectedDrops,
    calculateDungeonKeyCosts,
    calculateSimRevenue,
    getZonesThatDropItem,
} from './combat-sim-adapter.js';
import { runSimulation, cancelSimulation } from './combat-sim-runner.js';
import { runAllZonesSimulation, cancelAllZonesSimulation } from './all-zones-runner.js';
import { runUpgradeAnalysis } from './upgrade-advisor.js';
import { SimEditor } from './sim-editor.js';
import { t } from '../../core/i18n.js';

const PANEL_ID = 'mwi-combat-sim-panel';
const ACCENT = '#4a9eff';
const ACCENT_BORDER = 'rgba(74, 158, 255, 0.5)';
const ACCENT_BG = 'rgba(74, 158, 255, 0.12)';
const ACCENT_BTN_BG = 'rgba(74, 158, 255, 0.2)';
const ACCENT_BTN_BORDER = 'rgba(74, 158, 255, 0.4)';

/**
 * Format elapsed seconds as "Xs" or "Xm Ys".
 * @param {number} seconds
 * @returns {string}
 */
function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(0);
    return `${m}m ${s}s`;
}

class CombatSimUI {
    constructor() {
        this.panel = null;
        this._editor = null;
        this.isRunning = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.elapsedTimer = null;
        this._activePlayerTab = 'player1';
        this._playerInfo = [];
        this._lastSimResult = null;
        this._lastSimHours = null;
        this._lastGameData = null;
        // Session history for multi-scenario comparison
        this._simHistory = [];
        this._comparisonIndex = null;
        // Comparison table state
        this._comparisonBaseline = null; // index into _simHistory
        this._comparisonSlots = []; // array of _simHistory indices to compare
        this._activeDetailIndex = null; // which history entry's details are shown
        this._activeMainTab = 'configure';
        // All Zones state
        this._allZonesMode = null; // null = off, 'group' or 'solo'
        this._allZonesResults = null; // Array of {zone, simResult, revenue}
        this._allZonesSortCol = null;
        this._allZonesSortAsc = true;
        this._earlyExitEnabled = true; // default on
        // Seek state
        this._seekItems = []; // [{itemHrid, name}] — droppable items across all combat zones
        this._seekSelectedItem = null;
        this._seekResults = null;
        this._seekSortCol = null;
        this._seekSortAsc = true;
    }

    /**
     * Build and append the floating panel to the document body.
     */
    buildPanel() {
        if (this.panel) return;

        this.panel = document.createElement('div');
        this.panel.id = PANEL_ID;
        this.panel.style.cssText = `
            position: fixed;
            top: 60px;
            right: 60px;
            z-index: ${config.Z_FLOATING_PANEL};
            background: rgba(10, 10, 20, 0.97);
            border: 2px solid ${ACCENT_BORDER};
            border-radius: 10px;
            width: 600px;
            height: 600px;
            min-width: 400px;
            min-height: 300px;
            max-width: 90vw;
            max-height: 90vh;
            display: none;
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
            cursor: grab;
            background: ${ACCENT_BG};
            border-bottom: 1px solid ${ACCENT_BORDER};
            border-radius: 8px 8px 0 0;
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <span style="font-weight:700; font-size:14px; color:${ACCENT};">${t('Combat Simulator')}</span>
            <button id="mwi-csim-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">×</button>
        `;
        this._setupDrag(header);

        // Tab bar (Configure | Results)
        const tabBar = document.createElement('div');
        tabBar.id = 'mwi-csim-tabbar';
        tabBar.style.cssText = `
            display: flex;
            gap: 0;
            padding: 0;
            flex-shrink: 0;
            border-bottom: 1px solid #222;
        `;
        const tabStyle = (active) => `
            flex: 1;
            padding: 7px 0;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            font-family: inherit;
            transition: all 0.1s;
            background: ${active ? ACCENT_BG : 'transparent'};
            color: ${active ? ACCENT : '#888'};
            border-bottom: 2px solid ${active ? ACCENT : 'transparent'};
        `;
        tabBar.innerHTML = `
            <button id="mwi-csim-tab-configure" style="${tabStyle(true)}">${t('Configure')}</button>
            <button id="mwi-csim-tab-results" style="${tabStyle(false)}">${t('Results')}</button>
            <button id="mwi-csim-tab-seek" style="${tabStyle(false)}">${t('Seek')}</button>
            <button id="mwi-csim-tab-upgrade" style="${tabStyle(false)}">${t('Upgrade')}</button>
        `;

        // Configure tab content
        const configureContent = document.createElement('div');
        configureContent.id = 'mwi-csim-configure-content';
        configureContent.style.cssText = 'display:flex; flex-direction:column; flex:1; overflow:hidden;';

        // Controls (zone, tier, hours, simulate)
        const controls = document.createElement('div');
        controls.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;

        const selectStyle =
            'background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; flex:1; min-width:0;';
        const inputStyle =
            'width:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center;';

        controls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Zone')}</label>
            <select id="mwi-csim-zone" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">${t('Tier')}</label>
            <select id="mwi-csim-tier" style="${selectStyle} flex:0; width:64px; min-width:64px;">
            </select>
            <label style="color:#888; font-size:12px;">${t('Hours')}</label>
            <input id="mwi-csim-hours" type="number" min="1" max="10000" value="${config.getSettingValue('combatSim_defaultHours', 100)}" style="${inputStyle}">
            <button id="mwi-csim-run" style="
                margin-left: auto;
                background: ${ACCENT_BTN_BG};
                color: ${ACCENT};
                border: 1px solid ${ACCENT_BTN_BORDER};
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;">${t('Simulate')}</button>
        `;

        // All Zones controls row
        const allZonesRow = document.createElement('div');
        allZonesRow.id = 'mwi-csim-allzones-row';
        allZonesRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
            font-size: 12px;
        `;
        const checkboxStyle = 'margin:0; cursor:pointer;';
        const labelStyle = 'display:flex; align-items:center; gap:4px; color:#888; cursor:pointer;';
        allZonesRow.innerHTML = `
            <label style="${labelStyle}">
                <input type="checkbox" id="mwi-csim-allzones-group" style="${checkboxStyle}">
                ${t('Sim All Zones')}
            </label>
            <label style="${labelStyle}">
                <input type="checkbox" id="mwi-csim-allzones-solo" style="${checkboxStyle}">
                ${t('Sim All Solo')}
            </label>
            <label id="mwi-csim-allzones-hours-label" style="color:#888; font-size:12px; display:none;">${t('Hours')}</label>
            <input id="mwi-csim-allzones-hours" type="number" min="1" max="10000" value="${config.getSettingValue('combatSim_allZonesDefaultHours', 10)}" style="display:none; width:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center;">
            <label id="mwi-csim-earlyexit-label" style="${labelStyle} display:none;" title="${t('Stop simming higher tiers for a zone if both XP/hr and profit/hr declined vs the previous tier')}">
                <input type="checkbox" id="mwi-csim-earlyexit" style="${checkboxStyle}" checked>
                ${t('Skip Worse Tiers')}
            </label>
        `;

        // Zone checklist (hidden by default)
        const zoneChecklist = document.createElement('div');
        zoneChecklist.id = 'mwi-csim-zone-checklist';
        zoneChecklist.style.cssText = `
            display: none;
            max-height: 150px;
            overflow-y: auto;
            padding: 6px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;

        // Loadout editor area (scrollable)
        const editorArea = document.createElement('div');
        editorArea.id = 'mwi-csim-editor';
        editorArea.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';
        editorArea.innerHTML = `<div style="color:#555; font-size:12px; text-align:center; padding:20px 0;">${t('Loading loadout...')}</div>`;

        this._editor = new SimEditor({ editorEl: editorArea, labMode: false });

        configureContent.appendChild(controls);
        configureContent.appendChild(allZonesRow);
        configureContent.appendChild(zoneChecklist);
        configureContent.appendChild(editorArea);

        // Results tab content (hidden by default)
        const resultsContent = document.createElement('div');
        resultsContent.id = 'mwi-csim-results-content';
        resultsContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        // Progress bar container (hidden by default)
        const progressContainer = document.createElement('div');
        progressContainer.id = 'mwi-csim-progress-container';
        progressContainer.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        progressContainer.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="
                    flex:1;
                    background:#1a1a2e;
                    border-radius:4px;
                    height:18px;
                    overflow:hidden;
                    position:relative;
                    border:1px solid #333;">
                    <div id="mwi-csim-progress-fill" style="
                        height:100%;
                        width:0%;
                        background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT});
                        border-radius:3px;
                        transition:width 0.2s ease;"></div>
                    <span id="mwi-csim-progress-text" style="
                        position:absolute;
                        top:0; left:0; right:0;
                        text-align:center;
                        font-size:11px;
                        line-height:18px;
                        color:#e0e0e0;
                        font-weight:600;">0%</span>
                </div>
                <button id="mwi-csim-stop" style="
                    background:rgba(244, 67, 54, 0.2);
                    border:1px solid rgba(244, 67, 54, 0.4);
                    color:#f44336;
                    border-radius:4px;
                    padding:2px 10px;
                    font-size:11px;
                    font-weight:600;
                    cursor:pointer;
                    font-family:inherit;
                    flex-shrink:0;">${t('Stop')}</button>
            </div>
        `;

        // Results container
        const resultsContainer = document.createElement('div');
        resultsContainer.id = 'mwi-csim-results';
        resultsContainer.style.cssText = 'display:none; overflow-y:auto; flex:1; padding:10px 14px;';

        resultsContent.appendChild(progressContainer);
        resultsContent.appendChild(resultsContainer);

        // Seek tab content (hidden by default)
        const seekContent = document.createElement('div');
        seekContent.id = 'mwi-csim-seek-content';
        seekContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        const seekControls = document.createElement('div');
        seekControls.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;
        seekControls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Item')}</label>
            <input id="mwi-csim-seek-input" type="text" placeholder="${t('Search item...')}" style="
                flex:1; min-width:0;
                background:#1a1a2e; color:#e0e0e0;
                border:1px solid #444; border-radius:4px;
                padding:3px 6px; font-size:12px; font-family:inherit;">
            <label style="color:#888; font-size:12px;">${t('Hours')}</label>
            <input id="mwi-csim-seek-hours" type="number" min="1" max="10000" value="${config.getSettingValue('combatSim_seekDefaultHours', 10)}" style="
                width:60px; background:#1a1a2e; color:#e0e0e0;
                border:1px solid #444; border-radius:4px;
                padding:3px 6px; font-size:12px; text-align:center;">
            <button id="mwi-csim-seek-run" style="
                background: ${ACCENT_BTN_BG};
                color: ${ACCENT};
                border: 1px solid ${ACCENT_BTN_BORDER};
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;">${t('Seek')}</button>
            <button id="mwi-csim-seek-stop" style="
                display:none;
                background:rgba(244, 67, 54, 0.2);
                border:1px solid rgba(244, 67, 54, 0.4);
                color:#f44336;
                border-radius:4px;
                padding:5px 10px;
                font-size:12px;
                font-weight:600;
                cursor:pointer;
                font-family:inherit;">${t('Stop')}</button>
        `;

        const seekSuggestions = document.createElement('div');
        seekSuggestions.id = 'mwi-csim-seek-suggestions';
        seekSuggestions.style.cssText = `
            display: none;
            max-height: 140px;
            overflow-y: auto;
            padding: 4px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;

        const seekProgress = document.createElement('div');
        seekProgress.id = 'mwi-csim-seek-progress';
        seekProgress.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        seekProgress.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; background:#1a1a2e; border-radius:4px; height:18px; overflow:hidden; position:relative; border:1px solid #333;">
                    <div id="mwi-csim-seek-progress-fill" style="height:100%; width:0%; background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT}); border-radius:3px; transition:width 0.2s ease;"></div>
                    <span id="mwi-csim-seek-progress-text" style="position:absolute; top:0; left:0; right:0; text-align:center; font-size:11px; line-height:18px; color:#e0e0e0; font-weight:600;">0%</span>
                </div>
            </div>
        `;

        const seekResults = document.createElement('div');
        seekResults.id = 'mwi-csim-seek-results';
        seekResults.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';

        seekContent.appendChild(seekControls);
        seekContent.appendChild(seekSuggestions);
        seekContent.appendChild(seekProgress);
        seekContent.appendChild(seekResults);

        // Upgrade tab content (hidden by default)
        const upgradeContent = document.createElement('div');
        upgradeContent.id = 'mwi-csim-upgrade-content';
        upgradeContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        const upgradeControls = document.createElement('div');
        upgradeControls.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;
        upgradeControls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Player')}</label>
            <select id="mwi-csim-upgrade-player" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">${t('Mode')}</label>
            <select id="mwi-csim-upgrade-mode" style="${selectStyle}">
                <option value="equipment">${t('Equipment')}</option>
                <option value="ability_level">${t('Ability Levels')}</option>
                <option value="ability_swap">${t('Ability Swaps')}</option>
            </select>
            <span id="mwi-csim-upgrade-level-group" style="display:none; align-items:center; gap:4px;">
                <select id="mwi-csim-upgrade-level-type" style="
                    background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                    border-radius:3px; padding:3px 5px; font-size:12px;">
                    <option value="increment">${t('+Levels')}</option>
                    <option value="target">${t('Target Lv')}</option>
                </select>
                <input id="mwi-csim-upgrade-target-level" type="number" min="1" max="200" value="5" placeholder="+5" style="
                    width:55px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                    border-radius:3px; padding:3px 5px; font-size:12px; text-align:center;"
                    title="${t('Number of levels to add to each ability')}">
            </span>
            <button id="mwi-csim-upgrade-run" style="
                background: ${ACCENT_BTN_BG};
                color: ${ACCENT};
                border: 1px solid ${ACCENT_BTN_BORDER};
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;">${t('Analyze')}</button>
            <button id="mwi-csim-upgrade-stop" style="
                display:none;
                background:rgba(244, 67, 54, 0.2);
                border:1px solid rgba(244, 67, 54, 0.4);
                color:#f44336;
                border-radius:4px;
                padding:5px 10px;
                font-size:12px;
                font-weight:600;
                cursor:pointer;
                font-family:inherit;">${t('Stop')}</button>
        `;

        const upgradeProgress = document.createElement('div');
        upgradeProgress.id = 'mwi-csim-upgrade-progress';
        upgradeProgress.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        upgradeProgress.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; background:#1a1a2e; border-radius:4px; height:18px; overflow:hidden; position:relative; border:1px solid #333;">
                    <div id="mwi-csim-upgrade-progress-fill" style="height:100%; width:0%; background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT}); border-radius:3px; transition:width 0.2s ease;"></div>
                    <span id="mwi-csim-upgrade-progress-text" style="position:absolute; top:0; left:0; right:0; text-align:center; font-size:11px; line-height:18px; color:#e0e0e0; font-weight:600;">0 / 0</span>
                </div>
            </div>
        `;

        const upgradeResults = document.createElement('div');
        upgradeResults.id = 'mwi-csim-upgrade-results';
        upgradeResults.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';

        upgradeContent.appendChild(upgradeControls);
        upgradeContent.appendChild(upgradeProgress);
        upgradeContent.appendChild(upgradeResults);

        // Status bar
        const status = document.createElement('div');
        status.id = 'mwi-csim-status';
        status.style.cssText =
            'padding:6px 14px; color:#555; font-size:11px; border-top:1px solid #1a1a1a; flex-shrink:0; text-align:center;';
        status.textContent = t('Select a zone and click Simulate.');

        this.panel.appendChild(header);
        this.panel.appendChild(tabBar);
        this.panel.appendChild(configureContent);
        this.panel.appendChild(resultsContent);
        this.panel.appendChild(seekContent);
        this.panel.appendChild(upgradeContent);
        this.panel.appendChild(status);

        const resizeHandle = document.createElement('div');
        resizeHandle.style.cssText = `
            position: absolute;
            bottom: 0;
            right: 0;
            width: 16px;
            height: 16px;
            cursor: nwse-resize;
            background: linear-gradient(135deg, transparent 50%, rgba(74, 158, 255, 0.4) 50%);
            border-radius: 0 0 8px 0;
            z-index: 1;
        `;
        this.panel.appendChild(resizeHandle);
        this._setupResize(resizeHandle);

        document.body.appendChild(this.panel);
        registerFloatingPanel(this.panel);

        // Event listeners
        this.panel.querySelector('#mwi-csim-close').addEventListener('click', () => {
            this.panel.style.display = 'none';
        });
        this.panel.querySelector('#mwi-csim-run').addEventListener('click', () => this._onSimulate());
        this.panel.querySelector('#mwi-csim-stop').addEventListener('click', () => this._onSimulate());
        this.panel.addEventListener('mousedown', () => bringPanelToFront(this.panel));

        // Tab switching
        this.panel
            .querySelector('#mwi-csim-tab-configure')
            .addEventListener('click', () => this._switchTab('configure'));
        this.panel.querySelector('#mwi-csim-tab-results').addEventListener('click', () => this._switchTab('results'));
        this.panel.querySelector('#mwi-csim-tab-seek').addEventListener('click', () => this._switchTab('seek'));
        this.panel.querySelector('#mwi-csim-tab-upgrade').addEventListener('click', () => this._switchTab('upgrade'));
        this.panel.querySelector('#mwi-csim-upgrade-run').addEventListener('click', () => this._onUpgradeAnalyze());
        this.panel.querySelector('#mwi-csim-upgrade-stop').addEventListener('click', () => {
            this._upgradeAborted = true;
        });
        this.panel.querySelector('#mwi-csim-upgrade-mode').addEventListener('change', (e) => {
            const levelGroup = this.panel.querySelector('#mwi-csim-upgrade-level-group');
            const isLevelMode = e.target.value === 'ability_level';
            levelGroup.style.display = isLevelMode ? 'inline-flex' : 'none';
            if (isLevelMode) {
                this._setDefaultAbilityTargetLevel();
            }
        });
        this.panel.querySelector('#mwi-csim-upgrade-level-type').addEventListener('change', (e) => {
            const input = this.panel.querySelector('#mwi-csim-upgrade-target-level');
            if (e.target.value === 'increment') {
                input.value = '5';
                input.placeholder = '+5';
                input.title = t('Number of levels to add to each ability');
            } else {
                input.value = '';
                input.placeholder = 'e.g. 80';
                input.title = t('Absolute target level for all abilities');
            }
        });
        this.panel.querySelector('#mwi-csim-upgrade-target-level').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val > 200) e.target.value = 200;
            if (val < 1 && e.target.value !== '') e.target.value = 1;
        });

        // Zone change → update tier dropdown
        this.panel.querySelector('#mwi-csim-zone').addEventListener('change', () => this._updateTierDropdown());

        // All Zones toggles
        this.panel.querySelector('#mwi-csim-allzones-group').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.panel.querySelector('#mwi-csim-allzones-solo').checked = false;
                this._allZonesMode = 'group';
            } else {
                this._allZonesMode = null;
            }
            this._updateAllZonesUI();
        });
        this.panel.querySelector('#mwi-csim-allzones-solo').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.panel.querySelector('#mwi-csim-allzones-group').checked = false;
                this._allZonesMode = 'solo';
            } else {
                this._allZonesMode = null;
            }
            this._updateAllZonesUI();
        });

        // Early exit toggle
        this.panel.querySelector('#mwi-csim-earlyexit').addEventListener('change', (e) => {
            this._earlyExitEnabled = e.target.checked;
        });

        // Seek: item search input
        this.panel.querySelector('#mwi-csim-seek-input').addEventListener('input', (e) => {
            this._updateSeekSuggestions(e.target.value);
        });
        this.panel.querySelector('#mwi-csim-seek-input').addEventListener('focus', (e) => {
            this._updateSeekSuggestions(e.target.value);
        });
        this.panel.querySelector('#mwi-csim-seek-input').addEventListener('blur', () => {
            // Delay hide to allow click on suggestion
            setTimeout(() => {
                const sug = this.panel.querySelector('#mwi-csim-seek-suggestions');
                if (sug) sug.style.display = 'none';
            }, 150);
        });
        this.panel.querySelector('#mwi-csim-seek-run').addEventListener('click', () => this._onSeek());
        this.panel.querySelector('#mwi-csim-seek-stop').addEventListener('click', () => {
            cancelAllZonesSimulation();
        });

        this.populateZones();
    }

    /**
     * Fill the zone dropdown from getCombatZones() and select the current zone.
     */
    populateZones() {
        const zoneSelect = this.panel?.querySelector('#mwi-csim-zone');
        if (!zoneSelect) return;

        const zones = getCombatZones();
        zoneSelect.innerHTML = '';

        for (const zone of zones) {
            const option = document.createElement('option');
            option.value = zone.hrid;
            option.textContent = zone.isDungeon ? `[D] ${zone.name}` : zone.name;
            zoneSelect.appendChild(option);
        }

        // Select current zone and tier if available
        const current = getCurrentCombatZone();
        if (current) {
            zoneSelect.value = current.zoneHrid;
        }

        this._updateTierDropdown();

        // Restore current tier after dropdown is rebuilt
        if (current) {
            const tierSelect = this.panel.querySelector('#mwi-csim-tier');
            if (tierSelect) {
                tierSelect.value = String(current.difficultyTier);
            }
        }
    }

    /**
     * Update the tier dropdown based on the currently selected zone.
     * Regular zones: T0-T5, Dungeons: T0-T2.
     * @private
     */
    _updateTierDropdown() {
        const zoneSelect = this.panel?.querySelector('#mwi-csim-zone');
        const tierSelect = this.panel?.querySelector('#mwi-csim-tier');
        if (!zoneSelect || !tierSelect) return;

        const selectedHrid = zoneSelect.value;
        const zones = getCombatZones();
        const zone = zones.find((z) => z.hrid === selectedHrid);
        const maxTier = zone?.isDungeon ? 2 : 5;

        const currentTier = parseInt(tierSelect.value) || 0;
        tierSelect.innerHTML = Array.from({ length: maxTier + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join(
            ''
        );
        tierSelect.value = String(Math.min(currentTier, maxTier));
    }

    /**
     * Update UI visibility when All Zones mode changes.
     * Shows/hides zone checklist, hides single-zone controls.
     * @private
     */
    _updateAllZonesUI() {
        const checklist = this.panel?.querySelector('#mwi-csim-zone-checklist');
        const zoneSelect = this.panel?.querySelector('#mwi-csim-zone');
        const tierSelect = this.panel?.querySelector('#mwi-csim-tier');
        const zoneLabel = zoneSelect?.previousElementSibling;
        const tierLabel = tierSelect?.previousElementSibling;
        const earlyExitLabel = this.panel?.querySelector('#mwi-csim-earlyexit-label');
        const allZonesHoursInput = this.panel?.querySelector('#mwi-csim-allzones-hours');
        const allZonesHoursLabel = this.panel?.querySelector('#mwi-csim-allzones-hours-label');
        const mainHoursInput = this.panel?.querySelector('#mwi-csim-hours');
        const mainHoursLabel = mainHoursInput?.previousElementSibling;

        if (!checklist) return;

        if (this._allZonesMode) {
            // Hide single-zone controls
            if (zoneSelect) zoneSelect.style.display = 'none';
            if (tierSelect) tierSelect.style.display = 'none';
            if (zoneLabel) zoneLabel.style.display = 'none';
            if (tierLabel) tierLabel.style.display = 'none';
            if (mainHoursInput) mainHoursInput.style.display = 'none';
            if (mainHoursLabel) mainHoursLabel.style.display = 'none';
            if (earlyExitLabel) earlyExitLabel.style.display = 'flex';
            if (allZonesHoursInput) allZonesHoursInput.style.display = '';
            if (allZonesHoursLabel) allZonesHoursLabel.style.display = '';

            // Show checklist with zones
            checklist.style.display = 'block';
            this._populateZoneChecklist();
        } else {
            // Show single-zone controls
            if (zoneSelect) zoneSelect.style.display = '';
            if (tierSelect) tierSelect.style.display = '';
            if (zoneLabel) zoneLabel.style.display = '';
            if (tierLabel) tierLabel.style.display = '';
            if (mainHoursInput) mainHoursInput.style.display = '';
            if (mainHoursLabel) mainHoursLabel.style.display = '';
            if (earlyExitLabel) earlyExitLabel.style.display = 'none';
            if (allZonesHoursInput) allZonesHoursInput.style.display = 'none';
            if (allZonesHoursLabel) allZonesHoursLabel.style.display = 'none';

            // Hide checklist
            checklist.style.display = 'none';
        }
    }

    /**
     * Populate the zone checklist based on current all-zones mode.
     * @private
     */
    _populateZoneChecklist() {
        const checklist = this.panel?.querySelector('#mwi-csim-zone-checklist');
        if (!checklist) return;

        const zones = getCombatZones().filter((z) => {
            if (z.isDungeon) return false;
            if (this._allZonesMode === 'group') return z.maxSpawnCount > 1;
            if (this._allZonesMode === 'solo') return z.maxSpawnCount === 1;
            return false;
        });

        const checkAllId = 'mwi-csim-checkall';
        checklist.innerHTML = `
            <label style="display:flex; align-items:center; gap:4px; color:${ACCENT}; font-size:11px; font-weight:600; margin-bottom:4px; cursor:pointer;">
                <input type="checkbox" id="${checkAllId}" checked style="margin:0; cursor:pointer;">
                ${t('Check All')}
            </label>
        `;

        for (const zone of zones) {
            const label = document.createElement('label');
            label.style.cssText =
                'display:flex; align-items:center; gap:4px; color:#ccc; font-size:11px; padding:1px 0; cursor:pointer;';
            label.innerHTML = `<input type="checkbox" class="mwi-csim-zone-cb" data-hrid="${zone.hrid}" checked style="margin:0; cursor:pointer;"> ${zone.name}`;
            checklist.appendChild(label);
        }

        // Check All toggle
        checklist.querySelector(`#${checkAllId}`).addEventListener('change', (e) => {
            checklist.querySelectorAll('.mwi-csim-zone-cb').forEach((cb) => {
                cb.checked = e.target.checked;
            });
        });
    }

    /**
     * Get selected zones expanded into all difficulty tiers.
     * @returns {Array<{zoneHrid: string, difficultyTier: number, name: string}>}
     * @private
     */
    _getSelectedAllZones() {
        const checklist = this.panel?.querySelector('#mwi-csim-zone-checklist');
        if (!checklist) return [];

        const allZones = getCombatZones();
        const selected = [];

        checklist.querySelectorAll('.mwi-csim-zone-cb:checked').forEach((cb) => {
            const hrid = cb.dataset.hrid;
            const zone = allZones.find((z) => z.hrid === hrid);
            if (!zone) return;

            for (let t = 0; t <= zone.maxDifficulty; t++) {
                selected.push({ zoneHrid: zone.hrid, difficultyTier: t, name: zone.name });
            }
        });

        return selected;
    }

    /**
     * Display all-zones comparison results in a sortable table.
     * @param {Array<Object>} zoneResults - Array of {zone, simResult, revenue}
     * @param {number} hours - Simulation hours
     * @param {Object} gameData - Game data maps
     * @private
     */
    _displayAllZonesResults(zoneResults, hours, gameData) {
        const container = this.panel?.querySelector('#mwi-csim-results');
        if (!container) return;

        this._allZonesResults = zoneResults;
        container.style.display = 'block';

        const skillCols = [
            { key: 'totalXP', label: t('Total XP/hr') },
            { key: 'profitDay', label: t('Profit/day') },
            { key: 'stamina', label: t('Stam') },
            { key: 'intelligence', label: t('Int') },
            { key: 'attack', label: t('Atk') },
            { key: 'melee', label: t('Melee') },
            { key: 'defense', label: t('Def') },
            { key: 'ranged', label: t('Ranged') },
            { key: 'magic', label: t('Magic') },
        ];

        const cols = [
            { key: 'zone', label: t('Zone') },
            { key: 'tier', label: t('T') },
            { key: 'encounters', label: t('Enc/hr') },
            { key: 'deaths', label: t('Deaths/hr') },
            ...skillCols,
            { key: 'revenue', label: t('Rev/hr') },
            { key: 'expenses', label: t('Cost/hr') },
            { key: 'profit', label: t('Profit/hr') },
        ];

        // Build row data
        const playerHrid = this._activePlayerTab || 'player1';
        const rows = zoneResults
            .filter((r) => r && r.simResult)
            .map((r) => {
                const sim = r.simResult;
                const simHours = (sim.simulatedTime || 0) / (3600 * 1e9) || hours;
                const xp = sim.experienceGained?.[playerHrid] || {};

                const totalXP = Object.values(xp).reduce((s, v) => s + v, 0) / simHours;
                const playerDeaths = (sim.deaths?.[playerHrid] || 0) / simHours;
                const encounters = (sim.encounters || 0) / simHours;

                return {
                    zone: r.zone.name,
                    tier: r.zone.difficultyTier,
                    encounters,
                    deaths: playerDeaths,
                    totalXP,
                    stamina: (xp.stamina || 0) / simHours,
                    intelligence: (xp.intelligence || 0) / simHours,
                    attack: (xp.attack || 0) / simHours,
                    melee: (xp.melee || 0) / simHours,
                    defense: (xp.defense || 0) / simHours,
                    ranged: (xp.ranged || 0) / simHours,
                    magic: (xp.magic || 0) / simHours,
                    revenue: r.revenue?.revenuePerHour || 0,
                    expenses: r.revenue?.costPerHour || 0,
                    profit: r.revenue?.netPerHour || 0,
                    profitDay: (r.revenue?.netPerHour || 0) * 24,
                };
            });

        // Sort
        if (this._allZonesSortCol) {
            const col = this._allZonesSortCol;
            const asc = this._allZonesSortAsc;
            rows.sort((a, b) => {
                const va = a[col] ?? 0;
                const vb = b[col] ?? 0;
                if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
                return asc ? va - vb : vb - va;
            });
        }

        // Find max values per numeric column for highlighting
        const maxVals = {};
        const minVals = {};
        for (const col of cols) {
            if (col.key === 'zone' || col.key === 'tier') continue;
            const values = rows.map((r) => r[col.key] || 0);
            maxVals[col.key] = Math.max(...values);
            minVals[col.key] = Math.min(...values);
        }

        // Render table
        const headerCells = cols
            .map((col) => {
                const arrow = this._allZonesSortCol === col.key ? (this._allZonesSortAsc ? ' ▲' : ' ▼') : '';
                return `<th data-col="${col.key}" style="padding:3px 4px; cursor:pointer; white-space:nowrap; font-size:10px; font-weight:600; color:#888; border-bottom:1px solid #333; user-select:none;">${col.label}${arrow}</th>`;
            })
            .join('');

        const bodyRows = rows
            .map((row) => {
                const cells = cols
                    .map((col) => {
                        const val = row[col.key];
                        let display;
                        let style = 'padding:2px 4px; font-size:10px; white-space:nowrap;';

                        if (col.key === 'zone') {
                            display = val;
                            style += ' color:#e0e0e0;';
                        } else if (col.key === 'tier') {
                            display = `T${val}`;
                            style += ' color:#888; text-align:center;';
                        } else if (col.key === 'deaths') {
                            display = val.toFixed(2);
                            style += ' text-align:right; font-variant-numeric:tabular-nums;';

                            const bestVal = minVals[col.key];
                            const isBest = bestVal !== undefined && val === bestVal && rows.length > 1;
                            if (isBest) {
                                style += ' color:#4caf50; font-weight:600;';
                            } else if (val > 0) {
                                style += ' color:#f44336;';
                            } else {
                                style += ' color:#e0e0e0;';
                            }
                        } else {
                            display = formatKMB(Math.round(val));
                            style += ' text-align:right; font-variant-numeric:tabular-nums;';

                            // Highlight best value per column in green
                            const isLowerBetter = col.key === 'expenses';
                            const bestVal = isLowerBetter ? minVals[col.key] : maxVals[col.key];
                            const isBest = bestVal !== undefined && val === bestVal && rows.length > 1;

                            if (isBest) {
                                style += ' color:#4caf50; font-weight:600;';
                            } else if ((col.key === 'profit' || col.key === 'profitDay') && val < 0) {
                                style += ' color:#f44336;';
                            } else {
                                style += ' color:#e0e0e0;';
                            }
                        }

                        return `<td style="${style}">${display}</td>`;
                    })
                    .join('');
                return `<tr style="border-bottom:1px solid #1a1a1a;">${cells}</tr>`;
            })
            .join('');

        container.innerHTML = `
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; min-width:800px;">
                    <thead><tr>${headerCells}</tr></thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
        `;

        // Add sort listeners
        container.querySelectorAll('th[data-col]').forEach((th) => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                if (this._allZonesSortCol === col) {
                    this._allZonesSortAsc = !this._allZonesSortAsc;
                } else {
                    this._allZonesSortCol = col;
                    this._allZonesSortAsc = col === 'zone'; // Ascending for zone name, descending for numbers
                }
                this._displayAllZonesResults(zoneResults, hours, gameData);
            });
        });
    }

    /**
     * Populate (or refresh) the seekable item list from all combat zone drop tables.
     * Only called once per game data session; subsequent calls are no-ops if list is cached.
     * @private
     */
    _populateSeekItems() {
        if (this._seekItems.length > 0) return;

        const gameData = buildGameDataPayload();
        if (!gameData) return;

        const { actionDetailMap, combatMonsterDetailMap } = gameData;
        if (!actionDetailMap || !combatMonsterDetailMap) return;

        const itemHridSet = new Set();

        for (const action of Object.values(actionDetailMap)) {
            if (action.type !== '/action_types/combat') continue;
            const isDungeon = action.combatZoneInfo?.isDungeon || false;

            if (isDungeon) {
                for (const drop of action.combatZoneInfo?.dungeonInfo?.rewardDropTable || []) {
                    if (drop.itemHrid) itemHridSet.add(drop.itemHrid);
                }
            } else {
                const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
                const bossSpawns = action.combatZoneInfo?.fightInfo?.bossSpawns || [];
                for (const spawn of [...spawns, ...bossSpawns]) {
                    const monster = combatMonsterDetailMap[spawn.combatMonsterHrid];
                    if (!monster) continue;
                    for (const drop of monster.dropTable || []) {
                        if (drop.itemHrid) itemHridSet.add(drop.itemHrid);
                    }
                    for (const drop of monster.rareDropTable || []) {
                        if (drop.itemHrid) itemHridSet.add(drop.itemHrid);
                    }
                }
            }
        }

        const clientData = dataManager.getInitClientData();
        const itemDetailMap = clientData?.itemDetailMap || {};

        this._seekItems = Array.from(itemHridSet)
            .map((hrid) => ({ itemHrid: hrid, name: itemDetailMap[hrid]?.name || hrid.split('/').pop() }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Update the seek suggestion list based on the current search text.
     * @param {string} query
     * @private
     */
    _updateSeekSuggestions(query) {
        const container = this.panel?.querySelector('#mwi-csim-seek-suggestions');
        if (!container) return;

        this._populateSeekItems();

        const q = (query || '').toLowerCase().trim();
        if (!q) {
            container.style.display = 'none';
            return;
        }

        const matches = this._seekItems.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 20);

        if (!matches.length) {
            container.style.display = 'none';
            return;
        }

        container.innerHTML = '';
        for (const item of matches) {
            const el = document.createElement('div');
            el.style.cssText =
                'padding:3px 0; font-size:12px; color:#ccc; cursor:pointer; border-bottom:1px solid #1a1a2e;';
            el.textContent = item.name;
            el.addEventListener('mousedown', () => {
                this._seekSelectedItem = item;
                const input = this.panel.querySelector('#mwi-csim-seek-input');
                if (input) input.value = item.name;
                container.style.display = 'none';
            });
            container.appendChild(el);
        }
        container.style.display = 'block';
    }

    /**
     * Run the Seek simulation: find all zones that drop the selected item and rank by items/hr.
     * @private
     */
    async _onSeek() {
        const input = this.panel?.querySelector('#mwi-csim-seek-input');
        const queryText = input?.value?.trim() || '';

        // Resolve selected item — either from prior click or by exact name match
        if (!this._seekSelectedItem || this._seekSelectedItem.name !== queryText) {
            const match = this._seekItems.find((i) => i.name.toLowerCase() === queryText.toLowerCase());
            if (match) {
                this._seekSelectedItem = match;
            } else {
                this._setStatus(t('No item selected. Type a name and pick from the list.'));
                return;
            }
        }

        const { itemHrid, name: itemName } = this._seekSelectedItem;

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        const zones = getZonesThatDropItem(itemHrid, gameData);
        if (!zones.length) {
            const resultsEl = this.panel?.querySelector('#mwi-csim-seek-results');
            if (resultsEl)
                resultsEl.innerHTML =
                    '<div style="color:#888; font-size:12px; padding:20px 0; text-align:center;">No zones drop this item.</div>';
            return;
        }

        const hoursEl = this.panel?.querySelector('#mwi-csim-seek-hours');
        const hours = Math.min(
            10000,
            Math.max(1, parseInt(hoursEl?.value) || config.getSettingValue('combatSim_seekDefaultHours', 10))
        );

        let playerDTOs;
        const editedDTOs = this._editor?.getEditedDTOs();
        if (editedDTOs) {
            playerDTOs = Object.values(editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
            this._playerInfo = result.playerInfo;
            this._activePlayerTab = result.selfHrid;
        }

        if (!playerDTOs.length) {
            this._setStatus(t('No character data available.'));
            return;
        }

        const communityBuffs = getCommunityBuffs();

        // UI setup
        this.isRunning = true;
        const runBtn = this.panel.querySelector('#mwi-csim-seek-run');
        const stopBtn = this.panel.querySelector('#mwi-csim-seek-stop');
        const progressEl = this.panel.querySelector('#mwi-csim-seek-progress');
        const progressFill = this.panel.querySelector('#mwi-csim-seek-progress-fill');
        const progressText = this.panel.querySelector('#mwi-csim-seek-progress-text');
        const resultsEl = this.panel.querySelector('#mwi-csim-seek-results');

        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';
        stopBtn.style.display = '';
        progressEl.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        resultsEl.innerHTML = '';

        const simStartTime = Date.now();
        const zoneCount = zones.length;
        this.elapsedTimer = setInterval(() => {
            const elapsed = (Date.now() - simStartTime) / 1000;
            this._setStatus(t('Seeking {0} in {1} zone/tiers... {2}', itemName, zoneCount, formatElapsed(elapsed)));
        }, 100);

        try {
            const simZones = zones.map((z) => ({ zoneHrid: z.zoneHrid, difficultyTier: z.difficultyTier }));

            const simResults = await runAllZonesSimulation(
                { gameData, playerDTOs, zones: simZones, hours, communityBuffs, useEarlyExit: false },
                (percent) => {
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${percent}%`;
                }
            );

            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);

            const playerHrid = this._activePlayerTab || 'player1';

            const seekRows = simResults
                .map((simResult, i) => {
                    if (!simResult) return null;
                    const zone = zones[i];
                    const simHours = (simResult.simulatedTime || 0) / (3600 * 1e9) || hours;

                    const dropMap = calculateExpectedDrops(simResult, gameData, playerHrid);
                    const itemCount = dropMap.get(itemHrid) || 0;
                    const itemsPerHour = itemCount / simHours;
                    if (itemsPerHour <= 0) return null;

                    let profitPerHour = 0;
                    let costPerHour = 0;
                    try {
                        const revenue = calculateSimRevenue(simResult, gameData, playerHrid, simHours);
                        profitPerHour = revenue.netPerHour;
                        costPerHour = revenue.costPerHour;
                    } catch {
                        // Revenue may not be available
                    }

                    const costPerDrop = itemsPerHour > 0 ? costPerHour / itemsPerHour : 0;

                    return { zone, itemsPerHour, profitPerHour, costPerHour, costPerDrop };
                })
                .filter(Boolean);

            this._seekResults = seekRows;
            this._seekSortCol = 'itemsPerHour';
            this._seekSortAsc = false;
            this._displaySeekResults(seekRows, itemName);
            this._setStatus(
                t('Seek complete in {0}: {1} sources found for {2}', totalElapsed, seekRows.length, itemName)
            );
        } catch (error) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            if (error.message === 'Cancelled') {
                this._setStatus(t('Seek cancelled.'));
            } else {
                console.error('[CombatSimUI] Seek simulation failed:', error);
                this._setStatus(t('Seek error: {0}', error.message || t('Unknown error')));
            }
        } finally {
            this.isRunning = false;
            runBtn.disabled = false;
            runBtn.style.opacity = '1';
            runBtn.style.cursor = 'pointer';
            stopBtn.style.display = 'none';
            progressEl.style.display = 'none';
        }
    }

    /**
     * Render seek results in a sortable table.
     * @param {Array<Object>} rows - seek result rows
     * @param {string} itemName - display name of the sought item
     * @private
     */
    _displaySeekResults(rows, itemName) {
        const container = this.panel?.querySelector('#mwi-csim-seek-results');
        if (!container) return;

        if (!rows.length) {
            container.innerHTML = `<div style="color:#888; font-size:12px; padding:20px 0; text-align:center;">No zones drop ${itemName}.</div>`;
            return;
        }

        const cols = [
            { key: 'zone', label: 'Zone' },
            { key: 'tier', label: 'T' },
            { key: 'itemsPerHour', label: 'Items/hr' },
            { key: 'profitPerHour', label: 'Profit/hr' },
            { key: 'costPerHour', label: 'Cost/hr' },
            { key: 'costPerDrop', label: 'Cost/Drop' },
        ];

        // Sort
        const sortCol = this._seekSortCol || 'itemsPerHour';
        const sortAsc = this._seekSortAsc;
        const sorted = [...rows].sort((a, b) => {
            const va =
                sortCol === 'zone' ? a.zone.name : sortCol === 'tier' ? a.zone.difficultyTier : (a[sortCol] ?? 0);
            const vb =
                sortCol === 'zone' ? b.zone.name : sortCol === 'tier' ? b.zone.difficultyTier : (b[sortCol] ?? 0);
            if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortAsc ? va - vb : vb - va;
        });

        // Best per numeric column (for green highlight)
        const bestItemsPerHour = Math.max(...rows.map((r) => r.itemsPerHour));
        const bestProfitPerHour = Math.max(...rows.map((r) => r.profitPerHour));
        const lowestCostPerHour =
            rows.filter((r) => r.costPerHour > 0).length > 0
                ? Math.min(...rows.filter((r) => r.costPerHour > 0).map((r) => r.costPerHour))
                : null;
        const lowestCostPerDrop =
            rows.filter((r) => r.costPerDrop > 0).length > 0
                ? Math.min(...rows.filter((r) => r.costPerDrop > 0).map((r) => r.costPerDrop))
                : null;

        const arrow = (col) => (this._seekSortCol === col ? (this._seekSortAsc ? ' ▲' : ' ▼') : '');

        const headerCells = cols
            .map(
                (col) =>
                    `<th data-col="${col.key}" style="padding:3px 4px; cursor:pointer; white-space:nowrap; font-size:10px; font-weight:600; color:#888; border-bottom:1px solid #333; user-select:none;">${col.label}${arrow(col.key)}</th>`
            )
            .join('');

        const bodyRows = sorted
            .map((row) => {
                const cells = cols
                    .map((col) => {
                        let display = '';
                        let highlight = false;
                        const cellStyle = 'padding:2px 4px; font-size:10px; white-space:nowrap;';

                        if (col.key === 'zone') {
                            display = row.zone.name;
                        } else if (col.key === 'tier') {
                            display = String(row.zone.difficultyTier);
                        } else if (col.key === 'itemsPerHour') {
                            display = row.itemsPerHour.toFixed(3);
                            highlight = row.itemsPerHour === bestItemsPerHour;
                        } else if (col.key === 'profitPerHour') {
                            display = formatKMB(row.profitPerHour);
                            highlight = row.profitPerHour === bestProfitPerHour && row.profitPerHour > 0;
                        } else if (col.key === 'costPerHour') {
                            display = row.costPerHour > 0 ? formatKMB(row.costPerHour) : '—';
                            highlight = lowestCostPerHour !== null && row.costPerHour === lowestCostPerHour;
                        } else if (col.key === 'costPerDrop') {
                            display = row.costPerDrop > 0 ? formatKMB(row.costPerDrop) : '—';
                            highlight = lowestCostPerDrop !== null && row.costPerDrop === lowestCostPerDrop;
                        }

                        const color = highlight ? '#4caf50' : '#ccc';
                        return `<td style="${cellStyle} color:${color};">${display}</td>`;
                    })
                    .join('');
                return `<tr style="border-bottom:1px solid #1a1a2e;">${cells}</tr>`;
            })
            .join('');

        container.innerHTML = `
            <div style="font-size:11px; color:#888; margin-bottom:8px;">Best sources for <strong style="color:${ACCENT};">${itemName}</strong></div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; min-width:400px;">
                    <thead><tr>${headerCells}</tr></thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
        `;

        container.querySelectorAll('th[data-col]').forEach((th) => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                if (this._seekSortCol === col) {
                    this._seekSortAsc = !this._seekSortAsc;
                } else {
                    this._seekSortCol = col;
                    this._seekSortAsc = col === 'zone' || col === 'tier';
                }
                this._displaySeekResults(rows, itemName);
            });
        });
    }

    /**
     * Reset the Simulate button to its default state.
     * @param {HTMLElement} btn
     * @private
     */
    _resetRunButton(btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }

    /**
     * Switch between Configure and Results tabs.
     * @param {string} tab - 'configure' or 'results'
     * @private
     */
    _switchTab(tab) {
        this._activeMainTab = tab;
        const configureContent = this.panel.querySelector('#mwi-csim-configure-content');
        const resultsContent = this.panel.querySelector('#mwi-csim-results-content');
        const seekContent = this.panel.querySelector('#mwi-csim-seek-content');
        const upgradeContent = this.panel.querySelector('#mwi-csim-upgrade-content');
        const tabConfigure = this.panel.querySelector('#mwi-csim-tab-configure');
        const tabResults = this.panel.querySelector('#mwi-csim-tab-results');
        const tabSeek = this.panel.querySelector('#mwi-csim-tab-seek');
        const tabUpgrade = this.panel.querySelector('#mwi-csim-tab-upgrade');

        const activeStyle = `flex:1; padding:7px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all 0.1s; background:${ACCENT_BG}; color:${ACCENT}; border-bottom:2px solid ${ACCENT};`;
        const inactiveStyle =
            'flex:1; padding:7px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all 0.1s; background:transparent; color:#888; border-bottom:2px solid transparent;';

        configureContent.style.display = 'none';
        resultsContent.style.display = 'none';
        if (seekContent) seekContent.style.display = 'none';
        if (upgradeContent) upgradeContent.style.display = 'none';
        tabConfigure.style.cssText = inactiveStyle;
        tabResults.style.cssText = inactiveStyle;
        if (tabSeek) tabSeek.style.cssText = inactiveStyle;
        if (tabUpgrade) tabUpgrade.style.cssText = inactiveStyle;

        if (tab === 'configure') {
            configureContent.style.display = 'flex';
            tabConfigure.style.cssText = activeStyle;
            this._setStatus(t('Select a zone and click Simulate.'));
        } else if (tab === 'seek') {
            if (seekContent) seekContent.style.display = 'flex';
            if (tabSeek) tabSeek.style.cssText = activeStyle;
            this._populateSeekItems();
            this._setStatus(t('Search for a combat drop item, then click Seek.'));
        } else if (tab === 'upgrade') {
            if (upgradeContent) upgradeContent.style.display = 'flex';
            if (tabUpgrade) tabUpgrade.style.cssText = activeStyle;
            this._populateUpgradePlayerSelector();
            this._setStatus(t('Select a player and click Analyze.'));
        } else {
            resultsContent.style.display = 'flex';
            tabResults.style.cssText = activeStyle;
            if (!this.isRunning && !this._lastSimResult && !this._allZonesResults) {
                this._setStatus(t('No results yet. Run a simulation first.'));
            }
        }
    }

    /**
     * Handle the Simulate button click.
     * @private
     */
    async _onSimulate() {
        if (this.isRunning) {
            // Stop the running simulation
            cancelSimulation();
            cancelAllZonesSimulation();
            this._setStatus(t('Simulation cancelled.'));
            this._switchTab('configure');
            return;
        }

        // Route to all-zones simulation if active
        if (this._allZonesMode) {
            return this._onSimulateAllZones();
        }

        const zoneHrid = this.panel.querySelector('#mwi-csim-zone')?.value;
        const difficultyTier = parseInt(this.panel.querySelector('#mwi-csim-tier')?.value) || 0;
        const hours = Math.min(
            10000,
            Math.max(
                1,
                parseInt(this.panel.querySelector('#mwi-csim-hours')?.value) ||
                    config.getSettingValue('combatSim_defaultHours', 100)
            )
        );

        if (!zoneHrid) {
            this._setStatus(t('No zone selected.'));
            return;
        }

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        // Use edited DTOs if available, otherwise auto-fill
        let playerDTOs;
        let playerInfo;
        let selfHrid;
        let missingMembers;

        const editedDTOs = this._editor?.getEditedDTOs();
        if (editedDTOs) {
            playerDTOs = Object.values(editedDTOs);
            playerInfo = this._editor?.getPlayerInfo() || [];
            selfHrid = this._editor?.getSelfHrid() || playerDTOs[0]?.hrid || 'player1';
            missingMembers = this._editor?.getMissingMembers() || [];
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
            playerInfo = result.playerInfo;
            selfHrid = result.selfHrid;
            missingMembers = result.missingMembers;
        }

        if (!playerDTOs.length) {
            this._setStatus(t('No character data available.'));
            return;
        }

        // Enforce 3-player max for non-dungeon zones
        const zones = getCombatZones();
        const selectedZone = zones.find((z) => z.hrid === zoneHrid);
        if (selectedZone && !selectedZone.isDungeon && playerDTOs.length > 3) {
            this._showWarning(
                t(
                    'Non-dungeon zones support max 3 players (you have {0}). Remove players to continue.',
                    playerDTOs.length
                )
            );
            return;
        }

        this._playerInfo = playerInfo;
        this._activePlayerTab = selfHrid;

        const communityBuffs = getCommunityBuffs();

        // Show party info
        const partyInfo =
            playerDTOs.length > 1
                ? t(
                      'Party ({0} loaded{1})',
                      playerDTOs.length,
                      missingMembers.length ? ', ' + missingMembers.length + ' ' + t('missing') : ''
                  )
                : t('Solo');

        // Disable Simulate button during run
        this.isRunning = true;
        const runBtn = this.panel.querySelector('#mwi-csim-run');
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';

        const progressContainer = this.panel.querySelector('#mwi-csim-progress-container');
        const progressFill = this.panel.querySelector('#mwi-csim-progress-fill');
        const progressText = this.panel.querySelector('#mwi-csim-progress-text');
        const resultsContainer = this.panel.querySelector('#mwi-csim-results');

        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        resultsContainer.style.display = 'none';

        // Switch to results tab to show progress
        this._switchTab('results');

        const simStartTime = Date.now();
        this.elapsedTimer = setInterval(() => {
            const elapsed = (Date.now() - simStartTime) / 1000;
            this._setStatus(t('Simulating ({0})... {1}', partyInfo, formatElapsed(elapsed)));
        }, 100);

        try {
            const simResult = await runSimulation(
                { gameData, playerDTOs, zoneHrid, difficultyTier, hours, communityBuffs },
                (percent) => {
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${percent}%`;
                }
            );

            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);

            this._lastSimResult = simResult;
            this._lastSimHours = hours;
            this._lastGameData = gameData;

            // Generate label before displaying (display may re-render)
            const historyLabel = this._editor?.generateSimLabel() || t('Current Gear');

            // Add history entry (metrics filled after _displayResults computes them)
            const historyEntry = {
                label: historyLabel,
                simResult,
                hours,
                gameData,
                metrics: null, // Filled by _displayResults
                timestamp: Date.now(),
            };

            // Auto-set comparison baseline to first entry when adding second+ result
            if (this._simHistory.length > 0 && this._comparisonBaseline === null) {
                this._comparisonBaseline = 0;
            }
            if (this._simHistory.length > 0 && this._comparisonIndex === null) {
                this._comparisonIndex = 0;
            }

            this._simHistory.push(historyEntry);
            if (this._simHistory.length > 10) {
                this._simHistory.shift();
                // Adjust comparison indices
                if (this._comparisonIndex !== null) {
                    this._comparisonIndex = Math.max(0, this._comparisonIndex - 1);
                }
                if (this._comparisonBaseline !== null) {
                    this._comparisonBaseline = Math.max(0, this._comparisonBaseline - 1);
                }
                this._comparisonSlots = this._comparisonSlots.map((i) => i - 1).filter((i) => i >= 0);
                if (this._activeDetailIndex !== null) {
                    this._activeDetailIndex = Math.max(0, this._activeDetailIndex - 1);
                }
            }

            // Show the newly run sim's details
            this._activeDetailIndex = this._simHistory.length - 1;
            this._displayResults(simResult, hours, gameData);
            this._switchTab('results');
            const modeLabels = {
                conservative: t('Buy: Ask / Sell: Bid'),
                hybrid: t('Buy: Ask / Sell: Ask'),
                optimistic: t('Buy: Bid / Sell: Ask'),
                patientBuy: t('Buy: Bid / Sell: Bid'),
            };
            const mode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
            const modeLabel = modeLabels[mode] || mode;
            const missingNote = missingMembers.length
                ? t(' | Missing: {0} (open their profiles)', missingMembers.join(', '))
                : '';
            this._setStatus(
                t(
                    'Simulation complete in {0}: {1} hours \u00b7 {2} \u00b7 {3}: {4}{5}',
                    totalElapsed,
                    formatWithSeparator(hours),
                    partyInfo,
                    t('Pricing'),
                    modeLabel,
                    missingNote
                )
            );
        } catch (error) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            if (error.message === 'Cancelled') {
                this._setStatus(t('Simulation cancelled.'));
            } else {
                console.error('[CombatSimUI] Simulation failed:', error);
                this._setStatus(t('Simulation error: {0}', error.message || t('Unknown error')));
            }
        } finally {
            this.isRunning = false;
            this._resetRunButton(runBtn);
            progressContainer.style.display = 'none';
        }
    }

    /**
     * Run simulations for all selected zones.
     * @private
     */
    async _onSimulateAllZones() {
        const selectedZones = this._getSelectedAllZones();
        if (!selectedZones.length) {
            this._setStatus(t('No zones selected.'));
            return;
        }

        const hours = Math.min(
            10000,
            Math.max(
                1,
                parseInt(this.panel.querySelector('#mwi-csim-allzones-hours')?.value) ||
                    config.getSettingValue('combatSim_allZonesDefaultHours', 10)
            )
        );

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        // Use edited DTOs if available, otherwise auto-fill
        let playerDTOs;
        const editedDTOs = this._editor?.getEditedDTOs();
        if (editedDTOs) {
            playerDTOs = Object.values(editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
            this._playerInfo = result.playerInfo;
            this._activePlayerTab = result.selfHrid;
        }

        if (!playerDTOs.length) {
            this._setStatus(t('No character data available.'));
            return;
        }

        // All-zones is always non-dungeon — enforce 3-player max
        if (playerDTOs.length > 3) {
            this._showWarning(
                t(
                    'Non-dungeon zones support max 3 players (you have {0}). Remove players to continue.',
                    playerDTOs.length
                )
            );
            return;
        }

        const communityBuffs = getCommunityBuffs();

        // UI: disable Simulate button, show progress
        this.isRunning = true;
        const runBtn = this.panel.querySelector('#mwi-csim-run');
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';

        const progressContainer = this.panel.querySelector('#mwi-csim-progress-container');
        const progressFill = this.panel.querySelector('#mwi-csim-progress-fill');
        const progressText = this.panel.querySelector('#mwi-csim-progress-text');
        const resultsContainer = this.panel.querySelector('#mwi-csim-results');

        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        resultsContainer.style.display = 'none';

        this._switchTab('results');

        const simStartTime = Date.now();
        const zoneCount = selectedZones.length;
        this.elapsedTimer = setInterval(() => {
            const elapsed = (Date.now() - simStartTime) / 1000;
            this._setStatus(t('Simulating {0} zones... {1}', zoneCount, formatElapsed(elapsed)));
        }, 100);

        try {
            const zones = selectedZones.map((z) => ({ zoneHrid: z.zoneHrid, difficultyTier: z.difficultyTier }));

            const simResults = await runAllZonesSimulation(
                { gameData, playerDTOs, zones, hours, communityBuffs, useEarlyExit: this._earlyExitEnabled },
                (percent) => {
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${percent}%`;
                }
            );

            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);

            // Build zone results with revenue calculations
            const playerHrid = this._activePlayerTab || 'player1';
            const zoneResults = simResults
                .map((simResult, i) => {
                    if (!simResult) return null;

                    let revenue = null;
                    try {
                        revenue = calculateSimRevenue(simResult, gameData, playerHrid, hours);
                    } catch {
                        // Revenue calculation may not be available
                    }

                    return {
                        zone: selectedZones[i],
                        simResult,
                        revenue,
                    };
                })
                .filter(Boolean);

            this._allZonesSortCol = 'profit';
            this._allZonesSortAsc = false;
            this._displayAllZonesResults(zoneResults, hours, gameData);
            this._switchTab('results');
            this._setStatus(
                t(
                    'All zones complete in {0}: {1} zones \u00b7 {2} hours each',
                    totalElapsed,
                    zoneCount,
                    formatWithSeparator(hours)
                )
            );
        } catch (error) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            if (error.message === 'Cancelled') {
                this._setStatus(t('Simulation cancelled.'));
            } else {
                console.error('[CombatSimUI] All zones simulation failed:', error);
                this._setStatus(t('Simulation error: {0}', error.message || t('Unknown error')));
            }
        } finally {
            this.isRunning = false;
            this._resetRunButton(runBtn);
            progressContainer.style.display = 'none';
        }
    }

    /**
     * Format and display simulation results.
     * @param {Object} simResult - SimResult from the combat simulator engine
     * @param {number} hours - Number of hours simulated
     * @param {Object} gameData - Game data maps for drop calculation
     * @private
     */
    _displayResults(simResult, hours, gameData) {
        // If an active detail index is set, show that history entry's details instead
        if (this._activeDetailIndex !== null && this._simHistory[this._activeDetailIndex]) {
            const entry = this._simHistory[this._activeDetailIndex];
            simResult = entry.simResult;
            hours = entry.hours;
            gameData = entry.gameData;
        }

        const container = this.panel.querySelector('#mwi-csim-results');
        if (!container) return;

        const activeTab = this._activePlayerTab;
        const playerInfo = this._playerInfo;
        const numberOfPlayers = simResult.numberOfPlayers || 1;

        const sectionStyle = 'margin-bottom:12px;';
        const headingStyle = `color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; border-bottom:1px solid #222; padding-bottom:4px;`;
        const rowStyle = 'display:flex; justify-content:space-between; padding:2px 0; font-size:12px;';
        const labelStyle = 'color:#aaa;';
        const valueStyle = 'color:#e0e0e0; font-weight:600;';

        let html = '';

        // Pre-compute metrics for the latest history entry if not yet populated
        this._ensureHistoryMetrics(simResult, hours, gameData, activeTab);

        // History panel (above everything)
        if (this._simHistory.length > 0) {
            html += this._renderHistoryPanel();
        }

        // Player tabs (only shown for party sims)
        if (numberOfPlayers > 1) {
            html += `<div style="display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap;">`;
            for (const { hrid, name } of playerInfo) {
                const isActive = hrid === activeTab;
                const tabStyle = isActive
                    ? `background:${ACCENT_BG}; border:1px solid ${ACCENT_BORDER}; color:${ACCENT}; font-weight:700;`
                    : 'background:rgba(255,255,255,0.04); border:1px solid #333; color:#aaa;';
                html += `<button data-tab="${hrid}" style="
                    ${tabStyle}
                    padding:3px 10px; border-radius:5px; font-size:12px; cursor:pointer;
                    font-family:inherit; transition:all 0.1s;
                ">${name}</button>`;
            }
            html += '</div>';
        }

        // Compute previous values for delta comparison (from history)
        // Use baseline for deltas (comparison table baseline, not the old comparisonIndex)
        const compIdx = this._comparisonBaseline ?? this._comparisonIndex;
        const compEntry = compIdx !== null ? this._simHistory[compIdx] : null;
        const compResult = compEntry?.simResult;
        const compHours = compEntry?.hours;
        const compMetrics = compEntry?.metrics;
        const hasPrev = compResult && compHours;
        const prevEncPerHr = hasPrev ? compResult.encounters / compHours : null;
        const prevDeathsPerHr = hasPrev ? (compResult.deaths?.[activeTab] || 0) / compHours : null;

        // Overview: encounters/hr (party-wide) + deaths/hr (per active player)
        const encountersPerHr = simResult.encounters / hours;
        const playerDeaths = simResult.deaths?.[activeTab] || 0;
        const deathsPerHr = playerDeaths / hours;

        html += `<div style="${sectionStyle}">`;
        html += `<div style="${headingStyle}">${t('Overview')}</div>`;
        html += `<div style="${rowStyle}">`;
        html += `<span style="${labelStyle}">${t('Encounters/hr')}</span>`;
        html += `<span style="${valueStyle}">${formatWithSeparator(Math.round(encountersPerHr))}${this._formatDelta(encountersPerHr, prevEncPerHr)}</span>`;
        html += '</div>';
        html += `<div style="${rowStyle}">`;
        html += `<span style="${labelStyle}">${t('Deaths/hr')}</span>`;
        html += `<span style="${valueStyle}">${this._formatDeaths(deathsPerHr)}${this._formatDelta(deathsPerHr, prevDeathsPerHr, false)}</span>`;
        html += '</div>';

        // DPS — estimated from monster kills × max HP / time
        if (gameData) {
            const monsterDetailMap = gameData.combatMonsterDetailMap || {};
            let totalDamage = 0;
            let prevTotalDamage = 0;
            for (const [hrid, count] of Object.entries(simResult.deaths)) {
                if (hrid.startsWith('player')) continue;
                const monster = monsterDetailMap[hrid];
                if (monster?.combatDetails?.maxHitpoints) {
                    totalDamage += count * monster.combatDetails.maxHitpoints;
                }
            }
            const dps = totalDamage / (hours * 3600);
            this._lastComputedDps = dps;
            let prevDps = null;
            if (hasPrev) {
                for (const [hrid, count] of Object.entries(compResult.deaths)) {
                    if (hrid.startsWith('player')) continue;
                    const monster = monsterDetailMap[hrid];
                    if (monster?.combatDetails?.maxHitpoints) {
                        prevTotalDamage += count * monster.combatDetails.maxHitpoints;
                    }
                }
                prevDps = prevTotalDamage / (compHours * 3600);
            }
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">${t('Party DPS (est.)')}</span>`;
            html += `<span style="${valueStyle}">${formatWithSeparator(Math.round(dps))}${this._formatDelta(dps, prevDps)}</span>`;
            html += '</div>';
        }

        // Dungeon stats if applicable
        if (simResult.isDungeon) {
            const completedPerHr = simResult.dungeonsCompleted / hours;
            const failedPerHr = simResult.dungeonsFailed / hours;

            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">${t('Dungeons completed/hr')}</span>`;
            html += `<span style="${valueStyle}">${this._formatRate(completedPerHr)}</span>`;
            html += '</div>';
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">${t('Dungeons failed/hr')}</span>`;
            html += `<span style="${valueStyle}">${this._formatRate(failedPerHr)}</span>`;
            html += '</div>';
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">${t('Total completed / failed')}</span>`;
            html += `<span style="${valueStyle}">${formatWithSeparator(simResult.dungeonsCompleted)} / ${formatWithSeparator(simResult.dungeonsFailed)}</span>`;
            html += '</div>';
            if (simResult.dungeonsCompleted > 0) {
                const avgTimeNs = simResult.simulatedTime / simResult.dungeonsCompleted;
                const avgTimeSec = avgTimeNs / 1e9;
                let avgTimeStr;
                if (config.getSettingValue('combatSim_decimalMinutes', false)) {
                    avgTimeStr = `${(avgTimeSec / 60).toFixed(2)} min`;
                } else {
                    const avgMin = Math.floor(avgTimeSec / 60);
                    const avgSec = Math.round(avgTimeSec % 60);
                    avgTimeStr = `${avgMin}m ${avgSec}s`;
                }
                html += `<div style="${rowStyle}">`;
                html += `<span style="${labelStyle}">${t('Avg completion time')}</span>`;
                html += `<span style="${valueStyle}">${avgTimeStr}</span>`;
                html += '</div>';
            }
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">${t('Max wave reached')}</span>`;
            html += `<span style="${valueStyle}">${simResult.maxWaveReached}</span>`;
            html += '</div>';
        }
        html += '</div>';

        // XP/hr by skill — per active tab player
        const xpTotals = {};
        if (simResult.experienceGained[activeTab]) {
            for (const [skill, amount] of Object.entries(simResult.experienceGained[activeTab])) {
                xpTotals[skill] = (xpTotals[skill] || 0) + amount;
            }
        }

        // Build previous XP map for delta comparison
        const prevXpPerHr = {};
        if (hasPrev && compResult.experienceGained?.[activeTab]) {
            for (const [skill, amount] of Object.entries(compResult.experienceGained[activeTab])) {
                prevXpPerHr[skill] = Math.round(amount / compHours);
            }
        }

        const xpEntries = Object.entries(xpTotals).filter(([, total]) => total > 0);
        if (xpEntries.length > 0) {
            html += `<div style="${sectionStyle}">`;
            html += `<div style="${headingStyle}">${t('XP/hr')}</div>`;
            for (const [skill, total] of xpEntries) {
                const perHr = Math.round(total / hours);
                const prevVal = hasPrev ? prevXpPerHr[skill] || null : null;
                const skillLabel = skill.charAt(0).toUpperCase() + skill.slice(1);
                html += `<div style="${rowStyle}">`;
                html += `<span style="${labelStyle}">${skillLabel}</span>`;
                html += `<span style="${valueStyle}">${formatWithSeparator(perHr)}${this._formatDelta(perHr, prevVal)}</span>`;
                html += '</div>';
            }
            // Total XP/hr row
            const totalXpPerHr = xpEntries.reduce((sum, [, total]) => sum + Math.round(total / hours), 0);
            const prevTotalXpPerHr = hasPrev ? Object.values(prevXpPerHr).reduce((sum, v) => sum + v, 0) : null;
            html += `<div style="display:flex; justify-content:space-between; padding:4px 0 0; font-size:12px; border-top:1px solid #333; margin-top:4px;">`;
            html += `<span style="color:#aaa; font-weight:700;">${t('Total')}</span>`;
            html += `<span style="${valueStyle}">${formatWithSeparator(totalXpPerHr)}${this._formatDelta(totalXpPerHr, prevTotalXpPerHr)}</span>`;
            html += '</div>';
            html += '</div>';
        }

        // Consumable costs — per active tab player
        const consumableTotals = {};
        const selfConsumables = simResult.consumablesUsed?.[activeTab] || {};
        for (const [itemHrid, count] of Object.entries(selfConsumables)) {
            consumableTotals[itemHrid] = (consumableTotals[itemHrid] || 0) + count;
        }

        // Track totals for net profit calculation
        let dropGoldPerHr = 0;
        let dropGoldTotal = 0;
        let consumableGoldPerHr = 0;
        let consumableGoldTotal = 0;
        let keyCostPerHr = 0;
        let keyCostTotal = 0;
        let dungeonKeyCosts = [];

        // Drops — calculated from kill counts × drop tables × multipliers
        if (gameData) {
            const dropMap = calculateExpectedDrops(simResult, gameData, activeTab);

            // Pre-compute gold values for sorting
            const dropData = [...dropMap.entries()]
                .filter(([, total]) => total > 0)
                .map(([itemHrid, total]) => {
                    const price = marketAPI.getPrice(itemHrid);
                    // Revenue: use sell price based on pricing mode
                    let unitValue = this._getSellPrice(price);
                    if (unitValue === 0 && itemHrid === '/items/coin') {
                        unitValue = 1;
                    }
                    if (unitValue === 0) {
                        // Use cached EV or calculate directly (matches combat stats approach)
                        const ev =
                            expectedValueCalculator.getCachedValue(itemHrid) ||
                            expectedValueCalculator.calculateSingleContainer(itemHrid);
                        if (ev !== null && ev > 0) unitValue = ev;
                    }
                    return { itemHrid, total, unitValue, totalGold: total * unitValue };
                })
                .sort((a, b) => b.totalGold - a.totalGold); // Sort by gold value descending

            if (dropData.length > 0) {
                const dropRowStyle = 'display:flex; align-items:center; padding:2px 0; font-size:12px; gap:6px;';
                const colNum = 'flex:0; white-space:nowrap; min-width:56px; text-align:right;';
                const colGold = 'flex:0; white-space:nowrap; min-width:76px; text-align:right; white-space:normal;';

                html += `<div style="${sectionStyle}">`;
                html += `<div style="${headingStyle}">${t('Drops')}</div>`;
                // Column headers
                html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
                html += `<span style="flex:1;">${t('Item')}</span>`;
                html += `<span style="${colNum}">${t('/hr')}</span>`;
                html += `<span style="${colNum}">${t('/day')}</span>`;
                html += `<span style="${colGold}">${t('Gold/hr')}</span>`;
                html += `<span style="${colGold}">${t('Gold/day')}</span>`;
                html += `<span style="${colNum}">${t('Total')}</span>`;
                html += `<span style="${colGold}">${t('Total Gold')}</span>`;
                html += '</div>';

                for (const drop of dropData) {
                    const perHr = drop.total / hours;
                    const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                    const name = itemDetails?.name || drop.itemHrid.split('/').pop();

                    const perHrStr = perHr >= 1 ? formatWithSeparator(Math.round(perHr)) : perHr.toFixed(2);
                    const perDay = perHr * 24;
                    const perDayStr = perDay >= 1 ? formatWithSeparator(Math.round(perDay)) : perDay.toFixed(2);
                    const totalStr =
                        drop.total >= 1 ? formatWithSeparator(Math.round(drop.total)) : drop.total.toFixed(2);

                    const goldPerHr = perHr * drop.unitValue;
                    dropGoldPerHr += goldPerHr;
                    dropGoldTotal += drop.totalGold;

                    const goldHrStr = drop.unitValue > 0 ? formatKMB(Math.round(goldPerHr)) : '—';
                    const goldDayStr = drop.unitValue > 0 ? formatKMB(Math.round(goldPerHr * 24)) : '—';
                    const goldTotalStr = drop.unitValue > 0 ? formatKMB(Math.round(drop.totalGold)) : '—';
                    const goldColor = drop.unitValue > 0 ? '#e8a87c' : '#444';

                    html += `<div style="${dropRowStyle}">`;
                    html += `<span style="${labelStyle} flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
                    html += `<span style="${valueStyle} ${colNum}">${perHrStr}</span>`;
                    html += `<span style="${valueStyle} ${colNum}">${perDayStr}</span>`;
                    html += `<span style="color:${goldColor}; font-weight:600; ${colGold}">${goldHrStr}</span>`;
                    html += `<span style="color:${goldColor}; font-weight:600; ${colGold}">${goldDayStr}</span>`;
                    html += `<span style="${valueStyle} ${colNum}">${totalStr}</span>`;
                    html += `<span style="color:${goldColor}; font-weight:600; ${colGold}">${goldTotalStr}</span>`;
                    html += '</div>';
                }
                // Totals row
                const prevRevPerHr = compMetrics?.revenuePerHr ?? null;
                const revDelta =
                    prevRevPerHr !== null && prevRevPerHr !== undefined
                        ? this._formatDelta(dropGoldPerHr, prevRevPerHr, true, true)
                        : '';
                html += `<div style="display:flex; align-items:center; padding:4px 0 0; font-size:12px; border-top:1px solid #333; margin-top:4px; gap:6px;">`;
                html += `<span style="color:#aaa; font-weight:700; flex:1;">${t('Total Revenue')}</span>`;
                const revDayDelta =
                    prevRevPerHr !== null && prevRevPerHr !== undefined
                        ? this._formatDelta(dropGoldPerHr * 24, prevRevPerHr * 24, true, true)
                        : '';
                html += `<span style="${colNum}"></span>`;
                html += `<span style="${colNum}"></span>`;
                html += `<span style="color:#e8a87c; font-weight:700; ${colGold}">${formatKMB(Math.round(dropGoldPerHr))}<br>${revDelta}</span>`;
                html += `<span style="color:#e8a87c; font-weight:700; ${colGold}">${formatKMB(Math.round(dropGoldPerHr * 24))}<br>${revDayDelta}</span>`;
                html += `<span style="${colNum}"></span>`;
                html += `<span style="color:#e8a87c; font-weight:700; ${colGold}">${formatKMB(Math.round(dropGoldTotal))}</span>`;
                html += '</div>';
                html += '</div>';
            }

            // Compute dungeon key costs from drop map
            if (simResult.isDungeon) {
                const getBuyPriceForKey = (keyHrid) => {
                    const price = marketAPI.getPrice(keyHrid);
                    return this._getBuyPrice(price);
                };
                dungeonKeyCosts = calculateDungeonKeyCosts(dropMap, getBuyPriceForKey);
                for (const key of dungeonKeyCosts) {
                    keyCostPerHr += (key.count / hours) * key.unitCost;
                    keyCostTotal += key.totalCost;
                }
            }
        }

        // Consumable costs — same column layout as drops
        const consumableEntries = Object.entries(consumableTotals)
            .map(([itemHrid, total]) => {
                const price = marketAPI.getPrice(itemHrid);
                const unitCost = this._getBuyPrice(price);
                return { itemHrid, total, unitCost, totalCost: total * unitCost };
            })
            .sort((a, b) => b.totalCost - a.totalCost);

        if (consumableEntries.length > 0) {
            const costRowStyle = 'display:flex; align-items:center; padding:2px 0; font-size:12px; gap:6px;';
            const colNum = 'flex:0; white-space:nowrap; min-width:56px; text-align:right;';
            const colGold = 'flex:0; white-space:nowrap; min-width:76px; text-align:right; white-space:normal;';
            const costColor = '#ff6b6b';

            html += `<div style="${sectionStyle}">`;
            html += `<div style="${headingStyle}">${t('Consumable Costs')}</div>`;
            // Column headers
            html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
            html += `<span style="flex:1;">${t('Item')}</span>`;
            html += `<span style="${colNum}">${t('/hr')}</span>`;
            html += `<span style="${colNum}">${t('/day')}</span>`;
            html += `<span style="${colGold}">${t('Cost/hr')}</span>`;
            html += `<span style="${colGold}">${t('Cost/day')}</span>`;
            html += `<span style="${colNum}">${t('Total')}</span>`;
            html += `<span style="${colGold}">${t('Total Cost')}</span>`;
            html += '</div>';

            for (const cons of consumableEntries) {
                const perHr = cons.total / hours;
                const itemDetails = dataManager.getItemDetails(cons.itemHrid);
                const name = itemDetails?.name || cons.itemHrid.split('/').pop();

                const perHrStr = formatWithSeparator(Math.round(perHr));
                const perDayStr = formatWithSeparator(Math.round(perHr * 24));
                const totalStr = formatWithSeparator(Math.round(cons.total));

                const costPerHr = perHr * cons.unitCost;
                consumableGoldPerHr += costPerHr;
                consumableGoldTotal += cons.totalCost;

                const costHrStr = cons.unitCost > 0 ? formatKMB(Math.round(costPerHr)) : '—';
                const costDayStr = cons.unitCost > 0 ? formatKMB(Math.round(costPerHr * 24)) : '—';
                const costTotalStr = cons.unitCost > 0 ? formatKMB(Math.round(cons.totalCost)) : '—';
                const cColor = cons.unitCost > 0 ? costColor : '#444';

                html += `<div style="${costRowStyle}">`;
                html += `<span style="${labelStyle} flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
                html += `<span style="${valueStyle} ${colNum}">${perHrStr}</span>`;
                html += `<span style="${valueStyle} ${colNum}">${perDayStr}</span>`;
                html += `<span style="color:${cColor}; font-weight:600; ${colGold}">${costHrStr}</span>`;
                html += `<span style="color:${cColor}; font-weight:600; ${colGold}">${costDayStr}</span>`;
                html += `<span style="${valueStyle} ${colNum}">${totalStr}</span>`;
                html += `<span style="color:${cColor}; font-weight:600; ${colGold}">${costTotalStr}</span>`;
                html += '</div>';
            }
            // Totals row
            const prevConsumableCostPerHr = compMetrics?.consumableCostPerHr ?? null;
            const expDelta =
                prevConsumableCostPerHr !== null && prevConsumableCostPerHr !== undefined
                    ? this._formatDelta(consumableGoldPerHr, prevConsumableCostPerHr, false, true)
                    : '';
            const expDayDelta =
                prevConsumableCostPerHr !== null && prevConsumableCostPerHr !== undefined
                    ? this._formatDelta(consumableGoldPerHr * 24, prevConsumableCostPerHr * 24, false, true)
                    : '';
            html += `<div style="display:flex; align-items:center; padding:4px 0 0; font-size:12px; border-top:1px solid #333; margin-top:4px; gap:6px;">`;
            html += `<span style="color:#aaa; font-weight:700; flex:1;">${t('Total Expenses')}</span>`;
            html += `<span style="${colNum}"></span>`;
            html += `<span style="${colNum}"></span>`;
            html += `<span style="color:${costColor}; font-weight:700; ${colGold}">${formatKMB(Math.round(consumableGoldPerHr))}<br>${expDelta}</span>`;
            html += `<span style="color:${costColor}; font-weight:700; ${colGold}">${formatKMB(Math.round(consumableGoldPerHr * 24))}<br>${expDayDelta}</span>`;
            html += `<span style="${colNum}"></span>`;
            html += `<span style="color:${costColor}; font-weight:700; ${colGold}">${formatKMB(Math.round(consumableGoldTotal))}</span>`;
            html += '</div>';
            html += '</div>';
        }

        // Dungeon key costs
        if (dungeonKeyCosts.length > 0) {
            const costRowStyle = 'display:flex; align-items:center; padding:2px 0; font-size:12px; gap:6px;';
            const colNum = 'flex:0; white-space:nowrap; min-width:56px; text-align:right;';
            const colGold = 'flex:0; white-space:nowrap; min-width:76px; text-align:right; white-space:normal;';
            const costColor = '#ff6b6b';

            html += `<div style="${sectionStyle}">`;
            html += `<div style="${headingStyle}">${t('Key Costs')}</div>`;
            html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
            html += `<span style="flex:1;">${t('Item')}</span>`;
            html += `<span style="${colNum}">${t('/hr')}</span>`;
            html += `<span style="${colNum}">${t('/day')}</span>`;
            html += `<span style="${colGold}">${t('Cost/hr')}</span>`;
            html += `<span style="${colGold}">${t('Cost/day')}</span>`;
            html += `<span style="${colNum}">${t('Total')}</span>`;
            html += `<span style="${colGold}">${t('Total Cost')}</span>`;
            html += '</div>';

            for (const key of dungeonKeyCosts) {
                const perHr = key.count / hours;
                const perHrStr = perHr >= 1 ? formatWithSeparator(Math.round(perHr)) : perHr.toFixed(2);
                const perDayStr = formatWithSeparator(Math.round(perHr * 24));
                const totalStr = key.count >= 1 ? formatWithSeparator(Math.round(key.count)) : key.count.toFixed(2);

                const costPerHr = perHr * key.unitCost;
                const costHrStr = key.unitCost > 0 ? formatKMB(Math.round(costPerHr)) : '—';
                const costDayStr = key.unitCost > 0 ? formatKMB(Math.round(costPerHr * 24)) : '—';
                const costTotalStr = key.unitCost > 0 ? formatKMB(Math.round(key.totalCost)) : '—';
                const cColor = key.unitCost > 0 ? costColor : '#444';

                html += `<div style="${costRowStyle}">`;
                html += `<span style="${labelStyle} flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${key.name}</span>`;
                html += `<span style="${valueStyle} ${colNum}">${perHrStr}</span>`;
                html += `<span style="${valueStyle} ${colNum}">${perDayStr}</span>`;
                html += `<span style="color:${cColor}; font-weight:600; ${colGold}">${costHrStr}</span>`;
                html += `<span style="color:${cColor}; font-weight:600; ${colGold}">${costDayStr}</span>`;
                html += `<span style="${valueStyle} ${colNum}">${totalStr}</span>`;
                html += `<span style="color:${cColor}; font-weight:600; ${colGold}">${costTotalStr}</span>`;
                html += '</div>';
            }

            // Totals row
            html += `<div style="display:flex; align-items:center; padding:4px 0 0; font-size:12px; border-top:1px solid #333; margin-top:4px; gap:6px;">`;
            html += `<span style="color:#aaa; font-weight:700; flex:1;">Total ${t('Key Costs')}</span>`;
            html += `<span style="${colNum}"></span>`;
            html += `<span style="${colNum}"></span>`;
            html += `<span style="color:${costColor}; font-weight:700; ${colGold}">${formatKMB(Math.round(keyCostPerHr))}</span>`;
            html += `<span style="color:${costColor}; font-weight:700; ${colGold}">${formatKMB(Math.round(keyCostPerHr * 24))}</span>`;
            html += `<span style="${colNum}"></span>`;
            html += `<span style="color:${costColor}; font-weight:700; ${colGold}">${formatKMB(Math.round(keyCostTotal))}</span>`;
            html += '</div>';
            html += '</div>';
        }

        // Net Profit (includes consumable costs + key costs)
        const totalExpensesPerHr = consumableGoldPerHr + keyCostPerHr;
        const totalExpensesTotal = consumableGoldTotal + keyCostTotal;
        const netProfitPerHr = dropGoldPerHr - totalExpensesPerHr;
        const netProfitTotal = dropGoldTotal - totalExpensesTotal;
        const profitColor = netProfitPerHr >= 0 ? '#7ec87e' : '#ff6b6b';
        const profitSign = netProfitPerHr >= 0 ? '' : '-';
        const totalProfitSign = netProfitTotal >= 0 ? '' : '-';

        // Metrics already pre-computed by _ensureHistoryMetrics

        // Compute delta from comparison entry
        const prevProfit = compMetrics?.profitPerHr ?? null;
        const profitDelta =
            prevProfit !== null && prevProfit !== undefined
                ? this._formatDelta(netProfitPerHr, prevProfit, true, true)
                : '';

        const netProfitPerDay = netProfitPerHr * 24;
        const profitDaySign = netProfitPerDay >= 0 ? '' : '-';

        html += `<div style="${sectionStyle}">`;
        html += `<div style="${headingStyle}">${t('Net Profit')}</div>`;
        const netColGold = 'flex:0; white-space:nowrap; min-width:76px; text-align:right; white-space:normal;';
        const netColNum = 'flex:0; white-space:nowrap; min-width:56px; text-align:right;';
        // Column headers
        html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
        html += `<span style="flex:1;"></span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColGold}">${t('/hr')}</span>`;
        html += `<span style="${netColGold}">${t('/day')}</span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColGold}">${t('Total')}</span>`;
        html += '</div>';
        html += `<div style="display:flex; align-items:center; padding:2px 0; font-size:13px; gap:6px;">`;
        html += `<span style="color:#aaa; font-weight:700; flex:1;">${t('Profit')}</span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColNum}"></span>`;
        const profitDayDelta =
            prevProfit !== null && prevProfit !== undefined
                ? this._formatDelta(netProfitPerDay, prevProfit * 24, true, true)
                : '';
        html += `<span style="color:${profitColor}; font-weight:700; ${netColGold}">${profitSign}${formatKMB(Math.abs(Math.round(netProfitPerHr)))}<br>${profitDelta}</span>`;
        html += `<span style="color:${profitColor}; font-weight:700; ${netColGold}">${profitDaySign}${formatKMB(Math.abs(Math.round(netProfitPerDay)))}<br>${profitDayDelta}</span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="color:${profitColor}; font-weight:700; ${netColGold}">${totalProfitSign}${formatKMB(Math.abs(Math.round(netProfitTotal)))}</span>`;
        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
        container.style.display = 'block';

        // Tab click handler — re-render with new active player
        container.querySelectorAll('[data-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._activePlayerTab = btn.dataset.tab;
                this._displayResults(this._lastSimResult, this._lastSimHours, this._lastGameData);
            });
        });

        // History row click handler — set comparison baseline
        container.querySelectorAll('[data-history-idx]').forEach((row) => {
            const idx = parseInt(row.dataset.historyIdx, 10);
            // Don't allow clicking the current result as comparison
            if (idx === this._simHistory.length - 1) return;
            row.addEventListener('click', () => {
                this._comparisonIndex = idx;
                this._displayResults(this._lastSimResult, this._lastSimHours, this._lastGameData);
            });
        });

        // Comparison: baseline selector
        const baselineSelect = container.querySelector('#mwi-csim-baseline-select');
        if (baselineSelect) {
            baselineSelect.addEventListener('change', () => {
                const newBase = parseInt(baselineSelect.value, 10);
                this._comparisonBaseline = newBase;
                // Remove the new baseline from comparison slots if present
                this._comparisonSlots = this._comparisonSlots.filter((i) => i !== newBase);
                this._displayResults(this._lastSimResult, this._lastSimHours, this._lastGameData);
            });
        }

        // Comparison: add sim dropdown
        const addCompSelect = container.querySelector('#mwi-csim-add-comparison');
        if (addCompSelect) {
            addCompSelect.addEventListener('change', () => {
                const idx = parseInt(addCompSelect.value, 10);
                if (!isNaN(idx) && !this._comparisonSlots.includes(idx)) {
                    this._comparisonSlots.push(idx);
                    this._activeDetailIndex = idx;
                    this._displayResults(this._lastSimResult, this._lastSimHours, this._lastGameData);
                }
            });
        }

        // Comparison: remove × buttons
        container.querySelectorAll('[data-remove-comparison]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.removeComparison, 10);
                this._comparisonSlots = this._comparisonSlots.filter((i) => i !== idx);
                this._displayResults(this._lastSimResult, this._lastSimHours, this._lastGameData);
            });
        });

        // History: delete result buttons
        container.querySelectorAll('[data-delete-history]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.deleteHistory, 10);
                this._deleteHistoryEntry(idx);
            });
        });

        // History collapsible toggle
        container.querySelectorAll('[data-toggle="history-section"]').forEach((el) => {
            el.addEventListener('click', () => {
                const section = container.querySelector('#mwi-csim-history-section');
                const arrow = container.querySelector('[data-arrow="history-section"]');
                if (section) {
                    const isOpen = section.style.display !== 'none';
                    section.style.display = isOpen ? 'none' : 'block';
                    if (arrow) arrow.innerHTML = isOpen ? '&#9654;' : '&#9660;';
                }
            });
        });
    }

    /**
     * Pre-compute and store metrics for the latest history entry if not yet populated.
     * Also ensures all history entries have metrics for comparison table.
     * @private
     */
    _ensureHistoryMetrics(simResult, hours, gameData, activeTab) {
        const latestEntry = this._simHistory[this._simHistory.length - 1];
        if (latestEntry && !latestEntry.metrics) {
            latestEntry.metrics = this._computeMetrics(simResult, hours, gameData, activeTab);
        }

        // Ensure all entries have metrics (for comparison table)
        for (const entry of this._simHistory) {
            if (!entry.metrics) {
                entry.metrics = this._computeMetrics(entry.simResult, entry.hours, entry.gameData, activeTab);
            }
        }
    }

    /**
     * Compute metrics for a sim result.
     * @private
     */
    _computeMetrics(simResult, hours, gameData, activeTab) {
        // Encounters
        const encountersPerHr = simResult.encounters / hours;

        // DPS from monster kills × HP
        let totalDamage = 0;
        const monsterDetailMap = gameData?.combatMonsterDetailMap || {};
        for (const [hrid, count] of Object.entries(simResult.deaths)) {
            if (hrid.startsWith('player')) continue;
            const monster = monsterDetailMap[hrid];
            if (monster?.combatDetails?.maxHitpoints) {
                totalDamage += count * monster.combatDetails.maxHitpoints;
            }
        }
        const dps = totalDamage / (hours * 3600);

        // XP/hr for active player
        let totalXpPerHr = 0;
        if (simResult.experienceGained?.[activeTab]) {
            for (const amount of Object.values(simResult.experienceGained[activeTab])) {
                totalXpPerHr += Math.round(amount / hours);
            }
        }

        // Revenue from drops
        let revenuePerHr = 0;
        if (gameData) {
            const dropMap = calculateExpectedDrops(simResult, gameData, activeTab);
            for (const [itemHrid, total] of dropMap.entries()) {
                if (total <= 0) continue;
                const price = marketAPI.getPrice(itemHrid);
                let unitValue = this._getSellPrice(price);
                if (unitValue === 0 && itemHrid === '/items/coin') unitValue = 1;
                if (unitValue === 0) {
                    const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                    if (evData?.expectedValue > 0) unitValue = evData.expectedValue;
                }
                revenuePerHr += (total / hours) * unitValue;
            }
        }

        // Expenses from consumables
        let consumableCostPerHr = 0;
        const selfConsumables = simResult.consumablesUsed?.[activeTab] || {};
        for (const [itemHrid, count] of Object.entries(selfConsumables)) {
            const price = marketAPI.getPrice(itemHrid);
            const unitCost = this._getBuyPrice(price);
            consumableCostPerHr += (count / hours) * unitCost;
        }

        // Dungeon key costs
        let keyCostPerHrMetric = 0;
        if (simResult.isDungeon && gameData) {
            const dropMap = calculateExpectedDrops(simResult, gameData, activeTab);
            const getBuyPriceForKey = (keyHrid) => {
                const price = marketAPI.getPrice(keyHrid);
                return this._getBuyPrice(price);
            };
            const keyCosts = calculateDungeonKeyCosts(dropMap, getBuyPriceForKey);
            for (const key of keyCosts) {
                keyCostPerHrMetric += (key.count / hours) * key.unitCost;
            }
        }

        const expensesPerHr = consumableCostPerHr + keyCostPerHrMetric;

        return {
            encountersPerHr,
            dps,
            totalXpPerHr,
            revenuePerHr,
            expensesPerHr,
            consumableCostPerHr,
            keyCostPerHr: keyCostPerHrMetric,
            profitPerHr: revenuePerHr - expensesPerHr,
            successRate: simResult.isDungeon
                ? simResult.dungeonsCompleted / Math.max(1, simResult.dungeonsCompleted + simResult.dungeonsFailed)
                : null,
        };
    }

    /**
     * Render the comparison panel with baseline + selected comparison sims.
     * @returns {string} HTML string
     * @private
     */
    /**
     * Delete a history entry by index and re-render results.
     * @param {number} idx - Index in _simHistory to remove
     * @private
     */
    _deleteHistoryEntry(idx) {
        if (idx < 0 || idx >= this._simHistory.length) return;

        this._simHistory.splice(idx, 1);

        // If only one or zero results remain, clear all comparison state
        if (this._simHistory.length <= 1) {
            this._comparisonBaseline = null;
            this._comparisonIndex = null;
            this._comparisonSlots = [];
        } else {
            // Adjust comparisonBaseline
            if (this._comparisonBaseline === idx) {
                this._comparisonBaseline = Math.max(0, this._simHistory.length - 1);
            } else if (this._comparisonBaseline !== null && this._comparisonBaseline > idx) {
                this._comparisonBaseline--;
            }

            // Adjust comparisonSlots
            this._comparisonSlots = this._comparisonSlots.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i));

            // Adjust comparisonIndex
            if (this._comparisonIndex === idx) {
                this._comparisonIndex = null;
            } else if (this._comparisonIndex !== null && this._comparisonIndex > idx) {
                this._comparisonIndex--;
            }
        }

        // Adjust activeDetailIndex
        if (this._activeDetailIndex === idx) {
            this._activeDetailIndex = this._simHistory.length > 0 ? this._simHistory.length - 1 : null;
        } else if (this._activeDetailIndex !== null && this._activeDetailIndex > idx) {
            this._activeDetailIndex--;
        }

        // If history is now empty, clear results display
        if (this._simHistory.length === 0) {
            this._lastSimResult = null;
            this._lastSimHours = null;
            this._lastGameData = null;
            const container = this.panel?.querySelector('#mwi-csim-results');
            if (container) container.style.display = 'none';
            return;
        }

        // Re-render with the active entry
        const activeEntry =
            this._activeDetailIndex !== null
                ? this._simHistory[this._activeDetailIndex]
                : this._simHistory[this._simHistory.length - 1];
        this._lastSimResult = activeEntry.simResult;
        this._lastSimHours = activeEntry.hours;
        this._lastGameData = activeEntry.gameData;
        this._displayResults(activeEntry.simResult, activeEntry.hours, activeEntry.gameData);
    }

    _renderHistoryPanel() {
        const history = this._simHistory;
        if (history.length < 2) return '';

        const baseIdx = this._comparisonBaseline ?? 0;
        const baseEntry = history[baseIdx];
        const baseM = baseEntry?.metrics;

        // Check if any sim is a dungeon
        const hasDungeon = history.some((e) => e.simResult?.isDungeon);

        let html = '<div style="margin-bottom:12px;">';
        html +=
            '<div style="color:' +
            ACCENT +
            '; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="history-section">';
        html +=
            '<span data-arrow="history-section" style="display:inline-block; width:14px; font-size:10px;">&#9660;</span> ' +
            t('Comparison ({0} runs)', history.length);
        html += '</div>';
        html += '<div id="mwi-csim-history-section" style="display:block;">';

        // Baseline selector
        html += '<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px; font-size:11px;">';
        html += '<span style="color:#888;">' + t('Baseline:') + '</span>';
        html +=
            '<select id="mwi-csim-baseline-select" style="flex:1; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:1px 4px; font-size:11px; font-family:inherit;">';
        for (let i = 0; i < history.length; i++) {
            const sel = i === baseIdx ? ' selected' : '';
            html += '<option value="' + i + '"' + sel + '>' + history[i].label + '</option>';
        }
        html += '</select></div>';

        // Table
        html += '<table style="width:100%; font-size:11px; border-collapse:collapse;">';
        html += '<tr style="border-bottom:1px solid #333; color:#666;">';
        html += '<th style="text-align:left; padding:2px 4px;">' + t('Scenario') + '</th>';
        html += '<th style="text-align:right; padding:2px 4px;">' + t('EPH') + '</th>';
        html += '<th style="text-align:right; padding:2px 4px;">' + t('DPS') + '</th>';
        html += '<th style="text-align:right; padding:2px 4px;">' + t('Profit/hr') + '</th>';
        html += '<th style="text-align:right; padding:2px 4px;">' + t('XP/hr') + '</th>';
        if (hasDungeon) html += '<th style="text-align:right; padding:2px 4px;">' + t('Success') + '</th>';
        html += '<th style="width:20px;"></th>';
        html += '<th style="width:20px;"></th>';
        html += '</tr>';

        // Baseline row
        const baseProfitColor = baseM?.profitPerHr >= 0 ? '#7ec87e' : '#ff6b6b';
        html += '<tr style="background:rgba(232,168,124,0.08);">';
        html +=
            '<td style="padding:2px 4px; color:#e8a87c; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' +
            baseEntry.label +
            '">★ ' +
            baseEntry.label +
            '</td>';
        html +=
            '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
            (baseM ? formatWithSeparator(Math.round(baseM.encountersPerHr)) : '—') +
            '</td>';
        html +=
            '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
            (baseM ? formatWithSeparator(Math.round(baseM.dps)) : '—') +
            '</td>';
        html +=
            '<td style="text-align:right; padding:2px 4px; color:' +
            baseProfitColor +
            ';">' +
            (baseM ? formatKMB(Math.round(baseM.profitPerHr)) : '—') +
            '</td>';
        html +=
            '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
            (baseM ? formatWithSeparator(Math.round(baseM.totalXpPerHr)) : '—') +
            '</td>';
        if (hasDungeon) {
            html +=
                '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
                (baseM?.successRate != null ? (baseM.successRate * 100).toFixed(1) + '%' : '—') +
                '</td>';
        }
        html += '<td></td>';
        html +=
            '<td style="text-align:center; padding:2px; cursor:pointer; color:#555;" data-delete-history="' +
            baseIdx +
            '" title="' +
            t('Delete result') +
            '">✕</td>';
        html += '</tr>';
        for (const idx of this._comparisonSlots) {
            if (idx === baseIdx || idx >= history.length) continue;
            const entry = history[idx];
            const m = entry.metrics;
            const profitColor = m?.profitPerHr >= 0 ? '#7ec87e' : '#ff6b6b';

            const ephDelta = baseM && m ? this._formatDelta(m.encountersPerHr, baseM.encountersPerHr, true) : '';
            const dpsDelta = baseM && m ? this._formatDelta(m.dps, baseM.dps, true) : '';
            const profitDelta = baseM && m ? this._formatDelta(m.profitPerHr, baseM.profitPerHr, true, true) : '';
            const xpDelta = baseM && m ? this._formatDelta(m.totalXpPerHr, baseM.totalXpPerHr, true) : '';

            html += '<tr>';
            html +=
                '<td style="padding:2px 4px; color:#ccc; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' +
                entry.label +
                '">' +
                entry.label +
                '</td>';
            html +=
                '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
                (m ? formatWithSeparator(Math.round(m.encountersPerHr)) : '—') +
                ephDelta +
                '</td>';
            html +=
                '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
                (m ? formatWithSeparator(Math.round(m.dps)) : '—') +
                dpsDelta +
                '</td>';
            html +=
                '<td style="text-align:right; padding:2px 4px; color:' +
                profitColor +
                ';">' +
                (m ? formatKMB(Math.round(m.profitPerHr)) : '—') +
                profitDelta +
                '</td>';
            html +=
                '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
                (m ? formatWithSeparator(Math.round(m.totalXpPerHr)) : '—') +
                xpDelta +
                '</td>';
            if (hasDungeon) {
                const successDelta =
                    baseM?.successRate != null && m?.successRate != null
                        ? this._formatDelta(m.successRate * 100, baseM.successRate * 100, true)
                        : '';
                html +=
                    '<td style="text-align:right; padding:2px 4px; color:#e0e0e0;">' +
                    (m?.successRate != null ? (m.successRate * 100).toFixed(1) + '%' : '—') +
                    successDelta +
                    '</td>';
            }
            html +=
                '<td style="text-align:center; padding:2px; cursor:pointer; color:#666;" data-remove-comparison="' +
                idx +
                '" title="' +
                t('Remove from comparison') +
                '">×</td>';
            html +=
                '<td style="text-align:center; padding:2px; cursor:pointer; color:#555;" data-delete-history="' +
                idx +
                '" title="' +
                t('Delete result') +
                '">✕</td>';
            html += '</tr>';
        }

        html += '</table>';

        // Add to comparison dropdown
        const available = [];
        for (let i = 0; i < history.length; i++) {
            if (i === baseIdx || this._comparisonSlots.includes(i)) continue;
            available.push(i);
        }
        if (available.length > 0) {
            html += '<div style="margin-top:6px;">';
            html +=
                '<select id="mwi-csim-add-comparison" style="width:100%; background:#1a1a2e; color:#aaa; border:1px solid #444; border-radius:4px; padding:2px 4px; font-size:11px; font-family:inherit;">';
            html += '<option value="">+ Add sim to comparison...</option>';
            for (const i of available) {
                html += '<option value="' + i + '">' + history[i].label + '</option>';
            }
            html += '</select></div>';
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Format a delta value as colored HTML span.
     * Returns empty string if no previous value or delta is zero.
     * @param {number} current - Current value
     * @param {number|null} previous - Previous value (null if no comparison)
     * @param {boolean} [higherIsBetter=true] - Whether higher values are positive
     * @param {boolean} [useKMB=false] - Use KMB formatting for the delta
     * @returns {string} HTML span or empty string
     * @private
     */
    _formatDelta(current, previous, higherIsBetter = true, useKMB = false) {
        if (previous === null || previous === undefined) return '';
        const delta = current - previous;
        if (Math.abs(delta) < 0.5) return '';
        const isPositive = higherIsBetter ? delta > 0 : delta < 0;
        const color = isPositive ? '#7ec87e' : '#ff6b6b';
        const sign = delta > 0 ? '+' : '';
        const formatted = useKMB ? formatKMB(Math.round(delta)) : formatWithSeparator(Math.round(delta));
        return ` <span style="color:${color}; font-size:11px;">(${sign}${formatted})</span>`;
    }

    /**
     * Format a deaths/hr value, showing decimals for low rates.
     * @param {number} value
     * @returns {string}
     * @private
     */
    _formatDeaths(value) {
        if (value === 0) return '0';
        if (value < 0.1) return value.toFixed(2);
        if (value < 1) return value.toFixed(1);
        return formatWithSeparator(Math.round(value));
    }

    /**
     * Format a rate value with one decimal place.
     * @param {number} value
     * @returns {string}
     * @private
     */
    _formatRate(value) {
        if (value === 0) return '0';
        if (value < 0.1) return value.toFixed(2);
        return (Math.round(value * 10) / 10).toString();
    }

    /**
     * Set the status bar text.
     * @param {string} text
     * @private
     */
    _setStatus(text) {
        const status = this.panel?.querySelector('#mwi-csim-status');
        if (status) status.textContent = text;
    }

    /**
     * Show a temporary warning toast overlaid on the panel.
     * @param {string} text - Warning message
     * @param {number} [duration=3000] - Duration in ms before auto-dismiss
     * @private
     */
    _showWarning(text, duration = 3000) {
        // Remove existing warning
        this.panel?.querySelector('.mwi-csim-warning')?.remove();

        const toast = document.createElement('div');
        toast.className = 'mwi-csim-warning';
        toast.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(30, 20, 10, 0.97);
            border: 1px solid rgba(255, 152, 0, 0.6);
            border-radius: 8px;
            padding: 12px 20px;
            color: #ffb74d;
            font-size: 13px;
            font-weight: 600;
            text-align: center;
            z-index: 10;
            max-width: 80%;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            animation: mwi-csim-fade-in 0.15s ease;
        `;
        toast.textContent = text;
        this.panel.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s ease';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Set up drag handling on the header element.
     * @param {HTMLElement} header
     * @private
     */
    _setupDrag(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'mwi-csim-close') return;
            this.isDragging = true;
            header.style.cursor = 'grabbing';
            const rect = this.panel.getBoundingClientRect();
            this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            bringPanelToFront(this.panel);

            const onMove = (ev) => {
                if (!this.isDragging) return;
                this.panel.style.left = `${ev.clientX - this.dragOffset.x}px`;
                this.panel.style.top = `${ev.clientY - this.dragOffset.y}px`;
                this.panel.style.right = 'auto';
            };
            const onUp = () => {
                this.isDragging = false;
                header.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /**
     * @private
     */
    _setupResize(handle) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = this.panel.offsetWidth;
            const startHeight = this.panel.offsetHeight;
            bringPanelToFront(this.panel);

            const onMove = (ev) => {
                const newWidth = Math.max(400, startWidth + (ev.clientX - startX));
                const newHeight = Math.max(300, startHeight + (ev.clientY - startY));
                this.panel.style.width = `${newWidth}px`;
                this.panel.style.height = `${newHeight}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /**
     * Open the sim panel pre-loaded with an external player DTO.
     * Used by the profile page "Sim Character" button.
     * @param {Object} dto - Player DTO in sim engine format
     * @param {string} playerName - Display name for the player tab
     */
    openWithExternalDTO(dto, playerName) {
        if (!this.panel) {
            this.buildPanel();
        }

        this._editor.openWithExternalDTO(dto, playerName);

        this.panel.style.display = 'flex';
        bringPanelToFront(this.panel);
        this.populateZones();
        this._switchTab('configure');
    }

    /**
     * Toggle panel visibility.
     */
    toggle() {
        if (!this.panel) return;
        const visible = this.panel.style.display !== 'none';
        this.panel.style.display = visible ? 'none' : 'flex';
        if (!visible) {
            bringPanelToFront(this.panel);
            this.populateZones();
            if (!this._editor.isInitialized()) {
                this._editor.initEditor();
            }
        }
    }

    /**
     * Remove the panel and clean up.
     */
    destroy() {
        if (this.elapsedTimer) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
        }
        if (this.panel) {
            unregisterFloatingPanel(this.panel);
            this.panel.remove();
            this.panel = null;
        }
        this.isRunning = false;

        // Clear cached character data so next open loads fresh state
        if (this._editor) this._editor.reset();
        this._lastSimResult = null;
        this._lastSimHours = null;
        this._lastGameData = null;
        this._simHistory = [];
        this._comparisonIndex = null;
        this._comparisonBaseline = null;
        this._comparisonSlots = [];
        this._activeDetailIndex = null;
        this._allZonesResults = null;
        this._seekResults = null;
    }

    /**
     * Get the sell price for an item based on the global pricing mode.
     * @param {Object} priceData - { bid, ask } from marketAPI
     * @returns {number}
     * @private
     */
    _getSellPrice(priceData) {
        if (!priceData) return 0;
        const mode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
        // conservative/patientBuy → bid; hybrid/optimistic → ask
        if (mode === 'conservative' || mode === 'patientBuy') {
            return priceData.bid > 0 ? priceData.bid : 0;
        }
        return priceData.ask > 0 ? priceData.ask : 0;
    }

    /**
     * Get the buy price for an item based on the global pricing mode.
     * @param {Object} priceData - { bid, ask } from marketAPI
     * @returns {number}
     * @private
     */
    _getBuyPrice(priceData) {
        if (!priceData) return 0;
        const mode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
        // optimistic/patientBuy → bid; conservative/hybrid → ask
        if (mode === 'optimistic' || mode === 'patientBuy') {
            return priceData.bid > 0 ? priceData.bid : 0;
        }
        return priceData.ask > 0 ? priceData.ask : 0;
    }

    /**
     * Populate the player selector dropdown in the Upgrade tab.
     * @private
     */
    _populateUpgradePlayerSelector() {
        const select = this.panel?.querySelector('#mwi-csim-upgrade-player');
        if (!select) return;

        const playerInfo = this._editor?.getPlayerInfo() || [];
        select.innerHTML = '';
        playerInfo.forEach((p, i) => {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = p.name || `Player ${i + 1}`;
            select.appendChild(option);
        });

        if (playerInfo.length === 0) {
            const option = document.createElement('option');
            option.value = 0;
            option.textContent = 'Player 1';
            select.appendChild(option);
        }
    }

    /**
     * Set default ability target level input to increment mode with value 5.
     * @private
     */
    _setDefaultAbilityTargetLevel() {
        const typeSelect = this.panel.querySelector('#mwi-csim-upgrade-level-type');
        const input = this.panel.querySelector('#mwi-csim-upgrade-target-level');
        if (!input) return;
        if (typeSelect) typeSelect.value = 'increment';
        input.value = '5';
        input.placeholder = '+5';
        input.title = t('Number of levels to add to each ability');
    }

    /**
     * Run upgrade analysis when Analyze button is clicked.
     * @private
     */
    async _onUpgradeAnalyze() {
        const zoneHrid = this.panel.querySelector('#mwi-csim-zone')?.value;
        const difficultyTier = parseInt(this.panel.querySelector('#mwi-csim-tier')?.value) || 0;
        const hours = Math.min(
            10000,
            Math.max(
                1,
                parseInt(this.panel.querySelector('#mwi-csim-hours')?.value) ||
                    config.getSettingValue('combatSim_defaultHours', 100)
            )
        );
        const playerIndex = parseInt(this.panel.querySelector('#mwi-csim-upgrade-player')?.value) || 0;
        const upgradeMode = this.panel.querySelector('#mwi-csim-upgrade-mode')?.value || 'equipment';
        const abilityLevelType = this.panel.querySelector('#mwi-csim-upgrade-level-type')?.value || 'increment';
        const abilityTargetLevel = Math.min(
            200,
            parseInt(this.panel.querySelector('#mwi-csim-upgrade-target-level')?.value) || 0
        );

        if (!zoneHrid) {
            this._setStatus(t('Select a zone in Configure tab first.'));
            return;
        }

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        // Get player DTOs (edited or live)
        let playerDTOs;
        const editedDTOs = this._editor?.getEditedDTOs();
        if (editedDTOs) {
            playerDTOs = Object.values(editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
        }

        if (!playerDTOs?.length || !playerDTOs[playerIndex]) {
            this._setStatus(t('No player data available. Configure a simulation first.'));
            return;
        }

        // Show progress, hide results
        const progressEl = this.panel.querySelector('#mwi-csim-upgrade-progress');
        const resultsEl = this.panel.querySelector('#mwi-csim-upgrade-results');
        const runBtn = this.panel.querySelector('#mwi-csim-upgrade-run');
        const stopBtn = this.panel.querySelector('#mwi-csim-upgrade-stop');
        progressEl.style.display = 'block';
        resultsEl.innerHTML = '';
        runBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        this._upgradeAborted = false;

        const communityBuffs = getCommunityBuffs();

        try {
            const results = await runUpgradeAnalysis(
                {
                    playerDTOs,
                    playerIndex,
                    zoneHrid,
                    difficultyTier,
                    hours,
                    communityBuffs,
                    upgradeMode,
                    abilityLevelType,
                    abilityTargetLevel,
                },
                ({ current, total, description }) => {
                    if (this._upgradeAborted) return;
                    const fill = this.panel.querySelector('#mwi-csim-upgrade-progress-fill');
                    const text = this.panel.querySelector('#mwi-csim-upgrade-progress-text');
                    const pct = Math.round((current / total) * 100);
                    if (fill) fill.style.width = pct + '%';
                    if (text) text.textContent = `${current} / ${total}`;
                    this._setStatus(description);
                },
                { abortSignal: () => this._upgradeAborted }
            );

            if (this._upgradeAborted) {
                this._setStatus(t('Analysis cancelled.'));
            } else {
                this._renderUpgradeResults(results);
                this._setStatus(`Analysis complete. ${results.results.length} upgrades evaluated.`);
            }
        } catch (error) {
            console.error('[CombatSimUI] Upgrade analysis failed:', error);
            this._setStatus(t('Analysis failed:') + ' ' + error.message);
        } finally {
            progressEl.style.display = 'none';
            runBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        }
    }

    /**
     * Render upgrade analysis results as an expandable table.
     * @param {Object} results - { baseline, results: [{candidate, cost, metrics, deltas, goldPer}] }
     * @private
     */
    _renderUpgradeResults(results) {
        const container = this.panel.querySelector('#mwi-csim-upgrade-results');
        if (!container) return;

        if (!results.results.length) {
            container.innerHTML =
                '<div style="color:#888; text-align:center; padding:20px;">No upgrade candidates found. Ensure equipment is configured.</div>';
            return;
        }

        const tableStyle = 'width:100%; border-collapse:collapse; font-size:11px;';
        const thStyle = 'padding:4px 6px; text-align:left; border-bottom:1px solid #333; color:#888; font-weight:600;';
        const tdStyle = 'padding:4px 6px; border-bottom:1px solid #1a1a2e;';

        let html = `<table style="${tableStyle}">
            <thead><tr>
                <th style="${thStyle}">${t('Upgrade')}</th>
                <th style="${thStyle}">${t('Cost')}</th>
                <th style="${thStyle}">${t('Gold/0.1% DPS')}</th>
                <th style="${thStyle}">${t('Gold/0.1% EXP')}</th>
                <th style="${thStyle}">${t('Gold/0.1% Profit')}</th>
            </tr></thead><tbody>`;

        // Find best (lowest non-Infinity) value in each gold/0.1% column
        let bestDps = Infinity;
        let bestXp = Infinity;
        let bestProfit = Infinity;
        for (const r of results.results) {
            if (r.goldPer.dps < bestDps) bestDps = r.goldPer.dps;
            if (r.goldPer.xp < bestXp) bestXp = r.goldPer.xp;
            if (r.goldPer.profit < bestProfit) bestProfit = r.goldPer.profit;
        }

        results.results.forEach((r, i) => {
            const costStr = formatKMB(r.cost);
            const rowColor = r.deltas.dps > 0 || r.deltas.profit > 0 ? '#e0e0e0' : '#888';

            const fmtGoldPer = (val) => (val === Infinity ? '—' : formatKMB(val));
            const bestColor = '#4caf50';
            const dpsGoldStr = fmtGoldPer(r.goldPer.dps);
            const xpGoldStr = fmtGoldPer(r.goldPer.xp);
            const profitGoldStr = fmtGoldPer(r.goldPer.profit);
            const dpsStyle =
                r.goldPer.dps === bestDps && bestDps !== Infinity ? `color:${bestColor}; font-weight:700;` : '';
            const xpStyle =
                r.goldPer.xp === bestXp && bestXp !== Infinity ? `color:${bestColor}; font-weight:700;` : '';
            const profitStyle =
                r.goldPer.profit === bestProfit && bestProfit !== Infinity
                    ? `color:${bestColor}; font-weight:700;`
                    : '';

            html += `<tr style="cursor:pointer; color:${rowColor};" data-upgrade-row="${i}">
                <td style="${tdStyle}">${r.candidate.description}</td>
                <td style="${tdStyle}">${costStr}</td>
                <td style="${tdStyle} ${dpsStyle}">${dpsGoldStr}</td>
                <td style="${tdStyle} ${xpStyle}">${xpGoldStr}</td>
                <td style="${tdStyle} ${profitStyle}">${profitGoldStr}</td>
            </tr>`;

            // Expanded detail row with deltas (hidden by default)
            const dpsValueDelta = r.metrics.dps - results.baseline.dps;
            const xpValueDelta = r.metrics.xpPerHour - results.baseline.xpPerHour;
            const profitValueDelta = r.metrics.profitPerHour - results.baseline.profitPerHour;
            const ephDelta = r.metrics.encountersPerHour - results.baseline.encountersPerHour;
            const dphDelta = r.metrics.deathsPerHour - results.baseline.deathsPerHour;
            const fmtDelta = (val) => {
                if (Math.abs(val) < 0.5) return '—';
                return (val >= 0 ? '+' : '') + formatKMB(val);
            };
            const fmtDeltaSmall = (val) => {
                if (Math.abs(val) < 0.01) return '—';
                return (val >= 0 ? '+' : '') + val.toFixed(1);
            };
            const deltaColor = (val) => (val > 0.5 ? '#4caf50' : val < -0.5 ? '#f44336' : '#888');
            // For deaths, lower is better (inverted color)
            const deathDeltaColor = (val) => (val < -0.01 ? '#4caf50' : val > 0.01 ? '#f44336' : '#888');

            html += `<tr data-upgrade-detail="${i}" style="display:none;">
                <td colspan="5" style="padding:6px 12px; background:#0d0d1a; border-bottom:1px solid #222;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr; gap:8px; font-size:11px;">
                        <div>
                            <div style="color:#888;">${t('DPS')}</div>
                            <div style="color:#e0e0e0;">${formatKMB(r.metrics.dps)}</div>
                            <div style="color:${deltaColor(dpsValueDelta)};">${fmtDelta(dpsValueDelta)} (${r.deltas.dps >= 0 ? '+' : ''}${r.deltas.dps.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">${t('EXP/hr')}</div>
                            <div style="color:#e0e0e0;">${formatKMB(r.metrics.xpPerHour)}</div>
                            <div style="color:${deltaColor(xpValueDelta)};">${fmtDelta(xpValueDelta)} (${r.deltas.xp >= 0 ? '+' : ''}${r.deltas.xp.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">${t('Profit/hr')}</div>
                            <div style="color:#e0e0e0;">${formatKMB(r.metrics.profitPerHour)}</div>
                            <div style="color:${deltaColor(profitValueDelta)};">${fmtDelta(profitValueDelta)} (${r.deltas.profit >= 0 ? '+' : ''}${r.deltas.profit.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">${t('EPH')}</div>
                            <div style="color:#e0e0e0;">${r.metrics.encountersPerHour.toFixed(1)}</div>
                            <div style="color:${deltaColor(ephDelta)};">${fmtDeltaSmall(ephDelta)} (${r.deltas.encounters >= 0 ? '+' : ''}${r.deltas.encounters.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">${t('DPH')}</div>
                            <div style="color:#e0e0e0;">${r.metrics.deathsPerHour.toFixed(1)}</div>
                            <div style="color:${deathDeltaColor(dphDelta)};">${fmtDeltaSmall(dphDelta)} (${r.deltas.deaths >= 0 ? '+' : ''}${r.deltas.deaths.toFixed(2)}%)</div>
                        </div>
                    </div>
                    <div style="margin-top:6px; color:#666; font-size:10px;">
                        ${t('Baseline:')} DPS ${formatKMB(results.baseline.dps)} | EXP ${formatKMB(results.baseline.xpPerHour)} | Profit ${formatKMB(results.baseline.profitPerHour)} | EPH ${results.baseline.encountersPerHour.toFixed(1)} | DPH ${results.baseline.deathsPerHour.toFixed(1)}
                    </div>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // Wire up row click to expand/collapse
        container.querySelectorAll('[data-upgrade-row]').forEach((row) => {
            row.addEventListener('click', () => {
                const idx = row.getAttribute('data-upgrade-row');
                const detail = container.querySelector(`[data-upgrade-detail="${idx}"]`);
                if (detail) {
                    detail.style.display = detail.style.display === 'none' ? 'table-row' : 'none';
                }
            });
        });
    }
}

const combatSimUI = new CombatSimUI();
export default combatSimUI;
