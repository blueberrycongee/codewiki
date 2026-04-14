---
id: opencode/decision
title: "OpenCode 关键设计决策"
kind: decision
project: opencode
topic: decision
confidence: high
sources:
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/afd9ad0
    ref: "afd9ad0"
    relevance: "rework llm — 建立 provider 插件架构，61 文件变更"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/9492394
    ref: "9492394"
    relevance: "tool 标准化重构，统一 20 个文件的接口"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/cfdd687
    ref: "cfdd687"
    relevance: "add initial lsp support — 47 文件 +13991 行"
  - type: pr
    url: https://github.com/opencode-ai/opencode/pull/189
    ref: "PR #189"
    relevance: "Anthropic SDK 从 beta 升级到 stable，API breaking changes"
  - type: pr
    url: https://github.com/opencode-ai/opencode/pull/230
    ref: "PR #230"
    relevance: "GitHub Copilot 集成，标记为 EXPERIMENTAL"
  - type: pr
    url: https://github.com/opencode-ai/opencode/pull/155
    ref: "PR #155"
    relevance: "本地模型支持，暴露 tool calling 兼容性问题"
related: [opencode/evolution, opencode/constraint, opencode/convention]
compiled_at: "2026-04-14"
compiler_model: claude-opus-4-6
summary: "OpenCode 项目中 7 个关键架构决策的背景、权衡和后果"
---

## Summary

OpenCode 从 2025 年 3 月的初始 commit 到成熟项目，经历了若干关键设计决策。这些决策塑造了项目今天的形态，理解它们对于安全地修改代码至关重要。

## 决策 1：Go 语言 + 同步 Agent Loop

**选择：** 用 Go 写 coding agent，agent 核心循环用同步 `for {}` 而非 async event-driven。

**背景：** 同期的 Codex 选了 Rust（async event-driven），OpenClaw 选了 TypeScript（async + failover）。

**理由：**
- Go 的 goroutine 模型天然支持并发（LSP、pubsub、TUI 各跑各的），核心 loop 本身不需要 async
- 单二进制部署，`go install` 即可，无需 node_modules 或 cargo build
- Agent loop 的瓶颈在 LLM API 延迟，不在 CPU，Go 的性能足够
- 代码简洁：核心 loop 是 `for { streamAndHandleEvents(); if endTurn { break } }`

**后果：**
- 代码可读性高，新贡献者容易理解
- 但 Go 缺乏 sum types，消息的 `ContentPart` 多态用 interface marker (`isPart()`) 实现，不如 Rust enum 安全
- 错误处理大量 `if err != nil`，没有 Rust 的 `?` 运算符

## 决策 2：Provider 插件架构

**选择：** 把 LLM provider 抽象为 `Provider` interface，通过工厂函数按 `ModelProvider` 枚举创建。

**关键 commit：** `afd9ad0` "rework llm" — 61 文件，+5864/-2056 行。这是项目最大的一次架构变更。

**理由：**
- 用户需要多 provider 支持（Anthropic、OpenAI、Gemini、Azure、Bedrock、Groq、OpenRouter、Copilot...）
- 大量 provider 是 OpenAI 兼容的，可以复用同一个客户端实现
- 统一的 `ProviderEvent` 流式接口让 agent loop 不关心底层 provider

**接口设计：**
```go
type Provider interface {
    SendMessages(ctx, messages, tools) (*ProviderResponse, error)
    StreamResponse(ctx, messages, tools) <-chan ProviderEvent
    Model() models.Model
}
```

**后果：**
- 从 1 个 provider 扩展到 15+ 个，核心代码几乎不变
- 但每个 provider 的实现细节差异很大（Anthropic 有 extended thinking，Gemini 需要 safe settings，Azure 需要 deployment name），导致 provider 层积累了大量条件逻辑
- OpenAI 兼容 provider（Groq、OpenRouter、XAI、Local）复用同一个 `openai.go`，通过 `baseURL` 区分

## 决策 3：Tool 标准化接口

**选择：** 所有 tool 实现 `BaseTool` interface：`Info() ToolInfo` + `Run(ctx, ToolCall) (ToolResponse, error)`。

