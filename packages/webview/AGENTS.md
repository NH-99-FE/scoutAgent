# Scout Webview Roadmap

## Webview 容器策略

- 聊天页是常驻工作区 `WebviewView`，挂在 VS Code 侧栏或 panel 中，负责任务入口、消息流、Tree 入口、模型/思考等级选择和输入框。
- 设置页是按需打开的 singleton `WebviewPanel`，展示在 editor tab 中，负责插件配置、provider 配置、MCP/工具配置和其它较重的设置交互。
- Tree 是按需打开的 singleton `WebviewPanel`，展示在 editor tab 中实现；具体页面形态和实现路径后续再定。
- 聊天页点击设置入口时，只通过 shared 协议向 extension host 发送打开设置页的意图；不得在 webview 内直接耦合 VS Code API 或设置页实现。
- 聊天页点击 Tree 入口时，只通过 shared 协议向 extension host 发送打开 Tree 页面的意图；不得在聊天页内直接实现完整 tree 页面或耦合 Tree 页面内部状态。
- extension host 负责打开或复用设置页与 Tree 页面：如果对应 panel 已经存在则 `reveal`，否则创建新的 `WebviewPanel`。
- 聊天页、设置页和 Tree 页面由 extension host 编排，不互相耦合；三者可以共享 `components/ui`、通用 hooks/utils 和 shared 协议类型，但不得共享对方的业务 store 或页面内部组件。
- 设置数据的读取与写入归 extension host 管理，设置页通过 postMessage 协议请求读取/更新配置；需要暴露给 VS Code 原生设置 UI 的配置仍应通过 extension `contributes.configuration` 声明。

## 页面编排策略

- Webview 前端按容器入口、业务 feature、基础 UI 三层组织；聊天页、设置页和 Tree 页面后续可按需要拆成独立入口，但共享 `components/ui` 和 `lib`。
- `components/ui` 只承载 shadcn/Radix 基础交互组件，不写 Scout 业务语义；任务列表、消息流、输入框、模型菜单、设置项等都放在对应 feature 中。
- 当前已确定的 shadcn 基础组件为 `button`、`tooltip`、`input`、`textarea`、`popover`、`dropdown-menu`、`scroll-area`、`separator`、`collapsible`。
- 任务历史搜索面板使用 `Input`、`ScrollArea`、`Separator`，如果从入口按钮浮出则用 `Popover`；任务行自身是业务组件，不使用 `Table` 或 `Card`。
- 顶部更多菜单、模型/推理菜单、审批模式等命令型菜单使用 `DropdownMenu`；模型组展开/收起使用 `Collapsible` 或本地受控展开状态。
- 输入框使用 `Textarea`；输入 `/` 后出现的 slash command 候选面板使用 `Popover` + `ScrollArea`，候选行由业务组件实现，并支持上下键移动、回车确认、Esc 取消。
- `Tooltip` 应覆盖所有仅图标按钮或不明显操作；图标优先使用 `lucide-react`。
- 不计划默认引入 `Card`、`Table`、`Tabs`、`Select`、`Accordion`、`Command`；只有出现明确业务需求时再评估。

## 建议目录

```text
packages/webview/src/
  chat/
    main.tsx
    ChatApp.tsx
  settings/
    main.tsx
    SettingsApp.tsx
  bridge/
    vscode-api.ts
    protocol-client.ts
    extension-message-router.ts
  store/
    conversation-store.ts
    config-store.ts
    task-store.ts
    session-store.ts
    tree-store.ts
    ui-store.ts
  features/
    tasks/
    chat/
    composer/
    model-menu/
    sessions/
    tree/
    tools/
    settings/
  components/
    ui/
  hooks/
  lib/
```

## Feature 职责

- `tasks` 负责任务入口与任务历史浏览，包括首页最近任务、查看全部、搜索过滤、任务列表展示和打开指定任务。
- `conversation` 负责消息流展示，包括 user/assistant/toolResult/branchSummary/compaction/custom 消息、流式 partial 更新、thinking/tool call/image 内容块和空态。
- `composer` 负责底部输入区，包括多行输入、发送/停止、审批模式入口、附件/新增入口、slash command 候选、键盘提交和候选项上下键/回车/Esc 交互。
- `model-menu` 负责模型与思考等级选择，包括当前模型展示、thinking level 选择、模型列表展开/折叠和对应的 `select_model` / `select_thinking` 协议发送。
- `sessions` 负责历史会话管理，包括会话列表、恢复、导入、删除、pending/失败状态和操作完成后的列表刷新。
- `tree` 只服务独立 Tree `WebviewPanel`，负责 session tree 相关交互；具体页面结构和实现路径后续再定，聊天页不得直接引用 tree 页面业务组件。
- `tools` 负责工具开关与工具信息展示，包括工具列表、启用/禁用状态、来源说明和 `set_active_tools` 协议发送。
- `settings` 只服务独立 Settings `WebviewPanel`，负责插件配置、provider 配置、MCP/工具配置和其它较重设置交互；聊天页不得直接引用 settings 业务组件。
- Feature 内只放业务组件和该业务域的纯逻辑；跨 feature 共享状态放 `store`，VS Code postMessage 封装放 `bridge`，shadcn/Radix 基础控件放 `components/ui`。

