---
id: opencode/pitfall
title: "OpenCode 踩坑记录"
kind: pitfall
project: opencode
topic: pitfall
confidence: high
sources:
  - type: issue
    url: https://github.com/opencode-ai/opencode/issues/300
    ref: "Issue #300"
    relevance: "Gemini 空消息 bug"
  - type: issue
    url: https://github.com/opencode-ai/opencode/issues/326
    ref: "Issue #326"
    relevance: "本地模型 tool calling 不兼容"
  - type: issue
    url: https://github.com/opencode-ai/opencode/issues/319
    ref: "Issue #319"
    relevance: "agent coder not found 安装失败"
  - type: pr
    url: https://github.com/opencode-ai/opencode/pull/48
    ref: "PR #48"
    relevance: "Kitty terminal hacky fix"
  - type: pr
    url: https://github.com/opencode-ai/opencode/pull/152
    ref: "PR #152"
    relevance: "上下文窗口溢出处理"
  - type: pr
    url: https://github.com/opencode-ai/opencode/pull/271
    ref: "PR #271"
    relevance: "ripgrep 单文件不输出文件名"
related: [opencode/constraint, opencode/decision, opencode/evolution]
compiled_at: "2026-04-14"
compiler_model: claude-opus-4-6
summary: "OpenCode 开发过程中踩过的坑、失败的方案和非显而易见的 bug"
---

## Summary

这些是 OpenCode 项目实际遇到过的问题。它们的价值不在于具体的修复（修复已经在代码里了），而在于**揭示了哪些地方容易出错、为什么出错**。

## P1: Provider 兼容性不是"实现 interface"就够了

**问题：** Phase 4 快速接入 15+ provider 后，发现 "OpenAI 兼容" 并不等于 "完全兼容"。

**具体案例：**
- **DeepSeek R1（Ollama）不支持 tool calling**（Issue #326）— 用户配置了本地模型，agent 发起 tool call 后直接报错。没有 graceful fallback
- **Gemini 拒绝空消息**（Issue #300，commit `18f020c`）— Anthropic 和 OpenAI 允许空 content 的 assistant message，Gemini 不允许。需要在 provider 层过滤
- **Azure 需要 deployment name**（Issue #302）— 不能直接用 model ID，需要映射到 Azure 的 deployment name
- **Groq 对 reasoning_effort 参数报错**（Issue #220）— 不是所有 OpenAI 兼容 API 都支持所有参数

**教训：** 每个新 provider 都需要单独的集成测试。"OpenAI 兼容" 只是起点，不是终点。Provider 层需要更多的防御性代码。

## P2: Kitty Terminal 渲染 Bug — Hacky Fix 的代价

**问题：** Kitty terminal 中打开模态框（权限弹窗等）时，ANSI 转义码被重复输出，导致渲染混乱。

**PR #48 的 "hacky fix"：**
```go
// 用 bytes.ReplaceAll 移除重复的转义码
// PR 作者原话："This is a really hacky fix"
```

**为什么 hack：** Bubble Tea 框架在某些 terminal 中的渲染行为不一致。根本修复需要修改框架本身（PR #46 尝试升级 Bubble Tea 但被推迟）。

**教训：** Terminal 兼容性问题很难彻底解决。Mac 内置 Terminal 也有颜色问题（只支持 ANSI 256 色，不支持 true color）。社区 PR #269 尝试检测颜色能力但未被合并。

## P3: "agent coder not found" 安装失败

**问题：** 多个用户报告安装后无法启动，错误信息 "Error: agent coder not found"。（Issues #319, #298, #193, #303, #291, #293）

**根因：** 配置加载时 agent 配置缺失或验证失败，但错误信息不明确。可能的触发条件：
- 配置文件格式错误
- 环境变量与配置文件冲突（Issue #304: `.env` 优先级高于配置文件）
- Viper 字符串比较 bug（PR #147）

**教训：** 安装体验 = 第一印象。配置错误应该给出具体的修复建议，不是一个模糊的 "not found"。

## P4: 速率限制处理的多次迭代

**问题：** Anthropic API 的 429（rate limit）和 529（overloaded）响应需要不同的处理策略。

**演变：**
- 第一版（PR #22）：简单重试
- 第二版（commit `57a2210`）：指数退避
- 第三版（commit `50d8fbb`）：区分 429 和 529，不同的退避策略

**教训：** Rate limiting 看似简单，但生产环境中的细节很多。不要一开始就想做"完美"的重试，从简单开始迭代。

## P5: 上下文窗口溢出不是 Graceful 的

**问题：** 长对话超过模型的 context window 后，API 直接报错。

**PR #152（+537/-98 行）的修复：** 
- 追踪 token 使用量
- 在 95% 时触发自动压缩（summarize）
- 但压缩本身也需要 token budget，如果已经到了 100%，压缩请求本身也会失败

**教训：** Token budget 管理需要预留空间给 "管理操作本身"。95% 阈值是经验值，但在长 tool output（如大文件内容）的场景下可能不够。

## P6: ripgrep 行为在单文件时不同

**问题：** GrepTool 调用 ripgrep 搜索时，如果目标是单个文件（而不是目录），ripgrep 默认不输出文件名。

**commit `f0571f5`，PR #271 的修复：** 强制加 `--with-filename` 参数。

**教训：** CLI 工具的默认行为在不同输入模式下可能不同。LLM 需要稳定一致的输出格式来解析结果。

## P7: MCP Server 的 nil Required Fields

**问题：** 某些 MCP server 的 tool schema 中 `required` 字段为 nil（不是空数组），导致 JSON 序列化后发给 LLM 时格式不对。

**commit `1f6eef4`，PR #278 的修复：** 对 nil 做防御性处理，转为空数组。

**教训：** 外部依赖（MCP server 由第三方实现）的输出不可信。每个字段都需要防御性检查。

## P8: 配置合并逻辑的陷阱

**问题：** Viper 的配置合并在 "全局配置 + 本地配置" 场景下行为不符合预期。

**PR #115 的修复：** "tweak the logic in config to ensure env vs file configurations merge properly"。

**PR #147 的另一个 bug：** Viper 的字符串比较导致某些配置项不生效。

**教训：** 配置系统看似简单，但 "多层覆盖"（默认值 → 全局配置 → 本地配置 → 环境变量 → CLI flag）的优先级逻辑很容易出错。测试每一层的覆盖行为。

## P9: 社区 PR 质量参差不齐

**数据：** 大量社区 PR 被关闭未合并（约 35 个 closed-not-merged）。

**常见问题：**
- 空 body，没有说明（PR #338, #107）
- AI 生成的 PR，质量不够（PR #195 "Jules was unable to complete the task in time"）
- 修改了不相关的东西（PR #350 "Github open-source codes"）
- 方向不对（PR #233 "Phase2 agentic cli" — 被关闭）

**教训：** 开源项目的维护成本不只是代码审查。大量低质量 PR 消耗维护者精力。

## P10: 安全问题 — Auth 数据明文存储

**Issue #343：** 认证数据以明文存储。这是一个已知但未修复的安全问题。

**教训：** Coding agent 天然有高权限（读写文件、执行命令），安全问题的影响面比普通应用更大。
