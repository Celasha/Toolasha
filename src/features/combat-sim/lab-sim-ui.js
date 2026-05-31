/**
 * Lab Sim UI
 * Floating panel for configuring and running labyrinth simulations.
 * Four tabs: Configure (editor + crate selectors), Max Level, Upgrade, Skilling.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import {
    buildGameDataPayload,
    buildAllPlayerDTOs,
    getCombatZones,
    getCommunityBuffs,
    getLabyrinthMonsters,
} from './combat-sim-adapter.js';
import { runLabyrinthSimulation, cancelSimulation } from './combat-sim-runner.js';
import { findMaxLabyrinthLevel } from './labyrinth-level-finder.js';
import {
    runLabyrinthUpgradeAnalysis,
    computeSkillingClearRatesFromEditor,
    runSkillingUpgradeAnalysis,
} from './upgrade-advisor.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { SimEditor } from './sim-editor.js';
import labyrinthClearRate from '../combat/labyrinth-clear-rate.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';
import { t } from '../../core/i18n.js';

const PANEL_ID = 'mwi-lab-sim-panel';
const ACCENT = '#4a9eff';
const ACCENT_BORDER = 'rgba(74, 158, 255, 0.5)';
const ACCENT_BG = 'rgba(74, 158, 255, 0.12)';
const ACCENT_BTN_BG = 'rgba(74, 158, 255, 0.2)';
const ACCENT_BTN_BORDER = 'rgba(74, 158, 255, 0.4)';

/**
 * @param {number} seconds
 * @returns {string}
 */
function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(0);
    return `${m}m ${s}s`;
}

class LabSimUI {
    constructor() {
        this.panel = null;
        this._editor = null;
        this._skillingEditor = null;
        this.isRunning = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.elapsedTimer = null;
        this._activeTab = 'configure';
        this._maxLevel = null;
        this._labyFindMaxMode = false;
        this._labyResults = null;
        this._upgradeAborted = false;
        this._skillingAborted = false;
        this._skillLoadouts = {};
        this._skillLoadoutsLoaded = false;
    }

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
            width: 560px;
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
            <span style="font-weight:700; font-size:14px; color:${ACCENT};">${t('Lab Simulator')}</span>
            <button id="mwi-labsim-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">\u00d7</button>
        `;
        this._setupDrag(header);

        // Tab bar
        const tabBar = document.createElement('div');
        tabBar.id = 'mwi-labsim-tabbar';
        tabBar.style.cssText = 'display:flex; gap:0; padding:0; flex-shrink:0; border-bottom:1px solid #222;';
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
            <button id="mwi-labsim-tab-configure" style="${tabStyle(true)}">${t('Configure')}</button>
            <button id="mwi-labsim-tab-maxlevel" style="${tabStyle(false)}">${t('Max Level')}</button>
            <button id="mwi-labsim-tab-upgrade" style="${tabStyle(false)}">${t('Upgrade')}</button>
            <button id="mwi-labsim-tab-skilling" style="${tabStyle(false)}">${t('Skilling')}</button>
        `;

        // ── Configure tab ──
        const configureContent = document.createElement('div');
        configureContent.id = 'mwi-labsim-configure-content';
        configureContent.style.cssText = 'display:flex; flex-direction:column; flex:1; overflow:hidden;';

        const crateRow = document.createElement('div');
        crateRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
            font-size: 12px;
        `;
        const crateSelectStyle =
            'background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px;';
        crateRow.innerHTML = `
            <label style="color:#888;">${t('Tea')}</label>
            <select id="mwi-labsim-tea" style="${crateSelectStyle}">
                <option value="">${t('None')}</option>
                <option value="/items/basic_tea_crate">${t('Basic')}</option>
                <option value="/items/advanced_tea_crate">${t('Advanced')}</option>
                <option value="/items/expert_tea_crate" selected>${t('Expert')}</option>
            </select>
            <label style="color:#888;">${t('Coffee')}</label>
            <select id="mwi-labsim-coffee" style="${crateSelectStyle}">
                <option value="">${t('None')}</option>
                <option value="/items/basic_coffee_crate">${t('Basic')}</option>
                <option value="/items/advanced_coffee_crate">${t('Advanced')}</option>
                <option value="/items/expert_coffee_crate" selected>${t('Expert')}</option>
            </select>
            <label style="color:#888;">${t('Food')}</label>
            <select id="mwi-labsim-food" style="${crateSelectStyle}">
                <option value="">${t('None')}</option>
                <option value="/items/basic_food_crate">${t('Basic')}</option>
                <option value="/items/advanced_food_crate">${t('Advanced')}</option>
                <option value="/items/expert_food_crate" selected>${t('Expert')}</option>
            </select>
        `;

        const editorArea = document.createElement('div');
        editorArea.id = 'mwi-labsim-editor';
        editorArea.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';
        editorArea.innerHTML =
            '<div style="color:#555; font-size:12px; text-align:center; padding:20px 0;">' +
            t('Loading loadout...') +
            '</div>';

        this._editor = new SimEditor({ editorEl: editorArea, labMode: true });

        configureContent.appendChild(crateRow);

        // Collapsible Labyrinth Buffs section
        const buffsSection = document.createElement('div');
        buffsSection.style.cssText = 'border-bottom:1px solid #222; flex-shrink:0;';

        const buffsHeader = document.createElement('div');
        buffsHeader.style.cssText =
            'display:flex; align-items:center; justify-content:space-between; padding:6px 14px; cursor:pointer; color:#888; font-size:12px;';
        buffsHeader.innerHTML = `
            <span>${t('Labyrinth Buffs')}</span>
            <span id="mwi-labsim-buffs-toggle" style="font-size:10px;">\u25B6</span>
        `;

        const buffsBody = document.createElement('div');
        buffsBody.id = 'mwi-labsim-buffs-body';
        buffsBody.style.cssText = 'display:none; padding:4px 14px 8px; font-size:11px;';

        buffsHeader.addEventListener('click', () => {
            const isOpen = buffsBody.style.display !== 'none';
            buffsBody.style.display = isOpen ? 'none' : 'block';
            this.panel.querySelector('#mwi-labsim-buffs-toggle').textContent = isOpen ? '\u25B6' : '\u25BC';
            if (!isOpen) this._renderBuffsSection();
        });

        buffsSection.appendChild(buffsHeader);
        buffsSection.appendChild(buffsBody);
        configureContent.appendChild(buffsSection);

        configureContent.appendChild(editorArea);

        // ── Max Level tab ──
        const maxLevelContent = document.createElement('div');
        maxLevelContent.id = 'mwi-labsim-maxlevel-content';
        maxLevelContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        const selectStyle =
            'background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; flex:1; min-width:0;';
        const inputStyle =
            'width:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center;';

        const maxLevelControls = document.createElement('div');
        maxLevelControls.style.cssText = `
            display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
            padding: 10px 14px; border-bottom: 1px solid #222; flex-shrink: 0;
        `;
        maxLevelControls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Monster')}</label>
            <select id="mwi-labsim-monster" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">${t('Level')}</label>
            <input id="mwi-labsim-level" type="number" min="20" max="300" value="100" style="${inputStyle}">
            <label style="color:#888; font-size:12px;">${t('Hours')}</label>
            <input id="mwi-labsim-hours" type="number" min="1" max="10000" value="10" style="${inputStyle}">
            <button id="mwi-labsim-run" style="
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

        const findMaxRow = document.createElement('div');
        findMaxRow.style.cssText = `
            display: flex; align-items: center; gap: 12px;
            padding: 6px 14px; border-bottom: 1px solid #222; flex-shrink: 0; font-size: 12px;
        `;
        findMaxRow.innerHTML = `
            <label style="display:flex; align-items:center; gap:4px; color:#888; cursor:pointer;" title="${t('Binary search for highest beatable level at the specified win rate threshold')}">
                <input type="checkbox" id="mwi-labsim-findmax" style="margin:0; cursor:pointer;">
                ${t('Find Max')} \u2265
            </label>
            <input id="mwi-labsim-threshold" type="number" min="1" max="100" value="95" style="width:44px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 4px; font-size:12px; text-align:center;">
            <span style="color:#888; font-size:12px;">%</span>
        `;

        const maxLevelProgress = document.createElement('div');
        maxLevelProgress.id = 'mwi-labsim-progress';
        maxLevelProgress.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        maxLevelProgress.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; background:#1a1a2e; border-radius:4px; height:18px; overflow:hidden; position:relative; border:1px solid #333;">
                    <div id="mwi-labsim-progress-fill" style="height:100%; width:0%; background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT}); border-radius:3px; transition:width 0.2s ease;"></div>
                    <span id="mwi-labsim-progress-text" style="position:absolute; top:0; left:0; right:0; text-align:center; font-size:11px; line-height:18px; color:#e0e0e0; font-weight:600;">0%</span>
                </div>
                <button id="mwi-labsim-stop" style="
                    background:rgba(255,80,80,0.2); color:#f44; border:1px solid rgba(255,80,80,0.4);
                    border-radius:4px; padding:2px 10px; font-size:11px; cursor:pointer; font-weight:600;">${t('Stop')}</button>
            </div>
        `;

