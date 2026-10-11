# 开箱分析间接兑换定价（PR1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为无直接市价但有官方特殊货币商店兑换链的物品（印章/卷轴）解析隐含价格，经默认关闭的 `allowIndirect` 参数接入共享定价栈，仅开箱分析 opt-in，使幸运值可计算。

**Architecture:** 新增独立估值工具 `shop-redemption-valuation.js`（`findShopPurchaseInfo` 反查兑换链 → 货币按最优可交易兑换物估值 → 隐含价 = 货币价值 × tokenCost ÷ outputCount）；`resolveSellSideValue → getDropPrice → getDropBreakdown → calculateExpectedValue` 链路透传 `{ allowIndirect }`（默认 false，零行为变化）；开箱分析 `calculator.js` 两处调用传 `true`。

**Tech Stack:** Vitest（vi.hoisted + vi.mock 模式）、ESLint + Prettier（4 空格、单引号、分号、120 列）、rollup 分包构建。

**规格:** `docs/superpowers/specs/2026-10-10-openable-analytics-indirect-pricing-design.md`（在工作分支上需 force-add 带入，见 Task 0）

**关键约束:**

- `shop-redemption-valuation.js` **禁止** import `expected-value-calculator.js`（会循环依赖）。
- `expected-value-calculator.test.js` 用 `vi.mock` 整体替换了 `token-valuation.js` 等模块——新增的 `shop-redemption-valuation.js` import 必须同步加 mock，否则该测试文件全红。
- 所有现有测试必须保持绿色（默认关闭 = 零回归的证明）。

---

## Task 0: 隔离工作区并带入文档

**Files:**

- Create: 工作分支 `feat/openable-indirect-pricing`（基于 `origin/main`）

- [ ] **Step 1: 确认基线**

```bash
git fetch origin main && git log --oneline -1 origin/main
```

- [ ] **Step 2: 创建 worktree 工作分支**（遵循 superpowers:using-git-worktrees；若原生工具不可用则手动）

```bash
git worktree add ../Toolasha-indirect-pricing -b feat/openable-indirect-pricing origin/main
```

- [ ] **Step 3: 带入规格与本计划**（`docs/` 在 .gitignore 中，需 `-f`；从主工作区复制）

```bash
cp docs/superpowers/specs/2026-10-10-openable-analytics-indirect-pricing-design.md ../Toolasha-indirect-pricing/docs/superpowers/specs/
cp docs/superpowers/plans/2026-10-10-openable-analytics-indirect-pricing.md ../Toolasha-indirect-pricing/docs/superpowers/plans/
cd ../Toolasha-indirect-pricing
git add -f docs/superpowers/specs/2026-10-10-openable-analytics-indirect-pricing-design.md docs/superpowers/plans/2026-10-10-openable-analytics-indirect-pricing.md
git commit -m "docs: add indirect-pricing design spec and plan"
npm install
```

---

## Task 1: 从 `calculateDungeonTokenValue` 提取 `resolvePricingSide()`（纯重构）

**Files:**

- Modify: `src/utils/token-valuation.js`
- Test: `src/utils/token-valuation.test.js`（仅运行，不改）

- [ ] **Step 1: 跑现有测试确认绿色基线**

Run: `npx vitest run src/utils/token-valuation.test.js`
Expected: 8 passed

- [ ] **Step 2: 在 `token-valuation.js` 中新增导出（放在 `DUNGEON_TOKEN_HRIDS` 之后）**

```js
/**
 * Resolve which market price side the current pricing-mode settings select: bid for
 * Conservative/Patient Buy (buy-side-cheap convention), ask for Hybrid/Optimistic - or always
 * bid when mode-respect is disabled.
 * @param {string} pricingModeSetting - Config setting key for pricing mode
 * @param {string|null} respectModeSetting - Config setting key for the respect-mode flag (null disables respect)
 * @returns {'bid'|'ask'} The selected market price side
 */
export function resolvePricingSide(pricingModeSetting, respectModeSetting) {
    const pricingMode = config.getSettingValue(pricingModeSetting, 'conservative');
    const respectPricingMode = config.getSettingValue(respectModeSetting, true);
    return !respectPricingMode
        ? 'bid'
        : pricingMode === 'conservative' || pricingMode === 'patientBuy'
          ? 'bid'
          : 'ask';
}
```

