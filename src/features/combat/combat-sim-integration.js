/**
 * Combat Simulator Integration Module
 * Injects import button on Shykai Combat Simulator page
 *
 * Automatically fills character/party data from game into simulator
 */

import { constructExportObject } from './combat-sim-export.js';
import config from '../../core/config.js';

/**
 * Initialize combat sim integration (runs on sim page only)
 */
export function initialize() {
    console.log('[Toolasha Combat Sim] Initializing integration');

    // Wait for simulator UI to load
    waitForSimulatorUI();
}

/**
 * Wait for simulator's import/export button to appear
 */
function waitForSimulatorUI() {
    const checkInterval = setInterval(() => {
        const exportButton = document.querySelector('button#buttonImportExport');
        if (exportButton) {
            clearInterval(checkInterval);
            console.log('[Toolasha Combat Sim] Simulator UI detected');
            injectImportButton(exportButton);
        }
    }, 200);

    // Stop checking after 10 seconds
    setTimeout(() => clearInterval(checkInterval), 10000);
}

/**
 * Inject "Import from Toolasha" button
 * @param {Element} exportButton - Reference element to insert after
 */
function injectImportButton(exportButton) {
    // Check if button already exists
    if (document.getElementById('toolasha-import-button')) {
        return;
    }

    // Create container div
    const container = document.createElement('div');
    container.style.marginTop = '10px';

    // Create import button
    const button = document.createElement('button');
    button.id = 'toolasha-import-button';
    button.textContent = 'Import from Toolasha';
    button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
    button.style.color = 'white';
    button.style.padding = '10px 20px';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontWeight = 'bold';
    button.style.width = '100%';

    // Add hover effect
    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.8';
    });
    button.addEventListener('mouseleave', () => {
        button.style.opacity = '1';
    });

    // Add click handler
    button.addEventListener('click', () => {
        importDataToSimulator(button);
    });

    container.appendChild(button);

    // Insert after export button's parent container
    exportButton.parentElement.parentElement.insertAdjacentElement('afterend', container);

    console.log('[Toolasha Combat Sim] Import button injected');
}

/**
 * Import character/party data into simulator
 * @param {Element} button - Button element to update status
 */
