# message_update 洪水下的暂停感知问题分析

## 背景

Scout 的 assistant 回复不是一次性写入 UI 的。模型返回过程中，agent 会持续发出运行时事件：

- `message_start`：一条 runtime message 开始。
- `message_update`：当前 assistant partial message 发生变化。
- `message_end`：这条 message 收束，之后 core 会持久化并触发 `state_update`。

其中 `message_update` 是最密集的事件。detail text、thinking、tool call delta 都可能在很短时间里产生大量 update。每个 update 又会被 extension 转发到 webview，webview 再投影到 store，最终触发 React UI 重新计算和渲染。

暂停问题最初看起来像是 provider 或 agent 没有及时 abort：用户点击停止后，界面还在继续出现文本，按钮状态也可能短暂回到“可停止”。后面的日志证明，控制消息通常已经很快到达 extension，`agent.abort()` 也很快被调用；真正让用户“看起来没停”的，是旧 `message_update` 和后续 `state_update` 仍然在 UI 边界排队、投影、覆盖本地停止状态。

## 问题表现

典型现象有几类：

1. 点击停止后，后端已经收到 `control_abort`，但 webview 还在显示旧的流式文本。
2. detail text 输出很快时，UI 会继续消费之前排队的 `message_update`。
3. 停止按钮会闪一下：先变成不可停止，又被迟到的 runtime/state 状态拉回可停止。
4. 如果停止发生在下一轮 assistant 尚未 `message_start` 的窗口，后续迟到的 assistant runtime event 或 snapshot 可能把本应隐藏的 aborted assistant 显示出来。
5. 如果为了隐藏按钮闪烁而把全局 `isStreaming` 伪装成 `false`，又会影响提交路径，让“停止后马上继续提问”的消息进入错误通道。

这些现象的共同点是：后端真实状态、extension 待发送事件、webview 已排队事件、React 当前渲染状态并不是同步完成的。

## 根因

### 1. message_update 是高频增量事件

`packages/shared/src/index.ts` 定义了 runtime event：

```ts
| { type: 'message_update'; messageId: string; message: ScoutMessage }
```

这个事件表达的是“当前 message 的最新 partial 状态”。如果每个 delta 都直接转发，extension 到 webview 的通道会出现大量重复的中间态。

这些中间态对最终 UI 并不都重要。对同一个 `messageId` 来说，16ms 内的 100 个 update，通常只有最后一个对用户可见。逐个投影反而会制造拥塞。

### 2. control message 和普通 protocol message 不能排在一起

普通 webview 请求走 `protocol_request`，需要 requestId、service、method、响应关联等。暂停不是普通请求，它是控制信号，越快到 extension 越好。

如果停止也走普通协议队列，它可能被已有请求、响应处理、UI 事件投影影响。于是代码把暂停拆成了高优先级 control message：

- `packages/shared/src/index.ts`
  - `ScoutControlMessage = { type: 'control_abort' } | { type: 'control_abort_retry' }`
- `packages/webview/src/bridge/protocol-client.ts`
  - `abort: () => sendControlMessage({ type: 'control_abort' })`
- `packages/webview/src/bridge/transport-client.ts`
  - `sendControlMessage()` 直接 `postMessage(message)`
- `packages/extension/src/scout-controller.ts`
  - `control_abort` 直接调用 `sessionManager.abort()`
  - 不经过 `ProtocolServer`

这样可以保证“停止指令”本身尽快到达 extension。

### 3. 后端停了，不代表 UI 队列已经清空

即使 `agent.abort()` 很快执行，之前已经进入 host/webview 队列的 `message_update` 仍然可能继续到达 UI。

这会造成一种错觉：用户看到文本继续增长，以为暂停没生效；实际上增长的可能是旧 update 的延迟投影。

### 4. state_update 会重新覆盖 runtime 投影

`message_end` 在 core 里会持久化消息，然后触发 `state_change`，host 再推 `state_update`。

这意味着只过滤 runtime event 不够。如果 webview 本地把某条 aborted assistant 的 `message_start/update/end` 丢掉，但随后 `state_update.state.messages` 又包含这条持久化后的 assistant，conversation store 仍会被 snapshot 覆盖，隐藏失败。

所以处理必须同时覆盖两条路径：

- runtime event：`message_start` / `message_update` / `message_end`
- snapshot event：`state_update`

### 5. UI 展示态不能污染真实提交语义

停止后为了让按钮立即消失，需要让 UI 视觉上认为当前不可停止。但“是否还在 streaming”也被提交逻辑使用：

```ts
const deliverAs = isStreaming && !hasPausedFollowUps ? (delivery ?? 'followUp') : delivery;
```

