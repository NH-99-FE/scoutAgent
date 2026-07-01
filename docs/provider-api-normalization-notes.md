# Scout 供应商 API 差异统一学习笔记

本文记录 Scout 如何把不同供应商的原始接口 JSON 统一成 AI 层的标准类型。重点不是“怎么调通接口”，而是解释为什么上层只需要面对 `Context`、`AssistantMessageEvent` 和 `AssistantMessage`，而不用关心 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 的细节差异。

## 1. 统一目标

Scout 的 AI 层把三类 API 协议视为不同的 `api`：

```ts
type KnownApi =
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages';
```

`provider` 表示真实供应商或接入域，比如当前 Scout 内置的 `openai`、`anthropic`，以及未来可能扩展的 `qwen`、`deepseek`、`openrouter` 等。`api` 决定使用哪个协议 adapter，`provider` 决定模型归属、鉴权归属、baseUrl/headers/compat 归属。

一次模型回复最终都会变成：

```ts
interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  responseId?: string;
  responseModel?: string;
  usage: Usage;
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  errorMessage?: string;
  timestamp: number;
}
```

流式过程统一为：

```ts
type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: 'done'; reason: 'stop' | 'length' | 'toolUse'; message: AssistantMessage }
  | { type: 'error'; reason: 'aborted' | 'error'; error: AssistantMessage };
```

注意：当前 Scout 的三个 provider 实现都会用供应商的流式接口，payload 里都是 `stream: true`。所谓“非流式结果”不是向供应商发非流式请求，而是调用方等待 `AssistantMessageEventStream.result()`，最终拿到完整 `AssistantMessage`。

## 2. Scout 标准内容块

供应商的输出内容被压成三类块：

```ts
interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

interface ToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}
```

这三类块覆盖了三家接口里的主要差异：

| 供应商概念 | Scout 内容块 |
| --- | --- |
| 普通文本、拒绝文本 | `TextContent` |
| Anthropic thinking、OpenAI Responses reasoning、OpenAI-compatible reasoning_content | `ThinkingContent` |
| Anthropic tool_use、OpenAI function_call、OpenAI Chat tool_calls | `ToolCall` |

`textSignature`、`thinkingSignature`、`thoughtSignature` 是为了复用供应商要求的上下文签名。它们不是 UI 文本，而是下一轮 replay 时可能需要传回供应商的元数据。

## 3. 请求侧：Scout Context 到供应商 JSON

### 3.1 标准输入

上层只给 AI 层：

```json
{
  "systemPrompt": "You are Scout.",
  "messages": [
    {
      "role": "user",
      "content": "列出当前目录",
      "timestamp": 1
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "toolCall",
          "id": "call_123",
          "name": "list_files",
          "arguments": {
            "path": "."
          }
        }
      ],
      "api": "openai-completions",
      "provider": "openai",
      "model": "gpt-test",
      "usage": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 0,
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 0
        }
      },
      "stopReason": "toolUse",
      "timestamp": 2
    },
    {
      "role": "toolResult",
      "toolCallId": "call_123",
      "toolName": "list_files",
      "content": [
        {
          "type": "text",
          "text": "README.md\npackages"
        }
      ],
      "isError": false,
      "timestamp": 3
    }
  ],
  "tools": []
}
```

### 3.2 OpenAI Responses 请求 JSON

`openai-responses` 使用 `input` 数组，不使用 Chat Completions 的 `messages`：

```json
{
  "model": "gpt-test",
  "input": [
    {
      "role": "developer",
      "content": "You are Scout."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "列出当前目录"
        }
      ]
    },
    {
      "type": "function_call",
      "id": "fc_item_123",
      "call_id": "call_123",
      "name": "list_files",
      "arguments": "{\"path\":\".\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_123",
      "output": "README.md\npackages"
    }
  ],
  "stream": true,
  "store": false
}
```

主要映射：

