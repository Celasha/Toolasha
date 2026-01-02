/**
 * Combat Score Display
 * Shows player gear score in a floating panel next to profile modal
 */

import config from '../../core/config.js';
import webSocketHook from '../../core/websocket.js';
import { calculateCombatScore } from './score-calculator.js';
import { numberFormatter } from '../../utils/formatters.js';

/**
 * CombatScore class manages combat score display on profiles
 */
class CombatScore {
    constructor() {
        this.isActive = false;
        this.currentPanel = null;
    }

    /**
     * Initialize combat score feature
     */
    initialize() {
        // Check if feature is enabled
        if (!config.getSetting('combatScore')) {
            return;
        }

        // Listen for profile_shared WebSocket messages
        webSocketHook.on('profile_shared', (data) => {
            this.handleProfileShared(data);
        });

        this.isActive = true;
    }

    /**
     * Handle profile_shared WebSocket message
     * @param {Object} profileData - Profile data from WebSocket
     */
    async handleProfileShared(profileData) {
        // Wait for profile panel to appear in DOM
        const profilePanel = await this.waitForProfilePanel();
        if (!profilePanel) {
            console.error('[CombatScore] Could not find profile panel');
            return;
        }

        // Find the modal container
        const modalContainer = profilePanel.closest('.Modal_modalContent__Iw0Yv') ||
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
            await new Promise(resolve => setTimeout(resolve, 100));
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
        const equipmentHiddenText = scoreData.equipmentHidden ? ' (Equipment hidden)' : '';

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
        const houseBreakdownHTML = scoreData.breakdown.houses.map(item =>
            `<div style="margin-left: 10px; font-size: 0.8rem; color: #bbb;">${item.name}: ${numberFormatter(item.value)}</div>`
        ).join('');

        // Build ability breakdown HTML
        const abilityBreakdownHTML = scoreData.breakdown.abilities.map(item =>
            `<div style="margin-left: 10px; font-size: 0.8rem; color: #bbb;">${item.name}: ${numberFormatter(item.value)}</div>`
        ).join('');

        // Build equipment breakdown HTML
        const equipmentBreakdownHTML = scoreData.breakdown.equipment.map(item =>
            `<div style="margin-left: 10px; font-size: 0.8rem; color: #bbb;">${item.name}: ${numberFormatter(item.value)}</div>`
        ).join('');

        // Create panel HTML
        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: bold; color: ${config.SCRIPT_COLOR_MAIN}; font-size: 0.9rem;">${playerName}</div>
                <span id="mwi-score-close-btn" style="
                    cursor: pointer;
                    font-size: 18px;
                    color: #aaa;
                    padding: 0 5px;
                    line-height: 1;
                " title="Close">×</span>
            </div>
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: #4CAF50;" id="mwi-score-toggle">
                + Combat Score: ${numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}
            </div>
            <div id="mwi-score-details" style="display: none; margin-left: 10px; color: #ddd;">
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
            panel.style.left = (modalRect.right + gap) + 'px';
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
                    (isCollapsed ? '- ' : '+ ') +
                    `House: ${numberFormatter(scoreData.house.toFixed(1))}`;
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
                    `Ability: ${numberFormatter(scoreData.ability.toFixed(1))}`;
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
                    (isCollapsed ? '- ' : '+ ') +
                    `Equipment: ${numberFormatter(scoreData.equipment.toFixed(1))}`;
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

        const cleanupObserver = new MutationObserver(() => {
            if (!document.body.contains(modal) || !document.querySelector('div.SharableProfile_overviewTab__W4dCV')) {
                panel.remove();
                this.currentPanel = null;
                cleanupObserver.disconnect();
            }
        });

        cleanupObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.currentPanel) {
            this.currentPanel.remove();
            this.currentPanel = null;
        }

        this.isActive = false;
    }
}

// Create and export singleton instance
const combatScore = new CombatScore();

export default combatScore;
