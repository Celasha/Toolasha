/**
 * Required Materials Display
 * Shows total required materials and missing amounts for production actions
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { numberFormatter } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import { calculateMaterialRequirements } from '../../utils/material-calculator.js';
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

        // Get action HRID from panel
        const actionHrid = this.getActionHridFromPanel(panel);
        if (!actionHrid) {
            return;
        }

        // Use shared material calculator with queue accounting (always enabled for Required Materials)
        const materials = calculateMaterialRequirements(actionHrid, numActions, true);
        if (!materials || materials.length === 0) {
            return;
        }

        // Find requirements container for regular materials
        const requiresDiv = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
        if (!requiresDiv) {
            return;
        }

        // Process each material
        const children = Array.from(requiresDiv.children);
        let materialIndex = 0;

        // Separate upgrade items from regular materials
        const regularMaterials = materials.filter((m) => !m.isUpgradeItem);
        const upgradeMaterial = materials.find((m) => m.isUpgradeItem);

        // Process upgrade item first (if exists)
        if (upgradeMaterial) {
            this.processUpgradeItemWithData(panel, upgradeMaterial);
        }

        // Process regular materials
        children.forEach((child, index) => {
            if (child.className && child.className.includes('inputCount')) {
                // Found an inputCount span - the next sibling is our target container
                const targetContainer = requiresDiv.children[index + 1];
                if (!targetContainer) return;

                // Get corresponding material data
                if (materialIndex >= regularMaterials.length) return;
                const material = regularMaterials[materialIndex];

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

                // Build text with queue info
                const queuedText = material.queued > 0 ? ` (${numberFormatter(material.queued)} Q'd)` : '';
                let text = `Required: ${numberFormatter(material.required)}${queuedText}`;

                if (material.missing > 0) {
                    const missingQueuedText = material.queued > 0 ? ` (${numberFormatter(material.queued)} Q'd)` : '';
                    text += ` || Missing: ${numberFormatter(material.missing)}${missingQueuedText}`;
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
     * Process upgrade item display with material data
     * @param {HTMLElement} panel - Action panel element
     * @param {Object} material - Material object from calculateMaterialRequirements
     */
    processUpgradeItemWithData(panel, material) {
        try {
            // Find upgrade item selector container
            const upgradeContainer = panel.querySelector('[class*="SkillActionDetail_upgradeItemSelectorInput"]');
            if (!upgradeContainer) {
                return;
            }

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

            // Build text with queue info
            const queuedText = material.queued > 0 ? ` (${numberFormatter(material.queued)} Q'd)` : '';
            let text = `Required: ${numberFormatter(material.required)}${queuedText}`;

            if (material.missing > 0) {
                const missingQueuedText = material.queued > 0 ? ` (${numberFormatter(material.queued)} Q'd)` : '';
                text += ` || Missing: ${numberFormatter(material.missing)}${missingQueuedText}`;
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
     * Get action HRID from panel
     * @param {HTMLElement} panel - Action panel element
     * @returns {string|null} Action HRID or null
     */
    getActionHridFromPanel(panel) {
        // Get action name from panel
        const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
        if (!actionNameElement) {
            return null;
        }

        const actionName = actionNameElement.textContent.trim();
        return this.getActionHridFromName(actionName);
    }

    /**
     * Convert action name to HRID
     * @param {string} actionName - Display name of action
     * @returns {string|null} Action HRID or null if not found
     */
    getActionHridFromName(actionName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.actionDetailMap) {
            return null;
        }

        // Search for action by name
        for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
            if (detail.name === actionName) {
                return hrid;
            }
        }

        return null;
    }
    cleanup() {
        this.observers.forEach((unregister) => unregister());
        this.observers = [];
        this.processedPanels = new WeakSet();

        document.querySelectorAll('.mwi-required-materials').forEach((el) => el.remove());

        this.initialized = false;
    }

    disable() {
        this.cleanup();
    }
}

const requiredMaterials = new RequiredMaterials();
export default requiredMaterials;
