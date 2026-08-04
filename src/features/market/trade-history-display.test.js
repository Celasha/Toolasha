import { beforeEach, describe, expect, test, vi } from 'vitest';

const configMock = {
    getSetting: vi.fn(() => true),
    onSettingChange: vi.fn(),
    offSettingChange: vi.fn(),
};
const dataManagerMock = {
    on: vi.fn(),
    off: vi.fn(),
};
const tradeHistoryMock = {
    getHistory: vi.fn(() => null),
};

vi.mock('../../core/config.js', () => ({ default: configMock }));
vi.mock('../../core/data-manager.js', () => ({ default: dataManagerMock }));
vi.mock('./trade-history.js', () => ({ default: tradeHistoryMock }));
vi.mock('../../utils/formatters.js', () => ({ formatKMB3Digits: (value) => String(value) }));

describe('TradeHistoryDisplay lifecycle', () => {
    let display;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        globalThis.document = {
            querySelectorAll: vi.fn(() => []),
        };

        const mod = await import('./trade-history-display.js');
        display = mod.default;
        display.disable();
        vi.clearAllMocks();
    });

    test('removes and recreates exactly one comparison-mode listener across reinitialization', () => {
        display.initialize();
        const firstHandler = display.comparisonModeHandler;

        expect(configMock.onSettingChange).toHaveBeenCalledTimes(1);
        expect(configMock.onSettingChange).toHaveBeenCalledWith('market_tradeHistoryComparisonMode', firstHandler);

        display.disable();
        expect(configMock.offSettingChange).toHaveBeenCalledWith('market_tradeHistoryComparisonMode', firstHandler);

        display.initialize();
        expect(configMock.onSettingChange).toHaveBeenCalledTimes(2);
        expect(display.comparisonModeHandler).not.toBe(firstHandler);
    });
});
