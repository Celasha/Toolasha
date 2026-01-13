/**
 * Required Materials Display
 * Shows total required materials and missing amounts for production actions
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { GAME } from '../../utils/selectors.js';
import { numberFormatter } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import { parseArtisanBonus, getDrinkConcentration } from '../../utils/tea-parser.js';

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

        panels.forEach(panel => {
            // Skip if already processed
            if (this.processedPanels.has(panel)) {
                return;
            }

            // Find the number input field (same logic as quick-input-buttons)
            let inputField = panel.querySelector('input[type="number"]');
            if (!inputField) {
                // Try finding input within maxActionCountInput container
                const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
                if (inputContainer) {
                    inputField = inputContainer.querySelector('input');
                }
            }

            if (!inputField) {
                return;
            }

            // Mark as processed
            this.processedPanels.add(panel);

            // Attach input listener
            inputField.addEventListener('input', () => {
                this.updateRequiredMaterials(panel, inputField.value);
            });

            // Check if input already has a value and display materials
            if (inputField.value && parseInt(inputField.value) > 0) {
                this.updateRequiredMaterials(panel, inputField.value);
            }

            // Also listen for button clicks that change the input
            // This catches quick input buttons and Max button
            panel.addEventListener('click', (e) => {
                if (e.target.matches('button')) {
                    setTimeout(() => {
                        this.updateRequiredMaterials(panel, inputField.value);
                    }, 50);
                }
            });
        });
    }

    updateRequiredMaterials(panel, amount) {
        // Remove existing displays
        const existingDisplays = panel.querySelectorAll('.mwi-required-materials');
        existingDisplays.forEach(el => el.remove());

        const numActions = parseInt(amount) || 0;
        if (numActions <= 0) {
            return;
        }

        // Find requirements container
        const requiresDiv = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
        if (!requiresDiv) {
            return;
        }

        // Get artisan bonus for material reduction calculation
        const artisanBonus = this.getArtisanBonus(panel);

        // Get base material requirements from action details
        const baseMaterialRequirements = this.getBaseMaterialRequirements(panel);

        // Get inventory spans and input spans
        const inventorySpans = panel.querySelectorAll('[class*="SkillActionDetail_inventoryCount"]');
        const inputSpans = Array.from(panel.querySelectorAll('[class*="SkillActionDetail_inputCount"]'))
            .filter(span => !span.textContent.includes('Required'));

        // Process each material using MWIT-E's approach
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
                const inputText = inputSpans[materialIndex].textContent.trim();

                // Parse inventory amount (handle K/M suffixes)
                const invValue = this.parseAmount(invText);

                // Get base requirement from action details (not from UI - UI rounds the value)
                const materialReq = baseMaterialRequirements[materialIndex];
                if (!materialReq || materialReq.count <= 0) {
                    materialIndex++;
                    return;
                }

                // Apply artisan reduction ONLY to regular materials (not upgrade items)
                // Materials are consumed PER ACTION
                // Efficiency gives bonus actions for FREE (no material cost)
                const materialsPerAction = materialReq.isUpgradeItem
                    ? materialReq.count
                    : materialReq.count * (1 - artisanBonus);

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
     * Get base material requirements from action details
     * @param {HTMLElement} panel - Action panel element
     * @returns {Array<number>} Array of base material counts
     */
    getBaseMaterialRequirements(panel) {
        try {
            // Get action name from panel
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!actionNameElement) {
                return [];
            }

            const actionName = actionNameElement.textContent.trim();

            // Look up action details
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.actionDetailMap) {
                return [];
            }

            let actionDetails = null;
            for (const [hrid, details] of Object.entries(gameData.actionDetailMap)) {
                if (details.name === actionName) {
                    actionDetails = details;
                    break;
                }
            }

            if (!actionDetails) {
                return [];
            }

            const requirements = [];

            // Add upgrade item first if it exists (shown first in UI)
            // Upgrade items are NOT affected by Artisan Tea
            if (actionDetails.upgradeItemHrid) {
                requirements.push({
                    count: 1,
                    isUpgradeItem: true  // Flag to skip artisan reduction
                });
            }

            // Add regular input items (affected by Artisan Tea)
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                actionDetails.inputItems.forEach(item => {
                    requirements.push({
                        count: item.count || 0,
                        isUpgradeItem: false
                    });
                });
            }

            // Return array of requirement objects in order
            return requirements;

        } catch (error) {
            console.error('[Required Materials] Error getting base requirements:', error);
            return [];
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
            for (const [hrid, details] of Object.entries(gameData.actionDetailMap)) {
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
        this.observers.forEach(unregister => unregister());
        this.observers = [];
        this.processedPanels = new WeakSet();

        document.querySelectorAll('.mwi-required-materials').forEach(el => el.remove());

        this.initialized = false;
    }
}

const requiredMaterials = new RequiredMaterials();
export default requiredMaterials;
