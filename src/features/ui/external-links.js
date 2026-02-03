/**
 * External Links
 * Adds links to external MWI tools in the left sidebar navigation
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';

class ExternalLinks {
    constructor() {
        this.unregisterObserver = null;
        this.linksAdded = false;
        this.isInitialized = false;
    }

    /**
     * Initialize external links feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('ui_externalLinks')) {
            return;
        }

        this.isInitialized = true;
        this.setupObserver();
    }

    /**
     * Setup DOM observer to watch for navigation bar
     */
    setupObserver() {
        // Wait for the minor navigation links container
        this.unregisterObserver = domObserver.onClass(
            'ExternalLinks',
            'NavigationBar_minorNavigationLinks',
            (container) => {
                if (!this.linksAdded) {
                    this.addLinks(container);
                    this.linksAdded = true;
                }
            }
        );

        // Check for existing container immediately
        const existingContainer = document.querySelector('[class*="NavigationBar_minorNavigationLinks"]');
        if (existingContainer && !this.linksAdded) {
            this.addLinks(existingContainer);
            this.linksAdded = true;
        }
    }

    /**
     * Add external tool links to navigation bar
     * @param {HTMLElement} container - Navigation links container
     */
    addLinks(container) {
        const links = [
            {
                label: 'Combat Sim',
                url: 'https://shykai.github.io/MWICombatSimulatorTest/dist/',
            },
            {
                label: 'Milkyway Market',
                url: 'https://milkyway.market/',
            },
            {
                label: 'Enhancelator',
                url: 'https://doh-nuts.github.io/Enhancelator/',
            },
            {
                label: 'Milkonomy',
                url: 'https://milkonomy.pages.dev/#/dashboard',
            },
        ];

        // Add each link (in reverse order so they appear in correct order when prepended)
        for (let i = links.length - 1; i >= 0; i--) {
            const link = links[i];
            this.addLink(container, link.label, link.url);
        }
    }

    /**
     * Add a single external link to the navigation
     * @param {HTMLElement} container - Navigation links container
     * @param {string} label - Link label
     * @param {string} url - External URL
     */
    addLink(container, label, url) {
        const div = document.createElement('div');
        div.setAttribute('class', 'NavigationBar_minorNavigationLink__31K7Y');
        div.style.color = config.COLOR_ACCENT;
        div.style.cursor = 'pointer';
        div.textContent = label;

        div.addEventListener('click', () => {
            window.open(url, '_blank');
        });

        // Insert at the beginning (after Settings if it exists)
        container.insertAdjacentElement('afterbegin', div);
    }

    /**
     * Disable the external links feature
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Remove added links
        const container = document.querySelector('[class*="NavigationBar_minorNavigationLinks"]');
        if (container) {
            container.querySelectorAll('[style*="cursor: pointer"]').forEach((link) => {
                // Only remove links we added (check if they have our color)
                if (link.style.color === config.COLOR_ACCENT) {
                    link.remove();
                }
            });
        }

        this.linksAdded = false;
        this.isInitialized = false;
    }
}

const externalLinks = new ExternalLinks();

export default externalLinks;
