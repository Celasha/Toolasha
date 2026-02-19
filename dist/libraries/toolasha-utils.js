/**
 * Toolasha Utils Library
 * All utility modules
 * Version: 1.0.0
 * License: CC-BY-NC-SA-4.0
 */

(function (config, domObserver, marketAPI, dataManager) {
    'use strict';

    window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";

    /**
     * Formatting Utilities
     * Pure functions for formatting numbers and time
     */


    /**
     * Format numbers with thousand separators
     * @param {number} num - The number to format
     * @param {number} digits - Number of decimal places (default: 0 for whole numbers)
     * @returns {string} Formatted number (e.g., "1,500", "1,500,000")
     *
     * @example
     * numberFormatter(1500) // "1,500"
     * numberFormatter(1500000) // "1,500,000"
     * numberFormatter(1500.5, 1) // "1,500.5"
     */
    function numberFormatter(num, digits = 0) {
        if (num === null || num === undefined) {
            return null;
        }

        // Round to specified decimal places
        const rounded = digits > 0 ? num.toFixed(digits) : Math.round(num);

        // Format with thousand separators
        return new Intl.NumberFormat().format(rounded);
    }

    /**
     * Convert seconds to human-readable time format
     * @param {number} sec - Seconds to convert
     * @returns {string} Formatted time (e.g., "1h 23m 45s" or "3 years 5 months 3 days")
     *
     * @example
     * timeReadable(3661) // "1h 01m 01s"
     * timeReadable(90000) // "1 day"
     * timeReadable(31536000) // "1 year"
     * timeReadable(100000000) // "3 years 2 months 3 days"
     */
    function timeReadable(sec) {
        // For times >= 1 year, show in years/months/days
        if (sec >= 31536000) {
            // 365 days
            const years = Math.floor(sec / 31536000);
            const remainingAfterYears = sec - years * 31536000;
            const months = Math.floor(remainingAfterYears / 2592000); // 30 days
            const remainingAfterMonths = remainingAfterYears - months * 2592000;
            const days = Math.floor(remainingAfterMonths / 86400);

            const parts = [];
            if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
            if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
            if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

            return parts.join(' ');
        }

        // For times >= 1 day, show in days/hours/minutes
        if (sec >= 86400) {
            const days = Math.floor(sec / 86400);
            const remainingAfterDays = sec - days * 86400;
            const hours = Math.floor(remainingAfterDays / 3600);
            const remainingAfterHours = remainingAfterDays - hours * 3600;
            const minutes = Math.floor(remainingAfterHours / 60);

            const parts = [];
            if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);

            return parts.join(' ');
        }

        // For times < 1 day, show as HH:MM:SS
        const d = new Date(Math.round(sec * 1000));
        function pad(i) {
            return ('0' + i).slice(-2);
        }

        const hours = d.getUTCHours();
        const minutes = d.getUTCMinutes();
        const seconds = d.getUTCSeconds();

        // For times < 1 minute, just show seconds
        if (hours === 0 && minutes === 0) {
            return seconds + 's';
        }

        const str = hours + 'h ' + pad(minutes) + 'm ' + pad(seconds) + 's';
        return str;
    }

    /**
     * Format a number with thousand separators based on locale
     * @param {number} num - The number to format
     * @returns {string} Formatted number with separators
     *
     * @example
     * formatWithSeparator(1000000) // "1,000,000" (US locale)
     */
    function formatWithSeparator(num) {
        return new Intl.NumberFormat().format(num);
    }

    /**
     * Format large numbers in K/M/B notation
     * @param {number} num - The number to format
     * @param {number} decimals - Number of decimal places (default: 1)
     * @returns {string} Formatted number (e.g., "1.5K", "2.3M", "1.2B")
     *
     * @example
     * formatKMB(1500) // "1.5K"
     * formatKMB(2300000) // "2.3M"
     * formatKMB(1234567890) // "1.2B"
     */
    function formatKMB(num, decimals = 1) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        if (absNum >= 1e9) {
            return sign + (absNum / 1e9).toFixed(decimals) + 'B';
        } else if (absNum >= 1e6) {
            return sign + (absNum / 1e6).toFixed(decimals) + 'M';
        } else if (absNum >= 1e3) {
            return sign + (absNum / 1e3).toFixed(decimals) + 'K';
        } else {
            return sign + absNum.toFixed(0);
        }
    }

    /**
     * Format large numbers in K/M/B notation with 3 significant digits
     * @param {number} num - The number to format
     * @returns {string} Formatted number (e.g., "999", "1.25K", "82.1K", "825K", "1.25M")
     *
     * Handles rounding edge cases properly:
     * - 9999 rounds to "10.0K" (not "10.00K")
     * - 99999 rounds to "100K" (not "100.0K")
     * - 999999 promotes to "1.00M" (not "1000K")
     *
     * @example
     * formatKMB3Digits(999) // "999"
     * formatKMB3Digits(1250) // "1.25K"
     * formatKMB3Digits(8210) // "8.21K"
     * formatKMB3Digits(9999) // "10.0K"
     * formatKMB3Digits(82100) // "82.1K"
     * formatKMB3Digits(99999) // "100K"
     * formatKMB3Digits(825000) // "825K"
     * formatKMB3Digits(999999) // "1.00M"
     * formatKMB3Digits(1250000) // "1.25M"
     * formatKMB3Digits(82300000) // "82.3M"
     */
    function formatKMB3Digits(num) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        if (absNum >= 1e9) {
            const value = absNum / 1e9;
            // Round to 2 decimals first to check actual display value
            const rounded = parseFloat(value.toFixed(2));
            let decimals = 2;
            if (rounded >= 100) decimals = 0;
            else if (rounded >= 10) decimals = 1;
            return sign + value.toFixed(decimals) + 'B';
        } else if (absNum >= 1e6) {
            const value = absNum / 1e6;
            const rounded = parseFloat(value.toFixed(2));
            if (rounded >= 1000) {
                // Promote to B (e.g., 999999999 -> 1.00B not 1000M)
                return sign + (value / 1000).toFixed(2) + 'B';
            }
            let decimals = 2;
            if (rounded >= 100) decimals = 0;
            else if (rounded >= 10) decimals = 1;
            return sign + value.toFixed(decimals) + 'M';
        } else if (absNum >= 1e3) {
            const value = absNum / 1e3;
            const rounded = parseFloat(value.toFixed(2));
            if (rounded >= 1000) {
                // Promote to M (e.g., 999999 -> 1.00M not 1000K)
                return sign + (value / 1000).toFixed(2) + 'M';
            }
            let decimals = 2;
            if (rounded >= 100) decimals = 0;
            else if (rounded >= 10) decimals = 1;
            return sign + value.toFixed(decimals) + 'K';
        } else {
            return sign + Math.floor(absNum).toString();
        }
    }

    /**
     * Format numbers using game-style coin notation (4-digit maximum display)
     * @param {number} num - The number to format
     * @returns {string} Formatted number (e.g., "999", "1,000", "10K", "9,999K", "10M")
     *
     * Game formatting rules (4-digit bounded notation):
     * - 0-999: Raw number (no formatting)
     * - 1,000-9,999: Comma format
     * - 10,000-9,999,999: K suffix (10K to 9,999K)
     * - 10,000,000-9,999,999,999: M suffix (10M to 9,999M)
     * - 10,000,000,000-9,999,999,999,999: B suffix (10B to 9,999B)
     * - 10,000,000,000,000+: T suffix (10T+)
     *
     * Key rule: Display never exceeds 4 numeric digits. When a 5th digit is needed,
     * promote to the next unit (K→M→B→T).
     *
     * @example
     * coinFormatter(999) // "999"
     * coinFormatter(1000) // "1,000"
     * coinFormatter(9999) // "9,999"
     * coinFormatter(10000) // "10K"
     * coinFormatter(999999) // "999K"
     * coinFormatter(1000000) // "1,000K"
     * coinFormatter(9999999) // "9,999K"
     * coinFormatter(10000000) // "10M"
     */
    function coinFormatter(num) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        // 0-999: raw number
        if (absNum < 1000) {
            return sign + Math.floor(absNum).toString();
        }
        // 1,000-9,999: comma format
        if (absNum < 10000) {
            return sign + new Intl.NumberFormat().format(Math.floor(absNum));
        }
        // 10K-9,999K (10,000 to 9,999,999)
        if (absNum < 10000000) {
            const val = Math.floor(absNum / 1000);
            const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
            return sign + formatted + 'K';
        }
        // 10M-9,999M (10,000,000 to 9,999,999,999)
        if (absNum < 10000000000) {
            const val = Math.floor(absNum / 1000000);
            const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
            return sign + formatted + 'M';
        }
        // 10B-9,999B (10,000,000,000 to 9,999,999,999,999)
        if (absNum < 10000000000000) {
            const val = Math.floor(absNum / 1000000000);
            const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
            return sign + formatted + 'B';
        }
        // 10T+ (10,000,000,000,000+)
        const val = Math.floor(absNum / 1000000000000);
        const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
        return sign + formatted + 'T';
    }

    /**
     * Format milliseconds as relative time
     * @param {number} ageMs - Age in milliseconds
     * @returns {string} Formatted relative time (e.g., "5m", "2h 30m", "3d 12h", "14d")
     *
     * @example
     * formatRelativeTime(30000) // "Just now" (< 1 min)
     * formatRelativeTime(300000) // "5m" (5 minutes)
     * formatRelativeTime(7200000) // "2h 0m" (2 hours)
     * formatRelativeTime(93600000) // "1d 2h" (26 hours)
     * formatRelativeTime(864000000) // "10d" (10 days)
     * formatRelativeTime(2678400000) // "30+ days" (31 days)
     */
    function formatRelativeTime(ageMs) {
        const minutes = Math.floor(ageMs / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        // Edge cases
        if (minutes < 1) return 'Just now';
        if (days > 30) return '30+ days';

        // Format based on age
        if (days > 7) return `${days}d`;
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
    }

    /**
     * Format numbers for networth display with decimal precision
     * Uses 2 decimal places for better readability in detailed breakdowns
     * @param {number} num - The number to format
     * @returns {string} Formatted number (e.g., "1.23K", "45.67M", "89.01B")
     *
     * @example
     * networthFormatter(1234) // "1.23K"
     * networthFormatter(45678) // "45.68K"
     * networthFormatter(1234567) // "1.23M"
     * networthFormatter(89012345) // "89.01M"
     * networthFormatter(1234567890) // "1.23B"
     */
    function networthFormatter(num) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        // 0-999: raw number (no decimals needed)
        if (absNum < 1000) {
            return sign + Math.floor(absNum).toString();
        }
        // 1,000-999,999: K with 2 decimals
        if (absNum < 1000000) {
            return sign + (absNum / 1000).toFixed(2) + 'K';
        }
        // 1M-999,999,999: M with 2 decimals
        if (absNum < 1000000000) {
            return sign + (absNum / 1000000).toFixed(2) + 'M';
        }
        // 1B+: B with 2 decimals
        return sign + (absNum / 1000000000).toFixed(2) + 'B';
    }

    /**
     * Format a decimal value as a percentage
     * @param {number} value - The decimal value to format (e.g., 0.05 for 5%)
     * @param {number} decimals - Number of decimal places (default: 1)
     * @returns {string} Formatted percentage (e.g., "5.0%", "12.5%")
     *
     * @example
     * formatPercentage(0.05) // "5.0%"
     * formatPercentage(0.125, 1) // "12.5%"
     * formatPercentage(0.00123, 2) // "0.12%"
     * formatPercentage(0.00123, 3) // "0.123%"
     */
    function formatPercentage(value, decimals = 1) {
        if (value === null || value === undefined) {
            return null;
        }

        const percentage = value * 100;
        const formatted = new Intl.NumberFormat(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(percentage);

        return formatted + '%';
    }

    /**
     * Format currency/coin amounts intelligently based on context
     * @param {number} amount - The amount to format
     * @param {Object} options - Formatting options
     * @param {string} options.style - 'game' (4-digit), 'compact' (K/M/B), 'full' (thousand separators), 'networth' (2 decimals)
     * @param {number} options.decimals - Decimal places for compact style (default: 1)
     * @returns {string} Formatted currency string
     *
     * @example
     * formatCurrency(1500, {style: 'game'}) // "1,500"
     * formatCurrency(1500000, {style: 'game'}) // "1,500K"
     * formatCurrency(1500000, {style: 'compact'}) // "1.5M"
     * formatCurrency(1500000, {style: 'full'}) // "1,500,000"
     * formatCurrency(1234, {style: 'networth'}) // "1.23K"
     */
    function formatCurrency(amount, options = {}) {
        const style = options.style || 'game';
        const decimals = options.decimals !== undefined ? options.decimals : 1;

        switch (style) {
            case 'game':
                return coinFormatter(amount);
            case 'compact':
                return formatKMB(amount, decimals);
            case 'networth':
                return networthFormatter(amount);
            case 'full':
                return formatWithSeparator(amount);
            default:
                return coinFormatter(amount);
        }
    }

    /**
     * Format numbers in compact notation (K/M/B)
     * Alias for formatKMB for clearer naming
     * @param {number} value - The number to format
     * @param {number} decimals - Number of decimal places (default: 1)
     * @returns {string} Formatted number (e.g., "1.5K", "2.3M", "1.2B")
     *
     * @example
     * formatCompactNumber(1500) // "1.5K"
     * formatCompactNumber(2300000) // "2.3M"
     * formatCompactNumber(1234567890) // "1.2B"
     */
    function formatCompactNumber(value, decimals = 1) {
        return formatKMB(value, decimals);
    }

    /**
     * Format large numbers based on user preference
     * Uses K/M/B notation or full numbers depending on setting
     * @param {number} value - The number to format
     * @param {number} decimals - Number of decimal places for K/M/B format (default: 1)
     * @returns {string} Formatted number (e.g., "1.5M" or "1,500,000")
     *
     * @example
     * // With K/M/B enabled (default)
     * formatLargeNumber(1500000) // "1.5M"
     * formatLargeNumber(2300) // "2.3K"
     *
     * // With K/M/B disabled
     * formatLargeNumber(1500000) // "1,500,000"
     * formatLargeNumber(2300) // "2,300"
     */
    function formatLargeNumber(value, decimals = 1) {
        const useAbbreviations = config.getSetting('formatting_useKMBFormat') !== false;
        return useAbbreviations ? formatKMB(value, decimals) : formatWithSeparator(value);
    }

    var formatters = /*#__PURE__*/Object.freeze({
        __proto__: null,
        coinFormatter: coinFormatter,
        formatCompactNumber: formatCompactNumber,
        formatCurrency: formatCurrency,
        formatKMB: formatKMB,
        formatKMB3Digits: formatKMB3Digits,
        formatLargeNumber: formatLargeNumber,
        formatPercentage: formatPercentage,
        formatRelativeTime: formatRelativeTime,
        formatWithSeparator: formatWithSeparator,
        networthFormatter: networthFormatter,
        numberFormatter: numberFormatter,
        timeReadable: timeReadable
    });

    /**
     * Efficiency Utilities Module
     * Calculations for efficiency stacking and breakdowns
     */

    /**
     * Stack additive bonuses (most game bonuses)
     * @param {number[]} bonuses - Array of bonus percentages
     * @returns {number} Total stacked bonus percentage
     *
     * @example
     * stackAdditive([10, 20, 5])
     * // Returns: 35
     * // Because: 10% + 20% + 5% = 35%
     */
    function stackAdditive(...bonuses) {
        return bonuses.reduce((total, bonus) => total + bonus, 0);
    }

    /**
     * Calculate efficiency multiplier from efficiency percentage
     * Efficiency gives bonus action completions per time-consuming action
     *
     * @param {number} efficiencyPercent - Efficiency as percentage (e.g., 150 for 150%)
     * @returns {number} Multiplier (e.g., 2.5 for 150% efficiency)
     *
     * @example
     * calculateEfficiencyMultiplier(0)   // Returns 1.0 (no bonus)
     * calculateEfficiencyMultiplier(50)  // Returns 1.5
     * calculateEfficiencyMultiplier(150) // Returns 2.5
     */
    function calculateEfficiencyMultiplier(efficiencyPercent) {
        return 1 + (efficiencyPercent || 0) / 100;
    }

    /**
     * Calculate efficiency breakdown from supplied sources
     * @param {Object} params - Efficiency inputs
     * @param {number} params.requiredLevel - Action required level
     * @param {number} params.skillLevel - Player skill level
     * @param {number} [params.teaSkillLevelBonus=0] - Bonus skill levels from tea
     * @param {number} [params.actionLevelBonus=0] - Action level bonus from tea (affects requirement)
     * @param {number} [params.houseEfficiency=0] - House room efficiency bonus
     * @param {number} [params.equipmentEfficiency=0] - Equipment efficiency bonus
     * @param {number} [params.teaEfficiency=0] - Tea efficiency bonus
     * @param {number} [params.communityEfficiency=0] - Community buff efficiency bonus
     * @param {number} [params.achievementEfficiency=0] - Achievement efficiency bonus
     * @returns {Object} Efficiency breakdown
     */
    function calculateEfficiencyBreakdown({
        requiredLevel,
        skillLevel,
        teaSkillLevelBonus = 0,
        actionLevelBonus = 0,
        houseEfficiency = 0,
        equipmentEfficiency = 0,
        teaEfficiency = 0,
        communityEfficiency = 0,
        achievementEfficiency = 0,
    }) {
        const effectiveRequirement = (requiredLevel || 0) + actionLevelBonus;
        const baseSkillLevel = Math.max(skillLevel || 0, requiredLevel || 0);
        const effectiveLevel = baseSkillLevel + teaSkillLevelBonus;
        const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
        const totalEfficiency = stackAdditive(
            levelEfficiency,
            houseEfficiency,
            equipmentEfficiency,
            teaEfficiency,
            communityEfficiency,
            achievementEfficiency
        );

        return {
            totalEfficiency,
            levelEfficiency,
            effectiveRequirement,
            effectiveLevel,
            breakdown: {
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                communityEfficiency,
                achievementEfficiency,
                actionLevelBonus,
                teaSkillLevelBonus,
            },
        };
    }

    var efficiency = {
        stackAdditive,
        calculateEfficiencyMultiplier,
        calculateEfficiencyBreakdown,
    };

    var efficiency$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateEfficiencyBreakdown: calculateEfficiencyBreakdown,
        calculateEfficiencyMultiplier: calculateEfficiencyMultiplier,
        default: efficiency,
        stackAdditive: stackAdditive
    });

    /**
     * Profit Calculation Constants
     * Shared constants used across profit calculators
     */

    /**
     * Marketplace tax rate (2%)
     */
    const MARKET_TAX = 0.02;

    /**
     * Base drink consumption rate per hour (before Drink Concentration)
     */
    const DRINKS_PER_HOUR_BASE = 12;

    /**
     * Seconds per hour (for rate conversions)
     */
    const SECONDS_PER_HOUR = 3600;

    /**
     * Hours per day (for daily profit calculations)
     */
    const HOURS_PER_DAY = 24;

    /**
     * Gathering skill action types
     * Skills that gather raw materials from the world
     */
    const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

    /**
     * Production skill action types
     * Skills that craft items from materials
     */
    const PRODUCTION_TYPES = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * All non-combat skill action types
     */
    const ALL_SKILL_TYPES = [...GATHERING_TYPES, ...PRODUCTION_TYPES];

    var profitConstants = {
        MARKET_TAX,
        DRINKS_PER_HOUR_BASE,
        SECONDS_PER_HOUR,
        HOURS_PER_DAY,
        GATHERING_TYPES,
        PRODUCTION_TYPES,
        ALL_SKILL_TYPES,
    };

    var profitConstants$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        ALL_SKILL_TYPES: ALL_SKILL_TYPES,
        DRINKS_PER_HOUR_BASE: DRINKS_PER_HOUR_BASE,
        GATHERING_TYPES: GATHERING_TYPES,
        HOURS_PER_DAY: HOURS_PER_DAY,
        MARKET_TAX: MARKET_TAX,
        PRODUCTION_TYPES: PRODUCTION_TYPES,
        SECONDS_PER_HOUR: SECONDS_PER_HOUR,
        default: profitConstants
    });

    /**
     * Profit Calculation Helpers
     * Pure functions for profit/rate calculations used across features
     *
     * These functions consolidate duplicated calculations from:
     * - profit-calculator.js
     * - gathering-profit.js
     * - task-profit-calculator.js
     * - action-time-display.js
     * - tooltip-prices.js
     */


    /**
     * Calculate actions per hour from action time
     * @param {number} actionTimeSeconds - Time per action in seconds
     * @returns {number} Actions per hour (0 if invalid input)
     *
     * @example
     * calculateActionsPerHour(6) // Returns 600 (3600 / 6)
     * calculateActionsPerHour(0) // Returns 0 (invalid)
     */
    function calculateActionsPerHour(actionTimeSeconds) {
        if (!actionTimeSeconds || actionTimeSeconds <= 0) {
            return 0;
        }
        return SECONDS_PER_HOUR / actionTimeSeconds;
    }

    /**
     * Calculate effective actions per hour after efficiency
     * @param {number} actionsPerHour - Base actions per hour (without efficiency)
     * @param {number} [efficiencyMultiplier=1] - Efficiency multiplier (1 + efficiencyPercent/100)
     * @returns {number} Effective actions per hour (0 if invalid input)
     *
     * @example
     * calculateEffectiveActionsPerHour(600, 1.2) // Returns 720
     */
    function calculateEffectiveActionsPerHour(actionsPerHour, efficiencyMultiplier = 1) {
        if (!actionsPerHour || actionsPerHour <= 0) {
            return 0;
        }
        if (!efficiencyMultiplier || efficiencyMultiplier <= 0) {
            return 0;
        }
        return actionsPerHour * efficiencyMultiplier;
    }

    /**
     * Calculate hours needed for a number of actions
     * @param {number} actionCount - Number of queued actions
     * @param {number} actionsPerHour - Actions per hour rate
     * @returns {number} Hours needed (0 if invalid input)
     *
     * @example
     * calculateHoursForActions(600, 600) // Returns 1
     * calculateHoursForActions(1200, 600) // Returns 2
     */
    function calculateHoursForActions(actionCount, actionsPerHour) {
        if (!actionsPerHour || actionsPerHour <= 0) {
            return 0;
        }
        return actionCount / actionsPerHour;
    }

    /**
     * Calculate seconds needed for a number of actions
     * @param {number} actionCount - Number of queued actions
     * @param {number} actionsPerHour - Actions per hour rate
     * @returns {number} Seconds needed (0 if invalid input)
     *
     * @example
     * calculateSecondsForActions(100, 600) // Returns 600 (100/600 * 3600)
     */
    function calculateSecondsForActions(actionCount, actionsPerHour) {
        return calculateHoursForActions(actionCount, actionsPerHour) * SECONDS_PER_HOUR;
    }

    /**
     * Calculate profit per action from hourly profit data
     *
     * IMPORTANT: This assumes profitPerHour already includes efficiency.
     * The formula works because:
     * - profitPerHour = actionsPerHour × efficiencyMultiplier × profitPerItem
     * - profitPerHour / actionsPerHour = efficiencyMultiplier × profitPerItem
     * - This gives profit per ATTEMPT (what the queue shows)
     *
     * @param {number} profitPerHour - Profit per hour (includes efficiency)
     * @param {number} actionsPerHour - Base actions per hour (without efficiency)
     * @returns {number} Profit per action (0 if invalid input)
     *
     * @example
     * // With 150% efficiency (2.5x), 600 actions/hr, 50 profit/item:
     * // profitPerHour = 600 × 2.5 × 50 = 75,000
     * calculateProfitPerAction(75000, 600) // Returns 125 (profit per action)
     */
    function calculateProfitPerAction(profitPerHour, actionsPerHour) {
        if (!actionsPerHour || actionsPerHour <= 0) {
            return 0;
        }
        return profitPerHour / actionsPerHour;
    }

    /**
     * Calculate total profit for a number of actions
     *
     * @param {number} profitPerHour - Profit per hour (includes efficiency)
     * @param {number} actionsPerHour - Base actions per hour (without efficiency)
     * @param {number} actionCount - Number of queued actions
     * @returns {number} Total profit (0 if invalid input)
     *
     * @example
     * // Queue shows "Produce 100 times" with 75,000 profit/hr and 600 actions/hr
     * calculateTotalProfitForActions(75000, 600, 100) // Returns 12,500
     */
    function calculateTotalProfitForActions(profitPerHour, actionsPerHour, actionCount) {
        const profitPerAction = calculateProfitPerAction(profitPerHour, actionsPerHour);
        return profitPerAction * actionCount;
    }

    /**
     * Calculate profit per day from hourly profit
     * @param {number} profitPerHour - Profit per hour
     * @returns {number} Profit per day
     *
     * @example
     * calculateProfitPerDay(10000) // Returns 240,000
     */
    function calculateProfitPerDay(profitPerHour) {
        return profitPerHour * HOURS_PER_DAY;
    }

    /**
     * Calculate drink consumption rate with Drink Concentration
     * @param {number} drinkConcentration - Drink Concentration stat as decimal (e.g., 0.15 for 15%)
     * @returns {number} Drinks consumed per hour
     *
     * @example
     * calculateDrinksPerHour(0)    // Returns 12 (base rate)
     * calculateDrinksPerHour(0.15) // Returns 13.8 (12 × 1.15)
     */
    function calculateDrinksPerHour(drinkConcentration = 0) {
        return DRINKS_PER_HOUR_BASE * (1 + drinkConcentration);
    }

    /**
     * Calculate tea consumption costs per hour
     * @param {Object} params - Tea cost inputs
     * @param {Array} params.drinkSlots - Equipped drink slots
     * @param {number} params.drinkConcentration - Drink Concentration stat as decimal
     * @param {Object} params.itemDetailMap - Item detail map for names
     * @param {Function} params.getItemPrice - Price resolver function
     * @returns {Object} Tea costs breakdown
     */
    function calculateTeaCostsPerHour({
        drinkSlots = [],
        drinkConcentration = 0,
        itemDetailMap = {},
        getItemPrice,
    }) {
        if (!Array.isArray(drinkSlots) || drinkSlots.length === 0) {
            return {
                costs: [],
                totalCostPerHour: 0,
                hasMissingPrices: false,
                drinksPerHour: calculateDrinksPerHour(drinkConcentration),
            };
        }

        const drinksPerHour = calculateDrinksPerHour(drinkConcentration);

        const costs = drinkSlots.reduce((entries, drink) => {
            if (!drink || !drink.itemHrid) {
                return entries;
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            const itemName = itemDetails?.name || 'Unknown';
            const price =
                typeof getItemPrice === 'function'
                    ? getItemPrice(drink.itemHrid, { context: 'profit', side: 'buy' })
                    : null;
            const isPriceMissing = price === null;
            const resolvedPrice = isPriceMissing ? 0 : price;
            const totalCost = resolvedPrice * drinksPerHour;

            entries.push({
                itemHrid: drink.itemHrid,
                itemName,
                pricePerDrink: resolvedPrice,
                drinksPerHour,
                totalCost,
                missingPrice: isPriceMissing,
            });

            return entries;
        }, []);

        const totalCostPerHour = costs.reduce((sum, entry) => sum + entry.totalCost, 0);
        const hasMissingPrices = costs.some((entry) => entry.missingPrice);

        return {
            costs,
            totalCostPerHour,
            hasMissingPrices,
            drinksPerHour,
        };
    }

    /**
     * Calculate price after marketplace tax
     * @param {number} price - Price before tax
     * @param {number} [taxRate=MARKET_TAX] - Tax rate (e.g., 0.02 for 2%)
     * @returns {number} Price after tax deduction
     *
     * @example
     * calculatePriceAfterTax(100) // Returns 98
     */
    function calculatePriceAfterTax(price, taxRate = MARKET_TAX) {
        return price * (1 - taxRate);
    }

    /**
     * Calculate action-based totals for production actions
     * Uses per-action base inputs (efficiency only affects time)
     *
     * @param {Object} params - Calculation parameters
     * @param {number} params.actionsCount - Number of queued actions
     * @param {number} params.actionsPerHour - Base actions per hour
     * @param {number} params.outputAmount - Items produced per action
     * @param {number} params.outputPrice - Output price per item (pre-tax)
     * @param {number} params.gourmetBonus - Gourmet bonus as decimal (e.g., 0.1 for 10%)
     * @param {Array} [params.bonusDrops] - Bonus drop entries with revenuePerAction
     * @param {Array} [params.materialCosts] - Material cost entries per action
     * @param {number} params.totalTeaCostPerHour - Tea cost per hour
     * @param {number} [params.efficiencyMultiplier=1] - Efficiency multiplier for time scaling
     * @returns {Object} Totals and time values
     */
    function calculateProductionActionTotalsFromBase({
        actionsCount,
        actionsPerHour,
        outputAmount,
        outputPrice,
        gourmetBonus,
        bonusDrops = [],
        materialCosts = [],
        totalTeaCostPerHour,
        efficiencyMultiplier = 1,
    }) {
        const effectiveActionsPerHour = calculateEffectiveActionsPerHour(actionsPerHour, efficiencyMultiplier);
        if (!effectiveActionsPerHour || effectiveActionsPerHour <= 0) {
            return {
                totalBaseItems: 0,
                totalGourmetItems: 0,
                totalBaseRevenue: 0,
                totalGourmetRevenue: 0,
                totalBonusRevenue: 0,
                totalRevenue: 0,
                totalMarketTax: 0,
                totalMaterialCost: 0,
                totalTeaCost: 0,
                totalCosts: 0,
                totalProfit: 0,
                hoursNeeded: 0,
            };
        }
        const totalBaseItems = outputAmount * actionsCount;
        const totalGourmetItems = outputAmount * gourmetBonus * actionsCount;
        const totalBaseRevenue = totalBaseItems * outputPrice;
        const totalGourmetRevenue = totalGourmetItems * outputPrice;
        const totalBonusRevenue = bonusDrops.reduce((sum, drop) => sum + (drop.revenuePerAction || 0) * actionsCount, 0);
        const totalRevenue = totalBaseRevenue + totalGourmetRevenue + totalBonusRevenue;
        const totalMarketTax = totalRevenue * MARKET_TAX;
        const totalMaterialCost = materialCosts.reduce((sum, material) => sum + material.totalCost * actionsCount, 0);
        const hoursNeeded = calculateHoursForActions(actionsCount, effectiveActionsPerHour);
        const totalTeaCost = totalTeaCostPerHour * hoursNeeded;
        const totalCosts = totalMaterialCost + totalTeaCost + totalMarketTax;
        const totalProfit = totalRevenue - totalCosts;

        return {
            totalBaseItems,
            totalGourmetItems,
            totalBaseRevenue,
            totalGourmetRevenue,
            totalBonusRevenue,
            totalRevenue,
            totalMarketTax,
            totalMaterialCost,
            totalTeaCost,
            totalCosts,
            totalProfit,
            hoursNeeded,
        };
    }

    /**
     * Calculate action-based totals for gathering actions
     * Uses per-action base inputs (efficiency only affects time)
     *
     * @param {Object} params - Calculation parameters
     * @param {number} params.actionsCount - Number of queued actions
     * @param {number} params.actionsPerHour - Base actions per hour
     * @param {Array} [params.baseOutputs] - Base outputs with revenuePerAction
     * @param {Array} [params.bonusDrops] - Bonus drop entries with revenuePerAction
     * @param {number} params.processingRevenueBonusPerAction - Processing bonus per action
     * @param {number} params.gourmetRevenueBonusPerAction - Gourmet bonus revenue per action
     * @param {number} params.drinkCostPerHour - Drink costs per hour
     * @param {number} [params.efficiencyMultiplier=1] - Efficiency multiplier for time scaling
     * @returns {Object} Totals and time values
     */
    function calculateGatheringActionTotalsFromBase({
        actionsCount,
        actionsPerHour,
        baseOutputs = [],
        bonusDrops = [],
        processingRevenueBonusPerAction,
        gourmetRevenueBonusPerAction,
        drinkCostPerHour,
        efficiencyMultiplier = 1,
    }) {
        const effectiveActionsPerHour = calculateEffectiveActionsPerHour(actionsPerHour, efficiencyMultiplier);
        if (!effectiveActionsPerHour || effectiveActionsPerHour <= 0) {
            return {
                totalBaseRevenue: 0,
                totalBonusRevenue: 0,
                totalProcessingRevenue: 0,
                totalGourmetRevenue: 0,
                totalRevenue: 0,
                totalMarketTax: 0,
                totalDrinkCost: 0,
                totalCosts: 0,
                totalProfit: 0,
                hoursNeeded: 0,
            };
        }
        const totalBaseRevenue = baseOutputs.reduce(
            (sum, output) => sum + (output.revenuePerAction || 0) * actionsCount,
            0
        );
        const totalBonusRevenue = bonusDrops.reduce((sum, drop) => sum + (drop.revenuePerAction || 0) * actionsCount, 0);
        const totalProcessingRevenue = (processingRevenueBonusPerAction || 0) * actionsCount;
        const totalGourmetRevenue = (gourmetRevenueBonusPerAction || 0) * actionsCount;
        const totalRevenue = totalBaseRevenue + totalGourmetRevenue + totalBonusRevenue + totalProcessingRevenue;
        const totalMarketTax = totalRevenue * MARKET_TAX;
        const hoursNeeded = calculateHoursForActions(actionsCount, effectiveActionsPerHour);
        const totalDrinkCost = drinkCostPerHour * hoursNeeded;
        const totalCosts = totalDrinkCost + totalMarketTax;
        const totalProfit = totalRevenue - totalCosts;

        return {
            totalBaseRevenue,
            totalBonusRevenue,
            totalProcessingRevenue,
            totalGourmetRevenue,
            totalRevenue,
            totalMarketTax,
            totalDrinkCost,
            totalCosts,
            totalProfit,
            hoursNeeded,
        };
    }

    var profitHelpers = {
        // Rate conversions
        calculateActionsPerHour,
        calculateEffectiveActionsPerHour,
        calculateHoursForActions,
        calculateSecondsForActions,

        // Profit
        calculateProfitPerAction,
        calculateTotalProfitForActions,
        calculateProfitPerDay,

        // Costs
        calculateDrinksPerHour,
        calculateTeaCostsPerHour,
        calculatePriceAfterTax,

        calculateProductionActionTotalsFromBase,
        calculateGatheringActionTotalsFromBase,
    };

    var profitHelpers$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateActionsPerHour: calculateActionsPerHour,
        calculateDrinksPerHour: calculateDrinksPerHour,
        calculateEffectiveActionsPerHour: calculateEffectiveActionsPerHour,
        calculateGatheringActionTotalsFromBase: calculateGatheringActionTotalsFromBase,
        calculateHoursForActions: calculateHoursForActions,
        calculatePriceAfterTax: calculatePriceAfterTax,
        calculateProductionActionTotalsFromBase: calculateProductionActionTotalsFromBase,
        calculateProfitPerAction: calculateProfitPerAction,
        calculateProfitPerDay: calculateProfitPerDay,
        calculateSecondsForActions: calculateSecondsForActions,
        calculateTeaCostsPerHour: calculateTeaCostsPerHour,
        calculateTotalProfitForActions: calculateTotalProfitForActions,
        default: profitHelpers
    });

    /**
     * DOM Utilities Module
     * Helpers for DOM manipulation and element creation
     */


    // Compiled regex pattern (created once, reused for performance)
    const REGEX_TRANSFORM3D = /translate3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/;

    /**
     * Wait for an element to appear in the DOM
     * @param {string} selector - CSS selector
     * @param {number} timeout - Max wait time in ms (default: 10000)
     * @param {number} interval - Check interval in ms (default: 100)
     * @returns {Promise<Element|null>} The element or null if timeout
     */
    function waitForElement(selector, timeout = 10000, interval = 100) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const check = () => {
                const element = document.querySelector(selector);

                if (element) {
                    resolve(element);
                } else if (Date.now() - startTime >= timeout) {
                    console.warn(`[DOM] Timeout waiting for: ${selector}`);
                    resolve(null);
                } else {
                    setTimeout(check, interval);
                }
            };

            check();
        });
    }

    /**
     * Wait for multiple elements to appear
     * @param {string} selector - CSS selector
     * @param {number} minCount - Minimum number of elements to wait for (default: 1)
     * @param {number} timeout - Max wait time in ms (default: 10000)
     * @returns {Promise<NodeList|null>} The elements or null if timeout
     */
    function waitForElements(selector, minCount = 1, timeout = 10000) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const check = () => {
                const elements = document.querySelectorAll(selector);

                if (elements.length >= minCount) {
                    resolve(elements);
                } else if (Date.now() - startTime >= timeout) {
                    console.warn(`[DOM] Timeout waiting for ${minCount}× ${selector}`);
                    resolve(null);
                } else {
                    setTimeout(check, 100);
                }
            };

            check();
        });
    }

    /**
     * Create a styled div element
     * @param {Object} styles - CSS styles object
     * @param {string} text - Optional text content
     * @param {string} className - Optional class name
     * @returns {HTMLDivElement} Created div
     */
    function createStyledDiv(styles = {}, text = '', className = '') {
        const div = document.createElement('div');

        if (className) {
            div.className = className;
        }

        if (text) {
            div.textContent = text;
        }

        Object.assign(div.style, styles);

        return div;
    }

    /**
     * Create a styled span element
     * @param {Object} styles - CSS styles object
     * @param {string} text - Text content
     * @param {string} className - Optional class name
     * @returns {HTMLSpanElement} Created span
     */
    function createStyledSpan(styles = {}, text = '', className = '') {
        const span = document.createElement('span');

        if (className) {
            span.className = className;
        }

        if (text) {
            span.textContent = text;
        }

        Object.assign(span.style, styles);

        return span;
    }

    /**
     * Create a colored text span (uses script colors from config)
     * @param {string} text - Text content
     * @param {string} colorType - 'main', 'tooltip', or 'alert' (default: 'main')
     * @returns {HTMLSpanElement} Created span with color
     */
    function createColoredText(text, colorType = 'main') {
        let color;

        switch (colorType) {
            case 'main':
                color = config.SCRIPT_COLOR_MAIN;
                break;
            case 'tooltip':
                color = config.SCRIPT_COLOR_TOOLTIP;
                break;
            case 'alert':
                color = config.SCRIPT_COLOR_ALERT;
                break;
            default:
                color = config.SCRIPT_COLOR_MAIN;
        }

        return createStyledSpan({ color }, text);
    }

    /**
     * Insert element before another element
     * @param {Element} newElement - Element to insert
     * @param {Element} referenceElement - Element to insert before
     */
    function insertBefore(newElement, referenceElement) {
        if (!referenceElement?.parentNode) {
            console.warn('[DOM] Cannot insert: reference element has no parent');
            return;
        }

        referenceElement.parentNode.insertBefore(newElement, referenceElement);
    }

    /**
     * Insert element after another element
     * @param {Element} newElement - Element to insert
     * @param {Element} referenceElement - Element to insert after
     */
    function insertAfter(newElement, referenceElement) {
        if (!referenceElement?.parentNode) {
            console.warn('[DOM] Cannot insert: reference element has no parent');
            return;
        }

        referenceElement.parentNode.insertBefore(newElement, referenceElement.nextSibling);
    }

    /**
     * Remove all elements matching selector
     * @param {string} selector - CSS selector
     * @returns {number} Number of elements removed
     */
    function removeElements(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => el.parentNode?.removeChild(el));
        return elements.length;
    }

    /**
     * Get original text from element (strips our injected content)
     * @param {Element} element - Element to get text from
     * @returns {string} Original text content
     */
    function getOriginalText(element) {
        if (!element) return '';

        // Clone element to avoid modifying original
        const clone = element.cloneNode(true);

        // Remove inserted spans/divs (our injected content)
        clone.querySelectorAll('.insertedSpan, .script-injected').forEach((el) => el.remove());

        return clone.textContent.trim();
    }

    /**
     * Add CSS to page
     * @param {string} css - CSS rules to add
     * @param {string} id - Optional style element ID (for removal later)
     */
    function addStyles(css, id = '') {
        const style = document.createElement('style');

        if (id) {
            style.id = id;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }

    /**
     * Remove CSS by ID
     * @param {string} id - Style element ID to remove
     */
    function removeStyles(id) {
        const style = document.getElementById(id);
        if (style) {
            style.remove();
        }
    }

    /**
     * Dismiss all open MUI tooltips by dispatching mouseleave events
     * Useful when DOM elements are reordered (e.g., sorting action panels)
     * which can cause tooltips to get "stuck" since no natural mouseleave fires
     */
    function dismissTooltips() {
        const tooltips = document.querySelectorAll('.MuiTooltip-popper');
        tooltips.forEach((tooltip) => {
            // Find the element that triggered this tooltip and dispatch mouseleave
            // MUI tooltips listen for mouseleave on the trigger element
            const triggerId = tooltip.id?.replace('-tooltip', '');
            if (triggerId) {
                const trigger = document.querySelector(`[aria-describedby="${tooltip.id}"]`);
                if (trigger) {
                    if (trigger.matches(':hover')) {
                        return;
                    }
                    trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                    trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                }
            }
        });
    }

    /**
     * Set up scroll listener to dismiss tooltips when scrolling
     * Prevents tooltips from getting stuck when scrolling quickly
     * @returns {Function} Cleanup function to remove the listener
     */
    function setupScrollTooltipDismissal() {
        let scrollTimeout = null;
        let lastUserScrollTime = 0;
        const USER_SCROLL_WINDOW_MS = 200;

        const markUserScroll = () => {
            lastUserScrollTime = Date.now();
        };

        const handleUserKeyScroll = (event) => {
            const key = event.key;
            if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown' || key === ' ') {
                markUserScroll();
            }
        };

        const handleScroll = (event) => {
            const target = event.target;
            if (target?.closest?.('.MuiTooltip-tooltip, .MuiTooltip-popper')) {
                return;
            }

            if (Date.now() - lastUserScrollTime > USER_SCROLL_WINDOW_MS) {
                return;
            }

            // Early exit: skip if no tooltips are visible
            if (!document.querySelector('.MuiTooltip-popper')) {
                return;
            }

            // Debounce: only dismiss after scrolling stops for 50ms
            // This prevents excessive calls during continuous scrolling
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
            scrollTimeout = setTimeout(() => {
                dismissTooltips();
                scrollTimeout = null;
            }, 50);
        };

        // Listen on document with capture to catch all scroll events
        // (including scrolls in nested containers)
        document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

        // Track user-driven scrolling intent
        document.addEventListener('wheel', markUserScroll, { capture: true, passive: true });
        document.addEventListener('touchmove', markUserScroll, { capture: true, passive: true });
        document.addEventListener('keydown', handleUserKeyScroll, { capture: true });

        // Return cleanup function
        return () => {
            document.removeEventListener('scroll', handleScroll, { capture: true });
            document.removeEventListener('wheel', markUserScroll, { capture: true });
            document.removeEventListener('touchmove', markUserScroll, { capture: true });
            document.removeEventListener('keydown', handleUserKeyScroll, { capture: true });
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
        };
    }

    /**
     * Fix tooltip overflow to ensure it stays within viewport
     * @param {Element} tooltipElement - The tooltip popper element
     */
    function fixTooltipOverflow(tooltipElement) {
        // Use triple requestAnimationFrame to ensure MUI positioning is complete
        // Frame 1: MUI does initial positioning
        // Frame 2: Content finishes rendering (especially for long lists)
        // Frame 3: We check and fix overflow
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!tooltipElement.isConnected) {
                        return; // Tooltip already removed
                    }

                    const bBox = tooltipElement.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;

                    // Find the actual tooltip content element (child of popper)
                    const tooltipContent = tooltipElement.querySelector('.MuiTooltip-tooltip');

                    // Check if tooltip extends beyond viewport
                    if (bBox.top < 0 || bBox.bottom > viewportHeight) {
                        // Get current transform
                        const transformString = tooltipElement.style.transform;

                        if (transformString) {
                            // Parse transform3d(x, y, z)
                            const match = transformString.match(REGEX_TRANSFORM3D);

                            if (match) {
                                const x = match[1];
                                const currentY = parseFloat(match[2]);
                                const z = match[3];

                                // Calculate how much to adjust Y
                                let newY;

                                if (bBox.height >= viewportHeight - 20) {
                                    // Tooltip is taller than viewport - position at top
                                    newY = 0;

                                    // Force max-height on the tooltip content to enable scrolling
                                    if (tooltipContent) {
                                        tooltipContent.style.maxHeight = `${viewportHeight - 20}px`;
                                        tooltipContent.style.overflowY = 'auto';
                                    }
                                } else if (bBox.top < 0) {
                                    // Tooltip extends above viewport - move it down
                                    newY = currentY - bBox.top;
                                } else if (bBox.bottom > viewportHeight) {
                                    // Tooltip extends below viewport - move it up
                                    newY = currentY - (bBox.bottom - viewportHeight) - 10;
                                }

                                if (newY !== undefined) {
                                    // Ensure tooltip never goes above viewport (minimum y=0)
                                    newY = Math.max(0, newY);
                                    tooltipElement.style.transform = `translate3d(${x}, ${newY}px, ${z})`;
                                }
                            }
                        }
                    }
                });
            });
        });
    }

    var dom = {
        waitForElement,
        waitForElements,
        createStyledDiv,
        createStyledSpan,
        createColoredText,
        insertBefore,
        insertAfter,
        removeElements,
        getOriginalText,
        addStyles,
        removeStyles,
        dismissTooltips,
        setupScrollTooltipDismissal,
        fixTooltipOverflow,
    };

    var dom$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        addStyles: addStyles,
        createColoredText: createColoredText,
        createStyledDiv: createStyledDiv,
        createStyledSpan: createStyledSpan,
        default: dom,
        dismissTooltips: dismissTooltips,
        fixTooltipOverflow: fixTooltipOverflow,
        getOriginalText: getOriginalText,
        insertAfter: insertAfter,
        insertBefore: insertBefore,
        removeElements: removeElements,
        removeStyles: removeStyles,
        setupScrollTooltipDismissal: setupScrollTooltipDismissal,
        waitForElement: waitForElement,
        waitForElements: waitForElements
    });

    /**
     * DOM Observer Helper Utilities
     * Standardized wrappers around domObserver to reduce boilerplate
     */


    /**
     * Create a singleton observer that automatically prevents duplicate processing
     * Uses an internal WeakSet to track processed elements
     *
     * @param {string} name - Observer name for debugging
     * @param {string|string[]} classNames - Class name(s) to watch for
     * @param {Function} handler - Handler function (receives element)
     * @param {Object} options - Optional configuration
     * @param {boolean} options.debounce - Enable debouncing
     * @param {number} options.debounceDelay - Debounce delay in ms
     * @returns {Function} Unregister function
     *
     * @example
     * // Before (20 lines)
     * this.processedDivs = new WeakSet();
     * this.unregister = domObserver.onClass('MyFeature', 'selector', (elem) => {
     *     if (this.processedDivs.has(elem)) return;
     *     this.processedDivs.add(elem);
     *     // do work
     * });
     *
     * // After (5 lines)
     * this.unregister = createSingletonObserver('MyFeature', 'selector', (elem) => {
     *     // do work (processed flag automatic)
     * });
     */
    function createSingletonObserver(name, classNames, handler, options = {}) {
        const processedElements = new WeakSet();

        return domObserver.onClass(
            name,
            classNames,
            (element) => {
                if (processedElements.has(element)) {
                    return;
                }

                // Mark as processed
                processedElements.add(element);

                // Call user handler
                handler(element);
            },
            options
        );
    }

    /**
     * Create a tracked observer that manages cleanup functions for processed elements
     * Uses an internal Map to track element → cleanup function pairs
     * Automatically calls cleanup functions when unregistered
     *
     * @param {string} name - Observer name for debugging
     * @param {string|string[]} classNames - Class name(s) to watch for
     * @param {Function} handler - Handler function (receives element, should return cleanup function or null)
     * @param {Object} options - Optional configuration
     * @param {boolean} options.debounce - Enable debouncing
     * @param {number} options.debounceDelay - Debounce delay in ms
     * @returns {Function} Unregister function (also calls all cleanup functions)
     *
     * @example
     * // Before (15 lines)
     * this.trackedElements = new Map();
     * this.unregister = domObserver.onClass('MyFeature', 'selector', (elem) => {
     *     if (this.trackedElements.has(elem)) return;
     *     const cleanup = attachListeners(...);
     *     this.trackedElements.set(elem, cleanup);
     * });
     *
     * // After (5 lines)
     * this.unregister = createTrackedObserver('MyFeature', 'selector', (elem) => {
     *     return attachListeners(...); // Return cleanup function
     * });
     */
    function createTrackedObserver(name, classNames, handler, options = {}) {
        const trackedElements = new Map();

        const unregister = domObserver.onClass(
            name,
            classNames,
            (element) => {
                // Skip if already tracked
                if (trackedElements.has(element)) {
                    return;
                }

                // Call user handler and store cleanup function
                const cleanup = handler(element);
                if (cleanup && typeof cleanup === 'function') {
                    trackedElements.set(element, cleanup);
                } else {
                    // Mark as tracked even if no cleanup function returned
                    trackedElements.set(element, null);
                }
            },
            options
        );

        // Return enhanced unregister that also calls all cleanup functions
        return () => {
            // Call all cleanup functions
            for (const [_element, cleanup] of trackedElements.entries()) {
                if (cleanup && typeof cleanup === 'function') {
                    try {
                        cleanup();
                    } catch (error) {
                        console.error(`[DOM Observer Helpers] Cleanup error for ${name}:`, error);
                    }
                }
            }

            // Clear tracked elements
            trackedElements.clear();

            unregister();
        };
    }

    /**
     * Create a simplified MutationObserver with automatic cleanup
     * Wrapper around native MutationObserver that returns unwatch function
     *
     * @param {Element} element - Element to observe
     * @param {Function} callback - Callback function (receives mutations, observer)
     * @param {Object} options - MutationObserver options (default: { childList: true, subtree: true })
     * @returns {Function} Unwatch function (disconnects observer)
     *
     * @example
     * // Before (25 lines)
     * let observer = null;
     * const cleanup = () => {
     *     if (observer) {
     *         observer.disconnect();
     *         observer = null;
     *     }
     * };
     * observer = new MutationObserver(() => { ... });
     * observer.observe(element, { childList: true });
     *
     * // After (5 lines)
     * const unwatch = createMutationWatcher(element, () => {
     *     // callback
     * }, { childList: true });
     */
    function createMutationWatcher(element, callback, options = null) {
        if (!element) {
            console.warn('[DOM Observer Helpers] createMutationWatcher called with null element');
            return () => {}; // Return no-op unwatch function
        }

        // Default options
        const observerOptions = options || {
            childList: true,
            subtree: true,
        };

        const observer = new MutationObserver((mutations) => {
            callback(mutations, observer);
        });

        observer.observe(element, observerOptions);

        // Return unwatch function
        return () => {
            observer.disconnect();
        };
    }

    /**
     * Create a persistent display helper
     * Handles cleanup and re-creation of DOM elements on re-render
     *
     * @param {string} name - Helper name for debugging
     * @param {string|string[]} classNames - Class name(s) to watch for
     * @param {Function} createFn - Function to create display element (receives container)
     * @param {Object} options - Optional configuration
     * @param {boolean} options.debounce - Enable debouncing
     * @param {number} options.debounceDelay - Debounce delay in ms
     * @returns {Function} Unregister function
     *
     * @example
     * this.unregister = createPersistentDisplay(
     *     'MyDisplay',
     *     'container-class',
     *     (container) => {
     *         const display = document.createElement('div');
     *         display.className = 'my-display';
     *         display.textContent = 'Hello';
     *         container.appendChild(display);
     *     }
     * );
     */
    function createPersistentDisplay(name, classNames, createFn, options = {}) {
        return createSingletonObserver(
            name,
            classNames,
            (container) => {
                try {
                    createFn(container);
                } catch (error) {
                    console.error(`[DOM Observer Helpers] createPersistentDisplay error for ${name}:`, error);
                }
            },
            options
        );
    }

    var domObserverHelpers = /*#__PURE__*/Object.freeze({
        __proto__: null,
        createMutationWatcher: createMutationWatcher,
        createPersistentDisplay: createPersistentDisplay,
        createSingletonObserver: createSingletonObserver,
        createTrackedObserver: createTrackedObserver
    });

    /**
     * Timer Registry Utility
     * Centralized registration for intervals and timeouts.
     */

    /**
     * Create a timer registry for deterministic teardown.
     * @returns {{
     *   registerInterval: (intervalId: number) => void,
     *   registerTimeout: (timeoutId: number) => void,
     *   clearAll: () => void
     * }} Timer registry API
     */
    function createTimerRegistry() {
        const intervals = [];
        const timeouts = [];

        const registerInterval = (intervalId) => {
            if (!intervalId) {
                console.warn('[TimerRegistry] registerInterval called with invalid interval id');
                return;
            }

            intervals.push(intervalId);
        };

        const registerTimeout = (timeoutId) => {
            if (!timeoutId) {
                console.warn('[TimerRegistry] registerTimeout called with invalid timeout id');
                return;
            }

            timeouts.push(timeoutId);
        };

        const clearAll = () => {
            intervals.forEach((intervalId) => {
                try {
                    clearInterval(intervalId);
                } catch (error) {
                    console.error('[TimerRegistry] Failed to clear interval:', error);
                }
            });
            intervals.length = 0;

            timeouts.forEach((timeoutId) => {
                try {
                    clearTimeout(timeoutId);
                } catch (error) {
                    console.error('[TimerRegistry] Failed to clear timeout:', error);
                }
            });
            timeouts.length = 0;
        };

        return {
            registerInterval,
            registerTimeout,
            clearAll,
        };
    }

    var timerRegistry = /*#__PURE__*/Object.freeze({
        __proto__: null,
        createTimerRegistry: createTimerRegistry
    });

    /**
     * Token Valuation Utility
     * Shared logic for calculating dungeon token and task token values
     */


    /**
     * Calculate dungeon token value based on best shop item value
     * Uses "best market value per token" approach: finds the shop item with highest (market price / token cost)
     * @param {string} tokenHrid - Token HRID (e.g., '/items/chimerical_token')
     * @param {string} pricingModeSetting - Config setting key for pricing mode (default: 'profitCalc_pricingMode')
     * @param {string} respectModeSetting - Config setting key for respect pricing mode flag (default: 'expectedValue_respectPricingMode')
     * @returns {number|null} Value per token, or null if no data
     */
    function calculateDungeonTokenValue(
        tokenHrid,
        pricingModeSetting = 'profitCalc_pricingMode',
        respectModeSetting = 'expectedValue_respectPricingMode'
    ) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return null;

        // Get all shop items for this token type
        const shopItems = Object.values(gameData.shopItemDetailMap || {}).filter(
            (item) => item.costs && item.costs[0]?.itemHrid === tokenHrid
        );

        if (shopItems.length === 0) return null;

        let bestValuePerToken = 0;

        // For each shop item, calculate market price / token cost
        for (const shopItem of shopItems) {
            const itemHrid = shopItem.itemHrid;
            const tokenCost = shopItem.costs[0].count;

            // Get market price for this item
            const prices = marketAPI.getPrice(itemHrid, 0);
            if (!prices) continue;

            // Use pricing mode to determine which price to use
            const pricingMode = config.getSettingValue(pricingModeSetting, 'conservative');
            const respectPricingMode = config.getSettingValue(respectModeSetting, true);

            let marketPrice = 0;
            if (respectPricingMode) {
                // Conservative: Bid, Hybrid/Optimistic: Ask
                marketPrice = pricingMode === 'conservative' ? prices.bid : prices.ask;
            } else {
                // Always conservative
                marketPrice = prices.bid;
            }

            if (marketPrice <= 0) continue;

            // Calculate value per token
            const valuePerToken = marketPrice / tokenCost;

            // Keep track of best value
            if (valuePerToken > bestValuePerToken) {
                bestValuePerToken = valuePerToken;
            }
        }

        // Fallback to essence price if no shop items found
        if (bestValuePerToken === 0) {
            const essenceMap = {
                '/items/chimerical_token': '/items/chimerical_essence',
                '/items/sinister_token': '/items/sinister_essence',
                '/items/enchanted_token': '/items/enchanted_essence',
                '/items/pirate_token': '/items/pirate_essence',
            };

            const essenceHrid = essenceMap[tokenHrid];
            if (essenceHrid) {
                const essencePrice = marketAPI.getPrice(essenceHrid, 0);
                if (essencePrice) {
                    const pricingMode = config.getSettingValue(pricingModeSetting, 'conservative');
                    const respectPricingMode = config.getSettingValue(respectModeSetting, true);

                    let marketPrice = 0;
                    if (respectPricingMode) {
                        marketPrice = pricingMode === 'conservative' ? essencePrice.bid : essencePrice.ask;
                    } else {
                        marketPrice = essencePrice.bid;
                    }

                    return marketPrice > 0 ? marketPrice : null;
                }
            }
        }

        return bestValuePerToken > 0 ? bestValuePerToken : null;
    }

    /**
     * Calculate task token value based on best chest expected value
     * @returns {number} Value per token, or 0 if no data
     */
    function calculateTaskTokenValue() {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        // Get all chest items (Large Artisan's Crate, Large Meteorite Cache, Large Treasure Chest)
        const chestHrids = ['/items/large_artisans_crate', '/items/large_meteorite_cache', '/items/large_treasure_chest'];

        const bestChestValue = 0;

        for (const chestHrid of chestHrids) {
            const itemDetails = dataManager.getItemDetails(chestHrid);
            if (!itemDetails || !itemDetails.isOpenable) continue;

            // Calculate expected value for this chest
            // Note: This would require expectedValueCalculator, but to avoid circular dependency,
            // we'll let the caller handle this or import it locally where needed
            // For now, return 0 as placeholder
        }

        // Task Token cost for chests is 30
        const tokenCost = 30;

        return bestChestValue / tokenCost;
    }

    var tokenValuation = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateDungeonTokenValue: calculateDungeonTokenValue,
        calculateTaskTokenValue: calculateTaskTokenValue
    });

    /**
     * Market Data Utility
     * Centralized access to market prices with smart pricing mode handling
     */


    // Track logged warnings to prevent console spam
    const loggedWarnings = new Set();

    /**
     * Get item price based on pricing mode and context
     * @param {string} itemHrid - Item HRID
     * @param {Object} options - Configuration options
     * @param {number} [options.enhancementLevel=0] - Enhancement level
     * @param {string} [options.mode] - Pricing mode ('ask'|'bid'|'average'). If not provided, uses context or user settings
     * @param {string} [options.context] - Context hint ('profit'|'networth'|null). Used to determine pricing mode from settings
     * @param {string} [options.side='sell'] - Transaction side ('buy'|'sell') - used with 'profit' context to determine correct price
     * @returns {number|null} Price in gold, or null if no market data
     */
    function getItemPrice(itemHrid, options = {}) {
        // Validate inputs
        if (!itemHrid || typeof itemHrid !== 'string') {
            return null;
        }

        // Handle case where someone passes enhancementLevel as second arg (old API)
        if (typeof options === 'number') {
            options = { enhancementLevel: options };
        }

        // Ensure options is an object
        if (typeof options !== 'object' || options === null) {
            options = {};
        }

        const { enhancementLevel = 0, mode, context, side = 'sell' } = options;

        // Get raw price data from API
        const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);

        if (!priceData) {
            return null;
        }

        // Determine pricing mode
        const pricingMode = mode || getPricingMode(context, side);

        // Validate pricing mode
        const validModes = ['ask', 'bid', 'average'];
        if (!validModes.includes(pricingMode)) {
            const warningKey = `mode:${pricingMode}`;
            if (!loggedWarnings.has(warningKey)) {
                console.warn(`[Market Data] Unknown pricing mode: ${pricingMode}, defaulting to ask`);
                loggedWarnings.add(warningKey);
            }
            return priceData.ask || 0;
        }

        const resolvePrice = (value) => {
            if (typeof value !== 'number') {
                return null;
            }

            if (value < 0) {
                return null;
            }

            return value;
        };

        // Return price based on mode
        switch (pricingMode) {
            case 'ask':
                return resolvePrice(priceData.ask);
            case 'bid':
                return resolvePrice(priceData.bid);
            case 'average':
                if (typeof priceData.ask !== 'number' || typeof priceData.bid !== 'number') {
                    return null;
                }

                if (priceData.ask < 0 || priceData.bid < 0) {
                    return null;
                }

                return (priceData.ask + priceData.bid) / 2;
            default:
                return resolvePrice(priceData.ask);
        }
    }

    /**
     * Get all price variants for an item
     * @param {string} itemHrid - Item HRID
     * @param {number} [enhancementLevel=0] - Enhancement level
     * @returns {Object|null} Object with {ask, bid, average} or null if no market data
     */
    function getItemPrices(itemHrid, enhancementLevel = 0) {
        const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);

        if (!priceData) {
            return null;
        }

        return {
            ask: priceData.ask,
            bid: priceData.bid,
            average: (priceData.ask + priceData.bid) / 2,
        };
    }

    /**
     * Format price with K/M/B suffixes
     * @param {number} amount - Amount to format
     * @param {Object} options - Formatting options
     * @param {number} [options.decimals=1] - Number of decimal places
     * @param {boolean} [options.showZero=true] - Whether to show '0' for zero values
     * @returns {string} Formatted price string
     */
    function formatPrice(amount, options = {}) {
        const { decimals = 1, showZero = true } = options;

        if (amount === null || amount === undefined) {
            return '--';
        }

        if (amount === 0) {
            return showZero ? '0' : '--';
        }

        const absAmount = Math.abs(amount);
        const sign = amount < 0 ? '-' : '';

        if (absAmount >= 1_000_000_000) {
            return `${sign}${(absAmount / 1_000_000_000).toFixed(decimals)}B`;
        } else if (absAmount >= 1_000_000) {
            return `${sign}${(absAmount / 1_000_000).toFixed(decimals)}M`;
        } else if (absAmount >= 1_000) {
            return `${sign}${(absAmount / 1_000).toFixed(decimals)}K`;
        } else {
            return `${sign}${absAmount.toFixed(decimals)}`;
        }
    }

    /**
     * Determine pricing mode from context and user settings
     * @param {string} [context] - Context hint ('profit'|'networth'|null)
     * @param {string} [side='sell'] - Transaction side ('buy'|'sell') - used with 'profit' context
     * @returns {string} Pricing mode ('ask'|'bid'|'average')
     */
    function getPricingMode(context, side = 'sell') {
        // If no context, default to 'ask'
        if (!context) {
            return 'ask';
        }

        // Validate context is a string
        if (typeof context !== 'string') {
            return 'ask';
        }

        // Get pricing mode from settings based on context
        switch (context) {
            case 'profit': {
                const profitMode = config.getSettingValue('profitCalc_pricingMode');

                // Convert profit calculation modes to price types based on transaction side
                // Conservative: Ask/Bid (instant buy materials, instant sell output)
                // Hybrid: Ask/Ask (instant buy materials, patient sell output)
                // Optimistic: Bid/Ask (patient buy materials, patient sell output)
                switch (profitMode) {
                    case 'conservative':
                        return side === 'buy' ? 'ask' : 'bid';
                    case 'hybrid':
                        return 'ask'; // Ask for both buy and sell
                    case 'optimistic':
                        return side === 'buy' ? 'bid' : 'ask';
                    default:
                        return 'ask';
                }
            }
            default: {
                const warningKey = `context:${context}`;
                if (!loggedWarnings.has(warningKey)) {
                    console.warn(`[Market Data] Unknown context: ${context}, defaulting to ask`);
                    loggedWarnings.add(warningKey);
                }
                return 'ask';
            }
        }
    }

    /**
     * Get prices for multiple items in batch
     * @param {Array<{itemHrid: string, enhancementLevel?: number}>} items - Array of items to price
     * @param {Object} options - Configuration options
     * @param {string} [options.mode] - Pricing mode ('ask'|'bid'|'average')
     * @param {string} [options.context] - Context hint ('profit'|'networth'|null)
     * @param {string} [options.side='sell'] - Transaction side ('buy'|'sell')
     * @returns {Map<string, number>} Map of itemHrid+enhancementLevel to price
     */
    function getItemPricesBatch(items, options = {}) {
        const result = new Map();

        for (const item of items) {
            const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
            const price = getItemPrice(item.itemHrid, {
                enhancementLevel: item.enhancementLevel || 0,
                mode: options.mode,
                context: options.context,
                side: options.side,
            });

            if (price !== null) {
                result.set(key, price);
            }
        }

        return result;
    }

    var marketData = {
        getItemPrice,
        getItemPrices,
        formatPrice,
        getPricingMode,
        getItemPricesBatch,
    };

    var marketData$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        default: marketData,
        formatPrice: formatPrice,
        getItemPrice: getItemPrice,
        getItemPrices: getItemPrices,
        getItemPricesBatch: getItemPricesBatch,
        getPricingMode: getPricingMode
    });

    /**
     * Worker Pool Manager
     * Manages a pool of Web Workers for parallel task execution
     */

    class WorkerPool {
        constructor(workerScript, poolSize = null) {
            // Auto-detect optimal pool size (max 4 workers)
            this.poolSize = poolSize || Math.min(navigator.hardwareConcurrency || 2, 4);
            this.workerScript = workerScript;
            this.workers = [];
            this.taskQueue = [];
            this.activeWorkers = new Set();
            this.nextTaskId = 0;
            this.initialized = false;
        }

        /**
         * Initialize the worker pool
         */
        async initialize() {
            if (this.initialized) {
                return;
            }

            try {
                // Create workers
                for (let i = 0; i < this.poolSize; i++) {
                    const worker = new Worker(URL.createObjectURL(this.workerScript));
                    this.workers.push({
                        id: i,
                        worker,
                        busy: false,
                        currentTask: null,
                    });
                }

                this.initialized = true;
            } catch (error) {
                console.error('[WorkerPool] Failed to initialize:', error);
                throw error;
            }
        }

        /**
         * Execute a task in the worker pool
         * @param {Object} taskData - Data to send to worker
         * @returns {Promise} Promise that resolves with worker result
         */
        async execute(taskData) {
            if (!this.initialized) {
                await this.initialize();
            }

            return new Promise((resolve, reject) => {
                const taskId = this.nextTaskId++;
                const task = {
                    id: taskId,
                    data: taskData,
                    resolve,
                    reject,
                    timestamp: Date.now(),
                };

                // Try to assign to an available worker immediately
                const availableWorker = this.workers.find((w) => !w.busy);

                if (availableWorker) {
                    this.assignTask(availableWorker, task);
                } else {
                    // Queue the task if all workers are busy
                    this.taskQueue.push(task);
                }
            });
        }

        /**
         * Execute multiple tasks in parallel
         * @param {Array} taskDataArray - Array of task data objects
         * @returns {Promise<Array>} Promise that resolves with array of results
         */
        async executeAll(taskDataArray) {
            if (!this.initialized) {
                await this.initialize();
            }

            const promises = taskDataArray.map((taskData) => this.execute(taskData));
            return Promise.all(promises);
        }

        /**
         * Assign a task to a worker
         * @private
         */
        assignTask(workerWrapper, task) {
            workerWrapper.busy = true;
            workerWrapper.currentTask = task;

            // Set up message handler for this specific task
            const messageHandler = (e) => {
                const { taskId, result, error } = e.data;

                if (taskId === task.id) {
                    // Clean up
                    workerWrapper.worker.removeEventListener('message', messageHandler);
                    workerWrapper.worker.removeEventListener('error', errorHandler);
                    workerWrapper.busy = false;
                    workerWrapper.currentTask = null;

                    // Resolve or reject the promise
                    if (error) {
                        task.reject(new Error(error));
                    } else {
                        task.resolve(result);
                    }

                    // Process next task in queue
                    this.processQueue();
                }
            };

            const errorHandler = (error) => {
                console.error('[WorkerPool] Worker error:', error);
                workerWrapper.worker.removeEventListener('message', messageHandler);
                workerWrapper.worker.removeEventListener('error', errorHandler);
                workerWrapper.busy = false;
                workerWrapper.currentTask = null;

                task.reject(error);

                // Process next task in queue
                this.processQueue();
            };

            workerWrapper.worker.addEventListener('message', messageHandler);
            workerWrapper.worker.addEventListener('error', errorHandler);

            // Send task to worker
            workerWrapper.worker.postMessage({
                taskId: task.id,
                data: task.data,
            });
        }

        /**
         * Process the next task in the queue
         * @private
         */
        processQueue() {
            if (this.taskQueue.length === 0) {
                return;
            }

            const availableWorker = this.workers.find((w) => !w.busy);
            if (availableWorker) {
                const task = this.taskQueue.shift();
                this.assignTask(availableWorker, task);
            }
        }

        /**
         * Get pool statistics
         */
        getStats() {
            return {
                poolSize: this.poolSize,
                busyWorkers: this.workers.filter((w) => w.busy).length,
                queuedTasks: this.taskQueue.length,
                totalWorkers: this.workers.length,
            };
        }

        /**
         * Terminate all workers and clean up
         */
        terminate() {
            for (const workerWrapper of this.workers) {
                workerWrapper.worker.terminate();
            }

            this.workers = [];
            this.taskQueue = [];
            this.initialized = false;
        }
    }

    /**
     * Expected Value Calculator Worker Manager
     * Manages a worker pool for parallel EV container calculations
     */


    // Worker pool instance
    let workerPool = null;

    // Worker script as inline string
    const WORKER_SCRIPT = `
// Cache for EV calculation results
const evCache = new Map();

/**
 * Calculate expected value for a single container
 * @param {Object} data - Container calculation data
 * @returns {Object} {containerHrid, ev}
 */
function calculateContainerEV(data) {
    const { containerHrid, dropTable, priceMap, COIN_HRID, MARKET_TAX } = data;

    if (!dropTable || dropTable.length === 0) {
        return { containerHrid, ev: null };
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
        const priceData = priceMap[itemHrid];
        if (!priceData || priceData.price === null) {
            continue; // Skip drops with missing data
        }

        const price = priceData.price;
        const canBeSold = priceData.canBeSold;
        const isCoin = itemHrid === COIN_HRID;

        // Calculate drop value with tax
        const dropValue = isCoin
            ? avgCount * dropRate * price
            : canBeSold
              ? avgCount * dropRate * price * (1 - MARKET_TAX)
              : avgCount * dropRate * price;

        totalExpectedValue += dropValue;
    }

    return { containerHrid, ev: totalExpectedValue };
}

/**
 * Calculate EV for a batch of containers
 * @param {Array} containers - Array of container data objects
 * @returns {Array} Array of {containerHrid, ev} results
 */
function calculateBatchEV(containers) {
    const results = [];

    for (const container of containers) {
        const result = calculateContainerEV(container);
        if (result.ev !== null) {
            evCache.set(result.containerHrid, result.ev);
        }
        results.push(result);
    }

    return results;
}

self.onmessage = function (e) {
    const { taskId, data } = e.data;
    try {
        const { action, params } = data;

        if (action === 'calculateBatch') {
            const results = calculateBatchEV(params.containers);
            self.postMessage({ taskId, result: results });
        } else if (action === 'clearCache') {
            evCache.clear();
            self.postMessage({ taskId, result: { success: true, message: 'Cache cleared' } });
        } else {
            throw new Error(\`Unknown action: \${action}\`);
        }
    } catch (error) {
        self.postMessage({ taskId, error: error.message || String(error) });
    }
};
`;

    /**
     * Get or create the worker pool instance
     */
    async function getWorkerPool() {
        if (workerPool) {
            return workerPool;
        }

        try {
            // Create worker blob from inline script
            const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });

            // Initialize worker pool with 2-4 workers
            workerPool = new WorkerPool(blob);
            await workerPool.initialize();

            return workerPool;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Calculate EV for multiple containers in parallel
     * @param {Array} containers - Array of container data objects
     * @returns {Promise<Array>} Array of {containerHrid, ev} results
     */
    async function calculateEVBatch(containers) {
        const pool = await getWorkerPool();

        // Split containers into chunks for parallel processing
        const chunkSize = Math.ceil(containers.length / pool.getStats().poolSize);
        const chunks = [];

        for (let i = 0; i < containers.length; i += chunkSize) {
            chunks.push(containers.slice(i, i + chunkSize));
        }

        // Process chunks in parallel
        const tasks = chunks.map((chunk) => ({
            action: 'calculateBatch',
            params: { containers: chunk },
        }));

        const results = await pool.executeAll(tasks);

        // Flatten results
        return results.flat();
    }

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

            // Calculate all containers with 4-iteration convergence for nesting (now async with workers)
            await this.calculateNestedContainers();

            this.isInitialized = true;

            // Notify listeners that calculator is ready
            dataManager.emit('expected_value_initialized', { timestamp: Date.now() });

            return true;
        }

        /**
         * Calculate all containers with nested convergence using workers
         * Iterates 4 times to resolve nested container values
         */
        async calculateNestedContainers() {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return;
            }

            // Get all openable container HRIDs
            const containerHrids = Object.keys(initData.openableLootDropMap);

            // Iterate 4 times for convergence (handles nesting depth)
            for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
                // Build price map for all items (includes cached container EVs from previous iterations)
                const priceMap = this.buildPriceMap(containerHrids, initData);

                // Prepare container data for workers
                const containerData = containerHrids.map((containerHrid) => ({
                    containerHrid,
                    dropTable: initData.openableLootDropMap[containerHrid],
                    priceMap,
                    COIN_HRID: this.COIN_HRID,
                    MARKET_TAX: this.MARKET_TAX,
                }));

                // Calculate all containers in parallel using workers
                try {
                    const results = await calculateEVBatch(containerData);

                    // Update cache with results
                    for (const result of results) {
                        if (result.ev !== null) {
                            this.containerCache.set(result.containerHrid, result.ev);
                        }
                    }
                } catch {
                    // Worker failed, fall back to main thread calculation
                    for (const containerHrid of containerHrids) {
                        const ev = this.calculateSingleContainer(containerHrid, initData);
                        if (ev !== null) {
                            this.containerCache.set(containerHrid, ev);
                        }
                    }
                }
            }
        }

        /**
         * Build price map for all items needed for container calculations
         * @param {Array} containerHrids - Array of container HRIDs
         * @param {Object} initData - Game data
         * @returns {Object} Map of itemHrid to {price, canBeSold}
         */
        buildPriceMap(containerHrids, initData) {
            const priceMap = {};
            const processedItems = new Set();

            // Collect all unique items from all containers
            for (const containerHrid of containerHrids) {
                const dropTable = initData.openableLootDropMap[containerHrid];
                if (!dropTable) continue;

                for (const drop of dropTable) {
                    const itemHrid = drop.itemHrid;
                    if (processedItems.has(itemHrid)) continue;
                    processedItems.add(itemHrid);

                    // Get price and tradeable status
                    const price = this.getDropPrice(itemHrid);
                    const itemDetails = dataManager.getItemDetails(itemHrid);
                    const canBeSold = itemDetails?.tradeable !== false;

                    priceMap[itemHrid] = {
                        price,
                        canBeSold,
                    };
                }
            }

            return priceMap;
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

                // Special case: Coin never has market tax (it's currency, not a market item)
                const isCoin = itemHrid === this.COIN_HRID;

                const dropValue = isCoin
                    ? avgCount * dropRate * price // No tax for coins
                    : canBeSold
                      ? calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                      : avgCount * dropRate * price;
                totalExpectedValue += dropValue;
            }

            // Cache the result for future lookups
            if (totalExpectedValue > 0) {
                this.containerCache.set(containerHrid, totalExpectedValue);
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
                const bagValue = getItemPrice(this.COWBELL_BAG_HRID, { context: 'profit', side: 'sell' }) || 0;

                if (bagValue > 0) {
                    // Apply 18% market tax (Cowbell Bag only), then divide by 10
                    return calculatePriceAfterTax(bagValue, 0.18) / 10;
                }
                return null; // No bag price available
            }

            // Special case: Dungeon Tokens (calculate value from shop items)
            if (this.DUNGEON_TOKENS.includes(itemHrid)) {
                return calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', 'expectedValue_respectPricingMode');
            }

            // Check if this is a nested container (use cached EV)
            if (this.containerCache.has(itemHrid)) {
                return this.containerCache.get(itemHrid);
            }

            // Regular market item - get price based on pricing mode (sell side - you're selling drops)
            const dropPrice = getItemPrice(itemHrid, { enhancementLevel: 0, context: 'profit', side: 'sell' });
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

                // Special case: Coin never has market tax (it's currency, not a market item)
                const isCoin = itemHrid === this.COIN_HRID;

                const dropValue =
                    price !== null
                        ? isCoin
                            ? avgCount * dropRate * price // No tax for coins
                            : itemCanBeSold
                              ? calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
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
     * Equipment Parser Utility
     * Parses equipment bonuses for action calculations
     *
     * PART OF EFFICIENCY SYSTEM (Phase 1 of 3):
     * - Phase 1 ✅: Equipment speed bonuses (this module) + level advantage
     * - Phase 2 ✅: Community buffs + house rooms (WebSocket integration)
     * - Phase 3 ✅: Consumable buffs (tea parser integration)
     *
     * Speed bonuses are MULTIPLICATIVE with time (reduce duration).
     * Efficiency bonuses are ADDITIVE with each other, then MULTIPLICATIVE with time.
     *
     * Formula: actionTime = baseTime / (1 + totalEfficiency + totalSpeed)
     */

    /**
     * Map action type HRID to equipment field name
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/cheesesmithing")
     * @param {string} suffix - Field suffix (e.g., "Speed", "Efficiency", "RareFind")
     * @param {Array<string>} validFields - Array of valid field names
     * @returns {string|null} Field name (e.g., "cheesesmithingSpeed") or null
     */
    function getFieldForActionType(actionTypeHrid, suffix, validFields) {
        if (!actionTypeHrid) {
            return null;
        }

        // Extract skill name from action type HRID
        // e.g., "/action_types/cheesesmithing" -> "cheesesmithing"
        const skillName = actionTypeHrid.replace('/action_types/', '');

        // Map to field name with suffix
        // e.g., "cheesesmithing" + "Speed" -> "cheesesmithingSpeed"
        const fieldName = skillName + suffix;

        return validFields.includes(fieldName) ? fieldName : null;
    }

    /**
     * Enhancement percentage table (based on game mechanics)
     * Each enhancement level provides a percentage boost to base stats
     */
    const ENHANCEMENT_PERCENTAGES = {
        0: 0.0,
        1: 0.02, // 2.0%
        2: 0.042, // 4.2%
        3: 0.066, // 6.6%
        4: 0.092, // 9.2%
        5: 0.12, // 12.0%
        6: 0.15, // 15.0%
        7: 0.182, // 18.2%
        8: 0.216, // 21.6%
        9: 0.252, // 25.2%
        10: 0.29, // 29.0%
        11: 0.334, // 33.4%
        12: 0.384, // 38.4%
        13: 0.44, // 44.0%
        14: 0.502, // 50.2%
        15: 0.57, // 57.0%
        16: 0.644, // 64.4%
        17: 0.724, // 72.4%
        18: 0.81, // 81.0%
        19: 0.902, // 90.2%
        20: 1.0, // 100.0%
    };

    /**
     * Slot multipliers for enhancement bonuses
     * Accessories get 5× bonus, weapons/armor get 1× bonus
     * Keys use item_locations (not equipment_types) to match characterEquipment map keys
     */
    const SLOT_MULTIPLIERS = {
        '/item_locations/neck': 5, // Necklace
        '/item_locations/ring': 5, // Ring
        '/item_locations/earrings': 5, // Earrings
        '/item_locations/back': 5, // Back/Cape
        '/item_locations/trinket': 5, // Trinket
        '/item_locations/charm': 5, // Charm
        '/item_locations/main_hand': 1, // Main hand weapon
        '/item_locations/two_hand': 1, // Two-handed weapon
        '/item_locations/off_hand': 1, // Off-hand/shield
        '/item_locations/head': 1, // Head armor
        '/item_locations/body': 1, // Body armor
        '/item_locations/legs': 1, // Leg armor
        '/item_locations/hands': 1, // Hand armor
        '/item_locations/feet': 1, // Feet armor
        '/item_locations/pouch': 1, // Pouch
    };

    /**
     * Calculate enhancement scaling for equipment stats
     * Uses percentage-based enhancement system with slot multipliers
     *
     * Formula: base × (1 + enhancementPercentage × slotMultiplier)
     *
     * @param {number} baseValue - Base stat value from item data
     * @param {number} enhancementLevel - Enhancement level (0-20)
     * @param {string} slotHrid - Equipment slot HRID (e.g., "/equipment_types/neck")
     * @returns {number} Scaled stat value
     *
     * @example
     * // Philosopher's Necklace +4 (4% base speed, neck slot 5×)
     * calculateEnhancementScaling(0.04, 4, '/equipment_types/neck')
     * // = 0.04 × (1 + 0.092 × 5) = 0.04 × 1.46 = 0.0584 (5.84%)
     *
     * // Lumberjack's Top +10 (10% base efficiency, body slot 1×)
     * calculateEnhancementScaling(0.10, 10, '/equipment_types/body')
     * // = 0.10 × (1 + 0.290 × 1) = 0.10 × 1.29 = 0.129 (12.9%)
     */
    function calculateEnhancementScaling(baseValue, enhancementLevel, slotHrid) {
        if (enhancementLevel === 0) {
            return baseValue;
        }

        // Get enhancement percentage from table
        const enhancementPercentage = ENHANCEMENT_PERCENTAGES[enhancementLevel] || 0;

        // Get slot multiplier (default to 1× if slot not found)
        const slotMultiplier = SLOT_MULTIPLIERS[slotHrid] || 1;

        // Apply formula: base × (1 + percentage × multiplier)
        return baseValue * (1 + enhancementPercentage * slotMultiplier);
    }

    /**
     * Generic equipment stat parser - handles all noncombat stats with consistent logic
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {Object} config - Parser configuration
     * @param {string|null} config.skillSpecificField - Skill-specific field (e.g., "brewingSpeed")
     * @param {string|null} config.genericField - Generic skilling field (e.g., "skillingSpeed")
     * @param {boolean} config.returnAsPercentage - Whether to convert to percentage (multiply by 100)
     * @returns {number} Total stat bonus
     *
     * @example
     * // Parse speed bonuses for brewing
     * parseEquipmentStat(equipment, items, {
     *   skillSpecificField: "brewingSpeed",
     *   genericField: "skillingSpeed",
     *   returnAsPercentage: false
     * })
     */
    function parseEquipmentStat(characterEquipment, itemDetailMap, config) {
        if (!characterEquipment || characterEquipment.size === 0) {
            return 0; // No equipment
        }

        if (!itemDetailMap) {
            return 0; // Missing item data
        }

        const { skillSpecificField, genericField, returnAsPercentage } = config;

        let totalBonus = 0;

        // Iterate through all equipped items
        for (const [slotHrid, equippedItem] of characterEquipment) {
            // Get item details from game data
            const itemDetails = itemDetailMap[equippedItem.itemHrid];

            if (!itemDetails || !itemDetails.equipmentDetail) {
                continue; // Not an equipment item
            }

            // Check if item has noncombat stats
            const noncombatStats = itemDetails.equipmentDetail.noncombatStats;

            if (!noncombatStats) {
                continue; // No noncombat stats
            }

            // Get enhancement level from equipped item
            const enhancementLevel = equippedItem.enhancementLevel || 0;

            // Check for skill-specific stat (e.g., brewingSpeed, brewingEfficiency, brewingRareFind)
            if (skillSpecificField) {
                const baseValue = noncombatStats[skillSpecificField];

                if (baseValue && baseValue > 0) {
                    const scaledValue = calculateEnhancementScaling(baseValue, enhancementLevel, slotHrid);
                    totalBonus += scaledValue;
                }
            }

            // Check for generic skilling stat (e.g., skillingSpeed, skillingEfficiency, skillingRareFind, skillingEssenceFind)
            if (genericField) {
                const baseValue = noncombatStats[genericField];

                if (baseValue && baseValue > 0) {
                    const scaledValue = calculateEnhancementScaling(baseValue, enhancementLevel, slotHrid);
                    totalBonus += scaledValue;
                }
            }
        }

        // Convert to percentage if requested (0.15 -> 15%)
        return returnAsPercentage ? totalBonus * 100 : totalBonus;
    }

    /**
     * Valid speed fields from game data
     */
    const VALID_SPEED_FIELDS = [
        'milkingSpeed',
        'foragingSpeed',
        'woodcuttingSpeed',
        'cheesesmithingSpeed',
        'craftingSpeed',
        'tailoringSpeed',
        'brewingSpeed',
        'cookingSpeed',
        'alchemySpeed',
        'enhancingSpeed',
        'taskSpeed',
    ];

    /**
     * Parse equipment speed bonuses for a specific action type
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {string} actionTypeHrid - Action type HRID
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total speed bonus as decimal (e.g., 0.15 for 15%)
     *
     * @example
     * parseEquipmentSpeedBonuses(equipment, "/action_types/brewing", items)
     * // Cheese Pot (base 0.15, bonus 0.003) +0: 0.15 (15%)
     * // Cheese Pot (base 0.15, bonus 0.003) +10: 0.18 (18%)
     * // Azure Pot (base 0.3, bonus 0.006) +10: 0.36 (36%)
     */
    function parseEquipmentSpeedBonuses(characterEquipment, actionTypeHrid, itemDetailMap) {
        const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Speed', VALID_SPEED_FIELDS);

        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField,
            genericField: 'skillingSpeed',
            returnAsPercentage: false,
        });
    }

    /**
     * Valid efficiency fields from game data
     */
    const VALID_EFFICIENCY_FIELDS = [
        'milkingEfficiency',
        'foragingEfficiency',
        'woodcuttingEfficiency',
        'cheesesmithingEfficiency',
        'craftingEfficiency',
        'tailoringEfficiency',
        'brewingEfficiency',
        'cookingEfficiency',
        'alchemyEfficiency',
    ];

    /**
     * Parse equipment efficiency bonuses for a specific action type
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {string} actionTypeHrid - Action type HRID
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total efficiency bonus as percentage (e.g., 12 for 12%)
     *
     * @example
     * parseEquipmentEfficiencyBonuses(equipment, "/action_types/brewing", items)
     * // Brewer's Top (base 0.1, bonus 0.002) +0: 10%
     * // Brewer's Top (base 0.1, bonus 0.002) +10: 12%
     * // Philosopher's Necklace (skillingEfficiency 0.02, bonus 0.002) +10: 4%
     * // Total: 16%
     */
    function parseEquipmentEfficiencyBonuses(characterEquipment, actionTypeHrid, itemDetailMap) {
        const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Efficiency', VALID_EFFICIENCY_FIELDS);

        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField,
            genericField: 'skillingEfficiency',
            returnAsPercentage: true,
        });
    }

    /**
     * Parse Essence Find bonus from equipment
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total essence find bonus as percentage (e.g., 15 for 15%)
     *
     * @example
     * parseEssenceFindBonus(equipment, items)
     * // Ring of Essence Find (base 0.15, bonus 0.015) +0: 15%
     * // Ring of Essence Find (base 0.15, bonus 0.015) +10: 30%
     */
    function parseEssenceFindBonus(characterEquipment, itemDetailMap) {
        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField: null, // No skill-specific essence find
            genericField: 'skillingEssenceFind',
            returnAsPercentage: true,
        });
    }

    /**
     * Valid rare find fields from game data
     */
    const VALID_RARE_FIND_FIELDS = [
        'milkingRareFind',
        'foragingRareFind',
        'woodcuttingRareFind',
        'cheesesmithingRareFind',
        'craftingRareFind',
        'tailoringRareFind',
        'brewingRareFind',
        'cookingRareFind',
        'alchemyRareFind',
        'enhancingRareFind',
    ];

    /**
     * Parse Rare Find bonus from equipment
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {string} actionTypeHrid - Action type HRID (for skill-specific rare find)
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total rare find bonus as percentage (e.g., 15 for 15%)
     *
     * @example
     * parseRareFindBonus(equipment, "/action_types/brewing", items)
     * // Brewer's Top (base 0.15, bonus 0.003) +0: 15%
     * // Brewer's Top (base 0.15, bonus 0.003) +10: 18%
     * // Earrings of Rare Find (base 0.08, bonus 0.002) +0: 8%
     * // Total: 26%
     */
    function parseRareFindBonus(characterEquipment, actionTypeHrid, itemDetailMap) {
        const skillSpecificField = getFieldForActionType(actionTypeHrid, 'RareFind', VALID_RARE_FIND_FIELDS);

        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField,
            genericField: 'skillingRareFind',
            returnAsPercentage: true,
        });
    }

    /**
     * Get all speed bonuses for debugging
     * @param {Map} characterEquipment - Equipment map
     * @param {Object} itemDetailMap - Item details
     * @returns {Array} Array of speed bonus objects
     */
    function debugEquipmentSpeedBonuses(characterEquipment, itemDetailMap) {
        if (!characterEquipment || characterEquipment.size === 0) {
            return [];
        }

        const bonuses = [];

        for (const [slotHrid, equippedItem] of characterEquipment) {
            const itemDetails = itemDetailMap[equippedItem.itemHrid];

            if (!itemDetails || !itemDetails.equipmentDetail) {
                continue;
            }

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats;

            if (!noncombatStats) {
                continue;
            }

            // Find all speed bonuses on this item
            for (const [statName, value] of Object.entries(noncombatStats)) {
                if (statName.endsWith('Speed') && value > 0) {
                    const enhancementLevel = equippedItem.enhancementLevel || 0;
                    const scaledValue = calculateEnhancementScaling(value, enhancementLevel, slotHrid);

                    bonuses.push({
                        itemName: itemDetails.name,
                        itemHrid: equippedItem.itemHrid,
                        slot: slotHrid,
                        speedType: statName,
                        baseBonus: value,
                        enhancementLevel,
                        scaledBonus: scaledValue,
                    });
                }
            }
        }

        return bonuses;
    }

    var equipmentParser = /*#__PURE__*/Object.freeze({
        __proto__: null,
        debugEquipmentSpeedBonuses: debugEquipmentSpeedBonuses,
        parseEquipmentEfficiencyBonuses: parseEquipmentEfficiencyBonuses,
        parseEquipmentSpeedBonuses: parseEquipmentSpeedBonuses,
        parseEssenceFindBonus: parseEssenceFindBonus,
        parseRareFindBonus: parseRareFindBonus
    });

    /**
     * House Efficiency Utility
     * Calculates efficiency bonuses from house rooms
     *
     * PART OF EFFICIENCY SYSTEM (Phase 2):
     * - House rooms provide +1.5% efficiency per level to matching actions
     * - Formula: houseLevel × 1.5%
     * - Data source: WebSocket (characterHouseRoomMap)
     */


    /**
     * Map action type HRID to house room HRID
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @returns {string|null} House room HRID or null
     */
    function getHouseRoomForActionType(actionTypeHrid) {
        // Mapping matches original MWI Tools
        const actionTypeToHouseRoomMap = {
            '/action_types/brewing': '/house_rooms/brewery',
            '/action_types/cheesesmithing': '/house_rooms/forge',
            '/action_types/cooking': '/house_rooms/kitchen',
            '/action_types/crafting': '/house_rooms/workshop',
            '/action_types/foraging': '/house_rooms/garden',
            '/action_types/milking': '/house_rooms/dairy_barn',
            '/action_types/tailoring': '/house_rooms/sewing_parlor',
            '/action_types/woodcutting': '/house_rooms/log_shed',
            '/action_types/alchemy': '/house_rooms/laboratory',
        };

        return actionTypeToHouseRoomMap[actionTypeHrid] || null;
    }

    /**
     * Calculate house efficiency bonus for an action type
     * @param {string} actionTypeHrid - Action type HRID
     * @returns {number} Efficiency bonus percentage (e.g., 12 for 12%)
     *
     * @example
     * calculateHouseEfficiency("/action_types/brewing")
     * // Returns: 12 (if brewery is level 8: 8 × 1.5% = 12%)
     */
    function calculateHouseEfficiency(actionTypeHrid) {
        // Get the house room for this action type
        const houseRoomHrid = getHouseRoomForActionType(actionTypeHrid);

        if (!houseRoomHrid) {
            return 0; // No house room for this action type
        }

        // Get house room level from game data (via dataManager)
        const roomLevel = dataManager.getHouseRoomLevel(houseRoomHrid);

        // Formula: houseLevel × 1.5%
        // Returns as percentage (e.g., 12 for 12%)
        return roomLevel * 1.5;
    }

    /**
     * Get friendly name for house room
     * @param {string} houseRoomHrid - House room HRID
     * @returns {string} Friendly name
     */
    function getHouseRoomName(houseRoomHrid) {
        const names = {
            '/house_rooms/brewery': 'Brewery',
            '/house_rooms/forge': 'Forge',
            '/house_rooms/kitchen': 'Kitchen',
            '/house_rooms/workshop': 'Workshop',
            '/house_rooms/garden': 'Garden',
            '/house_rooms/dairy_barn': 'Dairy Barn',
            '/house_rooms/sewing_parlor': 'Sewing Parlor',
            '/house_rooms/log_shed': 'Log Shed',
            '/house_rooms/laboratory': 'Laboratory',
        };

        return names[houseRoomHrid] || 'Unknown';
    }

    /**
     * Calculate total Rare Find bonus from all house rooms
     * @returns {number} Total rare find bonus as percentage (e.g., 1.6 for 1.6%)
     *
     * @example
     * calculateHouseRareFind()
     * // Returns: 1.6 (if total house room levels = 8: 8 × 0.2% per level = 1.6%)
     *
     * Formula from game data:
     * - flatBoostLevelBonus: 0.2% per level
     * - Total: totalLevels × 0.2%
     * - Max: 8 rooms × 8 levels = 64 × 0.2% = 12.8%
     */
    function calculateHouseRareFind() {
        // Get all house rooms
        const houseRooms = dataManager.getHouseRooms();

        if (!houseRooms || houseRooms.size === 0) {
            return 0; // No house rooms
        }

        // Sum all house room levels
        let totalLevels = 0;
        for (const [_hrid, room] of houseRooms) {
            totalLevels += room.level || 0;
        }

        // Formula: totalLevels × flatBoostLevelBonus
        // flatBoostLevelBonus: 0.2% per level (no base bonus)
        const flatBoostLevelBonus = 0.2;

        return totalLevels * flatBoostLevelBonus;
    }

    var houseEfficiency = {
        calculateHouseEfficiency,
        getHouseRoomName,
        calculateHouseRareFind,
    };

    var houseEfficiency$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateHouseEfficiency: calculateHouseEfficiency,
        calculateHouseRareFind: calculateHouseRareFind,
        default: houseEfficiency,
        getHouseRoomName: getHouseRoomName
    });

    /**
     * Bonus Revenue Calculator Utility
     * Calculates revenue from essence and rare find drops
     * Shared by both gathering and production profit calculators
     */


    /**
     * Calculate bonus revenue from essence and rare find drops
     * @param {Object} actionDetails - Action details from game data
     * @param {number} actionsPerHour - Base actions per hour (efficiency not applied)
     * @param {Map} characterEquipment - Equipment map
     * @param {Object} itemDetailMap - Item details map
     * @returns {Object} Bonus revenue data with essence and rare find drops
     */
    function calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap) {
        // Get Essence Find bonus from equipment
        const essenceFindBonus = parseEssenceFindBonus(characterEquipment, itemDetailMap);

        // Get Rare Find bonus from BOTH equipment and house rooms
        const equipmentRareFindBonus = parseRareFindBonus(characterEquipment, actionDetails.type, itemDetailMap);
        const houseRareFindBonus = calculateHouseRareFind();
        const achievementRareFindBonus =
            dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/rare_find') * 100;
        const rareFindBonus = equipmentRareFindBonus + houseRareFindBonus + achievementRareFindBonus;
        const rareFindBreakdown = {
            equipment: equipmentRareFindBonus,
            house: houseRareFindBonus,
            achievement: achievementRareFindBonus,
        };

        const bonusDrops = [];
        let totalBonusRevenue = 0;
        let hasMissingPrices = false;

        // Process essence drops
        if (actionDetails.essenceDropTable && actionDetails.essenceDropTable.length > 0) {
            for (const drop of actionDetails.essenceDropTable) {
                const itemDetails = itemDetailMap[drop.itemHrid];
                if (!itemDetails) continue;

                // Calculate average drop count
                const avgCount = (drop.minCount + drop.maxCount) / 2;

                // Apply Essence Find multiplier to drop rate
                const finalDropRate = drop.dropRate * (1 + essenceFindBonus / 100);

                // Expected drops per hour
                const dropsPerHour = actionsPerHour * finalDropRate * avgCount;

                // Get price: Check if openable container (use EV), otherwise market price
                let itemPrice = 0;
                let isMissingPrice = false;
                if (itemDetails.isOpenable) {
                    // Use expected value for openable containers (with on-demand fallback)
                    itemPrice =
                        expectedValueCalculator.getCachedValue(drop.itemHrid) ||
                        expectedValueCalculator.calculateSingleContainer(drop.itemHrid) ||
                        0;
                } else {
                    // Use market price for regular items
                    const price = marketAPI.getPrice(drop.itemHrid, 0);
                    itemPrice = price?.bid ?? 0; // Use bid price (instant sell)
                    isMissingPrice = price?.bid === null || price?.bid === undefined;
                }

                // Revenue per hour from this drop
                const revenuePerHour = dropsPerHour * itemPrice;
                const dropsPerAction = actionsPerHour > 0 ? dropsPerHour / actionsPerHour : 0;
                const revenuePerAction = actionsPerHour > 0 ? revenuePerHour / actionsPerHour : 0;

                bonusDrops.push({
                    itemHrid: drop.itemHrid,
                    itemName: itemDetails.name,
                    dropRate: finalDropRate,
                    dropsPerHour,
                    dropsPerAction,
                    priceEach: itemPrice,
                    revenuePerHour,
                    revenuePerAction,
                    type: 'essence',
                    missingPrice: isMissingPrice,
                });

                totalBonusRevenue += revenuePerHour;
                if (isMissingPrice) {
                    hasMissingPrices = true;
                }
            }
        }

        // Process rare find drops
        if (actionDetails.rareDropTable && actionDetails.rareDropTable.length > 0) {
            for (const drop of actionDetails.rareDropTable) {
                const itemDetails = itemDetailMap[drop.itemHrid];
                if (!itemDetails) continue;

                // Calculate average drop count
                const avgCount = (drop.minCount + drop.maxCount) / 2;

                // Apply Rare Find multiplier to drop rate
                const finalDropRate = drop.dropRate * (1 + rareFindBonus / 100);

                // Expected drops per hour
                const dropsPerHour = actionsPerHour * finalDropRate * avgCount;

                // Get price: Check if openable container (use EV), otherwise market price
                let itemPrice = 0;
                let isMissingPrice = false;
                if (itemDetails.isOpenable) {
                    // Use expected value for openable containers (with on-demand fallback)
                    itemPrice =
                        expectedValueCalculator.getCachedValue(drop.itemHrid) ||
                        expectedValueCalculator.calculateSingleContainer(drop.itemHrid) ||
                        0;
                } else {
                    // Use market price for regular items
                    const price = marketAPI.getPrice(drop.itemHrid, 0);
                    itemPrice = price?.bid ?? 0; // Use bid price (instant sell)
                    isMissingPrice = price?.bid === null || price?.bid === undefined;
                }

                // Revenue per hour from this drop
                const revenuePerHour = dropsPerHour * itemPrice;
                const dropsPerAction = actionsPerHour > 0 ? dropsPerHour / actionsPerHour : 0;
                const revenuePerAction = actionsPerHour > 0 ? revenuePerHour / actionsPerHour : 0;

                bonusDrops.push({
                    itemHrid: drop.itemHrid,
                    itemName: itemDetails.name,
                    dropRate: finalDropRate,
                    dropsPerHour,
                    dropsPerAction,
                    priceEach: itemPrice,
                    revenuePerHour,
                    revenuePerAction,
                    type: 'rare_find',
                    missingPrice: isMissingPrice,
                });

                totalBonusRevenue += revenuePerHour;
                if (isMissingPrice) {
                    hasMissingPrices = true;
                }
            }
        }

        return {
            essenceFindBonus, // Essence Find % from equipment
            rareFindBonus, // Rare Find % from equipment + house rooms + achievements (combined)
            rareFindBreakdown,
            bonusDrops, // Array of all bonus drops with details
            totalBonusRevenue, // Total revenue/hour from all bonus drops
            hasMissingPrices,
        };
    }

    var bonusRevenueCalculator = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateBonusRevenue: calculateBonusRevenue
    });

    /**
     * Enhancement Multiplier System
     *
     * Handles enhancement bonus calculations for equipment.
     * Different equipment slots have different multipliers:
     * - Accessories (neck/ring/earring), Back, Trinket, Charm: 5× multiplier
     * - All other slots (weapons, armor, pouch): 1× multiplier
     */

    /**
     * Enhancement multiplier by equipment slot type
     */
    const ENHANCEMENT_MULTIPLIERS = {
        '/equipment_types/neck': 5,
        '/equipment_types/ring': 5,
        '/equipment_types/earring': 5,
        '/equipment_types/back': 5,
        '/equipment_types/trinket': 5,
        '/equipment_types/charm': 5,
        // All other slots: 1× (default)
    };

    /**
     * Enhancement bonus table
     * Maps enhancement level to percentage bonus
     */
    const ENHANCEMENT_BONUSES = {
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

    /**
     * Get enhancement multiplier for an item
     * @param {Object} itemDetails - Item details from itemDetailMap
     * @param {number} enhancementLevel - Current enhancement level of item
     * @returns {number} Multiplier to apply to bonuses
     */
    function getEnhancementMultiplier(itemDetails, enhancementLevel) {
        if (enhancementLevel === 0) {
            return 1;
        }

        const equipmentType = itemDetails?.equipmentDetail?.type;
        const slotMultiplier = ENHANCEMENT_MULTIPLIERS[equipmentType] || 1;
        const enhancementBonus = ENHANCEMENT_BONUSES[enhancementLevel] || 0;

        return 1 + enhancementBonus * slotMultiplier;
    }

    var enhancementMultipliers = /*#__PURE__*/Object.freeze({
        __proto__: null,
        ENHANCEMENT_BONUSES: ENHANCEMENT_BONUSES,
        ENHANCEMENT_MULTIPLIERS: ENHANCEMENT_MULTIPLIERS,
        getEnhancementMultiplier: getEnhancementMultiplier
    });

    /**
     * Experience Parser Utility
     * Parses wisdom and experience bonuses from all sources
     *
     * Experience Formula (Skilling):
     * Final XP = Base XP × (1 + Wisdom + Charm Experience)
     *
     * Where Wisdom and Charm Experience are ADDITIVE
     */


    /**
     * Parse equipment wisdom bonus (skillingExperience stat)
     * @param {Map} equipment - Character equipment map
     * @param {Object} itemDetailMap - Item details from game data
     * @returns {Object} {total: number, breakdown: Array} Total wisdom and item breakdown
     */
    function parseEquipmentWisdom(equipment, itemDetailMap) {
        let totalWisdom = 0;
        const breakdown = [];

        for (const [_slot, item] of equipment) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail) continue;

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
            const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};

            // Get base skillingExperience
            const baseWisdom = noncombatStats.skillingExperience || 0;
            if (baseWisdom === 0) continue;

            // Get enhancement scaling
            const enhancementBonus = noncombatEnhancement.skillingExperience || 0;
            const enhancementLevel = item.enhancementLevel || 0;

            // Calculate total wisdom from this item
            // Enhancement scales quadratically: level × (1 + 0.05 × (level - 1))
            const enhancementTotal =
                enhancementBonus * (enhancementLevel + (0.1 * enhancementLevel * (enhancementLevel - 1)) / 2);
            const itemWisdom = (baseWisdom + enhancementTotal) * 100;
            totalWisdom += itemWisdom;

            // Add to breakdown
            breakdown.push({
                name: itemDetails.name,
                value: itemWisdom,
                enhancementLevel: enhancementLevel,
            });
        }

        return {
            total: totalWisdom,
            breakdown: breakdown,
        };
    }

    /**
     * Parse skill-specific charm experience (e.g., foragingExperience)
     * @param {Map} equipment - Character equipment map
     * @param {string} skillHrid - Skill HRID (e.g., "/skills/foraging")
     * @param {Object} itemDetailMap - Item details from game data
     * @returns {Object} {total: number, breakdown: Array} Total charm XP and item breakdown
     */
    function parseCharmExperience(equipment, skillHrid, itemDetailMap) {
        let totalCharmXP = 0;
        const breakdown = [];

        // Convert skill HRID to stat name (e.g., "/skills/foraging" → "foragingExperience")
        const skillName = skillHrid.replace('/skills/', '');
        const statName = `${skillName}Experience`;

        for (const [_slot, item] of equipment) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail) continue;

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
            const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};

            // Get base charm experience
            const baseCharmXP = noncombatStats[statName] || 0;
            if (baseCharmXP === 0) continue;

            // Get enhancement scaling
            const enhancementBonus = noncombatEnhancement[statName] || 0;
            const enhancementLevel = item.enhancementLevel || 0;

            // Calculate total charm XP from this item
            // Enhancement scales quadratically: level × (1 + 0.05 × (level - 1))
            const enhancementTotal =
                enhancementBonus * (enhancementLevel + (0.1 * enhancementLevel * (enhancementLevel - 1)) / 2);
            const itemCharmXP = (baseCharmXP + enhancementTotal) * 100;
            totalCharmXP += itemCharmXP;

            // Add to breakdown
            breakdown.push({
                name: itemDetails.name,
                value: itemCharmXP,
                enhancementLevel: enhancementLevel,
            });
        }

        return {
            total: totalCharmXP,
            breakdown: breakdown,
        };
    }

    /**
     * Parse house room wisdom bonus
     * All house rooms provide +0.05% wisdom per level
     * @returns {number} Total wisdom from house rooms (e.g., 0.4 for 8 total levels)
     */
    function parseHouseRoomWisdom() {
        const houseRooms = dataManager.getHouseRooms();
        if (!houseRooms || houseRooms.size === 0) {
            return 0;
        }

        // Sum all house room levels
        let totalLevels = 0;
        for (const [_hrid, room] of houseRooms) {
            totalLevels += room.level || 0;
        }

        // Formula: totalLevels × 0.05% per level
        return totalLevels * 0.05;
    }

    /**
     * Parse community buff wisdom bonus
     * Formula: 20% + ((level - 1) × 0.5%)
     * @returns {number} Wisdom percentage from community buff (e.g., 29.5 for T20)
     */
    function parseCommunityBuffWisdom() {
        const buffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
        if (!buffLevel) {
            return 0;
        }

        // Formula: 20% base + 0.5% per level above 1
        return 20 + (buffLevel - 1) * 0.5;
    }

    /**
     * Parse wisdom from active consumables (Wisdom Tea/Coffee)
     * @param {Array} drinkSlots - Active drink slots for the action type
     * @param {Object} itemDetailMap - Item details from game data
     * @param {number} drinkConcentration - Drink concentration bonus (e.g., 12.16 for 12.16%)
     * @returns {number} Wisdom percentage from consumables (e.g., 13.46 for 12% × 1.1216)
     */
    function parseConsumableWisdom(drinkSlots, itemDetailMap, drinkConcentration) {
        if (!drinkSlots || drinkSlots.length === 0) {
            return 0;
        }

        let totalWisdom = 0;

        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue; // Skip empty slots

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails?.consumableDetail) continue;

            // Check for wisdom buff (typeHrid === "/buff_types/wisdom")
            const buffs = itemDetails.consumableDetail.buffs || [];
            for (const buff of buffs) {
                // Check if this is a wisdom buff by typeHrid
                if (buff.typeHrid === '/buff_types/wisdom' && buff.flatBoost) {
                    // Base wisdom (e.g., 0.12 for 12%)
                    const baseWisdom = buff.flatBoost * 100;

                    // Scale with drink concentration
                    const scaledWisdom = baseWisdom * (1 + drinkConcentration / 100);

                    totalWisdom += scaledWisdom;
                }
            }
        }

        return totalWisdom;
    }

    /**
     * Calculate total experience multiplier and breakdown
     * @param {string} skillHrid - Skill HRID (e.g., "/skills/foraging")
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
     * @returns {Object} Experience data with breakdown
     */
    function calculateExperienceMultiplier(skillHrid, actionTypeHrid) {
        const equipment = dataManager.getEquipment();
        const gameData = dataManager.getInitClientData();
        const itemDetailMap = gameData?.itemDetailMap || {};

        // Get drink concentration
        const drinkConcentration = equipment ? calculateDrinkConcentration(equipment, itemDetailMap) : 0;

        // Get active drinks for this action type
        const activeDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);

        // Parse wisdom from all sources
        const equipmentWisdomData = parseEquipmentWisdom(equipment, itemDetailMap);
        const equipmentWisdom = equipmentWisdomData.total;
        const houseWisdom = parseHouseRoomWisdom();
        const communityWisdom = parseCommunityBuffWisdom();
        const consumableWisdom = parseConsumableWisdom(activeDrinks, itemDetailMap, drinkConcentration);
        const achievementWisdom = dataManager.getAchievementBuffFlatBoost(actionTypeHrid, '/buff_types/wisdom') * 100;

        const totalWisdom = equipmentWisdom + houseWisdom + communityWisdom + consumableWisdom + achievementWisdom;

        // Parse charm experience (skill-specific) - now returns object with total and breakdown
        const charmData = parseCharmExperience(equipment, skillHrid, itemDetailMap);
        const charmExperience = charmData.total;

        // Total multiplier (additive)
        const totalMultiplier = 1 + totalWisdom / 100 + charmExperience / 100;

        return {
            totalMultiplier,
            totalWisdom,
            charmExperience,
            charmBreakdown: charmData.breakdown,
            wisdomBreakdown: equipmentWisdomData.breakdown,
            breakdown: {
                equipmentWisdom,
                houseWisdom,
                communityWisdom,
                consumableWisdom,
                achievementWisdom,
                charmExperience,
            },
        };
    }

    /**
     * Calculate drink concentration from Guzzling Pouch
     * @param {Map} equipment - Character equipment map
     * @param {Object} itemDetailMap - Item details from game data
     * @returns {number} Drink concentration percentage (e.g., 12.16 for 12.16%)
     */
    function calculateDrinkConcentration(equipment, itemDetailMap) {
        // Find Guzzling Pouch in equipment
        const pouchItem = equipment.get('/equipment_types/pouch');
        if (!pouchItem || !pouchItem.itemHrid.includes('guzzling_pouch')) {
            return 0;
        }

        const itemDetails = itemDetailMap[pouchItem.itemHrid];
        if (!itemDetails?.equipmentDetail) {
            return 0;
        }

        // Get base drink concentration
        const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
        const baseDrinkConcentration = noncombatStats.drinkConcentration || 0;

        if (baseDrinkConcentration === 0) {
            return 0;
        }

        // Get enhancement scaling
        const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};
        const enhancementBonus = noncombatEnhancement.drinkConcentration || 0;
        const enhancementLevel = pouchItem.enhancementLevel || 0;

        // Calculate total drink concentration
        // Enhancement scales quadratically: level × (1 + 0.05 × (level - 1))
        const enhancementTotal =
            enhancementBonus * (enhancementLevel + (0.1 * enhancementLevel * (enhancementLevel - 1)) / 2);
        return (baseDrinkConcentration + enhancementTotal) * 100;
    }

    var experienceParser = {
        parseEquipmentWisdom,
        parseCharmExperience,
        parseHouseRoomWisdom,
        parseCommunityBuffWisdom,
        parseConsumableWisdom,
        calculateExperienceMultiplier,
    };

    var experienceParser$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateExperienceMultiplier: calculateExperienceMultiplier,
        default: experienceParser,
        parseCharmExperience: parseCharmExperience,
        parseCommunityBuffWisdom: parseCommunityBuffWisdom,
        parseConsumableWisdom: parseConsumableWisdom,
        parseEquipmentWisdom: parseEquipmentWisdom,
        parseHouseRoomWisdom: parseHouseRoomWisdom
    });

    /**
     * Merge market listing updates into the current list.
     * @param {Array} currentListings - Existing market listings.
     * @param {Array} updatedListings - Updated listings from WebSocket.
     * @returns {Array} New merged listings array.
     */
    const mergeMarketListings = (currentListings = [], updatedListings = []) => {
        const safeCurrent = Array.isArray(currentListings) ? currentListings : [];
        const safeUpdates = Array.isArray(updatedListings) ? updatedListings : [];

        if (safeUpdates.length === 0) {
            return [...safeCurrent];
        }

        const indexById = new Map();
        safeCurrent.forEach((listing, index) => {
            if (!listing || listing.id === undefined || listing.id === null) {
                return;
            }
            indexById.set(listing.id, index);
        });

        const merged = [...safeCurrent];

        for (const listing of safeUpdates) {
            if (!listing || listing.id === undefined || listing.id === null) {
                continue;
            }

            const existingIndex = indexById.get(listing.id);
            if (existingIndex !== undefined) {
                merged[existingIndex] = listing;
            } else {
                merged.push(listing);
            }
        }

        return merged;
    };

    var marketListings = /*#__PURE__*/Object.freeze({
        __proto__: null,
        mergeMarketListings: mergeMarketListings
    });

    /**
     * Tea Buff Parser Utility
     * Calculates efficiency bonuses from active tea buffs
     *
     * Tea efficiency comes from two buff types:
     * 1. /buff_types/efficiency - Generic efficiency (e.g., Efficiency Tea: 10%)
     * 2. /buff_types/{skill}_level - Skill level bonuses (e.g., Brewing Tea: +3 levels)
     *
     * All tea effects scale with Drink Concentration equipment stat.
     */


    /**
     * Generic tea buff parser - handles all tea buff types with consistent logic
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @param {Object} config - Parser configuration
     * @param {Array<string>} config.buffTypeHrids - Buff type HRIDs to check (e.g., ['/buff_types/artisan'])
     * @returns {number} Total buff bonus
     *
     * @example
     * // Parse artisan bonus
     * parseTeaBuff(drinks, items, 0.12, { buffTypeHrids: ['/buff_types/artisan'] })
     */
    function parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, config) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return 0; // No active teas
        }

        if (!itemDetailMap) {
            return 0; // Missing required data
        }

        const { buffTypeHrids } = config;
        let totalBonus = 0;

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Check if this buff matches any of the target types
                if (buffTypeHrids.includes(buff.typeHrid)) {
                    const baseValue = buff.flatBoost;
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    totalBonus += scaledValue;
                }
            }
        }

        return totalBonus;
    }

    /**
     * Parse tea efficiency bonuses for a specific action type
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Total tea efficiency bonus as percentage (e.g., 12 for 12%)
     *
     * @example
     * // With Efficiency Tea (10% base) and 12% Drink Concentration:
     * parseTeaEfficiency("/action_types/brewing", activeDrinks, items, 0.12)
     * // Returns: 11.2 (10% × 1.12 = 11.2%)
     */
    function parseTeaEfficiency(actionTypeHrid, activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return 0; // No active teas
        }

        if (!actionTypeHrid || !itemDetailMap) {
            return 0; // Missing required data
        }

        let totalEfficiency = 0;

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Generic efficiency buff (e.g., Efficiency Tea)
                if (buff.typeHrid === '/buff_types/efficiency') {
                    const baseEfficiency = buff.flatBoost * 100; // Convert to percentage
                    const scaledEfficiency = baseEfficiency * (1 + drinkConcentration);
                    totalEfficiency += scaledEfficiency;
                }
                // Note: Skill-specific level buffs are NOT counted here
                // They affect Level Bonus calculation, not Tea Bonus
            }
        }

        return totalEfficiency;
    }

    /**
     * Parse tea efficiency bonuses with breakdown by individual tea
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {Array<{name: string, efficiency: number, baseEfficiency: number, dcContribution: number}>} Array of tea contributions
     *
     * @example
     * // With Efficiency Tea (10% base) and Ultra Cheesesmithing Tea (6% base) with 12% DC:
     * parseTeaEfficiencyBreakdown("/action_types/cheesesmithing", activeDrinks, items, 0.12)
     * // Returns: [
     * //   { name: "Efficiency Tea", efficiency: 11.2, baseEfficiency: 10.0, dcContribution: 1.2 },
     * //   { name: "Ultra Cheesesmithing Tea", efficiency: 6.72, baseEfficiency: 6.0, dcContribution: 0.72 }
     * // ]
     */
    function parseTeaEfficiencyBreakdown(actionTypeHrid, activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return []; // No active teas
        }

        if (!actionTypeHrid || !itemDetailMap) {
            return []; // Missing required data
        }

        const teaBreakdown = [];

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            let baseEfficiency = 0;
            let totalEfficiency = 0;

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Generic efficiency buff (e.g., Efficiency Tea)
                if (buff.typeHrid === '/buff_types/efficiency') {
                    const baseValue = buff.flatBoost * 100; // Convert to percentage
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    baseEfficiency += baseValue;
                    totalEfficiency += scaledValue;
                }
                // Note: Skill-specific level buffs are NOT counted here
                // They affect Level Bonus calculation, not Tea Bonus
            }

            // Only add to breakdown if this tea contributes efficiency
            if (totalEfficiency > 0) {
                teaBreakdown.push({
                    name: itemDetails.name,
                    efficiency: totalEfficiency,
                    baseEfficiency: baseEfficiency,
                    dcContribution: totalEfficiency - baseEfficiency,
                });
            }
        }

        return teaBreakdown;
    }

    /**
     * Get Drink Concentration stat from equipped items
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total drink concentration as decimal (e.g., 0.12 for 12%)
     *
     * @example
     * getDrinkConcentration(equipment, items)
     * // Returns: 0.12 (if wearing items with 12% total drink concentration)
     */
    function getDrinkConcentration(characterEquipment, itemDetailMap) {
        if (!characterEquipment || characterEquipment.size === 0) {
            return 0; // No equipment
        }

        if (!itemDetailMap) {
            return 0; // Missing item data
        }

        let totalDrinkConcentration = 0;

        // Iterate through all equipped items
        for (const [_slotHrid, equippedItem] of characterEquipment) {
            const itemDetails = itemDetailMap[equippedItem.itemHrid];

            if (!itemDetails || !itemDetails.equipmentDetail) {
                continue; // Not an equipment item
            }

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats;
            if (!noncombatStats) {
                continue; // No noncombat stats
            }

            // Check for drink concentration stat
            const baseDrinkConcentration = noncombatStats.drinkConcentration;
            if (!baseDrinkConcentration || baseDrinkConcentration <= 0) {
                continue; // No drink concentration on this item
            }

            // Get enhancement level from equipped item
            const enhancementLevel = equippedItem.enhancementLevel || 0;

            // Calculate scaled drink concentration with enhancement
            // Uses enhancement multiplier table (e.g., +10 = 1.29× for 1× slots like pouch)
            const enhancementMultiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
            const scaledDrinkConcentration = baseDrinkConcentration * enhancementMultiplier;

            totalDrinkConcentration += scaledDrinkConcentration;
        }

        return totalDrinkConcentration;
    }

    /**
     * Parse Artisan bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Artisan material reduction as decimal (e.g., 0.112 for 11.2% reduction)
     *
     * @example
     * // With Artisan Tea (10% base) and 12% Drink Concentration:
     * parseArtisanBonus(activeDrinks, items, 0.12)
     * // Returns: 0.112 (10% × 1.12 = 11.2% reduction)
     */
    function parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/artisan'],
        });
    }

    /**
     * Parse Gourmet bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Gourmet bonus chance as decimal (e.g., 0.1344 for 13.44% bonus items)
     *
     * @example
     * // With Gourmet Tea (12% base) and 12% Drink Concentration:
     * parseGourmetBonus(activeDrinks, items, 0.12)
     * // Returns: 0.1344 (12% × 1.12 = 13.44% bonus items)
     */
    function parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/gourmet'],
        });
    }

    /**
     * Parse Processing bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Processing conversion chance as decimal (e.g., 0.168 for 16.8% conversion chance)
     *
     * @example
     * // With Processing Tea (15% base) and 12% Drink Concentration:
     * parseProcessingBonus(activeDrinks, items, 0.12)
     * // Returns: 0.168 (15% × 1.12 = 16.8% conversion chance)
     */
    function parseProcessingBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/processing'],
        });
    }

    /**
     * Parse Action Level bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Action Level bonus as flat number (e.g., 5.645 for +5.645 levels, floored to 5 when used)
     *
     * @example
     * // With Artisan Tea (+5 Action Level base) and 12% Drink Concentration:
     * parseActionLevelBonus(activeDrinks, items, 0.129)
     * // Returns: 5.645 (scales with DC, but game floors this to 5 when calculating requirement)
     */
    function parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        // Action Level DOES scale with DC (like all other buffs)
        // However, the game floors the result when calculating effective requirement
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/action_level'],
        });
    }

    /**
     * Parse Action Level bonus with breakdown by individual tea
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {Array<{name: string, actionLevel: number, baseActionLevel: number, dcContribution: number}>} Array of tea contributions
     *
     * @example
     * // With Artisan Tea (+5 Action Level base) and 12.9% Drink Concentration:
     * parseActionLevelBonusBreakdown(activeDrinks, items, 0.129)
     * // Returns: [{ name: "Artisan Tea", actionLevel: 5.645, baseActionLevel: 5.0, dcContribution: 0.645 }]
     * // Note: Game floors actionLevel to 5 when calculating requirement, but we show full precision
     */
    function parseActionLevelBonusBreakdown(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return []; // No active teas
        }

        if (!itemDetailMap) {
            return []; // Missing required data
        }

        const teaBreakdown = [];

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            let baseActionLevel = 0;
            let totalActionLevel = 0;

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Action Level buff (e.g., Artisan Tea: +5 Action Level)
                if (buff.typeHrid === '/buff_types/action_level') {
                    const baseValue = buff.flatBoost;
                    // Action Level DOES scale with DC (like all other buffs)
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    baseActionLevel += baseValue;
                    totalActionLevel += scaledValue;
                }
            }

            // Only add to breakdown if this tea contributes action level
            if (totalActionLevel > 0) {
                teaBreakdown.push({
                    name: itemDetails.name,
                    actionLevel: totalActionLevel,
                    baseActionLevel: baseActionLevel,
                    dcContribution: totalActionLevel - baseActionLevel,
                });
            }
        }

        return teaBreakdown;
    }

    /**
     * Parse Gathering bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Gathering quantity bonus as decimal (e.g., 0.168 for 16.8% more items)
     *
     * @example
     * // With Gathering Tea (+15% base) and 12% Drink Concentration:
     * parseGatheringBonus(activeDrinks, items, 0.12)
     * // Returns: 0.168 (15% × 1.12 = 16.8% gathering quantity)
     */
    function parseGatheringBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/gathering'],
        });
    }

    /**
     * Parse skill level bonus from active tea buffs for a specific action type
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/cheesesmithing")
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.129 for 12.9%)
     * @returns {number} Total skill level bonus (e.g., 9.032 for +8 base × 1.129 DC)
     *
     * @example
     * // With Ultra Cheesesmithing Tea (+8 Cheesesmithing base) and 12.9% DC:
     * parseTeaSkillLevelBonus("/action_types/cheesesmithing", activeDrinks, items, 0.129)
     * // Returns: 9.032 (8 × 1.129 = 9.032 levels)
     */
    function parseTeaSkillLevelBonus(actionTypeHrid, activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return 0; // No active teas
        }

        if (!actionTypeHrid || !itemDetailMap) {
            return 0; // Missing required data
        }

        // Extract skill name from action type HRID
        // "/action_types/cheesesmithing" -> "cheesesmithing"
        const skillName = actionTypeHrid.split('/').pop();
        const skillLevelBuffType = `/buff_types/${skillName}_level`;

        let totalLevelBonus = 0;

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Skill-specific level buff (e.g., "/buff_types/cheesesmithing_level")
                if (buff.typeHrid === skillLevelBuffType) {
                    const baseValue = buff.flatBoost;
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    totalLevelBonus += scaledValue;
                }
            }
        }

        return totalLevelBonus;
    }

    var teaParser = {
        parseTeaEfficiency,
        getDrinkConcentration,
        parseArtisanBonus,
        parseGourmetBonus,
        parseProcessingBonus,
        parseActionLevelBonus,
        parseGatheringBonus,
        parseTeaSkillLevelBonus,
    };

    var teaParser$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        default: teaParser,
        getDrinkConcentration: getDrinkConcentration,
        parseActionLevelBonus: parseActionLevelBonus,
        parseActionLevelBonusBreakdown: parseActionLevelBonusBreakdown,
        parseArtisanBonus: parseArtisanBonus,
        parseGatheringBonus: parseGatheringBonus,
        parseGourmetBonus: parseGourmetBonus,
        parseProcessingBonus: parseProcessingBonus,
        parseTeaEfficiency: parseTeaEfficiency,
        parseTeaEfficiencyBreakdown: parseTeaEfficiencyBreakdown,
        parseTeaSkillLevelBonus: parseTeaSkillLevelBonus
    });

    /**
     * Action Calculator
     * Shared calculation logic for action time and efficiency
     * Used by action-time-display.js and quick-input-buttons.js
     */


    /**
     * Calculate complete action statistics (time + efficiency)
     * @param {Object} actionDetails - Action detail object from game data
     * @param {Object} options - Configuration options
     * @param {Array} options.skills - Character skills array
     * @param {Array} options.equipment - Character equipment array
     * @param {Object} options.itemDetailMap - Item detail map from game data
     * @param {string} options.actionHrid - Action HRID for task detection (optional)
     * @param {boolean} options.includeCommunityBuff - Include community buff in efficiency (default: false)
     * @param {boolean} options.includeBreakdown - Include detailed breakdown data (default: false)
     * @param {boolean} options.floorActionLevel - Floor Action Level bonus for requirement calculation (default: true)
     * @param {number} options.levelRequirementOverride - Override base level requirement (e.g., item level for alchemy)
     * @returns {Object} { actionTime, totalEfficiency, breakdown? }
     */
    function calculateActionStats(actionDetails, options = {}) {
        const {
            skills,
            equipment,
            itemDetailMap,
            actionHrid,
            includeCommunityBuff = false,
            includeBreakdown = false,
            floorActionLevel = true,
            levelRequirementOverride,
        } = options;

        try {
            // Calculate base action time
            const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

            // Get equipment speed bonus
            const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);

            // Calculate action time with equipment speed
            let actionTime = baseTime / (1 + speedBonus);

            // Apply task speed multiplicatively (if action is an active task)
            if (actionHrid && dataManager.isTaskAction(actionHrid)) {
                const taskSpeedBonus = dataManager.getTaskSpeedBonus(); // Returns percentage (e.g., 15 for 15%)
                actionTime = actionTime / (1 + taskSpeedBonus / 100); // Apply multiplicatively
            }

            // Calculate efficiency
            const skillLevel = getSkillLevel(skills, actionDetails.type);
            const baseRequirement = levelRequirementOverride ?? actionDetails.levelRequirement?.level ?? 1;

            // Get drink concentration
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas
            const actionLevelBonus = parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Get Action Level bonus breakdown (if requested)
            let actionLevelBreakdown = null;
            if (includeBreakdown) {
                actionLevelBreakdown = parseActionLevelBonusBreakdown(activeDrinks, itemDetailMap, drinkConcentration);
            }

            // Calculate effective requirement
            // Note: floorActionLevel flag for compatibility
            // - quick-input-buttons uses Math.floor (can't have fractional level requirements)
            // - action-time-display historically didn't floor (preserving for compatibility)
            const effectiveRequirement =
                baseRequirement + (floorActionLevel ? Math.floor(actionLevelBonus) : actionLevelBonus);

            // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
            const teaSkillLevelBonus = parseTeaSkillLevelBonus(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate efficiency components
            // Apply tea skill level bonus to effective player level
            const effectiveLevel = skillLevel + teaSkillLevelBonus;
            const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
            const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
            const equipmentEfficiency = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap);
            const achievementEfficiency =
                dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

            // Calculate tea efficiency
            let teaEfficiency;
            let teaBreakdown = null;
            if (includeBreakdown) {
                // Get detailed breakdown
                teaBreakdown = parseTeaEfficiencyBreakdown(
                    actionDetails.type,
                    activeDrinks,
                    itemDetailMap,
                    drinkConcentration
                );
                teaEfficiency = teaBreakdown.reduce((sum, tea) => sum + tea.efficiency, 0);
            } else {
                // Simple total
                teaEfficiency = parseTeaEfficiency(actionDetails.type, activeDrinks, itemDetailMap, drinkConcentration);
            }

            // Get community buff efficiency (if requested)
            let communityEfficiency = 0;
            if (includeCommunityBuff) {
                // Production Efficiency buff applies to production skills and alchemy
                const productionSkills = [
                    '/action_types/alchemy',
                    '/action_types/brewing',
                    '/action_types/cheesesmithing',
                    '/action_types/cooking',
                    '/action_types/crafting',
                    '/action_types/tailoring',
                ];

                if (productionSkills.includes(actionDetails.type)) {
                    const communityBuffLevel = dataManager.getCommunityBuffLevel(
                        '/community_buff_types/production_efficiency'
                    );
                    communityEfficiency = communityBuffLevel ? (0.14 + (communityBuffLevel - 1) * 0.003) * 100 : 0;
                }
            }

            // Total efficiency (stack all components additively)
            const totalEfficiency = stackAdditive(
                levelEfficiency,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                communityEfficiency,
                achievementEfficiency
            );

            // Build result object
            const result = {
                actionTime,
                totalEfficiency,
            };

            // Add breakdown if requested
            if (includeBreakdown) {
                result.efficiencyBreakdown = {
                    levelEfficiency,
                    houseEfficiency,
                    equipmentEfficiency,
                    teaEfficiency,
                    teaBreakdown,
                    communityEfficiency,
                    achievementEfficiency,
                    skillLevel,
                    baseRequirement,
                    actionLevelBonus,
                    actionLevelBreakdown,
                    effectiveRequirement,
                };
            }

            return result;
        } catch (error) {
            console.error('[Action Calculator] Error calculating action stats:', error);
            return null;
        }
    }

    /**
     * Get character skill level for a skill type
     * @param {Array} skills - Character skills array
     * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
     * @returns {number} Skill level
     */
    function getSkillLevel(skills, skillType) {
        // Map action type to skill HRID
        const skillHrid = skillType.replace('/action_types/', '/skills/');
        const skill = skills.find((s) => s.skillHrid === skillHrid);
        return skill?.level || 1;
    }

    var actionCalculator = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateActionStats: calculateActionStats
    });

    /**
     * Action Panel Display Helper
     * Utilities for working with action detail panels (gathering, production, enhancement)
     */

    /**
     * Find the action count input field within a panel
     * @param {HTMLElement} panel - The action detail panel
     * @returns {HTMLInputElement|null} The input element or null if not found
     */
    function findActionInput(panel) {
        const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
        if (!inputContainer) {
            return null;
        }

        const inputField = inputContainer.querySelector('input');
        return inputField || null;
    }

    /**
     * Attach input listeners to an action panel for tracking value changes
     * Sets up three listeners:
     * - keyup: For manual typing
     * - input: For quick input button clicks (React dispatches input events)
     * - panel click: For any panel interactions with 50ms delay
     *
     * @param {HTMLElement} panel - The action detail panel
     * @param {HTMLInputElement} input - The input element
     * @param {Function} updateCallback - Callback function(value) called on input changes
     * @param {Object} options - Optional configuration
     * @param {number} options.clickDelay - Delay in ms for panel click handler (default: 50)
     * @returns {Function} Cleanup function to remove all listeners
     */
    function attachInputListeners(panel, input, updateCallback, options = {}) {
        const { clickDelay = 50 } = options;

        // Handler for keyup and input events
        const updateHandler = () => {
            updateCallback(input.value);
        };

        // Handler for panel clicks (with delay to allow React updates)
        const panelClickHandler = (event) => {
            // Skip if click is on the input box itself
            if (event.target === input) {
                return;
            }
            setTimeout(() => {
                updateCallback(input.value);
            }, clickDelay);
        };

        // Attach all listeners
        input.addEventListener('keyup', updateHandler);
        input.addEventListener('input', updateHandler);
        panel.addEventListener('click', panelClickHandler);

        // Return cleanup function
        return () => {
            input.removeEventListener('keyup', updateHandler);
            input.removeEventListener('input', updateHandler);
            panel.removeEventListener('click', panelClickHandler);
        };
    }

    /**
     * Perform initial update if input already has a valid value
     * @param {HTMLInputElement} input - The input element
     * @param {Function} updateCallback - Callback function(value) called if valid
     * @returns {boolean} True if initial update was performed
     */
    function performInitialUpdate(input, updateCallback) {
        if (input.value && parseInt(input.value) > 0) {
            updateCallback(input.value);
            return true;
        }
        return false;
    }

    var actionPanelHelper = /*#__PURE__*/Object.freeze({
        __proto__: null,
        attachInputListeners: attachInputListeners,
        findActionInput: findActionInput,
        performInitialUpdate: performInitialUpdate
    });

    /**
     * Buff Parser Utilities
     * Parse active buffs from character data
     */


    /**
     * Get alchemy success rate bonus from active buffs
     * @returns {number} Alchemy success rate bonus (0-1, e.g., 0.087 for 8.7% multiplicative bonus)
     */
    function getAlchemySuccessBonus() {
        try {
            const characterData = dataManager.characterData;
            if (!characterData || !characterData.consumableActionTypeBuffsMap) {
                return 0;
            }

            const alchemyBuffs = characterData.consumableActionTypeBuffsMap['/action_types/alchemy'];
            if (!Array.isArray(alchemyBuffs)) {
                return 0;
            }

            let bonus = 0;
            for (const buff of alchemyBuffs) {
                if (buff.typeHrid === '/buff_types/alchemy_success') {
                    // ratioBoost is already scaled with drink concentration by the game
                    bonus += buff.ratioBoost || 0;
                }
            }

            return bonus;
        } catch (error) {
            console.error('[BuffParser] Failed to get alchemy success bonus:', error);
            return 0;
        }
    }

    var buffParser = /*#__PURE__*/Object.freeze({
        __proto__: null,
        getAlchemySuccessBonus: getAlchemySuccessBonus
    });

    /**
     * DOM Selector Constants
     * Centralized selector strings for querying game elements
     * If game class names change, update here only
     */

    /**
     * Game UI Selectors (class names from game code)
     */
    const GAME = {
        // Header
        TOTAL_LEVEL: '[class*="Header_totalLevel"]',

        // Settings Panel
        SETTINGS_PANEL_TITLE: '[class*="SettingsPanel_title"]',
        SETTINGS_TABS_CONTAINER: 'div[class*="SettingsPanel_tabsComponentContainer"]',
        TABS_FLEX_CONTAINER: '[class*="MuiTabs-flexContainer"]',
        TAB_PANELS_CONTAINER: '[class*="TabsComponent_tabPanelsContainer"]',
        TAB_PANEL: '[class*="TabPanel_tabPanel"]',

        // Game Panel
        GAME_PANEL: 'div[class*="GamePage_gamePanel"]',

        // Skill Action Detail
        SKILL_ACTION_DETAIL: '[class*="SkillActionDetail_skillActionDetail"]',
        SKILL_ACTION_NAME: '[class*="SkillActionDetail_name"]',
        ENHANCING_COMPONENT: 'div.SkillActionDetail_enhancingComponent__17bOx',

        // Action Queue
        QUEUED_ACTIONS: '[class*="QueuedActions_action"]',
        MAX_ACTION_COUNT_INPUT: '[class*="maxActionCountInput"]',

        // Tasks
        TASK_PANEL: '[class*="TasksPanel_taskSlotCount"]',
        TASK_LIST: '[class*="TasksPanel_taskList"]',
        TASK_CARD: '[class*="RandomTask_randomTask"]',
        TASK_NAME: '[class*="RandomTask_name"]',
        TASK_INFO: '.RandomTask_taskInfo__1uasf',
        TASK_ACTION: '.RandomTask_action__3eC6o',
        TASK_REWARDS: '.RandomTask_rewards__YZk7D',
        TASK_CONTENT: '[class*="RandomTask_content"]',
        TASK_NAME_DIV: 'div[class*="RandomTask_name"]',

        // House Panel
        HOUSE_HEADER: '[class*="HousePanel_header"]',
        HOUSE_COSTS: '[class*="HousePanel_costs"]',
        HOUSE_ITEM_REQUIREMENTS: '[class*="HousePanel_itemRequirements"]',

        // Inventory
        INVENTORY_ITEMS: '[class*="Inventory_items"]',
        INVENTORY_CATEGORY_BUTTON: '.Inventory_categoryButton__35s1x',
        INVENTORY_LABEL: '.Inventory_label__XEOAx',

        // Items
        ITEM_CONTAINER: '.Item_itemContainer__x7kH1',
        ITEM_ITEM: '.Item_item__2De2O',
        ITEM_COUNT: '.Item_count__1HVvv',
        ITEM_TOOLTIP_TEXT: '.ItemTooltipText_itemTooltipText__zFq3A',

        // Navigation/Experience Bars
        NAV_LEVEL: '[class*="NavigationBar_level"]',
        NAV_CURRENT_EXPERIENCE: '[class*="NavigationBar_currentExperience"]',

        // Enhancement
        PROTECTION_ITEM_INPUT: '[class*="protectionItemInputContainer"]',

        // Tooltips
        MUI_TOOLTIP: '.MuiTooltip-tooltip',
    };

    /**
     * Toolasha-specific selectors (our injected elements)
     */
    const TOOLASHA = {
        // Settings
        SETTINGS_TAB: '#toolasha-settings-tab',
        SETTING_WITH_DEPS: '.toolasha-setting[data-dependencies]',

        // Task features
        TASK_PROFIT: '.mwi-task-profit',
        REROLL_COST_DISPLAY: '.mwi-reroll-cost-display',

        // Action features
        QUEUE_TOTAL_TIME: '#mwi-queue-total-time',
        FORAGING_PROFIT: '#mwi-foraging-profit',
        PRODUCTION_PROFIT: '#mwi-production-profit',

        // House features
        HOUSE_PRICING: '.mwi-house-pricing',
        HOUSE_PRICING_EMPTY: '.mwi-house-pricing-empty',
        HOUSE_TOTAL: '.mwi-house-total',
        HOUSE_TO_LEVEL: '.mwi-house-to-level',

        // Profile/Combat Score
        SCORE_CLOSE_BTN: '#mwi-score-close-btn',
        SCORE_TOGGLE: '#mwi-score-toggle',
        SCORE_DETAILS: '#mwi-score-details',
        HOUSE_TOGGLE: '#mwi-house-toggle',
        HOUSE_BREAKDOWN: '#mwi-house-breakdown',
        ABILITY_TOGGLE: '#mwi-ability-toggle',
        ABILITY_BREAKDOWN: '#mwi-ability-breakdown',
        EQUIPMENT_TOGGLE: '#mwi-equipment-toggle',
        EQUIPMENT_BREAKDOWN: '#mwi-equipment-breakdown',

        // Market features
        MARKET_PRICE_INJECTED: '.market-price-injected',
        MARKET_PROFIT_INJECTED: '.market-profit-injected',
        MARKET_EV_INJECTED: '.market-ev-injected',
        MARKET_ENHANCEMENT_INJECTED: '.market-enhancement-injected',

        // UI features
        ALCHEMY_DIMMED: '.mwi-alchemy-dimmed',
        EXP_PERCENTAGE: '.mwi-exp-percentage',
        STACK_PRICE: '.mwi-stack-price',
        NETWORTH_HEADER: '.mwi-networth-header',

        // Enhancement
        ENHANCEMENT_STATS: '#mwi-enhancement-stats',

        // Generic
        COLLAPSIBLE_SECTION: '.mwi-collapsible-section',
        EXPANDABLE_HEADER: '.mwi-expandable-header',
        SECTION_HEADER_NEXT: '.mwi-section-header + div',

        // Legacy/cleanup markers
        INSERTED_SPAN: '.insertedSpan',
        SCRIPT_INJECTED: '.script-injected',
        CONSUMABLE_STATS_INJECTED: '.consumable-stats-injected',
    };

    /**
     * Enhancement-specific input IDs
     */
    const ENHANCEMENT = {
        TILL_LEVEL: '#tillLevel',
        TILL_LEVEL_INPUT: '#tillLevelInput',
        TILL_LEVEL_NUMBER: '#tillLevelNumber',
    };

    /**
     * Combat Sim Integration
     */
    const COMBAT_SIM = {
        GROUP_COMBAT_TAB: 'a#group-combat-tab',
        GET_PRICES_BUTTON: 'button#buttonGetPrices',
    };

    var selectors = /*#__PURE__*/Object.freeze({
        __proto__: null,
        COMBAT_SIM: COMBAT_SIM,
        ENHANCEMENT: ENHANCEMENT,
        GAME: GAME,
        TOOLASHA: TOOLASHA
    });

    /**
     * Experience Calculator
     * Shared utility for calculating experience per hour across features
     *
     * Calculates accurate XP/hour including:
     * - Base experience from action
     * - Experience multipliers (Wisdom + Charm Experience)
     * - Action time with speed bonuses
     * - Efficiency repeats (critical for accuracy)
     */


    /**
     * Calculate experience per hour for an action
     * @param {string} actionHrid - The action HRID (e.g., "/actions/cheesesmithing/cheese")
     * @returns {Object|null} Experience data or null if not applicable
     *   {
     *     expPerHour: number,           // Total XP per hour (with all bonuses)
     *     baseExp: number,              // Base XP per action
     *     modifiedXP: number,           // XP per action after multipliers
     *     actionsPerHour: number,       // Actions per hour (with efficiency)
     *     xpMultiplier: number,         // Total XP multiplier (Wisdom + Charm)
     *     actionTime: number,           // Time per action in seconds
     *     totalEfficiency: number       // Total efficiency percentage
     *   }
     */
    function calculateExpPerHour(actionHrid) {
        const actionDetails = dataManager.getActionDetails(actionHrid);

        // Validate action has experience gain
        if (!actionDetails || !actionDetails.experienceGain || !actionDetails.experienceGain.value) {
            return null;
        }

        // Get character data
        const skills = dataManager.getSkills();
        const equipment = dataManager.getEquipment();
        const gameData = dataManager.getInitClientData();

        if (!gameData || !skills || !equipment) {
            return null;
        }

        // Calculate action stats (time + efficiency)
        const stats = calculateActionStats(actionDetails, {
            skills,
            equipment,
            itemDetailMap: gameData.itemDetailMap,
            includeCommunityBuff: true,
            includeBreakdown: false,
            floorActionLevel: true,
        });

        if (!stats) {
            return null;
        }

        const { actionTime, totalEfficiency } = stats;

        // Calculate actions per hour (base rate)
        const baseActionsPerHour = calculateActionsPerHour(actionTime);

        // Calculate average queued actions completed per time-consuming action
        // Efficiency gives guaranteed repeats + chance for extra
        const avgActionsPerBaseAction = calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate actions per hour WITH efficiency (total completions including instant repeats)
        const actionsPerHourWithEfficiency = calculateEffectiveActionsPerHour(baseActionsPerHour, avgActionsPerBaseAction);

        // Calculate experience multiplier (Wisdom + Charm Experience)
        const skillHrid = actionDetails.experienceGain.skillHrid;
        const xpData = calculateExperienceMultiplier(skillHrid, actionDetails.type);

        // Calculate exp per hour with all bonuses
        const baseExp = actionDetails.experienceGain.value;
        const modifiedXP = baseExp * xpData.totalMultiplier;
        const expPerHour = actionsPerHourWithEfficiency * modifiedXP;

        return {
            expPerHour: Math.floor(expPerHour),
            baseExp,
            modifiedXP,
            actionsPerHour: actionsPerHourWithEfficiency,
            xpMultiplier: xpData.totalMultiplier,
            actionTime,
            totalEfficiency,
        };
    }

    var experienceCalculator = {
        calculateExpPerHour,
    };

    var experienceCalculator$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateExpPerHour: calculateExpPerHour,
        default: experienceCalculator
    });

    /**
     * Ability Cost Calculator Utility
     * Calculates the cost to reach a specific ability level
     * Extracted from ability-book-calculator.js for reuse in combat score
     */


    /**
     * List of starter abilities that give 50 XP per book (others give 500)
     */
    const STARTER_ABILITIES = [
        'poke',
        'scratch',
        'smack',
        'quick_shot',
        'water_strike',
        'fireball',
        'entangle',
        'minor_heal',
    ];

    /**
     * Check if an ability is a starter ability (50 XP per book)
     * @param {string} abilityHrid - Ability HRID
     * @returns {boolean} True if starter ability
     */
    function isStarterAbility(abilityHrid) {
        return STARTER_ABILITIES.some((skill) => abilityHrid.includes(skill));
    }

    /**
     * Calculate the cost to reach a specific ability level from level 0
     * @param {string} abilityHrid - Ability HRID (e.g., '/abilities/fireball')
     * @param {number} targetLevel - Target level to reach
     * @returns {number} Total cost in coins
     */
    function calculateAbilityCost(abilityHrid, targetLevel) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const levelXpTable = gameData.levelExperienceTable;
        if (!levelXpTable) return 0;

        // Get XP needed to reach target level from level 0
        const targetXp = levelXpTable[targetLevel] || 0;

        // Determine XP per book (50 for starters, 500 for advanced)
        const xpPerBook = isStarterAbility(abilityHrid) ? 50 : 500;

        // Calculate books needed
        let booksNeeded = targetXp / xpPerBook;
        booksNeeded += 1; // +1 book to learn the ability initially

        // Get market price for ability book
        const itemHrid = abilityHrid.replace('/abilities/', '/items/');
        const prices = marketAPI.getPrice(itemHrid, 0);

        if (!prices) return 0;

        // Match MCS behavior: if one price is positive and other is negative, use positive for both
        let ask = prices.ask;
        let bid = prices.bid;

        if (ask > 0 && bid < 0) {
            bid = ask;
        }
        if (bid > 0 && ask < 0) {
            ask = bid;
        }

        // Use weighted average
        const weightedPrice = (ask + bid) / 2;

        return booksNeeded * weightedPrice;
    }

    /**
     * Calculate the cost to level up an ability from current level to target level
     * @param {string} abilityHrid - Ability HRID
     * @param {number} currentLevel - Current ability level
     * @param {number} currentXp - Current ability XP
     * @param {number} targetLevel - Target ability level
     * @returns {number} Cost in coins
     */
    function calculateAbilityLevelUpCost(abilityHrid, currentLevel, currentXp, targetLevel) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const levelXpTable = gameData.levelExperienceTable;
        if (!levelXpTable) return 0;

        // Calculate XP needed
        const targetXp = levelXpTable[targetLevel] || 0;
        const xpNeeded = targetXp - currentXp;

        // Determine XP per book
        const xpPerBook = isStarterAbility(abilityHrid) ? 50 : 500;

        // Calculate books needed
        let booksNeeded = xpNeeded / xpPerBook;

        // If starting from level 0, need +1 book to learn initially
        if (currentLevel === 0) {
            booksNeeded += 1;
        }

        // Get market price
        const itemHrid = abilityHrid.replace('/abilities/', '/items/');
        const prices = marketAPI.getPrice(itemHrid, 0);

        if (!prices) return 0;

        // Match MCS behavior: if one price is positive and other is negative, use positive for both
        let ask = prices.ask;
        let bid = prices.bid;

        if (ask > 0 && bid < 0) {
            bid = ask;
        }
        if (bid > 0 && ask < 0) {
            ask = bid;
        }

        // Weighted average
        const weightedPrice = (ask + bid) / 2;

        return booksNeeded * weightedPrice;
    }

    var abilityCalc = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateAbilityCost: calculateAbilityCost,
        calculateAbilityLevelUpCost: calculateAbilityLevelUpCost,
        isStarterAbility: isStarterAbility
    });

    /**
     * Shared UI Components
     *
     * Reusable UI component builders for MWI Tools
     */

    /**
     * Create a collapsible section with expand/collapse functionality
     * @param {string} icon - Icon/emoji for the section (optional, pass empty string to omit)
     * @param {string} title - Section title
     * @param {string} summary - Summary text shown when collapsed (optional)
     * @param {HTMLElement} content - Content element to show/hide
     * @param {boolean} defaultOpen - Whether section starts open (default: false)
     * @param {number} indent - Indentation level: 0 = root, 1 = nested, etc. (default: 0)
     * @returns {HTMLElement} Section container
     */
    function createCollapsibleSection(icon, title, summary, content, defaultOpen = false, indent = 0) {
        const section = document.createElement('div');
        section.className = 'mwi-collapsible-section';
        section.style.cssText = `
        margin-top: ${indent > 0 ? '4px' : '8px'};
        margin-bottom: ${indent > 0 ? '4px' : '8px'};
        margin-left: ${indent * 16}px;
    `;

        // Create header
        const header = document.createElement('div');
        header.className = 'mwi-section-header';
        header.style.cssText = `
        display: flex;
        align-items: center;
        cursor: pointer;
        user-select: none;
        padding: 4px 0;
        color: var(--text-color-primary, #fff);
        font-weight: ${indent === 0 ? '500' : '400'};
        font-size: ${indent > 0 ? '0.9em' : '1em'};
    `;

        const arrow = document.createElement('span');
        arrow.textContent = defaultOpen ? '▼' : '▶';
        arrow.style.cssText = `
        margin-right: 6px;
        font-size: 0.7em;
        transition: transform 0.2s;
    `;

        const label = document.createElement('span');
        if (icon) {
            // Emojis that need spacing fix (stopwatch has rendering issues in some browsers)
            const needsSpacingFix = icon === '⏱';
            if (needsSpacingFix) {
                label.innerHTML = `<span style="display: inline-block; margin-right: 0.25em;">${icon}</span> ${title}`;
            } else {
                label.textContent = `${icon} ${title}`;
            }
        } else {
            label.textContent = title;
        }

        header.appendChild(arrow);
        header.appendChild(label);

        // Create summary (shown when collapsed)
        const summaryDiv = document.createElement('div');
        summaryDiv.style.cssText = `
        margin-left: 16px;
        margin-top: 2px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        display: ${defaultOpen ? 'none' : 'block'};
    `;
        if (summary) {
            summaryDiv.textContent = summary;
        }

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'mwi-section-content';
        contentWrapper.style.cssText = `
        display: ${defaultOpen ? 'block' : 'none'};
        margin-left: ${indent === 0 ? '16px' : '0px'};
        margin-top: 4px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        line-height: 1.6;
        text-align: left;
    `;
        contentWrapper.appendChild(content);

        // Toggle functionality
        header.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event from bubbling to parent collapsible sections
            const isOpen = contentWrapper.style.display === 'block';
            contentWrapper.style.display = isOpen ? 'none' : 'block';
            if (summary) {
                summaryDiv.style.display = isOpen ? 'block' : 'none';
            }
            arrow.textContent = isOpen ? '▶' : '▼';
        });

        section.appendChild(header);
        if (summary) {
            section.appendChild(summaryDiv);
        }
        section.appendChild(contentWrapper);

        return section;
    }

    var uiComponents = {
        createCollapsibleSection,
    };

    var uiComponents$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        createCollapsibleSection: createCollapsibleSection,
        default: uiComponents
    });

    /**
     * Skill Gear Detector
     *
     * Auto-detects gear and buffs from character equipment for any skill.
     * Originally designed for enhancing, now works generically for all skills.
     */


    /**
     * Detect best gear for a specific skill by equipment slot
     * @param {string} skillName - Skill name (e.g., 'enhancing', 'cooking', 'milking')
     * @param {Map} equipment - Character equipment map (equipped items only)
     * @param {Object} itemDetailMap - Item details map from init_client_data
     * @returns {Object} Best gear per slot with bonuses
     */
    function detectSkillGear(skillName, equipment, itemDetailMap) {
        const gear = {
            // Totals for calculations
            toolBonus: 0,
            speedBonus: 0,
            rareFindBonus: 0,
            experienceBonus: 0,

            // Best items per slot for display
            toolSlot: null, // main_hand or two_hand
            bodySlot: null, // body
            legsSlot: null, // legs
            handsSlot: null, // hands
        };

        // Get items to scan - only use equipment map (already filtered to equipped items only)
        let itemsToScan = [];

        if (equipment) {
            // Scan only equipped items from equipment map
            itemsToScan = Array.from(equipment.values()).filter((item) => item && item.itemHrid);
        }

        // Track best item per slot (by item level, then enhancement level)
        const slotCandidates = {
            tool: [], // main_hand or two_hand or skill-specific tool
            body: [], // body
            legs: [], // legs
            hands: [], // hands
            neck: [], // neck (accessories have 5× multiplier)
            ring: [], // ring (accessories have 5× multiplier)
            earring: [], // earring (accessories have 5× multiplier)
        };

        // Dynamic stat names based on skill
        const successStat = `${skillName}Success`;
        const speedStat = `${skillName}Speed`;
        const rareFindStat = `${skillName}RareFind`;
        const experienceStat = `${skillName}Experience`;

        // Search all items for skill-related bonuses and group by slot
        for (const item of itemsToScan) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

            const stats = itemDetails.equipmentDetail.noncombatStats;
            const enhancementLevel = item.enhancementLevel || 0;
            const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
            const equipmentType = itemDetails.equipmentDetail.type;

            // Generic stat calculation: Loop over ALL stats and apply multiplier
            const allStats = {};
            for (const [statName, statValue] of Object.entries(stats)) {
                if (typeof statValue !== 'number') continue; // Skip non-numeric values
                allStats[statName] = statValue * 100 * multiplier;
            }

            // Check if item has any skill-related stats (including universal skills)
            const hasSkillStats =
                allStats[successStat] ||
                allStats[speedStat] ||
                allStats[rareFindStat] ||
                allStats[experienceStat] ||
                allStats.skillingSpeed ||
                allStats.skillingExperience;

            if (!hasSkillStats) continue;

            // Calculate bonuses for this item (backward-compatible output)
            const itemBonuses = {
                item: item,
                itemDetails: itemDetails,
                itemLevel: itemDetails.itemLevel || 0,
                enhancementLevel: enhancementLevel,
                // Named bonuses (dynamic based on skill)
                toolBonus: allStats[successStat] || 0,
                speedBonus: (allStats[speedStat] || 0) + (allStats.skillingSpeed || 0), // Combine speed sources
                rareFindBonus: allStats[rareFindStat] || 0,
                experienceBonus: (allStats[experienceStat] || 0) + (allStats.skillingExperience || 0), // Combine experience sources
                // Generic access to all stats
                allStats: allStats,
            };

            // Group by slot
            // Tool slots: skill-specific tools (e.g., enhancing_tool, cooking_tool) plus main_hand/two_hand
            const skillToolType = `/equipment_types/${skillName}_tool`;
            if (
                equipmentType === skillToolType ||
                equipmentType === '/equipment_types/main_hand' ||
                equipmentType === '/equipment_types/two_hand'
            ) {
                slotCandidates.tool.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/body') {
                slotCandidates.body.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/legs') {
                slotCandidates.legs.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/hands') {
                slotCandidates.hands.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/neck') {
                slotCandidates.neck.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/ring') {
                slotCandidates.ring.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/earring') {
                slotCandidates.earring.push(itemBonuses);
            }
        }

        // Select best item per slot (highest item level, then highest enhancement level)
        const selectBest = (candidates) => {
            if (candidates.length === 0) return null;

            return candidates.reduce((best, current) => {
                // Compare by item level first
                if (current.itemLevel > best.itemLevel) return current;
                if (current.itemLevel < best.itemLevel) return best;

                // If item levels are equal, compare by enhancement level
                if (current.enhancementLevel > best.enhancementLevel) return current;
                return best;
            });
        };

        const bestTool = selectBest(slotCandidates.tool);
        const bestBody = selectBest(slotCandidates.body);
        const bestLegs = selectBest(slotCandidates.legs);
        const bestHands = selectBest(slotCandidates.hands);
        const bestNeck = selectBest(slotCandidates.neck);
        const bestRing = selectBest(slotCandidates.ring);
        const bestEarring = selectBest(slotCandidates.earring);

        // Add bonuses from best items in each slot
        if (bestTool) {
            gear.toolBonus += bestTool.toolBonus;
            gear.speedBonus += bestTool.speedBonus;
            gear.rareFindBonus += bestTool.rareFindBonus;
            gear.experienceBonus += bestTool.experienceBonus;
            gear.toolSlot = {
                name: bestTool.itemDetails.name,
                enhancementLevel: bestTool.enhancementLevel,
            };
        }

        if (bestBody) {
            gear.toolBonus += bestBody.toolBonus;
            gear.speedBonus += bestBody.speedBonus;
            gear.rareFindBonus += bestBody.rareFindBonus;
            gear.experienceBonus += bestBody.experienceBonus;
            gear.bodySlot = {
                name: bestBody.itemDetails.name,
                enhancementLevel: bestBody.enhancementLevel,
            };
        }

        if (bestLegs) {
            gear.toolBonus += bestLegs.toolBonus;
            gear.speedBonus += bestLegs.speedBonus;
            gear.rareFindBonus += bestLegs.rareFindBonus;
            gear.experienceBonus += bestLegs.experienceBonus;
            gear.legsSlot = {
                name: bestLegs.itemDetails.name,
                enhancementLevel: bestLegs.enhancementLevel,
            };
        }

        if (bestHands) {
            gear.toolBonus += bestHands.toolBonus;
            gear.speedBonus += bestHands.speedBonus;
            gear.rareFindBonus += bestHands.rareFindBonus;
            gear.experienceBonus += bestHands.experienceBonus;
            gear.handsSlot = {
                name: bestHands.itemDetails.name,
                enhancementLevel: bestHands.enhancementLevel,
            };
        }

        if (bestNeck) {
            gear.toolBonus += bestNeck.toolBonus;
            gear.speedBonus += bestNeck.speedBonus;
            gear.rareFindBonus += bestNeck.rareFindBonus;
            gear.experienceBonus += bestNeck.experienceBonus;
        }

        if (bestRing) {
            gear.toolBonus += bestRing.toolBonus;
            gear.speedBonus += bestRing.speedBonus;
            gear.rareFindBonus += bestRing.rareFindBonus;
            gear.experienceBonus += bestRing.experienceBonus;
        }

        if (bestEarring) {
            gear.toolBonus += bestEarring.toolBonus;
            gear.speedBonus += bestEarring.speedBonus;
            gear.rareFindBonus += bestEarring.rareFindBonus;
            gear.experienceBonus += bestEarring.experienceBonus;
        }

        return gear;
    }

    /**
     * Detect active enhancing teas from drink slots
     * @param {Array} drinkSlots - Active drink slots for enhancing action type
     * @param {Object} itemDetailMap - Item details map from init_client_data
     * @returns {Object} Active teas { enhancing, superEnhancing, ultraEnhancing, blessed }
     */
    function detectEnhancingTeas(drinkSlots, _itemDetailMap) {
        const teas = {
            enhancing: false, // Enhancing Tea (+3 levels)
            superEnhancing: false, // Super Enhancing Tea (+6 levels)
            ultraEnhancing: false, // Ultra Enhancing Tea (+8 levels)
            blessed: false, // Blessed Tea (1% double jump)
        };

        if (!drinkSlots || drinkSlots.length === 0) {
            return teas;
        }

        // Tea HRIDs to check for
        const teaMap = {
            '/items/enhancing_tea': 'enhancing',
            '/items/super_enhancing_tea': 'superEnhancing',
            '/items/ultra_enhancing_tea': 'ultraEnhancing',
            '/items/blessed_tea': 'blessed',
        };

        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue;

            const teaKey = teaMap[drink.itemHrid];
            if (teaKey) {
                teas[teaKey] = true;
            }
        }

        return teas;
    }

    /**
     * Get enhancing tea level bonus
     * @param {Object} teas - Active teas from detectEnhancingTeas()
     * @returns {number} Total level bonus from teas
     */
    function getEnhancingTeaLevelBonus(teas) {
        // Teas don't stack - highest one wins
        if (teas.ultraEnhancing) return 8;
        if (teas.superEnhancing) return 6;
        if (teas.enhancing) return 3;

        return 0;
    }

    /**
     * Get enhancing tea speed bonus (base, before concentration)
     * @param {Object} teas - Active teas from detectEnhancingTeas()
     * @returns {number} Base speed bonus % from teas
     */
    function getEnhancingTeaSpeedBonus(teas) {
        // Teas don't stack - highest one wins
        // Base speed bonuses (before drink concentration):
        if (teas.ultraEnhancing) return 6; // +6% base
        if (teas.superEnhancing) return 4; // +4% base
        if (teas.enhancing) return 2; // +2% base

        return 0;
    }

    /**
     * Backward-compatible wrapper for enhancing gear detection
     * @param {Map} equipment - Character equipment map (equipped items only)
     * @param {Object} itemDetailMap - Item details map from init_client_data
     * @returns {Object} Best enhancing gear per slot with bonuses
     */
    function detectEnhancingGear(equipment, itemDetailMap) {
        return detectSkillGear('enhancing', equipment, itemDetailMap);
    }

    var enhancementGearDetector = /*#__PURE__*/Object.freeze({
        __proto__: null,
        detectEnhancingGear: detectEnhancingGear,
        detectEnhancingTeas: detectEnhancingTeas,
        detectSkillGear: detectSkillGear,
        getEnhancingTeaLevelBonus: getEnhancingTeaLevelBonus,
        getEnhancingTeaSpeedBonus: getEnhancingTeaSpeedBonus
    });

    /**
     * Enhancement Configuration Manager
     *
     * Combines auto-detected enhancing parameters with manual overrides from settings.
     * Provides single source of truth for enhancement simulator inputs.
     */


    /**
     * Get enhancing parameters (auto-detected or manual)
     * @returns {Object} Enhancement parameters for simulator
     */
    function getEnhancingParams() {
        const autoDetect = config.getSettingValue('enhanceSim_autoDetect', false);

        if (autoDetect) {
            return getAutoDetectedParams();
        } else {
            return getManualParams();
        }
    }

    /**
     * Get auto-detected enhancing parameters from character data
     * @returns {Object} Auto-detected parameters
     */
    function getAutoDetectedParams() {
        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const drinkSlots = dataManager.getActionDrinkSlots('/action_types/enhancing');
        const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

        // Detect gear from equipped items only
        const gear = detectEnhancingGear(equipment, itemDetailMap);

        // Detect drink concentration from equipment (Guzzling Pouch)
        // IMPORTANT: Only scan equipped items, not entire inventory
        let drinkConcentration = 0;
        const itemsToScan = equipment ? Array.from(equipment.values()).filter((item) => item && item.itemHrid) : [];

        for (const item of itemsToScan) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;

            const concentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
            const enhancementLevel = item.enhancementLevel || 0;
            const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
            const scaledConcentration = concentration * 100 * multiplier;

            // Only keep the highest concentration (shouldn't have multiple, but just in case)
            if (scaledConcentration > drinkConcentration) {
                drinkConcentration = scaledConcentration;
            }
        }

        // Detect teas
        const teas = detectEnhancingTeas(drinkSlots);

        // Get tea level bonus (base, then scale with concentration)
        const baseTeaLevel = getEnhancingTeaLevelBonus(teas);
        const teaLevelBonus = baseTeaLevel > 0 ? baseTeaLevel * (1 + drinkConcentration / 100) : 0;

        // Get tea speed bonus (base, then scale with concentration)
        const baseTeaSpeed = getEnhancingTeaSpeedBonus(teas);
        const teaSpeedBonus = baseTeaSpeed > 0 ? baseTeaSpeed * (1 + drinkConcentration / 100) : 0;

        // Get tea wisdom bonus (base, then scale with concentration)
        // Wisdom Tea/Coffee provide 12% wisdom, scales with drink concentration
        let baseTeaWisdom = 0;
        if (drinkSlots && drinkSlots.length > 0) {
            for (const drink of drinkSlots) {
                if (!drink || !drink.itemHrid) continue;
                const drinkDetails = itemDetailMap[drink.itemHrid];
                if (!drinkDetails?.consumableDetail?.buffs) continue;

                const wisdomBuff = drinkDetails.consumableDetail.buffs.find(
                    (buff) => buff.typeHrid === '/buff_types/wisdom'
                );

                if (wisdomBuff && wisdomBuff.flatBoost) {
                    baseTeaWisdom += wisdomBuff.flatBoost * 100; // Convert to percentage
                }
            }
        }
        const teaWisdomBonus = baseTeaWisdom > 0 ? baseTeaWisdom * (1 + drinkConcentration / 100) : 0;

        // Get Enhancing skill level
        const enhancingSkill = skills.find((s) => s.skillHrid === '/skills/enhancing');
        const enhancingLevel = enhancingSkill?.level || 1;

        // Get Observatory house room level (enhancing uses observatory, NOT laboratory!)
        const houseLevel = dataManager.getHouseRoomLevel('/house_rooms/observatory');

        // Calculate global house buffs from ALL house rooms
        // Rare Find: 0.2% base + 0.2% per level (per room, only if level >= 1)
        // Wisdom: 0.05% base + 0.05% per level (per room, only if level >= 1)
        const houseRooms = dataManager.getHouseRooms();
        let houseRareFindBonus = 0;
        let houseWisdomBonus = 0;

        for (const [_hrid, room] of houseRooms) {
            const level = room.level || 0;
            if (level >= 1) {
                // Each room: 0.2% per level (NOT 0.2% base + 0.2% per level)
                houseRareFindBonus += 0.2 * level;
                // Each room: 0.05% per level (NOT 0.05% base + 0.05% per level)
                houseWisdomBonus += 0.05 * level;
            }
        }

        // Get Enhancing Speed community buff level
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed');
        // Formula: 20% base + 0.5% per level
        const communitySpeedBonus = communityBuffLevel > 0 ? 20 + (communityBuffLevel - 1) * 0.5 : 0;

        // Get Experience (Wisdom) community buff level
        const communityWisdomLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
        // Formula: 20% base + 0.5% per level (same as other community buffs)
        const communityWisdomBonus = communityWisdomLevel > 0 ? 20 + (communityWisdomLevel - 1) * 0.5 : 0;

        const achievementWisdomBonus =
            dataManager.getAchievementBuffFlatBoost('/action_types/enhancing', '/buff_types/wisdom') * 100;
        const achievementRareFindBonus =
            dataManager.getAchievementBuffFlatBoost('/action_types/enhancing', '/buff_types/rare_find') * 100;

        // Calculate total success rate bonus
        // Equipment + house + (check for other sources)
        const houseSuccessBonus = houseLevel * 0.05; // 0.05% per level for success
        const equipmentSuccessBonus = gear.toolBonus;
        const totalSuccessBonus = equipmentSuccessBonus + houseSuccessBonus;

        // Calculate total speed bonus
        // Speed bonus (from equipment) + house bonus (1% per level) + community buff + tea speed
        const houseSpeedBonus = houseLevel * 1.0; // 1% per level for action speed
        const totalSpeedBonus = gear.speedBonus + houseSpeedBonus + communitySpeedBonus + teaSpeedBonus;

        // Calculate total experience bonus
        // Equipment + house wisdom + tea wisdom + community wisdom + achievement wisdom
        const totalExperienceBonus =
            gear.experienceBonus + houseWisdomBonus + teaWisdomBonus + communityWisdomBonus + achievementWisdomBonus;

        // Calculate guzzling bonus multiplier (1.0 at level 0, scales with drink concentration)
        const guzzlingBonus = 1 + drinkConcentration / 100;

        return {
            // Core values for calculations
            enhancingLevel: enhancingLevel + teaLevelBonus, // Base level + tea bonus
            houseLevel: houseLevel,
            toolBonus: totalSuccessBonus, // Tool + house combined
            speedBonus: totalSpeedBonus, // Speed + house + community + tea combined
            rareFindBonus: gear.rareFindBonus + houseRareFindBonus + achievementRareFindBonus, // Rare find (equipment + house rooms + achievements)
            experienceBonus: totalExperienceBonus, // Experience (equipment + house + tea + community wisdom)
            guzzlingBonus: guzzlingBonus, // Drink concentration multiplier for blessed tea
            teas: teas,

            // Display info (for UI) - show best item per slot
            toolSlot: gear.toolSlot,
            bodySlot: gear.bodySlot,
            legsSlot: gear.legsSlot,
            handsSlot: gear.handsSlot,
            detectedTeaBonus: teaLevelBonus,
            communityBuffLevel: communityBuffLevel, // For display (speed)
            communitySpeedBonus: communitySpeedBonus, // For display
            communityWisdomLevel: communityWisdomLevel, // For display
            communityWisdomBonus: communityWisdomBonus, // For display
            achievementWisdomBonus: achievementWisdomBonus, // For display
            teaSpeedBonus: teaSpeedBonus, // For display
            teaWisdomBonus: teaWisdomBonus, // For display
            drinkConcentration: drinkConcentration, // For display
            houseRareFindBonus: houseRareFindBonus, // For display
            achievementRareFindBonus: achievementRareFindBonus, // For display
            houseWisdomBonus: houseWisdomBonus, // For display
            equipmentRareFind: gear.rareFindBonus, // For display
            equipmentExperience: gear.experienceBonus, // For display
            equipmentSuccessBonus: equipmentSuccessBonus, // For display
            houseSuccessBonus: houseSuccessBonus, // For display
            equipmentSpeedBonus: gear.speedBonus, // For display
            houseSpeedBonus: houseSpeedBonus, // For display
        };
    }

    /**
     * Get manual enhancing parameters from config settings
     * @returns {Object} Manual parameters
     */
    function getManualParams() {
        // Get values directly from config
        const getValue = (key, defaultValue) => {
            return config.getSettingValue(key, defaultValue);
        };

        const houseLevel = getValue('enhanceSim_houseLevel', 8);

        // Get tea selection from dropdown (replaces 3 separate checkboxes)
        const teaSelection = getValue('enhanceSim_tea', 'ultra');
        const teas = {
            enhancing: teaSelection === 'basic',
            superEnhancing: teaSelection === 'super',
            ultraEnhancing: teaSelection === 'ultra',
            blessed: getValue('enhanceSim_blessedTea', true),
        };

        // Calculate tea bonuses based on selection
        const teaLevelBonus =
            teaSelection === 'ultra' ? 8 : teaSelection === 'super' ? 6 : teaSelection === 'basic' ? 3 : 0;
        const teaSpeedBonus =
            teaSelection === 'ultra' ? 6 : teaSelection === 'super' ? 4 : teaSelection === 'basic' ? 2 : 0;

        // Calculate house bonuses
        const houseSpeedBonus = houseLevel * 1.0; // 1% per level
        const houseSuccessBonus = houseLevel * 0.05; // 0.05% per level

        // Get community buffs
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed');
        const communitySpeedBonus = communityBuffLevel > 0 ? 20 + (communityBuffLevel - 1) * 0.5 : 0;

        // Equipment speed is whatever's left after house/community/tea
        const totalSpeed = getValue('enhanceSim_speedBonus', 48.5);
        const equipmentSpeedBonus = Math.max(0, totalSpeed - houseSpeedBonus - communitySpeedBonus - teaSpeedBonus);

        const toolBonusEquipment = getValue('enhanceSim_toolBonus', 6.05);
        const totalToolBonus = toolBonusEquipment + houseSuccessBonus;

        return {
            enhancingLevel: getValue('enhanceSim_enhancingLevel', 140) + teaLevelBonus,
            houseLevel: houseLevel,
            toolBonus: totalToolBonus, // Total = equipment + house
            speedBonus: totalSpeed,
            rareFindBonus: getValue('enhanceSim_rareFindBonus', 0),
            experienceBonus: getValue('enhanceSim_experienceBonus', 0),
            guzzlingBonus: 1 + getValue('enhanceSim_drinkConcentration', 12.9) / 100,
            teas: teas,

            // Display info for manual mode
            toolSlot: null,
            bodySlot: null,
            legsSlot: null,
            handsSlot: null,
            detectedTeaBonus: teaLevelBonus,
            communityBuffLevel: communityBuffLevel,
            communitySpeedBonus: communitySpeedBonus,
            teaSpeedBonus: teaSpeedBonus,
            equipmentSpeedBonus: equipmentSpeedBonus,
            houseSpeedBonus: houseSpeedBonus,
            equipmentSuccessBonus: toolBonusEquipment, // Just equipment
            houseSuccessBonus: houseSuccessBonus,
        };
    }

    var enhancementConfig = /*#__PURE__*/Object.freeze({
        __proto__: null,
        getEnhancingParams: getEnhancingParams
    });

    /**
     * React Input Utility
     * Handles programmatic updates to React-controlled input elements
     *
     * React uses an internal _valueTracker to detect changes. When setting
     * input values programmatically, we must manipulate this tracker to
     * ensure React recognizes the change and updates its state.
     */

    /**
     * Set value on a React-controlled input element
     * This is the critical pattern for making React recognize programmatic changes
     *
     * @param {HTMLInputElement} input - Input element (text, number, etc.)
     * @param {string|number} value - Value to set
     * @param {Object} options - Optional configuration
     * @param {boolean} options.focus - Whether to focus the input after setting (default: true)
     * @param {boolean} options.dispatchInput - Whether to dispatch input event (default: true)
     * @param {boolean} options.dispatchChange - Whether to dispatch change event (default: false)
     */
    function setReactInputValue(input, value, options = {}) {
        const { focus = true, dispatchInput = true, dispatchChange = false } = options;

        if (!input) {
            console.warn('[React Input] No input element provided');
            return;
        }

        // Save the current value
        const lastValue = input.value;

        // Set the new value directly on the DOM
        input.value = value;

        // This is the critical part: React stores an internal _valueTracker
        // We need to set it to the old value before dispatching the event
        // so React sees the difference and updates its state
        const tracker = input._valueTracker;
        if (tracker) {
            tracker.setValue(lastValue);
        }

        // Dispatch events based on options
        if (dispatchInput) {
            const inputEvent = new Event('input', { bubbles: true });
            inputEvent.simulated = true;
            input.dispatchEvent(inputEvent);
        }

        if (dispatchChange) {
            const changeEvent = new Event('change', { bubbles: true });
            changeEvent.simulated = true;
            input.dispatchEvent(changeEvent);
        }

        // Focus the input to show the value
        if (focus) {
            input.focus();
        }
    }

    /**
     * Check if an input element is React-controlled
     * React-controlled inputs have an internal _valueTracker property
     *
     * @param {HTMLInputElement} input - Input element to check
     * @returns {boolean} True if React-controlled
     */
    function isReactControlledInput(input) {
        return input && input._valueTracker !== undefined;
    }

    /**
     * Set value on a select element (non-React pattern, for completeness)
     *
     * @param {HTMLSelectElement} select - Select element
     * @param {string} value - Value to select
     * @param {boolean} dispatchChange - Whether to dispatch change event (default: true)
     */
    function setSelectValue(select, value, dispatchChange = true) {
        if (!select) {
            console.warn('[React Input] No select element provided');
            return;
        }

        // Find and select the option
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === value) {
                select.options[i].selected = true;
                break;
            }
        }

        // Dispatch change event
        if (dispatchChange) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Set checked state on a checkbox/radio input (non-React pattern, for completeness)
     *
     * @param {HTMLInputElement} input - Checkbox or radio input
     * @param {boolean} checked - Checked state
     * @param {boolean} dispatchChange - Whether to dispatch change event (default: true)
     */
    function setCheckboxValue(input, checked, dispatchChange = true) {
        if (!input) {
            console.warn('[React Input] No input element provided');
            return;
        }

        input.checked = checked;

        // Dispatch change event
        if (dispatchChange) {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    var reactInput = /*#__PURE__*/Object.freeze({
        __proto__: null,
        isReactControlledInput: isReactControlledInput,
        setCheckboxValue: setCheckboxValue,
        setReactInputValue: setReactInputValue,
        setSelectValue: setSelectValue
    });

    /**
     * Material Calculator Utility
     * Shared calculation logic for material requirements with artisan bonus
     */


    /**
     * Calculate materials reserved by queued actions
     * @param {string} actionHrid - Action HRID to check queue for (optional - if null, calculates for ALL queued actions)
     * @returns {Map<string, number>} Map of itemHrid -> queued quantity
     */
    function calculateQueuedMaterialsForAction(actionHrid = null) {
        const queuedMaterials = new Map();
        const gameData = dataManager.getInitClientData();

        if (!gameData) {
            return queuedMaterials;
        }

        // Get all queued actions
        const queuedActions = dataManager.getCurrentActions();

        if (!queuedActions || queuedActions.length === 0) {
            return queuedMaterials;
        }

        // Process each queued action
        for (const queuedAction of queuedActions) {
            // If actionHrid is specified, only process matching actions
            if (actionHrid && queuedAction.actionHrid !== actionHrid) {
                continue;
            }

            const actionDetails = dataManager.getActionDetails(queuedAction.actionHrid);
            if (!actionDetails) {
                continue;
            }

            // Calculate remaining actions for this queued action
            // Finite actions: maxCount is target, currentCount is progress
            // Infinite actions: Skip for now (would require material limit calculation which is complex)
            let actionCount = 0;
            if (queuedAction.hasMaxCount) {
                actionCount = queuedAction.maxCount - queuedAction.currentCount;
            } else {
                // Infinite action - skip for now (materials for infinite actions are complex)
                // User can use the "Ignore queue" setting if they queue many infinite actions
                continue;
            }

            if (actionCount <= 0) {
                continue;
            }

            // Calculate artisan bonus for this action type
            const artisanBonus = calculateArtisanBonus(actionDetails);

            // Process regular input items
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                for (const input of actionDetails.inputItems) {
                    const basePerAction = input.count || input.amount || 1;

                    // Apply artisan reduction (same formula as profit-calculator)
                    const materialsPerAction = basePerAction * (1 - artisanBonus);

                    // Calculate total materials needed for this queued action
                    const totalForAction = Math.ceil(materialsPerAction * actionCount);

                    // Add to queued total
                    const currentQueued = queuedMaterials.get(input.itemHrid) || 0;
                    queuedMaterials.set(input.itemHrid, currentQueued + totalForAction);
                }
            }

            // Process upgrade item (if exists)
            if (actionDetails.upgradeItemHrid) {
                // Upgrade items always need exactly 1 per action, no artisan reduction
                const totalForAction = actionCount;

                const currentQueued = queuedMaterials.get(actionDetails.upgradeItemHrid) || 0;
                queuedMaterials.set(actionDetails.upgradeItemHrid, currentQueued + totalForAction);
            }
        }

        return queuedMaterials;
    }

    /**
     * Calculate material requirements for an action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/crafting/celestial_enhancer")
     * @param {number} numActions - Number of actions to perform
     * @param {boolean} accountForQueue - Whether to subtract queued materials from available inventory (default: false)
     * @returns {Array<Object>} Array of material requirement objects (includes upgrade items)
     */
    function calculateMaterialRequirements(actionHrid, numActions, accountForQueue = false) {
        const actionDetails = dataManager.getActionDetails(actionHrid);
        const inventory = dataManager.getInventory();
        const gameData = dataManager.getInitClientData();

        if (!actionDetails) {
            return [];
        }

        // Calculate artisan bonus (material reduction from Artisan Tea)
        const artisanBonus = calculateArtisanBonus(actionDetails);

        // Get queued materials if accounting for queue
        // Pass null to get materials for ALL queued actions (not just matching actionHrid)
        const queuedMaterialsMap = accountForQueue ? calculateQueuedMaterialsForAction(null) : new Map();

        const materials = [];

        // Process regular input items first
        if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
            for (const input of actionDetails.inputItems) {
                const basePerAction = input.count || input.amount || 1;

                // Apply artisan reduction to materials
                // Materials are consumed PER ACTION
                // Efficiency gives bonus actions for FREE (no material cost)
                const materialsPerAction = basePerAction * (1 - artisanBonus);

                // Calculate total materials needed for requested actions
                const totalRequired = Math.ceil(materialsPerAction * numActions);

                const inventoryItem = inventory.find((i) => i.itemHrid === input.itemHrid);
                const have = inventoryItem?.count || 0;

                // Calculate queued and available amounts
                const queued = queuedMaterialsMap.get(input.itemHrid) || 0;
                const available = Math.max(0, have - queued);
                const missingAmount = Math.max(0, totalRequired - available);

                const itemDetails = gameData.itemDetailMap[input.itemHrid];
                if (!itemDetails) {
                    continue;
                }

                materials.push({
                    itemHrid: input.itemHrid,
                    itemName: itemDetails.name,
                    required: totalRequired,
                    have: have,
                    queued: queued,
                    available: available,
                    missing: missingAmount,
                    isTradeable: itemDetails.isTradable === true, // British spelling
                    isUpgradeItem: false,
                });
            }
        }

        // Process upgrade item at the end (if exists)
        if (actionDetails.upgradeItemHrid) {
            // Upgrade items always need exactly 1 per action, no artisan reduction
            const totalRequired = numActions;

            const inventoryItem = inventory.find((i) => i.itemHrid === actionDetails.upgradeItemHrid);
            const have = inventoryItem?.count || 0;

            // Calculate queued and available amounts
            const queued = queuedMaterialsMap.get(actionDetails.upgradeItemHrid) || 0;
            const available = Math.max(0, have - queued);
            const missingAmount = Math.max(0, totalRequired - available);

            const itemDetails = gameData.itemDetailMap[actionDetails.upgradeItemHrid];
            if (itemDetails) {
                materials.push({
                    itemHrid: actionDetails.upgradeItemHrid,
                    itemName: itemDetails.name,
                    required: totalRequired,
                    have: have,
                    queued: queued,
                    available: available,
                    missing: missingAmount,
                    isTradeable: itemDetails.isTradable === true, // British spelling
                    isUpgradeItem: true, // Flag to identify upgrade items
                });
            }
        }

        return materials;
    }

    /**
     * Calculate artisan bonus (material reduction) for an action
     * @param {Object} actionDetails - Action details from game data
     * @returns {number} Artisan bonus (0-1 decimal, e.g., 0.1129 for 11.29% reduction)
     */
    function calculateArtisanBonus(actionDetails) {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return 0;
            }

            // Get character data
            const equipment = dataManager.getEquipment();
            const itemDetailMap = gameData.itemDetailMap || {};

            // Calculate artisan bonus (material reduction from Artisan Tea)
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
            const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            return artisanBonus;
        } catch (error) {
            console.error('[Material Calculator] Error calculating artisan bonus:', error);
            return 0;
        }
    }

    var materialCalculator = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateMaterialRequirements: calculateMaterialRequirements,
        calculateQueuedMaterialsForAction: calculateQueuedMaterialsForAction
    });

    /**
     * Pricing Helper Utility
     * Shared logic for selecting market prices based on pricing mode settings
     */


    /**
     * Select appropriate price from market data based on pricing mode settings
     * @param {Object} priceData - Market price data with bid/ask properties
     * @param {string} modeSetting - Config setting key for pricing mode (default: 'profitCalc_pricingMode')
     * @param {string} respectSetting - Config setting key for respect pricing mode flag (default: 'expectedValue_respectPricingMode')
     * @returns {number} Selected price (bid or ask)
     */
    function selectPrice(
        priceData,
        modeSetting = 'profitCalc_pricingMode',
        respectSetting = 'expectedValue_respectPricingMode'
    ) {
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

    var pricingHelper = /*#__PURE__*/Object.freeze({
        __proto__: null,
        selectPrice: selectPrice
    });

    /**
     * Cleanup Registry Utility
     * Centralized registration for listeners, observers, timers, and custom cleanup.
     */

    /**
     * Create a cleanup registry for deterministic teardown.
     * @returns {{
     *   registerListener: (target: EventTarget, event: string, handler: Function, options?: Object) => void,
     *   registerObserver: (observer: MutationObserver|{ disconnect: Function }) => void,
     *   registerInterval: (intervalId: number) => void,
     *   registerTimeout: (timeoutId: number) => void,
     *   registerCleanup: (cleanupFn: Function) => void,
     *   cleanupAll: () => void
     * }} Cleanup registry API
     */
    function createCleanupRegistry() {
        const listeners = [];
        const observers = [];
        const intervals = [];
        const timeouts = [];
        const customCleanups = [];

        const registerListener = (target, event, handler, options) => {
            if (!target || !event || !handler) {
                console.warn('[CleanupRegistry] registerListener called with invalid arguments');
                return;
            }

            target.addEventListener(event, handler, options);
            listeners.push({ target, event, handler, options });
        };

        const registerObserver = (observer) => {
            if (!observer || typeof observer.disconnect !== 'function') {
                console.warn('[CleanupRegistry] registerObserver called with invalid observer');
                return;
            }

            observers.push(observer);
        };

        const registerInterval = (intervalId) => {
            if (!intervalId) {
                console.warn('[CleanupRegistry] registerInterval called with invalid interval id');
                return;
            }

            intervals.push(intervalId);
        };

        const registerTimeout = (timeoutId) => {
            if (!timeoutId) {
                console.warn('[CleanupRegistry] registerTimeout called with invalid timeout id');
                return;
            }

            timeouts.push(timeoutId);
        };

        const registerCleanup = (cleanupFn) => {
            if (typeof cleanupFn !== 'function') {
                console.warn('[CleanupRegistry] registerCleanup called with invalid function');
                return;
            }

            customCleanups.push(cleanupFn);
        };

        const cleanupAll = () => {
            listeners.forEach(({ target, event, handler, options }) => {
                try {
                    target.removeEventListener(event, handler, options);
                } catch (error) {
                    console.error('[CleanupRegistry] Failed to remove listener:', error);
                }
            });
            listeners.length = 0;

            observers.forEach((observer) => {
                try {
                    observer.disconnect();
                } catch (error) {
                    console.error('[CleanupRegistry] Failed to disconnect observer:', error);
                }
            });
            observers.length = 0;

            intervals.forEach((intervalId) => {
                try {
                    clearInterval(intervalId);
                } catch (error) {
                    console.error('[CleanupRegistry] Failed to clear interval:', error);
                }
            });
            intervals.length = 0;

            timeouts.forEach((timeoutId) => {
                try {
                    clearTimeout(timeoutId);
                } catch (error) {
                    console.error('[CleanupRegistry] Failed to clear timeout:', error);
                }
            });
            timeouts.length = 0;

            customCleanups.forEach((cleanupFn) => {
                try {
                    cleanupFn();
                } catch (error) {
                    console.error('[CleanupRegistry] Custom cleanup failed:', error);
                }
            });
            customCleanups.length = 0;
        };

        return {
            registerListener,
            registerObserver,
            registerInterval,
            registerTimeout,
            registerCleanup,
            cleanupAll,
        };
    }

    var cleanupRegistry = /*#__PURE__*/Object.freeze({
        __proto__: null,
        createCleanupRegistry: createCleanupRegistry
    });

    /**
     * House Cost Calculator Utility
     * Calculates the total cost to build house rooms to specific levels
     * Used for combat score calculation
     */


    /**
     * Calculate the total cost to build a house room to a specific level
     * @param {string} houseRoomHrid - House room HRID (e.g., '/house_rooms/dojo')
     * @param {number} currentLevel - Target level (1-8)
     * @returns {number} Total build cost in coins
     */
    function calculateHouseBuildCost(houseRoomHrid, currentLevel) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const houseRoomDetailMap = gameData.houseRoomDetailMap;
        if (!houseRoomDetailMap) return 0;

        const houseDetail = houseRoomDetailMap[houseRoomHrid];
        if (!houseDetail) return 0;

        const upgradeCostsMap = houseDetail.upgradeCostsMap;
        if (!upgradeCostsMap) return 0;

        let totalCost = 0;

        // Sum costs for all levels from 1 to current
        for (let level = 1; level <= currentLevel; level++) {
            const levelUpgrades = upgradeCostsMap[level];
            if (!levelUpgrades) continue;

            // Add cost for each material required at this level
            for (const item of levelUpgrades) {
                // Special case: Coins have face value of 1 (no market price)
                if (item.itemHrid === '/items/coin') {
                    const itemCost = item.count * 1;
                    totalCost += itemCost;
                    continue;
                }

                const prices = marketAPI.getPrice(item.itemHrid, 0);
                if (!prices) continue;

                // Match MCS behavior: if one price is positive and other is negative, use positive for both
                let ask = prices.ask;
                let bid = prices.bid;

                if (ask > 0 && bid < 0) {
                    bid = ask;
                }
                if (bid > 0 && ask < 0) {
                    ask = bid;
                }

                // Use weighted average
                const weightedPrice = (ask + bid) / 2;

                const itemCost = item.count * weightedPrice;
                totalCost += itemCost;
            }
        }

        return totalCost;
    }

    /**
     * Calculate total cost for all battle houses
     * @param {Object} characterHouseRooms - Map of character house rooms from profile data
     * @returns {Object} {totalCost, breakdown: [{name, level, cost}]}
     */
    function calculateBattleHousesCost(characterHouseRooms) {
        const battleHouses = ['dining_room', 'library', 'dojo', 'gym', 'armory', 'archery_range', 'mystical_study'];

        const gameData = dataManager.getInitClientData();
        if (!gameData) return { totalCost: 0, breakdown: [] };

        const houseRoomDetailMap = gameData.houseRoomDetailMap;
        if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

        let totalCost = 0;
        const breakdown = [];

        for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
            // Check if this is a battle house
            const isBattleHouse = battleHouses.some((battleHouse) => houseRoomHrid.includes(battleHouse));

            if (!isBattleHouse) continue;

            const level = houseData.level || 0;
            if (level === 0) continue;

            const cost = calculateHouseBuildCost(houseRoomHrid, level);
            totalCost += cost;

            // Get human-readable name
            const houseDetail = houseRoomDetailMap[houseRoomHrid];
            const houseName = houseDetail?.name || houseRoomHrid.replace('/house_rooms/', '');

            breakdown.push({
                name: houseName,
                level: level,
                cost: cost,
            });
        }

        // Sort by cost descending
        breakdown.sort((a, b) => b.cost - a.cost);

        return { totalCost, breakdown };
    }

    var houseCostCalculator = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateBattleHousesCost: calculateBattleHousesCost,
        calculateHouseBuildCost: calculateHouseBuildCost
    });

    /**
     * Enhancement Calculator
     *
     * Uses Markov Chain matrix math to calculate exact expected values for enhancement attempts.
     * Based on the original MWI Tools Enhancelate() function.
     *
     * Math.js library is loaded via userscript @require header.
     */

    /**
     * Base success rates by enhancement level (before bonuses)
     */
    const BASE_SUCCESS_RATES = [
        50, // +1
        45, // +2
        45, // +3
        40, // +4
        40, // +5
        40, // +6
        35, // +7
        35, // +8
        35, // +9
        35, // +10
        30, // +11
        30, // +12
        30, // +13
        30, // +14
        30, // +15
        30, // +16
        30, // +17
        30, // +18
        30, // +19
        30, // +20
    ];

    /**
     * Calculate total success rate bonus multiplier
     * @param {Object} params - Enhancement parameters
     * @param {number} params.enhancingLevel - Effective enhancing level (base + tea bonus)
     * @param {number} params.toolBonus - Tool success bonus % (already includes equipment + house bonus)
     * @param {number} params.itemLevel - Item level being enhanced
     * @returns {number} Success rate multiplier (e.g., 1.0519 = 105.19% of base rates)
     */
    function calculateSuccessMultiplier(params) {
        const { enhancingLevel, toolBonus, itemLevel } = params;

        // Total bonus calculation
        // toolBonus already includes equipment + house success bonus from config
        // We only need to add level advantage here

        let totalBonus;

        if (enhancingLevel >= itemLevel) {
            // Above or at item level: +0.05% per level above item level
            const levelAdvantage = 0.05 * (enhancingLevel - itemLevel);
            totalBonus = 1 + (toolBonus + levelAdvantage) / 100;
        } else {
            // Below item level: Penalty based on level deficit
            totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;
        }

        return totalBonus;
    }

    /**
     * Calculate per-action time for enhancement
     * Simple calculation that doesn't require Markov chain analysis
     * @param {number} enhancingLevel - Effective enhancing level (includes tea bonus)
     * @param {number} itemLevel - Item level being enhanced
     * @param {number} speedBonus - Speed bonus % (for action time calculation)
     * @returns {number} Per-action time in seconds
     */
    function calculatePerActionTime(enhancingLevel, itemLevel, speedBonus = 0) {
        const baseActionTime = 12; // seconds
        let speedMultiplier;

        if (enhancingLevel > itemLevel) {
            // Above item level: Get speed bonus from level advantage + equipment + house
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
        } else {
            // Below item level: Only equipment + house speed bonus
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + speedBonus / 100;
        }

        return baseActionTime / speedMultiplier;
    }

    /**
     * Calculate enhancement statistics using Markov Chain matrix inversion
     * @param {Object} params - Enhancement parameters
     * @param {number} params.enhancingLevel - Effective enhancing level (includes tea bonus)
     * @param {number} params.houseLevel - Observatory house room level (used for speed calculation only)
     * @param {number} params.toolBonus - Tool success bonus % (already includes equipment + house success bonus from config)
     * @param {number} params.speedBonus - Speed bonus % (for action time calculation)
     * @param {number} params.itemLevel - Item level being enhanced
     * @param {number} params.targetLevel - Target enhancement level (1-20)
     * @param {number} params.protectFrom - Start using protection items at this level (0 = never)
     * @param {boolean} params.blessedTea - Whether Blessed Tea is active (1% double jump)
     * @param {number} params.guzzlingBonus - Drink concentration multiplier (1.0 = no bonus, scales blessed tea)
     * @returns {Object} Enhancement statistics
     */
    function calculateEnhancement(params) {
        const {
            enhancingLevel,
            _houseLevel,
            toolBonus,
            speedBonus = 0,
            itemLevel,
            targetLevel,
            protectFrom = 0,
            blessedTea = false,
            guzzlingBonus = 1.0,
        } = params;

        // Validate inputs
        if (targetLevel < 1 || targetLevel > 20) {
            throw new Error('Target level must be between 1 and 20');
        }
        if (protectFrom < 0 || protectFrom > targetLevel) {
            throw new Error('Protection level must be between 0 and target level');
        }

        // Calculate success rate multiplier
        const successMultiplier = calculateSuccessMultiplier({
            enhancingLevel,
            toolBonus,
            itemLevel,
        });

        // Build Markov Chain transition matrix (20×20)
        const markov = math.zeros(20, 20);

        for (let i = 0; i < targetLevel; i++) {
            const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
            const successChance = baseSuccessRate * successMultiplier;

            // Where do we go on failure?
            // Protection only applies when protectFrom > 0 AND we're at or above that level
            const failureDestination = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

            if (blessedTea) {
                // Blessed Tea: 1% base chance to jump +2, scaled by guzzling bonus
                // Remaining success chance goes to +1 (after accounting for skip chance)
                const skipChance = successChance * 0.01 * guzzlingBonus;
                const remainingSuccess = successChance * (1 - 0.01 * guzzlingBonus);

                markov.set([i, i + 2], skipChance);
                markov.set([i, i + 1], remainingSuccess);
                markov.set([i, failureDestination], 1 - successChance);
            } else {
                // Normal: Success goes to +1, failure goes to destination
                markov.set([i, i + 1], successChance);
                markov.set([i, failureDestination], 1.0 - successChance);
            }
        }

        // Absorbing state at target level
        markov.set([targetLevel, targetLevel], 1.0);

        // Extract transient matrix Q (all states before target)
        const Q = markov.subset(math.index(math.range(0, targetLevel), math.range(0, targetLevel)));

        // Fundamental matrix: M = (I - Q)^-1
        const I = math.identity(targetLevel);
        const M = math.inv(math.subtract(I, Q));

        // Expected attempts from level 0 to target
        // Sum all elements in first row of M up to targetLevel
        let attempts = 0;
        for (let i = 0; i < targetLevel; i++) {
            attempts += M.get([0, i]);
        }

        // Expected protection item uses
        let protects = 0;
        if (protectFrom > 0 && protectFrom < targetLevel) {
            for (let i = protectFrom; i < targetLevel; i++) {
                const timesAtLevel = M.get([0, i]);
                const failureChance = markov.get([i, i - 1]);
                protects += timesAtLevel * failureChance;
            }
        }

        // Action time calculation
        const baseActionTime = 12; // seconds
        let speedMultiplier;

        if (enhancingLevel > itemLevel) {
            // Above item level: Get speed bonus from level advantage + equipment + house
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
        } else {
            // Below item level: Only equipment + house speed bonus
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + speedBonus / 100;
        }

        const perActionTime = baseActionTime / speedMultiplier;
        const totalTime = perActionTime * attempts;

        return {
            attempts: attempts, // Keep exact decimal value for calculations
            attemptsRounded: Math.round(attempts), // Rounded for display
            protectionCount: protects, // Keep decimal precision
            perActionTime: perActionTime,
            totalTime: totalTime,
            successMultiplier: successMultiplier,

            // Detailed success rates for each level
            successRates: BASE_SUCCESS_RATES.slice(0, targetLevel).map((base, i) => {
                return {
                    level: i + 1,
                    baseRate: base,
                    actualRate: Math.min(100, base * successMultiplier),
                };
            }),
        };
    }

    var enhancementCalculator = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateEnhancement: calculateEnhancement,
        calculatePerActionTime: calculatePerActionTime
    });

    /**
     * Foundation Utils Library
     * All utility modules
     *
     * Exports to: window.Toolasha.Utils
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Utils = {
        formatters,
        efficiency: efficiency$1,
        profitHelpers: profitHelpers$1,
        profitConstants: profitConstants$1,
        dom: dom$1,
        domObserverHelpers,
        timerRegistry,
        bonusRevenueCalculator,
        enhancementMultipliers,
        experienceParser: experienceParser$1,
        marketListings,
        actionCalculator,
        actionPanelHelper,
        teaParser: teaParser$1,
        buffParser,
        selectors,
        houseEfficiency: houseEfficiency$1,
        experienceCalculator: experienceCalculator$1,
        marketData: marketData$1,
        abilityCalc,
        equipmentParser,
        uiComponents: uiComponents$1,
        enhancementConfig,
        enhancementGearDetector,
        reactInput,
        materialCalculator,
        tokenValuation,
        pricingHelper,
        cleanupRegistry,
        houseCostCalculator,
        enhancementCalculator,
    };

    console.log('[Toolasha] Utils library loaded');

})(Toolasha.Core.config, Toolasha.Core.domObserver, Toolasha.Core.marketAPI, Toolasha.Core.dataManager);
