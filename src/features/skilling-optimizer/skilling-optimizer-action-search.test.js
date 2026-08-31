/* @vitest-environment jsdom */
/**
 * Tests for the Skilling Optimizer/Simulator action-picker search filter: typing into the
 * search box filters visible action rows by name without changing what's actually selected.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    actions: [],
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        findSnapshotSelectionForActionType: vi.fn(() => ({ status: 'none', snapshot: null })),
        getUsableSnapshotByName: vi.fn(() => null),
        getAllSnapshots: vi.fn(() => []),
        resolveSnapshot: vi.fn(() => null),
    },
}));

vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));

vi.mock('./skilling-optimizer-engine.js', () => ({
    calculateSkillPerformance: vi.fn(),
    getSkillActionsForDisplay: vi.fn(() => mocks.actions),
    getItemsForSlot: vi.fn(() => []),
    getSkillDrinkItems: vi.fn(() => []),
    getPlayerSkillLevel: vi.fn(() => 1),
    optimizeSkill: vi.fn(),
    findOptimalTeas: vi.fn(),
    SKILL_NAMES: [],
    SKILLING_LOCATIONS: {},
    SLOT_DISPLAY_NAMES: {},
    SKILL_TOOL_LOCATION: {},
}));

const { SkillingSimulatorUI } = await import('./skilling-optimizer-ui.js');

function makeAnchor() {
    const parent = document.createElement('div');
    const anchorBtn = document.createElement('button');
    parent.appendChild(anchorBtn);
    document.body.appendChild(parent);
    return anchorBtn;
}

function action(name, hrid, overrides = {}) {
    return { name, hrid, available: true, requiredLevel: 1, ...overrides };
}

describe('action picker search filter', () => {
    beforeEach(() => {
        mocks.actions = [action('Redwood Tree', '/actions/redwood'), action('Oak Tree', '/actions/oak')];
    });

    function openPicker() {
        const ui = new SkillingSimulatorUI();
        ui.currentSkill = 'Woodcutting';
        ui.currentLevel = 50;
        const anchorBtn = makeAnchor();
        ui._openActionPicker(anchorBtn, () => 'label');
        return ui._picker;
    }

    test('renders a search input above the action rows', () => {
        const popup = openPicker();
        expect(popup.querySelector('input[type="text"]')).not.toBeNull();
    });

    test('typing filters rows by case-insensitive name match', () => {
        const popup = openPicker();
        const search = popup.querySelector('input[type="text"]');

        search.value = 'red';
        search.dispatchEvent(new Event('input'));

        const rows = [...popup.querySelectorAll('label')];
        const redwoodRow = rows.find((r) => r.textContent.includes('Redwood Tree'));
        const oakRow = rows.find((r) => r.textContent.includes('Oak Tree'));

        expect(redwoodRow.style.display).not.toBe('none');
        expect(oakRow.style.display).toBe('none');
    });

    test('filtering preserves the !important priority on display so the native page cannot reclaim the row layout', () => {
        const popup = openPicker();
        const search = popup.querySelector('input[type="text"]');

        search.value = 'red';
        search.dispatchEvent(new Event('input'));

        const rows = [...popup.querySelectorAll('label')];
        const redwoodRow = rows.find((r) => r.textContent.includes('Redwood Tree'));
        const oakRow = rows.find((r) => r.textContent.includes('Oak Tree'));

        expect(redwoodRow.style.getPropertyPriority('display')).toBe('important');
        expect(oakRow.style.getPropertyPriority('display')).toBe('important');
    });

    test('clearing the search shows every row again', () => {
        const popup = openPicker();
        const search = popup.querySelector('input[type="text"]');

        search.value = 'red';
        search.dispatchEvent(new Event('input'));
        search.value = '';
        search.dispatchEvent(new Event('input'));

        const rows = [...popup.querySelectorAll('label')];
        const oakRow = rows.find((r) => r.textContent.includes('Oak Tree'));
        expect(oakRow.style.display).not.toBe('none');
    });

    test('the All row is never hidden by the search filter', () => {
        const popup = openPicker();
        const search = popup.querySelector('input[type="text"]');

        search.value = 'nonexistent action name';
        search.dispatchEvent(new Event('input'));

        const rows = [...popup.querySelectorAll('label')];
        const allRow = rows.find((r) => r.textContent.trim() === 'All');
        expect(allRow.style.display).not.toBe('none');
    });

    test('filtering does not change actual selection state', () => {
        const ui = new SkillingSimulatorUI();
        ui.currentSkill = 'Woodcutting';
        ui.currentLevel = 50;
        const anchorBtn = makeAnchor();
        ui._openActionPicker(anchorBtn, () => 'label');
        const popup = ui._picker;
        const search = popup.querySelector('input[type="text"]');

        search.value = 'red';
        search.dispatchEvent(new Event('input'));

        expect(ui.selectedActionHrids).toBeNull(); // still "All" (unaffected by filtering alone)
    });
});
