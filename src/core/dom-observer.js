/**
 * Centralized DOM Observer
 * Single MutationObserver that dispatches to registered handlers
 * Replaces 15 separate observers watching document.body
 * Supports optional debouncing to reduce CPU usage during bulk DOM changes
 */

import performanceMonitor from '../utils/performance-monitor.js';

class DOMObserver {
    constructor() {
        this.observer = null;
        this.handlers = [];
        this.readyHandlers = []; // Callbacks fired when the shared observer is actually attached to document.body
        this.isObserving = false;
        this.debounceTimers = new Map(); // Track debounce timers per handler
        this.debouncedLatest = new Map(); // Latest { node, mutation } per handler (O(1) per handler)
        this.DEFAULT_DEBOUNCE_DELAY = 50; // 50ms default delay
    }

    /**
     * Whether an added node is, sits inside, or contains an element matching a selector. A cheap check for
     * a handler `filter`, so it only wakes for changes in the part of the page it cares about. A method,
     * because the split libraries only see this module's default instance, never its named exports.
     * @param {Element} node
     * @param {string} selector
     * @returns {boolean}
     */
    touchesSelector(node, selector) {
        return Boolean(node.closest?.(selector) || node.querySelector?.(selector));
    }

    /**
     * Start observing DOM changes
     */
    start() {
        if (this.isObserving) return;

        // Wait for document.body to exist (critical for @run-at document-start)
        const startObserver = () => {
            if (!document.body) {
                // Body doesn't exist yet, wait and try again
                setTimeout(startObserver, 10);
                return;
            }

            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        // Share one lazy descendant snapshot across immediate handlers for this added node.
                        const classSnapshot = {};
                        this.handlers.forEach((handler) => {
                            try {
                                // Before the debounce, so a relevant node is never replaced by a later irrelevant one
                                if (handler.filter && !handler.filter(node)) return;
                                if (handler.debounce) {
                                    this.debouncedCallback(handler, node, mutation);
                                } else {
                                    this.invokeHandler(handler, node, mutation, classSnapshot);
                                }
                            } catch (error) {
                                console.error(`[DOM Observer] Handler error (${handler.name}):`, error);
                            }
                        });
                    }
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            this.isObserving = true;
            this.notifyReadyHandlers();
        };

