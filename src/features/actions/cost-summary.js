/**
 * Cost Summary
 * Compact 4-line cost comparison block for production action panels.
 * Shows: direct recipe cost, missing direct mats cost, best crafting plan
 * cost, and finished item market price for the selected produce quantity.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import {
    findActionInput,
    attachInputListeners,
    performInitialUpdate,
    refreshActionPanels,
} from '../../utils/action-panel-helper.js';
import { calculateMaterialRequirements } from '../../utils/material-calculator.js';
import { getItemPrice, formatPrice } from '../../utils/market-data.js';
import { computeBestCraftingPlan } from '../../features/crafting-plan/crafting-plan-calculator.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';
import { getOrCreateProductionToolsBlock, normalizeProductionToolsBlock } from './production-tools-layout.js';

const UI_ID = 'mwi-cost-summary';

const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

let domObserverUnregister = null;
let processedPanels = new WeakSet();
let actionsUpdatedHandler = null;

export function initialize() {
    domObserverUnregister = domObserver.onClass('CostSummary-ActionPanel', 'SkillActionDetail_skillActionDetail', () =>
        processActionPanels()
    );

    // Refresh Missing direct mats when the finite action queue changes (add/remove), since the
    // calculation reads dataManager.getCurrentActions() but nothing else invalidates an
    // already-rendered panel.
    if (actionsUpdatedHandler) {
        dataManager.off('actions_updated', actionsUpdatedHandler);
    }
    actionsUpdatedHandler = () => refreshActionPanels((panel, value) => updatePanel(panel, value));
    dataManager.on('actions_updated', actionsUpdatedHandler);

    processActionPanels();
}

export function cleanup() {
    if (domObserverUnregister) {
        domObserverUnregister();
        domObserverUnregister = null;
    }
    if (actionsUpdatedHandler) {
        dataManager.off('actions_updated', actionsUpdatedHandler);
        actionsUpdatedHandler = null;
    }
    document.querySelectorAll(`#${UI_ID}`).forEach((el) => el.remove());
    processedPanels = new WeakSet();
}

function processActionPanels() {
    const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');
    panels.forEach((panel) => {
        if (processedPanels.has(panel)) return;
        const inputField = findActionInput(panel);
        if (!inputField) return;
        processedPanels.add(panel);
        attachInputListeners(panel, inputField, (value) => updatePanel(panel, value));
        performInitialUpdate(inputField, (value) => updatePanel(panel, value));
    });
}

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

function updatePanel(panel, value) {
    const existing = panel.querySelector(`#${UI_ID}`);
    if (existing) existing.remove();

    if (!config.getSetting('actions_costSummary')) return;

    const numActions = parseInt(value) || 0;
    if (numActions <= 0) return;

    const actionHrid = getActionHridFromPanel(panel);
    if (!actionHrid) return;

    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData?.actionDetailMap?.[actionHrid];
    if (!actionDetail) return;
    if (!PRODUCTION_TYPES.includes(actionDetail.type)) return;
    if (!actionDetail.inputItems || actionDetail.inputItems.length === 0) return;

    const output = actionDetail.outputItems?.[0];
    const outputHrid = output?.itemHrid || null;
    const outputCount = (output?.count || 1) * numActions;

    const block = buildBlock(actionHrid, numActions, outputHrid, outputCount);
    insertBlock(panel, block);
}

function insertBlock(panel, block) {
    const toolsBlock = getOrCreateProductionToolsBlock(panel);
    if (toolsBlock) {
        block.style.order = '2';
        toolsBlock.appendChild(block);
        normalizeProductionToolsBlock(panel);
        return;
    }

    const missingMatsButton = panel.querySelector('#mwi-missing-mats-button');
    const itemRequirements = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
    if (missingMatsButton?.parentElement) missingMatsButton.after(block);
    else if (itemRequirements?.parentElement) itemRequirements.after(block);
    else panel.appendChild(block);
}

export function buildBlock(actionHrid, numActions, outputHrid, outputCount) {
    const materials = calculateMaterialRequirements(actionHrid, numActions, true);

    let directCost = 0;
    let missingCost = 0;
    let directComplete = true;
    let missingComplete = true;

    for (const mat of materials) {
        let unitPrice = null;
        if (mat.itemHrid === '/items/coin') {
            unitPrice = 1;
        } else if (mat.isTradeable) {
            unitPrice = getItemPrice(mat.itemHrid, { mode: 'ask', side: 'buy' });
        }

        if (unitPrice === null) {
            if (mat.required > 0) directComplete = false;
            if (mat.missing > 0) missingComplete = false;
            continue;
        }
        directCost += unitPrice * mat.required;
        missingCost += unitPrice * mat.missing;
    }

    let planCost = null;
    if (outputHrid) {
        try {
            const plan = computeBestCraftingPlan(outputHrid, outputCount, 'ask');
            if (plan && plan.totalCost !== Infinity && plan.totalCost !== null) {
                planCost = plan.totalCost;
            }
        } catch (error) {
            console.error('[CostSummary] computeBestCraftingPlan error:', error);
        }
    }

    let marketCost = null;
    if (outputHrid) {
        const unitSellPrice = getItemPrice(outputHrid, { mode: 'ask', side: 'buy' });
        if (unitSellPrice !== null) {
            marketCost = unitSellPrice * outputCount;
        }
    }

    return renderBlock({
        directCost: directComplete || directCost > 0 ? directCost : null,
        directComplete,
        missingCost: missingComplete || missingCost > 0 ? missingCost : null,
        missingComplete,
        planCost,
        marketCost,
    });
}

export function renderBlock({ directCost, directComplete, missingCost, missingComplete, planCost, marketCost }) {
    const container = document.createElement('div');
    container.id = UI_ID;
    container.style.cssText = `
        margin: 0;
        padding: 8px 14px;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.12) 0%, rgba(91, 141, 239, 0.05) 100%);
        border: 1px solid rgba(91, 141, 239, 0.3);
        border-radius: 8px;
        color: #ffffff;
        font-size: 13px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    `;

    const header = document.createElement('div');
    header.textContent = 'Cost Summary';
    header.style.cssText = `
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: #93c5fd;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    `;
    container.appendChild(header);

    container.appendChild(renderLine('Direct recipe cost', directCost, !directComplete));
    container.appendChild(renderLine('Missing direct mats', missingCost, !missingComplete));
    container.appendChild(renderLine('Best crafting plan', planCost));
    container.appendChild(renderLine('Finished item market', marketCost));

    return container;
}

function renderLine(label, value, partial = false) {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        line-height: 1.5;
    `;
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.color = '#cbd5e1';
    const valueEl = document.createElement('span');
    if (value === null || value === undefined) {
        valueEl.textContent = '—';
        valueEl.style.color = '#64748b';
    } else {
        valueEl.textContent = formatPrice(value, { decimals: 1 }) + (partial ? '*' : '');
        valueEl.style.color = '#e2e8f0';
        valueEl.style.fontVariantNumeric = 'tabular-nums';
        if (partial) {
            valueEl.title = 'Partial — some materials have no market data';
        }
    }
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

export default {
    initialize,
    cleanup,
};
