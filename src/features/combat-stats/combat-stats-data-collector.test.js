import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map(),
    currentCharacterId: 'character-a',
    on: vi.fn(),
    off: vi.fn(),
    socketEventHandlers: {},
    settingValues: { combatStats_runwayWarningThreshold: 12 },
}));

// The game keeps combatStartTime constant for a whole run; a changed value means a new run
const RUN_START = new Date(Date.now() - 3600000).toISOString();

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _store, defaultValue = null) =>
            mocks.values.has(key) ? mocks.values.get(key) : defaultValue
        ),
        setJSON: vi.fn(async (key, value) => {
            mocks.values.set(key, value);
            return true;
        }),
        delete: vi.fn(async (key) => {
            mocks.values.delete(key);
            return true;
        }),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        getItemDetails: vi.fn((itemHrid) => ({ name: itemHrid.split('/').pop() })),
        getCurrentActions: vi.fn(() => []),
        getActionDetails: vi.fn(() => null),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: {
        on: mocks.on,
        off: mocks.off,
        onSocketEvent: vi.fn((eventType, handler) => {
            mocks.socketEventHandlers[eventType] = handler;
        }),
        offSocketEvent: vi.fn((eventType) => {
            delete mocks.socketEventHandlers[eventType];
        }),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn((key, def) => mocks.settingValues[key] ?? def),
    },
}));

// Mocked as a pure, side-effect-free reimplementation of the real formula (not vi.importActual -
// the real module transitively imports marketplace.js/websocket.js, which isn't set up here).
vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    calculateLevelGapDebuff: vi.fn(() => 0),
    calculateCombatLevelFromLevelFields: (levelFields) => {
        const { staminaLevel, intelligenceLevel, attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel } =
            levelFields;
        const combatStyleMax = Math.max(meleeLevel, rangedLevel, magicLevel);
        const primaryMax = Math.max(attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel);
        const raw =
            0.1 * (staminaLevel + intelligenceLevel + attackLevel + defenseLevel + combatStyleMax) + 0.5 * primaryMax;
        return Math.round(raw * 10) / 10;
    },
}));

vi.mock('../combat/dungeon-tracker.js', () => ({
    default: {
        onUpdate: vi.fn(),
        offUpdate: vi.fn(),
    },
}));

import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import dungeonTracker from '../combat/dungeon-tracker.js';
import webSocketHook from '../../core/websocket.js';
import { calculateLevelGapDebuff } from '../combat-sim/combat-sim-adapter.js';
import { CombatStatsDataCollector } from './combat-stats-data-collector.js';

beforeEach(() => {
    mocks.values.clear();
    mocks.currentCharacterId = 'character-a';
    mocks.settingValues = { combatStats_runwayWarningThreshold: 12 };
    mocks.on.mockClear();
    mocks.off.mockClear();
    mocks.socketEventHandlers = {};
    vi.clearAllMocks();

    globalThis.Notification = vi.fn(function MockNotification() {
        this.close = vi.fn();
    });
    globalThis.Notification.permission = 'granted';
    globalThis.Notification.requestPermission = vi.fn(async () => 'granted');
});

