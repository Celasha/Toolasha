/**
 * Enhancement Display
 *
 * Displays enhancement calculations in the enhancement action panel.
 * Shows expected attempts, time, and protection items needed.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { calculateEnhancement, calculatePerActionTime } from '../../utils/enhancement-calculator.js';
import { timeReadable, numberFormatter } from '../../utils/formatters.js';
import marketAPI from '../../api/marketplace.js';

/**
 * Format a number with thousands separator and 2 decimal places
 * @param {number} num - Number to format
 * @returns {string} Formatted number (e.g., "1,234.56")
 */
function formatAttempts(num) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

/**
 * Get protection item HRID from the Protection slot in the UI
 * @param {HTMLElement} panel - Enhancement action panel element
 * @returns {string|null} Protection item HRID or null if none equipped
 */
function getProtectionItemFromUI(panel) {
    try {
        // Find the protection item container using the specific class
        const protectionContainer = panel.querySelector('[class*="protectionItemInputContainer"]');

        if (!protectionContainer) {
            return null;
        }

        // Look for SVG sprites with items_sprite pattern
        // Protection items are rendered as: <use href="/static/media/items_sprite.{hash}.svg#item_name"></use>
        const useElements = protectionContainer.querySelectorAll('use[href*="items_sprite"]');

        if (useElements.length === 0) {
            // No protection item equipped
            return null;
        }

        // Extract item HRID from the sprite reference
        const useElement = useElements[0];
        const href = useElement.getAttribute('href');

        // Extract item name after the # (fragment identifier)
        // Format: /static/media/items_sprite.{hash}.svg#mirror_of_protection
        const match = href.match(/#(.+)$/);

        if (match) {
            const itemName = match[1];
            const hrid = `/items/${itemName}`;
            return hrid;
        }

        return null;
    } catch (error) {
        console.error('[MWI Tools] Error detecting protection item:', error);
        return null;
    }
}

/**
 * Calculate and display enhancement statistics in the panel
 * @param {HTMLElement} panel - Enhancement action panel element
 * @param {string} itemHrid - Item HRID (e.g., "/items/cheese_sword")
 */
export async function displayEnhancementStats(panel, itemHrid) {
    try {
        // Check if feature is enabled
        if (!config.getSetting('enhanceSim')) {
            // Remove existing calculator if present
            const existing = panel.querySelector('#mwi-enhancement-stats');
            if (existing) {
                existing.remove();
            }
            return;
        }

        // Get game data
        const gameData = dataManager.getInitClientData();

        // Get item details directly (itemHrid is passed from panel observer)
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) {
            return;
        }

        const itemLevel = itemDetails.itemLevel || 1;

        // Get auto-detected enhancing parameters
        const params = getEnhancingParams();

        // Read Protect From Level from UI
        const protectFromLevel = getProtectFromLevelFromUI(panel);

        // Minimum protection level is 2 (dropping from +2 to +1)
        // Protection at +1 is meaningless (would drop to +0 anyway)
        const effectiveProtectFrom = protectFromLevel < 2 ? 0 : protectFromLevel;

        // Detect protection item once (avoid repeated DOM queries)
        const protectionItemHrid = getProtectionItemFromUI(panel);

        // Check for Philosopher's Mirror - calculator doesn't apply (100% success, different cost model)
        if (protectionItemHrid === '/items/philosophers_mirror') {
            // Remove existing calculator if present
            const existing = panel.querySelector('#mwi-enhancement-stats');
            if (existing) {
                existing.remove();
            }
            return; // Exit - Philosopher's Mirror uses different mechanics
        }

        // Calculate per-action time (simple calculation, no Markov chain needed)
        const perActionTime = calculatePerActionTime(
            params.enhancingLevel,
            itemLevel,
            params.speedBonus
        );

        // Format and inject display
        const html = formatEnhancementDisplay(panel, params, perActionTime, itemDetails, effectiveProtectFrom, itemDetails.enhancementCosts || [], protectionItemHrid);
        injectDisplay(panel, html);
    } catch (error) {
        console.error('[MWI Tools] ❌ Error displaying enhancement stats:', error);
        console.error('[MWI Tools] Error stack:', error.stack);
    }
}

