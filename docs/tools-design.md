# Scout 工具体系设计哲学与实现剖析

> 范围：`packages/extension/src/core/tools/`、`packages/agent/src/agent-loop.ts`、`packages/ai/src/validation.ts`
> 目的：讲清 7 个内置工具的设计取舍、串行/并行执行机制、前置校验链路、截断与上下文影响，并给出面试中常见的延伸问题。
> 关联文档：`docs/event-driven-architecture.md`、`docs/tool-orchestration.md`、`docs/webview-protocol.md`

---

## 1. 全景：工具系统的三层骨架

Scout 工具体系由三层构成，每层职责严格隔离：

```
ToolDefinition（extension/core/tools/*）
      │  wrapToolDefinition()
      ▼
AgentTool（agent runtime 消费）
      │  agent-loop.ts 调用 execute()
      ▼
Provider Tool Schema（ai 层 LLM 协议）
```

- **ToolDefinition**：定义"name + label + description + parameters(TypeBox Schema) + execute + 可选 promptSnippet/promptGuidelines/prepareArguments/executionMode/presentation"。这是工具的"源"，扩展插件也按这个接口注册。
- **AgentTool**：通过 `wrapToolDefinition()` 包装后的产物，是 agent runtime 唯一消费的对象。包装层只做"把 ToolDefinition 的 execute 适配成 AgentTool.execute 签名"这一件事（见 `tool-definition-wrapper.ts:10-31`）。
- **Provider Tool**：在 ai 层通过 `Tool<TParameters>` 暴露给 LLM，schema 走 TypeBox，再编译为各 provider 兼容的 JSON Schema。

设计哲学：**"定义-包装-执行"三段式**。任何工具——无论是内置 read/bash，还是扩展插件注册的——都走同一契约，runtime 不需要知道工具来源。

---

## 2. 七个内置工具一览

```ts
// tool-profiles.ts:24
export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;
```

| 工具   | 主要入参                         | 是否流式 | 截断策略                  | 突变队列 | 二进制依赖 |
| ------ | -------------------------------- | -------- | ------------------------- | -------- | ---------- |
| read   | path / offset / limit            | 否       | head 截断 + offset 续读   | 否       | 无         |
| bash   | command / timeout                | 是       | tail 截断 + 临时文件      | 否       | bash shell |
| edit   | path / edits[]                   | 否       | N/A                       | 是       | 无         |
| write  | path / content                   | 否       | N/A                       | 是       | 无         |
| grep   | pattern / path / glob / limit... | 否       | head 截断 + 单行截断      | 否       | rg         |
| find   | pattern / path / limit           | 否       | head 截断                 | 否       | fd         |
| ls     | path / limit                     | 否       | head 截断                 | 否       | 无         |

两个内置 profile：

- **开发模式**（默认）：`read, bash, edit, write` + 扩展工具。允许写操作和命令执行。
- **审查模式**：`read, grep, find, ls`，`includeExtensionTools: false`。纯只读，适合 review/审计场景。

profile 机制让"工具集"成为运行时可切换的策略，而不是写死的清单。

---

## 3. 设计哲学五条主线

### 3.1 开放封闭：注册表 + 工厂

每个工具都通过 `create*ToolDefinition(cwd, options?)` 工厂函数构造，注入 `options.operations` 即可整体替换底层文件/shell 操作（例如远程 SSH）：

