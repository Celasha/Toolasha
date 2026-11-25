/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    settings: { loadoutEnhancementDisplay: true, loadoutSavedLevelDisplay: true },
    displays: [],
    owned: new Map(),
    updateListeners: new Set(),
}));

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_ACCENT: '#22c55e',
        getSetting: vi.fn((key) => mocks.settings[key]),
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
    },
}));
vi.mock('../../core/data-manager.js', () => ({ default: { getInventory: vi.fn(() => []) } }));
vi.mock('../../core/dom-observer.js', () => ({
    default: { register: vi.fn(() => () => {}), touchesSelector: vi.fn(() => true) },
}));
vi.mock('../../core/i18n.js', () => ({
    t: vi.fn((key, params) => `${key}|${params?.saved ?? ''}|${params?.best ?? ''}`),
}));
vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getOwnedEnhancementIndex: vi.fn(() => mocks.owned),
        getSavedLevelDisplays: vi.fn((name) => mocks.displays.filter((display) => display.name === name)),
        onUpdate: vi.fn((listener) => mocks.updateListeners.add(listener)),
        offUpdate: vi.fn((listener) => mocks.updateListeners.delete(listener)),
    },
}));

const { default: feature } = await import('./loadout-enhancement-display.js');

function buildPanel(name, itemNames) {
    document.body.innerHTML = `
        <div class="LoadoutsPanel_selectedLoadout__x">
            <div class="LoadoutsPanel_metadata__x">Name<svg></svg>${name}<button>Edit</button></div>
            <div class="LoadoutsPanel_equipment__x">${itemNames
                .map(
                    (item) =>
                        `<div class="Item_item__x"><div class="Item_iconContainer__x"><svg><use href="/items_sprite.svg#${item}"></use></svg></div></div>`
                )
                .join('')}</div>
        </div>`;
}

const levelOverlays = () => [...document.querySelectorAll('.script_loadoutEnhLevel')];

beforeEach(() => {
    mocks.settings.loadoutEnhancementDisplay = true;
    mocks.settings.loadoutSavedLevelDisplay = true;
    mocks.displays = [];
    mocks.owned = new Map();
    feature.cleanup();
});

const RED = 'rgb(255, 90, 90)';
const entry = (itemHrid, savedLevel, highestOwnedLevel, status) => ({
    itemHrid,
    savedLevel,
    highestOwnedLevel,
    status,
});
const show = (equipment, name = 'Mine', snapshotId = '1') => ({ name, snapshotId, equipment });

describe('Loadout Enhancement Display saved levels', () => {
    test('turns the number red, with a tooltip, when the loadout will not give the saved level', () => {
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [show([entry('/items/sword', 5, 9, 'higherIgnored')])];

        feature.initialize();

        const [overlay] = levelOverlays();
        expect(overlay.textContent).toBe('+9');
        expect(overlay.style.color).toBe(RED);
        expect(overlay.title).toBe('loadoutSavedLevel.higherIgnored|5|9');
        expect(overlay.style.pointerEvents).toBe('auto');
    });

    test.each(['current', 'higherEquipped'])('leaves the number alone for status %s', (status) => {
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [show([entry('/items/sword', 5, 9, status)])];

        feature.initialize();

        const [overlay] = levelOverlays();
        expect(overlay.style.color).not.toBe(RED);
        expect(overlay.title).toBe('');
        expect(overlay.style.pointerEvents).toBe('none');
    });

    test('shows a red +0 for an item the loadout saved at a level you do not have', () => {
        buildPanel('Mine', ['sword']);
        mocks.displays = [show([entry('/items/sword', 3, null, 'notOwned')])];

        feature.initialize();

        const [overlay] = levelOverlays();
        expect(overlay.textContent).toBe('+0');
        expect(overlay.style.color).toBe(RED);
    });

    test('shows nothing for a +0 saved level on an item owned only at +0', () => {
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 0 }]]);
        mocks.displays = [show([entry('/items/sword', 0, 0, 'current')])];

        feature.initialize();

        expect(levelOverlays()).toHaveLength(0);
    });

    test('among loadouts sharing a name, uses the one whose items are on screen', () => {
        buildPanel('Same', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [
            show([entry('/items/bow', 2, 9, 'higherIgnored')], 'Same', 'other'),
            show([entry('/items/sword', 4, 9, 'higherIgnored')], 'Same', 'this'),
        ];

        feature.initialize();

        expect(levelOverlays().map((overlay) => overlay.title)).toEqual(['loadoutSavedLevel.higherIgnored|4|9']);
    });

    test('keeps the plain highest-owned number when its setting is off', () => {
        mocks.settings.loadoutSavedLevelDisplay = false;
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [show([entry('/items/sword', 5, 9, 'higherIgnored')])];

        feature.initialize();

        const [overlay] = levelOverlays();
        expect(overlay.textContent).toBe('+9');
        expect(overlay.style.color).not.toBe(RED);
    });

    test('redraws when Core reports a loadout or ownership update, and stops after cleanup', () => {
        buildPanel('Mine', ['sword']);
        feature.initialize();
        expect(mocks.updateListeners.size).toBe(1);
        expect(levelOverlays()).toHaveLength(0);

        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [show([entry('/items/sword', 5, 9, 'higherIgnored')])];
        [...mocks.updateListeners].forEach((listener) => listener());
        expect(levelOverlays()[0].style.color).toBe(RED);

        feature.cleanup();
        expect(mocks.updateListeners.size).toBe(0);
        expect(levelOverlays()).toHaveLength(0);
    });
});
