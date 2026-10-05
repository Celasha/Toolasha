/**
 * Profit Display Functions
 *
 * Handles displaying profit calculations in action panels for:
 * - Gathering actions (Foraging, Woodcutting, Milking)
 * - Production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import dataManager from '../../core/data-manager.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { calculateProductionProfit } from './production-profit.js';
import { formatWithSeparator, formatPercentage, formatLargeNumber } from '../../utils/formatters.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { compactActionPanelSection } from './production-tools-layout.js';
import { findActionInput, attachInputListeners } from '../../utils/action-panel-helper.js';
import {
    calculateProfitPerAction,
    calculateProductionActionTotalsFromBase,
    calculateGatheringActionTotalsFromBase,
} from '../../utils/profit-helpers.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import loadoutState from '../../core/loadout-state.js';
import scrollSimulator from '../combat/scroll-simulator.js';
import { SCROLL_BUFF_ITEMS } from '../../utils/scroll-buff-values.js';

const getMissingPriceIndicator = (isMissing) => (isMissing ? ' ⚠' : '');

/**
 * Build the Market Tax line/section text, branching on excludeSellTax so "producing for personal
 * use" reads as a deliberate state rather than a missing-price/zero-value glitch.
 * @param {boolean} excludeSellTax
 * @param {boolean} missing
 * @param {number} amount
 * @param {string} suffix - e.g. t('profitDisplay.hrSuffix') or actionSuffix
 * @param {boolean} [estimated=false]
 * @returns {{line: string, section: string}}
 */
export function formatMarketTaxText(excludeSellTax, missing, amount, suffix, estimated = false) {
    if (excludeSellTax) {
        return {
            line: t('profitDisplay.marketTaxExcludedLine'),
            section: t('profitDisplay.marketTaxExcludedSectionTitle'),
        };
    }
    const label = missing ? '-- ⚠' : `${formatLargeNumber(amount)}${suffix}${estimated ? ' ⚠' : ''}`;
    return {
        line: t('profitDisplay.marketTaxLine', { pct: MARKET_TAX * 100, label }),
        section: t('profitDisplay.marketTaxSectionTitle', { label, pct: MARKET_TAX * 100 }),
    };
}

/**
 * Build the "sell tax excluded" warning line shown under Net Profit when the toggle is active, so
 * it's visible even to someone who opens the detail panel without noticing the toggle's state.
 * @returns {HTMLElement}
 */
function buildSellTaxExcludedWarning() {
    const warning = document.createElement('div');
    warning.style.cssText = `
        color: ${config.COLOR_WARNING};
        font-size: 0.85em;
        margin-bottom: 8px;
    `;
    warning.textContent = t('profitDisplay.sellTaxExcludedWarning');
    return warning;
}

function getAutomaticLoadoutLabel(actionTypeHrid) {
    if (!actionTypeHrid || !config.getSetting('loadoutSnapshot')) return t('profitDisplay.equippedLabel');
    const selection = loadoutState.findSnapshotSelectionForActionType(actionTypeHrid);
    if (selection.status === 'usable') {
        return t('profitDisplay.loadoutLabelDefault', {
            name: selection.snapshot.name,
            isDefault: selection.snapshot.isDefault,
        });
    }
    if (selection.status === 'unavailable') {
        return t('profitDisplay.loadoutUnavailable', {
            name: selection.snapshot.name || t('profitDisplay.genericLoadoutName'),
        });
    }
    return t('profitDisplay.equippedLabel');
}
export const formatMissingLabel = (isMissing, value) => (isMissing ? '-- ⚠' : value);

let _spriteUrl = null;
function scrollSpriteHtml(buffTypeHrid, size = 14) {
    if (_spriteUrl === null) {
        const el = document.querySelector('use[href*="items_sprite"]');
        _spriteUrl = el ? el.getAttribute('href').split('#')[0] : '';
    }
    const itemSuffix = SCROLL_BUFF_ITEMS[buffTypeHrid];
    if (!_spriteUrl || !itemSuffix) return '';
    return (
        `<svg width="${size}" height="${size}" style="vertical-align:middle;margin-right:3px">` +
        `<use href="${_spriteUrl}#${itemSuffix}"></use></svg>`
    );
}

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
    return t('profitDisplay.rareFindBonusSummary', { value: rareFindBonus.toFixed(2) });
};

/**
 * Display gathering profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 * @param {string} dropTableSelector - CSS selector for drop table element
 */
