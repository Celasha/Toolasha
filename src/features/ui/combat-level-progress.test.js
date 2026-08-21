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
    },
}));

const { CombatLevelProgress } = await import('./combat-level-progress.js');
const dataManager = (await import('../../core/data-manager.js')).default;

function skill(hrid, level) {
    return { skillHrid: hrid, level };
}

// Stamina 5, Intelligence 5, Attack 6, Defense 5, Melee 5, Ranged 3, Magic 3 ->
// combatStyleMax=5, primaryMax=6 -> raw = 0.1*(5+5+6+5+5) + 0.5*6 = 2.6 + 3.0 = 5.6
function makeFullSkillSet() {
    return [
        skill('/skills/stamina', 5),
        skill('/skills/intelligence', 5),
        skill('/skills/attack', 6),
        skill('/skills/defense', 5),
        skill('/skills/melee', 5),
        skill('/skills/ranged', 3),
        skill('/skills/magic', 3),
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
                            <span class="NavigationBar_level__3C7eR">5</span>
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
        expect(levelSpan.firstChild.nodeValue).toBe('5'); // native text node untouched

        const companion = document.querySelector('.mwi-combat-level-precise');
        expect(companion).not.toBeNull();
        expect(companion.parentElement).toBe(levelSpan);
        expect(companion.textContent).toBe('.6');
    });

    test('renders an exact-integer raw value with one decimal (N.0), never as a bare integer', () => {
        // stamina+intelligence+attack+defense+max(melee,ranged,magic) with all levels at 1 except
        // attack -> raw = 0.1*(1+1+1+1+1) + 0.5*1 = 0.5 + 0.5 = 1.0 exactly
        dataManager.getSkills.mockReturnValue([
            skill('/skills/stamina', 1),
            skill('/skills/intelligence', 1),
            skill('/skills/attack', 1),
            skill('/skills/defense', 1),
            skill('/skills/melee', 1),
            skill('/skills/ranged', 1),
            skill('/skills/magic', 1),
        ]);
        feature.initialize();

        const companion = document.querySelector('.mwi-combat-level-precise');
        expect(companion.textContent).toBe('.0');
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

    test('a missing level/XP table no longer prevents display - only whole skill levels are needed', () => {
        // No getInitClientData mock at all - the calculation must not depend on it.
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();

        expect(document.querySelector('.mwi-combat-level-precise')).not.toBeNull();
    });

    test('recomputes when dataManager reports a skill/XP update, not on a timer', () => {
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        dataManager.getSkills.mockReturnValue(makeFullSkillSet());
        feature.initialize();

        expect(setIntervalSpy).not.toHaveBeenCalled();

        // Simulate a real whole-skill level-up on attack (not XP progress within a level).
        dataManager.getSkills.mockReturnValue([
            skill('/skills/stamina', 5),
            skill('/skills/intelligence', 5),
            skill('/skills/attack', 8),
            skill('/skills/defense', 5),
            skill('/skills/melee', 5),
            skill('/skills/ranged', 3),
            skill('/skills/magic', 3),
        ]);
        dataManagerHandlers.get('action_completed')();

        const levelSpan = document.querySelector('[class*="NavigationBar_level"]');
        expect(levelSpan.firstChild.nodeValue).toBe('5'); // untouched by re-render, only re-read

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
