/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    riskOfRuinEnabled: true,
    settingChangeHandlers: {},
}));

vi.mock('../../core/config.js', () => ({
    default: {
        Z_FLOATING_PANEL: 1000,
        getSetting: vi.fn((key) => (key === 'riskOfRuin' ? mocks.riskOfRuinEnabled : false)),
        getSettingValue: vi.fn((_key, fallback) => fallback),
        onSettingChange: vi.fn((key, callback) => {
            mocks.settingChangeHandlers[key] = callback;
        }),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
        getItemDetails: vi.fn(() => null),
        getInventory: vi.fn(() => []),
    },
}));

const { PANEL_ID, LAUNCHER_ID } = vi.hoisted(() => ({
    PANEL_ID: 'mwi-risk-of-ruin-panel',
    LAUNCHER_ID: 'mwi-risk-of-ruin-launcher',
}));

import config from '../../core/config.js';
import riskOfRuinUI from './risk-of-ruin-ui.js';

describe('RiskOfRuinUI feature toggle', () => {
    beforeEach(() => {
        mocks.riskOfRuinEnabled = true;
        document.body.innerHTML = '';
        riskOfRuinUI.disable();
    });

    afterEach(() => {
        riskOfRuinUI.disable();
    });

    test('registers a live setting listener for the riskOfRuin toggle at module load', () => {
        // setupSettingListener() runs once at module load (see the bottom of
        // risk-of-ruin-ui.js), before any test body executes, so by the time this test runs
        // the handler must already be registered - proving the toggle is wired up live, not
        // just read once at startup (which previously required a page refresh to take effect).
        expect(config.onSettingChange).toHaveBeenCalledWith('riskOfRuin', expect.any(Function));
        expect(mocks.settingChangeHandlers.riskOfRuin).toBeTypeOf('function');
    });

    test('initialize() is a no-op when the riskOfRuin setting is disabled', () => {
        mocks.riskOfRuinEnabled = false;
        riskOfRuinUI.initialize();

        expect(document.getElementById(PANEL_ID)).toBeNull();
        expect(document.getElementById(LAUNCHER_ID)).toBeNull();
    });

    test('toggling the riskOfRuin setting off removes the panel and launcher with no refresh', () => {
        riskOfRuinUI.initialize();
        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        expect(document.getElementById(LAUNCHER_ID)).not.toBeNull();

        // Simulate the settings panel checkbox being unchecked.
        mocks.settingChangeHandlers.riskOfRuin(false);

        expect(document.getElementById(PANEL_ID)).toBeNull();
        expect(document.getElementById(LAUNCHER_ID)).toBeNull();
    });

    test('toggling the riskOfRuin setting back on rebuilds the panel and launcher', () => {
        riskOfRuinUI.initialize();
        mocks.settingChangeHandlers.riskOfRuin(false);
        expect(document.getElementById(LAUNCHER_ID)).toBeNull();

        // Simulate the checkbox being re-checked - this is the live listener's other branch,
        // not feature-registry's own startup pass, which never re-runs mid-session.
        mocks.riskOfRuinEnabled = true;
        mocks.settingChangeHandlers.riskOfRuin(true);

        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        expect(document.getElementById(LAUNCHER_ID)).not.toBeNull();
    });
});

