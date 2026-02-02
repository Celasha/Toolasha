/**
 * Combat Score Display
 * Shows player gear score in a floating panel next to profile modal
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import { calculateCombatScore } from './score-calculator.js';
import { numberFormatter } from '../../utils/formatters.js';
import { constructExportObject } from '../combat/combat-sim-export.js';
import { clearCurrentProfile } from '../combat/profile-cache.js';
import { constructMilkonomyExport } from '../combat/milkonomy-export.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * CombatScore class manages combat score display on profiles
 */
class CombatScore {
    constructor() {
        this.isActive = false;
        this.currentPanel = null;
        this.isInitialized = false;
        this.profileSharedHandler = null; // Store handler reference for cleanup
        this.timerRegistry = createTimerRegistry();
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

        if (!config.getSetting('combatScore')) {
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
        // Extract character ID from profile data
        const characterId =
            profileData.profile.sharableCharacter?.id ||
            profileData.profile.characterSkills?.[0]?.characterID ||
            profileData.profile.character?.id;

        // Store the profile ID so export button can find it
        await storage.set('currentProfileId', characterId, 'combatExport', true);

        // Note: Memory cache is handled by websocket.js listener (don't duplicate here)

        // Wait for profile panel to appear in DOM
        const profilePanel = await this.waitForProfilePanel();
        if (!profilePanel) {
            console.error('[CombatScore] Could not find profile panel');
            return;
        }

        // Find the modal container
        const modalContainer =
            profilePanel.closest('.Modal_modalContent__Iw0Yv') ||
            profilePanel.closest('[class*="Modal"]') ||
            profilePanel.parentElement;

        if (modalContainer) {
            await this.handleProfileOpen(profileData, modalContainer);
        }
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
     * Handle profile modal opening
     * @param {Object} profileData - Profile data from WebSocket
     * @param {Element} modalContainer - Modal container element
     */
    async handleProfileOpen(profileData, modalContainer) {
        try {
            // Calculate combat score
            const scoreData = await calculateCombatScore(profileData);

            // Display score panel
            this.showScorePanel(profileData, scoreData, modalContainer);
        } catch (error) {
            console.error('[CombatScore] Error handling profile:', error);
        }
    }

    /**
     * Show combat score panel next to profile
     * @param {Object} profileData - Profile data
     * @param {Object} scoreData - Calculated score data
     * @param {Element} modalContainer - Modal container element
     */
    showScorePanel(profileData, scoreData, modalContainer) {
        // Remove existing panel if any
        if (this.currentPanel) {
            this.currentPanel.remove();
            this.currentPanel = null;
        }

        const playerName = profileData.profile?.sharableCharacter?.name || 'Player';
        const equipmentHiddenText =
            scoreData.equipmentHidden && !scoreData.hasEquipmentData ? ' (Equipment hidden)' : '';

        // Create panel element
        const panel = document.createElement('div');
        panel.id = 'mwi-combat-score-panel';
        panel.style.cssText = `
            position: fixed;
            background: rgba(30, 30, 30, 0.98);
            border: 1px solid #444;
            border-radius: 8px;
            padding: 12px;
            min-width: 180px;
            max-width: 280px;
            font-size: 0.875rem;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Build house breakdown HTML
        const houseBreakdownHTML = scoreData.breakdown.houses
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${numberFormatter(item.value)}</div>`
            )
            .join('');

        // Build ability breakdown HTML
        const abilityBreakdownHTML = scoreData.breakdown.abilities
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${numberFormatter(item.value)}</div>`
            )
            .join('');

        // Build equipment breakdown HTML
        const equipmentBreakdownHTML = scoreData.breakdown.equipment
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${numberFormatter(item.value)}</div>`
            )
            .join('');

        // Create panel HTML
        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: bold; color: ${config.COLOR_ACCENT}; font-size: 0.9rem;">${playerName}</div>
                <span id="mwi-score-close-btn" style="
                    cursor: pointer;
                    font-size: 18px;
                    color: #aaa;
                    padding: 0 5px;
                    line-height: 1;
                " title="Close">×</span>
            </div>
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: ${config.COLOR_PROFIT};" id="mwi-score-toggle">
                + Combat Score: ${numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}
            </div>
            <div id="mwi-score-details" style="display: none; margin-left: 10px; color: ${config.COLOR_TEXT_PRIMARY};">
                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-house-toggle">
                    + House: ${numberFormatter(scoreData.house.toFixed(1))}
                </div>
                <div id="mwi-house-breakdown" style="display: none; margin-bottom: 6px;">
                    ${houseBreakdownHTML}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-ability-toggle">
                    + Ability: ${numberFormatter(scoreData.ability.toFixed(1))}
                </div>
                <div id="mwi-ability-breakdown" style="display: none; margin-bottom: 6px;">
                    ${abilityBreakdownHTML}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-equipment-toggle">
                    + Equipment: ${numberFormatter(scoreData.equipment.toFixed(1))}
                </div>
                <div id="mwi-equipment-breakdown" style="display: none;">
                    ${equipmentBreakdownHTML}
                </div>
            </div>
            <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
                <button id="mwi-combat-sim-export-btn" style="
                    padding: 8px 12px;
                    background: ${config.COLOR_ACCENT};
                    color: black;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    width: 100%;
                ">Combat Sim Export</button>
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
                ">Milkonomy Export</button>
            </div>
        `;

        document.body.appendChild(panel);
        this.currentPanel = panel;

        // Position panel next to modal
        this.positionPanel(panel, modalContainer);

        // Set up event listeners
        this.setupPanelEvents(panel, modalContainer, scoreData, equipmentHiddenText);

        // Set up cleanup observer
        this.setupCleanupObserver(panel, modalContainer);
    }

    /**
     * Position panel next to the modal
     * @param {Element} panel - Score panel element
     * @param {Element} modal - Modal container element
     */
    positionPanel(panel, modal) {
        const modalRect = modal.getBoundingClientRect();
        const panelWidth = 220;
        const gap = 8;

        // Try right side first
        if (modalRect.right + gap + panelWidth < window.innerWidth) {
            panel.style.left = modalRect.right + gap + 'px';
        } else {
            // Fall back to left side
            panel.style.left = Math.max(10, modalRect.left - panelWidth - gap) + 'px';
        }

        panel.style.top = modalRect.top + 'px';
    }

    /**
     * Set up panel event listeners
     * @param {Element} panel - Score panel element
     * @param {Element} modal - Modal container element
     * @param {Object} scoreData - Score data
     * @param {string} equipmentHiddenText - Equipment hidden text
     */
    setupPanelEvents(panel, modal, scoreData, equipmentHiddenText) {
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
                    `Combat Score: ${numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}`;
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
                    (isCollapsed ? '- ' : '+ ') + `House: ${numberFormatter(scoreData.house.toFixed(1))}`;
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
                    (isCollapsed ? '- ' : '+ ') + `Ability: ${numberFormatter(scoreData.ability.toFixed(1))}`;
            });
        }

        // Toggle equipment breakdown
        const equipmentToggle = panel.querySelector('#mwi-equipment-toggle');
        const equipmentBreakdown = panel.querySelector('#mwi-equipment-breakdown');
        if (equipmentToggle && equipmentBreakdown) {
            equipmentToggle.addEventListener('click', () => {
                const isCollapsed = equipmentBreakdown.style.display === 'none';
                equipmentBreakdown.style.display = isCollapsed ? 'block' : 'none';
                equipmentToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') + `Equipment: ${numberFormatter(scoreData.equipment.toFixed(1))}`;
            });
        }

        // Combat Sim Export button
        const combatSimBtn = panel.querySelector('#mwi-combat-sim-export-btn');
        if (combatSimBtn) {
            combatSimBtn.addEventListener('click', async () => {
                await this.handleCombatSimExport(combatSimBtn);
            });
            combatSimBtn.addEventListener('mouseenter', () => {
                combatSimBtn.style.opacity = '0.8';
            });
            combatSimBtn.addEventListener('mouseleave', () => {
                combatSimBtn.style.opacity = '1';
            });
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
     * Handle Combat Sim Export button click
     * @param {Element} button - Button element
     */
    async handleCombatSimExport(button) {
        const originalText = button.textContent;
        const originalBg = button.style.background;

        try {
            // Get current profile ID (if viewing someone else's profile)
            const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

            // Get export data in single-player format (for pasting into "Player 1 import" field)
            const exportData = await constructExportObject(currentProfileId, true);
            if (!exportData) {
                button.textContent = '✗ No Data';
                button.style.background = '${config.COLOR_LOSS}';
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
                return;
            }

            const exportString = JSON.stringify(exportData.exportObj);
            await navigator.clipboard.writeText(exportString);

            button.textContent = '✓ Copied';
            button.style.background = '${config.COLOR_PROFIT}';
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        } catch (error) {
            console.error('[Combat Score] Combat Sim export failed:', error);
            button.textContent = '✗ Failed';
            button.style.background = '${config.COLOR_LOSS}';
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
            // Defensive: ensure currentProfileId is null when exporting own profile
            // This prevents stale data from blocking export
            await storage.set('currentProfileId', null, 'combatExport', true);
            clearCurrentProfile();

            // Get current profile ID (should be null for own profile)
            const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

            // Get export data (pass profile ID if viewing external profile)
            const exportData = await constructMilkonomyExport(currentProfileId);
            if (!exportData) {
                button.textContent = '✗ No Data';
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

            button.textContent = '✓ Copied';
            button.style.background = '${config.COLOR_PROFIT}';
            const resetTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalBg;
            }, 3000);
            this.timerRegistry.registerTimeout(resetTimeout);
        } catch (error) {
            console.error('[Combat Score] Milkonomy export failed:', error);
            button.textContent = '✗ Failed';
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

        // Update both export buttons
        const buttons = this.currentPanel.querySelectorAll('button[id*="export-btn"]');
        buttons.forEach((button) => {
            button.style.background = config.COLOR_ACCENT;
        });
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

        this.isActive = false;
        this.isInitialized = false;
    }
}

const combatScore = new CombatScore();
combatScore.setupSettingListener();

export default combatScore;
