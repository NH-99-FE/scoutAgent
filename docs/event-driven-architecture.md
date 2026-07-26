# Scout Agent 事件驱动架构

Scout Agent 采用**分层事件驱动架构**，从 LLM 流到 UI 渲染存在多个独立的事件系统，每一层抽象不同关注点，层与层之间通过订阅/转发解耦。

## 一、主运行链与独立事件子系统

```
[LLM Provider]
   ↓ SSE/stream
① AssistantMessageEvent        (ai 层 — 供应商无关的流式协议)
   ↓ Agent 消费 EventStream
② AgentEvent                   (agent 层 — Agent 循环语义事件)
   ↓ AgentSession 直接订阅 Agent
③ AgentSessionEvent            (extension/core — 运行编排与持久化语义)
   ↓ session-coordinator.subscribe
④ ScoutSessionEvent / ExtensionEventMessage  (host→webview 协议消息)
   ↓ window.addEventListener('message')
⑤ Store 投影                  (webview — Zustand 状态投影)
```

`AgentHarness` 不在这条 Extension 主运行链上。它是 `packages/agent` 提供的独立
direct-loop API：同样消费 Agent/agent-loop 能力，并额外提供 session tree、
compaction、tree navigation 与 hook，但 `AgentSession` 不包装也不订阅 Harness。
`ScoutExtensionRunner` 则是 `AgentSession` 在 core 层调用的另一套扩展 hook 子系统。

## 二、第①层：AssistantMessageEvent（AI 层流式协议）

**文件**：`packages/ai/src/event-stream.ts`、`packages/ai/src/stream.ts`

**核心抽象**：`EventStream<T, R>` —— 异步推送队列 + 最终结果 Promise。

```ts
// event-stream.ts:8
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise<R>;
  private isComplete: (event: T) => boolean;
  private extractResult: (event: T) => R;

  push(event: T): void { /* 入队或唤醒等待者；命中 isComplete 则解析 finalResult */ }
  end(result?: R): void { /* 唤醒所有等待者并标记结束 */ }
  async *[Symbol.asyncIterator](): AsyncIterator<T> { /* queue → waiting → done 三段式 */ }
  result(): Promise<R> { return this.finalResultPromise; }
}
```

**关键设计**：

1. **同步 push + 异步迭代**：`push` 是同步的，让 provider 在 SSE 回调中直接 push；消费者用 `for await...of` 拉取。
2. **`isComplete` + `extractResult` 注入策略**：子类通过这两个回调决定"什么事件算结束"和"如何从结束事件中拿到最终结果"。`AssistantMessageEventStream`（event-stream.ts:71）以 `done`/`error` 为完成信号，从 `done.message` 或 `error.error` 提取结果。
3. **fire-and-forget IIFE 模式**：`stream.ts` 中 provider 用 `(() => { ... })()` 执行异步逻辑，**同步返回 `EventStream`**，让调用者立即拿到迭代器而无需 `await`。
4. **唯一真相来源**：partial message 通过事件的 `partial` 字段传递，不维护额外的中间状态。

## 三、第②层：AgentEvent（Agent 循环语义）

**文件**：`packages/agent/src/agent-loop.ts`、`packages/agent/src/agent.ts`、`packages/agent/src/types.ts`
（Pi 对应文件同构：`packages/agent/src/agent-loop.ts`，行号近乎一一对应，Scout 由 Pi 移植简化而来。）

Agent 循环把 `AssistantMessageEvent`（细粒度的 token 流）重映射为**循环语义事件**。

### 3.1 典型序列（顺序工具执行 + 正常流式输出）

```
agent_start
  turn_start
    message_start (user prompt)
    message_end   (user prompt)
    message_start (assistant partial)         ← streamAssistantResponse 'start'
    message_update (× N，携带原始 assistantMessageEvent)  ← text/thinking/toolcall 各类 delta
    message_end   (assistant final)          ← 'done' / 'error'
    tool_execution_start                      ← 每个 toolCall 顺序发
    tool_execution_update (× N)
    tool_execution_end
    message_start (toolResult)                ← emitToolResultMessage
    message_end   (toolResult)
    [若有多个 toolCall：tool_execution_* + toolResult message_* 重复 N 次]
  turn_end
  ... (循环)
agent_end
```

### 3.2 并行工具执行变体（`toolExecution !== 'sequential'` 且无 sequential 工具）

`executeToolCallsParallel`（agent-loop.ts:478）的发射顺序：

