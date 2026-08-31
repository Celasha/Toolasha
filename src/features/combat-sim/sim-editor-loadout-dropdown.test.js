/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    snapshots: [],
}));

vi.mock('./combat-sim-adapter.js', () => ({
    buildGameDataPayload: vi.fn(() => ({})),
    buildAllPlayerDTOs: vi.fn(),
    parseShykaiImport: vi.fn(),
    applyLoadoutSnapshotToDTO: vi.fn(),
    COMBAT_SHRINE_HRIDS: [
        '/guild_shrines/force',
        '/guild_shrines/tempo',
        '/guild_shrines/spirit',
        '/guild_shrines/rarity',
        '/guild_shrines/scholar',
    ],
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getAllSnapshots: vi.fn(() => mocks.snapshots),
    },
}));

import { SimEditor } from './sim-editor.js';

function snapshot(name, { usable = true, actionTypeHrid = '/action_types/combat' } = {}) {
    return { name, isUsableForCalculation: usable, actionTypeHrid };
}

function minimalDto() {
    return {
        equipment: {},
        abilities: [],
        food: [],
        drinks: [],
        houseRooms: {},
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
    };
}

function editorWithMount() {
    const editorEl = document.createElement('div');
    const editor = new SimEditor({ editorEl });
    editor._editedDTOs = { player1: minimalDto() };
    editor._originalDTOs = { player1: minimalDto() };
    editor._editedPlayerInfo = [{ hrid: 'player1', name: 'Player' }];
    editor._activeEditPlayer = 'player1';
    editor._editorInitialized = true;
    return editor;
}

function selectEl(editor) {
    return editor._editorEl.querySelector('#mwi-csim-loadout-select');
}

function optionsOf(editor) {
    return [...selectEl(editor).querySelectorAll('option')];
}

describe('TLA-023: Combat Sim Loadout dropdown lists unavailable loadouts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.snapshots = [];
    });

    test('a mix of usable and unusable relevant loadouts all appear in the dropdown', () => {
        mocks.snapshots = [snapshot('Melee', { usable: true }), snapshot('Nature Mage / Heal', { usable: false })];
        const editor = editorWithMount();

        editor.renderEditor();

        const labels = optionsOf(editor).map((o) => o.textContent);
        expect(labels).toContain('Melee');
        expect(labels.some((l) => l.includes('Nature Mage / Heal') && l.includes('Unavailable'))).toBe(true);
    });

    test('usable loadouts remain enabled and selectable', () => {
        mocks.snapshots = [snapshot('Melee', { usable: true })];
        const editor = editorWithMount();

        editor.renderEditor();

        const option = optionsOf(editor).find((o) => o.value === 'Melee');
        expect(option.disabled).toBe(false);
    });

    test('unusable loadouts are present, disabled, and visibly marked (Unavailable)', () => {
        mocks.snapshots = [snapshot('Nature Mage / Heal', { usable: false })];
        const editor = editorWithMount();

        editor.renderEditor();

        const option = optionsOf(editor).find((o) => o.value === 'Nature Mage / Heal');
        expect(option).toBeTruthy();
        expect(option.disabled).toBe(true);
        expect(option.textContent).toContain('(Unavailable)');
    });

    test('Current Gear remains available alongside unusable loadouts', () => {
        mocks.snapshots = [snapshot('Nature Mage / Heal', { usable: false })];
        const editor = editorWithMount();

        editor.renderEditor();

        const option = optionsOf(editor).find((o) => o.value === '');
        expect(option).toBeTruthy();
        expect(option.disabled).toBe(false);
    });

    test('an already-selected loadout that becomes unavailable stays represented as unavailable, not duplicated', () => {
        mocks.snapshots = [snapshot('Melee', { usable: false })];
        const editor = editorWithMount();
        editor._unavailableLoadoutName = 'Melee';

        editor.renderEditor();

        const matching = optionsOf(editor).filter((o) => o.value === 'Melee');
        expect(matching).toHaveLength(1);
        expect(matching[0].disabled).toBe(true);
        expect(matching[0].selected).toBe(true);
    });

    test('a loadout becoming usable again after the missing item is restored becomes selectable again', () => {
        mocks.snapshots = [snapshot('Melee', { usable: false })];
        const editor = editorWithMount();
        editor._unavailableLoadoutName = 'Melee';
        editor.renderEditor();
        expect(optionsOf(editor).find((o) => o.value === 'Melee').disabled).toBe(true);

        mocks.snapshots = [snapshot('Melee', { usable: true })];
        editor._unavailableLoadoutName = '';
        editor._selectedLoadoutName = 'Melee';
        editor.renderEditor();

        const option = optionsOf(editor).find((o) => o.value === 'Melee');
        expect(option.disabled).toBe(false);
        expect(option.selected).toBe(true);
    });

    test('no duplicate unavailable option is created when the selected snapshot no longer exists at all', () => {
        mocks.snapshots = [];
        const editor = editorWithMount();
        editor._unavailableLoadoutName = 'Deleted Loadout';

        editor.renderEditor();

        const matching = optionsOf(editor).filter((o) => o.value === 'Deleted Loadout');
        expect(matching).toHaveLength(1);
        expect(matching[0].disabled).toBe(true);
    });

    test('non-Combat saved loadouts remain excluded unless they are All Skills', () => {
        mocks.snapshots = [
            snapshot('Melee', { usable: true, actionTypeHrid: '/action_types/combat' }),
            snapshot('Woodcutting Loadout', { usable: true, actionTypeHrid: '/action_types/woodcutting' }),
            snapshot('All Skills Loadout', { usable: true, actionTypeHrid: null }),
        ];
        const editor = editorWithMount();

        editor.renderEditor();

        const labels = optionsOf(editor).map((o) => o.textContent);
        expect(labels.some((l) => l.includes('Melee'))).toBe(true);
        expect(labels.some((l) => l.includes('All Skills Loadout'))).toBe(true);
        expect(labels.some((l) => l.includes('Woodcutting Loadout'))).toBe(false);
    });

    test('an unusable loadout option cannot be selected to trigger fallback-to-Current-Gear calculation', () => {
        mocks.snapshots = [snapshot('Nature Mage / Heal', { usable: false })];
        const editor = editorWithMount();

        editor.renderEditor();

        const option = optionsOf(editor).find((o) => o.value === 'Nature Mage / Heal');
        expect(option.disabled).toBe(true);
    });
});
