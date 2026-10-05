/**
 * Combat Score Display
 * Shows player gear score in a floating panel next to profile modal
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import { calculateCombatScore } from './score-calculator.js';
import { numberFormatter, formatRelativeTime } from '../../utils/formatters.js';
import {
    constructMetzCharacterExport,
    constructMetzTeamExport,
    applyLoadoutOverrideToMetzCharacter,
} from '../combat/combat-sim-export-metz.js';
import { getProfileList } from '../combat/combat-sim-export.js';
import { constructMilkonomyExport } from '../combat/milkonomy-export.js';
import { handleViewCardClick, handleViewCardFromSnapshot } from './character-card-button.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import loadoutState from '../../core/loadout-state.js';
import combatSimUI from '../combat-sim/combat-sim-ui.js';
import { buildPlayerDTOFromProfile, mapLoadoutAbilitiesToNativeSlots } from '../combat-sim/combat-sim-adapter.js';
import { buildOutlierPriceWarningIcon } from '../../utils/warning-icon.js';

// TLA-041C: stable desktop Score-panel geometry. The panel is a fixed border-box width in every
// state (loading shell, final Score, own-profile loadout buttons visible/hidden, hidden equipment,
// any name length, collapsed/expanded rows) - no content ever changes the outer panel boundary,
// which is what let the own-profile loadout buttons silently widen the panel after positioning.
const SCORE_PANEL_DESKTOP_WIDTH = 280;
const SCORE_PANEL_GAP = 8;
const SCORE_PANEL_VIEWPORT_MARGIN = 10;

/**
 * CombatScore class manages combat score display on profiles
 */