describe('CombatStatsDataCollector character-scoped persistence', () => {
    test('loads a fresh in-memory tracker when the next character has no saved state', async () => {
        const collector = new CombatStatsDataCollector();
        mocks.values.set('consumableTracker:character-a', {
            actualConsumed: { '/items/coffee': 8 },
            defaultConsumed: { '/items/coffee': 2 },
            inventoryAmount: { '/items/coffee': 90 },
            elapsedMs: 1000,
            saveTimestamp: Date.now(),
        });

        await collector.loadConsumableTracking('character-a');
        expect(collector.consumableTracker.actualConsumed['/items/coffee']).toBe(8);

        await collector.loadConsumableTracking('character-b');
        expect(collector.consumableTracker.actualConsumed).toEqual({});
        expect(collector.consumableTracker.defaultConsumed).toEqual({});
        expect(collector.partyConsumableTrackers).toEqual({});
        expect(collector.partyConsumableSnapshots).toEqual({});
    });

    test('migrates legacy unscoped data once to the active character', async () => {
        const collector = new CombatStatsDataCollector();
        const legacyTracker = {
            actualConsumed: { '/items/coffee': 3 },
            defaultConsumed: { '/items/coffee': 2 },
            inventoryAmount: { '/items/coffee': 20 },
            elapsedMs: 500,
            saveTimestamp: Date.now(),
        };
        const legacyRun = { battleId: 17, players: [] };
        mocks.values.set('consumableTracker', legacyTracker);
        mocks.values.set('partyConsumableTrackers', {});
        mocks.values.set('partyConsumableSnapshots', {});
        mocks.values.set('latestCombatRun', legacyRun);

        await collector.loadConsumableTracking('character-a');
        await collector.loadLatestData('character-a');

        expect(mocks.values.get('consumableTracker:character-a')).toBe(legacyTracker);
        expect(mocks.values.get('latestCombatRun:character-a')).toBe(legacyRun);
        expect(mocks.values.has('consumableTracker')).toBe(false);
        expect(mocks.values.has('latestCombatRun')).toBe(false);

        await collector.loadConsumableTracking('character-b');
        expect(collector.consumableTracker.actualConsumed).toEqual({});
    });

    test('writes every combat-stat record under the captured character ID', async () => {
        const collector = new CombatStatsDataCollector();
        collector.characterId = 'character-a';
        collector.lifecycleGeneration = 4;
        collector.consumableTracker.actualConsumed = { '/items/coffee': 4 };
        collector.consumableTracker.defaultConsumed = { '/items/coffee': 2 };
        collector.consumableTracker.inventoryAmount = { '/items/coffee': 40 };
        collector.consumableTracker.startTime = Date.now() - 1000;

        await collector.saveConsumableTracking('character-a', 4);

        expect(storage.setJSON).toHaveBeenCalledWith(
            'consumableTracker:character-a',
            expect.objectContaining({ actualConsumed: { '/items/coffee': 4 } }),
            'combatStats'
        );
        expect(mocks.values.has('consumableTracker')).toBe(false);
        expect(mocks.values.has('partyConsumableTrackers:character-a')).toBe(true);
        expect(mocks.values.has('partyConsumableSnapshots:character-a')).toBe(true);
    });

    test('invalidates an in-flight lifecycle generation before it writes', async () => {
        const collector = new CombatStatsDataCollector();
        collector.characterId = 'character-a';
        collector.lifecycleGeneration = 2;

        await collector.saveConsumableTracking('character-a', 1);

        expect(storage.setJSON).not.toHaveBeenCalled();
    });

    test('a party member consumable that legitimately reads 0 stays 0, never falls back to a stale count', async () => {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        mocks.currentCharacterId = 'character-a';

        const battlePayload = (count) => ({
            battleId: 1,
            combatStartTime: new Date().toISOString(),
            players: [
                {
                    character: { id: 'character-a', name: 'Self' },
                    combatConsumables: [],
                    totalLootMap: {},
                    totalSkillExperienceMap: {},
                },
                {
                    character: { id: 'character-b', name: 'Ally' },
                    combatConsumables: [{ itemHrid: '/items/coffee', count }],
                    totalLootMap: {},
                    totalSkillExperienceMap: {},
                },
            ],
        });

        await collector.onNewBattle(battlePayload(3), collector.lifecycleGeneration);
        await collector.onNewBattle(battlePayload(0), collector.lifecycleGeneration);

        const allyConsumable = collector.latestCombatData.players
            .find((p) => p.name === 'Ally')
            .consumables.find((c) => c.itemHrid === '/items/coffee');

        expect(allyConsumable.inventoryAmount).toBe(0);
    });

    test('cleanup invalidates registered handlers before the next character initializes', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();
        const generation = collector.lifecycleGeneration;

        collector.cleanup();

        expect(collector.lifecycleGeneration).toBe(generation + 1);
        expect(collector.isInitialized).toBe(false);
        expect(mocks.off).toHaveBeenCalledTimes(2);
    });
});

