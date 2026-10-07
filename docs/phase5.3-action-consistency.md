# Phase 5.3 — Runtime Action Migration & Explainable Consistency

> 版本：`APP_VERSION 0.2.0` / `STORY_STATE_VERSION phase4` / `SCHEMA_VERSION 2` / `CONTRACT_VERSION 5.1`
> 测试：`node tests/regression-tests.js` → **104/104 PASS**（Phase 4 / 5.1 / 5.2 的 69 项全部保留 + 本阶段新增 35 项）

**本阶段没有接入任何真实 LLM。** 不存在 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / SSE，
不存在 OpenAI / DeepSeek / Kimi / Ollama / Anthropic Provider、API Key、流式输出、RAG、向量库、多 Agent。
所有规则判定都是**确定性的**：同一 StoryState 必然得到同一 Issues 与同一评分。

本阶段解决两件事：

1. **把 Phase 4 遗留的 Runtime Action 全部收口到 ChangeSet 链路**（不再有任何 Action 直写 StoryState）；
2. **让一致性检查真正可运行、可解释**（Consistency 页面不再崩溃，规则真正触发，Issue 带证据，评分确定性）。

---

## 1. Action migration

### 迁移前后的写入路径

```text
Phase 4（已删除的旁路）:
  AIRuntime.run() -> AIDecisionLayer.evaluate() -> AIExecutionLayer.execute()
    -> _applyDecision() -> StoryStore.state.<直接赋值> -> 状态被就地修改

Phase 5.3（当前唯一路径）:
  AIRuntime.run() / approveAction()
    -> AIDecisionLayer.evaluate()            // 只诊断：condition -> validate -> ConsistencyIssue + ActionProposal
    -> ActionMigration.propose(decision)     // ActionProposal -> StateChange[] -> ChangeSet(PROPOSED)
    -> ChangeSetRuntime.validate()           // 契约 / 重复 / stale / before 前置条件
    -> StoryPolicy.evaluateChangeSet()       // 策略（低置信度、核心身份、删除、伏笔证据…）
    -> ChangeSetRuntime.approve(approver)    // 显式批准（记录批准人）
    -> ChangeSetRuntime.apply()              // 原子写入 + verify + 审计账本
    -> AIExecutionLayer.applyChangeSet()     // 受控写入口
    -> StoryStore.applyChange() -> StoryState
```

**唯一写入口**：`StoryStore.applyChange()`（经 `AIExecutionLayer`）。`AIExecutionLayer._applyDecision()` 保留
API 名但**永不修改状态**，返回 `{status:'deprecated_no_write'}`。

### Runtime Migration Matrix

| Action / Path | 当前行为 | 是否直接写状态 | 是否进入 ChangeSet | 是否需要 Approval | 是否已 Verify | 目标状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `introduce_conflict` | 新增 `conflicts.<id>`（真实写） | 否 | 是 | 是 | 是 | MIGRATED |
| `resolve_foreshadow` | 更新 `foreshadowing.<id>.status`（真实写，必须带 evidence） | 否 | 是 | 是 | 是 | MIGRATED |
| `create_protagonist` | 新增 `characters.<id>`（真实写） | 否 | 是 | 是 | 是 | MIGRATED |
| `designate_protagonist` | 更新 `characters.<id>.charType`（真实写） | 否 | 是 | 是 | 是 | MIGRATED |
| `introduce_sidekick` | 新增 `characters.<id>`（真实写） | 否 | 是 | 是 | 是 | MIGRATED |
| `bring_protagonist_back` | 只产出 Issue（写作建议，无法由运行时"补写章节"） | 否 | 是（诊断，无变更） | — | 是（零变化语义） | MIGRATED_DIAGNOSIS_ONLY |
| `increase_pace` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_inconsistency` | 只产出 Issue（带 evidence/entityRef） | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_relationship_issue` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_timeline_conflict` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_world_conflict` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_power_conflict` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_unused_character` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_arc_stagnation` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_weak_hook` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |
| `flag_ending_hook` | 只产出 Issue | 否 | 是（诊断） | — | 是 | MIGRATED_DIAGNOSIS_ONLY |

