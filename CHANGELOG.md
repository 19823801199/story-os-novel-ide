# Changelog

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
