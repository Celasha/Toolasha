/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: {},
}));

vi.mock('./combat-sim-adapter.js', () => ({
    buildGameDataPayload: vi.fn(() => mocks.gameData),
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
        getAllSnapshots: vi.fn(() => []),
    },
}));

import { SimEditor } from './sim-editor.js';

function guildShrineDetailMap() {
    return {
        '/guild_shrines/force': { name: 'Shrine of Force', maxLevel: 20 },
        '/guild_shrines/tempo': { name: 'Shrine of Tempo', maxLevel: 20 },
        '/guild_shrines/spirit': { name: 'Shrine of Spirit', maxLevel: 20 },
        '/guild_shrines/rarity': { name: 'Shrine of Rarity', maxLevel: 20 },
        '/guild_shrines/scholar': { name: 'Shrine of Scholar', maxLevel: 20 },
    };
}

function minimalDto(shrineLevels = {}) {
    return {
        equipment: {},
        abilities: [],
        food: [],
        drinks: [],
        houseRooms: {},
        shrineLevels,
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
    };
}

function editorWithMount(shrineLevels = {}) {
    const editorEl = document.createElement('div');
    const editor = new SimEditor({ editorEl });
    editor._editedDTOs = { player1: minimalDto(shrineLevels), player2: minimalDto() };
    editor._originalDTOs = { player1: minimalDto(shrineLevels), player2: minimalDto() };
    editor._editedPlayerInfo = [
        { hrid: 'player1', name: 'Player 1' },
        { hrid: 'player2', name: 'Player 2' },
    ];
    editor._activeEditPlayer = 'player1';
    editor._editorInitialized = true;
    editor._openSections = new Set(['shrine-section']);
    return editor;
}

describe('UI-002: Shrines section directly below House Rooms', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.gameData = { houseRoomDetailMap: {}, guildShrineDetailMap: guildShrineDetailMap() };
    });

    test('all five shrines render', () => {
        const editor = editorWithMount();
        editor.renderEditor();

        const inputs = [...editor._editorEl.querySelectorAll('[data-shrine-hrid]')];
        expect(inputs).toHaveLength(5);
        const hrids = inputs.map((input) => input.dataset.shrineHrid).sort();
        expect(hrids).toEqual(
            [
                '/guild_shrines/force',
                '/guild_shrines/rarity',
                '/guild_shrines/scholar',
                '/guild_shrines/spirit',
                '/guild_shrines/tempo',
            ].sort()
        );
    });

    test('the Shrines section appears immediately after the House Rooms section, not elsewhere', () => {
        const editor = editorWithMount();
        editor.renderEditor();

        const html = editor._editorEl.innerHTML;
        const houseIdx = html.indexOf('House Rooms');
        const shrineIdx = html.indexOf('Shrines<span');
        expect(houseIdx).toBeGreaterThan(-1);
        expect(shrineIdx).toBeGreaterThan(houseIdx);
    });

    test('imported per-player levels prefill correctly', () => {
        const editor = editorWithMount({ '/guild_shrines/spirit': 20 });
        editor.renderEditor();

        const input = editor._editorEl.querySelector('[data-shrine-hrid="/guild_shrines/spirit"]');
        expect(input.value).toBe('20');
    });

    test('level 0 (unset) shows 0 and is not counted as active', () => {
        const editor = editorWithMount();
        editor.renderEditor();

        const activeCountText = editor._editorEl.querySelector('[data-toggle="shrine-section"]').textContent;
        expect(activeCountText).toContain('0 active');
    });

    test('editing an input clamps to 0..maxLevel and writes back to the DTO', () => {
        const editor = editorWithMount();
        editor.renderEditor();
        editor._wireEditorEvents(editor._editorEl, editor._editedDTOs.player1);

        const input = editor._editorEl.querySelector('[data-shrine-hrid="/guild_shrines/force"]');
        input.value = '999';
        input.dispatchEvent(new Event('change'));

        expect(input.value).toBe('20');
        expect(editor._editedDTOs.player1.shrineLevels['/guild_shrines/force']).toBe(20);
    });

    test('setting level to 0 removes the key entirely rather than storing 0', () => {
        const editor = editorWithMount({ '/guild_shrines/force': 10 });
        editor.renderEditor();
        editor._wireEditorEvents(editor._editorEl, editor._editedDTOs.player1);

        const input = editor._editorEl.querySelector('[data-shrine-hrid="/guild_shrines/force"]');
        input.value = '0';
        input.dispatchEvent(new Event('change'));

        expect(editor._editedDTOs.player1.shrineLevels).not.toHaveProperty('/guild_shrines/force');
    });

    test("editing Player 1 does not touch Player 2's DTO", () => {
        const editor = editorWithMount({ '/guild_shrines/force': 5 });
        editor.renderEditor();
        editor._wireEditorEvents(editor._editorEl, editor._editedDTOs.player1);

        const input = editor._editorEl.querySelector('[data-shrine-hrid="/guild_shrines/force"]');
        input.value = '15';
        input.dispatchEvent(new Event('change'));

        expect(editor._editedDTOs.player1.shrineLevels['/guild_shrines/force']).toBe(15);
        expect(editor._editedDTOs.player2.shrineLevels).toEqual({});
    });
});
