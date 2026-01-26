/**
 * Tests for Enhancement Multiplier System
 * Testing enhancement bonus calculations for equipment
 */

import { describe, test, expect } from 'vitest';
import { ENHANCEMENT_MULTIPLIERS, ENHANCEMENT_BONUSES, getEnhancementMultiplier } from './enhancement-multipliers.js';

describe('ENHANCEMENT_MULTIPLIERS constant', () => {
    test('has 5× multiplier for accessories', () => {
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/neck']).toBe(5);
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/ring']).toBe(5);
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/earring']).toBe(5);
    });

    test('has 5× multiplier for back slot', () => {
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/back']).toBe(5);
    });

    test('has 5× multiplier for trinket and charm', () => {
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/trinket']).toBe(5);
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/charm']).toBe(5);
    });

    test('returns undefined for non-5× slots (defaults to 1×)', () => {
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/weapon']).toBeUndefined();
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/armor']).toBeUndefined();
        expect(ENHANCEMENT_MULTIPLIERS['/equipment_types/pouch']).toBeUndefined();
    });
});

describe('ENHANCEMENT_BONUSES constant', () => {
    test('has correct bonus for level 1', () => {
        expect(ENHANCEMENT_BONUSES[1]).toBe(0.02);
    });

    test('has correct bonus for level 5', () => {
        expect(ENHANCEMENT_BONUSES[5]).toBe(0.12);
    });

    test('has correct bonus for level 10', () => {
        expect(ENHANCEMENT_BONUSES[10]).toBe(0.29);
    });

    test('has correct bonus for level 15', () => {
        expect(ENHANCEMENT_BONUSES[15]).toBe(0.57);
    });

    test('has correct bonus for level 20 (max)', () => {
        expect(ENHANCEMENT_BONUSES[20]).toBe(1.0);
    });

    test('has all levels from 1 to 20', () => {
        for (let level = 1; level <= 20; level++) {
            expect(ENHANCEMENT_BONUSES[level]).toBeDefined();
            expect(ENHANCEMENT_BONUSES[level]).toBeGreaterThan(0);
        }
    });

    test('bonuses increase with level', () => {
        for (let level = 1; level < 20; level++) {
            expect(ENHANCEMENT_BONUSES[level + 1]).toBeGreaterThan(ENHANCEMENT_BONUSES[level]);
        }
    });
});

