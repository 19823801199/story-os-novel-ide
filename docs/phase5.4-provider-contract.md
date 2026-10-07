# Phase 5.4 — AI Provider Contract & Safe LLM Integration

> 版本：`APP_VERSION 0.2.0` / `STORY_STATE_VERSION phase4` / `SCHEMA_VERSION 2` / `CONTRACT_VERSION 5.1`
> 测试：`node tests/regression-tests.js` → **147/147 PASS**（Phase 4 / 5.1 / 5.2 / 5.3 的 104 项全部保留 + 本阶段新增 43 项）

**Phase 5.4 是第一个真实 LLM 可以进入系统的阶段**（在此之前，Phase 4 / 5.1 / 5.2 / 5.3 全程没有模型调用）。

本阶段只新增"读取/生成侧"的边界，**不修改核心写入架构**：

```text
LLM
 ↓
Provider（只能 input → output）
 ↓
ProviderResult（纯数据）
 ↓
JSON Schema Validate → Normalize
 ↓
Evidence 重新验证（系统重新读取原文并 slice）
 ↓
Rule Validation（RuleRegistry.validate）
 ↓
Structured Proposal → StateChange（before 由系统生成）
 ↓
ChangeSet
 ↓
Policy → 人工审批（Human Approval，硬门）
 ↓
ExecutionLayer → StoryStore.applyChange
 ↓
Verify → 审计账本
```

---

## 1. Provider Interface

```js
AIProvider = {
  providerId, provider, model,
  offline, requiresApiKey, deterministic,   // 元信息（只读描述）
  complete(request, options) -> ProviderResult | Promise<ProviderResult>,
  stream(request, onChunk, options) -> ProviderResult | Promise<ProviderResult>   // 可选
}
```

- `request`：`{ input, chapterId, task, system }`（纯数据）
- `options`：`{ schema, timeoutMs, maxRetries, maxTokens, temperature, budget:{maxInputTokens,maxOutputTokens}, requestId, now }`
- 契约校验：`AIProviderContract.validate(provider)`（必须有 `complete`，`stream` 若存在必须是函数，必须有 `provider`/`providerId`）

**为什么 `complete()` 允许返回同步值**：整个应用是 ES5 单文件、无构建步骤，而回归测试运行在同步内核里。
因此契约是"返回值或 thenable 皆可"：`MockAIProvider`（确定性、离线）同步返回；`OpenAICompatibleProvider`
在真实 `fetch` 下返回 Promise，UI 侧 `.then()` 处理。`ProviderRuntime.complete()` 统一收敛两种情况。

**Provider 不能触碰运行时**（§五）：

| 禁止 | 说明 |
| --- | --- |
| `StoryStore` / `StoryEngine` / `ExecutionLayer` / `ExecutionLayer` | Provider 区块源码内 0 引用（测试 117 扫描源码验证） |
| 直接改 StoryState | Provider 只返回 `ProviderResult`（测试 116 断言状态哈希不变） |
| 持有业务身份 | `requestId` 由 Provider 侧确定性字符串哈希生成，不用 `StoryStore.hash` |

---

## 2. ProviderResult

```js
{
  provider,      // 'mock' | 'openai-compatible' | 'ollama' | ...
  model,
  requestId,     // 确定性（同 provider+model+input → 同 id）
  success,       // boolean（必须与 error 互斥）
  output,        // 只能是数据（字符串 / 对象）；禁止可执行值
  structured,    // 已解析的结构化对象（失败时为 null）
  usage,         // { inputTokens, outputTokens, totalTokens }（缺失为 null）
  latencyMs,
  error,         // { code, message, details, retryable } | null
  rawResponse    // 可选，原始响应文本（不含任何密钥）
}
```

`validateProviderResult(r)` 强制：10 个字段齐全、`success` 为布尔、`error.code` 属于错误枚举、成功不得带 error、
失败必须有 error、`output/structured` 不得含函数（用 `StoryContract.collectFunctionPaths` 检测）。
`ProviderRuntime.complete` 返回的结果额外带 `attempts`（重试次数，便于测试与展示）。

---

## 3. MockAIProvider

