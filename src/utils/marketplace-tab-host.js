/**
 * Marketplace Tab Host
 * One way for a feature to add its own tab to the Marketplace's tab bar (Market History, Wishlist,
 * ...), so every such tab is found, built, placed and re-installed under the same conditions.
 *
 * The host looks for the tab bar whenever tab-bar elements appear and, a moment after any page
 * change, until its tab is in place: the game keeps panels mounted and reveals them with a class
 * change, and React can replace the whole tab bar when the marketplace remounts. The tab is a clone
 * of an unselected native tab, with its native identity stripped, so it looks like the others.
 */

import domObserver from '../core/dom-observer.js';
import { createMutationWatcher } from './dom-observer-helpers.js';
import { findMarketplaceTabContainer, isElementActuallyVisible } from './marketplace-tabs.js';

const ORDER_ATTR = 'data-mwi-tab-order';
const RECHECK_DELAY_MS = 200;

/**
 * @typedef {Object} MarketplaceTabOptions
 * @property {string} name - Name for the shared DOM observer (debugging)
 * @property {string} attr - Marker attribute for this feature's tab, e.g. 'data-mwi-wishlist-tab'
 * @property {number} order - Position among Toolasha's own tabs (lower is further left)
 * @property {Function} getLabel - () => string, the translated tab label
 * @property {Function} onClick - (event, tab) => void
 * @property {Function} [onEnsure] - (tab, {tablist, labelEl}) => void, after every successful check; lets the
 *     feature repair its own parts (e.g. a panel) and learn the tab is in a new tab bar
 * @property {Function} [isHealthy] - () => boolean, false when the feature needs onEnsure to run again
 * @property {Function} [onStop] - () => void, after the tab has been removed
 */

/**
 * Whether an element is a native Marketplace tab, as opposed to one Toolasha added
 * @param {Element} el
 * @returns {boolean}
 */
function isNativeTab(el) {
    return (
        el.getAttribute('role') === 'tab' &&
        !el.hasAttribute(ORDER_ATTR) &&
        !el.hasAttribute('data-mwi-custom-tab') &&
        !el.hasAttribute('data-mwi-shrine-tab')
    );
}

/**
 * Put a tab where it belongs: after Toolasha tabs with a lower order, before ones with a higher
 * order, and before the per-item material tabs (which come last).
 * @param {HTMLElement} tablist
 * @param {HTMLElement} tab
 * @param {number} order
 */
function placeTab(tablist, tab, order) {
    const later = Array.from(tablist.querySelectorAll(`[${ORDER_ATTR}]`)).find(
        (el) => el !== tab && Number(el.getAttribute(ORDER_ATTR)) > order
    );
    const firstMaterialTab = tablist.querySelector('[data-mwi-custom-tab]');

    if (later) later.before(tab);
    else if (firstMaterialTab) firstMaterialTab.before(tab);
    else tablist.appendChild(tab);
}

class MarketplaceTabHost {
    /**
     * @param {MarketplaceTabOptions} options
     */
    constructor(options) {
        this.options = options;
        this.tab = null;
        this.tablist = null;
        this.unregisterObserver = null;
        this.unwatchBody = null;
        this.recheckTimer = null;
    }

    start() {
        this.unregisterObserver = domObserver.onClass(
            this.options.name,
            ['TabsComponent_tabPanelsContainer', 'MuiTabs-flexContainer'],
            () => this.ensure()
        );
        this.unwatchBody = createMutationWatcher(document.body, () => this.scheduleRecheck(), {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        });
        this.ensure();
    }

    /**
     * Make sure the tab exists in the mounted marketplace. Idempotent.
     * @returns {HTMLElement|null} The tab, or null when there is no marketplace to put it in
     */
    ensure() {
        const tablist = findMarketplaceTabContainer();
        if (!tablist) return null;

        let tab = tablist.querySelector(`[${this.options.attr}]`);
        if (!tab) {
            tab = this.createTab(tablist);
            if (!tab) return null;
        }
        this.tab = tab;
        this.tablist = tablist;

        this.options.onEnsure?.(tab, { tablist, labelEl: tab.querySelector('.mwi-marketplace-tab-label') });
        return tab;
    }

    /**
     * @param {HTMLElement} tablist
     * @returns {HTMLElement|null}
     */
    createTab(tablist) {
        const reference =
            Array.from(tablist.children).find((el) => isNativeTab(el) && !el.classList.contains('Mui-selected')) ||
            Array.from(tablist.children).find(isNativeTab);
        if (!reference) return null;

        const tab = reference.cloneNode(true);
        tab.setAttribute(this.options.attr, 'true');
        tab.setAttribute(ORDER_ATTR, String(this.options.order));
        // A clone must not duplicate the native tab/panel identity or look selected
        tab.removeAttribute('id');
        tab.removeAttribute('aria-controls');
        tab.classList.remove('Mui-selected');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');

        const badge = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badge) {
            badge.textContent = '';
            const wrapper = document.createElement('div');
            wrapper.style.textAlign = 'center';
            const label = document.createElement('div');
            label.className = 'mwi-marketplace-tab-label';
            label.textContent = this.options.getLabel();
            wrapper.appendChild(label);
            badge.appendChild(wrapper);
        }

        tab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.options.onClick(event, tab);
        });

        placeTab(tablist, tab, this.options.order);
        return tab;
    }

    /**
     * Look again shortly after a page change, until the tab is in place. Runs after nearly every
     * page change, so the common case (nothing to do) must stay cheap.
     */
    scheduleRecheck() {
        if (this.recheckTimer) return;
        this.recheckTimer = setTimeout(() => {
            this.recheckTimer = null;
            const panels = document.querySelectorAll('[class*="MarketplacePanel_marketplacePanel"]');
            if (panels.length === 0) return;

            const installed = this.tab?.isConnected && this.tablist?.isConnected;
            const healthy = this.options.isHealthy ? this.options.isHealthy() : true;
            // Installed in a hidden panel while a second one is mounted: the visible one needs it too
            if (installed && healthy && (panels.length === 1 || isElementActuallyVisible(this.tablist))) return;
            this.ensure();
        }, RECHECK_DELAY_MS);
    }

    stop() {
        this.unregisterObserver?.();
        this.unregisterObserver = null;
        this.unwatchBody?.();
        this.unwatchBody = null;
        clearTimeout(this.recheckTimer);
        this.recheckTimer = null;

        document.querySelectorAll(`[${this.options.attr}]`).forEach((el) => el.remove());
        this.tab = null;
        this.tablist = null;
        this.options.onStop?.();
    }
}

/**
 * Add a tab to the Marketplace's tab bar and keep it there.
 * @param {MarketplaceTabOptions} options
 * @returns {MarketplaceTabHost} Call stop() to remove the tab and stop watching
 */
export function installMarketplaceTab(options) {
    const host = new MarketplaceTabHost(options);
    host.start();
    return host;
}

export { MarketplaceTabHost, ORDER_ATTR, isNativeTab };
