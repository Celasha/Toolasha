/**
 * Skilling Simulator UI
 * Injects a "Skilling Sim" tab next to Loadouts in the character panel, with a Simulator mode
 * and an Upgrade mode. Lets the user configure equipment + teas (optionally loading from a saved
 * loadout), pick which actions to include, and simulate XP/hr + Gold/hr.
 */

import config from '../../core/config.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import {
    calculateSkillPerformance,
    getSkillActionsForDisplay,
    getItemsForSlot,
    getAlchemyItemOptions,
    getSkillDrinkItems,
    getPlayerSkillLevel,
    optimizeSkill,
    findOptimalTeas,
    buildAchievableEquipment,
    SKILL_NAMES,
    SKILLING_LOCATIONS,
    SLOT_DISPLAY_NAMES,
    SKILL_TOOL_LOCATION,
} from './skilling-optimizer-engine.js';
import { SKILL_TO_ACTION_TYPE } from '../../utils/tea-optimizer.js';
import { formatKMB, timeReadableCompact } from '../../utils/formatters.js';
import { buildOwnedEnhancementLevelMap } from '../../utils/owned-enhancement-map.js';
import loadoutState from '../../core/loadout-state.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';

const TAB_CLASS = 'toolasha-skilling-opt-tab';
const PANEL_CLASS = 'toolasha-skilling-opt-panel';
const INNER_CONTENT_CLASS = 'toolasha-skilling-opt-inner';

// Equipment Progression sort control. 'value' picks whichever ratio matches the
// skill's own optimization goal (XP/hr per gold for XP-goal skills, payback time for Gold-goal
// gathering skills), so the default view always leads with the metric the panel is already
// optimizing for.
const SORT_MODES = [
    { value: 'value', label: 'Best Value' },
    { value: 'payback', label: 'Payback (fastest)' },
    { value: 'cost', label: 'Cost (cheapest)' },
    { value: 'xpGain', label: 'XP Gain %' },
    { value: 'goldGain', label: 'Gold Gain %' },
    { value: 'slot', label: 'Slot Order' },
];

class SkillingSimulatorUI {
    constructor() {
        this.tabBtn = null;
        this.panel = null; // Floating chrome (fixed, draggable) - built once, reused
        this._contentEl = null; // Scrollable body inside the floating chrome
        this._innerPanel = null; // Rebuilt on every mode/skill/result change
        this.isActive = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.watcher = null;

        // Mode
        this.currentMode = 'simulator'; // 'simulator' | 'optimizer'
        this.lastOptimizerResult = null;
        this.optimizerLoadout = null;
        this.optimizerSortMode = 'value';

        // Alchemy-only: manual override for which item/action-type the Optimizer's Equipment
        // Progression + Optimal Teas score Gold/XP against, when the player doesn't have (or
        // doesn't want to rely on) a live queued Alchemy action to auto-detect. Session-only,
        // like the other Optimizer-mode fields above.
        this.alchemyItemOverride = null;

        // Simulator state
        this.currentSkill = 'Woodcutting';
        this.currentLevel = 1;
        this.equipment = new Map(); // locationHrid → { itemHrid, enhancementLevel }
        this.teas = [null, null, null];
        this.selectedActionHrids = null; // null = all available
        this._simulatorLoadoutName = null;
        this._simulatorLoadoutUnavailableName = null;

        // Tracks whether the canonical per-Skill loadout has been auto-applied for the current
        // skill selection yet. Auto-retargeting only fires on an actual Skill change (or once on
        // first panel build) - never on an unrelated panel rebuild - so manual edits survive
        // mode switches and other re-renders.
        this._retargetedForSkill = null;

        // UI element refs (updated in place without rebuilding panel)
        this._slotBtns = new Map(); // locationHrid → { nameBtn, enhInput, clearBtn }
        this._teaBtns = []; // [{ nameBtn, clearBtn }, ...]
        this._actionBtn = null;
        this._actionBtnGetLabel = null;
        this._resultsArea = null;
        this._picker = null;
        this._pickerCleanup = null;
    }

    initialize() {
        this.currentLevel = getPlayerSkillLevel(this.currentSkill);
        this.watcher = createMutationWatcher(document.body, () => this._tryInjectTabButton(), {
            childList: true,
            subtree: true,
        });
        this._tryInjectTabButton();
    }

    // -------------------------------------------------------------------------
    // Tab injection
    // -------------------------------------------------------------------------

    _findTabList() {
        for (const tl of document.querySelectorAll('[role="tablist"]')) {
            for (const tab of tl.querySelectorAll('[role="tab"]')) {
                if (tab.textContent.trim().startsWith('Loadouts')) return tl;
            }
        }
        return null;
    }