```
tool_execution_start (call1)
tool_execution_start (call2)              ← 先批量 emit 所有 start
...
[执行 + 各 call 的 tool_execution_update 交错]
tool_execution_end (call1)                ← 按 finalize 完成顺序，非 start 顺序
tool_execution_end (call2)
message_start (toolResult1)               ← Promise.all 后顺序 emit
message_end   (toolResult1)
message_start (toolResult2)
message_end   (toolResult2)
```

即 `tool_execution_start` 全部先发、`tool_execution_end` 按 finalize 完成顺序、`toolResult message_*` 在所有工具 finalize 后批量按数组顺序发。

### 3.3 异常与边界路径

- **assistant `stopReason === 'error' | 'aborted'`**（agent-loop.ts:197）：跳过工具执行，直接 `turn_end(toolResults: [])` → `agent_end`。
- **stream 一开始就 done**（无 delta）：`message_start` 用 `finalMessage`，无 `message_update`，直接 `message_end`。
- **无工具调用**：跳过 `tool_execution_*` 与 `toolResult message_*`，直接 `turn_end`。
- **steering 消息中途注入**（内层循环第 182 行）：在下一个 `turn_start` 之后、`streamAssistantResponse` 之前批量 emit `message_start`/`message_end`。
- **follow-up 消息在 agent 将停止时到达**（外层循环）：触发新一轮内层循环，从 `turn_start` 重新开始。
- **`shouldStopAfterTurn` 返回 true**：在 `turn_end` 之后立即 `agent_end`，跳过后续 turn。
- **`prepareNextTurn` 切换 model/thinkingLevel**：不影响事件序列，只改下一 turn 的配置。

### 3.4 关键设计

1. **`AgentEventSink`**（agent-loop.ts:25）：`(event: AgentEvent) => Promise<void> | void`。所有 emit 都是 `await emit(...)`，确保监听者串行执行；监听者抛错会中断循环（与扩展系统错误隔离策略不同）。
2. **`agentLoop` vs `agentLoopContinue`**（agent-loop.ts:31/64）：两者都返回 `EventStream<AgentEvent, AgentMessage[]>`，但 continue 不添加新 prompt（用于重试）。共用 `runLoop` 实现。
3. **`streamAssistantResponse`**（agent-loop.ts:282）：是协议转换的关键节点。它把 `AgentMessage[]` 转为 `Message[]` 喂给 LLM，再把 `AssistantMessageEvent` 流折叠成 `message_start`/`message_update`/`message_end` 三个高层事件，**`message_update` 携带原始 `assistantMessageEvent`**（透传给上游，保留 token 级细节——包括 `text_*`、`thinking_*`、`toolcall_*` 各类 delta）。
4. **steering / follow-up 双队列**：`getSteeringMessages` 在 turn 之间注入（内层循环顶部检查），`getFollowUpMessages` 在 agent 即将停止时检查是否继续（外层循环底部检查）。两者都通过事件把消息加入上下文。
5. **`agentLoopContinue` 的约束**：上下文最后一条消息必须是 `user` 或 `toolResult`（agent-loop.ts:74），否则抛错——因为 `convertToLlm` 每个 turn 只调用一次，无法在 LLM 调用边界做最终校验。

## 四、独立路径：AgentHarnessEvent（direct-loop API）

**文件**：`packages/agent/src/harness/agent-harness.ts`、`packages/agent/src/harness/types.ts`

Harness 是 Agent 包的独立 direct-loop 使用路径，不是
`AgentEvent → AgentSessionEvent → Host` 的中间层。它把"事件广播"和"hook 拦截"
统一在同一个 handlers Map 里。

### 双重订阅 API

```ts
// agent-harness.ts:1407  订阅所有事件（监听者模式）
subscribe(listener): () => void

// agent-harness.ts:1422  订阅特定事件类型（hook 模式，可返回结果）
on<TType extends keyof AgentHarnessEventResultMap>(type, handler): () => void
```

两者用**同一个 `handlers: Map<string, Set<AgentHarnessHandler>>`** 存储，区别在 key：
- `subscribe` 用通配符 `SUBSCRIBER_EVENT_TYPE = '*'`
- `on` 用具体事件类型字符串

### 三种 emit 路径

```ts
// agent-harness.ts:260  仅通知通配订阅者（不可拦截）
emitOwn(event) → for handlers['*']

// agent-harness.ts:273  通知通配订阅者（不可拦截）
emitAny(event) → for handlers['*']

// agent-harness.ts:286  hook 调用，收集最后一个非 undefined 结果
emitHook<TType>(event) → for handlers[event.type]，返回 ResultMap[TType]
```

