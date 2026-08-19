/**
 * Marketplace Custom Tabs Utility
 * Provides shared functionality for creating and managing custom marketplace tabs
 * Used by missing materials features (actions, houses, etc.)
 */

import { formatWithSeparator } from './formatters.js';

export const MARKETPLACE_REMOUNT_GRACE_MS = 350;

/**
 * Return true only when an element and all element ancestors are actually visible.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isElementActuallyVisible(element) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;

    for (let current = element; current; current = current.parentElement) {
        if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }

    return true;
}

/**
 * Get the unique visible Marketplace native tab container.
 * Hidden retained panels and ambiguous duplicate visible panels fail closed.
 * @returns {HTMLElement|null}
 */
export function getVisibleMarketplaceTabContainer() {
    const candidates = new Set();

    for (const panel of document.querySelectorAll('[class*="MarketplacePanel_marketplacePanel"]')) {
        if (!isElementActuallyVisible(panel)) continue;

        for (const tabsContainer of panel.querySelectorAll('.MuiTabs-flexContainer[role="tablist"]')) {
            if (!isElementActuallyVisible(tabsContainer)) continue;
            const hasNativeTab = Array.from(tabsContainer.children).some((tab) => {
                const text = tab.textContent || '';
                return text.includes('Market Listings') || text.includes('My Listings');
            });
            if (hasNativeTab) candidates.add(tabsContainer);
        }
    }

    return candidates.size === 1 ? candidates.values().next().value : null;
}

/**
 * Return true only when the unique selected native tab is Market Listings.
 * Programmatic/native navigation to My Listings must terminate custom workflows,
 * even if React temporarily retains the custom tab nodes.
 * @param {HTMLElement|null} tabContainer
 * @returns {boolean}
 */
export function isMarketplaceMarketListingsSelected(tabContainer = getVisibleMarketplaceTabContainer()) {
    if (!tabContainer || !isElementActuallyVisible(tabContainer)) return false;

    const selectedNativeTabs = Array.from(tabContainer.children).filter((tab) => {
        if (tab.getAttribute('role') !== 'tab') return false;
        if (tab.hasAttribute('data-mwi-custom-tab') || tab.hasAttribute('data-mwi-shrine-tab')) return false;
        return tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('Mui-selected');
    });

    return selectedNativeTabs.length === 1 && selectedNativeTabs[0].textContent.includes('Market Listings');
}

/**
 * Click the unique visible native Marketplace navigation button.
 * @returns {boolean} True when a button was found and clicked
 */
export function clickMarketplaceNavigationButton() {
    const icons = Array.from(document.querySelectorAll('svg[aria-label="navigationBar.marketplace"]')).filter(
        isElementActuallyVisible
    );
    const buttons = new Set();

    for (const icon of icons) {
        const button = icon.closest('[class*="NavigationBar_nav__"]');
        if (button && isElementActuallyVisible(button)) buttons.add(button);
    }

    if (buttons.size !== 1) return false;
    buttons.values().next().value.click();
    return true;
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
    const forceActionable = material.forceActionable === true;

    // Mark as custom tab for later identification
    tab.setAttribute('data-mwi-custom-tab', 'true');
    // A cloned native tab must not duplicate the native tab/panel identity.
    tab.removeAttribute('id');
    tab.removeAttribute('aria-controls');
    tab.setAttribute('data-item-hrid', material.itemHrid);
    tab.setAttribute('data-missing-quantity', material.missing.toString());
    if (forceActionable) tab.setAttribute('data-mwi-force-actionable', 'true');
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

    // Disable non-tradeable and already-complete tabs.
    if (!material.isTradeable || (material.missing <= 0 && !forceActionable)) {
        tab.style.opacity = material.isTradeable ? '0.7' : '0.5';
        tab.style.cursor = 'not-allowed';
        tab.setAttribute('aria-disabled', 'true');
    } else {
        tab.style.opacity = '1';
        tab.style.cursor = 'pointer';
        tab.setAttribute('aria-disabled', 'false');
    }

    // Remove selected state
    tab.classList.remove('Mui-selected');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');

    // Add click handler
    tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const currentMissing = Number.parseInt(tab.getAttribute('data-missing-quantity') || '0', 10);
        if (!material.isTradeable || (!forceActionable && (!Number.isFinite(currentMissing) || currentMissing <= 0))) {
            return;
        }

        if (onClickCallback) onClickCallback(e, material);
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

    const forceActionable = tab.getAttribute('data-mwi-force-actionable') === 'true';
    if (!material.isTradeable || (material.missing <= 0 && !forceActionable)) {
        tab.style.opacity = material.isTradeable ? '0.7' : '0.5';
        tab.style.cursor = 'not-allowed';
        tab.setAttribute('aria-disabled', 'true');
    } else {
        tab.style.opacity = '1';
        tab.style.cursor = 'pointer';
        tab.setAttribute('aria-disabled', 'false');
    }
}

/**
 * Setup marketplace cleanup observer.
 * Uses MutationObserver for prompt close/remount detection, with polling as a fallback.
 *
 * Accepts either the legacy call signature:
 *   setupMarketplaceCleanupObserver(onCleanup, tabsArray)
 *
 * Or a new single-object signature:
 *   setupMarketplaceCleanupObserver({ owner, onTabsGone, invalidStateGraceMs })
 *   where onTabsGone is called when the owner's tabs are missing from the current
 *   unique visible Marketplace tablist or the marketplace panel becomes hidden.
 *   invalidStateGraceMs optionally tolerates a brief React remount gap.
 *
 * @param {Function|Object} onCleanupOrOpts
 * @param {Array} [tabsArray]
 * @returns {Function} Unregister function
 */
