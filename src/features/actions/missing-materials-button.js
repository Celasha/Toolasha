/**
 * Missing Materials Marketplace Button
 * Adds button to production and enhancement panels that opens marketplace with tabs for missing materials
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import { findActionInput, attachInputListeners, performInitialUpdate } from '../../utils/action-panel-helper.js';
import {
    calculateMaterialRequirements,
    calculateEnhancementMaterialRequirements,
} from '../../utils/material-calculator.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createAutofillManager } from '../../utils/marketplace-autofill.js';
import {
    createMaterialTab,
    removeMaterialTabs,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
} from '../../utils/marketplace-tabs.js';
import { getProtectionItemFromUI, getProtectFromLevelFromUI } from './enhancement-display.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

/**
 * Module-level state
 */
let cleanupObserver = null;
const currentMaterialsTabs = [];
let domObserverUnregister = null;
let enhancementDomObserverUnregister = null;
let processedPanels = new WeakSet();
let processedEnhancingPanels = new WeakSet();
let inventoryUpdateHandler = null;
let storedActionHrid = null;
let storedNumActions = 0;
let storedEnhancementContext = null;
const timerRegistry = createTimerRegistry();
const autofillManager = createAutofillManager('MissingMats-Actions');

/**
 * Enhancement panel debounce timeout
 */
let enhancementDebounceTimeout = null;

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
 * Initialize missing materials button feature
 */
export function initialize() {
    cleanupObserver = setupMarketplaceCleanupObserver(handleMarketplaceCleanup, currentMaterialsTabs);
    autofillManager.initialize();

    // Watch for production action panels appearing
    domObserverUnregister = domObserver.onClass(
        'MissingMaterialsButton-ActionPanel',
        'SkillActionDetail_skillActionDetail',
        () => processActionPanels()
    );

    // Watch for enhancement panels appearing
    enhancementDomObserverUnregister = domObserver.onClass(
        'MissingMaterialsButton-EnhancingPanel',
        'SkillActionDetail_enhancingComponent__17bOx',
        (panel) => processEnhancingPanel(panel)
    );

    // Process existing panels
    processActionPanels();
    processExistingEnhancingPanels();
}

/**
 * Cleanup function
 */
export function cleanup() {
    if (domObserverUnregister) {
        domObserverUnregister();
        domObserverUnregister = null;
    }

    if (enhancementDomObserverUnregister) {
        enhancementDomObserverUnregister();
        enhancementDomObserverUnregister = null;
    }

    // Disconnect marketplace cleanup observer
    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }

    autofillManager.cleanup();

    // Remove any existing custom tabs
    handleMarketplaceCleanup();

    // Clear processed panels
    processedPanels = new WeakSet();
    processedEnhancingPanels = new WeakSet();

    // Clear enhancement debounce
    if (enhancementDebounceTimeout) {
        clearTimeout(enhancementDebounceTimeout);
        enhancementDebounceTimeout = null;
    }

    timerRegistry.clearAll();
}

/**
 * Process action panels - watch for input changes
 */
