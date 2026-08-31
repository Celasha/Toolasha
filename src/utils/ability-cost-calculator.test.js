import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    levelExperienceTable: [],
    prices: {},
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ levelExperienceTable: mocks.levelExperienceTable })),
    },
}));

vi.mock('../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn(() => mocks.prices),
    },
}));

import { calculateAbilityCost, calculateAbilityLevelUpCost, isStarterAbility } from './ability-cost-calculator.js';

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
        const cost = calculateAbilityLevelUpCost('/abilities/speed_aura', 5, 600, 10);
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
        const costFromFloor = calculateAbilityLevelUpCost('/abilities/speed_aura', 5, levelFloorXp, targetLevel);
        const costWithProgress = calculateAbilityLevelUpCost(
            '/abilities/speed_aura',
            5,
            levelFloorXp + 200,
            targetLevel
        );

        expect(costWithProgress).toBeLessThan(costFromFloor);
    });

    test('calculateAbilityCost (from level 0) always returns an integer book count times price', () => {
        const cost = calculateAbilityCost('/abilities/speed_aura', 7);
        const targetXp = mocks.levelExperienceTable[7];
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        const expectedBooks = Math.ceil(targetXp / 500) + 1;
        expect(cost).toBeCloseTo(expectedBooks * weightedPrice);
    });

    test('a starter ability uses 50 XP per book instead of 500', () => {
        const cost = calculateAbilityLevelUpCost('/abilities/fireball', 0, 0, 3);
        const targetXp = mocks.levelExperienceTable[3];
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        const expectedBooks = Math.ceil(targetXp / 50) + 1;
        expect(cost).toBeCloseTo(expectedBooks * weightedPrice);
    });

    test('unlearned ability (level 0) requires the +1 unlock book', () => {
        const withUnlock = calculateAbilityLevelUpCost('/abilities/speed_aura', 0, 0, 5);
        const withoutUnlock = calculateAbilityLevelUpCost('/abilities/speed_aura', 1, 0, 5);
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        expect(withUnlock - withoutUnlock).toBeCloseTo(weightedPrice);
    });

    test('exactly at the level threshold with zero progress still returns an integer book count', () => {
        const cost = calculateAbilityLevelUpCost('/abilities/speed_aura', 5, mocks.levelExperienceTable[5], 6);
        const targetXp = mocks.levelExperienceTable[6];
        const xpNeeded = targetXp - mocks.levelExperienceTable[5];
        const weightedPrice = (mocks.prices.ask + mocks.prices.bid) / 2;
        expect(cost).toBeCloseTo(Math.ceil(xpNeeded / 500) * weightedPrice);
    });
});
