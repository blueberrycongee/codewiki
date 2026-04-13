---
id: comparisons/safety-models
title: "跨项目对比: 安全与沙箱模型"
kind: comparison
project: [opencode, codex, openclaw]
topic: safety-models
confidence: high
sources: []
related: [opencode/architecture, codex/architecture, openclaw/architecture, comparisons/tool-execution-models]
compiled_at: "2026-04-13"
compiler_model: human-assisted
summary: "安全模型差异最大：OpenCode 完全依赖运行时人工审批（无沙箱），Codex 实现了 OS 原生级三平台沙箱（Seatbelt/Landlock/Restricted Token），OpenClaw 用 Docker 容器隔离+路径校验+远程审批。"
---

## Summary

安全是 coding agent 最敏感的架构决策。agent 有能力执行任意 shell 命令、读写任意文件——如果不加约束，一次 LLM 幻觉就可能导致 `rm -rf /` 或泄露 SSH 密钥。三个项目采用了完全不同的安全策略。

## Key Insight

**安全模型的核心 trade-off 是"用户体验 vs 隔离强度"。** OpenCode 选择了最好的用户体验（无沙箱开销，直接执行后审批），Codex 选择了最强的隔离（OS 级沙箱，但配置复杂），OpenClaw 选择了中间路线（Docker 容器，开销适中但需要 Docker 环境）。

## Detail

### 安全模型一览

| 维度 | OpenCode | Codex | OpenClaw |
|------|----------|-------|----------|
| **沙箱** | 无 | OS 原生（Seatbelt/Landlock/Restricted Token） | Docker 容器 |
| **审批时机** | 执行前 | 策略自动判断 + 可选人工 | 可配置（本地/远程） |
| **文件系统隔离** | 无（全盘访问） | 策略定义的白名单路径 | 容器 bind mount 白名单 |
| **网络隔离** | 无 | 策略控制 | 容器网络配置 |
| **环境变量** | 透传 | 沙箱内受控 | 安全清洗（移除密钥） |

### OpenCode：信任用户判断

OpenCode 的安全策略最简单——**没有沙箱，完全依赖运行时审批**。

权限流程（`internal/permission/permission.go`）：
1. 工具执行前调用 `permission.Request()`
2. 构建 `PermissionRequest`（包含工具名、操作、路径）
3. 通过 pubsub 发布给 TUI
4. TUI 弹出对话框，用户选择：
   - **Allow**: 本次允许
   - **Allow Persistent**: 同 session 同工具同操作同路径永久允许
   - **Deny**: 拒绝
5. 非交互模式（`--prompt` flag）自动批准所有请求

优点：零配置、零开销、用户体验流畅
缺点：用户需要理解每个操作的风险；非交互模式下没有任何保护

### Codex：OS 原生沙箱

Codex 的沙箱系统是三个项目中最强大的，直接使用操作系统的安全原语：

**macOS — Seatbelt**
```
SandboxManager → seatbelt.rs
  → 生成 Seatbelt 配置文件（.sb）
  → sandbox-exec 启动沙箱进程
  → 进程内只能访问策略允许的路径和网络
```
Apple 的 Seatbelt 是内核级别的强制访问控制，即使 root 也无法绕过。

**Linux — Landlock + Bubblewrap**
```
SandboxManager → landlock.rs + bwrap.rs
  → Landlock LSM 限制文件系统访问
  → Bubblewrap 创建轻量级容器（namespace 隔离）
  → 双重隔离
```
Landlock 是 Linux 5.13+ 的安全模块，bwrap（Flatpak 使用的工具）提供 namespace 隔离。

**Windows — Restricted Token**
```
SandboxManager → windows-sandbox-rs/
  → 创建 restricted token（移除权限）
  → 以受限 token 启动子进程
```

**策略系统：**
- `FileSystemSandboxPolicy` — 定义哪些路径可读/可写
- `NetworkSandboxPolicy` — 定义是否允许网络访问
- `SandboxTransformRequest` — 打包命令 + 策略
- `EffectiveSandboxPermissions` — 从策略栈计算最终权限

策略驱动意味着不需要每次都问用户——安全规则预先配置好，自动执行。

### OpenClaw：Docker 容器 + 路径校验

OpenClaw 用 Docker 做隔离（`src/agents/sandbox/`）：

**三种执行目标：**
- `Host`: 直接执行（需审批）
- `Node`: JavaScript 进程级隔离
- `Docker`: 完整容器隔离

**Docker 沙箱细节：**
- 三种预设镜像（default、browser、common）
- Bind mount 安全校验（`validate-sandbox-security.ts`）：
  - 禁止挂载：`/etc`, `/root`, `/dev`, `.ssh`, `.aws`, `.docker`, `.gnupg`
  - 只允许工作目录的 bind mount
- seccomp 和 AppArmor 策略
- 网络隔离配置

**环境安全：**
- `host-env-security.ts` — 启动时清洗环境变量，移除已知的密钥和 token

**远程审批（独特特性）：**
- 审批请求可以转发到 Discord/Slack 频道
- 人类在聊天平台中审批后，agent 继续执行
- 适合 bot 运行在服务器上、用户不在终端前的场景

### 安全深度对比

```
隔离强度:
  Codex (OS 原生)  ████████████ 最强
  OpenClaw (Docker) ████████     强
  OpenCode (审批)   ████         弱（依赖人工判断）

配置复杂度:
  OpenCode          ██           最简
  OpenClaw          ██████       中等（需要 Docker）
  Codex             ████████████ 最复杂

用户体验:
  OpenCode          ████████████ 最流畅（弹窗即可）
  OpenClaw          ████████     好（自动 Docker）
  Codex             ██████       较重（沙箱启动有开销）
```

### 如果你要实现安全模型

**Phase 1（MVP）— 参考 OpenCode：**
- 实现权限审批系统
- 高危操作（bash, write）执行前弹窗确认
- 低危操作（glob, grep, read）自动批准
- 总代码量 ~120 行

**Phase 2（生产）— 参考 OpenClaw：**
- 加 Docker 沙箱
- 路径白名单校验
- 环境变量清洗
- 总代码量 ~500 行

**Phase 3（极致）— 参考 Codex：**
- OS 原生沙箱集成
- 策略驱动的自动审批
- 跨平台支持
- 总代码量 ~2000+ 行，需要深度 OS 知识

## Sources

- [OpenCode internal/permission/permission.go](https://github.com/opencode-ai/opencode/blob/main/internal/permission/permission.go)
- [Codex codex-rs/sandboxing/src/](https://github.com/openai/codex/tree/main/codex-rs/sandboxing/src)
- [OpenClaw src/agents/sandbox/](https://github.com/openclaw/openclaw/tree/main/src/agents/sandbox)

## Related

- [comparisons/tool-execution-models](comparisons/tool-execution-models.md)
- [opencode/architecture](opencode/architecture.md)
- [codex/architecture](codex/architecture.md)
- [openclaw/architecture](openclaw/architecture.md)
