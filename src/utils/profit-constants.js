/**
 * Profit Calculation Constants
 * Shared constants used across profit calculators
 */

/**
 * Marketplace tax rate (2%)
 */
export const MARKET_TAX = 0.02;

/**
 * Base drink consumption rate per hour (before Drink Concentration)
 */
export const DRINKS_PER_HOUR_BASE = 12;

/**
 * Seconds per hour (for rate conversions)
 */
export const SECONDS_PER_HOUR = 3600;

/**
 * Hours per day (for daily profit calculations)
 */
export const HOURS_PER_DAY = 24;

/**
 * Gathering skill action types
 * Skills that gather raw materials from the world
 */
export const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

/**
 * Production skill action types
 * Skills that craft items from materials
 */
export const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

/**
 * All non-combat skill action types
 */
export const ALL_SKILL_TYPES = [...GATHERING_TYPES, ...PRODUCTION_TYPES];

export default {
    MARKET_TAX,
    DRINKS_PER_HOUR_BASE,
    SECONDS_PER_HOUR,
    HOURS_PER_DAY,
    GATHERING_TYPES,
    PRODUCTION_TYPES,
    ALL_SKILL_TYPES,
};
