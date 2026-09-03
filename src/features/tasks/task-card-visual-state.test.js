/**
 * Tests for the shared task-card border/badge repaint used by Task Reroll Protection, Task
 * Auto-Reroll Reminder, and Task Token Threshold.
 *
 * Regression coverage: a reroll-worthy signal (manual auto-reroll list match, or token threshold
 * qualifying) must always win the red border/badge, even over manual protection's green border,
 * regardless of which feature's DOM hook last repainted the card.
 */

/* @vitest-environment jsdom */

import { describe, test, expect } from 'vitest';
import { repaintTaskCard } from './task-card-visual-state.js';

function makeCard() {
    return document.createElement('div');
}

describe('repaintTaskCard', () => {
    test('no signals set means no outline and no badge', () => {
        const card = makeCard();
        repaintTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('protected alone shows the green outline and no badge', () => {
        const card = makeCard();
        card.dataset.mwiProtected = '1';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('76, 175, 80');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('at cap alone shows the orange outline and no badge', () => {
        const card = makeCard();
        card.dataset.mwiAtCap = '1';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('251, 146, 60');
    });

    test('protected takes precedence over at-cap when both are set', () => {
        const card = makeCard();
        card.dataset.mwiProtected = '1';
        card.dataset.mwiAtCap = '1';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('76, 175, 80');
    });

    test('manual auto-reroll alone shows the red outline and "Reroll!" badge', () => {
        const card = makeCard();
        card.dataset.mwiAutoReroll = '1';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-autoreroll-badge')?.textContent).toBe('Reroll!');
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('token threshold alone shows the red outline and its own badge text', () => {
        const card = makeCard();
        card.dataset.mwiTokenFlag = '1';
        card.dataset.mwiTokenFlagText = 'High tokens!';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('High tokens!');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
    });

    test('a reroll-worthy signal wins the red border over manual protection', () => {
        const card = makeCard();
        card.dataset.mwiProtected = '1';
        card.dataset.mwiTokenFlag = '1';
        card.dataset.mwiTokenFlagText = 'Low tokens!';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
        expect(card.querySelector('.mwi-token-badge')?.textContent).toBe('Low tokens!');
    });

    test('a reroll-worthy signal wins the red border over the reroll cap', () => {
        const card = makeCard();
        card.dataset.mwiAtCap = '1';
        card.dataset.mwiAutoReroll = '1';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('239, 68, 68');
    });

    test('manual auto-reroll badge text wins over the token badge when both signals are active', () => {
        const card = makeCard();
        card.dataset.mwiAutoReroll = '1';
        card.dataset.mwiTokenFlag = '1';
        card.dataset.mwiTokenFlagText = 'Low tokens!';
        repaintTaskCard(card);

        expect(card.querySelector('.mwi-autoreroll-badge')?.textContent).toBe('Reroll!');
        expect(card.querySelector('.mwi-token-badge')).toBeNull();
    });

    test('clearing all signals after a red state removes the outline and badge', () => {
        const card = makeCard();
        card.dataset.mwiAutoReroll = '1';
        repaintTaskCard(card);
        expect(card.querySelector('.mwi-autoreroll-badge')).not.toBeNull();

        card.dataset.mwiAutoReroll = '';
        repaintTaskCard(card);

        expect(card.style.outline).toBe('');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
    });

    test('dropping from red to green (still protected) repaints the outline color, not just clears it', () => {
        const card = makeCard();
        card.dataset.mwiProtected = '1';
        card.dataset.mwiAutoReroll = '1';
        repaintTaskCard(card);
        expect(card.style.outline).toContain('239, 68, 68');

        card.dataset.mwiAutoReroll = '';
        repaintTaskCard(card);

        expect(card.style.outline).toContain('76, 175, 80');
        expect(card.querySelector('.mwi-autoreroll-badge')).toBeNull();
    });
});
