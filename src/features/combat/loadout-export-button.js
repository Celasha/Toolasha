/**
 * Loadout Export Button Module
 * Adds "Export to Clipboard" button on the loadouts page
 *
 * Scrapes equipment, abilities, and consumables from the selected loadout DOM
 * and builds a Combat Simulator compatible export object.
 */

import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import { constructExportObject } from './combat-sim-export.js';

const BUTTON_ID = 'toolasha-loadout-export-button';

/**
 * Extract item HRID from an SVG use href attribute
 * e.g. "items_sprite.9c39e2ec.svg#griffin_bulwark_refined" → "/items/griffin_bulwark_refined"
 * @param {string} href
 * @returns {string|null}
 */
function itemHridFromUseHref(href) {
    if (!href || !href.includes('items_sprite')) return null;
    const fragment = href.split('#')[1];
    if (!fragment) return null;
    return `/items/${fragment}`;
}

/**
 * Extract ability HRID from an SVG use href attribute
 * e.g. "abilities_sprite.fdd1b4de.svg#invincible" → "/abilities/invincible"
 * @param {string} href
 * @returns {string|null}
 */
function abilityHridFromUseHref(href) {
    if (!href || !href.includes('abilities_sprite')) return null;
    const fragment = href.split('#')[1];
    if (!fragment) return null;
    return `/abilities/${fragment}`;
}

/**
 * Build a map of itemHrid → highest enhancementLevel across all character items.
 * Covers both currently equipped items and inventory items.
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

// Maps equipmentDetail.type → itemLocationHrid
const EQUIPMENT_TYPE_TO_LOCATION = {
    '/equipment_types/back': '/item_locations/back',
    '/equipment_types/head': '/item_locations/head',
    '/equipment_types/trinket': '/item_locations/trinket',
    '/equipment_types/main_hand': '/item_locations/main_hand',
    '/equipment_types/two_hand': '/item_locations/main_hand',
    '/equipment_types/body': '/item_locations/body',
    '/equipment_types/off_hand': '/item_locations/off_hand',
    '/equipment_types/hands': '/item_locations/hands',
    '/equipment_types/legs': '/item_locations/legs',
    '/equipment_types/pouch': '/item_locations/pouch',
    '/equipment_types/feet': '/item_locations/feet',
    '/equipment_types/neck': '/item_locations/neck',
    '/equipment_types/earrings': '/item_locations/earrings',
    '/equipment_types/ring': '/item_locations/ring',
    '/equipment_types/charm': '/item_locations/charm',
};

/**
 * Determine itemLocationHrid for an equipment item using initClientData
 * Maps equipmentDetail.type to the corresponding item_locations HRID.
 * @param {string} itemHrid
 * @returns {string|null}
 */
function getItemLocationHrid(itemHrid) {
    const clientData = dataManager.getInitClientData();
    if (!clientData) return null;
    const detail = clientData.itemDetailMap?.[itemHrid];
    if (!detail) return null;
    const equipType = detail.equipmentDetail?.type;
    if (!equipType) return null;
    return EQUIPMENT_TYPE_TO_LOCATION[equipType] || null;
}

/**
 * Scrape equipment items from the selected loadout element
 * @param {Element} selectedLoadout
 * @returns {Array<{itemLocationHrid, itemHrid, enhancementLevel}>}
 */
function scrapeEquipment(selectedLoadout) {
    const equipDiv = selectedLoadout.querySelector('[class*="LoadoutsPanel_equipment"]');
    if (!equipDiv) return [];

    const enhancementMap = buildEnhancementLevelMap();
    const equipment = [];
    const uses = equipDiv.querySelectorAll('use');

    for (const use of uses) {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        const itemHrid = itemHridFromUseHref(href);
        if (!itemHrid) continue;

        const itemLocationHrid = getItemLocationHrid(itemHrid);
        if (!itemLocationHrid) continue;

        const enhancementLevel = enhancementMap.get(itemHrid) ?? 0;
        equipment.push({ itemLocationHrid, itemHrid, enhancementLevel });
    }
    return equipment;
}

/**
 * Scrape abilities from the selected loadout element
 * @param {Element} selectedLoadout
 * @param {Object} clientData - initClientData for isSpecialAbility lookup
 * @returns {Array<{abilityHrid, level}>} 5-slot array, slot 0 = special
 */
function scrapeAbilities(selectedLoadout, clientData) {
    const abilitiesDiv = selectedLoadout.querySelector('[class*="LoadoutsPanel_abilities"]');

    // Build 5-slot array (slot 0 = special, 1-4 = normal)
    const slots = [
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
    ];

    if (!abilitiesDiv) return slots;

    // Each ability is a container with an SVG use + level text
    // Find containers that have an abilities_sprite use element
    const abilityContainers = abilitiesDiv.querySelectorAll('[class*="Ability_ability"]');

    let normalIndex = 1;

    for (const container of abilityContainers) {
        const use = container.querySelector('use');
        if (!use) continue;

        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        const abilityHrid = abilityHridFromUseHref(href);
        if (!abilityHrid) continue;

        // Parse level from ".Ability_level__" element: "Lv.59" → 59
        const levelEl = container.querySelector('[class*="Ability_level"]');
        let level = 1;
        if (levelEl) {
            const match = levelEl.textContent.trim().match(/\d+/);
            if (match) level = parseInt(match[0], 10);
        }

        const isSpecial = clientData?.abilityDetailMap?.[abilityHrid]?.isSpecialAbility || false;

        if (isSpecial) {
            slots[0] = { abilityHrid, level };
        } else if (normalIndex < 5) {
            slots[normalIndex++] = { abilityHrid, level };
        }
    }

    return slots;
}

