import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * TLA-042: verifies `computeInventoryAwareMissingMaterials` against the REAL
 * `computeBestCraftingPlan` (and real `getArtisanBonus`/`MAX_DEPTH`) so these tests exercise the
 * actual production buy-vs-craft decisions, not a synthetic stand-in. Only the data boundary
 * (`data-manager.js`, `market-data.js`, `game-lookups.js`, and the two action-time helpers) is
 * mocked.
 */

const mockPrices = new Map(); // itemHrid -> ask price (or undefined = no market price)
const mockShopCosts = new Map(); // itemHrid -> shop coin cost

const { mockDataManager } = vi.hoisted(() => ({
    mockDataManager: {
        getInitClientData: vi.fn(),
        getEquipment: vi.fn(() => new Map()),
        getActionDrinkSlots: vi.fn(() => []),
        getSkills: vi.fn(() => new Map()),
        getInventory: vi.fn(() => []),
        getItemDetails: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({ default: mockDataManager }));
vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid) => (mockPrices.has(itemHrid) ? mockPrices.get(itemHrid) : null)),
}));
vi.mock('../../utils/game-lookups.js', () => ({
    getShopCoinCost: vi.fn((itemHrid) => mockShopCosts.get(itemHrid) || 0),
}));
vi.mock('../../utils/action-calculator.js', () => ({
    calculateActionStats: vi.fn(() => ({ actionTime: 1, totalEfficiency: 0 })),
}));
vi.mock('../../utils/efficiency.js', () => ({ calculateEfficiencyMultiplier: vi.fn(() => 1) }));

const { computeInventoryAwareMissingMaterials } = await import('./inventory-aware-fulfillment.js');
const { getItemPrice } = await import('../../utils/market-data.js');

/** Build an itemDetailMap entry. Non-tradeable by default so craft is the only viable strategy. */
function item(name, { isTradable = false } = {}) {
    return { name, isTradable };
}

/** Build an actionDetailMap entry. */
function action(outputHrid, outputCount, inputs, upgradeItemHrid = null, opts = {}) {
    return {
        type: opts.type || '/action_types/tailoring',
        category: opts.category || '/action_types/tailoring',
        outputItems: [{ itemHrid: outputHrid, count: outputCount }],
        inputItems: inputs.map(([itemHrid, count]) => ({ itemHrid, count })),
        upgradeItemHrid,
    };
}

function setGameData(itemDetailMap, actionDetailMap) {
    mockDataManager.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap });
    mockDataManager.getItemDetails.mockImplementation((itemHrid) => itemDetailMap[itemHrid] || null);
}

function setInventory(counts) {
    mockDataManager.getInventory.mockReturnValue(
        Object.entries(counts).map(([itemHrid, count]) => ({
            itemHrid,
            count,
            itemLocationHrid: '/item_locations/inventory',
            enhancementLevel: 0,
        }))
    );
}

const BASE_PARAMS = {
    mode: 'ask',
    buyRawOnly: false,
    forceRootCraft: false,
    timeCostPerHour: 0,
    skipProcessing: false,
};

beforeEach(() => {
    vi.clearAllMocks();
    mockPrices.clear();
    mockShopCosts.clear();
    mockDataManager.getEquipment.mockReturnValue(new Map());
    mockDataManager.getActionDrinkSlots.mockReturnValue([]);
    setInventory({});
});

// --- Umbral Tunic fixture (CP-MM01, 02, 05, 06) -----------------------------------------------

const TUNIC = '/items/umbral_tunic';
const LEATHER = '/items/umbral_leather';
const HIDE = '/items/umbral_hide';
const BEAST_TUNIC = '/items/beast_tunic';
const TUNIC_ACTION = '/actions/tailoring/umbral_tunic';
const LEATHER_ACTION = '/actions/tailoring/umbral_leather';

function setUmbralFixture() {
    setGameData(
        {
            [TUNIC]: item('Umbral Tunic'),
            [LEATHER]: item('Umbral Leather'),
            [HIDE]: item('Umbral Hide', { isTradable: true }),
            [BEAST_TUNIC]: item('Beast Tunic', { isTradable: true }),
        },
        {
            [TUNIC_ACTION]: action(TUNIC, 1, [[LEATHER, 144]], BEAST_TUNIC),
            [LEATHER_ACTION]: action(LEATHER, 1, [[HIDE, 2]]),
        }
    );
}

function umbralParams(overrides = {}) {
    return {
        ...BASE_PARAMS,
        rootActionHrid: TUNIC_ACTION,
        rootItemHrid: TUNIC,
        rootOutputCount: 1,
        numActions: 1,
        ...overrides,
    };
}