| Scout | OpenAI Responses |
| --- | --- |
| `systemPrompt` | reasoning 模型用 `developer`，其他用 `system` |
| `UserMessage.content` 文本 | `input_text` |
| `UserMessage.content` 图片 | `input_image` |
| `AssistantMessage.content[].text` | `type: "message"` + `output_text` |
| `TextContent.textSignature` | Responses message item id/phase |
| `ThinkingContent.thinkingSignature` | 直接解析回 Responses `reasoning` item |
| `ToolCall` | `function_call` |
| `ToolCall.id` | 拆成 `call_id` 和 item id |
| `ToolResultMessage` | `function_call_output` |

Responses 的特殊点是它的 reasoning 和 message 都是“output item”。Scout 保存 `thinkingSignature` / `textSignature`，下一轮才知道怎么把历史回复还原成 Responses 能接受的 input item。

### 3.3 OpenAI Chat Completions 请求 JSON

`openai-completions` 使用 Chat Completions 形状：

```json
{
  "model": "gpt-test",
  "messages": [
    {
      "role": "developer",
      "content": "You are Scout."
    },
    {
      "role": "user",
      "content": "列出当前目录"
    },
    {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "id": "call_123",
          "type": "function",
          "function": {
            "name": "list_files",
            "arguments": "{\"path\":\".\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_123",
      "content": "README.md\npackages"
    }
  ],
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

主要映射：

| Scout | Chat Completions |
| --- | --- |
| `systemPrompt` | 支持 developer role 时用 `developer`，否则用 `system` |
| 纯文本 user | `role: "user", content: string` |
| 多模态 user | `content: [{ type: "text" }, { type: "image_url" }]` |
| assistant text | `role: "assistant", content: string` |
| assistant thinking | 默认写到 `reasoning_content` / `reasoning` / `reasoning_text` 这类扩展字段 |
| `requiresThinkingAsText` | 把 thinking 退化成文本块 |
| `ToolCall` | `tool_calls[].function` |
| `ToolResultMessage` | `role: "tool"` + `tool_call_id` |
| tool result 图片 | 额外转成 user image message，因为 tool message 不支持图片 |

Chat Completions 是最麻烦的一类，因为它既要支持 OpenAI 官方，又要兼容大量 OpenAI-compatible 服务。Scout 用 `Model.compat` 吸收差异，例如：

```json
{
  "compat": {
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false,
    "maxTokensField": "max_tokens",
    "thinkingFormat": "qwen",
    "requiresReasoningContentOnAssistantMessages": true
  }
}
```

推理强度也在这里分叉：

| `compat.thinkingFormat` | 请求字段 |
| --- | --- |
| `openai` | `reasoning_effort: "low" | "medium" | ...` |
| `deepseek` | `thinking: { type: "enabled" }` + `reasoning_effort` |
| `openrouter` | `reasoning: { effort: "high" }` |
| `together` | `reasoning: { enabled: true }`，必要时再传 `reasoning_effort` |
| `qwen` | 当前 Scout 类型声明了该模式，但实现尚未补齐 Pi 的 `enable_thinking` 分支 |
| `qwen-chat-template` | 当前 Scout 类型声明了该模式，但实现尚未补齐 Pi 的 `chat_template_kwargs` 分支 |
| `zai` | 当前 Scout 类型声明了该模式，但实现尚未补齐 Pi 的 `enable_thinking` / tool stream 分支 |

这也是 Scout 与 Pi 当前不完全一致的地方：Pi 的 `openai-completions` 已实现 `zai`、`qwen`、`qwen-chat-template` 等分支，Scout 的类型已经预留，但实现目前主要覆盖 OpenAI、DeepSeek、OpenRouter、Together 这几类。

### 3.4 Anthropic Messages 请求 JSON

Anthropic 使用 `messages`，但内容块和工具结果的形状不同：

```json
{
  "model": "claude-test",
  "system": "You are Scout.",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "列出当前目录"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "tool_use",
          "id": "call_123",
          "name": "list_files",
          "input": {
            "path": "."
          }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "call_123",
          "content": [
            {
              "type": "text",
              "text": "README.md\npackages"
            }
          ],
          "is_error": false
        }
      ]
    }
  ],
  "max_tokens": 8192,
  "stream": true
}
```

主要映射：

| Scout | Anthropic |
| --- | --- |
| `systemPrompt` | 顶层 `system` |
| user text/image | `content` 里的 `text` / `image` block |
| assistant text | `text` block |
| signed thinking | `thinking` block + `signature` |
| redacted thinking | `redacted_thinking` + `data` |
| unsigned thinking | 降级为 `text`，避免伪造签名 |
| `ToolCall` | `tool_use` |
| 连续 `ToolResultMessage` | 合并成一条 user message，content 为多个 `tool_result` |

Anthropic 的 thinking 签名比 Chat Completions 更严格：有签名才能作为 thinking block replay；没有签名时 Scout 会转成普通文本。

## 4. 响应侧：原始流事件到 Scout 事件

### 4.1 OpenAI Responses 流式原始 JSON

Responses 常见原始事件：

```json
{ "type": "response.created", "response": { "id": "resp_123" } }
```

```json
{
  "type": "response.output_item.added",
  "item": {
    "id": "rs_1",
    "type": "reasoning",
    "summary": []
  }
}
```

```json
{
  "type": "response.reasoning_summary_text.delta",
  "delta": "我需要先检查目录。"
}
```

```json
{
  "type": "response.output_item.added",
  "item": {
    "id": "msg_1",
    "type": "message",
    "role": "assistant",
    "content": []
  }
}
```

```json
{ "type": "response.output_text.delta", "delta": "我来查看。" }
```

```json
{
  "type": "response.output_item.added",
  "item": {
    "id": "fc_1",
    "type": "function_call",
    "call_id": "call_123",
    "name": "list_files",
    "arguments": ""
  }
}
```

```json
{
  "type": "response.function_call_arguments.delta",
  "delta": "{\"path\":\".\"}"
}
```

```json
{
  "type": "response.completed",
  "response": {
    "id": "resp_123",
    "status": "completed",
    "usage": {
      "input_tokens": 100,
      "output_tokens": 20,
      "total_tokens": 120,
      "input_tokens_details": {
        "cached_tokens": 40
      }
    }
  }
}
```

映射为 Scout 事件：

| Responses 原始事件 | Scout 事件/字段 |
| --- | --- |
| provider 调用开始 | `start`，创建空的 `AssistantMessage` |
| `response.created.response.id` | `AssistantMessage.responseId` |
| `response.output_item.added` + `type: "reasoning"` | 新增 `ThinkingContent`，发 `thinking_start` |
| `response.reasoning_summary_text.delta` | 追加 `ThinkingContent.thinking`，发 `thinking_delta` |
| `response.reasoning_text.delta` | 追加 `ThinkingContent.thinking`，发 `thinking_delta` |
| `response.output_item.done` + reasoning | `thinkingSignature = JSON.stringify(item)`，发 `thinking_end` |
| `response.output_item.added` + `type: "message"` | 新增 `TextContent`，发 `text_start` |
| `response.output_text.delta` | 追加 `TextContent.text`，发 `text_delta` |
| `response.refusal.delta` | 也追加到 `TextContent.text`，发 `text_delta` |
| `response.output_item.done` + message | `textSignature = encodeTextSignatureV1(item.id, item.phase)`，发 `text_end` |
| `response.output_item.added` + `type: "function_call"` | 新增 `ToolCall`，id 为 `call_id|item.id`，发 `toolcall_start` |
| `response.function_call_arguments.delta` | 追加 `partialJson`，发 `toolcall_delta` |
| `response.function_call_arguments.done` | 尝试解析最终 arguments |
| `response.output_item.done` + function_call | 完成 `ToolCall.arguments`，发 `toolcall_end` |
| `response.completed.usage` | 填充 `usage` |
| `response.completed.status` | 映射 `stopReason` |
| `response.failed` / `error` | 映射 `error` 事件 |

最终 Scout 非流式结果示例：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "我需要先检查目录。",
      "thinkingSignature": "{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[...]}"
    },
    {
      "type": "text",
      "text": "我来查看。",
      "textSignature": "{\"v\":1,\"id\":\"msg_1\"}"
    },
    {
      "type": "toolCall",
      "id": "call_123|fc_1",
      "name": "list_files",
      "arguments": {
        "path": "."
      }
    }
  ],
  "api": "openai-responses",
  "provider": "openai",
  "model": "gpt-test",
  "responseId": "resp_123",
  "usage": {
    "input": 60,
    "output": 20,
    "cacheRead": 40,
    "cacheWrite": 0,
    "totalTokens": 120,
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 0
    }
  },
  "stopReason": "toolUse",
  "timestamp": 0
}
```

