/**
 * Missing Materials Marketplace Button
 * Adds button to production and enhancement panels that opens marketplace with tabs for missing materials
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
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
    removeMaterialTabsForOwner,
    getVisibleMarketplaceTabContainer,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
} from '../../utils/marketplace-tabs.js';
import { getProtectionItemFromUI, getProtectFromLevelFromUI } from './enhancement-display.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';
import { setReactInputValue } from '../../utils/react-input.js';

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
let activeWorkflowModel = null;
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
    setupActionsCleanupObserver();
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
    teardownActionsMarketplaceSession();

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

    // Find insertion point: walk up from itemRequirements to find the direct child of panel.
    const itemRequirements = panel.querySelector('.SkillActionDetail_itemRequirements__3SPnA');
    if (itemRequirements) {
        const anchor = findPanelLevelAncestor(itemRequirements, panel);
        if (anchor) {
            anchor.after(button);
        } else {
            panel.appendChild(button);
        }
    } else {
        panel.appendChild(button);
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
        (mutations) => {
            // Ignore mutations caused by our own button insertion/removal
            const isOwnButton = mutations.every((m) => {
                const nodes = [...m.addedNodes, ...m.removedNodes];
                return nodes.length > 0 && nodes.every((n) => n.id === 'mwi-missing-mats-button');
            });
            if (isOwnButton) return;

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
/**
 * Get repeat count from enhancement panel UI
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {number} Repeat count (defaults to 1 if not found)
 */
