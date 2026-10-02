// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach } from 'vitest';

const gameData = { actionDetailMap: {}, skillDetailMap: {} };

vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => gameData) },
}));

let getActionHridFromIconHref;
let getSkillHridFromIconHref;
let getActionHridFromFiber;
let getQuestFromTaskCard;

beforeEach(async () => {
    // The module caches its fragment->hrid maps on first use for the life of the module
    // instance, so each test needs a fresh module instance to avoid bleeding gameData between
    // cases.
    vi.resetModules();
    document.body.innerHTML = '';
    ({ getActionHridFromIconHref, getSkillHridFromIconHref, getActionHridFromFiber, getQuestFromTaskCard } =
        await import('./game-lookups.js'));
});

// Builds a minimal React fiber tree rooted at document.getElementById('root') so
// getReactFiberFromElement (marketplace-autofill.js) can find `element` by walking
// child/sibling from the root, matching current MWI builds which expose no per-element
// __reactFiber$... key.
function attachReactRoot(element, ownerFiber) {
    const rootElement = document.createElement('div');
    rootElement.id = 'root';
    document.body.appendChild(rootElement);

    const hostFiber = { stateNode: element, child: null, sibling: null, return: ownerFiber };
    ownerFiber.child = hostFiber;
    const rootFiber = { stateNode: null, child: ownerFiber, sibling: null, return: null };

    Object.defineProperty(rootElement, '_reactRootContainer', {
        configurable: true,
        value: { current: rootFiber },
    });
}

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

describe('getActionHridFromFiber', () => {
    test('finds the hrid from actionDetail props on an ancestor fiber, regardless of locale', () => {
        const element = document.createElement('div');
        const ownerFiber = { stateNode: null, child: null, sibling: null, return: null };
        attachReactRoot(element, ownerFiber);
        ownerFiber.return = {
            stateNode: null,
            return: null,
            memoizedProps: { actionDetail: { hrid: '/actions/gathering/milking' } },
        };

        expect(getActionHridFromFiber(element)).toBe('/actions/gathering/milking');
    });

    test('returns null when no ancestor fiber carries actionDetail props', () => {
        const element = document.createElement('div');
        attachReactRoot(element, { stateNode: null, child: null, sibling: null, return: null });

        expect(getActionHridFromFiber(element)).toBeNull();
    });

    test('returns null for a null element', () => {
        expect(getActionHridFromFiber(null)).toBeNull();
    });
});

describe('getQuestFromTaskCard', () => {
    function buildTaskCard() {
        const card = document.createElement('div');
        const goBtn = document.createElement('button');
        goBtn.className = 'Button_success__6d6kU';
        card.appendChild(goBtn);
        return { card, goBtn };
    }

    test('finds characterQuest on an ancestor fiber of the Go button', () => {
        const { card, goBtn } = buildTaskCard();
        const ownerFiber = { stateNode: null, child: null, sibling: null, return: null };
        attachReactRoot(goBtn, ownerFiber);
        const quest = { actionHrid: '/actions/gathering/milking' };
        ownerFiber.return = {
            stateNode: null,
            return: null,
            memoizedProps: { characterQuest: quest, rerollRandomTaskHandler: () => {} },
        };

        expect(getQuestFromTaskCard(card)).toBe(quest);
    });

    test('returns null when the card has no Go/success button', () => {
        const card = document.createElement('div');

        expect(getQuestFromTaskCard(card)).toBeNull();
    });

    test('returns null when no ancestor fiber carries characterQuest props', () => {
        const { card, goBtn } = buildTaskCard();
        attachReactRoot(goBtn, { stateNode: null, child: null, sibling: null, return: null });

        expect(getQuestFromTaskCard(card)).toBeNull();
    });
});
