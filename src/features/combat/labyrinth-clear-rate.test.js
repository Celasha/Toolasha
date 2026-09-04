/**
 * Tests for LabyrinthClearRate's Apply Skip feature (one-click apply-recommended-threshold).
 *
 * The Labyrinth Automation tab requires Edit -> adjust value -> Save per room, one server
 * request per Save. This forwards that same click sequence with the recommended value already
 * filled in, so repeatedly clicking one proxy button works through every mismatched room.
 *
 * The critical regression this guards against: the existing setting_updated handler wipes all
 * computed recommendations on ANY settings change (deliberately, since e.g. crate changes can
 * invalidate cached calculations). Our own Apply Skip save also fires setting_updated, so
 * without a fix, clicking Apply Skip once would immediately wipe every other room's
 * recommendation, breaking the repeat-click flow after the very first click.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn((_key, defaultValue) => defaultValue),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        characterData: { characterSetting: {} },
        getSkills: vi.fn(() => []),
        getInitClientData: vi.fn(() => ({})),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    buildPlayerDTO: vi.fn(),
    buildGameDataPayload: vi.fn(),
    applyLoadoutSnapshotToDTO: vi.fn(),
}));

vi.mock('../combat-sim/combat-sim-runner.js', () => ({
    runLabyrinthSimulation: vi.fn(),
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getSnapshotById: vi.fn(() => null),
        getUsableSnapshotById: vi.fn(() => null),
        onUpdate: vi.fn(),
        offUpdate: vi.fn(),
    },
}));

const { LabyrinthClearRate } = await import('./labyrinth-clear-rate.js');
const dataManager = (await import('../../core/data-manager.js')).default;
const loadoutState = (await import('../../core/loadout-state.js')).default;
const combatAdapter = await import('../combat-sim/combat-sim-adapter.js');
const simRunner = await import('../combat-sim/combat-sim-runner.js');

let savedCalls = [];

/**
 * Build a room row matching the real game's Automation tab markup (confirmed against a live
 * DOM snapshot): a skipThreshold cell showing "<span>value</span><button>Edit</button>" in view
 * mode, swapping to "-/+ buttons, a number input, <button>Save</button>" in edit mode. The fake
 * Save handler records the submitted value and reverts to view mode, mirroring the real
 * component's synchronous editingThresholdKey reset.
 */
function buildRoomRow({ roomHrid, isSkill, settingKey, currentValue }) {
    dataManager.characterData.characterSetting[settingKey] = currentValue;

    const tr = document.createElement('tr');

    const labelTd = document.createElement('td');
    const spriteFile = isSkill ? 'skills_sprite' : 'monsters_sprite';
    const slug = roomHrid.split('/').pop();
    labelTd.innerHTML = `
        <div class="LabyrinthPanel_roomLabel__Sju5O">
            <svg><use href="/static/media/${spriteFile}.abc123.svg#${slug}"></use></svg>
            <span>Room</span>
        </div>
    `;

    const loadoutTd = document.createElement('td');
    const thresholdTd = document.createElement('td');
    const cell = document.createElement('div');
    cell.className = 'LabyrinthPanel_skipThreshold__1qXz5';
    thresholdTd.appendChild(cell);

    function renderViewMode() {
        cell.innerHTML = `<span>≥ ${dataManager.characterData.characterSetting[settingKey]}</span>`;
        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', renderEditMode);
        cell.appendChild(editButton);
    }

    function renderEditMode() {
        cell.innerHTML = '';
        const minus = document.createElement('button');
        minus.textContent = '−';
        const plus = document.createElement('button');
        plus.textContent = '+';
        cell.appendChild(minus);
        cell.appendChild(plus);

        const input = document.createElement('input');
        input.type = 'number';
        input.value = String(dataManager.characterData.characterSetting[settingKey]);
        cell.appendChild(input);

        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        saveButton.addEventListener('click', () => {
            const value = Number(input.value);
            savedCalls.push({ roomHrid, settingKey, value });
            dataManager.characterData.characterSetting[settingKey] = value;
            renderViewMode();
        });
        cell.appendChild(saveButton);
    }

    renderViewMode();

    tr.appendChild(labelTd);
    tr.appendChild(loadoutTd);
    tr.appendChild(thresholdTd);
    return { tr, cell };
}

function buildAutomationTable(rooms) {
    const table = document.createElement('table');
    table.className = 'LabyrinthPanel_automationTable__abc';
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    const cells = rooms.map((room) => {
        const { tr, cell } = buildRoomRow(room);
        tbody.appendChild(tr);
        return cell;
    });

    document.body.appendChild(table);
    return cells;
}

