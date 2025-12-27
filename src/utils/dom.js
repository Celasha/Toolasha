/**
 * DOM Utilities Module
 * Helpers for DOM manipulation and element creation
 */

import config from '../core/config.js';

// Compiled regex pattern (created once, reused for performance)
const REGEX_TRANSFORM3D = /translate3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/;

/**
 * Wait for an element to appear in the DOM
 * @param {string} selector - CSS selector
 * @param {number} timeout - Max wait time in ms (default: 10000)
 * @param {number} interval - Check interval in ms (default: 100)
 * @returns {Promise<Element|null>} The element or null if timeout
 */
export function waitForElement(selector, timeout = 10000, interval = 100) {
    return new Promise((resolve) => {
        const startTime = Date.now();

        const check = () => {
            const element = document.querySelector(selector);

            if (element) {
                resolve(element);
            } else if (Date.now() - startTime >= timeout) {
                console.warn(`[DOM] Timeout waiting for: ${selector}`);
                resolve(null);
            } else {
                setTimeout(check, interval);
            }
        };

        check();
    });
}

/**
 * Wait for multiple elements to appear
 * @param {string} selector - CSS selector
 * @param {number} minCount - Minimum number of elements to wait for (default: 1)
 * @param {number} timeout - Max wait time in ms (default: 10000)
 * @returns {Promise<NodeList|null>} The elements or null if timeout
 */
export function waitForElements(selector, minCount = 1, timeout = 10000) {
    return new Promise((resolve) => {
        const startTime = Date.now();

        const check = () => {
            const elements = document.querySelectorAll(selector);

            if (elements.length >= minCount) {
                resolve(elements);
            } else if (Date.now() - startTime >= timeout) {
                console.warn(`[DOM] Timeout waiting for ${minCount}× ${selector}`);
                resolve(null);
            } else {
                setTimeout(check, 100);
            }
        };

        check();
    });
}

/**
 * Create a styled div element
 * @param {Object} styles - CSS styles object
 * @param {string} text - Optional text content
 * @param {string} className - Optional class name
 * @returns {HTMLDivElement} Created div
 */
export function createStyledDiv(styles = {}, text = '', className = '') {
    const div = document.createElement('div');

    if (className) {
        div.className = className;
    }

    if (text) {
        div.textContent = text;
    }

    Object.assign(div.style, styles);

    return div;
}

/**
 * Create a styled span element
 * @param {Object} styles - CSS styles object
 * @param {string} text - Text content
 * @param {string} className - Optional class name
 * @returns {HTMLSpanElement} Created span
 */
export function createStyledSpan(styles = {}, text = '', className = '') {
    const span = document.createElement('span');

    if (className) {
        span.className = className;
    }

    if (text) {
        span.textContent = text;
    }

    Object.assign(span.style, styles);

    return span;
}

/**
 * Create a colored text span (uses script colors from config)
 * @param {string} text - Text content
 * @param {string} colorType - 'main', 'tooltip', or 'alert' (default: 'main')
 * @returns {HTMLSpanElement} Created span with color
 */
export function createColoredText(text, colorType = 'main') {
    let color;

    switch (colorType) {
        case 'main':
            color = config.SCRIPT_COLOR_MAIN;
            break;
        case 'tooltip':
            color = config.SCRIPT_COLOR_TOOLTIP;
            break;
        case 'alert':
            color = config.SCRIPT_COLOR_ALERT;
            break;
        default:
            color = config.SCRIPT_COLOR_MAIN;
    }

    return createStyledSpan({ color }, text);
}

/**
 * Insert element before another element
 * @param {Element} newElement - Element to insert
 * @param {Element} referenceElement - Element to insert before
 */
export function insertBefore(newElement, referenceElement) {
    if (!referenceElement?.parentNode) {
        console.warn('[DOM] Cannot insert: reference element has no parent');
        return;
    }

    referenceElement.parentNode.insertBefore(newElement, referenceElement);
}

/**
 * Insert element after another element
 * @param {Element} newElement - Element to insert
 * @param {Element} referenceElement - Element to insert after
 */
export function insertAfter(newElement, referenceElement) {
    if (!referenceElement?.parentNode) {
        console.warn('[DOM] Cannot insert: reference element has no parent');
        return;
    }

    referenceElement.parentNode.insertBefore(newElement, referenceElement.nextSibling);
}

/**
 * Remove all elements matching selector
 * @param {string} selector - CSS selector
 * @returns {number} Number of elements removed
 */
export function removeElements(selector) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => el.parentNode?.removeChild(el));
    return elements.length;
}

/**
 * Get original text from element (strips our injected content)
 * @param {Element} element - Element to get text from
 * @returns {string} Original text content
 */
export function getOriginalText(element) {
    if (!element) return '';

    // Clone element to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove inserted spans/divs (our injected content)
    clone.querySelectorAll('.insertedSpan, .script-injected').forEach(el => el.remove());

    return clone.textContent.trim();
}

/**
 * Add CSS to page
 * @param {string} css - CSS rules to add
 * @param {string} id - Optional style element ID (for removal later)
 */
export function addStyles(css, id = '') {
    const style = document.createElement('style');

    if (id) {
        style.id = id;
    }

    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Remove CSS by ID
 * @param {string} id - Style element ID to remove
 */
export function removeStyles(id) {
    const style = document.getElementById(id);
    if (style) {
        style.remove();
    }
}

/**
 * Fix tooltip overflow to ensure it stays within viewport
 * @param {Element} tooltipElement - The tooltip popper element
 */
export function fixTooltipOverflow(tooltipElement) {
    // Use double requestAnimationFrame to ensure MUI positioning is complete
    // First frame: MUI does initial positioning
    // Second frame: We check and fix overflow
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!tooltipElement.isConnected) {
                return; // Tooltip already removed
            }

            const bBox = tooltipElement.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // Find the actual tooltip content element (child of popper)
            const tooltipContent = tooltipElement.querySelector('.MuiTooltip-tooltip');

            // Check if tooltip extends beyond viewport
            if (bBox.top < 0 || bBox.bottom > viewportHeight) {
                // Get current transform
                const transformString = tooltipElement.style.transform;

                if (transformString) {
                    // Parse transform3d(x, y, z)
                    const match = transformString.match(REGEX_TRANSFORM3D);

                    if (match) {
                        const x = match[1];
                        const currentY = parseFloat(match[2]);
                        const z = match[3];

                        // Calculate how much to adjust Y
                        let newY;

                        if (bBox.height >= viewportHeight - 20) {
                            // Tooltip is taller than viewport - position at top with small margin
                            newY = 10;

                            // Force max-height on the tooltip content to enable scrolling
                            if (tooltipContent) {
                                tooltipContent.style.maxHeight = `${viewportHeight - 20}px`;
                                tooltipContent.style.overflowY = 'auto';
                            }
                        } else if (bBox.top < 0) {
                            // Tooltip extends above viewport - move it down
                            newY = currentY - bBox.top + 10;
                        } else if (bBox.bottom > viewportHeight) {
                            // Tooltip extends below viewport - move it up
                            newY = currentY - (bBox.bottom - viewportHeight) - 10;
                        }

                        if (newY !== undefined) {
                            tooltipElement.style.transform = `translate3d(${x}, ${newY}px, ${z})`;
                        }
                    }
                }
            }
        });
    });
}

export default {
    waitForElement,
    waitForElements,
    createStyledDiv,
    createStyledSpan,
    createColoredText,
    insertBefore,
    insertAfter,
    removeElements,
    getOriginalText,
    addStyles,
    removeStyles,
    fixTooltipOverflow
};