## Webview 能力清单

Scout Webview 不复刻 Pi 的 terminal TUI 渲染实现，而是复刻 Pi interactive mode 的产品语义。Pi TUI 中的 `Editor`、`SelectList`、`SettingsList`、`Overlay`、`Autocomplete`，在 Scout Webview 中分别落到 composer、候选面板、Settings `WebviewPanel`、Popover/DropdownMenu 和 extension-host 驱动的补全协议。

- Conversation：渲染 `ScoutMessage` 全类型，包括 user、assistant、toolResult、branchSummary、compactionSummary、custom；支持 assistant partial 流式更新、tool execution start/update/end、错误消息和空态。
- Composer：支持多行输入、Enter 发送、Shift+Enter 换行、发送/停止、streaming 时 steer/followUp、compaction/retry pending 状态提示，以及必要的禁用/排队语义。
- Slash Command：输入 `/` 后展示候选项，支持搜索过滤、上下键移动、Enter 确认、Esc 取消；候选来源包括内置命令、prompt templates、extension commands 和 skills，最终由 extension host 提供。
- File / Context Mention：对齐 Pi 的 `@file` 体验，输入 `@` 后展示文件/目录候选；Webview 不直接扫描文件系统，必须通过协议请求 extension host 返回补全结果。
- Model / Thinking：展示当前 provider/model/thinking level，支持模型选择、thinking level 选择、模型组展开/折叠，并发送 `select_model` / `select_thinking`。
- Tasks：展示首页最近任务、查看全部、搜索任务列表、打开指定任务；任务 UI 是 Scout Webview 的入口体验，语义上对齐 session/history。
- Sessions：支持会话列表、恢复、导入、删除、继续、清空、新建；同一个 session id 可能有多个文件副本时，操作目标必须使用 `sessionPath`。
- Tree：在独立 singleton `WebviewPanel` 中实现 session tree 相关能力；`navigate_tree_result.editorText` 存在时必须通知聊天页回填 composer，而不是立即发送。
- Compaction / Retry：展示 auto retry、manual compaction、overflow recovery、compaction start/end；pending 期间提供 abort 能力，避免重复触发会改变 session tree 或 runtime context 的操作。
- Settings Panel：聊天页点击设置只发送打开设置页意图，由 extension host 打开或 reveal singleton Settings `WebviewPanel`；设置页负责 provider API key、默认模型、thinking、工具/MCP 和显示偏好等配置。
- Tools：展示工具列表、启用/禁用状态、工具来源说明、工具调用过程、工具输出展开/折叠和错误状态，并通过 `set_active_tools` 更新启用项。
- Status / Context：展示 session id、cwd、当前 provider/model、thinking level、上下文使用情况、运行状态、重试/压缩状态和必要的轻量提示；Pi 的 `/session` 和 footer 信息在 Webview 中应有可视入口。

### 可暂缓能力

- `/share`、HTML/JSONL export、GitHub gist 等分享/导出能力可以后续补充。
- `/login` / `/logout` 在 Scout 中应优先收敛到 Settings `WebviewPanel` 的 OpenAI/Anthropic API key 配置，不复刻 Pi 的 OAuth selector。
- `!` bash mode 可以后续设计成独立命令或工具入口，第一阶段不塞进 composer 主路径。
- Pi extension custom widgets/header/footer 暂不开放任意 UI 注入；Scout Webview 先使用 shared 协议白名单承载可见能力。
- Terminal image protocol 不需要移植；Webview 直接渲染可序列化 image content。

## 需要接入的消息协议

