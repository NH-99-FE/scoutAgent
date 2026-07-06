# Conversation 组件状态说明

本目录只负责 webview 展示投影，不改变 `shared` 协议、extension runtime、agent loop 的生命周期语义。

消息滚动组件的 API 可参考 [message-scroller-api.md](./docs/message-scroller-api.md)。

## 滚动语义

- 会话详情页保留用户当前阅读位置；发送消息只表达提交意图，不隐式滚到底部。
- 用户需要查看最新内容时使用一键到底；用户已在底部时由 `MessageScroller` 的 `autoScroll` 自然跟随。
- 顶层 row 只注册 `messageId`，默认不启用 `scrollAnchor`；`scrollAnchor` 属于 turn-anchor 阅读模型，会在新 user row 追加时触发对齐并打断历史阅读。
- 顶层 row 不使用浏览器 `content-visibility` / `contain-intrinsic-size`；它们会在离屏 row 进入布局时修正高度，导致从底部向上阅读时 `scrollHeight` 改变、滚动条变短和阅读位置跳动。长 transcript 性能优化应优先通过 React row memo 与稳定投影对象完成。
- 当前会话详情默认没有向上分页加载历史消息的 prepend 语义，因此 `ConversationView` 不暴露 `preserveScrollOnPrepend`；接入历史分页时必须由专门的 history pagination owner 显式打开，并先定义分页加载与底部阅读模型的交互。
- 会话内部可滚动区域必须通过 `ScrollArea` 或 `getNestedScrollBoundaryProps()` 显式标记 `data-scout-nested-scroll="vertical"` / `"both"`；live-tail 恢复逻辑只信任这个协议，不通过 `data-slot` 或 computed style 猜测滚动容器。

## Assistant 过程状态

- `busyState` 是宿主全局运行态，只表达 `idle / agent / retry / compaction`。
- assistant process 是 webview 内部投影，用来展示本轮 assistant 的过程状态。
- `正在重试` 属于全局 runtime 状态，只在底部 inline 展示；压缩开始/完成作为 assistant outcome 分隔提示展示，不混入 assistant process。

## 文案语义

- `正在思考`：模型决策态。Scout 正在分析上下文、规划下一步、决定是否读文件/跑命令/改代码/直接回复；如果 assistant message 已出现 `toolCall` 但执行器尚未回传执行事实，外层仍归入此状态。此状态不等于真实 thinking 内容。
- `正在处理`：工作循环态。Scout 已进入可观察的执行链路，可能在调用工具、读写文件、跑命令、等待输出、等待权限或整合工具结果。
- `已处理`：assistant turn 正常收束。
- `已停止`：assistant turn 被用户中止。
- `处理失败`：assistant turn 以 `stopReason === 'error'` 收束。

一句话边界：

```text
正在思考 = 外层尚未进入可观察执行，也尚未决定具体工具动作
正在处理 = 已经开始推进具体工作
```

## 推导规则

- `busyState.kind === 'agent'` 且本轮没有可观察 work trace：外层显示 `正在思考`。
- 仅出现 `toolCall`、即使 `tool_execution_start` / partial / result / preview 等执行事实还未同步到 webview，本轮也进入 work trace：外层显示 `正在处理`，内层工具项显示动作式进行态，如 `正在阅读 <目标>`；bash 仍显示 `正在运行 <命令>`。
- 出现 runtime `tool_running`、toolResult 或可见 tool preview 后，本轮继续保持 work trace，外层显示 `正在处理`。
- 如果 turn 已经 `aborted` / `error`，裸 `toolCall` 不再使用进行态；内层应显示动作式停止/失败状态，如 `已停止搜索 <目标>` 或 `搜索失败 <目标>`；bash 仍使用 `已停止 <命令>` / `运行失败 <命令>`，与外层 `已停止` / `处理失败` 对齐。
- 一旦本轮进入过 work trace，运行中保持 `正在处理`，避免工具结果后模型继续输出时在 `正在思考` / `正在处理` 间来回跳。
- turn 完成后按 `stopReason` 收束为 `已处理 / 已停止 / 处理失败`。
- `errorMessage` 可以作为 status 明细展示，但只有 `stopReason === 'error'` 才让外层显示 `处理失败`。

## 过程明细

- 真实 thinking 明细只由 `content.type === 'thinking'` 决定。
- 工具明细由 `toolCall + toolExecution + toolResult` 投影；active turn 中的 pending toolCall 也算外层 work trace。
- 工具活动文案按工具动作展示：非 bash 使用 `正在阅读 <目标>` / `已阅读 <目标>` 这类动作式文案；bash 使用 `正在运行 <命令>` / `已运行 <命令>`。其中 active turn 里的进行态覆盖 pending 与 running 两段，不使用 `等待...` 作为用户可见状态。
- `AssistantProcessSummary.status` 是 UI 行为判断契约；`label` 只用于展示文案，不要用文案驱动样式或展开行为。
- text/image 始终作为 assistant 正文展示，不塞进过程明细。
- `phases` 是过程明细的唯一事实源，不要再维护 flattened `activities` 副本。

## UI 约束

- `正在思考` 可以使用 running shimmer。
- `正在处理` 不使用 running shimmer。
- 运行中的 `正在思考` / `正在处理` 不展示右侧展开 icon。
- 只有完成后显示 `已处理` 且存在过程明细时，才展示右侧展开 icon。
