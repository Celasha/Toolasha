import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map(),
    currentCharacterId: 'character-a',
    on: vi.fn(),
    off: vi.fn(),
    settingValues: { combatStats_runwayWarningThreshold: 12 },
}));

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
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn((key, def) => mocks.settingValues[key] ?? def),
    },
}));

vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    calculateLevelGapDebuff: vi.fn(() => 0),
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
import { CombatStatsDataCollector } from './combat-stats-data-collector.js';

beforeEach(() => {
    mocks.values.clear();
    mocks.currentCharacterId = 'character-a';
    mocks.settingValues = { combatStats_runwayWarningThreshold: 12 };
    mocks.on.mockClear();
    mocks.off.mockClear();
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

describe('CombatStatsDataCollector runway warning', () => {
    test('fires once when crossing from above to below the threshold', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.requestRunwayNotificationPermission();

        collector.checkRunwayWarning('/items/coffee', 20 * 3600); // above 12h threshold
        collector.checkRunwayWarning('/items/coffee', 5 * 3600); // crosses below

        expect(globalThis.Notification).toHaveBeenCalledTimes(1);
        expect(globalThis.Notification.mock.calls[0][1].tag).toBe('combat-consumable-runway-/items/coffee');
    });

    test('does not spam on repeated calls while still below the threshold', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.requestRunwayNotificationPermission();

        collector.checkRunwayWarning('/items/coffee', 5 * 3600);
        collector.checkRunwayWarning('/items/coffee', 4 * 3600);
        collector.checkRunwayWarning('/items/coffee', 3 * 3600);

        expect(globalThis.Notification).toHaveBeenCalledTimes(1);
    });

    test('re-arms after inventory is replenished back above the threshold', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.requestRunwayNotificationPermission();

        collector.checkRunwayWarning('/items/coffee', 5 * 3600); // fires
        collector.checkRunwayWarning('/items/coffee', 30 * 3600); // replenished, re-arm
        collector.checkRunwayWarning('/items/coffee', 5 * 3600); // fires again

        expect(globalThis.Notification).toHaveBeenCalledTimes(2);
    });

    test('threshold of 0 disables the warning entirely', async () => {
        mocks.settingValues.combatStats_runwayWarningThreshold = 0;
        const collector = new CombatStatsDataCollector();
        await collector.requestRunwayNotificationPermission();

        collector.checkRunwayWarning('/items/coffee', 0);

        expect(globalThis.Notification).not.toHaveBeenCalled();
    });

    test('cleanup resets warning-crossed state so a new character starts unarmed, not pre-tripped', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.requestRunwayNotificationPermission();
        collector.checkRunwayWarning('/items/coffee', 5 * 3600);
        expect(collector.wasBelowRunwayThreshold['/items/coffee']).toBe(true);

        collector.cleanup();

        expect(collector.wasBelowRunwayThreshold).toEqual({});
    });

    test('a party member consumable running low never triggers a notification', async () => {
        const collector = new CombatStatsDataCollector();
        collector.isInitialized = true;
        collector.characterId = 'character-a';
        collector.runwayNotificationPermissionGranted = true;
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
});

describe('CombatStatsDataCollector expected-loot integration', () => {
    function regularZoneAction(zoneHrid = '/actions/combat/rat', difficultyTier = 0) {
        return { actionHrid: zoneHrid, isDone: false, difficultyTier };
    }

    function battlePayload({ battleId, monsterHrids, combatLevel = 100, combatStats = {} }) {
        return {
            battleId,
            combatStartTime: new Date().toISOString(),
            monsters: monsterHrids.map((hrid) => ({ hrid })),
            players: [
                {
                    character: { id: 'character-a', name: 'Self' },
                    combatConsumables: [],
                    totalLootMap: {},
                    totalSkillExperienceMap: {},
                    combatDetails: { combatLevel, combatStats },
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
});
