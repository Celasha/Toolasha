/**
 * Action Panel Sort Manager
 *
 * Centralized sorting logic for action panels.
 * Handles both profit-based sorting and pin priority.
 * Used by max-produceable and gathering-stats features.
 */

import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import { dismissTooltips } from '../../utils/dom.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class ActionPanelSort {
    constructor() {
        this.panels = new Map(); // actionPanel → {actionHrid, profitPerHour, expPerHour}
        this.pinnedActions = new Set(); // Set of pinned action HRIDs
        this.sortMode = 'default'; // 'default' | 'profit' | 'xp' | 'coinsPerXp'
        this.sortTimeout = null; // Debounce timer
        this.initialized = false;
        this.timerRegistry = createTimerRegistry();
        this.handlers = {};
    }

    /**
     * Initialize - load pinned actions from storage
     */
    async initialize() {
        if (this.initialized) return;

        const pinnedData = await storage.getJSON('pinnedActions', 'settings', []);
        this.pinnedActions = new Set(pinnedData);
        this.sortMode = await storage.get('actionSortMode', 'settings', 'default');
        this.initialized = true;

        // Listen for character switch to clear character-specific data
        if (!this.handlers.characterSwitch) {
            this.handlers.characterSwitch = () => this.onCharacterSwitch();
            dataManager.on('character_switching', this.handlers.characterSwitch);
        }
    }

    /**
     * Handle character switch - clear all cached data
     */
    async onCharacterSwitch() {
        this.clearAllPanels();
        this.pinnedActions.clear();
        this.initialized = false;
    }

    /**
     * Disable - cleanup event listeners
     */
    disable() {
        this.clearAllPanels();
        if (this.handlers.characterSwitch) {
            dataManager.off('character_switching', this.handlers.characterSwitch);
            this.handlers.characterSwitch = null;
        }
        this.initialized = false;
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
            profitPerHour: profitPerHour,
            expPerHour: null,
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
     * Update exp/hr for a registered panel
     * @param {HTMLElement} actionPanel - The action panel element
     * @param {number|null} expPerHour - Experience per hour
     */
    updateExpPerHour(actionPanel, expPerHour) {
        const data = this.panels.get(actionPanel);
        if (data) {
            data.expPerHour = expPerHour;
        }
    }

    /**
     * Set the active sort mode
     * @param {'default'|'profit'|'xp'|'coinsPerXp'} mode
     */
    setSortMode(mode) {
        this.sortMode = mode;
        storage.set('actionSortMode', mode, 'settings');
    }

    /**
     * Get the active sort mode
     * @returns {'default'|'profit'|'xp'|'coinsPerXp'}
     */
    getSortMode() {
        return this.sortMode;
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

        this.timerRegistry.clearAll();

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
        const hasPinnedActions = this.pinnedActions.size > 0;

        // Only sort if a sort mode is active OR there are pinned actions
        if (this.sortMode === 'default' && !hasPinnedActions) {
            return;
        }

        // Clear existing timeout
        if (this.sortTimeout) {
            clearTimeout(this.sortTimeout);
        }

        // Schedule new sort after 300ms of inactivity (reduced from 500ms)
        this.sortTimeout = setTimeout(() => {
            this.sortPanelsByProfit();
            this.sortTimeout = null;
        }, 300);
        this.timerRegistry.registerTimeout(this.sortTimeout);
    }

    /**
     * Sort action panels by the active sort mode, with pinned actions at top
     */
    sortPanelsByProfit() {
        const sortMode = this.sortMode;

        // Group panels by their parent container
        const containerMap = new Map();

        // Clean up stale panels and group by container
        for (const [actionPanel, data] of this.panels.entries()) {
            const container = actionPanel.parentElement;

            // If no parent, panel is detached - clean it up
            if (!container) {
                this.panels.delete(actionPanel);
                continue;
            }

            if (!containerMap.has(container)) {
                containerMap.set(container, []);
            }

            const isPinned = this.pinnedActions.has(data.actionHrid);

            containerMap.get(container).push({
                panel: actionPanel,
                profit: data.profitPerHour ?? null,
                exp: data.expPerHour ?? null,
                pinned: isPinned,
                originalIndex: containerMap.get(container).length,
                actionHrid: data.actionHrid,
            });
        }

        // Dismiss any open tooltips before reordering (prevents stuck tooltips)
        // Only dismiss if a tooltip exists and its trigger is not hovered
        const openTooltip = document.querySelector('.MuiTooltip-popper');
        if (openTooltip) {
            const trigger = document.querySelector(`[aria-describedby="${openTooltip.id}"]`);
            if (!trigger || !trigger.matches(':hover')) {
                dismissTooltips();
            }
        }

        // Sort and reorder each container
        for (const [container, panels] of containerMap.entries()) {
            panels.sort((a, b) => {
                // Pinned actions always come first
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;

                // Both same pin state — apply active sort mode
                return this._compareByMode(a, b, sortMode);
            });

            // Reorder DOM elements using DocumentFragment to batch reflows
            // This prevents 50 individual reflows (one per appendChild)
            const fragment = document.createDocumentFragment();
            panels.forEach(({ panel }) => {
                fragment.appendChild(panel);
            });
            container.appendChild(fragment);
        }
    }

    /**
     * Compare two panel entries by the active sort mode
     * @private
     */
    _compareByMode(a, b, sortMode) {
        if (sortMode === 'profit') {
            if (a.profit === null && b.profit === null) return 0;
            if (a.profit === null) return 1;
            if (b.profit === null) return -1;
            return b.profit - a.profit;
        }

        if (sortMode === 'xp') {
            if (a.exp === null && b.exp === null) return 0;
            if (a.exp === null) return 1;
            if (b.exp === null) return -1;
            return b.exp - a.exp;
        }

        if (sortMode === 'coinsPerXp') {
            const aRatio = a.profit !== null && a.exp ? a.profit / a.exp : null;
            const bRatio = b.profit !== null && b.exp ? b.profit / b.exp : null;
            if (aRatio === null && bRatio === null) return 0;
            if (aRatio === null) return 1;
            if (bRatio === null) return -1;
            return bRatio - aRatio;
        }

        // 'default' — sort ascending by required level, falling back to insertion order
        const aLevel = dataManager.getActionDetails(a.actionHrid)?.levelRequirement?.level ?? null;
        const bLevel = dataManager.getActionDetails(b.actionHrid)?.levelRequirement?.level ?? null;
        if (aLevel === null && bLevel === null) return a.originalIndex - b.originalIndex;
        if (aLevel === null) return 1;
        if (bLevel === null) return -1;
        if (aLevel !== bLevel) return aLevel - bLevel;
        return a.originalIndex - b.originalIndex;
    }
}

const actionPanelSort = new ActionPanelSort();

export default actionPanelSort;
