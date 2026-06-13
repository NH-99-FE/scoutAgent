import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  streamSimple,
  TextContent,
  Tool,
  ToolResultMessage,
} from '@scout-agent/ai';
import type { Static, TSchema } from 'typebox';

/**
 * Agent 循环使用的流式函数。
 *
 * 契约：
 * - 对于请求/模型/运行时故障，不得抛出异常或返回 rejected promise。
 * - 必须返回 AssistantMessageEventStream。
 * - 失败必须通过协议事件编码到返回的流中，并以 stopReason "error" 或 "aborted"
 *   以及 errorMessage 的最终 AssistantMessage 表示。
 */
export type StreamFn = (
  ...args: Parameters<typeof streamSimple>
) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>;

/**
 * 单条 assistant 消息中工具调用的执行方式配置。
 *
 * - "sequential"：每个工具调用依次准备、执行和完成后再开始下一个。
 * - "parallel"：工具调用依次准备，然后允许的工具并发执行。
 *   `tool_execution_end` 按工具完成顺序发出，而 tool-result 消息
 *   产物稍后按 assistant 源顺序发出。
 */
export type ToolExecutionMode = 'sequential' | 'parallel';

/**
 * 控制 Agent 循环到达队列排空点时注入多少排队中的用户消息。
 *
 * - "all"：排空并注入该点所有排队消息。
 * - "one-at-a-time"：仅排空并注入最旧的一条排队消息，其余留待后续排空点处理。
 */
export type QueueMode = 'all' | 'one-at-a-time';

/** assistant 消息发出的单个工具调用内容块。 */
export type AgentToolCall = Extract<AssistantMessage['content'][number], { type: 'toolCall' }>;

/**
 * `beforeToolCall` 返回的结果。
 *
 * 返回 `{ block: true }` 可阻止工具执行，循环会改为发出错误工具结果。
 * `reason` 成为该错误结果中显示的文本。省略时使用默认阻止消息。
 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

/**
 * `afterToolCall` 返回的部分覆盖。
 *
 * 合并语义为逐字段：
 * - `content`：若提供，完整替换工具结果内容数组
 * - `details`：若提供，完整替换工具结果 details 值
 * - `isError`：若提供，替换工具结果错误标志
 * - `terminate`：若提供，替换提前终止提示
 *
 * 省略的字段保留原始执行工具结果值。
 * 不对 `content` 或 `details` 进行深度合并。
 */
export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  /**
   * 提示 Agent 在当前工具批次后停止。
   * 仅当批次中每个完成化的工具结果都设为 true 时才提前终止。
   */
  terminate?: boolean;
}

/** 传递给 `beforeToolCall` 的上下文。 */
export interface BeforeToolCallContext {
  /** 请求工具调用的 assistant 消息。 */
  assistantMessage: AssistantMessage;
  /** 来自 `assistantMessage.content` 的原始工具调用块。 */
  toolCall: AgentToolCall;
  /** 经过目标工具 schema 验证的工具参数。 */
  args: unknown;
  /** 工具调用准备时的当前 Agent 上下文。 */
  context: AgentContext;
}

/** 传递给 `afterToolCall` 的上下文。 */
export interface AfterToolCallContext {
  /** 请求工具调用的 assistant 消息。 */
  assistantMessage: AssistantMessage;
  /** 来自 `assistantMessage.content` 的原始工具调用块。 */
  toolCall: AgentToolCall;
  /** 经过目标工具 schema 验证的工具参数。 */
  args: unknown;
  /** 应用 `afterToolCall` 覆盖之前的已执行工具结果。 */
  result: AgentToolResult<unknown>;
  /** 当前已执行工具结果是否被视为错误。 */
  isError: boolean;
  /** 工具调用完成时的当前 Agent 上下文。 */
  context: AgentContext;
}

