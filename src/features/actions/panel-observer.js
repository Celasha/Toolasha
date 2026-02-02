/**
 * Action Panel Observer
 *
 * Detects when action panels appear and enhances them with:
 * - Gathering profit calculations (Foraging, Woodcutting, Milking)
 * - Production profit calculations (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
 * - Other action panel enhancements (future)
 *
 * Automatically filters out combat action panels.
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { displayEnhancementStats } from './enhancement-display.js';
import { displayGatheringProfit, displayProductionProfit } from './profit-display.js';
import { getOriginalText } from '../../utils/dom.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * Action types for gathering skills (3 skills)
 */
const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

/**
 * Action types for production skills (5 skills)
 */
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

/**
 * Action type for enhancing
 */
const _ENHANCING_TYPE = '/action_types/enhancing';

/**
 * Debounced update tracker for enhancement calculations
 * Maps itemHrid to timeout ID
 */
const updateTimeouts = new Map();
const timerRegistry = createTimerRegistry();

/**
 * Event handler debounce timers
 */
let itemsUpdatedDebounceTimer = null;
let consumablesUpdatedDebounceTimer = null;
const DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers

/**
 * Module-level observer cleanup references
 */
let unregisterHandlers = [];
const observedEnhancingPanels = new WeakSet();
let enhancingPanelWatchers = [];
let itemsUpdatedHandler = null;
let consumablesUpdatedHandler = null;

/**
 * Trigger debounced enhancement stats update
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {string} itemHrid - Item HRID
 */
function triggerEnhancementUpdate(panel, itemHrid) {
    // Clear existing timeout for this item
    if (updateTimeouts.has(itemHrid)) {
        clearTimeout(updateTimeouts.get(itemHrid));
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
        await displayEnhancementStats(panel, itemHrid);
        updateTimeouts.delete(itemHrid);
    }, 500); // Wait 500ms after last change

    timerRegistry.registerTimeout(timeoutId);

    updateTimeouts.set(itemHrid, timeoutId);
}

/**
 * CSS selectors for action panel detection
 */
const SELECTORS = {
    MODAL_CONTAINER: '.Modal_modalContainer__3B80m',
    REGULAR_PANEL: 'div.SkillActionDetail_regularComponent__3oCgr',
    ENHANCING_PANEL: 'div.SkillActionDetail_enhancingComponent__17bOx',
    EXP_GAIN: 'div.SkillActionDetail_expGain__F5xHu',
    ACTION_NAME: 'div.SkillActionDetail_name__3erHV',
    DROP_TABLE: 'div.SkillActionDetail_dropTable__3ViVp',
    ENHANCING_OUTPUT: 'div.SkillActionDetail_enhancingOutput__VPHbY', // Outputs container
    ITEM_NAME: 'div.Item_name__2C42x', // Item name (without +1)
};

/**
 * Initialize action panel observer
 * Sets up MutationObserver on document.body to watch for action panels
 */
export function initActionPanelObserver() {
    setupMutationObserver();

    // Check for existing enhancing panel (may already be on page)
    checkExistingEnhancingPanel();

    // Listen for equipment and consumable changes to refresh enhancement calculator
    setupEnhancementRefreshListeners();
}

/**
 * Set up MutationObserver to detect action panels
 */
function setupMutationObserver() {
    const unregisterModalObserver = domObserver.onClass(
        'ActionPanelObserver-Modal',
        'Modal_modalContainer__3B80m',
        (modal) => {
            const panel = modal.querySelector(SELECTORS.REGULAR_PANEL);
            if (panel) {
                handleActionPanel(panel);
            }
        }
    );

    const unregisterEnhancingObserver = domObserver.onClass(
        'ActionPanelObserver-Enhancing',
        'SkillActionDetail_enhancingComponent__17bOx',
        (panel) => {
            handleEnhancingPanel(panel);
            registerEnhancingPanelWatcher(panel);
        }
    );

    unregisterHandlers = [unregisterModalObserver, unregisterEnhancingObserver];
}

/**
 * Set up listeners for equipment and consumable changes
 * Refreshes enhancement calculator when gear or teas change
 */
