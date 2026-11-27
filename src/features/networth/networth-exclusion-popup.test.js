import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPriceOutlierInfo: vi.fn(),
    snapshots: [],
}));

vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../../core/data-manager.js', () => ({
    default: { getItemDetails: vi.fn((itemHrid) => ({ name: itemHrid.replace('/items/', '') })) },
}));
vi.mock('../../utils/market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));
vi.mock('../../core/loadout-state.js', () => ({
    default: { getAllSnapshots: () => mocks.snapshots },
}));
vi.mock('./networth-exclusions.js', () => ({
    getExclusions: vi.fn(() => []),
    isExcluded: vi.fn(() => false),
    addExclusion: vi.fn(),
    removeExclusion: vi.fn(),
    clearExclusions: vi.fn(),
}));
vi.mock('./networth-calculator.js', () => ({ buildGuildBuffDisplayName: vi.fn((hrid) => hrid) }));
vi.mock('../../utils/panel-z-index.js', () => ({
    registerFloatingPanel: vi.fn(),
    unregisterFloatingPanel: vi.fn(),
    bringPanelToFront: vi.fn(),
}));

import networthExclusionPopup from './networth-exclusion-popup.js';

describe('NetworthExclusionPopup.refresh', () => {
    test('stores new data without rebuilding a closed popup, then rebuilds on open and on refresh', () => {
        networthExclusionPopup.container = null;
        const buildList = vi
            .spyOn(networthExclusionPopup, '_buildSearchList')
            .mockReturnValue([{ name: 'Updated entry' }]);
        const build = vi.spyOn(networthExclusionPopup, '_build').mockImplementation(() => {});
        const render = vi.spyOn(networthExclusionPopup, '_refreshContent').mockImplementation(() => {});
        try {
            const closedData = { totalNetworth: 100 };
            networthExclusionPopup.refresh(closedData);
            expect(networthExclusionPopup.networthData).toBe(closedData);
            expect(buildList).not.toHaveBeenCalled();
            expect(render).not.toHaveBeenCalled();

            networthExclusionPopup.open(closedData, vi.fn());
            expect(buildList).toHaveBeenCalledExactlyOnceWith(closedData);
            expect(build).toHaveBeenCalledOnce();

            networthExclusionPopup.container = {};
            const openData = { totalNetworth: 200 };
            networthExclusionPopup.refresh(openData);
            expect(buildList).toHaveBeenLastCalledWith(openData);
            expect(networthExclusionPopup.searchList).toEqual([{ name: 'Updated entry' }]);
            expect(render).toHaveBeenCalledOnce();
        } finally {
            networthExclusionPopup.container = null;
            buildList.mockRestore();
            build.mockRestore();
            render.mockRestore();
        }
    });
});

describe('NetworthExclusionPopup - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.snapshots = [
            {
                name: 'Combat',
                equipment: [{ itemHrid: '/items/sword' }],
                unavailableEquipment: [],
            },
        ];
    });

    test('_buildSearchList flags a loadout entry as outlier when any of its items were substituted', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 1000, isOutlier: true });

        const entries = networthExclusionPopup._buildSearchList({});
        const loadoutEntry = entries.find((e) => e.type === 'loadout');

        expect(loadoutEntry.isOutlier).toBe(true);
        expect(loadoutEntry.amount).toBe(1000);
    });

    test('_buildSearchList does not flag a loadout entry when no item was substituted', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 1000, isOutlier: false });

        const entries = networthExclusionPopup._buildSearchList({});
        const loadoutEntry = entries.find((e) => e.type === 'loadout');

        expect(loadoutEntry.isOutlier).toBe(false);
    });

    test('_getBreakdownItems flags each loadout item individually', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 500, isOutlier: true });
        networthExclusionPopup.networthData = {};

        const items = networthExclusionPopup._getBreakdownItems({ type: 'loadout', value: 'Combat' });

        expect(items).toEqual([{ name: 'sword', value: 500, isOutlier: true }]);
    });
});
