/**
 * Marketplace Custom Tabs Utility
 * Provides shared functionality for creating and managing custom marketplace tabs
 * Used by missing materials features (actions, houses, etc.)
 */

import { t } from '../core/i18n.js';
import { formatWithSeparator } from './formatters.js';
import { translateGameName, getItemName } from './game-i18n.js';

export const MARKETPLACE_REMOUNT_GRACE_MS = 350;

/**
 * Check whether a rendered tab label matches a native Marketplace tab name.
 * Tab labels are localized by the game (zh: Market Listings 商品列表 /
 * My Listings 我的挂牌), so match both the English and translated text.
 * @param {string} text - Rendered tab text
 * @param {'marketListings'|'myListings'} key - marketplacePanel i18n key
 * @returns {boolean}
 */
function matchesMarketplaceTabLabel(text, key) {
    const fallback = key === 'marketListings' ? 'Market Listings' : 'My Listings';
    return text.includes(fallback) || text.includes(translateGameName('marketplacePanel', key, fallback));
}

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
 * Collect every visible native Marketplace tab container currently in the DOM.
 * Exposed separately from getVisibleMarketplaceTabContainer so diagnostics can report
 * *how many* candidates were found (0 vs 2+) instead of just the collapsed null.
 * @returns {Set<HTMLElement>}
 */
function getMarketplaceTabContainerCandidates() {
    const candidates = new Set();

    for (const panel of document.querySelectorAll('[class*="MarketplacePanel_marketplacePanel"]')) {
        if (!isElementActuallyVisible(panel)) continue;

        for (const tabsContainer of panel.querySelectorAll('.MuiTabs-flexContainer[role="tablist"]')) {
            if (!isElementActuallyVisible(tabsContainer)) continue;
            const hasNativeTab = Array.from(tabsContainer.children).some((tab) => {
                const text = tab.textContent || '';
                return (
                    matchesMarketplaceTabLabel(text, 'marketListings') || matchesMarketplaceTabLabel(text, 'myListings')
                );
            });
            if (hasNativeTab) candidates.add(tabsContainer);
        }
    }

    return candidates;
}

/**
 * Get the unique visible Marketplace native tab container.
 * Hidden retained panels and ambiguous duplicate visible panels fail closed.
 * @returns {HTMLElement|null}
 */