- [ ] **Step 3: `calculateDungeonTokenValue` 两处改用共享函数**

商店循环内（原第 56-64 行）替换为：

```js
        // Conservative/Patient Buy: Bid, Hybrid/Optimistic: Ask
        const mode = resolvePricingSide(pricingModeSetting, respectModeSetting);
```

essence 兜底内（原第 90-97 行）同样替换为上面这一行（保留兜底其余逻辑不变）。

- [ ] **Step 4: 重构后测试仍绿**

Run: `npx vitest run src/utils/token-valuation.test.js`
Expected: 8 passed（行为零变化）

- [ ] **Step 5: Commit**

```bash
git add src/utils/token-valuation.js
git commit -m "refactor(pricing): extract shared resolvePricingSide from calculateDungeonTokenValue"
```

---

## Task 2: 新建 `shop-redemption-valuation.js`（TDD）

**Files:**

- Create: `src/utils/shop-redemption-valuation.js`
- Test: `src/utils/shop-redemption-valuation.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: null,
    getItemPriceOutlierInfo: vi.fn(),
    getSettingValue: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
    default: { getSettingValue: (...args) => mocks.getSettingValue(...args) },
}));
vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => mocks.gameData) },
}));
vi.mock('./market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));

// 特意不 mock token-valuation / special-currency-shop：真实模块 + 可控 gameData 做轻集成
import { resolveShopRedemptionValue } from './shop-redemption-valuation.js';

function resetGameData() {
    mocks.gameData = {
        itemDetailMap: {
            '/items/seal_of_efficiency': { isOpenable: false, isTradable: false },
            '/items/chimerical_quiver': { isOpenable: false, isTradable: false },
            '/items/labyrinth_essence': { isOpenable: false },
            '/items/pathbreaker_lodestone': { isOpenable: false },
            '/items/weapon_a': { isOpenable: false },
            '/items/weapon_b': { isOpenable: false },
        },
        shopItemDetailMap: {
            '/shop_items/weapon_a': {
                itemHrid: '/items/weapon_a',
                costs: [{ itemHrid: '/items/chimerical_token', count: 10 }],
            },
            '/shop_items/weapon_b': {
                itemHrid: '/items/weapon_b',
                costs: [{ itemHrid: '/items/chimerical_token', count: 5 }],
            },
            '/shop_items/chimerical_quiver': {
                itemHrid: '/items/chimerical_quiver',
                costs: [{ itemHrid: '/items/chimerical_token', count: 35000 }],
            },
        },
        labyrinthShopItemDetailMap: {
            '/labyrinth_shop_items/seal_of_efficiency': {
                itemHrid: '/items/seal_of_efficiency',
                cost: { itemHrid: '/items/labyrinth_token', count: 30 },
                outputCount: 1,
            },
            '/labyrinth_shop_items/labyrinth_essence': {
                itemHrid: '/items/labyrinth_essence',
                cost: { itemHrid: '/items/labyrinth_token', count: 1 },
                outputCount: 10,
            },
            '/labyrinth_shop_items/pathbreaker_lodestone': {
                itemHrid: '/items/pathbreaker_lodestone',
                cost: { itemHrid: '/items/labyrinth_token', count: 1000 },
                outputCount: 1,
            },
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetGameData();
    mocks.getSettingValue.mockImplementation((_key, fallback) => fallback);
    // 默认全部无价，各用例自行覆盖
    mocks.getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });
});

describe('resolveShopRedemptionValue', () => {
    test('values a seal via its labyrinth-token redemption chain (best redemption wins)', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/labyrinth_essence') return { value: 100, isOutlier: false }; // 100×10/1 = 1000/token
            if (itemHrid === '/items/pathbreaker_lodestone') return { value: 50000, isOutlier: false }; // 50000/1000 = 50/token
            return { value: null, isOutlier: false };
        });

        const result = resolveShopRedemptionValue('/items/seal_of_efficiency');

        expect(result).toEqual({
            value: 30000, // 30 tokens × 1000/token ÷ outputCount 1
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });
    });

    test('honors outputCount when dividing the implied per-unit value', () => {
        mocks.gameData.labyrinthShopItemDetailMap['/labyrinth_shop_items/seal_of_efficiency'].outputCount = 2;
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) =>
            itemHrid === '/items/labyrinth_essence' ? { value: 100, isOutlier: false } : { value: null, isOutlier: false }
        );

        const result = resolveShopRedemptionValue('/items/seal_of_efficiency');

        expect(result.value).toBe(15000); // 30 × 1000 ÷ 2
        expect(result.outputCount).toBe(2);
    });

    test('prices dungeon-token shop items via the existing calculateDungeonTokenValue chain', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/weapon_a') return { value: 100, isOutlier: false }; // 100/10 = 10/token
            if (itemHrid === '/items/weapon_b') return { value: 100, isOutlier: false }; // 100/5 = 20/token (best)
            return { value: null, isOutlier: false };
        });

        const result = resolveShopRedemptionValue('/items/chimerical_quiver');

        expect(result).toMatchObject({ value: 700000, currencyHrid: '/items/chimerical_token', tokenCost: 35000 }); // 20 × 35000
    });

    test('propagates the outlier flag from the winning redemption', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) =>
            itemHrid === '/items/labyrinth_essence' ? { value: 100, isOutlier: true } : { value: null, isOutlier: false }
        );

        expect(resolveShopRedemptionValue('/items/seal_of_efficiency').isOutlier).toBe(true);
    });

    test('uses the bid side in conservative mode and the ask side in hybrid mode', () => {
        mocks.getSettingValue.mockImplementation((key, fallback) =>
            key === 'profitCalc_pricingMode' ? 'conservative' : fallback
        );
        mocks.getItemPriceOutlierInfo.mockImplementation((_itemHrid, opts) => {
            expect(opts.mode).toBe('bid');
            return { value: null, isOutlier: false };
        });
        resolveShopRedemptionValue('/items/seal_of_efficiency');

        mocks.getSettingValue.mockImplementation((key, fallback) =>
            key === 'profitCalc_pricingMode' ? 'hybrid' : fallback
        );
        mocks.getItemPriceOutlierInfo.mockClear();
        mocks.getItemPriceOutlierInfo.mockImplementation((_itemHrid, opts) => {
            expect(opts.mode).toBe('ask');
            return { value: null, isOutlier: false };
        });
        resolveShopRedemptionValue('/items/seal_of_efficiency');
    });

    test('returns null for an item with no official shop purchase', () => {
        expect(resolveShopRedemptionValue('/items/not_in_any_shop')).toBeNull();
    });

    test('returns null when every redemption target of the currency is unpriced', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });

        expect(resolveShopRedemptionValue('/items/seal_of_efficiency')).toBeNull();
    });

    test('returns null when game data is unavailable', () => {
        mocks.gameData = null;

        expect(resolveShopRedemptionValue('/items/seal_of_efficiency')).toBeNull();
    });
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run src/utils/shop-redemption-valuation.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/utils/shop-redemption-valuation.js`**

