// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockReadMarketplaceRuntimeState,
    mockGetVisibleMarketplaceTabContainer,
    mockNavigateToMarketplace,
    mockWatchNativeTabExit,
    mockAutofillManager,
} = vi.hoisted(() => ({
    mockReadMarketplaceRuntimeState: vi.fn(),
    mockGetVisibleMarketplaceTabContainer: vi.fn(),
    mockNavigateToMarketplace: vi.fn(() => true),
    mockWatchNativeTabExit: vi.fn(() => vi.fn()),
    mockAutofillManager: {
        initialize: vi.fn(),
        startSession: vi.fn(),
        arm: vi.fn(() => true),
        exitSession: vi.fn(),
        cleanup: vi.fn(),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        onSettingChange: vi.fn(),
    },
}));
vi.mock('../../core/data-manager.js', () => ({
    default: {
        characterData: null,
        getInitClientData: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
}));
vi.mock('../../api/marketplace.js', () => ({ default: { getPrice: vi.fn(() => ({ ask: 0, bid: 0 })) } }));
vi.mock('../../utils/formatters.js', () => ({
    numberFormatter: vi.fn((value) => String(value)),
    formatKMB: vi.fn((value) => String(value)),
}));
vi.mock('../../utils/dom.js', async () => {
    const actual = await vi.importActual('../../utils/dom.js');
    return { default: actual.default };
});
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));
vi.mock('../../utils/marketplace-tabs.js', () => ({
    navigateToMarketplace: mockNavigateToMarketplace,
    getVisibleMarketplaceTabContainer: mockGetVisibleMarketplaceTabContainer,
    watchNativeTabExit: mockWatchNativeTabExit,
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({
    createAutofillManager: vi.fn(() => mockAutofillManager),
    readMarketplaceRuntimeState: mockReadMarketplaceRuntimeState,
}));

import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import dataManager from '../../core/data-manager.js';
import { AbilityBookCalculator } from './ability-book-calculator.js';

describe('AbilityBookCalculator marketplace lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        marketplaceSession.endAll();
        mockReadMarketplaceRuntimeState.mockReset();
        mockGetVisibleMarketplaceTabContainer.mockReset();
        mockNavigateToMarketplace.mockClear();
        mockWatchNativeTabExit.mockClear();
        mockAutofillManager.exitSession.mockClear();
    });

    afterEach(() => {
        marketplaceSession.endAll();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test('navigation installs native-tab cancellation before exact item identity converges', async () => {
        const calculator = new AbilityBookCalculator();
        const sessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            onEnd: () => calculator.teardownAbilityBookSession(),
        });
        calculator._abilityBookSessionId = sessionId;
        mockGetVisibleMarketplaceTabContainer.mockReturnValue(document.createElement('div'));
        mockReadMarketplaceRuntimeState.mockReturnValue({
            marketTabKey: 'MarketListings',
            marketListingsView: 'OrderBook',
            itemHrid: '/items/another_book',
            enhancementLevel: 0,
            isSell: false,
        });

        const navigation = calculator.navigateAbilityBookToItem('/items/critical_aura', sessionId);
        await vi.advanceTimersByTimeAsync(100);

        expect(mockWatchNativeTabExit).toHaveBeenCalledTimes(1);
        const onNativeExit = mockWatchNativeTabExit.mock.calls[0][1];
        onNativeExit();
        await vi.advanceTimersByTimeAsync(100);

        await expect(navigation).resolves.toBe(false);
        expect(marketplaceSession.isActive(sessionId)).toBe(false);
    });

    test('navigation rejects the sell-side order book for the same item', async () => {
        const calculator = new AbilityBookCalculator();
        const sessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ABILITY_BOOK });
        calculator._abilityBookSessionId = sessionId;
        mockGetVisibleMarketplaceTabContainer.mockReturnValue(document.createElement('div'));
        mockReadMarketplaceRuntimeState.mockReturnValue({
            marketTabKey: 'MarketListings',
            marketListingsView: 'OrderBook',
            itemHrid: '/items/critical_aura',
            enhancementLevel: 0,
            isSell: true,
        });

        const navigation = calculator.navigateAbilityBookToItem('/items/critical_aura', sessionId);
        await vi.advanceTimersByTimeAsync(3000);

        await expect(navigation).resolves.toBe(false);
        marketplaceSession.end(sessionId);
    });

    test('navigation resolves only after the exact ability-book order book is active', async () => {
        const calculator = new AbilityBookCalculator();
        const sessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ABILITY_BOOK });
        calculator._abilityBookSessionId = sessionId;
        mockGetVisibleMarketplaceTabContainer.mockReturnValue(document.createElement('div'));
        mockReadMarketplaceRuntimeState.mockReturnValue({
            marketTabKey: 'MarketListings',
            marketListingsView: 'OrderBook',
            itemHrid: '/items/critical_aura',
            enhancementLevel: 0,
            isSell: false,
        });

        const navigation = calculator.navigateAbilityBookToItem('/items/critical_aura', sessionId);
        await vi.advanceTimersByTimeAsync(100);

        await expect(navigation).resolves.toBe(true);
        expect(mockWatchNativeTabExit).toHaveBeenCalledTimes(1);
        expect(calculator._abilityBookVisibilityInterval).not.toBeNull();

        marketplaceSession.end(sessionId);
        calculator.teardownAbilityBookSession();
    });

    test('visibility monitor ends ownership after leaving the exact item order book', () => {
        const calculator = new AbilityBookCalculator();
        const sessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            onEnd: () => calculator.teardownAbilityBookSession(),
        });
        calculator._abilityBookSessionId = sessionId;
        mockGetVisibleMarketplaceTabContainer.mockReturnValue(document.createElement('div'));
        mockReadMarketplaceRuntimeState.mockReturnValue({
            marketTabKey: 'MyListings',
            marketListingsView: 'OrderBook',
            itemHrid: '/items/critical_aura',
            enhancementLevel: 0,
            isSell: false,
        });

        calculator.startAbilityBookVisibilityMonitor(sessionId, '/items/critical_aura');
        vi.advanceTimersByTime(600);

        expect(marketplaceSession.isActive(sessionId)).toBe(false);
        expect(mockAutofillManager.exitSession).toHaveBeenCalledWith(sessionId);
    });

    test('visibility monitor keeps ownership while the exact target remains active', () => {
        const calculator = new AbilityBookCalculator();
        const sessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ABILITY_BOOK });
        calculator._abilityBookSessionId = sessionId;
        mockGetVisibleMarketplaceTabContainer.mockReturnValue(document.createElement('div'));
        mockReadMarketplaceRuntimeState.mockReturnValue({
            marketTabKey: 'MarketListings',
            marketListingsView: 'OrderBook',
            itemHrid: '/items/critical_aura',
            enhancementLevel: 0,
            isSell: false,
        });

        calculator.startAbilityBookVisibilityMonitor(sessionId, '/items/critical_aura');
        vi.advanceTimersByTime(1000);

        expect(marketplaceSession.isActive(sessionId)).toBe(true);
        marketplaceSession.end(sessionId);
        calculator.teardownAbilityBookSession();
    });
});

