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
import { calculateHoursForActions } from '../../utils/profit-helpers.js';

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
    // Revenue is already after tax (calculated with 0.98 multiplier), so calculate gross revenue
    const grossRevenue = Math.round(profitData.revenuePerHour / 0.98);
    const marketTax = Math.round(grossRevenue * 0.02);
    const revenue = grossRevenue;
    const costs = Math.round(profitData.drinkCostPerHour + marketTax);
    const summary = `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day | Total profit: 0`;

    // ===== Build Detailed Breakdown Content =====
    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${formatLargeNumber(revenue)}/hr</div>`;

    // Base Output subsection
    const baseOutputContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            // Show processing percentage for processed items
            if (output.isProcessed && output.processingChance) {
                const processingPercent = formatPercentage(output.processingChance, 1);
                line.textContent = `• ${output.name}: (${processingPercent}) ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)} each → ${formatLargeNumber(Math.round(output.revenuePerHour))}/hr`;
            } else {
                line.textContent = `• ${output.name}: ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)} each → ${formatLargeNumber(Math.round(output.revenuePerHour))}/hr`;
            }

            baseOutputContent.appendChild(line);
        }
    }

    const baseRevenue = profitData.baseOutputs?.reduce((sum, o) => sum + o.revenuePerHour, 0) || 0;
    const baseOutputSection = createCollapsibleSection(
        '',
        `Base Output: ${formatLargeNumber(Math.round(baseRevenue))}/hr (${profitData.baseOutputs?.length || 0} item${profitData.baseOutputs?.length !== 1 ? 's' : ''})`,
        null,
        baseOutputContent,
        false,
        1
    );

    // Bonus Drops subsections - split by type
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const decimals = drop.dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour, 0);
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${formatLargeNumber(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
            const decimals = drop.dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour, 0);
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${formatLargeNumber(Math.round(rareFindRevenue))}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(baseOutputSection);
    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${formatLargeNumber(costs)}/hr</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${drink.name}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(drink.priceEach)} → ${formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${formatLargeNumber(costs)}/hr (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
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
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${formatLargeNumber(marketTax)}/hr`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${formatLargeNumber(marketTax)}/hr (2%)`,
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
    const profitColor = profit >= 0 ? '#4ade80' : config.COLOR_LOSS; // green if positive, red if negative
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = `Net Profit: ${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;
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
        const baseSummary = `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;

        const updateSummary = (newValue) => {
            const inputValue = inputField.value;

            if (inputValue === '∞') {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: ∞`;
            } else if (newValue > 0) {
                // Calculate total profit for selected actions
                const actualAttempts = Math.ceil(newValue / profitData.efficiencyMultiplier);
                const hoursNeeded = calculateHoursForActions(actualAttempts, profitData.actionsPerHour);
                const totalProfit = Math.round(profitData.profitPerHour * hoursNeeded);
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
    const bonusRevenueTotal = profitData.bonusRevenue?.totalBonusRevenue || 0;
    // Use outputPrice (pre-tax) for revenue display
    const revenue = Math.round(
        profitData.itemsPerHour * profitData.outputPrice +
            profitData.gourmetBonusItems * profitData.outputPrice +
            bonusRevenueTotal
    );
    // Calculate market tax (2% of revenue)
    const marketTax = Math.round(revenue * 0.02);
    const costs = Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour + marketTax);
    const summary = `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day | Total profit: 0`;

    // ===== Build Detailed Breakdown Content =====
    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${formatLargeNumber(revenue)}/hr</div>`;

    // Base Output subsection
    const baseOutputContent = document.createElement('div');
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    baseOutputLine.textContent = `• Base Output: ${profitData.itemsPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(profitData.outputPrice))} each → ${formatLargeNumber(Math.round(profitData.itemsPerHour * profitData.outputPrice))}/hr`;
    baseOutputContent.appendChild(baseOutputLine);

    const baseRevenue = profitData.itemsPerHour * profitData.outputPrice;
    const baseOutputSection = createCollapsibleSection(
        '',
        `Base Output: ${formatWithSeparator(Math.round(baseRevenue))}/hr`,
        null,
        baseOutputContent,
        false,
        1
    );

    // Gourmet Bonus subsection
    let gourmetSection = null;
    if (profitData.gourmetBonusItems > 0) {
        const gourmetContent = document.createElement('div');
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• Gourmet Bonus: ${profitData.gourmetBonusItems.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(profitData.outputPrice))} each → ${formatLargeNumber(Math.round(profitData.gourmetBonusItems * profitData.outputPrice))}/hr`;
        gourmetContent.appendChild(gourmetLine);

        const gourmetRevenue = profitData.gourmetBonusItems * profitData.outputPrice;
        gourmetSection = createCollapsibleSection(
            '',
            `Gourmet Bonus: ${formatLargeNumber(Math.round(gourmetRevenue))}/hr (${formatPercentage(profitData.gourmetBonus, 1)} gourmet)`,
            null,
            gourmetContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(baseOutputSection);
    if (gourmetSection) {
        revenueDiv.appendChild(gourmetSection);
    }

    // Bonus Drops subsections - split by type
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const decimals = drop.dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour, 0);
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${formatLargeNumber(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
            const decimals = drop.dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour, 0);
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${formatLargeNumber(Math.round(rareFindRevenue))}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
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
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${formatLargeNumber(costs)}/hr</div>`;

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

            materialText += ` @ ${formatWithSeparator(Math.round(material.askPrice))} → ${formatLargeNumber(Math.round(material.totalCost * profitData.actionsPerHour * efficiencyMultiplier))}/hr`;

            line.textContent = materialText;
            materialCostsContent.appendChild(line);
        }
    }

    const materialCostsSection = createCollapsibleSection(
        '',
        `Material Costs: ${formatLargeNumber(Math.round(profitData.materialCostPerHour))}/hr (${profitData.materialCosts?.length || 0} material${profitData.materialCosts?.length !== 1 ? 's' : ''})`,
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
            line.textContent = `• ${tea.itemName}: ${tea.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(tea.pricePerDrink))} → ${formatLargeNumber(Math.round(tea.totalCost))}/hr`;
            teaCostsContent.appendChild(line);
        }
    }

    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${formatLargeNumber(Math.round(profitData.totalTeaCostPerHour))}/hr (${teaCount} drink${teaCount !== 1 ? 's' : ''})`,
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
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${formatLargeNumber(marketTax)}/hr`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${formatLargeNumber(marketTax)}/hr (2%)`,
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
    const profitColor = profit >= 0 ? '#4ade80' : config.COLOR_LOSS; // green if positive, red if negative
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = `Net Profit: ${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;
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
        const baseSummary = `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;

        const updateSummary = (newValue) => {
            const inputValue = inputField.value;

            if (inputValue === '∞') {
                profitSummaryDiv.textContent = `${baseSummary} | Total profit: ∞`;
            } else if (newValue > 0) {
                // Calculate total profit for selected actions
                const efficiencyMultiplier = profitData.efficiencyMultiplier;
                const actualAttempts = Math.ceil(newValue / efficiencyMultiplier);
                const hoursNeeded = calculateHoursForActions(actualAttempts, profitData.actionsPerHour);
                const totalProfit = Math.round(profitData.profitPerHour * hoursNeeded);
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
    // Calculate actual attempts needed (input is desired output actions)
    const actualAttempts = Math.ceil(actionsCount / profitData.efficiencyMultiplier);
    const hoursNeeded = calculateHoursForActions(actualAttempts, profitData.actionsPerHour);

    // Calculate totals
    const totalRevenue = Math.round(profitData.revenuePerHour * hoursNeeded);
    const totalCosts = Math.round(profitData.drinkCostPerHour * hoursNeeded);
    const totalProfit = totalRevenue - totalCosts;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${formatLargeNumber(totalRevenue)}</div>`;

    // Base Output subsection
    const baseOutputContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const totalItems = (output.itemsPerHour / profitData.actionsPerHour) * actionsCount;
            const totalRevenueLine = output.revenuePerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            if (output.isProcessed && output.processingChance) {
                const processingPercent = formatPercentage(output.processingChance, 1);
                line.textContent = `• ${output.name}: (${processingPercent}) ${totalItems.toFixed(1)} items @ ${formatWithSeparator(output.priceEach)} each → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            } else {
                line.textContent = `• ${output.name}: ${totalItems.toFixed(1)} items @ ${formatWithSeparator(output.priceEach)} each → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            }

            baseOutputContent.appendChild(line);
        }
    }

    const baseRevenue = profitData.baseOutputs?.reduce((sum, o) => sum + o.revenuePerHour * hoursNeeded, 0) || 0;
    const baseOutputSection = createCollapsibleSection(
        '',
        `Base Output: ${formatLargeNumber(Math.round(baseRevenue))} (${profitData.baseOutputs?.length || 0} item${profitData.baseOutputs?.length !== 1 ? 's' : ''})`,
        null,
        baseOutputContent,
        false,
        1
    );

    // Bonus Drops subsections
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const totalDrops = drop.dropsPerHour * hoursNeeded;
            const totalRevenueLine = drop.revenuePerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour * hoursNeeded, 0);
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${formatLargeNumber(Math.round(essenceRevenue))} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
            const totalDrops = drop.dropsPerHour * hoursNeeded;
            const totalRevenueLine = drop.revenuePerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour * hoursNeeded, 0);
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${formatLargeNumber(Math.round(rareFindRevenue))} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(baseOutputSection);
    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${formatLargeNumber(totalCosts)}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const totalDrinks = drink.drinksPerHour * hoursNeeded;
            const totalCostLine = drink.costPerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${drink.name}: ${totalDrinks.toFixed(1)} drinks @ ${formatWithSeparator(drink.priceEach)} → ${formatLargeNumber(Math.round(totalCostLine))}`;
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${formatLargeNumber(totalCosts)} (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
        null,
        drinkCostsContent,
        false,
        1
    );

    costsDiv.appendChild(drinkCostsSection);

    // Assemble breakdown
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);

    // Add Net Profit at top
    const topLevelContent = document.createElement('div');
    const profitColor = totalProfit >= 0 ? '#4ade80' : config.COLOR_LOSS;
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = `Net Profit: ${formatLargeNumber(totalProfit)}`;
    topLevelContent.appendChild(netProfitLine);

    const actionsBreakdownSection = createCollapsibleSection(
        '',
        `Revenue: ${formatLargeNumber(totalRevenue)} | Costs: ${formatLargeNumber(totalCosts)}`,
        null,
        detailsContent,
        false,
        1
    );
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
    // Calculate actual attempts needed (input is desired output actions)
    const efficiencyMultiplier = profitData.efficiencyMultiplier;
    const actualAttempts = Math.ceil(actionsCount / efficiencyMultiplier);
    const hoursNeeded = calculateHoursForActions(actualAttempts, profitData.actionsPerHour);

    // Calculate totals
    const bonusRevenueTotal = profitData.bonusRevenue?.totalBonusRevenue || 0;
    // Use outputPrice (pre-tax) for revenue display
    const totalRevenue = Math.round(
        (profitData.itemsPerHour * profitData.outputPrice +
            profitData.gourmetBonusItems * profitData.outputPrice +
            bonusRevenueTotal) *
            hoursNeeded
    );
    // Calculate market tax (2% of revenue)
    const totalMarketTax = Math.round(totalRevenue * 0.02);
    const totalCosts = Math.round(
        (profitData.materialCostPerHour + profitData.totalTeaCostPerHour) * hoursNeeded + totalMarketTax
    );
    const totalProfit = totalRevenue - totalCosts;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${formatLargeNumber(totalRevenue)}</div>`;

    // Base Output subsection
    const baseOutputContent = document.createElement('div');
    const totalBaseItems = profitData.itemsPerHour * hoursNeeded;
    const totalBaseRevenue = totalBaseItems * profitData.outputPrice;
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    baseOutputLine.textContent = `• Base Output: ${totalBaseItems.toFixed(1)} items @ ${formatWithSeparator(Math.round(profitData.outputPrice))} each → ${formatLargeNumber(Math.round(totalBaseRevenue))}`;
    baseOutputContent.appendChild(baseOutputLine);

    const baseOutputSection = createCollapsibleSection(
        '',
        `Base Output: ${formatLargeNumber(Math.round(totalBaseRevenue))}`,
        null,
        baseOutputContent,
        false,
        1
    );

    // Gourmet Bonus subsection
    let gourmetSection = null;
    if (profitData.gourmetBonusItems > 0) {
        const gourmetContent = document.createElement('div');
        const totalGourmetItems = profitData.gourmetBonusItems * hoursNeeded;
        const totalGourmetRevenue = totalGourmetItems * profitData.outputPrice;
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = `• Gourmet Bonus: ${totalGourmetItems.toFixed(1)} items @ ${formatWithSeparator(Math.round(profitData.outputPrice))} each → ${formatLargeNumber(Math.round(totalGourmetRevenue))}`;
        gourmetContent.appendChild(gourmetLine);

        gourmetSection = createCollapsibleSection(
            '',
            `Gourmet Bonus: ${formatLargeNumber(Math.round(totalGourmetRevenue))} (${formatPercentage(profitData.gourmetBonus, 1)} gourmet)`,
            null,
            gourmetContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(baseOutputSection);
    if (gourmetSection) {
        revenueDiv.appendChild(gourmetSection);
    }

    // Bonus Drops subsections
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter((drop) => drop.type === 'essence');
    const rareFinds = bonusDrops.filter((drop) => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const totalDrops = drop.dropsPerHour * hoursNeeded;
            const totalRevenueLine = drop.revenuePerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour * hoursNeeded, 0);
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${formatLargeNumber(Math.round(essenceRevenue))} (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
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
            const totalDrops = drop.dropsPerHour * hoursNeeded;
            const totalRevenueLine = drop.revenuePerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
            line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatLargeNumber(Math.round(totalRevenueLine))}`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour * hoursNeeded, 0);
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${formatLargeNumber(Math.round(rareFindRevenue))} (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
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
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${formatLargeNumber(totalCosts)}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        const efficiencyMultiplier = profitData.efficiencyMultiplier;
        for (const material of profitData.materialCosts) {
            const totalMaterial = material.amount * actionsCount * efficiencyMultiplier;
            const totalMaterialCost = material.totalCost * actionsCount * efficiencyMultiplier;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            let materialText = `• ${material.itemName}: ${totalMaterial.toFixed(1)} items`;

            // Add Artisan reduction info if present
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseTotalAmount = material.baseAmount * actionsCount * efficiencyMultiplier;
                materialText += ` (${baseTotalAmount.toFixed(1)} base -${formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
            }

            materialText += ` @ ${formatWithSeparator(Math.round(material.askPrice))} → ${formatLargeNumber(Math.round(totalMaterialCost))}`;

            line.textContent = materialText;
            materialCostsContent.appendChild(line);
        }
    }

    const totalMaterialCost = profitData.materialCostPerHour * hoursNeeded;
    const materialCostsSection = createCollapsibleSection(
        '',
        `Material Costs: ${formatLargeNumber(Math.round(totalMaterialCost))} (${profitData.materialCosts?.length || 0} material${profitData.materialCosts?.length !== 1 ? 's' : ''})`,
        null,
        materialCostsContent,
        false,
        1
    );

    // Tea Costs subsection
    const teaCostsContent = document.createElement('div');
    if (profitData.teaCosts && profitData.teaCosts.length > 0) {
        for (const tea of profitData.teaCosts) {
            const totalDrinks = tea.drinksPerHour * hoursNeeded;
            const totalTeaCost = tea.totalCost * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${tea.itemName}: ${totalDrinks.toFixed(1)} drinks @ ${formatWithSeparator(Math.round(tea.pricePerDrink))} → ${formatLargeNumber(Math.round(totalTeaCost))}`;
            teaCostsContent.appendChild(line);
        }
    }

    const totalTeaCost = profitData.totalTeaCostPerHour * hoursNeeded;
    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${formatLargeNumber(Math.round(totalTeaCost))} (${teaCount} drink${teaCount !== 1 ? 's' : ''})`,
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
    marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${formatLargeNumber(totalMarketTax)}`;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        `Market Tax: ${formatLargeNumber(totalMarketTax)} (2%)`,
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
    const profitColor = totalProfit >= 0 ? '#4ade80' : config.COLOR_LOSS;
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = `Net Profit: ${formatLargeNumber(totalProfit)}`;
    topLevelContent.appendChild(netProfitLine);

    const actionsBreakdownSection = createCollapsibleSection(
        '',
        `Revenue: ${formatLargeNumber(totalRevenue)} | Costs: ${formatLargeNumber(totalCosts)}`,
        null,
        detailsContent,
        false,
        1
    );
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
