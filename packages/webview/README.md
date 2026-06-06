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
- 支持 `select_model`、`select_thinking`。
- 根据 `tools` 和 `activeToolNames` 渲染工具列表，发送 `set_active_tools` 更新启用项。

## Tree / Fork / Label

- 发送 `request_tree` 获取会话树，消费 `tree_data`。
- 支持 `navigate_tree` 跳转历史节点。
- 支持 `fork_session` 从指定 entry 派生新 session。
- 支持 `set_label` 给 entry 写标签，消费 `label_result`。

## 体验要求

- UI 应遵循 VS Code 主题变量，不硬编码大面积品牌色。
- 所有长路径、长 id、长消息都需要处理换行或省略，不能撑破侧边栏。
- 操作失败要展示可读错误，取消操作用轻量提示即可。
- 后续实现时优先复用 `@scout-agent/shared` 类型，但不要泄露 extension 内部类型到 Webview。
