/**
 * Marketplace Custom Tabs Utility
 * Provides shared functionality for creating and managing custom marketplace tabs
 * Used by missing materials features (actions, houses, etc.)
 */

import { formatWithSeparator } from './formatters.js';

/**
 * Get the visible marketplace tab container.
 * Returns null when the marketplace panel is hidden or does not have native tabs.
 * @returns {HTMLElement|null}
 */
export function getVisibleMarketplaceTabContainer() {
    const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
    if (!panel) return null;

    // Check the panel's nearest ancestor sub-panel container for visibility
    const subPanelContainer = panel.closest('[class*="MainPanel_subPanelContainer"]');
    if (subPanelContainer && getComputedStyle(subPanelContainer).display === 'none') return null;

    const tabsContainer = panel.querySelector('.MuiTabs-flexContainer[role="tablist"]');
    if (!tabsContainer) return null;

    // Confirm this is the native marketplace tablist (has Market Listings or My Listings)
    const hasNativeTab = Array.from(tabsContainer.children).some(
        (btn) => btn.textContent.includes('Market Listings') || btn.textContent.includes('My Listings')
    );
    if (!hasNativeTab) return null;

    return tabsContainer;
}

/**
 * Remove all custom material tabs that belong to a specific owner.
 * @param {string} owner - MARKETPLACE_OWNER constant
 */
export function removeMaterialTabsForOwner(owner) {
    document.querySelectorAll(`[data-mwi-custom-tab][data-mwi-tab-owner="${owner}"]`).forEach((el) => el.remove());
}

/**
 * Create a custom material tab for the marketplace
 * @param {Object} material - Material data object
 * @param {string} material.itemHrid - Item HRID
 * @param {string} material.itemName - Display name for the item
 * @param {number} material.missing - Amount missing (0 if sufficient)
 * @param {number} [material.queued=0] - Amount reserved by queue
 * @param {boolean} material.isTradeable - Whether item can be traded
 * @param {HTMLElement} referenceTab - Tab element to clone structure from
 * @param {Function} onClickCallback - Callback when tab is clicked, receives (e, material)
 * @param {string} [owner] - MARKETPLACE_OWNER constant for scoped removal
 * @returns {HTMLElement} Created tab element
 */
export function createMaterialTab(material, referenceTab, onClickCallback, owner) {
    // Clone reference tab structure
    const tab = referenceTab.cloneNode(true);

    // Mark as custom tab for later identification
    tab.setAttribute('data-mwi-custom-tab', 'true');
    tab.setAttribute('data-item-hrid', material.itemHrid);
    tab.setAttribute('data-missing-quantity', material.missing.toString());
    if (owner) tab.setAttribute('data-mwi-tab-owner', owner);

    // Color coding:
    // - Red: Missing materials (missing > 0)
    // - Green: Sufficient materials (missing = 0)
    // - Gray: Not tradeable
    let statusColor;
    let statusText;

    if (!material.isTradeable) {
        statusColor = '#888888'; // Gray - not tradeable
        statusText = 'Not Tradeable';
    } else if (material.missing > 0) {
        statusColor = '#ef4444'; // Red - missing materials
        // Show queued amount if any materials are reserved by queue
        const queuedText = material.queued > 0 ? ` (${formatWithSeparator(material.queued)} Q'd)` : '';
        statusText = `Missing: ${formatWithSeparator(material.missing)}${queuedText}`;
    } else {
        statusColor = '#4ade80'; // Green - sufficient materials
        statusText = `Sufficient (${formatWithSeparator(material.required)})`;
    }

    // Update text content
    const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
    if (badgeSpan) {
        // Title case: capitalize first letter of each word
        const titleCaseName = material.itemName
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        badgeSpan.innerHTML = `
            <div style="text-align: center;">
                <div>${titleCaseName}</div>
                <div style="font-size: 0.75em; color: ${statusColor};">
                    ${statusText}
                </div>
            </div>
        `;
    }

    // Gray out if not tradeable
    if (!material.isTradeable) {
        tab.style.opacity = '0.5';
        tab.style.cursor = 'not-allowed';
    }

    // Remove selected state
    tab.classList.remove('Mui-selected');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');

    // Add click handler
    tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!material.isTradeable) {
            // Not tradeable - do nothing
            return;
        }

        // Call the provided callback
        if (onClickCallback) {
            onClickCallback(e, material);
        }
    });

    return tab;
}

/**
 * Remove all custom material tabs from the marketplace
 */
export function removeMaterialTabs() {
    const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
    customTabs.forEach((tab) => tab.remove());
}

/**
 * Remove all shrine-specific material tabs from the marketplace
 */
export function removeShrineMarketTabs() {
    document.querySelectorAll('[data-mwi-shrine-tab="true"]').forEach((tab) => tab.remove());
}