function getRepeatCountFromUI(panel) {
    const labels = Array.from(panel.querySelectorAll('*')).filter(
        (el) => el.textContent.trim() === 'Repeat' && el.children.length === 0
    );

    if (labels.length > 0) {
        const parent = labels[0].parentElement;
        const input = parent.querySelector('input[type="number"], input[type="text"]');
        if (input) {
            if (input.value === '∞') return null;
            const value = parseInt(input.value, 10);
            if (!isNaN(value) && value > 0) return value;
        }
    }

    return 1;
}

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
    const repeatCount = getRepeatCountFromUI(panel);

    // Auto-calculate optimal protection if user hasn't set one
    let resolvedProtectFrom = protectFromLevel;
    let resolvedProtectionItem = protectionItemHrid;
    let autoProtection = false;
    if (protectFromLevel === 0) {
        const enhancingConfig = getEnhancingParams();
        const pathResult = calculateEnhancementPath(itemHrid, targetLevel, enhancingConfig);
        if (pathResult?.optimalStrategy) {
            resolvedProtectFrom = pathResult.optimalStrategy.protectFrom;
            resolvedProtectionItem = pathResult.optimalStrategy.protectionItemHrid || protectionItemHrid;
            autoProtection = true;
        }
    }

    // Calculate missing materials
    const missingMaterials = calculateEnhancementMaterialRequirements(
        itemHrid,
        startLevel,
        targetLevel,
        resolvedProtectionItem,
        resolvedProtectFrom,
        repeatCount
    );

    const disabled = missingMaterials.length === 0;

    // Create button
    const strategyInfo = autoProtection
        ? { protectFrom: resolvedProtectFrom, protectionItemHrid: resolvedProtectionItem }
        : null;
    const button = createEnhancementMissingMaterialsButton(
        missingMaterials,
        itemHrid,
        startLevel,
        targetLevel,
        resolvedProtectionItem,
        resolvedProtectFrom,
        repeatCount,
        disabled,
        strategyInfo
    );

    // Find insertion point: walk up from itemRequirements to find the direct child of panel.
    const itemRequirements = panel.querySelector('.SkillActionDetail_itemRequirements__3SPnA');
    if (itemRequirements) {
        const anchor = findPanelLevelAncestor(itemRequirements, panel);
        if (anchor) {
            anchor.after(button);
        } else {
            panel.appendChild(button);
        }
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
    repeatCount,
    disabled,
    strategyInfo
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
                protectFromLevel,
                repeatCount,
                strategyInfo
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
    protectFromLevel,
    repeatCount,
    strategyInfo
) {
    // Claim session ownership BEFORE first await
    const capturedSessionId = marketplaceSession.start({
        owner: MARKETPLACE_OWNER.ACTIONS,
        onEnd: teardownActionsMarketplaceSession,
    });

    // Re-establish cleanup observer for this session (may have been nulled by previous teardown)
    setupActionsCleanupObserver();

    // Navigate to marketplace
    const success = await openMarketplacePage();
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        teardownActionsMarketplaceSession();
        return;
    }

    // Guard: verify session still active after navigation
    if (!marketplaceSession.isActive(capturedSessionId)) {
        return;
    }

    // Wait a moment for marketplace to settle
    await new Promise((resolve) => {
        const delayTimeout = setTimeout(resolve, 200);
        timerRegistry.registerTimeout(delayTimeout);
    });

    // Guard again after the extra delay
    if (!marketplaceSession.isActive(capturedSessionId)) {
        return;
    }

    // Recalculate materials fresh (inventory may have changed since button was rendered)
    const freshMaterials = calculateEnhancementMaterialRequirements(
        itemHrid,
        startLevel,
        targetLevel,
        protectionItemHrid,
        protectFromLevel,
        repeatCount
    );

    // Set activeWorkflowModel AFTER startSession
    autofillManager.startSession({ sessionId: capturedSessionId, quantityProvider: null });
    activeWorkflowModel = {
        sessionId: capturedSessionId,
        materials: freshMaterials.map((m) => ({ ...m })),
        returnContext: {
            actionHrid: null,
            numActions: 0,
            enhancementContext: {
                itemHrid,
                startLevel,
                targetLevel,
                protectionItemHrid,
                protectFromLevel,
                repeatCount,
                strategyInfo,
            },
        },
    };

    // Create custom tabs
    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
    if (tabsContainer) {
        createMissingMaterialTabs(freshMaterials, strategyInfo, capturedSessionId);
    }

    // Activate the first tradeable missing material automatically (same as manual tab click).
    const firstMaterial = freshMaterials.find((m) => m.isTradeable !== false && m.missing > 0);
    if (firstMaterial) {
        const firstTab = currentMaterialsTabs.find(
            (t) => t.getAttribute && t.getAttribute('data-item-hrid') === firstMaterial.itemHrid
        );
        const tabRef = { tab: firstTab ?? null };
        const armed = autofillManager.arm({
            sessionId: capturedSessionId,
            itemHrid: firstMaterial.itemHrid,
            enhancementLevel: 0,
            modalMode: 'buy',
            quantityProvider: () => parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10),
        });
        if (armed) {
            navigateToMarketplace(firstMaterial.itemHrid, 0);
        } else {
            teardownActionsMarketplaceSession();
            return;
        }
    }

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
    // Claim session ownership BEFORE first await
    const capturedSessionId = marketplaceSession.start({
        owner: MARKETPLACE_OWNER.ACTIONS,
        onEnd: teardownActionsMarketplaceSession,
    });

    // Re-establish cleanup observer for this session (may have been nulled by previous teardown)
    setupActionsCleanupObserver();

    // Navigate to marketplace
    const success = await openMarketplacePage();
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        teardownActionsMarketplaceSession();
        return;
    }

    // Guard: verify session still active after navigation
    if (!marketplaceSession.isActive(capturedSessionId)) {
        return;
    }

    // Wait a moment for marketplace to settle
    await new Promise((resolve) => {
        const delayTimeout = setTimeout(resolve, 200);
        timerRegistry.registerTimeout(delayTimeout);
    });

    // Guard again after the extra delay
    if (!marketplaceSession.isActive(capturedSessionId)) {
        return;
    }

    // Recalculate materials fresh (inventory may have changed since button was rendered)
    const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
    const accountForQueue = !ignoreQueue;
    const freshMaterials = calculateMaterialRequirements(actionHrid, numActions, accountForQueue);

    // Set activeWorkflowModel AFTER startSession
    autofillManager.startSession({ sessionId: capturedSessionId, quantityProvider: null });
    activeWorkflowModel = {
        sessionId: capturedSessionId,
        materials: freshMaterials.map((m) => ({ ...m })),
        returnContext: {
            actionHrid,
            numActions,
            enhancementContext: null,
        },
    };

    // Create custom tabs
    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
    if (tabsContainer) {
        createMissingMaterialTabs(freshMaterials, null, capturedSessionId);
    }

    // Activate the first tradeable missing material automatically (same as manual tab click).
    const firstMaterial = freshMaterials.find((m) => m.isTradeable !== false && m.missing > 0);
    if (firstMaterial) {
        const firstTab = currentMaterialsTabs.find(
            (t) => t.getAttribute && t.getAttribute('data-item-hrid') === firstMaterial.itemHrid
        );
        const tabRef = { tab: firstTab ?? null };
        const armed = autofillManager.arm({
            sessionId: capturedSessionId,
            itemHrid: firstMaterial.itemHrid,
            enhancementLevel: 0,
            modalMode: 'buy',
            quantityProvider: () => parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10),
        });
        if (armed) {
            navigateToMarketplace(firstMaterial.itemHrid, 0);
        } else {
            teardownActionsMarketplaceSession();
            return;
        }
    }

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
 * Walk up from element until we find a direct child of panel, or null if not found.
 * @param {HTMLElement} element
 * @param {HTMLElement} panel
 * @returns {HTMLElement|null}
 */
