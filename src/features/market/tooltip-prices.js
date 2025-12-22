/**
 * Market Tooltip Prices Feature
 * Adds market prices to item tooltips
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import profitCalculator from './profit-calculator.js';
import expectedValueCalculator from './expected-value-calculator.js';
import { numberFormatter, formatKMB } from '../../utils/formatters.js';
import dom from '../../utils/dom.js';

/**
 * TooltipPrices class handles injecting market prices into item tooltips
 */
class TooltipPrices {
    constructor() {
        this.observer = null;
        this.isActive = false;
    }

    /**
     * Initialize the tooltip prices feature
     */
    async initialize() {
        // Check if feature is enabled
        if (!config.getSetting('itemTooltip_prices')) {
            console.log('[TooltipPrices] Feature disabled');
            return;
        }

        // Wait for market data to load
        if (!marketAPI.isLoaded()) {
            console.log('[TooltipPrices] Waiting for market data...');
            await marketAPI.fetch(true); // Force fresh fetch on init
        }

        // Add CSS to prevent tooltip cutoff
        this.addTooltipStyles();

        // Set up MutationObserver to watch for tooltips
        this.setupObserver();

        console.log('[TooltipPrices] ✅ Initialized');
    }

    /**
     * Add CSS styles to prevent tooltip cutoff
     *
     * CRITICAL: CSS alone is not enough! MUI uses JavaScript to position tooltips
     * with transform3d(), which can place them off-screen. We need both:
     * 1. CSS: Enables scrolling when tooltip is taller than viewport
     * 2. JavaScript: Repositions tooltip when it extends beyond viewport (see fixTooltipOverflow)
     */
    addTooltipStyles() {
        const css = `
            /* Ensure tooltip content is scrollable if too tall */
            .MuiTooltip-tooltip {
                max-height: calc(100vh - 20px) !important;
                overflow-y: auto !important;
            }

            /* Also target the popper container */
            .MuiTooltip-popper {
                max-height: 100vh !important;
            }

            /* Add subtle scrollbar styling */
            .MuiTooltip-tooltip::-webkit-scrollbar {
                width: 6px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 3px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }
        `;

        dom.addStyles(css, 'mwi-tooltip-fixes');
    }

