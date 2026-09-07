/* @vitest-environment jsdom */

// TLA-038: the profile overlay panel is content-sized (~180-280px) but positionPanel() used to
// assume a fixed 220px width, causing a false gap on normal profiles and a ~60px overlap with the
// native modal when the Equipment-hidden panel expanded to 280px. positionPanel() now measures the
// panel's actual rendered width instead of assuming a constant.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
const { default: config } = await import('../../core/config.js');
const { calculateCombatScore } = await import('./score-calculator.js');
const { default: loadoutState } = await import('../../core/loadout-state.js');
loadoutState.getAllSnapshots = vi.fn(() => []);

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

function makeScoreData({ equipmentHidden = false, hasEquipmentData = true, total = 100 } = {}) {
    return {
        equipmentHidden,
        hasEquipmentData,
        total,
        complete: true,
        house: 10,
        houseComplete: true,
        ability: 20,
        abilityComplete: true,
        equipment: 70,
        equipmentComplete: true,
        skillerTotal: 5,
        skillerComplete: true,
        skillerEquipment: 5,
        skillerEquipmentComplete: true,
        breakdown: { houses: [], abilities: [], equipment: [] },
        skillerBreakdown: { equipment: [] },
    };
}

function makeFullScoreData(overrides = {}) {
    return {
        equipmentHidden: false,
        hasEquipmentData: true,
        total: 930,
        complete: true,
        house: 100,
        houseComplete: true,
        ability: 50,
        abilityComplete: true,
        equipment: 700,
        equipmentComplete: true,
        shrine: 80,
        shrineComplete: true,
        breakdown: {
            houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
            abilities: [{ name: 'Fireball 5', value: '50.0', complete: true }],
            equipment: [{ name: 'Sword +10', value: '700.0', complete: true }],
            shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true }],
        },
        skillerTotal: 40,
        skillerComplete: true,
        skillerHouse: 20,
        skillerHouseComplete: true,
        skillerEquipment: 15,
        skillerEquipmentComplete: true,
        skillerShrine: 5,
        skillerShrineComplete: true,
        skillerBreakdown: {
            houses: [{ name: 'Garden 1', value: '20.0', complete: true }],
            equipment: [{ name: 'Hoe', value: '15.0', complete: true }],
            shrines: [{ name: 'Shrine of Wisdom 1', value: '5.0', complete: true }],
        },
        ...overrides,
    };
}

describe('showScorePanel lifecycle (PROF-LAYOUT-09/10/11)', () => {
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

    test('PROF-LAYOUT-11 / LB-08: no "(Equipment hidden)" top-line phrase; expanded Equipment renders N/A + tooltip', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);

        combatScore.showScorePanel(
            { profile: {} },
            makeScoreData({ equipmentHidden: true, hasEquipmentData: false }),
            modal
        );

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).not.toContain('(Equipment hidden)');
        expect(panel.innerHTML).toContain('Combat Score: 100');
        expect(panel.querySelector('#mwi-equipment-toggle').innerHTML).toContain('N/A');
        expect(panel.querySelector('#mwi-equipment-toggle').innerHTML).toContain(
            'Equipment is hidden in this profile, so it is not included in the Score.'
        );
    });
});

