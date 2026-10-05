import { describe, expect, test } from 'vitest';
import { formatProfitDisplay } from './gathering-profit.js';

function baseProfitData(overrides = {}) {
    return {
        profitPerHour: 1000,
        profitPerDay: 24000,
        revenuePerHour: 1500,
        drinkCostPerHour: 0,
        marketTax: 0,
        bonusRevenue: null,
        totalGathering: 0,
        totalEfficiency: 0,
        details: {},
        actionsPerHour: 100,
        ...overrides,
    };
}

describe('formatProfitDisplay - outlier guard propagation (bonus revenue)', () => {
    test('flags the Bonus revenue summary line when any bonus drop was substituted', () => {
        const html = formatProfitDisplay(
            baseProfitData({
                bonusRevenue: {
                    totalBonusRevenue: 500,
                    essenceFindBonus: 0,
                    rareFindBonus: 0,
                    bonusDrops: [
                        {
                            itemHrid: '/items/essence',
                            itemName: 'Essence',
                            dropRate: 0.1,
                            dropsPerHour: 5,
                            revenuePerHour: 500,
                            isOutlier: true,
                        },
                    ],
                },
            })
        );

        expect(html).toContain('Bonus revenue:');
        expect(html).toContain('⚠');
    });

    test('does not flag the Bonus revenue summary line when no bonus drop was substituted', () => {
        const html = formatProfitDisplay(
            baseProfitData({
                bonusRevenue: {
                    totalBonusRevenue: 500,
                    essenceFindBonus: 0,
                    rareFindBonus: 0,
                    bonusDrops: [
                        {
                            itemHrid: '/items/essence',
                            itemName: 'Essence',
                            dropRate: 0.1,
                            dropsPerHour: 5,
                            revenuePerHour: 500,
                            isOutlier: false,
                        },
                    ],
                },
            })
        );

        expect(html).not.toContain('⚠');
    });

    test('flags only the affected drop line, not an unaffected sibling drop', () => {
        const html = formatProfitDisplay(
            baseProfitData({
                bonusRevenue: {
                    totalBonusRevenue: 500,
                    essenceFindBonus: 0,
                    rareFindBonus: 0,
                    bonusDrops: [
                        {
                            itemHrid: '/items/essence',
                            itemName: 'Essence',
                            dropRate: 0.1,
                            dropsPerHour: 5,
                            revenuePerHour: 300,
                            isOutlier: true,
                        },
                        {
                            itemHrid: '/items/gem',
                            itemName: 'Gem',
                            dropRate: 0.05,
                            dropsPerHour: 2,
                            revenuePerHour: 200,
                            isOutlier: false,
                        },
                    ],
                },
            })
        );

        const essenceLine = html.split('<br>').find((l) => l.includes('Essence'));
        const gemLine = html.split('<br>').find((l) => l.includes('Gem'));
        expect(essenceLine).toContain('⚠');
        expect(gemLine).not.toContain('⚠');
    });
});
