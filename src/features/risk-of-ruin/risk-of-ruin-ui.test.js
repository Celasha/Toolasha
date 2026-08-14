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
