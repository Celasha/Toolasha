import { describe, test, expect } from 'vitest';
import { TASK_SKILL_TYPES, getActionSkillType, countActionsBySkillType } from './task-skill-groups.js';

describe('getActionSkillType', () => {
    const gameData = {
        actionDetailMap: {
            '/actions/brewing/brew_beer': { type: '/action_types/brewing' },
            '/actions/combat/gloom_moth': { type: '/action_types/combat' },
            '/actions/labyrinth/explore': { type: '/action_types/labyrinth' },
        },
    };

    test('resolves a recognized skill action to its skill type HRID', () => {
        expect(getActionSkillType('/actions/brewing/brew_beer', gameData)).toBe('/action_types/brewing');
    });

    test('returns null for combat actions (excluded from bulk skill groups)', () => {
        expect(getActionSkillType('/actions/combat/gloom_moth', gameData)).toBeNull();
    });

    test('returns null for a type not in TASK_SKILL_TYPES (e.g. labyrinth)', () => {
        expect(getActionSkillType('/actions/labyrinth/explore', gameData)).toBeNull();
    });

    test('returns null when the action HRID is unknown', () => {
        expect(getActionSkillType('/actions/unknown/thing', gameData)).toBeNull();
    });

    test('returns null when gameData is missing', () => {
        expect(getActionSkillType('/actions/brewing/brew_beer', null)).toBeNull();
    });
});

describe('countActionsBySkillType', () => {
    test('counts actions per skill type and zero-fills skills with no actions', () => {
        const gameData = {
            actionDetailMap: {
                '/actions/brewing/brew_beer': { type: '/action_types/brewing' },
                '/actions/brewing/brew_wine': { type: '/action_types/brewing' },
                '/actions/alchemy/transmute': { type: '/action_types/alchemy' },
                '/actions/combat/gloom_moth': { type: '/action_types/combat' },
            },
        };

        const counts = countActionsBySkillType(gameData);

        expect(counts['/action_types/brewing']).toBe(2);
        expect(counts['/action_types/alchemy']).toBe(1);
        expect(counts['/action_types/milking']).toBe(0);
        expect(Object.keys(counts).sort()).toEqual(Object.keys(TASK_SKILL_TYPES).sort());
    });

    test('returns all-zero counts when gameData is missing', () => {
        const counts = countActionsBySkillType(null);
        expect(Object.values(counts).every((c) => c === 0)).toBe(true);
    });
});
