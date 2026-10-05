import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    levelExperienceTable: [],
    prices: {},
    itemDetailMap: {},
    askPrice: 0,
    askPriceIsOutlier: false,
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({
            levelExperienceTable: mocks.levelExperienceTable,
            itemDetailMap: mocks.itemDetailMap,
        })),
    },
}));

vi.mock('./market-data.js', () => ({
    getItemPrices: vi.fn(() => ({
        ask: mocks.prices.ask,
        bid: mocks.prices.bid,
        askOutlier: mocks.prices.askOutlier || false,
        bidOutlier: mocks.prices.bidOutlier || false,
    })),
    getItemPriceOutlierInfo: vi.fn(() => ({ value: mocks.askPrice, isOutlier: mocks.askPriceIsOutlier })),
}));

import {
    calculateAbilityCost,
    calculateAbilityLevelUpCost,
    isStarterAbility,
    calculateAbilityBookCostDataDriven,
} from './ability-cost-calculator.js';

describe('isStarterAbility', () => {
    test('starter abilities give 50 XP per book', () => {
        expect(isStarterAbility('/abilities/fireball')).toBe(true);
        expect(isStarterAbility('/abilities/smack')).toBe(true);
    });

    test('non-starter abilities are not starters', () => {
        expect(isStarterAbility('/abilities/speed_aura')).toBe(false);
    });
});

describe('calculateAbilityCost / calculateAbilityLevelUpCost - integer book counts (CSIM-AUD-017)', () => {
    beforeEach(() => {
        mocks.levelExperienceTable = [];
        for (let i = 0; i <= 20; i++) mocks.levelExperienceTable.push(i * 137); // deliberately not a clean multiple of 500
        mocks.prices = { ask: 1000, bid: 800 };
    });

    test('calculateAbilityLevelUpCost rounds a fractional book requirement up to the next whole book', () => {
        // Non-starter ability: xpPerBook = 500. targetXp - currentXp should not divide evenly.
        const { cost } = calculateAbilityLevelUpCost('/abilities/speed_aura', 5, 600, 10);
        const targetXp = mocks.levelExperienceTable[10];
        const xpNeeded = targetXp - 600;
        const exactBooks = xpNeeded / 500;
        expect(Number.isInteger(exactBooks)).toBe(false);

        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        const expectedBooks = Math.ceil(xpNeeded / 500);
        expect(cost).toBeCloseTo(expectedBooks * weightedPrice);
    });

    test('calculateAbilityLevelUpCost with live XP progress costs less than treating currentLevel as freshly dinged (0 progress)', () => {
        const targetLevel = 10;
        const levelFloorXp = mocks.levelExperienceTable[5];
        const { cost: costFromFloor } = calculateAbilityLevelUpCost(
            '/abilities/speed_aura',
            5,
            levelFloorXp,
            targetLevel
        );
        const { cost: costWithProgress } = calculateAbilityLevelUpCost(
            '/abilities/speed_aura',
            5,
            levelFloorXp + 200,
            targetLevel
        );

        expect(costWithProgress).toBeLessThan(costFromFloor);
    });

    test('calculateAbilityCost (from level 0) always returns an integer book count times price', () => {
        const { cost } = calculateAbilityCost('/abilities/speed_aura', 7);
        const targetXp = mocks.levelExperienceTable[7];
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        const expectedBooks = Math.ceil(targetXp / 500) + 1;
        expect(cost).toBeCloseTo(expectedBooks * weightedPrice);
    });

    test('a starter ability uses 50 XP per book instead of 500', () => {
        const { cost } = calculateAbilityLevelUpCost('/abilities/fireball', 0, 0, 3);
        const targetXp = mocks.levelExperienceTable[3];
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        const expectedBooks = Math.ceil(targetXp / 50) + 1;
        expect(cost).toBeCloseTo(expectedBooks * weightedPrice);
    });

    test('unlearned ability (level 0) requires the +1 unlock book', () => {
        const { cost: withUnlock } = calculateAbilityLevelUpCost('/abilities/speed_aura', 0, 0, 5);
        const { cost: withoutUnlock } = calculateAbilityLevelUpCost('/abilities/speed_aura', 1, 0, 5);
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        expect(withUnlock - withoutUnlock).toBeCloseTo(weightedPrice);
    });

    test('exactly at the level threshold with zero progress still returns an integer book count', () => {
        const { cost } = calculateAbilityLevelUpCost('/abilities/speed_aura', 5, mocks.levelExperienceTable[5], 6);
        const targetXp = mocks.levelExperienceTable[6];
        const xpNeeded = targetXp - mocks.levelExperienceTable[5];
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        expect(cost).toBeCloseTo(Math.ceil(xpNeeded / 500) * weightedPrice);
    });

    test('flags isOutlier when the book price was substituted by the outlier guard', () => {
        mocks.prices = { ask: 1000, bid: 800, askOutlier: true, bidOutlier: false };
        const { isOutlier } = calculateAbilityCost('/abilities/speed_aura', 7);
        expect(isOutlier).toBe(true);
    });

    test('does not flag isOutlier when the book price is within band', () => {
        const { isOutlier } = calculateAbilityCost('/abilities/speed_aura', 7);
        expect(isOutlier).toBe(false);
    });
});

describe('calculateAbilityBookCostDataDriven - data-driven XP/book, Ask-only (TLA-041 / F-11)', () => {
    beforeEach(() => {
        mocks.levelExperienceTable = [0, 1001]; // index 1 = target level used below
        mocks.itemDetailMap = { '/items/speed_aura': { abilityBookDetail: { experienceGain: 125 } } };
        mocks.askPrice = 10000;
        mocks.askPriceIsOutlier = false;
    });

    test('F-11: 125 XP/book, target 1001 XP, Ask 10,000/book -> 10 books = 100,000', () => {
        const result = calculateAbilityBookCostDataDriven('/abilities/speed_aura', 1);
        expect(result).toEqual({ cost: 100000, complete: true, isOutlier: false });
    });

    test('is not hardwired to 50/500 - a starter-named ability still uses its own experienceGain', () => {
        mocks.itemDetailMap = { '/items/fireball': { abilityBookDetail: { experienceGain: 125 } } };
        const result = calculateAbilityBookCostDataDriven('/abilities/fireball', 1);
        expect(result).toEqual({ cost: 100000, complete: true, isOutlier: false });
    });

    test('missing experienceGain marks the result incomplete instead of falling back to a hardcoded value', () => {
        mocks.itemDetailMap = { '/items/speed_aura': {} };
        const result = calculateAbilityBookCostDataDriven('/abilities/speed_aura', 1);
        expect(result).toEqual({ cost: null, complete: false, isOutlier: false });
    });

    test('missing Ask price marks the result incomplete rather than returning a zero cost', () => {
        mocks.askPrice = 0;
        const result = calculateAbilityBookCostDataDriven('/abilities/speed_aura', 1);
        expect(result).toEqual({ cost: null, complete: false, isOutlier: false });
    });

    test('flags isOutlier when the Ask price was substituted by the outlier guard', () => {
        mocks.askPriceIsOutlier = true;
        const result = calculateAbilityBookCostDataDriven('/abilities/speed_aura', 1);
        expect(result.isOutlier).toBe(true);
    });
});
