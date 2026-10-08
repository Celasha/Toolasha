/**
 * Enhancement Protection Marketplace Button
 * Adds a "Buy Cheapest" button to the Protection item selector popup in the
 * Enhancing panel, navigating to the Marketplace for the cheapest available
 * protection option (the item itself, Mirror of Protection, or a specific
 * protection item).
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { formatLargeNumber } from '../../utils/formatters.js';
import { getItemName } from '../../utils/game-i18n.js';
import { navigateToMarketplace } from '../../utils/marketplace-tabs.js';
import { getCheapestProtectionPrice } from './tooltip-enhancement.js';

const MENU_WATCH_TIMEOUT_MS = 2000;

class EnhancementProtectionMarketplace {
    constructor() {
        this.isInitialized = false;
        this.unregisterContainerObserver = null;
        this.containerClickHandlers = new WeakMap();
        this.menuWatcher = null;
        this.menuWatchTimer = null;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('enhanceSim_protectionMarketplaceButton')) return;

        this.isInitialized = true;

        this.unregisterContainerObserver = domObserver.onClass(
            'EnhancementProtectionMarketplace',
            'SkillActionDetail_protectionItemInputContainer',
            (container) => this._attachClickWatcher(container)
        );

        document
            .querySelectorAll('[class*="SkillActionDetail_protectionItemInputContainer"]')
            .forEach((container) => this._attachClickWatcher(container));
    }

    _attachClickWatcher(container) {
        if (this.containerClickHandlers.has(container)) return;

        const handler = () => this._watchForMenu(container);
        container.addEventListener('click', handler);
        this.containerClickHandlers.set(container, handler);
    }

    _watchForMenu(container) {
        this._stopMenuWatch();

        this.menuWatcher = new MutationObserver(() => {
            const menu = document.querySelector('[class*="ItemSelector_menu__"]');
            if (menu && !menu.dataset.mwiProtMktButton) {
                this._injectButton(menu, container);
                this._stopMenuWatch();
            }
        });
        this.menuWatcher.observe(document.body, { childList: true, subtree: true });

        this.menuWatchTimer = setTimeout(() => this._stopMenuWatch(), MENU_WATCH_TIMEOUT_MS);
    }

    _stopMenuWatch() {
        if (this.menuWatcher) {
            this.menuWatcher.disconnect();
            this.menuWatcher = null;
        }
        if (this.menuWatchTimer) {
            clearTimeout(this.menuWatchTimer);
            this.menuWatchTimer = null;
        }
    }

    _injectButton(menu, container) {
        if (menu.dataset.mwiProtMktButton) return;
        menu.dataset.mwiProtMktButton = 'true';

        const itemHrid = this._getEnhancingItemHrid(container);
        if (!itemHrid) return;

        const cheapest = getCheapestProtectionPrice(itemHrid);
        if (!cheapest.itemHrid) return;

        const itemDetails = dataManager.getItemDetails(cheapest.itemHrid);
        const itemName = getItemName(cheapest.itemHrid, itemDetails?.name || cheapest.itemHrid);

        const btn = document.createElement('button');
        btn.className = 'Button_button__1Fe9z Button_fullWidth__17pVU';
        btn.style.cssText = 'margin-bottom: 6px;';
        btn.textContent = t('enhancementProtectionMarketplace.buyCheapestButtonLabel', {
            name: itemName,
            price: formatLargeNumber(cheapest.price),
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateToMarketplace(cheapest.itemHrid, 0);
            // The button lives inside the popup's own DOM subtree, so the game's click-away
            // listener (which only closes on clicks it judges "outside") never sees this as a
            // dismissal. Dispatch a synthetic outside click to close the popup the same way any
            // other click on the page already does.
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        menu.insertBefore(btn, menu.firstChild);
    }

    _getEnhancingItemHrid(container) {
        const panel = container.closest('[class*="SkillActionDetail_enhancingComponent"]');
        return panel?.dataset?.mwiItemHrid || null;
    }

    disable() {
        if (this.unregisterContainerObserver) {
            this.unregisterContainerObserver();
            this.unregisterContainerObserver = null;
        }

        document.querySelectorAll('[class*="SkillActionDetail_protectionItemInputContainer"]').forEach((container) => {
            const handler = this.containerClickHandlers.get(container);
            if (handler) container.removeEventListener('click', handler);
        });
        this.containerClickHandlers = new WeakMap();

        this._stopMenuWatch();

        this.isInitialized = false;
    }
}

const enhancementProtectionMarketplace = new EnhancementProtectionMarketplace();
export { EnhancementProtectionMarketplace };
export default enhancementProtectionMarketplace;
