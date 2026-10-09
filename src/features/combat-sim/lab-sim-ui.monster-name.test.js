import { describe, test, expect, vi, beforeEach } from 'vitest';

const { translations } = vi.hoisted(() => ({ translations: {} }));
vi.mock('../../utils/game-i18n.js', () => ({
    getMonsterName: (hrid, fallback = '') => translations[hrid] ?? fallback,
}));

const { default: labSimUI } = await import('./lab-sim-ui.js');

describe('labSimUI _monsterDisplayName (#37)', () => {
    beforeEach(() => {
        for (const k of Object.keys(translations)) delete translations[k];
    });

    test('prefers localized monster name', () => {
        translations['/monsters/cyclops'] = '独眼巨人';
        expect(labSimUI._monsterDisplayName('/monsters/cyclops')).toBe('独眼巨人');
    });

    test('falls back to English title-cased slug', () => {
        expect(labSimUI._monsterDisplayName('/monsters/iron_cyclops')).toBe('Iron Cyclops');
    });
});
