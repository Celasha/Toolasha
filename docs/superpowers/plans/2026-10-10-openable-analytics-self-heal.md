# 开箱分析静默自愈（PR2）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 页面加载时用当前价格对 history 中不完整的开箱记录重新估值，增量修复 lifetime 聚合，使"瞬时缺价"不再永久冻死容器的幸运值；完整记录与开箱时价格一律不动。

**Architecture:** `openable-analytics-storage.js` 新增 `subtractRecordFromAggregate`（`foldRecordIntoAggregate` 的逐字段镜像逆操作）；`openable-analytics-data-collector.js` 的 `initialize()` 在内存 commit 之后、注册 `loot_opened` handler 之前同步执行 `repairPartialHistory()`（减旧贡献 → 重估 → 加新贡献），有变化才经 persistenceQueue 持久化一次。

**Tech Stack:** Vitest（vi.hoisted + vi.mock 模式）、ESLint + Prettier（4 空格、单引号、分号、120 列）。

**规格:** `docs/superpowers/specs/2026-10-10-openable-analytics-self-heal-design.md`（工作分支上需 force-add 带入，见 Task 0）

**关键约束:**

- history 上限 500 条（`MAX_HISTORY_EVENTS`）：**必须增量修复**，不能全量重算——`lifetime = fold(历史外老记录) + fold(当前 history)`，subtract 只作用于 history 记录。
- 完整记录（`actualValueComplete: true` 且 Expected 完整）**绝不重估**——保留开箱时价格快照。
- `sourceDataComplete: false` 的导入残缺记录重估后**依然 partial**（fail-closed 保留）。
- 导入聚合（imports）不在修复范围（重新导入即自愈）。

---

## Task 0: 隔离工作区并带入文档

**Files:**

- Create: 工作分支 `fix/openable-analytics-self-heal`（基于 `origin/main`）

- [ ] **Step 1: 确认基线**

```bash
git fetch origin main && git log --oneline -1 origin/main
```

- [ ] **Step 2: 创建 worktree 工作分支**（遵循 superpowers:using-git-worktrees；若原生工具不可用则手动）

```bash
git worktree add ../Toolasha-self-heal -b fix/openable-analytics-self-heal origin/main
```

- [ ] **Step 3: 带入规格与本计划**（`docs/` 在 .gitignore 中，需 `-f`；从主工作区复制）

```bash
cp docs/superpowers/specs/2026-10-10-openable-analytics-self-heal-design.md ../Toolasha-self-heal/docs/superpowers/specs/
cp docs/superpowers/plans/2026-10-10-openable-analytics-self-heal.md ../Toolasha-self-heal/docs/superpowers/plans/
cd ../Toolasha-self-heal
git add -f docs/superpowers/specs/2026-10-10-openable-analytics-self-heal-design.md docs/superpowers/plans/2026-10-10-openable-analytics-self-heal.md
git commit -m "docs: add self-heal design spec and plan"
npm install
```

---

## Task 1: `subtractRecordFromAggregate`（TDD）

**Files:**

- Modify: `src/features/inventory/openable-analytics/openable-analytics-storage.js`（`foldRecordIntoAggregate` 之后，约第 172 行）
- Test: `src/features/inventory/openable-analytics/openable-analytics-storage.test.js`

- [ ] **Step 1: 写失败测试**（测试文件第 22-37 行的解构 import 中加入 `subtractRecordFromAggregate`，文件末尾追加）

