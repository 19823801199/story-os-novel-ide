# Story OS Novel IDE

**版本**: v0.2.0
**阶段**: Phase 6 - Context, Memory & Long-Context Runtime（基线 Phase 4 / 5.1 / 5.2 / 5.3 / 5.4 全部保留）
**定位**: AI 驱动的小说创作与叙事状态管理 IDE

## 核心架构

```
NovelCraft UI (产品层)
    ↓
StoryStore (数据访问层 + Schema: normalize / migrate / validate / structuredDiff)
    ↓
StoryState (唯一事实来源，含审计账本 narrative_state.changeLedger)
    ↓
StoryEngine (内容解析引擎；解析与写入已分离)
    ↓
ChapterAnalysis (analyzeChapter / Evidence / Entity Resolution / diffAnalysis)
    ↓
AIRuntime (RuleRegistry 诊断 → ActionMigration → ActionProposal)
    ↓
ChangeSet Runtime (Proposed → Validating → Valid → Approved → Applied → Verified)
    ↓
ExecutionLayer → StoryStore.applyChange (唯一写入口)
    ↓
MemoryIndex (派生索引) → StoryContextBuilder (4 类任务) → ContextBudgeter (确定性裁剪)
    ↓
AI Provider (Phase 5.4: Mock / OpenAI-compatible / Ollama)
    ↓
ProviderResult → Schema → Evidence 重验证 → Proposal → ChangeSet（人工审批）→ Verify
    ↓
AIAuditStore (AI 操作历史，独立存储；与 StoryState 严格分离)
```

## 已完成

- **StoryState** - 统一小说状态模型，唯一事实来源
- **StoryStore** - 数据访问层，CRUD + snapshot/rollback/diff + 旧数据迁移
- **StoryEngine** - 章节内容解析（人物、地点、事件、伏笔、情绪、时间提示）
- **AI Context** - 统一上下文构建，为规则评估提供完整视图
- **AIRuntime** - 三层架构（RuleRegistry → DecisionLayer → ExecutionLayer）
- **Rule Registry** - 16 条可插拔规则（id/priority/condition/action/validate）
- **Action Plan System** - Observe → Analyze → Plan → Validate → Approval → Execute → Verify
- **幂等执行** - 决策 hash 去重，防止重复执行
- **一致性检查** - 基于真实 StoryState + 规则系统，无随机模拟
- **数据持久化** - localStorage 自动保存 + 旧版本数据迁移
- **Regression Test** - 192 项自动化回归测试 + 6 项真异步套件（Phase 4 / 5.1 / 5.2 / 5.3 / 5.4 的 147 项全部保留）
- **Copilot 面板** - 章节编辑器右侧实时展示 AI 诊断与可执行动作

### Phase 5.1 新增

- **Schema 层** - `StoryStore.normalize / migrate / validate`，`SCHEMA_VERSION` 仍为 2
- **relationships 顶层集合** - 与旧的 `characters[].relations` 双向兼容（幂等镜像）
- **五步导入管线** - `parse → migration → normalization → validation → commit`，非法 import 不覆盖当前状态
- **Runtime Contracts** - `EntityRef` / `Evidence` / `StateChange` / `ChangeSet` / `ValidationResult`，纯数据、确定性 ID
- **structuredDiff** - 路径级 `add / remove / update`（如 `characters.character_001.name`）
- **Snapshot / Rollback 强化** - 校验 → normalize → validate → 原子替换，失败不污染当前状态
- **ChangeSet 生命周期** - `PROPOSED → VALIDATING → VALID → APPROVED → APPLIED → VERIFIED`，异常 `REJECTED / FAILED`
- **五道门禁** - 合法性 / 重复 / 过期(stale) / before 前置条件 / 批准，任一条不过即拒绝执行
- **审计账本** - `narrative_state.changeLedger` 随状态一起持久化，不引入第二数据源
- **解析与写入分离** - `StoryEngine.proposeChapterChanges()` 只产出 ChangeSet，不写状态
- **AIRuntime.applyChangeSet()** - 经 ExecutionLayer → StoryStore 的受控写路径
- **文档** - `docs/phase5-runtime-contract.md`

### Phase 5.2 新增

