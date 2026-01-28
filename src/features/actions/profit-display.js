/**
 * Profit Display Functions
 *
 * Handles displaying profit calculations in action panels for:
 * - Gathering actions (Foraging, Woodcutting, Milking)
 * - Production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
 */

import config from '../../core/config.js';
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

/**
 * Display gathering profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 * @param {string} dropTableSelector - CSS selector for drop table element
 */
export async function displayGatheringProfit(panel, actionHrid, dropTableSelector) {
    // Calculate profit
    const profitData = await calculateGatheringProfit(actionHrid);
    if (!profitData) {
        console.error('❌ Gathering profit calculation failed for:', actionHrid);
        return;
    }

    // Check if we already added profit display
    const existingProfit = panel.querySelector('#mwi-foraging-profit');
    if (existingProfit) {
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

    // ===== Build Detailed Breakdown Content =====
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
            consumedLine.textContent = `• ${conversion.rawItem} consumed: -${conversion.rawConsumedPerHour.toFixed(1)}/hr @ ${formatWithSeparator(conversion.rawPriceEach)}${consumedMissingNote} → -${formatLargeNumber(Math.round(consumedRevenue))}/hr`;
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            const producedMissingNote = getMissingPriceIndicator(conversion.missingPrice);
            const producedRevenue = conversion.conversionsPerHour * conversion.processedPriceEach;
            producedLine.textContent = `• ${conversion.processedItem} produced: ${conversion.conversionsPerHour.toFixed(1)}/hr @ ${formatWithSeparator(conversion.processedPriceEach)}${producedMissingNote} → ${formatLargeNumber(Math.round(producedRevenue))}/hr`;
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
            `Essence Drops: ${essenceRevenueLabel}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
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
            line.textContent = `• ${drink.name}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(drink.priceEach)}${missingPriceNote} → ${formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
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

    // Modifiers Section
    const modifiersDiv = document.createElement('div');
    modifiersDiv.style.cssText = `
        margin-top: 12px;
        color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
    `;

    const modifierLines = [];

    // Efficiency breakdown
    const effParts = [];
    if (profitData.details.levelEfficiency > 0) {
        effParts.push(`${profitData.details.levelEfficiency}% level`);
    }
    if (profitData.details.houseEfficiency > 0) {
        effParts.push(`${profitData.details.houseEfficiency.toFixed(1)}% house`);
    }
    if (profitData.details.teaEfficiency > 0) {
        effParts.push(`${profitData.details.teaEfficiency.toFixed(1)}% tea`);
    }
    if (profitData.details.equipmentEfficiency > 0) {
        effParts.push(`${profitData.details.equipmentEfficiency.toFixed(1)}% equip`);
    }

    if (effParts.length > 0) {
        modifierLines.push(
            `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
        );
        modifierLines.push(
            `<div style="margin-left: 8px;">• Efficiency: +${profitData.totalEfficiency.toFixed(1)}% (${effParts.join(', ')})</div>`
        );
    }

    // Gathering Quantity
    if (profitData.gatheringQuantity > 0) {
        const gatheringParts = [];
        if (profitData.details.communityBuffQuantity > 0) {
            gatheringParts.push(`${(profitData.details.communityBuffQuantity * 100).toFixed(1)}% community`);
        }
        if (profitData.details.gatheringTeaBonus > 0) {
            gatheringParts.push(`${(profitData.details.gatheringTeaBonus * 100).toFixed(1)}% tea`);
        }
        if (profitData.details.achievementGathering > 0) {
            gatheringParts.push(`${(profitData.details.achievementGathering * 100).toFixed(1)}% achievement`);
        }
        modifierLines.push(
            `<div style="margin-left: 8px;">• Gathering Quantity: +${(profitData.gatheringQuantity * 100).toFixed(1)}% (${gatheringParts.join(', ')})</div>`
        );
    }

    modifiersDiv.innerHTML = modifierLines.join('');

    // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);
    detailsContent.appendChild(modifiersDiv);

    // Create "Detailed Breakdown" collapsible
    const topLevelContent = document.createElement('div');
    topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr | Efficiency: +${profitData.totalEfficiency.toFixed(1)}%</div>
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

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        'Per hour breakdown',
        null,
        detailsContent,
        false,
        0
    );

    topLevelContent.appendChild(detailedBreakdownSection);

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
        }
    }
}

/**
 * Display production profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 * @param {string} dropTableSelector - CSS selector for drop table element
 */
export async function displayProductionProfit(panel, actionHrid, dropTableSelector) {
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
    if (existingProfit) {
        existingProfit.remove();
    }

    // Create top-level summary (bonus revenue now included in profitPerHour)
    const profit = Math.round(profitData.profitPerHour);
    const profitPerDay = Math.round(profitData.profitPerDay);
    const outputMissing = profitData.outputPriceMissing || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const materialMissing = profitData.materialCosts?.some((material) => material.missingPrice) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice) || false;
    const revenueMissing = outputMissing || bonusMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices;
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

    // ===== Build Detailed Breakdown Content =====
    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing ? '-- ⚠' : `${formatLargeNumber(revenue)}/hr`;
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(profitData.outputPriceMissing);
    baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${profitData.itemsPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(profitData.itemsPerHour * profitData.outputPrice))}/hr`;
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonusItems > 0) {
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatPercentage(profitData.gourmetBonus, 1)}): ${profitData.gourmetBonusItems.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(profitData.gourmetBonusItems * profitData.outputPrice))}/hr`;
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
            `Essence Drops: ${essenceRevenueLabel}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
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
    const costsLabel = costsMissing ? '-- ⚠' : `${formatLargeNumber(costs)}/hr`;
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
            let materialText = `• ${material.itemName}: ${amountPerHour.toFixed(1)}/hr`;

            // Add Artisan reduction info if present (only show if actually reduced)
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseAmountPerHour = material.baseAmount * profitData.actionsPerHour * efficiencyMultiplier;
                materialText += ` (${baseAmountPerHour.toFixed(1)} base -${formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
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
            line.textContent = `• ${tea.itemName}: ${tea.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} → ${formatLargeNumber(Math.round(tea.totalCost))}/hr`;
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
    const marketTaxLabel = formatMissingLabel(marketTaxMissing, `${formatLargeNumber(marketTax)}/hr`);
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxHeader = formatMissingLabel(marketTaxMissing, `${formatLargeNumber(marketTax)}/hr`);
    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${marketTaxHeader} (2%)`,
        null,
        marketTaxContent,
        false,
        1
    );

    costsDiv.appendChild(marketTaxSection);

    // Modifiers Section
    const modifiersDiv = document.createElement('div');
    modifiersDiv.style.cssText = `
        margin-top: 12px;
        color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
    `;

    const modifierLines = [];

    // Efficiency breakdown
    const effParts = [];
    if (profitData.levelEfficiency > 0) {
        effParts.push(`${profitData.levelEfficiency}% level`);
    }
    if (profitData.houseEfficiency > 0) {
        effParts.push(`${profitData.houseEfficiency.toFixed(1)}% house`);
    }
    if (profitData.teaEfficiency > 0) {
        effParts.push(`${profitData.teaEfficiency.toFixed(1)}% tea`);
    }
    if (profitData.equipmentEfficiency > 0) {
        effParts.push(`${profitData.equipmentEfficiency.toFixed(1)}% equip`);
    }
    if (profitData.communityEfficiency > 0) {
        effParts.push(`${profitData.communityEfficiency.toFixed(1)}% community`);
    }

    if (effParts.length > 0) {
        modifierLines.push(
            `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
        );
        modifierLines.push(
            `<div style="margin-left: 8px;">• Efficiency: +${profitData.totalEfficiency.toFixed(1)}% (${effParts.join(', ')})</div>`
        );
    }

    // Artisan Bonus (still shown here for reference, also embedded in materials)
    if (profitData.artisanBonus > 0) {
        if (modifierLines.length === 0) {
            modifierLines.push(
                `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
            );
        }
        modifierLines.push(
            `<div style="margin-left: 8px;">• Artisan: -${formatPercentage(profitData.artisanBonus, 1)} material requirement</div>`
        );
    }

    // Gourmet Bonus
    if (profitData.gourmetBonus > 0) {
        if (modifierLines.length === 0) {
            modifierLines.push(
                `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
            );
        }
        modifierLines.push(
            `<div style="margin-left: 8px;">• Gourmet: +${formatPercentage(profitData.gourmetBonus, 1)} bonus items</div>`
        );
    }

    modifiersDiv.innerHTML = modifierLines.join('');

    // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);
    if (modifierLines.length > 0) {
        detailsContent.appendChild(modifiersDiv);
    }

    // Create "Detailed Breakdown" collapsible
    const topLevelContent = document.createElement('div');
    topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr</div>
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

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        'Per hour breakdown',
        null,
        detailsContent,
        false,
        0
    );

    topLevelContent.appendChild(detailedBreakdownSection);

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
        }
    }
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
            line.textContent = `• ${output.name} (Base): ${totalItems.toFixed(1)} items @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
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
            line.textContent = `• ${output.name} (Gourmet ${formatPercentage(profitData.gourmetBonus || 0, 1)}): ${totalItems.toFixed(1)} items @ ${formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
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
            consumedLine.textContent = `• ${conversion.rawItem} consumed: -${totalConsumed.toFixed(1)} items @ ${formatWithSeparator(conversion.rawPriceEach)}${missingPriceNote} → -${formatLargeNumber(Math.round(consumedRevenue))}`;
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            producedLine.textContent = `• ${conversion.processedItem} produced: ${totalProduced.toFixed(1)} items @ ${formatWithSeparator(conversion.processedPriceEach)}${missingPriceNote} → ${formatLargeNumber(Math.round(producedRevenue))}`;
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
            `Essence Drops: ${essenceRevenueLabel} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
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
            line.textContent = `• ${drink.name}: ${totalDrinks.toFixed(1)} drinks @ ${formatWithSeparator(drink.priceEach)}${missingPriceNote} → ${formatLargeNumber(Math.round(totalCostLine))}`;
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
    const outputMissing = profitData.outputPriceMissing || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const materialMissing = profitData.materialCosts?.some((material) => material.missingPrice) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice) || false;
    const revenueMissing = outputMissing || bonusMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices;
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
    const revenueLabel = formatMissingLabel(revenueMissing, formatLargeNumber(totalRevenue));
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const totalBaseItems = totals.totalBaseItems;
    const totalBaseRevenue = totals.totalBaseRevenue;
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(profitData.outputPriceMissing);
    baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${totalBaseItems.toFixed(1)} items @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(totalBaseRevenue))}`;
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonus > 0) {
        const totalGourmetItems = totals.totalGourmetItems;
        const totalGourmetRevenue = totals.totalGourmetRevenue;
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatPercentage(profitData.gourmetBonus, 1)}): ${totalGourmetItems.toFixed(1)} items @ ${formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatLargeNumber(Math.round(totalGourmetRevenue))}`;
        primaryOutputContent.appendChild(gourmetLine);
    }

    const primaryRevenue = totals.totalBaseRevenue + totals.totalGourmetRevenue;
    const primaryOutputLabel = formatMissingLabel(outputMissing, formatLargeNumber(Math.round(primaryRevenue)));
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
            `Essence Drops: ${essenceRevenueLabel} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${rareFindRevenueLabel} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
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
    const costsLabel = costsMissing ? '-- ⚠' : formatLargeNumber(totalCosts);
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        for (const material of profitData.materialCosts) {
            const totalMaterial = material.amount * actionsCount;
            const totalMaterialCost = material.totalCost * actionsCount;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            let materialText = `• ${material.itemName}: ${totalMaterial.toFixed(1)} items`;

            // Add Artisan reduction info if present
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseTotalAmount = material.baseAmount * actionsCount;
                materialText += ` (${baseTotalAmount.toFixed(1)} base -${formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
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
            line.textContent = `• ${tea.itemName}: ${totalDrinks.toFixed(1)} drinks @ ${formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} → ${formatLargeNumber(Math.round(totalTeaCost))}`;
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