```js
describe('subtractRecordFromAggregate', () => {
    test('is the exact inverse of foldRecordIntoAggregate for a fully-populated record', () => {
        const record = makeRecord({
            grantedBuffs: [{ typeHrid: '/buff_types/efficiency', duration: 300 }],
            actualValueBreakdown: [
                { itemHrid: '/items/coin', enhancementLevel: 0, count: 100, value: 100, resolved: true },
            ],
            expectedValueComplete: true,
            luckValue: 10,
            luckPercent: 11.1,
            source: 'loot_opened',
        });
        const original = createEmptyAggregate();
        const restored = subtractRecordFromAggregate(foldRecordIntoAggregate(original, record), record);
        expect(restored).toEqual(original);
    });

    test('an imported record never touches eventsCount in either direction', () => {
        const record = makeRecord({ source: 'import:edible' });
        const original = createEmptyAggregate();
        const folded = foldRecordIntoAggregate(original, record);
        expect(folded.eventsCount).toBe(0);
        expect(subtractRecordFromAggregate(folded, record).eventsCount).toBe(0);
    });

    test('a pre-breakdown record (no actualValueBreakdown) never touches itemValueTotals', () => {
        const record = makeRecord();
        const aggregate = createEmptyAggregate();
        aggregate.itemValueTotals['/items/coin'] = 500;
        expect(subtractRecordFromAggregate(aggregate, record).itemValueTotals['/items/coin']).toBe(500);
    });

    test('counters clamp at zero but totals keep the raw difference when subtracting from empty', () => {
        const record = makeRecord({ containerCount: 5 });
        const restored = subtractRecordFromAggregate(createEmptyAggregate(), record);
        expect(restored.containersOpened).toBe(0);
        expect(restored.valuationRecordCount).toBe(0);
        expect(restored.luckEligibleRecordCount).toBe(0);
        expect(restored.actualValueTotal).toBe(-100);
    });
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run src/features/inventory/openable-analytics/openable-analytics-storage.test.js`
Expected: FAIL（`subtractRecordFromAggregate` 未导出）

- [ ] **Step 3: 实现（插在 `foldRecordIntoAggregate` 之后）**

```js
/**
 * Exact inverse of `foldRecordIntoAggregate`: subtract one previously-folded record's
 * contributions from an aggregate, returning a new aggregate object. Never mutates the input.
 * Used by the self-heal repair path, which re-values incomplete history records and re-folds
 * them - lifetime = fold(pre-history) + fold(history), so subtracting only history records never
 * touches pre-history contributions. Mirrors fold's skip conditions field-by-field: imported
 * records never touched eventsCount, and records without actualValueBreakdown never contributed
 * to itemValueTotals. Counters clamp at zero defensively; monetary totals keep the raw
 * difference (in the repair flow the fold/subtract invariant makes them non-negative anyway).
 * @param {Object} aggregate
 * @param {Object} record - The record previously folded into `aggregate`
 * @returns {Object} New aggregate with the record's contributions removed
 */
export function subtractRecordFromAggregate(aggregate, record) {
    const base = aggregate || createEmptyAggregate();
    const itemTotals = { ...base.itemTotals };
    const itemValueTotals = { ...base.itemValueTotals };

    for (const item of record.gainedItems || []) {
        itemTotals[item.itemHrid] = Math.max(0, (itemTotals[item.itemHrid] || 0) - item.count);
    }
    for (const item of record.actualValueBreakdown || []) {
        if (!item.resolved) continue;
        itemValueTotals[item.itemHrid] = Math.max(0, (itemValueTotals[item.itemHrid] || 0) - item.value);
    }

    const isImported = typeof record.source === 'string' && record.source.startsWith('import:');
    const expectedPartial = record.expectedValueAvailable && record.expectedValueComplete === false;
    const luckEligible = record.luckValue !== null && record.luckValue !== undefined;

    return {
        eventsCount: Math.max(0, base.eventsCount - (isImported ? 0 : 1)),
        containersOpened: Math.max(0, base.containersOpened - record.containerCount),
        actualValueTotal: base.actualValueTotal - record.actualValue,
        actualValueCompleteEvents: Math.max(0, base.actualValueCompleteEvents - (record.actualValueComplete ? 1 : 0)),
        actualValuePartialEvents: Math.max(0, base.actualValuePartialEvents - (record.actualValueComplete ? 0 : 1)),
        expectedValueTotal: base.expectedValueTotal - (record.expectedValueAvailable ? record.expectedValue : 0),
        expectedValueAvailableEvents: Math.max(
            0,
            base.expectedValueAvailableEvents - (record.expectedValueAvailable ? 1 : 0)
        ),
        expectedValueUnavailableEvents: Math.max(
            0,
            base.expectedValueUnavailableEvents - (record.expectedValueAvailable ? 0 : 1)
        ),
        expectedValuePartialEvents: Math.max(0, (base.expectedValuePartialEvents || 0) - (expectedPartial ? 1 : 0)),
        valuationRecordCount: Math.max(0, (base.valuationRecordCount || 0) - 1),
        luckEligibleRecordCount: Math.max(0, (base.luckEligibleRecordCount || 0) - (luckEligible ? 1 : 0)),
        hasImportedData: Boolean(base.hasImportedData),
        grantedBuffEvents: Math.max(0, base.grantedBuffEvents - (record.grantedBuffs?.length > 0 ? 1 : 0)),
        itemTotals,
        itemValueTotals,
    };
}
```

