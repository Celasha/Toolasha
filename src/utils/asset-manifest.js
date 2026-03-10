/**
 * Asset Manifest Utility
 *
 * Fetches the game's asset-manifest.json to resolve current webpack hashed
 * sprite URLs without hardcoding hashes that break on game updates.
 */

const MANIFEST_URL = 'https://www.milkywayidle.com/asset-manifest.json';

// Sprite keys to extract from the manifest (key → sprite name)
const SPRITE_KEYS = {
    actions: 'actions_sprite',
    items: 'items_sprite',
    monsters: 'combat_monsters_sprite',
    misc: 'misc_sprite',
    abilities: 'abilities_sprite',
};

let manifestPromise = null;
let cachedUrls = null;

/**
 * Fetch and parse the asset manifest, returning a map of sprite name → URL.
 * Result is cached for the lifetime of the page.
 * @returns {Promise<Object>} Map of sprite key → full URL
 */
async function fetchManifest() {
    if (cachedUrls) return cachedUrls;
    if (manifestPromise) return manifestPromise;

    manifestPromise = (async () => {
        try {
            const response = await fetch(MANIFEST_URL);
            if (!response.ok) {
                console.warn('[AssetManifest] Failed to fetch manifest:', response.status);
                return {};
            }

            const manifest = await response.json();
            const files = manifest.files || manifest; // handle both formats

            const urls = {};
            for (const [key, spriteName] of Object.entries(SPRITE_KEYS)) {
                // Find the entry whose key contains the sprite name and ends in .svg
                const entry = Object.entries(files).find(([k]) => k.includes(spriteName) && k.endsWith('.svg'));
                if (entry) {
                    // Values may be relative paths like /static/media/...
                    urls[key] = entry[1];
                }
            }

            cachedUrls = urls;
            return urls;
        } catch (error) {
            console.warn('[AssetManifest] Error fetching manifest:', error);
            return {};
        }
    })();

    return manifestPromise;
}

/**
 * Get a specific sprite URL by key.
 * @param {'actions'|'items'|'monsters'|'misc'|'abilities'} key
 * @returns {Promise<string|null>}
 */
async function getSpriteUrl(key) {
    const urls = await fetchManifest();
    return urls[key] || null;
}

export default {
    fetchManifest,
    getSpriteUrl,
};
