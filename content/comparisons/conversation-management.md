---
id: comparisons/conversation-management
title: "跨项目对比: 对话与上下文管理"
kind: comparison
project: [opencode, codex, openclaw]
topic: conversation-management
confidence: high
sources: []
related: [opencode/architecture, codex/architecture, openclaw/architecture]
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "三个项目都实现了上下文自动压缩，但触发策略和压缩方式不同。OpenCode 在 95% 窗口使用时触发，创建摘要消息。Codex 用 inline compaction，保留系统上下文注入选项。OpenClaw 将消息分块摘要后合并，并特别保留标识符（UUID/URL/hash）。"
---

## Summary

所有 coding agent 都面临同一个问题：上下文窗口有限，但对话会不断增长。特别是 coding 场景中，工具调用的结果（代码文件、grep 输出、错误日志）极其占用 token。三个项目都实现了自动压缩，但方式各有巧妙。

## Key Insight

**上下文压缩不只是"摘要旧消息"这么简单。** 关键挑战是：压缩后 agent 还能不能继续工作？OpenClaw 的做法最有启发性——它在摘要时特别保留标识符（UUID、URL、文件 hash），因为这些是 agent 继续操作的"手柄"，丢了就断了链。

## Detail

### 压缩策略对比

| 维度 | OpenCode | Codex | OpenClaw |
|------|----------|-------|----------|
| **触发时机** | 达到 95% 上下文窗口 | 上下文填满时 | token 估算超过预算 × 安全系数 |
| **压缩方式** | LLM 生成整体摘要 | inline compaction（就地压缩） | 分块摘要后合并 |
| **摘要存储** | 新消息（SummaryMessageID 标记截断点） | 替换历史中的旧 turn | 折叠回压缩后的消息历史 |
| **系统上下文** | 保持不变 | 可选重新注入（InitialContextInjection） | 保持 + 特殊标识符保留 |
| **token 计算** | API 返回的实际用量 | 粗略估算（字节 heuristic）+ API 用量 | `estimateTokens()` 函数估算 |

### OpenCode 的实现

`agent.Summarize()` 方法（`internal/llm/agent/agent.go:535`）：

1. 获取 session 所有消息
2. 追加一条 prompt："请摘要我们的对话，重点保留：做了什么、正在做什么、哪些文件、下一步是什么"
3. 用 `summarizeProvider`（独立的 LLM provider）生成摘要
4. 将摘要存为新的 assistant 消息
5. 在 session 上标记 `SummaryMessageID`
6. 后续对话从摘要消息开始（跳过摘要之前的所有消息）

关键设计：摘要在同一个 session 中，不创建新 session。通过 `SummaryMessageID` 字段标记"从这里开始"。

配置：`autoCompact: true`（默认开启），在 95% 上下文窗口时自动触发。

### Codex 的实现

`compact.rs`（`codex-rs/core/src/compact.rs`）：

1. `run_inline_auto_compact_task()` — 异步压缩任务
2. 使用 `SUMMARIZATION_PROMPT` 模板压缩旧 turn
3. `InitialContextInjection` 枚举控制压缩后是否重新注入系统上下文
4. 支持遥测追踪：`CompactionTrigger`, `CompactionReason`, `CompactionPhase`

独特点：
- **Inline compaction** — 不是创建新消息，而是就地替换历史中的旧 turn
- **系统上下文重注入选项** — 压缩后可以重新插入系统 prompt，确保 agent 行为一致
- **细粒度遥测** — 追踪压缩的触发原因、阶段、耗时

Token 计算：
- `estimate_token_count()` — 粗略的字节级 heuristic（在 API 调用前估算）
- `set_token_usage_full()` — API 返回后记录实际用量
- `TotalTokenUsageBreakdown` — 跨 turn 的 token 使用分解

### OpenClaw 的实现

`compaction.ts`（`src/agents/compaction.ts`）：

1. 当 `estimateMessagesTokens(messages) > budget × SAFETY_MARGIN` 时触发
2. **分块策略**：将消息历史切分为 2+ 个块，按 token 份额分配
3. 对每个块独立调用 LLM 生成摘要
4. 摘要特别保留：
   - 活跃任务状态和批次进度
   - 最后一次用户请求和正在进行的操作
   - 决策和约束条件
   - **标识符（UUID、URL、hash）** — 通过 `IDENTIFIER_PRESERVATION_INSTRUCTIONS` 指导
5. 摘要合并回压缩后的消息历史

关键创新：**标识符保留指令**

普通摘要可能会丢弃看似不重要的 UUID 或文件 hash，但这些恰恰是 agent 继续操作的关键引用。OpenClaw 在摘要 prompt 中明确要求保留这些标识符。

**溢出恢复：**
- `isLikelyContextOverflowError()` — 分类 API 错误
- `extractObservedOverflowTokenCount()` — 从错误信息中提取实际 token 数
- 溢出后触发激进压缩 + 模型 failover 重试

**Compaction hooks：**
- `compaction-hooks.ts` — 压缩后触发副作用（文档索引更新、搜索索引刷新）

### Session 管理对比

| 项目 | 持久化 | Session 模型 |
|------|--------|-------------|
| OpenCode | SQLite (sqlc) | Session → Messages，支持父子 session（子 agent） |
| Codex | Log-based state DB | HistoryEntry 快照，按 log ID 检索 |
| OpenClaw | 配置文件 + session 上下文 | 轻量级 session，依赖渠道平台的消息历史 |

OpenCode 的持久化最完整——SQLite 存储所有消息，支持跨会话恢复。Codex 用 log 结构存储。OpenClaw 最轻量，部分依赖消息平台自身的历史功能。

### 如果你要实现上下文管理

**最小方案（参考 OpenCode）：**
1. 追踪每次 API 响应的 token 使用量
2. 当接近上限时，发送"请摘要"prompt
3. 用摘要替换旧消息
4. ~100 行代码

**推荐改进（借鉴 OpenClaw）：**
1. 在摘要 prompt 中加入标识符保留指令
2. 分块摘要（避免摘要本身超出上下文）
3. 溢出检测和自动恢复

## Sources

- [OpenCode internal/llm/agent/agent.go — Summarize()](https://github.com/opencode-ai/opencode/blob/main/internal/llm/agent/agent.go)
- [Codex codex-rs/core/src/compact.rs](https://github.com/openai/codex/tree/main/codex-rs/core/src/compact.rs)
- [OpenClaw src/agents/compaction.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/compaction.ts)

## Related

- [opencode/architecture](opencode/architecture.md)
- [codex/architecture](codex/architecture.md)
- [openclaw/architecture](openclaw/architecture.md)