```js
MockAIProvider({ scenario, model, output })
```

- **默认离线**：`offline:true`、`requiresApiKey:false`、**不执行任何网络请求**、`deterministic:true`
- 场景：`success` / `timeout` / `network_error` / `auth_error` / `rate_limit` / `malformed_json` / `schema_error` / `empty` / `provider_error`
- `success` 的默认输出由**请求内容确定性派生**（首个 2–3 字中文片段 + 其在正文中的真实区间），因此天然可以驱动
  Evidence 重验证链路；也可用 `output` 注入固定 JSON
- 同一请求重复调用 → 完全相同的 `structured` / `requestId`（测试 107）
- `stream()` 把输出按 40 字符切片回调 `onChunk`，并给出 `chunks` 计数（测试 128）

---

## 4. OpenAI-compatible Provider

一个实现覆盖 OpenAI / DeepSeek / Kimi / 通义 / 智谱 / 其它兼容接口，**不复制六套 Provider**：

```js
OpenAICompatibleProvider({ provider, baseURL, apiKey, model, temperature, maxTokens,
  timeoutMs, maxRetries, maxInputTokens, maxOutputTokens, transport })
```

- 请求：`POST {baseURL}/chat/completions`，`Authorization: Bearer <key>`，body `{model, messages, temperature, max_tokens?, response_format:{type:'json_object'}}`（测试 121）
- `transport` 可注入：默认实现用 `fetch`；测试注入同步假 transport，**回归测试永不触网**（§二十五）
- 响应解析：`choices[0].message.content` → `JSON.parse` → 可选 schema 校验；任何一步失败都是**结构化错误**，绝不猜测（测试 110）

---

## 5. Ollama

```js
OllamaProvider({ baseURL, model, transport })   // 最低支持 baseURL + model
```

- `POST {baseURL}/api/chat`，body 含 `format:'json'`，响应取 `message.content`，用量取 `prompt_eval_count` / `eval_count`
- `requiresApiKey:false`（本地模型通常不需要 Key），因此不发 `Authorization` 头（测试 142）
- 不做复杂模型管理（拉取/量化/多模型路由留待后续）

---

## 6. Structured output

第一阶段支持 **Chapter Extraction**：

```js
{ characters: [], locations: [], events: [], relationships: [], foreshadowing: [], timeline: [], emotions: [] }
```

流程严格为 `JSON → Parse → Schema Validate → Normalize`：

1. **Parse**：`JSON.parse` 失败 → `success:false` + `INVALID_RESPONSE`（**禁止**"猜测模型输出"，测试 110）
2. **Schema Validate**：`ChapterExtractionSchema.validate(obj)`（测试 113/114）
3. **Normalize**：`normalizeChapterExtraction(obj)` 补齐 7 个数组、丢弃未知字段、把字符串项统一为对象（测试 115）
4. 失败 → ProviderResult 失败或进入明确的 `SCHEMA_ERROR`；**绝不进入 ChangeSet**

---

## 7. JSON Schema

`ChapterExtractionSchema`（声明式，可被 Provider 与 Runtime 共用）：

| 字段 | 规则 |
| --- | --- |
| `characters[]` | 必须有非空 `name: string`；`confidence` 若存在必须是 number；`evidence` 若存在必须是数组 |
| `locations[]` | 字符串或 `{name:string}` |
| `events[]` | 字符串或 `{event:string}` |
| `foreshadowing[]` | 字符串或 `{content:string}` |
| `timeline[]` | 字符串或 `{time:string}` |
| `emotions[]` | 字符串或 `{emotion:string}` |
| `relationships[]` | 必须有 `from`/`fromId` 与 `to`/`toId`（字符串）；`type` 若存在必须是 string |
| 顶层 | 必须是对象（非数组/字符串）；未列出的字段在 normalize 阶段丢弃 |

Provider 侧（`options.schema`）与 Runtime 侧**双重校验**：Provider 失败 → `INVALID/SCHEMA` 错误；
Runtime 二次校验仍失败 → `schema failed -> reject -> deterministic fallback`（测试 131）。

---

## 8. Error handling

`ProviderErrors`（统一枚举，全部可识别、可测试、可展示，且**都不改变 StoryState**）：

