# 开箱分析 — 间接兑换定价（opt-in）设计文档

- **日期：** 2026-10-10
- **状态：** 已批准（用户在会话中确认）
- **载体：** 独立 PR（提案性质，用户自提自实现，是否合并由维护者决定）；PR 描述用英文
- **建议分支名：** `feat/openable-indirect-pricing`
- **与 [自愈设计](./2026-10-10-openable-analytics-self-heal-design.md) 的关系：** 两 PR 相互独立、可单独合并；建议本 PR 先落（自愈重估依赖定价精度，本 PR 落地后自愈能一并修复卷轴类 partial 记录）

## 目标

开箱分析中，部分开出的物品（如迷宫印章/卷轴）没有直接市价，导致 Actual 被标为 partial、
整个容器的幸运值永久显示"—"。本设计为这类物品沿**官方特殊货币商店兑换链**解析隐含价格，
使幸运值可计算——但仅限开箱分析 opt-in 使用，其他所有功能（利润显示、净资产、市场 EV 提示）
行为零变化。

## 背景与问题

- `resolveSellSideValue`（`src/features/market/expected-value-calculator.js`）已对 Coin、
  Cowbell、4 种副本代币做特例估值；但**通过代币兑换获得的非可交易物品**（印章等）落入
  "普通市场物品"分支，因 `isTradable: false` 无市价返回 null。
- 用户已在 UI 层看到这类物品的价值提示：`dungeon-token-tooltips.js` 的 `_handleSeal`
  （印章价值 = 30 迷宫代币 × 迷宫商店最优"金币/代币"）。定价公式是现成的，只是没接入定价栈。
- 开箱分析 `calculateLuck` 是 fail-closed 设计：Actual 或 Expected 任一不完整即不显示幸运值。
  两侧都可能因印章类物品受损（开出的物品无法定价 → Actual partial；掉落表含无法定价的掉落物
  → Expected partial）。**因此两侧都要修**（用户已确认）。

## 方案取舍（用户已拍板）

| 方案 | 结论 |
| --- | --- |
| 全局默认启用（resolveSellSideValue 直接加分支） | 否——影响面大，用户明确担心 |
| 纯开箱分析层兜底（只修 Actual） | 否——掉落表含卷轴的箱子 Expected 仍 partial，修不干净 |
| **opt-in 参数穿透共享定价栈，两侧都修** | **采用**——默认关闭零影响，维护者日后可一行改默认值全局启用 |

## 详细设计

### 1. 新增估值工具 `src/utils/shop-redemption-valuation.js`（新文件）

```js
resolveShopRedemptionValue(itemHrid)
// → { value, isOutlier, currencyHrid, tokenCost, outputCount } | null
```

算法：

1. `findShopPurchaseInfo(itemHrid)`（`src/utils/special-currency-shop.js`，已存在）反查三家
   特殊商店（dungeon / task / labyrinth），得 `{ currencyHrid, tokenCost, outputCount }`；
   查不到 → null。
2. 对货币本身估值：
   - **副本代币**（`DUNGEON_TOKEN_HRIDS`）→ 复用 `calculateDungeonTokenValue`
     （`src/utils/token-valuation.js`，含 outlier 钳制与 essence 兜底）。
   - **迷宫/任务代币及其他货币** → 扫描该货币在三家商店的兑换条目，对每个可交易兑换物取
     定价侧价格，`价格 × outputCount ÷ tokenCost` 取最大者。定价侧跟随用户的定价模式设置
     （Conservative/Patient Buy → bid，Hybrid/Optimistic → ask），与
     `calculateDungeonTokenValue` 现行逻辑一致——为此把 bid/ask 侧选择逻辑从
     `calculateDungeonTokenValue` 中提取为共享导出（如 `resolvePricingSide()`），两处共用。
   - 兑换物全部无价 → null。
3. 物品隐含价 = `货币价值 × tokenCost ÷ outputCount`。

