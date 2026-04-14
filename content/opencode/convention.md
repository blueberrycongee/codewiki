---
id: opencode/convention
title: "OpenCode 编码惯例"
kind: convention
project: opencode
topic: convention
confidence: high
sources:
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/tools/tools.go
    ref: "internal/llm/tools/tools.go"
    relevance: "BaseTool interface 定义了所有 tool 的标准模式"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/pubsub/broker.go
    ref: "internal/pubsub/broker.go"
    relevance: "Pub/Sub 泛型模式，所有服务通信的标准方式"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/llm/provider/provider.go
    ref: "internal/llm/provider/provider.go"
    relevance: "Provider Options 模式"
  - type: code
    url: https://github.com/opencode-ai/opencode/blob/main/internal/session/session.go
    ref: "internal/session/session.go"
    relevance: "Service interface 标准模式"
related: [opencode/constraint, opencode/decision]
compiled_at: "2026-04-14"
compiler_model: claude-opus-4-6
summary: "在 OpenCode 代码库中写代码时应遵循的模式和惯例"
---

## Summary

这些是 OpenCode 代码库中反复出现的模式。遵循它们可以写出与现有代码一致的新代码；不遵循会导致风格不统一，增加维护负担。

## CV1: Service Interface 模式

每个领域服务都定义为 interface，有一个私有 struct 实现：

```go
// 公开 interface
type Service interface {
    Create(ctx context.Context, ...) (Entity, error)
    Get(ctx context.Context, id string) (Entity, error)
    List(ctx context.Context) ([]Entity, error)
    // ...
}

// 私有实现
type service struct {
    db   *db.DB
    // 其他依赖
    *pubsub.Broker[Entity]  // 嵌入 pub/sub
}

// 构造函数返回 interface
func NewService(db *db.DB) Service {
    return &service{
        db:     db,
        Broker: pubsub.NewBroker[Entity](),
    }
}
```

**应用场景：** session.Service, message.Service, permission.Service, agent.Service, history.Service

**要点：**
- 构造函数返回 interface 而不是 struct
- 嵌入 `*pubsub.Broker[T]` 让服务自动获得事件发布能力
- 所有方法第一个参数是 `context.Context`

## CV2: Tool 实现模式

所有 tool 遵循相同的结构：

```go
type myTool struct {
    permissions permission.Service  // 如果需要审批
    lspClients  map[string]*lsp.Client  // 如果涉及文件
    history     history.Service     // 如果修改文件
}

func NewMyTool(perms permission.Service, ...) tools.BaseTool {
    return &myTool{permissions: perms, ...}
}

func (t *myTool) Info() tools.ToolInfo {
    return tools.ToolInfo{
        Name:        "my_tool",
        Description: "对 LLM 的使用说明",
        Parameters: map[string]any{
            "type": "object",
            "properties": map[string]any{
                "param1": map[string]any{
                    "type":        "string",
                    "description": "参数说明",
                },
            },
        },
        Required: []string{"param1"},
    }
}

func (t *myTool) Run(ctx context.Context, call tools.ToolCall) (tools.ToolResponse, error) {
    // 1. 解析参数
    var params struct {
        Param1 string `json:"param1"`
    }
    json.Unmarshal([]byte(call.Input), &params)

    // 2. 获取 session context
    sessionID, messageID := tools.GetContextValues(ctx)

    // 3. 权限检查（如果需要）
    if !t.permissions.Request(permission.CreatePermissionRequest{
        SessionID:   sessionID,
        ToolName:    "my_tool",
        Description: "具体操作描述",
        Action:      "execute",
    }) {
        return tools.ToolResponse{}, permission.ErrorPermissionDenied
    }

    // 4. 执行操作
    result, err := doSomething(params.Param1)
    if err != nil {
        return tools.NewTextErrorResponse(err.Error()), nil
    }

    // 5. 返回结果（可选带 metadata）
    return tools.NewTextResponse(result), nil
}
```

**注意：**
- tool 错误通过 `NewTextErrorResponse` 返回，不是 Go error —— 这样 agent 能看到错误信息并重试
- 只有 `ErrorPermissionDenied` 通过 Go error 返回，因为它需要特殊处理（停止同轮其他 tool）

