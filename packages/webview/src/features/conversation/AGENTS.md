# Conversation 组件状态说明

本目录只负责 webview 展示投影，不改变 `shared` 协议、extension runtime、agent loop 的生命周期语义。

## Assistant 过程状态

- `busyState` 是宿主全局运行态，只表达 `idle / agent / retry / compaction`。
- assistant process 是 webview 内部投影，用来展示本轮 assistant 的过程状态。
- `正在重试`、`压缩中` 属于全局 runtime 状态，只在底部 inline 展示，不混入 assistant process。

## 文案语义

- `正在思考`：模型决策态。Scout 正在分析上下文、规划下一步、决定是否读文件/跑命令/改代码/直接回复。此状态不等于真实 thinking 内容。
- `正在处理`：工作循环态。Scout 已进入可观察的执行链路，可能在调用工具、读写文件、跑命令、等待输出、等待权限或整合工具结果。
- `已处理`：assistant turn 正常收束。
- `已停止`：assistant turn 被用户中止。
- `处理失败`：assistant turn 以 `stopReason === 'error'` 收束。

一句话边界：

```text
正在思考 = 还在决定下一步
正在处理 = 已经开始推进具体工作
```

## 推导规则

- `busyState.kind === 'agent'` 且本轮没有 work trace：显示 `正在思考`。
- 出现 `toolCall` 或 runtime `tool_pending/tool_running` 后，本轮进入 work trace，显示 `正在处理`。
- 一旦本轮进入过 work trace，运行中保持 `正在处理`，避免工具结果后模型继续输出时在 `正在思考` / `正在处理` 间来回跳。
- turn 完成后按 `stopReason` 收束为 `已处理 / 已停止 / 处理失败`。
- `errorMessage` 可以作为 status 明细展示，但只有 `stopReason === 'error'` 才让外层显示 `处理失败`。

## 过程明细

- 真实 thinking 明细只由 `content.type === 'thinking'` 决定。
- 工具明细由 `toolCall + toolExecution + toolResult` 投影。
- text/image 始终作为 assistant 正文展示，不塞进过程明细。
- `phases` 是过程明细的唯一事实源，不要再维护 flattened `activities` 副本。

## UI 约束

- `正在思考` 可以使用 running shimmer。
- `正在处理` 不使用 running shimmer。
- 运行中的 `正在思考` / `正在处理` 不展示右侧展开 icon。
- 只有完成后显示 `已处理` 且存在过程明细时，才展示右侧展开 icon。
