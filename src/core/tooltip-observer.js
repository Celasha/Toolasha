/**
 * Tooltip Observer
 * Centralized observer for tooltip/popper appearances
 * Any feature can subscribe to be notified when tooltips appear
 */

import domObserver from './dom-observer.js';

class TooltipObserver {
    constructor() {
        this.subscribers = new Map(); // name -> { callback, notifyClose }
        this.unregisterObserver = null;
        this.isInitialized = false;
        this.activeRemovalObservers = new Set();
        this.observedElements = new WeakSet();
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
     * @param {Function} callback - Function(element, eventType) to call when tooltip appears
     * @param {Object} options - Subscription options
     * @param {boolean} options.notifyClose - Observe and report tooltip removal (default false)
     */
    subscribe(name, callback, options = {}) {
        this.subscribers.set(name, {
            callback,
            notifyClose: options.notifyClose === true,
        });

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

        if (this.subscribers.size === 0) {
            this.disable();
        }
    }

    /**
     * Notify all subscribers that a tooltip appeared
     * @param {Element} element - The tooltip/popper element
     * @private
     */
    notifySubscribers(element) {
        const needsCloseNotification = Array.from(this.subscribers.values()).some(
            (subscriber) => subscriber.notifyClose
        );

        // Current production subscribers only need open notifications. Avoid creating
        // one MutationObserver per transient tooltip unless close events are requested.
        if (needsCloseNotification && !this.observedElements.has(element)) {
            const observationRoot = document.body || element.parentNode;
            if (observationRoot) {
                this.observedElements.add(element);
                const removalObserver = new MutationObserver(() => {
                    if (element.isConnected) return;

                    for (const [name, subscriber] of this.subscribers.entries()) {
                        if (!subscriber.notifyClose) continue;
                        try {
                            subscriber.callback(element, 'closed');
                        } catch (error) {
                            console.error(`[TooltipObserver] Error in subscriber "${name}" (close):`, error);
                        }
                    }

                    removalObserver.disconnect();
                    this.activeRemovalObservers.delete(removalObserver);
                    this.observedElements.delete(element);
                });

                this.activeRemovalObservers.add(removalObserver);
                removalObserver.observe(observationRoot, {
                    childList: true,
                    subtree: true,
                });
            }
        }

        // Notify subscribers that tooltip opened
        for (const [name, subscriber] of this.subscribers.entries()) {
            try {
                subscriber.callback(element, 'opened');
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
        for (const observer of this.activeRemovalObservers) {
            observer.disconnect();
        }
        this.activeRemovalObservers.clear();
        this.observedElements = new WeakSet();
        this.subscribers.clear();
        this.isInitialized = false;
    }
}

const tooltipObserver = new TooltipObserver();

export default tooltipObserver;
