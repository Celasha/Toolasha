/**
 * Enhancement Display
 *
 * Displays enhancement calculations in the enhancement action panel.
 * Shows expected attempts, time, and protection items needed.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { calculateEnhancement, BASE_SUCCESS_RATES } from '../../utils/enhancement-calculator.js';
import { getEnhancingSpeedBreakdown } from '../enhancement/enhancement-xp.js';
import { MIN_ACTION_TIME_SECONDS } from '../../utils/profit-constants.js';
import { timeReadable } from '../../utils/formatters.js';
import marketAPI from '../../api/marketplace.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

/**
 * Format a number with thousands separator and 2 decimal places
 * @param {number} num - Number to format
 * @returns {string} Formatted number (e.g., "1,234.56")
 */
function formatAttempts(num) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(num);
}

/**
 * Get protection item HRID from the Protection slot in the UI
 * @param {HTMLElement} panel - Enhancement action panel element
 * @returns {string|null} Protection item HRID or null if none equipped
 */
export function getProtectionItemFromUI(panel) {
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
        console.error('[Toolasha] Error detecting protection item:', error);
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

        // Get auto-detected enhancing parameters
        const params = getEnhancingParams();

        // Read Protect From Level from UI
        const protectFromLevel = getProtectFromLevelFromUI(panel);

        // Minimum protection level is 2 (dropping from +2 to +1)
        // Protection at +1 is meaningless (would drop to +0 anyway)
        const effectiveProtectFrom = protectFromLevel < 2 ? 0 : protectFromLevel;

        // Detect protection item once (avoid repeated DOM queries)
        const protectionItemHrid = getProtectionItemFromUI(panel);

        // Calculate per-action time from game's buff maps (authoritative source)
        const speedBreakdown = getEnhancingSpeedBreakdown(itemHrid);
        const actionDetails = dataManager.getActionDetails('/actions/enhancing/enhance');
        const baseTime = actionDetails?.baseTimeCost ? actionDetails.baseTimeCost / 1e9 : 12;
        const perActionTime = Math.max(MIN_ACTION_TIME_SECONDS, baseTime / (1 + speedBreakdown.total));

        // Format and inject display
        const html = formatEnhancementDisplay(
            panel,
            params,
            perActionTime,
            baseTime,
            itemDetails,
            effectiveProtectFrom,
            itemDetails.enhancementCosts || [],
            protectionItemHrid,
            speedBreakdown
        );
        injectDisplay(panel, html);
    } catch (error) {
        console.error('[Toolasha] ❌ Error displaying enhancement stats:', error);
        console.error('[Toolasha] Error stack:', error.stack);
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
function generateCostsByLevelTable(
    panel,
    params,
    itemDetails,
    protectFromLevel,
    enhancementCosts,
    protectionItemHrid,
    perActionTime
) {
    const lines = [];
    const gameData = dataManager.getInitClientData();
    const itemLevel = itemDetails.itemLevel || 1;
    const xpBaseLevel = itemDetails.level || itemDetails.equipmentDetail?.levelRequirements?.[0]?.level || 0;
    const wisdomDecimal = params.experienceBonus / 100;

    lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
    lines.push('<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">');
    lines.push('<div style="color: #ffa500; font-weight: bold; font-size: 0.95em;">Costs by Enhancement Level:</div>');
    lines.push(
        '<button id="mwi-expand-costs-table-btn" style="background: rgba(0, 255, 234, 0.1); border: 1px solid #00ffe7; color: #00ffe7; cursor: pointer; font-size: 18px; font-weight: bold; padding: 4px 10px; border-radius: 4px; transition: all 0.15s ease;" title="View full table">⤢</button>'
    );
    lines.push('</div>');

    // Calculate costs for each level
    const costData = [];
    for (let level = 1; level <= 20; level++) {
        // Protection only applies when target level reaches the protection threshold
        const effectiveProtect = protectFromLevel >= 2 && level >= protectFromLevel ? protectFromLevel : 0;

        const calc = calculateEnhancement({
            enhancingLevel: params.enhancingLevel,
            houseLevel: params.houseLevel,
            toolBonus: params.toolBonus,
            speedBonus: params.speedBonus,
            itemLevel: itemLevel,
            targetLevel: level,
            protectFrom: effectiveProtect,
            blessedTea: params.teas.blessed,
            guzzlingBonus: params.guzzlingBonus,
        });

        // Calculate material cost breakdown
        let materialCost = 0;
        const materialBreakdown = {};

        if (enhancementCosts && enhancementCosts.length > 0) {
            enhancementCosts.forEach((cost) => {
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

                const quantity = cost.count * calc.attempts; // Use exact decimal attempts
                const itemCost = quantity * itemPrice;
                materialCost += itemCost;

                // Store breakdown by item name with quantity and unit price
                const itemName = itemDetail?.name || cost.itemHrid;
                materialBreakdown[itemName] = {
                    cost: itemCost,
                    quantity: quantity,
                    unitPrice: itemPrice,
                };
            });
        }

        // Add protection item cost (but NOT for Philosopher's Mirror - it uses different mechanics)
        let protectionCost = 0;
        if (calc.protectionCount > 0 && protectionItemHrid && protectionItemHrid !== '/items/philosophers_mirror') {
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
                unitPrice: protectionPrice,
            };
        }

        const totalCost = materialCost + protectionCost;

        // Override time with buff-map-based per-action time (authoritative source)
        const totalTime = perActionTime * calc.attempts;

        // Calculate XP/hr for this target level
        let totalXP = 0;
        if (calc.visitCounts && totalTime > 0) {
            for (let i = 0; i < level; i++) {
                const visits = calc.visitCounts[i];
                const successRate = calc.successRates[i].actualRate / 100;
                const enhMult = i === 0 ? 1.0 : i + 1;
                const successXP = Math.floor(1.4 * (1 + wisdomDecimal) * enhMult * (10 + xpBaseLevel));
                const failXP = Math.floor(successXP * 0.1);
                totalXP += visits * (successRate * successXP + (1 - successRate) * failXP);
            }
        }
        const xpPerHour = totalTime > 0 ? Math.round((totalXP / totalTime) * 3600) : 0;

        costData.push({
            level,
            attempts: calc.attempts, // Use exact decimal attempts
            protection: calc.protectionCount,
            time: totalTime,
            xpPerHour,
            cost: totalCost,
            breakdown: materialBreakdown,
        });
    }

    // Calculate Philosopher's Mirror costs (if mirror is equipped)
    const isPhilosopherMirror = protectionItemHrid === '/items/philosophers_mirror';
    let mirrorStartLevel = null;
    let totalSavings = 0;

    if (isPhilosopherMirror) {
        const mirrorPrice = marketAPI.getPrice('/items/philosophers_mirror', 0)?.ask || 0;

        // Calculate mirror cost for each level (starts at +3)
        for (let level = 3; level <= 20; level++) {
            const traditionalCost = costData[level - 1].cost;
            const mirrorCost = costData[level - 3].cost + costData[level - 2].cost + mirrorPrice;

            costData[level - 1].mirrorCost = mirrorCost;
            costData[level - 1].isMirrorCheaper = mirrorCost < traditionalCost;

            // Find first level where mirror becomes cheaper
            if (mirrorStartLevel === null && mirrorCost < traditionalCost) {
                mirrorStartLevel = level;
            }
        }

        // Calculate total savings if mirror is used optimally
        if (mirrorStartLevel !== null) {
            const traditionalFinalCost = costData[19].cost; // +20 traditional cost
            const mirrorFinalCost = costData[19].mirrorCost; // +20 mirror cost
            totalSavings = traditionalFinalCost - mirrorFinalCost;
        }
    }

    // Add Philosopher's Mirror summary banner (if applicable)
    if (isPhilosopherMirror && mirrorStartLevel !== null) {
        lines.push(
            '<div style="background: linear-gradient(90deg, rgba(255, 215, 0, 0.15), rgba(255, 215, 0, 0.05)); border: 1px solid #FFD700; border-radius: 4px; padding: 8px; margin-bottom: 8px;">'
        );
        lines.push(
            '<div style="color: #FFD700; font-weight: bold; font-size: 0.95em;">💎 Philosopher\'s Mirror Strategy:</div>'
        );
        lines.push(
            `<div style="color: #fff; font-size: 0.85em; margin-top: 4px;">• Use mirrors starting at <strong>+${mirrorStartLevel}</strong></div>`
        );
        lines.push(
            `<div style="color: #88ff88; font-size: 0.85em;">• Total savings to +20: <strong>${Math.round(totalSavings).toLocaleString()}</strong> coins</div>`
        );
        lines.push(
            `<div style="color: #aaa; font-size: 0.75em; margin-top: 4px; font-style: italic;">Rows highlighted in gold show where mirror is cheaper</div>`
        );
        lines.push('</div>');
    }

    // Create scrollable table
    lines.push('<div id="mwi-enhancement-table-scroll" style="max-height: 300px; overflow-y: auto;">');
    lines.push('<table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">');

    // Get all unique material names
    const allMaterials = new Set();
    costData.forEach((data) => {
        Object.keys(data.breakdown).forEach((mat) => allMaterials.add(mat));
    });
    const materialNames = Array.from(allMaterials);

    // Header row
    lines.push(
        '<tr style="color: #888; border-bottom: 1px solid #444; position: sticky; top: 0; background: rgba(0,0,0,0.9);">'
    );
    lines.push('<th style="text-align: left; padding: 4px;">Level</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Attempts</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Protection</th>');

    // Add material columns
    materialNames.forEach((matName) => {
        lines.push(`<th style="text-align: right; padding: 4px;">${matName}</th>`);
    });

    lines.push('<th style="text-align: right; padding: 4px;">Time</th>');
    lines.push('<th style="text-align: right; padding: 4px;">XP/hr</th>');
    lines.push('<th style="text-align: right; padding: 4px;">Total Cost</th>');

    // Add Mirror Cost column if Philosopher's Mirror is equipped
    if (isPhilosopherMirror) {
        lines.push('<th style="text-align: right; padding: 4px; color: #FFD700;">Mirror Cost</th>');
    }

    lines.push('</tr>');

    costData.forEach((data, index) => {
        const isLastRow = index === costData.length - 1;
        const borderStyle = isLastRow ? '' : 'border-bottom: 1px solid #333;';

        // Highlight row if mirror is cheaper
        let rowStyle = borderStyle;
        if (isPhilosopherMirror && data.isMirrorCheaper) {
            rowStyle += ' background: linear-gradient(90deg, rgba(255, 215, 0, 0.15), rgba(255, 215, 0, 0.05));';
        }

        lines.push(`<tr style="${rowStyle}">`);
        lines.push(`<td style="padding: 6px 4px; color: #fff; font-weight: bold;">+${data.level}</td>`);
        lines.push(
            `<td style="padding: 6px 4px; text-align: right; color: #ccc;">${formatAttempts(data.attempts)}</td>`
        );
        lines.push(
            `<td style="padding: 6px 4px; text-align: right; color: ${data.protection > 0 ? '#ffa500' : '#888'};">${data.protection > 0 ? formatAttempts(data.protection) : '-'}</td>`
        );

        // Add material breakdown columns
        materialNames.forEach((matName) => {
            const matData = data.breakdown[matName];
            if (matData && matData.cost > 0) {
                const cost = Math.round(matData.cost).toLocaleString();
                const unitPrice = Math.round(matData.unitPrice).toLocaleString();
                const qty =
                    matData.quantity % 1 === 0
                        ? Math.round(matData.quantity).toLocaleString()
                        : matData.quantity.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                          });
                // Format as: quantity × unit price → total cost
                lines.push(
                    `<td style="padding: 6px 4px; text-align: right; color: #ccc;">${qty} × ${unitPrice} → ${cost}</td>`
                );
            } else {
                lines.push(`<td style="padding: 6px 4px; text-align: right; color: #888;">-</td>`);
            }
        });

        lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${timeReadable(data.time)}</td>`);
        lines.push(
            `<td style="padding: 6px 4px; text-align: right; color: ${config.COLOR_XP_RATE};">${data.xpPerHour > 0 ? data.xpPerHour.toLocaleString() : '-'}</td>`
        );
        lines.push(
            `<td style="padding: 6px 4px; text-align: right; color: #ffa500;">${Math.round(data.cost).toLocaleString()}</td>`
        );

        // Add Mirror Cost column if Philosopher's Mirror is equipped
        if (isPhilosopherMirror) {
            if (data.mirrorCost !== undefined) {
                const mirrorCostFormatted = Math.round(data.mirrorCost).toLocaleString();
                const isCheaper = data.isMirrorCheaper;
                const color = isCheaper ? '#FFD700' : '#888';
                const symbol = isCheaper ? '✨ ' : '';
                lines.push(
                    `<td style="padding: 6px 4px; text-align: right; color: ${color}; font-weight: ${isCheaper ? 'bold' : 'normal'};">${symbol}${mirrorCostFormatted}</td>`
                );
            } else {
                // Levels 1-2 cannot use mirrors
                lines.push(`<td style="padding: 6px 4px; text-align: right; color: #666;">N/A</td>`);
            }
        }

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
export function getProtectFromLevelFromUI(panel) {
    // Find the "Protect From Level" input
    const labels = Array.from(panel.querySelectorAll('*')).filter(
        (el) => el.textContent.trim() === 'Protect From Level' && el.children.length === 0
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
 * @param {number} baseTime - Base action time in seconds (before speed bonuses)
 * @param {Object} itemDetails - Item being enhanced
 * @param {number} protectFromLevel - Protection level from UI
 * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
 * @param {string|null} protectionItemHrid - Protection item HRID (cached, avoid repeated DOM queries)
 * @returns {string} HTML string
 */
function formatEnhancementDisplay(
    panel,
    params,
    perActionTime,
    baseTime,
    itemDetails,
    protectFromLevel,
    enhancementCosts,
    protectionItemHrid,
    speedBreakdown
) {
    const lines = [];

    // Header
    lines.push(
        '<div style="margin-top: 15px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.9em;">'
    );
    lines.push(
        '<div style="color: #ffa500; font-weight: bold; margin-bottom: 10px; font-size: 1.1em;">⚙️ ENHANCEMENT CALCULATOR</div>'
    );

    // Item info
    lines.push(
        `<div style="color: #ddd; margin-bottom: 12px; font-weight: bold;">${itemDetails.name} <span style="color: #888;">(Item Level ${itemDetails.itemLevel})</span></div>`
    );

    // Current stats section
    lines.push('<div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 12px;">');
    lines.push(
        '<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Your Enhancing Stats:</div>'
    );

    // Two column layout for stats
    lines.push('<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.85em;">');

    // Left column
    lines.push('<div>');
    lines.push(
        `<div style="color: #ccc;"><span style="color: #888;">Level:</span> ${params.enhancingLevel - params.detectedTeaBonus}${params.detectedTeaBonus > 0 ? ` <span style="color: #88ff88;">(+${params.detectedTeaBonus.toFixed(1)} tea)</span>` : ''}</div>`
    );
    lines.push(
        `<div style="color: #ccc;"><span style="color: #888;">House:</span> Observatory Lvl ${params.houseLevel}</div>`
    );

    // Display each equipment slot
    if (params.toolSlot) {
        lines.push(
            `<div style="color: #ccc;"><span style="color: #888;">Tool:</span> ${params.toolSlot.name}${params.toolSlot.enhancementLevel > 0 ? ` +${params.toolSlot.enhancementLevel}` : ''}</div>`
        );
    }
    if (params.bodySlot) {
        lines.push(
            `<div style="color: #ccc;"><span style="color: #888;">Body:</span> ${params.bodySlot.name}${params.bodySlot.enhancementLevel > 0 ? ` +${params.bodySlot.enhancementLevel}` : ''}</div>`
        );
    }
    if (params.legsSlot) {
        lines.push(
            `<div style="color: #ccc;"><span style="color: #888;">Legs:</span> ${params.legsSlot.name}${params.legsSlot.enhancementLevel > 0 ? ` +${params.legsSlot.enhancementLevel}` : ''}</div>`
        );
    }
    if (params.handsSlot) {
        lines.push(
            `<div style="color: #ccc;"><span style="color: #888;">Hands:</span> ${params.handsSlot.name}${params.handsSlot.enhancementLevel > 0 ? ` +${params.handsSlot.enhancementLevel}` : ''}</div>`
        );
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
        lines.push(
            `<div style="color: #88ff88;"><span style="color: #888;">Success:</span> +${totalSuccess.toFixed(2)}%</div>`
        );

        // Show base rate and final rate for current enhancement level
        let currentLevel = null;

        // Try to get level from the action queue first
        const currentActions = dataManager.getCurrentActions();
        const enhancingAction = currentActions.find((a) => a.actionHrid === '/actions/enhancing/enhance');
        if (enhancingAction?.primaryItemHash) {
            const parts = enhancingAction.primaryItemHash.split('::');
            const lastPart = parts[parts.length - 1];
            if (lastPart && !lastPart.startsWith('/')) {
                const parsed = parseInt(lastPart, 10);
                if (!isNaN(parsed)) currentLevel = parsed;
            }
        }

        // Fallback: read from the enhancing input item name in the DOM (e.g., "Dairyhand's Top +5")
        if (currentLevel === null) {
            const inputItems = panel.querySelectorAll('.SkillActionDetail_item__2vEAz .Item_name__2C42x');
            if (inputItems.length > 0) {
                const inputName = inputItems[0].textContent.trim();
                const levelMatch = inputName.match(/\+(\d+)$/);
                currentLevel = levelMatch ? parseInt(levelMatch[1], 10) : 0;
            }
        }

        if (currentLevel !== null && currentLevel >= 0 && currentLevel < BASE_SUCCESS_RATES.length) {
            const baseRate = BASE_SUCCESS_RATES[currentLevel];
            const successMultiplier = 1 + totalSuccess / 100;
            const finalRate = Math.min(100, baseRate * successMultiplier);
            lines.push(
                `<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">+${currentLevel} → +${currentLevel + 1}:</span> ${baseRate}% → ${finalRate.toFixed(2)}%</div>`
            );
        }

        // Show breakdown: equipment + house + level advantage
        const equipmentSuccess = params.equipmentSuccessBonus || 0;
        const houseSuccess = params.houseSuccessBonus || 0;

        if (equipmentSuccess > 0) {
            lines.push(
                `<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentSuccess.toFixed(2)}%</div>`
            );
        }
        if (houseSuccess > 0) {
            lines.push(
                `<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${houseSuccess.toFixed(2)}%</div>`
            );
        }
        if (successLevelAdvantage > 0) {
            lines.push(
                `<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${successLevelAdvantage.toFixed(2)}%</div>`
            );
        }
    }

    // Speed display from game's buff maps (authoritative source)
    const totalSpeed = speedBreakdown.total * 100; // Convert decimal to percentage

    if (totalSpeed > 0) {
        lines.push(
            `<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +${totalSpeed.toFixed(1)}%</div>`
        );

        // Show breakdown from buff maps (each value is decimal, convert to %)
        if (speedBreakdown.equipment > 0) {
            lines.push(
                `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${(speedBreakdown.equipment * 100).toFixed(1)}%</div>`
            );
        }
        if (speedBreakdown.house > 0) {
            lines.push(
                `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${(speedBreakdown.house * 100).toFixed(1)}%</div>`
            );
        }
        if (speedBreakdown.community > 0) {
            lines.push(
                `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community:</span> +${(speedBreakdown.community * 100).toFixed(1)}%</div>`
            );
        }
        if (speedBreakdown.consumable > 0) {
            lines.push(
                `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Tea:</span> +${(speedBreakdown.consumable * 100).toFixed(1)}%</div>`
            );
        }
        if (speedBreakdown.personal > 0) {
            lines.push(
                `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Labyrinth:</span> +${(speedBreakdown.personal * 100).toFixed(1)}%</div>`
            );
        }
        if (speedBreakdown.levelAdvantage > 0) {
            lines.push(
                `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${(speedBreakdown.levelAdvantage * 100).toFixed(1)}%</div>`
            );
        }
    } else {
        lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +0.0%</div>`);
    }

    // Base → effective action time
    lines.push(
        `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Base:</span> ${baseTime.toFixed(2)}s → ${perActionTime.toFixed(2)}s</div>`
    );

    if (params.teas.blessed) {
        // Calculate Blessed Tea bonus with Guzzling Pouch concentration
        const blessedBonus = 1.1; // Base 1.1% from Blessed Tea
        lines.push(
            `<div style="color: #ffdd88;"><span style="color: #888;">Blessed:</span> +${blessedBonus.toFixed(1)}%</div>`
        );
    }
    if (params.rareFindBonus > 0) {
        lines.push(
            `<div style="color: #ffaa55;"><span style="color: #888;">Rare Find:</span> +${params.rareFindBonus.toFixed(1)}%</div>`
        );

        // Show breakdown if available
        const achievementRareFind = params.achievementRareFindBonus || 0;
        if (params.houseRareFindBonus > 0 || achievementRareFind > 0) {
            const equipmentRareFind = Math.max(
                0,
                params.rareFindBonus - params.houseRareFindBonus - achievementRareFind
            );
            if (equipmentRareFind > 0) {
                lines.push(
                    `<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentRareFind.toFixed(1)}%</div>`
                );
            }
            lines.push(
                `<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House Rooms:</span> +${params.houseRareFindBonus.toFixed(1)}%</div>`
            );
            if (achievementRareFind > 0) {
                lines.push(
                    `<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Achievement:</span> +${achievementRareFind.toFixed(1)}%</div>`
                );
            }
        }
    }
    if (params.experienceBonus > 0) {
        lines.push(
            `<div style="color: #ffdd88;"><span style="color: #888;">Experience:</span> +${params.experienceBonus.toFixed(1)}%</div>`
        );

        // Show breakdown: equipment + house wisdom + tea wisdom + community wisdom + achievement wisdom
        const teaWisdom = params.teaWisdomBonus || 0;
        const houseWisdom = params.houseWisdomBonus || 0;
        const communityWisdom = params.communityWisdomBonus || 0;
        const achievementWisdom = params.achievementWisdomBonus || 0;
        const equipmentExperience = Math.max(
            0,
            params.experienceBonus - houseWisdom - teaWisdom - communityWisdom - achievementWisdom
        );

        if (equipmentExperience > 0) {
            lines.push(
                `<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentExperience.toFixed(1)}%</div>`
            );
        }
        if (houseWisdom > 0) {
            lines.push(
                `<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House Rooms (Wisdom):</span> +${houseWisdom.toFixed(1)}%</div>`
            );
        }
        if (communityWisdom > 0) {
            const wisdomLevel = params.communityWisdomLevel || 0;
            lines.push(
                `<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community (Wisdom T${wisdomLevel}):</span> +${communityWisdom.toFixed(1)}%</div>`
            );
        }
        if (teaWisdom > 0) {
            lines.push(
                `<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Wisdom Tea:</span> +${teaWisdom.toFixed(1)}%</div>`
            );
        }
        if (achievementWisdom > 0) {
            lines.push(
                `<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Achievement:</span> +${achievementWisdom.toFixed(1)}%</div>`
            );
        }
    }
    lines.push('</div>');

    lines.push('</div>'); // Close grid
    lines.push('</div>'); // Close stats section

    // Costs by level table for all 20 levels
    const costsByLevelHTML = generateCostsByLevelTable(
        panel,
        params,
        itemDetails,
        protectFromLevel,
        enhancementCosts,
        protectionItemHrid,
        perActionTime
    );
    lines.push(costsByLevelHTML);

    // Materials cost section (if enhancement costs exist) - just show per-attempt materials
    if (enhancementCosts && enhancementCosts.length > 0) {
        lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
        lines.push(
            '<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Materials Per Attempt:</div>'
        );

        // Get game data for item names
        const gameData = dataManager.getInitClientData();

        // Materials per attempt with pricing
        enhancementCosts.forEach((cost) => {
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
            const formattedCount = Number.isInteger(cost.count)
                ? cost.count.toLocaleString()
                : cost.count.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            lines.push(
                `<div style="font-size: 0.85em; color: #ccc;">${formattedCount}× ${itemName} <span style="color: #888;">(@${itemPrice.toLocaleString()} → ${totalCost.toLocaleString()})</span></div>`
            );
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

                lines.push(
                    `<div style="font-size: 0.85em; color: #ffa500; margin-top: 4px;">1× ${protectionItemName} <span style="color: #888;">(if used) (@${protectionPrice.toLocaleString()})</span></div>`
                );
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

    lines.push(
        `• Action time: ${perActionTime.toFixed(2)}s (includes ${(speedBreakdown.total * 100).toFixed(1)}% speed bonus)`
    );
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
        const currentActionTab = buttons.find((btn) => btn.textContent.trim() === 'Current Action');

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
        if (
            currentActionTab.getAttribute('aria-selected') === 'true' ||
            currentActionTab.classList.contains('Mui-selected') ||
            currentActionTab.getAttribute('tabindex') === '0'
        ) {
            // Current Action tab is active, don't inject calculator
            return;
        }
    }

    // Save scroll position before removing existing display
    let savedScrollTop = 0;
    const existing = panel.querySelector('#mwi-enhancement-stats');
    if (existing) {
        const scrollContainer = existing.querySelector('#mwi-enhancement-table-scroll');
        if (scrollContainer) {
            savedScrollTop = scrollContainer.scrollTop;
        }
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

    // Restore scroll position after DOM insertion
    if (savedScrollTop > 0) {
        const newScrollContainer = container.querySelector('#mwi-enhancement-table-scroll');
        if (newScrollContainer) {
            // Use requestAnimationFrame to ensure DOM is fully updated
            requestAnimationFrame(() => {
                newScrollContainer.scrollTop = savedScrollTop;
            });
        }
    }

    // Attach event listener to expand costs table button
    const expandBtn = container.querySelector('#mwi-expand-costs-table-btn');
    if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showCostsTableModal(container);
        });
        expandBtn.addEventListener('mouseenter', () => {
            expandBtn.style.background = 'rgba(255, 0, 212, 0.2)';
            expandBtn.style.borderColor = '#ff00d4';
            expandBtn.style.color = '#ff00d4';
        });
        expandBtn.addEventListener('mouseleave', () => {
            expandBtn.style.background = 'rgba(0, 255, 234, 0.1)';
            expandBtn.style.borderColor = '#00ffe7';
            expandBtn.style.color = '#00ffe7';
        });
    }
}

/**
 * Show costs table in expanded modal overlay
 * @param {HTMLElement} container - Enhancement stats container with the table
 */
function showCostsTableModal(container) {
    // Clone the table and its container
    const tableScroll = container.querySelector('#mwi-enhancement-table-scroll');
    if (!tableScroll) return;

    const table = tableScroll.querySelector('table');
    if (!table) return;

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'mwi-costs-table-backdrop';
    Object.assign(backdrop.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.85)',
        zIndex: '10002',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backdropFilter: 'blur(4px)',
    });

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'mwi-costs-table-modal';
    Object.assign(modal.style, {
        background: 'rgba(5, 5, 15, 0.98)',
        border: '2px solid #00ffe7',
        borderRadius: '12px',
        padding: '20px',
        minWidth: '800px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
    });

    // Clone and style the table
    const clonedTable = table.cloneNode(true);
    clonedTable.style.fontSize = '1em'; // Larger font

    // Update all cell padding for better readability
    const cells = clonedTable.querySelectorAll('th, td');
    cells.forEach((cell) => {
        cell.style.padding = '8px 12px';
    });

    modal.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(0, 255, 234, 0.4); padding-bottom: 10px;">
            <h2 style="margin: 0; color: #00ffe7; font-size: 20px;">📊 Costs by Enhancement Level</h2>
            <button id="mwi-close-costs-modal" style="
                background: none;
                border: none;
                color: #e0f7ff;
                cursor: pointer;
                font-size: 28px;
                padding: 0 8px;
                line-height: 1;
                transition: all 0.15s ease;
            " title="Close">×</button>
        </div>
        <div style="color: #9b9bff; font-size: 0.9em; margin-bottom: 15px;">
            Full breakdown of enhancement costs for all levels
        </div>
    `;

    modal.appendChild(clonedTable);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Close button handler
    const closeBtn = modal.querySelector('#mwi-close-costs-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            backdrop.remove();
        });
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.color = '#ff0055';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.color = '#e0f7ff';
        });
    }

    // Backdrop click to close
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.remove();
        }
    });

    // ESC key to close
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            backdrop.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Remove ESC listener when backdrop is removed
    const observer = createMutationWatcher(
        document.body,
        () => {
            if (!document.body.contains(backdrop)) {
                document.removeEventListener('keydown', escHandler);
                observer();
            }
        },
        { childList: true }
    );
}
