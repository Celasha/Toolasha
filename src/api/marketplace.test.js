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