        const maxLevelResults = document.createElement('div');
        maxLevelResults.id = 'mwi-labsim-results';
        maxLevelResults.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';

        maxLevelContent.appendChild(maxLevelControls);
        maxLevelContent.appendChild(findMaxRow);
        maxLevelContent.appendChild(maxLevelProgress);
        maxLevelContent.appendChild(maxLevelResults);

        // ── Upgrade tab ──
        const upgradeContent = document.createElement('div');
        upgradeContent.id = 'mwi-labsim-upgrade-content';
        upgradeContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        const upgradeControls = document.createElement('div');
        upgradeControls.style.cssText = `
            display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
            padding: 10px 14px; border-bottom: 1px solid #222; flex-shrink: 0;
        `;
        upgradeControls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Player')}</label>
            <select id="mwi-labsim-upgrade-player" style="${selectStyle}"></select>
            <label style="color:#888; font-size:12px;">${t('Enemy Level')}</label>
            <input id="mwi-labsim-upgrade-level" type="number" min="20" max="300" value="100" style="${inputStyle}"
                title="${t('Defaults to Max Level result when available')}">
            <button id="mwi-labsim-upgrade-run" style="
                margin-left: auto;
                background: ${ACCENT_BTN_BG};
                color: ${ACCENT};
                border: 1px solid ${ACCENT_BTN_BORDER};
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;">${t('Analyze')}</button>
            <button id="mwi-labsim-upgrade-stop" style="
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
        upgradeProgress.id = 'mwi-labsim-upgrade-progress';
        upgradeProgress.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        upgradeProgress.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; background:#1a1a2e; border-radius:4px; height:18px; overflow:hidden; position:relative; border:1px solid #333;">
                    <div id="mwi-labsim-upgrade-progress-fill" style="height:100%; width:0%; background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT}); border-radius:3px; transition:width 0.2s ease;"></div>
                    <span id="mwi-labsim-upgrade-progress-text" style="position:absolute; top:0; left:0; right:0; text-align:center; font-size:11px; line-height:18px; color:#e0e0e0; font-weight:600;">0 / 0</span>
                </div>
            </div>
        `;

        const upgradeResults = document.createElement('div');
        upgradeResults.id = 'mwi-labsim-upgrade-results';
        upgradeResults.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';

        upgradeContent.appendChild(upgradeControls);
        upgradeContent.appendChild(upgradeProgress);
        upgradeContent.appendChild(upgradeResults);

        // ── Skilling tab ──
        const skillingContent = document.createElement('div');
        skillingContent.id = 'mwi-labsim-skilling-content';
        skillingContent.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

        const skillingControls = document.createElement('div');
        skillingControls.style.cssText = `
            display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
            padding: 10px 14px; border-bottom: 1px solid #222; flex-shrink: 0;
        `;
        skillingControls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Room Level')}</label>
            <input id="mwi-labsim-skilling-level" type="number" min="1" max="300" value="100" style="${inputStyle}">
            <button id="mwi-labsim-skilling-calc" style="
                background: ${ACCENT_BTN_BG};
                color: ${ACCENT};
                border: 1px solid ${ACCENT_BTN_BORDER};
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;">${t('Calculate')}</button>
            <button id="mwi-labsim-skilling-upgrade" style="
                background: rgba(255,255,255,0.04);
                border: 1px solid #333;
                color: #aaa;
                border-radius: 6px;
                padding: 5px 10px;
                font-size: 12px;
                cursor: pointer;
                font-family: inherit;">${t('Analyze Upgrades')}</button>
            <button id="mwi-labsim-skilling-stop" style="
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
            <select id="mwi-labsim-skilling-filter" style="
                background:#1a1a2e;
                color:#e0e0e0;
                border:1px solid #444;
                border-radius:4px;
                padding:4px 6px;
                font-size:11px;
                font-family:inherit;
                margin-left:auto;">
                <option value="">${t('All Skills')}</option>
                <option value="/skills/woodcutting">${t('Woodcutting')}</option>
                <option value="/skills/foraging">${t('Foraging')}</option>
                <option value="/skills/milking">${t('Milking')}</option>
                <option value="/skills/cooking">${t('Cooking')}</option>
                <option value="/skills/brewing">${t('Brewing')}</option>
                <option value="/skills/cheesesmithing">${t('Cheesesmithing')}</option>
                <option value="/skills/crafting">${t('Crafting')}</option>
                <option value="/skills/tailoring">${t('Tailoring')}</option>
                <option value="/skills/alchemy">${t('Alchemy')}</option>
                <option value="/skills/enhancing">${t('Enhancing')}</option>
            </select>
        `;

        const skillingCrateRow = document.createElement('div');
        skillingCrateRow.style.cssText = `
            display: flex; align-items: center; gap: 10px;
            padding: 6px 14px; border-bottom: 1px solid #222; flex-shrink: 0; font-size: 12px;
        `;
        skillingCrateRow.innerHTML = `
            <label style="color:#888;">${t('Tea')}</label>
            <select id="mwi-labsim-skilling-tea" style="${crateSelectStyle}">
                <option value="">${t('None')}</option>
                <option value="/items/basic_tea_crate">${t('Basic')}</option>
                <option value="/items/advanced_tea_crate">${t('Advanced')}</option>
                <option value="/items/expert_tea_crate" selected>${t('Expert')}</option>
            </select>
            <label style="color:#888;">${t('Coffee')}</label>
            <select id="mwi-labsim-skilling-coffee" style="${crateSelectStyle}">
                <option value="">${t('None')}</option>
                <option value="/items/basic_coffee_crate">${t('Basic')}</option>
                <option value="/items/advanced_coffee_crate">${t('Advanced')}</option>
                <option value="/items/expert_coffee_crate" selected>${t('Expert')}</option>
            </select>
            <label style="color:#888;">${t('Food')}</label>
            <select id="mwi-labsim-skilling-food" style="${crateSelectStyle}">
                <option value="">${t('None')}</option>
                <option value="/items/basic_food_crate">${t('Basic')}</option>
                <option value="/items/advanced_food_crate">${t('Advanced')}</option>
                <option value="/items/expert_food_crate" selected>${t('Expert')}</option>
            </select>
        `;

        const skillingLoadoutArea = document.createElement('div');
        skillingLoadoutArea.id = 'mwi-labsim-skilling-loadouts';
        skillingLoadoutArea.style.cssText =
            'padding:8px 14px; border-bottom:1px solid #222; flex-shrink:0; overflow-y:auto; max-height:160px;';

        const skillingEditorArea = document.createElement('div');
        skillingEditorArea.id = 'mwi-labsim-skilling-editor';
        skillingEditorArea.style.cssText = 'overflow-y:auto; padding:10px 14px; max-height:200px; flex-shrink:0;';
        skillingEditorArea.innerHTML =
            '<div style="color:#555; font-size:12px; text-align:center; padding:20px 0;">' +
            t('Loading loadout...') +
            '</div>';

        this._skillingEditor = new SimEditor({ editorEl: skillingEditorArea, labMode: true, skillingMode: true });