describe('CombatStatsDataCollector consumable runway - no browser notification path', () => {
    test('initialize never touches Notification.requestPermission', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();

        expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
        collector.cleanup();
    });

    test('a low-runway current-player consumable never creates a browser Notification', async () => {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        mocks.currentCharacterId = 'character-a';

        await collector.onNewBattle(
            {
                battleId: 1,
                combatStartTime: new Date().toISOString(),
                players: [
                    {
                        character: { id: 'character-a', name: 'Self' },
                        combatConsumables: [{ itemHrid: '/items/coffee', count: 0 }],
                        totalLootMap: {},
                        totalSkillExperienceMap: {},
                    },
                ],
            },
            collector.lifecycleGeneration
        );

        expect(globalThis.Notification).not.toHaveBeenCalled();
    });

    test('a party member consumable running low never creates a browser Notification', async () => {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        mocks.currentCharacterId = 'character-a';

        await collector.onNewBattle(
            {
                battleId: 1,
                combatStartTime: new Date().toISOString(),
                players: [
                    {
                        character: { id: 'character-a', name: 'Self' },
                        combatConsumables: [],
                        totalLootMap: {},
                        totalSkillExperienceMap: {},
                    },
                    {
                        character: { id: 'character-b', name: 'Ally' },
                        combatConsumables: [{ itemHrid: '/items/coffee', count: 0 }],
                        totalLootMap: {},
                        totalSkillExperienceMap: {},
                    },
                ],
            },
            collector.lifecycleGeneration
        );

        expect(globalThis.Notification).not.toHaveBeenCalled();
    });

    test('cleanup does not throw and leaves no notification-permission bookkeeping behind', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();

        expect(() => collector.cleanup()).not.toThrow();
        expect(collector.runwayNotificationPermissionGranted).toBeUndefined();
        expect(collector.wasBelowRunwayThreshold).toBeUndefined();
    });
});