/**
 * Generate costs by level table HTML for all 20 enhancement levels
 * @param {HTMLElement} panel - Enhancement action panel element
 * @param {Object} params - Enhancement parameters
 * @param {number} itemLevel - Item level being enhanced
 * @param {number} protectFromLevel - Protection level from UI
 * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
 * @param {string|null} protectionItemHrid - Protection item HRID (cached, avoid repeated DOM queries)
 * @returns {string} HTML string
 */
function generateCostsByLevelTable(panel, params, itemLevel, protectFromLevel, enhancementCosts, protectionItemHrid) {
    const lines = [];
    const gameData = dataManager.getInitClientData();

    lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
    lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Costs by Enhancement Level:</div>');

    // Calculate costs for each level
    const costData = [];
    for (let level = 1; level <= 20; level++) {
        // Protection only applies when target level reaches the protection threshold
        const effectiveProtect = (protectFromLevel >= 2 && level >= protectFromLevel) ? protectFromLevel : 0;

        const calc = calculateEnhancement({
            enhancingLevel: params.enhancingLevel,
            houseLevel: params.houseLevel,
            toolBonus: params.toolBonus,
            speedBonus: params.speedBonus,
            itemLevel: itemLevel,
            targetLevel: level,
            protectFrom: effectiveProtect,
            blessedTea: params.teas.blessed,
            guzzlingBonus: params.guzzlingBonus
        });

        // Calculate material cost breakdown
        let materialCost = 0;
        const materialBreakdown = {};

        if (enhancementCosts && enhancementCosts.length > 0) {
            enhancementCosts.forEach(cost => {
                const itemDetail = gameData.itemDetailMap[cost.itemHrid];
                let itemPrice = 0;

                if (cost.itemHrid === '/items/coin') {
                    itemPrice = 1;
                } else {
                    const marketData = marketAPI.getPrice(cost.itemHrid, 0);
                    if (marketData && marketData.ask) {
                        itemPrice = marketData.ask;
                    } else {
                        itemPrice = itemDetail?.sellPrice || 0;
                    }
                }

                const quantity = cost.count * calc.attempts;  // Use exact decimal attempts
                const itemCost = quantity * itemPrice;
                materialCost += itemCost;

                // Store breakdown by item name with quantity and unit price
                const itemName = itemDetail?.name || cost.itemHrid;
                materialBreakdown[itemName] = {
                    cost: itemCost,
                    quantity: quantity,
                    unitPrice: itemPrice
                };
            });
        }

        // Add protection item cost
        let protectionCost = 0;
        if (calc.protectionCount > 0) {
            if (protectionItemHrid) {
                const protectionItemDetail = gameData.itemDetailMap[protectionItemHrid];
                let protectionPrice = 0;

                const protectionMarketData = marketAPI.getPrice(protectionItemHrid, 0);
                if (protectionMarketData && protectionMarketData.ask) {
                    protectionPrice = protectionMarketData.ask;
                } else {
                    protectionPrice = protectionItemDetail?.sellPrice || 0;
                }

                protectionCost = calc.protectionCount * protectionPrice;
                const protectionName = protectionItemDetail?.name || protectionItemHrid;
                materialBreakdown[protectionName] = {
                    cost: protectionCost,
                    quantity: calc.protectionCount,
                    unitPrice: protectionPrice
                };
            }
        }

        const totalCost = materialCost + protectionCost;

        costData.push({
            level,
            attempts: calc.attempts,  // Use exact decimal attempts
            protection: calc.protectionCount,
            time: calc.totalTime,
            cost: totalCost,
            breakdown: materialBreakdown
        });
    }

    // Create scrollable table
    lines.push('<div style="max-height: 300px; overflow-y: auto;">');
    lines.push('<table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">');

    // Get all unique material names
    const allMaterials = new Set();
    costData.forEach(data => {
        Object.keys(data.breakdown).forEach(mat => allMaterials.add(mat));
    });
    const materialNames = Array.from(allMaterials);

    // Header row
    lines.push('<tr style="color: #888; border-bottom: 1px solid #444; position: sticky; top: 0; background: rgba(0,0,0,0.9);">');
    lines.push('<th style="text-align: left; padding: 4px;">Level</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Attempts</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Protection</th>');

    // Add material columns
    materialNames.forEach(matName => {
        lines.push(`<th style="text-align: right; padding: 4px;">${matName}</th>`);
    });

    lines.push('<th style="text-align: right; padding: 4px;">Time</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Total Cost</th>');
    lines.push('</tr>');

    costData.forEach((data, index) => {
        const isLastRow = index === costData.length - 1;
        const borderStyle = isLastRow ? '' : 'border-bottom: 1px solid #333;';

        lines.push(`<tr style="${borderStyle}">`);
        lines.push(`<td style="padding: 6px 4px; color: #fff; font-weight: bold;">+${data.level}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${formatAttempts(data.attempts)}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: ${data.protection > 0 ? '#ffa500' : '#888'};">${data.protection > 0 ? formatAttempts(data.protection) : '-'}</td>`);

        // Add material breakdown columns
        materialNames.forEach(matName => {
            const matData = data.breakdown[matName];
            if (matData && matData.cost > 0) {
                const cost = Math.round(matData.cost).toLocaleString();
                const unitPrice = Math.round(matData.unitPrice).toLocaleString();
                const qty = matData.quantity % 1 === 0 ?
                    Math.round(matData.quantity).toLocaleString() :
                    matData.quantity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                // Format as: quantity × unit price → total cost
                lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${qty} × ${unitPrice} → ${cost}</td>`);
            } else {
                lines.push(`<td style="padding: 6px 4px; text-align: right; color: #888;">-</td>`);
            }
        });

        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${timeReadable(data.time)}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ffa500;">${Math.round(data.cost).toLocaleString()}</td>`);
        lines.push('</tr>');
    });

    lines.push('</table>');
    lines.push('</div>'); // Close scrollable container
    lines.push('</div>'); // Close section

    return lines.join('');
}

/**
 * Get Protect From Level from UI input
 * @param {HTMLElement} panel - Enhancing panel
 * @returns {number} Protect from level (0 = never, 1-20)
 */
function getProtectFromLevelFromUI(panel) {
    // Find the "Protect From Level" input
    const labels = Array.from(panel.querySelectorAll('*')).filter(el =>
        el.textContent.trim() === 'Protect From Level' && el.children.length === 0
    );

    if (labels.length > 0) {
        const parent = labels[0].parentElement;
        const input = parent.querySelector('input[type="number"], input[type="text"]');
        if (input && input.value) {
            const value = parseInt(input.value, 10);
            return Math.max(0, Math.min(20, value)); // Clamp 0-20
        }
    }

    return 0; // Default to never protect
}

/**
 * Format enhancement display HTML
 * @param {HTMLElement} panel - Enhancement action panel element (for reading protection slot)
 * @param {Object} params - Auto-detected parameters
 * @param {number} perActionTime - Per-action time in seconds
 * @param {Object} itemDetails - Item being enhanced
 * @param {number} protectFromLevel - Protection level from UI
 * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
 * @param {string|null} protectionItemHrid - Protection item HRID (cached, avoid repeated DOM queries)
 * @returns {string} HTML string
 */
function formatEnhancementDisplay(panel, params, perActionTime, itemDetails, protectFromLevel, enhancementCosts, protectionItemHrid) {
    const lines = [];

    // Header
    lines.push('<div style="margin-top: 15px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.9em;">');
    lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 10px; font-size: 1.1em;">⚙️ ENHANCEMENT CALCULATOR</div>');

    // Item info
    lines.push(`<div style="color: #ddd; margin-bottom: 12px; font-weight: bold;">${itemDetails.name} <span style="color: #888;">(Item Level ${itemDetails.itemLevel})</span></div>`);

    // Current stats section
    lines.push('<div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 12px;">');
    lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Your Enhancing Stats:</div>');

    // Two column layout for stats
    lines.push('<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.85em;">');

    // Left column
    lines.push('<div>');
    lines.push(`<div style="color: #ccc;"><span style="color: #888;">Level:</span> ${params.enhancingLevel - params.detectedTeaBonus}${params.detectedTeaBonus > 0 ? ` <span style="color: #88ff88;">(+${params.detectedTeaBonus.toFixed(1)} tea)</span>` : ''}</div>`);
    lines.push(`<div style="color: #ccc;"><span style="color: #888;">House:</span> Observatory Lvl ${params.houseLevel}</div>`);

    // Display each equipment slot
    if (params.toolSlot) {
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Tool:</span> ${params.toolSlot.name}${params.toolSlot.enhancementLevel > 0 ? ` +${params.toolSlot.enhancementLevel}` : ''}</div>`);
    }
    if (params.bodySlot) {
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Body:</span> ${params.bodySlot.name}${params.bodySlot.enhancementLevel > 0 ? ` +${params.bodySlot.enhancementLevel}` : ''}</div>`);
    }
    if (params.legsSlot) {
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Legs:</span> ${params.legsSlot.name}${params.legsSlot.enhancementLevel > 0 ? ` +${params.legsSlot.enhancementLevel}` : ''}</div>`);
    }
    if (params.handsSlot) {
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Hands:</span> ${params.handsSlot.name}${params.handsSlot.enhancementLevel > 0 ? ` +${params.handsSlot.enhancementLevel}` : ''}</div>`);
    }
    lines.push('</div>');

    // Right column
    lines.push('<div>');

    // Calculate total success (includes level advantage if applicable)
    let totalSuccess = params.toolBonus;
    let successLevelAdvantage = 0;
    if (params.enhancingLevel > itemDetails.itemLevel) {
        // For DISPLAY breakdown: show level advantage WITHOUT house (house shown separately)
        // Calculator correctly uses (enhancing + house - item), but we split for display
        successLevelAdvantage = (params.enhancingLevel - itemDetails.itemLevel) * 0.05;
        totalSuccess += successLevelAdvantage;
    }

    if (totalSuccess > 0) {
        lines.push(`<div style="color: #88ff88;"><span style="color: #888;">Success:</span> +${totalSuccess.toFixed(2)}%</div>`);

        // Show breakdown: equipment + house + level advantage
        const equipmentSuccess = params.equipmentSuccessBonus || 0;
        const houseSuccess = params.houseSuccessBonus || 0;

        if (equipmentSuccess > 0) {
            lines.push(`<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentSuccess.toFixed(2)}%</div>`);
        }
        if (houseSuccess > 0) {
            lines.push(`<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${houseSuccess.toFixed(2)}%</div>`);
        }
        if (successLevelAdvantage > 0) {
            lines.push(`<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${successLevelAdvantage.toFixed(2)}%</div>`);
        }
    }

    // Calculate total speed (includes level advantage if applicable)
    let totalSpeed = params.speedBonus;
    let speedLevelAdvantage = 0;
    if (params.enhancingLevel > itemDetails.itemLevel) {
        speedLevelAdvantage = params.enhancingLevel - itemDetails.itemLevel;
        totalSpeed += speedLevelAdvantage;
    }

    if (totalSpeed > 0) {
        lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +${totalSpeed.toFixed(1)}%</div>`);

        // Show breakdown: equipment + house + community + tea + level advantage
        if (params.equipmentSpeedBonus > 0) {
            lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${params.equipmentSpeedBonus.toFixed(1)}%</div>`);
        }
        if (params.houseSpeedBonus > 0) {
            lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${params.houseSpeedBonus.toFixed(1)}%</div>`);
        }
        if (params.communitySpeedBonus > 0) {
            lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community T${params.communityBuffLevel}:</span> +${params.communitySpeedBonus.toFixed(1)}%</div>`);
        }
        if (params.teaSpeedBonus > 0) {
            const teaName = params.teas.ultraEnhancing ? 'Ultra' : params.teas.superEnhancing ? 'Super' : 'Enhancing';
            lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">${teaName} Tea:</span> +${params.teaSpeedBonus.toFixed(1)}%</div>`);
        }
        if (speedLevelAdvantage > 0) {
            lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${speedLevelAdvantage.toFixed(1)}%</div>`);
        }
    } else if (totalSpeed === 0 && speedLevelAdvantage === 0) {
        lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +0.0%</div>`);
    }

    if (params.teas.blessed) {
        // Calculate Blessed Tea bonus with Guzzling Pouch concentration
        const blessedBonus = 1.1; // Base 1.1% from Blessed Tea
        lines.push(`<div style="color: #ffdd88;"><span style="color: #888;">Blessed:</span> +${blessedBonus.toFixed(1)}%</div>`);
    }
    if (params.rareFindBonus > 0) {
        lines.push(`<div style="color: #ffaa55;"><span style="color: #888;">Rare Find:</span> +${params.rareFindBonus.toFixed(1)}%</div>`);

        // Show house room breakdown if available
        if (params.houseRareFindBonus > 0) {
            const equipmentRareFind = params.rareFindBonus - params.houseRareFindBonus;
            if (equipmentRareFind > 0) {
                lines.push(`<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentRareFind.toFixed(1)}%</div>`);
            }
            lines.push(`<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House Rooms:</span> +${params.houseRareFindBonus.toFixed(1)}%</div>`);
        }
    }
    if (params.experienceBonus > 0) {
        lines.push(`<div style="color: #ffdd88;"><span style="color: #888;">Experience:</span> +${params.experienceBonus.toFixed(1)}%</div>`);

        // Show breakdown: equipment + house wisdom + tea wisdom + community wisdom
        const teaWisdom = params.teaWisdomBonus || 0;
        const houseWisdom = params.houseWisdomBonus || 0;
        const communityWisdom = params.communityWisdomBonus || 0;
        const equipmentExperience = params.experienceBonus - houseWisdom - teaWisdom - communityWisdom;

        if (equipmentExperience > 0) {
            lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentExperience.toFixed(1)}%</div>`);
        }
        if (houseWisdom > 0) {
            lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House Rooms (Wisdom):</span> +${houseWisdom.toFixed(1)}%</div>`);
        }
        if (communityWisdom > 0) {
            const wisdomLevel = params.communityWisdomLevel || 0;
            lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community (Wisdom T${wisdomLevel}):</span> +${communityWisdom.toFixed(1)}%</div>`);
        }
        if (teaWisdom > 0) {
            lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Wisdom Tea:</span> +${teaWisdom.toFixed(1)}%</div>`);
        }
    }
    lines.push('</div>');

    lines.push('</div>'); // Close grid
    lines.push('</div>'); // Close stats section

    // Costs by level table for all 20 levels
    const costsByLevelHTML = generateCostsByLevelTable(panel, params, itemDetails.itemLevel, protectFromLevel, enhancementCosts, protectionItemHrid);
    lines.push(costsByLevelHTML);

    // Materials cost section (if enhancement costs exist) - just show per-attempt materials
    if (enhancementCosts && enhancementCosts.length > 0) {
        lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
        lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Materials Per Attempt:</div>');

        // Get game data for item names
        const gameData = dataManager.getInitClientData();

        // Materials per attempt with pricing
        enhancementCosts.forEach(cost => {
            const itemDetail = gameData.itemDetailMap[cost.itemHrid];
            const itemName = itemDetail ? itemDetail.name : cost.itemHrid;

            // Get price
            let itemPrice = 0;
            if (cost.itemHrid === '/items/coin') {
                itemPrice = 1;
            } else {
                const marketData = marketAPI.getPrice(cost.itemHrid, 0);
                if (marketData && marketData.ask) {
                    itemPrice = marketData.ask;
                } else {
                    itemPrice = itemDetail?.sellPrice || 0;
                }
            }

            const totalCost = cost.count * itemPrice;
            const formattedCount = Number.isInteger(cost.count) ?
                cost.count.toLocaleString() :
                cost.count.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            lines.push(`<div style="font-size: 0.85em; color: #ccc;">${formattedCount}× ${itemName} <span style="color: #888;">(@${itemPrice.toLocaleString()} → ${totalCost.toLocaleString()})</span></div>`);
        });

        // Show protection item cost if protection is active (level 2+) AND item is equipped
        if (protectFromLevel >= 2) {
            if (protectionItemHrid) {
                const protectionItemDetail = gameData.itemDetailMap[protectionItemHrid];
                const protectionItemName = protectionItemDetail?.name || protectionItemHrid;

                // Get protection item price
                let protectionPrice = 0;
                const protectionMarketData = marketAPI.getPrice(protectionItemHrid, 0);
                if (protectionMarketData && protectionMarketData.ask) {
                    protectionPrice = protectionMarketData.ask;
                } else {
                    protectionPrice = protectionItemDetail?.sellPrice || 0;
                }

                lines.push(`<div style="font-size: 0.85em; color: #ffa500; margin-top: 4px;">1× ${protectionItemName} <span style="color: #888;">(if used) (@${protectionPrice.toLocaleString()})</span></div>`);
            }
        }

        lines.push('</div>');
    }

    // Footer notes
    lines.push('<div style="margin-top: 8px; color: #666; font-size: 0.75em; line-height: 1.3;">');

    // Only show protection note if actually using protection
    if (protectFromLevel >= 2) {
        lines.push(`• Protection active from +${protectFromLevel} onwards (enhancement level -1 on failure)<br>`);
    } else {
        lines.push('• No protection used (all failures return to +0)<br>');
    }

    lines.push('• Attempts and time are statistical averages<br>');

    // Calculate total speed for display (includes level advantage if applicable)
    let displaySpeed = params.speedBonus;
    if (params.enhancingLevel > itemDetails.itemLevel) {
        displaySpeed += (params.enhancingLevel - itemDetails.itemLevel);
    }

    lines.push(`• Action time: ${perActionTime.toFixed(2)}s (includes ${displaySpeed.toFixed(1)}% speed bonus)`);
    lines.push('</div>');

    lines.push('</div>'); // Close targets section
    lines.push('</div>'); // Close main container

    return lines.join('');
}

