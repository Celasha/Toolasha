/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { observerCallbacks, mockOnClass, dataManagerHandlers } = vi.hoisted(() => {
    const observerCallbacks = new Map();
    const mockOnClass = vi.fn((id, _className, callback) => {
        observerCallbacks.set(id, callback);
        return vi.fn(() => observerCallbacks.delete(id));
    });
    return { observerCallbacks, mockOnClass, dataManagerHandlers: new Map() };
});

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: mockOnClass },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        isFeatureEnabled: vi.fn(() => true),
        onSettingChange: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn((event, handler) => dataManagerHandlers.set(event, handler)),
        off: vi.fn((event) => dataManagerHandlers.delete(event)),
        getSkills: vi.fn(),
        getInitClientData: vi.fn(),
    },
}));

const { CombatLevelProgress } = await import('./combat-level-progress.js');
const dataManager = (await import('../../core/data-manager.js')).default;

const TABLE = [0, 0, 33, 76, 132, 202, 286, 386, 503, 637, 791, 964, 1159];

function skill(hrid, level, experience) {
    return { skillHrid: hrid, level, experience };
}

function makeFullSkillSet() {
    return [
        skill('/skills/stamina', 5, TABLE[5]),
        skill('/skills/intelligence', 5, TABLE[5]),
        skill('/skills/attack', 6, TABLE[6]),
        skill('/skills/defense', 5, TABLE[5]),
        skill('/skills/melee', 5, TABLE[5]),
        skill('/skills/ranged', 3, TABLE[3]),
        skill('/skills/magic', 3, TABLE[3]),
    ];
}

function buildNavBarFixture() {
    document.body.innerHTML = `
        <div class="NavigationBar_navigationBar__1gRln">
            <div class="NavigationBar_navigationLink__3eAHA">
                <div class="NavigationBar_nav__3uuUl">
                    <svg aria-label="navigationBar.combat"><use href="#combat"></use></svg>
                    <div class="NavigationBar_contentContainer__1x6WS">
                        <div class="NavigationBar_textContainer__7TdaI">
                            <span class="NavigationBar_label__1uH-y">Combat</span>
                            <span class="NavigationBar_level__3C7eR">6</span>
                        </div>
                    </div>
                </div>
                <div class="NavigationBar_subSkills__37qWb">
                    <div class="NavigationBar_nav__3uuUl">
                        <svg aria-label="Icon"><use href="#stamina"></use></svg>
                        <div class="NavigationBar_contentContainer__1x6WS">
                            <div class="NavigationBar_textContainer__7TdaI">
                                <span class="NavigationBar_label__1uH-y">Stamina</span>
                                <span class="NavigationBar_level__3C7eR">5</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

describe('CombatLevelProgress', () => {
    let feature;

    beforeEach(() => {
        observerCallbacks.clear();
        mockOnClass.mockClear();
        dataManagerHandlers.clear();
        dataManager.getSkills.mockReset();
        dataManager.getInitClientData.mockReset().mockReturnValue({ levelExperienceTable: TABLE });
        buildNavBarFixture();
        feature = new CombatLevelProgress();
    });

    afterEach(() => {
        feature.disable();
        document.body.innerHTML = '';
    });

    test('appends inside the native Combat level span so it reads flush, never overwriting the native text node', () => {
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();

        const levelSpan = document.querySelector('[class*="NavigationBar_level"]');
        expect(levelSpan.firstChild.nodeValue).toBe('6'); // native text node untouched

        const companion = document.querySelector('.mwi-combat-level-precise');
        expect(companion).not.toBeNull();
        expect(companion.parentElement).toBe(levelSpan);
        expect(companion.textContent).toMatch(/^\.\d{2}$/);
    });

    test('finds the Combat row via the stable aria-label icon anchor, not the sub-skill rows', () => {
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();

        // Only one companion span exists, and it is inside the Combat row's own
        // textContainer, not the Stamina sub-skill row's textContainer.
        const companions = document.querySelectorAll('.mwi-combat-level-precise');
        expect(companions.length).toBe(1);

        const staminaTextContainer = document
            .querySelector('.NavigationBar_subSkills__37qWb')
            .querySelector('[class*="NavigationBar_textContainer"]');
        expect(staminaTextContainer.querySelector('.mwi-combat-level-precise')).toBeNull();
    });

    test('removes the companion span when required data becomes unavailable (e.g. character switching)', () => {
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();
        expect(document.querySelector('.mwi-combat-level-precise')).not.toBeNull();

        dataManager.getSkills.mockReturnValue(null);
        feature.update();

        expect(document.querySelector('.mwi-combat-level-precise')).toBeNull();
    });

    test('recomputes when dataManager reports a skill/XP update, not on a timer', () => {
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();

        expect(setIntervalSpy).not.toHaveBeenCalled();

        // Simulate a combat XP gain: attack levels up further
        dataManager.getSkills.mockReturnValue([
            skill('/skills/stamina', 5, TABLE[5]),
            skill('/skills/intelligence', 5, TABLE[5]),
            skill('/skills/attack', 8, TABLE[8]),
            skill('/skills/defense', 5, TABLE[5]),
            skill('/skills/melee', 5, TABLE[5]),
            skill('/skills/ranged', 3, TABLE[3]),
            skill('/skills/magic', 3, TABLE[3]),
        ]);
        dataManagerHandlers.get('action_completed')();

        const levelSpan = document.querySelector('[class*="NavigationBar_level"]');
        expect(levelSpan.firstChild.nodeValue).toBe('6'); // untouched by re-render, only re-read

        setIntervalSpy.mockRestore();
    });

    test('disable() removes injected spans and unsubscribes from dataManager events', () => {
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();
        expect(document.querySelector('.mwi-combat-level-precise')).not.toBeNull();

        feature.disable();

        expect(document.querySelector('.mwi-combat-level-precise')).toBeNull();
        expect(dataManagerHandlers.has('action_completed')).toBe(false);
        expect(dataManagerHandlers.has('skills_updated')).toBe(false);
        expect(dataManagerHandlers.has('character_initialized')).toBe(false);
    });

    test('does nothing when the feature setting is disabled', async () => {
        const config = (await import('../../core/config.js')).default;
        config.isFeatureEnabled.mockReturnValue(false);
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());

        feature.initialize();

        expect(document.querySelector('.mwi-combat-level-precise')).toBeNull();
        config.isFeatureEnabled.mockReturnValue(true);
    });
});
