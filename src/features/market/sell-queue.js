/**
 * Sell Queue
 * Shift+RightClick inventory items to queue them for selling.
 * Creates marketplace tabs for each queued item; tabs auto-close when item count hits 0.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import {
    createMaterialTab,
    removeMaterialTabsForOwner,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
    getVisibleMarketplaceTabContainer,
    clickMarketplaceNavigationButton,
    watchNativeTabExit,
    MARKETPLACE_REMOUNT_GRACE_MS,
    isMarketplaceMarketListingsSelected,
} from '../../utils/marketplace-tabs.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const timerRegistry = createTimerRegistry();

/** @type {Array<{itemHrid: string, itemName: string}>} */
const queue = [];

/** @type {HTMLElement[]} */
const currentTabs = [];

let cleanupObserver = null;
let nativeTabExitCleanup = null;
let inventoryUpdateHandler = null;
let currentItemHrid = null;
let tooltipObserverUnregister = null;
let contextMenuHandler = null;
let isActive = false;
let sellQueueSessionId = null;
let sellQueueReadyPromise = null;

/**
 * Get total inventory count for an item hrid.
 * @param {string} itemHrid
 * @returns {number}
 */
function getInventoryCount(itemHrid) {
    const inventory = dataManager.getInventory();
    if (!inventory) return 0;
    return inventory
        .filter((i) => i.itemHrid === itemHrid && i.itemLocationHrid === '/item_locations/inventory')
        .reduce((sum, i) => sum + (i.count || 0), 0);
}

/**
 * Navigate to the marketplace by clicking its navbar button.
 * @returns {Promise<boolean>}
 */
async function openMarketplacePage(sessionId) {
    if (!clickMarketplaceNavigationButton()) return false;
    return await waitForMarketplace(sessionId);
}

/**
 * Wait for the marketplace tabs container to appear.
 * @returns {Promise<boolean>}
 */
async function waitForMarketplace(sessionId) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (!marketplaceSession.isActive(sessionId)) return false;
        if (getVisibleMarketplaceTabContainer()) return true;
        await new Promise((resolve) => timerRegistry.registerTimeout(setTimeout(resolve, 100)));
    }
    return false;
}

/**
 * Inject tabs for all queued items into the marketplace tab strip.
 */
function injectTabs(tabsContainer = getVisibleMarketplaceTabContainer(), sessionId = sellQueueSessionId) {
    if (!tabsContainer || !marketplaceSession.isActive(sessionId)) return false;

    removeMaterialTabsForOwner(MARKETPLACE_OWNER.SELL_QUEUE);
    currentTabs.length = 0;

    const referenceTab = Array.from(tabsContainer.children).find((tab) => tab.textContent.includes('My Listings'));
    if (!referenceTab) return false;
    tabsContainer.style.flexWrap = 'wrap';

    nativeTabExitCleanup?.();
    nativeTabExitCleanup = watchNativeTabExit(tabsContainer, () => marketplaceSession.end(sessionId));

    for (const entry of queue) {
        const count = getInventoryCount(entry.itemHrid);
        const material = {
            itemHrid: entry.itemHrid,
            itemName: entry.itemName,
            missing: 0,
            required: count,
            isTradeable: true,
            forceActionable: count > 0,
        };

        const tab = createMaterialTab(
            material,
            referenceTab,
            (_event, mat) => {
                if (!marketplaceSession.isActive(sessionId)) return;
                if (!navigateToMarketplace(mat.itemHrid, 0)) marketplaceSession.end(sessionId);
            },
            MARKETPLACE_OWNER.SELL_QUEUE
        );
        const badge = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badge) badge.innerHTML = buildBadgeHtml(entry.itemName, count);
        tabsContainer.appendChild(tab);
        currentTabs.push(tab);
    }

    return true;
}

/**
 * Build badge HTML for a queued item tab.
 * @param {string} itemName
 * @param {number} count
 * @returns {string}
 */
function buildBadgeHtml(itemName, count) {
    const titleCase = itemName
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    const color = count > 0 ? '#4ade80' : '#6b7280';
    const sub = count > 0 ? `In bag: ${count.toLocaleString()}` : 'Sold out';
    return `<div style="text-align:center;"><div>${titleCase}</div><div style="font-size:0.75em;color:${color};">${sub}</div></div>`;
}

/**
 * Update tab badges and remove tabs for items that have sold out.
 * Auto-navigates to the next queued item when the current one sells out.
 */
