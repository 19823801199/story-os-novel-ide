# Changelog

CHANGELOG

## v0.2.0 - Phase 5.4 (AI Provider Contract & Safe LLM Integration)

> 本阶段是第一个真实 LLM 可以进入系统的阶段。核心写入架构未改动：模型只能产生结构化建议。

### Added

- `ProviderErrors` / `makeProviderError`：10 类可识别错误（CONFIG / AUTH / NETWORK / TIMEOUT / RATE_LIMIT / INVALID_RESPONSE / SCHEMA / PROVIDER / BUDGET_EXCEEDED / UNKNOWN）+ `retryable` 标记
- `AIProviderContract.validate()`：`complete` 必需、`stream` 可选
- `makeProviderResult()` / `validateProviderResult()` / `PROVIDER_RESULT_FIELDS`：ProviderResult 契约（`output` 只能是数据，拒绝可执行值）
- `estimateTokens()` / `checkTokenBudget()`：token 粗估与 `maxInputTokens` / `maxOutputTokens` 预算
- `MockAIProvider`：离线、无 Key、无网络、确定性，支持 9 种场景与 `stream()`
- `OpenAICompatibleProvider` / `OllamaProvider` / `defaultProviderTransport`：真实 HTTP 实现，transport 可注入
- `classifyTransportThrow()` / `classifyHttpResponse()`：传输与 HTTP 状态映射
- `ProviderRegistry`：`mock` / `openai-compatible` / `ollama` 工厂（未注册类型返回 null）
- `ProviderSettings`：独立 localStorage 配置键 `novelcraft_provider_config_v1` + 掩码视图
- `ProviderRuntime.complete / stream / resolve / config / auditFields`
- `ChapterExtractionSchema` / `normalizeChapterExtraction()`：结构化输出契约与规范化
- `revalidateEvidence()`：Evidence 重新验证（系统重新 slice，编造/越界/sourceId 不符一律拒绝）
- `LLMProposalBridge.toStateChanges / propose`：抽取 → StateChange（`before` 由系统生成）→ ChangeSet
- `LLMChapterAnalysis.analyzeChapter / applyApproved`：降级链与人工批准应用
- 设置页 Provider 配置与 Copilot「LLM 分析」闭环（`providerSettingsHTML` / `runLLMAnalysis` / `approveLLMAnalysis` / `rejectLLMAnalysis` / `llmStatusHTML`）
- 回归测试由 104 项扩展到 147 项（Phase 4 / 5.1 / 5.2 / 5.3 的测试全部保留）

### Changed

- `ChangeSetRuntime.approve()`：新增人工审批硬门 —— `requiresHumanApproval` 的 ChangeSet 拒绝 `system` / `system:*` / `compat:*` / `auto` / 空批准人，返回 `human_approval_required`
- 审计账本条目新增 `origin` 与 `llm:{ provider, model, requestId, promptHash, usage, latencyMs }`
- `LLMProposalBridge` 的 `before` 改为从**规范化快照**读取（与前置条件/verify 同一视图）

### Fixed

- **Phase 5.4 早期缺陷**：LLM 提案的 `before` 取自未规范化的活状态，导致 aiAnalysis 更新的前置条件不匹配、批准后写入失败；现统一到规范化视图
- Provider 区块使用 `StoryStore.hash` 生成 requestId 会破坏"Provider 与 Runtime 隔离"，改为纯本地字符串哈希

### Notes

- **真实 LLM 未做 smoke test**（无 API Key / 未配置第三方服务）：`REAL LLM CONTRACT IMPLEMENTED, SMOKE TEST NOT RUN`
- 自动回归测试**不触网**：所有 Provider 测试使用 `MockAIProvider` 或注入的同步假 transport
- API Key 不进入 StoryState / export / ChangeSet / changeLedger；账本只记录 provider / model / requestId / promptHash / usage / latency
- 确定性解析器（关键词/正则）保留为基线，LLM 失败一律降级
- 未改动 `APP_VERSION` / `STORY_STATE_VERSION` / `SCHEMA_VERSION`


## v0.2.0 - Phase 5.3 (Runtime Action Migration & Explainable Consistency)

### Added

