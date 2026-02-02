/**
 * Combat Simulator Integration Module
 * Injects import button on Shykai Combat Simulator page
 *
 * Automatically fills character/party data from game into simulator
 */

import { constructExportObject } from './combat-sim-export.js';
import config from '../../core/config.js';
import { setReactInputValue } from '../../utils/react-input.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * Check if running on Steam client (no extension manager)
 * @returns {boolean} True if on Steam client
 */
function isSteamClient() {
    return typeof GM === 'undefined' && typeof GM_setValue === 'undefined';
}

const timerRegistry = createTimerRegistry();
const IMPORT_CONTAINER_ID = 'toolasha-import-container';

/**
 * Initialize combat sim integration (runs on sim page only)
 */
export function initialize() {
    // Don't inject import button on Steam client (no cross-domain storage)
    if (isSteamClient()) {
        return;
    }

    disable();

    // Wait for simulator UI to load
    waitForSimulatorUI();
}

/**
 * Disable combat sim integration and cleanup injected UI
 */
export function disable() {
    timerRegistry.clearAll();

    const container = document.getElementById(IMPORT_CONTAINER_ID);
    if (container) {
        container.remove();
    }
}

/**
 * Wait for simulator's import/export button to appear
 */
function waitForSimulatorUI() {
    const checkInterval = setInterval(() => {
        const exportButton = document.querySelector('button#buttonImportExport');
        if (exportButton) {
            clearInterval(checkInterval);
            injectImportButton(exportButton);
        }
    }, 200);

    timerRegistry.registerInterval(checkInterval);

    // Stop checking after 10 seconds
    const stopTimeout = setTimeout(() => clearInterval(checkInterval), 10000);
    timerRegistry.registerTimeout(stopTimeout);
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
    container.id = IMPORT_CONTAINER_ID;
    container.style.marginTop = '10px';

    // Create import button
    const button = document.createElement('button');
    button.id = 'toolasha-import-button';
    // Include hidden text for JIGS compatibility (JIGS searches for "Import solo/group")
    button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
    button.style.backgroundColor = config.COLOR_ACCENT;
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
}

/**
 * Import character/party data into simulator
 * @param {Element} button - Button element to update status
 */
async function importDataToSimulator(button) {
    try {
        // Get export data from storage
        const exportData = await constructExportObject();

        if (!exportData) {
            button.textContent = 'Error: No character data';
            button.style.backgroundColor = '#dc3545'; // Red
            const resetTimeout = setTimeout(() => {
                button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                button.style.backgroundColor = config.COLOR_ACCENT;
            }, 3000);
            timerRegistry.registerTimeout(resetTimeout);
            console.error('[Toolasha Combat Sim] No export data available');
            alert(
                'No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again'
            );
            return;
        }

        const { exportObj, playerIDs, importedPlayerPositions, zone, isZoneDungeon, difficultyTier, _isParty } =
            exportData;

        // Step 1: Switch to Group Combat tab
        const groupTab = document.querySelector('a#group-combat-tab');
        if (groupTab) {
            groupTab.click();
        } else {
            console.warn('[Toolasha Combat Sim] Group combat tab not found');
        }

        // Small delay to let tab switch complete
        const importTimeout = setTimeout(() => {
            // Step 2: Fill import field with JSON data
            const importInput = document.querySelector('input#inputSetGroupCombatAll');
            if (importInput) {
                // exportObj already has JSON strings for each slot, just stringify once
                setReactInputValue(importInput, JSON.stringify(exportObj), { focus: false });
            } else {
                console.error('[Toolasha Combat Sim] Import input field not found');
            }

            // Step 3: Click import button
            const importButton = document.querySelector('button#buttonImportSet');
            if (importButton) {
                importButton.click();
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
            const difficultyTimeout = setTimeout(() => {
                // Try both input and select elements
                const difficultyElement =
                    document.querySelector('input#inputDifficulty') ||
                    document.querySelector('select#inputDifficulty') ||
                    document.querySelector('[id*="ifficulty"]');

                if (difficultyElement) {
                    const tierValue = 'T' + difficultyTier;

                    // Handle select dropdown (set by value)
                    if (difficultyElement.tagName === 'SELECT') {
                        // Try to find option by value or text
                        for (let i = 0; i < difficultyElement.options.length; i++) {
                            const option = difficultyElement.options[i];
                            if (
                                option.value === tierValue ||
                                option.value === String(difficultyTier) ||
                                option.text === tierValue ||
                                option.text.includes('T' + difficultyTier)
                            ) {
                                difficultyElement.selectedIndex = i;
                                break;
                            }
                        }
                    } else {
                        // Handle text input
                        difficultyElement.value = tierValue;
                    }

                    difficultyElement.dispatchEvent(new Event('change'));
                    difficultyElement.dispatchEvent(new Event('input'));
                } else {
                    console.warn('[Toolasha Combat Sim] Difficulty element not found');
                }
            }, 250); // Increased delay to ensure zone loads first
            timerRegistry.registerTimeout(difficultyTimeout);

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
                setReactInputValue(simTimeInput, '24', { focus: false });
            }

            // Step 8: Get prices (refresh market data)
            const getPriceButton = document.querySelector('button#buttonGetPrices');
            if (getPriceButton) {
                getPriceButton.click();
            }

            // Update button status
            button.textContent = '✓ Imported';
            button.style.backgroundColor = '#28a745'; // Green
            const successResetTimeout = setTimeout(() => {
                button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                button.style.backgroundColor = config.COLOR_ACCENT;
            }, 3000);
            timerRegistry.registerTimeout(successResetTimeout);
        }, 100);
        timerRegistry.registerTimeout(importTimeout);
    } catch (error) {
        console.error('[Toolasha Combat Sim] Import failed:', error);
        button.textContent = 'Import Failed';
        button.style.backgroundColor = '#dc3545'; // Red
        const failResetTimeout = setTimeout(() => {
            button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
            button.style.backgroundColor = config.COLOR_ACCENT;
        }, 3000);
        timerRegistry.registerTimeout(failResetTimeout);
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

        const dungeonTimeout = setTimeout(() => {
            const selectDungeon = document.querySelector('select#selectDungeon');
            if (selectDungeon) {
                for (let i = 0; i < selectDungeon.options.length; i++) {
                    if (selectDungeon.options[i].value === zoneHrid) {
                        selectDungeon.options[i].selected = true;
                        selectDungeon.dispatchEvent(new Event('change'));
                        break;
                    }
                }
            }
        }, 100);
        timerRegistry.registerTimeout(dungeonTimeout);
    } else {
        // Zone mode
        if (dungeonToggle) {
            dungeonToggle.checked = false;
            dungeonToggle.dispatchEvent(new Event('change'));
        }

        const zoneTimeout = setTimeout(() => {
            const selectZone = document.querySelector('select#selectZone');
            if (selectZone) {
                for (let i = 0; i < selectZone.options.length; i++) {
                    if (selectZone.options[i].value === zoneHrid) {
                        selectZone.options[i].selected = true;
                        selectZone.dispatchEvent(new Event('change'));
                        break;
                    }
                }
            }
        }, 100);
        timerRegistry.registerTimeout(zoneTimeout);
    }
}