**循环依赖约束：** 本文件不得 import `expected-value-calculator`（后者已 import
token-valuation，反向 import 会成环）。因此 v1 对任务代币**只按市场价估值**，不做"箱子 EV
取高"（现有 `_handleTaskToken` 的 tooltip 逻辑保持 UI 层现状不动）；依赖方向单向：
`expected-value-calculator → shop-redemption-valuation → {special-currency-shop, token-valuation, market-data, config, dataManager}`。

### 2. 共享定价栈穿透 opt-in 参数（默认关闭）

`src/features/market/expected-value-calculator.js`：

- `resolveSellSideValue(itemHrid, enhancementLevel = 0, { allowIndirect = false } = {})`：
  在"普通市场物品"分支 `!(dropPrice > 0)` 时，若 `allowIndirect` → 调
  `resolveShopRedemptionValue(itemHrid)`，命中则返回
  `{ value, source: 'shopRedemption', needsTax: false, isOutlier }`。
- `getDropPriceInfo(itemHrid, opts)` / `getDropPrice(itemHrid, opts)` /
  `getDropBreakdown(containerHrid, opts)` / `calculateExpectedValue(itemHrid, opts)`：
  透传 opts。`getDropBreakdown` 的定价点在第 470 行 `this.getDropPriceInfo(itemHrid, opts)`；
  间接定价命中的 drop 自然获得 `hasPriceData: true`（第 496 行），Expected 完整性判定随之通过。
- **零税正确性已内建：** `getDropBreakdown` 第 474-485 行对 `isTradable === false` 的物品
  本来就不叠市场税；开箱分析 `valueGainedItemStack` 只在 `resolved.needsTax && isTradable`
  时计税。间接定价 `needsTax: false`，两处都不会重复计税。

### 3. 开箱分析接线（`openable-analytics-calculator.js`，仅两处）

- `valueGainedItemStack`：`resolveSellSideValue(itemHrid, enhancementLevel || 0, { allowIndirect: true })`
- `calculateExpectedValueForOpening`：`expectedValueCalculator.calculateExpectedValue(containerHrid, { allowIndirect: true })`

直接定价永远优先：有市价时走市价，兜底仅在直接解析返回 null 时生效。

## 边界情况

- **兑换链只走一层**：货币自身无法估值 → null → 该记录维持 partial（保留 fail-closed 语义，
  绝不虚构精确数字）。
- **enhancement level**：印章类无强化市场数据，隐含价与强化等级无关（等级忽略），文档注明。
- **嵌套容器缓存**（`containerCache` 分支）：先于市场分支命中，不受 `allowIndirect` 影响；
  "容器里开出容器再开出卷轴"的深层场景不在本期范围。
- **不加用户设置项**（YAGNI）：这是精度修复，不是偏好；维护者若日后想全局启用，改默认值即可。

## 测试计划（TDD）

- `src/utils/shop-redemption-valuation.test.js`（新建）：印章→迷宫代币→最优兑换物全链、
  outputCount 缩放、定价模式 bid/ask 侧、货币无价返回 null、非商店物品返回 null。
- `expected-value-calculator` 测试补充：默认关闭（现有测试原样通过即零回归证明）；开启后
  不可交易商店物品获得 `hasPriceData: true` 且不计税。
- `openable-analytics-calculator.test.js` 补充：开出到印章 → `actualValueComplete: true`、
  `luckValue` 非 null；掉落表含印章 → `expectedValueComplete: true`。
- 守护：`npm run check:loadout-state` 保持绿（本设计不触碰 loadout-state，仅例行确认）。

## Out of scope

- 任务代币"市场价 vs 箱子 EV 取高"的估值精细化（受循环依赖约束，留待后续）。
- tooltip / 利润显示等其他功能启用间接定价（它们保持默认关闭）。
- 历史记录按当前价格重估（独立 PR，见自愈设计文档）。
