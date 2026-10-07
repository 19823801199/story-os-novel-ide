# Phase 5.2 — Chapter Analysis & Controlled Runtime Migration

> 版本：`APP_VERSION 0.2.0` / `STORY_STATE_VERSION phase4` / `SCHEMA_VERSION 2` / `CONTRACT_VERSION 5.1`
> 测试：`node tests/regression-tests.js` → **69/69 PASS**（Phase 5.1 的 34 项全部保留 + 本阶段新增 35 项）

**本阶段没有接入任何真实 LLM。** 不存在 `fetch` / `XMLHttpRequest` / `WebSocket` / `SSE` / OpenAI / DeepSeek / Kimi / Ollama
调用，也不存在模型设置、流式输出、向量库、RAG、多 Agent、第二数据源。解析仍然是**确定性的关键词/正则解析**。

本阶段只解决一件事：

> **章节文本 → 可审计分析 → 可比较变化 → 可控 ChangeSet → 安全写入**

---

## 1. ChapterAnalysis

```js
StoryEngine.analyzeChapter(chapterId, options) -> ChapterAnalysis | null
```

```js
{
  analysisId,      // 'ca_' + hash({chapterId, sourceHash, contract})   可追踪、确定性
  chapterId,
  sourceHash,      // 由章节正文确定性生成
  analyzedAt,      // 时间字段（不参与身份/去重/语义判定）
  characters,      // Fact[]
  locations,       // Fact[]
  events,          // Fact[]
  relationships,   // Fact[]
  foreshadowing,   // Fact[]
  timeline,        // Fact[]
  emotions,        // Fact[]
  rawFacts,        // Phase 4 parseText 的原始结果（可溯源）
  diagnostics      // { parser, textLength, warnings, unresolved[], candidates[] }
}
```

**Fact 结构**（所有事实都是结构化的，不返回裸字符串数组）：

```js
{
  value,          // 事实内容（字符串或对象，如 {fromId,toId,type}）
  operation,      // 'mention' | 'observe' | 'propose'
  confidence,     // 0..1
  entityRef,      // EntityRef | null（解析成功后才有）
  evidence,       // Evidence[]
  reason,         // 人类可读原因
  resolution,     // 'resolved' | 'candidate' | 'unresolved'（角色事实）
  matchedBy,      // 'exact' | 'alias' | 'normalized' | ...（角色事实）
  occurrences     // 在正文中的出现次数
}
```

**硬约束（有测试保证）**：`analyzeChapter()` 是**只读**的 —— 测试 38 断言调用前后 `StoryStore.hash(snapshot())` 完全相同。

章节不存在时返回 `null`（不抛错、不写状态）。

---

## 2. sourceHash

```js
sourceHash = StoryStore.hash(章节原文)
```

- 同一章节、同一内容 → **必须一致**（测试 36；同时 `analysisId` 也一致）
- 正文修改后 → **必须变化**（测试 37；`analysisId` 同时变化）
- `sourceHash` 会进入 ChangeSet（`cs.sourceHash`）并参与 ChangeSet 身份派生，因此"同一章节 + 同一正文"的重复 proposal 会被识别为同一个 ChangeSet（测试 52）
- `analyzedAt` / `timestamp` **不参与** id 计算，也不用于语义去重

---

## 3. Evidence

沿用 Phase 5.1 的契约：

```js
{ sourceType, sourceId, start, end, excerpt }
```

Phase 5.2 让 Evidence **真正绑定到章节正文**：

- `start` / `end` 是正文中的真实字符区间；
- `excerpt` **必须**等于 `sourceText.slice(start, end)`，由程序从原文切片产生，不允许编造；
- 同一个实体可以在多处出现 → 返回**多条** Evidence（测试 42）；
- `StoryContract.validateEvidence(evidence, sourceText)` 校验单条；`validateEvidenceList(list, sourceText)` 校验一组；
- 非法 Evidence 会被拒绝（测试 41 覆盖：伪造 excerpt、end 越界、空 sourceId、start>=end）。

示例（测试 39/40 使用的真实断言）：