/**
 * Find the "Current Action" tab button (cached on panel for performance)
 * @param {HTMLElement} panel - Enhancement panel element
 * @returns {HTMLButtonElement|null} Current Action tab button or null
 */
function findCurrentActionTab(panel) {
    // Check if we already cached it
    if (panel._cachedCurrentActionTab) {
        return panel._cachedCurrentActionTab;
    }

    // Walk up the DOM to find tab buttons (only once per panel)
    let current = panel;
    let depth = 0;
    const maxDepth = 5;

    while (current && depth < maxDepth) {
        const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
        const currentActionTab = buttons.find(btn => btn.textContent.trim() === 'Current Action');

        if (currentActionTab) {
            // Cache it on the panel for future lookups
            panel._cachedCurrentActionTab = currentActionTab;
            return currentActionTab;
        }

        current = current.parentElement;
        depth++;
    }

    return null;
}

/**
 * Inject enhancement display into panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} html - HTML to inject
 */
function injectDisplay(panel, html) {
    // CRITICAL: Final safety check - verify we're on Enhance tab before injecting
    // This prevents the calculator from appearing on Current Action tab due to race conditions
    const currentActionTab = findCurrentActionTab(panel);
    if (currentActionTab) {
        // Check if Current Action tab is active
        if (currentActionTab.getAttribute('aria-selected') === 'true' ||
            currentActionTab.classList.contains('Mui-selected') ||
            currentActionTab.getAttribute('tabindex') === '0') {
            // Current Action tab is active, don't inject calculator
            return;
        }
    }

    // Check if we already added display
    const existing = panel.querySelector('#mwi-enhancement-stats');
    if (existing) {
        existing.remove();
    }

    // Create container
    const container = document.createElement('div');
    container.id = 'mwi-enhancement-stats';
    container.innerHTML = html;

    // For enhancing panels: append to the end of the panel
    // For regular action panels: insert after drop table or exp gain
    const dropTable = panel.querySelector('div.SkillActionDetail_dropTable__3ViVp');
    const expGain = panel.querySelector('div.SkillActionDetail_expGain__F5xHu');

    if (dropTable || expGain) {
        // Regular action panel - insert after drop table or exp gain
        const insertAfter = dropTable || expGain;
        insertAfter.parentNode.insertBefore(container, insertAfter.nextSibling);
    } else {
        // Enhancing panel - append to end
        panel.appendChild(container);
    }
}
