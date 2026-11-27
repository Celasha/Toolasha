// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const handlers = vi.hoisted(() => ({}));
const dataHandlers = vi.hoisted(() => ({}));
const queue = vi.hoisted(() => ({ actions: [] }));

vi.mock('../../core/websocket.js', () => ({
    default: {
        on: vi.fn((event, handler) => {
            handlers[event] = handler;
        }),
        off: vi.fn(),
    },
}));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));
vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn((event, handler) => {
            dataHandlers[event] = handler;
        }),
        off: vi.fn(),
        getCurrentActions: vi.fn(() => queue.actions),
        getActionDetails: vi.fn(),
    },
}));
vi.mock('../../core/i18n.js', () => ({ t: (key, params) => `${key}:${params?.attempt ?? ''}` }));

const { default: counter } = await import('./combat-battle-counter.js');

const LAB_ACTION = { id: 1, actionHrid: '/actions/labyrinth/explore', isDone: false, currentCount: 0 };
const COOK_ACTION = { id: 2, actionHrid: '/actions/cooking/peach_yogurt', isDone: false, currentCount: 0 };

function labyrinthUpdate(roomType, entryCount) {
    return {
        labyrinth: {
            isActive: true,
            pathData: JSON.stringify([{ x: 0, y: 0 }]),
            roomData: [[{ roomType, entryCount }]],
        },
    };
}

describe('combat battle counter - labyrinth attempts', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div class="Header_currentAction__x"><div class="Header_actionName__y"></div></div>`;
        queue.actions = [LAB_ACTION];
        counter.initialize();
    });

    afterEach(() => {
        counter.disable();
        document.body.innerHTML = '';
    });

    test('shows the attempt number in a combat room', () => {
        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/combat', 3));
        expect(document.getElementById('mwi-battle-counter').textContent).toBe('combatBattleCounter.attemptLabel:3');
    });

    test('shows the attempt number in a skilling room', () => {
        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/woodcutting', 4));
        expect(document.getElementById('mwi-battle-counter').textContent).toBe('combatBattleCounter.attemptLabel:4');
    });

    test('shows nothing before the room has been entered', () => {
        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/woodcutting', 0));
        expect(document.getElementById('mwi-battle-counter')).toBeNull();
    });

    test('is cleared when the labyrinth run ends and a queued action takes over', () => {
        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/combat', 1));
        expect(document.getElementById('mwi-battle-counter')).not.toBeNull();

        // The queued action was already in the queue, so it is not part of the update message
        queue.actions = [COOK_ACTION];
        dataHandlers.actions_updated({ endCharacterActions: [{ ...LAB_ACTION, isDone: true }] });

        expect(document.getElementById('mwi-battle-counter')).toBeNull();
    });

    test('is cleared when the next action already has progress', () => {
        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/combat', 1));

        const resumed = { ...COOK_ACTION, currentCount: 5 };
        queue.actions = [resumed];
        dataHandlers.actions_updated({ endCharacterActions: [{ ...LAB_ACTION, isDone: true }, resumed] });

        expect(document.getElementById('mwi-battle-counter')).toBeNull();
    });

    test('stays while the labyrinth run is still the current action', () => {
        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/combat', 2));

        queue.actions = [LAB_ACTION, COOK_ACTION];
        dataHandlers.actions_updated({ endCharacterActions: [COOK_ACTION] });

        expect(document.getElementById('mwi-battle-counter').textContent).toBe('combatBattleCounter.attemptLabel:2');
    });

    test('a labyrinth explore merely queued behind another action does not show an attempt', () => {
        queue.actions = [COOK_ACTION, LAB_ACTION];

        handlers.labyrinth_updated(labyrinthUpdate('/labyrinth_room_types/combat', 1));

        expect(document.getElementById('mwi-battle-counter')).toBeNull();
    });
});
