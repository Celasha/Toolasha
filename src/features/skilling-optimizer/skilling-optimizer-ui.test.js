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

describe('Equipment Progression table cell builders (Cost/Profit/XP-ratio/Payback columns)', () => {
    test('_makeCostCell shows a dash placeholder when there is no cost and no incomplete-price flag', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeCostCell(0, false, null).textContent).toBe('—');
    });

    test('_makeCostCell shows the formatted cost', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeCostCell(2_000_000, false, null).textContent).toContain('2.0M');
    });

    test('_makeCostCell marks an unresolved price as approximate with a leading "~"', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeCostCell(0, true, null).textContent).toContain('~');
    });

    test('_makeDeltaCell shows a dash when there is no gain over baseline', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeDeltaCell(0, 10_000, null).textContent).toBe('—');
        expect(ui._makeDeltaCell(-50, 10_000, null).textContent).toBe('—');
        expect(ui._makeDeltaCell(50, 0, null).textContent).toBe('—');
    });

    test('_makeDeltaCell shows the raw gain and a gain percentage', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeDeltaCell(600, 10_000, null).textContent).toBe('+600 (+6.0%)');
    });

    test('_makeXpRatioCell shows a dash without a cost, a gain, or a baseline to divide by', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeXpRatioCell(500, 100_000, 0, false).textContent).toBe('—');
        expect(ui._makeXpRatioCell(-50, 100_000, 1_000_000, false).textContent).toBe('—');
        expect(ui._makeXpRatioCell(500, 0, 1_000_000, false).textContent).toBe('—');
    });

    test('_makeXpRatioCell shows gold cost per 0.01 percentage point of XP/hr gain', () => {
        const ui = new SkillingSimulatorUI();
        // 5% XP gain (pctPoints = (5,000/100,000)*100 = 5) for a 1M gold cost.
        // 5 / 0.01 = 500 increments; 1M / 500 = 2,000.
        expect(ui._makeXpRatioCell(5_000, 100_000, 1_000_000, false).textContent).toBe('2.0K');
    });

    test('_makeXpRatioCell marks an incomplete cost as approximate', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeXpRatioCell(5_000, 100_000, 1_000_000, true).textContent).toBe('~2.0K');
    });

    test('_makeProfitRatioCell shows a dash without a cost, a gain, or a baseline to divide by', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makeProfitRatioCell(0, 10_000, 1_000_000, false).textContent).toBe('—');
        expect(ui._makeProfitRatioCell(500, 0, 1_000_000, false).textContent).toBe('—');
        expect(ui._makeProfitRatioCell(500, 10_000, 0, false).textContent).toBe('—');
    });

    test('_makeProfitRatioCell shows gold cost per 0.01 percentage point of Gold/hr gain', () => {
        const ui = new SkillingSimulatorUI();
        // 5% gold gain (500 pct-points... i.e. 500 * 0.01% increments) for a 1M gold cost.
        // pctPoints = (5_000/100_000)*100 = 5; 5 / 0.01 = 500 increments; 1M / 500 = 2,000.
        expect(ui._makeProfitRatioCell(5_000, 100_000, 1_000_000, false).textContent).toBe('2.0K');
    });

    test('_makePaybackCell shows a dash without a cost or a real Gold/hr gain', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makePaybackCell(0, false, 100_000).textContent).toBe('—');
        expect(ui._makePaybackCell(1_000_000, false, 0).textContent).toBe('—');
    });

    test('_makePaybackCell shows a compact payback time derived from the Gold/hr gain', () => {
        const ui = new SkillingSimulatorUI();
        // 1,000,000 gold cost / 100,000 gold/hr gain = 10 hours to break even.
        expect(ui._makePaybackCell(1_000_000, false, 100_000).textContent).toBe('10h');
    });

    test('_makePaybackCell marks an unresolved price as approximate', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._makePaybackCell(1_000_000, true, 100_000).textContent).toBe('~10h');
    });
});

