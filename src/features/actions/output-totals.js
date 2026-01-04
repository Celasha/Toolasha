/**
 * Output Totals Display Module
 *
 * Shows total expected outputs below per-action outputs when user enters
 * a quantity in the action input box.
 *
 * Example:
 * - Game shows: "Outputs: 1.3 - 3.9 Flax"
 * - User enters: 100 actions
 * - Module shows: "130.0 - 390.0" below the per-action output
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';

class OutputTotals {
    constructor() {
        this.observedInputs = new Map(); // input element → cleanup function
        this.unregisterObserver = null;
    }

    /**
     * Initialize the output totals display
     */
    initialize() {
        if (!config.getSetting('actionPanel_outputTotals')) {
            return;
        }

        this.setupObserver();
    }

    /**
     * Setup DOM observer to watch for action detail panels
     */
    setupObserver() {
        // Watch for action detail panels appearing
        // The game shows action details when you click an action
        this.unregisterObserver = domObserver.onClass(
            'OutputTotals',
            'SkillActionDetail_skillActionDetail',
            (detailPanel) => {
                this.attachToActionPanel(detailPanel);
            }
        );
    }

    /**
     * Attach input listener to an action panel
     * @param {HTMLElement} detailPanel - The action detail panel element
     */
    attachToActionPanel(detailPanel) {
        // Find the input box where user enters action count
        const inputBox = detailPanel.querySelector('input[type="number"]');

        if (!inputBox) {
            return;
        }

        // Avoid duplicate observers
        if (this.observedInputs.has(inputBox)) {
            return;
        }

        // Add input listener
        const updateHandler = () => {
            this.updateOutputTotals(detailPanel, inputBox);
        };

        inputBox.addEventListener('input', updateHandler);
        inputBox.addEventListener('change', updateHandler);

        // Store cleanup function
        this.observedInputs.set(inputBox, () => {
            inputBox.removeEventListener('input', updateHandler);
            inputBox.removeEventListener('change', updateHandler);
        });

        // Initial update if there's already a value
        if (inputBox.value && inputBox.value > 0) {
            this.updateOutputTotals(detailPanel, inputBox);
        }
    }

    /**
     * Update output totals based on input value
     * @param {HTMLElement} detailPanel - The action detail panel
     * @param {HTMLInputElement} inputBox - The action count input
     */
    updateOutputTotals(detailPanel, inputBox) {
        const amount = parseFloat(inputBox.value);

        // Remove existing totals
        detailPanel.querySelectorAll('.mwi-output-total').forEach(el => el.remove());

        // No amount entered - nothing to calculate
        if (isNaN(amount) || amount <= 0) {
            return;
        }

        // Find all output containers
        // The game uses different sections for different drop types
        const outputsSection = detailPanel.querySelector('div[class*="SkillActionDetail_drops"]');
        const essencesSection = detailPanel.querySelector('div[class*="SkillActionDetail_essences"]');
        const raresSection = detailPanel.querySelector('div[class*="SkillActionDetail_rares"]');

        // Process each section with appropriate color
        if (outputsSection) {
            this.processOutputSection(outputsSection, amount, config.COLOR_INFO);
        }
        if (essencesSection) {
            this.processOutputSection(essencesSection, amount, '#9D4EDD'); // Purple for essences
        }
        if (raresSection) {
            this.processOutputSection(raresSection, amount, config.COLOR_WARNING);
        }
    }

    /**
     * Process a single output section (outputs, essences, or rares)
     * @param {HTMLElement} section - The section container
     * @param {number} amount - Number of actions
     * @param {string} color - Color for the total display
     */
    processOutputSection(section, amount, color) {
        // Find all drop elements within this section
        const dropElements = section.querySelectorAll('div[class*="SkillActionDetail_drop"]');

        dropElements.forEach(dropElement => {
            // Find the output text (e.g., "1.3 - 3.9")
            const outputText = this.extractOutputText(dropElement);

            if (!outputText) {
                return;
            }

            // Find drop rate if present (e.g., "~3%")
            const dropRate = this.extractDropRate(dropElement);

            // Calculate totals
            const totalText = this.calculateTotal(outputText, amount, dropRate);

            if (!totalText) {
                return;
            }

            // Create and insert total display
            const totalElement = this.createTotalElement(totalText, color);

            // Insert after the output text
            // The first child typically contains the output count/range
            const firstChild = dropElement.children[0];
            if (firstChild) {
                firstChild.after(totalElement);
            } else {
                dropElement.appendChild(totalElement);
            }
        });
    }

    /**
     * Extract output text from drop element
     * @param {HTMLElement} dropElement - The drop element
     * @returns {string|null} Output text or null
     */
    extractOutputText(dropElement) {
        // The first child typically contains the output count/range
        const firstChild = dropElement.children[0];

        if (!firstChild) {
            return null;
        }

        const text = firstChild.innerText.trim();

        // Check if it looks like an output (contains numbers or ranges)
        if (text.match(/[\d\.]+(\s*-\s*[\d\.]+)?/)) {
            return text;
        }

        return null;
    }

    /**
     * Extract drop rate from drop element
     * @param {HTMLElement} dropElement - The drop element
     * @returns {number} Drop rate (0.0 to 1.0)
     */
    extractDropRate(dropElement) {
        // Look for percentage text like "~3%" or "3%"
        const text = dropElement.innerText;
        const match = text.match(/~?([\d\.]+)%/);

        if (match) {
            return parseFloat(match[1]) / 100; // Convert 3% to 0.03
        }

        return 1.0; // Default to 100% (guaranteed drop)
    }

    /**
     * Calculate total output
     * @param {string} outputText - Output text (e.g., "1.3 - 3.9" or "1")
     * @param {number} amount - Number of actions
     * @param {number} dropRate - Drop rate (0.0 to 1.0)
     * @returns {string|null} Formatted total or null
     */
    calculateTotal(outputText, amount, dropRate) {
        // Parse output text
        // Could be: "1.3 - 3.9" (range) or "1" (single value)

        if (outputText.includes('-')) {
            // Range output
            const parts = outputText.split('-');
            const minOutput = parseFloat(parts[0].trim());
            const maxOutput = parseFloat(parts[1].trim());

            if (isNaN(minOutput) || isNaN(maxOutput)) {
                return null;
            }

            const expectedMin = (minOutput * amount * dropRate).toFixed(1);
            const expectedMax = (maxOutput * amount * dropRate).toFixed(1);

            return `${expectedMin} - ${expectedMax}`;
        } else {
            // Single value
            const value = parseFloat(outputText);

            if (isNaN(value)) {
                return null;
            }

            const expectedValue = (value * amount * dropRate).toFixed(1);
            return expectedValue;
        }
    }

    /**
     * Create total display element
     * @param {string} totalText - Total text to display
     * @param {string} color - Color for the text
     * @returns {HTMLElement} The total element
     */
    createTotalElement(totalText, color) {
        const element = document.createElement('div');
        element.className = 'mwi-output-total';
        element.style.cssText = `
            color: ${color};
            font-weight: 600;
            margin-top: 2px;
            font-size: 0.95em;
        `;
        element.textContent = totalText;

        return element;
    }

    /**
     * Disable the output totals display
     */
    disable() {
        // Clean up all input observers
        for (const cleanup of this.observedInputs.values()) {
            cleanup();
        }
        this.observedInputs.clear();

        // Unregister DOM observer
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Remove all injected elements
        document.querySelectorAll('.mwi-output-total').forEach(el => el.remove());
    }
}

// Create and export singleton instance
const outputTotals = new OutputTotals();

export default outputTotals;
