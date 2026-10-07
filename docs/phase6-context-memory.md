# Phase 6 — Context, Memory & Long-Context Runtime

> 版本：`APP_VERSION 0.2.0` / `STORY_STATE_VERSION phase4` / `SCHEMA_VERSION 2` / `CONTRACT_VERSION 5.1`
> 测试：`node tests/regression-tests.js` → **192/192 PASS**（Phase 4–5.4 的 147 项全部保留 + 本阶段新增 45 项）
> 真异步套件：`AIRuntime.runAsyncRegressionTests()` → **6/6 PASS**（Promise / 定时器 / 取消 / 退避）
> 合计 **198** 项，全部通过。

Phase 6 不修改写入架构，只新增**读取/组织侧**的能力：

```text
StoryState（唯一事实来源）
   ↓  派生（可丢弃重建）
MemoryIndex ──────────────┐
   ↓                      │
ContextBuilder（4 类任务） │  L0/L1/L2/L3 记忆分层
   ↓                      │
ContextBudgeter（确定性裁剪）
   ↓
ProviderRuntime → Provider → ProviderResult → Schema → Evidence → Proposal → ChangeSet（人工审批）→ Verify
```

**MemoryIndex / ContextBuilder / AuditStore 都不能修改 StoryState**（测试 186/187/188 断言状态哈希不变），
唯一写入路径仍是 `ChangeSetRuntime.apply → AIExecutionLayer → StoryStore.applyChange`。

---

## 1. ContextBuilder

`StoryContextBuilder` 提供四个任务入口，**共享同一个状态投影 `projectState()`**（不复制四套数据逻辑）：

| API | 任务 | 分段与优先级 |
| --- | --- | --- |
| `buildExtractionContext(chapterId, opts)` | `chapter_extraction` | chapter(0) → characters(1) → locations(2) → foreshadowing(3) → worldRules(4) |
| `buildConsistencyContext(chapterId, opts)` | `consistency_check` | chapter(0) → **ruleFacts(1)** → entities(2) → timeline(3) → foreshadowing(4) → relationships(5) → worldRules(6) |
| `buildWritingContext(chapterId, opts)` | `writing_assist` | **P0 硬设定 → P1 当前角色 → P2 未回收伏笔 → P3 当前弧 → P4 最近章节 → P5 更早摘要** |
| `buildCopilotContext(chapterIdx, opts)` | `copilot_analysis` | chapter(0) → characters(1) → foreshadowing(2) → diagnosis(3) → worldRules(4) |
| `build(task, chapterIdOrIdx, opts)` | 统一分发 | 未知任务回落 extraction |

返回值：`{task, chapterId, chapterIdx, sections, allocation, report, prompt:{system,instructions,context,user,promptHash,estimatedTokens}, promptHash}`。

**一致性上下文是规则驱动的**（§六）：`factsForRules(ruleIds, p, chapterIdx)` 按规则选择事实——
`power_level_conflict` 只需"主角能力 + 章节数 + 当前上限"，`arc_stagnation` 只需弧光字段与出现次数，
`character_inconsistency` 只需派生一致性评分……不会把整本小说塞进上下文。

`buildAIContext()` **未被删除**（Phase 5.3 的规则评估仍在使用），Phase 6 只是把"AI 上下文/章节分析"的职责
迁到 `StoryContextBuilder`，两者共享同一状态投影。

---

## 2. ContextBudgeter

```js
ContextBudgeter.estimate(value)          // 字符串/数字/对象 → token 粗估
ContextBudgeter.makeSection(name, priority, text, meta)
ContextBudgeter.allocate(sections, {maxInputTokens, reserveOutputTokens})
ContextBudgeter.trim(sections, budget)   // 按优先级确定性裁剪
ContextBudgeter.report(allocation)       // Context Report
ContextBudgeter.join(allocation)         // 拼接为 prompt 的 context 段
```

裁剪顺序（**绝不随机**）：先按 `priority` 从低到高（同优先级按 `name` 字典序），逐段
① 截断到剩余预算，② 若连 `MIN_SECTION_TOKENS`(20) 都放不下则整段丢弃并记录 `removed`。
`cutToTokens()` 会把截断标记 `…[truncated]` **计入预算**，因此裁剪后不会超预算、也不会误伤高优先级分段
（这是本阶段修掉的一个真实缺陷：标记自身占 token 曾导致超预算并丢弃高优先级分段）。

