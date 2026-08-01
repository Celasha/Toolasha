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
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { formatKMB, formatWithSeparator, timeReadable } from '../../utils/formatters.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';
import { findActionInput } from '../../utils/action-panel-helper.js';
import {
    createMaterialTab,
    removeMaterialTabsForOwner,
    getVisibleMarketplaceTabContainer,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
    updateTabBadge,
} from '../../utils/marketplace-tabs.js';
import { createAutofillManager } from '../../utils/marketplace-autofill.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import { calculateEfficiencyMultiplier } from '../../utils/efficiency.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';

const UI_ID = 'mwi-crafting-plan';

const PRICING_MODES = [
    { value: 'conservative', label: 'Instant Buy' },
    { value: 'hybrid', label: 'Instant Buy / Patient Sell' },
    { value: 'optimistic', label: 'Patient Buy / Patient Sell' },
    { value: 'patientBuy', label: 'Patient Buy' },
];
const craftingPlanTabs = [];
let cleanupObserver = null;
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
 * Get the pricing mode from user settings.
 * @returns {string}
 */
function getPricingMode() {
    return config.getSetting('profitCalc_pricingMode') || 'ask';
}

/**
 * Collect all leaf "buy" items from the plan tree into a flat shopping list.
 * Aggregates quantities for the same item across branches.
 * @param {Object} node - CraftingPlanNode
 * @param {Map} buyItems - Map of itemHrid → { itemName, quantity, unitCost, totalCost }
 */
function collectBuyItems(node, buyItems) {
    if (node.strategy === 'buy') {
        const existing = buyItems.get(node.itemHrid);
        if (existing) {
            existing.quantity += node.quantity;
            existing.totalCost += node.totalCost;
        } else {
            buyItems.set(node.itemHrid, {
                itemName: node.itemName,
                quantity: node.quantity,
                unitCost: node.unitCost,
                totalCost: node.totalCost,
            });
        }
        return;
    }

    for (const child of node.children) {
        collectBuyItems(child, buyItems);
    }
}

/**
 * Collect all "craft" steps from the plan tree.
 * @param {Object} node - CraftingPlanNode
 * @param {Array} craftSteps - Array to collect craft steps into
 */
function collectCraftSteps(node, craftSteps) {
    // Depth-first: collect children first so deepest crafts appear first
    for (const child of node.children) {
        collectCraftSteps(child, craftSteps);
    }

    if (node.strategy === 'craft' && node.actionHrid) {
        craftSteps.push({
            itemName: node.itemName,
            quantity: Math.ceil(node.quantity),
            actionsNeeded: node.actionsNeeded,
            actionHrid: node.actionHrid,
        });
    }
}

/**
 * Create a styled row with left label and right value.
 * @param {string} leftText
 * @param {string} rightText
 * @param {Object} [options]
 * @returns {HTMLElement}
 */
