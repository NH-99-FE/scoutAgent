# Scout Agent 工具编排

Scout Agent 的工具系统从**注册、调度、执行到结果回传**形成完整闭环。本文按职责分层梳理工具编排的完整流程，重点解释**并行/串行调度策略**和**单调用批量的冲突避免机制**。

## 一、整体架构

```
[LLM 响应]
   ↓ toolCall 块
① 识别与分发      (agent-loop.ts — executeToolCalls)
   ↓
② 准备 → 执行 → 终结 → 发出   (单工具四阶段生命周期)
   ↓ ToolResultMessage
③ 结果回传 → 下一轮 LLM 调用
```

**关键设计选择**：
- **注册表模式**：工具注册与调用解耦，新增工具不改已有代码
- **协议层依赖**：把时序判断交给 LLM（用多轮对话表达依赖）
- **算法层消除冲突**：edit 等敏感工具用内部算法保证批量操作的正确性

---

## 二、工具的定义与注册

工具分三层定义，从底向上增强：

### 2.1 AI 层基础类型

**文件**：`packages/ai/src/types.ts`

`Tool<TParameters>` 是最基础接口：只有 `name`、`description`、`schema`、`execute`。

### 2.2 Agent 层增强

**文件**：`packages/agent/src/types.ts:382-419` 的 `AgentTool`

在 AI 层基础上加：

- `label`：UI 展示用的人类可读标签
- `promptSnippet` / `promptGuidelines`：注入 LLM 系统提示的简短描述与使用指南
- `prepareArguments`：参数预处理钩子（供应商差异适配）
- `executionMode?: 'sequential' | 'parallel'`：**单工具级**的执行策略覆盖
- `execute()`：异步执行函数，支持 `onUpdate` 流式回调

### 2.3 扩展层定义

**文件**：`packages/extension/src/core/extensions/types.ts:55-88` 的 `ToolDefinition`

再加 UI 渲染钩子：`renderShell`、`renderCall`、`renderResult`。

### 2.4 扩展注册流程

**文件**：`packages/extension/src/core/extensions/loader.ts:149-156`

```ts
registerTool(tool): Promise<void> {
  runtime.assertActive();
  extension.tools.set(tool.name, {
    definition: tool,
    sourceInfo: extension.sourceInfo,  // 记录来源，支持批量注销
  });
  return runtime.refreshTools();
}
```

每个扩展维护自己的 `tools: Map<string, RegisteredTool>`。

---

## 三、工具的收集与合并

### 3.1 跨扩展聚合

**文件**：`packages/extension/src/core/extensions/runner.ts:318-331`

```ts
getAllRegisteredTools(): RegisteredTool[] {
  const toolsByName = new Map<string, RegisteredTool>();
  for (const ext of this.extensions) {
    for (const tool of ext.tools.values()) {
      if (!toolsByName.has(tool.definition.name)) {
        toolsByName.set(tool.definition.name, tool);  // 先注册者胜
      }
    }
  }
  return Array.from(toolsByName.values());
}
```

**同名工具**：先注册的扩展优先。内置工具先注册，扩展在它之后加载即可覆盖（实际靠加载顺序保证）。

### 3.2 包装为 AgentTool

**文件**：`packages/extension/src/core/extensions/wrapper.ts:15-33`

`wrapRegisteredTool()` 把 `RegisteredTool` 转换为 `AgentTool`，在 `execute()` 中注入 `ScoutExtensionContext`，让工具能访问 session、runner 等。

---

## 四、Agent 循环：识别与调度

核心在 `packages/agent/src/agent-loop.ts`。

### 4.1 识别 tool_call

```ts
// agent-loop.ts:387
const toolCalls = assistantMessage.content.filter((c) => c.type === 'toolCall');
```

LLM 流式返回 `AssistantMessageEvent`，agent loop 从最终消息中筛出 `toolCall` 块。

### 4.2 调度决策（`executeToolCalls`，agent-loop.ts:380-409）

