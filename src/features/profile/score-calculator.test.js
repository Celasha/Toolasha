import { describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    enhancingParams: { enhancingLevel: 50 },
    house: {
        combat: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        skiller: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
    },
    ability: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
    shrine: {
        combat: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        skiller: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
    },
    equipment: {
        combat: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        skiller: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        hasEquipmentData: true,
    },
}));

vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn(() => mocks.enhancingParams) }));
vi.mock('./score/house-score.js', () => ({ calculateHouseScore: vi.fn(() => mocks.house) }));
vi.mock('./score/ability-score.js', () => ({ calculateAbilityScore: vi.fn(() => mocks.ability) }));
vi.mock('./score/shrine-score.js', () => ({ calculateShrineScore: vi.fn(() => mocks.shrine) }));
vi.mock('./score/equipment-score.js', () => ({ calculateEquipmentScore: vi.fn(() => mocks.equipment) }));

import { calculateCombatScore } from './score-calculator.js';

function resetToComplete() {
    mocks.house = {
        combat: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        skiller: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
    };
    mocks.ability = { score: 0, complete: true, unpricedCount: 0, breakdown: [] };
    mocks.shrine = {
        combat: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        skiller: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
    };
    mocks.equipment = {
        combat: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        skiller: { score: 0, complete: true, unpricedCount: 0, breakdown: [] },
        hasEquipmentData: true,
    };
}

describe('calculateCombatScore - composition and backward-compatible shape', () => {
    test('total/house/ability/equipment/skillerTotal/skillerEquipment stay plain numbers (character-card-button.js compatibility)', async () => {
        resetToComplete();
        mocks.house.combat.score = 10;
        mocks.ability.score = 5;
        mocks.equipment.combat.score = 7;
        mocks.shrine.combat.score = 3;

        const result = await calculateCombatScore({ profile: {} });

        expect(typeof result.total).toBe('number');
        expect(result.total).toBeCloseTo(25);
        expect(typeof result.house).toBe('number');
        expect(typeof result.ability).toBe('number');
        expect(typeof result.equipment).toBe('number');
        expect(typeof result.skillerTotal).toBe('number');
        expect(typeof result.skillerEquipment).toBe('number');
    });

    test('no Combat + Skiller grand total exists anywhere on the result (PB-05)', async () => {
        resetToComplete();
        const result = await calculateCombatScore({ profile: {} });
        expect(result.grandTotal).toBeUndefined();
        expect(result.combinedTotal).toBeUndefined();
    });

    test('Skiller side has no Ability component (equipped abilities are Combat-only)', async () => {
        resetToComplete();
        const result = await calculateCombatScore({ profile: {} });
        expect(result.skillerBreakdown.abilities).toBeUndefined();
    });
});

describe('calculateCombatScore - F-13: partial top-level propagation', () => {
    test('930.0+ when Equipment has one unpriced item, even though Houses/Abilities/Shrines are complete', async () => {
        resetToComplete();
        mocks.house.combat = { score: 100, complete: true, unpricedCount: 0, breakdown: [] };
        mocks.ability = { score: 50, complete: true, unpricedCount: 0, breakdown: [] };
        mocks.equipment.combat = { score: 700, complete: false, unpricedCount: 1, breakdown: [] };
        mocks.shrine.combat = { score: 80, complete: true, unpricedCount: 0, breakdown: [] };

        const result = await calculateCombatScore({ profile: {} });

        expect(result.total).toBeCloseTo(930);
        expect(result.complete).toBe(false); // renderer appends "+" when complete is false
    });
});

describe('calculateCombatScore - F-07: viewer-relative (different getEnhancingParams -> different score)', () => {
    test('equipment score reflects whatever calculateEquipmentScore computed for the calling viewer', async () => {
        resetToComplete();
        mocks.equipment.combat.score = 500; // "Viewer A" reconstruction cost
        const viewerA = await calculateCombatScore({ profile: {} });
        expect(viewerA.equipment).toBeCloseTo(500);

        mocks.equipment.combat.score = 700; // "Viewer B" reconstruction cost, same viewed profile/market
        const viewerB = await calculateCombatScore({ profile: {} });
        expect(viewerB.equipment).toBeCloseTo(700);

        expect(viewerA.equipment).not.toBe(viewerB.equipment);
    });
});

describe('calculateCombatScore - error handling never throws to the caller', () => {
    test('a calculator throwing still returns a safe, fully-typed zeroed result', async () => {
        const { calculateHouseScore } = await import('./score/house-score.js');
        calculateHouseScore.mockImplementationOnce(() => {
            throw new Error('boom');
        });

        const result = await calculateCombatScore({ profile: {} });
        expect(result.total).toBe(0);
        expect(result.complete).toBe(false);
        expect(result.breakdown).toEqual({ houses: [], abilities: [], equipment: [], shrines: [] });
    });
});
