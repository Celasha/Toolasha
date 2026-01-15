/**
 * Action Panel Display Helper
 * Utilities for working with action detail panels (gathering, production, enhancement)
 */

/**
 * Find the action count input field within a panel
 * @param {HTMLElement} panel - The action detail panel
 * @returns {HTMLInputElement|null} The input element or null if not found
 */
export function findActionInput(panel) {
    const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
    if (!inputContainer) {
        return null;
    }

    const inputField = inputContainer.querySelector('input');
    return inputField || null;
}

/**
 * Attach input listeners to an action panel for tracking value changes
 * Sets up three listeners:
 * - keyup: For manual typing
 * - input: For quick input button clicks (React dispatches input events)
 * - panel click: For any panel interactions with 50ms delay
 *
 * @param {HTMLElement} panel - The action detail panel
 * @param {HTMLInputElement} input - The input element
 * @param {Function} updateCallback - Callback function(value) called on input changes
 * @param {Object} options - Optional configuration
 * @param {number} options.clickDelay - Delay in ms for panel click handler (default: 50)
 * @returns {Function} Cleanup function to remove all listeners
 */
export function attachInputListeners(panel, input, updateCallback, options = {}) {
    const { clickDelay = 50 } = options;

    // Handler for keyup and input events
    const updateHandler = () => {
        updateCallback(input.value);
    };

    // Handler for panel clicks (with delay to allow React updates)
    const panelClickHandler = (event) => {
        // Skip if click is on the input box itself
        if (event.target === input) {
            return;
        }
        setTimeout(() => {
            updateCallback(input.value);
        }, clickDelay);
    };

    // Attach all listeners
    input.addEventListener('keyup', updateHandler);
    input.addEventListener('input', updateHandler);
    panel.addEventListener('click', panelClickHandler);

    // Return cleanup function
    return () => {
        input.removeEventListener('keyup', updateHandler);
        input.removeEventListener('input', updateHandler);
        panel.removeEventListener('click', panelClickHandler);
    };
}

/**
 * Perform initial update if input already has a valid value
 * @param {HTMLInputElement} input - The input element
 * @param {Function} updateCallback - Callback function(value) called if valid
 * @returns {boolean} True if initial update was performed
 */
export function performInitialUpdate(input, updateCallback) {
    if (input.value && parseInt(input.value) > 0) {
        updateCallback(input.value);
        return true;
    }
    return false;
}
