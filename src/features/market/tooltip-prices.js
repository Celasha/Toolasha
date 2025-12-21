/**
 * Market Tooltip Prices Feature
 * Adds market prices to item tooltips
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import profitCalculator from './profit-calculator.js';
import { numberFormatter } from '../../utils/formatters.js';
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
        this.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Fix tooltip overflow to ensure it stays within viewport
     * @param {Element} tooltipElement - The tooltip popper element
     */
    fixTooltipOverflow(tooltipElement) {
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
            if (!tooltipElement.isConnected) {
                return; // Tooltip already removed
            }

            const bBox = tooltipElement.getBoundingClientRect();

            // Check if tooltip extends beyond viewport
            if (bBox.top < 0 || bBox.bottom > window.innerHeight) {
                // Get current transform
                const transformString = tooltipElement.style.transform;

                if (transformString) {
                    // Parse transform3d(x, y, z)
                    const match = transformString.match(/translate3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);

                    if (match) {
                        const x = match[1];
                        const z = match[3];

                        // Reset Y position to 0 to keep tooltip in viewport
                        tooltipElement.style.transform = `translate3d(${x}, 0px, ${z})`;
                    }
                }
            }
        });
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
        // Look for amount text in tooltip (e.g., "x5", "Amount: 5")
        const text = tooltipElement.textContent;
        const match = text.match(/x(\d+)|Amount:\s*(\d+)/i);

        if (match) {
            return parseInt(match[1] || match[2], 10);
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

        // Build profit display - Option 1 Enhanced
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        // Material costs section
        if (profitData.materialCosts.length > 0) {
            html += '<div style="font-weight: bold; margin-bottom: 4px;">PRODUCTION COST</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            const hasAnyValidPrices = profitData.materialCosts.some(mat => mat.askPrice > 0);

            if (hasAnyValidPrices) {
                for (const material of profitData.materialCosts) {
                    // Format: • ItemName ×quantity @ unit_price → total_cost
                    const priceDisplay = material.askPrice > 0 ? numberFormatter(material.askPrice) : '-';
                    const totalDisplay = material.askPrice > 0 ? numberFormatter(material.totalCost) : '-';
                    html += `<div>• ${material.itemName} ×${material.amount} @ ${priceDisplay} → ${totalDisplay}</div>`;
                }

                // Only show Total if multiple materials and all have prices
                if (profitData.materialCosts.length > 1 && profitData.materialCosts.every(mat => mat.askPrice > 0)) {
                    html += `<div style="margin-top: 4px; font-weight: bold;">Total: ${numberFormatter(profitData.totalMaterialCost)}</div>`;
                }
            } else {
                html += `<div style="color: gray; font-style: italic;">Material prices unavailable</div>`;
            }

            html += '</div>';
        }

        // Separator
        html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 8px 0;"></div>';

        // Profit Analysis section
        html += '<div style="font-weight: bold; margin-bottom: 4px;">PROFIT ANALYSIS</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Check if we can calculate profit (need BOTH valid ask and bid prices)
        if (profitData.itemPrice.bid > 0 && profitData.itemPrice.ask > 0) {
            // Net profit line (color-coded)
            const profitColor = profitData.profitPerItem >= 0 ? 'lime' : 'red';
            html += `<div style="color: ${profitColor}; font-weight: bold;">Net: ${numberFormatter(profitData.profitPerItem)}/item (${numberFormatter(profitData.profitPerHour)}/hr)</div>`;

            // Sell vs Cost line
            html += `<div>Sell: ${numberFormatter(profitData.bidAfterTax)} | Cost: ${numberFormatter(profitData.costPerItem)}</div>`;
        } else {
            html += `<div style="color: gray; font-style: italic;">Incomplete market data</div>`;
        }

        // Time breakdown section (always show)
        const breakdown = profitData.timeBreakdown;

        // Show final action time FIRST (what matters most to player)
        html += `<div style="margin-top: 4px; font-weight: bold;">Action Time: ${breakdown.finalTime.toFixed(2)}s (${numberFormatter(breakdown.actionsPerHour)}/hr)</div>`;

        // Visual separator
        html += `<div style="border-top: 1px solid rgba(255,255,255,0.3); margin: 2px 0;"></div>`;

        // Show base time
        html += `<div>Base Time: ${breakdown.baseTime.toFixed(2)}s</div>`;

        // Show each speed modifier step (working backwards from base)
        if (breakdown.steps.length > 0) {
            for (const step of breakdown.steps) {
                html += `<div style="margin-left: 8px;">`;
                html += `  - ${step.name} (+${step.bonus.toFixed(1)}%): -${step.reduction.toFixed(2)}s`;
                html += `</div>`;
            }
        }

        // Efficiency section (if > 0) - shows output multiplier
        if (profitData.efficiencyBonus > 0) {
            // Separator between time calculation and efficiency
            html += `<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 8px 0;"></div>`;
            html += `<div>Efficiency: +${profitData.efficiencyBonus.toFixed(1)}%</div>`;

            // Show efficiency breakdown (level + house)
            if (profitData.levelEfficiency > 0 || profitData.houseEfficiency > 0) {
                if (profitData.levelEfficiency > 0) {
                    html += `<div style="margin-left: 8px;">  - Level Advantage: +${profitData.levelEfficiency.toFixed(1)}%</div>`;
                }
                if (profitData.houseEfficiency > 0) {
                    html += `<div style="margin-left: 8px;">  - House Room: +${profitData.houseEfficiency.toFixed(1)}%</div>`;
                }
            }

            html += `<div style="margin-left: 8px;">Output: ×${profitData.efficiencyMultiplier.toFixed(2)} (${numberFormatter(profitData.itemsPerHour)}/hr)</div>`;
        }

        html += '</div>';
        html += '</div>';

        profitDiv.innerHTML = html;

        // Insert at the end of the tooltip
        tooltipText.appendChild(profitDiv);
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
