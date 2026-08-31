/* @vitest-environment jsdom */
/**
 * Tests for Skilling Simulator/Optimizer per-Skill loadout retargeting (TLA-024/OPT-24).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    selectionByActionType: new Map(), // actionTypeHrid -> {status, snapshot}
    usableByName: new Map(), // name -> snapshot
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        findSnapshotSelectionForActionType: vi.fn(
            (actionTypeHrid) => mocks.selectionByActionType.get(actionTypeHrid) || { status: 'none', snapshot: null }
        ),
        getUsableSnapshotByName: vi.fn((name) => mocks.usableByName.get(name) || null),
        getAllSnapshots: vi.fn(() => []),
        resolveSnapshot: vi.fn(() => null),
    },
}));

vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));

const { SkillingSimulatorUI } = await import('./skilling-optimizer-ui.js');

function usableSnapshot(name, { equipment = [], drinks = [] } = {}) {
    return { name, isUsableForCalculation: true, equipment, drinks };
}

describe('per-Skill loadout retargeting (TLA-024/OPT-24)', () => {
    beforeEach(() => {
        mocks.selectionByActionType = new Map();
        mocks.usableByName = new Map();
    });

    test('a usable canonical loadout seeds Simulator equipment/drinks and Optimizer Compare together', () => {
        const snap = usableSnapshot('Forager Set', {
            equipment: [{ itemHrid: '/items/axe', itemLocationHrid: '/item_locations/main_hand', enhancementLevel: 4 }],
            drinks: [{ itemHrid: '/items/foraging_tea' }, {}, {}],
        });
        mocks.selectionByActionType.set('/action_types/foraging', { status: 'usable', snapshot: snap });
        mocks.usableByName.set('Forager Set', snap);

        const ui = new SkillingSimulatorUI();
        ui.currentSkill = 'Foraging';
        ui._ensureRetargetedForCurrentSkill();

        expect(ui.equipment.get('/item_locations/main_hand')).toEqual({ itemHrid: '/items/axe', enhancementLevel: 4 });
        expect(ui.teas).toEqual(['/items/foraging_tea', null, null]);
        expect(ui.optimizerLoadout).toBe(snap);
        expect(ui._simulatorLoadoutUnavailableName).toBeNull();
    });

    test('no preferred loadout for the Skill starts a clean "No loadout" scenario for both modes', () => {
        const ui = new SkillingSimulatorUI();
        ui.currentSkill = 'Milking';
        ui._ensureRetargetedForCurrentSkill();

        expect(ui.equipment.size).toBe(0);
        expect(ui.teas).toEqual([null, null, null]);
        expect(ui.optimizerLoadout).toBeNull();
        expect(ui._simulatorLoadoutUnavailableName).toBeNull();
    });

    test('an unavailable preferred loadout fails closed and is not substituted with Current Gear/+0/stale gear', () => {
        mocks.selectionByActionType.set('/action_types/woodcutting', {
            status: 'unavailable',
            snapshot: { name: 'Old Woodcutting Set', isUsableForCalculation: false },
        });

        const ui = new SkillingSimulatorUI();
        // Simulate stale gear from a previously selected Skill still sitting in memory.
        ui.equipment = new Map([['/item_locations/main_hand', { itemHrid: '/items/old_axe', enhancementLevel: 10 }]]);
        ui.teas = ['/items/old_tea', null, null];
        ui.optimizerLoadout = { name: 'Some Other Loadout' };

        ui.currentSkill = 'Woodcutting';
        ui._ensureRetargetedForCurrentSkill();

        expect(ui.equipment.size).toBe(0);
        expect(ui.teas).toEqual([null, null, null]);
        expect(ui._simulatorLoadoutUnavailableName).toBe('Old Woodcutting Set');
        // Represented as unavailable (existing "(Unavailable)" rendering path), not dropped or
        // silently replaced by a different baseline.
        expect(ui.optimizerLoadout).toEqual({ name: 'Old Woodcutting Set' });
    });

    test('fallback priority: skill default -> all-skills default -> skill non-default -> all non-default -> none', () => {
        // findSnapshotSelectionForActionType already implements and owns this priority order in
        // Core (loadout-state.js) - this proves the UI defers to it rather than reimplementing
        // the rule locally, by driving the mock through each tier for a fresh Skill each time.
        const tiers = ['skill default', 'all-skills default', 'skill non-default', 'all non-default'];
        for (const tierName of tiers) {
            const snap = usableSnapshot(tierName);
            mocks.selectionByActionType.set('/action_types/cooking', { status: 'usable', snapshot: snap });
            mocks.usableByName.set(tierName, snap);

            const ui = new SkillingSimulatorUI();
            ui.currentSkill = 'Cooking';
            ui._ensureRetargetedForCurrentSkill();

            expect(ui.optimizerLoadout.name).toBe(tierName);
        }
    });

    test('manual override after auto-selection is preserved until the next actual Skill change', () => {
        const snap = usableSnapshot('Auto Seeded');
        mocks.selectionByActionType.set('/action_types/brewing', { status: 'usable', snapshot: snap });
        mocks.usableByName.set('Auto Seeded', snap);

        const ui = new SkillingSimulatorUI();
        ui.currentSkill = 'Brewing';
        ui._ensureRetargetedForCurrentSkill();
        expect(ui._retargetedForSkill).toBe('Brewing');

        // Manual edit after auto-selection.
        ui.equipment.set('/item_locations/main_hand', { itemHrid: '/items/manual_pick', enhancementLevel: 0 });

        // An unrelated call (e.g. a panel rebuild from switching mode) for the SAME Skill must not
        // re-seed and wipe the manual edit.
        ui._ensureRetargetedForCurrentSkill();
        expect(ui.equipment.get('/item_locations/main_hand')).toEqual({
            itemHrid: '/items/manual_pick',
            enhancementLevel: 0,
        });
    });
});

describe('_makeCostPaybackEl - recommendation price / marginal gain / payback display', () => {
    test('returns null when there is no cost and no incomplete-price flag', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeCostPaybackEl(0, false, 100, 0, null)).toBeNull();
    });

    test('shows just the cost when there is no XP or Gold gain to rate it against', () => {
        const ui = new SkillingSimulatorUI();
        const el = ui._makeCostPaybackEl(2_000_000, false, 0, 0, null);
        expect(el.textContent).toContain('Cost: 2.0M');
        expect(el.textContent).not.toContain('Payback');
        expect(el.textContent).not.toContain('per 1M gold');
    });

    test('shows marginal XP gain per gold spent alongside cost', () => {
        const ui = new SkillingSimulatorUI();
        // 500 XP/hr gained for a 2M gold cost -> 250 XP/hr per 1M gold spent.
        const el = ui._makeCostPaybackEl(2_000_000, false, 500, 0, null);
        expect(el.textContent).toContain('250 XP/hr per 1M gold');
    });

    test('shows payback time derived from the Gold/hr gain', () => {
        const ui = new SkillingSimulatorUI();
        // 1,000,000 gold cost / 100,000 gold/hr gain = 10 hours to break even.
        const el = ui._makeCostPaybackEl(1_000_000, false, 0, 100_000, null);
        expect(el.textContent).toContain('Payback: 10h');
    });

    test('an unresolved price is marked incomplete and never backs a ratio built on an unknown number', () => {
        const ui = new SkillingSimulatorUI();
        const el = ui._makeCostPaybackEl(0, true, 500, 100_000, null);
        expect(el.textContent).toContain('~');
        expect(el.textContent).not.toContain('per 1M gold');
        expect(el.textContent).not.toContain('Payback');
    });

    test('a negative or zero gain never produces a ratio, even when cost is known', () => {
        const ui = new SkillingSimulatorUI();
        const el = ui._makeCostPaybackEl(1_000_000, false, -50, 0, null);
        expect(el.textContent).toContain('Cost: 1.0M');
        expect(el.textContent).not.toContain('per 1M gold');
        expect(el.textContent).not.toContain('Payback');
    });
});