function updateTabsOnInventoryChange() {
    const connectedTabs = Array.from(
        document.querySelectorAll(
            `[data-mwi-custom-tab][data-mwi-tab-owner="${MARKETPLACE_OWNER.SELL_QUEUE}"][data-item-hrid]`
        )
    );
    const counts = new Map(queue.map((entry) => [entry.itemHrid, getInventoryCount(entry.itemHrid)]));
    const toRemove = queue.filter((entry) => counts.get(entry.itemHrid) === 0).map((entry) => entry.itemHrid);

    connectedTabs.forEach((tab) => {
        const itemHrid = tab.getAttribute('data-item-hrid');
        const entry = queue.find((candidate) => candidate.itemHrid === itemHrid);
        if (!entry) return;

        const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badgeSpan) badgeSpan.innerHTML = buildBadgeHtml(entry.itemName, counts.get(itemHrid) || 0);
    });

    for (const hrid of toRemove) {
        const idx = queue.findIndex((e) => e.itemHrid === hrid);
        if (idx !== -1) queue.splice(idx, 1);

        // Remove both the currently connected tab and any detached pre-remount
        // references retained in currentTabs.
        document
            .querySelectorAll(
                `[data-mwi-custom-tab][data-mwi-tab-owner="${MARKETPLACE_OWNER.SELL_QUEUE}"]` +
                    `[data-item-hrid="${hrid}"]`
            )
            .forEach((tab) => tab.remove());
        for (let tabIndex = currentTabs.length - 1; tabIndex >= 0; tabIndex -= 1) {
            if (currentTabs[tabIndex].getAttribute('data-item-hrid') !== hrid) continue;
            currentTabs[tabIndex].remove();
            currentTabs.splice(tabIndex, 1);
        }
    }

    // After removing sold-out tabs, navigate to the first remaining queued item
    if (toRemove.length > 0 && queue.length > 0) {
        if (!navigateToMarketplace(queue[0].itemHrid, 0) && sellQueueSessionId !== null) {
            marketplaceSession.end(sellQueueSessionId);
        }
    } else if (queue.length === 0 && sellQueueSessionId !== null) {
        marketplaceSession.end(sellQueueSessionId);
    }
}

/**
 * Set up listener to update tabs when inventory changes.
 */
function setupInventoryListener() {
    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
    }
    inventoryUpdateHandler = () => {
        updateTabsOnInventoryChange();
    };
    dataManager.on('items_updated', inventoryUpdateHandler);
}

/**
 * Idempotent teardown of the marketplace session and its associated state.
 * Does NOT touch isActive, contextMenuHandler, or tooltipObserverUnregister.
 */
function teardownSellQueueMarketplaceSession() {
    sellQueueSessionId = null;
    sellQueueReadyPromise = null;
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.SELL_QUEUE);
    currentTabs.length = 0;
    queue.length = 0;
    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }
    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }
    nativeTabExitCleanup?.();
    nativeTabExitCleanup = null;
    currentItemHrid = null;
}

/**
 * Prepare the Marketplace UI for one captured Sell Queue session.
 * A shared promise lets several rapid queue additions join the same navigation
 * instead of treating the not-yet-mounted tablist as a fatal reinjection failure.
 * @param {number} sessionId
 * @returns {Promise<boolean>}
 */
async function prepareSellQueueMarketplace(sessionId) {
    if (!getVisibleMarketplaceTabContainer()) {
        const success = await openMarketplacePage(sessionId);
        if (!success || !marketplaceSession.isActive(sessionId)) return false;
        await new Promise((resolve) => timerRegistry.registerTimeout(setTimeout(resolve, 200)));
    }

    if (!marketplaceSession.isActive(sessionId)) return false;
    if (!injectTabs(getVisibleMarketplaceTabContainer(), sessionId)) return false;

    cleanupObserver?.();
    cleanupObserver = setupMarketplaceCleanupObserver({
        owner: MARKETPLACE_OWNER.SELL_QUEUE,
        invalidStateGraceMs: MARKETPLACE_REMOUNT_GRACE_MS,
        onTabsGone: () => {
            if (!marketplaceSession.isActive(sessionId)) return;
            const container = getVisibleMarketplaceTabContainer();
            if (container && isMarketplaceMarketListingsSelected(container) && injectTabs(container, sessionId)) return;
            marketplaceSession.end(sessionId);
        },
    });
    setupInventoryListener();
    return true;
}

/**
 * Add an item to the queue and inject/update tabs.
 * @param {string} itemHrid
 * @param {string} itemName
 */
