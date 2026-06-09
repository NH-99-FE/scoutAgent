# Scout Agent — 开发规范

Scout Agent 是简化版 Pi Agent：仅支持 OpenAI 和 Anthropic 两种 provider，仅支持 API key 调用方式。其余行为需与 Pi Agent 完全一致，开发过程与 Pi 高度对齐，对于代码可以直接从 Pi 移植后删除不必要部分。

 - 注：Pi Agent 项目路径为：../pi

## 架构

```
shared（纯契约）← ai（能力层）← agent（业务层）← extension/core（运行编排）
                                                   ↑
                                      extension/host（宿主/协议适配）
                                                   ↖ webview（表现层）
```

- 依赖方向始终向上。禁止反向依赖、跨层依赖、循环依赖。
- Extension ↔ Webview 只通过 shared 消息协议通信，协议源在 `packages/shared/src/index.ts`，`packages/shared/types.ts` 仅作兼容导出；内部类型不得泄露到 postMessage 通道。

## Pi 对齐原则

“与 Pi Agent 完全一致”指同层职责、状态归属、事件顺序和持久化语义一致；不是把 Pi 任意层的实现直接混入 Scout 当前层。

- 对齐 Pi 时必须按层对齐，禁止跨层混用实现语义：
  - `packages/agent/src` 对齐 Pi 的 `packages/agent/src`
  - `packages/extension/src/core/agent-session.ts` 对齐 Pi 的 `packages/coding-agent/src/core/agent-session.ts`
  - `packages/extension/src/core/agent-session-runtime.ts` 对齐 Pi 的 `packages/coding-agent/src/core/agent-session-runtime.ts`
  - `packages/extension/src/core/session-manager.ts` 对齐 Pi 的 `packages/coding-agent/src/core/session-manager.ts`
  - `packages/extension/src/host/session-coordinator.ts` 负责 VS Code 宿主会话协调与 webview 协议适配；不得把 host/UI 协议语义下沉到 core/session。
- agent 包已经按 Pi 的 agent 层对齐，必须保留 Pi agent 中存在的 `harness/session/compaction` 结构；不得把“extension 暂不使用”误判为死代码。
- 不得因为上层需要宿主态 retry/overflow/UI 状态，就把 coding-agent 的宿主编排语义下沉到 agent harness。
- agent 包的职责是 Pi agent 层职责：`Agent`、`agent.state.messages`、agent loop、工具调用、`AgentHarness` direct-loop API、session tree、compaction/tree helper、provider payload/response 生命周期事件。
- extension/session 层负责 Pi 式 runtime context：
  - provider 实际请求上下文以 `agent.state.messages` 为准
  - session tree 是持久历史，不等同于 retry/overflow 时的运行态上下文
  - overflow/retry 恢复只移除 runtime 中失败的 assistant error，不回退 session leaf
- compact、navigateTree、restore 后必须由 extension 从 session context 重建 `agent.state.messages`。
- session tree 低层必须保留 Pi append-only raw leaf 语义：除显式 `leaf` pointer entry 会把 raw leaf 设置为 `targetId` 外，其他 append-only entry（如 `label`、`session_info`、`model_change`、`thinking_level_change`、`custom`）都可以成为 raw leaf；但 host/webview 协议层必须输出 visible leaf，不得把隐藏 metadata id 暴露为 UI 可高亮 leaf。
- Webview tree 可见 entry 必须显式白名单化：默认只展示 `message`、`compaction`、`branch_summary`、`display: true` 的 `custom_message`；新增 entry 类型时必须明确它是否进入 webview tree。
- 修复问题时优先保持 Pi 的结构语义一致；如果发现当前实现需要兼容补丁，应优先考虑上移或重构职责边界。
- 开发完成后必须清理死代码、旧 mock、旧测试语义，避免测试继续暗示错误职责。

## Pi 分层职能

Scout 的分层应按 Pi 的实际代码结构理解：

- `shared`：纯协议与契约层。只定义跨 extension/webview/package 边界使用的类型、消息协议和稳定数据结构，不包含业务逻辑。
- `ai`：模型与 provider 能力层。负责 provider/model 注册表、stream 适配、provider 请求执行、compat 声明和供应商差异处理；不得感知 session tree、extension、webview。
- `agent`：agent 基础运行层。负责 `Agent`、`AgentState`、`agent.state.messages`、Agent loop、工具调用、`AgentMessage`/`AgentEvent`、`AgentHarness` direct-loop API、session tree、compaction、branch summary、provider payload/response lifecycle。不得承接 extension/session 的 UI 状态和宿主级 retry 编排。
- `extension/core`：Pi coding-agent core 对齐层。负责 AgentSession、AgentSessionRuntime、provider runtime context 同步、retry/overflow recovery、auto/manual compaction、extension hooks、resource loading、session manager、session tree/navigation/label。不得感知 VS Code webview 协议。
- `extension/host`：宿主与协议适配层。负责 VS Code 生命周期、配置入口、会话协调、webview 消息映射、ScoutSessionTreeNode 映射、visible leaf 解析、导入/恢复/列表等宿主态交互。
- `webview`：表现层。只消费 `shared/types.ts` 协议展示状态和发送用户意图，不直接感知 agent/extension 内部类型。