beforeEach(() => {
    vi.clearAllMocks();
    savedCalls = [];
    document.body.innerHTML = '';
    dataManager.characterData = { characterSetting: {} };
    dataManager.getSkills.mockReset().mockReturnValue([]);
    dataManager.getInitClientData.mockReset().mockReturnValue({});
    loadoutState.getSnapshotById.mockReset().mockReturnValue(null);
    loadoutState.getUsableSnapshotById.mockReset().mockReturnValue(null);
    combatAdapter.buildPlayerDTO.mockReset();
    combatAdapter.buildGameDataPayload.mockReset();
    combatAdapter.applyLoadoutSnapshotToDTO.mockReset();
    simRunner.runLabyrinthSimulation.mockReset();
});

describe('loadout-state cache invalidation', () => {
    test('subscribes to effective loadout updates so Highest-mode inventory changes invalidate cached simulations', () => {
        const feature = new LabyrinthClearRate();
        feature.initialize();

        expect(loadoutState.onUpdate).toHaveBeenCalledWith(feature.loadoutsHandler);
        const handler = feature.loadoutsHandler;
        feature.combatCache.set('old', { clearChance: 1 });
        feature.recommendations.set('/monsters/test', { threshold: 10 });

        handler();

        expect(feature.combatCache.size).toBe(0);
        expect(feature.recommendations.size).toBe(0);

        feature.disable();
        expect(loadoutState.offUpdate).toHaveBeenCalledWith(handler);
    });

    test('an in-flight simulation cannot repopulate the cache with a pre-update effective loadout', async () => {
        const feature = new LabyrinthClearRate();
        feature.isInitialized = true;
        feature.buildCombatCacheKey = vi.fn(() => 'combat-key');
        feature.getLabyrinthLoadoutId = vi.fn(() => 123);
        feature.buildLabyrinthPlayerDTO = vi.fn(() => ({ name: 'player' }));
        feature.getCrateHrids = vi.fn(() => []);
        feature.getLabyrinthCombatBuffs = vi.fn(() => []);

        combatAdapter.buildGameDataPayload.mockReturnValue({});
        dataManager.getInitClientData.mockReturnValue({
            combatMonsterDetailMap: {
                '/monsters/test': { name: 'Test' },
            },
        });
        loadoutState.getUsableSnapshotById.mockReturnValue({ name: 'Highest Loadout' });

        let resolveOldSimulation;
        const oldSimulation = new Promise((resolve) => {
            resolveOldSimulation = resolve;
        });
        simRunner.runLabyrinthSimulation.mockReturnValueOnce(oldSimulation).mockResolvedValueOnce({
            labyAttemptCount: 2,
            encounters: 2,
            simulatedTime: 20e9,
        });

        const resultPromise = feature.computeCombatClear('/monsters/test', 100);
        expect(simRunner.runLabyrinthSimulation).toHaveBeenCalledTimes(1);

        // Model a Core effective-loadout update while the old (+5) worker is still running.
        // The cache was already empty, so this specifically verifies the in-flight race rather
        // than ordinary synchronous invalidation.
        feature.loadoutRevision += 1;
        feature.combatCache.clear();

        resolveOldSimulation({
            labyAttemptCount: 2,
            encounters: 0,
            simulatedTime: 20e9,
        });

        const result = await resultPromise;

        expect(simRunner.runLabyrinthSimulation).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ clearChance: 1, winRate: 1, loadoutName: 'Highest Loadout' });
        expect(feature.combatCache.get('combat-key')).toMatchObject({ clearChance: 1, winRate: 1 });
    });

    test('an effective loadout change aborts an in-flight recommendation run instead of publishing a partial result', async () => {
        const feature = new LabyrinthClearRate();
        const cell = document.createElement('div');
        cell.className = 'LabyrinthPanel_skipThreshold__test';
        document.body.appendChild(cell);
        feature.extractRoomHrid = vi.fn(() => '/monsters/test');

        let resolveThreshold;
        const pendingThreshold = new Promise((resolve) => {
            resolveThreshold = resolve;
        });
        feature.findRecommendedThresholdCombat = vi.fn(() => pendingThreshold);

        const run = feature.runRecommendations();
        expect(feature.recommendRunning).toBe(true);

        feature.loadoutRevision += 1;
        feature.recommendations.clear();
        resolveThreshold(42);
        await run;

        expect(feature.recommendations.size).toBe(0);
        expect(feature.recommendRunning).toBe(false);
    });
});