矩阵可由代码自证：`AIRuntime.actionMigrationMatrix()`（测试 99 断言 16 项、5 项真实迁移、11 项诊断、无 legacyPath）。

**为什么 11 项是"诊断类"而不是"真实状态变更"**：这些动作要改变的是**尚未写出的正文内容**（让主角回归、加入突发事件、
补钩子）。运行时无法凭规则凭空生成章节文本；强行写状态就是伪造数据。因此它们的正确迁移形态是
"只产出带证据与建议的 ConsistencyIssue"，并且**不再写 `aiSuggestions`**（旧的 `aiSuggestions.push(...)` 写法已彻底删除）。

---

## 2. ActionProposal

```js
StoryContract.makeActionProposal({
  actionType, reason, evidence, proposedChanges, ruleId, issueId, target, confidence, requiresApproval
}) -> {
  actionId,          // 'ap_' + hash({ruleId, issueId, actionType, target})   确定性、可追踪
  actionType, reason,
  evidence,          // Evidence[]（绑定真实章节正文切片）
  proposedChanges,   // StateChange[]（诊断类为空数组）
  ruleId, issueId, target, confidence, requiresApproval
}
```

Action **不得**直接修改 StoryState：它只能产出 ActionProposal，再由 `ActionMigration.propose()` 转成 StateChange → ChangeSet。

---

## 3. StateChange

沿用 Phase 5.1/5.2 契约（`changeId` / `actionId` / `type` / `target` / `path` / `before` / `after` / `reason` /
`evidence` / `timestamp` / `confidence` / `requiresApproval` / `policyReason`），Action 迁移产生的路径：

| Action | type | path |
| --- | --- | --- |
| `introduce_conflict` | add | `conflicts.<newId>` |
| `resolve_foreshadow` | update | `foreshadowing.<id>.status` |
| `create_protagonist` | add | `characters.<newId>` |
| `designate_protagonist` | update | `characters.<id>.charType` |
| `introduce_sidekick` | add | `characters.<newId>` |

`before` 一律取自**规范化快照**（与 verify 同一视图），因此前置条件（`before` 必须匹配）与 stale 检测可真正生效。

---

## 4. ChangeSet

`ActionMigration.propose(decision, ctx)` 产出 `ChangeSet(PROPOSED)`：

```js
{ changeSetId,            // 'cs_' + hash({source, operation, scope, shape})
  source,                 // 'ActionMigration.<actionType>'（审计可定位到 Action）
  operation: 'runtime_action',
  ruleId, issueId, actionId, actionType,   // 审计链字段（Phase 5.3 新增）
  policy, changes, evidence, baseStateHash, status:'PROPOSED' }
```

生命周期不变：`PROPOSED → VALIDATING → VALID → APPROVED → APPLIED → VERIFIED`，异常 `REJECTED / FAILED`。

---

## 5. Policy

`StoryPolicy.evaluateChangeSet(cs)` / `evaluateChangeDraft(change)`（纯函数，只判定不写入）：

- 低置信度新角色（confidence < 0.5）→ `allowed:false`（不进入 ChangeSet，记录在 `cs.warnings`）；
- 新建角色 / 修改核心身份 / 删除实体 / 时间线 / 世界观规则 / 伏笔 / 关系 → `requiresApproval:true`；
- **伏笔变更必须有合法 Evidence**，否则 `allowed:false`。

`resolve_foreshadow` 的证据由 `ActionMigration.evidenceForForeshadow()` 从"埋设章节"的真实正文切片构造
（优先定位 `[[伏笔:内容]]` 标记，找不到则退化为该章节正文切片），保证 `excerpt === slice`。

---

## 6. Approval

- `ChangeSetRuntime.approve(cs, approver)` 是**唯一**的放行入口，批准人写入审计账本；
- `approveAction(planId)`（UI）→ `AIRuntime.applyPlan(plan)` → `ActionPlanSystem.executeWithApproval([plan],[planId])`；
  没有批准 id 就**不会**有任何写入（测试 86）；
