/**
 * Loadout Sort
 * Adds drag-and-drop reordering to the loadouts panel.
 * Persists sort order locally through game refreshes.
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';

const CSS_PREFIX = 'mwi-loadout';
const STORAGE_KEY_PREFIX = 'loadout_sortOrder';

/**
 * Get character-scoped storage key for loadout sort order.
 * @returns {string}
 */
function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

class LoadoutSort {
    constructor() {
        this.initialized = false;
        this.unregisterObservers = [];
        this._dragSrc = null;
        this._containerObserver = null;
        this._mutationPaused = false;
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
        // Skip if already set up
        if (containerEl.dataset.mwiLoadoutSort) return;
        containerEl.dataset.mwiLoadoutSort = '1';

        await this._applyStoredOrder(containerEl);
        this._injectDragHandles(containerEl);
        this._observeContainer(containerEl);
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
        // Extract only direct text nodes to avoid SVG aria-label text
        const texts = [];
        loadoutEl.childNodes.forEach((n) => {
            if (n.nodeType === 3) {
                const t = n.textContent.trim();
                if (t) texts.push(t);
            }
        });
        const name = texts.join(' ');
        return { icon, name };
    }

    /**
     * Apply stored sort order to the loadouts panel DOM.
     * @param {HTMLElement} containerEl
     */
    async _applyStoredOrder(containerEl) {
        const savedOrder = await storage.getJSON(getStorageKey(), 'settings', null);
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

        // Reorder DOM (pause mutation observer to avoid re-triggering)
        this._mutationPaused = true;
        for (const el of ordered) {
            containerEl.appendChild(el);
        }
        this._mutationPaused = false;
    }

    /**
     * Inject drag handles and set up drag-and-drop on each loadout row.
     * @param {HTMLElement} containerEl
     */
    _injectDragHandles(containerEl) {
        const loadoutEls = Array.from(containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]'));

        for (const loadoutEl of loadoutEls) {
            // Skip if already has a handle
            if (loadoutEl.querySelector(`.${CSS_PREFIX}-drag-handle`)) continue;

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
                this._dragSrc = loadoutEl;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', '');
                loadoutEl.style.opacity = '0.5';
            };

            loadoutEl.ondragend = () => {
                loadoutEl.draggable = false;
                loadoutEl.style.opacity = '1';
                this._dragSrc = null;
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

                if (!this._dragSrc || this._dragSrc === loadoutEl) return;

                // Use cursor position to determine insert before or after
                const rect = loadoutEl.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;

                this._mutationPaused = true;
                containerEl.insertBefore(this._dragSrc, before ? loadoutEl : loadoutEl.nextSibling);
                this._mutationPaused = false;

                this._saveOrder(containerEl);
            };

            // Prepend handle before the SVG icon
            loadoutEl.insertBefore(handle, loadoutEl.firstChild);
        }
    }

    /**
     * Watch for the game adding/removing loadouts and re-inject handles.
     * @param {HTMLElement} containerEl
     */
    _observeContainer(containerEl) {
        if (this._containerObserver) {
            this._containerObserver.disconnect();
        }

        this._containerObserver = new MutationObserver(() => {
            if (this._mutationPaused) return;
            this._injectDragHandles(containerEl);
        });

        this._containerObserver.observe(containerEl, { childList: true, subtree: false });
    }

    /**
     * Save the current DOM order to storage.
     * @param {HTMLElement} containerEl
     */
    _saveOrder(containerEl) {
        const loadoutEls = Array.from(containerEl.querySelectorAll('[class*="LoadoutsPanel_characterLoadout"]'));
        const order = loadoutEls.map((el) => this._buildIdentifier(el));
        storage.setJSON(getStorageKey(), order, 'settings');
    }

    disable() {
        for (const unregister of this.unregisterObservers) {
            unregister();
        }
        this.unregisterObservers = [];

        if (this._containerObserver) {
            this._containerObserver.disconnect();
            this._containerObserver = null;
        }

        // Remove injected drag handles
        document.querySelectorAll(`.${CSS_PREFIX}-drag-handle`).forEach((el) => el.remove());

        this.initialized = false;
    }
}

const loadoutSort = new LoadoutSort();

/**
 * @returns {Promise<Array<{icon: string, name: string}>|null>}
 */
export async function getLoadoutSortOrder() {
    return storage.getJSON(getStorageKey(), 'settings', null);
}

export default {
    name: 'Loadout Sort',
    initialize: () => loadoutSort.initialize(),
    cleanup: () => loadoutSort.disable(),
};