describe('showScorePanel TLA-041 additions (Shrines / Skiller Houses / partial suffix)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        Element.prototype.getBoundingClientRect = function () {
            if (this.id === 'mwi-combat-score-panel') return mockRect({ width: 235 });
            return mockRect({ left: 500, right: 700, top: 30 });
        };
    });

    test('renders Combat Shrines, Skiller Houses, and Skiller Shrines rows', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData(), modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.querySelector('#mwi-shrine-toggle')).not.toBeNull();
        expect(panel.querySelector('#mwi-skiller-house-toggle')).not.toBeNull();
        expect(panel.querySelector('#mwi-skiller-shrine-toggle')).not.toBeNull();
        expect(panel.innerHTML).toContain('Shrine of Force 1: 80.0');
        expect(panel.innerHTML).toContain('Garden 1: 20.0');
        expect(panel.innerHTML).toContain('Shrine of Wisdom 1: 5.0');
    });

    test('all new detail sections start collapsed, matching the existing sections', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData(), modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.querySelector('#mwi-shrine-breakdown').style.display).toBe('none');
        expect(panel.querySelector('#mwi-skiller-house-breakdown').style.display).toBe('none');
        expect(panel.querySelector('#mwi-skiller-shrine-breakdown').style.display).toBe('none');
    });

    test('TLA041D-01: a complete result shows no "+" suffix on either top-level total', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData(), modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0');
        expect(panel.innerHTML).not.toContain('930.0+');
        expect(panel.innerHTML).toContain('Skiller Score: 40.0');
        expect(panel.innerHTML).not.toContain('40.0+');
        expect(panel.innerHTML).toContain('House: 100.0');
        expect(panel.innerHTML).not.toContain('House: 100.0+');
    });

    test('TLA041D-02: only Combat House incomplete propagates top -> House only', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel(
            { profile: {} },
            makeFullScoreData({ complete: false, houseComplete: false }),
            modal
        );

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('House: 100.0+');
        // Unaffected Combat categories stay exact-looking.
        expect(panel.innerHTML).toContain('Ability: 50.0');
        expect(panel.innerHTML).not.toContain('Ability: 50.0+');
        expect(panel.innerHTML).toContain('Equipment: 700.0');
        expect(panel.innerHTML).not.toContain('Equipment: 700.0+');
        expect(panel.innerHTML).toContain('Shrines: 80.0');
        expect(panel.innerHTML).not.toContain('Shrines: 80.0+');
        // Skiller branch is independent.
        expect(panel.innerHTML).toContain('Skiller Score: 40.0');
        expect(panel.innerHTML).not.toContain('Skiller Score: 40.0+');
    });

    test('an incomplete Skiller result shows the "+" suffix on the Skiller total only, independent of Combat', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData({ skillerComplete: false }), modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Skiller Score: 40.0+');
        expect(panel.innerHTML).toContain('Combat Score: 930.0');
        expect(panel.innerHTML).not.toContain('930.0+');
    });

    test('the explanatory viewer-relative tooltip is present on both top-level toggles', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData(), modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        const scoreToggle = panel.querySelector('#mwi-score-toggle');
        const skillerToggle = panel.querySelector('#mwi-skiller-score-toggle');
        expect(scoreToggle.getAttribute('title')).toContain('reproduce this persistent build');
        expect(skillerToggle.getAttribute('title')).toContain('reproduce this persistent build');
    });

    test('no Achievements row and no combined grand total are rendered', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData(), modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).not.toContain('Achievement');
        expect(panel.innerHTML).not.toContain('Grand Total');
    });
});