describe('CP-MM01: exact live Umbral fixture', () => {
    test('144 Leather required, 136 owned, 1 Hide owned, Beast Tunic owned -> Hide required 16 missing 15', () => {
        setUmbralFixture();
        setInventory({ [LEATHER]: 136, [HIDE]: 1, [BEAST_TUNIC]: 1 });

        const materials = computeInventoryAwareMissingMaterials(umbralParams());

        expect(materials).toEqual([
            { itemHrid: HIDE, itemName: 'Umbral Hide', required: 16, missing: 15, isTradeable: true },
        ]);
        expect(materials.find((m) => m.itemHrid === HIDE).missing).not.toBe(287);
        expect(materials.some((m) => m.itemHrid === LEATHER)).toBe(false);
        expect(materials.some((m) => m.itemHrid === BEAST_TUNIC)).toBe(false);
    });
});

describe('CP-MM02: full intermediate stock stops the subtree entirely', () => {
    test('144 Leather owned -> no Hide is ever considered', () => {
        setUmbralFixture();
        setInventory({ [LEATHER]: 144, [BEAST_TUNIC]: 1 });

        const materials = computeInventoryAwareMissingMaterials(umbralParams());

        expect(materials).toEqual([]);
    });
});

describe('CP-MM04: partial intermediate + buy strategy buys only the deficit', () => {
    test('Leather resolves to buy (cheap market price) -> only the 8-unit deficit is requested, not 144', () => {
        setUmbralFixture();
        mockPrices.set(LEATHER, 1); // cheap enough that buy beats crafting from Hide
        setInventory({ [LEATHER]: 136, [BEAST_TUNIC]: 1 });
        // Make Leather tradable so its cheap price is actually considered.
        setGameData(
            {
                [TUNIC]: item('Umbral Tunic'),
                [LEATHER]: item('Umbral Leather', { isTradable: true }),
                [HIDE]: item('Umbral Hide', { isTradable: true }),
                [BEAST_TUNIC]: item('Beast Tunic', { isTradable: true }),
            },
            {
                [TUNIC_ACTION]: action(TUNIC, 1, [[LEATHER, 144]], BEAST_TUNIC),
                [LEATHER_ACTION]: action(LEATHER, 1, [[HIDE, 2]]),
            }
        );
        mockPrices.set(HIDE, 1_000_000); // Hide expensive on its own so craft-from-Hide loses badly

        const materials = computeInventoryAwareMissingMaterials(umbralParams());

        expect(materials).toEqual([
            { itemHrid: LEATHER, itemName: 'Umbral Leather', required: 144, missing: 8, isTradeable: true },
        ]);
    });
});

describe('CP-MM05: owned upgrade item stops its own subtree', () => {
    const UPGRADE = '/items/upgrade_item';
    const UPGRADE_ACTION = '/actions/tailoring/upgrade_item';
    const UPGRADE_RAW = '/items/upgrade_raw';

    function setFixture() {
        setGameData(
            {
                [TUNIC]: item('Root'),
                [LEATHER]: item('Leather'),
                [HIDE]: item('Hide', { isTradable: true }),
                [UPGRADE]: item('Upgrade Item'),
                [UPGRADE_RAW]: item('Upgrade Raw', { isTradable: true }),
            },
            {
                [TUNIC_ACTION]: action(TUNIC, 1, [[LEATHER, 1]], UPGRADE),
                [LEATHER_ACTION]: action(LEATHER, 1, [[HIDE, 1]]),
                [UPGRADE_ACTION]: action(UPGRADE, 1, [[UPGRADE_RAW, 5]]),
            }
        );
    }

    test('upgrade item fully owned -> its own raw materials are never touched', () => {
        setFixture();
        setInventory({ [UPGRADE]: 1 });

        const materials = computeInventoryAwareMissingMaterials(umbralParams());

        expect(materials.some((m) => m.itemHrid === UPGRADE_RAW)).toBe(false);
    });

    test('upgrade item not owned -> its own raw materials ARE requested', () => {
        setFixture();
        setInventory({});

        const materials = computeInventoryAwareMissingMaterials(umbralParams());

        expect(materials).toEqual(
            expect.arrayContaining([
                { itemHrid: UPGRADE_RAW, itemName: 'Upgrade Raw', required: 5, missing: 5, isTradeable: true },
            ])
        );
    });
});

