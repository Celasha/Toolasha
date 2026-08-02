// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
    clickMarketplaceNavigationButton,
    createMaterialTab,
    getVisibleMarketplaceTabContainer,
    isMarketplaceMarketListingsSelected,
    setupMarketplaceCleanupObserver,
    updateTabBadge,
    watchNativeTabExit,
} from './marketplace-tabs.js';

function makeMarketplacePanel({ hidden = false } = {}) {
    const panel = document.createElement('div');
    panel.className = 'MarketplacePanel_marketplacePanel__test';
    if (hidden) panel.style.display = 'none';

    const tabs = document.createElement('div');
    tabs.className = 'MuiTabs-flexContainer';
    tabs.setAttribute('role', 'tablist');

    for (const text of ['Market Listings', 'My Listings']) {
        const tab = document.createElement('button');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', text === 'Market Listings' ? 'true' : 'false');
        if (text === 'Market Listings') tab.classList.add('Mui-selected');
        tab.innerHTML = `<span class="TabsComponent_badge__test">${text}</span>`;
        tabs.appendChild(tab);
    }

    panel.appendChild(tabs);
    document.body.appendChild(panel);
    return { panel, tabs, referenceTab: tabs.lastElementChild };
}

function makeMaterial(overrides = {}) {
    return {
        itemHrid: '/items/cheese',
        itemName: 'Cheese',
        missing: 10,
        required: 10,
        isTradeable: true,
        ...overrides,
    };
}