describe('getEnhancementMultiplier', () => {
    describe('with enhancement level 0', () => {
        test('returns 1 for any equipment type', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/neck' },
            };
            expect(getEnhancementMultiplier(itemDetails, 0)).toBe(1);
        });

        test('returns 1 even with missing item details', () => {
            expect(getEnhancementMultiplier(null, 0)).toBe(1);
            expect(getEnhancementMultiplier(undefined, 0)).toBe(1);
        });
    });

    describe('with 5× multiplier slots (accessories)', () => {
        test('calculates multiplier for neck at +10', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/neck' },
            };
            // +10 = 0.29 bonus × 5 = 1.45 bonus → 2.45 multiplier
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(1 + 0.29 * 5);
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(2.45);
        });

        test('calculates multiplier for ring at +20', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/ring' },
            };
            // +20 = 1.0 bonus × 5 = 5.0 bonus → 6.0 multiplier
            expect(getEnhancementMultiplier(itemDetails, 20)).toBe(1 + 1.0 * 5);
            expect(getEnhancementMultiplier(itemDetails, 20)).toBe(6);
        });

        test('calculates multiplier for earring at +5', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/earring' },
            };
            // +5 = 0.12 bonus × 5 = 0.6 bonus → 1.6 multiplier
            expect(getEnhancementMultiplier(itemDetails, 5)).toBe(1 + 0.12 * 5);
            expect(getEnhancementMultiplier(itemDetails, 5)).toBe(1.6);
        });

        test('calculates multiplier for back at +15', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/back' },
            };
            // +15 = 0.57 bonus × 5 = 2.85 bonus → 3.85 multiplier
            expect(getEnhancementMultiplier(itemDetails, 15)).toBeCloseTo(1 + 0.57 * 5, 10);
            expect(getEnhancementMultiplier(itemDetails, 15)).toBeCloseTo(3.85, 10);
        });

        test('calculates multiplier for trinket at +1', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/trinket' },
            };
            // +1 = 0.02 bonus × 5 = 0.1 bonus → 1.1 multiplier
            expect(getEnhancementMultiplier(itemDetails, 1)).toBe(1 + 0.02 * 5);
            expect(getEnhancementMultiplier(itemDetails, 1)).toBe(1.1);
        });

        test('calculates multiplier for charm at +12', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/charm' },
            };
            // +12 = 0.384 bonus × 5 = 1.92 bonus → 2.92 multiplier
            expect(getEnhancementMultiplier(itemDetails, 12)).toBe(1 + 0.384 * 5);
            expect(getEnhancementMultiplier(itemDetails, 12)).toBe(2.92);
        });
    });

    describe('with 1× multiplier slots (weapons, armor, pouch)', () => {
        test('calculates multiplier for weapon at +10', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/weapon' },
            };
            // +10 = 0.29 bonus × 1 = 0.29 bonus → 1.29 multiplier
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(1 + 0.29 * 1);
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(1.29);
        });

        test('calculates multiplier for armor at +20', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/armor' },
            };
            // +20 = 1.0 bonus × 1 = 1.0 bonus → 2.0 multiplier
            expect(getEnhancementMultiplier(itemDetails, 20)).toBe(1 + 1.0 * 1);
            expect(getEnhancementMultiplier(itemDetails, 20)).toBe(2);
        });

        test('calculates multiplier for pouch at +5', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/pouch' },
            };
            // +5 = 0.12 bonus × 1 = 0.12 bonus → 1.12 multiplier
            expect(getEnhancementMultiplier(itemDetails, 5)).toBe(1 + 0.12 * 1);
            expect(getEnhancementMultiplier(itemDetails, 5)).toBe(1.12);
        });
    });

    describe('edge cases', () => {
        test('handles missing item details', () => {
            expect(getEnhancementMultiplier(null, 10)).toBe(1 + 0.29 * 1);
            expect(getEnhancementMultiplier(undefined, 10)).toBe(1.29);
        });

        test('handles missing equipment detail', () => {
            const itemDetails = {};
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(1.29);
        });

        test('handles missing equipment type', () => {
            const itemDetails = {
                equipmentDetail: {},
            };
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(1.29);
        });

        test('handles unknown equipment type (defaults to 1×)', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/unknown' },
            };
            expect(getEnhancementMultiplier(itemDetails, 10)).toBe(1.29);
        });

        test('handles enhancement level beyond 20 (uses 0 bonus)', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/neck' },
            };
            // Level 21 not in table → 0 bonus → 1.0 multiplier
            expect(getEnhancementMultiplier(itemDetails, 21)).toBe(1);
        });

        test('handles negative enhancement level (uses 0 bonus)', () => {
            const itemDetails = {
                equipmentDetail: { type: '/equipment_types/neck' },
            };
            expect(getEnhancementMultiplier(itemDetails, -1)).toBe(1);
        });
    });

    describe('comparison between slot types', () => {
        test('5× slot has 5× the bonus of 1× slot at same level', () => {
            const neck = {
                equipmentDetail: { type: '/equipment_types/neck' },
            };
            const weapon = {
                equipmentDetail: { type: '/equipment_types/weapon' },
            };

            const neckMultiplier = getEnhancementMultiplier(neck, 10);
            const weaponMultiplier = getEnhancementMultiplier(weapon, 10);

            // Neck: 1 + 0.29 × 5 = 2.45
            // Weapon: 1 + 0.29 × 1 = 1.29
            // Difference in bonus: (2.45 - 1) / (1.29 - 1) = 1.45 / 0.29 = 5
            expect((neckMultiplier - 1) / (weaponMultiplier - 1)).toBeCloseTo(5, 10);
        });
    });
});