这里 `input = input_tokens - cached_tokens`，`cacheRead = cached_tokens`。如果 response status 是 completed 但内容里包含工具调用，Scout 会把 `stopReason` 从 `stop` 修正为 `toolUse`。

### 4.2 OpenAI Chat Completions 流式原始 JSON

Chat Completions 常见原始 chunk：

```json
{
  "id": "chatcmpl_123",
  "model": "gpt-test",
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "你好"
      },
      "finish_reason": null
    }
  ]
}
```

OpenAI-compatible 推理字段可能长这样：

```json
{
  "choices": [
    {
      "delta": {
        "reasoning_content": "我需要先分析。"
      }
    }
  ]
}
```

工具调用 chunk：

```json
{
  "choices": [
    {
      "delta": {
        "tool_calls": [
          {
            "index": 0,
            "id": "call_123",
            "type": "function",
            "function": {
              "name": "list_files",
              "arguments": "{\"path\""
            }
          }
        ]
      }
    }
  ]
}
```

结束 chunk：

```json
{
  "id": "chatcmpl_123",
  "model": "actual-routed-model",
  "choices": [
    {
      "finish_reason": "tool_calls",
      "delta": {}
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 20,
    "total_tokens": 120,
    "prompt_tokens_details": {
      "cached_tokens": 30
    }
  }
}
```