describe('Profile Score category lower-bound propagation matrix (TLA-041D)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        Element.prototype.getBoundingClientRect = function () {
            if (this.id === 'mwi-combat-score-panel') return mockRect({ width: 280 });
            return mockRect({ left: 500, right: 700, top: 30 });
        };
    });

    test('TLA041D-03: only Combat Ability incomplete propagates top -> Ability only, with the affected leaf marked', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            complete: false,
            abilityComplete: false,
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: false }],
                equipment: [{ name: 'Sword +10', value: '700.0', complete: true }],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('Ability: 50.0+');
        expect(panel.innerHTML).toContain('Fireball 5: 50.0+');
        expect(panel.innerHTML).toContain('House: 100.0');
        expect(panel.innerHTML).not.toContain('House: 100.0+');
        expect(panel.innerHTML).toContain('Equipment: 700.0');
        expect(panel.innerHTML).not.toContain('Equipment: 700.0+');
    });

    test('TLA041D-04: only Combat Equipment incomplete with a numeric lower-bound leaf', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            complete: false,
            equipmentComplete: false,
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: true }],
                equipment: [
                    { name: 'Sword +10', value: '400.0', complete: true },
                    { name: 'Shield +8', value: '300.0', complete: false },
                ],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('Equipment: 700.0+');
        expect(panel.innerHTML).toContain('Sword +10: 400.0');
        expect(panel.innerHTML).not.toContain('Sword +10: 400.0+');
        expect(panel.innerHTML).toContain('Shield +8: 300.0+');
        expect(panel.innerHTML).toContain('House: 100.0');
        expect(panel.innerHTML).not.toContain('House: 100.0+');
    });

    test('TLA041D-05: Combat Equipment has an unpriceable leaf - N/A, never a substituted zero', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            complete: false,
            equipmentComplete: false,
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: true }],
                equipment: [
                    { name: 'Sword +10', value: '400.0', complete: true },
                    { name: 'Cursed Ring', value: null, complete: false, reason: 'No route priced' },
                ],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Equipment: 700.0+');
        expect(panel.innerHTML).toContain('Cursed Ring: N/A');
        expect(panel.innerHTML).not.toContain('Cursed Ring: 0');
    });

    test('TLA041D-06: only Combat Shrine incomplete propagates top -> Shrines only', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            complete: false,
            shrineComplete: false,
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: true }],
                equipment: [{ name: 'Sword +10', value: '700.0', complete: true }],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: false }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('Shrines: 80.0+');
        expect(panel.innerHTML).toContain('Shrine of Force 1: 80.0+');
        expect(panel.innerHTML).toContain('House: 100.0');
        expect(panel.innerHTML).not.toContain('House: 100.0+');
        expect(panel.innerHTML).toContain('Equipment: 700.0');
        expect(panel.innerHTML).not.toContain('Equipment: 700.0+');
    });

    test('TLA041D-08: only Skiller Equipment incomplete propagates Skiller top -> Skiller Equipment, leaf provenance visible', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            skillerComplete: false,
            skillerEquipmentComplete: false,
            skillerBreakdown: {
                houses: [{ name: 'Garden 1', value: '20.0', complete: true }],
                equipment: [{ name: 'Hoe', value: '15.0', complete: false }],
                shrines: [{ name: 'Shrine of Wisdom 1', value: '5.0', complete: true }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Skiller Score: 40.0+');
        const skillerEquipmentToggle = panel.querySelector('#mwi-skiller-equipment-toggle');
        expect(skillerEquipmentToggle.innerHTML).toContain('15.0+');
        expect(panel.innerHTML).toContain('Hoe: 15.0+');
        // Skiller House/Shrines and the Combat branch remain unaffected.
        const skillerHouseToggle = panel.querySelector('#mwi-skiller-house-toggle');
        expect(skillerHouseToggle.textContent).toContain('20.0');
        expect(skillerHouseToggle.textContent).not.toContain('20.0+');
        expect(panel.innerHTML).toContain('Combat Score: 930.0');
        expect(panel.innerHTML).not.toContain('930.0+');
    });

    test('TLA041D-09: only Skiller Shrine incomplete propagates Skiller top -> Skiller Shrines only', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            skillerComplete: false,
            skillerShrineComplete: false,
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Skiller Score: 40.0+');
        const skillerShrineToggle = panel.querySelector('#mwi-skiller-shrine-toggle');
        expect(skillerShrineToggle.textContent).toContain('5.0+');
        expect(panel.innerHTML).toContain('House: 20.0');
        expect(panel.innerHTML).not.toContain('House: 20.0+');
        const skillerEquipmentToggle = panel.querySelector('#mwi-skiller-equipment-toggle');
        expect(skillerEquipmentToggle.innerHTML).toContain('15.0');
        expect(skillerEquipmentToggle.innerHTML).not.toContain('15.0+');
    });

    test('TLA041D-10: the same incomplete equipment leaf classified into both domains marks both Equipment categories and both top totals', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            complete: false,
            equipmentComplete: false,
            skillerComplete: false,
            skillerEquipmentComplete: false,
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: true }],
                equipment: [{ name: 'Dual-Purpose Tool +5', value: '300.0', complete: false }],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true }],
            },
            skillerBreakdown: {
                houses: [{ name: 'Garden 1', value: '20.0', complete: true }],
                equipment: [{ name: 'Dual-Purpose Tool +5', value: '300.0', complete: false }],
                shrines: [{ name: 'Shrine of Wisdom 1', value: '5.0', complete: true }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('Skiller Score: 40.0+');
        expect(panel.innerHTML).toContain('Equipment: 700.0+');
        const skillerEquipmentToggle = panel.querySelector('#mwi-skiller-equipment-toggle');
        expect(skillerEquipmentToggle.innerHTML).toContain('15.0+');
    });

    test('TLA041D-11: wholly hidden Equipment keeps both top totals "+" and Equipment N/A + info, never N/A+ or a deceptive zero', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            complete: false,
            skillerComplete: false,
            equipmentHidden: true,
            hasEquipmentData: false,
            equipment: 0,
            skillerEquipment: 0,
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('Skiller Score: 40.0+');
        const equipmentToggle = panel.querySelector('#mwi-equipment-toggle');
        expect(equipmentToggle.innerHTML).toContain('N/A');
        expect(equipmentToggle.innerHTML).not.toContain('N/A+');
        expect(equipmentToggle.innerHTML).not.toContain('0.0');
        expect(equipmentToggle.innerHTML).toContain('Equipment is hidden in this profile');
    });

    test('TLA041D-12: aggregate-only incompleteness still marks category and top total without a fabricated leaf', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        // The calculator can only prove House incompleteness at the aggregate level here - every
        // individual room leaf still reports complete: true, matching a real "aggregate-only"
        // calculator result. No leaf is invented merely to satisfy provenance depth.
        const scoreData = makeFullScoreData({
            complete: false,
            houseComplete: false,
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: true }],
                equipment: [{ name: 'Sword +10', value: '700.0', complete: true }],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true }],
            },
        });
        combatScore.showScorePanel({ profile: {} }, scoreData, modal);

        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 930.0+');
        expect(panel.innerHTML).toContain('House: 100.0+');
        expect(panel.innerHTML).toContain('Dojo 3: 100.0');
        expect(panel.innerHTML).not.toContain('Dojo 3: 100.0+');
    });
});

