/**
 * Loadout Sort
 * Adds drag-and-drop reordering to the loadouts panel.
 * Persists sort order locally through game refreshes.
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import storage from '../../core/storage.js';

const CSS_PREFIX = 'mwi-loadout';

class LoadoutSort {
    constructor() {
        this.initialized = false;
        this.unregisterObservers = [];
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('loadout_sortEnabled', true)) return;

        const unregister = domObserver.onClass('LoadoutSort', 'LoadoutsPanel_characterLoadouts', (containerEl) =>
            this._onLoadoutsPanelFound(containerEl)
        );
        this.unregisterObservers.push(unregister);

        this.initialized = true;
    }

    /**
     * Called when the loadouts panel container is found in the DOM.
     * @param {HTMLElement} containerEl
     */
    async _onLoadoutsPanelFound(containerEl) {
        // Skip if already injected
        if (containerEl.querySelector(`.${CSS_PREFIX}-drag-handle`)) return;

        await this._applyStoredOrder(containerEl);
        this._injectDragHandles(containerEl);
    }

    /**
     * Build an identifier for a loadout element.
     * @param {HTMLElement} loadoutEl
     * @returns {{ icon: string, name: string }}
     */
    _buildIdentifier(loadoutEl) {
        const useEl = loadoutEl.querySelector('use');
        const href = useEl?.getAttribute('href') || useEl?.getAttribute('xlink:href') || '';
        const icon = href.split('#')[1] || '';
        // Text content includes the icon's aria text, so grab just the direct text
        const name = loadoutEl.textContent?.trim() || '';
        return { icon, name };
    }

    /**
     * Apply stored sort order to the loadouts panel DOM.
     * @param {HTMLElement} containerEl
     */
    async _applyStoredOrder(containerEl) {
        const savedOrder = await storage.getJSON('loadout_sortOrder', 'settings', null);
        if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) return;

        const loadoutEls = Array.from(containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]'));
        if (loadoutEls.length === 0) return;

        // Build identifiers for current elements
        const elements = loadoutEls.map((el) => ({
            el,
            id: this._buildIdentifier(el),
            matched: false,
        }));

        // Match saved order against current elements
        const ordered = [];
        for (const saved of savedOrder) {
            const match = elements.find((e) => !e.matched && e.id.icon === saved.icon && e.id.name === saved.name);
            if (match) {
                match.matched = true;
                ordered.push(match.el);
            }
        }

        // Append any unmatched elements at the end (new loadouts)
        for (const e of elements) {
            if (!e.matched) {
                ordered.push(e.el);
            }
        }

        // Reorder DOM
        for (const el of ordered) {
            containerEl.appendChild(el);
        }
    }

    /**
     * Inject drag handles and set up drag-and-drop on each loadout row.
     * @param {HTMLElement} containerEl
     */
    _injectDragHandles(containerEl) {
        const loadoutEls = Array.from(containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]'));

        for (const loadoutEl of loadoutEls) {
            // Create drag handle
            const handle = document.createElement('span');
            handle.className = `${CSS_PREFIX}-drag-handle`;
            handle.textContent = '⋮⋮';
            handle.style.cssText = `
                cursor: grab;
                color: #666;
                font-size: 14px;
                padding: 0 4px;
                user-select: none;
            `;

            // Only allow drag when initiated from handle
            handle.onmousedown = () => {
                loadoutEl.draggable = true;
            };

            loadoutEl.ondragstart = (e) => {
                if (!loadoutEl.draggable) {
                    e.preventDefault();
                    return;
                }
                const index = Array.from(
                    containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]')
                ).indexOf(loadoutEl);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(index));
                loadoutEl.style.opacity = '0.5';
            };

            loadoutEl.ondragend = () => {
                loadoutEl.draggable = false;
                loadoutEl.style.opacity = '1';
            };

            loadoutEl.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                loadoutEl.style.borderLeft = '2px solid #4a9eff';
            };

            loadoutEl.ondragleave = () => {
                loadoutEl.style.borderLeft = '';
            };

            loadoutEl.ondrop = (e) => {
                e.preventDefault();
                loadoutEl.style.borderLeft = '';

                const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const allEls = Array.from(containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]'));
                const dropIndex = allEls.indexOf(loadoutEl);

                if (dragIndex !== dropIndex && dragIndex >= 0 && dragIndex < allEls.length) {
                    const draggedEl = allEls[dragIndex];
                    if (dragIndex < dropIndex) {
                        containerEl.insertBefore(draggedEl, loadoutEl.nextSibling);
                    } else {
                        containerEl.insertBefore(draggedEl, loadoutEl);
                    }
                    this._saveOrder(containerEl);
                }
            };

            // Prepend handle before the SVG icon
            loadoutEl.insertBefore(handle, loadoutEl.firstChild);
        }
    }

    /**
     * Save the current DOM order to storage.
     * @param {HTMLElement} containerEl
     */
    _saveOrder(containerEl) {
        const loadoutEls = Array.from(containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]'));
        const order = loadoutEls.map((el) => this._buildIdentifier(el));
        storage.setJSON('loadout_sortOrder', order, 'settings');
    }

    disable() {
        for (const unregister of this.unregisterObservers) {
            unregister();
        }
        this.unregisterObservers = [];

        // Remove injected drag handles
        document.querySelectorAll(`.${CSS_PREFIX}-drag-handle`).forEach((el) => el.remove());

        this.initialized = false;
    }
}

const loadoutSort = new LoadoutSort();

export default {
    name: 'Loadout Sort',
    initialize: () => loadoutSort.initialize(),
    cleanup: () => loadoutSort.disable(),
};
