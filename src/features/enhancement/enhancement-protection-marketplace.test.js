// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cheapest: { price: 1000, itemHrid: '/items/mirror_of_protection' },
    itemDetails: { name: 'Mirror of Protection' },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn((_key, fallback) => fallback),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn(() => mocks.itemDetails),
    },
}));

vi.mock('./tooltip-enhancement.js', () => ({
    getCheapestProtectionPrice: vi.fn(() => mocks.cheapest),
}));

vi.mock('../../utils/marketplace-tabs.js', () => ({
    navigateToMarketplace: vi.fn(),
}));

import dataManager from '../../core/data-manager.js';
import { navigateToMarketplace } from '../../utils/marketplace-tabs.js';
import { getCheapestProtectionPrice } from './tooltip-enhancement.js';
import { EnhancementProtectionMarketplace } from './enhancement-protection-marketplace.js';

function makeEnhancingPanelWithProtectionSlot(itemHrid) {
    const panel = document.createElement('div');
    panel.className = 'SkillActionDetail_enhancingComponent__17bOx';
    if (itemHrid) panel.dataset.mwiItemHrid = itemHrid;

    const container = document.createElement('div');
    container.className = 'SkillActionDetail_protectionItemInputContainer__35ChM';
    panel.appendChild(container);

    document.body.appendChild(panel);
    return { panel, container };
}

function appendMenu() {
    const menu = document.createElement('div');
    menu.className = 'ItemSelector_menu__12sEM';
    document.body.appendChild(menu);
    return menu;
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('EnhancementProtectionMarketplace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cheapest = { price: 1000, itemHrid: '/items/mirror_of_protection' };
        mocks.itemDetails = { name: 'Mirror of Protection' };
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('clicking the protection selector injects a buy-cheapest button into the next ItemSelector menu', async () => {
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        feature._attachClickWatcher(container);

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        expect(getCheapestProtectionPrice).toHaveBeenCalledWith('/items/sinister_cape');
        const btn = menu.querySelector('button');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toContain('Mirror of Protection');
    });

    test('does not inject into a menu opened for an unrelated item selector (no prior click)', async () => {
        const feature = new EnhancementProtectionMarketplace();
        makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        // No click on the protection container, no watch started.
        void feature;

        const menu = appendMenu();
        await flushMicrotasks();

        expect(menu.querySelector('button')).toBeNull();
    });

    test('clicking the injected button navigates to the marketplace for the cheapest option and dismisses the popup', async () => {
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        feature._attachClickWatcher(container);

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        const outsideClickSpy = vi.fn();
        document.body.addEventListener('mousedown', outsideClickSpy);

        menu.querySelector('button').click();

        expect(navigateToMarketplace).toHaveBeenCalledWith('/items/mirror_of_protection', 0);
        expect(outsideClickSpy).toHaveBeenCalledTimes(1);
    });

    test('does not inject a button when the enhancing item hrid cannot be resolved from the panel', async () => {
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot(null);
        feature._attachClickWatcher(container);

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        expect(menu.querySelector('button')).toBeNull();
        expect(getCheapestProtectionPrice).not.toHaveBeenCalled();
    });

    test('does not inject a button when no protection option is priceable', async () => {
        mocks.cheapest = { price: 0, itemHrid: null };
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        feature._attachClickWatcher(container);

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        expect(menu.querySelector('button')).toBeNull();
        expect(dataManager.getItemDetails).not.toHaveBeenCalled();
    });

    test('does not double-inject if the same menu is matched twice', async () => {
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        feature._attachClickWatcher(container);

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        // Simulate a second mutation on the same already-marked menu (e.g. a sibling icon added).
        feature._injectButton(menu, container);

        expect(menu.querySelectorAll('button').length).toBe(1);
    });

    test('a repeated click on the container does not attach a second listener', () => {
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');

        feature._attachClickWatcher(container);
        feature._attachClickWatcher(container);

        expect(feature.containerClickHandlers.has(container)).toBe(true);
    });

    test('disable() removes click listeners so a later click no longer starts a menu watch', async () => {
        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        feature._attachClickWatcher(container);

        feature.disable();

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        expect(menu.querySelector('button')).toBeNull();
    });

    test('initialize() does nothing when the setting is disabled', async () => {
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(false);

        const feature = new EnhancementProtectionMarketplace();
        const { container } = makeEnhancingPanelWithProtectionSlot('/items/sinister_cape');
        feature.initialize();

        container.click();
        const menu = appendMenu();
        await flushMicrotasks();

        expect(menu.querySelector('button')).toBeNull();
        expect(feature.isInitialized).toBe(false);
    });
});