    _tryInjectTabButton() {
        const tabList = this._findTabList();
        if (!tabList) return;
        if (tabList.querySelector(`.${TAB_CLASS}`)) return;

        const existingTab = tabList.querySelector('[role="tab"]');
        const btn = document.createElement('button');
        btn.className = `${TAB_CLASS} ${existingTab ? existingTab.className.replace(/Mui-selected/g, '').trim() : ''}`;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('type', 'button');
        btn.textContent = 'Skilling Sim';
        btn.style.minWidth = 'auto';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleFloatingPanel();
        });

        const loadoutsTab = [...tabList.querySelectorAll('[role="tab"]')].find((t) =>
            t.textContent.trim().startsWith('Loadouts')
        );
        if (loadoutsTab?.nextSibling) tabList.insertBefore(btn, loadoutsTab.nextSibling);
        else tabList.appendChild(btn);
        this.tabBtn = btn;

        const scroller = tabList.parentElement;
        if (scroller?.className?.includes('MuiTabs-scroller')) scroller.style.overflow = 'auto';

        this._reflectActiveState();
    }

    // -------------------------------------------------------------------------
    // Floating panel lifecycle
    // -------------------------------------------------------------------------

    /**
     * Reflects `isActive` onto the injected tab button's selected styling. Kept separate from
     * opening/closing the panel itself since the game's own React re-renders can tear down and
     * re-inject the tab button while the floating panel stays open the whole time - unlike the
     * previous docked-in-the-sidebar-tab behavior, the panel no longer shares a lifecycle with
     * any native tab-content element.
     */
    _reflectActiveState() {
        if (!this.tabBtn) return;
        if (this.isActive) {
            this.tabBtn.classList.add('Mui-selected');
            this.tabBtn.setAttribute('aria-selected', 'true');
        } else {
            this.tabBtn.classList.remove('Mui-selected');
            this.tabBtn.setAttribute('aria-selected', 'false');
        }
    }

    /**
     * Builds the floating chrome (fixed position, draggable header, resize handle, close button)
     * exactly once - mirrors Combat Sim's floating panel (combat-sim-ui.js) so Skilling Sim gets
     * the same draggable/resizable/z-ordered window instead of being docked inline into the
     * narrow character-panel sidebar tab area. `_buildPanel()`'s existing content div is rebuilt
     * on demand and mounted into `_contentEl` below, unchanged from before.
     */
    _ensureFloatingPanel() {
        if (this.panel) return;

        this.panel = document.createElement('div');
        this.panel.className = PANEL_CLASS;
        this.panel.style.cssText = `
            position: fixed; top: 60px; right: 60px;
            z-index: ${config.Z_FLOATING_PANEL};
            background: rgba(10, 10, 20, 0.97);
            border: 2px solid ${config.COLOR_ACCENT}80;
            border-radius: 10px;
            width: 560px; height: 640px;
            min-width: 380px; min-height: 320px;
            max-width: 90vw; max-height: 90vh;
            display: none; flex-direction: column;
            color: rgba(255,255,255,0.85); font-size: 13px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 10px 14px; cursor: grab;
            background: ${config.COLOR_ACCENT}22;
            border-bottom: 1px solid ${config.COLOR_ACCENT}80;
            border-radius: 8px 8px 0 0; flex-shrink: 0;
        `;
        const title = document.createElement('span');
        title.textContent = 'Skilling Sim';
        title.style.cssText = `font-weight: 700; font-size: 14px; color: ${config.COLOR_ACCENT};`;
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.style.cssText =
            'background:none; border:none; color:#aaa; font-size:22px; cursor:pointer; padding:0; line-height:1;';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._deactivatePanel();
        });
        header.appendChild(title);
        header.appendChild(closeBtn);
        this._setupDrag(header, closeBtn);
        this.panel.appendChild(header);

        const contentEl = document.createElement('div');
        contentEl.style.cssText = 'display: flex; flex-direction: column; flex: 1; min-height: 0;';
        this.panel.appendChild(contentEl);
        this._contentEl = contentEl;

        const resizeHandle = document.createElement('div');
        resizeHandle.style.cssText = `
            position: absolute; bottom: 0; right: 0; width: 16px; height: 16px;
            cursor: nwse-resize; z-index: 1;
            background: linear-gradient(135deg, transparent 50%, ${config.COLOR_ACCENT}66 50%);
            border-radius: 0 0 8px 0;
        `;
        this.panel.appendChild(resizeHandle);
        this._setupResize(resizeHandle);

        document.body.appendChild(this.panel);
        registerFloatingPanel(this.panel);
        this.panel.addEventListener('mousedown', () => bringPanelToFront(this.panel));
    }

    /**
     * @param {HTMLElement} header
     * @param {HTMLElement} closeBtn - Excluded from drag so clicking it doesn't also move the panel
     */
    _setupDrag(header, closeBtn) {
        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn) return;
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
                const newWidth = Math.max(380, startWidth + (ev.clientX - startX));
                const newHeight = Math.max(320, startHeight + (ev.clientY - startY));
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

    _toggleFloatingPanel() {
        this._ensureFloatingPanel();
        if (this.isActive) this._deactivatePanel();
        else this._activatePanel();
    }

    _activatePanel() {
        this._ensureFloatingPanel();
        this.isActive = true;
        this._reflectActiveState();
        this.panel.style.display = 'flex';
        bringPanelToFront(this.panel);
        this._rebuildPanel();
    }

    _rebuildPanel() {
        if (!this._contentEl) return;
        this._closePicker();
        this._innerPanel?.remove();
        this._innerPanel = this._buildPanel();
        this._contentEl.appendChild(this._innerPanel);
    }

    _deactivatePanel() {
        this.isActive = false;
        this._closePicker();
        this._reflectActiveState();
        if (this.panel) this.panel.style.display = 'none';
    }

    // -------------------------------------------------------------------------
    // Panel construction
    // -------------------------------------------------------------------------

    _buildPanel() {
        this._ensureRetargetedForCurrentSkill();
        this._slotBtns.clear();
        this._teaBtns = [];

        const panel = document.createElement('div');
        panel.className = INNER_CONTENT_CLASS;
        panel.style.cssText = `
            padding: 12px;
            color: rgba(255,255,255,0.85);
            font-size: 13px;
            overflow-y: auto;
            flex: 1;
            min-height: 0;
            box-sizing: border-box;
        `;

        panel.addEventListener('click', (e) => {
            if (this._picker && !this._picker.contains(e.target)) this._closePicker();
        });

        // Mode selector
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display: flex; gap: 6px; margin-bottom: 14px;';

        for (const [mode, label] of [
            ['simulator', 'Simulator'],
            ['optimizer', 'Upgrade'],
        ]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            const active = this.currentMode === mode;
            btn.style.cssText = `
                padding: 4px 14px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;
                border: 1px solid ${active ? config.COLOR_ACCENT : 'rgba(255,255,255,0.2)'};
                background: ${active ? config.COLOR_ACCENT + '22' : 'transparent'};
                color: ${active ? config.COLOR_ACCENT : 'rgba(255,255,255,0.5)'};
            `;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.currentMode !== mode) {
                    this.currentMode = mode;
                    this._rebuildPanel();
                }
            });
            modeRow.appendChild(btn);
        }
        panel.appendChild(modeRow);

        panel.appendChild(this._buildTopControls());

        if (this.currentMode === 'simulator') {
            panel.appendChild(this._buildEquipmentSection());
            panel.appendChild(this._buildTeasSection());

            const simulateBtn = document.createElement('button');
            simulateBtn.type = 'button';
            simulateBtn.textContent = 'Simulate';
            simulateBtn.style.cssText = `
                margin-top: 12px; padding: 6px 20px;
                background: ${config.COLOR_ACCENT}; color: #000;
                border: none; border-radius: 4px;
                font-size: 12px; font-weight: 700; cursor: pointer;
            `;
            simulateBtn.addEventListener('click', () => {
                simulateBtn.textContent = 'Simulating…';
                simulateBtn.disabled = true;
                requestAnimationFrame(() =>
                    setTimeout(() => {
                        this._runSimulation();
                        simulateBtn.textContent = 'Simulate';
                        simulateBtn.disabled = false;
                    }, 0)
                );
            });
            panel.appendChild(simulateBtn);

            const resultsArea = document.createElement('div');
            resultsArea.style.marginTop = '16px';
            panel.appendChild(resultsArea);
            this._resultsArea = resultsArea;
        } else {
            // Loadout comparison selector
            const compareRow = document.createElement('div');
            compareRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
            const compareLabel = document.createElement('span');
            compareLabel.textContent = 'Compare:';
            compareLabel.style.cssText = 'color: rgba(255,255,255,0.5); font-size: 12px; width: 56px; flex-shrink: 0;';
            const compareSelect = document.createElement('select');
            compareSelect.style.cssText =
                'background: #2a2a2a; color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; font-size: 12px; flex: 1; cursor: pointer;';
            const noneOpt = document.createElement('option');
            noneOpt.value = '';
            noneOpt.textContent = '— None —';
            compareSelect.appendChild(noneOpt);

            const resolvedComparison = this.optimizerLoadout
                ? loadoutState.resolveSnapshot(this.optimizerLoadout)
                : null;
            if (resolvedComparison) this.optimizerLoadout = resolvedComparison;
            const currentComparisonName = resolvedComparison?.name || this.optimizerLoadout?.name || '';
            const usableComparisons = loadoutState
                .getAllSnapshots()
                .filter((candidate) => candidate.isUsableForCalculation);
            const usableComparisonNames = new Set(usableComparisons.map((snapshot) => snapshot.name));
            if (currentComparisonName && !usableComparisonNames.has(currentComparisonName)) {
                const unavailableOpt = document.createElement('option');
                unavailableOpt.value = currentComparisonName;
                unavailableOpt.textContent = `${currentComparisonName} (Unavailable)`;
                unavailableOpt.selected = true;
                unavailableOpt.disabled = true;
                compareSelect.appendChild(unavailableOpt);
            }
            for (const snap of usableComparisons) {
                const opt = document.createElement('option');
                opt.value = snap.name;
                opt.textContent = snap.name + (snap.isDefault ? ' ★' : '');
                if (currentComparisonName === snap.name) opt.selected = true;
                compareSelect.appendChild(opt);
            }
            compareSelect.addEventListener('change', () => {
                const name = compareSelect.value;
                this.optimizerLoadout = name ? loadoutState.getUsableSnapshotByName(name) : null;
            });
            compareRow.appendChild(compareLabel);
            compareRow.appendChild(compareSelect);
            panel.appendChild(compareRow);

            // Alchemy Gold/XP are priced against one real item (Coinify/Decompose/Transmute
            // economics are entirely item-specific), so this Optimizer needs to know which one -
            // it can't average across "all Alchemy actions" the way every other skill does (game
            // data only defines 3 generic action templates for Alchemy, with no item baked in).
            // Default to whatever the player's live queue is running (see
            // resolveActiveAlchemyItemContext); this picker lets them override it to plan ahead.
            if (this.currentSkill === 'Alchemy') {
                panel.appendChild(this._buildAlchemyItemOverrideRow());
            }

            const optimizeBtn = document.createElement('button');
            optimizeBtn.type = 'button';
            optimizeBtn.textContent = 'Optimize';
            optimizeBtn.style.cssText = `
                padding: 6px 20px;
                background: ${config.COLOR_ACCENT}; color: #000;
                border: none; border-radius: 4px;
                font-size: 12px; font-weight: 700; cursor: pointer;
            `;

            const resultsArea = document.createElement('div');
            resultsArea.style.marginTop = '16px';

            optimizeBtn.addEventListener('click', () => {
                optimizeBtn.textContent = 'Optimizing…';
                optimizeBtn.disabled = true;
                requestAnimationFrame(() =>
                    setTimeout(() => {
                        // Build loadout item map for comparison. Keep an intentionally empty
                        // loadout distinct from "no comparison", and never silently replace an
                        // unavailable manual comparison with an empty/current-gear baseline.
                        // Resolved before optimizeSkill() so BASELINE and every slot's CANDIDATE
                        // score the exact same full loadout + drinks + selected actions.
                        const loadoutItemMap = new Map();
                        let compareDrinks = [];
                        let hasUsableComparison = false;
                        let unavailableComparisonName = null;
                        if (this.optimizerLoadout) {
                            const refreshedLoadout = loadoutState.resolveSnapshot(this.optimizerLoadout);
                            if (refreshedLoadout?.isUsableForCalculation) {
                                this.optimizerLoadout = refreshedLoadout;
                                hasUsableComparison = true;
                                for (const eq of refreshedLoadout.equipment || []) {
                                    if (!eq.itemHrid || !eq.itemLocationHrid || !Number.isFinite(eq.enhancementLevel)) {
                                        hasUsableComparison = false;
                                        unavailableComparisonName = refreshedLoadout.name;
                                        loadoutItemMap.clear();
                                        break;
                                    }
                                    loadoutItemMap.set(eq.itemLocationHrid, {
                                        itemHrid: eq.itemHrid,
                                        enhancementLevel: eq.enhancementLevel,
                                    });
                                }
                                if (hasUsableComparison) {
                                    compareDrinks = (refreshedLoadout.drinks || [])
                                        .map((d) => d.itemHrid)
                                        .filter(Boolean);
                                }
                            } else {
                                unavailableComparisonName =
                                    refreshedLoadout?.name || this.optimizerLoadout?.name || 'Selected loadout';
                                if (refreshedLoadout) this.optimizerLoadout = refreshedLoadout;
                            }
                        }

                        const result = optimizeSkill(
                            this.currentSkill,
                            this.currentLevel,
                            this.selectedActionHrids,
                            hasUsableComparison ? { equipment: loadoutItemMap, drinks: compareDrinks } : null,
                            this.alchemyItemOverride
                        );
                        this.lastOptimizerResult = result;

                        // Build equipment map using player's actual owned enhancement levels,
                        // starting from the Compare loadout (when selected) rather than an empty
                        // Map - otherwise any slot without an owned upgrade silently drops out of
                        // this scenario entirely (no item at all), instead of keeping whatever the
                        // compared loadout actually has equipped there. A recommended item the
                        // player doesn't own at all is still unavailable, never a fictitious
                        // achievable +0 - it's excluded from the *upgrade*, not from the baseline.
                        const enhMap = buildOwnedEnhancementLevelMap();
                        const achievableEquipment = buildAchievableEquipment(
                            result?.slots,
                            enhMap,
                            hasUsableComparison ? loadoutItemMap : null
                        );

                        // Performance with achievable equipment and optimal teas for each goal.
                        // result.alchemyContext (resolved once inside optimizeSkill, from the
                        // manual override or the player's live queue) must be reused here too, or
                        // this second pass would silently fall back to the item-agnostic estimate.
                        const xpAchievable = result
                            ? findOptimalTeas(
                                  this.currentSkill,
                                  'xp',
                                  null,
                                  null,
                                  null,
                                  result.alchemyContext,
                                  achievableEquipment,
                                  this.selectedActionHrids,
                                  this.currentLevel
                              )
                            : null;
                        const goldAchievable = result
                            ? findOptimalTeas(
                                  this.currentSkill,
                                  'gold',
                                  null,
                                  null,
                                  null,
                                  result.alchemyContext,
                                  achievableEquipment,
                                  this.selectedActionHrids,
                                  this.currentLevel
                              )
                            : null;

                        optimizeBtn.textContent = 'Optimize';
                        optimizeBtn.disabled = false;
                        resultsArea.innerHTML = '';
                        if (result) {
                            this._renderOptimizerResults(
                                resultsArea,
                                result,
                                { xpResult: xpAchievable, goldResult: goldAchievable },
                                hasUsableComparison ? loadoutItemMap : null
                            );
                            if (unavailableComparisonName) {
                                const warning = document.createElement('div');
                                warning.textContent = `Compare loadout “${unavailableComparisonName}” is unavailable. Comparison was not substituted with Current Gear.`;
                                warning.style.cssText = 'color:#f87171; font-size:11px; margin-bottom:8px;';
                                resultsArea.prepend(warning);
                            }
                        }
                    }, 0)
                );
            });

            panel.appendChild(optimizeBtn);
            panel.appendChild(resultsArea);

            if (this.lastOptimizerResult)
                this._renderOptimizerResults(resultsArea, this.lastOptimizerResult, null, null);
        }

        return panel;
    }

    /**
     * Alchemy-only row letting the player override which item/action-type the Optimizer prices
     * Gold/XP against, instead of relying on auto-detecting their live queued Alchemy action
     * (which is unavailable if nothing's queued, or if they want to plan ahead for a different
     * item). Selecting an item+type applies immediately, matching the Compare select's convention
     * of no separate "Apply" step; "Use Active Action" clears back to auto-detection.
     * @returns {HTMLElement}
     */
    _buildAlchemyItemOverrideRow() {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;';

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        const label = document.createElement('span');
        label.textContent = 'Alchemy Item:';
        label.style.cssText = 'color: rgba(255,255,255,0.5); font-size: 12px; width: 56px; flex-shrink: 0;';
        row.appendChild(label);

        const selectCss =
            'background: #2a2a2a; color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;';

        // A plain native <select> with ~900 alphabetically-sorted items (every alchemyDetail item
        // in the game) is unusable to scroll through - reuses the same searchable single-select
        // popup already used for equipment/tea slots (_openItemPicker) instead of a flat dropdown.
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.style.cssText = `
            flex: 1; min-width: 0; padding: 4px 8px; font-size: 12px; text-align: left;
            background: #2a2a2a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
            cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        `;
        const items = getAlchemyItemOptions();
        const currentItemLabel = () => {
            if (!this.alchemyItemOverride?.itemHrid) return '— Auto (from active action) —';
            return this._getItemName(this.alchemyItemOverride.itemHrid) || this.alchemyItemOverride.itemHrid;
        };
        itemBtn.textContent = currentItemLabel();
        itemBtn.style.color = this.alchemyItemOverride?.itemHrid ? '#fff' : 'rgba(255,255,255,0.5)';
        itemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._picker) {
                this._closePicker();
                return;
            }
            this._openItemPicker(
                itemBtn,
                items,
                this.alchemyItemOverride?.itemHrid || null,
                (hrid) => {
                    applyOverride(hrid);
                    itemBtn.textContent = currentItemLabel();
                    itemBtn.style.color = this.alchemyItemOverride?.itemHrid ? '#fff' : 'rgba(255,255,255,0.5)';
                },
                '— Auto (from active action) —'
            );
        });
        row.appendChild(itemBtn);

        const typeSelect = document.createElement('select');
        typeSelect.style.cssText = selectCss + ' width: 100px; flex-shrink: 0;';
        for (const [value, name] of [
            ['decompose', 'Decompose'],
            ['coinify', 'Coinify'],
            ['transmute', 'Transmute'],
            ['unrefine', 'Unrefine'],
        ]) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = name;
            if ((this.alchemyItemOverride?.actionType || 'decompose') === value) opt.selected = true;
            typeSelect.appendChild(opt);
        }
        row.appendChild(typeSelect);

        const levelInput = document.createElement('input');
        levelInput.type = 'number';
        levelInput.min = '0';
        levelInput.max = '20';
        levelInput.value = String(this.alchemyItemOverride?.enhancementLevel || 0);
        levelInput.title = 'Enhancement level (ignored for Transmute)';
        levelInput.style.cssText = selectCss + ' width: 44px; flex-shrink: 0; cursor: text;';
        row.appendChild(levelInput);
        wrap.appendChild(row);

        const applyOverride = (itemHrid) => {
            if (!itemHrid) {
                this.alchemyItemOverride = null;
            } else {
                this.alchemyItemOverride = {
                    itemHrid,
                    actionType: typeSelect.value,
                    enhancementLevel: parseInt(levelInput.value, 10) || 0,
                };
            }
        };
        typeSelect.addEventListener('change', () => applyOverride(this.alchemyItemOverride?.itemHrid || null));
        levelInput.addEventListener('change', () => applyOverride(this.alchemyItemOverride?.itemHrid || null));

        const hint = document.createElement('div');
        hint.style.cssText = 'color: rgba(255,255,255,0.35); font-size: 10px; font-style: italic;';
        hint.textContent =
            'Alchemy Gold/XP are priced against one item - pick one, or leave on Auto to use whatever your character is currently queued to Alchemize.';
        wrap.appendChild(hint);

        return wrap;
    }

    _buildTopControls() {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 7px;';

        const makeRow = (labelText) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 8px;';
            const label = document.createElement('span');
            label.textContent = labelText;
            label.style.cssText = 'color: rgba(255,255,255,0.5); font-size: 12px; width: 56px; flex-shrink: 0;';
            row.appendChild(label);
            return row;
        };

        const inputCss = `
            background: #2a2a2a; color: #fff;
            border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
            padding: 4px 8px; font-size: 12px;
        `;

        // Skill
        const skillRow = makeRow('Skill:');
        const skillSelect = document.createElement('select');
        skillSelect.style.cssText = inputCss + ' flex: 1; cursor: pointer;';
        for (const s of SKILL_NAMES) {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            if (s === this.currentSkill) opt.selected = true;
            skillSelect.appendChild(opt);
        }
        skillRow.appendChild(skillSelect);
        wrap.appendChild(skillRow);

        // Level
        const levelRow = makeRow('Level:');
        const levelInput = document.createElement('input');
        levelInput.type = 'number';
        levelInput.min = '1';
        levelInput.max = '200';
        levelInput.value = String(this.currentLevel);
        levelInput.style.cssText = inputCss + ' width: 64px;';
        levelRow.appendChild(levelInput);
        wrap.appendChild(levelRow);

        // Loadout (simulator only)
        if (this.currentMode === 'simulator') {
            const loadoutRow = makeRow('Loadout:');
            const loadoutSelect = document.createElement('select');
            loadoutSelect.style.cssText = inputCss + ' flex: 1; cursor: pointer;';
            this._populateLoadoutSelect(loadoutSelect);
            loadoutRow.appendChild(loadoutSelect);
            wrap.appendChild(loadoutRow);
            const loadoutStatus = document.createElement('div');
            loadoutStatus.style.cssText = 'color:#f87171; font-size:11px; margin-left:64px;';
            if (this._simulatorLoadoutUnavailableName) {
                loadoutStatus.textContent = `Loadout “${this._simulatorLoadoutUnavailableName}” is unavailable and was not loaded.`;
            }
            wrap.appendChild(loadoutStatus);
            loadoutSelect.addEventListener('change', () => {
                const name = loadoutSelect.value;
                loadoutStatus.textContent = '';
                if (!name) return;
                if (!this._loadLoadout(name)) {
                    const selectedOption = loadoutSelect.selectedOptions?.[0];
                    if (selectedOption) {
                        selectedOption.textContent = `${name} (Unavailable)`;
                        selectedOption.disabled = true;
                    }
                    loadoutStatus.textContent = `Loadout “${name}” is unavailable and was not loaded.`;
                }
            });
        }
        // Actions - meaningless for Alchemy: its "actions" are just 4 generic action-type
        // templates with no item baked in (see getAlchemyItemOptions's doc), so this selector
        // can't narrow anything the Alchemy Item row above doesn't already cover, and having both
        // visible reads as two competing controls for the same thing.
        if (this.currentSkill !== 'Alchemy') {
            const actionsRow = makeRow('Actions:');
            actionsRow.style.position = 'relative';
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.style.cssText = inputCss + ' flex: 1; cursor: pointer; text-align: left;';

            const getActionLabel = () => {
                const all = getSkillActionsForDisplay(this.currentSkill, this.currentLevel);
                const avail = all.filter((a) => a.available);
                if (!this.selectedActionHrids) return `All (${avail.length})`;
                // Counts against the full action list (not just avail) so an explicitly selected
                // locked action - pending a tea unlock - is still reflected in the count.
                const n = [...this.selectedActionHrids].filter((h) => all.some((a) => a.hrid === h)).length;
                return `${n} / ${all.length}`;
            };
            actionBtn.textContent = getActionLabel();
            this._actionBtn = actionBtn;
            this._actionBtnGetLabel = getActionLabel;

            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._picker) {
                    this._closePicker();
                    return;
                }
                this._openActionPicker(actionBtn, getActionLabel);
            });
            actionsRow.appendChild(actionBtn);
            wrap.appendChild(actionsRow);
        } else {
            this._actionBtn = null;
            this._actionBtnGetLabel = null;
        }

        // Wire up skill/level changes
        const resetActions = () => {
            this.selectedActionHrids = null;
            if (this._actionBtn) this._actionBtn.textContent = this._actionBtnGetLabel();
            this._closePicker();
        };

        skillSelect.addEventListener('change', () => {
            this.currentSkill = skillSelect.value;
            this.currentLevel = getPlayerSkillLevel(this.currentSkill);
            this.selectedActionHrids = null;
            // Retargets equipment/teas/Compare for the new Skill (never carries the previous
            // Skill's gear/drinks/Compare forward) - _retargetedForSkill still holds the old
            // Skill name here, so this always fires on a real change.
            this._ensureRetargetedForCurrentSkill();
            this._rebuildPanel();
        });

        levelInput.addEventListener('change', () => {
            this.currentLevel = Math.max(1, Math.min(200, parseInt(levelInput.value, 10) || 1));
            levelInput.value = String(this.currentLevel);
            resetActions();
        });

        return wrap;
    }

    _populateLoadoutSelect(select) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '— No loadout —';
        if (!this._simulatorLoadoutName) empty.selected = true;
        select.appendChild(empty);

        let matched = false;
        for (const snap of loadoutState.getAllSnapshots()) {
            const opt = document.createElement('option');
            opt.value = snap.name;
            opt.textContent =
                snap.name + (snap.isDefault ? ' ★' : '') + (snap.isUsableForCalculation ? '' : ' (Unavailable)');
            opt.disabled = !snap.isUsableForCalculation;
            if (this._simulatorLoadoutName === snap.name) {
                opt.selected = true;
                matched = true;
            }
            select.appendChild(opt);
        }

        // The retargeted-to loadout may have been deleted entirely since being resolved -
        // represent it explicitly rather than silently falling back to "— No loadout —".
        if (this._simulatorLoadoutName && !matched) {
            const unavailableOpt = document.createElement('option');
            unavailableOpt.value = this._simulatorLoadoutName;
            unavailableOpt.textContent = `${this._simulatorLoadoutName} (Unavailable)`;
            unavailableOpt.selected = true;
            unavailableOpt.disabled = true;
            select.appendChild(unavailableOpt);
        }
    }

    _loadLoadout(name) {
        if (!name) return false;
        const snap = loadoutState.getUsableSnapshotByName(name);
        if (!snap) return false;

        // Build the imported equipment transactionally so a broken/unresolved numeric value
        // can never partially replace the simulator with a plausible +0 setup.
        const nextEquipment = new Map();
        for (const eq of snap.equipment || []) {
            if (!eq.itemHrid || !eq.itemLocationHrid || !Number.isFinite(eq.enhancementLevel)) return false;
            nextEquipment.set(eq.itemLocationHrid, {
                itemHrid: eq.itemHrid,
                enhancementLevel: eq.enhancementLevel,
            });
        }

        this.equipment = nextEquipment;

        // Loading a snapshot is an explicit one-time import into the editable simulator.
        this.teas = [
            snap.drinks?.[0]?.itemHrid || null,
            snap.drinks?.[1]?.itemHrid || null,
            snap.drinks?.[2]?.itemHrid || null,
        ];

        // Update slot UI
        for (const [locationHrid, refs] of this._slotBtns) {
            const eq = this.equipment.get(locationHrid);
            this._updateSlotUI(locationHrid, refs, eq?.itemHrid || null, eq?.enhancementLevel ?? 0);
        }

        // Update tea UI
        for (let i = 0; i < 3; i++) {
            const refs = this._teaBtns[i];
            if (!refs) continue;
            const hrid = this.teas[i];
            this._updateTeaUI(i, refs, hrid);
        }
        this._simulatorLoadoutName = name;
        this._simulatorLoadoutUnavailableName = null;
        return true;
    }

    /**
     * Resolve the canonical preferred loadout for an action type using Core's existing priority
     * (skill default -> all-skills default -> skill non-default -> all-skills non-default ->
     * none), transactionally validated the same way as a manual _loadLoadout() import.
     * @param {string} actionTypeHrid
     * @returns {{status:'usable'|'unavailable'|'none', name: string|null, equipment?: Map, drinks?: Array}}
     */
    _resolveCanonicalLoadout(actionTypeHrid) {
        const selection = loadoutState.findSnapshotSelectionForActionType(actionTypeHrid);
        if (selection.status !== 'usable') {
            return {
                status: selection.status === 'unavailable' ? 'unavailable' : 'none',
                name: selection.snapshot?.name || null,
            };
        }

        const snap = selection.snapshot;
        const equipment = new Map();
        for (const eq of snap.equipment || []) {
            if (!eq.itemHrid || !eq.itemLocationHrid || !Number.isFinite(eq.enhancementLevel)) {
                return { status: 'unavailable', name: snap.name };
            }
            equipment.set(eq.itemLocationHrid, { itemHrid: eq.itemHrid, enhancementLevel: eq.enhancementLevel });
        }
        const drinks = [
            snap.drinks?.[0]?.itemHrid || null,
            snap.drinks?.[1]?.itemHrid || null,
            snap.drinks?.[2]?.itemHrid || null,
        ];
        return { status: 'usable', name: snap.name, equipment, drinks };
    }

    /**
     * Retarget both Simulator and Optimizer to the canonical preferred loadout for the current
     * Skill, exactly once per actual Skill change (guarded by _retargetedForSkill) - never on an
     * unrelated panel rebuild, so manual edits survive mode switches. Never carries equipment,
     * drinks, or a Compare loadout over from a previously selected Skill.
     */
    _ensureRetargetedForCurrentSkill() {
        if (this._retargetedForSkill === this.currentSkill) return;
        this._retargetedForSkill = this.currentSkill;

        const actionType = SKILL_TO_ACTION_TYPE[this.currentSkill.toLowerCase()] || null;
        const resolved = actionType ? this._resolveCanonicalLoadout(actionType) : { status: 'none', name: null };

        if (resolved.status === 'usable') {
            this.equipment = resolved.equipment;
            this.teas = resolved.drinks;
            this._simulatorLoadoutName = resolved.name;
            this._simulatorLoadoutUnavailableName = null;
            this.optimizerLoadout = loadoutState.getUsableSnapshotByName(resolved.name);
        } else {
            // 'unavailable': fail closed to a clean empty scenario rather than substituting
            // Current Gear, a fabricated +0 setup, or stale gear from the previous Skill - and
            // still surface which preferred loadout couldn't be used.
            // 'none': no preferred loadout exists for this Skill at all.
            this.equipment = new Map();
            this.teas = [null, null, null];
            this._simulatorLoadoutName = resolved.status === 'unavailable' ? resolved.name : null;
            this._simulatorLoadoutUnavailableName = resolved.status === 'unavailable' ? resolved.name : null;
            // Reusing the same {name} placeholder shape the manual Compare dropdown already
            // handles when a previously-selected loadout later becomes unavailable, so the
            // existing "(Unavailable)" rendering applies without a separate code path.
            this.optimizerLoadout = resolved.status === 'unavailable' ? { name: resolved.name } : null;
        }
    }

    // -------------------------------------------------------------------------
    // Equipment section
    // -------------------------------------------------------------------------

    _buildEquipmentSection() {
        const section = document.createElement('div');
        section.style.marginTop = '14px';
        section.appendChild(this._makeSectionHeader('Equipment'));

        const relevantTool = SKILL_TOOL_LOCATION[this.currentSkill];
        const locations = SKILLING_LOCATIONS.filter((loc) => !loc.endsWith('_tool') || loc === relevantTool);

        for (const locationHrid of locations) {
            if (getItemsForSlot(locationHrid, this.currentSkill).length === 0) continue;
            section.appendChild(this._buildSlotRow(locationHrid));
        }

        return section;
    }

    _buildSlotRow(locationHrid) {
        const eq = this.equipment.get(locationHrid);
        const currentHrid = eq?.itemHrid || null;
        const currentEnh = eq?.enhancementLevel ?? 0;

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 0;';

        const label = document.createElement('span');
        label.textContent = SLOT_DISPLAY_NAMES[locationHrid] || locationHrid;
        label.style.cssText =
            'font-size: 10px; color: rgba(255,255,255,0.35); width: 58px; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.04em;';
        row.appendChild(label);

        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.style.cssText = `
            flex: 1; padding: 3px 6px; font-size: 11px; text-align: left;
            background: #2a2a2a; color: ${currentHrid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)'};
            border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
            cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        `;
        nameBtn.textContent = currentHrid ? this._getItemName(currentHrid) || currentHrid : '—';

        const enhInput = document.createElement('input');
        enhInput.type = 'number';
        enhInput.min = '0';
        enhInput.max = '20';
        enhInput.value = String(currentEnh);
        enhInput.style.cssText = `
            width: 40px; padding: 3px 4px; font-size: 11px; text-align: center;
            background: #2a2a2a; color: #fff;
            border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
            display: ${currentHrid ? 'block' : 'none'};
        `;
        enhInput.addEventListener('change', () => {
            const level = Math.max(0, Math.min(20, parseInt(enhInput.value, 10) || 0));
            enhInput.value = String(level);
            const existing = this.equipment.get(locationHrid);
            if (existing) existing.enhancementLevel = level;
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = '✕';
        clearBtn.style.cssText = `
            padding: 2px 5px; font-size: 10px; cursor: pointer;
            background: transparent; color: rgba(255,255,255,0.3);
            border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
            display: ${currentHrid ? 'block' : 'none'};
        `;
        clearBtn.addEventListener('click', () => {
            this.equipment.delete(locationHrid);
            this._updateSlotUI(locationHrid, { nameBtn, enhInput, clearBtn }, null, 0);
        });

        nameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._picker) {
                this._closePicker();
                return;
            }
            const items = getItemsForSlot(locationHrid, this.currentSkill);
            this._openItemPicker(nameBtn, items, this.equipment.get(locationHrid)?.itemHrid || null, (hrid) => {
                if (hrid) {
                    this.equipment.set(locationHrid, { itemHrid: hrid, enhancementLevel: 0 });
                } else {
                    this.equipment.delete(locationHrid);
                }
                this._updateSlotUI(locationHrid, { nameBtn, enhInput, clearBtn }, hrid, 0);
            });
        });

        row.appendChild(nameBtn);
        row.appendChild(enhInput);
        row.appendChild(clearBtn);

        this._slotBtns.set(locationHrid, { nameBtn, enhInput, clearBtn });
        return row;
    }

    _updateSlotUI(locationHrid, refs, itemHrid, enhLevel) {
        const { nameBtn, enhInput, clearBtn } = refs;
        const name = itemHrid ? this._getItemName(itemHrid) || itemHrid : null;
        nameBtn.textContent = name || '—';
        nameBtn.style.color = itemHrid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)';
        enhInput.value = String(enhLevel);
        enhInput.style.display = itemHrid ? 'block' : 'none';
        clearBtn.style.display = itemHrid ? 'block' : 'none';
    }

    // -------------------------------------------------------------------------
    // Tea section
    // -------------------------------------------------------------------------

    _buildTeasSection() {
        const section = document.createElement('div');
        section.style.marginTop = '14px';
        section.appendChild(this._makeSectionHeader('Teas'));

        for (let i = 0; i < 3; i++) {
            const row = this._buildTeaRow(i);
            section.appendChild(row);
        }

        return section;
    }

    _buildTeaRow(index) {
        const currentHrid = this.teas[index];

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 0;';

        const label = document.createElement('span');
        label.textContent = `TEA ${index + 1}`;
        label.style.cssText =
            'font-size: 10px; color: rgba(255,255,255,0.35); width: 58px; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.04em;';
        row.appendChild(label);

        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.style.cssText = `
            flex: 1; padding: 3px 6px; font-size: 11px; text-align: left;
            background: #2a2a2a; color: ${currentHrid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)'};
            border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
            cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        `;
        nameBtn.textContent = currentHrid ? this._getItemName(currentHrid) || currentHrid : '—';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = '✕';
        clearBtn.style.cssText = `
            padding: 2px 5px; font-size: 10px; cursor: pointer;
            background: transparent; color: rgba(255,255,255,0.3);
            border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
            display: ${currentHrid ? 'block' : 'none'};
        `;
        clearBtn.addEventListener('click', () => {
            this.teas[index] = null;
            this._updateTeaUI(index, { nameBtn, clearBtn }, null);
        });

        nameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._picker) {
                this._closePicker();
                return;
            }
            const drinks = getSkillDrinkItems();
            this._openItemPicker(nameBtn, drinks, this.teas[index], (hrid) => {
                this.teas[index] = hrid;
                this._updateTeaUI(index, { nameBtn, clearBtn }, hrid);
            });
        });

        row.appendChild(nameBtn);
        row.appendChild(clearBtn);

        this._teaBtns[index] = { nameBtn, clearBtn };
        return row;
    }

    _updateTeaUI(index, refs, hrid) {
        const { nameBtn, clearBtn } = refs;
        const name = hrid ? this._getItemName(hrid) || hrid : null;
        nameBtn.textContent = name || '—';
        nameBtn.style.color = hrid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)';
        clearBtn.style.display = hrid ? 'block' : 'none';
    }

    // -------------------------------------------------------------------------
    // Item picker popup
    // -------------------------------------------------------------------------

    /**
     * @param {HTMLElement} anchorEl
     * @param {Array<{hrid: string, name: string, available?: boolean, itemLevel?: number}>} items
     * @param {string|null} currentHrid
     * @param {(hrid: string|null) => void} onSelect
     * @param {string} [emptyLabel] - Label for the "clear selection" row (default '— Empty —')
     */
    _openItemPicker(anchorEl, items, currentHrid, onSelect, emptyLabel = '— Empty —') {
        this._closePicker();

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: fixed; z-index: 20000;
            background: #1e1e1e; border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px; width: 260px; max-height: 300px;
            display: flex; flex-direction: column;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        `;

        // Position below anchor, flip up if too close to bottom
        const rect = anchorEl.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;
        if (left + 260 > window.innerWidth - 8) left = window.innerWidth - 268;
        if (top + 300 > window.innerHeight - 8) top = rect.top - 304;
        popup.style.top = `${Math.max(8, top)}px`;
        popup.style.left = `${Math.max(8, left)}px`;

        // Search input
        const search = document.createElement('input');
        search.placeholder = 'Search…';
        search.style.cssText = `
            padding: 7px 10px; background: #2a2a2a; color: #fff; font-size: 12px;
            border: none; border-bottom: 1px solid rgba(255,255,255,0.15); outline: none;
            border-radius: 6px 6px 0 0; flex-shrink: 0;
        `;
        popup.appendChild(search);

        const list = document.createElement('div');
        list.style.cssText = 'overflow-y: auto; flex: 1;';
        popup.appendChild(list);

        const render = (filter) => {
            list.innerHTML = '';

            // Empty option
            const emptyRow = document.createElement('div');
            emptyRow.textContent = emptyLabel;
            emptyRow.style.cssText =
                'padding: 6px 10px; cursor: pointer; font-size: 12px; color: rgba(255,255,255,0.35); font-style: italic; border-bottom: 1px solid rgba(255,255,255,0.08);';
            emptyRow.addEventListener('mouseenter', () => (emptyRow.style.background = 'rgba(255,255,255,0.05)'));
            emptyRow.addEventListener('mouseleave', () => (emptyRow.style.background = ''));
            emptyRow.addEventListener('click', () => {
                onSelect(null);
                this._closePicker();
            });
            list.appendChild(emptyRow);

            const lc = filter.toLowerCase();
            const filtered = filter ? items.filter((i) => i.name.toLowerCase().includes(lc)) : items;
            const avail = filtered.filter((i) => i.available !== false);
            const locked = filtered.filter((i) => i.available === false);

            for (const item of avail) list.appendChild(this._makePickerRow(item, currentHrid, onSelect));

            if (locked.length) {
                const sep = document.createElement('div');
                sep.textContent = '— Level locked —';
                sep.style.cssText =
                    'padding: 4px 10px; font-size: 10px; color: rgba(255,255,255,0.3); border-top: 1px solid rgba(255,255,255,0.08);';
                list.appendChild(sep);
                for (const item of locked) list.appendChild(this._makePickerRow(item, currentHrid, onSelect));
            }
        };

        render('');
        search.addEventListener('input', () => render(search.value));

        document.body.appendChild(popup);
        this._picker = popup;

        const closeHandler = (e) => {
            if (!popup.contains(e.target) && e.target !== anchorEl) {
                this._closePicker();
                document.removeEventListener('click', closeHandler, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler, true), 100);
        this._pickerCleanup = () => document.removeEventListener('click', closeHandler, true);

        search.focus();
    }

    _makePickerRow(item, currentHrid, onSelect) {
        const isSelected = item.hrid === currentHrid;
        const isLocked = item.available === false;

        const row = document.createElement('div');
        row.style.cssText = `
            padding: 5px 10px; font-size: 12px; cursor: ${isLocked ? 'default' : 'pointer'};
            color: ${isLocked ? 'rgba(255,255,255,0.2)' : isSelected ? config.COLOR_ACCENT : 'rgba(255,255,255,0.8)'};
            ${isLocked ? 'text-decoration: line-through;' : ''}
            ${isSelected ? 'font-weight: 600; background: rgba(255,255,255,0.04);' : ''}
            display: flex; justify-content: space-between;
        `;

        const name = document.createElement('span');
        name.textContent = item.name;
        row.appendChild(name);

        if (item.itemLevel > 0) {
            const req = document.createElement('span');
            req.textContent = `T${item.itemLevel}`;
            req.style.cssText = 'font-size: 10px; color: rgba(255,255,255,0.25); flex-shrink: 0; margin-left: 6px;';
            row.appendChild(req);
        }

        if (!isLocked) {
            row.addEventListener('mouseenter', () => {
                if (!isSelected) row.style.background = 'rgba(255,255,255,0.06)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = isSelected ? 'rgba(255,255,255,0.04)' : '';
            });
            row.addEventListener('click', () => {
                onSelect(item.hrid);
                this._closePicker();
            });
        }

        return row;
    }

    _closePicker() {
        if (this._pickerCleanup) {
            this._pickerCleanup();
            this._pickerCleanup = null;
        }
        this._picker?.remove();
        this._picker = null;
    }

    // -------------------------------------------------------------------------
    // Action picker popup
    // -------------------------------------------------------------------------

    _openActionPicker(anchorBtn, getBtnLabel) {
        this._closePicker();

        const actions = getSkillActionsForDisplay(this.currentSkill, this.currentLevel);
        const available = actions.filter((a) => a.available);

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10000;
            background: #1e1e1e; border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px; max-height: 260px; overflow-y: auto;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5); font-size: 12px;
        `;

        const makeRow = (label, checked, disabled, onToggle) => {
            const row = document.createElement('label');
            row.style.cssText = `
                display: flex !important; width: 100% !important; box-sizing: border-box;
                align-items: center; gap: 8px; padding: 5px 10px;
                cursor: ${disabled ? 'default' : 'pointer'};
                color: ${disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.85)'};
                ${disabled ? 'text-decoration: line-through;' : ''}
            `;
            if (!disabled) {
                row.addEventListener('mouseenter', () => (row.style.background = 'rgba(255,255,255,0.06)'));
                row.addEventListener('mouseleave', () => (row.style.background = ''));
            }
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            cb.disabled = disabled;
            cb.addEventListener('change', () => onToggle(cb.checked));
            row.appendChild(cb);
            const text = document.createElement('span');
            text.textContent = label;
            row.appendChild(text);
            return { row, cb };
        };

        const allChecked = this.selectedActionHrids === null;
        const itemRows = [];

        const { row: allRow, cb: allCb } = makeRow('All', allChecked, false, (checked) => {
            if (checked) {
                this.selectedActionHrids = null;
                itemRows.forEach(({ cb }) => {
                    cb.checked = true;
                });
            } else {
                this.selectedActionHrids = new Set();
                itemRows.forEach(({ cb }) => {
                    cb.checked = false;
                });
            }
            anchorBtn.textContent = getBtnLabel();
        });
        allRow.style.cssText += ' font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.1);';
        popup.appendChild(allRow);

        const searchWrapper = document.createElement('div');
        searchWrapper.style.cssText = 'padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search actions...';
        searchInput.style.cssText = `
            width: 100%; box-sizing: border-box; background: #2a2a2a; color: rgba(255,255,255,0.85);
            border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 4px 8px; font-size: 12px;
        `;
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            for (const { row, name } of itemRows) {
                const visible = !query || name.toLowerCase().includes(query);
                // Plain `row.style.display = ...` silently drops the `!important` priority set in
                // makeRow's cssText, letting the native page's competing rule win back the moment
                // you type. setProperty(...,'important') is the only JS API that preserves it.
                row.style.setProperty('display', visible ? 'flex' : 'none', 'important');
            }
        });
        searchWrapper.appendChild(searchInput);
        popup.appendChild(searchWrapper);

        for (const action of actions) {
            // A locked action can still be explicitly selected - a tea combination the Optimizer
            // searches (or a manually picked Simulator tea) may unlock it at the boosted level.
            // "All" never auto-includes a locked action; it only becomes checked via an explicit
            // toggle below, matching selectedActionHrids === null meaning ordinary base-available
            // actions only.
            const isChecked =
                this.selectedActionHrids === null ? action.available : this.selectedActionHrids.has(action.hrid);
            const label = action.available
                ? action.name
                : `${action.name} (lv ${action.requiredLevel} — locked, may unlock via tea)`;
            const { row, cb } = makeRow(label, isChecked, false, (checked) => {
                if (this.selectedActionHrids === null) {
                    this.selectedActionHrids = new Set(available.map((a) => a.hrid));
                }
                if (checked) this.selectedActionHrids.add(action.hrid);
                else this.selectedActionHrids.delete(action.hrid);
                // Collapse back to "All" only when every ordinarily-available action is selected
                // AND no locked action was explicitly added - a locked pick always needs the
                // explicit Set form, since "All" itself never implies a locked action.
                const onlyOrdinaryAvailableSelected =
                    available.every((a) => this.selectedActionHrids.has(a.hrid)) &&
                    actions.every((a) => a.available || !this.selectedActionHrids.has(a.hrid));
                if (onlyOrdinaryAvailableSelected) {
                    this.selectedActionHrids = null;
                    allCb.checked = true;
                } else {
                    allCb.checked = false;
                }
                anchorBtn.textContent = getBtnLabel();
            });
            itemRows.push({ cb, hrid: action.hrid, row, name: action.name });
            popup.appendChild(row);
        }

        anchorBtn.parentElement.style.position = 'relative';
        anchorBtn.parentElement.appendChild(popup);
        this._picker = popup;
        searchInput.focus();

        const closeHandler = (e) => {
            if (!popup.contains(e.target) && e.target !== anchorBtn) {
                this._closePicker();
                document.removeEventListener('click', closeHandler, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler, true), 100);
        this._pickerCleanup = () => document.removeEventListener('click', closeHandler, true);
    }

    // -------------------------------------------------------------------------
    // Simulation
    // -------------------------------------------------------------------------

    _runSimulation() {
        if (!this._resultsArea) return;

        this._resultsArea.innerHTML = '';

        const section = document.createElement('div');
        section.appendChild(this._makeSectionHeader('Results'));

        // Alchemy XP/Gold depend on the specific item + enhancement being processed, which this
        // generic action-wide scenario has no context for. A generic number here would silently
        // misrepresent real Coinify/Decompose/Transmute economics - fail closed instead.
        if (this.currentSkill === 'Alchemy') {
            const unsupported = document.createElement('div');
            unsupported.style.cssText = 'color: rgba(255,255,255,0.5); font-size: 12px;';
            unsupported.textContent =
                'Alchemy scenario math is not item-aware yet, so a generic Results number here would ' +
                'misrepresent real Coinify/Decompose/Transmute economics. Unsupported for now.';
            section.appendChild(unsupported);
            this._resultsArea.appendChild(section);
            return;
        }

        const result = calculateSkillPerformance(
            this.currentSkill,
            this.equipment,
            this.teas,
            this.currentLevel,
            this.selectedActionHrids
        );

        const stats = document.createElement('div');
        stats.style.cssText = 'display: flex; gap: 20px; margin-bottom: 8px;';

        const makeStat = (label, value, color, isIncomplete = false) => {
            const el = document.createElement('div');
            const valueText = isIncomplete ? `${formatKMB(value)} (incomplete)` : formatKMB(value);
            el.innerHTML = `
                <div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${label}</div>
                <div style="font-size:15px;font-weight:700;color:${color};">${valueText}</div>
            `;
            return el;
        };

        // Multi-action Results are an equal-weight arithmetic average across the fixed selected
        // cohort - label it as such so it is never mistaken for one real action's exact rate.
        const allActionsAvailable = getSkillActionsForDisplay(this.currentSkill, this.currentLevel).filter(
            (a) => a.available
        );
        const selectedCount =
            this.selectedActionHrids === null ? allActionsAvailable.length : this.selectedActionHrids.size;
        const isMultiAction = selectedCount > 1;

        stats.appendChild(makeStat(isMultiAction ? 'Avg XP / hr' : 'XP / hr', result.xpPerHour, config.COLOR_INFO));
        stats.appendChild(
            makeStat(
                isMultiAction ? 'Avg Gold / hr' : 'Gold / hr',
                result.goldPerHour,
                config.COLOR_PROFIT,
                result.hasMissingPrice
            )
        );
        section.appendChild(stats);

        if (result.teaCostPerHour > 0) {
            const cost = document.createElement('div');
            cost.style.cssText = 'font-size: 11px; color: rgba(255,255,255,0.4);';
            cost.textContent = `Tea cost: ${formatKMB(result.teaCostPerHour)}/hr`;
            section.appendChild(cost);
        }

        this._resultsArea.appendChild(section);
    }

    // -------------------------------------------------------------------------
    // Optimizer results rendering
    // -------------------------------------------------------------------------

    /**
     * Small status line for Alchemy showing which item/action-type the Gold/XP numbers below were
     * priced against - auto-detected from the live queue, manually overridden, or unavailable
     * (falls back to the pre-existing item-agnostic XP estimate, Gold unavailable).
     * @param {Object} result - optimizeSkill() return value
     * @returns {HTMLElement}
     */
    _buildAlchemyBasisLabel(result) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size: 11px; margin-bottom: 10px;';
        const ctx = result.alchemyContext;
        if (!ctx) {
            label.style.color = '#f0ad4e';
            label.textContent =
                'Based on: nothing queued - XP is an item-agnostic estimate, Gold is unavailable. ' +
                'Pick an item above, or start an Alchemy action.';
        } else {
            label.style.color = 'rgba(255,255,255,0.5)';
            const itemName = this._getItemName(ctx.itemHrid) || ctx.itemHrid;
            const typeName = ctx.actionType.charAt(0).toUpperCase() + ctx.actionType.slice(1);
            const levelSuffix = ctx.enhancementLevel ? ` +${ctx.enhancementLevel}` : '';
            const source = result.alchemyContextIsManual ? 'manually selected' : 'from your active/queued action';
            label.textContent = `Based on: ${typeName} ${itemName}${levelSuffix} (${source})`;
        }
        return label;
    }

    _renderOptimizerResults(container, result, achievableStats, loadoutItemMap) {
        const { slots, goal, xpBaseline, goldBaseline, houseRoomCandidate } = result;
        const slotEntries = Object.entries(slots);

        if (!slotEntries.length) {
            const empty = document.createElement('div');
            empty.style.color = 'rgba(255,255,255,0.5)';
            empty.textContent = 'No relevant equipment found for this skill at the selected level.';
            container.appendChild(empty);
            return;
        }

        if (result.skill?.toLowerCase() === 'alchemy') {
            container.appendChild(this._buildAlchemyBasisLabel(result));
        }

        // Ranked by the same "first breakpoint that beats baseline" upgrade the row itself
        // displays (see _renderSlotRow's Compare-mode suggestedEntry search), so "value" always
        // describes the exact upgrade shown, not a different aggregate number.
        const metricsByLocation = new Map(
            slotEntries.map(([locationHrid, slotData]) => [
                locationHrid,
                this._computeSlotMetrics(slotData, xpBaseline, goldBaseline),
            ])
        );

        const sortRow = document.createElement('div');
        sortRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 10px;';
        const sortLabel = document.createElement('span');
        sortLabel.textContent = 'Sort:';
        sortLabel.style.cssText = 'color: rgba(255,255,255,0.5); font-size: 12px; width: 56px; flex-shrink: 0;';
        const sortSelect = document.createElement('select');
        sortSelect.style.cssText =
            'background: #2a2a2a; color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; font-size: 12px; flex: 1; cursor: pointer;';
        for (const mode of SORT_MODES) {
            const opt = document.createElement('option');
            opt.value = mode.value;
            opt.textContent = mode.label;
            if (mode.value === this.optimizerSortMode) opt.selected = true;
            sortSelect.appendChild(opt);
        }
        sortSelect.addEventListener('change', () => {
            this.optimizerSortMode = sortSelect.value;
            container.innerHTML = '';
            this._renderOptimizerResults(container, result, achievableStats, loadoutItemMap);
        });
        sortRow.appendChild(sortLabel);
        sortRow.appendChild(sortSelect);
        container.appendChild(sortRow);

        const orderedEntries =
            this.optimizerSortMode === 'slot'
                ? slotEntries
                : [...slotEntries].sort((a, b) => {
                      const diff =
                          this._sortValueFor(metricsByLocation.get(a[0]), goal, this.optimizerSortMode) -
                          this._sortValueFor(metricsByLocation.get(b[0]), goal, this.optimizerSortMode);
                      return diff !== 0 ? diff : slotEntries.indexOf(a) - slotEntries.indexOf(b);
                  });

        container.appendChild(this._makeSectionHeader('Equipment Progression'));
        container.appendChild(
            this._renderProgressionTable(orderedEntries, loadoutItemMap, xpBaseline, goldBaseline, houseRoomCandidate)
        );

        const xpResult = achievableStats?.xpResult;
        const goldResult = achievableStats?.goldResult;
        // Presence of an optimal result is what matters - a genuinely negative avgScore (every
        // combination including no-tea is a net loss) must still be shown as a signed number,
        // never hidden the same way a fabricated zero would be.
        const hasXp = xpResult?.optimal != null;
        const hasGold = goldResult?.optimal != null;

        if (hasXp || hasGold) {
            const statsRow = document.createElement('div');
            statsRow.style.cssText = 'display: flex; gap: 20px; margin-top: 16px; margin-bottom: 4px;';
            if (hasXp) statsRow.appendChild(this._makeStat('Avg XP/hr', xpResult.optimal.avgScore, config.COLOR_INFO));
            if (hasGold)
                statsRow.appendChild(
                    this._makeStat(
                        'Avg Gold/hr',
                        goldResult.optimal.avgScore,
                        config.COLOR_PROFIT,
                        goldResult.optimal.hasMissingPrice
                    )
                );
            container.appendChild(statsRow);
        }

        if (hasXp || hasGold) {
            const teasSection = document.createElement('div');
            teasSection.style.marginTop = '14px';
            teasSection.appendChild(this._makeSectionHeader('Optimal Teas'));
            const cols = document.createElement('div');
            cols.style.cssText = 'display: flex; gap: 16px;';
            if (hasXp) cols.appendChild(this._makeTeaCol('For XP', config.COLOR_INFO, xpResult.optimal.teas));
            if (hasGold) cols.appendChild(this._makeTeaCol('For Gold', config.COLOR_PROFIT, goldResult.optimal.teas));
            teasSection.appendChild(cols);
            container.appendChild(teasSection);
        }

        const note = document.createElement('div');
        note.style.cssText = 'margin-top: 12px; font-size: 10px; color: rgba(255,255,255,0.3); font-style: italic;';
        note.textContent = loadoutItemMap
            ? '% shows gain over your compared loadout item for each slot.'
            : '% shows gain over an empty slot. Select a loadout in Compare to see gains over your current gear.';
        container.appendChild(note);
    }

    /**
     * Per-slot metrics for the Equipment Progression sort control, derived from the same first
     * breakpoint that beats baseline already used for the Compare-mode single-suggestion line
     * (see _renderSlotRow) - so every sort mode ranks the exact upgrade the row displays, not a
     * separately-derived number. `entry: null` means every breakpoint failed the safety filter
     * below (guarded against by construction today, see engine.js's own-slot inclusion check),
     * and is treated as unranked (see _sortValueFor).
     * @param {Object} slotData
     * @param {number} xpBaseline
     * @param {number} goldBaseline
     * @returns {{entry: Object|null, xpDelta: number, goldDelta: number, cost: number, xpPct: number, goldPct: number, xpPerMillion: number|null, paybackHours: number|null}}
     */
    _computeSlotMetrics(slotData, xpBaseline, goldBaseline) {
        const entry = slotData.progression.find((e) => {
            if (!e.itemHrid) return false;
            return e.xpScore - xpBaseline > 0 || e.goldScore - goldBaseline > 0;
        });
        if (!entry) {
            return {
                entry: null,
                xpDelta: 0,
                goldDelta: 0,
                cost: 0,
                xpPct: 0,
                goldPct: 0,
                xpPerMillion: null,
                paybackHours: null,
            };
        }

        const xpDelta = entry.xpScore - xpBaseline;
        const goldDelta = entry.goldScore - goldBaseline;
        const xpPct = xpBaseline > 0 && xpDelta > 0 ? (xpDelta / xpBaseline) * 100 : 0;
        const goldPct = goldBaseline > 0 && goldDelta > 0 ? (goldDelta / goldBaseline) * 100 : 0;
        // Mirrors _makeCostPaybackEl's own gating (incomplete price / non-positive delta never
        // backs a ratio) - a zero net cost with a real gain is the best possible ratio (Infinity
        // / instant payback), not "no ratio".
        const xpPerMillion =
            entry.costIsIncomplete || xpDelta <= 0
                ? null
                : entry.cost > 0
                  ? (xpDelta / entry.cost) * 1_000_000
                  : Infinity;
        const paybackHours =
            entry.costIsIncomplete || goldDelta <= 0 ? null : entry.cost > 0 ? entry.cost / goldDelta : 0;

        return { entry, xpDelta, goldDelta, cost: entry.cost, xpPct, goldPct, xpPerMillion, paybackHours };
    }

    /**
     * Ascending sort key for one slot under the given sort mode - lower sorts first. A slot with
     * nothing actionable (`metrics.entry === null`) always sorts last, since there's no upgrade
     * to prioritize regardless of mode.
     * @param {Object} metrics - Result of _computeSlotMetrics
     * @param {string} goal - 'xp' | 'gold' (the skill's own optimization goal)
     * @param {string} sortMode - One of SORT_MODES' `value`s
     * @returns {number}
     */
    _sortValueFor(metrics, goal, sortMode) {
        if (!metrics.entry) return Infinity;
        switch (sortMode) {
            case 'payback':
                return metrics.paybackHours ?? Infinity;
            case 'cost':
                return metrics.cost;
            case 'xpGain':
                return -metrics.xpPct;
            case 'goldGain':
                return -metrics.goldPct;
            case 'value':
            default:
                return goal === 'gold' ? (metrics.paybackHours ?? Infinity) : -(metrics.xpPerMillion ?? -Infinity);
        }
    }

    /**
     * Builds the Equipment Progression results as a real <table> (spreadsheet-style columns) so
     * Cost/Profit/XP/Payback figures line up across every slot, instead of each row's text
     * pushing its own numbers out of alignment.
     * @param {Array<[string, Object]>} orderedEntries - [locationHrid, slotData] pairs, already sorted
     * @param {Map|null} loadoutItemMap - Compare loadout equipment, or null with none selected
     * @param {number} xpBaseline
     * @param {number} goldBaseline
     * @returns {HTMLTableElement}
     */
    /**
     * @param {Array<[string, Object]>} orderedEntries
     * @param {Map|null} loadoutItemMap
     * @param {number} xpBaseline
     * @param {number} goldBaseline
     * @param {Object|null} [houseRoomCandidate] - optimizeSkill()'s one-off house-room upgrade
     *   suggestion (see skilling-optimizer-engine.js's getHouseRoomCandidate), or null when the
     *   skill has no dedicated room or that room is already at its max level.
     * @returns {HTMLTableElement}
     */
    _renderProgressionTable(orderedEntries, loadoutItemMap, xpBaseline, goldBaseline, houseRoomCandidate = null) {
        const spriteUrl =
            document.querySelector('use[href*="items_sprite"]')?.getAttribute('href')?.split('#')[0] ?? null;

        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 11px;';

        const thStyle =
            'padding: 4px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.15); ' +
            'color: rgba(255,255,255,0.4); font-weight: 600; white-space: nowrap;';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th style="${thStyle}">Item</th>
            <th style="${thStyle}">Cost</th>
            <th style="${thStyle}">Profit Δ</th>
            <th style="${thStyle}">G/0.01% Profit</th>
            <th style="${thStyle}">Exp/Hr Δ</th>
            <th style="${thStyle}">G/0.01% Exp/Hr</th>
            <th style="${thStyle}">Payback</th>
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const [locationHrid, slotData] of orderedEntries) {
            const loadoutEntry = loadoutItemMap?.get(locationHrid) ?? null;
            // xpBaseline/goldBaseline already reflect the full Compare loadout + its drinks (or
            // the empty-slot baseline when no Compare is selected) - optimizeSkill() computed it
            // once against the same scenario every candidate in slotData.progression was scored
            // against, so it's reused as-is rather than re-scored per slot.
            this._appendSlotTableRows(tbody, slotData, loadoutEntry, xpBaseline, goldBaseline, spriteUrl);
        }
        if (houseRoomCandidate) {
            this._appendHouseRoomRow(tbody, houseRoomCandidate, xpBaseline, goldBaseline, spriteUrl);
        }
        table.appendChild(tbody);

        return table;
    }

    /**
     * One row suggesting "upgrade the skill's dedicated house room by one level" - a candidate
     * that isn't tied to any equipment slot, so it always renders as its own single row below
     * every equipment slot's rows, reusing the same metric cell builders.
     * @param {HTMLElement} tbody
     * @param {Object} houseRoomCandidate - See skilling-optimizer-engine.js's getHouseRoomCandidate
     * @param {number} xpBaseline
     * @param {number} goldBaseline
     * @param {string|null} spriteUrl
     */
    _appendHouseRoomRow(tbody, houseRoomCandidate, xpBaseline, goldBaseline, spriteUrl) {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.06);';

        const nameTd = document.createElement('td');
        nameTd.style.cssText = 'padding: 4px 8px;';

        const label = document.createElement('span');
        label.style.cssText =
            'font-size: 10px; color: rgba(255,255,255,0.38); text-transform: uppercase; letter-spacing: 0.04em;';
        label.textContent = 'House Room';
        nameTd.appendChild(label);

        const transition = document.createElement('span');
        transition.style.cssText = 'margin-left: 8px;';
        const fromSpan = document.createElement('span');
        fromSpan.style.cssText = 'color: rgba(255,255,255,0.5);';
        fromSpan.textContent = `${houseRoomCandidate.roomName} +${houseRoomCandidate.currentLevel}`;
        transition.appendChild(fromSpan);
        transition.appendChild(document.createTextNode(' → '));
        const toSpan = document.createElement('span');
        toSpan.style.cssText = `color: ${config.COLOR_ACCENT}; font-weight: 600;`;
        toSpan.textContent = `+${houseRoomCandidate.targetLevel}`;
        this._applyIncompleteTooltip(toSpan, houseRoomCandidate.hasMissingPrice);
        transition.appendChild(toSpan);
        nameTd.appendChild(transition);
        tr.appendChild(nameTd);

        this._appendMetricCells(tr, houseRoomCandidate, xpBaseline, goldBaseline, spriteUrl);
        tbody.appendChild(tr);
    }

    /**
     * Slot label + ✓/≠ Compare-loadout diff indicator, shared by both the Compare-mode single row
     * and the first tier row of the no-compare grouped view.
     * @param {HTMLElement} nameTd
     */
    _appendSlotLabelWithDiff(nameTd, slotName, loadoutItemHrid, optimalItemHrid, loadoutEntry) {
        const slotLabel = document.createElement('span');
        slotLabel.style.cssText =
            'font-size: 10px; color: rgba(255,255,255,0.38); text-transform: uppercase; letter-spacing: 0.04em;';
        slotLabel.textContent = slotName;
        nameTd.appendChild(slotLabel);

        if (loadoutItemHrid === null) return;
        const enhStr = ` +${loadoutEntry.enhancementLevel}`;
        const indicator = document.createElement('span');
        indicator.style.cssText = 'margin-left: 6px; font-size: 10px;';
        if (loadoutItemHrid === optimalItemHrid) {
            indicator.textContent = `✓${enhStr}`;
            indicator.style.color = config.COLOR_PROFIT;
        } else {
            const loadoutName = loadoutItemHrid ? this._getItemName(loadoutItemHrid) || loadoutItemHrid : 'empty';
            indicator.textContent = `≠ ${loadoutName}${enhStr}`;
            indicator.style.color = config.COLOR_WARNING;
            indicator.style.fontStyle = 'italic';
        }
        nameTd.appendChild(indicator);
    }

    /**
     * Appends one or more <tr> for a single equipment slot: one row in Compare mode (current →
     * suggested), or one row per grouped enhancement tier with no Compare loadout selected.
     */
    _appendSlotTableRows(tbody, slotData, loadoutEntry, xpBaseline, goldBaseline, spriteUrl) {
        const loadoutItemHrid = loadoutEntry?.itemHrid ?? null;
        const optimalItemHrid = slotData.progression[slotData.progression.length - 1]?.itemHrid;
        const topBorder = 'border-top: 1px solid rgba(255,255,255,0.06);';

        if (loadoutEntry) {
            // Single-line "current → suggested" comparison, matching the Combat Sim Upgrade
            // Advisor's convention - find the first breakpoint where switching has a real gain.
            const suggestedEntry = slotData.progression.find((entry) => {
                if (!entry.itemHrid) return false;
                return entry.xpScore - xpBaseline > 0 || entry.goldScore - goldBaseline > 0;
            });

            const tr = document.createElement('tr');
            tr.style.cssText = topBorder;
            const nameTd = document.createElement('td');
            nameTd.style.cssText = 'padding: 4px 8px;';
            this._appendSlotLabelWithDiff(nameTd, slotData.name, loadoutItemHrid, optimalItemHrid, loadoutEntry);

            if (!suggestedEntry) {
                const none = document.createElement('span');
                none.style.cssText =
                    'margin-left: 8px; font-size: 11px; color: rgba(255,255,255,0.25); font-style: italic;';
                none.textContent = 'Already at optimal enhancement';
                nameTd.appendChild(none);
                tr.appendChild(nameTd);
                const restTd = document.createElement('td');
                restTd.colSpan = 6;
                tr.appendChild(restTd);
                tbody.appendChild(tr);
                return;
            }

            const sameBaseItem = suggestedEntry.itemHrid === loadoutItemHrid;
            const transition = document.createElement('span');
            transition.style.cssText = 'margin-left: 8px;';

            const fromSpan = document.createElement('span');
            fromSpan.style.cssText = 'color: rgba(255,255,255,0.5);';
            fromSpan.textContent = loadoutItemHrid
                ? sameBaseItem
                    ? `${suggestedEntry.itemName} +${loadoutEntry.enhancementLevel}`
                    : `${this._getItemName(loadoutItemHrid) || loadoutItemHrid} +${loadoutEntry.enhancementLevel}`
                : 'Empty';
            transition.appendChild(fromSpan);
            transition.appendChild(document.createTextNode(' → '));

            const toSpan = document.createElement('span');
            toSpan.style.cssText = `color: ${config.COLOR_ACCENT}; font-weight: 600;`;
            toSpan.textContent = sameBaseItem
                ? `+${suggestedEntry.enhancementLevel}`
                : `${suggestedEntry.itemName} +${suggestedEntry.enhancementLevel}`;
            this._applyRefinedTooltip(toSpan, suggestedEntry.itemHrid);
            this._applyIncompleteTooltip(toSpan, suggestedEntry.hasMissingPrice);
            transition.appendChild(toSpan);
            nameTd.appendChild(transition);
            tr.appendChild(nameTd);

            this._appendMetricCells(tr, suggestedEntry, xpBaseline, goldBaseline, spriteUrl);
            tbody.appendChild(tr);
        } else {
            // Grouped tier view (no compare selected): collapse same-item runs into one row each
            const tiers = this._groupTiers(slotData.progression);
            for (let i = 0; i < tiers.length; i++) {
                const tier = tiers[i];
                const tr = document.createElement('tr');
                if (i === 0) tr.style.cssText = topBorder;

                const nameTd = document.createElement('td');
                nameTd.style.cssText = 'padding: 4px 8px;';
                if (i === 0) {
                    const slotLabel = document.createElement('span');
                    slotLabel.style.cssText =
                        'font-size: 10px; color: rgba(255,255,255,0.38); text-transform: uppercase; ' +
                        'letter-spacing: 0.04em; margin-right: 8px;';
                    slotLabel.textContent = slotData.name;
                    nameTd.appendChild(slotLabel);
                }

                const isLast = i === tiers.length - 1;
                const range = document.createElement('span');
                range.style.cssText = 'color: rgba(255,255,255,0.35); margin-right: 6px;';
                range.textContent = isLast ? `+${tier.fromLevel}+` : `+${tier.fromLevel}–+${tier.toLevel}`;
                nameTd.appendChild(range);

                const nameSpan = document.createElement('span');
                nameSpan.style.cssText = `color: ${i === 0 ? 'rgba(255,255,255,0.85)' : config.COLOR_ACCENT}; font-weight: ${i > 0 ? '600' : '400'};`;
                nameSpan.textContent = tier.itemName;
                this._applyRefinedTooltip(nameSpan, tier.itemHrid);
                this._applyIncompleteTooltip(nameSpan, tier.hasMissingPrice);
                nameTd.appendChild(nameSpan);
                tr.appendChild(nameTd);

                this._appendMetricCells(tr, tier, xpBaseline, goldBaseline, spriteUrl);
                tbody.appendChild(tr);
            }
        }
    }

    /**
     * Refined items (name ending in ★) have higher base stats than their non-refined
     * counterparts, so a lower enhancement level can legitimately beat a higher-level
     * non-refined item - flag that with a tooltip rather than leaving the star unexplained.
     * @param {HTMLElement} nameEl
     * @param {string|null} itemHrid
     */
    _applyRefinedTooltip(nameEl, itemHrid) {
        if (!itemHrid?.includes('_refined')) return;
        nameEl.title =
            'Refined item: has higher base stats than its non-refined counterpart, so a lower ' +
            'enhancement level can still outperform a higher-level non-refined item.';
        nameEl.style.cursor = 'help';
        nameEl.style.borderBottom = '1px dotted rgba(255,255,255,0.35)';
    }

    /**
     * FAIL C / OPT-27: a required market price for this recommendation is unresolved, so its score
     * is incomplete - not a verified exact ranking. Mirrors the existing Results "(incomplete)"
     * wording (_makeStat) rather than silently presenting an unresolved-price score as exact.
     * @param {HTMLElement} nameEl
     * @param {boolean} hasMissingPrice
     */
    _applyIncompleteTooltip(nameEl, hasMissingPrice) {
        if (!hasMissingPrice) return;
        nameEl.textContent += ' (incomplete)';
        nameEl.title = 'A required market price is unresolved, so this recommendation is not an exact ranking.';
        nameEl.style.cursor = 'help';
        nameEl.style.color = config.COLOR_WARNING;
    }

    /**
     * Appends the six metric <td>s shared by every progression row: Cost, Profit Δ,
     * G/0.01% Profit, Exp/Hr Δ, G/0.01% Exp/Hr, Payback.
     * @param {HTMLElement} tr
     * @param {Object} entry - A progression entry (or grouped tier) with cost/costIsIncomplete/xpScore/goldScore
     * @param {number} xpBaseline
     * @param {number} goldBaseline
     * @param {string|null} spriteUrl
     */
    _appendMetricCells(tr, entry, xpBaseline, goldBaseline, spriteUrl) {
        const xpDelta = entry.xpScore - xpBaseline;
        const goldDelta = entry.goldScore - goldBaseline;
        const { cost, costIsIncomplete } = entry;

        tr.appendChild(this._makeCostCell(cost, costIsIncomplete, spriteUrl));
        tr.appendChild(this._makeDeltaCell(goldDelta, goldBaseline, spriteUrl));
        tr.appendChild(this._makeProfitRatioCell(goldDelta, goldBaseline, cost, costIsIncomplete));
        tr.appendChild(this._makeDeltaCell(xpDelta, xpBaseline, null));
        tr.appendChild(this._makeXpRatioCell(xpDelta, xpBaseline, cost, costIsIncomplete));
        tr.appendChild(this._makePaybackCell(cost, costIsIncomplete, goldDelta));
    }

    /**
     * @returns {HTMLElement} A <td> placeholder for a column that doesn't apply to this row
     */
    _dashCell() {
        const td = document.createElement('td');
        td.style.cssText = 'padding: 4px 8px; color: rgba(255,255,255,0.25);';
        td.textContent = '—';
        return td;
    }

    /**
     * @param {string} text
     * @param {string} styleExtra
     * @returns {HTMLElement}
     */
    _tdText(text, styleExtra = '') {
        const td = document.createElement('td');
        td.style.cssText = `padding: 4px 8px; white-space: nowrap; ${styleExtra}`;
        td.textContent = text;
        return td;
    }

    /**
     * A value with an inline coin icon (or " G" fallback text when the sprite sheet isn't found).
     * @param {string} text
     * @param {string|null} spriteUrl
     * @returns {HTMLElement}
     */
    _makeCoinValueSpan(text, spriteUrl) {
        const span = document.createElement('span');
        span.style.cssText = 'display: inline-flex; align-items: center; gap: 2px;';
        span.appendChild(document.createTextNode(text));
        if (spriteUrl) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.style.flexShrink = '0';
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `${spriteUrl}#coin`);
            svg.appendChild(use);
            span.appendChild(svg);
        } else {
            span.appendChild(document.createTextNode(' G'));
        }
        return span;
    }

    /**
     * Cost cell - shows the recommendation's gold cost, marked with '~' whenever a required
     * market price was unresolved so this cost is not exact.
     * @param {number} cost
     * @param {boolean} costIsIncomplete
     * @param {string|null} spriteUrl
     * @returns {HTMLElement}
     */
    _makeCostCell(cost, costIsIncomplete, spriteUrl) {
        if (cost <= 0 && !costIsIncomplete) return this._dashCell();
        const td = document.createElement('td');
        td.style.cssText = 'padding: 4px 8px; white-space: nowrap; color: rgba(255,255,255,0.75);';
        const span = this._makeCoinValueSpan((costIsIncomplete ? '~' : '') + formatKMB(cost), spriteUrl);
        if (costIsIncomplete) {
            span.title = 'A required market price is unresolved, so this cost is not exact.';
            span.style.cursor = 'help';
        }
        td.appendChild(span);
        return td;
    }

    /**
     * Profit Δ / Exp/Hr Δ cell - the raw gain over baseline plus a gain percentage. Shared by
     * both columns; pass a spriteUrl for the Gold column, null for the XP column (no coin icon).
     * @param {number} delta
     * @param {number} baseline
     * @param {string|null} spriteUrl
     * @returns {HTMLElement}
     */
    _makeDeltaCell(delta, baseline, spriteUrl) {
        if (!(baseline > 0 && delta > 0)) return this._dashCell();
        const pct = ((delta / baseline) * 100).toFixed(1);
        const td = document.createElement('td');
        td.style.cssText = 'padding: 4px 8px; white-space: nowrap; color: rgba(140,210,140,0.85);';
        if (spriteUrl !== null) {
            const span = this._makeCoinValueSpan(`+${formatKMB(delta)}`, spriteUrl);
            span.appendChild(document.createTextNode(` (+${pct}%)`));
            td.appendChild(span);
        } else {
            td.textContent = `+${formatKMB(delta)} (+${pct}%)`;
        }
        return td;
    }

    /**
     * "G/0.01% Exp/Hr" cell - how much gold this recommendation costs per 0.01 percentage point
     * of XP/hr gain over baseline (lower is better). Mirrors "G/0.01% Profit" below exactly -
     * previously this column showed XP/hr gained per fixed 1M gold spent, which reads as ~0-1
     * for most upgrades once XP/hr baselines are large, losing precision exactly where it
     * mattered; this fixed-percentage-of-gain framing stays meaningful regardless of scale.
     * @param {number} xpDelta
     * @param {number} xpBaseline
     * @param {number} cost
     * @param {boolean} costIsIncomplete
     * @returns {HTMLElement}
     */
    _makeXpRatioCell(xpDelta, xpBaseline, cost, costIsIncomplete) {
        if (!(cost > 0 && xpDelta > 0 && xpBaseline > 0)) return this._dashCell();
        const pctPoints = (xpDelta / xpBaseline) * 100;
        const goldPer001Pct = cost / (pctPoints / 0.01);
        const approxPrefix = costIsIncomplete ? '~' : '';
        return this._tdText(`${approxPrefix}${formatKMB(goldPer001Pct)}`, 'color: rgba(255,255,255,0.6);');
    }

    /**
     * "G/0.01% Profit" cell - how much gold this recommendation costs per 0.01 percentage point
     * of Gold/hr gain over baseline (lower is better). Same cost-per-fixed-gain formula as the
     * XP ratio column above, just against the Gold/hr baseline instead of XP/hr.
     * @param {number} goldDelta
     * @param {number} goldBaseline
     * @param {number} cost
     * @param {boolean} costIsIncomplete
     * @returns {HTMLElement}
     */
    _makeProfitRatioCell(goldDelta, goldBaseline, cost, costIsIncomplete) {
        if (!(cost > 0 && goldDelta > 0 && goldBaseline > 0)) return this._dashCell();
        const pctPoints = (goldDelta / goldBaseline) * 100;
        const goldPer001Pct = cost / (pctPoints / 0.01);
        const approxPrefix = costIsIncomplete ? '~' : '';
        return this._tdText(`${approxPrefix}${formatKMB(goldPer001Pct)}`, 'color: rgba(255,255,255,0.6);');
    }

    /**
     * Payback cell - time to break even on this recommendation's cost from its Gold/hr gain,
     * using the compact time formatter (e.g. "1y 2mo", "14d 6h") rather than timeReadable's full
     * "x Years x Months x Days" wording, which was too long for a table column.
     * @param {number} cost
     * @param {boolean} costIsIncomplete
     * @param {number} goldDelta
     * @returns {HTMLElement}
     */
    _makePaybackCell(cost, costIsIncomplete, goldDelta) {
        if (!(cost > 0 && goldDelta > 0)) return this._dashCell();
        const paybackHours = cost / goldDelta;
        const approxPrefix = costIsIncomplete ? '~' : '';
        return this._tdText(
            `${approxPrefix}${timeReadableCompact(paybackHours * 3600)}`,
            'color: rgba(255,255,255,0.6);'
        );
    }

    _groupTiers(progression) {
        const tiers = [];
        let current = null;
        for (const entry of progression) {
            if (!entry.itemHrid) {
                current = null;
                continue;
            }
            if (!current || entry.itemHrid !== current.itemHrid) {
                if (current) tiers.push(current);
                current = {
                    itemHrid: entry.itemHrid,
                    itemName: entry.itemName,
                    fromLevel: entry.enhancementLevel,
                    toLevel: entry.enhancementLevel,
                    score: entry.score,
                    hasMissingPrice: entry.hasMissingPrice,
                    xpScore: entry.xpScore,
                    goldScore: entry.goldScore,
                    cost: entry.cost,
                    costIsIncomplete: entry.costIsIncomplete,
                };
            } else {
                current.toLevel = entry.enhancementLevel;
                // Reflects the latest (highest-enhancement) breakpoint's completeness within this
                // tier, matching toLevel above.
                current.hasMissingPrice = entry.hasMissingPrice;
                current.cost = entry.cost;
                current.costIsIncomplete = entry.costIsIncomplete;
            }
        }
        if (current) tiers.push(current);
        return tiers;
    }

    _makeStat(label, value, color, isIncomplete = false) {
        const el = document.createElement('div');
        const valueText = isIncomplete ? `${formatKMB(value)} (incomplete)` : formatKMB(value);
        el.innerHTML = `
            <div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${label}</div>
            <div style="font-size:15px;font-weight:700;color:${color};">${valueText}</div>
        `;
        return el;
    }

    _makeTeaCol(label, color, teas) {
        const col = document.createElement('div');
        col.style.flex = '1';
        const h = document.createElement('div');
        h.style.cssText = `font-size:11px;font-weight:600;color:${color};margin-bottom:4px;`;
        h.textContent = label;
        col.appendChild(h);
        for (const tea of teas) {
            const row = document.createElement('div');
            row.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.8);padding:1px 0;';
            row.textContent = `• ${tea.name}`;
            col.appendChild(row);
        }
        return col;
    }

    _makeSectionHeader(text) {
        const h = document.createElement('div');
        h.style.cssText = `
            font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.4);
            text-transform: uppercase; letter-spacing: 0.06em;
            margin-bottom: 6px; padding-bottom: 4px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        `;
        h.textContent = text;
        return h;
    }

    _getItemName(hrid) {
        const gameData = window.Toolasha?.Core?.dataManager?.getInitClientData?.();
        return gameData?.itemDetailMap?.[hrid]?.name || null;
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    cleanup() {
        if (this.watcher) {
            this.watcher();
            this.watcher = null;
        }
        this._closePicker();
        this.tabBtn?.remove();
        if (this.panel) {
            unregisterFloatingPanel(this.panel);
            this.panel.remove();
        }
        this.tabBtn = null;
        this.panel = null;
        this._contentEl = null;
        this._innerPanel = null;
        this.isActive = false;
    }
}

const skillingSimulatorUI = new SkillingSimulatorUI();

export { SkillingSimulatorUI };
export default {
    name: 'Skilling Simulator',
    initialize: () => skillingSimulatorUI.initialize(),
    cleanup: () => skillingSimulatorUI.cleanup(),
};
