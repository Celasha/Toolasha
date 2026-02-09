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
import { clearCurrentProfile } from '../../core/profile-manager.js';
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
        this.currentAbilitiesPanel = null;
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

            // Display abilities & triggers panel below profile (if enabled)
            if (config.getSetting('abilitiesTriggers')) {
                this.showAbilitiesTriggersPanel(profileData, modalContainer);
            }
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
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${item.value}</div>`
            )
            .join('');

        // Build ability breakdown HTML
        const abilityBreakdownHTML = scoreData.breakdown.abilities
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${item.value}</div>`
            )
            .join('');

        // Build equipment breakdown HTML
        const equipmentBreakdownHTML = scoreData.breakdown.equipment
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${item.value}</div>`
            )
            .join('');

        // Build skiller equipment breakdown HTML
        const skillerEquipmentBreakdownHTML = scoreData.skillerBreakdown.equipment
            .map(
                (item) =>
                    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${item.value}</div>`
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

            <div style="cursor: pointer; font-weight: bold; margin-top: 12px; margin-bottom: 8px; color: ${config.COLOR_PROFIT};" id="mwi-skiller-score-toggle">
                + Skiller Score: ${numberFormatter(scoreData.skillerTotal.toFixed(1))}
            </div>
            <div id="mwi-skiller-score-details" style="display: none; margin-left: 10px; color: ${config.COLOR_TEXT_PRIMARY};">
                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-skiller-equipment-toggle">
                    + Equipment: ${numberFormatter(scoreData.skillerEquipment.toFixed(1))}
                </div>
                <div id="mwi-skiller-equipment-breakdown" style="display: none;">
                    ${skillerEquipmentBreakdownHTML}
                </div>
            </div>

            <div id="mwi-button-container" style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
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

        // Try left side first
        if (modalRect.left - gap - panelWidth >= 10) {
            panel.style.left = modalRect.left - panelWidth - gap + 'px';
        } else {
            // Fall back to right side
            panel.style.left = modalRect.right + gap + 'px';
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

        // Toggle skiller score details
        const skillerScoreToggle = panel.querySelector('#mwi-skiller-score-toggle');
        const skillerScoreDetails = panel.querySelector('#mwi-skiller-score-details');
        if (skillerScoreToggle && skillerScoreDetails) {
            skillerScoreToggle.addEventListener('click', () => {
                const isCollapsed = skillerScoreDetails.style.display === 'none';
                skillerScoreDetails.style.display = isCollapsed ? 'block' : 'none';
                skillerScoreToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    `Skiller Score: ${numberFormatter(scoreData.skillerTotal.toFixed(1))}`;
            });
        }

        // Toggle skiller equipment breakdown
        const skillerEquipmentToggle = panel.querySelector('#mwi-skiller-equipment-toggle');
        const skillerEquipmentBreakdown = panel.querySelector('#mwi-skiller-equipment-breakdown');
        if (skillerEquipmentToggle && skillerEquipmentBreakdown) {
            skillerEquipmentToggle.addEventListener('click', () => {
                const isCollapsed = skillerEquipmentBreakdown.style.display === 'none';
                skillerEquipmentBreakdown.style.display = isCollapsed ? 'block' : 'none';
                skillerEquipmentToggle.textContent =
                    (isCollapsed ? '- ' : '+ ') +
                    `Equipment: ${numberFormatter(scoreData.skillerEquipment.toFixed(1))}`;
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

        const playerName = profileData.profile?.sharableCharacter?.name || 'Player';

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
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
        `;

        // Create panel HTML
        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-shrink: 0;">
                <div style="font-weight: bold; color: ${config.COLOR_ACCENT}; font-size: 0.9rem;">${playerName} - Abilities & Triggers</div>
                <span id="mwi-abilities-close-btn" style="
                    cursor: pointer;
                    font-size: 18px;
                    color: #aaa;
                    padding: 0 5px;
                    line-height: 1;
                " title="Close">×</span>
            </div>
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: ${config.COLOR_ACCENT}; flex-shrink: 0;" id="mwi-abilities-toggle">
                + Show Details
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
        const gap = 8;

        // Center panel horizontally under modal
        const panelWidth = panel.offsetWidth || 300;
        const modalCenter = modalRect.left + modalRect.width / 2;
        const panelLeft = modalCenter - panelWidth / 2;

        panel.style.left = Math.max(10, panelLeft) + 'px';

        // Position below modal, but ensure it doesn't go off screen
        const topPosition = modalRect.bottom + gap;
        const viewportHeight = window.innerHeight;
        const panelHeight = panel.offsetHeight || 300;

        // If panel would go off bottom of screen, adjust position or reduce height
        if (topPosition + panelHeight > viewportHeight - 10) {
            const availableHeight = viewportHeight - topPosition - 10;
            if (availableHeight < 200) {
                // Not enough space below - position above modal instead
                panel.style.top = Math.max(10, modalRect.top - panelHeight - gap) + 'px';
            } else {
                // Limit height to fit available space
                panel.style.top = topPosition + 'px';
                panel.style.maxHeight = availableHeight + 'px';
            }
        } else {
            panel.style.top = topPosition + 'px';
        }
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

        // Toggle details
        const toggleBtn = panel.querySelector('#mwi-abilities-toggle');
        const details = panel.querySelector('#mwi-abilities-details');
        if (toggleBtn && details) {
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = details.style.display === 'none';
                details.style.display = isCollapsed ? 'block' : 'none';
                toggleBtn.textContent = (isCollapsed ? '- ' : '+ ') + (isCollapsed ? 'Hide Details' : 'Show Details');
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

        let cleanupTimeout = null;

        const cleanupObserver = createMutationWatcher(
            document.body,
            () => {
                // Debounce cleanup check to avoid false positives during React re-renders.
                // Without this, intermediate DOM states (e.g., Edge browser timing differences)
                // can cause the selector check to fail momentarily, removing the panel.
                if (cleanupTimeout) {
                    clearTimeout(cleanupTimeout);
                }
                cleanupTimeout = setTimeout(() => {
                    if (
                        !document.body.contains(modal) ||
                        !document.querySelector('div.SharableProfile_overviewTab__W4dCV')
                    ) {
                        panel.remove();
                        this.currentPanel = null;
                        cleanupObserver();
                    }
                }, 100);
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
     * Format trigger dependency to readable text
     * @param {string} dependencyHrid - Dependency HRID
     * @returns {string} Readable dependency
     */
    formatDependency(dependencyHrid) {
        const map = {
            '/combat_trigger_dependencies/self': 'Self',
            '/combat_trigger_dependencies/targeted_enemy': 'Target',
            '/combat_trigger_dependencies/all_enemies': 'All Enemies',
            '/combat_trigger_dependencies/all_allies': 'All Allies',
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
            '/combat_trigger_conditions/current_hp': 'HP',
            '/combat_trigger_conditions/missing_hp': 'Missing HP',
            '/combat_trigger_conditions/current_mp': 'MP',
            '/combat_trigger_conditions/missing_mp': 'Missing MP',
            '/combat_trigger_conditions/number_of_active_units': 'Active Units',
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
            '/combat_trigger_comparators/is_active': 'is active',
            '/combat_trigger_comparators/is_inactive': 'is inactive',
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

        // Handle is_active/is_inactive specially
        if (comparator === 'is active' || comparator === 'is inactive') {
            return `${dependency}: ${conditionName} ${comparator}`;
        }

        return `${dependency}: ${conditionName} ${comparator} ${condition.value}`;
    }

    /**
     * Format array of trigger conditions (AND logic)
     * @param {Array} conditions - Array of trigger conditions
     * @returns {string} Formatted trigger string
     */
    formatTriggers(conditions) {
        if (!conditions || conditions.length === 0) return 'No trigger';

        return conditions.map((c) => this.formatTriggerCondition(c)).join(' AND ');
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
                const triggerText = triggers ? this.formatTriggers(triggers) : 'No trigger';

                html += `
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <svg role="img" aria-label="Ability" style="width: 24px; height: 24px; flex-shrink: 0;">
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
                html += `<div style="margin-top: 6px; margin-bottom: 6px; font-weight: 600; color: ${config.COLOR_TEXT_SECONDARY}; font-size: 0.85rem;">Food & Drinks</div>`;
            }

            for (const itemHrid of consumableKeys) {
                const itemIconId = itemHrid.split('/').pop();
                const triggers = consumableTriggers[itemHrid];
                const triggerText = triggers ? this.formatTriggers(triggers) : 'No trigger';

                html += `
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <svg role="img" aria-label="Item" style="width: 24px; height: 24px; flex-shrink: 0;">
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

        this.isActive = false;
        this.isInitialized = false;
    }
}

const combatScore = new CombatScore();
combatScore.setupSettingListener();

export default combatScore;