function findPanelLevelAncestor(element, panel) {
    let current = element;
    while (current && current.parentElement !== panel) {
        current = current.parentElement;
    }
    return current;
}

/**
 * Build the click handler for a material tab.
 * Defined outside the loop to satisfy the no-loop-func lint rule.
 * @param {{ tab: HTMLElement|null }} tabRef - Holder updated to the tab element after creation
 * @param {number} sessionId - The marketplaceSession token for this workflow
 * @returns {Function}
 */
function makeMaterialClickHandler(tabRef, sessionId) {
    return (_e, mat) => {
        const armed = autofillManager.arm({
            sessionId,
            itemHrid: mat.itemHrid,
            enhancementLevel: 0,
            modalMode: 'buy',
            // Read the live missing quantity from the tab attribute kept current by the inventory listener.
            quantityProvider: () => parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10),
        });
        if (!armed) return;
        navigateToMarketplace(mat.itemHrid, 0);
    };
}

/**
 * Create a strategy indicator element for the marketplace tab row
 * @param {Object} strategyInfo - Auto-calculated protection strategy
 * @returns {HTMLElement}
 */
function createStrategyIndicator(strategyInfo) {
    const indicator = document.createElement('div');
    indicator.setAttribute('data-mwi-custom-tab', 'true');
    indicator.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        font-size: 12px;
        color: #aaa;
        white-space: nowrap;
    `;

    if (strategyInfo.protectFrom === 0) {
        indicator.textContent = 'No protection needed';
    } else {
        // Get item sprite URL from existing DOM
        const spriteUse = document.querySelector('use[href*="items_sprite"]');
        if (spriteUse && strategyInfo.protectionItemHrid) {
            const spriteUrl = spriteUse.getAttribute('href').split('#')[0];
            const iconName = strategyInfo.protectionItemHrid.split('/').pop();
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '20');
            svg.setAttribute('height', '20');
            svg.style.flexShrink = '0';
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `${spriteUrl}#${iconName}`);
            svg.appendChild(use);
            indicator.appendChild(svg);
        }

        const label = document.createElement('span');
        label.textContent = `From: +${strategyInfo.protectFrom}`;
        indicator.appendChild(label);
    }

    return indicator;
}

/**
 * Get game object via React fiber tree traversal
 * @returns {Object|null} Game component instance
 */
function getGameObject() {
    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function find(fiber) {
        if (!fiber) return null;
        if (fiber.stateNode?.handleGoToAction) return fiber.stateNode;
        return find(fiber.child) || find(fiber.sibling);
    }

    return find(rootFiber);
}

/**
 * Create a "Return to Action" tab for navigating back after buying materials
 * @param {HTMLElement} referenceTab - Tab element to clone structure from
 * @param {Object} returnContext - Return context from activeWorkflowModel
 * @returns {HTMLElement|null} Return tab element, or null if no context
 */
function createReturnTab(referenceTab, returnContext) {
    let displayName;

    if (returnContext?.actionHrid) {
        const details = dataManager.getActionDetails(returnContext.actionHrid);
        displayName = details?.name || returnContext.actionHrid.split('/').pop();
        if (returnContext.numActions > 0) displayName += ` (\u00d7${formatWithSeparator(returnContext.numActions)})`;
    } else if (returnContext?.enhancementContext) {
        const ctx = returnContext.enhancementContext;
        const itemName = dataManager.getItemDetails(ctx.itemHrid)?.name || '...';
        displayName = `${itemName} +${ctx.startLevel}\u2192+${ctx.targetLevel}`;
    } else {
        return null;
    }

    const tab = referenceTab.cloneNode(true);
    tab.setAttribute('data-mwi-custom-tab', 'true');
    tab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.ACTIONS);
    tab.classList.remove('Mui-selected');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');

    const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
    if (badgeSpan) {
        badgeSpan.innerHTML = `
            <div style="text-align: center;">
                <div>\u21a9 Return</div>
                <div style="font-size: 0.75em; color: #60a5fa;">${displayName}</div>
            </div>
        `;
    }

    tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleReturnToAction();
    });

    return tab;
}

