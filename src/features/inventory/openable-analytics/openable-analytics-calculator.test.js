import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/data-manager.js', () => ({
    default: { getItemDetails: vi.fn(() => ({ isTradable: true })) },
}));
vi.mock('../../../core/config.js', () => ({
    default: { getSettingValue: vi.fn((key, defaultValue) => defaultValue) },
}));
vi.mock('../../market/expected-value-calculator.js', () => ({
    default: {
        resolveSellSideValue: vi.fn(),
        calculateExpectedValue: vi.fn(),
    },
}));

const { default: dataManager } = await import('../../../core/data-manager.js');
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');
const {
    calculateActualValue,
    calculateExpectedValueForOpening,
    calculateLuck,
    buildOpeningRecord,
    buildImportedAggregateRecord,
} = await import('./openable-analytics-calculator.js');

beforeEach(() => {
    vi.clearAllMocks();
    dataManager.getItemDetails.mockReturnValue({ isTradable: true });
});

describe('calculateActualValue', () => {
    test('sums resolved gained-item values, applying tax when the source requires it', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: true });

        const { value, complete } = calculateActualValue([{ itemHrid: '/items/x', enhancementLevel: 0, count: 2 }]);

        // 100 * 2 = 200, taxed at 5% => 190
        expect(value).toBeCloseTo(190);
        expect(complete).toBe(true);
    });

    test('does not tax non-tradable items even when needsTax is true', () => {
        dataManager.getItemDetails.mockReturnValue({ isTradable: false });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: true });

        const { value } = calculateActualValue([{ itemHrid: '/items/x', enhancementLevel: 0, count: 1 }]);

        expect(value).toBe(100);
    });

    test('does not tax coin (needsTax: false)', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 1, source: 'coin', needsTax: false });

        const { value } = calculateActualValue([{ itemHrid: '/items/coin', enhancementLevel: 0, count: 500 }]);

        expect(value).toBe(500);
    });

    test('marks the result partial and excludes the item when a price cannot be resolved', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValueOnce(null).mockReturnValueOnce({
            value: 50,
            source: 'market',
            needsTax: false,
        });

        const { value, complete } = calculateActualValue([
            { itemHrid: '/items/unpriced', enhancementLevel: 0, count: 1 },
            { itemHrid: '/items/priced', enhancementLevel: 0, count: 1 },
        ]);

        expect(value).toBe(50);
        expect(complete).toBe(false);
    });

    test('returns zero/complete for an empty gained-items list (buff-only opening)', () => {
        const { value, complete } = calculateActualValue([]);

        expect(value).toBe(0);
        expect(complete).toBe(true);
    });
});

describe('calculateExpectedValueForOpening', () => {
    test('multiplies per-container EV by container count', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 1000 });

        const { value, available } = calculateExpectedValueForOpening('/items/chest', 3);

        expect(value).toBe(3000);
        expect(available).toBe(true);
    });

    test('returns unavailable (not zero) when the EV calculator has no model for the item', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue(null);

        const { value, available } = calculateExpectedValueForOpening('/items/seal_of_rare_find', 1);

        expect(value).toBeNull();
        expect(available).toBe(false);
    });

    test('returns unavailable when containerCount is zero or missing', () => {
        const { value, available } = calculateExpectedValueForOpening('/items/chest', 0);

        expect(value).toBeNull();
        expect(available).toBe(false);
        expect(expectedValueCalculator.calculateExpectedValue).not.toHaveBeenCalled();
    });
});

