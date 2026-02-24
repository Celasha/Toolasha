/**
 * Inventory Count Display
 * Shows how many of the output item you currently own on:
 *  - Skill action tiles (SkillAction_skillAction) — bottom-center overlay on the tile
 *  - Action detail panels (SkillActionDetail_regularComponent) — inline after the action name heading
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { numberFormatter } from '../../utils/formatters.js';

const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
    '/action_types/alchemy',
];

/**
 * Build an itemHrid → count map from the current inventory.
 * @returns {Map<string, number>}
 */
function buildCountMap() {
    const inventory = dataManager.getInventory();
    const map = new Map();
    if (!Array.isArray(inventory)) return map;

    for (const item of inventory) {
        if (item.itemLocationHrid !== '/item_locations/inventory') continue;
        const count = item.count || 0;
        if (!count) continue;
        map.set(item.itemHrid, (map.get(item.itemHrid) || 0) + count);
    }
    return map;
}

/**
 * Return the primary output itemHrid for an action, or null if not applicable.
 * Gathering: first entry of dropTable (the main resource, not rare drops).
 * Production: first entry of outputItems.
 * @param {object} actionDetails
 * @returns {string|null}
 */
function getPrimaryOutputHrid(actionDetails) {
    if (!actionDetails) return null;

    if (GATHERING_TYPES.includes(actionDetails.type)) {
        return actionDetails.dropTable?.[0]?.itemHrid ?? null;
    }

    if (PRODUCTION_TYPES.includes(actionDetails.type)) {
        return actionDetails.outputItems?.[0]?.itemHrid ?? null;
    }

    return null;
}

/**
 * @param {number} count
 * @returns {string}
 */
function formatCount(count) {
    return numberFormatter(count, 0);
}

class InventoryCountDisplay {
    constructor() {
        this.tileElements = new Map(); // actionPanel → { outputHrid, span }
        this.detailPanels = new Set();
        this.unregisterObservers = [];
        this.itemsUpdatedHandler = null;
        this.actionCompletedHandler = null;
        this.isInitialized = false;
        this.DEBOUNCE_DELAY = 300;
        this.debounceTimer = null;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('inventoryCountDisplay', true)) return;

        this.isInitialized = true;

        this._setupTileObserver();
        this._setupDetailObserver();