- `ActionMigration`：`propose()` / `changesFor()` / `matrix()` / `statusFor()` / `evidenceForForeshadow()`，Action → StateChange → ChangeSet
- `StoryContract.makeConsistencyIssue()` / `makeActionProposal()` / `validateConsistencyIssue()` / `severityFromPriority()`
- `ConsistencyScore.compute()`：确定性评分（blocking -15 / error -8 / warning -3 / info -1），Issues 为事实来源
- `StoryStore.getActionDecisions()` / `appendActionDecision()`：审批与拒绝的持久化审计
- `AIRuntime.consistencyReport()` / `ruleContracts()` / `ruleValidateCallCount()` / `actionMigrationMatrix()` / `auditTrail()` / `actionDecisions()` / `applyPlan()` / `rejectPlan()` / `evaluateContext()`
- 角色洞察 / 境界 / 弧光的确定性分析：`analysis.characterInsights` / `analysis.realm` / `analysis.arc`
- `narrative_state.actionDecisions`（schema 默认值 + normalize 保留）
- 回归测试由 69 项扩展到 104 项（Phase 4 / 5.1 / 5.2 的测试全部保留）

### Changed

- **Runtime Action 全量迁移**：`introduce_conflict` / `resolve_foreshadow` / `create_protagonist` / `designate_protagonist` / `introduce_sidekick` 产生真实 StateChange 并经 ChangeSet 落库；其余 11 个动作迁移为"诊断类"（只产出 Issue，不再写 `aiSuggestions`）
- `AIExecutionLayer.execute()` 内部改为 ChangeSet 路径（批准人 `compat:runtime.execute`）；`_applyDecision()` 直写移除
- `AIRuntime.run()` 不再直写状态，返回 `verified / changeSetIds / stateHashAfter`
- `ActionPlanSystem`：`observe→analyze→plan→validate→policy→executeWithApproval→verify` 统一；`plan.id` 改为确定性哈希（去掉 `Date.now()`）
- `ActionPlanSystem.verify()` 重定义：`success / hasChanges / changeCount / changes / executedCount / skippedCount / failedCount / stateHashBefore / stateHashAfter / changeSetIds / verifiedAt`
- `ActionPlanSystem.plan()` 为每个计划附带 `issueId / evidence / policy / suggestedChangeSetId / diagnosisOnly`
- `buildAIContext()` 注入 `world`、`characters[].aiProfile/aliases`、`chapter.id`、角色洞察、境界与弧光
- `AIRuleRegistry`：Rule Contract 标准化（`ruleId/name/description/category/evaluate`），`validate()` 真正参与决策
- `runConsistencyCheck()` 改用 `AIRuntime.consistencyReport()`；`runCopilot()` 渲染 Issue 的证据/建议/entityRef
- `approveAction()` 依据真实 verify 结果提示；`rejectAction()` 保留计划并标记 REJECTED
- 审计账本条目补齐 `ruleId / issueId / actionId / actionType / chapterId / changes[]`

### Fixed

- **Consistency 页面崩溃**：`runConsistencyCheck()` 引用了不存在的裸 `AIDecisionLayer`（ReferenceError），页面无法运行；已修复（测试 70/100）
- **4 条结构性死亡规则**：`world_rule_conflict`（`world` 未进入上下文）、`character_inconsistency`（`aiProfile` 未注入 + `consistencyScore` 恒为 100）、`arc_stagnation`（叙事状态永远 undefined）、`power_level_conflict`（硬编码 `return false`）
- **`Rule.validate()` 空转**：条件命中即产出动作，validate 返回值被忽略；现在 validate 可阻断动作并记录 rejected
- **Verify 假计数**：`executedCount` 曾等于"未被 skip 的动作数"，与实际状态变化无关；现以 `structuredDiff` 为准
- **UI 假报成功**：`approveAction()` 无条件 `toast('已执行')`，即使 `stateHashBefore === stateHashAfter`；现在只在验证通过时报告成功
- **`toast()` 健壮性**：在缺少 `Element.remove` 的环境（含测试 DOM mock）中抛错

### Notes

- **当前仍然没有真实 LLM**（无 fetch / XHR / WebSocket / SSE / Provider / API Key）
- 生产代码中已无 Action 直写 StoryState；剩余 `COMPATIBILITY LEGACY PATH` 仅为解析缓存 `_lastParseResult`
- 写入唯一入口：`StoryStore.applyChange()`（经 `AIExecutionLayer`）
- 未改动 `APP_VERSION` / `STORY_STATE_VERSION` / `SCHEMA_VERSION`


## v0.2.0 - Phase 5.2 (Chapter Analysis & Controlled Runtime Migration)

