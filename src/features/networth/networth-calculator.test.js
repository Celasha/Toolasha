import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockGetInitClientData,
    mockGetCharacterGuildBuffLevel,
    mockGetItemPrice,
    mockGetSettingValue,
    mockGetSetting,
    mockGetCombinedData,
    mockGetPricesBatch,
    mockIsExcluded,
    mockGetExclusions,
    mockGetAllSnapshots,
} = vi.hoisted(() => ({
    mockGetInitClientData: vi.fn(),
    mockGetCharacterGuildBuffLevel: vi.fn(),
    mockGetItemPrice: vi.fn(),
    mockGetSettingValue: vi.fn(),
    mockGetSetting: vi.fn(),
    mockGetCombinedData: vi.fn(),
    mockGetPricesBatch: vi.fn(),
    mockIsExcluded: vi.fn(),
    mockGetExclusions: vi.fn(() => []),
    mockGetAllSnapshots: vi.fn(() => []),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: mockGetInitClientData,
        getCharacterGuildBuffLevel: mockGetCharacterGuildBuffLevel,
        getCombinedData: mockGetCombinedData,
        getItemDetails: vi.fn(() => null),
    },
}));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: mockGetSetting,
        getSettingValue: mockGetSettingValue,
    },
}));
vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: mockGetItemPrice,
    getItemPrices: vi.fn(),
}));
vi.mock('../../api/marketplace.js', () => ({
    default: {
        isLoaded: () => true,
        fetch: vi.fn(),
        getPricesBatch: mockGetPricesBatch,
        getPrice: vi.fn(() => ({ ask: 0, bid: 0 })),
    },
}));
vi.mock('./networth-exclusions.js', () => ({
    isExcluded: mockIsExcluded,
    getExclusions: mockGetExclusions,
}));
vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getAllSnapshots: mockGetAllSnapshots,
    },
}));
vi.mock('./networth-cache.js', () => ({
    default: {
        get: vi.fn(() => null),
        set: vi.fn(),
        checkAndInvalidate: vi.fn(),
    },
}));
vi.mock('../../utils/ability-cost-calculator.js', () => ({ calculateAbilityCost: vi.fn(() => 0) }));
vi.mock('../../utils/house-cost-calculator.js', () => ({ calculateHouseBuildCost: vi.fn(() => 0) }));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({ calculateEnhancementPath: vi.fn(() => null) }));
vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn(() => ({})) }));
vi.mock('../tasks/task-profit-calculator.js', () => ({ calculateTaskTokenValue: vi.fn(() => null) }));
vi.mock('../../utils/token-valuation.js', () => ({ calculateDungeonTokenValue: vi.fn(() => 0) }));
vi.mock('../market/expected-value-calculator.js', () => ({
    default: { isInitialized: false, calculateExpectedValue: vi.fn(() => null) },
}));
vi.mock('../../utils/networth-worker-manager.js', () => ({ calculateItemValueBatch: vi.fn(() => []) }));
vi.mock('../combat-stats/combat-stats-calculator.js', () => ({ DUNGEON_CHEST_CHEST_KEYS: {} }));
vi.mock('../../utils/game-lookups.js', () => ({ getShopCoinCost: vi.fn(() => 0) }));
vi.mock('../../utils/profit-constants.js', () => ({
    MARKET_TAX: 0.02,
    COWBELL_BAG_HRID: '/items/bag_of_10_cowbells',
    COWBELL_BAG_TAX: 0.02,
}));
import { calculateAllGuildShrinesCost, buildGuildBuffDisplayName, calculateNetworth } from './networth-calculator.js';

const FORCE_COMBAT = '/guild_buffs/force_combat';
const FORCE_SKILLING = '/guild_buffs/force_skilling';
const RARITY_COMBAT = '/guild_buffs/rarity_combat';
const CREDIT_BROWN = '/items/brown_guild_credit';
const CREDIT_WHITE = '/items/white_guild_credit';
const CONVERSION_ITEM = '/items/coal';