```js
/**
 * Shop Redemption Valuation
 * Indirect pricing for items with no direct market price but an official special-currency shop
 * purchase (e.g. seals bought with labyrinth tokens): implied value = currency value × tokenCost
 * ÷ outputCount, where the currency itself is valued at its best tradeable redemption across the
 * special-currency shops. Consumers opt in through expected-value-calculator's `allowIndirect`
 * flag. This module must never import expected-value-calculator (circular dependency: it already
 * imports token-valuation).
 */

import config from '../core/config.js';
import { getItemPriceOutlierInfo } from './market-data.js';
import { calculateDungeonTokenValue, DUNGEON_TOKEN_HRIDS, resolvePricingSide } from './token-valuation.js';
import { findShopPurchaseInfo, getShopEntriesForCurrency } from './special-currency-shop.js';

const PRICING_MODE_SETTING = 'profitCalc_pricingMode';
const RESPECT_MODE_SETTING = 'expectedValue_respectPricingMode';

/**
 * Value one special currency at its best tradeable redemption across the special-currency shops.
 * Dungeon tokens reuse `calculateDungeonTokenValue` (outlier clamping + essence fallback); every
 * other currency takes the highest (price × outputCount ÷ tokenCost) over its own shop entries,
 * mirroring the dungeon-token formula so all currencies share one convention.
 * @param {string} currencyHrid - e.g. '/items/labyrinth_token'
 * @returns {{value: number, isOutlier: boolean}|null} Value per currency unit, or null
 */
function resolveCurrencyValue(currencyHrid) {
    if (DUNGEON_TOKEN_HRIDS.has(currencyHrid)) {
        return calculateDungeonTokenValue(currencyHrid, PRICING_MODE_SETTING, RESPECT_MODE_SETTING);
    }

    const mode = resolvePricingSide(PRICING_MODE_SETTING, RESPECT_MODE_SETTING);
    let bestValuePerToken = 0;
    let bestIsOutlier = false;

    for (const entry of getShopEntriesForCurrency(currencyHrid)) {
        const priceInfo = getItemPriceOutlierInfo(entry.itemHrid, { mode });
        const marketPrice = priceInfo.value || 0;
        if (marketPrice <= 0) continue;
        const valuePerToken = (marketPrice * (entry.outputCount || 1)) / entry.tokenCost;
        if (valuePerToken > bestValuePerToken) {
            bestValuePerToken = valuePerToken;
            bestIsOutlier = priceInfo.isOutlier;
        }
    }

    return bestValuePerToken > 0 ? { value: bestValuePerToken, isOutlier: bestIsOutlier } : null;
}

/**
 * Resolve an item's implied value through its official special-currency shop purchase. Returns
 * null (never a fake zero) when the item is not shop-purchased or its currency cannot be priced.
 * The implied value is not taxed - shop-redeemed items cannot be relisted on the market, mirroring
 * how the dungeon-token special case is treated upstream.
 * @param {string} itemHrid - e.g. '/items/seal_of_efficiency'
 * @returns {{value: number, isOutlier: boolean, currencyHrid: string, tokenCost: number, outputCount: number}|null}
 */
export function resolveShopRedemptionValue(itemHrid) {
    const purchase = findShopPurchaseInfo(itemHrid);
    if (!purchase) return null;

    const currencyValue = resolveCurrencyValue(purchase.currencyHrid);
    if (!currencyValue || !(currencyValue.value > 0)) return null;

    const outputCount = purchase.outputCount || 1;
    return {
        value: (currencyValue.value * purchase.tokenCost) / outputCount,
        isOutlier: currencyValue.isOutlier || false,
        currencyHrid: purchase.currencyHrid,
        tokenCost: purchase.tokenCost,
        outputCount,
    };
}
```

