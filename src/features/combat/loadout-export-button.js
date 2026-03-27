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
import { scrapeEquipment, scrapeAbilities, scrapeConsumables } from '../../utils/loadout-scraper.js';

const BUTTON_ID = 'toolasha-loadout-export-button';

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
    domObserver.onClass('LoadoutExportButton-Panel', 'LoadoutsPanel_buttonsContainer', (node) => {
        const selectedLoadout = node.closest('[class*="LoadoutsPanel_selectedLoadout"]');
        if (!selectedLoadout) return;
        injectButton(selectedLoadout);
    });
}

export default {
    name: 'Loadout Export Button',
    initialize,
};
