/**
 * Normalize the text captured from a Guild shrine modal for the Marketplace Return tab.
 * The game renders adjacent shrine/domain labels without guaranteed whitespace, so insert
 * camel-case boundaries before extracting the exact user-facing destination.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeGuildShrineReturnLabel(text) {
    const normalized = String(text || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    return (
        normalized.match(/Shrine of [A-Za-z]+ (?:Combat|Skilling) Level/)?.[0] ||
        normalized.match(/Shrine of [A-Za-z]+/)?.[0] ||
        'Guild'
    );
}
