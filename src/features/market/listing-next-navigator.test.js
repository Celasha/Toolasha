/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../utils/marketplace-tabs.js', () => ({
    navigateToMyListings: vi.fn(() => true),
}));

vi.mock('./listing-refresh-navigator.js', () => ({
    default: {
        getSessionProgress: vi.fn(),
        advanceSession: vi.fn(),
        endSession: vi.fn(),
    },
}));

const { default: listingNextNavigator } = await import('./listing-next-navigator.js');
const { default: listingRefreshNavigator } = await import('./listing-refresh-navigator.js');
const { navigateToMyListings } = await import('../../utils/marketplace-tabs.js');

const CONTAINER_HTML =
    '<div class="MarketplacePanel_marketNavButtonContainer_abc"><button type="button">Refresh</button></div>';
const NEXT_BTN_ID = 'mwi-listing-next-btn';

function progressFor(index, total, itemHrid = '/items/test_item', enhancementLevel = 0) {
    return {
        current: { itemHrid, enhancementLevel },
        index,
        total,
        isLast: index >= total - 1,
    };
}

function stubCurrentItem(item) {
    vi.spyOn(listingNextNavigator, '_getCurrentItem').mockReturnValue(item);
}

beforeEach(() => {
    document.body.innerHTML = CONTAINER_HTML;
    vi.clearAllMocks();
});

afterEach(() => {
    listingNextNavigator.cleanup();
    vi.restoreAllMocks();
});

describe('listingNextNavigator._update() — self-mutation regression (severe hang)', () => {
    test('repeated _update() with unchanged progress performs no additional childList mutation', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        const records = [];
        const observer = new MutationObserver((muts) => records.push(...muts));
        observer.observe(document.body, { childList: true, subtree: true });

        listingNextNavigator._update();
        const creationRecords = observer.takeRecords();
        expect(creationRecords.length).toBe(1);
        expect(listingNextNavigator.nextBtn.textContent).toBe('Next (1/3)');

        listingNextNavigator._update();
        expect(observer.takeRecords().length).toBe(0);

        listingNextNavigator._update();
        expect(observer.takeRecords().length).toBe(0);

        observer.disconnect();
    });

    test('a genuine label change still writes exactly once (guard does not block real updates)', () => {
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        const records = [];
        const observer = new MutationObserver((muts) => records.push(...muts));
        observer.observe(document.body, { childList: true, subtree: true });

        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        listingNextNavigator._update();
        observer.takeRecords();

        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(1, 3));
        listingNextNavigator._update();
        expect(observer.takeRecords().length).toBe(1);
        expect(listingNextNavigator.nextBtn.textContent).toBe('Next (2/3)');

        observer.disconnect();
    });
});

describe('listingNextNavigator._update() — label progression', () => {
    test('first listing shows Next (1/N)', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        listingNextNavigator._update();
        expect(listingNextNavigator.nextBtn.textContent).toBe('Next (1/3)');
    });

    test('an intermediate listing shows an incremented Next label', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(1, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        listingNextNavigator._update();
        expect(listingNextNavigator.nextBtn.textContent).toBe('Next (2/3)');
    });

    test('the final listing shows Back to My Listings', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(2, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        listingNextNavigator._update();
        expect(listingNextNavigator.nextBtn.textContent).toBe('Back to My Listings');
    });
});

describe('listingNextNavigator._update() — native Refresh visibility', () => {
    test('hides the native per-item Refresh button only while the current item matches the session', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        listingNextNavigator._update();

        const nativeBtn = document.querySelector('.MarketplacePanel_marketNavButtonContainer_abc button');
        expect(nativeBtn.style.display).toBe('none');
    });

    test('restores the native Refresh button and removes the Next button on mismatch', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });
        listingNextNavigator._update();

        stubCurrentItem({ itemHrid: '/items/other_item', enhancementLevel: 0 });
        listingNextNavigator._update();

        const nativeBtn = document.querySelector('.MarketplacePanel_marketNavButtonContainer_abc button');
        expect(nativeBtn.style.display).toBe('');
        expect(document.getElementById(NEXT_BTN_ID)).toBeNull();
    });

    test('restores on cleanup when no session is active', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });
        listingNextNavigator._update();

        listingRefreshNavigator.getSessionProgress.mockReturnValue(null);
        listingNextNavigator._update();

        const nativeBtn = document.querySelector('.MarketplacePanel_marketNavButtonContainer_abc button');
        expect(nativeBtn.style.display).toBe('');
        expect(document.getElementById(NEXT_BTN_ID)).toBeNull();
    });
});

describe('listingNextNavigator._handleClick() — one click, one listing', () => {
    test('advances the session exactly once per click when not on the last listing', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        listingNextNavigator._handleClick();

        expect(listingRefreshNavigator.advanceSession).toHaveBeenCalledTimes(1);
        expect(listingRefreshNavigator.endSession).not.toHaveBeenCalled();
        expect(navigateToMyListings).not.toHaveBeenCalled();
    });

    test('ends the session and navigates back on the last listing', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(2, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });
        listingNextNavigator._update();

        listingNextNavigator._handleClick();

        expect(listingRefreshNavigator.endSession).toHaveBeenCalledTimes(1);
        expect(listingRefreshNavigator.advanceSession).not.toHaveBeenCalled();
        expect(navigateToMyListings).toHaveBeenCalledTimes(1);
        expect(document.getElementById(NEXT_BTN_ID)).toBeNull();
    });

    test('does nothing when there is no active session', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(null);
        listingNextNavigator._handleClick();

        expect(listingRefreshNavigator.advanceSession).not.toHaveBeenCalled();
        expect(listingRefreshNavigator.endSession).not.toHaveBeenCalled();
        expect(navigateToMyListings).not.toHaveBeenCalled();
    });
});

describe('listingNextNavigator lifecycle', () => {
    test('initialize -> cleanup -> initialize does not accumulate buttons or leave the observer running', () => {
        listingRefreshNavigator.getSessionProgress.mockReturnValue(progressFor(0, 3));
        stubCurrentItem({ itemHrid: '/items/test_item', enhancementLevel: 0 });

        listingNextNavigator.initialize();
        listingNextNavigator._update();
        expect(document.querySelectorAll(`#${NEXT_BTN_ID}`).length).toBe(1);

        listingNextNavigator.cleanup();
        expect(document.getElementById(NEXT_BTN_ID)).toBeNull();

        listingNextNavigator.initialize();
        listingNextNavigator._update();
        expect(document.querySelectorAll(`#${NEXT_BTN_ID}`).length).toBe(1);

        listingNextNavigator.cleanup();
    });

    test('initialize() is a no-op when already initialized (no duplicate watcher)', () => {
        listingNextNavigator.initialize();
        const watcherAfterFirst = listingNextNavigator.watcher;

        listingNextNavigator.initialize();
        expect(listingNextNavigator.watcher).toBe(watcherAfterFirst);

        listingNextNavigator.cleanup();
    });
});