- 启动后发送 `ready`，等待 extension 返回 `state_update` 和 `config_update`。
- 对话输入发送 `user_message`，streaming 期间根据用户意图使用 `deliverAs: 'steer' | 'followUp'`；停止当前运行发送 `abort`，停止自动重试发送 `abort_retry`。
- 模型与工具发送 `select_model`、`select_thinking`、`set_active_tools`；消费 `state_update`、`config_update` 和 `thinking_level_changed`。
- 会话列表发送 `request_sessions`，消费 `sessions_data`；发送 `restore_session`、`pick_import_session`、`import_session`、`delete_session`，消费对应 result 消息。
- Tree panel 打开后发送 `ready` 和 `request_tree`；Tree 交互发送 `navigate_tree`、`fork_session`、`set_label`，消费 `tree_data`、`navigate_tree_result`、`fork_result`、`label_result`。
- Compaction / retry 已有事件消费协议：`compaction_start`、`compaction_end`、`auto_retry_start`、`auto_retry_end`；但仍需要补充从 Webview 触发 manual compaction 的请求消息，例如 `compact_session`。
- Context usage 已有 `ScoutContextUsage` 类型，但还缺请求/更新消息；需要补充如 `request_context_usage` 和 `context_usage_update`。
- Slash command 需要补充 commands 协议：获取内置命令、prompt templates、skills 和 extension commands，并支持从输入框触发或插入命令。
- File / Context mention 需要补充补全协议：Webview 发送查询，extension host 返回文件/目录候选；Webview 不直接扫描工作区文件系统。
- Tasks 需要补充任务协议：获取最近任务、搜索任务、打开指定任务，并消费任务列表更新。
- Settings panel 需要补充 `open_settings_panel`，由聊天页发出意图，extension host 打开或 reveal singleton Settings `WebviewPanel`。
- Tree panel 需要补充 `open_tree_panel`，由聊天页发出意图，extension host 打开或 reveal singleton Tree `WebviewPanel`。
- 图片内容块 `ScoutImageContent` 已存在，assistant/custom/image tool 映射应优先复用它；如果后续支持用户图片输入或 toolResult 图片，需要补齐 `user_message` / `ScoutToolResultMessage` 的可序列化内容协议。

## 会话 UI

- 会话列表需要展示 session id、创建时间、cwd、路径提示和父 session 标识。
- 同一个 session id 可能出现多个文件副本，UI key 和操作目标都必须使用 `sessionPath`。
- 恢复外部 cwd 或丢失 cwd 时，extension 会弹出 VS Code 原生确认框，Webview 只展示最终结果。
- 删除、恢复、导入等会改变当前 session 或历史文件的操作应在 pending 状态下禁用，避免重复请求。
- 导入成功、删除成功、恢复成功后重新发送 `request_sessions` 刷新列表。

## 对话 UI

- 根据 `ScoutWebviewState.messages` 渲染 user、assistant、toolResult、branchSummary、compactionSummary、custom。
- assistant/custom content 需要支持 text、thinking、toolCall、image；toolResult 当前协议是 text-only，若要展示图片工具结果需先补协议。
- 支持流式事件 `agent_event` 更新消息，而不是只等完整 state。
- `isStreaming` 为 true 时显示停止按钮并禁用重复发送。
- 支持 `abort`、`abort_retry`、`continue_session`。
- 输入框发送 `user_message`，保留多行编辑、快捷键提交、slash command 候选和 file/context mention 候选能力。

## 模型与工具 UI

- 根据 `config_update` 和 `state_update` 展示当前模型。
- `config_update` 还包含 `branchSummary` 设置，Tree UI 必须按该配置决定默认交互。
- 支持 `select_model`、`select_thinking`。
- thinking level 必须支持 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`；若要按当前模型禁用不可用等级，`config_update` 需要补充模型能力声明，Webview 不应自行猜测 provider 兼容性。
- 根据 `tools` 和 `activeToolNames` 渲染工具列表，发送 `set_active_tools` 更新启用项。

## Tree

- 发送 `request_tree` 获取会话树，消费 `tree_data`。
- Tree 不放在聊天侧边栏内完整展示，而是在 singleton `WebviewPanel` 里实现；具体视觉形态后续再定。
- Tree 功能语义必须对齐 Pi：在当前 session 文件内查看完整会话树，跳到任意历史节点继续，不新建 session 文件。
- 从旧的 user/custom message 重新编辑并提交时，应自动形成新分支；选中 assistant、tool、compaction 等非用户节点后从该节点继续，输入框保持空。
- 选中根 user message 时，应回到空会话并把原始 prompt 回填输入框。
- 分支切换时应支持不总结、默认总结、自定义关注点总结；总结过程中应进入 pending，并允许通过 `abort` 取消。
- Tree 应支持搜索、过滤视图、节点 label 设置/清除；折叠/展开分支段、分支段跳转、label 时间戳显示可作为后续增强。
- Tree 只展示 host/protocol 层输出的 visible entry；当前所在位置以 active leaf 表示，不得把隐藏 metadata raw leaf 暴露为 UI 高亮节点。
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
- Webview tree 只展示 visible entry，host/protocol 层必须把 raw leaf 解析到最近可见 leaf 后再输出，避免隐藏 metadata entry 成为 UI 高亮节点。
- `branchSummary` 消息需要在对话流中作为系统生成的分支检查点展示，至少显示 summary 正文和来源于 tree navigation 的语义。

## 体验要求

- UI 应遵循 VS Code 主题变量，不硬编码大面积品牌色。
- 所有长路径、长 id、长消息都需要处理换行或省略，不能撑破侧边栏。
- 操作失败要展示可读错误，取消操作用轻量提示即可。
- 后续实现时优先复用 `@scout-agent/shared` 类型，但不要泄露 extension 内部类型到 Webview。
