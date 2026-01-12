/**
 * Max Produceable Display Module
 *
 * Shows maximum craftable quantity on action panels based on current inventory.
 *
 * Example:
 * - Cheesy Sword requires: 10 Cheese, 5 Iron Bar
 * - Inventory: 120 Cheese, 65 Iron Bar
 * - Display: "Can produce: 12" (limited by 120/10 = 12)
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { calculateProductionProfit } from './production-profit.js';
import { formatKMB } from '../../utils/formatters.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';

class MaxProduceable {
    constructor() {
        this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement}
        this.unregisterObserver = null;
        this.lastCrimsonMilkCount = null; // For debugging inventory updates
        this.sortTimeout = null; // Debounce timer for sorting
    }

    /**
     * Initialize the max produceable display
     */
    initialize() {
        if (!config.getSetting('actionPanel_maxProduceable')) {
            return;
        }

        this.setupObserver();

        // Event-driven updates (no polling needed)
        dataManager.on('items_updated', () => {
            this.updateAllCounts();
        });

        dataManager.on('action_completed', () => {
            this.updateAllCounts();
        });
    }

    /**
     * Setup DOM observer to watch for action panels
     */
    setupObserver() {
        // Watch for skill action panels (in skill screen, not detail modal)
        this.unregisterObserver = domObserver.onClass(
            'MaxProduceable',
            'SkillAction_skillAction',
            (actionPanel) => {
                this.injectMaxProduceable(actionPanel);
            }
        );

        // Check for existing action panels that may already be open
        const existingPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
        existingPanels.forEach(panel => {
            this.injectMaxProduceable(panel);
        });
    }

    /**
     * Inject max produceable display into an action panel
     * @param {HTMLElement} actionPanel - The action panel element
     */
    injectMaxProduceable(actionPanel) {
        // Extract action HRID from panel
        const actionHrid = this.getActionHridFromPanel(actionPanel);

        if (!actionHrid) {
            return;
        }

        const actionDetails = dataManager.getActionDetails(actionHrid);

        // Only show for production actions with inputs
        if (!actionDetails || !actionDetails.inputItems || actionDetails.inputItems.length === 0) {
            return;
        }

        // Check if already injected
        const existingDisplay = actionPanel.querySelector('.mwi-max-produceable');
        if (existingDisplay) {
            // Re-register existing display (DOM elements may be reused across navigation)
            this.actionElements.set(actionPanel, {
                actionHrid: actionHrid,
                displayElement: existingDisplay
            });
            // Update with fresh inventory data
            this.updateCount(actionPanel);
            // Trigger debounced sort after panels are loaded
            this.scheduleSortIfEnabled();
            return;
        }

        // Create display element
        const display = document.createElement('div');
        display.className = 'mwi-max-produceable';
        display.style.cssText = `
            position: absolute;
            bottom: -65px;
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
        actionPanel.style.marginBottom = '70px';

        // Append directly to action panel with absolute positioning
        actionPanel.appendChild(display);

        // Store reference
        this.actionElements.set(actionPanel, {
            actionHrid: actionHrid,
            displayElement: display
        });

        // Initial update
        this.updateCount(actionPanel);

        // Trigger debounced sort after panels are loaded
        this.scheduleSortIfEnabled();
    }

    /**
     * Schedule a sort to run after a short delay (debounced)
     */
    scheduleSortIfEnabled() {
        if (!config.getSetting('actionPanel_sortByProfit')) {
            return;
        }

        // Clear existing timeout
        if (this.sortTimeout) {
            clearTimeout(this.sortTimeout);
        }

        // Schedule new sort after 500ms of inactivity
        this.sortTimeout = setTimeout(() => {
            this.sortPanelsByProfit();
            this.sortTimeout = null;
        }, 500);
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
     * Calculate max produceable count for an action
     * @param {string} actionHrid - The action HRID
     * @param {Array} inventory - Inventory array (optional, will fetch if not provided)
     * @returns {number|null} Max produceable count or null
     */
    calculateMaxProduceable(actionHrid, inventory = null) {
        const actionDetails = dataManager.getActionDetails(actionHrid);

        // Get inventory if not provided
        if (!inventory) {
            inventory = dataManager.getInventory();
        }

        if (!actionDetails || !inventory) {
            return null;
        }

        // Calculate max crafts per input
        const maxCraftsPerInput = actionDetails.inputItems.map(input => {
            const invItem = inventory.find(item =>
                item.itemHrid === input.itemHrid &&
                item.itemLocationHrid === '/item_locations/inventory'
            );

            const invCount = invItem?.count || 0;
            const maxCrafts = Math.floor(invCount / input.count);

            return maxCrafts;
        });

        let minCrafts = Math.min(...maxCraftsPerInput);

        // Check upgrade item (e.g., Enhancement Stones)
        if (actionDetails.upgradeItemHrid) {
            const upgradeItem = inventory.find(item =>
                item.itemHrid === actionDetails.upgradeItemHrid &&
                item.itemLocationHrid === '/item_locations/inventory'
            );

            const upgradeCount = upgradeItem?.count || 0;
            minCrafts = Math.min(minCrafts, upgradeCount);
        }

        return minCrafts;
    }

    /**
     * Update display count for a single action panel
     * @param {HTMLElement} actionPanel - The action panel element
     * @param {Array} inventory - Inventory array (optional)
     */
    async updateCount(actionPanel, inventory = null) {
        const data = this.actionElements.get(actionPanel);

        if (!data) {
            return;
        }

        const maxCrafts = this.calculateMaxProduceable(data.actionHrid, inventory);

        if (maxCrafts === null) {
            data.displayElement.style.display = 'none';
            return;
        }

        // Calculate profit/hr (if applicable)
        let profitPerHour = null;
        const actionDetails = dataManager.getActionDetails(data.actionHrid);

        if (actionDetails) {
            const gatheringTypes = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
            const productionTypes = ['/action_types/brewing', '/action_types/cooking', '/action_types/cheesesmithing', '/action_types/crafting', '/action_types/tailoring'];

            if (gatheringTypes.includes(actionDetails.type)) {
                const profitData = await calculateGatheringProfit(data.actionHrid);
                profitPerHour = profitData?.profitPerHour || null;
            } else if (productionTypes.includes(actionDetails.type)) {
                const profitData = await calculateProductionProfit(data.actionHrid);
                profitPerHour = profitData?.profitPerHour || null;
            }
        }

        // Calculate exp/hr using shared utility
        const expData = calculateExpPerHour(data.actionHrid);
        const expPerHour = expData?.expPerHour || null;

        // Store profit value for sorting
        data.profitPerHour = profitPerHour;

        // Check if we should hide actions with negative profit
        const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
        if (hideNegativeProfit && profitPerHour !== null && profitPerHour < 0) {
            // Hide the entire action panel
            actionPanel.style.display = 'none';
            return;
        } else {
            // Show the action panel (in case it was previously hidden)
            actionPanel.style.display = '';
        }

        // Color coding for "Can produce"
        let canProduceColor;
        if (maxCrafts === 0) {
            canProduceColor = config.COLOR_LOSS; // Red - can't craft
        } else if (maxCrafts < 5) {
            canProduceColor = config.COLOR_WARNING; // Orange/yellow - low materials
        } else {
            canProduceColor = config.COLOR_PROFIT; // Green - plenty of materials
        }

        // Build display HTML
        let html = `<span style="color: ${canProduceColor};">Can produce: ${maxCrafts.toLocaleString()}</span>`;

        // Add profit/hr line if available
        if (profitPerHour !== null) {
            const profitColor = profitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
            const profitSign = profitPerHour >= 0 ? '' : '-';
            html += `<br><span style="color: ${profitColor};">Profit/hr: ${profitSign}${formatKMB(Math.abs(profitPerHour))}</span>`;
        }

        // Add exp/hr line if available
        if (expPerHour !== null && expPerHour > 0) {
            html += `<br><span style="color: #fff;">Exp/hr: ${formatKMB(expPerHour)}</span>`;
        }

        data.displayElement.style.display = 'block';
        data.displayElement.innerHTML = html;
    }

    /**
     * Update all counts
     */
    async updateAllCounts() {
        // Get inventory once for all calculations (like MWIT-E does)
        const inventory = dataManager.getInventory();

        if (!inventory) {
            return;
        }

        // Clean up stale references and update valid ones
        const updatePromises = [];
        for (const actionPanel of [...this.actionElements.keys()]) {
            if (document.body.contains(actionPanel)) {
                updatePromises.push(this.updateCount(actionPanel, inventory));
            } else {
                // Panel no longer in DOM, remove from tracking
                this.actionElements.delete(actionPanel);
            }
        }

        // Wait for all updates to complete
        await Promise.all(updatePromises);

        // Sort panels if setting is enabled
        if (config.getSetting('actionPanel_sortByProfit')) {
            this.sortPanelsByProfit();
        }
    }

    /**
     * Sort action panels by profit/hr (highest first)
     */
    sortPanelsByProfit() {
        // Group panels by their parent container
        const containerMap = new Map();

        for (const [actionPanel, data] of this.actionElements.entries()) {
            if (!document.body.contains(actionPanel)) continue;

            const container = actionPanel.parentElement;
            if (!container) continue;

            if (!containerMap.has(container)) {
                containerMap.set(container, []);
            }

            // Extract profit value from the data we already have
            const profitPerHour = data.profitPerHour ?? null;

            containerMap.get(container).push({
                panel: actionPanel,
                profit: profitPerHour
            });
        }

        // Sort and reorder each container
        for (const [container, panels] of containerMap.entries()) {
            // Sort by profit (descending), null values go to end
            panels.sort((a, b) => {
                if (a.profit === null && b.profit === null) return 0;
                if (a.profit === null) return 1;
                if (b.profit === null) return -1;
                return b.profit - a.profit;
            });

            // Reorder DOM elements
            panels.forEach(({panel}) => {
                container.appendChild(panel);
            });
        }
    }

    /**
     * Disable the max produceable display
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Remove all injected elements
        document.querySelectorAll('.mwi-max-produceable').forEach(el => el.remove());
        this.actionElements.clear();
    }
}

// Create and export singleton instance
const maxProduceable = new MaxProduceable();

export default maxProduceable;
