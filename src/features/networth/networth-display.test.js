/* @vitest-environment jsdom */

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { COLOR_WARNING: '#ffa500', COLOR_ACCENT: '#22c55e', getSetting: vi.fn(() => true) },
}));

vi.mock('../../core/i18n.js', () => ({
    t: vi.fn((key, params) => {
        if (key === 'marketHistory.sellLabel') return 'Sell';
        if (key === 'marketHistory.buyLabel') return 'Buy';
        if (key === 'marketData.outlierPriceWarningTooltip') return 'outlier-tooltip';
        return params ? `${key}:${JSON.stringify(params)}` : key;
    }),
}));

vi.mock('../../core/data-manager.js', () => ({ default: {} }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../utils/formatters.js', () => ({
    networthFormatter: (v) => `N${v}`,
    formatKMB: (v) => `K${v}`,
}));
vi.mock('./networth-history-chart.js', () => ({ default: {} }));
vi.mock('../market/expected-value-calculator.js', () => ({ default: { isInitialized: false } }));
vi.mock('../combat-stats/combat-stats-calculator.js', () => ({ DUNGEON_CHEST_CHEST_KEYS: {} }));
vi.mock('../../utils/dungeon-key-cost.js', () => ({ getKeyPriceInfo: vi.fn(() => ({ price: 0, isOutlier: false })) }));
vi.mock('./networth-exclusion-popup.js', () => ({ default: {} }));
vi.mock('./networth-exclusions.js', () => ({ removeExclusion: vi.fn() }));

import { networthInventoryDisplay, getSharePercent } from './networth-display.js';

describe('NetworthInventoryDisplay outlier warning icons', () => {
    test('renderEquipmentBreakdown emits one row per item with value cell and outlier icon only when flagged', () => {
        const html = networthInventoryDisplay.renderEquipmentBreakdown([
            { name: 'Sinister Cape', value: 1000, isOutlier: true },
            { name: 'Normal Sword', value: 500, isOutlier: false },
        ]);
        const rows = html.split('<div class="mwi-nw-row').slice(1);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain('Sinister Cape');
        expect(rows[0]).toContain('⚠');
        expect(rows[0]).toContain('>N1000</span>');
        expect(rows[1]).toContain('Normal Sword');
        expect(rows[1]).toContain('>N500</span>');
        expect(rows[1]).not.toContain('⚠');
    });

    test('renderListingsBreakdown marks the listing type as a muted count span', () => {
        const html = networthInventoryDisplay.renderListingsBreakdown([
            { name: 'Rare Gem', value: 2000, isSell: true, isOutlier: true },
            { name: 'Common Ore', value: 100, isSell: false, isOutlier: false },
        ]);
        expect(html).toContain('Rare Gem');
        expect(html).toContain('mwi-nw-count">(Sell)</span>');
        expect(html).toContain('>N2000</span>');
        expect(html).toContain('Common Ore');
        expect(html).toContain('mwi-nw-count">(Buy)</span>');
        expect(html).toContain('>N100</span>');
    });

    test('renderHousesBreakdown renders level as a muted count span', () => {
        const html = networthInventoryDisplay.renderHousesBreakdown([
            { name: 'Library', level: 7, cost: 371, isOutlier: false },
        ]);
        expect(html).toContain('Library');
        expect(html).toContain('mwi-nw-count">7</span>');
        expect(html).toContain('>N371</span>');
    });

    test('renderInventoryBreakdown renders coin row and category nodes', () => {
        const html = networthInventoryDisplay.renderInventoryBreakdown({
            byCategory: {
                Gems: {
                    totalValue: 130,
                    items: [{ name: 'Ruby', count: 55, value: 130, isOutlier: false, itemHrid: '/items/ruby' }],
                },
            },
            breakdown: [{ itemHrid: '/items/coin', name: 'Coin', count: 1, value: 148 }],
        });
        expect(html).toContain('mwi-nw-val">N148</span>');
        expect(html).toContain('id="mwi-nw-cat-gems"');
        expect(html).toContain('Ruby');
    });

    test('renderOpenableItemRow keeps a details node with chest id', () => {
        const html = networthInventoryDisplay.renderOpenableItemRow({
            name: 'Mystery Chest',
            count: 1,
            value: 5000,
            isOutlier: true,
            itemHrid: '/items/mystery_chest',
        });
        expect(html).toContain('id="mwi-nw-chest-mystery_chest"');
        expect(html).toContain('Mystery Chest');
        expect(html).toContain('⚠');
    });

    test('no icon markup appears anywhere when nothing is flagged', () => {
        const html = networthInventoryDisplay.renderEquipmentBreakdown([
            { name: 'Plain Item', value: 10, isOutlier: false },
        ]);
        expect(html).not.toContain('⚠');
    });
});

describe('getSharePercent', () => {
    test('returns a 64/36 style split for positive totals', () => {
        expect(
            getSharePercent({ totalNetworth: 2066, currentAssets: { total: 1320 }, fixedAssets: { total: 746 } })
        ).toEqual({ currentPct: 64, fixedPct: 36 });
    });

    test('returns null when either side is zero', () => {
        expect(
            getSharePercent({ totalNetworth: 100, currentAssets: { total: 100 }, fixedAssets: { total: 0 } })
        ).toBeNull();
        expect(
            getSharePercent({ totalNetworth: 100, currentAssets: { total: 0 }, fixedAssets: { total: 100 } })
        ).toBeNull();
        expect(
            getSharePercent({ totalNetworth: 0, currentAssets: { total: 0 }, fixedAssets: { total: 0 } })
        ).toBeNull();
    });

    test('returns null for missing data', () => {
        expect(getSharePercent(null)).toBeNull();
        expect(getSharePercent({})).toBeNull();
    });
});
