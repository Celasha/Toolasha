/**
 * Market Tooltip Prices Feature
 * Adds market prices to item tooltips
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import profitCalculator from './profit-calculator.js';
import alchemyProfitCalculator from './alchemy-profit-calculator.js';
import expectedValueCalculator from './expected-value-calculator.js';
import { calculateEnhancementPath, buildEnhancementTooltipHTML } from '../enhancement/tooltip-enhancement.js';
import { calculateGatheringProfit } from '../actions/gathering-profit.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { numberFormatter, formatKMB, networthFormatter, formatPercentage } from '../../utils/formatters.js';
import { getItemPrices } from '../../utils/market-data.js';
import { calculateActionsPerHour } from '../../utils/profit-helpers.js';
import dom from '../../utils/dom.js';

// Compiled regex patterns (created once, reused for performance)
const REGEX_ENHANCEMENT_LEVEL = /\+(\d+)$/;
const REGEX_ENHANCEMENT_STRIP = /\s*\+\d+$/;
const REGEX_AMOUNT = /x([\d,]+)|Amount:\s*([\d,]+)/i;
const REGEX_COMMA = /,/g;

/**
 * Format price for tooltip display based on user setting
 * @param {number} num - The number to format
 * @returns {string} Formatted number
 */
function formatTooltipPrice(num) {
    const useKMB = config.getSetting('formatting_useKMBFormat');
    return useKMB ? networthFormatter(num) : numberFormatter(num);
}

/**
 * TooltipPrices class handles injecting market prices into item tooltips
 */
class TooltipPrices {
    constructor() {
        this.unregisterObserver = null;
        this.isActive = false;
        this.isInitialized = false;
    }

    /**
     * Initialize the tooltip prices feature
     */
    async initialize() {
        // Guard against duplicate initialization
        if (this.isInitialized) {
            return;
        }

        // Check if feature is enabled
        if (!config.getSetting('itemTooltip_prices')) {
            return;
        }

        this.isInitialized = true;

        // Wait for market data to load
        if (!marketAPI.isLoaded()) {
            await marketAPI.fetch(true); // Force fresh fetch on init
        }

        // Add CSS to prevent tooltip cutoff
        this.addTooltipStyles();

        // Register with centralized DOM observer
        this.setupObserver();
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
        // Check if styles already exist (might be added by tooltip-consumables)
        if (document.getElementById('mwi-tooltip-fixes')) {
            return; // Already added
        }

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
     * Set up observer to watch for tooltip elements
     */
    setupObserver() {
        // Register with centralized DOM observer to watch for tooltip poppers
        this.unregisterObserver = domObserver.onClass('TooltipPrices', 'MuiTooltip-popper', (tooltipElement) => {
            this.handleTooltip(tooltipElement);
        });

        this.isActive = true;
    }

    /**
     * Handle a tooltip element
     * @param {Element} tooltipElement - The tooltip popper element
     */
    async handleTooltip(tooltipElement) {
        // Check if it's a collection tooltip
        const collectionContent = tooltipElement.querySelector('div.Collection_tooltipContent__2IcSJ');
        const isCollectionTooltip = !!collectionContent;

        // Check if it's a regular item tooltip
        const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
        const isItemTooltip = !!nameElement;

        if (!isCollectionTooltip && !isItemTooltip) {
            return; // Not a tooltip we can enhance
        }

        // Extract item name from appropriate element
        let itemName;
        if (isCollectionTooltip) {
            const collectionNameElement = tooltipElement.querySelector('div.Collection_name__10aep');
            if (!collectionNameElement) {
                return; // No name element in collection tooltip
            }
            itemName = collectionNameElement.textContent.trim();
        } else {
            itemName = nameElement.textContent.trim();
        }

        // Get the item HRID from the name
        const itemHrid = this.extractItemHridFromName(itemName);

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
                this.injectExpectedValueDisplay(tooltipElement, evData, isCollectionTooltip);
            }
            // Fix tooltip overflow before returning
            dom.fixTooltipOverflow(tooltipElement);
            return; // Skip price/profit display for containers
        }

        // Only check enhancement level for regular item tooltips (not collection tooltips)
        let enhancementLevel = 0;
        if (isItemTooltip && !isCollectionTooltip) {
            enhancementLevel = this.extractEnhancementLevel(tooltipElement);
        }

