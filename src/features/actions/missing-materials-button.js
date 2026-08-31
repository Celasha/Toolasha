/**
 * Missing Materials Marketplace Button
 * Adds button to production and enhancement panels that opens marketplace with tabs for missing materials
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import {
    findActionInput,
    attachInputListeners,
    performInitialUpdate,
    refreshActionPanels,
} from '../../utils/action-panel-helper.js';
import {
    calculateMaterialRequirements,
    calculateEnhancementMaterialRequirements,
} from '../../utils/material-calculator.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createAutofillManager, getReactFiberFromElement } from '../../utils/marketplace-autofill.js';
import {
    createMaterialTab,
    removeMaterialTabsForOwner,
    getVisibleMarketplaceTabContainer,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
    watchNativeTabExit,
    isElementActuallyVisible,
    clickMarketplaceNavigationButton,
    updateTabBadge,
    MARKETPLACE_REMOUNT_GRACE_MS,
    isMarketplaceMarketListingsSelected,
} from '../../utils/marketplace-tabs.js';
import { getProtectionItemFromUI, getProtectFromLevelFromUI } from './enhancement-display.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';
import { getOrCreateProductionToolsBlock, normalizeProductionToolsBlock } from './production-tools-layout.js';

/**
 * Module-level state
 */
let cleanupObserver = null;
let nativeTabExitCleanup = null;
const currentMaterialsTabs = [];
let domObserverUnregister = null;
let enhancementDomObserverUnregister = null;
let processedPanels = new WeakSet();
let processedEnhancingPanels = new WeakSet();
const enhancingPanelWatchers = new Map();
let inventoryUpdateHandler = null;
let activeWorkflowModel = null;
let actionsSessionId = null;
let enhancingReturnGeneration = 0;
let actionsUpdatedHandler = null;
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

    // Refresh the queue-aware button state when the finite action queue changes (add/remove),
    // since the calculation reads dataManager.getCurrentActions() but nothing else invalidates
    // an already-rendered panel.
    if (actionsUpdatedHandler) {
        dataManager.off('actions_updated', actionsUpdatedHandler);
    }
    actionsUpdatedHandler = () => refreshActionPanels((panel, value) => updateButtonForPanel(panel, value));
    dataManager.on('actions_updated', actionsUpdatedHandler);

    // Process existing panels
    processActionPanels();
    processExistingEnhancingPanels();
}

/**
 * Cleanup function
 */
