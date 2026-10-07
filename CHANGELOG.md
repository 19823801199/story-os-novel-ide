# Changelog

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