describe('AbilityBookCalculator live ability state (TLA-016)', () => {
    function makeLevelExperienceTable() {
        const table = {};
        for (let level = 0; level <= 200; level++) {
            table[level] = level * 1000;
        }
        // Report's Poke screenshot example - exact values matter for MATH-1/MATH-2.
        table[6] = 286;
        table[7] = 386;
        table[55] = 154009;
        return table;
    }

    function getLiveUpdateHandler() {
        const call = dataManager.on.mock.calls.find(([event]) => event === 'abilities_updated');
        return call?.[1];
    }

    beforeEach(() => {
        dataManager.characterData = null;
        dataManager.getInitClientData.mockReset();
        dataManager.getInitClientData.mockReturnValue({ levelExperienceTable: makeLevelExperienceTable() });
        dataManager.on.mockClear();
        dataManager.off.mockClear();
        mockAutofillManager.arm.mockClear();
    });

    test('MATH-1: Poke screenshot case remains valid (level 6, XP 359, target 55, 50 XP/book)', () => {
        const calculator = new AbilityBookCalculator();
        expect(calculator.calculateBooksNeeded(6, 359, 55, 50)).toBe(3073);
    });

    test('MATH-2: ordinary ceiling behavior at the book-count boundary', () => {
        const calculator = new AbilityBookCalculator();
        expect(calculator.calculateBooksNeeded(6, 358, 55, 50)).toBe(3074);
        expect(calculator.calculateBooksNeeded(6, 359, 55, 50)).toBe(3073);
    });

    test('ABC-1: calculator reflects a live ability update without a page reload', () => {
        const calculator = new AbilityBookCalculator();
        calculator.initialize();

        const panel = document.createElement('div');
        document.body.appendChild(panel);
        calculator.injectCalculator(panel, { level: 6, xp: 359 }, 50, '/items/poke');

        expect(panel.querySelector('#currentLevelValue').textContent).toBe('6');

        dataManager.characterData = {
            characterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        };
        getLiveUpdateHandler()();

        expect(panel.querySelector('#currentLevelValue').textContent).toBe('7');
        calculator.disable();
        panel.remove();
    });

    test('ABC-2: displayed Books needed stays identical to the marketplace autofill quantity after a live update', () => {
        vi.useFakeTimers();
        const calculator = new AbilityBookCalculator();
        calculator.initialize();

        const panel = document.createElement('div');
        document.body.appendChild(panel);
        calculator.injectCalculator(panel, { level: 6, xp: 359 }, 50, '/items/poke');

        dataManager.characterData = {
            characterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        };
        getLiveUpdateHandler()();

        const displayedBooks = Number(panel.querySelector('#tillLevelNumber strong').textContent);

        const buyButton = Array.from(panel.querySelectorAll('button')).find(
            (button) => button.textContent === 'Buy on Marketplace'
        );
        // arm() (and its quantityProvider) is called synchronously before the click handler's
        // first await, so no timer advancement is needed to observe it.
        buyButton.click();

        const [{ quantityProvider }] = mockAutofillManager.arm.mock.calls.at(-1);
        expect(quantityProvider()).toBe(displayedBooks);

        // Flush the dangling navigation/expiry timers this click started so they don't leak
        // into later tests, then tear down.
        calculator.disable();
        vi.useRealTimers();
        panel.remove();
    });

    test('ABC-3: a valid selected target is preserved across a live ability update', () => {
        const calculator = new AbilityBookCalculator();
        calculator.initialize();

        const panel = document.createElement('div');
        document.body.appendChild(panel);
        calculator.injectCalculator(panel, { level: 6, xp: 359 }, 50, '/items/poke');

        const input = panel.querySelector('#tillLevelInput');
        input.value = '55';
        input.dispatchEvent(new Event('change'));

        dataManager.characterData = {
            characterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        };
        getLiveUpdateHandler()();

        // Target 55 is still reachable from the new level 7, so it must not be reset.
        expect(input.value).toBe('55');
        expect(Number(panel.querySelector('#tillLevelNumber strong').textContent)).toBe(
            calculator.calculateBooksNeeded(7, 410, 55, 50)
        );

        calculator.disable();
        panel.remove();
    });

    test('ABC-3b: a target the live update has caught up to advances instead of staying stale/impossible', () => {
        const calculator = new AbilityBookCalculator();
        calculator.initialize();

        const panel = document.createElement('div');
        document.body.appendChild(panel);
        // Default target is currentLevel + 1 = 7.
        calculator.injectCalculator(panel, { level: 6, xp: 359 }, 50, '/items/poke');

        dataManager.characterData = {
            characterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        };
        getLiveUpdateHandler()();

        // The old target (7) is no longer reachable now that current level is 7 - it must advance,
        // not remain stale/impossible.
        expect(panel.querySelector('#tillLevelInput').value).toBe('8');

        calculator.disable();
        panel.remove();
    });

    test('ABC-4: disable() followed by initialize() does not duplicate the ability-update listener', () => {
        const calculator = new AbilityBookCalculator();

        calculator.initialize();
        const firstHandler = getLiveUpdateHandler();
        calculator.disable();

        dataManager.on.mockClear();
        calculator.initialize();
        const secondHandler = getLiveUpdateHandler();

        expect(dataManager.off).toHaveBeenCalledWith('abilities_updated', firstHandler);
        expect(dataManager.on).toHaveBeenCalledTimes(1);
        expect(secondHandler).not.toBe(firstHandler);

        calculator.disable();
    });

    test('the "Refresh page to update current level" limitation text is gone now that the calculator is reactive', () => {
        const calculator = new AbilityBookCalculator();
        calculator.initialize();

        const panel = document.createElement('div');
        document.body.appendChild(panel);
        calculator.injectCalculator(panel, { level: 6, xp: 359 }, 50, '/items/poke');

        expect(panel.textContent).not.toContain('Refresh page');

        calculator.disable();
        panel.remove();
    });
});
