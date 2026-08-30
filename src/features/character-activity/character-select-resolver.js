/**
 * Character Select Native Resolver
 * Fail-closed access to the native Character Select page's already-loaded character list, via
 * the same bounded React-fiber-ascent pattern already used for the Marketplace resolver - no new
 * `/characters` request, no parsing of visible text. Each populated slot is bound to a character
 * purely by the exact ID captured in its native `<a href="/game?characterId=...">` link, then
 * joined against the resolved owner's live `state.characters` by that same exact ID.
 */

import { getReactFiberFromElement } from '../../utils/marketplace-autofill.js';

const MAX_OWNER_DEPTH = 256;
const SLOT_CLASS = 'CharacterSelectPage_slot';
const REQUIRED_STATE_KEYS = [
    'characters',
    'availableGameModes',
    'gameModeInput',
    'showCreateCharacterModal',
    'isCreateCharacterPending',
];
const REQUIRED_METHODS = ['loadCharacters', 'renderCharacterSlots', 'characterSelected'];

function hasCharacterSelectStateSignature(state) {
    if (!state || typeof state !== 'object') return false;
    if (!Array.isArray(state.characters)) return false;
    return REQUIRED_STATE_KEYS.every((key) => key in state);
}

/**
 * Ascend from a DOM anchor inside Character Select to the owning page component, validated by
 * exact behavioral (method) + structural (state shape) signature. Fails closed (returns null) if
 * ascent exceeds the depth bound or resolves to more than one distinct candidate.
 * @param {Element} element - Any element inside the Character Select page
 * @returns {Object|null} The Character Select page's component instance, or null
 */
export function getCharacterSelectOwnerFromElement(element) {
    let fiber = getReactFiberFromElement(element);
    let depth = 0;
    const candidates = [];
    const seen = new Set();

    while (fiber && depth < MAX_OWNER_DEPTH) {
        const stateNode = fiber.stateNode;
        if (
            stateNode &&
            !seen.has(stateNode) &&
            typeof stateNode.setState === 'function' &&
            REQUIRED_METHODS.every((method) => typeof stateNode[method] === 'function') &&
            hasCharacterSelectStateSignature(stateNode.state)
        ) {
            seen.add(stateNode);
            candidates.push(stateNode);
        }
        fiber = fiber.return;
        depth += 1;
    }

    if (candidates.length !== 1) return null;
    return candidates[0];
}

/**
 * Extract the character ID from a slot's native navigation link
 * (`href="/game?characterId=<id>"`), never from visible text.
 * @param {Element} linkElement
 * @returns {string|null}
 */
export function getCharacterIdFromSlotLink(linkElement) {
    const href = linkElement?.getAttribute?.('href');
    if (!href) return null;
    try {
        const url = new URL(href, window.location.origin);
        return url.searchParams.get('characterId') || null;
    } catch {
        return null;
    }
}

/**
 * Find every populated Character Select slot (a slot with a real `characterId` link - the empty
 * "create character" slots use the same CSS class but have no such link) under `rootElement`.
 * Fails closed on malformed/missing IDs (skipped individually) and on a duplicate ID appearing in
 * more than one slot (all slots sharing that ID are skipped, since which one is real is
 * ambiguous).
 * @param {Element} rootElement
 * @returns {Array<{slotElement: Element, characterId: string}>}
 */
export function findPopulatedCharacterSlots(rootElement) {
    const slots = rootElement.querySelectorAll(`[class*="${SLOT_CLASS}"]`);
    const slotsById = new Map();

    for (const slot of slots) {
        // Current native MWI renders each populated slot as the navigation link itself
        // (`<a class="...slot..." href="/game?characterId=...">`), not as a wrapper
        // containing a descendant link. `querySelector()` never matches the element it is
        // called on, so prefer the slot itself when it owns the characterId href while
        // retaining the descendant fallback for compatible future/alternate markup.
        const link = slot.matches?.('a[href*="characterId="]') ? slot : slot.querySelector('a[href*="characterId="]');
        if (!link) continue;

        const characterId = getCharacterIdFromSlotLink(link);
        if (!characterId) continue;

        if (!slotsById.has(characterId)) slotsById.set(characterId, []);
        slotsById.get(characterId).push(slot);
    }

    const result = [];
    for (const [characterId, slotElements] of slotsById) {
        if (slotElements.length !== 1) continue;
        result.push({ slotElement: slotElements[0], characterId });
    }
    return result;
}

/**
 * Resolve every populated Character Select slot to its native character data, binding purely by
 * exact ID (never position/name/order). Fails closed (excludes that slot) if the owner can't be
 * validated, the slot's ID is malformed/duplicated, or the ID isn't present in the resolved
 * owner's live character list.
 * @param {Element} rootElement - Any element inside Character Select (e.g. the mutation target)
 * @returns {Array<{slotElement: Element, character: Object}>|null} null if the owner itself
 *      couldn't be resolved at all
 */
export function resolveCharacterSelectSlots(rootElement) {
    const owner = getCharacterSelectOwnerFromElement(rootElement);
    if (!owner) return null;

    const characters = owner.state?.characters;
    if (!Array.isArray(characters)) return null;

    const charactersById = new Map(
        characters.filter((character) => character?.id != null).map((c) => [String(c.id), c])
    );

    const slots = findPopulatedCharacterSlots(rootElement);
    const resolved = [];

    for (const { slotElement, characterId } of slots) {
        const character = charactersById.get(String(characterId));
        if (!character) continue;
        resolved.push({ slotElement, character });
    }

    return resolved;
}