        // Get market price for the specific enhancement level (0 for base items, 1-20 for enhanced)
        const price = getItemPrices(itemHrid, enhancementLevel);

        // Inject price display only if we have market data
        if (price && (price.ask > 0 || price.bid > 0)) {
            // Get item amount from tooltip (for stacks)
            const amount = this.extractItemAmount(tooltipElement);
            this.injectPriceDisplay(tooltipElement, price, amount, isCollectionTooltip);
        }

        // Always show detailed craft profit if enabled
        if (config.getSetting('itemTooltip_profit') && enhancementLevel === 0) {
            // Original single-action craft profit display
            // Only run for base items (enhancementLevel = 0), not enhanced items
            // Enhanced items show their cost in the enhancement path section instead
            const profitData = await profitCalculator.calculateProfit(itemHrid);
            if (profitData) {
                this.injectProfitDisplay(tooltipElement, profitData, isCollectionTooltip);
            }
        }

        // Optionally show alternative alchemy actions below craft profit
        if (config.getSetting('itemTooltip_multiActionProfit')) {
            // Multi-action profit display (alchemy actions only - craft shown above)
            await this.injectMultiActionProfitDisplay(tooltipElement, itemHrid, enhancementLevel, isCollectionTooltip);
        }

        // Check for gathering sources (Foraging, Woodcutting, Milking)
        if (config.getSetting('itemTooltip_gathering') && enhancementLevel === 0) {
            const gatheringData = await this.findGatheringSources(itemHrid);
            if (gatheringData && (gatheringData.soloActions.length > 0 || gatheringData.zoneActions.length > 0)) {
                this.injectGatheringDisplay(tooltipElement, gatheringData, isCollectionTooltip);
            }
        }

