# Phase 5.1 — State Contract & Auditable Change

> 版本：`APP_VERSION 0.2.0` / `STORY_STATE_VERSION phase4` / `SCHEMA_VERSION 2` / `CONTRACT_VERSION 5.1`
> 状态：已实现并有回归测试覆盖（`node tests/regression-tests.js`）

**当前没有真实 LLM。** Phase 5.1 不引入任何模型调用、不引入网络层、不引入 Provider 实现。
`AI Provider` 仍然只是一个**边界**（见文末「Provider boundary」），本阶段只做状态契约与可审计变更。

---

## 1. StoryState single source of truth

`StoryState` 是唯一事实来源，由 `StoryStore` 独占持有：

```
StoryState (唯一事实来源，StoryStore 内部 _state)
  ├── meta
  ├── chapters[]
  ├── characters[]
  ├── relationships[]        ← Phase 5.1 新增顶层集合
  ├── world { setting, locations[], factions[], rules[], outlines? }
  ├── timeline[]
  ├── foreshadowing[]
  ├── conflicts[]
  ├── narrative_state { …, changeLedger[] }   ← 审计账本放在事实来源内部
  └── _schema / _stateVersion / _lastParseResult
```

设计约束：

1. **不允许第二数据源**。审计账本（`narrative_state.changeLedger`）刻意不放进独立的 localStorage 键，避免出现"两个真相"。
2. **所有持久化只有一个键**：`novelcraft_unified_v1`（`OLD_NC_KEY` / `OLD_WENSI_KEY` 只用于读取旧数据迁移）。
3. **契约对象必须是纯数据**：任何含函数的 `ChangeSet` 都会被 `StoryContract.validateChangeSet()` 拒绝。

---

## 2. Schema

`SCHEMA_VERSION = 2`（Phase 5.1 **未**改动该值）。

必须支持的集合：`meta`、`chapters`、`characters`、`world`、`relationships`、`timeline`、`foreshadowing`、`conflicts`、`narrative_state`。

| 集合 | 实体 id 形态 | 关键字段 |
| --- | --- | --- |
| `chapters[]` | `chapter_001` | id / title / content / summary / wordCount / status / order / aiAnalysis |
| `characters[]` | `character_001` | id / name / charType / tags / fields / relations / presence / aiProfile |
| `relationships[]` | `relationship_001` | id / fromId / toId / type / note |
| `timeline[]` | `timeline_001` | id / date / event / chapterId / type |
| `foreshadowing[]` | `foreshadow_001` | id / content / chapterPlaced / chapterExpected / status / note / linkedChapterId |
| `conflicts[]` | `conflict_001` | id / type / description / parties / status / chapterStarted / chapterResolved |
| `world.locations[]` | `location_001` | id / name / category / description / attributes |

**ID 规则**：已有的 id 原样保留（向后兼容，例如 `char0`、`ch1`、`FS1`）；缺失或重复的 id 由 `normalize()` 按 `<prefix>_NNN` 顺序补齐 —— **不使用随机数作为业务身份**。`ChangeSet` / `StateChange` 的 id 由内容哈希派生（见 §6）。

`relationships` 与旧的 `characters[].relations` 双向兼容：`normalize()` 会把 `characters[].relations` 镜像成顶层 `relationships` 实体（幂等，按 `fromId+toId+type` 去重）；通过 store 的 `addRelationship/updateRelationship/deleteRelationship` 写入时会反向重建镜像。

---

## 3. Normalize

```
StoryStore.normalize(state)        -> 规范化后的 state（纯函数、幂等、不改动入参、不引入随机性）
StoryStore.normalizeReport(state)  -> { state, warnings }
```

行为：

- 补齐 9 个集合与 `meta` / `narrative_state` 的默认值；
- 类型纠正：非数组集合 → `[]`，非对象 → `{}`，数字字段做 `asNumber` 归一，字符串字段做 `asString` 归一；
- 为缺失/重复 id 分配确定性 id，并记录 warning；
- **剥离可执行值**（函数），并记录 warning —— 契约必须可序列化；
- `_lastParseResult` 深拷贝，避免与外部共享引用。

幂等性是硬要求：`hash(normalize(x)) === hash(normalize(normalize(x)))`（回归测试 12）。

---

## 4. Migration

```
StoryStore.migrate(raw) -> { state, migration: { from, to, applied[] } }
```

支持的路径：