```ts
const hasSequentialToolCall = toolCalls.some(
  (tc) => currentContext.tools?.find((t) => t.name === tc.name)
    ?.executionMode === 'sequential',
);
if (config.toolExecution === 'sequential' || hasSequentialToolCall) {
  return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

调度策略：

1. **全局配置** `config.toolExecution`（默认 `parallel`，见 `types.ts:251`）
2. **单工具声明**：任何一个工具声明 `executionMode: 'sequential'`，整批降级为串行（保守策略）

### 4.3 并行执行的两阶段结构（`executeToolCallsParallel`，agent-loop.ts:478-549）

并行模式不是无脑 `Promise.all`，而是分两步：

```ts
// 第一步：依次 prepare（串行）
for (const toolCall of toolCalls) {
  const preparation = await prepareToolCall(...);  // 验证参数 + beforeToolCall 钩子
  finalizedCalls.push(async () => { /* 真正执行 */ });
}

// 第二步：执行并发
const orderedFinalizedCalls = await Promise.all(
  finalizedCalls.map((entry) => entry()),
);
```

**关键性质**：

- **prepare 串行**：参数验证、`beforeToolCall` 钩子按顺序介入
- **execute 并发**：真正耗时的 `tool.execute()` 并发跑
- **结果按 assistant 原始顺序**组装（`Promise.all` 返回数组顺序与输入一致）
- `tool_execution_end` 事件按完成顺序发出（让 UI 尽早渲染）

---

## 五、单工具的四阶段生命周期

| 阶段 | 函数 | 行号 | 作用 |
|---|---|---|---|
| Prepare | `prepareToolCall` | 598-662 | 工具查找 → `prepareArguments` → schema 验证 → `beforeToolCall` 钩子（可 `block`） |
| Execute | `executePreparedToolCall` | 664-699 | 调 `tool.execute(id, args, signal, onUpdate)`，支持流式 `onUpdate`；异常被捕获转错误结果，**不中断流** |
| Finalize | `finalizeExecutedToolCall` | 701-744 | `afterToolCall` 钩子可覆盖 content/details/isError 或 `terminate: true` |
| Emit | 聚合 | 753-784 | 发 `tool_execution_end` + 组装 `ToolResultMessage` |

---

## 六、扩展系统的两个拦截点

### 6.1 `tool_call` 事件（执行前阻止）

**文件**：`runner.ts:705-724`

```ts
for (const handler of handlers) {
  const handlerResult = await handler(event, ctx);
  if (handlerResult?.block) return result;  // 短路
}
```

任何扩展返回 `block: true` 立即终止，工具不执行。

### 6.2 `tool_result` 事件（结果后处理）

**文件**：`runner.ts:729-770`

顺序 patch 合并：每个扩展依次可覆盖 `content` / `details` / `isError`，后处理者覆盖前者。**聚合而非短路**。

---

## 七、结果回传与下一轮决策

**文件**：`agent-loop.ts:206-260`

```ts
const toolResults: ToolResultMessage[] = [];
if (toolCalls.length > 0) {
  const executedToolBatch = await executeToolCalls(...);
  toolResults.push(...executedToolBatch.messages);
  hasMoreToolCalls = !executedToolBatch.terminate;

  for (const result of toolResults) {
    currentContext.messages.push(result);  // 注入对话历史
    newMessages.push(result);
  }
}

await emit({ type: 'turn_end', message, toolResults });

