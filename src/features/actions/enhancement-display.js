/**
 * Enhancement Display
 *
 * Displays enhancement calculations in the enhancement action panel.
 * Shows expected attempts, time, and protection items needed.
 */

import dataManager from '../../core/data-manager.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { calculateEnhancement, compareProtectionStrategies } from '../../utils/enhancement-calculator.js';
import { timeReadable } from '../../utils/formatters.js';
import marketAPI from '../../api/marketplace.js';

/**
 * Calculate and display enhancement statistics in the panel
 * @param {HTMLElement} panel - Enhancement action panel element
 * @param {string} itemHrid - Item HRID (e.g., "/items/cheese_sword")
 */
export async function displayEnhancementStats(panel, itemHrid) {
    try {
        // Get game data
        const gameData = dataManager.getInitClientData();

        // Get item details directly (itemHrid is passed from panel observer)
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) {
            console.log(`[MWI Tools] Item not found: ${itemHrid}`);
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

        console.log(`[MWI Tools] Protect From: ${effectiveProtectFrom > 0 ? `+${effectiveProtectFrom}` : 'Never'}`);

        // Calculate enhancement statistics for common targets (all using same protection strategy)
        const calculations = {
            target10: calculateEnhancement({
                enhancingLevel: params.enhancingLevel,
                houseLevel: params.houseLevel,
                toolBonus: params.toolBonus,
                speedBonus: params.speedBonus,
                itemLevel: itemLevel,
                targetLevel: 10,
                protectFrom: effectiveProtectFrom,
                blessedTea: params.teas.blessed
            }),
            target15: calculateEnhancement({
                enhancingLevel: params.enhancingLevel,
                houseLevel: params.houseLevel,
                toolBonus: params.toolBonus,
                speedBonus: params.speedBonus,
                itemLevel: itemLevel,
                targetLevel: 15,
                protectFrom: effectiveProtectFrom,
                blessedTea: params.teas.blessed
            }),
            target20: calculateEnhancement({
                enhancingLevel: params.enhancingLevel,
                houseLevel: params.houseLevel,
                toolBonus: params.toolBonus,
                speedBonus: params.speedBonus,
                itemLevel: itemLevel,
                targetLevel: 20,
                protectFrom: effectiveProtectFrom,
                blessedTea: params.teas.blessed
            }),
        };

        // Format and inject display
        const html = formatEnhancementDisplay(params, calculations, itemDetails, effectiveProtectFrom, itemDetails.enhancementCosts || []);
        injectDisplay(panel, html);
        console.log('[MWI Tools] ✅ Enhancement calculator displayed successfully!');
    } catch (error) {
        console.error('[MWI Tools] ❌ Error displaying enhancement stats:', error);
        console.error('[MWI Tools] Error stack:', error.stack);
    }
}

/**
 * Generate costs by level table HTML for all 20 enhancement levels
 * @param {Object} params - Enhancement parameters
 * @param {number} itemLevel - Item level being enhanced
 * @param {number} protectFromLevel - Protection level from UI
 * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
 * @returns {string} HTML string
 */
