import { describe, expect, test } from 'vitest';
import { normalizeGuildShrineReturnLabel } from './guild-marketplace-label.js';

describe('normalizeGuildShrineReturnLabel', () => {
    test.each([
        ['Shrine of ForceCombatLevel', 'Shrine of Force Combat Level'],
        ['Shrine of SpiritSkillingLevel', 'Shrine of Spirit Skilling Level'],
        ['Shrine of Wisdom Combat Level', 'Shrine of Wisdom Combat Level'],
    ])('normalizes %s', (source, expected) => {
        expect(normalizeGuildShrineReturnLabel(source)).toBe(expected);
    });

    test('falls back to the shrine name when the domain label is absent', () => {
        expect(normalizeGuildShrineReturnLabel('Upgrade Shrine of Force')).toBe('Shrine of Force');
    });

    test('falls back to Guild when no shrine identity is present', () => {
        expect(normalizeGuildShrineReturnLabel('Upgrade')).toBe('Guild');
    });
});