describe('_chestDepthCapItems (EV-share cost attribution)', () => {
    test('attributes costPerAction to each item in proportion to its share of total expected value', () => {
        const dropBreakdown = [
            { itemHrid: '/items/a', dropRate: 1, avgCount: 2, hasPriceData: true, expectedValue: 200 },
            { itemHrid: '/items/b', dropRate: 0.5, avgCount: 4, hasPriceData: true, expectedValue: 300 },
        ];

        const items = riskOfRuinUI._chestDepthCapItems(dropBreakdown, 500);

        expect(items).toEqual([
            { itemHrid: '/items/a', quantityPerAction: 2, costShare: 200 },
            { itemHrid: '/items/b', quantityPerAction: 2, costShare: 300 },
        ]);
    });

    test('excludes items with no resolvable price, a zero dropRate, or a zero avgCount', () => {
        const dropBreakdown = [
            { itemHrid: '/items/a', dropRate: 1, avgCount: 2, hasPriceData: true, expectedValue: 200 },
            { itemHrid: '/items/no-price', dropRate: 1, avgCount: 1, hasPriceData: false, expectedValue: 0 },
            { itemHrid: '/items/no-drop', dropRate: 0, avgCount: 5, hasPriceData: true, expectedValue: 999 },
            { itemHrid: '/items/no-count', dropRate: 1, avgCount: 0, hasPriceData: true, expectedValue: 999 },
        ];

        const items = riskOfRuinUI._chestDepthCapItems(dropBreakdown, 500);

        expect(items).toEqual([{ itemHrid: '/items/a', quantityPerAction: 2, costShare: 500 }]);
    });

    test('a single tracked item gets the full costPerAction as its costShare, exactly reproducing the original formula', () => {
        const dropBreakdown = [
            { itemHrid: '/items/a', dropRate: 1, avgCount: 2, hasPriceData: true, expectedValue: 12345 },
        ];

        const items = riskOfRuinUI._chestDepthCapItems(dropBreakdown, 100);

        expect(items).toEqual([{ itemHrid: '/items/a', quantityPerAction: 2, costShare: 100 }]);
    });

    test('falls back to the full costPerAction per item when total expected value is zero', () => {
        const dropBreakdown = [
            { itemHrid: '/items/a', dropRate: 1, avgCount: 1, hasPriceData: true, expectedValue: 0 },
            { itemHrid: '/items/b', dropRate: 1, avgCount: 1, hasPriceData: true, expectedValue: 0 },
        ];

        const items = riskOfRuinUI._chestDepthCapItems(dropBreakdown, 500);

        expect(items).toEqual([
            { itemHrid: '/items/a', quantityPerAction: 1, costShare: 500 },
            { itemHrid: '/items/b', quantityPerAction: 1, costShare: 500 },
        ]);
    });
});

describe('_alchemyDepthCapItems (EV-share cost attribution)', () => {
    function breakdown({ mainBranches = [], bonusDrops = [], successRate = 1 } = {}) {
        return { successRate, mainBranches, bonusDrops };
    }

    test('attributes costPerAction across main branches and bonus drops by their share of expected value', () => {
        const data = breakdown({
            successRate: 0.5,
            mainBranches: [{ itemHrid: '/items/a', dropRate: 1, count: 2, payout: 400, isSelfReturn: false }],
            bonusDrops: [{ itemHrid: '/items/b', dropRate: 0.5, count: 1, payout: 600 }],
        });
        // a: expectedValue = payout * successRate * dropRate = 400 * 0.5 * 1 = 200
        // b: expectedValue = payout * dropRate = 600 * 0.5 = 300
        // totalEV = 500

        const items = riskOfRuinUI._alchemyDepthCapItems(data, 500);

        expect(items).toEqual([
            { itemHrid: '/items/a', quantityPerAction: 1, costShare: 200 },
            { itemHrid: '/items/b', quantityPerAction: 0.5, costShare: 300 },
        ]);
    });

    test('excludes self-return branches, zero-count branches/bonuses, and zero-expected-value candidates', () => {
        const data = breakdown({
            successRate: 1,
            mainBranches: [
                { itemHrid: '/items/self-return', dropRate: 1, count: 1, payout: 999, isSelfReturn: true },
                { itemHrid: '/items/zero-count', dropRate: 1, count: 0, payout: 999, isSelfReturn: false },
                { itemHrid: '/items/zero-payout', dropRate: 1, count: 1, payout: 0, isSelfReturn: false },
                { itemHrid: '/items/kept', dropRate: 1, count: 1, payout: 500, isSelfReturn: false },
            ],
            bonusDrops: [{ itemHrid: '/items/zero-bonus-count', dropRate: 1, count: 0, payout: 999 }],
        });

        const items = riskOfRuinUI._alchemyDepthCapItems(data, 500);

        expect(items).toEqual([{ itemHrid: '/items/kept', quantityPerAction: 1, costShare: 500 }]);
    });

    test('a single tracked item gets the full costPerAction as its costShare, exactly reproducing the original formula', () => {
        const data = breakdown({
            successRate: 1,
            mainBranches: [{ itemHrid: '/items/a', dropRate: 1, count: 3, payout: 42, isSelfReturn: false }],
        });

        const items = riskOfRuinUI._alchemyDepthCapItems(data, 100);

        expect(items).toEqual([{ itemHrid: '/items/a', quantityPerAction: 3, costShare: 100 }]);
    });
});
