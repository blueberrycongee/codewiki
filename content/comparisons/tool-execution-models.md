---
id: comparisons/tool-execution-models
title: "跨项目对比: 工具执行模型"
kind: comparison
project: [opencode, codex, openclaw]
topic: tool-execution-models
confidence: high
sources: []
related: [opencode/architecture, codex/architecture, openclaw/architecture]
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "三个项目的工具系统复杂度递增：OpenCode 用简单接口+硬编码列表，Codex 用 Router→Orchestrator→Runtime 三层管线，OpenClaw 用多层 wrapper+动态组装。核心差异在于审批机制和沙箱集成的深度。"
---

## Summary

工具系统是 coding agent 最关键的子系统之一——它决定了 agent 能做什么、怎么做、以及做的过程中如何保证安全。三个项目的工具系统复杂度和设计哲学差异巨大。

## Key Insight

**工具系统的核心 trade-off 是"简单性 vs 安全性"。** OpenCode 选择了极简工具接口 + 运行时权限审批（简单但依赖用户判断），Codex 选择了三层管线 + OS 级沙箱（复杂但强制安全），OpenClaw 选择了多层 wrapper + Docker 隔离（灵活但有容器开销）。

## Detail

### 工具接口定义

**OpenCode — 最简单**
```go
type BaseTool interface {
    Info() ToolInfo         // 名称、描述、参数 JSON schema
    Run(ctx context.Context, params ToolCall) (ToolResponse, error)
}
```
两个方法，就这么多。`ToolInfo` 返回名称、描述、参数 schema。`Run` 执行并返回文本或图片结果。

**Codex — 类型丰富**
```rust
ToolSpec 变体: Function | Freeform | DynamicTool | McpTool
ToolDefinition: 统一工具规格
ToolRegistryPlan: 声明式工具注册，支持延迟加载
```
多种工具类型，MCP 工具支持延迟加载（不需要在启动时就加载所有 MCP 工具）。

**OpenClaw — Zod Schema 驱动**
```typescript
// pi-tools.schema.ts
工具参数用 Zod 定义，运行时自动校验
支持 lazy loading（重型工具如 exec 延迟加载）
```

### 工具注册方式

| 项目 | 方式 | 代码 |
|------|------|------|
| OpenCode | 硬编码列表 | `CoderAgentTools()` 返回 `[]BaseTool` 切片 |
| Codex | RegistryPlan | `ToolRegistryPlan` 声明后延迟实例化 |
| OpenClaw | 多源动态组装 | Core + Exec + Channel + Plugin 分层拼接 |

OpenCode 的方式：
```go
func CoderAgentTools(...) []tools.BaseTool {
    return append(
        []tools.BaseTool{
            tools.NewBashTool(permissions),
            tools.NewEditTool(...),
            tools.NewGlobTool(),
            tools.NewGrepTool(),
            // ... 静态列表
        }, otherTools...)  // MCP 工具追加在后面
}
```

OpenClaw 的方式——工具来自多个来源：
1. Core tools（read/write/apply_patch）
2. Exec tools（bash/shell）
3. Channel-specific tools（各渠道的消息发送）
4. Plugin tools（运行时从插件加载）
5. MCP tools

### 工具执行管线

这是三个项目差异最大的地方：

**OpenCode — 直接执行**
```
LLM 返回 tool_use
  → 遍历 a.tools 匹配名称
  → 如果需要权限 → permission.Request() → 等待用户审批
  → tool.Run(ctx, toolCall)
  → 返回结果
```
没有中间层，没有 orchestrator。直接匹配、直接执行。权限检查在各个工具的 Run() 内部自己做。

**Codex — 三层管线**
```
LLM 返回 tool_use
  → ToolRouter: 按名称路由到正确的 runtime
  → ToolOrchestrator:
      1. 检查是否需要审批（ExecPolicyManager）
      2. 选择沙箱类型（SandboxManager）
      3. 构建 SandboxTransformRequest（命令 + 策略）
      4. 执行
      5. 如果失败 → 重试逻辑
  → Runtime: shell.rs / apply_patch.rs / js_repl/
  → 返回结果
```
审批、沙箱选择、执行、重试都是分离的关注点。

**OpenClaw — 多层 Wrapper**
```
LLM 返回 tool_use
  → Abort signal handler（可取消）
  → Before-call hooks（预处理）
  → Parameter validation（Zod 校验）
  → Policy check（pi-tools.policy.ts）
  → Approval gate（如果配置了）
     → 可以转发到 Discord/Slack 等渠道等待人工审批
  → Sandbox routing（host/node/docker）
  → 执行
  → Result formatting
  → 返回结果
```
每一步都是可插拔的 wrapper。

### 审批机制对比

| 项目 | 审批方式 | 粒度 |
|------|---------|------|
| OpenCode | TUI 内弹窗 | 工具+操作+路径，session 内持久 |
| Codex | ExecPolicyManager 规则 + 可选人工确认 | 基于策略规则自动判断 |
| OpenClaw | 可转发到消息平台 | session 级配置，支持远程审批 |

OpenCode 最简单：用户在终端弹窗里点"允许"。同一 session 同一工具同一操作同一路径不重复询问。

Codex 最自动化：`ExecPolicyManager` 根据配置文件中的规则自动判断是否需要审批。`default_exec_approval_requirement()` 计算审批需求。

OpenClaw 最灵活：审批请求可以转发到 Discord 或 Slack 频道，由远程的人类审批。这对 7×24 运行的 bot 场景很有价值。

### 内置工具集对比

| 工具 | OpenCode | Codex | OpenClaw |
|------|----------|-------|----------|
| Bash/Shell | ✅ | ✅ | ✅ |
| 文件读取 | View | ✅ | read |
| 文件写入 | Write | apply_patch | write |
| 文件编辑 | Edit + Patch | apply_patch | apply_patch |
| 文件搜索 | Glob + Grep | ✅ | ✅ |
| 目录列表 | Ls | ✅ | ✅ |
| 网络请求 | Fetch | ✅ | ✅ |
| 代码搜索 | Sourcegraph | — | Web Search |
| LSP 诊断 | Diagnostics | — | — |
| 子 Agent | Agent tool | — | 子 agent |
| JS REPL | — | js_repl | — |

独特工具：
- OpenCode 有 **Sourcegraph 集成**和 **LSP Diagnostics**
- Codex 有 **JS REPL**
- OpenClaw 有 **Channel-specific tools**（消息发送/线程管理）

### 如果你要实现工具系统

**最小可行方案（参考 OpenCode）：**
1. 定义 `Tool` 接口：`info() + run()`
2. 硬编码工具列表
3. LLM 返回工具调用时遍历匹配执行
4. 权限检查在 run() 内部
5. 总代码量 < 200 行

**生产级方案（参考 Codex）：**
1. 工具注册表 + 延迟加载
2. Router → Orchestrator → Runtime 分层
3. 审批和沙箱作为 Orchestrator 的责任
4. 重试逻辑
5. 总代码量 ~2000+ 行

## Sources

- [OpenCode internal/llm/tools/tools.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/tools/tools.go)
- [OpenCode internal/llm/agent/tools.go](https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/tools.go)
- [Codex codex-rs/tools/src/lib.rs](https://github.com/openai/codex/tree/main/codex-rs/tools/src/lib.rs)
- [OpenClaw src/agents/pi-tools.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-tools.ts)

## Related

- [opencode/architecture](opencode/architecture.md)
- [codex/architecture](codex/architecture.md)
- [openclaw/architecture](openclaw/architecture.md)