### Added

- `StoryEngine.analyzeChapter(chapterId)`：ChapterAnalysis 契约（analysisId / chapterId / sourceHash / analyzedAt / characters / locations / events / relationships / foreshadowing / timeline / emotions / rawFacts / diagnostics）
- 结构化 Fact：`{ value, operation, confidence, entityRef, evidence, reason, resolution, matchedBy, occurrences }`
- `sourceHash`：由章节正文确定性生成（同内容一致、改正文即变化）
- Evidence 真正绑定正文：`excerpt === source.slice(start,end)`；新增 `StoryContract.validateEvidence()` / `validateEvidenceList()`；一个实体可携带多条 Evidence
- `normalizeCharacterName()` + `StoryEngine.resolveEntity()`：exact → alias → 称谓归一化 → candidate → unresolved
- `StoryEngine.diffAnalysis()`：ChapterAnalysisDiff（entity / relation / event / foreshadowing / timeline / emotion）
- `StoryEngine.analysisDiffToStateChanges()`：Diff → StateChange
- `StoryEngine.proposeChapterChanges(chapterId)`：章节 ChangeSet（带 chapterId / sourceHash / reason / evidence / policy）
- `StoryPolicy`：纯策略判定 `{ allowed, requiresApproval, reason }`
- `StoryStore.valueAtPathIn(state, path)`：纯路径读取（verify 与前置条件共用规范化视图）
- 回归测试由 34 项扩展到 69 项（Phase 4 / 5.1 的测试全部保留）

### Changed

- `StoryEngine.syncFromChapter()` 改造为**兼容适配器**（代码中标记 `COMPATIBILITY LEGACY PATH`）：analyzeChapter → ChangeSet(PROPOSED) → validate → auto-approve(`compat:syncFromChapter`) → apply → verify
- `StoryStore.applyChange()` 支持单例路径 `narrative_state.<field>`（出场统计映射不再绕过 ChangeSet）
- `ChangeSet` 契约扩展：`chapterId` / `sourceHash` / `reason` / `evidence` / `policy` / `analysis`
- `StateChange` 契约扩展：`confidence` / `requiresApproval` / `policyReason`
- `ChangeSetRuntime.verify()` 支持对象/数组值路径：以子路径变化 + 快照值比对核验整对象写入
- `makeChangeSetId()` 引入 scope（chapterId + sourceHash）：同章节同正文幂等、改正文即新 ChangeSet
- `StoryStore.normalize()` 保留 `characters[].aliases`（实体解析需要）
- 测试中的状态基线统一使用 `StoryStore.hash(StoryStore.snapshot())`（与 snapshot/rollback 的规范化视图一致）

### Fixed

- **Phase 5.1 遗留缺陷**：`structuredDiff` 比较键集不对称的对象时 `JSON.stringify(undefined)` 返回 undefined，导致 `hashString` 抛 "Cannot read properties of undefined (reading 'length')"；现已 null-safe
- **Phase 5.1 遗留缺陷**：ChangeSet 的 `before` 取自未规范化的活状态，而 verify 使用规范化快照，导致合法写入被回滚（"before value mismatch"）；现统一到规范化视图（propose 与前置条件检查同时修正）
- **Phase 5.2 缺陷**：`ChangeSetRuntime.propose()` 构造 shape 时丢失 `confidence` / `requiresApproval` / `policyReason`，策略结论无法传到 StateChange；已透传

### Notes

- **当前没有真实 LLM**：不引入任何模型调用、网络层或 Provider 实现；解析仍是确定性关键词/正则
- 剩余 `COMPATIBILITY LEGACY PATH` 写入：`_lastParseResult`（解析缓存，经 StoryStore.setLastParseResult）；Phase 4 的 16 个 Runtime Action 仍经 `AIExecutionLayer._applyDecision` 直接改状态（Phase 5.3 收口）
- 章节链路（analyzeChapter / proposeChapterChanges）均不修改 StoryState，有测试断言
- 未改动 `APP_VERSION` / `STORY_STATE_VERSION` / `SCHEMA_VERSION`

## v0.2.0 - Phase 5.1 (State Contract & Auditable Change)

### Added

