import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ clientData: null }));
vi.mock('../../core/data-manager.js', () => ({ default: { getInitClientData: () => mocks.clientData } }));

import { getAbilityTiming, getDotDurationMs } from './ability-effects.js';

describe('getDotDurationMs', () => {
    beforeEach(() => {
        mocks.clientData = {
            abilityDetailMap: {
                '/abilities/firestorm': {
                    abilityEffects: [{ damageOverTimeRatio: 1, damageOverTimeDuration: 6e9 }],
                },
                '/abilities/fireball': {
                    abilityEffects: [{ damageOverTimeRatio: 0, damageOverTimeDuration: 0 }],
                },
                '/abilities/two_effects': {
                    abilityEffects: [
                        { damageOverTimeRatio: 0.5, damageOverTimeDuration: 4e9 },
                        { damageOverTimeRatio: 1, damageOverTimeDuration: 8e9 },
                    ],
                },
            },
        };
    });

    test('is the length of the ability damage over time in ms', () => {
        expect(getDotDurationMs('/abilities/firestorm')).toBe(6000);
    });

    test('uses the longest effect when an ability has several', () => {
        expect(getDotDurationMs('/abilities/two_effects')).toBe(8000);
    });

    test('is 0 for an ability without damage over time, an unknown one, or before game data loads', () => {
        expect(getDotDurationMs('/abilities/fireball')).toBe(0);
        expect(getDotDurationMs('/abilities/nope')).toBe(0);
        expect(getDotDurationMs('')).toBe(0);
        mocks.clientData = null;
        expect(getDotDurationMs('/abilities/firestorm')).toBe(0);
    });
});

describe('getAbilityTiming', () => {
    test('is the mana cost and base cooldown in ms, null for an unknown ability or before data loads', () => {
        mocks.clientData = {
            abilityDetailMap: { '/abilities/shield_bash': { manaCost: 35, cooldownDuration: 12e9 } },
        };

        expect(getAbilityTiming('/abilities/shield_bash')).toEqual({ manaCost: 35, cooldownMs: 12000 });
        expect(getAbilityTiming('/abilities/nope')).toBeNull();
        mocks.clientData = null;
        expect(getAbilityTiming('/abilities/shield_bash')).toBeNull();
    });
});
