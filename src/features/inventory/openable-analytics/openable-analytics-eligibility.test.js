import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    itemDetailMap: {},
    openableLootDropMap: {},
    initDataAvailable: true,
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn((hrid) => mocks.itemDetailMap[hrid] || null),
        getInitClientData: vi.fn(() =>
            mocks.initDataAvailable ? { openableLootDropMap: mocks.openableLootDropMap } : null
        ),
    },
}));

const {
    OPENABLE_MODEL_STATUS,
    getOpenableModelStatus,
    shouldExposeOpenableContainer,
    shouldTrackImportedOpenable,
    shouldTrackOpenableOpening,
} = await import('./openable-analytics-eligibility.js');

beforeEach(() => {
    mocks.itemDetailMap = {
        '/items/chest': { name: 'Chest', isOpenable: true },
        '/items/scroll': { name: 'Scroll', isOpenable: true },
        '/items/bag_of_10_cowbells': { name: 'Bag Of 10 Cowbells', isOpenable: true },
    };
    mocks.openableLootDropMap = {
        '/items/chest': [{ itemHrid: '/items/coin', dropRate: 0.5, minCount: 1, maxCount: 2 }],
        '/items/bag_of_10_cowbells': [{ itemHrid: '/items/cowbell', dropRate: 1, minCount: 10, maxCount: 10 }],
    };
    mocks.initDataAvailable = true;
});

describe('getOpenableModelStatus', () => {
    test('classifies a variable current drop table as randomized', () => {
        expect(getOpenableModelStatus('/items/chest')).toBe(OPENABLE_MODEL_STATUS.RANDOMIZED);
    });

    test('classifies a known openable with no current drop table as no-item-loot', () => {
        expect(getOpenableModelStatus('/items/scroll')).toBe(OPENABLE_MODEL_STATUS.NO_ITEM_LOOT);
    });

    test('classifies a guaranteed fixed-output loot table as deterministic', () => {
        expect(getOpenableModelStatus('/items/bag_of_10_cowbells')).toBe(OPENABLE_MODEL_STATUS.DETERMINISTIC);
    });

    test('fails open for an unknown item', () => {
        expect(getOpenableModelStatus('/items/new_unknown_openable')).toBe(OPENABLE_MODEL_STATUS.UNKNOWN);
        expect(shouldExposeOpenableContainer('/items/new_unknown_openable')).toBe(true);
    });

    test('fails open while current init/drop-table data is unavailable', () => {
        mocks.initDataAvailable = false;
        expect(getOpenableModelStatus('/items/scroll')).toBe(OPENABLE_MODEL_STATUS.UNKNOWN);
        expect(shouldExposeOpenableContainer('/items/scroll')).toBe(true);
    });

    test('fails open for an incomplete guaranteed drop definition', () => {
        mocks.openableLootDropMap['/items/bag_of_10_cowbells'] = [
            { itemHrid: '/items/cowbell', dropRate: 1, minCount: 10 },
        ];
        expect(getOpenableModelStatus('/items/bag_of_10_cowbells')).toBe(OPENABLE_MODEL_STATUS.UNKNOWN);
    });
});

describe('shouldTrackOpenableOpening', () => {
    test('excludes a positively-known no-item-loot opening with no gained items', () => {
        expect(shouldTrackOpenableOpening('/items/scroll', 1, [])).toBe(false);
        expect(shouldExposeOpenableContainer('/items/scroll')).toBe(false);
    });

    test('real gained items fail open if a no-item-loot model is contradicted at runtime', () => {
        expect(shouldTrackOpenableOpening('/items/scroll', 1, [{ itemHrid: '/items/coin', count: 1 }])).toBe(true);
    });

    test('excludes Bag Of 10 Cowbells when its guaranteed fixed output matches the model', () => {
        expect(
            shouldTrackOpenableOpening('/items/bag_of_10_cowbells', 1, [{ itemHrid: '/items/cowbell', count: 10 }])
        ).toBe(false);
        expect(
            shouldTrackOpenableOpening('/items/bag_of_10_cowbells', 3, [{ itemHrid: '/items/cowbell', count: 30 }])
        ).toBe(false);
        expect(shouldExposeOpenableContainer('/items/bag_of_10_cowbells')).toBe(false);
    });

    test('fails open when observed deterministic output contradicts the current static model', () => {
        expect(
            shouldTrackOpenableOpening('/items/bag_of_10_cowbells', 1, [{ itemHrid: '/items/cowbell', count: 11 }])
        ).toBe(true);
        expect(
            shouldTrackOpenableOpening('/items/bag_of_10_cowbells', 1, [
                { itemHrid: '/items/cowbell', count: 10 },
                { itemHrid: '/items/coin', count: 1 },
            ])
        ).toBe(true);
    });

    test('keeps randomized openables tracked', () => {
        expect(shouldTrackOpenableOpening('/items/chest', 1, [{ itemHrid: '/items/coin', count: 1 }])).toBe(true);
        expect(shouldExposeOpenableContainer('/items/chest')).toBe(true);
    });
});

describe('shouldTrackImportedOpenable', () => {
    test('excludes an exact deterministic cumulative Bag Of 10 Cowbells import', () => {
        expect(
            shouldTrackImportedOpenable('/items/bag_of_10_cowbells', 12, {
                '/items/cowbell': 120,
            })
        ).toBe(false);
    });

    test('keeps contradictory deterministic import data fail-open', () => {
        expect(
            shouldTrackImportedOpenable('/items/bag_of_10_cowbells', 12, {
                '/items/cowbell': 119,
            })
        ).toBe(true);
    });
});