async function addToQueue(itemHrid, itemName) {
    if (queue.some((entry) => entry.itemHrid === itemHrid)) return;
    if (getInventoryCount(itemHrid) <= 0) return;

    const isFirstItem = queue.length === 0;
    queue.push({ itemHrid, itemName });

    if (isFirstItem) {
        const sessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.SELL_QUEUE,
            onEnd: teardownSellQueueMarketplaceSession,
        });
        sellQueueSessionId = sessionId;
        sellQueueReadyPromise = prepareSellQueueMarketplace(sessionId);
    }

    const capturedSessionId = sellQueueSessionId;
    const pendingReady = sellQueueReadyPromise;
    if (pendingReady) {
        const ready = await pendingReady;
        if (sellQueueReadyPromise === pendingReady) sellQueueReadyPromise = null;
        if (!ready || !marketplaceSession.isActive(capturedSessionId)) {
            if (marketplaceSession.isActive(capturedSessionId)) marketplaceSession.end(capturedSessionId);
            return;
        }
    }

    // Subsequent callers rebuild the tab list to include items added after the first
    // prepareSellQueueMarketplace call. The first caller's tabs are already correct.
    if (!isFirstItem) {
        if (!injectTabs(getVisibleMarketplaceTabContainer(), capturedSessionId)) {
            marketplaceSession.end(capturedSessionId);
            return;
        }
    }

    // The entry may have been cleared by replacement while this caller awaited the
    // shared navigation. Only the still-active owner may perform the final selection.
    if (
        !marketplaceSession.isActive(capturedSessionId) ||
        !queue.some((entry) => entry.itemHrid === itemHrid) ||
        !navigateToMarketplace(itemHrid, 0)
    ) {
        if (marketplaceSession.isActive(capturedSessionId)) marketplaceSession.end(capturedSessionId);
    }
}

/**
 * Track the hovered item HRID via tooltip observer (same strategy as alt-click-navigation).
 * @param {HTMLElement} tooltipElement
 */
function handleTooltipAppear(tooltipElement) {
    currentItemHrid = null;
    try {
        const itemLink = tooltipElement.querySelector('a[href*="/items/"]');
        if (itemLink) {
            const match = itemLink.getAttribute('href').match(/\/items\/(.+?)(?:\/|$)/);
            if (match) {
                currentItemHrid = `/items/${match[1]}`;
                return;
            }
        }
        const svgUse = tooltipElement.querySelector('use[href*="items_sprite"]');
        if (svgUse) {
            const match = svgUse.getAttribute('href').match(/#(.+)$/);
            if (match) {
                currentItemHrid = `/items/${match[1]}`;
                return;
            }
        }
        const nameEl = tooltipElement.querySelector(
            '[class*="ItemTooltipText_name"] span, .ItemTooltipText_name__2JAHA span'
        );
        if (nameEl) {
            const itemName = nameEl.textContent.trim();
            currentItemHrid = `/items/${itemName.toLowerCase().replace(/\s+/g, '_')}`;
        }
    } catch (error) {
        console.error('[SellQueue] Error parsing tooltip:', error);
    }
}

function initialize() {
    if (isActive) return;
    if (!config.getSetting('sellQueue')) return;

    tooltipObserverUnregister = domObserver.onClass('SellQueue-Tooltip', 'MuiTooltip-popper', (el) =>
        handleTooltipAppear(el)
    );

    contextMenuHandler = async (event) => {
        if (!event.shiftKey) return;

        const inventoryEl = event.target.closest('[class*="Inventory_items"], [class*="Inventory_inventory"]');
        if (!inventoryEl) return;
        if (!currentItemHrid) return;

        event.preventDefault();
        event.stopPropagation();

        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData?.itemDetailMap?.[currentItemHrid];
        if (!itemDetails?.isTradable) return;

        try {
            await addToQueue(currentItemHrid, itemDetails.name);
        } catch (error) {
            console.error('[SellQueue] Failed to add item to the Marketplace queue:', error);
            if (sellQueueSessionId !== null) marketplaceSession.end(sellQueueSessionId);
        }
    };

    document.addEventListener('contextmenu', contextMenuHandler, true);
    isActive = true;
}

function cleanup() {
    if (sellQueueSessionId !== null && marketplaceSession.isActive(sellQueueSessionId)) {
        marketplaceSession.end(sellQueueSessionId);
    } else {
        teardownSellQueueMarketplaceSession();
    }
    if (contextMenuHandler) {
        document.removeEventListener('contextmenu', contextMenuHandler, true);
        contextMenuHandler = null;
    }
    if (tooltipObserverUnregister) {
        tooltipObserverUnregister();
        tooltipObserverUnregister = null;
    }
    timerRegistry.clearAll();
    isActive = false;
}

config.onSettingChange('sellQueue', (value) => {
    if (value) initialize();
    else cleanup();
});

export default {
    name: 'Sell Queue',
    initialize,
    cleanup,
};
