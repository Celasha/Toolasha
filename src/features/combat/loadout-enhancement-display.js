/**
 * Loadout Enhancement Display
 * Shows highest-owned enhancement level on equipment icons in the loadout panel
 *
 * Scrapes characterItems for the highest enhancementLevel per itemHrid,
 * then injects a "+N" overlay (upper-right) on each loadout equipment icon.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';

const OVERLAY_CLASS = 'script_loadoutEnhLevel';

/**
 * Build a map of itemHrid → highest enhancementLevel across all character items.
 * @returns {Map<string, number>}
 */
function buildEnhancementLevelMap() {
    const inventory = dataManager.getInventory();
    const map = new Map();
    if (!inventory) return map;

    for (const item of inventory) {
        if (!item.itemHrid || item.count === 0) continue;
        const existing = map.get(item.itemHrid) ?? 0;
        const level = item.enhancementLevel ?? 0;
        if (level > existing) {
            map.set(item.itemHrid, level);
        }
    }
    return map;
}

/**
 * Inject enhancement level overlays on all equipment icons in the loadout panel.
 */
function annotateLoadout() {
    if (!config.getSetting('loadoutEnhancementDisplay')) return;

    const selectedLoadout = document.querySelector('[class*="LoadoutsPanel_selectedLoadout"]');
    if (!selectedLoadout) return;

    const equipDiv = selectedLoadout.querySelector('[class*="LoadoutsPanel_equipment"]');
    if (!equipDiv) return;

    // Remove any stale overlays from a previous loadout selection
    for (const el of equipDiv.querySelectorAll(`.${OVERLAY_CLASS}`)) {
        el.remove();
    }

    const enhancementMap = buildEnhancementLevelMap();

    const uses = equipDiv.querySelectorAll('use');
    for (const use of uses) {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        if (!href.includes('items_sprite')) continue;

        const fragment = href.split('#')[1];
        if (!fragment) continue;
        const itemHrid = `/items/${fragment}`;

        const enhLevel = enhancementMap.get(itemHrid) ?? 0;
        if (enhLevel === 0) continue;

        // DOM: use → svg → Item_iconContainer → Item_item__
        const svg = use.closest('svg');
        if (!svg) continue;
        const itemDiv = svg.parentElement?.parentElement;
        if (!itemDiv) continue;

        // Skip if already annotated
        if (itemDiv.querySelector(`.${OVERLAY_CLASS}`)) continue;

        itemDiv.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.textContent = `+${enhLevel}`;
        overlay.style.cssText = `
            z-index: 1;
            position: absolute;
            top: 2px;
            right: 2px;
            text-align: right;
            color: ${config.COLOR_ACCENT};
            font-size: 10px;
            font-weight: bold;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
            pointer-events: none;
        `;
        itemDiv.appendChild(overlay);
    }
}

/**
 * Remove all loadout enhancement overlays from the page.
 */
function removeOverlays() {
    for (const el of document.querySelectorAll(`.${OVERLAY_CLASS}`)) {
        el.remove();
    }
}

let unregisterHandler = null;

function initialize() {
    if (!config.getSetting('loadoutEnhancementDisplay')) return;

    unregisterHandler = domObserver.register(
        'LoadoutEnhancementDisplay',
        () => {
            annotateLoadout();
        },
        { debounce: true, debounceDelay: 200 }
    );

    // Run immediately for any already-open loadout
    annotateLoadout();

    config.onSettingChange('loadoutEnhancementDisplay', (enabled) => {
        if (enabled) {
            annotateLoadout();
        } else {
            removeOverlays();
        }
    });
}

function cleanup() {
    if (unregisterHandler) {
        unregisterHandler();
        unregisterHandler = null;
    }
    removeOverlays();
}

export default {
    name: 'Loadout Enhancement Display',
    initialize,
    cleanup,
};