export function setupMarketplaceCleanupObserver(onCleanupOrOpts, tabsArray) {
    let owner = null;
    let onTabsGone = null;
    let legacyTabsArray = null;
    let invalidStateGraceMs = 0;

    if (typeof onCleanupOrOpts === 'function') {
        // Legacy signature
        onTabsGone = onCleanupOrOpts;
        legacyTabsArray = tabsArray;
    } else {
        owner = onCleanupOrOpts?.owner || null;
        onTabsGone = onCleanupOrOpts?.onTabsGone || null;
        invalidStateGraceMs = Math.max(0, Number(onCleanupOrOpts?.invalidStateGraceMs) || 0);
    }

    let pollInterval = null;
    let mutationObserver = null;
    let invalidStateTimer = null;
    let isStopped = false;
    let invalidStateNotified = false;

    function hasValidState() {
        const visibleContainer = getVisibleMarketplaceTabContainer();
        if (!visibleContainer) return false;

        if (owner) {
            if (!isMarketplaceMarketListingsSelected(visibleContainer)) return false;
            // Only tabs inside the CURRENT unique visible Marketplace tablist count.
            // Hidden retained panels must not mask a React remount that wiped the live tabs.
            const ownerTabs = Array.from(
                visibleContainer.querySelectorAll(`[data-mwi-custom-tab][data-mwi-tab-owner="${owner}"][role="tab"]`)
            );
            return ownerTabs.some((tab) => tab.isConnected && isElementActuallyVisible(tab));
        }

        if (legacyTabsArray) {
            if (legacyTabsArray.length === 0) return true;
            return legacyTabsArray.some((tab) => document.body.contains(tab));
        }

        return true;
    }

    function clearInvalidStateTimer() {
        if (!invalidStateTimer) return;
        clearTimeout(invalidStateTimer);
        invalidStateTimer = null;
    }

    function notifyInvalidState() {
        if (invalidStateNotified || invalidStateTimer || !onTabsGone) return;

        if (invalidStateGraceMs <= 0) {
            invalidStateNotified = true;
            onTabsGone();
            return;
        }

        invalidStateTimer = setTimeout(() => {
            invalidStateTimer = null;
            if (isStopped || invalidStateNotified || hasValidState()) return;
            invalidStateNotified = true;
            onTabsGone();
        }, invalidStateGraceMs);
    }

    function poll() {
        if (isStopped) return;

        if (!hasValidState()) {
            notifyInvalidState();
            return;
        }

        clearInvalidStateTimer();
        invalidStateNotified = false;
    }

    if (document.body && typeof MutationObserver === 'function') {
        mutationObserver = new MutationObserver(poll);
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            // React changes native tab selection through aria-selected/class without
            // necessarily mutating children. Observe both so native-tab exits are prompt
            // even when navigation was triggered programmatically rather than by a click.
            attributeFilter: ['style', 'hidden', 'aria-hidden', 'aria-selected', 'class'],
        });
    }

    pollInterval = setInterval(poll, 1000);

    return () => {
        isStopped = true;
        clearInvalidStateTimer();
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
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

    const stack = [rootFiber];
    while (stack.length > 0) {
        const fiber = stack.pop();
        if (typeof fiber?.stateNode?.handleGoToMarketplace === 'function') return fiber.stateNode;
        if (fiber?.sibling) stack.push(fiber.sibling);
        if (fiber?.child) stack.push(fiber.child);
    }
    return null;
}

/**
 * Watch for a native Marketplace tab click and call onExit when it occurs.
 * Uses a delegated click listener — does not fire on initial aria-selected DOM state.
 *
 * Resolves nested click targets (e.g. a span or icon inside the tab) via closest('[role="tab"]').
 * Only fires when the resolved tab belongs to tabContainer and is not a Toolasha custom tab.
 *
 * @param {HTMLElement} tabContainer - The MuiTabs-flexContainer[role="tablist"] element
 * @param {Function} onExit - Called when a native tab is clicked
 * @returns {Function} Cleanup function that removes the exact delegated listener
 */
export function watchNativeTabExit(tabContainer, onExit) {
    function handleClick(e) {
        const origin = typeof e.target?.closest === 'function' ? e.target : e.target?.parentElement;
        const target = origin?.closest('[role="tab"]');
        if (!target || !tabContainer.contains(target)) return;
        if (target.hasAttribute('data-mwi-custom-tab') || target.hasAttribute('data-mwi-shrine-tab')) return;
        onExit();
    }
    tabContainer.addEventListener('click', handleClick, { capture: true });
    return () => tabContainer.removeEventListener('click', handleClick, { capture: true });
}

/**
 * Navigate to marketplace for a specific item
 * @param {string} itemHrid - Item HRID to navigate to
 * @param {number} enhancementLevel - Enhancement level (default 0)
 * @returns {boolean} True when the native Marketplace handler was invoked
 */
export function navigateToMarketplace(itemHrid, enhancementLevel = 0) {
    const game = getGameObject();
    if (game?.handleGoToMarketplace) {
        game.handleGoToMarketplace(itemHrid, enhancementLevel);
        return true;
    }
    return false;
}

/**
 * Navigate back to the native "My Listings" tab from a specific listing's order-book page.
 * @returns {boolean} True when the tab was found and clicked.
 */
export function navigateToMyListings() {
    const tabContainer = getVisibleMarketplaceTabContainer();
    if (!tabContainer) return false;

    const tab = Array.from(tabContainer.children).find((el) => {
        if (el.getAttribute('role') !== 'tab') return false;
        if (el.hasAttribute('data-mwi-custom-tab') || el.hasAttribute('data-mwi-shrine-tab')) return false;
        return el.textContent.includes('My Listings');
    });

    if (!tab) return false;
    tab.click();
    return true;
}
