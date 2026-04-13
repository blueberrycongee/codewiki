---
id: comparisons/architecture-overview
title: "跨项目对比: 架构概览"
kind: comparison
project: [opencode, codex, openclaw]
topic: architecture-overview
confidence: high
sources: []
related: [opencode/architecture, codex/architecture, openclaw/architecture]
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "三个 coding agent 的架构哲学截然不同：OpenCode 用 Go 追求简洁单体，Codex 用 Rust 追求性能和安全极致，OpenClaw 用 TypeScript 追求扩展性和多渠道。核心 agent 循环模式也各异。"
---

## Summary

OpenCode、Codex CLI、OpenClaw 三个项目都是开源 coding agent，但架构哲学完全不同。这个对比帮助你理解：在构建自己的 coding agent 时，不同的技术选择会导致什么样的架构形态和 trade-off。

## Key Insight

**三个项目代表了 coding agent 架构的三个方向：简洁单体（OpenCode）、性能极致（Codex）、扩展性优先（OpenClaw）。** 没有绝对的优劣，选择取决于你的核心约束是什么。

## Detail

### 一览对比

| 维度 | OpenCode | Codex CLI | OpenClaw |
|------|----------|-----------|----------|
| **语言** | Go | Rust（从 TS 迁移） | TypeScript |
| **代码量** | ~160 文件 | 500+ 文件，50+ crate | 500+ 文件 |
| **架构风格** | 分层单体 | 模块化 workspace | 三层网关架构 |
| **Agent 循环** | 同步 for 循环 | 异步 submission-event | 异步 + failover |
| **UI** | Bubble Tea TUI | Ratatui TUI | 多渠道（Discord/Slack/CLI） |
| **LLM Provider** | 10+ providers | 主要 OpenAI | 多 provider + failover |
| **沙箱** | 无（靠权限审批） | 原生 OS 级沙箱 | Docker 容器 |
| **插件系统** | MCP 工具 | MCP 工具 | 完整插件 SDK |
| **持久化** | SQLite (sqlc) | Log-based state DB | 配置文件 + session |

### Agent 循环模式对比

这是最核心的架构差异：

**OpenCode — 同步阻塞循环**
```go
// agent.go: processGeneration()
for {
    agentMessage, toolResults, err := a.streamAndHandleEvents(ctx, sessionID, msgHistory)
    if toolResults != nil {
        msgHistory = append(msgHistory, agentMessage, *toolResults)
        continue  // 继续循环
    }
    return AgentEvent{...}  // 结束
}
```
特点：极其简单直观。一个 goroutine 里的无限循环，stream → 执行工具 → 追加消息 → 再次 stream。Go 的 goroutine 模型让这种同步写法也不会阻塞其他操作。

**Codex — 异步事件流**
```
Op → submit() → Mailbox (bounded, cap=64) → Process Turn → Event Stream
```
特点：完全解耦。提交操作和接收事件通过 channel 分离。Tokio 异步运行时驱动。适合需要高并发和精细控制的场景，但复杂度显著更高。

**OpenClaw — 异步 + 自动 Failover**
```
runEmbeddedAttemptWithBackend()
  → 调用 LLM
  → 如果 auth 错误/限流/上下文溢出
  → 自动切换 fallback 模型重试
  → 如果上下文超限 → 压缩后重试
```
特点：不只是执行循环，还内置了韧性逻辑。支持模型 failover、自动降级、上下文溢出恢复。适合需要 7×24 运行的场景（作为消息平台 bot）。

### 语言选择的 Trade-off

**Go（OpenCode）**
- 优点：编译快、部署简单（单二进制）、goroutine 天然并发、学习曲线平缓
- 缺点：错误处理冗长、缺乏泛型表达力（Go 1.18+ 有限改善）、难以做深度 OS 集成
- 适合：想快速出 MVP、团队以后端为主

**Rust（Codex）**
- 优点：性能极致、内存安全、可以做 OS 级沙箱集成（直接调用 seatbelt/landlock syscall）、强类型保证
- 缺点：开发速度慢、学习曲线陡峭、async Rust 复杂度高
- 适合：对安全和性能有极高要求、团队有 Rust 经验

**TypeScript（OpenClaw）**
- 优点：开发速度快、生态丰富（npm）、容易做 UI/渠道集成、社区贡献门槛低
- 缺点：运行时性能、类型系统相对弱、原生 OS 集成困难
- 适合：需要快速迭代、需要浏览器/UI 集成、需要广泛社区参与

### 工具注册模式对比

| 模式 | 项目 | 实现 |
|------|------|------|
| **硬编码列表** | OpenCode | `CoderAgentTools()` 返回固定的工具切片 |
| **Registry + 延迟加载** | Codex | `ToolRegistryPlan` 声明工具，MCP 工具延迟加载 |
| **分层组装** | OpenClaw | Core + Exec + Channel + Plugin tools 多层组装 |

OpenCode 最简单——一个函数返回所有工具。Codex 引入了 RegistryPlan 概念支持延迟加载。OpenClaw 最灵活——工具来源多样（内置 + 渠道特定 + 插件），运行时动态组装。

### 子 Agent 模式

三个项目都支持子 agent，但方式不同：

- **OpenCode**: `AgentTool` 创建 `TaskAgent`（只读工具集），子 agent 有独立 session，成本累计到父 session
- **Codex**: 通过 crate 级别隔离，子任务在独立的 turn 中执行
- **OpenClaw**: `pi-tools.policy.ts` 定义子 agent 限制策略，通过 `ExtensionContext` 传递权限约束

### 可扩展性对比

```
OpenCode:  MCP 工具扩展（外部进程）
           ↑ 最小扩展面

Codex:     MCP 工具 + 自定义 crate
           ↑ 中等扩展面

OpenClaw:  Plugin SDK + MCP + Channel 插件 + Hook 系统
           ↑ 最大扩展面
```

### 如果你要从零构建

| 你的约束 | 推荐参考 |
|---------|---------|
| 想 2 周内出 MVP | OpenCode（Go 简洁，架构直观） |
| 安全是第一优先级 | Codex（OS 级沙箱，Rust 内存安全） |
| 需要多平台/多渠道 | OpenClaw（gateway 架构，渠道抽象） |
| 团队只会 TypeScript | OpenClaw |
| 需要高性能/低延迟 | Codex |

## Sources

- [OpenCode internal/app/app.go](https://github.com/opencode-ai/opencode/blob/main/internal/app/app.go)
- [Codex codex-rs/core/src/codex.rs](https://github.com/openai/codex/tree/main/codex-rs/core/src/codex.rs)
- [OpenClaw src/agents/agent-command.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/agent-command.ts)

## Related

- [opencode/architecture](opencode/architecture.md)
- [codex/architecture](codex/architecture.md)
- [openclaw/architecture](openclaw/architecture.md)