describe('loadout equipment resolution boundary', () => {
    test('fails closed instead of coercing an unresolved loadout enhancement to +0', () => {
        const feature = new LabyrinthClearRate();
        loadoutState.getUsableSnapshotById.mockReturnValueOnce({
            equipment: [
                {
                    itemHrid: '/items/milking_tool',
                    itemLocationHrid: '/item_locations/milking_tool',
                    enhancementLevel: null,
                },
            ],
        });
        dataManager.getInitClientData.mockReturnValueOnce({
            itemDetailMap: {
                '/items/milking_tool': {
                    equipmentDetail: {
                        noncombatStats: { actionSpeed: 0.1 },
                        noncombatEnhancementBonuses: { actionSpeed: 0.01 },
                    },
                },
            },
            enhancementLevelTotalBonusMultiplierTable: {},
        });

        expect(feature.getLoadoutEquipmentBuffs(123, 'milking')).toBeNull();
    });

    test('fails closed when saved equipment metadata is unavailable instead of simulating a partial loadout', () => {
        const feature = new LabyrinthClearRate();
        loadoutState.getUsableSnapshotById.mockReturnValueOnce({
            equipment: [
                {
                    itemHrid: '/items/milking_tool',
                    itemLocationHrid: '/item_locations/milking_tool',
                    enhancementLevel: 7,
                },
            ],
        });
        dataManager.getInitClientData.mockReturnValueOnce({ itemDetailMap: {} });

        expect(feature.getLoadoutEquipmentBuffs(123, 'milking')).toBeNull();
    });

    test('fails closed when game item metadata is not initialized for a non-empty saved loadout', () => {
        const feature = new LabyrinthClearRate();
        loadoutState.getUsableSnapshotById.mockReturnValueOnce({
            equipment: [
                {
                    itemHrid: '/items/milking_tool',
                    itemLocationHrid: '/item_locations/milking_tool',
                    enhancementLevel: 7,
                },
            ],
        });
        dataManager.getInitClientData.mockReturnValueOnce({});

        expect(feature.getLoadoutEquipmentBuffs(123, 'milking')).toBeNull();
    });
});

describe('signed labyrinth skip threshold semantics', () => {
    test('preserves native negative skill and combat skip thresholds instead of coercing them to zero', () => {
        const feature = new LabyrinthClearRate();
        dataManager.characterData.characterSetting = {
            labyrinthSkipMilking: -16,
            labyrinthSkipPyreHunter: -77,
        };

        expect(feature.getSkipThreshold('/skills/milking')).toBe(-16);
        expect(feature.getCombatSkipThreshold('/monsters/pyre_hunter')).toBe(-77);
    });

    test('maps signed skill thresholds to the same effectiveLevel + threshold - 1 room boundary as native MWI', () => {
        const feature = new LabyrinthClearRate();
        dataManager.characterData.characterSetting = { labyrinthSkipMilking: -16 };
        dataManager.getSkills.mockReturnValue([{ skillHrid: '/skills/milking', level: 60 }]);

        expect(feature.getTargetRoomLevel('/skills/milking')).toBe(43);

        dataManager.characterData.characterSetting.labyrinthSkipMilking = 0;
        expect(feature.getTargetRoomLevel('/skills/milking')).toBe(59);
    });

    test('maps signed combat thresholds instead of treating non-positive values as no room', () => {
        const feature = new LabyrinthClearRate();
        dataManager.characterData.characterSetting = { labyrinthSkipPyreHunter: -16 };
        dataManager.characterData.combatUnit = { combatDetails: { combatLevel: 60 } };

        expect(feature.getCombatRoomLevel('/monsters/pyre_hunter')).toBe(43);

        dataManager.characterData.characterSetting.labyrinthSkipPyreHunter = 0;
        expect(feature.getCombatRoomLevel('/monsters/pyre_hunter')).toBe(59);
    });

    test('keeps the clear-rate badge reachable for a negative current skill threshold', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/skills/milking',
                isSkill: true,
                settingKey: 'labyrinthSkipMilking',
                currentValue: -16,
            },
        ]);
        dataManager.getSkills.mockReturnValue([{ skillHrid: '/skills/milking', level: 60 }]);

        feature.injectOverlays();

        const badge = document.querySelector('.mwi-labyrinth-clear');
        expect(badge).not.toBeNull();
        expect(badge.textContent).not.toBe('...');
    });

    test('keeps the combat clear-rate simulation reachable for a negative current threshold', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/monsters/pyre_hunter',
                isSkill: false,
                settingKey: 'labyrinthSkipPyreHunter',
                currentValue: -22,
            },
        ]);
        dataManager.characterData.combatUnit = { combatDetails: { combatLevel: 60 } };
        feature.processSimQueue = vi.fn();

        feature.injectOverlays();

        const badge = document.querySelector('.mwi-labyrinth-clear');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('...');
        expect(feature.simQueue).toHaveLength(1);
        expect(feature.simQueue[0]).toMatchObject({
            monsterHrid: '/monsters/pyre_hunter',
            roomLevel: 37,
        });
    });
});