function setupEnhancementRefreshListeners() {
    // Listen for equipment changes (equipping/unequipping items) with debouncing
    if (!itemsUpdatedHandler) {
        itemsUpdatedHandler = () => {
            clearTimeout(itemsUpdatedDebounceTimer);
            itemsUpdatedDebounceTimer = setTimeout(() => {
                refreshEnhancementCalculator();
            }, DEBOUNCE_DELAY);
        };
        dataManager.on('items_updated', itemsUpdatedHandler);
    }

    // Listen for consumable changes (drinking teas) with debouncing
    if (!consumablesUpdatedHandler) {
        consumablesUpdatedHandler = () => {
            clearTimeout(consumablesUpdatedDebounceTimer);
            consumablesUpdatedDebounceTimer = setTimeout(() => {
                refreshEnhancementCalculator();
            }, DEBOUNCE_DELAY);
        };
        dataManager.on('consumables_updated', consumablesUpdatedHandler);
    }
}

/**
 * Refresh enhancement calculator if panel is currently visible
 */
function refreshEnhancementCalculator() {
    const panel = document.querySelector(SELECTORS.ENHANCING_PANEL);
    if (!panel) return; // Not on enhancing panel, skip

    const itemHrid = panel.dataset.mwiItemHrid;
    if (!itemHrid) return; // No item detected yet, skip

    // Trigger debounced update
    triggerEnhancementUpdate(panel, itemHrid);
}

/**
 * Check for existing enhancing panel on page load
 * The enhancing panel may already exist when MWI Tools initializes
 */
function checkExistingEnhancingPanel() {
    // Wait a moment for page to settle
    const checkTimeout = setTimeout(() => {
        const existingPanel = document.querySelector(SELECTORS.ENHANCING_PANEL);
        if (existingPanel) {
            handleEnhancingPanel(existingPanel);
            registerEnhancingPanelWatcher(existingPanel);
        }
    }, 500);
    timerRegistry.registerTimeout(checkTimeout);
}

/**
 * Register a mutation watcher for enhancing panels
 * @param {HTMLElement} panel - Enhancing panel element
 */
function registerEnhancingPanelWatcher(panel) {
    if (!panel || observedEnhancingPanels.has(panel)) {
        return;
    }

    const unwatch = createMutationWatcher(
        panel,
        (mutations) => {
            handleEnhancingPanelMutations(panel, mutations);
        },
        {
            childList: true,
            subtree: true,
            attributes: true,
            attributeOldValue: true,
        }
    );

    observedEnhancingPanels.add(panel);
    enhancingPanelWatchers.push(unwatch);
}

/**
 * Handle mutations within an enhancing panel
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {MutationRecord[]} mutations - Mutation records
 */
function handleEnhancingPanelMutations(panel, mutations) {
    for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
            if (mutation.attributeName === 'value' && mutation.target.tagName === 'INPUT') {
                const itemHrid = panel.dataset.mwiItemHrid;
                if (itemHrid) {
                    triggerEnhancementUpdate(panel, itemHrid);
                }
            }

            if (mutation.attributeName === 'href' && mutation.target.tagName === 'use') {
                handleEnhancingPanel(panel);
            }
        }

        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((addedNode) => {
                if (addedNode.nodeType !== Node.ELEMENT_NODE) return;

                if (
                    addedNode.classList?.contains('SkillActionDetail_enhancingOutput__VPHbY') ||
                    (addedNode.querySelector && addedNode.querySelector(SELECTORS.ENHANCING_OUTPUT))
                ) {
                    handleEnhancingPanel(panel);
                }

                if (
                    addedNode.classList?.contains('SkillActionDetail_item__2vEAz') ||
                    addedNode.classList?.contains('Item_name__2C42x')
                ) {
                    handleEnhancingPanel(panel);
                }

                if (addedNode.tagName === 'INPUT' && (addedNode.type === 'number' || addedNode.type === 'text')) {
                    const itemHrid = panel.dataset.mwiItemHrid;
                    if (itemHrid) {
                        addInputListener(addedNode, panel, itemHrid);
                    }
                }
            });
        }
    }
}

/**
 * Handle action panel appearance (gathering/crafting/production)
 * @param {HTMLElement} panel - Action panel element
 */