describe('CP-MM06: owned root output never reduces the requested root action count', () => {
    test('owning 99 finished Tunics does not change the missing-materials result', () => {
        setUmbralFixture();
        setInventory({ [TUNIC]: 99, [LEATHER]: 136, [HIDE]: 1, [BEAST_TUNIC]: 1 });

        const materials = computeInventoryAwareMissingMaterials(umbralParams());

        expect(materials).toEqual([
            { itemHrid: HIDE, itemName: 'Umbral Hide', required: 16, missing: 15, isTradeable: true },
        ]);
    });
});

// --- Batch/shared/rounding fixtures -------------------------------------------------------------

describe('CP-MM07: one shared inventory ledger prevents double-spend across branches', () => {
    const ROOT = '/items/shared_root';
    const A = '/items/shared_a';
    const B = '/items/shared_b';
    const SHARED = '/items/shared_mat';
    const ROOT_ACTION = '/actions/crafting/shared_root';
    const A_ACTION = '/actions/crafting/shared_a';
    const B_ACTION = '/actions/crafting/shared_b';

    test('Root needs A+B, both need 2 Shared, only 3 Shared owned -> Shared required 4 missing 1', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [A]: item('A'),
                [B]: item('B'),
                [SHARED]: item('Shared', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [
                    [A, 1],
                    [B, 1],
                ]),
                [A_ACTION]: action(A, 1, [[SHARED, 2]]),
                [B_ACTION]: action(B, 1, [[SHARED, 2]]),
            }
        );
        setInventory({ [SHARED]: 3 });

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT })
        );

        expect(materials).toEqual([
            { itemHrid: SHARED, itemName: 'Shared', required: 4, missing: 1, isTradeable: true },
        ]);
    });
});

describe('CP-MM08/CP-MM09: intermediate outputCount > 1 uses ceil actions, and batch surplus is reusable', () => {
    const ROOT = '/items/batch_root';
    const A = '/items/batch_a';
    const B = '/items/batch_b';
    const RAW = '/items/batch_raw';
    const ROOT_ACTION = '/actions/crafting/batch_root';
    const A_ACTION = '/actions/crafting/batch_a';
    const B_ACTION = '/actions/crafting/batch_b';

    test('Root needs A x3 + B x1; A (outputCount 2) surplus is reused by B -> only Raw x2 missing', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [A]: item('A'),
                [B]: item('B'),
                [RAW]: item('Raw', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [
                    [A, 3],
                    [B, 1],
                ]),
                [A_ACTION]: action(A, 2, [[RAW, 1]]),
                [B_ACTION]: action(B, 1, [[A, 1]]),
            }
        );
        setInventory({});

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT })
        );

        // A needs 3 -> ceil(3/2) = 2 actions -> produces 4, consumes 1 Raw/action = 2 Raw, surplus 1 A.
        // B needs 1 A -> fully covered by the surplus A, never touches Raw again.
        expect(materials).toEqual([{ itemHrid: RAW, itemName: 'Raw', required: 2, missing: 2, isTradeable: true }]);
    });
});

describe('CP-MM10: root outputCount > 1 with multiple selected actions uses the exact root action count', () => {
    const ROOT = '/items/multi_root';
    const RAW = '/items/multi_raw';
    const ROOT_ACTION = '/actions/crafting/multi_root';

    test('outputCount 5, 2 selected actions, 1 Raw owned -> Raw required 6 missing 5', () => {
        setGameData(
            { [ROOT]: item('Root'), [RAW]: item('Raw', { isTradable: true }) },
            { [ROOT_ACTION]: action(ROOT, 5, [[RAW, 3]]) }
        );
        setInventory({ [RAW]: 1 });

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, rootOutputCount: 5, numActions: 2 })
        );

        expect(materials).toEqual([{ itemHrid: RAW, itemName: 'Raw', required: 6, missing: 5, isTradeable: true }]);
    });
});

describe('CP-MM11: nested three-level rounding matches hand-computed expectations', () => {
    const ROOT = '/items/nested_root';
    const X = '/items/nested_x';
    const Y = '/items/nested_y';
    const RAW = '/items/nested_raw';
    const ROOT_ACTION = '/actions/crafting/nested_root';
    const X_ACTION = '/actions/crafting/nested_x';
    const Y_ACTION = '/actions/crafting/nested_y';

    test('Root -> X x5 (outputCount 3) -> Y x2/action (outputCount 2) -> Raw x1/action', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [X]: item('X'),
                [Y]: item('Y'),
                [RAW]: item('Raw', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [[X, 5]]),
                [X_ACTION]: action(X, 3, [[Y, 2]]),
                [Y_ACTION]: action(Y, 2, [[RAW, 1]]),
            }
        );
        setInventory({});

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT })
        );

        // X: need 5 -> ceil(5/3) = 2 actions -> Y required = ceil(2*2) = 4.
        // Y: need 4 -> ceil(4/2) = 2 actions -> Raw required = ceil(1*2) = 2.
        expect(materials).toEqual([{ itemHrid: RAW, itemName: 'Raw', required: 2, missing: 2, isTradeable: true }]);
    });
});

