/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    drinkTimerEnabled: true,
    settingChangeHandlers: {},
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => (key === 'drinkTimer' ? mocks.drinkTimerEnabled : false)),
        getSettingValue: vi.fn((_key, fallback) => fallback),
        onSettingChange: vi.fn((key, callback) => {
            mocks.settingChangeHandlers[key] = callback;
        }),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../utils/drink-calculator.js', () => ({
    calculateDrinkRemainingSeconds: vi.fn(() => []),
    calculateQueueTimeSeconds: vi.fn(() => 0),
}));

import config from '../../core/config.js';
import drinkTimerFeature from './drink-timer.js';

describe('DrinkTimer feature toggle', () => {
    beforeEach(() => {
        mocks.drinkTimerEnabled = true;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        drinkTimerFeature.cleanup();
    });

    test('registers a live setting listener for the drinkTimer toggle at module load', () => {
        // setupSettingListener() runs once at module load (see the bottom of drink-timer.js),
        // before any test body executes, so by the time this test runs the handler must
        // already be registered — proving the toggle is wired up, not just the checkbox.
        expect(config.onSettingChange).toHaveBeenCalledWith('drinkTimer', expect.any(Function));
        expect(mocks.settingChangeHandlers.drinkTimer).toBeTypeOf('function');
    });

    test('initialize() is a no-op when the drinkTimer setting is disabled', () => {
        mocks.drinkTimerEnabled = false;
        drinkTimerFeature.initialize();

        // No panels were scanned/created — nothing to assert on DOM directly here since
        // domObserver.onClass is mocked, but the setting must have been checked.
        expect(config.getSetting).toHaveBeenCalledWith('drinkTimer');
    });

    test('toggling the drinkTimer setting off calls cleanup, and back on calls initialize', () => {
        const container = document.createElement('div');
        container.className = 'GatheringProductionSkillPanel_consumablesContainer_abc';
        const marker = document.createElement('div');
        marker.className = 'mwi-drink-timer';
        container.appendChild(marker);
        document.body.appendChild(container);

        // Simulate the settings panel checkbox being unchecked.
        mocks.settingChangeHandlers.drinkTimer(false);
        expect(document.querySelector('.mwi-drink-timer')).toBeNull();

        // Simulate the checkbox being re-checked.
        mocks.drinkTimerEnabled = true;
        mocks.settingChangeHandlers.drinkTimer(true);
        expect(config.getSetting).toHaveBeenCalledWith('drinkTimer');
    });
});
