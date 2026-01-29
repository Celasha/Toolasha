/**
 * Missing Materials Marketplace Button
 * Adds button to production panels that opens marketplace with tabs for missing materials
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import { findActionInput, attachInputListeners, performInitialUpdate } from '../../utils/action-panel-helper.js';
import { calculateMaterialRequirements } from '../../utils/material-calculator.js';
import { formatWithSeparator } from '../../utils/formatters.js';

/**
 * Module-level state
 */
let cleanupObserver = null;
let currentMaterialsTabs = [];
let domObserverUnregister = null;
let processedPanels = new WeakSet();
let inventoryUpdateHandler = null;
let storedActionHrid = null;
let storedNumActions = 0;
let buyModalObserverUnregister = null;
let activeMissingQuantity = null;

/**
 * Production action types (where button should appear)
 */
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

/**
 * Get the game object via React fiber
 * @returns {Object|null} Game component instance or null
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
 * @param {string} itemHrid - Item HRID
 * @param {number} enhancementLevel - Enhancement level (default 0)
 */
function goToMarketplace(itemHrid, enhancementLevel = 0) {
    const game = getGameObject();
    if (game?.handleGoToMarketplace) {
        game.handleGoToMarketplace(itemHrid, enhancementLevel);
    }
}

/**
 * Initialize missing materials button feature
 */
export function initialize() {
    console.log('[MissingMats] Initializing missing materials button feature');
    setupMarketplaceCleanupObserver();
    setupBuyModalObserver();

    // Watch for action panels appearing
    domObserverUnregister = domObserver.onClass(
        'MissingMaterialsButton-ActionPanel',
        'SkillActionDetail_skillActionDetail',
        () => processActionPanels()
    );

    // Process existing panels
    processActionPanels();
}

/**
 * Cleanup function
 */
export function cleanup() {
    console.log('[MissingMats] Cleaning up missing materials button feature');

    // Unregister DOM observer
    if (domObserverUnregister) {
        domObserverUnregister();
        domObserverUnregister = null;
    }

    // Disconnect marketplace cleanup observer
    if (cleanupObserver) {
        cleanupObserver.disconnect();
        cleanupObserver = null;
    }

    // Unregister buy modal observer
    if (buyModalObserverUnregister) {
        buyModalObserverUnregister();
        buyModalObserverUnregister = null;
    }

    // Remove any existing custom tabs
    removeMissingMaterialTabs();

    // Clear processed panels
    processedPanels = new WeakSet();
}

/**
 * Process action panels - watch for input changes
 */
function processActionPanels() {
    const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');

    panels.forEach((panel) => {
        // Skip if already processed
        if (processedPanels.has(panel)) {
            return;
        }

        // Find the input box using utility
        const inputField = findActionInput(panel);
        if (!inputField) {
            return;
        }

        // Mark as processed
        processedPanels.add(panel);

        // Attach input listeners using utility
        attachInputListeners(panel, inputField, (value) => {
            updateButtonForPanel(panel, value);
        });

        // Initial update if there's already a value
        performInitialUpdate(inputField, (value) => {
            updateButtonForPanel(panel, value);
        });
    });
}

/**
 * Update button visibility and content for a panel based on input value
 * @param {HTMLElement} panel - Action panel element
 * @param {string} value - Input value (number of actions)
 */
function updateButtonForPanel(panel, value) {
    const numActions = parseInt(value) || 0;

    // Remove existing button
    const existingButton = panel.querySelector('#mwi-missing-mats-button');
    if (existingButton) {
        existingButton.remove();
    }

    // Don't show button if no quantity entered
    if (numActions <= 0) {
        return;
    }

    // Check if feature is enabled
    if (config.getSetting('actions_missingMaterialsButton') !== true) {
        return;
    }

    // Get action details
    const actionHrid = getActionHridFromPanel(panel);
    if (!actionHrid) {
        return;
    }

    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];
    if (!actionDetail) {
        return;
    }

    // Verify this is a production action
    if (!PRODUCTION_TYPES.includes(actionDetail.type)) {
        return;
    }

    // Check if action has input materials
    if (!actionDetail.inputItems || actionDetail.inputItems.length === 0) {
        return;
    }

    // Get missing materials using shared utility
    const missingMaterials = calculateMaterialRequirements(actionHrid, numActions);
    if (missingMaterials.length === 0) {
        return;
    }

    // Create and insert button with actionHrid and numActions for live updates
    const button = createMissingMaterialsButton(missingMaterials, actionHrid, numActions);

    // Find insertion point (beneath item requirements field)
    const itemRequirements = panel.querySelector('.SkillActionDetail_itemRequirements__3SPnA');
    if (itemRequirements) {
        itemRequirements.parentNode.insertBefore(button, itemRequirements.nextSibling);
    } else {
        // Fallback: insert at top of panel
        panel.insertBefore(button, panel.firstChild);
    }

    // Don't manipulate modal styling - let the game handle it
    // The modal will scroll naturally if content overflows
}

/**
 * Get action HRID from panel
 * @param {HTMLElement} panel - Action panel element
 * @returns {string|null} Action HRID or null
 */