describe('marketplace-tabs', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    test('returns the unique visible Marketplace tablist', () => {
        makeMarketplacePanel({ hidden: true });
        const visible = makeMarketplacePanel();

        expect(getVisibleMarketplaceTabContainer()).toBe(visible.tabs);
    });

    test('fails closed when multiple Marketplace tablists are visible', () => {
        makeMarketplacePanel();
        makeMarketplacePanel();

        expect(getVisibleMarketplaceTabContainer()).toBeNull();
    });

    test('recognizes only Market Listings as the selected native workflow tab', () => {
        const { tabs } = makeMarketplacePanel();
        const marketListings = tabs.children[0];
        const myListings = tabs.children[1];

        expect(isMarketplaceMarketListingsSelected(tabs)).toBe(true);

        marketListings.classList.remove('Mui-selected');
        marketListings.setAttribute('aria-selected', 'false');
        myListings.classList.add('Mui-selected');
        myListings.setAttribute('aria-selected', 'true');

        expect(isMarketplaceMarketListingsSelected(tabs)).toBe(false);
    });

    test('clicks only the unique visible Marketplace navigation control', () => {
        const nav = document.createElement('button');
        nav.className = 'NavigationBar_nav__test';
        nav.innerHTML = '<svg aria-label="navigationBar.marketplace"></svg>';
        document.body.appendChild(nav);
        const click = vi.fn();
        nav.addEventListener('click', click);

        expect(clickMarketplaceNavigationButton()).toBe(true);
        expect(click).toHaveBeenCalledTimes(1);

        const duplicate = nav.cloneNode(true);
        document.body.appendChild(duplicate);
        expect(clickMarketplaceNavigationButton()).toBe(false);
    });

    test('custom tabs do not duplicate the cloned native tab identity', () => {
        const { referenceTab } = makeMarketplacePanel();
        referenceTab.id = 'native-my-listings';
        referenceTab.setAttribute('aria-controls', 'native-panel');

        const tab = createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS');

        expect(tab.hasAttribute('id')).toBe(false);
        expect(tab.hasAttribute('aria-controls')).toBe(false);
    });

    test('complete and non-tradeable material tabs are inert', () => {
        const { referenceTab } = makeMarketplacePanel();
        const onClick = vi.fn();
        const complete = createMaterialTab(makeMaterial({ missing: 0 }), referenceTab, onClick, 'ACTIONS');
        const nonTradeable = createMaterialTab(makeMaterial({ isTradeable: false }), referenceTab, onClick, 'ACTIONS');
        document.body.append(complete, nonTradeable);

        complete.click();
        nonTradeable.click();

        expect(onClick).not.toHaveBeenCalled();
        expect(complete.getAttribute('aria-disabled')).toBe('true');
        expect(nonTradeable.getAttribute('aria-disabled')).toBe('true');
    });

    test('updateTabBadge disables a material immediately after the missing count reaches zero', () => {
        const { referenceTab } = makeMarketplacePanel();
        const onClick = vi.fn();
        const material = makeMaterial({ missing: 5 });
        const tab = createMaterialTab(material, referenceTab, onClick, 'ACTIONS');
        document.body.appendChild(tab);

        tab.click();
        expect(onClick).toHaveBeenCalledTimes(1);

        updateTabBadge(tab, { ...material, missing: 0 });
        tab.click();

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(tab.getAttribute('data-missing-quantity')).toBe('0');
        expect(tab.getAttribute('aria-disabled')).toBe('true');
    });

    test('Sell Queue can keep a zero-count custom tab actionable through forceActionable', () => {
        const { referenceTab } = makeMarketplacePanel();
        const onClick = vi.fn();
        const tab = createMaterialTab(
            makeMaterial({ missing: 0, forceActionable: true }),
            referenceTab,
            onClick,
            'SELL_QUEUE'
        );
        document.body.appendChild(tab);

        tab.click();

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(tab.getAttribute('aria-disabled')).toBe('false');
    });

    test('native-tab watcher ignores nested custom-tab clicks and exits on nested native-tab clicks', () => {
        const { tabs, referenceTab } = makeMarketplacePanel();
        const onExit = vi.fn();
        const cleanup = watchNativeTabExit(tabs, onExit);

        const custom = createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS');
        const customChild = custom.querySelector('span') || custom;
        tabs.appendChild(custom);
        customChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onExit).not.toHaveBeenCalled();

        const nativeChild = referenceTab.querySelector('span');
        nativeChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onExit).toHaveBeenCalledTimes(1);

        cleanup();
        nativeChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    test('cleanup observer exits when My Listings becomes selected even if custom tabs remain', async () => {
        const { tabs, referenceTab } = makeMarketplacePanel();
        const onTabsGone = vi.fn();
        tabs.appendChild(createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS'));
        const cleanup = setupMarketplaceCleanupObserver({ owner: 'ACTIONS', onTabsGone });

        const marketListings = tabs.children[0];
        const myListings = tabs.children[1];
        marketListings.classList.remove('Mui-selected');
        marketListings.setAttribute('aria-selected', 'false');
        myListings.classList.add('Mui-selected');
        myListings.setAttribute('aria-selected', 'true');
        await Promise.resolve();

        expect(onTabsGone).toHaveBeenCalledTimes(1);
        cleanup();
    });

    test('hidden retained owner tabs do not mask missing tabs in the current visible Marketplace', () => {
        const hidden = makeMarketplacePanel({ hidden: true });
        hidden.tabs.appendChild(createMaterialTab(makeMaterial(), hidden.referenceTab, vi.fn(), 'ACTIONS'));
        makeMarketplacePanel();

        const onTabsGone = vi.fn();
        const cleanup = setupMarketplaceCleanupObserver({ owner: 'ACTIONS', onTabsGone });

        vi.advanceTimersByTime(1000);
        expect(onTabsGone).toHaveBeenCalledTimes(1);
        cleanup();
    });

    test('cleanup observer tolerates a bounded React remount gap', async () => {
        const { tabs, referenceTab } = makeMarketplacePanel();
        const onTabsGone = vi.fn();
        const first = createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS');
        tabs.appendChild(first);
        const cleanup = setupMarketplaceCleanupObserver({
            owner: 'ACTIONS',
            onTabsGone,
            invalidStateGraceMs: 250,
        });

        first.remove();
        await Promise.resolve();
        vi.advanceTimersByTime(200);
        expect(onTabsGone).not.toHaveBeenCalled();

        const replacement = createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS');
        tabs.appendChild(replacement);
        await Promise.resolve();
        vi.advanceTimersByTime(100);
        expect(onTabsGone).not.toHaveBeenCalled();

        replacement.remove();
        await Promise.resolve();
        vi.advanceTimersByTime(249);
        expect(onTabsGone).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onTabsGone).toHaveBeenCalledTimes(1);

        cleanup();
    });

    test('cleanup observer reacts promptly to tab removal and panel hiding without duplicate notifications', async () => {
        const { panel, tabs, referenceTab } = makeMarketplacePanel();
        const onTabsGone = vi.fn();
        const tab = createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS');
        tabs.appendChild(tab);
        const cleanup = setupMarketplaceCleanupObserver({ owner: 'ACTIONS', onTabsGone });

        vi.advanceTimersByTime(1000);
        expect(onTabsGone).not.toHaveBeenCalled();

        tab.remove();
        await Promise.resolve();
        expect(onTabsGone).toHaveBeenCalledTimes(1);

        // The fallback interval must not report the same invalid state twice.
        vi.advanceTimersByTime(1000);
        expect(onTabsGone).toHaveBeenCalledTimes(1);

        const replacement = createMaterialTab(makeMaterial(), referenceTab, vi.fn(), 'ACTIONS');
        tabs.appendChild(replacement);
        await Promise.resolve();

        panel.style.display = 'none';
        await Promise.resolve();
        expect(onTabsGone).toHaveBeenCalledTimes(2);

        cleanup();
        panel.style.display = '';
        await Promise.resolve();
        expect(onTabsGone).toHaveBeenCalledTimes(2);
    });
});
