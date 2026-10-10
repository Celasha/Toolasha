/* @vitest-environment jsdom */
import { describe, test, expect, vi, afterEach } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));

const { calculateDepthCap, default: marketDepthCap } = await import('./market-depth-cap.js');
const { MARKET_TAX } = await import('../../utils/profit-constants.js');

describe('calculateDepthCap', () => {
    test('sums quantity across bid levels that still clear the cost threshold', () => {
        // threshold = cost / ((1-tax) * qty) = 100 / (0.95 * 2) = ~52.63
        const bids = [
            { price: 100, quantity: 10 },
            { price: 60, quantity: 5 },
            { price: 40, quantity: 20 }, // below threshold, excluded
        ];

        const result = calculateDepthCap({ bids, costPerAction: 100, quantityPerAction: 2, marketTax: 0.05 });

        expect(result.cumulativeQuantity).toBe(15);
        expect(result.nstar).toBe(7); // floor(15 / 2)
        expect(result.hitBookEnd).toBe(false);
    });

    test('stops at the exact listing where price first drops below threshold', () => {
        // threshold = 45 / (0.95 * 1) ~= 47.37
        const bids = [
            { price: 50, quantity: 10 }, // clears threshold, included
            { price: 47, quantity: 100 }, // below threshold, excluded entirely
        ];

        const result = calculateDepthCap({ bids, costPerAction: 45, quantityPerAction: 1, marketTax: 0.05 });

        expect(result.cumulativeQuantity).toBe(10);
        expect(result.hitBookEnd).toBe(false);
    });

    test('flags hitBookEnd when every visible bid still clears cost', () => {
        const bids = [
            { price: 1000, quantity: 3 },
            { price: 900, quantity: 4 },
        ];

        const result = calculateDepthCap({ bids, costPerAction: 10, quantityPerAction: 1, marketTax: 0.05 });

        expect(result.hitBookEnd).toBe(true);
        expect(result.cumulativeQuantity).toBe(7);
    });

    test('returns a zero result when no bid clears the threshold', () => {
        const bids = [{ price: 10, quantity: 100 }];
        const result = calculateDepthCap({ bids, costPerAction: 1000, quantityPerAction: 1, marketTax: 0.05 });

        expect(result.nstar).toBe(0);
        expect(result.cumulativeQuantity).toBe(0);
        expect(result.hitBookEnd).toBe(false);
    });

    test('returns a zero result for missing/invalid inputs', () => {
        expect(calculateDepthCap({ bids: [], costPerAction: 100, quantityPerAction: 1 })).toEqual({
            nstar: 0,
            cumulativeQuantity: 0,
            thresholdPrice: null,
            hitBookEnd: false,
        });
        expect(
            calculateDepthCap({ bids: [{ price: 10, quantity: 1 }], costPerAction: 0, quantityPerAction: 1 })
        ).toEqual({ nstar: 0, cumulativeQuantity: 0, thresholdPrice: null, hitBookEnd: false });
        expect(
            calculateDepthCap({ bids: [{ price: 10, quantity: 1 }], costPerAction: 100, quantityPerAction: 0 })
        ).toEqual({ nstar: 0, cumulativeQuantity: 0, thresholdPrice: null, hitBookEnd: false });
    });

    test('defaults marketTax to the shared MARKET_TAX constant when omitted', () => {
        const bids = [{ price: 100, quantity: 10 }];
        const withDefault = calculateDepthCap({ bids, costPerAction: 100, quantityPerAction: 1 });
        const withExplicit = calculateDepthCap({
            bids,
            costPerAction: 100,
            quantityPerAction: 1,
            marketTax: MARKET_TAX,
        });

        expect(withDefault).toEqual(withExplicit);
    });
});

describe('processOrderBook / riskOfRuinUI resolution', () => {
    afterEach(() => {
        delete window.Toolasha;
        marketDepthCap.orderBooksCache = {};
        marketDepthCap.clearDisplays();
        document.body.innerHTML = '';
    });

    function renderButtonContainer() {
        document.body.innerHTML = `
            <div class="MarketplacePanel_newListingButtonsContainer__1MhKJ"><button>Create listing</button></div>
        `;
        return document.querySelector('.MarketplacePanel_newListingButtonsContainer__1MhKJ');
    }

    // Regression test for the production bug where market-depth-cap.js statically imported
    // risk-of-ruin-ui.js: since risk-of-ruin-ui.js is owned by the ui2.js bundle (loaded after
    // market.js), Rollup bundled a second, independent RiskOfRuinUI instance into the market
    // bundle whose getDepthCapContext() always returned null. The fix resolves it lazily via
    // window.Toolasha.UI at call time instead, so this guards against a static import creeping
    // back in.
    test('resolves riskOfRuinUI lazily via window.Toolasha.UI and renders the sell-depth label', () => {
        const buttonContainer = renderButtonContainer();
        const getDepthCapContext = vi.fn(() => ({
            costPerAction: 100,
            items: [{ itemHrid: '/items/test_item', quantityPerAction: 2 }],
        }));
        window.Toolasha = { UI: { riskOfRuinUI: { getDepthCapContext } } };

        marketDepthCap.orderBooksCache['/items/test_item'] = {
            data: { orderBooks: { 0: { bids: [{ price: 1000, quantity: 10 }] } } },
        };
        marketDepthCap.getCurrentItemHrid = () => '/items/test_item';
        marketDepthCap.getCurrentEnhancementLevel = () => 0;

        marketDepthCap.processOrderBook();

        expect(getDepthCapContext).toHaveBeenCalled();
        expect(buttonContainer.querySelector('.mwi-depth-cap')).not.toBeNull();
    });

    test('no-ops without throwing when riskOfRuinUI is unavailable on window.Toolasha.UI', () => {
        const buttonContainer = renderButtonContainer();
        delete window.Toolasha;

        marketDepthCap.orderBooksCache['/items/test_item'] = {
            data: { orderBooks: { 0: { bids: [{ price: 1000, quantity: 10 }] } } },
        };
        marketDepthCap.getCurrentItemHrid = () => '/items/test_item';
        marketDepthCap.getCurrentEnhancementLevel = () => 0;

        expect(() => marketDepthCap.processOrderBook()).not.toThrow();
        expect(buttonContainer.querySelector('.mwi-depth-cap')).toBeNull();
    });
});