**关键 commit：** `9492394` — 20 文件，+1057/-757 行。

**理由：**
- Agent loop 需要一个统一的方式调用任意 tool
- Tool 的参数通过 JSON Schema 描述，LLM 生成 JSON 输入
- `ToolResponse` 统一返回 text 或 image，加可选的 metadata（diff 信息等）

**设计细节：**
- 权限控制注入到 tool 构造函数中，而不是在 dispatch 层统一拦截
- 每个 tool 自己决定是否需要权限请求
- 修改文件的 tool（edit、write、patch）还注入了 `history.Service` 做版本追踪和 `lsp.Client` 做诊断

**后果：**
- 添加新 tool 非常简单：实现两个方法即可
- MCP tool 也通过同一个接口桥接进来
- 但权限逻辑分散在各个 tool 内部，没有统一的审计点

## 决策 4：SQLite 持久化 + sqlc 代码生成

**选择：** 用 SQLite 存储 sessions 和 messages，用 sqlc 从 SQL 文件生成类型安全的 Go 代码。

**理由：**
- 单文件数据库，零配置，符合 Go 单二进制的设计哲学
- sqlc 生成的代码比 ORM 更透明，SQL 就是 SQL，没有抽象层
- 三张核心表：sessions、messages、files，足够覆盖所有需求

**Schema：**
```sql
sessions: id, parent_session_id, title, message_count, prompt_tokens, completion_tokens, cost, summary_message_id
messages: id, session_id, role, parts(JSON), model, created_at, finished_at
files: id, session_id, file_path, content, version
```

**后果：**
- 消息的 `parts` 字段是 JSON 数组（多态 content parts），查询和过滤不方便
- 但简洁性很好，不需要额外的数据库进程
- goose 做 migration 管理

## 决策 5：Pub/Sub 事件总线

**选择：** 用泛型 `Broker[T]` 实现进程内 pub/sub，所有服务通过事件通信。

**理由：**
- TUI 需要实时更新（新消息、权限请求、agent 状态变化）
- 直接调用会产生循环依赖（agent → TUI → agent）
- Pub/sub 解耦了生产者和消费者

**实现：**
```go
type Broker[T any] struct {
    subs map[chan Event[T]]struct{}
    mu   sync.RWMutex
}
```
- 100 容量的 buffer channel，非阻塞发布（慢消费者会丢事件）
- Session、Message、Permission、Agent、Logging 各有自己的 broker

**后果：**
- TUI 订阅所有 broker，在 goroutine 中接收事件并转发给 Bubble Tea
- 2 秒超时防止阻塞
- 但事件丢失可能导致 UI 状态不一致（实践中几乎不会触发）

## 决策 6：Permission 系统用阻塞式通道

**选择：** `permissions.Request()` 阻塞当前 goroutine 直到用户在 TUI 中点击 Allow/Deny。

**理由：**
- Tool 执行是同步的，permission check 自然是同步的
- 通过 pub/sub 把请求发给 TUI，TUI 响应后通过 channel 返回结果
- 支持 session 级别的持久授权（"Allow Persistent"）

**后果：**
- 非交互模式（`-p` flag）需要 `AutoApproveSession()` 绕过
- 如果 TUI 挂了，permission 请求会永远阻塞 —— 但 context cancellation 会兜底
- 没有细粒度的 policy 配置（不像 Codex 的 `SandboxPolicy`），完全依赖用户实时判断

## 决策 7：LSP 集成作为一等公民

**关键 commit：** `cfdd687` "add initial lsp support" — 47 文件，+13991/-451 行。这是项目第二大的变更。

**选择：** 内置 LSP 客户端，tool 执行后自动收集诊断信息返回给 LLM。

**理由：**
- 修改文件后立即获得编译错误/类型错误反馈，LLM 可以自动修复
- 比 "改完跑一次 build" 更快的反馈循环

**后果：**
- 每个语言的 LSP server 在单独 goroutine 中运行，通过 `sync.Map` 管理
- File watcher 持续监控工作区
- 但 LSP 启动慢，可能在 agent 开始工作时还没准备好
- 崩溃后自动重启
