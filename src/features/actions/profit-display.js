/**
 * Profit Display Functions
 *
 * Handles displaying profit calculations in action panels for:
 * - Gathering actions (Foraging, Woodcutting, Milking)
 * - Production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { calculateProductionProfit } from './production-profit.js';
import { formatWithSeparator, formatPercentage, formatLargeNumber } from '../../utils/formatters.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { findActionInput, attachInputListeners } from '../../utils/action-panel-helper.js';
import {
    calculateProfitPerAction,
    calculateProductionActionTotalsFromBase,
    calculateGatheringActionTotalsFromBase,
} from '../../utils/profit-helpers.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';

const getMissingPriceIndicator = (isMissing) => (isMissing ? ' ⚠' : '');
export const formatMissingLabel = (isMissing, value) => (isMissing ? '-- ⚠' : value);

export const getBonusDropPerHourTotals = (drop, efficiencyMultiplier = 1) => ({
    dropsPerHour: drop.dropsPerHour * efficiencyMultiplier,
    revenuePerHour: drop.revenuePerHour * efficiencyMultiplier,
});

export const getBonusDropTotalsForActions = (drop, actionsCount, actionsPerHour) => {
    const dropsPerAction = drop.dropsPerAction ?? drop.dropsPerHour / actionsPerHour;
    const revenuePerAction = drop.revenuePerAction ?? drop.revenuePerHour / actionsPerHour;

    return {
        totalDrops: dropsPerAction * actionsCount,
        totalRevenue: revenuePerAction * actionsCount,
    };
};
const formatRareFindBonusSummary = (bonusRevenue) => {
    const rareFindBonus = bonusRevenue?.rareFindBonus || 0;
    return `${rareFindBonus.toFixed(2)}% rare find`;
};

/**
 * Display gathering profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 * @param {string} dropTableSelector - CSS selector for drop table element
 */
