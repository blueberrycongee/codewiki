# CodeWiki Index

> LLM-compiled knowledge base for coding agent patterns.
> 8 pages across 3 projects.

## Codex

- **[Codex CLI 系统架构](codex/architecture.md)** (architecture, high) — Codex CLI 是 OpenAI 的 Rust 原生 coding agent，采用 Cargo workspace 多 crate 架构。核心是 submission-event 异步模式：用户提交 Op → mailbox 分发 → turn 执行 → event stream 输出。沙箱系统覆盖 macOS/Linux/Windows 三平台。

## OpenClaw

- **[OpenClaw 系统架构](openclaw/architecture.md)** (architecture, high) — OpenClaw 是一个 TypeScript 编写的通用 AI agent 框架，核心差异点是多消息渠道支持（Discord/Slack/Telegram/Signal/iMessage 等）。架构围绕 gateway → channel → agent 三层展开，PI agent 核心循环支持 failover、Docker 沙箱、插件系统。

## OpenCode

- **[OpenCode 系统架构](opencode/architecture.md)** (architecture, high) — OpenCode 是一个 Go 编写的终端 AI coding agent，采用分层架构：App 层组装服务 → Agent 层驱动 LLM 循环 → Provider 层抽象多模型 → Tool 层提供文件/代码操作能力。

## Cross-Project Comparisons

- **[跨项目对比: 架构概览](comparisons/architecture-overview.md)** — 三个 coding agent 的架构哲学截然不同：OpenCode 用 Go 追求简洁单体，Codex 用 Rust 追求性能和安全极致，OpenClaw 用 TypeScript 追求扩展性和多渠道。核心 agent 循环模式也各异。
- **[跨项目对比: 对话与上下文管理](comparisons/conversation-management.md)** — 三个项目都实现了上下文自动压缩，但触发策略和压缩方式不同。OpenCode 在 95% 窗口使用时触发，创建摘要消息。Codex 用 inline compaction，保留系统上下文注入选项。OpenClaw 将消息分块摘要后合并，并特别保留标识符（UUID/URL/hash）。
- **[跨项目对比: 语言选择与 Trade-off](comparisons/language-tradeoffs.md)** — Go（OpenCode）适合快速出 MVP，单二进制部署简单；Rust（Codex）适合需要 OS 级安全集成和极致性能的场景，但开发成本高；TypeScript（OpenClaw）适合需要广泛生态和快速迭代的场景，社区贡献门槛最低。Codex 从 TS→Rust 的迁移是最佳实际案例。
- **[跨项目对比: 安全与沙箱模型](comparisons/safety-models.md)** — 安全模型差异最大：OpenCode 完全依赖运行时人工审批（无沙箱），Codex 实现了 OS 原生级三平台沙箱（Seatbelt/Landlock/Restricted Token），OpenClaw 用 Docker 容器隔离+路径校验+远程审批。
- **[跨项目对比: 工具执行模型](comparisons/tool-execution-models.md)** — 三个项目的工具系统复杂度递增：OpenCode 用简单接口+硬编码列表，Codex 用 Router→Orchestrator→Runtime 三层管线，OpenClaw 用多层 wrapper+动态组装。核心差异在于审批机制和沙箱集成的深度。
