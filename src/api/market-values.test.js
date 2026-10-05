import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const configMocks = vi.hoisted(() => ({
    outlierGuardEnabled: true,
    outlierBandMultiplier: 3,
}));

vi.mock('../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) =>
            key === 'marketData_outlierGuardEnabled' ? configMocks.outlierGuardEnabled : false
        ),
        getSettingValue: vi.fn((key, fallback) =>
            key === 'marketData_outlierBandMultiplier' ? configMocks.outlierBandMultiplier : fallback
        ),
    },
}));

const createMocks = () => {
    const getJSON = vi.fn();
    const get = vi.fn();
    const setJSON = vi.fn();
    const set = vi.fn();
    vi.doMock('../core/storage.js', () => ({
        default: { getJSON, get, setJSON, set },
    }));

    return { getJSON, get, setJSON, set };
};

describe('MarketValuesAPI fetch', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('returns cached data within CACHE_DURATION without hitting the network', async () => {
        const { get, getJSON } = createMocks();
        get.mockResolvedValue(Date.now());
        getJSON.mockResolvedValue({
            marketValuesVersion: 111,
            marketItemValues: { sinister_cape: [100, 200] },
        });

        const { default: marketValuesAPI } = await import('./market-values.js');
        const result = await marketValuesAPI.fetch();

        expect(result).toEqual({ sinister_cape: [100, 200] });
        expect(fetch).not.toHaveBeenCalled();
    });

    test('fetches fresh data and caches it when there is no valid cache', async () => {
        const { get, getJSON, setJSON, set } = createMocks();
        get.mockResolvedValue(null);
        getJSON.mockResolvedValue(null);
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                marketValuesVersion: 222,
                marketItemValues: { mirror_of_protection: [500] },
            }),
        });

        const { default: marketValuesAPI } = await import('./market-values.js');
        const result = await marketValuesAPI.fetch();

        expect(result).toEqual({ mirror_of_protection: [500] });
        expect(setJSON).toHaveBeenCalledWith(
            'Toolasha_marketValuesAPI_json',
            { marketValuesVersion: 222, marketItemValues: { mirror_of_protection: [500] } },
            'settings'
        );
        expect(set).toHaveBeenCalledWith('Toolasha_marketValuesAPI_timestamp', expect.any(Number), 'settings');
    });

    test('falls back to expired cache when the network fetch fails', async () => {
        const { get, getJSON } = createMocks();
        get.mockResolvedValueOnce(null).mockResolvedValueOnce(Date.now() - 999999999);
        getJSON
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ marketValuesVersion: 333, marketItemValues: { coin: null } });
        fetch.mockRejectedValue(new Error('network down'));

        const { default: marketValuesAPI } = await import('./market-values.js');
        const result = await marketValuesAPI.fetch();

        expect(result).toEqual({ coin: null });
    });

    test('returns null when there is no cache and the network fetch fails', async () => {
        const { get, getJSON } = createMocks();
        get.mockResolvedValue(null);
        getJSON.mockResolvedValue(null);
        fetch.mockRejectedValue(new Error('network down'));

        const { default: marketValuesAPI } = await import('./market-values.js');
        const result = await marketValuesAPI.fetch();

        expect(result).toBeNull();
    });

    test('throws from fetchFromAPI (surfaced as a failed fetch) on a non-ok HTTP response', async () => {
        const { get, getJSON } = createMocks();
        get.mockResolvedValue(null);
        getJSON.mockResolvedValue(null);
        fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });

        const { default: marketValuesAPI } = await import('./market-values.js');
        const result = await marketValuesAPI.fetch();

        expect(result).toBeNull();
    });
});