describe('getRoomsNeedingSkipUpdate', () => {
    test('returns only rooms whose current threshold differs from the recommendation', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
            { roomHrid: '/skills/foraging', isSkill: true, settingKey: 'labyrinthSkipForaging', currentValue: 20 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });
        feature.recommendations.set('/skills/foraging', { threshold: 20 });

        const rooms = feature.getRoomsNeedingSkipUpdate();

        expect(rooms).toHaveLength(1);
        expect(rooms[0].roomHrid).toBe('/skills/milking');
        expect(rooms[0].recommendedThreshold).toBe(15);
    });

    test('does not re-queue an already-correct negative recommendation forever', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/monsters/pyre_hunter',
                isSkill: false,
                settingKey: 'labyrinthSkipPyreHunter',
                currentValue: -22,
            },
        ]);
        feature.recommendations.set('/monsters/pyre_hunter', { threshold: -22 });

        expect(feature.getRoomsNeedingSkipUpdate()).toEqual([]);
    });

    test('returns an empty array when no recommendations have been computed', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
        ]);

        expect(feature.getRoomsNeedingSkipUpdate()).toEqual([]);
    });
});

describe('applyNextRecommendedSkip', () => {
    test('forwards Edit then Save with the recommended value, resulting in exactly one save', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });

        feature.applyNextRecommendedSkip();

        expect(savedCalls).toHaveLength(1);
        expect(savedCalls[0]).toEqual({ roomHrid: '/skills/milking', settingKey: 'labyrinthSkipMilking', value: 15 });
        expect(dataManager.characterData.characterSetting.labyrinthSkipMilking).toBe(15);
    });

    test('applies a negative recommendation once, then advances to the next mismatched room', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/monsters/pyre_hunter',
                isSkill: false,
                settingKey: 'labyrinthSkipPyreHunter',
                currentValue: 17,
            },
            {
                roomHrid: '/monsters/frost_sniper',
                isSkill: false,
                settingKey: 'labyrinthSkipFrostSniper',
                currentValue: 10,
            },
        ]);
        feature.recommendations.set('/monsters/pyre_hunter', { threshold: -22 });
        feature.recommendations.set('/monsters/frost_sniper', { threshold: 44 });

        feature.applyNextRecommendedSkip();
        expect(savedCalls).toEqual([
            { roomHrid: '/monsters/pyre_hunter', settingKey: 'labyrinthSkipPyreHunter', value: -22 },
        ]);
        expect(feature.getRoomsNeedingSkipUpdate().map((room) => room.roomHrid)).toEqual(['/monsters/frost_sniper']);

        feature.applyNextRecommendedSkip();
        expect(savedCalls[1]).toEqual({
            roomHrid: '/monsters/frost_sniper',
            settingKey: 'labyrinthSkipFrostSniper',
            value: 44,
        });
        expect(feature.getRoomsNeedingSkipUpdate()).toEqual([]);
    });

    test('does nothing when every visible room already matches its recommendation', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 15 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });

        feature.applyNextRecommendedSkip();

        expect(savedCalls).toHaveLength(0);
    });

    test('does not touch a room that is already being edited manually (avoids discarding unsaved input)', () => {
        const feature = new LabyrinthClearRate();
        const [cell] = buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });

        // Simulate the user having manually clicked Edit themselves and typed something unsaved.
        cell.querySelector('button').click(); // clicks the real Edit button, entering edit mode
        cell.querySelector('input').value = '999';

        feature.applyNextRecommendedSkip();

        expect(savedCalls).toHaveLength(0);
        expect(cell.querySelector('input').value).toBe('999'); // untouched
    });

    test('sets the correct settingKey/value for a combat room', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/monsters/fire_sprite',
                isSkill: false,
                settingKey: 'labyrinthSkipFireSprite',
                currentValue: 0,
            },
        ]);
        feature.recommendations.set('/monsters/fire_sprite', { threshold: 42 });

        feature.applyNextRecommendedSkip();

        expect(savedCalls).toEqual([
            { roomHrid: '/monsters/fire_sprite', settingKey: 'labyrinthSkipFireSprite', value: 42 },
        ]);
    });
});

