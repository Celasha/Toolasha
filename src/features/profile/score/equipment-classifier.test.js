import { describe, expect, test } from 'vitest';
import { classifyEquipmentItem } from './equipment-classifier.js';

describe('classifyEquipmentItem (TLA-041)', () => {
    test('combatStats with a non-zero key classifies combat-only', () => {
        const result = classifyEquipmentItem({ combatStats: { armor: 5 }, noncombatStats: {} });
        expect(result).toEqual({ combat: true, skiller: false });
    });

    test('noncombatStats with a non-zero key classifies skiller-only', () => {
        const result = classifyEquipmentItem({ combatStats: {}, noncombatStats: { skillingEfficiency: 0.02 } });
        expect(result).toEqual({ combat: false, skiller: true });
    });

    test('non-zero keys in both buckets classifies both (e.g. Guzzling Pouch)', () => {
        const result = classifyEquipmentItem({
            combatStats: { maxHitpoints: 20, drinkConcentration: 0.1 },
            noncombatStats: { drinkConcentration: 0.1 },
        });
        expect(result).toEqual({ combat: true, skiller: true });
    });

    test('all-zero stats in both buckets classifies neither (not defaulted to both)', () => {
        const result = classifyEquipmentItem({ combatStats: { armor: 0 }, noncombatStats: { gatheringQuantity: 0 } });
        expect(result).toEqual({ combat: false, skiller: false });
    });

    test('missing equipmentDetail classifies neither, does not throw', () => {
        expect(classifyEquipmentItem(undefined)).toEqual({ combat: false, skiller: false });
    });

    test('no-requirement combat-only accessory is not auto-counted as skiller (PB-17)', () => {
        // e.g. Fighter Necklace: no levelRequirements, but only combatStats populated
        const result = classifyEquipmentItem({
            combatStats: { stabAccuracy: 0.04 },
            noncombatStats: {},
        });
        expect(result).toEqual({ combat: true, skiller: false });
    });

    test('no-requirement skilling-only accessory is not auto-counted as combat (PB-18)', () => {
        // e.g. Ring Of Gathering: no levelRequirements, but only noncombatStats populated
        const result = classifyEquipmentItem({
            combatStats: {},
            noncombatStats: { gatheringQuantity: 0.03 },
        });
        expect(result).toEqual({ combat: false, skiller: true });
    });

    test('Stamina/Intelligence Charm shape classifies combat, not dropped (PB-16)', () => {
        // Charms carry staminaExperience/intelligenceExperience inside combatStats per Game Reference
        const result = classifyEquipmentItem({
            combatStats: { staminaExperience: 1 },
            noncombatStats: {},
        });
        expect(result).toEqual({ combat: true, skiller: false });
    });
});
