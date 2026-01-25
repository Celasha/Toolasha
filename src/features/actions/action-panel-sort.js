/**
 * Action Panel Sort Manager
 *
 * Centralized sorting logic for action panels.
 * Handles both profit-based sorting and pin priority.
 * Used by max-produceable and gathering-stats features.
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';

class ActionPanelSort {
    constructor() {
        this.panels = new Map(); // actionPanel → {actionHrid, profitPerHour}
        this.pinnedActions = new Set(); // Set of pinned action HRIDs
        this.sortTimeout = null; // Debounce timer
        this.initialized = false;
    }

    /**
     * Initialize - load pinned actions from storage
     */
    async initialize() {
        if (this.initialized) return;

        const pinnedData = await storage.getJSON('pinnedActions', 'settings', []);
        this.pinnedActions = new Set(pinnedData);
        this.initialized = true;
    }

    /**
     * Register a panel for sorting
     * @param {HTMLElement} actionPanel - The action panel element
     * @param {string} actionHrid - The action HRID
     * @param {number|null} profitPerHour - Profit per hour (null if not calculated yet)
     */
    registerPanel(actionPanel, actionHrid, profitPerHour = null) {
        this.panels.set(actionPanel, {
            actionHrid: actionHrid,
            profitPerHour: profitPerHour
        });
    }

    /**
     * Update profit for a registered panel
     * @param {HTMLElement} actionPanel - The action panel element
     * @param {number|null} profitPerHour - Profit per hour
     */
    updateProfit(actionPanel, profitPerHour) {
        const data = this.panels.get(actionPanel);
        if (data) {
            data.profitPerHour = profitPerHour;
        }
    }

    /**
     * Unregister a panel (cleanup when panel removed from DOM)
     * @param {HTMLElement} actionPanel - The action panel element
     */
    unregisterPanel(actionPanel) {
        this.panels.delete(actionPanel);
    }

    /**
     * Toggle pin state for an action
     * @param {string} actionHrid - Action HRID to toggle
     * @returns {boolean} New pin state
     */
    async togglePin(actionHrid) {
        if (this.pinnedActions.has(actionHrid)) {
            this.pinnedActions.delete(actionHrid);
        } else {
            this.pinnedActions.add(actionHrid);
        }

        // Save to storage
        await storage.setJSON('pinnedActions', Array.from(this.pinnedActions), 'settings', true);

        return this.pinnedActions.has(actionHrid);
    }

    /**
     * Check if action is pinned
     * @param {string} actionHrid - Action HRID
     * @returns {boolean}
     */
    isPinned(actionHrid) {
        return this.pinnedActions.has(actionHrid);
    }

    /**
     * Get all pinned actions
     * @returns {Set<string>}
     */
    getPinnedActions() {
        return this.pinnedActions;
    }

    /**
     * Clear all panel references (called during character switch to prevent memory leaks)
     */
    clearAllPanels() {
        // Clear sort timeout
        if (this.sortTimeout) {
            clearTimeout(this.sortTimeout);
            this.sortTimeout = null;
        }

        // Clear all panel references
        this.panels.clear();
    }

    /**
     * Trigger a debounced sort
     */
    triggerSort() {
        this.scheduleSortIfEnabled();
    }

    /**
     * Schedule a sort to run after a short delay (debounced)
     */
    scheduleSortIfEnabled() {
        const sortByProfitEnabled = config.getSetting('actionPanel_sortByProfit');
        const hasPinnedActions = this.pinnedActions.size > 0;

        // Only sort if either profit sorting is enabled OR there are pinned actions
        if (!sortByProfitEnabled && !hasPinnedActions) {
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
     * Sort action panels by profit/hr (highest first), with pinned actions at top
     */
    sortPanelsByProfit() {
        const sortByProfitEnabled = config.getSetting('actionPanel_sortByProfit');

        // Group panels by their parent container
        const containerMap = new Map();

        // Clean up stale panels and group by container
        for (const [actionPanel, data] of this.panels.entries()) {
            if (!document.body.contains(actionPanel)) {
                this.panels.delete(actionPanel);
                continue;
            }

            const container = actionPanel.parentElement;
            if (!container) continue;

            if (!containerMap.has(container)) {
                containerMap.set(container, []);
            }

            const isPinned = this.pinnedActions.has(data.actionHrid);
            const profitPerHour = data.profitPerHour ?? null;

            containerMap.get(container).push({
                panel: actionPanel,
                profit: profitPerHour,
                pinned: isPinned,
                originalIndex: containerMap.get(container).length,
                actionHrid: data.actionHrid
            });
        }

        // Sort and reorder each container
        for (const [container, panels] of containerMap.entries()) {
            panels.sort((a, b) => {
                // Pinned actions always come first
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;

                // Both pinned - sort by profit if enabled, otherwise by original order
                if (a.pinned && b.pinned) {
                    if (sortByProfitEnabled) {
                        if (a.profit === null && b.profit === null) return 0;
                        if (a.profit === null) return 1;
                        if (b.profit === null) return -1;
                        return b.profit - a.profit;
                    } else {
                        return a.originalIndex - b.originalIndex;
                    }
                }

                // Both unpinned - only sort by profit if setting is enabled
                if (sortByProfitEnabled) {
                    if (a.profit === null && b.profit === null) return 0;
                    if (a.profit === null) return 1;
                    if (b.profit === null) return -1;
                    return b.profit - a.profit;
                } else {
                    // Keep original order
                    return a.originalIndex - b.originalIndex;
                }
            });

            // Reorder DOM elements
            panels.forEach(({panel}) => {
                container.appendChild(panel);
            });
        }
    }
}

// Create and export singleton instance
const actionPanelSort = new ActionPanelSort();

export default actionPanelSort;
