/* @vitest-environment jsdom */

/**
 * Tests that the sidebar XP/hr rate honors the shared black text border setting
 * independently of the Remaining XP feature.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const settingsMap = {};

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_XP_RATE: '#0f0',
        COLOR_HOURS_TO_LEVEL: '#fff',
        getSetting: (key, fallback) => settingsMap[key] ?? fallback,
    },
}));
vi.mock('../../core/data-manager.js', () => ({ default: {} }));
vi.mock('../../core/storage.js', () => ({ default: {} }));
vi.mock('../../core/dom-observer.js', () => ({ default: {} }));
vi.mock('../../core/websocket.js', () => ({ default: {} }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../utils/game-lookups.js', () => ({ getSkillHridFromIconHref: () => '/skills/attack' }));

import { XPTracker } from './xp-tracker.js';

function buildNav({ withRemainingXp }) {
    document.body.innerHTML = `
        <div class="NavigationBar_nav__x">
            <svg><use href="skills_sprite.svg#attack"></use></svg>
            <div class="NavigationBar_container">
                <div class="NavigationBar_currentExperience__x"></div>
                ${withRemainingXp ? '<span class="mwi-remaining-xp"></span>' : ''}
            </div>
        </div>`;
}

function makeTracker() {
    const tracker = new XPTracker();
    tracker.xpHistory.attack = [];
    tracker.combatSession.attack = { startExp: 0, lastExp: 1000, startTime: Date.now() - 3600000 };
    return tracker;
}

describe('XPTracker sidebar rate text border', () => {
    beforeEach(() => {
        for (const key of Object.keys(settingsMap)) delete settingsMap[key];
    });

    test('applies the black border when Remaining XP is off', () => {
        buildNav({ withRemainingXp: false });
        makeTracker()._updateNavBars();
        const rate = document.querySelector('.mwi-xp-rate');
        expect(rate).not.toBeNull();
        expect(rate.style.textShadow).toContain('#000');
    });

    test('applies the black border when Remaining XP is on', () => {
        buildNav({ withRemainingXp: true });
        makeTracker()._updateNavBars();
        expect(document.querySelector('.mwi-xp-rate').style.textShadow).toContain('#000');
    });

    test('omits the border when the setting is off', () => {
        settingsMap.skillRemainingXP_blackBorder = false;
        buildNav({ withRemainingXp: false });
        makeTracker()._updateNavBars();
        expect(document.querySelector('.mwi-xp-rate').style.textShadow).toBe('');
    });
});
