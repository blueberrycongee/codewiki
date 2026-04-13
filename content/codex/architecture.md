---
id: codex/architecture
title: "Codex CLI 系统架构"
kind: architecture
project: codex
topic: architecture
confidence: high
sources:
  - type: code
    url: https://github.com/openai/codex/tree/main/codex-rs/core/src/codex.rs
    ref: codex-rs/core/src/codex.rs
    relevance: "核心 agent 编排器，session/turn 管理"
  - type: code
    url: https://github.com/openai/codex/tree/main/codex-rs/core/src/lib.rs
    ref: codex-rs/core/src/lib.rs
    relevance: "codex-core 库入口，导出 CodexThread、McpManager、sandbox 模块"
  - type: code
    url: https://github.com/openai/codex/tree/main/codex-rs/tools/src/lib.rs
    ref: codex-rs/tools/src/lib.rs
    relevance: "工具注册与定义系统"
  - type: code
    url: https://github.com/openai/codex/tree/main/codex-rs/sandboxing/src
    ref: codex-rs/sandboxing/src/
    relevance: "跨平台沙箱实现（macOS Seatbelt, Linux Landlock, Windows）"
  - type: code
    url: https://github.com/openai/codex/tree/main/codex-rs/core/src/context_manager
    ref: codex-rs/core/src/context_manager/
    relevance: "上下文管理和自动压缩"
related: [codex/tool-system, codex/conversation-loop, codex/sandbox-execution, codex/context-management, comparisons/architecture-overview]
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "Codex CLI 是 OpenAI 的 Rust 原生 coding agent，采用 Cargo workspace 多 crate 架构。核心是 submission-event 异步模式：用户提交 Op → mailbox 分发 → turn 执行 → event stream 输出。沙箱系统覆盖 macOS/Linux/Windows 三平台。"
---

## Summary

Codex CLI 是 OpenAI 官方的终端 coding agent。最初用 TypeScript 编写（codex-cli/），后来用 Rust 完全重写（codex-rs/），现已是 Rust 原生实现。架构采用 Cargo workspace 组织 50+ 个模块 crate，核心是基于 Tokio 的异步 submission-event 模式。相比 OpenCode 的同步 for 循环，Codex 的 agent loop 是完全异步、流式、事件驱动的。

## Key Insight

**Codex 最显著的架构决策是将 agent 从 TypeScript 迁移到 Rust，并采用极致的模块化。** 每个关注点（sandboxing、tools、context management、TUI）都是独立的 crate，通过明确的接口边界通信。这使得沙箱系统可以做到跨平台原生级别的隔离（macOS Seatbelt、Linux Landlock+bwrap、Windows restricted token），而不是依赖容器。

## Detail

### 整体架构

```
codex-rs/ (Cargo workspace)
│
├── cli/          ← CLI 入口，子命令分发（exec, tui, login, sandbox）
├── core/         ← 核心业务逻辑库
│   ├── codex.rs     ← Agent 编排器（submission-event 模式）
│   ├── context_manager/  ← 上下文/历史管理
│   ├── tools/       ← 工具路由和编排
│   └── compact.rs   ← 自动压缩
├── tools/        ← 工具定义和运行时
│   ├── shell.rs     ← Shell 命令执行
│   ├── apply_patch.rs ← 文件补丁
│   └── js_repl/     ← JavaScript REPL
├── sandboxing/   ← 跨平台沙箱
│   ├── seatbelt.rs  ← macOS
│   ├── landlock.rs  ← Linux
│   └── bwrap.rs     ← Linux (bubblewrap)
├── tui/          ← Ratatui 终端 UI
├── exec/         ← 无头模式（自动化用）
├── mcp-server/   ← MCP 服务端
└── exec-server/  ← 执行服务端
```

### Submission-Event 模式

Codex 的核心通信模式（`codex-rs/core/src/codex.rs`）：

```
用户操作 (Op) → submit() → Mailbox (bounded channel, cap=64)
                                ↓
                          Process Turn
                                ↓
                    Event Stream ← next_event()
```

