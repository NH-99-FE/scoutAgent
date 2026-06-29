# Scout Shared - 开发规范

`packages/shared` 是 Extension 与 Webview 之间唯一的公开契约层。这里的代码只描述可序列化协议、稳定数据结构和少量常量，不承载业务流程、UI 行为、provider 逻辑或宿主运行态。

## 职责边界

- `shared` 是纯契约包，只允许被 `extension`、`webview` 以及必要的测试读取；不得反向导入 `ai`、`agent`、`extension`、`webview` 的内部类型或实现。
- Extension ↔ Webview 的 postMessage 通道只能使用 `@scout-agent/shared` 暴露的类型和常量。内部类型必须在 host/webview 边界先映射为 shared 契约。
- 此包保持轻依赖，默认不新增运行时依赖。校验、持久化、协议执行、状态投影都放在使用方层级。
- 这里可以放稳定常量、联合类型、接口和协议路由表；不要放会访问文件系统、VS Code API、模型 provider、session tree 原始结构或 Webview DOM 的逻辑。
- Scout 仅支持 OpenAI 与 Anthropic provider。`SCOUT_MODEL_PROVIDERS`、模型设置和自定义模型契约不得绕过这一产品边界扩展其它 provider。

## 文件分工

- `src/index.ts` 是包的唯一公开出口。新增对外契约必须在这里同步导出，并区分 `export {}` 与 `export type {}`；消费者统一从 `@scout-agent/shared` 导入。
- `src/protocol.ts` 是包内协议聚合模块，由 `src/index.ts` 统一公开；消费者不得绕过 `@scout-agent/shared` 主入口直接依赖内部路径。
- `src/protocol-core.ts` 放跨协议复用的基础结构，例如 surface、source、tool、command、diagnostic、session tree 可见节点、session/task/file mention 摘要。
- `src/protocol-state.ts` 放 Webview 状态快照、消息内容块、队列、busy state、上下文用量和工具预览等状态契约。
- `src/protocol-requests.ts` 放 Webview→Extension 的 payload union、transport envelope、cancel/control message 和 `SCOUT_PROTOCOL` 路由表。
- `src/protocol-results.ts` 放请求级 response payload。只有会被 `protocol_response.payload` 返回的结构放这里。
- `src/protocol-events.ts` 放 Extension→Webview 的 broadcast/domain event、runtime event 和 response envelope。
- `src/models.ts` 放模型、provider、thinking level 与自定义模型设置契约。
- `src/settings.ts` 放运行时设置、设置 patch、允许 patch 的路径白名单和 settings state。

## 可序列化契约

- 所有跨边界字段必须可 JSON 序列化：`string`、`number`、`boolean`、`null`、数组、普通对象。
- 禁止在 shared 类型中出现 `Date`、`Error`、`Map`、`Set`、`Promise`、`Buffer`、`BigInt`、函数、类实例、DOM/VS Code 类型或 agent 内部对象。
- 时间字段沿用当前契约：消息/UI 快照使用 `timestamp: number`，树节点/会话列表使用字符串时间；新增字段前先选定并记录清楚语义。
- 错误跨协议传递时使用可读字符串或 `ScoutProtocolError` 这类扁平对象，不透传原始异常。
- `unknown` 只能用于确实由上层解释的开放结构，例如 tool parameters、tool details、provider compat；新增 `unknown` 字段必须说明解释方。
- 大内容必须考虑体积和展示投影。Webview 状态不要塞完整原始 session、完整工具输出或不可裁剪的 provider response。

## 协议变更清单

新增或修改 Webview→Extension 请求时必须同步检查：

1. 在 `WebviewRequestPayload` 增加或更新 payload，业务字段不得包含 `requestId`；`requestId` 只属于 transport envelope。
2. 在 `SCOUT_PROTOCOL` 增加同名路由，并明确 `kind`、`service`、`method`、`response`、`emits`、`surfaces`。
3. 若有请求级返回，在 `protocol-results.ts` 增加 response payload，并纳入 `ScoutProtocolResponsePayload`。
4. 若会广播事件，在 `protocol-events.ts` 增加 `ExtensionEventMessage` 成员，并同步 `EXTENSION_TO_WEBVIEW_MESSAGE_TYPES`。
5. 同步 `protocol.ts` 与 `index.ts` 的公开导出。
6. 同步 extension host protocol service、payload guard、domain event publisher、webview protocol client、response/event projector。
7. 补或更新 extension/webview 回归测试，确保路由、surface、payload guard、投影行为一致。

协议约束：