- [ ] **Step 4: 测试转绿**

Run: `npx vitest run src/utils/shop-redemption-valuation.test.js`
Expected: 8 passed

- [ ] **Step 5: 确认没破坏被复用的模块**

Run: `npx vitest run src/utils/token-valuation.test.js src/utils/special-currency-shop.test.js`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add src/utils/shop-redemption-valuation.js src/utils/shop-redemption-valuation.test.js
git commit -m "feat(pricing): add shop-redemption indirect valuation for special-currency items"
```

---

## Task 3: `resolveSellSideValue` 接入 `allowIndirect`（默认关闭）

**Files:**

- Modify: `src/features/market/expected-value-calculator.js`（import 区 + `resolveSellSideValue` 第 305-315 行的普通市场物品分支）
- Test: `src/features/market/expected-value-calculator.test.js`

- [ ] **Step 1: 在 EV 测试文件加 mock（放在现有 `vi.mock('../../utils/token-valuation.js', ...)` 之后）**

```js
const { mockResolveShopRedemptionValue } = vi.hoisted(() => ({ mockResolveShopRedemptionValue: vi.fn() }));
vi.mock('../../utils/shop-redemption-valuation.js', () => ({
    resolveShopRedemptionValue: mockResolveShopRedemptionValue,
}));
```

并在 `beforeEach` 中加 `mockResolveShopRedemptionValue.mockReset();`

- [ ] **Step 2: 写失败测试（加进现有 `describe('resolveSellSideValue')`）**

```js
    test('an unpriced item stays null by default and never consults the redemption chain', () => {
        mockGetItemPrice.mockReturnValue(null);
        expect(expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency')).toBeNull();
        expect(mockResolveShopRedemptionValue).not.toHaveBeenCalled();
    });

    test('allowIndirect resolves an unpriced shop-redeemable item as shopRedemption, never taxed', () => {
        mockGetItemPrice.mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReturnValue({
            value: 30000,
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });

        expect(
            expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency', 0, { allowIndirect: true })
        ).toEqual({ value: 30000, source: 'shopRedemption', needsTax: false, isOutlier: false });
    });

    test('allowIndirect still returns null when the redemption chain cannot price the currency', () => {
        mockGetItemPrice.mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReturnValue(null);

        expect(
            expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency', 0, { allowIndirect: true })
        ).toBeNull();
    });

    test('a direct market price wins and the redemption chain is not consulted', () => {
        mockGetItemPrice.mockReturnValue(123);
        mockResolveShopRedemptionValue.mockReturnValue({
            value: 30000,
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });

        const result = expectedValueCalculator.resolveSellSideValue('/items/some_item', 0, { allowIndirect: true });

        expect(result.source).toBe('market');
        expect(mockResolveShopRedemptionValue).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: 确认失败**

Run: `npx vitest run src/features/market/expected-value-calculator.test.js`
Expected: 新增 4 个用例中前 3 个 FAIL（未调用/未透传），第 4 个 PASS

- [ ] **Step 4: 实现**

import 区新增：

```js
import { resolveShopRedemptionValue } from '../../utils/shop-redemption-valuation.js';
```

`resolveSellSideValue` 签名与普通市场物品分支替换为：

```js
    resolveSellSideValue(itemHrid, enhancementLevel = 0, { allowIndirect = false } = {}) {
```

```js
        // Regular market item - get price based on pricing mode (sell side - you're selling drops)
        const dropPriceInfo = getItemPriceOutlierInfo(itemHrid, { enhancementLevel, context: 'profit', side: 'sell' });
        const dropPrice = dropPriceInfo.value;
        if (!(dropPrice > 0)) {
            // Opt-in fallback: derive an implied value through the official special-currency shop
            // redemption chain (e.g. a seal bought with labyrinth tokens). Never consulted unless
            // the caller explicitly passes `allowIndirect` (only Openable Analytics does today).
            if (!allowIndirect) return null;
            const indirect = resolveShopRedemptionValue(itemHrid);
            if (!indirect) return null;
            return {
                value: indirect.value,
                source: 'shopRedemption',
                needsTax: false,
                isOutlier: indirect.isOutlier || false,
            };
        }
```

（`if (!(dropPrice > 0)) return null;` 原行删除，其余分支不动。）

- [ ] **Step 5: 整个测试文件转绿（零回归证明）**

Run: `npx vitest run src/features/market/expected-value-calculator.test.js`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add src/features/market/expected-value-calculator.js src/features/market/expected-value-calculator.test.js
git commit -m "feat(pricing): opt-in allowIndirect shop-redemption fallback in resolveSellSideValue"
```

---

## Task 4: `allowIndirect` 穿透 `getDropPrice` / `getDropPriceInfo` / `getDropBreakdown` / `calculateExpectedValue`

**Files:**

- Modify: `src/features/market/expected-value-calculator.js`（第 369-384、391-421、437-504 行附近）
- Test: `src/features/market/expected-value-calculator.test.js`

- [ ] **Step 1: 写失败测试（新 describe，注意 EV 路径需要 `isInitialized` 与 drop 表 fixture）**

```js
describe('allowIndirect threading through the EV path', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockGetItemPrice.mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReset();
        expectedValueCalculator.containerCache.clear();
        expectedValueCalculator.isInitialized = true;
        mockGetItemDetails.mockReturnValue({ isOpenable: true, isTradable: false });
        mockGetInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/chest': [{ itemHrid: '/items/seal_of_efficiency', dropRate: 1, minCount: 1, maxCount: 1 }],
            },
        });
    });

    test('calculateExpectedValue marks a shop-redeemable drop as priced when allowIndirect is on', () => {
        mockResolveShopRedemptionValue.mockReturnValue({
            value: 30000,
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });

        const ev = expectedValueCalculator.calculateExpectedValue('/items/chest', { allowIndirect: true });

        expect(ev.drops[0].hasPriceData).toBe(true);
        // 不可交易掉落不叠市场税：avgCount 1 × dropRate 1 × 30000
        expect(ev.drops[0].expectedValue).toBe(30000);
        expect(ev.expectedValue).toBe(30000);
    });

    test('the same drop stays hasPriceData:false by default (opt-in only)', () => {
        const ev = expectedValueCalculator.calculateExpectedValue('/items/chest');

        expect(ev.drops[0].hasPriceData).toBe(false);
        expect(mockResolveShopRedemptionValue).not.toHaveBeenCalled();
    });
});
```

（若该文件尚无 `mockGetInitClientData`/`mockGetItemDetails` 的 `beforeEach` 默认值，如上直接覆写即可。）

- [ ] **Step 2: 确认失败**

Run: `npx vitest run src/features/market/expected-value-calculator.test.js`
Expected: 2 个新用例 FAIL（参数未透传）

- [ ] **Step 3: 实现透传**

```js
    getDropPrice(itemHrid, opts) {
        return this.resolveSellSideValue(itemHrid, 0, opts)?.value ?? null;
    }

    getDropPriceInfo(itemHrid, opts) {
        const resolved = this.resolveSellSideValue(itemHrid, 0, opts);
        return resolved
            ? { value: resolved.value, isOutlier: resolved.isOutlier || false }
            : { value: null, isOutlier: false };
    }
