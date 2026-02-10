/**
 * Marketplace Custom Tabs Utility
 * Provides shared functionality for creating and managing custom marketplace tabs
 * Used by missing materials features (actions, houses, etc.)
 */

import { formatWithSeparator } from './formatters.js';
import { createMutationWatcher } from './dom-observer-helpers.js';

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
 * @returns {HTMLElement} Created tab element
 */
export function createMaterialTab(material, referenceTab, onClickCallback) {
    // Clone reference tab structure
    const tab = referenceTab.cloneNode(true);

    // Mark as custom tab for later identification
    tab.setAttribute('data-mwi-custom-tab', 'true');
    tab.setAttribute('data-item-hrid', material.itemHrid);
    tab.setAttribute('data-missing-quantity', material.missing.toString());

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
        statusText = 'Sufficient';
    }

    // Update text content
    const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
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
 * Setup marketplace cleanup observer
 * Watches for marketplace panel removal and calls cleanup callback
 * @param {Function} onCleanup - Callback when marketplace closes, receives no args
 * @param {Array} tabsArray - Array reference to track tabs (will be checked for length)
 * @returns {Function} Unregister function to stop observing
 */
export function setupMarketplaceCleanupObserver(onCleanup, tabsArray) {
    let debounceTimer = null;

    const cleanupObserver = createMutationWatcher(
        document.body,
        () => {
            // Only check if we have custom tabs
            if (!tabsArray || tabsArray.length === 0) {
                return;
            }

            // Clear existing debounce timer
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }

            // Debounce to avoid false positives from rapid DOM changes
            debounceTimer = setTimeout(() => {
                // Check if we still have custom tabs
                if (!tabsArray || tabsArray.length === 0) {
                    return;
                }

                // Check if our custom tabs still exist in the DOM
                const hasCustomTabsInDOM = tabsArray.some((tab) => document.body.contains(tab));

                // If our tabs were removed from DOM, clean up
                if (!hasCustomTabsInDOM) {
                    if (onCleanup) {
                        onCleanup();
                    }
                    return;
                }

                // Check if marketplace navbar is active
                const marketplaceNavActive = Array.from(document.querySelectorAll('.NavigationBar_nav__3uuUl')).some(
                    (nav) => {
                        const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
                        return svg && nav.classList.contains('NavigationBar_active__2Oj_e');
                    }
                );

                // Check if tabs container still exists (marketplace panel is open)
                const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                const hasMarketListingsTab =
                    tabsContainer &&
                    Array.from(tabsContainer.children).some((btn) => btn.textContent.includes('Market Listings'));

                // Only cleanup if BOTH navbar is inactive AND marketplace tabs are gone
                // This prevents cleanup during transitions when navbar might briefly be inactive
                if (!marketplaceNavActive && !hasMarketListingsTab) {
                    if (onCleanup) {
                        onCleanup();
                    }
                }
            }, 100);
        },
        {
            childList: true,
            subtree: true,
        }
    );

    // Return cleanup function that also clears the debounce timer
    return () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        cleanupObserver();
    };
}

/**
 * Get game object via React fiber
 * @returns {Object|null} Game component instance
 */
function getGameObject() {
    const gamePageEl = document.querySelector('[class^="GamePage"]');
    if (!gamePageEl) return null;

    const fiberKey = Object.keys(gamePageEl).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;

    return gamePageEl[fiberKey]?.return?.stateNode;
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
    } else {
        console.error('[MarketplaceTabs] Game API not available');
    }
}