如果直接把全局 `isStreaming` 改成 `false`，用户停止后立刻输入并回车，就不会被当成 follow-up。extension 仍可能认为 session 还在 streaming，最终通道语义错位。

所以必须拆开：

- 真实 runtime 状态：给提交路径使用。
- visual runtime 状态：给停止按钮、ConversationView、header 展示使用。

## 处理思路

整体策略不是在某一层“硬等暂停完成”，而是按事件边界分层治理：

1. 控制消息高优先级直达 extension。
2. extension host 对高频 `message_update` 做 latest-wins 合并。
3. host 在 run/snapshot 边界清掉过期 pending update。
4. webview 先经过 runtime overlay，再把事件投影到 conversation store。
5. runtime overlay 在本地 abort settling 期间过滤迟到 runtime event。
6. runtime overlay 同时过滤匹配的 `state_update` snapshot。
7. composer 使用真实 streaming 做提交分流，使用 visual streaming 做按钮展示。

## 实际做法

### 1. 高优先级 control_abort

暂停按钮在 `ChatComposer` 里触发：

```ts
if (visualBusy.kind === 'agent') {
  runtimeOverlayActions.beginLocalAbort();
}
protocolClient.abort();
```

`protocolClient.abort()` 不走普通 protocol request，而是发送：

```ts
sendControlMessage({ type: 'control_abort' })
```

extension 侧 `ScoutController` 收到后直接：

```ts
void this.sessionManager.abort();
```

这样暂停命令不会被普通协议响应、请求关联或其他 webview 消息处理拖慢。

### 2. Host 侧 message_update latest-wins 合并

`packages/extension/src/host/protocol/agent-event-update-coalescer.ts` 是 host 侧削峰点。

它的规则是：

- `message_update` 不立即发布，而是按 `messageId` 存入 `pendingUpdates`。
- 默认 16ms 后 flush。
- 同一个 `messageId` 在 flush 前多次 update，只保留最后一次。
- `message_end` 立即发布，并删除该 `messageId` 的 pending update。
- `agent_end` 先 flush，再发布 end。
- `agent_start` reset，避免上一轮 pending update 穿过新 run 边界。

核心意义是：对 UI 来说，一个 frame 内的中间 partial 没必要全部渲染，保留最新状态就够了。

### 3. Snapshot 边界清掉 pending update

只做 16ms 合并还不够。因为 `state_update` 是权威快照，如果 host 里还有 pending `message_update`，它可能晚于 snapshot 到达 webview，把旧 assistant 再 append 回来。

所以 `SessionEventForwarder` 在处理 `state_change` / `error` 准备 `pushState()` 前调用：

```ts
this.agentEventCoalescer.discardPendingUpdates();
```

这保证旧 runtime partial 不会晚于新的 snapshot 到达。

另外，`SessionEventForwarder` 先把原始 agent event 交给 `ToolCallPreviewProjector`，再交给 coalescer。这样 message_update 合并不会影响工具预览这类需要原始增量的 host 内部投影。

### 4. Conversation Store 保持简单

`packages/webview/src/store/conversation-store.ts` 现在只负责两件事：

- `applyRuntimeEvent()`：按 `messageId` upsert runtime message。
- `applyStateSnapshot()`：用 `state.messages` 重建 snapshot。

它不再承担本地 abort 的复杂判断。

这点很重要：conversation store 是消息事实投影层，不应该混入“用户刚刚点了停止，所以本地视觉上要先挡住一些东西”的宿主态逻辑。

### 5. Runtime Overlay 处理本地 abort 视觉态

复杂的本地暂停感知放在 `packages/webview/src/store/runtime-overlay-store.ts`。

它维护几类状态：

- `runtimeMessageFlow`：记录 runtime message 是否 ended、角色是什么。
- `activeAssistantMessageIds`：当前 runtime 中活跃的 assistant message。
- `locallyAbortedMessageIds`：已经显示过，但本地停止后要丢弃后续 stale update 的 assistant。
- `hiddenRuntimeMessageIds`：停止时尚未显示，后续整条 runtime assistant 都要隐藏。
- `hiddenAssistantSnapshotKeys`：被隐藏 runtime assistant 对应的 snapshot fingerprint，用于过滤后续 `state_update`。
- `visibleAssistantSnapshotKeys`：当前已经可见的 assistant snapshot，避免误隐藏历史消息。
- `localAbortSettling`：本地停止后的视觉 settling 状态。

点击停止时：

```ts
const messageId = findActiveAssistantMessageId();
if (messageId) {
  locallyAbortedMessageIds.add(messageId);
} else {
  hideNextAssistantMessage = true;
}
set({ localAbortSettling: true });
```