export function cleanup() {
    enhancingReturnGeneration += 1;
    const activeSessionId = actionsSessionId ?? activeWorkflowModel?.sessionId ?? null;
    if (activeSessionId !== null && marketplaceSession.isActive(activeSessionId)) {
        marketplaceSession.end(activeSessionId);
    } else {
        teardownActionsMarketplaceSession();
    }

    if (domObserverUnregister) {
        domObserverUnregister();
        domObserverUnregister = null;
    }

    if (enhancementDomObserverUnregister) {
        enhancementDomObserverUnregister();
        enhancementDomObserverUnregister = null;
    }

    if (actionsUpdatedHandler) {
        dataManager.off('actions_updated', actionsUpdatedHandler);
        actionsUpdatedHandler = null;
    }

    // Disconnect marketplace cleanup observer
    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }

    autofillManager.cleanup();

    // Remove any existing custom tabs
    handleMarketplaceCleanup();

    for (const unwatchPanel of enhancingPanelWatchers.values()) {
        unwatchPanel();
    }
    enhancingPanelWatchers.clear();

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

    // Recreate only the button. The shared production tools block remains in
    // place so Cost Summary and Budget Calculator do not jump during input updates.
    const existingButton = panel.querySelector('#mwi-missing-mats-button');
    if (existingButton) existingButton.remove();

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
        disabled = !missingMaterials.some((material) => material.isTradeable !== false && Number(material.missing) > 0);
    }

    // Create and insert button with actionHrid and numActions for live updates.
    const button = createMissingMaterialsButton(missingMaterials, actionHrid, numActions, disabled);
    button.style.boxSizing = 'border-box';
    button.style.width = '100%';
    button.style.maxWidth = '100%';
    button.style.minWidth = '0';
    button.style.margin = '0';
    button.style.order = '1';

    // Production uses a native two-column info grid. Keep the Requires label/value pair
    // untouched, then inject ONE Toolasha row spanning both columns. The Missing Mats
    // button, Cost Summary and Budget Calculator all live in this row, so they share the
    // same width and can never overlap the following native rows.
    const toolsBlock = getOrCreateProductionToolsBlock(panel);
    if (toolsBlock) {
        toolsBlock.appendChild(button);
        normalizeProductionToolsBlock(panel);
    } else {
        const costSummary = panel.querySelector('#mwi-cost-summary');
        const budgetCalculator = panel.querySelector('#mwi-budget-calculator');
        if (costSummary?.parentElement) {
            costSummary.parentElement.insertBefore(button, costSummary);
        } else if (budgetCalculator?.parentElement) {
            budgetCalculator.parentElement.insertBefore(button, budgetCalculator);
        } else {
            panel.prepend(button);
        }
    }
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

    // Drop observers retained for detached React panels before tracking a remount.
    for (const [trackedPanel, unwatchPanel] of enhancingPanelWatchers) {
        if (trackedPanel.isConnected) continue;
        unwatchPanel();
        enhancingPanelWatchers.delete(trackedPanel);
    }

    processedEnhancingPanels.add(panel);

    // Watch for changes (item swap, level change, protection change) with debounce.
    // Track the exact native observer so feature disable/re-enable cannot leave a stale
    // watcher attached to an already-processed Enhancing panel.
    const unwatchPanel = createMutationWatcher(
        panel,
        (mutations) => {
            // Ignore every mutation caused by the injected button itself. In particular,
            // its hover style changes must not schedule a replacement between mouseenter
            // and click, which made the Enhancing button appear enabled but act as a no-op.
            const isOwnButtonMutation = mutations.every((m) => {
                const targetElement = m.target?.nodeType === Node.ELEMENT_NODE ? m.target : m.target?.parentElement;
                if (targetElement?.closest?.('#mwi-missing-mats-button')) return true;

                const nodes = [...m.addedNodes, ...m.removedNodes];
                return (
                    nodes.length > 0 &&
                    nodes.every((n) => n?.nodeType !== Node.ELEMENT_NODE || n.id === 'mwi-missing-mats-button')
                );
            });
            if (isOwnButtonMutation) return;

            if (enhancementDebounceTimeout) {
                clearTimeout(enhancementDebounceTimeout);
            }
            enhancementDebounceTimeout = setTimeout(() => {
                enhancementDebounceTimeout = null;
                updateEnhancementButton(panel);
            }, 60);
        },
        { childList: true, subtree: true, attributes: true }
    );
    enhancingPanelWatchers.set(panel, unwatchPanel);

    // Create as soon as the panel observer provides the item HRID. Polling briefly
    // avoids the visible one-second pop-in while remaining safe during item switches.
    const tryInitialButton = (attempt = 0) => {
        if (!panel.isConnected) {
            enhancingPanelWatchers.get(panel)?.();
            enhancingPanelWatchers.delete(panel);
            return;
        }
        updateEnhancementButton(panel);
        if (!panel.querySelector('#mwi-missing-mats-button') && attempt < 20) {
            const retryTimer = setTimeout(() => tryInitialButton(attempt + 1), 50);
            timerRegistry.registerTimeout(retryTimer);
        }
    };
    const initialTimer = setTimeout(() => tryInitialButton(0), 0);
    timerRegistry.registerTimeout(initialTimer);
}

/**
 * Resolve the live SkillActionDetail class that owns the visible Enhancing component.
 * @param {HTMLElement} panel
 * @returns {Object|null}
 */
function isEnhancingActionComponent(node) {
    if (
        !node ||
        typeof node.setState !== 'function' ||
        typeof node.getPrimaryItem !== 'function' ||
        typeof node.getSecondaryItem !== 'function' ||
        typeof node.selectEnhancingItemHandler !== 'function' ||
        !node.state ||
        !Object.prototype.hasOwnProperty.call(node.state, 'primaryItemHash') ||
        !Object.prototype.hasOwnProperty.call(node.state, 'enhancingMaxLevel')
    ) {
        return false;
    }

    const actionHrid = node.props?.actionDetail?.hrid || node.state?.actionDetail?.hrid;
    return !actionHrid || actionHrid === '/actions/enhancing/enhance';
}

