/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const settings = { market_brynlessMode: false };

vi.mock('../../core/config.js', () => ({ default: { getSetting: (key) => settings[key] } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        getMarketListings: () => [
            { isSell: false, status: '/market_listing_status/active', coinsAvailable: 1000 },
            {
                isSell: true,
                status: '/market_listing_status/active',
                orderQuantity: 10,
                filledQuantity: 0,
                price: 100,
                itemHrid: '/items/apple',
            },
        ],
    },
}));

import { MarketOrderTotals } from './market-order-totals.js';

function render() {
    document.body.innerHTML = '<div class="Header_totalLevel__x">Total Level: 1</div>';
    const feature = new MarketOrderTotals();
    feature.injectDisplay(document.querySelector('.Header_totalLevel__x'));
    return feature.displayElement;
}

describe('market order totals - Brynless Mode', () => {
    beforeEach(() => {
        settings.market_brynlessMode = false;
    });

    test('shows the cart, tag and unclaimed icons by default', () => {
        const el = render();
        expect(el.textContent).toContain('🛒');
        expect(el.textContent).toContain('🏷');
        expect(el.textContent).toContain('💰');
    });

    test('Brynless Mode removes only the BO and SO icons and keeps labels, numbers and the unclaimed icon', () => {
        settings.market_brynlessMode = true;
        const el = render();
        expect(el.textContent).not.toContain('🛒');
        expect(el.textContent).not.toContain('🏷');
        expect(el.textContent).toContain('marketOrderTotals.buyOrdersLabel');
        expect(el.textContent).toContain('marketOrderTotals.sellOrdersLabel');
        expect(el.textContent).toMatch(/1(\.0)?K/);
        expect(el.textContent).toContain('💰');
    });
});
