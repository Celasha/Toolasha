/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { onClassMock, gameMock } = vi.hoisted(() => ({
    onClassMock: vi.fn(() => () => {}),
    gameMock: { handleGoToNavTarget: vi.fn() },
}));

vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: onClassMock } }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../utils/item-navigation.js', () => ({ getGameObject: () => gameMock }));
vi.mock('../../utils/game-lookups.js', () => ({
    getItemHridFromIconHref: (href) => (href ? `/items/${href.split('#')[1]}` : null),
    getItemHridFromName: () => null,
}));

import tokenShopShortcuts, { getShopDestination, TokenShopShortcuts } from './token-shop-shortcuts.js';

function buildMenu(slug) {
    const menu = document.createElement('div');
    menu.className = 'Item_actionMenu__x';
    menu.innerHTML = `
        <svg><use href="/static/items_sprite.svg#${slug}"></use></svg>
        <div class="Item_name__y">Some Item</div>
        <button class="Button_native">Link to Chat</button>`;
    document.body.appendChild(menu);
    return menu;
}

function buildTabs(containerClass, labels) {
    const container = document.createElement('div');
    container.className = containerClass;
    container.innerHTML = labels
        .map((label, i) => `<button role="tab" aria-selected="${i === 0}">${label}</button>`)
        .join('');
    document.body.appendChild(container);
    return [...container.querySelectorAll('button')];
}

describe('getShopDestination', () => {
    test.each([
        ['/items/chimerical_token', 'shop', 1],
        ['/items/sinister_token', 'shop', 1],
        ['/items/enchanted_token', 'shop', 1],
        ['/items/pirate_token', 'shop', 1],
        ['/items/labyrinth_token', 'labyrinth', 3],
        ['/items/task_token', 'tasks', 1],
        ['/items/guild_token', 'guild', 4],
    ])('%s opens %s tab index %i', (hrid, navTarget, tabIndex) => {
        const destination = getShopDestination(hrid);
        expect(destination.navTarget).toBe(navTarget);
        expect(destination.tabIndex).toBe(tabIndex);
    });

    test('items without a shop get nothing, including the Cowbell which the game handles itself', () => {
        expect(getShopDestination('/items/cowbell')).toBeNull();
        expect(getShopDestination('/items/coin')).toBeNull();
    });
});

describe('TokenShopShortcuts button', () => {
    let feature;

    beforeEach(() => {
        document.body.innerHTML = '';
        gameMock.handleGoToNavTarget.mockClear();
        vi.useFakeTimers();
        feature = new TokenShopShortcuts();
    });

    afterEach(() => {
        feature.cleanup();
        vi.useRealTimers();
    });

    test('registers on the item action menu', () => {
        tokenShopShortcuts.initialize();
        expect(onClassMock).toHaveBeenCalledWith('TokenShopShortcuts', 'Item_actionMenu', expect.any(Function));
        tokenShopShortcuts.cleanup();
    });

    test('adds a styled shop button to a token menu, once, and none to other items', () => {
        const tokenMenu = buildMenu('guild_token');
        feature.injectButton(tokenMenu);
        feature.injectButton(tokenMenu);
        const buttons = tokenMenu.querySelectorAll('.mwi-token-shop-button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toBe('tokenShopShortcuts.guildShop');
        expect(buttons[0].classList.contains('Button_native')).toBe(true);

        const coinMenu = buildMenu('coin');
        feature.injectButton(coinMenu);
        expect(coinMenu.querySelector('.mwi-token-shop-button')).toBeNull();
    });

    test('clicking navigates to the page and then selects the shop tab once it mounts', () => {
        const menu = buildMenu('guild_token');
        feature.injectButton(menu);
        menu.querySelector('.mwi-token-shop-button').click();
        expect(gameMock.handleGoToNavTarget).toHaveBeenCalledWith('guild');

        // The page has not mounted yet.
        vi.advanceTimersByTime(100);
        const tabs = buildTabs('GuildPanel_tabsComponentContainer__z', [
            'Overview',
            'Members',
            'Trials',
            'Buildings',
            'Shop',
            'Icons',
        ]);
        const clicked = tabs.map(() => vi.fn());
        tabs.forEach((tab, i) => tab.addEventListener('click', clicked[i]));

        vi.advanceTimersByTime(100);
        expect(clicked.map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0, 0, 1, 0]);
    });

    test('does not click a tab that is already selected, and stops waiting if the page never mounts', () => {
        const menu = buildMenu('task_token');
        feature.injectButton(menu);
        const tabs = buildTabs('TasksPanel_tabsComponentContainer__z', ['Task Board', 'Task Shop']);
        tabs[1].setAttribute('aria-selected', 'true');
        const click = vi.fn();
        tabs[1].addEventListener('click', click);
        menu.querySelector('.mwi-token-shop-button').click();
        vi.advanceTimersByTime(200);
        expect(click).not.toHaveBeenCalled();

        document.body.innerHTML = '';
        const menu2 = buildMenu('labyrinth_token');
        feature.injectButton(menu2);
        menu2.querySelector('.mwi-token-shop-button').click();
        expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
        expect(vi.getTimerCount()).toBe(0);
    });
});
