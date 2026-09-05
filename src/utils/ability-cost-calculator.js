/**
 * Ability Cost Calculator Utility
 * Calculates the cost to reach a specific ability level
 * Extracted from ability-book-calculator.js for reuse in combat score
 */

import dataManager from '../core/data-manager.js';
import marketAPI from '../api/marketplace.js';
import { getItemPrice } from './market-data.js';

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
export function isStarterAbility(abilityHrid) {
    return STARTER_ABILITIES.some((skill) => abilityHrid.includes(skill));
}

/**
 * Calculate the cost to reach a specific ability level from level 0
 * @param {string} abilityHrid - Ability HRID (e.g., '/abilities/fireball')
 * @param {number} targetLevel - Target level to reach
 * @returns {number} Total cost in coins
 */
export function calculateAbilityCost(abilityHrid, targetLevel) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return 0;

    const levelXpTable = gameData.levelExperienceTable;
    if (!levelXpTable) return 0;

    // Get XP needed to reach target level from level 0
    const targetXp = levelXpTable[targetLevel] || 0;

    // Determine XP per book (50 for starters, 500 for advanced)
    const xpPerBook = isStarterAbility(abilityHrid) ? 50 : 500;

    // Calculate books needed - always an integer purchase, never fractional (CSIM-AUD-017)
    let booksNeeded = Math.ceil(targetXp / xpPerBook);
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
export function calculateAbilityLevelUpCost(abilityHrid, currentLevel, currentXp, targetLevel) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return 0;

    const levelXpTable = gameData.levelExperienceTable;
    if (!levelXpTable) return 0;

    // Calculate XP needed
    const targetXp = levelXpTable[targetLevel] || 0;
    const xpNeeded = targetXp - currentXp;

    // Determine XP per book
    const xpPerBook = isStarterAbility(abilityHrid) ? 50 : 500;

    // Calculate books needed - always an integer purchase, never fractional (CSIM-AUD-017)
    let booksNeeded = Math.max(0, Math.ceil(xpNeeded / xpPerBook));

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

/**
 * Calculate the cost to reach a specific ability level from level 0, reading real per-item
 * `abilityBookDetail.experienceGain` instead of a hardcoded starter/non-starter split, and
 * pricing the book with pure Ask (TLA-041 / F-11). Never falls back to 0 silently — a missing
 * `experienceGain` or Ask price marks the result incomplete.
 * @param {string} abilityHrid - Ability HRID
 * @param {number} targetLevel - Target level to reach
 * @returns {{cost: number|null, complete: boolean}}
 */
export function calculateAbilityBookCostDataDriven(abilityHrid, targetLevel) {
    const gameData = dataManager.getInitClientData();
    const levelXpTable = gameData?.levelExperienceTable;
    if (!levelXpTable) return { cost: null, complete: false };

    const itemHrid = abilityHrid.replace('/abilities/', '/items/');
    const xpPerBook = gameData.itemDetailMap?.[itemHrid]?.abilityBookDetail?.experienceGain;
    if (!(xpPerBook > 0)) return { cost: null, complete: false };

    const targetXp = levelXpTable[targetLevel] || 0;
    const booksNeeded = Math.ceil(targetXp / xpPerBook) + 1; // +1 = initial learn book

    const ask = getItemPrice(itemHrid, { mode: 'ask' });
    if (!(ask > 0)) return { cost: null, complete: false };

    return { cost: booksNeeded * ask, complete: true };
}
