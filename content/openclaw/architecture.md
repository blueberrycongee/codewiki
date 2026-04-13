---
id: openclaw/architecture
title: "OpenClaw 系统架构"
kind: architecture
project: openclaw
topic: architecture
confidence: high
sources:
  - type: code
    url: https://github.com/openclaw/openclaw/blob/main/src/entry.ts
    ref: src/entry.ts
    relevance: "CLI 启动入口，环境初始化"
  - type: code
    url: https://github.com/openclaw/openclaw/blob/main/src/agents/agent-command.ts
    ref: src/agents/agent-command.ts
    relevance: "核心 agent 执行编排器（760+ 行）"
  - type: code
    url: https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/run.ts
    ref: src/agents/pi-embedded-runner/run.ts
    relevance: "嵌入式 PI agent 运行器，主 LLM 对话循环"
  - type: code
    url: https://github.com/openclaw/openclaw/blob/main/src/agents/pi-tools.ts
    ref: src/agents/pi-tools.ts
    relevance: "工具组装和定义"
  - type: code
    url: https://github.com/openclaw/openclaw/blob/main/src/agents/compaction.ts
    ref: src/agents/compaction.ts
    relevance: "上下文压缩策略"
  - type: code
    url: https://github.com/openclaw/openclaw/blob/main/src/agents/sandbox/
    ref: src/agents/sandbox/
    relevance: "Docker 沙箱和安全校验"
related: [openclaw/tool-system, openclaw/conversation-loop, openclaw/sandbox-execution, openclaw/context-management, comparisons/architecture-overview]
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "OpenClaw 是一个 TypeScript 编写的通用 AI agent 框架，核心差异点是多消息渠道支持（Discord/Slack/Telegram/Signal/iMessage 等）。架构围绕 gateway → channel → agent 三层展开，PI agent 核心循环支持 failover、Docker 沙箱、插件系统。"
---

## Summary

OpenClaw（原名 Clawdbot）是一个 TypeScript 编写的开源 AI agent 框架，由 PSPDFKit 创始人 Peter Steinberger 创建。与 OpenCode 和 Codex 专注于终端 coding 不同，OpenClaw 的核心差异是**多消息渠道支持**——同一个 agent 可以通过 Discord、Slack、Telegram、Signal、iMessage、WhatsApp 等平台与用户交互。架构围绕 gateway（控制平面） → channel（通信层） → agent（执行层）三层展开。

## Key Insight

**OpenClaw 的核心架构选择是"渠道无关的 agent"。** agent 核心循环（PI runner）不关心消息从哪个平台来，gateway 层负责将不同平台的消息格式统一为 `AgentMessage`。这使得同一套工具、权限、沙箱逻辑可以在所有渠道复用。对于 coding agent 开发者来说，这个模式值得参考——如果你未来要把 agent 从 CLI 扩展到 IDE 插件或 Web 界面，渠道抽象是必需的。

## Detail

### 整体架构

```
src/
├── entry.ts          ← CLI 启动入口
├── cli/
│   ├── run-main.js   ← 主运行入口
│   └── commands/     ← 子命令：agent, gateway, onboard, config
│
├── gateway/          ← 控制平面：渠道管理、插件路由、生命周期
├── channels/         ← 消息渠道适配器
│   ├── discord/
│   ├── slack/
│   ├── telegram/
│   ├── signal/
│   ├── imessage/
│   └── ...
│
├── agents/           ← Agent 核心
│   ├── agent-command.ts       ← 执行编排器
│   ├── pi-embedded-runner/    ← PI agent 主循环
│   ├── pi-tools.ts            ← 工具组装
│   ├── compaction.ts          ← 上下文压缩
│   └── sandbox/               ← Docker 沙箱
│
├── plugins/          ← 插件系统（发现、加载、注册）
├── config/           ← 配置管理（含 session、approval 配置）
└── infra/            ← 基础设施（exec-approvals、安全、日志）
```

### Gateway → Channel → Agent 三层

```
消息平台 (Discord/Slack/...)
        ↓
   Channel 适配器        ← 消息格式转换
        ↓
   Gateway 控制平面      ← 路由、插件、生命周期
        ↓
   Agent Command        ← 会话解析、模型选择、workspace 准备
        ↓
   PI Embedded Runner   ← 核心 LLM 循环
```

