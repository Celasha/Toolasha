/* @vitest-environment jsdom */

// TLA-038: the profile overlay panel is content-sized (~180-280px) but positionPanel() used to
// assume a fixed 220px width, causing a false gap on normal profiles and a ~60px overlap with the
// native modal when the Equipment-hidden panel expanded to 280px. positionPanel() now measures the
// panel's actual rendered width instead of assuming a constant.

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        onSettingChange: vi.fn(),
        getSetting: vi.fn(() => false),
        Z_FLOATING_PANEL: 1000,
        COLOR_ACCENT: '#fff',
        COLOR_PROFIT: '#0f0',
        COLOR_LOSS: '#f00',
        COLOR_TEXT_SECONDARY: '#aaa',
        COLOR_TEXT_PRIMARY: '#fff',
    },
}));
vi.mock('../../core/data-manager.js', () => ({ default: { getCurrentCharacterId: vi.fn(() => '__not_own__') } }));
vi.mock('../../core/storage.js', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../core/websocket.js', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('./score-calculator.js', () => ({ calculateCombatScore: vi.fn() }));
vi.mock('../../utils/formatters.js', () => ({ numberFormatter: (v) => String(v) }));
vi.mock('../combat/combat-sim-export.js', () => ({ constructExportObject: vi.fn() }));
vi.mock('../combat/milkonomy-export.js', () => ({ constructMilkonomyExport: vi.fn() }));
vi.mock('./character-card-button.js', () => ({
    handleViewCardClick: vi.fn(),
    handleViewCardFromSnapshot: vi.fn(),
}));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: vi.fn(() => ({ clearAll: vi.fn(), setTimeout: vi.fn(), setInterval: vi.fn() })),
}));
vi.mock('../../core/loadout-state.js', () => ({ default: {} }));
vi.mock('../combat-sim/combat-sim-ui.js', () => ({ default: {} }));
vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    buildPlayerDTOFromProfile: vi.fn(),
    mapLoadoutAbilitiesToNativeSlots: vi.fn(),
}));

const { default: combatScore } = await import('./combat-score.js');

function mockRect({ left = 0, right = 0, top = 0, width = 0 } = {}) {
    return { left, right, top, width, bottom: 0, height: 0, x: left, y: top, toJSON: () => ({}) };
}

// Pure geometry unit tests: duck-typed panel/modal — positionPanel() only reads
// getBoundingClientRect() and writes style.left/top, so no real DOM is required here.
function makePanel(width) {
    return { style: {}, getBoundingClientRect: () => mockRect({ width }) };
}
function makeModal({ left, right, top = 0 }) {
    return { getBoundingClientRect: () => mockRect({ left, right, top }) };
}

describe('positionPanel geometry (TLA-038 PROF-LAYOUT)', () => {
    test('PROF-LAYOUT-01: actual width 180px with enough left space uses 180px, gap preserved', () => {
        const panel = makePanel(180);
        combatScore.positionPanel(panel, makeModal({ left: 300, right: 500, top: 50 }));
        expect(panel.style.left).toBe('112px'); // 300 - 180 - 8
        expect(panel.style.top).toBe('50px');
    });

    test('PROF-LAYOUT-02: actual width 220px matches historical nominal geometry', () => {
        const panel = makePanel(220);
        combatScore.positionPanel(panel, makeModal({ left: 300, right: 500 }));
        expect(panel.style.left).toBe('72px'); // 300 - 220 - 8
    });

    test('PROF-LAYOUT-03: actual width 280px with enough left space uses 280px and does not overlap', () => {
        const panel = makePanel(280);
        combatScore.positionPanel(panel, makeModal({ left: 400, right: 600 }));
        expect(panel.style.left).toBe('112px'); // 400 - 280 - 8
        expect(parseFloat(panel.style.left) + 280).toBeLessThanOrEqual(400 - 8);
    });

    test('PROF-LAYOUT-04: left has room for the old fixed 220px but not the actual 280px -> right fallback', () => {
        // modal.left = 238 exactly satisfies the old (fixed 220) left-fit check (238-8-220=10),
        // but the actual 280px panel does not fit (238-8-280=-50), so it must fall back right.
        const panel = makePanel(280);
        combatScore.positionPanel(panel, makeModal({ left: 238, right: 600 }));
        expect(panel.style.left).toBe('608px'); // 600 + 8
    });

    test('PROF-LAYOUT-05: right fallback places panel at modal.right + gap', () => {
        const panel = makePanel(180);
        combatScore.positionPanel(panel, makeModal({ left: 5, right: 400 }));
        expect(panel.style.left).toBe('408px');
    });

    test('PROF-LAYOUT-06: sequential 180 -> 280 widths never reuse a stale prior measurement', () => {
        const modal = makeModal({ left: 400, right: 600 });
        combatScore.positionPanel(makePanel(180), modal);
        const secondPanel = makePanel(280);
        combatScore.positionPanel(secondPanel, modal);
        expect(secondPanel.style.left).toBe('112px'); // 400 - 280 - 8
    });

    test('PROF-LAYOUT-07: sequential 280 -> 180 widths never reuse a stale max-width assumption', () => {
        const modal = makeModal({ left: 400, right: 600 });
        combatScore.positionPanel(makePanel(280), modal);
        const secondPanel = makePanel(180);
        combatScore.positionPanel(secondPanel, modal);
        expect(secondPanel.style.left).toBe('212px'); // 400 - 180 - 8
    });

    test('PROF-LAYOUT-08: arbitrary content-driven width uses the measured width, not a state-specific branch', () => {
        const panel = makePanel(235.4);
        combatScore.positionPanel(panel, makeModal({ left: 500, right: 700 }));
        expect(panel.style.left).toBe(`${500 - 235.4 - 8}px`);
    });
});