/**
 * Navigate back to the stored action and restore input values
 */
async function handleReturnToAction() {
    const game = getGameObject();
    if (!game) return;

    const returnContext = activeWorkflowModel?.returnContext;

    if (returnContext?.actionHrid) {
        game.handleGoToAction(returnContext.actionHrid);
    } else if (returnContext?.enhancementContext) {
        game.handleChangeNavTarget('enhancing');
    } else {
        return;
    }

    // Restore input value for production actions — poll for the input to appear
    if (returnContext?.actionHrid && returnContext.numActions > 0) {
        const maxAttempts = 20;
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise((resolve) => {
                const t = setTimeout(resolve, 100);
                timerRegistry.registerTimeout(t);
            });

            const input =
                document.querySelector('[class*="maxActionCountInput"] input') ||
                document.querySelector('[class*="SkillActionDetail_skillActionDetail"] input[type="number"]');
            if (input) {
                setReactInputValue(input, returnContext.numActions);
                break;
            }
        }
    }
}

/**
 * Set up (or re-establish) the marketplace cleanup observer for the ACTIONS owner.
 * Safe to call multiple times — stops any existing observer before creating a new one.
 */
function setupActionsCleanupObserver() {
    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }
    cleanupObserver = setupMarketplaceCleanupObserver({
        owner: MARKETPLACE_OWNER.ACTIONS,
        onTabsGone: () => {
            const capturedSessionId = activeWorkflowModel?.sessionId ?? null;
            if (capturedSessionId !== null && !marketplaceSession.isActive(capturedSessionId)) return;
            const tabContainer = getVisibleMarketplaceTabContainer();
            if (tabContainer) {
                reinjectActionsMarketplaceTabs(tabContainer);
            } else {
                teardownActionsMarketplaceSession();
            }
        },
    });
}

/**
 * Idempotent teardown for the ACTIONS marketplace session.
 * Cleans up tabs, inventory listener, cleanup observer, autofill session, and workflow model.
 * Does NOT touch storedActionHrid / storedNumActions / storedEnhancementContext (Return context).
 */
function teardownActionsMarketplaceSession() {
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);
    currentMaterialsTabs.length = 0;

    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }

    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }

    const sessionIdToExit = activeWorkflowModel?.sessionId ?? null;
    autofillManager.exitSession(sessionIdToExit);

    activeWorkflowModel = null;
}

/**
 * Rebuild ACTIONS marketplace tabs from the current activeWorkflowModel.
 * Called when the cleanup observer detects that our tabs disappeared but the
 * marketplace panel is still visible (e.g. a React re-render wiped them).
 * @param {HTMLElement} tabContainer
 */
function reinjectActionsMarketplaceTabs(tabContainer) {
    if (!activeWorkflowModel) return;
    if (!marketplaceSession.isActive(activeWorkflowModel.sessionId)) return;

    const sessionId = activeWorkflowModel.sessionId;
    const { materials, returnContext } = activeWorkflowModel;
    const strategyInfo = returnContext?.enhancementContext?.strategyInfo ?? null;

    // Get reference tab for cloning
    const referenceTab = Array.from(tabContainer.children).find((btn) => btn.textContent.includes('My Listings'));
    if (!referenceTab) return;

    // Ensure flex wrapping
    tabContainer.style.flexWrap = 'wrap';

    currentMaterialsTabs.length = 0;

    // Strategy indicator
    if (strategyInfo) {
        const indicator = createStrategyIndicator(strategyInfo);
        indicator.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.ACTIONS);
        tabContainer.appendChild(indicator);
        currentMaterialsTabs.push(indicator);
    }

    // Material tabs
    for (const material of materials) {
        const tabRef = { tab: null };
        const handler = makeMaterialClickHandler(tabRef, sessionId);
        const tab = createMaterialTab(material, referenceTab, handler, MARKETPLACE_OWNER.ACTIONS);
        tabRef.tab = tab;
        tabContainer.appendChild(tab);
        currentMaterialsTabs.push(tab);
    }

    // Return tab
    const returnTab = createReturnTab(referenceTab, returnContext);
    if (returnTab) {
        tabContainer.appendChild(returnTab);
        currentMaterialsTabs.push(returnTab);
    }
}

