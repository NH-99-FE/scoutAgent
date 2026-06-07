# Scout Webview Roadmap

Webview 当前只保留临时占位入口。会话恢复、导入、消息渲染等交互能力已经在 shared 协议和 extension 侧准备好，后续单独开发 Webview 时再接入。

## 需要接入的消息协议

- 启动后发送 `ready`，等待 extension 返回 `state_update` 和 `config_update`。
- 发送 `request_sessions` 获取历史会话列表，消费 `sessions_data`。
- 发送 `restore_session` 恢复指定 session，必须携带 `sessionPath`，不要只依赖 `sessionId`。
- 发送 `pick_import_session` 调起 VS Code 文件选择器导入 JSONL。
- 发送 `import_session` 支持手动路径导入 JSONL。
- 发送 `delete_session` 删除指定 session，必须携带 `sessionPath`。
- 消费 `restore_session_result`、`import_session_result`、`delete_session_result` 展示操作结果。
- 后续需要补充 context usage 协议：请求当前上下文估算，展示 token 数、context window 和占比；压缩后 token 数未知时展示未知状态。
- 后续需要补充 manual compaction 协议：触发手动压缩、消费 `compaction_start` / `compaction_end`，并允许 `abort` 取消压缩。
- 后续需要补充 commands 协议：获取 slash commands、prompt templates、skills 和 extension commands，并支持从输入框触发。
- 后续若支持图片输入或图片工具结果，协议需要新增可序列化 image content，不能继续只传 text/thinking/toolCall。

## 会话 UI

- 会话列表需要展示 session id、创建时间、cwd、路径提示和父 session 标识。
- 同一个 session id 可能出现多个文件副本，UI key 和操作目标都必须使用 `sessionPath`。
- 恢复外部 cwd 或丢失 cwd 时，extension 会弹出 VS Code 原生确认框，Webview 只展示最终结果。
- 删除按钮应在 pending 状态下禁用，避免重复请求。
- 导入成功、删除成功、恢复成功后重新发送 `request_sessions` 刷新列表。

## 对话 UI

- 根据 `ScoutWebviewState.messages` 渲染 user、assistant、toolResult、branchSummary。
- 支持流式事件 `agent_event` 更新消息，而不是只等完整 state。
- `isStreaming` 为 true 时显示停止按钮并禁用重复发送。
- 支持 `abort`、`abort_retry`、`continue_session`。
- 输入框发送 `user_message`，保留多行编辑和快捷键提交能力。

## 模型与工具 UI

- 根据 `config_update` 和 `state_update` 展示当前模型。
- `config_update` 还包含 `branchSummary` 设置，Tree UI 必须按该配置决定默认交互。
- 支持 `select_model`、`select_thinking`。
- thinking level 必须支持 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`；UI 应按当前模型支持情况禁用不可用等级。
- 根据 `tools` 和 `activeToolNames` 渲染工具列表，发送 `set_active_tools` 更新启用项。

## Tree / Fork / Label

- 发送 `request_tree` 获取会话树，消费 `tree_data`。
- 支持 `navigate_tree` 跳转历史节点。
- `navigate_tree` 必须携带 `summarize`；当用户填写自定义总结说明时传 `customInstructions`。
- 当用户选择完全替换默认分支总结提示词时传 `replaceInstructions: true`；默认应省略或传 `false`，表示追加说明。
- `config_update.branchSummary.reserveTokens` 是分支总结保留 token 预算，Webview 只展示或用于说明，实际执行由 extension/harness 侧使用。
- `config_update.branchSummary.skipPrompt` 为 true 时，Tree 跳转交互应默认不弹出“是否总结被放弃分支”的确认，直接以 `summarize: false` 跳转；用户仍可从高级操作中显式选择总结。
- 分支总结可能触发模型请求；发送 `navigate_tree` 后应进入 pending 状态，禁用重复跳转、fork、delete 等会改变 session tree 的操作。
- pending 期间停止按钮应发送 `abort`，用于取消正在进行的分支总结或其它运行中任务。
- `navigate_tree_result.editorText` 存在时，应把文本回填到输入框而不是立即发送；这是跳回 user/custom message 草稿节点的恢复语义。
- 支持 `fork_session` 从指定 entry 派生新 session。
- 支持 `set_label` 给 entry 写标签，消费 `label_result`。
- `branchSummary` 消息需要在对话流中作为系统生成的分支检查点展示，至少显示 summary 正文和来源于 tree navigation 的语义。

## 体验要求

- UI 应遵循 VS Code 主题变量，不硬编码大面积品牌色。
- 所有长路径、长 id、长消息都需要处理换行或省略，不能撑破侧边栏。
- 操作失败要展示可读错误，取消操作用轻量提示即可。
- 后续实现时优先复用 `@scout-agent/shared` 类型，但不要泄露 extension 内部类型到 Webview。
