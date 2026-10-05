/* @vitest-environment jsdom */

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { COLOR_WARNING: '#ffa500', COLOR_ACCENT: '#22c55e' },
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
vi.mock('../../utils/dungeon-key-cost.js', () => ({ getKeyPrice: vi.fn(() => 0) }));
vi.mock('./networth-exclusion-popup.js', () => ({ default: {} }));
vi.mock('./networth-exclusions.js', () => ({ removeExclusion: vi.fn() }));

import { networthInventoryDisplay } from './networth-display.js';

describe('NetworthInventoryDisplay outlier warning icons', () => {
    test('renderEquipmentBreakdown appends the icon for a flagged item, not for a normal one', () => {
        const html = networthInventoryDisplay.renderEquipmentBreakdown([
            { name: 'Sinister Cape', value: 1000, isOutlier: true },
            { name: 'Normal Sword', value: 500, isOutlier: false },
        ]);

        expect(html).toContain('Sinister Cape: N1000 <span style="color: #ffa500;" title="outlier-tooltip">⚠</span>');
        expect(html).toContain('Normal Sword: N500');
        expect(html).not.toContain('Normal Sword: N500 <span');
    });

    test('renderListingsBreakdown appends the icon only for the flagged listing', () => {
        const html = networthInventoryDisplay.renderListingsBreakdown([
            { name: 'Rare Gem', value: 2000, isSell: true, isOutlier: true },
            { name: 'Common Ore', value: 100, isSell: false, isOutlier: false },
        ]);

        expect(html).toContain('Rare Gem (Sell): N2000 <span style="color: #ffa500;" title="outlier-tooltip">⚠</span>');
        expect(html).toContain('Common Ore (Buy): N100');
        expect(html).not.toContain('Common Ore (Buy): N100 <span');
    });

    test('renderInventoryBreakdown appends the icon on a flagged item row inside a category', () => {
        const html = networthInventoryDisplay.renderInventoryBreakdown({
            byCategory: {
                Gems: {
                    totalValue: 1000,
                    items: [{ name: 'Flagged Gem', count: 2, value: 1000, isOutlier: true, itemHrid: '/items/gem' }],
                },
            },
            breakdown: [],
        });

        expect(html).toContain('Flagged Gem xK2: N1000 <span style="color: #ffa500;" title="outlier-tooltip">⚠</span>');
    });

    test('renderOpenableItemRow appends the icon for a flagged openable item', () => {
        const html = networthInventoryDisplay.renderOpenableItemRow({
            name: 'Mystery Chest',
            count: 1,
            value: 5000,
            isOutlier: true,
            itemHrid: '/items/mystery_chest',
        });

        expect(html).toContain(
            'Mystery Chest xK1: N5000 <span style="color: #ffa500;" title="outlier-tooltip">⚠</span>'
        );
    });

    test('no icon markup appears anywhere when nothing is flagged', () => {
        const html = networthInventoryDisplay.renderEquipmentBreakdown([
            { name: 'Plain Item', value: 10, isOutlier: false },
        ]);
        expect(html).not.toContain('⚠');
    });
});