/**
 * Create custom tabs for missing materials
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {Object|null} strategyInfo - Auto-calculated protection strategy info
 * @param {number} sessionId - The marketplaceSession token for this workflow
 */
function createMissingMaterialTabs(missingMaterials, strategyInfo = null, sessionId = null) {
    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');

    if (!tabsContainer) {
        console.error('[MissingMats] Tabs container not found');
        return;
    }

    // Remove any existing custom tabs first (owner-scoped)
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);
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

    // Create tab for each missing material
    currentMaterialsTabs.length = 0; // Clear without reassigning (preserves observer reference)

    // Add strategy indicator if auto-calculated
    if (strategyInfo) {
        const indicator = createStrategyIndicator(strategyInfo);
        indicator.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.ACTIONS);
        tabsContainer.appendChild(indicator);
        currentMaterialsTabs.push(indicator);
    }

    for (const material of missingMaterials) {
        const tabRef = { tab: null };
        const handler = makeMaterialClickHandler(tabRef, sessionId);
        const tab = createMaterialTab(material, referenceTab, handler, MARKETPLACE_OWNER.ACTIONS);
        tabRef.tab = tab;
        tabsContainer.appendChild(tab);
        currentMaterialsTabs.push(tab);
    }

    // Add "Return to Action" tab at the end
    const returnContext = activeWorkflowModel?.returnContext ?? null;
    const returnTab = createReturnTab(referenceTab, returnContext);
    if (returnTab) {
        tabsContainer.appendChild(returnTab);
        currentMaterialsTabs.push(returnTab);
    }
}

/**
 * Setup inventory listener for live tab updates
 * Listens for inventory changes via dataManager and updates tabs accordingly
 */
function setupInventoryListener() {
    // Remove existing listener if any
    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
    }

    // Create new listener that watches for inventory-related messages
    inventoryUpdateHandler = () => {
        updateTabsOnInventoryChange();
    };

    dataManager.on('items_updated', inventoryUpdateHandler);
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

    if (activeWorkflowModel?.returnContext?.enhancementContext) {
        // Enhancement mode
        const ctx = activeWorkflowModel.returnContext.enhancementContext;
        updatedMaterials = calculateEnhancementMaterialRequirements(
            ctx.itemHrid,
            ctx.startLevel,
            ctx.targetLevel,
            ctx.protectionItemHrid,
            ctx.protectFromLevel,
            ctx.repeatCount
        );
    } else if (activeWorkflowModel?.returnContext?.actionHrid && activeWorkflowModel.returnContext.numActions > 0) {
        // Production mode
        const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
        const accountForQueue = !ignoreQueue;
        updatedMaterials = calculateMaterialRequirements(
            activeWorkflowModel.returnContext.actionHrid,
            activeWorkflowModel.returnContext.numActions,
            accountForQueue
        );
    } else {
        return;
    }

    // Update each existing tab
    currentMaterialsTabs.forEach((tab) => {
        const itemHrid = tab.getAttribute('data-item-hrid');
        const material = updatedMaterials.find((m) => m.itemHrid === itemHrid);

        if (material) {
            updateTabBadge(tab, material);

            // Also update activeWorkflowModel.materials
            if (activeWorkflowModel) {
                const modelEntry = activeWorkflowModel.materials.find((m) => m.itemHrid === itemHrid);
                if (modelEntry) {
                    modelEntry.missing = material.missing;
                }
            }
        }
    });
}

/**
 * Update a single tab's badge with new material data
 * @param {HTMLElement} tab - Tab element to update
 * @param {Object} material - Material object with updated counts
 */
function updateTabBadge(tab, material) {
    const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
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
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);
    currentMaterialsTabs.length = 0; // Clear without reassigning (preserves observer reference)

    // Clean up inventory listener
    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }

    autofillManager.exitSession(activeWorkflowModel?.sessionId ?? null);

    activeWorkflowModel = null;
}

export default {
    initialize,
    cleanup,
};
