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
import { findActionInput, attachInputListeners, performInitialUpdate } from '../../utils/action-panel-helper.js';

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
        // Find the input box using utility
        const inputBox = findActionInput(detailPanel);
        if (!inputBox) {
            return;
        }

        // Avoid duplicate observers
        if (this.observedInputs.has(inputBox)) {
            return;
        }

        // Attach input listeners using utility
        const cleanup = attachInputListeners(detailPanel, inputBox, (value) => {
            this.updateOutputTotals(detailPanel, inputBox);
        });

        // Store cleanup function
        this.observedInputs.set(inputBox, cleanup);

        // Initial update if there's already a value
        performInitialUpdate(inputBox, () => {
            this.updateOutputTotals(detailPanel, inputBox);
        });
    }

    /**
     * Update output totals based on input value
     * @param {HTMLElement} detailPanel - The action detail panel
     * @param {HTMLInputElement} inputBox - The action count input
     */
    updateOutputTotals(detailPanel, inputBox) {
        const amount = parseFloat(inputBox.value);

        // Remove existing totals (cloned outputs)
        detailPanel.querySelectorAll('.mwi-output-total').forEach(el => el.remove());

        // No amount entered - nothing to calculate
        if (isNaN(amount) || amount <= 0) {
            return;
        }

        // Find main drop container
        let dropTable = detailPanel.querySelector('[class*="SkillActionDetail_dropTable"]');
        if (!dropTable) return;

        const outputItems = detailPanel.querySelector('[class*="SkillActionDetail_outputItems"]');
        if (outputItems) dropTable = outputItems;

        // Track processed containers to avoid duplicates
        const processedContainers = new Set();

        // Process main outputs
        this.processDropContainer(dropTable, amount);
        processedContainers.add(dropTable);

        // Process Essences and Rares - find all dropTable containers
        const allDropTables = detailPanel.querySelectorAll('[class*="SkillActionDetail_dropTable"]');

        allDropTables.forEach(container => {
            if (processedContainers.has(container)) {
                return;
            }

            // Check for essences
            if (container.innerText.toLowerCase().includes('essence')) {
                this.processDropContainer(container, amount);
                processedContainers.add(container);
                return;
            }

            // Check for rares (< 5% drop rate, not essences)
            if (container.innerText.includes('%')) {
                const percentageMatch = container.innerText.match(/([\d\.]+)%/);
                if (percentageMatch && parseFloat(percentageMatch[1]) < 5) {
                    this.processDropContainer(container, amount);
                    processedContainers.add(container);
                }
            }
        });
    }

    /**
     * Process drop container (matches MWIT-E implementation)
     * @param {HTMLElement} container - The drop table container
     * @param {number} amount - Number of actions
     */
    processDropContainer(container, amount) {
        if (!container) return;

        const children = Array.from(container.children);

        children.forEach((child) => {
            // Skip if this child already has a total next to it
            if (child.nextSibling?.classList?.contains('mwi-output-total')) {
                return;
            }

            // Check if this child has multiple drop elements
            const hasDropElements = child.children.length > 1 &&
                                   child.querySelector('[class*="SkillActionDetail_drop"]');

            if (hasDropElements) {
                // Process multiple drop elements (typical for outputs/essences/rares)
                const dropElements = child.querySelectorAll('[class*="SkillActionDetail_drop"]');
                dropElements.forEach(dropEl => {
                    // Skip if this drop element already has a total
                    if (dropEl.nextSibling?.classList?.contains('mwi-output-total')) {
                        return;
                    }
                    const clone = this.processChildElement(dropEl, amount);
                    if (clone) {
                        dropEl.after(clone);
                    }
                });
            } else {
                // Process single element
                const clone = this.processChildElement(child, amount);
                if (clone) {
                    child.parentNode.insertBefore(clone, child.nextSibling);
                }
            }
        });
    }

    /**
     * Process a single child element and return clone with calculated total
     * @param {HTMLElement} child - The child element to process
     * @param {number} amount - Number of actions
     * @returns {HTMLElement|null} Clone element or null
     */
    processChildElement(child, amount) {
        // Look for output element (first child with numbers or ranges)
        const hasRange = child.children[0]?.innerText?.includes('-');
        const hasNumbers = child.children[0]?.innerText?.match(/[\d\.]+/);

        const outputElement = (hasRange || hasNumbers) ? child.children[0] : null;

        if (!outputElement) return null;

        // Extract drop rate from the child's text
        const dropRateText = child.innerText;
        const rateMatch = dropRateText.match(/~?([\d\.]+)%/);
        const dropRate = rateMatch ? parseFloat(rateMatch[1]) / 100 : 1; // Default to 100%

        // Parse output values
        const output = outputElement.innerText.split('-');

        // Create styled clone (same as MWIT-E)
        const clone = outputElement.cloneNode(true);
        clone.classList.add('mwi-output-total');

        // Determine color based on item type
        let color = config.COLOR_INFO; // Default blue for outputs

        if (child.innerText.toLowerCase().includes('essence')) {
            color = config.COLOR_ESSENCE; // Purple for essences
        } else if (dropRate < 0.05) {
            color = config.COLOR_WARNING; // Orange for rares (< 5% drop)
        }

        clone.style.cssText = `
            color: ${color};
            font-weight: 600;
            margin-top: 2px;
        `;

        // Calculate and set the expected output
        if (output.length > 1) {
            // Range output (e.g., "1.3 - 4")
            const minOutput = parseFloat(output[0].trim());
            const maxOutput = parseFloat(output[1].trim());
            const expectedMin = (minOutput * amount * dropRate).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            const expectedMax = (maxOutput * amount * dropRate).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            clone.innerText = `${expectedMin} - ${expectedMax}`;
        } else {
            // Single value output
            const value = parseFloat(output[0].trim());
            const expectedValue = (value * amount * dropRate).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            clone.innerText = `${expectedValue}`;
        }

        return clone;
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
