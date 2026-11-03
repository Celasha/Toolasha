/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    entries: [],
    prices: {},
    capeBase: 0,
    containers: {},
    getSetting: vi.fn(() => true),
    onClass: vi.fn(() => () => {}),
}));

vi.mock('../../core/config.js', () => ({ default: { getSetting: mocks.getSetting } }));
vi.mock('../../core/i18n.js', () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: mocks.onClass } }));
vi.mock('../../utils/formatters.js', () => ({ formatKMB: (v) => String(Math.round(v)) }));
vi.mock('../../utils/special-currency-shop.js', () => ({
    getAllSpecialCurrencyShopEntries: () => mocks.entries,
}));
vi.mock('../../utils/market-data.js', () => ({
    getItemPriceOutlierInfo: (hrid) => mocks.prices[hrid] || { value: 0, isOutlier: false },
}));
vi.mock('../../utils/token-valuation.js', () => ({
    DUNGEON_TOKEN_HRIDS: new Set(['/items/chimerical_token']),
    resolvePricingSide: () => 'bid',
}));
vi.mock('../market/expected-value-calculator.js', () => ({
    default: {
        getCachedValue: (hrid) => mocks.containers[hrid] ?? null,
        calculateExpectedValue: () => null,
    },
}));
vi.mock('../../utils/untradable-cape.js', () => ({
    isUntradableCape: (hrid) => hrid.endsWith('_cape') || hrid.endsWith('_quiver'),
    getCapeBaseValue: () => mocks.capeBase,
}));

import { ShopTokenValues } from './shop-token-values.js';
import { getBestEntryByCurrency, getShopRowValue } from './shop-token-values-logic.js';

const entry = (itemHrid, currencyHrid, tokenCost, outputCount = 1) => ({
    itemHrid,
    currencyHrid,
    tokenCost,
    outputCount,
    isOpenable: false,
});

function dungeonTile(slug, costText) {
    return `<div class="ShopPanel_shopItem__x"><div class="ShopPanel_name__x">${slug}</div>
        <div class="ShopPanel_itemContainer__x"><svg><use href="/static/items.svg#${slug}"></use></svg></div>
        <div class="ShopPanel_costs__x"><div><div>${costText}</div></div></div></div>`;
}

describe('getShopRowValue', () => {
    beforeEach(() => {
        mocks.prices = {};
        mocks.capeBase = 0;
    });

    test('divides market price × outputCount by token cost', () => {
        mocks.prices['/items/cheese'] = { value: 1000, isOutlier: false };
        expect(getShopRowValue(entry('/items/cheese', '/items/chimerical_token', 10, 2))).toMatchObject({
            perToken: 200,
            isAssumed: false,
        });
    });

    test('returns null for an unpriced, non-cape item', () => {
        expect(getShopRowValue(entry('/items/seal_of_damage', '/items/labyrinth_token', 30))).toBeNull();
    });

    test('capes use the base value setting and are flagged assumed', () => {
        mocks.capeBase = 9_500_000;
        expect(getShopRowValue(entry('/items/chance_cape', '/items/labyrinth_token', 10000))).toMatchObject({
            perToken: 950,
            isAssumed: true,
            assumedValue: 9_500_000,
        });
        mocks.capeBase = 0;
        expect(getShopRowValue(entry('/items/chimerical_quiver', '/items/chimerical_token', 35000))).toMatchObject({
            perToken: 0,
            isAssumed: true,
        });
    });
});

describe('openable containers with no market price', () => {
    beforeEach(() => {
        mocks.prices = {};
        mocks.containers = {};
    });

    const chest = (itemHrid, tokenCost) => ({ ...entry(itemHrid, '/items/task_token', tokenCost), isOpenable: true });

    test('are worth the expected value of opening them', () => {
        mocks.containers['/items/large_treasure_chest'] = 30_000;
        expect(getShopRowValue(chest('/items/large_treasure_chest', 30))).toMatchObject({
            perToken: 1000,
            isAssumed: false,
            isContainer: true,
        });
    });

    test('a market price wins over the expected value', () => {
        mocks.prices['/items/large_treasure_chest'] = { value: 60_000, isOutlier: false };
        mocks.containers['/items/large_treasure_chest'] = 30_000;
        expect(getShopRowValue(chest('/items/large_treasure_chest', 30))).toMatchObject({ perToken: 2000 });
    });

    test('stay null with no expected value, and a non-openable item never uses one', () => {
        expect(getShopRowValue(chest('/items/large_treasure_chest', 30))).toBeNull();
        mocks.containers['/items/task_crystal'] = 5000;
        expect(getShopRowValue(entry('/items/task_crystal', '/items/task_token', 50))).toBeNull();
    });

    test('can be the best entry for the currency', () => {
        mocks.containers = { '/items/a': 30_000, '/items/b': 90_000 };
        mocks.entries = [chest('/items/a', 30), chest('/items/b', 30)];
        expect(getBestEntryByCurrency().get('/items/task_token')).toBe('/items/b');
    });
});