映射为 Scout：

| Completions chunk | Scout 事件/字段 |
| --- | --- |
| provider 调用开始 | `start`，创建空的 `AssistantMessage` |
| `chunk.id` | `AssistantMessage.responseId` |
| `chunk.model !== model.id` | `AssistantMessage.responseModel` |
| `choice.delta.content` | 新增/追加 `TextContent`，发 `text_start` / `text_delta` |
| `choice.delta.reasoning_content` | 新增/追加 `ThinkingContent`，`thinkingSignature = "reasoning_content"` |
| `choice.delta.reasoning` | 新增/追加 `ThinkingContent`，`thinkingSignature = "reasoning"` |
| `choice.delta.reasoning_text` | 新增/追加 `ThinkingContent`，`thinkingSignature = "reasoning_text"` |
| `choice.delta.tool_calls[].id` | 新增 `ToolCall.id` |
| `choice.delta.tool_calls[].function.name` | `ToolCall.name` |
| `choice.delta.tool_calls[].function.arguments` | 追加 `partialJson`，持续尝试 JSON parse，发 `toolcall_delta` |
| `choice.delta.reasoning_details` | 可能映射到 `ToolCall.thoughtSignature` |
| `chunk.usage` 或 `choice.usage` | 填充 `usage` |
| `choice.finish_reason` | 映射 `stopReason` |

`finish_reason` 映射：

| 原始 `finish_reason` | Scout `stopReason` |
| --- | --- |
| `stop` | `stop` |
| `length` | `length` |
| `function_call` | `toolUse` |
| `tool_calls` | `toolUse` |
| `content_filter` | `error` |
| `network_error` | `error` |
| 未知值 | `error` |

