/**
 * Tests for TaskTokenThreshold — automatic reroll-reminder classification by Task Token reward.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const storageData = {};

const mockParseTaskData = vi.fn();

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
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('./task-profit-display.js', () => ({
    default: { parseTaskData: mockParseTaskData },
}));

function makeCard() {
    const card = document.createElement('div');
    card.className = 'RandomTask_randomTask';
    document.body.appendChild(card);
    return card;
}

describe('TaskTokenThreshold — storage is character-scoped', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        mockParseTaskData.mockReset();
    });

    test('saves the threshold under a key scoped to the current character', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskTokenThreshold } = await import('./task-token-threshold.js');
        const feature = new TaskTokenThreshold();
        await feature.setThreshold(8);

        expect(storageData['taskTokenThreshold_value_111111']).toBe(8);
    });

    test('a second character does not inherit the first character saved threshold', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;

        dataManager.getCurrentCharacterId.mockReturnValue('111111');
        const { TaskTokenThreshold } = await import('./task-token-threshold.js');
        const charOne = new TaskTokenThreshold();
        await charOne.setThreshold(8);

        dataManager.getCurrentCharacterId.mockReturnValue('222222');
        const charTwo = new TaskTokenThreshold();
        await charTwo.initialize();

        expect(charTwo.threshold).toBeNull();
    });

    test('re-initializing as the original character reloads its own saved threshold', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskTokenThreshold } = await import('./task-token-threshold.js');
        const charOne = new TaskTokenThreshold();
        await charOne.setThreshold(8);

        const reloaded = new TaskTokenThreshold();
        await reloaded.initialize();

        expect(reloaded.threshold).toBe(8);
    });

    test('saves and reloads the "above" direction alongside the threshold, scoped per character', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskTokenThreshold } = await import('./task-token-threshold.js');
        const charOne = new TaskTokenThreshold();
        await charOne.setThreshold(8, 'above');

        expect(storageData['taskTokenThreshold_direction_111111']).toBe('above');

        const reloaded = new TaskTokenThreshold();
        await reloaded.initialize();

        expect(reloaded.direction).toBe('above');
    });
});

describe('TaskTokenThreshold — per-card classification', () => {
    let feature;

    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        mockParseTaskData.mockReset();
        document.body.innerHTML = '';

        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { TaskTokenThreshold } = await import('./task-token-threshold.js');
        feature = new TaskTokenThreshold();
        feature.threshold = 8;
    });

    test('a card below the threshold gets the red outline and "Low tokens!" badge', () => {
        mockParseTaskData.mockReturnValue({ taskTokenReward: 5 });
        const card = makeCard();

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('Low tokens!');
    });

    test('a card at or above the threshold gets neither the outline nor the badge', () => {
        mockParseTaskData.mockReturnValue({ taskTokenReward: 9 });
        const card = makeCard();

        feature._processTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('a previously-flagged card that no longer qualifies has its outline and badge cleared', () => {
        mockParseTaskData.mockReturnValue({ taskTokenReward: 5 });
        const card = makeCard();
        feature._processTaskCard(card);
        expect(card.querySelector('.mwi-token-badge')).not.toBeNull();

        mockParseTaskData.mockReturnValue({ taskTokenReward: 20 });
        feature._processTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('a task that is manually protected is still flagged when it qualifies (reroll signal overrides protection)', () => {
        mockParseTaskData.mockReturnValue({ taskTokenReward: 5 });
        const card = makeCard();
        card.dataset.mwiProtected = '1';

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('Low tokens!');
    });

    test('a card with an active manual auto-reroll signal shows the "Reroll!" badge instead of the token badge', () => {
        mockParseTaskData.mockReturnValue({ taskTokenReward: 5 });
        const card = makeCard();
        card.dataset.mwiAutoReroll = '1';

        feature._processTaskCard(card);

        expect(card.querySelector('.mwi-token-badge')).toBeNull();
        expect(card.querySelector('.mwi-autoreroll-badge')?.textContent).toBe('Reroll!');
        expect(card.style.outline).toContain('239, 68, 68');
    });

    test('parseTaskData returning null is a no-op, not a crash', () => {
        mockParseTaskData.mockReturnValue(null);
        const card = makeCard();

        expect(() => feature._processTaskCard(card)).not.toThrow();
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('no threshold configured yet means no card is ever flagged', () => {
        feature.threshold = null;
        mockParseTaskData.mockReturnValue({ taskTokenReward: 0 });
        const card = makeCard();

        feature._processTaskCard(card);

        expect(mockParseTaskData).not.toHaveBeenCalled();
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('"above" direction flags a card whose reward exceeds the cutoff with "High tokens!"', () => {
        feature.direction = 'above';
        mockParseTaskData.mockReturnValue({ taskTokenReward: 20 });
        const card = makeCard();

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('High tokens!');
    });

    test('"above" direction does not flag a card whose reward is at or below the cutoff', () => {
        feature.direction = 'above';
        mockParseTaskData.mockReturnValue({ taskTokenReward: 5 });
        const card = makeCard();

        feature._processTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('switching direction updates the badge text on an already-flagged card', () => {
        mockParseTaskData.mockReturnValue({ taskTokenReward: 5 });
        const card = makeCard();
        feature._processTaskCard(card);
        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('Low tokens!');

        feature.direction = 'above';
        mockParseTaskData.mockReturnValue({ taskTokenReward: 20 });
        feature._processTaskCard(card);

        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('High tokens!');
    });
});
