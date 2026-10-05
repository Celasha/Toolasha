// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPrices: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        COLOR_INVBADGE_ASK: '#51cf66',
        COLOR_INVBADGE_BID: '#ff6b6b',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn(() => () => {}),
    },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrices: (...args) => mocks.getItemPrices(...args),
}));

import labyrinthShopPrices from './labyrinth-shop-prices.js';

function shopItemEl(itemHrid) {
    const itemEl = document.createElement('div');
    itemEl.className = 'LabyrinthPanel_item_abc';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${itemHrid.replace('/items/', '')}`);
    svg.appendChild(use);
    itemEl.appendChild(svg);
    return itemEl;
}

function buyableGridDom(itemEls) {
    const grid = document.createElement('div');
    grid.className = 'LabyrinthPanel_buyableGrid_abc';
    itemEls.forEach((el) => grid.appendChild(el));
    document.body.appendChild(grid);
    return grid;
}

describe('LabyrinthShopPrices - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: false, bidOutlier: false });
    });

    test('flags the ask price with a bare warning suffix when it was substituted by the outlier guard', () => {
        const itemEl = shopItemEl('/items/gold_ore');
        buyableGridDom([itemEl]);
        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: true, bidOutlier: false });

        labyrinthShopPrices.refreshAll();

        const askSpan = itemEl.querySelector('.mwi-lsp-ask');
        const bidSpan = itemEl.querySelector('.mwi-lsp-bid');
        expect(askSpan.textContent).toContain('⚠');
        expect(bidSpan.textContent).not.toContain('⚠');
        // Bare text, never HTML markup, in a textContent-only context.
        expect(askSpan.innerHTML).not.toContain('<span');
    });

    test('flags the bid price independently of the ask price', () => {
        const itemEl = shopItemEl('/items/gold_ore');
        buyableGridDom([itemEl]);
        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: false, bidOutlier: true });

        labyrinthShopPrices.refreshAll();

        expect(itemEl.querySelector('.mwi-lsp-ask').textContent).not.toContain('⚠');
        expect(itemEl.querySelector('.mwi-lsp-bid').textContent).toContain('⚠');
    });

    test('does not flag either price when neither was substituted', () => {
        const itemEl = shopItemEl('/items/gold_ore');
        buyableGridDom([itemEl]);

        labyrinthShopPrices.refreshAll();

        expect(itemEl.querySelector('.mwi-lsp-ask').textContent).not.toContain('⚠');
        expect(itemEl.querySelector('.mwi-lsp-bid').textContent).not.toContain('⚠');
    });

    test('updating an already-injected price element refreshes the outlier flag too', () => {
        const itemEl = shopItemEl('/items/gold_ore');
        buyableGridDom([itemEl]);
        labyrinthShopPrices.refreshAll();
        expect(itemEl.querySelector('.mwi-lsp-ask').textContent).not.toContain('⚠');

        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: true, bidOutlier: false });
        labyrinthShopPrices.refreshAll();

        expect(itemEl.querySelector('.mwi-lsp-ask').textContent).toContain('⚠');
        // Still exactly one injected price element, not a duplicate.
        expect(itemEl.querySelectorAll('.mwi-labyrinth-shop-price').length).toBe(1);
    });
});