意思是：

- 如果当前 assistant 已经 start，就保留已有内容，但丢弃后续 stale update。
- 如果当前 assistant 还没 start，就隐藏下一条 assistant runtime message。

### 6. Runtime event 先经过 overlay

`packages/webview/src/bridge/extension-event-projector.ts` 中，runtime event 不会直接进 conversation store，而是先问 overlay：

```ts
if (!useRuntimeOverlayStore.getState().actions.projectRuntimeEvent(event)) return;
useConversationStore.getState().actions.applyRuntimeEvent(event);
```

overlay 会拦截：

- 已 ended message 的迟到 `message_update`
- 本地 abort settling 期间的 stale assistant update
- stop 时还没 start 的下一条 assistant start/update/end

被拦截的事件不会进入 conversation store，自然不会显示。

### 7. state_update 也先经过 overlay

`state_update` 同样先经过 overlay：

```ts
actions.applyStateSnapshot(
  useRuntimeOverlayStore.getState().actions.projectStateSnapshot(message.state),
)
```

`runtime-overlay-store` 会用 fingerprint 过滤被本地隐藏过的 assistant：

```ts
fingerprint:${timestamp}\0${stopReason}\0${errorMessage}\0${stableStringify(content)}
```

如果 snapshot 中出现了与 hidden runtime assistant 匹配的 assistant，它会被过滤掉。这样即使 core 已经把 aborted assistant 持久化并通过 `state_update` 推回来，webview 当前会话也不会把刚隐藏的内容重新显示出来。

同时它会记录已经可见的 assistant snapshot key，避免把历史中原本可见的 aborted assistant 误删。

### 8. Visual streaming 与真实 streaming 分离

`runtime-overlay-store` 提供：

```ts
useVisualIsStreaming()
useVisualBusyState()
```

它们在 `localAbortSettling` 时返回视觉上的 idle：

```ts
return localAbortSettling ? false : isStreaming;
return localAbortSettling ? IDLE_BUSY_STATE : busyState;
```

`ChatComposer` 中：

- `isStreaming` 来自 `conversation-store`，是真实 runtime 状态，用于提交路径。
- `visualIsStreaming` / `visualBusy` 来自 overlay，用于停止按钮和 Escape 中断展示。

所以停止后马上输入并回车时，仍然会按真实 streaming 语义发送 follow-up，不会因为按钮视觉上 idle 而走错通道。

## 事件流对比

### 修复前

```text
provider delta
  -> agent message_update
  -> extension postMessage
  -> webview upsert
  -> React render

user clicks stop
  -> abort may already reach backend
  -> old message_update still arrives
  -> UI continues changing
  -> state_update may reintroduce aborted assistant
```

### 修复后

```text
user clicks stop
  -> webview beginLocalAbort immediately
  -> control_abort direct postMessage
  -> extension sessionManager.abort()

old message_update
  -> host coalescer may drop/merge
  -> runtime overlay may reject
  -> conversation store does not see stale event

state_update snapshot
  -> runtime overlay filters matching hidden assistant
  -> conversation store receives cleaned snapshot
```

## 结果

这个方案解决了几类用户可感知问题：

1. 点击停止后按钮立即进入停止后的视觉状态，不再依赖后端事件先回来。
2. 高频 `message_update` 不再逐条冲击 webview。
3. 旧 pending update 不会跨 run/snapshot 边界污染 UI。
4. 停止时还没 start 的 assistant 不会因为迟到 runtime event 显示出来。
5. 同一条 hidden assistant 也不会通过后续 `state_update` 被重新显示。
6. 停止后马上继续输入，仍然保留真实 streaming 的提交语义。

## 关键原则

这次问题的核心经验是：暂停不是单纯调用 `abort()` 就结束了。

在流式 UI 里，至少有四种状态同时存在：

- provider/agent 的真实运行状态
- extension host 待发布的 runtime event
- webview 已收到但尚未完全投影的 UI event
- React 当前渲染出来的视觉状态

`message_update` 洪水会让这四层短暂分叉。要让用户感知到“暂停已经发生”，必须同时处理控制通道、事件削峰、边界清理、本地视觉 overlay 和 snapshot 回流。

最终的职责边界是：

- provider/agent：负责真正 abort。
- extension host：负责减少无意义 update，并保证边界顺序。
- webview runtime overlay：负责本地停止后的视觉一致性。
- conversation store：只负责投影被允许进入的 runtime event 和 snapshot。
- composer：区分真实 streaming 与 visual streaming，避免 UI 修复污染业务语义。

这样暂停才不是“后端停了但前端还在演”，而是从控制信号到用户视觉都能一致地收束。