最终 Scout 非流式结果示例：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "我需要先分析。",
      "thinkingSignature": "reasoning_content"
    },
    {
      "type": "text",
      "text": "你好"
    },
    {
      "type": "toolCall",
      "id": "call_123",
      "name": "list_files",
      "arguments": {
        "path": "."
      }
    }
  ],
  "api": "openai-completions",
  "provider": "openai",
  "model": "gpt-test",
  "responseId": "chatcmpl_123",
  "responseModel": "actual-routed-model",
  "usage": {
    "input": 70,
    "output": 20,
    "cacheRead": 30,
    "cacheWrite": 0,
    "totalTokens": 120,
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 0
    }
  },
  "stopReason": "toolUse",
  "timestamp": 0
}
```

Chat Completions 的风险点是“兼容接口长得像 OpenAI，但字段不完全一样”。例如有些服务不支持 `developer` role，有些服务把最大 token 字段叫 `max_tokens`，有些服务不能接受 `stream_options.include_usage`，有些服务推理字段叫 `reasoning_content`。Scout 用 `compat` 把这些差异收敛在模型配置里。

### 4.3 Anthropic Messages 流式原始 JSON

Anthropic 常见原始事件：

```json
{
  "type": "message_start",
  "message": {
    "id": "msg_123",
    "usage": {
      "input_tokens": 100,
      "output_tokens": 1,
      "cache_read_input_tokens": 20,
      "cache_creation_input_tokens": 10
    }
  }
}
```

文本块：

```json
{
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "text",
    "text": ""
  }
}
```

```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "你好"
  }
}
```

thinking 块：

```json
{
  "type": "content_block_start",
  "index": 1,
  "content_block": {
    "type": "thinking",
    "thinking": ""
  }
}
```

```json
{
  "type": "content_block_delta",
  "index": 1,
  "delta": {
    "type": "thinking_delta",
    "thinking": "我需要分析。"
  }
}
```

```json
{
  "type": "content_block_delta",
  "index": 1,
  "delta": {
    "type": "signature_delta",
    "signature": "sig_abc"
  }
}
```

工具调用：

```json
{
  "type": "content_block_start",
  "index": 2,
  "content_block": {
    "type": "tool_use",
    "id": "toolu_123",
    "name": "list_files",
    "input": {}
  }
}
```

```json
{
  "type": "content_block_delta",
  "index": 2,
  "delta": {
    "type": "input_json_delta",
    "partial_json": "{\"path\":\".\"}"
  }
}
```

结束事件：

```json
{
  "type": "message_delta",
  "delta": {
    "stop_reason": "tool_use"
  },
  "usage": {
    "output_tokens": 20
  }
}
```

映射为 Scout：

| Anthropic 事件 | Scout 事件/字段 |
| --- | --- |
| provider 调用开始 | `start`，创建空的 `AssistantMessage` |
| `message_start.message.id` | `AssistantMessage.responseId` |
| `message_start.message.usage` | 初始化 `usage` |
| `content_block_start` + `text` | 新增 `TextContent`，发 `text_start` |
| `content_block_delta.text_delta` | 追加 `TextContent.text`，发 `text_delta` |
| `content_block_stop` + text | 发 `text_end` |
| `content_block_start` + `thinking` | 新增 `ThinkingContent`，发 `thinking_start` |
| `content_block_delta.thinking_delta` | 追加 `ThinkingContent.thinking`，发 `thinking_delta` |
| `content_block_delta.signature_delta` | 追加 `ThinkingContent.thinkingSignature` |
| `content_block_start` + `redacted_thinking` | 新增 `ThinkingContent`，`redacted = true` |
| `content_block_start` + `tool_use` | 新增 `ToolCall`，发 `toolcall_start` |
| `content_block_delta.input_json_delta` | 追加 `partialJson`，发 `toolcall_delta` |
| `content_block_stop` + tool_use | 解析最终 arguments，发 `toolcall_end` |
| `message_delta.delta.stop_reason` | 映射 `stopReason` |
| `message_delta.usage` | 更新 `usage` |

Anthropic `stop_reason` 映射：

| 原始 `stop_reason` | Scout `stopReason` |
| --- | --- |
| `end_turn` | `stop` |
| `stop_sequence` | `stop` |
| `max_tokens` | `length` |
| `tool_use` | `toolUse` |
| `refusal` | `error` |

最终 Scout 非流式结果示例：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "你好"
    },
    {
      "type": "thinking",
      "thinking": "我需要分析。",
      "thinkingSignature": "sig_abc"
    },
    {
      "type": "toolCall",
      "id": "toolu_123",
      "name": "list_files",
      "arguments": {
        "path": "."
      }
    }
  ],
  "api": "anthropic-messages",
  "provider": "anthropic",
  "model": "claude-test",
  "responseId": "msg_123",
  "usage": {
    "input": 100,
    "output": 20,
    "cacheRead": 20,
    "cacheWrite": 10,
    "totalTokens": 150,
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 0
    }
  },
  "stopReason": "toolUse",
  "timestamp": 0
}
```