function getEnhancingActionComponent(panel) {
    // Different renders attach the useful fiber key to different descendants.
    // Probe concrete controls first, then use a bounded unique root-tree fallback.
    const anchors = panel
        ? [panel, ...panel.querySelectorAll('input, select, button, [class*="SkillActionDetail_item"]')]
        : [];
    const visitedFibers = new Set();
    const anchoredMatches = new Set();

    for (const anchor of anchors) {
        let fiber = getReactFiberFromElement(anchor);
        let depth = 0;
        while (fiber && depth < 160) {
            if (visitedFibers.has(fiber)) break;
            visitedFibers.add(fiber);
            if (isEnhancingActionComponent(fiber.stateNode)) anchoredMatches.add(fiber.stateNode);
            fiber = fiber.return;
            depth += 1;
        }
    }

    if (anchoredMatches.size === 1) return anchoredMatches.values().next().value;
    if (anchoredMatches.size > 1) return null;

    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    const stack = [rootFiber];
    const matches = new Set();
    let visited = 0;
    while (stack.length > 0 && visited < 25000) {
        const fiber = stack.pop();
        if (!fiber) continue;
        visited += 1;
        if (isEnhancingActionComponent(fiber.stateNode)) matches.add(fiber.stateNode);
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
    }

    return matches.size === 1 ? matches.values().next().value : null;
}

function buildInventoryItemHash(itemHrid, enhancementLevel = 0) {
    const characterId = dataManager.getCurrentCharacterId();
    if (!characterId || !itemHrid) return null;
    return `${characterId}::/item_locations/inventory::${itemHrid}::${Number(enhancementLevel) || 0}`;
}

function getEnhancingLoadoutValueFromUI(panel) {
    const root = panel?.closest('[class*="SkillActionDetail_skillActionDetail"]') || panel;
    if (!root) return 0;
    const selects = Array.from(root.querySelectorAll('select'));
    const loadoutSelect = selects.find((select) => {
        const contextText = select.parentElement?.parentElement?.textContent || select.parentElement?.textContent || '';
        return /Loadout/i.test(contextText) && select.id !== 'enhancementDropdown';
    });
    return loadoutSelect?.value ?? null;
}

/**
 * Capture the exact Enhancing selection and controls for Return. If the React
 * owner cannot be resolved at click time, derive stable item hashes from the
 * already-known item/level context instead of disabling Return entirely.
 * @param {HTMLElement} panel
 * @param {Object} fallback
 * @returns {Object|null}
 */
function captureEnhancingReturnState(panel, fallback = {}) {
    const component = getEnhancingActionComponent(panel);
    const state = component?.state || {};
    const primaryItemHash = state.primaryItemHash || buildInventoryItemHash(fallback.itemHrid, fallback.startLevel);
    if (!primaryItemHash) return null;

    const hasFallbackProtection = Object.prototype.hasOwnProperty.call(fallback, 'protectionItemHrid');
    const secondaryItemHash = hasFallbackProtection
        ? fallback.protectionItemHrid
            ? buildInventoryItemHash(fallback.protectionItemHrid, 0)
            : null
        : (state.secondaryItemHash ?? null);
    const hasFallbackRepeat = Object.prototype.hasOwnProperty.call(fallback, 'repeatCount');
    const fallbackHasMaxCount = hasFallbackRepeat && fallback.repeatCount !== null;
    const liveLoadoutValue = getEnhancingLoadoutValueFromUI(panel);

    return Object.freeze({
        primaryItemHash,
        secondaryItemHash,
        // The focused Target/Protection/Repeat inputs can contain a newer value than
        // React state until blur. Prefer the values read directly from the live UI.
        enhancingMaxLevel: fallback.targetLevel ?? state.enhancingMaxLevel ?? 0,
        protectionMinLevel: fallback.protectFromLevel ?? state.protectionMinLevel ?? 0,
        hasMaxCount: hasFallbackRepeat ? fallbackHasMaxCount : (state.hasMaxCount ?? false),
        maxActionCount: hasFallbackRepeat
            ? fallbackHasMaxCount
                ? Number(fallback.repeatCount) || 1
                : 0
            : (state.maxActionCount ?? 0),
        maxActionCountInput: hasFallbackRepeat
            ? fallbackHasMaxCount
                ? String(Number(fallback.repeatCount) || 1)
                : '∞'
            : (state.maxActionCountInput ?? '∞'),
        selectedCharacterLoadoutId: liveLoadoutValue ?? state.selectedCharacterLoadoutId ?? 0,
    });
}

/**
 * Get current enhancement level from action queue or DOM
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {number} Current enhancement level (0-19)
 */
