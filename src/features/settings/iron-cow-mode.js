/**
 * Iron Cow Mode
 * Force-disables and locks all market/profit-related settings for players
 * who have no marketplace access.
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import { settingsGroups } from '../../core/settings-schema.js';
import dataManager from '../../core/data-manager.js';

/**
 * The complete set of setting IDs that are force-disabled in Iron Cow mode.
 */
export const IRON_COW_SETTINGS = new Set([
    // Market UI (all market_* keys + related)
    'networkAlert',
    'marketFilter',
    'marketSort',
    'fillMarketOrderPrice',
    'market_autoFillSellStrategy',
    'market_autoFillBuyStrategy',
    'market_autoClickMax',
    'market_quickInputButtons',
    'market_marketplaceShortcuts',
    'market_visibleItemCount',
    'market_visibleItemCountOpacity',
    'market_visibleItemCountIncludeEquipped',
    'market_showListingPrices',
    'market_tradeHistory',
    'market_tradeHistoryComparisonMode',
    'market_listingPricePrecision',
    'market_showListingAge',
    'market_showTopOrderAge',
    'market_showEstimatedListingAge',
    'market_listingAgeFormat',
    'market_listingTimeFormat',
    'market_listingDateFormat',
    'market_showOrderTotals',
    'market_showHistoryViewer',
    'market_showPhiloCalculator',
    'market_showQueueLength',
    // Profit / pricing calculations
    'profitCalc_pricingMode',
    'profitCalc_pricingNaming',
    'actionPanel_showProfitPerHour_gathering',
    'actionPanel_showProfitPerHour_production',
    'actionPanel_showProfitDetail',
    'actionPanel_foragingTotal',
    'actionPanel_hideNegativeProfit',
    'actionQueue_showValue',
    'actionQueue_valueMode',
    'alchemy_profitDisplay',
    'itemTooltip_profit',
    'itemTooltip_detailedProfit',
    'itemTooltip_multiActionProfit',
    'taskProfitCalculator',
    'profitCalc_keyPricingMode', // Prices in tooltips / UI
    'itemTooltip_prices',
    'itemTooltip_expectedValue',
    'expectedValue_showDrops',
    'expectedValue_respectPricingMode',
    'labyrinthShopPrices',
    // Inventory value display
    'invWorth',
    'invBadgePrices',
    'invCategoryTotals',
    'invSort_showBadges',
    'invSort_badgesOnNone',
    'invSort_netOfTax',
    // Net worth
    'networth',
    'networth_highEnhancementUseCost',
    'networth_highEnhancementMinLevel',
    'networth_historyChart',
    'networth_includeCowbells',
    'networth_includeTaskTokens',
    'networth_abilityBooksAsInventory',
    // Missing materials marketplace button
    'actions_missingMaterialsButton',
    'actions_missingMaterialsButton_ignoreQueue',
    // Color settings for market-only UI elements
    'color_invBadge_ask',
    'color_invBadge_bid',
    'color_queueLength_known',
    'color_queueLength_estimated',
]);

/**
 * Returns the forced-off value for a setting when Iron Cow mode is enabled.
 * Checkboxes → false, sliders → 0, everything else → schema default.
 * @param {string} settingId
 * @returns {*}
 */
function getIronCowDisabledValue(settingId) {
    for (const group of Object.values(settingsGroups)) {
        const def = group.settings[settingId];
        if (!def) continue;
        const type = def.type || 'checkbox';
        if (type === 'checkbox') return false;
        if (type === 'slider') return 0;
        return def.default ?? ''; // select / number / color → schema default
    }
    return false;
}

class IronCowMode {
    /**
     * Per-character snapshot storage key.
     * @returns {string}
     */
    _snapshotKey() {
        const cid = dataManager.getCurrentCharacterId?.();
        return cid ? `toolasha_ironCowSnapshot_${cid}` : 'toolasha_ironCowSnapshot';
    }

    /**
     * Whether Iron Cow mode is currently enabled.
     * @returns {boolean}
     */
    isEnabled() {
        return config.getSetting('ironCow_enabled');
    }

    /**
     * Enable Iron Cow mode.
     * Saves a snapshot of current values then force-disables every affected setting.
     * @returns {Promise<void>}
     */
    async enable() {
        // 1. Save snapshot of current values before forcing them off
        const snapshot = {};
        for (const id of IRON_COW_SETTINGS) {
            const entry = config.settingsMap[id];
            if (!entry) continue;
            snapshot[id] =
                entry.type === 'checkbox'
                    ? { type: 'checkbox', value: entry.isTrue ?? false }
                    : { type: entry.type, value: entry.value };
        }
        await storage.setJSON(this._snapshotKey(), snapshot, 'settings', true);

        // 2. Force-disable each setting (fires onSettingChange callbacks automatically)
        for (const id of IRON_COW_SETTINGS) {
            const entry = config.settingsMap[id];
            if (!entry) continue;
            const val = getIronCowDisabledValue(id);
            if (entry.type === 'checkbox') {
                config.setSetting(id, val);
            } else {
                config.setSettingValue(id, val);
            }
        }
    }

    /**
     * Disable Iron Cow mode.
     * Restores each setting to its pre-Iron-Cow value from the snapshot.
     * @returns {Promise<void>}
     */
    async disable() {
        const snapshot = await storage.getJSON(this._snapshotKey(), 'settings', null);
        if (snapshot) {
            for (const [id, entry] of Object.entries(snapshot)) {
                if (!IRON_COW_SETTINGS.has(id)) continue;
                const configEntry = config.settingsMap[id];
                if (!configEntry) continue;
                if (entry.type === 'checkbox') {
                    config.setSetting(id, entry.value);
                } else {
                    config.setSettingValue(id, entry.value);
                }
            }
        }
        await storage.delete(this._snapshotKey(), 'settings');
    }
}

const ironCowMode = new IronCowMode();
export default ironCowMode;