describe('handleProfileOpen - async shell lifecycle (TLA-041C PSP-01/02/16/17)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        Element.prototype.getBoundingClientRect = function () {
            if (this.id === 'mwi-combat-score-panel') return mockRect({ width: 280 });
            return mockRect({ left: 500, right: 700, top: 30 });
        };
        vi.stubGlobal('requestAnimationFrame', (cb) => {
            cb();
            return 0;
        });
        calculateCombatScore.mockReset();
        config.getSetting.mockImplementation(() => false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        config.getSetting.mockImplementation(() => false);
    });

    test('PSP-01: the Score shell (loading text + action buttons) exists before the Score promise resolves', async () => {
        calculateCombatScore.mockResolvedValueOnce(makeScoreData());
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const generation = ++combatScore.profileGeneration;

        const openPromise = combatScore.handleProfileOpen({ profile: {} }, modal, generation);

        // Shell creation happens synchronously, before the function's first await.
        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel).not.toBeNull();
        expect(panel.innerHTML).toContain('Combat Score: Calculating');
        expect(panel.innerHTML).toContain('Skiller Score: Calculating');
        expect(panel.querySelector('#mwi-sim-character-btn')).not.toBeNull();
        expect(panel.querySelector('#mwi-score-details')).toBeNull(); // nothing to expand yet

        await openPromise;
        expect(document.getElementById('mwi-combat-score-panel').innerHTML).toContain('Combat Score: 100');
    });

    test('PSP-02: Abilities & Triggers panel is not gated behind Score resolution', async () => {
        config.getSetting.mockImplementation((key) => key === 'abilitiesTriggers');
        const spy = vi.spyOn(combatScore, 'showAbilitiesTriggersPanel').mockImplementation(() => {});
        calculateCombatScore.mockResolvedValueOnce(makeScoreData());
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const generation = ++combatScore.profileGeneration;

        const openPromise = combatScore.handleProfileOpen({ profile: {} }, modal, generation);
        expect(spy).toHaveBeenCalledTimes(1); // called before Score is even requested to resolve

        await openPromise;
    });

    test("PSP-16: a stale profile A resolving after profile B opened must never overwrite B's panel", async () => {
        let resolveA;
        let resolveB;
        calculateCombatScore.mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
        calculateCombatScore.mockImplementationOnce(() => new Promise((r) => (resolveB = r)));

        const modalA = document.createElement('div');
        document.body.appendChild(modalA);
        const genA = ++combatScore.profileGeneration;
        const openA = combatScore.handleProfileOpen(
            { profile: { sharableCharacter: { name: 'Alice' } } },
            modalA,
            genA
        );

        const modalB = document.createElement('div');
        document.body.appendChild(modalB);
        const genB = ++combatScore.profileGeneration;
        const openB = combatScore.handleProfileOpen({ profile: { sharableCharacter: { name: 'Bob' } } }, modalB, genB);

        await vi.waitFor(() => expect(resolveB).toBeTypeOf('function'));

        resolveB(makeScoreData({ total: 42 }));
        await openB;
        resolveA(makeScoreData({ total: 999 }));
        await openA;

        expect(document.querySelectorAll('#mwi-combat-score-panel')).toHaveLength(1);
        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.innerHTML).toContain('Combat Score: 42');
        expect(panel.innerHTML).not.toContain('999');
    });

    test('PSP-17: closing the panel while Score is pending does not resurrect it', async () => {
        calculateCombatScore.mockResolvedValueOnce(makeScoreData());
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const generation = ++combatScore.profileGeneration;

        const openPromise = combatScore.handleProfileOpen({ profile: {} }, modal, generation);

        // User closes the panel while Score is still pending.
        combatScore.currentPanel.remove();
        combatScore.currentPanel = null;

        await openPromise;

        expect(document.getElementById('mwi-combat-score-panel')).toBeNull();
    });
});

