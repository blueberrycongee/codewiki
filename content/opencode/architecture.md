---
id: opencode/architecture
title: "OpenCode 系统架构"
kind: architecture
project: opencode
topic: architecture
confidence: high
sources:
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/app/app.go
    ref: internal/app/app.go
    relevance: "应用入口，组装所有核心服务"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/agent.go
    ref: internal/llm/agent/agent.go
    relevance: "Agent 核心循环实现"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/tools.go
    ref: internal/llm/agent/tools.go
    relevance: "工具注册列表，区分 Coder 和 Task agent 的工具集"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/provider/provider.go
    ref: internal/llm/provider/provider.go
    relevance: "多 Provider 抽象层，统一 LLM 接口"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/tools/tools.go
    ref: internal/llm/tools/tools.go
    relevance: "BaseTool 接口定义"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/permission/permission.go
    ref: internal/permission/permission.go
    relevance: "权限系统：工具执行前的用户授权机制"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/005b8ac
    ref: "005b8ac"
    relevance: "initial working agent — 首个可工作的 agent 实现"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/afd9ad0
    ref: "afd9ad0"
    relevance: "rework llm — LLM 层重构"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/cfdd687
    ref: "cfdd687"
    relevance: "add initial lsp support — 引入 LSP 集成"
related:
  - opencode/tool-system
  - opencode/conversation-loop
  - opencode/context-management
  - comparisons/architecture-overview
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "OpenCode 是一个 Go 编写的终端 AI coding agent，采用分层架构：App 层组装服务 → Agent 层驱动 LLM 循环 → Provider 层抽象多模型 → Tool 层提供文件/代码操作能力。"
---

## Summary

OpenCode 是一个用 Go 编写的终端 AI coding agent，提供 TUI 交互界面。其架构遵循清晰的分层设计：顶层 App 负责服务组装和生命周期管理，Agent 层实现核心的 LLM 对话循环（包括工具调用），Provider 层抽象了 10+ 个 LLM 供应商的差异，Tool 层提供文件操作、代码搜索、命令执行等能力。权限系统在工具执行前拦截，通过 pubsub 机制与 TUI 层交互获取用户授权。

## Key Insight

**OpenCode 的核心设计选择是"Agent 即循环"**：`agent.processGeneration()` 方法实现了一个 `for {}` 无限循环，不断地发送消息给 LLM → 处理流式响应 → 执行工具调用 → 将工具结果追加到消息历史 → 再次发送，直到 LLM 返回非工具调用的终止响应。这个循环是整个系统的心跳。

## Detail

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│  main.go → cmd/root.go                              │
│  CLI 入口，解析参数，初始化数据库                        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  App (internal/app/app.go)                          │
│  服务组装：Sessions + Messages + History + Permissions │
│  + CoderAgent + LSPClients                          │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌─────────────┐ ┌───────────┐ ┌──────────┐
│ Agent 层     │ │ TUI 层     │ │ LSP 层    │
│ 驱动 LLM 循环│ │ Bubble Tea │ │ 代码诊断   │
└──────┬──────┘ └───────────┘ └──────────┘
       │
  ┌────┼────┐
  ▼         ▼
