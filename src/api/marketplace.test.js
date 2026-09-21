import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const createMocks = (isConnected) => {
    vi.doMock('../core/connection-state.js', () => ({
        default: {
            isConnected: vi.fn(() => isConnected),
        },
    }));

    const getJSON = vi.fn();
    vi.doMock('../core/storage.js', () => ({
        default: {
            getJSON,
            setJSON: vi.fn(),
        },
    }));

    vi.doMock('../features/market/network-alert.js', () => ({
        default: {
            hide: vi.fn(),
            show: vi.fn(),
        },
    }));

    return { getJSON };
};

describe('MarketAPI fetch', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('returns cached data when disconnected', async () => {
        // Arrange
        const cachedPayload = {
            marketData: { items: [] },
            timestamp: 123,
        };
        const { getJSON } = createMocks(false);
        getJSON.mockResolvedValue(cachedPayload);

        const { default: marketAPI } = await import('./marketplace.js');

        // Act
        const result = await marketAPI.fetch(true);

        // Assert
        expect(result).toEqual(cachedPayload.marketData);
        expect(getJSON).toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    test('returns null when disconnected without cache', async () => {
        // Arrange
        const { getJSON } = createMocks(false);
        getJSON.mockResolvedValue(null);

        const { default: marketAPI } = await import('./marketplace.js');

        // Act
        const result = await marketAPI.fetch(true);

        // Assert
        expect(result).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('MarketAPI auto-refresh', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        createMocks(false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('re-checks the snapshot on a timer instead of only once at load', async () => {
        const { default: marketAPI } = await import('./marketplace.js');
        const fetchSpy = vi.spyOn(marketAPI, 'fetch').mockResolvedValue(null);

        marketAPI.startAutoRefresh();
        expect(fetchSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(marketAPI.CACHE_DURATION);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(marketAPI.CACHE_DURATION);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    test('starting twice does not double the interval', async () => {
        const { default: marketAPI } = await import('./marketplace.js');
        const fetchSpy = vi.spyOn(marketAPI, 'fetch').mockResolvedValue(null);

        marketAPI.startAutoRefresh();
        marketAPI.startAutoRefresh();

        await vi.advanceTimersByTimeAsync(marketAPI.CACHE_DURATION);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test('stopAutoRefresh clears the interval', async () => {
        const { default: marketAPI } = await import('./marketplace.js');
        const fetchSpy = vi.spyOn(marketAPI, 'fetch').mockResolvedValue(null);

        marketAPI.startAutoRefresh();
        marketAPI.stopAutoRefresh();

        await vi.advanceTimersByTimeAsync(marketAPI.CACHE_DURATION * 2);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