```text
正文：林默推开石门，发现里面站着一个白衣女子。
Evidence：{ sourceType:'chapter', sourceId:'chapter_001', start:0, end:2, excerpt:'林默' }
```

---

## 4. Entity Resolution

```js
StoryEngine.resolveEntity(name, { evidence }) -> {
  status: 'resolved' | 'candidate' | 'unresolved',
  entityRef, candidates, confidence, evidence, matchedBy, normalizedName
}
```

严格按顺序匹配（全部确定性，无随机）：

| 顺序 | 规则 | matchedBy | confidence |
| --- | --- | --- | --- |
| 1 | 角色名完全相同 | `exact` | 1.0 |
| 2 | `character.aliases` / `character.fields.aliases` 命中 | `alias` | 0.95 |
| 3 | 称谓归一化后再精确/别名匹配 | `normalized` / `normalized-alias` | 0.8 / 0.75 |
| 4 | 名称互相包含（长度 ≥2）→ **多候选** | `candidate` | 0.4 |
| 5 | 无可靠匹配 | — | `unresolved`，confidence 0 |

称谓归一化（`normalizeCharacterName`）只剥离**后缀**称谓：道友 / 师兄 / 师姐 / 师弟 / 师妹 / 前辈 / 大人 / 公子 /
小姐 / 先生 / 姑娘 / 长老 / 掌门 / 阁下 / 夫人 / 将军 / 陛下 / 殿下 / 师父 / 师尊。
**约束**：剥离后剩余长度必须 ≥2，绝不把真实姓名削成空或单字（`normalizeCharacterName('林') === '林'`，测试 45）。

安全规则：

- **candidate 不自动选择**（测试 46：两个候选时 `entityRef === null`）；
- **unresolved 不自动创建角色**（测试 47）；低置信度新角色不允许自动执行，必须人工批准（测试 48）。

---

## 5. ChapterAnalysisDiff

```js
StoryEngine.diffAnalysis(before, after) -> { chapterId, changes: [ ... ] }
```

支持的类型：

| 类别 | 类型 |
| --- | --- |
| 实体（角色 / 地点） | `entity_added` / `entity_removed` / `entity_updated` |
| 关系 | `relation_added` / `relation_removed` / `relation_updated` |
| 事件 | `event_added` / `event_removed` / `event_updated` |
| 伏笔 | `foreshadowing_added` / `foreshadowing_removed` / `foreshadowing_updated` |
| 时间线 | `timeline_added` / `timeline_removed` / `timeline_updated` |
| 情绪 | `emotion_changed` |

每条 change：

```js
{ type, chapterId, entityRef, evidence, before, after }   // 另含 key / reason
```

性质（测试 55–61）：

- **可重复计算**：同输入 → 同输出（事实按名称/值对齐，输出按 `type|key` 排序）；
- **不修改状态**：纯函数；
- 事实按 **名称** 对齐，因此"同一名字从 unresolved 变成 resolved"会被报告为 `entity_updated`
  （而不是错误的 remove+add），这对"角色解析升级"很重要；
- 可转换为 StateChange：`StoryEngine.analysisDiffToStateChanges(diff, analysis)`。

---

## 6. StateChange

沿用 Phase 5.1 契约，并在 Phase 5.2 增加策略字段（可选、纯数据）：

```js
{
  changeId, actionId, type, target, path, before, after, reason, evidence, timestamp,
  confidence,       // Phase 5.2：策略判定依据
  requiresApproval, // Phase 5.2：策略结论
  policyReason      // Phase 5.2：策略原因
}
```

章节分析的产物按语义映射到状态路径：

| 分析结果 | 目标路径 | 说明 |
| --- | --- | --- |
| 全部文本级事实（人物/地点/事件/情绪/时间提示） | `chapters.<id>.aiAnalysis` | 章节级持久化（单个 update 变更） |
| 已解析角色的出场统计 | `characters.<id>.presence` | 幂等（仅当章节更"新"才累加） |
| 出场统计映射 | `narrative_state.characterPresence` | Phase 5.2 新增支持的单例路径 |
| 新角色 | `characters.<newId>`（add） | 需人工批准；低置信度直接不允许 |
| 伏笔标记 | `foreshadowing.<newId>`（add） | 必须携带 Evidence |
| 同章共现关系 | `relationships.<newId>`（add） | 需人工批准 |
| 时间提示 | `timeline.<newId>`（add） | 需人工批准 |