describe('CombatStatsDataCollector expected-loot integration', () => {
    function regularZoneAction(zoneHrid = '/actions/combat/rat', difficultyTier = 0) {
        return { actionHrid: zoneHrid, isDone: false, difficultyTier };
    }

    // Real totalLootMap object keys are opaque composite strings, NOT the item HRID - the real
    // HRID lives on each entry's own `.itemHrid` field. Tests build fixtures this way on purpose
    // so a regression back to reading the object key as the HRID would be caught.
    function compositeLootMap(entries) {
        const lootMap = {};
        for (const [itemHrid, count] of Object.entries(entries)) {
            lootMap[`26354::/item_locations/inventory::${itemHrid}::0`] = { itemHrid, count };
        }
        return lootMap;
    }

    // Setting all seven whole-level fields to the same value makes calculateCombatLevelFromLevelFields
    // (0.1*sum-of-five + 0.5*max, all equal inputs) return exactly that value - a convenient fixture
    // shape for tests that don't care about Level Malus specifics.
    function wholeLevelFields(level) {
        return {
            staminaLevel: level,
            intelligenceLevel: level,
            attackLevel: level,
            defenseLevel: level,
            meleeLevel: level,
            rangedLevel: level,
            magicLevel: level,
        };
    }

    function battlePayload({ battleId, monsterHrids, combatLevel = 100, combatStats = {}, totalLootMap = {} }) {
        return {
            battleId,
            combatStartTime: RUN_START,
            monsters: monsterHrids.map((hrid) => ({ hrid })),
            players: [
                {
                    character: { id: 'character-a', name: 'Self' },
                    combatConsumables: [],
                    totalLootMap,
                    totalSkillExperienceMap: {},
                    combatDetails: { combatLevel, combatStats, ...wholeLevelFields(combatLevel) },
                },
            ],
        };
    }

    async function makeInitializedCollector() {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        mocks.currentCharacterId = 'character-a';
        return collector;
    }

    test('only the previous (completed) battle contributes kills - the active encounter is excluded', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat', '/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        // The rats from battle 1 are not yet "completed" - no new battle has started after them.
        expect(collector.expectedLootTracker.hasData()).toBe(false);

        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        // Battle 1's rats are now completed (battle 2 started); battle 2's own rat is still active.
        expect(collector.expectedLootTracker.deaths['/monsters/rat']).toBe(2);
        expect(collector.expectedLootTracker.getSampleSize()).toBe(1);
    });

    test('accumulates monster composition across several completed encounters in the same zone', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        await collector.onNewBattle(
            battlePayload({ battleId: 3, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        expect(collector.expectedLootTracker.deaths['/monsters/rat']).toBe(2);
        expect(collector.expectedLootTracker.getSampleSize()).toBe(2);
    });

    test('never tracks per-monster composition while the active zone is a dungeon', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction('/actions/combat/chimerical_den')]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: true } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        expect(collector.expectedLootTracker.hasData()).toBe(false);
        expect(collector.pendingEncounter).toBeNull();
    });

    test('a session reset (battleId decreasing) clears accumulated expected-loot state', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 5, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        await collector.onNewBattle(
            battlePayload({ battleId: 6, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        expect(collector.expectedLootTracker.hasData()).toBe(true);

        // New session: battleId drops back to 1
        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        expect(collector.expectedLootTracker.hasData()).toBe(false);
        expect(collector.pendingEncounter).not.toBeNull(); // this battle's own snapshot for the next completion
    });

    test('snapshots the whole run for loot luck: waves, age, cumulative loot and current modifiers (#779)', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction('/actions/combat/rat', 2)]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({
                battleId: 205,
                monsterHrids: ['/monsters/rat'],
                combatStats: { combatDropRate: 0.2, combatRareFind: 0.5, combatDropQuantity: 0.1 },
                totalLootMap: compositeLootMap({ '/items/tail': 42, '/items/coin': 1000 }),
            }),
            collector.lifecycleGeneration
        );

        const snapshot = collector.getRunLuckSnapshot();
        expect(snapshot.zoneHrid).toBe('/actions/combat/rat');
        expect(snapshot.completedWaves).toBe(204);
        expect(snapshot.elapsedSeconds).toBeGreaterThan(3590);
        expect(snapshot.actualLoot).toEqual(
            expect.arrayContaining([
                { itemHrid: '/items/tail', count: 42 },
                { itemHrid: '/items/coin', count: 1000 },
            ])
        );
        expect(snapshot.modifiers).toMatchObject({
            difficultyTier: 2,
            numberOfPlayers: 1,
            dropRateMultiplier: 1.2,
            rareFindMultiplier: 1.5,
            combatDropQuantity: 0.1,
        });
    });

    test('the run luck snapshot is replaced by each message and needs at least one completed wave', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(battlePayload({ battleId: 1, monsterHrids: [] }), collector.lifecycleGeneration);
        expect(collector.getRunLuckSnapshot()).toBeNull();

        await collector.onNewBattle(battlePayload({ battleId: 4, monsterHrids: [] }), collector.lifecycleGeneration);
        expect(collector.getRunLuckSnapshot().completedWaves).toBe(3);

        await collector.onNewBattle(battlePayload({ battleId: 9, monsterHrids: [] }), collector.lifecycleGeneration);
        expect(collector.getRunLuckSnapshot().completedWaves).toBe(8);
    });

    test('dungeons never produce a run luck snapshot', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction('/actions/combat/chimerical_den')]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: true } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(battlePayload({ battleId: 30, monsterHrids: [] }), collector.lifecycleGeneration);

        expect(collector.getRunLuckSnapshot()).toBeNull();
    });

    test('I: derives Level Malus input from the raw (unfloored) whole-level Combat Level, never the native floored field', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();
        calculateLevelGapDebuff.mockClear();

        await collector.onNewBattle(
            {
                battleId: 1,
                combatStartTime: new Date().toISOString(),
                monsters: [{ hrid: '/monsters/rat' }],
                players: [
                    {
                        character: { id: 'character-a', name: 'Self' },
                        combatConsumables: [],
                        totalLootMap: {},
                        totalSkillExperienceMap: {},
                        // native/floored combatLevel is 133, but the whole-level fields produce a
                        // raw combat level of 133.2 (the developer's own example) - Level Malus
                        // must receive 133.2, never 133.
                        combatDetails: {
                            combatLevel: 133,
                            combatStats: {},
                            staminaLevel: 125,
                            intelligenceLevel: 124,
                            attackLevel: 130,
                            defenseLevel: 125,
                            meleeLevel: 105,
                            rangedLevel: 138,
                            magicLevel: 77,
                        },
                    },
                    {
                        character: { id: 'character-b', name: 'Ally' },
                        combatConsumables: [],
                        totalLootMap: {},
                        totalSkillExperienceMap: {},
                        // native/floored combatLevel is 300, but the whole-level fields produce a
                        // raw combat level of 300.4 (intelligence isn't part of the 0.5x max term,
                        // so +4 intelligence alone shifts the raw total by +0.4).
                        combatDetails: {
                            combatLevel: 300,
                            combatStats: {},
                            staminaLevel: 300,
                            intelligenceLevel: 304,
                            attackLevel: 300,
                            defenseLevel: 300,
                            meleeLevel: 300,
                            rangedLevel: 300,
                            magicLevel: 300,
                        },
                    },
                ],
            },
            collector.lifecycleGeneration
        );

        expect(calculateLevelGapDebuff).toHaveBeenCalledWith(133.2, 300.4);
    });

    test('cleanup resets the expected-loot tracker and pending encounter (no cross-character leakage)', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        expect(collector.expectedLootTracker.hasData()).toBe(true);

        collector.cleanup();

        expect(collector.expectedLootTracker.hasData()).toBe(false);
        expect(collector.pendingEncounter).toBeNull();
    });

    test('dungeon completions are recorded via the shared dungeonTracker completion signal, not re-derived', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();

        const onUpdateHandler = dungeonTracker.onUpdate.mock.calls[0][0];
        collector.latestSelfCombatDropQuantity = 0.1;

        onUpdateHandler(null, {
            dungeonHrid: '/actions/combat/chimerical_den',
            tier: 2,
            keyCountsMap: { Self: 3, Ally: 3 },
        });

        expect(collector.expectedLootTracker.dungeonsCompleted).toBe(1);
        expect(collector.expectedLootTracker.isDungeon).toBe(true);
        expect(collector.expectedLootTracker.zoneHrid).toBe('/actions/combat/chimerical_den');
    });

    test('an in-progress dungeon run (no completedRun yet) does not record a completion', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();

        const onUpdateHandler = dungeonTracker.onUpdate.mock.calls[0][0];
        onUpdateHandler({ dungeonHrid: '/actions/combat/chimerical_den', currentWave: 3 }, null);

        expect(collector.expectedLootTracker.hasData()).toBe(false);
    });

    test('actual loot since tracking started excludes loot gained before the tracking window began', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        // Session already has 999999 coin banked before tracking even starts (e.g. the script
        // attached mid-fight) - the snapshot must capture this as the baseline, not as a gain.
        await collector.onNewBattle(
            battlePayload({
                battleId: 1,
                monsterHrids: ['/monsters/rat'],
                totalLootMap: compositeLootMap({ '/items/coin': 999999 }),
            }),
            collector.lifecycleGeneration
        );
        await collector.onNewBattle(
            battlePayload({
                battleId: 2,
                monsterHrids: ['/monsters/rat'],
                totalLootMap: compositeLootMap({ '/items/coin': 1000049 }),
            }),
            collector.lifecycleGeneration
        );

        const actualLoot = collector.getActualLootSinceTrackingStarted();

        expect(actualLoot).toEqual([{ itemHrid: '/items/coin', count: 50 }]);
    });

    test('a zone change resets the actual-loot snapshot in lockstep with the expected-loot tracker', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction('/actions/combat/rat')]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({
                battleId: 1,
                monsterHrids: ['/monsters/rat'],
                totalLootMap: compositeLootMap({ '/items/coin': 100 }),
            }),
            collector.lifecycleGeneration
        );

        dataManager.getCurrentActions.mockReturnValue([regularZoneAction('/actions/combat/alligator')]);
        await collector.onNewBattle(
            battlePayload({
                battleId: 2,
                monsterHrids: ['/monsters/alligator'],
                totalLootMap: compositeLootMap({ '/items/coin': 500 }),
            }),
            collector.lifecycleGeneration
        );

        // The snapshot re-baselined at the zone change (500), so nothing has been gained yet in
        // the new zone - a stale rat-zone snapshot would have wrongly reported 400 gained.
        expect(collector.getActualLootSinceTrackingStarted()).toEqual([]);
    });

    test('cleanup clears the actual-loot snapshot (no cross-character leakage)', async () => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({
                battleId: 1,
                monsterHrids: ['/monsters/rat'],
                totalLootMap: compositeLootMap({ '/items/coin': 100 }),
            }),
            collector.lifecycleGeneration
        );

        collector.cleanup();

        expect(collector.actualLootSnapshot).toBeNull();
        expect(collector.getActualLootSinceTrackingStarted()).toEqual([]);
    });
});

