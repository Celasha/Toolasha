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
    elements.forEach((el) => el.parentNode?.removeChild(el));
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
    clone.querySelectorAll('.insertedSpan, .script-injected').forEach((el) => el.remove());

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
 * Dismiss all open MUI tooltips by dispatching mouseleave events
 * Useful when DOM elements are reordered (e.g., sorting action panels)
 * which can cause tooltips to get "stuck" since no natural mouseleave fires
 */
export function dismissTooltips() {
    const tooltips = document.querySelectorAll('.MuiTooltip-popper');
    tooltips.forEach((tooltip) => {
        // Find the element that triggered this tooltip and dispatch mouseleave
        // MUI tooltips listen for mouseleave on the trigger element
        const triggerId = tooltip.id?.replace('-tooltip', '');
        if (triggerId) {
            const trigger = document.querySelector(`[aria-describedby="${tooltip.id}"]`);
            if (trigger) {
                if (trigger.matches(':hover')) {
                    return;
                }
                trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }
        }
    });
}

/**
 * Set up scroll listener to dismiss tooltips when scrolling
 * Prevents tooltips from getting stuck when scrolling quickly
 * @returns {Function} Cleanup function to remove the listener
 */
export function setupScrollTooltipDismissal() {
    let scrollTimeout = null;
    let lastUserScrollTime = 0;
    const USER_SCROLL_WINDOW_MS = 200;

    const markUserScroll = () => {
        lastUserScrollTime = Date.now();
    };

    const handleUserKeyScroll = (event) => {
        const key = event.key;
        if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown' || key === ' ') {
            markUserScroll();
        }
    };

    const handleScroll = (event) => {
        const target = event.target;
        if (target?.closest?.('.MuiTooltip-tooltip, .MuiTooltip-popper')) {
            return;
        }

        if (Date.now() - lastUserScrollTime > USER_SCROLL_WINDOW_MS) {
            return;
        }

        // Early exit: skip if no tooltips are visible
        if (!document.querySelector('.MuiTooltip-popper')) {
            return;
        }

        // Debounce: only dismiss after scrolling stops for 50ms
        // This prevents excessive calls during continuous scrolling
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(() => {
            dismissTooltips();
            scrollTimeout = null;
        }, 50);
    };

    // Listen on document with capture to catch all scroll events
    // (including scrolls in nested containers)
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    // Track user-driven scrolling intent
    document.addEventListener('wheel', markUserScroll, { capture: true, passive: true });
    document.addEventListener('touchmove', markUserScroll, { capture: true, passive: true });
    document.addEventListener('keydown', handleUserKeyScroll, { capture: true });

    // Return cleanup function
    return () => {
        document.removeEventListener('scroll', handleScroll, { capture: true });
        document.removeEventListener('wheel', markUserScroll, { capture: true });
        document.removeEventListener('touchmove', markUserScroll, { capture: true });
        document.removeEventListener('keydown', handleUserKeyScroll, { capture: true });
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
    };
}

/** Smallest scale a too-tall tooltip is shrunk to; below this it is unreadable, so the bottom is cut instead */
const TOOLTIP_MIN_SCALE = 0.5;
const TOOLTIP_VIEWPORT_MARGIN = 10;

/**
 * Shrink a tooltip's content so it fits the viewport height. The game's tooltips are
 * non-interactive (pointer-events: none), so they cannot be scrolled - scaling is the only way to
 * show all of a tall one. Measured from the layout height, which a scale() does not change, so
 * calling this again as more content arrives always starts from the true size.
 * @param {Element|null} tooltipContent - The .MuiTooltip-tooltip element
 * @param {number} viewportHeight - Viewport height in px
 * @param {string} origin - CSS transform-origin for the scale
 * @returns {number} The applied scale (1 when no shrinking is needed)
 */
function fitTooltipContentScale(tooltipContent, viewportHeight, origin) {
    if (!tooltipContent) return 1;

    const contentHeight = tooltipContent.offsetHeight;
    const available = viewportHeight - 2 * TOOLTIP_VIEWPORT_MARGIN;
    const scale =
        contentHeight > available && contentHeight > 0 ? Math.max(TOOLTIP_MIN_SCALE, available / contentHeight) : 1;

    if (scale < 1) {
        tooltipContent.style.maxHeight = 'none';
        tooltipContent.style.overflow = 'visible';
        tooltipContent.style.transformOrigin = origin;
        tooltipContent.style.transform = `scale(${scale})`;
    } else if (tooltipContent.style.transform) {
        tooltipContent.style.transform = '';
        tooltipContent.style.transformOrigin = '';
    }
    return scale;
}

/**
 * Fix tooltip overflow to ensure it stays within viewport. A tooltip taller than the viewport is
 * scaled down to fit (see fitTooltipContentScale) and pinned to the top.
 * @param {Element} tooltipElement - The tooltip popper element
 * @param {Object} [options={}]
 * @param {boolean} [options.forceTop=false] - Pin the tooltip centered at the top of the viewport
 */
export function fixTooltipOverflow(tooltipElement, { forceTop = false } = {}) {
    // Use triple requestAnimationFrame to ensure MUI positioning is complete
    // Frame 1: MUI does initial positioning
    // Frame 2: Content finishes rendering (especially for long lists)
    // Frame 3: We check and fix overflow
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!tooltipElement.isConnected) {
                    return; // Tooltip already removed
                }

                const bBox = tooltipElement.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;

                // Find the actual tooltip content element (child of popper)
                const tooltipContent = tooltipElement.querySelector('.MuiTooltip-tooltip');

                if (forceTop) {
                    // Use position:fixed to place tooltip at top-center, bypassing
                    // MUI's transform-based positioning which breaks at low browser
                    // zoom levels (the offset parent may not be at viewport origin).
                    fitTooltipContentScale(tooltipContent, viewportHeight, 'top center');
                    const targetTop = TOOLTIP_VIEWPORT_MARGIN;
                    const targetLeft = Math.round((viewportWidth - bBox.width) / 2);

                    tooltipElement.style.position = 'fixed';
                    tooltipElement.style.top = `${targetTop}px`;
                    tooltipElement.style.left = `${targetLeft}px`;
                    tooltipElement.style.transform = 'none';
                    return;
                }

                const scale = fitTooltipContentScale(tooltipContent, viewportHeight, 'top left');
                // The popper's own box keeps its unscaled size; the scaled content is what is visible
                const contentHeight = tooltipContent ? tooltipContent.offsetHeight : bBox.height;
                const visibleHeight = bBox.height - contentHeight + contentHeight * scale;
                const visibleBottom = bBox.top + visibleHeight;

                // Check if tooltip extends beyond viewport
                if (bBox.top < 0 || visibleBottom > viewportHeight) {
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

                            if (visibleHeight >= viewportHeight - 2 * TOOLTIP_VIEWPORT_MARGIN) {
                                // Still taller than viewport at the smallest scale - position at top
                                newY = 0;
                            } else if (bBox.top < 0) {
                                // Tooltip extends above viewport - move it down
                                newY = currentY - bBox.top;
                            } else if (visibleBottom > viewportHeight) {
                                // Tooltip extends below viewport - move it up
                                newY = currentY - (visibleBottom - viewportHeight) - 10;
                            }

                            if (newY !== undefined) {
                                // Ensure tooltip never goes above viewport (minimum y=0)
                                newY = Math.max(0, newY);
                                tooltipElement.style.transform = `translate3d(${x}, ${newY}px, ${z})`;
                            }
                        }
                    }
                }
            });
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
    dismissTooltips,
    setupScrollTooltipDismissal,
    fixTooltipOverflow,
};
