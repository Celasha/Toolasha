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

    test('combat result path renders the localized Purple\'s Gift name', async () => {
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

    test('skilling breakdown path renders the localized Purple\'s Gift name (no error branch)', () => {
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

    test('without translations the English Purple\'s Gift fallback still renders', () => {
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
