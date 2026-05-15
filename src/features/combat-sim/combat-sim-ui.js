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
    applyLoadoutSnapshotToDTO,
    parseShykaiImport,
    getZonesThatDropItem,
    getLabyrinthMonsters,
} from './combat-sim-adapter.js';
import { runSimulation, cancelSimulation, runLabyrinthSimulation } from './combat-sim-runner.js';
import { findMaxLabyrinthLevel } from './labyrinth-level-finder.js';
import { runAllZonesSimulation, cancelAllZonesSimulation } from './all-zones-runner.js';
import { runUpgradeAnalysis, runLabyrinthUpgradeAnalysis } from './upgrade-advisor.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';

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
        // Loadout editor state
        this._editedDTOs = null;
        this._editedPlayerInfo = null;
        this._originalDTOs = null;
        this._openSections = new Set(); // track which editor sections are expanded
        this._activeMainTab = 'configure';
        this._activeEditPlayer = null;
        this._selfHrid = null;
        this._missingMembers = [];
        this._editorInitialized = false;
        this._selectedLoadoutName = ''; // Track selected loadout for dropdown persistence
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
        // Labyrinth state
        this._labyFindMaxMode = false;
        this._labyResults = null;
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
            max-height: 600px;
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
            <span style="font-weight:700; font-size:14px; color:${ACCENT};">Combat Simulator</span>
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
            <button id="mwi-csim-tab-configure" style="${tabStyle(true)}">Configure</button>
            <button id="mwi-csim-tab-results" style="${tabStyle(false)}">Results</button>
            <button id="mwi-csim-tab-seek" style="${tabStyle(false)}">Seek</button>
            <button id="mwi-csim-tab-labyrinth" style="${tabStyle(false)}">Labyrinth</button>
            <button id="mwi-csim-tab-upgrade" style="${tabStyle(false)}">Upgrade</button>
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
            <label style="color:#888; font-size:12px;">Zone</label>
            <select id="mwi-csim-zone" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">Tier</label>
            <select id="mwi-csim-tier" style="${selectStyle} flex:0; width:64px; min-width:64px;">
            </select>
            <label style="color:#888; font-size:12px;">Hours</label>
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
                cursor: pointer;">Simulate</button>
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
                Sim All Zones
            </label>
            <label style="${labelStyle}">
                <input type="checkbox" id="mwi-csim-allzones-solo" style="${checkboxStyle}">
                Sim All Solo
            </label>
            <label id="mwi-csim-allzones-hours-label" style="color:#888; font-size:12px; display:none;">Hours</label>
            <input id="mwi-csim-allzones-hours" type="number" min="1" max="10000" value="${config.getSettingValue('combatSim_allZonesDefaultHours', 10)}" style="display:none; width:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center;">
            <label id="mwi-csim-earlyexit-label" style="${labelStyle} display:none;" title="Stop simming higher tiers for a zone if both XP/hr and profit/hr declined vs the previous tier">
                <input type="checkbox" id="mwi-csim-earlyexit" style="${checkboxStyle}" checked>
                Skip Worse Tiers
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
        editorArea.innerHTML = `<div style="color:#555; font-size:12px; text-align:center; padding:20px 0;">Loading loadout...</div>`;

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
                    flex-shrink:0;">Stop</button>
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
            <label style="color:#888; font-size:12px;">Item</label>
            <input id="mwi-csim-seek-input" type="text" placeholder="Search item..." style="
                flex:1; min-width:0;
                background:#1a1a2e; color:#e0e0e0;
                border:1px solid #444; border-radius:4px;
                padding:3px 6px; font-size:12px; font-family:inherit;">
            <label style="color:#888; font-size:12px;">Hours</label>
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
                font-family: inherit;">Seek</button>
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
                font-family:inherit;">Stop</button>
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
            <label style="color:#888; font-size:12px;">Player</label>
            <select id="mwi-csim-upgrade-player" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">Mode</label>
            <select id="mwi-csim-upgrade-mode" style="${selectStyle}">
                <option value="equipment">Equipment</option>
                <option value="ability_level">Ability Levels</option>
                <option value="ability_swap">Ability Swaps</option>
                <option value="labyrinth">Labyrinth Win Rate</option>
            </select>
            <span id="mwi-csim-upgrade-level-group" style="display:none; align-items:center; gap:4px;">
                <select id="mwi-csim-upgrade-level-type" style="
                    background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                    border-radius:3px; padding:3px 5px; font-size:12px;">
                    <option value="increment">+Levels</option>
                    <option value="target">Target Lv</option>
                </select>
                <input id="mwi-csim-upgrade-target-level" type="number" min="1" max="200" value="5" placeholder="+5" style="
                    width:55px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                    border-radius:3px; padding:3px 5px; font-size:12px; text-align:center;"
                    title="Number of levels to add to each ability">
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
                font-family: inherit;">Analyze</button>
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
                font-family:inherit;">Stop</button>
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

        // Labyrinth tab content
        const labyrinthContent = document.createElement('div');
        labyrinthContent.id = 'mwi-csim-labyrinth-content';
        labyrinthContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        const labyControls = document.createElement('div');
        labyControls.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;
        labyControls.innerHTML = `
            <label style="color:#888; font-size:12px;">Monster</label>
            <select id="mwi-csim-laby-monster" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">Level</label>
            <input id="mwi-csim-laby-level" type="number" min="20" max="300" value="100" style="${inputStyle}">
            <label style="color:#888; font-size:12px;">Hours</label>
            <input id="mwi-csim-laby-hours" type="number" min="1" max="10000" value="10" style="${inputStyle}">
            <button id="mwi-csim-laby-run" style="
                margin-left: auto;
                background: ${ACCENT_BTN_BG};
                color: ${ACCENT};
                border: 1px solid ${ACCENT_BTN_BORDER};
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;">Simulate</button>
        `;

        const labyCrateRow = document.createElement('div');
        labyCrateRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
            font-size: 12px;
        `;
        const crateSelectStyle =
            'background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px;';
        labyCrateRow.innerHTML = `
            <label style="color:#888;">Coffee</label>
            <select id="mwi-csim-laby-coffee" style="${crateSelectStyle}">
                <option value="">None</option>
                <option value="/items/basic_coffee_crate">Basic</option>
                <option value="/items/advanced_coffee_crate">Advanced</option>
                <option value="/items/expert_coffee_crate" selected>Expert</option>
            </select>
            <label style="color:#888;">Food</label>
            <select id="mwi-csim-laby-food" style="${crateSelectStyle}">
                <option value="">None</option>
                <option value="/items/basic_food_crate">Basic</option>
                <option value="/items/advanced_food_crate">Advanced</option>
                <option value="/items/expert_food_crate" selected>Expert</option>
            </select>
            <label style="display:flex; align-items:center; gap:4px; color:#888; cursor:pointer; margin-left:auto;" title="Binary search for highest beatable level at the specified win rate threshold">
                <input type="checkbox" id="mwi-csim-laby-findmax" style="margin:0; cursor:pointer;">
                Find Max ≥
            </label>
            <input id="mwi-csim-laby-threshold" type="number" min="1" max="100" value="95" style="width:44px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 4px; font-size:12px; text-align:center;">
            <span style="color:#888; font-size:12px;">%</span>
        `;

        const labyProgress = document.createElement('div');
        labyProgress.id = 'mwi-csim-laby-progress';
        labyProgress.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        labyProgress.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="
                    flex:1;
                    background:#1a1a2e;
                    border-radius:4px;
                    height:18px;
                    overflow:hidden;
                    position:relative;
                    border:1px solid #333;">
                    <div id="mwi-csim-laby-progress-fill" style="
                        height:100%;
                        width:0%;
                        background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT});
                        border-radius:3px;
                        transition:width 0.2s ease;"></div>
                    <span id="mwi-csim-laby-progress-text" style="
                        position:absolute;
                        top:0; left:0; right:0;
                        text-align:center;
                        font-size:11px;
                        line-height:18px;
                        color:#e0e0e0;
                        font-weight:600;">0%</span>
                </div>
                <button id="mwi-csim-laby-stop" style="
                    background:rgba(255,80,80,0.2);
                    color:#f44;
                    border:1px solid rgba(255,80,80,0.4);
                    border-radius:4px;
                    padding:2px 10px;
                    font-size:11px;
                    cursor:pointer;
                    font-weight:600;">Stop</button>
            </div>
        `;

        const labyResults = document.createElement('div');
        labyResults.id = 'mwi-csim-laby-results';
        labyResults.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';

        labyrinthContent.appendChild(labyControls);
        labyrinthContent.appendChild(labyCrateRow);
        labyrinthContent.appendChild(labyProgress);
        labyrinthContent.appendChild(labyResults);

        // Status bar
        const status = document.createElement('div');
        status.id = 'mwi-csim-status';
        status.style.cssText =
            'padding:6px 14px; color:#555; font-size:11px; border-top:1px solid #1a1a1a; flex-shrink:0; text-align:center;';
        status.textContent = 'Select a zone and click Simulate.';

        this.panel.appendChild(header);
        this.panel.appendChild(tabBar);
        this.panel.appendChild(configureContent);
        this.panel.appendChild(resultsContent);
        this.panel.appendChild(seekContent);
        this.panel.appendChild(labyrinthContent);
        this.panel.appendChild(upgradeContent);
        this.panel.appendChild(status);
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
        this.panel
            .querySelector('#mwi-csim-tab-labyrinth')
            .addEventListener('click', () => this._switchTab('labyrinth'));
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
            if (e.target.value === 'labyrinth') {
                this._setStatus('Uses monster/level/crates from Labyrinth tab. Click Analyze.');
            }
        });
        this.panel.querySelector('#mwi-csim-upgrade-level-type').addEventListener('change', (e) => {
            const input = this.panel.querySelector('#mwi-csim-upgrade-target-level');
            if (e.target.value === 'increment') {
                input.value = '5';
                input.placeholder = '+5';
                input.title = 'Number of levels to add to each ability';
            } else {
                input.value = '';
                input.placeholder = 'e.g. 80';
                input.title = 'Absolute target level for all abilities';
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

        // Labyrinth listeners
        this.panel.querySelector('#mwi-csim-laby-run').addEventListener('click', () => this._onLabyrinthSimulate());
        this.panel.querySelector('#mwi-csim-laby-stop').addEventListener('click', () => {
            cancelSimulation();
            this.isRunning = false;
            this._setStatus('Labyrinth simulation cancelled.');
            this.panel.querySelector('#mwi-csim-laby-progress').style.display = 'none';
        });
        this.panel.querySelector('#mwi-csim-laby-findmax').addEventListener('change', (e) => {
            this._labyFindMaxMode = e.target.checked;
            const levelInput = this.panel.querySelector('#mwi-csim-laby-level');
            levelInput.disabled = e.target.checked;
            levelInput.style.opacity = e.target.checked ? '0.4' : '1';
        });

        this.populateZones();
        this._populateLabyrinthMonsters();
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
                Check All
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
            { key: 'totalXP', label: 'Total XP/hr' },
            { key: 'profitDay', label: 'Profit/day' },
            { key: 'stamina', label: 'Stam' },
            { key: 'intelligence', label: 'Int' },
            { key: 'attack', label: 'Atk' },
            { key: 'melee', label: 'Melee' },
            { key: 'defense', label: 'Def' },
            { key: 'ranged', label: 'Ranged' },
            { key: 'magic', label: 'Magic' },
        ];

        const cols = [
            { key: 'zone', label: 'Zone' },
            { key: 'tier', label: 'T' },
            { key: 'encounters', label: 'Enc/hr' },
            { key: 'deaths', label: 'Deaths/hr' },
            ...skillCols,
            { key: 'revenue', label: 'Rev/hr' },
            { key: 'expenses', label: 'Cost/hr' },
            { key: 'profit', label: 'Profit/hr' },
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
                for (const spawn of spawns) {
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
                this._setStatus('No item selected. Type a name and pick from the list.');
                return;
            }
        }

        const { itemHrid, name: itemName } = this._seekSelectedItem;

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus('No game data available.');
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
        if (this._editedDTOs) {
            playerDTOs = Object.values(this._editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
            this._playerInfo = result.playerInfo;
            this._activePlayerTab = result.selfHrid;
            this._selfHrid = result.selfHrid;
        }

        if (!playerDTOs.length) {
            this._setStatus('No character data available.');
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
            this._setStatus(`Seeking ${itemName} in ${zoneCount} zone/tiers... ${formatElapsed(elapsed)}`);
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
            this._setStatus(`Seek complete in ${totalElapsed}: ${seekRows.length} sources found for ${itemName}`);
        } catch (error) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            if (error.message === 'Cancelled') {
                this._setStatus('Seek cancelled.');
            } else {
                console.error('[CombatSimUI] Seek simulation failed:', error);
                this._setStatus(`Seek error: ${error.message || 'Unknown error'}`);
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
     * Import players from parsed Shykai export data into the editor.
     * Appends to existing roster. Each import adds player(s) to the next available slot(s).
     * @param {Array<Object>} players - Array of player DTOs
     * @param {Array<string>} names - Array of player names
     * @private
     */
    _importPlayers(players, names) {
        if (!this._editedDTOs) {
            this._editedDTOs = {};
            this._originalDTOs = {};
            this._editedPlayerInfo = [];
        }

        // Find next available slot number
        const existingSlots = this._editedPlayerInfo.map((p) => {
            const match = p.hrid.match(/player(\d+)/);
            return match ? parseInt(match[1]) : 0;
        });
        let nextSlot = existingSlots.length > 0 ? Math.max(...existingSlots) + 1 : 1;

        for (let i = 0; i < players.length; i++) {
            const dto = players[i];
            dto.hrid = `player${nextSlot}`;
            this._editedDTOs[dto.hrid] = dto;
            this._originalDTOs[dto.hrid] = structuredClone(dto);
            this._editedPlayerInfo.push({ hrid: dto.hrid, name: names[i] || `Player ${nextSlot}` });
            nextSlot++;
        }

        this._activeEditPlayer = this._editedPlayerInfo[this._editedPlayerInfo.length - 1]?.hrid;
        this._selfHrid = this._selfHrid || null;
        this._missingMembers = [];
        this._editorInitialized = true;
        this._selectedLoadoutName = '';

        this._renderEditor();
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
        const labyrinthContent = this.panel.querySelector('#mwi-csim-labyrinth-content');
        const tabConfigure = this.panel.querySelector('#mwi-csim-tab-configure');
        const tabResults = this.panel.querySelector('#mwi-csim-tab-results');
        const tabSeek = this.panel.querySelector('#mwi-csim-tab-seek');
        const tabUpgrade = this.panel.querySelector('#mwi-csim-tab-upgrade');
        const tabLabyrinth = this.panel.querySelector('#mwi-csim-tab-labyrinth');

        const activeStyle = `flex:1; padding:7px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all 0.1s; background:${ACCENT_BG}; color:${ACCENT}; border-bottom:2px solid ${ACCENT};`;
        const inactiveStyle =
            'flex:1; padding:7px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all 0.1s; background:transparent; color:#888; border-bottom:2px solid transparent;';

        configureContent.style.display = 'none';
        resultsContent.style.display = 'none';
        if (seekContent) seekContent.style.display = 'none';
        if (upgradeContent) upgradeContent.style.display = 'none';
        if (labyrinthContent) labyrinthContent.style.display = 'none';
        tabConfigure.style.cssText = inactiveStyle;
        tabResults.style.cssText = inactiveStyle;
        if (tabSeek) tabSeek.style.cssText = inactiveStyle;
        if (tabUpgrade) tabUpgrade.style.cssText = inactiveStyle;
        if (tabLabyrinth) tabLabyrinth.style.cssText = inactiveStyle;

        if (tab === 'configure') {
            configureContent.style.display = 'flex';
            tabConfigure.style.cssText = activeStyle;
            this._setStatus('Select a zone and click Simulate.');
        } else if (tab === 'seek') {
            if (seekContent) seekContent.style.display = 'flex';
            if (tabSeek) tabSeek.style.cssText = activeStyle;
            this._populateSeekItems();
            this._setStatus('Search for a combat drop item, then click Seek.');
        } else if (tab === 'labyrinth') {
            if (labyrinthContent) labyrinthContent.style.display = 'flex';
            if (tabLabyrinth) tabLabyrinth.style.cssText = activeStyle;
            this._setStatus('Select a monster and click Simulate.');
        } else if (tab === 'upgrade') {
            if (upgradeContent) upgradeContent.style.display = 'flex';
            if (tabUpgrade) tabUpgrade.style.cssText = activeStyle;
            this._populateUpgradePlayerSelector();
            this._setStatus('Select a player and click Analyze.');
        } else {
            resultsContent.style.display = 'flex';
            tabResults.style.cssText = activeStyle;
            if (!this.isRunning && !this._lastSimResult && !this._allZonesResults) {
                this._setStatus('No results yet. Run a simulation first.');
            }
        }
    }

    /**
     * Initialize the loadout editor by loading DTOs from live data.
     * @private
     */
    async _initEditor() {
        const editorArea = this.panel?.querySelector('#mwi-csim-editor');
        if (!editorArea) return;

        try {
            const { players, playerInfo, selfHrid, missingMembers } = await buildAllPlayerDTOs();
            if (!players.length) {
                editorArea.innerHTML =
                    '<div style="color:#555; font-size:12px; text-align:center; padding:20px 0;">No character data available.</div>';
                return;
            }

            // Build DTO map keyed by hrid
            const dtoMap = {};
            for (const p of players) {
                dtoMap[p.hrid] = p;
            }

            this._originalDTOs = structuredClone(dtoMap);
            this._editedDTOs = structuredClone(dtoMap);
            this._editedPlayerInfo = playerInfo;
            this._selfHrid = selfHrid;
            this._activeEditPlayer = selfHrid;
            this._missingMembers = missingMembers;
            this._editorInitialized = true;

            this._renderEditor();
        } catch (error) {
            console.error('[CombatSimUI] Failed to init editor:', error);
            editorArea.innerHTML =
                '<div style="color:#f66; font-size:12px; text-align:center; padding:20px 0;">Failed to load character data.</div>';
        }
    }

    /**
     * Render the loadout editor for the active player.
     * @private
     */
    _renderEditor() {
        const editorArea = this.panel?.querySelector('#mwi-csim-editor');
        if (!editorArea || !this._editedDTOs) return;

        const playerInfo = this._editedPlayerInfo || [];
        const activePlayer = this._activeEditPlayer;
        const dto = this._editedDTOs[activePlayer];

        // Empty state — no players loaded, show import prompt
        if (!dto && playerInfo.length === 0) {
            editorArea.innerHTML = `
                <div style="text-align:center; padding:20px 0;">
                    <div style="color:#888; font-size:12px; margin-bottom:10px;">No players loaded.</div>
                    <button id="mwi-csim-import-btn" style="
                        background:${ACCENT_BTN_BG}; border:1px solid ${ACCENT_BTN_BORDER}; color:${ACCENT};
                        padding:5px 14px; border-radius:5px; font-size:12px; cursor:pointer;
                        font-family:inherit; font-weight:600;">+ Import Player</button>
                    <div id="mwi-csim-import-area" style="display:none; margin-top:10px; text-align:left;">
                        <textarea id="mwi-csim-import-text" placeholder="Paste Combat Sim Export JSON here..." style="
                            width:100%; height:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                            border-radius:4px; padding:6px; font-size:11px; font-family:monospace; resize:vertical;
                            box-sizing:border-box;"></textarea>
                        <div style="display:flex; gap:6px; margin-top:4px;">
                            <button id="mwi-csim-import-go" style="
                                background:${ACCENT_BTN_BG}; border:1px solid ${ACCENT_BTN_BORDER}; color:${ACCENT};
                                padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;
                                font-weight:600;">Import</button>
                            <button id="mwi-csim-import-cancel" style="
                                background:rgba(255,255,255,0.04); border:1px solid #333; color:#888;
                                padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;">Cancel</button>
                            <span id="mwi-csim-import-error" style="color:#f44; font-size:11px; align-self:center;"></span>
                        </div>
                    </div>
                </div>
            `;

            // Wire up import handlers for empty state
            const importBtn = editorArea.querySelector('#mwi-csim-import-btn');
            if (importBtn) {
                importBtn.addEventListener('click', () => {
                    const area = editorArea.querySelector('#mwi-csim-import-area');
                    if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
                });
            }
            const importGo = editorArea.querySelector('#mwi-csim-import-go');
            if (importGo) {
                importGo.addEventListener('click', () => {
                    const text = editorArea.querySelector('#mwi-csim-import-text')?.value?.trim();
                    const errorEl = editorArea.querySelector('#mwi-csim-import-error');
                    if (!text) {
                        if (errorEl) errorEl.textContent = 'Paste export data first.';
                        return;
                    }
                    const result = parseShykaiImport(text);
                    if (!result || !result.players.length) {
                        if (errorEl) errorEl.textContent = 'Invalid format. Paste a Combat Sim Export JSON.';
                        return;
                    }
                    this._importPlayers(result.players, result.names);
                });
            }
            const importCancel = editorArea.querySelector('#mwi-csim-import-cancel');
            if (importCancel) {
                importCancel.addEventListener('click', () => {
                    const area = editorArea.querySelector('#mwi-csim-import-area');
                    if (area) area.style.display = 'none';
                });
            }
            return;
        }

        if (!dto) return;

        const gameData = buildGameDataPayload();
        if (!gameData) return;

        let html = '';

        // Player tabs + import/remove controls
        html += `<div style="display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap; align-items:center;">`;
        if (playerInfo.length > 1) {
            for (const { hrid, name } of playerInfo) {
                const isActive = hrid === activePlayer;
                const tabStyle = isActive
                    ? `background:${ACCENT_BG}; border:1px solid ${ACCENT_BORDER}; color:${ACCENT}; font-weight:700;`
                    : 'background:rgba(255,255,255,0.04); border:1px solid #333; color:#aaa;';
                html += `<button data-edit-tab="${hrid}" style="
                    ${tabStyle}
                    padding:3px 8px; border-radius:5px; font-size:12px; cursor:pointer;
                    font-family:inherit; transition:all 0.1s; position:relative;
                ">${name}<span data-remove-player="${hrid}" style="margin-left:4px; color:#f44; cursor:pointer; font-size:14px;" title="Remove player">×</span></button>`;
            }
        } else if (playerInfo.length === 1) {
            const { hrid, name } = playerInfo[0];
            html += `<button data-edit-tab="${hrid}" style="
                background:${ACCENT_BG}; border:1px solid ${ACCENT_BORDER}; color:${ACCENT}; font-weight:700;
                padding:3px 8px; border-radius:5px; font-size:12px; cursor:pointer;
                font-family:inherit; transition:all 0.1s; position:relative;
            ">${name}<span data-remove-player="${hrid}" style="margin-left:4px; color:#f44; cursor:pointer; font-size:14px;" title="Remove player">×</span></button>`;
        }
        html += `<button id="mwi-csim-import-btn" style="
            background:rgba(255,255,255,0.04); border:1px solid #333; color:#888;
            padding:3px 8px; border-radius:5px; font-size:11px; cursor:pointer;
            font-family:inherit;" title="Import players from Shykai export string">+ Import</button>`;
        html += '</div>';

        // Import paste area (hidden by default)
        html += `<div id="mwi-csim-import-area" style="display:none; margin-bottom:10px;">
            <textarea id="mwi-csim-import-text" placeholder="Paste Shykai export JSON here..." style="
                width:100%; height:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:4px; padding:6px; font-size:11px; font-family:monospace; resize:vertical;
                box-sizing:border-box;"></textarea>
            <div style="display:flex; gap:6px; margin-top:4px;">
                <button id="mwi-csim-import-go" style="
                    background:${ACCENT_BTN_BG}; border:1px solid ${ACCENT_BTN_BORDER}; color:${ACCENT};
                    padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;
                    font-weight:600;">Import</button>
                <button id="mwi-csim-import-cancel" style="
                    background:rgba(255,255,255,0.04); border:1px solid #333; color:#888;
                    padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;">Cancel</button>
                <span id="mwi-csim-import-error" style="color:#f44; font-size:11px; align-self:center;"></span>
            </div>
        </div>`;

        // Loadout dropdown + Reset button row
        const allSnapshots = loadoutSnapshot.getAllSnapshots();
        // Only show combat loadouts (action type is combat or "All Skills")
        const combatSnapshots = allSnapshots.filter(
            (s) => !s.actionTypeHrid || s.actionTypeHrid === '/action_types/combat'
        );
        html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">`;
        if (combatSnapshots.length > 0) {
            html += `<label style="color:#888; font-size:11px; flex-shrink:0;">Loadout</label>`;
            html += `<select id="mwi-csim-loadout-select" style="
                flex:1; min-width:0; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:4px; padding:2px 6px; font-size:12px; font-family:inherit;">`;
            html += `<option value=""${!this._selectedLoadoutName ? ' selected' : ''}>— Current Gear —</option>`;
            for (const snap of combatSnapshots) {
                const label = snap.name + (snap.actionTypeHrid ? '' : ' (All Skills)');
                const selected = this._selectedLoadoutName === snap.name ? ' selected' : '';
                html += `<option value="${snap.name}"${selected}>${label}</option>`;
            }
            html += `</select>`;
        }
        html += `<button id="mwi-csim-reset" style="
            margin-left:auto; background:rgba(255,255,255,0.04); border:1px solid #333; color:#aaa;
            padding:2px 8px; border-radius:4px; font-size:11px; cursor:pointer;
            font-family:inherit; flex-shrink:0;">Reset to Current</button>`;
        html += '</div>';

        // Equipment section
        html += this._renderEquipmentSection(dto, gameData);

        // Abilities section
        html += this._renderAbilitiesSection(dto, gameData);

        // Consumables section
        html += this._renderConsumablesSection(dto, gameData);

        // Skill levels section
        html += this._renderSkillLevelsSection(dto);

        // House rooms section
        html += this._renderHouseRoomsSection(dto, gameData);

        editorArea.innerHTML = html;

        // Wire event listeners
        this._wireEditorEvents(editorArea, dto);
    }

    /**
     * Render equipment section with enhancement level inputs.
     * @private
     */
    _renderEquipmentSection(dto, gameData) {
        const itemDetailMap = gameData.itemDetailMap || {};
        const slotOrder = [
            '/equipment_types/head',
            '/equipment_types/body',
            '/equipment_types/legs',
            '/equipment_types/feet',
            '/equipment_types/hands',
            '/equipment_types/main_hand',
            '/equipment_types/two_hand',
            '/equipment_types/off_hand',
            '/equipment_types/pouch',
            '/equipment_types/back',
            '/equipment_types/neck',
            '/equipment_types/earrings',
            '/equipment_types/ring',
            '/equipment_types/charm',
        ];
        const slotLabels = {
            '/equipment_types/head': 'Head',
            '/equipment_types/body': 'Body',
            '/equipment_types/legs': 'Legs',
            '/equipment_types/feet': 'Feet',
            '/equipment_types/hands': 'Hands',
            '/equipment_types/main_hand': 'Main Hand',
            '/equipment_types/two_hand': 'Two Hand',
            '/equipment_types/off_hand': 'Off Hand',
            '/equipment_types/pouch': 'Pouch',
            '/equipment_types/back': 'Back',
            '/equipment_types/neck': 'Neck',
            '/equipment_types/earrings': 'Earrings',
            '/equipment_types/ring': 'Ring',
            '/equipment_types/charm': 'Charm',
        };

        const equippedCount = slotOrder.filter((s) => dto.equipment[s]).length;
        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="equip-section">`;
        html += `<span data-arrow="equip-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> Equipment (${equippedCount} items)`;
        html += '</div>';
        html += `<div id="mwi-csim-equip-section" style="display:none;">`;

        for (const slotType of slotOrder) {
            const equip = dto.equipment[slotType];
            const label = slotLabels[slotType] || slotType.split('/').pop();

            if (!equip) {
                html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
                html += `<span style="color:#888; width:70px; flex-shrink:0;">${label}</span>`;
                html += `<span style="color:#555; flex:1; font-style:italic;">Empty</span>`;
                html += `<button data-equipment-slot="${slotType}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">add</button>`;
                html += '</div>';
                continue;
            }

            const item = itemDetailMap[equip.hrid];
            const name = item?.name || equip.hrid.split('/').pop();

            html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
            html += `<span style="color:#888; width:70px; flex-shrink:0;">${label}</span>`;
            html += `<span style="color:#e0e0e0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
            html += `<span style="color:#666; font-size:11px;">+</span>`;
            html += `<input type="number" min="0" max="20" value="${equip.enhancementLevel}"
                data-enhance-slot="${slotType}"
                style="width:36px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += `<button data-equipment-slot="${slotType}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">change</button>`;
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Render abilities section with level inputs.
     * @private
     */
    _renderAbilitiesSection(dto, gameData) {
        const abilityDetailMap = gameData.abilityDetailMap || {};
        const abilityCount = dto.abilities.filter((a) => a).length;

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="ability-section">`;
        html += `<span data-arrow="ability-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> Abilities (${abilityCount} equipped)`;
        html += '</div>';
        html += `<div id="mwi-csim-ability-section" style="display:none;">`;

        const maxSlots = 5;
        const slotCount = Math.max(dto.abilities.length, maxSlots);

        for (let i = 0; i < slotCount; i++) {
            const ability = dto.abilities[i];
            const slotLabel = i === 0 ? 'Special' : `Slot ${i}`;

            if (!ability) {
                html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
                html += `<span style="color:#888; width:50px; flex-shrink:0;">${slotLabel}</span>`;
                html += `<span style="color:#555; flex:1; font-style:italic;">Empty</span>`;
                html += `<button data-ability-slot="${i}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">add</button>`;
                html += '</div>';
                continue;
            }

            const detail = abilityDetailMap[ability.hrid];
            const name = detail?.name || ability.hrid.split('/').pop();

            html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
            html += `<span style="color:#888; width:50px; flex-shrink:0;">${slotLabel}</span>`;
            html += `<span style="color:#e0e0e0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
            html += `<span style="color:#666; font-size:11px;">Lv</span>`;
            html += `<input type="number" min="1" max="200" value="${ability.level}"
                data-ability-idx="${i}"
                style="width:42px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += `<button data-ability-slot="${i}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">change</button>`;
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Render consumables section with food and drink slots.
     * @private
     */
    _renderConsumablesSection(dto, gameData) {
        const itemDetailMap = gameData?.itemDetailMap || {};
        const foodCount = dto.food.filter((f) => f).length;
        const drinkCount = dto.drinks.filter((d) => d).length;

        let html = '<div style="margin-bottom:10px;">';
        html +=
            '<div style="color:' +
            ACCENT +
            '; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="consumable-section">';
        html +=
            '<span data-arrow="consumable-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> Consumables (' +
            foodCount +
            ' food, ' +
            drinkCount +
            ' drinks)';
        html += '</div>';
        html += '<div id="mwi-csim-consumable-section" style="display:none;">';

        // Food slots
        html += '<div style="color:#888; font-size:11px; margin-bottom:3px;">Food</div>';
        for (let i = 0; i < 3; i++) {
            const item = dto.food[i];
            const name = item ? itemDetailMap[item.hrid]?.name || item.hrid.split('/').pop() : 'Empty';
            const nameColor = item ? '#e0e0e0' : '#555';
            html += '<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">';
            html += '<span style="color:#666; width:16px; flex-shrink:0;">' + (i + 1) + '</span>';
            html +=
                '<span style="color:' +
                nameColor +
                '; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                name +
                '</span>';
            html +=
                '<button data-consumable-slot="food-' +
                i +
                '" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">change</button>';
            html += '</div>';
        }

        // Drink slots
        html += '<div style="color:#888; font-size:11px; margin-bottom:3px; margin-top:6px;">Drinks</div>';
        for (let i = 0; i < 3; i++) {
            const item = dto.drinks[i];
            const name = item ? itemDetailMap[item.hrid]?.name || item.hrid.split('/').pop() : 'Empty';
            const nameColor = item ? '#e0e0e0' : '#555';
            html += '<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">';
            html += '<span style="color:#666; width:16px; flex-shrink:0;">' + (i + 1) + '</span>';
            html +=
                '<span style="color:' +
                nameColor +
                '; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                name +
                '</span>';
            html +=
                '<button data-consumable-slot="drinks-' +
                i +
                '" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">change</button>';
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Open a searchable consumable picker popup.
     * @param {'food'|'drinks'} slotType
     * @param {number} slotIndex
     * @param {Object} dto
     * @param {Object} gameData
     * @private
     */
    _openConsumablePicker(slotType, slotIndex, dto, gameData) {
        // Remove any existing picker
        document.getElementById('mwi-csim-consumable-picker')?.remove();
        document.getElementById('mwi-csim-consumable-backdrop')?.remove();

        const itemDetailMap = gameData?.itemDetailMap || {};
        const isFood = slotType === 'food';

        // Determine consumable "type" for slot restriction enforcement
        const getConsumableType = (hrid) => {
            const detail = itemDetailMap[hrid]?.consumableDetail;
            if (!detail) return null;
            const hp = detail.hitpointRestore || 0;
            const mp = detail.manapointRestore || 0;
            const dur = detail.recoveryDuration || 0;
            if (hp > 0) return dur > 0 ? 'hp_over_time' : 'hp_instant';
            if (mp > 0) return dur > 0 ? 'mp_over_time' : 'mp_instant';
            const buffs = detail.buffs || [];
            if (buffs.length > 0) return 'buff:' + (buffs[0].uniqueHrid || 'unknown');
            return null;
        };

        // Collect types already used in OTHER slots
        const usedTypes = new Set();
        const slots = dto[slotType] || [];
        for (let i = 0; i < slots.length; i++) {
            if (i === slotIndex || !slots[i]) continue;
            const t = getConsumableType(slots[i].hrid);
            if (t) usedTypes.add(t);
        }

        // Build list of valid consumables, marking conflicts
        const items = [];
        for (const [hrid, item] of Object.entries(itemDetailMap)) {
            if (!item.consumableDetail) continue;
            const cat = item.categoryHrid || '';
            const isFoodItem = cat.includes('food');
            // Only include combat drinks (coffees) — teas have no cooldown and aren't used in combat
            const isDrinkItem =
                (cat.includes('drink') || hrid.includes('coffee')) && item.consumableDetail.cooldownDuration > 0;
            if (isFood ? isFoodItem : isDrinkItem) {
                const cType = getConsumableType(hrid);
                const conflict = cType && usedTypes.has(cType);
                const itemLevel = item.itemLevel || 0;

                // Category label for grouping
                let categoryLabel;
                if (isFood) {
                    const hp = item.consumableDetail.hitpointRestore || 0;
                    const mp = item.consumableDetail.manapointRestore || 0;
                    const dur = item.consumableDetail.recoveryDuration || 0;
                    if (hp > 0 && dur > 0) categoryLabel = 'HP Over Time';
                    else if (hp > 0) categoryLabel = 'HP Instant';
                    else if (mp > 0 && dur > 0) categoryLabel = 'MP Over Time';
                    else if (mp > 0) categoryLabel = 'MP Instant';
                    else categoryLabel = 'Other';
                } else {
                    const buffs = item.consumableDetail.buffs || [];
                    if (buffs.length > 0) {
                        const buffName = buffs[0].uniqueHrid?.split('/').pop()?.replace(/_/g, ' ') || 'buff';
                        categoryLabel = buffName.charAt(0).toUpperCase() + buffName.slice(1);
                    } else categoryLabel = 'Other';
                }

                items.push({ hrid, name: item.name || hrid.split('/').pop(), conflict, itemLevel, categoryLabel });
            }
        }

        // Sort by category then by item level descending within category
        items.sort((a, b) => {
            const catCmp = a.categoryLabel.localeCompare(b.categoryLabel);
            if (catCmp !== 0) return catCmp;
            return b.itemLevel - a.itemLevel;
        });

        // Build popup
        const popup = document.createElement('div');
        popup.id = 'mwi-csim-consumable-picker';
        popup.style.cssText =
            'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:100000;' +
            'background:rgba(10,10,20,0.97); border:2px solid rgba(74,158,255,0.5); border-radius:10px;' +
            'width:350px; max-height:400px; display:flex; flex-direction:column;' +
            "font-family:'Segoe UI',sans-serif; color:#e0e0e0; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.6);";

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid rgba(74,158,255,0.3); flex-shrink:0;';
        header.innerHTML =
            '<span style="font-weight:700; font-size:13px; color:#4a9eff;">Select ' +
            (isFood ? 'Food' : 'Drink') +
            '</span>' +
            '<button id="mwi-csim-picker-close" style="background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1;">×</button>';
        popup.appendChild(header);

        // Search
        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding:6px 14px; flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search...';
        searchInput.style.cssText =
            'width:100%; padding:5px 8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:6px; color:#e0e0e0; font-size:12px; font-family:inherit; outline:none;';
        searchDiv.appendChild(searchInput);
        popup.appendChild(searchDiv);

        // List
        const listEl = document.createElement('div');
        listEl.style.cssText = 'flex:1; overflow-y:auto; padding:4px 14px;';
        popup.appendChild(listEl);

        const currentHrid = dto[slotType][slotIndex]?.hrid || '';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query
                ? items.filter(
                      (i) => i.name.toLowerCase().includes(lower) || i.categoryLabel.toLowerCase().includes(lower)
                  )
                : items;

            let html =
                '<div data-pick-hrid="" style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:#888; font-style:italic;"' +
                ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">Empty (clear slot)</div>';

            let lastCategory = '';
            for (const item of filtered.slice(0, 80)) {
                // Category header
                if (item.categoryLabel !== lastCategory) {
                    lastCategory = item.categoryLabel;
                    html +=
                        '<div style="padding:6px 0 2px; font-size:10px; font-weight:700; color:' +
                        ACCENT +
                        '; border-bottom:1px solid #2a2a4e; margin-top:4px;">' +
                        item.categoryLabel +
                        '</div>';
                }

                const isCurrent = item.hrid === currentHrid;
                const lvlTag =
                    '<span style="color:#666; font-size:10px; margin-left:auto; flex-shrink:0;">Lv ' +
                    item.itemLevel +
                    '</span>';
                if (item.conflict) {
                    html +=
                        '<div style="display:flex; align-items:center; gap:8px; padding:3px 4px; border-bottom:1px solid #1a1a2e; color:#555; cursor:default;">' +
                        item.name +
                        ' <span style="font-size:10px; color:#664;">(in use)</span>' +
                        lvlTag +
                        '</div>';
                } else {
                    const color = isCurrent ? '#4a9eff' : '#ccc';
                    const indicator = isCurrent ? ' <span style="color:#4a9eff;">●</span>' : '';
                    html +=
                        '<div data-pick-hrid="' +
                        item.hrid +
                        '" style="display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:' +
                        color +
                        ';"' +
                        ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                        item.name +
                        indicator +
                        lvlTag +
                        '</div>';
                }
            }
            if (filtered.length > 80) {
                html +=
                    '<div style="color:#666; text-align:center; padding:6px;">...' +
                    (filtered.length - 80) +
                    ' more</div>';
            }
            listEl.innerHTML = html;

            // Wire click handlers
            listEl.querySelectorAll('[data-pick-hrid]').forEach((row) => {
                row.addEventListener('click', () => {
                    const hrid = row.dataset.pickHrid;
                    if (hrid) {
                        dto[slotType][slotIndex] = { hrid, triggers: null };
                    } else {
                        dto[slotType][slotIndex] = null;
                    }
                    closePicker();
                    this._renderEditor();
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        const closePicker = () => {
            popup.remove();
            document.getElementById('mwi-csim-consumable-backdrop')?.remove();
        };

        popup.querySelector('#mwi-csim-picker-close').addEventListener('click', closePicker);

        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'mwi-csim-consumable-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999;';
        backdrop.addEventListener('click', closePicker);

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        renderList('');
        searchInput.focus();
    }

    /**
     * Open equipment picker for a specific slot.
     * @private
     */
    _openEquipmentPicker(slotType, dto, gameData) {
        document.getElementById('mwi-csim-equipment-picker')?.remove();
        document.getElementById('mwi-csim-equipment-backdrop')?.remove();

        const itemDetailMap = gameData?.itemDetailMap || {};
        const slotName = slotType.split('/').pop().replace(/_/g, ' ');

        const items = [];
        for (const [hrid, item] of Object.entries(itemDetailMap)) {
            if (item.equipmentDetail?.type !== slotType) continue;

            const levelReqs = item.equipmentDetail.levelRequirements || [];
            const primaryReq = levelReqs[0];
            const reqLevel = primaryReq?.level || 0;
            const reqSkill = primaryReq?.skillHrid?.split('/').pop() || '';

            let categoryLabel;
            if (reqSkill === 'attack') categoryLabel = 'Attack';
            else if (reqSkill === 'defense') categoryLabel = 'Defense';
            else if (reqSkill === 'ranged') categoryLabel = 'Ranged';
            else if (reqSkill === 'magic') categoryLabel = 'Magic';
            else categoryLabel = 'General';

            items.push({
                hrid,
                name: item.name || hrid.split('/').pop(),
                itemLevel: item.itemLevel || 0,
                reqLevel,
                categoryLabel,
            });
        }

        items.sort((a, b) => {
            const catCmp = a.categoryLabel.localeCompare(b.categoryLabel);
            if (catCmp !== 0) return catCmp;
            return b.itemLevel - a.itemLevel;
        });

        const popup = document.createElement('div');
        popup.id = 'mwi-csim-equipment-picker';
        popup.style.cssText =
            'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:100000;' +
            'background:rgba(10,10,20,0.97); border:2px solid rgba(74,158,255,0.5); border-radius:10px;' +
            'width:350px; max-height:400px; display:flex; flex-direction:column;' +
            "font-family:'Segoe UI',sans-serif; color:#e0e0e0; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.6);";

        const header = document.createElement('div');
        header.style.cssText =
            'display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid rgba(74,158,255,0.3); flex-shrink:0;';
        header.innerHTML =
            `<span style="font-weight:700; font-size:13px; color:${ACCENT};">Select ${slotName}</span>` +
            '<button id="mwi-csim-equip-picker-close" style="background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1;">\u00d7</button>';
        popup.appendChild(header);

        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding:6px 14px; flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search...';
        searchInput.style.cssText =
            'width:100%; padding:5px 8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:6px; color:#e0e0e0; font-size:12px; font-family:inherit; outline:none;';
        searchDiv.appendChild(searchInput);
        popup.appendChild(searchDiv);

        const listEl = document.createElement('div');
        listEl.style.cssText = 'flex:1; overflow-y:auto; padding:4px 14px;';
        popup.appendChild(listEl);

        const currentHrid = dto.equipment[slotType]?.hrid || '';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query ? items.filter((i) => i.name.toLowerCase().includes(lower)) : items;

            let html =
                '<div data-pick-hrid="" style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:#888; font-style:italic;"' +
                ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">Empty (remove slot)</div>';

            let lastCategory = '';
            for (const item of filtered.slice(0, 100)) {
                if (item.categoryLabel !== lastCategory) {
                    lastCategory = item.categoryLabel;
                    html +=
                        `<div style="padding:6px 0 2px; font-size:10px; font-weight:700; color:${ACCENT}; border-bottom:1px solid #2a2a4e; margin-top:4px;">` +
                        item.categoryLabel +
                        '</div>';
                }

                const isCurrent = item.hrid === currentHrid;
                const color = isCurrent ? ACCENT : '#ccc';
                const indicator = isCurrent ? ` <span style="color:${ACCENT};">\u25cf</span>` : '';
                const lvlTag = `<span style="color:#666; font-size:10px; margin-left:auto; flex-shrink:0;">Lv ${item.reqLevel}</span>`;

                html +=
                    `<div data-pick-hrid="${item.hrid}" style="display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:${color};"` +
                    ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                    item.name +
                    indicator +
                    lvlTag +
                    '</div>';
            }
            if (filtered.length > 100) {
                html += `<div style="color:#666; text-align:center; padding:6px;">...${filtered.length - 100} more</div>`;
            }
            listEl.innerHTML = html;

            listEl.querySelectorAll('[data-pick-hrid]').forEach((row) => {
                row.addEventListener('click', () => {
                    const hrid = row.dataset.pickHrid;
                    if (hrid) {
                        dto.equipment[slotType] = { hrid, enhancementLevel: 0 };
                    } else {
                        delete dto.equipment[slotType];
                    }
                    closePicker();
                    this._renderEditor();
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        const closePicker = () => {
            popup.remove();
            document.getElementById('mwi-csim-equipment-backdrop')?.remove();
        };

        popup.querySelector('#mwi-csim-equip-picker-close').addEventListener('click', closePicker);

        const backdrop = document.createElement('div');
        backdrop.id = 'mwi-csim-equipment-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999;';
        backdrop.addEventListener('click', closePicker);

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        renderList('');
        searchInput.focus();
    }

    /**
     * Open ability picker for a specific slot.
     * @private
     */
    _openAbilityPicker(slotIndex, dto, gameData) {
        document.getElementById('mwi-csim-ability-picker')?.remove();
        document.getElementById('mwi-csim-ability-backdrop')?.remove();

        const abilityDetailMap = gameData?.abilityDetailMap || {};
        const isSpecialSlot = slotIndex === 0;

        const usedHrids = new Set();
        for (let i = 0; i < dto.abilities.length; i++) {
            if (i === slotIndex || !dto.abilities[i]) continue;
            usedHrids.add(dto.abilities[i].hrid);
        }

        const items = [];
        for (const [hrid, ability] of Object.entries(abilityDetailMap)) {
            if (isSpecialSlot && !ability.isSpecialAbility) continue;
            if (!isSpecialSlot && ability.isSpecialAbility) continue;

            const effects = ability.abilityEffects || [];
            const combatStyle = effects[0]?.combatStyleHrid?.split('/').pop() || '';
            let categoryLabel;
            if (combatStyle === 'stab' || combatStyle === 'slash' || combatStyle === 'smash') categoryLabel = 'Melee';
            else if (combatStyle === 'ranged') categoryLabel = 'Ranged';
            else if (combatStyle === 'magic') categoryLabel = 'Magic';
            else categoryLabel = 'Other';

            items.push({
                hrid,
                name: ability.name || hrid.split('/').pop(),
                categoryLabel,
                conflict: usedHrids.has(hrid),
            });
        }

        items.sort((a, b) => {
            const catCmp = a.categoryLabel.localeCompare(b.categoryLabel);
            if (catCmp !== 0) return catCmp;
            return a.name.localeCompare(b.name);
        });

        const popup = document.createElement('div');
        popup.id = 'mwi-csim-ability-picker';
        popup.style.cssText =
            'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:100000;' +
            'background:rgba(10,10,20,0.97); border:2px solid rgba(74,158,255,0.5); border-radius:10px;' +
            'width:350px; max-height:400px; display:flex; flex-direction:column;' +
            "font-family:'Segoe UI',sans-serif; color:#e0e0e0; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.6);";

        const slotLabel = isSpecialSlot ? 'Special Ability' : `Ability Slot ${slotIndex}`;
        const header = document.createElement('div');
        header.style.cssText =
            'display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid rgba(74,158,255,0.3); flex-shrink:0;';
        header.innerHTML =
            `<span style="font-weight:700; font-size:13px; color:${ACCENT};">Select ${slotLabel}</span>` +
            '<button id="mwi-csim-ability-picker-close" style="background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1;">\u00d7</button>';
        popup.appendChild(header);

        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding:6px 14px; flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search...';
        searchInput.style.cssText =
            'width:100%; padding:5px 8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:6px; color:#e0e0e0; font-size:12px; font-family:inherit; outline:none;';
        searchDiv.appendChild(searchInput);
        popup.appendChild(searchDiv);

        const listEl = document.createElement('div');
        listEl.style.cssText = 'flex:1; overflow-y:auto; padding:4px 14px;';
        popup.appendChild(listEl);

        const currentHrid = dto.abilities[slotIndex]?.hrid || '';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query ? items.filter((i) => i.name.toLowerCase().includes(lower)) : items;

            let html =
                '<div data-pick-hrid="" style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:#888; font-style:italic;"' +
                ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">Empty (clear slot)</div>';

            let lastCategory = '';
            for (const item of filtered) {
                if (item.categoryLabel !== lastCategory) {
                    lastCategory = item.categoryLabel;
                    html +=
                        `<div style="padding:6px 0 2px; font-size:10px; font-weight:700; color:${ACCENT}; border-bottom:1px solid #2a2a4e; margin-top:4px;">` +
                        item.categoryLabel +
                        '</div>';
                }

                if (item.conflict) {
                    html +=
                        '<div style="display:flex; align-items:center; gap:8px; padding:3px 4px; border-bottom:1px solid #1a1a2e; color:#555; cursor:default;">' +
                        item.name +
                        ' <span style="font-size:10px; color:#664;">(in use)</span></div>';
                } else {
                    const isCurrent = item.hrid === currentHrid;
                    const color = isCurrent ? ACCENT : '#ccc';
                    const indicator = isCurrent ? ` <span style="color:${ACCENT};">\u25cf</span>` : '';
                    html +=
                        `<div data-pick-hrid="${item.hrid}" style="display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:${color};"` +
                        ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                        item.name +
                        indicator +
                        '</div>';
                }
            }
            listEl.innerHTML = html;

            listEl.querySelectorAll('[data-pick-hrid]').forEach((row) => {
                row.addEventListener('click', () => {
                    const hrid = row.dataset.pickHrid;
                    const existingLevel = dto.abilities[slotIndex]?.level || 1;
                    if (hrid) {
                        while (dto.abilities.length <= slotIndex) dto.abilities.push(null);
                        dto.abilities[slotIndex] = { hrid, level: existingLevel, triggers: null };
                    } else if (slotIndex < dto.abilities.length) {
                        dto.abilities[slotIndex] = null;
                    }
                    closePicker();
                    this._renderEditor();
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        const closePicker = () => {
            popup.remove();
            document.getElementById('mwi-csim-ability-backdrop')?.remove();
        };

        popup.querySelector('#mwi-csim-ability-picker-close').addEventListener('click', closePicker);

        const backdrop = document.createElement('div');
        backdrop.id = 'mwi-csim-ability-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999;';
        backdrop.addEventListener('click', closePicker);

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        renderList('');
        searchInput.focus();
    }

    _renderSkillLevelsSection(dto) {
        const skills = [
            { key: 'staminaLevel', label: 'Stamina' },
            { key: 'intelligenceLevel', label: 'Intelligence' },
            { key: 'attackLevel', label: 'Attack' },
            { key: 'meleeLevel', label: 'Melee' },
            { key: 'defenseLevel', label: 'Defense' },
            { key: 'rangedLevel', label: 'Ranged' },
            { key: 'magicLevel', label: 'Magic' },
        ];

        const summary = skills.map((s) => `${s.label.slice(0, 3)} ${dto[s.key]}`).join(' / ');

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="skill-section">`;
        html += `<span data-arrow="skill-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> Skill Levels`;
        html += `<span style="color:#888; font-weight:400; font-size:11px; margin-left:6px;">${summary}</span>`;
        html += '</div>';
        html += `<div id="mwi-csim-skill-section" style="display:none;">`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">`;

        for (const skill of skills) {
            html += `<div style="display:flex; align-items:center; gap:6px; font-size:12px;">`;
            html += `<span style="color:#888; width:70px;">${skill.label}</span>`;
            html += `<input type="number" min="1" max="200" value="${dto[skill.key]}"
                data-skill="${skill.key}"
                style="width:48px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += '</div>';
        }

        html += '</div></div></div>';
        return html;
    }

    /**
     * Render house rooms section with level inputs.
     * @private
     */
    _renderHouseRoomsSection(dto, gameData) {
        const houseRoomDetailMap = gameData.houseRoomDetailMap || {};
        const roomHrids = Object.keys(houseRoomDetailMap).sort();
        const activeCount = roomHrids.filter((hrid) => (dto.houseRooms[hrid] || 0) > 0).length;

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="house-section">`;
        html += `<span data-arrow="house-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> House Rooms`;
        html += `<span style="color:#888; font-weight:400; font-size:11px; margin-left:6px;">${activeCount} active</span>`;
        html += '</div>';
        html += `<div id="mwi-csim-house-section" style="display:none;">`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">`;

        for (const hrid of roomHrids) {
            const room = houseRoomDetailMap[hrid];
            const name = room.name || hrid.split('/').pop();
            const level = dto.houseRooms[hrid] || 0;
            html += `<div style="display:flex; align-items:center; gap:6px; font-size:12px;">`;
            html += `<span style="color:#888; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}">${name}</span>`;
            html += `<input type="number" min="0" max="8" value="${level}"
                data-house-hrid="${hrid}"
                style="width:40px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += '</div>';
        }

        html += '</div></div></div>';
        return html;
    }

    /**
     * Wire event listeners for the editor area.
     * @private
     */
    _wireEditorEvents(editorArea, dto) {
        // Collapsible section toggles
        editorArea.querySelectorAll('[data-toggle]').forEach((el) => {
            el.addEventListener('click', () => {
                const sectionId = el.dataset.toggle;
                const section = editorArea.querySelector('#mwi-csim-' + sectionId);
                const arrow = editorArea.querySelector('[data-arrow="' + sectionId + '"]');
                if (section) {
                    const isOpen = section.style.display !== 'none';
                    section.style.display = isOpen ? 'none' : 'block';
                    if (arrow) arrow.innerHTML = isOpen ? '&#9654;' : '&#9660;';
                    if (isOpen) {
                        this._openSections.delete(sectionId);
                    } else {
                        this._openSections.add(sectionId);
                    }
                }
            });

            // Restore open state from previous render
            const sectionId = el.dataset.toggle;
            if (this._openSections.has(sectionId)) {
                const section = editorArea.querySelector('#mwi-csim-' + sectionId);
                const arrow = editorArea.querySelector('[data-arrow="' + sectionId + '"]');
                if (section) {
                    section.style.display = 'block';
                    if (arrow) arrow.innerHTML = '&#9660;';
                }
            }
        });

        // Enhancement level inputs
        editorArea.querySelectorAll('[data-enhance-slot]').forEach((input) => {
            input.addEventListener('change', () => {
                const slotType = input.dataset.enhanceSlot;
                const val = Math.min(20, Math.max(0, parseInt(input.value) || 0));
                input.value = val;
                if (dto.equipment[slotType]) {
                    dto.equipment[slotType].enhancementLevel = val;
                }
            });
        });

        // Ability level inputs
        editorArea.querySelectorAll('[data-ability-idx]').forEach((input) => {
            input.addEventListener('change', () => {
                const idx = parseInt(input.dataset.abilityIdx);
                const val = Math.max(1, parseInt(input.value) || 1);
                input.value = val;
                if (dto.abilities[idx]) {
                    dto.abilities[idx].level = val;
                }
            });
        });

        // Skill level inputs
        editorArea.querySelectorAll('[data-skill]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = input.dataset.skill;
                const val = Math.max(1, parseInt(input.value) || 1);
                input.value = val;
                dto[key] = val;
            });
        });

        // House room level inputs
        editorArea.querySelectorAll('[data-house-hrid]').forEach((input) => {
            input.addEventListener('change', () => {
                const hrid = input.dataset.houseHrid;
                const val = Math.max(0, Math.min(8, parseInt(input.value) || 0));
                input.value = val;
                if (val === 0) {
                    delete dto.houseRooms[hrid];
                } else {
                    dto.houseRooms[hrid] = val;
                }
            });
        });

        // Consumable change buttons
        editorArea.querySelectorAll('[data-consumable-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const [slotType, idx] = btn.dataset.consumableSlot.split('-');
                const gameData = buildGameDataPayload();
                if (gameData) this._openConsumablePicker(slotType, parseInt(idx), dto, gameData);
            });
        });

        // Equipment change buttons
        editorArea.querySelectorAll('[data-equipment-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const slotType = btn.dataset.equipmentSlot;
                const gameData = buildGameDataPayload();
                if (gameData) this._openEquipmentPicker(slotType, dto, gameData);
            });
        });

        // Ability change buttons
        editorArea.querySelectorAll('[data-ability-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const slotIndex = parseInt(btn.dataset.abilitySlot);
                const gameData = buildGameDataPayload();
                if (gameData) this._openAbilityPicker(slotIndex, dto, gameData);
            });
        });

        // Reset button
        const resetBtn = editorArea.querySelector('#mwi-csim-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this._editedDTOs = structuredClone(this._originalDTOs);
                this._selectedLoadoutName = '';
                this._renderEditor();
            });
        }

        // Player edit tabs
        editorArea.querySelectorAll('[data-edit-tab]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                // Don't switch tabs if clicking the × remove button
                if (e.target.dataset.removePlayer) return;
                this._activeEditPlayer = btn.dataset.editTab;
                this._renderEditor();
            });
        });

        // Remove player buttons
        editorArea.querySelectorAll('[data-remove-player]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hrid = btn.dataset.removePlayer;
                if (!this._editedDTOs) return;
                delete this._editedDTOs[hrid];
                if (this._originalDTOs) delete this._originalDTOs[hrid];
                this._editedPlayerInfo = this._editedPlayerInfo.filter((p) => p.hrid !== hrid);
                if (this._activeEditPlayer === hrid) {
                    this._activeEditPlayer = this._editedPlayerInfo[0]?.hrid || null;
                }
                if (Object.keys(this._editedDTOs).length === 0) {
                    this._editedDTOs = {};
                    this._originalDTOs = {};
                    this._editedPlayerInfo = [];
                    this._editorInitialized = true;
                    this._activeEditPlayer = null;
                    this._selfHrid = null;
                    this._renderEditor();
                    return;
                }
                this._renderEditor();
            });
        });

        // Import button
        const importBtn = editorArea.querySelector('#mwi-csim-import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const area = editorArea.querySelector('#mwi-csim-import-area');
                if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
            });
        }

        // Import action
        const importGo = editorArea.querySelector('#mwi-csim-import-go');
        if (importGo) {
            importGo.addEventListener('click', () => {
                const text = editorArea.querySelector('#mwi-csim-import-text')?.value?.trim();
                const errorEl = editorArea.querySelector('#mwi-csim-import-error');
                if (!text) {
                    if (errorEl) errorEl.textContent = 'Paste export data first.';
                    return;
                }
                const result = parseShykaiImport(text);
                if (!result || !result.players.length) {
                    if (errorEl) errorEl.textContent = 'Invalid format. Paste a Shykai export JSON.';
                    return;
                }
                this._importPlayers(result.players, result.names);
                const area = editorArea.querySelector('#mwi-csim-import-area');
                if (area) area.style.display = 'none';
            });
        }

        // Import cancel
        const importCancel = editorArea.querySelector('#mwi-csim-import-cancel');
        if (importCancel) {
            importCancel.addEventListener('click', () => {
                const area = editorArea.querySelector('#mwi-csim-import-area');
                if (area) area.style.display = 'none';
            });
        }

        // Loadout select dropdown
        const loadoutSelect = editorArea.querySelector('#mwi-csim-loadout-select');
        if (loadoutSelect) {
            loadoutSelect.addEventListener('change', () => {
                const selectedName = loadoutSelect.value;
                this._selectedLoadoutName = selectedName;
                if (!selectedName) {
                    // Reset to current gear
                    const activePlayer = this._activeEditPlayer;
                    if (this._originalDTOs?.[activePlayer]) {
                        this._editedDTOs[activePlayer] = structuredClone(this._originalDTOs[activePlayer]);
                    }
                } else {
                    this._applyLoadoutToDTO(selectedName);
                }
                this._renderEditor();
            });
        }
    }

    /**
     * Generate a descriptive label for the current sim by diffing edited DTOs against original.
     * @returns {string} Label like "Boots +15→+16, Slash Lv 8→9" or "Melee Loadout"
     * @private
     */
    _generateSimLabel() {
        const selfHrid = this._selfHrid || this._activeEditPlayer;
        const original = this._originalDTOs?.[selfHrid];
        const edited = this._editedDTOs?.[selfHrid];
        if (!original || !edited) return this._selectedLoadoutName || 'Current Gear';

        const gameData = buildGameDataPayload();
        const itemDetailMap = gameData?.itemDetailMap || {};
        const abilityDetailMap = gameData?.abilityDetailMap || {};

        const changes = [];

        // Equipment changes
        const slotNames = {
            '/equipment_types/head': 'Head',
            '/equipment_types/body': 'Body',
            '/equipment_types/legs': 'Legs',
            '/equipment_types/feet': 'Feet',
            '/equipment_types/hands': 'Hands',
            '/equipment_types/main_hand': 'Main Hand',
            '/equipment_types/two_hand': 'Two Hand',
            '/equipment_types/off_hand': 'Off Hand',
            '/equipment_types/pouch': 'Pouch',
            '/equipment_types/back': 'Back',
            '/equipment_types/neck': 'Neck',
            '/equipment_types/earrings': 'Earrings',
            '/equipment_types/ring': 'Ring',
            '/equipment_types/charm': 'Charm',
        };

        for (const slot of Object.keys(slotNames)) {
            const origEquip = original.equipment?.[slot];
            const editEquip = edited.equipment?.[slot];
            if (!origEquip && !editEquip) continue;

            if (origEquip?.hrid !== editEquip?.hrid) {
                const origName = itemDetailMap[origEquip?.hrid]?.name || origEquip?.hrid?.split('/').pop() || 'Empty';
                const editName = itemDetailMap[editEquip?.hrid]?.name || editEquip?.hrid?.split('/').pop() || 'Empty';
                changes.push(`${origName} → ${editName}`);
            } else if (origEquip?.enhancementLevel !== editEquip?.enhancementLevel) {
                const label = slotNames[slot];
                changes.push(`${label} +${origEquip.enhancementLevel}→+${editEquip.enhancementLevel}`);
            }
        }

        // Ability changes
        for (let i = 0; i < 5; i++) {
            const origAb = original.abilities?.[i];
            const editAb = edited.abilities?.[i];
            if (!origAb && !editAb) continue;

            if (origAb?.hrid !== editAb?.hrid) {
                const origName = abilityDetailMap[origAb?.hrid]?.name || origAb?.hrid?.split('/').pop() || 'None';
                const editName = abilityDetailMap[editAb?.hrid]?.name || editAb?.hrid?.split('/').pop() || 'None';
                changes.push(`${origName} → ${editName}`);
            } else if (origAb && editAb && origAb.level !== editAb.level) {
                const name = abilityDetailMap[editAb.hrid]?.name || editAb.hrid.split('/').pop();
                changes.push(`${name} Lv ${origAb.level}→${editAb.level}`);
            }
        }

        // Skill level changes
        const skillLabels = {
            staminaLevel: 'Stamina',
            intelligenceLevel: 'Intelligence',
            attackLevel: 'Attack',
            meleeLevel: 'Melee',
            defenseLevel: 'Defense',
            rangedLevel: 'Ranged',
            magicLevel: 'Magic',
        };
        for (const [key, label] of Object.entries(skillLabels)) {
            if (original[key] !== edited[key]) {
                changes.push(`${label} ${original[key]}→${edited[key]}`);
            }
        }

        // Consumable changes
        const slotLabels = { food: 'Food', drinks: 'Drink' };
        for (const [slotType, prefix] of Object.entries(slotLabels)) {
            for (let i = 0; i < 3; i++) {
                const origHrid = original[slotType]?.[i]?.hrid;
                const editHrid = edited[slotType]?.[i]?.hrid;
                if (origHrid !== editHrid) {
                    const origName = origHrid ? itemDetailMap[origHrid]?.name || origHrid.split('/').pop() : 'Empty';
                    const editName = editHrid ? itemDetailMap[editHrid]?.name || editHrid.split('/').pop() : 'Empty';
                    changes.push(`${prefix} ${i + 1}: ${origName}→${editName}`);
                }
            }
        }

        const loadoutPrefix = this._selectedLoadoutName || '';

        if (changes.length === 0) return loadoutPrefix || 'Current Gear';

        const joined = changes.join(', ');
        const changesStr = joined;
        return loadoutPrefix ? loadoutPrefix + ': ' + changesStr : changesStr;
    }

    /**
     * Apply a loadout snapshot to the active player's DTO.
     * Converts snapshot format to sim DTO format.
     * @param {string} loadoutName - Name of the loadout to apply
     * @private
     */
    _applyLoadoutToDTO(loadoutName) {
        const gameData = buildGameDataPayload();
        if (!gameData) return;
        const dto = this._editedDTOs[this._activeEditPlayer];
        if (!dto) return;
        applyLoadoutSnapshotToDTO(dto, loadoutName, gameData);
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
            this._setStatus('Simulation cancelled.');
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
            this._setStatus('No zone selected.');
            return;
        }

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus('No game data available.');
            return;
        }

        // Use edited DTOs if available, otherwise auto-fill
        let playerDTOs;
        let playerInfo;
        let selfHrid;
        let missingMembers;

        if (this._editedDTOs) {
            playerDTOs = Object.values(this._editedDTOs);
            playerInfo = this._editedPlayerInfo || [];
            selfHrid = this._selfHrid || playerDTOs[0]?.hrid || 'player1';
            missingMembers = this._missingMembers || [];
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
            playerInfo = result.playerInfo;
            selfHrid = result.selfHrid;
            missingMembers = result.missingMembers;
        }

        if (!playerDTOs.length) {
            this._setStatus('No character data available.');
            return;
        }

        // Enforce 3-player max for non-dungeon zones
        const zones = getCombatZones();
        const selectedZone = zones.find((z) => z.hrid === zoneHrid);
        if (selectedZone && !selectedZone.isDungeon && playerDTOs.length > 3) {
            this._showWarning(
                `Non-dungeon zones support max 3 players (you have ${playerDTOs.length}). Remove players to continue.`
            );
            return;
        }

        this._playerInfo = playerInfo;
        this._activePlayerTab = selfHrid;

        const communityBuffs = getCommunityBuffs();

        // Show party info
        const partyInfo =
            playerDTOs.length > 1
                ? `Party (${playerDTOs.length} loaded${missingMembers.length ? ', ' + missingMembers.length + ' missing' : ''})`
                : 'Solo';

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
            this._setStatus(`Simulating (${partyInfo})... ${formatElapsed(elapsed)}`);
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
            const historyLabel = this._generateSimLabel();

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
                conservative: 'Buy: Ask / Sell: Bid',
                hybrid: 'Buy: Ask / Sell: Ask',
                optimistic: 'Buy: Bid / Sell: Ask',
                patientBuy: 'Buy: Bid / Sell: Bid',
            };
            const mode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
            const modeLabel = modeLabels[mode] || mode;
            const missingNote = missingMembers.length
                ? ` | Missing: ${missingMembers.join(', ')} (open their profiles)`
                : '';
            this._setStatus(
                `Simulation complete in ${totalElapsed}: ${formatWithSeparator(hours)} hours · ${partyInfo} · Pricing: ${modeLabel}${missingNote}`
            );
        } catch (error) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            if (error.message === 'Cancelled') {
                this._setStatus('Simulation cancelled.');
            } else {
                console.error('[CombatSimUI] Simulation failed:', error);
                this._setStatus(`Simulation error: ${error.message || 'Unknown error'}`);
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
            this._setStatus('No zones selected.');
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
            this._setStatus('No game data available.');
            return;
        }

        // Use edited DTOs if available, otherwise auto-fill
        let playerDTOs;
        if (this._editedDTOs) {
            playerDTOs = Object.values(this._editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
            this._playerInfo = result.playerInfo;
            this._activePlayerTab = result.selfHrid;
            this._selfHrid = result.selfHrid;
        }

        if (!playerDTOs.length) {
            this._setStatus('No character data available.');
            return;
        }

        // All-zones is always non-dungeon — enforce 3-player max
        if (playerDTOs.length > 3) {
            this._showWarning(
                `Non-dungeon zones support max 3 players (you have ${playerDTOs.length}). Remove players to continue.`
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
            this._setStatus(`Simulating ${zoneCount} zones... ${formatElapsed(elapsed)}`);
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
                `All zones complete in ${totalElapsed}: ${zoneCount} zones · ${formatWithSeparator(hours)} hours each`
            );
        } catch (error) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
            if (error.message === 'Cancelled') {
                this._setStatus('Simulation cancelled.');
            } else {
                console.error('[CombatSimUI] All zones simulation failed:', error);
                this._setStatus(`Simulation error: ${error.message || 'Unknown error'}`);
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
        html += `<div style="${headingStyle}">Overview</div>`;
        html += `<div style="${rowStyle}">`;
        html += `<span style="${labelStyle}">Encounters/hr</span>`;
        html += `<span style="${valueStyle}">${formatWithSeparator(Math.round(encountersPerHr))}${this._formatDelta(encountersPerHr, prevEncPerHr)}</span>`;
        html += '</div>';
        html += `<div style="${rowStyle}">`;
        html += `<span style="${labelStyle}">Deaths/hr</span>`;
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
            html += `<span style="${labelStyle}">Party DPS (est.)</span>`;
            html += `<span style="${valueStyle}">${formatWithSeparator(Math.round(dps))}${this._formatDelta(dps, prevDps)}</span>`;
            html += '</div>';
        }

        // Dungeon stats if applicable
        if (simResult.isDungeon) {
            const completedPerHr = simResult.dungeonsCompleted / hours;
            const failedPerHr = simResult.dungeonsFailed / hours;

            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">Dungeons completed/hr</span>`;
            html += `<span style="${valueStyle}">${this._formatRate(completedPerHr)}</span>`;
            html += '</div>';
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">Dungeons failed/hr</span>`;
            html += `<span style="${valueStyle}">${this._formatRate(failedPerHr)}</span>`;
            html += '</div>';
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">Total completed / failed</span>`;
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
                html += `<span style="${labelStyle}">Avg completion time</span>`;
                html += `<span style="${valueStyle}">${avgTimeStr}</span>`;
                html += '</div>';
            }
            html += `<div style="${rowStyle}">`;
            html += `<span style="${labelStyle}">Max wave reached</span>`;
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
            html += `<div style="${headingStyle}">XP/hr</div>`;
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
            html += `<span style="color:#aaa; font-weight:700;">Total</span>`;
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
                html += `<div style="${headingStyle}">Drops</div>`;
                // Column headers
                html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
                html += `<span style="flex:1;">Item</span>`;
                html += `<span style="${colNum}">/hr</span>`;
                html += `<span style="${colNum}">/day</span>`;
                html += `<span style="${colGold}">Gold/hr</span>`;
                html += `<span style="${colGold}">Gold/day</span>`;
                html += `<span style="${colNum}">Total</span>`;
                html += `<span style="${colGold}">Total Gold</span>`;
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
                html += `<span style="color:#aaa; font-weight:700; flex:1;">Total Revenue</span>`;
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
            html += `<div style="${headingStyle}">Consumable Costs</div>`;
            // Column headers
            html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
            html += `<span style="flex:1;">Item</span>`;
            html += `<span style="${colNum}">/hr</span>`;
            html += `<span style="${colNum}">/day</span>`;
            html += `<span style="${colGold}">Cost/hr</span>`;
            html += `<span style="${colGold}">Cost/day</span>`;
            html += `<span style="${colNum}">Total</span>`;
            html += `<span style="${colGold}">Total Cost</span>`;
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
            html += `<span style="color:#aaa; font-weight:700; flex:1;">Total Expenses</span>`;
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
            html += `<div style="${headingStyle}">Key Costs</div>`;
            html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
            html += `<span style="flex:1;">Item</span>`;
            html += `<span style="${colNum}">/hr</span>`;
            html += `<span style="${colNum}">/day</span>`;
            html += `<span style="${colGold}">Cost/hr</span>`;
            html += `<span style="${colGold}">Cost/day</span>`;
            html += `<span style="${colNum}">Total</span>`;
            html += `<span style="${colGold}">Total Cost</span>`;
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
            html += `<span style="color:#aaa; font-weight:700; flex:1;">Total Key Costs</span>`;
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
        html += `<div style="${headingStyle}">Net Profit</div>`;
        const netColGold = 'flex:0; white-space:nowrap; min-width:76px; text-align:right; white-space:normal;';
        const netColNum = 'flex:0; white-space:nowrap; min-width:56px; text-align:right;';
        // Column headers
        html += `<div style="display:flex; align-items:center; padding:0 0 4px; font-size:10px; gap:6px; color:#666;">`;
        html += `<span style="flex:1;"></span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColGold}">/hr</span>`;
        html += `<span style="${netColGold}">/day</span>`;
        html += `<span style="${netColNum}"></span>`;
        html += `<span style="${netColGold}">Total</span>`;
        html += '</div>';
        html += `<div style="display:flex; align-items:center; padding:2px 0; font-size:13px; gap:6px;">`;
        html += `<span style="color:#aaa; font-weight:700; flex:1;">Profit</span>`;
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
            '<span data-arrow="history-section" style="display:inline-block; width:14px; font-size:10px;">&#9660;</span> Comparison (' +
            history.length +
            ' runs)';
        html += '</div>';
        html += '<div id="mwi-csim-history-section" style="display:block;">';

        // Baseline selector
        html += '<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px; font-size:11px;">';
        html += '<span style="color:#888;">Baseline:</span>';
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
        html += '<th style="text-align:left; padding:2px 4px;">Scenario</th>';
        html += '<th style="text-align:right; padding:2px 4px;">EPH</th>';
        html += '<th style="text-align:right; padding:2px 4px;">DPS</th>';
        html += '<th style="text-align:right; padding:2px 4px;">Profit/hr</th>';
        html += '<th style="text-align:right; padding:2px 4px;">XP/hr</th>';
        if (hasDungeon) html += '<th style="text-align:right; padding:2px 4px;">Success</th>';
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
            '" title="Delete result">✕</td>';
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
                '" title="Remove from comparison">×</td>';
            html +=
                '<td style="text-align:center; padding:2px; cursor:pointer; color:#555;" data-delete-history="' +
                idx +
                '" title="Delete result">✕</td>';
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
     * Open the sim panel pre-loaded with an external player DTO.
     * Used by the profile page "Sim Character" button.
     * @param {Object} dto - Player DTO in sim engine format
     * @param {string} playerName - Display name for the player tab
     */
    openWithExternalDTO(dto, playerName) {
        if (!this.panel) {
            this.buildPanel();
        }

        dto.hrid = 'player1';

        const dtoMap = { player1: structuredClone(dto) };
        this._originalDTOs = structuredClone(dtoMap);
        this._editedDTOs = structuredClone(dtoMap);
        this._editedPlayerInfo = [{ hrid: 'player1', name: playerName }];
        this._selfHrid = 'player1';
        this._activeEditPlayer = 'player1';
        this._missingMembers = [];
        this._editorInitialized = true;

        this.panel.style.display = 'flex';
        bringPanelToFront(this.panel);
        this.populateZones();
        this._switchTab('configure');
        this._renderEditor();
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
            if (!this._editorInitialized) {
                this._initEditor();
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

        const playerInfo = this._editedPlayerInfo || [];
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
        input.title = 'Number of levels to add to each ability';
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

        // Labyrinth mode uses labyrinth tab inputs
        if (upgradeMode === 'labyrinth') {
            return this._onLabyrinthUpgradeAnalyze(playerIndex);
        }

        if (!zoneHrid) {
            this._setStatus('Select a zone in Configure tab first.');
            return;
        }

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus('No game data available.');
            return;
        }

        // Get player DTOs (edited or live)
        let playerDTOs;
        if (this._editedDTOs) {
            playerDTOs = Object.values(this._editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
        }

        if (!playerDTOs?.length || !playerDTOs[playerIndex]) {
            this._setStatus('No player data available. Configure a simulation first.');
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
                this._setStatus('Analysis cancelled.');
            } else {
                this._renderUpgradeResults(results);
                this._setStatus(`Analysis complete. ${results.results.length} upgrades evaluated.`);
            }
        } catch (error) {
            console.error('[CombatSimUI] Upgrade analysis failed:', error);
            this._setStatus('Analysis failed: ' + error.message);
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
                <th style="${thStyle}">Upgrade</th>
                <th style="${thStyle}">Cost</th>
                <th style="${thStyle}">Gold/0.1% DPS</th>
                <th style="${thStyle}">Gold/0.1% EXP</th>
                <th style="${thStyle}">Gold/0.1% Profit</th>
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
                            <div style="color:#888;">DPS</div>
                            <div style="color:#e0e0e0;">${formatKMB(r.metrics.dps)}</div>
                            <div style="color:${deltaColor(dpsValueDelta)};">${fmtDelta(dpsValueDelta)} (${r.deltas.dps >= 0 ? '+' : ''}${r.deltas.dps.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">EXP/hr</div>
                            <div style="color:#e0e0e0;">${formatKMB(r.metrics.xpPerHour)}</div>
                            <div style="color:${deltaColor(xpValueDelta)};">${fmtDelta(xpValueDelta)} (${r.deltas.xp >= 0 ? '+' : ''}${r.deltas.xp.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">Profit/hr</div>
                            <div style="color:#e0e0e0;">${formatKMB(r.metrics.profitPerHour)}</div>
                            <div style="color:${deltaColor(profitValueDelta)};">${fmtDelta(profitValueDelta)} (${r.deltas.profit >= 0 ? '+' : ''}${r.deltas.profit.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">EPH</div>
                            <div style="color:#e0e0e0;">${r.metrics.encountersPerHour.toFixed(1)}</div>
                            <div style="color:${deltaColor(ephDelta)};">${fmtDeltaSmall(ephDelta)} (${r.deltas.encounters >= 0 ? '+' : ''}${r.deltas.encounters.toFixed(2)}%)</div>
                        </div>
                        <div>
                            <div style="color:#888;">DPH</div>
                            <div style="color:#e0e0e0;">${r.metrics.deathsPerHour.toFixed(1)}</div>
                            <div style="color:${deathDeltaColor(dphDelta)};">${fmtDeltaSmall(dphDelta)} (${r.deltas.deaths >= 0 ? '+' : ''}${r.deltas.deaths.toFixed(2)}%)</div>
                        </div>
                    </div>
                    <div style="margin-top:6px; color:#666; font-size:10px;">
                        Baseline: DPS ${formatKMB(results.baseline.dps)} | EXP ${formatKMB(results.baseline.xpPerHour)} | Profit ${formatKMB(results.baseline.profitPerHour)} | EPH ${results.baseline.encountersPerHour.toFixed(1)} | DPH ${results.baseline.deathsPerHour.toFixed(1)}
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

    // ─── Labyrinth Upgrade Analysis ─────────────────────────────────────────────

    /**
     * Run labyrinth upgrade analysis using monster/level/crates from the Labyrinth tab.
     * @private
     */
    async _onLabyrinthUpgradeAnalyze(playerIndex) {
        const monsterHrid = this.panel.querySelector('#mwi-csim-laby-monster')?.value;
        const roomLevel = parseInt(this.panel.querySelector('#mwi-csim-laby-level')?.value) || 100;
        const hours = Math.min(
            10000,
            Math.max(1, parseInt(this.panel.querySelector('#mwi-csim-laby-hours')?.value) || 10)
        );

        if (!monsterHrid) {
            this._setStatus('Select a monster in the Labyrinth tab first.');
            return;
        }

        const crates = [];
        const coffeeHrid = this.panel.querySelector('#mwi-csim-laby-coffee')?.value;
        const foodHrid = this.panel.querySelector('#mwi-csim-laby-food')?.value;
        if (coffeeHrid) crates.push(coffeeHrid);
        if (foodHrid) crates.push(foodHrid);

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus('No game data available.');
            return;
        }

        let playerDTOs;
        if (this._editedDTOs) {
            playerDTOs = Object.values(this._editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
        }

        if (!playerDTOs?.length || !playerDTOs[playerIndex]) {
            this._setStatus('No player data available.');
            return;
        }

        const communityBuffs = getCommunityBuffs();

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

        try {
            const results = await runLabyrinthUpgradeAnalysis(
                {
                    playerDTOs,
                    playerIndex,
                    monsterHrid,
                    roomLevel,
                    crates,
                    hours,
                    communityBuffs,
                    upgradeMode: 'equipment',
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
                this._setStatus('Analysis cancelled.');
            } else {
                this._renderLabyrinthUpgradeResults(results, monsterHrid, roomLevel, gameData);
                this._setStatus(`Labyrinth analysis complete. ${results.results.length} upgrades evaluated.`);
            }
        } catch (error) {
            console.error('[CombatSimUI] Labyrinth upgrade analysis failed:', error);
            this._setStatus('Analysis failed: ' + error.message);
        } finally {
            progressEl.style.display = 'none';
            runBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        }
    }

    /**
     * Render labyrinth upgrade analysis results.
     * @private
     */
    _renderLabyrinthUpgradeResults(results, monsterHrid, roomLevel, gameData) {
        const container = this.panel.querySelector('#mwi-csim-upgrade-results');
        if (!container) return;

        if (!results.results.length) {
            container.innerHTML =
                '<div style="color:#888; text-align:center; padding:20px;">No upgrade candidates found.</div>';
            return;
        }

        const monsterData = gameData.combatMonsterDetailMap?.[monsterHrid];
        const monsterName = monsterData?.name || monsterHrid.split('/').pop();
        const baseWinRate = results.baseline?.winRate || 0;

        const tableStyle = 'width:100%; border-collapse:collapse; font-size:11px;';
        const thStyle = 'padding:4px 6px; text-align:left; border-bottom:1px solid #333; color:#888; font-weight:600;';
        const tdStyle = 'padding:4px 6px; border-bottom:1px solid #1a1a2e;';

        let html = `
            <div style="margin-bottom:8px; font-size:12px; color:#888;">
                ${monsterName} Lv${roomLevel} — Baseline: <span style="color:${ACCENT}; font-weight:600;">${(baseWinRate * 100).toFixed(1)}%</span>
            </div>
            <table style="${tableStyle}">
            <thead><tr>
                <th style="${thStyle}">Upgrade</th>
                <th style="${thStyle}">Cost</th>
                <th style="${thStyle}">Win Rate</th>
                <th style="${thStyle}">Delta</th>
                <th style="${thStyle}">Gold/1%</th>
            </tr></thead><tbody>`;

        for (const r of results.results) {
            const delta = r.winRateDelta * 100;
            let deltaColor = '#888';
            if (delta > 0.5) deltaColor = '#4caf50';
            else if (delta > 0) deltaColor = '#8bc34a';
            else if (delta < -0.5) deltaColor = '#f44336';
            else if (delta < 0) deltaColor = '#ff9800';

            const deltaStr = delta > 0 ? `+${delta.toFixed(2)}%` : `${delta.toFixed(2)}%`;
            const costStr = r.cost > 0 ? formatKMB(r.cost) : '—';
            const goldPerStr = r.goldPerWinRate === Infinity ? '∞' : formatKMB(r.goldPerWinRate);
            const winRateStr = (r.winRate * 100).toFixed(1) + '%';

            html += `<tr>
                <td style="${tdStyle}">${r.candidate.description}</td>
                <td style="${tdStyle} font-variant-numeric:tabular-nums;">${costStr}</td>
                <td style="${tdStyle} font-variant-numeric:tabular-nums;">${winRateStr}</td>
                <td style="${tdStyle} color:${deltaColor}; font-weight:600;">${deltaStr}</td>
                <td style="${tdStyle} font-variant-numeric:tabular-nums;">${goldPerStr}</td>
            </tr>`;
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─── Labyrinth Tab Methods ───────────────────────────────────────────────────

    /**
     * Populate the labyrinth monster dropdown.
     * @private
     */
    _populateLabyrinthMonsters() {
        const select = this.panel?.querySelector('#mwi-csim-laby-monster');
        if (!select) return;

        const monsters = getLabyrinthMonsters();
        select.innerHTML = '';

        for (const monster of monsters) {
            const option = document.createElement('option');
            option.value = monster.hrid;
            option.textContent = monster.name;
            select.appendChild(option);
        }
    }

    /**
     * Handle Labyrinth Simulate button.
     * @private
     */
    async _onLabyrinthSimulate() {
        if (this.isRunning) {
            cancelSimulation();
            this._setStatus('Labyrinth simulation cancelled.');
            return;
        }

        const monsterHrid = this.panel.querySelector('#mwi-csim-laby-monster')?.value;
        const roomLevel = parseInt(this.panel.querySelector('#mwi-csim-laby-level')?.value) || 100;
        const hours = Math.min(
            10000,
            Math.max(1, parseInt(this.panel.querySelector('#mwi-csim-laby-hours')?.value) || 10)
        );

        if (!monsterHrid) {
            this._setStatus('No monster selected.');
            return;
        }

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus('No game data available.');
            return;
        }

        // Build crate list from selections
        const crates = [];
        const coffeeHrid = this.panel.querySelector('#mwi-csim-laby-coffee')?.value;
        const foodHrid = this.panel.querySelector('#mwi-csim-laby-food')?.value;
        if (coffeeHrid) crates.push(coffeeHrid);
        if (foodHrid) crates.push(foodHrid);

        // Get player DTOs
        let playerDTOs;
        if (this._editedDTOs) {
            playerDTOs = Object.values(this._editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
        }

        if (!playerDTOs.length) {
            this._setStatus('No character data available.');
            return;
        }

        // Labyrinth is solo — use only the first player
        playerDTOs = [playerDTOs[0]];

        const communityBuffs = getCommunityBuffs();

        // Need a zoneHrid for SimResult — use any valid combat zone
        const zones = getCombatZones();
        const zoneHrid = zones[0]?.hrid || '/actions/combat/fly';

        // UI state
        this.isRunning = true;
        const runBtn = this.panel.querySelector('#mwi-csim-laby-run');
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';

        const progressContainer = this.panel.querySelector('#mwi-csim-laby-progress');
        const progressFill = this.panel.querySelector('#mwi-csim-laby-progress-fill');
        const progressText = this.panel.querySelector('#mwi-csim-laby-progress-text');
        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';

        const simStartTime = Date.now();

        try {
            if (this._labyFindMaxMode) {
                // Binary search for max beatable level
                const threshold =
                    Math.min(
                        100,
                        Math.max(1, parseInt(this.panel.querySelector('#mwi-csim-laby-threshold')?.value) || 95)
                    ) / 100;
                const maxResult = await findMaxLabyrinthLevel(
                    { gameData, playerDTOs, zoneHrid, monsterHrid, crates, communityBuffs, simHours: hours, threshold },
                    ({ level, winRate, step, totalSteps }) => {
                        const pct = Math.round((step / totalSteps) * 100);
                        progressFill.style.width = `${pct}%`;
                        progressText.textContent = `Lv ${level}: ${(winRate * 100).toFixed(1)}%`;
                        this._setStatus(`Find Max: testing level ${level} (step ${step}/${totalSteps})...`);
                    }
                );

                this._displayLabyrinthFindMax(monsterHrid, maxResult, gameData);
                const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);
                this._setStatus(
                    `Find Max complete in ${totalElapsed}: Max Level ${maxResult.maxLevel} (${(maxResult.winRate * 100).toFixed(1)}% win rate)`
                );
            } else {
                // Single level simulation
                const simResult = await runLabyrinthSimulation(
                    { gameData, playerDTOs, zoneHrid, monsterHrid, roomLevel, crates, hours, communityBuffs },
                    (percent) => {
                        progressFill.style.width = `${percent}%`;
                        progressText.textContent = `${percent}%`;
                    }
                );

                this._displayLabyrinthResults(simResult, monsterHrid, roomLevel, hours, gameData);
                const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);
                this._setStatus(`Labyrinth sim complete in ${totalElapsed}`);
            }
        } catch (error) {
            if (error.message === 'Cancelled') {
                this._setStatus('Labyrinth simulation cancelled.');
            } else {
                console.error('[CombatSimUI] Labyrinth sim failed:', error);
                this._setStatus(`Labyrinth error: ${error.message || 'Unknown error'}`);
            }
        } finally {
            this.isRunning = false;
            runBtn.disabled = false;
            runBtn.style.opacity = '1';
            runBtn.style.cursor = 'pointer';
            progressContainer.style.display = 'none';
        }
    }

    /**
     * Display labyrinth simulation results.
     * @private
     */
    _displayLabyrinthResults(simResult, monsterHrid, roomLevel, hours, gameData) {
        const container = this.panel.querySelector('#mwi-csim-laby-results');
        if (!container) return;

        const attempts = simResult.labyAttemptCount || 1;
        const encounters = simResult.encounters || 0;
        const winRate = encounters / attempts;
        const encountersPerHr = encounters / hours;
        const simTimeNs = simResult.simulatedTime || hours * 3600 * 1e9;
        const avgFightTimeS = attempts > 0 ? simTimeNs / attempts / 1e9 : 0;

        // Get monster name
        const monsterData = gameData.combatMonsterDetailMap?.[monsterHrid];
        const monsterName = monsterData?.name || monsterHrid.split('/').pop();

        const rowStyle = 'display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #1a1a1a;';
        const labelStyle = 'color:#888;';
        const valueStyle = 'color:#e0e0e0; font-weight:600; font-variant-numeric:tabular-nums;';

        let winColor = '#4caf50';
        if (winRate < 0.5) winColor = '#f44336';
        else if (winRate < 0.9) winColor = '#ff9800';
        else if (winRate < 0.95) winColor = '#ffeb3b';

        let html = `
            <div style="margin-bottom:12px;">
                <div style="font-size:14px; font-weight:700; color:${ACCENT}; margin-bottom:8px;">
                    ${monsterName} — Level ${roomLevel}
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Win Rate</span>
                    <span style="color:${winColor}; font-weight:700; font-size:14px;">${(winRate * 100).toFixed(1)}%</span>
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Encounters / hr</span>
                    <span style="${valueStyle}">${encountersPerHr.toFixed(1)}</span>
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Avg Fight Time</span>
                    <span style="${valueStyle}">${avgFightTimeS.toFixed(1)}s</span>
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Total Attempts</span>
                    <span style="${valueStyle}">${formatWithSeparator(attempts)}</span>
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Total Kills</span>
                    <span style="${valueStyle}">${formatWithSeparator(encounters)}</span>
                </div>
            </div>
        `;

        // Deaths
        const playerDeaths = simResult.deaths?.player1 || 0;
        if (playerDeaths > 0) {
            html += `
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Player Deaths</span>
                    <span style="color:#f44336; font-weight:600;">${formatWithSeparator(playerDeaths)}</span>
                </div>
            `;
        }

        // Max enrage
        if (simResult.maxEnrageStack > 0) {
            html += `
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Max Enrage Stack</span>
                    <span style="${valueStyle}">${simResult.maxEnrageStack}</span>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    /**
     * Display Find Max Level results.
     * @private
     */
    _displayLabyrinthFindMax(monsterHrid, maxResult, gameData) {
        const container = this.panel.querySelector('#mwi-csim-laby-results');
        if (!container) return;

        const monsterData = gameData.combatMonsterDetailMap?.[monsterHrid];
        const monsterName = monsterData?.name || monsterHrid.split('/').pop();

        const rowStyle = 'display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #1a1a1a;';
        const labelStyle = 'color:#888;';
        const valueStyle = 'color:#e0e0e0; font-weight:600; font-variant-numeric:tabular-nums;';

        const html = `
            <div style="margin-bottom:12px;">
                <div style="font-size:14px; font-weight:700; color:${ACCENT}; margin-bottom:8px;">
                    ${monsterName} — Find Max Level
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Max Beatable Level</span>
                    <span style="color:#4caf50; font-weight:700; font-size:16px;">${maxResult.maxLevel}</span>
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Win Rate at Max</span>
                    <span style="${valueStyle}">${(maxResult.winRate * 100).toFixed(1)}%</span>
                </div>
                <div style="${rowStyle}">
                    <span style="${labelStyle}">Max Floor</span>
                    <span style="${valueStyle}">${Math.floor(maxResult.maxLevel / 20)}</span>
                </div>
            </div>
            <div style="color:#555; font-size:11px; margin-top:8px;">
                Set your automation cap to level ${maxResult.maxLevel} for this monster.
            </div>
        `;

        container.innerHTML = html;
    }
}

const combatSimUI = new CombatSimUI();
export default combatSimUI;