class CombatScore {
    constructor() {
        this.isActive = false;
        this.currentPanel = null;
        this.currentAbilitiesPanel = null;
        this.currentPartyExportPanel = null;
        this.isInitialized = false;
        this.profileSharedHandler = null; // Store handler reference for cleanup
        this.timerRegistry = createTimerRegistry();
        // Bumped on every new profile open; async continuations compare against the live value so
        // a stale profile's resolved Score can never overwrite a newer one (PSP-16).
        this.profileGeneration = 0;
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('combatScore', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('abilitiesTriggers', (value) => {
            if (!value && this.currentAbilitiesPanel) {
                this.currentAbilitiesPanel.remove();
                this.currentAbilitiesPanel = null;
            }
        });

        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize combat score feature
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        this.profileSharedHandler = (data) => {
            this.handleProfileShared(data);
        };

        // Listen for profile_shared WebSocket messages
        webSocketHook.on('profile_shared', this.profileSharedHandler);

        this.isActive = true;
    }

    /**
     * Handle profile_shared WebSocket message
     * @param {Object} profileData - Profile data from WebSocket
     */
    async handleProfileShared(profileData) {
        // Bumped before any await - every async continuation below (including handleProfileOpen's)
        // checks it before touching the DOM/panel, so a stale profile can never win a race.
        const generation = ++this.profileGeneration;

        // Extract character ID from profile data
        const characterId =
            profileData.profile.sharableCharacter?.id ||
            profileData.profile.characterSkills?.[0]?.characterID ||
            profileData.profile.character?.id;

        // Preserve the export-button lookup, but do not make it a visual-render prerequisite -
        // Score/panel work below must not wait on this write (TLA-041C).
        storage
            .set('currentProfileId', characterId, 'combatExport', true)
            .catch((error) => console.error('[CombatScore] Failed to store currentProfileId:', error));

        // Note: Memory cache is handled by websocket.js listener (don't duplicate here)

        // Wait for profile panel to appear in DOM
        const profilePanel = await this.waitForProfilePanel();
        if (!profilePanel) {
            console.error('[CombatScore] Could not find profile panel');
            return;
        }

        // Find the modal container - the visible OUTER native Sharable Profile modal, not the
        // inner Overview TabPanel (TLA-041C rev2 geometry fix).
        const modalContainer = this.findNativeProfileModal(profilePanel);

        if (modalContainer) {
            await this.handleProfileOpen(profileData, modalContainer, generation);
        }
    }

    /**
     * Resolve the visible OUTER native Sharable Profile modal for a given profile panel, so
     * geometry anchors to the real modal border instead of an inner content boundary.
     * @param {Element} profilePanel
     * @returns {Element|null}
     */
    findNativeProfileModal(profilePanel) {
        return (
            profilePanel.closest('div[class*="SharableProfile_modal__"]') ||
            profilePanel.closest('.Modal_modalContent__Iw0Yv') ||
            profilePanel.closest('[class*="Modal"]') ||
            profilePanel.parentElement
        );
    }

    /**
     * Wait for profile panel to appear in DOM
     * @returns {Promise<Element|null>} Profile panel element or null if timeout
     */
    async waitForProfilePanel() {
        for (let i = 0; i < 20; i++) {
            const panel = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
            if (panel) {
                return panel;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    }

    /**
     * Handle profile modal opening. Shows the Score shell (and Abilities & Triggers panel)
     * immediately, then fills in the Score asynchronously once it resolves (TLA-041C) - profile
     * paint is never blocked behind the enhancement-heavy Score calculation.
     * @param {Object} profileData - Profile data from WebSocket
     * @param {Element} modalContainer - Modal container element
     * @param {number} generation - This profile's generation, from handleProfileShared
     */
    async handleProfileOpen(profileData, modalContainer, generation) {
        try {
            // Render shell/buttons first. Do not await Score before first paint.
            const panel = this.showScorePanel(profileData, null, modalContainer);

            // Display abilities & triggers panel below profile (if enabled) - not gated behind
            // Score resolution either.
            if (config.getSetting('abilitiesTriggers')) {
                this.showAbilitiesTriggersPanel(profileData, modalContainer);
            }

            // Yield one paint before starting any remaining main-thread preparation.
            await new Promise((resolve) => requestAnimationFrame(resolve));

            const scoreData = await calculateCombatScore(profileData);

            // A newer profile opened while this one was calculating (PSP-16), or this panel was
            // closed/replaced while pending (PSP-17) - never resurrect/overwrite in either case.
            if (generation !== this.profileGeneration) return;
            if (this.currentPanel !== panel || !panel.isConnected) return;

            this.updateScorePanel(panel, profileData, scoreData, modalContainer);
        } catch (error) {
            console.error('[CombatScore] Error handling profile:', error);
        }
    }

    /**
     * Format one breakdown leaf's value for display (TLA-041C lower-bound provenance):
     * `N/A` for a leaf with no defensible price, `value+` for a positive-but-incomplete leaf,
     * plain `value` for a complete leaf. A leaf `reason` renders as a small info tooltip. A leaf
     * whose price was substituted by the market-data outlier guard also gets the warning icon.
     * @param {{value: string|null, complete: boolean, reason?: string|null, isOutlier?: boolean}} item
     * @returns {string}
     */
    formatBreakdownLeaf(item) {
        const reasonInfo = item.reason
            ? ` <span title="${item.reason.replace(/"/g, '&quot;')}" style="cursor: help; opacity: 0.7;">ⓘ</span>`
            : '';
        if (item.value === null) return `${t('combatSimUi.notAvailableLabel')}${reasonInfo}`;
        return `${item.value}${item.complete === false ? '+' : ''}${buildOutlierPriceWarningIcon(item.isOutlier)}${reasonInfo}`;
    }

    /**
     * Build one breakdown section's inner HTML from its leaves, using `formatBreakdownLeaf` for
     * lower-bound provenance (TLA-041C).
     * @param {Array} items
     * @returns {string}
     */
    buildBreakdownHTML(items) {
        return (items || [])
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${this.formatBreakdownLeaf(item)}</div>`
            )
            .join('');
    }

    /**
     * Render one category's `+ Category: value` toggle line value (TLA-041D): `value+` when the
     * category's own completeness flag is false, plain `value` when true. `N/A` with an info
     * tooltip for wholly hidden Equipment (rev2 LB-08; never a deceptive `N/A+`/`0`/`0+`) takes
     * priority over the completeness suffix since there is no defensible numeric amount at all.
     * @param {number} categoryValue
     * @param {boolean} complete
     * @param {{hidden?: boolean, hasOutlierPrice?: boolean}} [options]
     * @returns {string}
     */
    formatCategoryHeaderValue(categoryValue, complete, { hidden = false, hasOutlierPrice = false } = {}) {
        if (hidden) {
            return `${t('combatSimUi.notAvailableLabel')} <span title="${t('combatScore.hiddenEquipmentTooltip')}" style="cursor: help; opacity: 0.7;">ⓘ</span>`;
        }
        return `${numberFormatter(categoryValue.toFixed(1))}${complete === false ? '+' : ''}${hasOutlierPrice ? ' ⚠' : ''}`;
    }

    /**
     * Build the two Score toggle blocks (Combat/Skiller) and their detail sections. Returns a
     * loading placeholder (no expandable detail - there is nothing to expand yet) when `scoreData`
     * is `null` (TLA-041C shell-before-Score lifecycle).
     * @param {Object|null} scoreData
     * @returns {string}
     */
    buildScoreSectionsHTML(scoreData) {
        const scoreTooltip = t('combatScore.scoreTooltip');
        const scoreVisibility = !config.getSetting('combatScore') ? 'display: none;' : '';

        if (!scoreData) {
            return `
                <div style="font-weight: bold; margin-bottom: 8px; color: ${config.COLOR_PROFIT}; ${scoreVisibility}" id="mwi-score-toggle" title="${scoreTooltip}">
                    ${t('combatScore.combatScoreCalculatingLabel')}
                </div>
                <div style="font-weight: bold; margin-top: 12px; margin-bottom: 8px; color: ${config.COLOR_PROFIT}; ${scoreVisibility}" id="mwi-skiller-score-toggle" title="${scoreTooltip}">
                    ${t('combatScore.skillerScoreCalculatingLabel')}
                </div>
            `;
        }

        return `
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: ${config.COLOR_PROFIT}; ${scoreVisibility}" id="mwi-score-toggle" title="${scoreTooltip}">
                + ${t('combatScore.combatScoreLine', { value: `${numberFormatter(scoreData.total.toFixed(1))}${scoreData.complete === false ? '+' : ''}${buildOutlierPriceWarningIcon(scoreData.hasOutlierPrice)}` })}
            </div>
            <div id="mwi-score-details" style="display: none; margin-left: 10px; color: ${config.COLOR_TEXT_PRIMARY};">
                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-house-toggle">
                    + ${t('combatScore.houseLine', { value: this.formatCategoryHeaderValue(scoreData.house, scoreData.houseComplete, { hasOutlierPrice: scoreData.houseHasOutlierPrice }) })}
                </div>
                <div id="mwi-house-breakdown" style="display: none; margin-bottom: 6px;">
                    ${this.buildBreakdownHTML(scoreData.breakdown.houses)}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-ability-toggle">
                    + ${t('combatScore.abilityLine', { value: this.formatCategoryHeaderValue(scoreData.ability, scoreData.abilityComplete, { hasOutlierPrice: scoreData.abilityHasOutlierPrice }) })}
                </div>
                <div id="mwi-ability-breakdown" style="display: none; margin-bottom: 6px;">
                    ${this.buildBreakdownHTML(scoreData.breakdown.abilities)}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-equipment-toggle">
                    + ${t('combatScore.equipmentLine', { value: this.formatCategoryHeaderValue(scoreData.equipment, scoreData.equipmentComplete, { hidden: scoreData.equipmentHidden && !scoreData.hasEquipmentData, hasOutlierPrice: scoreData.equipmentHasOutlierPrice }) })}
                </div>
                <div id="mwi-equipment-breakdown" style="display: none; margin-bottom: 6px;">
                    ${this.buildBreakdownHTML(scoreData.breakdown.equipment)}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-shrine-toggle">
                    + ${t('combatScore.shrinesLine', { value: this.formatCategoryHeaderValue(scoreData.shrine || 0, scoreData.shrineComplete, { hasOutlierPrice: scoreData.shrineHasOutlierPrice }) })}
                </div>
                <div id="mwi-shrine-breakdown" style="display: none;">
                    ${this.buildBreakdownHTML(scoreData.breakdown.shrines)}
                </div>
            </div>

            <div style="cursor: pointer; font-weight: bold; margin-top: 12px; margin-bottom: 8px; color: ${config.COLOR_PROFIT}; ${scoreVisibility}" id="mwi-skiller-score-toggle" title="${scoreTooltip}">
                + ${t('combatScore.skillerScoreLine', { value: `${numberFormatter(scoreData.skillerTotal.toFixed(1))}${scoreData.skillerComplete === false ? '+' : ''}${buildOutlierPriceWarningIcon(scoreData.skillerHasOutlierPrice)}` })}
            </div>
            <div id="mwi-skiller-score-details" style="display: none; margin-left: 10px; color: ${config.COLOR_TEXT_PRIMARY};">
                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-skiller-house-toggle">
                    + ${t('combatScore.houseLine', { value: this.formatCategoryHeaderValue(scoreData.skillerHouse || 0, scoreData.skillerHouseComplete, { hasOutlierPrice: scoreData.skillerHouseHasOutlierPrice }) })}
                </div>
                <div id="mwi-skiller-house-breakdown" style="display: none; margin-bottom: 6px;">
                    ${this.buildBreakdownHTML(scoreData.skillerBreakdown.houses)}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-skiller-equipment-toggle">
                    + ${t('combatScore.equipmentLine', { value: this.formatCategoryHeaderValue(scoreData.skillerEquipment, scoreData.skillerEquipmentComplete, { hidden: scoreData.equipmentHidden && !scoreData.hasEquipmentData, hasOutlierPrice: scoreData.skillerEquipmentHasOutlierPrice }) })}
                </div>
                <div id="mwi-skiller-equipment-breakdown" style="display: none; margin-bottom: 6px;">
                    ${this.buildBreakdownHTML(scoreData.skillerBreakdown.equipment)}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-skiller-shrine-toggle">
                    + ${t('combatScore.shrinesLine', { value: this.formatCategoryHeaderValue(scoreData.skillerShrine || 0, scoreData.skillerShrineComplete, { hasOutlierPrice: scoreData.skillerShrineHasOutlierPrice }) })}
                </div>
                <div id="mwi-skiller-shrine-breakdown" style="display: none;">
                    ${this.buildBreakdownHTML(scoreData.skillerBreakdown.shrines)}
                </div>
            </div>
        `;
    }

    /**
     * Build the Score panel's full inner HTML for one render pass. `scoreData === null` renders
     * the loading shell (TLA-041C) - shared by `showScorePanel` (initial) and `updateScorePanel`
     * (final), so both states are guaranteed to share the same header/button markup.
     * @param {Object} profileData
     * @param {Object|null} scoreData
     * @returns {string}
     */
    buildPanelInnerHTML(profileData, scoreData) {
        const playerName = profileData.profile?.sharableCharacter?.name || t('combatScore.playerFallbackName');

        // Build View Card button HTML (only if characterCard setting is enabled)
        const viewCardButtonHTML = config.getSetting('characterCard')
            ? `<div id="mwi-view-card-wrapper" style="position: relative; display: flex; gap: 4px;">
                <button id="mwi-character-card-btn" style="
                    padding: 8px 12px;
                    background: ${config.COLOR_ACCENT};
                    color: black;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    flex: 1;
                ">${t('combatScore.viewCardButton')}</button>
                <button id="mwi-character-card-loadout-btn" style="
                    padding: 8px 10px;
                    background: ${config.COLOR_ACCENT};
                    color: black;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    display: none;
                ">▾</button>
                <div id="mwi-loadout-dropdown" style="
                    display: none;
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    background: rgba(30, 30, 30, 0.98);
                    border: 1px solid #555;
                    border-radius: 4px;
                    z-index: 10001;
                    margin-top: 2px;
                    max-height: 160px;
                    overflow-y: auto;
                "></div>
            </div>`
            : '';

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: bold; color: ${config.COLOR_ACCENT}; font-size: 0.9rem;">${playerName}</div>
                <span id="mwi-score-close-btn" style="
                    cursor: pointer;
                    font-size: 18px;
                    color: #aaa;
                    padding: 0 5px;
                    line-height: 1;
                " title="${t('combatScore.closeTooltip')}">×</span>
            </div>
            ${this.buildScoreSectionsHTML(scoreData)}
            <div id="mwi-button-container" style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
                <div id="mwi-metz-sim-wrapper" style="position: relative; display: flex; gap: 4px;">
                    <button id="mwi-metz-sim-export-btn" style="
                        padding: 8px 12px;
                        background: ${config.COLOR_ACCENT};
                        color: black;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 0.85rem;
                        flex: 1;
                    ">${t('combatScore.metzSimExportButton')}</button>
                    <button id="mwi-metz-sim-loadout-btn" style="
                        padding: 8px 10px;
                        background: ${config.COLOR_ACCENT};
                        color: black;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 0.85rem;
                        display: none;
                    ">▾</button>
                    <div id="mwi-metz-sim-loadout-dropdown" style="
                        display: none;
                        position: absolute;
                        top: 100%;
                        left: 0;
                        right: 0;
                        background: rgba(30, 30, 30, 0.98);
                        border: 1px solid #555;
                        border-radius: 4px;
                        z-index: 10001;
                        margin-top: 2px;
                        max-height: 160px;
                        overflow-y: auto;
                    "></div>
                </div>
                <button id="mwi-sim-character-btn" style="
                    padding: 8px 12px;
                    background: linear-gradient(135deg, #3a7bd5, #5f3dc4);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    width: 100%;
                ">${t('combatScore.simCharacterButton')}</button>
                <button id="mwi-milkonomy-export-btn" style="
                    padding: 8px 12px;
                    background: ${config.COLOR_ACCENT};
                    color: black;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    width: 100%;
                ">${t('combatScore.milkonomyExportButton')}</button>
                ${viewCardButtonHTML}
            </div>
        `;
    }

    /**
     * Show combat score panel next to profile. `scoreData === null` renders the loading shell
     * (TLA-041C) - callers pass the resolved Score to `updateScorePanel` once it's ready.
     * @param {Object} profileData - Profile data
     * @param {Object|null} scoreData - Calculated score data, or null for the loading shell
     * @param {Element} modalContainer - Modal container element
     * @returns {Element} the created panel, for lifecycle guard checks
     */
    showScorePanel(profileData, scoreData, modalContainer) {
        // Remove existing panel if any
        if (this.currentPanel) {
            this.currentPanel.remove();
            this.currentPanel = null;
        }

        // Create panel element - a fixed desktop border-box width in every state (TLA-041C rev2).
        // No loading/final/hidden-equipment/own-profile-button/name-length/expanded-row content is
        // ever allowed to change this outer boundary.
        const panel = document.createElement('div');
        panel.id = 'mwi-combat-score-panel';
        panel.style.cssText = `
            position: fixed;
            background: rgba(30, 30, 30, 0.98);
            border: 1px solid #444;
            border-radius: 8px;
            padding: 12px;
            box-sizing: border-box;
            width: ${SCORE_PANEL_DESKTOP_WIDTH}px;
            max-width: calc(100vw - ${SCORE_PANEL_VIEWPORT_MARGIN * 2}px);
            font-size: 0.875rem;
            z-index: ${config.Z_FLOATING_PANEL};
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        panel.innerHTML = this.buildPanelInnerHTML(profileData, scoreData);

        document.body.appendChild(panel);
        this.currentPanel = panel;

        // Position panel next to modal - the outer width above is fixed, so this never needs to
        // run again for this panel (see updateScorePanel).
        this.positionPanel(panel, modalContainer);

        // Set up event listeners
        this.setupPanelEvents(panel, modalContainer, scoreData, profileData);

        // Set up cleanup observer
        this.setupCleanupObserver(panel, modalContainer);

        return panel;
    }

    /**
     * Replace an existing (loading-shell) panel's content in place once its Score has resolved.
     * Never repositions - the panel's outer width is fixed, so nothing here can move/overlap the
     * native modal (TLA-041C).
     * @param {Element} panel
     * @param {Object} profileData
     * @param {Object} scoreData
     * @param {Element} modalContainer
     */
    updateScorePanel(panel, profileData, scoreData, modalContainer) {
        panel.innerHTML = this.buildPanelInnerHTML(profileData, scoreData);
        this.setupPanelEvents(panel, modalContainer, scoreData, profileData);
    }

    /**
     * Position panel next to the modal
     * @param {Element} panel - Score panel element
     * @param {Element} modal - Modal container element
     */
    positionPanel(panel, modal) {
        const modalRect = modal.getBoundingClientRect();
        const panelWidth = panel.getBoundingClientRect().width;
        const gap = SCORE_PANEL_GAP;

        const fitsLeft = modalRect.left - gap - panelWidth >= SCORE_PANEL_VIEWPORT_MARGIN;
        const fitsRight =
            modalRect.right + gap + panelWidth <= (window.innerWidth || Infinity) - SCORE_PANEL_VIEWPORT_MARGIN;

        if (fitsLeft) {
            panel.style.left = modalRect.left - panelWidth - gap + 'px';
        } else if (fitsRight) {
            panel.style.left = modalRect.right + gap + 'px';
        } else {
            // Neither side keeps the panel fully inside the viewport at its rendered width - shrink
            // only for viewport safety (PSP-26), never for content, and prefer the side with more
            // room.
            const leftRoom = modalRect.left - gap - SCORE_PANEL_VIEWPORT_MARGIN;
            const rightRoom = (window.innerWidth || Infinity) - SCORE_PANEL_VIEWPORT_MARGIN - modalRect.right - gap;
            if (leftRoom >= rightRoom) {
                panel.style.width = Math.max(0, leftRoom) + 'px';
                panel.style.left = SCORE_PANEL_VIEWPORT_MARGIN + 'px';
            } else {
                panel.style.width = Math.max(0, rightRoom) + 'px';
                panel.style.left = modalRect.right + gap + 'px';
            }
        }

        panel.style.top = modalRect.top + 'px';
    }

    /**
     * Set up panel event listeners
     * @param {Element} panel - Score panel element
     * @param {Element} modal - Modal container element
     * @param {Object} scoreData - Score data
     * @param {Object} profileData - Profile data from WebSocket
     */
    setupPanelEvents(panel, modal, scoreData, profileData) {
        // Close button
        const closeBtn = panel.querySelector('#mwi-score-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                panel.remove();
                this.currentPanel = null;
            });
            closeBtn.addEventListener('mouseover', () => {
                closeBtn.style.color = '#fff';
            });
            closeBtn.addEventListener('mouseout', () => {
                closeBtn.style.color = '#aaa';
            });
        }

        // Toggle main score details
        const toggleBtn = panel.querySelector('#mwi-score-toggle');
        const details = panel.querySelector('#mwi-score-details');
        if (toggleBtn && details) {
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = details.style.display === 'none';
                details.style.display = isCollapsed ? 'block' : 'none';
                toggleBtn.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.combatScoreLine', {
                        value: `${numberFormatter(scoreData.total.toFixed(1))}${scoreData.complete === false ? '+' : ''}${scoreData.hasOutlierPrice ? ' ⚠' : ''}`,
                    });
            });
        }

        // Toggle house breakdown
        const houseToggle = panel.querySelector('#mwi-house-toggle');
        const houseBreakdown = panel.querySelector('#mwi-house-breakdown');
        if (houseToggle && houseBreakdown) {
            houseToggle.addEventListener('click', () => {
                const isCollapsed = houseBreakdown.style.display === 'none';
                houseBreakdown.style.display = isCollapsed ? 'block' : 'none';
                houseToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.houseLine', {
                        value: this.formatCategoryHeaderValue(scoreData.house, scoreData.houseComplete, {
                            hasOutlierPrice: scoreData.houseHasOutlierPrice,
                        }),
                    });
            });
        }

        // Toggle ability breakdown
        const abilityToggle = panel.querySelector('#mwi-ability-toggle');
        const abilityBreakdown = panel.querySelector('#mwi-ability-breakdown');
        if (abilityToggle && abilityBreakdown) {
            abilityToggle.addEventListener('click', () => {
                const isCollapsed = abilityBreakdown.style.display === 'none';
                abilityBreakdown.style.display = isCollapsed ? 'block' : 'none';
                abilityToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.abilityLine', {
                        value: this.formatCategoryHeaderValue(scoreData.ability, scoreData.abilityComplete, {
                            hasOutlierPrice: scoreData.abilityHasOutlierPrice,
                        }),
                    });
            });
        }

        // Toggle equipment breakdown
        const equipmentToggle = panel.querySelector('#mwi-equipment-toggle');
        const equipmentBreakdown = panel.querySelector('#mwi-equipment-breakdown');
        if (equipmentToggle && equipmentBreakdown) {
            equipmentToggle.addEventListener('click', () => {
                const isCollapsed = equipmentBreakdown.style.display === 'none';
                equipmentBreakdown.style.display = isCollapsed ? 'block' : 'none';
                equipmentToggle.innerHTML =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.equipmentLine', {
                        value: this.formatCategoryHeaderValue(scoreData.equipment, scoreData.equipmentComplete, {
                            hidden: scoreData.equipmentHidden && !scoreData.hasEquipmentData,
                            hasOutlierPrice: scoreData.equipmentHasOutlierPrice,
                        }),
                    });
            });
        }

        // Toggle shrine breakdown (Combat)
        const shrineToggle = panel.querySelector('#mwi-shrine-toggle');
        const shrineBreakdown = panel.querySelector('#mwi-shrine-breakdown');
        if (shrineToggle && shrineBreakdown) {
            shrineToggle.addEventListener('click', () => {
                const isCollapsed = shrineBreakdown.style.display === 'none';
                shrineBreakdown.style.display = isCollapsed ? 'block' : 'none';
                shrineToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.shrinesLine', {
                        value: this.formatCategoryHeaderValue(scoreData.shrine || 0, scoreData.shrineComplete, {
                            hasOutlierPrice: scoreData.shrineHasOutlierPrice,
                        }),
                    });
            });
        }

        // Toggle skiller score details
        const skillerScoreToggle = panel.querySelector('#mwi-skiller-score-toggle');
        const skillerScoreDetails = panel.querySelector('#mwi-skiller-score-details');
        if (skillerScoreToggle && skillerScoreDetails) {
            skillerScoreToggle.addEventListener('click', () => {
                const isCollapsed = skillerScoreDetails.style.display === 'none';
                skillerScoreDetails.style.display = isCollapsed ? 'block' : 'none';
                skillerScoreToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.skillerScoreLine', {
                        value: `${numberFormatter(scoreData.skillerTotal.toFixed(1))}${scoreData.skillerComplete === false ? '+' : ''}${scoreData.skillerHasOutlierPrice ? ' ⚠' : ''}`,
                    });
            });
        }

        // Toggle skiller house breakdown
        const skillerHouseToggle = panel.querySelector('#mwi-skiller-house-toggle');
        const skillerHouseBreakdown = panel.querySelector('#mwi-skiller-house-breakdown');
        if (skillerHouseToggle && skillerHouseBreakdown) {
            skillerHouseToggle.addEventListener('click', () => {
                const isCollapsed = skillerHouseBreakdown.style.display === 'none';
                skillerHouseBreakdown.style.display = isCollapsed ? 'block' : 'none';
                skillerHouseToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.houseLine', {
                        value: this.formatCategoryHeaderValue(
                            scoreData.skillerHouse || 0,
                            scoreData.skillerHouseComplete,
                            {
                                hasOutlierPrice: scoreData.skillerHouseHasOutlierPrice,
                            }
                        ),
                    });
            });
        }

        // Toggle skiller equipment breakdown
        const skillerEquipmentToggle = panel.querySelector('#mwi-skiller-equipment-toggle');
        const skillerEquipmentBreakdown = panel.querySelector('#mwi-skiller-equipment-breakdown');
        if (skillerEquipmentToggle && skillerEquipmentBreakdown) {
            skillerEquipmentToggle.addEventListener('click', () => {
                const isCollapsed = skillerEquipmentBreakdown.style.display === 'none';
                skillerEquipmentBreakdown.style.display = isCollapsed ? 'block' : 'none';
                skillerEquipmentToggle.innerHTML =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.equipmentLine', {
                        value: this.formatCategoryHeaderValue(
                            scoreData.skillerEquipment,
                            scoreData.skillerEquipmentComplete,
                            {
                                hidden: scoreData.equipmentHidden && !scoreData.hasEquipmentData,
                                hasOutlierPrice: scoreData.skillerEquipmentHasOutlierPrice,
                            }
                        ),
                    });
            });
        }

        // Toggle skiller shrine breakdown
        const skillerShrineToggle = panel.querySelector('#mwi-skiller-shrine-toggle');
        const skillerShrineBreakdown = panel.querySelector('#mwi-skiller-shrine-breakdown');
        if (skillerShrineToggle && skillerShrineBreakdown) {
            skillerShrineToggle.addEventListener('click', () => {
                const isCollapsed = skillerShrineBreakdown.style.display === 'none';
                skillerShrineBreakdown.style.display = isCollapsed ? 'block' : 'none';
                skillerShrineToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    t('combatScore.shrinesLine', {
                        value: this.formatCategoryHeaderValue(
                            scoreData.skillerShrine || 0,
                            scoreData.skillerShrineComplete,
                            { hasOutlierPrice: scoreData.skillerShrineHasOutlierPrice }
                        ),
                    });
            });
        }

        // Metz Sim Export button
        const metzSimBtn = panel.querySelector('#mwi-metz-sim-export-btn');
        if (metzSimBtn) {
            metzSimBtn.addEventListener('click', async () => {
                await this.handleMetzSimExport(metzSimBtn);
            });
            metzSimBtn.addEventListener('mouseenter', () => {
                metzSimBtn.style.opacity = '0.8';
            });
            metzSimBtn.addEventListener('mouseleave', () => {
                metzSimBtn.style.opacity = '1';
            });
        }

        // Sim Character button - opens combat sim UI with profile data
        const simCharBtn = panel.querySelector('#mwi-sim-character-btn');
        if (simCharBtn) {
            simCharBtn.addEventListener('click', () => {
                const playerName = profileData?.profile?.sharableCharacter?.name || t('combatScore.playerFallbackName');
                const dto = buildPlayerDTOFromProfile(profileData);
                if (!dto) {
                    simCharBtn.textContent = t('combatScore.noDataStatus');
                    simCharBtn.style.background = config.COLOR_LOSS;
                    const resetTimeout = setTimeout(() => {
                        simCharBtn.textContent = t('combatScore.simCharacterButton');
                        simCharBtn.style.background = 'linear-gradient(135deg, #3a7bd5, #5f3dc4)';
                    }, 3000);
                    this.timerRegistry.registerTimeout(resetTimeout);
                    return;
                }
                combatSimUI.openWithExternalDTO(dto, playerName);
            });
            simCharBtn.addEventListener('mouseenter', () => {
                simCharBtn.style.opacity = '0.8';
            });
            simCharBtn.addEventListener('mouseleave', () => {
                simCharBtn.style.opacity = '1';
            });
        }

        // Metz Sim loadout dropdown for own character only
        const metzSimLoadoutBtn = panel.querySelector('#mwi-metz-sim-loadout-btn');
        const metzSimLoadoutDropdown = panel.querySelector('#mwi-metz-sim-loadout-dropdown');
        if (metzSimLoadoutBtn && metzSimLoadoutDropdown) {
            const profileCharId =
                profileData?.profile?.sharableCharacter?.id ||
                profileData?.profile?.characterSkills?.[0]?.characterID ||
                profileData?.profile?.character?.id;
            const isOwnCharacter = profileCharId === dataManager.getCurrentCharacterId();
            if (isOwnCharacter) {
                const allSnapshots = loadoutState
                    .getAllSnapshots()
                    .filter((snapshot) => snapshot.isUsableForCalculation);
                const combatSnapshots = allSnapshots.filter((s) => s.actionTypeHrid === '/action_types/combat');
                if (combatSnapshots.length > 0) {
                    metzSimLoadoutBtn.style.display = '';

                    metzSimLoadoutDropdown.innerHTML = combatSnapshots
                        .map(
                            (s) => `<div style="
                                display: flex;
                                align-items: center;
                                border-bottom: 1px solid #333;
                            ">
                                <div class="mwi-metz-sim-loadout-option" data-name="${s.name.replace(/"/g, '&quot;')}" style="
                                    flex: 1;
                                    min-width: 0;
                                    padding: 6px 10px;
                                    cursor: pointer;
                                    font-size: 0.8rem;
                                    color: #ddd;
                                    white-space: nowrap;
                                    overflow: hidden;
                                    text-overflow: ellipsis;
                                ">${s.name}</div>
                                <div class="mwi-metz-sim-party-export-option" data-name="${s.name.replace(/"/g, '&quot;')}" title="${t('combatScore.exportFullPartyButton')}" style="
                                    flex-shrink: 0;
                                    padding: 6px 8px;
                                    cursor: pointer;
                                    font-size: 0.8rem;
                                    color: #ddd;
                                ">👥</div>
                            </div>`
                        )
                        .join('');

                    metzSimLoadoutBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        metzSimLoadoutDropdown.style.display =
                            metzSimLoadoutDropdown.style.display === 'none' ? 'block' : 'none';
                    });
                    metzSimLoadoutBtn.addEventListener('mouseenter', () => {
                        metzSimLoadoutBtn.style.opacity = '0.8';
                    });
                    metzSimLoadoutBtn.addEventListener('mouseleave', () => {
                        metzSimLoadoutBtn.style.opacity = '1';
                    });

                    metzSimLoadoutDropdown.querySelectorAll('.mwi-metz-sim-loadout-option').forEach((opt) => {
                        opt.addEventListener('click', async () => {
                            metzSimLoadoutDropdown.style.display = 'none';
                            await this.handleMetzSimExportFromSnapshot(opt.dataset.name, metzSimBtn);
                        });
                        opt.addEventListener('mouseenter', () => {
                            opt.style.background = 'rgba(255,255,255,0.1)';
                        });
                        opt.addEventListener('mouseleave', () => {
                            opt.style.background = '';
                        });
                    });

                    metzSimLoadoutDropdown.querySelectorAll('.mwi-metz-sim-party-export-option').forEach((opt) => {
                        opt.addEventListener('click', (e) => {
                            e.stopPropagation();
                            metzSimLoadoutDropdown.style.display = 'none';
                            this.showPartyExportPreview(opt.dataset.name, metzSimLoadoutBtn);
                        });
                        opt.addEventListener('mouseenter', () => {
                            opt.style.background = 'rgba(255,255,255,0.1)';
                        });
                        opt.addEventListener('mouseleave', () => {
                            opt.style.background = '';
                        });
                    });

                    const closeMetzSimDropdown = (e) => {
                        if (!document.body.contains(metzSimLoadoutDropdown)) {
                            document.removeEventListener('click', closeMetzSimDropdown);
                            return;
                        }
                        if (!metzSimLoadoutDropdown.contains(e.target) && e.target !== metzSimLoadoutBtn) {
                            metzSimLoadoutDropdown.style.display = 'none';
                        }
                    };
                    document.addEventListener('click', closeMetzSimDropdown);
                }
            }
        }

        // Milkonomy Export button
        const milkonomyBtn = panel.querySelector('#mwi-milkonomy-export-btn');
        if (milkonomyBtn) {
            milkonomyBtn.addEventListener('click', async () => {
                await this.handleMilkonomyExport(milkonomyBtn);
            });
            milkonomyBtn.addEventListener('mouseenter', () => {
                milkonomyBtn.style.opacity = '0.8';
            });
            milkonomyBtn.addEventListener('mouseleave', () => {
                milkonomyBtn.style.opacity = '1';
            });
        }

        // View Card button
        const viewCardBtn = panel.querySelector('#mwi-character-card-btn');
        if (viewCardBtn) {
            viewCardBtn.addEventListener('click', () => {
                handleViewCardClick(profileData);
            });
            viewCardBtn.addEventListener('mouseenter', () => {
                viewCardBtn.style.opacity = '0.8';
            });
            viewCardBtn.addEventListener('mouseleave', () => {
                viewCardBtn.style.opacity = '1';
            });
        }

        // Loadout dropdown for own character only
        const loadoutBtn = panel.querySelector('#mwi-character-card-loadout-btn');
        const loadoutDropdown = panel.querySelector('#mwi-loadout-dropdown');
        if (loadoutBtn && loadoutDropdown) {
            const profileCharId =
                profileData?.profile?.sharableCharacter?.id ||
                profileData?.profile?.characterSkills?.[0]?.characterID ||
                profileData?.profile?.character?.id;
            const isOwnCharacter = profileCharId === dataManager.getCurrentCharacterId();
            if (isOwnCharacter) {
                const snapshots = loadoutState.getAllSnapshots().filter((snapshot) => snapshot.isUsableForCalculation);
                if (snapshots.length > 0) {
                    loadoutBtn.style.display = '';

                    loadoutDropdown.innerHTML = snapshots
                        .map(
                            (s) =>
                                `<div class="mwi-loadout-option" data-name="${s.name.replace(/"/g, '&quot;')}" style="
                                padding: 6px 10px;
                                cursor: pointer;
                                font-size: 0.8rem;
                                border-bottom: 1px solid #333;
                                color: #ddd;
                                white-space: nowrap;
                                overflow: hidden;
                                text-overflow: ellipsis;
                            ">${s.name}</div>`
                        )
                        .join('');

                    loadoutBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        loadoutDropdown.style.display = loadoutDropdown.style.display === 'none' ? 'block' : 'none';
                    });
                    loadoutBtn.addEventListener('mouseenter', () => {
                        loadoutBtn.style.opacity = '0.8';
                    });
                    loadoutBtn.addEventListener('mouseleave', () => {
                        loadoutBtn.style.opacity = '1';
                    });

                    loadoutDropdown.querySelectorAll('.mwi-loadout-option').forEach((opt) => {
                        opt.addEventListener('click', () => {
                            handleViewCardFromSnapshot(opt.dataset.name);
                            loadoutDropdown.style.display = 'none';
                        });
                        opt.addEventListener('mouseenter', () => {
                            opt.style.background = 'rgba(255,255,255,0.1)';
                        });
                        opt.addEventListener('mouseleave', () => {
                            opt.style.background = '';
                        });
                    });

                    const closeDropdown = (e) => {
                        if (!document.body.contains(loadoutDropdown)) {
                            document.removeEventListener('click', closeDropdown);
                            return;
                        }
                        if (!loadoutDropdown.contains(e.target) && e.target !== loadoutBtn) {
                            loadoutDropdown.style.display = 'none';
                        }
                    };
                    document.addEventListener('click', closeDropdown);
                }
            }
        }
    }

    /**
     * Show abilities & triggers panel below profile
     * @param {Object} profileData - Profile data
     * @param {Element} modalContainer - Modal container element
     */
    showAbilitiesTriggersPanel(profileData, modalContainer) {
        // Remove existing abilities panel if any
        if (this.currentAbilitiesPanel) {
            this.currentAbilitiesPanel.remove();
            this.currentAbilitiesPanel = null;
        }

        // Build abilities and triggers HTML
        const abilitiesTriggersHTML = this.buildAbilitiesTriggersHTML(profileData);

        // Don't show panel if no data
        if (!abilitiesTriggersHTML) {
            return;
        }

        const playerName = profileData.profile?.sharableCharacter?.name || t('combatScore.playerFallbackName');

        // Create panel element
        const panel = document.createElement('div');
        panel.id = 'mwi-abilities-triggers-panel';
        panel.style.cssText = `
            position: fixed;
            background: rgba(30, 30, 30, 0.98);
            border: 1px solid #444;
            border-radius: 8px;
            padding: 12px;
            min-width: 300px;
            max-width: 400px;
            max-height: 200px;
            font-size: 0.875rem;
            z-index: ${config.Z_FLOATING_PANEL};
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
        `;

        // Create panel HTML
        panel.innerHTML = `
            <div id="mwi-abilities-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-shrink: 0; cursor: move; user-select: none;">
                <div style="font-weight: bold; color: ${config.COLOR_ACCENT}; font-size: 0.9rem;">${t('combatScore.abilitiesTriggersPanelTitle', { playerName })}</div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span id="mwi-abilities-expand-btn" style="
                        cursor: pointer;
                        font-size: 14px;
                        color: #aaa;
                        padding: 0 5px;
                        line-height: 1;
                        user-select: none;
                    " title="${t('combatScore.expandCollapseTooltip')}">⤢</span>
                    <span id="mwi-abilities-close-btn" style="
                        cursor: pointer;
                        font-size: 18px;
                        color: #aaa;
                        padding: 0 5px;
                        line-height: 1;
                    " title="${t('combatScore.closeTooltip')}">×</span>
                </div>
            </div>
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: ${config.COLOR_ACCENT}; flex-shrink: 0;" id="mwi-abilities-toggle">
                + ${t('combatScore.showDetailsLabel')}
            </div>
            <div id="mwi-abilities-details" style="display: none; overflow-y: auto; flex: 1; min-height: 0;">
                ${abilitiesTriggersHTML}
            </div>
        `;

        document.body.appendChild(panel);
        this.currentAbilitiesPanel = panel;

        // Position panel below modal
        this.positionAbilitiesPanel(panel, modalContainer);

        // Set up event listeners
        this.setupAbilitiesPanelEvents(panel);

        // Set up cleanup observer
        this.setupAbilitiesCleanupObserver(panel, modalContainer);
    }

    /**
     * Position abilities panel below the modal
     * @param {Element} panel - Abilities panel element
     * @param {Element} modal - Modal container element
     */
    positionAbilitiesPanel(panel, modal) {
        const modalRect = modal.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const panelWidth = panel.offsetWidth || 300;
        const panelHeight = panel.offsetHeight || 200;

        // Center panel horizontally under modal
        const modalCenter = modalRect.left + modalRect.width / 2;
        const panelLeft = modalCenter - panelWidth / 2;
        panel.style.left = Math.max(10, panelLeft) + 'px';

        // Anchor to bottom of screen
        const bottomGap = 10;
        panel.style.top = Math.max(10, viewportHeight - panelHeight - bottomGap) + 'px';
    }

    /**
     * Set up abilities panel event listeners
     * @param {Element} panel - Abilities panel element
     */
    setupAbilitiesPanelEvents(panel) {
        // Close button
        const closeBtn = panel.querySelector('#mwi-abilities-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                panel.remove();
                this.currentAbilitiesPanel = null;
            });
            closeBtn.addEventListener('mouseover', () => {
                closeBtn.style.color = '#fff';
            });
            closeBtn.addEventListener('mouseout', () => {
                closeBtn.style.color = '#aaa';
            });
        }

        // Expand / collapse button
        const expandBtn = panel.querySelector('#mwi-abilities-expand-btn');
        const toggleBtn = panel.querySelector('#mwi-abilities-toggle');
        const details = panel.querySelector('#mwi-abilities-details');
        if (expandBtn) {
            let expanded = false;
            expandBtn.addEventListener('click', () => {
                expanded = !expanded;
                panel.style.maxHeight = expanded ? 'none' : '200px';
                expandBtn.textContent = expanded ? '⤡' : '⤢';
                expandBtn.title = expanded ? t('combatScore.collapseLabel') : t('combatScore.expandLabel');

                if (expanded && details && details.style.display === 'none') {
                    details.style.display = 'block';
                    if (toggleBtn) toggleBtn.textContent = '- ' + t('combatScore.hideDetailsLabel');
                }

                // Anchor bottom of panel to bottom of screen
                requestAnimationFrame(() => {
                    panel.style.top = Math.max(10, window.innerHeight - panel.offsetHeight - 10) + 'px';
                });
            });
            expandBtn.addEventListener('mouseover', () => {
                expandBtn.style.color = '#fff';
            });
            expandBtn.addEventListener('mouseout', () => {
                expandBtn.style.color = '#aaa';
            });
        }

        // Toggle details
        if (toggleBtn && details) {
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = details.style.display === 'none';
                details.style.display = isCollapsed ? 'block' : 'none';
                toggleBtn.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    (isCollapsed ? t('combatScore.hideDetailsLabel') : t('combatScore.showDetailsLabel'));
                // Re-anchor to bottom after size change
                requestAnimationFrame(() => {
                    const bottomGap = 10;
                    panel.style.top = Math.max(10, window.innerHeight - panel.offsetHeight - bottomGap) + 'px';
                });
            });
        }

        // Drag to move
        const header = panel.querySelector('#mwi-abilities-header');
        if (header) {
            const dragOffset = { x: 0, y: 0 };
            const onMove = (e) => {
                panel.style.left = e.clientX - dragOffset.x + 'px';
                panel.style.top = e.clientY - dragOffset.y + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            header.addEventListener('mousedown', (e) => {
                if (e.target.id === 'mwi-abilities-close-btn') return;
                dragOffset.x = e.clientX - panel.offsetLeft;
                dragOffset.y = e.clientY - panel.offsetTop;
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }

    /**
     * Set up cleanup observer for abilities panel
     * @param {Element} panel - Abilities panel element
     * @param {Element} modal - Modal container element
     */
    setupAbilitiesCleanupObserver(panel, modal) {
        // Defensive check for document.body
        if (!document.body) {
            console.warn('[Combat Score] document.body not available for abilities cleanup observer');
            return;
        }

        const cleanupObserver = createMutationWatcher(
            document.body,
            () => {
                if (
                    !document.body.contains(modal) ||
                    !document.querySelector('div.SharableProfile_overviewTab__W4dCV')
                ) {
                    panel.remove();
                    this.currentAbilitiesPanel = null;
                    cleanupObserver();
                }
            },
            {
                childList: true,
                subtree: true,
            }
        );
    }

    /**
     * Set up cleanup observer to remove panel when modal closes
     * @param {Element} panel - Score panel element
     * @param {Element} modal - Modal container element
     */
    setupCleanupObserver(panel, modal) {
        // Defensive check for document.body
        if (!document.body) {
            console.warn('[Combat Score] document.body not available for cleanup observer');
            return;
        }

        const cleanupObserver = createMutationWatcher(
            document.body,
            () => {
                if (
                    !document.body.contains(modal) ||
                    !document.querySelector('div.SharableProfile_overviewTab__W4dCV')
                ) {
                    panel.remove();
                    this.currentPanel = null;
                    if (this.currentPartyExportPanel) {
                        this.currentPartyExportPanel.remove();
                        this.currentPartyExportPanel = null;
                    }
                    cleanupObserver();
                }
            },
            {
                childList: true,
                subtree: true,
            }
        );
    }

    /**
     * Build the applyLoadoutOverrideToMetzCharacter params for a saved loadout snapshot. Shared by
     * the solo "Metz Sim Export" loadout-dropdown flow and the "Export Full Party" flow, so both
     * resolve a snapshot's equipment/abilities/triggers/food/drinks identically.
     * @param {Object} snapshot - A usable loadoutState snapshot (from getUsableSnapshotByName)
     * @returns {{equipment: Array<Object>, abilities: Array<Object|null>, triggerMap: Object, food: Array<Object>, drinks: Array<Object>}}
     */
    buildSnapshotOverride(snapshot) {
        const clientObj = dataManager.getInitClientData();

        // Build ability level lookup from all learned abilities (not just currently equipped)
        const characterData = dataManager.characterData;
        const abilityLevelMap = {};
        for (const ab of characterData?.characterAbilities || []) {
            if (ab.abilityHrid) abilityLevelMap[ab.abilityHrid] = ab.level || 1;
        }

        // Preserve the actual saved MWI ability slots (1..5 -> native 0..4), including holes.
        const abilities = mapLoadoutAbilitiesToNativeSlots(
            snapshot.abilities,
            clientObj?.abilityDetailMap || {},
            (ability) => ({
                abilityHrid: ability.abilityHrid,
                level: abilityLevelMap[ability.abilityHrid] || 1,
            })
        );

        return {
            // Equipment is already resolved by Core Loadout State. Do not reinterpret
            // exact/highest enhancement semantics in feature consumers.
            equipment: snapshot.equipment,
            abilities,
            triggerMap: {
                ...(snapshot.abilityCombatTriggersMap || {}),
                ...(snapshot.consumableCombatTriggersMap || {}),
            },
            food: snapshot.food,
            drinks: snapshot.drinks,
        };
    }

    /**
     * Handle Metz Sim Export from a loadout snapshot
     * @param {string} snapshotName - Loadout snapshot name
     * @param {Element} button - The main export button (for visual feedback)
     */
    async handleMetzSimExportFromSnapshot(snapshotName, button) {
        const originalText = button.textContent;
        const originalBg = button.style.background;

        try {
            const snapshot = loadoutState.getUsableSnapshotByName(snapshotName);
            if (!snapshot) {
                console.error('[Combat Score] Snapshot not found:', snapshotName);
                return;
            }

            // Base character (skills, house, achievements, triggers, hasMooPass) - own character only
            const character = await constructMetzCharacterExport(null);
            if (!character) {
                button.textContent = t('combatScore.noDataStatus');
                button.style.background = `${config.COLOR_LOSS}`;
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
                return;
            }

            const overridden = applyLoadoutOverrideToMetzCharacter(character, this.buildSnapshotOverride(snapshot));

            await navigator.clipboard.writeText(JSON.stringify(overridden));

            button.textContent = t('combatScore.copiedStatus');
            button.style.background = `${config.COLOR_PROFIT}`;
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        } catch (error) {
            console.error('[Combat Score] Metz Sim snapshot export failed:', error);
            button.textContent = t('combatScore.failedStatus');
            button.style.background = `${config.COLOR_LOSS}`;
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        }
    }

    /**
     * Show the "Export Full Party" staleness preview panel for a given self loadout snapshot.
     * Lists every party slot with how long ago its cached profile was captured (or "missing" if
     * never opened), so the user can tell whether to go refresh a teammate's profile before
     * copying - rather than silently exporting stale/absent data (the concern raised about
     * reliability).
     * @param {string} snapshotName - Loadout snapshot name to use for your own slot
     * @param {Element} anchorEl - Element to position the preview panel below
     */
    async showPartyExportPreview(snapshotName, anchorEl) {
        if (this.currentPartyExportPanel) {
            this.currentPartyExportPanel.remove();
            this.currentPartyExportPanel = null;
        }

        const characterData = dataManager.characterData;
        const profileList = await getProfileList();
        const now = Date.now();

        const rows = [
            {
                name: characterData?.character?.name || t('combatScore.playerFallbackName'),
                ageLabel: t('combatScore.partyExportYouLabel'),
                missing: false,
            },
        ];

        const partySlots = characterData?.partyInfo?.partySlotMap;
        if (partySlots) {
            for (const member of Object.values(partySlots)) {
                if (!member.characterID || member.characterID === characterData.character.id) continue;
                const profile = profileList.find((p) => p.characterID === member.characterID);
                if (!profile) {
                    rows.push({
                        name: member.characterName || t('combatScore.partyExportUnknownMemberLabel'),
                        ageLabel: t('combatScore.partyExportMissingLabel'),
                        missing: true,
                    });
                } else {
                    rows.push({
                        name: profile.characterName,
                        ageLabel: t('combatScore.partyExportAgeAgoLabel', {
                            age: formatRelativeTime(now - (profile.timestamp || 0)),
                        }),
                        missing: false,
                    });
                }
            }
        }

        const panel = document.createElement('div');
        panel.id = 'mwi-party-export-panel';
        panel.style.cssText = `
            position: fixed;
            background: rgba(30, 30, 30, 0.98);
            border: 1px solid #555;
            border-radius: 6px;
            padding: 10px;
            width: 240px;
            font-size: 0.8rem;
            z-index: 10002;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        const rowsHTML = rows
            .map(
                (
                    row
                ) => `<div style="display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; color: ${row.missing ? config.COLOR_LOSS : '#ddd'};">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${row.name}</span>
                    <span style="flex-shrink: 0;">${row.ageLabel}</span>
                </div>`
            )
            .join('');

        panel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 6px; color: ${config.COLOR_ACCENT};">${t('combatScore.partyExportPreviewTitle')}</div>
            ${rowsHTML}
            <button id="mwi-party-export-copy-btn" style="
                margin-top: 8px;
                padding: 6px 10px;
                width: 100%;
                background: ${config.COLOR_ACCENT};
                color: black;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-size: 0.8rem;
            ">${t('combatScore.partyExportCopyButton')}</button>
        `;

        document.body.appendChild(panel);
        this.currentPartyExportPanel = panel;

        const anchorRect = anchorEl.getBoundingClientRect();
        panel.style.top = anchorRect.bottom + 4 + 'px';
        panel.style.left = Math.max(10, anchorRect.right - 240) + 'px';

        const copyBtn = panel.querySelector('#mwi-party-export-copy-btn');
        copyBtn.addEventListener('click', async () => {
            await this.handleExportFullParty(snapshotName, copyBtn);
        });

        const closePanel = (e) => {
            if (!document.body.contains(panel)) {
                document.removeEventListener('click', closePanel);
                return;
            }
            if (!panel.contains(e.target) && e.target !== anchorEl) {
                panel.remove();
                if (this.currentPartyExportPanel === panel) this.currentPartyExportPanel = null;
                document.removeEventListener('click', closePanel);
            }
        };
        // Deferred so the click that opened this panel doesn't also close it.
        setTimeout(() => document.addEventListener('click', closePanel), 0);
    }

    /**
     * Build the full-party Metz team export (self via the chosen loadout snapshot, teammates from
     * their cached profiles) and copy it to the clipboard as one paste-ready blob.
     * @param {string} snapshotName - Loadout snapshot name to use for your own slot
     * @param {Element} button - The "Copy" button in the preview panel (for visual feedback)
     */
    async handleExportFullParty(snapshotName, button) {
        const originalText = button.textContent;
        const originalBg = button.style.background;

        try {
            const snapshot = loadoutState.getUsableSnapshotByName(snapshotName);
            if (!snapshot) {
                console.error('[Combat Score] Snapshot not found:', snapshotName);
                return;
            }

            const team = await constructMetzTeamExport(this.buildSnapshotOverride(snapshot));
            if (!team) {
                button.textContent = t('combatScore.noDataStatus');
                button.style.background = `${config.COLOR_LOSS}`;
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
                return;
            }

            await navigator.clipboard.writeText(JSON.stringify(team));

            button.textContent = t('combatScore.copiedStatus');
            button.style.background = `${config.COLOR_PROFIT}`;
            const resetTimeout = setTimeout(() => {
                if (this.currentPartyExportPanel) {
                    this.currentPartyExportPanel.remove();
                    this.currentPartyExportPanel = null;
                }
            }, 1200);
            this.timerRegistry.registerTimeout(resetTimeout);
        } catch (error) {
            console.error('[Combat Score] Export Full Party failed:', error);
            button.textContent = t('combatScore.failedStatus');
            button.style.background = `${config.COLOR_LOSS}`;
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        }
    }

    /**
     * Handle Metz Sim Export button click
     * @param {Element} button - Button element
     */
    async handleMetzSimExport(button) {
        const originalText = button.textContent;
        const originalBg = button.style.background;

        try {
            // Get current profile ID (if viewing someone else's profile)
            const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

            const character = await constructMetzCharacterExport(currentProfileId);
            if (!character) {
                button.textContent = t('combatScore.noDataStatus');
                button.style.background = `${config.COLOR_LOSS}`;
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
                return;
            }

            await navigator.clipboard.writeText(JSON.stringify(character));

            button.textContent = t('combatScore.copiedStatus');
            button.style.background = `${config.COLOR_PROFIT}`;
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        } catch (error) {
            console.error('[Combat Score] Metz Sim export failed:', error);
            button.textContent = t('combatScore.failedStatus');
            button.style.background = `${config.COLOR_LOSS}`;
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        }
    }

    /**
     * Handle Milkonomy Export button click
     * @param {Element} button - Button element
     */
    async handleMilkonomyExport(button) {
        const originalText = button.textContent;
        const originalBg = button.style.background;

        try {
            // Get current profile ID (if viewing someone else's profile)
            const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

            // Get export data (pass profile ID if viewing external profile)
            const exportData = await constructMilkonomyExport(currentProfileId);
            if (!exportData) {
                button.textContent = t('combatScore.noDataStatus');
                button.style.background = '${config.COLOR_LOSS}';
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
                return;
            }

            const exportString = JSON.stringify(exportData);
            await navigator.clipboard.writeText(exportString);

            button.textContent = t('combatScore.copiedStatus');
            button.style.background = '${config.COLOR_PROFIT}';
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        } catch (error) {
            console.error('[Combat Score] Milkonomy export failed:', error);
            button.textContent = t('combatScore.failedStatus');
            button.style.background = '${config.COLOR_LOSS}';
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        }
    }

    /**
     * Refresh colors on existing panel
     */
    refresh() {
        if (!this.currentPanel) return;

        // Update title color
        const titleElem = this.currentPanel.querySelector('div[style*="font-weight: bold"]');
        if (titleElem) {
            titleElem.style.color = config.COLOR_ACCENT;
        }

        // Update all panel buttons
        const buttons = this.currentPanel.querySelectorAll('#mwi-button-container button');
        buttons.forEach((button) => {
            button.style.background = config.COLOR_ACCENT;
        });
    }

    /**
     * Format trigger dependency to readable text
     * @param {string} dependencyHrid - Dependency HRID
     * @returns {string} Readable dependency
     */
    formatDependency(dependencyHrid) {
        const map = {
            '/combat_trigger_dependencies/self': t('combatScore.dependencySelf'),
            '/combat_trigger_dependencies/targeted_enemy': t('combatScore.dependencyTarget'),
            '/combat_trigger_dependencies/all_enemies': t('combatScore.dependencyAllEnemies'),
            '/combat_trigger_dependencies/all_allies': t('combatScore.dependencyAllAllies'),
        };
        return map[dependencyHrid] || dependencyHrid.split('/').pop().replace(/_/g, ' ');
    }

    /**
     * Format trigger condition to readable text
     * @param {string} conditionHrid - Condition HRID
     * @returns {string} Readable condition
     */
    formatCondition(conditionHrid) {
        const map = {
            '/combat_trigger_conditions/current_hp': t('combatScore.conditionHp'),
            '/combat_trigger_conditions/missing_hp': t('combatScore.conditionMissingHp'),
            '/combat_trigger_conditions/current_mp': t('combatScore.conditionMp'),
            '/combat_trigger_conditions/missing_mp': t('combatScore.conditionMissingMp'),
            '/combat_trigger_conditions/number_of_active_units': t('combatScore.conditionActiveUnits'),
        };
        if (map[conditionHrid]) return map[conditionHrid];

        // Fallback: extract name from HRID and title case
        const name = conditionHrid.split('/').pop().replace(/_/g, ' ');
        return name
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    /**
     * Format trigger comparator to symbol
     * @param {string} comparatorHrid - Comparator HRID
     * @returns {string} Symbol or text
     */
    formatComparator(comparatorHrid) {
        const map = {
            '/combat_trigger_comparators/greater_than_equal': '≥',
            '/combat_trigger_comparators/less_than_equal': '≤',
            '/combat_trigger_comparators/greater_than': '>',
            '/combat_trigger_comparators/less_than': '<',
            '/combat_trigger_comparators/equal': '=',
            '/combat_trigger_comparators/is_active': t('combatScore.comparatorIsActive'),
            '/combat_trigger_comparators/is_inactive': t('combatScore.comparatorIsInactive'),
        };
        return map[comparatorHrid] || comparatorHrid.split('/').pop().replace(/_/g, ' ');
    }

    /**
     * Format a single trigger condition
     * @param {Object} condition - Trigger condition object
     * @returns {string} Formatted condition string
     */
    formatTriggerCondition(condition) {
        const dependency = this.formatDependency(condition.dependencyHrid);
        const conditionName = this.formatCondition(condition.conditionHrid);
        const comparator = this.formatComparator(condition.comparatorHrid);

        // Handle is_active/is_inactive specially - checked against the HRID (not the translated
        // comparator text) so this branch keeps working once formatComparator's output is localized.
        const isActivityComparator =
            condition.comparatorHrid === '/combat_trigger_comparators/is_active' ||
            condition.comparatorHrid === '/combat_trigger_comparators/is_inactive';
        if (isActivityComparator) {
            return t('combatScore.triggerConditionActive', { dependency, condition: conditionName, comparator });
        }

        return t('combatScore.triggerConditionValue', {
            dependency,
            condition: conditionName,
            comparator,
            value: condition.value,
        });
    }

    /**
     * Format array of trigger conditions (AND logic)
     * @param {Array} conditions - Array of trigger conditions
     * @returns {string} Formatted trigger string
     */
    formatTriggers(conditions) {
        if (!conditions || conditions.length === 0) return t('combatScore.noTriggerLabel');

        return conditions.map((c) => this.formatTriggerCondition(c)).join(t('combatScore.triggerAndSeparator'));
    }

    /**
     * Get the current abilities sprite URL from the DOM
     * @returns {string|null} Abilities sprite URL or null if not found
     */
    getAbilitiesSpriteUrl() {
        const abilityIcon = document.querySelector('use[href*="abilities_sprite"]');
        if (!abilityIcon) {
            return null;
        }
        const href = abilityIcon.getAttribute('href');
        return href ? href.split('#')[0] : null;
    }

    /**
     * Get the current items sprite URL from the DOM
     * @returns {string|null} Items sprite URL or null if not found
     */
    getItemsSpriteUrl() {
        const itemIcon = document.querySelector('use[href*="items_sprite"]');
        if (!itemIcon) {
            return null;
        }
        const href = itemIcon.getAttribute('href');
        return href ? href.split('#')[0] : null;
    }

    /**
     * Build abilities and triggers HTML
     * @param {Object} profileData - Profile data from WebSocket
     * @returns {string} HTML string for abilities/triggers section
     */
    buildAbilitiesTriggersHTML(profileData) {
        const abilities = profileData.profile?.equippedAbilities || [];
        const abilityTriggers = profileData.profile?.abilityCombatTriggersMap || {};
        const consumableTriggers = profileData.profile?.consumableCombatTriggersMap || {};

        if (
            abilities.length === 0 &&
            Object.keys(abilityTriggers).length === 0 &&
            Object.keys(consumableTriggers).length === 0
        ) {
            return ''; // Don't show section if no data
        }

        // Get sprite URLs
        const abilitiesSpriteUrl = this.getAbilitiesSpriteUrl();
        const itemsSpriteUrl = this.getItemsSpriteUrl();

        let html = '';

        // Build abilities section
        if (abilities.length > 0 && abilitiesSpriteUrl) {
            for (const ability of abilities) {
                const abilityIconId = ability.abilityHrid.split('/').pop();
                const triggers = abilityTriggers[ability.abilityHrid];
                const triggerText = triggers ? this.formatTriggers(triggers) : t('combatScore.noTriggerLabel');

                html += `
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <svg role="img" aria-label="${t('combatScore.abilityAriaLabel')}" style="width: 24px; height: 24px; flex-shrink: 0;">
                            <use href="${abilitiesSpriteUrl}#${abilityIconId}"></use>
                        </svg>
                        <span style="font-size: 0.75rem; color: #999; line-height: 1.3;">${triggerText}</span>
                    </div>
                `;
            }
        }

        // Build consumables section
        const consumableKeys = Object.keys(consumableTriggers);
        if (consumableKeys.length > 0 && itemsSpriteUrl) {
            if (abilities.length > 0) {
                html += `<div style="margin-top: 6px; margin-bottom: 6px; font-weight: 600; color: ${config.COLOR_TEXT_SECONDARY}; font-size: 0.85rem;">${t('combatScore.foodAndDrinksHeader')}</div>`;
            }

            for (const itemHrid of consumableKeys) {
                const itemIconId = itemHrid.split('/').pop();
                const triggers = consumableTriggers[itemHrid];
                const triggerText = triggers ? this.formatTriggers(triggers) : t('combatScore.noTriggerLabel');

                html += `
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <svg role="img" aria-label="${t('combatScore.itemAriaLabel')}" style="width: 24px; height: 24px; flex-shrink: 0;">
                            <use href="${itemsSpriteUrl}#${itemIconId}"></use>
                        </svg>
                        <span style="font-size: 0.75rem; color: #999; line-height: 1.3;">${triggerText}</span>
                    </div>
                `;
            }
        }

        return html;
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.profileSharedHandler) {
            webSocketHook.off('profile_shared', this.profileSharedHandler);
            this.profileSharedHandler = null;
        }

        this.timerRegistry.clearAll();

        if (this.currentPanel) {
            this.currentPanel.remove();
            this.currentPanel = null;
        }

        if (this.currentAbilitiesPanel) {
            this.currentAbilitiesPanel.remove();
            this.currentAbilitiesPanel = null;
        }

        if (this.currentPartyExportPanel) {
            this.currentPartyExportPanel.remove();
            this.currentPartyExportPanel = null;
        }

        this.isActive = false;
        this.isInitialized = false;
    }
}

const combatScore = new CombatScore();
combatScore.setupSettingListener();

export default combatScore;