- 新协议默认使用 `protocol_request` / `protocol_response` / domain event；不要新增散落的 top-level message 类型。现有 `control_abort` 与 `control_abort_retry` 只保留既有兼容语义。
- `SCOUT_PROTOCOL` 是 payload type 到 service/method/surface 的权威路由表。业务代码不应复制一份平行路由。
- 每个 route 都必须声明可用 `surfaces`。如果某个 surface 暂不支持，宁可让 host guard 拒绝，也不要让 Webview 猜测。
- `emits` 只写真实可能发生且已存在于 `ExtensionEventMessage` 的事件名，避免 Webview 订阅不存在的事件。
- 删除或重命名协议时不做旧协议兼容开发；同步清理旧 mock、旧测试语义和旧文档名。

## 状态与 Tree 语义

- `ScoutWebviewState` 是 host 投影给 Webview 的运行态快照，不是 agent runtime context，也不是 session tree 原始持久历史。
- 流式过程以 `agent_event`、`runtime_state_update`、`tool_call_preview_update` 等事件增量投影；`bootstrap_result`、`state_result`、`state_update` 负责快照同步。
- `ScoutMessage` 是可展示消息模型，必须由 extension/host 从 agent 内部消息映射得到。不要把 provider payload、agent event 原始对象或 session entry 原样塞进 message。
- `ScoutSessionTreeNode` 是 host→webview 的可见 tree 投影。不得把低层隐藏 metadata raw leaf 暴露成 Webview 可高亮节点。
- `leafId` 在 shared 协议中表示 Webview 可见 leaf；raw leaf 到 visible leaf 的解析属于 extension/host，不属于 shared。
- 新增 tree node kind 或 message role 时，必须同时明确：是否进入 provider/runtime context、是否参与 compaction/branch summary、是否进入 host→webview 可见投影、raw leaf 与 visible leaf 的解析规则，并补回归测试。
- session/task 操作的目标优先使用 `sessionPath`。同一个 session id 可能有多个文件副本，不要只靠 id 表达可变文件操作目标。

## Models 与 Settings

- `models.ts` 只定义跨层可见的模型配置形状。provider API 适配、compat 默认值、thinking budget 解释应留在 `ai` 或 extension 配置层。
- `ScoutCustomModelsProviderSettings` 与 `ScoutCustomModelsProviderMetadata` 必须保持 provider scoped，且 provider 范围受 `SCOUT_MODEL_PROVIDERS` 约束。
- 新增运行时设置时必须同步 `ScoutRuntimeSettings`、`SCOUT_RUNTIME_SETTINGS_PATHS`、`ScoutRuntimeSettingsPatch` 相关消费方、extension schema/manager 和 settings Webview UI。
- `SCOUT_RUNTIME_SETTINGS_PATHS` 是 patch 白名单；不得接受任意字符串路径，也不要在使用方私下扩展路径。
- 设置字段只描述用户可配置契约。派生值、运行中 busy 状态、重试计数、资源发现结果等运行态不放入 settings。

## 导出与命名

- 新增类型使用 `interface` 表达对象结构，使用 `type` 表达联合、别名和字面量集合。
- 类型导入一律使用 `import type`。
- 常量命名使用 `SCOUT_*` 或领域内稳定大写名；事件类型、payload type、role、kind 字符串使用 `snake_case` 或当前文件既有风格。
- 文件保持 kebab-case。新增公开契约必须通过 `src/index.ts` 明确纳入包主入口；协议分组可先汇总到 `src/protocol.ts`，再由 `src/index.ts` 导出。
- 文件头继续使用 `// ============================================================` 与中文概述，分节使用 `// ----------`。

## 测试与验证

- 修改 shared 源码后至少运行 `pnpm -C packages/shared check-types`。
- 修改协议路由或 payload 时，优先补 `packages/extension/test/host/protocol/protocol-registration.test.ts`、`protocol-guards.test.ts`、相关 service 测试，以及 `packages/webview/test/bridge/protocol-route.test.ts` / `transport-client.test.ts`。
- 修改 `ExtensionEventMessage`、runtime event 或投影状态时，补 host event mapper/forwarder/coalescer 测试和 webview projector/store 测试。
- 修改 `ScoutMessage`、内容块或 busy/queue/state 字段时，补 conversation store、conversation view 或 chat app 相关测试。
- 修改 tree 契约时，补 `session-tree-mapper`、tree store/model/row/app 测试，覆盖 visible leaf 与节点 kind。
- 修改 models/settings 契约时，补 extension config/runtime settings schema/manager 测试，以及 settings Webview 草稿或页面测试。
- 纯文档改动不要求跑测试，但最终说明中要明确未运行测试。