```text
CONFIG_ERROR  AUTH_ERROR  NETWORK_ERROR  TIMEOUT  RATE_LIMIT
INVALID_RESPONSE  SCHEMA_ERROR  PROVIDER_ERROR  BUDGET_EXCEEDED  UNKNOWN_ERROR
```

映射规则：`401/403 → AUTH_ERROR`、`429 → RATE_LIMIT`、`400/404/422 → CONFIG_ERROR`、`5xx → PROVIDER_ERROR`、
传输抛错含 `timeout/timed out/abort → TIMEOUT`、含 `fetch/network/ECONN/DNS/socket → NETWORK_ERROR`，
其余 `UNKNOWN_ERROR`。可重试标记：`TIMEOUT / NETWORK_ERROR / RATE_LIMIT / PROVIDER_ERROR`（测试 108/109/122/123/124）。

---

## 9. Timeout

- `options.timeoutMs`（或配置里的 `timeoutMs`）
- 同步 transport：由 `classifyTransportThrow` 判定 `TIMEOUT`
- 异步 transport：`Promise.race([请求, 超时])`，超时返回 `TIMEOUT`（不取消底层请求，但**不会写入任何状态**）
- 回归测试覆盖同步超时与 mock 超时场景；异步超时分支需 async 测试环境，本阶段不纳入自动回归

---

## 10. Retry

- `options.maxRetries` / 配置 `maxRetries`，仅对**可重试错误**生效（`retryable:true`）
- 总尝试次数 = `maxRetries + 1`，结果带 `attempts` 字段（测试 125：首次 503 后重试成功 = 2 次；
  测试 126：始终 503 → `PROVIDER_ERROR` + `attempts===2`）
- **重试不会重复写 StoryState**：Provider 没有写入权限，重试只影响返回的 ProviderResult
- 不实现队列/背压/并发控制（明确留给后续阶段）

---

## 11. Fallback

`LLMChapterAnalysis.analyzeChapter(chapterId, options)` 是唯一入口，返回：

```js
{ source:'llm' | 'deterministic', analysis, extraction, providerResult, changeSet, drafts,
  rejectedFacts, evidenceRejected, errors, fallback, reason, llmEnabled, summary }
```

| 情况 | 行为 |
| --- | --- |
| 未配置/未启用 Provider | `source:'deterministic'`，`reason:'LLM disabled：…'`，`fallback:true`（测试 129） |
| Provider 请求失败 | `source:'deterministic'` + `errors:[ProviderError]` + `fallback:true`（测试 130） |
| 结构化输出非法 | `schema failed -> reject -> deterministic fallback`（测试 131） |
| 成功 | `source:'llm'` + `changeSet`（PROPOSED，需人工审批） |

**确定性解析器（关键词/正则，Phase 4 起）永不删除**：它是离线底座、测试基线、无网络环境与 API 失败恢复的保障
（测试 146 验证 fallback 可重复：同输入同结果）。LLM 只是增强层。

---

## 12. Streaming

- 只定义接口（`provider.stream(request, onChunk, options)`），**UI 不做流式渲染**
- `ProviderRuntime.stream()` 负责收集 chunk 并**组装成完整 ProviderResult**，再交回同一条
  `Schema Validate → Proposal` 链路
- 流式过程**不能**修改 StoryState（测试 128 断言状态哈希不变，且流式结果与 `complete()` 的 structured 完全一致）

---

## 13. Token budget

- 配置：`maxInputTokens` / `maxOutputTokens`；请求：`maxTokens`
- 估算：`estimateTokens(text) = ceil(len/2)`（CJK/ASCII 混合粗估，**不实现复杂 tokenizer**）
- 超预算 → `BUDGET_EXCEEDED`（测试 127），发生在**发出请求之前**，因此不消耗额度也不写入状态
- 精细的 Context Budgeter 留待 Phase 6

---

## 14. API Key security

