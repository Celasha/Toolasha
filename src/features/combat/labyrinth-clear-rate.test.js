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

vi.mock('./loadout-snapshot.js', () => ({ default: {} }));

const { LabyrinthClearRate } = await import('./labyrinth-clear-rate.js');
const dataManager = (await import('../../core/data-manager.js')).default;

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
    savedCalls = [];
    document.body.innerHTML = '';
    dataManager.characterData = { characterSetting: {} };
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
});