### Hook 结果类型表

`AgentHarnessEventResultMap`（types.ts:702）声明每个 hook 事件可返回什么：

| 事件类型 | 返回结果 | 用途 |
|---|---|---|
| `message_end` | `{ message? }` | 替换最终消息 |
| `before_agent_start` | `{ messages?, systemPrompt? }` | 注入消息/改写 prompt |
| `context` | `{ messages? }` | 改写上下文 |
| `before_provider_request` | `{ streamOptions? }` | 改写请求选项 |
| `tool_call` | `{ block?, reason? }` | 阻断工具调用 |
| `tool_result` | `ToolResultPatch` | 修补工具结果 |
| `session_before_compact` | `{ cancel?, compaction? }` | 取消/替换 compaction |
| `session_before_tree` | `{ cancel?, summary?, label? }` | 取消/替换 tree 导航 |
| `after_provider_response` | `undefined` | 纯通知 |

### 关键设计：广播与 hook 的分离

- **广播事件**（agent_start, turn_start, message_* 等纯通知）走 `emitOwn/emitAny`，订阅者只读，无法影响流程。
- **拦截事件**（message_end, before_agent_start, context, tool_call, tool_result, session_before_*）走 `emitHook` 或专用方法，handler 返回结果**反向影响**循环。
- `message_end` 比较特殊（agent-harness.ts:314 `finalizeMessageEnd`）：既是通知又能替换消息——handler 返回的 `result.message` 会**原地替换**原消息（`replaceMessageInPlace`，delete + Object.assign），保证引用一致性。

### Hook 错误传播

`normalizeHookError`（agent-harness.ts:191）把任何抛错统一为 `AgentHarnessError`，**抛出中断循环**。这与扩展系统的"错误隔离 emitError"是不同的策略——harness hook 是核心业务逻辑，错误不可忽略。

## 五、第③层：AgentSessionEvent（协调层）

**文件**：`packages/extension/src/core/agent-session.ts`

`AgentSession` 直接持有并订阅 `Agent`，在 extension/core 层增加持久化、
runtime context 同步、Compaction、Retry、Fork、Tree 与扩展 hook 编排。

### 事件类型（agent-session.ts:193）

```ts
type AgentSessionEvent =
  | { type: 'agent_event'; event: AgentSessionAgentEvent }
  | { type: 'state_change' }
  | { type: 'queue_change' }
  | { type: 'error'; message: string }
  | { type: 'notification'; level; message }
  | { type: 'auto_retry_start'; attempt; maxAttempts; delayMs; errorMessage }
  | { type: 'auto_retry_end'; success; attempt; finalError? }
  | { type: 'compaction_start'; reason }
  | { type: 'compaction_end'; reason; result?; aborted; willRetry; errorMessage? }
  | { type: 'tree_change' }
  | ...
```

### 订阅模型（agent-session.ts:2159）

```ts
subscribe(listener): () => void {
  this.listeners.push(listener);
  return () => { /* splice */ };
}
private emit(event) { for (const l of this.listeners) l(event); }
```

**简化设计**：数组而非 Map，因为只有 SessionCoordinator 一个订阅者；事件不分类，全部走同一通道。

### 双重事件源

`AgentSession` 直接订阅 `AgentEvent`（`this.agent.subscribe`），同时自己产生
retry/compaction/tree_change 等协调事件。`handleAgentEvent` 是关键中转：

```ts
async handleAgentEvent(event: AgentEvent, signal?) {
  const finalizedEvent = await this.finalizeAgentEvent(event);  // 调 runner.emitMessageEnd hook
  const enrichedEvent = this.enrichAgentEndEvent(event);        // 加 willRetry 字段
  await this.emitExtensionLifecycleEvent(enrichedEvent);         // 转发给扩展 runner
  this.emit({ type: 'agent_event', event: enrichedEvent });       // 向下游广播
  // 副作用：state_change / tree_change / persistAgentMessage / overflowRecoveryAttempted 重置
}
```

### 扩展系统桥接（agent-session.ts:3064 `emitExtensionLifecycleEvent`）

把 Agent 事件**翻译**为扩展系统能理解的事件类型（agent_start/turn_start/message_start/...），调用 `runner.emit*` 系列方法。这里出现了**第三种错误处理策略**——`emitHandlerError`（runner.ts:880）把错误转为 `ScoutExtensionError` 通知，不中断流程（错误隔离）。