```

`calculateExpectedValue` 签名与内部调用：

```js
    calculateExpectedValue(itemHrid, { allowIndirect = false } = {}) {
```

```js
        const drops = this.getDropBreakdown(itemHrid, { allowIndirect });
```

`getDropBreakdown` 签名与定价点：

```js
    getDropBreakdown(containerHrid, { allowIndirect = false } = {}) {
```

```js
            const priceInfo = this.getDropPriceInfo(itemHrid, { allowIndirect });
```

（`resolveSellSideValue` 的 `enhancementLevel` 形参保持不变；`getDropPriceInfo` 原本就不传等级，行为一致。）

- [ ] **Step 4: 整文件转绿**

Run: `npx vitest run src/features/market/expected-value-calculator.test.js`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/features/market/expected-value-calculator.js src/features/market/expected-value-calculator.test.js
git commit -m "feat(pricing): thread allowIndirect through drop pricing and container EV"
```

---

## Task 5: 开箱分析接线（calculator 两处 opt-in）

**Files:**

- Modify: `src/features/inventory/openable-analytics/openable-analytics-calculator.js`（`valueGainedItemStack` 第 23 行、`calculateExpectedValueForOpening` 第 88 行）
- Test: `src/features/inventory/openable-analytics/openable-analytics-calculator.test.js`

- [ ] **Step 1: 写失败测试（新 describe）**

```js
describe('opt-in indirect pricing (allowIndirect)', () => {
    test('passes allowIndirect to both resolveSellSideValue and calculateExpectedValue', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, needsTax: false });
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({ expectedValue: 100, drops: [] });

        buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/x', enhancementLevel: 0, count: 1 }],
            grantedBuffs: [],
            timestamp: 0,
            characterId: 'char-a',
        });

        expect(expectedValueCalculator.resolveSellSideValue).toHaveBeenCalledWith('/items/x', 0, {
            allowIndirect: true,
        });
        expect(expectedValueCalculator.calculateExpectedValue).toHaveBeenCalledWith('/items/chest', {
            allowIndirect: true,
        });
    });

    test('a shop-redeemable gain (seal) keeps Actual complete and produces a real Luck value', () => {
        dataManager.getItemDetails.mockReturnValue({ isTradable: false });
        expectedValueCalculator.resolveSellSideValue.mockImplementation((_itemHrid, _level, opts) =>
            opts?.allowIndirect
                ? { value: 30000, source: 'shopRedemption', needsTax: false, isOutlier: false }
                : null
        );
        expectedValueCalculator.calculateExpectedValue.mockImplementation((_itemHrid, opts) =>
            opts?.allowIndirect
                ? {
                      expectedValue: 27000,
                      drops: [{ hasPriceData: true }],
                  }
                : { expectedValue: 0, drops: [{ hasPriceData: false }] }
        );

        const record = buildOpeningRecord({
            containerHrid: '/items/chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/seal_of_efficiency', enhancementLevel: 0, count: 1 }],
            grantedBuffs: [],
            timestamp: 0,
            characterId: 'char-a',
        });

        expect(record.actualValue).toBe(30000);
        expect(record.actualValueComplete).toBe(true);
        expect(record.expectedValueComplete).toBe(true);
        expect(record.luckValue).toBe(3000);
    });
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run src/features/inventory/openable-analytics/openable-analytics-calculator.test.js`
Expected: 新用例 FAIL（未传 allowIndirect）

- [ ] **Step 3: 实现（仅两处改动）**

`valueGainedItemStack` 内：

```js
    const resolved = expectedValueCalculator.resolveSellSideValue(itemHrid, enhancementLevel || 0, {
        allowIndirect: true,
    });
```

`calculateExpectedValueForOpening` 内：

```js
    const ev = expectedValueCalculator.calculateExpectedValue(containerHrid, { allowIndirect: true });
```

- [ ] **Step 4: 该测试文件整体转绿**

Run: `npx vitest run src/features/inventory/openable-analytics/openable-analytics-calculator.test.js`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/features/inventory/openable-analytics/openable-analytics-calculator.js src/features/inventory/openable-analytics/openable-analytics-calculator.test.js
git commit -m "feat(openable-analytics): opt in to indirect shop-redemption pricing for Actual and Expected"
```

---

## Task 6: 全量验证 + 推送 + 英文 PR

- [ ] **Step 1: 全量验证**

```bash
npm run lint && npm test && npm run build:dev && npm run check:loadout-state
```

Expected: lint 无错误；全部测试通过；构建产物生成；loadout-state 守护绿。

- [ ] **Step 2: 浏览器实测**（遵循 browser-verification-loop 技能：装 dev 脚本 → 开一个会掉印章类物品的容器 → 展开详情确认 Actual/Expected/Luck 出现数值且 Actual 无 [部分] 标记 → 交用户测试并取得明确批准）

- [ ] **Step 3: 推送并开 PR（英文描述，提案性质）**

```bash
git push -u fork feat/openable-indirect-pricing
gh pr create --repo Celasha/Toolasha --draft --title "feat(openable-analytics): resolve indirect exchange prices for unpriceable items so Luck stays computable" --body "$(cat <<'EOF'
## Background

In Openable Analytics, when an opening yields an item that `resolveSellSideValue` cannot price directly (e.g. a labyrinth seal), the Actual subtotal is marked incomplete and the entire container's Luck is suppressed to "—" — fail-closed by design, so a precise number is never presented from a partial subtotal.

## Problem

Some unpriceable items do carry a knowable value through the official special-currency shops. Seals are bought with labyrinth tokens, and labyrinth tokens are themselves redeemable for tradeable items, so a defensible market-equivalent price exists — the inventory tooltip already shows it. But the direct sell-side pricing path never reaches it, so any container touching such an item (as a gained item or as a loot-table drop) permanently loses its Luck display.

## Approach

- New util `shop-redemption-valuation.js`: reverse-look up the item's official shop purchase (`findShopPurchaseInfo`), value the currency at its best tradeable redemption (dungeon tokens reuse the existing `calculateDungeonTokenValue`; labyrinth/task currencies use the same best value-per-token formula), implied item value = currency value × tokenCost ÷ outputCount.
- The shared pricing stack gains an opt-in `{ allowIndirect }` flag (default **off**) threaded through `resolveSellSideValue → getDropPrice → getDropBreakdown → calculateExpectedValue`. Direct market prices always win; the redemption chain is only consulted when direct pricing returns null. Only Openable Analytics passes `true`, so profit display, net worth, and market EV tooltips are completely unchanged.
- Implied values are never taxed (shop-redeemed items cannot be relisted), mirroring the existing dungeon-token special case.

## Notes

- This is a feature request I proposed and implemented myself; whether to merge is entirely the maintainer's call.
- With the flag defaulting to off, the shared pricing behavior for every existing consumer is unchanged — the existing test suite passes untouched.
- If you'd prefer this valuation to be available globally later, flipping the default is a one-line change.

EOF
)"
