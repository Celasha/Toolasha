/**
 * Tests for TaskAutoReroll — manual per-HRID reroll-reminder classification.
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
        getJSON: vi.fn(async (key, _area, defaultValue) => storageData[key] ?? defaultValue),
        setJSON: vi.fn(async (key, value) => {
            storageData[key] = value;
        }),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

function makeCard() {
    const card = document.createElement('div');
    card.className = 'RandomTask_randomTask';
    document.body.appendChild(card);
    return card;
}

describe('TaskAutoReroll — per-card classification', () => {
    let feature;

    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        document.body.innerHTML = '';

        const { TaskAutoReroll } = await import('./task-auto-reroll.js');
        feature = new TaskAutoReroll();
        feature.autoRerollHrids = new Set(['/actions/combat/gloom_moth']);
    });

    test('a listed HRID gets the red outline and "Reroll!" badge', () => {
        const card = makeCard();
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-autoreroll-badge')?.textContent).toBe('Reroll!');
    });

    test('an unlisted HRID gets neither the outline nor the badge', () => {
        const card = makeCard();
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/other' });

        feature._processTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
    });

    test('a listed HRID still shows the red border even when the card is manually protected', () => {
        const card = makeCard();
        card.dataset.mwiProtected = '1';
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });

        feature._processTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-autoreroll-badge')?.textContent).toBe('Reroll!');
    });

    test('a previously-flagged card that is unlisted after a toggle falls back to no border', () => {
        const card = makeCard();
        const spy = vi
            .spyOn(feature, '_getQuestFromCard')
            .mockReturnValue({ actionHrid: '/actions/combat/gloom_moth' });
        feature._processTaskCard(card);
        expect(card.querySelector('.mwi-autoreroll-badge')).not.toBeNull();

        spy.mockReturnValue({ actionHrid: '/actions/combat/other' });
        feature._processTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
    });

    test('toggleHrid saves the updated list under a character-scoped key', async () => {
        const card = makeCard();
        vi.spyOn(feature, '_getQuestFromCard').mockReturnValue({ actionHrid: '/actions/combat/new_target' });

        await feature.toggleHrid('/actions/combat/new_target');

        expect(storageData['taskAutoRerollHrids_111111']).toContain('/actions/combat/new_target');
        feature._processTaskCard(card);
        expect(card.querySelector('.mwi-autoreroll-badge')).not.toBeNull();
    });
});
