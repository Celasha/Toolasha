/**
 * Quick Input Buttons Module
 *
 * Adds quick action buttons (10, 100, 1000, Max) to action panels
 * for fast queue input without manual typing.
 *
 * Features:
 * - Preset buttons: 10, 100, 1000
 * - Max button (fills to maximum inventory amount)
 * - Works on all action panels (gathering, production, combat)
 * - Uses React's internal _valueTracker for proper state updates
 * - Auto-detects input fields and injects buttons
 */

import dataManager from '../../core/data-manager.js';

/**
 * QuickInputButtons class manages quick input button injection
 */
class QuickInputButtons {
    constructor() {
        this.isInitialized = false;
        this.observer = null;
        this.presetValues = [10, 100, 1000];
    }

    /**
     * Initialize the quick input buttons feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        // Start observing for action panels
        this.startObserving();
        this.isInitialized = true;
    }

    /**
     * Start MutationObserver to detect action panels
     */
    startObserving() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // Look for main action detail panel (not sub-elements)
                    const actionPanel = node.querySelector?.('[class*="SkillActionDetail_skillActionDetail"]');
                    if (actionPanel) {
                        this.injectButtons(actionPanel);
                    } else if (node.className && typeof node.className === 'string' &&
                               node.className.includes('SkillActionDetail_skillActionDetail')) {
                        this.injectButtons(node);
                    }
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Inject quick input buttons into action panel
     * @param {HTMLElement} panel - Action panel element
     */
    injectButtons(panel) {
        try {
            // Check if already injected
            if (panel.querySelector('.mwi-quick-input-buttons')) {
                return;
            }

            // Find the number input field
            let numberInput = panel.querySelector('input[type="number"]');
            if (!numberInput) {
                // Try finding input within maxActionCountInput container
                const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
                if (inputContainer) {
                    numberInput = inputContainer.querySelector('input');
                }
            }
            if (!numberInput) {
                return;
            }

            // Find our time display element (created by action-time-display.js)
            // This is where we'll insert the buttons (right after it)
            const timeDisplay = document.querySelector('#mwi-action-time-display');
            if (!timeDisplay) {
                // Time display not ready yet, try again in a moment
                setTimeout(() => this.injectButtons(panel), 100);
                return;
            }

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'mwi-quick-input-buttons';
            buttonContainer.style.cssText = `
                margin-top: 4px;
                margin-bottom: 4px;
                text-align: left;
                color: var(--text-color-secondary, #888);
            `;

            // Add "Do " label
            buttonContainer.appendChild(document.createTextNode('Do '));

            // Add preset value buttons
            this.presetValues.forEach(value => {
                const button = this.createButton(value.toLocaleString(), () => {
                    this.setInputValue(numberInput, value);
                });
                buttonContainer.appendChild(button);
            });

            // Add Max button
            const maxButton = this.createButton('Max', () => {
                const maxValue = this.calculateMaxValue(panel);
                if (maxValue > 0) {
                    this.setInputValue(numberInput, maxValue);
                }
            });
            buttonContainer.appendChild(maxButton);

            // Add " times" label
            buttonContainer.appendChild(document.createTextNode(' times'));

            // Insert buttons right after the time display
            // This matches original MWI Tools positioning (after showTotalTimeDiv)
            timeDisplay.parentNode.insertBefore(buttonContainer, timeDisplay.nextSibling);

        } catch (error) {
            console.error('[MWI Tools] Error injecting quick input buttons:', error);
        }
    }

    /**
     * Create a quick input button
     * @param {string} label - Button label
     * @param {Function} onClick - Click handler
     * @returns {HTMLElement} Button element
     */
    createButton(label, onClick) {
        const button = document.createElement('button');
        button.textContent = label;
        button.className = 'mwi-quick-input-btn';
        button.style.cssText = `
            background-color: white;
            color: black;
            padding: 1px 6px;
            margin: 1px;
            border: 1px solid #ccc;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.9em;
        `;

        // Hover effect
        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#f0f0f0';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'white';
        });

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        return button;
    }

    /**
     * Set input value using React's internal _valueTracker
     * This is the critical "hack" to make React recognize the change
     * @param {HTMLInputElement} input - Number input element
     * @param {number} value - Value to set
     */
    setInputValue(input, value) {
        // Save the current value
        const lastValue = input.value;

        // Set the new value directly on the DOM
        input.value = value;

        // Create input event
        const event = new Event('input', { bubbles: true });
        event.simulated = true;

        // This is the critical part: React stores an internal _valueTracker
        // We need to set it to the old value before dispatching the event
        // so React sees the difference and updates its state
        const tracker = input._valueTracker;
        if (tracker) {
            tracker.setValue(lastValue);
        }

        // Dispatch the event - React will now recognize the change
        input.dispatchEvent(event);

        // Focus the input to show the value
        input.focus();
    }

    /**
     * Calculate maximum possible value based on inventory
     * @param {HTMLElement} panel - Action panel element
     * @returns {number} Maximum value
     */
    calculateMaxValue(panel) {
        try {
            // For now, return a sensible default max (10000)
            // TODO: Calculate based on actual inventory/materials available
            return 10000;
        } catch (error) {
            console.error('[MWI Tools] Error calculating max value:', error);
            return 10000;
        }
    }
}

// Create and export singleton instance
const quickInputButtons = new QuickInputButtons();

export default quickInputButtons;
