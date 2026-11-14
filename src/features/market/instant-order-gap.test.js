// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { settings, runtime } = vi.hoisted(() => ({
    settings: { market_instantOrderGap: true },
    runtime: { state: null },
}));
vi.mock('../../core/config.js', () => ({
    default: { COLOR_WARNING: '#ffa500', getSetting: (key) => settings[key] },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/i18n.js', () => ({
    default: { getLocale: () => 'en-US' },
    t: (key, p) => `${key}:${p.steps}:${p.each}:${p.total}:${p.quantity}`,
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({
    getMarketplaceRuntimeComponentFromElement: () => (runtime.state ? { state: runtime.state } : null),
}));

const {
    default: instantOrderGap,
    binGap,
    nextPrice,
    countPriceSteps,
    parseQuantity,
    measureGap,
} = await import('./instant-order-gap.js');

describe('binGap', () => {
    test('follows the game price bins', () => {
        expect(binGap(50, 0)).toBe(1);
        expect(binGap(250, 0)).toBe(1);
        expect(binGap(500, 0)).toBe(2);
        expect(binGap(900, 0)).toBe(4);
        expect(binGap(1000, 0)).toBe(4);
        expect(binGap(1200, 0)).toBe(5);
        expect(binGap(9500, 0)).toBe(40);
        expect(binGap(50000, 0)).toBe(200);
    });

    test('enhanced items step five times wider, and three-digit prices use their own table', () => {
        expect(binGap(50000, 3)).toBe(1000);
        expect(binGap(150, 3)).toBe(2);
        expect(binGap(250, 3)).toBe(5);
        expect(binGap(500, 3)).toBe(10);
        expect(binGap(900, 3)).toBe(20);
    });
});

describe('counting steps', () => {
    test('the next price is what one click of the game + button gives', () => {
        expect(nextPrice(100, 0)).toBe(101);
        expect(nextPrice(1000, 0)).toBe(1004);
        expect(nextPrice(1001, 0)).toBe(1004);
    });

    test('adjacent prices are one step, further apart is more', () => {
        expect(countPriceSteps(1000, 1004)).toBe(1);
        expect(countPriceSteps(1000, 1012)).toBe(3);
        expect(countPriceSteps(1000, 1000)).toBe(0);
    });

    test('a huge gap stops counting at the cap', () => {
        expect(countPriceSteps(1, 1e9)).toBe(999);
    });
});

describe('parseQuantity', () => {
    test('plain and compact values, nothing for the rest', () => {
        expect(parseQuantity('25')).toBe(25);
        expect(parseQuantity('1,200')).toBe(1200);
        expect(parseQuantity('5k')).toBe(5000);
        expect(parseQuantity('1.5M')).toBe(1500000);
        expect(parseQuantity('')).toBe(0);
        expect(parseQuantity('abc')).toBe(0);
    });
});

describe('measureGap', () => {
    test('best ask against best bid, null when a side is empty or they cross', () => {
        expect(measureGap({ asks: [{ price: 1012 }], bids: [{ price: 1000 }] }, 0)).toEqual({
            ask: 1012,
            bid: 1000,
            steps: 3,
        });
        expect(measureGap({ asks: [], bids: [{ price: 1000 }] }, 0)).toBeNull();
        expect(measureGap({ asks: [{ price: 900 }], bids: [{ price: 1000 }] }, 0)).toBeNull();
    });
});

describe('InstantOrderGap', () => {
    const books = (ask, bid) => ({
        itemHrid: '/items/x',
        orderBooks: { 0: { asks: [{ price: ask }], bids: [{ price: bid }] } },
    });
    const open = () => {
        document.body.innerHTML = `<div class="modal"><div class="MarketplacePanel_header__x">Sell Now</div>
            <div><div><div><input class="MarketplacePanel_quantityInputs__x" /></div></div></div></div>`;
        const modal = document.querySelector('.modal');
        // The quantity input must sit inside an element whose class marks the quantity row
        modal.querySelector('input').parentElement.className = 'MarketplacePanel_quantityInputs__x';
        return modal;
    };

    beforeEach(() => {
        settings.market_instantOrderGap = true;
        runtime.state = {
            isInstantOrder: true,
            isSell: true,
            itemHrid: '/items/x',
            enhancementLevelInput: 0,
            marketItemOrderBooks: books(1012, 1000),
        };
    });
    afterEach(() => {
        instantOrderGap.cleanup();
        document.body.innerHTML = '';
    });

    test('says so when the two best offers are more than one step apart', () => {
        const modal = open();
        instantOrderGap.show(modal);
        const line = modal.querySelector('.mwi-instant-order-gap');
        expect(line.textContent).toContain('instantOrderGap.sell:3:12');
    });

    test('the buy side gets its own wording', () => {
        runtime.state.isSell = false;
        const modal = open();
        instantOrderGap.show(modal);
        expect(modal.querySelector('.mwi-instant-order-gap').textContent).toContain('instantOrderGap.buy');
    });

    test('adds the total for the quantity typed, and follows it', () => {
        const modal = open();
        instantOrderGap.show(modal);
        const input = modal.querySelector('input');
        input.value = '10';
        input.dispatchEvent(new Event('input'));
        expect(modal.querySelector('.mwi-instant-order-gap').textContent).toContain(
            'instantOrderGap.totalSuffix:3:12:120:10'
        );
    });

    test("stays silent for adjacent prices, a limit order, or another item's book", () => {
        runtime.state.marketItemOrderBooks = books(1004, 1000);
        let modal = open();
        instantOrderGap.show(modal);
        expect(modal.querySelector('.mwi-instant-order-gap')).toBeNull();

        runtime.state.marketItemOrderBooks = books(1012, 1000);
        runtime.state.isInstantOrder = false;
        modal = open();
        instantOrderGap.show(modal);
        expect(modal.querySelector('.mwi-instant-order-gap')).toBeNull();

        runtime.state.isInstantOrder = true;
        runtime.state.itemHrid = '/items/other';
        modal = open();
        instantOrderGap.show(modal);
        expect(modal.querySelector('.mwi-instant-order-gap')).toBeNull();
    });

    test('shows nothing when the live state cannot be read', () => {
        runtime.state = null;
        const modal = open();
        instantOrderGap.show(modal);
        expect(modal.querySelector('.mwi-instant-order-gap')).toBeNull();
    });
});