describe('_computeSlotMetrics - Equipment Progression sort metrics', () => {
    function makeSlotData(entryOverrides) {
        return {
            name: 'Test Slot',
            candidateCount: 1,
            progression: [
                {
                    breakpoint: 7,
                    enhancementLevel: 7,
                    itemHrid: '/items/test_item',
                    itemName: 'Test Item',
                    score: 0,
                    hasMissingPrice: false,
                    cost: 0,
                    costIsIncomplete: false,
                    xpScore: 0,
                    goldScore: 0,
                    isChange: true,
                    ...entryOverrides,
                },
            ],
        };
    }

    test('no breakpoint beats baseline -> entry is null and every derived metric is unranked', () => {
        const ui = new SkillingSimulatorUI();
        const slotData = makeSlotData({ xpScore: 100, goldScore: 0 });
        const metrics = ui._computeSlotMetrics(slotData, /* xpBaseline */ 100, /* goldBaseline */ 0);
        expect(metrics.entry).toBeNull();
        expect(metrics.xpPerMillion).toBeNull();
        expect(metrics.paybackHours).toBeNull();
    });

    test('XP gain over a real cost produces XP/hr-per-1M-gold and a gain percentage', () => {
        const ui = new SkillingSimulatorUI();
        const slotData = makeSlotData({ cost: 2_000_000, xpScore: 10_600, goldScore: 0 });
        const metrics = ui._computeSlotMetrics(slotData, 10_000, 0);
        expect(metrics.entry).not.toBeNull();
        expect(metrics.xpDelta).toBe(600);
        expect(metrics.xpPct).toBeCloseTo(6);
        expect(metrics.xpPerMillion).toBeCloseTo(300);
        expect(metrics.paybackHours).toBeNull();
    });

    test('Gold gain over a real cost produces a payback time in hours', () => {
        const ui = new SkillingSimulatorUI();
        const slotData = makeSlotData({ cost: 1_000_000, xpScore: 0, goldScore: 100_000 });
        const metrics = ui._computeSlotMetrics(slotData, 0, 0);
        expect(metrics.paybackHours).toBe(10);
        expect(metrics.xpPerMillion).toBeNull();
    });

    test('a zero net cost with a real gain is the best possible ratio, not an absent one', () => {
        const ui = new SkillingSimulatorUI();
        const slotData = makeSlotData({ cost: 0, xpScore: 500, goldScore: 500 });
        const metrics = ui._computeSlotMetrics(slotData, 0, 0);
        expect(metrics.xpPerMillion).toBe(Infinity);
        expect(metrics.paybackHours).toBe(0);
    });

    test('an unresolved required price never backs a ratio, even with a positive delta', () => {
        const ui = new SkillingSimulatorUI();
        const slotData = makeSlotData({ cost: 1_000_000, costIsIncomplete: true, xpScore: 500, goldScore: 500 });
        const metrics = ui._computeSlotMetrics(slotData, 0, 0);
        expect(metrics.xpPerMillion).toBeNull();
        expect(metrics.paybackHours).toBeNull();
    });
});