- [ ] **Step 4: 测试转绿**

Run: `npx vitest run src/features/inventory/openable-analytics/openable-analytics-storage.test.js`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/features/inventory/openable-analytics/openable-analytics-storage.js src/features/inventory/openable-analytics/openable-analytics-storage.test.js
git commit -m "feat(openable-analytics): add subtractRecordFromAggregate as the exact inverse of fold"
```

---

## Task 2: `repairPartialHistory()`（TDD）

**Files:**

- Modify: `src/features/inventory/openable-analytics/openable-analytics-data-collector.js`（import 区、`initialize()` 第 99-101 行之间、新方法）
- Test: `src/features/inventory/openable-analytics/openable-analytics-data-collector.test.js`

- [ ] **Step 1: 测试文件加引用**（在 `const { default: openableAnalyticsDataCollector } = ...` 附近追加）

```js
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');
const { createEmptyAggregate, foldRecordIntoAggregate } = await import('./openable-analytics-storage.js');
const storageMock = (await import('../../../core/storage.js')).default;
```

（共享 EV mock 与 `mocks` 结构**不改**——修复测试用 `mockReturnValue`/`mockImplementation` 按用例覆写，避免影响现有用例。）

- [ ] **Step 2: 写失败测试**（文件末尾追加）

```js
describe('self-heal repair on initialize', () => {
    function partialRecord(overrides = {}) {
        return {
            timestamp: 1,
            characterId: 'char-a',
            containerHrid: '/items/chimerical_chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/mystery', enhancementLevel: 0, count: 1 }],
            grantedBuffs: [],
            actualValue: 0,
            actualValueComplete: false,
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 0, resolved: false },
            ],
            expectedValue: 90,
            expectedValueAvailable: true,
            expectedValueComplete: true,
            sourceDataComplete: true,
            luckValue: null,
            luckPercent: null,
            pricingMode: 'hybrid',
            keyPricingMode: 'ask',
            source: 'loot_opened',
            ...overrides,
        };
    }

    function seedStorage(history, lifetime) {
        mocks.values.set('lifetime:char-a', lifetime);
        mocks.values.set('history:char-a', history);
    }

    async function reinitialize() {
        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();
    }

    test('a partial record is re-valued with current prices; lifetime gains luck eligibility', async () => {
        const old = partialRecord();
        const lifetime = foldRecordIntoAggregate(createEmptyAggregate(), old);
        expect(lifetime.luckEligibleRecordCount).toBe(0);
        seedStorage([old], { '/items/chimerical_chest': lifetime });

        expectedValueCalculator.resolveSellSideValue.mockImplementation((itemHrid) =>
            itemHrid === '/items/mystery' ? { value: 50, needsTax: false } : { value: 10, needsTax: false }
        );
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();

        const history = openableAnalyticsDataCollector.getHistory();
        expect(history[0].actualValue).toBe(50);
        expect(history[0].actualValueComplete).toBe(true);
        expect(history[0].luckValue).toBe(-40);
        expect(history[0].timestamp).toBe(1);

        const lifetimeAfter = openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest');
        expect(lifetimeAfter.luckEligibleRecordCount).toBe(1);
        expect(lifetimeAfter.actualValueTotal).toBe(50);
    });

    test('a complete record keeps its event-time valuation untouched', async () => {
        const complete = partialRecord({
            actualValue: 100,
            actualValueComplete: true,
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 100, resolved: true },
            ],
            luckValue: 10,
        });
        seedStorage([complete], { '/items/chimerical_chest': foldRecordIntoAggregate(createEmptyAggregate(), complete) });
        storageMock.setJSON.mockClear();

        await reinitialize();

        expect(openableAnalyticsDataCollector.getHistory()[0]).toBe(complete);
        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });

    test('a still-unpriced item produces zero writes (fail-closed preserved)', async () => {
        seedStorage([partialRecord()], {
            '/items/chimerical_chest': foldRecordIntoAggregate(
                createEmptyAggregate(),
                partialRecord()
            ),
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue(null);
        // EV 侧保持完整，隔离出"仅物品缺价"这一种情况，避免 expectedValueComplete 翻转干扰断言
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });
        storageMock.setJSON.mockClear();

        await reinitialize();

        expect(openableAnalyticsDataCollector.getHistory()[0].actualValueComplete).toBe(false);
        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });

    test('a sourceDataComplete:false record may gain a value but never gains luck eligibility', async () => {
        seedStorage([partialRecord({ sourceDataComplete: false })], {
            '/items/chimerical_chest': foldRecordIntoAggregate(
                createEmptyAggregate(),
                partialRecord({ sourceDataComplete: false })
            ),
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 50, needsTax: false });
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();

        const history = openableAnalyticsDataCollector.getHistory();
        expect(history[0].actualValue).toBe(50);
        expect(history[0].actualValueComplete).toBe(false);
        expect(history[0].luckValue).toBeNull();
        expect(
            openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest')
                .luckEligibleRecordCount
        ).toBe(0);
    });

    test('repair is idempotent: a second initialize performs zero writes', async () => {
        seedStorage([partialRecord()], {
            '/items/chimerical_chest': foldRecordIntoAggregate(createEmptyAggregate(), partialRecord()),
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 50, needsTax: false });
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();
        // 先等第一次修复的持久化落地，再清空调用记录，否则该写入会计入第二次 initialize
        await openableAnalyticsDataCollector.persistenceQueue;
        storageMock.setJSON.mockClear();
        await reinitialize();

        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: 确认失败**

Run: `npx vitest run src/features/inventory/openable-analytics/openable-analytics-data-collector.test.js`
Expected: 新 describe 全 FAIL（记录未被修复/未被替换）

- [ ] **Step 4: 实现**

import 区把 `buildOpeningRecord` 的 import 扩为：

```js
import { buildOpeningRecord, buildImportedAggregateRecord } from './openable-analytics-calculator.js';
```

（已存在，无需改。）storage import 中加入 `subtractRecordFromAggregate`：

```js
import {
    loadLifetime,
    saveLifetime,
    loadHistory,
    appendHistoryRecord,
    saveHistory,
    loadImports,
    saveImports,
    foldRecordIntoAggregate,
    subtractRecordFromAggregate,
    createEmptyAggregate,
    mergeAggregates,
    resetAll as storageResetAll,
} from './openable-analytics-storage.js';
```

`initialize()` 中，`this.latestRecord = null;`（第 100 行）之后、`this.lootOpenedHandler = ...` 之前插入：

```js
        // Self-heal (OA-REPAIR): re-value incomplete history records with current prices so a
        // transient pricing gap at open time cannot freeze a container's Luck forever. Complete
        // records keep their event-time valuations. Runs synchronously before the loot_opened
        // handler is registered; any repair persists through the ordered queue below.
        if (this.repairPartialHistory()) {
            const repairCharacterId = characterId;
            const historySnapshot = this.history;
            const lifetimeSnapshot = this.lifetime;
            this.enqueuePersistence(async () => {
                const historyOk = await saveHistory(repairCharacterId, historySnapshot);
                const lifetimeOk = await saveLifetime(repairCharacterId, lifetimeSnapshot);
                return historyOk && lifetimeOk;
            });
            this.notifyStateChange();
        }
```

类内新增方法（放在 `recordOpening` 之后）：

```js
    /**
     * Re-value incomplete history records with current prices and incrementally repair the
     * lifetime aggregates they fed: subtract each record's stored contributions, re-run
     * `buildOpeningRecord` on its raw inputs, and fold the rebuilt record back in. A transient
     * pricing gap at open time (e.g. a brand-new item whose market snapshot had not landed)
     * therefore heals on the next load instead of freezing Luck as unavailable forever.
     * Complete records are never touched - they keep their event-time valuations, and market
     * drift must never silently rewrite history. Records with `sourceDataComplete: false` may
     * gain values but stay incomplete (their missing items are genuinely absent data). Imported
     * aggregates are out of scope here - re-importing replaces them wholesale.
     * Synchronous by design: it runs inside initialize() before the loot_opened handler is
     * registered, under the captured lifecycle generation, so it cannot race a live opening.
     * @returns {boolean} Whether any record/aggregates actually changed
     */
    repairPartialHistory() {
        const generation = this.lifecycleGeneration;
        let changed = false;

        for (let i = 0; i < this.history.length; i++) {
            const record = this.history[i];
            const needsRepair =
                record.actualValueComplete === false ||
                (record.expectedValueAvailable && record.expectedValueComplete === false);
            if (!needsRepair) continue;

            const rebuilt = buildOpeningRecord({
                containerHrid: record.containerHrid,
                containerCount: record.containerCount,
                gainedItems: record.gainedItems,
                grantedBuffs: record.grantedBuffs,
                timestamp: record.timestamp,
                characterId: record.characterId,
                source: record.source,
                sourceDataComplete: record.sourceDataComplete !== false,
            });

            const valueChanged =
                rebuilt.actualValue !== record.actualValue ||
                rebuilt.expectedValue !== record.expectedValue ||
                rebuilt.actualValueComplete !== record.actualValueComplete ||
                rebuilt.expectedValueAvailable !== record.expectedValueAvailable ||
                rebuilt.expectedValueComplete !== record.expectedValueComplete ||
                rebuilt.luckValue !== record.luckValue;
            if (!valueChanged) continue;

            this.lifetime = {
                ...this.lifetime,
                [record.containerHrid]: foldRecordIntoAggregate(
                    subtractRecordFromAggregate(this.lifetime[record.containerHrid], record),
                    rebuilt
                ),
            };
            this.history[i] = rebuilt;
            changed = true;
        }

        return changed && generation === this.lifecycleGeneration;
    }
```

- [ ] **Step 5: 整个测试文件转绿（含既有用例零回归）**

Run: `npx vitest run src/features/inventory/openable-analytics/openable-analytics-data-collector.test.js`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add src/features/inventory/openable-analytics/openable-analytics-data-collector.js src/features/inventory/openable-analytics/openable-analytics-data-collector.test.js
git commit -m "fix(openable-analytics): self-heal partial history records against current prices on load"
```

---

## Task 3: 全量验证 + 推送 + 英文 PR

- [ ] **Step 1: 全量验证**

```bash
npm run lint && npm test && npm run build:dev && npm run check:loadout-state
```

Expected: lint 无错误；全部测试通过；构建产物生成；loadout-state 守护绿。

- [ ] **Step 2: 浏览器实测**（遵循 browser-verification-loop 技能：装 dev 脚本 → 确认此前显示"—"的容器在重载后幸运值恢复（若物品现已可定价）→ 完整记录的数值与修复前一致 → 交用户测试并取得明确批准）

- [ ] **Step 3: 推送并开 PR（英文描述，提案性质）**

```bash
git push -u fork fix/openable-analytics-self-heal
gh pr create --repo Celasha/Toolasha --draft --title "fix(openable-analytics): self-heal aggregates from under-priced history so transient gaps don't freeze Luck forever" --body "$(cat <<'EOF'
## Problem

Opening records are valued with the market prices available at open time and folded incrementally into the lifetime aggregate; there is no recompute path on load. So one transient pricing gap — e.g. a brand-new item whose market snapshot had not landed yet — permanently freezes that record as partial, and the whole container's Luck display becomes "—" forever, even after prices arrive.

## Approach

- On `initialize()` (before the `loot_opened` handler is registered), incomplete history records — Actual partial or Expected partial — are re-valued with current prices via the exact same `buildOpeningRecord` math used at open time.
- The lifetime aggregate is repaired incrementally: a new `subtractRecordFromAggregate` (the field-by-field inverse of `foldRecordIntoAggregate`) removes each record's stored contributions, then the rebuilt record is folded back in. History is capped at 500 events, so this subtract-and-refold design is required — a full recompute from history would silently drop pre-history contributions.
- Complete records are never touched: they keep their event-time valuations, and market drift can never silently rewrite history.
- Records whose data is genuinely absent (`sourceDataComplete: false` imports) may gain values but stay partial — fail-closed semantics are preserved. Imported aggregates heal by re-importing.
- Idempotent: once repaired, subsequent loads produce zero writes. No UI, no prompts, no buttons.

## Notes

- This is a fix I proposed and implemented myself; whether to merge is entirely the maintainer's call.
- Companion proposal PR (independent, either order): indirect shop-redemption pricing for items with no direct market price. With that landed, this self-heal also repairs seal-type partial records; without it, it still heals every transient market-gap case.

EOF
)"