        const skillingProgress = document.createElement('div');
        skillingProgress.id = 'mwi-labsim-skilling-progress';
        skillingProgress.style.cssText = 'display:none; padding:6px 14px; flex-shrink:0;';
        skillingProgress.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; background:#1a1a2e; border-radius:4px; height:18px; overflow:hidden; position:relative; border:1px solid #333;">
                    <div id="mwi-labsim-skilling-progress-fill" style="height:100%; width:0%; background:linear-gradient(90deg, ${ACCENT_BTN_BG}, ${ACCENT}); border-radius:3px; transition:width 0.2s ease;"></div>
                    <span id="mwi-labsim-skilling-progress-text" style="position:absolute; top:0; left:0; right:0; text-align:center; font-size:11px; line-height:18px; color:#e0e0e0; font-weight:600;">0 / 0</span>
                </div>
            </div>
        `;

        const skillingResults = document.createElement('div');
        skillingResults.id = 'mwi-labsim-skilling-results';
        skillingResults.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';

        skillingContent.appendChild(skillingControls);
        skillingContent.appendChild(skillingCrateRow);
        skillingContent.appendChild(skillingLoadoutArea);
        skillingContent.appendChild(skillingEditorArea);
        skillingContent.appendChild(skillingProgress);
        skillingContent.appendChild(skillingResults);

        // Status bar
        const status = document.createElement('div');
        status.id = 'mwi-labsim-status';
        status.style.cssText =
            'padding:6px 14px; color:#555; font-size:11px; border-top:1px solid #1a1a1a; flex-shrink:0; text-align:center;';
        status.textContent = t('Select a monster and click Simulate.');

        // Assemble
        this.panel.appendChild(header);
        this.panel.appendChild(tabBar);
        this.panel.appendChild(configureContent);
        this.panel.appendChild(maxLevelContent);
        this.panel.appendChild(upgradeContent);
        this.panel.appendChild(skillingContent);
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
        this.panel.querySelector('#mwi-labsim-close').addEventListener('click', () => {
            this.panel.style.display = 'none';
        });
        this.panel.addEventListener('mousedown', () => bringPanelToFront(this.panel));

        // Tab switching
        this.panel
            .querySelector('#mwi-labsim-tab-configure')
            .addEventListener('click', () => this._switchTab('configure'));
        this.panel
            .querySelector('#mwi-labsim-tab-maxlevel')
            .addEventListener('click', () => this._switchTab('maxlevel'));
        this.panel.querySelector('#mwi-labsim-tab-upgrade').addEventListener('click', () => this._switchTab('upgrade'));
        this.panel
            .querySelector('#mwi-labsim-tab-skilling')
            .addEventListener('click', () => this._switchTab('skilling'));

        // Max Level listeners
        this.panel.querySelector('#mwi-labsim-run').addEventListener('click', () => this._onSimulate());
        this.panel.querySelector('#mwi-labsim-stop').addEventListener('click', () => {
            cancelSimulation();
            this.isRunning = false;
            this._setStatus(t('Labyrinth simulation cancelled.'));
            this.panel.querySelector('#mwi-labsim-progress').style.display = 'none';
        });
        this.panel.querySelector('#mwi-labsim-findmax').addEventListener('change', (e) => {
            this._labyFindMaxMode = e.target.checked;
            const levelInput = this.panel.querySelector('#mwi-labsim-level');
            levelInput.disabled = e.target.checked;
            levelInput.style.opacity = e.target.checked ? '0.4' : '1';
        });

        // Upgrade listeners
        this.panel.querySelector('#mwi-labsim-upgrade-run').addEventListener('click', () => this._onUpgradeAnalyze());
        this.panel.querySelector('#mwi-labsim-upgrade-stop').addEventListener('click', () => {
            this._upgradeAborted = true;
        });

        // Skilling listeners
        this.panel
            .querySelector('#mwi-labsim-skilling-calc')
            .addEventListener('click', () => this._onSkillingCalculate());
        this.panel
            .querySelector('#mwi-labsim-skilling-upgrade')
            .addEventListener('click', () => this._onSkillingUpgradeAnalyze());
        this.panel.querySelector('#mwi-labsim-skilling-stop').addEventListener('click', () => {
            this._skillingAborted = true;
        });
        this.panel.querySelector('#mwi-labsim-skilling-filter').addEventListener('change', () => {
            this._renderSkillLoadoutTable();
        });

        this._populateMonsters();
    }

    /** @private */
    _populateMonsters() {
        const select = this.panel?.querySelector('#mwi-labsim-monster');
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

    /** @private */
    _populateUpgradePlayerSelector() {
        const select = this.panel?.querySelector('#mwi-labsim-upgrade-player');
        if (!select) return;

        const playerInfo = this._editor?.getPlayerInfo() || [];
        select.innerHTML = '';
        playerInfo.forEach((p, i) => {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = p.name || `${t('Player')} ${i + 1}`;
            select.appendChild(option);
        });

        if (playerInfo.length === 0) {
            const option = document.createElement('option');
            option.value = 0;
            option.textContent = t('Player 1');
            select.appendChild(option);
        }
    }

    /** @private */
    _renderBuffsSection() {
        const container = this.panel?.querySelector('#mwi-labsim-buffs-body');
        if (!container) return;

        const info = dataManager.characterData?.characterInfo;
        if (!info) {
            container.innerHTML = `<div style="color:#555;">${t('No character data available.')}</div>`;
            return;
        }

        const groups = [
            {
                label: t('Combat'),
                buffs: [
                    { key: 'labyrinthCombatDamageLevel', name: t('Damage') },
                    { key: 'labyrinthAttackSpeedLevel', name: t('Atk Speed') },
                    { key: 'labyrinthCastSpeedLevel', name: t('Cast Speed') },
                    { key: 'labyrinthCriticalRateLevel', name: t('Crit Rate') },
                ],
            },
            {
                label: t('Skilling'),
                buffs: [
                    { key: 'labyrinthSkillActionSpeedLevel', name: t('Speed') },
                    { key: 'labyrinthSkillingEfficiencyLevel', name: t('Efficiency') },
                    { key: 'labyrinthSkillingSuccessLevel', name: t('Success') },
                    { key: 'labyrinthSkillingDoubleProgressLevel', name: t('Double') },
                ],
            },
            {
                label: t('Other'),
                buffs: [
                    { key: 'labyrinthExperienceLevel', name: t('Experience') },
                    { key: 'labyrinthCooldownLevel', name: t('Cooldown') },
                    { key: 'labyrinthTorchLevel', name: t('Torch') },
                    { key: 'labyrinthShroudLevel', name: t('Shroud') },
                    { key: 'labyrinthBeaconLevel', name: t('Beacon') },
                    { key: 'labyrinthAutomationLevel', name: t('Automation') },
                ],
            },
        ];

        let html = '';
        for (const group of groups) {
            html += `<div style="color:#666; font-weight:600; font-size:10px; text-transform:uppercase; margin-top:4px; margin-bottom:2px;">${group.label}</div>`;
            html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:1px 16px;">';
            for (const b of group.buffs) {
                const level = Math.max(0, Math.floor(Number(info[b.key]) || 0));
                const isMaxed = level >= 12;
                const color = isMaxed ? '#4caf50' : '#e0e0e0';
                html += `<div style="display:flex; justify-content:space-between; padding:1px 0;">
                    <span style="color:#aaa;">${b.name}</span>
                    <span style="color:${color}; font-weight:${isMaxed ? '600' : '400'};">${level}/12</span>
                </div>`;
            }
            html += '</div>';
        }
        container.innerHTML = html;
    }

    /**
     * Get selected crate HRIDs from the Configure tab.
     * @returns {string[]}
     */
    getSelectedCrates() {
        const crates = [];
        const teaHrid = this.panel?.querySelector('#mwi-labsim-tea')?.value;
        const coffeeHrid = this.panel?.querySelector('#mwi-labsim-coffee')?.value;
        const foodHrid = this.panel?.querySelector('#mwi-labsim-food')?.value;
        if (teaHrid) crates.push(teaHrid);
        if (coffeeHrid) crates.push(coffeeHrid);
        if (foodHrid) crates.push(foodHrid);
        return crates;
    }

    /** @private */
    _switchTab(tab) {
        this._activeTab = tab;
        const configureContent = this.panel.querySelector('#mwi-labsim-configure-content');
        const maxLevelContent = this.panel.querySelector('#mwi-labsim-maxlevel-content');
        const upgradeContent = this.panel.querySelector('#mwi-labsim-upgrade-content');
        const skillingContent = this.panel.querySelector('#mwi-labsim-skilling-content');
        const tabConfigure = this.panel.querySelector('#mwi-labsim-tab-configure');
        const tabMaxLevel = this.panel.querySelector('#mwi-labsim-tab-maxlevel');
        const tabUpgrade = this.panel.querySelector('#mwi-labsim-tab-upgrade');
        const tabSkilling = this.panel.querySelector('#mwi-labsim-tab-skilling');

        const activeStyle = `flex:1; padding:7px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all 0.1s; background:${ACCENT_BG}; color:${ACCENT}; border-bottom:2px solid ${ACCENT};`;
        const inactiveStyle =
            'flex:1; padding:7px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; font-family:inherit; transition:all 0.1s; background:transparent; color:#888; border-bottom:2px solid transparent;';

        configureContent.style.display = 'none';
        maxLevelContent.style.display = 'none';
        upgradeContent.style.display = 'none';
        skillingContent.style.display = 'none';
        tabConfigure.style.cssText = inactiveStyle;
        tabMaxLevel.style.cssText = inactiveStyle;
        tabUpgrade.style.cssText = inactiveStyle;
        tabSkilling.style.cssText = inactiveStyle;

        if (tab === 'configure') {
            configureContent.style.display = 'flex';
            tabConfigure.style.cssText = activeStyle;
        } else if (tab === 'maxlevel') {
            maxLevelContent.style.display = 'flex';
            tabMaxLevel.style.cssText = activeStyle;
        } else if (tab === 'upgrade') {
            upgradeContent.style.display = 'flex';
            tabUpgrade.style.cssText = activeStyle;
            this._populateUpgradePlayerSelector();
            if (this._maxLevel) {
                const levelInput = this.panel.querySelector('#mwi-labsim-upgrade-level');
                if (levelInput && !levelInput.dataset.userModified) {
                    levelInput.value = this._maxLevel;
                }
            }
        } else if (tab === 'skilling') {
            skillingContent.style.display = 'flex';
            tabSkilling.style.cssText = activeStyle;
            if (!this._skillingEditor.isInitialized()) {
                this._skillingEditor.initEditor().then(() => this._renderSkillLoadoutTable());
            } else {
                this._renderSkillLoadoutTable();
            }
        }
    }

    /** @private */
    _setStatus(text) {
        const el = this.panel?.querySelector('#mwi-labsim-status');
        if (el) el.textContent = text;
    }

    /** @private */
    async _onSimulate() {
        if (this.isRunning) {
            cancelSimulation();
            this._setStatus(t('Labyrinth simulation cancelled.'));
            return;
        }

        const monsterHrid = this.panel.querySelector('#mwi-labsim-monster')?.value;
        const roomLevel = parseInt(this.panel.querySelector('#mwi-labsim-level')?.value) || 100;
        const hours = Math.min(
            10000,
            Math.max(1, parseInt(this.panel.querySelector('#mwi-labsim-hours')?.value) || 10)
        );

        if (!monsterHrid) {
            this._setStatus(t('Select a monster first.'));
            return;
        }

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        const crates = this.getSelectedCrates();
        const labyrinthCombatBuffs = labyrinthClearRate.getLabyrinthCombatBuffs();

        let playerDTOs;
        const editedDTOs = this._editor?.getEditedDTOs();
        if (editedDTOs) {
            playerDTOs = Object.values(editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
        }

        if (!playerDTOs.length) {
            this._setStatus(t('No character data available.'));
            return;
        }

        playerDTOs = [playerDTOs[0]];

        const communityBuffs = getCommunityBuffs();
        const zones = getCombatZones();
        const zoneHrid = zones[0]?.hrid || '/actions/combat/fly';

        this.isRunning = true;
        const runBtn = this.panel.querySelector('#mwi-labsim-run');
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';

        const progressContainer = this.panel.querySelector('#mwi-labsim-progress');
        const progressFill = this.panel.querySelector('#mwi-labsim-progress-fill');
        const progressText = this.panel.querySelector('#mwi-labsim-progress-text');
        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';

        const simStartTime = Date.now();

        try {
            if (this._labyFindMaxMode) {
                const threshold =
                    Math.min(
                        100,
                        Math.max(1, parseInt(this.panel.querySelector('#mwi-labsim-threshold')?.value) || 95)
                    ) / 100;
                const maxResult = await findMaxLabyrinthLevel(
                    {
                        gameData,
                        playerDTOs,
                        zoneHrid,
                        monsterHrid,
                        crates,
                        simHours: hours,
                        communityBuffs,
                        labyrinthCombatBuffs,
                        threshold,
                    },
                    (progress) => {
                        const percent = Math.round((progress.step / progress.totalSteps) * 100);
                        progressFill.style.width = `${percent}%`;
                        progressText.textContent = `${t('Level')} ${progress.level} — ${(progress.winRate * 100).toFixed(0)}% (${t('step')} ${progress.step}/${progress.totalSteps})`;
                    }
                );

                this._maxLevel = maxResult.maxLevel;
                const levelInput = this.panel.querySelector('#mwi-labsim-level');
                if (levelInput) levelInput.value = maxResult.maxLevel;
                const upgradeLevelInput = this.panel.querySelector('#mwi-labsim-upgrade-level');
                if (upgradeLevelInput && !upgradeLevelInput.dataset.userModified) {
                    upgradeLevelInput.value = maxResult.maxLevel;
                }

                this._displayFindMaxResults(maxResult, monsterHrid, simStartTime);
            } else {
                const simResult = await runLabyrinthSimulation(
                    {
                        gameData,
                        playerDTOs,
                        zoneHrid,
                        monsterHrid,
                        roomLevel,
                        crates,
                        hours,
                        communityBuffs,
                        labyrinthCombatBuffs,
                    },
                    (percent) => {
                        progressFill.style.width = `${percent}%`;
                        progressText.textContent = `${percent}%`;
                    }
                );

                this._displaySimResults(simResult, monsterHrid, roomLevel, hours, simStartTime);
            }
        } catch (error) {
            if (error.message !== 'Cancelled') {
                console.error('[LabSimUI] Simulation failed:', error);
                this._setStatus(t('Simulation failed:') + ' ' + error.message);
            }
        } finally {
            this.isRunning = false;
            runBtn.disabled = false;
            runBtn.style.opacity = '1';
            runBtn.style.cursor = 'pointer';
            progressContainer.style.display = 'none';
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
        }
    }

    /** @private */
    _displaySimResults(simResult, monsterHrid, roomLevel, hours, simStartTime) {
        const container = this.panel?.querySelector('#mwi-labsim-results');
        if (!container) return;

        const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);
        const attempts = simResult.labyAttemptCount || 0;
        const encounters = simResult.encounters || 0;
        const deaths = simResult.deaths?.player1 || 0;
        const simHours = (simResult.simulatedTime || 0) / (3600 * 1e9) || hours;
        const winRate = attempts > 0 ? ((encounters / attempts) * 100).toFixed(2) : '0.00';

        const monsterName = monsterHrid.split('/').pop().replace(/_/g, ' ');

        container.innerHTML = `
            <div style="margin-bottom:12px;">
                <div style="color:${ACCENT}; font-weight:700; font-size:13px; margin-bottom:6px;">
                    ${monsterName} \u2014 ${t('Level')} ${roomLevel}
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 20px; font-size:12px;">
                    <div><span style="color:#888;">${t('Win Rate:')}</span> <span style="color:${parseFloat(winRate) >= 95 ? '#4caf50' : parseFloat(winRate) >= 50 ? '#ff9800' : '#f44336'}; font-weight:600;">${winRate}%</span></div>
                    <div><span style="color:#888;">${t('Encounters:')}</span> ${formatWithSeparator(attempts)}</div>
                    <div><span style="color:#888;">${t('Deaths:')}</span> <span style="color:${deaths > 0 ? '#f44336' : '#4caf50'};">${formatWithSeparator(deaths)}</span></div>
                    <div><span style="color:#888;">${t('Sim Time:')}</span> ${simHours.toFixed(1)}h</div>
                </div>
                <div style="color:#555; font-size:10px; margin-top:6px;">${t('Completed in')} ${totalElapsed}</div>
            </div>
        `;

        this._setStatus(t('Simulation complete — {0}% win rate at level {1}.', winRate, roomLevel));
    }

    /** @private */
    _displayFindMaxResults(maxResult, monsterHrid, simStartTime) {
        const container = this.panel?.querySelector('#mwi-labsim-results');
        if (!container) return;

        const totalElapsed = formatElapsed((Date.now() - simStartTime) / 1000);
        const monsterName = monsterHrid.split('/').pop().replace(/_/g, ' ');

        container.innerHTML = `
            <div style="margin-bottom:12px;">
                <div style="color:${ACCENT}; font-weight:700; font-size:13px; margin-bottom:6px;">
                    ${monsterName} \u2014 ${t('Find Max Result')}
                </div>
                <div style="font-size:24px; font-weight:700; color:#4caf50; margin-bottom:6px;">
                    ${t('Level')} ${maxResult.maxLevel}
                </div>
                <div style="font-size:12px; color:#888;">
                    ${t('Win Rate:')} <span style="color:#e0e0e0; font-weight:600;">${(maxResult.winRate * 100).toFixed(1)}%</span>
                    ${t('at level')} ${maxResult.maxLevel}
                </div>
                <div style="color:#555; font-size:10px; margin-top:6px;">${t('Completed in')} ${totalElapsed} (${maxResult.steps} ${t('steps')})</div>
            </div>
        `;

        this._setStatus(
            t('Max beatable level: {0} ({1}% win rate).', maxResult.maxLevel, (maxResult.winRate * 100).toFixed(1))
        );
    }

    /** @private */
    async _onUpgradeAnalyze() {
        const playerIndex = parseInt(this.panel.querySelector('#mwi-labsim-upgrade-player')?.value) || 0;
        const roomLevel = parseInt(this.panel.querySelector('#mwi-labsim-upgrade-level')?.value) || 100;
        const monsterHrid = this.panel.querySelector('#mwi-labsim-monster')?.value;
        const hours = Math.min(
            10000,
            Math.max(1, parseInt(this.panel.querySelector('#mwi-labsim-hours')?.value) || 10)
        );

        if (!monsterHrid) {
            this._setStatus(t('Select a monster in the Max Level tab first.'));
            return;
        }

        const crates = this.getSelectedCrates();

        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        let playerDTOs;
        const editedDTOs = this._editor?.getEditedDTOs();
        if (editedDTOs) {
            playerDTOs = Object.values(editedDTOs);
        } else {
            const result = await buildAllPlayerDTOs();
            playerDTOs = result.players;
        }

        if (!playerDTOs?.length || !playerDTOs[playerIndex]) {
            this._setStatus(t('No player data available.'));
            return;
        }

        const communityBuffs = getCommunityBuffs();
        const labyrinthCombatBuffs = labyrinthClearRate.getLabyrinthCombatBuffs();

        const progressEl = this.panel.querySelector('#mwi-labsim-upgrade-progress');
        const resultsEl = this.panel.querySelector('#mwi-labsim-upgrade-results');
        const runBtn = this.panel.querySelector('#mwi-labsim-upgrade-run');
        const stopBtn = this.panel.querySelector('#mwi-labsim-upgrade-stop');
        progressEl.style.display = 'block';
        resultsEl.innerHTML = '';
        runBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        this._upgradeAborted = false;

        try {
            const analysisResult = await runLabyrinthUpgradeAnalysis(
                {
                    playerDTOs,
                    playerIndex,
                    monsterHrid,
                    roomLevel,
                    crates,
                    hours,
                    communityBuffs,
                    labyrinthCombatBuffs,
                    upgradeMode: 'equipment',
                },
                ({ current, total, description }) => {
                    if (this._upgradeAborted) return;
                    const fill = this.panel.querySelector('#mwi-labsim-upgrade-progress-fill');
                    const text = this.panel.querySelector('#mwi-labsim-upgrade-progress-text');
                    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
                    if (text) text.textContent = `${current} / ${total}: ${description}`;
                },
                { abortSignal: () => this._upgradeAborted }
            );

            this._renderUpgradeResults(analysisResult, resultsEl);
        } catch (error) {
            if (error.message !== 'Cancelled' && error.message !== 'Aborted') {
                console.error('[LabSimUI] Upgrade analysis failed:', error);
                this._setStatus(t('Upgrade analysis failed:') + ' ' + error.message);
            }
        } finally {
            progressEl.style.display = 'none';
            runBtn.style.display = '';
            stopBtn.style.display = 'none';
        }
    }

    /** @private */
    _renderUpgradeResults(analysisResult, container) {
        const results = analysisResult?.results;
        if (!results || !results.length) {
            container.innerHTML = `<div style="color:#888; font-size:12px; padding:20px 0; text-align:center;">${t('No upgrade candidates found.')}</div>`;
            this._setStatus(t('No upgrade candidates found.'));
            return;
        }

        const tokenResults = results.filter((r) => r.costType === 'token');
        const goldResults = results.filter((r) => r.costType === 'gold');
        const thStyle =
            'text-align:right; padding:4px; color:#888; border-bottom:1px solid #333; cursor:pointer; user-select:none;';
        const thLeftStyle =
            'text-align:left; padding:4px; color:#888; border-bottom:1px solid #333; cursor:pointer; user-select:none;';
        const tdStyle = 'padding:3px 4px; text-align:right;';

        // Pre-compute row data for sorting
        const tokenRows = tokenResults.map((r) => {
            let rateVal, deltaVal, rateStr;

            if (r.metricType === 'clearRate') {
                rateVal = (r.clearRate || 0) * 100;
                deltaVal = (r.clearRateDelta || 0) * 100;
                rateStr = rateVal.toFixed(1) + '%';
            } else if (r.metricType === 'experience') {
                rateVal = 0;
                deltaVal = r.xpDeltaPct || 0;
                rateStr = 'XP';
            } else {
                rateVal = (r.winRate || 0) * 100;
                deltaVal = (r.winRateDelta || 0) * 100;
                rateStr = rateVal.toFixed(2) + '%';
            }

            const deltaColor = deltaVal > 0 ? '#4caf50' : deltaVal < 0 ? '#f44336' : '#888';
            const deltaStr = (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(2) + '%';

            const tokenCost = r.tokenCost || 0;
            const tokensPerPct = deltaVal > 0 ? Math.round(tokenCost / deltaVal) : Infinity;
            const tokensPerPctStr = deltaVal > 0 ? formatWithSeparator(tokensPerPct) : '\u2014';

            return {
                desc: r.candidate?.description || '',
                tokenCost,
                rateVal,
                rateStr,
                deltaVal,
                deltaStr,
                deltaColor,
                tokensPerPct,
                tokensPerPctStr,
            };
        });

        const goldRows = goldResults.map((r) => {
            const delta = (r.winRateDelta || 0) * 100;
            const deltaColor = delta > 0 ? '#4caf50' : delta < 0 ? '#f44336' : '#888';
            const cost = r.cost || 0;
            const winRate = (r.winRate || 0) * 100;
            const goldPerPct = delta > 0 && cost ? Math.round(cost / delta) : Infinity;

            return {
                desc: r.candidate?.description || '',
                cost,
                costStr: cost ? formatWithSeparator(cost) : '\u2014',
                winRate,
                winRateStr: winRate.toFixed(2) + '%',
                deltaVal: delta,
                deltaStr: (delta >= 0 ? '+' : '') + delta.toFixed(2) + '%',
                deltaColor,
                goldPerPct,
                goldPerPctStr: delta > 0 && cost ? formatWithSeparator(goldPerPct) : '\u2014',
            };
        });

        // Sort state
        const sortState = { token: { key: 'tokensPerPct', dir: 'asc' }, gold: { key: 'goldPerPct', dir: 'asc' } };

        const sortRows = (rows, key, dir) => {
            rows.sort((a, b) => {
                const av = a[key],
                    bv = b[key];
                if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                return dir === 'asc' ? av - bv : bv - av;
            });
        };

        const arrow = (dir) => (dir === 'asc' ? ' \u25B2' : ' \u25BC');

        const renderTokenTable = () => {
            const s = sortState.token;
            const th = (label, key, align) => {
                const style = align === 'left' ? thLeftStyle : thStyle;
                const ind = s.key === key ? arrow(s.dir) : '';
                return `<th data-sort-key="${key}" data-table="token" style="${style}">${label}${ind}</th>`;
            };

            let html = `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:4px;">${t('Token Upgrades')}</div>`;
            html += '<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:12px;">';
            html += `<thead><tr>
                ${th(t('Upgrade'), 'desc', 'left')}
                ${th(t('Tokens'), 'tokenCost', 'right')}
                ${th(t('Rate'), 'rateVal', 'right')}
                ${th(t('Delta'), 'deltaVal', 'right')}
                ${th(t('Tokens/1%'), 'tokensPerPct', 'right')}
            </tr></thead><tbody>`;

