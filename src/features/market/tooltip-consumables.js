/**
 * Consumable Tooltips Feature
 * Adds HP/MP restoration stats to food/drink tooltips
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import { numberFormatter } from '../../utils/formatters.js';
import dom from '../../utils/dom.js';
import domObserver from '../../core/dom-observer.js';

/**
 * TooltipConsumables class handles injecting consumable stats into item tooltips
 */
class TooltipConsumables {
    constructor() {
        this.unregisterObserver = null;
        this.isActive = false;
        this.isInitialized = false;
    }

    /**
     * Initialize the consumable tooltips feature
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('showConsumTips')) {
            return;
        }

        this.isInitialized = true;

        // Wait for market data to load (needed for cost calculations)
        if (!marketAPI.isLoaded()) {
            await marketAPI.fetch(true);
        }

        // Add CSS to prevent tooltip cutoff (if not already added)
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
        // Check if styles already exist (might be added by tooltip-prices)
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
        this.unregisterObserver = domObserver.onClass('TooltipConsumables', 'MuiTooltip-popper', (tooltipElement) => {
            this.handleTooltip(tooltipElement);
        });

        this.isActive = true;
    }

    /**
     * Handle a tooltip element
     * @param {Element} tooltipElement - The tooltip popper element
     */
    async handleTooltip(tooltipElement) {
        // Guard against duplicate processing
        if (tooltipElement.dataset.consumablesProcessed) {
            return;
        }
        tooltipElement.dataset.consumablesProcessed = 'true';

        // Check if it's an item tooltip
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

        if (!itemDetails || !itemDetails.consumableDetail) {
            return; // Not a consumable
        }

        // Calculate consumable stats
        const consumableStats = this.calculateConsumableStats(itemHrid, itemDetails);

        if (!consumableStats) {
            return; // No stats to show
        }

        // Inject consumable display
        this.injectConsumableDisplay(tooltipElement, consumableStats);

        // Fix tooltip overflow (ensure it stays in viewport)
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Extract item HRID from tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @returns {string|null} Item HRID or null
     */
    extractItemHrid(tooltipElement) {
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
     * Calculate consumable stats
     * @param {string} itemHrid - Item HRID
     * @param {Object} itemDetails - Item details from game data
     * @returns {Object|null} Consumable stats or null
     */
    calculateConsumableStats(itemHrid, itemDetails) {
        const consumable = itemDetails.consumableDetail;

        if (!consumable) {
            return null;
        }

        // Get the restoration type and amount
        let restoreType = null;
        let restoreAmount = 0;

        // Check for HP restoration
        if (consumable.hitpointRestore) {
            restoreType = 'HP';
            restoreAmount = consumable.hitpointRestore;
        }
        // Check for MP restoration
        else if (consumable.manapointRestore) {
            restoreType = 'MP';
            restoreAmount = consumable.manapointRestore;
        }

        if (!restoreType || restoreAmount === 0) {
            return null; // No restoration stats
        }

        // Track BOTH durations separately
        const recoveryDuration = consumable.recoveryDuration ? consumable.recoveryDuration / 1e9 : 0;
        const cooldownDuration = consumable.cooldownDuration ? consumable.cooldownDuration / 1e9 : 0;

        // Restore per second (for over-time items)
        const restorePerSecond = recoveryDuration > 0 ? restoreAmount / recoveryDuration : 0;

        // Get market price for cost calculations
        const price = marketAPI.getPrice(itemHrid, 0);
        const askPrice = price?.ask || 0;

        // Cost per HP or MP
        const costPerPoint = askPrice > 0 ? askPrice / restoreAmount : 0;

        // Daily max based on COOLDOWN, not recovery duration
        const usesPerDay = cooldownDuration > 0 ? (24 * 60 * 60) / cooldownDuration : 0;
        const dailyMax = restoreAmount * usesPerDay;

        return {
            restoreType,
            restoreAmount,
            restorePerSecond,
            recoveryDuration, // How long healing takes
            cooldownDuration, // How often you can use it
            askPrice,
            costPerPoint,
            dailyMax,
            usesPerDay,
        };
    }

    /**
     * Inject consumable display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Object} stats - Consumable stats
     */
    injectConsumableDisplay(tooltipElement, stats) {
        const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        if (tooltipText.querySelector('.consumable-stats-injected')) {
            return;
        }

        // Create consumable display container
        const consumableDiv = dom.createStyledDiv(
            { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
            '',
            'consumable-stats-injected'
        );

        // Build consumable display
        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

        // CONSUMABLE STATS section
        html += '<div style="font-weight: bold; margin-bottom: 4px;">CONSUMABLE STATS</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Restores line
        if (stats.recoveryDuration > 0) {
            html += `<div>Restores: ${numberFormatter(stats.restorePerSecond, 1)} ${stats.restoreType}/s</div>`;
        } else {
            html += `<div>Restores: ${numberFormatter(stats.restoreAmount)} ${stats.restoreType} (instant)</div>`;
        }

        // Cost efficiency line
        if (stats.costPerPoint > 0) {
            html += `<div>Cost: ${numberFormatter(stats.costPerPoint, 1)} per ${stats.restoreType}</div>`;
        } else if (stats.askPrice === 0) {
            html += `<div style="color: gray; font-style: italic;">Cost: No market data</div>`;
        }

        // Daily maximum line - ALWAYS show (based on cooldown)
        if (stats.dailyMax > 0) {
            html += `<div>Daily Max: ${numberFormatter(stats.dailyMax)} ${stats.restoreType}</div>`;
        }

        // Recovery duration line - ONLY for over-time items
        if (stats.recoveryDuration > 0) {
            html += `<div>Recovery Time: ${stats.recoveryDuration}s</div>`;
        }

        // Cooldown line - ALWAYS show
        if (stats.cooldownDuration > 0) {
            html += `<div>Cooldown: ${stats.cooldownDuration}s (${numberFormatter(stats.usesPerDay)} uses/day)</div>`;
        }

        html += '</div>';
        html += '</div>';

        consumableDiv.innerHTML = html;

        tooltipText.appendChild(consumableDiv);
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

const tooltipConsumables = new TooltipConsumables();

export default tooltipConsumables;
