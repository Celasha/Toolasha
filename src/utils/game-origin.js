/**
 * Game Origin Utility
 *
 * The game is also served from a mainland-China mirror (milkywayidlecn.com) because the main
 * domain is sometimes blocked there. Fetches of the game's public data files must hit the
 * domain the page is on, otherwise they go cross-origin to the blocked host and fail.
 */

const DEFAULT_ORIGIN = 'https://www.milkywayidle.com';
const CN_DOMAIN = 'milkywayidlecn.com';

/**
 * Resolve the origin that serves the game's public data files (game_data/*, asset-manifest.json).
 * @param {{hostname?: string, origin?: string}} [pageLocation] - Location to inspect (defaults to window.location)
 * @returns {string} Origin without a trailing slash
 */
export function getGameOrigin(pageLocation = typeof window !== 'undefined' ? window.location : null) {
    const hostname = pageLocation?.hostname || '';
    if ((hostname === CN_DOMAIN || hostname.endsWith(`.${CN_DOMAIN}`)) && pageLocation.origin) {
        return pageLocation.origin;
    }
    return DEFAULT_ORIGIN;
}