---

## 7. ChangeSet

```js
StoryEngine.proposeChapterChanges(chapterId [, options]) -> ChangeSet | null
```

**双签名**（Phase 5.1 的旧签名继续可用，测试 32/33 未改动）：

```js
StoryEngine.proposeChapterChanges(chapterId, options)          // Phase 5.2 形式
StoryEngine.proposeChapterChanges(content, chapterIdx, options) // Phase 5.1 形式（保留）
```

返回：

```js
{
  changeSetId,      // 'cs_' + hash({source, operation, scope:{chapterId,sourceHash}, shape})
  chapterId,        // Phase 5.2：章节绑定
  sourceHash,       // Phase 5.2：正文版本绑定
  source,           // 'StoryEngine.proposeChapterChanges'
  operation,        // 'analyze_chapter'
  reason,
  evidence,         // Evidence[]（章节级证据）
  policy,           // { allowed, requiresApproval, reason }
  analysis,         // ChapterAnalysis 句柄（便于审计，非持久化契约字段）
  diff,             // ChapterAnalysisDiff 句柄
  changes,          // StateChange[]
  createdAt, status: 'PROPOSED', baseStateHash,
  approval, errors, warnings    // warnings 里记录被丢弃的 no-op / 策略拦截项
}
```

**硬约束（有测试保证）**：

- `proposeChapterChanges()` **不写 StoryState**（测试 50），也不写审计账本；
- 章节不存在 → 返回 `null`（测试 69）；
- 同一 chapter + sourceHash 重复 proposal → **同一个 changeSetId**（测试 52，幂等）；
- `baseStateHash` 等于当前状态哈希（测试 51）；
- 非法 proposal 被拒绝且状态不变（测试 54、69）。

---

## 8. Policy

```js
StoryPolicy.evaluateChangeDraft(change)   -> { allowed, requiresApproval, reason }
StoryPolicy.evaluateChangeSet(changeSet)  -> { allowed, requiresApproval, reason }
```

Policy **只做判定，不写业务状态**（纯函数）。最低规则集：

| 规则 | 结论 |
| --- | --- |
| 新建**低置信度**角色（confidence < 0.5 或缺失） | `allowed:false`（不允许自动执行） |
| 新建高置信度角色 | `allowed:true`，`requiresApproval:true` |
| 修改角色核心身份（name / charType / gender / age） | `requiresApproval:true` |
| 删除实体（任意 remove） | `requiresApproval:true` |
| 修改时间线 | `requiresApproval:true`（需校验与批准） |
| 修改世界观规则（`world.rules*`） | `requiresApproval:true` |
| 修改伏笔 | **必须携带合法 Evidence**，否则 `allowed:false`；合法则 `requiresApproval:true` |
| 关系变更 | `requiresApproval:true` |

被 `allowed:false` 拦截的变更**不会进入 ChangeSet**，而是记录在 `cs.warnings` 中（`dropped: <path> (原因)`），
因此"低置信度不自动创建"是可审计的、而不是静默丢弃。

---

## 9. ExecutionLayer

写入路径保持 Phase 5.1 的受控链路，Phase 5.2 未新增数据层：

```text
AIRuntime.applyChangeSet(cs)
  -> ChangeSetRuntime.apply(cs)            // 五道门禁 + 原子性 + verify + 审计
     -> AIExecutionLayerBridge.applyChangeSet(cs)
        -> AIRuntime.ExecutionLayer.applyChangeSet(cs)
           -> StoryStore.applyChange(change)     // 受控写入口（集合实体 + narrative_state 单例）
              -> StoryState
```

`StoryStore.applyChange` 在 Phase 5.2 扩展了**单例路径**支持（`narrative_state.<field>`，仅 update），
以便出场统计映射也能通过 ChangeSet 写入，而不是绕过它。

