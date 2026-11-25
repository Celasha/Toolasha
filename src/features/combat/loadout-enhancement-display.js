/**
 * Loadout Enhancement Display
 * Shows highest-owned enhancement level on equipment icons in the loadout panel
 *
 * Uses Core's canonical owned-enhancement index for the highest level per itemHrid,
 * then injects a "+N" overlay (upper-right) on each loadout equipment icon.
 *
 * The number turns red, with a tooltip, when the loadout will not give the level it saved for that item. The
 * saved levels come from Core's display-only accessor, which also says what the game will do with them, so
 * nothing here interprets the loadout's enhancement mode.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import loadoutState from '../../core/loadout-state.js';

const OVERLAY_CLASS = 'script_loadoutEnhLevel';
// Statuses where the loadout cannot give the level it saved (a higher copy in highest mode is not one)
const MISMATCH_STATUSES = new Set(['notOwned', 'missingExact', 'higherIgnored', 'lowerOwned']);
const MISMATCH_COLOR = '#ff5a5a';

/**
 * The name of the loadout the panel is showing. The metadata row reads: "Name" [skill svg] "<loadout name>" [Edit].
 * @param {HTMLElement} selectedLoadout
 * @returns {string|null}
 */
function getShownLoadoutName(selectedLoadout) {
    const metadata = selectedLoadout.querySelector('[class*="LoadoutsPanel_metadata"]');
    if (!metadata) return null;
    let seenSvg = false;
    for (const child of metadata.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'svg') {
            seenSvg = true;
        } else if (seenSvg && child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent.trim();
            if (text) return text;
        }
    }
    return null;
}

/**
 * Saved level per item for the loadout the panel is showing. Two loadouts can share a name, so among
 * same-named loadouts the one whose saved items are the icons on screen wins.
 * @param {HTMLElement} selectedLoadout
 * @param {string[]} shownItemHrids - item hrids of the icons in the equipment block
 * @returns {Map<string, {savedLevel: number, highestOwnedLevel: number|null, status: string}>}
 */
function getShownSavedLevels(selectedLoadout, shownItemHrids) {
    const result = new Map();
    const name = getShownLoadoutName(selectedLoadout);
    if (!name) return result;

    const candidates = loadoutState.getSavedLevelDisplays(name);
    if (candidates.length === 0) return result;

    const shown = new Set(shownItemHrids);
    const fit = (candidate) => {
        const here = candidate.equipment.filter((entry) => shown.has(entry.itemHrid)).length;
        return here - (candidate.equipment.length - here);
    };
    const best = candidates.length === 1 ? candidates[0] : [...candidates].sort((a, b) => fit(b) - fit(a))[0];

    for (const entry of best.equipment) {
        if (entry.savedLevel !== null) result.set(entry.itemHrid, entry);
    }
    return result;
}

/**
 * @param {{savedLevel: number, highestOwnedLevel: number|null, status: string}} entry
 * @returns {string} Tooltip saying what the game does with the saved level
 */
function getSavedLevelTitle(entry) {
    return t(`loadoutSavedLevel.${entry.status}`, { saved: entry.savedLevel, best: entry.highestOwnedLevel });
}

/**
 * Build a map of itemHrid → highest enhancementLevel across all character items.
 * This feature intentionally displays highest-owned (not the selected loadout's exact level),
 * but it shares Core ownership semantics so equipped/no-count handling cannot drift.
 * @returns {Map<string, number>}
 */
