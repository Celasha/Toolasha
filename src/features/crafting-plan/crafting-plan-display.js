/**
 * Crafting Plan Display
 * Renders the buy-vs-craft decision tree in action panels.
 * Shows a summary comparison plus a shopping list of materials to buy.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import { computeBestCraftingPlan } from './crafting-plan-calculator.js';
import { computeInventoryAwareMissingMaterials } from './inventory-aware-fulfillment.js';
import {
    collectCraftSteps,
    calculateCraftingPlanMetrics,
    formatCraftingPlanSummary,
    renderCraftingPlanBreakdown,
} from './crafting-plan-tree-renderer.js';
import { ARTISAN_MATERIAL_MODE, getArtisanMaterialMode } from '../../utils/material-calculator.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';
import { getPricingMode as resolveMarketPricingMode } from '../../utils/market-data.js';
import { findActionInput, attachInputListeners } from '../../utils/action-panel-helper.js';
import {
    createMaterialTab,
    removeMaterialTabsForOwner,
    getVisibleMarketplaceTabContainer,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
    updateTabBadge,
    watchNativeTabExit,
    clickMarketplaceNavigationButton,
    MARKETPLACE_REMOUNT_GRACE_MS,
    isMarketplaceMarketListingsSelected,
} from '../../utils/marketplace-tabs.js';
import { createAutofillManager } from '../../utils/marketplace-autofill.js';
import { compactActionPanelSection } from '../actions/production-tools-layout.js';

export { calculateCraftingPlanMetrics, formatCraftingPlanSummary };

const UI_ID = 'mwi-crafting-plan';

const PRICING_MODES = [
    { value: 'conservative', label: 'Instant Buy' },
    { value: 'hybrid', label: 'Instant Buy / Patient Sell' },
    { value: 'optimistic', label: 'Patient Buy / Patient Sell' },
    { value: 'patientBuy', label: 'Patient Buy' },
];
const ARTISAN_MODES = [
    { value: ARTISAN_MATERIAL_MODE.EXPECTED, label: 'Expected' },
    { value: ARTISAN_MATERIAL_MODE.WORST_CASE, label: 'Worst-case' },
    { value: ARTISAN_MATERIAL_MODE.HYBRID, label: 'Hybrid' },
];
const craftingPlanTabs = [];
let cleanupObserver = null;
let nativeTabExitCleanup = null;
const autofillManager = createAutofillManager('CraftingPlan');
let activeWorkflowModel = null;
let craftingPlanSessionId = null;
let inventoryUpdateHandler = null;

const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

/**
 * Get action HRID from panel element.
 * @param {HTMLElement} panel
 * @returns {string|null}
 */