`StoryStore.valueAtPathIn(state, path)` 是 Phase 5.2 新增的**纯读取**路径解析器：verify 与前置条件检查都使用它，
保证"提案时看到的 before"与"验证时看到的 before/after"来自同一个（规范化）视图。

---

## 10. syncFromChapter compatibility adapter

```js
StoryEngine.syncFromChapter(content, chapterIdx)
```

Phase 4 的旧 API **保留未删除**，但已改造为适配器：

```text
syncFromChapter()
  -> _analyzeText()            // 解析（确定性）
  -> _proposeFromAnalysis()    // ChangeSet(PROPOSED)，仅包含 legacy 等价写集
  -> ChangeSetRuntime.validate()
  -> ChangeSetRuntime.approve('compat:syncFromChapter')
  -> ChangeSetRuntime.apply()
  -> verify（失败则回滚，FAILED）
  -> StoryStore.setLastParseResult()   // ← 唯一仍非 ChangeSet 的写入（解析缓存）
```

代码中以 `// ===== COMPATIBILITY LEGACY PATH =====` 明确标记，**不伪装为完全迁移**。

迁移状态逐项报告：

| 项 | 状态 |
| --- | --- |
| `chapters.<id>.aiAnalysis` | **MIGRATED**（经 ChangeSet） |
| character appearance（`characters.<id>.presence`） | **MIGRATED**（经 ChangeSet，幂等） |
| `narrative_state.characterPresence` | **MIGRATED**（经 ChangeSet 单例路径） |
| `_lastParseResult` | **COMPATIBILITY LEGACY PATH**（解析缓存，经 `StoryStore.setLastParseResult`） |
| timeline | 旧路径**不写**；仅作为 proposal（需批准）→ 经 ChangeSet |
| foreshadowing | 同上 |
| relationships | 同上 |
| Phase 4 的 16 个 Runtime Action | **COMPATIBILITY LEGACY PATH**：仍由 `AIExecutionLayer._applyDecision` 直接改状态（Phase 5.3 范围） |

---

## 11. Idempotency

- **分析幂等**：同章节同正文 → 同 `sourceHash` / 同 `analysisId` / 同语义结果；不重复创建角色/事件/伏笔/关系
  （`analyzeChapter` 只读，重复调用不改变状态，测试 38 / 52）；
- **ChangeSet 幂等**：`changeSetId` 由 `source + operation + chapterId + sourceHash + changes 形状` 派生，
  因此重复 proposal 得到同一 id（测试 52），重复 apply 被审计账本拦为 `duplicate_changeset`（测试 29 / 68）；
- **出场统计幂等**：`presence` 只在 `lastAppear < chapterOrder` 时累加（测试 62：连续两次 `syncFromChapter` 计数相同）；
- **no-op 过滤**：`before` 与 `after` 深度相等（除 add/remove）的变更会被丢弃并记入 `cs.warnings`，
  避免"空操作"触发 verify 失败；
- **不使用时间戳做语义去重**。

---

## 12. Rollback

Phase 5.1 的原子性语义在 Phase 5.2 覆盖到章节链路（测试 67）：

1. `apply()` 先取 `snapshot()` 作为回滚点；
2. 任一条写入失败（例如 entity id 冲突）→ `rollback(before)` + `status = FAILED`；
3. `verify()` 失败 → 同样回滚 + FAILED；
4. 回滚后**不写审计账本**，状态与失败前一致。

重要语义（已知且有意为之）：`snapshot()` / `rollback()` 工作在**规范化视图**上，
因此"回滚后状态"等于"回滚点的规范化形态"。断言状态未变时应使用 `StoryStore.hash(StoryStore.snapshot())`
（Phase 5.2 的测试统一采用这一口径）。

---

## 13. 当前仍是确定性解析

- 解析器：Phase 4 的关键词/正则/词频逻辑（`parseText` / `_detectNewNames`），不调用任何模型；
- 实体解析：exact → alias → normalized → candidate → unresolved，全部确定性、可复现；
- 依赖 `Math.random()` 的只有 Phase 4 遗留的 `uid()`（用于 `addChapter` / `addCharacter` 等旧 API），
  Phase 5.2 的所有身份（`analysisId` / `changeSetId` / `changeId`）均由内容哈希派生；