describe('positionAbilitiesPanel companion audit (TLA-038 PROF-LAYOUT-12)', () => {
    test('already uses actual rendered width (offsetWidth) and is unaffected by the TLA-038 fix', () => {
        vi.stubGlobal('innerHeight', 800);
        const panel = { style: {}, offsetWidth: 280, offsetHeight: 150 };
        const modal = { getBoundingClientRect: () => mockRect({ left: 100, right: 400, top: 0, width: 300 }) };
        combatScore.positionAbilitiesPanel(panel, modal);
        // Centered under modal using its own offsetWidth: modalCenter=250, left=250-280/2=110
        expect(panel.style.left).toBe('110px');
        expect(panel.style.top).toBe('640px'); // 800 - 150 - 10
        vi.unstubAllGlobals();
    });
});

describe('showScorePanel lifecycle (PROF-LAYOUT-09/10/11)', () => {
    function makeScoreData({ equipmentHidden = false, hasEquipmentData = true } = {}) {
        return {
            equipmentHidden,
            hasEquipmentData,
            total: 100,
            house: 10,
            ability: 20,
            equipment: 70,
            skillerTotal: 5,
            skillerEquipment: 5,
            breakdown: { houses: [], abilities: [], equipment: [] },
            skillerBreakdown: { equipment: [] },
        };
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        // jsdom performs no layout, so every element reports a zero-rect unless told otherwise.
        // Give the panel a distinct, non-fixed width to prove positioning reads *this* element's
        // live geometry rather than a cached/default/fixed value.
        Element.prototype.getBoundingClientRect = function () {
            if (this.id === 'mwi-combat-score-panel') return mockRect({ width: 235 });
            return mockRect({ left: 500, right: 700, top: 30 });
        };
    });

    test('PROF-LAYOUT-09: repeated open/close/remount leaves exactly one panel, positioned from live geometry', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);

        combatScore.showScorePanel({ profile: {} }, makeScoreData(), modal);
        combatScore.showScorePanel({ profile: {} }, makeScoreData(), modal);

        const panels = document.body.querySelectorAll('#mwi-combat-score-panel');
        expect(panels.length).toBe(1);
        expect(panels[0].style.left).toBe(`${500 - 235 - 8}px`);
    });

    test('PROF-LAYOUT-10: modal cleanup wiring remains intact', async () => {
        const { createMutationWatcher } = await import('../../utils/dom-observer-helpers.js');
        const modal = document.createElement('div');
        document.body.appendChild(modal);

        combatScore.showScorePanel({ profile: {} }, makeScoreData(), modal);

        expect(createMutationWatcher).toHaveBeenCalled();
    });

    test('PROF-LAYOUT-11: Equipment-hidden text remains present and score math is unchanged by the geometry fix', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);

        combatScore.showScorePanel(
            { profile: {} },
            makeScoreData({ equipmentHidden: true, hasEquipmentData: false }),
            modal
        );

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('(Equipment hidden)');
        expect(panel.innerHTML).toContain('Combat Score: 100');
    });
});