// prepareNextTurn 钩子：可换模型、调 thinking level、改 context
// shouldStopAfterTurn 钩子：可提前 agent_end
// getSteeringMessages：用户可中途注入新消息
```

下一轮 LLM 调用时，所有 `ToolResultMessage` 已在 `context.messages` 里，LLM 据此决定继续 tool_call 还是产出最终回复。

---

## 八、并发控制

### 8.1 Agent 级

**文件**：`agent.ts:456-464`

通过 `AbortController` 统一管理，`abort()` 立即生效。

### 8.2 工具级

`signal` 透传到 `tool.execute()`，工具内部应主动检查 `signal.aborted`。

### 8.3 异常隔离

单工具异常被捕获转成 error result，**不影响同批其他工具**，也不中断整个 agent loop。

---

## 九、并行模式下如何避免时序冲突

这是工具编排的核心难点。Scout 采用**三层防线**。

### 9.1 第一层：协议层（LLM 负责数据依赖）

LLM 只能在**已经拿到结果**的基础上决定下一步。它没法预测一个还没执行的工具会返回什么。

所以：

- **没依赖** → LLM 一次发多个 tool_call → Scout 并行跑
- **有依赖**（A 的输出是 B 的输入）→ LLM **物理上没办法**把它们放同一条消息 → 自然分轮

这就是为什么 Scout 敢放心并行：同批次的 tool_call，从协议设计上就被 LLM 主动声明为"互不依赖"。

### 9.2 第二层：声明层（`executionMode`）

针对**非数据依赖**的资源冲突（如多个工具修改同一全局状态），工具作者可声明：

```ts
{ name: 'some_sensitive_tool', executionMode: 'sequential' }
```

只要这批里**任何一个**工具声明 `sequential`，整批降级为串行。这是工具级的粗粒度兜底。

### 9.3 第三层：算法层（工具内部细粒度锁）

文件类工具（如 edit）用更精细的方案替代 `executionMode`——见下一节。

---

## 十、案例研究：Edit 工具的冲突避免

`edit` 是工具编排里最经典的冲突场景：LLM 可能连发多个 edit 处理同一个文件，如何保证不丢改动？

### 10.1 三层防线（具体到 edit）

| 层 | 位置 | 作用 |
|---|---|---|
| Schema 设计 | `edit.ts:45-54` | 引导 LLM 单调用批量，而非多调用 |
| 匹配语义 | `edit-diff.ts:168-237` | 同批 edits 都匹配原文件，避免中间态依赖 |
| 文件突变队列 | `file-mutation-queue.ts` | 运行时串行化同文件写入 |

### 10.2 Schema 引导：单调用批量

**文件**：`packages/extension/src/core/tools/edit.ts:45-54`

```ts
const editSchema = Type.Object({
  path: Type.String(...),
  edits: Type.Array(replaceEditSchema, {
    description:
      'Each edit is matched against the original file, not incrementally. ' +
      'Do not include overlapping or nested edits. ' +
      'If two changes touch the same block or nearby lines, merge them into one edit instead.',
  }),
});
```

配合 `promptGuidelines`（`edit.ts:162-167`）：

> "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls"

接口设计主动引导 LLM 走"单调用批量"而非"多调用并行"。

### 10.3 关键算法：逆序应用

**文件**：`packages/extension/src/core/tools/shared/edit-diff.ts:168-237`

```ts
export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): AppliedEditsResult {
  // 1. 全部定位：所有 edits 在原始内容上 indexOf
  const matchedEdits: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const matchResult = fuzzyFindText(baseContent, edit.oldText);
    if (!matchResult.found) throw getNotFoundError(...);

    const occurrences = countOccurrences(baseContent, edit.oldText);
    if (occurrences > 1) throw getDuplicateError(...);  // 唯一性检测

    matchedEdits.push({
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    });
  }

  // 2. 按位置排序 + 重叠检测
  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matchedEdits.length; i++) {
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(`edits[...] overlap`);
    }
  }

  // 3. 逆序应用：从后往前替换
  let newContent = baseContent;
  for (let i = matchedEdits.length - 1; i >= 0; i--) {
    const edit = matchedEdits[i];
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength);
  }

  return { baseContent, newContent };
}
```

### 10.4 为什么"逆序"能解决行号变化问题

**核心洞察**：字符串前面部分的偏移量，**只受"位置比它更靠前的改动"影响**，不受"位置比它更靠后的改动"影响。

| 应用顺序 | 问题 |
|---|---|
| 正序（先改 AAA） | AAA 改完后，BBB 的偏移量从 4 变成 6 → 失效 |
| 逆序（先改 CCC） | CCC 在最后，改完它之后，前面 AAA/BBB 的偏移量**完全没变** → 仍有效 |

#### 演示例子

原始文件：

```
AAA
BBB
CCC
```

LLM 发 3 个 edit（多行插入）：

| edit | oldText | newText |
|---|---|---|
| 0 | `AAA` | `AAA\nA1\nA2` |
| 1 | `BBB` | `BBB\nB1` |
| 2 | `CCC` | `CCC\nC1` |

**步骤 1：全部定位**（基于原始内容）

```
matchedEdits = [
  { editIndex: 0, matchIndex: 0, matchLength: 3 },  // "AAA"
  { editIndex: 1, matchIndex: 4, matchLength: 3 },  // "BBB"
  { editIndex: 2, matchIndex: 8, matchLength: 3 },  // "CCC"
]
```

**步骤 2：逆序应用**

| i | 操作 | newContent |
|---|---|---|
| 2 | 替换 [8, 11) → `CCC\nC1` | `AAA\nBBB\nCCC\nC1\n` |
| 1 | 替换 [4, 7) → `BBB\nB1` | `AAA\nBBB\nB1\nCCC\nC1\n` |
| 0 | 替换 [0, 3) → `AAA\nA1\nA2` | `AAA\nA1\nA2\nBBB\nB1\nCCC\nC1\n` |

最终：

```
AAA
A1
A2
BBB
B1
CCC
C1
```

每一步用到的偏移量都基于原始内容，因为后面的改动不影响前面字符串的偏移。

### 10.5 文件级突变队列

**文件**：`packages/extension/src/core/tools/shared/file-mutation-queue.ts:36-65`

```ts
const fileMutationQueues = new Map<string, Promise<void>>();

