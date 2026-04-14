---
id: opencode/constraint
title: "OpenCode 约束与不可变规则"
kind: constraint
project: opencode
topic: constraint
confidence: high
sources:
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/agent.go
    ref: "internal/llm/agent/agent.go"
    relevance: "Agent 核心循环，定义了 tool dispatch 和权限检查的不可变流程"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/provider/provider.go
    ref: "internal/llm/provider/provider.go"
    relevance: "Provider interface 定义，所有 provider 必须实现"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/tools/tools.go
    ref: "internal/llm/tools/tools.go"
    relevance: "BaseTool interface，所有 tool 必须实现"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/permission/permission.go
    ref: "internal/permission/permission.go"
    relevance: "Permission 系统，阻塞式审批流程"
related: [opencode/decision, opencode/convention, opencode/pitfall]
compiled_at: "2026-04-14"
compiler_model: claude-opus-4-6
summary: "修改 OpenCode 代码时必须遵守的约束和不可变规则"
---

## Summary

这些是修改 OpenCode 代码时**不能违反**的规则。违反它们会导致崩溃、安全漏洞、或架构退化。

## C1: Agent Loop 的终止条件不能改

Agent 循环的唯一退出条件是 LLM 返回 `EndTurn` 或 `MaxTokens`。如果 LLM 返回 `ToolUse`，**必须**执行 tool 并继续循环。

```go
// 这个逻辑不能改
for {
    response := streamAndHandleEvents()
    if response.FinishReason == EndTurn || response.FinishReason == MaxTokens {
        break
    }
    // ToolUse → 执行 tool → 继续循环
}
```

**为什么：** 如果在 tool use 时提前退出，LLM 会处于不一致状态——它认为 tool 已执行但实际没有。下次对话会产生幻觉。

## C2: Permission 检查必须在 Tool 内部

每个需要权限的 tool **自己**调用 `permissions.Request()`。不能在 agent loop 的 dispatch 层统一拦截。

**为什么：** 不同 tool 需要不同的权限粒度。BashTool 需要展示命令内容，EditTool 需要展示 diff 预览，FetchTool 需要展示 URL。这些信息只有 tool 自己知道。

**推论：** 添加新 tool 时，如果它执行有副作用的操作（写文件、执行命令、网络请求），**必须**在 `Run()` 里调用 `permissions.Request()`。

## C3: PermissionDenied 必须停止当前轮所有 tool

当任何一个 tool 返回 `permission.ErrorPermissionDenied` 时，agent 必须停止执行同一轮中剩余的所有 tool call。

**为什么：** LLM 在一轮中可能发出多个 tool call（如 "先读文件 A，再改文件 B"）。如果用户拒绝了"改文件 B"，继续执行后续操作可能造成不一致状态。

## C4: Message Parts 是多态 JSON，不能改序列化格式

`message.Parts` 字段存储为 JSON 数组，包含多种类型（TextContent、ToolCall、ToolResult、BinaryContent 等），通过 `isPart()` marker interface 区分。

**为什么：** 
- SQLite 中已经存储了大量历史消息，改格式会破坏向后兼容
- Provider 层依赖这个格式来构造 API 请求
- TUI 依赖这个格式来渲染消息

**添加新的 Part 类型时：** 必须在序列化/反序列化逻辑中同时处理，否则旧数据会解析失败。

## C5: Provider 必须实现完整的 ProviderEvent 流

新增 provider **必须**发射正确顺序的 `ProviderEvent`：

```
EventContentStart
  → EventContentDelta (0 到多次)
  → EventToolUseStart (0 到多次)
    → EventToolUseDelta (0 到多次)
  → EventToolUseStop
→ EventComplete (恰好 1 次)
```

**为什么：** Agent loop 依赖这个事件顺序来构建消息。如果顺序错误（比如 `ToolUseStop` 在 `ToolUseStart` 之前），会导致 nil pointer panic 或消息损坏。

**特别注意：** `EventComplete` 必须在最后，且必须包含 `FinishReason`。缺少它会导致 agent loop 永远不退出。

## C6: Context 传递 SessionID 和 MessageID

Tool 执行时，context 中**必须**包含 `SessionIDContextKey` 和 `MessageIDContextKey`。

```go
ctx = context.WithValue(ctx, tools.SessionIDContextKey, sessionID)
ctx = context.WithValue(ctx, tools.MessageIDContextKey, messageID)
```

**为什么：** Tool 实现（特别是 AgentTool、EditTool）需要这些值来：
- 关联文件修改到正确的 session
- 创建子 session（task agent）
- 记录文件版本历史

## C7: Pub/Sub channel 容量必须 > 0

所有 pub/sub subscription channel 的 buffer 容量当前是 100。**不能**设为 0（无缓冲）。

**为什么：** Agent 发布事件的 goroutine 和 TUI 消费事件的 goroutine 不同步。无缓冲 channel 会导致 agent 阻塞在发布上，等待 TUI 处理，严重降低 agent 性能。

## C8: LSP 客户端必须在 goroutine 中运行

LSP 客户端的初始化和运行**必须**在单独的 goroutine 中。`sync.Map` 管理客户端实例。

**为什么：** LSP server 启动慢（几秒到几十秒），如果在主 goroutine 中阻塞，会延迟 TUI 启动和用户交互。

## C9: Shutdown 顺序不能乱

```
1. Cancel LSP watchers
2. Wait for watchers (WaitGroup)
3. Shutdown LSP clients (5 秒超时)
4. Cancel subscriptions
5. Cancel TUI message handler
6. Wait for handler (超时)
7. Close channels
```

**为什么：** LSP 客户端可能正在处理文件变更通知。不先停 watcher 就停客户端，会导致 watcher 向已关闭的客户端发消息，触发 panic。

## C10: 文件操作 tool 必须记录 history

EditTool、WriteTool、PatchTool 修改文件时**必须**通过 `history.Service` 记录修改前的内容。

**为什么：** 这是用户恢复误操作的唯一途径。如果不记录，文件被 LLM 改坏后无法恢复。