export async function displayGatheringProfit(panel, actionHrid, dropTableSelector) {
    // Check global hide setting
    if (!config.getSetting('actionPanel_showProfitDetail')) {
        return;
    }

    // Arm scroll simulation before calculations
    const gatheringActionType = dataManager.getActionDetails(actionHrid)?.type;
    dataManager.setScrollSimulation(
        gatheringActionType,
        scrollSimulator.getScrollSetForActionType(gatheringActionType)
    );

    // Calculate profit
    const profitData = await calculateGatheringProfit(actionHrid);
    if (!profitData) {
        dataManager.clearScrollSimulation(gatheringActionType);
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
    const baseMissing = profitData.baseOutputs?.some((output) => output.missingPrice || output.isOutlier) || false;
    const gourmetMissing =
        profitData.gourmetBonuses?.some((output) => output.missingPrice || output.isOutlier) || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const processingMissing =
        profitData.processingConversions?.some((conversion) => conversion.missingPrice || conversion.isOutlier) ||
        false;
    const primaryMissing = baseMissing || gourmetMissing || processingMissing;
    const revenueMissing = primaryMissing || bonusMissing;
    const drinkCostsMissing = profitData.drinkCosts?.some((drink) => drink.missingPrice) || false;
    const costsMissing = drinkCostsMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices || profitData.hasOutlierPrices;
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;
    // Revenue is now gross (pre-tax)
    const revenue = Math.round(profitData.revenuePerHour);
    const marketTax = Math.round(profitData.marketTax);
    const costs = Math.round(profitData.drinkCostPerHour + marketTax);
    const summary = formatMissingLabel(
        netMissing,
        t('profitDisplay.totalProfitSummary', {
            base: t('profitDisplay.perHourPerDay', {
                perHour: `${formatLargeNumber(profit)}${t('profitDisplay.hrSuffix')}`,
                perDay: `${formatLargeNumber(profitPerDay)}${t('profitDisplay.daySuffix')}`,
            }),
            value: '0',
        })
    );

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = formatMissingLabel(
        revenueMissing,
        `${formatLargeNumber(revenue)}${t('profitDisplay.hrSuffix')}`
    );
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">${t('profitDisplay.revenueHeader', { label: revenueLabel })}</div>`;

    // Primary Outputs subsection
    const primaryDropsContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice || output.isOutlier);
            line.textContent = t('profitDisplay.baseOutputLine', {
                name: output.name,
                rate: `${output.itemsPerHour.toFixed(decimals)}${t('profitDisplay.hrSuffix')}`,
                price: formatWithSeparator(output.priceEach),
                missingNote: missingPriceNote,
                revenue: `${formatLargeNumber(Math.round(output.revenuePerHour))}${t('profitDisplay.hrSuffix')}`,
            });
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.gourmetBonuses && profitData.gourmetBonuses.length > 0) {
        for (const output of profitData.gourmetBonuses) {
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice || output.isOutlier);
            line.textContent = t('profitDisplay.gourmetOutputLine', {
                name: output.name,
                pct: formatPercentage(profitData.gourmetBonus || 0, 1),
                rate: `${output.itemsPerHour.toFixed(decimals)}${t('profitDisplay.hrSuffix')}`,
                price: formatWithSeparator(output.priceEach),
                missingNote: missingPriceNote,
                revenue: `${formatLargeNumber(Math.round(output.revenuePerHour))}${t('profitDisplay.hrSuffix')}`,
            });
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
            const consumedMissingNote = getMissingPriceIndicator(conversion.missingPrice || conversion.isOutlier);
            const consumedRevenue = conversion.rawConsumedPerHour * conversion.rawPriceEach;
            consumedLine.textContent = t('profitDisplay.processingConsumedLine', {
                item: conversion.rawItem,
                rate: `${conversion.rawConsumedPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
                price: formatWithSeparator(conversion.rawPriceEach),
                missingNote: consumedMissingNote,
                revenue: `${formatLargeNumber(Math.round(consumedRevenue))}${t('profitDisplay.hrSuffix')}`,
            });
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            const producedMissingNote = getMissingPriceIndicator(conversion.missingPrice || conversion.isOutlier);
            const producedRevenue = conversion.conversionsPerHour * conversion.processedPriceEach;
            producedLine.textContent = t('profitDisplay.processingProducedLine', {
                item: conversion.processedItem,
                rate: `${conversion.conversionsPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
                price: formatWithSeparator(conversion.processedPriceEach),
                missingNote: producedMissingNote,
                revenue: `${formatLargeNumber(Math.round(producedRevenue))}${t('profitDisplay.hrSuffix')}`,
            });
            processingContent.appendChild(producedLine);
        }

        const processingSection = createCollapsibleSection(
            '',
            t('profitDisplay.processingSectionTitle', {
                pct: formatPercentage(profitData.processingBonus || 0, 1),
                net: `${netProcessingLabel}${t('profitDisplay.hrSuffix')}`,
            }),
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
        t('profitDisplay.primaryOutputsHeaderGathering', {
            label: `${primaryRevenueLabel}${t('profitDisplay.hrSuffix')}`,
            count: outputItemCount,
        }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPerHour.toFixed(decimals)}${t('profitDisplay.hrSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatLargeNumber(Math.round(revenuePerHour))}${t('profitDisplay.hrSuffix')}`,
            });
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
            t('profitDisplay.essenceDropsHeader', {
                label: `${essenceRevenueLabel}${t('profitDisplay.hrSuffix')}`,
                count: essenceDrops.length,
                pct: essenceFindBonus.toFixed(2),
            }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPerHour.toFixed(decimals)}${t('profitDisplay.hrSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatLargeNumber(Math.round(revenuePerHour))}${t('profitDisplay.hrSuffix')}`,
            });
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
            t('profitDisplay.rareFindsHeader', {
                label: `${rareFindRevenueLabel}${t('profitDisplay.hrSuffix')}`,
                count: rareFinds.length,
                summary: rareFindSummary,
            }),
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
    const costsLabel = formatMissingLabel(costsMissing, `${formatLargeNumber(costs)}${t('profitDisplay.hrSuffix')}`);
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">${t('profitDisplay.costsHeader', { label: costsLabel })}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(drink.missingPrice || drink.isOutlier);
            line.textContent = t('profitDisplay.drinkCostLineNoEach', {
                name: drink.name,
                rate: `${drink.drinksPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
                price: formatWithSeparator(drink.priceEach),
                missingNote: missingPriceNote,
                revenue: `${formatLargeNumber(Math.round(drink.costPerHour))}${t('profitDisplay.hrSuffix')}`,
            });
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsLabel = drinkCostsMissing ? '-- ⚠' : formatLargeNumber(Math.round(profitData.drinkCostPerHour));
    const drinkCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.drinkCostsHeader', {
            label: `${drinkCostsLabel}${t('profitDisplay.hrSuffix')}`,
            count: drinkCount,
        }),
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
    const marketTaxText = formatMarketTaxText(
        profitData.excludeSellTax,
        marketTaxMissing,
        marketTax,
        t('profitDisplay.hrSuffix')
    );
    marketTaxLine.textContent = marketTaxText.line;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection('', marketTaxText.section, null, marketTaxContent, false, 1);

    costsDiv.appendChild(marketTaxSection);

    // Modifiers Section — collapsible, with each modifier as a nested collapsible
    const modifierSummaryParts = [];
    const modifierSubSections = [];

    // Helper: build a sub-collapsible for a modifier
    const makeModifierSection = (title, total, rows) => {
        const content = document.createElement('div');
        for (const row of rows) {
            const line = document.createElement('div');
            line.innerHTML = row;
            content.appendChild(line);
        }
        return createCollapsibleSection(
            null,
            t('profitDisplay.modifierSectionTitle', { title, total }),
            null,
            content,
            false,
            1
        );
    };

    // Efficiency
    const effRows = [];
    if (profitData.details.levelEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.details.levelEfficiency.toFixed(2),
                label: t('profitDisplay.levelAdvantageLabel'),
            })
        );
    }
    if (profitData.details.houseEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.details.houseEfficiency.toFixed(2),
                label: t('profitDisplay.houseRoomLabel'),
            })
        );
    }
    if (profitData.details.teaEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.details.teaEfficiency.toFixed(2),
                label: t('profitDisplay.teaLabel'),
            })
        );
    }
    if ((profitData.details.equipmentEfficiencyItems || []).length > 0) {
        for (const item of profitData.details.equipmentEfficiencyItems) {
            const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
            effRows.push(`+${item.value.toFixed(2)}% ${item.name}${enh}`);
        }
    } else if (profitData.details.equipmentEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.details.equipmentEfficiency.toFixed(2),
                label: t('profitDisplay.equipmentLabel'),
            })
        );
    }
    if (profitData.details.communityEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.details.communityEfficiency.toFixed(2),
                label: t('profitDisplay.communityBuffLabel'),
            })
        );
    }
    if (profitData.details.achievementEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.details.achievementEfficiency.toFixed(2),
                label: t('profitDisplay.achievementLabel'),
            })
        );
    }
    if (profitData.details.personalEfficiency > 0) {
        const icon = dataManager.isBuffBeingSimulated(gatheringActionType, '/buff_types/efficiency')
            ? scrollSpriteHtml('/buff_types/efficiency')
            : '';
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon,
                value: profitData.details.personalEfficiency.toFixed(2),
                label: t('profitDisplay.scrollOfEfficiencyLabel'),
            })
        );
    }
    if (effRows.length > 0) {
        modifierSummaryParts.push(
            t('profitDisplay.modifierSummaryEff', { value: profitData.totalEfficiency.toFixed(2) })
        );
        modifierSubSections.push(
            makeModifierSection(
                t('profitDisplay.efficiencyLabel'),
                `${profitData.totalEfficiency.toFixed(2)}%`,
                effRows
            )
        );
    }

    // Gathering Quantity
    if (profitData.gatheringQuantity > 0) {
        const gatherRows = [];
        if (profitData.details.communityBuffQuantity > 0) {
            gatherRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: (profitData.details.communityBuffQuantity * 100).toFixed(2),
                    label: t('profitDisplay.communityBuffLabel'),
                })
            );
        }
        if (profitData.details.gatheringTeaBonus > 0) {
            gatherRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: (profitData.details.gatheringTeaBonus * 100).toFixed(2),
                    label: t('profitDisplay.teaLabel'),
                })
            );
        }
        if (profitData.details.achievementGathering > 0) {
            gatherRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: (profitData.details.achievementGathering * 100).toFixed(2),
                    label: t('profitDisplay.achievementLabel'),
                })
            );
        }
        if (profitData.details.personalGathering > 0) {
            const icon = dataManager.isBuffBeingSimulated(gatheringActionType, '/buff_types/gathering')
                ? scrollSpriteHtml('/buff_types/gathering')
                : '';
            gatherRows.push(
                t('profitDisplay.modifierRow', {
                    icon,
                    value: (profitData.details.personalGathering * 100).toFixed(2),
                    label: t('profitDisplay.scrollOfGatheringLabel'),
                })
            );
        }
        const gatherTotal = `${(profitData.gatheringQuantity * 100).toFixed(2)}%`;
        modifierSummaryParts.push(
            t('profitDisplay.modifierSummaryGather', { value: (profitData.gatheringQuantity * 100).toFixed(2) })
        );
        modifierSubSections.push(
            makeModifierSection(t('profitDisplay.gatheringQuantityLabel'), gatherTotal, gatherRows)
        );
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
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: rareFindBreakdown.house.toFixed(2),
                    label: t('profitDisplay.houseRoomsPluralLabel'),
                })
            );
        }
        if (rareFindBreakdown.achievement > 0) {
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: rareFindBreakdown.achievement.toFixed(2),
                    label: t('profitDisplay.achievementLabel'),
                })
            );
        }
        if (rareFindBreakdown.personal > 0) {
            const icon = dataManager.isBuffBeingSimulated(gatheringActionType, '/buff_types/rare_find')
                ? scrollSpriteHtml('/buff_types/rare_find')
                : '';
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon,
                    value: rareFindBreakdown.personal.toFixed(2),
                    label: t('profitDisplay.scrollOfRareFindLabel'),
                })
            );
        }
        if (rareFindBreakdown.guild > 0) {
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: rareFindBreakdown.guild.toFixed(2),
                    label: t('profitDisplay.guildShrineLabel'),
                })
            );
        }
        modifierSummaryParts.push(t('profitDisplay.modifierSummaryRare', { value: rareFindBonus.toFixed(2) }));
        modifierSubSections.push(
            makeModifierSection(t('profitDisplay.rareFindLabel'), `${rareFindBonus.toFixed(2)}%`, rareRows)
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
            t('profitDisplay.modifiersHeader'),
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
        <div style="margin-bottom: 4px;">${t('profitDisplay.actionsEfficiencyLine', {
            actions: `${profitData.actionsPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
            efficiency: profitData.totalEfficiency.toFixed(2),
        })}</div>
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
        ? t('profitDisplay.netProfitLine', { value: '-- ⚠' })
        : t('profitDisplay.netProfitLine', {
              value: t('profitDisplay.perHourPerDay', {
                  perHour: `${formatLargeNumber(profit)}${t('profitDisplay.hrSuffix')}`,
                  perDay: `${formatLargeNumber(profitPerDay)}${t('profitDisplay.daySuffix')}`,
              }),
          });
    topLevelContent.appendChild(netProfitLine);
    if (profitData.excludeSellTax) {
        topLevelContent.appendChild(buildSellTaxExcludedWarning());
    }

    // Add pricing mode label
    const pricingMode = profitData.pricingMode || 'hybrid';
    const modeLabel = config.getPricingModeLabel(pricingMode);

    const modeDiv = document.createElement('div');
    modeDiv.style.cssText = `
        margin-bottom: 8px;
        color: #888;
        font-size: 0.85em;
    `;
    const gatheringLoadoutLabel = getAutomaticLoadoutLabel(gatheringActionType);
    modeDiv.textContent = t('profitDisplay.pricingModeLine', { mode: modeLabel, loadout: gatheringLoadoutLabel });
    topLevelContent.appendChild(modeDiv);

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        t('profitDisplay.perHourBreakdownTitle'),
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
    const profitSection = compactActionPanelSection(
        createCollapsibleSection('💰', t('profitDisplay.profitabilityTitle'), summary, topLevelContent, false, 0)
    );
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
            t('profitDisplay.perHourPerDay', {
                perHour: `${formatLargeNumber(profit)}${t('profitDisplay.hrSuffix')}`,
                perDay: `${formatLargeNumber(profitPerDay)}${t('profitDisplay.daySuffix')}`,
            })
        );

        const updateSummary = (newValue) => {
            if (netMissing) {
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', {
                    base: baseSummary,
                    value: '-- ⚠',
                });
                return;
            }
            const inputValue = inputField.value;

            if (inputValue === '∞') {
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', {
                    base: baseSummary,
                    value: '∞',
                });
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
                    excludeSellTax: profitData.excludeSellTax,
                });
                const totalProfit = Math.round(totals.totalProfit);
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', {
                    base: baseSummary,
                    value: formatLargeNumber(totalProfit),
                });
            } else {
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', { base: baseSummary, value: '0' });
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
    dataManager.clearScrollSimulation(gatheringActionType);
}

