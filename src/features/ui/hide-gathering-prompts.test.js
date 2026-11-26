/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { handlers, state } = vi.hoisted(() => ({
    handlers: new Map(),
    state: { enabled: true, tutorial: false },
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => state.enabled) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn((event, handler) => handlers.set(event, handler)),
        off: vi.fn((event) => handlers.delete(event)),
        hasTutorialQuest: vi.fn(() => state.tutorial),
    },
}));

const { default: hideGatheringPrompts, NAV_CSS } = await import('./hide-gathering-prompts.js');

function navLink(skill) {
    return `
        <div class="NavigationBar_navigationLink__3eAHA">
            <div class="NavigationBar_nav__3uuUl">
                <svg><use href="/static/media/skills_sprite.3bb4d936.svg#${skill}"></use></svg>
                <div class="NavigationBar_contentContainer__1x6WS">
                    <div class="NavigationBar_textContainer__7TdaI">
                        <span class="NavigationBar_label__1uH-y">${skill}</span>
                        <span class="mwi-exp-percentage">94.8%</span>
                        <span class="NavigationBar_level__3C7eR">100</span>
                    </div>
                    <div class="NavigationBar_experienceBar__2fo3Q">
                        <div class="NavigationBar_currentExperience__3GDeX"></div>
                        <span class="mwi-remaining-xp">72.57K XP left</span>
                    </div>
                </div>
            </div>
        </div>`;
}

// Whether any selector of a comma-separated list matches the element
function matches(selectorList, element) {
    return selectorList.split(',').some((selector) => element.matches(selector.trim()));
}

describe('hideGatheringPrompts', () => {
    beforeEach(() => {
        state.enabled = true;
        state.tutorial = false;
        handlers.clear();
        document.head.innerHTML = '';
        document.body.innerHTML = ['milking', 'foraging', 'woodcutting', 'cheesesmithing'].map(navLink).join('');
    });

    afterEach(() => {
        hideGatheringPrompts.disable();
    });

    test('adds nothing while the setting is off', () => {
        state.enabled = false;
        hideGatheringPrompts.initialize();

        expect(document.head.querySelectorAll('style')).toHaveLength(0);
        expect(handlers.size).toBe(0);
    });

    test('hides the XP readouts of the gathering skills only', () => {
        hideGatheringPrompts.initialize();
        const links = document.querySelectorAll('[class*="NavigationBar_navigationLink"]');
        const bars = [...links].map((link) => link.querySelector('[class*="NavigationBar_experienceBar"]'));
        const percentages = [...links].map((link) => link.querySelector('.mwi-exp-percentage'));
        const levels = [...links].map((link) => link.querySelector('[class*="NavigationBar_level"]'));

        expect(bars.map((el) => matches(NAV_CSS.split('{')[0], el))).toEqual([true, true, true, false]);
        expect(percentages.map((el) => matches(NAV_CSS.split('{')[0], el))).toEqual([true, true, true, false]);
        // The level number stays
        expect(levels.some((el) => matches(NAV_CSS.split('{')[0], el))).toBe(false);
        expect(document.getElementById('mwi-hide-gathering-prompts-nav')).not.toBeNull();
    });

    test('hides the tutorial quest only while a tutorial quest is unfinished', () => {
        state.tutorial = true;
        hideGatheringPrompts.initialize();
        expect(document.getElementById('mwi-hide-gathering-prompts-tutorial')).not.toBeNull();

        state.tutorial = false;
        handlers.get('quests_updated')();
        expect(document.getElementById('mwi-hide-gathering-prompts-tutorial')).toBeNull();

        state.tutorial = true;
        handlers.get('quests_updated')();
        handlers.get('quests_updated')();
        expect(document.querySelectorAll('#mwi-hide-gathering-prompts-tutorial')).toHaveLength(1);
    });

    test('does not hide the tutorial quest for a character past the tutorial', () => {
        hideGatheringPrompts.initialize();
        expect(document.getElementById('mwi-hide-gathering-prompts-tutorial')).toBeNull();
    });

    test('disable removes the styles and the listener', () => {
        state.tutorial = true;
        hideGatheringPrompts.initialize();
        hideGatheringPrompts.disable();

        expect(document.head.querySelectorAll('style')).toHaveLength(0);
        expect(handlers.has('quests_updated')).toBe(false);
    });
});
