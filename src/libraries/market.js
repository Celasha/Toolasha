/**
 * Market Library
 * Market, inventory, and economy features
 *
 * Exports to: window.Toolasha.Market
 */

// Market features
import tooltipPrices from '../features/market/tooltip-prices.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import tooltipConsumables from '../features/market/tooltip-consumables.js';
import marketFilter from '../features/market/market-filter.js';
import marketSort from '../features/market/market-sort.js';
import autoFillPrice from '../features/market/auto-fill-price.js';
import autoClickMax from '../features/market/auto-click-max.js';
import itemCountDisplay from '../features/market/item-count-display.js';
import listingPriceDisplay from '../features/market/listing-price-display.js';
import estimatedListingAge from '../features/market/estimated-listing-age.js';
import queueLengthEstimator from '../features/market/queue-length-estimator.js';
import marketOrderTotals from '../features/market/market-order-totals.js';
import marketHistoryViewer from '../features/market/market-history-viewer.js';
import philoCalculator from '../features/market/philo-calculator.js';
import tradeHistory from '../features/market/trade-history.js';
import tradeHistoryDisplay from '../features/market/trade-history-display.js';
import networkAlert from '../features/market/network-alert.js';
import profitCalculator from '../features/market/profit-calculator.js';
import alchemyProfitCalculator from '../features/market/alchemy-profit-calculator.js';

// Networth/Economy features
import networthFeature from '../features/networth/index.js';

// Inventory features
import inventoryBadgeManager from '../features/inventory/inventory-badge-manager.js';
import inventorySort from '../features/inventory/inventory-sort.js';
import inventoryBadgePrices from '../features/inventory/inventory-badge-prices.js';
import dungeonTokenTooltips from '../features/inventory/dungeon-token-tooltips.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.Market = {
    tooltipPrices,
    expectedValueCalculator,
    tooltipConsumables,
    marketFilter,
    marketSort,
    autoFillPrice,
    autoClickMax,
    itemCountDisplay,
    listingPriceDisplay,
    estimatedListingAge,
    queueLengthEstimator,
    marketOrderTotals,
    marketHistoryViewer,
    philoCalculator,
    tradeHistory,
    tradeHistoryDisplay,
    networkAlert,
    profitCalculator,
    alchemyProfitCalculator,
    networthFeature,
    inventoryBadgeManager,
    inventorySort,
    inventoryBadgePrices,
    dungeonTokenTooltips,
};

console.log('[Toolasha] Market library loaded');