describe('CombatStatsDataCollector Loot Luck sample window (exact start/end boundaries)', () => {
    function regularZoneAction(zoneHrid = '/actions/combat/rat', difficultyTier = 0) {
        return { actionHrid: zoneHrid, isDone: false, difficultyTier };
    }

    function battlePayload({ battleId, monsterHrids }) {
        return {
            battleId,
            combatStartTime: RUN_START,
            monsters: monsterHrids.map((hrid) => ({ hrid })),
            players: [
                {
                    character: { id: 'character-a', name: 'Self' },
                    combatConsumables: [],
                    totalLootMap: {},
                    totalSkillExperienceMap: {},
                    combatDetails: { combatLevel: 100, combatStats: {} },
                },
            ],
        };
    }

    async function makeInitializedCollector() {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        mocks.currentCharacterId = 'character-a';
        return collector;
    }

    beforeEach(() => {
        dataManager.getCurrentActions.mockReturnValue([regularZoneAction()]);
        dataManager.getActionDetails.mockReturnValue({ combatZoneInfo: { isDungeon: false } });
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('the first observed battle establishes the baseline; elapsed stays 0 until the next battle confirms it completed', async () => {
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        expect(collector.expectedLootTracker.getSampleSize()).toBe(0);
        expect(collector.expectedLootTracker.getElapsedSeconds()).toBe(0);
    });

    test('next battle at t=60s confirms one completed encounter with a real 60s duration, not ~0s', async () => {
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        vi.setSystemTime(60_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        expect(collector.expectedLootTracker.getSampleSize()).toBe(1);
        expect(collector.expectedLootTracker.getElapsedSeconds()).toBe(60);
    });

    test('elapsed sample does not drift merely because time passes with no new completed encounter', async () => {
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        vi.setSystemTime(60_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        // 30s pass with no new new_battle message at all (e.g. user just left the stats popup
        // open) - the denominator must not silently keep growing off Date.now().
        vi.setSystemTime(90_000);

        expect(collector.expectedLootTracker.getSampleSize()).toBe(1);
        expect(collector.expectedLootTracker.getElapsedSeconds()).toBe(60);
    });

    test('a third battle at t=120s confirms a second completed encounter, extending the sample end to 120s', async () => {
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        vi.setSystemTime(60_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        vi.setSystemTime(120_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 3, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );

        expect(collector.expectedLootTracker.getSampleSize()).toBe(2);
        expect(collector.expectedLootTracker.getElapsedSeconds()).toBe(120);
    });

    test('the currently-active encounter never extends the sample end before it completes', async () => {
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        vi.setSystemTime(60_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        const elapsedBeforeThirdBattle = collector.expectedLootTracker.getElapsedSeconds();

        // Battle 2 is still active (no battle 3 yet) - time passing must not move the boundary.
        vi.setSystemTime(100_000);

        expect(collector.expectedLootTracker.getElapsedSeconds()).toBe(elapsedBeforeThirdBattle);
    });

    test('a zone change resets the sample start/end boundaries in lockstep with the Actual baseline', async () => {
        const collector = await makeInitializedCollector();

        await collector.onNewBattle(
            battlePayload({ battleId: 1, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        vi.setSystemTime(60_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 2, monsterHrids: ['/monsters/rat'] }),
            collector.lifecycleGeneration
        );
        expect(collector.expectedLootTracker.getSampleSize()).toBe(1);

        dataManager.getCurrentActions.mockReturnValue([regularZoneAction('/actions/combat/alligator')]);
        vi.setSystemTime(90_000);
        await collector.onNewBattle(
            battlePayload({ battleId: 3, monsterHrids: ['/monsters/alligator'] }),
            collector.lifecycleGeneration
        );

        // New zone, no completion yet - sample must restart clean, not inherit the old window.
        expect(collector.expectedLootTracker.getSampleSize()).toBe(0);
        expect(collector.expectedLootTracker.getElapsedSeconds()).toBe(0);
    });
});

describe('CombatStatsDataCollector connection-interrupted flagging', () => {
    test('a socket close mid-session flags connectionInterrupted', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();
        await collector.resetConsumableTracking('character-a');

        expect(collector.isConnectionInterrupted()).toBe(false);

        mocks.socketEventHandlers.close();

        expect(collector.isConnectionInterrupted()).toBe(true);
        collector.cleanup();
    });

    test('a socket close before any session has started is a no-op', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();

        mocks.socketEventHandlers.close();

        expect(collector.isConnectionInterrupted()).toBe(false);
        collector.cleanup();
    });

    test('starting a new session clears a stale interrupted flag', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();
        await collector.resetConsumableTracking('character-a');
        mocks.socketEventHandlers.close();
        expect(collector.isConnectionInterrupted()).toBe(true);

        await collector.resetConsumableTracking('character-a');

        expect(collector.isConnectionInterrupted()).toBe(false);
        collector.cleanup();
    });

    test('cleanup unregisters the socket close handler', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();

        collector.cleanup();

        expect(webSocketHook.offSocketEvent).toHaveBeenCalledWith('close', expect.any(Function));
    });
});

describe('CombatStatsDataCollector consumable diagnostics (issue #803)', () => {
    test('exposes a console report that tallies accepted events and cleans up after itself', async () => {
        vi.stubGlobal('window', globalThis);
        const collector = new CombatStatsDataCollector();
        await collector.initialize();
        expect(typeof globalThis.toolashaConsumableDebug).toBe('function');

        await collector.onConsumableUsed({ consumable: { itemHrid: '/items/ultimate_magic_coffee', count: 50 } });
        const report = globalThis.toolashaConsumableDebug();

        expect(report.items['/items/ultimate_magic_coffee'].eventsAccepted).toBeGreaterThanOrEqual(1);
        expect(report.trackedItems['/items/ultimate_magic_coffee'].trackedActualConsumed).toBe(1);

        collector.cleanup();
        expect(globalThis.toolashaConsumableDebug).toBeUndefined();
        vi.unstubAllGlobals();
    });
});

describe('CombatStatsDataCollector snapshot reconciliation (#803)', () => {
    const GUMMY = '/items/dragon_fruit_gummy';
    const COFFEE = '/items/ultra_magic_coffee';
    const T0 = 1_700_000_000_000;
    const RUN = new Date(T0 - 3600000).toISOString();

    function payload({ battleId = 1, wave = 0, runStart = RUN, self = [], ally = null }) {
        const players = [
            {
                character: { id: 'character-a', name: 'Self' },
                combatConsumables: self,
                totalLootMap: {},
                totalSkillExperienceMap: {},
            },
        ];
        if (ally) {
            players.push({
                character: { id: 'character-b', name: 'Ally' },
                combatConsumables: ally,
                totalLootMap: {},
                totalSkillExperienceMap: {},
            });
        }
        return { battleId, wave, combatStartTime: runStart, players };
    }

    function makeCollector() {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        mocks.currentCharacterId = 'character-a';
        return collector;
    }

    const send = (collector, message) => collector.onNewBattle(message, collector.lifecycleGeneration);

    beforeEach(() => {
        dataManager.getCurrentActions.mockReturnValue([]);
        dataManager.getActionDetails.mockReturnValue(null);
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('credits consumption missed while the page was silent and keeps that time in the rate', async () => {
        const collector = makeCollector();
        await send(collector, payload({ self: [{ itemHrid: GUMMY, count: 1000 }] }));

        vi.advanceTimersByTime(3600 * 1000);
        await send(collector, payload({ battleId: 2, self: [{ itemHrid: GUMMY, count: 940 }] }));

        expect(collector.consumableTracker.actualConsumed[GUMMY]).toBe(60);
        expect(collector.calcElapsedSeconds()).toBeCloseTo(3600);
    });

    test('an impossible drop is rejected and the unobserved time is left out of the rate', async () => {
        const collector = makeCollector();
        await send(collector, payload({ self: [{ itemHrid: COFFEE, count: 5552 }] }));

        vi.advanceTimersByTime(11 * 3600 * 1000);
        await send(collector, payload({ battleId: 2, self: [{ itemHrid: COFFEE, count: 1667 }] }));

        expect(collector.consumableTracker.actualConsumed[COFFEE]).toBeUndefined();
        expect(collector.consumableTracker.excludedMs).toBe(11 * 3600 * 1000);
    });

    test('a restock is not consumption', async () => {
        const collector = makeCollector();
        await send(collector, payload({ self: [{ itemHrid: GUMMY, count: 1961 }] }));

        vi.advanceTimersByTime(3600 * 1000);
        await send(collector, payload({ battleId: 2, self: [{ itemHrid: GUMMY, count: 2262 }] }));

        expect(collector.consumableTracker.actualConsumed[GUMMY]).toBeUndefined();
    });

    test('an ordinary gap with matching counts changes nothing', async () => {
        const collector = makeCollector();
        await send(collector, payload({ self: [{ itemHrid: GUMMY, count: 1000 }] }));

        vi.advanceTimersByTime(13 * 1000);
        await send(collector, payload({ battleId: 2, self: [{ itemHrid: GUMMY, count: 1000 }] }));

        expect(collector.consumableTracker.actualConsumed[GUMMY]).toBeUndefined();
        expect(collector.consumableTracker.excludedMs).toBe(0);
    });

    test('a different combatStartTime is a new run and discards the old tracking', async () => {
        const collector = makeCollector();
        await send(collector, payload({ self: [{ itemHrid: GUMMY, count: 1000 }] }));
        collector.consumableTracker.actualConsumed[GUMMY] = 42;

        vi.advanceTimersByTime(60 * 1000);
        const newRun = new Date(T0 + 30 * 1000).toISOString();
        await send(collector, payload({ battleId: 1, runStart: newRun, self: [{ itemHrid: GUMMY, count: 5 }] }));

        expect(collector.consumableTracker.actualConsumed[GUMMY]).toBeUndefined();
        expect(collector.consumableTracker.runKey).toBe(newRun);
    });

    test('a party member drop over a long gap is credited instead of ignored', async () => {
        const collector = makeCollector();
        await send(collector, payload({ ally: [{ itemHrid: GUMMY, count: 1000 }] }));

        vi.advanceTimersByTime(3600 * 1000);
        await send(collector, payload({ battleId: 2, ally: [{ itemHrid: GUMMY, count: 950 }] }));

        expect(collector.partyConsumableTrackers.Ally.actualConsumed[GUMMY]).toBe(50);
    });

    test('dungeon gaps clamp the credit by waves fought across a run boundary', async () => {
        dataManager.getCurrentActions.mockReturnValue([
            { actionHrid: '/actions/combat/pirate_cove', isDone: false, difficultyTier: 0 },
        ]);
        dataManager.getActionDetails.mockReturnValue({
            combatZoneInfo: { isDungeon: true, dungeonInfo: { maxWaves: 65 } },
        });
        const collector = makeCollector();

        // Establish ~15s per wave
        for (let wave = 1; wave <= 5; wave++) {
            await send(collector, payload({ battleId: 30, wave, self: [{ itemHrid: GUMMY, count: 1000 }] }));
            vi.advanceTimersByTime(15 * 1000);
        }
        // Silent for 10 hours, but only 2 runs' worth of waves (130 waves ~ 32 min) happened
        vi.advanceTimersByTime(10 * 3600 * 1000);
        await send(collector, payload({ battleId: 32, wave: 5, self: [{ itemHrid: GUMMY, count: 700 }] }));

        // 300 gummies in ~32 fighting minutes is impossible at 1/min, so it is rejected
        expect(collector.consumableTracker.actualConsumed[GUMMY]).toBeUndefined();
    });

    test('saved tracking keeps the run, the excluded time and the observation point across a reload', async () => {
        const collector = makeCollector();
        await send(collector, payload({ self: [{ itemHrid: COFFEE, count: 100 }] }));
        vi.advanceTimersByTime(11 * 3600 * 1000);
        await send(collector, payload({ battleId: 2, self: [{ itemHrid: COFFEE, count: 99 }] }));
        const saved = { ...collector.consumableTracker };

        const reloaded = makeCollector();
        await reloaded.loadConsumableTracking('character-a');

        expect(reloaded.consumableTracker.runKey).toBe(saved.runKey);
        expect(reloaded.consumableTracker.excludedMs).toBe(saved.excludedMs);
        expect(reloaded.consumableTracker.lastObservedAt).toBe(saved.lastObservedAt);
        expect(reloaded.consumableTracker.lastBattleId).toBe(2);
    });
});
