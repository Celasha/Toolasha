import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn(() => ({ isTradable: true })),
        getInitClientData: vi.fn(() => ({ openableLootDropMap: { '/items/chest': [{ itemHrid: '/items/coin' }] } })),
    },
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
    test('returns a per-item breakdown alongside the total, in gainedItems order', () => {
        expectedValueCalculator.resolveSellSideValue.mockImplementation((itemHrid) =>
            itemHrid === '/items/coin' ? { value: 1, needsTax: false } : { value: 50, needsTax: false }
        );

        const { breakdown } = calculateActualValue([
            { itemHrid: '/items/coin', enhancementLevel: 0, count: 100 },
            { itemHrid: '/items/pearl', enhancementLevel: 0, count: 3 },
        ]);

        expect(breakdown).toEqual([
            { itemHrid: '/items/coin', enhancementLevel: 0, count: 100, value: 100, resolved: true },
            { itemHrid: '/items/pearl', enhancementLevel: 0, count: 3, value: 150, resolved: true },
        ]);
    });

    test('marks an unpriced item as unresolved with a value of 0 in the breakdown, not a fake price', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue(null);

        const { breakdown } = calculateActualValue([{ itemHrid: '/items/mystery', enhancementLevel: 0, count: 1 }]);

        expect(breakdown).toEqual([
            { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 0, resolved: false },
        ]);
    });

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

    test('EV-1: a buff-only openable (isOpenable, no openableLootDropMap entry) is N/A even if the shared EV calculator returns a zero-EV object instead of null', () => {
        // This is the real production shape for e.g. /items/seal_of_rare_find: isOpenable=true
        // but no openableLootDropMap entry, so the generic calculator's empty-drop reduction can
        // return { expectedValue: 0, drops: [] } rather than null. The dropTable gate must catch
        // this before ever trusting a non-negative expectedValue as a real monetary model.
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 0, drops: [] });

        const { value, available } = calculateExpectedValueForOpening('/items/seal_of_rare_find', 1);

        expect(value).toBeNull();
        expect(available).toBe(false);
        expect(expectedValueCalculator.calculateExpectedValue).not.toHaveBeenCalled();
    });

    test('returns unavailable when containerCount is zero or missing', () => {
        const { value, available } = calculateExpectedValueForOpening('/items/chest', 0);

        expect(value).toBeNull();
        expect(available).toBe(false);
        expect(expectedValueCalculator.calculateExpectedValue).not.toHaveBeenCalled();
    });

    test('EV-3: marks Expected partial (never Luck-complete) when one modeled drop could not be priced', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 500,
            drops: [
                { itemHrid: '/items/coin', expectedValue: 500, hasPriceData: true },
                { itemHrid: '/items/mystery', expectedValue: 0, hasPriceData: false },
            ],
        });

        const { value, available, complete } = calculateExpectedValueForOpening('/items/chest', 1);

        expect(value).toBe(500);
        expect(available).toBe(true);
        expect(complete).toBe(false);
    });

    test('is complete when every modeled drop could be priced', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 500,
            drops: [{ itemHrid: '/items/coin', expectedValue: 500, hasPriceData: true }],
        });

        const { complete } = calculateExpectedValueForOpening('/items/chest', 1);

        expect(complete).toBe(true);
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

    test('EV-2 / OA-7: returns null when Actual is partial, even though Expected is fully available', () => {
        const { luckValue, luckPercent } = calculateLuck(500, 1000, true, false);

        expect(luckValue).toBeNull();
        expect(luckPercent).toBeNull();
    });

    test('EV-3 / OA-8: returns null when Expected is only partially priced, even though Actual is complete', () => {
        const { luckValue, luckPercent } = calculateLuck(500, 1000, true, true, false);

        expect(luckValue).toBeNull();
        expect(luckPercent).toBeNull();
    });

    test('EV-4: returns a real Luck value when both Actual and Expected are fully complete', () => {
        const { luckValue, luckPercent } = calculateLuck(1500, 1000, true, true, true);

        expect(luckValue).toBe(500);
        expect(luckPercent).toBe(50);
    });
});

describe('buildOpeningRecord', () => {
    test('includes a per-item actualValueBreakdown for the modal/history to consume', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 20, needsTax: false });

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/pearl', enhancementLevel: 0, count: 5 }],
            timestamp: 999,
            characterId: 'char1',
        });

        expect(record.actualValueBreakdown).toEqual([
            { itemHrid: '/items/pearl', enhancementLevel: 0, count: 5, value: 100, resolved: true },
        ]);
    });

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

    test('EV-2 / OA-7: a partial Actual (one unpriced gained item) makes Luck N/A even though Expected is available', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockReturnValueOnce(null);

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/mystery', enhancementLevel: 0, count: 1 }],
            timestamp: 1,
            characterId: 'char1',
        });

        expect(record.actualValueComplete).toBe(false);
        expect(record.expectedValueAvailable).toBe(true);
        expect(record.luckValue).toBeNull();
        expect(record.luckPercent).toBeNull();
    });

    test('EV-3 / OA-8: a partial Expected (one unpriced modeled drop) makes Luck N/A even though Actual is complete', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 100,
            drops: [{ itemHrid: '/items/mystery', expectedValue: 0, hasPriceData: false }],
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, needsTax: false });

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/x', enhancementLevel: 0, count: 1 }],
            timestamp: 1,
            characterId: 'char1',
        });

        expect(record.actualValueComplete).toBe(true);
        expect(record.expectedValueAvailable).toBe(true);
        expect(record.expectedValueComplete).toBe(false);
        expect(record.luckValue).toBeNull();
    });

    test('OA-9: sourceDataComplete=false (e.g. an import that dropped an unmatched item) forces Actual partial and Luck N/A', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, needsTax: false });

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/x', enhancementLevel: 0, count: 1 }],
            timestamp: 1,
            characterId: 'char1',
            sourceDataComplete: false,
        });

        // Every gained item it does know about was priced, but the source told us it dropped
        // an unresolved one - Actual must still be reported as partial.
        expect(record.actualValueComplete).toBe(false);
        expect(record.sourceDataComplete).toBe(false);
        expect(record.luckValue).toBeNull();
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

    test('IMPORT-3 / OA-9: propagates sourceDataComplete: false through to the built record', () => {
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100 });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 1, needsTax: false });

        const record = buildImportedAggregateRecord({
            containerHrid: '/items/chest',
            containerCount: 10,
            itemTotals: { '/items/coin': 100 },
            timestamp: 333,
            characterId: 'char1',
            source: 'import:edible',
            sourceDataComplete: false,
        });

        expect(record.actualValueComplete).toBe(false);
        expect(record.luckValue).toBeNull();
    });
});