async function handleActionPanel(panel) {
    if (!panel) return;

    // Filter out combat action panels (they don't have XP gain display)
    const expGainElement = panel.querySelector(SELECTORS.EXP_GAIN);
    if (!expGainElement) return; // Combat panel, skip

    // Get action name
    const actionNameElement = panel.querySelector(SELECTORS.ACTION_NAME);
    if (!actionNameElement) return;

    const actionName = getOriginalText(actionNameElement);
    const actionHrid = getActionHridFromName(actionName);
    if (!actionHrid) return;

    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];
    if (!actionDetail) return;

    // Check if this is a gathering action
    if (GATHERING_TYPES.includes(actionDetail.type)) {
        const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
        if (dropTableElement) {
            await displayGatheringProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
        }
    }

    // Check if this is a production action
    if (PRODUCTION_TYPES.includes(actionDetail.type)) {
        const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
        if (dropTableElement) {
            await displayProductionProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
        }
    }
}

/**
 * Find and cache the Current Action tab button
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {HTMLButtonElement|null} Current Action tab button or null
 */
function getCurrentActionTabButton(panel) {
    // Check if we already cached it
    if (panel._cachedCurrentActionTab) {
        return panel._cachedCurrentActionTab;
    }

    // Walk up the DOM to find tab buttons (only once)
    let current = panel;
    let depth = 0;
    const maxDepth = 5;

    while (current && depth < maxDepth) {
        const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
        const currentActionTab = buttons.find((btn) => btn.textContent.trim() === 'Current Action');

        if (currentActionTab) {
            // Cache it on the panel for future lookups
            panel._cachedCurrentActionTab = currentActionTab;
            return currentActionTab;
        }

        current = current.parentElement;
        depth++;
    }

    return null;
}

/**
 * Check if we're on the "Enhance" tab (not "Current Action" tab)
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {boolean} True if on Enhance tab
 */
function isEnhanceTabActive(panel) {
    // Get cached tab button (DOM query happens only once per panel)
    const currentActionTab = getCurrentActionTabButton(panel);

    if (!currentActionTab) {
        // No Current Action tab found, show calculator
        return true;
    }

    // Fast checks: just 3 property accesses (no DOM queries)
    if (currentActionTab.getAttribute('aria-selected') === 'true') {
        return false; // Current Action is active
    }

    if (currentActionTab.classList.contains('Mui-selected')) {
        return false;
    }

    if (currentActionTab.getAttribute('tabindex') === '0') {
        return false;
    }

    // Enhance tab is active
    return true;
}

/**
 * Handle enhancing panel appearance
 * @param {HTMLElement} panel - Enhancing panel element
 */
async function handleEnhancingPanel(panel) {
    if (!panel) return;

    // Set up tab click listeners (only once per panel)
    if (!panel.dataset.mwiTabListenersAdded) {
        setupTabClickListeners(panel);
        panel.dataset.mwiTabListenersAdded = 'true';
    }

    // Only show calculator on "Enhance" tab, not "Current Action" tab
    if (!isEnhanceTabActive(panel)) {
        // Remove calculator if it exists
        const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
        if (existingDisplay) {
            existingDisplay.remove();
        }
        return;
    }

    // Find the output element that shows the enhanced item
    const outputsSection = panel.querySelector(SELECTORS.ENHANCING_OUTPUT);
    if (!outputsSection) {
        return;
    }

    // Check if there's actually an item selected (not just placeholder)
    // When no item is selected, the outputs section exists but has no item icon
    const itemIcon = outputsSection.querySelector('svg[role="img"], img');
    if (!itemIcon) {
        // No item icon = no item selected, don't show calculator
        // Remove existing calculator display if present
        const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
        if (existingDisplay) {
            existingDisplay.remove();
        }
        return;
    }

    // Get the item name from the Item_name element (without +1)
    const itemNameElement = outputsSection.querySelector(SELECTORS.ITEM_NAME);
    if (!itemNameElement) {
        return;
    }

    const itemName = itemNameElement.textContent.trim();

    if (!itemName) {
        return;
    }

    // Find the item HRID from the name
    const gameData = dataManager.getInitClientData();
    const itemHrid = getItemHridFromName(itemName, gameData);

    if (!itemHrid) {
        return;
    }

    // Get item details
    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails) return;

    // Store itemHrid on panel for later reference (when new inputs are added)
    panel.dataset.mwiItemHrid = itemHrid;

    // Double-check tab state right before rendering (safety check for race conditions)
    if (!isEnhanceTabActive(panel)) {
        // Current Action tab became active during processing, don't render
        return;
    }

    // Display enhancement stats using the item HRID directly
    await displayEnhancementStats(panel, itemHrid);

    // Set up observers for Target Level and Protect From Level inputs
    setupInputObservers(panel, itemHrid);
}