function processActionPanels() {
    const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');

    panels.forEach((panel) => {
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

    // Check setting early
    if (!config.getSetting('actions_missingMaterialsButton')) {
        return;
    }

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

    // Determine disabled state: no quantity entered (∞ parses to 0)
    let missingMaterials = [];
    let disabled = false;

    if (numActions <= 0) {
        disabled = true;
    } else {
        // Get missing materials using shared utility
        // Check if user wants to ignore queue (default: false, meaning we DO account for queue)
        const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
        const accountForQueue = !ignoreQueue; // Invert: ignoreQueue=false means accountForQueue=true
        missingMaterials = calculateMaterialRequirements(actionHrid, numActions, accountForQueue);
        if (missingMaterials.length === 0) {
            disabled = true;
        }
    }

    // Create and insert button with actionHrid and numActions for live updates
    const button = createMissingMaterialsButton(missingMaterials, actionHrid, numActions, disabled);

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

    // Read only direct text nodes to avoid picking up injected child spans
    // (e.g. inventory count display appends "(20 in inventory)" as a child span)
    const actionName = Array.from(actionNameElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join('')
        .trim();
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
 * Process existing enhancing panels on the page
 */
function processExistingEnhancingPanels() {
    const panels = document.querySelectorAll('[class*="SkillActionDetail_enhancingComponent"]');
    panels.forEach((panel) => processEnhancingPanel(panel));
}

/**
 * Process an enhancing panel - set up mutation watcher and create button
 * @param {HTMLElement} panel - Enhancing panel element
 */
function processEnhancingPanel(panel) {
    if (!panel || processedEnhancingPanels.has(panel)) {
        return;
    }

    processedEnhancingPanels.add(panel);

    // Watch for changes (item swap, level change, protection change) with debounce
    createMutationWatcher(
        panel,
        () => {
            if (enhancementDebounceTimeout) {
                clearTimeout(enhancementDebounceTimeout);
            }
            enhancementDebounceTimeout = setTimeout(() => {
                enhancementDebounceTimeout = null;
                updateEnhancementButton(panel);
            }, 500);
        },
        { childList: true, subtree: true, attributes: true }
    );

    // Initial button creation (delay to let panel-observer set mwiItemHrid first)
    setTimeout(() => updateEnhancementButton(panel), 600);
}

/**
 * Get current enhancement level from action queue or DOM
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {number} Current enhancement level (0-19)
 */
function getCurrentEnhancementLevel(panel) {
    // Try action queue first
    const currentActions = dataManager.getCurrentActions();
    const enhancingAction = currentActions.find((a) => a.actionHrid === '/actions/enhancing/enhance');
    if (enhancingAction?.primaryItemHash) {
        const parts = enhancingAction.primaryItemHash.split('::');
        const lastPart = parts[parts.length - 1];
        if (lastPart && !lastPart.startsWith('/')) {
            const parsed = parseInt(lastPart, 10);
            if (!isNaN(parsed)) return parsed;
        }
    }

    // Fallback: read from DOM text (e.g., "Dairyhand's Top +5")
    const inputItems = panel.querySelectorAll('.SkillActionDetail_item__2vEAz .Item_name__2C42x');
    if (inputItems.length > 0) {
        const inputName = inputItems[0].textContent.trim();
        const levelMatch = inputName.match(/\+(\d+)$/);
        if (levelMatch) return parseInt(levelMatch[1], 10);
    }

    return 0;
}

/**
 * Get target enhancement level from UI input
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {number|null} Target level (1-20) or null if not found
 */
function getTargetLevelFromUI(panel) {
    const labels = Array.from(panel.querySelectorAll('*')).filter(
        (el) => el.textContent.trim() === 'Target Level' && el.children.length === 0
    );

    if (labels.length > 0) {
        const parent = labels[0].parentElement;
        const input = parent.querySelector('input[type="number"], input[type="text"]');
        if (input && input.value) {
            const value = parseInt(input.value, 10);
            if (!isNaN(value)) return Math.max(1, Math.min(20, value));
        }
    }

    return null;
}

/**
 * Update the missing materials button on an enhancement panel
 * @param {HTMLElement} panel - Enhancing panel element
 */
function updateEnhancementButton(panel) {
    // Remove existing button
    const existingButton = panel.querySelector('#mwi-missing-mats-button');
    if (existingButton) {
        existingButton.remove();
    }

    if (!config.getSetting('actions_missingMaterialsButton')) {
        return;
    }

    // Get item HRID (set by panel-observer.js)
    const itemHrid = panel.dataset.mwiItemHrid;
    if (!itemHrid) {
        return;
    }

    // Get current and target levels
    const startLevel = getCurrentEnhancementLevel(panel);
    const targetLevel = getTargetLevelFromUI(panel);
    if (targetLevel === null || targetLevel <= startLevel) {
        return;
    }

    // Get protection settings from UI
    const protectionItemHrid = getProtectionItemFromUI(panel);
    const protectFromLevel = getProtectFromLevelFromUI(panel);

    // Calculate missing materials
    const missingMaterials = calculateEnhancementMaterialRequirements(
        itemHrid,
        startLevel,
        targetLevel,
        protectionItemHrid,
        protectFromLevel
    );

    const disabled = missingMaterials.length === 0;

    // Create button
    const button = createEnhancementMissingMaterialsButton(
        missingMaterials,
        itemHrid,
        startLevel,
        targetLevel,
        protectionItemHrid,
        protectFromLevel,
        disabled
    );

    // Find insertion point
    const itemRequirements = panel.querySelector('.SkillActionDetail_itemRequirements__3SPnA');
    if (itemRequirements) {
        itemRequirements.parentNode.insertBefore(button, itemRequirements.nextSibling);
    } else {
        const enhancementStats = panel.querySelector('#mwi-enhancement-stats');
        if (enhancementStats) {
            enhancementStats.parentNode.insertBefore(button, enhancementStats);
        } else {
            panel.appendChild(button);
        }
    }
}

/**
 * Create missing materials button for enhancement panels
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {string} itemHrid - Item being enhanced
 * @param {number} startLevel - Current enhancement level
 * @param {number} targetLevel - Target enhancement level
 * @param {string|null} protectionItemHrid - Protection item HRID
 * @param {number} protectFromLevel - Protect from level
 * @param {boolean} disabled - Whether button should be disabled
 * @returns {HTMLElement} Button element
 */
function createEnhancementMissingMaterialsButton(
    missingMaterials,
    itemHrid,
    startLevel,
    targetLevel,
    protectionItemHrid,
    protectFromLevel,
    disabled
) {
    const button = document.createElement('button');
    button.id = 'mwi-missing-mats-button';
    button.textContent = 'Missing Mats Marketplace';
    button.disabled = disabled;
    button.style.cssText = `
        width: 100%;
        padding: 10px 16px;
        margin: 8px 0 16px 0;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 8px;
        cursor: ${disabled ? 'default' : 'pointer'};
        font-size: 14px;
        font-weight: 600;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        opacity: ${disabled ? '0.45' : '1'};
    `;

    if (!disabled) {
        button.addEventListener('mouseenter', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
            button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
            button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        button.addEventListener('click', async () => {
            await handleEnhancementMissingMaterialsClick(
                itemHrid,
                startLevel,
                targetLevel,
                protectionItemHrid,
                protectFromLevel
            );
        });
    }

    return button;
}

/**
 * Handle enhancement missing materials button click
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {string} itemHrid - Item being enhanced
 * @param {number} startLevel - Current enhancement level
 * @param {number} targetLevel - Target enhancement level
 * @param {string|null} protectionItemHrid - Protection item HRID
 * @param {number} protectFromLevel - Protect from level
 */
async function handleEnhancementMissingMaterialsClick(
    itemHrid,
    startLevel,
    targetLevel,
    protectionItemHrid,
    protectFromLevel
) {
    // Store context for live updates
    storedEnhancementContext = { itemHrid, startLevel, targetLevel, protectionItemHrid, protectFromLevel };
    storedActionHrid = null;
    storedNumActions = 0;

    // Navigate to marketplace
    const success = await openMarketplacePage();
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        return;
    }

    // Wait a moment for marketplace to settle
    await new Promise((resolve) => {
        const delayTimeout = setTimeout(resolve, 200);
        timerRegistry.registerTimeout(delayTimeout);
    });

    // Recalculate materials fresh (inventory may have changed since button was rendered)
    const freshMaterials = calculateEnhancementMaterialRequirements(
        itemHrid,
        startLevel,
        targetLevel,
        protectionItemHrid,
        protectFromLevel
    );

    // Create custom tabs
    createMissingMaterialTabs(freshMaterials);

    // Setup inventory listener for live updates
    setupInventoryListener();
}

/**
 * Create missing materials marketplace button
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {string} actionHrid - Action HRID for recalculating materials
 * @param {number} numActions - Number of actions for recalculating materials
 * @param {boolean} disabled - Whether the button should be rendered in a disabled state
 * @returns {HTMLElement} Button element
 */
function createMissingMaterialsButton(missingMaterials, actionHrid, numActions, disabled = false) {
    const button = document.createElement('button');
    button.id = 'mwi-missing-mats-button';
    button.textContent = 'Missing Mats Marketplace';
    button.disabled = disabled;
    button.title = disabled && numActions <= 0 ? 'Enter a quantity to check missing materials' : '';
    button.style.cssText = `
        width: 100%;
        padding: 10px 16px;
        margin: 8px 0 16px 0;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 8px;
        cursor: ${disabled ? 'default' : 'pointer'};
        font-size: 14px;
        font-weight: 600;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        opacity: ${disabled ? '0.45' : '1'};
    `;

    if (!disabled) {
        // Hover effect
        button.addEventListener('mouseenter', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
            button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
            button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        // Click handler
        button.addEventListener('click', async () => {
            await handleMissingMaterialsClick(actionHrid, numActions);
        });
    }

    return button;
}

/**
 * Handle missing materials button click
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {string} actionHrid - Action HRID for recalculating materials
 * @param {number} numActions - Number of actions for recalculating materials
 */
async function handleMissingMaterialsClick(actionHrid, numActions) {
    // Store context for live updates
    storedActionHrid = actionHrid;
    storedNumActions = numActions;
    storedEnhancementContext = null;

    // Navigate to marketplace
    const success = await openMarketplacePage();
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        return;
    }

    // Wait a moment for marketplace to settle
    await new Promise((resolve) => {
        const delayTimeout = setTimeout(resolve, 200);
        timerRegistry.registerTimeout(delayTimeout);
    });

    // Recalculate materials fresh (inventory may have changed since button was rendered)
    const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
    const accountForQueue = !ignoreQueue;
    const freshMaterials = calculateMaterialRequirements(actionHrid, numActions, accountForQueue);

    // Create custom tabs
    createMissingMaterialTabs(freshMaterials);

    // Setup inventory listener for live updates
    setupInventoryListener();
}

/**
 * Navigate to marketplace by simulating click on navbar
 * @returns {Promise<boolean>} True if successful
 */
async function openMarketplacePage() {
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

        await new Promise((resolve) => {
            const delayTimeout = setTimeout(resolve, delayMs);
            timerRegistry.registerTimeout(delayTimeout);
        });
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

    // Remove any existing custom tabs first (preserve stored context — we're recreating, not leaving)
    removeMaterialTabs();
    currentMaterialsTabs.length = 0;

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

    // Use event delegation on tabs container to clear quantity when regular tabs are clicked
    // This avoids memory leaks from adding listeners to each tab repeatedly
    if (!tabsContainer.hasAttribute('data-mwi-delegated-listener')) {
        tabsContainer.setAttribute('data-mwi-delegated-listener', 'true');
        tabsContainer.addEventListener('click', (e) => {
            // Check if clicked element is a regular tab (not our custom tab)
            const clickedTab = e.target.closest('button');
            if (clickedTab && !clickedTab.hasAttribute('data-mwi-custom-tab')) {
                autofillManager.clearQuantity();
            }
        });
    }

    // Create tab for each missing material
    currentMaterialsTabs.length = 0; // Clear without reassigning (preserves observer reference)
    for (const material of missingMaterials) {
        const tab = createMaterialTab(material, referenceTab, (_e, mat) => {
            // Store a lazy recalculation function — called each time a buy modal opens,
            // so the quantity always reflects current inventory state at that moment.
            autofillManager.setPendingCalculation(() => {
                if (storedEnhancementContext) {
                    const ctx = storedEnhancementContext;
                    const mats = calculateEnhancementMaterialRequirements(
                        ctx.itemHrid,
                        ctx.startLevel,
                        ctx.targetLevel,
                        ctx.protectionItemHrid,
                        ctx.protectFromLevel
                    );
                    return mats.find((m) => m.itemHrid === mat.itemHrid)?.missing ?? 0;
                } else if (storedActionHrid && storedNumActions > 0) {
                    const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
                    const mats = calculateMaterialRequirements(storedActionHrid, storedNumActions, !ignoreQueue);
                    return mats.find((m) => m.itemHrid === mat.itemHrid)?.missing ?? 0;
                }
                return parseInt(tab.getAttribute('data-missing-quantity') || '0', 10);
            });
            navigateToMarketplace(mat.itemHrid, 0);
        });
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
    // Check if tabs still exist
    if (currentMaterialsTabs.length === 0) {
        return;
    }

    let updatedMaterials;

    if (storedEnhancementContext) {
        // Enhancement mode
        const ctx = storedEnhancementContext;
        updatedMaterials = calculateEnhancementMaterialRequirements(
            ctx.itemHrid,
            ctx.startLevel,
            ctx.targetLevel,
            ctx.protectionItemHrid,
            ctx.protectFromLevel
        );
    } else if (storedActionHrid && storedNumActions > 0) {
        // Production mode
        const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
        const accountForQueue = !ignoreQueue;
        updatedMaterials = calculateMaterialRequirements(storedActionHrid, storedNumActions, accountForQueue);
    } else {
        return;
    }

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
        // Show queued amount if any materials are reserved by queue
        const queuedText = material.queued > 0 ? ` (${formatWithSeparator(material.queued)} Q'd)` : '';
        statusText = `Missing: ${formatWithSeparator(material.missing)}${queuedText}`;
    } else {
        statusColor = '#4ade80'; // Green - sufficient materials
        statusText = `Sufficient (${formatWithSeparator(material.required)})`;
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

    // Keep data-missing-quantity in sync so the click handler autofills the current amount
    tab.setAttribute('data-missing-quantity', material.missing.toString());

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
 * Handle marketplace cleanup (when leaving marketplace)
 * Called by the marketplace cleanup observer
 */
function handleMarketplaceCleanup() {
    removeMaterialTabs();
    currentMaterialsTabs.length = 0; // Clear without reassigning (preserves observer reference)

    // Clean up inventory listener
    if (inventoryUpdateHandler) {
        webSocketHook.off('*', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }

    // Clear stored context — only when genuinely leaving the marketplace
    storedActionHrid = null;
    storedNumActions = 0;
    storedEnhancementContext = null;
    autofillManager.clearQuantity();
}

export default {
    initialize,
    cleanup,
};
