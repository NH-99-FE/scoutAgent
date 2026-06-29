# Scout Extension API

本文档记录 Scout 当前暴露给扩展的 API 边界。类型源以
`packages/extension/src/core/extensions/index.ts` 为准，跨 host/webview 的可序列化协议以
`packages/shared/src/index.ts` 为准。

## 扩展入口

扩展模块默认导出 `ScoutExtensionFactory`：

```ts
import type { ScoutExtensionFactory } from '../packages/extension/src/core/extensions/index.ts';

const extension: ScoutExtensionFactory = (scout) => {
  scout.on('tool_call', async (event, ctx) => {
    // register handlers, tools, commands, or call runtime actions here.
  });
};

export default extension;
```

扩展可通过 `scout.on()` 监听 lifecycle / session / agent / tool 事件，通过
`scout.registerTool()` 注册工具，通过 `scout.registerCommand()` 注册 slash command。
运行期动作包括发送消息、切换工具、设置 session 名称/label、切换模型和 thinking level 等。

## 当前支持的 UI 子集

Scout 当前只支持结构化的轻量 UI 请求。扩展代码不要假定 Pi 的完整 TUI/UI API、
自定义 React 组件渲染、任意表单布局或 VS Code 原生 quick pick/input 能力已经可用。

运行期 handler 和 tool `execute()` 收到的 `ScoutExtensionContext` 提供：

| API | 返回值 | 当前表现 |
|---|---|---|
| `ctx.hasUI` | `boolean` | 当前 host 是否绑定了 webview UI。无 UI 时应自行降级。 |
| `ctx.ui.confirm(title, message, opts?)` | `Promise<boolean>` | 在 webview 中展示确认卡片；取消、超时或 abort 返回 `false`。 |
| `ctx.ui.select(title, options, opts?)` | `Promise<string \| undefined>` | 在 webview 中展示选项按钮；取消、超时或 abort 返回 `undefined`。 |
| `ctx.ui.input(title, placeholder?, opts?)` | `Promise<string \| undefined>` | 在 webview 中展示单行输入；取消、超时或 abort 返回 `undefined`。 |
| `ctx.ui.notify(message, type?)` | `void` | 发送 toast 通知；`type` 为 `info`、`warning` 或 `error`。 |

`confirm`、`select`、`input` 支持的 `opts` 子集：

| 字段 | 说明 |
|---|---|
| `timeout?: number` | 毫秒级超时；超时会关闭请求并返回取消值。 |
| `signal?: AbortSignal` | abort 后关闭请求并返回取消值。 |
| `variant?: 'default' \| 'danger'` | 控制 webview 卡片的视觉强调。 |
| `body?: { kind: 'text' \| 'code'; text: string }` | 附加正文；`code` 使用等宽样式。 |

对应的持久协议类型是 `ScoutExtensionUIRequest`，定义在
`packages/shared/src/protocol-extension-ui.ts`。Webview 回包只能是
`extension_ui_response` 的 `confirm`、`select`、`input` 或 `cancel` action。

### 降级约定

扩展必须先检查 `ctx.hasUI`，尤其是在安全确认、破坏性工具执行或需要用户输入时。
无 UI 时，`ctx.ui` 会使用 no-op 实现：

- `confirm()` 返回 `false`
- `select()` 返回 `undefined`
- `input()` 返回 `undefined`
- `notify()` 不产生可见效果

需要强交互的扩展应在无 UI 时阻止操作或使用非交互逻辑。例如
`examples/extensions/permission-gate.ts` 在无 UI 时会直接阻止危险 bash 命令。

## 不属于当前 UI 子集的能力

以下能力目前不是 Scout 扩展 API 的稳定 UI 面：

- 自定义 dialog、popover、panel 或任意 JSX/React 组件注入。
- 多字段表单、文件选择器、树形选择器、进度条和长生命周期 wizard。
- 扩展自定义 tool call/result renderer 的 webview 执行能力。
- 将 host/webview 内部类型穿透到扩展、agent 或 shared 协议之外。

如果后续新增 UI entry 类型，需要同时明确它的 provider/runtime context、session tree
持久化、host 到 webview 可见投影、raw leaf / visible leaf 语义，并补对应回归测试。