describe('MarketValuesAPI auto-refresh', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        createMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('re-checks the snapshot on a timer instead of only once at load', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        const fetchSpy = vi.spyOn(marketValuesAPI, 'fetch').mockResolvedValue(null);

        marketValuesAPI.startAutoRefresh();
        expect(fetchSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(marketValuesAPI.CACHE_DURATION);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(marketValuesAPI.CACHE_DURATION);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    test('starting twice does not double the interval', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        const fetchSpy = vi.spyOn(marketValuesAPI, 'fetch').mockResolvedValue(null);

        marketValuesAPI.startAutoRefresh();
        marketValuesAPI.startAutoRefresh();

        await vi.advanceTimersByTimeAsync(marketValuesAPI.CACHE_DURATION);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test('stopAutoRefresh halts further timer-driven fetches', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        const fetchSpy = vi.spyOn(marketValuesAPI, 'fetch').mockResolvedValue(null);

        marketValuesAPI.startAutoRefresh();
        marketValuesAPI.stopAutoRefresh();

        await vi.advanceTimersByTimeAsync(marketValuesAPI.CACHE_DURATION * 2);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('MarketValuesAPI getValue', () => {
    beforeEach(() => {
        vi.resetModules();
        createMocks();
    });

    test('returns null before any fetch has populated the cache', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        expect(marketValuesAPI.getValue('/items/sinister_cape', 0)).toBeNull();
    });

    test('resolves the price at the requested enhancement level, converting the hrid to a bare name', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [100, 200, 300] };

        expect(marketValuesAPI.getValue('/items/sinister_cape', 2)).toBe(300);
    });

    test('returns null for an item not present in the dataset', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [100] };

        expect(marketValuesAPI.getValue('/items/unknown_item', 0)).toBeNull();
    });

    test('returns null for an enhancement level beyond the available array (e.g. non-enhanceable item)', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { abyssal_essence: [183] };

        expect(marketValuesAPI.getValue('/items/abyssal_essence', 5)).toBeNull();
    });

    test('returns null for a null entry (e.g. coin)', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { coin: null };

        expect(marketValuesAPI.getValue('/items/coin', 0)).toBeNull();
    });

    test('returns null for a zero-priced entry', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { worthless_item: [0] };

        expect(marketValuesAPI.getValue('/items/worthless_item', 0)).toBeNull();
    });
});

describe('MarketValuesAPI checkOutlier', () => {
    beforeEach(() => {
        vi.resetModules();
        createMocks();
        configMocks.outlierGuardEnabled = true;
        configMocks.outlierBandMultiplier = 3;
    });

    test('passes the raw value through unchanged when within the band', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [1000] };

        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, 1200)).toEqual({
            value: 1200,
            isOutlier: false,
        });
    });

    test('substitutes the reference value when the price is far above the band', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [1000] };

        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, 1_000_000)).toEqual({
            value: 1000,
            isOutlier: true,
        });
    });

    test('substitutes the reference value when the price is far below the band', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [1000] };

        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, 1)).toEqual({
            value: 1000,
            isOutlier: true,
        });
    });

    test('respects a configured band multiplier', async () => {
        configMocks.outlierBandMultiplier = 10;
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [1000] };

        // 5x the reference - inside a 10x band, outside a 3x band
        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, 5000)).toEqual({
            value: 5000,
            isOutlier: false,
        });
    });

    test('never flags anything when the guard setting is disabled', async () => {
        configMocks.outlierGuardEnabled = false;
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [1000] };

        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, 1_000_000)).toEqual({
            value: 1_000_000,
            isOutlier: false,
        });
    });

    test('never flags anything when there is no reference value for this item', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = {};

        expect(marketValuesAPI.checkOutlier('/items/unknown_item', 0, 1_000_000)).toEqual({
            value: 1_000_000,
            isOutlier: false,
        });
    });

    test('passes through non-positive or non-numeric raw values untouched', async () => {
        const { default: marketValuesAPI } = await import('./market-values.js');
        marketValuesAPI.marketItemValues = { sinister_cape: [1000] };

        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, 0)).toEqual({ value: 0, isOutlier: false });
        expect(marketValuesAPI.checkOutlier('/items/sinister_cape', 0, null)).toEqual({
            value: null,
            isOutlier: false,
        });
    });
});
