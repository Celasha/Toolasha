import { beforeEach, describe, expect, test, vi } from 'vitest';

const { handlers, socketHandlers, mockHook, mockUI, mockConfig } = vi.hoisted(() => {
    const handlers = new Map();
    const socketHandlers = new Map();
    return {
        handlers,
        socketHandlers,
        mockHook: {
            on: vi.fn((type, fn) => handlers.set(type, fn)),
            off: vi.fn((type) => handlers.delete(type)),
            onSocketEvent: vi.fn((type, fn) => socketHandlers.set(type, fn)),
            offSocketEvent: vi.fn((type) => socketHandlers.delete(type)),
        },
        mockUI: { initialize: vi.fn(), cleanup: vi.fn() },
        mockConfig: { getSetting: vi.fn(() => false) },
    };
});

vi.mock('../../core/websocket.js', () => ({ default: mockHook }));
vi.mock('./combat-live-ui.js', () => ({ default: mockUI }));
vi.mock('../../core/config.js', () => ({ default: mockConfig }));
vi.mock('../../core/data-manager.js', () => ({ default: { getCurrentCharacterId: () => 1 } }));

const { default: feature } = await import('./combat-live.js');
const combatLive = feature.instance;

const newBattle = {
    battleId: 7,
    wave: 0,
    players: [
        {
            character: { id: 1, name: 'Alice' },
            currentHitpoints: 1000,
            maxHitpoints: 1000,
            currentManapoints: 500,
            maxManapoints: 500,
        },
    ],
    monsters: [{ hrid: '/monsters/fly', currentHitpoints: 300, maxHitpoints: 300 }],
};

const hit = (battleId, hp) => ({ battleId, pMap: {}, mMap: { 0: { cHP: hp, mHP: 300, dmgCounter: 1 } } });

describe('Combat Live feature', () => {
    beforeEach(() => {
        feature.cleanup();
        handlers.clear();
        socketHandlers.clear();
        vi.clearAllMocks();
        mockConfig.getSetting.mockReturnValue(false);
    });

    test('subscribes to the battle messages and the socket close event when initialized', () => {
        feature.initialize();

        expect(handlers.has('new_battle')).toBe(true);
        expect(handlers.has('battle_updated')).toBe(true);
        expect(socketHandlers.has('close')).toBe(true);
        expect(mockUI.initialize).toHaveBeenCalledTimes(1);
    });

    test('counts damage from battle_updated once a new_battle has started the battle', () => {
        feature.initialize();

        handlers.get('new_battle')(newBattle);
        handlers.get('battle_updated')(hit(7, 250));

        expect(combatLive.stats.getSummary().party.damage).toBe(50);
    });

    test('ignores updates for a battle it was not told about', () => {
        feature.initialize();

        handlers.get('new_battle')(newBattle);
        handlers.get('battle_updated')(hit(99, 250));

        expect(combatLive.stats.getSummary().party.damage).toBe(0);
    });

    test('a dropped connection starts the numbers from scratch', () => {
        feature.initialize();
        handlers.get('new_battle')(newBattle);
        handlers.get('battle_updated')(hit(7, 250));

        socketHandlers.get('close')();

        expect(combatLive.stats.getSummary().party.damage).toBe(0);
        expect(combatLive.lastMessageAt).toBe(0);
    });

    test('cleanup unsubscribes, tears the panel down and forgets the battle', () => {
        feature.initialize();
        handlers.get('new_battle')(newBattle);

        feature.cleanup();

        expect(handlers.size).toBe(0);
        expect(socketHandlers.size).toBe(0);
        expect(mockUI.cleanup).toHaveBeenCalledTimes(1);
        expect(combatLive.tracker.battleId).toBeNull();
    });

    test('initialize is idempotent', () => {
        feature.initialize();
        feature.initialize();

        expect(mockHook.on).toHaveBeenCalledTimes(2);
        expect(mockUI.initialize).toHaveBeenCalledTimes(1);
    });

    describe('recording', () => {
        const recordingOn = () => mockConfig.getSetting.mockImplementation((key) => key === 'combatLive_record');

        test('keeps nothing unless the setting is on', () => {
            feature.initialize();

            handlers.get('new_battle')(newBattle);
            handlers.get('battle_updated')(hit(7, 250));

            expect(combatLive.recorder.entries).toEqual([]);
        });

        test('keeps the battle start and each tick when the setting is on', () => {
            recordingOn();
            feature.initialize();

            handlers.get('new_battle')(newBattle);
            handlers.get('battle_updated')(hit(7, 250));

            expect(combatLive.recorder.entries.map((entry) => entry.k)).toEqual(['nb', 'bu']);
        });

        test('survives a dropped connection but not a cleanup', () => {
            recordingOn();
            feature.initialize();
            handlers.get('new_battle')(newBattle);

            socketHandlers.get('close')();
            expect(combatLive.recorder.entries).toHaveLength(1);

            feature.cleanup();
            expect(combatLive.recorder.entries).toEqual([]);
        });
    });
});