- StoryStore Schema 层：`normalize` / `migrate` / `validate`（`SCHEMA_VERSION` 保持 2）
- `relationships` 顶层集合，与 `characters[].relations` 双向兼容（幂等镜像）
- 导入管线：`JSON parse → migration → normalization → validation → commit`；非法 import 不覆盖当前状态
- Runtime Contracts（纯数据）：`EntityRef` / `Evidence` / `StateChange` / `ChangeSet` / `ValidationResult`
- 确定性 ID：实体 `<prefix>_NNN`、`changeSetId = cs_<hash>`、`changeId = chg_<hash>`（不使用随机数作为业务身份）
- `StoryStore.structuredDiff(before, after)`：路径级 `add / remove / update`
- Snapshot / Rollback 强化：校验 → normalize → validate → 原子替换，失败不污染当前状态
- ChangeSet 生命周期：`PROPOSED → VALIDATING → VALID → APPROVED → APPLIED → VERIFIED`，异常 `REJECTED / FAILED`
- 五道门禁：合法性 / 重复 / 过期(stale) / `before` 前置条件 / 批准
- 审计账本 `narrative_state.changeLedger`（随 StoryState 持久化，无第二数据源）
- `StoryEngine.proposeChapterChanges()`：解析与写入分离，只产出 ChangeSet
- `AIRuntime.applyChangeSet()` / `proposeChangeSet()` / `validateChangeSet()` / `approveChangeSet()` / `rejectChangeSet()`
- `docs/phase5-runtime-contract.md`
- 回归测试由 10 项扩展到 34 项（Phase 4 的 10 项全部保留）

### Changed

- `StoryStore.snapshot()` 现在返回**规范化后的深拷贝**（不再与 `_state` 共享引用）
- `StoryStore.rollback()` 现在执行校验并返回 `{ ok, errors, warnings }`（旧行为为直接替换、返回 undefined）
- `StoryStore.importJSON()` 现在返回 `{ ok, stage, errors, warnings }`，失败时**不修改**当前状态（旧行为为直接赋值）
- `StoryStore.load()` 复用同一导入管线，坏数据不再载入内存
- `StoryEngine.syncFromChapter()` 不再直接写 `StoryStore.state._lastParseResult`，改走 `StoryStore.setLastParseResult()`
- `AIRuntime.run()` 不再直接写 `StoryStore.state.narrative_state.lastAnalysis`，改走 `StoryStore.setNarrativeState()`
- `importData()`（UI）依据导入结果提示成功/失败，不再对失败静默报成功
- README 修正：AI Provider 标注为"尚未接入"，不再声称存在 Mock 抽象

### Notes

- **当前没有真实 LLM**：本阶段不引入任何模型调用、网络层或 Provider 实现
- 仍保留一条遗留直写路径：`AIExecutionLayer.execute / _applyDecision` 直接修改 StoryState（属 Phase 5.2 收口范围）
- 未改动 `APP_VERSION` / `STORY_STATE_VERSION` / `SCHEMA_VERSION`

## v0.2.0 - Phase 4 (2026-09-08)

### Added

- 统一 StoryState 作为小说数据唯一事实来源
- StoryStore 数据访问层（CRUD + snapshot/rollback/diff + 旧数据迁移）
- NovelCraft UI x Story OS 内核融合
- StoryEngine.syncFromChapter 章节内容解析（人物/地点/事件/伏笔/情绪/时间提示）
- AIRuntime 产品化，接入 Copilot 面板
- Action Plan System（Observe → Analyze → Plan → Validate → Approval → Execute → Verify）
- 幂等执行机制（决策 hash 去重）
- Rule Registry 扩展至 16 条可插拔规则
- 一致性检查改为真实 StoryState + 规则系统驱动
- 版本信息（APP_VERSION / STORY_STATE_VERSION / SCHEMA_VERSION）
- 数据迁移版本检查
- 10 项自动化回归测试

### Removed

- 废弃 D 数据模型（NovelCraft 旧数据结构）
- 重复 UI 入口（novel-assistant.html、novelcraft-pro.html 移至 backup）
- 随机 AI 模拟逻辑（Math.random 仅保留于 uid 生成）
- 无效测试代码和临时调试文件
- 旧版外部依赖（echarts.min.js、mermaid.min.js）

### Fixed

- StoryState 状态一致性
- 重复执行导致重复创建 conflict
- StoryEngine 重复解析导致重复增加人物出场统计
- persist() 异步 debounce 导致 localStorage 测试失败
- no_conflict 规则 action 缺少 ctx 参数
- migrateFromNC 中 description 字段缺少闭合引号
- 回归测试稳定性