describe('findNativeProfileModal - outer modal anchor (TLA-041C rev2 PSP-23)', () => {
    test('resolves the visible outer SharableProfile modal, not the inner Overview TabPanel', () => {
        document.body.innerHTML = `
            <div class="SharableProfile_modalContainer__abc">
                <div class="SharableProfile_modal__xyz" id="outer-modal">
                    <div class="SharableProfile_modalContent__def">
                        <div class="TabPanel_tabPanel__ghi">
                            <div class="SharableProfile_overviewTab__W4dCV" id="profile-panel"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const profilePanel = document.getElementById('profile-panel');
        const resolved = combatScore.findNativeProfileModal(profilePanel);
        expect(resolved.id).toBe('outer-modal');
    });

    test('falls back to the generic Modal chain when no outer SharableProfile modal class exists', () => {
        document.body.innerHTML = `
            <div class="Modal_modalContent__Iw0Yv" id="fallback-modal">
                <div class="SharableProfile_overviewTab__W4dCV" id="profile-panel"></div>
            </div>
        `;
        const profilePanel = document.getElementById('profile-panel');
        const resolved = combatScore.findNativeProfileModal(profilePanel);
        expect(resolved.id).toBe('fallback-modal');
    });
});

describe('positionPanel - rev2 exact runtime geometry fixture (PSP-23/24/25)', () => {
    test('280px panel anchored to the outer modal rect produces exactly an 8px gap and top-edge alignment', () => {
        const panel = makePanel(280);
        combatScore.positionPanel(panel, makeModal({ left: 652.5, right: 1074.5, top: 212.5 }));
        expect(panel.style.left).toBe('364.5px'); // 652.5 - 280 - 8
        expect(panel.style.top).toBe('212.5px');
        expect(parseFloat(panel.style.left) + 280 + 8).toBeCloseTo(652.5);
    });

    test("never anchors to the inner TabPanel rect (right=655.5 is the old bug's signature)", () => {
        const panel = makePanel(280);
        combatScore.positionPanel(panel, makeModal({ left: 652.5, right: 1074.5, top: 212.5 }));
        const right = parseFloat(panel.style.left) + 280;
        expect(right).not.toBeCloseTo(655.5);
        expect(right).toBeCloseTo(644.5);
    });

    test('PSP-26: a viewport too narrow for either side shrinks only for viewport safety, never overlapping the modal', () => {
        vi.stubGlobal('innerWidth', 700);
        const panel = makePanel(280);
        combatScore.positionPanel(panel, makeModal({ left: 50, right: 650, top: 20 }));

        const width = parseFloat(panel.style.width);
        expect(width).toBeGreaterThan(0);
        expect(width).toBeLessThan(280);
        const left = parseFloat(panel.style.left);
        // Fully inside the viewport and not overlapping the modal on whichever side was chosen.
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + width <= 50 - 8 + 0.001 || left >= 650 + 8 - 0.001).toBe(true);

        vi.unstubAllGlobals();
    });
});

describe('rev2 stable geometry - width invariance across every panel state (PSP-18/21/22)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        Element.prototype.getBoundingClientRect = function () {
            if (this.id === 'mwi-combat-score-panel') return mockRect({ width: 280 });
            return mockRect({ left: 500, right: 700, top: 30 });
        };
    });

    afterEach(() => {
        config.getSetting.mockImplementation(() => false);
    });

    test('PSP-18: the loading shell and the final resolved Score share the exact same CSS width', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);

        const panel = combatScore.showScorePanel({ profile: {} }, null, modal);
        expect(panel.style.width).toBe('280px');

        combatScore.updateScorePanel(panel, { profile: {} }, makeFullScoreData(), modal);
        expect(panel.style.width).toBe('280px');
    });

    test('PSP-21: own-profile loadout buttons becoming visible does not change the panel CSS width', () => {
        config.getSetting.mockImplementation((key) => key === 'characterCard');
        loadoutState.getAllSnapshots.mockReturnValue([
            { name: 'Loadout 1', isUsableForCalculation: true, actionTypeHrid: '/action_types/combat' },
        ]);
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const profileData = { profile: { sharableCharacter: { id: '__not_own__', name: 'Me' } } };

        combatScore.showScorePanel(profileData, makeFullScoreData(), modal);
        const panel = document.getElementById('mwi-combat-score-panel');
        expect(panel.style.width).toBe('280px');

        const loadoutBtn = panel.querySelector('#mwi-character-card-loadout-btn');
        expect(loadoutBtn.style.display).toBe(''); // revealed for own character
        expect(panel.style.width).toBe('280px'); // unchanged after reveal

        loadoutState.getAllSnapshots.mockReturnValue([]);
    });

    test('PSP-22: a 16-character (incl. wide-character) name does not change panel width', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const profileData = { profile: { sharableCharacter: { name: '⒲ⒾⒹⒺⒸⒽⒶⒹⒺⒹⓝⓐⓝⓝⓒⓘ' } } };

        const panel = combatScore.showScorePanel(profileData, makeFullScoreData(), modal);
        expect(panel.style.width).toBe('280px');
    });

    test('equipment-hidden state does not change panel width', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);

        const panel = combatScore.showScorePanel(
            { profile: {} },
            makeFullScoreData({ equipmentHidden: true, hasEquipmentData: false }),
            modal
        );
        expect(panel.style.width).toBe('280px');
    });

    test('collapsed vs expanded top-level rows does not change panel width (expansion is display:none toggling only)', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel({ profile: {} }, makeFullScoreData(), modal);
        const panel = document.getElementById('mwi-combat-score-panel');

        panel.querySelector('#mwi-score-toggle').click();
        expect(panel.style.width).toBe('280px');
    });
});

describe('lower-bound leaf rendering (TLA-041C LB-01/02/03/08)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        Element.prototype.getBoundingClientRect = function () {
            if (this.id === 'mwi-combat-score-panel') return mockRect({ width: 280 });
            return mockRect({ left: 500, right: 700, top: 30 });
        };
    });

    test('LB-02/03: an N/A leaf and a positive-partial "+" leaf both render distinctly in the breakdown', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        const scoreData = makeFullScoreData({
            breakdown: {
                houses: [{ name: 'Dojo 3', value: '100.0', complete: true, reason: null }],
                abilities: [{ name: 'Fireball 5', value: '50.0', complete: true, reason: null }],
                equipment: [
                    { name: 'Item A', value: '410.0', complete: true, reason: null },
                    {
                        name: 'Item B',
                        value: null,
                        complete: false,
                        reason: 'No complete acquisition route could be priced',
                    },
                    { name: 'Item C', value: '300.0', complete: false, reason: null },
                ],
                shrines: [{ name: 'Shrine of Force 1', value: '80.0', complete: true, reason: null }],
            },
        });

        combatScore.showScorePanel({ profile: {} }, scoreData, modal);
        const panel = document.getElementById('mwi-combat-score-panel');

        expect(panel.innerHTML).toContain('Item A: 410.0');
        expect(panel.innerHTML).toContain('Item B: N/A');
        expect(panel.innerHTML).toContain('No complete acquisition route could be priced');
        expect(panel.innerHTML).toContain('Item C: 300.0+');
    });

    test('LB-08: hidden equipment with no payload renders "Equipment: N/A" with an info tooltip, never a numeric 0', () => {
        const modal = document.createElement('div');
        document.body.appendChild(modal);
        combatScore.showScorePanel(
            { profile: {} },
            makeFullScoreData({ equipmentHidden: true, hasEquipmentData: false, equipment: 0, skillerEquipment: 0 }),
            modal
        );

        const panel = document.getElementById('mwi-combat-score-panel');
        const equipmentToggle = panel.querySelector('#mwi-equipment-toggle');
        const skillerEquipmentToggle = panel.querySelector('#mwi-skiller-equipment-toggle');

        expect(equipmentToggle.innerHTML).toContain('N/A');
        expect(equipmentToggle.innerHTML).not.toContain('0.0');
        expect(equipmentToggle.innerHTML).toContain('Equipment is hidden in this profile');
        expect(skillerEquipmentToggle.innerHTML).toContain('N/A');
        expect(skillerEquipmentToggle.innerHTML).not.toContain('0.0');
    });
});