- `rejectAction(planId)`（UI）→ `AIRuntime.rejectPlan(plan, reason)` → 写入
  `narrative_state.actionDecisions`（`decision:'rejected'`，含 planId/ruleId/issueId/action/time），
  并且**不从内存数组删除计划**，而是保留为 `status:'rejected'` 并渲染为"已拒绝"（测试 91/103）；
- 兼容 API（`syncFromChapter` / `run()` / `executeWithApproval`）内部使用**具名系统批准人**
  （`compat:syncFromChapter` / `compat:runtime.execute`），批准同样记账，**不存在无批准写入**。

---

## 7. Execution

```js
AIExecutionLayer.applyChangeSet(changeSet) -> [{path, changeType, ok, errors}]
```

`apply()` 的原子流程：取 `snapshot()` → 逐条 `applyChange()` → 任一条失败即 `rollback()` + `FAILED` →
成功后 `verify()`（失败同样回滚）→ 写审计账本。全部写入都经过 `StoryStore.applyChange()`（集合实体 + `narrative_state` 单例）。

---

## 8. Verify

Phase 4 的 verify 只统计"没被 skip 的 action"，无法回答"状态到底有没有变"。Phase 5.3 重定义：

```js
ActionPlanSystem.verify(before, after, results, changeSets) -> {
  success,          // 无 failed/invalid/refused
  hasChanges,       // structuredDiff(before, after).changes.length > 0
  changeCount,      // 真实字段级变化数
  changes,          // [{path, changeType, before, after}]  哪些字段变了
  executedCount,    // 真正产生了可观测变化的 action 数（不是"没被 skip"）
  skippedCount,     // no_change / skipped / skipped_idempotent
  failedCount,
  stateHashBefore, stateHashAfter,
  changeSetIds,
  verifiedAt
}
```

`executedCount` 的判定：某个 `status:'applied'` 的 action，其 ChangeSet 的变更路径必须出现在
`structuredDiff` 的观测结果中（含子路径）——**零变化的动作不算 executed**（测试 88/89/102）。

---

## 9. ConsistencyIssue

```js
StoryContract.makeConsistencyIssue(fields) -> {
  issueId,             // 'ci_' + hash({ruleId, entity, location, facts})  稳定可追踪
  ruleId,              // 必来自 RuleRegistry
  severity,            // 'blocking' | 'error' | 'warning' | 'info'（由 rule.priority 统一映射）
  category,            // character / plot / foreshadowing / pacing / consistency / timeline / world
  title, message,
  entityRef,           // EntityRef | null（可以为空）
  evidence,            // Evidence[]（可多条，绑定真实正文切片）
  location,            // {chapterId, chapterIndex, path}  能定位章节/实体
  facts,               // 规则实际依赖的事实（评分、境界、重复数…）
  suggestedFix,        // 只解释，不执行
  suggestedChangeSet,  // 只作为候选动作（PROPOSED），绝不在此处落库
  createdAt
}
```

校验：`StoryContract.validateConsistencyIssue(issue)`（13 字段 + 拒绝可执行值）。契约与验证见测试 77。

---

## 10. RuleRegistry

Rule Contract（保留 `id/priority/enabled/condition/action/validate` 以兼容旧调用）：

```js
{ ruleId, name, description, priority, category, enabled, condition(ctx), action(ctx), validate(ctx, decision), evaluate(ctx) }
```

- `evaluate(ctx)` 的语义是 **Observe / Diagnose**：`condition → validate → decision`，**永不修改 StoryState**；
- `AIRuntime.ruleContracts()` 暴露 16 条规则的契约（测试 96）；
- `AIRuntime.ruleValidateCallCount()` 暴露 validate 调用计数（测试 71 证明 validate 真的被调用）。

### 修复的"结构性死亡规则"（Phase 4 遗留）