function buffDetail({ shrineHrid, isCombat, levelCosts }) {
    return { shrineHrid, isCombat, levelCosts };
}

describe('buildGuildBuffDisplayName', () => {
    test('formats known shrine + combat buff', () => {
        expect(buildGuildBuffDisplayName(FORCE_COMBAT, { shrineHrid: '/guild_shrines/force', isCombat: true })).toBe(
            'Shrine of Force - Combat'
        );
    });

    test('formats known shrine + skilling buff', () => {
        expect(buildGuildBuffDisplayName(FORCE_SKILLING, { shrineHrid: '/guild_shrines/force', isCombat: false })).toBe(
            'Shrine of Force - Skilling'
        );
    });

    test('falls back to slug for an unrecognized shrine hrid', () => {
        expect(
            buildGuildBuffDisplayName('/guild_buffs/mystery_combat', {
                shrineHrid: '/guild_shrines/mystery',
                isCombat: true,
            })
        ).toBe('Shrine of mystery - Combat');
    });
});

describe('calculateAllGuildShrinesCost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSettingValue.mockReturnValue('ask');
    });

    test('returns empty result when game data has no guildBuffDetailMap', () => {
        mockGetInitClientData.mockReturnValue({});
        const result = calculateAllGuildShrinesCost();
        expect(result).toEqual({ totalCost: 0, breakdown: [] });
    });

    test('skips buffs at level 0 (not purchased)', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({ shrineHrid: '/guild_shrines/force', isCombat: true, levelCosts: {} }),
            },
            itemDetailMap: {},
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(0);

        const result = calculateAllGuildShrinesCost();
        expect(result).toEqual({ totalCost: 0, breakdown: [] });
    });

    test('prices only the Guild Credit portion of each level, ignoring Guild Token cost entirely', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: {
                            guildTokenCost: 400,
                            creditCosts: [{ itemHrid: CREDIT_BROWN, count: 2000 }],
                        },
                    },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockImplementation((hrid) => (hrid === FORCE_COMBAT ? 1 : 0));
        // 1 coal -> 10 brown credits, priced at ask 50 -> 5 gold/credit
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid === CONVERSION_ITEM && opts?.mode === 'ask') return 50;
            return null;
        });

        const result = calculateAllGuildShrinesCost();

        // 2000 credits * 5 gold/credit = 10000; guildTokenCost (400) contributes nothing
        expect(result.totalCost).toBe(10000);
        expect(result.breakdown).toEqual([
            { hrid: FORCE_COMBAT, name: 'Shrine of Force - Combat', level: 1, cost: 10000 },
        ]);
    });

    test('sums costs across multiple levels for a single buff', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: { guildTokenCost: 400, creditCosts: [{ itemHrid: CREDIT_BROWN, count: 2000 }] },
                        2: { guildTokenCost: 800, creditCosts: [{ itemHrid: CREDIT_BROWN, count: 6000 }] },
                    },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(2);
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid === CONVERSION_ITEM && opts?.mode === 'ask') return 50;
            return null;
        });

        const result = calculateAllGuildShrinesCost();

        // level 1: 2000 * 5 = 10000; level 2: 6000 * 5 = 30000; total 40000
        expect(result.totalCost).toBe(40000);
        expect(result.breakdown[0].level).toBe(2);
        expect(result.breakdown[0].cost).toBe(40000);
    });

    test('a credit item with no priced conversion contributes zero without throwing', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: { guildTokenCost: 400, creditCosts: [{ itemHrid: CREDIT_WHITE, count: 2000 }] },
                    },
                }),
            },
            itemDetailMap: {}, // no conversion items at all -> cheapestPerCredit map is empty
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(1);

        const result = calculateAllGuildShrinesCost();

        expect(result.totalCost).toBe(0);
        expect(result.breakdown).toEqual([{ hrid: FORCE_COMBAT, name: 'Shrine of Force - Combat', level: 1, cost: 0 }]);
    });

    test('uses bid pricing when networth_pricingMode is set to bid', () => {
        mockGetSettingValue.mockReturnValue('bid');
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: { guildTokenCost: 400, creditCosts: [{ itemHrid: CREDIT_BROWN, count: 100 }] },
                    },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(1);
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid !== CONVERSION_ITEM) return null;
            if (opts?.mode === 'ask') return 100;
            if (opts?.mode === 'bid') return 40;
            return null;
        });

        const result = calculateAllGuildShrinesCost();

        // bid: 1 coal -> 10 credits at 40 gold -> 4 gold/credit; 100 credits * 4 = 400
        expect(result.totalCost).toBe(400);
    });

    test('aggregates multiple purchased buffs and sorts breakdown by cost descending', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: { 1: { creditCosts: [{ itemHrid: CREDIT_BROWN, count: 1000 }] } },
                }),
                [RARITY_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/rarity',
                    isCombat: true,
                    levelCosts: { 1: { creditCosts: [{ itemHrid: CREDIT_BROWN, count: 5000 }] } },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(1);
        mockGetItemPrice.mockImplementation((hrid, opts) => (opts?.mode === 'ask' ? 10 : null));

        const result = calculateAllGuildShrinesCost();

        expect(result.totalCost).toBe(1000 + 5000); // (1000*1) + (5000*1) at 1 gold/credit
        expect(result.breakdown.map((b) => b.hrid)).toEqual([RARITY_COMBAT, FORCE_COMBAT]);
    });
});

