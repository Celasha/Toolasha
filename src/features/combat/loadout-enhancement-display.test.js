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

const savedLabels = () => [...document.querySelectorAll('.script_loadoutSavedLevel')];

beforeEach(() => {
    mocks.settings.loadoutEnhancementDisplay = true;
    mocks.settings.loadoutSavedLevelDisplay = true;
    mocks.displays = [];
    mocks.owned = new Map();
    feature.cleanup();
});

describe('Loadout Enhancement Display saved levels', () => {
    test('labels an icon with the level the loadout saved, amber when a higher copy is owned', () => {
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [
            {
                name: 'Mine',
                snapshotId: '1',
                equipment: [
                    { itemHrid: '/items/sword', savedLevel: 5, highestOwnedLevel: 9, status: 'higherEquipped' },
                ],
            },
        ];

        feature.initialize();

        const [label] = savedLabels();
        expect(label.textContent).toBe('loadoutSavedLevel.label|5|');
        expect(label.title).toBe('loadoutSavedLevel.higherEquipped|5|9');
        expect(label.style.color).toBe('rgb(255, 176, 32)');
        expect(document.querySelector('.script_loadoutEnhLevel').textContent).toBe('+9');
    });

    test('is grey when the saved level is the best copy', () => {
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 5 }]]);
        mocks.displays = [
            {
                name: 'Mine',
                snapshotId: '1',
                equipment: [{ itemHrid: '/items/sword', savedLevel: 5, highestOwnedLevel: 5, status: 'current' }],
            },
        ];

        feature.initialize();

        expect(savedLabels()[0].style.color).toBe('rgb(159, 176, 200)');
    });

    test('shows no label for a +0 saved level on an item owned only at +0', () => {
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 0 }]]);
        mocks.displays = [
            {
                name: 'Mine',
                snapshotId: '1',
                equipment: [{ itemHrid: '/items/sword', savedLevel: 0, highestOwnedLevel: 0, status: 'current' }],
            },
        ];

        feature.initialize();

        expect(savedLabels()).toHaveLength(0);
    });

    test('among loadouts sharing a name, uses the one whose items are on screen', () => {
        buildPanel('Same', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [
            {
                name: 'Same',
                snapshotId: 'other',
                equipment: [{ itemHrid: '/items/bow', savedLevel: 2, highestOwnedLevel: 9, status: 'current' }],
            },
            {
                name: 'Same',
                snapshotId: 'this',
                equipment: [{ itemHrid: '/items/sword', savedLevel: 4, highestOwnedLevel: 9, status: 'current' }],
            },
        ];

        feature.initialize();

        expect(savedLabels().map((label) => label.textContent)).toEqual(['loadoutSavedLevel.label|4|']);
    });

    test('adds nothing when its setting is off, and keeps the highest-owned overlay', () => {
        mocks.settings.loadoutSavedLevelDisplay = false;
        buildPanel('Mine', ['sword']);
        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [
            {
                name: 'Mine',
                snapshotId: '1',
                equipment: [
                    { itemHrid: '/items/sword', savedLevel: 5, highestOwnedLevel: 9, status: 'higherEquipped' },
                ],
            },
        ];

        feature.initialize();

        expect(savedLabels()).toHaveLength(0);
        expect(document.querySelector('.script_loadoutEnhLevel')).not.toBeNull();
    });

    test('redraws when Core reports a loadout or ownership update, and stops after cleanup', () => {
        buildPanel('Mine', ['sword']);
        feature.initialize();
        expect(mocks.updateListeners.size).toBe(1);
        expect(savedLabels()).toHaveLength(0);

        mocks.owned = new Map([['/items/sword', { highestEnhancementLevel: 9 }]]);
        mocks.displays = [
            {
                name: 'Mine',
                snapshotId: '1',
                equipment: [
                    { itemHrid: '/items/sword', savedLevel: 5, highestOwnedLevel: 9, status: 'higherEquipped' },
                ],
            },
        ];
        [...mocks.updateListeners].forEach((listener) => listener());
        expect(savedLabels()).toHaveLength(1);

        feature.cleanup();
        expect(mocks.updateListeners.size).toBe(0);
        expect(savedLabels()).toHaveLength(0);
    });
});