| 要求 | 实现 |
| --- | --- |
| 不进入 StoryState | Key 只存在于 `ProviderSettings` 的独立 localStorage 键 `novelcraft_provider_config_v1` |
| 不进入 export | 测试 139 断言 `StoryStore.exportJSON()` 不含 Key |
| 不进入 ChangeSet | 测试 139 断言 `JSON.stringify(changeSet)` 不含 Key |
| 不进入审计账本 | 账本只保存 `provider / model / requestId / promptHash / usage / latencyMs` |
| 不进入 ProviderResult | 测试 121 断言 `JSON.stringify(result)` 不含 Key |
| 不进入日志 | Provider 区块不打印请求体/头部 |
| 展示 | 设置页显示 `****1234` 掩码 + 明确风险提示（测试 143） |

**明确提示（写入设置页）**：API Key 仅保存在本机浏览器存储，不会写入 StoryState / 导出 JSON / ChangeSet / 审计账本，
但仍存在本机被读取的风险。

---

## 15. Evidence validation

LLM 提供的 evidence **不可信**，必须由系统重新读取原文并验证（`revalidateEvidence`）：

```text
LLM 提供 {start,end} 或 {excerpt}
  ↓
系统读取章节原文
  ↓
重新 slice（提供 excerpt 时用 indexOf 定位）
  ↓
校验 excerpt === sourceText.slice(start,end)
  ↓
不成立 → REJECT（记录到 evidenceRejected / rejectedFacts）
```

拒绝的情形（测试 133）：`excerpt` 与切片不一致（疑似编造）、范围越界、`sourceId` 不匹配、`excerpt` 无法在原文中定位。
通过的情形（测试 132）：系统生成的 Evidence 满足 `excerpt === slice` 且 `StoryContract.validateEvidence` 通过。
**`before` 永远由系统从规范化快照生成**，模型只能提供 `after`（测试 134）。

---

## 16. LLM Proposal

`LLMProposalBridge.toStateChanges()` 把已验证的结构化抽取映射为 StateChange 草稿：

| 抽取结果 | 目标路径 | 约束 |
| --- | --- | --- |
| 章节事实汇总 | `chapters.<id>.aiAnalysis`（update） | `before` 由系统从规范化快照取；无变化则跳过 |
| 新角色 | `characters.<id>`（add） | **必须有可验证 Evidence**，否则记入 `rejectedFacts`；已解析实体不重复创建 |
| 伏笔 | `foreshadowing.<id>`（add） | **必须有可验证 Evidence**（与 Phase 5.3 Policy 一致） |
| 关系 | `relationships.<id>`（add） | 两端实体都必须能解析，否则拒绝 |

---

## 17. ChangeSet

`LLMProposalBridge.propose()` 产出 `ChangeSet(PROPOSED)`，并标记：

```js
{ source:'LLM.<provider>', operation:'llm_extraction', origin:'llm', requiresHumanApproval:true,
  chapterId, llm:{ provider, model, requestId, promptHash, usage, latencyMs }, rejectedFacts, policy }
```

同一章节 + 同一输入 → **同一 `changeSetId`**（测试 147，幂等）；不同内容 → 新 ChangeSet。
LLM ChangeSet 走与规则来源完全相同的 `validate → policy → approve → apply → verify` 链路。

---

## 18. Human Approval

**真实 LLM 产生的任何变更都必须人工批准**（§二十）：

- `ChangeSetRuntime.approve()` 增加硬门：`requiresHumanApproval===true` 的 ChangeSet，
  若批准人是 `system` / `system:*` / `compat:*` / `auto` / 空 → 返回 `human_approval_required`，状态**不进入 APPROVED**（测试 136）
- 因此 Phase 5.3 的兼容自动批准路径（`compat:runtime.execute` / `compat:syncFromChapter`）**无法**用于 LLM 提案
- UI：Copilot 的"采用（人工批准）"按钮 → `approveLLMAnalysis()` → `LLMChapterAnalysis.applyApproved(cs, 'author:<标题>')`；
  批准人写入 `cs.approval={approver, approvedAt, human:true}` 与账本（测试 137/144）
- "忽略" → `ChangeSetRuntime.reject()` + `narrative_state.actionDecisions` 记录（REJECTED 可审计）

---

## 19. Audit

账本条目（`narrative_state.changeLedger`）在 Phase 5.3 基础上新增：

