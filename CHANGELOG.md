# Changelog

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