| 输入特征 | 判定 | 动作 |
| --- | --- | --- |
| 含 `_stateVersion` 或 `_schema` | 统一状态 | `_schema < 2` → 升级为 2（记录 `schema:1->2`）；`_schema > 2` → 标记 `schema:future` 并留待校验阶段拒绝 |
| 含 `project` / `worldbuilding` / `timelines` / `foreshadows` | 旧 NovelCraft | `migrateFromNC` |
| 含顶层 `title` + `chapters[]` | 旧文思书稿 | `migrateFromWensi` |
| 其他对象 | 未知 | 原样接纳（`adopt:as-is`），随后由 normalize/validate 决定命运 |

**导入管线（`importJSON`）严格执行五步，失败绝不覆盖当前状态：**

```
JSON parse → migration → normalization → validation → commit
```

- `parse` 失败 → `{ ok:false, stage:'parse' }`
- `validate` 失败 → `{ ok:false, stage:'validate' }`，**当前 `_state` 完全不动**
- 只有全部通过才 `_state = normalized; persist()`（原子替换）

`load()` 复用同一管线：localStorage 中的状态若校验失败，会保留空状态并写 `console.error`，而不是把坏数据载入内存。

---

## 5. Runtime Contracts（纯数据）

定义在全局 `StoryContract`（`CONTRACT_VERSION = '5.1'`）中，全部为纯数据工厂，不含可执行代码。

### EntityRef

```js
{ entityType, entityId, displayName }
```

### Evidence

```js
{ sourceType, sourceId, start, end, excerpt }
```

`start` / `end` 是来源文本中的字符区间（如章节正文里的出现位置），`excerpt` 是证据片段。

### StateChange

```js
{
  changeId,        // 'chg_<hash>'，由 changeSetId + path + 序号派生（确定性）
  actionId,        // 业务动作标识
  type,            // 'add' | 'remove' | 'update'
  target,          // EntityRef
  path,            // 'characters.character_001.name'
  before,          // 变更前的值（add 为 null）
  after,           // 变更后的值（remove 为 null）
  reason,          // 人类可读原因
  evidence: [],    // Evidence[]
  timestamp
}
```

### ChangeSet

```js
{
  changeSetId,     // 'cs_<hash>'，由 source + operation + changes 形状派生（确定性）
  source,          // 例如 'StoryEngine.proposeChapterChanges'
  operation,       // 例如 'parse_chapter'
  changes: [],     // StateChange[]
  createdAt,
  status,          // 见 §7 生命周期
  baseStateHash,   // 生成时的 StoryState 哈希，用于 stale 检测
  approval,        // null | { approver, approvedAt }
  errors: [], warnings: []
}
```

### ValidationResult

```js
{ valid, errors: [], warnings: [], checkedAt }
```

---

## 6. 确定性 ID

| 对象 | 规则 |
| --- | --- |
| 实体 | `<prefix>_NNN` 顺序补齐；已存在的 id 原样保留 |
| `changeSetId` | `cs_` + `StoryStore.hash({source, operation, shape:[{actionId,type,path}]})` |
| `changeId` | `chg_` + `StoryStore.hash(changeSetId + '|' + path + '|' + index)` |

同一份输入、同一个 `options.now`，两次 `propose()` 会得到**完全相同**的 id（回归测试 33），因此 ChangeSet 可测试、可追踪、可去重。

`timestamp` / `createdAt` / `checkedAt` 属于时间字段，可注入（`options.now`），但不参与 id 计算。**契约不引入随机数。**

---

## 7. ChangeSet 生命周期

```
PROPOSED → VALIDATING → VALID → APPROVED → APPLIED → VERIFIED
异常分支：REJECTED（不合法 / 被人工拒绝）   FAILED（应用或校验失败）
```

| API | 作用 |
| --- | --- |
| `ChangeSetRuntime.propose(input, options)` | 生成 ChangeSet（PROPOSED），确定 id，记录 `baseStateHash` |
| `ChangeSetRuntime.validate(cs, options)` | 契约校验；失败 → REJECTED，成功 → VALID |
| `ChangeSetRuntime.approve(cs, approver, options)` | 人工批准；只接受 VALID（PROPOSED 会先自动校验）→ APPROVED |
| `ChangeSetRuntime.reject(cs, reason, options)` | 人工拒绝 → REJECTED |
| `ChangeSetRuntime.apply(cs, options)` | 五道门禁 → 应用 → 验证 → VERIFIED，写审计账本 |
| `AIRuntime.applyChangeSet(cs, options)` | 同上（对外入口） |
| `ChangeSetRuntime.getLedger()` | 读取审计账本 |

