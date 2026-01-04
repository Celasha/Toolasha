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

class MaxProduceable {
    constructor() {
        this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement}
        this.updateTimer = null;
        this.unregisterObserver = null;
    }

    /**
     * Initialize the max produceable display
     */
    initialize() {
        if (!config.getSetting('actionPanel_maxProduceable')) {
            return;
        }

        this.setupObserver();
        this.startUpdates();

        // Listen for inventory changes
        dataManager.on('inventory_updated', () => this.updateAllCounts());
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
        if (actionPanel.querySelector('.mwi-max-produceable')) {
            return;
        }

        // Create display element
        const display = document.createElement('div');
        display.className = 'mwi-max-produceable';
        display.style.cssText = `
            font-size: 0.85em;
            margin-top: 4px;
            padding: 4px 8px;
            text-align: center;
            border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
        `;

        // Insert at bottom of action panel
        actionPanel.appendChild(display);

        // Store reference
        this.actionElements.set(actionPanel, {
            actionHrid: actionHrid,
            displayElement: display
        });

        // Initial update
        this.updateCount(actionPanel);
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
     * @returns {number|null} Max produceable count or null
     */
    calculateMaxProduceable(actionHrid) {
        const actionDetails = dataManager.getActionDetails(actionHrid);
        const inventory = dataManager.getInventory();

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
            return Math.floor(invCount / input.count);
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
     */
    updateCount(actionPanel) {
        const data = this.actionElements.get(actionPanel);

        if (!data) {
            return;
        }

        const maxCrafts = this.calculateMaxProduceable(data.actionHrid);

        if (maxCrafts === null) {
            data.displayElement.style.display = 'none';
            return;
        }

        // Color coding
        let color;
        if (maxCrafts === 0) {
            color = config.COLOR_LOSS; // Red - can't craft
        } else if (maxCrafts < 5) {
            color = config.COLOR_WARNING; // Orange/yellow - low materials
        } else {
            color = config.COLOR_PROFIT; // Green - plenty of materials
        }

        data.displayElement.style.display = 'block';
        data.displayElement.innerHTML = `<span style="color: ${color};">Can produce: ${maxCrafts.toLocaleString()}</span>`;
    }

    /**
     * Update all counts
     */
    updateAllCounts() {
        for (const actionPanel of this.actionElements.keys()) {
            this.updateCount(actionPanel);
        }
    }

    /**
     * Start periodic updates
     */
    startUpdates() {
        // Update every 2 seconds
        this.updateTimer = setInterval(() => {
            this.updateAllCounts();
        }, 2000);
    }

    /**
     * Disable the max produceable display
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }

        // Remove all injected elements
        document.querySelectorAll('.mwi-max-produceable').forEach(el => el.remove());
        this.actionElements.clear();
    }
}

// Create and export singleton instance
const maxProduceable = new MaxProduceable();

export default maxProduceable;