/**
 * Scrape consumables (food/drinks) from the selected loadout element
 * @param {Element} selectedLoadout
 * @param {Object} clientData - initClientData for item type lookup
 * @returns {{ food: Array, drinks: Array }}
 */
function scrapeConsumables(selectedLoadout, clientData) {
    const consumablesDiv = selectedLoadout.querySelector('[class*="LoadoutsPanel_consumables"]');

    const food = [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }];
    const drinks = [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }];

    if (!consumablesDiv) return { food, drinks };

    const uses = consumablesDiv.querySelectorAll('use');
    let foodIndex = 0;
    let drinkIndex = 0;

    for (const use of uses) {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        const itemHrid = itemHridFromUseHref(href);
        if (!itemHrid) continue;

        const isDrink =
            itemHrid.includes('/drinks/') ||
            itemHrid.includes('coffee') ||
            clientData?.itemDetailMap?.[itemHrid]?.type === 'drink';

        if (isDrink && drinkIndex < 3) {
            drinks[drinkIndex++] = { itemHrid };
        } else if (!isDrink && foodIndex < 3) {
            food[foodIndex++] = { itemHrid };
        }
    }

    return { food, drinks };
}

/**
 * Build a full export object using DOM-scraped loadout data overlaid on character data
 * @param {Element} selectedLoadout
 * @returns {Object|null}
 */
async function buildLoadoutExport(selectedLoadout) {
    // Get the base export using character's own data (for skills, houseRooms, achievements, triggerMap)
    const baseExport = await constructExportObject(null, true);
    if (!baseExport) return null;

    const clientData = dataManager.getInitClientData();
    const playerObj = baseExport.exportObj;

    // Override equipment from DOM
    playerObj.player.equipment = scrapeEquipment(selectedLoadout);

    // Override abilities from DOM
    playerObj.abilities = scrapeAbilities(selectedLoadout, clientData);

    // Override consumables from DOM
    const { food, drinks } = scrapeConsumables(selectedLoadout, clientData);
    playerObj.food = { '/action_types/combat': food };
    playerObj.drinks = { '/action_types/combat': drinks };

    return playerObj;
}

/**
 * Inject the export button into the loadout panel buttons container
 * @param {Element} selectedLoadout
 */
function injectButton(selectedLoadout) {
    // Guard: don't inject twice
    if (document.getElementById(BUTTON_ID)) return;

    // Find the buttons container inside the selected loadout
    const buttonsContainer = selectedLoadout.querySelector('[class*="LoadoutsPanel_buttonsContainer"]');
    if (!buttonsContainer) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.textContent = 'Export to Sim';
    button.style.cssText = `
        border-radius: 5px;
        height: 30px;
        background-color: ${config.COLOR_ACCENT};
        color: black;
        box-shadow: none;
        border: 0px;
        padding: 0 12px;
        cursor: pointer;
        font-weight: bold;
        font-size: 12px;
        white-space: nowrap;
    `;

    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.8';
    });
    button.addEventListener('mouseleave', () => {
        button.style.opacity = '1';
    });

    button.addEventListener('click', async () => {
        await handleExport(button, selectedLoadout);
    });

    buttonsContainer.appendChild(button);
}

/**
 * Handle export button click
 * @param {Element} button
 * @param {Element} selectedLoadout
 */
async function handleExport(button, selectedLoadout) {
    button.textContent = 'Exporting...';
    button.disabled = true;

    try {
        const playerObj = await buildLoadoutExport(selectedLoadout);

        if (!playerObj) {
            button.textContent = '✗ No Data';
            button.style.backgroundColor = '#dc3545';
            setTimeout(() => resetButton(button), 3000);
            console.error('[Loadout Export] No character data. Refresh the game page and try again.');
            alert(
                'No character data found.\n\nPlease:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again'
            );
            return;
        }

        const exportString = JSON.stringify(playerObj);
        await navigator.clipboard.writeText(exportString);

        button.textContent = '✓ Copied';
        button.style.backgroundColor = '#28a745';
        button.disabled = false;
        setTimeout(() => resetButton(button), 3000);
    } catch (error) {
        console.error('[Loadout Export] Export failed:', error);
        button.textContent = '✗ Failed';
        button.style.backgroundColor = '#dc3545';
        button.disabled = false;
        setTimeout(() => resetButton(button), 3000);

        if (error.name === 'NotAllowedError') {
            alert('Clipboard access denied. Please allow clipboard permissions for this site.');
        } else {
            alert('Export failed: ' + error.message);
        }
    }
}

/**
 * Reset button to original state
 * @param {Element} button
 */
function resetButton(button) {
    button.textContent = 'Export to Sim';
    button.style.backgroundColor = config.COLOR_ACCENT;
    button.disabled = false;
}

/**
 * Initialize loadout export button
 */
function initialize() {
    domObserver.register(
        'LoadoutExportButton-Panel',
        () => {
            const selectedLoadout = document.querySelector('[class*="LoadoutsPanel_selectedLoadout"]');
            if (!selectedLoadout) {
                // Panel closed — remove stale button reference
                const stale = document.getElementById(BUTTON_ID);
                if (stale) stale.remove();
                return;
            }

            injectButton(selectedLoadout);
        },
        { debounce: true, debounceDelay: 300 }
    );
}

export default {
    name: 'Loadout Export Button',
    initialize,
};