describe('settingHandler self-triggered-save exemption', () => {
    test('does not clear recommendations when the event confirms our own Apply Skip save', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
            { roomHrid: '/skills/foraging', isSkill: true, settingKey: 'labyrinthSkipForaging', currentValue: 20 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });
        feature.recommendations.set('/skills/foraging', { threshold: 30 });
        feature.initialize();

        feature.applyNextRecommendedSkip();
        feature.settingHandler({ characterSetting: { ...dataManager.characterData.characterSetting } });

        expect(feature.recommendations.size).toBe(2);
        expect(feature.recommendations.get('/skills/foraging')).toEqual({ threshold: 30 });
    });

    test('preserves recommendations when a negative Apply Skip value is confirmed exactly', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/monsters/pyre_hunter',
                isSkill: false,
                settingKey: 'labyrinthSkipPyreHunter',
                currentValue: 17,
            },
            {
                roomHrid: '/monsters/frost_sniper',
                isSkill: false,
                settingKey: 'labyrinthSkipFrostSniper',
                currentValue: 10,
            },
        ]);
        feature.recommendations.set('/monsters/pyre_hunter', { threshold: -22 });
        feature.recommendations.set('/monsters/frost_sniper', { threshold: 44 });
        feature.initialize();

        feature.applyNextRecommendedSkip();
        feature.settingHandler({ characterSetting: { ...dataManager.characterData.characterSetting } });

        expect(feature.recommendations.size).toBe(2);
        expect(feature.getRoomsNeedingSkipUpdate().map((room) => room.roomHrid)).toEqual(['/monsters/frost_sniper']);
    });

    test('still clears recommendations for an unrelated/external setting change', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });
        feature.initialize();

        feature.settingHandler({ characterSetting: { labyrinthTeaCrateHrid: '/items/some_crate' } });

        expect(feature.recommendations.size).toBe(0);
    });

    test('clears recommendations if the confirmed value does not match what we expected (stale/mismatched confirmation)', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });
        feature.initialize();

        feature.applyNextRecommendedSkip();
        // Confirmation arrives showing a different value than what we just applied.
        feature.settingHandler({ characterSetting: { labyrinthSkipMilking: 999 } });

        expect(feature.recommendations.size).toBe(0);
    });
});

describe('_updateApplyButtonState', () => {
    test('enables the button and shows the remaining count when rooms need updating', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 5 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });

        const button = document.createElement('button');
        button.id = 'mwi-apply-skip-btn';
        document.body.appendChild(button);

        feature._updateApplyButtonState();

        expect(button.textContent).toBe('Apply Skip (1)');
        expect(button.disabled).toBe(false);
    });

    test('disables the button and shows zero when nothing needs updating', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            { roomHrid: '/skills/milking', isSkill: true, settingKey: 'labyrinthSkipMilking', currentValue: 15 },
        ]);
        feature.recommendations.set('/skills/milking', { threshold: 15 });

        const button = document.createElement('button');
        button.id = 'mwi-apply-skip-btn';
        document.body.appendChild(button);

        feature._updateApplyButtonState();

        expect(button.textContent).toBe('Apply Skip (0)');
        expect(button.disabled).toBe(true);
    });

    test('does not count an already-matching negative row as still pending', () => {
        const feature = new LabyrinthClearRate();
        buildAutomationTable([
            {
                roomHrid: '/monsters/pyre_hunter',
                isSkill: false,
                settingKey: 'labyrinthSkipPyreHunter',
                currentValue: -22,
            },
        ]);
        feature.recommendations.set('/monsters/pyre_hunter', { threshold: -22 });

        const button = document.createElement('button');
        button.id = 'mwi-apply-skip-btn';
        document.body.appendChild(button);

        feature._updateApplyButtonState();

        expect(button.textContent).toBe('Apply Skip (0)');
        expect(button.disabled).toBe(true);
    });
});

describe('skilling/enhancing success chance floor matches the in-game guide minimum (5%)', () => {
    const zeroMetrics = () => ({
        skillLevelBonus: 0,
        efficiencyBonus: 0,
        actionSpeedBonus: 0,
        successBonus: -1,
        doubleProgressBonus: 0,
    });

    test('computeSkillingClearWithParams never reports a success chance below 5%', () => {
        const feature = new LabyrinthClearRate();
        const result = feature.computeSkillingClearWithParams(zeroMetrics(), 1, 100);

        expect(result.successChance).toBe(0.05);
    });

    test('computeEnhancingClearWithParams never reports a success chance below 5%', () => {
        const feature = new LabyrinthClearRate();
        const result = feature.computeEnhancingClearWithParams(zeroMetrics(), 1, 100);

        expect(result.successChance).toBe(0.05);
    });
});