function getActionHridFromPanel(panel) {
    const nameEl = panel.querySelector('[class*="SkillActionDetail_name"]');
    if (!nameEl) return null;
    const actionName = Array.from(nameEl.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
        .trim();
    return getActionHridFromName(actionName);
}

/**
 * Get the primary output item for an action.
 * @param {Object} actionDetail
 * @returns {{ itemHrid: string, count: number }|null}
 */
function getPrimaryOutput(actionDetail) {
    if (!actionDetail?.outputItems?.length) return null;
    return actionDetail.outputItems[0];
}

/**
 * Get the raw profit-pricing-mode setting value (conservative/hybrid/optimistic/patientBuy),
 * used only to drive the Pricing pill's label/cycling. Actual price lookups must resolve this
 * to a concrete ask/bid string via `resolveMarketPricingMode` — passing this raw value straight
 * into `getItemPrice` fails its ask/bid/average validation and silently falls back to ask.
 * @returns {string}
 */
function getProfitPricingModeSetting() {
    return config.getSettingValue('profitCalc_pricingMode', 'hybrid');
}

/**
 * Create a small clickable pill row for cycling through a mode setting (Pricing, Artisan mode).
 * @param {string} label
 * @param {string} currentLabel
 * @param {Function} onClick
 * @param {string} [title] - Optional tooltip explaining the setting
 * @returns {HTMLElement}
 */
function createModePillRow(label, currentLabel, onClick, title = '') {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        margin-bottom: 4px;
    `;
    if (title) row.title = title;
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const btn = document.createElement('button');
    btn.textContent = currentLabel;
    btn.style.cssText = `
        font-size: 0.85em;
        padding: 1px 6px;
        background: var(--bg-color-tertiary, #1a1a1a);
        color: var(--text-color-secondary, #ccc);
        border: 1px solid var(--border-color, #444);
        border-radius: 3px;
        cursor: pointer;
    `;
    btn.addEventListener('click', onClick);
    row.appendChild(labelEl);
    row.appendChild(btn);
    return row;
}

/**
 * Build the full crafting plan UI for an action.
 * @param {string} actionHrid
 * @param {HTMLElement} panel - The action detail panel (used to read the quantity input)
 * @param {Function} [onToggle] - Callback when buy-intermediates toggle changes
 * @param {boolean} [defaultOpen=false] - Whether the section should be open
 * @returns {HTMLElement|null}
 */
function buildPlanUI(actionHrid, panel, onToggle, defaultOpen = false) {
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData?.actionDetailMap?.[actionHrid];
    if (!actionDetail) return null;

    // Only production actions
    if (!PRODUCTION_TYPES.includes(actionDetail.type)) return null;

    const output = getPrimaryOutput(actionDetail);
    if (!output) return null;

    const pricingModeSetting = getProfitPricingModeSetting();
    const mode = resolveMarketPricingMode('profit', 'buy');
    const artisanMode = getArtisanMaterialMode();
    const matchQuantity = config.getSetting('actionPanel_craftingPlanMatchQuantity');
    const buyIntermediates = config.getSetting('actionPanel_craftingPlanBuyIntermediates');
    const noProcessing = config.getSetting('actionPanel_craftingPlanNoProcessing');
    const taskMode = config.getSetting('actionPanel_craftingPlanTaskMode');
    const timeCostEnabled = config.getSetting('actionPanel_craftingPlanTimeCost');
    const goldPerHour = Number(config.getSettingValue('actionPanel_craftingPlanGoldPerHour', 0)) || 0;

    let requestedQuantity = 1;
    if (matchQuantity) {
        const inputField = findActionInput(panel);
        const parsed = parseInt(inputField?.value, 10);
        requestedQuantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }

    let plan;
    try {
        plan = computeBestCraftingPlan(
            output.itemHrid,
            requestedQuantity,
            mode,
            new Set(),
            new Map(),
            0,
            undefined,
            buyIntermediates,
            taskMode,
            timeCostEnabled ? goldPerHour : 0,
            noProcessing
        );
    } catch (e) {
        console.error('[CraftingPlan] computeBestCraftingPlan error:', e);
        return null;
    }

    // Don't show if item has no production recipe (true raw material)
    if (plan.craftCost === null) return null;

    const craftSteps = [];
    collectCraftSteps(plan, craftSteps);
    const craftMetrics =
        plan.strategy === 'craft' && craftSteps.length > 0
            ? calculateCraftingPlanMetrics(craftSteps)
            : { steps: [], totalCraftSeconds: 0, totalXP: 0 };

    // Build content
    const content = document.createElement('div');

    // === Summary comparison ===
    const unitCostText = plan.unitCost === Infinity ? '?' : formatWithSeparator(Math.round(plan.unitCost));
    const buyText = plan.buyPrice !== null ? formatWithSeparator(Math.round(plan.buyPrice)) : 'N/A';
    const craftText = plan.craftCost !== null ? formatWithSeparator(Math.round(plan.craftCost)) : 'N/A';
    const strategyText = plan.strategy === 'buy' ? 'Buy from market' : 'Craft from materials';
    const quantityRow =
        requestedQuantity > 1 && plan.unitCost !== Infinity
            ? `<div style="display: flex; justify-content: space-between; color: var(--text-color-secondary, #888); font-size: 0.9em;">
                   <span>Quantity: ${formatWithSeparator(requestedQuantity)}</span>
                   <span>Total: ${formatWithSeparator(Math.round(plan.totalCost))}</span>
               </div>`
            : '';

    const summary = document.createElement('div');
    summary.style.cssText = 'margin-bottom: 6px;';
    summary.innerHTML = `
        <div style="display: flex; justify-content: space-between; color: var(--text-color-primary, #fff);">
            <span>Optimal: <strong>${strategyText}</strong></span>
            <span>${unitCostText}/ea</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: var(--text-color-secondary, #888); font-size: 0.9em;">
            <span>Market buy: ${buyText}</span>
            <span>Craft cost: ${craftText}</span>
        </div>
        ${quantityRow}
    `;
    content.appendChild(summary);

    // === Pricing mode toggle ===
    const currentMode = PRICING_MODES.find((m) => m.value === pricingModeSetting) || PRICING_MODES[0];
    content.appendChild(
        createModePillRow('Pricing:', currentMode.label, () => {
            const idx = PRICING_MODES.findIndex((m) => m.value === pricingModeSetting);
            const next = PRICING_MODES[(idx + 1) % PRICING_MODES.length];
            config.setSettingValue('profitCalc_pricingMode', next.value);
            if (onToggle) onToggle();
        })
    );

    // === Artisan material mode toggle ===
    const currentArtisanMode = ARTISAN_MODES.find((m) => m.value === artisanMode) || ARTISAN_MODES[0];
    content.appendChild(
        createModePillRow(
            'Artisan mode:',
            currentArtisanMode.label,
            () => {
                const idx = ARTISAN_MODES.findIndex((m) => m.value === artisanMode);
                const next = ARTISAN_MODES[(idx + 1) % ARTISAN_MODES.length];
                config.setSettingValue('actions_artisanMaterialMode', next.value);
                if (onToggle) onToggle();
            },
            'How Artisan Tea savings are rounded into material quantities:\n' +
                'Expected — pools the savings across the whole batch (average, may run short on a bad action).\n' +
                'Worst-case — rounds up every single action before multiplying (safest, may over-buy).\n' +
                'Hybrid — worst-case under 100 actions, expected at 100+.'
        )
    );

    // === Match action quantity toggle ===
    const matchQuantityRow = document.createElement('label');
    matchQuantityRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        cursor: pointer;
        margin-bottom: 4px;
    `;
    const matchQuantityCheckbox = document.createElement('input');
    matchQuantityCheckbox.type = 'checkbox';
    matchQuantityCheckbox.checked = matchQuantity;
    matchQuantityCheckbox.style.cssText = 'margin: 0; cursor: pointer;';
    matchQuantityCheckbox.addEventListener('change', () => {
        config.setSetting('actionPanel_craftingPlanMatchQuantity', matchQuantityCheckbox.checked);
        if (onToggle) onToggle();
    });
    matchQuantityRow.appendChild(matchQuantityCheckbox);
    matchQuantityRow.appendChild(document.createTextNode('Match action panel quantity'));
    content.appendChild(matchQuantityRow);

    // === Buy intermediates toggle ===
    const toggleRow = document.createElement('label');
    toggleRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        cursor: pointer;
        margin-bottom: 4px;
    `;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = buyIntermediates;
    checkbox.style.cssText = 'margin: 0; cursor: pointer;';
    checkbox.addEventListener('change', () => {
        config.setSetting('actionPanel_craftingPlanBuyIntermediates', checkbox.checked);
        if (onToggle) onToggle();
    });
    toggleRow.appendChild(checkbox);
    toggleRow.appendChild(document.createTextNode('Buy raw materials only'));
    content.appendChild(toggleRow);

    // === No processing toggle ===
    const noProcessingRow = document.createElement('label');
    noProcessingRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        cursor: pointer;
        margin-bottom: 4px;
    `;
    const noProcessingCheckbox = document.createElement('input');
    noProcessingCheckbox.type = 'checkbox';
    noProcessingCheckbox.checked = noProcessing;
    noProcessingCheckbox.style.cssText = 'margin: 0; cursor: pointer;';
    noProcessingCheckbox.addEventListener('change', () => {
        config.setSetting('actionPanel_craftingPlanNoProcessing', noProcessingCheckbox.checked);
        if (onToggle) onToggle();
    });
    noProcessingRow.appendChild(noProcessingCheckbox);
    noProcessingRow.appendChild(document.createTextNode('No processing (buy intermediates)'));
    content.appendChild(noProcessingRow);

    // === Task mode toggle ===
    const taskToggleRow = document.createElement('label');
    taskToggleRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        cursor: pointer;
        margin-bottom: 4px;
    `;
    const taskCheckbox = document.createElement('input');
    taskCheckbox.type = 'checkbox';
    taskCheckbox.checked = taskMode;
    taskCheckbox.style.cssText = 'margin: 0; cursor: pointer;';
    taskCheckbox.addEventListener('change', () => {
        config.setSetting('actionPanel_craftingPlanTaskMode', taskCheckbox.checked);
        if (onToggle) onToggle();
    });
    taskToggleRow.appendChild(taskCheckbox);
    taskToggleRow.appendChild(document.createTextNode('Task mode (force last step)'));
    content.appendChild(taskToggleRow);

    // === Time cost toggle ===
    const timeCostRow = document.createElement('label');
    timeCostRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        cursor: pointer;
        margin-bottom: 4px;
    `;
    const timeCostCheckbox = document.createElement('input');
    timeCostCheckbox.type = 'checkbox';
    timeCostCheckbox.checked = timeCostEnabled;
    timeCostCheckbox.style.cssText = 'margin: 0; cursor: pointer;';
    timeCostRow.appendChild(timeCostCheckbox);
    timeCostRow.appendChild(document.createTextNode('Factor in time cost'));

    const goldInput = document.createElement('input');
    goldInput.type = 'number';
    goldInput.value = goldPerHour || '';
    goldInput.placeholder = '500000';
    goldInput.style.cssText = `
        width: 80px; margin-left: auto; padding: 2px 4px;
        background: var(--input-bg, #1a1a2e); border: 1px solid var(--border-color, #333);
        border-radius: 3px; color: var(--text-color-primary, #fff); font-size: 0.85em;
    `;
    goldInput.style.display = timeCostEnabled ? '' : 'none';
    const goldLabel = document.createElement('span');
    goldLabel.textContent = 'gold/hr';
    goldLabel.style.fontSize = '0.85em';
    goldLabel.style.display = timeCostEnabled ? '' : 'none';

    timeCostCheckbox.addEventListener('change', () => {
        config.setSetting('actionPanel_craftingPlanTimeCost', timeCostCheckbox.checked);
        goldInput.style.display = timeCostCheckbox.checked ? '' : 'none';
        goldLabel.style.display = timeCostCheckbox.checked ? '' : 'none';
        if (onToggle) onToggle();
    });
    goldInput.addEventListener('change', () => {
        config.setSettingValue('actionPanel_craftingPlanGoldPerHour', parseInt(goldInput.value) || 0);
        if (onToggle) onToggle();
    });

    timeCostRow.appendChild(goldInput);
    timeCostRow.appendChild(goldLabel);
    content.appendChild(timeCostRow);

    // Only show breakdown if crafting is the optimal strategy
    if (plan.strategy !== 'craft' || plan.children.length === 0) {
        const costText = formatCraftingPlanSummary(plan, craftMetrics.totalCraftSeconds);
        const section = createCollapsibleSection('', 'Best Crafting Plan', costText, content, defaultOpen, 0);
        section.id = UI_ID;
        section.className = 'mwi-crafting-plan-section';
        return compactActionPanelSection(section);
    }

    // === Shopping List + Crafting Steps (shared renderer, also used by Combat Stats) ===
    const breakdown = renderCraftingPlanBreakdown(plan, {
        craftMetrics,
        onShoppingListRendered: (shoppingListContainer) => {
            const divider = document.createElement('div');
            divider.style.cssText = 'border-top: 1px solid var(--border-color, #333); margin: 6px 0;';
            content.appendChild(divider);
            content.appendChild(shoppingListContainer);

            // === Buy Missing Materials button ===
            const buyButton = document.createElement('button');
            buyButton.type = 'button';
            buyButton.textContent = 'Buy Missing Materials';
            buyButton.style.cssText = `
                width: 100%; margin-top: 6px; padding: 6px;
                background: linear-gradient(135deg, #1e40af, #3b82f6);
                border: 1px solid #60a5fa; border-radius: 4px;
                color: white; cursor: pointer; font-size: 0.85em;
            `;
            buyButton.addEventListener('click', async () => {
                let capturedSessionId = null;
                try {
                    const panel = buyButton.closest('[class*="SkillActionDetail_skillActionDetail"]');
                    const inputField = findActionInput(panel);
                    const numActions = parseInt(inputField?.value) || 1;
                    const outputCount = output.count || 1;

                    const fulfillment = computeInventoryAwareMissingMaterials({
                        rootActionHrid: actionHrid,
                        rootItemHrid: output.itemHrid,
                        rootOutputCount: outputCount,
                        numActions,
                        mode,
                        buyRawOnly: buyIntermediates,
                        forceRootCraft: taskMode,
                        timeCostPerHour: timeCostEnabled ? goldPerHour : 0,
                        skipProcessing: noProcessing,
                    });
                    const missingMaterials = fulfillment.filter(
                        (material) => material.isTradeable && material.missing > 0
                    );

                    if (missingMaterials.length === 0) return;

                    // Claim session before the first await.
                    capturedSessionId = marketplaceSession.start({
                        owner: MARKETPLACE_OWNER.CRAFTING_PLAN,
                        onEnd: teardownCraftingPlanMarketplaceSession,
                    });
                    craftingPlanSessionId = capturedSessionId;

                    const success = await openCraftingPlanMarketplace(capturedSessionId);
                    if (!success) {
                        marketplaceSession.end(capturedSessionId);
                        return;
                    }
                    if (!marketplaceSession.isActive(capturedSessionId)) return;

                    activeWorkflowModel = {
                        sessionId: capturedSessionId,
                        materials: missingMaterials.map((material) => ({ ...material })),
                        returnContext: { actionHrid, numActions },
                    };
                    autofillManager.startSession({ sessionId: capturedSessionId });

                    await new Promise((resolve) => setTimeout(resolve, 200));
                    if (!marketplaceSession.isActive(capturedSessionId)) return;
                    if (!createCraftingPlanTabs(activeWorkflowModel.materials, null, capturedSessionId)) {
                        marketplaceSession.end(capturedSessionId);
                        return;
                    }

                    const firstMaterial = activeWorkflowModel.materials.find(
                        (material) => material.isTradeable !== false && material.missing > 0
                    );
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
                            return (
                                model.materials.find((entry) => entry.itemHrid === firstMaterial.itemHrid)?.missing ?? 0
                            );
                        },
                    });
                    if (!armed) {
                        marketplaceSession.end(capturedSessionId);
                        return;
                    }
                    if (!navigateToMarketplace(firstMaterial.itemHrid, 0)) {
                        marketplaceSession.end(capturedSessionId);
                        return;
                    }

                    // Only arm the cleanup/exit observer once our own initial navigation has been
                    // initiated, so it can never see a retained pre-workflow "My Listings" state.
                    setupCraftingPlanCleanupObserver(capturedSessionId);

                    if (inventoryUpdateHandler) dataManager.off('items_updated', inventoryUpdateHandler);
                    inventoryUpdateHandler = () => {
                        const model = activeWorkflowModel;
                        if (
                            !model ||
                            model.sessionId !== capturedSessionId ||
                            !marketplaceSession.isActive(capturedSessionId)
                        ) {
                            return;
                        }

                        const currentInventory = dataManager.getInventory() || [];
                        for (const material of model.materials) {
                            const have = currentInventory
                                .filter(
                                    (inventoryItem) =>
                                        inventoryItem.itemHrid === material.itemHrid &&
                                        inventoryItem.itemLocationHrid === '/item_locations/inventory' &&
                                        !inventoryItem.enhancementLevel
                                )
                                .reduce((sum, item) => sum + (item.count || 0), 0);
                            material.missing = Math.max(0, material.required - have);
                        }

                        const connectedTabs = document.querySelectorAll(
                            `[data-mwi-custom-tab][data-mwi-tab-owner="${MARKETPLACE_OWNER.CRAFTING_PLAN}"][data-item-hrid]`
                        );
                        for (const tab of connectedTabs) {
                            const material = model.materials.find(
                                (entry) => entry.itemHrid === tab.getAttribute('data-item-hrid')
                            );
                            if (material) updateTabBadge(tab, material);
                        }
                    };
                    dataManager.on('items_updated', inventoryUpdateHandler);
                } catch (error) {
                    console.error('[CraftingPlan] Missing-materials workflow failed:', error);
                    if (capturedSessionId !== null && marketplaceSession.isActive(capturedSessionId)) {
                        marketplaceSession.end(capturedSessionId);
                    }
                }
            });
            shoppingListContainer.appendChild(buyButton);
        },
    });
    if (breakdown.children.length > 0) {
        const divider = document.createElement('div');
        divider.style.cssText = 'border-top: 1px solid var(--border-color, #333); margin: 6px 0;';
        content.appendChild(divider);
        content.appendChild(breakdown);
    }

    const costText = formatCraftingPlanSummary(plan, craftMetrics.totalCraftSeconds);
    const section = createCollapsibleSection('', 'Best Crafting Plan', costText, content, defaultOpen, 0);
    section.id = UI_ID;
    section.className = 'mwi-crafting-plan-section';
    compactActionPanelSection(section);

    return section;
}

/**
 * Navigate to the marketplace and wait for the tablist to appear.
 * @returns {Promise<boolean>} True if navigation succeeded
 */
async function openCraftingPlanMarketplace(sessionId) {
    if (!marketplaceSession.isActive(sessionId) || !clickMarketplaceNavigationButton()) return false;

    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (!marketplaceSession.isActive(sessionId)) return false;
        if (getVisibleMarketplaceTabContainer()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}

/**
 * Idempotent teardown for the crafting plan marketplace session.
 */
function teardownCraftingPlanMarketplaceSession() {
    const sessionId = craftingPlanSessionId ?? activeWorkflowModel?.sessionId ?? null;
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.CRAFTING_PLAN);
    craftingPlanTabs.length = 0;

    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }
    cleanupObserver?.();
    cleanupObserver = null;
    nativeTabExitCleanup?.();
    nativeTabExitCleanup = null;

    autofillManager.exitSession(sessionId);
    craftingPlanSessionId = null;
    activeWorkflowModel = null;
}

function getGameObject() {
    const root = document.getElementById('root');
    const rootFiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
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

function createCraftingPlanReturnTab(referenceTab, returnContext, sessionId) {
    const actionDetail = dataManager.getActionDetails(returnContext.actionHrid);
    const actionName = actionDetail?.name || returnContext.actionHrid.split('/').pop();
    const displayName = `${actionName} (×${formatWithSeparator(returnContext.numActions)})`;

    const tab = referenceTab.cloneNode(true);
    tab.setAttribute('data-mwi-custom-tab', 'true');
    tab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.CRAFTING_PLAN);
    // A custom tab must not duplicate the native tab/panel identity.
    tab.removeAttribute('id');
    tab.removeAttribute('aria-controls');
    tab.removeAttribute('data-item-hrid');
    tab.removeAttribute('data-missing-quantity');
    tab.classList.remove('Mui-selected');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');
    tab.setAttribute('aria-disabled', 'false');
    tab.style.cursor = 'pointer';
    tab.style.opacity = '1';

    const badge = tab.querySelector('[class*="TabsComponent_badge"]');
    if (badge) {
        badge.innerHTML = `
            <div style="text-align: center;">
                <div>↩ Return</div>
                <div style="font-size: 0.75em; color: #60a5fa;">${displayName}</div>
            </div>
        `;
    }

    tab.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!marketplaceSession.isActive(sessionId)) return;
        const game = getGameObject();
        if (!game) {
            marketplaceSession.end(sessionId);
            return;
        }
        try {
            game.handleGoToAction(returnContext.actionHrid, returnContext.numActions || undefined);
        } catch (error) {
            console.error('[CraftingPlan] Return navigation failed:', error);
        } finally {
            marketplaceSession.end(sessionId);
        }
    });
    return tab;
}