- **ChapterAnalysis** - `StoryEngine.analyzeChapter(chapterId)`：章节 → 结构化事实（含 confidence / entityRef / evidence / reason），**只读**
- **sourceHash** - 由正文确定性生成；同内容同哈希、改正文即变化；参与 ChangeSet 身份派生
- **Evidence 绑定正文** - `start/end/excerpt` 必须来自真实文本切片，`StoryContract.validateEvidence()` 校验，非法即拒绝
- **Entity Resolution** - exact → alias → 称谓归一化 → candidate → unresolved；候选不自动选择、未解析不自动建人
- **ChapterAnalysisDiff** - `StoryEngine.diffAnalysis()`：entity / relation / event / foreshadowing / timeline / emotion 的 add / remove / update
- **Chapter ChangeSet** - `proposeChapterChanges(chapterId)` 产出带 chapterId / sourceHash / policy / evidence 的 ChangeSet(PROPOSED)
- **StoryPolicy** - 纯策略判定（低置信度新角色禁止自动执行；核心身份 / 删除 / 时间线 / 世界观 / 伏笔 / 关系需批准；伏笔必须有 evidence）
- **Controlled Runtime** - `syncFromChapter()` 改造为兼容适配器，经 analyze → propose → validate → approve → apply → verify
- **文档** - `docs/phase5.2-chapter-analysis.md`

### Phase 5.3 新增

- **Runtime Action 全量迁移** - 16 个 Action 无一例外：5 个真实状态变更（`introduce_conflict` / `resolve_foreshadow` / `create_protagonist` / `designate_protagonist` / `introduce_sidekick`）+ 11 个诊断类，全部经 `ActionProposal → StateChange → ChangeSet`
- **ActionMigration** - `ActionMigration.propose()`：Action → StateChange → ChangeSet(PROPOSED)，含语义幂等保护
- **唯一写入口** - `AIExecutionLayer._applyDecision()` 直写已移除（返回 `deprecated_no_write`）；写入一律经 `ChangeSetRuntime.apply → AIExecutionLayer.applyChangeSet → StoryStore.applyChange`
- **Approval 硬门** - `approveAction()` 走 `applyPlan()`；`rejectAction()` 写入 `narrative_state.actionDecisions`（REJECTED 可审计，不再只是从内存数组删除）
- **Verify 重定义** - `changeCount / changes / executedCount / success / stateHashBefore / stateHashAfter / verifiedAt`；`executedCount` 只统计真正产生可观测变化的动作
- **Consistency 页面修复** - `runConsistencyCheck()` 不再引用不存在的裸 `AIDecisionLayer`，改为 `AIRuntime.consistencyReport()`
- **ConsistencyIssue 契约** - 13 字段（issueId / ruleId / severity / category / title / message / entityRef / evidence / location / facts / suggestedFix / suggestedChangeSet / createdAt）
- **Rule Contract** - `ruleId / name / description / priority / category / evaluate()`；规则只做 Observe/Diagnose，永不写状态
- **Rule.validate 真正生效** - `condition → validate → issue/action proposal`，并暴露 `ruleValidateCallCount()`
- **4 条结构性死亡规则修复** - `world_rule_conflict`（注入 world）、`character_inconsistency`（注入 aiProfile + 确定性角色洞察）、`arc_stagnation`（可评估叙事状态）、`power_level_conflict`（确定性境界阶梯）
- **确定性一致性评分** - `ConsistencyScore.compute(issues)`（blocking -15 / error -8 / warning -3 / info -1），取消硬编码 100
- **审计链** - `ruleId → issueId → actionId → changeSetId → stateChanges → execution → verify`（`AIRuntime.auditTrail()`）
- **UI 真实反馈** - "已执行"只在验证通过时出现，否则显示"状态未变化 / 执行失败 / 验证失败"（`applyResultMessage()`）
- **文档** - `docs/phase5.3-action-consistency.md`


### Phase 5.4 新增