export function getVisibleMarketplaceTabContainer() {
    const candidates = getMarketplaceTabContainerCandidates();
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

    return (
        selectedNativeTabs.length === 1 &&
        matchesMarketplaceTabLabel(selectedNativeTabs[0].textContent, 'marketListings')
    );
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
 * Build the two-line badge HTML shown on a custom material tab: the item name
 * (resolved through the game's i18n by HRID) and the trade status line.
 * Color coding:
 * - Red: Missing materials (missing > 0)
 * - Green: Sufficient materials (missing = 0)
 * - Gray: Not tradeable
 * @param {Object} material - Material data object (see createMaterialTab)
 * @returns {string} Badge HTML
 */
function buildTabBadgeHtml(material) {
    let statusColor;
    let statusText;

    if (!material.isTradeable) {
        statusColor = '#888888'; // Gray - not tradeable
        statusText = t('marketplaceTabs.notTradeable');
    } else if (material.missing > 0) {
        statusColor = '#ef4444'; // Red - missing materials
        // Show queued amount if any materials are reserved by the action queue
        const queuedText =
            material.queued > 0
                ? t('marketplaceTabs.queuedSuffix', { count: formatWithSeparator(material.queued) })
                : '';
        statusText = t('marketplaceTabs.missingQty', {
            qty: formatWithSeparator(material.missing),
            queued: queuedText,
        });
    } else {
        statusColor = '#4ade80'; // Green - sufficient materials
        statusText = t('marketplaceTabs.sufficientQty', { qty: formatWithSeparator(material.required) });
    }

    // Title case only prettifies the English fallback name; it is a no-op for CJK names.
    const titleCaseName = getItemName(material.itemHrid, material.itemName)
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

    return `
            <div style="text-align: center;">
                <div>${titleCaseName}</div>
                <div style="font-size: 0.75em; color: ${statusColor};">
                    ${statusText}
                </div>
            </div>
        `;
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

    // Update text content (translated item name + trade status)
    const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
    if (badgeSpan) {
        badgeSpan.innerHTML = buildTabBadgeHtml(material);
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

    badgeSpan.innerHTML = buildTabBadgeHtml(material);

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
 * Diagnostic-only: whether a mutation's target is relevant to the tab-selection investigation -
 * a tab element itself (native or Toolasha-injected), or anything inside the native tablist.
 * Document-body-wide subtree observation sees constant unrelated page churn (chat, timers,
 * etc.) - this keeps the captured trail limited to the one question that matters: what,
 * specifically, changed on or near the tabs right before selection was lost.
 * @param {Node} node
 * @returns {boolean}
 */
function isDiagnosticMutationTarget(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.getAttribute('role') === 'tab') return true;
    if (node.hasAttribute('data-mwi-custom-tab') || node.hasAttribute('data-mwi-tab-owner')) return true;
    return Boolean(node.closest && node.closest('.MuiTabs-flexContainer[role="tablist"]'));
}

function describeMutationTarget(node) {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute('role') || '';
    const kind = node.hasAttribute('data-mwi-custom-tab') ? 'custom' : role === 'tab' ? 'native' : 'other';
    const text = (node.textContent || '').trim().slice(0, 24).replace(/\s+/g, ' ');
    return `<${tag}${role ? ` role="${role}"` : ''}> [${kind}] "${text}"`;
}

/**
 * Diagnostic-only: summarize a MutationRecord relevant to marketplace tab selection, to
 * distinguish a native React/MUI selection glitch (mutation lands on a native tab) from one
 * caused by Toolasha's own injected tabs (mutation lands on a custom tab, or a childList churn
 * on the shared tablist container itself). Returns null for anything outside the tab area.
 * @param {MutationRecord} record
 * @returns {string|null}
 */
function summarizeMutation(record) {
    if (!isDiagnosticMutationTarget(record.target)) return null;
    const label = describeMutationTarget(record.target);
    if (record.type === 'attributes') {
        const newValue = record.target.getAttribute(record.attributeName);
        return `attr "${record.attributeName}" on ${label}: "${record.oldValue}" -> "${newValue}"`;
    }
    if (record.type === 'childList') {
        return `childList on ${label}: +${record.addedNodes.length}/-${record.removedNodes.length}`;
    }
    return `${record.type} on ${label}`;
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
    // Diagnostic-only: bounded trail of relevant mutations leading up to an invalid-state
    // episode, cleared on recovery so a later failure is never attributed to stale entries.
    const mutationTrail = [];

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

    // Diagnostic-only: the cleanup path below was previously silent, leaving no console
    // trace when custom marketplace tabs got torn down.
    function describeInvalidState() {
        const candidates = getMarketplaceTabContainerCandidates();
        if (candidates.size !== 1) {
            return `expected exactly 1 visible marketplace tab container, found ${candidates.size}`;
        }
        const container = candidates.values().next().value;
        if (owner && !isMarketplaceMarketListingsSelected(container)) {
            // Full per-native-tab breakdown, not just "was something selected" - distinguishes a
            // genuine tab switch (My Listings now selected) from both native tabs losing their
            // selected marker simultaneously (a render/reconciliation glitch, not user action).
            const nativeTabs = Array.from(container.children).filter(
                (tab) =>
                    tab.getAttribute('role') === 'tab' &&
                    !tab.hasAttribute('data-mwi-custom-tab') &&
                    !tab.hasAttribute('data-mwi-shrine-tab')
            );
            const states = nativeTabs
                .map(
                    (tab) =>
                        `"${tab.textContent}" aria-selected=${tab.getAttribute('aria-selected')} Mui-selected=${tab.classList.contains('Mui-selected')}`
                )
                .join('; ');
            return `Market Listings tab not selected (native tabs: ${states || 'none found'})`;
        }
        if (owner) {
            return `no connected/visible custom tabs remain for owner "${owner}"`;
        }
        return 'legacy tabsArray no longer in document';
    }

    // Diagnostic-only: renders the captured mutation trail (see poll()) so the warning below
    // shows exactly what changed right before selection was lost - distinguishing a native
    // React/MUI glitch (mutation lands on a native tab) from Toolasha's own injected tabs
    // disrupting the shared tablist (mutation lands on a custom tab, or childList churn on the
    // container itself).
    function formatMutationTrail() {
        if (!mutationTrail.length) {
            return ' (no relevant DOM mutations captured - detected via the 1s poll interval, not a live mutation)';
        }
        return `\n  Recent relevant mutations leading up to this:\n  - ${mutationTrail.join('\n  - ')}`;
    }

    function notifyInvalidState() {
        if (invalidStateNotified || invalidStateTimer || !onTabsGone) return;

        if (invalidStateGraceMs <= 0) {
            invalidStateNotified = true;
            console.warn(
                `[MarketplaceTabs] Cleanup triggered${owner ? ` for owner "${owner}"` : ''}: ${describeInvalidState()}${formatMutationTrail()}`
            );
            onTabsGone();
            return;
        }

        invalidStateTimer = setTimeout(() => {
            invalidStateTimer = null;
            if (isStopped || invalidStateNotified || hasValidState()) return;
            invalidStateNotified = true;
            console.warn(
                `[MarketplaceTabs] Cleanup triggered${owner ? ` for owner "${owner}"` : ''}: ${describeInvalidState()}${formatMutationTrail()}`
            );
            onTabsGone();
        }, invalidStateGraceMs);
    }

    function poll(mutations) {
        if (isStopped) return;

        // mutations is only present when called as the MutationObserver callback directly (the
        // 1s setInterval fallback below calls poll() with no arguments) - diagnostic-only.
        if (mutations) {
            for (const record of mutations) {
                const summary = summarizeMutation(record);
                if (!summary) continue;
                mutationTrail.push(summary);
                if (mutationTrail.length > 8) mutationTrail.shift();
            }
        }

        if (!hasValidState()) {
            notifyInvalidState();
            return;
        }

        clearInvalidStateTimer();
        invalidStateNotified = false;
        mutationTrail.length = 0;
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
        return matchesMarketplaceTabLabel(el.textContent, 'myListings');
    });

    if (!tab) return false;
    tab.click();
    return true;
}