/**
 * Set up click listeners on tab buttons to show/hide calculator
 * @param {HTMLElement} panel - Enhancing panel element
 */
function setupTabClickListeners(panel) {
    // Walk up the DOM to find tab buttons
    let current = panel;
    let depth = 0;
    const maxDepth = 5;

    let tabButtons = [];

    while (current && depth < maxDepth) {
        const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
        const foundTabs = buttons.filter((btn) => {
            const text = btn.textContent.trim();
            return text === 'Enhance' || text === 'Current Action';
        });

        if (foundTabs.length === 2) {
            tabButtons = foundTabs;
            break;
        }

        current = current.parentElement;
        depth++;
    }

    if (tabButtons.length !== 2) {
        return; // Can't find tabs, skip listener setup
    }

    // Add click listeners to both tabs
    tabButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            // Small delay to let the tab change take effect
            const tabTimeout = setTimeout(async () => {
                const isEnhanceActive = isEnhanceTabActive(panel);
                const existingDisplay = panel.querySelector('#mwi-enhancement-stats');

                if (!isEnhanceActive) {
                    // Current Action tab clicked - remove calculator
                    if (existingDisplay) {
                        existingDisplay.remove();
                    }
                } else {
                    // Enhance tab clicked - show calculator if item is selected
                    const itemHrid = panel.dataset.mwiItemHrid;
                    if (itemHrid && !existingDisplay) {
                        // Re-render calculator
                        await displayEnhancementStats(panel, itemHrid);
                    }
                }
            }, 100);
            timerRegistry.registerTimeout(tabTimeout);
        });
    });
}

/**
 * Add input listener to a single input element
 * @param {HTMLInputElement} input - Input element
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {string} itemHrid - Item HRID
 */
function addInputListener(input, panel, itemHrid) {
    // Handler that triggers the shared debounced update
    const handleInputChange = () => {
        triggerEnhancementUpdate(panel, itemHrid);
    };

    // Add change listeners
    input.addEventListener('input', handleInputChange);
    input.addEventListener('change', handleInputChange);
}

/**
 * Set up observers for Target Level and Protect From Level inputs
 * Re-calculates enhancement stats when user changes these values
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {string} itemHrid - Item HRID
 */
function setupInputObservers(panel, itemHrid) {
    // Find all input elements in the panel
    const inputs = panel.querySelectorAll('input[type="number"], input[type="text"]');

    // Add listeners to all existing inputs
    inputs.forEach((input) => {
        addInputListener(input, panel, itemHrid);
    });
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
 * Convert item name to HRID
 * @param {string} itemName - Display name of item
 * @param {Object} gameData - Game data from dataManager
 * @returns {string|null} Item HRID or null if not found
 */
function getItemHridFromName(itemName, gameData) {
    if (!gameData?.itemDetailMap) {
        return null;
    }

    // Search for item by name
    for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
        if (detail.name === itemName) {
            return hrid;
        }
    }

    return null;
}

/**
 * Cleanup function for disabling panel observer
 * Disconnects MutationObserver and clears pending timeouts
 */
export function disablePanelObserver() {
    // Unregister dom observers
    unregisterHandlers.forEach((unregister) => unregister());
    unregisterHandlers = [];

    // Clear enhancing panel watchers
    enhancingPanelWatchers.forEach((unwatch) => unwatch());
    enhancingPanelWatchers = [];

    // Clear all pending debounced updates
    for (const timeoutId of updateTimeouts.values()) {
        clearTimeout(timeoutId);
    }
    updateTimeouts.clear();

    timerRegistry.clearAll();

    // Remove dataManager event listeners
    if (itemsUpdatedHandler) {
        dataManager.off('items_updated', itemsUpdatedHandler);
        itemsUpdatedHandler = null;
    }
    if (consumablesUpdatedHandler) {
        dataManager.off('consumables_updated', consumablesUpdatedHandler);
        consumablesUpdatedHandler = null;
    }
}