        // Show enhancement path for enhanced items (1-20)
        if (enhancementLevel > 0) {
            // Get enhancement configuration
            const enhancementConfig = getEnhancingParams();
            if (enhancementConfig) {
                // Calculate optimal enhancement path
                const enhancementData = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementConfig);

                if (enhancementData) {
                    // Inject enhancement analysis into tooltip
                    this.injectEnhancementDisplay(tooltipElement, enhancementData);
                }
            }
        }

        // Fix tooltip overflow (ensure it stays in viewport)
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Extract enhancement level from tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @returns {number} Enhancement level (0 if not enhanced)
     */
    extractEnhancementLevel(tooltipElement) {
        const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
        if (!nameElement) {
            return 0;
        }

        const itemName = nameElement.textContent.trim();

        // Match "+X" at end of name
        const match = itemName.match(REGEX_ENHANCEMENT_LEVEL);
        if (match) {
            return parseInt(match[1], 10);
        }

        return 0;
    }

    /**
     * Inject enhancement display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} enhancementData - Enhancement analysis data
     */
    injectEnhancementDisplay(tooltipElement, enhancementData) {
        // Find the tooltip text container
        const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-enhancement-injected')) {
            return;
        }

        // Create enhancement display container
        const enhancementDiv = dom.createStyledDiv(
            { color: config.COLOR_TOOLTIP_INFO },
            '',
            'market-enhancement-injected'
        );

        // Build HTML using the tooltip-enhancement module
        enhancementDiv.innerHTML = buildEnhancementTooltipHTML(enhancementData);

        // Insert at the end of the tooltip
        tooltipText.appendChild(enhancementDiv);
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

        let itemName = nameElement.textContent.trim();

        // Strip enhancement level (e.g., "+10" from "Griffin Bulwark +10")
        // This is critical - enhanced items need to lookup the base item
        itemName = itemName.replace(REGEX_ENHANCEMENT_STRIP, '');

        return this.extractItemHridFromName(itemName);
    }

    /**
     * Extract item HRID from item name
     * @param {string} itemName - Item name
     * @returns {string|null} Item HRID or null
     */
    extractItemHridFromName(itemName) {
        // Strip enhancement level (e.g., "+10" from "Griffin Bulwark +10")
        // This is critical - enhanced items need to lookup the base item
        itemName = itemName.replace(REGEX_ENHANCEMENT_STRIP, '');

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
        const match = text.match(REGEX_AMOUNT);

        if (match) {
            // Strip commas before parsing
            const amountStr = (match[1] || match[2]).replace(REGEX_COMMA, '');
            return parseInt(amountStr, 10);
        }

        return 1; // Default to 1 if not found
    }

    /**
     * Inject price display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} price - { ask, bid }
     * @param {number} amount - Item amount
     * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
     */
    injectPriceDisplay(tooltipElement, price, amount, isCollectionTooltip = false) {
        // Find the tooltip text container
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            console.warn('[TooltipPrices] Could not find tooltip text container');
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-price-injected')) {
            return;
        }

        // Create price display
        const priceDiv = dom.createStyledDiv({ color: config.COLOR_TOOLTIP_INFO }, '', 'market-price-injected');

        // Show message if no market data at all
        if (price.ask <= 0 && price.bid <= 0) {
            priceDiv.innerHTML = `Price: <span style="color: ${config.COLOR_TEXT_SECONDARY}; font-style: italic;">No market data</span>`;
            tooltipText.appendChild(priceDiv);
            return;
        }

        // Format prices, using "-" for missing values
        const askDisplay = price.ask > 0 ? formatTooltipPrice(price.ask) : '-';
        const bidDisplay = price.bid > 0 ? formatTooltipPrice(price.bid) : '-';

        // Calculate totals (only if both prices valid and amount > 1)
        let totalDisplay = '';
        if (amount > 1 && price.ask > 0 && price.bid > 0) {
            const totalAsk = price.ask * amount;
            const totalBid = price.bid * amount;
            totalDisplay = ` (${formatTooltipPrice(totalAsk)} / ${formatTooltipPrice(totalBid)})`;
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
     * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
     */
    injectProfitDisplay(tooltipElement, profitData, isCollectionTooltip = false) {
        // Find the tooltip text container
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-profit-injected')) {
            return;
        }

        // Create profit display container
        const profitDiv = dom.createStyledDiv(
            { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
            '',
            'market-profit-injected'
        );

        // Check if detailed view is enabled
        const showDetailed = config.getSetting('itemTooltip_detailedProfit');

        // Build profit display
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        if (profitData.itemPrice.bid > 0 && profitData.itemPrice.ask > 0) {
            // Market data available - show profit
            html += '<div style="font-weight: bold; margin-bottom: 4px;">PROFIT</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            const profitPerDay = profitData.profitPerDay;
            const profitColor = profitData.profitPerHour >= 0 ? config.COLOR_TOOLTIP_PROFIT : config.COLOR_TOOLTIP_LOSS;

            html += `<div style="color: ${profitColor}; font-weight: bold;">Net: ${numberFormatter(profitData.profitPerHour)}/hr (${formatKMB(profitPerDay)}/day)</div>`;

            // Show detailed breakdown if enabled
            if (showDetailed) {
                html += this.buildDetailedProfitDisplay(profitData);
            }
        } else {
            // No market data - show cost
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            const teaCostPerItem = profitData.totalTeaCostPerHour / profitData.itemsPerHour;
            const productionCost = profitData.totalMaterialCost + teaCostPerItem;

            html += `<div style="font-weight: bold; color: ${config.COLOR_TOOLTIP_INFO};">Cost: ${numberFormatter(productionCost)}/item</div>`;
            html += `<div style="color: ${config.COLOR_TEXT_SECONDARY}; font-style: italic; margin-top: 4px;">No market data available</div>`;
        }

        html += '</div>';
        html += '</div>';

        profitDiv.innerHTML = html;
        tooltipText.appendChild(profitDiv);
    }

    /**
     * Build detailed profit display with materials table
     * @param {Object} profitData - Profit calculation data
     * @returns {string} HTML string for detailed display
     */
    buildDetailedProfitDisplay(profitData) {
        let html = '';

        // Materials table
        if (profitData.materialCosts && profitData.materialCosts.length > 0) {
            html += '<div style="margin-top: 8px;">';
            html += `<table style="width: 100%; border-collapse: collapse; font-size: 0.85em; color: ${config.COLOR_TOOLTIP_INFO};">`;

            // Table header
            html += `<tr style="border-bottom: 1px solid ${config.COLOR_BORDER};">`;
            html += '<th style="padding: 2px 4px; text-align: left;">Material</th>';
            html += '<th style="padding: 2px 4px; text-align: center;">Count</th>';
            html += '<th style="padding: 2px 4px; text-align: right;">Ask</th>';
            html += '<th style="padding: 2px 4px; text-align: right;">Bid</th>';
            html += '</tr>';

            // Fetch market prices for all materials (profit calculator only stores one price based on mode)
            const materialsWithPrices = profitData.materialCosts.map((material) => {
                const itemHrid = material.itemHrid;
                const marketPrice = marketAPI.getPrice(itemHrid, 0);

                return {
                    ...material,
                    askPrice: marketPrice?.ask && marketPrice.ask > 0 ? marketPrice.ask : 0,
                    bidPrice: marketPrice?.bid && marketPrice.bid > 0 ? marketPrice.bid : 0,
                };
            });

            // Calculate totals using actual amounts (not count - materialCosts uses 'amount' field)
            const totalCount = materialsWithPrices.reduce((sum, m) => sum + m.amount, 0);
            const totalAsk = materialsWithPrices.reduce((sum, m) => sum + m.askPrice * m.amount, 0);
            const totalBid = materialsWithPrices.reduce((sum, m) => sum + m.bidPrice * m.amount, 0);

            // Total row
            html += `<tr style="border-bottom: 1px solid ${config.COLOR_BORDER};">`;
            html += '<td style="padding: 2px 4px; font-weight: bold;">Total</td>';
            html += `<td style="padding: 2px 4px; text-align: center;">${totalCount.toFixed(1)}</td>`;
            html += `<td style="padding: 2px 4px; text-align: right;">${formatKMB(totalAsk)}</td>`;
            html += `<td style="padding: 2px 4px; text-align: right;">${formatKMB(totalBid)}</td>`;
            html += '</tr>';

            // Material rows
            for (const material of materialsWithPrices) {
                html += '<tr>';
                html += `<td style="padding: 2px 4px;">${material.itemName}</td>`;
                html += `<td style="padding: 2px 4px; text-align: center;">${material.amount.toFixed(1)}</td>`;
                html += `<td style="padding: 2px 4px; text-align: right;">${formatKMB(material.askPrice)}</td>`;
                html += `<td style="padding: 2px 4px; text-align: right;">${formatKMB(material.bidPrice)}</td>`;
                html += '</tr>';
            }

            html += '</table>';
            html += '</div>';
        }

        // Detailed profit breakdown
        html += '<div style="margin-top: 8px; font-size: 0.85em;">';
        const profitPerAction = profitData.profitPerAction;
        const profitPerDay = profitData.profitPerDay;
        const profitColor = profitData.profitPerHour >= 0 ? config.COLOR_TOOLTIP_PROFIT : config.COLOR_TOOLTIP_LOSS;

        html += `<div style="color: ${profitColor};">Profit: ${numberFormatter(profitPerAction)}/action, ${numberFormatter(profitData.profitPerHour)}/hour, ${formatKMB(profitPerDay)}/day</div>`;
        html += '</div>';

        return html;
    }

    /**
     * Inject expected value display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} evData - Expected value calculation data
     * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
     */
    injectExpectedValueDisplay(tooltipElement, evData, isCollectionTooltip = false) {
        // Find the tooltip text container
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-ev-injected')) {
            return;
        }

        // Create EV display container
        const evDiv = dom.createStyledDiv(
            { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
            '',
            'market-ev-injected'
        );

        // Build EV display
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        // Header
        html += '<div style="font-weight: bold; margin-bottom: 4px;">EXPECTED VALUE</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Expected value (simple display)
        html += `<div style="color: ${config.COLOR_TOOLTIP_PROFIT}; font-weight: bold;">Expected Return: ${formatTooltipPrice(evData.expectedValue)}</div>`;

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
                    html += `<div style="color: ${config.COLOR_TEXT_SECONDARY};">• ${drop.itemName} (${formatPercentage(drop.dropRate, 2)}): ${drop.avgCount.toFixed(2)} avg → No price data</div>`;
                } else {
                    // Format drop rate percentage
                    const dropRatePercent = formatPercentage(drop.dropRate, 2);

                    // Show full drop breakdown
                    html += `<div>• ${drop.itemName} (${dropRatePercent}%): ${drop.avgCount.toFixed(2)} avg → ${formatTooltipPrice(drop.expectedValue)}</div>`;
                }
            }

            html += '</div>'; // Close drops list

            // Show total
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 4px 0;"></div>';
            html += `<div style="font-size: 0.9em; margin-left: 8px; font-weight: bold;">Total from ${evData.drops.length} drops: ${formatTooltipPrice(evData.expectedValue)}</div>`;
        }

        html += '</div>'; // Close main container

        evDiv.innerHTML = html;

        // Insert at the end of the tooltip
        tooltipText.appendChild(evDiv);
    }

    /**
     * Find gathering sources for an item
     * @param {string} itemHrid - Item HRID
     * @returns {Object|null} { soloActions: [...], zoneActions: [...] }
     */
    async findGatheringSources(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.actionDetailMap) {
            return null;
        }

        const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

        const soloActions = [];
        const zoneActions = [];

        // Search through all actions
        for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            // Skip non-gathering actions
            if (!GATHERING_TYPES.includes(action.type)) {
                continue;
            }

            // Check if this action produces our item
            let foundInDrop = false;
            let dropRate = 0;
            let isSolo = false;

            // Check drop table (both solo and zone actions)
            if (action.dropTable) {
                for (const drop of action.dropTable) {
                    if (drop.itemHrid === itemHrid) {
                        foundInDrop = true;
                        dropRate = drop.dropRate;
                        // Solo gathering has 100% drop rate (dropRate === 1)
                        // Zone gathering has < 100% drop rate
                        isSolo = dropRate === 1;
                        break;
                    }
                }
            }

            // Check rare drop table (rare finds - always zone actions)
            if (!foundInDrop && action.rareDropTable) {
                for (const drop of action.rareDropTable) {
                    if (drop.itemHrid === itemHrid) {
                        foundInDrop = true;
                        dropRate = drop.dropRate;
                        isSolo = false; // Rare drops are never solo
                        break;
                    }
                }
            }

            if (foundInDrop || isSolo) {
                const actionData = {
                    actionHrid,
                    actionName: action.name,
                    dropRate,
                };

                if (isSolo) {
                    soloActions.push(actionData);
                } else {
                    zoneActions.push(actionData);
                }
            }
        }

        // Only return if we found something
        if (soloActions.length === 0 && zoneActions.length === 0) {
            return null;
        }

        // Calculate profit for solo actions
        for (const action of soloActions) {
            const profitData = await calculateGatheringProfit(action.actionHrid);
            if (profitData) {
                action.itemsPerHour = profitData.baseOutputs?.[0]?.itemsPerHour || 0;
                action.profitPerHour = profitData.profitPerHour || 0;
            }
        }

        // Calculate items/hr for zone actions (no profit)
        for (const action of zoneActions) {
            const actionDetail = gameData.actionDetailMap[action.actionHrid];
            if (!actionDetail) {
                continue;
            }

            // Calculate base actions per hour
            const baseTimeCost = actionDetail.baseTimeCost; // in nanoseconds
            const timeInSeconds = baseTimeCost / 1e9;
            const actionsPerHour = calculateActionsPerHour(timeInSeconds);

            // Calculate items per hour
            const itemsPerHour = actionsPerHour * action.dropRate;

            // For rare drops (< 1%), store items/day instead for better readability
            // For regular drops (>= 1%), store items/hr
            if (action.dropRate < 0.01) {
                action.itemsPerDay = itemsPerHour * 24;
                action.isRareDrop = true;
            } else {
                action.itemsPerHour = itemsPerHour;
                action.isRareDrop = false;
            }
        }

        return { soloActions, zoneActions };
    }

    /**
     * Inject gathering display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} gatheringData - { soloActions: [...], zoneActions: [...] }
     * @param {boolean} isCollectionTooltip - True if collection tooltip
     */
    injectGatheringDisplay(tooltipElement, gatheringData, isCollectionTooltip = false) {
        // Find the tooltip text container
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-gathering-injected')) {
            return;
        }

        // Filter out rare drops if setting is disabled
        const showRareDrops = config.getSetting('itemTooltip_gatheringRareDrops');
        let zoneActions = gatheringData.zoneActions;
        if (!showRareDrops) {
            zoneActions = zoneActions.filter((action) => !action.isRareDrop);
        }

        // Skip if no actions to show
        if (gatheringData.soloActions.length === 0 && zoneActions.length === 0) {
            return;
        }

        // Create gathering display container
        const gatheringDiv = dom.createStyledDiv(
            { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
            '',
            'market-gathering-injected'
        );

        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';
        html += '<div style="font-weight: bold; margin-bottom: 4px;">GATHERING</div>';

        // Solo actions section
        if (gatheringData.soloActions.length > 0) {
            html += '<div style="font-size: 0.9em; margin-left: 8px; margin-bottom: 6px;">';
            html += '<div style="font-weight: 500; margin-bottom: 2px;">Solo:</div>';

            for (const action of gatheringData.soloActions) {
                const itemsPerHourStr = action.itemsPerHour ? Math.round(action.itemsPerHour) : '?';
                const profitStr = action.profitPerHour ? formatKMB(Math.round(action.profitPerHour)) : '?';

                html += `<div style="margin-left: 8px;">• ${action.actionName}: ${itemsPerHourStr} items/hr | ${profitStr} gold/hr</div>`;
            }

            html += '</div>';
        }

        // Zone actions section
        if (zoneActions.length > 0) {
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';
            html += '<div style="font-weight: 500; margin-bottom: 2px;">Found in:</div>';

            for (const action of zoneActions) {
                // Use more decimal places for very rare drops (< 0.1%)
                const percentValue = action.dropRate * 100;
                const dropRatePercent = percentValue < 0.1 ? percentValue.toFixed(4) : percentValue.toFixed(1);

                // Show items/day for rare drops (< 1%), items/hr for regular drops
                let itemsDisplay;
                if (action.isRareDrop) {
                    const itemsPerDayStr = action.itemsPerDay ? action.itemsPerDay.toFixed(2) : '?';
                    itemsDisplay = `${itemsPerDayStr} items/day`;
                } else {
                    const itemsPerHourStr = action.itemsPerHour ? Math.round(action.itemsPerHour) : '?';
                    itemsDisplay = `${itemsPerHourStr} items/hr`;
                }

                html += `<div style="margin-left: 8px;">• ${action.actionName}: ${itemsDisplay} (${dropRatePercent}% drop)</div>`;
            }

            html += '</div>';
        }

        html += '</div>'; // Close main container

        gatheringDiv.innerHTML = html;

        // Insert at the end of the tooltip
        tooltipText.appendChild(gatheringDiv);
    }

    /**
     * Inject multi-action profit display into tooltip
     * Shows all profitable actions (craft, coinify, decompose, transmute) with best highlighted
     * @param {Element} tooltipElement - Tooltip element
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
     */
    async injectMultiActionProfitDisplay(tooltipElement, itemHrid, enhancementLevel, isCollectionTooltip = false) {
        // Find the tooltip text container
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.market-multi-action-injected')) {
            return;
        }

        // Collect alchemy profit data (craft profit is shown separately via injectProfitDisplay)
        const allProfits = [];

        // Try alchemy profits (coinify, decompose, transmute)
        const alchemyProfits = alchemyProfitCalculator.calculateAllProfits(itemHrid, enhancementLevel);

        if (alchemyProfits.coinify) {
            allProfits.push(alchemyProfits.coinify);
        }
        if (alchemyProfits.decompose) {
            allProfits.push(alchemyProfits.decompose);
        }
        if (alchemyProfits.transmute) {
            allProfits.push(alchemyProfits.transmute);
        }

        // If no profitable actions found, return
        if (allProfits.length === 0) {
            return;
        }

        // Sort by profitPerHour descending
        allProfits.sort((a, b) => b.profitPerHour - a.profitPerHour);

        // Check if item is craftable (has a production action)
        const isCraftable = profitCalculator.findProductionAction(itemHrid) !== null;

        // Create profit display container
        const profitDiv = dom.createStyledDiv(
            { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
            '',
            'market-multi-action-injected'
        );

        // Build display
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        // Show heading based on whether item is craftable
        const heading = isCraftable ? 'Alternative Actions:' : 'Profits:';
        html += `<div style="font-weight: bold; margin-bottom: 4px;">${heading}</div>`;
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        for (let i = 0; i < allProfits.length; i++) {
            const profit = allProfits[i];
            const label = profit.actionType.charAt(0).toUpperCase() + profit.actionType.slice(1);
            const color = profit.profitPerHour >= 0 ? config.COLOR_TOOLTIP_INFO : config.COLOR_TOOLTIP_LOSS;
            html += `<div style="color: ${color};">• ${label}: ${numberFormatter(profit.profitPerHour)}/hr`;

            // Show success rate for alchemy actions
            if (profit.successRate !== undefined) {
                html += ` <span style="opacity: 0.7;">(${(profit.successRate * 100).toFixed(0)}% success)</span>`;
            }

            html += '</div>';
        }

        html += '</div>';

        html += '</div>';

        profitDiv.innerHTML = html;
        tooltipText.appendChild(profitDiv);
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        this.isActive = false;
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const tooltipPrices = new TooltipPrices();

export default tooltipPrices;