| 规则 | 死亡原因 | 修复 |
| --- | --- | --- |
| `world_rule_conflict` | `ctx.storyState.world` 从未注入 | `buildAIContext` 注入 `world.{setting,locations,factions,rules}`；规则检测**规则重复 / 作用域引用了不存在的地点**（测试 72） |
| `character_inconsistency` | `characters[].aiProfile` 未注入，且 `consistencyScore` 恒为 100 | 注入 `aiProfile/aliases`；并新增**确定性角色洞察**（未出场 -40、悬空关系 -15/条、重名 -20）取代硬编码分数（测试 73） |
| `arc_stagnation` | 依赖永远 `undefined` 的叙事状态 | 新增 `analysis.arc`（章节数、主角出现次数、arcStage/goal/weakness 是否存在）；≥5 章且无弧光标记且出现≥2 次才报（测试 74） |
| `power_level_conflict` | `return false` 硬编码 | 新增**确定性境界阶梯** `炼气<筑基<…<仙人` 与"每 10 章允许提升 1 境"的上限映射；能力越界或配角高出主角 2 境以上才报（测试 75） |

---

## 11. Deterministic score

```js
ConsistencyScore.compute(issues) -> { score, totalIssues, blockingIssues, errors, warnings, infos, penalty, weights }
// baseScore = 100，blocking -15 / error -8 / warning -3 / info -1，clamp 到 [0,100]
```

- **相同 StoryState → 相同 score**（无时间、无随机：时间戳不参与任何判定）；
- 出现真实问题 → 评分可解释下降；问题修复 → 评分可解释恢复；
- **评分不是事实来源，Issues 才是**：页面同时展示 score / totalIssues / blockingIssues / warnings（测试 76/100）；
- 旧代码中 `characters[].aiProfile.consistencyScore` 恒为 100 的假分数**不再参与规则判定**（仅作为角色自身的元数据保留）。

---

## 12. Audit trail

```text
ruleId → issueId → actionId → changeSetId → stateChanges(paths) → execution → verify
```

- `ChangeSetRuntime.apply()` 写入 `narrative_state.changeLedger`，条目含
  `changeSetId / source / operation / chapterId / ruleId / issueId / actionId / actionType / changes[] / status / appliedCount / stateHashBefore / stateHashAfter`；
- `AIRuntime.auditTrail()` 把它整理为可读的审计链（测试 95/97/98）；
- 审批/拒绝另记 `narrative_state.actionDecisions`（planId / ruleId / issueId / actionId / decision / changeSetIds / hasChanges / changeCount / reason / at）；
- 这套链就是 Phase 5.4 真实 LLM 的审计基础：模型输出只能作为提案进入同一条链。

---

## 13. Idempotency

旧的 `_executedHashes` + "章节数+角色数+冲突数+伏笔数" 计数签名已废弃（计数相同但内容不同会被误判为重复；
计数不同但语义相同则重复写入）。现在：

1. **ChangeSet 身份**：`changeSetId` 由 `source + operation + scope + changes 形状` 派生 →
   内容不变时重复 proposal 得到同一 id；审计账本按 `changeSetId` 拒绝重复执行（测试 93）；
2. **语义幂等**：`introduce_conflict` 在已有 `suggested` 冲突时不再提议（旧 `_applyDecision` 的重复保护迁移到此，测试 92）；
   `resolve_foreshadow` 对已 `resolved` 的伏笔不再提议；
3. **前置条件 + stale**：`baseStateHash` 与逐条 `before` 保证"状态变了就不许按旧计划写"（测试 90 的 stale 与失败回滚）；
4. **零变化不计数**：verify 的 `executedCount` 只统计真实产生变化的动作（测试 88/89）。

结果：**内容不变 → 0 duplicate mutation；内容变化 → 允许产生新的合法动作**（测试 94）。

---

## 14. Rollback

- `apply()` 先取规范化快照；任一条写入失败 → `rollback(before)` + `status:'FAILED'`，**不写审计账本**（测试 90）；
- `verify()` 失败同样回滚；
- 回滚语义是"回到回滚点的**规范化形态**"，因此断言状态未变时使用 `StoryStore.hash(StoryStore.snapshot())`；
- 审计写入（`actionDecisions`）本身是有意的状态变化：`applyPlan` 即使"未产生业务变化"也会记账，
  断言"业务状态未变"时应比较业务字段（测试 102）。