- **因此本阶段的"分析质量"上限就是关键词解析的上限**：它不理解为语义、不做指代消解、不跨章节推理。

---

## 14. 当前没有真实 LLM

- 无任何网络调用（无 `fetch` / XHR / WebSocket / SSE）；
- 无 Provider 实现、无 Mock Provider、无模型/密钥设置页；
- `AI Provider` 仍然只是一个**边界**：任何未来由模型产出的建议，都必须表述为 `ChangeSet`，
  并经过 validate → approve → apply → verify，留下审计记录，才能改变状态；
- 本阶段**没有**接入 DeepSeek / OpenAI / Kimi / Ollama，**没有**语义 NLP，**没有**跨章节理解。

---

## 15. 下一阶段为什么应该做 Runtime Action migration / Provider contract

**Runtime Action migration（建议优先）**

- 目前仍有一条绕过 ChangeSet 的写入路径：`AIExecutionLayer.execute/_applyDecision` 直接修改 StoryState
  （16 个 Action 全部属于 `COMPATIBILITY LEGACY PATH`），这会带来三个已被 Phase 5.1/5.2 证明过的后果：
  1. `verify()` 无法覆盖它（Phase 5.1 实测 `executedCount` 虚高而状态零变化）；
  2. 前置条件 / stale 检测对它无效；
  3. 审计账本记录不到它。
- 章节分析链路已经证明"把写入收口到 ChangeSet"是可行的（含单例路径与对象路径的 verify 支持），
  现在把 Action 逐个迁移进同一套链路，是最低风险、收益最直接的下一步。

**Provider contract（其后）**

- 只有在写入可控、可验证、可审计之后，引入模型才是安全的：模型的输出天然不确定，
  必须被约束成 `ChangeSet` 并接受前置条件 (`before`)、过期检测 (`baseStateHash`) 与事后核验 (`structuredDiff`)；
- 接入点已在 Phase 5.1 文档中划定：入口 `_analyzeText`（结构化抽取）、出口 `ChangeSetRuntime.propose`（候选动作）、
  写入永远只经 `AIRuntime.applyChangeSet`；
- 在此之前接入模型，只会放大当前"绕过 ChangeSet 的写入路径"带来的不可控性。

---

## 附：本阶段新增/变更的 API 一览

| API | 类型 | 说明 |
| --- | --- | --- |
| `StoryEngine.analyzeChapter(chapterId, options)` | 新增 | ChapterAnalysis（只读） |
| `StoryEngine.resolveEntity(name, {evidence})` | 新增 | 确定性实体解析 |
| `StoryEngine.diffAnalysis(before, after)` | 新增 | ChapterAnalysisDiff |
| `StoryEngine.analysisDiffToStateChanges(diff, analysis)` | 新增 | Diff → StateChange |
| `StoryEngine.proposeChapterChanges(chapterId [, options])` | 扩展 | 双签名，产出章节 ChangeSet |
| `StoryEngine.syncFromChapter(content, idx)` | 改造 | 兼容适配器（COMPATIBILITY LEGACY PATH） |
| `normalizeCharacterName(name)` | 新增 | 称谓归一化（安全，不削减真实姓名） |
| `StoryPolicy.evaluateChangeDraft / evaluateChangeSet / evaluate` | 新增 | 纯策略判定 |
| `StoryContract.makeAnalysisId` | 新增 | 确定性 analysisId |
| `StoryContract.validateEvidence / validateEvidenceList` | 新增 | Evidence 绑定真实正文的校验 |
| `StoryStore.valueAtPathIn(state, path)` | 新增 | 纯路径读取（verify/前置条件共用视图） |
| `StoryStore.applyChange` | 扩展 | 支持 `narrative_state.<field>` 单例路径 |
| `ChangeSet`（contract） | 扩展 | `chapterId` / `sourceHash` / `reason` / `evidence` / `policy` / `analysis` |
| `StateChange`（contract） | 扩展 | `confidence` / `requiresApproval` / `policyReason` |
| `hashString` | 修复 | Phase 5.1 遗留：`structuredDiff` 比较键集不对称对象时会抛错 |