┌───────┐ ┌───────┐
│Provider│ │ Tools │
│多模型抽象│ │文件/代码│
└───────┘ └───────┘
```

### App 层：服务组装

`App` 结构体（`internal/app/app.go:25`）是整个应用的容器，负责：

1. 初始化数据库连接（SQLite，通过 `sqlc` 生成的类型安全查询）
2. 创建 Session、Message、History 服务
3. 创建 Permission 服务
4. 在后台初始化 LSP 客户端
5. 组装 CoderAgent，注入所有依赖

关键代码路径：`main.go` → `cmd/root.go` → `app.New(ctx, conn)` → `agent.NewAgent()`

### Agent 层：两种 Agent

OpenCode 有两种 Agent，工具集不同：

| Agent | 用途 | 工具集 |
|-------|------|--------|
| **CoderAgent** | 主 agent，完整能力 | Bash, Edit, Fetch, Glob, Grep, Ls, Sourcegraph, View, Patch, Write, Agent(子agent), MCP tools, Diagnostics |
| **TaskAgent** | 子 agent，只读探索 | Glob, Grep, Ls, Sourcegraph, View |

这个设计值得注意：CoderAgent 可以通过 `AgentTool` 启动子 agent（TaskAgent），子 agent 只有只读工具，不能修改文件。这实现了**安全的并行探索**——主 agent 可以同时启动多个子 agent 搜索代码，而不用担心子 agent 意外修改文件。

子 agent 的实现（`internal/llm/agent/agent-tool.go`）：
- 创建一个新的 TaskAgent 实例
- 创建一个关联的 TaskSession（用 tool call ID 作为 session ID）
- 运行 agent 直到完成，返回结果给父 agent
- 子 agent 的 token 成本会累计到父 session

### Provider 层：统一多模型接口

`Provider` 接口（`internal/llm/provider/provider.go:53`）定义了两个核心方法：
- `SendMessages()` — 同步发送，用于标题生成和摘要
- `StreamResponse()` — 流式响应，用于主对话循环

通过 Go 泛型 `baseProvider[C ProviderClient]` 实现了一个优雅的多 provider 抽象。支持的 provider：Anthropic, OpenAI, Gemini, Bedrock, Groq, Azure, VertexAI, OpenRouter, XAI, Copilot, Local。

有趣的细节：Groq、OpenRouter、XAI、Local 都复用了 `OpenAIClient`，只是修改 base URL。这体现了 OpenAI 兼容 API 已经成为事实标准。

### Tool 层：BaseTool 接口

所有工具实现统一接口（`internal/llm/tools/tools.go:69`）：

```go
type BaseTool interface {
    Info() ToolInfo        // 返回名称、描述、参数 schema
    Run(ctx context.Context, params ToolCall) (ToolResponse, error)
}
```

工具通过 `context.Context` 传递 session ID 和 message ID。工具响应支持文本和图片两种类型。

### 权限系统

权限系统（`internal/permission/permission.go`）在工具执行前拦截：

1. 工具调用 `permission.Request()` 请求授权
2. 通过 pubsub 机制将请求发布给 TUI 层
3. TUI 弹出权限对话框
4. 用户批准/拒绝后通过 channel 返回结果
5. 支持 session 级别的持久授权（同一 session 同一工具同一操作不重复询问）
6. 非交互模式下支持自动批准（`AutoApproveSession`）

### 上下文管理

OpenCode 实现了自动压缩（Auto Compact）：
- 监控 token 使用量
- 当达到模型上下文窗口 95% 时自动触发摘要
- 由 `summarizeProvider` 生成对话摘要
- 摘要存储为新消息，后续对话从摘要开始继续
- 保留在同一 session 中（通过 `SummaryMessageID` 字段标记截断点）

### 数据持久化

使用 SQLite + sqlc 方案：
- `sqlc.yaml` 定义 SQL → Go 代码生成规则
- `internal/db/sql/` 目录下是原始 SQL 查询
- 生成的代码在 `internal/db/` 下
- 三个核心表：sessions, messages, files（变更追踪）

### 演进轨迹

从 git history 可以看到清晰的演进路线：

1. **v0: 基础骨架**（`initial` → `initial agent setup`）— CLI + 基本 TUI
2. **v1: 核心 Agent**（`initial working agent` → `additional tools`）— Agent 循环 + 基础工具
3. **v2: LLM 重构**（`rework llm`）— 抽象 Provider 层，支持多模型
4. **v3: LSP 集成**（`add initial lsp support`）— 代码诊断能力
5. **v4: 工具扩展**（`add sourcegraph tool` → `add copilot provider`）— 持续丰富工具和 provider

## Sources

- [internal/app/app.go](https://github.com/opencode-ai/opencode/blob/main/internal/app/app.go) — 应用入口和服务组装
- [internal/llm/agent/agent.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/agent.go) — Agent 核心循环
- [internal/llm/agent/tools.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/tools.go) — Coder vs Task agent 工具集
- [internal/llm/agent/agent-tool.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/agent-tool.go) — 子 Agent 工具实现
- [internal/llm/provider/provider.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/provider/provider.go) — 多 Provider 抽象
- [internal/llm/tools/tools.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/tools/tools.go) — BaseTool 接口
- [internal/permission/permission.go](https://github.com/opencode-ai/opencode/blob/main/internal/permission/permission.go) — 权限系统

## Related

- [opencode/tool-system](opencode/tool-system.md) — 工具系统详解
- [opencode/conversation-loop](opencode/conversation-loop.md) — Agent 循环机制深入
- [opencode/context-management](opencode/context-management.md) — 上下文窗口管理
- [comparisons/architecture-overview](comparisons/architecture-overview.md) — 跨项目架构对比
