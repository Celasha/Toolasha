/**
 * Network Alert Display
 * Shows a warning message when market data cannot be fetched
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';

class NetworkAlert {
    constructor() {
        this.container = null;
        this.unregisterHandlers = [];
        this.isVisible = false;
    }

    /**
     * Initialize network alert display
     */
    initialize() {
        if (!config.getSetting('networkAlert')) {
            return;
        }

        // 1. Check if header exists already
        const existingElem = document.querySelector('[class*="Header_totalLevel"]');
        if (existingElem) {
            this.prepareContainer(existingElem);
        }

        // 2. Watch for header to appear (handles SPA navigation)
        const unregister = domObserver.onClass('NetworkAlert', 'Header_totalLevel', (elem) => {
            this.prepareContainer(elem);
        });
        this.unregisterHandlers.push(unregister);
    }

    /**
     * Prepare container but don't show yet
     * @param {Element} totalLevelElem - Total level element
     */
    prepareContainer(totalLevelElem) {
        // Check if already prepared
        if (this.container && document.body.contains(this.container)) {
            return;
        }

        // Remove any existing container
        if (this.container) {
            this.container.remove();
        }

        // Create container (hidden by default)
        this.container = document.createElement('div');
        this.container.className = 'mwi-network-alert';
        this.container.style.cssText = `
            display: none;
            font-size: 0.875rem;
            font-weight: 500;
            color: #ff4444;
            text-wrap: nowrap;
            margin-left: 16px;
        `;

        // Insert after total level (or after networth if it exists)
        const networthElem = totalLevelElem.parentElement.querySelector('.mwi-networth-header');
        if (networthElem) {
            networthElem.insertAdjacentElement('afterend', this.container);
        } else {
            totalLevelElem.insertAdjacentElement('afterend', this.container);
        }
    }

    /**
     * Show the network alert
     * @param {string} message - Alert message to display
     */
    show(message = '⚠️ Market data unavailable') {
        if (!config.getSetting('networkAlert')) {
            return;
        }

        if (!this.container || !document.body.contains(this.container)) {
            // Try to prepare container if not ready
            const totalLevelElem = document.querySelector('[class*="Header_totalLevel"]');
            if (totalLevelElem) {
                this.prepareContainer(totalLevelElem);
            } else {
                // Header not found, fallback to console
                console.warn('[Network Alert]', message);
                return;
            }
        }

        if (this.container) {
            this.container.textContent = message;
            this.container.style.display = 'block';
            this.isVisible = true;
        }
    }

    /**
     * Hide the network alert
     */
    hide() {
        if (this.container && document.body.contains(this.container)) {
            this.container.style.display = 'none';
            this.isVisible = false;
        }
    }

    /**
     * Cleanup
     */
    disable() {
        this.hide();

        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
    }
}

const networkAlert = new NetworkAlert();

export default networkAlert;
