/**
 * Action Panel Observer
 *
 * Detects when action panels appear and enhances them with:
 * - Gathering profit calculations (Foraging, Woodcutting, Milking)
 * - Other action panel enhancements (future)
 *
 * Automatically filters out combat action panels.
 */

import dataManager from '../../core/data-manager.js';
import { calculateGatheringProfit, formatProfitDisplay } from './gathering-profit.js';
import { displayEnhancementStats } from './enhancement-display.js';

/**
 * Action types for gathering skills (3 skills)
 */
const GATHERING_TYPES = [
    '/action_types/foraging',
    '/action_types/woodcutting',
    '/action_types/milking'
];

/**
 * Action type for enhancing
 */
const ENHANCING_TYPE = '/action_types/enhancing';

/**
 * Debounced update tracker for enhancement calculations
 * Maps itemHrid to timeout ID
 */
const updateTimeouts = new Map();

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
        console.log('[MWI Tools] Input changed, re-calculating enhancement stats...');
        await displayEnhancementStats(panel, itemHrid);
        updateTimeouts.delete(itemHrid);
    }, 500); // Wait 500ms after last change

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
    ITEM_NAME: 'div.Item_name__2C42x' // Item name (without +1)
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
    const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
            // Handle attribute changes (value updates from clicking up/down arrows)
            if (mutation.type === 'attributes') {
                // Handle value attribute changes on INPUT elements (clicking up/down arrows)
                if (mutation.attributeName === 'value' && mutation.target.tagName === 'INPUT') {
                    const input = mutation.target;
                    const panel = input.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid) {
                            // Trigger the same debounced update
                            triggerEnhancementUpdate(panel, itemHrid);
                        }
                    }
                }
            }

            for (const addedNode of mutation.addedNodes) {
                if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

                // Check for modal container with regular action panel (gathering/crafting)
                if (
                    addedNode.classList?.contains('Modal_modalContainer__3B80m') &&
                    addedNode.querySelector(SELECTORS.REGULAR_PANEL)
                ) {
                    const panel = addedNode.querySelector(SELECTORS.REGULAR_PANEL);
                    await handleActionPanel(panel);
                }

                // Check for enhancing panel (non-modal, on main page)
                if (
                    addedNode.classList?.contains('SkillActionDetail_enhancingComponent__17bOx') ||
                    addedNode.querySelector(SELECTORS.ENHANCING_PANEL)
                ) {
                    const panel = addedNode.classList?.contains('SkillActionDetail_enhancingComponent__17bOx')
                        ? addedNode
                        : addedNode.querySelector(SELECTORS.ENHANCING_PANEL);
                    await handleEnhancingPanel(panel);
                }

                // Check if this is an outputs section being added to an existing enhancing panel
                if (
                    addedNode.classList?.contains('SkillActionDetail_enhancingOutput__VPHbY') ||
                    (addedNode.querySelector && addedNode.querySelector(SELECTORS.ENHANCING_OUTPUT))
                ) {
                    // Find the parent enhancing panel
                    let panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        await handleEnhancingPanel(panel);
                    }
                }

                // Also check for item div being added (in case outputs container already exists)
                if (
                    addedNode.classList?.contains('SkillActionDetail_item__2vEAz') ||
                    addedNode.classList?.contains('Item_name__2C42x')
                ) {
                    // Find the parent enhancing panel
                    let panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        await handleEnhancingPanel(panel);
                    }
                }

                // Check for new input elements being added (e.g., Protect From Level after dropping protection item)
                if (addedNode.tagName === 'INPUT' && (addedNode.type === 'number' || addedNode.type === 'text')) {
                    const panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        // Get the item HRID from the panel's data
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid) {
                            addInputListener(addedNode, panel, itemHrid);
                        }
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,  // Watch entire tree, not just direct children
        attributes: true,  // Watch for attribute changes
        attributeOldValue: true,  // Track old values
        attributeFilter: ['value', 'class']  // Only watch value and class attributes
    });

    console.log('[MWI Tools] Action panel observer initialized (watching childList + attributes)');
}

/**
 * Set up listeners for equipment and consumable changes
 * Refreshes enhancement calculator when gear or teas change
 */
function setupEnhancementRefreshListeners() {
    // Listen for equipment changes (equipping/unequipping items)
    dataManager.on('items_updated', () => {
        refreshEnhancementCalculator();
    });

    // Listen for consumable changes (drinking teas)
    dataManager.on('consumables_updated', () => {
        refreshEnhancementCalculator();
    });
}