export async function displayGatheringProfit(panel, actionHrid, dropTableSelector) {
    // Check global hide setting
    if (!config.getSetting('actionPanel_showProfitPerHour')) {
        return;
    }

    // Calculate profit
    const profitData = await calculateGatheringProfit(actionHrid);
    if (!profitData) {
        console.error('❌ Gathering profit calculation failed for:', actionHrid);
        return;
    }

    // Check if we already added profit display
    const existingProfit = panel.querySelector('#mwi-foraging-profit');
    const openSectionTitles = new Set();
    if (existingProfit) {
        existingProfit.querySelectorAll('.mwi-section-header').forEach((header) => {
            const content = header.parentElement.querySelector('.mwi-section-content');
            if (content?.style.display === 'block') {
                const label = header.querySelector('span:last-child');
                if (label) openSectionTitles.add(label.textContent.trim());
            }
        });
        existingProfit.remove();
    }

    // Create top-level summary
    const profit = Math.round(profitData.profitPerHour);
    const profitPerDay = Math.round(profitData.profitPerDay);
    const baseMissing = profitData.baseOutputs?.some((output) => output.missingPrice) || false;
    const gourmetMissing = profitData.gourmetBonuses?.some((output) => output.missingPrice) || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const processingMissing = profitData.processingConversions?.some((conversion) => conversion.missingPrice) || false;
    const primaryMissing = baseMissing || gourmetMissing || processingMissing;
    const revenueMissing = primaryMissing || bonusMissing;
    const drinkCostsMissing = profitData.drinkCosts?.some((drink) => drink.missingPrice) || false;
    const costsMissing = drinkCostsMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices;
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;
    // Revenue is now gross (pre-tax)
    const revenue = Math.round(profitData.revenuePerHour);
    const marketTax = Math.round(revenue * MARKET_TAX);
    const costs = Math.round(profitData.drinkCostPerHour + marketTax);
    const summary = formatMissingLabel(
        netMissing,
        `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day | Total profit: 0`
    );

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = formatMissingLabel(revenueMissing, `${formatLargeNumber(revenue)}/hr`);
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryDropsContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
            line.textContent = `• ${output.name} (Base): ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatLargeNumber(Math.round(output.revenuePerHour))}/hr`;
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.gourmetBonuses && profitData.gourmetBonuses.length > 0) {
        for (const output of profitData.gourmetBonuses) {
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
            line.textContent = `• ${output.name} (Gourmet ${formatPercentage(profitData.gourmetBonus || 0, 1)}): ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatLargeNumber(Math.round(output.revenuePerHour))}/hr`;
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.processingConversions && profitData.processingConversions.length > 0) {
        const netProcessingValue = Math.round(profitData.processingRevenueBonus || 0);
        const netProcessingLabel = formatMissingLabel(
            processingMissing,
            `${netProcessingValue >= 0 ? '+' : '-'}${formatLargeNumber(Math.abs(netProcessingValue))}`
        );
        const processingContent = document.createElement('div');

        for (const conversion of profitData.processingConversions) {
            const consumedLine = document.createElement('div');
            consumedLine.style.marginLeft = '8px';
            const consumedMissingNote = getMissingPriceIndicator(conversion.missingPrice);
            const consumedRevenue = conversion.rawConsumedPerHour * conversion.rawPriceEach;
            consumedLine.textContent = `• ${conversion.rawItem} consumed: -${conversion.rawConsumedPerHour.toFixed(2)}/hr @ ${formatWithSeparator(conversion.rawPriceEach)}${consumedMissingNote} → -${formatLargeNumber(Math.round(consumedRevenue))}/hr`;
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            const producedMissingNote = getMissingPriceIndicator(conversion.missingPrice);
            const producedRevenue = conversion.conversionsPerHour * conversion.processedPriceEach;
            producedLine.textContent = `• ${conversion.processedItem} produced: ${conversion.conversionsPerHour.toFixed(2)}/hr @ ${formatWithSeparator(conversion.processedPriceEach)}${producedMissingNote} → ${formatLargeNumber(Math.round(producedRevenue))}/hr`;
            processingContent.appendChild(producedLine);
        }

        const processingSection = createCollapsibleSection(
            '',
            `• Processing (${formatPercentage(profitData.processingBonus || 0, 1)} proc): Net ${netProcessingLabel}/hr`,
            null,
            processingContent,
            false,
            1
        );
        primaryDropsContent.appendChild(processingSection);
    }

    const baseRevenue = profitData.baseOutputs?.reduce((sum, o) => sum + o.revenuePerHour, 0) || 0;
    const gourmetRevenue = profitData.gourmetRevenueBonus || 0;
    const processingRevenue = profitData.processingRevenueBonus || 0;
    const primaryRevenue = baseRevenue + gourmetRevenue + processingRevenue;
    const primaryRevenueLabel = formatMissingLabel(primaryMissing, formatLargeNumber(Math.round(primaryRevenue)));
    const outputItemCount =
        (profitData.baseOutputs?.length || 0) +
        (profitData.processingConversions && profitData.processingConversions.length > 0 ? 1 : 0);
    const primaryDropsSection = createCollapsibleSection(
        '',
        `Primary Outputs: ${primaryRevenueLabel}/hr (${outputItemCount} item${outputItemCount !== 1 ? 's' : ''})`,
        null,
        primaryDropsContent,
        false,
        1
    );

    // Bonus Drops subsections - split by type (bonus drops are base actions/hour)
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const decimals = dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(revenuePerHour))}/hr`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
            0
        );
        const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(essenceRevenue)));
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${essenceRevenueLabel}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(2)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    // Rare Finds subsection
    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const decimals = dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(revenuePerHour))}/hr`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
            0
        );
        const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(rareFindRevenue)));
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindSummary})`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(primaryDropsSection);
    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    const costsLabel = formatMissingLabel(costsMissing, `${formatLargeNumber(costs)}/hr`);
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(drink.missingPrice);
            line.textContent = `• ${drink.name}: ${drink.drinksPerHour.toFixed(2)}/hr @ ${formatWithSeparator(drink.priceEach)}${missingPriceNote} → ${formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsLabel = drinkCostsMissing ? '-- ⚠' : formatLargeNumber(Math.round(profitData.drinkCostPerHour));
    const drinkCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${drinkCostsLabel}/hr (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
        null,
        drinkCostsContent,
        false,
        1
    );

    costsDiv.appendChild(drinkCostsSection);

    // Market Tax subsection
    const marketTaxContent = document.createElement('div');
    const marketTaxLine = document.createElement('div');
    marketTaxLine.style.marginLeft = '8px';
    const marketTaxLabel = marketTaxMissing ? '-- ⚠' : `${formatLargeNumber(marketTax)}/hr`;
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxHeader = marketTaxMissing ? '-- ⚠' : `${formatLargeNumber(marketTax)}/hr`;
    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxHeader} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Modifiers Section — collapsible, with each modifier as a nested collapsible
    const modifierSummaryParts = [];
    const modifierSubSections = [];

    // Helper: build a sub-collapsible for a modifier
    const makeModifierSection = (title, total, rows) => {
        const content = document.createElement('div');
        for (const row of rows) {
            const line = document.createElement('div');
            line.textContent = row;
            content.appendChild(line);
        }
        return createCollapsibleSection(null, `${title}: +${total}`, null, content, false, 1);
    };

    // Efficiency
    const effRows = [];
    if (profitData.details.levelEfficiency > 0) {
        effRows.push(`+${profitData.details.levelEfficiency.toFixed(2)}% Level advantage`);
    }
    if (profitData.details.houseEfficiency > 0) {
        effRows.push(`+${profitData.details.houseEfficiency.toFixed(2)}% House room`);
    }
    if (profitData.details.teaEfficiency > 0) {
        effRows.push(`+${profitData.details.teaEfficiency.toFixed(2)}% Tea`);
    }
    if ((profitData.details.equipmentEfficiencyItems || []).length > 0) {
        for (const item of profitData.details.equipmentEfficiencyItems) {
            const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
            effRows.push(`+${item.value.toFixed(2)}% ${item.name}${enh}`);
        }
    } else if (profitData.details.equipmentEfficiency > 0) {
        effRows.push(`+${profitData.details.equipmentEfficiency.toFixed(2)}% Equipment`);
    }
    if (profitData.details.communityEfficiency > 0) {
        effRows.push(`+${profitData.details.communityEfficiency.toFixed(2)}% Community buff`);
    }
    if (profitData.details.achievementEfficiency > 0) {
        effRows.push(`+${profitData.details.achievementEfficiency.toFixed(2)}% Achievement`);
    }
    if (profitData.details.personalEfficiency > 0) {
        effRows.push(`+${profitData.details.personalEfficiency.toFixed(2)}% Seal of Efficiency`);
    }
    if (effRows.length > 0) {
        modifierSummaryParts.push(`+${profitData.totalEfficiency.toFixed(2)}% eff`);
        modifierSubSections.push(
            makeModifierSection('Efficiency', `${profitData.totalEfficiency.toFixed(2)}%`, effRows)
        );
    }

    // Gathering Quantity
    if (profitData.gatheringQuantity > 0) {
        const gatherRows = [];
        if (profitData.details.communityBuffQuantity > 0) {
            gatherRows.push(`+${(profitData.details.communityBuffQuantity * 100).toFixed(2)}% Community buff`);
        }
        if (profitData.details.gatheringTeaBonus > 0) {
            gatherRows.push(`+${(profitData.details.gatheringTeaBonus * 100).toFixed(2)}% Tea`);
        }
        if (profitData.details.achievementGathering > 0) {
            gatherRows.push(`+${(profitData.details.achievementGathering * 100).toFixed(2)}% Achievement`);
        }
        if (profitData.details.personalGathering > 0) {
            gatherRows.push(`+${(profitData.details.personalGathering * 100).toFixed(2)}% Seal of Gathering`);
        }
        const gatherTotal = `${(profitData.gatheringQuantity * 100).toFixed(2)}%`;
        modifierSummaryParts.push(`+${(profitData.gatheringQuantity * 100).toFixed(2)}% gather`);
        modifierSubSections.push(makeModifierSection('Gathering Quantity', gatherTotal, gatherRows));
    }

    // Rare Find
    const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
    const rareFindBreakdown = profitData.bonusRevenue?.rareFindBreakdown || {};
    if (rareFindBonus > 0) {
        const rareRows = [];
        for (const item of rareFindBreakdown.equipmentItems || []) {
            const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
            rareRows.push(`+${item.value.toFixed(2)}% ${item.name}${enh}`);
        }
        if (rareFindBreakdown.house > 0) {
            rareRows.push(`+${rareFindBreakdown.house.toFixed(2)}% House rooms`);
        }
        if (rareFindBreakdown.achievement > 0) {
            rareRows.push(`+${rareFindBreakdown.achievement.toFixed(2)}% Achievement`);
        }
        if (rareFindBreakdown.personal > 0) {
            rareRows.push(`+${rareFindBreakdown.personal.toFixed(2)}% Seal of Rare Find`);
        }
        modifierSummaryParts.push(`+${rareFindBonus.toFixed(2)}% rare`);
        modifierSubSections.push(makeModifierSection('Rare Find', `${rareFindBonus.toFixed(2)}%`, rareRows));
    }

    // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    if (modifierSubSections.length > 0) {
        const modifierContent = document.createElement('div');
        for (const sub of modifierSubSections) {
            modifierContent.appendChild(sub);
        }
        const modifiersSection = createCollapsibleSection(
            '⚙️',
            'Modifiers',
            modifierSummaryParts.join(' | '),
            modifierContent,
            false,
            0
        );
        detailsContent.appendChild(modifiersSection);
    }

    // Create "Detailed Breakdown" collapsible
    const topLevelContent = document.createElement('div');
    topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(2)}/hr | Efficiency: +${profitData.totalEfficiency.toFixed(2)}%</div>
    `;

    // Add Net Profit line at top level (always visible when Profitability is expanded)
    const profitColor = netMissing ? config.SCRIPT_COLOR_ALERT : profit >= 0 ? '#4ade80' : config.COLOR_LOSS; // green if positive, red if negative
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = netMissing
        ? 'Net Profit: -- ⚠'
        : `Net Profit: ${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;
    topLevelContent.appendChild(netProfitLine);

    // Add pricing mode label
    const pricingMode = profitData.pricingMode || 'hybrid';
    const modeLabel = config.getPricingModeLabel(pricingMode);

    const modeDiv = document.createElement('div');
    modeDiv.style.cssText = `
        margin-bottom: 8px;
        color: #888;
        font-size: 0.85em;
    `;
    const gatheringActionType = dataManager.getActionDetails(actionHrid)?.type;
    const gatheringSnapshotInfo = gatheringActionType
        ? loadoutSnapshot.getSnapshotInfoForSkill(gatheringActionType)
        : null;
    const gatheringLoadoutLabel = gatheringSnapshotInfo
        ? `${gatheringSnapshotInfo.name}${gatheringSnapshotInfo.isDefault ? ' (Default)' : ''}`
        : 'Equipped';
    modeDiv.textContent = `Pricing Mode: ${modeLabel}  •  Loadout: ${gatheringLoadoutLabel}`;
    topLevelContent.appendChild(modeDiv);

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        'Per hour breakdown',
        null,
        detailsContent,
        false,
        0
    );

    topLevelContent.appendChild(detailedBreakdownSection);

    // Add per-action breakdown section
    const perActionBreakdown = buildGatheringPerActionBreakdown(profitData);
    topLevelContent.appendChild(perActionBreakdown);

    // Add X actions breakdown section (updates dynamically with input)
    const inputField = findActionInput(panel);
    if (inputField) {
        const inputValue = parseInt(inputField.value) || 0;

        // Add initial X actions breakdown if input has value
        if (inputValue > 0) {
            const actionsBreakdown = buildGatheringActionsBreakdown(profitData, inputValue);
            topLevelContent.appendChild(actionsBreakdown);
        }

        // Set up input listener to update X actions breakdown dynamically
        attachInputListeners(panel, inputField, (newValue) => {
            // Remove existing X actions breakdown
            const existingBreakdown = topLevelContent.querySelector('.mwi-actions-breakdown');
            if (existingBreakdown) {
                existingBreakdown.remove();
            }

            // Add new X actions breakdown if value > 0
            if (newValue > 0) {
                const actionsBreakdown = buildGatheringActionsBreakdown(profitData, newValue);
                topLevelContent.appendChild(actionsBreakdown);
            }
        });
    }

    // Create main profit section
    const profitSection = createCollapsibleSection('💰', 'Profitability', summary, topLevelContent, false, 0);
    profitSection.id = 'mwi-foraging-profit';
    profitSection.setAttribute('data-mwi-profit-display', 'true');
    profitSection.dataset.mwiActionHrid = actionHrid;
    profitSection.dataset.mwiActionType = 'gathering';

    // Get the summary div to update it dynamically
    const profitSummaryDiv = profitSection.querySelector('.mwi-section-header + div');

    // Set up listener to update summary with total profit when input changes
    if (inputField && profitSummaryDiv) {
        const baseSummary = formatMissingLabel(
            netMissing,
            `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`
        );

        const updateSummary = (newValue) => {
            if (netMissing) {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: -- ⚠`;
                return;
            }
            const inputValue = inputField.value;

            if (inputValue === '∞') {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: ∞`;
            } else if (newValue > 0) {
                const totals = calculateGatheringActionTotalsFromBase({
                    actionsCount: newValue,
                    actionsPerHour: profitData.actionsPerHour,
                    baseOutputs: profitData.baseOutputs,
                    bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
                    processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
                    gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
                    drinkCostPerHour: profitData.drinkCostPerHour,
                    efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
                });
                const totalProfit = Math.round(totals.totalProfit);
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: ${formatLargeNumber(totalProfit)}`;
            } else {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: 0`;
            }
        };

        // Update summary initially
        const initialValue = parseInt(inputField.value) || 0;
        updateSummary(initialValue);

        // Attach listener for future changes
        attachInputListeners(panel, inputField, updateSummary);
    }

    // Find insertion point - look for existing collapsible sections or drop table
    let insertionPoint = panel.querySelector('.mwi-collapsible-section');
    if (insertionPoint) {
        // Insert after last collapsible section
        while (
            insertionPoint.nextElementSibling &&
            insertionPoint.nextElementSibling.className === 'mwi-collapsible-section'
        ) {
            insertionPoint = insertionPoint.nextElementSibling;
        }
        insertionPoint.insertAdjacentElement('afterend', profitSection);
    } else {
        // Fallback: insert after drop table
        const dropTableElement = panel.querySelector(dropTableSelector);
        if (dropTableElement) {
            dropTableElement.parentNode.insertBefore(profitSection, dropTableElement.nextSibling);
        } else {
            panel.appendChild(profitSection);
        }
    }

    // Restore any sections the user had previously opened
    if (openSectionTitles.size > 0) {
        profitSection.querySelectorAll('.mwi-section-header').forEach((header) => {
            const label = header.querySelector('span:last-child');
            const title = label?.textContent.trim();
            if (label && openSectionTitles.has(title)) {
                header.click();
            }
        });
    }
}

