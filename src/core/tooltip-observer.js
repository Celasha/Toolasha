/**
 * Tooltip Observer
 * Centralized observer for tooltip/popper appearances
 * Any feature can subscribe to be notified when tooltips appear
 */

import domObserver from './dom-observer.js';

class TooltipObserver {
    constructor() {
        this.subscribers = new Map(); // name -> callback
        this.unregisterObserver = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the observer (call once)
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Watch for tooltip/popper elements appearing
        // These are the common classes used by MUI tooltips/poppers
        this.unregisterObserver = domObserver.onClass('TooltipObserver', ['MuiPopper', 'MuiTooltip'], (element) => {
            this.notifySubscribers(element);
        });
    }

    /**
     * Subscribe to tooltip appearance events
     * @param {string} name - Unique subscriber name
     * @param {Function} callback - Function(element) to call when tooltip appears
     */
    subscribe(name, callback) {
        this.subscribers.set(name, callback);

        // Auto-initialize if first subscriber
        if (!this.isInitialized) {
            this.initialize();
        }
    }

    /**
     * Unsubscribe from tooltip events
     * @param {string} name - Subscriber name
     */
    unsubscribe(name) {
        this.subscribers.delete(name);

        // If no subscribers left, could optionally stop observing
        // For now, keep observer active for simplicity
    }

    /**
     * Notify all subscribers that a tooltip appeared
     * @param {Element} element - The tooltip/popper element
     * @private
     */
    notifySubscribers(element) {
        // Set up observer to detect when this specific tooltip is removed
        const removalObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const removedNode of mutation.removedNodes) {
                    if (removedNode === element) {
                        // Notify subscribers that tooltip closed
                        for (const [name, callback] of this.subscribers.entries()) {
                            try {
                                callback(element, 'closed');
                            } catch (error) {
                                console.error(`[TooltipObserver] Error in subscriber "${name}" (close):`, error);
                            }
                        }
                        removalObserver.disconnect();
                        return;
                    }
                }
            }
        });

        // Watch the parent for removal of this tooltip
        if (element.parentNode) {
            removalObserver.observe(element.parentNode, {
                childList: true,
            });
        }

        // Notify subscribers that tooltip opened
        for (const [name, callback] of this.subscribers.entries()) {
            try {
                callback(element, 'opened');
            } catch (error) {
                console.error(`[TooltipObserver] Error in subscriber "${name}" (open):`, error);
            }
        }
    }

    /**
     * Cleanup and disable
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        this.subscribers.clear();
        this.isInitialized = false;
    }
}

const tooltipObserver = new TooltipObserver();

export default tooltipObserver;
