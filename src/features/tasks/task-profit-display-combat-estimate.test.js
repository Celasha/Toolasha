/**
 * Regression tests for the combat-estimate display fixes from #750 (review follow-up):
 * 1. The questInfo.monsterHrid fast path must render a RESOLVED localized monster
 *    name — removing the getMonsterName() fallback reintroduces a literal "null".
 * 2. All Purple's Gift render sites must resolve the item name through game-i18n
 *    (zh: 小紫牛的礼物) with the English name as fallback.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const gameI18n = vi.hoisted(() => ({ translations: {} }));

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: (ns, hrid, fallback = '') => gameI18n.translations[`${ns}.${hrid}`] ?? fallback,
    getItemName: (hrid, fallback = '') => gameI18n.translations[`itemNames.${hrid}`] ?? fallback,
    getMonsterName: (hrid, fallback = '') => gameI18n.translations[`monsterNames.${hrid}`] ?? fallback,
    getActionName: (hrid, fallback = '') => gameI18n.translations[`actionNames.${hrid}`] ?? fallback,
}));

// t() must surface interpolated params so tests can assert resolved names.
// formatters.js consumes the module's default export, so expose t() both ways.
vi.mock('../../core/i18n.js', () => {
    const t = (key, params = {}) => {
        const entries = Object.entries(params || {});
        if (!entries.length) return key;
        return `${key}[${entries.map(([k, v]) => `${k}=${v}`).join('|')}]`;
    };
    return { t, default: { t } };
});

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => false),
        getSettingValue: vi.fn((_key, fallback) => fallback),
        onSettingChange: vi.fn(),
        SCRIPT_COLOR_ALERT: '#f87171',
        COLOR_LOSS: '#f87171',
        COLOR_ACCENT: '#4a9eff',
    },
}));

const dataManagerMocks = vi.hoisted(() => ({
    initClientData: {},
    combatZoneForMonster: vi.fn(),
    getMonsterHridFromName: vi.fn(() => null),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => dataManagerMocks.initClientData),
        getCombatZoneForMonster: dataManagerMocks.combatZoneForMonster,
        getMonsterHridFromName: dataManagerMocks.getMonsterHridFromName,
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn(), onSocketEvent: vi.fn() },
}));

vi.mock('../../utils/react-input.js', () => ({
    setReactInputValue: vi.fn(),
}));

vi.mock('../../utils/action-panel-helper.js', () => ({
    findActionInput: vi.fn(() => null),
}));

vi.mock('./task-profit-calculator.js', () => ({
    calculateTaskProfit: vi.fn(),
    calculateTaskRewardValue: vi.fn(() => REWARD_VALUE),
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: {},
}));

vi.mock('../../utils/game-lookups.js', () => ({
    getQuestFromTaskCard: vi.fn(() => null),
    matchDefeatDescription: vi.fn((description) => {
        const m = description?.match(/^Defeat\s*-\s*(.+)$/);
        return m ? m[1].trim() : null;
    }),
}));

const combatSim = vi.hoisted(() => ({
    runSimulation: vi.fn(),
    buildGameDataPayload: vi.fn(),
    buildAllPlayerDTOs: vi.fn(),
    getCommunityBuffs: vi.fn(() => []),
    applyLoadoutSnapshotToDTO: vi.fn(() => true),
    calculateSimRevenue: vi.fn(() => ({ netPerHour: 0, dropEntries: [], consumableEntries: [] })),
}));

vi.mock('../combat-sim/combat-sim-runner.js', () => ({
    runSimulation: combatSim.runSimulation,
    CHANNEL_TASKS: 'tasks',
}));

vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    buildGameDataPayload: combatSim.buildGameDataPayload,
    buildAllPlayerDTOs: combatSim.buildAllPlayerDTOs,
    getCommunityBuffs: combatSim.getCommunityBuffs,
    applyLoadoutSnapshotToDTO: combatSim.applyLoadoutSnapshotToDTO,
    calculateSimRevenue: combatSim.calculateSimRevenue,
}));

vi.mock('../../core/loadout-state.js', () => ({ default: {} }));

const ZONE_HRID = '/actions/combat/test_zone';
const FLY_HRID = '/monsters/fly';

const ZONE_ACTION = {
    combatZoneInfo: {
        fightInfo: {
            randomSpawnInfo: {
                spawns: [{ combatMonsterHrid: FLY_HRID, rate: 1, strength: 1, difficultyTier: 0 }],
            },
            bossSpawns: [],
        },
    },
};

const REWARD_VALUE = {
    coins: 0,
    taskTokens: 0,
    purpleGift: 0,
    total: 0,
    error: null,
    breakdown: { tokensReceived: 0, tokenValue: 0, giftPerTask: 0 },
};

const TASK_DATA = {
    description: '',
    quantity: 10,
    currentProgress: 0,
    coinReward: 0,
    taskTokenReward: 0,
    questInfo: { monsterHrid: FLY_HRID },
};

function seedGameData() {
    dataManagerMocks.initClientData = {
        combatMonsterDetailMap: { [FLY_HRID]: { name: 'Fly' } },
        actionDetailMap: { [ZONE_HRID]: ZONE_ACTION },
    };
    dataManagerMocks.combatZoneForMonster.mockReturnValue(ZONE_HRID);
    combatSim.buildGameDataPayload.mockReturnValue({ actionDetailMap: { [ZONE_HRID]: ZONE_ACTION } });
    combatSim.buildAllPlayerDTOs.mockResolvedValue({ players: [{ hrid: 'player1' }] });
    combatSim.runSimulation.mockResolvedValue({ deaths: { [FLY_HRID]: 100 } });
}

describe('TaskProfitDisplay combat estimate (#750 review follow-up)', () => {
    let feature;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        gameI18n.translations = {};
        document.body.innerHTML = '';
        dataManagerMocks.initClientData = {};
        seedGameData();

        ({ default: feature } = await import('./task-profit-display.js'));
    });

    test('questInfo fast path renders the localized monster name, never a literal null', async () => {
        gameI18n.translations['monsterNames./monsters/fly'] = '苍蝇';

        const container = document.createElement('div');
        await feature._runCombatSimEstimate(container, TASK_DATA, '');

        expect(container.innerHTML).toContain('monsterName=苍蝇');
        expect(container.innerHTML).not.toContain('monsterName=null');
    });

    test('runs its simulation on the tasks channel so it never cancels a Combat Sim run', async () => {
        const container = document.createElement('div');
        await feature._runCombatSimEstimate(container, TASK_DATA, '');

        expect(combatSim.runSimulation).toHaveBeenCalledWith(expect.any(Object), undefined, { channel: 'tasks' });
    });

    test("combat result path renders the localized Purple's Gift name", async () => {
        gameI18n.translations['itemNames./items/purples_gift'] = '小紫牛的礼物';

        const container = document.createElement('div');
        feature._renderCombatEstimateResult(
            container,
            TASK_DATA,
            '苍蝇',
            100,
            '1m',
            60,
            '',
            0,
            REWARD_VALUE,
            [],
            [],
            'solo',
            {},
            ZONE_HRID
        );

        expect(container.innerHTML).toContain('小紫牛的礼物');
        expect(container.innerHTML).not.toContain("Purple's Gift");
    });

    test("skilling breakdown path renders the localized Purple's Gift name (no error branch)", () => {
        gameI18n.translations['itemNames./items/purples_gift'] = '小紫牛的礼物';

        const html = feature.buildBreakdownHTML({
            type: 'production',
            hasMissingPrices: false,
            totalProfit: 0,
            rewards: {
                coins: 0,
                taskTokens: 0,
                purpleGift: 5,
                error: null,
                breakdown: { tokensReceived: 0, tokenValue: 0, giftPerTask: 0.1 },
            },
            action: { totalProfit: 0, details: undefined, breakdown: { quantity: 10, perAction: 0 } },
        });

        expect(html).toContain('小紫牛的礼物');
        expect(html).not.toContain("Purple's Gift");
    });

    test('skilling breakdown path renders the localized name in the error branch too', () => {
        gameI18n.translations['itemNames./items/purples_gift'] = '小紫牛的礼物';

        const html = feature.buildBreakdownHTML({
            type: 'production',
            hasMissingPrices: false,
            totalProfit: 0,
            rewards: {
                coins: 0,
                taskTokens: 0,
                purpleGift: 0,
                error: 'market data unavailable',
                breakdown: { tokensReceived: 0, tokenValue: 0, giftPerTask: 0 },
            },
            action: { totalProfit: 0, details: undefined, breakdown: { quantity: 10, perAction: 0 } },
        });

        expect(html).toContain('小紫牛的礼物');
        expect(html).toContain('taskProfitDisplay.loadingEllipsis');
    });

    test("without translations the English Purple's Gift fallback still renders", () => {
        const html = feature.buildBreakdownHTML({
            type: 'production',
            hasMissingPrices: false,
            totalProfit: 0,
            rewards: {
                coins: 0,
                taskTokens: 0,
                purpleGift: 5,
                error: null,
                breakdown: { tokensReceived: 0, tokenValue: 0, giftPerTask: 0.1 },
            },
            action: { totalProfit: 0, details: undefined, breakdown: { quantity: 10, perAction: 0 } },
        });

        expect(html).toContain("Purple's Gift");
    });
});

describe('TaskProfitDisplay._refreshOpenCombatEstimateResults (#771 staleness fix)', () => {
    let feature;

    function buildOpenResultTaskCard(progressText) {
        document.body.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'RandomTask_randomTask';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'RandomTask_name';
        nameDiv.textContent = 'Defeat - Fly';
        card.appendChild(nameDiv);

        const progressDiv = document.createElement('div');
        progressDiv.textContent = progressText;
        card.appendChild(progressDiv);

        const rewardsDiv = document.createElement('div');
        rewardsDiv.className = 'RandomTask_rewards__YZk7D';
        card.appendChild(rewardsDiv);

        const container = document.createElement('div');
        container.className = 'mwi-combat-est-result';
        card.appendChild(container);

        document.body.appendChild(card);
        return container;
    }

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        gameI18n.translations = {};
        document.body.innerHTML = '';
        dataManagerMocks.initClientData = {};
        seedGameData();

        ({ default: feature } = await import('./task-profit-display.js'));
    });

    test('re-renders an open result when progress changes, preserving the cached loadout/mode/simResult', () => {
        const container = buildOpenResultTaskCard('Progress: 5 / 10');
        container.dataset.lastProgress = '3'; // stale - live DOM now shows 5
        const cachedSimResult = { deaths: { [FLY_HRID]: 100 } };
        container._mwiEstimate = {
            monsterHrid: FLY_HRID,
            monsterName: 'Fly',
            loadoutName: 'my-custom-loadout',
            netPerHour: 1000,
            rewardValue: REWARD_VALUE,
            dropEntries: [],
            consumableEntries: [],
            mode: 'zone',
            simResult: cachedSimResult,
            zoneHrid: ZONE_HRID,
            simHours: 2,
        };

        const spy = vi.spyOn(feature, '_renderCombatEstimateResult');
        feature._refreshOpenCombatEstimateResults();

        expect(spy).toHaveBeenCalledTimes(1);
        const args = spy.mock.calls[0];
        expect(args[6]).toBe('my-custom-loadout'); // loadoutName preserved, not reset
        expect(args[11]).toBe('zone'); // mode preserved
        expect(args[12]).toBe(cachedSimResult); // same simResult object - no re-simulation
        expect(args[1].currentProgress).toBe(5); // fresh taskData read from the live DOM
    });

    test('does nothing when progress has not changed since the cached value', () => {
        const container = buildOpenResultTaskCard('Progress: 5 / 10');
        container.dataset.lastProgress = '5';
        container._mwiEstimate = {
            monsterHrid: FLY_HRID,
            monsterName: 'Fly',
            loadoutName: '',
            netPerHour: 0,
            rewardValue: REWARD_VALUE,
            dropEntries: [],
            consumableEntries: [],
            mode: 'solo',
            simResult: { deaths: { [FLY_HRID]: 100 } },
            zoneHrid: ZONE_HRID,
            simHours: 2,
        };

        const spy = vi.spyOn(feature, '_renderCombatEstimateResult');
        feature._refreshOpenCombatEstimateResults();

        expect(spy).not.toHaveBeenCalled();
    });

    test('ignores a container with no cached estimate (e.g. a config panel, not a rendered result)', () => {
        buildOpenResultTaskCard('Progress: 5 / 10');
        // No container._mwiEstimate set.

        const spy = vi.spyOn(feature, '_renderCombatEstimateResult');
        expect(() => feature._refreshOpenCombatEstimateResults()).not.toThrow();
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('TaskProfitDisplay zone summary excludes completed tasks (#771)', () => {
    let feature;
    const OOZE_HRID = '/monsters/ooze';
    const WORM_HRID = '/monsters/worm';

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        gameI18n.translations = {};
        document.body.innerHTML = '';
        dataManagerMocks.initClientData = {};
        seedGameData();
        dataManagerMocks.initClientData.combatMonsterDetailMap[OOZE_HRID] = { name: 'Ooze' };
        dataManagerMocks.initClientData.combatMonsterDetailMap[WORM_HRID] = { name: 'Worm' };
        dataManagerMocks.getMonsterHridFromName.mockImplementation(
            (name) => ({ Fly: FLY_HRID, Ooze: OOZE_HRID, Worm: WORM_HRID })[name] || null
        );

        ({ default: feature } = await import('./task-profit-display.js'));
    });

    function buildTaskInfo(name, progressText) {
        const info = document.createElement('div');
        info.className = 'RandomTask_taskInfo__1uasf';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'RandomTask_name';
        nameDiv.textContent = name;
        info.appendChild(nameDiv);
        const progressDiv = document.createElement('div');
        progressDiv.textContent = progressText;
        info.appendChild(progressDiv);
        const rewardsDiv = document.createElement('div');
        rewardsDiv.className = 'RandomTask_rewards__YZk7D';
        info.appendChild(rewardsDiv);
        return info;
    }

    test('a completed task never becomes "the bottleneck" despite its hoursNeeded computing to Infinity', () => {
        const taskList = document.createElement('div');
        taskList.className = 'TasksPanel_taskList';
        // Completed (rem=0) - without the fix, mKillsPerHour=0 -> hoursNeeded=Infinity, which
        // would always win the "longest remaining time" reduce in computeZoneBottleneck.
        taskList.appendChild(buildTaskInfo('Defeat - Worm', 'Progress: 10 / 10'));
        // Slower of the two remaining in-progress tasks - the real bottleneck (hoursNeeded=2 vs
        // Ooze's 1), distinct enough from Ooze's rate to avoid a tie in the "longest remaining
        // time" reduce.
        taskList.appendChild(buildTaskInfo('Defeat - Fly', 'Progress: 0 / 200'));
        taskList.appendChild(buildTaskInfo('Defeat - Ooze', 'Progress: 0 / 50'));
        document.body.appendChild(taskList);

        const container = document.createElement('div');
        feature._renderCombatEstimateResult(
            container,
            { ...TASK_DATA, description: 'Defeat - Fly', quantity: 200, currentProgress: 0 },
            'Fly',
            100,
            '1h',
            3600,
            '',
            0,
            REWARD_VALUE,
            [],
            [],
            'zone',
            { deaths: { [FLY_HRID]: 100, [OOZE_HRID]: 50, [WORM_HRID]: 0 }, encounters: 150 },
            ZONE_HRID,
            1
        );

        expect(container.innerHTML).toContain('taskProfitDisplay.zoneSummaryLine');
        expect(container.innerHTML).toContain('bottleneckName=Fly');
        expect(container.innerHTML).not.toContain('bottleneckName=Worm');
    });
    test('zone summary quotes the selected percentile and offers the median on hover', () => {
        const taskList = document.createElement('div');
        taskList.className = 'TasksPanel_taskList';
        taskList.appendChild(buildTaskInfo('Defeat - Fly', 'Progress: 0 / 200'));
        taskList.appendChild(buildTaskInfo('Defeat - Ooze', 'Progress: 0 / 50'));
        document.body.appendChild(taskList);

        const container = document.createElement('div');
        feature._renderCombatEstimateResult(
            container,
            { ...TASK_DATA, description: 'Defeat - Fly', quantity: 200, currentProgress: 0 },
            'Fly',
            100,
            '1h',
            3600,
            '',
            0,
            REWARD_VALUE,
            [],
            [],
            'zone',
            { deaths: { [FLY_HRID]: 100, [OOZE_HRID]: 50 }, encounters: 150 },
            ZONE_HRID,
            1
        );

        expect(container.innerHTML).toContain('taskProfitDisplay.zonePercentileSuffix[percent=90]');
        const hint = container.querySelector('.mwi-zone-estimate-hint');
        expect(hint).not.toBeNull();
        expect(hint.title).toContain('taskProfitDisplay.zoneMedianHint');
    });
});