function buildEnhancementLevelMap() {
    const result = new Map();
    for (const [itemHrid, owned] of loadoutState.getOwnedEnhancementIndex(dataManager.getInventory())) {
        result.set(itemHrid, owned.highestEnhancementLevel);
    }
    return result;
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

    // Guard: inventory not ready — don't disturb existing overlays
    if (!dataManager.getInventory()) return;

    // Guard: use elements exist but none have item hrefs yet — React is mid-render
    const allUses = equipDiv.querySelectorAll('use');
    const validUses = Array.from(allUses).filter((use) => {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        return href.includes('items_sprite');
    });
    if (allUses.length > 0 && validUses.length === 0) return;

    // DOM and data are ready — clear stale overlays and re-inject
    for (const el of equipDiv.querySelectorAll(`.${OVERLAY_CLASS}`)) {
        el.remove();
    }

    const enhancementMap = buildEnhancementLevelMap();

    // Saved levels: the level each row of THIS loadout was saved at. The game shows no levels on this page, and
    // a loadout keeps the level an item had when it was saved, so enhancing the item afterwards leaves it stale.
    let savedLevels = new Map();
    if (config.getSetting('loadoutSavedLevelDisplay')) {
        const shownItemHrids = validUses
            .map((use) => (use.getAttribute('href') || use.getAttribute('xlink:href') || '').split('#')[1])
            .filter(Boolean)
            .map((fragment) => `/items/${fragment}`);
        savedLevels = getShownSavedLevels(selectedLoadout, shownItemHrids);
    }

    for (const use of validUses) {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        const fragment = href.split('#')[1];
        if (!fragment) continue;
        const itemHrid = `/items/${fragment}`;

        const enhLevel = enhancementMap.get(itemHrid) ?? 0;
        const saved = savedLevels.get(itemHrid) || null;
        // Red when the loadout will not give you what it saved; the number stays the best copy you own
        const mismatch = saved !== null && MISMATCH_STATUSES.has(saved.status);
        if (enhLevel === 0 && !mismatch) continue;

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
        // The mismatch tooltip needs the pointer; clicks on the slot are not affected by a title
        if (mismatch) overlay.title = getSavedLevelTitle(saved);
        overlay.style.cssText = `
            z-index: 1;
            position: absolute;
            top: 2px;
            right: 2px;
            text-align: right;
            color: ${mismatch ? MISMATCH_COLOR : config.COLOR_ACCENT};
            font-size: 10px;
            font-weight: bold;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
            pointer-events: ${mismatch ? 'auto' : 'none'};
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
let settingChangeHandler = null;
let savedLevelSettingHandler = null;
let loadoutUpdateHandler = null;

function enable() {
    if (!unregisterHandler) {
        unregisterHandler = domObserver.register(
            'LoadoutEnhancementDisplay',
            () => {
                annotateLoadout();
            },
            {
                debounce: true,
                debounceDelay: 200,
                filter: (node) => domObserver.touchesSelector(node, '[class*="LoadoutsPanel_"]'),
            }
        );
    }

    // Saved loadouts and ownership change without any DOM change on this panel
    if (!loadoutUpdateHandler) {
        loadoutUpdateHandler = () => annotateLoadout();
        loadoutState.onUpdate(loadoutUpdateHandler);
    }

    // Run immediately for any already-open loadout.
    annotateLoadout();
}

function deactivate() {
    if (unregisterHandler) {
        unregisterHandler();
        unregisterHandler = null;
    }
    if (loadoutUpdateHandler) {
        loadoutState.offUpdate(loadoutUpdateHandler);
        loadoutUpdateHandler = null;
    }
    removeOverlays();
}

function initialize() {
    if (!settingChangeHandler) {
        settingChangeHandler = (enabled) => {
            if (enabled) {
                enable();
            } else {
                deactivate();
            }
        };
        config.onSettingChange('loadoutEnhancementDisplay', settingChangeHandler);
    }

    if (!savedLevelSettingHandler) {
        savedLevelSettingHandler = () => annotateLoadout();
        config.onSettingChange('loadoutSavedLevelDisplay', savedLevelSettingHandler);
    }

    if (config.getSetting('loadoutEnhancementDisplay')) {
        enable();
    }
}

function cleanup() {
    deactivate();
    if (settingChangeHandler) {
        config.offSettingChange('loadoutEnhancementDisplay', settingChangeHandler);
        settingChangeHandler = null;
    }
    if (savedLevelSettingHandler) {
        config.offSettingChange('loadoutSavedLevelDisplay', savedLevelSettingHandler);
        savedLevelSettingHandler = null;
    }
}

export default {
    name: 'Loadout Enhancement Display',
    initialize,
    cleanup,
};
