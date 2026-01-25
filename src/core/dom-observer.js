/**
 * Centralized DOM Observer
 * Single MutationObserver that dispatches to registered handlers
 * Replaces 15 separate observers watching document.body
 * Supports optional debouncing to reduce CPU usage during bulk DOM changes
 */

class DOMObserver {
    constructor() {
        this.observer = null;
        this.handlers = [];
        this.isObserving = false;
        this.debounceTimers = new Map(); // Track debounce timers per handler
        this.debouncedElements = new Map(); // Track pending elements per handler
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
                        this.handlers.forEach(handler => {
                            try {
                                if (handler.debounce) {
                                    this.debouncedCallback(handler, node, mutation);
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
                subtree: true
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

        // Store element for batched processing
        if (!this.debouncedElements.has(handlerName)) {
            this.debouncedElements.set(handlerName, []);
        }
        this.debouncedElements.get(handlerName).push({ node, mutation });

        // Clear existing timer
        if (this.debounceTimers.has(handlerName)) {
            clearTimeout(this.debounceTimers.get(handlerName));
        }

        // Set new timer
        const timer = setTimeout(() => {
            const elements = this.debouncedElements.get(handlerName) || [];
            this.debouncedElements.delete(handlerName);
            this.debounceTimers.delete(handlerName);

            // Process all collected elements
            // For most handlers, we only need to process the last element
            // (e.g., task list updated multiple times, we only care about final state)
            if (elements.length > 0) {
                const lastElement = elements[elements.length - 1];
                handler.callback(lastElement.node, lastElement.mutation);
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
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();
        this.debouncedElements.clear();

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
            debounceDelay: options.debounceDelay
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
                    this.debouncedElements.delete(name);
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

        return this.register(name, (node) => {
            // Safely get className as string (handles SVG elements)
            const className = typeof node.className === 'string' ? node.className : '';

            // Check if node matches any of the target classes
            for (const targetClass of classArray) {
                if (className.includes(targetClass)) {
                    callback(node);
                    return; // Only call once per node
                }
            }

            // Also check if node contains matching elements
            if (node.querySelector) {
                for (const targetClass of classArray) {
                    const matches = node.querySelectorAll(`[class*="${targetClass}"]`);
                    matches.forEach(match => callback(match));
                }
            }
        }, options);
    }

    /**
     * Get stats about registered handlers
     */
    getStats() {
        return {
            isObserving: this.isObserving,
            handlerCount: this.handlers.length,
            handlers: this.handlers.map(h => ({
                name: h.name,
                debounced: h.debounce || false
            })),
            pendingCallbacks: this.debounceTimers.size
        };
    }

    /**
     * Debug helper: Log detailed handler information
     * TEMPORARY: For testing handler accumulation fix
     */
    debugHandlers() {
        console.log('=== DOM Observer Diagnostics ===');
        console.log('Total handlers:', this.handlers.length);
        console.log('Active observers:', this.isObserving);
        console.log('Pending callbacks:', this.debounceTimers.size);
        console.log('\nHandler list:');
        this.handlers.forEach((h, i) => {
            console.log(`  ${i + 1}. ${h.name}${h.debounce ? ' (debounced)' : ''}`);
        });
        console.log('================================');
    }
}

// Create singleton instance
const domObserver = new DOMObserver();

export default domObserver;