- `Codex::spawn_internal()` — 初始化 session，创建 bounded submission channel（容量 64）和 unbounded event channel
- `Codex::submit()` — 接受用户操作（Op）
- `Codex::next_event()` — 流式输出 `ResponseEvent`

与 OpenCode 的同步 `for {}` 循环不同，Codex 完全是异步事件驱动的。所有 I/O 通过 Tokio 运行时非阻塞执行。

### Turn 执行流程

1. 收到 prompt + 上下文历史
2. 通过 `ModelClient` 调用模型 API → 返回 `ResponseStream`
3. 用 `AssistantTextStreamParser` 解析流式响应块
4. 工具调用通过 `ToolRouter` → `ToolOrchestrator` 分发
5. `ContextManager` 记录所有 items 用于历史追踪

### Provider 层

Codex 不像 OpenCode 支持 10+ 个 LLM provider。它主要面向 OpenAI 自家模型，但通过统一的 `ModelClient` 抽象也支持其他兼容 API。架构上更简洁，不需要处理大量 provider 差异。

### 工具系统

工具定义（`codex-rs/tools/src/lib.rs`）：

- `ToolDefinition` — 统一的工具规格接口
- `ToolSpec` 变体：`Function`, `Freeform`, `DynamicTool`, `McpTool`
- `ToolRegistryPlan` — 声明可用工具，MCP 工具支持延迟加载

执行管线：
1. **Router** (`router.rs`) — 按名称路由工具调用
2. **Orchestrator** (`orchestrator.rs`) — 审批 → 沙箱选择 → 执行 → 重试
3. **Runtimes** — 后端特定处理：`shell.rs`（shell 命令）、`apply_patch.rs`（文件补丁）、`js_repl/`（JS REPL）

### 沙箱系统（最大亮点）

Codex 的沙箱是三个项目中最强大的，原生级别跨平台支持：

| 平台 | 实现 | 机制 |
|------|------|------|
| macOS | `seatbelt.rs` | Apple Seatbelt 沙箱配置文件 |
| Linux | `landlock.rs` + `bwrap.rs` | Landlock LSM + Bubblewrap 容器 |
| Windows | `windows-sandbox-rs/` | Restricted token 隔离 |

策略系统：
- `FileSystemSandboxPolicy` — 文件系统访问控制
- `NetworkSandboxPolicy` — 网络访问控制
- `SandboxTransformRequest` — 将命令+策略打包提交给执行器
- `EffectiveSandboxPermissions` — 从策略栈计算实际权限

### 数据持久化

- 基于 log 的历史存储（state DB）
- `HistoryEntry` — 单条记录快照
- `message_history.rs` — 按 log ID + offset 检索

### 演进轨迹

1. **v0: TypeScript CLI** (`codex-cli/`) — 最初的实现，Node.js + React Ink TUI
2. **v1: Rust 重写** (`codex-rs/`) — 完全用 Rust 重写核心，保留 JS shim 作为入口
3. **v2: 多 crate 模块化** — 拆分为 50+ 个独立 crate
4. **v3: 原生沙箱** — 实现三平台原生沙箱（非容器化）

## Sources

- [codex-rs/core/src/codex.rs](https://github.com/openai/codex/tree/main/codex-rs/core/src/codex.rs) — Agent 编排器
- [codex-rs/tools/src/lib.rs](https://github.com/openai/codex/tree/main/codex-rs/tools/src/lib.rs) — 工具系统
- [codex-rs/sandboxing/src/](https://github.com/openai/codex/tree/main/codex-rs/sandboxing/src) — 跨平台沙箱
- [codex-rs/core/src/context_manager/](https://github.com/openai/codex/tree/main/codex-rs/core/src/context_manager) — 上下文管理

## Related

- [codex/tool-system](codex/tool-system.md)
- [codex/conversation-loop](codex/conversation-loop.md)
- [codex/sandbox-execution](codex/sandbox-execution.md)
- [comparisons/architecture-overview](comparisons/architecture-overview.md)
