/* @vitest-environment jsdom */

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_ACCENT: '#22c55e',
        onSettingChange: vi.fn(),
        getSetting: vi.fn((key) => key === 'invSort_showBadges'),
        getSettingValue: vi.fn((key, fallback) => fallback),
    },
}));
vi.mock('../../core/i18n.js', () => ({
    t: vi.fn((key) => (key === 'marketData.outlierPriceWarningTooltip' ? 'outlier-tooltip' : key)),
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../api/marketplace.js', () => ({ default: { on: vi.fn(), off: vi.fn(), isLoaded: vi.fn(() => true) } }));
vi.mock('../../core/storage.js', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../utils/formatters.js', () => ({ formatKMB: (v, decimals) => `K${v}:${decimals}` }));
vi.mock('../../core/data-manager.js', () => ({ default: { on: vi.fn() } }));
vi.mock('./inventory-badge-manager.js', () => ({ default: { registerProvider: vi.fn() } }));

const { default: inventorySort } = await import('./inventory-sort.js');

function buildItemElem({ askValue = 0, priceOutlier = '0' } = {}) {
    const itemElem = document.createElement('div');
    const itemInner = document.createElement('div');
    itemInner.className = 'Item_item';
    itemElem.appendChild(itemInner);
    itemElem.dataset.askValue = String(askValue);
    itemElem.dataset.priceOutlier = priceOutlier;
    return itemElem;
}

describe('InventorySort.renderBadgesForItem outlier warning icons', () => {
    test('appends the warning icon and tooltip to a flagged stack-value badge', () => {
        inventorySort.currentMode = 'ask';
        const itemElem = buildItemElem({ askValue: 5000, priceOutlier: '1' });

        inventorySort.renderBadgesForItem(itemElem);

        const badge = itemElem.querySelector('.mwi-stack-price');
        expect(badge.textContent).toBe('K5000:2 ⚠');
        expect(badge.title).toBe('outlier-tooltip');
    });

    test('does not append the icon to a normal (non-flagged) badge', () => {
        inventorySort.currentMode = 'ask';
        const itemElem = buildItemElem({ askValue: 5000, priceOutlier: '0' });

        inventorySort.renderBadgesForItem(itemElem);

        const badge = itemElem.querySelector('.mwi-stack-price');
        expect(badge.textContent).toBe('K5000:2');
        expect(badge.title).toBe('');
    });

    test('updates an existing badge in place (precision 0 path) when re-rendered with the flag now set', () => {
        inventorySort.currentMode = 'ask';
        const itemElem = buildItemElem({ askValue: 5000, priceOutlier: '0' });
        inventorySort.renderBadgesForItem(itemElem);

        itemElem.dataset.priceOutlier = '1';
        inventorySort.renderBadgesForItem(itemElem);

        const badge = itemElem.querySelector('.mwi-stack-price');
        expect(badge.textContent).toBe('K5000:0 ⚠');
        expect(badge.title).toBe('outlier-tooltip');
        expect(itemElem.querySelectorAll('.mwi-stack-price').length).toBe(1);
    });
});