function getActionHridFromPanel(panel) {
    // Get action name from panel
    const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
    if (!actionNameElement) {
        return null;
    }

    const actionName = actionNameElement.textContent.trim();
    return getActionHridFromName(actionName);
}

/**
 * Convert action name to HRID
 * @param {string} actionName - Display name of action
 * @returns {string|null} Action HRID or null if not found
 */
function getActionHridFromName(actionName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) {
        return null;
    }

    // Search for action by name
    for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
        if (detail.name === actionName) {
            return hrid;
        }
    }

    return null;
}

/**
 * Create missing materials marketplace button
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {string} actionHrid - Action HRID for recalculating materials
 * @param {number} numActions - Number of actions for recalculating materials
 * @returns {HTMLElement} Button element
 */
function createMissingMaterialsButton(missingMaterials, actionHrid, numActions) {
    const button = document.createElement('button');
    button.id = 'mwi-missing-mats-button';
    button.textContent = 'Missing Mats Marketplace';
    button.style.cssText = `
        width: 100%;
        padding: 10px 16px;
        margin: 8px 0 16px 0;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    `;

    // Hover effect
    button.addEventListener('mouseenter', () => {
        button.style.background = 'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
        button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
        button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
    });

    button.addEventListener('mouseleave', () => {
        button.style.background = 'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
        button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
        button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    });

    // Click handler
    button.addEventListener('click', async () => {
        await handleMissingMaterialsClick(missingMaterials, actionHrid, numActions);
    });

    return button;
}

/**
 * Handle missing materials button click
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {string} actionHrid - Action HRID for recalculating materials
 * @param {number} numActions - Number of actions for recalculating materials
 */
async function handleMissingMaterialsClick(missingMaterials, actionHrid, numActions) {
    // Store context for live updates
    storedActionHrid = actionHrid;
    storedNumActions = numActions;

    // Navigate to marketplace
    const success = await navigateToMarketplace();
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        return;
    }

    // Wait a moment for marketplace to settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Create custom tabs
    createMissingMaterialTabs(missingMaterials);

    // Setup inventory listener for live updates
    setupInventoryListener();
}

/**
 * Navigate to marketplace by simulating click on navbar
 * @returns {Promise<boolean>} True if successful
 */
async function navigateToMarketplace() {
    // Find marketplace navbar button
    const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
    const marketplaceButton = Array.from(navButtons).find((nav) => {
        const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
        return svg !== null;
    });

    if (!marketplaceButton) {
        console.error('[MissingMats] Marketplace navbar button not found');
        return false;
    }

    // Simulate click
    marketplaceButton.click();

    // Wait for marketplace panel to appear
    return await waitForMarketplace();
}

/**
 * Wait for marketplace panel to appear
 * @returns {Promise<boolean>} True if marketplace appeared within timeout
 */
async function waitForMarketplace() {
    const maxAttempts = 50;
    const delayMs = 100;

    for (let i = 0; i < maxAttempts; i++) {
        // Check for marketplace panel by looking for tabs container
        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
        if (tabsContainer) {
            // Verify it's the marketplace tabs (has "Market Listings" tab)
            const hasMarketListings = Array.from(tabsContainer.children).some((btn) =>
                btn.textContent.includes('Market Listings')
            );
            if (hasMarketListings) {
                return true;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.error('[MissingMats] Marketplace did not open within timeout');
    return false;
}

/**
 * Create custom tabs for missing materials
 * @param {Array} missingMaterials - Array of missing material objects
 */
function createMissingMaterialTabs(missingMaterials) {
    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');

    if (!tabsContainer) {
        console.error('[MissingMats] Tabs container not found');
        return;
    }

    // Remove any existing custom tabs first
    removeMissingMaterialTabs();

    // Get reference tab for cloning (use "My Listings" as template)
    const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));

    if (!referenceTab) {
        console.error('[MissingMats] Reference tab not found');
        return;
    }

    // Enable flex wrapping for multiple rows (like game's native tabs)
    if (tabsContainer) {
        tabsContainer.style.flexWrap = 'wrap';
    }

    // Add click listeners to regular tabs to clear active quantity
    const regularTabs = tabsContainer.querySelectorAll('button:not([data-mwi-custom-tab])');
    regularTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            activeMissingQuantity = null;
        });
    });

    // Create tab for each missing material
    currentMaterialsTabs = [];
    for (const material of missingMaterials) {
        const tab = createCustomTab(material, referenceTab);
        tabsContainer.appendChild(tab);
        currentMaterialsTabs.push(tab);
    }
}

/**
 * Setup inventory listener for live tab updates
 * Listens for inventory changes via websocket and updates tabs accordingly
 */