## 5. 横切字段如何统一

### 5.1 `api`、`provider`、`model`

每条 assistant 回复都会保存：

```json
{
  "api": "openai-completions",
  "provider": "openai",
  "model": "gpt-test"
}
```

含义：

| 字段 | 含义 |
| --- | --- |
| `api` | 当时使用的协议 adapter |
| `provider` | 当时的供应商/鉴权域/模型归属 |
| `model` | 当时请求的模型 id |

这些字段不是冗余字段。下一轮重放历史消息时，Scout 会判断历史 assistant message 是否来自同 provider、同 api、同 model。判断结果会影响 thinking 签名、tool call id、跨模型 handoff 等处理。

### 5.2 `responseId`

来源：

| API | 原始字段 | Scout |
| --- | --- | --- |
| OpenAI Responses | `response.id` | `responseId` |
| Chat Completions | `chunk.id` | `responseId` |
| Anthropic | `message.id` | `responseId` |

当前 Scout 没有用 OpenAI Responses 的服务端记忆链：请求里 `store: false`，也没有传 `previous_response_id`。因此 `responseId` 不是上下文记忆的入口，但它仍然用于追踪、诊断和未来扩展。

### 5.3 `responseModel`

Chat Completions 中，如果供应商返回的 `chunk.model` 与请求模型不同：

```json
{
  "model": "actual-routed-model"
}
```

Scout 会记录：

```json
{
  "model": "requested-model",
  "responseModel": "actual-routed-model"
}
```

这适用于路由供应商、模型别名、OpenRouter 自动路由等场景。`model` 保持“请求模型”，`responseModel` 记录“实际响应模型”。

### 5.4 `usage`

Scout 标准 usage：

```json
{
  "input": 0,
  "output": 0,
  "cacheRead": 0,
  "cacheWrite": 0,
  "totalTokens": 0,
  "cost": {
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0,
    "total": 0
  }
}
```

不同供应商字段不同：

| 供应商 | 原始 input | 原始 output | cache read | cache write |
| --- | --- | --- | --- | --- |
| Responses | `input_tokens` | `output_tokens` | `input_tokens_details.cached_tokens` | 无，记 0 |
| Completions | `prompt_tokens` | `completion_tokens` | `prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens` | `prompt_tokens_details.cache_write_tokens` |
| Anthropic | `input_tokens` | `output_tokens` | `cache_read_input_tokens` | `cache_creation_input_tokens` |

OpenAI Responses 和 Chat Completions 会把缓存命中的 token 从 `input` 中拆出来；Anthropic 当前按供应商返回的 `input_tokens` 原样记录，同时额外记录 `cacheRead` / `cacheWrite`。上层如果要估算本轮总量，可以稳定使用：

```ts
input + output + cacheRead + cacheWrite
```

### 5.5 推理强度

上层使用统一的 thinking level：

```ts
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
```

流向：

```text
UI/Agent thinkingLevel
  -> streamSimple(options.reasoning)
  -> provider streamSimple 映射
  -> provider 原始请求字段
```

映射方式：

| API | Scout option | 原始请求字段 |
| --- | --- | --- |
| OpenAI Responses | `reasoningEffort` | `reasoning: { effort, summary }` |
| Chat Completions / OpenAI | `reasoningEffort` | `reasoning_effort` |
| Chat Completions / DeepSeek | `reasoningEffort` | `thinking.type` + `reasoning_effort` |
| Chat Completions / OpenRouter | `reasoningEffort` | `reasoning.effort` |
| Anthropic | `thinkingBudgetTokens` | `thinking: { type: "enabled", budget_tokens }` |
| Anthropic adaptive | `effort` | `thinking: { type: "adaptive" }` + `output_config.effort` |

