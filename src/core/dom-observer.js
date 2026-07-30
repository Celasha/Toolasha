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
        this.isObserving = false;
        this.debounceTimers = new Map(); // Track debounce timers per handler
        this.debouncedLatest = new Map(); // Latest { node, mutation } per handler (O(1) per handler)
        this.DEFAULT_DEBOUNCE_DELAY = 50; // 50ms default delay
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

                        // Dispatch to all registered handlers
                        this.handlers.forEach((handler) => {
                            try {
                                if (handler.debounce) {
                                    this.debouncedCallback(handler, node, mutation);
                                } else if (performanceMonitor.enabled) {
                                    const start = performance.now();
                                    handler.callback(node, mutation);
                                    performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
                                } else {
                                    handler.callback(node, mutation);
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
        };

        startObserver();
    }

    /**
     * Debounced callback handler
     * Collects elements and fires callback after delay
     * @private
     */
    debouncedCallback(handler, node, mutation) {
        const handlerName = handler.name;
        const delay = handler.debounceDelay || this.DEFAULT_DEBOUNCE_DELAY;

        // Overwrite with the latest node/mutation — only the last one is ever used
        this.debouncedLatest.set(handlerName, { node, mutation });

        // Clear existing timer
        if (this.debounceTimers.has(handlerName)) {
            clearTimeout(this.debounceTimers.get(handlerName));
        }

        // Set new timer
        const timer = setTimeout(() => {
            const latest = this.debouncedLatest.get(handlerName);
            this.debouncedLatest.delete(handlerName);
            this.debounceTimers.delete(handlerName);

            if (latest) {
                if (performanceMonitor.enabled) {
                    const start = performance.now();
                    handler.callback(latest.node, latest.mutation);
                    performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
                } else {
                    handler.callback(latest.node, latest.mutation);
                }
            }
        }, delay);

        this.debounceTimers.set(handlerName, timer);
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
     * @returns {Function} Unregister function
     */
    register(name, callback, options = {}) {
        const handler = {
            name,
            callback,
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
                if (this.debounceTimers.has(name)) {
                    clearTimeout(this.debounceTimers.get(name));
                    this.debounceTimers.delete(name);
                    this.debouncedLatest.delete(name);
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
     * @returns {Function} Unregister function
     */
    onClass(name, classNames, callback, options = {}) {
        const classArray = Array.isArray(classNames) ? classNames : [classNames];

        return this.register(
            name,
            (node) => {
                // Safely get className as string (handles SVG elements)
                const className = typeof node.className === 'string' ? node.className : '';

                // Check if node matches any of the target classes
                for (const targetClass of classArray) {
                    if (className.includes(targetClass)) {
                        callback(node);
                        return; // Only call once per node
                    }
                }

                // Also check descendants when a container subtree is inserted.
                // Only applies when the node has children — leaf nodes are skipped,
                // which eliminates the bulk of querySelectorAll cost during React's
                // init burst (thousands of individual leaf additions).
                if (node.childElementCount > 0) {
                    for (const targetClass of classArray) {
                        const matches = node.querySelectorAll(`[class*="${targetClass}"]`);
                        matches.forEach((match) => callback(match));
                    }
                }
            },
            options
        );
    }

    /**
     * Get stats about registered handlers
     */
    getStats() {
        return {
            isObserving: this.isObserving,
            handlerCount: this.handlers.length,
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