预算与预留：`effectiveBudget = max(MIN_SECTION_TOKENS, maxInputTokens - reserveOutputTokens)`。

---

## 3. ChapterSummary

```js
{ chapterId, sourceHash, summary, keyFacts, characters, events, unresolved, generatedBy, generatedAt }
```

- **绑定 `chapterId + sourceHash`**：`ChapterSummary.isValid(s)` = `s.sourceHash === hash(章节正文)`；
  正文一改，旧摘要立即失效（测试 157/158）
- **确定性 fallback**：无 LLM 时生成结构化摘录（开头 / 事件 / 结尾 / 未回收伏笔），
  `generatedBy:'deterministic'`，**不虚构文学总结**（测试 156/159）
- **LLM 摘要**：`ChapterSummary.generate(chapterId, {provider, config})` → Provider → JSON →
  `ChapterSummarySchema`（必须有 `summary:string`，≤600 字，数组字段类型校验，拒绝可执行值）→
  通过才写入；非法一律回落确定性摘要（测试 160/161）
- **存储也走 ChangeSet**：`ChapterSummary.store()` 提案 `narrative_state.chapterSummaries.<chapterId>`
  （`origin:'derived'`，批准人 `derived:chapter-summary`），账本可查（测试 190）
- 摘要属于**派生数据**，只能写入 `narrative_state.chapterSummaries`，绝不修改正文与故事事实

---

## 4. Volume / Arc Summary

没有引入复杂"卷系统"，采用 **chapter groups**（默认 5 章一组）：

```js
VolumeSummary.GROUP_SIZE = 5
VolumeSummary.keyFor(groupIndex) -> 'volume_1' | 'volume_2' ...
VolumeSummary.build(groupIndex, {store:true})   // 优先用有效章节摘要，缺失则用正文开头
VolumeSummary.buildAll({store:true})
```

存储在 `narrative_state.volumeSummaries`，同样经 ChangeSet（测试 191：7 章 → 2 组 = 5 + 2）。

---

## 5. Memory Levels

| 层 | 内容 | 来源 |
| --- | --- | --- |
| **L0** | 当前章节 | `chapters[idx]` |
| **L1** | 最近 2–3 章（默认 3） | `chapters[idx-3..idx-1]` |
| **L2** | 长期事实：角色 / 地点 / 关系 / 事件 / 伏笔 / 时间线 | MemoryIndex 索引项 |
| **L3** | 历史摘要：章节摘要 / 卷摘要 | `narrative_state.*Summaries` |

`MemoryIndex.levels(chapterIdx, {recent})` 返回四层条目 + 每层 `{items, estimatedTokens}`（测试 162–165）。

---

## 6. MemoryIndex

```js
MemoryIndex.rebuild() / ensure() / invalidate() / stats() / counts()
MemoryIndex.search(query, options)
MemoryIndex.levels(chapterIdx, options)
```

- **派生索引，可丢弃重建**：`StoryState → rebuild → MemoryIndex`，`MemoryIndex ≠ StoryState`（测试 166/186）
- 缓存失效用 `StoryStore.getRevision()`（每次 `persist()` 自增）+ 廉价签名（各集合长度与正文字符数），
  避免"每次按键 → 全量 JSON.stringify + 全量重建"（§三十）
- 索引结构：`byKey{type:id→item}`、倒排 `postings{bigram→[type:id]}`、`aliasToCharacter{归一化别名→id}`、
  `chapters/characters/locations/events/foreshadowing/timeline` 分类映射

---

## 7. Retrieval

`MemoryIndex.search(query, options)` → `{query, total, items:[{type,id,score,source,excerpt,chapterId,chapterIndex,reasons}]}`

混合检索（**不引入向量数据库**）：① 实体引用（`resolveEntity` 命中 → +10）② exact（+8）
③ substring（+5）④ bigram/关键词（每命中 +1）。中文使用 bigram + 简单 token 归一化（含标点剥离、小写化）。

**排序完全确定**：`score` 降序 → `type` 字典序 → `id` 字典序；相同 StoryState + 相同 query → 完全相同的顺序（测试 167/168）。
支持 `{types, minScore, limit}`（默认 20）。

---

## 8. Entity Memory

