import { beforeEach, describe, expect, test, vi } from 'vitest';

const itemDetails = {};
const settings = {};
const marketPrices = {};

vi.mock('../core/data-manager.js', () => ({ default: { getItemDetails: (hrid) => itemDetails[hrid] ?? null } }));
vi.mock('../core/config.js', () => ({
    default: { getSettingValue: (key, def) => (key in settings ? settings[key] : def) },
}));
vi.mock('./market-data.js', () => ({
    getItemPrice: vi.fn((hrid, options) => marketPrices[`${hrid}:${options.side}`] ?? null),
}));

const { getItemPrice } = await import('./market-data.js');
const { isUntradableCape, isRefinedCape, getCapeBaseValue, getCapeBaseValueMode } =
    await import('./untradable-cape.js');

describe('untradable cape detection', () => {
    beforeEach(() => {
        for (const key of Object.keys(itemDetails)) delete itemDetails[key];
        itemDetails['/items/chance_cape'] = { isTradable: null };
        itemDetails['/items/chance_cape_refined'] = {};
        itemDetails['/items/tradable_cape'] = { isTradable: true };
        itemDetails['/items/cheese'] = {};
    });

    test('recognises base and refined capes that cannot be traded', () => {
        expect(isUntradableCape('/items/chance_cape')).toBe(true);
        expect(isUntradableCape('/items/chance_cape_refined')).toBe(true);
    });

    test('a cape that is tradable, or any other item, is not an untradable cape', () => {
        expect(isUntradableCape('/items/tradable_cape')).toBe(false);
        expect(isUntradableCape('/items/cheese')).toBe(false);
        expect(isUntradableCape(undefined)).toBe(false);
    });

    test('tells refined capes apart from base capes', () => {
        expect(isRefinedCape('/items/sinister_cape_refined')).toBe(true);
        expect(isRefinedCape('/items/sinister_cape')).toBe(false);
    });
});

describe('cape base value setting', () => {
    beforeEach(() => {
        for (const key of Object.keys(settings)) delete settings[key];
        for (const key of Object.keys(marketPrices)) delete marketPrices[key];
        marketPrices['/items/mirror_of_protection:buy'] = 9500000;
        marketPrices['/items/mirror_of_protection:sell'] = 9400000;
        vi.mocked(getItemPrice).mockClear();
    });

    test('defaults to nothing, without looking up any price', () => {
        expect(getCapeBaseValue()).toBe(0);
        expect(getCapeBaseValueMode()).toBe('zero');
        expect(getItemPrice).not.toHaveBeenCalled();
    });

    test('mirror mode copies the Mirror of Protection price for the requested side', () => {
        settings.untradableCapeBaseValue = 'mirror';

        expect(getCapeBaseValue()).toBe(9500000);
        expect(getCapeBaseValue('sell')).toBe(9400000);
        expect(getCapeBaseValueMode()).toBe('mirror');
    });

    test('mirror mode with no Mirror price available is worth nothing', () => {
        settings.untradableCapeBaseValue = 'mirror';
        delete marketPrices['/items/mirror_of_protection:buy'];

        expect(getCapeBaseValue()).toBe(0);
    });

    test('an unrecognised setting value is treated as the default', () => {
        settings.untradableCapeBaseValue = 'banana';

        expect(getCapeBaseValue()).toBe(0);
        expect(getCapeBaseValueMode()).toBe('zero');
    });
});
