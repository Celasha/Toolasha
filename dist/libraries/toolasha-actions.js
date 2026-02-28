/**
 * Toolasha Actions Library
 * Production, gathering, and alchemy features
 * Version: 1.20.2
 * License: CC-BY-NC-SA-4.0
 */

(function (dataManager, domObserver, config, enhancementConfig_js, enhancementCalculator_js, formatters_js, marketAPI, domObserverHelpers_js, equipmentParser_js, teaParser_js, bonusRevenueCalculator_js, marketData_js, profitConstants_js, efficiency_js, profitHelpers_js, houseEfficiency_js, uiComponents_js, actionPanelHelper_js, dom_js, timerRegistry_js, storage, actionCalculator_js, cleanupRegistry_js, experienceParser_js, reactInput_js, experienceCalculator_js, materialCalculator_js, webSocketHook, tokenValuation_js, buffParser_js) {
    'use strict';

    window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";

    /**
     * Enhancement Display
     *
     * Displays enhancement calculations in the enhancement action panel.
     * Shows expected attempts, time, and protection items needed.
     */


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
    async function displayEnhancementStats(panel, itemHrid) {
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

            const itemLevel = itemDetails.itemLevel || 1;

            // Get auto-detected enhancing parameters
            const params = enhancementConfig_js.getEnhancingParams();

            // Read Protect From Level from UI
            const protectFromLevel = getProtectFromLevelFromUI(panel);

            // Minimum protection level is 2 (dropping from +2 to +1)
            // Protection at +1 is meaningless (would drop to +0 anyway)
            const effectiveProtectFrom = protectFromLevel < 2 ? 0 : protectFromLevel;

            // Detect protection item once (avoid repeated DOM queries)
            const protectionItemHrid = getProtectionItemFromUI(panel);

            // Calculate per-action time (simple calculation, no Markov chain needed)
            const perActionTime = enhancementCalculator_js.calculatePerActionTime(params.enhancingLevel, itemLevel, params.speedBonus);

            // Format and inject display
            const html = formatEnhancementDisplay(
                panel,
                params,
                perActionTime,
                itemDetails,
                effectiveProtectFrom,
                itemDetails.enhancementCosts || [],
                protectionItemHrid
            );
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

            const calc = enhancementCalculator_js.calculateEnhancement({
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

            costData.push({
                level,
                attempts: calc.attempts, // Use exact decimal attempts
                protection: calc.protectionCount,
                time: calc.totalTime,
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

            lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${formatters_js.timeReadable(data.time)}</td>`);
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
    function getProtectFromLevelFromUI(panel) {
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
        itemDetails,
        protectFromLevel,
        enhancementCosts,
        protectionItemHrid
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

        // Calculate total speed (includes level advantage if applicable)
        let totalSpeed = params.speedBonus;
        let speedLevelAdvantage = 0;
        if (params.enhancingLevel > itemDetails.itemLevel) {
            speedLevelAdvantage = params.enhancingLevel - itemDetails.itemLevel;
            totalSpeed += speedLevelAdvantage;
        }

        if (totalSpeed > 0) {
            lines.push(
                `<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +${totalSpeed.toFixed(1)}%</div>`
            );

            // Show breakdown: equipment + house + community + tea + level advantage
            if (params.equipmentSpeedBonus > 0) {
                lines.push(
                    `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${params.equipmentSpeedBonus.toFixed(1)}%</div>`
                );
            }
            if (params.houseSpeedBonus > 0) {
                lines.push(
                    `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${params.houseSpeedBonus.toFixed(1)}%</div>`
                );
            }
            if (params.communitySpeedBonus > 0) {
                lines.push(
                    `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community T${params.communityBuffLevel}:</span> +${params.communitySpeedBonus.toFixed(1)}%</div>`
                );
            }
            if (params.teaSpeedBonus > 0) {
                const teaName = params.teas.ultraEnhancing ? 'Ultra' : params.teas.superEnhancing ? 'Super' : 'Enhancing';
                lines.push(
                    `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">${teaName} Tea:</span> +${params.teaSpeedBonus.toFixed(1)}%</div>`
                );
            }
            if (speedLevelAdvantage > 0) {
                lines.push(
                    `<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${speedLevelAdvantage.toFixed(1)}%</div>`
                );
            }
        } else if (totalSpeed === 0 && speedLevelAdvantage === 0) {
            lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +0.0%</div>`);
        }

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
            itemDetails.itemLevel,
            protectFromLevel,
            enhancementCosts,
            protectionItemHrid
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

        // Calculate total speed for display (includes level advantage if applicable)
        let displaySpeed = params.speedBonus;
        if (params.enhancingLevel > itemDetails.itemLevel) {
            displaySpeed += params.enhancingLevel - itemDetails.itemLevel;
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
        const observer = domObserverHelpers_js.createMutationWatcher(
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

    /**
     * Gathering Profit Calculator
     *
     * Calculates comprehensive profit/hour for gathering actions (Foraging, Woodcutting, Milking) including:
     * - All drop table items at market prices
     * - Drink consumption costs
     * - Equipment speed bonuses
     * - Efficiency buffs (level, house, tea, equipment)
     * - Gourmet tea bonus items (production skills only)
     * - Market tax (2%)
     */


    /**
     * Cache for processing action conversions (inputItemHrid → conversion data)
     * Built once per game data load to avoid O(n) searches through action map
     */
    let processingConversionCache = null;

    /**
     * Build processing conversion cache from game data
     * @param {Object} gameData - Game data from dataManager
     * @returns {Map} Map of inputItemHrid → {actionHrid, outputItemHrid, conversionRatio}
     */
    function buildProcessingConversionCache(gameData) {
        const cache = new Map();
        const validProcessingTypes = [
            '/action_types/cheesesmithing', // Milk → Cheese conversions
            '/action_types/crafting', // Log → Lumber conversions
            '/action_types/tailoring', // Cotton/Flax/Bamboo/Cocoon/Radiant → Fabric conversions
        ];

        for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (!validProcessingTypes.includes(action.type)) {
                continue;
            }

            const inputItem = action.inputItems?.[0];
            const outputItem = action.outputItems?.[0];

            if (inputItem && outputItem) {
                cache.set(inputItem.itemHrid, {
                    actionHrid: actionHrid,
                    outputItemHrid: outputItem.itemHrid,
                    conversionRatio: inputItem.count,
                });
            }
        }

        return cache;
    }

    /**
     * Calculate comprehensive profit for a gathering action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/foraging/asteroid_belt")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateGatheringProfit(actionHrid) {
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process gathering actions (Foraging, Woodcutting, Milking) with drop tables
        if (!profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.dropTable) {
            return null; // No drop table - nothing to calculate
        }

        // Build processing conversion cache once (lazy initialization)
        if (!processingConversionCache) {
            processingConversionCache = buildProcessingConversionCache(gameData);
        }

        const priceCache = new Map();
        const getCachedPrice = (itemHrid, options) => {
            const side = options?.side || '';
            const enhancementLevel = options?.enhancementLevel ?? '';
            const cacheKey = `${itemHrid}|${side}|${enhancementLevel}`;

            if (priceCache.has(cacheKey)) {
                return priceCache.get(cacheKey);
            }

            const price = marketData_js.getItemPrice(itemHrid, options);
            priceCache.set(cacheKey, price);
            return price;
        };

        // Note: Market API is pre-loaded by caller (max-produceable.js)
        // No need to check or fetch here

        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const houseRooms = Array.from(dataManager.getHouseRooms().values());

        // Calculate action time per action (with speed bonuses)
        const baseTimePerActionSec = actionDetail.baseTimeCost / 1000000000;
        const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
        const personalSpeedBonus = dataManager.getPersonalBuffFlatBoost(actionDetail.type, '/buff_types/action_speed');
        // speedBonus is already a decimal (e.g., 0.15 for 15%), don't divide by 100
        const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus + personalSpeedBonus);

        // Calculate actions per hour
        const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actualTimePerActionSec);

        // Get character's actual equipped drink slots for this action type (from WebSocket data)
        const drinkSlots = dataManager.getActionDrinkSlots(actionDetail.type);

        // Get drink concentration from equipment
        const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

        // Parse tea buffs
        const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetail.type, drinkSlots, gameData.itemDetailMap, drinkConcentration);

        // Gourmet Tea only applies to production skills (Brewing, Cooking, Cheesesmithing, Crafting, Tailoring)
        // NOT gathering skills (Foraging, Woodcutting, Milking)
        const gourmetBonus = profitConstants_js.PRODUCTION_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseGourmetBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration) +
              dataManager.getPersonalBuffFlatBoost(actionDetail.type, '/buff_types/gourmet')
            : 0;

        // Processing Tea: 15% base chance to convert raw → processed (Cotton → Cotton Fabric, etc.)
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        const processingBonus = profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseProcessingBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration) +
              dataManager.getPersonalBuffFlatBoost(actionDetail.type, '/buff_types/processing')
            : 0;

        // Gathering Quantity: Increases item drop amounts (min/max)
        // Sources: Gathering Tea (15% base), Community Buff (20% base + 0.5%/level), Achievement Tiers
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        let totalGathering = 0;
        let gatheringTea = 0;
        let communityGathering = 0;
        let achievementGathering = 0;
        let personalGathering = 0;
        if (profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            // Parse Gathering Tea bonus
            gatheringTea = teaParser_js.parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

            // Get Community Buff level for gathering quantity
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
            communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

            // Get Achievement buffs for this action type (Beginner tier: +2% Gathering Quantity)
            achievementGathering = dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/gathering');

            // Get personal buff (Seal of Gathering)
            personalGathering = dataManager.getPersonalBuffFlatBoost(actionDetail.type, '/buff_types/gathering');

            // Stack all bonuses additively
            totalGathering = gatheringTea + communityGathering + achievementGathering + personalGathering;
        }

        const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
            drinkSlots,
            drinkConcentration,
            itemDetailMap: gameData.itemDetailMap,
            getItemPrice: getCachedPrice,
        });
        const drinkCostPerHour = teaCostData.totalCostPerHour;
        const drinkCosts = teaCostData.costs.map((tea) => ({
            name: tea.itemName,
            priceEach: tea.pricePerDrink,
            drinksPerHour: tea.drinksPerHour,
            costPerHour: tea.totalCost,
            missingPrice: tea.missingPrice,
        }));

        // Calculate level efficiency bonus
        const requiredLevel = actionDetail.levelRequirement?.level || 1;
        const skillHrid = actionDetail.levelRequirement?.skillHrid;
        let currentLevel = requiredLevel;
        for (const skill of skills) {
            if (skill.skillHrid === skillHrid) {
                currentLevel = skill.level;
                break;
            }
        }

        // Calculate tea skill level bonus (e.g., +5 Foraging from Ultra Foraging Tea)
        const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
            actionDetail.type,
            drinkSlots,
            gameData.itemDetailMap,
            drinkConcentration
        );

        // Calculate house efficiency bonus
        let houseEfficiency = 0;
        for (const room of houseRooms) {
            const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
            if (roomDetail?.usableInActionTypeMap?.[actionDetail.type]) {
                houseEfficiency += (room.level || 0) * 1.5;
            }
        }

        // Calculate equipment efficiency bonus (uses equipment-parser utility)
        const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
        const equipmentEfficiencyItems = equipmentParser_js.parseEquipmentEfficiencyBreakdown(
            equipment,
            actionDetail.type,
            gameData.itemDetailMap
        );
        const achievementEfficiency =
            dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/efficiency') * 100;
        const personalEfficiency = dataManager.getPersonalBuffFlatBoost(actionDetail.type, '/buff_types/efficiency') * 100;

        const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: currentLevel,
            teaSkillLevelBonus,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency,
            achievementEfficiency,
            personalEfficiency,
        });
        const totalEfficiency = efficiencyBreakdown.totalEfficiency;
        const levelEfficiency = efficiencyBreakdown.levelEfficiency;

        // Calculate efficiency multiplier (matches production profit calculator pattern)
        // Efficiency "repeats the action" - we apply it to item outputs, not action rate
        const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate revenue from drop table
        // Processing happens PER ACTION (before efficiency multiplies the count)
        // So we calculate per-action outputs, then multiply by actionsPerHour and efficiency
        let baseRevenuePerHour = 0;
        let gourmetRevenueBonus = 0;
        let gourmetRevenueBonusPerAction = 0;
        let processingRevenueBonus = 0; // Track extra revenue from Processing Tea
        let processingRevenueBonusPerAction = 0; // Per-action processing revenue
        const processingConversions = []; // Track conversion details for display
        const baseOutputs = []; // Baseline outputs (before gourmet and processing)
        const gourmetBonuses = []; // Gourmet bonus outputs (display-only)
        const dropTable = actionDetail.dropTable;

        for (const drop of dropTable) {
            const rawPrice = getCachedPrice(drop.itemHrid, { context: 'profit', side: 'sell' });
            const rawPriceMissing = rawPrice === null;
            const resolvedRawPrice = rawPriceMissing ? 0 : rawPrice;
            // Apply gathering quantity bonus to drop amounts
            const baseAvgAmount = (drop.minCount + drop.maxCount) / 2;
            const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

            // Check if this item has a Processing Tea conversion (using cache for O(1) lookup)
            // Processing Tea only applies to: Milk→Cheese, Log→Lumber, Cotton/Flax/Bamboo/Cocoon/Radiant→Fabric
            const conversionData = processingConversionCache.get(drop.itemHrid);
            const processedItemHrid = conversionData?.outputItemHrid || null;
            conversionData?.actionHrid || null;

            // Per-action calculations (efficiency will be applied when converting to items per hour)
            let rawPerAction = 0;
            let processedPerAction = 0;

            const rawItemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
            const baseItemsPerHour = actionsPerHour * drop.dropRate * avgAmountPerAction * efficiencyMultiplier;
            const baseItemsPerAction = drop.dropRate * avgAmountPerAction;
            const baseRevenuePerAction = baseItemsPerAction * resolvedRawPrice;
            const baseRevenueLine = baseItemsPerHour * resolvedRawPrice;
            baseRevenuePerHour += baseRevenueLine;

            baseOutputs.push({
                name: rawItemName,
                itemsPerHour: baseItemsPerHour,
                itemsPerAction: baseItemsPerAction,
                dropRate: drop.dropRate,
                priceEach: resolvedRawPrice,
                revenuePerHour: baseRevenueLine,
                revenuePerAction: baseRevenuePerAction,
                missingPrice: rawPriceMissing,
            });

            if (processedItemHrid && processingBonus > 0) {
                // Get conversion ratio from cache (e.g., 1 Milk → 1 Cheese)
                const conversionRatio = conversionData.conversionRatio;

                // Processing Tea check happens per action:
                // If procs (processingBonus% chance): Convert to processed + leftover
                const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);
                const rawLeftoverIfProcs = avgAmountPerAction % conversionRatio;

                // If doesn't proc: All stays raw
                const rawIfNoProc = avgAmountPerAction;

                // Expected value per action
                processedPerAction = processingBonus * processedIfProcs;
                rawPerAction = processingBonus * rawLeftoverIfProcs + (1 - processingBonus) * rawIfNoProc;

                const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                const processedPriceMissing = processedPrice === null;
                const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;

                const processedItemsPerHour = actionsPerHour * drop.dropRate * processedPerAction * efficiencyMultiplier;
                const processedItemsPerAction = drop.dropRate * processedPerAction;

                // Track processing details
                const processedItemName = gameData.itemDetailMap[processedItemHrid]?.name || 'Unknown';

                // Value gain per conversion = cheese value - cost of milk used
                const costOfMilkUsed = conversionRatio * resolvedRawPrice;
                const valueGainPerConversion = resolvedProcessedPrice - costOfMilkUsed;
                const revenueFromConversion = processedItemsPerHour * valueGainPerConversion;
                const rawConsumedPerHour = processedItemsPerHour * conversionRatio;
                const rawConsumedPerAction = processedItemsPerAction * conversionRatio;

                processingRevenueBonus += revenueFromConversion;
                processingRevenueBonusPerAction += processedItemsPerAction * valueGainPerConversion;
                processingConversions.push({
                    rawItem: rawItemName,
                    processedItem: processedItemName,
                    valueGain: valueGainPerConversion,
                    conversionsPerHour: processedItemsPerHour,
                    conversionsPerAction: processedItemsPerAction,
                    rawConsumedPerHour,
                    rawConsumedPerAction,
                    rawPriceEach: resolvedRawPrice,
                    processedPriceEach: resolvedProcessedPrice,
                    revenuePerHour: revenueFromConversion,
                    revenuePerAction: processedItemsPerAction * valueGainPerConversion,
                    missingPrice: rawPriceMissing || processedPriceMissing,
                });
            } else {
                // No processing - simple calculation
                rawPerAction = avgAmountPerAction;
            }

            // Gourmet tea bonus (only for production skills, not gathering)
            if (gourmetBonus > 0) {
                const totalPerAction = rawPerAction + processedPerAction;
                const bonusPerAction = totalPerAction * (gourmetBonus / 100);
                const bonusItemsPerHour = actionsPerHour * drop.dropRate * bonusPerAction * efficiencyMultiplier;
                const bonusItemsPerAction = drop.dropRate * bonusPerAction;

                // Use weighted average price for gourmet bonus
                if (processedItemHrid && processingBonus > 0) {
                    const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                    const processedPriceMissing = processedPrice === null;
                    const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;
                    const weightedPrice =
                        (rawPerAction * resolvedRawPrice + processedPerAction * resolvedProcessedPrice) /
                        (rawPerAction + processedPerAction);
                    const bonusRevenue = bonusItemsPerHour * weightedPrice;
                    gourmetRevenueBonus += bonusRevenue;
                    gourmetRevenueBonusPerAction += bonusItemsPerAction * weightedPrice;
                    gourmetBonuses.push({
                        name: rawItemName,
                        itemsPerHour: bonusItemsPerHour,
                        itemsPerAction: bonusItemsPerAction,
                        dropRate: drop.dropRate,
                        priceEach: weightedPrice,
                        revenuePerHour: bonusRevenue,
                        revenuePerAction: bonusItemsPerAction * weightedPrice,
                        missingPrice: rawPriceMissing || processedPriceMissing,
                    });
                } else {
                    const bonusRevenue = bonusItemsPerHour * resolvedRawPrice;
                    gourmetRevenueBonus += bonusRevenue;
                    gourmetRevenueBonusPerAction += bonusItemsPerAction * resolvedRawPrice;
                    gourmetBonuses.push({
                        name: rawItemName,
                        itemsPerHour: bonusItemsPerHour,
                        itemsPerAction: bonusItemsPerAction,
                        dropRate: drop.dropRate,
                        priceEach: resolvedRawPrice,
                        revenuePerHour: bonusRevenue,
                        revenuePerAction: bonusItemsPerAction * resolvedRawPrice,
                        missingPrice: rawPriceMissing,
                    });
                }
            }
        }

        // Calculate bonus revenue from essence and rare find drops
        const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetail, actionsPerHour, equipment, gameData.itemDetailMap);

        // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
        const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;

        const revenuePerHour =
            baseRevenuePerHour + gourmetRevenueBonus + processingRevenueBonus + efficiencyBoostedBonusRevenue;

        const hasMissingPrices =
            drinkCosts.some((drink) => drink.missingPrice) ||
            baseOutputs.some((output) => output.missingPrice) ||
            gourmetBonuses.some((output) => output.missingPrice) ||
            processingConversions.some((conversion) => conversion.missingPrice) ||
            (bonusRevenue?.hasMissingPrices ?? false);

        // Calculate market tax (2% of gross revenue)
        const marketTax = revenuePerHour * profitConstants_js.MARKET_TAX;

        // Calculate net profit (revenue - market tax - drink costs)
        const profitPerHour = revenuePerHour - marketTax - drinkCostPerHour;

        return {
            profitPerHour,
            profitPerAction: profitHelpers_js.calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
            profitPerDay: profitHelpers_js.calculateProfitPerDay(profitPerHour), // Profit per day
            revenuePerHour,
            drinkCostPerHour,
            drinkCosts, // Array of individual drink costs {name, priceEach, costPerHour}
            actionsPerHour, // Base actions per hour (without efficiency)
            baseOutputs, // Display-only base outputs {name, itemsPerHour, dropRate, priceEach, revenuePerHour}
            gourmetBonuses, // Display-only gourmet bonus outputs
            totalEfficiency, // Total efficiency percentage
            efficiencyMultiplier, // Efficiency as multiplier (1 + totalEfficiency / 100)
            speedBonus,
            bonusRevenue, // Essence and rare find details
            gourmetBonus, // Gourmet bonus percentage
            processingBonus, // Processing Tea chance (as decimal)
            processingRevenueBonus, // Extra revenue from Processing conversions
            processingConversions, // Array of conversion details {rawItem, processedItem, valueGain}
            processingRevenueBonusPerAction, // Processing bonus per action
            gourmetRevenueBonus, // Gourmet bonus revenue per hour
            gourmetRevenueBonusPerAction, // Gourmet bonus revenue per action
            gatheringQuantity: totalGathering, // Total gathering quantity bonus (as decimal) - renamed for display consistency
            totalGathering, // Alias used by formatProfitDisplay
            hasMissingPrices,
            // Top-level gathering breakdown for formatProfitDisplay
            gatheringTea,
            communityGathering,
            achievementGathering,
            personalGathering,
            details: {
                levelEfficiency,
                houseEfficiency,
                teaEfficiency,
                equipmentEfficiency,
                equipmentEfficiencyItems,
                achievementEfficiency,
                personalEfficiency,
                gourmetBonus,
                communityBuffQuantity: communityGathering, // Community Buff component (as decimal)
                gatheringTeaBonus: gatheringTea, // Gathering Tea component (as decimal)
                achievementGathering: achievementGathering, // Achievement Tier component (as decimal)
                personalGathering: personalGathering, // Personal buff (seal) component (as decimal)
            },
        };
    }

    /**
     * Profit Calculator Module
     * Calculates production costs and profit for crafted items
     */


    /**
     * ProfitCalculator class handles profit calculations for production actions
     */
    class ProfitCalculator {
        constructor() {
            // Cached static game data (never changes during session)
            this._itemDetailMap = null;
            this._actionDetailMap = null;
            this._communityBuffMap = null;
        }

        /**
         * Get item detail map (lazy-loaded and cached)
         * @returns {Object} Item details map from init_client_data
         */
        getItemDetailMap() {
            if (!this._itemDetailMap) {
                const initData = dataManager.getInitClientData();
                this._itemDetailMap = initData?.itemDetailMap || {};
            }
            return this._itemDetailMap;
        }

        /**
         * Get action detail map (lazy-loaded and cached)
         * @returns {Object} Action details map from init_client_data
         */
        getActionDetailMap() {
            if (!this._actionDetailMap) {
                const initData = dataManager.getInitClientData();
                this._actionDetailMap = initData?.actionDetailMap || {};
            }
            return this._actionDetailMap;
        }

        /**
         * Get community buff map (lazy-loaded and cached)
         * @returns {Object} Community buff details map from init_client_data
         */
        getCommunityBuffMap() {
            if (!this._communityBuffMap) {
                const initData = dataManager.getInitClientData();
                this._communityBuffMap = initData?.communityBuffTypeDetailMap || {};
            }
            return this._communityBuffMap;
        }

        /**
         * Calculate profit for a crafted item
         * @param {string} itemHrid - Item HRID
         * @returns {Promise<Object|null>} Profit data or null if not craftable
         */
        async calculateProfit(itemHrid) {
            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Find the action that produces this item
            const action = this.findProductionAction(itemHrid);
            if (!action) {
                return null; // Not a craftable item
            }

            // Get character skills for efficiency calculations
            const skills = dataManager.getSkills();
            if (!skills) {
                return null;
            }

            const actionDetails = dataManager.getActionDetails(action.actionHrid);
            if (!actionDetails) {
                return null;
            }

            // Initialize price cache for this calculation
            const priceCache = new Map();
            const getCachedPrice = (itemHridParam, options) => {
                const side = options?.side || '';
                const enhancementLevelParam = options?.enhancementLevel ?? '';
                const cacheKey = `${itemHridParam}|${side}|${enhancementLevelParam}`;

                if (priceCache.has(cacheKey)) {
                    return priceCache.get(cacheKey);
                }

                const price = marketData_js.getItemPrice(itemHridParam, options);
                priceCache.set(cacheKey, price);
                return price;
            };

            // Calculate base action time
            // Game uses NANOSECONDS (1e9 = 1 second)
            const baseTime = actionDetails.baseTimeCost / 1e9; // Convert nanoseconds to seconds

            // Get character level for the action's skill
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);

            // Get equipped items for efficiency bonus calculation
            const characterEquipment = dataManager.getEquipment();
            const itemDetailMap = this.getItemDetailMap();

            // Get Drink Concentration from equipment
            const drinkConcentration = teaParser_js.getDrinkConcentration(characterEquipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas (e.g., Artisan Tea: +5 Action Level)
            // This lowers the effective requirement, not increases skill level
            const actionLevelBonus = teaParser_js.parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate efficiency components
            // Action Level bonus increases the effective requirement
            const baseRequirement = actionDetails.levelRequirement?.level || 1;
            // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
            const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate artisan material cost reduction
            const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate gourmet bonus (Brewing/Cooking extra items)
            const gourmetBonus =
                teaParser_js.parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration) +
                dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/gourmet');

            // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
            const processingBonus =
                teaParser_js.parseProcessingBonus(activeDrinks, itemDetailMap, drinkConcentration) +
                dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/processing');

            // Get community buff bonus (Production Efficiency)
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);

            // Total efficiency bonus (all sources additive)
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionDetails.type);

            // Calculate equipment efficiency bonus
            const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(
                characterEquipment,
                actionDetails.type,
                itemDetailMap
            );
            const equipmentEfficiencyItems = equipmentParser_js.parseEquipmentEfficiencyBreakdown(
                characterEquipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate tea efficiency bonus
            const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetails.type, activeDrinks, itemDetailMap, drinkConcentration);

            const achievementEfficiency =
                dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

            const personalEfficiency =
                dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

            const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
                requiredLevel: baseRequirement,
                skillLevel,
                teaSkillLevelBonus,
                actionLevelBonus,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                communityEfficiency,
                achievementEfficiency,
                personalEfficiency,
            });

            const totalEfficiency = efficiencyBreakdown.totalEfficiency;
            const levelEfficiency = efficiencyBreakdown.levelEfficiency;
            const effectiveRequirement = efficiencyBreakdown.effectiveRequirement;

            // Calculate equipment speed bonus
            const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(characterEquipment, actionDetails.type, itemDetailMap);
            const personalSpeedBonus = dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/action_speed');

            // Calculate action time with ONLY speed bonuses
            // Efficiency does NOT reduce time - it gives bonus actions
            // Formula: baseTime / (1 + speedBonus)
            // Example: 60s / (1 + 0.15) = 52.17s
            const actionTime = baseTime / (1 + equipmentSpeedBonus + personalSpeedBonus);

            // Build time breakdown for display
            const timeBreakdown = this.calculateTimeBreakdown(baseTime, equipmentSpeedBonus + personalSpeedBonus);

            // Actions per hour (base rate without efficiency)
            const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);

            // Get output amount (how many items per action)
            // Use 'count' field from action output
            const outputAmount = action.count || action.baseAmount || 1;

            // Calculate efficiency multiplier
            // Formula matches original MWI Tools: 1 + efficiency%
            // Example: 150% efficiency → 1 + 1.5 = 2.5x multiplier
            const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

            // Items produced per hour (with efficiency multiplier)
            const itemsPerHour = actionsPerHour * outputAmount * efficiencyMultiplier;

            // Extra items from Gourmet (Brewing/Cooking bonus)
            // Statistical average: itemsPerHour × gourmetChance
            const gourmetBonusItems = itemsPerHour * gourmetBonus;

            // Total items per hour (base + gourmet bonus)
            const totalItemsPerHour = itemsPerHour + gourmetBonusItems;

            // Calculate material costs (with artisan reduction if applicable)
            const materialCosts = this.calculateMaterialCosts(actionDetails, artisanBonus, getCachedPrice);

            // Total material cost per action
            const totalMaterialCost = materialCosts.reduce((sum, mat) => sum + mat.totalCost, 0);

            // Get market price for the item
            // Use fallback {ask: 0, bid: 0} if no market data exists (e.g., refined items)
            const itemPrice = marketAPI.getPrice(itemHrid, 0) || { ask: 0, bid: 0 };

            // Get output price based on pricing mode setting
            // Uses 'profit' context with 'sell' side to get correct sell price
            const rawOutputPrice = getCachedPrice(itemHrid, { context: 'profit', side: 'sell' });
            const outputPriceMissing = rawOutputPrice === null;
            const craftingFallback = outputPriceMissing ? this.calculateCraftingCostFallback(itemHrid, getCachedPrice) : 0;
            const outputPriceEstimated = outputPriceMissing && craftingFallback > 0;
            const outputPrice = outputPriceMissing ? craftingFallback : rawOutputPrice;

            // Apply market tax (2% tax on sales)
            const priceAfterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);

            // Cost per item (without efficiency scaling)
            const costPerItem = totalMaterialCost / outputAmount;

            // Material costs per hour (accounting for efficiency multiplier)
            // Efficiency repeats the action, consuming materials each time
            const materialCostPerHour = actionsPerHour * totalMaterialCost * efficiencyMultiplier;

            // Revenue per hour (gross, before tax)
            const revenuePerHour = itemsPerHour * outputPrice + gourmetBonusItems * outputPrice;

            // Calculate tea consumption costs (drinks consumed per hour)
            const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                drinkSlots: activeDrinks,
                drinkConcentration,
                itemDetailMap,
                getItemPrice: getCachedPrice,
            });
            const teaCosts = teaCostData.costs;
            const totalTeaCostPerHour = teaCostData.totalCostPerHour;

            // Calculate bonus revenue from essence and rare find drops (before profit calculation)
            const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap);

            const hasMissingPrices =
                (outputPriceMissing && !outputPriceEstimated) ||
                materialCosts.some((material) => material.missingPrice) ||
                teaCostData.hasMissingPrices ||
                (bonusRevenue?.hasMissingPrices ?? false);

            // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
            const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

            // Calculate market tax (2% of gross revenue including bonus revenue)
            const marketTax = (revenuePerHour + efficiencyBoostedBonusRevenue) * profitConstants_js.MARKET_TAX;

            // Total costs per hour (materials + teas + market tax)
            const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour + marketTax;

            // Profit per hour (revenue + bonus revenue - total costs)
            const profitPerHour = revenuePerHour + efficiencyBoostedBonusRevenue - totalCostPerHour;

            // Profit per item (for display)
            const profitPerItem = profitPerHour / totalItemsPerHour;

            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');

            return {
                itemName: itemDetails.name,
                itemHrid,
                actionTime,
                actionsPerHour,
                itemsPerHour,
                totalItemsPerHour, // Items/hour including Gourmet bonus
                gourmetBonusItems, // Extra items from Gourmet
                outputAmount,
                materialCosts,
                totalMaterialCost,
                materialCostPerHour, // Material costs per hour (with efficiency)
                teaCosts, // Tea consumption costs breakdown
                totalTeaCostPerHour, // Total tea costs per hour
                costPerItem,
                itemPrice,
                outputPrice, // Output price before tax (bid or ask based on mode)
                outputPriceMissing,
                outputPriceEstimated, // True when outputPriceMissing but crafting cost fallback resolved a price
                priceAfterTax, // Output price after 2% tax (bid or ask based on mode)
                revenuePerHour,
                profitPerItem,
                profitPerHour,
                profitPerAction: profitHelpers_js.calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
                profitPerDay: profitHelpers_js.calculateProfitPerDay(profitPerHour), // Profit per day
                bonusRevenue, // Bonus revenue from essences and rare finds
                hasMissingPrices,
                totalEfficiency, // Total efficiency percentage
                levelEfficiency, // Level advantage efficiency
                houseEfficiency, // House room efficiency
                equipmentEfficiency, // Equipment efficiency
                equipmentEfficiencyItems, // Per-item equipment efficiency breakdown
                teaEfficiency, // Tea buff efficiency
                communityEfficiency, // Community buff efficiency
                achievementEfficiency, // Achievement buff efficiency
                personalEfficiency, // Personal buff (seal) efficiency
                actionLevelBonus, // Action Level bonus from teas (e.g., Artisan Tea)
                artisanBonus, // Artisan material cost reduction
                gourmetBonus, // Gourmet bonus item chance
                processingBonus, // Processing conversion chance
                drinkConcentration, // Drink Concentration stat
                teaSkillLevelBonus, // Tea skill level bonus (e.g., +8 from Ultra Cheesesmithing Tea)
                efficiencyMultiplier,
                equipmentSpeedBonus,
                personalSpeedBonus, // Personal buff (seal) speed bonus
                skillLevel,
                baseRequirement, // Base requirement level
                effectiveRequirement, // Requirement after Action Level bonus
                requiredLevel: effectiveRequirement, // For backwards compatibility
                timeBreakdown,
                pricingMode, // Pricing mode for display
            };
        }

        /**
         * Estimate an item's value from the cost of its crafting inputs.
         * Used as a fallback when the item has no market listing (e.g. refined items).
         * @param {string} itemHrid - Item HRID to estimate
         * @param {Function} getCachedPrice - Price lookup function
         * @returns {number} Estimated price (0 if no crafting action found)
         */
        calculateCraftingCostFallback(itemHrid, getCachedPrice) {
            const actionDetailMap = this.getActionDetailMap();
            for (const action of Object.values(actionDetailMap)) {
                if (!action.outputItems) continue;
                const output = action.outputItems.find((o) => o.itemHrid === itemHrid);
                if (!output) continue;
                let totalCost = 0;
                if (action.upgradeItemHrid) {
                    const price = getCachedPrice(action.upgradeItemHrid, { context: 'profit', side: 'buy' }) ?? 0;
                    totalCost += price;
                }
                for (const input of action.inputItems || []) {
                    const price = getCachedPrice(input.itemHrid, { context: 'profit', side: 'buy' }) ?? 0;
                    totalCost += price * (input.count || 1);
                }
                return totalCost / (output.count || 1);
            }
            return 0;
        }

        /**
         * Find the action that produces a given item
         * @param {string} itemHrid - Item HRID
         * @returns {Object|null} Action output data or null
         */
        findProductionAction(itemHrid) {
            const actionDetailMap = this.getActionDetailMap();

            // Search through all actions for one that produces this item
            for (const [actionHrid, action] of Object.entries(actionDetailMap)) {
                if (action.outputItems) {
                    for (const output of action.outputItems) {
                        if (output.itemHrid === itemHrid) {
                            return {
                                actionHrid,
                                ...output,
                            };
                        }
                    }
                }
            }

            return null;
        }

        /**
         * Calculate material costs for an action
         * @param {Object} actionDetails - Action details from game data
         * @param {number} artisanBonus - Artisan material reduction (0 to 1, e.g., 0.112 for 11.2% reduction)
         * @param {Function} getCachedPrice - Price lookup function with caching
         * @returns {Array} Array of material cost objects
         */
        calculateMaterialCosts(actionDetails, artisanBonus = 0, getCachedPrice) {
            const costs = [];

            // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
            if (actionDetails.upgradeItemHrid) {
                const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);

                if (itemDetails) {
                    // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                    const materialPrice = getCachedPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' });
                    const isPriceMissing = materialPrice === null;
                    const resolvedPrice = isPriceMissing ? 0 : materialPrice;

                    // Special case: Coins have no market price but have face value of 1
                    let finalPrice = resolvedPrice;
                    let isMissing = isPriceMissing;
                    if (actionDetails.upgradeItemHrid === '/items/coin' && finalPrice === 0) {
                        finalPrice = 1;
                        isMissing = false;
                    }

                    // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                    const reducedAmount = 1;

                    costs.push({
                        itemHrid: actionDetails.upgradeItemHrid,
                        itemName: itemDetails.name,
                        baseAmount: 1,
                        amount: reducedAmount,
                        askPrice: finalPrice,
                        totalCost: finalPrice * reducedAmount,
                        missingPrice: isMissing,
                    });
                }
            }

            // Process regular input items
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                for (const input of actionDetails.inputItems) {
                    const itemDetails = dataManager.getItemDetails(input.itemHrid);

                    if (!itemDetails) {
                        continue;
                    }

                    // Use 'count' field (not 'amount')
                    const baseAmount = input.count || input.amount || 1;

                    // Apply artisan reduction
                    const reducedAmount = baseAmount * (1 - artisanBonus);

                    // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                    const materialPrice = getCachedPrice(input.itemHrid, { context: 'profit', side: 'buy' });
                    const isPriceMissing = materialPrice === null;
                    const resolvedPrice = isPriceMissing ? 0 : materialPrice;

                    // Special case: Coins have no market price but have face value of 1
                    let finalPrice = resolvedPrice;
                    let isMissing = isPriceMissing;
                    if (input.itemHrid === '/items/coin' && finalPrice === 0) {
                        finalPrice = 1; // 1 coin = 1 gold value
                        isMissing = false;
                    }

                    costs.push({
                        itemHrid: input.itemHrid,
                        itemName: itemDetails.name,
                        baseAmount: baseAmount,
                        amount: reducedAmount,
                        askPrice: finalPrice,
                        totalCost: finalPrice * reducedAmount,
                        missingPrice: isMissing,
                    });
                }
            }

            return costs;
        }

        /**
         * Get character skill level for a skill type
         * @param {Array} skills - Character skills array
         * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
         * @returns {number} Skill level
         */
        getSkillLevel(skills, skillType) {
            // Map action type to skill HRID
            // e.g., "/action_types/cheesesmithing" -> "/skills/cheesesmithing"
            const skillHrid = skillType.replace('/action_types/', '/skills/');

            const skill = skills.find((s) => s.skillHrid === skillHrid);
            return skill?.level || 1;
        }

        /**
         * Calculate efficiency bonus from multiple sources
         * @param {number} characterLevel - Character's skill level
         * @param {number} requiredLevel - Action's required level
         * @param {string} actionTypeHrid - Action type HRID for house room matching
         * @returns {number} Total efficiency bonus percentage
         */
        calculateEfficiencyBonus(characterLevel, requiredLevel, actionTypeHrid) {
            // Level efficiency: +1% per level above requirement
            const levelEfficiency = Math.max(0, characterLevel - requiredLevel);

            // House room efficiency: houseLevel × 1.5%
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionTypeHrid);

            // Total efficiency (sum of all sources)
            const totalEfficiency = levelEfficiency + houseEfficiency;

            return totalEfficiency;
        }

        /**
         * Calculate time breakdown showing how modifiers affect action time
         * @param {number} baseTime - Base action time in seconds
         * @param {number} equipmentSpeedBonus - Equipment speed bonus as decimal (e.g., 0.15 for 15%)
         * @returns {Object} Time breakdown with steps
         */
        calculateTimeBreakdown(baseTime, equipmentSpeedBonus) {
            const steps = [];

            // Equipment Speed step (if > 0)
            if (equipmentSpeedBonus > 0) {
                const finalTime = baseTime / (1 + equipmentSpeedBonus);
                const reduction = baseTime - finalTime;

                steps.push({
                    name: 'Equipment Speed',
                    bonus: equipmentSpeedBonus * 100, // convert to percentage
                    reduction: reduction, // seconds saved
                    timeAfter: finalTime, // final time
                });

                return {
                    baseTime: baseTime,
                    steps: steps,
                    finalTime: finalTime,
                    actionsPerHour: profitHelpers_js.calculateActionsPerHour(finalTime),
                };
            }

            // No modifiers - final time is base time
            return {
                baseTime: baseTime,
                steps: [],
                finalTime: baseTime,
                actionsPerHour: profitHelpers_js.calculateActionsPerHour(baseTime),
            };
        }

        /**
         * Calculate community buff bonus for production efficiency
         * @param {number} buffLevel - Community buff level (0-20)
         * @param {string} actionTypeHrid - Action type to check if buff applies
         * @returns {number} Efficiency bonus percentage
         */
        calculateCommunityBuffBonus(buffLevel, actionTypeHrid) {
            if (buffLevel === 0) {
                return 0;
            }

            // Check if buff applies to this action type
            const communityBuffMap = this.getCommunityBuffMap();
            const buffDef = communityBuffMap['/community_buff_types/production_efficiency'];

            if (!buffDef?.usableInActionTypeMap?.[actionTypeHrid]) {
                return 0; // Buff doesn't apply to this skill
            }

            // Formula: flatBoost + (level - 1) × flatBoostLevelBonus
            const baseBonus = buffDef.buff.flatBoost * 100; // 14%
            const levelBonus = (buffLevel - 1) * buffDef.buff.flatBoostLevelBonus * 100; // 0.3% per level

            return baseBonus + levelBonus;
        }
    }

    const profitCalculator = new ProfitCalculator();

    /**
     * Production Profit Calculator
     *
     * Calculates comprehensive profit/hour for production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     * Reuses existing profit calculator from tooltip system.
     */


    /**
     * Action types for production skills (5 skills)
     */
    const PRODUCTION_TYPES$4 = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * Calculate comprehensive profit for a production action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/brewing/efficiency_tea")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateProductionProfit(actionHrid) {
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process production actions with outputs
        if (!PRODUCTION_TYPES$4.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.outputItems || actionDetail.outputItems.length === 0) {
            return null; // No output - nothing to calculate
        }

        // Note: Market API is pre-loaded by caller (max-produceable.js)
        // No need to check or fetch here

        // Get output item HRID
        const outputItemHrid = actionDetail.outputItems[0].itemHrid;

        // Reuse existing profit calculator (does all the heavy lifting)
        const profitData = await profitCalculator.calculateProfit(outputItemHrid);

        if (!profitData) {
            return null;
        }

        return profitData;
    }

    /**
     * Profit Display Functions
     *
     * Handles displaying profit calculations in action panels for:
     * - Gathering actions (Foraging, Woodcutting, Milking)
     * - Production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     */


    const getMissingPriceIndicator = (isMissing) => (isMissing ? ' ⚠' : '');
    const formatMissingLabel = (isMissing, value) => (isMissing ? '-- ⚠' : value);

    const getBonusDropPerHourTotals = (drop, efficiencyMultiplier = 1) => ({
        dropsPerHour: drop.dropsPerHour * efficiencyMultiplier,
        revenuePerHour: drop.revenuePerHour * efficiencyMultiplier,
    });

    const getBonusDropTotalsForActions = (drop, actionsCount, actionsPerHour) => {
        const dropsPerAction = drop.dropsPerAction ?? drop.dropsPerHour / actionsPerHour;
        const revenuePerAction = drop.revenuePerAction ?? drop.revenuePerHour / actionsPerHour;

        return {
            totalDrops: dropsPerAction * actionsCount,
            totalRevenue: revenuePerAction * actionsCount,
        };
    };
    const formatRareFindBonusSummary = (bonusRevenue) => {
        const rareFindBonus = bonusRevenue?.rareFindBonus || 0;
        return `${rareFindBonus.toFixed(1)}% rare find`;
    };

    /**
     * Display gathering profit calculation in panel
     * @param {HTMLElement} panel - Action panel element
     * @param {string} actionHrid - Action HRID
     * @param {string} dropTableSelector - CSS selector for drop table element
     */
    async function displayGatheringProfit(panel, actionHrid, dropTableSelector) {
        // Check global hide setting
        if (config.getSetting('actionPanel_hideActionStats')) {
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
        const marketTax = Math.round(revenue * profitConstants_js.MARKET_TAX);
        const costs = Math.round(profitData.drinkCostPerHour + marketTax);
        const summary = formatMissingLabel(
            netMissing,
            `${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day | Total profit: 0`
        );

        const detailsContent = document.createElement('div');

        // Revenue Section
        const revenueDiv = document.createElement('div');
        const revenueLabel = formatMissingLabel(revenueMissing, `${formatters_js.formatLargeNumber(revenue)}/hr`);
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

        // Primary Outputs subsection
        const primaryDropsContent = document.createElement('div');
        if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
            for (const output of profitData.baseOutputs) {
                const decimals = output.itemsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
                line.textContent = `• ${output.name} (Base): ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatters_js.formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatters_js.formatLargeNumber(Math.round(output.revenuePerHour))}/hr`;
                primaryDropsContent.appendChild(line);
            }
        }

        if (profitData.gourmetBonuses && profitData.gourmetBonuses.length > 0) {
            for (const output of profitData.gourmetBonuses) {
                const decimals = output.itemsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                const missingPriceNote = getMissingPriceIndicator(output.missingPrice);
                line.textContent = `• ${output.name} (Gourmet ${formatters_js.formatPercentage(profitData.gourmetBonus || 0, 1)}): ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatters_js.formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatters_js.formatLargeNumber(Math.round(output.revenuePerHour))}/hr`;
                primaryDropsContent.appendChild(line);
            }
        }

        if (profitData.processingConversions && profitData.processingConversions.length > 0) {
            const netProcessingValue = Math.round(profitData.processingRevenueBonus || 0);
            const netProcessingLabel = formatMissingLabel(
                processingMissing,
                `${netProcessingValue >= 0 ? '+' : '-'}${formatters_js.formatLargeNumber(Math.abs(netProcessingValue))}`
            );
            const processingContent = document.createElement('div');

            for (const conversion of profitData.processingConversions) {
                const consumedLine = document.createElement('div');
                consumedLine.style.marginLeft = '8px';
                const consumedMissingNote = getMissingPriceIndicator(conversion.missingPrice);
                const consumedRevenue = conversion.rawConsumedPerHour * conversion.rawPriceEach;
                consumedLine.textContent = `• ${conversion.rawItem} consumed: -${conversion.rawConsumedPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(conversion.rawPriceEach)}${consumedMissingNote} → -${formatters_js.formatLargeNumber(Math.round(consumedRevenue))}/hr`;
                processingContent.appendChild(consumedLine);

                const producedLine = document.createElement('div');
                producedLine.style.marginLeft = '8px';
                const producedMissingNote = getMissingPriceIndicator(conversion.missingPrice);
                const producedRevenue = conversion.conversionsPerHour * conversion.processedPriceEach;
                producedLine.textContent = `• ${conversion.processedItem} produced: ${conversion.conversionsPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(conversion.processedPriceEach)}${producedMissingNote} → ${formatters_js.formatLargeNumber(Math.round(producedRevenue))}/hr`;
                processingContent.appendChild(producedLine);
            }

            const processingSection = uiComponents_js.createCollapsibleSection(
                '',
                `• Processing (${formatters_js.formatPercentage(profitData.processingBonus || 0, 1)} proc): Net ${netProcessingLabel}/hr`,
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
        const primaryRevenueLabel = formatMissingLabel(primaryMissing, formatters_js.formatLargeNumber(Math.round(primaryRevenue)));
        const outputItemCount =
            (profitData.baseOutputs?.length || 0) +
            (profitData.processingConversions && profitData.processingConversions.length > 0 ? 1 : 0);
        const primaryDropsSection = uiComponents_js.createCollapsibleSection(
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
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(revenuePerHour))}/hr`;
                essenceContent.appendChild(line);
            }

            const essenceRevenue = essenceDrops.reduce(
                (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
                0
            );
            const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatters_js.formatLargeNumber(Math.round(essenceRevenue)));
            const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
            essenceSection = uiComponents_js.createCollapsibleSection(
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
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(revenuePerHour))}/hr`;
                rareFindContent.appendChild(line);
            }

            const rareFindRevenue = rareFinds.reduce(
                (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
                0
            );
            const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatters_js.formatLargeNumber(Math.round(rareFindRevenue)));
            const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
            rareFindSection = uiComponents_js.createCollapsibleSection(
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
        const costsLabel = formatMissingLabel(costsMissing, `${formatters_js.formatLargeNumber(costs)}/hr`);
        costsDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_LOSS}; margin-top: 12px; margin-bottom: 4px;">Costs: ${costsLabel}</div>`;

        // Drink Costs subsection
        const drinkCostsContent = document.createElement('div');
        if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
            for (const drink of profitData.drinkCosts) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                const missingPriceNote = getMissingPriceIndicator(drink.missingPrice);
                line.textContent = `• ${drink.name}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(drink.priceEach)}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
                drinkCostsContent.appendChild(line);
            }
        }

        const drinkCount = profitData.drinkCosts?.length || 0;
        const drinkCostsLabel = drinkCostsMissing ? '-- ⚠' : formatters_js.formatLargeNumber(Math.round(profitData.drinkCostPerHour));
        const drinkCostsSection = uiComponents_js.createCollapsibleSection(
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
        const marketTaxLabel = marketTaxMissing ? '-- ⚠' : `${formatters_js.formatLargeNumber(marketTax)}/hr`;
        marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
        marketTaxContent.appendChild(marketTaxLine);

        const marketTaxHeader = marketTaxMissing ? '-- ⚠' : `${formatters_js.formatLargeNumber(marketTax)}/hr`;
        const marketTaxSection = uiComponents_js.createCollapsibleSection(
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
            return uiComponents_js.createCollapsibleSection(null, `${title}: +${total}`, null, content, false, 1);
        };

        // Efficiency
        const effRows = [];
        if (profitData.details.levelEfficiency > 0) {
            effRows.push(`+${profitData.details.levelEfficiency.toFixed(1)}% Level advantage`);
        }
        if (profitData.details.houseEfficiency > 0) {
            effRows.push(`+${profitData.details.houseEfficiency.toFixed(1)}% House room`);
        }
        if (profitData.details.teaEfficiency > 0) {
            effRows.push(`+${profitData.details.teaEfficiency.toFixed(1)}% Tea`);
        }
        if ((profitData.details.equipmentEfficiencyItems || []).length > 0) {
            for (const item of profitData.details.equipmentEfficiencyItems) {
                const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                effRows.push(`+${item.value.toFixed(1)}% ${item.name}${enh}`);
            }
        } else if (profitData.details.equipmentEfficiency > 0) {
            effRows.push(`+${profitData.details.equipmentEfficiency.toFixed(1)}% Equipment`);
        }
        if (profitData.details.communityEfficiency > 0) {
            effRows.push(`+${profitData.details.communityEfficiency.toFixed(1)}% Community buff`);
        }
        if (profitData.details.achievementEfficiency > 0) {
            effRows.push(`+${profitData.details.achievementEfficiency.toFixed(1)}% Achievement`);
        }
        if (profitData.details.personalEfficiency > 0) {
            effRows.push(`+${profitData.details.personalEfficiency.toFixed(1)}% Seal of Efficiency`);
        }
        if (effRows.length > 0) {
            modifierSummaryParts.push(`+${profitData.totalEfficiency.toFixed(1)}% eff`);
            modifierSubSections.push(
                makeModifierSection('Efficiency', `${profitData.totalEfficiency.toFixed(1)}%`, effRows)
            );
        }

        // Gathering Quantity
        if (profitData.gatheringQuantity > 0) {
            const gatherRows = [];
            if (profitData.details.communityBuffQuantity > 0) {
                gatherRows.push(`+${(profitData.details.communityBuffQuantity * 100).toFixed(1)}% Community buff`);
            }
            if (profitData.details.gatheringTeaBonus > 0) {
                gatherRows.push(`+${(profitData.details.gatheringTeaBonus * 100).toFixed(1)}% Tea`);
            }
            if (profitData.details.achievementGathering > 0) {
                gatherRows.push(`+${(profitData.details.achievementGathering * 100).toFixed(1)}% Achievement`);
            }
            if (profitData.details.personalGathering > 0) {
                gatherRows.push(`+${(profitData.details.personalGathering * 100).toFixed(1)}% Seal of Gathering`);
            }
            const gatherTotal = `${(profitData.gatheringQuantity * 100).toFixed(1)}%`;
            modifierSummaryParts.push(`+${(profitData.gatheringQuantity * 100).toFixed(1)}% gather`);
            modifierSubSections.push(makeModifierSection('Gathering Quantity', gatherTotal, gatherRows));
        }

        // Rare Find
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        const rareFindBreakdown = profitData.bonusRevenue?.rareFindBreakdown || {};
        if (rareFindBonus > 0) {
            const rareRows = [];
            for (const item of rareFindBreakdown.equipmentItems || []) {
                const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                rareRows.push(`+${item.value.toFixed(1)}% ${item.name}${enh}`);
            }
            if (rareFindBreakdown.house > 0) {
                rareRows.push(`+${rareFindBreakdown.house.toFixed(1)}% House rooms`);
            }
            if (rareFindBreakdown.achievement > 0) {
                rareRows.push(`+${rareFindBreakdown.achievement.toFixed(1)}% Achievement`);
            }
            if (rareFindBreakdown.personal > 0) {
                rareRows.push(`+${rareFindBreakdown.personal.toFixed(1)}% Seal of Rare Find`);
            }
            modifierSummaryParts.push(`+${rareFindBonus.toFixed(1)}% rare`);
            modifierSubSections.push(makeModifierSection('Rare Find', `${rareFindBonus.toFixed(1)}%`, rareRows));
        }

        // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
        detailsContent.appendChild(revenueDiv);
        detailsContent.appendChild(costsDiv);

        if (modifierSubSections.length > 0) {
            const modifierContent = document.createElement('div');
            for (const sub of modifierSubSections) {
                modifierContent.appendChild(sub);
            }
            const modifiersSection = uiComponents_js.createCollapsibleSection(
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
            : `Net Profit: ${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

        // Add pricing mode label
        const pricingMode = profitData.pricingMode || 'hybrid';
        const modeLabel =
            {
                conservative: 'Conservative',
                hybrid: 'Hybrid',
                optimistic: 'Optimistic',
            }[pricingMode] || 'Hybrid';

        const modeDiv = document.createElement('div');
        modeDiv.style.cssText = `
        margin-bottom: 8px;
        color: #888;
        font-size: 0.85em;
    `;
        modeDiv.textContent = `Pricing Mode: ${modeLabel}`;
        topLevelContent.appendChild(modeDiv);

        const detailedBreakdownSection = uiComponents_js.createCollapsibleSection(
            '📊',
            'Per hour breakdown',
            null,
            detailsContent,
            false,
            0
        );

        topLevelContent.appendChild(detailedBreakdownSection);

        // Add X actions breakdown section (updates dynamically with input)
        const inputField = actionPanelHelper_js.findActionInput(panel);
        if (inputField) {
            const inputValue = parseInt(inputField.value) || 0;

            // Add initial X actions breakdown if input has value
            if (inputValue > 0) {
                const actionsBreakdown = buildGatheringActionsBreakdown(profitData, inputValue);
                topLevelContent.appendChild(actionsBreakdown);
            }

            // Set up input listener to update X actions breakdown dynamically
            actionPanelHelper_js.attachInputListeners(panel, inputField, (newValue) => {
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
        const profitSection = uiComponents_js.createCollapsibleSection('💰', 'Profitability', summary, topLevelContent, false, 0);
        profitSection.id = 'mwi-foraging-profit';
        profitSection.setAttribute('data-mwi-profit-display', 'true');

        // Get the summary div to update it dynamically
        const profitSummaryDiv = profitSection.querySelector('.mwi-section-header + div');

        // Set up listener to update summary with total profit when input changes
        if (inputField && profitSummaryDiv) {
            const baseSummary = formatMissingLabel(
                netMissing,
                `${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`
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
                    const totals = profitHelpers_js.calculateGatheringActionTotalsFromBase({
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
                    profitSummaryDiv.textContent = `${baseSummary} | Total profit: ${formatters_js.formatLargeNumber(totalProfit)}`;
                } else {
                    profitSummaryDiv.textContent = `${baseSummary} | Total profit: 0`;
                }
            };

            // Update summary initially
            const initialValue = parseInt(inputField.value) || 0;
            updateSummary(initialValue);

            // Attach listener for future changes
            actionPanelHelper_js.attachInputListeners(panel, inputField, updateSummary);
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
    async function displayProductionProfit(panel, actionHrid, dropTableSelector) {
        // Check global hide setting
        if (config.getSetting('actionPanel_hideActionStats')) {
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
        if (existingProfit) {
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
        const marketTax = Math.round(revenue * profitConstants_js.MARKET_TAX);
        const costs = Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour + marketTax);
        const summary = netMissing
            ? '-- ⚠'
            : `${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day | Total profit: 0`;

        const detailsContent = document.createElement('div');

        // Revenue Section
        const revenueDiv = document.createElement('div');
        const revenueLabel = revenueMissing
            ? '-- ⚠'
            : revenueEstimated
              ? `${formatters_js.formatLargeNumber(revenue)}/hr ⚠`
              : `${formatters_js.formatLargeNumber(revenue)}/hr`;
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

        // Primary Outputs subsection
        const primaryOutputContent = document.createElement('div');
        const baseOutputLine = document.createElement('div');
        baseOutputLine.style.marginLeft = '8px';
        const baseOutputMissingNote = getMissingPriceIndicator(
            profitData.outputPriceMissing || profitData.outputPriceEstimated
        );
        baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${profitData.itemsPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatters_js.formatLargeNumber(Math.round(profitData.itemsPerHour * profitData.outputPrice))}/hr`;
        primaryOutputContent.appendChild(baseOutputLine);

        if (profitData.gourmetBonusItems > 0) {
            const gourmetLine = document.createElement('div');
            gourmetLine.style.marginLeft = '8px';
            gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatters_js.formatPercentage(profitData.gourmetBonus, 1)}): ${profitData.gourmetBonusItems.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatters_js.formatLargeNumber(Math.round(profitData.gourmetBonusItems * profitData.outputPrice))}/hr`;
            primaryOutputContent.appendChild(gourmetLine);
        }

        const baseRevenue = profitData.itemsPerHour * profitData.outputPrice;
        const gourmetRevenue = profitData.gourmetBonusItems * profitData.outputPrice;
        const primaryRevenue = baseRevenue + gourmetRevenue;
        const primaryRevenueLabel = outputMissing ? '-- ⚠' : formatters_js.formatWithSeparator(Math.round(primaryRevenue));
        const gourmetLabel =
            profitData.gourmetBonus > 0 ? ` (${formatters_js.formatPercentage(profitData.gourmetBonus, 1)} gourmet)` : '';
        const primaryOutputSection = uiComponents_js.createCollapsibleSection(
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
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(revenuePerHour))}/hr`;
                essenceContent.appendChild(line);
            }

            const essenceRevenue = essenceDrops.reduce(
                (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
                0
            );
            const essenceRevenueLabel = bonusMissing ? '-- ⚠' : formatters_js.formatLargeNumber(Math.round(essenceRevenue));
            const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
            essenceSection = uiComponents_js.createCollapsibleSection(
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
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(revenuePerHour))}/hr`;
                rareFindContent.appendChild(line);
            }

            const rareFindRevenue = rareFinds.reduce(
                (sum, drop) => sum + getBonusDropPerHourTotals(drop, efficiencyMultiplier).revenuePerHour,
                0
            );
            const rareFindRevenueLabel = bonusMissing ? '-- ⚠' : formatters_js.formatLargeNumber(Math.round(rareFindRevenue));
            const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
            rareFindSection = uiComponents_js.createCollapsibleSection(
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
              ? `${formatters_js.formatLargeNumber(costs)}/hr ⚠`
              : `${formatters_js.formatLargeNumber(costs)}/hr`;
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
                    materialText += ` (${baseAmountPerHour.toFixed(1)} base -${formatters_js.formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
                }

                const missingPriceNote = getMissingPriceIndicator(material.missingPrice);
                materialText += ` @ ${formatters_js.formatWithSeparator(Math.round(material.askPrice))}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(material.totalCost * profitData.actionsPerHour * efficiencyMultiplier))}/hr`;

                line.textContent = materialText;
                materialCostsContent.appendChild(line);
            }
        }

        const materialCostsLabel = formatMissingLabel(
            materialMissing,
            formatters_js.formatLargeNumber(Math.round(profitData.materialCostPerHour))
        );
        const materialCostsSection = uiComponents_js.createCollapsibleSection(
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
                line.textContent = `• ${tea.itemName}: ${tea.drinksPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(tea.totalCost))}/hr`;
                teaCostsContent.appendChild(line);
            }
        }

        const teaCount = profitData.teaCosts?.length || 0;
        const teaCostsLabel = formatMissingLabel(teaMissing, formatters_js.formatLargeNumber(Math.round(profitData.totalTeaCostPerHour)));
        const teaCostsSection = uiComponents_js.createCollapsibleSection(
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
              ? `${formatters_js.formatLargeNumber(marketTax)}/hr ⚠`
              : `${formatters_js.formatLargeNumber(marketTax)}/hr`;
        marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
        marketTaxContent.appendChild(marketTaxLine);

        const marketTaxHeader = marketTaxLabel;
        const marketTaxSection = uiComponents_js.createCollapsibleSection(
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
            return uiComponents_js.createCollapsibleSection(null, `${title}: +${total}`, null, content, false, 1);
        };

        // Efficiency
        const effRows = [];
        if (profitData.levelEfficiency > 0) {
            effRows.push(`+${profitData.levelEfficiency}% Level advantage`);
        }
        if (profitData.houseEfficiency > 0) {
            effRows.push(`+${profitData.houseEfficiency.toFixed(1)}% House room`);
        }
        if (profitData.teaEfficiency > 0) {
            effRows.push(`+${profitData.teaEfficiency.toFixed(1)}% Tea`);
        }
        if ((profitData.equipmentEfficiencyItems || []).length > 0) {
            for (const item of profitData.equipmentEfficiencyItems) {
                const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                effRows.push(`+${item.value.toFixed(1)}% ${item.name}${enh}`);
            }
        } else if (profitData.equipmentEfficiency > 0) {
            effRows.push(`+${profitData.equipmentEfficiency.toFixed(1)}% Equipment`);
        }
        if (profitData.communityEfficiency > 0) {
            effRows.push(`+${profitData.communityEfficiency.toFixed(1)}% Community buff`);
        }
        if (profitData.achievementEfficiency > 0) {
            effRows.push(`+${profitData.achievementEfficiency.toFixed(1)}% Achievement`);
        }
        if (profitData.personalEfficiency > 0) {
            effRows.push(`+${profitData.personalEfficiency.toFixed(1)}% Seal of Efficiency`);
        }
        if (effRows.length > 0) {
            modifierSummaryParts.push(`+${profitData.totalEfficiency.toFixed(1)}% eff`);
            modifierSubSections.push(
                makeModifierSectionProd('Efficiency', `${profitData.totalEfficiency.toFixed(1)}%`, effRows)
            );
        }

        // Rare Find
        const productionRareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        const productionRareFindBreakdown = profitData.bonusRevenue?.rareFindBreakdown || {};
        if (productionRareFindBonus > 0) {
            const rareRows = [];
            for (const item of productionRareFindBreakdown.equipmentItems || []) {
                const enh = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                rareRows.push(`+${item.value.toFixed(1)}% ${item.name}${enh}`);
            }
            if (productionRareFindBreakdown.house > 0) {
                rareRows.push(`+${productionRareFindBreakdown.house.toFixed(1)}% House rooms`);
            }
            if (productionRareFindBreakdown.achievement > 0) {
                rareRows.push(`+${productionRareFindBreakdown.achievement.toFixed(1)}% Achievement`);
            }
            if (productionRareFindBreakdown.personal > 0) {
                rareRows.push(`+${productionRareFindBreakdown.personal.toFixed(1)}% Seal of Rare Find`);
            }
            modifierSummaryParts.push(`+${productionRareFindBonus.toFixed(1)}% rare`);
            modifierSubSections.push(
                makeModifierSectionProd('Rare Find', `${productionRareFindBonus.toFixed(1)}%`, rareRows)
            );
        }

        // Artisan Bonus (no sub-breakdown needed — single source)
        if (profitData.artisanBonus > 0) {
            const artisanContent = document.createElement('div');
            artisanContent.textContent = `-${formatters_js.formatPercentage(profitData.artisanBonus, 1)} material requirement from Artisan Tea`;
            modifierSummaryParts.push(`-${formatters_js.formatPercentage(profitData.artisanBonus, 1)} artisan`);
            modifierSubSections.push(
                uiComponents_js.createCollapsibleSection(
                    null,
                    `Artisan: -${formatters_js.formatPercentage(profitData.artisanBonus, 1)}`,
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
            gourmetContent.textContent = `+${formatters_js.formatPercentage(profitData.gourmetBonus, 1)} bonus items from Gourmet Tea`;
            modifierSummaryParts.push(`+${formatters_js.formatPercentage(profitData.gourmetBonus, 1)} gourmet`);
            modifierSubSections.push(
                uiComponents_js.createCollapsibleSection(
                    null,
                    `Gourmet: +${formatters_js.formatPercentage(profitData.gourmetBonus, 1)}`,
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
            const modifiersSection = uiComponents_js.createCollapsibleSection(
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
        <div style="margin-bottom: 4px;">Actions: ${effectiveActionsPerHour.toFixed(1)}/hr</div>
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
              ? `Net Profit: ${formatters_js.formatLargeNumber(profit)}/hr ⚠, ${formatters_js.formatLargeNumber(profitPerDay)}/day ⚠`
              : `Net Profit: ${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

        // Add pricing mode label
        const pricingMode = profitData.pricingMode || 'hybrid';
        const modeLabel =
            {
                conservative: 'Conservative',
                hybrid: 'Hybrid',
                optimistic: 'Optimistic',
            }[pricingMode] || 'Hybrid';

        const modeDiv = document.createElement('div');
        modeDiv.style.cssText = `
        margin-bottom: 8px;
        color: #888;
        font-size: 0.85em;
    `;
        modeDiv.textContent = `Pricing Mode: ${modeLabel}`;
        topLevelContent.appendChild(modeDiv);

        const detailedBreakdownSection = uiComponents_js.createCollapsibleSection(
            '📊',
            'Per hour breakdown',
            null,
            detailsContent,
            false,
            0
        );

        topLevelContent.appendChild(detailedBreakdownSection);

        // Add X actions breakdown section (updates dynamically with input)
        const inputField = actionPanelHelper_js.findActionInput(panel);
        if (inputField) {
            const inputValue = parseInt(inputField.value) || 0;

            // Add initial X actions breakdown if input has value
            if (inputValue > 0) {
                const actionsBreakdown = buildProductionActionsBreakdown(profitData, inputValue);
                topLevelContent.appendChild(actionsBreakdown);
            }

            // Set up input listener to update X actions breakdown dynamically
            actionPanelHelper_js.attachInputListeners(panel, inputField, (newValue) => {
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
        const profitSection = uiComponents_js.createCollapsibleSection('💰', 'Profitability', summary, topLevelContent, false, 0);
        profitSection.id = 'mwi-production-profit';
        profitSection.setAttribute('data-mwi-profit-display', 'true');
        const profitSummaryDiv = profitSection.querySelector('.mwi-section-header + div');

        // Set up listener to update summary with total profit when input changes
        if (inputField && profitSummaryDiv) {
            const baseSummary = formatMissingLabel(
                netMissing,
                `${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`
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
                    const totals = profitHelpers_js.calculateProductionActionTotalsFromBase({
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
                    profitSummaryDiv.textContent = `${baseSummary} | Total profit: ${formatters_js.formatLargeNumber(totalProfit)}`;
                } else {
                    profitSummaryDiv.textContent = `${baseSummary} | Total profit: 0`;
                }
            };

            // Update summary initially
            const initialValue = parseInt(inputField.value) || 0;
            updateSummary(initialValue);

            // Attach listener for future changes
            actionPanelHelper_js.attachInputListeners(panel, inputField, updateSummary);
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
        const totals = profitHelpers_js.calculateGatheringActionTotalsFromBase({
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
        const revenueLabel = formatMissingLabel(revenueMissing, formatters_js.formatLargeNumber(totalRevenue));
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
                line.textContent = `• ${output.name} (Base): ${totalItems.toFixed(1)} items @ ${formatters_js.formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatters_js.formatLargeNumber(Math.round(totalRevenueLine))}`;
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
                line.textContent = `• ${output.name} (Gourmet ${formatters_js.formatPercentage(profitData.gourmetBonus || 0, 1)}): ${totalItems.toFixed(1)} items @ ${formatters_js.formatWithSeparator(output.priceEach)}${missingPriceNote} each → ${formatters_js.formatLargeNumber(Math.round(totalRevenueLine))}`;
                primaryDropsContent.appendChild(line);
            }
        }

        if (profitData.processingConversions && profitData.processingConversions.length > 0) {
            const totalProcessingRevenue = totals.totalProcessingRevenue;
            const processingLabel = formatMissingLabel(
                processingMissing,
                `${totalProcessingRevenue >= 0 ? '+' : '-'}${formatters_js.formatLargeNumber(Math.abs(Math.round(totalProcessingRevenue)))}`
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
                consumedLine.textContent = `• ${conversion.rawItem} consumed: -${totalConsumed.toFixed(1)} items @ ${formatters_js.formatWithSeparator(conversion.rawPriceEach)}${missingPriceNote} → -${formatters_js.formatLargeNumber(Math.round(consumedRevenue))}`;
                processingContent.appendChild(consumedLine);

                const producedLine = document.createElement('div');
                producedLine.style.marginLeft = '8px';
                producedLine.textContent = `• ${conversion.processedItem} produced: ${totalProduced.toFixed(1)} items @ ${formatters_js.formatWithSeparator(conversion.processedPriceEach)}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(producedRevenue))}`;
                processingContent.appendChild(producedLine);
            }

            const processingSection = uiComponents_js.createCollapsibleSection(
                '',
                `• Processing (${formatters_js.formatPercentage(profitData.processingBonus || 0, 1)} proc): Net ${processingLabel}`,
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
        const primaryRevenueLabel = formatMissingLabel(primaryMissing, formatters_js.formatLargeNumber(Math.round(primaryRevenue)));
        const outputItemCount =
            (profitData.baseOutputs?.length || 0) +
            (profitData.processingConversions && profitData.processingConversions.length > 0 ? 1 : 0);
        const primaryDropsSection = uiComponents_js.createCollapsibleSection(
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
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(totalRevenue))}`;
                essenceContent.appendChild(line);
            }

            const essenceRevenue = essenceDrops.reduce((sum, drop) => {
                return sum + getBonusDropTotalsForActions(drop, actionsCount, profitData.actionsPerHour).totalRevenue;
            }, 0);
            const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatters_js.formatLargeNumber(Math.round(essenceRevenue)));
            const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
            essenceSection = uiComponents_js.createCollapsibleSection(
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
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(totalRevenue))}`;
                rareFindContent.appendChild(line);
            }

            const rareFindRevenue = rareFinds.reduce((sum, drop) => {
                return sum + getBonusDropTotalsForActions(drop, actionsCount, profitData.actionsPerHour).totalRevenue;
            }, 0);
            const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatters_js.formatLargeNumber(Math.round(rareFindRevenue)));
            const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
            rareFindSection = uiComponents_js.createCollapsibleSection(
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
        const costsLabel = costsMissing ? '-- ⚠' : formatters_js.formatLargeNumber(totalCosts);
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
                line.textContent = `• ${drink.name}: ${totalDrinks.toFixed(1)} drinks @ ${formatters_js.formatWithSeparator(drink.priceEach)}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(totalCostLine))}`;
                drinkCostsContent.appendChild(line);
            }
        }

        const drinkCount = profitData.drinkCosts?.length || 0;
        const drinkCostsLabel = drinkCostsMissing ? '-- ⚠' : formatters_js.formatLargeNumber(totalDrinkCosts);
        const drinkCostsSection = uiComponents_js.createCollapsibleSection(
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
        const marketTaxLabel = marketTaxMissing ? '-- ⚠' : formatters_js.formatLargeNumber(totalMarketTax);
        marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
        marketTaxContent.appendChild(marketTaxLine);

        const marketTaxHeader = marketTaxMissing ? '-- ⚠' : formatters_js.formatLargeNumber(totalMarketTax);
        const marketTaxSection = uiComponents_js.createCollapsibleSection(
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
        netProfitLine.textContent = netMissing ? 'Net Profit: -- ⚠' : `Net Profit: ${formatters_js.formatLargeNumber(totalProfit)}`;
        topLevelContent.appendChild(netProfitLine);

        const actionsSummary = `Revenue: ${formatMissingLabel(revenueMissing, formatters_js.formatLargeNumber(totalRevenue))} | Costs: ${formatMissingLabel(
        costsMissing,
        formatters_js.formatLargeNumber(totalCosts)
    )}`;
        const actionsBreakdownSection = uiComponents_js.createCollapsibleSection('', actionsSummary, null, detailsContent, false, 1);
        topLevelContent.appendChild(actionsBreakdownSection);

        const mainSection = uiComponents_js.createCollapsibleSection(
            '📋',
            `${formatters_js.formatWithSeparator(actionsCount)} actions breakdown`,
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
        const totals = profitHelpers_js.calculateProductionActionTotalsFromBase({
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
              ? `${formatters_js.formatLargeNumber(totalRevenue)} ⚠`
              : formatters_js.formatLargeNumber(totalRevenue);
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
        baseOutputLine.textContent = `• ${profitData.itemName} (Base): ${totalBaseItems.toFixed(1)} items @ ${formatters_js.formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatters_js.formatLargeNumber(Math.round(totalBaseRevenue))}`;
        primaryOutputContent.appendChild(baseOutputLine);

        if (profitData.gourmetBonus > 0) {
            const totalGourmetItems = totals.totalGourmetItems;
            const totalGourmetRevenue = totals.totalGourmetRevenue;
            const gourmetLine = document.createElement('div');
            gourmetLine.style.marginLeft = '8px';
            gourmetLine.textContent = `• ${profitData.itemName} (Gourmet +${formatters_js.formatPercentage(profitData.gourmetBonus, 1)}): ${totalGourmetItems.toFixed(1)} items @ ${formatters_js.formatWithSeparator(Math.round(profitData.outputPrice))}${baseOutputMissingNote} each → ${formatters_js.formatLargeNumber(Math.round(totalGourmetRevenue))}`;
            primaryOutputContent.appendChild(gourmetLine);
        }

        const primaryRevenue = totals.totalBaseRevenue + totals.totalGourmetRevenue;
        const primaryOutputLabel =
            outputMissing && !outputEstimated
                ? '-- ⚠'
                : outputEstimated
                  ? `${formatters_js.formatLargeNumber(Math.round(primaryRevenue))} ⚠`
                  : formatters_js.formatLargeNumber(Math.round(primaryRevenue));
        const gourmetLabel =
            profitData.gourmetBonus > 0 ? ` (${formatters_js.formatPercentage(profitData.gourmetBonus, 1)} gourmet)` : '';
        const primaryOutputSection = uiComponents_js.createCollapsibleSection(
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
                    drop.dropsPerAction ?? profitHelpers_js.calculateProfitPerAction(drop.dropsPerHour, profitData.actionsPerHour);
                const revenuePerAction =
                    drop.revenuePerAction ?? profitHelpers_js.calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
                const totalDrops = dropsPerAction * actionsCount;
                const totalRevenueLine = revenuePerAction * actionsCount;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(totalRevenueLine))}`;
                essenceContent.appendChild(line);
            }

            const essenceRevenue = essenceDrops.reduce((sum, drop) => {
                const revenuePerAction =
                    drop.revenuePerAction ?? profitHelpers_js.calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
                return sum + revenuePerAction * actionsCount;
            }, 0);
            const essenceRevenueLabel = formatMissingLabel(bonusMissing, formatters_js.formatLargeNumber(Math.round(essenceRevenue)));
            const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
            essenceSection = uiComponents_js.createCollapsibleSection(
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
                    drop.dropsPerAction ?? profitHelpers_js.calculateProfitPerAction(drop.dropsPerHour, profitData.actionsPerHour);
                const revenuePerAction =
                    drop.revenuePerAction ?? profitHelpers_js.calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
                const totalDrops = dropsPerAction * actionsCount;
                const totalRevenueLine = revenuePerAction * actionsCount;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                line.textContent = `• ${drop.itemName}: ${totalDrops.toFixed(2)} drops (${dropRatePct}) → ${formatters_js.formatLargeNumber(Math.round(totalRevenueLine))}`;
                rareFindContent.appendChild(line);
            }

            const rareFindRevenue = rareFinds.reduce((sum, drop) => {
                const revenuePerAction =
                    drop.revenuePerAction ?? profitHelpers_js.calculateProfitPerAction(drop.revenuePerHour, profitData.actionsPerHour);
                return sum + revenuePerAction * actionsCount;
            }, 0);
            const rareFindRevenueLabel = formatMissingLabel(bonusMissing, formatters_js.formatLargeNumber(Math.round(rareFindRevenue)));
            const rareFindSummary = formatRareFindBonusSummary(profitData.bonusRevenue);
            rareFindSection = uiComponents_js.createCollapsibleSection(
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
              ? `${formatters_js.formatLargeNumber(totalCosts)} ⚠`
              : formatters_js.formatLargeNumber(totalCosts);
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
                    materialText += ` (${baseTotalAmount.toFixed(1)} base -${formatters_js.formatPercentage(profitData.artisanBonus, 1)} 🍵)`;
                }

                const missingPriceNote = getMissingPriceIndicator(material.missingPrice);
                materialText += ` @ ${formatters_js.formatWithSeparator(Math.round(material.askPrice))}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(totalMaterialCost))}`;

                line.textContent = materialText;
                materialCostsContent.appendChild(line);
            }
        }

        const totalMaterialCost = totals.totalMaterialCost;
        const materialCostsLabel = formatMissingLabel(materialMissing, formatters_js.formatLargeNumber(Math.round(totalMaterialCost)));
        const materialCostsSection = uiComponents_js.createCollapsibleSection(
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
                line.textContent = `• ${tea.itemName}: ${totalDrinks.toFixed(1)} drinks @ ${formatters_js.formatWithSeparator(Math.round(tea.pricePerDrink))}${missingPriceNote} → ${formatters_js.formatLargeNumber(Math.round(totalTeaCost))}`;
                teaCostsContent.appendChild(line);
            }
        }

        const totalTeaCost = totals.totalTeaCost;
        const teaCount = profitData.teaCosts?.length || 0;
        const teaCostsLabel = formatMissingLabel(teaMissing, formatters_js.formatLargeNumber(Math.round(totalTeaCost)));
        const teaCostsSection = uiComponents_js.createCollapsibleSection(
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
              ? `${formatters_js.formatLargeNumber(totalMarketTax)} ⚠`
              : formatters_js.formatLargeNumber(totalMarketTax);
        marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
        marketTaxContent.appendChild(marketTaxLine);

        const marketTaxHeader = marketTaxLabel;
        const marketTaxSection = uiComponents_js.createCollapsibleSection(
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
              ? `Net Profit: ${formatters_js.formatLargeNumber(totalProfit)} ⚠`
              : `Net Profit: ${formatters_js.formatLargeNumber(totalProfit)}`;
        topLevelContent.appendChild(netProfitLine);

        const revenueDisplay = revenueMissing
            ? '-- ⚠'
            : revenueEstimated
              ? `${formatters_js.formatLargeNumber(totalRevenue)} ⚠`
              : formatters_js.formatLargeNumber(totalRevenue);
        const costsDisplay = costsMissing
            ? '-- ⚠'
            : costsEstimated
              ? `${formatters_js.formatLargeNumber(totalCosts)} ⚠`
              : formatters_js.formatLargeNumber(totalCosts);
        const actionsSummary = `Revenue: ${revenueDisplay} | Costs: ${costsDisplay}`;
        const actionsBreakdownSection = uiComponents_js.createCollapsibleSection('', actionsSummary, null, detailsContent, false, 1);
        topLevelContent.appendChild(actionsBreakdownSection);

        const mainSection = uiComponents_js.createCollapsibleSection(
            '📋',
            `${formatters_js.formatWithSeparator(actionsCount)} actions breakdown`,
            null,
            topLevelContent,
            false,
            0
        );
        mainSection.className = 'mwi-collapsible-section mwi-actions-breakdown';

        return mainSection;
    }

    /**
     * Action Panel Sort Manager
     *
     * Centralized sorting logic for action panels.
     * Handles both profit-based sorting and pin priority.
     * Used by max-produceable and gathering-stats features.
     */


    class ActionPanelSort {
        constructor() {
            this.panels = new Map(); // actionPanel → {actionHrid, profitPerHour, expPerHour}
            this.pinnedActions = new Set(); // Set of pinned action HRIDs
            this.sortMode = 'default'; // 'default' | 'profit' | 'xp' | 'coinsPerXp'
            this.sortTimeout = null; // Debounce timer
            this.initialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.handlers = {};
        }

        /**
         * Initialize - load pinned actions from storage
         */
        async initialize() {
            if (this.initialized) return;

            const pinnedData = await storage.getJSON('pinnedActions', 'settings', []);
            this.pinnedActions = new Set(pinnedData);
            this.sortMode = await storage.get('actionSortMode', 'settings', 'default');
            this.initialized = true;

            // Listen for character switch to clear character-specific data
            if (!this.handlers.characterSwitch) {
                this.handlers.characterSwitch = () => this.onCharacterSwitch();
                dataManager.on('character_switching', this.handlers.characterSwitch);
            }
        }

        /**
         * Handle character switch - clear all cached data
         */
        async onCharacterSwitch() {
            this.clearAllPanels();
            this.pinnedActions.clear();
            this.initialized = false;
        }

        /**
         * Disable - cleanup event listeners
         */
        disable() {
            this.clearAllPanels();
            if (this.handlers.characterSwitch) {
                dataManager.off('character_switching', this.handlers.characterSwitch);
                this.handlers.characterSwitch = null;
            }
            this.initialized = false;
        }

        /**
         * Register a panel for sorting
         * @param {HTMLElement} actionPanel - The action panel element
         * @param {string} actionHrid - The action HRID
         * @param {number|null} profitPerHour - Profit per hour (null if not calculated yet)
         */
        registerPanel(actionPanel, actionHrid, profitPerHour = null) {
            this.panels.set(actionPanel, {
                actionHrid: actionHrid,
                profitPerHour: profitPerHour,
                expPerHour: null,
            });
        }

        /**
         * Update profit for a registered panel
         * @param {HTMLElement} actionPanel - The action panel element
         * @param {number|null} profitPerHour - Profit per hour
         */
        updateProfit(actionPanel, profitPerHour) {
            const data = this.panels.get(actionPanel);
            if (data) {
                data.profitPerHour = profitPerHour;
            }
        }

        /**
         * Update exp/hr for a registered panel
         * @param {HTMLElement} actionPanel - The action panel element
         * @param {number|null} expPerHour - Experience per hour
         */
        updateExpPerHour(actionPanel, expPerHour) {
            const data = this.panels.get(actionPanel);
            if (data) {
                data.expPerHour = expPerHour;
            }
        }

        /**
         * Set the active sort mode
         * @param {'default'|'profit'|'xp'|'coinsPerXp'} mode
         */
        setSortMode(mode) {
            this.sortMode = mode;
            storage.set('actionSortMode', mode, 'settings');
        }

        /**
         * Get the active sort mode
         * @returns {'default'|'profit'|'xp'|'coinsPerXp'}
         */
        getSortMode() {
            return this.sortMode;
        }

        /**
         * Unregister a panel (cleanup when panel removed from DOM)
         * @param {HTMLElement} actionPanel - The action panel element
         */
        unregisterPanel(actionPanel) {
            this.panels.delete(actionPanel);
        }

        /**
         * Toggle pin state for an action
         * @param {string} actionHrid - Action HRID to toggle
         * @returns {boolean} New pin state
         */
        async togglePin(actionHrid) {
            if (this.pinnedActions.has(actionHrid)) {
                this.pinnedActions.delete(actionHrid);
            } else {
                this.pinnedActions.add(actionHrid);
            }

            // Save to storage
            await storage.setJSON('pinnedActions', Array.from(this.pinnedActions), 'settings', true);

            return this.pinnedActions.has(actionHrid);
        }

        /**
         * Check if action is pinned
         * @param {string} actionHrid - Action HRID
         * @returns {boolean}
         */
        isPinned(actionHrid) {
            return this.pinnedActions.has(actionHrid);
        }

        /**
         * Get all pinned actions
         * @returns {Set<string>}
         */
        getPinnedActions() {
            return this.pinnedActions;
        }

        /**
         * Clear all panel references (called during character switch to prevent memory leaks)
         */
        clearAllPanels() {
            // Clear sort timeout
            if (this.sortTimeout) {
                clearTimeout(this.sortTimeout);
                this.sortTimeout = null;
            }

            this.timerRegistry.clearAll();

            // Clear all panel references
            this.panels.clear();
        }

        /**
         * Trigger a debounced sort
         */
        triggerSort() {
            this.scheduleSortIfEnabled();
        }

        /**
         * Schedule a sort to run after a short delay (debounced)
         */
        scheduleSortIfEnabled() {
            const hasPinnedActions = this.pinnedActions.size > 0;

            // Only sort if a sort mode is active OR there are pinned actions
            if (this.sortMode === 'default' && !hasPinnedActions) {
                return;
            }

            // Clear existing timeout
            if (this.sortTimeout) {
                clearTimeout(this.sortTimeout);
            }

            // Schedule new sort after 300ms of inactivity (reduced from 500ms)
            this.sortTimeout = setTimeout(() => {
                this.sortPanelsByProfit();
                this.sortTimeout = null;
            }, 300);
            this.timerRegistry.registerTimeout(this.sortTimeout);
        }

        /**
         * Sort action panels by the active sort mode, with pinned actions at top
         */
        sortPanelsByProfit() {
            const sortMode = this.sortMode;

            // Group panels by their parent container
            const containerMap = new Map();

            // Clean up stale panels and group by container
            for (const [actionPanel, data] of this.panels.entries()) {
                const container = actionPanel.parentElement;

                // If no parent, panel is detached - clean it up
                if (!container) {
                    this.panels.delete(actionPanel);
                    continue;
                }

                if (!containerMap.has(container)) {
                    containerMap.set(container, []);
                }

                const isPinned = this.pinnedActions.has(data.actionHrid);

                containerMap.get(container).push({
                    panel: actionPanel,
                    profit: data.profitPerHour ?? null,
                    exp: data.expPerHour ?? null,
                    pinned: isPinned,
                    originalIndex: containerMap.get(container).length,
                    actionHrid: data.actionHrid,
                });
            }

            // Dismiss any open tooltips before reordering (prevents stuck tooltips)
            // Only dismiss if a tooltip exists and its trigger is not hovered
            const openTooltip = document.querySelector('.MuiTooltip-popper');
            if (openTooltip) {
                const trigger = document.querySelector(`[aria-describedby="${openTooltip.id}"]`);
                if (!trigger || !trigger.matches(':hover')) {
                    dom_js.dismissTooltips();
                }
            }

            // Sort and reorder each container
            for (const [container, panels] of containerMap.entries()) {
                panels.sort((a, b) => {
                    // Pinned actions always come first
                    if (a.pinned && !b.pinned) return -1;
                    if (!a.pinned && b.pinned) return 1;

                    // Both same pin state — apply active sort mode
                    return this._compareByMode(a, b, sortMode);
                });

                // Reorder DOM elements using DocumentFragment to batch reflows
                // This prevents 50 individual reflows (one per appendChild)
                const fragment = document.createDocumentFragment();
                panels.forEach(({ panel }) => {
                    fragment.appendChild(panel);
                });
                container.appendChild(fragment);
            }
        }

        /**
         * Compare two panel entries by the active sort mode
         * @private
         */
        _compareByMode(a, b, sortMode) {
            if (sortMode === 'profit') {
                if (a.profit === null && b.profit === null) return 0;
                if (a.profit === null) return 1;
                if (b.profit === null) return -1;
                return b.profit - a.profit;
            }

            if (sortMode === 'xp') {
                if (a.exp === null && b.exp === null) return 0;
                if (a.exp === null) return 1;
                if (b.exp === null) return -1;
                return b.exp - a.exp;
            }

            if (sortMode === 'coinsPerXp') {
                const aRatio = a.profit !== null && a.exp ? a.profit / a.exp : null;
                const bRatio = b.profit !== null && b.exp ? b.profit / b.exp : null;
                if (aRatio === null && bRatio === null) return 0;
                if (aRatio === null) return 1;
                if (bRatio === null) return -1;
                return bRatio - aRatio;
            }

            // 'default' — sort ascending by required level, falling back to insertion order
            const aLevel = dataManager.getActionDetails(a.actionHrid)?.levelRequirement?.level ?? null;
            const bLevel = dataManager.getActionDetails(b.actionHrid)?.levelRequirement?.level ?? null;
            if (aLevel === null && bLevel === null) return a.originalIndex - b.originalIndex;
            if (aLevel === null) return 1;
            if (bLevel === null) return -1;
            if (aLevel !== bLevel) return aLevel - bLevel;
            return a.originalIndex - b.originalIndex;
        }
    }

    const actionPanelSort = new ActionPanelSort();

    /**
     * Action Filter Manager
     *
     * Adds a search/filter input box to action panel pages (gathering/production).
     * Filters action panels in real-time based on action name.
     * Works alongside existing sorting and hide negative profit features.
     */


    class ActionFilter {
        constructor() {
            this.panels = new Map(); // actionPanel → {actionName, container}
            this.filterValue = ''; // Current filter text
            this.filterInput = null; // Reference to the input element
            this.sortButton = null; // Reference to the sort toggle button
            this.noResultsMessage = null; // Reference to "No matching actions" message
            this.initialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.filterTimeout = null;
            this.unregisterHandlers = [];
            this.currentTitleElement = null; // Track which title we're attached to
        }

        /**
         * Initialize - set up DOM observers
         */
        async initialize() {
            if (this.initialized) return;

            // Observe for skill page title bars
            const unregisterTitleObserver = domObserver.onClass(
                'ActionFilter-Title',
                'GatheringProductionSkillPanel_title__3VihQ',
                (titleElement) => {
                    this.injectFilterInput(titleElement);
                }
            );

            this.unregisterHandlers.push(unregisterTitleObserver);
            this.initialized = true;
        }

        /**
         * Inject filter input into the title bar
         * @param {HTMLElement} titleElement - The h1 title element
         */
        injectFilterInput(titleElement) {
            // If this is a different title than we're currently attached to, clean up the old one first
            if (this.currentTitleElement && this.currentTitleElement !== titleElement) {
                this.clearFilter();
            }

            // Check if we already injected into THIS specific title
            if (titleElement.querySelector('#mwi-action-filter')) {
                return;
            }

            // Track the new title element
            this.currentTitleElement = titleElement;

            // Reset filter state for new page
            this.filterValue = '';
            this.panels.clear();
            this.filterInput = null;
            this.sortButton = null;
            this.noResultsMessage = null;

            // The h1 has display: block from game CSS, need to override it
            titleElement.style.setProperty('display', 'flex', 'important');
            titleElement.style.alignItems = 'center';
            titleElement.style.gap = '15px';
            titleElement.style.flexWrap = 'wrap';

            // Create input element (match game's input style)
            const input = document.createElement('input');
            input.id = 'mwi-action-filter';
            input.type = 'text';
            input.placeholder = 'Filter actions...';
            input.className = 'MuiInputBase-input'; // Use game's input class
            input.style.padding = '8px 12px';
            input.style.fontSize = '14px';
            input.style.border = '1px solid rgba(255, 255, 255, 0.23)';
            input.style.borderRadius = '4px';
            input.style.backgroundColor = 'transparent';
            input.style.color = 'inherit';
            input.style.width = '200px';
            input.style.fontFamily = 'inherit';
            input.style.flexShrink = '0'; // Don't shrink the input

            // Add focus styles
            input.addEventListener('focus', () => {
                input.style.borderColor = config.COLOR_ACCENT;
                input.style.outline = 'none';
            });

            input.addEventListener('blur', () => {
                input.style.borderColor = 'rgba(255, 255, 255, 0.23)';
            });

            // Add input listener with debouncing
            input.addEventListener('input', (e) => {
                this.handleFilterInput(e.target.value);
            });

            // Insert at the beginning of the title element (before the skill name div)
            titleElement.insertBefore(input, titleElement.firstChild);

            // Store reference
            this.filterInput = input;

            // Create sort toggle button
            const SORT_MODES = ['default', 'profit', 'xp', 'coinsPerXp'];
            const SORT_LABELS = {
                default: 'Sort: Default',
                profit: 'Sort: Profit',
                xp: 'Sort: XP',
                coinsPerXp: 'Sort: Coins/XP',
            };
            const sortBtn = document.createElement('button');
            sortBtn.id = 'mwi-action-sort-toggle';
            const updateSortBtn = () => {
                const mode = actionPanelSort.getSortMode();
                sortBtn.textContent = SORT_LABELS[mode] || 'Sort: Default';
                const isActive = mode !== 'default';
                sortBtn.style.borderColor = isActive ? config.COLOR_ACCENT : 'rgba(255, 255, 255, 0.23)';
                sortBtn.style.color = isActive ? config.COLOR_ACCENT : 'inherit';
            };
            sortBtn.style.cssText = `
            padding: 8px 12px;
            font-size: 14px;
            border: 1px solid rgba(255, 255, 255, 0.23);
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            font-family: inherit;
            flex-shrink: 0;
        `;
            updateSortBtn();
            sortBtn.addEventListener('click', () => {
                const current = actionPanelSort.getSortMode();
                const nextIndex = (SORT_MODES.indexOf(current) + 1) % SORT_MODES.length;
                actionPanelSort.setSortMode(SORT_MODES[nextIndex]);
                updateSortBtn();
                actionPanelSort.sortPanelsByProfit();
            });
            input.insertAdjacentElement('afterend', sortBtn);
            this.sortButton = sortBtn;

            // Find the container for action panels to inject "No results" message
            this.setupNoResultsMessage(titleElement);
        }

        /**
         * Set up "No matching actions" message container
         * @param {HTMLElement} titleElement - The h1 title element
         */
        setupNoResultsMessage(titleElement) {
            // Walk up the DOM to find the skill panel container
            let container = titleElement.parentElement;
            let depth = 0;
            const maxDepth = 3;

            while (container && depth < maxDepth) {
                // Look for the container that holds action panels
                const actionPanels = container.querySelectorAll('.SkillActionDetail_regularComponent__3oCgr');
                if (actionPanels.length > 0) {
                    // Found the container, create message element
                    const message = document.createElement('div');
                    message.id = 'mwi-action-filter-no-results';
                    message.style.display = 'none';
                    message.style.textAlign = 'center';
                    message.style.padding = '40px 20px';
                    message.style.color = 'rgba(255, 255, 255, 0.6)';
                    message.style.fontSize = '16px';
                    message.textContent = 'No matching actions';

                    // Insert after the title
                    titleElement.parentElement.insertBefore(message, titleElement.nextSibling);
                    this.noResultsMessage = message;
                    break;
                }

                container = container.parentElement;
                depth++;
            }
        }

        /**
         * Handle filter input with debouncing
         * @param {string} value - Filter text
         */
        handleFilterInput(value) {
            // Clear existing timeout
            if (this.filterTimeout) {
                clearTimeout(this.filterTimeout);
            }

            // Schedule filter update after 300ms of inactivity
            this.filterTimeout = setTimeout(() => {
                this.filterValue = value.toLowerCase().trim();
                this.applyFilter();
                this.filterTimeout = null;
            }, 300);

            this.timerRegistry.registerTimeout(this.filterTimeout);
        }

        /**
         * Register a panel for filtering
         * @param {HTMLElement} actionPanel - The action panel element
         * @param {string} actionName - The action/item name
         */
        registerPanel(actionPanel, actionName) {
            // Store the container for later "no results" check
            const container = actionPanel.parentElement;

            this.panels.set(actionPanel, {
                actionName: actionName.toLowerCase(),
                container: container,
            });

            // Apply current filter if one is active
            if (this.filterValue) {
                this.applyFilterToPanel(actionPanel);
            }
        }

        /**
         * Unregister a panel (cleanup when panel removed from DOM)
         * @param {HTMLElement} actionPanel - The action panel element
         */
        unregisterPanel(actionPanel) {
            this.panels.delete(actionPanel);
        }

        /**
         * Apply filter to a specific panel
         * @param {HTMLElement} actionPanel - The action panel element
         */
        applyFilterToPanel(actionPanel) {
            const data = this.panels.get(actionPanel);
            if (!data) return;

            // If no filter, show the panel
            if (!this.filterValue) {
                actionPanel.dataset.mwiFilterHidden = 'false';
                return;
            }

            // Check if action name matches filter
            const matches = data.actionName.includes(this.filterValue);

            // Mark panel as hidden by filter (but don't actually hide it here)
            // The actual hiding is done in applyFilter() to respect other hiding mechanisms
            actionPanel.dataset.mwiFilterHidden = matches ? 'false' : 'true';
        }

        /**
         * Apply filter to all registered panels
         */
        applyFilter() {
            let totalPanels = 0;
            let visiblePanels = 0;
            const containerMap = new Map(); // Track panels per container

            // Apply filter to each panel
            for (const [actionPanel, data] of this.panels.entries()) {
                // Clean up detached panels
                if (!actionPanel.parentElement) {
                    this.panels.delete(actionPanel);
                    continue;
                }

                totalPanels++;

                // Track container
                if (!containerMap.has(data.container)) {
                    containerMap.set(data.container, { total: 0, visible: 0 });
                }
                const containerStats = containerMap.get(data.container);
                containerStats.total++;

                // Apply filter
                this.applyFilterToPanel(actionPanel);

                // Check if panel should be visible
                const isFilterHidden = actionPanel.dataset.mwiFilterHidden === 'true';

                if (!isFilterHidden) {
                    visiblePanels++;
                    containerStats.visible++;
                }
            }

            // Show/hide "No matching actions" message
            if (this.noResultsMessage) {
                if (this.filterValue && visiblePanels === 0 && totalPanels > 0) {
                    this.noResultsMessage.style.display = 'block';
                } else {
                    this.noResultsMessage.style.display = 'none';
                }
            }
        }

        /**
         * Check if a panel is hidden by the filter
         * @param {HTMLElement} actionPanel - The action panel element
         * @returns {boolean} True if panel is hidden by filter
         */
        isFilterHidden(actionPanel) {
            return actionPanel.dataset.mwiFilterHidden === 'true';
        }

        /**
         * Clear filter and reset state
         */
        clearFilter() {
            // Clear input value
            if (this.filterInput) {
                this.filterInput.value = '';
            }

            // Reset filter value
            this.filterValue = '';

            // Clear all panel filter states
            for (const actionPanel of this.panels.keys()) {
                actionPanel.dataset.mwiFilterHidden = 'false';
            }

            // Hide "No results" message
            if (this.noResultsMessage) {
                this.noResultsMessage.style.display = 'none';
            }

            // Clear panels registry
            this.panels.clear();

            // Remove injected input
            if (this.filterInput && this.filterInput.parentElement) {
                this.filterInput.remove();
                this.filterInput = null;
            }

            if (this.sortButton && this.sortButton.parentElement) {
                this.sortButton.remove();
                this.sortButton = null;
            }

            if (this.noResultsMessage && this.noResultsMessage.parentElement) {
                this.noResultsMessage.remove();
                this.noResultsMessage = null;
            }
        }

        /**
         * Get the current skill name from the tracked title element
         * @returns {string|null} Skill name (e.g., "Foraging", "Woodcutting", "Cooking") or null
         */
        getCurrentSkillName() {
            if (!this.currentTitleElement) {
                return null;
            }

            // The title element contains multiple children:
            // - Our injected filter input
            // - A div with the skill name text
            // Find the div that contains the skill name (not our input)
            for (const child of this.currentTitleElement.children) {
                if (child.id === 'mwi-action-filter') continue;
                if (child.tagName === 'DIV' && child.textContent) {
                    return child.textContent.trim();
                }
            }

            // Fallback: try to get text content minus input value
            const text = this.currentTitleElement.textContent.trim();
            if (this.filterInput && this.filterInput.value) {
                return text.replace(this.filterInput.value, '').trim();
            }

            return text || null;
        }

        /**
         * Cleanup function for disabling filter
         */
        cleanup() {
            // Clear timeout
            if (this.filterTimeout) {
                clearTimeout(this.filterTimeout);
                this.filterTimeout = null;
            }

            this.timerRegistry.clearAll();

            // Unregister observers
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            // Clear filter
            this.clearFilter();

            this.initialized = false;
        }
    }

    const actionFilter = new ActionFilter();

    /**
     * Action Panel Observer
     *
     * Detects when action panels appear and enhances them with:
     * - Gathering profit calculations (Foraging, Woodcutting, Milking)
     * - Production profit calculations (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     * - Other action panel enhancements (future)
     *
     * Automatically filters out combat action panels.
     */


    /**
     * Action types for gathering skills (3 skills)
     */
    const GATHERING_TYPES$2 = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

    /**
     * Action types for production skills (5 skills)
     */
    const PRODUCTION_TYPES$3 = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * Debounced update tracker for enhancement calculations
     * Maps itemHrid to timeout ID
     */
    const updateTimeouts = new Map();
    const timerRegistry$1 = timerRegistry_js.createTimerRegistry();

    /**
     * Event handler debounce timers
     */
    let itemsUpdatedDebounceTimer = null;
    let consumablesUpdatedDebounceTimer = null;
    const DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
    const observedEnhancingPanels = new WeakSet();
    let itemsUpdatedHandler = null;
    let consumablesUpdatedHandler = null;

    /**
     * Trigger debounced enhancement stats update
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {string} itemHrid - Item HRID
     */
    function triggerEnhancementUpdate(panel, itemHrid) {
        // Clear existing timeout for this item
        if (updateTimeouts.has(itemHrid)) {
            clearTimeout(updateTimeouts.get(itemHrid));
        }

        // Set new timeout
        const timeoutId = setTimeout(async () => {
            await displayEnhancementStats(panel, itemHrid);
            updateTimeouts.delete(itemHrid);
        }, 500); // Wait 500ms after last change

        timerRegistry$1.registerTimeout(timeoutId);

        updateTimeouts.set(itemHrid, timeoutId);
    }

    /**
     * CSS selectors for action panel detection
     */
    const SELECTORS = {
        REGULAR_PANEL: 'div.SkillActionDetail_regularComponent__3oCgr',
        ENHANCING_PANEL: 'div.SkillActionDetail_enhancingComponent__17bOx',
        EXP_GAIN: 'div.SkillActionDetail_expGain__F5xHu',
        ACTION_NAME: 'div.SkillActionDetail_name__3erHV',
        DROP_TABLE: 'div.SkillActionDetail_dropTable__3ViVp',
        ENHANCING_OUTPUT: 'div.SkillActionDetail_enhancingOutput__VPHbY', // Outputs container
        ITEM_NAME: 'div.Item_name__2C42x', // Item name (without +1)
    };

    /**
     * Initialize action panel observer
     * Sets up MutationObserver on document.body to watch for action panels
     */
    function initActionPanelObserver() {
        setupMutationObserver();

        // Check for existing enhancing panel (may already be on page)
        checkExistingEnhancingPanel();

        // Listen for equipment and consumable changes to refresh enhancement calculator
        setupEnhancementRefreshListeners();

        // Initialize action filter
        actionFilter.initialize();
    }

    /**
     * Set up MutationObserver to detect action panels
     */
    function setupMutationObserver() {
        domObserver.onClass(
            'ActionPanelObserver-Modal',
            'Modal_modalContainer__3B80m',
            (modal) => {
                const panel = modal.querySelector(SELECTORS.REGULAR_PANEL);
                if (panel) {
                    handleActionPanel(panel);
                }
            }
        );

        domObserver.onClass(
            'ActionPanelObserver-Enhancing',
            'SkillActionDetail_enhancingComponent__17bOx',
            (panel) => {
                handleEnhancingPanel(panel);
                registerEnhancingPanelWatcher(panel);
            }
        );

        // NEW: Observe for skill action grid tiles (the clickable action tiles on gathering/production pages)
        domObserver.onClass(
            'ActionPanelObserver-SkillAction',
            'SkillAction_skillAction__1esCp',
            (actionTile) => {
                handleSkillActionTile(actionTile);
            }
        );
    }

    /**
     * Set up listeners for equipment and consumable changes
     * Refreshes enhancement calculator when gear or teas change
     */
    function setupEnhancementRefreshListeners() {
        // Listen for equipment changes (equipping/unequipping items) with debouncing
        if (!itemsUpdatedHandler) {
            itemsUpdatedHandler = () => {
                clearTimeout(itemsUpdatedDebounceTimer);
                itemsUpdatedDebounceTimer = setTimeout(() => {
                    refreshEnhancementCalculator();
                }, DEBOUNCE_DELAY);
            };
            dataManager.on('items_updated', itemsUpdatedHandler);
        }

        // Listen for consumable changes (drinking teas) with debouncing
        if (!consumablesUpdatedHandler) {
            consumablesUpdatedHandler = () => {
                clearTimeout(consumablesUpdatedDebounceTimer);
                consumablesUpdatedDebounceTimer = setTimeout(() => {
                    refreshEnhancementCalculator();
                }, DEBOUNCE_DELAY);
            };
            dataManager.on('consumables_updated', consumablesUpdatedHandler);
        }
    }

    /**
     * Refresh enhancement calculator if panel is currently visible
     */
    function refreshEnhancementCalculator() {
        const panel = document.querySelector(SELECTORS.ENHANCING_PANEL);
        if (!panel) return; // Not on enhancing panel, skip

        const itemHrid = panel.dataset.mwiItemHrid;
        if (!itemHrid) return; // No item detected yet, skip

        // Trigger debounced update
        triggerEnhancementUpdate(panel, itemHrid);
    }

    /**
     * Check for existing enhancing panel on page load
     * The enhancing panel may already exist when MWI Tools initializes
     */
    function checkExistingEnhancingPanel() {
        // Wait a moment for page to settle
        const checkTimeout = setTimeout(() => {
            const existingPanel = document.querySelector(SELECTORS.ENHANCING_PANEL);
            if (existingPanel) {
                handleEnhancingPanel(existingPanel);
                registerEnhancingPanelWatcher(existingPanel);
            }
        }, 500);
        timerRegistry$1.registerTimeout(checkTimeout);
    }

    /**
     * Register a mutation watcher for enhancing panels
     * @param {HTMLElement} panel - Enhancing panel element
     */
    function registerEnhancingPanelWatcher(panel) {
        if (!panel || observedEnhancingPanels.has(panel)) {
            return;
        }

        domObserverHelpers_js.createMutationWatcher(
            panel,
            (mutations) => {
                handleEnhancingPanelMutations(panel, mutations);
            },
            {
                childList: true,
                subtree: true,
                attributes: true,
                attributeOldValue: true,
            }
        );

        observedEnhancingPanels.add(panel);
    }

    /**
     * Handle mutations within an enhancing panel
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {MutationRecord[]} mutations - Mutation records
     */
    function handleEnhancingPanelMutations(panel, mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                if (mutation.attributeName === 'value' && mutation.target.tagName === 'INPUT') {
                    const itemHrid = panel.dataset.mwiItemHrid;
                    if (itemHrid) {
                        triggerEnhancementUpdate(panel, itemHrid);
                    }
                }

                if (mutation.attributeName === 'href' && mutation.target.tagName === 'use') {
                    handleEnhancingPanel(panel);
                }
            }

            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((addedNode) => {
                    if (addedNode.nodeType !== Node.ELEMENT_NODE) return;

                    if (
                        addedNode.classList?.contains('SkillActionDetail_enhancingOutput__VPHbY') ||
                        (addedNode.querySelector && addedNode.querySelector(SELECTORS.ENHANCING_OUTPUT))
                    ) {
                        handleEnhancingPanel(panel);
                    }

                    if (
                        addedNode.classList?.contains('SkillActionDetail_item__2vEAz') ||
                        addedNode.classList?.contains('Item_name__2C42x')
                    ) {
                        handleEnhancingPanel(panel);
                    }

                    if (addedNode.tagName === 'INPUT' && (addedNode.type === 'number' || addedNode.type === 'text')) {
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid) {
                            addInputListener(addedNode, panel, itemHrid);
                        }
                    }
                });
            }
        }
    }

    /**
     * Handle skill action tile appearance (the clickable tiles on gathering/production pages)
     * @param {HTMLElement} actionTile - Skill action tile element
     */
    function handleSkillActionTile(actionTile) {
        if (!actionTile) return;

        // Get action name from the tile
        const nameElement = actionTile.querySelector('[class*="name"]');
        if (!nameElement) {
            return;
        }

        const actionName = nameElement.textContent.trim();

        if (!actionName) {
            return;
        }

        // Register tile with action filter
        actionFilter.registerPanel(actionTile, actionName);
    }

    /**
     * Handle action panel appearance (gathering/crafting/production)
     * @param {HTMLElement} panel - Action panel element
     */
    async function handleActionPanel(panel) {
        if (!panel) return;

        // Filter out combat action panels (they don't have XP gain display)
        const expGainElement = panel.querySelector(SELECTORS.EXP_GAIN);
        if (!expGainElement) {
            return; // Combat panel, skip
        }

        // Get action name
        const actionNameElement = panel.querySelector(SELECTORS.ACTION_NAME);
        if (!actionNameElement) {
            return;
        }

        const actionName = dom_js.getOriginalText(actionNameElement);

        const actionHrid = getActionHridFromName$1(actionName);
        if (!actionHrid) {
            return;
        }

        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];
        if (!actionDetail) {
            return;
        }

        // Check if this is a gathering action
        if (GATHERING_TYPES$2.includes(actionDetail.type)) {
            const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
            if (dropTableElement) {
                await displayGatheringProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
            }
        }

        // Check if this is a production action
        if (PRODUCTION_TYPES$3.includes(actionDetail.type)) {
            const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
            if (dropTableElement) {
                await displayProductionProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
            }
        }
    }

    /**
     * Find and cache the Current Action tab button
     * @param {HTMLElement} panel - Enhancing panel element
     * @returns {HTMLButtonElement|null} Current Action tab button or null
     */
    function getCurrentActionTabButton(panel) {
        // Check if we already cached it
        if (panel._cachedCurrentActionTab) {
            return panel._cachedCurrentActionTab;
        }

        // Walk up the DOM to find tab buttons (only once)
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
     * Check if we're on the "Enhance" tab (not "Current Action" tab)
     * @param {HTMLElement} panel - Enhancing panel element
     * @returns {boolean} True if on Enhance tab
     */
    function isEnhanceTabActive(panel) {
        // Get cached tab button (DOM query happens only once per panel)
        const currentActionTab = getCurrentActionTabButton(panel);

        if (!currentActionTab) {
            // No Current Action tab found, show calculator
            return true;
        }

        // Fast checks: just 3 property accesses (no DOM queries)
        if (currentActionTab.getAttribute('aria-selected') === 'true') {
            return false; // Current Action is active
        }

        if (currentActionTab.classList.contains('Mui-selected')) {
            return false;
        }

        if (currentActionTab.getAttribute('tabindex') === '0') {
            return false;
        }

        // Enhance tab is active
        return true;
    }

    /**
     * Handle enhancing panel appearance
     * @param {HTMLElement} panel - Enhancing panel element
     */
    async function handleEnhancingPanel(panel) {
        if (!panel) return;

        // Set up tab click listeners (only once per panel)
        if (!panel.dataset.mwiTabListenersAdded) {
            setupTabClickListeners(panel);
            panel.dataset.mwiTabListenersAdded = 'true';
        }

        // Only show calculator on "Enhance" tab, not "Current Action" tab
        if (!isEnhanceTabActive(panel)) {
            // Remove calculator if it exists
            const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
            if (existingDisplay) {
                existingDisplay.remove();
            }
            return;
        }

        // Find the output element that shows the enhanced item
        const outputsSection = panel.querySelector(SELECTORS.ENHANCING_OUTPUT);
        if (!outputsSection) {
            return;
        }

        // Check if there's actually an item selected (not just placeholder)
        // When no item is selected, the outputs section exists but has no item icon
        const itemIcon = outputsSection.querySelector('svg[role="img"], img');
        if (!itemIcon) {
            // No item icon = no item selected, don't show calculator
            // Remove existing calculator display if present
            const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
            if (existingDisplay) {
                existingDisplay.remove();
            }
            return;
        }

        // Get the item name from the Item_name element (without +1)
        const itemNameElement = outputsSection.querySelector(SELECTORS.ITEM_NAME);
        if (!itemNameElement) {
            return;
        }

        const itemName = itemNameElement.textContent.trim();

        if (!itemName) {
            return;
        }

        // Find the item HRID from the name
        const gameData = dataManager.getInitClientData();
        const itemHrid = getItemHridFromName(itemName, gameData);

        if (!itemHrid) {
            return;
        }

        // Get item details
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) return;

        // Store itemHrid on panel for later reference (when new inputs are added)
        panel.dataset.mwiItemHrid = itemHrid;

        // Double-check tab state right before rendering (safety check for race conditions)
        if (!isEnhanceTabActive(panel)) {
            // Current Action tab became active during processing, don't render
            return;
        }

        // Display enhancement stats using the item HRID directly
        await displayEnhancementStats(panel, itemHrid);

        // Set up observers for Target Level and Protect From Level inputs
        setupInputObservers(panel, itemHrid);
    }

    /**
     * Set up click listeners on tab buttons to show/hide calculator
     * @param {HTMLElement} panel - Enhancing panel element
     */
    function setupTabClickListeners(panel) {
        // Walk up the DOM to find tab buttons
        let current = panel;
        let depth = 0;
        const maxDepth = 5;

        let tabButtons = [];

        while (current && depth < maxDepth) {
            const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
            const foundTabs = buttons.filter((btn) => {
                const text = btn.textContent.trim();
                return text === 'Enhance' || text === 'Current Action';
            });

            if (foundTabs.length === 2) {
                tabButtons = foundTabs;
                break;
            }

            current = current.parentElement;
            depth++;
        }

        if (tabButtons.length !== 2) {
            return; // Can't find tabs, skip listener setup
        }

        // Add click listeners to both tabs
        tabButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                // Small delay to let the tab change take effect
                const tabTimeout = setTimeout(async () => {
                    const isEnhanceActive = isEnhanceTabActive(panel);
                    const existingDisplay = panel.querySelector('#mwi-enhancement-stats');

                    if (!isEnhanceActive) {
                        // Current Action tab clicked - remove calculator
                        if (existingDisplay) {
                            existingDisplay.remove();
                        }
                    } else {
                        // Enhance tab clicked - show calculator if item is selected
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid && !existingDisplay) {
                            // Re-render calculator
                            await displayEnhancementStats(panel, itemHrid);
                        }
                    }
                }, 100);
                timerRegistry$1.registerTimeout(tabTimeout);
            });
        });
    }

    /**
     * Add input listener to a single input element
     * @param {HTMLInputElement} input - Input element
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {string} itemHrid - Item HRID
     */
    function addInputListener(input, panel, itemHrid) {
        // Handler that triggers the shared debounced update
        const handleInputChange = () => {
            triggerEnhancementUpdate(panel, itemHrid);
        };

        // Add change listeners
        input.addEventListener('input', handleInputChange);
        input.addEventListener('change', handleInputChange);
    }

    /**
     * Set up observers for Target Level and Protect From Level inputs
     * Re-calculates enhancement stats when user changes these values
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {string} itemHrid - Item HRID
     */
    function setupInputObservers(panel, itemHrid) {
        // Find all input elements in the panel
        const inputs = panel.querySelectorAll('input[type="number"], input[type="text"]');

        // Add listeners to all existing inputs
        inputs.forEach((input) => {
            addInputListener(input, panel, itemHrid);
        });
    }

    /**
     * Convert action name to HRID
     * @param {string} actionName - Display name of action
     * @returns {string|null} Action HRID or null if not found
     */
    function getActionHridFromName$1(actionName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.actionDetailMap) {
            return null;
        }

        // Search for action by name
        for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
            if (detail.name === actionName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Convert item name to HRID
     * @param {string} itemName - Display name of item
     * @param {Object} gameData - Game data from dataManager
     * @returns {string|null} Item HRID or null if not found
     */
    function getItemHridFromName(itemName, gameData) {
        if (!gameData?.itemDetailMap) {
            return null;
        }

        // Search for item by name
        for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
            if (detail.name === itemName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Action Time Display Module
     *
     * Displays estimated completion time for queued actions.
     * Uses WebSocket data from data-manager instead of DOM scraping.
     *
     * Features:
     * - Appends stats to game's action name (queue count, time/action, actions/hr)
     * - Shows time estimates below (total time → completion time)
     * - Updates automatically on action changes
     * - Queue tooltip enhancement (time for each action + total)
     */


    /**
     * ActionTimeDisplay class manages the time display panel and queue tooltips
     */
    class ActionTimeDisplay {
        constructor() {
            this.displayElement = null;
            this.isInitialized = false;
            this.updateTimer = null;
            this.unregisterQueueObserver = null;
            this.actionNameObserver = null;
            this.queueMenuObserver = null; // Observer for queue menu mutations
            this.unregisterActionNameObserver = null;
            this.characterInitHandler = null; // Handler for character switch
            this.activeProfitCalculationId = null; // Track active profit calculation to prevent race conditions
            this.waitForPanelTimeout = null;
            this.retryUpdateTimeout = null;
            this.cleanupRegistry = cleanupRegistry_js.createCleanupRegistry();
        }

        /**
         * Initialize the action time display
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            const displayMode = config.getSettingValue('totalActionTime', 'full');
            if (!displayMode || displayMode === 'off') {
                return;
            }

            // Set up setting change listener to update display mode in real-time
            config.onSettingChange('totalActionTime', (newMode) => {
                if (!newMode || newMode === 'off') {
                    this.disable();
                    return;
                }
                // Re-trigger display update with new mode
                this.updateDisplay();
            });

            // Set up handler for character switching
            if (!this.characterInitHandler) {
                this.characterInitHandler = () => {
                    this.handleCharacterSwitch();
                };
                dataManager.on('character_initialized', this.characterInitHandler);
                this.cleanupRegistry.registerCleanup(() => {
                    if (this.characterInitHandler) {
                        dataManager.off('character_initialized', this.characterInitHandler);
                        this.characterInitHandler = null;
                    }
                });
            }

            this.cleanupRegistry.registerCleanup(() => {
                const actionNameElement = document.querySelector('div[class*="Header_actionName"]');
                if (actionNameElement) {
                    this.clearAppendedStats(actionNameElement);
                }
            });

            this.cleanupRegistry.registerCleanup(() => {
                if (this.waitForPanelTimeout) {
                    clearTimeout(this.waitForPanelTimeout);
                    this.waitForPanelTimeout = null;
                }
            });

            this.cleanupRegistry.registerCleanup(() => {
                if (this.retryUpdateTimeout) {
                    clearTimeout(this.retryUpdateTimeout);
                    this.retryUpdateTimeout = null;
                }
            });

            this.cleanupRegistry.registerCleanup(() => {
                if (this.updateTimer) {
                    clearInterval(this.updateTimer);
                    this.updateTimer = null;
                }
            });

            this.cleanupRegistry.registerCleanup(() => {
                if (this.actionNameObserver) {
                    this.actionNameObserver();
                    this.actionNameObserver = null;
                }
            });

            this.cleanupRegistry.registerCleanup(() => {
                if (this.queueMenuObserver) {
                    this.queueMenuObserver();
                    this.queueMenuObserver = null;
                }
            });

            this.cleanupRegistry.registerCleanup(() => {
                if (this.unregisterActionNameObserver) {
                    this.unregisterActionNameObserver();
                    this.unregisterActionNameObserver = null;
                }
            });

            // Wait for action name element to exist
            this.waitForActionPanel();

            this.initializeActionNameWatcher();

            // Initialize queue tooltip observer
            this.initializeQueueObserver();

            this.isInitialized = true;
        }

        /**
         * Initialize observer for queue tooltip
         */
        initializeQueueObserver() {
            // Register with centralized DOM observer to watch for queue menu
            this.unregisterQueueObserver = domObserver.onClass(
                'ActionTimeDisplay-Queue',
                'QueuedActions_queuedActionsEditMenu',
                (queueMenu) => {
                    this.injectQueueTimes(queueMenu);

                    this.setupQueueMenuObserver(queueMenu);
                }
            );

            this.cleanupRegistry.registerCleanup(() => {
                if (this.unregisterQueueObserver) {
                    this.unregisterQueueObserver();
                    this.unregisterQueueObserver = null;
                }
            });
        }

        /**
         * Initialize observer for action name element replacement
         */
        initializeActionNameWatcher() {
            if (this.unregisterActionNameObserver) {
                return;
            }

            this.unregisterActionNameObserver = domObserver.onClass(
                'ActionTimeDisplay-ActionName',
                'Header_actionName',
                (actionNameElement) => {
                    if (!actionNameElement) {
                        return;
                    }

                    this.createDisplayPanel();
                    this.setupActionNameObserver(actionNameElement);
                    this.updateDisplay();
                }
            );
        }

        /**
         * Setup mutation observer for queue menu reordering
         * @param {HTMLElement} queueMenu - Queue menu container element
         */
        setupQueueMenuObserver(queueMenu) {
            if (!queueMenu) {
                return;
            }

            if (this.queueMenuObserver) {
                this.queueMenuObserver();
                this.queueMenuObserver = null;
            }

            this.queueMenuObserver = domObserverHelpers_js.createMutationWatcher(
                queueMenu,
                () => {
                    // Disconnect to prevent infinite loop (our injection triggers mutations)
                    if (this.queueMenuObserver) {
                        this.queueMenuObserver();
                        this.queueMenuObserver = null;
                    }

                    // Queue DOM changed (reordering) - re-inject times
                    // NOTE: Reconnection happens inside injectQueueTimes after async completes
                    this.injectQueueTimes(queueMenu);
                },
                {
                    childList: true,
                    subtree: true,
                }
            );
        }

        /**
         * Handle character switch
         * Clean up old observers and re-initialize for new character's action panel
         */
        handleCharacterSwitch() {
            // Cancel any active profit calculations to prevent stale data
            this.activeProfitCalculationId = null;

            // Clear appended stats from old character's action panel (before it's removed)
            const oldActionNameElement = document.querySelector('div[class*="Header_actionName"]');
            if (oldActionNameElement) {
                this.clearAppendedStats(oldActionNameElement);
            }

            // Disconnect old action name observer (watching removed element)
            if (this.actionNameObserver) {
                this.actionNameObserver();
                this.actionNameObserver = null;
            }

            // Clear display element reference (already removed from DOM by game)
            this.displayElement = null;

            // Re-initialize action panel display for new character
            this.waitForActionPanel();
        }

        /**
         * Wait for action panel to exist in DOM
         */
        async waitForActionPanel() {
            // Try to find action name element (use wildcard for hash-suffixed class)
            const actionNameElement = document.querySelector('div[class*="Header_actionName"]');

            if (actionNameElement) {
                this.createDisplayPanel();
                this.setupActionNameObserver(actionNameElement);
                this.updateDisplay();
            } else {
                // Not found, try again in 200ms
                if (this.waitForPanelTimeout) {
                    clearTimeout(this.waitForPanelTimeout);
                }
                this.waitForPanelTimeout = setTimeout(() => {
                    this.waitForPanelTimeout = null;
                    this.waitForActionPanel();
                }, 200);
                this.cleanupRegistry.registerTimeout(this.waitForPanelTimeout);
            }
        }

        /**
         * Setup MutationObserver to watch action name changes
         * @param {HTMLElement} actionNameElement - The action name DOM element
         */
        setupActionNameObserver(actionNameElement) {
            // Watch for text content changes in the action name element
            this.actionNameObserver = domObserverHelpers_js.createMutationWatcher(
                actionNameElement,
                () => {
                    this.updateDisplay();
                },
                {
                    childList: true,
                    characterData: true,
                    subtree: true,
                }
            );
        }

        /**
         * Create the display panel in the DOM
         */
        createDisplayPanel() {
            if (this.displayElement) {
                return; // Already created
            }

            // Find the action name container (use wildcard for hash-suffixed class)
            const actionNameContainer = document.querySelector('div[class*="Header_actionName"]');
            if (!actionNameContainer) {
                return;
            }

            // NOTE: Width overrides are now applied in updateDisplay() after we know if it's combat
            // This prevents HP/MP bar width issues when loading directly on combat actions

            // Create display element
            this.displayElement = document.createElement('div');
            this.displayElement.id = 'mwi-action-time-display';
            this.displayElement.style.cssText = `
            font-size: 0.9em;
            color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
            margin-top: 2px;
            line-height: 1.4;
            text-align: left;
            white-space: pre-wrap;
        `;

            // Insert after action name
            actionNameContainer.parentNode.insertBefore(this.displayElement, actionNameContainer.nextSibling);

            this.cleanupRegistry.registerCleanup(() => {
                if (this.displayElement && this.displayElement.parentNode) {
                    this.displayElement.parentNode.removeChild(this.displayElement);
                }
                this.displayElement = null;
            });
        }

        /**
         * Update the display with current action data
         */
        updateDisplay() {
            if (!this.displayElement) {
                return;
            }

            // Get current action - read from game UI which is always correct
            // The game updates the DOM immediately when actions change
            // Use wildcard selector to handle hash-suffixed class names
            const actionNameElement = document.querySelector('div[class*="Header_actionName"]');

            // CRITICAL: Disconnect observer before making changes to prevent infinite loop
            if (this.actionNameObserver) {
                this.actionNameObserver();
                this.actionNameObserver = null;
            }

            if (!actionNameElement || !actionNameElement.textContent) {
                this.displayElement.innerHTML = '';
                // Clear any appended stats from the game's div
                this.clearAppendedStats(actionNameElement);
                // Reconnect observer
                this.reconnectActionNameObserver(actionNameElement);
                return;
            }

            // Parse action name from DOM
            // Format can be: "Action Name (#123)", "Action Name (123)", "Action Name: Item (123)", etc.
            // First, strip any stats we previously appended
            const actionNameText = this.getCleanActionName(actionNameElement);

            // Check if no action is running ("Doing nothing...")
            if (actionNameText.includes('Doing nothing')) {
                this.displayElement.innerHTML = '';
                this.clearAppendedStats(actionNameElement);
                // Reconnect observer
                this.reconnectActionNameObserver(actionNameElement);
                return;
            }

            // Extract inventory count from parentheses (e.g., "Coinify: Item (4312)" -> 4312)
            const inventoryCountMatch = actionNameText.match(/\(([\d,]+)\)$/);
            const inventoryCount = inventoryCountMatch ? parseInt(inventoryCountMatch[1].replace(/,/g, ''), 10) : null;

            // Find the matching action in cache
            const cachedActions = dataManager.getCurrentActions();
            let action;

            // ONLY match against the first action (current action), not queued actions
            // This prevents showing stats from queued actions when party combat interrupts
            if (cachedActions.length > 0) {
                action = this.matchCurrentActionFromText(cachedActions, actionNameText);
            }

            if (!action) {
                this.displayElement.innerHTML = '';
                this.scheduleUpdateRetry();
                // Reconnect observer
                this.reconnectActionNameObserver(actionNameElement);
                return;
            }

            const actionDetails = dataManager.getActionDetails(action.actionHrid);
            if (!actionDetails) {
                // Reconnect observer
                this.reconnectActionNameObserver(actionNameElement);
                return;
            }

            // Skip combat actions - no time display for combat
            if (actionDetails.type === '/action_types/combat') {
                this.displayElement.innerHTML = '';
                this.clearAppendedStats(actionNameElement);

                // REMOVE CSS overrides for combat to restore normal HP/MP bar width
                actionNameElement.style.removeProperty('overflow');
                actionNameElement.style.removeProperty('text-overflow');
                actionNameElement.style.removeProperty('white-space');
                actionNameElement.style.removeProperty('max-width');
                actionNameElement.style.removeProperty('width');
                actionNameElement.style.removeProperty('min-width');

                // Remove from parent chain as well
                let parent = actionNameElement.parentElement;
                let levels = 0;
                while (parent && levels < 5) {
                    parent.style.removeProperty('overflow');
                    parent.style.removeProperty('text-overflow');
                    parent.style.removeProperty('white-space');
                    parent.style.removeProperty('max-width');
                    parent.style.removeProperty('width');
                    parent.style.removeProperty('min-width');
                    parent = parent.parentElement;
                    levels++;
                }

                this.reconnectActionNameObserver(actionNameElement);
                return;
            }

            // Re-apply CSS override on every update to prevent game's CSS from truncating text
            // ONLY for non-combat actions (combat needs normal width for HP/MP bars)
            // Use setProperty with 'important' to ensure we override game's styles

            // Check display mode setting
            const displayMode = config.getSettingValue('totalActionTime', 'full');

            if (displayMode === 'compact') {
                // COMPACT MODE: Limit to 800px and reset parents
                actionNameElement.style.setProperty('max-width', '800px', 'important');
                actionNameElement.style.setProperty('overflow', 'hidden', 'important');
                actionNameElement.style.setProperty('text-overflow', 'clip', 'important');
                actionNameElement.style.setProperty('white-space', 'nowrap', 'important');
                actionNameElement.style.setProperty('width', '', 'important'); // Reset width

                // Reset parent containers to their original game constraints
                const parent1 = actionNameElement.parentElement;
                const parent2 = parent1?.parentElement;

                if (parent1) {
                    parent1.style.removeProperty('max-width');
                    parent1.style.removeProperty('width');
                    parent1.style.removeProperty('overflow');
                }

                if (parent2) {
                    parent2.style.removeProperty('max-width');
                    parent2.style.removeProperty('width');
                    parent2.style.removeProperty('overflow');
                }
            } else if (displayMode === 'minimal') {
                // MINIMAL MODE: Keep game's default width constraints, just show less info
                actionNameElement.style.setProperty('overflow', 'visible', 'important');
                actionNameElement.style.setProperty('text-overflow', 'clip', 'important');
                actionNameElement.style.setProperty('white-space', 'nowrap', 'important');
                actionNameElement.style.setProperty('max-width', 'none', 'important');
                actionNameElement.style.setProperty('width', '', 'important'); // Reset to default

                // Reset parent containers to game defaults (don't expand)
                const parent1 = actionNameElement.parentElement;
                const parent2 = parent1?.parentElement;

                if (parent1) {
                    parent1.style.removeProperty('max-width');
                    parent1.style.removeProperty('width');
                    parent1.style.removeProperty('overflow');
                }

                if (parent2) {
                    parent2.style.removeProperty('max-width');
                    parent2.style.removeProperty('width');
                    parent2.style.removeProperty('overflow');
                }
            } else {
                // FULL DETAILS MODE: Expand containers to show all text
                actionNameElement.style.setProperty('overflow', 'visible', 'important');
                actionNameElement.style.setProperty('text-overflow', 'clip', 'important');
                actionNameElement.style.setProperty('white-space', 'nowrap', 'important');
                actionNameElement.style.setProperty('max-width', 'none', 'important');
                actionNameElement.style.setProperty('width', 'auto', 'important');

                // Remove max-width constraints from first 2 parent levels
                const parent1 = actionNameElement.parentElement;
                const parent2 = parent1?.parentElement;

                if (parent1) {
                    parent1.style.setProperty('max-width', 'none', 'important');
                    parent1.style.setProperty('width', 'auto', 'important');
                    parent1.style.setProperty('overflow', 'visible', 'important');
                }

                if (parent2) {
                    parent2.style.setProperty('max-width', 'none', 'important');
                    parent2.style.setProperty('width', 'auto', 'important');
                    parent2.style.setProperty('overflow', 'visible', 'important');
                }
            }

            // Get character data
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

            // For alchemy actions, use item level for efficiency calculation (not action requirement)
            let levelRequirementOverride = undefined;
            if (actionDetails.type === '/action_types/alchemy' && action.primaryItemHash) {
                const parts = action.primaryItemHash.split('::');
                if (parts.length >= 3) {
                    const itemHrid = parts[2];
                    const itemDetails = itemDetailMap[itemHrid];
                    if (itemDetails && itemDetails.itemLevel) {
                        levelRequirementOverride = itemDetails.itemLevel;
                    }
                }
            }

            // Use shared calculator
            const stats = actionCalculator_js.calculateActionStats(actionDetails, {
                skills,
                equipment,
                itemDetailMap,
                actionHrid: action.actionHrid, // Pass action HRID for task detection
                includeCommunityBuff: true,
                includeBreakdown: false,
                floorActionLevel: true,
                levelRequirementOverride,
            });

            if (!stats) {
                // Reconnect observer
                this.reconnectActionNameObserver(actionNameElement);
                return;
            }

            const { actionTime, totalEfficiency } = stats;
            const baseActionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);

            // Efficiency model:
            // - Queue input counts completed actions (including instant repeats)
            // - Efficiency adds instant repeats with no extra time
            // - Time is based on time-consuming actions (queuedActions / avgActionsPerBaseAction)
            // - Materials are consumed per completed action, including repeats
            // Calculate average queued actions completed per time-consuming action
            const avgActionsPerBaseAction = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

            // Calculate actions per hour WITH efficiency (total action completions including instant repeats)
            const actionsPerHourWithEfficiency = profitHelpers_js.calculateEffectiveActionsPerHour(
                baseActionsPerHour,
                avgActionsPerBaseAction
            );

            // Calculate items per hour based on action type
            let itemsPerHour;

            // Gathering action types (need special handling for dropTable)
            const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

            // Production action types that benefit from Gourmet Tea
            const PRODUCTION_TYPES = ['/action_types/brewing', '/action_types/cooking'];

            if (
                actionDetails.dropTable &&
                actionDetails.dropTable.length > 0 &&
                GATHERING_TYPES.includes(actionDetails.type)
            ) {
                // Gathering action - use dropTable with gathering quantity bonus
                const mainDrop = actionDetails.dropTable[0];
                const baseAvgAmount = (mainDrop.minCount + mainDrop.maxCount) / 2;

                // Calculate gathering quantity bonus (same as gathering-profit.js)
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                const gatheringTea = teaParser_js.parseGatheringBonus(activeDrinks, itemDetailMap, drinkConcentration);

                // Community buff
                const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
                const communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

                // Achievement buffs
                const achievementGathering = dataManager.getAchievementBuffFlatBoost(
                    actionDetails.type,
                    '/buff_types/gathering'
                );

                // Total gathering bonus (all additive)
                const totalGathering = gatheringTea + communityGathering + achievementGathering;

                // Apply gathering bonus to average amount
                const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

                // Items per hour = actions × drop rate × avg amount × efficiency
                itemsPerHour = baseActionsPerHour * mainDrop.dropRate * avgAmountPerAction * avgActionsPerBaseAction;
            } else if (actionDetails.outputItems && actionDetails.outputItems.length > 0) {
                // Production action - use outputItems
                const outputAmount = actionDetails.outputItems[0].count || 1;
                itemsPerHour = baseActionsPerHour * outputAmount * avgActionsPerBaseAction;

                // Apply Gourmet bonus for brewing/cooking (extra items chance)
                if (PRODUCTION_TYPES.includes(actionDetails.type)) {
                    const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                    const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                    const gourmetBonus = teaParser_js.parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration);

                    // Gourmet gives a chance for extra items (e.g., 0.1344 = 13.44% more items)
                    const gourmetBonusItems = itemsPerHour * gourmetBonus;
                    itemsPerHour += gourmetBonusItems;
                }
            } else {
                // Fallback - no items produced
                itemsPerHour = actionsPerHourWithEfficiency;
            }

            // Calculate material limit for infinite actions
            let materialLimit = null;
            let limitType = null;
            if (!action.hasMaxCount) {
                // Get inventory and calculate Artisan bonus
                const inventory = dataManager.getInventory();
                const inventoryLookup = this.buildInventoryLookup(inventory);
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                // Calculate max actions based on materials and costs
                const limitResult = this.calculateMaterialLimit(actionDetails, inventoryLookup, artisanBonus, action);
                if (limitResult) {
                    materialLimit = limitResult.maxActions;
                    limitType = limitResult.limitType;
                }
            }

            // Get queue size for display (total queued, doesn't change)
            // For infinite actions with inventory count, use that; otherwise use maxCount or Infinity
            let queueSizeDisplay;
            if (action.hasMaxCount) {
                queueSizeDisplay = action.maxCount;
            } else if (materialLimit !== null) {
                // Material-limited infinite action - show infinity but we'll add "max: X" separately
                queueSizeDisplay = Infinity;
            } else if (inventoryCount !== null) {
                queueSizeDisplay = inventoryCount;
            } else {
                queueSizeDisplay = Infinity;
            }

            // Get remaining actions for time calculation
            // For infinite actions, use material limit if available, then inventory count
            let remainingQueuedActions;
            if (action.hasMaxCount) {
                // Finite action: maxCount is the target, currentCount is progress toward that target
                remainingQueuedActions = action.maxCount - action.currentCount;
            } else if (materialLimit !== null) {
                // Infinite action limited by materials (materialLimit is queued actions)
                remainingQueuedActions = materialLimit;
            } else if (inventoryCount !== null) {
                // Infinite action: currentCount is lifetime total, so just use inventory count directly
                remainingQueuedActions = inventoryCount;
            } else {
                remainingQueuedActions = Infinity;
            }

            // Calculate time-consuming actions needed
            let baseActionsNeeded;
            if (!action.hasMaxCount && materialLimit !== null) {
                // Material-limited infinite action - convert queued actions to time-consuming actions
                baseActionsNeeded = Math.ceil(materialLimit / avgActionsPerBaseAction);
            } else {
                // Finite action or inventory-count infinite - remainingQueuedActions is queued actions
                baseActionsNeeded = Math.ceil(remainingQueuedActions / avgActionsPerBaseAction);
            }
            const totalTimeSeconds = baseActionsNeeded * actionTime;

            // Calculate completion time
            const completionTime = new Date();
            completionTime.setSeconds(completionTime.getSeconds() + totalTimeSeconds);

            // Format time strings (timeReadable handles days/hours/minutes properly)
            const timeStr = formatters_js.timeReadable(totalTimeSeconds);

            // Format completion time
            const now = new Date();
            const isToday = completionTime.toDateString() === now.toDateString();

            let clockTime;
            if (isToday) {
                // Today: Just show time in 12-hour format
                clockTime = completionTime.toLocaleString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                });
            } else {
                // Future date: Show date and time in 12-hour format
                clockTime = completionTime.toLocaleString('en-US', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                });
            }

            // Build display HTML
            // Line 1: Append stats to game's action name div
            const statsToAppend = [];

            // For minimal mode, only show remaining actions (not detailed stats)
            if (displayMode === 'minimal') {
                // Only show remaining actions count
                if (queueSizeDisplay !== Infinity) {
                    statsToAppend.push(`(${queueSizeDisplay.toLocaleString()} remaining)`);
                } else if (materialLimit !== null) {
                    statsToAppend.push(`(∞ · ${this.formatLargeNumber(materialLimit)} max)`);
                } else {
                    statsToAppend.push(`(∞)`);
                }
            } else {
                // Full and Compact modes: Show all stats
                // Queue size (with thousand separators)
                if (queueSizeDisplay !== Infinity) {
                    statsToAppend.push(`(${queueSizeDisplay.toLocaleString()} queued)`);
                } else if (materialLimit !== null) {
                    // Show infinity with material limit and what's limiting it
                    let limitLabel = '';
                    if (limitType === 'gold') {
                        limitLabel = 'gold limit';
                    } else if (limitType && limitType.startsWith('material:')) {
                        limitLabel = 'mat limit';
                    } else if (limitType && limitType.startsWith('upgrade:')) {
                        limitLabel = 'upgrade limit';
                    } else if (limitType === 'alchemy_item') {
                        limitLabel = 'item limit';
                    } else {
                        limitLabel = 'max';
                    }
                    statsToAppend.push(`(∞ · ${limitLabel}: ${this.formatLargeNumber(materialLimit)})`);
                } else {
                    statsToAppend.push(`(∞)`);
                }

                // Time per action and actions/hour
                statsToAppend.push(`${actionTime.toFixed(2)}s/action`);

                // Show both actions/hr (with efficiency) and items/hr (actual item output)
                statsToAppend.push(
                    `${actionsPerHourWithEfficiency.toFixed(0)} actions/hr (${itemsPerHour.toFixed(0)} items/hr)`
                );
            }

            // Append to game's div (with marker for cleanup)
            this.appendStatsToActionName(actionNameElement, statsToAppend.join(' · '));

            // Line 2: Time estimates in our div
            // Show time info if we have a finite number of remaining actions
            // This includes both finite actions (hasMaxCount) and infinite actions with inventory count
            if (remainingQueuedActions !== Infinity && !isNaN(remainingQueuedActions) && remainingQueuedActions > 0) {
                this.displayElement.innerHTML = `<span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeStr} → ${clockTime}`;
            } else {
                this.displayElement.innerHTML = '';
            }

            // Reconnect observer to watch for game's updates
            this.reconnectActionNameObserver(actionNameElement);
        }

        /**
         * Reconnect action name observer after making our changes
         * @param {HTMLElement} actionNameElement - Action name element
         */
        reconnectActionNameObserver(actionNameElement) {
            if (!actionNameElement) {
                return;
            }

            if (this.actionNameObserver) {
                this.actionNameObserver();
            }

            this.actionNameObserver = domObserverHelpers_js.createMutationWatcher(
                actionNameElement,
                () => {
                    this.updateDisplay();
                },
                {
                    childList: true,
                    characterData: true,
                    subtree: true,
                }
            );
        }

        parseActionNameFromDom(actionNameText) {
            // Strip ALL trailing parentheses groups (e.g., "(T3) (Party)" or "(50)")
            // This handles combat tiers and party indicators: "Infernal Abyss (T3) (Party)" → "Infernal Abyss"
            const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\([^)]+\))*$/);
            const fullNameFromDom = actionNameMatch ? actionNameMatch[1].trim() : actionNameText;

            if (fullNameFromDom.includes(':')) {
                const parts = fullNameFromDom.split(':');
                return {
                    actionNameFromDom: parts[0].trim(),
                    itemNameFromDom: parts.slice(1).join(':').trim(),
                };
            }

            return {
                actionNameFromDom: fullNameFromDom,
                itemNameFromDom: null,
            };
        }

        buildItemHridFromName(itemName) {
            return `/items/${itemName.toLowerCase().replace(/\s+/g, '_')}`;
        }

        matchCurrentActionFromText(currentActions, actionNameText) {
            const { actionNameFromDom, itemNameFromDom } = this.parseActionNameFromDom(actionNameText);
            const itemHridFromDom = this.buildItemHridFromName(itemNameFromDom || actionNameFromDom);

            return currentActions.find((currentAction) => {
                const actionDetails = dataManager.getActionDetails(currentAction.actionHrid);
                if (!actionDetails) {
                    return false;
                }

                const outputItems = actionDetails.outputItems || [];
                const dropTable = actionDetails.dropTable || [];
                const matchesOutput = outputItems.some((item) => item.itemHrid === itemHridFromDom);
                const matchesDrop = dropTable.some((drop) => drop.itemHrid === itemHridFromDom);
                const matchesName = actionDetails.name === actionNameFromDom;

                if (!matchesName && !matchesOutput && !matchesDrop) {
                    return false;
                }

                if (itemNameFromDom && currentAction.primaryItemHash) {
                    return currentAction.primaryItemHash.includes(itemHridFromDom);
                }

                return true;
            });
        }

        scheduleUpdateRetry() {
            if (this.retryUpdateTimeout) {
                return;
            }

            this.retryUpdateTimeout = setTimeout(() => {
                this.retryUpdateTimeout = null;
                this.updateDisplay();
            }, 150);
            this.cleanupRegistry.registerTimeout(this.retryUpdateTimeout);
        }

        /**
         * Get clean action name from element, stripping any stats we appended
         * @param {HTMLElement} actionNameElement - Action name element
         * @returns {string} Clean action name text
         */
        getCleanActionName(actionNameElement) {
            // Find our marker span (if it exists)
            const markerSpan = actionNameElement.querySelector('.mwi-appended-stats');
            if (markerSpan) {
                // Remove the marker span temporarily to get clean text
                const cleanText = actionNameElement.textContent.replace(markerSpan.textContent, '').trim();
                return cleanText;
            }
            // No marker found, return as-is
            return actionNameElement.textContent.trim();
        }

        /**
         * Clear any stats we previously appended to action name
         * @param {HTMLElement} actionNameElement - Action name element
         */
        clearAppendedStats(actionNameElement) {
            if (!actionNameElement) return;
            const markerSpan = actionNameElement.querySelector('.mwi-appended-stats');
            if (markerSpan) {
                markerSpan.remove();
            }
        }

        /**
         * Append stats to game's action name element
         * @param {HTMLElement} actionNameElement - Action name element
         * @param {string} statsText - Stats text to append
         */
        appendStatsToActionName(actionNameElement, statsText) {
            // Clear any previous appended stats
            this.clearAppendedStats(actionNameElement);

            // Get clean action name before appending stats
            const cleanActionName = this.getCleanActionName(actionNameElement);

            // Create marker span for our additions
            const statsSpan = document.createElement('span');
            statsSpan.className = 'mwi-appended-stats';

            // Check display mode
            const displayMode = config.getSettingValue('totalActionTime', 'full');

            if (displayMode === 'compact') {
                // COMPACT MODE: Truncate stats if too long
                statsSpan.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                display: inline-block;
                max-width: 400px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                vertical-align: bottom;
            `;
                // Set full text as tooltip on both stats span and parent element
                const fullText = cleanActionName + ' ' + statsText;
                statsSpan.setAttribute('title', fullText);
                actionNameElement.setAttribute('title', fullText);
            } else {
                // FULL WIDTH and MINIMAL modes: Show all stats
                statsSpan.style.cssText = `color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});`;
                // Remove tooltip in full width mode
                actionNameElement.removeAttribute('title');
            }

            statsSpan.textContent = ' ' + statsText;

            // Append to action name element
            actionNameElement.appendChild(statsSpan);
        }

        /**
         * Calculate action time for a given action
         * @param {Object} actionDetails - Action details from data manager
         * @param {string} actionHrid - Action HRID for task detection (optional)
         * @returns {Object} {actionTime, totalEfficiency} or null if calculation fails
         */
        calculateActionTime(actionDetails, actionHrid = null) {
            const skills = dataManager.getSkills();
            const equipment = dataManager.getEquipment();
            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

            // Use shared calculator with same parameters as main display
            return actionCalculator_js.calculateActionStats(actionDetails, {
                skills,
                equipment,
                itemDetailMap,
                actionHrid, // Pass action HRID for task detection
                includeCommunityBuff: true,
                includeBreakdown: false,
                floorActionLevel: true,
            });
        }

        /**
         * Format a number with K/M suffix for large values
         * @param {number} num - Number to format
         * @returns {string} Formatted string (e.g., "1.23K", "5.67M")
         */
        formatLargeNumber(num) {
            if (num < 10000) {
                return num.toLocaleString(); // Under 10K: show full number with commas
            } else if (num < 1000000) {
                return (num / 1000).toFixed(1) + 'K'; // 10K-999K: show with K
            } else {
                return (num / 1000000).toFixed(2) + 'M'; // 1M+: show with M
            }
        }

        /**
         * Build inventory lookup maps for fast material queries
         * @param {Array} inventory - Character inventory items
         * @returns {Object} Lookup maps by HRID and enhancement
         */
        buildInventoryLookup(inventory) {
            const byHrid = {};
            const byEnhancedKey = {};

            if (!Array.isArray(inventory)) {
                return { byHrid, byEnhancedKey };
            }

            for (const item of inventory) {
                if (item.itemLocationHrid !== '/item_locations/inventory') {
                    continue;
                }

                const count = item.count || 0;
                if (!count) {
                    continue;
                }

                byHrid[item.itemHrid] = (byHrid[item.itemHrid] || 0) + count;

                const enhancementLevel = item.enhancementLevel || 0;
                const enhancedKey = `${item.itemHrid}::${enhancementLevel}`;
                byEnhancedKey[enhancedKey] = (byEnhancedKey[enhancedKey] || 0) + count;
            }

            return { byHrid, byEnhancedKey };
        }

        /**
         * Calculate maximum actions possible based on inventory materials
         * @param {Object} actionDetails - Action detail object
         * @param {Object|Array} inventoryLookup - Inventory lookup maps or raw inventory array
         * @param {number} artisanBonus - Artisan material reduction (0-1 decimal)
         * @param {Object} actionObj - Character action object (for primaryItemHash)
         * @returns {Object|null} {maxActions: number, limitType: string} or null if unlimited
         */
        calculateMaterialLimit(actionDetails, inventoryLookup, artisanBonus, actionObj = null) {
            if (!actionDetails || !inventoryLookup) {
                return null;
            }

            // Materials are consumed per queued action. Efficiency only affects time, not materials.

            const lookup = Array.isArray(inventoryLookup) ? this.buildInventoryLookup(inventoryLookup) : inventoryLookup;
            const byHrid = lookup?.byHrid || {};
            const byEnhancedKey = lookup?.byEnhancedKey || {};

            // Check for primaryItemHash (ONLY for Alchemy actions: Coinify, Decompose, Transmute)
            // Crafting actions also have primaryItemHash but should use the standard input/upgrade logic
            // Format: "characterID::itemLocation::itemHrid::enhancementLevel"
            const isAlchemyAction = actionDetails.type === '/action_types/alchemy';
            if (isAlchemyAction && actionObj && actionObj.primaryItemHash) {
                const parts = actionObj.primaryItemHash.split('::');
                if (parts.length >= 3) {
                    const itemHrid = parts[2]; // Extract item HRID
                    const enhancementLevel = parts.length >= 4 ? parseInt(parts[3]) : 0;

                    const enhancedKey = `${itemHrid}::${enhancementLevel}`;
                    const availableCount = byEnhancedKey[enhancedKey] || 0;

                    // Get bulk multiplier from item details (how many items per action)
                    const itemDetails = dataManager.getItemDetails(itemHrid);
                    const bulkMultiplier = itemDetails?.alchemyDetail?.bulkMultiplier || 1;

                    // Calculate max queued actions based on available items
                    const maxActions = Math.floor(availableCount / bulkMultiplier);

                    return { maxActions, limitType: 'alchemy_item' };
                }
            }

            // Check if action requires input materials or has costs
            const hasInputItems = actionDetails.inputItems && actionDetails.inputItems.length > 0;
            const hasUpgradeItem = actionDetails.upgradeItemHrid;
            const hasCoinCost = actionDetails.coinCost && actionDetails.coinCost > 0;

            if (!hasInputItems && !hasUpgradeItem && !hasCoinCost) {
                return null; // No materials or costs required - unlimited
            }

            let minLimit = Infinity;
            let limitType = 'unknown';

            // Check gold/coin constraint (if action has a coin cost)
            if (hasCoinCost) {
                const availableGold = byHrid['/items/gold_coin'] || 0;
                const maxActionsFromGold = Math.floor(availableGold / actionDetails.coinCost);

                if (maxActionsFromGold < minLimit) {
                    minLimit = maxActionsFromGold;
                    limitType = 'gold';
                }
            }

            // Check input items (affected by Artisan Tea)
            if (hasInputItems) {
                for (const inputItem of actionDetails.inputItems) {
                    const availableCount = byHrid[inputItem.itemHrid] || 0;

                    // Apply Artisan reduction to required materials
                    const requiredPerAction = inputItem.count * (1 - artisanBonus);

                    // Calculate max queued actions for this material
                    const maxActions = Math.floor(availableCount / requiredPerAction);

                    if (maxActions < minLimit) {
                        minLimit = maxActions;
                        limitType = `material:${inputItem.itemHrid}`;
                    }
                }
            }

            // Check upgrade item (NOT affected by Artisan Tea)
            if (hasUpgradeItem) {
                const availableCount = byHrid[hasUpgradeItem] || 0;

                if (availableCount < minLimit) {
                    minLimit = availableCount;
                    limitType = `upgrade:${hasUpgradeItem}`;
                }
            }

            if (minLimit === Infinity) {
                return null;
            }

            return { maxActions: minLimit, limitType };
        }

        /**
         * Match an action from cache by reading its name from a queue div
         * @param {HTMLElement} actionDiv - The queue action div element
         * @param {Array} cachedActions - Array of actions from dataManager
         * @returns {Object|null} Matched action object or null
         */
        matchActionFromDiv(actionDiv, cachedActions, usedActionIds = new Set()) {
            // Find the action text element within the div
            const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
            if (!actionTextContainer) {
                return null;
            }

            // The first child div contains the action name: "#3 🧪 Coinify: Foraging Essence"
            const firstChildDiv = actionTextContainer.querySelector('[class*="QueuedActions_text__"]');
            if (!firstChildDiv) {
                return null;
            }

            // Check if this is an enhancing action by looking at the SVG icon
            const svgIcon = firstChildDiv.querySelector('svg use');
            const isEnhancingAction = svgIcon && svgIcon.getAttribute('href')?.includes('#enhancing');

            // Get the text content (format: "#3Coinify: Foraging Essence" - no space after number!)
            const fullText = firstChildDiv.textContent.trim();

            // Remove position number: "#3Coinify: Foraging Essence" → "Coinify: Foraging Essence"
            // Note: No space after the number in the actual text
            const actionNameText = fullText.replace(/^#\d+/, '').trim();

            // Handle enhancing actions specially
            if (isEnhancingAction) {
                // For enhancing, the text is just the item name (e.g., "Cheese Sword")
                const itemName = actionNameText;
                const itemHrid = '/items/' + itemName.toLowerCase().replace(/\s+/g, '_');

                // Find enhancing action matching this item (excluding already-used actions)
                return cachedActions.find((a) => {
                    if (usedActionIds.has(a.id)) {
                        return false; // Skip already-matched actions
                    }

                    const actionDetails = dataManager.getActionDetails(a.actionHrid);
                    if (!actionDetails || actionDetails.type !== '/action_types/enhancing') {
                        return false;
                    }

                    // Match on primaryItemHash (the item being enhanced)
                    return a.primaryItemHash && a.primaryItemHash.includes(itemHrid);
                });
            }

            // Parse action name (same logic as main display)
            let actionNameFromDiv, itemNameFromDiv;
            if (actionNameText.includes(':')) {
                const parts = actionNameText.split(':');
                actionNameFromDiv = parts[0].trim();
                itemNameFromDiv = parts.slice(1).join(':').trim();
            } else {
                actionNameFromDiv = actionNameText;
                itemNameFromDiv = null;
            }

            // Match action from cache (same logic as main display, excluding already-used actions)
            return cachedActions.find((a) => {
                if (usedActionIds.has(a.id)) {
                    return false; // Skip already-matched actions
                }

                const actionDetails = dataManager.getActionDetails(a.actionHrid);
                if (!actionDetails) {
                    return false;
                }

                if (actionDetails.name !== actionNameFromDiv) {
                    const itemHridFromDiv = itemNameFromDiv
                        ? `/items/${itemNameFromDiv.toLowerCase().replace(/\s+/g, '_')}`
                        : `/items/${actionNameFromDiv.toLowerCase().replace(/\s+/g, '_')}`;
                    const outputItems = actionDetails.outputItems || [];
                    const dropTable = actionDetails.dropTable || [];
                    const matchesOutput = outputItems.some((item) => item.itemHrid === itemHridFromDiv);
                    const matchesDrop = dropTable.some((drop) => drop.itemHrid === itemHridFromDiv);

                    if (!matchesOutput && !matchesDrop) {
                        return false;
                    }
                }

                // If there's an item name, match on primaryItemHash
                if (itemNameFromDiv && a.primaryItemHash) {
                    const itemHrid = '/items/' + itemNameFromDiv.toLowerCase().replace(/\s+/g, '_');
                    return a.primaryItemHash.includes(itemHrid);
                }

                return true;
            });
        }

        /**
         * Inject time display into queue tooltip
         * @param {HTMLElement} queueMenu - Queue menu container element
         */
        injectQueueTimes(queueMenu) {
            // Track if we need to reconnect observer at the end
            let shouldReconnectObserver = false;

            try {
                // Get all queued actions
                const currentActions = dataManager.getCurrentActions();
                if (!currentActions || currentActions.length === 0) {
                    return;
                }

                // Find all action divs in the queue (individual actions only, not wrapper or text containers)
                const actionDivs = queueMenu.querySelectorAll('[class^="QueuedActions_action__"]');
                if (actionDivs.length === 0) {
                    return;
                }

                const inventoryLookup = this.buildInventoryLookup(dataManager.getInventory());

                // Clear all existing time and profit displays to prevent duplicates
                queueMenu.querySelectorAll('.mwi-queue-action-time').forEach((el) => el.remove());
                queueMenu.querySelectorAll('.mwi-queue-action-profit').forEach((el) => el.remove());
                const existingTotal = document.querySelector('#mwi-queue-total-time');
                if (existingTotal) {
                    existingTotal.remove();
                }

                // Observer is already disconnected by callback - we'll reconnect in finally
                shouldReconnectObserver = true;

                let accumulatedTime = 0;
                let hasInfinite = false;
                const actionsToCalculate = []; // Store actions for async profit calculation (with time in seconds)

                // Detect current action from DOM so we can avoid double-counting
                let currentAction = null;
                const actionNameElement = document.querySelector('div[class*="Header_actionName"]');
                if (actionNameElement && actionNameElement.textContent) {
                    // Use getCleanActionName to strip any stats we previously appended
                    const actionNameText = this.getCleanActionName(actionNameElement);

                    // Parse action name (same logic as main display)
                    // Also handles formatted numbers like "Farmland (276K)" or "Zone (1.2M)"
                    const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\([^)]+\))?$/);
                    const fullNameFromDom = actionNameMatch ? actionNameMatch[1].trim() : actionNameText;

                    let actionNameFromDom, itemNameFromDom;
                    if (fullNameFromDom.includes(':')) {
                        const parts = fullNameFromDom.split(':');
                        actionNameFromDom = parts[0].trim();
                        itemNameFromDom = parts.slice(1).join(':').trim();
                    } else {
                        actionNameFromDom = fullNameFromDom;
                        itemNameFromDom = null;
                    }

                    // Match current action from cache
                    currentAction = currentActions.find((a) => {
                        const actionDetails = dataManager.getActionDetails(a.actionHrid);
                        if (!actionDetails || actionDetails.name !== actionNameFromDom) {
                            return false;
                        }

                        if (itemNameFromDom && a.primaryItemHash) {
                            const itemHrid = '/items/' + itemNameFromDom.toLowerCase().replace(/\s+/g, '_');
                            const matches = a.primaryItemHash.includes(itemHrid);
                            return matches;
                        }

                        return true;
                    });

                    if (currentAction) {
                        // Current action matched
                    }
                }

                // Calculate time for current action to include in total
                // Always include current action time, even if it appears in queue
                if (currentAction) {
                    const actionDetails = dataManager.getActionDetails(currentAction.actionHrid);
                    if (actionDetails) {
                        // Check if infinite BEFORE calculating count
                        const isInfinite = !currentAction.hasMaxCount || currentAction.actionHrid.includes('/combat/');

                        let actionTimeSeconds = 0; // Time spent on this action (for profit calculation)
                        let count = 0; // Queued action count for profit calculation
                        let baseActionsNeeded = 0; // Time-consuming actions for time calculation

                        if (isInfinite) {
                            // Check for material limit on infinite actions
                            const equipment = dataManager.getEquipment();
                            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};
                            const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                            const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                            // Calculate action stats to get efficiency
                            const timeData = this.calculateActionTime(actionDetails, currentAction.actionHrid);
                            if (timeData) {
                                const { actionTime, totalEfficiency } = timeData;
                                const limitResult = this.calculateMaterialLimit(
                                    actionDetails,
                                    inventoryLookup,
                                    artisanBonus,
                                    currentAction
                                );

                                const materialLimit = limitResult?.maxActions || null;

                                if (materialLimit !== null) {
                                    // Material-limited infinite action - calculate time
                                    count = materialLimit; // Max queued actions based on materials
                                    const avgActionsPerBaseAction = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);
                                    baseActionsNeeded = Math.ceil(count / avgActionsPerBaseAction);
                                    const totalTime = baseActionsNeeded * actionTime;
                                    accumulatedTime += totalTime;
                                    actionTimeSeconds = totalTime;
                                }
                            } else {
                                // Could not calculate action time
                                hasInfinite = true;
                            }
                        } else {
                            count = currentAction.maxCount - currentAction.currentCount;
                            const timeData = this.calculateActionTime(actionDetails, currentAction.actionHrid);
                            if (timeData) {
                                const { actionTime, totalEfficiency } = timeData;

                                // Calculate average queued actions per time-consuming action
                                const avgActionsPerBaseAction = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

                                // Calculate time-consuming actions needed
                                baseActionsNeeded = Math.ceil(count / avgActionsPerBaseAction);
                                const totalTime = baseActionsNeeded * actionTime;
                                accumulatedTime += totalTime;
                                actionTimeSeconds = totalTime;
                            }
                        }

                        // Store action for profit calculation (done async after UI renders)
                        if (actionTimeSeconds > 0) {
                            actionsToCalculate.push({
                                actionHrid: currentAction.actionHrid,
                                timeSeconds: actionTimeSeconds,
                                count: count,
                                baseActionsNeeded: baseActionsNeeded,
                            });
                        }
                    }
                }

                // Now process queued actions by reading from each div
                // Each div shows a queued action, and we match it to cache by name
                // Track used action IDs to prevent duplicate matching (e.g., two identical infinite actions)
                const usedActionIds = new Set();

                // CRITICAL FIX: Always mark current action as used to prevent queue from matching it
                // The isCurrentActionInQueue flag only controls whether we add current action time to total
                if (currentAction) {
                    usedActionIds.add(currentAction.id);
                }

                for (let divIndex = 0; divIndex < actionDivs.length; divIndex++) {
                    const actionDiv = actionDivs[divIndex];

                    // Match this div's action from the cache (excluding already-matched actions)
                    const actionObj = this.matchActionFromDiv(actionDiv, currentActions, usedActionIds);

                    if (!actionObj) {
                        // Could not match action - show unknown
                        const timeDiv = document.createElement('div');
                        timeDiv.className = 'mwi-queue-action-time';
                        timeDiv.style.cssText = `
                        color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                        font-size: 0.85em;
                        margin-top: 2px;
                    `;
                        timeDiv.textContent = '[Unknown action]';

                        const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
                        if (actionTextContainer) {
                            actionTextContainer.appendChild(timeDiv);
                        } else {
                            actionDiv.appendChild(timeDiv);
                        }

                        continue;
                    }

                    // Mark this action as used for subsequent divs
                    usedActionIds.add(actionObj.id);

                    const actionDetails = dataManager.getActionDetails(actionObj.actionHrid);
                    if (!actionDetails) {
                        console.warn('[Action Time Display] Unknown queued action:', actionObj.actionHrid);
                        continue;
                    }

                    // Check if infinite BEFORE calculating count
                    const isInfinite = !actionObj.hasMaxCount || actionObj.actionHrid.includes('/combat/');

                    // Calculate action time first to get efficiency
                    const timeData = this.calculateActionTime(actionDetails, actionObj.actionHrid);
                    if (!timeData) continue;

                    const { actionTime, totalEfficiency } = timeData;

                    // Calculate material limit for infinite actions
                    let materialLimit = null;
                    let limitType = null;
                    if (isInfinite) {
                        const equipment = dataManager.getEquipment();
                        const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};
                        const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                        const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                        const limitResult = this.calculateMaterialLimit(
                            actionDetails,
                            inventoryLookup,
                            artisanBonus,
                            actionObj
                        );

                        if (limitResult) {
                            materialLimit = limitResult.maxActions;
                            limitType = limitResult.limitType;
                        }
                    }

                    // Determine if truly infinite (no material limit)
                    const isTrulyInfinite = isInfinite && materialLimit === null;

                    if (isTrulyInfinite) {
                        hasInfinite = true;
                    }

                    // Calculate count for finite actions or material-limited infinite actions
                    let count = 0;
                    if (!isInfinite) {
                        count = actionObj.maxCount - actionObj.currentCount;
                    } else if (materialLimit !== null) {
                        count = materialLimit;
                    }

                    // Calculate total time for this action
                    let totalTime;
                    let actionTimeSeconds = 0; // Time spent on this action (for profit calculation)
                    let baseActionsNeeded = 0; // Time-consuming actions for time calculation
                    if (isTrulyInfinite) {
                        totalTime = Infinity;
                    } else {
                        // Calculate time-consuming actions needed
                        const avgActionsPerBaseAction = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);
                        baseActionsNeeded = Math.ceil(count / avgActionsPerBaseAction);
                        totalTime = baseActionsNeeded * actionTime;
                        accumulatedTime += totalTime;
                        actionTimeSeconds = totalTime;
                    }

                    // Store action for profit calculation (done async after UI renders)
                    if (actionTimeSeconds > 0 && !isTrulyInfinite) {
                        actionsToCalculate.push({
                            actionHrid: actionObj.actionHrid,
                            timeSeconds: actionTimeSeconds,
                            count: count,
                            baseActionsNeeded: baseActionsNeeded,
                            divIndex: divIndex, // Store index to match back to DOM element
                        });
                    }

                    // Format completion time
                    let completionText = '';
                    if (!hasInfinite && !isTrulyInfinite) {
                        const completionDate = new Date();
                        completionDate.setSeconds(completionDate.getSeconds() + accumulatedTime);

                        const hours = String(completionDate.getHours()).padStart(2, '0');
                        const minutes = String(completionDate.getMinutes()).padStart(2, '0');
                        const seconds = String(completionDate.getSeconds()).padStart(2, '0');

                        completionText = ` Complete at ${hours}:${minutes}:${seconds}`;
                    }

                    // Create time display element
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'mwi-queue-action-time';
                    timeDiv.style.cssText = `
                    color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                    font-size: 0.85em;
                    margin-top: 2px;
                `;

                    if (isTrulyInfinite) {
                        timeDiv.textContent = '[∞]';
                    } else if (isInfinite && materialLimit !== null) {
                        // Material-limited infinite action
                        let limitLabel = '';
                        if (limitType === 'gold') {
                            limitLabel = 'gold';
                        } else if (limitType && limitType.startsWith('material:')) {
                            limitLabel = 'mat';
                        } else if (limitType && limitType.startsWith('upgrade:')) {
                            limitLabel = 'upgrade';
                        } else if (limitType === 'alchemy_item') {
                            limitLabel = 'item';
                        } else {
                            limitLabel = 'max';
                        }
                        const timeStr = formatters_js.timeReadable(totalTime);
                        timeDiv.textContent = `[${timeStr} · ${limitLabel}: ${this.formatLargeNumber(materialLimit)}]${completionText}`;
                    } else {
                        const timeStr = formatters_js.timeReadable(totalTime);
                        timeDiv.textContent = `[${timeStr}]${completionText}`;
                    }

                    // Find the actionText container and append inside it
                    const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
                    if (actionTextContainer) {
                        actionTextContainer.appendChild(timeDiv);
                    } else {
                        // Fallback: append to action div
                        actionDiv.appendChild(timeDiv);
                    }

                    // Create empty profit div for this action (will be populated asynchronously)
                    if (!isTrulyInfinite && actionTimeSeconds > 0) {
                        const profitDiv = document.createElement('div');
                        profitDiv.className = 'mwi-queue-action-profit';
                        profitDiv.dataset.divIndex = divIndex;
                        profitDiv.style.cssText = `
                        color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                        font-size: 0.85em;
                        margin-top: 2px;
                    `;
                        // Leave empty - will be filled by async calculation
                        profitDiv.textContent = '';

                        if (actionTextContainer) {
                            actionTextContainer.appendChild(profitDiv);
                        } else {
                            actionDiv.appendChild(profitDiv);
                        }
                    }
                }

                // Add total time at bottom (includes current action + all queued)
                const totalDiv = document.createElement('div');
                totalDiv.id = 'mwi-queue-total-time';
                totalDiv.style.cssText = `
                color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});
                font-weight: bold;
                margin-top: 12px;
                padding: 8px;
                border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
                text-align: center;
            `;

                // Build total time text
                let totalText = '';
                if (hasInfinite) {
                    // Show finite time first, then add infinity indicator
                    if (accumulatedTime > 0) {
                        totalText = `Total time: ${formatters_js.timeReadable(accumulatedTime)} + [∞]`;
                    } else {
                        totalText = 'Total time: [∞]';
                    }
                } else {
                    totalText = `Total time: ${formatters_js.timeReadable(accumulatedTime)}`;
                }

                totalDiv.innerHTML = totalText;

                // Insert after queue menu
                queueMenu.insertAdjacentElement('afterend', totalDiv);

                // Calculate profit asynchronously (non-blocking)
                if (actionsToCalculate.length > 0 && marketAPI.isLoaded()) {
                    // Async will handle observer reconnection after updates complete
                    shouldReconnectObserver = false;
                    this.calculateAndDisplayTotalProfit(totalDiv, actionsToCalculate, totalText, queueMenu);
                }
            } catch (error) {
                console.error('[MWI Tools] Error injecting queue times:', error);
            } finally {
                // Reconnect observer only if async didn't take over
                if (shouldReconnectObserver) {
                    this.setupQueueMenuObserver(queueMenu);
                }
            }
        }

        /**
         * Calculate and display total profit asynchronously (non-blocking)
         * @param {HTMLElement} totalDiv - The total display div element
         * @param {Array} actionsToCalculate - Array of {actionHrid, timeSeconds, count, baseActionsNeeded, divIndex} objects
         * @param {string} baseText - Base text (time) to prepend
         * @param {HTMLElement} queueMenu - Queue menu element to reconnect observer after updates
         */
        async calculateAndDisplayTotalProfit(totalDiv, actionsToCalculate, baseText, queueMenu) {
            // Generate unique ID for this calculation to prevent race conditions
            const calculationId = Date.now() + Math.random();
            this.activeProfitCalculationId = calculationId;

            try {
                let totalProfit = 0;
                let hasProfitData = false;

                // Create all profit calculation promises at once (parallel execution)
                const profitPromises = actionsToCalculate.map(
                    (action) =>
                        Promise.race([
                            this.calculateProfitForAction(action),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500)),
                        ]).catch(() => null) // Convert rejections to null
                );

                // Wait for all calculations to complete in parallel
                const results = await Promise.allSettled(profitPromises);

                // Check if this calculation is still valid (character might have switched)
                if (this.activeProfitCalculationId !== calculationId) {
                    return;
                }

                // Aggregate results and update individual action profit displays
                results.forEach((result, index) => {
                    const actionProfit = result.status === 'fulfilled' && result.value !== null ? result.value : null;

                    if (actionProfit !== null) {
                        totalProfit += actionProfit;
                        hasProfitData = true;

                        // Update individual action's profit display
                        const action = actionsToCalculate[index];
                        if (action.divIndex !== undefined) {
                            const profitDiv = document.querySelector(
                                `.mwi-queue-action-profit[data-div-index="${action.divIndex}"]`
                            );
                            if (profitDiv) {
                                const profitColor =
                                    actionProfit >= 0
                                        ? config.getSettingValue('color_profit', '#4ade80')
                                        : config.getSettingValue('color_loss', '#f87171');
                                const profitSign = actionProfit >= 0 ? '+' : '';
                                profitDiv.innerHTML = `Profit: <span style="color: ${profitColor};">${profitSign}${formatters_js.formatWithSeparator(Math.round(actionProfit))}</span>`;
                            }
                        }
                    }
                });

                // Update display with value
                if (hasProfitData) {
                    // Get value mode setting to determine label and color
                    const valueMode = config.getSettingValue('actionQueue_valueMode', 'profit');
                    const isEstimatedValue = valueMode === 'estimated_value';

                    // Estimated value is always positive (revenue), so always use profit color
                    // Profit can be negative, so use appropriate color
                    const valueColor =
                        isEstimatedValue || totalProfit >= 0
                            ? config.getSettingValue('color_profit', '#4ade80')
                            : config.getSettingValue('color_loss', '#f87171');
                    const valueSign = totalProfit >= 0 ? '+' : '';
                    const valueLabel = isEstimatedValue ? 'Estimated value' : 'Total profit';
                    const valueText = `<br>${valueLabel}: <span style="color: ${valueColor};">${valueSign}${formatters_js.formatWithSeparator(Math.round(totalProfit))}</span>`;
                    totalDiv.innerHTML = baseText + valueText;
                }
            } catch (error) {
                console.warn('[Action Time Display] Error calculating total profit:', error);
            } finally {
                // CRITICAL: Reconnect mutation observer after ALL DOM updates are complete
                // This prevents infinite loop by ensuring observer only reconnects once all profit divs are updated
                this.setupQueueMenuObserver(queueMenu);
            }
        }

        /**
         * Calculate profit or estimated value for a single action based on action count
         * @param {Object} action - Action object with {actionHrid, timeSeconds, count, baseActionsNeeded}
         * @returns {Promise<number|null>} Total value (profit or revenue) or null if unavailable
         */
        async calculateProfitForAction(action) {
            const actionDetails = dataManager.getActionDetails(action.actionHrid);
            if (!actionDetails) {
                return null;
            }

            const valueMode = config.getSettingValue('actionQueue_valueMode', 'profit');

            // Get profit data (already has profitPerAction calculated)
            let profitData = null;
            const gatheringProfit = await calculateGatheringProfit(action.actionHrid);
            if (gatheringProfit) {
                profitData = gatheringProfit;
            } else if (actionDetails.outputItems?.[0]?.itemHrid) {
                profitData = await profitCalculator.calculateProfit(actionDetails.outputItems[0].itemHrid);
            }

            if (!profitData) {
                return null;
            }

            const actionsCount = action.count ?? 0;
            if (!actionsCount) {
                return 0;
            }

            if (typeof profitData.actionsPerHour !== 'number') {
                return null;
            }

            if (gatheringProfit) {
                const totals = profitHelpers_js.calculateGatheringActionTotalsFromBase({
                    actionsCount,
                    actionsPerHour: profitData.actionsPerHour,
                    baseOutputs: profitData.baseOutputs,
                    bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
                    processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
                    gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
                    drinkCostPerHour: profitData.drinkCostPerHour,
                    efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
                });
                return valueMode === 'estimated_value' ? totals.totalRevenue : totals.totalProfit;
            }

            const totals = profitHelpers_js.calculateProductionActionTotalsFromBase({
                actionsCount,
                actionsPerHour: profitData.actionsPerHour,
                outputAmount: profitData.outputAmount || 1,
                outputPrice: profitData.outputPrice,
                gourmetBonus: profitData.gourmetBonus || 0,
                bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
                materialCosts: profitData.materialCosts,
                totalTeaCostPerHour: profitData.totalTeaCostPerHour,
                efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
            });

            return valueMode === 'estimated_value' ? totals.totalRevenue : totals.totalProfit;
        }

        /**
         * Disable the action time display (cleanup)
         */
        disable() {
            this.cleanupRegistry.cleanupAll();
            this.displayElement = null;
            this.updateTimer = null;
            this.unregisterQueueObserver = null;
            this.actionNameObserver = null;
            this.queueMenuObserver = null;
            this.characterInitHandler = null;
            this.waitForPanelTimeout = null;
            this.activeProfitCalculationId = null;
            this.isInitialized = false;
        }
    }

    const actionTimeDisplay = new ActionTimeDisplay();

    /**
     * Quick Input Buttons Module
     *
     * Adds quick action buttons (10, 100, 1000, Max) to action panels
     * for fast queue input without manual typing.
     *
     * Features:
     * - Preset buttons: 10, 100, 1000
     * - Max button (fills to maximum inventory amount)
     * - Works on all action panels (gathering, production, combat)
     * - Uses React's internal _valueTracker for proper state updates
     * - Auto-detects input fields and injects buttons
     */


    /**
     * QuickInputButtons class manages quick input button injection
     */
    class QuickInputButtons {
        constructor() {
            this.isInitialized = false;
            this.unregisterObserver = null;
            this.presetHours = [0.5, 1, 2, 3, 4, 5, 6, 10, 12, 24];
            this.presetValues = [10, 100, 1000];
            this.cleanupRegistry = cleanupRegistry_js.createCleanupRegistry();
        }

        /**
         * Initialize the quick input buttons feature
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            // Start observing for action panels
            this.startObserving();
            this.isInitialized = true;
        }

        /**
         * Start observing for action panels using centralized observer
         */
        startObserving() {
            // Register with centralized DOM observer
            this.unregisterObserver = domObserver.onClass(
                'QuickInputButtons',
                'SkillActionDetail_skillActionDetail',
                (panel) => {
                    this.injectButtons(panel);
                }
            );

            this.cleanupRegistry.registerCleanup(() => {
                if (this.unregisterObserver) {
                    this.unregisterObserver();
                    this.unregisterObserver = null;
                }
            });

            // Check for existing action panels that may already be open
            const existingPanels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');
            existingPanels.forEach((panel) => {
                this.injectButtons(panel);
            });
        }

        /**
         * Inject quick input buttons into action panel
         * @param {HTMLElement} panel - Action panel element
         */
        injectButtons(panel) {
            try {
                // Check if already injected
                if (panel.querySelector('.mwi-collapsible-section')) {
                    return;
                }

                // Find the number input field first to skip panels that don't have queue inputs
                // (Enhancing, Alchemy, etc.)
                let numberInput = panel.querySelector('input[type="number"]');
                if (!numberInput) {
                    // Try finding input within maxActionCountInput container
                    const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
                    if (inputContainer) {
                        numberInput = inputContainer.querySelector('input');
                    }
                }
                if (!numberInput) {
                    // This is a panel type that doesn't have queue inputs (Enhancing, Alchemy, etc.)
                    // Skip silently - not an error, just not applicable
                    return;
                }

                // Cache game data once for all method calls
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    console.warn('[Quick Input Buttons] No game data available');
                    return;
                }

                // Get action details for time-based calculations
                const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
                if (!actionNameElement) {
                    console.warn('[Quick Input Buttons] No action name element found');
                    return;
                }

                const actionName = actionNameElement.textContent.trim();
                const actionDetails = this.getActionDetailsByName(actionName, gameData);
                if (!actionDetails) {
                    console.warn('[Quick Input Buttons] No action details found for:', actionName);
                    return;
                }

                // Check if this action has normal XP gain (skip speed section for combat)
                const experienceGain = actionDetails.experienceGain;
                const hasNormalXP = experienceGain && experienceGain.skillHrid && experienceGain.value > 0;

                // Calculate action duration and efficiency
                const { actionTime, totalEfficiency, efficiencyBreakdown } = this.calculateActionMetrics(
                    actionDetails,
                    gameData
                );
                const efficiencyMultiplier = 1 + totalEfficiency / 100;

                // Find the container to insert after (same as original MWI Tools)
                const inputContainer = numberInput.parentNode.parentNode.parentNode;
                if (!inputContainer) {
                    return;
                }

                // Get equipment details for display
                const equipment = dataManager.getEquipment();
                const itemDetailMap = gameData.itemDetailMap || {};

                // Calculate speed breakdown
                const baseTime = actionDetails.baseTimeCost / 1e9;
                const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);
                const personalSpeedBonus = dataManager.getPersonalBuffFlatBoost(
                    actionDetails.type,
                    '/buff_types/action_speed'
                );
                const speedBonus = equipmentSpeedBonus + personalSpeedBonus;

                let speedSection = null;

                if (hasNormalXP) {
                    const speedContent = document.createElement('div');
                    speedContent.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

                    const speedLines = [];

                    // Check if task speed applies (need to calculate before display)
                    const isTaskAction = actionDetails.hrid && dataManager.isTaskAction(actionDetails.hrid);
                    const taskSpeedBonus = isTaskAction ? dataManager.getTaskSpeedBonus() : 0;

                    // Calculate intermediate time (after equipment speed, before task speed)
                    const timeAfterEquipment = baseTime / (1 + speedBonus);

                    speedLines.push(`Base: ${baseTime.toFixed(2)}s → ${timeAfterEquipment.toFixed(2)}s`);
                    if (speedBonus > 0) {
                        speedLines.push(
                            `Speed: +${formatters_js.formatPercentage(speedBonus, 1)} | ${profitHelpers_js.calculateActionsPerHour(timeAfterEquipment).toFixed(0)}/hr`
                        );
                    } else {
                        speedLines.push(`${profitHelpers_js.calculateActionsPerHour(timeAfterEquipment).toFixed(0)}/hr`);
                    }

                    // Add speed breakdown
                    const speedBreakdown = this.calculateSpeedBreakdown(actionDetails, equipment, itemDetailMap);
                    if (speedBreakdown.total > 0) {
                        // Equipment and tools (combined from debugEquipmentSpeedBonuses)
                        for (const item of speedBreakdown.equipmentAndTools) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            const detailText =
                                item.enhancementBonus > 0
                                    ? ` (${formatters_js.formatPercentage(item.baseBonus, 1)} + ${formatters_js.formatPercentage(item.enhancementBonus * item.enhancementLevel, 1)})`
                                    : '';
                            speedLines.push(
                                `  - ${item.itemName}${enhText}: +${formatters_js.formatPercentage(item.scaledBonus, 1)}${detailText}`
                            );
                        }

                        // Consumables
                        for (const item of speedBreakdown.consumables) {
                            const detailText =
                                item.drinkConcentration > 0
                                    ? ` (${item.baseSpeed.toFixed(1)}% × ${(1 + item.drinkConcentration / 100).toFixed(2)})`
                                    : '';
                            speedLines.push(`  - ${item.name}: +${item.speed.toFixed(1)}%${detailText}`);
                        }

                        // Personal buff (Seal of Action Speed)
                        if (personalSpeedBonus > 0) {
                            speedLines.push(`  - Seal of Action Speed: +${formatters_js.formatPercentage(personalSpeedBonus, 1)}`);
                        }
                    }

                    // Task Speed section (multiplicative, separate from equipment speed)
                    if (isTaskAction && taskSpeedBonus > 0) {
                        speedLines.push(''); // Empty line separator
                        speedLines.push(
                            `<span style="font-weight: 500;">Task Speed (multiplicative): +${taskSpeedBonus.toFixed(1)}%</span>`
                        );
                        speedLines.push(
                            `${timeAfterEquipment.toFixed(2)}s → ${actionTime.toFixed(2)}s | ${profitHelpers_js.calculateActionsPerHour(actionTime).toFixed(0)}/hr`
                        );

                        // Find equipped task badge for details
                        const trinketSlot = equipment.get('/item_locations/trinket');
                        if (trinketSlot && trinketSlot.itemHrid) {
                            const itemDetails = itemDetailMap[trinketSlot.itemHrid];
                            if (itemDetails) {
                                const enhText = trinketSlot.enhancementLevel > 0 ? ` +${trinketSlot.enhancementLevel}` : '';

                                // Calculate breakdown
                                const baseTaskSpeed = itemDetails.equipmentDetail?.noncombatStats?.taskSpeed || 0;
                                const enhancementBonus =
                                    itemDetails.equipmentDetail?.noncombatEnhancementBonuses?.taskSpeed || 0;
                                const enhancementLevel = trinketSlot.enhancementLevel || 0;

                                const detailText =
                                    enhancementBonus > 0
                                        ? ` (${(baseTaskSpeed * 100).toFixed(1)}% + ${(enhancementBonus * enhancementLevel * 100).toFixed(1)}%)`
                                        : '';

                                speedLines.push(
                                    `  - ${itemDetails.name}${enhText}: +${taskSpeedBonus.toFixed(1)}%${detailText}`
                                );
                            }
                        }
                    }

                    // Add Efficiency breakdown
                    speedLines.push(''); // Empty line
                    speedLines.push(
                        `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Efficiency: +${totalEfficiency.toFixed(1)}% → Output: ×${efficiencyMultiplier.toFixed(2)} (${Math.round(profitHelpers_js.calculateActionsPerHour(actionTime) * efficiencyMultiplier)}/hr)</span>`
                    );

                    // Detailed efficiency breakdown
                    if (
                        efficiencyBreakdown.levelEfficiency > 0 ||
                        (efficiencyBreakdown.actionLevelBreakdown && efficiencyBreakdown.actionLevelBreakdown.length > 0)
                    ) {
                        // Calculate raw level delta (before any Action Level bonuses)
                        const rawLevelDelta = efficiencyBreakdown.skillLevel - efficiencyBreakdown.baseRequirement;

                        // Show final level efficiency
                        speedLines.push(`  - Level: +${efficiencyBreakdown.levelEfficiency.toFixed(1)}%`);

                        // Show raw level delta (what you'd get without Action Level bonuses)
                        speedLines.push(
                            `    - Raw level delta: +${rawLevelDelta.toFixed(1)}% (${efficiencyBreakdown.skillLevel} - ${efficiencyBreakdown.baseRequirement} base requirement)`
                        );

                        // Show Action Level bonus teas that reduce level efficiency
                        if (
                            efficiencyBreakdown.actionLevelBreakdown &&
                            efficiencyBreakdown.actionLevelBreakdown.length > 0
                        ) {
                            for (const tea of efficiencyBreakdown.actionLevelBreakdown) {
                                // Calculate impact: base tea effect reduces efficiency
                                const baseTeaImpact = -tea.baseActionLevel;
                                speedLines.push(
                                    `    - ${tea.name} impact: ${baseTeaImpact.toFixed(1)}% (raises requirement)`
                                );

                                // Show DC contribution as additional reduction if > 0
                                if (tea.dcContribution > 0) {
                                    const dcImpact = -tea.dcContribution;
                                    speedLines.push(`      - Drink Concentration: ${dcImpact.toFixed(1)}%`);
                                }
                            }
                        }
                    }
                    if (efficiencyBreakdown.houseEfficiency > 0) {
                        // Get house room name
                        const houseRoomName = this.getHouseRoomName(actionDetails.type);
                        speedLines.push(
                            `  - House: +${efficiencyBreakdown.houseEfficiency.toFixed(1)}% (${houseRoomName})`
                        );
                    }
                    if (efficiencyBreakdown.equipmentEfficiency > 0) {
                        speedLines.push(`  - Equipment: +${efficiencyBreakdown.equipmentEfficiency.toFixed(1)}%`);
                    }
                    if (efficiencyBreakdown.achievementEfficiency > 0) {
                        speedLines.push(`  - Achievement: +${efficiencyBreakdown.achievementEfficiency.toFixed(1)}%`);
                    }
                    // Break out individual teas - show BASE efficiency on main line, DC as sub-line
                    if (efficiencyBreakdown.teaBreakdown && efficiencyBreakdown.teaBreakdown.length > 0) {
                        for (const tea of efficiencyBreakdown.teaBreakdown) {
                            // Show BASE efficiency (without DC scaling) on main line
                            speedLines.push(`  - ${tea.name}: +${tea.baseEfficiency.toFixed(1)}%`);
                            // Show DC contribution as sub-line if > 0
                            if (tea.dcContribution > 0) {
                                speedLines.push(`    - Drink Concentration: +${tea.dcContribution.toFixed(1)}%`);
                            }
                        }
                    }
                    if (efficiencyBreakdown.communityEfficiency > 0) {
                        const communityBuffLevel = dataManager.getCommunityBuffLevel(
                            '/community_buff_types/production_efficiency'
                        );
                        speedLines.push(
                            `  - Community: +${efficiencyBreakdown.communityEfficiency.toFixed(1)}% (Production Efficiency T${communityBuffLevel})`
                        );
                    }
                    if (efficiencyBreakdown.personalEfficiency > 0) {
                        speedLines.push(`  - Seal: +${efficiencyBreakdown.personalEfficiency.toFixed(1)}%`);
                    }

                    // Total time (dynamic)
                    const totalTimeLine = document.createElement('div');
                    totalTimeLine.style.cssText = `
                color: var(--text-color-main, ${config.COLOR_INFO});
                font-weight: 500;
                margin-top: 4px;
            `;

                    const updateTotalTime = () => {
                        const inputValue = numberInput.value;

                        if (inputValue === '∞') {
                            totalTimeLine.textContent = 'Total time: ∞';
                            return;
                        }

                        const queueCount = parseInt(inputValue) || 0;
                        if (queueCount > 0) {
                            // Input is number of ACTIONS to complete
                            // With efficiency, queued actions complete more quickly
                            // Calculate time-consuming actions needed
                            const baseActionsNeeded = Math.ceil(queueCount / efficiencyMultiplier);
                            const totalSeconds = baseActionsNeeded * actionTime;
                            totalTimeLine.textContent = `Total time: ${formatters_js.timeReadable(totalSeconds)}`;
                        } else {
                            totalTimeLine.textContent = 'Total time: 0s';
                        }
                    };

                    speedLines.push(''); // Empty line before total time
                    speedContent.innerHTML = speedLines.join('<br>');
                    speedContent.appendChild(totalTimeLine);

                    // Initial update
                    updateTotalTime();

                    // Watch for input changes
                    let inputObserverCleanup = domObserverHelpers_js.createMutationWatcher(
                        numberInput,
                        () => {
                            updateTotalTime();
                        },
                        {
                            attributes: true,
                            attributeFilter: ['value'],
                        }
                    );
                    this.cleanupRegistry.registerCleanup(() => {
                        if (inputObserverCleanup) {
                            inputObserverCleanup();
                            inputObserverCleanup = null;
                        }
                    });

                    const updateOnInput = () => updateTotalTime();
                    const updateOnChange = () => updateTotalTime();
                    const updateOnClick = () => {
                        const clickTimeout = setTimeout(updateTotalTime, 50);
                        this.cleanupRegistry.registerTimeout(clickTimeout);
                    };

                    numberInput.addEventListener('input', updateOnInput);
                    numberInput.addEventListener('change', updateOnChange);
                    panel.addEventListener('click', updateOnClick);

                    this.cleanupRegistry.registerListener(numberInput, 'input', updateOnInput);
                    this.cleanupRegistry.registerListener(numberInput, 'change', updateOnChange);
                    this.cleanupRegistry.registerListener(panel, 'click', updateOnClick);

                    // Create initial summary for Action Speed & Time
                    const actionsPerHourWithEfficiency = Math.round(
                        profitHelpers_js.calculateEffectiveActionsPerHour(profitHelpers_js.calculateActionsPerHour(actionTime), efficiencyMultiplier)
                    );
                    const initialSummary = `${actionsPerHourWithEfficiency}/hr | Total time: 0s`;

                    speedSection = uiComponents_js.createCollapsibleSection(
                        '⏱',
                        'Action Speed & Time',
                        initialSummary,
                        speedContent,
                        false // Collapsed by default
                    );

                    // Get the summary div to update it dynamically
                    const speedSummaryDiv = speedSection.querySelector('.mwi-section-header + div');

                    // Enhanced updateTotalTime to also update the summary
                    const originalUpdateTotalTime = updateTotalTime;
                    const enhancedUpdateTotalTime = () => {
                        originalUpdateTotalTime();

                        // Update summary when collapsed
                        if (speedSummaryDiv) {
                            const inputValue = numberInput.value;
                            if (inputValue === '∞') {
                                speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: ∞`;
                            } else {
                                const queueCount = parseInt(inputValue) || 0;
                                if (queueCount > 0) {
                                    const baseActionsNeeded = Math.ceil(queueCount / efficiencyMultiplier);
                                    const totalSeconds = baseActionsNeeded * actionTime;
                                    speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: ${formatters_js.timeReadable(totalSeconds)}`;
                                } else {
                                    speedSummaryDiv.textContent = `${actionsPerHourWithEfficiency}/hr | Total time: 0s`;
                                }
                            }
                        }
                    };

                    // Replace all updateTotalTime calls with enhanced version
                    if (inputObserverCleanup) {
                        inputObserverCleanup();
                        inputObserverCleanup = null;
                    }

                    const newInputObserverCleanup = domObserverHelpers_js.createMutationWatcher(
                        numberInput,
                        () => {
                            enhancedUpdateTotalTime();
                        },
                        {
                            attributes: true,
                            attributeFilter: ['value'],
                        }
                    );
                    this.cleanupRegistry.registerCleanup(() => {
                        newInputObserverCleanup();
                    });

                    numberInput.removeEventListener('input', updateOnInput);
                    numberInput.removeEventListener('change', updateOnChange);
                    panel.removeEventListener('click', updateOnClick);

                    const updateOnInputEnhanced = () => enhancedUpdateTotalTime();
                    const updateOnChangeEnhanced = () => enhancedUpdateTotalTime();
                    const updateOnClickEnhanced = () => {
                        const clickTimeout = setTimeout(enhancedUpdateTotalTime, 50);
                        this.cleanupRegistry.registerTimeout(clickTimeout);
                    };

                    numberInput.addEventListener('input', updateOnInputEnhanced);
                    numberInput.addEventListener('change', updateOnChangeEnhanced);
                    panel.addEventListener('click', updateOnClickEnhanced);

                    this.cleanupRegistry.registerListener(numberInput, 'input', updateOnInputEnhanced);
                    this.cleanupRegistry.registerListener(numberInput, 'change', updateOnChangeEnhanced);
                    this.cleanupRegistry.registerListener(panel, 'click', updateOnClickEnhanced);

                    // Initial update with enhanced version
                    enhancedUpdateTotalTime();
                } // End hasNormalXP check - speedSection only created for non-combat

                const levelProgressSection = this.createLevelProgressSection(
                    actionDetails,
                    actionTime,
                    gameData,
                    numberInput
                );

                let queueContent = null;

                if (hasNormalXP) {
                    queueContent = document.createElement('div');
                    queueContent.style.cssText = `
                    color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                    font-size: 0.9em;
                    margin-top: 8px;
                    margin-bottom: 8px;
                `;

                    // FIRST ROW: Time-based buttons (hours)
                    queueContent.appendChild(document.createTextNode('Do '));

                    this.presetHours.forEach((hours) => {
                        const button = this.createButton(hours === 0.5 ? '0.5' : hours.toString(), () => {
                            // How many actions fit in X hours?
                            // With efficiency, queued actions complete more quickly
                            // Time (seconds) = hours × 3600
                            // Time-consuming actions = Time / actionTime
                            // Queue count (actions) = Time-consuming actions × efficiencyMultiplier
                            // Round to whole number (input doesn't accept decimals)
                            const totalSeconds = hours * 60 * 60;
                            const baseActions = totalSeconds / actionTime;
                            const actionCount = Math.round(baseActions * efficiencyMultiplier);
                            this.setInputValue(numberInput, actionCount);
                        });
                        queueContent.appendChild(button);
                    });

                    queueContent.appendChild(document.createTextNode(' hours'));
                    queueContent.appendChild(document.createElement('div')); // Line break

                    // SECOND ROW: Count-based buttons (times)
                    queueContent.appendChild(document.createTextNode('Do '));

                    this.presetValues.forEach((value) => {
                        const button = this.createButton(value.toLocaleString(), () => {
                            this.setInputValue(numberInput, value);
                        });
                        queueContent.appendChild(button);
                    });

                    const maxButton = this.createButton('Max', () => {
                        const maxValue = this.calculateMaxValue(panel, actionDetails, gameData);
                        // Handle both infinity symbol and numeric values
                        if (maxValue === '∞' || maxValue > 0) {
                            this.setInputValue(numberInput, maxValue);
                        }
                    });
                    queueContent.appendChild(maxButton);

                    queueContent.appendChild(document.createTextNode(' times'));
                } // End hasNormalXP check - queueContent only created for non-combat

                // Insert sections into DOM
                const hideActionStats = config.getSetting('actionPanel_hideActionStats');
                if (queueContent) {
                    // Non-combat: Insert queueContent first
                    inputContainer.insertAdjacentElement('afterend', queueContent);

                    if (speedSection && !hideActionStats) {
                        queueContent.insertAdjacentElement('afterend', speedSection);
                        if (levelProgressSection) {
                            speedSection.insertAdjacentElement('afterend', levelProgressSection);
                        }
                    } else if (levelProgressSection && !hideActionStats) {
                        queueContent.insertAdjacentElement('afterend', levelProgressSection);
                    }
                } else if (levelProgressSection && !hideActionStats) {
                    // Combat: Insert levelProgressSection directly after inputContainer
                    inputContainer.insertAdjacentElement('afterend', levelProgressSection);
                }
            } catch (error) {
                console.error('[Toolasha] Error injecting quick input buttons:', error);
            }
        }

        /**
         * Disable quick input buttons and cleanup observers/listeners
         */
        disable() {
            this.cleanupRegistry.cleanupAll();
            document.querySelectorAll('.mwi-collapsible-section').forEach((section) => section.remove());
            document.querySelectorAll('.mwi-quick-input-btn').forEach((button) => button.remove());
            this.isInitialized = false;
        }

        /**
         * Get action details by name
         * @param {string} actionName - Display name of the action
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {Object|null} Action details or null if not found
         */
        getActionDetailsByName(actionName, gameData) {
            const actionDetailMap = gameData?.actionDetailMap;
            if (!actionDetailMap) {
                return null;
            }

            // Find action by matching name
            for (const [hrid, details] of Object.entries(actionDetailMap)) {
                if (details.name === actionName) {
                    // Include hrid in returned object for task detection
                    return { ...details, hrid };
                }
            }

            return null;
        }

        /**
         * Calculate action time and efficiency for current character state
         * Uses shared calculator with community buffs and detailed breakdown
         * @param {Object} actionDetails - Action details from game data
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {Object} {actionTime, totalEfficiency, efficiencyBreakdown}
         */
        calculateActionMetrics(actionDetails, gameData) {
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = gameData?.itemDetailMap || {};

            // Use shared calculator with community buffs and breakdown
            const stats = actionCalculator_js.calculateActionStats(actionDetails, {
                skills,
                equipment,
                itemDetailMap,
                actionHrid: actionDetails.hrid, // Pass action HRID for task detection
                includeCommunityBuff: true,
                includeBreakdown: true,
                floorActionLevel: true,
            });

            if (!stats) {
                // Fallback values
                return {
                    actionTime: 1,
                    totalEfficiency: 0,
                    efficiencyBreakdown: {
                        levelEfficiency: 0,
                        houseEfficiency: 0,
                        equipmentEfficiency: 0,
                        teaEfficiency: 0,
                        teaBreakdown: [],
                        communityEfficiency: 0,
                        achievementEfficiency: 0,
                        skillLevel: 1,
                        baseRequirement: 1,
                        actionLevelBonus: 0,
                        actionLevelBreakdown: [],
                        effectiveRequirement: 1,
                    },
                };
            }

            return stats;
        }

        /**
         * Get house room name for an action type
         * @param {string} actionType - Action type HRID
         * @returns {string} House room name with level
         */
        getHouseRoomName(actionType) {
            const houseRooms = dataManager.getHouseRooms();
            const roomMapping = {
                '/action_types/cheesesmithing': '/house_rooms/forge',
                '/action_types/cooking': '/house_rooms/kitchen',
                '/action_types/crafting': '/house_rooms/workshop',
                '/action_types/foraging': '/house_rooms/garden',
                '/action_types/milking': '/house_rooms/dairy_barn',
                '/action_types/tailoring': '/house_rooms/sewing_parlor',
                '/action_types/woodcutting': '/house_rooms/log_shed',
                '/action_types/brewing': '/house_rooms/brewery',
            };

            const roomHrid = roomMapping[actionType];
            if (!roomHrid) return 'Unknown Room';

            const room = houseRooms.get(roomHrid);
            const roomName = roomHrid
                .split('/')
                .pop()
                .split('_')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            const level = room?.level || 0;

            return `${roomName} level ${level}`;
        }

        /**
         * Calculate speed breakdown from all sources
         * @param {Object} actionData - Action data
         * @param {Map} equipment - Equipment map
         * @param {Object} itemDetailMap - Item detail map from game data
         * @returns {Object} Speed breakdown by source
         */
        calculateSpeedBreakdown(actionData, equipment, itemDetailMap) {
            const breakdown = {
                equipmentAndTools: [],
                consumables: [],
                total: 0,
            };

            // Get all equipment speed bonuses using the existing parser
            const allSpeedBonuses = equipmentParser_js.debugEquipmentSpeedBonuses(equipment, itemDetailMap);

            // Determine which speed types are relevant for this action
            const actionType = actionData.type;
            const skillName = actionType.replace('/action_types/', '');
            const skillSpecificSpeed = skillName + 'Speed';

            // Filter for relevant speeds (skill-specific or generic skillingSpeed)
            const relevantSpeeds = allSpeedBonuses.filter((item) => {
                return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
            });

            // Add to breakdown
            for (const item of relevantSpeeds) {
                breakdown.equipmentAndTools.push(item);
                breakdown.total += item.scaledBonus * 100; // Convert to percentage
            }

            // Consumables (teas)
            const consumableSpeed = this.getConsumableSpeed(actionData, equipment, itemDetailMap);
            breakdown.consumables = consumableSpeed;
            breakdown.total += consumableSpeed.reduce((sum, c) => sum + c.speed, 0);

            return breakdown;
        }

        /**
         * Get consumable speed bonuses (Enhancing Teas only)
         * @param {Object} actionData - Action data
         * @param {Map} equipment - Equipment map
         * @param {Object} itemDetailMap - Item detail map
         * @returns {Array} Consumable speed info
         */
        getConsumableSpeed(actionData, equipment, itemDetailMap) {
            const actionType = actionData.type;
            const drinkSlots = dataManager.getActionDrinkSlots(actionType);
            if (!drinkSlots || drinkSlots.length === 0) return [];

            const consumables = [];

            // Only Enhancing is relevant (all actions except combat)
            if (actionType === '/action_types/combat') {
                return consumables;
            }

            // Get drink concentration using existing utility
            const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);

            // Check drink slots for Enhancing Teas
            const enhancingTeas = {
                '/items/enhancing_tea': { name: 'Enhancing Tea', baseSpeed: 0.02 },
                '/items/super_enhancing_tea': { name: 'Super Enhancing Tea', baseSpeed: 0.04 },
                '/items/ultra_enhancing_tea': { name: 'Ultra Enhancing Tea', baseSpeed: 0.06 },
            };

            for (const drink of drinkSlots) {
                if (!drink || !drink.itemHrid) continue;

                const teaInfo = enhancingTeas[drink.itemHrid];
                if (teaInfo) {
                    const scaledSpeed = teaInfo.baseSpeed * (1 + drinkConcentration);
                    consumables.push({
                        name: teaInfo.name,
                        baseSpeed: teaInfo.baseSpeed * 100,
                        drinkConcentration: drinkConcentration * 100,
                        speed: scaledSpeed * 100,
                    });
                }
            }

            return consumables;
        }

        /**
         * Create a quick input button
         * @param {string} label - Button label
         * @param {Function} onClick - Click handler
         * @returns {HTMLElement} Button element
         */
        createButton(label, onClick) {
            const button = document.createElement('button');
            button.textContent = label;
            button.className = 'mwi-quick-input-btn';
            button.style.cssText = `
            background-color: white;
            color: black;
            padding: 1px 6px;
            margin: 1px;
            border: 1px solid #ccc;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.9em;
        `;

            // Hover effect
            button.addEventListener('mouseenter', () => {
                button.style.backgroundColor = '#f0f0f0';
            });
            button.addEventListener('mouseleave', () => {
                button.style.backgroundColor = 'white';
            });

            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            });

            return button;
        }

        /**
         * Set input value using React utility
         * @param {HTMLInputElement} input - Number input element
         * @param {number} value - Value to set
         */
        setInputValue(input, value) {
            reactInput_js.setReactInputValue(input, value, { focus: true });
        }

        /**
         * Calculate maximum possible value based on inventory
         * @param {HTMLElement} panel - Action panel element
         * @param {Object} actionDetails - Action details from game data
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {number|string} Maximum value (number for production, '∞' for gathering)
         */
        calculateMaxValue(panel, actionDetails, gameData) {
            try {
                // Gathering actions (no materials needed) - return infinity symbol
                if (!actionDetails.inputItems && !actionDetails.upgradeItemHrid) {
                    return '∞';
                }

                // Production actions - calculate based on available materials
                const inventory = dataManager.getInventory();
                if (!inventory) {
                    return 0; // No inventory data available
                }

                // Get Artisan Tea reduction if active
                const equipment = dataManager.getEquipment();
                const itemDetailMap = gameData?.itemDetailMap || {};
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                let maxActions = Infinity;

                // Check upgrade item first (e.g., Crimson Staff → Azure Staff)
                if (actionDetails.upgradeItemHrid) {
                    // Upgrade recipes require base item (enhancement level 0)
                    const upgradeItem = inventory.find(
                        (item) => item.itemHrid === actionDetails.upgradeItemHrid && item.enhancementLevel === 0
                    );
                    const availableAmount = upgradeItem?.count || 0;
                    const baseRequirement = 1; // Upgrade items always require exactly 1

                    // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                    // Materials are consumed PER ACTION (including instant repeats)
                    // Efficiency gives bonus actions for FREE (no material cost)
                    const materialsPerAction = baseRequirement;

                    if (materialsPerAction > 0) {
                        const possibleActions = Math.floor(availableAmount / materialsPerAction);
                        maxActions = Math.min(maxActions, possibleActions);
                    }
                }

                // Check regular input items (materials like lumber, etc.)
                if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                    for (const input of actionDetails.inputItems) {
                        // Find ALL items with this HRID (different enhancement levels stack separately)
                        const allMatchingItems = inventory.filter((item) => item.itemHrid === input.itemHrid);

                        // Sum up counts across all enhancement levels
                        const availableAmount = allMatchingItems.reduce((total, item) => total + (item.count || 0), 0);
                        const baseRequirement = input.count;

                        // Apply Artisan reduction
                        // Materials are consumed PER ACTION (including instant repeats)
                        // Efficiency gives bonus actions for FREE (no material cost)
                        const materialsPerAction = baseRequirement * (1 - artisanBonus);

                        if (materialsPerAction > 0) {
                            const possibleActions = Math.floor(availableAmount / materialsPerAction);
                            maxActions = Math.min(maxActions, possibleActions);
                        }
                    }
                }

                // If we couldn't calculate (no materials found), return 0
                if (maxActions === Infinity) {
                    return 0;
                }

                return maxActions;
            } catch (error) {
                console.error('[Toolasha] Error calculating max value:', error);
                return 10000; // Safe fallback on error
            }
        }

        /**
         * Get character skill level for a skill type
         * @param {Array} skills - Character skills array
         * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
         * @returns {number} Skill level
         */
        getSkillLevel(skills, skillType) {
            // Map action type to skill HRID
            const skillHrid = skillType.replace('/action_types/', '/skills/');
            const skill = skills.find((s) => s.skillHrid === skillHrid);
            return skill?.level || 1;
        }

        /**
         * Get total efficiency percentage for current action
         * @param {Object} actionDetails - Action details
         * @param {Object} gameData - Game data
         * @returns {number} Total efficiency percentage
         */
        getTotalEfficiency(actionDetails, gameData) {
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = gameData?.itemDetailMap || {};

            // Calculate all efficiency components (reuse existing logic)
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);
            const baseRequirement = actionDetails.levelRequirement?.level || 1;

            const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            const actionLevelBonus = teaParser_js.parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);
            const effectiveRequirement = baseRequirement + Math.floor(actionLevelBonus);

            // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
            const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Apply tea skill level bonus to effective player level
            const effectiveLevel = skillLevel + teaSkillLevelBonus;
            const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionDetails.type);
            const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap);

            const teaBreakdown = teaParser_js.parseTeaEfficiencyBreakdown(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );
            const teaEfficiency = teaBreakdown.reduce((sum, tea) => sum + tea.efficiency, 0);

            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            const communityEfficiency = communityBuffLevel ? (0.14 + (communityBuffLevel - 1) * 0.003) * 100 : 0;

            return efficiency_js.stackAdditive(levelEfficiency, houseEfficiency, equipmentEfficiency, teaEfficiency, communityEfficiency);
        }

        /**
         * Calculate actions and time needed to reach target level
         * Accounts for progressive efficiency gains (+1% per level)
         * Efficiency reduces actions needed (each action gives more XP) but not time per action
         * @param {number} currentLevel - Current skill level
         * @param {number} currentXP - Current experience points
         * @param {number} targetLevel - Target skill level
         * @param {number} baseEfficiency - Starting efficiency percentage
         * @param {number} actionTime - Time per action in seconds
         * @param {number} xpPerAction - Modified XP per action (with multipliers)
         * @param {Object} levelExperienceTable - XP requirements per level
         * @returns {Object} {actionsNeeded, timeNeeded}
         */
        calculateMultiLevelProgress(
            currentLevel,
            currentXP,
            targetLevel,
            baseEfficiency,
            actionTime,
            xpPerAction,
            levelExperienceTable
        ) {
            let totalActions = 0;
            let totalTime = 0;

            for (let level = currentLevel; level < targetLevel; level++) {
                // Calculate XP needed for this level
                let xpNeeded;
                if (level === currentLevel) {
                    // First level: Account for current progress
                    xpNeeded = levelExperienceTable[level + 1] - currentXP;
                } else {
                    // Subsequent levels: Full level requirement
                    xpNeeded = levelExperienceTable[level + 1] - levelExperienceTable[level];
                }

                // Progressive efficiency: +1% per level gained during grind
                const levelsGained = level - currentLevel;
                const progressiveEfficiency = baseEfficiency + levelsGained;
                const efficiencyMultiplier = 1 + progressiveEfficiency / 100;

                // Calculate XP per performed action (base XP × efficiency multiplier)
                // Efficiency means each action repeats, giving more XP per performed action
                const xpPerPerformedAction = xpPerAction * efficiencyMultiplier;

                // Calculate time-consuming actions needed for this level
                const baseActionsForLevel = Math.ceil(xpNeeded / xpPerPerformedAction);

                // Convert time-consuming actions to queued actions (instant repeats count toward queue total)
                const actionsToQueue = Math.round(baseActionsForLevel * efficiencyMultiplier);
                totalActions += actionsToQueue;

                // Time is based on time-consuming actions, not instant repeats
                totalTime += baseActionsForLevel * actionTime;
            }

            return { actionsNeeded: totalActions, timeNeeded: totalTime };
        }

        /**
         * Create level progress section
         * @param {Object} actionDetails - Action details from game data
         * @param {number} actionTime - Time per action in seconds
         * @param {Object} gameData - Cached game data from dataManager
         * @param {HTMLInputElement} numberInput - Queue input element
         * @returns {HTMLElement|null} Level progress section or null if not applicable
         */
        createLevelProgressSection(actionDetails, actionTime, gameData, numberInput) {
            try {
                // Get XP information from action
                const experienceGain = actionDetails.experienceGain;
                if (!experienceGain || !experienceGain.skillHrid || experienceGain.value <= 0) {
                    return null; // No XP gain for this action
                }

                const skillHrid = experienceGain.skillHrid;
                const xpPerAction = experienceGain.value;

                // Get character skills
                const skills = dataManager.getSkills();
                if (!skills) {
                    return null;
                }

                // Find the skill
                const skill = skills.find((s) => s.skillHrid === skillHrid);
                if (!skill) {
                    return null;
                }

                // Get level experience table
                const levelExperienceTable = gameData?.levelExperienceTable;
                if (!levelExperienceTable) {
                    return null;
                }

                // Current level and XP
                const currentLevel = skill.level;
                const currentXP = skill.experience || 0;

                // XP needed for next level
                const nextLevel = currentLevel + 1;
                const xpForNextLevel = levelExperienceTable[nextLevel];

                if (!xpForNextLevel) {
                    // Max level reached
                    return null;
                }

                // Calculate progress (XP gained this level / XP needed for this level)
                const xpForCurrentLevel = levelExperienceTable[currentLevel] || 0;
                const xpGainedThisLevel = currentXP - xpForCurrentLevel;
                const xpNeededThisLevel = xpForNextLevel - xpForCurrentLevel;
                const progressPercent = (xpGainedThisLevel / xpNeededThisLevel) * 100;
                const xpNeeded = xpForNextLevel - currentXP;

                // Calculate XP multipliers and breakdown (MUST happen before calculating actions/rates)
                const xpData = experienceParser_js.calculateExperienceMultiplier(skillHrid, actionDetails.type);

                // Calculate modified XP per action (base XP × multiplier)
                const baseXP = xpPerAction;
                const modifiedXP = xpPerAction * xpData.totalMultiplier;

                // Calculate actions and time needed (using modified XP)
                const actionsNeeded = Math.ceil(xpNeeded / modifiedXP);
                const _timeNeeded = actionsNeeded * actionTime;

                // Calculate rates using shared utility (includes efficiency)
                const expData = experienceCalculator_js.calculateExpPerHour(actionDetails.hrid);
                const xpPerHour =
                    expData?.expPerHour || (actionsNeeded > 0 ? profitHelpers_js.calculateActionsPerHour(actionTime) * modifiedXP : 0);
                const xpPerDay = xpPerHour * 24;

                // Calculate daily level progress
                const _dailyLevelProgress = xpPerDay / xpNeededThisLevel;

                // Create content
                const content = document.createElement('div');
                content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

                const lines = [];

                // Current level and progress
                lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(1)}% to Level ${nextLevel}`);
                lines.push('');

                // Action details
                lines.push(
                    `XP per action: ${formatters_js.formatWithSeparator(baseXP.toFixed(1))} base → ${formatters_js.formatWithSeparator(modifiedXP.toFixed(1))} (×${xpData.totalMultiplier.toFixed(2)})`
                );

                // XP breakdown (if any bonuses exist)
                if (xpData.totalWisdom > 0 || xpData.charmExperience > 0) {
                    const totalXPBonus = xpData.totalWisdom + xpData.charmExperience;
                    lines.push(`  Total XP Bonus: +${totalXPBonus.toFixed(1)}%`);

                    // List all sources that contribute

                    // Equipment skill-specific XP (e.g., Celestial Shears foragingExperience)
                    if (xpData.charmBreakdown && xpData.charmBreakdown.length > 0) {
                        for (const item of xpData.charmBreakdown) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(1)}%`);
                        }
                    }

                    // Equipment wisdom (e.g., Necklace Of Wisdom, Philosopher's Necklace skillingExperience)
                    if (xpData.wisdomBreakdown && xpData.wisdomBreakdown.length > 0) {
                        for (const item of xpData.wisdomBreakdown) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(1)}%`);
                        }
                    }

                    // House rooms
                    if (xpData.breakdown.houseWisdom > 0) {
                        lines.push(`    • House Rooms: +${xpData.breakdown.houseWisdom.toFixed(1)}%`);
                    }

                    // Community buff
                    if (xpData.breakdown.communityWisdom > 0) {
                        lines.push(`    • Community Buff: +${xpData.breakdown.communityWisdom.toFixed(1)}%`);
                    }

                    // Tea/Coffee
                    if (xpData.breakdown.consumableWisdom > 0) {
                        lines.push(`    • Wisdom Tea: +${xpData.breakdown.consumableWisdom.toFixed(1)}%`);
                    }

                    // Achievement wisdom
                    if (xpData.breakdown.achievementWisdom > 0) {
                        lines.push(`    • Achievement: +${xpData.breakdown.achievementWisdom.toFixed(1)}%`);
                    }

                    // Personal buff (Seal of Wisdom)
                    if (xpData.breakdown.personalWisdom > 0) {
                        lines.push(`    • Seal of Wisdom: +${xpData.breakdown.personalWisdom.toFixed(1)}%`);
                    }
                }

                // Get base efficiency for this action
                const baseEfficiency = this.getTotalEfficiency(actionDetails, gameData);

                lines.push('');

                // Single level progress (always shown)
                const singleLevel = this.calculateMultiLevelProgress(
                    currentLevel,
                    currentXP,
                    nextLevel,
                    baseEfficiency,
                    actionTime,
                    modifiedXP,
                    levelExperienceTable
                );

                lines.push(
                    `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">To Level ${nextLevel}:</span>`
                );
                lines.push(`  Actions: ${formatters_js.formatWithSeparator(singleLevel.actionsNeeded)}`);
                lines.push(`  Time: ${formatters_js.timeReadable(singleLevel.timeNeeded)}`);

                lines.push('');

                // Multi-level calculator (interactive section)
                lines.push(
                    `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Target Level Calculator:</span>`
                );
                lines.push(`<div style="margin-top: 4px;">
                <span>To level </span>
                <input
                    type="number"
                    id="mwi-target-level-input"
                    value="${nextLevel}"
                    min="${nextLevel}"
                    max="200"
                    style="
                        width: 50px;
                        padding: 2px 4px;
                        background: var(--background-secondary, #2a2a2a);
                        color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});
                        border: 1px solid var(--border-color, ${config.COLOR_BORDER});
                        border-radius: 3px;
                        font-size: 0.9em;
                    "
                >
                <span>:</span>
            </div>`);

                // Dynamic result line (will be updated by JS)
                lines.push(`<div id="mwi-target-level-result" style="margin-top: 4px; margin-left: 8px;">
                ${formatters_js.formatWithSeparator(singleLevel.actionsNeeded)} actions | ${formatters_js.timeReadable(singleLevel.timeNeeded)}
            </div>`);

                lines.push('');
                lines.push(
                    `XP/hour: ${formatters_js.formatWithSeparator(Math.round(xpPerHour))} | XP/day: ${formatters_js.formatWithSeparator(Math.round(xpPerDay))}`
                );

                content.innerHTML = lines.join('<br>');

                // Set up event listeners for interactive calculator
                const targetLevelInput = content.querySelector('#mwi-target-level-input');
                const targetLevelResult = content.querySelector('#mwi-target-level-result');

                const updateTargetLevel = () => {
                    const targetLevel = parseInt(targetLevelInput.value);

                    if (targetLevel > currentLevel && targetLevel <= 200) {
                        const result = this.calculateMultiLevelProgress(
                            currentLevel,
                            currentXP,
                            targetLevel,
                            baseEfficiency,
                            actionTime,
                            modifiedXP,
                            levelExperienceTable
                        );

                        targetLevelResult.innerHTML = `
                        ${formatters_js.formatWithSeparator(result.actionsNeeded)} actions | ${formatters_js.timeReadable(result.timeNeeded)}
                    `;
                        targetLevelResult.style.color = 'var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY})';

                        // Auto-fill queue input when target level changes
                        this.setInputValue(numberInput, result.actionsNeeded);
                    } else {
                        targetLevelResult.textContent = 'Invalid level';
                        targetLevelResult.style.color = 'var(--color-error, #ff4444)';
                    }
                };

                targetLevelInput.addEventListener('input', updateTargetLevel);
                targetLevelInput.addEventListener('change', updateTargetLevel);

                // Create summary for collapsed view (time to next level)
                const summary = `${formatters_js.timeReadable(singleLevel.timeNeeded)} to Level ${nextLevel}`;

                // Create collapsible section
                return uiComponents_js.createCollapsibleSection(
                    '📈',
                    'Level Progress',
                    summary,
                    content,
                    false // Collapsed by default
                );
            } catch (error) {
                console.error('[Toolasha] Error creating level progress section:', error);
                return null;
            }
        }

        /**
         * Disable quick input buttons (cleanup)
         */
        disable() {
            // Disconnect main observer
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            // Note: inputObserver and newInputObserver are created locally in injectQuickInputButtons()
            // and attached to panels, which will be garbage collected when panels are removed.
            // They cannot be explicitly disconnected here, but this is acceptable as they're
            // short-lived observers tied to specific panel instances.

            this.isActive = false;
        }
    }

    const quickInputButtons = new QuickInputButtons();

    /**
     * Output Totals Display Module
     *
     * Shows total expected outputs below per-action outputs when user enters
     * a quantity in the action input box.
     *
     * Example:
     * - Game shows: "Outputs: 1.3 - 3.9 Flax"
     * - User enters: 100 actions
     * - Module shows: "130.0 - 390.0" below the per-action output
     */


    class OutputTotals {
        constructor() {
            this.observedInputs = new Map(); // input element → cleanup function
            this.unregisterObserver = null;
            this.isInitialized = false;
        }

        /**
         * Initialize the output totals display
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('actionPanel_outputTotals')) {
                return;
            }

            this.isInitialized = true;
            this.setupObserver();
        }

        /**
         * Setup DOM observer to watch for action detail panels
         */
        setupObserver() {
            // Watch for action detail panels appearing
            // The game shows action details when you click an action
            this.unregisterObserver = domObserver.onClass(
                'OutputTotals',
                'SkillActionDetail_skillActionDetail',
                (detailPanel) => {
                    this.attachToActionPanel(detailPanel);
                }
            );
        }

        /**
         * Attach input listener to an action panel
         * @param {HTMLElement} detailPanel - The action detail panel element
         */
        attachToActionPanel(detailPanel) {
            // Find the input box using utility
            const inputBox = actionPanelHelper_js.findActionInput(detailPanel);
            if (!inputBox) {
                return;
            }

            // Avoid duplicate observers
            if (this.observedInputs.has(inputBox)) {
                return;
            }

            // Attach input listeners using utility
            const cleanup = actionPanelHelper_js.attachInputListeners(detailPanel, inputBox, (_value) => {
                this.updateOutputTotals(detailPanel, inputBox);
            });

            // Store cleanup function
            this.observedInputs.set(inputBox, cleanup);

            // Initial update if there's already a value
            actionPanelHelper_js.performInitialUpdate(inputBox, () => {
                this.updateOutputTotals(detailPanel, inputBox);
            });
        }

        /**
         * Update output totals based on input value
         * @param {HTMLElement} detailPanel - The action detail panel
         * @param {HTMLInputElement} inputBox - The action count input
         */
        updateOutputTotals(detailPanel, inputBox) {
            const amount = parseFloat(inputBox.value);

            // Remove existing totals (cloned outputs and XP)
            detailPanel.querySelectorAll('.mwi-output-total').forEach((el) => el.remove());

            // No amount entered - nothing to calculate
            if (isNaN(amount) || amount <= 0) {
                return;
            }

            // Find main drop container
            let dropTable = detailPanel.querySelector('[class*="SkillActionDetail_dropTable"]');
            if (!dropTable) return;

            const outputItems = detailPanel.querySelector('[class*="SkillActionDetail_outputItems"]');
            if (outputItems) dropTable = outputItems;

            // Track processed containers to avoid duplicates
            const processedContainers = new Set();

            // Process main outputs
            this.processDropContainer(dropTable, amount);
            processedContainers.add(dropTable);

            // Process Essences and Rares - find all dropTable containers
            const allDropTables = detailPanel.querySelectorAll('[class*="SkillActionDetail_dropTable"]');

            allDropTables.forEach((container) => {
                if (processedContainers.has(container)) {
                    return;
                }

                // Check for essences
                if (container.innerText.toLowerCase().includes('essence')) {
                    this.processDropContainer(container, amount);
                    processedContainers.add(container);
                    return;
                }

                // Check for rares (< 5% drop rate, not essences)
                if (container.innerText.includes('%')) {
                    const percentageMatch = container.innerText.match(/([\d.]+)%/);
                    if (percentageMatch && parseFloat(percentageMatch[1]) < 5) {
                        this.processDropContainer(container, amount);
                        processedContainers.add(container);
                    }
                }
            });

            // Process XP element
            this.processXpElement(detailPanel, amount);
        }

        /**
         * Process drop container (matches MWIT-E implementation)
         * @param {HTMLElement} container - The drop table container
         * @param {number} amount - Number of actions
         */
        processDropContainer(container, amount) {
            if (!container) return;

            const children = Array.from(container.children);

            children.forEach((child) => {
                // Skip if this child already has a total next to it
                if (child.nextSibling?.classList?.contains('mwi-output-total')) {
                    return;
                }

                // Check if this child has multiple drop elements
                const hasDropElements =
                    child.children.length > 1 && child.querySelector('[class*="SkillActionDetail_drop"]');

                if (hasDropElements) {
                    // Process multiple drop elements (typical for outputs/essences/rares)
                    const dropElements = child.querySelectorAll('[class*="SkillActionDetail_drop"]');
                    dropElements.forEach((dropEl) => {
                        // Skip if this drop element already has a total
                        if (dropEl.nextSibling?.classList?.contains('mwi-output-total')) {
                            return;
                        }
                        const clone = this.processChildElement(dropEl, amount);
                        if (clone) {
                            dropEl.after(clone);
                        }
                    });
                } else {
                    // Process single element
                    const clone = this.processChildElement(child, amount);
                    if (clone) {
                        child.parentNode.insertBefore(clone, child.nextSibling);
                    }
                }
            });
        }

        /**
         * Process a single child element and return clone with calculated total
         * @param {HTMLElement} child - The child element to process
         * @param {number} amount - Number of actions
         * @returns {HTMLElement|null} Clone element or null
         */
        processChildElement(child, amount) {
            // Look for output element (first child with numbers or ranges)
            const hasRange = child.children[0]?.innerText?.includes('-');
            const hasNumbers = child.children[0]?.innerText?.match(/[\d.]+/);

            const outputElement = hasRange || hasNumbers ? child.children[0] : null;

            if (!outputElement) return null;

            // Extract drop rate from the child's text
            const dropRateText = child.innerText;
            const rateMatch = dropRateText.match(/~?([\d.]+)%/);
            const dropRate = rateMatch ? parseFloat(rateMatch[1]) / 100 : 1; // Default to 100%

            // Parse output values
            const output = outputElement.innerText.split('-');

            // Create styled clone (same as MWIT-E)
            const clone = outputElement.cloneNode(true);
            clone.classList.add('mwi-output-total');

            // Determine color based on item type
            let color = config.COLOR_INFO; // Default blue for outputs

            if (child.innerText.toLowerCase().includes('essence')) {
                color = config.COLOR_ESSENCE; // Purple for essences
            } else if (dropRate < 0.05) {
                color = config.COLOR_WARNING; // Orange for rares (< 5% drop)
            }

            clone.style.cssText = `
            color: ${color};
            font-weight: 600;
            margin-top: 2px;
        `;

            // Calculate and set the expected output
            if (output.length > 1) {
                // Range output (e.g., "1.3 - 4")
                const minOutput = parseFloat(output[0].trim());
                const maxOutput = parseFloat(output[1].trim());
                const expectedMin = (minOutput * amount * dropRate).toLocaleString('en-US', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                });
                const expectedMax = (maxOutput * amount * dropRate).toLocaleString('en-US', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                });
                clone.innerText = `${expectedMin} - ${expectedMax}`;
            } else {
                // Single value output
                const value = parseFloat(output[0].trim());
                const expectedValue = (value * amount * dropRate).toLocaleString('en-US', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                });
                clone.innerText = `${expectedValue}`;
            }

            return clone;
        }

        /**
         * Extract action HRID from detail panel
         * @param {HTMLElement} detailPanel - The action detail panel element
         * @returns {string|null} Action HRID or null
         */
        getActionHridFromPanel(detailPanel) {
            // Find action name element
            const nameElement = detailPanel.querySelector('[class*="SkillActionDetail_name"]');

            if (!nameElement) {
                return null;
            }

            const actionName = nameElement.textContent.trim();

            // Look up action by name in game data
            const initData = dataManager.getInitClientData();
            if (!initData) {
                return null;
            }

            for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
                if (action.name === actionName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Process XP element and display total XP
         * @param {HTMLElement} detailPanel - The action detail panel
         * @param {number} amount - Number of actions
         */
        processXpElement(detailPanel, amount) {
            // Find XP element
            const xpElement = detailPanel.querySelector('[class*="SkillActionDetail_expGain"]');
            if (!xpElement) {
                return;
            }

            // Get action HRID
            const actionHrid = this.getActionHridFromPanel(detailPanel);
            if (!actionHrid) {
                return;
            }

            const actionDetails = dataManager.getActionDetails(actionHrid);
            if (!actionDetails || !actionDetails.experienceGain) {
                return;
            }

            // Calculate experience multiplier (Wisdom + Charm Experience)
            const skillHrid = actionDetails.experienceGain.skillHrid;
            const xpData = experienceParser_js.calculateExperienceMultiplier(skillHrid, actionDetails.type);

            // Calculate total XP
            const baseXP = actionDetails.experienceGain.value;
            const modifiedXP = baseXP * xpData.totalMultiplier;
            const totalXP = modifiedXP * amount;

            // Create clone for total display
            const clone = xpElement.cloneNode(true);
            clone.classList.add('mwi-output-total');

            // Apply blue color for XP
            clone.style.cssText = `
            color: ${config.COLOR_INFO};
            font-weight: 600;
            margin-top: 2px;
        `;

            // Set total XP text (formatted with 1 decimal place and thousand separators)
            clone.childNodes[0].textContent = totalXP.toLocaleString('en-US', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
            });

            // Insert after original XP element
            xpElement.parentNode.insertBefore(clone, xpElement.nextSibling);
        }

        /**
         * Disable the output totals display
         */
        disable() {
            // Clean up all input observers
            for (const cleanup of this.observedInputs.values()) {
                cleanup();
            }
            this.observedInputs.clear();

            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all injected elements
            document.querySelectorAll('.mwi-output-total').forEach((el) => el.remove());

            this.isInitialized = false;
        }
    }

    const outputTotals = new OutputTotals();

    /**
     * Max Produceable Display Module
     *
     * Shows maximum craftable quantity on action panels based on current inventory.
     *
     * Example:
     * - Cheesy Sword requires: 10 Cheese, 5 Iron Bar
     * - Inventory: 120 Cheese, 65 Iron Bar
     * - Display: "Can produce: 12" (limited by 120/10 = 12)
     */


    /**
     * Action type constants for classification
     */
    const GATHERING_TYPES$1 = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
    const PRODUCTION_TYPES$2 = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * Build inventory index map for O(1) lookups
     * @param {Array} inventory - Inventory array from dataManager
     * @returns {Map} Map of itemHrid → inventory item
     */
    function buildInventoryIndex(inventory) {
        const index = new Map();
        for (const item of inventory) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                index.set(item.itemHrid, item);
            }
        }
        return index;
    }

    class MaxProduceable {
        constructor() {
            this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement, pinElement}
            this.unregisterObserver = null;
            this.lastCrimsonMilkCount = null; // For debugging inventory updates
            this.itemsUpdatedHandler = null;
            this.actionCompletedHandler = null;
            this.characterSwitchingHandler = null; // Handler for character switch cleanup
            this.profitCalcTimeout = null; // Debounce timer for deferred profit calculations
            this.actionNameToHridCache = null; // Cached reverse lookup map (name → hrid)
            this.isInitialized = false;
            this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
            this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize the max produceable display
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('actionPanel_maxProduceable')) {
                return;
            }

            this.isInitialized = true;

            // Initialize shared sort manager
            await actionPanelSort.initialize();

            this.setupObserver();

            // Store handler references for cleanup with debouncing
            this.itemsUpdatedHandler = () => {
                clearTimeout(this.itemsUpdatedDebounceTimer);
                this.itemsUpdatedDebounceTimer = setTimeout(() => {
                    this.updateAllCounts();
                }, this.DEBOUNCE_DELAY);
            };
            this.characterSwitchingHandler = () => {
                this.clearAllReferences();
            };

            // Event-driven updates (no polling needed)
            dataManager.on('items_updated', this.itemsUpdatedHandler);
            dataManager.on('character_switching', this.characterSwitchingHandler);
        }

        /**
         * Setup DOM observer to watch for action panels
         */
        setupObserver() {
            // Watch for skill action panels (in skill screen, not detail modal)
            this.unregisterObserver = domObserver.onClass('MaxProduceable', 'SkillAction_skillAction', (actionPanel) => {
                const isNew = !this.actionElements.has(actionPanel);
                this.injectMaxProduceable(actionPanel);

                // Only schedule a profit recalculation for genuinely new panels.
                // Panels that are already registered are being re-added by the sort
                // reorder (DocumentFragment move), not navigated to fresh — scheduling
                // updateAllCounts for them creates the sort→observer→updateAllCounts→sort
                // infinite loop that causes continuous flashing and CPU waste.
                if (!isNew) return;

                // Schedule profit calculation after panels settle
                // This prevents 20-50 simultaneous API calls during character switch
                clearTimeout(this.profitCalcTimeout);
                this.profitCalcTimeout = setTimeout(() => {
                    this.updateAllCounts();
                }, 50); // Wait 50ms after last panel appears for better responsiveness
                this.timerRegistry.registerTimeout(this.profitCalcTimeout);
            });

            // Check for existing action panels that may already be open
            const existingPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
            existingPanels.forEach((panel) => {
                this.injectMaxProduceable(panel);
            });

            // Calculate profits for existing panels after initial load
            if (existingPanels.length > 0) {
                clearTimeout(this.profitCalcTimeout);
                this.profitCalcTimeout = setTimeout(() => {
                    this.updateAllCounts();
                }, 50); // Fast initial load for better responsiveness
                this.timerRegistry.registerTimeout(this.profitCalcTimeout);
            }
        }

        /**
         * Inject max produceable display and pin icon into an action panel
         * @param {HTMLElement} actionPanel - The action panel element
         */
        injectMaxProduceable(actionPanel) {
            // Extract action HRID from panel
            const actionHrid = this.getActionHridFromPanel(actionPanel);

            if (!actionHrid) {
                return;
            }

            const actionDetails = dataManager.getActionDetails(actionHrid);
            if (!actionDetails) {
                return;
            }

            // Check if production action with inputs (for max produceable display)
            const isProductionAction = actionDetails.inputItems && actionDetails.inputItems.length > 0;

            // Check if already injected
            const existingDisplay = actionPanel.querySelector('.mwi-max-produceable');
            const existingPin = actionPanel.querySelector('.mwi-action-pin');
            if (existingPin) {
                // Re-register existing elements
                this.actionElements.set(actionPanel, {
                    actionHrid: actionHrid,
                    displayElement: existingDisplay || null,
                    pinElement: existingPin,
                });
                // Update pin state
                this.updatePinIcon(existingPin, actionHrid);
                // Note: Profit update is deferred to updateAllCounts() in setupObserver()
                return;
            }

            // Make sure the action panel has relative positioning
            if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
                actionPanel.style.position = 'relative';
            }

            let display = null;

            // Only create max produceable display for production actions
            if (isProductionAction) {
                actionPanel.style.alignSelf = 'flex-start';
                actionPanel.style.overflow = 'visible';

                display = document.createElement('div');
                display.className = 'mwi-max-produceable';
                display.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                font-size: 0.55em;
                padding: 4px 8px;
                text-align: center;
                background: rgba(0, 0, 0, 0.7);
                border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
                z-index: 10;
                line-height: 1.3;
                overflow: hidden;
            `;

                actionPanel.appendChild(display);

                // Set marginBottom to the bar's actual rendered height so the grid row
                // reserves exactly the right amount of space below the tile.
                requestAnimationFrame(() => {
                    const h = display.offsetHeight;
                    if (h > 0) actionPanel.style.marginBottom = `${h}px`;
                });
            }

            // Create pin icon (for ALL actions - gathering and production)
            const pinIcon = document.createElement('div');
            pinIcon.className = 'mwi-action-pin';
            pinIcon.innerHTML = '📌'; // Pin emoji
            pinIcon.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            font-size: 1.5em;
            cursor: pointer;
            transition: all 0.2s;
            z-index: 11;
            user-select: none;
            filter: grayscale(100%) brightness(0.7);
        `;
            pinIcon.title = 'Pin this action to keep it visible';

            // Pin hover effect
            pinIcon.addEventListener('mouseenter', () => {
                if (!actionPanelSort.isPinned(actionHrid)) {
                    pinIcon.style.filter = 'grayscale(50%) brightness(1)';
                }
            });
            pinIcon.addEventListener('mouseleave', () => {
                this.updatePinIcon(pinIcon, actionHrid);
            });

            // Pin click handler
            pinIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePin(actionHrid, pinIcon);
            });

            // Set initial pin state
            this.updatePinIcon(pinIcon, actionHrid);

            actionPanel.appendChild(pinIcon);

            // Store reference
            this.actionElements.set(actionPanel, {
                actionHrid: actionHrid,
                displayElement: display,
                pinElement: pinIcon,
            });

            // Register panel with shared sort manager
            actionPanelSort.registerPanel(actionPanel, actionHrid);

            // Note: Profit calculation is deferred to updateAllCounts() in setupObserver()
            // This prevents 20-50 simultaneous API calls during character switch

            // Trigger debounced sort after panels are loaded
            actionPanelSort.triggerSort();
        }

        /**
         * Extract action HRID from action panel
         * @param {HTMLElement} actionPanel - The action panel element
         * @returns {string|null} Action HRID or null
         */
        getActionHridFromPanel(actionPanel) {
            // Try to find action name from panel
            const nameElement = actionPanel.querySelector('div[class*="SkillAction_name"]');

            if (!nameElement) {
                return null;
            }

            const actionName = Array.from(nameElement.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent)
                .join('')
                .trim();

            // Build reverse lookup cache on first use (name → hrid)
            if (!this.actionNameToHridCache) {
                const initData = dataManager.getInitClientData();
                if (!initData) {
                    return null;
                }

                this.actionNameToHridCache = new Map();
                for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
                    this.actionNameToHridCache.set(action.name, hrid);
                }
            }

            // O(1) lookup instead of O(n) iteration
            return this.actionNameToHridCache.get(actionName) || null;
        }

        /**
         * Calculate max produceable count for an action
         * @param {string} actionHrid - The action HRID
         * @param {Map} inventoryIndex - Inventory index map (itemHrid → item)
         * @param {Object} gameData - Game data (optional, will fetch if not provided)
         * @returns {number|null} Max produceable count or null
         */
        calculateMaxProduceable(actionHrid, inventoryIndex = null, gameData = null) {
            const actionDetails = dataManager.getActionDetails(actionHrid);

            // Get inventory index if not provided
            if (!inventoryIndex) {
                const inventory = dataManager.getInventory();
                inventoryIndex = buildInventoryIndex(inventory);
            }

            if (!actionDetails || !inventoryIndex) {
                return null;
            }

            // Get Artisan Tea reduction if active (applies to input materials only, not upgrade items)
            const equipment = dataManager.getEquipment();
            const itemDetailMap = gameData?.itemDetailMap || dataManager.getInitClientData()?.itemDetailMap || {};
            const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
            const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate max crafts per input (using O(1) Map lookup instead of O(n) array find)
            const maxCraftsPerInput = actionDetails.inputItems.map((input) => {
                const invItem = inventoryIndex.get(input.itemHrid);
                const invCount = invItem?.count || 0;

                // Apply Artisan reduction (10% base, scaled by Drink Concentration)
                // Materials consumed per action = base requirement × (1 - artisan bonus)
                const materialsPerAction = input.count * (1 - artisanBonus);
                const maxCrafts = Math.floor(invCount / materialsPerAction);

                return maxCrafts;
            });

            let minCrafts = Math.min(...maxCraftsPerInput);

            // Check upgrade item (e.g., Enhancement Stones)
            // NOTE: Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
            if (actionDetails.upgradeItemHrid) {
                const upgradeItem = inventoryIndex.get(actionDetails.upgradeItemHrid);
                const upgradeCount = upgradeItem?.count || 0;
                minCrafts = Math.min(minCrafts, upgradeCount);
            }

            return minCrafts;
        }

        /**
         * Update display count for a single action panel
         * @param {HTMLElement} actionPanel - The action panel element
         * @param {Map} inventoryIndex - Inventory index map (optional)
         */
        async updateCount(actionPanel, inventoryIndex = null) {
            const data = this.actionElements.get(actionPanel);

            if (!data) {
                return;
            }

            // Only calculate max crafts for production actions with display element
            let maxCrafts = null;
            if (data.displayElement) {
                maxCrafts = this.calculateMaxProduceable(data.actionHrid, inventoryIndex, dataManager.getInitClientData());

                if (maxCrafts === null) {
                    data.displayElement.style.display = 'none';
                    return;
                }
            }

            // Calculate profit/hr (for both gathering and production)
            let profitPerHour = null;
            let hasMissingPrices = false;
            let outputPriceEstimated = false;
            const actionDetails = dataManager.getActionDetails(data.actionHrid);

            if (actionDetails) {
                if (GATHERING_TYPES$1.includes(actionDetails.type)) {
                    const profitData = await calculateGatheringProfit(data.actionHrid);
                    profitPerHour = profitData?.profitPerHour || null;
                    hasMissingPrices = profitData?.hasMissingPrices || false;
                } else if (PRODUCTION_TYPES$2.includes(actionDetails.type)) {
                    const profitData = await calculateProductionProfit(data.actionHrid);
                    profitPerHour = profitData?.profitPerHour || null;
                    hasMissingPrices = profitData?.hasMissingPrices || false;
                    outputPriceEstimated = profitData?.outputPriceEstimated || false;
                }
            }

            // Store profit value for sorting and update shared sort manager
            const resolvedProfitPerHour = hasMissingPrices ? null : profitPerHour;
            data.profitPerHour = resolvedProfitPerHour;
            actionPanelSort.updateProfit(actionPanel, resolvedProfitPerHour);

            // Check if we should hide actions with negative profit (unless pinned)
            const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
            const isPinned = actionPanelSort.isPinned(data.actionHrid);
            const isFilterHidden = actionFilter.isFilterHidden(actionPanel);

            if (hideNegativeProfit && resolvedProfitPerHour !== null && resolvedProfitPerHour < 0 && !isPinned) {
                // Hide the entire action panel (unless it's pinned)
                actionPanel.style.display = 'none';
                return;
            } else if (isFilterHidden) {
                // Hide the panel if filter doesn't match
                actionPanel.style.display = 'none';
                return;
            } else {
                // Show the action panel (in case it was previously hidden)
                actionPanel.style.display = '';
            }

            // Only update display element if it exists (production actions only)
            if (!data.displayElement) {
                return;
            }

            // Calculate exp/hr using shared utility
            const expData = experienceCalculator_js.calculateExpPerHour(data.actionHrid);
            const expPerHour = expData?.expPerHour || null;

            // Color coding for "Can produce"
            let canProduceColor;
            if (maxCrafts === 0) {
                canProduceColor = config.COLOR_LOSS; // Red - can't craft
            } else if (maxCrafts < 5) {
                canProduceColor = config.COLOR_WARNING; // Orange/yellow - low materials
            } else {
                canProduceColor = config.COLOR_PROFIT; // Green - plenty of materials
            }

            // Store metrics for best action comparison
            data.maxCrafts = maxCrafts;
            data.profitPerHour = resolvedProfitPerHour;
            data.expPerHour = expPerHour;
            data.hasMissingPrices = hasMissingPrices;
            actionPanelSort.updateExpPerHour(actionPanel, expPerHour);

            // Build display HTML using .mwi-action-stat-line divs so fitLineFontSizes
            // can size each line immediately — avoids the multi-second flash of tiny
            // unsized text that occurred when sizing was deferred to addBestActionIndicators.
            let html = `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
            html += `<span style="color: ${canProduceColor};">Can produce: ${maxCrafts.toLocaleString()}</span></div>`;

            if (hasMissingPrices) {
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="profit" style="color: ${config.SCRIPT_COLOR_ALERT};">Profit/hr: -- ⚠</span></div>`;
            } else if (resolvedProfitPerHour !== null) {
                const profitColor = resolvedProfitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const profitSign = resolvedProfitPerHour >= 0 ? '' : '-';
                const estimatedNote = outputPriceEstimated ? ' ⚠' : '';
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="profit" style="color: ${profitColor};">Profit/hr: ${profitSign}${formatters_js.formatKMB(Math.abs(resolvedProfitPerHour))}${estimatedNote}</span></div>`;
            }

            if (expPerHour !== null && expPerHour > 0) {
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="exp" style="color: #fff;">Exp/hr: ${formatters_js.formatKMB(expPerHour)}</span></div>`;
            }

            if (!hasMissingPrices && resolvedProfitPerHour !== null && expPerHour !== null && expPerHour > 0) {
                const coinsPerXp = resolvedProfitPerHour / expPerHour;
                const efficiencyColor = coinsPerXp >= 0 ? config.COLOR_INFO : config.COLOR_WARNING;
                const efficiencySign = coinsPerXp >= 0 ? '' : '-';
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="overall" style="color: ${efficiencyColor};">Coins/XP: ${efficiencySign}${formatters_js.formatKMB(Math.abs(coinsPerXp))}</span></div>`;
            }

            data.displayElement.style.display = 'block';
            data.displayElement.style.visibility = 'hidden';
            data.displayElement.innerHTML = html;
            this.fitLineFontSizes(actionPanel, data.displayElement);
        }

        /**
         * Update all counts
         */
        async updateAllCounts() {
            // This prevents all 20+ calculations from triggering simultaneous fetches
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch();
            }

            // Get inventory once and build index for O(1) lookups
            const inventory = dataManager.getInventory();

            if (!inventory) {
                return;
            }

            // Build inventory index once (O(n) cost, but amortized across all panels)
            const inventoryIndex = buildInventoryIndex(inventory);

            // Clean up stale references and update valid ones
            const updatePromises = [];
            for (const actionPanel of [...this.actionElements.keys()]) {
                if (document.body.contains(actionPanel)) {
                    updatePromises.push(this.updateCount(actionPanel, inventoryIndex));
                } else {
                    // Panel no longer in DOM - remove injected elements BEFORE deleting from Map
                    const data = this.actionElements.get(actionPanel);
                    if (data) {
                        if (data.displayElement) {
                            data.displayElement.innerHTML = ''; // Clear innerHTML to break references
                            data.displayElement.remove();
                            data.displayElement = null; // Null out reference for GC
                        }
                        if (data.pinElement) {
                            data.pinElement.innerHTML = ''; // Clear innerHTML to break references
                            data.pinElement.remove();
                            data.pinElement = null; // Null out reference for GC
                        }
                    }
                    this.actionElements.delete(actionPanel);
                    actionPanelSort.unregisterPanel(actionPanel);
                }
            }

            // Wait for all updates to complete
            await Promise.all(updatePromises);

            // Find best actions and add indicators
            this.addBestActionIndicators();

            // Trigger sort via shared manager
            actionPanelSort.triggerSort();
        }

        /**
         * Find best actions and add visual indicators
         */
        addBestActionIndicators() {
            let bestProfit = null;
            let bestExp = null;
            let bestOverall = null;
            let bestProfitPanels = [];
            let bestExpPanels = [];
            let bestOverallPanels = [];

            // First pass: find the best values
            for (const [actionPanel, data] of this.actionElements.entries()) {
                if (!document.body.contains(actionPanel) || !data.displayElement) {
                    continue;
                }

                const { profitPerHour, expPerHour, hasMissingPrices } = data;

                // Skip actions with missing prices for profit comparison
                if (!hasMissingPrices && profitPerHour !== null && profitPerHour > 0) {
                    if (bestProfit === null || profitPerHour > bestProfit) {
                        bestProfit = profitPerHour;
                        bestProfitPanels = [actionPanel];
                    } else if (profitPerHour === bestProfit) {
                        bestProfitPanels.push(actionPanel);
                    }
                }

                // Find best exp/hr
                if (expPerHour !== null && expPerHour > 0) {
                    if (bestExp === null || expPerHour > bestExp) {
                        bestExp = expPerHour;
                        bestExpPanels = [actionPanel];
                    } else if (expPerHour === bestExp) {
                        bestExpPanels.push(actionPanel);
                    }
                }

                // Find best overall (profit × exp product)
                if (
                    !hasMissingPrices &&
                    profitPerHour !== null &&
                    profitPerHour > 0 &&
                    expPerHour !== null &&
                    expPerHour > 0
                ) {
                    const overallValue = profitPerHour * expPerHour;
                    if (bestOverall === null || overallValue > bestOverall) {
                        bestOverall = overallValue;
                        bestOverallPanels = [actionPanel];
                    } else if (overallValue === bestOverall) {
                        bestOverallPanels.push(actionPanel);
                    }
                }
            }

            // Second pass: update emoji indicators in-place on existing spans.
            // Avoids rewriting innerHTML (which would cause a flash + re-size).
            const EMOJIS = [' 💰', ' 🧠', ' 🏆'];
            const stripEmoji = (text) => {
                let t = text;
                for (const e of EMOJIS) t = t.replace(e, '');
                return t;
            };

            for (const [actionPanel, data] of this.actionElements.entries()) {
                if (!document.body.contains(actionPanel) || !data.displayElement) {
                    continue;
                }

                const isBestProfit = bestProfitPanels.includes(actionPanel);
                const isBestExp = bestExpPanels.includes(actionPanel);
                const isBestOverall = bestOverallPanels.includes(actionPanel);

                const profitSpan = data.displayElement.querySelector('[data-stat="profit"]');
                if (profitSpan) {
                    profitSpan.textContent = stripEmoji(profitSpan.textContent) + (isBestProfit ? ' 💰' : '');
                }

                const expSpan = data.displayElement.querySelector('[data-stat="exp"]');
                if (expSpan) {
                    expSpan.textContent = stripEmoji(expSpan.textContent) + (isBestExp ? ' 🧠' : '');
                }

                const overallSpan = data.displayElement.querySelector('[data-stat="overall"]');
                if (overallSpan) {
                    overallSpan.textContent = stripEmoji(overallSpan.textContent) + (isBestOverall ? ' 🏆' : '');
                }

                // Re-fit font sizes now that emoji may have changed span widths.
                this.fitLineFontSizes(actionPanel, data.displayElement);
            }
        }

        /**
         * Fit each stat line to the action panel width
         * @param {HTMLElement} actionPanel - Action panel container
         * @param {HTMLElement} displayElement - Stats container
         */
        fitLineFontSizes(actionPanel, displayElement, retries = 4) {
            requestAnimationFrame(() => {
                const panelWidth = actionPanel.getBoundingClientRect().width;
                const fallbackWidth = displayElement.getBoundingClientRect().width;
                const rawWidth = panelWidth || fallbackWidth;
                const availableWidth = Math.max(0, rawWidth - 16);
                if (!availableWidth) {
                    if (retries > 0) {
                        setTimeout(() => this.fitLineFontSizes(actionPanel, displayElement, retries - 1), 60);
                    } else {
                        // Out of retries — reveal anyway so it's never permanently hidden.
                        displayElement.style.visibility = '';
                    }
                    return;
                }

                const baseFontSize = 11;
                const minFontSize = 5;
                const lines = displayElement.querySelectorAll('.mwi-action-stat-line');

                lines.forEach((line) => {
                    const textSpan = line.querySelector('span');
                    if (!textSpan) {
                        return;
                    }

                    textSpan.style.setProperty('display', 'inline-block');
                    textSpan.style.setProperty('transform-origin', 'left center');
                    textSpan.style.setProperty('transform', 'scaleX(1)');

                    let fontSize = baseFontSize;
                    textSpan.style.setProperty('font-size', `${fontSize}px`, 'important');
                    let textWidth = textSpan.getBoundingClientRect().width;
                    let iterations = 0;

                    while (textWidth > availableWidth && fontSize > minFontSize && iterations < 20) {
                        fontSize -= 1;
                        textSpan.style.setProperty('font-size', `${fontSize}px`, 'important');
                        textWidth = textSpan.getBoundingClientRect().width;
                        iterations += 1;
                    }

                    if (textWidth > availableWidth) {
                        const scaleX = Math.max(0.6, availableWidth / textWidth);
                        textSpan.style.setProperty('transform', `scaleX(${scaleX})`);
                    }
                });

                // Reveal now that sizing is complete.
                displayElement.style.visibility = '';

                // Keep marginBottom in sync with the bar's actual rendered height.
                const h = displayElement.offsetHeight;
                if (h > 0) actionPanel.style.marginBottom = `${h}px`;
            });
        }

        /**
         * Toggle pin state for an action
         * @param {string} actionHrid - Action HRID to toggle
         * @param {HTMLElement} pinIcon - Pin icon element
         */
        async togglePin(actionHrid, pinIcon) {
            await actionPanelSort.togglePin(actionHrid);

            // Update icon appearance
            this.updatePinIcon(pinIcon, actionHrid);

            // Re-sort and re-filter panels
            await this.updateAllCounts();
        }

        /**
         * Update pin icon appearance based on pinned state
         * @param {HTMLElement} pinIcon - Pin icon element
         * @param {string} actionHrid - Action HRID
         */
        updatePinIcon(pinIcon, actionHrid) {
            const isPinned = actionPanelSort.isPinned(actionHrid);
            if (isPinned) {
                // Pinned: Full color, bright, larger
                pinIcon.style.filter = 'grayscale(0%) brightness(1.2) drop-shadow(0 0 3px rgba(255, 100, 0, 0.8))';
                pinIcon.style.transform = 'scale(1.1)';
            } else {
                // Unpinned: Grayscale, dimmed, normal size
                pinIcon.style.filter = 'grayscale(100%) brightness(0.7)';
                pinIcon.style.transform = 'scale(1)';
            }
            pinIcon.title = isPinned ? 'Unpin this action' : 'Pin this action to keep it visible';
        }

        /**
         * Clear all DOM references to prevent memory leaks during character switch
         */
        clearAllReferences() {
            // Clear profit calculation timeout
            if (this.profitCalcTimeout) {
                clearTimeout(this.profitCalcTimeout);
                this.profitCalcTimeout = null;
            }

            this.timerRegistry.clearAll();

            // CRITICAL: Remove injected DOM elements BEFORE clearing Maps
            // This prevents detached SVG elements from accumulating
            // Note: .remove() is safe to call even if element is already detached
            for (const [actionPanel, data] of this.actionElements.entries()) {
                if (data.displayElement) {
                    data.displayElement.innerHTML = ''; // Clear innerHTML to break event listener references
                    data.displayElement.remove();
                    data.displayElement = null; // Null out reference for GC
                }
                if (data.pinElement) {
                    data.pinElement.innerHTML = ''; // Clear innerHTML to break event listener references
                    data.pinElement.remove();
                    data.pinElement = null; // Null out reference for GC
                }
                actionPanel.style.marginBottom = '';
                actionPanel.style.overflow = '';
            }

            // Clear all action element references (prevents detached DOM memory leak)
            this.actionElements.clear();

            // Clear action name cache
            if (this.actionNameToHridCache) {
                this.actionNameToHridCache.clear();
                this.actionNameToHridCache = null;
            }

            // Clear shared sort manager's panel references
            actionPanelSort.clearAllPanels();
        }

        /**
         * Disable the max produceable display
         */
        disable() {
            // Clear debounce timers
            clearTimeout(this.itemsUpdatedDebounceTimer);
            clearTimeout(this.actionCompletedDebounceTimer);
            this.itemsUpdatedDebounceTimer = null;
            this.actionCompletedDebounceTimer = null;

            if (this.itemsUpdatedHandler) {
                dataManager.off('items_updated', this.itemsUpdatedHandler);
                this.itemsUpdatedHandler = null;
            }

            if (this.characterSwitchingHandler) {
                dataManager.off('character_switching', this.characterSwitchingHandler);
                this.characterSwitchingHandler = null;
            }

            // Clear all DOM references
            this.clearAllReferences();

            // Remove DOM observer
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
                this.mutationObserver = null;
            }

            // Remove all injected elements
            document.querySelectorAll('.mwi-max-produceable').forEach((el) => el.remove());
            document.querySelectorAll('.mwi-action-pin').forEach((el) => el.remove());
            this.actionElements.clear();

            this.isInitialized = false;
        }
    }

    const maxProduceable = new MaxProduceable();

    /**
     * Gathering Stats Display Module
     *
     * Shows profit/hr and exp/hr on gathering action tiles
     * (foraging, woodcutting, milking)
     */


    class GatheringStats {
        constructor() {
            this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement}
            this.unregisterObserver = null;
            this.itemsUpdatedHandler = null;
            this.actionCompletedHandler = null;
            this.consumablesUpdatedHandler = null; // Handler for tea/drink changes
            this.characterSwitchingHandler = null; // Handler for character switch cleanup
            this.isInitialized = false;
            this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
            this.consumablesUpdatedDebounceTimer = null; // Debounce timer for consumables_updated events
            this.indicatorUpdateDebounceTimer = null; // Debounce timer for indicator rendering
            this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
        }

        /**
         * Initialize the gathering stats display
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('actionPanel_gatheringStats')) {
                return;
            }

            this.isInitialized = true;

            // Initialize shared sort manager
            await actionPanelSort.initialize();

            this.setupObserver();

            // Store handler references for cleanup with debouncing
            this.itemsUpdatedHandler = () => {
                clearTimeout(this.itemsUpdatedDebounceTimer);
                this.itemsUpdatedDebounceTimer = setTimeout(() => {
                    this.updateAllStats();
                }, this.DEBOUNCE_DELAY);
            };
            this.consumablesUpdatedHandler = () => {
                clearTimeout(this.consumablesUpdatedDebounceTimer);
                this.consumablesUpdatedDebounceTimer = setTimeout(() => {
                    this.updateAllStats();
                }, this.DEBOUNCE_DELAY);
            };

            this.characterSwitchingHandler = () => {
                this.clearAllReferences();
            };

            // Event-driven updates (no polling needed)
            dataManager.on('items_updated', this.itemsUpdatedHandler);
            dataManager.on('consumables_updated', this.consumablesUpdatedHandler);
            dataManager.on('character_switching', this.characterSwitchingHandler);
        }

        /**
         * Setup DOM observer to watch for action panels
         */
        setupObserver() {
            // Watch for skill action panels (in skill screen, not detail modal)
            this.unregisterObserver = domObserver.onClass('GatheringStats', 'SkillAction_skillAction', (actionPanel) => {
                this.injectGatheringStats(actionPanel);
            });

            // Check for existing action panels that may already be open
            const existingPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
            existingPanels.forEach((panel) => {
                this.injectGatheringStats(panel);
            });
        }

        /**
         * Inject gathering stats display into an action panel
         * @param {HTMLElement} actionPanel - The action panel element
         */
        injectGatheringStats(actionPanel) {
            // Extract action HRID from panel
            const actionHrid = this.getActionHridFromPanel(actionPanel);

            if (!actionHrid) {
                return;
            }

            const actionDetails = dataManager.getActionDetails(actionHrid);

            // Only show for gathering actions (no inputItems)
            const gatheringTypes = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
            if (!actionDetails || !gatheringTypes.includes(actionDetails.type)) {
                return;
            }

            // Check if already injected
            const existingDisplay = actionPanel.querySelector('.mwi-gathering-stats');
            if (existingDisplay) {
                // If the panel is already registered in our Map, it's being re-added by a
                // sort reorder (DocumentFragment move) — not genuine navigation. Skip
                // updateStats and triggerSort to avoid the sort→observer→triggerSort loop.
                if (this.actionElements.has(actionPanel)) {
                    return;
                }

                // Re-register existing display (DOM elements may be reused across navigation).
                // Use skipRender so we don't wipe innerHTML (which would erase the emoji
                // set by addBestActionIndicators and cause a visible blink).
                this.actionElements.set(actionPanel, {
                    actionHrid: actionHrid,
                    displayElement: existingDisplay,
                });
                this.updateStats(actionPanel, { skipRender: true }).then(() => {
                    this.scheduleIndicatorUpdate();
                });
                // Register with shared sort manager
                actionPanelSort.registerPanel(actionPanel, actionHrid);
                // Trigger sort
                actionPanelSort.triggerSort();
                return;
            }

            // Create display element
            const display = document.createElement('div');
            display.className = 'mwi-gathering-stats';
            display.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            font-size: 0.55em;
            padding: 4px 8px;
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
            z-index: 10;
            line-height: 1.3;
            overflow: hidden;
        `;

            // Make sure the action panel has relative positioning and extra bottom margin
            if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
                actionPanel.style.position = 'relative';
            }
            actionPanel.style.alignSelf = 'flex-start';
            actionPanel.style.overflow = 'visible';

            // Append directly to action panel with absolute positioning
            actionPanel.appendChild(display);

            // Set marginBottom to the bar's actual rendered height so the grid row
            // reserves exactly the right amount of space below the tile.
            requestAnimationFrame(() => {
                const h = display.offsetHeight;
                if (h > 0) actionPanel.style.marginBottom = `${h}px`;
            });

            // Store reference
            this.actionElements.set(actionPanel, {
                actionHrid: actionHrid,
                displayElement: display,
            });

            // Register with shared sort manager
            actionPanelSort.registerPanel(actionPanel, actionHrid);

            this.updateStats(actionPanel).then(() => {
                this.scheduleIndicatorUpdate();
            });

            // Trigger sort
            actionPanelSort.triggerSort();
        }

        /**
         * Extract action HRID from action panel
         * @param {HTMLElement} actionPanel - The action panel element
         * @returns {string|null} Action HRID or null
         */
        getActionHridFromPanel(actionPanel) {
            // Try to find action name from panel
            const nameElement = actionPanel.querySelector('div[class*="SkillAction_name"]');

            if (!nameElement) {
                return null;
            }

            const actionName = Array.from(nameElement.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent)
                .join('')
                .trim();

            // Look up action by name in game data
            const initData = dataManager.getInitClientData();
            if (!initData) {
                return null;
            }

            for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
                if (action.name === actionName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Update stats display for a single action panel
         * @param {HTMLElement} actionPanel - The action panel element
         * @param {Object} [options] - Optional flags
         * @param {boolean} [options.skipRender=false] - Skip DOM rendering
         */
        async updateStats(actionPanel, options = {}) {
            const data = this.actionElements.get(actionPanel);

            if (!data) {
                return;
            }

            const { skipRender = false } = options;

            // Calculate profit/hr
            const profitData = await calculateGatheringProfit(data.actionHrid);
            const profitPerHour = profitData?.profitPerHour || null;

            // Calculate exp/hr using shared utility
            const expData = experienceCalculator_js.calculateExpPerHour(data.actionHrid);
            const expPerHour = expData?.expPerHour || null;

            // Store profit value for sorting and update shared sort manager
            data.profitPerHour = profitPerHour;
            data.expPerHour = expPerHour;
            actionPanelSort.updateProfit(actionPanel, profitPerHour);
            actionPanelSort.updateExpPerHour(actionPanel, expPerHour);

            // Check if we should hide actions with negative profit (unless pinned)
            const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
            const isPinned = actionPanelSort.isPinned(data.actionHrid);
            const isFilterHidden = actionFilter.isFilterHidden(actionPanel);

            if (hideNegativeProfit && profitPerHour !== null && profitPerHour < 0 && !isPinned) {
                // Hide the entire action panel
                actionPanel.style.display = 'none';
                return;
            } else if (isFilterHidden) {
                // Hide the panel if filter doesn't match
                actionPanel.style.display = 'none';
                return;
            } else {
                // Show the action panel (in case it was previously hidden)
                actionPanel.style.display = '';
            }

            if (skipRender) {
                return;
            }

            this.renderIndicators(actionPanel, data);
        }

        /**
         * Update all stats
         */
        async updateAllStats() {
            // Clean up stale references and update valid ones
            const updatePromises = [];
            for (const actionPanel of [...this.actionElements.keys()]) {
                if (document.body.contains(actionPanel)) {
                    // skipRender: bulk updates go through addBestActionIndicators
                    // which updates spans in-place — avoids double render + flash.
                    updatePromises.push(this.updateStats(actionPanel, { skipRender: true }));
                } else {
                    // Panel no longer in DOM - remove injected elements BEFORE deleting from Map
                    const data = this.actionElements.get(actionPanel);
                    if (data && data.displayElement) {
                        data.displayElement.innerHTML = ''; // Clear innerHTML to break references
                        data.displayElement.remove();
                        data.displayElement = null; // Null out reference for GC
                    }
                    this.actionElements.delete(actionPanel);
                    actionPanelSort.unregisterPanel(actionPanel);
                }
            }

            // Wait for all updates to complete
            await Promise.all(updatePromises);

            // Find best actions and add indicators
            this.scheduleIndicatorUpdate();

            // Trigger sort via shared manager
            actionPanelSort.triggerSort();
        }

        /**
         * Debounce indicator rendering to batch panel updates
         */
        scheduleIndicatorUpdate() {
            clearTimeout(this.indicatorUpdateDebounceTimer);
            this.indicatorUpdateDebounceTimer = setTimeout(() => {
                this.addBestActionIndicators();
            }, this.DEBOUNCE_DELAY);
        }

        /**
         * Find best actions and add visual indicators
         */
        addBestActionIndicators() {
            let bestProfit = null;
            let bestExp = null;
            let bestOverall = null;
            let bestProfitPanels = [];
            let bestExpPanels = [];
            let bestOverallPanels = [];

            // First pass: find the best values
            for (const [actionPanel, data] of this.actionElements.entries()) {
                if (!document.body.contains(actionPanel) || !data.displayElement) {
                    continue;
                }

                const { profitPerHour, expPerHour } = data;

                // Find best profit/hr (allow negative to still mark highest)
                if (profitPerHour !== null) {
                    if (bestProfit === null || profitPerHour > bestProfit) {
                        bestProfit = profitPerHour;
                        bestProfitPanels = [actionPanel];
                    } else if (profitPerHour === bestProfit) {
                        bestProfitPanels.push(actionPanel);
                    }
                }

                // Find best exp/hr
                if (expPerHour !== null && expPerHour > 0) {
                    if (bestExp === null || expPerHour > bestExp) {
                        bestExp = expPerHour;
                        bestExpPanels = [actionPanel];
                    } else if (expPerHour === bestExp) {
                        bestExpPanels.push(actionPanel);
                    }
                }

                // Find best overall (profit × exp product)
                if (profitPerHour !== null && expPerHour !== null && expPerHour > 0) {
                    const overallValue = profitPerHour * expPerHour;
                    if (bestOverall === null || overallValue > bestOverall) {
                        bestOverall = overallValue;
                        bestOverallPanels = [actionPanel];
                    } else if (overallValue === bestOverall) {
                        bestOverallPanels.push(actionPanel);
                    }
                }
            }

            // Second pass: update emoji indicators in-place on existing spans.
            // Avoids rewriting innerHTML (which would cause a flash + re-size).
            const EMOJIS = [' 💰', ' 🧠', ' 🏆'];
            const stripEmoji = (text) => {
                let t = text;
                for (const e of EMOJIS) t = t.replace(e, '');
                return t;
            };

            for (const [actionPanel, data] of this.actionElements.entries()) {
                if (!document.body.contains(actionPanel) || !data.displayElement) {
                    continue;
                }

                const isBestProfit = bestProfitPanels.includes(actionPanel);
                const isBestExp = bestExpPanels.includes(actionPanel);
                const isBestOverall = bestOverallPanels.includes(actionPanel);

                const profitSpan = data.displayElement.querySelector('[data-stat="profit"]');
                if (profitSpan) {
                    profitSpan.textContent = stripEmoji(profitSpan.textContent) + (isBestProfit ? ' 💰' : '');
                }

                const expSpan = data.displayElement.querySelector('[data-stat="exp"]');
                if (expSpan) {
                    expSpan.textContent = stripEmoji(expSpan.textContent) + (isBestExp ? ' 🧠' : '');
                }

                const overallSpan = data.displayElement.querySelector('[data-stat="overall"]');
                if (overallSpan) {
                    overallSpan.textContent = stripEmoji(overallSpan.textContent) + (isBestOverall ? ' 🏆' : '');
                }

                // Re-fit font sizes now that emoji may have changed span widths.
                this.fitLineFontSizes(actionPanel, data.displayElement);
            }
        }

        /**
         * Render stat lines into the display element and size them to fit.
         * @param {HTMLElement} actionPanel - Action panel container
         * @param {Object} data - Stored action data
         */
        renderIndicators(actionPanel, data) {
            const { profitPerHour, expPerHour } = data;
            let html = '';

            if (profitPerHour !== null) {
                const profitColor = profitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const profitSign = profitPerHour >= 0 ? '' : '-';
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="profit" style="color: ${profitColor};">Profit/hr: ${profitSign}${formatters_js.formatKMB(Math.abs(profitPerHour))}</span></div>`;
            }

            if (expPerHour !== null && expPerHour > 0) {
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="exp" style="color: #fff;">Exp/hr: ${formatters_js.formatKMB(expPerHour)}</span></div>`;
            }

            if (profitPerHour !== null && expPerHour !== null && expPerHour > 0) {
                const coinsPerXp = profitPerHour / expPerHour;
                const efficiencyColor = coinsPerXp >= 0 ? config.COLOR_INFO : config.COLOR_WARNING;
                const efficiencySign = coinsPerXp >= 0 ? '' : '-';
                html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
                html += `<span data-stat="overall" style="color: ${efficiencyColor};">Coins/XP: ${efficiencySign}${formatters_js.formatKMB(Math.abs(coinsPerXp))}</span></div>`;
            }

            data.displayElement.innerHTML = html;
            data.displayElement.style.display = 'block';
            data.displayElement.style.visibility = 'hidden';
            this.fitLineFontSizes(actionPanel, data.displayElement);
        }

        /**
         * Fit each stat line to the action panel width
         * @param {HTMLElement} actionPanel - Action panel container
         * @param {HTMLElement} displayElement - Stats container
         */
        fitLineFontSizes(actionPanel, displayElement, retries = 4) {
            requestAnimationFrame(() => {
                const panelWidth = actionPanel.getBoundingClientRect().width;
                const fallbackWidth = displayElement.getBoundingClientRect().width;
                const rawWidth = panelWidth || fallbackWidth;
                const availableWidth = Math.max(0, rawWidth - 16);
                if (!availableWidth) {
                    if (retries > 0) {
                        setTimeout(() => this.fitLineFontSizes(actionPanel, displayElement, retries - 1), 60);
                    } else {
                        // Out of retries — reveal anyway so it's never permanently hidden.
                        displayElement.style.visibility = '';
                    }
                    return;
                }

                const baseFontSize = 11;
                const minFontSize = 5;
                const lines = displayElement.querySelectorAll('.mwi-action-stat-line');

                lines.forEach((line) => {
                    const textSpan = line.querySelector('span');
                    if (!textSpan) {
                        return;
                    }

                    textSpan.style.setProperty('display', 'inline-block');
                    textSpan.style.setProperty('transform-origin', 'left center');
                    textSpan.style.setProperty('transform', 'scaleX(1)');

                    let fontSize = baseFontSize;
                    textSpan.style.setProperty('font-size', `${fontSize}px`, 'important');
                    let textWidth = textSpan.getBoundingClientRect().width;
                    let iterations = 0;

                    while (textWidth > availableWidth && fontSize > minFontSize && iterations < 20) {
                        fontSize -= 1;
                        textSpan.style.setProperty('font-size', `${fontSize}px`, 'important');
                        textWidth = textSpan.getBoundingClientRect().width;
                        iterations += 1;
                    }

                    if (textWidth > availableWidth) {
                        const scaleX = Math.max(0.6, availableWidth / textWidth);
                        textSpan.style.setProperty('transform', `scaleX(${scaleX})`);
                    }
                });

                // Reveal now that sizing is complete.
                displayElement.style.visibility = '';

                // Keep marginBottom in sync with the bar's actual rendered height.
                const h = displayElement.offsetHeight;
                if (h > 0) actionPanel.style.marginBottom = `${h}px`;
            });
        }

        /**
         * Clear all DOM references to prevent memory leaks during character switch
         */
        clearAllReferences() {
            clearTimeout(this.indicatorUpdateDebounceTimer);
            this.indicatorUpdateDebounceTimer = null;
            // CRITICAL: Remove injected DOM elements BEFORE clearing Maps
            // This prevents detached SVG elements from accumulating
            // Note: .remove() is safe to call even if element is already detached
            for (const [actionPanel, data] of this.actionElements.entries()) {
                if (data.displayElement) {
                    data.displayElement.innerHTML = ''; // Clear innerHTML to break event listener references
                    data.displayElement.remove();
                    data.displayElement = null; // Null out reference for GC
                }
                actionPanel.style.marginBottom = '';
                actionPanel.style.overflow = '';
            }

            // Clear all action element references (prevents detached DOM memory leak)
            this.actionElements.clear();

            // Clear shared sort manager's panel references
            actionPanelSort.clearAllPanels();
        }

        /**
         * Disable the gathering stats display
         */
        disable() {
            // Clear debounce timers
            clearTimeout(this.itemsUpdatedDebounceTimer);
            clearTimeout(this.actionCompletedDebounceTimer);
            clearTimeout(this.consumablesUpdatedDebounceTimer);
            clearTimeout(this.indicatorUpdateDebounceTimer);
            this.itemsUpdatedDebounceTimer = null;
            this.actionCompletedDebounceTimer = null;
            this.consumablesUpdatedDebounceTimer = null;
            this.indicatorUpdateDebounceTimer = null;

            if (this.itemsUpdatedHandler) {
                dataManager.off('items_updated', this.itemsUpdatedHandler);
                this.itemsUpdatedHandler = null;
            }

            if (this.consumablesUpdatedHandler) {
                dataManager.off('consumables_updated', this.consumablesUpdatedHandler);
                this.consumablesUpdatedHandler = null;
            }
            if (this.characterSwitchingHandler) {
                dataManager.off('character_switching', this.characterSwitchingHandler);
                this.characterSwitchingHandler = null;
            }

            // Clear all DOM references
            this.clearAllReferences();

            // Remove DOM observer
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all injected elements
            document.querySelectorAll('.mwi-gathering-stats').forEach((el) => el.remove());
            this.actionElements.clear();

            this.isInitialized = false;
        }
    }

    const gatheringStats = new GatheringStats();

    /**
     * Required Materials Display
     * Shows total required materials and missing amounts for production actions
     */


    class RequiredMaterials {
        constructor() {
            this.initialized = false;
            this.observers = [];
            this.processedPanels = new WeakSet();
        }

        initialize() {
            if (this.initialized) return;

            // Watch for action panels appearing
            const unregister = domObserver.onClass(
                'RequiredMaterials-ActionPanel',
                'SkillActionDetail_skillActionDetail',
                () => this.processActionPanels()
            );
            this.observers.push(unregister);

            // Process existing panels
            this.processActionPanels();

            this.initialized = true;
        }

        processActionPanels() {
            const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');

            panels.forEach((panel) => {
                if (this.processedPanels.has(panel)) {
                    return;
                }

                // Find the input box using utility
                const inputField = actionPanelHelper_js.findActionInput(panel);
                if (!inputField) {
                    return;
                }

                // Mark as processed
                this.processedPanels.add(panel);

                // Attach input listeners using utility
                actionPanelHelper_js.attachInputListeners(panel, inputField, (value) => {
                    this.updateRequiredMaterials(panel, value);
                });

                // Initial update if there's already a value
                actionPanelHelper_js.performInitialUpdate(inputField, (value) => {
                    this.updateRequiredMaterials(panel, value);
                });
            });
        }

        updateRequiredMaterials(panel, amount) {
            // Remove existing displays
            const existingDisplays = panel.querySelectorAll('.mwi-required-materials');
            existingDisplays.forEach((el) => el.remove());

            const numActions = parseInt(amount) || 0;
            if (numActions <= 0) {
                return;
            }

            // Get action HRID from panel
            const actionHrid = this.getActionHridFromPanel(panel);
            if (!actionHrid) {
                return;
            }

            // Use shared material calculator with queue accounting (always enabled for Required Materials)
            const materials = materialCalculator_js.calculateMaterialRequirements(actionHrid, numActions, true);
            if (!materials || materials.length === 0) {
                return;
            }

            // Find requirements container for regular materials
            const requiresDiv = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
            if (!requiresDiv) {
                return;
            }

            // Process each material
            const children = Array.from(requiresDiv.children);
            let materialIndex = 0;

            // Separate upgrade items from regular materials
            const regularMaterials = materials.filter((m) => !m.isUpgradeItem);
            const upgradeMaterial = materials.find((m) => m.isUpgradeItem);

            // Process upgrade item first (if exists)
            if (upgradeMaterial) {
                this.processUpgradeItemWithData(panel, upgradeMaterial);
            }

            // Process regular materials
            children.forEach((child, index) => {
                if (child.className && child.className.includes('inputCount')) {
                    // Found an inputCount span - the next sibling is our target container
                    const targetContainer = requiresDiv.children[index + 1];
                    if (!targetContainer) return;

                    // Get corresponding material data
                    if (materialIndex >= regularMaterials.length) return;
                    const material = regularMaterials[materialIndex];

                    // Create display element
                    const displaySpan = document.createElement('span');
                    displaySpan.className = 'mwi-required-materials';
                    displaySpan.style.cssText = `
                    display: block;
                    font-size: 0.85em;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-top: 2px;
                `;

                    // Build text with queue info
                    const queuedText = material.queued > 0 ? ` (${formatters_js.numberFormatter(material.queued)} Q'd)` : '';
                    let text = `Required: ${formatters_js.numberFormatter(material.required)}${queuedText}`;

                    if (material.missing > 0) {
                        const missingQueuedText = material.queued > 0 ? ` (${formatters_js.numberFormatter(material.queued)} Q'd)` : '';
                        text += ` || Missing: ${formatters_js.numberFormatter(material.missing)}${missingQueuedText}`;
                        displaySpan.style.color = config.COLOR_LOSS; // Missing materials
                    } else {
                        displaySpan.style.color = config.COLOR_PROFIT; // Sufficient materials
                    }

                    displaySpan.textContent = text;

                    // Append to target container
                    targetContainer.appendChild(displaySpan);

                    materialIndex++;
                }
            });
        }

        /**
         * Process upgrade item display with material data
         * @param {HTMLElement} panel - Action panel element
         * @param {Object} material - Material object from calculateMaterialRequirements
         */
        processUpgradeItemWithData(panel, material) {
            try {
                // Find upgrade item selector container
                const upgradeContainer = panel.querySelector('[class*="SkillActionDetail_upgradeItemSelectorInput"]');
                if (!upgradeContainer) {
                    return;
                }

                // Create display element (matching style of regular materials)
                const displaySpan = document.createElement('span');
                displaySpan.className = 'mwi-required-materials';
                displaySpan.style.cssText = `
                display: block;
                font-size: 0.85em;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 2px;
            `;

                // Build text with queue info
                const queuedText = material.queued > 0 ? ` (${formatters_js.numberFormatter(material.queued)} Q'd)` : '';
                let text = `Required: ${formatters_js.numberFormatter(material.required)}${queuedText}`;

                if (material.missing > 0) {
                    const missingQueuedText = material.queued > 0 ? ` (${formatters_js.numberFormatter(material.queued)} Q'd)` : '';
                    text += ` || Missing: ${formatters_js.numberFormatter(material.missing)}${missingQueuedText}`;
                    displaySpan.style.color = config.COLOR_LOSS; // Missing materials
                } else {
                    displaySpan.style.color = config.COLOR_PROFIT; // Sufficient materials
                }

                displaySpan.textContent = text;

                // Insert after entire upgrade container (not inside it)
                upgradeContainer.after(displaySpan);
            } catch (error) {
                console.error('[Required Materials] Error processing upgrade item:', error);
            }
        }

        /**
         * Get action HRID from panel
         * @param {HTMLElement} panel - Action panel element
         * @returns {string|null} Action HRID or null
         */
        getActionHridFromPanel(panel) {
            // Get action name from panel
            const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!actionNameElement) {
                return null;
            }

            // Read only direct text nodes to avoid picking up injected child spans
            // (e.g. inventory count display appends "(20 in inventory)" as a child span)
            const actionName = Array.from(actionNameElement.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join('')
                .trim();
            return this.getActionHridFromName(actionName);
        }

        /**
         * Convert action name to HRID
         * @param {string} actionName - Display name of action
         * @returns {string|null} Action HRID or null if not found
         */
        getActionHridFromName(actionName) {
            const gameData = dataManager.getInitClientData();
            if (!gameData?.actionDetailMap) {
                return null;
            }

            // Search for action by name
            for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
                if (detail.name === actionName) {
                    return hrid;
                }
            }

            return null;
        }
        cleanup() {
            this.observers.forEach((unregister) => unregister());
            this.observers = [];
            this.processedPanels = new WeakSet();

            document.querySelectorAll('.mwi-required-materials').forEach((el) => el.remove());

            this.initialized = false;
        }

        disable() {
            this.cleanup();
        }
    }

    const requiredMaterials = new RequiredMaterials();

    /**
     * Marketplace Buy Modal Autofill Utility
     * Provides shared functionality for auto-filling quantity in marketplace buy modals
     * Used by missing materials features (actions, houses, etc.)
     */


    /**
     * Find the quantity input in the buy modal
     * For equipment items, there are multiple number inputs (enhancement level + quantity)
     * We need to find the correct one by checking parent containers for label text
     * @param {HTMLElement} modal - Modal container element
     * @returns {HTMLInputElement|null} Quantity input element or null
     */
    function findQuantityInput(modal) {
        // Get all number inputs in the modal
        const allInputs = Array.from(modal.querySelectorAll('input[type="number"]'));

        if (allInputs.length === 0) {
            return null;
        }

        if (allInputs.length === 1) {
            // Only one input - must be quantity
            return allInputs[0];
        }

        // Multiple inputs - identify by checking CLOSEST parent first
        // Strategy 1: Check each parent level individually, prioritizing closer parents
        // This prevents matching on the outermost container that has all text
        for (let level = 0; level < 4; level++) {
            for (let i = 0; i < allInputs.length; i++) {
                const input = allInputs[i];
                let parent = input.parentElement;

                // Navigate to the specific level
                for (let j = 0; j < level && parent; j++) {
                    parent = parent.parentElement;
                }

                if (!parent) continue;

                const text = parent.textContent;

                // At this specific level, check if it contains "Quantity" but NOT "Enhancement Level"
                if (text.includes('Quantity') && !text.includes('Enhancement Level')) {
                    return input;
                }
            }
        }

        // Strategy 2: Exclude inputs that have "Enhancement Level" in close parents (level 0-2)
        for (let i = 0; i < allInputs.length; i++) {
            const input = allInputs[i];
            let parent = input.parentElement;
            let isEnhancementInput = false;

            // Check only the first 3 levels (not the outermost container)
            for (let j = 0; j < 3 && parent; j++) {
                const text = parent.textContent;

                if (text.includes('Enhancement Level') && !text.includes('Quantity')) {
                    isEnhancementInput = true;
                    break;
                }

                parent = parent.parentElement;
            }

            if (!isEnhancementInput) {
                return input;
            }
        }

        // Fallback: Return first input and log warning
        console.warn('[MarketplaceAutofill] Could not definitively identify quantity input, using first input');
        return allInputs[0];
    }

    /**
     * Handle buy modal appearance and auto-fill quantity if available
     * @param {HTMLElement} modal - Modal container element
     * @param {number|null} activeQuantity - Quantity to auto-fill (null if none)
     */
    function handleBuyModal(modal, activeQuantity) {
        // Check if we have an active quantity to fill
        if (!activeQuantity || activeQuantity <= 0) {
            return;
        }

        // Check if this is a "Buy Now" modal
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) {
            return;
        }

        const headerText = header.textContent.trim();
        if (!headerText.includes('Buy Now') && !headerText.includes('Buy Listing')) {
            return;
        }

        // Find the quantity input - need to be specific to avoid enhancement level input
        const quantityInput = findQuantityInput(modal);
        if (!quantityInput) {
            return;
        }

        // Set the quantity value
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(quantityInput, activeQuantity.toString());

        // Trigger input event to notify React
        const inputEvent = new Event('input', { bubbles: true });
        quantityInput.dispatchEvent(inputEvent);
    }

    /**
     * Create an autofill manager instance
     * Manages storing quantity to autofill and observing buy modals
     * @param {string} observerId - Unique ID for this observer (e.g., 'MissingMats-Actions')
     * @returns {Object} Autofill manager with methods: setQuantity, clearQuantity, initialize, cleanup
     */
    function createAutofillManager(observerId) {
        let activeQuantity = null;
        let observerUnregister = null;

        return {
            /**
             * Set the quantity to auto-fill in the next buy modal
             * @param {number} quantity - Quantity to auto-fill
             */
            setQuantity(quantity) {
                activeQuantity = quantity;
            },

            /**
             * Clear the stored quantity (cancel autofill)
             */
            clearQuantity() {
                activeQuantity = null;
            },

            /**
             * Get the current active quantity
             * @returns {number|null} Current quantity or null
             */
            getQuantity() {
                return activeQuantity;
            },

            /**
             * Initialize buy modal observer
             * Sets up watching for buy modals to appear and auto-fills them
             */
            initialize() {
                observerUnregister = domObserver.onClass(observerId, 'Modal_modalContainer', (modal) => {
                    handleBuyModal(modal, activeQuantity);
                });
            },

            /**
             * Cleanup observer
             * Stops watching for buy modals and clears quantity
             */
            cleanup() {
                if (observerUnregister) {
                    observerUnregister();
                    observerUnregister = null;
                }
                activeQuantity = null;
            },
        };
    }

    /**
     * Marketplace Custom Tabs Utility
     * Provides shared functionality for creating and managing custom marketplace tabs
     * Used by missing materials features (actions, houses, etc.)
     */


    /**
     * Create a custom material tab for the marketplace
     * @param {Object} material - Material data object
     * @param {string} material.itemHrid - Item HRID
     * @param {string} material.itemName - Display name for the item
     * @param {number} material.missing - Amount missing (0 if sufficient)
     * @param {number} [material.queued=0] - Amount reserved by queue
     * @param {boolean} material.isTradeable - Whether item can be traded
     * @param {HTMLElement} referenceTab - Tab element to clone structure from
     * @param {Function} onClickCallback - Callback when tab is clicked, receives (e, material)
     * @returns {HTMLElement} Created tab element
     */
    function createMaterialTab(material, referenceTab, onClickCallback) {
        // Clone reference tab structure
        const tab = referenceTab.cloneNode(true);

        // Mark as custom tab for later identification
        tab.setAttribute('data-mwi-custom-tab', 'true');
        tab.setAttribute('data-item-hrid', material.itemHrid);
        tab.setAttribute('data-missing-quantity', material.missing.toString());

        // Color coding:
        // - Red: Missing materials (missing > 0)
        // - Green: Sufficient materials (missing = 0)
        // - Gray: Not tradeable
        let statusColor;
        let statusText;

        if (!material.isTradeable) {
            statusColor = '#888888'; // Gray - not tradeable
            statusText = 'Not Tradeable';
        } else if (material.missing > 0) {
            statusColor = '#ef4444'; // Red - missing materials
            // Show queued amount if any materials are reserved by queue
            const queuedText = material.queued > 0 ? ` (${formatters_js.formatWithSeparator(material.queued)} Q'd)` : '';
            statusText = `Missing: ${formatters_js.formatWithSeparator(material.missing)}${queuedText}`;
        } else {
            statusColor = '#4ade80'; // Green - sufficient materials
            statusText = 'Sufficient';
        }

        // Update text content
        const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
        if (badgeSpan) {
            // Title case: capitalize first letter of each word
            const titleCaseName = material.itemName
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            badgeSpan.innerHTML = `
            <div style="text-align: center;">
                <div>${titleCaseName}</div>
                <div style="font-size: 0.75em; color: ${statusColor};">
                    ${statusText}
                </div>
            </div>
        `;
        }

        // Gray out if not tradeable
        if (!material.isTradeable) {
            tab.style.opacity = '0.5';
            tab.style.cursor = 'not-allowed';
        }

        // Remove selected state
        tab.classList.remove('Mui-selected');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');

        // Add click handler
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!material.isTradeable) {
                // Not tradeable - do nothing
                return;
            }

            // Call the provided callback
            if (onClickCallback) {
                onClickCallback(e, material);
            }
        });

        return tab;
    }

    /**
     * Remove all custom material tabs from the marketplace
     */
    function removeMaterialTabs() {
        const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
        customTabs.forEach((tab) => tab.remove());
    }

    /**
     * Setup marketplace cleanup observer
     * Watches for marketplace panel removal and calls cleanup callback
     * @param {Function} onCleanup - Callback when marketplace closes, receives no args
     * @param {Array} tabsArray - Array reference to track tabs (will be checked for length)
     * @returns {Function} Unregister function to stop observing
     */
    function setupMarketplaceCleanupObserver(onCleanup, tabsArray) {
        let debounceTimer = null;

        const cleanupObserver = domObserverHelpers_js.createMutationWatcher(
            document.body,
            () => {
                // Only check if we have custom tabs
                if (!tabsArray || tabsArray.length === 0) {
                    return;
                }

                // Clear existing debounce timer
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                }

                // Debounce to avoid false positives from rapid DOM changes
                debounceTimer = setTimeout(() => {
                    // Check if we still have custom tabs
                    if (!tabsArray || tabsArray.length === 0) {
                        return;
                    }

                    // Check if our custom tabs still exist in the DOM
                    const hasCustomTabsInDOM = tabsArray.some((tab) => document.body.contains(tab));

                    // If our tabs were removed from DOM, clean up
                    if (!hasCustomTabsInDOM) {
                        if (onCleanup) {
                            onCleanup();
                        }
                        return;
                    }

                    // Check if marketplace navbar is active
                    const marketplaceNavActive = Array.from(document.querySelectorAll('.NavigationBar_nav__3uuUl')).some(
                        (nav) => {
                            const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
                            return svg && nav.classList.contains('NavigationBar_active__2Oj_e');
                        }
                    );

                    // Check if tabs container still exists (marketplace panel is open)
                    const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                    const hasMarketListingsTab =
                        tabsContainer &&
                        Array.from(tabsContainer.children).some((btn) => btn.textContent.includes('Market Listings'));

                    // Only cleanup if BOTH navbar is inactive AND marketplace tabs are gone
                    // This prevents cleanup during transitions when navbar might briefly be inactive
                    if (!marketplaceNavActive && !hasMarketListingsTab) {
                        if (onCleanup) {
                            onCleanup();
                        }
                    }
                }, 100);
            },
            {
                childList: true,
                subtree: true,
            }
        );

        // Return cleanup function that also clears the debounce timer
        return () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }
            cleanupObserver();
        };
    }

    /**
     * Get game object via React fiber
     * @returns {Object|null} Game component instance
     */
    function getGameObject() {
        const rootEl = document.getElementById('root');
        const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
        if (!rootFiber) return null;

        function find(fiber) {
            if (!fiber) return null;
            if (fiber.stateNode?.handleGoToMarketplace) return fiber.stateNode;
            return find(fiber.child) || find(fiber.sibling);
        }

        return find(rootFiber);
    }

    /**
     * Navigate to marketplace for a specific item
     * @param {string} itemHrid - Item HRID to navigate to
     * @param {number} enhancementLevel - Enhancement level (default 0)
     */
    function navigateToMarketplace(itemHrid, enhancementLevel = 0) {
        const game = getGameObject();
        if (game?.handleGoToMarketplace) {
            game.handleGoToMarketplace(itemHrid, enhancementLevel);
        }
        // Silently fail if game API unavailable - feature still provides value without auto-navigation
    }

    /**
     * Missing Materials Marketplace Button
     * Adds button to production panels that opens marketplace with tabs for missing materials
     */


    /**
     * Module-level state
     */
    let cleanupObserver = null;
    const currentMaterialsTabs = [];
    let domObserverUnregister = null;
    let processedPanels = new WeakSet();
    let inventoryUpdateHandler = null;
    let storedActionHrid = null;
    let storedNumActions = 0;
    const timerRegistry = timerRegistry_js.createTimerRegistry();
    const autofillManager = createAutofillManager('MissingMats-Actions');

    /**
     * Production action types (where button should appear)
     */
    const PRODUCTION_TYPES$1 = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * Initialize missing materials button feature
     */
    function initialize() {
        cleanupObserver = setupMarketplaceCleanupObserver(handleMarketplaceCleanup, currentMaterialsTabs);
        autofillManager.initialize();

        // Watch for action panels appearing
        domObserverUnregister = domObserver.onClass(
            'MissingMaterialsButton-ActionPanel',
            'SkillActionDetail_skillActionDetail',
            () => processActionPanels()
        );

        // Process existing panels
        processActionPanels();
    }

    /**
     * Cleanup function
     */
    function cleanup() {
        if (domObserverUnregister) {
            domObserverUnregister();
            domObserverUnregister = null;
        }

        // Disconnect marketplace cleanup observer
        if (cleanupObserver) {
            cleanupObserver();
            cleanupObserver = null;
        }

        autofillManager.cleanup();

        // Remove any existing custom tabs
        handleMarketplaceCleanup();

        // Clear processed panels
        processedPanels = new WeakSet();

        timerRegistry.clearAll();
    }

    /**
     * Process action panels - watch for input changes
     */
    function processActionPanels() {
        const panels = document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail"]');

        panels.forEach((panel) => {
            if (processedPanels.has(panel)) {
                return;
            }

            // Find the input box using utility
            const inputField = actionPanelHelper_js.findActionInput(panel);
            if (!inputField) {
                return;
            }

            // Mark as processed
            processedPanels.add(panel);

            // Attach input listeners using utility
            actionPanelHelper_js.attachInputListeners(panel, inputField, (value) => {
                updateButtonForPanel(panel, value);
            });

            // Initial update if there's already a value
            actionPanelHelper_js.performInitialUpdate(inputField, (value) => {
                updateButtonForPanel(panel, value);
            });
        });
    }

    /**
     * Update button visibility and content for a panel based on input value
     * @param {HTMLElement} panel - Action panel element
     * @param {string} value - Input value (number of actions)
     */
    function updateButtonForPanel(panel, value) {
        const numActions = parseInt(value) || 0;

        // Remove existing button
        const existingButton = panel.querySelector('#mwi-missing-mats-button');
        if (existingButton) {
            existingButton.remove();
        }

        // Don't show button if no quantity entered
        if (numActions <= 0) {
            return;
        }

        // Check setting early
        if (!config.getSetting('actions_missingMaterialsButton')) {
            return;
        }

        const actionHrid = getActionHridFromPanel(panel);
        if (!actionHrid) {
            return;
        }

        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];
        if (!actionDetail) {
            return;
        }

        // Verify this is a production action
        if (!PRODUCTION_TYPES$1.includes(actionDetail.type)) {
            return;
        }

        // Check if action has input materials
        if (!actionDetail.inputItems || actionDetail.inputItems.length === 0) {
            return;
        }

        // Get missing materials using shared utility
        // Check if user wants to ignore queue (default: false, meaning we DO account for queue)
        const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
        const accountForQueue = !ignoreQueue; // Invert: ignoreQueue=false means accountForQueue=true
        const missingMaterials = materialCalculator_js.calculateMaterialRequirements(actionHrid, numActions, accountForQueue);
        if (missingMaterials.length === 0) {
            return;
        }

        // Create and insert button with actionHrid and numActions for live updates
        const button = createMissingMaterialsButton(missingMaterials, actionHrid, numActions);

        // Find insertion point (beneath item requirements field)
        const itemRequirements = panel.querySelector('.SkillActionDetail_itemRequirements__3SPnA');
        if (itemRequirements) {
            itemRequirements.parentNode.insertBefore(button, itemRequirements.nextSibling);
        } else {
            // Fallback: insert at top of panel
            panel.insertBefore(button, panel.firstChild);
        }

        // Don't manipulate modal styling - let the game handle it
        // The modal will scroll naturally if content overflows
    }

    /**
     * Get action HRID from panel
     * @param {HTMLElement} panel - Action panel element
     * @returns {string|null} Action HRID or null
     */
    function getActionHridFromPanel(panel) {
        // Get action name from panel
        const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
        if (!actionNameElement) {
            return null;
        }

        // Read only direct text nodes to avoid picking up injected child spans
        // (e.g. inventory count display appends "(20 in inventory)" as a child span)
        const actionName = Array.from(actionNameElement.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join('')
            .trim();
        return getActionHridFromName(actionName);
    }

    /**
     * Convert action name to HRID
     * @param {string} actionName - Display name of action
     * @returns {string|null} Action HRID or null if not found
     */
    function getActionHridFromName(actionName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.actionDetailMap) {
            return null;
        }

        // Search for action by name
        for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
            if (detail.name === actionName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Create missing materials marketplace button
     * @param {Array} missingMaterials - Array of missing material objects
     * @param {string} actionHrid - Action HRID for recalculating materials
     * @param {number} numActions - Number of actions for recalculating materials
     * @returns {HTMLElement} Button element
     */
    function createMissingMaterialsButton(missingMaterials, actionHrid, numActions) {
        const button = document.createElement('button');
        button.id = 'mwi-missing-mats-button';
        button.textContent = 'Missing Mats Marketplace';
        button.style.cssText = `
        width: 100%;
        padding: 10px 16px;
        margin: 8px 0 16px 0;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    `;

        // Hover effect
        button.addEventListener('mouseenter', () => {
            button.style.background = 'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
            button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = 'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
            button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        // Click handler
        button.addEventListener('click', async () => {
            await handleMissingMaterialsClick(missingMaterials, actionHrid, numActions);
        });

        return button;
    }

    /**
     * Handle missing materials button click
     * @param {Array} missingMaterials - Array of missing material objects
     * @param {string} actionHrid - Action HRID for recalculating materials
     * @param {number} numActions - Number of actions for recalculating materials
     */
    async function handleMissingMaterialsClick(missingMaterials, actionHrid, numActions) {
        // Store context for live updates
        storedActionHrid = actionHrid;
        storedNumActions = numActions;

        // Navigate to marketplace
        const success = await openMarketplacePage();
        if (!success) {
            console.error('[MissingMats] Failed to navigate to marketplace');
            return;
        }

        // Wait a moment for marketplace to settle
        await new Promise((resolve) => {
            const delayTimeout = setTimeout(resolve, 200);
            timerRegistry.registerTimeout(delayTimeout);
        });

        // Create custom tabs
        createMissingMaterialTabs(missingMaterials);

        // Setup inventory listener for live updates
        setupInventoryListener();
    }

    /**
     * Navigate to marketplace by simulating click on navbar
     * @returns {Promise<boolean>} True if successful
     */
    async function openMarketplacePage() {
        // Find marketplace navbar button
        const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
        const marketplaceButton = Array.from(navButtons).find((nav) => {
            const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
            return svg !== null;
        });

        if (!marketplaceButton) {
            console.error('[MissingMats] Marketplace navbar button not found');
            return false;
        }

        // Simulate click
        marketplaceButton.click();

        // Wait for marketplace panel to appear
        return await waitForMarketplace();
    }

    /**
     * Wait for marketplace panel to appear
     * @returns {Promise<boolean>} True if marketplace appeared within timeout
     */
    async function waitForMarketplace() {
        const maxAttempts = 50;
        const delayMs = 100;

        for (let i = 0; i < maxAttempts; i++) {
            // Check for marketplace panel by looking for tabs container
            const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
            if (tabsContainer) {
                // Verify it's the marketplace tabs (has "Market Listings" tab)
                const hasMarketListings = Array.from(tabsContainer.children).some((btn) =>
                    btn.textContent.includes('Market Listings')
                );
                if (hasMarketListings) {
                    return true;
                }
            }

            await new Promise((resolve) => {
                const delayTimeout = setTimeout(resolve, delayMs);
                timerRegistry.registerTimeout(delayTimeout);
            });
        }

        console.error('[MissingMats] Marketplace did not open within timeout');
        return false;
    }

    /**
     * Create custom tabs for missing materials
     * @param {Array} missingMaterials - Array of missing material objects
     */
    function createMissingMaterialTabs(missingMaterials) {
        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');

        if (!tabsContainer) {
            console.error('[MissingMats] Tabs container not found');
            return;
        }

        // Remove any existing custom tabs first
        handleMarketplaceCleanup();

        // Get reference tab for cloning (use "My Listings" as template)
        const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));

        if (!referenceTab) {
            console.error('[MissingMats] Reference tab not found');
            return;
        }

        // Enable flex wrapping for multiple rows (like game's native tabs)
        if (tabsContainer) {
            tabsContainer.style.flexWrap = 'wrap';
        }

        // Use event delegation on tabs container to clear quantity when regular tabs are clicked
        // This avoids memory leaks from adding listeners to each tab repeatedly
        if (!tabsContainer.hasAttribute('data-mwi-delegated-listener')) {
            tabsContainer.setAttribute('data-mwi-delegated-listener', 'true');
            tabsContainer.addEventListener('click', (e) => {
                // Check if clicked element is a regular tab (not our custom tab)
                const clickedTab = e.target.closest('button');
                if (clickedTab && !clickedTab.hasAttribute('data-mwi-custom-tab')) {
                    autofillManager.clearQuantity();
                }
            });
        }

        // Create tab for each missing material
        currentMaterialsTabs.length = 0; // Clear without reassigning (preserves observer reference)
        for (const material of missingMaterials) {
            const tab = createMaterialTab(material, referenceTab, (_e, mat) => {
                // Store the missing quantity for auto-fill when buy modal opens
                autofillManager.setQuantity(mat.missing);
                // Navigate to marketplace
                navigateToMarketplace(mat.itemHrid, 0);
            });
            tabsContainer.appendChild(tab);
            currentMaterialsTabs.push(tab);
        }
    }

    /**
     * Setup inventory listener for live tab updates
     * Listens for inventory changes via websocket and updates tabs accordingly
     */
    function setupInventoryListener() {
        // Remove existing listener if any
        if (inventoryUpdateHandler) {
            webSocketHook.off('*', inventoryUpdateHandler);
        }

        // Create new listener that watches for inventory-related messages
        inventoryUpdateHandler = (data) => {
            // Check if this message might affect inventory
            // Common message types that update inventory:
            // - item_added, item_removed, items_updated
            // - market_buy_complete, market_sell_complete
            // - Or any message with inventory field
            if (
                data.type?.includes('item') ||
                data.type?.includes('inventory') ||
                data.type?.includes('market') ||
                data.inventory ||
                data.characterItems
            ) {
                updateTabsOnInventoryChange();
            }
        };

        webSocketHook.on('*', inventoryUpdateHandler);
    }

    /**
     * Update all custom tabs when inventory changes
     * Recalculates materials and updates badge display
     */
    function updateTabsOnInventoryChange() {
        // Check if we have valid context
        if (!storedActionHrid || storedNumActions <= 0) {
            return;
        }

        // Check if tabs still exist
        if (currentMaterialsTabs.length === 0) {
            return;
        }

        // Recalculate materials with current inventory (respecting queue setting)
        const ignoreQueue = config.getSetting('actions_missingMaterialsButton_ignoreQueue') || false;
        const accountForQueue = !ignoreQueue;
        const updatedMaterials = materialCalculator_js.calculateMaterialRequirements(storedActionHrid, storedNumActions, accountForQueue);

        // Update each existing tab
        currentMaterialsTabs.forEach((tab) => {
            const itemHrid = tab.getAttribute('data-item-hrid');
            const material = updatedMaterials.find((m) => m.itemHrid === itemHrid);

            if (material) {
                updateTabBadge(tab, material);
            }
        });
    }

    /**
     * Update a single tab's badge with new material data
     * @param {HTMLElement} tab - Tab element to update
     * @param {Object} material - Material object with updated counts
     */
    function updateTabBadge(tab, material) {
        const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
        if (!badgeSpan) {
            return;
        }

        // Color coding:
        // - Red: Missing materials (missing > 0)
        // - Green: Sufficient materials (missing = 0)
        // - Gray: Not tradeable
        let statusColor;
        let statusText;

        if (!material.isTradeable) {
            statusColor = '#888888'; // Gray - not tradeable
            statusText = 'Not Tradeable';
        } else if (material.missing > 0) {
            statusColor = '#ef4444'; // Red - missing materials
            // Show queued amount if any materials are reserved by queue
            const queuedText = material.queued > 0 ? ` (${formatters_js.formatWithSeparator(material.queued)} Q'd)` : '';
            statusText = `Missing: ${formatters_js.formatWithSeparator(material.missing)}${queuedText}`;
        } else {
            statusColor = '#4ade80'; // Green - sufficient materials
            statusText = 'Sufficient';
        }

        // Title case: capitalize first letter of each word
        const titleCaseName = material.itemName
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        // Update badge HTML
        badgeSpan.innerHTML = `
        <div style="text-align: center;">
            <div>${titleCaseName}</div>
            <div style="font-size: 0.75em; color: ${statusColor};">
                ${statusText}
            </div>
        </div>
    `;

        // Update tab styling based on state
        if (!material.isTradeable) {
            tab.style.opacity = '0.5';
            tab.style.cursor = 'not-allowed';
        } else {
            tab.style.opacity = '1';
            tab.style.cursor = 'pointer';
            tab.title = '';
        }
    }

    /**
     * Handle marketplace cleanup (when leaving marketplace)
     * Called by the marketplace cleanup observer
     */
    function handleMarketplaceCleanup() {
        removeMaterialTabs();
        currentMaterialsTabs.length = 0; // Clear without reassigning (preserves observer reference)

        // Clean up inventory listener
        if (inventoryUpdateHandler) {
            webSocketHook.off('*', inventoryUpdateHandler);
            inventoryUpdateHandler = null;
        }

        // Clear stored context
        storedActionHrid = null;
        storedNumActions = 0;
        autofillManager.clearQuantity();
    }

    var missingMaterialsButton = {
        initialize,
        cleanup,
    };

    /**
     * Tea Optimizer Utility
     * Calculates optimal tea combinations for XP or Gold optimization
     */


    // Skill name to action type mapping
    const SKILL_TO_ACTION_TYPE = {
        milking: '/action_types/milking',
        foraging: '/action_types/foraging',
        woodcutting: '/action_types/woodcutting',
        cheesesmithing: '/action_types/cheesesmithing',
        crafting: '/action_types/crafting',
        tailoring: '/action_types/tailoring',
        cooking: '/action_types/cooking',
        brewing: '/action_types/brewing',
        alchemy: '/action_types/alchemy',
    };

    const GATHERING_SKILLS = ['milking', 'foraging', 'woodcutting'];
    const PRODUCTION_SKILLS = ['cheesesmithing', 'crafting', 'tailoring', 'cooking', 'brewing', 'alchemy'];

    /**
     * Get all relevant teas for a skill and optimization goal
     * Returns teas grouped by exclusivity (skill teas are mutually exclusive)
     * @param {string} skillName - Skill name (e.g., 'milking')
     * @param {string} goal - 'xp' or 'gold'
     * @returns {Object} { skillTeas: [], generalTeas: [] }
     */
    function getRelevantTeas(skillName, goal) {
        const skill = skillName.toLowerCase();
        const isGathering = GATHERING_SKILLS.includes(skill);

        // Skill-specific teas (mutually exclusive - can only equip ONE)
        const skillTeas = [`/items/${skill}_tea`, `/items/super_${skill}_tea`, `/items/ultra_${skill}_tea`];

        // General teas (can equip any combination)
        const generalTeas = new Set();

        // Universal efficiency tea
        generalTeas.add('/items/efficiency_tea');

        // Artisan tea - action level helps everyone, artisan buff helps production gold
        generalTeas.add('/items/artisan_tea');

        if (goal === 'xp') {
            // Wisdom tea for XP multiplier
            generalTeas.add('/items/wisdom_tea');
        } else if (goal === 'gold') {
            if (isGathering) {
                // Gathering-specific gold teas
                generalTeas.add('/items/gathering_tea');
                generalTeas.add('/items/processing_tea');
            } else if (skill === 'cooking' || skill === 'brewing') {
                // Gourmet tea only applies to cooking and brewing
                generalTeas.add('/items/gourmet_tea');
            }
        }

        // Filter to only teas that exist in game data
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) {
            return { skillTeas: [], generalTeas: [] };
        }

        return {
            skillTeas: skillTeas.filter((hrid) => gameData.itemDetailMap[hrid]),
            generalTeas: Array.from(generalTeas).filter((hrid) => gameData.itemDetailMap[hrid]),
        };
    }

    /**
     * Generate all valid tea combinations respecting exclusivity rules
     * - Can only use ONE skill-specific tea (mutually exclusive)
     * - Can use any combination of general teas
     * - Max 3 teas total
     * @param {Object} teaGroups - { skillTeas: [], generalTeas: [] }
     * @returns {Array<Array<string>>} Array of valid tea combinations
     */
    function generateCombinations(teaGroups) {
        const { skillTeas, generalTeas } = teaGroups;
        const combinations = [];

        // Helper to add combination if valid
        const addCombo = (combo) => {
            if (combo.length > 0 && combo.length <= 3) {
                combinations.push(combo);
            }
        };

        // Option 1: No skill tea, only general teas (1-3 general teas)
        for (let i = 0; i < generalTeas.length; i++) {
            addCombo([generalTeas[i]]);
            for (let j = i + 1; j < generalTeas.length; j++) {
                addCombo([generalTeas[i], generalTeas[j]]);
                for (let k = j + 1; k < generalTeas.length; k++) {
                    addCombo([generalTeas[i], generalTeas[j], generalTeas[k]]);
                }
            }
        }

        // Option 2: One skill tea + general teas (1 skill + 0-2 general)
        for (const skillTea of skillTeas) {
            // Just skill tea alone
            addCombo([skillTea]);

            // Skill tea + 1 general tea
            for (let i = 0; i < generalTeas.length; i++) {
                addCombo([skillTea, generalTeas[i]]);

                // Skill tea + 2 general teas
                for (let j = i + 1; j < generalTeas.length; j++) {
                    addCombo([skillTea, generalTeas[i], generalTeas[j]]);
                }
            }
        }

        return combinations;
    }

    /**
     * Parse tea buffs from a tea combination
     * @param {Array<string>} teaHrids - Array of tea item HRIDs
     * @param {Object} itemDetailMap - Item details from game data
     * @param {number} drinkConcentration - Drink concentration as decimal
     * @returns {Object} Aggregated buff values
     */
    function parseTeaBuffs(teaHrids, itemDetailMap, drinkConcentration) {
        const buffs = {
            efficiency: 0,
            wisdom: 0,
            gathering: 0,
            processing: 0,
            artisan: 0,
            gourmet: 0,
            actionLevel: 0,
            skillLevels: {}, // skill name → level bonus
        };

        for (const teaHrid of teaHrids) {
            const itemDetails = itemDetailMap[teaHrid];
            if (!itemDetails?.consumableDetail?.buffs) continue;

            for (const buff of itemDetails.consumableDetail.buffs) {
                const baseValue = buff.flatBoost || 0;
                const scaledValue = baseValue * (1 + drinkConcentration);

                switch (buff.typeHrid) {
                    case '/buff_types/efficiency':
                        buffs.efficiency += scaledValue * 100; // Convert to percentage
                        break;
                    case '/buff_types/wisdom':
                        buffs.wisdom += scaledValue * 100;
                        break;
                    case '/buff_types/gathering':
                        buffs.gathering += scaledValue;
                        break;
                    case '/buff_types/processing':
                        buffs.processing += scaledValue;
                        break;
                    case '/buff_types/artisan':
                        buffs.artisan += scaledValue;
                        break;
                    case '/buff_types/gourmet':
                        buffs.gourmet += scaledValue;
                        break;
                    case '/buff_types/action_level':
                        buffs.actionLevel += scaledValue;
                        break;
                    default:
                        // Check for skill level buffs (e.g., /buff_types/milking_level)
                        if (buff.typeHrid.endsWith('_level')) {
                            const skillMatch = buff.typeHrid.match(/\/buff_types\/(\w+)_level/);
                            if (skillMatch) {
                                const skill = skillMatch[1];
                                buffs.skillLevels[skill] = (buffs.skillLevels[skill] || 0) + scaledValue;
                            }
                        }
                }
            }
        }

        return buffs;
    }

    /**
     * Calculate XP/hour for an action with a specific tea combination
     * @param {Object} actionDetails - Action details from game data
     * @param {Object} buffs - Parsed tea buffs
     * @param {number} playerLevel - Player's skill level
     * @param {Object} otherEfficiency - Other efficiency sources (house, equipment, etc.)
     * @param {Object} context - Additional context (equipment, itemDetailMap)
     * @returns {number} XP per hour
     */
    function calculateXpPerHour(actionDetails, buffs, playerLevel, otherEfficiency, context) {
        if (!actionDetails.experienceGain?.value) {
            return 0;
        }

        const { equipment, itemDetailMap } = context;
        const requiredLevel = actionDetails.levelRequirement?.level || 1;
        const skillName = actionDetails.type.split('/').pop();

        // Calculate tea skill level bonus for this skill
        const teaSkillLevelBonus = buffs.skillLevels[skillName] || 0;

        // Get equipment speed bonus
        const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

        // Get equipment efficiency bonus
        const equipmentEfficiencyBonus = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

        // Calculate efficiency breakdown
        const efficiencyData = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: playerLevel,
            teaSkillLevelBonus,
            actionLevelBonus: buffs.actionLevel,
            houseEfficiency: otherEfficiency.house || 0,
            equipmentEfficiency: equipmentEfficiencyBonus,
            teaEfficiency: buffs.efficiency,
            communityEfficiency: otherEfficiency.community || 0,
            achievementEfficiency: otherEfficiency.achievement || 0,
        });

        const totalEfficiency = efficiencyData.totalEfficiency;
        const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate actions per hour with equipment speed bonus
        const baseTime = (actionDetails.baseTimeCost || 3e9) / 1e9;
        const actionTime = baseTime / (1 + equipmentSpeedBonus);
        const baseActionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);
        const actionsPerHour = profitHelpers_js.calculateEffectiveActionsPerHour(baseActionsPerHour, efficiencyMultiplier);

        // Get the FULL XP multiplier from all sources
        const skillHrid = actionDetails.experienceGain.skillHrid;
        const currentXpData = experienceParser_js.calculateExperienceMultiplier(skillHrid, actionDetails.type);

        // Replace current tea wisdom with our calculated tea wisdom
        const currentTeaWisdom = currentXpData.breakdown?.consumableWisdom || 0;
        const baseWisdomWithoutTea = currentXpData.totalWisdom - currentTeaWisdom;
        const totalWisdomWithOurTea = baseWisdomWithoutTea + buffs.wisdom;
        const charmExperience = currentXpData.charmExperience || 0;
        const xpMultiplier = 1 + totalWisdomWithOurTea / 100 + charmExperience / 100;

        // XP per hour
        const baseXp = actionDetails.experienceGain.value;
        return actionsPerHour * baseXp * xpMultiplier;
    }

    /**
     * Calculate Gold/hour for a gathering action with a specific tea combination
     * @param {Object} actionDetails - Action details from game data
     * @param {Object} buffs - Parsed tea buffs
     * @param {number} playerLevel - Player's skill level
     * @param {Object} otherEfficiency - Other efficiency sources
     * @param {Object} gameData - Full game data
     * @param {Object} context - Additional context (equipment, itemDetailMap)
     * @returns {number} Gold per hour (profit after market tax)
     */
    function calculateGatheringGoldPerHour(actionDetails, buffs, playerLevel, otherEfficiency, gameData, context) {
        const { equipment, itemDetailMap } = context;
        const requiredLevel = actionDetails.levelRequirement?.level || 1;
        const skillName = actionDetails.type.split('/').pop();

        // Calculate tea skill level bonus for this skill
        const teaSkillLevelBonus = buffs.skillLevels[skillName] || 0;

        // Get equipment speed bonus
        const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

        // Get equipment efficiency bonus
        const equipmentEfficiencyBonus = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

        // Calculate efficiency
        const efficiencyData = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: playerLevel,
            teaSkillLevelBonus,
            actionLevelBonus: buffs.actionLevel,
            houseEfficiency: otherEfficiency.house || 0,
            equipmentEfficiency: equipmentEfficiencyBonus,
            teaEfficiency: buffs.efficiency,
            communityEfficiency: otherEfficiency.community || 0,
            achievementEfficiency: otherEfficiency.achievement || 0,
        });

        const totalEfficiency = efficiencyData.totalEfficiency;
        const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate actions per hour (with speed bonus, WITHOUT efficiency - efficiency applied to outputs)
        const baseTime = (actionDetails.baseTimeCost || 3e9) / 1e9;
        const actionTime = baseTime / (1 + equipmentSpeedBonus);
        const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);

        // Calculate revenue from drops
        let totalRevenue = 0;
        const dropTable = actionDetails.dropTable || [];
        const gatheringBonus = 1 + buffs.gathering + (otherEfficiency.gathering || 0);

        for (const drop of dropTable) {
            const dropRate = drop.dropRate || 1;
            const minCount = drop.minCount || 1;
            const maxCount = drop.maxCount || minCount;
            const avgCount = (minCount + maxCount) / 2;

            // Apply gathering bonus to quantity
            const avgAmountPerAction = avgCount * gatheringBonus;

            // Get item price (use 'sell' side for output items to match tile calculation)
            const rawPrice = marketData_js.getItemPrice(drop.itemHrid, { context: 'profit', side: 'sell' }) || 0;

            // Check for processing conversion
            if (buffs.processing > 0) {
                const processedData = findProcessingConversion(drop.itemHrid, gameData);
                if (processedData) {
                    const processedPrice =
                        marketData_js.getItemPrice(processedData.outputItemHrid, { context: 'profit', side: 'sell' }) || 0;
                    const conversionRatio = processedData.conversionRatio;

                    // Processing Tea check happens per action:
                    // If procs (processingBonus% chance): Convert to processed
                    const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);

                    // Expected processed items per action
                    const processedPerAction = buffs.processing * processedIfProcs;

                    // Net processing bonus = processed value - cost of raw converted
                    const processingNetValue =
                        actionsPerHour *
                        dropRate *
                        efficiencyMultiplier *
                        (processedPerAction * (processedPrice - conversionRatio * rawPrice));

                    // Total = base raw revenue + processing net gain
                    const baseRawItemsPerHour = actionsPerHour * dropRate * avgAmountPerAction * efficiencyMultiplier;
                    totalRevenue += baseRawItemsPerHour * rawPrice + processingNetValue;
                    continue;
                }
            }

            // No processing - simple calculation
            const itemsPerHour = actionsPerHour * dropRate * avgAmountPerAction * efficiencyMultiplier;
            totalRevenue += itemsPerHour * rawPrice;
        }

        // Add bonus revenue from essence and rare find drops
        const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetails, actionsPerHour, equipment, itemDetailMap);
        const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;
        totalRevenue += efficiencyBoostedBonusRevenue;

        // Apply market tax (2%)
        const MARKET_TAX = 0.02;
        const profitPerHour = totalRevenue * (1 - MARKET_TAX);

        return profitPerHour;
    }

    /**
     * Calculate Gold/hour for a production action with a specific tea combination
     * @param {Object} actionDetails - Action details from game data
     * @param {Object} buffs - Parsed tea buffs
     * @param {number} playerLevel - Player's skill level
     * @param {Object} otherEfficiency - Other efficiency sources
     * @param {Object} gameData - Full game data
     * @param {Object} context - Additional context (equipment, itemDetailMap)
     * @returns {number} Gold per hour (profit after market tax)
     */
    function calculateProductionGoldPerHour(actionDetails, buffs, playerLevel, otherEfficiency, gameData, context) {
        const { equipment, itemDetailMap } = context;
        const requiredLevel = actionDetails.levelRequirement?.level || 1;
        const skillName = actionDetails.type.split('/').pop();

        // Calculate tea skill level bonus for this skill
        const teaSkillLevelBonus = buffs.skillLevels[skillName] || 0;

        // Get equipment speed bonus
        const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

        // Get equipment efficiency bonus
        const equipmentEfficiencyBonus = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

        // Calculate efficiency
        const efficiencyData = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: playerLevel,
            teaSkillLevelBonus,
            actionLevelBonus: buffs.actionLevel,
            houseEfficiency: otherEfficiency.house || 0,
            equipmentEfficiency: equipmentEfficiencyBonus,
            teaEfficiency: buffs.efficiency,
            communityEfficiency: otherEfficiency.community || 0,
            achievementEfficiency: otherEfficiency.achievement || 0,
        });

        const totalEfficiency = efficiencyData.totalEfficiency;
        const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate actions per hour (with speed bonus, WITHOUT efficiency - efficiency applied to outputs)
        const baseTime = (actionDetails.baseTimeCost || 3e9) / 1e9;
        const actionTime = baseTime / (1 + equipmentSpeedBonus);
        const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);

        // Calculate input costs (with artisan reduction for regular inputs)
        // Use 'buy' side for inputs to match tile calculation
        let inputCost = 0;
        const artisanReduction = 1 - buffs.artisan;

        // Add upgrade item cost (NOT affected by Artisan Tea)
        if (actionDetails.upgradeItemHrid) {
            let upgradePrice = marketData_js.getItemPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' }) || 0;
            // Special case: Coins have no market price but have face value of 1
            if (actionDetails.upgradeItemHrid === '/items/coin' && upgradePrice === 0) {
                upgradePrice = 1;
            }
            inputCost += upgradePrice; // Always 1 upgrade item, no artisan reduction
        }

        // Add regular input item costs (affected by Artisan Tea)
        for (const input of actionDetails.inputItems || []) {
            let price = marketData_js.getItemPrice(input.itemHrid, { context: 'profit', side: 'buy' }) || 0;
            // Special case: Coins have no market price but have face value of 1
            if (input.itemHrid === '/items/coin' && price === 0) {
                price = 1;
            }
            const effectiveCount = input.count * artisanReduction;
            inputCost += price * effectiveCount;
        }

        // Calculate output revenue (with gourmet bonus - only for cooking/brewing)
        // Use 'sell' side for outputs to match tile calculation
        let outputRevenue = 0;
        const isCookingOrBrewing =
            actionDetails.type === '/action_types/cooking' || actionDetails.type === '/action_types/brewing';
        const gourmetBonus = isCookingOrBrewing ? 1 + buffs.gourmet : 1;
        for (const output of actionDetails.outputItems || []) {
            const price = marketData_js.getItemPrice(output.itemHrid, { context: 'profit', side: 'sell' }) || 0;
            const effectiveCount = output.count * gourmetBonus;
            outputRevenue += price * effectiveCount;
        }

        // Profit per action (before market tax)
        const profitPerAction = outputRevenue - inputCost;

        // Profit per hour (with efficiency applied once)
        const grossProfitPerHour = actionsPerHour * profitPerAction * efficiencyMultiplier;

        // Add bonus revenue from essence and rare find drops (same as tile calculation)
        const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetails, actionsPerHour, equipment, itemDetailMap);
        const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

        // Apply market tax (2%) to revenue portion only (including bonus revenue)
        const MARKET_TAX = 0.02;
        const revenuePerHour = actionsPerHour * outputRevenue * efficiencyMultiplier;
        const marketTax = (revenuePerHour + efficiencyBoostedBonusRevenue) * MARKET_TAX;
        const netProfitPerHour = grossProfitPerHour + efficiencyBoostedBonusRevenue - marketTax;

        return netProfitPerHour;
    }

    /**
     * Find processing conversion for an item
     * @param {string} itemHrid - Item HRID
     * @param {Object} gameData - Game data
     * @returns {Object|null} Conversion data or null
     */
    function findProcessingConversion(itemHrid, gameData) {
        const validProcessingTypes = ['/action_types/cheesesmithing', '/action_types/crafting', '/action_types/tailoring'];

        for (const [_actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (!validProcessingTypes.includes(action.type)) continue;

            const inputItem = action.inputItems?.[0];
            const outputItem = action.outputItems?.[0];

            if (inputItem?.itemHrid === itemHrid && outputItem) {
                return {
                    outputItemHrid: outputItem.itemHrid,
                    conversionRatio: inputItem.count,
                };
            }
        }

        return null;
    }

    /**
     * Get all actions for a skill that the player can do
     * @param {string} skillName - Skill name
     * @param {number} playerLevel - Player's skill level
     * @returns {Array<Object>} Array of action details
     */
    /**
     * Get all actions for a skill, separating available from excluded
     * @param {string} skillName - Skill name
     * @param {number} playerLevel - Player's skill level
     * @returns {Object} { available: [], excluded: [] } with exclusion reasons
     */
    function getActionsForSkill(skillName, playerLevel) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.actionDetailMap) return { available: [], excluded: [] };

        const actionType = SKILL_TO_ACTION_TYPE[skillName.toLowerCase()];
        if (!actionType) return { available: [], excluded: [] };

        const available = [];
        const excluded = [];

        for (const [_hrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (action.type !== actionType) {
                continue;
            }

            const requiredLevel = action.levelRequirement?.level || 1;
            if (playerLevel >= requiredLevel) {
                available.push(action);
            } else {
                excluded.push({
                    action,
                    reason: 'level',
                    requiredLevel,
                });
            }
        }

        return { available, excluded };
    }

    /**
     * Calculate tea consumption cost per hour for a tea combination
     * Uses the same pricing logic as the tile calculation
     * @param {Array<string>} teaHrids - Array of tea item HRIDs
     * @param {number} drinkConcentration - Drink concentration as decimal
     * @returns {number} Total tea cost per hour
     */
    function calculateTeaCostPerHour(teaHrids, drinkConcentration) {
        const drinksPerHour = profitHelpers_js.calculateDrinksPerHour(drinkConcentration);
        let totalCost = 0;

        for (const teaHrid of teaHrids) {
            // Use getItemPrice with 'profit' context and 'buy' side to match tile calculation
            const price = marketData_js.getItemPrice(teaHrid, { context: 'profit', side: 'buy' }) || 0;
            totalCost += price * drinksPerHour;
        }

        return totalCost;
    }

    /**
     * Get other efficiency sources (non-tea)
     * @param {string} actionType - Action type HRID
     * @returns {Object} Other efficiency values
     */
    function getOtherEfficiencySources(actionType) {
        dataManager.getEquipment();
        const houseRoomsMap = dataManager.getHouseRooms();
        const houseRooms = houseRoomsMap ? Array.from(houseRoomsMap.values()) : [];
        const gameData = dataManager.getInitClientData();

        const result = {
            house: 0,
            equipment: 0,
            community: 0,
            achievement: 0,
            wisdom: 0,
            gathering: 0,
        };

        if (!gameData) return result;

        // House efficiency
        if (houseRooms) {
            for (const room of houseRooms) {
                const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
                if (roomDetail?.usableInActionTypeMap?.[actionType]) {
                    result.house += (room.level || 0) * 1.5;
                }
            }
        }

        // Community efficiency buff - use production_efficiency for production skills
        // Match the tile's calculation from profit-calculator.js
        const isProductionType = PRODUCTION_SKILLS.some((skill) => actionType.includes(skill));
        const communityBuffType = isProductionType
            ? '/community_buff_types/production_efficiency'
            : '/community_buff_types/efficiency';
        const communityEffLevel = dataManager.getCommunityBuffLevel(communityBuffType);
        if (communityEffLevel) {
            // Get buff definition from game data for accurate calculation
            const buffDef = gameData.communityBuffTypeDetailMap?.[communityBuffType];
            if (buffDef?.usableInActionTypeMap?.[actionType] && buffDef?.buff) {
                // Formula: flatBoost + (level - 1) × flatBoostLevelBonus
                const baseBonus = (buffDef.buff.flatBoost || 0) * 100;
                const levelBonus = (communityEffLevel - 1) * (buffDef.buff.flatBoostLevelBonus || 0) * 100;
                result.community = baseBonus + levelBonus;
            } else {
                // Fallback to old formula if buff doesn't apply to this action
                result.community = 0;
            }
        }

        // Community gathering buff
        const communityGatheringLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
        if (communityGatheringLevel) {
            result.gathering = 0.2 + (communityGatheringLevel - 1) * 0.005;
        }

        // Achievement gathering buff (stacks with community gathering)
        const achievementGathering = dataManager.getAchievementBuffFlatBoost(actionType, '/buff_types/gathering');
        result.gathering += achievementGathering;

        // Community wisdom buff
        const communityWisdomLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
        if (communityWisdomLevel) {
            result.wisdom = 20 + (communityWisdomLevel - 1) * 0.5;
        }

        // Achievement buffs
        result.achievement = dataManager.getAchievementBuffFlatBoost(actionType, '/buff_types/efficiency') * 100;

        // Equipment efficiency (simplified - would need full parser for accuracy)
        // For now, we'll skip this as it requires more complex parsing

        return result;
    }

    /**
     * Find optimal tea combination for a skill and goal
     * @param {string} skillName - Skill name (e.g., 'Milking')
     * @param {string} goal - 'xp' or 'gold'
     * @param {string|null} locationName - Optional location name to filter actions (e.g., "Silly Cow Valley")
     * @returns {Object} Optimization result
     */
    function findOptimalTeas(skillName, goal, locationName = null) {
        const normalizedSkill = skillName.toLowerCase();
        const isGathering = GATHERING_SKILLS.includes(normalizedSkill);
        const isProduction = PRODUCTION_SKILLS.includes(normalizedSkill);

        if (!isGathering && !isProduction) {
            return { error: `Unknown skill: ${skillName}` };
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) {
            return { error: 'Game data not loaded' };
        }

        // Get player's skill level
        const skills = dataManager.getSkills();
        const skillHrid = `/skills/${normalizedSkill}`;
        let playerLevel = 1;
        for (const skill of skills || []) {
            if (skill.skillHrid === skillHrid) {
                playerLevel = skill.level;
                break;
            }
        }

        // Get drink concentration
        const equipment = dataManager.getEquipment();
        const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

        // Get relevant teas and generate combinations
        const relevantTeas = getRelevantTeas(normalizedSkill, goal);
        const combinations = generateCombinations(relevantTeas);

        // Get actions for this skill (available and excluded)
        const actionData = getActionsForSkill(normalizedSkill, playerLevel);
        let actions = actionData.available;
        let excludedActions = actionData.excluded;

        // Filter to specific location if provided (using game data category)
        if (locationName && gameData.actionCategoryDetailMap) {
            // Find the category HRID that matches this location name AND skill
            // Multiple skills can have categories with the same name (e.g., "Material" exists for both Tailoring and Cheesesmithing)
            // So we need to match the skill-specific category path
            let targetCategoryHrid = null;
            const skillPrefix = `/action_categories/${normalizedSkill}/`;

            for (const [categoryHrid, categoryDetail] of Object.entries(gameData.actionCategoryDetailMap)) {
                // Match both the category name AND ensure it's for the correct skill
                if (categoryDetail.name === locationName && categoryHrid.startsWith(skillPrefix)) {
                    targetCategoryHrid = categoryHrid;
                    break;
                }
            }

            // Filter actions to only those in this category
            if (targetCategoryHrid) {
                // Filter available actions
                actions = actions.filter((action) => action.category === targetCategoryHrid);

                // Also filter excluded actions to same category (so we only show relevant excluded items)
                excludedActions = excludedActions.filter((item) => item.action.category === targetCategoryHrid);
            }
        }

        // Check if there are no available actions (even if there are excluded ones)
        if (actions.length === 0) {
            const locationSuffix = locationName ? ` at ${locationName}` : '';
            if (excludedActions.length > 0) {
                const lowestLevel = Math.min(...excludedActions.map((item) => item.requiredLevel));
                return {
                    error: `No actions available for ${skillName}${locationSuffix} at level ${playerLevel}. All actions require level ${lowestLevel}+.`,
                };
            } else {
                return { error: `No actions available for ${skillName}${locationSuffix} at level ${playerLevel}` };
            }
        }

        // Get other efficiency sources
        const actionType = SKILL_TO_ACTION_TYPE[normalizedSkill];
        const otherEfficiency = getOtherEfficiencySources(actionType);

        // Score each combination
        const results = [];

        // Create context for calculations
        const calcContext = {
            equipment,
            itemDetailMap: gameData.itemDetailMap,
        };

        for (const combo of combinations) {
            const buffs = parseTeaBuffs(combo, gameData.itemDetailMap, drinkConcentration);

            // Calculate tea cost per hour for this combo (only matters for gold goal)
            const teaCostPerHour = goal === 'gold' ? calculateTeaCostPerHour(combo, drinkConcentration) : 0;

            let totalScore = 0;
            let profitableCount = 0;
            const actionScores = [];

            for (const action of actions) {
                let score;
                if (goal === 'xp') {
                    score = calculateXpPerHour(action, buffs, playerLevel, otherEfficiency, calcContext);
                    totalScore += score;
                } else if (isGathering) {
                    score = calculateGatheringGoldPerHour(
                        action,
                        buffs,
                        playerLevel,
                        otherEfficiency,
                        gameData,
                        calcContext
                    );
                    // Deduct tea costs from gold score
                    score -= teaCostPerHour;
                    // Only include profitable actions in gold calculations
                    if (score > 0) {
                        totalScore += score;
                        profitableCount++;
                    }
                } else {
                    score = calculateProductionGoldPerHour(
                        action,
                        buffs,
                        playerLevel,
                        otherEfficiency,
                        gameData,
                        calcContext
                    );
                    // Deduct tea costs from gold score
                    score -= teaCostPerHour;
                    // Only include profitable actions in gold calculations
                    if (score > 0) {
                        totalScore += score;
                        profitableCount++;
                    }
                }

                actionScores.push({ action: action.name, score });
            }

            // For gold, average across profitable actions only; for XP, average across all
            const avgDivisor = goal === 'gold' ? profitableCount || 1 : actions.length;

            results.push({
                teas: combo,
                totalScore,
                avgScore: totalScore / avgDivisor,
                actionScores,
                buffs,
                teaCostPerHour,
                profitableCount, // Track how many actions are profitable
            });
        }

        // Sort by total score (descending)
        results.sort((a, b) => b.totalScore - a.totalScore);

        // Get tea names for display
        const getTeaName = (hrid) => gameData.itemDetailMap[hrid]?.name || hrid;

        // Format excluded actions for display
        const excludedForDisplay = excludedActions
            .map((item) => ({
                action: item.action.name,
                reason: item.reason,
                requiredLevel: item.requiredLevel,
            }))
            .sort((a, b) => a.requiredLevel - b.requiredLevel);

        // Handle case where no actions are available (all excluded by level)
        if (results.length === 0 || !results[0]) {
            return {
                optimal: null,
                isConsistent: false,
                skill: skillName,
                goal,
                playerLevel,
                drinkConcentration,
                otherEfficiency,
                actionsEvaluated: 0,
                profitableActionsCount: 0,
                combinationsEvaluated: combinations.length,
                allResults: [],
                excludedActions: excludedForDisplay,
                teaCostPerHour: 0,
            };
        }

        // Check if top result is consistent across all actions
        const topResult = results[0];
        const isConsistent = topResult.actionScores.every((as, _i, _arr) => {
            return as.score > 0;
        });

        return {
            optimal: {
                teas: topResult.teas.map((hrid) => ({
                    hrid,
                    name: getTeaName(hrid),
                })),
                totalScore: topResult.totalScore,
                avgScore: topResult.avgScore,
                actionScores: topResult.actionScores,
                buffs: topResult.buffs, // Include for UI debugging
                profitableCount: topResult.profitableCount, // How many actions are profitable
            },
            isConsistent,
            skill: skillName,
            goal,
            playerLevel,
            drinkConcentration,
            otherEfficiency,
            actionsEvaluated: actions.length,
            profitableActionsCount: topResult.profitableCount, // For display in stats
            combinationsEvaluated: combinations.length,
            allResults: results.slice(0, 5).map((r) => ({
                teas: r.teas.map(getTeaName),
                avgScore: r.avgScore,
                teaCostPerHour: r.teaCostPerHour,
            })),
            excludedActions: excludedForDisplay, // Actions excluded due to level
            // Include top result's tea cost for debug
            teaCostPerHour: topResult.teaCostPerHour,
        };
    }

    /**
     * Get buff description for a tea
     * @param {string} teaHrid - Tea item HRID
     * @returns {string} Human-readable buff description
     */
    function getTeaBuffDescription(teaHrid, drinkConcentration = 0) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return '';

        const itemDetails = gameData.itemDetailMap[teaHrid];
        if (!itemDetails?.consumableDetail?.buffs) return '';

        const dcMultiplier = 1 + drinkConcentration;
        const descriptions = [];

        for (const buff of itemDetails.consumableDetail.buffs) {
            const baseValue = buff.flatBoost || 0;
            const scaledValue = baseValue * dcMultiplier;
            const dcBonus = baseValue * drinkConcentration;

            switch (buff.typeHrid) {
                case '/buff_types/efficiency':
                    descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% eff', true));
                    break;
                case '/buff_types/wisdom':
                    descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% XP', true));
                    break;
                case '/buff_types/gathering':
                    descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% gathering', true));
                    break;
                case '/buff_types/processing':
                    descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% processing', true));
                    break;
                case '/buff_types/artisan':
                    descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% mat savings', true));
                    break;
                case '/buff_types/gourmet':
                    descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% extra output', true));
                    break;
                case '/buff_types/action_level':
                    descriptions.push(formatBuffWithDC(scaledValue, dcBonus, ' action lvl', false));
                    break;
                default:
                    if (buff.typeHrid.endsWith('_level')) {
                        const skill = buff.typeHrid.match(/\/buff_types\/(\w+)_level/)?.[1];
                        if (skill) {
                            descriptions.push(formatBuffWithDC(scaledValue, dcBonus, ` ${skill}`, false));
                        }
                    }
            }
        }

        return descriptions.join(', ');
    }

    /**
     * Format a buff value with optional drink concentration bonus
     * @param {number} scaledValue - Total value including DC
     * @param {number} dcBonus - Just the DC bonus portion
     * @param {string} suffix - Unit suffix (e.g., '% eff', ' tailoring')
     * @param {boolean} isPercent - Whether to format as percentage
     * @returns {string} Formatted string like "+8.8 tailoring (+.8)"
     */
    function formatBuffWithDC(scaledValue, dcBonus, suffix, isPercent) {
        // Format the main value
        const mainFormatted = isPercent
            ? `+${Number.isInteger(scaledValue) ? scaledValue : scaledValue.toFixed(1)}${suffix}`
            : `+${Number.isInteger(scaledValue) ? scaledValue : scaledValue.toFixed(1)}${suffix}`;

        // If no DC bonus, just return the main value
        if (dcBonus === 0) {
            return mainFormatted;
        }

        // Format the DC bonus (with % suffix if percentage)
        const dcFormatted = isPercent
            ? `(+${dcBonus < 1 ? dcBonus.toFixed(1) : dcBonus.toFixed(0)}%)`
            : `(+${dcBonus < 1 ? dcBonus.toFixed(1) : dcBonus.toFixed(0)})`;

        return `${mainFormatted} ${dcFormatted}`;
    }

    /**
     * Tea Recommendation UI
     * Adds XP and Gold buttons to skill pages that show optimal tea combinations
     */


    /**
     * Get the currently selected location tab name
     * @returns {string|null} Location name or null if no location tabs exist
     */
    function getCurrentLocationTab() {
        // Only search within the current skill panel to avoid picking up tabs from other panels (e.g., Market)
        const skillPanel = document.querySelector('[class*="GatheringProductionSkillPanel_"]');
        if (!skillPanel) return null;

        // Look for location tabs within the skill panel only
        const tabButtons = skillPanel.querySelectorAll('button[role="tab"]');

        for (const button of tabButtons) {
            // Check if this tab is selected
            if (button.getAttribute('aria-selected') === 'true') {
                const text = button.textContent?.trim();
                // Skip special tabs that aren't locations
                if (text && !['Enhance', 'Current Action', 'Decompose', 'Transmute'].includes(text)) {
                    return text;
                }
            }
        }

        return null;
    }

    class TeaRecommendation {
        constructor() {
            this.initialized = false;
            this.unregisterHandlers = [];
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.currentPopup = null;
            this.buttonContainer = null;
        }

        /**
         * Initialize tea recommendation feature
         */
        async initialize() {
            if (this.initialized) return;

            this.initialized = true;

            // Wait for action filter to initialize (it tracks the title element)
            await actionFilter.initialize();

            // Observe for skill panel labels (includes "Consumables" label)
            const unregisterLabelObserver = domObserver.onClass(
                'TeaRecommendation-Label',
                'GatheringProductionSkillPanel_label',
                (labelElement) => {
                    this.checkAndInjectButtons(labelElement);
                }
            );

            this.unregisterHandlers.push(unregisterLabelObserver);

            // Check if consumables label already exists
            const existingLabels = document.querySelectorAll('[class*="GatheringProductionSkillPanel_label"]');
            existingLabels.forEach((label) => {
                this.checkAndInjectButtons(label);
            });
        }

        /**
         * Check if label is "Consumables" and inject buttons
         * @param {HTMLElement} labelElement - The label element
         */
        checkAndInjectButtons(labelElement) {
            // Only inject on "Consumables" label
            if (labelElement.textContent.trim() !== 'Consumables') {
                return;
            }

            // Check if buttons already exist
            if (labelElement.querySelector('.mwi-tea-recommendation-buttons')) {
                return;
            }

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'mwi-tea-recommendation-buttons';
            buttonContainer.style.cssText = `
            display: inline-flex;
            gap: 6px;
            margin-left: 12px;
            vertical-align: middle;
        `;

            // Create XP button
            const xpButton = this.createButton('XP', 'xp', config.COLOR_INFO);
            // Create Gold button
            const goldButton = this.createButton('Gold', 'gold', config.COLOR_PROFIT);
            // Create Both button
            const bothButton = this.createButton('Both', 'both', config.COLOR_ACCENT);

            buttonContainer.appendChild(xpButton);
            buttonContainer.appendChild(goldButton);
            buttonContainer.appendChild(bothButton);

            // Make label a flex container and append buttons
            labelElement.style.display = 'inline-flex';
            labelElement.style.alignItems = 'center';
            labelElement.style.gap = '8px';
            labelElement.appendChild(buttonContainer);

            this.buttonContainer = buttonContainer;
        }

        /**
         * Create an optimization button
         * @param {string} label - Button label
         * @param {string} goal - 'xp' or 'gold'
         * @param {string} color - Button color
         * @returns {HTMLElement} Button element
         */
        createButton(label, goal, color) {
            const button = document.createElement('button');
            button.className = `mwi-tea-recommend-${goal}`;
            button.textContent = label;
            button.style.cssText = `
            background: transparent;
            color: ${color};
            border: 1px solid ${color};
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        `;

            button.addEventListener('mouseenter', () => {
                button.style.background = color;
                button.style.color = '#000';
            });

            button.addEventListener('mouseleave', () => {
                button.style.background = 'transparent';
                button.style.color = color;
            });

            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showRecommendation(goal, button);
            });

            return button;
        }

        /**
         * Show tea recommendation popup
         * @param {string} goal - 'xp', 'gold', or 'both'
         * @param {HTMLElement} anchorButton - Button that was clicked
         */
        showRecommendation(goal, anchorButton) {
            // Close existing popup
            this.closePopup();

            // Get current skill name from action filter
            const skillName = actionFilter.getCurrentSkillName();
            if (!skillName) {
                this.showError(anchorButton, 'Could not detect current skill');
                return;
            }

            // Get current location tab (if any)
            const locationTab = getCurrentLocationTab();

            // Handle 'both' mode - show dual results
            if (goal === 'both') {
                this.showBothRecommendation(anchorButton, skillName, locationTab);
                return;
            }

            // Calculate optimal teas (pass location name to filter by category)
            const result = findOptimalTeas(skillName, goal, locationTab);

            if (result.error) {
                this.showError(anchorButton, result.error);
                return;
            }

            // Create popup
            const popup = document.createElement('div');
            popup.className = 'mwi-tea-recommendation-popup';
            popup.style.cssText = `
            position: absolute;
            z-index: 10000;
            background: #1a1a1a;
            border: 1px solid ${config.COLOR_BORDER};
            border-radius: 8px;
            padding: 16px;
            min-width: 280px;
            max-width: 350px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            cursor: default;
        `;

            // Header (draggable) - show location if filtering by tab
            const goalLabel = goal === 'xp' ? 'XP' : 'Gold';
            const header = document.createElement('div');
            header.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: #fff;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid ${config.COLOR_BORDER};
            cursor: grab;
            user-select: none;
        `;
            // Show location name if we're filtering by tab, otherwise show skill name
            const displayName = locationTab || skillName;
            // Include drink concentration in header if > 0
            const dcPercent = result.drinkConcentration ? (result.drinkConcentration * 100).toFixed(2) : 0;
            const dcSuffix = dcPercent > 0 ? ` (${dcPercent}% DC)` : '';
            header.textContent = `Optimal ${goalLabel}/hr for ${displayName}${dcSuffix}`;
            header.title = 'Drag to move';
            popup.appendChild(header);

            // Make popup draggable via header
            this.makeDraggable(popup, header);

            // Optimal teas list
            const teaList = document.createElement('div');
            teaList.style.cssText = 'margin-bottom: 12px;';

            for (const tea of result.optimal.teas) {
                const teaRow = document.createElement('div');
                teaRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 0;
            `;

                const teaName = document.createElement('span');
                teaName.style.cssText = `
                color: #fff;
                font-weight: 500;
            `;
                teaName.textContent = tea.name;

                const teaBuffs = document.createElement('span');
                teaBuffs.style.cssText = `
                color: rgba(255, 255, 255, 0.6);
                font-size: 11px;
            `;
                // Pass drink concentration to get scaled values with DC bonus shown
                const buffText = getTeaBuffDescription(tea.hrid, result.drinkConcentration || 0);
                // Style the DC bonus portion in dimmer color
                teaBuffs.innerHTML = buffText.replace(
                    /\(([^)]+)\)/g,
                    '<span style="color: rgba(255, 255, 255, 0.4);">($1)</span>'
                );

                teaRow.appendChild(teaName);
                teaRow.appendChild(teaBuffs);
                teaList.appendChild(teaRow);
            }
            popup.appendChild(teaList);

            // Stats
            const stats = document.createElement('div');
            stats.style.cssText = `
            font-size: 12px;
            color: rgba(255, 255, 255, 0.7);
            padding-top: 8px;
            border-top: 1px solid ${config.COLOR_BORDER};
        `;

            const avgValue = result.optimal ? formatters_js.formatKMB(result.optimal.avgScore) : '0';

            // For gold mode, show profitable actions count
            const profitableCount = result.profitableActionsCount || result.actionsEvaluated;
            const excludedCount = result.excludedActions?.length || 0;
            let actionsText;
            if (goal === 'gold') {
                actionsText =
                    excludedCount > 0
                        ? `${profitableCount} profitable of ${result.actionsEvaluated} (+${excludedCount} excluded)`
                        : `${profitableCount} profitable of ${result.actionsEvaluated}`;
            } else {
                actionsText =
                    excludedCount > 0
                        ? `${result.actionsEvaluated} actions (+${excludedCount} excluded)`
                        : `${result.actionsEvaluated} actions evaluated`;
            }

            // Create expandable actions section
            const actionsToggle = document.createElement('span');
            actionsToggle.style.cssText = `
            cursor: pointer;
            text-decoration: underline;
            color: rgba(255, 255, 255, 0.5);
        `;
            actionsToggle.textContent = actionsText;
            actionsToggle.title = 'Click to expand';

            const actionsDetail = document.createElement('div');
            actionsDetail.style.cssText = `
            display: none;
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            max-height: 150px;
            overflow-y: auto;
        `;

            // Sort actions by score descending
            const sortedActions = [...(result.optimal?.actionScores || [])].sort((a, b) => b.score - a.score);
            for (const actionData of sortedActions) {
                const actionRow = document.createElement('div');
                actionRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                padding: 2px 0;
            `;
                const actionName = document.createElement('span');
                actionName.textContent = actionData.action;
                actionName.style.color = 'rgba(255, 255, 255, 0.7)';

                const actionScore = document.createElement('span');
                actionScore.textContent = formatters_js.formatKMB(actionData.score);
                actionScore.style.color = actionData.score >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;

                actionRow.appendChild(actionName);
                actionRow.appendChild(actionScore);
                actionsDetail.appendChild(actionRow);
            }

            // Add excluded actions (greyed out with strikethrough)
            const excludedActions = result.excludedActions || [];
            if (excludedActions.length > 0) {
                // Add separator if there are regular actions
                if (sortedActions.length > 0) {
                    const separator = document.createElement('div');
                    separator.style.cssText = `
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                    margin: 6px 0;
                    font-size: 10px;
                    color: rgba(255, 255, 255, 0.4);
                    padding-top: 4px;
                `;
                    separator.textContent = `Excluded (${excludedActions.length} - level too low)`;
                    actionsDetail.appendChild(separator);
                }

                for (const excluded of excludedActions) {
                    const actionRow = document.createElement('div');
                    actionRow.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    padding: 2px 0;
                `;
                    const actionName = document.createElement('span');
                    actionName.textContent = excluded.action;
                    actionName.style.cssText = `
                    color: rgba(255, 255, 255, 0.35);
                    text-decoration: line-through;
                `;

                    const levelReq = document.createElement('span');
                    levelReq.textContent = `Lvl ${excluded.requiredLevel}`;
                    levelReq.style.cssText = `
                    color: rgba(255, 255, 255, 0.35);
                    font-style: italic;
                `;

                    actionRow.appendChild(actionName);
                    actionRow.appendChild(levelReq);
                    actionsDetail.appendChild(actionRow);
                }
            }

            actionsToggle.addEventListener('click', () => {
                const isHidden = actionsDetail.style.display === 'none';
                actionsDetail.style.display = isHidden ? 'block' : 'none';
                let expandedText;
                if (goal === 'gold') {
                    expandedText =
                        excludedCount > 0
                            ? `▼ ${profitableCount} profitable (+${excludedCount})`
                            : `▼ ${profitableCount} profitable`;
                } else {
                    expandedText =
                        excludedCount > 0
                            ? `▼ ${result.actionsEvaluated} (+${excludedCount})`
                            : `▼ ${result.actionsEvaluated} actions`;
                }
                actionsToggle.textContent = isHidden ? expandedText : actionsText;
            });

            stats.innerHTML = `
            <div style="margin-bottom: 4px;">
                <span style="color: ${goal === 'xp' ? config.COLOR_INFO : config.COLOR_PROFIT};">
                    Avg ${goalLabel}/hr: ${avgValue}
                </span>
            </div>
            <div style="font-size: 11px;">
                Level ${result.playerLevel} •
            </div>
        `;
            stats.querySelector('div:last-child').appendChild(actionsToggle);
            stats.appendChild(actionsDetail);
            popup.appendChild(stats);

            // Alternative combos section
            if (result.allResults && result.allResults.length > 1) {
                const altSection = document.createElement('div');
                altSection.style.cssText = `
                margin-top: 12px;
                padding-top: 8px;
                border-top: 1px solid ${config.COLOR_BORDER};
            `;

                const altHeader = document.createElement('div');
                altHeader.style.cssText = `
                font-size: 11px;
                color: rgba(255, 255, 255, 0.5);
                margin-bottom: 6px;
            `;
                altHeader.textContent = 'Alternatives:';
                altSection.appendChild(altHeader);

                // Show top 3 alternatives (skip the optimal)
                for (let i = 1; i < Math.min(4, result.allResults.length); i++) {
                    const alt = result.allResults[i];
                    const altRow = document.createElement('div');
                    altRow.style.cssText = `
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.6);
                    padding: 2px 0;
                `;
                    altRow.textContent = `${alt.teas.join(', ')} (${formatters_js.formatKMB(alt.avgScore)}/hr)`;
                    altSection.appendChild(altRow);
                }

                popup.appendChild(altSection);
            }

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.5);
            font-size: 16px;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
        `;
            closeBtn.innerHTML = '&times;';
            closeBtn.addEventListener('click', () => this.closePopup());
            popup.appendChild(closeBtn);

            // Position popup relative to button
            document.body.appendChild(popup);
            const buttonRect = anchorButton.getBoundingClientRect();
            const popupRect = popup.getBoundingClientRect();

            // Position below the button
            let top = buttonRect.bottom + 8;
            let left = buttonRect.left;

            // Adjust if off-screen
            if (left + popupRect.width > window.innerWidth - 16) {
                left = window.innerWidth - popupRect.width - 16;
            }
            if (top + popupRect.height > window.innerHeight - 16) {
                top = buttonRect.top - popupRect.height - 8;
            }

            popup.style.top = `${top}px`;
            popup.style.left = `${left}px`;

            this.currentPopup = popup;

            // Close on click outside
            const closeHandler = (e) => {
                if (!popup.contains(e.target) && e.target !== anchorButton) {
                    this.closePopup();
                    document.removeEventListener('click', closeHandler);
                }
            };
            // Delay to prevent immediate close
            setTimeout(() => {
                document.addEventListener('click', closeHandler);
            }, 100);
        }

        /**
         * Show both XP and Gold recommendations side by side
         * @param {HTMLElement} anchorButton - Button that was clicked
         * @param {string} skillName - Current skill name
         * @param {string|null} locationTab - Current location tab
         */
        showBothRecommendation(anchorButton, skillName, locationTab) {
            const xpResult = findOptimalTeas(skillName, 'xp', locationTab);
            const goldResult = findOptimalTeas(skillName, 'gold', locationTab);

            if (xpResult.error && goldResult.error) {
                this.showError(anchorButton, xpResult.error);
                return;
            }

            // Create popup
            const popup = document.createElement('div');
            popup.className = 'mwi-tea-recommendation-popup';
            popup.style.cssText = `
            position: absolute;
            z-index: 10000;
            background: #1a1a1a;
            border: 1px solid ${config.COLOR_BORDER};
            border-radius: 8px;
            padding: 16px;
            min-width: 320px;
            max-width: 420px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            cursor: default;
        `;

            // Header
            const displayName = locationTab || skillName;
            const header = document.createElement('div');
            header.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: #fff;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid ${config.COLOR_BORDER};
            cursor: grab;
            user-select: none;
        `;
            header.textContent = `Optimal Teas for ${displayName}`;
            header.title = 'Drag to move';
            popup.appendChild(header);

            this.makeDraggable(popup, header);

            // Two-column container
            const columns = document.createElement('div');
            columns.style.cssText = `
            display: flex;
            gap: 16px;
        `;

            // XP Column
            if (!xpResult.error && xpResult.optimal) {
                const xpCol = document.createElement('div');
                xpCol.style.cssText = 'flex: 1;';

                const xpHeader = document.createElement('div');
                xpHeader.style.cssText = `
                font-size: 12px;
                font-weight: 600;
                color: ${config.COLOR_INFO};
                margin-bottom: 8px;
            `;
                xpHeader.textContent = `XP/hr: ${formatters_js.formatKMB(xpResult.optimal.avgScore)}`;
                xpCol.appendChild(xpHeader);

                for (const tea of xpResult.optimal.teas) {
                    const teaRow = document.createElement('div');
                    teaRow.style.cssText = `
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.8);
                    padding: 2px 0;
                `;
                    teaRow.textContent = tea.name;
                    xpCol.appendChild(teaRow);
                }

                columns.appendChild(xpCol);
            }

            // Gold Column
            if (!goldResult.error && goldResult.optimal) {
                const goldCol = document.createElement('div');
                goldCol.style.cssText = 'flex: 1;';

                const goldHeader = document.createElement('div');
                goldHeader.style.cssText = `
                font-size: 12px;
                font-weight: 600;
                color: ${config.COLOR_PROFIT};
                margin-bottom: 8px;
            `;
                goldHeader.textContent = `Gold/hr: ${formatters_js.formatKMB(goldResult.optimal.avgScore)}`;
                goldCol.appendChild(goldHeader);

                for (const tea of goldResult.optimal.teas) {
                    const teaRow = document.createElement('div');
                    teaRow.style.cssText = `
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.8);
                    padding: 2px 0;
                `;
                    teaRow.textContent = tea.name;
                    goldCol.appendChild(teaRow);
                }

                columns.appendChild(goldCol);
            }

            popup.appendChild(columns);

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.5);
            font-size: 16px;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
        `;
            closeBtn.innerHTML = '&times;';
            closeBtn.addEventListener('click', () => this.closePopup());
            popup.appendChild(closeBtn);

            // Position popup
            document.body.appendChild(popup);
            const buttonRect = anchorButton.getBoundingClientRect();
            const popupRect = popup.getBoundingClientRect();

            let top = buttonRect.bottom + 8;
            let left = buttonRect.left;

            if (left + popupRect.width > window.innerWidth - 16) {
                left = window.innerWidth - popupRect.width - 16;
            }
            if (top + popupRect.height > window.innerHeight - 16) {
                top = buttonRect.top - popupRect.height - 8;
            }

            popup.style.top = `${top}px`;
            popup.style.left = `${left}px`;

            this.currentPopup = popup;

            // Close on click outside
            const closeHandler = (e) => {
                if (!popup.contains(e.target) && e.target !== anchorButton) {
                    this.closePopup();
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => {
                document.addEventListener('click', closeHandler);
            }, 100);
        }

        /**
         * Show error message
         * @param {HTMLElement} anchorButton - Button that was clicked
         * @param {string} message - Error message
         */
        showError(anchorButton, message) {
            this.closePopup();

            const popup = document.createElement('div');
            popup.className = 'mwi-tea-recommendation-popup';
            popup.style.cssText = `
            position: absolute;
            z-index: 10000;
            background: #1a1a1a;
            border: 1px solid ${config.COLOR_WARNING};
            border-radius: 8px;
            padding: 12px 16px;
            max-width: 280px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            color: ${config.COLOR_WARNING};
            font-size: 13px;
        `;
            popup.textContent = message;

            document.body.appendChild(popup);
            const buttonRect = anchorButton.getBoundingClientRect();
            popup.style.top = `${buttonRect.bottom + 8}px`;
            popup.style.left = `${buttonRect.left}px`;

            this.currentPopup = popup;

            // Auto-close after 3 seconds
            const timeout = setTimeout(() => this.closePopup(), 3000);
            this.timerRegistry.registerTimeout(timeout);
        }

        /**
         * Close the current popup
         */
        closePopup() {
            if (this.currentPopup) {
                this.currentPopup.remove();
                this.currentPopup = null;
            }
        }

        /**
         * Make an element draggable via a handle
         * @param {HTMLElement} element - Element to make draggable
         * @param {HTMLElement} handle - Handle element for dragging
         */
        makeDraggable(element, handle) {
            let isDragging = false;
            let hasDragged = false;
            let startX, startY, initialX, initialY;

            handle.addEventListener('mousedown', (e) => {
                isDragging = true;
                hasDragged = false;
                startX = e.clientX;
                startY = e.clientY;
                initialX = element.offsetLeft;
                initialY = element.offsetTop;
                handle.style.cursor = 'grabbing';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                hasDragged = true;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                element.style.left = `${initialX + dx}px`;
                element.style.top = `${initialY + dy}px`;
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    handle.style.cursor = 'grab';
                    // Suppress the click event that follows drag
                    if (hasDragged) {
                        const suppressClick = (e) => {
                            e.stopPropagation();
                            document.removeEventListener('click', suppressClick, true);
                        };
                        document.addEventListener('click', suppressClick, true);
                    }
                }
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            this.closePopup();
            this.timerRegistry.clearAll();

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            // Remove injected elements
            document.querySelectorAll('.mwi-tea-recommendation-buttons').forEach((el) => el.remove());
            document.querySelectorAll('.mwi-tea-recommendation-popup').forEach((el) => el.remove());

            this.buttonContainer = null;
            this.initialized = false;
        }
    }

    const teaRecommendation = new TeaRecommendation();

    /**
     * Inventory Count Display
     * Shows how many of the output item you currently own on:
     *  - Skill action tiles (SkillAction_skillAction) — bottom-center overlay on the tile
     *  - Action detail panels (SkillActionDetail_regularComponent) — inline after the action name heading
     */


    const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
    const PRODUCTION_TYPES = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
        '/action_types/alchemy',
    ];

    /**
     * Build an itemHrid → count map from the current inventory.
     * @returns {Map<string, number>}
     */
    function buildCountMap() {
        const inventory = dataManager.getInventory();
        const map = new Map();
        if (!Array.isArray(inventory)) return map;

        for (const item of inventory) {
            if (item.itemLocationHrid !== '/item_locations/inventory') continue;
            const count = item.count || 0;
            if (!count) continue;
            map.set(item.itemHrid, (map.get(item.itemHrid) || 0) + count);
        }
        return map;
    }

    /**
     * Return the primary output itemHrid for an action, or null if not applicable.
     * Gathering: first entry of dropTable (the main resource, not rare drops).
     * Production: first entry of outputItems.
     * @param {object} actionDetails
     * @returns {string|null}
     */
    function getPrimaryOutputHrid(actionDetails) {
        if (!actionDetails) return null;

        if (GATHERING_TYPES.includes(actionDetails.type)) {
            return actionDetails.dropTable?.[0]?.itemHrid ?? null;
        }

        if (PRODUCTION_TYPES.includes(actionDetails.type)) {
            return actionDetails.outputItems?.[0]?.itemHrid ?? null;
        }

        return null;
    }

    /**
     * @param {number} count
     * @returns {string}
     */
    function formatCount(count) {
        return formatters_js.formatKMB(count);
    }

    class InventoryCountDisplay {
        constructor() {
            this.tileElements = new Map(); // actionPanel → { outputHrid, span }
            this.detailPanels = new Set();
            this.unregisterObservers = [];
            this.itemsUpdatedHandler = null;
            this.isInitialized = false;
            this.DEBOUNCE_DELAY = 300;
            this.debounceTimer = null;
        }

        initialize() {
            if (this.isInitialized) return;
            if (!config.getSetting('inventoryCountDisplay', true)) return;

            this.isInitialized = true;

            this._setupTileObserver();
            this._setupDetailObserver();

            this.itemsUpdatedHandler = () => {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => this._refreshAll(), this.DEBOUNCE_DELAY);
            };

            dataManager.on('items_updated', this.itemsUpdatedHandler);

            this.unregisterObservers.push(() => {
                dataManager.off('items_updated', this.itemsUpdatedHandler);
            });
        }

        // ─── Tile observer ────────────────────────────────────────────────────────

        _setupTileObserver() {
            const unregister = domObserver.onClass('InventoryCountDisplay-Tile', 'SkillAction_skillAction', (actionPanel) =>
                this._injectTile(actionPanel)
            );
            this.unregisterObservers.push(unregister);

            document.querySelectorAll('[class*="SkillAction_skillAction"]').forEach((panel) => {
                this._injectTile(panel);
            });
        }

        /**
         * Inject a count strip just below the tile using the same pattern as
         * gathering-stats / max-produceable: position absolute at top:100% with
         * marginBottom on the panel so the grid row makes room for it.
         * @param {HTMLElement} actionPanel
         */
        _injectTile(actionPanel) {
            const actionHrid = this._getActionHridFromTile(actionPanel);
            if (!actionHrid) return;

            const actionDetails = dataManager.getActionDetails(actionHrid);
            const outputHrid = getPrimaryOutputHrid(actionDetails);
            if (!outputHrid) return;

            let span = actionPanel.querySelector('.mwi-inv-count-tile');
            if (span && span.dataset.outputHrid !== outputHrid) {
                // Output changed — clean up stale span
                span.remove();
                span = null;
            }
            if (!span) {
                const nameEl = actionPanel.querySelector('[class*="SkillAction_name"]');
                if (!nameEl) return;

                span = document.createElement('span');
                span.className = 'mwi-inv-count-tile';
                span.dataset.outputHrid = outputHrid;

                if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
                    actionPanel.style.position = 'relative';
                }

                // z-index:12 places the count above the icon container which fills the tile.
                // bottom:4px sits inside the tile above the profit bar (which is at top:100%).
                // background + padding give the number a readable pill against the sprite.
                span.style.cssText = `
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
                text-align: center;
                font-size: 0.75em;
                color: ${config.COLOR_INV_COUNT};
                font-weight: 600;
                pointer-events: none;
                line-height: 1.4;
                z-index: 12;
                background: rgba(0, 0, 0, 0.55);
                border-radius: 3px;
                padding: 0 4px;
                white-space: nowrap;
            `;
                actionPanel.appendChild(span);
            }

            this.tileElements.set(actionPanel, { outputHrid, span });
            this._updateTileSpan(span, outputHrid, buildCountMap());
        }

        _updateTileSpan(span, outputHrid, countMap) {
            const count = countMap.get(outputHrid) || 0;
            span.textContent = count > 0 ? formatCount(count) : '';
            span.style.color = config.COLOR_INV_COUNT;
        }

        // ─── Detail panel observer ────────────────────────────────────────────────

        _setupDetailObserver() {
            const unregister = domObserver.onClass(
                'InventoryCountDisplay-Detail',
                'SkillActionDetail_regularComponent',
                (panel) => this._injectDetail(panel)
            );
            this.unregisterObservers.push(unregister);

            document.querySelectorAll('[class*="SkillActionDetail_regularComponent"]').forEach((panel) => {
                this._injectDetail(panel);
            });
        }

        /**
         * Inject count inline after the action name heading in the detail panel.
         * Reads textContent before injecting so the name lookup is always clean.
         * @param {HTMLElement} panel
         */
        _injectDetail(panel) {
            const nameEl = panel.querySelector('[class*="SkillActionDetail_name"]');
            if (!nameEl) return;

            const actionName = nameEl.textContent.trim();
            const actionHrid = this._getActionHridFromName(actionName);
            if (!actionHrid) return;

            const actionDetails = dataManager.getActionDetails(actionHrid);
            const outputHrid = getPrimaryOutputHrid(actionDetails);
            if (!outputHrid) return;

            // infoContainer may be panel itself if SkillActionDetail_info is absent.
            // The span is inserted as a sibling of infoContainer (outside panel's subtree
            // in that case), so we must scope the guard to infoContainer.parentElement
            // rather than panel to reliably find and remove any previously inserted span.
            const infoContainer = nameEl.closest('[class*="SkillActionDetail_info"]') ?? nameEl.parentElement;
            const scopeEl = infoContainer.parentElement ?? infoContainer;
            scopeEl.querySelector('.mwi-inv-count-detail')?.remove();

            const count = buildCountMap().get(outputHrid) || 0;

            const span = document.createElement('span');
            span.className = 'mwi-inv-count-detail';
            span.dataset.outputHrid = outputHrid;
            span.style.cssText = `
            display: block;
            font-size: 0.75em;
            color: ${config.COLOR_INV_COUNT};
            font-weight: 600;
            margin-top: 2px;
            pointer-events: none;
        `;
            span.textContent = count > 0 ? `(${formatCount(count)} in inventory)` : '';

            // Insert after the info container (nameEl's parent) so it sits on its own
            // line below the action name row. Inserting after nameEl itself puts the span
            // inside the flex info row and causes overlap.
            infoContainer.after(span);
            this.detailPanels.add(panel);
        }

        // ─── Refresh ──────────────────────────────────────────────────────────────

        _refreshAll() {
            const countMap = buildCountMap();

            for (const [actionPanel, { outputHrid, span }] of this.tileElements) {
                if (!document.body.contains(actionPanel)) {
                    this.tileElements.delete(actionPanel);
                    continue;
                }
                this._updateTileSpan(span, outputHrid, countMap);
            }

            for (const panel of this.detailPanels) {
                if (!document.body.contains(panel)) {
                    this.detailPanels.delete(panel);
                    continue;
                }
                const nameEl = panel.querySelector('[class*="SkillActionDetail_name"]');
                const infoContainer = nameEl
                    ? (nameEl.closest('[class*="SkillActionDetail_info"]') ?? nameEl.parentElement)
                    : panel;
                const scopeEl = infoContainer.parentElement ?? infoContainer;
                const span = scopeEl.querySelector('.mwi-inv-count-detail');
                if (!span || !span.dataset.outputHrid) continue;
                const count = countMap.get(span.dataset.outputHrid) || 0;
                span.style.color = config.COLOR_INV_COUNT;
                span.textContent = count > 0 ? `(${formatCount(count)} in inventory)` : '';
            }
        }

        // ─── Helpers ──────────────────────────────────────────────────────────────

        _getActionHridFromTile(actionPanel) {
            const nameEl = actionPanel.querySelector('[class*="SkillAction_name"]');
            if (!nameEl) return null;
            const name = Array.from(nameEl.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent)
                .join('')
                .trim();
            return this._getActionHridFromName(name);
        }

        _getActionHridFromName(name) {
            const initData = dataManager.getInitClientData();
            if (!initData) return null;
            for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
                if (action.name === name) return hrid;
            }
            return null;
        }

        disable() {
            this.unregisterObservers.forEach((fn) => fn());
            this.unregisterObservers = [];

            document.querySelectorAll('.mwi-inv-count-tile').forEach((el) => el.remove());
            document.querySelectorAll('.mwi-inv-count-detail').forEach((el) => el.remove());

            this.tileElements.clear();
            this.detailPanels.clear();
            this.isInitialized = false;
        }
    }

    const inventoryCountDisplay = new InventoryCountDisplay();

    var inventoryCountDisplay$1 = {
        name: 'Inventory Count Display',
        initialize: () => inventoryCountDisplay.initialize(),
        cleanup: () => inventoryCountDisplay.disable(),
    };

    /**
     * Worker Pool Manager
     * Manages a pool of Web Workers for parallel task execution
     */

    class WorkerPool {
        constructor(workerScript, poolSize = null) {
            // Auto-detect optimal pool size (max 4 workers)
            this.poolSize = poolSize || Math.min(navigator.hardwareConcurrency || 2, 4);
            this.workerScript = workerScript;
            this.workers = [];
            this.taskQueue = [];
            this.activeWorkers = new Set();
            this.nextTaskId = 0;
            this.initialized = false;
        }

        /**
         * Initialize the worker pool
         */
        async initialize() {
            if (this.initialized) {
                return;
            }

            try {
                // Create workers
                for (let i = 0; i < this.poolSize; i++) {
                    const worker = new Worker(URL.createObjectURL(this.workerScript));
                    this.workers.push({
                        id: i,
                        worker,
                        busy: false,
                        currentTask: null,
                    });
                }

                this.initialized = true;
            } catch (error) {
                console.error('[WorkerPool] Failed to initialize:', error);
                throw error;
            }
        }

        /**
         * Execute a task in the worker pool
         * @param {Object} taskData - Data to send to worker
         * @returns {Promise} Promise that resolves with worker result
         */
        async execute(taskData) {
            if (!this.initialized) {
                await this.initialize();
            }

            return new Promise((resolve, reject) => {
                const taskId = this.nextTaskId++;
                const task = {
                    id: taskId,
                    data: taskData,
                    resolve,
                    reject,
                    timestamp: Date.now(),
                };

                // Try to assign to an available worker immediately
                const availableWorker = this.workers.find((w) => !w.busy);

                if (availableWorker) {
                    this.assignTask(availableWorker, task);
                } else {
                    // Queue the task if all workers are busy
                    this.taskQueue.push(task);
                }
            });
        }

        /**
         * Execute multiple tasks in parallel
         * @param {Array} taskDataArray - Array of task data objects
         * @returns {Promise<Array>} Promise that resolves with array of results
         */
        async executeAll(taskDataArray) {
            if (!this.initialized) {
                await this.initialize();
            }

            const promises = taskDataArray.map((taskData) => this.execute(taskData));
            return Promise.all(promises);
        }

        /**
         * Assign a task to a worker
         * @private
         */
        assignTask(workerWrapper, task) {
            workerWrapper.busy = true;
            workerWrapper.currentTask = task;

            // Set up message handler for this specific task
            const messageHandler = (e) => {
                const { taskId, result, error } = e.data;

                if (taskId === task.id) {
                    // Clean up
                    workerWrapper.worker.removeEventListener('message', messageHandler);
                    workerWrapper.worker.removeEventListener('error', errorHandler);
                    workerWrapper.busy = false;
                    workerWrapper.currentTask = null;

                    // Resolve or reject the promise
                    if (error) {
                        task.reject(new Error(error));
                    } else {
                        task.resolve(result);
                    }

                    // Process next task in queue
                    this.processQueue();
                }
            };

            const errorHandler = (error) => {
                console.error('[WorkerPool] Worker error:', error);
                workerWrapper.worker.removeEventListener('message', messageHandler);
                workerWrapper.worker.removeEventListener('error', errorHandler);
                workerWrapper.busy = false;
                workerWrapper.currentTask = null;

                task.reject(error);

                // Process next task in queue
                this.processQueue();
            };

            workerWrapper.worker.addEventListener('message', messageHandler);
            workerWrapper.worker.addEventListener('error', errorHandler);

            // Send task to worker
            workerWrapper.worker.postMessage({
                taskId: task.id,
                data: task.data,
            });
        }

        /**
         * Process the next task in the queue
         * @private
         */
        processQueue() {
            if (this.taskQueue.length === 0) {
                return;
            }

            const availableWorker = this.workers.find((w) => !w.busy);
            if (availableWorker) {
                const task = this.taskQueue.shift();
                this.assignTask(availableWorker, task);
            }
        }

        /**
         * Get pool statistics
         */
        getStats() {
            return {
                poolSize: this.poolSize,
                busyWorkers: this.workers.filter((w) => w.busy).length,
                queuedTasks: this.taskQueue.length,
                totalWorkers: this.workers.length,
            };
        }

        /**
         * Terminate all workers and clean up
         */
        terminate() {
            for (const workerWrapper of this.workers) {
                workerWrapper.worker.terminate();
            }

            this.workers = [];
            this.taskQueue = [];
            this.initialized = false;
        }
    }

    /**
     * Expected Value Calculator Worker Manager
     * Manages a worker pool for parallel EV container calculations
     */


    // Worker pool instance
    let workerPool = null;

    // Worker script as inline string
    const WORKER_SCRIPT = `
// Cache for EV calculation results
const evCache = new Map();

/**
 * Calculate expected value for a single container
 * @param {Object} data - Container calculation data
 * @returns {Object} {containerHrid, ev}
 */
function calculateContainerEV(data) {
    const { containerHrid, dropTable, priceMap, COIN_HRID, MARKET_TAX } = data;

    if (!dropTable || dropTable.length === 0) {
        return { containerHrid, ev: null };
    }

    let totalExpectedValue = 0;

    // Calculate expected value for each drop
    for (const drop of dropTable) {
        const itemHrid = drop.itemHrid;
        const dropRate = drop.dropRate || 0;
        const minCount = drop.minCount || 0;
        const maxCount = drop.maxCount || 0;

        // Skip invalid drops
        if (dropRate <= 0 || (minCount === 0 && maxCount === 0)) {
            continue;
        }

        // Calculate average drop count
        const avgCount = (minCount + maxCount) / 2;

        // Get price for this drop
        const priceData = priceMap[itemHrid];
        if (!priceData || priceData.price === null) {
            continue; // Skip drops with missing data
        }

        const price = priceData.price;
        const canBeSold = priceData.canBeSold;
        const isCoin = itemHrid === COIN_HRID;

        // Calculate drop value with tax
        const dropValue = isCoin
            ? avgCount * dropRate * price
            : canBeSold
              ? avgCount * dropRate * price * (1 - MARKET_TAX)
              : avgCount * dropRate * price;

        totalExpectedValue += dropValue;
    }

    return { containerHrid, ev: totalExpectedValue };
}

/**
 * Calculate EV for a batch of containers
 * @param {Array} containers - Array of container data objects
 * @returns {Array} Array of {containerHrid, ev} results
 */
function calculateBatchEV(containers) {
    const results = [];

    for (const container of containers) {
        const result = calculateContainerEV(container);
        if (result.ev !== null) {
            evCache.set(result.containerHrid, result.ev);
        }
        results.push(result);
    }

    return results;
}

self.onmessage = function (e) {
    const { taskId, data } = e.data;
    try {
        const { action, params } = data;

        if (action === 'calculateBatch') {
            const results = calculateBatchEV(params.containers);
            self.postMessage({ taskId, result: results });
        } else if (action === 'clearCache') {
            evCache.clear();
            self.postMessage({ taskId, result: { success: true, message: 'Cache cleared' } });
        } else {
            throw new Error(\`Unknown action: \${action}\`);
        }
    } catch (error) {
        self.postMessage({ taskId, error: error.message || String(error) });
    }
};
`;

    /**
     * Get or create the worker pool instance
     */
    async function getWorkerPool() {
        if (workerPool) {
            return workerPool;
        }

        try {
            // Create worker blob from inline script
            const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });

            // Initialize worker pool with 2-4 workers
            workerPool = new WorkerPool(blob);
            await workerPool.initialize();

            return workerPool;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Calculate EV for multiple containers in parallel
     * @param {Array} containers - Array of container data objects
     * @returns {Promise<Array>} Array of {containerHrid, ev} results
     */
    async function calculateEVBatch(containers) {
        const pool = await getWorkerPool();

        // Split containers into chunks for parallel processing
        const chunkSize = Math.ceil(containers.length / pool.getStats().poolSize);
        const chunks = [];

        for (let i = 0; i < containers.length; i += chunkSize) {
            chunks.push(containers.slice(i, i + chunkSize));
        }

        // Process chunks in parallel
        const tasks = chunks.map((chunk) => ({
            action: 'calculateBatch',
            params: { containers: chunk },
        }));

        const results = await pool.executeAll(tasks);

        // Flatten results
        return results.flat();
    }

    /**
     * Expected Value Calculator Module
     * Calculates expected value for openable containers
     */


    /**
     * ExpectedValueCalculator class handles EV calculations for openable containers
     */
    class ExpectedValueCalculator {
        constructor() {
            // Constants
            this.MARKET_TAX = 0.02; // 2% marketplace tax
            this.CONVERGENCE_ITERATIONS = 4; // Nested container convergence

            // Cache for container EVs
            this.containerCache = new Map();

            // Special item HRIDs
            this.COIN_HRID = '/items/coin';
            this.COWBELL_HRID = '/items/cowbell';
            this.COWBELL_BAG_HRID = '/items/bag_of_10_cowbells';

            // Dungeon token HRIDs
            this.DUNGEON_TOKENS = [
                '/items/chimerical_token',
                '/items/sinister_token',
                '/items/enchanted_token',
                '/items/pirate_token',
            ];

            // Flag to track if initialized
            this.isInitialized = false;

            // Retry handler reference for cleanup
            this.retryHandler = null;
        }

        /**
         * Initialize the calculator
         * Pre-calculates all openable containers with nested convergence
         */
        async initialize() {
            if (!dataManager.getInitClientData()) {
                // Init data not yet available - set up retry on next character update
                if (!this.retryHandler) {
                    this.retryHandler = () => {
                        this.initialize(); // Retry initialization
                    };
                    dataManager.on('character_initialized', this.retryHandler);
                }
                return false;
            }

            // Data is available - remove retry handler if it exists
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            // Wait for market data to load
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true); // Force fresh fetch on init
            }

            // Calculate all containers with 4-iteration convergence for nesting (now async with workers)
            await this.calculateNestedContainers();

            this.isInitialized = true;

            // Notify listeners that calculator is ready
            dataManager.emit('expected_value_initialized', { timestamp: Date.now() });

            return true;
        }

        /**
         * Calculate all containers with nested convergence using workers
         * Iterates 4 times to resolve nested container values
         */
        async calculateNestedContainers() {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return;
            }

            // Get all openable container HRIDs
            const containerHrids = Object.keys(initData.openableLootDropMap);

            // Iterate 4 times for convergence (handles nesting depth)
            for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
                // Build price map for all items (includes cached container EVs from previous iterations)
                const priceMap = this.buildPriceMap(containerHrids, initData);

                // Prepare container data for workers
                const containerData = containerHrids.map((containerHrid) => ({
                    containerHrid,
                    dropTable: initData.openableLootDropMap[containerHrid],
                    priceMap,
                    COIN_HRID: this.COIN_HRID,
                    MARKET_TAX: this.MARKET_TAX,
                }));

                // Calculate all containers in parallel using workers
                try {
                    const results = await calculateEVBatch(containerData);

                    // Update cache with results
                    for (const result of results) {
                        if (result.ev !== null) {
                            this.containerCache.set(result.containerHrid, result.ev);
                        }
                    }
                } catch {
                    // Worker failed, fall back to main thread calculation
                    for (const containerHrid of containerHrids) {
                        const ev = this.calculateSingleContainer(containerHrid, initData);
                        if (ev !== null) {
                            this.containerCache.set(containerHrid, ev);
                        }
                    }
                }
            }
        }

        /**
         * Build price map for all items needed for container calculations
         * @param {Array} containerHrids - Array of container HRIDs
         * @param {Object} initData - Game data
         * @returns {Object} Map of itemHrid to {price, canBeSold}
         */
        buildPriceMap(containerHrids, initData) {
            const priceMap = {};
            const processedItems = new Set();

            // Collect all unique items from all containers
            for (const containerHrid of containerHrids) {
                const dropTable = initData.openableLootDropMap[containerHrid];
                if (!dropTable) continue;

                for (const drop of dropTable) {
                    const itemHrid = drop.itemHrid;
                    if (processedItems.has(itemHrid)) continue;
                    processedItems.add(itemHrid);

                    // Get price and tradeable status
                    const price = this.getDropPrice(itemHrid);
                    const itemDetails = dataManager.getItemDetails(itemHrid);
                    const canBeSold = itemDetails?.tradeable !== false;

                    priceMap[itemHrid] = {
                        price,
                        canBeSold,
                    };
                }
            }

            return priceMap;
        }

        /**
         * Calculate expected value for a single container
         * @param {string} containerHrid - Container item HRID
         * @param {Object} initData - Cached game data (optional, will fetch if not provided)
         * @returns {number|null} Expected value or null if unavailable
         */
        calculateSingleContainer(containerHrid, initData = null) {
            // Use cached data if provided, otherwise fetch
            if (!initData) {
                initData = dataManager.getInitClientData();
            }
            if (!initData || !initData.openableLootDropMap) {
                return null;
            }

            // Get drop table for this container
            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable || dropTable.length === 0) {
                return null;
            }

            let totalExpectedValue = 0;

            // Calculate expected value for each drop
            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                // Skip invalid drops
                if (dropRate <= 0 || (minCount === 0 && maxCount === 0)) {
                    continue;
                }

                // Calculate average drop count
                const avgCount = (minCount + maxCount) / 2;

                // Get price for this drop
                const price = this.getDropPrice(itemHrid);

                if (price === null) {
                    continue; // Skip drops with missing data
                }

                // Check if item is tradeable (for tax calculation)
                const itemDetails = dataManager.getItemDetails(itemHrid);
                const canBeSold = itemDetails?.tradeable !== false;

                // Special case: Coin never has market tax (it's currency, not a market item)
                const isCoin = itemHrid === this.COIN_HRID;

                const dropValue = isCoin
                    ? avgCount * dropRate * price // No tax for coins
                    : canBeSold
                      ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                      : avgCount * dropRate * price;
                totalExpectedValue += dropValue;
            }

            // Cache the result for future lookups
            if (totalExpectedValue > 0) {
                this.containerCache.set(containerHrid, totalExpectedValue);
            }

            return totalExpectedValue;
        }

        /**
         * Get price for a drop item
         * Handles special cases (Coin, Cowbell, Dungeon Tokens, nested containers)
         * @param {string} itemHrid - Item HRID
         * @returns {number|null} Price or null if unavailable
         */
        getDropPrice(itemHrid) {
            // Special case: Coin (face value = 1)
            if (itemHrid === this.COIN_HRID) {
                return 1;
            }

            // Special case: Cowbell (use bag price ÷ 10, with 18% tax)
            if (itemHrid === this.COWBELL_HRID) {
                // Get Cowbell Bag price using profit context (sell side - you're selling the bag)
                const bagValue = marketData_js.getItemPrice(this.COWBELL_BAG_HRID, { context: 'profit', side: 'sell' }) || 0;

                if (bagValue > 0) {
                    // Apply 18% market tax (Cowbell Bag only), then divide by 10
                    return profitHelpers_js.calculatePriceAfterTax(bagValue, 0.18) / 10;
                }
                return null; // No bag price available
            }

            // Special case: Dungeon Tokens (calculate value from shop items)
            if (this.DUNGEON_TOKENS.includes(itemHrid)) {
                return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', 'expectedValue_respectPricingMode');
            }

            // Check if this is a nested container (use cached EV)
            if (this.containerCache.has(itemHrid)) {
                return this.containerCache.get(itemHrid);
            }

            // Regular market item - get price based on pricing mode (sell side - you're selling drops)
            const dropPrice = marketData_js.getItemPrice(itemHrid, { enhancementLevel: 0, context: 'profit', side: 'sell' });
            return dropPrice > 0 ? dropPrice : null;
        }

        /**
         * Calculate expected value for an openable container
         * @param {string} itemHrid - Container item HRID
         * @returns {Object|null} EV data or null
         */
        calculateExpectedValue(itemHrid) {
            if (!this.isInitialized) {
                console.warn('[ExpectedValueCalculator] Not initialized');
                return null;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Verify this is an openable container
            if (!itemDetails.isOpenable) {
                return null; // Not an openable container
            }

            // Get detailed drop breakdown (calculates with fresh market prices)
            const drops = this.getDropBreakdown(itemHrid);

            // Calculate total expected value from fresh drop data
            const expectedReturn = drops.reduce((sum, drop) => sum + drop.expectedValue, 0);

            return {
                itemName: itemDetails.name,
                itemHrid,
                expectedValue: expectedReturn,
                drops,
            };
        }

        /**
         * Get cached expected value for a container (for use by other modules)
         * @param {string} itemHrid - Container item HRID
         * @returns {number|null} Cached EV or null
         */
        getCachedValue(itemHrid) {
            return this.containerCache.get(itemHrid) || null;
        }

        /**
         * Get detailed drop breakdown for display
         * @param {string} containerHrid - Container HRID
         * @returns {Array} Array of drop objects
         */
        getDropBreakdown(containerHrid) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return [];
            }

            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable) {
                return [];
            }

            const drops = [];

            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                if (dropRate <= 0) {
                    continue;
                }

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // Calculate average count
                const avgCount = (minCount + maxCount) / 2;

                // Get price
                const price = this.getDropPrice(itemHrid);

                // Calculate expected value for this drop
                const itemCanBeSold = itemDetails.tradeable !== false;

                // Special case: Coin never has market tax (it's currency, not a market item)
                const isCoin = itemHrid === this.COIN_HRID;

                const dropValue =
                    price !== null
                        ? isCoin
                            ? avgCount * dropRate * price // No tax for coins
                            : itemCanBeSold
                              ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                              : avgCount * dropRate * price
                        : 0;

                drops.push({
                    itemHrid,
                    itemName: itemDetails.name,
                    dropRate,
                    avgCount,
                    priceEach: price || 0,
                    expectedValue: dropValue,
                    hasPriceData: price !== null,
                });
            }

            // Sort by expected value (highest first)
            drops.sort((a, b) => b.expectedValue - a.expectedValue);

            return drops;
        }

        /**
         * Invalidate cache (call when market data refreshes)
         */
        invalidateCache() {
            this.containerCache.clear();
            this.isInitialized = false;

            // Re-initialize if data is available
            if (dataManager.getInitClientData() && marketAPI.isLoaded()) {
                this.initialize();
            }
        }

        /**
         * Cleanup calculator state and handlers
         */
        cleanup() {
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            this.containerCache.clear();
            this.isInitialized = false;
        }

        disable() {
            this.cleanup();
        }
    }

    const expectedValueCalculator = new ExpectedValueCalculator();

    /**
     * Alchemy Profit Calculator Module
     * Calculates real-time profit for alchemy actions accounting for:
     * - Success rate (failures consume materials but not catalyst)
     * - Efficiency bonuses
     * - Tea buff costs and duration
     * - Market prices (ask/bid based on pricing mode)
     */


    class AlchemyProfit {
        constructor() {
            this.cachedData = null;
            this.lastFingerprint = null;
        }

        /**
         * Extract alchemy action data from the DOM
         * @returns {Object|null} Action data or null if extraction fails
         */
        async extractActionData() {
            try {
                const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
                if (!alchemyComponent) return null;

                // Get action HRID from current actions
                const actionHrid = this.getCurrentActionHrid();

                // Get success rate with breakdown
                const successRateBreakdown = this.extractSuccessRate();
                if (successRateBreakdown === null) return null;

                // Get action time (base 20 seconds)
                const actionSpeedBreakdown = this.extractActionSpeed();
                const actionTime = 20 / (1 + actionSpeedBreakdown.total);

                // Get efficiency
                const efficiencyBreakdown = this.extractEfficiency();

                // Get rare find
                const rareFindBreakdown = this.extractRareFind();

                // Get essence find
                const essenceFindBreakdown = this.extractEssenceFind();

                // Get requirements (inputs)
                const requirements = await this.extractRequirements();

                // Get drops (outputs) - now passing actionHrid for game data lookup
                const drops = await this.extractDrops(actionHrid);

                // Get catalyst
                const catalyst = await this.extractCatalyst();

                // Get consumables (tea/drinks)
                const consumables = await this.extractConsumables();
                const teaDuration = this.extractTeaDuration();

                return {
                    successRate: successRateBreakdown.total,
                    successRateBreakdown,
                    actionTime,
                    efficiency: efficiencyBreakdown.total,
                    efficiencyBreakdown,
                    actionSpeedBreakdown,
                    rareFindBreakdown,
                    essenceFindBreakdown,
                    requirements,
                    drops,
                    catalyst,
                    consumables,
                    teaDuration,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract action data:', error);
                return null;
            }
        }

        /**
         * Get current alchemy action HRID
         * @returns {string|null} Action HRID or null
         */
        getCurrentActionHrid() {
            try {
                // Get current actions from dataManager
                const currentActions = dataManager.getCurrentActions();
                if (!currentActions || currentActions.length === 0) return null;

                // Find alchemy action (type = /action_types/alchemy)
                for (const action of currentActions) {
                    if (action.actionHrid && action.actionHrid.startsWith('/actions/alchemy/')) {
                        return action.actionHrid;
                    }
                }

                return null;
            } catch (error) {
                console.error('[AlchemyProfit] Failed to get current action HRID:', error);
                return null;
            }
        }

        /**
         * Extract success rate with breakdown from the DOM and active buffs
         * @returns {Object} Success rate breakdown { total, base, tea }
         */
        extractSuccessRate() {
            try {
                const element = document.querySelector(
                    '[class*="SkillActionDetail_successRate"] [class*="SkillActionDetail_value"]'
                );
                if (!element) return null;

                const text = element.textContent.trim();
                const match = text.match(/(\d+\.?\d*)/);
                if (!match) return null;

                const totalSuccessRate = parseFloat(match[1]) / 100;

                // Calculate tea bonus from active drinks
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    return {
                        total: totalSuccessRate,
                        base: totalSuccessRate,
                        tea: 0,
                    };
                }

                const actionTypeHrid = '/action_types/alchemy';
                const drinkSlots = dataManager.getActionDrinkSlots(actionTypeHrid);
                const equipment = dataManager.getEquipment();

                // Get drink concentration from equipment
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate tea success rate bonus
                let teaBonus = 0;

                if (drinkSlots && drinkSlots.length > 0) {
                    for (const drink of drinkSlots) {
                        if (!drink || !drink.itemHrid) continue;

                        const itemDetails = gameData.itemDetailMap[drink.itemHrid];
                        if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                            continue;
                        }

                        // Check for alchemy_success buff
                        for (const buff of itemDetails.consumableDetail.buffs) {
                            if (buff.typeHrid === '/buff_types/alchemy_success') {
                                // ratioBoost is a percentage multiplier (e.g., 0.05 = 5% of base)
                                // It scales with drink concentration
                                const ratioBoost = buff.ratioBoost * (1 + drinkConcentration);
                                teaBonus += ratioBoost;
                            }
                        }
                    }
                }

                // Calculate base success rate (before tea bonus)
                // Formula: total = base × (1 + tea_ratio_boost)
                // So: base = total / (1 + tea_ratio_boost)
                const baseSuccessRate = totalSuccessRate / (1 + teaBonus);

                return {
                    total: totalSuccessRate,
                    base: baseSuccessRate,
                    tea: teaBonus,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract success rate:', error);
                return null;
            }
        }

        /**
         * Extract action speed buff using dataManager (matches Action Panel pattern)
         * @returns {Object} Action speed breakdown { total, equipment, tea }
         */
        extractActionSpeed() {
            try {
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    return { total: 0, equipment: 0, tea: 0 };
                }

                const equipment = dataManager.getEquipment();
                const actionTypeHrid = '/action_types/alchemy';

                // Parse equipment speed bonuses using utility
                const equipmentSpeed = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionTypeHrid, gameData.itemDetailMap);

                // TODO: Add tea speed bonuses when tea-parser supports it
                const teaSpeed = 0;

                const total = equipmentSpeed + teaSpeed;

                return {
                    total,
                    equipment: equipmentSpeed,
                    tea: teaSpeed,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract action speed:', error);
                return { total: 0, equipment: 0, tea: 0 };
            }
        }

        /**
         * Extract efficiency using dataManager (matches Action Panel pattern)
         * @returns {Object} Efficiency breakdown { total, level, house, tea, equipment, community }
         */
        extractEfficiency() {
            try {
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    return { total: 0, level: 0, house: 0, tea: 0, equipment: 0, community: 0 };
                }

                const equipment = dataManager.getEquipment();
                const skills = dataManager.getSkills();
                const houseRooms = Array.from(dataManager.getHouseRooms().values());
                const actionTypeHrid = '/action_types/alchemy';

                // Get required level from the DOM (action-specific)
                const requiredLevel = this.extractRequiredLevel();

                // Get current alchemy level from character skills
                let currentLevel = requiredLevel;
                for (const skill of skills) {
                    if (skill.skillHrid === '/skills/alchemy') {
                        currentLevel = skill.level;
                        break;
                    }
                }

                // Calculate house efficiency bonus (room level × 1.5%)
                let houseEfficiency = 0;
                for (const room of houseRooms) {
                    const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
                    if (roomDetail?.usableInActionTypeMap?.[actionTypeHrid]) {
                        houseEfficiency += (room.level || 0) * 1.5;
                    }
                }

                // Get equipped drink slots for alchemy
                const drinkSlots = dataManager.getActionDrinkSlots(actionTypeHrid);

                // Get drink concentration from equipment
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Parse tea efficiency bonus using utility
                const teaEfficiency = teaParser_js.parseTeaEfficiency(
                    actionTypeHrid,
                    drinkSlots,
                    gameData.itemDetailMap,
                    drinkConcentration
                );

                // Parse tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
                const teaLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
                    actionTypeHrid,
                    drinkSlots,
                    gameData.itemDetailMap,
                    drinkConcentration
                );

                // Calculate equipment efficiency bonus using utility
                const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(
                    equipment,
                    actionTypeHrid,
                    gameData.itemDetailMap
                );

                // Get community buff efficiency (Production Efficiency)
                const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
                let communityEfficiency = 0;
                if (communityBuffLevel > 0) {
                    // Formula: 0.14 + ((level - 1) × 0.003) = 14% base, +0.3% per level
                    const flatBoost = 0.14;
                    const flatBoostLevelBonus = 0.003;
                    const communityBonus = flatBoost + (communityBuffLevel - 1) * flatBoostLevelBonus;
                    communityEfficiency = communityBonus * 100; // Convert to percentage
                }

                // Get achievement buffs (Adept tier: +2% efficiency per tier)
                const achievementEfficiency =
                    dataManager.getAchievementBuffFlatBoost(actionTypeHrid, '/buff_types/efficiency') * 100;

                const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
                    requiredLevel,
                    skillLevel: currentLevel,
                    teaSkillLevelBonus: teaLevelBonus,
                    houseEfficiency,
                    teaEfficiency,
                    equipmentEfficiency,
                    communityEfficiency,
                    achievementEfficiency,
                });
                const totalEfficiency = efficiencyBreakdown.totalEfficiency;
                const levelEfficiency = efficiencyBreakdown.levelEfficiency;

                return {
                    total: totalEfficiency / 100, // Convert percentage to decimal
                    level: levelEfficiency,
                    house: houseEfficiency,
                    tea: teaEfficiency,
                    equipment: equipmentEfficiency,
                    community: communityEfficiency,
                    achievement: achievementEfficiency,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract efficiency:', error);
                return { total: 0, level: 0, house: 0, tea: 0, equipment: 0, community: 0, achievement: 0 };
            }
        }

        /**
         * Extract rare find bonus from equipment and buffs
         * @returns {Object} Rare find breakdown { total, equipment, achievement }
         */
        extractRareFind() {
            try {
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    return { total: 0, equipment: 0, achievement: 0 };
                }

                const equipment = dataManager.getEquipment();
                const actionTypeHrid = '/action_types/alchemy';

                // Parse equipment rare find bonuses
                let equipmentRareFind = 0;
                for (const slot of equipment) {
                    if (!slot || !slot.itemHrid) continue;

                    const itemDetail = gameData.itemDetailMap[slot.itemHrid];
                    if (!itemDetail?.noncombatStats?.rareFind) continue;

                    const enhancementLevel = slot.enhancementLevel || 0;
                    const enhancementBonus = this.getEnhancementBonus(enhancementLevel);
                    const slotMultiplier = this.getSlotMultiplier(itemDetail.equipmentType);

                    equipmentRareFind += itemDetail.noncombatStats.rareFind * (1 + enhancementBonus * slotMultiplier);
                }

                // Get achievement rare find bonus (Veteran tier: +2%)
                const achievementRareFind =
                    dataManager.getAchievementBuffFlatBoost(actionTypeHrid, '/buff_types/rare_find') * 100;

                const total = equipmentRareFind + achievementRareFind;

                return {
                    total: total / 100, // Convert to decimal
                    equipment: equipmentRareFind,
                    achievement: achievementRareFind,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract rare find:', error);
                return { total: 0, equipment: 0, achievement: 0 };
            }
        }

        /**
         * Extract essence find bonus from equipment and buffs
         * @returns {Object} Essence find breakdown { total, equipment }
         */
        extractEssenceFind() {
            try {
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    return { total: 0, equipment: 0 };
                }

                const equipment = dataManager.getEquipment();

                // Parse equipment essence find bonuses
                let equipmentEssenceFind = 0;
                for (const slot of equipment) {
                    if (!slot || !slot.itemHrid) continue;

                    const itemDetail = gameData.itemDetailMap[slot.itemHrid];
                    if (!itemDetail?.noncombatStats?.essenceFind) continue;

                    const enhancementLevel = slot.enhancementLevel || 0;
                    const enhancementBonus = this.getEnhancementBonus(enhancementLevel);
                    const slotMultiplier = this.getSlotMultiplier(itemDetail.equipmentType);

                    equipmentEssenceFind += itemDetail.noncombatStats.essenceFind * (1 + enhancementBonus * slotMultiplier);
                }

                return {
                    total: equipmentEssenceFind / 100, // Convert to decimal
                    equipment: equipmentEssenceFind,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract essence find:', error);
                return { total: 0, equipment: 0 };
            }
        }

        /**
         * Get enhancement bonus percentage for a given enhancement level
         * @param {number} enhancementLevel - Enhancement level (0-20)
         * @returns {number} Enhancement bonus as decimal
         */
        getEnhancementBonus(enhancementLevel) {
            const bonuses = {
                0: 0,
                1: 0.02,
                2: 0.042,
                3: 0.066,
                4: 0.092,
                5: 0.12,
                6: 0.15,
                7: 0.182,
                8: 0.216,
                9: 0.252,
                10: 0.29,
                11: 0.334,
                12: 0.384,
                13: 0.44,
                14: 0.502,
                15: 0.57,
                16: 0.644,
                17: 0.724,
                18: 0.81,
                19: 0.902,
                20: 1.0,
            };
            return bonuses[enhancementLevel] || 0;
        }

        /**
         * Get slot multiplier for enhancement bonuses
         * @param {string} equipmentType - Equipment type HRID
         * @returns {number} Multiplier (1 or 5)
         */
        getSlotMultiplier(equipmentType) {
            // 5× multiplier for accessories, back, trinket, charm, pouch
            const fiveXSlots = [
                '/equipment_types/neck',
                '/equipment_types/ring',
                '/equipment_types/earrings',
                '/equipment_types/back',
                '/equipment_types/trinket',
                '/equipment_types/charm',
                '/equipment_types/pouch',
            ];
            return fiveXSlots.includes(equipmentType) ? 5 : 1;
        }

        /**
         * Extract required level from notes
         * @returns {number} Required alchemy level
         */
        extractRequiredLevel() {
            try {
                const notesEl = document.querySelector('[class*="SkillActionDetail_notes"]');
                if (!notesEl) return 0;

                const text = notesEl.textContent;
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract required level:', error);
                return 0;
            }
        }

        /**
         * Extract tea buff duration from React props
         * @returns {number} Duration in seconds (default 300)
         */
        extractTeaDuration() {
            try {
                const rootEl = document.getElementById('root');
                const rootFiber =
                    rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
                if (!rootFiber) return 300;

                function find(fiber) {
                    if (!fiber) return null;
                    if (fiber.memoizedProps?.actionBuffs) return fiber;
                    return find(fiber.child) || find(fiber.sibling);
                }

                const fiberNode = find(rootFiber);
                if (!fiberNode) return 300;

                const buffs = fiberNode.memoizedProps.actionBuffs;
                for (const buff of buffs) {
                    if (buff.uniqueHrid && buff.uniqueHrid.endsWith('tea')) {
                        const duration = buff.duration || 0;
                        return duration / 1e9; // Convert nanoseconds to seconds
                    }
                }

                return 300; // Default 5 minutes
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract tea duration:', error);
                return 300;
            }
        }

        /**
         * Extract requirements (input materials) from the DOM
         * @returns {Promise<Array>} Array of requirement objects
         */
        async extractRequirements() {
            try {
                const elements = document.querySelectorAll(
                    '[class*="SkillActionDetail_itemRequirements"] [class*="Item_itemContainer"]'
                );
                const requirements = [];

                for (let i = 0; i < elements.length; i++) {
                    const el = elements[i];
                    const itemData = await this.extractItemData(el, true, i);
                    if (itemData) {
                        requirements.push(itemData);
                    }
                }

                return requirements;
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract requirements:', error);
                return [];
            }
        }

        /**
         * Extract drops (outputs) from the DOM
         * @returns {Promise<Array>} Array of drop objects
         */
        async extractDrops(actionHrid) {
            try {
                const elements = document.querySelectorAll(
                    '[class*="SkillActionDetail_dropTable"] [class*="Item_itemContainer"]'
                );
                const drops = [];

                // Get action details from game data for drop rates
                const gameData = dataManager.getInitClientData();
                const actionDetail = actionHrid && gameData ? gameData.actionDetailMap?.[actionHrid] : null;

                for (let i = 0; i < elements.length; i++) {
                    const el = elements[i];
                    const itemData = await this.extractItemData(el, false, i, actionDetail);
                    if (itemData) {
                        drops.push(itemData);
                    }
                }

                return drops;
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract drops:', error);
                return [];
            }
        }

        /**
         * Extract catalyst from the DOM
         * @returns {Promise<Object>} Catalyst object with prices
         */
        async extractCatalyst() {
            try {
                const element =
                    document.querySelector(
                        '[class*="SkillActionDetail_catalystItemInputContainer"] [class*="ItemSelector_itemContainer"]'
                    ) ||
                    document.querySelector(
                        '[class*="SkillActionDetail_catalystItemInputContainer"] [class*="SkillActionDetail_itemContainer"]'
                    );

                if (!element) {
                    return { ask: 0, bid: 0 };
                }

                const itemData = await this.extractItemData(element, false, -1);
                return itemData || { ask: 0, bid: 0 };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract catalyst:', error);
                return { ask: 0, bid: 0 };
            }
        }

        /**
         * Extract consumables (tea/drinks) from the DOM
         * @returns {Promise<Array>} Array of consumable objects
         */
        async extractConsumables() {
            try {
                const elements = document.querySelectorAll(
                    '[class*="ActionTypeConsumableSlots_consumableSlots"] [class*="Item_itemContainer"]'
                );
                const consumables = [];

                for (const el of elements) {
                    const itemData = await this.extractItemData(el, false, -1);
                    if (itemData && itemData.itemHrid !== '/items/coin') {
                        consumables.push(itemData);
                    }
                }

                return consumables;
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract consumables:', error);
                return [];
            }
        }

        /**
         * Calculate the cost to create an enhanced item
         * @param {string} itemHrid - Item HRID
         * @param {number} targetLevel - Target enhancement level
         * @param {string} priceType - 'ask' or 'bid'
         * @returns {number} Total cost to create the enhanced item
         */
        calculateEnhancementCost(itemHrid, targetLevel, priceType) {
            if (targetLevel === 0) {
                const priceData = marketAPI.getPrice(itemHrid, 0);
                return priceType === 'ask' ? priceData?.ask || 0 : priceData?.bid || 0;
            }

            const gameData = dataManager.getInitClientData();
            if (!gameData) return 0;

            const itemData = gameData.itemDetailMap?.[itemHrid];
            if (!itemData) return 0;

            // Start with base item cost
            const basePriceData = marketAPI.getPrice(itemHrid, 0);
            let totalCost = priceType === 'ask' ? basePriceData?.ask || 0 : basePriceData?.bid || 0;

            // Add enhancement material costs for each level
            const enhancementMaterials = itemData.enhancementCosts;
            if (!enhancementMaterials || !Array.isArray(enhancementMaterials)) {
                return totalCost;
            }

            // Enhance from level 0 to targetLevel
            for (let level = 0; level < targetLevel; level++) {
                for (const cost of enhancementMaterials) {
                    const materialHrid = cost.itemHrid;
                    const materialCount = cost.count || 0;

                    if (materialHrid === '/items/coin') {
                        totalCost += materialCount; // Coins are 1:1
                    } else {
                        const materialPrice = marketAPI.getPrice(materialHrid, 0);
                        const price = priceType === 'ask' ? materialPrice?.ask || 0 : materialPrice?.bid || 0;
                        totalCost += price * materialCount;
                    }
                }
            }

            return totalCost;
        }

        /**
         * Calculate value recovered from decomposing an enhanced item
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {string} priceType - 'ask' or 'bid'
         * @returns {number} Total value recovered from decomposition
         */
        calculateDecompositionValue(itemHrid, enhancementLevel, priceType) {
            if (enhancementLevel === 0) return 0;

            const gameData = dataManager.getInitClientData();
            if (!gameData) return 0;

            const itemDetails = gameData.itemDetailMap?.[itemHrid];
            if (!itemDetails) return 0;

            let totalValue = 0;

            // 1. Base item decomposition outputs
            if (itemDetails.decompositionDetail?.results) {
                for (const result of itemDetails.decompositionDetail.results) {
                    const priceData = marketAPI.getPrice(result.itemHrid, 0);
                    if (priceData) {
                        const price = priceType === 'ask' ? priceData.ask : priceData.bid;
                        totalValue += profitHelpers_js.calculatePriceAfterTax(price * result.amount); // 2% market tax
                    }
                }
            }

            // 2. Enhancing Essence from enhancement level
            // Formula: round(2 × (0.5 + 0.1 × (1.05^itemLevel)) × (2^enhancementLevel))
            const itemLevel = itemDetails.itemLevel || 1;
            const essenceAmount = Math.round(2 * (0.5 + 0.1 * Math.pow(1.05, itemLevel)) * Math.pow(2, enhancementLevel));

            const essencePriceData = marketAPI.getPrice('/items/enhancing_essence', 0);
            if (essencePriceData) {
                const essencePrice = priceType === 'ask' ? essencePriceData.ask : essencePriceData.bid;
                totalValue += profitHelpers_js.calculatePriceAfterTax(essencePrice * essenceAmount); // 2% market tax
            }

            return totalValue;
        }

        /**
         * Extract item data (HRID, prices, count, drop rate) from DOM element
         * @param {HTMLElement} element - Item container element
         * @param {boolean} isRequirement - True if this is a requirement (has count), false if drop (has drop rate)
         * @param {number} index - Index in the list (for extracting count/rate text)
         * @returns {Promise<Object|null>} Item data object or null
         */
        async extractItemData(element, isRequirement, index, actionDetail = null) {
            try {
                // Get item HRID from SVG use element
                const use = element.querySelector('svg use');
                if (!use) return null;

                const href = use.getAttribute('href');
                if (!href) return null;

                const itemId = href.split('#')[1];
                if (!itemId) return null;

                const itemHrid = `/items/${itemId}`;

                // Get enhancement level
                let enhancementLevel = 0;
                if (isRequirement) {
                    const enhEl = element.querySelector('[class*="Item_enhancementLevel"]');
                    if (enhEl) {
                        const match = enhEl.textContent.match(/\+(\d+)/);
                        enhancementLevel = match ? parseInt(match[1]) : 0;
                    }
                }

                // Get market prices
                let ask = 0,
                    bid = 0;
                if (itemHrid === '/items/coin') {
                    ask = bid = 1;
                } else {
                    // Check if this is an openable container (loot crate)
                    const itemDetails = dataManager.getItemDetails(itemHrid);
                    if (itemDetails?.isOpenable) {
                        // Use expected value calculator for openable containers
                        const containerValue = expectedValueCalculator.getCachedValue(itemHrid);
                        if (containerValue !== null && containerValue > 0) {
                            ask = bid = containerValue;
                        } else {
                            // Fallback to marketplace if EV not available
                            const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);
                            ask = priceData?.ask || 0;
                            bid = priceData?.bid || 0;
                        }
                    } else {
                        // Regular item - use marketplace price
                        const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);
                        if (priceData && (priceData.ask > 0 || priceData.bid > 0)) {
                            // Market data exists for this specific enhancement level
                            ask = priceData.ask || 0;
                            bid = priceData.bid || 0;
                        } else {
                            // No market data for this enhancement level - calculate cost
                            ask = this.calculateEnhancementCost(itemHrid, enhancementLevel, 'ask');
                            bid = this.calculateEnhancementCost(itemHrid, enhancementLevel, 'bid');
                        }
                    }
                }

                const result = { itemHrid, ask, bid, enhancementLevel };

                // Get count or drop rate
                if (isRequirement && index >= 0) {
                    // Extract count from requirement
                    const countElements = document.querySelectorAll(
                        '[class*="SkillActionDetail_itemRequirements"] [class*="SkillActionDetail_inputCount"]'
                    );

                    if (countElements[index]) {
                        const text = countElements[index].textContent.trim();
                        // Extract number after the "/" character (format: "/ 2" or "/ 450")
                        const match = text.match(/\/\s*([\d,]+)/);
                        let parsedCount = 1;

                        if (match) {
                            const cleaned = match[1].replace(/,/g, '');
                            parsedCount = parseFloat(cleaned);
                        }

                        result.count = parsedCount || 1;
                    } else {
                        result.count = 1;
                    }
                } else if (!isRequirement) {
                    // Extract count and drop rate from action detail (game data) or DOM fallback
                    let dropRateFromGameData = null;

                    // Try to get drop rate from game data first
                    if (actionDetail && actionDetail.dropTable) {
                        const dropEntry = actionDetail.dropTable.find((drop) => drop.itemHrid === itemHrid);
                        if (dropEntry) {
                            dropRateFromGameData = dropEntry.dropRate;
                        }
                    }

                    // Extract count from DOM
                    const dropElements = document.querySelectorAll(
                        '[class*="SkillActionDetail_drop"], [class*="SkillActionDetail_essence"], [class*="SkillActionDetail_rare"]'
                    );

                    for (const dropElement of dropElements) {
                        // Check if this drop element contains our item
                        const dropItemElement = dropElement.querySelector('[class*="Item_itemContainer"] svg use');
                        if (dropItemElement) {
                            const dropHref = dropItemElement.getAttribute('href');
                            const dropItemId = dropHref ? dropHref.split('#')[1] : null;
                            const dropItemHrid = dropItemId ? `/items/${dropItemId}` : null;

                            if (dropItemHrid === itemHrid) {
                                // Found the matching drop element
                                const text = dropElement.textContent.trim();

                                // Extract count (at start of text)
                                const countMatch = text.match(/^([\d\s,.]+)/);
                                if (countMatch) {
                                    const cleaned = countMatch[1].replace(/,/g, '').trim();
                                    result.count = parseFloat(cleaned) || 1;
                                } else {
                                    result.count = 1;
                                }

                                // Use drop rate from game data if available, otherwise try DOM
                                if (dropRateFromGameData !== null) {
                                    result.dropRate = dropRateFromGameData;
                                } else {
                                    // Extract drop rate percentage from DOM (handles both "7.29%" and "~7.29%")
                                    const rateMatch = text.match(/~?([\d,.]+)%/);
                                    if (rateMatch) {
                                        const cleaned = rateMatch[1].replace(/,/g, '');
                                        result.dropRate = parseFloat(cleaned) / 100 || 1;
                                    } else {
                                        result.dropRate = 1;
                                    }
                                }

                                break; // Found it, stop searching
                            }
                        }
                    }

                    // If we didn't find a matching drop element, set defaults
                    if (result.count === undefined) {
                        result.count = 1;
                    }
                    if (result.dropRate === undefined) {
                        // Use game data drop rate if available, otherwise default to 1
                        result.dropRate = dropRateFromGameData !== null ? dropRateFromGameData : 1;
                    }
                }

                return result;
            } catch (error) {
                console.error('[AlchemyProfit] Failed to extract item data:', error);
                return null;
            }
        }

        /**
         * Generate state fingerprint for change detection
         * @returns {string} Fingerprint string
         */
        getStateFingerprint() {
            try {
                const successRate =
                    document.querySelector('[class*="SkillActionDetail_successRate"] [class*="SkillActionDetail_value"]')
                        ?.textContent || '';
                const consumables = Array.from(
                    document.querySelectorAll(
                        '[class*="ActionTypeConsumableSlots_consumableSlots"] [class*="Item_itemContainer"]'
                    )
                )
                    .map((el) => el.querySelector('svg use')?.getAttribute('href') || 'empty')
                    .join('|');

                // Get catalyst (from the catalyst input container)
                const catalyst =
                    document
                        .querySelector('[class*="SkillActionDetail_catalystItemInputContainer"] svg use')
                        ?.getAttribute('href') || 'none';

                // Get requirements (input materials)
                const requirements = Array.from(
                    document.querySelectorAll('[class*="SkillActionDetail_itemRequirements"] [class*="Item_itemContainer"]')
                )
                    .map((el) => {
                        const href = el.querySelector('svg use')?.getAttribute('href') || 'empty';
                        const enh = el.querySelector('[class*="Item_enhancementLevel"]')?.textContent || '0';
                        return `${href}${enh}`;
                    })
                    .join('|');

                // Get selected alchemy tab (Coinify/Decompose/Transmute/etc)
                const alchemyContainer = document.querySelector('[class*="AlchemyPanel_tabsComponentContainer"]');
                const selectedTab =
                    alchemyContainer?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || '';

                // Don't include infoText - it contains our profit display which causes update loops
                return `${selectedTab}:${successRate}:${consumables}:${catalyst}:${requirements}`;
            } catch {
                return '';
            }
        }
    }

    const alchemyProfit = new AlchemyProfit();

    /**
     * Alchemy Profit Calculator Module
     * Calculates profit for alchemy actions (Coinify, Decompose, Transmute) from game JSON data
     *
     * Success Rates (Base, Unmodified):
     * - Coinify: 70% (0.7)
     * - Decompose: 60% (0.6)
     * - Transmute: Varies by item (from item.alchemyDetail.transmuteSuccessRate)
     *
     * Success Rate Modifiers:
     * - Tea: Catalytic Tea provides /buff_types/alchemy_success (5% ratio boost, scales with Drink Concentration)
     * - Formula: finalRate = baseRate × (1 + teaBonus)
     */


    // Base success rates for alchemy actions
    const BASE_SUCCESS_RATES = {
        COINIFY: 0.7, // 70%
        DECOMPOSE: 0.6, // 60%
        // TRANSMUTE: varies by item (from alchemyDetail.transmuteSuccessRate)
    };

    /**
     * Calculate alchemy-specific bonus drops (essences + rares) from item level.
     * Alchemy actions don't have essenceDropTable/rareDropTable in game data,
     * so we compute them from the item's level using reverse-engineered formulas.
     *
     * Essence: baseRate = (100 + itemLevel) / 1800
     * Rare (Small, level 1-34):  baseRate = (100 + itemLevel) / 144000
     * Rare (Medium, level 35-69): baseRate = (65 + itemLevel) / 216000
     * Rare (Large, level 70+):    baseRate = (30 + itemLevel) / 288000
     *
     * @param {number} itemLevel - The item's level (from itemDetails.itemLevel)
     * @param {number} actionsPerHour - Actions per hour (with efficiency)
     * @param {Map} equipment - Character equipment map
     * @param {Object} itemDetailMap - Item details map
     * @returns {Object} Bonus drop data with drops array and breakdowns
     */
    function calculateAlchemyBonusDrops(itemLevel, actionsPerHour, equipment, itemDetailMap) {
        const essenceFindBonus = equipmentParser_js.parseEssenceFindBonus(equipment, itemDetailMap);

        const equipmentRareFindBonus = equipmentParser_js.parseRareFindBonus(equipment, '/action_types/alchemy', itemDetailMap);
        const houseRareFindBonus = houseEfficiency_js.calculateHouseRareFind();
        const achievementRareFindBonus =
            dataManager.getAchievementBuffFlatBoost('/action_types/alchemy', '/buff_types/rare_find') * 100;
        const rareFindBonus = equipmentRareFindBonus + houseRareFindBonus + achievementRareFindBonus;

        const bonusDrops = [];
        let totalBonusRevenue = 0;

        // Essence drop: Alchemy Essence
        const baseEssenceRate = (100 + itemLevel) / 1800;
        const finalEssenceRate = baseEssenceRate * (1 + essenceFindBonus / 100);
        const essenceDropsPerHour = actionsPerHour * finalEssenceRate;

        let essencePrice = 0;
        const essenceItemDetails = itemDetailMap['/items/alchemy_essence'];
        if (essenceItemDetails?.isOpenable) {
            essencePrice = expectedValueCalculator.getCachedValue('/items/alchemy_essence') || 0;
        } else {
            const price = marketAPI.getPrice('/items/alchemy_essence', 0);
            essencePrice = price?.bid ?? 0;
        }

        const essenceRevenuePerHour = essenceDropsPerHour * essencePrice;
        bonusDrops.push({
            itemHrid: '/items/alchemy_essence',
            count: 1,
            dropRate: finalEssenceRate,
            effectiveDropRate: finalEssenceRate,
            price: essencePrice,
            isEssence: true,
            isRare: false,
            revenuePerAttempt: finalEssenceRate * essencePrice,
            revenuePerHour: essenceRevenuePerHour,
            dropsPerHour: essenceDropsPerHour,
        });
        totalBonusRevenue += essenceRevenuePerHour;

        // Rare drop: Artisan's Crate (size depends on item level)
        let baseRareRate;
        let crateHrid;
        if (itemLevel < 35) {
            baseRareRate = (100 + itemLevel) / 144000;
            crateHrid = '/items/small_artisans_crate';
        } else if (itemLevel < 70) {
            baseRareRate = (65 + itemLevel) / 216000;
            crateHrid = '/items/medium_artisans_crate';
        } else {
            baseRareRate = (30 + itemLevel) / 288000;
            crateHrid = '/items/large_artisans_crate';
        }

        const finalRareRate = baseRareRate * (1 + rareFindBonus / 100);
        const rareDropsPerHour = actionsPerHour * finalRareRate;

        let cratePrice = 0;
        const crateItemDetails = itemDetailMap[crateHrid];
        if (crateItemDetails?.isOpenable) {
            // Try cached EV first, then compute on-demand if cache is empty
            cratePrice =
                expectedValueCalculator.getCachedValue(crateHrid) ||
                expectedValueCalculator.calculateSingleContainer(crateHrid) ||
                0;
        } else {
            const price = marketAPI.getPrice(crateHrid, 0);
            cratePrice = price?.bid ?? 0;
        }

        const rareRevenuePerHour = rareDropsPerHour * cratePrice;
        bonusDrops.push({
            itemHrid: crateHrid,
            count: 1,
            dropRate: finalRareRate,
            effectiveDropRate: finalRareRate,
            price: cratePrice,
            isEssence: false,
            isRare: true,
            revenuePerAttempt: finalRareRate * cratePrice,
            revenuePerHour: rareRevenuePerHour,
            dropsPerHour: rareDropsPerHour,
        });
        totalBonusRevenue += rareRevenuePerHour;

        return {
            bonusDrops,
            totalBonusRevenue,
            essenceFindBonus,
            rareFindBonus,
            rareFindBreakdown: {
                equipment: equipmentRareFindBonus,
                house: houseRareFindBonus,
                achievement: achievementRareFindBonus,
                total: rareFindBonus,
            },
            essenceFindBreakdown: {
                equipment: essenceFindBonus,
                total: essenceFindBonus,
            },
        };
    }

    class AlchemyProfitCalculator {
        constructor() {
            // Cache for item detail map
            this._itemDetailMap = null;
        }

        /**
         * Get item detail map (lazy-loaded and cached)
         * @returns {Object} Item details map from init_client_data
         */
        getItemDetailMap() {
            if (!this._itemDetailMap) {
                const initData = dataManager.getInitClientData();
                this._itemDetailMap = initData?.itemDetailMap || {};
            }
            return this._itemDetailMap;
        }

        /**
         * Calculate success rate with detailed breakdown
         * @param {number} baseRate - Base success rate (0-1)
         * @returns {Object} Success rate breakdown { total, base, tea }
         */
        calculateSuccessRateBreakdown(baseRate) {
            try {
                // Get alchemy success bonus from active buffs
                const teaBonus = buffParser_js.getAlchemySuccessBonus();

                // Calculate final success rate
                const total = Math.min(1.0, baseRate * (1 + teaBonus));

                return {
                    total,
                    base: baseRate,
                    tea: teaBonus,
                };
            } catch (error) {
                console.error('[AlchemyProfitCalculator] Failed to calculate success rate breakdown:', error);
                return {
                    total: baseRate,
                    base: baseRate,
                    tea: 0,
                };
            }
        }

        /**
         * Calculate coinify profit for an item with full detailed breakdown
         * This is the SINGLE source of truth used by both tooltip and action panel
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level (default 0)
         * @returns {Object|null} Detailed profit data or null if not coinifiable
         */
        calculateCoinifyProfit(itemHrid, enhancementLevel = 0) {
            try {
                const gameData = dataManager.getInitClientData();
                const itemDetails = dataManager.getItemDetails(itemHrid);

                if (!gameData || !itemDetails) {
                    return null;
                }

                // Check if item is coinifiable
                if (!itemDetails.alchemyDetail || itemDetails.alchemyDetail.isCoinifiable !== true) {
                    return null;
                }

                // Get alchemy action details
                const actionDetails = gameData.actionDetailMap['/actions/alchemy/coinify'];
                if (!actionDetails) {
                    return null;
                }

                // Get pricing mode
                const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
                let buyType, sellType;
                if (pricingMode === 'conservative') {
                    buyType = 'ask';
                    sellType = 'bid';
                } else if (pricingMode === 'hybrid') {
                    buyType = 'ask';
                    sellType = 'ask';
                } else {
                    buyType = 'bid';
                    sellType = 'ask';
                }

                // Calculate action stats (time + efficiency) using shared helper
                // Alchemy uses item level (not action requirement) for efficiency calculation
                const actionStats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                    includeCommunityBuff: true,
                    includeBreakdown: true,
                    levelRequirementOverride: itemDetails.itemLevel || 1,
                });

                const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

                // Get equipment for drink concentration and speed calculation
                const equipment = dataManager.getEquipment();

                // Calculate action speed breakdown with details
                const _baseTime = actionDetails.baseTimeCost / 1e9;
                const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, gameData.itemDetailMap);

                // Get detailed equipment speed breakdown
                const allSpeedBonuses = equipmentParser_js.debugEquipmentSpeedBonuses(equipment, gameData.itemDetailMap);
                const skillName = actionDetails.type.replace('/action_types/', '');
                const skillSpecificSpeed = skillName + 'Speed';
                const relevantSpeeds = allSpeedBonuses.filter((item) => {
                    return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
                });

                // TODO: Add tea speed bonuses when tea-parser supports it
                const teaSpeed = 0;
                const actionSpeedBreakdown = {
                    total: speedBonus + teaSpeed,
                    equipment: speedBonus,
                    tea: teaSpeed,
                    equipmentDetails: relevantSpeeds.map((item) => ({
                        name: item.itemName,
                        enhancementLevel: item.enhancementLevel,
                        speedBonus: item.scaledBonus,
                    })),
                    teaDetails: [], // TODO: Add when tea speed is supported
                };

                // Get drink concentration separately (not in breakdown from calculateActionStats)
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate success rate with breakdown
                const baseSuccessRate = BASE_SUCCESS_RATES.COINIFY;
                const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
                const successRate = successRateBreakdown.total;

                // Calculate input cost (material cost)
                const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;
                const pricePerItem = marketData_js.getItemPrice(itemHrid, { context: 'profit', side: buyType, enhancementLevel });
                if (pricePerItem === null) {
                    return null; // No market data
                }
                const materialCost = pricePerItem * bulkMultiplier;

                // Coinify has no catalyst (catalyst is 0 for coinify)
                const catalystPrice = 0;

                // Get coin cost per action attempt
                // If not in action data, calculate as 1/5 of item's sell price per item
                const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2) * bulkMultiplier;

                // Calculate cost per attempt (materials consumed on all attempts)
                const costPerAttempt = materialCost + coinCost;

                // Calculate output value (coins produced)
                // Formula: sellPrice × bulkMultiplier × 5
                const coinsProduced = (itemDetails.sellPrice || 0) * bulkMultiplier * 5;

                // Revenue per attempt (coins are always 1:1, only get coins on success)
                // Note: efficiency is applied to NET PROFIT, not revenue
                const revenuePerAttempt = coinsProduced * successRate;

                // Net profit per attempt (before efficiency)
                const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

                // Calculate tea costs
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                    drinkConcentration,
                    itemDetailMap: gameData.itemDetailMap,
                    getItemPrice: (hrid) => marketData_js.getItemPrice(hrid, { context: 'profit', side: buyType }),
                });

                // Calculate per-hour values
                // Actions per hour (for display breakdown) - includes efficiency for display purposes
                // Convert efficiency from percentage to decimal (81.516% -> 0.81516)
                const efficiencyDecimal = totalEfficiency / 100;
                const actionsPerHourWithEfficiency = profitHelpers_js.calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

                // Calculate bonus revenue (essences + rares) from item level
                const itemLevel = itemDetails.itemLevel || 1;
                const alchemyBonus = calculateAlchemyBonusDrops(
                    itemLevel,
                    actionsPerHourWithEfficiency,
                    equipment,
                    gameData.itemDetailMap
                );

                // Material and revenue calculations (for breakdown display)
                const materialCostPerHour = (materialCost + coinCost) * actionsPerHourWithEfficiency;
                const catalystCostPerHour = 0; // No catalyst for coinify
                const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

                // Profit calculation (matches OLD system formula)
                // Formula: (netProfit × (1 + efficiency)) / actionTime × 3600 + bonusRevenue - teaCost
                const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
                const profitPerHour =
                    profitPerSecond * profitConstants_js.SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

                // Build detailed breakdowns
                const requirementCosts = [
                    {
                        itemHrid,
                        count: bulkMultiplier,
                        price: pricePerItem,
                        costPerAction: materialCost,
                        costPerHour: materialCost * actionsPerHourWithEfficiency,
                        enhancementLevel: enhancementLevel || 0,
                    },
                ];

                // Add coin cost entry if applicable
                if (coinCost > 0) {
                    requirementCosts.push({
                        itemHrid: '/items/coin',
                        count: coinCost,
                        price: 1,
                        costPerAction: coinCost,
                        costPerHour: coinCost * actionsPerHourWithEfficiency,
                        enhancementLevel: 0,
                    });
                }

                const coinRevenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency;

                const dropRevenues = [
                    {
                        itemHrid: '/items/coin',
                        count: coinsProduced,
                        dropRate: 1.0, // Coins always drop
                        effectiveDropRate: 1.0,
                        price: 1, // Coins are 1:1
                        isEssence: false,
                        isRare: false,
                        revenuePerAttempt,
                        revenuePerHour: coinRevenuePerHour,
                        dropsPerHour: coinsProduced * successRate * actionsPerHourWithEfficiency,
                    },
                ];

                // Add alchemy essence and rare drops
                for (const drop of alchemyBonus.bonusDrops) {
                    dropRevenues.push(drop);
                }

                const catalystCost = {
                    itemHrid: null,
                    price: 0,
                    costPerSuccess: 0,
                    costPerAttempt: 0,
                    costPerHour: 0,
                };

                const consumableCosts = teaCostData.costs.map((cost) => ({
                    itemHrid: cost.itemHrid,
                    price: cost.pricePerDrink,
                    drinksPerHour: cost.drinksPerHour,
                    costPerHour: cost.totalCost,
                }));

                // Return comprehensive data matching what action panel needs
                return {
                    // Basic info
                    actionType: 'coinify',
                    itemHrid,
                    enhancementLevel,

                    // Summary totals
                    profitPerHour,
                    profitPerDay,
                    revenuePerHour,

                    // Actions and rates
                    actionsPerHour: actionsPerHourWithEfficiency,
                    actionTime,

                    // Per-attempt economics
                    materialCost,
                    catalystPrice,
                    costPerAttempt,
                    incomePerAttempt: revenuePerAttempt,
                    netProfitPerAttempt,

                    // Per-hour costs
                    materialCostPerHour,
                    catalystCostPerHour,
                    totalTeaCostPerHour: teaCostData.totalCostPerHour,

                    // Detailed breakdowns
                    requirementCosts,
                    dropRevenues,
                    catalystCost,
                    consumableCosts,

                    // Core stats
                    successRate,
                    efficiency: efficiencyDecimal, // Decimal form (0.81516 for 81.516%)

                    // Modifier breakdowns
                    successRateBreakdown,
                    efficiencyBreakdown,
                    actionSpeedBreakdown,
                    rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                    essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                    // Pricing info
                    pricingMode,
                    buyType,
                    sellType,
                };
            } catch (error) {
                console.error('[AlchemyProfitCalculator] Failed to calculate coinify profit:', error);
                return null;
            }
        }

        /**
         * Calculate Decompose profit for an item with full detailed breakdown
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level (default 0)
         * @returns {Object|null} Profit data or null if not decomposable
         */
        calculateDecomposeProfit(itemHrid, enhancementLevel = 0) {
            try {
                const gameData = dataManager.getInitClientData();
                const itemDetails = dataManager.getItemDetails(itemHrid);

                if (!gameData || !itemDetails) {
                    return null;
                }

                // Check if item is decomposable
                if (!itemDetails.alchemyDetail || !itemDetails.alchemyDetail.decomposeItems) {
                    return null;
                }

                // Get alchemy action details
                const actionDetails = gameData.actionDetailMap['/actions/alchemy/decompose'];
                if (!actionDetails) {
                    return null;
                }

                // Get pricing mode
                const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
                let buyType, sellType;
                if (pricingMode === 'conservative') {
                    buyType = 'ask';
                    sellType = 'bid';
                } else if (pricingMode === 'hybrid') {
                    buyType = 'ask';
                    sellType = 'ask';
                } else {
                    buyType = 'bid';
                    sellType = 'ask';
                }

                // Calculate action stats (time + efficiency) using shared helper
                // Alchemy uses item level (not action requirement) for efficiency calculation
                const actionStats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                    includeCommunityBuff: true,
                    includeBreakdown: true,
                    levelRequirementOverride: itemDetails.itemLevel || 1,
                });

                const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

                // Get equipment for drink concentration and speed calculation
                const equipment = dataManager.getEquipment();

                // Calculate action speed breakdown with details
                const _baseTime = actionDetails.baseTimeCost / 1e9;
                const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, gameData.itemDetailMap);

                // Get detailed equipment speed breakdown
                const allSpeedBonuses = equipmentParser_js.debugEquipmentSpeedBonuses(equipment, gameData.itemDetailMap);
                const skillName = actionDetails.type.replace('/action_types/', '');
                const skillSpecificSpeed = skillName + 'Speed';
                const relevantSpeeds = allSpeedBonuses.filter((item) => {
                    return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
                });

                // TODO: Add tea speed bonuses when tea-parser supports it
                const teaSpeed = 0;
                const actionSpeedBreakdown = {
                    total: speedBonus + teaSpeed,
                    equipment: speedBonus,
                    tea: teaSpeed,
                    equipmentDetails: relevantSpeeds.map((item) => ({
                        name: item.itemName,
                        enhancementLevel: item.enhancementLevel,
                        speedBonus: item.scaledBonus,
                    })),
                    teaDetails: [], // TODO: Add when tea speed is supported
                };
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate success rate with breakdown
                const baseSuccessRate = BASE_SUCCESS_RATES.DECOMPOSE;
                const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
                const successRate = successRateBreakdown.total;

                // Get input cost (market price of the item being decomposed)
                const inputPrice = marketData_js.getItemPrice(itemHrid, { context: 'profit', side: buyType, enhancementLevel });
                if (inputPrice === null) {
                    return null; // No market data
                }

                // Calculate output value
                let outputValue = 0;
                const dropDetails = [];

                // 1. Base decompose items (always received on success)
                for (const output of itemDetails.alchemyDetail.decomposeItems) {
                    const outputPrice = marketData_js.getItemPrice(output.itemHrid, { context: 'profit', side: sellType });
                    if (outputPrice !== null) {
                        const afterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);
                        const dropValue = afterTax * output.count;
                        outputValue += dropValue;

                        dropDetails.push({
                            itemHrid: output.itemHrid,
                            count: output.count,
                            price: outputPrice,
                            afterTax,
                            isEssence: false,
                            expectedValue: dropValue,
                        });
                    }
                }

                // 2. Enhancing Essence (if item is enhanced)
                let essenceAmount = 0;
                if (enhancementLevel > 0) {
                    const itemLevel = itemDetails.itemLevel || 1;
                    essenceAmount = Math.round(2 * (0.5 + 0.1 * Math.pow(1.05, itemLevel)) * Math.pow(2, enhancementLevel));

                    const essencePrice = marketData_js.getItemPrice('/items/enhancing_essence', { context: 'profit', side: sellType });
                    if (essencePrice !== null) {
                        const afterTax = profitHelpers_js.calculatePriceAfterTax(essencePrice);
                        const dropValue = afterTax * essenceAmount;
                        outputValue += dropValue;

                        dropDetails.push({
                            itemHrid: '/items/enhancing_essence',
                            count: essenceAmount,
                            price: essencePrice,
                            afterTax,
                            isEssence: true,
                            expectedValue: dropValue,
                        });
                    }
                }

                // Revenue per attempt (only on success)
                const revenuePerAttempt = outputValue * successRate;

                // Get coin cost per action attempt
                // If not in action data, calculate as 1/5 of item's sell price
                const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2);

                // Cost per attempt (input consumed on every attempt)
                const costPerAttempt = inputPrice + coinCost;

                // Net profit per attempt (before efficiency)
                const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

                // Calculate tea costs
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                    drinkConcentration,
                    itemDetailMap: gameData.itemDetailMap,
                    getItemPrice: (hrid) => marketData_js.getItemPrice(hrid, { context: 'profit', side: buyType }),
                });

                // Calculate per-hour values
                // Convert efficiency from percentage to decimal
                const efficiencyDecimal = totalEfficiency / 100;
                const actionsPerHourWithEfficiency = profitHelpers_js.calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

                // Calculate bonus revenue (essences + rares) from item level
                const itemLevel = itemDetails.itemLevel || 1;
                const alchemyBonus = calculateAlchemyBonusDrops(
                    itemLevel,
                    actionsPerHourWithEfficiency,
                    equipment,
                    gameData.itemDetailMap
                );

                // Material and revenue calculations (for breakdown display)
                const materialCostPerHour = (inputPrice + coinCost) * actionsPerHourWithEfficiency;
                const catalystCostPerHour = 0; // No catalyst for decompose
                const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

                // Profit calculation (matches OLD system formula)
                const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
                const profitPerHour =
                    profitPerSecond * profitConstants_js.SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

                // Build detailed breakdowns
                const requirementCosts = [
                    {
                        itemHrid,
                        count: 1,
                        price: inputPrice,
                        costPerAction: inputPrice,
                        costPerHour: inputPrice * actionsPerHourWithEfficiency,
                        enhancementLevel: enhancementLevel || 0,
                    },
                ];

                // Add coin cost entry if applicable
                if (coinCost > 0) {
                    requirementCosts.push({
                        itemHrid: '/items/coin',
                        count: coinCost,
                        price: 1,
                        costPerAction: coinCost,
                        costPerHour: coinCost * actionsPerHourWithEfficiency,
                        enhancementLevel: 0,
                    });
                }

                const dropRevenues = dropDetails.map((drop) => ({
                    itemHrid: drop.itemHrid,
                    count: drop.count,
                    dropRate: 1.0, // Decompose drops are guaranteed on success
                    effectiveDropRate: 1.0,
                    price: drop.price,
                    isEssence: drop.isEssence,
                    isRare: false,
                    revenuePerAttempt: drop.expectedValue * successRate,
                    revenuePerHour: drop.expectedValue * successRate * actionsPerHourWithEfficiency,
                    dropsPerHour: drop.count * successRate * actionsPerHourWithEfficiency,
                }));

                // Add alchemy essence and rare drops
                for (const drop of alchemyBonus.bonusDrops) {
                    dropRevenues.push(drop);
                }

                const catalystCost = {
                    itemHrid: null,
                    price: 0,
                    costPerSuccess: 0,
                    costPerAttempt: 0,
                    costPerHour: 0,
                };

                const consumableCosts = teaCostData.costs.map((cost) => ({
                    itemHrid: cost.itemHrid,
                    price: cost.pricePerDrink,
                    drinksPerHour: cost.drinksPerHour,
                    costPerHour: cost.totalCost,
                }));

                // Return comprehensive data matching what action panel needs
                return {
                    // Basic info
                    actionType: 'decompose',
                    itemHrid,
                    enhancementLevel,

                    // Summary totals
                    profitPerHour,
                    profitPerDay,
                    revenuePerHour,

                    // Actions and rates
                    actionsPerHour: actionsPerHourWithEfficiency,
                    actionTime,

                    // Per-attempt economics
                    materialCost: inputPrice,
                    catalystPrice: 0,
                    costPerAttempt,
                    incomePerAttempt: revenuePerAttempt,
                    netProfitPerAttempt,

                    // Per-hour costs
                    materialCostPerHour,
                    catalystCostPerHour,
                    totalTeaCostPerHour: teaCostData.totalCostPerHour,

                    // Detailed breakdowns
                    requirementCosts,
                    dropRevenues,
                    catalystCost,
                    consumableCosts,

                    // Core stats
                    successRate,
                    efficiency: efficiencyDecimal,

                    // Modifier breakdowns
                    successRateBreakdown,
                    efficiencyBreakdown,
                    actionSpeedBreakdown,
                    rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                    essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                    // Pricing info
                    pricingMode,
                    buyType,
                    sellType,
                };
            } catch (error) {
                console.error('[AlchemyProfitCalculator] Failed to calculate decompose profit:', error);
                return null;
            }
        }

        /**
         * Calculate Transmute profit for an item with full detailed breakdown
         * @param {string} itemHrid - Item HRID
         * @returns {Object|null} Profit data or null if not transmutable
         */
        calculateTransmuteProfit(itemHrid) {
            try {
                const gameData = dataManager.getInitClientData();
                const itemDetails = dataManager.getItemDetails(itemHrid);

                if (!gameData || !itemDetails) {
                    return null;
                }

                // Check if item is transmutable
                if (!itemDetails.alchemyDetail || !itemDetails.alchemyDetail.transmuteDropTable) {
                    return null;
                }

                // Get base success rate from item
                const baseSuccessRate = itemDetails.alchemyDetail.transmuteSuccessRate || 0;
                if (baseSuccessRate === 0) {
                    return null; // Cannot transmute
                }

                // Get alchemy action details
                const actionDetails = gameData.actionDetailMap['/actions/alchemy/transmute'];
                if (!actionDetails) {
                    return null;
                }

                // Get pricing mode
                const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
                let buyType, sellType;
                if (pricingMode === 'conservative') {
                    buyType = 'ask';
                    sellType = 'bid';
                } else if (pricingMode === 'hybrid') {
                    buyType = 'ask';
                    sellType = 'ask';
                } else {
                    buyType = 'bid';
                    sellType = 'ask';
                }

                // Calculate action stats (time + efficiency) using shared helper
                // Alchemy uses item level (not action requirement) for efficiency calculation
                const actionStats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                    includeCommunityBuff: true,
                    includeBreakdown: true,
                    levelRequirementOverride: itemDetails.itemLevel || 1,
                });

                const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

                // Get equipment for drink concentration and speed calculation
                const equipment = dataManager.getEquipment();

                // Calculate action speed breakdown with details
                const _baseTime = actionDetails.baseTimeCost / 1e9;
                const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, gameData.itemDetailMap);

                // Get detailed equipment speed breakdown
                const allSpeedBonuses = equipmentParser_js.debugEquipmentSpeedBonuses(equipment, gameData.itemDetailMap);
                const skillName = actionDetails.type.replace('/action_types/', '');
                const skillSpecificSpeed = skillName + 'Speed';
                const relevantSpeeds = allSpeedBonuses.filter((item) => {
                    return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
                });

                // TODO: Add tea speed bonuses when tea-parser supports it
                const teaSpeed = 0;
                const actionSpeedBreakdown = {
                    total: speedBonus + teaSpeed,
                    equipment: speedBonus,
                    tea: teaSpeed,
                    equipmentDetails: relevantSpeeds.map((item) => ({
                        name: item.itemName,
                        enhancementLevel: item.enhancementLevel,
                        speedBonus: item.scaledBonus,
                    })),
                    teaDetails: [], // TODO: Add when tea speed is supported
                };
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate success rate with breakdown
                const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
                const successRate = successRateBreakdown.total;

                // Get input cost (market price of the item being transmuted)
                const inputPrice = marketData_js.getItemPrice(itemHrid, { context: 'profit', side: buyType });
                if (inputPrice === null) {
                    return null; // No market data
                }

                // Get bulk multiplier (number of items consumed AND produced per action)
                const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;

                // Calculate expected value of outputs, excluding self-returns (Milkonomy-style)
                // Self-returns are when you get the same item back - these don't count as income
                let expectedOutputValue = 0;
                let selfReturnRate = 0;
                let selfReturnCount = 0;
                const dropDetails = [];

                for (const drop of itemDetails.alchemyDetail.transmuteDropTable) {
                    const isSelfReturn = drop.itemHrid === itemHrid;
                    const averageCount = (drop.minCount + drop.maxCount) / 2;

                    if (isSelfReturn) {
                        // Track self-return for cost adjustment
                        selfReturnRate = drop.dropRate;
                        selfReturnCount = averageCount * bulkMultiplier;
                    }

                    const outputPrice = marketData_js.getItemPrice(drop.itemHrid, { context: 'profit', side: sellType });
                    if (outputPrice !== null) {
                        const afterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);
                        // Expected value: price × dropRate × averageCount × bulkMultiplier
                        const dropValue = afterTax * drop.dropRate * averageCount * bulkMultiplier;

                        // Only add to revenue if NOT a self-return
                        if (!isSelfReturn) {
                            expectedOutputValue += dropValue;
                        }

                        dropDetails.push({
                            itemHrid: drop.itemHrid,
                            dropRate: drop.dropRate,
                            minCount: drop.minCount,
                            maxCount: drop.maxCount,
                            averageCount,
                            price: outputPrice,
                            expectedValue: isSelfReturn ? 0 : dropValue, // Self-return has 0 effective value
                            isSelfReturn,
                        });
                    }
                }

                // Revenue per attempt (expected value on success, excluding self-returns)
                const revenuePerAttempt = expectedOutputValue * successRate;

                // Material cost calculation with self-return adjustment
                // Gross cost = input price × bulk
                // Self-return value = input price × self return rate × success rate × bulk
                // Net cost = gross - self-return value
                const grossMaterialCost = inputPrice * bulkMultiplier;
                const selfReturnValue = inputPrice * selfReturnRate * successRate * selfReturnCount;
                const netMaterialCost = grossMaterialCost - selfReturnValue;

                // Get coin cost per action attempt
                // If not in action data, calculate as 1/5 of item's sell price per item
                const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2) * bulkMultiplier;

                // Cost per attempt (net material cost after self-return + coin cost)
                const costPerAttempt = netMaterialCost + coinCost;

                // Net profit per attempt (before efficiency)
                const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

                // Calculate tea costs
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                    drinkConcentration,
                    itemDetailMap: gameData.itemDetailMap,
                    getItemPrice: (hrid) => marketData_js.getItemPrice(hrid, { context: 'profit', side: buyType }),
                });

                // Calculate per-hour values
                // Convert efficiency from percentage to decimal
                const efficiencyDecimal = totalEfficiency / 100;
                const actionsPerHourWithEfficiency = profitHelpers_js.calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

                // Calculate bonus revenue (essences + rares) from item level
                const itemLevel = itemDetails.itemLevel || 1;
                const alchemyBonus = calculateAlchemyBonusDrops(
                    itemLevel,
                    actionsPerHourWithEfficiency,
                    equipment,
                    gameData.itemDetailMap
                );

                // Material and revenue calculations (for breakdown display)
                // Use net material cost (after self-return adjustment)
                const materialCostPerHour = (netMaterialCost + coinCost) * actionsPerHourWithEfficiency;
                const catalystCostPerHour = 0; // No catalyst for transmute
                const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

                // Profit calculation (matches OLD system formula)
                const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
                const profitPerHour =
                    profitPerSecond * profitConstants_js.SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

                // Build detailed breakdowns
                const requirementCosts = [
                    {
                        itemHrid,
                        count: bulkMultiplier,
                        price: inputPrice,
                        costPerAction: netMaterialCost, // Net cost after self-return
                        costPerHour: netMaterialCost * actionsPerHourWithEfficiency,
                        enhancementLevel: 0,
                        selfReturnRate: selfReturnRate > 0 ? selfReturnRate : undefined,
                        selfReturnValue: selfReturnValue > 0 ? selfReturnValue : undefined,
                    },
                ];

                // Add coin cost entry if applicable
                if (coinCost > 0) {
                    requirementCosts.push({
                        itemHrid: '/items/coin',
                        count: coinCost,
                        price: 1,
                        costPerAction: coinCost,
                        costPerHour: coinCost * actionsPerHourWithEfficiency,
                        enhancementLevel: 0,
                    });
                }

                const dropRevenues = dropDetails.map((drop) => ({
                    itemHrid: drop.itemHrid,
                    count: drop.averageCount * bulkMultiplier,
                    dropRate: drop.dropRate,
                    effectiveDropRate: drop.dropRate,
                    price: drop.price,
                    isEssence: false,
                    isRare: false,
                    isSelfReturn: drop.isSelfReturn || false,
                    revenuePerAttempt: drop.expectedValue * successRate,
                    revenuePerHour: drop.expectedValue * successRate * actionsPerHourWithEfficiency,
                    dropsPerHour:
                        drop.averageCount * bulkMultiplier * drop.dropRate * successRate * actionsPerHourWithEfficiency,
                }));

                // Add alchemy essence and rare drops
                for (const drop of alchemyBonus.bonusDrops) {
                    dropRevenues.push(drop);
                }

                const catalystCost = {
                    itemHrid: null,
                    price: 0,
                    costPerSuccess: 0,
                    costPerAttempt: 0,
                    costPerHour: 0,
                };

                const consumableCosts = teaCostData.costs.map((cost) => ({
                    itemHrid: cost.itemHrid,
                    price: cost.pricePerDrink,
                    drinksPerHour: cost.drinksPerHour,
                    costPerHour: cost.totalCost,
                }));

                // Return comprehensive data matching what action panel needs
                return {
                    // Basic info
                    actionType: 'transmute',
                    itemHrid,
                    enhancementLevel: 0, // Transmute doesn't care about enhancement

                    // Summary totals
                    profitPerHour,
                    profitPerDay,
                    revenuePerHour,

                    // Actions and rates
                    actionsPerHour: actionsPerHourWithEfficiency,
                    actionTime,

                    // Per-attempt economics
                    materialCost: netMaterialCost, // Net cost after self-return adjustment
                    grossMaterialCost,
                    selfReturnValue,
                    catalystPrice: 0,
                    costPerAttempt,
                    incomePerAttempt: revenuePerAttempt,
                    netProfitPerAttempt,

                    // Per-hour costs
                    materialCostPerHour,
                    catalystCostPerHour,
                    totalTeaCostPerHour: teaCostData.totalCostPerHour,

                    // Detailed breakdowns
                    requirementCosts,
                    dropRevenues,
                    catalystCost,
                    consumableCosts,

                    // Core stats
                    successRate,
                    efficiency: efficiencyDecimal,

                    // Modifier breakdowns
                    successRateBreakdown,
                    efficiencyBreakdown,
                    actionSpeedBreakdown,
                    rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                    essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                    // Pricing info
                    pricingMode,
                    buyType,
                    sellType,
                };
            } catch (error) {
                console.error('[AlchemyProfitCalculator] Failed to calculate transmute profit:', error);
                return null;
            }
        }

        /**
         * Calculate all applicable profits for an item
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level (default 0)
         * @returns {Object} Object with all applicable profit calculations
         */
        calculateAllProfits(itemHrid, enhancementLevel = 0) {
            const results = {};

            // Try coinify
            const coinifyProfit = this.calculateCoinifyProfit(itemHrid, enhancementLevel);
            if (coinifyProfit) {
                results.coinify = coinifyProfit;
            }

            // Try decompose
            const decomposeProfit = this.calculateDecomposeProfit(itemHrid, enhancementLevel);
            if (decomposeProfit) {
                results.decompose = decomposeProfit;
            }

            // Try transmute (only for base items)
            if (enhancementLevel === 0) {
                const transmuteProfit = this.calculateTransmuteProfit(itemHrid);
                if (transmuteProfit) {
                    results.transmute = transmuteProfit;
                }
            }

            return results;
        }
    }

    const alchemyProfitCalculator = new AlchemyProfitCalculator();

    /**
     * Alchemy Profit Display Module
     * Displays profit calculator in alchemy action detail panel
     */


    class AlchemyProfitDisplay {
        constructor() {
            this.isActive = false;
            this.unregisterObserver = null;
            this.contentObserver = null;
            this.tabObserver = null;
            this.displayElement = null;
            this.updateTimeout = null;
            this.lastFingerprint = null;
            this.isInitialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.equipmentChangeHandler = null;
            this.cachedInputField = null; // Cache input field since it gets removed when action starts
        }

        /**
         * Initialize the display system
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('alchemy_profitDisplay')) {
                return;
            }

            this.isInitialized = true;
            this.setupObserver();

            // Listen for equipment changes (alchemy allows equipment changes while panel is open)
            this.equipmentChangeHandler = () => {
                // Debounce to avoid excessive updates
                clearTimeout(this.equipmentChangeTimeout);
                this.equipmentChangeTimeout = setTimeout(() => {
                    if (this.isActive) {
                        // Clear fingerprint to force update since equipment affects calculations
                        this.lastFingerprint = null;
                        this.checkAndUpdateDisplay();
                    }
                }, 100);
            };
            dataManager.on('items_updated', this.equipmentChangeHandler);

            this.isActive = true;
        }

        /**
         * Setup DOM observer to watch for alchemy panel
         */
        setupObserver() {
            // Observer for alchemy component appearing
            this.unregisterObserver = domObserver.onClass(
                'AlchemyProfitDisplay',
                'SkillActionDetail_alchemyComponent',
                (alchemyComponent) => {
                    this.checkAndUpdateDisplay();
                    // Setup content observer when alchemy component appears
                    this.setupContentObserver(alchemyComponent);
                }
            );

            // Initial check for existing panel
            const existingComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
            if (existingComponent) {
                this.checkAndUpdateDisplay();
                this.setupContentObserver(existingComponent);
            }
        }

        /**
         * Setup observer for content changes within alchemy component
         * Watches for tab switches and item selection changes
         * @param {HTMLElement} alchemyComponent - The alchemy component container
         */
        setupContentObserver(alchemyComponent) {
            // Don't create duplicate observers
            if (this.contentObserver) {
                this.contentObserver.disconnect();
            }
            if (this.tabObserver) {
                this.tabObserver.disconnect();
            }

            // Debounce timer for update calls
            let debounceTimer = null;

            const triggerUpdate = () => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                debounceTimer = setTimeout(() => {
                    this.checkAndUpdateDisplay();
                }, 50);
            };

            // Observer for tab switches - observe the tab container separately
            const tabContainer = document.querySelector('[class*="AlchemyPanel_tabsComponentContainer"]');
            if (tabContainer) {
                this.tabObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        if (mutation.type === 'attributes' && mutation.attributeName === 'aria-selected') {
                            if (mutation.target.getAttribute('aria-selected') === 'true') {
                                triggerUpdate();
                                return;
                            }
                        }
                    }
                });

                this.tabObserver.observe(tabContainer, {
                    attributes: true,
                    attributeFilter: ['aria-selected'],
                    subtree: true,
                });
            }

            // Observer for content changes (item selection)
            this.contentObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    // Watch for childList changes (sections being added/removed)
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const className = node.className || '';
                                if (
                                    typeof className === 'string' &&
                                    (className.includes('SkillActionDetail_itemRequirements') ||
                                        className.includes('SkillActionDetail_alchemyOutput') ||
                                        className.includes('SkillActionDetail_primaryItemSelectorContainer') ||
                                        className.includes('SkillActionDetail_instructions'))
                                ) {
                                    triggerUpdate();
                                    return;
                                }
                            }
                        }
                    }

                    // Watch for attribute changes (SVG href changes when item selected)
                    if (mutation.type === 'attributes') {
                        const target = mutation.target;
                        if (target.tagName === 'use' && mutation.attributeName === 'href') {
                            // SVG use element href changed - item was selected
                            triggerUpdate();
                            return;
                        }
                    }
                }
            });

            // Observe the alchemy component for content changes
            this.contentObserver.observe(alchemyComponent, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href'],
            });
        }

        /**
         * Check DOM state and update display accordingly
         * Pattern from enhancement-ui.js
         */
        checkAndUpdateDisplay() {
            // Query current DOM state
            const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
            const instructionsEl = document.querySelector('[class*="SkillActionDetail_instructions"]');
            const infoContainer = document.querySelector('[class*="SkillActionDetail_info"]');

            // Determine if display should be shown
            // Show if: alchemy component exists AND instructions NOT present AND info container exists
            const shouldShow = alchemyComponent && !instructionsEl && infoContainer;

            if (shouldShow && (!this.displayElement || !this.displayElement.parentNode)) {
                // Should show but doesn't exist - create it
                this.handleAlchemyPanelUpdate(alchemyComponent);
            } else if (!shouldShow && this.displayElement?.parentNode) {
                // Shouldn't show but exists - remove it
                this.removeDisplay();
            } else if (shouldShow && this.displayElement?.parentNode) {
                // Should show and exists - check if state changed
                const fingerprint = alchemyProfit.getStateFingerprint();
                if (fingerprint !== this.lastFingerprint) {
                    this.handleAlchemyPanelUpdate(alchemyComponent);
                }
            }
        }

        /**
         * Handle alchemy panel update
         * @param {HTMLElement} alchemyComponent - Alchemy component container
         */
        handleAlchemyPanelUpdate(alchemyComponent) {
            // Get info container
            const infoContainer = alchemyComponent.querySelector('[class*="SkillActionDetail_info"]');
            if (!infoContainer) {
                this.removeDisplay();
                return;
            }

            // Check if state has changed
            const fingerprint = alchemyProfit.getStateFingerprint();
            if (fingerprint === this.lastFingerprint && this.displayElement?.parentNode) {
                return; // No change, display still valid
            }
            this.lastFingerprint = fingerprint;

            // Debounce updates
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
            }

            this.updateTimeout = setTimeout(() => {
                this.updateDisplay(infoContainer);
            }, 100);
            this.timerRegistry.registerTimeout(this.updateTimeout);
        }

        /**
         * Update or create profit display
         * @param {HTMLElement} infoContainer - Info container to append display to
         */
        async updateDisplay(infoContainer) {
            try {
                // Get current action HRID to determine action type
                const actionHrid = alchemyProfit.getCurrentActionHrid();

                let profitData = null;

                // Check alchemy action type by examining the drops and requirements
                const drops = await alchemyProfit.extractDrops(actionHrid);
                const requirements = await alchemyProfit.extractRequirements();

                // Determine action type from actionHrid (most reliable) or DOM tab state
                let isCoinify = false;
                let isTransmute = false;
                let isDecompose = false;

                if (actionHrid) {
                    // Player is actively performing an alchemy action - use actionHrid
                    isCoinify = actionHrid === '/actions/alchemy/coinify';
                    isTransmute = actionHrid === '/actions/alchemy/transmute';
                    isDecompose = actionHrid === '/actions/alchemy/decompose';
                } else {
                    // Not actively performing - check which tab is selected in the DOM
                    // Use [role="tab"] selector which reliably matches MUI tab elements
                    const tabContainer = document.querySelector('[class*="AlchemyPanel_tabsComponentContainer"]');
                    const selectedTab = tabContainer?.querySelector('[role="tab"][aria-selected="true"]');
                    const tabText = selectedTab?.textContent?.trim()?.toLowerCase() || '';

                    if (tabText.includes('coinify')) {
                        isCoinify = true;
                    } else if (tabText.includes('transmute')) {
                        isTransmute = true;
                    } else if (tabText.includes('decompose')) {
                        isDecompose = true;
                    } else {
                        // Final fallback: use drop/item data heuristics
                        isCoinify = drops.length > 0 && drops[0].itemHrid === '/items/coin';
                        if (!isCoinify && requirements && requirements.length > 0) {
                            const reqItemHrid = requirements[0].itemHrid;
                            const reqItemDetails = dataManager.getItemDetails(reqItemHrid);
                            const hasDecompose =
                                Array.isArray(reqItemDetails?.alchemyDetail?.decomposeItems) &&
                                reqItemDetails.alchemyDetail.decomposeItems.length > 0;
                            const hasTransmute = !!reqItemDetails?.alchemyDetail?.transmuteDropTable;
                            // If both exist, default to transmute; if only one, use that one
                            if (hasDecompose && !hasTransmute) {
                                isDecompose = true;
                            } else if (hasTransmute) {
                                isTransmute = true;
                            } else if (hasDecompose) {
                                isDecompose = true;
                            }
                        }
                    }
                }

                if (isCoinify) {
                    // Use unified calculator for coinify
                    if (requirements && requirements.length > 0) {
                        const itemHrid = requirements[0].itemHrid;
                        const enhancementLevel = requirements[0].enhancementLevel || 0;

                        // Call unified calculator
                        profitData = alchemyProfitCalculator.calculateCoinifyProfit(itemHrid, enhancementLevel);
                    }
                } else if (isTransmute) {
                    // Use unified calculator for transmute
                    if (requirements && requirements.length > 0) {
                        const itemHrid = requirements[0].itemHrid;

                        // Call unified calculator
                        profitData = alchemyProfitCalculator.calculateTransmuteProfit(itemHrid);
                    }
                } else if ((isDecompose || (!isCoinify && !isTransmute)) && requirements && requirements.length > 0) {
                    // Use unified calculator for decompose
                    const itemHrid = requirements[0].itemHrid;
                    const enhancementLevel = requirements[0].enhancementLevel || 0;

                    // Call unified calculator
                    profitData = alchemyProfitCalculator.calculateDecomposeProfit(itemHrid, enhancementLevel);
                }

                if (!profitData) {
                    this.removeDisplay();
                    return;
                }

                // Determine action type string for XP calculation
                let actionType = null;
                if (isCoinify) actionType = 'coinify';
                else if (isDecompose) actionType = 'decompose';
                else if (isTransmute) actionType = 'transmute';

                // Get item HRID from requirements
                const itemHrid = requirements && requirements.length > 0 ? requirements[0].itemHrid : null;

                // Save expanded/collapsed state before recreating
                const expandedState = this.saveExpandedState();

                // Always recreate display (complex collapsible structure makes refresh difficult)
                this.createDisplay(infoContainer, profitData, actionType, itemHrid);

                // Restore expanded/collapsed state
                this.restoreExpandedState(expandedState);
            } catch (error) {
                console.error('[AlchemyProfitDisplay] Failed to update display:', error);
                this.removeDisplay();
            }
        }

        /**
         * Save the expanded/collapsed state of all collapsible sections
         * @returns {Map<string, boolean>} Map of section titles to their expanded state
         */
        saveExpandedState() {
            const state = new Map();

            if (!this.displayElement) {
                return state;
            }

            // Find all collapsible sections and save their state
            const sections = this.displayElement.querySelectorAll('.mwi-collapsible-section');
            sections.forEach((section) => {
                const header = section.querySelector('.mwi-section-header');
                const content = section.querySelector('.mwi-section-content');
                const label = header?.querySelector('span:last-child');

                if (label && content) {
                    const title = label.textContent.trim();
                    const isExpanded = content.style.display === 'block';
                    state.set(title, isExpanded);
                }
            });

            return state;
        }

        /**
         * Restore the expanded/collapsed state of collapsible sections
         * @param {Map<string, boolean>} state - Map of section titles to their expanded state
         */
        restoreExpandedState(state) {
            if (!this.displayElement || state.size === 0) {
                return;
            }

            // Find all collapsible sections and restore their state
            const sections = this.displayElement.querySelectorAll('.mwi-collapsible-section');
            sections.forEach((section) => {
                const header = section.querySelector('.mwi-section-header');
                const content = section.querySelector('.mwi-section-content');
                const summary = section.querySelector('div[style*="margin-left: 16px"]');
                const arrow = header?.querySelector('span:first-child');
                const label = header?.querySelector('span:last-child');

                if (label && content && arrow) {
                    const title = label.textContent.trim();
                    const shouldBeExpanded = state.get(title);

                    if (shouldBeExpanded !== undefined && shouldBeExpanded) {
                        // Expand this section
                        content.style.display = 'block';
                        if (summary) {
                            summary.style.display = 'none';
                        }
                        arrow.textContent = '▼';
                    }
                }
            });
        }

        /**
         * Create profit display element with detailed breakdown
         * @param {HTMLElement} container - Container to append to
         * @param {Object} profitData - Profit calculation results from calculateProfit()
         * @param {string} actionType - Alchemy action type ('coinify', 'decompose', or 'transmute')
         * @param {string} itemHrid - Item HRID being processed
         */
        createDisplay(container, profitData, actionType, itemHrid) {
            // Remove any existing display
            this.removeDisplay();

            // Check global hide setting
            if (config.getSetting('actionPanel_hideActionStats')) {
                return;
            }

            // Validate required data
            if (
                !profitData ||
                !profitData.dropRevenues ||
                !profitData.requirementCosts ||
                !profitData.catalystCost ||
                !profitData.consumableCosts
            ) {
                console.error('[AlchemyProfitDisplay] Missing required profit data fields:', profitData);
                return;
            }

            // Extract summary values
            const profit = Math.round(profitData.profitPerHour);
            const profitPerDay = Math.round(profitData.profitPerDay);
            const revenue = Math.round(profitData.revenuePerHour);
            const costs = Math.round(
                profitData.materialCostPerHour + profitData.catalystCostPerHour + profitData.totalTeaCostPerHour
            );
            const summary = `${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`;

            const detailsContent = document.createElement('div');

            // Revenue Section
            const revenueDiv = document.createElement('div');
            revenueDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;">Revenue: ${formatters_js.formatLargeNumber(revenue)}/hr</div>`;

            // Split drops into normal, essence, and rare
            const normalDrops = profitData.dropRevenues.filter((drop) => !drop.isEssence && !drop.isRare);
            const essenceDrops = profitData.dropRevenues.filter((drop) => drop.isEssence);
            const rareDrops = profitData.dropRevenues.filter((drop) => drop.isRare);

            // Normal Drops subsection
            if (normalDrops.length > 0) {
                const normalDropsContent = document.createElement('div');
                let normalDropsRevenue = 0;

                for (const drop of normalDrops) {
                    const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                    const itemName = itemDetails?.name || drop.itemHrid;
                    const decimals = 2; // Always use 2 decimals
                    const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);

                    const dropsDisplay =
                        drop.dropsPerHour >= 10000
                            ? formatters_js.formatLargeNumber(Math.round(drop.dropsPerHour))
                            : drop.dropsPerHour.toFixed(decimals);

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    if (drop.isSelfReturn) {
                        line.style.textDecoration = 'line-through';
                        line.style.opacity = '0.6';
                    }
                    line.textContent = `• ${itemName}: ${dropsDisplay}/hr (${dropRatePct} × ${formatters_js.formatPercentage(profitData.successRate, 1)} success) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                    normalDropsContent.appendChild(line);

                    normalDropsRevenue += drop.revenuePerHour;
                }

                const normalDropsSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Normal Drops: ${formatters_js.formatLargeNumber(Math.round(normalDropsRevenue))}/hr (${normalDrops.length} item${normalDrops.length !== 1 ? 's' : ''})`,
                    null,
                    normalDropsContent,
                    false,
                    1
                );
                revenueDiv.appendChild(normalDropsSection);
            }

            // Essence Drops subsection
            if (essenceDrops.length > 0) {
                const essenceContent = document.createElement('div');
                let essenceRevenue = 0;

                for (const drop of essenceDrops) {
                    const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                    const itemName = itemDetails?.name || drop.itemHrid;
                    const decimals = 2; // Always use 2 decimals
                    const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}, not affected by success rate) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                    essenceContent.appendChild(line);

                    essenceRevenue += drop.revenuePerHour;
                }

                const essenceSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Essence Drops: ${formatters_js.formatLargeNumber(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''})`,
                    null,
                    essenceContent,
                    false,
                    1
                );
                revenueDiv.appendChild(essenceSection);
            }

            // Rare Drops subsection
            if (rareDrops.length > 0) {
                const rareContent = document.createElement('div');
                let rareRevenue = 0;

                for (const drop of rareDrops) {
                    const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                    const itemName = itemDetails?.name || drop.itemHrid;
                    const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                    const baseDropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                    const effectiveDropRatePct = formatters_js.formatPercentage(
                        drop.effectiveDropRate,
                        drop.effectiveDropRate < 0.01 ? 3 : 2
                    );

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';

                    // Show both base and effective drop rate (not affected by success rate)
                    if (profitData.rareFindBreakdown && profitData.rareFindBreakdown.total > 0) {
                        const rareFindBonus = `${profitData.rareFindBreakdown.total.toFixed(2)}%`;
                        line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct} base × ${rareFindBonus} rare find = ${effectiveDropRatePct}, not affected by success rate) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                    } else {
                        line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct}, not affected by success rate) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                    }

                    rareContent.appendChild(line);

                    rareRevenue += drop.revenuePerHour;
                }

                const rareSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Rare Drops: ${formatters_js.formatLargeNumber(Math.round(rareRevenue))}/hr (${rareDrops.length} item${rareDrops.length !== 1 ? 's' : ''})`,
                    null,
                    rareContent,
                    false,
                    1
                );
                revenueDiv.appendChild(rareSection);
            }

            // Costs Section
            const costsDiv = document.createElement('div');
            costsDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-top: 12px; margin-bottom: 4px;">Costs: ${formatters_js.formatLargeNumber(costs)}/hr</div>`;

            // Material Costs subsection (consumed on ALL attempts)
            if (profitData.requirementCosts && profitData.requirementCosts.length > 0) {
                const materialCostsContent = document.createElement('div');
                for (const material of profitData.requirementCosts) {
                    const itemDetails = dataManager.getItemDetails(material.itemHrid);
                    const itemName = itemDetails?.name || material.itemHrid;
                    const amountPerHour = material.count * profitData.actionsPerHour;

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';

                    // Show enhancement level if > 0
                    const enhText = material.enhancementLevel > 0 ? ` +${material.enhancementLevel}` : '';

                    // Format amount per hour
                    const formattedAmount =
                        amountPerHour >= 10000
                            ? formatters_js.formatLargeNumber(amountPerHour)
                            : formatters_js.formatWithSeparator(amountPerHour.toFixed(2));

                    // Show decomposition value if enhanced
                    if (material.enhancementLevel > 0 && material.decompositionValuePerHour > 0) {
                        const netCostPerHour = material.costPerHour - material.decompositionValuePerHour;
                        line.textContent = `• ${itemName}${enhText}: ${formattedAmount}/hr @ ${formatters_js.formatWithSeparator(Math.round(material.price))} → ${formatters_js.formatLargeNumber(Math.round(material.costPerHour))}/hr (recovers ${formatters_js.formatLargeNumber(Math.round(material.decompositionValuePerHour))}/hr, net ${formatters_js.formatLargeNumber(Math.round(netCostPerHour))}/hr)`;
                    } else {
                        line.textContent = `• ${itemName}${enhText}: ${formattedAmount}/hr (consumed on all attempts) @ ${formatters_js.formatWithSeparator(Math.round(material.price))} → ${formatters_js.formatLargeNumber(Math.round(material.costPerHour))}/hr`;
                    }

                    materialCostsContent.appendChild(line);
                }

                const materialCostsSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Material Costs: ${formatters_js.formatLargeNumber(Math.round(profitData.materialCostPerHour))}/hr (${profitData.requirementCosts.length} material${profitData.requirementCosts.length !== 1 ? 's' : ''})`,
                    null,
                    materialCostsContent,
                    false,
                    1
                );
                costsDiv.appendChild(materialCostsSection);
            }

            // Catalyst Cost subsection (consumed only on success)
            if (profitData.catalystCost && profitData.catalystCost.itemHrid) {
                const catalystContent = document.createElement('div');
                const itemDetails = dataManager.getItemDetails(profitData.catalystCost.itemHrid);
                const itemName = itemDetails?.name || profitData.catalystCost.itemHrid;

                // Calculate catalysts per hour (only consumed on success)
                const catalystsPerHour = profitData.actionsPerHour * profitData.successRate;

                // Format catalyst amount
                const formattedCatalystAmount =
                    catalystsPerHour >= 10000
                        ? formatters_js.formatLargeNumber(catalystsPerHour)
                        : formatters_js.formatWithSeparator(catalystsPerHour.toFixed(2));

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${itemName}: ${formattedCatalystAmount}/hr (consumed only on success, ${formatters_js.formatPercentage(profitData.successRate, 2)}) @ ${formatters_js.formatWithSeparator(Math.round(profitData.catalystCost.price))} → ${formatters_js.formatLargeNumber(Math.round(profitData.catalystCost.costPerHour))}/hr`;
                catalystContent.appendChild(line);

                const catalystSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Catalyst Cost: ${formatters_js.formatLargeNumber(Math.round(profitData.catalystCost.costPerHour))}/hr`,
                    null,
                    catalystContent,
                    false,
                    1
                );
                costsDiv.appendChild(catalystSection);
            }

            // Drink Costs subsection
            if (profitData.consumableCosts && profitData.consumableCosts.length > 0) {
                const drinkCostsContent = document.createElement('div');
                for (const drink of profitData.consumableCosts) {
                    const itemDetails = dataManager.getItemDetails(drink.itemHrid);
                    const itemName = itemDetails?.name || drink.itemHrid;

                    // Format drinks per hour
                    const formattedDrinkAmount =
                        drink.drinksPerHour >= 10000
                            ? formatters_js.formatLargeNumber(drink.drinksPerHour)
                            : formatters_js.formatWithSeparator(drink.drinksPerHour.toFixed(2));

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• ${itemName}: ${formattedDrinkAmount}/hr @ ${formatters_js.formatWithSeparator(Math.round(drink.price))} → ${formatters_js.formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
                    drinkCostsContent.appendChild(line);
                }

                const drinkCount = profitData.consumableCosts.length;
                const drinkCostsSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Drink Costs: ${formatters_js.formatLargeNumber(Math.round(profitData.totalTeaCostPerHour))}/hr (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
                    null,
                    drinkCostsContent,
                    false,
                    1
                );
                costsDiv.appendChild(drinkCostsSection);
            }

            // Modifiers Section
            const modifiersDiv = document.createElement('div');
            modifiersDiv.style.cssText = `
            margin-top: 12px;
        `;

            // Main modifiers header
            const modifiersHeader = document.createElement('div');
            modifiersHeader.style.cssText = 'font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;';
            modifiersHeader.textContent = 'Modifiers:';
            modifiersDiv.appendChild(modifiersHeader);

            // Success Rate breakdown
            if (profitData.successRateBreakdown) {
                const successBreakdown = profitData.successRateBreakdown;
                const successContent = document.createElement('div');

                // Base success rate (from player level vs recipe requirement)
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Base Success Rate: ${formatters_js.formatPercentage(successBreakdown.base, 1)}`;
                successContent.appendChild(line);

                // Tea bonus (from Catalytic Tea)
                if (successBreakdown.tea > 0) {
                    const teaLine = document.createElement('div');
                    teaLine.style.marginLeft = '8px';
                    teaLine.textContent = `• Tea Bonus: +${formatters_js.formatPercentage(successBreakdown.tea, 1)} (multiplicative)`;
                    successContent.appendChild(teaLine);
                }

                const successSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Success Rate: ${formatters_js.formatPercentage(profitData.successRate, 1)}`,
                    null,
                    successContent,
                    false,
                    1
                );
                modifiersDiv.appendChild(successSection);
            } else {
                // Fallback if breakdown not available
                const successRateLine = document.createElement('div');
                successRateLine.style.marginLeft = '8px';
                successRateLine.textContent = `• Success Rate: ${formatters_js.formatPercentage(profitData.successRate, 1)}`;
                modifiersDiv.appendChild(successRateLine);
            }

            // Efficiency breakdown
            if (profitData.efficiencyBreakdown) {
                const effBreakdown = profitData.efficiencyBreakdown;
                const effContent = document.createElement('div');

                if (effBreakdown.levelEfficiency > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Level Bonus: +${effBreakdown.levelEfficiency.toFixed(2)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.houseEfficiency > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• House Bonus: +${effBreakdown.houseEfficiency.toFixed(2)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.teaEfficiency > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Tea Bonus: +${effBreakdown.teaEfficiency.toFixed(2)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.equipmentEfficiency > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Equipment Bonus: +${effBreakdown.equipmentEfficiency.toFixed(2)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.communityEfficiency > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Community Buff: +${effBreakdown.communityEfficiency.toFixed(2)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.achievementEfficiency > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Achievement Bonus: +${effBreakdown.achievementEfficiency.toFixed(2)}%`;
                    effContent.appendChild(line);
                }

                const effSection = uiComponents_js.createCollapsibleSection(
                    '',
                    `Efficiency: +${formatters_js.formatPercentage(profitData.efficiency, 1)}`,
                    null,
                    effContent,
                    false,
                    1
                );
                modifiersDiv.appendChild(effSection);
            }

            // Action Speed breakdown
            if (profitData.actionSpeedBreakdown) {
                const speedBreakdown = profitData.actionSpeedBreakdown;
                const baseActionTime = 20; // Alchemy base time is 20 seconds
                const actionSpeed = baseActionTime / profitData.actionTime - 1;

                if (actionSpeed > 0) {
                    const speedContent = document.createElement('div');

                    if (speedBreakdown.equipment > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• Equipment Bonus: +${formatters_js.formatPercentage(speedBreakdown.equipment, 1)}`;
                        speedContent.appendChild(line);
                    }

                    if (speedBreakdown.tea > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• Tea Bonus: +${formatters_js.formatPercentage(speedBreakdown.tea, 1)}`;
                        speedContent.appendChild(line);
                    }

                    const speedSection = uiComponents_js.createCollapsibleSection(
                        '',
                        `Action Speed: +${formatters_js.formatPercentage(actionSpeed, 1)}`,
                        null,
                        speedContent,
                        false,
                        1
                    );
                    modifiersDiv.appendChild(speedSection);
                }
            }

            // Rare Find breakdown
            if (profitData.rareFindBreakdown) {
                const rareBreakdown = profitData.rareFindBreakdown;

                if (rareBreakdown.total > 0) {
                    const rareContent = document.createElement('div');

                    if (rareBreakdown.equipment > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• Equipment Bonus: +${rareBreakdown.equipment.toFixed(2)}%`;
                        rareContent.appendChild(line);
                    }

                    if (rareBreakdown.house > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• House Bonus: +${rareBreakdown.house.toFixed(2)}%`;
                        rareContent.appendChild(line);
                    }

                    if (rareBreakdown.achievement > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• Achievement Bonus: +${rareBreakdown.achievement.toFixed(2)}%`;
                        rareContent.appendChild(line);
                    }

                    const rareSection = uiComponents_js.createCollapsibleSection(
                        '',
                        `Rare Find: +${rareBreakdown.total.toFixed(2)}%`,
                        null,
                        rareContent,
                        false,
                        1
                    );
                    modifiersDiv.appendChild(rareSection);
                }
            }

            // Essence Find breakdown
            if (profitData.essenceFindBreakdown) {
                const essenceBreakdown = profitData.essenceFindBreakdown;

                if (essenceBreakdown.total > 0) {
                    const essenceContent = document.createElement('div');

                    if (essenceBreakdown.equipment > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• Equipment Bonus: +${essenceBreakdown.equipment.toFixed(2)}%`;
                        essenceContent.appendChild(line);
                    }

                    const essenceSection = uiComponents_js.createCollapsibleSection(
                        '',
                        `Essence Find: +${essenceBreakdown.total.toFixed(2)}%`,
                        null,
                        essenceContent,
                        false,
                        1
                    );
                    modifiersDiv.appendChild(essenceSection);
                }
            }

            // Assemble Detailed Breakdown
            detailsContent.appendChild(revenueDiv);
            detailsContent.appendChild(costsDiv);
            detailsContent.appendChild(modifiersDiv);

            // Create "Detailed Breakdown" collapsible
            const topLevelContent = document.createElement('div');
            topLevelContent.innerHTML = `
            <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(2)}/hr | Success Rate: ${formatters_js.formatPercentage(profitData.successRate, 2)}</div>
        `;

            // Add Net Profit line at top level (always visible when Profitability is expanded)
            const profitColor = profit >= 0 ? '#4ade80' : config.getSetting('color_loss') || '#f87171';
            const netProfitLine = document.createElement('div');
            netProfitLine.style.cssText = `
            font-weight: 500;
            color: ${profitColor};
            margin-bottom: 8px;
        `;
            netProfitLine.textContent = `Net Profit: ${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`;
            topLevelContent.appendChild(netProfitLine);

            // Add pricing mode label
            const pricingMode = profitData.pricingMode || 'hybrid';
            const modeLabel =
                {
                    conservative: 'Conservative',
                    hybrid: 'Hybrid',
                    optimistic: 'Optimistic',
                }[pricingMode] || 'Hybrid';

            const modeDiv = document.createElement('div');
            modeDiv.style.cssText = `
            margin-bottom: 8px;
            color: #888;
            font-size: 0.85em;
        `;
            modeDiv.textContent = `Pricing Mode: ${modeLabel}`;
            topLevelContent.appendChild(modeDiv);

            const detailedBreakdownSection = uiComponents_js.createCollapsibleSection(
                '📊',
                'Detailed Breakdown',
                null,
                detailsContent,
                false,
                0
            );

            topLevelContent.appendChild(detailedBreakdownSection);

            // Create main profit section
            const profitSection = uiComponents_js.createCollapsibleSection('💰', 'Profitability', summary, topLevelContent, false, 0);
            profitSection.id = 'mwi-alchemy-profit';
            profitSection.classList.add('mwi-alchemy-profit');
            profitSection.setAttribute('data-mwi-profit-display', 'true');

            // Append to container
            container.appendChild(profitSection);

            // Find the Repeat input field for dynamic updates
            const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
            const inputContainer = alchemyComponent?.querySelector('[class*="maxActionCountInput"]');
            const inputField = inputContainer?.querySelector('input');

            // Cache the input field if available (it gets removed when action starts)
            if (inputField) {
                this.cachedInputField = inputField;
            }

            // Use cached input field if current one is not available
            const effectiveInputField = inputField || this.cachedInputField;

            // Create Action Speed & Time section (after profitability)
            if (effectiveInputField && profitData.actionTime && profitData.efficiencyBreakdown) {
                const speedTimeSection = this.createActionSpeedTimeSection(profitData, effectiveInputField);
                if (speedTimeSection) {
                    speedTimeSection.id = 'mwi-alchemy-speed-time';
                    speedTimeSection.classList.add('mwi-alchemy-speed-time');
                    speedTimeSection.setAttribute('data-mwi-profit-display', 'true');
                    container.appendChild(speedTimeSection);
                }
            }

            // Create Level Progress section (after action speed)
            if (actionType && itemHrid) {
                const levelProgressSection = this.createLevelProgressSection(actionType, itemHrid, profitData);
                if (levelProgressSection) {
                    levelProgressSection.id = 'mwi-alchemy-level-progress';
                    levelProgressSection.classList.add('mwi-alchemy-level-progress');
                    levelProgressSection.setAttribute('data-mwi-profit-display', 'true');
                    container.appendChild(levelProgressSection);
                }
            }

            this.displayElement = profitSection;
        }

        /**
         * Calculate alchemy base XP based on action type and item level
         * @param {string} actionType - 'coinify', 'decompose', or 'transmute'
         * @param {number} itemLevel - Item level from itemDetailMap
         * @returns {number} Base XP before wisdom multiplier
         */
        getAlchemyBaseXP(actionType, itemLevel) {
            switch (actionType) {
                case 'coinify':
                    return itemLevel + 10;
                case 'decompose':
                    return itemLevel * 1.4 + 14;
                case 'transmute':
                    return itemLevel * 1.6 + 16;
                default:
                    return 0;
            }
        }

        /**
         * Calculate expected XP per action accounting for success rate and wisdom
         * @param {string} actionType - Alchemy action type
         * @param {string} itemHrid - Item HRID
         * @param {number} successRate - Success rate (0-1)
         * @returns {number} Expected XP per action
         */
        calculateAlchemyXPPerAction(actionType, itemHrid, successRate) {
            const gameData = dataManager.getInitClientData();
            if (!gameData || !itemHrid) return 0;

            const itemDetails = gameData.itemDetailMap?.[itemHrid];
            if (!itemDetails || !itemDetails.itemLevel) return 0;

            const baseXP = this.getAlchemyBaseXP(actionType, itemDetails.itemLevel);
            if (baseXP === 0) return 0;

            // Calculate wisdom multiplier
            const xpData = experienceParser_js.calculateExperienceMultiplier('/skills/alchemy', '/action_types/alchemy');
            const wisdomMultiplier = xpData.totalMultiplier;

            // Calculate expected XP with success/failure rates
            const successXP = baseXP * wisdomMultiplier;
            const failureXP = successXP * 0.1; // Failed actions give 10% XP

            // Expected value = (success rate × full XP) + (failure rate × 10% XP)
            return successRate * successXP + (1 - successRate) * failureXP;
        }

        /**
         * Create Action Speed & Time section
         * @param {Object} profitData - Profit data with action time and efficiency
         * @param {HTMLInputElement} inputField - Repeat input field
         * @returns {HTMLElement|null} Action Speed & Time section element
         */
        createActionSpeedTimeSection(profitData, inputField) {
            try {
                const actionTime = profitData.actionTime;
                const actionsPerHourBase = profitHelpers_js.calculateActionsPerHour(actionTime); // Base without efficiency
                const efficiencyMultiplier = 1 + profitData.efficiency; // efficiency is already decimal (0.933 = 93.3%)
                const effectiveActionsPerHour = Math.round(actionsPerHourBase * efficiencyMultiplier);

                const content = document.createElement('div');
                content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

                const lines = [];

                // Base time and speed
                const baseTime = 20;
                lines.push(`Base: ${baseTime.toFixed(2)}s → ${actionTime.toFixed(2)}s`);

                // Always show actions/hr
                lines.push(`${profitHelpers_js.calculateActionsPerHour(actionTime).toFixed(0)}/hr`);

                // Speed breakdown (if any bonuses exist)
                if (profitData.actionSpeedBreakdown && profitData.actionSpeedBreakdown.total > 0) {
                    const speedBonus = profitData.actionSpeedBreakdown.total;
                    lines.push(`Speed: +${formatters_js.formatPercentage(speedBonus, 1)}`);

                    // Show detailed equipment breakdown if available
                    const speedBreakdown = profitData.actionSpeedBreakdown;
                    if (speedBreakdown.equipmentDetails && speedBreakdown.equipmentDetails.length > 0) {
                        for (const item of speedBreakdown.equipmentDetails) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            lines.push(`  - ${item.name}${enhText}: +${formatters_js.formatPercentage(item.speedBonus, 1)}`);
                        }
                    } else if (speedBreakdown.equipment > 0) {
                        // Fallback to total if details not available
                        lines.push(`  - Equipment: +${formatters_js.formatPercentage(speedBreakdown.equipment, 1)}`);
                    }

                    // Show tea speed if available
                    if (speedBreakdown.teaDetails && speedBreakdown.teaDetails.length > 0) {
                        for (const tea of speedBreakdown.teaDetails) {
                            lines.push(`  - ${tea.name}: +${formatters_js.formatPercentage(tea.speedBonus, 1)}`);
                        }
                    } else if (speedBreakdown.tea > 0) {
                        // Fallback to total if details not available
                        lines.push(`  - Tea: +${formatters_js.formatPercentage(speedBreakdown.tea, 1)}`);
                    }
                }

                // Efficiency breakdown
                lines.push('');
                lines.push(
                    `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Efficiency: +${(profitData.efficiency * 100).toFixed(2)}% → Output: ×${efficiencyMultiplier.toFixed(2)} (${effectiveActionsPerHour}/hr)</span>`
                );

                const effBreakdown = profitData.efficiencyBreakdown;
                if (effBreakdown.levelEfficiency > 0) {
                    lines.push(`  - Level: +${effBreakdown.levelEfficiency.toFixed(2)}%`);
                }
                if (effBreakdown.houseEfficiency > 0) {
                    lines.push(`  - House: +${effBreakdown.houseEfficiency.toFixed(2)}%`);
                }
                if (effBreakdown.equipmentEfficiency > 0) {
                    lines.push(`  - Equipment: +${effBreakdown.equipmentEfficiency.toFixed(2)}%`);
                }
                if (effBreakdown.teaEfficiency > 0) {
                    lines.push(`  - Tea: +${effBreakdown.teaEfficiency.toFixed(2)}%`);
                }
                if (effBreakdown.achievementEfficiency > 0) {
                    lines.push(`  - Achievement: +${effBreakdown.achievementEfficiency.toFixed(2)}%`);
                }
                if (effBreakdown.communityEfficiency > 0) {
                    lines.push(`  - Community: +${effBreakdown.communityEfficiency.toFixed(2)}%`);
                }

                // Total time (dynamic)
                const totalTimeLine = document.createElement('div');
                totalTimeLine.style.cssText = `
                color: var(--text-color-main, ${config.COLOR_INFO});
                font-weight: 500;
                margin-top: 4px;
            `;

                const updateTotalTime = () => {
                    const inputValue = inputField.value;

                    if (inputValue === '∞') {
                        totalTimeLine.textContent = 'Total time: ∞';
                        return;
                    }

                    const repeatCount = parseInt(inputValue) || 0;
                    if (repeatCount > 0) {
                        const baseActionsNeeded = Math.ceil(repeatCount / efficiencyMultiplier);
                        const totalSeconds = baseActionsNeeded * actionTime;
                        totalTimeLine.textContent = `Total time: ${formatters_js.timeReadable(totalSeconds)}`;
                    } else {
                        totalTimeLine.textContent = 'Total time: 0s';
                    }
                };

                lines.push('');
                content.innerHTML = lines.join('<br>');
                content.appendChild(totalTimeLine);

                // Initial update
                updateTotalTime();

                // Watch for input changes
                const updateOnInput = () => updateTotalTime();
                const updateOnChange = () => updateTotalTime();
                inputField.addEventListener('input', updateOnInput);
                inputField.addEventListener('change', updateOnChange);

                // Create summary for collapsed view (dynamic based on input)
                const getSummary = () => {
                    const inputValue = inputField.value;
                    if (inputValue === '∞') {
                        return `${effectiveActionsPerHour}/hr | Total time: ∞`;
                    }
                    const repeatCount = parseInt(inputValue) || 0;
                    if (repeatCount > 0) {
                        const baseActionsNeeded = Math.ceil(repeatCount / efficiencyMultiplier);
                        const totalSeconds = baseActionsNeeded * actionTime;
                        return `${effectiveActionsPerHour}/hr | Total time: ${formatters_js.timeReadable(totalSeconds)}`;
                    }
                    return `${effectiveActionsPerHour}/hr | Total time: 0s`;
                };

                const summary = getSummary();

                return uiComponents_js.createCollapsibleSection('⏱', 'Action Speed & Time', summary, content, false);
            } catch (error) {
                console.error('[AlchemyProfitDisplay] Error creating action speed/time section:', error);
                return null;
            }
        }

        /**
         * Create Level Progress section
         * @param {string} actionType - Alchemy action type
         * @param {string} itemHrid - Item HRID being processed
         * @param {Object} profitData - Profit data
         * @returns {HTMLElement|null} Level Progress section element
         */
        createLevelProgressSection(actionType, itemHrid, profitData) {
            try {
                const gameData = dataManager.getInitClientData();
                if (!gameData) return null;

                const skills = dataManager.getSkills();
                if (!skills) return null;

                const alchemySkill = skills.find((s) => s.skillHrid === '/skills/alchemy');
                if (!alchemySkill) return null;

                const levelExperienceTable = gameData.levelExperienceTable;
                if (!levelExperienceTable) return null;

                const currentLevel = alchemySkill.level;
                const currentXP = alchemySkill.experience || 0;
                const nextLevel = currentLevel + 1;
                const xpForNextLevel = levelExperienceTable[nextLevel];

                if (!xpForNextLevel) {
                    // Max level reached
                    return null;
                }

                // Calculate XP per action
                const xpPerAction = this.calculateAlchemyXPPerAction(actionType, itemHrid, profitData.successRate);
                if (xpPerAction === 0) return null;

                // Calculate progress
                const xpForCurrentLevel = levelExperienceTable[currentLevel] || 0;
                const xpGainedThisLevel = currentXP - xpForCurrentLevel;
                const xpNeededThisLevel = xpForNextLevel - xpForCurrentLevel;
                const progressPercent = (xpGainedThisLevel / xpNeededThisLevel) * 100;
                const xpNeeded = xpForNextLevel - currentXP;

                // Calculate actions and time needed
                const actionsNeeded = Math.ceil(xpNeeded / xpPerAction);
                const actionTime = profitData.actionTime;
                const efficiencyMultiplier = 1 + profitData.efficiency; // efficiency is already decimal
                const baseActionsNeeded = Math.ceil(actionsNeeded / efficiencyMultiplier);
                const timeNeeded = baseActionsNeeded * actionTime;

                // Calculate rates
                const actionsPerHourBase = profitHelpers_js.calculateActionsPerHour(actionTime);
                const xpPerHour = actionsPerHourBase * efficiencyMultiplier * xpPerAction;
                const xpPerDay = xpPerHour * 24;

                const content = document.createElement('div');
                content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

                const lines = [];

                // Current level and progress
                lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(2)}% to Level ${nextLevel}`);
                lines.push('');

                // Calculate XP breakdown
                const itemDetails = gameData.itemDetailMap?.[itemHrid];
                const itemLevel = itemDetails?.itemLevel || 0;
                const baseXP = this.getAlchemyBaseXP(actionType, itemLevel);
                const xpData = experienceParser_js.calculateExperienceMultiplier('/skills/alchemy', '/action_types/alchemy');
                const wisdomMultiplier = xpData.totalMultiplier;

                // Show base → modified XP with multiplier
                const modifiedXPSuccess = baseXP * wisdomMultiplier;
                lines.push(
                    `XP per action: ${formatters_js.formatWithSeparator(baseXP.toFixed(2))} base → ${formatters_js.formatWithSeparator(modifiedXPSuccess.toFixed(2))} (×${wisdomMultiplier.toFixed(3)})`
                );

                // Show success rate impact on XP
                if (profitData.successRate < 1) {
                    lines.push(
                        `  Expected XP: ${formatters_js.formatWithSeparator(xpPerAction.toFixed(2))} (${formatters_js.formatPercentage(profitData.successRate, 2)} success, 10% XP on fail)`
                    );
                }

                // XP breakdown (if any bonuses exist)
                if (xpData.totalWisdom > 0 || xpData.charmExperience > 0) {
                    const totalXPBonus = xpData.totalWisdom + xpData.charmExperience;
                    lines.push(`  Total XP Bonus: +${totalXPBonus.toFixed(2)}%`);

                    // Equipment skill-specific XP (e.g., alchemy-specific equipment)
                    if (xpData.charmBreakdown && xpData.charmBreakdown.length > 0) {
                        for (const item of xpData.charmBreakdown) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(2)}%`);
                        }
                    }

                    // Equipment wisdom (e.g., Necklace Of Wisdom, Philosopher's Necklace)
                    if (xpData.wisdomBreakdown && xpData.wisdomBreakdown.length > 0) {
                        for (const item of xpData.wisdomBreakdown) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(2)}%`);
                        }
                    }

                    // House rooms
                    if (xpData.breakdown.houseWisdom > 0) {
                        lines.push(`    • House Rooms: +${xpData.breakdown.houseWisdom.toFixed(2)}%`);
                    }

                    // Community buff
                    if (xpData.breakdown.communityWisdom > 0) {
                        lines.push(`    • Community Buff: +${xpData.breakdown.communityWisdom.toFixed(2)}%`);
                    }

                    // Tea/Coffee
                    if (xpData.breakdown.consumableWisdom > 0) {
                        lines.push(`    • Wisdom Tea: +${xpData.breakdown.consumableWisdom.toFixed(2)}%`);
                    }

                    // Achievement wisdom
                    if (xpData.breakdown.achievementWisdom > 0) {
                        lines.push(`    • Achievement: +${xpData.breakdown.achievementWisdom.toFixed(2)}%`);
                    }

                    // MooPass wisdom
                    if (xpData.breakdown.mooPassWisdom > 0) {
                        lines.push(`    • MooPass: +${xpData.breakdown.mooPassWisdom.toFixed(2)}%`);
                    }
                }

                lines.push('');

                // To next level
                lines.push(
                    `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">To Level ${nextLevel}:</span>`
                );
                lines.push(`  Actions: ${formatters_js.formatWithSeparator(actionsNeeded)}`);
                lines.push(`  Time: ${formatters_js.timeReadable(timeNeeded)}`);

                lines.push('');
                lines.push(
                    `XP/hour: ${formatters_js.formatWithSeparator(Math.round(xpPerHour))} | XP/day: ${formatters_js.formatWithSeparator(Math.round(xpPerDay))}`
                );

                content.innerHTML = lines.join('<br>');

                // Create summary for collapsed view
                const summary = `${formatters_js.timeReadable(timeNeeded)} to Level ${nextLevel}`;

                return uiComponents_js.createCollapsibleSection('📈', 'Level Progress', summary, content, false);
            } catch (error) {
                console.error('[AlchemyProfitDisplay] Error creating level progress section:', error);
                return null;
            }
        }

        /**
         * Remove profit display
         */
        removeDisplay() {
            // Remove profitability section
            if (this.displayElement && this.displayElement.parentNode) {
                this.displayElement.remove();
            }
            this.displayElement = null;

            // Remove Action Speed & Time section
            const speedTimeSection = document.getElementById('mwi-alchemy-speed-time');
            if (speedTimeSection && speedTimeSection.parentNode) {
                speedTimeSection.remove();
            }

            // Remove Level Progress section
            const levelProgressSection = document.getElementById('mwi-alchemy-level-progress');
            if (levelProgressSection && levelProgressSection.parentNode) {
                levelProgressSection.remove();
            }

            // Don't clear lastFingerprint here - we need to track state across recreations
        }

        /**
         * Disable the display
         */
        disable() {
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
                this.updateTimeout = null;
            }

            if (this.equipmentChangeTimeout) {
                clearTimeout(this.equipmentChangeTimeout);
                this.equipmentChangeTimeout = null;
            }

            if (this.equipmentChangeHandler) {
                dataManager.off('items_updated', this.equipmentChangeHandler);
                this.equipmentChangeHandler = null;
            }

            if (this.contentObserver) {
                this.contentObserver.disconnect();
                this.contentObserver = null;
            }

            if (this.tabObserver) {
                this.tabObserver.disconnect();
                this.tabObserver = null;
            }

            this.timerRegistry.clearAll();

            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.removeDisplay();
            this.lastFingerprint = null; // Clear fingerprint on disable
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const alchemyProfitDisplay = new AlchemyProfitDisplay();

    /**
     * Actions Library
     * Production, gathering, and alchemy features
     *
     * Exports to: window.Toolasha.Actions
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Actions = {
        initActionPanelObserver,
        actionTimeDisplay,
        quickInputButtons,
        outputTotals,
        maxProduceable,
        gatheringStats,
        requiredMaterials,
        missingMaterialsButton,
        alchemyProfitDisplay,
        teaRecommendation,
        inventoryCountDisplay: inventoryCountDisplay$1,
    };

    console.log('[Toolasha] Actions library loaded');

})(Toolasha.Core.dataManager, Toolasha.Core.domObserver, Toolasha.Core.config, Toolasha.Utils.enhancementConfig, Toolasha.Utils.enhancementCalculator, Toolasha.Utils.formatters, Toolasha.Core.marketAPI, Toolasha.Utils.domObserverHelpers, Toolasha.Utils.equipmentParser, Toolasha.Utils.teaParser, Toolasha.Utils.bonusRevenueCalculator, Toolasha.Utils.marketData, Toolasha.Utils.profitConstants, Toolasha.Utils.efficiency, Toolasha.Utils.profitHelpers, Toolasha.Utils.houseEfficiency, Toolasha.Utils.uiComponents, Toolasha.Utils.actionPanelHelper, Toolasha.Utils.dom, Toolasha.Utils.timerRegistry, Toolasha.Core.storage, Toolasha.Utils.actionCalculator, Toolasha.Utils.cleanupRegistry, Toolasha.Utils.experienceParser, Toolasha.Utils.reactInput, Toolasha.Utils.experienceCalculator, Toolasha.Utils.materialCalculator, Toolasha.Core.webSocketHook, Toolasha.Utils.tokenValuation, Toolasha.Utils.buffParser);
