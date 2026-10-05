/* @vitest-environment jsdom */

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_INVBADGE_ASK: '#60a5fa',
        COLOR_INVBADGE_BID: '#f87171',
        onSettingChange: vi.fn(),
        getSetting: vi.fn(() => false),
    },
}));
vi.mock('../../core/i18n.js', () => ({
    t: vi.fn((key) => (key === 'marketData.outlierPriceWarningTooltip' ? 'outlier-tooltip' : key)),
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../api/marketplace.js', () => ({ default: { on: vi.fn(), isLoaded: vi.fn(() => true) } }));
vi.mock('../../utils/formatters.js', () => ({ formatKMB: (v) => `K${v}` }));
vi.mock('../../core/data-manager.js', () => ({ default: { on: vi.fn() } }));
vi.mock('./inventory-badge-manager.js', () => ({ default: { registerProvider: vi.fn(), renderAllBadges: vi.fn() } }));
vi.mock('./inventory-sort.js', () => ({ default: { isInitialized: false } }));

const { default: inventoryBadgePrices } = await import('./inventory-badge-prices.js');

function buildItemElem({ askPrice = 0, bidPrice = 0, priceOutlier = '0' } = {}) {
    const itemElem = document.createElement('div');
    const itemInner = document.createElement('div');
    itemInner.className = 'Item_item';
    itemElem.appendChild(itemInner);
    itemElem.dataset.askPrice = String(askPrice);
    itemElem.dataset.bidPrice = String(bidPrice);
    itemElem.dataset.priceOutlier = priceOutlier;
    return itemElem;
}

describe('InventoryBadgePrices.renderBadgesForItem outlier warning icons', () => {
    test('appends the warning icon and tooltip to a flagged ask badge', () => {
        const itemElem = buildItemElem({ askPrice: 1000, priceOutlier: '1' });
        inventoryBadgePrices.renderBadgesForItem(itemElem);

        const askBadge = itemElem.querySelector('.mwi-badge-price-ask');
        expect(askBadge.textContent).toBe('K1000 ⚠');
        expect(askBadge.title).toBe('outlier-tooltip');
    });

    test('does not append the icon to a normal (non-flagged) badge', () => {
        const itemElem = buildItemElem({ askPrice: 1000, priceOutlier: '0' });
        inventoryBadgePrices.renderBadgesForItem(itemElem);

        const askBadge = itemElem.querySelector('.mwi-badge-price-ask');
        expect(askBadge.textContent).toBe('K1000');
        expect(askBadge.title).toBe('');
    });

    test('updates an existing badge in place when re-rendered with the flag now set', () => {
        const itemElem = buildItemElem({ askPrice: 1000, priceOutlier: '0' });
        inventoryBadgePrices.renderBadgesForItem(itemElem);

        itemElem.dataset.priceOutlier = '1';
        inventoryBadgePrices.renderBadgesForItem(itemElem);

        const askBadge = itemElem.querySelector('.mwi-badge-price-ask');
        expect(askBadge.textContent).toBe('K1000 ⚠');
        expect(askBadge.title).toBe('outlier-tooltip');
        expect(itemElem.querySelectorAll('.mwi-badge-price-ask').length).toBe(1);
    });

    test('flags bid independently of ask', () => {
        const itemElem = buildItemElem({ askPrice: 1000, bidPrice: 900, priceOutlier: '1' });
        inventoryBadgePrices.renderBadgesForItem(itemElem);

        const bidBadge = itemElem.querySelector('.mwi-badge-price-bid');
        expect(bidBadge.textContent).toBe('K900 ⚠');
    });
});
