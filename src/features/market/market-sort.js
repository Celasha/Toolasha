/**
 * Market Sort by Profitability
 * Adds ability to sort marketplace items by profit/hour
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import profitCalculator from './profit-calculator.js';
import { calculateGatheringProfit } from '../actions/gathering-profit.js';
import { formatLargeNumber } from '../../utils/formatters.js';

class MarketSort {
    constructor() {
        this.isActive = false;
        this.unregisterHandlers = [];
        this.isInitialized = false;

        // Profit cache for current session (cleared on navigation)
        this.profitCache = new Map();

        // Original order storage (item HRIDs in original order)
        this.originalOrder = [];

        // Sort state
        this.sortDirection = 'desc'; // 'desc' = highest profit first
        this.isSorting = false;
        this.hasSorted = false;
        this.sortButton = null;
    }

    /**
     * Initialize market sort
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('marketSort')) {
            return;
        }

        this.isInitialized = true;

        // Register DOM observers for marketplace panel
        this.registerDOMObservers();

        this.isActive = true;
    }

    /**
     * Register DOM observers for marketplace panel
     */
    registerDOMObservers() {
        // Watch for marketplace panel appearing
        const unregister = domObserver.onClass(
            'market-sort-container',
            'MarketplacePanel_itemFilterContainer',
            (filterContainer) => {
                this.injectSortUI(filterContainer);
            }
        );

        this.unregisterHandlers.push(unregister);

        // Clear cache when navigating away from marketplace
        const unregisterNav = domObserver.onClass(
            'market-sort-nav',
            'MarketplacePanel_panel',
            () => {
                // Panel appeared, don't clear cache
            },
            () => {
                // Panel disappeared, clear cache and original order
                this.profitCache.clear();
                this.originalOrder = [];
                this.hasSorted = false;
            }
        );

        this.unregisterHandlers.push(unregisterNav);

        // Check immediately in case marketplace is already open
        const existingFilterContainer = document.querySelector('div[class*="MarketplacePanel_itemFilterContainer"]');
        if (existingFilterContainer) {
            this.injectSortUI(existingFilterContainer);
        }
    }

    /**
     * Inject sort UI into marketplace panel
     * @param {HTMLElement} filterContainer - Filter container element
     */
    injectSortUI(filterContainer) {
        // Check if already injected
        if (document.querySelector('#toolasha-market-sort')) {
            return;
        }

        // Create sort container
        const sortDiv = document.createElement('div');
        sortDiv.id = 'toolasha-market-sort';
        sortDiv.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; align-items: center;';

        // Create sort button
        const sortButton = document.createElement('button');
        sortButton.id = 'toolasha-sort-profit-btn';
        sortButton.textContent = 'Sort by Profit';
        sortButton.style.cssText = `
            padding: 6px 12px;
            border-radius: 4px;
            background: rgba(91, 141, 239, 0.2);
            color: #fff;
            border: 1px solid rgba(91, 141, 239, 0.5);
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        `;

        sortButton.addEventListener('mouseenter', () => {
            if (!this.isSorting) {
                sortButton.style.background = 'rgba(91, 141, 239, 0.4)';
            }
        });

        sortButton.addEventListener('mouseleave', () => {
            if (!this.isSorting) {
                sortButton.style.background = 'rgba(91, 141, 239, 0.2)';
            }
        });

        sortButton.addEventListener('click', () => this.handleSortClick());

        this.sortButton = sortButton;
        sortDiv.appendChild(sortButton);

        // Create reset button
        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset Order';
        resetButton.style.cssText = `
            padding: 6px 12px;
            border-radius: 4px;
            background: rgba(100, 100, 100, 0.2);
            color: #fff;
            border: 1px solid rgba(100, 100, 100, 0.5);
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        `;

        resetButton.addEventListener('mouseenter', () => {
            resetButton.style.background = 'rgba(100, 100, 100, 0.4)';
        });

        resetButton.addEventListener('mouseleave', () => {
            resetButton.style.background = 'rgba(100, 100, 100, 0.2)';
        });

        resetButton.addEventListener('click', () => this.resetOrder());

        sortDiv.appendChild(resetButton);

        // Insert after the filter container
        filterContainer.parentElement.insertBefore(sortDiv, filterContainer.nextSibling);
    }

    /**
     * Handle sort button click
     */
    async handleSortClick() {
        if (this.isSorting) {
            return;
        }

        // Toggle direction only if we've already sorted once
        if (this.hasSorted) {
            this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
        }

        this.sortButton.textContent = this.sortDirection === 'desc' ? 'Sorting... ▼' : 'Sorting... ▲';
        this.sortButton.style.background = 'rgba(91, 141, 239, 0.6)';
        this.isSorting = true;

        try {
            await this.sortByProfitability();
        } finally {
            this.isSorting = false;
            this.sortButton.textContent = this.sortDirection === 'desc' ? 'Sort by Profit ▼' : 'Sort by Profit ▲';
            this.sortButton.style.background = 'rgba(91, 141, 239, 0.2)';
        }
    }

    /**
     * Sort marketplace items by profitability
     */
    async sortByProfitability() {
        const marketItemsContainer = document.querySelector('div[class*="MarketplacePanel_marketItems"]');
        if (!marketItemsContainer) {
            return;
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.itemDetailMap) {
            return;
        }

        // Get all visible item divs
        const itemDivs = Array.from(marketItemsContainer.querySelectorAll('div[class*="Item_itemContainer"]'));
        const visibleItems = itemDivs.filter((div) => div.style.display !== 'none');

        // Store original order on first sort
        if (!this.hasSorted) {
            this.originalOrder = visibleItems.map((div) => {
                const useElement = div.querySelector('use');
                const href = useElement?.getAttribute('href') || '';
                const hrefName = href.split('#')[1] || '';
                return `/items/${hrefName}`;
            });
            this.hasSorted = true;
        }

        // Calculate profits for all items (using cache when available)
        const itemsWithProfit = [];

        for (const itemDiv of visibleItems) {
            const useElement = itemDiv.querySelector('use');
            if (!useElement) {
                itemsWithProfit.push({ element: itemDiv, profit: null, itemHrid: null });
                continue;
            }

            const href = useElement.getAttribute('href');
            if (!href) {
                itemsWithProfit.push({ element: itemDiv, profit: null, itemHrid: null });
                continue;
            }

            const hrefName = href.split('#')[1];
            if (!hrefName) {
                itemsWithProfit.push({ element: itemDiv, profit: null, itemHrid: null });
                continue;
            }

            const itemHrid = `/items/${hrefName}`;

            // Check cache first
            if (this.profitCache.has(itemHrid)) {
                const cachedProfit = this.profitCache.get(itemHrid);
                itemsWithProfit.push({ element: itemDiv, profit: cachedProfit, itemHrid });
                continue;
            }

            // Calculate profit
            const profit = await this.calculateItemProfit(itemHrid, gameData);
            this.profitCache.set(itemHrid, profit);
            itemsWithProfit.push({ element: itemDiv, profit, itemHrid });
        }

        // Sort items
        itemsWithProfit.sort((a, b) => {
            // Items without profit go to the end
            if (a.profit === null && b.profit === null) return 0;
            if (a.profit === null) return 1;
            if (b.profit === null) return -1;

            // Sort by profit
            return this.sortDirection === 'desc' ? b.profit - a.profit : a.profit - b.profit;
        });

        // Reorder DOM elements
        for (const item of itemsWithProfit) {
            marketItemsContainer.appendChild(item.element);

            // Add profit indicator
            this.addProfitIndicator(item.element, item.profit);
        }
    }

    /**
     * Calculate profit for an item
     * @param {string} itemHrid - Item HRID
     * @param {Object} gameData - Game data
     * @returns {Promise<number|null>} Profit per hour or null if not calculable
     */
    async calculateItemProfit(itemHrid, gameData) {
        // Try production profit first (craftable items)
        const productionProfit = await profitCalculator.calculateProfit(itemHrid);
        if (productionProfit && productionProfit.profitPerHour !== undefined) {
            return productionProfit.profitPerHour;
        }

        // Try gathering profit (find action that produces this item)
        const gatheringAction = this.findGatheringAction(itemHrid, gameData);
        if (gatheringAction) {
            const gatheringProfit = await calculateGatheringProfit(gatheringAction);
            if (gatheringProfit && gatheringProfit.profitPerHour !== undefined) {
                return gatheringProfit.profitPerHour;
            }
        }

        return null;
    }

    /**
     * Find gathering action that produces an item
     * @param {string} itemHrid - Item HRID
     * @param {Object} gameData - Game data
     * @returns {string|null} Action HRID or null
     */
    findGatheringAction(itemHrid, gameData) {
        const gatheringTypes = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

        for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (!gatheringTypes.includes(action.type)) {
                continue;
            }

            // Check drop table for this item
            if (action.dropTable) {
                for (const drop of action.dropTable) {
                    if (drop.itemHrid === itemHrid) {
                        return actionHrid;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Add profit indicator to item element
     * @param {HTMLElement} itemDiv - Item container element
     * @param {number|null} profit - Profit per hour or null
     */
    addProfitIndicator(itemDiv, profit) {
        // Remove existing indicator
        const existing = itemDiv.querySelector('.toolasha-profit-indicator');
        if (existing) {
            existing.remove();
        }

        // Create indicator
        const indicator = document.createElement('div');
        indicator.className = 'toolasha-profit-indicator';

        let displayText;
        let color;

        if (profit === null) {
            displayText = '—';
            color = 'rgba(150, 150, 150, 0.8)';
        } else if (profit >= 0) {
            displayText = `+${formatLargeNumber(profit, 0)}`;
            color = profit > 100000 ? '#4CAF50' : profit > 0 ? '#8BC34A' : 'rgba(150, 150, 150, 0.8)';
        } else {
            displayText = formatLargeNumber(profit, 0);
            color = '#F44336';
        }

        indicator.textContent = displayText;
        indicator.style.cssText = `
            position: absolute;
            top: 2px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 9px;
            font-weight: 600;
            color: ${color};
            background: rgba(0, 0, 0, 0.7);
            padding: 1px 3px;
            border-radius: 2px;
            white-space: nowrap;
            pointer-events: none;
            z-index: 10;
        `;

        // Ensure parent has position relative for absolute positioning
        if (getComputedStyle(itemDiv).position === 'static') {
            itemDiv.style.position = 'relative';
        }

        itemDiv.appendChild(indicator);
    }

    /**
     * Reset item order to original
     */
    resetOrder() {
        const marketItemsContainer = document.querySelector('div[class*="MarketplacePanel_marketItems"]');
        if (!marketItemsContainer) {
            return;
        }

        // Remove all profit indicators
        document.querySelectorAll('.toolasha-profit-indicator').forEach((el) => el.remove());

        // Restore original order if we have it
        if (this.originalOrder.length > 0) {
            const itemDivs = Array.from(marketItemsContainer.querySelectorAll('div[class*="Item_itemContainer"]'));

            // Create a map of itemHrid -> element
            const elementMap = new Map();
            for (const div of itemDivs) {
                const useElement = div.querySelector('use');
                const href = useElement?.getAttribute('href') || '';
                const hrefName = href.split('#')[1] || '';
                const itemHrid = `/items/${hrefName}`;
                elementMap.set(itemHrid, div);
            }

            // Reorder based on original order
            for (const itemHrid of this.originalOrder) {
                const element = elementMap.get(itemHrid);
                if (element) {
                    marketItemsContainer.appendChild(element);
                }
            }
        }

        // Clear cache and reset state
        this.profitCache.clear();
        this.originalOrder = [];
        this.hasSorted = false;

        // Reset sort direction
        this.sortDirection = 'desc';
        if (this.sortButton) {
            this.sortButton.textContent = 'Sort by Profit';
        }
    }

    /**
     * Cleanup on disable
     */
    disable() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        // Remove sort UI
        const sortDiv = document.querySelector('#toolasha-market-sort');
        if (sortDiv) {
            sortDiv.remove();
        }

        // Remove profit indicators
        document.querySelectorAll('.toolasha-profit-indicator').forEach((el) => el.remove());

        // Clear cache
        this.profitCache.clear();
        this.originalOrder = [];
        this.hasSorted = false;

        this.isActive = false;
        this.isInitialized = false;
        this.sortButton = null;
    }
}

const marketSort = new MarketSort();

export default marketSort;
