# CodeWiki

> **⚠️ 架构持续演进中** — 当前架构是早期 MVP，随时可能发生大规模重构。请勿将现有架构视为最终设计。

LLM 编译的代码知识库 —— 分析开源 coding agent 项目的架构、设计决策和演进历史，通过 MCP 提供给你的 AI 助手使用。

> 灵感来自 [Karpathy 的 LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：知识应该被编译一次、持续更新，而不是每次查询时重新推导。

## 这是什么？

当你想构建一个 coding agent，你可能会去看 Claude Code、Codex、OpenClaw 的源码。但源码只是冰山水面上的部分 —— 真正有价值的知识藏在：

- **为什么**这样设计，而不是别的方案？
- 这个架构**怎么演变**过来的？
- 不同项目面对同一问题时，**各自怎么做**的？
- 什么路**走不通**？

CodeWiki 把这些知识从 git history、PR、issue、源码中**提炼编译**成结构化的 wiki 页面，然后通过 MCP Server 让你的 AI 助手直接查阅。

## 知识分层

代码 wiki 的核心目标是**辅助代码演进**——不管是人还是 AI agent 在写代码，软件演进的规律不变：理解上下文 → 做出变更 → 验证影响。最贵的环节永远是理解上下文，而代码本身只描述"是什么"，不描述"为什么"和"曾经怎样"。

CodeWiki 的知识按五个层次组织，每层记录不同性质的知识：

| 层 | 回答的问题 | 特性 |
|----|-----------|------|
| **Decision** | 为什么选了 A 不选 B？当时有什么约束？ | 一旦记录就稳定，除非被新决策推翻 |
| **Evolution** | 什么变了？为什么变？影响了什么？ | 只追加不修改，记录变化间的因果链 |
| **Constraint** | 改代码时不能破坏什么？ | 最关键，必须准确，直接影响变更安全性 |
| **Pitfall** | 什么路走不通？为什么失败？ | 只追加，防止重蹈覆辙 |
| **Convention** | 这个项目里怎么做事？ | 模式和惯例，不遵循会写出不一致的代码 |

这五层不依赖特定语言、框架或项目类型。代码结构（structure）不在其中——结构直接从源码读取即可，维护一份描述反而容易过时。

## 与 Zread 等工具的区别

| | Zread / 代码浏览工具 | CodeWiki |
|---|---|---|
| 内容 | 原始代码的搜索和浏览 | LLM 编译后的结构化知识 |
| 密度 | 等于直接看 GitHub | 从 git 演进中提炼的高密度知识 |
| 跨项目 | 一次看一个仓库 | 跨项目综合对比 |
| 视角 | 当前代码快照 | 架构演进、设计决策、反模式 |

## 分析的项目

| 项目 | 语言 | 简介 |
|------|------|------|
| [OpenCode](https://github.com/opencode-ai/opencode) | Go | 终端 AI coding agent，Bubble Tea TUI |
| [Codex CLI](https://github.com/openai/codex) | Rust（从 TS 迁移） | OpenAI 官方终端 coding agent |
| [OpenClaw](https://github.com/openclaw/openclaw) | TypeScript | 多渠道 AI agent 框架 |

## Wiki 内容

### 项目架构（3 篇）

每个项目一篇架构深度分析，包含组件图、核心循环、工具系统、数据流。

### 跨项目对比（5 篇）

| 主题 | 内容 |
|------|------|
| **架构概览** | 三个项目的架构哲学：简洁单体 vs 性能极致 vs 扩展性优先 |
| **工具执行模型** | 工具接口定义、注册方式、执行管线、审批机制的对比 |
| **安全与沙箱** | 无沙箱/OS 原生沙箱/Docker 容器三种安全模型的 trade-off |
| **对话与上下文管理** | 上下文压缩策略、token 追踪、session 管理的差异 |
| **语言选择** | Go/Rust/TypeScript 如何塑造架构形态，Codex 从 TS 迁移到 Rust 的实际案例 |

每篇对比页都包含：方案对比表、共同模式、差异分析、trade-off 讨论和实施建议。

## 使用方式

### 作为 MCP Server（推荐）

在你的 Claude Code 或其他 MCP 兼容客户端配置中添加：

```json
{
  "mcpServers": {
    "codewiki": {
      "command": "npx",
      "args": ["tsx", "/你的路径/codewiki/src/server/index.ts"]
    }
  }
}
```

配置好后，你的 AI 助手就能使用以下工具：

| 工具 | 用途 | 示例 |
|------|------|------|
| `codewiki_discover` | 浏览和搜索 wiki | "有什么关于 coding agent 的参考？" |
| `codewiki_read` | 阅读完整页面 | "让我看看 OpenCode 的架构" |
| `codewiki_compare` | 跨项目对比 | "工具分发各家怎么做的？" |
| `codewiki_deep_dive` | 深入某个细节 | "权限系统具体怎么实现的？" |
| `codewiki_trace_evolution` | 追踪演进历史 | "这个功能是怎么演变过来的？" |

### 直接阅读

所有 wiki 页面都是 Markdown 文件，在 [`content/`](./content/) 目录下，可以直接阅读。

## 本地开发

```bash
# 安装依赖
npm install

# 拉取项目数据（git log, PR, issue）
npm run fetch                    # 全部项目
npm run fetch -- opencode        # 单个项目

# 过滤高价值内容（需要 ANTHROPIC_API_KEY）
npm run filter

# LLM 编译 wiki 页面（需要 ANTHROPIC_API_KEY）
npm run compile

# 启动 MCP Server
npm run serve
```

## 架构

```
codewiki/
├── src/
│   ├── pipeline/          # 数据管道
│   │   ├── fetch.ts       #   拉取 git log, PR, issue
│   │   ├── filter.ts      #   Haiku 打分过滤高价值内容
│   │   └── compile.ts     #   Sonnet 两阶段编译
│   ├── wiki/              # Wiki 内容层
│   │   ├── schema.ts      #   页面结构定义（Zod）
│   │   └── index.ts       #   搜索/读取
│   └── server/            # MCP Server
│       ├── index.ts       #   stdio transport 入口
│       └── tools.ts       #   5 个工具定义
├── content/               # 编译产物（wiki 页面）
└── .cache/                # 原始数据缓存（gitignored）
```

### 编译管道

```
Stage 1: Fetch
  克隆仓库 → 提取 git log → 拉取 PR/issue

Stage 2: Filter（Haiku）
  批量对 commit/PR 打分 → 筛选高价值内容（score >= 7）

Stage 3: Compile（Sonnet，两阶段）
  提取带来源引用的事实 → 组织成结构化 wiki 页面

Stage 4: Index
  生成全局索引和分类
```

两阶段编译的设计是为了解决引用准确性问题：先强制 LLM 提取带精确来源的事实，再从事实组织成文章。

### Wiki 页面结构

每个页面包含 YAML frontmatter（元数据、来源引用、置信度标注）和 Markdown 正文：

```markdown
---
id: opencode/architecture
title: "OpenCode 系统架构"
kind: architecture
confidence: high
sources:
  - type: code
    url: https://github.com/...
    ref: internal/app/app.go
    relevance: "应用入口，组装所有核心服务"
---

## Summary
## Key Insight
## Detail
## Sources
## Related
```

每条知识都标注了来源和置信度，可溯源验证。

## 许可

MIT