### `apply()` 门禁顺序（按实现顺序）

1. **契约合法性** —— `validateChangeSet` 通过；否则 `status = REJECTED`，错误返回。
2. **重复** —— 账本中已有同 `changeSetId` 且状态为 APPLIED/VERIFIED → `duplicate_changeset`（**不重复执行**）。
3. **过期** —— `baseStateHash` 与当前状态哈希不一致 → `stale_changeset`（**不能覆盖新状态**）。
4. **前置条件** —— 每个非 add 变更的 `before` 必须与当前路径值一致，否则 `precondition_failed: <paths>`（**before 不匹配时拒绝执行**）。
5. **批准** —— 状态必须是 APPROVED，否则 `changeset_not_approved`（**未批准不能 apply**）。

通过后：

- 取 `snapshot()` 作为回滚点 → `status = APPLIED` → 经 `AIRuntime.ExecutionLayer.applyChangeSet()` 逐条调用 `StoryStore.applyChange()` 写入；
- 任一条写入失败 → `rollback(before)` + `status = FAILED`（**原子性**）；
- 随后 `verify()`：用 `structuredDiff(before, after)` 核对每条变更是否被真实观测到（路径、changeType、after 值都要匹配），未被提议的附带变化记为 warning；验证失败 → 回滚 + FAILED；
- 全部通过 → `status = VERIFIED`，并向 `narrative_state.changeLedger` 追加一条审计记录（`changeSetId / source / operation / appliedAt / appliedCount / stateHashBefore / stateHashAfter`）。

**审计记录随 StoryState 一起持久化**，因此是唯一事实来源的一部分，而不是旁路日志。

---

## 8. diff

```
StoryStore.diff(before, after)            // 旧 API 保留：按顶层键的粗粒度比较
StoryStore.structuredDiff(before, after)  // Phase 5.1 新增
```

`structuredDiff` 返回：

```js
{ changes: [ { path, before, after, changeType } ] }   // changeType: 'add' | 'remove' | 'update'
```

特性：

- 具名集合（元素均为带 `id` 的对象）按 id 对齐，产出细粒度路径：`characters.character_001.name`、`chapters.chapter_003.wordCount`、`foreshadowing.foreshadow_002.status`；
- 新增实体 → 单条 `add`（`path = collection.<id>`，`before = null`）；删除实体 → 单条 `remove`（`after = null`）；字段变化 → 逐字段 `update`；
- 非具名数组（如 `tags: ['男']`）整体比较，避免把 `[] → ['男']` 误判为"无变化"；
- 输出按 `path` 排序，保证可复现。

---

## 9. snapshot

```
StoryStore.snapshot() -> 规范化后的深拷贝
```

- 返回**新的对象**，与 `_state` 不共享引用（回归测试 23）；
- 返回值已规范化，因此 `hash(snapshot())` 与 `hash(normalize(snapshot()))` 一致，可作为稳定指纹用于 `baseStateHash` / stale 检测 / verify。

---

## 10. rollback

```
StoryStore.rollback(snapshot) -> { ok, errors, warnings }
```

顺序：**校验目标 snapshot → normalize → validate → 成功后原子替换 → 失败不污染当前状态**。

- normalize / validate 全部在临时对象上完成，只有通过才 `_state = normalized`；
- 失败直接返回 `{ ok:false, errors }`，当前 `_state` 一个字节都不变（回归测试 24）；
- 旧的 `rollback(snap)` 调用点（`StoryStateManager.rollback`）兼容，返回值从 `undefined` 变为结果对象。

---

## 11. 与 Action Plan 的关系

Phase 4 的 `ActionPlanSystem`（`Observe → Analyze → Plan → Validate → Approval → Execute → Verify`）**保留不动**，它面向"规则决策 + 人工审批执行单个动作"。

Phase 5.1 的 ChangeSet 面向"一批带 before/after 与证据的状态变更"。两者关系：

