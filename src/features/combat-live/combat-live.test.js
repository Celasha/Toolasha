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
vi.mock('../../core/storage.js', () => ({
    default: { get: async (_key, _store, fallback) => fallback, set: async () => {} },
}));
vi.mock('./combat-live-ui.js', () => ({ default: mockUI }));
vi.mock('./unit-overlay.js', () => ({ default: { initialize: vi.fn(), cleanup: vi.fn() } }));
vi.mock('../../core/config.js', () => ({ default: mockConfig }));
vi.mock('../../core/data-manager.js', () => ({
    default: { getCurrentCharacterId: () => 1, getInitClientData: () => null },
}));

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

    test("follows the viewer's own character for the DPS chart", () => {
        feature.initialize();

        handlers.get('new_battle')(newBattle);

        expect(combatLive.stats.selfName).toBe('Alice');
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

    test('starts the clock for kill time when a battle begins', () => {
        const now = vi.spyOn(Date, 'now');
        feature.initialize();

        now.mockReturnValue(1000);
        handlers.get('new_battle')(newBattle);
        now.mockReturnValue(5000);
        handlers.get('battle_updated')(hit(7, 0));
        now.mockRestore();

        expect(combatLive.stats.getSummary(5000).monsters[0]).toEqual(
            expect.objectContaining({ kills: 1, aliveSeconds: 4, killTime: 4 })
        );
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

        expect(mockHook.on).toHaveBeenCalledTimes(3);
        expect(mockUI.initialize).toHaveBeenCalledTimes(1);
    });

    describe('buffs', () => {
        test('a cast seen in a battle update puts its buff on the caster, and the next wave keeps player buffs', () => {
            feature.initialize();
            combatLive.buffs.setEffectsLookup((hrid) =>
                hrid === '/abilities/berserk'
                    ? [
                          {
                              targetType: 'self',
                              buffs: [{ uniqueHrid: '/buff_uniques/berserk', typeHrid: 't', duration: 20e9 }],
                          },
                      ]
                    : []
            );
            const unit = {
                ...newBattle.players[0],
                attackAttemptCounter: 1,
                preparingAbilityHrid: '/abilities/berserk',
            };
            handlers.get('new_battle')({ ...newBattle, players: [unit] });

            handlers.get('battle_updated')({
                battleId: 7,
                pMap: { 0: { atkCounter: 2, isAutoAtk: true, cHP: 1000, mHP: 1000 } },
                mMap: {},
            });

            const now = Date.now();
            expect(combatLive.buffs.getUnit('p', 0, now).map((buff) => buff.abilityHrid)).toEqual([
                '/abilities/berserk',
            ]);

            handlers.get('new_battle')({ ...newBattle, battleId: 8, players: [unit] });
            expect(combatLive.buffs.getUnit('p', 0, Date.now())).toHaveLength(1);
        });
    });

    describe('boss waves', () => {
        test('a monster with a long enrage timer makes the wave a boss wave, and the next ordinary wave clears it', () => {
            feature.initialize();
            const setBoss = vi.spyOn(combatLive.stats, 'setBoss');

            handlers.get('new_battle')({
                ...newBattle,
                monsters: [
                    { hrid: '/monsters/boss', currentHitpoints: 5000, maxHitpoints: 5000, enrageTimerDuration: 600e9 },
                ],
            });
            handlers.get('new_battle')({
                ...newBattle,
                battleId: 8,
                monsters: [
                    { hrid: '/monsters/fly', currentHitpoints: 300, maxHitpoints: 300, enrageTimerDuration: 180e9 },
                ],
            });

            expect(setBoss.mock.calls.map((call) => call[0])).toEqual([true, false]);
        });
    });

    describe('starting over for a new combat', () => {
        const autoReset = () => mockConfig.getSetting.mockImplementation((key) => key === 'combatLive_autoReset');
        const withStart = (combatStartTime) => ({ ...newBattle, combatStartTime });

        function playOneWave() {
            handlers.get('new_battle')(withStart('2026-11-03T10:00:00Z'));
            handlers.get('battle_updated')(hit(7, 250));
        }

        test('a different combat start time keeps the finished session and starts the meters over', () => {
            autoReset();
            feature.initialize();
            const archive = vi.spyOn(combatLive.history, 'archive').mockResolvedValue(null);
            playOneWave();
            expect(combatLive.stats.partyDamage).toBe(50);

            handlers.get('new_battle')(withStart('2026-11-03T10:30:00Z'));

            expect(archive).toHaveBeenCalledTimes(1);
            expect(combatLive.stats.partyDamage).toBe(0);
        });

        test('the next wave of the same combat carries on', () => {
            autoReset();
            feature.initialize();
            const archive = vi.spyOn(combatLive.history, 'archive').mockResolvedValue(null);
            playOneWave();

            handlers.get('new_battle')({ ...withStart('2026-11-03T10:00:00Z'), battleId: 8 });

            expect(archive).not.toHaveBeenCalled();
            expect(combatLive.stats.partyDamage).toBe(50);
        });

        test('the setting off keeps accumulating across combats', () => {
            feature.initialize();
            vi.spyOn(combatLive.history, 'archive').mockResolvedValue(null);
            playOneWave();

            handlers.get('new_battle')(withStart('2026-11-03T10:30:00Z'));

            expect(combatLive.stats.partyDamage).toBe(50);
        });

        test('labyrinth rooms do not count as a new combat', () => {
            autoReset();
            feature.initialize();
            vi.spyOn(combatLive.history, 'archive').mockResolvedValue(null);
            handlers.get('labyrinth_updated')({ labyrinth: { isActive: true } });
            playOneWave();

            handlers.get('new_battle')(withStart('2026-11-03T10:30:00Z'));

            expect(combatLive.stats.partyDamage).toBe(50);

            handlers.get('labyrinth_updated')({ labyrinth: { isActive: false } });
            handlers.get('new_battle')(withStart('2026-11-03T11:00:00Z'));
            expect(combatLive.stats.partyDamage).toBe(0);
        });

        test('the reset button keeps the session too', () => {
            feature.initialize();
            const archive = vi.spyOn(combatLive.history, 'archive').mockResolvedValue(null);
            playOneWave();

            mockUI.initialize.mock.calls[0][0].onReset();

            expect(archive).toHaveBeenCalledTimes(1);
            expect(combatLive.stats.partyDamage).toBe(0);
        });
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