/**
 * Display production profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 * @param {string} dropTableSelector - CSS selector for drop table element
 */
export async function displayProductionProfit(panel, actionHrid, dropTableSelector) {
    // Check global hide setting
    if (!config.getSetting('actionPanel_showProfitPerHour')) {
        return;
    }

    // Calculate profit
    const profitData = await calculateProductionProfit(actionHrid);
    if (!profitData) {
        console.error('❌ Production profit calculation failed for:', actionHrid);
        return;
    }

    // Validate required fields
    const requiredFields = [
        'profitPerHour',
        'profitPerDay',
        'itemsPerHour',
        'priceAfterTax',
        'gourmetBonusItems',
        'materialCostPerHour',
        'totalTeaCostPerHour',
        'actionsPerHour',
        'totalEfficiency',
        'levelEfficiency',
        'houseEfficiency',
        'teaEfficiency',
        'equipmentEfficiency',
        'artisanBonus',
        'gourmetBonus',
        'materialCosts',
        'teaCosts',
    ];

    const missingFields = requiredFields.filter((field) => profitData[field] === undefined);
    if (missingFields.length > 0) {
        console.error('❌ Production profit data missing required fields:', missingFields, 'for action:', actionHrid);
        console.error('Received profitData:', profitData);
        return;
    }

    // Check if we already added profit display
    const existingProfit = panel.querySelector('#mwi-production-profit');
    const openSectionTitles = new Set();
    if (existingProfit) {
        existingProfit.querySelectorAll('.mwi-section-header').forEach((header) => {
            const content = header.parentElement.querySelector('.mwi-section-content');
            if (content?.style.display === 'block') {
                const label = header.querySelector('span:last-child');
                if (label) openSectionTitles.add(label.textContent.trim());
            }
        });
        existingProfit.remove();
    }

    // Create top-level summary (bonus revenue now included in profitPerHour)
    const profit = Math.round(profitData.profitPerHour);
    const profitPerDay = Math.round(profitData.profitPerDay);
    const outputMissing = profitData.outputPriceMissing || false;
    const outputEstimated = profitData.outputPriceEstimated || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const materialMissing = profitData.materialCosts?.some((material) => material.missingPrice) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice) || false;
    const revenueMissing = (outputMissing && !outputEstimated) || bonusMissing;

    // Skip profit display entirely for untradable items (e.g. tailoring back slot items).
    // Action Speed & Time and Level Progress already cover these.
    const outputItemDetails = dataManager.getItemDetails(profitData.itemHrid);
    if (outputItemDetails && !outputItemDetails.isTradable) {
        return;
    }

    const revenueEstimated = outputEstimated && !revenueMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const costsEstimated = revenueEstimated && !costsMissing;
    const marketTaxMissing = revenueMissing;
    const marketTaxEstimated = revenueEstimated && !marketTaxMissing;
    const netMissing = profitData.hasMissingPrices;
    const netEstimated = (revenueEstimated || costsEstimated) && !netMissing;
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const bonusRevenueTotal = profitData.bonusRevenue?.totalBonusRevenue || 0;
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;
    // Use outputPrice (pre-tax) for revenue display
    const revenue = Math.round(
        profitData.itemsPerHour * profitData.outputPrice +
            profitData.gourmetBonusItems * profitData.outputPrice +
            bonusRevenueTotal * efficiencyMultiplier
    );
    // Calculate market tax (2% of revenue)
    const marketTax = Math.round(revenue * MARKET_TAX);
    const costs = Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour + marketTax);
    const summary = netMissing
        ? '-- ⚠'
        : `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day | Total profit: 0`;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing
        ? '-- ⚠'
        : revenueEstimated
          ? `${formatLargeNumber(revenue)}/hr ⚠`
          : `${formatLargeNumber(revenue)}/hr`;
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(
        profitData.outputPriceMissing || profitData.outputPriceEstimated
    );
    baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${profitData.itemsPerHour.toFixed(2)}/hr @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(profitData.itemsPerHour * profitData.outputPrice))}/hr`;
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonusItems > 0) {
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatPercentage(profitData.gourmetBonus, 1)}): ${profitData.gourmetBonusItems.toFixed(2)}/hr @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(profitData.gourmetBonusItems * profitData.outputPrice))}/hr`;
        primaryOutputContent.appendChild(gourmetLine);
    }

    const baseRevenue = profitData.itemsPerHour * profitData.outputPrice;
    const gourmetRevenue = profitData.gourmetBonusItems * profitData.outputPrice;
    const primaryRevenue = baseRevenue + gourmetRevenue;
    const primaryRevenueLabel = outputMissing ? '-- ⚠' : formatWithSeparator(Math.round(primaryRevenue));
    const gourmetLabel =
        profitData.gourmetBonus > 0 ? ` (${formatPercentage(profitData.gourmetBonus, 1)} gourmet)` : '';
    const primaryOutputSection = createCollapsibleSection(
        '',
        `Primary Outputs: ${primaryRevenueLabel}/hr${gourmetLabel}`,
        null,
        primaryOutputContent,
        false,
        1
    );

    revenueDiv.appendChild(primaryOutputSection);

    // Bonus Drops subsections - split by type
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const decimals = dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(revenuePerHour))}/hr`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
            0
        );
        const essenceRevenueLabel = bonusMissing ? '-- ⚠' : formatLargeNumber(Math.round(essenceRevenue));
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${essenceRevenueLabel}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(2)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    // Rare Finds subsection
    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const decimals = dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(revenuePerHour))}/hr`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
            0
        );
        const rareFindRevenueLabel = bonusMissing ? '-- ⚠' : formatLargeNumber(Math.round(rareFindRevenue));
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindSummary})`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    const costsLabel = costsMissing
        ? '-- ⚠'
        : costsEstimated
          ? `${formatLargeNumber(costs)}/hr ⚠`
          : `${formatLargeNumber(costs)}/hr`;
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        for (const material of profitData.materialCosts) {
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            // Material structure: { itemName, amount, askPrice, totalCost, baseAmount }
            const amountPerAction = material.amount || 0;
            const efficiencyMultiplier = profitData.efficiencyMultiplier;
            const amountPerHour = amountPerAction * profitData.actionsPerHour * efficiencyMultiplier;

            // Build material line with embedded Artisan information
            let materialText = `• ${material.itemName}: ${amountPerHour.toFixed(2)}/hr`;

            // Add Artisan reduction info if present (only show if actually reduced)
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseAmountPerHour = material.baseAmount * profitData.actionsPerHour * efficiencyMultiplier;
                materialText += ` (${baseAmountPerHour.toFixed(2)} base -${formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
            }

            const missingPriceNote = getMissingPriceIndicator(material.missingPrice);
            materialText += ` @ ${formatWithSeparator(Math.round(material.askPrice))}${missingPriceNote} → ${formatLargeNumber(Math.round(material.totalCost * profitData.actionsPerHour * efficiencyMultiplier))}/hr`;

            line.textContent = materialText;
            materialCostsContent.appendChild(line);
        }
    }

    const materialCostsLabel = formatMissingLabel(
        materialMissing,
        formatLargeNumber(Math.round(profitData.materialCostPerHour))
    );
    const materialCostsSection = createCollapsibleSection(
        '',
        `Material Costs: ${materialCostsLabel}/hr (${profitData.materialCosts?.length || 0} material${profitData.materialCosts?.length !== 1 ? 's' : ''})`,
        null,
        materialCostsContent,
        false,
        1
    );

    // Tea Costs subsection
    const teaCostsContent = document.createElement('div');
    if (profitData.teaCosts && profitData.teaCosts.length > 0) {
        for (const tea of profitData.teaCosts) {
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            // Tea structure: { itemName, pricePerDrink, drinksPerHour, totalCost }
            const missingPriceNote = getMissingPriceIndicator(tea.missingPrice);
            line.textContent = `• ${tea.itemName}: ${tea.drinksPerHour.toFixed(2)}/hr @ ${formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} → ${formatLargeNumber(Math.round(tea.totalCost))}/hr`;
            teaCostsContent.appendChild(line);
        }
    }

    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsLabel = formatMissingLabel(teaMissing, formatLargeNumber(Math.round(profitData.totalTeaCostPerHour)));
    const teaCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${teaCostsLabel}/hr (${teaCount} drink${teaCount !== 1 ? 's' : ''})`,
        null,
        teaCostsContent,
        false,
        1
    );

    costsDiv.appendChild(materialCostsSection);
    costsDiv.appendChild(teaCostsSection);

    // Market Tax subsection
    const marketTaxContent = document.createElement('div');
    const marketTaxLine = document.createElement('div');
    marketTaxLine.style.marginLeft = '8px';
    const marketTaxLabel = marketTaxMissing
        ? '-- ⚠'
        : marketTaxEstimated
          ? `${formatLargeNumber(marketTax)}/hr ⚠`
          : `${formatLargeNumber(marketTax)}/hr`;
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxHeader = marketTaxLabel;
    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxHeader} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Modifiers Section — collapsible, with each modifier as a nested collapsible
    const modifierSummaryParts = [];
    const modifierSubSections = [];

    // Helper reused from gathering section (defined per-function scope)
    const makeModifierSectionProd = (title, total, rows) => {
        const content = document.createElement('div');
        for (const row of rows) {
            const line = document.createElement('div');
            line.textContent = row;
            content.appendChild(line);
        }
        return createCollapsibleSection(null, `${title}: +${total}`, null, content, false, 1);
    };

    // Efficiency
    const effRows = [];
    if (profitData.levelEfficiency > 0) {
        effRows.push(`+${profitData.levelEfficiency}% Level advantage`);
    }
    if (profitData.houseEfficiency > 0) {
        effRows.push(`+${profitData.houseEfficiency.toFixed(2)}% House room`);
    }
    if (profitData.teaEfficiency > 0) {
        effRows.push(`+${profitData.teaEfficiency.toFixed(2)}% Tea`);
    }
    if ((profitData.equipmentEfficiencyItems || []).length > 0) {
        for (const item of profitData.equipmentEfficiencyItems) {
            const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
            effRows.push(`+${item.value.toFixed(2)}% ${item.name}${enh}`);
        }
    } else if (profitData.equipmentEfficiency > 0) {
        effRows.push(`+${profitData.equipmentEfficiency.toFixed(2)}% Equipment`);
    }
    if (profitData.communityEfficiency > 0) {
        effRows.push(`+${profitData.communityEfficiency.toFixed(2)}% Community buff`);
    }
    if (profitData.achievementEfficiency > 0) {
        effRows.push(`+${profitData.achievementEfficiency.toFixed(2)}% Achievement`);
    }
    if (profitData.personalEfficiency > 0) {
        effRows.push(`+${profitData.personalEfficiency.toFixed(2)}% Seal of Efficiency`);
    }
    if (effRows.length > 0) {
        modifierSummaryParts.push(`+${profitData.totalEfficiency.toFixed(2)}% eff`);
        modifierSubSections.push(
            makeModifierSectionProd('Efficiency', `${profitData.totalEfficiency.toFixed(2)}%`, effRows)
        );
    }

    // Rare Find
    const productionRareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
    const productionRareFindBreakdown = profitData.bonusRevenue?.rareFindBreakdown || {};
    if (productionRareFindBonus > 0) {
        const rareRows = [];
        for (const item of productionRareFindBreakdown.equipmentItems || []) {
            const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
            rareRows.push(`+${item.value.toFixed(2)}% ${item.name}${enh}`);
        }
        if (productionRareFindBreakdown.house > 0) {
            rareRows.push(`+${productionRareFindBreakdown.house.toFixed(2)}% House rooms`);
        }
        if (productionRareFindBreakdown.achievement > 0) {
            rareRows.push(`+${productionRareFindBreakdown.achievement.toFixed(2)}% Achievement`);
        }
        if (productionRareFindBreakdown.personal > 0) {
            rareRows.push(`+${productionRareFindBreakdown.personal.toFixed(2)}% Seal of Rare Find`);
        }
        modifierSummaryParts.push(`+${productionRareFindBonus.toFixed(2)}% rare`);
        modifierSubSections.push(
            makeModifierSectionProd('Rare Find', `${productionRareFindBonus.toFixed(2)}%`, rareRows)
        );
    }

    // Artisan Bonus (no sub-breakdown needed — single source)
    if (profitData.artisanBonus > 0) {
        const artisanContent = document.createElement('div');
        artisanContent.textContent = `-${formatPercentage(profitData.artisanBonus, 1)} material requirement from Artisan Tea`;
        modifierSummaryParts.push(`-${formatPercentage(profitData.artisanBonus, 1)} artisan`);
        modifierSubSections.push(
            createCollapsibleSection(
                null,
                `Artisan: -${formatPercentage(profitData.artisanBonus, 1)}`,
                null,
                artisanContent,
                false,
                1
            )
        );
    }

    // Gourmet Bonus (no sub-breakdown needed — single source)
    if (profitData.gourmetBonus > 0) {
        const gourmetContent = document.createElement('div');
        gourmetContent.textContent = `+${formatPercentage(profitData.gourmetBonus, 1)} bonus items from Gourmet Tea`;
        modifierSummaryParts.push(`+${formatPercentage(profitData.gourmetBonus, 1)} gourmet`);
        modifierSubSections.push(
            createCollapsibleSection(
                null,
                `Gourmet: +${formatPercentage(profitData.gourmetBonus, 1)}`,
                null,
                gourmetContent,
                false,
                1
            )
        );
    }

    // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    if (modifierSubSections.length > 0) {
        const modifierContent = document.createElement('div');
        for (const sub of modifierSubSections) {
            modifierContent.appendChild(sub);
        }
        const modifiersSection = createCollapsibleSection(
            '⚙️',
            'Modifiers',
            modifierSummaryParts.join(' | '),
            modifierContent,
            false,
            0
        );
        detailsContent.appendChild(modifiersSection);
    }

    // Create "Detailed Breakdown" collapsible
    const topLevelContent = document.createElement('div');
    const effectiveActionsPerHour = profitData.actionsPerHour * profitData.efficiencyMultiplier;
    topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${effectiveActionsPerHour.toFixed(2)}/hr</div>
    `;

    // Add Net Profit line at top level (always visible when Profitability is expanded)
    const profitColor = netMissing ? config.SCRIPT_COLOR_ALERT : profit >= 0 ? '#4ade80' : config.COLOR_LOSS; // green if positive, red if negative
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = netMissing
        ? 'Net Profit: -- ⚠'
        : netEstimated
          ? `Net Profit: ${formatLargeNumber(profit)}/hr ⚠, ${formatLargeNumber(profitPerDay)}/day ⚠`
          : `Net Profit: ${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;
    topLevelContent.appendChild(netProfitLine);

    // Add pricing mode label
    const pricingMode = profitData.pricingMode || 'hybrid';
    const modeLabel = config.getPricingModeLabel(pricingMode);

    const modeDiv = document.createElement('div');
    modeDiv.style.cssText = `
        margin-bottom: 8px;
        color: #888;
        font-size: 0.85em;
    `;
    const productionActionType = dataManager.getActionDetails(actionHrid)?.type;
    const productionSnapshotInfo = productionActionType
        ? loadoutSnapshot.getSnapshotInfoForSkill(productionActionType)
        : null;
    const productionLoadoutLabel = productionSnapshotInfo
        ? `${productionSnapshotInfo.name}${productionSnapshotInfo.isDefault ? ' (Default)' : ''}`
        : 'Equipped';
    modeDiv.textContent = `Pricing Mode: ${modeLabel}  •  Loadout: ${productionLoadoutLabel}`;
    topLevelContent.appendChild(modeDiv);

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        'Per hour breakdown',
        null,
        detailsContent,
        false,
        0
    );

    topLevelContent.appendChild(detailedBreakdownSection);

    // Add per-action breakdown section
    const perActionBreakdown = buildProductionPerActionBreakdown(profitData);
    topLevelContent.appendChild(perActionBreakdown);

    // Add X actions breakdown section (updates dynamically with input)
    const inputField = findActionInput(panel);
    if (inputField) {
        const inputValue = parseInt(inputField.value) || 0;

        // Add initial X actions breakdown if input has value
        if (inputValue > 0) {
            const actionsBreakdown = buildProductionActionsBreakdown(profitData, inputValue);
            topLevelContent.appendChild(actionsBreakdown);
        }

        // Set up input listener to update X actions breakdown dynamically
        attachInputListeners(panel, inputField, (newValue) => {
            // Remove existing X actions breakdown
            const existingBreakdown = topLevelContent.querySelector('.mwi-actions-breakdown');
            if (existingBreakdown) {
                existingBreakdown.remove();
            }

            // Add new X actions breakdown if value > 0
            if (newValue > 0) {
                const actionsBreakdown = buildProductionActionsBreakdown(profitData, newValue);
                topLevelContent.appendChild(actionsBreakdown);
            }
        });
    }

    // Create main profit section
    const profitSection = createCollapsibleSection('💰', 'Profitability', summary, topLevelContent, false, 0);
    profitSection.id = 'mwi-production-profit';
    profitSection.setAttribute('data-mwi-profit-display', 'true');
    profitSection.dataset.mwiActionHrid = actionHrid;
    profitSection.dataset.mwiActionType = 'production';
    const profitSummaryDiv = profitSection.querySelector('.mwi-section-header + div');

    // Set up listener to update summary with total profit when input changes
    if (inputField && profitSummaryDiv) {
        const baseSummary = formatMissingLabel(
            netMissing,
            `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`
        );

        const updateSummary = (newValue) => {
            if (netMissing) {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: -- ⚠`;
                return;
            }
            const inputValue = inputField.value;

            if (inputValue === '∞') {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: ∞`;
            } else if (newValue > 0) {
                const totals = calculateProductionActionTotalsFromBase({
                    actionsCount: newValue,
                    actionsPerHour: profitData.actionsPerHour,
                    outputAmount: profitData.outputAmount || 1,
                    outputPrice: profitData.outputPrice,
                    gourmetBonus: profitData.gourmetBonus || 0,
                    bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
                    materialCosts: profitData.materialCosts,
                    totalTeaCostPerHour: profitData.totalTeaCostPerHour,
                    efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
                });
                const totalProfit = Math.round(totals.totalProfit);
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: ${formatLargeNumber(totalProfit)}`;
            } else {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: 0`;
            }
        };

        // Update summary initially
        const initialValue = parseInt(inputField.value) || 0;
        updateSummary(initialValue);

        // Attach listener for future changes
        attachInputListeners(panel, inputField, updateSummary);
    }

    // Find insertion point - look for existing collapsible sections or drop table
    let insertionPoint = panel.querySelector('.mwi-collapsible-section');
    if (insertionPoint) {
        // Insert after last collapsible section
        while (
            insertionPoint.nextElementSibling &&
            insertionPoint.nextElementSibling.className === 'mwi-collapsible-section'
        ) {
            insertionPoint = insertionPoint.nextElementSibling;
        }
        insertionPoint.insertAdjacentElement('afterend', profitSection);
    } else {
        // Fallback: insert after drop table
        const dropTableElement = panel.querySelector(dropTableSelector);
        if (dropTableElement) {
            dropTableElement.parentNode.insertBefore(profitSection, dropTableElement.nextSibling);
        } else {
            panel.appendChild(profitSection);
        }
    }

    // Restore any sections the user had previously opened
    if (openSectionTitles.size > 0) {
        profitSection.querySelectorAll('.mwi-section-header').forEach((header) => {
            const label = header.querySelector('span:last-child');
            if (label && openSectionTitles.has(label.textContent.trim())) {
                header.click();
            }
        });
    }
}

/**
 * Format a per-action value with appropriate decimal precision
 * @param {number} value - The per-action value
 * @returns {string} Formatted value
 */
function formatPerAction(value) {
    const abs = Math.abs(value);
    if (abs >= 1000) return formatLargeNumber(Math.round(value));
    if (abs >= 10) return value.toFixed(2);
    if (abs >= 1) return value.toFixed(2);
    if (abs === 0) return '0';
    return value.toFixed(2);
}

/**
 * Build "Per action breakdown" section for gathering actions
 * @param {Object} profitData - Profit calculation data
 * @returns {HTMLElement} Breakdown section element
 */
function buildGatheringPerActionBreakdown(profitData) {
    const actionsPerHour = profitData.actionsPerHour;
    const baseMissing = profitData.baseOutputs?.some((output) => output.missingPrice) || false;
    const gourmetMissing = profitData.gourmetBonuses?.some((output) => output.missingPrice) || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const processingMissing = profitData.processingConversions?.some((conversion) => conversion.missingPrice) || false;
    const primaryMissing = baseMissing || gourmetMissing || processingMissing;
    const revenueMissing = primaryMissing || bonusMissing;
    const drinkCostsMissing = profitData.drinkCosts?.some((drink) => drink.missingPrice) || false;
    const costsMissing = drinkCostsMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices;
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;

    const revenuePerHour = profitData.revenuePerHour;
    const revenuePerAction = revenuePerHour / actionsPerHour;
    const marketTaxPerHour = revenuePerHour * MARKET_TAX;
    const marketTaxPerAction = marketTaxPerHour / actionsPerHour;
    const drinkCostPerAction = profitData.drinkCostPerHour / actionsPerHour;
    const costsPerAction = drinkCostPerAction + marketTaxPerAction;
    const profitPerAction = profitData.profitPerAction;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = formatMissingLabel(revenueMissing, `${formatPerAction(revenuePerAction)}/action`);
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryDropsContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
            const revPerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
            line.textContent = `• ${output.name} (Base): ${itemsPerAction.toFixed(2)}/action @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatPerAction(revPerAction)}/action`;
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.gourmetBonuses && profitData.gourmetBonuses.length > 0) {
        for (const output of profitData.gourmetBonuses) {
            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
            const revPerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
            line.textContent = `• ${output.name} (Gourmet ${formatPercentage(profitData.gourmetBonus || 0, 1)}): ${itemsPerAction.toFixed(2)}/action @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatPerAction(revPerAction)}/action`;
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.processingConversions && profitData.processingConversions.length > 0) {
        const netProcessingPerAction = (profitData.processingRevenueBonus || 0) / actionsPerHour;
        const netProcessingLabel = formatMissingLabel(
            processingMissing,
            `${netProcessingPerAction >= 0 ? '+' : '-'}${formatPerAction(Math.abs(netProcessingPerAction))}`
        );
        const processingContent = document.createElement('div');

        for (const conversion of profitData.processingConversions) {
            const rawConsumedPerAction =
                conversion.rawConsumedPerAction ?? conversion.rawConsumedPerHour / actionsPerHour;
            const conversionsPerAction =
                conversion.conversionsPerAction ?? conversion.conversionsPerHour / actionsPerHour;
            const consumedRevenuePerAction = rawConsumedPerAction * conversion.rawPriceEach;
            const producedRevenuePerAction = conversionsPerAction * conversion.processedPriceEach;
            const missingPriceNote = getMissingPriceIndicator(conversion.missingPrice);

            const consumedLine = document.createElement('div');
            consumedLine.style.marginLeft = '8px';
            consumedLine.textContent = `• ${conversion.rawItem} consumed: -${rawConsumedPerAction.toFixed(2)}/action @ ${formatWithSeparator(conversion.rawPriceEach)}${missingPriceNote} → -${formatPerAction(consumedRevenuePerAction)}/action`;
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            producedLine.textContent = `• ${conversion.processedItem} produced: ${conversionsPerAction.toFixed(2)}/action @ ${formatWithSeparator(conversion.processedPriceEach)}${missingPriceNote} → ${formatPerAction(producedRevenuePerAction)}/action`;
            processingContent.appendChild(producedLine);
        }

        const processingSection = createCollapsibleSection(
            '',
            `• Processing (${formatPercentage(profitData.processingBonus || 0, 1)} proc): Net ${netProcessingLabel}/action`,
            null,
            processingContent,
            false,
            1
        );
        primaryDropsContent.appendChild(processingSection);
    }

    const baseRevenuePerAction =
        profitData.baseOutputs?.reduce((sum, o) => {
            const rev = o.revenuePerAction ?? o.revenuePerHour / actionsPerHour;
            return sum + rev;
        }, 0) || 0;
    const gourmetRevenuePerAction = (profitData.gourmetRevenueBonus || 0) / actionsPerHour;
    const processingRevenuePerAction = (profitData.processingRevenueBonus || 0) / actionsPerHour;
    const primaryRevenuePerAction = baseRevenuePerAction + gourmetRevenuePerAction + processingRevenuePerAction;
    const primaryRevenueLabel = formatMissingLabel(
        primaryMissing,
        `${formatPerAction(primaryRevenuePerAction)}/action`
    );
    const outputItemCount =
        (profitData.baseOutputs?.length || 0) +
        (profitData.processingConversions && profitData.processingConversions.length > 0 ? 1 : 0);
    const primaryDropsSection = createCollapsibleSection(
        '',
        `Primary Outputs: ${primaryRevenueLabel} (${outputItemCount} item${outputItemCount !== 1 ? 's' : ''})`,
        null,
        primaryDropsContent,
        false,
        1
    );

    // Bonus Drops subsections
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const dropsPA = dropsPerHour / actionsPerHour;
            const revenuePA = revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPA.toFixed(4)}/action (${dropRatePct}) → ${formatPerAction(revenuePA)}/action`;
            essenceContent.appendChild(line);
        }

        const essenceRevenuePerAction = essenceDrops.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const essenceRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(essenceRevenuePerAction)}/action`
        );
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${essenceRevenueLabel} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(2)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const dropsPA = dropsPerHour / actionsPerHour;
            const revenuePA = revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPA.toFixed(4)}/action (${dropRatePct}) → ${formatPerAction(revenuePA)}/action`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenuePerAction = rareFinds.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const rareFindRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(rareFindRevenuePerAction)}/action`
        );
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindSummary})`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(primaryDropsSection);
    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    const costsLabel = formatMissingLabel(costsMissing, `${formatPerAction(costsPerAction)}/action`);
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const drinksPA = drink.drinksPerHour / actionsPerHour;
            const costPA = drink.costPerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(drink.missingPrice);
            line.textContent = `• ${drink.name}: ${drinksPA.toFixed(2)}/action @ ${formatWithSeparator(drink.priceEach)}${missingPriceNote} each → ${formatPerAction(costPA)}/action`;
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsLabel = formatMissingLabel(drinkCostsMissing, `${formatPerAction(drinkCostPerAction)}/action`);
    const drinkCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${drinkCostsLabel} (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
        null,
        drinkCostsContent,
        false,
        1
    );

    costsDiv.appendChild(drinkCostsSection);

    // Market Tax subsection
    const marketTaxContent = document.createElement('div');
    const marketTaxLine = document.createElement('div');
    marketTaxLine.style.marginLeft = '8px';
    const marketTaxLabel = formatMissingLabel(marketTaxMissing, `${formatPerAction(marketTaxPerAction)}/action`);
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxLabel} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Assemble
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    // Top-level content with net profit
    const topLevelContent = document.createElement('div');
    const profitColor = netMissing ? config.SCRIPT_COLOR_ALERT : profitPerAction >= 0 ? '#4ade80' : config.COLOR_LOSS;
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = netMissing
        ? 'Net Profit: -- ⚠'
        : `Net Profit: ${formatPerAction(profitPerAction)}/action`;
    topLevelContent.appendChild(netProfitLine);

    const summarySection = createCollapsibleSection(
        '',
        `Revenue: ${formatMissingLabel(revenueMissing, `${formatPerAction(revenuePerAction)}/action`)} | Costs: ${formatMissingLabel(costsMissing, `${formatPerAction(costsPerAction)}/action`)}`,
        null,
        detailsContent,
        false,
        1
    );
    topLevelContent.appendChild(summarySection);

    return createCollapsibleSection('🔢', 'Per action breakdown', null, topLevelContent, false, 0);
}

