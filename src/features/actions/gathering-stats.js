/**
 * Gathering Stats Display Module
 *
 * Shows profit/hr and exp/hr on gathering action tiles
 * (foraging, woodcutting, milking)
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import actionPanelSort from './action-panel-sort.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { formatKMB } from '../../utils/formatters.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';

class GatheringStats {
    constructor() {
        this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement}
        this.unregisterObserver = null;
        this.itemsUpdatedHandler = null;
        this.actionCompletedHandler = null;
        this.characterSwitchingHandler = null; // Handler for character switch cleanup
        this.isInitialized = false;
        this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
        this.actionCompletedDebounceTimer = null; // Debounce timer for action_completed events
        this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
    }

    /**
     * Initialize the gathering stats display
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('actionPanel_gatheringStats')) {
            return;
        }

        this.isInitialized = true;

        // Initialize shared sort manager
        await actionPanelSort.initialize();

        this.setupObserver();

        // Store handler references for cleanup with debouncing
        this.itemsUpdatedHandler = () => {
            clearTimeout(this.itemsUpdatedDebounceTimer);
            this.itemsUpdatedDebounceTimer = setTimeout(() => {
                this.updateAllStats();
            }, this.DEBOUNCE_DELAY);
        };
        this.actionCompletedHandler = () => {
            clearTimeout(this.actionCompletedDebounceTimer);
            this.actionCompletedDebounceTimer = setTimeout(() => {
                this.updateAllStats();
            }, this.DEBOUNCE_DELAY);
        };

        this.characterSwitchingHandler = () => {
            this.clearAllReferences();
        };

        // Event-driven updates (no polling needed)
        dataManager.on('items_updated', this.itemsUpdatedHandler);
        dataManager.on('action_completed', this.actionCompletedHandler);
        dataManager.on('character_switching', this.characterSwitchingHandler);
    }

    /**
     * Setup DOM observer to watch for action panels
     */
    setupObserver() {
        // Watch for skill action panels (in skill screen, not detail modal)
        this.unregisterObserver = domObserver.onClass('GatheringStats', 'SkillAction_skillAction', (actionPanel) => {
            this.injectGatheringStats(actionPanel);
        });

        // Check for existing action panels that may already be open
        const existingPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
        existingPanels.forEach((panel) => {
            this.injectGatheringStats(panel);
        });
    }

    /**
     * Inject gathering stats display into an action panel
     * @param {HTMLElement} actionPanel - The action panel element
     */
    injectGatheringStats(actionPanel) {
        // Extract action HRID from panel
        const actionHrid = this.getActionHridFromPanel(actionPanel);

        if (!actionHrid) {
            return;
        }

        const actionDetails = dataManager.getActionDetails(actionHrid);

        // Only show for gathering actions (no inputItems)
        const gatheringTypes = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
        if (!actionDetails || !gatheringTypes.includes(actionDetails.type)) {
            return;
        }

        // Check if already injected
        const existingDisplay = actionPanel.querySelector('.mwi-gathering-stats');
        if (existingDisplay) {
            // Re-register existing display (DOM elements may be reused across navigation)
            this.actionElements.set(actionPanel, {
                actionHrid: actionHrid,
                displayElement: existingDisplay,
            });
            // Update with fresh data
            this.updateStats(actionPanel);
            // Register with shared sort manager
            actionPanelSort.registerPanel(actionPanel, actionHrid);
            // Trigger sort
            actionPanelSort.triggerSort();
            return;
        }

        // Create display element
        const display = document.createElement('div');
        display.className = 'mwi-gathering-stats';
        display.style.cssText = `
            position: absolute;
            bottom: -45px;
            left: 0;
            right: 0;
            font-size: 0.85em;
            padding: 4px 8px;
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
            z-index: 10;
        `;

        // Make sure the action panel has relative positioning and extra bottom margin
        if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
            actionPanel.style.position = 'relative';
        }
        actionPanel.style.marginBottom = '50px';

        // Append directly to action panel with absolute positioning
        actionPanel.appendChild(display);

        // Store reference
        this.actionElements.set(actionPanel, {
            actionHrid: actionHrid,
            displayElement: display,
        });

        // Register with shared sort manager
        actionPanelSort.registerPanel(actionPanel, actionHrid);

        // Initial update
        this.updateStats(actionPanel);

        // Trigger sort
        actionPanelSort.triggerSort();
    }

    /**
     * Extract action HRID from action panel
     * @param {HTMLElement} actionPanel - The action panel element
     * @returns {string|null} Action HRID or null
     */
    getActionHridFromPanel(actionPanel) {
        // Try to find action name from panel
        const nameElement = actionPanel.querySelector('div[class*="SkillAction_name"]');

        if (!nameElement) {
            return null;
        }

        const actionName = nameElement.textContent.trim();

        // Look up action by name in game data
        const initData = dataManager.getInitClientData();
        if (!initData) {
            return null;
        }

        for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
            if (action.name === actionName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Update stats display for a single action panel
     * @param {HTMLElement} actionPanel - The action panel element
     */
    async updateStats(actionPanel) {
        const data = this.actionElements.get(actionPanel);

        if (!data) {
            return;
        }

        // Calculate profit/hr
        const profitData = await calculateGatheringProfit(data.actionHrid);
        const profitPerHour = profitData?.profitPerHour || null;

        // Calculate exp/hr using shared utility
        const expData = calculateExpPerHour(data.actionHrid);
        const expPerHour = expData?.expPerHour || null;

        // Store profit value for sorting and update shared sort manager
        data.profitPerHour = profitPerHour;
        actionPanelSort.updateProfit(actionPanel, profitPerHour);

        // Check if we should hide actions with negative profit (unless pinned)
        const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
        const isPinned = actionPanelSort.isPinned(data.actionHrid);
        if (hideNegativeProfit && profitPerHour !== null && profitPerHour < 0 && !isPinned) {
            // Hide the entire action panel
            actionPanel.style.display = 'none';
            return;
        } else {
            // Show the action panel (in case it was previously hidden)
            actionPanel.style.display = '';
        }

        // Build display HTML
        let html = '';

        // Add profit/hr line if available
        if (profitPerHour !== null) {
            const profitColor = profitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
            const profitSign = profitPerHour >= 0 ? '' : '-';
            html += `<span style="color: ${profitColor};">Profit/hr: ${profitSign}${formatKMB(Math.abs(profitPerHour))}</span>`;
        }

        // Add exp/hr line if available
        if (expPerHour !== null && expPerHour > 0) {
            if (html) html += '<br>';
            html += `<span style="color: #fff;">Exp/hr: ${formatKMB(expPerHour)}</span>`;
        }

        data.displayElement.style.display = 'block';
        data.displayElement.innerHTML = html;
    }

    /**
     * Update all stats
     */
    async updateAllStats() {
        // Clean up stale references and update valid ones
        const updatePromises = [];
        for (const actionPanel of [...this.actionElements.keys()]) {
            if (document.body.contains(actionPanel)) {
                updatePromises.push(this.updateStats(actionPanel));
            } else {
                // Panel no longer in DOM - remove injected elements BEFORE deleting from Map
                const data = this.actionElements.get(actionPanel);
                if (data && data.displayElement) {
                    data.displayElement.innerHTML = ''; // Clear innerHTML to break references
                    data.displayElement.remove();
                    data.displayElement = null; // Null out reference for GC
                }
                this.actionElements.delete(actionPanel);
                actionPanelSort.unregisterPanel(actionPanel);
            }
        }

        // Wait for all updates to complete
        await Promise.all(updatePromises);

        // Trigger sort via shared manager
        actionPanelSort.triggerSort();
    }

    /**
     * Clear all DOM references to prevent memory leaks during character switch
     */
    clearAllReferences() {
        // CRITICAL: Remove injected DOM elements BEFORE clearing Maps
        // This prevents detached SVG elements from accumulating
        // Note: .remove() is safe to call even if element is already detached
        for (const [_actionPanel, data] of this.actionElements.entries()) {
            if (data.displayElement) {
                data.displayElement.innerHTML = ''; // Clear innerHTML to break event listener references
                data.displayElement.remove();
                data.displayElement = null; // Null out reference for GC
            }
        }

        // Clear all action element references (prevents detached DOM memory leak)
        this.actionElements.clear();

        // Clear shared sort manager's panel references
        actionPanelSort.clearAllPanels();
    }

    /**
     * Disable the gathering stats display
     */
    disable() {
        // Clear debounce timers
        clearTimeout(this.itemsUpdatedDebounceTimer);
        clearTimeout(this.actionCompletedDebounceTimer);
        this.itemsUpdatedDebounceTimer = null;
        this.actionCompletedDebounceTimer = null;

        if (this.itemsUpdatedHandler) {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.itemsUpdatedHandler = null;
        }
        if (this.actionCompletedHandler) {
            dataManager.off('action_completed', this.actionCompletedHandler);
            this.actionCompletedHandler = null;
        }
        if (this.characterSwitchingHandler) {
            dataManager.off('character_switching', this.characterSwitchingHandler);
            this.characterSwitchingHandler = null;
        }

        // Clear all DOM references
        this.clearAllReferences();

        // Remove DOM observer
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Remove all injected elements
        document.querySelectorAll('.mwi-gathering-stats').forEach((el) => el.remove());
        this.actionElements.clear();

        this.isInitialized = false;
    }
}

const gatheringStats = new GatheringStats();

export default gatheringStats;
