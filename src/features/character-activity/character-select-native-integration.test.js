/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    onClassRegistration: null,
    onReadyRegistration: null,
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, classNames, callback) => {
            mocks.onClassRegistration = { classNames, callback };
            return vi.fn();
        }),
        onReady: vi.fn((_name, callback) => {
            mocks.onReadyRegistration = { callback };
            return vi.fn();
        }),
    },
}));

vi.mock('../../utils/asset-manifest.js', () => ({
    default: { getSpriteUrl: vi.fn(async () => null) },
}));

vi.mock('./character-activity-storage.js', () => ({
    loadCharacterActivity: vi.fn(async () => null),
    loadAccountPreferences: vi.fn(async () => ({ enabled: true, dateFormat: 'MM-DD', timeFormat: '24hour' })),
}));

const { default: characterSelectRenderer } = await import('./character-select-renderer.js');

function makeOwner(character) {
    return {
        setState: () => {},
        loadCharacters: () => {},
        renderCharacterSlots: () => {},
        characterSelected: () => {},
        state: {
            characters: [character],
            availableGameModes: [],
            gameModeInput: 'standard',
            showCreateCharacterModal: false,
            isCreateCharacterPending: false,
        },
    };
}

/**
 * Model the fallback used by current MWI builds: DOM nodes do not expose __reactFiber$ keys,
 * so Toolasha resolves the host fiber from #root._reactRootContainer and ascends to the owner.
 */
function attachThroughPublicReactRoot(element, stateNode) {
    const reactRootElement = document.createElement('div');
    reactRootElement.id = 'root';
    document.body.appendChild(reactRootElement);
    reactRootElement.appendChild(element);

    const rootFiber = { stateNode: null, return: null, child: null, sibling: null };
    const ownerFiber = { stateNode, return: rootFiber, child: null, sibling: null };
    const hostFiber = { stateNode: element, return: ownerFiber, child: null, sibling: null };
    rootFiber.child = ownerFiber;
    ownerFiber.child = hostFiber;

    Object.defineProperty(reactRootElement, '_reactRootContainer', {
        configurable: true,
        value: { current: rootFiber },
    });
}

function buildCurrentNativeCharacterSelect() {
    const character = {
        id: 'char-a',
        name: 'Alice',
        isOnline: false,
        lastOfflineTime: 1000,
    };

    const root = document.createElement('div');
    root.className = 'CharacterSelectPage_characterSelectPage__native';

    const slots = document.createElement('div');
    slots.className = 'CharacterSelectPage_characterSlots__native';

    // Current MWI Client Code renders the populated slot itself as the navigation link.
    const slot = document.createElement('a');
    slot.className = 'CharacterSelectPage_slot__native';
    slot.setAttribute('href', `/game?characterId=${character.id}`);
    slot.innerHTML = '<div>Alice</div><div>Standard</div><div>Last online</div>';

    slots.appendChild(slot);
    root.appendChild(slots);
    attachThroughPublicReactRoot(root, makeOwner(character));

    return { root, slot };
}

beforeEach(() => {
    document.body.innerHTML = '';
    mocks.onClassRegistration = null;
    mocks.onReadyRegistration = null;
    characterSelectRenderer.stopWatching();
});

afterEach(() => {
    characterSelectRenderer.stopWatching();
});

describe('Character Activity Status current-native Character Select integration (TLA-025 reopen)', () => {
    test('injects onboarding status through the current public-React-root fallback and native anchor-slot shape', async () => {
        const { slot } = buildCurrentNativeCharacterSelect();

        characterSelectRenderer.startWatching();
        expect(mocks.onReadyRegistration).not.toBeNull();

        await mocks.onReadyRegistration.callback();

        const blocks = slot.querySelectorAll('.toolasha-character-activity-status');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].textContent).toContain('No activity data yet');
        expect(blocks[0].textContent).toContain('Open character once to enable status');
    });

    test('the async character-slots observer path resolves the same native anchor-slot shape idempotently', async () => {
        const { root, slot } = buildCurrentNativeCharacterSelect();

        characterSelectRenderer.startWatching();
        expect(mocks.onClassRegistration?.classNames).toEqual([
            'CharacterSelectPage_characterSelectPage',
            'CharacterSelectPage_characterSlots',
        ]);

        const slots = root.querySelector('[class*="CharacterSelectPage_characterSlots"]');
        await mocks.onClassRegistration.callback(slots);
        await mocks.onClassRegistration.callback(slots);

        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
    });
});
