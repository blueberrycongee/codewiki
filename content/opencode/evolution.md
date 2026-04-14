---
id: opencode/evolution
title: "OpenCode 演进历史"
kind: evolution
project: opencode
topic: evolution
confidence: high
sources:
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/005b8ac
    ref: "005b8ac"
    relevance: "initial working agent — 项目起点"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/afd9ad0
    ref: "afd9ad0"
    relevance: "rework llm — 最大架构重构"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/cfdd687
    ref: "cfdd687"
    relevance: "add initial lsp support — 第二大变更"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/bbfa60c
    ref: "bbfa60c"
    relevance: "agent/provider reimplementation — 第三次大重构"
  - type: commit
    url: https://github.com/opencode-ai/opencode/commit/82de143
    ref: "82de143"
    relevance: "feat: themes — UI 主题系统"
related: [opencode/decision, opencode/pitfall, opencode/constraint]
compiled_at: "2026-04-14"
compiler_model: claude-opus-4-6
summary: "OpenCode 从初始 commit 到成熟项目的 7 个演进阶段，包含关键重构节点和因果链"
---

## Summary

OpenCode 在约 6 个月内（2025.03 - 2025.09）从单文件原型演进到支持 15+ LLM provider、完整 TUI、LSP 集成的 coding agent。项目经历了 3 次大规模重构，每次都是为了解决上一阶段暴露的结构性问题。

## Phase 1: 奠基（2025.03.21 - 04.02）

**关键 commit：** `005b8ac` "initial working agent"

项目最初叫 "termai"（后来改名为 opencode）。这个阶段建立了基本的 agent 骨架：
- 单一 LLM provider
- 基础的 Bubble Tea TUI
- 简单的消息收发

**代码规模：** 小，主要是验证 "Go + Bubble Tea 做 coding agent" 这个想法是否可行。

## Phase 2: LLM 架构重构（2025.03.27 - 04.11）

**关键 commit：** `afd9ad0` "rework llm" — **61 文件，+5864/-2056 行**

这是项目最关键的一次重构。原因是 Phase 1 的 LLM 集成是硬编码的，无法扩展到多个 provider。

**变更内容：**
- 建立 `Provider` interface 和工厂模式
- 统一的 `ProviderEvent` 流式协议
- Agent loop 与 provider 解耦

**因果链：** 这次重构直接催生了 Phase 4 的 provider 爆发——因为添加新 provider 变成了 "实现一个 interface" 的事情。

同期还有：
- `cfdd687` "add initial lsp support" — 47 文件，+13991 行。LSP 作为一等公民加入
- `9492394` tool 标准化 — 20 文件，统一所有 tool 的接口
- `a8d5787` 配置系统 — +911 行，支持 JSON 配置文件

## Phase 3: 架构稳定化（2025.04.22 - 04.28）

**关键 commit：** `bbfa60c` agent/provider reimplementation — **73 文件，+3595/-3879 行**

Phase 2 的快速开发留下了技术债。这个阶段是第二次大重构：
- Agent 和 Provider 的职责重新划分
- CI/CD 建立
- Provider 默认值修复
- Tool 结构清理

**同期的社区 PR：**
- PR #29: JSON Schema 配置验证
- PR #48: Kitty terminal 渲染 bug 的 hacky fix（见 pitfall 页）
- PR #37: Gemini 崩溃修复

## Phase 4: Provider 爆发（2025.04.29 - 05.15）

这是项目增长最快的阶段。得益于 Phase 2 建立的 provider 架构，15+ 个 provider 在不到三周内接入：

| Provider | 类型 | 备注 |
|----------|------|------|
| Anthropic | 原生 SDK | 主力 provider |
| OpenAI | 原生 SDK | GPT-4 系列 |
| Gemini | 原生 SDK | 需要特殊的 safe settings |
| Azure OpenAI | OpenAI 兼容 | 需要 deployment name |
| AWS Bedrock | 原生 SDK | AWS 认证链 |
| Groq | OpenAI 兼容 | 高速推理 |
| OpenRouter | OpenAI 兼容 | 模型聚合 |
| X.AI | OpenAI 兼容 | Grok 模型 |
| GitHub Copilot | 特殊实现 | 标记为 EXPERIMENTAL |
| VertexAI | 原生 SDK | Google Cloud |
| Local (Ollama) | OpenAI 兼容 | 本地模型 |

**同期其他变更：**
- `82de143` 主题系统 — 42 文件，+4595/-1923 行
- `333ea6e` diff/patch 系统 — 38 文件，+3304/-2254 行
- 图片附件支持

**因果链：** Provider 爆发暴露了兼容性问题——不同 provider 对 tool calling 的支持程度不同（见 pitfall 页），催生了 Phase 5 的稳定化工作。

## Phase 5: 质量与稳定化（2025.05.16 - 06.26）

Provider 爆发后的稳定化：
- SDK 升级：Anthropic beta → stable（PR #189，API breaking changes）
- Gemini 空消息 bug 修复（commit `18f020c`）
- 配置系统 bug 修复（PR #115, #147）
- 速率限制处理优化（commit `57a2210`, `50d8fbb`）
- 上下文窗口管理（PR #152，+537/-98 行）

**PR #189 是这个阶段最重要的变更。** Anthropic SDK 从 beta 升级到 stable v1.4.0，涉及 API breaking changes。这说明早期快速集成的代价是后续的适配成本。

## Phase 6: 高级功能（2025.06.22 - 06.25）

- GitHub Copilot 集成（PR #230，+1276/-48 行，标记 EXPERIMENTAL）
- Agent tool（子 agent）完善
- MCP 工具集成增强

## Phase 7: 长尾维护（2025.07 - 2025.09）

项目进入稳定期：
- Bug 修复为主
- 社区 PR 的选择性合并
- 大量社区 PR 被关闭未合并（见 rejected PRs 数据）

## 演进因果链总结

```
单一 provider 硬编码
    ↓ 无法扩展
Provider interface 重构 (afd9ad0)
    ↓ 添加 provider 变容易
15+ provider 快速接入
    ↓ 兼容性问题爆发
稳定化 + SDK 升级
    ↓ 基础稳定
高级功能 (Copilot, MCP)
    ↓ 功能完善
长尾维护模式
```

## 关键数字

| 指标 | 值 |
|------|-----|
| 总 commit 数 | ~185 |
| 核心贡献者 | 1（kujtimiihoxha），社区贡献者若干 |
| 大重构次数 | 3（afd9ad0, bbfa60c, cfdd687） |
| 最大单次变更 | +13991 行（LSP 集成） |
| Provider 数量 | 15+ |
| 项目更名 | termai → opencode |