describe('getBestEntryByCurrency', () => {
    test('picks the best real entry per currency and never an assumed cape', () => {
        mocks.capeBase = 9_500_000;
        mocks.prices = { '/items/a': { value: 100 }, '/items/b': { value: 900 } };
        mocks.entries = [
            entry('/items/a', '/items/labyrinth_token', 10),
            entry('/items/b', '/items/labyrinth_token', 30),
            entry('/items/chance_cape', '/items/labyrinth_token', 10000),
        ];
        expect(getBestEntryByCurrency().get('/items/labyrinth_token')).toBe('/items/b');
    });
});

describe('ShopTokenValues rendering', () => {
    let feature;

    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.capeBase = 0;
        mocks.prices = { '/items/chimerical_essence': { value: 500, isOutlier: false } };
        mocks.entries = [
            entry('/items/chimerical_essence', '/items/chimerical_token', 1),
            entry('/items/chimerical_quiver', '/items/chimerical_token', 35000),
        ];
        feature = new ShopTokenValues();
    });

    afterEach(() => feature.disable());

    test('renders value, best marker and assumed marker on Dungeon shop tiles; skips coin tiles', () => {
        document.body.innerHTML = `<div class="ShopPanel_shopItems__x">
            ${dungeonTile('chimerical_essence', '1 Chimerical Token')}
            ${dungeonTile('chimerical_quiver', '35,000 Chimerical Token')}
            ${dungeonTile('chimerical_quiver', '100,000 Coin')}
        </div>`;
        feature.refreshAll();
        const rendered = [...document.querySelectorAll('.mwi-shop-token-value')];
        expect(rendered).toHaveLength(2);
        expect(rendered[0].textContent).toContain('★');
        expect(rendered[0].textContent).toContain('"value":"500"');
        expect(rendered[1].textContent).toContain('—');
        expect(rendered[1].textContent.endsWith('*')).toBe(true);
        expect(rendered[1].title).toContain('assumedTooltip');
    });

    test('renders on Task shop tiles, marks the best one, and leaves upgrade tiles bare', () => {
        mocks.prices = { '/items/a': { value: 100 }, '/items/b': { value: 900 } };
        mocks.entries = [entry('/items/a', '/items/task_token', 10), entry('/items/b', '/items/task_token', 30)];
        const tile = (slug) =>
            `<div class="TasksPanel_item__x"><svg><use href="/static/items.svg#${slug}"></use></svg></div>`;
        document.body.innerHTML = `<div class="TasksPanel_buyableGrid__x">${tile('a')}${tile('b')}${tile('cooldown')}</div>`;

        feature.refreshAll();

        const rendered = [...document.querySelectorAll('.mwi-shop-token-value')];
        expect(rendered).toHaveLength(2);
        expect(rendered[0].textContent).toContain('"value":"10"');
        expect(rendered[0].textContent).not.toContain('★');
        expect(rendered[1].textContent).toContain('★');
        expect(rendered[1].textContent).toContain('"value":"30"');
    });

    test('is idempotent', () => {
        document.body.innerHTML = `<div class="ShopPanel_shopItems__x">${dungeonTile('chimerical_essence', '1 Chimerical Token')}</div>`;
        feature.refreshAll();
        feature.refreshAll();
        expect(document.querySelectorAll('.mwi-shop-token-value')).toHaveLength(1);
    });

    test('does not register when the setting is off', () => {
        mocks.getSetting.mockReturnValueOnce(false);
        mocks.onClass.mockClear();
        feature.initialize();
        expect(mocks.onClass).not.toHaveBeenCalled();
    });
});