// --- Settings alignment (CP-MM12..19) -----------------------------------------------------------

describe('CP-MM12/CP-MM13: current BCP Artisan semantics preserved (regular input reduced, upgrade not)', () => {
    const ROOT = '/items/artisan_root';
    const MAT = '/items/artisan_mat';
    const UPGRADE = '/items/artisan_upgrade';
    const ROOT_ACTION = '/actions/crafting/artisan_root';
    const ARTISAN_TEA = '/items/artisan_tea';

    test('8 root actions, 10% Artisan reduces Mat but not Upgrade', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [MAT]: item('Mat', { isTradable: true }),
                [UPGRADE]: item('Upgrade', { isTradable: true }),
                [ARTISAN_TEA]: {
                    name: 'Artisan Tea',
                    isTradable: true,
                    consumableDetail: { buffs: [{ typeHrid: '/buff_types/artisan', flatBoost: 0.1 }] },
                },
            },
            { [ROOT_ACTION]: action(ROOT, 1, [[MAT, 2]], UPGRADE, { type: '/action_types/crafting' }) }
        );
        setInventory({ [MAT]: 1, [UPGRADE]: 3 });
        mockDataManager.getActionDrinkSlots.mockImplementation((actionType) =>
            actionType === '/action_types/crafting' ? [{ itemHrid: ARTISAN_TEA }] : []
        );

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, numActions: 8 })
        );

        expect(materials).toEqual(
            expect.arrayContaining([
                { itemHrid: MAT, itemName: 'Mat', required: 15, missing: 14, isTradeable: true },
                { itemHrid: UPGRADE, itemName: 'Upgrade', required: 8, missing: 5, isTradeable: true },
            ])
        );
    });
});

describe('CP-MM14: "Buy raw materials only" preserved for recursive deficits', () => {
    const ROOT = '/items/braw_root';
    const MID = '/items/braw_mid';
    const RAW = '/items/braw_raw';
    const ROOT_ACTION = '/actions/crafting/braw_root';
    const MID_ACTION = '/actions/crafting/braw_mid';

    test('buyRawOnly=true forces a would-normally-buy intermediate to craft instead', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [MID]: item('Mid', { isTradable: true }),
                [RAW]: item('Raw', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [[MID, 1]]),
                [MID_ACTION]: action(MID, 1, [[RAW, 4]]),
            }
        );
        mockPrices.set(MID, 1); // Mid is cheap to buy directly...
        mockPrices.set(RAW, 100); // ...while crafting it from priced Raw is comparatively expensive
        setInventory({});

        const withoutFlag = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, buyRawOnly: false })
        );
        expect(withoutFlag).toEqual([{ itemHrid: MID, itemName: 'Mid', required: 1, missing: 1, isTradeable: true }]);

        const withFlag = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, buyRawOnly: true })
        );
        // ...but with "buy raw materials only", Mid must be crafted, exposing Raw instead.
        expect(withFlag).toEqual([{ itemHrid: RAW, itemName: 'Raw', required: 4, missing: 4, isTradeable: true }]);
    });
});

describe('CP-MM15: "No processing" preserved for recursive deficits', () => {
    const ROOT = '/items/noproc_root';
    const MID = '/items/noproc_mid';
    const RAW = '/items/noproc_raw';
    const ROOT_ACTION = '/actions/crafting/noproc_root';
    const MID_ACTION = '/actions/crafting/noproc_mid';

    test('skipProcessing=true forces a processing-category intermediate to buy instead of craft', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [MID]: item('Mid', { isTradable: true }),
                [RAW]: item('Raw', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [[MID, 1]]),
                [MID_ACTION]: action(MID, 1, [[RAW, 4]], null, { category: '/action_types/material' }),
            }
        );
        setInventory({});

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, skipProcessing: true })
        );

        expect(materials).toEqual([{ itemHrid: MID, itemName: 'Mid', required: 1, missing: 1, isTradeable: true }]);
    });
});