```js
{ origin:'llm', llm:{ provider, model, requestId, promptHash, usage, latencyMs }, ... }
```

测试 138 断言：`origin==='llm'`、`llm.provider==='mock'`、`llm.model` 正确、`promptHash` 非空、`usage.outputTokens>0`、`source==='LLM.mock'`。
**默认不把完整 prompt 写入 StoryState，只写 `promptHash`**（完整 prompt 的独立本地审计存储留待后续）。

---

## 20. Why Provider cannot modify StoryState

1. **物理隔离**：Provider 区块只依赖纯数据与纯函数（源码级验证：不引用 StoryStore / StoryEngine / ExecutionLayer，测试 117）
2. **能力隔离**：Provider 的返回类型是 `ProviderResult`，没有任何写入 API、没有 StoryState 引用（测试 116 断言调用前后状态哈希相同）
3. **流程隔离**：写入只能发生在 `ChangeSetRuntime.apply → AIExecutionLayer.applyChangeSet → StoryStore.applyChange`，
   而这条链要求 `validate → policy → approve`，LLM 提案还必须人工批准（测试 136/140/141）
4. **数据隔离**：模型输出必须通过 JSON Schema + Evidence 重验证才能变成 StateChange，`before` 由系统生成（测试 132/133/134）

只要这四层同时成立，**即使模型输出恶意内容（幻觉实体、伪造证据、越权路径），也无法直接改变叙事状态**。

---

## 附：本阶段新增/变更的 API

| API | 说明 |
| --- | --- |
| `ProviderErrors` / `makeProviderError` | 10 类错误 + 可重试标记 |
| `AIProviderContract.validate` | Provider 契约校验 |
| `makeProviderResult` / `validateProviderResult` / `PROVIDER_RESULT_FIELDS` | ProviderResult 契约 |
| `estimateTokens` / `checkTokenBudget` | token 粗估与预算 |
| `MockAIProvider` | 离线确定性 Provider（9 种场景） |
| `OpenAICompatibleProvider` / `OllamaProvider` / `defaultProviderTransport` | 真实 HTTP 实现（transport 可注入） |
| `classifyTransportThrow` / `classifyHttpResponse` | 错误映射 |
| `ProviderRegistry` | mock / openai-compatible / ollama 工厂 |
| `ProviderSettings` | 独立 localStorage 配置（含掩码视图） |
| `ProviderRuntime.complete / stream / resolve / auditFields` | 统一调用与审计字段 |
| `ChapterExtractionSchema` / `normalizeChapterExtraction` / `revalidateEvidence` | 结构化输出与证据重验证 |
| `LLMProposalBridge.toStateChanges / propose` | 结构化抽取 → StateChange → ChangeSet |
| `LLMChapterAnalysis.analyzeChapter / applyApproved` | 降级链与人工批准应用 |
| `ChangeSetRuntime.approve` | 新增人工审批硬门 |
| 账本条目 | 新增 `origin` 与 `llm` 审计字段 |
| UI：`providerSettingsHTML / setProviderConfig / toggleProvider / clearProviderConfig / testProviderConnection / runLLMAnalysis / approveLLMAnalysis / rejectLLMAnalysis / llmStatusHTML` | 设置页与 Copilot 最小闭环 |

---

## 手工 smoke test（真实 Provider）

自动回归**永不**调用真实 API（§二十五）。如需手工验证真实 Provider：

1. 设置页填写 `Provider = openai-compatible`、`Base URL`（如 `https://api.deepseek.com/v1`）、`Model`、`API Key`
2. 点击「启用 LLM」→「测试连接」（成功显示 `连接成功: openai-compatible / <model>`）
3. 打开任意章节 → Copilot「LLM 分析」→ 查看 Provider / Model / 状态 / 变更列表
4. 点击「采用（人工批准）」→ 检查状态变化与 `changeLedger` 中的 `llm` 审计字段

> 本次交付**未运行真实 Provider smoke test**（无 API Key / 未配置任何第三方服务）。
> 已用本地 OpenAI 兼容**桩服务**验证过一次真实 HTTP 往返（见最终报告 U 节），但这**不算**真实 LLM 验证。
