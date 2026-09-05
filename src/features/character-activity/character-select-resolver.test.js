/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test } from 'vitest';

import {
    getCharacterSelectOwnerFromElement,
    findPopulatedCharacterSlots,
    getCharacterIdFromSlotLink,
    resolveCharacterSelectSlots,
} from './character-select-resolver.js';

function makeOwner(overrides = {}) {
    return {
        setState: () => {},
        loadCharacters: () => {},
        renderCharacterSlots: () => {},
        characterSelected: () => {},
        state: {
            characters: [],
            availableGameModes: [],
            gameModeInput: 'standard',
            showCreateCharacterModal: false,
            isCreateCharacterPending: false,
        },
        ...overrides,
    };
}

function attachFiber(element, stateNode) {
    Object.defineProperty(element, '__reactFiber$test', {
        configurable: true,
        value: {
            stateNode: null,
            return: {
                stateNode,
                return: null,
            },
        },
    });
}

function buildSlot(characterId) {
    const slot = document.createElement('div');
    slot.className = 'CharacterSelectPage_slot__abc';
    slot.innerHTML = `<a href="/game?characterId=${characterId}"></a>`;
    return slot;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('getCharacterSelectOwnerFromElement', () => {
    test('accepts a component whose state/method signature matches Character Select', () => {
        const owner = makeOwner();
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);
        attachFiber(anchor, owner);

        expect(getCharacterSelectOwnerFromElement(anchor)).toBe(owner);
    });

    test('rejects a component missing a required method (wrong-shape candidate)', () => {
        const owner = makeOwner();
        delete owner.characterSelected;
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);
        attachFiber(anchor, owner);

        expect(getCharacterSelectOwnerFromElement(anchor)).toBeNull();
    });

    test('rejects a component missing a required state key', () => {
        const owner = makeOwner({ state: { characters: [] } }); // missing other required keys
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);
        attachFiber(anchor, owner);

        expect(getCharacterSelectOwnerFromElement(anchor)).toBeNull();
    });

    test('rejects when characters is not an array (stale/detached shape)', () => {
        const owner = makeOwner({ state: { ...makeOwner().state, characters: null } });
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);
        attachFiber(anchor, owner);

        expect(getCharacterSelectOwnerFromElement(anchor)).toBeNull();
    });

    test('returns null when no fiber can be resolved at all', () => {
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);

        expect(getCharacterSelectOwnerFromElement(anchor)).toBeNull();
    });
});

describe('getCharacterIdFromSlotLink', () => {
    test('extracts the character ID from the native href, never from visible text', () => {
        const link = document.createElement('a');
        link.setAttribute('href', '/game?characterId=abc-123');

        expect(getCharacterIdFromSlotLink(link)).toBe('abc-123');
    });

    test('returns null for a link with no characterId query param', () => {
        const link = document.createElement('a');
        link.setAttribute('href', '/game');

        expect(getCharacterIdFromSlotLink(link)).toBeNull();
    });

    test('returns null for a missing/malformed href', () => {
        const link = document.createElement('a');

        expect(getCharacterIdFromSlotLink(link)).toBeNull();
    });
});

describe('findPopulatedCharacterSlots', () => {
    test('finds only slots with a real characterId link, skipping empty create-character slots', () => {
        const root = document.createElement('div');
        const populated = buildSlot('char-a');
        const empty = document.createElement('div');
        empty.className = 'CharacterSelectPage_slot__abc'; // same class, no characterId link
        root.appendChild(populated);
        root.appendChild(empty);

        const result = findPopulatedCharacterSlots(root);

        expect(result).toEqual([{ slotElement: populated, characterId: 'char-a' }]);
    });

    test('fails closed on a duplicate character ID across slots - excludes all of them', () => {
        const root = document.createElement('div');
        const slotOne = buildSlot('char-a');
        const slotTwo = buildSlot('char-a');
        root.appendChild(slotOne);
        root.appendChild(slotTwo);

        expect(findPopulatedCharacterSlots(root)).toEqual([]);
    });

    test('resolves when the populated slot IS the native <a> anchor itself, not just a wrapper containing one', () => {
        const root = document.createElement('div');
        const slot = document.createElement('a');
        slot.className = 'CharacterSelectPage_slot__abc';
        slot.setAttribute('href', '/game?characterId=char-a');
        root.appendChild(slot);

        const result = findPopulatedCharacterSlots(root);

        expect(result).toEqual([{ slotElement: slot, characterId: 'char-a' }]);
    });

    test('still resolves the wrapper-with-descendant-anchor shape alongside a self-anchor slot', () => {
        const root = document.createElement('div');
        const wrapperSlot = buildSlot('char-a');
        const selfAnchorSlot = document.createElement('a');
        selfAnchorSlot.className = 'CharacterSelectPage_slot__abc';
        selfAnchorSlot.setAttribute('href', '/game?characterId=char-b');
        root.append(wrapperSlot, selfAnchorSlot);

        const result = findPopulatedCharacterSlots(root);

        expect(result).toEqual(
            expect.arrayContaining([
                { slotElement: wrapperSlot, characterId: 'char-a' },
                { slotElement: selfAnchorSlot, characterId: 'char-b' },
            ])
        );
        expect(result).toHaveLength(2);
    });
});

describe('resolveCharacterSelectSlots', () => {
    test('joins each populated slot to its native character data by exact ID', () => {
        const characterA = { id: 'char-a', name: 'Alice', isOnline: false, lastOfflineTime: 1000 };
        const owner = makeOwner({ state: { ...makeOwner().state, characters: [characterA] } });
        const root = document.createElement('div');
        document.body.appendChild(root);
        attachFiber(root, owner);
        const slotA = buildSlot('char-a');
        root.appendChild(slotA);

        const result = resolveCharacterSelectSlots(root);

        expect(result).toEqual([{ slotElement: slotA, character: characterA }]);
    });

    test('fails closed (excludes the slot) when its ID has no match in the resolved owner state', () => {
        const owner = makeOwner({ state: { ...makeOwner().state, characters: [{ id: 'char-other' }] } });
        const root = document.createElement('div');
        document.body.appendChild(root);
        attachFiber(root, owner);
        root.appendChild(buildSlot('char-a'));

        expect(resolveCharacterSelectSlots(root)).toEqual([]);
    });

    test('returns null (not an empty array) when the owner itself cannot be resolved', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        root.appendChild(buildSlot('char-a'));

        expect(resolveCharacterSelectSlots(root)).toBeNull();
    });
});
