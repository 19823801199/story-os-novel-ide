# Story OS Novel IDE

**版本**: v0.2.0
**阶段**: Phase 4 - Unified Story Runtime
**定位**: AI 驱动的小说创作与叙事状态管理 IDE

## 核心架构

```
NovelCraft UI (产品层)
    ↓
StoryStore (数据访问层)
    ↓
StoryState (唯一事实来源)
    ↓
StoryEngine (内容解析引擎)
    ↓
AIRuntime (规则决策引擎)
    ↓
AI Provider (抽象接口 - 当前为 Mock)
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
- **Regression Test** - 10 项自动化回归测试
- **Copilot 面板** - 章节编辑器右侧实时展示 AI 诊断与可执行动作

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
| Rules | 16 |
| Regression Tests | 10/10 PASS |

## License

Private - 仅供个人使用