/** 传递给 `shouldStopAfterTurn` 的上下文。 */
export interface ShouldStopAfterTurnContext {
  /** 完成 turn 的 assistant 消息。 */
  message: AssistantMessage;
  /** 传递给前一个 `turn_end` 事件的工具结果消息。 */
  toolResults: ToolResultMessage[];
  /** turn 的 assistant 消息和工具结果追加后的当前 Agent 上下文。 */
  context: AgentContext;
  /** 若循环在此时退出将返回的消息。prompt 运行包含初始提示消息；continuation 运行不包含已有上下文消息。 */
  newMessages: AgentMessage[];
}

/** Agent 循环在发起下一次 provider 请求前使用的替换运行时状态。 */
export interface AgentLoopTurnUpdate {
  /** 下一次 provider 请求的上下文。 */
  context?: AgentContext;
  /** 下一次 provider 请求的模型。 */
  model?: Model<Api>;
  /** 下一次 provider 请求的 thinking 级别。 */
  thinkingLevel?: ThinkingLevel;
}

export type PrepareNextTurnContext = ShouldStopAfterTurnContext;

export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<Api>;

  /**
   * 在每次 LLM 调用前将 AgentMessage[] 转换为 LLM 兼容的 Message[]。
   *
   * 每个 AgentMessage 必须转换为 LLM 能理解的 UserMessage、AssistantMessage 或 ToolResultMessage。
   * 无法转换的 AgentMessage（如纯 UI 通知、状态消息）应被过滤掉。
   *
   * 契约：不得抛出异常或 reject。应返回安全的回退值。
   * 抛出异常会中断底层 Agent 循环而不产生正常的事件序列。
   *
   * @example
   * ```typescript
   * convertToLlm: (messages) => messages.flatMap(m => {
   *   if (m.role === "custom") {
   *     // 将自定义消息转换为 user 消息
   *     return [{ role: "user", content: m.content, timestamp: m.timestamp }];
   *   }
   *   if (m.role === "notification") {
   *     // 过滤纯 UI 消息
   *     return [];
   *   }
   *   // 透传标准 LLM 消息
   *   return [m];
   * })
   * ```
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * 在 `convertToLlm` 之前对上下文应用的可选变换。
   *
   * 用于在 AgentMessage 层级进行的操作：
   * - 上下文窗口管理（裁剪旧消息）
   * - 注入来自外部源的上下文
   *
   * 契约：不得抛出异常或 reject。应返回原始消息或其他安全的回退值。
   *
   * @example
   * ```typescript
   * transformContext: async (messages) => {
   *   if (estimateTokens(messages) > MAX_TOKENS) {
   *     return pruneOldMessages(messages);
   *   }
   *   return messages;
   * }
   * ```
   */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  /**
   * 为每次 LLM 调用动态解析 API key。
   *
   * 适用于短期 OAuth token（如 GitHub Copilot），这些 token 可能在
   * 长时间工具执行阶段过期。
   *
   * 契约：不得抛出异常或 reject。无可用 key 时返回 undefined。
   */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

  /**
   * 在每个 turn 完全完成且 `turn_end` 已发出后调用。
   *
   * 若返回 true，循环在轮询 steering 或 follow-up 队列之前发出 `agent_end` 并退出，
   * 不再发起新的 LLM 调用。当前 assistant 响应和任何工具执行正常完成。
   *
   * 用于在当前 turn 之后请求优雅停止，例如在上下文即将填满之前。
   *
   * 契约：不得抛出异常或 reject。抛出异常会中断底层 Agent 循环而不产生正常的事件序列。
   */
  shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;

  /**
   * 在 `turn_end` 之后、循环决定是否发起下一次 provider 请求之前调用。
   * 返回替换的 context/model/thinking 状态以影响本次运行的下一个 turn。
   * 返回 undefined 以继续使用当前的上下文/配置。
   */
  prepareNextTurn?: (
    context: PrepareNextTurnContext,
  ) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

  /**
   * 返回在运行期间注入对话的 steering 消息。
   *
   * 在当前 assistant turn 完成工具调用执行后调用（除非 `shouldStopAfterTurn` 先退出）。
   * 若返回消息，它们会在下一次 LLM 调用前添加到上下文中。
   * 当前 assistant 消息的工具调用不会被跳过。
   *
   * 用于在 Agent 工作时进行"转向"。
   *
   * 契约：不得抛出异常或 reject。无 steering 消息时返回 []。
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * 返回在 Agent 即将停止后处理的 follow-up 消息。
   *
   * 当 Agent 没有更多工具调用且没有 steering 消息时调用。
   * 若返回消息，它们会被添加到上下文中，Agent 继续下一个 turn。
   *
   * 用于需要在 Agent 完成后才处理的 follow-up 消息。
   *
   * 契约：不得抛出异常或 reject。无 follow-up 消息时返回 []。
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;

  /**
   * 工具执行模式。
   * - "sequential"：逐个执行工具调用
   * - "parallel"：依次预检工具调用，然后允许的工具并发执行；
   *   按工具完成顺序发出 `tool_execution_end`，然后按 assistant 源顺序发出 tool-result 消息产物
   *
   * 默认值："parallel"
   */
  toolExecution?: ToolExecutionMode;

  /**
   * 在工具执行前、参数验证后调用。
   *
   * 返回 `{ block: true }` 可阻止执行，循环会改为发出错误工具结果。
   * 钩子接收 Agent 中止信号并负责遵守它。
   */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;

  /**
   * 在工具完成执行后、`tool_execution_end` 和 tool-result 消息事件发出前调用。
   *
   * 返回 `AfterToolCallResult` 可覆盖已执行工具结果的部分内容：
   * - `content` 替换完整内容数组
   * - `details` 替换完整 details 载荷
   * - `isError` 替换错误标志
   * - `terminate` 替换提前终止提示
   *
   * 省略的字段保留其原始值，不进行深度合并。
   * 钩子接收 Agent 中止信号并负责遵守它。
   */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}