// TLA-037: Net Worth exclusions must apply consistently — Currency category must not bypass Coin,
// and loadout-identity exclusions must apply to Inventory the same way they already apply to Equipped.
describe('calculateNetworth - exclusions (TLA-037)', () => {
    const CATEGORY_CURRENCY = '/item_categories/currency';
    const CATEGORY_WEAPON = '/item_categories/weapon';
    const CATEGORY_POTION = '/item_categories/potion';

    const ITEM_DETAIL_MAP = {
        '/items/coin': { name: 'Coin', categoryHrid: CATEGORY_CURRENCY },
        '/items/silver_coin': { name: 'Silver Coin', categoryHrid: CATEGORY_CURRENCY },
        '/items/sword': { name: 'Sword', categoryHrid: CATEGORY_WEAPON },
        '/items/shield': { name: 'Shield', categoryHrid: CATEGORY_WEAPON },
        '/items/potion': { name: 'Potion', categoryHrid: CATEGORY_POTION },
    };

    const CATEGORY_DETAIL_MAP = {
        [CATEGORY_CURRENCY]: { name: 'Currency' },
        [CATEGORY_WEAPON]: { name: 'Weapon' },
        [CATEGORY_POTION]: { name: 'Potion' },
    };

    // Non-coin prices; Coin itself is priced at face value (1) by the calculator's currency handling.
    const PRICE_MAP = {
        '/items/silver_coin': 10,
        '/items/sword': 1000,
        '/items/shield': 500,
        '/items/potion': 50,
    };

    function item(itemHrid, { count = 1, itemLocationHrid = '/item_locations/inventory', enhancementLevel = 0 } = {}) {
        return { itemHrid, count, itemLocationHrid, enhancementLevel };
    }

    function gameData(characterItems) {
        return {
            characterItems,
            myMarketListings: [],
            characterHouseRoomMap: {},
            characterAbilities: [],
            abilityCombatTriggersMap: {},
            itemDetailMap: ITEM_DETAIL_MAP,
            itemCategoryDetailMap: CATEGORY_DETAIL_MAP,
            actionDetailMap: {},
        };
    }

    function setExclusions(list) {
        mockGetExclusions.mockReturnValue(list);
        mockIsExcluded.mockImplementation((type, value) => list.some((e) => e.type === type && e.value === value));
    }

    function loadoutSnapshot(name, equipment = [], unavailableEquipment = []) {
        return { name, equipment, unavailableEquipment };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // vi.clearAllMocks() clears call history but not mockReturnValue set by prior describe
        // blocks (that requires vi.resetAllMocks()) — pin getInitClientData explicitly so no
        // guild-shrine data leaks in and inflates fixedAssetsTotal.
        mockGetInitClientData.mockReturnValue({});
        mockGetSettingValue.mockReturnValue('ask');
        mockGetSetting.mockReturnValue(false);
        mockGetPricesBatch.mockImplementation((itemsToPrice) => {
            const map = new Map();
            for (const { itemHrid, enhancementLevel } of itemsToPrice) {
                const key = `${itemHrid}:${enhancementLevel}`;
                if (!map.has(key)) {
                    const ask = PRICE_MAP[itemHrid] ?? 0;
                    map.set(key, { ask, bid: ask });
                }
            }
            return map;
        });
        setExclusions([]);
        mockGetAllSnapshots.mockReturnValue([]);
    });

    test('NWX-01: currency not excluded -> coin included normally', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/coin', { count: 1000 })]));
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(1000);
        expect(result.excluded.total).toBe(0);
        expect(result.coins).toBe(1000);
    });

    test('NWX-02: currency category excluded -> coin removed from networth arithmetic', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/coin', { count: 1000 })]));
        setExclusions([{ type: 'category', value: CATEGORY_CURRENCY }]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(0);
        expect(result.excluded.total).toBe(1000);
        expect(result.totalNetworth).toBe(0);
    });

    test('NWX-03: currency excluded -> raw coin count/balance remains the actual amount', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/coin', { count: 1000 })]));
        setExclusions([{ type: 'category', value: CATEGORY_CURRENCY }]);
        const result = await calculateNetworth();
        expect(result.coins).toBe(1000);
    });

    test('NWX-04: currency category exclusion still excludes other currency items', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/silver_coin', { count: 5 })]));
        setExclusions([{ type: 'category', value: CATEGORY_CURRENCY }]);
        const result = await calculateNetworth();
        expect(result.excluded.total).toBe(50);
        expect(result.currentAssets.inventory.value).toBe(0);
    });

    test('NWX-05: individual coin item exclusion still works', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/coin', { count: 1000 })]));
        setExclusions([{ type: 'item', value: '/items/coin' }]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(0);
        expect(result.excluded.total).toBe(1000);
        expect(result.excluded.items[0]).toMatchObject({ type: 'item', value: '/items/coin' });
    });

    test('NWX-06: currency excluded amount includes coin value alongside other currency items', async () => {
        mockGetCombinedData.mockReturnValue(
            gameData([item('/items/coin', { count: 1000 }), item('/items/silver_coin', { count: 5 })])
        );
        setExclusions([{ type: 'category', value: CATEGORY_CURRENCY }]);
        const result = await calculateNetworth();
        expect(result.excluded.total).toBe(1050);
        const categoryExcluded = result.excluded.items.find((e) => e.type === 'category');
        expect(categoryExcluded.amount).toBe(1050);
    });

    test('NWX-07: excluded loadout item currently Equipped remains excluded', async () => {
        mockGetCombinedData.mockReturnValue(
            gameData([item('/items/sword', { itemLocationHrid: '/item_locations/main_hand' })])
        );
        setExclusions([{ type: 'loadout', value: 'Ranged' }]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.currentAssets.equipped.value).toBe(0);
        expect(result.excluded.total).toBe(1000);
    });

    test('NWX-08: excluded loadout item currently in Inventory is excluded', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([{ type: 'loadout', value: 'Ranged' }]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(0);
        expect(result.excluded.total).toBe(1000);
        const loadoutExcluded = result.excluded.items.find((e) => e.type === 'loadout');
        expect(loadoutExcluded).toMatchObject({ value: 'Ranged', amount: 1000 });
    });

    test('NWX-09: unrelated Inventory equipment remains included', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword'), item('/items/shield')]));
        setExclusions([{ type: 'loadout', value: 'Ranged' }]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(500);
        expect(result.currentAssets.inventory.breakdown.map((b) => b.itemHrid)).toEqual(['/items/shield']);
    });

    test('NWX-10: unavailableEquipment identity remains usable for exclusion identity in Inventory', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([{ type: 'loadout', value: 'Ranged' }]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [], [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(0);
        expect(result.excluded.total).toBe(1000);
    });

    test('NWX-13: same HRID at a different enhancement level still follows identity-based exclusion', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword', { enhancementLevel: 5 })]));
        setExclusions([{ type: 'loadout', value: 'Ranged' }]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(0);
    });

    test('NWX-14: item + loadout overlap removes value once', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([
            { type: 'item', value: '/items/sword' },
            { type: 'loadout', value: 'Ranged' },
        ]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.excluded.total).toBe(1000);
        expect(result.excluded.items).toHaveLength(1);
        expect(result.excluded.items[0].type).toBe('item');
    });

    test('NWX-15: category + loadout overlap removes value once', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([
            { type: 'category', value: CATEGORY_WEAPON },
            { type: 'loadout', value: 'Ranged' },
        ]);
        mockGetAllSnapshots.mockReturnValue([loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }])]);
        const result = await calculateNetworth();
        expect(result.excluded.total).toBe(1000);
        expect(result.excluded.items).toHaveLength(1);
        expect(result.excluded.items[0].type).toBe('loadout');
    });

    test('NWX-16: two excluded loadouts sharing one HRID remove value once', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([
            { type: 'loadout', value: 'Ranged' },
            { type: 'loadout', value: 'Melee' },
        ]);
        mockGetAllSnapshots.mockReturnValue([
            loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }]),
            loadoutSnapshot('Melee', [{ itemHrid: '/items/sword' }]),
        ]);
        const result = await calculateNetworth();
        expect(result.excluded.total).toBe(1000);
        expect(result.excluded.items).toHaveLength(1);
    });

    test('NWX-17: removing one overlapping loadout leaves shared identity excluded via the other', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([{ type: 'loadout', value: 'Melee' }]);
        mockGetAllSnapshots.mockReturnValue([
            loadoutSnapshot('Ranged', [{ itemHrid: '/items/sword' }]),
            loadoutSnapshot('Melee', [{ itemHrid: '/items/sword' }]),
        ]);
        const result = await calculateNetworth();
        expect(result.excluded.total).toBe(1000);
        expect(result.excluded.items[0]).toMatchObject({ type: 'loadout', value: 'Melee' });
    });

    test('NWX-18: removing an exclusion causes recalculation to include the asset again, no reload needed', async () => {
        mockGetCombinedData.mockReturnValue(gameData([item('/items/sword')]));
        setExclusions([{ type: 'item', value: '/items/sword' }]);
        const excludedResult = await calculateNetworth();
        expect(excludedResult.currentAssets.inventory.value).toBe(0);

        setExclusions([]);
        const includedResult = await calculateNetworth();
        expect(includedResult.currentAssets.inventory.value).toBe(1000);
    });

    test('NWX-19: totalNetworth/currentAssets/excluded.total reconcile', async () => {
        mockGetCombinedData.mockReturnValue(
            gameData([item('/items/coin', { count: 1000 }), item('/items/sword'), item('/items/potion', { count: 2 })])
        );
        setExclusions([{ type: 'category', value: CATEGORY_CURRENCY }]);
        const result = await calculateNetworth();
        expect(result.currentAssets.inventory.value).toBe(1100);
        expect(result.currentAssets.total).toBe(1100);
        expect(result.totalNetworth).toBe(1100);
        expect(result.excluded.total).toBe(1000);
    });
});
