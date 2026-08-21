/**
 * Tests for TaskRerollProtection cap-protection storage scoping.
 *
 * Regression coverage: "Block rerolls at" (coin/cowbell cap thresholds) used bare,
 * non-character-scoped storage keys, so changing it on one character silently changed it
 * for every other character on the next character switch/refresh.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const storageData = {};

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getCurrentCharacterId: vi.fn(() => '111111') },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        get: vi.fn(async (key, _area, defaultValue) => storageData[key] ?? defaultValue),
        set: vi.fn(async (key, value) => {
            storageData[key] = value;
        }),
        getJSON: vi.fn(async (key, _area, defaultValue) => storageData[key] ?? defaultValue),
        setJSON: vi.fn(async (key, value) => {
            storageData[key] = value;
        }),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

describe('TaskRerollProtection — cap protection storage is character-scoped', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
    });

    test('saves cap protection settings under keys scoped to the current character, not global keys', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        feature.capProtectionEnabled = true;
        feature.coinThreshold = 80000;
        feature.cowbellThreshold = 2;

        await feature._saveCapProtection();

        expect(storageData['taskCapProtection_111111']).toBe(true);
        expect(storageData['taskCapCoinThreshold_111111']).toBe(80000);
        expect(storageData['taskCapCowbellThreshold_111111']).toBe(2);
        expect(storageData['taskCapProtection']).toBeUndefined();
        expect(storageData['taskCapCoinThreshold']).toBeUndefined();
        expect(storageData['taskCapCowbellThreshold']).toBeUndefined();
    });

    test('a second character does not inherit the first character saved cap thresholds', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;

        dataManager.getCurrentCharacterId.mockReturnValue('111111');
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const charOne = new TaskRerollProtection();
        charOne.capProtectionEnabled = true;
        charOne.coinThreshold = 80000;
        charOne.cowbellThreshold = 2;
        await charOne._saveCapProtection();

        dataManager.getCurrentCharacterId.mockReturnValue('222222');
        const charTwo = new TaskRerollProtection();
        await charTwo.initialize();

        expect(charTwo.capProtectionEnabled).toBe(false);
        expect(charTwo.coinThreshold).toBe(320000);
        expect(charTwo.cowbellThreshold).toBe(32);
    });

    test('re-initializing as the original character reloads its own saved cap thresholds', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;

        dataManager.getCurrentCharacterId.mockReturnValue('111111');
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const charOne = new TaskRerollProtection();
        charOne.capProtectionEnabled = true;
        charOne.coinThreshold = 80000;
        charOne.cowbellThreshold = 2;
        await charOne._saveCapProtection();

        const reloaded = new TaskRerollProtection();
        await reloaded.initialize();

        expect(reloaded.capProtectionEnabled).toBe(true);
        expect(reloaded.coinThreshold).toBe(80000);
        expect(reloaded.cowbellThreshold).toBe(2);
    });
});
