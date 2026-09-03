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

describe('TaskRerollProtection — one-time migration from the legacy global cap-protection keys', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
    });

    test('a character with no scoped value yet inherits the legacy global value and persists it as its own', async () => {
        storageData['taskCapProtection'] = true;
        storageData['taskCapCoinThreshold'] = 80000;
        storageData['taskCapCowbellThreshold'] = 2;

        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        await feature.initialize();

        expect(feature.capProtectionEnabled).toBe(true);
        expect(feature.coinThreshold).toBe(80000);
        expect(feature.cowbellThreshold).toBe(2);
        expect(storageData['taskCapProtection_111111']).toBe(true);
        expect(storageData['taskCapCoinThreshold_111111']).toBe(80000);
        expect(storageData['taskCapCowbellThreshold_111111']).toBe(2);
    });

    test('once a character has a scoped value, later changes to the legacy global key no longer affect it', async () => {
        storageData['taskCapProtection'] = true;
        storageData['taskCapCoinThreshold'] = 80000;
        storageData['taskCapCowbellThreshold'] = 2;

        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const first = new TaskRerollProtection();
        await first.initialize(); // migrates and persists the scoped key for 111111

        // Legacy global key changes afterward (e.g. another still-unmigrated character wrote it)
        storageData['taskCapCoinThreshold'] = 160000;

        const reloaded = new TaskRerollProtection();
        await reloaded.initialize();

        expect(reloaded.coinThreshold).toBe(80000); // unaffected by the later legacy-key change
    });

    test('a character with no legacy global value and no scoped value falls back to hardcoded defaults', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('333333');

        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        await feature.initialize();

        expect(feature.capProtectionEnabled).toBe(false);
        expect(feature.coinThreshold).toBe(320000);
        expect(feature.cowbellThreshold).toBe(32);
    });
});

describe('TaskRerollProtection — per-card visual state', () => {
    function makeCard() {
        const card = document.createElement('div');
        card.className = 'RandomTask_randomTask';
        document.body.appendChild(card);
        return card;
    }

    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        document.body.innerHTML = '';

        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockImplementation((key) => key !== 'taskRerollProtection_hideHighlight');
    });

    test('a protected HRID with no other signal gets the green outline', async () => {
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        feature.protectedHrids = new Set(['/actions/combat/gloom_moth']);
        const card = makeCard();
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('76, 175, 80');
    });

    test('a protected HRID that is also flagged elsewhere (e.g. auto-reroll) shows red, not green', async () => {
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        feature.protectedHrids = new Set(['/actions/combat/gloom_moth']);
        const card = makeCard();
        card.dataset.mwiAutoReroll = '1';
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.dataset.mwiProtected).toBe('1');
    });

    test('a protected task with no reroll-worthy signal still blocks the reroll click for 3s', async () => {
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        feature.protectedHrids = new Set(['/actions/combat/gloom_moth']);
        const card = makeCard();
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });
        feature._processTaskCard(card);

        const btn = document.createElement('button');
        btn.textContent = 'Pay 10K';
        card.appendChild(btn);
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        btn.dispatchEvent(clickEvent);

        expect(clickEvent.defaultPrevented).toBe(true);
        expect(card.dataset.mwiRerollLocked).toBe('1');
    });

    test('a reroll-worthy protected task (shown red) no longer blocks the reroll click', async () => {
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        feature.protectedHrids = new Set(['/actions/combat/gloom_moth']);
        const card = makeCard();
        card.dataset.mwiAutoReroll = '1';
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });
        feature._processTaskCard(card);

        const btn = document.createElement('button');
        btn.textContent = 'Pay 10K';
        card.appendChild(btn);
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        btn.dispatchEvent(clickEvent);

        expect(clickEvent.defaultPrevented).toBe(false);
        expect(card.dataset.mwiRerollLocked).not.toBe('1');
    });

    test('a reroll-worthy task still blocks on the cost cap — only the protected-list block is bypassed', async () => {
        const { TaskRerollProtection } = await import('./task-reroll-protection.js');
        const feature = new TaskRerollProtection();
        feature.capProtectionEnabled = true;
        feature.coinThreshold = 10000;
        const card = makeCard();
        card.dataset.mwiTokenFlag = '1';
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/unrelated' });
        feature._processTaskCard(card);

        const btn = document.createElement('button');
        btn.textContent = 'Pay 10K';
        card.appendChild(btn);
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        btn.dispatchEvent(clickEvent);

        expect(clickEvent.defaultPrevented).toBe(true);
        expect(card.dataset.mwiRerollLocked).toBe('1');
    });
});
