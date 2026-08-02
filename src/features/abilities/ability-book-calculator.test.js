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
vi.mock('../../core/data-manager.js', () => ({ default: {} }));
vi.mock('../../api/marketplace.js', () => ({ default: {} }));
vi.mock('../../utils/formatters.js', () => ({
    numberFormatter: vi.fn((value) => String(value)),
    formatKMB: vi.fn((value) => String(value)),
}));
vi.mock('../../utils/dom.js', () => ({ default: {} }));
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
