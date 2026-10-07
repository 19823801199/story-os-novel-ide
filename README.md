# Story OS Novel IDE

**版本**: v0.2.0
**阶段**: Phase 5.1 - State Contract & Auditable Change（基线 Phase 4 全部保留）
**定位**: AI 驱动的小说创作与叙事状态管理 IDE

## 核心架构

```
NovelCraft UI (产品层)
    ↓
StoryStore (数据访问层 + Schema: normalize / migrate / validate / structuredDiff)
    ↓
StoryState (唯一事实来源，含审计账本 narrative_state.changeLedger)
    ↓
ChangeSet Runtime (Proposed → Validating → Valid → Approved → Applied → Verified)
    ↓
StoryEngine (内容解析引擎；已分离"解析"与"写入")
    ↓
AIRuntime (规则决策引擎)
    ↓
AI Provider (抽象接口 - 尚未接入，当前无真实 LLM)
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
- **Regression Test** - 34 项自动化回归测试（Phase 4 的 10 项全部保留）
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

## 未完成

- 真实 LLM Provider（DeepSeek / OpenAI-compatible / 本地模型）
- 更强的语义解析（当前为关键词匹配）
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
│   └── phase5-runtime-contract.md   # Phase 5.1 状态契约与可审计变更
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
| Regression Tests | 34/34 PASS |
| 真实 LLM | 未接入（Phase 5.1 不含 Provider） |

## License

Private - 仅供个人使用
