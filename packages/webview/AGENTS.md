# Scout Webview — 开发规范

Webview 是表现层，只消费 `@scout-agent/shared` 暴露的协议状态并发送用户意图。它不得直接感知 agent、extension/core 或 extension/host 的内部类型，也不得绕过 shared 协议调用 VS Code/extension 能力。

## 当前架构

- Webview 目前是一个 Vite/React 应用，入口为 `src/main.tsx` 和 `src/App.tsx`。
- `App.tsx` 只做应用 shell：surface 分发、bootstrap 三态、全局通知、lazy/skeleton 边界。不得下沉各 surface 的业务加载、保存、空态、重试或页面内状态编排。
- `App` 通过当前 surface 分发到：
  - `src/surfaces/chat/ChatApp.tsx`：常驻聊天侧栏入口。
  - `src/surfaces/settings/SettingsApp.tsx`：Settings `WebviewPanel`。
  - `src/surfaces/tree/TreeApp.tsx`：Tree `WebviewPanel`。
- surface 来源由 extension 注入 `window.__SCOUT_WEBVIEW_SURFACE__`，开发模式也支持 `?surface=chat|settings|tree`。
- 聊天页是常驻 `WebviewView`；Settings 和 Tree 是 extension host 打开或 reveal 的 singleton `WebviewPanel`。
- Settings 与 Tree 默认允许隐藏时回收 Webview 运行时；重新显示后通过 `ready` 恢复 extension 权威数据。小型临时 UI 状态可用 VS Code webview `setState/getState`，禁止把完整消息、完整 tree 或工具输出等大对象塞入快照。
- 聊天页、设置页和 Tree 页面由 extension host 编排，不互相耦合；三者可以共享 `components/ui`、通用 hooks/utils、store 和 shared 协议类型，但不得共享对方的页面内部组件。

## 目录职责

```text
packages/webview/src/
  App.tsx
  main.tsx
  bridge/
    vscode-api.ts
    surface.ts
    use-webview-bootstrap.ts
    extension-message-router.ts
    extension-event-projector.ts
    protocol-client.ts
    protocol-response-projector.ts
    protocol-route.ts
    transport-client.ts
  store/
    composer-store.ts
    config-store.ts
    conversation-expansion-store.ts
    conversation-store.ts
    runtime-overlay-store.ts
    session-store.ts
    task-store.ts
    tree-store.ts
    ui-store.ts
  surfaces/
    chat/ChatApp.tsx
    settings/SettingsApp.tsx
    tree/TreeApp.tsx
  features/
    chat/
    composer/
    conversation/
    model-menu/
    settings/
    tasks/
    tree/
  components/
    common/
    ui/
  hooks/
  lib/
```

- `surfaces/*` 只做页面级编排和 surface 专属布局。
- `features/*` 放业务组件和该业务域的纯逻辑。
- `components/ui` 只承载 shadcn/Radix 基础交互组件，不写 Scout 业务语义。
- `components/common` 放跨 feature 的轻量通用组件，例如 header、icon button。
- `store` 放跨业务模块共享、需要多个组件或 surface 复用的状态；局部 UI 状态优先留在组件内。
- `bridge` 是唯一 postMessage 封装层；业务组件只能通过 `protocolClient` 表达用户意图。

## 协议边界

- Extension ↔ Webview 只通过 `@scout-agent/shared` 消息协议通信，协议源在 `packages/shared/src/index.ts`。
- Webview 发出的消息必须是 `protocol_request` 或 `protocol_cancel` envelope。
- `requestId` 只属于 transport envelope，用于 response correlation 和 cancel；业务 payload 不得包含 `requestId`。
- 业务 payload 到 `service/method` 的权威路由表是 shared 层的 `SCOUT_PROTOCOL`。`src/bridge/protocol-route.ts` 只负责读取该表。
- Extension 端会按 shared 路由声明校验允许的 surface；Webview 不应从错误 surface 发送命令。
- request-scoped response 由 `transport-client` 按 `requestId` 分发；broadcast/domain event 由 `extension-event-projector` 投影到 store。
- 新增或调整协议时必须同步：
  - `packages/shared/src/index.ts` 的 payload/result/event 类型与 `SCOUT_PROTOCOL`。
  - `src/bridge/protocol-client.ts` 的业务调用入口。
  - `src/bridge/protocol-response-projector.ts` 或 `extension-event-projector.ts` 的状态投影。
  - extension host protocol service 与注册测试。
  - webview bridge 测试。

## Surface 与 Feature 边界

- `chat` surface 负责首页/详情切换、任务打开、新会话入口和 header actions。
- `settings` surface 负责设置页布局；设置读取与写入通过 extension host 协议完成。
- `tree` surface 只展示 host/protocol 层输出的 visible entry，不得把隐藏 metadata raw leaf 暴露为 UI 高亮节点。
- `conversation` 根据 `ScoutWebviewState.messages` 和 runtime event 渲染消息流；消息类型支持范围以 shared 协议为准。
- `tasks` 的 UI key 与操作目标必须使用 `sessionPath`；同一个 session id 可能有多个文件副本。
- 新增大块能力优先拆到 `features/*` 或对应 `surfaces/*` 内，不要塞进通用 store 或 chat surface 内部。

## Tree 语义

- Tree 功能语义必须对齐 Pi：在当前 session 文件内查看完整会话树，跳到任意历史节点继续，不新建 session 文件。
- 从旧的 user/custom message 重新编辑并提交时，应自动形成新分支；选中 assistant、tool、compaction 等非用户节点后从该节点继续，输入框保持空。
- 选中根 user message 时，应回到空会话并把原始 prompt 回填输入框。
- `navigate_tree` 必须携带 `summarize`；自定义总结说明用 `customInstructions`，完全替换默认总结提示词时才传 `replaceInstructions: true`。
- `config_update.branchSummary.skipPrompt` 为 true 时，Tree 跳转交互默认不弹“是否总结被放弃分支”的确认，直接以 `summarize: false` 跳转；用户仍可从高级操作中显式选择总结。
- 分支总结可能触发模型请求；pending 期间应禁用重复跳转、fork、delete 等会改变 session tree 的操作。
- pending 期间停止按钮发送 `abort`，用于取消正在进行的分支总结或其它运行中任务。
- `navigate_tree_result.editorText` 存在时，应把文本回填到输入框而不是立即发送。

## UI 规则

- UI 应遵循 VS Code 主题变量，不硬编码大面积品牌色。
- 所有长路径、长 id、长消息都需要处理换行或省略，不能撑破侧边栏。
- 图标按钮必须有 tooltip/aria label，图标优先使用 `lucide-react`。
- 基础 UI 组件放在 `components/ui`，新增前先复用已有 shadcn/Radix 封装；只有出现明确业务需求时再扩充。
- 操作失败展示可读错误，取消操作用轻量提示即可。

## 测试要求

- 协议路由变化必须覆盖 `packages/webview/test/bridge/protocol-route.test.ts`。
- transport 行为变化必须覆盖 `packages/webview/test/bridge/transport-client.test.ts`。
- extension event / response 投影变化必须覆盖 bridge 或 store 测试。
- 聊天关键交互变化必须覆盖 `packages/webview/test/chat/chat-app.test.tsx`。
- settings/tree surface 交互变化分别覆盖 `packages/webview/test/settings/` 与 `packages/webview/test/tree/`。
- 新增 store 字段必须同步默认值、reset 语义和 selector，并补充必要 store 测试。
