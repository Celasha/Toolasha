import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('asset-manifest skills sprite resolution', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('resolves a skills_sprite entry from the manifest', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    files: {
                        'static/media/skills_sprite.abc123.svg': '/static/media/skills_sprite.abc123.svg',
                    },
                }),
            }))
        );

        const { default: assetManifest } = await import('./asset-manifest.js');
        const url = await assetManifest.getSpriteUrl('skills');

        expect(url).toBe('/static/media/skills_sprite.abc123.svg');
    });

    test('returns null for skills when the manifest has no matching entry, not a guessed/hardcoded URL', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    files: { 'static/media/items_sprite.xyz.svg': '/static/media/items_sprite.xyz.svg' },
                }),
            }))
        );

        const { default: assetManifest } = await import('./asset-manifest.js');

        expect(await assetManifest.getSpriteUrl('skills')).toBeNull();
    });

    test('does not resolve skills from an unrelated sprite name (e.g. combat_monsters_sprite)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    files: {
                        'static/media/combat_monsters_sprite.aaa.svg': '/static/media/combat_monsters_sprite.aaa.svg',
                    },
                }),
            }))
        );

        const { default: assetManifest } = await import('./asset-manifest.js');

        expect(await assetManifest.getSpriteUrl('skills')).toBeNull();
    });

    test('a failed manifest fetch degrades to null rather than throwing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 500 }))
        );

        const { default: assetManifest } = await import('./asset-manifest.js');

        expect(await assetManifest.getSpriteUrl('skills')).toBeNull();
    });
});