- `aliasToCharacter` 收集 `name + aliases + fields.aliases` 的归一化形式
- 检索 `林师兄` 通过 Phase 5.2 的 `resolveEntity`（exact → alias → normalized → candidate → unresolved）
  命中 `character:char_001` 并获得实体引用加权（测试 169）
- **低置信度仍是 candidate，不自动合并**：`resolveEntity` 的 candidate 分支不受本阶段影响（Phase 5.2 测试 46 仍通过）

---

## 9. Existing Entity Update

`LLMProposalBridge.toEntityUpdates()` 支持**既有实体最小差异更新**（§十九）：

| 目标 | 允许字段 | 约束 |
| --- | --- | --- |
| 角色 | `fields.personality` / `fields.ability` / `fields.goal` | 仅当模型显式断言、且与原值不同、且带**可验证 Evidence** |
| 关系 | 已存在同 pair 的 `type` | 与现值相同则不产生变更；新 pair 才 add |

- **`before` 一律由系统从规范化快照生成**，模型只能给 `after`（测试 170）
- **最小变更原则**：值相同 → 不产生任何变更（测试 171）；缺证据 → 记入 `rejectedFacts`（测试 173）
- 篡改 `before` → 前置条件校验失败、状态不变（测试 172）
- 任一条写入失败 → 原子回滚（测试 174）
- 不允许模型整体覆盖角色对象（只允许白名单字段）

---

## 10. AI Audit Store

```js
AIAuditStore.record(entry) / list({limit}) / get(auditId) / last() / count() / clear() / linkChangeSet(auditId, changeSetId)
```

- 独立本机存储键 `novelcraft_ai_audit_v1`（**不是** `novelcraft_unified_v1`），上限 100 条 FIFO
- 记录：`auditId / requestId / provider / model / promptHash / usage / latencyMs / rawResponse / structured / error / task / chapterId / timestamp / changeSetId`
- `sanitize()` 深度剥离敏感键（`apikey` / `api_key` / `authorization` / `token` / `password` / `secret` / `bearer`），
  超长字符串截断、函数丢弃（测试 184）
- **StoryState = 小说事实；AI Audit Store = AI 操作历史**，两者严格分离；ChangeSet 通过 `auditId` 回链审计（测试 183）
- 支持 `clear()`（UI 有"清除审计"按钮）

---

## 11. Provider cancellation

- `ProviderErrors.CANCELLED`（不可重试）；`classifyTransportThrow` 识别 `AbortError` / `abort` / `cancel`
- `ProviderCancellation.begin/abort/end/isAborted` + `createAbortController()`
- 请求前检查 `signal.aborted` → 立即返回 `CANCELLED`；`signal` 进入 transport init
- MockProvider 同样尊重 `signal.aborted`（同步测试可覆盖）
- 取消不产生任何状态变更（测试 176/179；异步 A2）

---

## 12. Retry

- 仅对 `retryable` 错误（TIMEOUT / NETWORK_ERROR / RATE_LIMIT / PROVIDER_ERROR）重试，次数 = `maxRetries + 1`
- **指数退避**：`retryDelayFor(i)` = `min(maxRetryDelayMs, retryDelayMs × retryFactor^i)`，
  默认 500 / 1000 / 2000 / 4000，上限 8000（测试 177/178）
- **仅异步路径真实等待**（`waitBeforeRetry` + 定时器 / 可注入 `options.sleep`）；
  同步 transport 只记录 `retryDelays`，绝不引入 Promise（保持 ES5 同步调用方与同步测试可用）
- 退避与重试都不会重复写 StoryState（Provider 无写权限）

---

## 13. Streaming

```js
LLMChapterAnalysis.runStream(chapterId, options, onChunk)
LLMStreamState = {active, buffer, chunks, task, chapterId, startedAt, finishedAt, aborted, error}
```

流程：`stream → buffer → 完整 ProviderResult → Schema Validate → Evidence 重验证 → Proposal`。
流式途中**绝不写 StoryState**（测试 180 断言状态哈希不变；异步 A5 用真 Promise 流验证）。
UI 在 Copilot 面板显示滚动缓冲（`#llmStreamBuffer`），不做复杂流式渲染。

---

## 14. Token Budget