| 维度 | Action Plan（Phase 4） | ChangeSet（Phase 5.1） |
| --- | --- | --- |
| 粒度 | 动作（action 名 + target） | 状态变更（路径级 before/after） |
| 落库方式 | `ExecutionLayer._applyDecision` 直接改状态 | `StoryStore.applyChange` 受控写路径 |
| 前置条件 | 无 | `before` 必须与当前值一致 |
| 幂等 | 决策 hash（基于状态计数签名） | `changeSetId` + 审计账本 |
| 过期保护 | 无 | `baseStateHash` |
| 验证 | `verify()` 返回报告但无人消费 | `verify()` 参与判定，失败即回滚 |
| 审计 | 无 | `narrative_state.changeLedger` |

Phase 5.1 **刻意不重构**旧的 Action / `_applyDecision`（本阶段范围外）。因此当前仍存在一条遗留直写路径：

```js
// src/index.html —— AIExecutionLayer.execute / _applyDecision
var s = StoryStore.state;   // 取得活引用，随后直接修改 s.conflicts / s.narrative_state …
```

这条路径属于 Phase 5.2 的收口范围。Phase 5.1 已完成的是：把 `StoryEngine` 与 `AIRuntime.run` 里的两处临时直写改为 store 的受控方法（`setLastParseResult` / `setNarrativeState`），并为新的变更流程提供完整的受控写入口。

`StoryEngine.proposeChapterChanges(content, chapterIdx, options)` 体现"解析与写入分离"：

- 继续使用 Phase 4 的关键词/正则解析能力（本阶段不要求语义解析升级）；
- **只产出 ChangeSet**（`status = PROPOSED`），不写任何状态（回归测试 32 断言状态哈希不变）；
- 产出的变更包括：`chapters.<id>.aiAnalysis` 更新、已存在角色的 `presence` 更新、新角色 `add`、伏笔标记 `add`；
- 每条变更都带 `Evidence`（章节 id + 字符区间 + 片段）。

---

## 12. Provider boundary

- **当前没有真实 LLM。** 代码中不存在 `fetch` / `XHR` / `WebSocket` / `EventSource` / Provider 实现 / Mock Provider。
- Phase 5.1 建立的是"AI 提议必须走契约"的**边界**：任何未来由模型产出的建议，都必须被表述为 `ChangeSet`，经过 validate → approve → apply → verify，并留下审计记录，才能改变状态。
- 这样做的目的是：把模型输出的**不确定性**挡在状态机之外 —— 模型可以随便提议，但只有通过 `before` 前置条件、`baseStateHash` 过期检测与 `structuredDiff` 事后核验的变更才能落库。
- 未来接入 Provider 时的建议接入点（**不在本阶段实现**）：
  - 入口（解析）：`StoryEngine.proposeChapterChanges` 内部把关键词解析替换/补充为结构化抽取；
  - 出口（提议）：`ChangeSetRuntime.propose` 的输入由模型生成；
  - 写入：永远只经过 `AIRuntime.applyChangeSet` → `ExecutionLayer` → `StoryStore`。

---

## 13. 回归测试覆盖

`node tests/regression-tests.js` → **34/34 PASS**（原 10 项全部保留 + Phase 5.1 新增 24 项）。

| # | 用例 | 覆盖点 |
| --- | --- | --- |
| 11 | schema normalization 补齐与纠正 | normalize |
| 12 | normalize 幂等 | normalize |
| 13 | legacy NovelCraft 迁移 | migration |
| 14 | legacy Wensi / schema 升级 | migration |
| 15 | valid import 五步管线 | import commit |
| 16 | JSON 解析失败不改状态 | import 安全 |
| 17 | 校验失败不改状态 | import 安全 |
| 18 | malformed nested data | normalize 容错 |
| 19 | structuredDiff update | diff |
| 20 | structuredDiff add | diff |
| 21 | structuredDiff remove | diff |
| 22 | diff 路径形态 | diff |
| 23 | snapshot 不共享引用且已规范化 | snapshot |
| 24 | rollback 原子替换 / 失败不污染 | rollback |
| 25 | ChangeSet validation → VALID | 生命周期 |
| 26 | APPROVED→APPLIED→VERIFIED | 全链路 |
| 27 | rejection 后不能 apply | 生命周期 |
| 28 | invalid ChangeSet 不改状态 | 安全 |
| 29 | duplicate 不重复执行 | 幂等 |
| 30 | stale 不覆盖新状态 | 过期保护 |
| 31 | before 不匹配拒绝执行 | 前置条件 |
| 32 | proposeChapterChanges 只提议不写入 | 解析/写入分离 |
| 33 | ChangeSet / StateChange ID 确定性 | 确定性 |
| 34 | 契约是纯数据 | 契约约束 |