- **Provider Contract** - `AIProviderContract.validate()`；`complete(request, options)` / `stream(request, onChunk, options)`（返回值或 thenable 皆可）
- **ProviderResult** - 10 字段契约（provider / model / requestId / success / output / structured / usage / latencyMs / error / rawResponse），`output` 只能是数据
- **MockAIProvider** - 默认离线、无 API Key、无网络、确定性；覆盖 success / timeout / network / auth / rate_limit / malformed_json / schema_error / empty / provider_error
- **OpenAI-compatible Provider** - 一个实现覆盖 OpenAI / DeepSeek / Kimi / 通义 / 智谱；`baseURL` + `model` + `apiKey`，transport 可注入（回归测试永不触网）
- **Ollama Provider** - 最低支持 `baseURL` + `model`（`/api/chat`，无需 API Key）
- **结构化输出契约** - Chapter Extraction 7 字段 + `ChapterExtractionSchema` + `normalizeChapterExtraction()`（JSON → Parse → Schema → Normalize，解析失败绝不猜测）
- **Evidence 重新验证** - `revalidateEvidence()`：系统重新读取原文并 slice，`excerpt !== slice` 一律拒绝
- **LLM Proposal** - `LLMProposalBridge`：抽取结果 → StateChange（`before` 由系统从规范化快照生成）→ ChangeSet
- **降级链** - `LLMChapterAnalysis.analyzeChapter()`：未启用 / 请求失败 / schema 非法 → 确定性解析器（Phase 4 解析器永不删除）
- **人工审批硬门** - `requiresHumanApproval` 的 ChangeSet 拒绝 `system` / `compat:*` / `auto` 批准人
- **Provider 设置页** - Provider / Base URL / Model / API Key / Temperature / Max Tokens / Timeout / Max Retries / 启用 LLM；API Key 存独立 localStorage 键，**不进入 StoryState / 导出 / ChangeSet / 账本**
- **审计字段** - 账本新增 `origin` 与 `llm:{ provider, model, requestId, promptHash, usage, latencyMs }`（只存 promptHash，不存完整 prompt 与密钥）
- **Copilot「LLM 分析」** - 展示 Provider / Model / 状态 / 提案，复用既有 Issue / ChangeSet / Evidence 展示与人工采用/忽略
- **文档** - `docs/phase5.4-provider-contract.md`


README

## 未完成

- 真实 LLM 端到端验证（Provider 契约已实现，但未用真实 API Key 做 smoke test）
- 更强的语义解析（确定性解析器仍是基线，LLM 为可选增强层）
- 更强的时间线推理
- 更强的角色一致性分析
- 多章节上下文窗口
- 后续 Agent Workflow

## 技术栈

- 单 HTML 文件（零外部依赖）
- 原生 JavaScript（无框架）
- localStorage 持久化
- Node.js 仅用于回归测试运行

## 项目结构

```
/
├── src/
│   └── index.html          # 正式主程序
├── tests/
│   └── regression-tests.js # 回归测试
├── docs/                    # 文档目录
│   ├── phase5-runtime-contract.md   # Phase 5.1 状态契约与可审计变更
│   ├── phase5.2-chapter-analysis.md # Phase 5.2 章节分析与受控运行时迁移
│   ├── phase5.3-action-consistency.md # Phase 5.3 运行时 Action 迁移与可解释一致性
│   ├── phase5.4-provider-contract.md  # Phase 5.4 Provider 契约与安全 LLM 接入
│   └── phase6-context-memory.md      # Phase 6 上下文、记忆与长上下文运行时
├── backup/                 # 原始备份（不提交 Git）
│   └── phase-4-complete-original/
├── README.md
├── CHANGELOG.md
└── .gitignore
```

## 运行方式

### 主程序
浏览器直接打开 `src/index.html`

### 回归测试
```bash
node tests/regression-tests.js
```

## 版本信息

| 字段 | 值 |
|------|------|
| APP_VERSION | 0.2.0 |
| STORY_STATE_VERSION | phase4 |
| SCHEMA_VERSION | 2 |
| CONTRACT_VERSION | 5.1 |
| Rules | 16 |
| Regression Tests | 192/192 PASS（另有 6 项真异步套件） |
| ChapterAnalysis | Phase 5.2（确定性解析为基线，Phase 5.4 起 LLM 为可选增强层） |
| Consistency | Phase 5.3（确定性评分，Issues 为事实来源） |
| AI Provider | Phase 5.4（Mock / OpenAI-compatible / Ollama；真实 Provider 未做 smoke test） |
| Context / Memory | Phase 6（ContextBuilder / ContextBudgeter / MemoryIndex / 摘要 / AI Audit） |
| 真实 LLM | 未接入（Phase 5.1 / 5.2 均不含 Provider） |

## License

Private - 仅供个人使用
