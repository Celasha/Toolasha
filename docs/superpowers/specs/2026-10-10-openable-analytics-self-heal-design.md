# 开箱分析 — 瞬时缺价冻死修复：加载时静默自愈设计文档

- **日期：** 2026-10-10
- **状态：** 已批准（用户在会话中确认）
- **载体：** 独立 PR；PR 描述用英文
- **建议分支名：** `fix/openable-analytics-self-heal`
- **与 [间接定价设计](./2026-10-10-openable-analytics-indirect-pricing-design.md) 的关系：**
  两 PR 相互独立、可单独合并。本 PR 修复"事后有价却不恢复"；间接定价 PR 扩大"可定价"的
  物品范围。本 PR 先落或后落均正确；间接定价先落时，自愈还能一并修复卷轴类 partial 记录。

## 目标

开箱记录在 `buildOpeningRecord` 时用**当时**市价估值并增量累加进 lifetime 聚合；重载时
`initialize` 原样读回，无任何重算路径。一次瞬时缺价（新物品刚上线、市价快照未缓存）会把
记录永久冻死为 partial，`luckEligibleRecordCount < valuationRecordCount` 永久成立，整个
容器的幸运值从此显示"—"。

本设计在**页面加载时静默自愈**：用当前价格对不完整的历史记录重新估值，增量修复 lifetime
聚合。无提示、无按钮、无需删除（用户已确认）。

## 核心不变式与约束

- **增量修复（不能全量重算）：** history 有 `MAX_HISTORY_EVENTS = 500` 条上限
  （`openable-analytics-storage.js`），lifetime 聚合刻意增量累积以使剪枝不影响总量。因此：
  `lifetime = fold(历史外老记录) + fold(当前 history)`。只对 history 记录做"减旧加新"，
  历史外老贡献不受影响，500 条上限不构成问题。
- **完整记录一律不动：** 当年定价完整的记录保留**开箱当时**的价格——绝不能被今天的价格
  悄悄改写（否则市场漂移会静默重写历史）。只重估**不完整**的记录；它们的重估价是"修复时
  价格"而非"开箱时价格"，是可接受的最优近似（价格快照不保留历史，精确还原不可能，不为此
  过度设计）。

## 详细设计

### 1. `openable-analytics-storage.js` 新增 `subtractRecordFromAggregate(aggregate, record)`

`foldRecordIntoAggregate` 的精确镜像逆操作，逐字段对称相减：

- `eventsCount` −（导入记录不减，与 fold 的 `isImported` 判定一致）
- `containersOpened` − `record.containerCount`
- `actualValueTotal` − `record.actualValue`；`actualValueCompleteEvents` /
  `actualValuePartialEvents` 按 `record.actualValueComplete` 对称减
- `expectedValueTotal` −（available 时 `record.expectedValue`，否则 0）；
  `expectedValueAvailableEvents` / `expectedValueUnavailableEvents` /
  `expectedValuePartialEvents` 对称减
- `valuationRecordCount` − 1；`luckEligibleRecordCount` −（`record.luckValue != null` 时 1）
- `grantedBuffEvents` −（有 grantedBuffs 时 1）
- `itemTotals` / `itemValueTotals` 逐物品相减（`itemValueTotals` 仅对 breakdown 存在且
  `resolved` 的条目减，与 fold 的跳过条件一致）
- `hasImportedData` 保持不变（无法从单条记录反推，保守保留）
- 计数字段用 `Math.max(0, …)` 钳制，防御浮点/历史数据边缘导致的负数；金额字段保留原始差值

### 2. `openable-analytics-data-collector.js` 在 `initialize` 尾部增加 `repairPartialHistory()`

位置：in-memory commit（lifetime/history/session 赋值）之后、注册 `loot_opened` handler
之前，**同步执行**（循环内无 await），天然避免与并发开箱竞争；沿用已捕获的
`generation` 做生命周期守卫。

流程：

1. 候选 = `history.filter(r => r.actualValueComplete === false ||
   (r.expectedValueAvailable && r.expectedValueComplete === false))`
2. 对每条候选：用其**存储的原始输入**重跑
   `buildOpeningRecord({ containerHrid, containerCount, gainedItems, grantedBuffs,
   timestamp, characterId, source, sourceDataComplete })`（存储记录已含全部字段；
   `gainedItems`/`grantedBuffs` 已是规范化形状，重跑幂等）。
3. 重估结果与旧记录有实质差异（actualValue / expectedValue / luck 相关字段变化）时：
   - `lifetime[ch] = foldRecordIntoAggregate(subtractRecordFromAggregate(lifetime[ch], old), rebuilt)`
   - `history[i] = rebuilt`（保留原 timestamp / source / characterId）
   - 标记 `changed = true`
4. `changed` 时才经 `enqueuePersistence` 持久化一次 history + lifetime，并
   `notifyStateChange()`。Session 无需处理（initialize 时恒为空）。

## 边界情况

- **重估后仍不完整**（物品至今无价，或 `sourceDataComplete: false` 的导入残缺）：重估后
  依然 partial，幸运值维持 null——fail-closed 语义保留；若金额有变化仍修复金额（总计更准）。
- **导入聚合（imports）不在修复范围**：imports 存的是折叠后聚合，缺原始逐条明细与
  `sourceDataComplete` 标志；重新导入即整体替换自愈（现有 `importContainers` 原子替换语义）。
  文档/UI 注明即可，不新增机制。
- **幸运值资格翻转**：旧记录 `luckValue: null` → 新记录非 null 时，subtract 按**旧记录**的
  字段减计数、fold 按**新记录**加计数，`luckEligibleRecordCount` 自然 +1，聚合层
  `luckEligibleRecordCount === valuationRecordCount` 判定随之恢复。
- **旧格式记录**（无 `actualValueBreakdown` 的历史数据）：subtract 对缺失 breakdown 的
  记录不减 `itemValueTotals`，与 fold 的对应跳过严格对称，不会引入负库存。
- **多次加载幂等**：修复后再加载，候选集为空（记录已完整）或重估结果无差异 → 零写入。

## 测试计划（TDD）

- `openable-analytics-storage.test.js` 补充：
    - `subtractRecordFromAggregate` 与 `foldRecordIntoAggregate` 互逆性（fold 后 subtract
    应还原原聚合的每个字段）
    - 导入记录的 `eventsCount` 对称性（fold 不加、subtract 不减）
    - 无 breakdown 的旧格式记录不减 `itemValueTotals`
- `openable-analytics-data-collector.test.js` 补充：
    - 初始化时存在一条 partial 记录 + 物品现已可定价 → lifetime 的 `luckEligibleRecordCount`
    与 `actualValueTotal` 更新、history 记录被替换、持久化被调用
    - 完整记录不被触碰（值保持开箱时快照）
    - 物品仍无价 → 记录原样保留、零写入
    - `sourceDataComplete: false` 的记录重估后依然 partial
    - 幂等：二次 initialize 不再产生写入

## Out of scope

- 会话中途价格到达时的即时重估（自愈发生在下次加载，够用且最简）。
- 导入聚合的逐条重建（重新导入即自愈）。
- "提示删除异常记录"（用户原想法，已否决——删除丢失真实开箱历史，重估损失更小）。
- 现有整容器删除按钮保持不动。