function createRow(leftText, rightText, options = {}) {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 2px 0;
    `;

    const left = document.createElement('span');
    left.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    left.textContent = leftText;
    if (options.leftColor) left.style.color = options.leftColor;

    const right = document.createElement('span');
    right.style.cssText = 'flex-shrink: 0; white-space: nowrap;';
    right.textContent = rightText;
    if (options.rightColor) right.style.color = options.rightColor;

    row.appendChild(left);
    row.appendChild(right);
    return row;
}

/**
 * Build the full crafting plan UI for an action.
 * @param {string} actionHrid
 * @param {Function} [onToggle] - Callback when buy-intermediates toggle changes
 * @param {boolean} [defaultOpen=false] - Whether the section should be open
 * @returns {HTMLElement|null}
 */
function buildPlanUI(actionHrid, onToggle, defaultOpen = false) {
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData?.actionDetailMap?.[actionHrid];
    if (!actionDetail) return null;

    // Only production actions
    if (!PRODUCTION_TYPES.includes(actionDetail.type)) return null;

    const output = getPrimaryOutput(actionDetail);
    if (!output) return null;

    const mode = getPricingMode();
    const buyIntermediates = config.getSetting('actionPanel_craftingPlanBuyIntermediates');
    const noProcessing = config.getSetting('actionPanel_craftingPlanNoProcessing');
    const taskMode = config.getSetting('actionPanel_craftingPlanTaskMode');
    const timeCostEnabled = config.getSetting('actionPanel_craftingPlanTimeCost');
    const goldPerHour = config.getSetting('actionPanel_craftingPlanGoldPerHour') || 0;
    let plan;
    try {
        plan = computeBestCraftingPlan(
            output.itemHrid,
            1,
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

    // Build content
    const content = document.createElement('div');

    // === Summary comparison ===
    const unitCostText = plan.unitCost === Infinity ? '?' : formatWithSeparator(Math.round(plan.unitCost));
    const buyText = plan.buyPrice !== null ? formatWithSeparator(Math.round(plan.buyPrice)) : 'N/A';
    const craftText = plan.craftCost !== null ? formatWithSeparator(Math.round(plan.craftCost)) : 'N/A';
    const strategyText = plan.strategy === 'buy' ? 'Buy from market' : 'Craft from materials';

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
    `;
    content.appendChild(summary);

    // === Pricing mode toggle ===
    const currentMode = PRICING_MODES.find((m) => m.value === mode) || PRICING_MODES[0];
    const pricingRow = document.createElement('div');
    pricingRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        color: var(--text-color-secondary, #888);
        margin-bottom: 4px;
    `;
    const pricingLabel = document.createElement('span');
    pricingLabel.textContent = 'Pricing:';
    const pricingBtn = document.createElement('button');
    pricingBtn.textContent = currentMode.label;
    pricingBtn.style.cssText = `
        font-size: 0.85em;
        padding: 1px 6px;
        background: var(--bg-color-tertiary, #1a1a1a);
        color: var(--text-color-secondary, #ccc);
        border: 1px solid var(--border-color, #444);
        border-radius: 3px;
        cursor: pointer;
    `;
    pricingBtn.addEventListener('click', () => {
        const idx = PRICING_MODES.findIndex((m) => m.value === mode);
        const next = PRICING_MODES[(idx + 1) % PRICING_MODES.length];
        config.setSetting('profitCalc_pricingMode', next.value);
        if (onToggle) onToggle();
    });
    pricingRow.appendChild(pricingLabel);
    pricingRow.appendChild(pricingBtn);
    content.appendChild(pricingRow);

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
        config.setSetting('actionPanel_craftingPlanGoldPerHour', parseInt(goldInput.value) || 0);
        if (onToggle) onToggle();
    });

    timeCostRow.appendChild(goldInput);
    timeCostRow.appendChild(goldLabel);
    content.appendChild(timeCostRow);

    // Only show breakdown if crafting is the optimal strategy
    if (plan.strategy !== 'craft' || plan.children.length === 0) {
        const costText = plan.unitCost === Infinity ? '?' : `${formatKMB(Math.round(plan.unitCost))}/ea`;
        const section = createCollapsibleSection('', 'Best Crafting Plan', costText, content, defaultOpen, 0);
        section.id = UI_ID;
        section.className = 'mwi-crafting-plan-section';
        return section;
    }

    // === Shopping List (what to buy) ===
    const buyItems = new Map();
    collectBuyItems(plan, buyItems);

    if (buyItems.size > 0) {
        const divider = document.createElement('div');
        divider.style.cssText = 'border-top: 1px solid var(--border-color, #333); margin: 6px 0;';
        content.appendChild(divider);

        const shoppingHeader = document.createElement('div');
        shoppingHeader.style.cssText = `
            font-weight: 500;
            color: var(--text-color-primary, #fff);
            margin-bottom: 4px;
        `;
        shoppingHeader.textContent = 'Shopping List';
        content.appendChild(shoppingHeader);

        // Sort by total cost descending
        const sortedItems = [...buyItems.values()].sort((a, b) => b.totalCost - a.totalCost);

        for (const item of sortedItems) {
            const qty = Math.ceil(item.quantity);
            const cost = formatKMB(Math.round(item.totalCost));
            const unit = formatWithSeparator(Math.round(item.unitCost));
            content.appendChild(createRow(`${item.itemName} x${formatWithSeparator(qty)}`, `${cost} (${unit}/ea)`));
        }

        // Total buy cost
        const totalBuyCost = sortedItems.reduce((sum, item) => sum + item.totalCost, 0);
        const totalRow = createRow('Total material cost', formatWithSeparator(Math.round(totalBuyCost)), {
            leftColor: 'var(--text-color-primary, #fff)',
        });
        totalRow.style.borderTop = '1px solid var(--border-color, #333)';
        totalRow.style.marginTop = '4px';
        totalRow.style.paddingTop = '4px';
        content.appendChild(totalRow);

        // === Buy Missing Materials button ===
        const buyButton = document.createElement('button');
        buyButton.textContent = 'Buy Missing Materials';
        buyButton.style.cssText = `
            width: 100%; margin-top: 6px; padding: 6px;
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            border: 1px solid #60a5fa; border-radius: 4px;
            color: white; cursor: pointer; font-size: 0.85em;
        `;
        buyButton.addEventListener('click', async () => {
            const panel = buyButton.closest('[class*="SkillActionDetail_skillActionDetail"]');
            const inputField = findActionInput(panel);
            const numActions = parseInt(inputField?.value) || 1;
            const outputCount = output.count || 1;
            const totalQty = numActions * outputCount;
            const inventory = dataManager.getInventory() || [];

            const missingMaterials = [];
            for (const [itemHrid, item] of buyItems) {
                const needed = Math.ceil(item.quantity * totalQty);
                const have = inventory
                    .filter((i) => i.itemHrid === itemHrid && !i.enhancementLevel)
                    .reduce((sum, i) => sum + (i.count || 0), 0);
                const missing = Math.max(0, needed - have);
                const itemDetails = dataManager.getItemDetails(itemHrid);
                const isTradeable = itemDetails?.isTradable !== false;
                if (missing > 0 && isTradeable) {
                    missingMaterials.push({
                        itemHrid,
                        itemName: item.itemName,
                        missing,
                        required: needed,
                        isTradeable,
                    });
                }
            }

            if (missingMaterials.length === 0) return;

            // Claim session BEFORE first await
            craftingPlanSessionId = marketplaceSession.start({
                owner: MARKETPLACE_OWNER.CRAFTING_PLAN,
                onEnd: teardownCraftingPlanMarketplaceSession,
            });

            const success = await openCraftingPlanMarketplace();
            if (!success) {
                teardownCraftingPlanMarketplaceSession();
                return;
            }

            if (!marketplaceSession.isActive(craftingPlanSessionId)) return;

            activeWorkflowModel = {
                sessionId: craftingPlanSessionId,
                materials: missingMaterials.map((m) => ({ ...m })),
                returnContext: { actionHrid, numActions },
            };

            autofillManager.startSession({ sessionId: craftingPlanSessionId });

            await new Promise((resolve) => setTimeout(resolve, 200));
            createCraftingPlanTabs(missingMaterials);

            // Inventory listener to update tab badges when inventory changes
            if (inventoryUpdateHandler) {
                dataManager.off('items_updated', inventoryUpdateHandler);
            }
            inventoryUpdateHandler = () => {
                if (!marketplaceSession.isActive(craftingPlanSessionId)) return;
                const currentInventory = dataManager.getInventory() || [];
                if (!activeWorkflowModel) return;
                for (let i = 0; i < activeWorkflowModel.materials.length; i++) {
                    const mat = activeWorkflowModel.materials[i];
                    const needed = mat.required;
                    const have = currentInventory
                        .filter((inv) => inv.itemHrid === mat.itemHrid && !inv.enhancementLevel)
                        .reduce((sum, inv) => sum + (inv.count || 0), 0);
                    mat.missing = Math.max(0, needed - have);
                    const tab = craftingPlanTabs[i];
                    if (tab) updateTabBadge(tab, mat);
                }
            };
            dataManager.on('items_updated', inventoryUpdateHandler);
        });
        content.appendChild(buyButton);
    }

    // === Crafting Steps (what to craft, in order) ===
    const craftSteps = [];
    collectCraftSteps(plan, craftSteps);

    if (craftSteps.length > 0) {
        const divider2 = document.createElement('div');
        divider2.style.cssText = 'border-top: 1px solid var(--border-color, #333); margin: 6px 0;';
        content.appendChild(divider2);

        const stepsHeader = document.createElement('div');
        stepsHeader.style.cssText = `
            font-weight: 500;
            color: var(--text-color-primary, #fff);
            margin-bottom: 4px;
        `;
        stepsHeader.textContent = 'Crafting Steps';
        content.appendChild(stepsHeader);

        const gameData = dataManager.getInitClientData();
        const skills = dataManager.getSkills();
        const equipment = dataManager.getEquipment();
        let totalCraftSeconds = 0;
        let totalXP = 0;

        for (let i = 0; i < craftSteps.length; i++) {
            const step = craftSteps[i];
            const qty = formatWithSeparator(step.quantity);
            let timeStr = '';
            let xpStr = '';
            if (step.actionHrid) {
                const actionDetails = gameData?.actionDetailMap?.[step.actionHrid];
                if (actionDetails) {
                    const stats = calculateActionStats(actionDetails, {
                        skills,
                        equipment,
                        itemDetailMap: gameData.itemDetailMap,
                    });
                    const effMultiplier = calculateEfficiencyMultiplier(stats.totalEfficiency);
                    const totalSeconds = (stats.actionTime * step.actionsNeeded) / effMultiplier;
                    totalCraftSeconds += totalSeconds;
                    timeStr = ` (${timeReadable(totalSeconds)}`;
                }
                const expData = calculateExpPerHour(step.actionHrid);
                if (expData?.expPerHour > 0 && expData.actionsPerHour > 0) {
                    const xpPerAction = expData.expPerHour / expData.actionsPerHour;
                    totalXP += xpPerAction * step.actionsNeeded;
                    xpStr = ` · ${formatKMB(expData.expPerHour)} xp/hr`;
                }
                if (timeStr) {
                    timeStr += `${xpStr})`;
                } else if (xpStr) {
                    timeStr = ` (${xpStr.slice(3)})`;
                }
            }
            content.appendChild(createRow(`${i + 1}. ${step.itemName}`, `x${qty}${timeStr}`));
        }

        if (totalCraftSeconds > 0) {
            const totalTimeRow = createRow('Total craft time', timeReadable(totalCraftSeconds), {
                leftColor: 'var(--text-color-primary, #fff)',
            });
            totalTimeRow.style.borderTop = '1px solid var(--border-color, #333)';
            totalTimeRow.style.marginTop = '4px';
            totalTimeRow.style.paddingTop = '4px';
            content.appendChild(totalTimeRow);
        }

        if (totalXP > 0) {
            content.appendChild(
                createRow('Total XP', formatKMB(Math.round(totalXP)), {
                    leftColor: 'var(--text-color-primary, #fff)',
                })
            );
        }
    }

    const costText = plan.unitCost === Infinity ? '?' : `${formatKMB(Math.round(plan.unitCost))}/ea`;
    const section = createCollapsibleSection('', 'Best Crafting Plan', costText, content, defaultOpen, 0);
    section.id = UI_ID;
    section.className = 'mwi-crafting-plan-section';

    return section;
}

/**
 * Navigate to the marketplace and wait for the tablist to appear.
 * @returns {Promise<boolean>} True if navigation succeeded
 */
async function openCraftingPlanMarketplace() {
    const navButtons = document.querySelectorAll('[class*="NavigationBar_nav"]');
    const marketplaceButton = Array.from(navButtons).find((nav) => {
        const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
        return svg !== null;
    });
    if (!marketplaceButton) return false;
    marketplaceButton.click();

    for (let i = 0; i < 50; i++) {
        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
        if (tabsContainer) {
            const hasMarketListings = Array.from(tabsContainer.children).some((btn) =>
                btn.textContent.includes('Market Listings')
            );
            if (hasMarketListings) return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}

/**
 * Idempotent teardown for the crafting plan marketplace session.
 */
function teardownCraftingPlanMarketplaceSession() {
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.CRAFTING_PLAN);
    craftingPlanTabs.length = 0;

    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }

    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }

    autofillManager.exitSession(craftingPlanSessionId);
    craftingPlanSessionId = null;
    activeWorkflowModel = null;
}

/**
 * Rebuild crafting plan material tabs from the stored workflow model.
 * @param {HTMLElement} tabContainer
 */
function reinjectCraftingPlanMarketplaceTabs(tabContainer) {
    if (!activeWorkflowModel) return;
    createCraftingPlanTabs(activeWorkflowModel.materials, tabContainer);
}

/**
 * Create marketplace tabs for crafting plan shopping list materials.
 * @param {Array} missingMaterials - Array of { itemHrid, itemName, missing, required, isTradeable }
 * @param {HTMLElement} [tabsContainer] - Optional pre-resolved container
 */
function createCraftingPlanTabs(missingMaterials, tabsContainer) {
    if (!tabsContainer) {
        tabsContainer = getVisibleMarketplaceTabContainer();
    }
    if (!tabsContainer) return;

    removeMaterialTabsForOwner(MARKETPLACE_OWNER.CRAFTING_PLAN);
    craftingPlanTabs.length = 0;

    const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));
    if (!referenceTab) return;

    tabsContainer.style.flexWrap = 'wrap';

    for (const material of missingMaterials) {
        const tabRef = { tab: null };
        const sessionIdForTab = craftingPlanSessionId;
        const handler = () => {
            autofillManager.setQuantityProvider(() => {
                return parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10);
            }, sessionIdForTab);
            navigateToMarketplace(material.itemHrid, 0);
        };
        const tab = createMaterialTab(material, referenceTab, handler, MARKETPLACE_OWNER.CRAFTING_PLAN);
        tabRef.tab = tab;
        tabsContainer.appendChild(tab);
        craftingPlanTabs.push(tab);
    }

    // Return tab — navigate back to the crafting plan action
    if (activeWorkflowModel?.returnContext) {
        const { actionHrid, numActions } = activeWorkflowModel.returnContext;
        const actionDetail = dataManager.getInitClientData()?.actionDetailMap?.[actionHrid];
        const actionName = actionDetail?.name || actionHrid;

        const returnTabMaterial = {
            itemHrid: actionHrid,
            itemName: `↩ ${actionName} ×${numActions}`,
            missing: 0,
            required: numActions,
            isTradeable: true,
        };
        const returnTab = createMaterialTab(
            returnTabMaterial,
            referenceTab,
            () => {
                // Navigate back to the crafting panel action
                const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');
                for (const panel of panels) {
                    const nameEl = panel.querySelector('[class*="SkillActionDetail_name"]');
                    if (!nameEl) continue;
                    const panelActionName = Array.from(nameEl.childNodes)
                        .filter((n) => n.nodeType === Node.TEXT_NODE)
                        .map((n) => n.textContent)
                        .join('')
                        .trim();
                    if (panelActionName === actionName) {
                        const inputField = findActionInput(panel);
                        if (inputField) {
                            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                                window.HTMLInputElement.prototype,
                                'value'
                            ).set;
                            nativeInputValueSetter.call(inputField, String(numActions));
                            inputField.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        break;
                    }
                }
            },
            MARKETPLACE_OWNER.CRAFTING_PLAN
        );
        tabsContainer.appendChild(returnTab);
        craftingPlanTabs.push(returnTab);
    }

    if (!cleanupObserver) {
        cleanupObserver = setupMarketplaceCleanupObserver({
            owner: MARKETPLACE_OWNER.CRAFTING_PLAN,
            onTabsGone: () => {
                if (!marketplaceSession.isActive(craftingPlanSessionId)) {
                    teardownCraftingPlanMarketplaceSession();
                    return;
                }
                const visibleContainer = getVisibleMarketplaceTabContainer();
                if (visibleContainer) {
                    // Marketplace is still visible but tabs are gone — reinject
                    reinjectCraftingPlanMarketplaceTabs(visibleContainer);
                } else {
                    teardownCraftingPlanMarketplaceSession();
                }
            },
        });
    }
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

            const newUI = buildPlanUI(actionHrid, rebuild, wasOpen);
            if (!newUI) return;

            const profitSection = panel.querySelector('[data-mwi-profit-display]');
            if (profitSection) {
                profitSection.parentNode.insertBefore(newUI, profitSection);
            } else {
                panel.appendChild(newUI);
            }
        };

        const ui = buildPlanUI(actionHrid, rebuild);
        if (!ui) return;

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
        teardownCraftingPlanMarketplaceSession();

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