function setupInventoryListener() {
    // Remove existing listener if any
    if (inventoryUpdateHandler) {
        webSocketHook.off('*', inventoryUpdateHandler);
    }

    // Create new listener that watches for inventory-related messages
    inventoryUpdateHandler = (data) => {
        // Check if this message might affect inventory
        // Common message types that update inventory:
        // - item_added, item_removed, items_updated
        // - market_buy_complete, market_sell_complete
        // - Or any message with inventory field
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
 * Update all custom tabs when inventory changes
 * Recalculates materials and updates badge display
 */
function updateTabsOnInventoryChange() {
    // Check if we have valid context
    if (!storedActionHrid || storedNumActions <= 0) {
        return;
    }

    // Check if tabs still exist
    if (currentMaterialsTabs.length === 0) {
        return;
    }

    // Recalculate materials with current inventory
    const updatedMaterials = calculateMaterialRequirements(storedActionHrid, storedNumActions);

    // Update each existing tab
    currentMaterialsTabs.forEach((tab) => {
        const itemHrid = tab.getAttribute('data-item-hrid');
        const material = updatedMaterials.find((m) => m.itemHrid === itemHrid);

        if (material) {
            updateTabBadge(tab, material);
        }
    });
}

/**
 * Update a single tab's badge with new material data
 * @param {HTMLElement} tab - Tab element to update
 * @param {Object} material - Material object with updated counts
 */
function updateTabBadge(tab, material) {
    const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
    if (!badgeSpan) {
        return;
    }

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
        statusText = `Missing: ${formatWithSeparator(material.missing)}`;
    } else {
        statusColor = '#4ade80'; // Green - sufficient materials
        statusText = 'Sufficient';
    }

    // Title case: capitalize first letter of each word
    const titleCaseName = material.itemName
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

    // Update badge HTML
    badgeSpan.innerHTML = `
        <div style="text-align: center;">
            <div>${titleCaseName}</div>
            <div style="font-size: 0.75em; color: ${statusColor};">
                ${statusText}
            </div>
        </div>
    `;

    // Update tab styling based on state
    if (!material.isTradeable) {
        tab.style.opacity = '0.5';
        tab.style.cursor = 'not-allowed';
    } else {
        tab.style.opacity = '1';
        tab.style.cursor = 'pointer';
        tab.title = '';
    }
}

/**
 * Create a custom tab for a material
 * @param {Object} material - Material object with itemHrid, itemName, missing, have, isTradeable
 * @param {HTMLElement} referenceTab - Reference tab to clone structure from
 * @returns {HTMLElement} Custom tab element
 */
function createCustomTab(material, referenceTab) {
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
        statusText = `Missing: ${formatWithSeparator(material.missing)}`;
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

        // Store the missing quantity for auto-fill when buy modal opens
        activeMissingQuantity = material.missing;

        // Navigate to marketplace using game API
        goToMarketplace(material.itemHrid, 0);
    });

    return tab;
}

/**
 * Remove all missing material tabs
 */
function removeMissingMaterialTabs() {
    const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
    customTabs.forEach((tab) => tab.remove());
    currentMaterialsTabs = [];

    // Clean up inventory listener
    if (inventoryUpdateHandler) {
        webSocketHook.off('*', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }

    // Clear stored context
    storedActionHrid = null;
    storedNumActions = 0;
    activeMissingQuantity = null;
}

/**
 * Setup marketplace cleanup observer
 * Watches for marketplace panel removal and cleans up custom tabs
 */
function setupMarketplaceCleanupObserver() {
    cleanupObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const removedNode of mutation.removedNodes) {
                // Check if marketplace panel was removed
                // Look for tabs container disappearing
                if (removedNode.nodeType === Node.ELEMENT_NODE) {
                    const hadTabsContainer = removedNode.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                    if (hadTabsContainer) {
                        // Marketplace closed, remove custom tabs
                        removeMissingMaterialTabs();
                        console.log('[MissingMats] Marketplace closed, cleaned up custom tabs');
                    }
                }
            }
        }
    });

    // Observe document.body for removed nodes
    if (document.body) {
        cleanupObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

/**
 * Setup buy modal observer
 * Watches for buy modals appearing and auto-fills quantity if from missing materials tab
 */
function setupBuyModalObserver() {
    buyModalObserverUnregister = domObserver.onClass(
        'MissingMaterialsButton-BuyModal',
        'Modal_modalContainer',
        (modal) => {
            handleBuyModal(modal);
        }
    );
}

/**
 * Handle buy modal appearance
 * Auto-fills quantity if we have an active missing quantity
 * @param {HTMLElement} modal - Modal container element
 */
function handleBuyModal(modal) {
    // Check if we have an active missing quantity to fill
    if (!activeMissingQuantity || activeMissingQuantity <= 0) {
        return;
    }

    // Check if this is a "Buy Now" modal
    const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
    if (!header) {
        return;
    }

    const headerText = header.textContent.trim();
    if (!headerText.includes('Buy Now') && !headerText.includes('立即购买')) {
        return;
    }

    // Find the quantity input
    const quantityInput = modal.querySelector('input[type="number"]');
    if (!quantityInput) {
        return;
    }

    // Set the quantity value
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(quantityInput, activeMissingQuantity.toString());

    // Trigger input event to notify React
    const inputEvent = new Event('input', { bubbles: true });
    quantityInput.dispatchEvent(inputEvent);

    console.log('[MissingMats] Auto-filled quantity:', activeMissingQuantity);
}

export default {
    initialize,
    cleanup,
};