function generateCostsByLevelTable(params, itemLevel, protectFromLevel, enhancementCosts) {
    const lines = [];
    const gameData = dataManager.getInitClientData();

    lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
    lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Costs by Enhancement Level:</div>');

    // Calculate costs for each level
    const costData = [];
    for (let level = 1; level <= 20; level++) {
        const calc = calculateEnhancement({
            enhancingLevel: params.enhancingLevel,
            houseLevel: params.houseLevel,
            toolBonus: params.toolBonus,
            speedBonus: params.speedBonus,
            itemLevel: itemLevel,
            targetLevel: level,
            protectFrom: protectFromLevel < 2 ? 0 : protectFromLevel,
            blessedTea: params.teas.blessed
        });

        // Calculate material cost
        let materialCost = 0;
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

                materialCost += cost.count * itemPrice * calc.attempts;
            });
        }

        costData.push({
            level,
            attempts: calc.attempts,
            protection: calc.protectionCount,
            time: calc.totalTime,
            cost: materialCost
        });
    }

    // Create scrollable table
    lines.push('<div style="max-height: 300px; overflow-y: auto;">');
    lines.push('<table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">');
    lines.push('<tr style="color: #888; border-bottom: 1px solid #444; position: sticky; top: 0; background: rgba(0,0,0,0.9);">');
    lines.push('<th style="text-align: left; padding: 4px;">Level</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Attempts</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Protection</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Time</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Cost</th>');
    lines.push('</tr>');

    costData.forEach((data, index) => {
        const isLastRow = index === costData.length - 1;
        const borderStyle = isLastRow ? '' : 'border-bottom: 1px solid #333;';

        lines.push(`<tr style="${borderStyle}">`);
        lines.push(`<td style="padding: 6px 4px; color: #fff; font-weight: bold;">+${data.level}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${data.attempts.toLocaleString()}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: ${data.protection > 0 ? '#ffa500' : '#888'};">${data.protection > 0 ? data.protection.toLocaleString() : '-'}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${timeReadable(data.time)}</td>`);
        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ffa500;">${data.cost.toLocaleString()}</td>`);
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
 * @param {Object} params - Auto-detected parameters
 * @param {Object} calculations - Calculated enhancement stats
 * @param {Object} itemDetails - Item being enhanced
 * @param {number} protectFromLevel - Protection level from UI
 * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
 * @returns {string} HTML string
 */
function formatEnhancementDisplay(params, calculations, itemDetails, protectFromLevel, enhancementCosts) {
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
    lines.push(`<div style="color: #ccc;"><span style="color: #888;">Level:</span> ${params.enhancingLevel - params.detectedTeaBonus}${params.detectedTeaBonus > 0 ? ` <span style="color: #88ff88;">(+${params.detectedTeaBonus} tea)</span>` : ''}</div>`);
    lines.push(`<div style="color: #ccc;"><span style="color: #888;">House:</span> Laboratory Lvl ${params.houseLevel}</div>`);
    if (params.toolName) {
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Tool:</span> ${params.toolName}${params.toolLevel > 0 ? ` +${params.toolLevel}` : ''}</div>`);
    }
    if (params.speedName) {
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Speed:</span> ${params.speedName}${params.speedLevel > 0 ? ` +${params.speedLevel}` : ''}</div>`);
    }
    lines.push('</div>');

    // Right column
    lines.push('<div>');
    lines.push(`<div style="color: #88ff88;"><span style="color: #888;">Success:</span> +${params.toolBonus.toFixed(2)}%</div>`);
    lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +${params.speedBonus.toFixed(1)}%</div>`);
    if (params.teas.blessed) {
        // Calculate Blessed Tea bonus with Guzzling Pouch concentration
        const blessedBonus = 1.1; // Base 1.1% from Blessed Tea
        lines.push(`<div style="color: #ffdd88;"><span style="color: #888;">Blessed:</span> +${blessedBonus.toFixed(1)}%</div>`);
    }
    if (params.rareFindBonus > 0) {
        lines.push(`<div style="color: #ffaa55;"><span style="color: #888;">Rare Find:</span> +${params.rareFindBonus.toFixed(1)}%</div>`);
    }
    if (params.experienceBonus > 0) {
        lines.push(`<div style="color: #ffdd88;"><span style="color: #888;">Experience:</span> +${params.experienceBonus.toFixed(1)}%</div>`);
    }
    lines.push('</div>');

    lines.push('</div>'); // Close grid
    lines.push('</div>'); // Close stats section

    // Costs by level table for all 20 levels
    const costsByLevelHTML = generateCostsByLevelTable(params, itemDetails.itemLevel, protectFromLevel, enhancementCosts);
    lines.push(costsByLevelHTML);

    // Materials cost section (if enhancement costs exist) - just show per-attempt materials
    if (enhancementCosts && enhancementCosts.length > 0) {
        lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
        lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Materials Per Attempt:</div>');

        // Get game data for item names
        const gameData = dataManager.getInitClientData();

        // Materials per attempt
        lines.push('<div style="font-size: 0.85em; color: #ccc;">');
        const materialStrings = enhancementCosts.map(cost => {
            const itemDetail = gameData.itemDetailMap[cost.itemHrid];
            const itemName = itemDetail ? itemDetail.name : cost.itemHrid;
            return `${cost.count}× ${itemName}`;
        });
        lines.push(materialStrings.join(', '));
        lines.push('</div>');
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
    lines.push(`• Action time: ${calculations.target10.perActionTime.toFixed(2)}s (includes ${params.speedBonus.toFixed(0)}% speed bonus)`);
    lines.push('</div>');

    lines.push('</div>'); // Close targets section
    lines.push('</div>'); // Close main container

    return lines.join('');
}

/**
 * Inject enhancement display into panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} html - HTML to inject
 */
function injectDisplay(panel, html) {
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