## CV3: Provider Options 模式

创建 provider 时使用函数式选项：

```go
type ProviderClientOption func(*providerClientOptions)

func WithAPIKey(key string) ProviderClientOption {
    return func(o *providerClientOptions) { o.apiKey = key }
}

func WithSystemMessage(msg string) ProviderClientOption {
    return func(o *providerClientOptions) { o.systemMessage = msg }
}

// 使用
provider := NewProvider(modelProvider,
    WithAPIKey(key),
    WithModel(model),
    WithSystemMessage(systemPrompt),
)
```

## CV4: Context 传值模式

跨层传递元数据用 `context.WithValue`，不用函数参数：

```go
// 定义 key（避免冲突）
type contextKey string
const SessionIDContextKey contextKey = "session_id"

// 设置
ctx = context.WithValue(ctx, SessionIDContextKey, sessionID)

// 读取
func GetContextValues(ctx context.Context) (string, string) {
    sessionID, _ := ctx.Value(SessionIDContextKey).(string)
    messageID, _ := ctx.Value(MessageIDContextKey).(string)
    return sessionID, messageID
}
```

**注意：** 类型断言用 comma-ok 模式，不 panic。

## CV5: 错误处理模式

- **Sentinel errors** 用于可恢复的已知错误：
```go
var ErrSessionBusy = errors.New("session is currently processing")
var ErrorPermissionDenied = errors.New("permission denied")
```

- 检查用 `errors.Is()`：
```go
if errors.Is(err, permission.ErrorPermissionDenied) {
    // 特殊处理
}
```

- Tool 执行错误**不**返回 Go error，而是返回 `IsError: true` 的 ToolResponse，让 LLM 自己处理

## CV6: Pub/Sub 事件模式

状态变更通过 pub/sub 通知：

```go
// 创建后发布
entity, err := s.create(ctx, ...)
if err == nil {
    s.Publish(pubsub.CreatedEvent, entity)
}

// 更新后发布
s.Publish(pubsub.UpdatedEvent, entity)

// 消费者订阅
ch := service.Subscribe(ctx)
for event := range ch {
    switch event.Type {
    case pubsub.CreatedEvent: // ...
    case pubsub.UpdatedEvent: // ...
    }
}
```

## CV7: 并发模式

- **`sync.Map`** 用于读多写少的并发映射（activeRequests、LSP clients）
- **`sync.RWMutex`** 用于 pub/sub subscribers
- **`sync.WaitGroup`** 用于等待 goroutine 组完成（shutdown）
- **Channel** 用于 goroutine 间通信（permission response、agent events）
- **Context cancellation** 用于协作式取消

不要用 bare goroutine 不带 recovery：
```go
go func() {
    defer logging.RecoverPanic("context description", nil)
    // ...
}()
```

## CV8: 文件操作后通知 LSP

修改文件的 tool（edit、write、patch）在写入文件后**必须**通知 LSP 客户端：

```go
// 写入文件后
if client, ok := t.lspClients[ext]; ok {
    diagnostics := client.NotifyDidChange(filePath)
    // 把诊断信息附加到返回结果
}
```

这让 LLM 能在同一轮就看到编译错误，不需要额外的 "检查" 步骤。

## CV9: 配置使用 Viper

配置加载遵循固定优先级：
```
默认值 < 全局配置(~/.opencode) < 本地配置(.opencode) < 环境变量(OPENCODE_*) < CLI flag
```

添加新配置项时：
1. 在 `Config` struct 中添加字段
2. 在 `Load()` 中设置默认值
3. 环境变量前缀统一用 `OPENCODE_`

## CV10: 日志格式

使用 `log/slog` 的结构化日志：

```go
logging.Info("operation completed", "key1", value1, "key2", value2)
logging.Error("operation failed", "error", err, "context", ctx)
```

- 自动附加 file:line 来源
- 持久日志（显示在 TUI 中）用 `InfoPersist` / `ErrorPersist`
- Debug 模式下写入 `~/.opencode/debug.log`
