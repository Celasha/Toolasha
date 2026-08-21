/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../utils/marketplace-tabs.js', () => ({
    navigateToMarketplace: vi.fn(() => true),
}));

const { default: listingRefreshNavigator } = await import('./listing-refresh-navigator.js');
const { navigateToMarketplace } = await import('../../utils/marketplace-tabs.js');

const COUNT_CONTAINER_HTML =
    '<div class="MarketplacePanel_listingCount_abc"><button type="button">Upgrade Capacity</button></div>';

function tableHtml(rows) {
    const trs = rows
        .map(
            (r) =>
                `<tr data-item-hrid="${r.itemHrid}" data-enhancement-level="${r.enhancementLevel ?? 0}" data-listing-id="${r.listingId}"></tr>`
        )
        .join('');
    return `<table class="MarketplacePanel_myListingsTable_xyz"><tbody>${trs}</tbody></table>`;
}

beforeEach(() => {
    document.body.innerHTML =
        COUNT_CONTAINER_HTML +
        tableHtml([
            { itemHrid: '/items/a', listingId: 'L1' },
            { itemHrid: '/items/b', listingId: 'L2' },
            { itemHrid: '/items/c', listingId: 'L3' },
        ]);
    vi.clearAllMocks();
});

afterEach(() => {
    listingRefreshNavigator.cleanup();
    vi.restoreAllMocks();
});

describe('listingRefreshNavigator._watch() self-mutation safety', () => {
    test('repeated ensureButton passes (via _watch) perform no additional childList mutation once the button exists', () => {
        const records = [];
        const observer = new MutationObserver((muts) => records.push(...muts));
        observer.observe(document.body, { childList: true, subtree: true });

        listingRefreshNavigator._watch();
        observer.takeRecords();

        listingRefreshNavigator._watch();
        expect(observer.takeRecords().length).toBe(0);

        listingRefreshNavigator._watch();
        expect(observer.takeRecords().length).toBe(0);

        observer.disconnect();
    });
});

describe('listingRefreshNavigator session lifecycle', () => {
    test('Refresh starts a session and navigates to the first listing', () => {
        listingRefreshNavigator._watch();
        listingRefreshNavigator._startSession();

        expect(navigateToMarketplace).toHaveBeenCalledWith('/items/a', 0);
        const progress = listingRefreshNavigator.getSessionProgress();
        expect(progress).toEqual({
            current: { itemHrid: '/items/a', enhancementLevel: 0, listingId: 'L1' },
            index: 0,
            total: 3,
            isLast: false,
        });
    });

    test('advanceSession moves exactly one listing forward and navigates', () => {
        listingRefreshNavigator._startSession();
        navigateToMarketplace.mockClear();

        const advanced = listingRefreshNavigator.advanceSession();

        expect(advanced).toBe(true);
        expect(navigateToMarketplace).toHaveBeenCalledTimes(1);
        expect(navigateToMarketplace).toHaveBeenCalledWith('/items/b', 0);
        expect(listingRefreshNavigator.getSessionProgress().index).toBe(1);
    });

    test('advanceSession is false and does not navigate once already on the last listing', () => {
        listingRefreshNavigator._startSession();
        listingRefreshNavigator.advanceSession();
        listingRefreshNavigator.advanceSession();
        navigateToMarketplace.mockClear();

        const advanced = listingRefreshNavigator.advanceSession();

        expect(advanced).toBe(false);
        expect(navigateToMarketplace).not.toHaveBeenCalled();
        expect(listingRefreshNavigator.getSessionProgress().isLast).toBe(true);
    });

    test('endSession clears the session', () => {
        listingRefreshNavigator._startSession();
        listingRefreshNavigator.endSession();

        expect(listingRefreshNavigator.getSessionProgress()).toBeNull();
    });

    test('getSessionProgress is null when no session has been started', () => {
        expect(listingRefreshNavigator.getSessionProgress()).toBeNull();
    });
});

describe('listingRefreshNavigator lifecycle', () => {
    test('initialize -> cleanup -> initialize does not accumulate Refresh buttons', () => {
        listingRefreshNavigator.initialize();
        expect(document.querySelectorAll('.MarketplacePanel_listingCount_abc button').length).toBe(2);

        listingRefreshNavigator.cleanup();
        expect(document.querySelectorAll('.MarketplacePanel_listingCount_abc button').length).toBe(1);

        listingRefreshNavigator.initialize();
        expect(document.querySelectorAll('.MarketplacePanel_listingCount_abc button').length).toBe(2);

        listingRefreshNavigator.cleanup();
    });

    test('initialize() is a no-op when already initialized (no duplicate watcher)', () => {
        listingRefreshNavigator.initialize();
        const watcherAfterFirst = listingRefreshNavigator.watcher;

        listingRefreshNavigator.initialize();
        expect(listingRefreshNavigator.watcher).toBe(watcherAfterFirst);

        listingRefreshNavigator.cleanup();
    });

    test('cleanup clears any active session', () => {
        listingRefreshNavigator.initialize();
        listingRefreshNavigator._startSession();
        listingRefreshNavigator.cleanup();

        expect(listingRefreshNavigator.getSessionProgress()).toBeNull();
    });
});
