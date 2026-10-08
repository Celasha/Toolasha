import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: vi.fn((namespace, key, fallback) => {
        // Real strings pulled from the game client bundle (zh-Hans locale chunk).
        const zh = {
            priceBestBuyOffer: '价格 (最佳购买报价: <bestPrice />)',
            priceBestSellOffer: '价格 (最佳出售报价: <bestPrice />)',
        };
        return zh[key] ?? fallback;
    }),
}));

const { bestOfferPrefix } = await import('./auto-fill-price.js');

describe('auto-fill-price bestOfferPrefix', () => {
    it('derives the English prefix with the placeholder stripped', () => {
        expect(bestOfferPrefix('priceBestBuyOfferEnglishOnly', 'Price (Best Buy Offer: <bestPrice/>)')).toBe(
            'price (best buy offer:'
        );
    });

    it('derives the real Chinese prefix with the placeholder stripped', () => {
        expect(bestOfferPrefix('priceBestBuyOffer', 'Price (Best Buy Offer: <bestPrice/>)')).toBe(
            '价格 (最佳购买报价:'
        );
        expect(bestOfferPrefix('priceBestSellOffer', 'Price (Best Sell Offer: <bestPrice/>)')).toBe(
            '价格 (最佳出售报价:'
        );
    });

    it('a Chinese-rendered label text matches the derived Chinese prefix', () => {
        const labelText = '价格 (最佳购买报价: 1234)'.toLowerCase();
        const prefix = bestOfferPrefix('priceBestBuyOffer', 'Price (Best Buy Offer: <bestPrice/>)');
        expect(labelText.includes(prefix)).toBe(true);
    });
});