/**
 * Build "Per action breakdown" section for production actions
 * @param {Object} profitData - Profit calculation data
 * @returns {HTMLElement} Breakdown section element
 */
function buildProductionPerActionBreakdown(profitData) {
    const actionsPerHour = profitData.actionsPerHour;
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;
    const outputMissing = profitData.outputPriceMissing || false;
    const outputEstimated = profitData.outputPriceEstimated || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const materialMissing = profitData.materialCosts?.some((material) => material.missingPrice) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice) || false;
    const revenueMissing = (outputMissing && !outputEstimated) || bonusMissing;
    const revenueEstimated = outputEstimated && !revenueMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const costsEstimated = revenueEstimated && !costsMissing;
    const marketTaxMissing = revenueMissing;
    const marketTaxEstimated = revenueEstimated && !marketTaxMissing;
    const netMissing = profitData.hasMissingPrices;
    const netEstimated = (revenueEstimated || costsEstimated) && !netMissing;

    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const bonusRevenueTotal = profitData.bonusRevenue?.totalBonusRevenue || 0;
    const outputAmount = profitData.outputAmount || 1;

    // Per-action values (base, no efficiency multiplier — this section shows one action's true cost/revenue)
    const baseItemsPerAction = outputAmount;
    const baseRevenuePerAction = baseItemsPerAction * profitData.outputPrice;
    const gourmetItemsPerAction = baseItemsPerAction * (profitData.gourmetBonus || 0);
    const gourmetRevenuePerAction = gourmetItemsPerAction * profitData.outputPrice;
    const bonusRevenuePerAction = bonusRevenueTotal / actionsPerHour;
    const revenuePerAction = baseRevenuePerAction + gourmetRevenuePerAction + bonusRevenuePerAction;
    const marketTaxPerAction = revenuePerAction * MARKET_TAX;
    const materialCostPerAction = profitData.totalMaterialCost; // per-action cost is fixed, unaffected by efficiency
    const teaCostPerAction = profitData.totalTeaCostPerHour / actionsPerHour;
    const costsPerAction = materialCostPerAction + teaCostPerAction + marketTaxPerAction;
    const profitPerAction = revenuePerAction - costsPerAction;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing
        ? '-- ⚠'
        : revenueEstimated
          ? `${formatPerAction(revenuePerAction)}/action ⚠`
          : `${formatPerAction(revenuePerAction)}/action`;
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(
        profitData.outputPriceMissing || profitData.outputPriceEstimated
    );
    baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${baseItemsPerAction.toFixed(2)}/action @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatPerAction(baseRevenuePerAction)}/action`;
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonus > 0) {
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatPercentage(profitData.gourmetBonus, 1)}): ${gourmetItemsPerAction.toFixed(2)}/action @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatPerAction(gourmetRevenuePerAction)}/action`;
        primaryOutputContent.appendChild(gourmetLine);
    }

    const primaryRevenuePerAction = baseRevenuePerAction + gourmetRevenuePerAction;
    const primaryOutputLabel =
        outputMissing && !outputEstimated
            ? '-- ⚠'
            : outputEstimated
              ? `${formatPerAction(primaryRevenuePerAction)}/action ⚠`
              : `${formatPerAction(primaryRevenuePerAction)}/action`;
    const gourmetLabel =
        profitData.gourmetBonus > 0 ? ` (${formatPercentage(profitData.gourmetBonus, 1)} gourmet)` : '';
    const primaryOutputSection = createCollapsibleSection(
        '',
        `Primary Outputs: ${primaryOutputLabel}${gourmetLabel}`,
        null,
        primaryOutputContent,
        false,
        1
    );

    revenueDiv.appendChild(primaryOutputSection);

    // Bonus Drops subsections
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const dropsPA = dropsPerHour / actionsPerHour;
            const revenuePA = revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPA.toFixed(4)}/action (${dropRatePct}) → ${formatPerAction(revenuePA)}/action`;
            essenceContent.appendChild(line);
        }

        const essenceRevenuePerAction = essenceDrops.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const essenceRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(essenceRevenuePerAction)}/action`
        );
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${essenceRevenueLabel} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(2)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const { dropsPerHour, revenuePerHour } = getBonusDropPerHourTotals(drop, efficiencyMultiplier);
            const dropsPA = dropsPerHour / actionsPerHour;
            const revenuePA = revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${dropsPA.toFixed(4)}/action (${dropRatePct}) → ${formatPerAction(revenuePA)}/action`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenuePerAction = rareFinds.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const rareFindRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(rareFindRevenuePerAction)}/action`
        );
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindSummary})`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    const costsLabel = costsMissing
        ? '-- ⚠'
        : costsEstimated
          ? `${formatPerAction(costsPerAction)}/action ⚠`
          : `${formatPerAction(costsPerAction)}/action`;
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        for (const material of profitData.materialCosts) {
            const amountPerAction = material.amount; // per-action quantity is fixed, unaffected by efficiency
            const costPerAction = material.totalCost; // per-action cost is fixed, unaffected by efficiency
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            let materialText = `• ${material.itemName}: ${amountPerAction.toFixed(2)}/action`;

            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseAmountPerAction = material.baseAmount; // per-action quantity is fixed, unaffected by efficiency
                materialText += ` (${baseAmountPerAction.toFixed(2)} base -${formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
            }

            const missingPriceNote = getMissingPriceIndicator(material.missingPrice);
            materialText += ` @ ${formatWithSeparator(Math.round(material.askPrice))}${missingPriceNote} → ${formatPerAction(costPerAction)}/action`;

            line.textContent = materialText;
            materialCostsContent.appendChild(line);
        }
    }

    const materialCostsLabel = formatMissingLabel(materialMissing, `${formatPerAction(materialCostPerAction)}/action`);
    const materialCostsSection = createCollapsibleSection(
        '',
        `Material Costs: ${materialCostsLabel} (${profitData.materialCosts?.length || 0} material${profitData.materialCosts?.length !== 1 ? 's' : ''})`,
        null,
        materialCostsContent,
        false,
        1
    );

    // Tea Costs subsection
    const teaCostsContent = document.createElement('div');
    if (profitData.teaCosts && profitData.teaCosts.length > 0) {
        for (const tea of profitData.teaCosts) {
            const drinksPA = tea.drinksPerHour / actionsPerHour;
            const costPA = tea.totalCost / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(tea.missingPrice);
            line.textContent = `• ${tea.itemName}: ${drinksPA.toFixed(2)}/action @ ${formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} each → ${formatPerAction(costPA)}/action`;
            teaCostsContent.appendChild(line);
        }
    }

    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsLabel = formatMissingLabel(teaMissing, `${formatPerAction(teaCostPerAction)}/action`);
    const teaCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${teaCostsLabel} (${teaCount} drink${teaCount !== 1 ? 's' : ''})`,
        null,
        teaCostsContent,
        false,
        1
    );

    costsDiv.appendChild(materialCostsSection);
    costsDiv.appendChild(teaCostsSection);

    // Market Tax subsection
    const marketTaxContent = document.createElement('div');
    const marketTaxLine = document.createElement('div');
    marketTaxLine.style.marginLeft = '8px';
    const marketTaxLabel = marketTaxMissing
        ? '-- ⚠'
        : marketTaxEstimated
          ? `${formatPerAction(marketTaxPerAction)}/action ⚠`
          : `${formatPerAction(marketTaxPerAction)}/action`;
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxLabel} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Assemble
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    // Top-level content with net profit
    const topLevelContent = document.createElement('div');
    const profitColor = netMissing ? config.SCRIPT_COLOR_ALERT : profitPerAction >= 0 ? '#4ade80' : config.COLOR_LOSS;
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = netMissing
        ? 'Net Profit: -- ⚠'
        : netEstimated
          ? `Net Profit: ${formatPerAction(profitPerAction)}/action ⚠`
          : `Net Profit: ${formatPerAction(profitPerAction)}/action`;
    topLevelContent.appendChild(netProfitLine);

    const revenueSummaryLabel = revenueMissing
        ? '-- ⚠'
        : revenueEstimated
          ? `${formatPerAction(revenuePerAction)}/action ⚠`
          : `${formatPerAction(revenuePerAction)}/action`;
    const costsSummaryLabel = costsMissing
        ? '-- ⚠'
        : costsEstimated
          ? `${formatPerAction(costsPerAction)}/action ⚠`
          : `${formatPerAction(costsPerAction)}/action`;
    const summarySection = createCollapsibleSection(
        '',
        `Revenue: ${revenueSummaryLabel} | Costs: ${costsSummaryLabel}`,
        null,
        detailsContent,
        false,
        1
    );
    topLevelContent.appendChild(summarySection);

    return createCollapsibleSection('🔢', 'Per action breakdown', null, topLevelContent, false, 0);
}

/**
 * Build "X actions breakdown" section for gathering actions
 * @param {Object} profitData - Profit calculation data
 * @param {number} actionsCount - Number of actions from input field
 * @returns {HTMLElement} Breakdown section element
 */
function buildGatheringActionsBreakdown(profitData, actionsCount) {
    const totals = calculateGatheringActionTotalsFromBase({
        actionsCount,
        actionsPerHour: profitData.actionsPerHour,
        baseOutputs: profitData.baseOutputs,
        bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
        processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
        gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
        drinkCostPerHour: profitData.drinkCostPerHour,
        efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
    });
    const hoursNeeded = totals.hoursNeeded;

    // Calculate totals
    const baseMissing = profitData.baseOutputs?.some((output) => output.missingPrice) || false;
    const gourmetMissing = profitData.gourmetBonuses?.some((output) => output.missingPrice) || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const processingMissing = profitData.processingConversions?.some((conversion) => conversion.missingPrice) || false;
    const primaryMissing = baseMissing || gourmetMissing || processingMissing;
    const revenueMissing = primaryMissing || bonusMissing;
    const drinkCostsMissing = profitData.drinkCosts?.some((drink) => drink.missingPrice) || false;
    const costsMissing = drinkCostsMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices;
    const totalRevenue = Math.round(totals.totalRevenue);
    const totalMarketTax = Math.round(totals.totalMarketTax);
    const totalDrinkCosts = Math.round(totals.totalDrinkCost);
    const totalCosts = Math.round(totals.totalCosts);
    const totalProfit = Math.round(totals.totalProfit);

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = formatMissingLabel(revenueMissing, formatLargeNumber(totalRevenue));
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryDropsContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / profitData.actionsPerHour;
            const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / profitData.actionsPerHour;
            const totalItems = itemsPerAction * actionsCount;
            const totalRevenueLine = revenuePerAction * actionsCount;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
            line.textContent = `• ${output.name} (Base): ${totalItems.toFixed(2)} items @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.gourmetBonuses && profitData.gourmetBonuses.length > 0) {
        for (const output of profitData.gourmetBonuses) {
            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / profitData.actionsPerHour;
            const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / profitData.actionsPerHour;
            const totalItems = itemsPerAction * actionsCount;
            const totalRevenueLine = revenuePerAction * actionsCount;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
            line.textContent = `• ${output.name} (Gourmet ${formatPercentage(profitData.gourmetBonus || 0, 1)}): ${totalItems.toFixed(2)} items @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.processingConversions && profitData.processingConversions.length > 0) {
        const totalProcessingRevenue = totals.totalProcessingRevenue;
        const processingLabel = formatMissingLabel(
            processingMissing,
            `${totalProcessingRevenue >= 0 ? '+' : '-'}${formatLargeNumber(Math.abs(Math.round(totalProcessingRevenue)))}`
        );
        const processingContent = document.createElement('div');

        for (const conversion of profitData.processingConversions) {
            const conversionsPerAction =
                conversion.conversionsPerAction ?? conversion.conversionsPerHour / profitData.actionsPerHour;
            const rawConsumedPerAction =
                conversion.rawConsumedPerAction ?? conversion.rawConsumedPerHour / profitData.actionsPerHour;
            const totalConsumed = rawConsumedPerAction * actionsCount;
            const totalProduced = conversionsPerAction * actionsCount;
            const consumedRevenue = totalConsumed * conversion.rawPriceEach;
            const producedRevenue = totalProduced * conversion.processedPriceEach;
            const missingPriceNote = getMissingPriceIndicator(conversion.missingPrice);

            const consumedLine = document.createElement('div');
            consumedLine.style.marginLeft = '8px';
            consumedLine.textContent = `• ${conversion.rawItem} consumed: -${totalConsumed.toFixed(2)} items @ ${formatWithSeparator(conversion.rawPriceEach)}${missingPriceNote} → -${formatLargeNumber(Math.round(consumedRevenue))}`;
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            producedLine.textContent = `• ${conversion.processedItem} produced: ${totalProduced.toFixed(2)} items @ ${formatWithSeparator(conversion.processedPriceEach)}${missingPriceNote} → ${formatLargeNumber(Math.round(producedRevenue))}`;
            processingContent.appendChild(producedLine);
        }

        const processingSection = createCollapsibleSection(
            '',
            `• Processing (${formatPercentage(profitData.processingBonus || 0, 1)} proc): Net ${processingLabel}`,
            null,
            processingContent,
            false,
            1
        );
        primaryDropsContent.appendChild(processingSection);
    }

    const baseRevenue =
        profitData.baseOutputs?.reduce((sum, output) => {
            const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / profitData.actionsPerHour;
            return sum + revenuePerAction * actionsCount;
        }, 0) || 0;
    const gourmetRevenue = totals.totalGourmetRevenue;
    const processingRevenue = totals.totalProcessingRevenue;
    const primaryRevenue = baseRevenue + gourmetRevenue + processingRevenue;
    const primaryRevenueLabel = formatMissingLabel(primaryMissing, formatLargeNumber(Math.round(primaryRevenue)));
    const outputItemCount =
        (profitData.baseOutputs?.length || 0) +
        (profitData.processingConversions && profitData.processingConversions.length > 0 ? 1 : 0);
    const primaryDropsSection = createCollapsibleSection(
        '',
        `Primary Outputs: ${primaryRevenueLabel} (${outputItemCount} item${outputItemCount !== 1 ? 's' : ''})`,
        null,
        primaryDropsContent,
        false,
        1
    );

    // Bonus Drops subsections (bonus drops are per action)
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const { totalDrops, totalRevenue } = getBonusDropTotalsForActions(
                drop,
                actionsCount,
                profitData.actionsPerHour
            );
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenue))}`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, drop) => {
            return sum + getBonusDropTotalsForActions(drop, actionsCount, profitData.actionsPerHour).totalRevenue;
        }, 0);
        const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(essenceRevenue)));
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${essenceRevenueLabel} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(2)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    // Rare Finds subsection
    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const { totalDrops, totalRevenue } = getBonusDropTotalsForActions(
                drop,
                actionsCount,
                profitData.actionsPerHour
            );
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenue))}`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, drop) => {
            return sum + getBonusDropTotalsForActions(drop, actionsCount, profitData.actionsPerHour).totalRevenue;
        }, 0);
        const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(rareFindRevenue)));
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindSummary})`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(primaryDropsSection);
    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    const costsLabel = costsMissing ? '-- ⚠' : formatLargeNumber(totalCosts);
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const totalDrinks = drink.drinksPerHour * hoursNeeded;
            const totalCostLine = drink.costPerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(drink.missingPrice);
            line.textContent = `• ${drink.name}: ${totalDrinks.toFixed(2)} drinks @ ${formatWithSeparator(drink.priceEach)}${missingPriceNote} → ${formatLargeNumber(Math.round(totalCostLine))}`;
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsLabel = drinkCostsMissing ? '-- ⚠' : formatLargeNumber(totalDrinkCosts);
    const drinkCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${drinkCostsLabel} (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
        null,
        drinkCostsContent,
        false,
        1
    );

    costsDiv.appendChild(drinkCostsSection);

    // Market Tax subsection
    const marketTaxContent = document.createElement('div');
    const marketTaxLine = document.createElement('div');
    marketTaxLine.style.marginLeft = '8px';
    const marketTaxLabel = marketTaxMissing ? '-- ⚠' : formatLargeNumber(totalMarketTax);
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxHeader = marketTaxMissing ? '-- ⚠' : formatLargeNumber(totalMarketTax);
    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxHeader} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Assemble breakdown
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    // Add Net Profit at top
    const topLevelContent = document.createElement('div');
    const profitColor = netMissing ? config.SCRIPT_COLOR_ALERT : totalProfit >= 0 ? '#4ade80' : config.COLOR_LOSS;
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = netMissing ? 'Net Profit: -- ⚠' : `Net Profit: ${formatLargeNumber(totalProfit)}`;
    topLevelContent.appendChild(netProfitLine);

    const actionsSummary = `Revenue: ${formatMissingLabel(revenueMissing, formatLargeNumber(totalRevenue))} | Costs: ${formatMissingLabel(
        costsMissing,
        formatLargeNumber(totalCosts)
    )}`;
    const actionsBreakdownSection = createCollapsibleSection('', actionsSummary, null, detailsContent, false, 1);
    topLevelContent.appendChild(actionsBreakdownSection);

    const mainSection = createCollapsibleSection(
        '📋',
        `${formatWithSeparator(actionsCount)} actions breakdown`,
        null,
        topLevelContent,
        false,
        0
    );
    mainSection.className = 'mwi-collapsible-section mwi-actions-breakdown';

    return mainSection;
}

