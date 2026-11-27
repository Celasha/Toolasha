/**
 * Wishlist Alert
 * The ❗ on the Marketplace link in the left sidebar, shown while the player can afford the first
 * item on their wishlist. (The matching ❗ on the Wishlist tab itself lives in the tab UI.)
 */

import { t } from '../../../core/i18n.js';

export const NAV_ALERT_CLASS = 'mwi-wishlist-nav-alert';

/**
 * The sidebar element of the Marketplace link. Toolasha's own header order-totals link carries the
 * same icon label, so only a match inside the navigation bar counts.
 * @returns {HTMLElement|null}
 */
export function findMarketplaceNav() {
    for (const nav of document.querySelectorAll('[class*="NavigationBar_nav__"]')) {
        if (nav.querySelector('svg[aria-label="navigationBar.marketplace"]')) return nav;
    }
    return null;
}

/**
 * Show or hide the ❗ on the sidebar Marketplace link. Idempotent.
 * @param {boolean} show
 */
export function setNavAlert(show) {
    const existing = document.querySelectorAll(`.${NAV_ALERT_CLASS}`);

    if (!show) {
        existing.forEach((el) => el.remove());
        return;
    }

    const nav = findMarketplaceNav();
    const container = nav?.querySelector('[class*="NavigationBar_textContainer"]');
    if (!container) {
        existing.forEach((el) => el.remove());
        return;
    }
    if (container.querySelector(`.${NAV_ALERT_CLASS}`)) return;

    existing.forEach((el) => el.remove());
    const alert = document.createElement('span');
    alert.className = NAV_ALERT_CLASS;
    alert.textContent = '❗';
    alert.title = t('marketWishlist.alertTooltip');
    alert.style.marginLeft = '4px';
    container.appendChild(alert);
}
