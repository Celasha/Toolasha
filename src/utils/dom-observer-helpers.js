/**
 * DOM Observer Helper Utilities
 * Standardized wrappers around domObserver to reduce boilerplate
 */

import domObserver from '../core/dom-observer.js';

/**
 * Create a singleton observer that automatically prevents duplicate processing
 * Uses an internal WeakSet to track processed elements
 *
 * @param {string} name - Observer name for debugging
 * @param {string|string[]} classNames - Class name(s) to watch for
 * @param {Function} handler - Handler function (receives element)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.debounce - Enable debouncing
 * @param {number} options.debounceDelay - Debounce delay in ms
 * @returns {Function} Unregister function
 *
 * @example
 * // Before (20 lines)
 * this.processedDivs = new WeakSet();
 * this.unregister = domObserver.onClass('MyFeature', 'selector', (elem) => {
 *     if (this.processedDivs.has(elem)) return;
 *     this.processedDivs.add(elem);
 *     // do work
 * });
 *
 * // After (5 lines)
 * this.unregister = createSingletonObserver('MyFeature', 'selector', (elem) => {
 *     // do work (processed flag automatic)
 * });
 */
export function createSingletonObserver(name, classNames, handler, options = {}) {
    const processedElements = new WeakSet();

    return domObserver.onClass(
        name,
        classNames,
        (element) => {
            // Skip if already processed
            if (processedElements.has(element)) {
                return;
            }

            // Mark as processed
            processedElements.add(element);

            // Call user handler
            handler(element);
        },
        options
    );
}

/**
 * Create a tracked observer that manages cleanup functions for processed elements
 * Uses an internal Map to track element → cleanup function pairs
 * Automatically calls cleanup functions when unregistered
 *
 * @param {string} name - Observer name for debugging
 * @param {string|string[]} classNames - Class name(s) to watch for
 * @param {Function} handler - Handler function (receives element, should return cleanup function or null)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.debounce - Enable debouncing
 * @param {number} options.debounceDelay - Debounce delay in ms
 * @returns {Function} Unregister function (also calls all cleanup functions)
 *
 * @example
 * // Before (15 lines)
 * this.trackedElements = new Map();
 * this.unregister = domObserver.onClass('MyFeature', 'selector', (elem) => {
 *     if (this.trackedElements.has(elem)) return;
 *     const cleanup = attachListeners(...);
 *     this.trackedElements.set(elem, cleanup);
 * });
 *
 * // After (5 lines)
 * this.unregister = createTrackedObserver('MyFeature', 'selector', (elem) => {
 *     return attachListeners(...); // Return cleanup function
 * });
 */
export function createTrackedObserver(name, classNames, handler, options = {}) {
    const trackedElements = new Map();

    const unregister = domObserver.onClass(
        name,
        classNames,
        (element) => {
            // Skip if already tracked
            if (trackedElements.has(element)) {
                return;
            }

            // Call user handler and store cleanup function
            const cleanup = handler(element);
            if (cleanup && typeof cleanup === 'function') {
                trackedElements.set(element, cleanup);
            } else {
                // Mark as tracked even if no cleanup function returned
                trackedElements.set(element, null);
            }
        },
        options
    );

    // Return enhanced unregister that also calls all cleanup functions
    return () => {
        // Call all cleanup functions
        for (const [element, cleanup] of trackedElements.entries()) {
            if (cleanup && typeof cleanup === 'function') {
                try {
                    cleanup();
                } catch (error) {
                    console.error(`[DOM Observer Helpers] Cleanup error for ${name}:`, error);
                }
            }
        }

        // Clear tracked elements
        trackedElements.clear();

        // Unregister from DOM observer
        unregister();
    };
}

/**
 * Create a simplified MutationObserver with automatic cleanup
 * Wrapper around native MutationObserver that returns unwatch function
 *
 * @param {Element} element - Element to observe
 * @param {Function} callback - Callback function (receives mutations, observer)
 * @param {Object} options - MutationObserver options (default: { childList: true, subtree: true })
 * @returns {Function} Unwatch function (disconnects observer)
 *
 * @example
 * // Before (25 lines)
 * let observer = null;
 * const cleanup = () => {
 *     if (observer) {
 *         observer.disconnect();
 *         observer = null;
 *     }
 * };
 * observer = new MutationObserver(() => { ... });
 * observer.observe(element, { childList: true });
 *
 * // After (5 lines)
 * const unwatch = createMutationWatcher(element, () => {
 *     // callback
 * }, { childList: true });
 */
export function createMutationWatcher(element, callback, options = null) {
    if (!element) {
        console.warn('[DOM Observer Helpers] createMutationWatcher called with null element');
        return () => {}; // Return no-op unwatch function
    }

    // Default options
    const observerOptions = options || {
        childList: true,
        subtree: true
    };

    const observer = new MutationObserver((mutations) => {
        callback(mutations, observer);
    });

    observer.observe(element, observerOptions);

    // Return unwatch function
    return () => {
        observer.disconnect();
    };
}

/**
 * Create a persistent display helper
 * Handles cleanup and re-creation of DOM elements on re-render
 *
 * @param {string} name - Helper name for debugging
 * @param {string|string[]} classNames - Class name(s) to watch for
 * @param {Function} createFn - Function to create display element (receives container)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.debounce - Enable debouncing
 * @param {number} options.debounceDelay - Debounce delay in ms
 * @returns {Function} Unregister function
 *
 * @example
 * this.unregister = createPersistentDisplay(
 *     'MyDisplay',
 *     'container-class',
 *     (container) => {
 *         const display = document.createElement('div');
 *         display.className = 'my-display';
 *         display.textContent = 'Hello';
 *         container.appendChild(display);
 *     }
 * );
 */
export function createPersistentDisplay(name, classNames, createFn, options = {}) {
    return createSingletonObserver(name, classNames, (container) => {
        try {
            createFn(container);
        } catch (error) {
            console.error(`[DOM Observer Helpers] createPersistentDisplay error for ${name}:`, error);
        }
    }, options);
}