## 六、第④、⑤层：Host 协议 → Webview 投影

**文件**：`packages/extension/src/host/session-coordinator.ts`、`packages/extension/src/host/protocol/session-event-forwarder.ts`、`packages/extension/src/host/protocol/domain-event-publisher.ts`

### SessionCoordinator：第二级订阅

```ts
// session-coordinator.ts:937
this.unsubscribeAgentSession = agentSession.subscribe((event) =>
  this.forwardAgentSessionEvent(event),
);
```

`forwardAgentSessionEvent`（session-coordinator.ts:860）做两件事：
1. 非 `agent_event` 直接转发；
2. `agent_event` 经 `agentEventCorrelator.map` 投影为 `ScoutAgentEvent`（加 sessionId、displayPath、toolPresentation、fileChangeDetails）。

### SessionEventForwarder：事件 → Webview 消息

`SessionEventForwarder`（session-event-forwarder.ts:122）是**最关键的事件变换器**，承担四项职责：

1. **busyState 归约**（`reduceBusyState`，第 59 行）：把多种事件归约为 `idle | agent | retry | compaction` 四种 busy state。这是一个**有限状态机**，事件驱动状态迁移。
2. **runtime_state_update 发布**：只在状态切换点（`shouldPublishRuntimeState`）发布，避免冗余。
3. **AgentEventCoalescer 接入**：高频 `message_update` 走合并器，低频事件直发。
4. **副作用触发**：`state_change` → `pushState()`、`queue_change` → `pushQueueState()`、`tree_change` → `pushTreeData()`。这是**事件驱动的命令式触发**，不是事件本身。

### DomainEventPublisher：协议校验的单点出口

```ts
// domain-event-publisher.ts:32
publishForProtocol(payloadType, message, surface) {
  const route = SCOUT_PROTOCOL[payloadType];
  const allowedEvents = 'emits' in route ? route.emits : undefined;
  if (!allowedEvents?.includes(message.type))
    throw new Error(`Protocol event not declared: ${payloadType} emitted ${message.type}`);
  this.publish(message, surface);
}
```

**协议 manifest 约束**：`SCOUT_PROTOCOL` 是 shared 包声明的路由表，每个 payload type 声明自己可以 emit 哪些事件类型。这是**编译期约束**，防止 host 随意向 webview 发送未声明的事件——本质是事件契约的单一出口。

### ProtocolBus：请求侧的对偶

`ProtocolBus`（protocol-bus.ts:20）处理**请求/响应**侧（不同于事件广播）：注册 handler → 校验 route → 派发。它的校验项包括：payload 已知、route 匹配 manifest、surface 允许、payload type 与 route 一致。这是**契约校验的 dispatcher**。

## 七、Webview 侧的投影模式

**文件**：`packages/webview/src/bridge/extension-message-router.ts`、`extension-event-projector.ts`

### 路由分流

```ts
// extension-message-router.ts:9
function routeExtensionMessage(message) {
  if (message.type === 'protocol_response') {
    routeProtocolResponse(message);  // 走 Promise resolver
    return;
  }
  projectExtensionEvent(message);     // 走 store 投影
}
```

`window.addEventListener('message')` 是 webview 的入口，所有跨边界消息统一走这里。

### Projector 模式（不是 reducer）

```ts
// extension-event-projector.ts:19
function projectExtensionEvent(message) {
  switch (message.type) {
    case 'state_update':
      useConversationStore.getState().actions.applyStateSnapshot(...)
      useSessionStore.getState().actions.applyState(...)
      useTreeStore.getState().actions.applyState(...)
      useUiStore.getState().actions.resolveOpenTask(...)
      // 一个事件扇出到多个 store
      break;
    case 'agent_event':
      // 走 runtime overlay → conversation 双层投影
      break;
  }
}
```

**关键设计**：

1. **扇出（fan-out）**：一个事件可同时更新多个 store（state_update 同时更新 conversation/session/tree/ui 四个 store）。
2. **双层投影**：runtime 事件先经 `useRuntimeOverlayStore`（短期 overlay，如 streaming token）再落地到 `useConversationStore`（持久对话状态）。`projectRuntimeEvent` 返回 boolean 决定是否继续下沉。
3. **Store 即事件处理器**：Zustand store 的 `actions` 字段是事件 handler 集合，`applyStateSnapshot`/`applyRuntimeEvent` 等是显式的 event handler 命名。

## 八、扩展系统的 EventBus——独立的事件子系统