        this.itemsUpdatedHandler = () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this._refreshAll(), this.DEBOUNCE_DELAY);
        };

        this.actionCompletedHandler = () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this._refreshAll(), this.DEBOUNCE_DELAY);
        };

        dataManager.on('items_updated', this.itemsUpdatedHandler);
        dataManager.on('action_completed', this.actionCompletedHandler);

        this.unregisterObservers.push(() => {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            dataManager.off('action_completed', this.actionCompletedHandler);
        });
    }

    // ─── Tile observer ────────────────────────────────────────────────────────

    _setupTileObserver() {
        const unregister = domObserver.onClass('InventoryCountDisplay-Tile', 'SkillAction_skillAction', (actionPanel) =>
            this._injectTile(actionPanel)
        );
        this.unregisterObservers.push(unregister);

        document.querySelectorAll('[class*="SkillAction_skillAction"]').forEach((panel) => {
            this._injectTile(panel);
        });
    }

    /**
     * Inject a count strip just below the tile using the same pattern as
     * gathering-stats / max-produceable: position absolute at top:100% with
     * marginBottom on the panel so the grid row makes room for it.
     * @param {HTMLElement} actionPanel
     */
    _injectTile(actionPanel) {
        const actionHrid = this._getActionHridFromTile(actionPanel);
        if (!actionHrid) return;

        const actionDetails = dataManager.getActionDetails(actionHrid);
        const outputHrid = getPrimaryOutputHrid(actionDetails);
        if (!outputHrid) return;

        let span = actionPanel.querySelector('.mwi-inv-count-tile');
        if (span && span.dataset.outputHrid !== outputHrid) {
            // Output changed — clean up stale span
            span.remove();
            span = null;
        }
        if (!span) {
            const nameEl = actionPanel.querySelector('[class*="SkillAction_name"]');
            if (!nameEl) return;

            span = document.createElement('span');
            span.className = 'mwi-inv-count-tile';
            span.dataset.outputHrid = outputHrid;

            if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
                actionPanel.style.position = 'relative';
            }

            // z-index:12 places the count above the icon container which fills the tile.
            // bottom:4px sits inside the tile above the profit bar (which is at top:100%).
            // background + padding give the number a readable pill against the sprite.
            span.style.cssText = `
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
                text-align: center;
                font-size: 0.75em;
                color: ${config.COLOR_INV_COUNT};
                font-weight: 600;
                pointer-events: none;
                line-height: 1.4;
                z-index: 12;
                background: rgba(0, 0, 0, 0.55);
                border-radius: 3px;
                padding: 0 4px;
                white-space: nowrap;
            `;
            actionPanel.appendChild(span);
        }

        this.tileElements.set(actionPanel, { outputHrid, span });
        this._updateTileSpan(span, outputHrid, buildCountMap());
    }

    _updateTileSpan(span, outputHrid, countMap) {
        const count = countMap.get(outputHrid) || 0;
        span.textContent = count > 0 ? formatCount(count) : '';
        span.style.color = config.COLOR_INV_COUNT;
    }

    // ─── Detail panel observer ────────────────────────────────────────────────

    _setupDetailObserver() {
        const unregister = domObserver.onClass(
            'InventoryCountDisplay-Detail',
            'SkillActionDetail_regularComponent',
            (panel) => this._injectDetail(panel)
        );
        this.unregisterObservers.push(unregister);

        document.querySelectorAll('[class*="SkillActionDetail_regularComponent"]').forEach((panel) => {
            this._injectDetail(panel);
        });
    }

    /**
     * Inject count inline after the action name heading in the detail panel.
     * Reads textContent before injecting so the name lookup is always clean.
     * @param {HTMLElement} panel
     */
    _injectDetail(panel) {
        const nameEl = panel.querySelector('[class*="SkillActionDetail_name"]');
        if (!nameEl) return;

        const actionName = nameEl.textContent.trim();
        const actionHrid = this._getActionHridFromName(actionName);
        if (!actionHrid) return;

        const actionDetails = dataManager.getActionDetails(actionHrid);
        const outputHrid = getPrimaryOutputHrid(actionDetails);
        if (!outputHrid) return;

        panel.querySelector('.mwi-inv-count-detail')?.remove();

        const count = buildCountMap().get(outputHrid) || 0;

        const span = document.createElement('span');
        span.className = 'mwi-inv-count-detail';
        span.dataset.outputHrid = outputHrid;
        span.style.cssText = `
            display: block;
            font-size: 0.75em;
            color: ${config.COLOR_INV_COUNT};
            font-weight: 600;
            margin-top: 2px;
            pointer-events: none;
        `;
        span.textContent = count > 0 ? `(${formatCount(count)} in inventory)` : '';

        // Insert after the info container (nameEl's parent) so it sits on its own
        // line below the action name row. Inserting after nameEl itself puts the span
        // inside the flex info row and causes overlap.
        const infoContainer = nameEl.closest('[class*="SkillActionDetail_info"]') ?? nameEl.parentElement;
        infoContainer.after(span);
        this.detailPanels.add(panel);
    }

    // ─── Refresh ──────────────────────────────────────────────────────────────

    _refreshAll() {
        const countMap = buildCountMap();

        for (const [actionPanel, { outputHrid, span }] of this.tileElements) {
            if (!document.body.contains(actionPanel)) {
                this.tileElements.delete(actionPanel);
                continue;
            }
            this._updateTileSpan(span, outputHrid, countMap);
        }

        for (const panel of this.detailPanels) {
            if (!document.body.contains(panel)) {
                this.detailPanels.delete(panel);
                continue;
            }
            const span = panel.querySelector('.mwi-inv-count-detail');
            if (!span || !span.dataset.outputHrid) continue;
            const count = countMap.get(span.dataset.outputHrid) || 0;
            span.style.color = config.COLOR_INV_COUNT;
            span.textContent = count > 0 ? `(${formatCount(count)} in inventory)` : '';
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _getActionHridFromTile(actionPanel) {
        const nameEl = actionPanel.querySelector('[class*="SkillAction_name"]');
        if (!nameEl) return null;
        const name = Array.from(nameEl.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join('')
            .trim();
        return this._getActionHridFromName(name);
    }

    _getActionHridFromName(name) {
        const initData = dataManager.getInitClientData();
        if (!initData) return null;
        for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
            if (action.name === name) return hrid;
        }
        return null;
    }

    disable() {
        this.unregisterObservers.forEach((fn) => fn());
        this.unregisterObservers = [];

        document.querySelectorAll('.mwi-inv-count-tile').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-inv-count-detail').forEach((el) => el.remove());

        this.tileElements.clear();
        this.detailPanels.clear();
        this.isInitialized = false;
    }
}

const inventoryCountDisplay = new InventoryCountDisplay();

export default {
    name: 'Inventory Count Display',
    initialize: () => inventoryCountDisplay.initialize(),
    cleanup: () => inventoryCountDisplay.disable(),
};
