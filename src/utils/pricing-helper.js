/**
 * Pricing Helper Utility
 * Shared logic for selecting market prices based on pricing mode settings
 */

import config from '../core/config.js';

/**
 * Select appropriate price from market data based on pricing mode settings
 * @param {Object} priceData - Market price data with bid/ask properties
 * @param {string} modeSetting - Config setting key for pricing mode (default: 'profitCalc_pricingMode')
 * @param {string} respectSetting - Config setting key for respect pricing mode flag (default: 'expectedValue_respectPricingMode')
 * @returns {number} Selected price (bid or ask)
 */
export function selectPrice(priceData, modeSetting = 'profitCalc_pricingMode', respectSetting = 'expectedValue_respectPricingMode') {
    if (!priceData) return 0;

    const pricingMode = config.getSettingValue(modeSetting, 'conservative');
    const respectPricingMode = config.getSettingValue(respectSetting, true);

    // If not respecting mode or mode is conservative, always use bid
    if (!respectPricingMode || pricingMode === 'conservative') {
        return priceData.bid || 0;
    }

    // Hybrid/Optimistic: Use ask
    return priceData.ask || 0;
}

/**
 * Apply market tax to a price
 * @param {number} price - Price before tax
 * @param {number} taxRate - Tax rate (default: 0.02 for 2%)
 * @returns {number} Price after tax
 */
export function applyMarketTax(price, taxRate = 0.02) {
    return price * (1 - taxRate);
}