- 预算来源：设置页 `maxInputTokens` / `maxOutputTokens`；请求级 `maxTokens`；`ContextBudgeter` 另接受 `reserveOutputTokens`
- `estimateTokens` 仍是 `ceil(len/2)` 粗估（**不实现复杂 tokenizer**）；超预算在**发请求前**返回 `BUDGET_EXCEEDED`
- Context 层超预算 → 确定性裁剪（§2），并在 Context Report 中记录 `truncated` / `removed`
- 精细 tokenizer 与上下文摘要压缩留待后续阶段

---

## 15. Offline fallback

`LLM disabled` 时，以下能力**全部可用**（测试 159/161/189 + Phase 5.4 测试 129/130/131）：

```text
ContextBuilder（四类上下文）· ContextBudgeter · MemoryIndex（含检索与 L0-L3）
确定性解析器（Phase 4 keyword/regex）· Consistency（Phase 5.3 规则与评分）
确定性章节摘要 · ChangeSet / Policy / Approval / Verify
```

Provider 失败 / schema 非法 / 摘要非法 → 一律降级为确定性路径，且**状态不变**。
Story OS 的任何功能都不以 LLM 为前提。

---

## 16. StoryState boundary

| 组件 | 能否修改 StoryState | 说明 |
| --- | --- | --- |
| `ContextBuilder` | **否** | 只读投影（测试 187） |
| `MemoryIndex` | **否** | 派生索引，可丢弃重建（测试 186） |
| `AIAuditStore` | **否** | 独立本机存储（测试 188） |
| `ProviderRuntime` / Provider | **否** | 只返回 ProviderResult（Phase 5.4 测试 116/117/140） |
| `ChapterSummary` / `VolumeSummary` | 仅经 **ChangeSet** | `origin:'derived'`，写入 `narrative_state.*Summaries`（测试 190） |
| 唯一业务写入口 | `ChangeSetRuntime.apply → AIExecutionLayer → StoryStore.applyChange` | 需 validate → policy → approve（LLM 提案必须人工批准） |

新增的 `narrative_state.chapterSummaries` / `volumeSummaries` 由 `normalize()` 保留、`createEmptyState` 初始化；
`StoryStore.applyChange` 新增 `narrative_state.<map>.<id>` 嵌套路径支持（add/update/remove 语义与集合实体一致）。

---

## 附：本阶段新增/变更的 API

| API | 说明 |
| --- | --- |
| `MemoryIndex.rebuild/ensure/invalidate/stats/counts/search/levels` | 派生索引 + 混合检索 + 记忆分层 |
| `normalizeToken` / `bigramsOf` | 中文 bigram 与 token 归一化 |
| `ChapterSummary.deterministic/generate/store/get/list/isValid` + `ChapterSummarySchema` | 章节摘要 |
| `VolumeSummary.build/buildAll/keyFor/groupOf/all` | 章节分组摘要 |
| `ContextBudgeter.estimate/makeSection/allocate/trim/report/join/cutToTokens` | 预算与确定性裁剪 |
| `StoryContextBuilder.projectState/buildExtractionContext/buildConsistencyContext/buildWritingContext/buildCopilotContext/buildPrompt/factsForRules` | 四类任务上下文 |
| `AIAuditStore.record/list/get/last/count/clear/linkChangeSet/sanitize/assertNoSecret` | AI 审计存储 |
| `ProviderCancellation.begin/abort/end/isAborted`、`createAbortController`、`retryDelayFor`、`waitBeforeRetry` | 取消与退避 |
| `ProviderErrors.CANCELLED` | 取消错误码 |
| `LLMChapterAnalysis.runStream` + `LLMStreamState` | 流式分析（缓冲组装） |
| `LLMProposalBridge.toEntityUpdates` | 既有实体最小差异更新 |
| 角色抽取 schema 新增可选 `fields.{personality,ability,goal}` | 既有实体更新输入 |
| UI：`contextInspectorHTML` / `memoryInspectorHTML` / `auditInspectorHTML` / `inspectorsHTML` / `rebuildMemoryIndex` / `generateSummaries` / `runStreamingAnalysis` / `clearAuditLog` | Context / Memory / AI Audit 检查器 |
| `StoryStore.getRevision/touch` | 索引缓存失效（避免全量重建） |
| `StoryStore.applyChange` | 支持 `narrative_state.<map>.<id>` |
| `AIRuntime.runAsyncRegressionTests()` | 真异步回归套件（6 项） |