/**
 * Refresh enhancement calculator if panel is currently visible
 */
function refreshEnhancementCalculator() {
    const panel = document.querySelector(SELECTORS.ENHANCING_PANEL);
    if (!panel) return;  // Not on enhancing panel, skip

    const itemHrid = panel.dataset.mwiItemHrid;
    if (!itemHrid) return;  // No item detected yet, skip

    // Trigger debounced update
    triggerEnhancementUpdate(panel, itemHrid);
}

/**
 * Check for existing enhancing panel on page load
 * The enhancing panel may already exist when MWI Tools initializes
 */
function checkExistingEnhancingPanel() {
    // Wait a moment for page to settle
    setTimeout(() => {
        const existingPanel = document.querySelector(SELECTORS.ENHANCING_PANEL);
        if (existingPanel) {
            handleEnhancingPanel(existingPanel);
        }
    }, 500);
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

    // Get action details
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];
    if (!actionDetail) return;

    // Check if this is a gathering action
    if (GATHERING_TYPES.includes(actionDetail.type)) {
        const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
        if (dropTableElement) {
            await displayGatheringProfit(panel, actionHrid);
        }
    }
}

/**
 * Handle enhancing panel appearance
 * @param {HTMLElement} panel - Enhancing panel element
 */
async function handleEnhancingPanel(panel) {
    if (!panel) return;

    // Find the output element that shows the enhanced item
    const outputsSection = panel.querySelector(SELECTORS.ENHANCING_OUTPUT);
    if (!outputsSection) {
        console.log('[MWI Tools] Enhancement panel found but no outputs section');
        return;
    }

    // Get the item name from the Item_name element (without +1)
    const itemNameElement = outputsSection.querySelector(SELECTORS.ITEM_NAME);
    if (!itemNameElement) {
        console.log('[MWI Tools] Could not find item name element in outputs');
        return;
    }

    const itemName = itemNameElement.textContent.trim();

    if (!itemName) {
        console.log('[MWI Tools] Could not extract item name from outputs');
        return;
    }

    // Find the item HRID from the name
    const gameData = dataManager.getInitClientData();
    const itemHrid = getItemHridFromName(itemName, gameData);

    if (!itemHrid) {
        console.log(`[MWI Tools] Could not find item HRID for: ${itemName}`);
        return;
    }

    // Get item details
    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails) return;

    console.log(`[MWI Tools] Detected enhancing: ${itemName} (${itemHrid})`);

    // Store itemHrid on panel for later reference (when new inputs are added)
    panel.dataset.mwiItemHrid = itemHrid;

    // Display enhancement stats using the item HRID directly
    await displayEnhancementStats(panel, itemHrid);

    // Set up observers for Target Level and Protect From Level inputs
    setupInputObservers(panel, itemHrid);
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
    inputs.forEach(input => {
        addInputListener(input, panel, itemHrid);
    });
}

/**
 * Display gathering profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 */
async function displayGatheringProfit(panel, actionHrid) {
    // Calculate profit
    const profitData = await calculateGatheringProfit(actionHrid);
    if (!profitData) {
        console.error('❌ Gathering profit calculation failed for:', actionHrid);
        return;
    }

    // Format and inject HTML
    const profitHTML = formatProfitDisplay(profitData);
    if (!profitHTML) {
        console.error('❌ Profit display generation failed');
        return;
    }

    // Find insertion point (after drop table)
    const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
    if (!dropTableElement) return;

    // Check if we already added profit display
    const existingProfit = panel.querySelector('#mwi-foraging-profit');
    if (existingProfit) {
        existingProfit.remove();
    }

    // Create profit display container
    const profitContainer = document.createElement('div');
    profitContainer.id = 'mwi-foraging-profit';
    profitContainer.innerHTML = profitHTML;

    // Insert after drop table
    dropTableElement.parentNode.insertBefore(
        profitContainer,
        dropTableElement.nextSibling
    );
}

/**
 * Get original text from element (strips injected content)
 * @param {HTMLElement} element - Element to extract text from
 * @returns {string} Original text content
 */
function getOriginalText(element) {
    // Clone element to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove any injected elements
    const injected = clone.querySelectorAll('[id^="mwi-"]');
    injected.forEach(el => el.remove());

    return clone.textContent.trim();
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
