# Scout Agent — 开发规范

Scout Agent 是简化版 Pi Agent：仅支持 OpenAI 和 Anthropic 两种 provider，仅支持 API key 调用方式。不做扩展命令系统。其余行为需与 Pi Agent 完全一致，开发过程与 Pi 高度对齐，对于代码可以直接从 Pi 移植后删除不必要部分。

 - 注：Pi Agent 项目路径为：..\pi

## 架构

```
shared（纯契约）← ai（能力层）← agent（业务层）← extension（宿主）
                                                   ↖ webview（表现层）
```

- 依赖方向始终向上。禁止反向依赖、跨层依赖、循环依赖。
- Extension ↔ Webview 只通过 `shared/types.ts` 的消息协议通信，内部类型不得泄露到 postMessage 通道。

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

- `test/` 与 `src/` 同构，每个源文件必须对应一个测试文件
- 夹具：`make*` 函数，最小完整 + `overrides` 覆盖式定制
- describe 用被测单元名，it 用英文描述预期行为
- 注册表测试：`beforeEach` 确保初始状态，`afterEach` 清理并恢复内置 provider
- E2E 测试通过 `e2e-utils.ts` 检测凭证，无凭证时 skip

## 命令

```bash
pnpm dev / build / test / test:watch / lint / lint:fix / format / commit
```
