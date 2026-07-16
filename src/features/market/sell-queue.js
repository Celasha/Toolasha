/**
 * Sell Queue
 * Shift+RightClick inventory items to queue them for selling.
 * Creates marketplace tabs for each queued item; tabs auto-close when item count hits 0.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import {
    createMaterialTab,
    removeMaterialTabs,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
} from '../../utils/marketplace-tabs.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const timerRegistry = createTimerRegistry();

/** @type {Array<{itemHrid: string, itemName: string}>} */
const queue = [];

/** @type {HTMLElement[]} */
const currentTabs = [];

let cleanupObserver = null;
let inventoryUpdateHandler = null;
let currentItemHrid = null;
let tooltipObserverUnregister = null;
let contextMenuHandler = null;
let isActive = false;

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
async function openMarketplacePage() {
    const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
    const marketplaceButton = Array.from(navButtons).find((nav) =>
        nav.querySelector('svg[aria-label="navigationBar.marketplace"]')
    );
    if (!marketplaceButton) return false;
    marketplaceButton.click();
    return await waitForMarketplace();
}

/**
 * Wait for the marketplace tabs container to appear.
 * @returns {Promise<boolean>}
 */
async function waitForMarketplace() {
    for (let i = 0; i < 50; i++) {
        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
        if (tabsContainer) {
            const hasMarket = Array.from(tabsContainer.children).some((btn) =>
                btn.textContent.includes('Market Listings')
            );
            if (hasMarket) return true;
        }
        await new Promise((resolve) => {
            timerRegistry.registerTimeout(setTimeout(resolve, 100));
        });
    }
    return false;
}

/**
 * Inject tabs for all queued items into the marketplace tab strip.
 */
function injectTabs() {
    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
    if (!tabsContainer) return;

    removeMaterialTabs();
    currentTabs.length = 0;

    const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));
    if (!referenceTab) return;

    tabsContainer.style.flexWrap = 'wrap';

    for (const entry of queue) {
        const count = getInventoryCount(entry.itemHrid);
        const material = {
            itemHrid: entry.itemHrid,
            itemName: entry.itemName,
            missing: 0,
            required: count,
            isTradeable: true,
        };

        const tab = createMaterialTab(material, referenceTab, (_e, mat) => {
            navigateToMarketplace(mat.itemHrid, 0);
        });

        const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badgeSpan) {
            badgeSpan.innerHTML = buildBadgeHtml(entry.itemName, count);
        }

        tabsContainer.appendChild(tab);
        currentTabs.push(tab);
    }
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
    if (currentTabs.length === 0) return;

    const toRemove = [];

    currentTabs.forEach((tab) => {
        const itemHrid = tab.getAttribute('data-item-hrid');
        const entry = queue.find((e) => e.itemHrid === itemHrid);
        if (!entry) return;

        const count = getInventoryCount(entry.itemHrid);
        const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badgeSpan) {
            badgeSpan.innerHTML = buildBadgeHtml(entry.itemName, count);
        }

        if (count === 0) {
            toRemove.push(itemHrid);
        }
    });

    for (const hrid of toRemove) {
        const idx = queue.findIndex((e) => e.itemHrid === hrid);
        if (idx !== -1) queue.splice(idx, 1);

        const tabIdx = currentTabs.findIndex((t) => t.getAttribute('data-item-hrid') === hrid);
        if (tabIdx !== -1) {
            currentTabs[tabIdx].remove();
            currentTabs.splice(tabIdx, 1);
        }
    }

    // After removing sold-out tabs, navigate to the first remaining queued item
    if (toRemove.length > 0 && queue.length > 0) {
        navigateToMarketplace(queue[0].itemHrid, 0);
    }
}

/**
 * Set up WebSocket listener to update tabs when inventory changes.
 */
function setupInventoryListener() {
    if (inventoryUpdateHandler) {
        webSocketHook.off('*', inventoryUpdateHandler);
    }
    inventoryUpdateHandler = (data) => {
        if (
            data.type?.includes('item') ||
            data.type?.includes('inventory') ||
            data.type?.includes('market') ||
            data.inventory ||
            data.characterItems
        ) {
            updateTabsOnInventoryChange();
        }
    };
    webSocketHook.on('*', inventoryUpdateHandler);
}

/**
 * Handle cleanup when user leaves the marketplace.
 */
function handleMarketplaceCleanup() {
    removeMaterialTabs();
    currentTabs.length = 0;
    queue.length = 0;
    if (inventoryUpdateHandler) {
        webSocketHook.off('*', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }
}

/**
 * Add an item to the queue and inject/update tabs.
 * @param {string} itemHrid
 * @param {string} itemName
 */
async function addToQueue(itemHrid, itemName) {
    if (queue.some((e) => e.itemHrid === itemHrid)) return;

    const count = getInventoryCount(itemHrid);
    if (count === 0) return;

    const isFirstItem = queue.length === 0;
    queue.push({ itemHrid, itemName });

    if (isFirstItem) {
        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
        const alreadyInMarket =
            tabsContainer &&
            Array.from(tabsContainer.children).some((btn) => btn.textContent.includes('Market Listings'));

        if (!alreadyInMarket) {
            const success = await openMarketplacePage();
            if (!success) {
                queue.length = 0;
                return;
            }
            await new Promise((resolve) => {
                timerRegistry.registerTimeout(setTimeout(resolve, 200));
            });
        }

        cleanupObserver = setupMarketplaceCleanupObserver(handleMarketplaceCleanup, currentTabs);
        setupInventoryListener();
    }

    injectTabs();
    navigateToMarketplace(itemHrid, 0);
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

    contextMenuHandler = (event) => {
        if (!event.shiftKey) return;

        const inventoryEl = event.target.closest('[class*="Inventory_items"], [class*="Inventory_inventory"]');
        if (!inventoryEl) return;
        if (!currentItemHrid) return;

        event.preventDefault();
        event.stopPropagation();

        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData?.itemDetailMap?.[currentItemHrid];
        if (!itemDetails) return;
        if (!itemDetails.isTradable) return;

        addToQueue(currentItemHrid, itemDetails.name);
    };

    document.addEventListener('contextmenu', contextMenuHandler, true);
    isActive = true;
}

function cleanup() {
    if (contextMenuHandler) {
        document.removeEventListener('contextmenu', contextMenuHandler, true);
        contextMenuHandler = null;
    }
    if (tooltipObserverUnregister) {
        tooltipObserverUnregister();
        tooltipObserverUnregister = null;
    }
    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }
    handleMarketplaceCleanup();
    timerRegistry.clearAll();
    currentItemHrid = null;
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