```ts
// read.ts:46-58
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}
const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

`bash`、`edit`、`write`、`grep`、`find`、`ls` 全部有同名 `*Operations` 接口。**这是"远端化"和"测试替身"的统一入口**——业务层不直接碰 fs/child_process，永远走 operations 抽象。

### 3.2 事件协议：fire-and-forget IIFE

`read`、`grep`、`find`、`ls` 都用同一种结构：

```ts
return new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('Operation aborted')); return; }
  const onAbort = () => reject(new Error('Operation aborted'));
  signal?.addEventListener('abort', onAbort, { once: true });
  (async () => {
    try { /* ... */ resolve({...}); }
    catch (e) { reject(e); }
    finally { signal?.removeEventListener('abort', onAbort); }
  })();
});
```

同步注册好 abort 监听后立即返回 Promise，异步主体在 IIFE 里跑。**关键点：abort 信号先注册再 await**，避免 await 期间 abort 触发但监听未挂上导致的"窗口期"。

`bash` 走另一种结构——`OutputAccumulator` + throttle 推送 `onUpdate`——因为 bash 是唯一需要真正流式增量反馈的工具（详见 §6.2）。

### 3.3 有界输出：四道截断闸门

`shared/truncate.ts` 是所有工具输出的"统一计量局"：

```ts
DEFAULT_MAX_LINES = 2000
DEFAULT_MAX_BYTES = 50 * 1024  // 50KB
GREP_MAX_LINE_LENGTH = 500
```

- `truncateHead`：保留前 N 行/字节，用于 read/grep/find/ls。
- `truncateTail`：保留末尾 N 行/字节，用于 bash 流式（用户通常关心结尾的退出码/错误）。
- `truncateLine`：单行截断到 500 字符，仅 grep 使用，防止 minified 文件一行撑爆上下文。

`truncateHead` 的边缘处理值得注意：首行超过字节上限时返回空内容 + `firstLineExceedsLimit: true`，调用方（read）会给出 `sed | head -c` 的具体降级指令，而不是把 0 行内容默默吞掉。

### 3.4 突变串行：file-mutation-queue

edit 和 write 都通过 `withFileMutationQueue(absolutePath, fn)` 序列化对**同一文件**的并发写：

```ts
// shared/file-mutation-queue.ts:36-65
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = await getMutationQueueKey(filePath);  // realpath 解析软链
  const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();
  const nextQueue = new Promise<void>((resolveQueue) => { releaseNext = resolveQueue; });
  const chainedQueue = currentQueue.then(() => nextQueue);
  fileMutationQueues.set(key, chainedQueue);
  await currentQueue;
  try { return await fn(); }
  finally { releaseNext(); ... }
}
```

要点：
- **按 realpath 作为 key**：避免符号链接/相对路径绕过锁。
- **不同文件不互斥**：只锁同一路径，多个文件可并行写。
- **abort 不在 listener 里 reject**：edit/write 在每个 `await` 后检查 `signal.aborted`，不在 abort 监听器中抛错。原因是如果在 fs 操作飞行中释放队列，下一个等待者会在不一致的中间状态下进入。注释明确写了这条原则（`edit.ts:177-182`、`write.ts:107-113`）。

### 3.5 review 捕获：Operations decorator + Mutation Journal

edit 和 write 的公开工具契约、execute 主体与返回值保持 Pi 语义。Scout 不再让工具 `details` 携带原文/改文，而是在装配层用 Operations decorator 捕获文件突变：

- edit decorator 复用本次 `readFile` 的 Buffer 作为 before snapshot；
- write decorator 通过 snapshot provider 获取 baseline；
- `writeFile` 成功返回后向 append-only `MutationJournal` 提交 record；
- 单 Diff Worker 为 file revision 生成 canonical `DiffDocument`；
- `AgentSession` 最终只返回轻量 `file_change` details，包含 turn/record/file/revision/status identity。

`MAX_REVIEW_TEXT_BYTES` 仍限制 snapshot/diff 输入。超大、二进制或不可用内容只让 review projection 降级，不改变 edit/write 的成功语义。完整 rows 和 syntax tokens 只在用户展开聊天工具行或 review panel 文件后，通过 lazy diff 协议生成。

---

## 4. 各工具参数与实现细节

### 4.1 read — 带续读指针的文件查看

参数：`path / offset(1-indexed) / limit`。

行为分支：
1. **图片检测**：`detectImageMimeTypeFromFile` 返回非空 → vision 模型发 base64 image，非 vision 模型返回占位文本。
2. **文本**：按 `offset` 切片 + `truncateHead` 截断。截断时附 `[Showing lines X-Y of Z. Use offset=N to continue.]`，把"下一页指针"直接放进上下文。
3. **首行超限**：返回 `sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}` 指令，引导模型改走 bash。
4. **用户指定 limit**：即使没触发截断，若文件仍有剩余行，也提示 `Use offset=N to continue`。

设计取舍：read **不**用 truncateTail 而用 truncateHead——文件阅读需要从头到尾顺序理解，截尾会丢失中间上下文。配合 `offset` 续读，模型可以"翻页"。

### 4.2 bash — 流式累加 + 进程树治理

参数：`command / timeout(秒)`。

`BashOperations.exec` 是可替换的执行器，默认 `createLocalBashOperations`：
- shell 发现顺序：customShellPath → Windows Git Bash → PATH bash → /bin/bash → sh（`shell-config.ts:61-101`）。
- `spawn(shell, [...args, command], { detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] })`。
- Windows 不 detached：因为 Windows 没有进程组，detached 反而会让 taskkill /T 难以收敛。

**流式输出**：`OutputAccumulator` 维护三个并行计数：`totalRawBytes / totalDecodedBytes / totalLines`。超过 `maxBytes` 或 `maxLines` 时**自动溢出到临时文件**，内存只保留 `maxRollingBytes` 的滚动尾段。每 100ms throttle 一次 `onUpdate` 推送，避免高频 chunk 淹没 webview。

**进程树杀灭**：`killProcessTree` 在 Windows 用 `taskkill /F /T /PID`，Unix 先 `kill(-pid, SIGKILL)`（整个进程组）失败再退回 `kill(pid)`。`waitForChildProcess` 处理 Windows 上"子进程已 exit 但 stdio 句柄被子进程的子进程继承导致 close 不触发"的挂起问题：exit 后给 100ms 宽限期，超时强制 destroy stream。

**detached pid 全局跟踪**：`trackDetachedChildPid/untrackDetachedChildPid` 维护一个进程级 Set，便于 session 结束时批量清理。

**错误语义**：
- abort：`throw new Error(appendStatus(text, 'Command aborted'))`，把已收到的输出作为 cause 附带上。
- timeout：`'timeout:123'` 编码秒数，在错误信息里展开为 `Command timed out after 123 seconds`。
- 非零退出码：`Command exited with code N`，输出仍保留。

### 4.3 edit — 精确替换 + 模糊容错

参数：`path / edits[]`（每个 edit = `{ oldText, newText }`）。

链路：
1. `prepareArguments`（edit 是唯一有此钩子的内置工具）：处理两类 provider 噪声——
   - 把 JSON 字符串形态的 `edits` 解析回数组。
   - 兼容旧版 top-level `oldText/newText`：合并进 `edits` 数组。
2. `validateEditInput`：`edits` 必须非空。
3. `withFileMutationQueue` 进入。
4. `access` 检查 R_OK|W_OK；`readFile` 读原文；`stripBom` 去掉 BOM（模型不会在 oldText 里写 BOM）。
5. `detectLineEnding` 检测 CRLF/LF，`normalizeToLF` 归一化用于匹配。
6. `applyEditsToNormalizedContent`：
   - 每个 edit 先 `fuzzyFindText`：先精确 `indexOf`，失败则 `normalizeForFuzzyMatch`（NFKC + trimEnd + 智能引号/破折号/空格归一化）再匹配。
   - `countOccurrences` 必须 == 1，否则报"找到 N 处，需要更多上下文"。
   - 按匹配位置排序，检查 `prev.end > curr.start` 的重叠，重叠则报"合并到一个 edit"。
   - **逆序应用**以保持偏移稳定。
7. `restoreLineEndings` 还原 CRLF，`bom + finalContent` 写盘。

错误消息按 `edits.length === 1` 与否分支：单 edit 时不说 `edits[0]`，直接说 `the text`，更友好。

### 4.4 write — 带原内容捕获的覆盖写

参数：`path / content`。

链路短：`resolveToCwd` → `withFileMutationQueue` → `captureExistingContentForReview`（先 stat 检查 size，超 `MAX_REVIEW_TEXT_BYTES` 标记 `Diff too large`；ENOENT 视为新文件）→ `mkdir -p` → `writeFile`。

设计取舍：write 不做"是否已存在"的预检查，而是 try/catch ENOENT 在 review 捕获阶段处理。原因：避免 TOCTOU（检查和写之间被别的进程创建/删除）。

### 4.5 grep — ripgrep 包装 + 流式收集

参数：`pattern / path / glob / ignoreCase / literal / context / limit`。

`rg --json --line-number --color=never --hidden` + 可选 `--ignore-case / --fixed-strings / --glob`。

关键点：
- **流式收集**：`rl.on('line', ...)` 解析 JSON，只缓存 `{filePath, lineNumber, lineText}`，达到 `effectiveLimit` 立即 `child.kill()` 并设 `matchLimitReached`。
- **上下文行**：`context > 0` 时不直接用 rg 的 `lineText`，而是 `getFileLines(filePath)` 异步读完整文件、取 `[line-context, line+context]` 区间。`fileCache` Map 避免同文件重复读。
- **单行截断**：`truncateLine` 500 字符上限，`wasTruncated` 标志聚合到 details。
- **rg 退出码 1**（无匹配）视为正常；非 0 非 1 且无输出才报错。

`ensureTool('rg', silent, { signal })` 在 `getToolPath` 找不到本地或系统 rg 时，从 GitHub releases 自动下载对应平台二进制到 `~/.scout/bin/`。`SCOUT_OFFLINE=1` 可禁用下载。

### 4.6 find — fd 包装 + 路径相对化

参数：`pattern / path / limit`（pattern 是 glob）。

fd 调用：`fd --glob --color=never --hidden --no-require-git --max-results N`。

`--no-require-git` 是关键：让 fd 在搜索路径**不在** git 仓库内时也应用层级 .gitignore，而不会用全局 ignore 文件泄漏兄弟目录规则。

pattern 含 `/` 时切换到 `--full-path` 并自动前缀 `**/`，让 `src/**/*.spec.ts` 这类深路径 pattern 能匹配。

输出按搜索根目录相对化（`toPosixPath`），保持跨平台稳定。`limit` 默认 1000，到顶时提示 `Use limit=2000 for more`。

### 4.7 ls — 简单但必要的目录索引

参数：`path / limit(默认 500)`。

不做文件大小、不做时间戳、不做权限——只返回"名字 + 目录后缀 `/`"。**刻意的简陋**：ls 的作用是让模型快速建立目录骨架认知，多余元信息只会膨胀上下文。

`limit` 到顶时提示 `Use limit=1000 for more`，与 grep/find 的提示风格一致。

---

## 5. 串行 vs 并行：执行模式剖析

### 5.1 模式选择

```ts
// agent-loop.ts:387-408
const hasSequentialToolCall = toolCalls.some(
  (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === 'sequential',
);
if (config.toolExecution === 'sequential' || hasSequentialToolCall) {
  return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

判定逻辑：**任一**被调工具声明 `executionMode: 'sequential'`，整个批次降级为串行。内置 7 个工具都**未**显式声明 `executionMode`，因此默认走 parallel 路径。扩展工具可以单独标记自己必须串行。

### 5.2 两种实现的关键差异

| 维度         | executeToolCallsSequential           | executeToolCallsParallel                           |
| ------------ | ------------------------------------- | -------------------------------------------------- |
| 预检顺序     | 串行：prepare → execute → finalize → emit end → emit toolResult | 串行：prepare（含 beforeToolCall）依次做完        |
| 执行顺序     | 依次                                  | `Promise.all(entries.map(e => e()))` 并发         |
| end 事件顺序 | 完成一个发一个                        | 按完成顺序发，但 toolResult 消息按 assistant 源顺序发 |
| 早退         | `signal?.aborted` 后 break            | 预检阶段 break；执行阶段 Promise.all 仍要等所有    |

并行模式的微妙点：`tool_execution_end` 按各自完成顺序 emit，但 `toolResultMessage` 是**按 assistant 源顺序**组装的（`orderedFinalizedCalls` 来自 `Promise.all`，保持输入顺序）。这保证 provider 收到的 tool_result 序列与 tool_call 序列对齐，避免某些 provider 因乱序报错。

### 5.3 同文件并行的真实约束

虽然 agent-loop 允许并行，但 edit/write 在**同一文件**上永远串行——`withFileMutationQueue` 用 realpath key 串行化。所以"并行批次里有 edit(a) + edit(a)"实际会排队执行。这是工具内部约束覆盖 runtime 策略的典型例子。

但跨文件 edit/write 会真正并行——这也是为什么 `withFileMutationQueue` 必须用 realpath 而不是字符串路径：避免 `./a.txt` 和 `a.txt` 绕过同一文件锁。

### 5.4 早退与终止

- `shouldTerminateToolBatch`：仅当批次中**每个** finalized 结果都设 `terminate: true` 才提前终止 agent。单工具 terminate 不会停。
- `signal?.aborted`：在串行循环中直接 break，在并行预检阶段 break（已 push 的 lambda 仍会执行，但不再 push 新的）。

---

## 6. 前置校验链路

一次 tool_use 到达 `tool.execute` 之前，要走完五道关卡：

```
provider stream → toolCall.arguments
      ↓
1. tool.prepareArguments(args)       // 工具自定义归一化（仅 edit 有）
      ↓
2. validateToolArguments(tool, ...)  // ai 层 TypeBox 校验 + Value.Convert 强制类型转换
      ↓
3. config.beforeToolCall(ctx, signal) // 业务钩子，可 block
      ↓
4. signal.aborted 检查               // 中止信号
      ↓
5. tool.execute(toolCallId, args, signal, onUpdate, ctx)
```

### 6.1 prepareArguments 的定位

edit 是唯一有 `prepareArguments` 的内置工具，目的是**吸收 provider 传输噪声**：

```ts
// edit.ts:110-138
function prepareEditArguments(input: unknown): EditToolInput {
  // 1. JSON 字符串形态的 edits 数组
  if (typeof args.edits === 'string') { args.edits = JSON.parse(args.edits); }
  // 2. 旧版 top-level oldText/newText
  if (typeof legacy.oldText === 'string' && typeof legacy.newText === 'string') {
    edits.push({ oldText: legacy.oldText, newText: legacy.newText });
  }
}
```

注意：prepareArguments 在 schema 验证**之前**执行，必须返回匹配 `TParameters` 的对象。非法 JSON 不会被强制修复，会留给第 2 步报错。

### 6.2 validateToolArguments 的强制转换

`packages/ai/src/validation.ts:267` 实现：
- `structuredClone(args)` 防止污染原始 toolCall。
- `Value.Convert(tool.parameters, args)` 按 TypeBox schema 做类型强制（"123" → 123 当 schema 是 number）。
- 非 TypeBox（纯 JSON Schema）走 `coerceWithJsonSchema`。
- `validator.Check(args)` 失败时收集错误并抛错。

抛错会被 `prepareToolCall` 的 try/catch 捕获，转为 `{ kind: 'immediate', isError: true }`，不进入 execute 路径。

### 6.3 beforeToolCall 的拦截

业务层钩子，可返回 `{ block: true, reason }` 直接短路。Scout 的 `AgentSession` 通过扩展系统桥接 `tool_call` 事件——`ToolCallEvent.input` 可被**原地修改**，修改后的 args 不会重新 validate（这是显式契约，写在 `extensions/types.ts:342-347` 的注释里）。

这条"mutate input 但不 revalidate"的契约值得在面试中讲清楚：revalidate 会让扩展无法注入 schema 之外的参数（如运行时计算的 cwd、token），代价是扩展自己保证类型安全。

---

## 7. 截断策略矩阵

| 工具 | 行数限制 | 字节限制 | 单行限制 | 触发后产物 |
| ---- | -------- | -------- | -------- | ---------- |
| read | 2000     | 50KB     | -        | `Use offset=N to continue` 续读指针 |
| bash | 2000     | 50KB     | -        | 临时文件路径 + 起止行号 |
| grep | 100（match）| 50KB | 500 字符 | `Use limit=200 for more` + `read tool to see full lines` |
| find | 1000（result）| 50KB | - | `Use limit=2000 for more` |
| ls   | 500（entry）| 50KB  | -        | `Use limit=1000 for more` |
| edit | -        | MAX_REVIEW_TEXT_BYTES（review payload）| - | unavailableReason 标记 |
| write| -        | MAX_REVIEW_TEXT_BYTES（review payload）| - | unavailableReason 标记 |

bash 的截断最特殊：`OutputAccumulator` 在追加数据时持续判断 `shouldUseTempFile()`，一旦超阈值就 `ensureTempFile()` 把历史 rawChunks 落盘并切换到 stream 直写模式。`snapshot({ persistIfTruncated: true })` 会在截断时确保临时文件已创建，让 `fullOutputPath` 可信地返回给模型。

---

## 8. 对上下文的影响

工具输出进入 LLM 上下文的路径：`tool.execute` → `AgentToolResult` → `createToolResultMessage` → `context.messages` → `convertToLlm` → provider。

几个值得关注的点：

1. **details 替换**：edit/write 的 details 是重型 review payload，`AgentSession` 在 `tool_result` 钩子里把它替换为轻量 `file_change` details，**原文/改文不进入 LLM 上下文**。这是上下文经济性的关键设计。
2. **content 直接进上下文**：read/bash/grep/find/ls 的 `content` 数组就是模型看到的内容，截断提示也一起进上下文。截断提示写成 `[Use offset=N to continue]` 是给模型的"系统级 hint"，模型据此发起下一次 read 调用。
3. **图片进上下文**：read 的图片走 `{ type: 'image', data: base64, mimeType }`，直接进 ToolResultMessage 的 content。vision 检测在 `ReadToolOptions.isVisionModel`——非 vision 模型返回占位文本，避免无效图片撑爆 token。
4. **bash 流式更新不进上下文**：`onUpdate` 推送的 partial snapshot 只走 `tool_execution_update` 事件给 webview，不进 LLM context。只有最终 `result.content` 进上下文。
5. **truncateLine 的影响**：grep 单行 500 字符截断会丢失行内信息，提示 `read tool to see full lines` 引导模型自查。这是"宁可让模型多走一步，也不让一行 minified JS 撑满 50KB"的取舍。
6. **review payload 大小限制**：edit/write 的原文/改文若超 `MAX_REVIEW_TEXT_BYTES`，details 标记 unavailable，但**写操作仍执行**——这是"操作成功"与"可 review 性"的解耦，避免大文件编辑被静默拒绝。

---

## 9. 面试可能延伸的问题

### Q1：为什么 read 用 head 截断，bash 用 tail 截断？

答：read 是顺序阅读场景，用户/模型需要从头建立上下文，head + offset 续读形成"翻页"语义；bash 是命令输出场景，错误码、stack trace、最终输出都在末尾，tail 保留尾部对诊断更有价值。两个截断方向反映"阅读模型"与"诊断模型"的差异。

### Q2：edit 的 fuzzy match 会不会误匹配？

答：`normalizeForFuzzyMatch` 只做 NFKC + trimEnd + 智能引号/破折号归一化，不忽略大小写、不忽略空白。匹配前先精确 `indexOf`，模糊匹配只在精确失败时触发。`countOccurrences` 用同样的模糊逻辑，确保"唯一性"判断和"匹配"判断一致。但确实可能发生：模型给的 oldText 含中文全角空格，fuzzy 后匹配到普通空格位置——这种"语义等价但字节不同"的替换会让 diff 显示意外改动。生产中应引导模型直接复制原文。

### Q3：parallel 模式下，两个 edit 同文件会发生什么？

答：`withFileMutationQueue` 按 realpath key 串行化，第二个 edit 会等第一个完成。但 agent-loop 的 `executeToolCallsParallel` 在 `Promise.all` 时已经发起两个 execute，它们在 mutation queue 内部排队，end 事件按各自实际完成顺序发。所以 webview 看到的 end 顺序可能是 (edit2, edit1)，但 tool_result 消息按 assistant 源顺序 (edit1, edit2) 进 context。

### Q4：bash 工具如何处理 abort？

答：三层：① `signal.aborted` 在 `ops.exec` 入口和退出后检查；② `signal.addEventListener('abort', onAbort)` 中调用 `killProcessTree(child.pid)`；③ `onAbort` 触发后 `waitForChildProcess` 返回，exec 函数 throw `'aborted'`。bash 的 execute 外层 catch 把已收集的输出包装为 `Command aborted` 错误。注意：abort 不在 mutation queue 中 reject，但 bash 不进 mutation queue，所以这条约束对 bash 无影响。

### Q5：prepareArguments 为什么不 revalidate？

答：性能 + 扩展性。prepareArguments 的目的是吸收 provider 传输噪声（JSON 字符串、旧版字段），输出仍应是 schema 兼容对象。如果 revalidate，扩展插件通过 `tool_call` 事件注入的运行时参数（如动态 cwd）会被 schema 拒绝。代价是扩展作者必须自己保证类型安全——这是显式契约，写在 types 注释里。

### Q6：rg/fd 自动下载失败怎么办？

答：`ensureTool` 返回 `undefined`，grep/find 的 execute 会 reject `rg is not available and could not be downloaded`。这个错误进入 LLM 上下文后，模型通常不会再尝试 grep。`SCOUT_OFFLINE=1` 可禁用下载，避免 CI 环境 fetch 超时。Windows + Android + 离线场景有各自的降级提示。

### Q7：truncateHead 在首行超限时返回空内容，会不会让模型以为文件为空？

答：不会，因为返回的提示文本是 `[Line N is X.XKB, exceeds 50KB limit. Use bash: sed -n ... | head -c ...]`。模型看到这条提示就知道文件非空且很大，并获得了具体的降级指令。这种"把可操作指令放进上下文"的模式在 Scout 工具里反复出现：read 续读、grep 增限、ls 增限都遵循。

### Q8：为什么 edit/write 不做"备份后写入"？

答：因为 review payload 已经捕获了 `originalContent`，UI 层可以提供 undo；而且 write 的语义就是"覆盖"，备份会让"是否真的覆盖"语义模糊。如果需要备份，应该通过扩展注册一个新工具（如 safe_write），而不是污染内置 write 的契约。

### Q9：ls 500 / find 1000 / grep 100 的默认 limit 差异原因？

答：信息密度递减——ls 一行就是一个文件名，信息量低，500 合适；find 也是文件名但需要按 pattern 过滤，1000 给模型更大召回；grep 一行是匹配行+上下文，信息密度高，100 已经能撑起 50KB。三者最终都受 50KB 字节兜底，limit 只是"召回数"上限。

### Q10：tool-definition-wrapper 为什么需要 ctxFactory？

答：`ToolDefinition.execute` 签名比 `AgentTool.execute` 多一个 `ctx?: ScoutExtensionContext` 参数。wrapper 在调用 definition.execute 时通过 ctxFactory 按需解析当前上下文。这层抽象让扩展工具可以拿到 ScoutExtensionContext（cwd/sessionManager/model/ui/...），而 agent runtime 只看到统一的 AgentTool 签名。这是"定义层富信息、运行时窄接口"的边界设计。

---

## 10. 总结：Scout 工具体系的设计律

1. **契约单一**：所有工具走 `ToolDefinition → AgentTool → Provider Tool` 三段式，无内置特例。
2. **可替换性**：每个 fs/shell 操作都有 `*Operations` 接口，远端化和测试替身走同一入口。
3. **有界输出**：50KB / 2000 行 / 500 字符三道闸门，截断后给"续读指针"而非沉默。
4. **突变串行**：同文件 realpath key 串行，跨文件并行；abort 不释放队列锁。
5. **上下文经济**：edit/write 的重型 review payload 在 tool_result 钩子被替换，原文不进 LLM context。
6. **事件优先**：bash 用 OutputAccumulator 流式 + throttle，其它工具用 fire-and-forget IIFE + abort 监听先挂后跑。
7. **provider 噪声吸收**：edit.prepareArguments 处理 JSON 字符串和旧版字段，validateToolArguments 做 TypeBox 强制转换，beforeToolCall 做业务级拦截。
8. **二进制按需**：rg/fd 自动下载 + 离线开关 + 平台资产识别，避免用户手装依赖。
9. **并行但有序**：默认 parallel，但 toolResult 消息按 assistant 源顺序发；任一工具声明 sequential 整体降级。
10. **可操作错误**：所有错误都带上下文（路径、退出码、命令片段、续读指令），让模型看到错误就能发起修复动作。

这十条也是 Scout 区别于"裸调 fs/child_process 的 LLM 包装器"的根本——它把工具当成需要契约、需要治理、需要边界的产品层组件来对待。
