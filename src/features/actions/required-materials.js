/**
 * Required Materials Display
 * Shows total required materials and missing amounts for production actions
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { GAME } from '../../utils/selectors.js';
import { numberFormatter } from '../../utils/formatters.js';

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

                // Parse per-action requirement (format: "X / Y")
                const match = inputText.match(/\/\s*([\d,\.]+)/);
                const perActionAmount = match ? this.parseAmount(match[1]) : 0;

                if (perActionAmount > 0) {
                    const totalRequired = perActionAmount * numActions;
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
                        displaySpan.style.color = config.COLOR_LOSS; // Red
                    } else {
                        displaySpan.style.color = config.COLOR_WARNING; // Gold/orange
                    }

                    displaySpan.textContent = text;

                    // Append to target container
                    targetContainer.appendChild(displaySpan);
                }

                materialIndex++;
            }
        });
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