    /**
     * Set up MutationObserver to watch for tooltip elements
     */
    setupObserver() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const added of mutation.addedNodes) {
                    // Check if it's a tooltip element
                    if (added.nodeType === Node.ELEMENT_NODE &&
                        added.classList?.contains('MuiTooltip-popper')) {
                        this.handleTooltip(added);
                    }
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: false
        });

        this.isActive = true;
        console.log('[TooltipPrices] Observer started');
    }

    /**
     * Handle a tooltip element
     * @param {Element} tooltipElement - The tooltip popper element
     */
    async handleTooltip(tooltipElement) {
        // Check if it's an item tooltip (has the specific class)
        const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');

        if (!nameElement) {
            return; // Not an item tooltip
        }

        // Get the item HRID from the tooltip
        const itemHrid = this.extractItemHrid(tooltipElement);

        if (!itemHrid) {
            return;
        }

        // Get item details
        const itemDetails = dataManager.getItemDetails(itemHrid);

        if (!itemDetails) {
            return;
        }

        // Check if this is an openable container first (they have no market price)
        if (itemDetails.isOpenable && config.getSetting('itemTooltip_expectedValue')) {
            const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
            if (evData) {
                this.injectExpectedValueDisplay(tooltipElement, evData);
            }
            return; // Skip price/profit display for containers
        }

        // Get market price (for base item, enhancement level 0)
        const price = marketAPI.getPrice(itemHrid, 0);

        if (!price || (price.ask === 0 && price.bid === 0)) {
            // No market data for this item
            return;
        }

        // Get item amount from tooltip (for stacks)
        const amount = this.extractItemAmount(tooltipElement);

        // Inject price display
        this.injectPriceDisplay(tooltipElement, price, amount);

        // Check if profit calculator is enabled
        if (config.getSetting('itemTooltip_profit')) {
            // Calculate and inject profit information
            const profitData = profitCalculator.calculateProfit(itemHrid);
            if (profitData) {
                this.injectProfitDisplay(tooltipElement, profitData);
            }
        }

        // Fix tooltip overflow (ensure it stays in viewport)
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Extract item HRID from tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @returns {string|null} Item HRID or null
     */
    extractItemHrid(tooltipElement) {
        // Try to find the item HRID from the tooltip's data attributes or content
        // The game uses React, so we need to find the HRID from the displayed name

        const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
        if (!nameElement) {
            return null;
        }

        const itemName = nameElement.textContent.trim();

        // Look up item by name in game data
        const initData = dataManager.getInitClientData();
        if (!initData) {
            return null;
        }

        // Search through all items to find matching name
        for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
            if (item.name === itemName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Extract item amount from tooltip (for stacks)
     * @param {Element} tooltipElement - Tooltip element
     * @returns {number} Item amount (default 1)
     */
    extractItemAmount(tooltipElement) {
        // Look for amount text in tooltip (e.g., "x5", "Amount: 5", "Amount: 4,900")
        const text = tooltipElement.textContent;
        const match = text.match(/x([\d,]+)|Amount:\s*([\d,]+)/i);

        if (match) {
            // Strip commas before parsing
            const amountStr = (match[1] || match[2]).replace(/,/g, '');
            return parseInt(amountStr, 10);
        }

        return 1; // Default to 1 if not found
    }

    /**
     * Inject price display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} price - { ask, bid }
     * @param {number} amount - Item amount
     */
    injectPriceDisplay(tooltipElement, price, amount) {
        // Find the tooltip text container
        const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            console.warn('[TooltipPrices] Could not find tooltip text container');
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-price-injected')) {
            return;
        }

        // Create price display
        const priceDiv = dom.createStyledDiv(
            { color: config.SCRIPT_COLOR_TOOLTIP },
            '',
            'market-price-injected'
        );

        // Show message if no market data at all
        if (price.ask <= 0 && price.bid <= 0) {
            priceDiv.innerHTML = `Price: <span style="color: gray; font-style: italic;">No market data</span>`;
            tooltipText.appendChild(priceDiv);
            return;
        }

        // Format prices, using "-" for missing values
        const askDisplay = price.ask > 0 ? numberFormatter(price.ask) : '-';
        const bidDisplay = price.bid > 0 ? numberFormatter(price.bid) : '-';

        // Calculate totals (only if both prices valid and amount > 1)
        let totalDisplay = '';
        if (amount > 1 && price.ask > 0 && price.bid > 0) {
            const totalAsk = price.ask * amount;
            const totalBid = price.bid * amount;
            totalDisplay = ` (${numberFormatter(totalAsk)} / ${numberFormatter(totalBid)})`;
        }

        // Format: "Price: 1,200 / 950" or "Price: 1,200 / -" or "Price: - / 950"
        priceDiv.innerHTML = `Price: ${askDisplay} / ${bidDisplay}${totalDisplay}`;

        // Insert at the end of the tooltip
        tooltipText.appendChild(priceDiv);
    }

    /**
     * Inject profit display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} profitData - Profit calculation data
     */
    injectProfitDisplay(tooltipElement, profitData) {
        // Find the tooltip text container
        const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-profit-injected')) {
            return;
        }

        // Create profit display container
        const profitDiv = dom.createStyledDiv(
            { color: config.SCRIPT_COLOR_TOOLTIP, marginTop: '8px' },
            '',
            'market-profit-injected'
        );

        // Build profit display with two-column layout
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        // Two-column flex container
        html += '<div style="display: flex; gap: 16px; margin-bottom: 8px;">';

        // ===== LEFT COLUMN: COSTS =====
        html += '<div style="flex: 1; min-width: 0;">';

        // Material costs section
        if (profitData.materialCosts.length > 0) {
            html += '<div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 4px;">';
            html += '<span>COSTS</span>';

            // Show total cost at top right (if all materials have prices)
            const hasAnyValidPrices = profitData.materialCosts.some(mat => mat.askPrice > 0);
            if (hasAnyValidPrices && profitData.materialCosts.every(mat => mat.askPrice > 0)) {
                const totalCost = profitData.totalMaterialCost + (profitData.totalTeaCostPerHour || 0);
                html += `<span>${numberFormatter(totalCost)}/hr</span>`;
            }
            html += '</div>';

            // Show artisan reduction if active
            if (profitData.artisanBonus > 0) {
                let artisanDisplay = `Artisan: -${(profitData.artisanBonus * 100).toFixed(1)}%`;
                if (profitData.drinkConcentration > 0) {
                    const dcContribution = profitData.artisanBonus * (profitData.drinkConcentration / (1 + profitData.drinkConcentration));
                    artisanDisplay += ` (-${(dcContribution * 100).toFixed(1)}% DC)`;
                }
                html += `<div style="font-size: 0.9em; margin-bottom: 4px;">${artisanDisplay}</div>`;
            }

            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            if (hasAnyValidPrices) {
                for (const material of profitData.materialCosts) {
                    const amountDisplay = numberFormatter(material.amount);
                    const priceDisplay = material.askPrice > 0 ? numberFormatter(material.askPrice) : '-';
                    const totalDisplay = material.askPrice > 0 ? numberFormatter(material.totalCost) : '-';
                    html += `<div>• ${material.itemName} ×${amountDisplay} @ ${priceDisplay} → ${totalDisplay}</div>`;
                }
            } else {
                html += `<div style="color: gray; font-style: italic;">Material prices unavailable</div>`;
            }

            html += '</div>';
        }

        // Tea costs section (if any teas active)
        if (profitData.teaCosts && profitData.teaCosts.length > 0 && profitData.totalTeaCostPerHour > 0) {
            html += '<div style="font-size: 0.9em; margin-top: 8px;">';
            html += `<div style="font-weight: bold;">Teas: ${numberFormatter(profitData.totalTeaCostPerHour)}/hr</div>`;
            html += '<div style="margin-left: 8px;">';
            for (const tea of profitData.teaCosts) {
                if (tea.totalCost > 0) {
                    html += `<div>• ${tea.itemName} ×${tea.drinksPerHour}/hr @ ${numberFormatter(tea.pricePerDrink)}</div>`;
                }
            }
            html += '</div>';
            html += '</div>';
        }

        html += '</div>'; // Close left column

        // ===== RIGHT COLUMN: REVENUE & PROFIT =====
        html += '<div style="flex: 1; min-width: 0;">';

        // Profit Analysis section
        html += '<div style="font-weight: bold; margin-bottom: 4px;">PROFIT</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Check if we can calculate profit (need BOTH valid ask and bid prices)
        if (profitData.itemPrice.bid > 0 && profitData.itemPrice.ask > 0) {
            // Net profit line
            const profitPerDay = profitData.profitPerHour * 24;
            let profitText = `${numberFormatter(profitData.profitPerHour)}/hr`;
            if (profitData.profitPerItem >= 0) {
                profitText += ` (${formatKMB(profitPerDay)}/day)`;
            }
            html += `<div style="font-weight: bold;">${profitText}</div>`;

            // Sell vs Cost line
            html += `<div>Sell: ${numberFormatter(profitData.priceAfterTax)} | Cost: ${numberFormatter(profitData.costPerItem)}</div>`;
        } else {
            html += `<div style="color: gray; font-style: italic;">Incomplete market data</div>`;
        }

        html += '</div>'; // Close profit analysis indented section

        // Bonus Revenue section (essences and rare finds)
        if (profitData.bonusRevenue && profitData.bonusRevenue.bonusDrops.length > 0) {
            html += '<div style="margin-top: 8px;">';
            html += '<div style="font-weight: bold; margin-bottom: 4px;">BONUS</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            // Show Essence Find and Rare Find bonuses if > 0
            if (profitData.bonusRevenue.essenceFindBonus > 0 || profitData.bonusRevenue.rareFindBonus > 0) {
                const bonusParts = [];
                if (profitData.bonusRevenue.essenceFindBonus > 0) {
                    bonusParts.push(`EF: +${profitData.bonusRevenue.essenceFindBonus.toFixed(1)}%`);
                }
                if (profitData.bonusRevenue.rareFindBonus > 0) {
                    bonusParts.push(`RF: +${profitData.bonusRevenue.rareFindBonus.toFixed(1)}%`);
                }
                html += `<div style="font-size: 0.85em; color: #aaa; margin-bottom: 4px;">${bonusParts.join(' | ')}</div>`;
            }

            // Show each bonus drop (condensed)
            for (const drop of profitData.bonusRevenue.bonusDrops) {
                const dropRatePercent = (drop.dropRate * 100).toFixed(drop.dropRate < 0.001 ? 4 : 2);
                html += `<div>• ${drop.itemName}: ${numberFormatter(drop.revenuePerHour)}/hr (${dropRatePercent}%)</div>`;
            }

            // Show total bonus revenue
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 4px 0;"></div>';
            html += `<div style="font-weight: bold;">+${numberFormatter(profitData.bonusRevenue.totalBonusRevenue)}/hr</div>`;

            // Show adjusted profit (if we have profit data)
            if (profitData.itemPrice.bid > 0 && profitData.itemPrice.ask > 0) {
                const adjustedProfit = profitData.profitPerHour + profitData.bonusRevenue.totalBonusRevenue;
                const adjustedProfitColor = adjustedProfit >= 0 ? 'lime' : 'red';
                html += `<div style="color: ${adjustedProfitColor}; margin-top: 4px; font-weight: bold;">Total: ${numberFormatter(adjustedProfit)}/hr (${formatKMB(adjustedProfit * 24)}/day)</div>`;
            }

            html += '</div>'; // Close bonus revenue indented section
            html += '</div>';
        }

        html += '</div>'; // Close right column

        html += '</div>'; // Close two-column flex container

        // ===== FULL-WIDTH BOTTOM SECTION: STATS & BONUSES =====
        html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px; font-size: 0.9em;">';

        // Time breakdown section (always show)
        const breakdown = profitData.timeBreakdown;
        html += `<div>Time: ${breakdown.finalTime.toFixed(2)}s (${numberFormatter(breakdown.actionsPerHour)}/hr)`;
        if (breakdown.steps.length > 0) {
            const speedBonus = breakdown.steps.reduce((sum, step) => sum + step.bonus, 0);
            html += ` | Speed: +${speedBonus.toFixed(1)}%`;
        }
        html += '</div>';

        // Efficiency section (if > 0)
        if (profitData.efficiencyBonus > 0) {
            html += `<div>Efficiency: +${profitData.efficiencyBonus.toFixed(1)}% → ×${profitData.efficiencyMultiplier.toFixed(2)} (${numberFormatter(profitData.itemsPerHour)}/hr)`;

            // Show main efficiency sources inline
            const effParts = [];
            if (profitData.levelEfficiency > 0) effParts.push(`Lvl: +${profitData.levelEfficiency.toFixed(1)}%`);
            if (profitData.houseEfficiency > 0) effParts.push(`House: +${profitData.houseEfficiency.toFixed(1)}%`);
            if (profitData.equipmentEfficiency > 0) effParts.push(`Equip: +${profitData.equipmentEfficiency.toFixed(1)}%`);
            if (profitData.teaEfficiency > 0) effParts.push(`Tea: +${profitData.teaEfficiency.toFixed(1)}%`);
            if (effParts.length > 0) {
                html += ` | ${effParts.join(', ')}`;
            }
            html += '</div>';
        }

        // Gourmet bonus (if > 0)
        if (profitData.gourmetBonus > 0) {
            html += `<div>Gourmet: +${(profitData.gourmetBonus * 100).toFixed(1)}% → +${numberFormatter(profitData.gourmetBonusItems)}/hr (${numberFormatter(profitData.totalItemsPerHour)}/hr total)</div>`;
        }

        // Processing bonus (if > 0)
        if (profitData.processingBonus > 0) {
            html += `<div>Processing: ${(profitData.processingBonus * 100).toFixed(1)}% conversion chance</div>`;
        }

        html += '</div>'; // Close stats section

        html += '</div>'; // Close main container

        profitDiv.innerHTML = html;

        // Insert at the end of the tooltip
        tooltipText.appendChild(profitDiv);
    }

    /**
     * Inject expected value display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} evData - Expected value calculation data
     */
    injectExpectedValueDisplay(tooltipElement, evData) {
        // Find the tooltip text container
        const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-ev-injected')) {
            return;
        }

        // Create EV display container
        const evDiv = dom.createStyledDiv(
            { color: config.SCRIPT_COLOR_TOOLTIP, marginTop: '8px' },
            '',
            'market-ev-injected'
        );

        // Build EV display
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        // Header
        html += '<div style="font-weight: bold; margin-bottom: 4px;">EXPECTED VALUE</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Expected value (simple display)
        html += `<div style="color: lime; font-weight: bold;">Expected Return: ${numberFormatter(evData.expectedValue)}</div>`;

        html += '</div>'; // Close summary section

        // Drop breakdown (if configured to show)
        const showDropsSetting = config.getSettingValue('expectedValue_showDrops', 'All');

        if (showDropsSetting !== 'None' && evData.drops.length > 0) {
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 8px 0;"></div>';

            // Determine how many drops to show
            let dropsToShow = evData.drops;
            let headerLabel = 'All Drops';

            if (showDropsSetting === 'Top 5') {
                dropsToShow = evData.drops.slice(0, 5);
                headerLabel = 'Top 5 Drops';
            } else if (showDropsSetting === 'Top 10') {
                dropsToShow = evData.drops.slice(0, 10);
                headerLabel = 'Top 10 Drops';
            }

            html += `<div style="font-weight: bold; margin-bottom: 4px;">${headerLabel} (${evData.drops.length} total):</div>`;
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            // List each drop
            for (const drop of dropsToShow) {
                if (!drop.hasPriceData) {
                    // Show item without price data in gray
                    html += `<div style="color: #aaa;">• ${drop.itemName} (${(drop.dropRate * 100).toFixed(2)}%): ${drop.avgCount.toFixed(2)} avg → No price data</div>`;
                } else {
                    // Format drop rate percentage
                    const dropRatePercent = (drop.dropRate * 100).toFixed(2);

                    // Show full drop breakdown
                    html += `<div>• ${drop.itemName} (${dropRatePercent}%): ${drop.avgCount.toFixed(2)} avg → ${numberFormatter(drop.expectedValue)}</div>`;
                }
            }

            html += '</div>'; // Close drops list

            // Show total
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 4px 0;"></div>';
            html += `<div style="font-size: 0.9em; margin-left: 8px; font-weight: bold;">Total from ${evData.drops.length} drops: ${numberFormatter(evData.expectedValue)}</div>`;
        }

        html += '</div>'; // Close main container

        evDiv.innerHTML = html;

        // Insert at the end of the tooltip
        tooltipText.appendChild(evDiv);
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.isActive = false;
        console.log('[TooltipPrices] Disabled');
    }
}

// Create and export singleton instance
const tooltipPrices = new TooltipPrices();

export default tooltipPrices;