/**
 * 思考/推理级别，仅支持该特性的模型可用。
 * 注意："xhigh" 仅部分模型系列支持。使用 @scout-agent/ai 中的模型
 * thinking-level 元数据来检测具体模型是否支持。
 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * 自定义应用消息的可扩展接口。
 * 应用可通过声明合并扩展：
 *
 * @example
 * ```typescript
 * declare module "@scout-agent/agent" {
 *   interface CustomAgentMessages {
 *     artifact: ArtifactMessage;
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomAgentMessages {
  // 默认为空 — 应用通过声明合并扩展
}

/**
 * AgentMessage：LLM 消息与自定义消息的联合类型。
 * 此抽象允许应用添加自定义消息类型，同时保持
 * 类型安全及与基础 LLM 消息的兼容性。
 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/** Agent 内部运行队列的投递语义。 */
export type QueuedAgentMessageDelivery = 'steer' | 'followUp';

/** 带稳定 id 的运行态排队消息。 */
export interface QueuedAgentMessage {
  id: string;
  delivery: QueuedAgentMessageDelivery;
  message: AgentMessage;
  timestamp: number;
}

/** 当前 Agent 运行队列的完整快照。 */
export interface AgentQueueSnapshot {
  steer: QueuedAgentMessage[];
  followUp: QueuedAgentMessage[];
  all: QueuedAgentMessage[];
}

/**
 * 公共 Agent 状态。
 *
 * `tools` 和 `messages` 使用访问器属性，以便实现在存储前
 * 拷贝赋值的数组。
 */