        startObserver();
    }

    /**
     * Notify handlers that depend on the observer being attached to the current body.
     * Important for @run-at document-start: start() may have returned before document.body existed.
     * @private
     */
    notifyReadyHandlers() {
        for (const handler of [...this.readyHandlers]) {
            try {
                const result = handler.callback();
                if (result && typeof result.catch === 'function') {
                    result.catch((error) => {
                        console.error(`[DOM Observer] Ready handler error (${handler.name}):`, error);
                    });
                }
            } catch (error) {
                console.error(`[DOM Observer] Ready handler error (${handler.name}):`, error);
            }
        }
    }

    /**
     * Register a callback that runs whenever the centralized observer has actually attached to
     * document.body. If it is already attached, the callback runs immediately. This is a bounded
     * lifecycle/catch-up signal, not a polling mechanism.
     * @param {string} name - Handler name for diagnostics
     * @param {Function} callback - Called with no arguments when observing is ready
     * @returns {Function} Unregister function
     */
    onReady(name, callback) {
        const handler = { name, callback };
        this.readyHandlers.push(handler);

        if (this.isObserving) {
            try {
                const result = callback();
                if (result && typeof result.catch === 'function') {
                    result.catch((error) => {
                        console.error(`[DOM Observer] Ready handler error (${name}):`, error);
                    });
                }
            } catch (error) {
                console.error(`[DOM Observer] Ready handler error (${name}):`, error);
            }
        }

        return () => {
            const index = this.readyHandlers.indexOf(handler);
            if (index > -1) this.readyHandlers.splice(index, 1);
        };
    }

    /**
     * Debounced callback handler
     * Collects elements and fires callback after delay
     * @private
     */
    debouncedCallback(handler, node, mutation) {
        const delay = handler.debounceDelay || this.DEFAULT_DEBOUNCE_DELAY;

        // Overwrite with the latest node/mutation — only the last one is ever used
        this.debouncedLatest.set(handler, { node, mutation });

        // Clear existing timer
        if (this.debounceTimers.has(handler)) {
            clearTimeout(this.debounceTimers.get(handler));
        }

        // Set new timer
        const timer = setTimeout(() => {
            const latest = this.debouncedLatest.get(handler);
            this.debouncedLatest.delete(handler);
            this.debounceTimers.delete(handler);

            if (latest) {
                try {
                    // Class matching happens when the timer fires, not when the filter accepts the node.
                    this.invokeHandler(handler, latest.node, latest.mutation);
                } catch (error) {
                    console.error(`[DOM Observer] Handler error (${handler.name}):`, error);
                }
            }
        }, delay);

        this.debounceTimers.set(handler, timer);
    }

    /** @private */
    invokeHandler(handler, node, mutation, classSnapshot) {
        const start = performanceMonitor.enabled ? performance.now() : null;
        if (handler.classNames) {
            this.matchClasses(handler, node, classSnapshot);
        } else {
            handler.callback(node, mutation);
        }
        if (start !== null) {
            performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
        }
    }

    /** @private */
    matchClasses({ callback, classNames }, node, classSnapshot = {}) {
        const className = typeof node.className === 'string' ? node.className : '';
        for (const targetClass of classNames) {
            if (className.includes(targetClass)) {
                callback(node);
                return;
            }
        }

        if (!classNames.length) return;
        if (!classSnapshot.descendants) {
            if (!node.childElementCount) return;
            const descendants = [];
            // The collection is live. Read it before any callbacks can move or add children.
            for (const element of node.getElementsByTagName('*')) {
                const classes =
                    typeof element.className === 'string' ? element.className : element.getAttribute('class');
                if (classes) descendants.push([element, classes]);
            }
            classSnapshot.descendants = descendants;
        }

        // Preserve target order, including one callback per target for descendants matching multiple targets.
        for (const targetClass of classNames) {
            for (const [element, classes] of classSnapshot.descendants) {
                if (classes.includes(targetClass)) callback(element);
            }
        }
    }

    /**
     * Stop observing DOM changes
     */
    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Clear all debounce timers
        this.debounceTimers.forEach((timer) => clearTimeout(timer));
        this.debounceTimers.clear();
        this.debouncedLatest.clear();

        this.isObserving = false;
    }

    /**
     * Register a handler for DOM changes
     * @param {string} name - Handler name for debugging
     * @param {Function} callback - Function to call when nodes are added (receives node, mutation)
     * @param {Object} options - Optional configuration
     * @param {boolean} options.debounce - Enable debouncing (default: false)
     * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
     * @param {function(Element): boolean} [options.filter] - Per added node, run before the debounce; the
     *     handler only fires for nodes it returns true for
     * @returns {Function} Unregister function
     */
    register(name, callback, options = {}) {
        return this.registerHandler(name, callback, options);
    }

    /** @private */
    registerHandler(name, callback, options, classNames) {
        const handler = {
            name,
            callback,
            classNames,
            filter: options.filter,
            debounce: options.debounce || false,
            debounceDelay: options.debounceDelay,
        };
        this.handlers.push(handler);

        // Return unregister function
        return () => {
            const index = this.handlers.indexOf(handler);
            if (index > -1) {
                this.handlers.splice(index, 1);

                // Clean up any pending debounced callbacks
                if (this.debounceTimers.has(handler)) {
                    clearTimeout(this.debounceTimers.get(handler));
                    this.debounceTimers.delete(handler);
                    this.debouncedLatest.delete(handler);
                }
            }
        };
    }

    /**
     * Register a handler for specific class names
     * @param {string} name - Handler name for debugging
     * @param {string|string[]} classNames - Class name(s) to watch for (supports partial matches)
     * @param {Function} callback - Function to call when matching elements appear
     * @param {Object} options - Optional configuration
     * @param {boolean} options.debounce - Enable debouncing (default: false for immediate response)
     * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
     * @param {function(Element): boolean} [options.filter] - Check the added root before scheduling or matching
     * @returns {Function} Unregister function
     */
    onClass(name, classNames, callback, options = {}) {
        return this.registerHandler(name, callback, options, Array.isArray(classNames) ? classNames : [classNames]);
    }

    /**
     * Get stats about registered handlers
     */
    getStats() {
        return {
            isObserving: this.isObserving,
            handlerCount: this.handlers.length,
            readyHandlerCount: this.readyHandlers.length,
            handlers: this.handlers.map((h) => ({
                name: h.name,
                debounced: h.debounce || false,
            })),
            pendingCallbacks: this.debounceTimers.size,
        };
    }
}

const domObserver = new DOMObserver();

export default domObserver;