/**
 * Update the badge content and quantity attribute on an existing material tab
 * @param {HTMLElement} tab - Tab element created by createMaterialTab
 * @param {Object} material - Updated material data
 * @param {string} material.itemName - Display name
 * @param {number} material.missing - Current missing quantity
 * @param {number} [material.required] - Total required quantity
 * @param {boolean} material.isTradeable - Whether tradeable
 * @param {number} [material.queued] - Queued quantity
 */
export function updateTabBadge(tab, material) {
    const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
    if (!badgeSpan) return;

    let statusColor;
    let statusText;

    if (!material.isTradeable) {
        statusColor = '#888888';
        statusText = 'Not Tradeable';
    } else if (material.missing > 0) {
        statusColor = '#ef4444';
        const queuedText = material.queued > 0 ? ` (${formatWithSeparator(material.queued)} Q'd)` : '';
        statusText = `Missing: ${formatWithSeparator(material.missing)}${queuedText}`;
    } else {
        statusColor = '#4ade80';
        statusText = `Sufficient (${formatWithSeparator(material.required)})`;
    }

    const titleCaseName = material.itemName
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

    badgeSpan.innerHTML = `
        <div style="text-align: center;">
            <div>${titleCaseName}</div>
            <div style="font-size: 0.75em; color: ${statusColor};">
                ${statusText}
            </div>
        </div>
    `;

    tab.setAttribute('data-missing-quantity', material.missing.toString());

    if (!material.isTradeable) {
        tab.style.opacity = '0.5';
        tab.style.cursor = 'not-allowed';
    } else {
        tab.style.opacity = '1';
        tab.style.cursor = 'pointer';
    }
}

/**
 * Setup marketplace cleanup observer.
 * Polls to detect when the marketplace closes or custom tabs disappear.
 *
 * Accepts either the legacy call signature:
 *   setupMarketplaceCleanupObserver(onCleanup, tabsArray)
 *
 * Or a new single-object signature:
 *   setupMarketplaceCleanupObserver({ owner, onTabsGone })
 *   where onTabsGone is called when the owner's tabs are no longer in the DOM
 *   or the marketplace panel becomes hidden.
 *
 * @param {Function|Object} onCleanupOrOpts
 * @param {Array} [tabsArray]
 * @returns {Function} Unregister function
 */
export function setupMarketplaceCleanupObserver(onCleanupOrOpts, tabsArray) {
    let owner = null;
    let onTabsGone = null;
    let legacyTabsArray = null;

    if (typeof onCleanupOrOpts === 'function') {
        // Legacy signature
        onTabsGone = onCleanupOrOpts;
        legacyTabsArray = tabsArray;
    } else {
        owner = onCleanupOrOpts?.owner || null;
        onTabsGone = onCleanupOrOpts?.onTabsGone || null;
    }

    let pollInterval = null;

    function poll() {
        let hasTabs = false;

        if (owner) {
            const ownerTabs = Array.from(
                document.querySelectorAll(`[data-mwi-custom-tab][data-mwi-tab-owner="${owner}"]`)
            );
            hasTabs = ownerTabs.some((tab) => document.body.contains(tab));
        } else if (legacyTabsArray) {
            if (!legacyTabsArray || legacyTabsArray.length === 0) return;
            hasTabs = legacyTabsArray.some((tab) => document.body.contains(tab));
        } else {
            return;
        }

        if (!hasTabs) {
            if (onTabsGone) onTabsGone();
            return;
        }

        // Marketplace panel hidden → also trigger cleanup
        const marketplacePanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        const subPanelContainer = marketplacePanel?.closest('[class*="MainPanel_subPanelContainer"]');
        if (subPanelContainer && getComputedStyle(subPanelContainer).display === 'none') {
            if (onTabsGone) onTabsGone();
        }
    }

    pollInterval = setInterval(poll, 1000);

    return () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    };
}

/**
 * Get game object via React fiber
 * @returns {Object|null} Game component instance
 */
function getGameObject() {
    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function find(fiber) {
        if (!fiber) return null;
        if (fiber.stateNode?.handleGoToMarketplace) return fiber.stateNode;
        return find(fiber.child) || find(fiber.sibling);
    }

    return find(rootFiber);
}

/**
 * Navigate to marketplace for a specific item
 * @param {string} itemHrid - Item HRID to navigate to
 * @param {number} enhancementLevel - Enhancement level (default 0)
 */
export function navigateToMarketplace(itemHrid, enhancementLevel = 0) {
    const game = getGameObject();
    if (game?.handleGoToMarketplace) {
        game.handleGoToMarketplace(itemHrid, enhancementLevel);
    }
    // Silently fail if game API unavailable - feature still provides value without auto-navigation
}