function importDataToSimulator(button) {
    try {
        console.log('[Toolasha Combat Sim] Starting import');

        // Get export data from GM storage
        const exportData = constructExportObject();

        if (!exportData) {
            button.textContent = 'Error: No character data';
            button.style.backgroundColor = '#dc3545'; // Red
            setTimeout(() => {
                button.textContent = 'Import from Toolasha';
                button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
            }, 3000);
            console.error('[Toolasha Combat Sim] No export data available');
            alert('No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again');
            return;
        }

        const { exportObj, playerIDs, importedPlayerPositions, zone, isZoneDungeon, difficultyTier, isParty } = exportData;

        console.log('[Toolasha Combat Sim] Export data:', {
            playerIDs,
            zone,
            isZoneDungeon,
            difficultyTier,
            isParty
        });

        // Step 1: Switch to Group Combat tab
        const groupTab = document.querySelector('a#group-combat-tab');
        if (groupTab) {
            groupTab.click();
        } else {
            console.warn('[Toolasha Combat Sim] Group combat tab not found');
        }

        // Small delay to let tab switch complete
        setTimeout(() => {
            // Step 2: Fill import field with JSON data
            const importInput = document.querySelector('input#inputSetGroupCombatAll');
            if (importInput) {
                // exportObj already has JSON strings for each slot, just stringify once
                importInput.value = JSON.stringify(exportObj);
                console.log('[Toolasha Combat Sim] Data filled into import field');
            } else {
                console.error('[Toolasha Combat Sim] Import input field not found');
            }

            // Step 3: Click import button
            const importButton = document.querySelector('button#buttonImportSet');
            if (importButton) {
                importButton.click();
                console.log('[Toolasha Combat Sim] Import button clicked');
            } else {
                console.error('[Toolasha Combat Sim] Import button not found');
            }

            // Step 4: Set player names in tabs
            for (let i = 0; i < 5; i++) {
                const tab = document.querySelector(`a#player${i + 1}-tab`);
                if (tab) {
                    tab.textContent = playerIDs[i];
                }
            }

            // Step 5: Select zone or dungeon
            if (zone) {
                selectZone(zone, isZoneDungeon);
            }

            // Step 5.5: Set difficulty tier
            setTimeout(() => {
                const difficultyInput = document.querySelector('input#inputDifficulty');
                if (difficultyInput) {
                    difficultyInput.value = difficultyTier;
                    difficultyInput.dispatchEvent(new Event('change'));
                    console.log('[Toolasha Combat Sim] Difficulty tier set:', difficultyTier);
                }
            }, 150); // Small delay after zone selection

            // Step 6: Enable/disable player checkboxes
            for (let i = 0; i < 5; i++) {
                const checkbox = document.querySelector(`input#player${i + 1}.form-check-input.player-checkbox`);
                if (checkbox) {
                    checkbox.checked = importedPlayerPositions[i];
                    checkbox.dispatchEvent(new Event('change'));
                }
            }

            // Step 7: Set simulation time to 24 hours (standard)
            const simTimeInput = document.querySelector('input#inputSimulationTime');
            if (simTimeInput) {
                simTimeInput.value = '24';
            }

            // Step 8: Get prices (refresh market data)
            const getPriceButton = document.querySelector('button#buttonGetPrices');
            if (getPriceButton) {
                getPriceButton.click();
                console.log('[Toolasha Combat Sim] Refreshing market prices');
            }

            // Update button status
            button.textContent = '✓ Imported';
            button.style.backgroundColor = '#28a745'; // Green
            setTimeout(() => {
                button.textContent = 'Import from Toolasha';
                button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
            }, 3000);

            console.log('[Toolasha Combat Sim] Import complete');
        }, 100);

    } catch (error) {
        console.error('[Toolasha Combat Sim] Import failed:', error);
        button.textContent = 'Import Failed';
        button.style.backgroundColor = '#dc3545'; // Red
        setTimeout(() => {
            button.textContent = 'Import from Toolasha';
            button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
        }, 3000);
    }
}

/**
 * Select zone or dungeon in simulator
 * @param {string} zoneHrid - Zone action HRID
 * @param {boolean} isDungeon - Whether it's a dungeon
 */
function selectZone(zoneHrid, isDungeon) {
    const dungeonToggle = document.querySelector('input#simDungeonToggle');

    if (isDungeon) {
        // Dungeon mode
        if (dungeonToggle) {
            dungeonToggle.checked = true;
            dungeonToggle.dispatchEvent(new Event('change'));
        }

        setTimeout(() => {
            const selectDungeon = document.querySelector('select#selectDungeon');
            if (selectDungeon) {
                for (let i = 0; i < selectDungeon.options.length; i++) {
                    if (selectDungeon.options[i].value === zoneHrid) {
                        selectDungeon.options[i].selected = true;
                        selectDungeon.dispatchEvent(new Event('change'));
                        console.log('[Toolasha Combat Sim] Dungeon selected:', zoneHrid);
                        break;
                    }
                }
            }
        }, 100);
    } else {
        // Zone mode
        if (dungeonToggle) {
            dungeonToggle.checked = false;
            dungeonToggle.dispatchEvent(new Event('change'));
        }

        setTimeout(() => {
            const selectZone = document.querySelector('select#selectZone');
            if (selectZone) {
                for (let i = 0; i < selectZone.options.length; i++) {
                    if (selectZone.options[i].value === zoneHrid) {
                        selectZone.options[i].selected = true;
                        selectZone.dispatchEvent(new Event('change'));
                        console.log('[Toolasha Combat Sim] Zone selected:', zoneHrid);
                        break;
                    }
                }
            }
        }, 100);
    }
}