**文件**：`packages/extension/src/core/extensions/event-bus.ts`、`runner.ts`

扩展系统有**两条独立的事件通道**：

1. **EventBus**（event-bus.ts:16）：基于 `node:events` 的通用 channel，扩展间松耦合通信。`safeHandler` 包装吞掉错误并 `console.error`——**完全隔离**。
2. **ScoutExtensionRunner.emit\***（runner.ts:482）：结构化事件分发，每个事件类型有独立的 emit 方法和**聚合策略**：

| 事件 | 聚合策略 |
|---|---|
| `before_agent_start` | 收集所有 messages + 最后一个 systemPrompt |
| `context` | 最后返回的 messages 胜出 |
| `tool_call` | 第一个 `block=true` 短路 |
| `tool_result` | 顺序 patch 合并（content/details/isError 依次覆盖） |
| `session_before_*` | 第一个 `cancel=true` 短路 |
| `input` | `handled` 短路，`transform` 链式覆盖 |
| `message_end` | 同角色替换，多个 handler 顺序覆盖 |
| 其他（agent_start/end, turn_*, message_*, tool_execution_*） | 纯通知，无聚合 |

这些聚合策略是**声明式的业务语义**——同一事件类型在不同扩展间有不同的合并规则，集中表式管理。

## 九、贯穿所有层的核心模式

### 1. Provider 流同步返回 EventStream

Provider 流使用 fire-and-forget IIFE 启动异步请求并**同步返回**
`EventStream`，让 Agent 立即开始消费。AgentSession、Host 与 Webview 使用各自的
订阅/转发接口，并不都采用 IIFE 或返回 EventStream。

### 2. 双向事件（通知 + 拦截）

| 层 | 通知事件 | 拦截事件 |
|---|---|---|
| Harness | emitOwn/emitAny | emitHook + AgentHarnessEventResultMap |
| Runner | emit() 纯通知 | emitToolCall/emitContext 等 + 聚合策略 |
| AgentSession | agent_event, state_change, tree_change | Extension runner hooks |

拦截事件用**返回值**反向影响流程，通知事件只走单向。

### 3. 错误处理的三种策略

- **抛错中断**：agent-loop.ts 的 `emit`、harness 的 `emitHook`——核心业务不可恢复
- **错误隔离**：runner.ts 的 `emitHandlerError` → `emitError` 通知——扩展不可影响核心
- **完全吞掉**：event-bus.ts 的 `safeHandler`——扩展间通信完全解耦

### 4. 合并器：背压控制

`AgentEventUpdateCoalescer`（agent-event-update-coalescer.ts:21）：

- `message_update` 按 messageId 覆盖 + 16ms flush 延迟
- `message_end` 立即清空 pending + 标记已结束（防止后续 update）
- `agent_start` reset、`agent_end` flush
- 这是**事件驱动的背压控制**——下游慢，上游自动合并

### 5. 协议 manifest 单点校验

`SCOUT_PROTOCOL`（shared 包）声明每个 payload type 的合法 route、surface、emits。`ProtocolBus.dispatch` 和 `DomainEventPublisher.publishForProtocol` 是**两个对称的校验点**——请求侧校验 route，事件侧校验 emits。这是**编译期 + 运行期双契约**。

### 6. 投影而非 reducer

Webview 侧不是 Redux 那种纯 reducer 模式，而是 **projector 模式**——一个事件可扇出到多个 store，store 内部自己决定如何更新。这让事件源（Extension broadcast）与状态结构（Store）解耦，加新 store 不用改 projector。

## 十、为什么这样设计

1. **分层解耦**：LLM 协议（①）→ Agent 循环语义（②）→ AgentSession 编排（③）→ Host 协议（④）→ Webview 投影（⑤）各自关注不同维度；Harness 与 Extension Runner 作为独立 hook 子系统演化。
2. **事件作为唯一真相来源**：partial message 走事件流，不维护中间可变状态——避免状态不一致。
3. **hook 与广播统一**：同一个 handlers Map 既支持监听又支持拦截，但通过 emit 路径区分语义——简化注册接口。
4. **协议 manifest**：跨进程边界（Extension ↔ Webview）用编译期声明约束，避免运行时漏发/错发。
5. **聚合策略集中表式**：扩展系统的多扩展结果合并规则显式声明，避免散落在业务代码各处。

整体设计是**事件驱动 + 责任链 + 有限状态机 + 协议契约**的复合体，每一层职责单一、错误策略明确、可独立测试。