/**
 * Display production profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 * @param {string} dropTableSelector - CSS selector for drop table element
 */
export async function displayProductionProfit(panel, actionHrid, dropTableSelector) {
    // Check global hide setting
    if (!config.getSetting('actionPanel_showProfitDetail')) {
        return;
    }

    // Arm scroll simulation before calculation
    const productionActionType = dataManager.getActionDetails(actionHrid)?.type;
    dataManager.setScrollSimulation(
        productionActionType,
        scrollSimulator.getScrollSetForActionType(productionActionType)
    );

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
    const materialMissing =
        profitData.materialCosts?.some((material) => material.missingPrice || material.isOutlier) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice || tea.isOutlier) || false;
    const revenueMissing = (outputMissing && !outputEstimated) || profitData.outputPriceOutlier || bonusMissing;

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
    const netMissing = profitData.hasMissingPrices || profitData.hasOutlierPrices;
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
    // Calculate market tax (percentage of revenue)
    const marketTax = Math.round(profitData.marketTax);
    const costs = Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour + marketTax);
    const summary = netMissing
        ? '-- ⚠'
        : t('profitDisplay.totalProfitSummary', {
              base: t('profitDisplay.perHourPerDay', {
                  perHour: `${formatLargeNumber(profit)}${t('profitDisplay.hrSuffix')}`,
                  perDay: `${formatLargeNumber(profitPerDay)}${t('profitDisplay.daySuffix')}`,
              }),
              value: '0',
          });

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing
        ? '-- ⚠'
        : `${formatLargeNumber(revenue)}${t('profitDisplay.hrSuffix')}${revenueEstimated ? ' ⚠' : ''}`;
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">${t('profitDisplay.revenueHeader', { label: revenueLabel })}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(
        profitData.outputPriceMissing || profitData.outputPriceEstimated
    );
    baseOutputLine.textContent = t('profitDisplay.baseOutputLine', {
        name: profitData.itemName,
        rate: `${profitData.itemsPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
        price: formatWithSeparator(Math.round(profitData.outputPrice)),
        missingNote: baseOutputMissingNote,
        revenue: `${formatLargeNumber(Math.round(profitData.itemsPerHour * profitData.outputPrice))}${t('profitDisplay.hrSuffix')}`,
    });
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonusItems > 0) {
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = t('profitDisplay.gourmetOutputLinePlus', {
            name: profitData.itemName,
            pct: formatPercentage(profitData.gourmetBonus, 1),
            rate: `${profitData.gourmetBonusItems.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
            price: formatWithSeparator(Math.round(profitData.outputPrice)),
            missingNote: baseOutputMissingNote,
            revenue: `${formatLargeNumber(Math.round(profitData.gourmetBonusItems * profitData.outputPrice))}${t('profitDisplay.hrSuffix')}`,
        });
        primaryOutputContent.appendChild(gourmetLine);
    }

    const baseRevenue = profitData.itemsPerHour * profitData.outputPrice;
    const gourmetRevenue = profitData.gourmetBonusItems * profitData.outputPrice;
    const primaryRevenue = baseRevenue + gourmetRevenue;
    const primaryRevenueLabel = outputMissing ? '-- ⚠' : formatLargeNumber(Math.round(primaryRevenue));
    const gourmetLabel =
        profitData.gourmetBonus > 0
            ? t('profitDisplay.gourmetSuffixParen', { pct: formatPercentage(profitData.gourmetBonus, 1) })
            : '';
    const primaryOutputSection = createCollapsibleSection(
        '',
        t('profitDisplay.primaryOutputsHeaderProduction', {
            label: `${primaryRevenueLabel}${t('profitDisplay.hrSuffix')}`,
            gourmetSuffix: gourmetLabel,
        }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPerHour.toFixed(decimals)}${t('profitDisplay.hrSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatLargeNumber(Math.round(revenuePerHour))}${t('profitDisplay.hrSuffix')}`,
            });
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
            t('profitDisplay.essenceDropsHeader', {
                label: `${essenceRevenueLabel}${t('profitDisplay.hrSuffix')}`,
                count: essenceDrops.length,
                pct: essenceFindBonus.toFixed(2),
            }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPerHour.toFixed(decimals)}${t('profitDisplay.hrSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatLargeNumber(Math.round(revenuePerHour))}${t('profitDisplay.hrSuffix')}`,
            });
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
            t('profitDisplay.rareFindsHeader', {
                label: `${rareFindRevenueLabel}${t('profitDisplay.hrSuffix')}`,
                count: rareFinds.length,
                summary: rareFindSummary,
            }),
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
        : `${formatLargeNumber(costs)}${t('profitDisplay.hrSuffix')}${costsEstimated ? ' ⚠' : ''}`;
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">${t('profitDisplay.costsHeader', { label: costsLabel })}</div>`;

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

            // Add Artisan reduction info if present (only show if actually reduced)
            let artisanNote = '';
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseAmountPerHour = material.baseAmount * profitData.actionsPerHour * efficiencyMultiplier;
                artisanNote = t('profitDisplay.artisanReductionNote', {
                    baseAmount: baseAmountPerHour.toFixed(2),
                    pct: formatPercentage(profitData.artisanBonus, 1),
                });
            }

            const missingPriceNote = getMissingPriceIndicator(material.missingPrice || material.isOutlier);
            const customPriceNote = material.customPrice ? ' *' : '';

            line.textContent = t('profitDisplay.materialCostLine', {
                name: material.itemName,
                rate: `${amountPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
                artisanNote,
                price: formatWithSeparator(Math.round(material.askPrice)),
                missingNote: missingPriceNote,
                customNote: customPriceNote,
                revenue: `${formatLargeNumber(Math.round(material.totalCost * profitData.actionsPerHour * efficiencyMultiplier))}${t('profitDisplay.hrSuffix')}`,
            });
            materialCostsContent.appendChild(line);
        }
    }

    const materialCostsLabel = formatMissingLabel(
        materialMissing,
        formatLargeNumber(Math.round(profitData.materialCostPerHour))
    );
    const materialCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.materialCostsHeader', {
            label: `${materialCostsLabel}${t('profitDisplay.hrSuffix')}`,
            count: profitData.materialCosts?.length || 0,
        }),
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
            const missingPriceNote = getMissingPriceIndicator(tea.missingPrice || tea.isOutlier);
            line.textContent = t('profitDisplay.drinkCostLineNoEach', {
                name: tea.itemName,
                rate: `${tea.drinksPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
                price: formatWithSeparator(Math.round(tea.pricePerDrink)),
                missingNote: missingPriceNote,
                revenue: `${formatLargeNumber(Math.round(tea.totalCost))}${t('profitDisplay.hrSuffix')}`,
            });
            teaCostsContent.appendChild(line);
        }
    }

    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsLabel = formatMissingLabel(teaMissing, formatLargeNumber(Math.round(profitData.totalTeaCostPerHour)));
    const teaCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.drinkCostsHeader', {
            label: `${teaCostsLabel}${t('profitDisplay.hrSuffix')}`,
            count: teaCount,
        }),
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
    const marketTaxText = formatMarketTaxText(
        profitData.excludeSellTax,
        marketTaxMissing,
        marketTax,
        t('profitDisplay.hrSuffix'),
        marketTaxEstimated
    );
    marketTaxLine.textContent = marketTaxText.line;
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection('', marketTaxText.section, null, marketTaxContent, false, 1);

    costsDiv.appendChild(marketTaxSection);

    // Modifiers Section — collapsible, with each modifier as a nested collapsible
    const modifierSummaryParts = [];
    const modifierSubSections = [];

    // Helper reused from gathering section (defined per-function scope)
    const makeModifierSectionProd = (title, total, rows) => {
        const content = document.createElement('div');
        for (const row of rows) {
            const line = document.createElement('div');
            line.innerHTML = row;
            content.appendChild(line);
        }
        return createCollapsibleSection(
            null,
            t('profitDisplay.modifierSectionTitle', { title, total }),
            null,
            content,
            false,
            1
        );
    };

    // Efficiency
    const effRows = [];
    if (profitData.levelEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.levelEfficiency,
                label: t('profitDisplay.levelAdvantageLabel'),
            })
        );
    }
    if (profitData.houseEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.houseEfficiency.toFixed(2),
                label: t('profitDisplay.houseRoomLabel'),
            })
        );
    }
    if (profitData.teaEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.teaEfficiency.toFixed(2),
                label: t('profitDisplay.teaLabel'),
            })
        );
    }
    if ((profitData.equipmentEfficiencyItems || []).length > 0) {
        for (const item of profitData.equipmentEfficiencyItems) {
            const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
            effRows.push(`+${item.value.toFixed(2)}% ${item.name}${enh}`);
        }
    } else if (profitData.equipmentEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.equipmentEfficiency.toFixed(2),
                label: t('profitDisplay.equipmentLabel'),
            })
        );
    }
    if (profitData.communityEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.communityEfficiency.toFixed(2),
                label: t('profitDisplay.communityBuffLabel'),
            })
        );
    }
    if (profitData.achievementEfficiency > 0) {
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: '',
                value: profitData.achievementEfficiency.toFixed(2),
                label: t('profitDisplay.achievementLabel'),
            })
        );
    }
    if (profitData.personalEfficiency > 0) {
        const simSprite = dataManager.isBuffBeingSimulated(productionActionType, '/buff_types/efficiency')
            ? scrollSpriteHtml('/buff_types/efficiency')
            : '';
        effRows.push(
            t('profitDisplay.modifierRow', {
                icon: simSprite,
                value: profitData.personalEfficiency.toFixed(2),
                label: t('profitDisplay.scrollOfEfficiencyLabel'),
            })
        );
    }
    if (effRows.length > 0) {
        modifierSummaryParts.push(
            t('profitDisplay.modifierSummaryEff', { value: profitData.totalEfficiency.toFixed(2) })
        );
        modifierSubSections.push(
            makeModifierSectionProd(
                t('profitDisplay.efficiencyLabel'),
                `${profitData.totalEfficiency.toFixed(2)}%`,
                effRows
            )
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
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: productionRareFindBreakdown.house.toFixed(2),
                    label: t('profitDisplay.houseRoomsPluralLabel'),
                })
            );
        }
        if (productionRareFindBreakdown.achievement > 0) {
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon: '',
                    value: productionRareFindBreakdown.achievement.toFixed(2),
                    label: t('profitDisplay.achievementLabel'),
                })
            );
        }
        if (productionRareFindBreakdown.personal > 0) {
            const simSprite = dataManager.isBuffBeingSimulated(productionActionType, '/buff_types/rare_find')
                ? scrollSpriteHtml('/buff_types/rare_find')
                : '';
            rareRows.push(
                t('profitDisplay.modifierRow', {
                    icon: simSprite,
                    value: productionRareFindBreakdown.personal.toFixed(2),
                    label: t('profitDisplay.scrollOfRareFindLabel'),
                })
            );
        }
        modifierSummaryParts.push(
            t('profitDisplay.modifierSummaryRare', { value: productionRareFindBonus.toFixed(2) })
        );
        modifierSubSections.push(
            makeModifierSectionProd(
                t('profitDisplay.rareFindLabel'),
                `${productionRareFindBonus.toFixed(2)}%`,
                rareRows
            )
        );
    }

    // Artisan Bonus (no sub-breakdown needed — single source)
    if (profitData.artisanBonus > 0) {
        const artisanContent = document.createElement('div');
        artisanContent.textContent = t('profitDisplay.artisanReductionSentence', {
            value: formatPercentage(profitData.artisanBonus, 1),
        });
        modifierSummaryParts.push(
            t('profitDisplay.modifierSummaryArtisan', { value: formatPercentage(profitData.artisanBonus, 1) })
        );
        modifierSubSections.push(
            createCollapsibleSection(
                null,
                t('profitDisplay.artisanSectionTitle', { value: formatPercentage(profitData.artisanBonus, 1) }),
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
        gourmetContent.textContent = t('profitDisplay.gourmetBonusSentence', {
            value: formatPercentage(profitData.gourmetBonus, 1),
        });
        modifierSummaryParts.push(
            t('profitDisplay.modifierSummaryGourmet', { value: formatPercentage(profitData.gourmetBonus, 1) })
        );
        modifierSubSections.push(
            createCollapsibleSection(
                null,
                t('profitDisplay.gourmetSectionTitle', { value: formatPercentage(profitData.gourmetBonus, 1) }),
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
            t('profitDisplay.modifiersHeader'),
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
        <div style="margin-bottom: 4px;">${t('profitDisplay.actionsLine', {
            actions: `${effectiveActionsPerHour.toFixed(2)}${t('profitDisplay.hrSuffix')}`,
        })}</div>
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
        ? t('profitDisplay.netProfitLine', { value: '-- ⚠' })
        : t('profitDisplay.netProfitLine', {
              value: t('profitDisplay.perHourPerDay', {
                  perHour: `${formatLargeNumber(profit)}${t('profitDisplay.hrSuffix')}${netEstimated ? ' ⚠' : ''}`,
                  perDay: `${formatLargeNumber(profitPerDay)}${t('profitDisplay.daySuffix')}${netEstimated ? ' ⚠' : ''}`,
              }),
          });
    topLevelContent.appendChild(netProfitLine);
    if (profitData.excludeSellTax) {
        topLevelContent.appendChild(buildSellTaxExcludedWarning());
    }

    // Add pricing mode label
    const pricingMode = profitData.pricingMode || 'hybrid';
    const modeLabel = config.getPricingModeLabel(pricingMode);

    const modeDiv = document.createElement('div');
    modeDiv.style.cssText = `
        margin-bottom: 8px;
        color: #888;
        font-size: 0.85em;
    `;
    const productionLoadoutLabel = getAutomaticLoadoutLabel(productionActionType);
    modeDiv.textContent = t('profitDisplay.pricingModeLine', { mode: modeLabel, loadout: productionLoadoutLabel });
    topLevelContent.appendChild(modeDiv);

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        t('profitDisplay.perHourBreakdownTitle'),
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
    const profitSection = compactActionPanelSection(
        createCollapsibleSection('💰', t('profitDisplay.profitabilityTitle'), summary, topLevelContent, false, 0)
    );
    profitSection.id = 'mwi-production-profit';
    profitSection.setAttribute('data-mwi-profit-display', 'true');
    profitSection.dataset.mwiActionHrid = actionHrid;
    profitSection.dataset.mwiActionType = 'production';
    const profitSummaryDiv = profitSection.querySelector('.mwi-section-header + div');

    // Set up listener to update summary with total profit when input changes
    if (inputField && profitSummaryDiv) {
        const baseSummary = formatMissingLabel(
            netMissing,
            t('profitDisplay.perHourPerDay', {
                perHour: `${formatLargeNumber(profit)}${t('profitDisplay.hrSuffix')}`,
                perDay: `${formatLargeNumber(profitPerDay)}${t('profitDisplay.daySuffix')}`,
            })
        );

        const updateSummary = (newValue) => {
            if (netMissing) {
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', {
                    base: baseSummary,
                    value: '-- ⚠',
                });
                return;
            }
            const inputValue = inputField.value;

            if (inputValue === '∞') {
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', {
                    base: baseSummary,
                    value: '∞',
                });
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
                    excludeSellTax: profitData.excludeSellTax,
                });
                const totalProfit = Math.round(totals.totalProfit);
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', {
                    base: baseSummary,
                    value: formatLargeNumber(totalProfit),
                });
            } else {
                profitSummaryDiv.textContent = t('profitDisplay.totalProfitSummary', { base: baseSummary, value: '0' });
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
    dataManager.clearScrollSimulation(productionActionType);
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
    const baseMissing = profitData.baseOutputs?.some((output) => output.missingPrice || output.isOutlier) || false;
    const gourmetMissing =
        profitData.gourmetBonuses?.some((output) => output.missingPrice || output.isOutlier) || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const processingMissing =
        profitData.processingConversions?.some((conversion) => conversion.missingPrice || conversion.isOutlier) ||
        false;
    const primaryMissing = baseMissing || gourmetMissing || processingMissing;
    const revenueMissing = primaryMissing || bonusMissing;
    const drinkCostsMissing = profitData.drinkCosts?.some((drink) => drink.missingPrice) || false;
    const costsMissing = drinkCostsMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices || profitData.hasOutlierPrices;
    const efficiencyMultiplier = profitData.efficiencyMultiplier || 1;

    const revenuePerHour = profitData.revenuePerHour;
    const revenuePerAction = revenuePerHour / actionsPerHour;
    const marketTaxPerAction = profitData.marketTax / actionsPerHour;
    const drinkCostPerAction = profitData.drinkCostPerHour / actionsPerHour;
    const costsPerAction = drinkCostPerAction + marketTaxPerAction;
    const profitPerAction = profitData.profitPerAction;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = formatMissingLabel(
        revenueMissing,
        `${formatPerAction(revenuePerAction)}${t('profitDisplay.actionSuffix')}`
    );
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">${t('profitDisplay.revenueHeader', { label: revenueLabel })}</div>`;

    // Primary Outputs subsection
    const primaryDropsContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
            const revPerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice || output.isOutlier);
            line.textContent = t('profitDisplay.baseOutputLine', {
                name: output.name,
                rate: `${itemsPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                price: formatWithSeparator(output.priceEach),
                missingNote: missingPriceNote,
                revenue: `${formatPerAction(revPerAction)}${t('profitDisplay.actionSuffix')}`,
            });
            primaryDropsContent.appendChild(line);
        }
    }

    if (profitData.gourmetBonuses && profitData.gourmetBonuses.length > 0) {
        for (const output of profitData.gourmetBonuses) {
            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
            const revPerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice || output.isOutlier);
            line.textContent = t('profitDisplay.gourmetOutputLine', {
                name: output.name,
                pct: formatPercentage(profitData.gourmetBonus || 0, 1),
                rate: `${itemsPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                price: formatWithSeparator(output.priceEach),
                missingNote: missingPriceNote,
                revenue: `${formatPerAction(revPerAction)}${t('profitDisplay.actionSuffix')}`,
            });
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
            const missingPriceNote = getMissingPriceIndicator(conversion.missingPrice || conversion.isOutlier);

            const consumedLine = document.createElement('div');
            consumedLine.style.marginLeft = '8px';
            consumedLine.textContent = t('profitDisplay.processingConsumedLine', {
                item: conversion.rawItem,
                rate: `${rawConsumedPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                price: formatWithSeparator(conversion.rawPriceEach),
                missingNote: missingPriceNote,
                revenue: `${formatPerAction(consumedRevenuePerAction)}${t('profitDisplay.actionSuffix')}`,
            });
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            producedLine.textContent = t('profitDisplay.processingProducedLine', {
                item: conversion.processedItem,
                rate: `${conversionsPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                price: formatWithSeparator(conversion.processedPriceEach),
                missingNote: missingPriceNote,
                revenue: `${formatPerAction(producedRevenuePerAction)}${t('profitDisplay.actionSuffix')}`,
            });
            processingContent.appendChild(producedLine);
        }

        const processingSection = createCollapsibleSection(
            '',
            t('profitDisplay.processingSectionTitle', {
                pct: formatPercentage(profitData.processingBonus || 0, 1),
                net: `${netProcessingLabel}${t('profitDisplay.actionSuffix')}`,
            }),
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
        `${formatPerAction(primaryRevenuePerAction)}${t('profitDisplay.actionSuffix')}`
    );
    const outputItemCount =
        (profitData.baseOutputs?.length || 0) +
        (profitData.processingConversions && profitData.processingConversions.length > 0 ? 1 : 0);
    const primaryDropsSection = createCollapsibleSection(
        '',
        t('profitDisplay.primaryOutputsHeaderGathering', { label: primaryRevenueLabel, count: outputItemCount }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPA.toFixed(4)}${t('profitDisplay.actionSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatPerAction(revenuePA)}${t('profitDisplay.actionSuffix')}`,
            });
            essenceContent.appendChild(line);
        }

        const essenceRevenuePerAction = essenceDrops.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const essenceRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(essenceRevenuePerAction)}${t('profitDisplay.actionSuffix')}`
        );
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            t('profitDisplay.essenceDropsHeader', {
                label: essenceRevenueLabel,
                count: essenceDrops.length,
                pct: essenceFindBonus.toFixed(2),
            }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPA.toFixed(4)}${t('profitDisplay.actionSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatPerAction(revenuePA)}${t('profitDisplay.actionSuffix')}`,
            });
            rareFindContent.appendChild(line);
        }

        const rareFindRevenuePerAction = rareFinds.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const rareFindRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(rareFindRevenuePerAction)}${t('profitDisplay.actionSuffix')}`
        );
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            t('profitDisplay.rareFindsHeader', {
                label: rareFindRevenueLabel,
                count: rareFinds.length,
                summary: rareFindSummary,
            }),
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
    const costsLabel = formatMissingLabel(
        costsMissing,
        `${formatPerAction(costsPerAction)}${t('profitDisplay.actionSuffix')}`
    );
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">${t('profitDisplay.costsHeader', { label: costsLabel })}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const drinksPA = drink.drinksPerHour / actionsPerHour;
            const costPA = drink.costPerHour / actionsPerHour;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(drink.missingPrice || drink.isOutlier);
            line.textContent = t('profitDisplay.drinkCostLineEach', {
                name: drink.name,
                rate: `${drinksPA.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                price: formatWithSeparator(drink.priceEach),
                missingNote: missingPriceNote,
                revenue: `${formatPerAction(costPA)}${t('profitDisplay.actionSuffix')}`,
            });
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsLabel = formatMissingLabel(
        drinkCostsMissing,
        `${formatPerAction(drinkCostPerAction)}${t('profitDisplay.actionSuffix')}`
    );
    const drinkCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.drinkCostsHeader', { label: drinkCostsLabel, count: drinkCount }),
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
    const marketTaxLabel = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLabel')
        : formatMissingLabel(
              marketTaxMissing,
              `${formatPerAction(marketTaxPerAction)}${t('profitDisplay.actionSuffix')}`
          );
    marketTaxLine.textContent = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLine')
        : t('profitDisplay.marketTaxLine', { pct: MARKET_TAX * 100, label: marketTaxLabel });
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        profitData.excludeSellTax
            ? t('profitDisplay.marketTaxExcludedSectionTitle')
            : t('profitDisplay.marketTaxSectionTitle', { label: marketTaxLabel, pct: MARKET_TAX * 100 }),
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
        ? t('profitDisplay.netProfitLine', { value: '-- ⚠' })
        : t('profitDisplay.netProfitLine', {
              value: `${formatPerAction(profitPerAction)}${t('profitDisplay.actionSuffix')}`,
          });
    topLevelContent.appendChild(netProfitLine);
    if (profitData.excludeSellTax) {
        topLevelContent.appendChild(buildSellTaxExcludedWarning());
    }

    const summarySection = createCollapsibleSection(
        '',
        t('profitDisplay.revenueCostsSummary', {
            revenue: formatMissingLabel(
                revenueMissing,
                `${formatPerAction(revenuePerAction)}${t('profitDisplay.actionSuffix')}`
            ),
            costs: formatMissingLabel(
                costsMissing,
                `${formatPerAction(costsPerAction)}${t('profitDisplay.actionSuffix')}`
            ),
        }),
        null,
        detailsContent,
        false,
        1
    );
    topLevelContent.appendChild(summarySection);

    return createCollapsibleSection('🔢', t('profitDisplay.perActionBreakdownTitle'), null, topLevelContent, false, 0);
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
    const materialMissing =
        profitData.materialCosts?.some((material) => material.missingPrice || material.isOutlier) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice || tea.isOutlier) || false;
    const revenueMissing = (outputMissing && !outputEstimated) || profitData.outputPriceOutlier || bonusMissing;
    const revenueEstimated = outputEstimated && !revenueMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const costsEstimated = revenueEstimated && !costsMissing;
    const marketTaxMissing = revenueMissing;
    const marketTaxEstimated = revenueEstimated && !marketTaxMissing;
    const netMissing = profitData.hasMissingPrices || profitData.hasOutlierPrices;
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
    const marketTaxPerAction = profitData.marketTax / actionsPerHour;
    const materialCostPerAction = profitData.totalMaterialCost; // per-action cost is fixed, unaffected by efficiency
    const teaCostPerAction = profitData.totalTeaCostPerHour / actionsPerHour;
    const costsPerAction = materialCostPerAction + teaCostPerAction + marketTaxPerAction;
    const profitPerAction = revenuePerAction - costsPerAction;

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing
        ? '-- ⚠'
        : `${formatPerAction(revenuePerAction)}${t('profitDisplay.actionSuffix')}${revenueEstimated ? ' ⚠' : ''}`;
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">${t('profitDisplay.revenueHeader', { label: revenueLabel })}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(
        profitData.outputPriceMissing || profitData.outputPriceEstimated
    );
    baseOutputLine.textContent = t('profitDisplay.baseOutputLine', {
        name: profitData.itemName,
        rate: `${baseItemsPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
        price: formatWithSeparator(Math.round(profitData.outputPrice)),
        missingNote: baseOutputMissingNote,
        revenue: `${formatPerAction(baseRevenuePerAction)}${t('profitDisplay.actionSuffix')}`,
    });
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonus > 0) {
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = t('profitDisplay.gourmetOutputLinePlus', {
            name: profitData.itemName,
            pct: formatPercentage(profitData.gourmetBonus, 1),
            rate: `${gourmetItemsPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
            price: formatWithSeparator(Math.round(profitData.outputPrice)),
            missingNote: baseOutputMissingNote,
            revenue: `${formatPerAction(gourmetRevenuePerAction)}${t('profitDisplay.actionSuffix')}`,
        });
        primaryOutputContent.appendChild(gourmetLine);
    }

    const primaryRevenuePerAction = baseRevenuePerAction + gourmetRevenuePerAction;
    const primaryOutputLabel =
        outputMissing && !outputEstimated
            ? '-- ⚠'
            : `${formatPerAction(primaryRevenuePerAction)}${t('profitDisplay.actionSuffix')}${outputEstimated ? ' ⚠' : ''}`;
    const gourmetLabel =
        profitData.gourmetBonus > 0
            ? t('profitDisplay.gourmetSuffixParen', { pct: formatPercentage(profitData.gourmetBonus, 1) })
            : '';
    const primaryOutputSection = createCollapsibleSection(
        '',
        t('profitDisplay.primaryOutputsHeaderProduction', { label: primaryOutputLabel, gourmetSuffix: gourmetLabel }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPA.toFixed(4)}${t('profitDisplay.actionSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatPerAction(revenuePA)}${t('profitDisplay.actionSuffix')}`,
            });
            essenceContent.appendChild(line);
        }

        const essenceRevenuePerAction = essenceDrops.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const essenceRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(essenceRevenuePerAction)}${t('profitDisplay.actionSuffix')}`
        );
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            t('profitDisplay.essenceDropsHeader', {
                label: essenceRevenueLabel,
                count: essenceDrops.length,
                pct: essenceFindBonus.toFixed(2),
            }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${dropsPA.toFixed(4)}${t('profitDisplay.actionSuffix')}`,
                pct: dropRatePct,
                revenue: `${formatPerAction(revenuePA)}${t('profitDisplay.actionSuffix')}`,
            });
            rareFindContent.appendChild(line);
        }

        const rareFindRevenuePerAction = rareFinds.reduce(
            (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour / actionsPerHour,
            0
        );
        const rareFindRevenueLabel = formatMissingLabel(
            bonusMissing,
            `${formatPerAction(rareFindRevenuePerAction)}${t('profitDisplay.actionSuffix')}`
        );
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            t('profitDisplay.rareFindsHeader', {
                label: rareFindRevenueLabel,
                count: rareFinds.length,
                summary: rareFindSummary,
            }),
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
        : `${formatPerAction(costsPerAction)}${t('profitDisplay.actionSuffix')}${costsEstimated ? ' ⚠' : ''}`;
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">${t('profitDisplay.costsHeader', { label: costsLabel })}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        for (const material of profitData.materialCosts) {
            const amountPerAction = material.amount; // per-action quantity is fixed, unaffected by efficiency
            const costPerAction = material.totalCost; // per-action cost is fixed, unaffected by efficiency
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            let artisanNote = '';
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseAmountPerAction = material.baseAmount; // per-action quantity is fixed, unaffected by efficiency
                artisanNote = t('profitDisplay.artisanReductionNote', {
                    baseAmount: baseAmountPerAction.toFixed(2),
                    pct: formatPercentage(profitData.artisanBonus, 1),
                });
            }

            const missingPriceNote = getMissingPriceIndicator(material.missingPrice || material.isOutlier);
            const customPriceNote = material.customPrice ? ' *' : '';

            line.textContent = t('profitDisplay.materialCostLine', {
                name: material.itemName,
                rate: `${amountPerAction.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                artisanNote,
                price: formatWithSeparator(Math.round(material.askPrice)),
                missingNote: missingPriceNote,
                customNote: customPriceNote,
                revenue: `${formatPerAction(costPerAction)}${t('profitDisplay.actionSuffix')}`,
            });
            materialCostsContent.appendChild(line);
        }
    }

    const materialCostsLabel = formatMissingLabel(
        materialMissing,
        `${formatPerAction(materialCostPerAction)}${t('profitDisplay.actionSuffix')}`
    );
    const materialCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.materialCostsHeader', {
            label: materialCostsLabel,
            count: profitData.materialCosts?.length || 0,
        }),
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
            const missingPriceNote = getMissingPriceIndicator(tea.missingPrice || tea.isOutlier);
            line.textContent = t('profitDisplay.drinkCostLineEach', {
                name: tea.itemName,
                rate: `${drinksPA.toFixed(2)}${t('profitDisplay.actionSuffix')}`,
                price: formatWithSeparator(Math.round(tea.pricePerDrink)),
                missingNote: missingPriceNote,
                revenue: `${formatPerAction(costPA)}${t('profitDisplay.actionSuffix')}`,
            });
            teaCostsContent.appendChild(line);
        }
    }

    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsLabel = formatMissingLabel(
        teaMissing,
        `${formatPerAction(teaCostPerAction)}${t('profitDisplay.actionSuffix')}`
    );
    const teaCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.drinkCostsHeader', { label: teaCostsLabel, count: teaCount }),
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
    const marketTaxLabel = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLabel')
        : marketTaxMissing
          ? '-- ⚠'
          : `${formatPerAction(marketTaxPerAction)}${t('profitDisplay.actionSuffix')}${marketTaxEstimated ? ' ⚠' : ''}`;
    marketTaxLine.textContent = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLine')
        : t('profitDisplay.marketTaxLine', { pct: MARKET_TAX * 100, label: marketTaxLabel });
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        profitData.excludeSellTax
            ? t('profitDisplay.marketTaxExcludedSectionTitle')
            : t('profitDisplay.marketTaxSectionTitle', { label: marketTaxLabel, pct: MARKET_TAX * 100 }),
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
        ? t('profitDisplay.netProfitLine', { value: '-- ⚠' })
        : t('profitDisplay.netProfitLine', {
              value: `${formatPerAction(profitPerAction)}${t('profitDisplay.actionSuffix')}${netEstimated ? ' ⚠' : ''}`,
          });
    topLevelContent.appendChild(netProfitLine);
    if (profitData.excludeSellTax) {
        topLevelContent.appendChild(buildSellTaxExcludedWarning());
    }

    const revenueSummaryLabel = revenueMissing
        ? '-- ⚠'
        : `${formatPerAction(revenuePerAction)}${t('profitDisplay.actionSuffix')}${revenueEstimated ? ' ⚠' : ''}`;
    const costsSummaryLabel = costsMissing
        ? '-- ⚠'
        : `${formatPerAction(costsPerAction)}${t('profitDisplay.actionSuffix')}${costsEstimated ? ' ⚠' : ''}`;
    const summarySection = createCollapsibleSection(
        '',
        t('profitDisplay.revenueCostsSummary', { revenue: revenueSummaryLabel, costs: costsSummaryLabel }),
        null,
        detailsContent,
        false,
        1
    );
    topLevelContent.appendChild(summarySection);

    return createCollapsibleSection('🔢', t('profitDisplay.perActionBreakdownTitle'), null, topLevelContent, false, 0);
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
        excludeSellTax: profitData.excludeSellTax,
    });
    const hoursNeeded = totals.hoursNeeded;

    // Calculate totals
    const baseMissing = profitData.baseOutputs?.some((output) => output.missingPrice || output.isOutlier) || false;
    const gourmetMissing =
        profitData.gourmetBonuses?.some((output) => output.missingPrice || output.isOutlier) || false;
    const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
    const processingMissing =
        profitData.processingConversions?.some((conversion) => conversion.missingPrice || conversion.isOutlier) ||
        false;
    const primaryMissing = baseMissing || gourmetMissing || processingMissing;
    const revenueMissing = primaryMissing || bonusMissing;
    const drinkCostsMissing = profitData.drinkCosts?.some((drink) => drink.missingPrice) || false;
    const costsMissing = drinkCostsMissing || revenueMissing;
    const marketTaxMissing = revenueMissing;
    const netMissing = profitData.hasMissingPrices || profitData.hasOutlierPrices;
    const totalRevenue = Math.round(totals.totalRevenue);
    const totalMarketTax = Math.round(totals.totalMarketTax);
    const totalDrinkCosts = Math.round(totals.totalDrinkCost);
    const totalCosts = Math.round(totals.totalCosts);
    const totalProfit = Math.round(totals.totalProfit);

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = formatMissingLabel(revenueMissing, formatLargeNumber(totalRevenue));
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">${t('profitDisplay.revenueHeader', { label: revenueLabel })}</div>`;

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
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice || output.isOutlier);
            line.textContent = t('profitDisplay.baseOutputLine', {
                name: output.name,
                rate: `${totalItems.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
                price: formatWithSeparator(output.priceEach),
                missingNote: missingPriceNote,
                revenue: formatLargeNumber(Math.round(totalRevenueLine)),
            });
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
            const missingPriceNote = getMissingPriceIndicator(output.missingPrice || output.isOutlier);
            line.textContent = t('profitDisplay.gourmetOutputLine', {
                name: output.name,
                pct: formatPercentage(profitData.gourmetBonus || 0, 1),
                rate: `${totalItems.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
                price: formatWithSeparator(output.priceEach),
                missingNote: missingPriceNote,
                revenue: formatLargeNumber(Math.round(totalRevenueLine)),
            });
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
            const missingPriceNote = getMissingPriceIndicator(conversion.missingPrice || conversion.isOutlier);

            const consumedLine = document.createElement('div');
            consumedLine.style.marginLeft = '8px';
            consumedLine.textContent = t('profitDisplay.processingConsumedLine', {
                item: conversion.rawItem,
                rate: `${totalConsumed.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
                price: formatWithSeparator(conversion.rawPriceEach),
                missingNote: missingPriceNote,
                revenue: formatLargeNumber(Math.round(consumedRevenue)),
            });
            processingContent.appendChild(consumedLine);

            const producedLine = document.createElement('div');
            producedLine.style.marginLeft = '8px';
            producedLine.textContent = t('profitDisplay.processingProducedLine', {
                item: conversion.processedItem,
                rate: `${totalProduced.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
                price: formatWithSeparator(conversion.processedPriceEach),
                missingNote: missingPriceNote,
                revenue: formatLargeNumber(Math.round(producedRevenue)),
            });
            processingContent.appendChild(producedLine);
        }

        const processingSection = createCollapsibleSection(
            '',
            t('profitDisplay.processingSectionTitle', {
                pct: formatPercentage(profitData.processingBonus || 0, 1),
                net: processingLabel,
            }),
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
        t('profitDisplay.primaryOutputsHeaderGathering', { label: primaryRevenueLabel, count: outputItemCount }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${totalDrops.toFixed(2)} ${t('profitDisplay.dropsUnit')}`,
                pct: dropRatePct,
                revenue: formatLargeNumber(Math.round(totalRevenue)),
            });
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, drop) => {
            return sum + getBonusDropTotalsForActions(drop, actionsCount, profitData.actionsPerHour).totalRevenue;
        }, 0);
        const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(essenceRevenue)));
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            t('profitDisplay.essenceDropsHeader', {
                label: essenceRevenueLabel,
                count: essenceDrops.length,
                pct: essenceFindBonus.toFixed(2),
            }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${totalDrops.toFixed(2)} ${t('profitDisplay.dropsUnit')}`,
                pct: dropRatePct,
                revenue: formatLargeNumber(Math.round(totalRevenue)),
            });
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, drop) => {
            return sum + getBonusDropTotalsForActions(drop, actionsCount, profitData.actionsPerHour).totalRevenue;
        }, 0);
        const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatLargeNumber(Math.round(rareFindRevenue)));
        const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
        rareFindSection = createCollapsibleSection(
            '',
            t('profitDisplay.rareFindsHeader', {
                label: rareFindRevenueLabel,
                count: rareFinds.length,
                summary: rareFindSummary,
            }),
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
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">${t('profitDisplay.costsHeader', { label: costsLabel })}</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const totalDrinks = drink.drinksPerHour * hoursNeeded;
            const totalCostLine = drink.costPerHour * hoursNeeded;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            const missingPriceNote = getMissingPriceIndicator(drink.missingPrice || drink.isOutlier);
            line.textContent = t('profitDisplay.drinkCostLineNoEach', {
                name: drink.name,
                rate: `${totalDrinks.toFixed(2)} ${t('profitDisplay.drinksUnit')}`,
                price: formatWithSeparator(drink.priceEach),
                missingNote: missingPriceNote,
                revenue: formatLargeNumber(Math.round(totalCostLine)),
            });
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsLabel = drinkCostsMissing ? '-- ⚠' : formatLargeNumber(totalDrinkCosts);
    const drinkCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.drinkCostsHeader', { label: drinkCostsLabel, count: drinkCount }),
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
    const marketTaxLabel = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLabel')
        : marketTaxMissing
          ? '-- ⚠'
          : formatLargeNumber(totalMarketTax);
    marketTaxLine.textContent = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLine')
        : t('profitDisplay.marketTaxLine', { pct: MARKET_TAX * 100, label: marketTaxLabel });
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        profitData.excludeSellTax
            ? t('profitDisplay.marketTaxExcludedSectionTitle')
            : t('profitDisplay.marketTaxSectionTitle', { label: marketTaxLabel, pct: MARKET_TAX * 100 }),
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
        ? t('profitDisplay.netProfitLine', { value: '-- ⚠' })
        : t('profitDisplay.netProfitLine', { value: formatLargeNumber(totalProfit) });
    topLevelContent.appendChild(netProfitLine);
    if (profitData.excludeSellTax) {
        topLevelContent.appendChild(buildSellTaxExcludedWarning());
    }

    const actionsSummary = t('profitDisplay.revenueCostsSummary', {
        revenue: formatMissingLabel(revenueMissing, formatLargeNumber(totalRevenue)),
        costs: formatMissingLabel(costsMissing, formatLargeNumber(totalCosts)),
    });
    const actionsBreakdownSection = createCollapsibleSection('', actionsSummary, null, detailsContent, false, 1);
    topLevelContent.appendChild(actionsBreakdownSection);

    const mainSection = createCollapsibleSection(
        '📋',
        t('profitDisplay.actionsCountBreakdownTitle', { count: formatWithSeparator(actionsCount) }),
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
    const materialMissing =
        profitData.materialCosts?.some((material) => material.missingPrice || material.isOutlier) || false;
    const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice || tea.isOutlier) || false;
    const revenueMissing = (outputMissing && !outputEstimated) || profitData.outputPriceOutlier || bonusMissing;
    const revenueEstimated = outputEstimated && !revenueMissing;
    const costsMissing = materialMissing || teaMissing || revenueMissing;
    const costsEstimated = revenueEstimated && !costsMissing;
    const marketTaxMissing = revenueMissing;
    const marketTaxEstimated = revenueEstimated && !marketTaxMissing;
    const netMissing = profitData.hasMissingPrices || profitData.hasOutlierPrices;
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
        efficiencyMultiplier,
        excludeSellTax: profitData.excludeSellTax,
    });
    const totalRevenue = Math.round(totals.totalRevenue);
    const totalMarketTax = Math.round(totals.totalMarketTax);
    const totalCosts = Math.round(totals.totalCosts);
    const totalProfit = Math.round(totals.totalProfit);

    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    const revenueLabel = revenueMissing ? '-- ⚠' : `${formatLargeNumber(totalRevenue)}${revenueEstimated ? ' ⚠' : ''}`;
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">${t('profitDisplay.revenueHeader', { label: revenueLabel })}</div>`;

    // Primary Outputs subsection
    const primaryOutputContent = document.createElement('div');
    const totalBaseItems = totals.totalBaseItems;
    const totalBaseRevenue = totals.totalBaseRevenue;
    const baseOutputLine = document.createElement('div');
    baseOutputLine.style.marginLeft = '8px';
    const baseOutputMissingNote = getMissingPriceIndicator(
        profitData.outputPriceMissing || profitData.outputPriceEstimated
    );
    baseOutputLine.textContent = t('profitDisplay.baseOutputLine', {
        name: profitData.itemName,
        rate: `${totalBaseItems.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
        price: formatWithSeparator(Math.round(profitData.outputPrice)),
        missingNote: baseOutputMissingNote,
        revenue: formatLargeNumber(Math.round(totalBaseRevenue)),
    });
    primaryOutputContent.appendChild(baseOutputLine);

    if (profitData.gourmetBonus > 0) {
        const totalGourmetItems = totals.totalGourmetItems;
        const totalGourmetRevenue = totals.totalGourmetRevenue;
        const gourmetLine = document.createElement('div');
        gourmetLine.style.marginLeft = '8px';
        gourmetLine.textContent = t('profitDisplay.gourmetOutputLinePlus', {
            name: profitData.itemName,
            pct: formatPercentage(profitData.gourmetBonus, 1),
            rate: `${totalGourmetItems.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
            price: formatWithSeparator(Math.round(profitData.outputPrice)),
            missingNote: baseOutputMissingNote,
            revenue: formatLargeNumber(Math.round(totalGourmetRevenue)),
        });
        primaryOutputContent.appendChild(gourmetLine);
    }

    const primaryRevenue = totals.totalBaseRevenue + totals.totalGourmetRevenue;
    const primaryOutputLabel =
        outputMissing && !outputEstimated
            ? '-- ⚠'
            : `${formatLargeNumber(Math.round(primaryRevenue))}${outputEstimated ? ' ⚠' : ''}`;
    const gourmetLabel =
        profitData.gourmetBonus > 0
            ? t('profitDisplay.gourmetSuffixParen', { pct: formatPercentage(profitData.gourmetBonus, 1) })
            : '';
    const primaryOutputSection = createCollapsibleSection(
        '',
        t('profitDisplay.primaryOutputsHeaderProduction', { label: primaryOutputLabel, gourmetSuffix: gourmetLabel }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${totalDrops.toFixed(2)} ${t('profitDisplay.dropsUnit')}`,
                pct: dropRatePct,
                revenue: formatLargeNumber(Math.round(totalRevenueLine)),
            });
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
            t('profitDisplay.essenceDropsHeader', {
                label: essenceRevenueLabel,
                count: essenceDrops.length,
                pct: essenceFindBonus.toFixed(2),
            }),
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
            line.textContent = t('profitDisplay.dropLine', {
                itemName: drop.itemName,
                rate: `${totalDrops.toFixed(2)} ${t('profitDisplay.dropsUnit')}`,
                pct: dropRatePct,
                revenue: formatLargeNumber(Math.round(totalRevenueLine)),
            });
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
            t('profitDisplay.rareFindsHeader', {
                label: rareFindRevenueLabel,
                count: rareFinds.length,
                summary: rareFindSummary,
            }),
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
    const costsLabel = costsMissing ? '-- ⚠' : `${formatLargeNumber(totalCosts)}${costsEstimated ? ' ⚠' : ''}`;
    costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">${t('profitDisplay.costsHeader', { label: costsLabel })}</div>`;

    // Material Costs subsection
    const materialCostsContent = document.createElement('div');
    if (profitData.materialCosts && profitData.materialCosts.length > 0) {
        for (const material of profitData.materialCosts) {
            const totalMaterial = material.amount * actionsCount;
            const totalMaterialCost = material.totalCost * actionsCount;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';

            // Add Artisan reduction info if present
            let artisanNote = '';
            if (profitData.artisanBonus > 0 && material.baseAmount && material.amount !== material.baseAmount) {
                const baseTotalAmount = material.baseAmount * actionsCount;
                artisanNote = t('profitDisplay.artisanReductionNote', {
                    baseAmount: baseTotalAmount.toFixed(2),
                    pct: formatPercentage(profitData.artisanBonus, 1),
                });
            }

            const missingPriceNote = getMissingPriceIndicator(material.missingPrice || material.isOutlier);
            const customPriceNote = material.customPrice ? ' *' : '';

            line.textContent = t('profitDisplay.materialCostLine', {
                name: material.itemName,
                rate: `${totalMaterial.toFixed(2)} ${t('profitDisplay.itemsUnit')}`,
                artisanNote,
                price: formatWithSeparator(Math.round(material.askPrice)),
                missingNote: missingPriceNote,
                customNote: customPriceNote,
                revenue: formatLargeNumber(Math.round(totalMaterialCost)),
            });
            materialCostsContent.appendChild(line);
        }
    }

    const totalMaterialCost = totals.totalMaterialCost;
    const materialCostsLabel = formatMissingLabel(materialMissing, formatLargeNumber(Math.round(totalMaterialCost)));
    const materialCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.materialCostsHeader', {
            label: materialCostsLabel,
            count: profitData.materialCosts?.length || 0,
        }),
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
            const missingPriceNote = getMissingPriceIndicator(tea.missingPrice || tea.isOutlier);
            line.textContent = t('profitDisplay.drinkCostLineNoEach', {
                name: tea.itemName,
                rate: `${totalDrinks.toFixed(2)} ${t('profitDisplay.drinksUnit')}`,
                price: formatWithSeparator(Math.round(tea.pricePerDrink)),
                missingNote: missingPriceNote,
                revenue: formatLargeNumber(Math.round(totalTeaCost)),
            });
            teaCostsContent.appendChild(line);
        }
    }

    const totalTeaCost = totals.totalTeaCost;
    const teaCount = profitData.teaCosts?.length || 0;
    const teaCostsLabel = formatMissingLabel(teaMissing, formatLargeNumber(Math.round(totalTeaCost)));
    const teaCostsSection = createCollapsibleSection(
        '',
        t('profitDisplay.drinkCostsHeader', { label: teaCostsLabel, count: teaCount }),
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
    const marketTaxLabel = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLabel')
        : marketTaxMissing
          ? '-- ⚠'
          : `${formatLargeNumber(totalMarketTax)}${marketTaxEstimated ? ' ⚠' : ''}`;
    marketTaxLine.textContent = profitData.excludeSellTax
        ? t('profitDisplay.marketTaxExcludedLine')
        : t('profitDisplay.marketTaxLine', { pct: MARKET_TAX * 100, label: marketTaxLabel });
    marketTaxContent.appendChild(marketTaxLine);

    const marketTaxSection = createCollapsibleSection(
        '',
        profitData.excludeSellTax
            ? t('profitDisplay.marketTaxExcludedSectionTitle')
            : t('profitDisplay.marketTaxSectionTitle', { label: marketTaxLabel, pct: MARKET_TAX * 100 }),
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
        ? t('profitDisplay.netProfitLine', { value: '-- ⚠' })
        : t('profitDisplay.netProfitLine', {
              value: `${formatLargeNumber(totalProfit)}${netEstimated ? ' ⚠' : ''}`,
          });
    topLevelContent.appendChild(netProfitLine);
    if (profitData.excludeSellTax) {
        topLevelContent.appendChild(buildSellTaxExcludedWarning());
    }

    const revenueDisplay = revenueMissing
        ? '-- ⚠'
        : `${formatLargeNumber(totalRevenue)}${revenueEstimated ? ' ⚠' : ''}`;
    const costsDisplay = costsMissing ? '-- ⚠' : `${formatLargeNumber(totalCosts)}${costsEstimated ? ' ⚠' : ''}`;
    const actionsSummary = t('profitDisplay.revenueCostsSummary', { revenue: revenueDisplay, costs: costsDisplay });
    const actionsBreakdownSection = createCollapsibleSection('', actionsSummary, null, detailsContent, false, 1);
    topLevelContent.appendChild(actionsBreakdownSection);

    const mainSection = createCollapsibleSection(
        '📋',
        t('profitDisplay.actionsCountBreakdownTitle', { count: formatWithSeparator(actionsCount) }),
        null,
        topLevelContent,
        false,
        0
    );
    mainSection.className = 'mwi-collapsible-section mwi-actions-breakdown';

    return mainSection;
}
