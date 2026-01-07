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
        this.unregisterObserver = null;
        this.lastCrimsonMilkCount = null; // For debugging inventory updates
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
            return;
        }

        // Create display element
        const display = document.createElement('div');
        display.className = 'mwi-max-produceable';
        display.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            font-size: 0.85em;
            padding: 4px 8px;
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
        `;

        // Make sure the action panel has relative positioning
        if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
            actionPanel.style.position = 'relative';
        }

        // Append directly to action panel with absolute positioning
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
    updateCount(actionPanel, inventory = null) {
        const data = this.actionElements.get(actionPanel);

        if (!data) {
            return;
        }

        const maxCrafts = this.calculateMaxProduceable(data.actionHrid, inventory);

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
        // Get inventory once for all calculations (like MWIT-E does)
        const inventory = dataManager.getInventory();

        if (!inventory) {
            return;
        }

        // Find crimson milk in inventory for debugging (only log if changed)
        const crimsonMilk = inventory.find(item => item.itemHrid === '/items/crimson_milk' && item.itemLocationHrid === '/item_locations/inventory');
        const newCount = crimsonMilk?.count || 0;
        if (!this.lastCrimsonMilkCount || this.lastCrimsonMilkCount !== newCount) {
            console.log('[MaxProduceable] Crimson milk count changed:', this.lastCrimsonMilkCount, '→', newCount);
            this.lastCrimsonMilkCount = newCount;
        }

        // Clean up stale references and update valid ones
        for (const actionPanel of [...this.actionElements.keys()]) {
            if (document.body.contains(actionPanel)) {
                this.updateCount(actionPanel, inventory);
            } else {
                // Panel no longer in DOM, remove from tracking
                this.actionElements.delete(actionPanel);
            }
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