describe('calculateLuck', () => {
    test('positive luck when actual exceeds expected', () => {
        const { luckValue, luckPercent } = calculateLuck(1500, 1000, true);

        expect(luckValue).toBe(500);
        expect(luckPercent).toBe(50);
    });

    test('negative luck when actual is below expected', () => {
        const { luckValue, luckPercent } = calculateLuck(500, 1000, true);

        expect(luckValue).toBe(-500);
        expect(luckPercent).toBe(-50);
    });

    test('zero luck when actual equals expected', () => {
        const { luckValue, luckPercent } = calculateLuck(1000, 1000, true);

        expect(luckValue).toBe(0);
        expect(luckPercent).toBe(0);
    });

    test('returns null (not zero) when expected value is unavailable', () => {
        const { luckValue, luckPercent } = calculateLuck(500, null, false);

        expect(luckValue).toBeNull();
        expect(luckPercent).toBeNull();
    });

    test('returns null percent (not divide-by-zero) when expected value is exactly zero', () => {
        const { luckValue, luckPercent } = calculateLuck(500, 0, true);

        expect(luckValue).toBe(500);
        expect(luckPercent).toBeNull();
    });
});

describe('buildOpeningRecord', () => {
    test('a granted-buff-only opening (no gained items, no EV model) is counted without fake luck', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue(null);

        const record = buildOpeningRecord({
            containerHrid: '/items/seal_of_rare_find',
            containerCount: 1,
            gainedItems: [],
            grantedBuffs: [{ typeHrid: '/buff_types/rare_find', duration: 3600 }],
            timestamp: 123,
            characterId: 'char1',
        });

        expect(record.actualValue).toBe(0);
        expect(record.actualValueComplete).toBe(true);
        expect(record.expectedValue).toBeNull();
        expect(record.expectedValueAvailable).toBe(false);
        expect(record.luckValue).toBeNull();
        expect(record.luckPercent).toBeNull();
        expect(record.grantedBuffs).toHaveLength(1);
    });

    test('persists event-time pricing mode metadata for stable historical valuation', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, needsTax: false });

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/x', enhancementLevel: 0, count: 1 }],
            timestamp: 456,
            characterId: 'char1',
        });

        expect(record.pricingMode).toBe('hybrid');
        expect(record.keyPricingMode).toBe('ask');
        expect(record.source).toBe('loot_opened');
        expect(record.timestamp).toBe(456);
        expect(record.characterId).toBe('char1');
    });

    test('an openedItem.count > 1 (Open N) increments container count correctly and scales expected value', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 0, needsTax: false });

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 100,
            gainedItems: [],
            timestamp: 789,
            characterId: 'char1',
        });

        expect(record.containerCount).toBe(100);
        expect(record.expectedValue).toBe(10000);
    });
});

describe('buildImportedAggregateRecord', () => {
    test('converts an itemTotals map into gainedItems and reuses buildOpeningRecord math', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockImplementation((itemHrid) =>
            itemHrid === '/items/coin' ? { value: 1, needsTax: false } : { value: 10, needsTax: false }
        );

        const record = buildImportedAggregateRecord({
            containerHrid: '/items/chest',
            containerCount: 50,
            itemTotals: { '/items/coin': 1000, '/items/pearl': 5 },
            timestamp: 111,
            characterId: 'char1',
            source: 'import:mwi-combat-suite',
        });

        expect(record.gainedItems).toEqual(
            expect.arrayContaining([
                { itemHrid: '/items/coin', enhancementLevel: 0, count: 1000 },
                { itemHrid: '/items/pearl', enhancementLevel: 0, count: 5 },
            ])
        );
        expect(record.actualValue).toBe(1050); // 1000*1 + 5*10
        expect(record.expectedValue).toBe(5000); // 100 * 50
        expect(record.source).toBe('import:mwi-combat-suite');
    });

    test('never trusts the import source’s own valuation - recomputes from raw counts', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue(null);
        expectedValueCalculator.resolveSellSideValue.mockReturnValue(null);

        const record = buildImportedAggregateRecord({
            containerHrid: '/items/unmodelled_chest',
            containerCount: 10,
            itemTotals: { '/items/mystery_item': 1 },
            timestamp: 222,
            characterId: 'char1',
            source: 'import:edible',
        });

        expect(record.actualValue).toBe(0);
        expect(record.actualValueComplete).toBe(false);
        expect(record.expectedValueAvailable).toBe(false);
    });
});