/**
 * Build "X actions breakdown" section for production actions
 * @param {Object} profitData - Profit calculation data
 * @param {number} actionsCount - Number of actions from input field
 * @returns {HTMLElement} Breakdown section element
 */
function buildProductionActionsBreakdown(profitData, actionsCount) {
    // Calculate queued actions breakdown
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;
    const outputMissing = profitData.outputPriceMissing || false;
    const outputEstimated = profitData.outputPriceEstimated || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const materialMissing = profitData.materialCosts?.some((material) => material.missingPrice) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice) || false;
    const revenueMissing = (outputMissing && !outputEstimated) || bonusMissing;
    const revenueEstimated = outputEstimated && !revenueMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const costsEstimated = revenueEstimated && !costsMissing;
    const marketTaxMissing = revenueMissing;
    const marketTaxEstimated = revenueEstimated && !marketTaxMissing;
    const netMissing = profitData.hasMissingPrices;
    const netEstimated = (revenueEstimated || costsEstimated) && !netMissing;
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const totals = calculateProductionActionTotalsFromBase({
        actionsCount,
        actionsPerHour: profitData.actionsPerHour,
        outputAmount: profitData.outputAmount || 1,
        outputPrice: profitData.outputPrice,
        gourmetBonus: profitData.gourmetBonus || 0,
        bonusDrops,
        materialCosts: profitData.materialCosts,
        totalTeaCostPerHour: profitData.totalTeaCostPerHour,
        efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
    });
    const totalRevenue = Math.round(totals.totalRevenue);
    const totalMarketTax = Math.round(totals.totalMarketTax);
    const totalCosts = Math.round(totals.totalCosts);
    const totalProfit = Math.round(totals.totalProfit);

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing
        ? '-- ⚠'
        : revenueEstimated
          ? `${formatLargeNumber(totalRevenue)} ⚠`
          : formatLargeNumber(totalRevenue);
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const totalBaseItems = totals.totalBaseItems;
    const totalBaseRevenue = totals.totalBaseRevenue;
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(
        profitData.outputPriceMissing || profitData.outputPriceEstimated
    );
    baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${totalBaseItems.toFixed(2)} items @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(totalBaseRevenue))}`;
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonus > 0) {
        const totalGourmetItems = totals.totalGourmetItems;
        const totalGourmetRevenue = totals.totalGourmetRevenue;
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatPercentage(profitData.gourmetBonus, 1)}): ${totalGourmetItems.toFixed(2)} items @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(totalGourmetRevenue))}`;
        primaryOutputContent.appendChild(gourmetLine);
    }

    const primaryRevenue = totals.totalBaseRevenue + totals.totalGourmetRevenue;
    const primaryOutputLabel =
        outputMissing && !outputEstimated
            ? '-- ⚠'
            : outputEstimated
              ? `${formatLargeNumber(Math.round(primaryRevenue))} ⚠`
              : formatLargeNumber(Math.round(primaryRevenue));
    const gourmetLabel =
        profitData.gourmetBonus > 0 ? ` (${formatPercentage(profitData.gourmetBonus, 1)} gourmet)` : '';
    const primaryOutputSection = createCollapsibleSection(
        '',
        `Primary Outputs: ${primaryOutputLabel}${gourmetLabel}`,
        null,
        primaryOutputContent,
        false,
        1
    );

    revenueDiv.appendChild(primaryOutputSection);

    // Bonus Drops subsections
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const dropsPerAction =
                drop.dropsPerAction ?? calculateProfitPerAction(drop.dropsPerHour, profitData.actionsPerHour);
            const revenuePerAction =
                drop.revenuePerAction ?? calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
            const totalDrops = dropsPerAction * actionsCount;
            const totalRevenueLine = revenuePerAction * actionsCount;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, drop) => {
            const revenuePerAction =
                drop.revenuePerAction ?? calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
            return sum + revenuePerAction * actionsCount;
        }, 0);
        const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(essenceRevenue)));
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${essenceRevenueLabel} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(2)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    // Rare Finds subsection
    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const dropsPerAction =
                drop.dropsPerAction ?? calculateProfitPerAction(drop.dropsPerHour, profitData.actionsPerHour);
            const revenuePerAction =
                drop.revenuePerAction ?? calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
            const totalDrops = dropsPerAction * actionsCount;
            const totalRevenueLine = revenuePerAction * actionsCount;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, drop) => {
            const revenuePerAction =
                drop.revenuePerAction ?? calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
            return sum + revenuePerAction * actionsCount;
        }, 0);
        const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(rareFindRevenue)));
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindSummary})`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    const costsLabel = costsMissing
        ? '-- ⚠'
        : costsEstimated
          ? `${formatLargeNumber(totalCosts)} ⚠`
          : formatLargeNumber(totalCosts);
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        for (const material of profitData.materialCosts) {
            const totalMaterial = material.amount * actionsCount * efficiencyMultiplier;
            const totalMaterialCost = material.totalCost * actionsCount * efficiencyMultiplier;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            let materialText = `• ${material.itemName}: ${totalMaterial.toFixed(2)} items`;

            // Add Artisan reduction info if present
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseTotalAmount = material.baseAmount * actionsCount * efficiencyMultiplier;
                materialText += ` (${baseTotalAmount.toFixed(2)} base -${formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
            }

            const missingPriceNote = getMissingPriceIndicator(material.missingPrice);
            materialText += ` @ ${formatWithSeparator(Math.round(material.askPrice))}${missingPriceNote} → ${formatLargeNumber(Math.round(totalMaterialCost))}`;

            line.textContent = materialText;
            materialCostsContent.appendChild(line);
        }
    }

    const totalMaterialCost = totals.totalMaterialCost;
    const materialCostsLabel = formatMissingLabel(materialMissing, formatLargeNumber(Math.round(totalMaterialCost)));
    const materialCostsSection = createCollapsibleSection(
        '',
        `Material Costs: ${materialCostsLabel} (${profitData.materialCosts?.length || 0} material${profitData.materialCosts?.length !== 1 ? 's' : ''})`,
        null,
        materialCostsContent,
        false,
        1
    );

    // Tea Costs subsection
    const teaCostsContent = document.createElement('div');
    if (profitData.teaCosts && profitData.teaCosts.length > 0) {
        for (const tea of profitData.teaCosts) {
            const totalDrinks = tea.drinksPerHour * totals.hoursNeeded;
            const totalTeaCost = tea.totalCost * totals.hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(tea.missingPrice);
            line.textContent = `• ${tea.itemName}: ${totalDrinks.toFixed(2)} drinks @ ${formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} → ${formatLargeNumber(Math.round(totalTeaCost))}`;
            teaCostsContent.appendChild(line);
        }
    }

    const totalTeaCost = totals.totalTeaCost;
    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsLabel = formatMissingLabel(teaMissing, formatLargeNumber(Math.round(totalTeaCost)));
    const teaCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${teaCostsLabel} (${teaCount} drink${teaCount !== 1 ? 's' : ''})`,
        null,
        teaCostsContent,
        false,
        1
    );

    costsDiv.appendChild(materialCostsSection);
    costsDiv.appendChild(teaCostsSection);

    // Market Tax subsection
    const marketTaxContent = document.createElement('div');
    const marketTaxLine = document.createElement('div');
    marketTaxLine.style.marginLeft = '8px';
    const marketTaxLabel = marketTaxMissing
        ? '-- ⚠'
        : marketTaxEstimated
          ? `${formatLargeNumber(totalMarketTax)} ⚠`
          : formatLargeNumber(totalMarketTax);
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxHeader = marketTaxLabel;
    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxHeader} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Assemble breakdown
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    // Add Net Profit at top
    const topLevelContent = document.createElement('div');
    const profitColor = netMissing ? config.SCRIPT_COLOR_ALERT : totalProfit >= 0 ? '#4ade80' : config.COLOR_LOSS;
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = netMissing
        ? 'Net Profit: -- ⚠'
        : netEstimated
          ? `Net Profit: ${formatLargeNumber(totalProfit)} ⚠`
          : `Net Profit: ${formatLargeNumber(totalProfit)}`;
    topLevelContent.appendChild(netProfitLine);

    const revenueDisplay = revenueMissing
        ? '-- ⚠'
        : revenueEstimated
          ? `${formatLargeNumber(totalRevenue)} ⚠`
          : formatLargeNumber(totalRevenue);
    const costsDisplay = costsMissing
        ? '-- ⚠'
        : costsEstimated
          ? `${formatLargeNumber(totalCosts)} ⚠`
          : formatLargeNumber(totalCosts);
    const actionsSummary = `Revenue: ${revenueDisplay} | Costs: ${costsDisplay}`;
    const actionsBreakdownSection = createCollapsibleSection('', actionsSummary, null, detailsContent, false, 1);
    topLevelContent.appendChild(actionsBreakdownSection);

    const mainSection = createCollapsibleSection(
        '📋',
        `${formatWithSeparator(actionsCount)} actions breakdown`,
        null,
        topLevelContent,
        false,
        0
    );
    mainSection.className = 'mwi-collapsible-section mwi-actions-breakdown';

    return mainSection;
}
