import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    applyLoadoutSnapshotToDTO: vi.fn(),
}));

vi.mock('./combat-sim-adapter.js', () => ({
    buildGameDataPayload: vi.fn(() => ({})),
    buildAllPlayerDTOs: vi.fn(),
    parseShykaiImport: vi.fn(),
    applyLoadoutSnapshotToDTO: (...args) => mocks.applyLoadoutSnapshotToDTO(...args),
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getAllSnapshots: vi.fn(() => []),
    },
}));

import { SimEditor } from './sim-editor.js';

function editorWithState() {
    const editor = new SimEditor({ editorEl: null });
    editor._activeEditPlayer = 'player1';
    editor._originalDTOs = { player1: { equipment: { original: true } } };
    editor._editedDTOs = { player1: { equipment: { previous: true } } };
    editor._selectedLoadoutName = 'Previous';
    editor._unavailableLoadoutName = '';
    return editor;
}

describe('SimEditor manual loadout selection semantics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('an unavailable manual selection keeps the previous simulation and selection identity', () => {
        const editor = editorWithState();
        const before = structuredClone(editor._editedDTOs);
        mocks.applyLoadoutSnapshotToDTO.mockReturnValue(false);

        expect(editor._applyEditorLoadoutSelection('Unavailable')).toBe(false);

        expect(editor._editedDTOs).toEqual(before);
        expect(editor.getSelectedLoadoutName()).toBe('Previous');
        expect(editor._loadoutStatusMessage).toContain('Unavailable');
        expect(editor._loadoutStatusMessage).toContain('Previous simulation kept');
    });

    test('an unavailable persisted/programmatic loadout becomes a blocking selection', () => {
        const editor = editorWithState();
        const before = structuredClone(editor._editedDTOs);
        mocks.applyLoadoutSnapshotToDTO.mockReturnValue(false);

        expect(editor.applyLoadoutByName('Native Lab Loadout')).toBe(false);

        expect(editor._editedDTOs).toEqual(before);
        expect(editor.getSelectedLoadoutName()).toBe('Previous');
        expect(editor.getUnavailableLoadoutName()).toBe('Native Lab Loadout');
        expect(editor._loadoutStatusMessage).toContain('Simulation is blocked');
    });

    test('explicit Current Gear clears a blocking persisted loadout and restores the live baseline', () => {
        const editor = editorWithState();
        editor._unavailableLoadoutName = 'Native Lab Loadout';

        expect(editor.applyLoadoutByName('')).toBe(true);

        expect(editor._editedDTOs.player1).toEqual(editor._originalDTOs.player1);
        expect(editor.getSelectedLoadoutName()).toBe('');
        expect(editor.getUnavailableLoadoutName()).toBe('');
        expect(editor._loadoutStatusMessage).toBe('');
    });

    test('Current Gear is only restored when the user explicitly selects it', () => {
        const editor = editorWithState();

        expect(editor._applyEditorLoadoutSelection('')).toBe(true);

        expect(editor._editedDTOs.player1).toEqual(editor._originalDTOs.player1);
        expect(editor._editedDTOs.player1).not.toBe(editor._originalDTOs.player1);
        expect(editor.getSelectedLoadoutName()).toBe('');
        expect(editor._loadoutStatusMessage).toBe('');
        expect(mocks.applyLoadoutSnapshotToDTO).not.toHaveBeenCalled();
    });

    test('a successful named selection becomes the new explicit simulation baseline', () => {
        const editor = editorWithState();
        mocks.applyLoadoutSnapshotToDTO.mockReturnValue(true);

        expect(editor._applyEditorLoadoutSelection('Fresh')).toBe(true);

        expect(editor.getSelectedLoadoutName()).toBe('Fresh');
        expect(editor._loadoutStatusMessage).toBe('');
    });
});