export interface AgentState {
  /** 随每次模型请求发送的系统提示。 */
  systemPrompt: string;
  /** 未来 turn 使用的活跃模型。 */
  model: Model<Api>;
  /** 未来 turn 请求的推理级别。 */
  thinkingLevel: ThinkingLevel;
  /** 可用工具。赋值新数组时会拷贝顶层数组。 */
  set tools(tools: AgentTool[]);
  get tools(): AgentTool[];
  /** 对话记录。赋值新数组时会拷贝顶层数组。 */
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  /**
   * Agent 正在处理 prompt 或 continuation 时为 true。
   *
   * 直到 await 的 `agent_end` 监听器结算完毕前保持 true。
   */
  readonly isStreaming: boolean;
  /** 当前流式响应的部分 assistant 消息（如有）。 */
  readonly streamingMessage?: AgentMessage;
  /** 当前正在执行的工具调用 id 集合。 */
  readonly pendingToolCalls: ReadonlySet<string>;
  /** 最近一次失败或中止的 assistant turn 的错误消息（如有）。 */
  readonly errorMessage?: string;
}

/** 工具产生的最终或部分结果。 */
export interface AgentToolResult<T> {
  /** 返回给模型的文本或图像内容。 */
  content: (TextContent | ImageContent)[];
  /** 用于日志或 UI 渲染的任意结构化 details。 */
  details: T;
  /**
   * 提示 Agent 在当前工具批次后停止。
   * 仅当批次中每个完成化的工具结果都设为 true 时才提前终止。
   */
  terminate?: boolean;
}

/** 工具用于流式传输部分执行更新的回调。 */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

/** Agent 运行时使用的工具定义。 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends Tool<TParameters> {
  /** UI 展示用的人类可读标签。 */
  label: string;
  /**
   * 系统提示中使用的简短工具描述。
   * 如果省略，系统提示回退到使用 tool.description（通常太冗长）。
   */
  promptSnippet?: string;
  /**
   * 附加到系统提示的工具使用指南。
   * 每个字符串是一个独立的指导原则。
   */
  promptGuidelines?: string[];
  /**
   * 可选的兼容性垫片，用于在 schema 验证前处理原始工具调用参数。
   * 必须返回匹配 `TParameters` 的对象。
   */
  prepareArguments?: (args: unknown) => Static<TParameters>;
  /** 执行工具调用。失败时抛出异常而非在 `content` 中编码错误。 */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  /**
   * 单个工具的执行模式覆盖。
   * - "sequential"：此工具必须与其他工具调用逐一执行。
   * - "parallel"：此工具可与其他工具调用并发执行。
   *
   * 省略时使用默认执行模式。
   */
  executionMode?: ToolExecutionMode;
}

/** 传入底层 Agent 循环的上下文快照。 */
export interface AgentContext {
  /** 包含在请求中的系统提示。 */
  systemPrompt: string;
  /** 模型可见的对话记录。 */
  messages: AgentMessage[];
  /** 本次运行可用的工具。 */
  tools?: AgentTool[];
}

/**
 * Agent 发出用于 UI 更新的事件。
 *
 * `agent_end` 是一次运行中最后发出的事件，但 await 的 `Agent.subscribe()`
 * 监听器仍是运行结算的一部分。Agent 仅在这些监听器结算完毕后才变为空闲。
 */
export type AgentEvent =
  // Agent 生命周期
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  // Turn 生命周期 — 一个 turn 是一次 assistant 响应 + 任何工具调用/结果
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResultMessage[] }
  // 消息生命周期 — 为 user、assistant 和 toolResult 消息发出
  | { type: 'message_start'; message: AgentMessage }
  // 仅在流式传输期间为 assistant 消息发出
  | { type: 'message_update'; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: 'message_end'; message: AgentMessage }
  // 队列状态 — steer/follow-up 入队、排出、删除、迁移时发出完整快照
  | { type: 'queue_update'; queues: AgentQueueSnapshot }
  // 工具执行生命周期
  | {
      type: 'tool_execution_start';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_execution_update';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      partialResult: AgentToolResult<unknown>;
    }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: AgentToolResult<unknown>;
      isError: boolean;
    };