function reinjectCraftingPlanMarketplaceTabs(tabContainer) {
    const model = activeWorkflowModel;
    if (!model || !marketplaceSession.isActive(model.sessionId)) return false;
    return createCraftingPlanTabs(model.materials, tabContainer, model.sessionId);
}

function createCraftingPlanTabs(missingMaterials, tabsContainer = null, sessionId = craftingPlanSessionId) {
    const container = tabsContainer || getVisibleMarketplaceTabContainer();
    if (!container || !marketplaceSession.isActive(sessionId)) return false;

    removeMaterialTabsForOwner(MARKETPLACE_OWNER.CRAFTING_PLAN);
    craftingPlanTabs.length = 0;

    const referenceTab = Array.from(container.children).find((tab) => tab.textContent.includes('My Listings'));
    if (!referenceTab) return false;
    container.style.flexWrap = 'wrap';

    nativeTabExitCleanup?.();
    nativeTabExitCleanup = watchNativeTabExit(container, () => marketplaceSession.end(sessionId));

    for (const material of missingMaterials) {
        const tabRef = { tab: null };
        // activeWorkflowModel (read inside quantityProvider below) is module-level state,
        // not a per-iteration loop variable — this intentionally reads its live value when
        // the quantity provider is invoked later, not a stale snapshot from loop creation.
        // eslint-disable-next-line no-loop-func
        const handler = () => {
            if (!marketplaceSession.isActive(sessionId)) return;
            const liveMissing = Number.parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10);
            if (!Number.isFinite(liveMissing) || liveMissing <= 0 || material.isTradeable === false) return;
            const armed = autofillManager.arm({
                sessionId,
                itemHrid: material.itemHrid,
                enhancementLevel: 0,
                modalMode: 'buy',
                quantityProvider: () => {
                    const model = activeWorkflowModel;
                    if (model?.sessionId !== sessionId) return 0;
                    return model.materials.find((entry) => entry.itemHrid === material.itemHrid)?.missing ?? 0;
                },
            });
            if (!armed || !navigateToMarketplace(material.itemHrid, 0)) marketplaceSession.end(sessionId);
        };
        const tab = createMaterialTab(material, referenceTab, handler, MARKETPLACE_OWNER.CRAFTING_PLAN);
        tabRef.tab = tab;
        container.appendChild(tab);
        craftingPlanTabs.push(tab);
    }

    if (activeWorkflowModel?.returnContext) {
        const returnTab = createCraftingPlanReturnTab(referenceTab, activeWorkflowModel.returnContext, sessionId);
        container.appendChild(returnTab);
        craftingPlanTabs.push(returnTab);
    }

    return true;
}

