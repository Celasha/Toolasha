// ==UserScript==
// @name         Toolasha Actions Library
// @namespace    http://tampermonkey.net/
// @version      0.17.5
// @description  Actions library for Toolasha - Production, gathering, and alchemy features
// @author       Celasha
// @license      CC-BY-NC-SA-4.0
// @run-at       document-start
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        none
// ==/UserScript==

(function (dataManager, domObserver, config, enhancementConfig_js, enhancementCalculator_js, formatters_js, marketAPI, domObserverHelpers_js, equipmentParser_js, teaParser_js, bonusRevenueCalculator_js, marketData_js, profitConstants_js, efficiency_js, profitHelpers_js, houseEfficiency_js, uiComponents_js, actionPanelHelper_js, dom_js, timerRegistry_js, actionCalculator_js, cleanupRegistry_js, experienceParser_js, reactInput_js, experienceCalculator_js, storage, webSocketHook, materialCalculator_js, tokenValuation_js) {
    'use strict';

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
        // speedBonus is already a decimal (e.g., 0.15 for 15%), don't divide by 100
        const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus);

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
            ? teaParser_js.parseGourmetBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Processing Tea: 15% base chance to convert raw → processed (Cotton → Cotton Fabric, etc.)
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        const processingBonus = profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseProcessingBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Gathering Quantity: Increases item drop amounts (min/max)
        // Sources: Gathering Tea (15% base), Community Buff (20% base + 0.5%/level), Achievement Tiers
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        let totalGathering = 0;
        let gatheringTea = 0;
        let communityGathering = 0;
        let achievementGathering = 0;
        if (profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            // Parse Gathering Tea bonus
            gatheringTea = teaParser_js.parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

            // Get Community Buff level for gathering quantity
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
            communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

            // Get Achievement buffs for this action type (Beginner tier: +2% Gathering Quantity)
            achievementGathering = dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/gathering');

            // Stack all bonuses additively
            totalGathering = gatheringTea + communityGathering + achievementGathering;
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
        const achievementEfficiency =
            dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/efficiency') * 100;

        const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: currentLevel,
            teaSkillLevelBonus,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency,
            achievementEfficiency,
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
            hasMissingPrices,
            details: {
                levelEfficiency,
                houseEfficiency,
                teaEfficiency,
                equipmentEfficiency,
                achievementEfficiency,
                gourmetBonus,
                communityBuffQuantity: communityGathering, // Community Buff component (as decimal)
                gatheringTeaBonus: gatheringTea, // Gathering Tea component (as decimal)
                achievementGathering: achievementGathering, // Achievement Tier component (as decimal)
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
            const gourmetBonus = teaParser_js.parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
            const processingBonus = teaParser_js.parseProcessingBonus(activeDrinks, itemDetailMap, drinkConcentration);

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

            // Calculate tea efficiency bonus
            const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetails.type, activeDrinks, itemDetailMap, drinkConcentration);

            const achievementEfficiency =
                dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

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
            });

            const totalEfficiency = efficiencyBreakdown.totalEfficiency;
            const levelEfficiency = efficiencyBreakdown.levelEfficiency;
            const effectiveRequirement = efficiencyBreakdown.effectiveRequirement;

            // Calculate equipment speed bonus
            const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(characterEquipment, actionDetails.type, itemDetailMap);

            // Calculate action time with ONLY speed bonuses
            // Efficiency does NOT reduce time - it gives bonus actions
            // Formula: baseTime / (1 + speedBonus)
            // Example: 60s / (1 + 0.15) = 52.17s
            const actionTime = baseTime / (1 + equipmentSpeedBonus);

            // Build time breakdown for display
            const timeBreakdown = this.calculateTimeBreakdown(baseTime, equipmentSpeedBonus);

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
            const outputPrice = outputPriceMissing ? 0 : rawOutputPrice;

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
                outputPriceMissing ||
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
                teaEfficiency, // Tea buff efficiency
                communityEfficiency, // Community buff efficiency
                achievementEfficiency, // Achievement buff efficiency
                actionLevelBonus, // Action Level bonus from teas (e.g., Artisan Tea)
                artisanBonus, // Artisan material cost reduction
                gourmetBonus, // Gourmet bonus item chance
                processingBonus, // Processing conversion chance
                drinkConcentration, // Drink Concentration stat
                efficiencyMultiplier,
                equipmentSpeedBonus,
                skillLevel,
                baseRequirement, // Base requirement level
                effectiveRequirement, // Requirement after Action Level bonus
                requiredLevel: effectiveRequirement, // For backwards compatibility
                timeBreakdown,
            };
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
    const PRODUCTION_TYPES$3 = [
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
        if (!PRODUCTION_TYPES$3.includes(actionDetail.type)) {
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

    const getRareFindBreakdownParts = (bonusRevenue) => {
        const breakdown = bonusRevenue?.rareFindBreakdown || {};
        const parts = [];

        if (breakdown.equipment > 0) {
            parts.push(`${breakdown.equipment.toFixed(1)}% equip`);
        }
        if (breakdown.house > 0) {
            parts.push(`${breakdown.house.toFixed(1)}% house`);
        }
        if (breakdown.achievement > 0) {
            parts.push(`${breakdown.achievement.toFixed(1)}% achievement`);
        }

        return parts;
    };

    /**
     * Display gathering profit calculation in panel
     * @param {HTMLElement} panel - Action panel element
     * @param {string} actionHrid - Action HRID
     * @param {string} dropTableSelector - CSS selector for drop table element
     */
    async function displayGatheringProfit(panel, actionHrid, dropTableSelector) {
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
        if (profitData.details.achievementEfficiency > 0) {
            effParts.push(`${profitData.details.achievementEfficiency.toFixed(1)}% achievement`);
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

        const gatheringRareFindParts = getRareFindBreakdownParts(profitData.bonusRevenue);
        if (gatheringRareFindParts.length > 0) {
            if (modifierLines.length === 0) {
                modifierLines.push(
                    `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
                );
            }
            modifierLines.push(
                `<div style="margin-left: 8px;">• Rare Find: +${(profitData.bonusRevenue?.rareFindBonus || 0).toFixed(1)}% (${gatheringRareFindParts.join(', ')})</div>`
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
            : `Net Profit: ${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

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
        const marketTax = Math.round(revenue * profitConstants_js.MARKET_TAX);
        const costs = Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour + marketTax);
        const summary = netMissing
            ? '-- ⚠'
            : `${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day | Total profit: 0`;

        const detailsContent = document.createElement('div');

        // Revenue Section
        const revenueDiv = document.createElement('div');
        const revenueLabel = revenueMissing ? '-- ⚠' : `${formatters_js.formatLargeNumber(revenue)}/hr`;
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

        // Primary Outputs subsection
        const primaryOutputContent = document.createElement('div');
        const baseOutputLine = document.createElement('div');
        baseOutputLine.style.marginLeft = '8px';
        const baseOutputMissingNote = getMissingPriceIndicator(profitData.outputPriceMissing);
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
        const costsLabel = costsMissing ? '-- ⚠' : `${formatters_js.formatLargeNumber(costs)}/hr`;
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
        const marketTaxLabel = formatMissingLabel(marketTaxMissing, `${formatters_js.formatLargeNumber(marketTax)}/hr`);
        marketTaxLine.textContent = `• Market Tax: 2% of revenue → ${marketTaxLabel}`;
        marketTaxContent.appendChild(marketTaxLine);

        const marketTaxHeader = formatMissingLabel(marketTaxMissing, `${formatters_js.formatLargeNumber(marketTax)}/hr`);
        const marketTaxSection = uiComponents_js.createCollapsibleSection(
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
        if (profitData.achievementEfficiency > 0) {
            effParts.push(`${profitData.achievementEfficiency.toFixed(1)}% achievement`);
        }

        if (effParts.length > 0) {
            modifierLines.push(
                `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
            );
            modifierLines.push(
                `<div style="margin-left: 8px;">• Efficiency: +${profitData.totalEfficiency.toFixed(1)}% (${effParts.join(', ')})</div>`
            );
        }

        const productionRareFindParts = getRareFindBreakdownParts(profitData.bonusRevenue);
        if (productionRareFindParts.length > 0) {
            if (modifierLines.length === 0) {
                modifierLines.push(
                    `<div style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Modifiers:</div>`
                );
            }
            modifierLines.push(
                `<div style="margin-left: 8px;">• Rare Find: +${(profitData.bonusRevenue?.rareFindBonus || 0).toFixed(1)}% (${productionRareFindParts.join(', ')})</div>`
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
                `<div style="margin-left: 8px;">• Artisan: -${formatters_js.formatPercentage(profitData.artisanBonus, 1)} material requirement</div>`
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
                `<div style="margin-left: 8px;">• Gourmet: +${formatters_js.formatPercentage(profitData.gourmetBonus, 1)} bonus items</div>`
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
            : `Net Profit: ${formatters_js.formatLargeNumber(profit)}/hr, ${formatters_js.formatLargeNumber(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

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
        const bonusMissing = profitData.bonusRevenue?.hasMissingPrices || false;
        const materialMissing = profitData.materialCosts?.some((material) => material.missingPrice) || false;
        const teaMissing = profitData.teaCosts?.some((tea) => tea.missingPrice) || false;
        const revenueMissing = outputMissing || bonusMissing;
        const costsMissing = materialMissing || teaMissing || revenueMissing;
        const marketTaxMissing = revenueMissing;
        const netMissing = profitData.hasMissingPrices;
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
        const revenueLabel = formatMissingLabel(revenueMissing, formatters_js.formatLargeNumber(totalRevenue));
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: ${config.COLOR_TOOLTIP_PROFIT}; margin-bottom: 4px;">Revenue: ${revenueLabel}</div>`;

        // Primary Outputs subsection
        const primaryOutputContent = document.createElement('div');
        const totalBaseItems = totals.totalBaseItems;
        const totalBaseRevenue = totals.totalBaseRevenue;
        const baseOutputLine = document.createElement('div');
        baseOutputLine.style.marginLeft = '8px';
        const baseOutputMissingNote = getMissingPriceIndicator(profitData.outputPriceMissing);
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
        const primaryOutputLabel = formatMissingLabel(outputMissing, formatters_js.formatLargeNumber(Math.round(primaryRevenue)));
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
        const costsLabel = costsMissing ? '-- ⚠' : formatters_js.formatLargeNumber(totalCosts);
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
    const GATHERING_TYPES$1 = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

    /**
     * Action types for production skills (5 skills)
     */
    const PRODUCTION_TYPES$2 = [
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
     * Handle action panel appearance (gathering/crafting/production)
     * @param {HTMLElement} panel - Action panel element
     */
    async function handleActionPanel(panel) {
        if (!panel) return;

        // Filter out combat action panels (they don't have XP gain display)
        const expGainElement = panel.querySelector(SELECTORS.EXP_GAIN);
        if (!expGainElement) return; // Combat panel, skip

        // Get action name
        const actionNameElement = panel.querySelector(SELECTORS.ACTION_NAME);
        if (!actionNameElement) return;

        const actionName = dom_js.getOriginalText(actionNameElement);
        const actionHrid = getActionHridFromName$1(actionName);
        if (!actionHrid) return;

        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];
        if (!actionDetail) return;

        // Check if this is a gathering action
        if (GATHERING_TYPES$1.includes(actionDetail.type)) {
            const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
            if (dropTableElement) {
                await displayGatheringProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
            }
        }

        // Check if this is a production action
        if (PRODUCTION_TYPES$2.includes(actionDetail.type)) {
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

            const enabled = config.getSettingValue('totalActionTime', true);
            if (!enabled) {
                return;
            }

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

            // Check if compact mode is enabled
            const compactMode = config.getSettingValue('actions_compactActionBar', false);

            if (compactMode) {
                // COMPACT MODE: Only modify action name element, NOT parents
                // This prevents breaking the header layout (community buffs, profile, etc.)
                actionNameElement.style.setProperty('max-width', '800px', 'important');
                actionNameElement.style.setProperty('overflow', 'hidden', 'important');
                actionNameElement.style.setProperty('text-overflow', 'clip', 'important');
                actionNameElement.style.setProperty('white-space', 'nowrap', 'important');

                // DO NOT modify parent containers - let game's CSS control header layout
            } else {
                // FULL WIDTH MODE (default): Expand to show all text
                actionNameElement.style.setProperty('overflow', 'visible', 'important');
                actionNameElement.style.setProperty('text-overflow', 'clip', 'important');
                actionNameElement.style.setProperty('white-space', 'nowrap', 'important');
                actionNameElement.style.setProperty('max-width', 'none', 'important');
                actionNameElement.style.setProperty('width', 'auto', 'important');
                actionNameElement.style.setProperty('min-width', 'max-content', 'important');

                // Apply to entire parent chain (up to 5 levels)
                let parent = actionNameElement.parentElement;
                let levels = 0;
                while (parent && levels < 5) {
                    parent.style.setProperty('overflow', 'visible', 'important');
                    parent.style.setProperty('text-overflow', 'clip', 'important');
                    parent.style.setProperty('white-space', 'nowrap', 'important');
                    parent.style.setProperty('max-width', 'none', 'important');
                    parent.style.setProperty('width', 'auto', 'important');
                    parent.style.setProperty('min-width', 'max-content', 'important');
                    parent = parent.parentElement;
                    levels++;
                }
            }

            // Get character data
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

            // Use shared calculator
            const stats = actionCalculator_js.calculateActionStats(actionDetails, {
                skills,
                equipment,
                itemDetailMap,
                actionHrid: action.actionHrid, // Pass action HRID for task detection
                includeCommunityBuff: true,
                includeBreakdown: false,
                floorActionLevel: true,
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
            const actionsPerHourWithEfficiency = baseActionsPerHour * avgActionsPerBaseAction;

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
            const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\([^)]+\))?$/);
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

            // Check if compact mode is enabled
            const compactMode = config.getSettingValue('actions_compactActionBar', false);

            if (compactMode) {
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
                // FULL WIDTH MODE: Show all stats
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
                const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);

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
                        profitHelpers_js.calculateActionsPerHour(actionTime) * efficiencyMultiplier
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
                if (queueContent) {
                    // Non-combat: Insert queueContent first
                    inputContainer.insertAdjacentElement('afterend', queueContent);

                    if (speedSection) {
                        queueContent.insertAdjacentElement('afterend', speedSection);
                        if (levelProgressSection) {
                            speedSection.insertAdjacentElement('afterend', levelProgressSection);
                        }
                    } else if (levelProgressSection) {
                        queueContent.insertAdjacentElement('afterend', levelProgressSection);
                    }
                } else if (levelProgressSection) {
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
     * Action Panel Sort Manager
     *
     * Centralized sorting logic for action panels.
     * Handles both profit-based sorting and pin priority.
     * Used by max-produceable and gathering-stats features.
     */


    class ActionPanelSort {
        constructor() {
            this.panels = new Map(); // actionPanel → {actionHrid, profitPerHour}
            this.pinnedActions = new Set(); // Set of pinned action HRIDs
            this.sortTimeout = null; // Debounce timer
            this.initialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize - load pinned actions from storage
         */
        async initialize() {
            if (this.initialized) return;

            const pinnedData = await storage.getJSON('pinnedActions', 'settings', []);
            this.pinnedActions = new Set(pinnedData);
            this.initialized = true;
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
            const sortByProfitEnabled = config.getSetting('actionPanel_sortByProfit');
            const hasPinnedActions = this.pinnedActions.size > 0;

            // Only sort if either profit sorting is enabled OR there are pinned actions
            if (!sortByProfitEnabled && !hasPinnedActions) {
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
         * Sort action panels by profit/hr (highest first), with pinned actions at top
         */
        sortPanelsByProfit() {
            const sortByProfitEnabled = config.getSetting('actionPanel_sortByProfit');

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
                const profitPerHour = data.profitPerHour ?? null;

                containerMap.get(container).push({
                    panel: actionPanel,
                    profit: profitPerHour,
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

                    // Both pinned - sort by profit if enabled, otherwise by original order
                    if (a.pinned && b.pinned) {
                        if (sortByProfitEnabled) {
                            if (a.profit === null && b.profit === null) return 0;
                            if (a.profit === null) return 1;
                            if (b.profit === null) return -1;
                            return b.profit - a.profit;
                        } else {
                            return a.originalIndex - b.originalIndex;
                        }
                    }

                    // Both unpinned - only sort by profit if setting is enabled
                    if (sortByProfitEnabled) {
                        if (a.profit === null && b.profit === null) return 0;
                        if (a.profit === null) return 1;
                        if (b.profit === null) return -1;
                        return b.profit - a.profit;
                    } else {
                        // Keep original order
                        return a.originalIndex - b.originalIndex;
                    }
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
    }

    const actionPanelSort = new ActionPanelSort();

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
    const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
    const PRODUCTION_TYPES$1 = [
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
            this.actionCompletedDebounceTimer = null; // Debounce timer for action_completed events
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
            this.actionCompletedHandler = () => {
                clearTimeout(this.actionCompletedDebounceTimer);
                this.actionCompletedDebounceTimer = setTimeout(() => {
                    this.updateAllCounts();
                }, this.DEBOUNCE_DELAY);
            };
            this.characterSwitchingHandler = () => {
                this.clearAllReferences();
            };

            // Event-driven updates (no polling needed)
            dataManager.on('items_updated', this.itemsUpdatedHandler);
            dataManager.on('action_completed', this.actionCompletedHandler);
            dataManager.on('character_switching', this.characterSwitchingHandler);
        }

        /**
         * Setup DOM observer to watch for action panels
         */
        setupObserver() {
            // Watch for skill action panels (in skill screen, not detail modal)
            this.unregisterObserver = domObserver.onClass('MaxProduceable', 'SkillAction_skillAction', (actionPanel) => {
                this.injectMaxProduceable(actionPanel);

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
                actionPanel.style.marginBottom = '70px';

                // Create display element
                display = document.createElement('div');
                display.className = 'mwi-max-produceable';
                display.style.cssText = `
                position: absolute;
                bottom: -65px;
                left: 0;
                right: 0;
                font-size: 0.85em;
                padding: 4px 8px;
                text-align: center;
                background: rgba(0, 0, 0, 0.7);
                border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
                z-index: 10;
            `;

                // Append stats display to action panel with absolute positioning
                actionPanel.appendChild(display);
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

            const actionName = nameElement.textContent.trim();

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
            const actionDetails = dataManager.getActionDetails(data.actionHrid);

            if (actionDetails) {
                if (GATHERING_TYPES.includes(actionDetails.type)) {
                    const profitData = await calculateGatheringProfit(data.actionHrid);
                    profitPerHour = profitData?.profitPerHour || null;
                    hasMissingPrices = profitData?.hasMissingPrices || false;
                } else if (PRODUCTION_TYPES$1.includes(actionDetails.type)) {
                    const profitData = await calculateProductionProfit(data.actionHrid);
                    profitPerHour = profitData?.profitPerHour || null;
                    hasMissingPrices = profitData?.hasMissingPrices || false;
                }
            }

            // Store profit value for sorting and update shared sort manager
            const resolvedProfitPerHour = hasMissingPrices ? null : profitPerHour;
            data.profitPerHour = resolvedProfitPerHour;
            actionPanelSort.updateProfit(actionPanel, resolvedProfitPerHour);

            // Check if we should hide actions with negative profit (unless pinned)
            const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
            const isPinned = actionPanelSort.isPinned(data.actionHrid);
            if (hideNegativeProfit && resolvedProfitPerHour !== null && resolvedProfitPerHour < 0 && !isPinned) {
                // Hide the entire action panel (unless it's pinned)
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

            // Build display HTML
            let html = `<span style="color: ${canProduceColor};">Can produce: ${maxCrafts.toLocaleString()}</span>`;

            // Add profit/hr line if available
            if (hasMissingPrices) {
                html += `<br><span style="color: ${config.SCRIPT_COLOR_ALERT};">Profit/hr: -- ⚠</span>`;
            } else if (resolvedProfitPerHour !== null) {
                const profitColor = resolvedProfitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const profitSign = resolvedProfitPerHour >= 0 ? '' : '-';
                html += `<br><span style="color: ${profitColor};">Profit/hr: ${profitSign}${formatters_js.formatKMB(Math.abs(resolvedProfitPerHour))}</span>`;
            }

            // Add exp/hr line if available
            if (expPerHour !== null && expPerHour > 0) {
                html += `<br><span style="color: #fff;">Exp/hr: ${formatters_js.formatKMB(expPerHour)}</span>`;
            }

            data.displayElement.style.display = 'block';
            data.displayElement.innerHTML = html;
        }

        /**
         * Update all counts
         */
        async updateAllCounts() {
            // Pre-load market API ONCE before all profit calculations
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

            // Trigger sort via shared manager
            actionPanelSort.triggerSort();
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
            for (const [_actionPanel, data] of this.actionElements.entries()) {
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
            if (this.actionCompletedHandler) {
                dataManager.off('action_completed', this.actionCompletedHandler);
                this.actionCompletedHandler = null;
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
            this.characterSwitchingHandler = null; // Handler for character switch cleanup
            this.isInitialized = false;
            this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
            this.actionCompletedDebounceTimer = null; // Debounce timer for action_completed events
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
            this.actionCompletedHandler = () => {
                clearTimeout(this.actionCompletedDebounceTimer);
                this.actionCompletedDebounceTimer = setTimeout(() => {
                    this.updateAllStats();
                }, this.DEBOUNCE_DELAY);
            };

            this.characterSwitchingHandler = () => {
                this.clearAllReferences();
            };

            // Event-driven updates (no polling needed)
            dataManager.on('items_updated', this.itemsUpdatedHandler);
            dataManager.on('action_completed', this.actionCompletedHandler);
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
                // Re-register existing display (DOM elements may be reused across navigation)
                this.actionElements.set(actionPanel, {
                    actionHrid: actionHrid,
                    displayElement: existingDisplay,
                });
                // Update with fresh data
                this.updateStats(actionPanel);
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
            bottom: -45px;
            left: 0;
            right: 0;
            font-size: 0.85em;
            padding: 4px 8px;
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
            z-index: 10;
        `;

            // Make sure the action panel has relative positioning and extra bottom margin
            if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
                actionPanel.style.position = 'relative';
            }
            actionPanel.style.marginBottom = '50px';

            // Append directly to action panel with absolute positioning
            actionPanel.appendChild(display);

            // Store reference
            this.actionElements.set(actionPanel, {
                actionHrid: actionHrid,
                displayElement: display,
            });

            // Register with shared sort manager
            actionPanelSort.registerPanel(actionPanel, actionHrid);

            // Initial update
            this.updateStats(actionPanel);

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
         * Update stats display for a single action panel
         * @param {HTMLElement} actionPanel - The action panel element
         */
        async updateStats(actionPanel) {
            const data = this.actionElements.get(actionPanel);

            if (!data) {
                return;
            }

            // Calculate profit/hr
            const profitData = await calculateGatheringProfit(data.actionHrid);
            const profitPerHour = profitData?.profitPerHour || null;

            // Calculate exp/hr using shared utility
            const expData = experienceCalculator_js.calculateExpPerHour(data.actionHrid);
            const expPerHour = expData?.expPerHour || null;

            // Store profit value for sorting and update shared sort manager
            data.profitPerHour = profitPerHour;
            actionPanelSort.updateProfit(actionPanel, profitPerHour);

            // Check if we should hide actions with negative profit (unless pinned)
            const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
            const isPinned = actionPanelSort.isPinned(data.actionHrid);
            if (hideNegativeProfit && profitPerHour !== null && profitPerHour < 0 && !isPinned) {
                // Hide the entire action panel
                actionPanel.style.display = 'none';
                return;
            } else {
                // Show the action panel (in case it was previously hidden)
                actionPanel.style.display = '';
            }

            // Build display HTML
            let html = '';

            // Add profit/hr line if available
            if (profitPerHour !== null) {
                const profitColor = profitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const profitSign = profitPerHour >= 0 ? '' : '-';
                html += `<span style="color: ${profitColor};">Profit/hr: ${profitSign}${formatters_js.formatKMB(Math.abs(profitPerHour))}</span>`;
            }

            // Add exp/hr line if available
            if (expPerHour !== null && expPerHour > 0) {
                if (html) html += '<br>';
                html += `<span style="color: #fff;">Exp/hr: ${formatters_js.formatKMB(expPerHour)}</span>`;
            }

            data.displayElement.style.display = 'block';
            data.displayElement.innerHTML = html;
        }

        /**
         * Update all stats
         */
        async updateAllStats() {
            // Clean up stale references and update valid ones
            const updatePromises = [];
            for (const actionPanel of [...this.actionElements.keys()]) {
                if (document.body.contains(actionPanel)) {
                    updatePromises.push(this.updateStats(actionPanel));
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

            // Trigger sort via shared manager
            actionPanelSort.triggerSort();
        }

        /**
         * Clear all DOM references to prevent memory leaks during character switch
         */
        clearAllReferences() {
            // CRITICAL: Remove injected DOM elements BEFORE clearing Maps
            // This prevents detached SVG elements from accumulating
            // Note: .remove() is safe to call even if element is already detached
            for (const [_actionPanel, data] of this.actionElements.entries()) {
                if (data.displayElement) {
                    data.displayElement.innerHTML = ''; // Clear innerHTML to break event listener references
                    data.displayElement.remove();
                    data.displayElement = null; // Null out reference for GC
                }
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
            this.itemsUpdatedDebounceTimer = null;
            this.actionCompletedDebounceTimer = null;

            if (this.itemsUpdatedHandler) {
                dataManager.off('items_updated', this.itemsUpdatedHandler);
                this.itemsUpdatedHandler = null;
            }
            if (this.actionCompletedHandler) {
                dataManager.off('action_completed', this.actionCompletedHandler);
                this.actionCompletedHandler = null;
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

            // Get artisan bonus for material reduction calculation
            const artisanBonus = this.getArtisanBonus(panel);

            // Get base material requirements from action details (separated into upgrade and regular)
            const { upgradeItemCount, regularMaterials } = this.getBaseMaterialRequirements(panel);

            // Process upgrade item first (if exists)
            if (upgradeItemCount !== null) {
                this.processUpgradeItem(panel, numActions, upgradeItemCount);
            }

            // Find requirements container for regular materials
            const requiresDiv = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
            if (!requiresDiv) {
                return;
            }

            // Get inventory spans and input spans
            const inventorySpans = panel.querySelectorAll('[class*="SkillActionDetail_inventoryCount"]');
            const inputSpans = Array.from(panel.querySelectorAll('[class*="SkillActionDetail_inputCount"]')).filter(
                (span) => !span.textContent.includes('Required')
            );

            // Process each regular material using MWIT-E's approach
            // Iterate through requiresDiv children to find inputCount spans and their target containers
            const children = Array.from(requiresDiv.children);
            let materialIndex = 0;

            children.forEach((child, index) => {
                if (child.className && child.className.includes('inputCount')) {
                    // Found an inputCount span - the next sibling is our target container
                    const targetContainer = requiresDiv.children[index + 1];
                    if (!targetContainer) return;

                    // Get corresponding inventory and input data
                    if (materialIndex >= inventorySpans.length || materialIndex >= inputSpans.length) return;

                    const invText = inventorySpans[materialIndex].textContent.trim();

                    // Parse inventory amount (handle K/M suffixes)
                    const invValue = this.parseAmount(invText);

                    // Get base requirement from action details (now correctly indexed)
                    const materialReq = regularMaterials[materialIndex];
                    if (!materialReq || materialReq.count <= 0) {
                        materialIndex++;
                        return;
                    }

                    // Apply artisan reduction to regular materials
                    // Materials are consumed PER ACTION
                    // Efficiency gives bonus actions for FREE (no material cost)
                    const materialsPerAction = materialReq.count * (1 - artisanBonus);

                    // Calculate total materials needed for queued actions
                    const totalRequired = Math.ceil(materialsPerAction * numActions);
                    const missing = Math.max(0, totalRequired - invValue);

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

                    // Build text
                    let text = `Required: ${formatters_js.numberFormatter(totalRequired)}`;
                    if (missing > 0) {
                        text += ` || Missing: ${formatters_js.numberFormatter(missing)}`;
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
         * Process upgrade item display in "Upgrades From" section
         * @param {HTMLElement} panel - Action panel element
         * @param {number} numActions - Number of actions to perform
         * @param {number} upgradeItemCount - Base count of upgrade item (always 1)
         */
        processUpgradeItem(panel, numActions, upgradeItemCount) {
            try {
                // Find upgrade item selector container
                const upgradeContainer = panel.querySelector('[class*="SkillActionDetail_upgradeItemSelectorInput"]');
                if (!upgradeContainer) {
                    return;
                }

                // Find the inventory count from game UI
                const inventoryElement = upgradeContainer.querySelector('[class*="Item_count"]');
                let invValue = 0;

                if (inventoryElement) {
                    // Found the game's native inventory count display
                    invValue = this.parseAmount(inventoryElement.textContent.trim());
                } else {
                    // Fallback: Get inventory from game data using item name
                    const svg = upgradeContainer.querySelector('svg[role="img"]');
                    if (svg) {
                        const itemName = svg.getAttribute('aria-label');

                        if (itemName) {
                            // Look up inventory from game data
                            const gameData = dataManager.getInitClientData();
                            const inventory = dataManager.getInventory();

                            if (gameData && inventory) {
                                // Find item HRID by name
                                let itemHrid = null;
                                for (const [hrid, details] of Object.entries(gameData.itemDetailMap || {})) {
                                    if (details.name === itemName) {
                                        itemHrid = hrid;
                                        break;
                                    }
                                }

                                if (itemHrid) {
                                    // Get inventory count (default to 0 if not found)
                                    invValue = inventory[itemHrid] || 0;
                                }
                            }
                        }
                    }
                }

                // Calculate requirements (upgrade items always need exactly 1 per action, no artisan)
                const totalRequired = upgradeItemCount * numActions;
                const missing = Math.max(0, totalRequired - invValue);

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

                // Build text
                let text = `Required: ${formatters_js.numberFormatter(totalRequired)}`;
                if (missing > 0) {
                    text += ` || Missing: ${formatters_js.numberFormatter(missing)}`;
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
         * Get base material requirements from action details
         * @param {HTMLElement} panel - Action panel element
         * @returns {Object} Object with upgradeItemCount (number|null) and regularMaterials (Array)
         */
        getBaseMaterialRequirements(panel) {
            try {
                // Get action name from panel
                const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
                if (!actionNameElement) {
                    return { upgradeItemCount: null, regularMaterials: [] };
                }

                const actionName = actionNameElement.textContent.trim();

                // Look up action details
                const gameData = dataManager.getInitClientData();
                if (!gameData || !gameData.actionDetailMap) {
                    return { upgradeItemCount: null, regularMaterials: [] };
                }

                let actionDetails = null;
                for (const [_hrid, details] of Object.entries(gameData.actionDetailMap)) {
                    if (details.name === actionName) {
                        actionDetails = details;
                        break;
                    }
                }

                if (!actionDetails) {
                    return { upgradeItemCount: null, regularMaterials: [] };
                }

                // Separate upgrade item from regular materials
                const upgradeItemCount = actionDetails.upgradeItemHrid ? 1 : null;
                const regularMaterials = [];

                // Add regular input items (affected by Artisan Tea)
                if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                    actionDetails.inputItems.forEach((item) => {
                        regularMaterials.push({
                            count: item.count || 0,
                        });
                    });
                }

                // Return separated data
                return { upgradeItemCount, regularMaterials };
            } catch (error) {
                console.error('[Required Materials] Error getting base requirements:', error);
                return { upgradeItemCount: null, regularMaterials: [] };
            }
        }

        /**
         * Get artisan bonus (material reduction) for the current action
         * @param {HTMLElement} panel - Action panel element
         * @returns {number} Artisan bonus (0-1 decimal, e.g., 0.1129 for 11.29% reduction)
         */
        getArtisanBonus(panel) {
            try {
                // Get action name from panel
                const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
                if (!actionNameElement) {
                    return 0;
                }

                const actionName = actionNameElement.textContent.trim();

                // Look up action details
                const gameData = dataManager.getInitClientData();
                if (!gameData || !gameData.actionDetailMap) {
                    return 0;
                }

                let actionDetails = null;
                for (const [_hrid, details] of Object.entries(gameData.actionDetailMap)) {
                    if (details.name === actionName) {
                        actionDetails = details;
                        break;
                    }
                }

                if (!actionDetails) {
                    return 0;
                }

                // Get character data
                const equipment = dataManager.getEquipment();
                const itemDetailMap = gameData.itemDetailMap || {};

                // Calculate artisan bonus (material reduction from Artisan Tea)
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                return artisanBonus;
            } catch (error) {
                console.error('[Required Materials] Error calculating artisan bonus:', error);
                return 0;
            }
        }

        /**
         * Parse amount from text (handles K/M suffixes and number formatting)
         */
        parseAmount(text) {
            // Remove spaces
            text = text.replace(/\s/g, '');

            // Handle K/M suffixes (case insensitive)
            const lowerText = text.toLowerCase();
            if (lowerText.includes('k')) {
                return parseFloat(lowerText.replace('k', '')) * 1000;
            }
            if (lowerText.includes('m')) {
                return parseFloat(lowerText.replace('m', '')) * 1000000;
            }

            // Remove commas and parse
            return parseFloat(text.replace(/,/g, '')) || 0;
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
     * Missing Materials Marketplace Button
     * Adds button to production panels that opens marketplace with tabs for missing materials
     */


    /**
     * Module-level state
     */
    let cleanupObserver = null;
    let currentMaterialsTabs = [];
    let domObserverUnregister = null;
    let processedPanels = new WeakSet();
    let inventoryUpdateHandler = null;
    let storedActionHrid = null;
    let storedNumActions = 0;
    let buyModalObserverUnregister = null;
    let activeMissingQuantity = null;
    const timerRegistry = timerRegistry_js.createTimerRegistry();

    /**
     * Production action types (where button should appear)
     */
    const PRODUCTION_TYPES = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * Get the game object via React fiber
     * @returns {Object|null} Game component instance or null
     */
    function getGameObject() {
        const gamePageEl = document.querySelector('[class^="GamePage"]');
        if (!gamePageEl) return null;

        const fiberKey = Object.keys(gamePageEl).find((k) => k.startsWith('__reactFiber$'));
        if (!fiberKey) return null;

        return gamePageEl[fiberKey]?.return?.stateNode;
    }

    /**
     * Navigate to marketplace for a specific item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     */
    function goToMarketplace(itemHrid, enhancementLevel = 0) {
        const game = getGameObject();
        if (game?.handleGoToMarketplace) {
            game.handleGoToMarketplace(itemHrid, enhancementLevel);
        }
    }

    /**
     * Initialize missing materials button feature
     */
    function initialize() {
        setupMarketplaceCleanupObserver();
        setupBuyModalObserver();

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

        if (buyModalObserverUnregister) {
            buyModalObserverUnregister();
            buyModalObserverUnregister = null;
        }

        // Remove any existing custom tabs
        removeMissingMaterialTabs();

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
        if (!PRODUCTION_TYPES.includes(actionDetail.type)) {
            return;
        }

        // Check if action has input materials
        if (!actionDetail.inputItems || actionDetail.inputItems.length === 0) {
            return;
        }

        // Get missing materials using shared utility
        const missingMaterials = materialCalculator_js.calculateMaterialRequirements(actionHrid, numActions);
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

        const actionName = actionNameElement.textContent.trim();
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
        const success = await navigateToMarketplace();
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
    async function navigateToMarketplace() {
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
        removeMissingMaterialTabs();

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

        // Add click listeners to regular tabs to clear active quantity
        const regularTabs = tabsContainer.querySelectorAll('button:not([data-mwi-custom-tab])');
        regularTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                activeMissingQuantity = null;
            });
        });

        // Create tab for each missing material
        currentMaterialsTabs = [];
        for (const material of missingMaterials) {
            const tab = createCustomTab(material, referenceTab);
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

        // Recalculate materials with current inventory
        const updatedMaterials = materialCalculator_js.calculateMaterialRequirements(storedActionHrid, storedNumActions);

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
            statusText = `Missing: ${formatters_js.formatWithSeparator(material.missing)}`;
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
     * Create a custom tab for a material
     * @param {Object} material - Material object with itemHrid, itemName, missing, have, isTradeable
     * @param {HTMLElement} referenceTab - Reference tab to clone structure from
     * @returns {HTMLElement} Custom tab element
     */
    function createCustomTab(material, referenceTab) {
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
            statusText = `Missing: ${formatters_js.formatWithSeparator(material.missing)}`;
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

            // Store the missing quantity for auto-fill when buy modal opens
            activeMissingQuantity = material.missing;

            // Navigate to marketplace using game API
            goToMarketplace(material.itemHrid, 0);
        });

        return tab;
    }

    /**
     * Remove all missing material tabs
     */
    function removeMissingMaterialTabs() {
        const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
        customTabs.forEach((tab) => tab.remove());
        currentMaterialsTabs = [];

        // Clean up inventory listener
        if (inventoryUpdateHandler) {
            webSocketHook.off('*', inventoryUpdateHandler);
            inventoryUpdateHandler = null;
        }

        // Clear stored context
        storedActionHrid = null;
        storedNumActions = 0;
        activeMissingQuantity = null;
    }

    /**
     * Setup marketplace cleanup observer
     * Watches for marketplace panel removal and cleans up custom tabs
     */
    function setupMarketplaceCleanupObserver() {
        let debounceTimer = null;

        cleanupObserver = domObserverHelpers_js.createMutationWatcher(
            document.body,
            (_mutations) => {
                // Only check if we have custom tabs
                if (currentMaterialsTabs.length === 0) {
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
                    if (currentMaterialsTabs.length === 0) {
                        return;
                    }

                    // Check if our custom tabs still exist in the DOM
                    const hasCustomTabsInDOM = currentMaterialsTabs.some((tab) => document.body.contains(tab));

                    // If our tabs were removed from DOM, clean up references
                    if (!hasCustomTabsInDOM) {
                        removeMissingMaterialTabs();
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
                        removeMissingMaterialTabs();
                    }
                }, 100);
            },
            {
                childList: true,
                subtree: true,
            }
        );
    }

    /**
     * Setup buy modal observer
     * Watches for buy modals appearing and auto-fills quantity if from missing materials tab
     */
    function setupBuyModalObserver() {
        buyModalObserverUnregister = domObserver.onClass(
            'MissingMaterialsButton-BuyModal',
            'Modal_modalContainer',
            (modal) => {
                handleBuyModal(modal);
            }
        );
    }

    /**
     * Handle buy modal appearance
     * Auto-fills quantity if we have an active missing quantity
     * @param {HTMLElement} modal - Modal container element
     */
    function handleBuyModal(modal) {
        // Check if we have an active missing quantity to fill
        if (!activeMissingQuantity || activeMissingQuantity <= 0) {
            return;
        }

        // Check if this is a "Buy Now" modal
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) {
            return;
        }

        const headerText = header.textContent.trim();
        if (!headerText.includes('Buy Now') && !headerText.includes('立即购买')) {
            return;
        }

        // Find the quantity input - need to be specific to avoid enhancement level input
        const quantityInput = findQuantityInput(modal);
        if (!quantityInput) {
            return;
        }

        // Set the quantity value
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(quantityInput, activeMissingQuantity.toString());

        // Trigger input event to notify React
        const inputEvent = new Event('input', { bubbles: true });
        quantityInput.dispatchEvent(inputEvent);
    }

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
        console.warn('[MissingMats] Could not definitively identify quantity input, using first input');
        return allInputs[0];
    }

    var missingMaterialsButton = {
        initialize,
        cleanup,
    };

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

            // Calculate all containers with 4-iteration convergence for nesting
            this.calculateNestedContainers();

            this.isInitialized = true;

            // Notify listeners that calculator is ready
            dataManager.emit('expected_value_initialized', { timestamp: Date.now() });

            return true;
        }

        /**
         * Calculate all containers with nested convergence
         * Iterates 4 times to resolve nested container values
         */
        calculateNestedContainers() {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return;
            }

            // Get all openable container HRIDs
            const containerHrids = Object.keys(initData.openableLootDropMap);

            // Iterate 4 times for convergence (handles nesting depth)
            for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
                for (const containerHrid of containerHrids) {
                    // Calculate and cache EV for this container (pass cached initData)
                    const ev = this.calculateSingleContainer(containerHrid, initData);
                    if (ev !== null) {
                        this.containerCache.set(containerHrid, ev);
                    }
                }
            }
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
                const dropValue = canBeSold
                    ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                    : avgCount * dropRate * price;
                totalExpectedValue += dropValue;
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
                const dropValue =
                    price !== null
                        ? itemCanBeSold
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
                const container = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
                if (!container || !container._reactProps) {
                    return 300;
                }

                let fiber = container._reactProps;
                for (const key in fiber) {
                    if (key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')) {
                        fiber = fiber[key];
                        break;
                    }
                }

                let current = fiber;
                let depth = 0;

                while (current && depth < 20) {
                    if (current.memoizedProps?.actionBuffs) {
                        const buffs = current.memoizedProps.actionBuffs;

                        for (const buff of buffs) {
                            if (buff.uniqueHrid && buff.uniqueHrid.endsWith('tea')) {
                                const duration = buff.duration || 0;
                                return duration / 1e9; // Convert nanoseconds to seconds
                            }
                        }
                        break;
                    }

                    current = current.return;
                    depth++;
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
         * Calculate profit based on extracted data and pricing mode
         * @param {Object} data - Action data from extractActionData()
         * @returns {Object|null} { profitPerHour, profitPerDay } or null
         */
        calculateProfit(data) {
            try {
                if (!data) return null;

                // Get pricing mode
                const pricingMode = config.getSetting('profitCalc_pricingMode') || 'hybrid';

                // Determine buy/sell price types
                let buyType, sellType;
                if (pricingMode === 'conservative') {
                    buyType = 'ask'; // Instant buy (Ask)
                    sellType = 'bid'; // Instant sell (Bid)
                } else if (pricingMode === 'hybrid') {
                    buyType = 'ask'; // Instant buy (Ask)
                    sellType = 'ask'; // Patient sell (Ask)
                } else {
                    // optimistic
                    buyType = 'bid'; // Patient buy (Bid)
                    sellType = 'ask'; // Patient sell (Ask)
                }

                // Calculate material cost (accounting for failures and decomposition value)
                const materialCost = data.requirements.reduce((sum, req) => {
                    const price = buyType === 'ask' ? req.ask : req.bid;
                    const itemCost = price * (req.count || 1);

                    // Subtract decomposition value for enhanced items
                    const decompValue = this.calculateDecompositionValue(req.itemHrid, req.enhancementLevel || 0, buyType);
                    const netCost = itemCost - decompValue;

                    return sum + netCost;
                }, 0);

                // Calculate cost per attempt (materials consumed on failure, materials + catalyst on success)
                const catalystPrice = buyType === 'ask' ? data.catalyst.ask : data.catalyst.bid;
                const costPerAttempt =
                    materialCost * (1 - data.successRate) + (materialCost + catalystPrice) * data.successRate;

                // Calculate income per attempt
                const incomePerAttempt = data.drops.reduce((sum, drop, index) => {
                    // Special handling for coins (no marketplace price)
                    let price;
                    if (drop.itemHrid === '/items/coin') {
                        price = 1; // Coins are worth 1 coin each
                    } else {
                        price = sellType === 'ask' ? drop.ask : drop.bid;
                    }

                    // Identify drop type
                    const isEssence = index === data.drops.length - 2; // Second-to-last
                    const isRare = index === data.drops.length - 1; // Last

                    // Get base drop rate
                    let effectiveDropRate = drop.dropRate || 1;

                    // Apply Essence Find bonus to essence drops
                    if (isEssence && data.essenceFindBreakdown) {
                        effectiveDropRate = effectiveDropRate * (1 + data.essenceFindBreakdown.total);
                    }

                    // Apply Rare Find bonus to rare drops
                    if (isRare && data.rareFindBreakdown) {
                        effectiveDropRate = effectiveDropRate * (1 + data.rareFindBreakdown.total);
                    }

                    let income;
                    if (isEssence) {
                        // Essence doesn't multiply by success rate
                        income = price * effectiveDropRate * (drop.count || 1);
                    } else {
                        // Normal and rare drops multiply by success rate
                        income = price * effectiveDropRate * (drop.count || 1) * data.successRate;
                    }

                    // Apply market tax (2% fee)
                    if (drop.itemHrid !== '/items/coin') {
                        income = profitHelpers_js.calculatePriceAfterTax(income);
                    }

                    return sum + income;
                }, 0);

                // Calculate net profit per attempt
                const netProfitPerAttempt = incomePerAttempt - costPerAttempt;

                // Calculate profit per second (accounting for efficiency)
                const profitPerSecond = (netProfitPerAttempt * (1 + data.efficiency)) / data.actionTime;

                const gameData = dataManager.getInitClientData();
                const equipment = dataManager.getEquipment();
                const drinkConcentration =
                    gameData && equipment ? teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap) : 0;
                const itemDetailMap = gameData?.itemDetailMap || {};
                const consumableMap = new Map(data.consumables.map((consumable) => [consumable.itemHrid, consumable]));
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: data.consumables.map((consumable) => ({ itemHrid: consumable.itemHrid })),
                    drinkConcentration,
                    itemDetailMap,
                    getItemPrice: (itemHrid) => {
                        const consumable = consumableMap.get(itemHrid);
                        if (!consumable) {
                            return null;
                        }
                        return buyType === 'ask' ? consumable.ask : consumable.bid;
                    },
                });
                const teaCostPerSecond = teaCostData.totalCostPerHour / profitConstants_js.SECONDS_PER_HOUR;

                // Final profit accounting for tea costs
                const finalProfitPerSecond = profitPerSecond - teaCostPerSecond;
                const profitPerHour = finalProfitPerSecond * 3600;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

                // Calculate actions per hour
                const actionsPerHour = profitHelpers_js.calculateActionsPerHour(data.actionTime) * (1 + data.efficiency);

                // Build detailed requirement costs breakdown
                const requirementCosts = data.requirements.map((req) => {
                    const price = buyType === 'ask' ? req.ask : req.bid;
                    const costPerAction = price * (req.count || 1);
                    const costPerHour = costPerAction * actionsPerHour;

                    // Calculate decomposition value
                    const decompositionValue = this.calculateDecompositionValue(
                        req.itemHrid,
                        req.enhancementLevel || 0,
                        buyType
                    );
                    const decompositionValuePerHour = decompositionValue * actionsPerHour;

                    return {
                        itemHrid: req.itemHrid,
                        count: req.count || 1,
                        price: price,
                        costPerAction: costPerAction,
                        costPerHour: costPerHour,
                        enhancementLevel: req.enhancementLevel || 0,
                        decompositionValue: decompositionValue,
                        decompositionValuePerHour: decompositionValuePerHour,
                    };
                });

                // Build detailed drop revenues breakdown
                const dropRevenues = data.drops.map((drop, index) => {
                    // Special handling for coins (no marketplace price)
                    let price;
                    if (drop.itemHrid === '/items/coin') {
                        price = 1; // Coins are worth 1 coin each
                    } else {
                        price = sellType === 'ask' ? drop.ask : drop.bid;
                    }
                    const isEssence = index === data.drops.length - 2;
                    const isRare = index === data.drops.length - 1;

                    // Get base drop rate
                    const baseDropRate = drop.dropRate || 1;
                    let effectiveDropRate = baseDropRate;

                    // Apply Essence Find bonus to essence drops
                    if (isEssence && data.essenceFindBreakdown) {
                        effectiveDropRate = baseDropRate * (1 + data.essenceFindBreakdown.total);
                    }

                    // Apply Rare Find bonus to rare drops
                    if (isRare && data.rareFindBreakdown) {
                        effectiveDropRate = baseDropRate * (1 + data.rareFindBreakdown.total);
                    }

                    let revenuePerAttempt;
                    if (isEssence) {
                        // Essence doesn't multiply by success rate
                        revenuePerAttempt = price * effectiveDropRate * (drop.count || 1);
                    } else {
                        // Normal and rare drops multiply by success rate
                        revenuePerAttempt = price * effectiveDropRate * (drop.count || 1) * data.successRate;
                    }

                    // Apply market tax for non-coin items
                    const revenueAfterTax =
                        drop.itemHrid !== '/items/coin' ? profitHelpers_js.calculatePriceAfterTax(revenuePerAttempt) : revenuePerAttempt;
                    const revenuePerHour = revenueAfterTax * actionsPerHour;

                    return {
                        itemHrid: drop.itemHrid,
                        count: drop.count || 1,
                        dropRate: baseDropRate, // Base drop rate (before Rare Find)
                        effectiveDropRate: effectiveDropRate, // Effective drop rate (after Rare Find)
                        price: price,
                        isEssence: isEssence,
                        isRare: isRare,
                        revenuePerAttempt: revenueAfterTax,
                        revenuePerHour: revenuePerHour,
                        dropsPerHour:
                            effectiveDropRate * (drop.count || 1) * actionsPerHour * (isEssence ? 1 : data.successRate),
                    };
                });

                // Build catalyst cost detail
                const catalystCost = {
                    itemHrid: data.catalyst.itemHrid,
                    price: catalystPrice,
                    costPerSuccess: catalystPrice,
                    costPerAttempt: catalystPrice * data.successRate,
                    costPerHour: catalystPrice * data.successRate * actionsPerHour,
                };

                // Build consumable costs breakdown
                const consumableCosts = teaCostData.costs.map((cost) => ({
                    itemHrid: cost.itemHrid,
                    price: cost.pricePerDrink,
                    drinksPerHour: cost.drinksPerHour,
                    costPerHour: cost.totalCost,
                }));

                // Calculate total costs per hour for summary
                const materialCostPerHour = materialCost * actionsPerHour;
                const catalystCostPerHour = catalystCost.costPerHour;
                const totalTeaCostPerHour = teaCostData.totalCostPerHour;

                // Calculate total revenue per hour
                const revenuePerHour = incomePerAttempt * actionsPerHour;

                return {
                    // Summary totals
                    profitPerHour,
                    profitPerDay,
                    revenuePerHour,

                    // Actions and rates
                    actionsPerHour,

                    // Per-attempt economics
                    materialCost,
                    catalystPrice,
                    costPerAttempt,
                    incomePerAttempt,
                    netProfitPerAttempt,

                    // Per-hour costs
                    materialCostPerHour,
                    catalystCostPerHour,
                    totalTeaCostPerHour,

                    // Detailed breakdowns
                    requirementCosts, // Array of material cost details
                    dropRevenues, // Array of drop revenue details
                    catalystCost, // Single catalyst cost detail
                    consumableCosts, // Array of tea/drink details

                    // Core stats
                    successRate: data.successRate,
                    actionTime: data.actionTime,
                    efficiency: data.efficiency,
                    teaDuration: data.teaDuration,

                    // Modifier breakdowns
                    successRateBreakdown: data.successRateBreakdown,
                    efficiencyBreakdown: data.efficiencyBreakdown,
                    actionSpeedBreakdown: data.actionSpeedBreakdown,
                    rareFindBreakdown: data.rareFindBreakdown,
                    essenceFindBreakdown: data.essenceFindBreakdown,

                    // Pricing info
                    pricingMode,
                    buyType,
                    sellType,
                };
            } catch (error) {
                console.error('[AlchemyProfit] Failed to calculate profit:', error);
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

                // Don't include infoText - it contains our profit display which causes update loops
                return `${successRate}:${consumables}:${catalyst}:${requirements}`;
            } catch {
                return '';
            }
        }
    }

    const alchemyProfit = new AlchemyProfit();

    /**
     * Alchemy Profit Display Module
     * Displays profit calculator in alchemy action detail panel
     */


    class AlchemyProfitDisplay {
        constructor() {
            this.isActive = false;
            this.unregisterObserver = null;
            this.displayElement = null;
            this.updateTimeout = null;
            this.lastFingerprint = null;
            this.pollInterval = null;
            this.isInitialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
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
                (_alchemyComponent) => {
                    this.checkAndUpdateDisplay();
                }
            );

            // Initial check for existing panel
            this.checkAndUpdateDisplay();

            // Polling interval to check DOM state (like enhancement-ui.js does)
            // This catches state changes that the observer might miss
            this.pollInterval = setInterval(() => {
                this.checkAndUpdateDisplay();
            }, 200); // Check 5× per second for responsive updates
            this.timerRegistry.registerInterval(this.pollInterval);
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
                // Extract action data
                const actionData = await alchemyProfit.extractActionData();
                if (!actionData) {
                    this.removeDisplay();
                    return;
                }

                // Calculate profit
                const profitData = alchemyProfit.calculateProfit(actionData);
                if (!profitData) {
                    this.removeDisplay();
                    return;
                }

                // Save expanded/collapsed state before recreating
                const expandedState = this.saveExpandedState();

                // Always recreate display (complex collapsible structure makes refresh difficult)
                this.createDisplay(infoContainer, profitData);

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
         */
        createDisplay(container, profitData) {
            // Remove any existing display
            this.removeDisplay();

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
                    const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                    const dropRatePct = formatters_js.formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct} × ${formatters_js.formatPercentage(profitData.successRate, 1)} success) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
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
                    const decimals = drop.dropsPerHour < 1 ? 2 : 1;
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

                    // Show both base and effective drop rate
                    if (profitData.rareFindBreakdown && profitData.rareFindBreakdown.total > 0) {
                        const rareFindBonus = formatters_js.formatPercentage(profitData.rareFindBreakdown.total, 1);
                        line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct} base × ${rareFindBonus} rare find = ${effectiveDropRatePct}, × ${formatters_js.formatPercentage(profitData.successRate, 1)} success) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                    } else {
                        line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct} × ${formatters_js.formatPercentage(profitData.successRate, 1)} success) @ ${formatters_js.formatWithSeparator(Math.round(drop.price))} → ${formatters_js.formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
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

                    // Show decomposition value if enhanced
                    if (material.enhancementLevel > 0 && material.decompositionValuePerHour > 0) {
                        const netCostPerHour = material.costPerHour - material.decompositionValuePerHour;
                        line.textContent = `• ${itemName}${enhText}: ${amountPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(Math.round(material.price))} → ${formatters_js.formatLargeNumber(Math.round(material.costPerHour))}/hr (recovers ${formatters_js.formatLargeNumber(Math.round(material.decompositionValuePerHour))}/hr, net ${formatters_js.formatLargeNumber(Math.round(netCostPerHour))}/hr)`;
                    } else {
                        line.textContent = `• ${itemName}${enhText}: ${amountPerHour.toFixed(1)}/hr (consumed on all attempts) @ ${formatters_js.formatWithSeparator(Math.round(material.price))} → ${formatters_js.formatLargeNumber(Math.round(material.costPerHour))}/hr`;
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

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${itemName}: ${catalystsPerHour.toFixed(1)}/hr (consumed only on success, ${formatters_js.formatPercentage(profitData.successRate, 1)}) @ ${formatters_js.formatWithSeparator(Math.round(profitData.catalystCost.price))} → ${formatters_js.formatLargeNumber(Math.round(profitData.catalystCost.costPerHour))}/hr`;
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

                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• ${itemName}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatters_js.formatWithSeparator(Math.round(drink.price))} → ${formatters_js.formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
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

                if (effBreakdown.level > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Level Bonus: +${effBreakdown.level.toFixed(1)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.house > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• House Bonus: +${effBreakdown.house.toFixed(1)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.tea > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Tea Bonus: +${effBreakdown.tea.toFixed(1)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.equipment > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Equipment Bonus: +${effBreakdown.equipment.toFixed(1)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.community > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Community Buff: +${effBreakdown.community.toFixed(1)}%`;
                    effContent.appendChild(line);
                }

                if (effBreakdown.achievement > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Achievement Bonus: +${effBreakdown.achievement.toFixed(1)}%`;
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
                        line.textContent = `• Equipment Bonus: +${rareBreakdown.equipment.toFixed(1)}%`;
                        rareContent.appendChild(line);
                    }

                    if (rareBreakdown.achievement > 0) {
                        const line = document.createElement('div');
                        line.style.marginLeft = '8px';
                        line.textContent = `• Achievement Bonus: +${rareBreakdown.achievement.toFixed(1)}%`;
                        rareContent.appendChild(line);
                    }

                    const rareSection = uiComponents_js.createCollapsibleSection(
                        '',
                        `Rare Find: +${formatters_js.formatPercentage(rareBreakdown.total, 1)}`,
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
                        line.textContent = `• Equipment Bonus: +${essenceBreakdown.equipment.toFixed(1)}%`;
                        essenceContent.appendChild(line);
                    }

                    const essenceSection = uiComponents_js.createCollapsibleSection(
                        '',
                        `Essence Find: +${formatters_js.formatPercentage(essenceBreakdown.total, 1)}`,
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
            <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr | Success Rate: ${formatters_js.formatPercentage(profitData.successRate, 1)}</div>
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

            // Append to container
            container.appendChild(profitSection);
            this.displayElement = profitSection;
        }

        /**
         * Remove profit display
         */
        removeDisplay() {
            if (this.displayElement && this.displayElement.parentNode) {
                this.displayElement.remove();
            }
            this.displayElement = null;
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

            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
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
    };

    console.log('[Toolasha] Actions library loaded');

})(Toolasha.Core.dataManager, Toolasha.Core.domObserver, Toolasha.Core.config, Toolasha.Utils.enhancementConfig, Toolasha.Utils.enhancementCalculator, Toolasha.Utils.formatters, Toolasha.Core.marketAPI, Toolasha.Utils.domObserverHelpers, Toolasha.Utils.equipmentParser, Toolasha.Utils.teaParser, Toolasha.Utils.bonusRevenueCalculator, Toolasha.Utils.marketData, Toolasha.Utils.profitConstants, Toolasha.Utils.efficiency, Toolasha.Utils.profitHelpers, Toolasha.Utils.houseEfficiency, Toolasha.Utils.uiComponents, Toolasha.Utils.actionPanelHelper, Toolasha.Utils.dom, Toolasha.Utils.timerRegistry, Toolasha.Utils.actionCalculator, Toolasha.Utils.cleanupRegistry, Toolasha.Utils.experienceParser, Toolasha.Utils.reactInput, Toolasha.Utils.experienceCalculator, Toolasha.Core.storage, Toolasha.Core.webSocketHook, Toolasha.Utils.materialCalculator, Toolasha.Utils.tokenValuation);