function getCurrentEnhancementLevel(panel) {
    const parseItemHashLevel = (itemHash) => {
        if (!itemHash) return null;
        const parts = itemHash.split('::');
        const parsed = Number.parseInt(parts.at(-1), 10);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    };

    // Prefer the exact visible Enhancing component over the global action queue.
    // The queue can contain a different item from the one currently selected in the panel.
    const componentLevel = parseItemHashLevel(getEnhancingActionComponent(panel)?.state?.primaryItemHash);
    if (componentLevel !== null) return componentLevel;

    // Fallback: read the selected item label from the current panel.
    const selectedNames = panel.querySelectorAll('[class*="SkillActionDetail_item"] [class*="Item_name"]');
    for (const selectedName of selectedNames) {
        const levelMatch = selectedName.textContent.trim().match(/\+(\d+)$/);
        if (levelMatch) return Number.parseInt(levelMatch[1], 10);
    }

    // Last resort: use the active Enhancing queue item when the panel has not finished mounting.
    const enhancingAction = dataManager
        .getCurrentActions()
        .find((action) => action.actionHrid === '/actions/enhancing/enhance');
    return parseItemHashLevel(enhancingAction?.primaryItemHash) ?? 0;
}

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

    const disabled = !missingMaterials.some(
        (material) => material.isTradeable !== false && Number(material.missing) > 0
    );

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
        strategyInfo,
        panel
    );

    // The Enhancing component is a two-column flex layout. A panel-level sibling
    // becomes a third off-screen column. Keep the button inside the visible info column.
    button.style.boxSizing = 'border-box';
    button.style.width = '100%';
    button.style.maxWidth = '360px';
    button.style.alignSelf = 'flex-start';

    const infoColumn = panel.querySelector('[class*="SkillActionDetail_info"]');
    const costsSection = infoColumn?.querySelector('[class*="SkillActionDetail_costs"]');
    if (costsSection?.parentElement) {
        costsSection.after(button);
    } else if (infoColumn) {
        infoColumn.prepend(button);
    } else {
        panel.prepend(button);
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
    strategyInfo,
    panel
) {
    const button = document.createElement('button');
    button.id = 'mwi-missing-mats-button';
    button.type = 'button';
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

        let activationStarted = false;
        const activate = async () => {
            if (activationStarted) return;
            activationStarted = true;

            // Read every editable control directly before navigation. A focused input
            // may not have committed its value to React state yet, and the blur caused by
            // clicking the button can remount the button before the normal click fires.
            const liveTargetLevel = getTargetLevelFromUI(panel) ?? targetLevel;
            const liveProtectionItemHrid = getProtectionItemFromUI(panel);
            const liveProtectFromLevel = getProtectFromLevelFromUI(panel);
            const liveRepeatCount = getRepeatCountFromUI(panel);

            let liveResolvedProtectionItem = liveProtectionItemHrid;
            let liveResolvedProtectFrom = liveProtectFromLevel;
            let liveStrategyInfo = null;
            if (liveProtectFromLevel === 0) {
                const enhancingConfig = getEnhancingParams();
                const pathResult = calculateEnhancementPath(itemHrid, liveTargetLevel, enhancingConfig);
                if (pathResult?.optimalStrategy) {
                    liveResolvedProtectFrom = pathResult.optimalStrategy.protectFrom;
                    liveResolvedProtectionItem =
                        pathResult.optimalStrategy.protectionItemHrid || liveProtectionItemHrid;
                    liveStrategyInfo = {
                        protectFrom: liveResolvedProtectFrom,
                        protectionItemHrid: liveResolvedProtectionItem,
                    };
                }
            }

            const enhancingReturnState = captureEnhancingReturnState(panel, {
                itemHrid,
                startLevel,
                targetLevel: liveTargetLevel,
                protectionItemHrid: liveResolvedProtectionItem,
                protectFromLevel: liveResolvedProtectFrom,
                repeatCount: liveRepeatCount,
            });

            try {
                await handleEnhancementMissingMaterialsClick(
                    itemHrid,
                    startLevel,
                    liveTargetLevel,
                    liveResolvedProtectionItem,
                    liveResolvedProtectFrom,
                    liveRepeatCount,
                    liveStrategyInfo || strategyInfo,
                    enhancingReturnState
                );
            } catch (error) {
                console.error('[MissingMats] Enhancing workflow failed:', error);
                const sessionId = actionsSessionId ?? activeWorkflowModel?.sessionId ?? null;
                if (sessionId !== null && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
            } finally {
                // A successful workflow keeps the ACTIONS session active and the source
                // panel is normally unmounted. A fail-closed navigation/identity path ends
                // the session; if React kept this button mounted, allow a clean retry.
                const active = marketplaceSession.getActive();
                if (active?.owner !== MARKETPLACE_OWNER.ACTIONS) {
                    activationStarted = false;
                }
            }
        };

        // Start on pointerdown, before the focused Target Level input blurs and causes
        // React to replace this button. Keyboard activation continues through click.
        button.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            void activate();
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void activate();
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
    strategyInfo,
    enhancingReturnState
) {
    // Starting any new ACTIONS workflow invalidates an older asynchronous Enhancing Return.
    enhancingReturnGeneration += 1;

    // Claim session ownership BEFORE first await
    const capturedSessionId = marketplaceSession.start({
        owner: MARKETPLACE_OWNER.ACTIONS,
        onEnd: teardownActionsMarketplaceSession,
    });
    actionsSessionId = capturedSessionId;

    // Navigate to marketplace
    const success = await openMarketplacePage(capturedSessionId);
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        marketplaceSession.end(capturedSessionId);
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
                restoreState: enhancingReturnState,
            },
        },
    };

    // Create custom tabs in the unique visible Marketplace tablist.
    if (!createMissingMaterialTabs(freshMaterials, strategyInfo, capturedSessionId)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    // Activate the first tradeable missing material automatically (same as manual tab click).
    const firstMaterial = freshMaterials.find((m) => m.isTradeable !== false && m.missing > 0);
    if (!firstMaterial) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    const armed = autofillManager.arm({
        sessionId: capturedSessionId,
        itemHrid: firstMaterial.itemHrid,
        enhancementLevel: 0,
        modalMode: 'buy',
        quantityProvider: () => {
            const model = activeWorkflowModel;
            if (model?.sessionId !== capturedSessionId) return 0;
            return model.materials.find((entry) => entry.itemHrid === firstMaterial.itemHrid)?.missing ?? 0;
        },
    });
    if (!armed || !navigateToMarketplace(firstMaterial.itemHrid, 0)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    // Only arm the cleanup/exit observer once our own initial navigation has been
    // initiated. Arming it earlier lets it see a retained native "My Listings" state
    // from before this workflow started and tear the session down mid-initialization.
    setupActionsCleanupObserver();

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
    button.type = 'button';
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
            try {
                await handleMissingMaterialsClick(actionHrid, numActions);
            } catch (error) {
                console.error('[MissingMats] Production workflow failed:', error);
                const sessionId = actionsSessionId ?? activeWorkflowModel?.sessionId ?? null;
                if (sessionId !== null && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
            }
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
    // Starting any new ACTIONS workflow invalidates an older asynchronous Enhancing Return.
    enhancingReturnGeneration += 1;

    // Claim session ownership BEFORE first await
    const capturedSessionId = marketplaceSession.start({
        owner: MARKETPLACE_OWNER.ACTIONS,
        onEnd: teardownActionsMarketplaceSession,
    });
    actionsSessionId = capturedSessionId;

    // Navigate to marketplace
    const success = await openMarketplacePage(capturedSessionId);
    if (!success) {
        console.error('[MissingMats] Failed to navigate to marketplace');
        marketplaceSession.end(capturedSessionId);
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

    // Create custom tabs in the unique visible Marketplace tablist.
    if (!createMissingMaterialTabs(freshMaterials, null, capturedSessionId)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    // Activate the first tradeable missing material automatically (same as manual tab click).
    const firstMaterial = freshMaterials.find((m) => m.isTradeable !== false && m.missing > 0);
    if (!firstMaterial) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    const armed = autofillManager.arm({
        sessionId: capturedSessionId,
        itemHrid: firstMaterial.itemHrid,
        enhancementLevel: 0,
        modalMode: 'buy',
        quantityProvider: () => {
            const model = activeWorkflowModel;
            if (model?.sessionId !== capturedSessionId) return 0;
            return model.materials.find((entry) => entry.itemHrid === firstMaterial.itemHrid)?.missing ?? 0;
        },
    });
    if (!armed || !navigateToMarketplace(firstMaterial.itemHrid, 0)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    // Only arm the cleanup/exit observer once our own initial navigation has been
    // initiated. Arming it earlier lets it see a retained native "My Listings" state
    // from before this workflow started and tear the session down mid-initialization.
    setupActionsCleanupObserver();

    // Setup inventory listener for live updates
    setupInventoryListener();
}

/**
 * Navigate to marketplace by simulating click on navbar
 * @returns {Promise<boolean>} True if successful
 */
async function openMarketplacePage(sessionId) {
    if (!marketplaceSession.isActive(sessionId) || !clickMarketplaceNavigationButton()) {
        console.error('[MissingMats] Marketplace navbar button not found');
        return false;
    }
    return await waitForMarketplace(sessionId);
}

/**
 * Wait for marketplace panel to appear
 * @returns {Promise<boolean>} True if marketplace appeared within timeout
 */
async function waitForMarketplace(sessionId) {
    const maxAttempts = 50;
    const delayMs = 100;

    for (let i = 0; i < maxAttempts; i++) {
        if (!marketplaceSession.isActive(sessionId)) return false;
        if (getVisibleMarketplaceTabContainer()) {
            return true;
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
 * Build the click handler for a material tab.
 * Defined outside the loop to satisfy the no-loop-func lint rule.
 * @param {{ tab: HTMLElement|null }} tabRef - Holder updated to the tab element after creation
 * @param {number} sessionId - The marketplaceSession token for this workflow
 * @returns {Function}
 */
function makeMaterialClickHandler(tabRef, sessionId) {
    return (_e, mat) => {
        if (!marketplaceSession.isActive(sessionId)) return;
        const liveMissing = parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10);
        if (!Number.isFinite(liveMissing) || liveMissing <= 0 || mat.isTradeable === false) return;

        const armed = autofillManager.arm({
            sessionId,
            itemHrid: mat.itemHrid,
            enhancementLevel: 0,
            modalMode: 'buy',
            quantityProvider: () => {
                const model = activeWorkflowModel;
                if (model?.sessionId !== sessionId) return 0;
                return model.materials.find((entry) => entry.itemHrid === mat.itemHrid)?.missing ?? 0;
            },
        });
        if (!armed || !navigateToMarketplace(mat.itemHrid, 0)) marketplaceSession.end(sessionId);
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

    const stack = [rootFiber];
    while (stack.length > 0) {
        const fiber = stack.pop();
        if (typeof fiber?.stateNode?.handleGoToAction === 'function') return fiber.stateNode;
        if (fiber?.sibling) stack.push(fiber.sibling);
        if (fiber?.child) stack.push(fiber.child);
    }
    return null;
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
    // A custom tab must not duplicate the native tab/panel identity.
    tab.removeAttribute('id');
    tab.removeAttribute('aria-controls');
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

    tab.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            await handleReturnToAction();
        } catch (error) {
            console.error('[MissingMats] Return workflow failed:', error);
            const sessionId = actionsSessionId ?? activeWorkflowModel?.sessionId ?? null;
            if (sessionId !== null) marketplaceSession.end(sessionId);
        }
    });

    return tab;
}

/**
 * Return restoration may continue after the Marketplace session ends normally,
 * because leaving Marketplace synchronously tears down that session. It must stop,
 * however, when a newer Return starts or another Marketplace owner takes control.
 * @param {number} generation
 * @param {number|null} capturedSessionId
 * @returns {boolean}
 */
function shouldAbortEnhancingReturn(generation, capturedSessionId) {
    if (generation !== enhancingReturnGeneration) return true;
    const active = marketplaceSession.getActive();
    return Boolean(active && active.sessionId !== capturedSessionId);
}

/**
 * Navigate back to the stored action and restore input values
 */
async function handleReturnToAction() {
    const capturedSessionId = activeWorkflowModel?.sessionId ?? null;
    const returnGeneration = ++enhancingReturnGeneration;
    const game = getGameObject();
    if (!game) {
        console.error('[MissingMats] Return could not resolve the game navigation component');
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    // Snapshot locally because leaving Marketplace may synchronously tear down
    // activeWorkflowModel through the cleanup observer.
    const returnContext = activeWorkflowModel?.returnContext;
    if (!returnContext) {
        console.error('[MissingMats] Return context is no longer available');
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    if (returnContext.actionHrid) {
        // The native override restores both the exact action and its count.
        game.handleGoToAction(returnContext.actionHrid, returnContext.numActions || undefined);
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    const ctx = returnContext.enhancementContext;
    if (!ctx) {
        console.error('[MissingMats] Return context does not contain an action or enhancement target');
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    const restore =
        ctx.restoreState ||
        Object.freeze({
            primaryItemHash: buildInventoryItemHash(ctx.itemHrid, ctx.startLevel),
            secondaryItemHash: ctx.protectionItemHrid ? buildInventoryItemHash(ctx.protectionItemHrid, 0) : null,
            enhancingMaxLevel: ctx.targetLevel,
            protectionMinLevel: ctx.protectFromLevel || 0,
            hasMaxCount: ctx.repeatCount !== null && ctx.repeatCount !== undefined,
            maxActionCount: ctx.repeatCount ?? 0,
            maxActionCountInput: ctx.repeatCount == null ? '∞' : String(ctx.repeatCount),
            selectedCharacterLoadoutId: 0,
        });
    if (!restore?.primaryItemHash) {
        console.error('[MissingMats] Enhancing Return could not derive the selected item hash');
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    // Use the game's own item-navigation flow. handleEnhanceItem sets the internal
    // Enhancing override and the freshly mounted action component consumes it via
    // selectEnhancingItemHandler. Directly committing the whole state before this
    // native override settled was being reset by componentDidUpdate/getInitState.
    if (typeof game.handleEnhanceItem === 'function') {
        game.handleEnhanceItem(restore.primaryItemHash);
    } else if (typeof game.handleGoToNavTarget === 'function') {
        game.handleGoToNavTarget('enhancing');
    } else {
        console.error('[MissingMats] Enhancing Return could not navigate back');
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    let restoredComponent = null;
    for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (shouldAbortEnhancingReturn(returnGeneration, capturedSessionId)) return;

        const panels = Array.from(document.querySelectorAll('[class*="SkillActionDetail_enhancingComponent"]')).filter(
            (panel) => panel.isConnected && isElementActuallyVisible(panel)
        );
        if (panels.length !== 1) continue;

        const component = getEnhancingActionComponent(panels[0]);
        if (!component) continue;

        // The native GamePage override is transient. If the first render missed it,
        // invoke the component's own selector once the exact component is available.
        if (component.state?.primaryItemHash !== restore.primaryItemHash) {
            try {
                component.selectEnhancingItemHandler(restore.primaryItemHash);
            } catch (error) {
                console.error('[MissingMats] Enhancing primary-item restore failed:', error);
            }
            continue;
        }

        restoredComponent = component;
        break;
    }

    if (!restoredComponent) {
        console.error('[MissingMats] Enhancing Return could not restore the selected item');
        if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
        return;
    }

    const component = restoredComponent;
    if (shouldAbortEnhancingReturn(returnGeneration, capturedSessionId)) return;

    try {
        // Restore protection only after the primary item is stable, because the native
        // selector validates and may clear protection whenever the primary item changes.
        if (restore.secondaryItemHash) {
            component.selectProtectionItemHandler(restore.secondaryItemHash);
            for (let i = 0; i < 40; i++) {
                if ((component.state?.secondaryItemHash ?? null) === restore.secondaryItemHash) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
                if (shouldAbortEnhancingReturn(returnGeneration, capturedSessionId)) return;
            }
        } else if (typeof component.removeProtectionItemHandler === 'function') {
            component.removeProtectionItemHandler();
        }

        component.enhancingMaxLevelChanged({ target: { value: String(restore.enhancingMaxLevel) } });
        component.protectionMinLevelChanged({
            target: { value: String(restore.secondaryItemHash ? restore.protectionMinLevel || 0 : 0) },
        });

        if (restore.hasMaxCount) {
            component.maxActionCountChanged({
                target: { value: String(restore.maxActionCountInput ?? restore.maxActionCount ?? 1) },
            });
        } else {
            component.unlimitedActionCountClicked();
        }

        component.loadoutSelected({ target: { value: restore.selectedCharacterLoadoutId ?? 0 } });

        // Wait for the native handlers' setState calls and verify every captured field.
        for (let attempt = 0; attempt < 80; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            if (shouldAbortEnhancingReturn(returnGeneration, capturedSessionId)) return;
            const state = component.state || {};
            const restored =
                state.primaryItemHash === restore.primaryItemHash &&
                (state.secondaryItemHash ?? null) === (restore.secondaryItemHash ?? null) &&
                Number(state.enhancingMaxLevel) === Number(restore.enhancingMaxLevel) &&
                Number(state.protectionMinLevel || 0) ===
                    Number(restore.secondaryItemHash ? restore.protectionMinLevel || 0 : 0) &&
                Boolean(state.hasMaxCount) === Boolean(restore.hasMaxCount) &&
                (!restore.hasMaxCount || Number(state.maxActionCount) === Number(restore.maxActionCount || 0)) &&
                String(state.selectedCharacterLoadoutId ?? 0) === String(restore.selectedCharacterLoadoutId ?? 0);

            if (restored) {
                if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
                return;
            }
        }
    } catch (error) {
        console.error('[MissingMats] Enhancing native restore failed:', error);
    }

    console.error('[MissingMats] Enhancing Return could not restore all captured controls');
    if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
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
        invalidStateGraceMs: MARKETPLACE_REMOUNT_GRACE_MS,
        onTabsGone: () => {
            const capturedSessionId = activeWorkflowModel?.sessionId ?? null;
            if (capturedSessionId !== null && !marketplaceSession.isActive(capturedSessionId)) return;
            const tabContainer = getVisibleMarketplaceTabContainer();
            if (
                tabContainer &&
                isMarketplaceMarketListingsSelected(tabContainer) &&
                reinjectActionsMarketplaceTabs(tabContainer)
            ) {
                return;
            }
            if (capturedSessionId !== null) marketplaceSession.end(capturedSessionId);
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

    if (nativeTabExitCleanup) {
        nativeTabExitCleanup();
        nativeTabExitCleanup = null;
    }

    const sessionIdToExit = actionsSessionId ?? activeWorkflowModel?.sessionId ?? null;
    autofillManager.exitSession(sessionIdToExit);

    actionsSessionId = null;
    activeWorkflowModel = null;
}

/**
 * Rebuild ACTIONS marketplace tabs from the current activeWorkflowModel.
 * Called when the cleanup observer detects that our tabs disappeared but the
 * marketplace panel is still visible (e.g. a React re-render wiped them).
 * @param {HTMLElement} tabContainer
 */
function reinjectActionsMarketplaceTabs(tabContainer) {
    const model = activeWorkflowModel;
    if (!model || !marketplaceSession.isActive(model.sessionId)) return false;
    const strategyInfo = model.returnContext?.enhancementContext?.strategyInfo ?? null;
    return createMissingMaterialTabs(model.materials, strategyInfo, model.sessionId, tabContainer);
}

/**
 * Create custom tabs for missing materials
 * @param {Array} missingMaterials - Array of missing material objects
 * @param {Object|null} strategyInfo - Auto-calculated protection strategy info
 * @param {number} sessionId - The marketplaceSession token for this workflow
 */
function createMissingMaterialTabs(missingMaterials, strategyInfo = null, sessionId = null, tabContainer = null) {
    const tabsContainer = tabContainer || getVisibleMarketplaceTabContainer();
    if (!tabsContainer || !marketplaceSession.isActive(sessionId)) {
        console.error('[MissingMats] Visible Marketplace tabs container not found');
        return false;
    }

    removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);
    currentMaterialsTabs.length = 0;

    const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));
    if (!referenceTab) {
        console.error('[MissingMats] Reference tab not found');
        return false;
    }

    tabsContainer.style.flexWrap = 'wrap';

    nativeTabExitCleanup?.();
    nativeTabExitCleanup = watchNativeTabExit(tabsContainer, () => {
        marketplaceSession.end(sessionId);
    });

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

    const returnContext = activeWorkflowModel?.returnContext ?? null;
    const returnTab = createReturnTab(referenceTab, returnContext);
    if (returnTab) {
        tabsContainer.appendChild(returnTab);
        currentMaterialsTabs.push(returnTab);
    }

    return true;
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

    if (!activeWorkflowModel) return;
    const updatedByHrid = new Map(updatedMaterials.map((material) => [material.itemHrid, material]));
    for (const modelEntry of activeWorkflowModel.materials) {
        const updated = updatedByHrid.get(modelEntry.itemHrid);
        if (updated) Object.assign(modelEntry, updated);
        else modelEntry.missing = 0;
    }

    const connectedTabs = Array.from(
        document.querySelectorAll(
            `[data-mwi-custom-tab][data-mwi-tab-owner="${MARKETPLACE_OWNER.ACTIONS}"][data-item-hrid]`
        )
    );
    for (const tab of connectedTabs) {
        const material = activeWorkflowModel.materials.find(
            (entry) => entry.itemHrid === tab.getAttribute('data-item-hrid')
        );
        if (material) updateTabBadge(tab, material);
    }
}

/**
 * Handle marketplace cleanup (when leaving marketplace)
 * Called by the marketplace cleanup observer
 */
function handleMarketplaceCleanup() {
    const sessionId = actionsSessionId ?? activeWorkflowModel?.sessionId ?? null;
    if (sessionId !== null && marketplaceSession.isActive(sessionId)) {
        marketplaceSession.end(sessionId);
        return;
    }
    teardownActionsMarketplaceSession();
}

export default {
    initialize,
    cleanup,
};
