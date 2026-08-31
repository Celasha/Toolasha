// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetInitClientData, mockCalculateExperienceMultiplier, mockGetStateFingerprint } = vi.hoisted(() => ({
    mockGetInitClientData: vi.fn(),
    mockCalculateExperienceMultiplier: vi.fn(),
    mockGetStateFingerprint: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        COLOR_TEXT_SECONDARY: '#888888',
        COLOR_TEXT_PRIMARY: '#ffffff',
        COLOR_INFO: '#60a5fa',
        COLOR_XP_RATE: '#ffffff',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: mockGetInitClientData,
        getSkills: vi.fn(() => []),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

vi.mock('./alchemy-profit.js', () => ({ default: { getStateFingerprint: mockGetStateFingerprint } }));
vi.mock('../market/alchemy-profit-calculator.js', () => ({ default: {} }));
vi.mock('../../utils/experience-parser.js', () => ({
    calculateExperienceMultiplier: mockCalculateExperienceMultiplier,
}));
vi.mock('../../utils/profit-helpers.js', () => ({
    calculateActionsPerHour: vi.fn((seconds) => 3600 / seconds),
}));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: vi.fn(() => ({ clearAll: vi.fn(), registerTimeout: vi.fn() })),
}));

import { AlchemyProfitDisplay } from './alchemy-profit-display.js';
import dataManager from '../../core/data-manager.js';

describe('AlchemyProfitDisplay subscribes to the common buffs_updated event (TLA-028)', () => {
    let display;

    beforeEach(() => {
        vi.clearAllMocks();
        display = new AlchemyProfitDisplay();
    });

    test('initialize registers a buffs_updated listener alongside items_updated/consumables_updated', () => {
        display.initialize();

        const subscribedEvents = dataManager.on.mock.calls.map(([event]) => event);
        expect(subscribedEvents).toContain('buffs_updated');
        expect(subscribedEvents).toContain('items_updated');
        expect(subscribedEvents).toContain('consumables_updated');
    });

    test('disable unregisters the buffs_updated listener', () => {
        display.initialize();

        display.disable();

        expect(dataManager.off).toHaveBeenCalledWith('buffs_updated', expect.any(Function));
    });

    test('a buffs_updated notification clears the cached fingerprint and re-checks the display while active', () => {
        vi.useFakeTimers();
        display.initialize();
        display.isActive = true;
        display.lastFingerprint = 'stale';
        const checkSpy = vi.spyOn(display, 'checkAndUpdateDisplay').mockImplementation(() => {});

        const buffsHandler = dataManager.on.mock.calls.find(([event]) => event === 'buffs_updated')[1];
        buffsHandler();
        vi.advanceTimersByTime(100);

        expect(display.lastFingerprint).toBeNull();
        expect(checkSpy).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

describe('Alchemy inline XP/hour calculation', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mockGetInitClientData.mockReset();
        mockCalculateExperienceMultiplier.mockReset();
        mockGetStateFingerprint.mockReset();
    });

    test('keeps player-repro action subtype base XP formulas distinct', () => {
        const display = Object.create(AlchemyProfitDisplay.prototype);

        // Player video sentinel: Pirate Essence is level 95. Its native Current Action is
        // Coinify, so 105 is correct; 168 is exactly the wrong Transmute formula seen in the bug.
        expect(display.getAlchemyBaseXP('coinify', 95)).toBe(105);
        expect(display.getAlchemyBaseXP('transmute', 95)).toBe(168);

        // Reverse-swap sentinel: Moonstone is level 55. Transmute must be 104, never the
        // queued Pirate/Coinify formula (65).
        expect(display.getAlchemyBaseXP('transmute', 55)).toBe(104);
        expect(display.getAlchemyBaseXP('coinify', 55)).toBe(65);
    });

    test('uses the same expected success/failure XP formula as Level Progress', () => {
        mockGetInitClientData.mockReturnValue({
            itemDetailMap: {
                '/items/test': { itemLevel: 20 },
            },
        });
        mockCalculateExperienceMultiplier.mockReturnValue({ totalMultiplier: 2 });
        const display = Object.create(AlchemyProfitDisplay.prototype);

        // Coinify base XP = item level + 10 = 30. With ×2 wisdom,
        // success gives 60 and failure gives 6. At 50% success: 33 XP/action.
        expect(display.calculateAlchemyXPPerAction('coinify', '/items/test', 0.5)).toBe(33);
    });

    test('converts the shared expected XP/action into exact XP/hour with efficiency', () => {
        const display = Object.create(AlchemyProfitDisplay.prototype);
        display.calculateAlchemyXPPerAction = vi.fn(() => 100);

        const xpPerHour = display.calculateAlchemyXpPerHour('coinify', '/items/test', {
            successRate: 0.8,
            actionTime: 10,
            efficiency: 0.5,
        });

        expect(display.calculateAlchemyXPPerAction).toHaveBeenCalledWith('coinify', '/items/test', 0.8);
        expect(xpPerHour).toBe(54000);
    });

    test('reattaches the cached inline rate when React replaces only the native Experience row', () => {
        mockGetStateFingerprint.mockReturnValue('same-state');

        const component = document.createElement('div');
        component.className = 'SkillActionDetail_alchemyComponent__test';
        component.innerHTML = `
            <div class="SkillActionDetail_info__test">
                <div class="SkillActionDetail_expOnSuccess__test"><span>100</span></div>
                <div id="existing-toolasha-display"></div>
            </div>
        `;
        document.body.appendChild(component);

        const display = new AlchemyProfitDisplay();
        display.displayElement = component.querySelector('#existing-toolasha-display');
        display.lastFingerprint = 'same-state';
        display.inlineXpPerHour = 49332;

        display.checkAndUpdateDisplay();

        const rate = component.querySelector('[data-mwi-inline-xp-owner="alchemy"]');
        expect(rate?.textContent).toBe('· 49.3K XP/hr');
    });

    test('fails closed when the detailed calculation cannot produce a positive rate', () => {
        const display = Object.create(AlchemyProfitDisplay.prototype);
        display.calculateAlchemyXPPerAction = vi.fn(() => 0);

        expect(
            display.calculateAlchemyXpPerHour('coinify', '/items/test', {
                successRate: 1,
                actionTime: 10,
                efficiency: 0,
            })
        ).toBe(0);
        expect(
            display.calculateAlchemyXpPerHour('coinify', '/items/test', {
                successRate: 1,
                actionTime: 0,
                efficiency: 0,
            })
        ).toBe(0);
    });
});