/**
 * Arm the cleanup/exit observer for the CRAFTING_PLAN owner. Must only be called after this
 * workflow's own initial navigation to the first missing material has been initiated — arming
 * it any earlier lets it see a retained native "My Listings" state from before the workflow
 * started and tear the session down mid-initialization. Safe to call multiple times: stops any
 * existing observer before creating a new one.
 * @param {number} sessionId
 */
function setupCraftingPlanCleanupObserver(sessionId) {
    cleanupObserver?.();
    cleanupObserver = setupMarketplaceCleanupObserver({
        owner: MARKETPLACE_OWNER.CRAFTING_PLAN,
        invalidStateGraceMs: MARKETPLACE_REMOUNT_GRACE_MS,
        onTabsGone: () => {
            if (!marketplaceSession.isActive(sessionId)) return;
            const visibleContainer = getVisibleMarketplaceTabContainer();
            if (
                visibleContainer &&
                isMarketplaceMarketListingsSelected(visibleContainer) &&
                reinjectCraftingPlanMarketplaceTabs(visibleContainer)
            ) {
                return;
            }
            marketplaceSession.end(sessionId);
        },
    });
}

class CraftingPlanDisplay {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
        this.processedPanels = new WeakSet();
        this.panelObservers = new Map();
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('actionPanel_bestCraftingPlan')) return;

        this.isInitialized = true;
        autofillManager.initialize();

        const unregister = domObserver.onClass('CraftingPlan', 'SkillActionDetail_skillActionDetail', () =>
            this._processActionPanels()
        );
        this.unregisterHandlers.push(unregister);
    }

    _processActionPanels() {
        document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]').forEach((panel) => {
            if (this.processedPanels.has(panel)) return;

            const actionHrid = getActionHridFromPanel(panel);
            if (!actionHrid) return;

            this.processedPanels.add(panel);
            this._attachToPanel(panel, actionHrid);
        });
    }

    _attachToPanel(panel, actionHrid) {
        const rebuild = () => {
            const existing = panel.querySelector(`#${UI_ID}`);
            const wasOpen = existing?.querySelector('.mwi-section-header span')?.textContent === '▼';
            if (existing) existing.remove();

            const newUI = buildPlanUI(actionHrid, panel, rebuild, wasOpen);
            if (!newUI) return;

            const profitSection = panel.querySelector('[data-mwi-profit-display]');
            if (profitSection) {
                profitSection.parentNode.insertBefore(newUI, profitSection);
            } else {
                panel.appendChild(newUI);
            }
        };

        const ui = buildPlanUI(actionHrid, panel, rebuild);
        if (!ui) return;

        const inputField = findActionInput(panel);
        if (inputField) attachInputListeners(panel, inputField, () => rebuild());

        const position = () => {
            const existing = panel.querySelector(`#${UI_ID}`);
            // Insert before Profitability section
            const profitSection = panel.querySelector('[data-mwi-profit-display]');

            if (profitSection) {
                if (existing) {
                    if (existing.nextElementSibling !== profitSection) {
                        profitSection.parentNode.insertBefore(existing, profitSection);
                    }
                } else {
                    profitSection.parentNode.insertBefore(ui, profitSection);
                }
                return;
            }

            // Fallback: append to panel
            if (!existing) panel.appendChild(ui);
        };

        position();

        // Watch for profit section or crafting plan being added/removed
        const observeTarget = ui.parentNode || panel;
        const obs = new MutationObserver((mutations) => {
            const relevant = mutations.some((m) =>
                [...m.addedNodes, ...m.removedNodes].some(
                    (n) => n.id === UI_ID || (n.getAttribute && n.getAttribute('data-mwi-profit-display'))
                )
            );
            if (relevant) position();
        });
        obs.observe(observeTarget, { childList: true, subtree: true });
        this.panelObservers.set(panel, obs);
    }

    disable() {
        const sessionId = craftingPlanSessionId ?? activeWorkflowModel?.sessionId ?? null;
        if (sessionId !== null && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
        else teardownCraftingPlanMarketplaceSession();

        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];

        document.querySelectorAll(`#${UI_ID}`).forEach((el) => el.remove());

        // Disconnect panel observers
        this.panelObservers.forEach((obs) => obs.disconnect());
        this.panelObservers = new Map();
        this.processedPanels = new WeakSet();
        this.isInitialized = false;
    }
}

const craftingPlanDisplay = new CraftingPlanDisplay();
export default craftingPlanDisplay;
