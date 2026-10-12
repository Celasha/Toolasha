/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi, afterEach } from 'vitest';

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

function makeNetworthData() {
    return {
        totalNetworth: 2066,
        coins: 148,
        currentAssets: {
            total: 1320,
            equipped: { value: 943, breakdown: [{ name: 'Cape', value: 310, isOutlier: true }] },
            inventory: {
                value: 372,
                byCategory: {
                    Gems: {
                        totalValue: 130,
                        items: [{ name: 'Ruby', count: 55, value: 130, isOutlier: false, itemHrid: '/items/ruby' }],
                    },
                },
                breakdown: [{ itemHrid: '/items/coin', name: 'Coin', count: 1, value: 148 }],
            },
            listings: { value: 5, breakdown: [{ name: 'Gem', isSell: true, value: 3, isOutlier: false }] },
        },
        fixedAssets: {
            total: 746,
            houses: { totalCost: 231, breakdown: [{ name: 'Library', level: 7, cost: 371, isOutlier: false }] },
            abilities: {
                totalCost: 400,
                equippedCost: 296,
                equippedBreakdown: [{ name: 'Frost', cost: 781, isOutlier: false }],
                otherBreakdown: [{ name: 'Fireball', cost: 298, isOutlier: false }],
            },
            abilityBooks: { totalCost: 10, breakdown: [{ name: 'Book', count: 12, value: 10 }] },
            guildShrines: { totalCost: 115, breakdown: [{ name: 'Scholar', level: 5, cost: 451, isOutlier: false }] },
        },
        excluded: { total: 855, items: [{ type: 'item', name: 'Goblet', value: 'x"1', amount: 120 }] },
    };
}

describe('update() panel structure', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="mwi-nw-test-host"></div>';
        networthInventoryDisplay.container = document.getElementById('mwi-nw-test-host');
    });

    afterEach(() => {
        networthInventoryDisplay.container = null;
        document.body.innerHTML = '';
    });

    test('renders icon row (🎁 anchor), share bar, flat sections and node details', () => {
        networthInventoryDisplay.update(makeNetworthData());
        const c = networthInventoryDisplay.container;
        expect(c.querySelector('.mwi-networth-icon-row')).toBeTruthy();
        expect(c.querySelector('.mwi-nw-sharebar')).toBeTruthy();
        expect(c.querySelector('#mwi-nw-equipment')).toBeTruthy();
        expect(c.querySelector('#mwi-nw-inventory')).toBeTruthy();
        expect(c.querySelector('#mwi-nw-listings')).toBeTruthy();
        expect(c.querySelector('#mwi-nw-houses')).toBeTruthy();
        expect(c.querySelector('#mwi-nw-abilities')).toBeTruthy();
        expect(c.querySelectorAll('.mwi-nw-section').length).toBe(3);
        expect(c.querySelector('.mwi-excluded-remove')).toBeTruthy();
    });

    test('open state of details nodes survives an update', () => {
        networthInventoryDisplay.update(makeNetworthData());
        networthInventoryDisplay.container.querySelector('#mwi-nw-inventory').open = true;
        networthInventoryDisplay.update(makeNetworthData());
        expect(networthInventoryDisplay.container.querySelector('#mwi-nw-inventory').open).toBe(true);
    });

    test('top-level group nodes render collapsed by default', () => {
        networthInventoryDisplay.update(makeNetworthData());
        const c = networthInventoryDisplay.container;
        for (const id of [
            'mwi-nw-equipment',
            'mwi-nw-inventory',
            'mwi-nw-listings',
            'mwi-nw-houses',
            'mwi-nw-abilities',
            'mwi-nw-ability-books',
            'mwi-nw-shrines',
        ]) {
            expect(c.querySelector(`#${id}`)?.open).toBe(false);
        }
    });

    test('panel detail area starts collapsed on first render and keeps toggle state afterwards', () => {
        networthInventoryDisplay.update(makeNetworthData());
        const c = networthInventoryDisplay.container;
        const rootDetails = c.querySelector('#mwi-networth-details');
        expect(rootDetails.style.display).toBe('none');

        // User expands the panel via header toggle, then a data refresh re-renders
        rootDetails.style.display = 'block';
        networthInventoryDisplay.update(makeNetworthData());
        expect(c.querySelector('#mwi-networth-details').style.display).toBe('');
    });

    test('omits the share bar when one side is zero', () => {
        const data = makeNetworthData();
        data.fixedAssets.total = 0;
        data.fixedAssets.houses.totalCost = 0;
        data.fixedAssets.abilities.totalCost = 0;
        data.fixedAssets.abilityBooks.totalCost = 0;
        data.fixedAssets.guildShrines.totalCost = 0;
        networthInventoryDisplay.update(data);
        expect(networthInventoryDisplay.container.querySelector('.mwi-nw-sharebar')).toBeNull();
    });
});