describe('_sortValueFor - Equipment Progression sort ordering', () => {
    test('a slot with nothing actionable always sorts last, regardless of mode', () => {
        const ui = new SkillingSimulatorUI();
        for (const mode of ['value', 'payback', 'cost', 'xpGain', 'goldGain']) {
            expect(ui._sortValueFor({ entry: null }, 'xp', mode)).toBe(Infinity);
        }
    });

    test('"payback" mode ranks by paybackHours ascending, with no-payback rows unranked', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._sortValueFor({ entry: {}, paybackHours: 5 }, 'xp', 'payback')).toBe(5);
        expect(ui._sortValueFor({ entry: {}, paybackHours: null }, 'xp', 'payback')).toBe(Infinity);
    });

    test('"cost" mode ranks by raw cost ascending', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._sortValueFor({ entry: {}, cost: 2_000_000 }, 'xp', 'cost')).toBe(2_000_000);
    });

    test('"xpGain"/"goldGain" modes rank by percentage descending (negated for ascending sort)', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._sortValueFor({ entry: {}, xpPct: 6 }, 'xp', 'xpGain')).toBe(-6);
        expect(ui._sortValueFor({ entry: {}, goldPct: 12 }, 'xp', 'goldGain')).toBe(-12);
    });

    test('"value" mode uses XP/hr-per-gold for an XP-goal skill and payback for a Gold-goal skill', () => {
        const ui = new SkillingSimulatorUI();
        expect(ui._sortValueFor({ entry: {}, xpPerMillion: 300 }, 'xp', 'value')).toBe(-300);
        expect(ui._sortValueFor({ entry: {}, xpPerMillion: null }, 'xp', 'value')).toBe(Infinity);
        expect(ui._sortValueFor({ entry: {}, paybackHours: 10 }, 'gold', 'value')).toBe(10);
        expect(ui._sortValueFor({ entry: {}, paybackHours: null }, 'gold', 'value')).toBe(Infinity);
    });
});

describe('_renderOptimizerResults - Equipment Progression sort control', () => {
    function makeSlot(name, { cost, xpDelta, xpBaseline }) {
        return {
            name,
            candidateCount: 1,
            progression: [
                {
                    breakpoint: 7,
                    enhancementLevel: 7,
                    itemHrid: `/items/${name.toLowerCase()}`,
                    itemName: name,
                    score: xpBaseline + xpDelta,
                    hasMissingPrice: false,
                    cost,
                    costIsIncomplete: false,
                    xpScore: xpBaseline + xpDelta,
                    goldScore: 0,
                    isChange: true,
                },
            ],
        };
    }

    function slotLabelOrder(container) {
        return [...container.querySelectorAll('tbody tr')]
            .map((tr) => tr.querySelector('td')?.querySelector('span')?.textContent)
            .filter((t) => ['Alpha', 'Bravo', 'Charlie'].includes(t));
    }

    function buildResult() {
        const xpBaseline = 10_000;
        return {
            goal: 'xp',
            xpBaseline,
            goldBaseline: 0,
            slots: {
                '/item_locations/a': makeSlot('Alpha', { cost: 3_000_000, xpDelta: 600, xpBaseline }),
                '/item_locations/b': makeSlot('Bravo', { cost: 1_000_000, xpDelta: 100, xpBaseline }),
                '/item_locations/c': makeSlot('Charlie', { cost: 500_000, xpDelta: 1_000, xpBaseline }),
            },
        };
    }

    test('defaults to "Best Value" (XP/hr per gold, descending) ahead of raw slot order', () => {
        const ui = new SkillingSimulatorUI();
        const container = document.createElement('div');
        ui._renderOptimizerResults(container, buildResult(), null, null);
        // Ratios: Charlie 2000, Alpha 200, Bravo 100 - not the raw a/b/c insertion order.
        expect(slotLabelOrder(container)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    });

    test('switching to "Cost (cheapest)" re-renders in ascending cost order without re-Optimizing', () => {
        const ui = new SkillingSimulatorUI();
        const container = document.createElement('div');
        ui._renderOptimizerResults(container, buildResult(), null, null);

        const select = container.querySelector('select');
        select.value = 'cost';
        select.dispatchEvent(new Event('change'));

        // Costs: Charlie 500k, Bravo 1M, Alpha 3M.
        expect(slotLabelOrder(container)).toEqual(['Charlie', 'Bravo', 'Alpha']);
        expect(ui.optimizerSortMode).toBe('cost');
    });

    test('"Slot Order" preserves the original insertion order', () => {
        const ui = new SkillingSimulatorUI();
        const container = document.createElement('div');
        ui.optimizerSortMode = 'slot';
        ui._renderOptimizerResults(container, buildResult(), null, null);
        expect(slotLabelOrder(container)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });
});