export async function withFileMutationQueue<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = await getMutationQueueKey(filePath);  // 用 realpath 分桶
  const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

  let releaseNext!: () => void;
  const nextQueue = new Promise<void>((resolveQueue) => {
    releaseNext = resolveQueue;
  });
  const chainedQueue = currentQueue.then(() => nextQueue);
  fileMutationQueues.set(key, chainedQueue);

  await currentQueue;  // 等前一个完成
  try { return await fn(); }
  finally { releaseNext(); }
}
```

**语义**（注释里写得很清楚）：

> 序列化对同一文件的突变操作。**不同文件的操作仍然并行执行**。

| 场景 | 行为 |
|---|---|
| 并行 edit `a.txt` × 3 | 串行化（同文件排队） |
| 并行 edit `a.txt` + edit `b.txt` | 真并行 |
| 并行 edit `a.txt` + read `a.txt` | read 不走队列（edit 内部是原子的） |

key 用 `realpath`，符号链接也认得同一个文件。

### 10.6 为什么不用 `executionMode: 'sequential'`？

`edit.ts` 全文没有声明 `executionMode`。这是有意为之：

- `executionMode: 'sequential'` 是**工具级**的，会让整批都串行（哪怕同时有 `edit(a)` 和 `edit(b)` 也不得不串行）
- `withFileMutationQueue` 是**文件级**的，粒度更细——只串行化真正冲突的写操作

用工具内部的细粒度锁替代外层的粗粒度声明，**既保证正确性，又不损失并行性**。

---

## 十一、设计哲学总结

| 责任方 | 防什么 | 机制 |
|---|---|---|
| LLM | 数据依赖（A 的输出是 B 的输入） | 用多轮对话表达依赖，同批次即声明独立 |
| 工具作者（`executionMode`） | 资源冲突（同改一个全局状态） | 工具级声明，整批降级串行 |
| 工具作者（内部锁） | 细粒度冲突（同文件并发写） | 文件级队列、行号稳定算法 |
| 运行时（agent-loop） | 异常隔离、取消传播 | 异常捕获转 error result，AbortSignal 统一取消 |

**核心理念**：Scout 不主动检测跨工具的语义冲突。它假设：

1. 有依赖的工具调用，LLM 会分多轮发
2. 同批次的就是独立的，运行时直接并行
3. 工具作者用细粒度内部机制处理资源冲突

这是务实的设计：真正的跨工具依赖图分析成本高且不可靠，而 tool calling 协议本身（多轮往返）天然就是表达依赖的最强机制。把并行限制在"LLM 认为安全的范围内"，是当下工具编排系统的主流做法。
