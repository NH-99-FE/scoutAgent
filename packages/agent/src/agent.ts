import {
  type ImageContent,
  type Message,
  type Model,
  type SimpleStreamOptions,
  streamSimple,
  type TextContent,
  type ThinkingBudgets,
  type Transport,
} from '@scout-agent/ai';
import { runAgentLoop, runAgentLoopContinue } from './agent-loop.ts';
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentState,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  QueueMode,
  StreamFn,
  ToolExecutionMode,
} from './types.ts';

export type { QueueMode } from './types.ts';

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (message) =>
      message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult',
  );
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DEFAULT_MODEL = {
  id: 'unknown',
  name: 'unknown',
  api: 'unknown',
  provider: 'unknown',
  baseUrl: '',
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
} satisfies Model<any>;

type MutableAgentState = Omit<
  AgentState,
  'isStreaming' | 'streamingMessage' | 'pendingToolCalls' | 'errorMessage'
> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

function createMutableAgentState(
  initialState?: Partial<
    Omit<AgentState, 'pendingToolCalls' | 'isStreaming' | 'streamingMessage' | 'errorMessage'>
  >,
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    systemPrompt: initialState?.systemPrompt ?? '',
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? 'off',
    get tools() {
      return tools;
    },
    set tools(nextTools: AgentTool<any>[]) {
      tools = nextTools.slice();
    },
    get messages() {
      return messages;
    },
    set messages(nextMessages: AgentMessage[]) {
      messages = nextMessages.slice();
    },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

/** 构造 {@link Agent} 的选项。 */
export interface AgentOptions {
  initialState?: Partial<
    Omit<AgentState, 'pendingToolCalls' | 'isStreaming' | 'streamingMessage' | 'errorMessage'>
  >;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  onPayload?: SimpleStreamOptions['onPayload'];
  onResponse?: SimpleStreamOptions['onResponse'];
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  prepareNextTurn?: (
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  sessionId?: string;
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;
}

class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  public mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  drain(): AgentMessage[] {
    if (this.mode === 'all') {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }

    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }
}

type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

/**
 * 底层 Agent 循环的有状态封装。
 *
 * `Agent` 持有当前对话记录，发出生命周期事件，执行工具，
 * 并暴露 steering 和 follow-up 消息的队列 API。
 */
export class Agent {
  private _state: MutableAgentState;
  private readonly listeners = new Set<
    (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  >();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;

  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  public transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;
  public streamFn: StreamFn;
  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  public onPayload?: SimpleStreamOptions['onPayload'];
  public onResponse?: SimpleStreamOptions['onResponse'];
  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  public prepareNextTurn?: (
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  private activeRun?: ActiveRun;
  /** 转发给 provider 的会话标识符，用于支持缓存感知的后端。 */
  public sessionId?: string;
  /** 可选的按级别 thinking token 预算，转发给流式函数。 */
  public thinkingBudgets?: ThinkingBudgets;
  /** 首选传输方式，转发给流式函数。 */
  public transport: Transport;
  /** 可选的 provider 请求重试延迟上限。 */
  public maxRetryDelayMs?: number;
  /** 包含多个工具调用的 assistant 消息的工具执行策略。 */
  public toolExecution: ToolExecutionMode;

  constructor(options: AgentOptions = {}) {
    this._state = createMutableAgentState(options.initialState);
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = options.transformContext;
    this.streamFn = options.streamFn ?? streamSimple;
    this.getApiKey = options.getApiKey;
    this.onPayload = options.onPayload;
    this.onResponse = options.onResponse;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.prepareNextTurn = options.prepareNextTurn;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? 'one-at-a-time');
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? 'one-at-a-time');
    this.sessionId = options.sessionId;
    this.thinkingBudgets = options.thinkingBudgets;
    this.transport = options.transport ?? 'auto';
    this.maxRetryDelayMs = options.maxRetryDelayMs;
    this.toolExecution = options.toolExecution ?? 'parallel';
  }

  /**
   * 订阅 Agent 生命周期事件。
   *
   * 监听器 Promise 按订阅顺序依次 await，并包含在当前运行的结算中。
   * 监听器同时接收当前运行的中止信号。
   *
   * `agent_end` 是一次运行中最后发出的事件，但 Agent 在该事件
   * 的所有 await 监听器结算完毕之前不会进入空闲状态。
   */
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 当前 Agent 状态。
   *
   * 赋值 `state.tools` 或 `state.messages` 时会拷贝传入的顶层数组。
   */
  get state(): AgentState {
    return this._state;
  }

  /** 控制 steering 队列消息的排出方式。 */
  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  /** 控制 follow-up 队列消息的排出方式。 */
  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  /** 将消息排入队列，在当前 assistant turn 完成后注入。 */
  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  /** 将消息排入队列，仅在 Agent 即将停止时运行。 */
  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  /** 移除所有排队的 steering 消息。 */
  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  /** 移除所有排队的 follow-up 消息。 */
  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  /** 移除所有排队的 steering 和 follow-up 消息。 */
  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  /** 任一队列仍有待处理消息时返回 true。 */
  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  /** 当前运行的中止信号（如正在运行）。 */
  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  /** 中止当前运行（如正在运行）。 */
  abort(): void {
    this.activeRun?.abortController.abort();
  }

  /**
   * 等待当前运行及所有 await 的事件监听器完成。
   *
   * 在 `agent_end` 监听器结算完毕后 resolve。
   */
  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  /** 清空对话记录状态、运行时状态和排队消息。 */
  reset(): void {
    this._state.messages = [];
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this._state.errorMessage = undefined;
    this.clearFollowUpQueue();
    this.clearSteeringQueue();
  }

  /** 从文本、单条消息或消息批次发起新提示。 */
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): Promise<void> {
    if (this.activeRun) {
      throw new Error(
        'Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.',
      );
    }
    const messages = this.normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
  }

  /** 从当前对话记录继续。最后一条消息必须是 user 或 toolResult 消息。 */
  async continue(): Promise<void> {
    if (this.activeRun) {
      throw new Error('Agent is already processing. Wait for completion before continuing.');
    }

    const lastMessage = this._state.messages[this._state.messages.length - 1];
    if (!lastMessage) {
      throw new Error('No messages to continue from');
    }

    if (lastMessage.role === 'assistant') {
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length > 0) {
        await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
        return;
      }

      const queuedFollowUps = this.followUpQueue.drain();
      if (queuedFollowUps.length > 0) {
        await this.runPromptMessages(queuedFollowUps);
        return;
      }

      throw new Error('Cannot continue from message role: assistant');
    }

    await this.runContinuation();
  }

  private normalizePromptInput(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): AgentMessage[] {
    if (Array.isArray(input)) {
      return input;
    }

    if (typeof input !== 'string') {
      return [input];
    }

    const content: Array<TextContent | ImageContent> = [{ type: 'text', text: input }];
    if (images && images.length > 0) {
      content.push(...images);
    }
    return [{ role: 'user', content, timestamp: Date.now() }];
  }

  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        this.createLoopConfig(options),
        (event) => this.processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  private async runContinuation(): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        this.createLoopConfig(),
        (event) => this.processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  private createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools.slice(),
    };
  }

  private createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
    let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
    return {
      model: this._state.model,
      reasoning: this._state.thinkingLevel === 'off' ? undefined : this._state.thinkingLevel,
      sessionId: this.sessionId,
      onPayload: this.onPayload,
      onResponse: this.onResponse,
      transport: this.transport,
      thinkingBudgets: this.thinkingBudgets,
      maxRetryDelayMs: this.maxRetryDelayMs,
      toolExecution: this.toolExecution,
      beforeToolCall: this.beforeToolCall,
      afterToolCall: this.afterToolCall,
      prepareNextTurn: this.prepareNextTurn
        ? async () => await this.prepareNextTurn?.(this.signal)
        : undefined,
      convertToLlm: this.convertToLlm,
      transformContext: this.transformContext,
      getApiKey: this.getApiKey,
      getSteeringMessages: async () => {
        if (skipInitialSteeringPoll) {
          skipInitialSteeringPoll = false;
          return [];
        }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }

  private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) {
      throw new Error('Agent is already processing.');
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.activeRun = { promise, resolve: resolvePromise, abortController };

    this._state.isStreaming = true;
    this._state.streamingMessage = undefined;
    this._state.errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (error) {
      await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this.finishRun();
    }
  }

  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api: this._state.model.api,
      provider: this._state.model.provider,
      model: this._state.model.id,
      usage: EMPTY_USAGE,
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } satisfies AgentMessage;
    await this.processEvents({ type: 'message_start', message: failureMessage });
    await this.processEvents({ type: 'message_end', message: failureMessage });
    await this.processEvents({ type: 'turn_end', message: failureMessage, toolResults: [] });
    await this.processEvents({ type: 'agent_end', messages: [failureMessage] });
  }

  private finishRun(): void {
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    this.activeRun = undefined;
  }

  /**
   * 根据循环事件归约内部状态，然后 await 监听器。
   *
   * `agent_end` 仅表示不再发出循环事件。运行在 `agent_end`
   * 的所有 await 监听器结算完毕且 `finishRun()` 清理运行时状态后才视为空闲。
   */
  private async processEvents(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'message_start':
        this._state.streamingMessage = event.message;
        break;

      case 'message_update':
        this._state.streamingMessage = event.message;
        break;

      case 'message_end':
        this._state.streamingMessage = undefined;
        this._state.messages.push(event.message);
        break;

      case 'tool_execution_start': {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case 'tool_execution_end': {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case 'turn_end':
        if (event.message.role === 'assistant' && event.message.errorMessage) {
          this._state.errorMessage = event.message.errorMessage;
        }
        break;

      case 'agent_end':
        this._state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) {
      throw new Error('Agent listener invoked outside active run');
    }
    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