describe('CP-MM16: Task mode force-craft applies only to the root, never to recursive deficits', () => {
    const ROOT = '/items/task_root';
    const MID = '/items/task_mid';
    const RAW = '/items/task_raw';
    const ROOT_ACTION = '/actions/crafting/task_root';
    const MID_ACTION = '/actions/crafting/task_mid';

    test('forceRootCraft=true does not force-craft a recursive deficit that would naturally buy', () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [MID]: item('Mid', { isTradable: true }),
                [RAW]: item('Raw', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [[MID, 1]]),
                [MID_ACTION]: action(MID, 1, [[RAW, 4]]),
            }
        );
        mockPrices.set(MID, 1); // Mid naturally resolves to buy on its own economics
        mockPrices.set(RAW, 100); // crafting Mid from priced Raw would be comparatively expensive
        setInventory({});

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, forceRootCraft: true })
        );

        // Mid stays a buy leaf; Raw is never reached.
        expect(materials).toEqual([{ itemHrid: MID, itemName: 'Mid', required: 1, missing: 1, isTradeable: true }]);
    });
});

describe('CP-MM17: time-cost strategy behavior is preserved', () => {
    const ROOT = '/items/time_root';
    const MID = '/items/time_mid';
    const RAW = '/items/time_raw';
    const ROOT_ACTION = '/actions/crafting/time_root';
    const MID_ACTION = '/actions/crafting/time_mid';

    test('adding a large time cost can flip a recursive deficit from craft to buy', async () => {
        setGameData(
            {
                [ROOT]: item('Root'),
                [MID]: item('Mid', { isTradable: true }),
                [RAW]: item('Raw', { isTradable: true }),
            },
            {
                [ROOT_ACTION]: action(ROOT, 1, [[MID, 1]]),
                [MID_ACTION]: action(MID, 1, [[RAW, 1]]),
            }
        );
        mockPrices.set(MID, 100); // buy price close to raw craft cost
        setInventory({});

        const { calculateActionStats } = await import('../../utils/action-calculator.js');
        calculateActionStats.mockReturnValue({ actionTime: 3600, totalEfficiency: 0 }); // 1 real hour/action

        const materials = computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, timeCostPerHour: 1_000_000 })
        );

        // Huge time cost makes crafting Mid far more expensive than buying it at 100.
        expect(materials).toEqual([{ itemHrid: MID, itemName: 'Mid', required: 1, missing: 1, isTradeable: true }]);
    });
});

describe('CP-MM18: pricing mode is passed through to every market lookup', () => {
    test('the configured mode string reaches getItemPrice for a recursive deficit', () => {
        const ROOT = '/items/mode_root';
        const MID = '/items/mode_mid';
        const ROOT_ACTION = '/actions/crafting/mode_root';
        setGameData(
            { [ROOT]: item('Root'), [MID]: item('Mid', { isTradable: true }) },
            { [ROOT_ACTION]: action(ROOT, 1, [[MID, 1]]) }
        );
        setInventory({});

        computeInventoryAwareMissingMaterials(
            umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT, mode: 'optimistic' })
        );

        expect(getItemPrice).toHaveBeenCalledWith(MID, expect.objectContaining({ mode: 'optimistic' }));
    });
});

describe('CP-MM19: circular/depth guard preserved', () => {
    test('a chain deeper than MAX_DEPTH resolves to a buy fallback at the cutoff instead of recursing forever', () => {
        const ROOT = '/items/deep_root';
        const ROOT_ACTION = '/actions/crafting/deep_root';
        const LEVELS = 20; // deeper than MAX_DEPTH (15), with no recipe ever defined past the cutoff
        const levelItem = (i) => `/items/deep_l${i}`;
        const levelAction = (i) => `/actions/crafting/deep_l${i}`;

        const itemDetailMap = { [ROOT]: item('Root') };
        const actionDetailMap = { [ROOT_ACTION]: action(ROOT, 1, [[levelItem(1), 1]]) };
        for (let i = 1; i <= LEVELS; i++) {
            itemDetailMap[levelItem(i)] = item(`L${i}`, { isTradable: true });
            // Every level defines a recipe requiring the next level, so if the depth guard failed
            // to cut this off, real recursion would run past MAX_DEPTH rather than stack-overflowing
            // on a synthetic cycle.
            actionDetailMap[levelAction(i)] = action(levelItem(i), 1, [[levelItem(i + 1), 1]]);
        }
        setGameData(itemDetailMap, actionDetailMap);
        setInventory({});

        let materials;
        expect(() => {
            materials = computeInventoryAwareMissingMaterials(
                umbralParams({ rootActionHrid: ROOT_ACTION, rootItemHrid: ROOT })
            );
        }).not.toThrow();

        // The cutoff must land at some bounded level, never expanding the full 20-level chain.
        expect(materials).toHaveLength(1);
        const cutoffLevel = Number(materials[0].itemHrid.replace('/items/deep_l', ''));
        expect(cutoffLevel).toBeLessThan(LEVELS);
        expect(materials[0].missing).toBe(1);
    });
});