优势是上层不用知道某个 provider 是按 effort 传，还是按 token budget 传。

## 6. 统一后的优势

### 6.1 Agent loop 不依赖供应商细节

Agent loop 只处理：

```ts
AssistantMessageEventStream
AssistantMessage
ToolCall
ToolResultMessage
```

无论底层是 Anthropic 的 `tool_use`、OpenAI Responses 的 `function_call`，还是 Chat Completions 的 `tool_calls`，上层都只看到：

```json
{
  "type": "toolCall",
  "id": "call_123",
  "name": "list_files",
  "arguments": {
    "path": "."
  }
}
```

### 6.2 流式 UI 可以复用

三家供应商的 SSE 事件名完全不同，但 Scout 统一成：

```text
text_start -> text_delta -> text_end
thinking_start -> thinking_delta -> thinking_end
toolcall_start -> toolcall_delta -> toolcall_end
done/error
```

Webview 和 session runtime 不需要写三套渲染逻辑。

### 6.3 历史消息可跨 provider replay

历史消息会先经过通用 transform：

- 不支持图片的模型把图片降级为文本提示。
- 同 provider/model 时尽量保留签名 thinking。
- 跨模型或跨 provider 时把无法安全复用的 thinking 转成文本或丢弃。
- tool call id 会按目标 provider 规则归一化。
- 缺失 tool result 时补合成结果，避免供应商拒绝上下文。

因此模型切换、retry、compaction 后恢复，都可以建立在统一消息结构上。

### 6.4 compat 把兼容接口差异局部化

OpenAI-compatible 服务最容易出现“看起来兼容但字段不同”。Scout 不让 agent/webview 感知这些差异，而是集中在 `Model.compat`：

```json
{
  "supportsDeveloperRole": false,
  "supportsUsageInStreaming": false,
  "maxTokensField": "max_tokens",
  "thinkingFormat": "deepseek",
  "requiresToolResultName": true
}
```

这样新增一个兼容模型时，通常只需要改模型配置或 provider adapter，不需要改 agent loop。

### 6.5 非流式结果天然由流事件收敛

Scout 的最终 `AssistantMessage` 是从流事件不断累积出来的。好处是：

- UI 可以边收边渲染。
- 测试可以检查中间事件顺序。
- 调用方如果只要最终结果，可以直接等 `stream.result()`。
- 错误也能携带 partial message 返回，而不是丢失已经收到的内容。

## 7. 当前 Scout 与 Pi 的一个重要边界

Pi 中 `provider` 是开放字符串，OpenAI-compatible 服务通常会保留真实 provider，例如：

```json
{
  "provider": "groq",
  "api": "openai-completions"
}
```

```json
{
  "provider": "zai",
  "api": "openai-completions"
}
```

Scout 的 AI 类型也允许 `Provider = KnownProvider | string`，但 shared/settings 层当前把可配置 provider 收窄为 `openai` / `anthropic`。因此当前 Scout 里直连 Qwen/DashScope 时，通常只能挂在 `openai` provider 下，通过模型级 `baseUrl` 和 `compat` 调通。

如果目标是更贴近 Pi 的长期语义，比较干净的方向是：

```json
{
  "providers": {
    "qwen": {
      "api": "openai-completions",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "DASHSCOPE_API_KEY",
      "compat": {
        "thinkingFormat": "qwen"
      }
    }
  }
}
```

也就是：

```text
api = 怎么说话
provider = 跟谁说话、用谁的 key、这条历史属于谁
baseUrl = 具体去哪说
compat = 这个供应商有哪些协议怪癖
```

短期只使用 API key + baseUrl 时，把 Qwen 挂在 `openai` 下可以调通；长期如果要避免 auth、历史来源和 provider 归属混淆，应允许自定义 provider，同时继续复用 `openai-completions` adapter。
