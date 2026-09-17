/**
 * Crafting Plan Tree Renderer
 * Pure helpers + DOM builder for a computed Best Crafting Plan's shopping list and craft
 * steps. Shared by the action-panel BCP display and any other surface that wants the same
 * materials/craft-steps breakdown for a plan tree (e.g. Combat Stats' dungeon key drill-down).
 */

import dataManager from '../../core/data-manager.js';
import { formatKMB, formatWithSeparator, timeReadable } from '../../utils/formatters.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import { calculateEfficiencyMultiplier } from '../../utils/efficiency.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';

/**
 * Collect all leaf "buy" items from the plan tree into a flat shopping list.
 * Aggregates quantities for the same item across branches.
 * @param {Object} node - CraftingPlanNode
 * @param {Map} buyItems - Map of itemHrid → { itemName, quantity, unitCost, totalCost }
 */
export function collectBuyItems(node, buyItems) {
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
export function collectCraftSteps(node, craftSteps) {
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
export function createRow(leftText, rightText, options = {}) {
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
 * Calculate timing and XP metrics for every craft step in the plan.
 * The returned total is the same value rendered as `Total craft time` in the
 * expanded plan and reused in the collapsed summary.
 * @param {Array} craftSteps
 * @returns {{ steps: Array, totalCraftSeconds: number, totalXP: number }}
 */
export function calculateCraftingPlanMetrics(craftSteps) {
    const gameData = dataManager.getInitClientData();
    const skills = dataManager.getSkills();
    const equipment = dataManager.getEquipment();
    let totalCraftSeconds = 0;
    let totalXP = 0;

    const steps = craftSteps.map((step) => {
        let totalSeconds = 0;
        let expPerHour = 0;

        if (step.actionHrid) {
            const actionDetails = gameData?.actionDetailMap?.[step.actionHrid];
            if (actionDetails) {
                const stats = calculateActionStats(actionDetails, {
                    skills,
                    equipment,
                    itemDetailMap: gameData.itemDetailMap,
                });
                const efficiencyMultiplier = calculateEfficiencyMultiplier(stats.totalEfficiency);
                const calculatedSeconds = (stats.actionTime * step.actionsNeeded) / efficiencyMultiplier;
                if (Number.isFinite(calculatedSeconds) && calculatedSeconds > 0) {
                    totalSeconds = calculatedSeconds;
                    totalCraftSeconds += calculatedSeconds;
                }
            }

            const expData = calculateExpPerHour(step.actionHrid);
            if (expData?.expPerHour > 0 && expData.actionsPerHour > 0) {
                const xpPerAction = expData.expPerHour / expData.actionsPerHour;
                totalXP += xpPerAction * step.actionsNeeded;
                expPerHour = expData.expPerHour;
            }
        }

        return { ...step, totalSeconds, expPerHour };
    });

    return { steps, totalCraftSeconds, totalXP };
}

/**
 * Format a total plan duration without leading zero-hour padding.
 * @param {number} totalCraftSeconds
 * @returns {string|null}
 */
export function formatTotalCraftTime(totalCraftSeconds) {
    if (!Number.isFinite(totalCraftSeconds) || totalCraftSeconds <= 0) return null;
    return timeReadable(totalCraftSeconds).replace(/^0h 0?/, '');
}

/**
 * Format the collapsed Best Crafting Plan summary.
 * Cost is per item (`ea` = each); time is the total for every craft step.
 * @param {Object} plan
 * @param {number} totalCraftSeconds
 * @returns {string}
 */
export function formatCraftingPlanSummary(plan, totalCraftSeconds = 0) {
    const cost = plan.unitCost === Infinity ? '?' : `${formatKMB(Math.round(plan.unitCost))}/ea`;
    const totalTime = formatTotalCraftTime(totalCraftSeconds);
    const totalText =
        plan.quantity > 1 && plan.unitCost !== Infinity
            ? ` (×${formatKMB(plan.quantity)}: ${formatKMB(Math.round(plan.totalCost))})`
            : '';
    return totalTime ? `${cost}${totalText} · ${totalTime}` : `${cost}${totalText}`;
}

/**
 * Render the Shopping List (materials to buy) and Crafting Steps sections for a computed plan.
 * Read-only breakdown — no marketplace/Buy-workflow wiring. Callers that need a "Buy Missing
 * Materials" button (the action-panel BCP display) append their own after the shopping list via
 * `onShoppingListRendered`, so this module stays free of session/marketplace concerns.
 * @param {Object} plan - CraftingPlanNode (root)
 * @param {Object} [options]
 * @param {Object} [options.craftMetrics] - Precomputed { steps, totalCraftSeconds, totalXP }. When
 *   omitted, it's derived from the plan via collectCraftSteps + calculateCraftingPlanMetrics.
 * @param {(shoppingListContainer: HTMLElement, buyItems: Array) => void} [options.onShoppingListRendered]
 *   Called with the shopping list's container (already holding the header/rows/total) and the
 *   sorted buy-items array, so a caller can append its own controls (e.g. a Buy button).
 * @returns {HTMLElement} A container with the Shopping List and Crafting Steps sections (either
 *   may be omitted if there's nothing to show for that part of the plan).
 */
export function renderCraftingPlanBreakdown(plan, options = {}) {
    let craftMetrics = options.craftMetrics;
    if (!craftMetrics) {
        const craftSteps = [];
        collectCraftSteps(plan, craftSteps);
        craftMetrics =
            plan.strategy === 'craft' && craftSteps.length > 0
                ? calculateCraftingPlanMetrics(craftSteps)
                : { steps: [], totalCraftSeconds: 0, totalXP: 0 };
    }

    const container = document.createElement('div');

    // === Shopping List (what to buy) ===
    const buyItems = new Map();
    collectBuyItems(plan, buyItems);

    if (buyItems.size > 0) {
        const shoppingListContainer = document.createElement('div');

        const shoppingHeader = document.createElement('div');
        shoppingHeader.style.cssText = `
            font-weight: 500;
            color: var(--text-color-primary, #fff);
            margin-bottom: 4px;
        `;
        shoppingHeader.textContent = 'Shopping List';
        shoppingListContainer.appendChild(shoppingHeader);

        // Sort by total cost descending
        const sortedItems = [...buyItems.values()].sort((a, b) => b.totalCost - a.totalCost);

        for (const item of sortedItems) {
            const qty = Math.ceil(item.quantity);
            const cost = formatKMB(Math.round(item.totalCost));
            const unit = formatWithSeparator(Math.round(item.unitCost));
            shoppingListContainer.appendChild(
                createRow(`${item.itemName} x${formatWithSeparator(qty)}`, `${cost} (${unit}/ea)`)
            );
        }

        // Total buy cost
        const totalBuyCost = sortedItems.reduce((sum, item) => sum + item.totalCost, 0);
        const totalRow = createRow('Total material cost', formatWithSeparator(Math.round(totalBuyCost)), {
            leftColor: 'var(--text-color-primary, #fff)',
        });
        totalRow.style.borderTop = '1px solid var(--border-color, #333)';
        totalRow.style.marginTop = '4px';
        totalRow.style.paddingTop = '4px';
        shoppingListContainer.appendChild(totalRow);

        if (options.onShoppingListRendered) {
            options.onShoppingListRendered(shoppingListContainer, sortedItems);
        }

        container.appendChild(shoppingListContainer);
    }

    // === Crafting Steps (what to craft, in order) ===
    if (craftMetrics.steps.length > 0) {
        if (buyItems.size > 0) {
            const divider = document.createElement('div');
            divider.style.cssText = 'border-top: 1px solid var(--border-color, #333); margin: 6px 0;';
            container.appendChild(divider);
        }

        const stepsHeader = document.createElement('div');
        stepsHeader.style.cssText = `
            font-weight: 500;
            color: var(--text-color-primary, #fff);
            margin-bottom: 4px;
        `;
        stepsHeader.textContent = 'Crafting Steps';
        container.appendChild(stepsHeader);

        for (let i = 0; i < craftMetrics.steps.length; i++) {
            const step = craftMetrics.steps[i];
            const qty = formatWithSeparator(step.quantity);
            let timeStr = step.totalSeconds > 0 ? ` (${timeReadable(step.totalSeconds)}` : '';
            const xpStr = step.expPerHour > 0 ? ` · ${formatKMB(step.expPerHour)} xp/hr` : '';
            if (timeStr) {
                timeStr += `${xpStr})`;
            } else if (xpStr) {
                timeStr = ` (${xpStr.slice(3)})`;
            }
            container.appendChild(createRow(`${i + 1}. ${step.itemName}`, `x${qty}${timeStr}`));
        }

        if (craftMetrics.totalCraftSeconds > 0) {
            const totalTimeRow = createRow('Total craft time', timeReadable(craftMetrics.totalCraftSeconds), {
                leftColor: 'var(--text-color-primary, #fff)',
            });
            totalTimeRow.style.borderTop = '1px solid var(--border-color, #333)';
            totalTimeRow.style.marginTop = '4px';
            totalTimeRow.style.paddingTop = '4px';
            container.appendChild(totalTimeRow);
        }

        if (craftMetrics.totalXP > 0) {
            container.appendChild(
                createRow('Total XP', formatKMB(Math.round(craftMetrics.totalXP)), {
                    leftColor: 'var(--text-color-primary, #fff)',
                })
            );
        }
    }

    return container;
}
