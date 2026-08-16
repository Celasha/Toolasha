import { describe, test, expect, vi, beforeEach } from 'vitest';

const gameData = { actionDetailMap: {}, skillDetailMap: {} };

vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => gameData) },
}));

let getActionHridFromIconHref;
let getSkillHridFromIconHref;

beforeEach(async () => {
    // The module caches its fragment->hrid maps on first use for the life of the module
    // instance, so each test needs a fresh module instance to avoid bleeding gameData between
    // cases.
    vi.resetModules();
    ({ getActionHridFromIconHref, getSkillHridFromIconHref } = await import('./game-lookups.js'));
});

describe('getActionHridFromIconHref', () => {
    beforeEach(() => {
        gameData.actionDetailMap = {
            '/actions/gathering/milking': { name: 'Milking' },
            '/actions/alchemy/coinify': { name: 'Coinify' },
        };
    });

    test('resolves the action hrid from the sprite fragment, regardless of locale', () => {
        const href = '/static/media/actions_sprite.e6388cbc.svg#milking';
        expect(getActionHridFromIconHref(href)).toBe('/actions/gathering/milking');
    });

    test('returns null for a non-action sprite sheet', () => {
        const href = '/static/media/skills_sprite.3bb4d936.svg#milking';
        expect(getActionHridFromIconHref(href)).toBeNull();
    });

    test('returns null when the fragment has no matching action', () => {
        const href = '/static/media/actions_sprite.e6388cbc.svg#nonexistent_action';
        expect(getActionHridFromIconHref(href)).toBeNull();
    });

    test('returns null for a missing or malformed href', () => {
        expect(getActionHridFromIconHref(null)).toBeNull();
        expect(getActionHridFromIconHref('')).toBeNull();
        expect(getActionHridFromIconHref('/static/media/actions_sprite.e6388cbc.svg')).toBeNull();
    });
});

describe('getSkillHridFromIconHref', () => {
    beforeEach(() => {
        gameData.skillDetailMap = {
            '/skills/milking': { name: 'Milking' },
            '/skills/alchemy': { name: 'Alchemy' },
        };
    });

    test('resolves the skill hrid from the sprite fragment, regardless of locale', () => {
        const href = '/static/media/skills_sprite.3bb4d936.svg#milking';
        expect(getSkillHridFromIconHref(href)).toBe('/skills/milking');
    });

    test('returns null for a non-skill sprite sheet', () => {
        const href = '/static/media/actions_sprite.e6388cbc.svg#milking';
        expect(getSkillHridFromIconHref(href)).toBeNull();
    });

    test('returns null for a missing href', () => {
        expect(getSkillHridFromIconHref(undefined)).toBeNull();
    });
});