### 状态归属

- `session tree` 是持久历史，负责可恢复、可导航、可展示。
- `runtime context` 是下一次 provider 请求实际使用的上下文，负责 retry/overflow/compaction 后的运行态连续性。
- 两者可以在 retry/overflow recovery 期间短暂分叉；这种分叉是设计语义，不是缓存不一致。
- `AgentState.messages` 是 runtime context owner；extension/session 负责在 compact、navigateTree、restore 后把持久 session context 同步回 `agent.state.messages`。
- agent harness 可以提供 direct-loop 的 session tree、compaction、branch summary、tree navigation API；extension/coding-agent 层负责宿主态何时调用、如何同步 runtime、如何通知 UI。
- raw session leaf 与 UI visible leaf 是不同概念：core/session 维护 raw leaf；host/webview 边界负责将 raw leaf 沿 parent 链解析到最近可见 entry。

### 职责判断

- 发现 Scout 与 Pi 不一致时，先定位 Pi 中对应的同层实现，再判断是否需要上移或下移职责。
- 若一个修复需要在 agent 包里保存 UI/宿主运行态，优先怀疑职责放错层；但不得因此删除 Pi agent 层已有的 harness/session/compaction 结构。
- 若一个修复需要 extension 读取 agent 内部类型，或 webview 读取 extension 内部类型，优先重构协议边界。
- 若一个修复需要修改 retry/overflow 语义，优先对照 Pi 的 `packages/coding-agent/src/core/agent-session.ts`。
- 若一个修复需要修改会话替换生命周期，优先对照 Pi 的 `packages/coding-agent/src/core/agent-session-runtime.ts` 与 `AgentSession.bindExtensions()` 里的 `session_start` / `resources_discover` 顺序；`withSession` 必须在新 session 完成 rebind、session_start 和资源发现之后执行。

## 核心模式

**注册表模式**：新增 Provider/Model 只需注册，不改已有代码。内置 provider 通过副作用导入 `import './providers/register-builtins'` 自动注册。`sourceId` 支持批量注销。

**事件协议**：所有供应商流式输出统一为 `AssistantMessageEvent`。Provider 用 fire-and-forget IIFE `(() => { ... })()` 执行异步逻辑，同步返回 `EventStream`。事件是唯一真相来源，partial message 通过事件的 `partial` 字段传递。

**compat 声明**：供应商差异通过 `Model.compat` 集中声明，默认值通过辅助函数处理（如 `getAnthropicCompat`），禁止在业务逻辑中直接 `??` 回退。

## 代码风格

- **barrel file** 是唯一出口，新增导出必须同步更新 `index.ts`
- 类型导出用 `export type {}`，值导出用 `export {}`
- 类型导入始终 `import type`；interface 用于结构，type 用于联合/别名
- 注释：文件头 `// ============` + 中文概述，分节 `// ----------`，行内注释解释"为什么"
- 错误信息必须包含上下文（如 `` `API 不匹配: ${model.api}，期望 ${api}` ``），重抛时用 `{ cause }` 保留链
- 流式函数中错误通过 `error` 事件传递，不中断流
- 命名：文件 kebab-case，类型 PascalCase，函数 camelCase，顶层常量 UPPER_SNAKE，事件类型字符串 snake_case

## 测试

- 测试应按职责同构覆盖关键语义，不强制每个源文件一一对应测试文件；shared 协议、provider registry/stream、agent loop/harness/session、extension lifecycle、session/runtime context、compaction、tree navigation、webview 协议映射必须有 regression test。
- 夹具：`make*` 函数，最小完整 + `overrides` 覆盖式定制
- describe 用被测单元名，it 用英文描述预期行为
- 注册表测试：`beforeEach` 确保初始状态，`afterEach` 清理并恢复内置 provider
- E2E 测试通过 `e2e-utils.ts` 检测凭证，无凭证时 skip
- 开发完成后必须清理旧路径、旧 mock、旧测试语义，避免测试继续暗示错误职责或旧架构。

## 命令

```bash
pnpm dev / build / test / test:watch / lint / lint:fix / format / commit
```

- 包内脚本以对应 `package.json` 为准；例如 extension 包使用 `package` / `check-types`，没有单独 `build` script。

## 开发要求
 - 不需要做兼容性开发，如果发现已开发的部分与pi的实现出现偏差，可进行溯源，并在上层进行重构
 - 修复问题时候，需要考虑后期可扩展可维护无隐患，而不是直接选择最小修复