---

## 15. Compatibility legacy paths

| 项 | 状态 |
| --- | --- |
| `AIExecutionLayer.execute()` | **MIGRATED**：内部转成 ChangeSet（批准人 `compat:runtime.execute`） |
| `AIRuntime.run(chapterIdx)` | **MIGRATED**：返回 `{analysis, executed, verified, changeSetIds, stateHashAfter}`；`executed[]` 保持旧字段（action/status/priority/detail/target）以兼容 Phase 4 调用 |
| `AIExecutionLayer._applyDecision()` | **API 保留 / 直写移除**：返回 `{status:'deprecated_no_write'}` |
| `ActionPlanSystem.observe()` | **MIGRATED**：章节同步经 `StoryEngine.syncFromChapter` 适配器（内部 ChangeSet） |
| `_lastParseResult`（解析缓存） | **COMPATIBILITY LEGACY PATH**：经 `StoryStore.setLastParseResult()`，非业务状态，已文档化 |
| `narrative_state.aiSuggestions` | **不再被任何 Action 写入**（字段保留以兼容旧数据读取，测试 104） |
| `injectTestState` / `restoreState` | 测试辅助，非生产路径 |

---

## 16. Phase 5.4 Provider boundary

Phase 5.3 不实现 Provider，但接口边界已经就位：

```text
AI Provider（5.4 实现：Mock / OpenAI-compatible / Ollama / DeepSeek / Kimi / 通义 / 智谱）
    ↓  ProviderResult（纯数据：文本 / JSON / 错误 / token 用量）
Structured Proposal           ← 必须表述为 ActionProposal / StateChange（禁止直接改状态）
    ↓
Rule Validation               ← RuleRegistry.validate() 对模型输出同样生效（Phase 5.3 已让 validate 真正生效）
    ↓
ChangeSet                     ← ChangeSetRuntime.propose()（可附加 provider/model/prompt 审计字段）
    ↓
Policy → Approval → Execution → Verify     ← 与规则来源完全相同的链路
```

因此 Phase 5.4 需要新增的只是：`Provider` 接口 + `ProviderResult` 契约 + timeout/retry/错误处理 +
JSON schema 校验 + token 预算 + provider 配置页/streaming。**写入侧无需再改**——这是本阶段最重要的产出。

---

## 附：本阶段新增/变更的 API

| API | 类型 | 说明 |
| --- | --- | --- |
| `ActionMigration.propose/changesFor/matrix/statusFor/evidenceForForeshadow` | 新增 | Action → StateChange → ChangeSet 迁移层 |
| `StoryContract.makeConsistencyIssue / makeActionProposal / validateConsistencyIssue / severityFromPriority` | 新增 | 一致性契约 |
| `ConsistencyScore.compute` | 新增 | 确定性评分 |
| `StoryStore.getActionDecisions / appendActionDecision` | 新增 | 审批/拒绝审计 |
| `AIRuntime.consistencyReport / ruleContracts / ruleValidateCallCount / actionMigrationMatrix / auditTrail / actionDecisions / applyPlan / rejectPlan / evaluateContext` | 新增 | 报告、审计与批准 |
| `ActionPlanSystem.plan/validate/executeWithApproval/verify/runFull` | 重构 | 统一生命周期；plan.id 改为确定性；verify 重定义 |
| `AIExecutionLayer.execute / _applyDecision` | 重构 | 转 ChangeSet；直写移除 |
| `buildAIContext` | 扩展 | 注入 `world`、`aiProfile/aliases`、`analysis.characterInsights/realm/arc` |
| `AIRuleRegistry`（16 条） | 重构 | Rule Contract + `evaluate()`；4 条死规则修复 |
| `runConsistencyCheck / runCopilot / approveAction / rejectAction / applyResultMessage / renderIssueCard / renderPlans` | 重构 | 页面可用 + 真实结果反馈 |
| `toast` | 修复 | 对缺少 `Element.remove` 的环境健壮 |