            for (const row of tokenRows) {
                html += `<tr style="border-bottom:1px solid #1a1a1a;">
                    <td style="padding:3px 4px; color:#e0e0e0;">${row.desc}</td>
                    <td style="${tdStyle} color:#ccc;">${row.tokenCost || '\u2014'}</td>
                    <td style="${tdStyle} color:#ccc;">${row.rateStr}</td>
                    <td style="${tdStyle} color:${row.deltaColor}; font-weight:600;">${row.deltaStr}</td>
                    <td style="${tdStyle} color:#888;">${row.tokensPerPctStr}</td>
                </tr>`;
            }
            html += '</tbody></table>';
            return html;
        };

        const renderGoldTable = () => {
            const s = sortState.gold;
            const th = (label, key, align) => {
                const style = align === 'left' ? thLeftStyle : thStyle;
                const ind = s.key === key ? arrow(s.dir) : '';
                return `<th data-sort-key="${key}" data-table="gold" style="${style}">${label}${ind}</th>`;
            };

            let html = `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:4px;">${t('Gold Upgrades')}</div>`;
            html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
            html += `<thead><tr>
                ${th(t('Upgrade'), 'desc', 'left')}
                ${th(t('Cost'), 'cost', 'right')}
                ${th(t('Win Rate'), 'winRate', 'right')}
                ${th(t('Delta'), 'deltaVal', 'right')}
                ${th(t('Gold/1%'), 'goldPerPct', 'right')}
            </tr></thead><tbody>`;

            for (const row of goldRows) {
                html += `<tr style="border-bottom:1px solid #1a1a1a;">
                    <td style="padding:3px 4px; color:#e0e0e0;">${row.desc}</td>
                    <td style="${tdStyle} color:#ccc;">${row.costStr}</td>
                    <td style="${tdStyle} color:#ccc;">${row.winRateStr}</td>
                    <td style="${tdStyle} color:${row.deltaColor}; font-weight:600;">${row.deltaStr}</td>
                    <td style="${tdStyle} color:#888;">${row.goldPerPctStr}</td>
                </tr>`;
            }
            html += '</tbody></table>';
            return html;
        };

        const renderAll = () => {
            sortRows(tokenRows, sortState.token.key, sortState.token.dir);
            sortRows(goldRows, sortState.gold.key, sortState.gold.dir);
            let html = '';
            if (tokenResults.length > 0) html += renderTokenTable();
            if (goldResults.length > 0) html += renderGoldTable();
            container.innerHTML = html;
        };

        renderAll();

        container.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort-key]');
            if (!th) return;
            const table = th.dataset.table;
            const key = th.dataset.sortKey;
            const state = sortState[table];
            if (state.key === key) {
                state.dir = state.dir === 'desc' ? 'asc' : 'desc';
            } else {
                state.key = key;
                state.dir = key === 'desc' ? 'asc' : 'desc';
            }
            renderAll();
        });

        this._setStatus(t('{0} upgrade candidates analyzed.', results.length));
    }

    /** @private */
    _getSkillingCrates() {
        const crates = [];
        const tea = this.panel?.querySelector('#mwi-labsim-skilling-tea')?.value;
        const coffee = this.panel?.querySelector('#mwi-labsim-skilling-coffee')?.value;
        const food = this.panel?.querySelector('#mwi-labsim-skilling-food')?.value;
        if (tea) crates.push(tea);
        if (coffee) crates.push(coffee);
        if (food) crates.push(food);
        return crates;
    }

    /** @private */
    async _renderSkillLoadoutTable() {
        const container = this.panel?.querySelector('#mwi-labsim-skilling-loadouts');
        if (!container) return;

        const allSnapshots = loadoutSnapshot.getAllSnapshots();
        const nonCombatSnapshots = allSnapshots.filter(
            (s) => s.actionTypeHrid && s.actionTypeHrid !== '/action_types/combat'
        );
        const allSkillsSnapshots = allSnapshots.filter((s) => !s.actionTypeHrid);

        const skills = [
            { hrid: '/skills/woodcutting', label: t('Woodcutting'), actionType: '/action_types/woodcutting' },
            { hrid: '/skills/foraging', label: t('Foraging'), actionType: '/action_types/foraging' },
            { hrid: '/skills/milking', label: t('Milking'), actionType: '/action_types/milking' },
            { hrid: '/skills/cooking', label: t('Cooking'), actionType: '/action_types/cooking' },
            { hrid: '/skills/brewing', label: t('Brewing'), actionType: '/action_types/brewing' },
            { hrid: '/skills/cheesesmithing', label: t('Cheesesmithing'), actionType: '/action_types/cheesesmithing' },
            { hrid: '/skills/crafting', label: t('Crafting'), actionType: '/action_types/crafting' },
            { hrid: '/skills/tailoring', label: t('Tailoring'), actionType: '/action_types/tailoring' },
            { hrid: '/skills/alchemy', label: t('Alchemy'), actionType: '/action_types/alchemy' },
            { hrid: '/skills/enhancing', label: t('Enhancing'), actionType: '/action_types/enhancing' },
        ];

        // Load persisted overrides once
        if (!this._skillLoadoutsLoaded) {
            this._skillLoadoutsLoaded = true;
            const persisted = await storage.get('labSimSkillingLoadouts', 'settings', null);
            if (persisted && typeof persisted === 'object') {
                this._skillLoadouts = persisted;
            }
        }

        // Auto-populate from game's lab automation settings for any skill not already set
        if (Object.keys(this._skillLoadouts).length < skills.length) {
            const charSetting = dataManager.characterData?.characterSetting;
            const snapshots = loadoutSnapshot.snapshots || {};
            for (const skill of skills) {
                if (this._skillLoadouts[skill.hrid]) continue;
                const skillId = skill.hrid.replace('/skills/', '');
                const pascal = skillId.charAt(0).toUpperCase() + skillId.slice(1);
                const loadoutId = charSetting?.[`labyrinthLoadout${pascal}`];
                if (loadoutId && snapshots[loadoutId]?.name) {
                    this._skillLoadouts[skill.hrid] = snapshots[loadoutId].name;
                } else {
                    const match = nonCombatSnapshots.find((s) => s.actionTypeHrid === skill.actionType);
                    if (match) {
                        this._skillLoadouts[skill.hrid] = match.name;
                    } else if (allSkillsSnapshots.length > 0) {
                        this._skillLoadouts[skill.hrid] = allSkillsSnapshots[0].name;
                    }
                }
            }
        }

        const selectStyle =
            'background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:3px; padding:1px 4px; font-size:11px; width:100%;';

        const targetSkill = this.panel.querySelector('#mwi-labsim-skilling-filter')?.value || '';
        const visibleSkills = targetSkill ? skills.filter((s) => s.hrid === targetSkill) : skills;
        const collapsed = this._loadoutsCollapsed || false;

        const arrow = collapsed ? '&#9654;' : '&#9660;';
        let html = `<div id="mwi-labsim-loadout-toggle" style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:4px; cursor:pointer; user-select:none;">
            <span style="display:inline-block; width:14px; font-size:10px;">${arrow}</span> ${t('Skill Loadouts')}
        </div>`;
        html += `<div id="mwi-labsim-loadout-grid" style="display:${collapsed ? 'none' : 'grid'}; grid-template-columns:1fr 1fr; gap:3px 10px;">`;

        for (const skill of visibleSkills) {
            const current = this._skillLoadouts[skill.hrid] || '';
            html += `<div style="display:flex; align-items:center; gap:4px; font-size:11px;">`;
            html += `<span style="color:#888; width:85px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${skill.label}">${skill.label}</span>`;
            html += `<select data-skill-loadout="${skill.hrid}" style="${selectStyle}">`;
            html += `<option value=""${!current ? ' selected' : ''}>${t('Current Gear')}</option>`;
            for (const snap of [...nonCombatSnapshots, ...allSkillsSnapshots]) {
                const label = snap.name + (snap.actionTypeHrid ? '' : ` ${t('(All)')}`);
                const selected = current === snap.name ? ' selected' : '';
                html += `<option value="${snap.name}"${selected}>${label}</option>`;
            }
            html += '</select></div>';
        }

        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('[data-skill-loadout]').forEach((select) => {
            select.addEventListener('change', () => {
                const skillHrid = select.dataset.skillLoadout;
                this._skillLoadouts[skillHrid] = select.value;
                storage.set('labSimSkillingLoadouts', this._skillLoadouts, 'settings');
            });
        });

        container.querySelector('#mwi-labsim-loadout-toggle')?.addEventListener('click', () => {
            this._loadoutsCollapsed = !this._loadoutsCollapsed;
            this._renderSkillLoadoutTable();
        });
    }

    /**
     * Build per-skill equipment map from loadout assignments.
     * @param {Object} gameData
     * @returns {Object} { '/skills/woodcutting': { '/equipment_types/...': { hrid, enhancementLevel } }, ... }
     */
    _buildSkillEquipmentMap(gameData) {
        const itemDetailMap = gameData?.itemDetailMap || {};
        const liveEquipment = dataManager.characterEquipment;
        const allSnapshots = loadoutSnapshot.getAllSnapshots();
        const equipmentMap = {};

        for (const [skillHrid, loadoutName] of Object.entries(this._skillLoadouts)) {
            if (!loadoutName) continue;
            const snapshot = allSnapshots.find((s) => s.name === loadoutName);
            if (!snapshot?.equipment?.length) continue;

            const equipment = {};
            for (const equip of snapshot.equipment) {
                const itemDetail = itemDetailMap[equip.itemHrid];
                const equipType = itemDetail?.equipmentDetail?.type;
                if (!equipType) continue;
                let enhancementLevel = equip.enhancementLevel || 0;
                if (enhancementLevel === 0 && liveEquipment) {
                    for (const [, liveItem] of liveEquipment) {
                        if (liveItem.itemHrid === equip.itemHrid) {
                            enhancementLevel = liveItem.enhancementLevel || 0;
                            break;
                        }
                    }
                }
                equipment[equipType] = { hrid: equip.itemHrid, enhancementLevel };
            }
            equipmentMap[skillHrid] = equipment;
        }

        return equipmentMap;
    }

    /** @private */
    _onSkillingCalculate() {
        const roomLevel = parseInt(this.panel.querySelector('#mwi-labsim-skilling-level')?.value) || 100;
        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        const editedDTOs = this._skillingEditor?.getEditedDTOs();
        if (!editedDTOs) {
            this._setStatus(t('No character data. Wait for editor to load.'));
            return;
        }

        const selfHrid = this._skillingEditor.getSelfHrid();
        const dto = editedDTOs[selfHrid] || Object.values(editedDTOs)[0];
        if (!dto) {
            this._setStatus(t('No player data available.'));
            return;
        }

        const crateHrids = this._getSkillingCrates();
        const skillEquipmentMap = this._buildSkillEquipmentMap(gameData);
        const results = computeSkillingClearRatesFromEditor(roomLevel, dto, crateHrids, gameData, skillEquipmentMap);
        this._renderSkillingClearResults(results, roomLevel);
    }

    /** @private */
    _renderSkillingClearResults(results, roomLevel) {
        const container = this.panel?.querySelector('#mwi-labsim-skilling-results');
        if (!container) return;

        const avgClearRate = results.reduce((s, r) => s + (r.clearChance || 0), 0) / results.length;

        const thStyle = 'text-align:right; padding:4px; color:#888; border-bottom:1px solid #333; font-size:10px;';
        const thLeftStyle = 'text-align:left; padding:4px; color:#888; border-bottom:1px solid #333; font-size:10px;';
        const tdStyle = 'padding:3px 4px; text-align:right; font-size:11px;';

        let html = `<div style="color:${ACCENT}; font-weight:700; font-size:13px; margin-bottom:6px;">
            ${t('Skilling Room Level')} ${roomLevel}
            <span style="color:#888; font-weight:400; font-size:11px; margin-left:8px;">
                ${t('Avg Clear:')} <span style="color:${avgClearRate >= 0.95 ? '#4caf50' : avgClearRate >= 0.5 ? '#ff9800' : '#f44336'}; font-weight:600;">${(avgClearRate * 100).toFixed(1)}%</span>
            </span>
        </div>`;

        html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
        html += `<thead><tr>
            <th style="${thLeftStyle}">${t('Skill')}</th>
            <th style="${thStyle}">${t('Level')}</th>
            <th style="${thStyle}">${t('Eff. Lvl')}</th>
            <th style="${thStyle}">${t('Success')}</th>
            <th style="${thStyle}">${t('Clear')}</th>
            <th style="${thStyle}">${t('Actions')}</th>
        </tr></thead><tbody>`;

        for (const r of results) {
            const clearColor = r.clearChance >= 0.95 ? '#4caf50' : r.clearChance >= 0.5 ? '#ff9800' : '#f44336';
            const successPct = ((r.successChance || 0) * 100).toFixed(1);
            const clearPct = ((r.clearChance || 0) * 100).toFixed(1);

            html += `<tr style="border-bottom:1px solid #1a1a1a;">
                <td style="padding:3px 4px; color:#e0e0e0;">${r.skillName}</td>
                <td style="${tdStyle} color:#ccc;">${r.baseLevel}</td>
                <td style="${tdStyle} color:#ccc;">${r.effectiveLevel}</td>
                <td style="${tdStyle} color:#ccc;">${successPct}%</td>
                <td style="${tdStyle} color:${clearColor}; font-weight:600;">${clearPct}%</td>
                <td style="${tdStyle} color:#888;">${r.attempts || 0}</td>
            </tr>`;
        }

        html += '</tbody></table>';
        container.innerHTML = html;
        this._setStatus(t('Skilling clear rates calculated for level {0}.', roomLevel));
    }

    /** @private */
    async _onSkillingUpgradeAnalyze() {
        const roomLevel = parseInt(this.panel.querySelector('#mwi-labsim-skilling-level')?.value) || 100;
        const gameData = buildGameDataPayload();
        if (!gameData) {
            this._setStatus(t('No game data available.'));
            return;
        }

        const editedDTOs = this._skillingEditor?.getEditedDTOs();
        if (!editedDTOs) {
            this._setStatus(t('No character data. Wait for editor to load.'));
            return;
        }

        const selfHrid = this._skillingEditor.getSelfHrid();
        const dto = editedDTOs[selfHrid] || Object.values(editedDTOs)[0];
        if (!dto) {
            this._setStatus(t('No player data available.'));
            return;
        }

        const crateHrids = this._getSkillingCrates();
        const skillEquipmentMap = this._buildSkillEquipmentMap(gameData);
        const targetSkill = this.panel.querySelector('#mwi-labsim-skilling-filter')?.value || null;

        const progressEl = this.panel.querySelector('#mwi-labsim-skilling-progress');
        const resultsEl = this.panel.querySelector('#mwi-labsim-skilling-results');
        const calcBtn = this.panel.querySelector('#mwi-labsim-skilling-calc');
        const upgradeBtn = this.panel.querySelector('#mwi-labsim-skilling-upgrade');
        const stopBtn = this.panel.querySelector('#mwi-labsim-skilling-stop');
        progressEl.style.display = 'block';
        resultsEl.innerHTML = '';
        calcBtn.style.display = 'none';
        upgradeBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        this._skillingAborted = false;

        try {
            const analysisResult = runSkillingUpgradeAnalysis(
                { editorDTO: dto, roomLevel, crateHrids, skillEquipmentMap, targetSkill },
                ({ current, total, description }) => {
                    if (this._skillingAborted) return;
                    const fill = this.panel.querySelector('#mwi-labsim-skilling-progress-fill');
                    const text = this.panel.querySelector('#mwi-labsim-skilling-progress-text');
                    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
                    if (text) text.textContent = `${current} / ${total}: ${description}`;
                },
                { abortSignal: () => this._skillingAborted }
            );

            this._renderSkillingUpgradeResults(analysisResult, resultsEl);
        } catch (error) {
            console.error('[LabSimUI] Skilling upgrade analysis failed:', error);
            this._setStatus(t('Skilling upgrade analysis failed:') + ' ' + error.message);
        } finally {
            progressEl.style.display = 'none';
            calcBtn.style.display = '';
            upgradeBtn.style.display = '';
            stopBtn.style.display = 'none';
        }
    }

    /** @private */
    _renderSkillingUpgradeResults(analysisResult, container) {
        const results = analysisResult?.results;
        if (!results || !results.length) {
            container.innerHTML = `<div style="color:#888; font-size:12px; padding:20px 0; text-align:center;">${t('No upgrade candidates found.')}</div>`;
            this._setStatus(t('No skilling upgrade candidates found.'));
            return;
        }

        const baseline = analysisResult.baseline;
        const tokenResults = results.filter((r) => r.costType === 'token');
        const goldResults = results.filter((r) => r.costType === 'gold');
        const thStyle =
            'text-align:right; padding:4px; color:#888; border-bottom:1px solid #333; cursor:pointer; user-select:none;';
        const thLeftStyle =
            'text-align:left; padding:4px; color:#888; border-bottom:1px solid #333; cursor:pointer; user-select:none;';
        const tdStyle = 'padding:3px 4px; text-align:right;';

        const tokenRows = tokenResults.map((r) => {
            const clearRate = (r.clearRate || 0) * 100;
            const deltaVal = (r.clearRateDelta || 0) * 100;
            const deltaColor = deltaVal > 0 ? '#4caf50' : deltaVal < 0 ? '#f44336' : '#888';
            const tokenCost = r.tokenCost || 0;
            const tokensPerPct = deltaVal > 0 ? Math.round(tokenCost / deltaVal) : Infinity;

            return {
                desc: r.candidate?.description || '',
                tokenCost,
                clearRate,
                clearRateStr: clearRate.toFixed(1) + '%',
                deltaVal,
                deltaStr: (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(2) + '%',
                deltaColor,
                tokensPerPct,
                tokensPerPctStr: deltaVal > 0 ? formatWithSeparator(tokensPerPct) : '\u2014',
            };
        });

        const goldRows = goldResults.map((r) => {
            const clearRate = (r.clearRate || 0) * 100;
            const deltaVal = (r.clearRateDelta || 0) * 100;
            const deltaColor = deltaVal > 0 ? '#4caf50' : deltaVal < 0 ? '#f44336' : '#888';
            const cost = r.cost || 0;
            const goldPerPct = deltaVal > 0 && cost ? Math.round(cost / deltaVal) : Infinity;

            return {
                desc: r.candidate?.description || '',
                cost,
                costStr: cost ? formatWithSeparator(cost) : '\u2014',
                clearRate,
                clearRateStr: clearRate.toFixed(1) + '%',
                deltaVal,
                deltaStr: (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(2) + '%',
                deltaColor,
                goldPerPct,
                goldPerPctStr: deltaVal > 0 && cost ? formatWithSeparator(goldPerPct) : '\u2014',
            };
        });

        const sortState = { token: { key: 'tokensPerPct', dir: 'asc' }, gold: { key: 'goldPerPct', dir: 'asc' } };

        const sortRows = (rows, key, dir) => {
            rows.sort((a, b) => {
                const av = a[key],
                    bv = b[key];
                if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                return dir === 'asc' ? av - bv : bv - av;
            });
        };

        const arrow = (dir) => (dir === 'asc' ? ' \u25B2' : ' \u25BC');

        const renderTokenTable = () => {
            const s = sortState.token;
            const th = (label, key, align) => {
                const style = align === 'left' ? thLeftStyle : thStyle;
                const ind = s.key === key ? arrow(s.dir) : '';
                return `<th data-sort-key="${key}" data-table="token" style="${style}">${label}${ind}</th>`;
            };

            let html = `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:4px;">${t('Token Upgrades')}</div>`;
            html += '<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:12px;">';
            html += `<thead><tr>
                ${th(t('Upgrade'), 'desc', 'left')}
                ${th(t('Tokens'), 'tokenCost', 'right')}
                ${th(t('Clear Rate'), 'clearRate', 'right')}
                ${th(t('Delta'), 'deltaVal', 'right')}
                ${th(t('Tokens/1%'), 'tokensPerPct', 'right')}
            </tr></thead><tbody>`;

            for (const row of tokenRows) {
                html += `<tr style="border-bottom:1px solid #1a1a1a;">
                    <td style="padding:3px 4px; color:#e0e0e0;">${row.desc}</td>
                    <td style="${tdStyle} color:#ccc;">${row.tokenCost || '\u2014'}</td>
                    <td style="${tdStyle} color:#ccc;">${row.clearRateStr}</td>
                    <td style="${tdStyle} color:${row.deltaColor}; font-weight:600;">${row.deltaStr}</td>
                    <td style="${tdStyle} color:#888;">${row.tokensPerPctStr}</td>
                </tr>`;
            }
            html += '</tbody></table>';
            return html;
        };

        const renderGoldTable = () => {
            const s = sortState.gold;
            const th = (label, key, align) => {
                const style = align === 'left' ? thLeftStyle : thStyle;
                const ind = s.key === key ? arrow(s.dir) : '';
                return `<th data-sort-key="${key}" data-table="gold" style="${style}">${label}${ind}</th>`;
            };

            let html = `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:4px;">${t('Equipment Upgrades')}</div>`;
            html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
            html += `<thead><tr>
                ${th(t('Upgrade'), 'desc', 'left')}
                ${th(t('Cost'), 'cost', 'right')}
                ${th(t('Clear Rate'), 'clearRate', 'right')}
                ${th(t('Delta'), 'deltaVal', 'right')}
                ${th(t('Gold/1%'), 'goldPerPct', 'right')}
            </tr></thead><tbody>`;

            for (const row of goldRows) {
                html += `<tr style="border-bottom:1px solid #1a1a1a;">
                    <td style="padding:3px 4px; color:#e0e0e0;">${row.desc}</td>
                    <td style="${tdStyle} color:#ccc;">${row.costStr}</td>
                    <td style="${tdStyle} color:#ccc;">${row.clearRateStr}</td>
                    <td style="${tdStyle} color:${row.deltaColor}; font-weight:600;">${row.deltaStr}</td>
                    <td style="${tdStyle} color:#888;">${row.goldPerPctStr}</td>
                </tr>`;
            }
            html += '</tbody></table>';
            return html;
        };

        const renderAll = () => {
            sortRows(tokenRows, sortState.token.key, sortState.token.dir);
            sortRows(goldRows, sortState.gold.key, sortState.gold.dir);
            let html = `<div style="color:#888; font-size:11px; margin-bottom:8px;">
                ${t('Baseline Avg Clear:')} <span style="color:#e0e0e0; font-weight:600;">${((baseline?.clearRate || 0) * 100).toFixed(1)}%</span>
            </div>`;
            if (tokenRows.length > 0) html += renderTokenTable();
            if (goldRows.length > 0) html += renderGoldTable();
            container.innerHTML = html;
        };

        renderAll();

        container.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort-key]');
            if (!th) return;
            const table = th.dataset.table;
            const key = th.dataset.sortKey;
            const state = sortState[table];
            if (state.key === key) {
                state.dir = state.dir === 'desc' ? 'asc' : 'desc';
            } else {
                state.key = key;
                state.dir = key === 'desc' ? 'asc' : 'desc';
            }
            renderAll();
        });

        this._setStatus(t('{0} skilling upgrade candidates analyzed.', results.length));
    }

    toggle() {
        if (!this.panel) return;
        const visible = this.panel.style.display !== 'none';
        this.panel.style.display = visible ? 'none' : 'flex';
        if (!visible) {
            bringPanelToFront(this.panel);
            this._populateMonsters();
            if (!this._editor.isInitialized()) {
                this._editor.initEditor();
            }
        }
    }

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
        if (this._editor) this._editor.reset();
        if (this._skillingEditor) this._skillingEditor.reset();
        this._maxLevel = null;
        this._labyResults = null;
    }

    /** @private */
    _setupDrag(handle) {
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            this.isDragging = true;
            handle.style.cursor = 'grabbing';
            const rect = this.panel.getBoundingClientRect();
            this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };

            const onMove = (e2) => {
                if (!this.isDragging) return;
                this.panel.style.left = `${e2.clientX - this.dragOffset.x}px`;
                this.panel.style.top = `${e2.clientY - this.dragOffset.y}px`;
                this.panel.style.right = 'auto';
            };

            const onUp = () => {
                this.isDragging = false;
                handle.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /** @private */
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
}

const labSimUI = new LabSimUI();
export default labSimUI;
