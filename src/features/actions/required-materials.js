/**
 * Required Materials Display
 * Shows total required materials and missing amounts for production actions
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { numberFormatter } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import { parseArtisanBonus, getDrinkConcentration } from '../../utils/tea-parser.js';
import { findActionInput, attachInputListeners, performInitialUpdate } from '../../utils/action-panel-helper.js';

class RequiredMaterials {
    constructor() {
        this.initialized = false;
        this.observers = [];
        this.processedPanels = new WeakSet();
    }

    initialize() {
        if (this.initialized) return;

        // Watch for action panels appearing
        const unregister = domObserver.onClass(
            'RequiredMaterials-ActionPanel',
            'SkillActionDetail_skillActionDetail',
            () => this.processActionPanels()
        );
        this.observers.push(unregister);

        // Process existing panels
        this.processActionPanels();

        this.initialized = true;
    }

    processActionPanels() {
        const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');

        panels.forEach((panel) => {
            if (this.processedPanels.has(panel)) {
                return;
            }

            // Find the input box using utility
            const inputField = findActionInput(panel);
            if (!inputField) {
                return;
            }

            // Mark as processed
            this.processedPanels.add(panel);

            // Attach input listeners using utility
            attachInputListeners(panel, inputField, (value) => {
                this.updateRequiredMaterials(panel, value);
            });

            // Initial update if there's already a value
            performInitialUpdate(inputField, (value) => {
                this.updateRequiredMaterials(panel, value);
            });
        });
    }

    updateRequiredMaterials(panel, amount) {
        // Remove existing displays
        const existingDisplays = panel.querySelectorAll('.mwi-required-materials');
        existingDisplays.forEach((el) => el.remove());

        const numActions = parseInt(amount) || 0;
        if (numActions <= 0) {
            return;
        }

        // Get artisan bonus for material reduction calculation
        const artisanBonus = this.getArtisanBonus(panel);

        // Get base material requirements from action details (separated into upgrade and regular)
        const { upgradeItemCount, regularMaterials } = this.getBaseMaterialRequirements(panel);

        // Process upgrade item first (if exists)
        if (upgradeItemCount !== null) {
            this.processUpgradeItem(panel, numActions, upgradeItemCount);
        }

        // Find requirements container for regular materials
        const requiresDiv = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
        if (!requiresDiv) {
            return;
        }

        // Get inventory spans and input spans
        const inventorySpans = panel.querySelectorAll('[class*="SkillActionDetail_inventoryCount"]');
        const inputSpans = Array.from(panel.querySelectorAll('[class*="SkillActionDetail_inputCount"]')).filter(
            (span) => !span.textContent.includes('Required')
        );

        // Process each regular material using MWIT-E's approach
        // Iterate through requiresDiv children to find inputCount spans and their target containers
        const children = Array.from(requiresDiv.children);
        let materialIndex = 0;

        children.forEach((child, index) => {
            if (child.className && child.className.includes('inputCount')) {
                // Found an inputCount span - the next sibling is our target container
                const targetContainer = requiresDiv.children[index + 1];
                if (!targetContainer) return;

                // Get corresponding inventory and input data
                if (materialIndex >= inventorySpans.length || materialIndex >= inputSpans.length) return;

                const invText = inventorySpans[materialIndex].textContent.trim();

                // Parse inventory amount (handle K/M suffixes)
                const invValue = this.parseAmount(invText);

                // Get base requirement from action details (now correctly indexed)
                const materialReq = regularMaterials[materialIndex];
                if (!materialReq || materialReq.count <= 0) {
                    materialIndex++;
                    return;
                }

                // Apply artisan reduction to regular materials
                // Materials are consumed PER ACTION
                // Efficiency gives bonus actions for FREE (no material cost)
                const materialsPerAction = materialReq.count * (1 - artisanBonus);

                // Calculate total materials needed for queued actions
                const totalRequired = Math.ceil(materialsPerAction * numActions);
                const missing = Math.max(0, totalRequired - invValue);

                // Create display element
                const displaySpan = document.createElement('span');
                displaySpan.className = 'mwi-required-materials';
                displaySpan.style.cssText = `
                    display: block;
                    font-size: 0.85em;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-top: 2px;
                `;

                // Build text
                let text = `Required: ${numberFormatter(totalRequired)}`;
                if (missing > 0) {
                    text += ` || Missing: ${numberFormatter(missing)}`;
                    displaySpan.style.color = config.COLOR_LOSS; // Missing materials
                } else {
                    displaySpan.style.color = config.COLOR_PROFIT; // Sufficient materials
                }

                displaySpan.textContent = text;

                // Append to target container
                targetContainer.appendChild(displaySpan);

                materialIndex++;
            }
        });
    }

    /**
     * Process upgrade item display in "Upgrades From" section
     * @param {HTMLElement} panel - Action panel element
     * @param {number} numActions - Number of actions to perform
     * @param {number} upgradeItemCount - Base count of upgrade item (always 1)
     */
    processUpgradeItem(panel, numActions, upgradeItemCount) {
        try {
            // Find upgrade item selector container
            const upgradeContainer = panel.querySelector('[class*="SkillActionDetail_upgradeItemSelectorInput"]');
            if (!upgradeContainer) {
                return;
            }

            // Find the inventory count from game UI
            const inventoryElement = upgradeContainer.querySelector('[class*="Item_count"]');
            let invValue = 0;

            if (inventoryElement) {
                // Found the game's native inventory count display
                invValue = this.parseAmount(inventoryElement.textContent.trim());
            } else {
                // Fallback: Get inventory from game data using item name
                const svg = upgradeContainer.querySelector('svg[role="img"]');
                if (svg) {
                    const itemName = svg.getAttribute('aria-label');

                    if (itemName) {
                        // Look up inventory from game data
                        const gameData = dataManager.getInitClientData();
                        const inventory = dataManager.getInventory();

                        if (gameData && inventory) {
                            // Find item HRID by name
                            let itemHrid = null;
                            for (const [hrid, details] of Object.entries(gameData.itemDetailMap || {})) {
                                if (details.name === itemName) {
                                    itemHrid = hrid;
                                    break;
                                }
                            }

                            if (itemHrid) {
                                // Get inventory count (default to 0 if not found)
                                invValue = inventory[itemHrid] || 0;
                            }
                        }
                    }
                }
            }

            // Calculate requirements (upgrade items always need exactly 1 per action, no artisan)
            const totalRequired = upgradeItemCount * numActions;
            const missing = Math.max(0, totalRequired - invValue);

            // Create display element (matching style of regular materials)
            const displaySpan = document.createElement('span');
            displaySpan.className = 'mwi-required-materials';
            displaySpan.style.cssText = `
                display: block;
                font-size: 0.85em;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 2px;
            `;

            // Build text
            let text = `Required: ${numberFormatter(totalRequired)}`;
            if (missing > 0) {
                text += ` || Missing: ${numberFormatter(missing)}`;
                displaySpan.style.color = config.COLOR_LOSS; // Missing materials
            } else {
                displaySpan.style.color = config.COLOR_PROFIT; // Sufficient materials
            }

            displaySpan.textContent = text;

            // Insert after entire upgrade container (not inside it)
            upgradeContainer.after(displaySpan);
        } catch (error) {
            console.error('[Required Materials] Error processing upgrade item:', error);
        }
    }

    /**
     * Get base material requirements from action details
     * @param {HTMLElement} panel - Action panel element
     * @returns {Object} Object with upgradeItemCount (number|null) and regularMaterials (Array)
     */
    getBaseMaterialRequirements(panel) {
        try {
            // Get action name from panel
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!actionNameElement) {
                return { upgradeItemCount: null, regularMaterials: [] };
            }

            const actionName = actionNameElement.textContent.trim();

            // Look up action details
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.actionDetailMap) {
                return { upgradeItemCount: null, regularMaterials: [] };
            }

            let actionDetails = null;
            for (const [_hrid, details] of Object.entries(gameData.actionDetailMap)) {
                if (details.name === actionName) {
                    actionDetails = details;
                    break;
                }
            }

            if (!actionDetails) {
                return { upgradeItemCount: null, regularMaterials: [] };
            }

            // Separate upgrade item from regular materials
            const upgradeItemCount = actionDetails.upgradeItemHrid ? 1 : null;
            const regularMaterials = [];

            // Add regular input items (affected by Artisan Tea)
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                actionDetails.inputItems.forEach((item) => {
                    regularMaterials.push({
                        count: item.count || 0,
                    });
                });
            }

            // Return separated data
            return { upgradeItemCount, regularMaterials };
        } catch (error) {
            console.error('[Required Materials] Error getting base requirements:', error);
            return { upgradeItemCount: null, regularMaterials: [] };
        }
    }

    /**
     * Get artisan bonus (material reduction) for the current action
     * @param {HTMLElement} panel - Action panel element
     * @returns {number} Artisan bonus (0-1 decimal, e.g., 0.1129 for 11.29% reduction)
     */
    getArtisanBonus(panel) {
        try {
            // Get action name from panel
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!actionNameElement) {
                return 0;
            }

            const actionName = actionNameElement.textContent.trim();

            // Look up action details
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.actionDetailMap) {
                return 0;
            }

            let actionDetails = null;
            for (const [_hrid, details] of Object.entries(gameData.actionDetailMap)) {
                if (details.name === actionName) {
                    actionDetails = details;
                    break;
                }
            }

            if (!actionDetails) {
                return 0;
            }

            // Get character data
            const equipment = dataManager.getEquipment();
            const itemDetailMap = gameData.itemDetailMap || {};

            // Calculate artisan bonus (material reduction from Artisan Tea)
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
            const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            return artisanBonus;
        } catch (error) {
            console.error('[Required Materials] Error calculating artisan bonus:', error);
            return 0;
        }
    }

    /**
     * Parse amount from text (handles K/M suffixes and number formatting)
     */
    parseAmount(text) {
        // Remove spaces
        text = text.replace(/\s/g, '');

        // Handle K/M suffixes (case insensitive)
        const lowerText = text.toLowerCase();
        if (lowerText.includes('k')) {
            return parseFloat(lowerText.replace('k', '')) * 1000;
        }
        if (lowerText.includes('m')) {
            return parseFloat(lowerText.replace('m', '')) * 1000000;
        }

        // Remove commas and parse
        return parseFloat(text.replace(/,/g, '')) || 0;
    }

    cleanup() {
        this.observers.forEach((unregister) => unregister());
        this.observers = [];
        this.processedPanels = new WeakSet();

        document.querySelectorAll('.mwi-required-materials').forEach((el) => el.remove());

        this.initialized = false;
    }
}

const requiredMaterials = new RequiredMaterials();
export default requiredMaterials;