1. **Channel 层**：每个平台一个适配器，将平台特有的消息格式转换为统一的 `AgentMessage`
2. **Gateway 层**：管理所有渠道的生命周期，路由消息到正确的 agent，管理插件
3. **Agent 层**：`agent-command.ts`（760+ 行）负责解析配置、选择模型、准备工作空间，然后委托给 `PI Embedded Runner` 执行实际的 LLM 循环

### PI Agent 核心循环

PI（Personal Intelligence）是 OpenClaw 的 agent 核心（`src/agents/pi-embedded-runner/run.ts`）：

1. **Setup**: 解析模型、认证、消息 payload、上下文窗口
2. **Backend Call**: `runEmbeddedAttemptWithBackend()` — 调用 LLM，处理流式响应
3. **Tool Dispatch**: LLM 返回 `tool_use` → 执行工具
4. **Failover**: 认证错误、限流、上下文溢出 → 用 fallback 模型重试
5. **Compaction**: 上下文超限时 `generateSummary()` 压缩历史
6. **Result Delivery**: 将响应格式化后发送到对应渠道

关键抽象：
- `ExtensionContext` — session 状态、消息历史、模型配置
- `UsageAccumulator` — token 追踪，用于 failover 决策

### 工具系统

工具组装在 `src/agents/pi-tools.ts`：

- **Core Tools**: `read`, `write`, `apply_patch`（文件 I/O）
- **Exec Tools**: `exec`, `process`（shell 命令，通过 `bash-tools.exec.ts`）
- **Channel Tools**: 消息发送、线程管理（渠道特定）
- **Web Search**: 原生或 provider-based 搜索
- **MCP/Plugin Tools**: 从注册的插件动态加载

工具 schema 用 Zod 定义（`pi-tools.schema.ts`），支持参数校验和延迟加载。

执行管线有多层 wrapper：
1. Abort signal 处理（`pi-tools.abort.ts`）
2. Before-call hooks（`pi-tools.before-tool-call.ts`）
3. 参数校验
4. 沙箱路由（host/node/docker）

### 沙箱系统

三种执行目标：

| 目标 | 说明 | 隔离级别 |
|------|------|---------|
| **Host** | 直接 shell 执行（需审批） | 无隔离 |
| **Node** | JavaScript only | 进程级 |
| **Docker** | 完整容器隔离 | 容器级 |

Docker 沙箱（`src/agents/sandbox/`）：
- 镜像选择：有 default、browser、common 三种预设镜像
- 路径校验：`validate-sandbox-security.ts` 禁止挂载危险路径（`/etc`, `/root`, `.ssh`, `.aws`, `.docker`）
- 网络隔离和 seccomp/AppArmor 策略

审批机制（`src/config/types.approvals.ts`）：
- `ExecApprovalForwardingConfig` — 将执行请求转发到 Discord/Slack 渠道等待人工审批
- 内置 CLI 交互式审批
- 每 session 可绑定不同的审批配置

### 插件系统（独特特性）

OpenClaw 有完整的插件系统（`src/plugins/`）：
- 插件发现和 manifest 解析
- 运行时加载和注册
- 全局 hook runner（`hook-runner-global.ts`）
- Plugin SDK（`src/plugin-sdk/`）提供公开接口

这是三个项目中唯一有正式插件系统的。

### 演进轨迹

1. **2025.11**: 以 Clawdbot 名称发布
2. **2026.01.27**: 因 Anthropic 商标投诉改名 Moltbot
3. **2026.01.30**: 再改名 OpenClaw
4. **2026.02.14**: 创始人宣布加入 OpenAI，项目转交非营利基金会

60 天内达到 247k+ GitHub stars，增长速度极快。

## Sources

- [src/entry.ts](https://github.com/openclaw/openclaw/blob/main/src/entry.ts) — 启动入口
- [src/agents/agent-command.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/agent-command.ts) — Agent 编排器
- [src/agents/pi-embedded-runner/run.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/run.ts) — 核心循环
- [src/agents/pi-tools.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-tools.ts) — 工具系统
- [src/agents/compaction.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/compaction.ts) — 上下文压缩

## Related

- [openclaw/tool-system](openclaw/tool-system.md)
- [openclaw/conversation-loop](openclaw/conversation-loop.md)
- [comparisons/architecture-overview](comparisons/architecture-overview.md)
