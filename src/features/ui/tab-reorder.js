/**
 * Tab Reorder
 * Allows users to drag-and-drop reorder the character panel tabs
 * (Inventory, Toolasha, Equipment, Houses, Abilities, Loadout).
 *
 * Uses CSS `order` on flex items — does not move DOM nodes, so React
 * re-renders and click→panel mapping are unaffected.
 */

import { t } from '../../core/i18n.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';

const STORAGE_KEY_PREFIX = 'tabOrder';

/**
 * Get character-scoped storage key.
 * @returns {string}
 */
function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

/**
 * Find the character panel tab list by looking for the one containing "Inventory".
 * @returns {HTMLElement|null}
 */
function findCharacterTabList() {
    const allTabLists = document.querySelectorAll('[role="tablist"]');
    for (const tl of allTabLists) {
        for (const tab of tl.querySelectorAll('[role="tab"]')) {
            if (tab.textContent.trim() === 'Inventory') return tl;
        }
    }
    return null;
}

class TabReorder {
    constructor() {
        this.isInitialized = false;
        this.savedOrder = null;
        this.unregisterHandlers = [];
        this._dragLabel = null;
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('tabReorder')) return;

        this.isInitialized = true;

        // Load saved order
        this.savedOrder = await storage.getJSON(getStorageKey(), 'settings', null);

        // Apply to existing tabs
        this._applyOrder();

        // Re-apply whenever React re-renders the tab container
        const unregister = domObserver.onClass('TabReorder', 'TabsComponent_tabsContainer', () => {
            // Small delay to let Toolasha tab injection happen first
            setTimeout(() => this._applyOrder(), 50);
        });
        this.unregisterHandlers.push(unregister);
    }

    /**
     * Apply saved order and wire drag-and-drop on all character panel tabs.
     * @private
     */
    _applyOrder() {
        const tabList = findCharacterTabList();
        if (!tabList) return;

        const tabs = [...tabList.querySelectorAll('[role="tab"]')];
        if (tabs.length === 0) return;

        if (this.savedOrder) {
            for (const tab of tabs) {
                const label = tab.textContent.trim();
                const idx = this.savedOrder.indexOf(label);
                tab.style.order = idx >= 0 ? idx : this.savedOrder.length;
            }
        }

        // Wire drag-and-drop on tabs not yet wired
        for (const tab of tabs) {
            if (tab.dataset.mwiTabReorder) continue;
            tab.dataset.mwiTabReorder = '1';
            this._wireDragDrop(tab);
        }
    }

    /**
     * Wire native HTML5 drag-and-drop on a tab button.
     * @param {HTMLElement} tab
     * @private
     */
    _wireDragDrop(tab) {
        tab.setAttribute('draggable', 'true');
        tab.style.cursor = 'grab';

        tab.addEventListener('dragstart', (e) => {
            this._dragLabel = tab.textContent.trim();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this._dragLabel);
            tab.style.opacity = '0.4';
        });

        tab.addEventListener('dragend', () => {
            tab.style.opacity = '';
            this._dragLabel = null;
            // Clean all drop indicators
            const tabList = findCharacterTabList();
            if (tabList) {
                for (const t of tabList.querySelectorAll('[role="tab"]')) {
                    t.style.removeProperty('border-left');
                    t.style.removeProperty('border-right');
                }
            }
        });

        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            // Show drop indicator
            const rect = tab.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            const isLeft = e.clientX < midX;

            // Clear all indicators first
            const tabList = tab.closest('[role="tablist"]');
            if (tabList) {
                for (const t of tabList.querySelectorAll('[role="tab"]')) {
                    t.style.removeProperty('border-left');
                    t.style.removeProperty('border-right');
                }
            }

            if (isLeft) {
                tab.style.borderLeft = '2px solid #4a9eff';
            } else {
                tab.style.borderRight = '2px solid #4a9eff';
            }
        });

        tab.addEventListener('dragleave', () => {
            tab.style.removeProperty('border-left');
            tab.style.removeProperty('border-right');
        });

        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            tab.style.removeProperty('border-left');
            tab.style.removeProperty('border-right');

            const draggedLabel = e.dataTransfer.getData('text/plain');
            const targetLabel = tab.textContent.trim();
            if (!draggedLabel || draggedLabel === targetLabel) return;

            // Determine drop position (before or after target)
            const rect = tab.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            const dropBefore = e.clientX < midX;

            // Build current visual order
            const tabList = tab.closest('[role="tablist"]');
            if (!tabList) return;

            const tabs = [...tabList.querySelectorAll('[role="tab"]')];
            const currentOrder = tabs
                .map((t) => ({ label: t.textContent.trim(), order: parseInt(t.style.order) || 0 }))
                .sort((a, b) => a.order - b.order)
                .map((t) => t.label);

            // Remove dragged from current position
            const newOrder = currentOrder.filter((l) => l !== draggedLabel);

            // Insert at new position
            const targetIdx = newOrder.indexOf(targetLabel);
            if (targetIdx < 0) return;

            if (dropBefore) {
                newOrder.splice(targetIdx, 0, draggedLabel);
            } else {
                newOrder.splice(targetIdx + 1, 0, draggedLabel);
            }

            // Save and apply
            this.savedOrder = newOrder;
            this._saveOrder(newOrder);
            this._applyOrder();
        });
    }

    /**
     * Persist the tab order to storage.
     * @param {Array<string>} order - Ordered array of tab labels
     * @private
     */
    async _saveOrder(order) {
        await storage.setJSON(getStorageKey(), order, 'settings', true);
    }

    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        // Remove all CSS order and draggable attributes
        const tabList = findCharacterTabList();
        if (tabList) {
            for (const tab of tabList.querySelectorAll('[role="tab"]')) {
                tab.style.removeProperty('order');
                tab.removeAttribute('draggable');
                tab.style.removeProperty('cursor');
                tab.style.removeProperty('border-left');
                tab.style.removeProperty('border-right');
                delete tab.dataset.mwiTabReorder;
            }
        }

        this.isInitialized = false;
    }
}

const tabReorder = new TabReorder();

export default {
    name: 'Tab Reorder',
    initialize: async () => {
        await tabReorder.initialize();
    },
    cleanup: () => {
        tabReorder.disable();
    },
    disable: () => {
        tabReorder.disable();
    },
};
