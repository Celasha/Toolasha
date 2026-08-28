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
import collectableListingsSort from '../features/market/collectable-listings-sort.js';
import estimatedListingAge from '../features/market/estimated-listing-age.js';
import queueLengthEstimator from '../features/market/queue-length-estimator.js';
import marketDepthCap from '../features/market/market-depth-cap.js';
import marketOrderTotals from '../features/market/market-order-totals.js';
import marketHistoryViewer from '../features/market/market-history-viewer.js';
import listingRefreshNavigator from '../features/market/listing-refresh-navigator.js';
import listingNextNavigator from '../features/market/listing-next-navigator.js';
import philoCalculator from '../features/market/philo-calculator.js';
import tradeHistory from '../features/market/trade-history.js';
import tradeHistoryDisplay from '../features/market/trade-history-display.js';
import networkAlert from '../features/market/network-alert.js';
import profitCalculator from '../features/market/profit-calculator.js';
import alchemyProfitCalculator from '../features/market/alchemy-profit-calculator.js';
import marketplaceShortcuts from '../features/market/marketplace-shortcuts.js';
import sellQueue from '../features/market/sell-queue.js';

// Networth/Economy features
import networthFeature from '../features/networth/index.js';

// Offline Progress features
import offlineProgressEconomics from '../features/offline-progress/offline-progress-economics.js';

// Inventory features
import inventoryBadgeManager from '../features/inventory/inventory-badge-manager.js';
import inventorySort from '../features/inventory/inventory-sort.js';
import inventoryBadgePrices from '../features/inventory/inventory-badge-prices.js';
import dungeonTokenTooltips from '../features/inventory/dungeon-token-tooltips.js';
import autoAllButton from '../features/inventory/auto-all-button.js';
import inventoryCategoryTotals from '../features/inventory/inventory-category-totals.js';
import customTabsFeature from '../features/inventory/custom-tabs/custom-tabs-feature.js';
import openableAnalytics from '../features/inventory/openable-analytics/openable-analytics.js';

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
    collectableListingsSort,
    estimatedListingAge,
    queueLengthEstimator,
    marketDepthCap,
    marketOrderTotals,
    marketHistoryViewer,
    listingRefreshNavigator,
    listingNextNavigator,
    philoCalculator,
    tradeHistory,
    tradeHistoryDisplay,
    networkAlert,
    profitCalculator,
    alchemyProfitCalculator,
    networthFeature,
    offlineProgressEconomics,
    inventoryBadgeManager,
    inventorySort,
    inventoryBadgePrices,
    dungeonTokenTooltips,
    autoAllButton,
    inventoryCategoryTotals,
    customTabsFeature,
    openableAnalytics,
    marketplaceShortcuts,
    sellQueue,
};

console.log('[Toolasha] Market library loaded');
