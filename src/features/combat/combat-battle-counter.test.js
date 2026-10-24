// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const handlers = vi.hoisted(() => ({}));

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
        on: vi.fn(),
        off: vi.fn(),
        getCurrentActions: vi.fn(() => [{ actionHrid: '/actions/labyrinth/explore', isDone: false }]),
        getActionDetails: vi.fn(),
    },
}));
vi.mock('../../core/i18n.js', () => ({ t: (key, params) => `${key}:${params?.attempt ?? ''}` }));

const { default: counter } = await import('./combat-battle-counter.js');

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
});
