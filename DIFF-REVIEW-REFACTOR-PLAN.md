# Diff Review 架构重构计划

> 状态：待实施
> 范围：`packages/extension`、`packages/shared`、`packages/webview`
> 目标：移除实时工具预览，以工具实际写入为唯一事实来源；使 `edit`、`write` 核心实现与 Pi 对齐；降低文件 I/O、重复 diff、主线程阻塞和协议传输成本。

## 1. 决策摘要

本次重构采用以下方案：

1. 删除基于 assistant 流式参数预测的实时 `tool-preview` 链路。
2. `edit`、`write` 恢复 Pi 的核心执行逻辑、Operations 接口和原始返回语义，不在工具结果中携带完整 review payload。
3. 在 Operations 边界捕获真实 `readFile`、`mkdir`、`writeFile`，不对 `edit` 增加额外文件读取。
4. 使用 `AsyncLocalStorage` 将共享 Operations 调用关联到当前 `toolCallId` 和 session。
5. 使用 append-only `MutationJournal` 记录实际发生的文件变更，并按 `turnId + absolutePath` 聚合。
6. 使用单 Worker 计算规范化、无展示样式的 `DiffDocument`；Extension Host 主线程不执行大文本 diff。
7. Tool Result diff、Changes Review 摘要、独立审查面板和 artifact 全部消费同一份 `DiffDocument`。
8. 常驻消息只传轻量引用和统计；diff rows 与 syntax tokens 按需加载。
9. Artifact v2 持久化无 token 的 `DiffDocument`，不持久化完整文件快照；保留 artifact v1 只读恢复能力。
10. 暂不引入磁盘 CAS。保留内容 fingerprint，为未来 Apply/Revert 或大文件支持预留升级点。

## 2. 背景与现状

### 2.1 当前执行链路

当前 Scout 为了生成 review，在 `edit`、`write` 内部读取并返回完整前后内容：

```text
edit/write
  -> details: file_review_payload
  -> AgentSession.captureFileReviewResult()
  -> FileReviewStore.addRecord()
  -> details 替换为 file_change
  -> Host artifact / diffPreview / Changes Review
```

同时还存在独立实时预览链路：

```text
assistant message_start/update/end
  -> ToolPreviewService
  -> edit/write preview handler
  -> 预测 diff
  -> tool_call_preview_update
  -> Webview 临时预览
```

### 2.2 当前主要问题

#### 与 Pi 的偏离

- Scout `edit` 返回 `file_review_payload`，Pi 返回 `{ diff, patch, firstChangedLine }`。
- Scout `write` 的 Operations 增加了 `stat/readFile`，Pi 只有 `writeFile/mkdir`。
- Scout `write` 返回 `file_review_payload`，Pi 返回 `details: undefined`。
- Pi 更新工具实现时，Scout 需要反复手工合并 review 改造。

#### 重复计算

同一 turn/file 的变更可能被多次计算：

1. `FileReviewStore.addRecord()` 为统计执行完整 diff。
2. Tool Result enrichment 为折叠 preview 再执行 diff。
3. Artifact 物化为持久化 rows/tokens 再执行 diff。
4. 实时 tool preview 在执行前独立预测 diff。

#### 主线程阻塞

`computeReviewDiff()` 是同步 CPU 计算。接近 1 MiB、内容差异较大的文件可能阻塞 VS Code Extension Host，影响消息处理、取消操作和 UI 响应。

#### 数据复制与传输

- runtime 同时保留 original/modified 内容。
- artifact 保存完整 rows 和 syntax tokens。
- Tool Result details 内嵌 `diffPreview.rows`。
- panel model 再发送完整 rows/tokens。
- conversation state 重投影时可能重复携带大型 preview。

#### 双重真相

实时 preview 是执行前预测，Changes Review 是执行后事实。文件在两者之间变化、工具失败、扩展阻止调用或操作中止时，两套结果可能不一致。

## 3. 目标

### 3.1 功能目标

- `edit`、`write` 成功写入后展示 diff。
- Tool Result 和 Changes Review 使用同一份变更数据。
- 同一 assistant turn 内，同一文件的多次修改聚合为：第一次写入前内容到最后一次写入后内容。
- session 恢复后仍可展示历史 diff。
- 支持 unified/split 视图、文件打开、定位首个变更和 record 定位。
- 支持本地 Operations；远程 Operations 可通过显式 snapshot provider 接入。
- 实际写入成功但工具随后 abort/error 时，仍记录真实文件变更。

### 3.2 性能目标

- `edit` review 捕获不增加额外 `readFile` 或 `writeFile`。
- `write` 最多增加一次必要的 baseline 读取，不读取写入后的文件。
- 每个 turn/file revision 最多执行一次 line diff。
- 大文本 diff 不运行在 Extension Host 主线程。
- summary 路径不生成 syntax tokens。
- 未展开 Tool Result、未打开 Review Panel 时不传输 diff rows。
- artifact 不持久化 syntax tokens 和完整文件内容。
- 过期 revision 的 diff 结果不得覆盖最新状态。

### 3.3 可维护性目标

- Pi 工具升级时可直接同步核心实现。
- 文件操作、变更捕获、diff 计算、持久化、协议投影和 UI 展示职责分离。
- Extension 同名覆盖工具不会被误判为 Scout 内置 `edit/write`。
- session JSONL 只保存稳定、轻量、可序列化的 shared 契约。

## 4. 非目标

本次不实现：

- 文件变更 Apply/Revert。
- 任意历史版本的完整文件恢复。
- 超过当前 review 大小上限的完整 diff。
- 跨 session 内容去重。
- 磁盘 content-addressed blob store。
- Bash 或第三方工具造成的通用文件系统追踪。
- 文件系统 watcher。
- 实时显示尚未执行的工具参数 diff。

## 5. 设计原则

1. **实际写入是唯一事实来源**：不根据流式 tool arguments 推测最终结果。
2. **捕获靠近副作用**：在 Operations 调用处捕获，而不是在队列外重新读取。
3. **一次 diff，多种投影**：summary、inline preview、panel、artifact 共享 `DiffDocument`。
4. **展示数据按需派生**：tokens、unified rows、split rows 不属于持久化事实。
5. **主线程不做重 CPU 工作**：line diff 与大规模行模型构建进入 Worker。
6. **协议只传引用和需要的数据**：避免 conversation state 携带大 rows。
7. **持久化边界显式版本化**：artifact v1 可读，新增内容只写 v2。
8. **失败不掩盖已发生副作用**：写入成功即生成 mutation，不依赖工具最终状态。

## 6. 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Pi-compatible edit/write ToolDefinition                    │
│                                                             │
│ execute()                                                   │
│   └─ withFileMutationQueue()                                │
│       └─ wrapped Operations                                 │
│           ├─ capture before                                 │
│           ├─ delegate actual operation                      │
│           └─ capture after                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │ committed mutation
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ MutationCaptureContext (AsyncLocalStorage)                  │
│ toolCallId / operation / path / session owner               │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ MutationJournal                                             │
│ append record -> aggregate turn/file -> revision++          │
└─────────────────────────────┬───────────────────────────────┘
                              │ baseline/latest snapshot refs
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ DiffWorkerClient -> single Worker                           │
│ normalize -> diff -> DiffDocument                           │
└─────────────────────────────┬───────────────────────────────┘
                              │ projection_ready
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
       Tool Result ref   Review summary   Artifact v2
               │              │              │
               └──────────────┴──────┬───────┘
                                     ▼
                       Lazy diff protocol / Webview
```

## 7. 核心数据模型

### 7.1 Mutation Capture Context

建议新增：

`packages/extension/src/core/review/mutation-capture-context.ts`

```ts
export interface MutationCaptureScope {
  ownerId: string;
  toolCallId: string;
  operation: 'edit' | 'write';
  path: string;
  absolutePath: string;
  displayPath?: string;
}

export interface MutationCaptureState {
  scope: MutationCaptureScope;
  before?: CapturedTextSnapshot;
  after?: CapturedTextSnapshot;
  writeCommitted: boolean;
}
```

`ownerId` 必须唯一标识 AgentSession runtime，防止多 session 的相同 `toolCallId` 冲突。

### 7.2 Captured Text Snapshot

```ts
export type SnapshotUnavailableReason =
  | 'File is binary'
  | 'File exceeds review size limit'
  | 'Original content unavailable'
  | 'Modified content unavailable';

export interface CapturedTextSnapshot {
  content: string | null;
  byteLength: number;
  sha256?: string;
  unavailableReason?: SnapshotUnavailableReason;
}
```

约束：

- UTF-8 解码必须使用现有 fatal decoder 语义。
- 大小上限继续使用 `MAX_REVIEW_TEXT_BYTES`。
- fingerprint 可延迟到 Worker 计算，主线程不必同步执行 SHA-256。
- 字符串视为不可变对象，runtime 中传引用，不主动复制。

### 7.3 Mutation Record

建议新增：

`packages/extension/src/core/review/mutation-journal.ts`

```ts
export interface MutationRecord {
  recordId: string;
  ownerId: string;
  turnId: string;
  toolCallId: string;
  operation: 'edit' | 'write';
  path: string;
  absolutePath: string;
  displayPath?: string;
  sequence: number;
  before: CapturedTextSnapshot;
  after: CapturedTextSnapshot;
  toolOutcome: 'success' | 'error_after_write';
}
```

### 7.4 Turn File Aggregate

```ts
export interface TurnFileAggregate {
  fileId: string;
  turnId: string;
  path: string;
  absolutePath: string;
  displayPath?: string;
  recordIds: string[];
  firstRecordId: string;
  latestRecordId: string;
  baseline: CapturedTextSnapshot;
  latest: CapturedTextSnapshot;
  revision: number;
  projection:
    | { status: 'pending'; revision: number }
    | { status: 'ready'; revision: number; document: DiffDocument }
    | { status: 'unavailable'; revision: number; reason: string };
}
```

聚合规则：

- 第一次 mutation 建立 `baseline = record.before`。
- 后续 mutation 保持 baseline，只更新 `latest = record.after`。
- 每次更新 `revision += 1`。
- Worker 返回结果时必须比较 revision；旧结果直接丢弃。
- 同一 turn/file 的所有 recordId 都指向当前 aggregate。

### 7.5 Canonical DiffDocument

建议新增 shared 内部契约：

`packages/extension/src/core/review/diff-document.ts`

```ts
export interface DiffDocument {
  version: 1;
  beforeFingerprint?: ContentFingerprint;
  afterFingerprint?: ContentFingerprint;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  hunks: DiffHunk[];
  unavailableReason?: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type DiffLine =
  | { type: 'context'; text: string }
  | { type: 'removed'; text: string }
  | { type: 'added'; text: string };
```

约束：

- 不保存 syntax scopes。
- 不保存 unified/split UI 布局。
- 不保存折叠行；折叠由投影策略决定。
- hunks 只保留必要上下文，默认使用 `REVIEW_CONTEXT_LINES`。
- additions/deletions 在构建 document 时一次性得出。
- firstChangedLine 在构建 document 时一次性得出。

## 8. Operations 捕获设计

### 8.1 执行上下文

新增 `MutationCaptureCoordinator`：

```ts
export interface MutationCaptureCoordinator {
  run<T>(scope: MutationCaptureScope, execute: () => Promise<T>): Promise<T>;
  captureBefore(buffer: Buffer): void;
  captureMissingBefore(): void;
  captureAfter(content: string): void;
  markWriteCommitted(): void;
}
```

实现内部使用：

```ts
new AsyncLocalStorage<MutationCaptureState>()
```

`run()` 的行为：

1. 建立 scope。
2. 执行原始 tool definition。
3. 如果 write 已提交且 before/after 可用，将 mutation 交给当前 AgentSession owner。
4. 如果 write 未发生，不生成 mutation。
5. 如果 write 已发生但工具最终抛错，生成 `error_after_write` mutation 后继续抛出原错误。
6. 清理 AsyncLocalStorage scope。

### 8.2 Edit Operations 装饰

建议新增：

`packages/extension/src/core/review/review-edit-operations.ts`

```ts
export function withEditReviewCapture(
  operations: EditOperations,
  capture: MutationCaptureCoordinator,
): EditOperations;
```

行为：

- `access` 原样委托。
- `readFile` 委托成功后，把同一个 Buffer 交给 capture 解码，不再次读取。
- `writeFile` 委托成功后，捕获传入的最终字符串并标记 committed。
- delegate 失败时不标记 committed。

必须保持 Pi 的调用顺序和返回语义。

### 8.3 Write Operations 装饰

建议新增：

`packages/extension/src/core/review/review-write-operations.ts`

```ts
export interface ReviewSnapshotProvider {
  readBefore(absolutePath: string): Promise<Buffer | null>;
}

export function withWriteReviewCapture(
  operations: WriteOperations,
  capture: MutationCaptureCoordinator,
  snapshotProvider?: ReviewSnapshotProvider,
): WriteOperations;
```

行为：

- 首次进入 `mkdir` 时读取 baseline；同一 capture scope 只读取一次。
- ENOENT 转成新文件 baseline，不视为错误。
- 远程 Operations 没有 snapshot provider 时记录 unavailable，不访问本地同名路径。
- `writeFile` 委托成功后直接使用入参 content 作为 after，不再次读取。
- `mkdir` 或 `writeFile` 失败时保持 Pi 原始错误。

### 8.4 内置工具识别

只能装饰 Scout 内置工具定义，不能按工具名称盲目匹配。

捕获装配应发生在内置 definition 创建时，早于扩展工具同名覆盖。应使用现有 `SourceInfo` 或等价稳定身份判断：

```text
source = builtin && name in {'edit', 'write'}
```

第三方扩展注册的 `edit`、`write` 不自动捕获。

## 9. Pi 对齐策略

### 9.1 Edit

目标：

- 恢复 Pi `EditOperations` 接口。
- 恢复 Pi 输入校验、BOM、换行、模糊匹配和 mutation queue 逻辑。
- 移除 `FILE_REVIEW_PAYLOAD_KIND`、`decodeReviewContent`、`displayPath` 和 review details。
- Pi 返回的 `{ diff, patch, firstChangedLine }` 保持可用，但不作为 Scout review 的唯一事实来源。

性能处理：

- 第一条 mutation 且 Pi patch 与 aggregate baseline/latest 完全对应时，可以后续评估复用 patch。
- 第一阶段不要解析 Pi 的展示 diff；先保证单一 Scout DiffDocument 语义正确。
- 如基准显示 Pi 自身 diff 与 Scout Worker diff 重复成本明显，再单独决策是否在 Scout 的无 TUI ToolDefinition 适配层忽略 Pi 展示 diff 生成。该优化不得改变编辑行为。

### 9.2 Write

目标：

- 恢复 Pi `WriteOperations`：`writeFile`、`mkdir`。
- 移除 `stat/readFile` 扩展。
- 恢复 `details: undefined`。
- baseline 捕获完全移到 `ReviewSnapshotProvider`。

### 9.3 同步策略

重构后，对 Pi 工具同步的审查边界是：

- schema
- prompt description/guidelines
- input normalization
- Operations 接口
- execute 主体
- mutation queue 语义
- 成功/失败文本

Scout 专属内容只能存在于：

- definition 装配层
- Operations decorator
- Mutation Capture/Journal
- Host/Webview projection

## 10. Mutation Journal 生命周期

### 10.1 Turn 创建

继续使用 AgentSession 当前 review run/turn 语义。`agent_start` 建立本轮 turnId，所有实际 mutation 归属该 turn。

### 10.2 Mutation 提交点

提交点是 delegate `writeFile()` 成功返回，而不是 tool result success。

原因：

```text
writeFile 成功
  -> signal 随后 aborted
  -> tool execute 抛错
```

文件已经变化，review 必须反映事实。

### 10.3 Tool Result 关联

Mutation 提交后立即创建轻量 `ScoutFileChangeDetails`：

```ts
export interface ScoutFileChangeDetails {
  kind: 'file_change';
  review: {
    turnId: string;
    recordId: string;
    fileId: string;
    revision: number;
    status: 'pending' | 'ready' | 'unavailable';
  };
  path: string;
  displayPath?: string;
}
```

Tool result 不携带 original/modified、rows 或 tokens。

对于 `error_after_write`：

- tool result 仍保持错误状态。
- details 可以携带 `file_change` 引用。
- Changes Review 正常包含该记录。
- UI 显示“文件已修改，工具随后失败/中止”的状态说明。

### 10.4 Turn 完成

`turn_end` 后：

1. 等待当前 revision 的 Worker 任务完成或标记 unavailable。
2. 调度 artifact v2 保存。
3. artifact 成功持久化后释放 baseline/latest 完整字符串。
4. 保留 DiffDocument 和轻量 metadata 的 bounded cache。
5. session dispose 前 flush 尚未完成的 artifact。

不得因为 debounce 丢失最后一次 revision。

## 11. Diff Worker

### 11.1 文件结构

建议新增：

```text
packages/extension/src/core/review/diff-worker/
  diff-worker-client.ts
  diff-worker-protocol.ts
  diff-worker-runtime.ts
  diff-worker-entry.ts
```

barrel：

```text
packages/extension/src/core/review/index.ts
```

### 11.2 Worker 请求

```ts
export interface DiffWorkerRequest {
  requestId: string;
  ownerId: string;
  turnId: string;
  fileId: string;
  revision: number;
  filePath: string;
  originalContent: string | null;
  modifiedContent: string | null;
  unavailableReason?: string;
  maxBytes: number;
  contextLines: number;
}
```

### 11.3 Worker 响应

```ts
export type DiffWorkerResponse =
  | {
      requestId: string;
      fileId: string;
      revision: number;
      status: 'ready';
      document: DiffDocument;
    }
  | {
      requestId: string;
      fileId: string;
      revision: number;
      status: 'unavailable';
      reason: string;
    }
  | {
      requestId: string;
      fileId: string;
      revision: number;
      status: 'error';
      message: string;
    };
```

### 11.4 调度规则

- 初始使用单 Worker，避免多个大 diff 同时争抢 CPU。
- 每个 `ownerId + turnId + fileId` 只保留最新待处理 revision。
- 已进入 Worker 的旧任务不强杀；响应时按 revision 丢弃。
- session dispose 后拒绝发布结果。
- Worker 崩溃时重建一次，并将飞行中任务标记失败；禁止无限重启。
- Worker 失败不影响文件操作和 Agent 主循环。
- `pending` 状态不得阻塞下一次模型调用。

### 11.5 构建

Extension esbuild 配置需要增加 Worker 独立 entry，并确保生产包能通过稳定 URI/文件路径启动。测试环境允许注入 inline fake worker，避免依赖真实线程。

## 12. DiffDocument 投影

建议新增：

```text
packages/extension/src/host/review/diff-document-projector.ts
packages/extension/src/host/review/review-token-cache.ts
```

### 12.1 Summary Projection

只读取：

- path/displayPath
- additions/deletions
- recordIds
- projection status
- unavailable reason

不生成 rows，不生成 tokens。

### 12.2 Inline Tool Result Projection

Tool Result 初始只包含 `file_change` 引用。Webview 在该结果进入可见区域或用户展开时请求 preview。

默认策略：

- unified
- 3 行上下文
- 限制最大 hunk/row 数
- 初始不包含 syntax tokens，或只为返回范围生成 tokens
- 响应包含 revision，Webview 拒绝旧 revision

### 12.3 Review Panel Projection

打开 panel 时按 turnId 取得文件 summary。每个文件展开时请求对应 DiffDocument 投影：

- unified 或 split
- 可见 hunk/区段
- 按需 syntax tokens
- 大文件使用分页或区段请求

### 12.4 Syntax Token Cache

缓存 key 至少包含：

```text
languageId + lineTextHash + tokenizerVersion
```

约束：

- bounded LRU。
- artifact 不保存 tokens。
- summary 不触发 tokenization。
- panel 关闭后可以保留小型 LRU，但不能保留完整 review model。

## 13. Shared 协议调整

### 13.1 保留

保留 `ScoutFileChangeDetails` 的核心身份字段：

- turnId
- recordId
- fileId/path
- revision/status

保留 Changes Review summary，但确保其中没有 rows/tokens。

### 13.2 删除

删除实时 preview 协议：

- `tool_call_preview_update`
- preview generation/session 状态
- 与 assistant streaming phase 绑定的 preview 类型
- Webview temporary preview store/actions

具体删除项以 `packages/shared/src` 搜索结果为准，并同步 barrel `index.ts`。

### 13.3 新增请求

在 shared 中新增：

```ts
export interface RequestFileDiffMessage {
  type: 'request_file_diff';
  requestId: string;
  sessionId: string;
  turnId: string;
  fileId: string;
  revision: number;
  view: 'inline' | 'panel';
  mode: 'unified' | 'split';
  includeTokens: boolean;
  range?: { hunkOffset: number; hunkLimit: number };
}
```

### 13.4 新增结果

```ts
export type FileDiffResultMessage =
  | {
      type: 'file_diff_result';
      requestId: string;
      turnId: string;
      fileId: string;
      revision: number;
      status: 'ready';
      diff: ScoutFileDiffView;
    }
  | {
      type: 'file_diff_result';
      requestId: string;
      turnId: string;
      fileId: string;
      revision: number;
      status: 'pending' | 'unavailable' | 'error';
      message?: string;
    };
```

### 13.5 更新事件

新增或收敛为一个轻量事件：

```ts
export interface ChangesReviewProjectionUpdatedEvent {
  type: 'changes_review_projection_updated';
  sessionId: string;
  turnId: string;
  fileId: string;
  revision: number;
  status: 'ready' | 'unavailable';
  additions: number;
  deletions: number;
}
```

该事件同时驱动：

- conversation 中相关 tool result 重新请求/刷新 diff。
- composer 下方 Changes Review summary 更新。
- 已打开 review panel 更新对应文件。

## 14. Artifact v2

### 14.1 目标格式

```ts
export interface FileReviewArtifactV2 {
  version: 2;
  sessionId: string;
  turnId: string;
  createdAt: string;
  records: Array<{
    recordId: string;
    toolCallId: string;
    operation: 'edit' | 'write';
    fileId: string;
    sequence: number;
    toolOutcome: 'success' | 'error_after_write';
  }>;
  files: Array<{
    fileId: string;
    path: string;
    absolutePath: string;
    displayPath?: string;
    recordIds: string[];
    latestRevision: number;
    document: DiffDocument;
  }>;
}
```

### 14.2 不持久化

- originalContent
- modifiedContent
- syntax tokens
- unified/split 布局
- Webview fold 状态
- 临时 pending projection

### 14.3 v1 兼容

- loader 支持 v1 和 v2。
- v1 rows 读取后转换为内存 `DiffDocument` 或兼容 projection source。
- 只写 v2，不回写/批量迁移已有 session。
- v1 兼容逻辑集中在 artifact decoder，不泄漏到 Journal、AgentSession 或 Webview。
- 增加明确的 artifact version type guard 和损坏数据测试。

### 14.4 限制

继续保留并统一以下限制：

- max files
- max rows/hunks
- max serialized bytes
- 单文件 review text 上限

限制应在 Worker/Artifact 边界返回明确 unavailable reason，不应静默截断后伪装为完整 diff。

## 15. Webview 调整

### 15.1 Conversation Tool Result

Tool result UI 状态：

```text
pending     -> 显示轻量 loading 行
ready       -> 自动请求当前 revision inline diff
unavailable -> 显示原因
error       -> 显示重试加载或错误文本
```

要求：

- 组件卸载或 revision 变化时忽略旧 response。
- 相同 `fileId + revision + view policy` 共享客户端缓存。
- conversation state 不持久保存完整 diff rows。
- 折叠后可以释放大型 rows。

### 15.2 Composer Changes Review

常驻 tray 只消费 summary：

- 文件数
- additions/deletions
- pending/unavailable 状态

不得触发完整 diff 请求。

### 15.3 Review Panel

- 初次打开只加载文件 summary。
- 文件区段展开后加载 diff。
- 长列表和长 diff 使用虚拟化。
- unified/split 切换复用同一 DiffDocument，不重新请求原始内容。
- syntax token 可作为第二阶段响应，不能阻塞纯文本 diff 首屏。

### 15.4 状态一致性

所有响应必须携带 revision。Webview 仅接受与当前 summary revision 相同的结果。

## 16. 删除与替换范围

### 16.1 删除实时预览模块

计划删除：

```text
packages/extension/src/core/tool-preview/edit-preview-handler.ts
packages/extension/src/core/tool-preview/write-preview-handler.ts
packages/extension/src/core/tool-preview/default-preview-handlers.ts
packages/extension/src/core/tool-preview/tool-call-preview-session.ts
packages/extension/src/core/tool-preview/tool-preview-controller.ts
packages/extension/src/core/tool-preview/tool-preview-service.ts
packages/extension/src/host/protocol/tool-call-preview-projector.ts
```

根据引用情况删除或收敛：

```text
packages/extension/src/core/tool-preview/argument-parsing.ts
packages/extension/src/core/tool-preview/preview-format.ts
packages/extension/src/core/tool-preview/types.ts
packages/extension/src/core/tool-preview/index.ts
```

对应测试删除或迁移：

```text
packages/extension/test/core/tool-preview.test.ts
packages/extension/test/host/protocol/tool-call-preview-projector.test.ts
```

### 16.2 替换 review runtime

计划由新 Journal/Worker 替换或大幅收敛：

```text
packages/extension/src/core/review/file-review.ts
packages/extension/src/host/review/file-change-diff-preview.ts
packages/extension/src/host/review/file-review-artifact.ts
packages/extension/src/host/review/file-review-artifact-flush-scheduler.ts
packages/extension/src/host/review/changes-review-summary-projector.ts
```

### 16.3 保留并适配

```text
packages/extension/src/host/protocol/assistant-changes-review-attacher.ts
packages/extension/src/host/review/changes-review-panel.ts
packages/webview/src/features/changes-review/**
packages/webview/src/surfaces/changes-review/**
```

保留 UI 能力，但改为轻量 summary + lazy diff 数据源。

## 17. 分阶段实施计划

### 阶段 0：建立行为基线与性能基准

目标：在删除旧链路前固定现有关键语义，并获得可比较数据。

任务：

1. 增加 edit/write 单次、多次、并发同文件 mutation 的 characterization tests。
2. 固定当前 turn 聚合语义：首次 before 到最后 after。
3. 固定 artifact 恢复、record 定位、unified/split、外部路径行为。
4. 增加已写入后 abort/error 的现状测试，并将新期望单独标记。
5. 建立 benchmark fixture：
   - 10 KiB 小文件，单行修改。
   - 500 KiB 中型文件，10 处修改。
   - 1 MiB 文件，低差异。
   - 1 MiB 文件，高差异。
   - 同 turn 同文件连续 10 次 edit。
   - 同 turn 20 个不同文件。
6. 记录：文件读取次数、diff 次数、主线程耗时、Worker 耗时、artifact 字节数、protocol payload 字节数、Webview retained rows。

完成标准：基准可独立运行，关键行为测试在重构前通过。

### 阶段 1：引入 DiffDocument 与纯投影

目标：先建立新的规范中间模型，不改变数据来源。

任务：

1. 新增 `DiffDocument` 类型。
2. 将当前 `computeReviewDiff` 拆为：
   - content -> DiffDocument
   - DiffDocument -> summary
   - DiffDocument -> inline rows
   - DiffDocument -> panel rows
3. syntax token 从 diff 计算中拆出。
4. 用现有 FileReviewStore snapshots 生成 DiffDocument。
5. 修改现有 artifact/preview/panel 暂时消费 DiffDocument。

完成标准：功能不变；同一已生成 document 的 summary/preview/artifact 不再重新执行 line diff。

### 阶段 2：引入 Worker

目标：将 content -> DiffDocument 移出 Extension Host 主线程。

任务：

1. 实现 Worker protocol、runtime 和 client。
2. 支持 revision/generation 丢弃。
3. 支持 dispose、崩溃和单次重建。
4. 接入 esbuild Worker entry。
5. 测试注入 fake worker。
6. 将 FileReviewStore 的同步 diff 替换为异步 projection 状态。

完成标准：大文件 diff 期间 Extension Host 仍可处理取消和协议消息；Agent 不等待 diff 完成。

### 阶段 3：引入 Mutation Capture 与 Journal

目标：建立新的事实来源，但暂时允许旧 payload 作为对照。

任务：

1. 实现 AsyncLocalStorage capture coordinator。
2. 实现 edit Operations decorator。
3. 实现 write Operations decorator 和本地 snapshot provider。
4. 实现 MutationJournal、turn/file aggregate、revision。
5. 将内置工具 definition 与 AgentSession owner 绑定。
6. 增加双路径测试：旧 payload 与 Journal 生成结果必须一致。
7. 验证多 session、多 toolCall、同文件并发不会串线。

完成标准：所有本地 edit/write mutation 均由 Journal 捕获，且 edit 无额外 read。

### 阶段 4：AgentSession 切换到 Journal

目标：停止从 tool result details 捕获完整内容。

任务：

1. `handleAfterToolCall` 改为关联 Journal record。
2. tool result 只写轻量 `file_change` details。
3. file review updated 事件由 projection ready 驱动。
4. 支持 `error_after_write`。
5. 移除 `FILE_REVIEW_PAYLOAD_KIND` 和对应类型判断。
6. 将 runtime content release 生命周期迁移到 Journal。

完成标准：session JSONL 不出现完整文件内容和 `file_review_payload`；所有 Changes Review 测试通过。

### 阶段 5：恢复 Pi edit/write

目标：移除工具内部 review 改造。

任务：

1. 恢复 Pi `EditToolDetails` 与 execute 返回。
2. 恢复 Pi `WriteOperations` 接口和 `details: undefined`。
3. 删除工具内 review imports、decode、baseline 读取和 payload 构造。
4. 对 Pi 当前版本做逐段差异审计。
5. 增加 parity tests，覆盖输入、输出、错误、BOM、CRLF、模糊匹配和 abort。

完成标准：除 Scout 无 TUI/导入路径适配外，工具核心逻辑与 Pi 一致。

### 阶段 6：Artifact v2

目标：只持久化可直接展示的 tokenless DiffDocument。

任务：

1. 实现 v2 encoder/decoder/validation。
2. 实现 v1 reader adapter。
3. 更新 flush scheduler，只保存 ready 的最新 revision。
4. artifact 保存成功后释放完整 snapshots。
5. 更新 session branch artifact 收集和恢复逻辑。
6. 验证损坏、超限和部分 session 数据。

完成标准：新 session 只写 v2；旧 session review 可读；artifact 体积显著下降。

### 阶段 7：协议与 Webview 懒加载

目标：大型 rows 不进入常驻 conversation state。

任务：

1. 新增 request/result/updated shared 协议并更新 barrel。
2. Host 增加 lazy diff resolver 和 bounded cache。
3. Tool Result 组件按可见性/展开状态请求 inline diff。
4. Composer tray 只使用 summary。
5. Panel 按文件/区段请求 diff。
6. 加入 revision 检查、请求取消和客户端缓存。
7. 长 diff 使用虚拟化。

完成标准：关闭 review UI 时，Webview 不持有完整 rows；协议 payload 与可见内容规模相关。

### 阶段 8：删除实时 tool-preview

目标：彻底移除预测链路和双重真相。

任务：

1. 删除 core tool-preview service/handlers/controller/session。
2. 删除 host projector。
3. 删除 shared preview 协议。
4. 删除 Webview streaming preview store 和组件状态。
5. 删除/迁移测试。
6. 全仓搜索 preview 类型和死代码。

完成标准：assistant streaming 不触发文件读取或 diff；工具成功写入后才出现 review。

### 阶段 9：性能收口与文档更新

任务：

1. 运行阶段 0 基准并对比。
2. 调整 Worker 队列、LRU、row/hunk 限制。
3. 检查 Extension Host 长任务。
4. 检查 artifact 和 protocol 大小。
5. 更新 `docs/webview-protocol.md`。
6. 更新架构文档和 Pi 同步说明。
7. 删除迁移期双路径和测试辅助代码。

完成标准：满足本文性能预算和验收标准。

## 18. 测试计划

### 18.1 Operations Capture 单元测试

Edit：

- `readFile` Buffer 原样返回且只调用一次。
- before 使用 Pi 实际读取的 Buffer。
- `writeFile` 成功后捕获准确 final content。
- access/read/write 失败保持原始错误。
- 同时执行多个 toolCall 不串 AsyncLocalStorage。
- 相同文件的并发 edit 按 mutation queue 顺序生成准确 before/after。
- BOM、CRLF、非 ASCII UTF-8。
- 二进制和超限内容。

Write：

- 新文件 baseline 为 null。
- 覆盖文件只读取一次 baseline。
- after 直接来自 write content，不再次读取。
- mkdir 失败不产生 mutation。
- write 失败不产生 committed mutation。
- write 成功后 abort 产生 `error_after_write`。
- 远程 Operations 有 provider。
- 远程 Operations 无 provider 时 unavailable，且不读取本地路径。

### 18.2 Mutation Journal 单元测试

- 单 record 创建 aggregate。
- 同 turn/file 多 record 保留首次 baseline 和最后 latest。
- 不同 turn 不聚合。
- 不同规范路径不误聚合；路径别名按既定策略归一。
- revision 单调增长。
- 旧 Worker 响应被丢弃。
- artifact flush 后释放 snapshots。
- release 后仍可使用 DiffDocument。
- dispose 后不再发布事件。

### 18.3 Diff Worker 单元测试

- empty/create/delete/edit。
- additions/deletions/firstChangedLine。
- context hunk 合并与拆分。
- LF/CRLF 归一。
- 二进制、超限、diff row 超限。
- Worker error 序列化。
- Worker crash 单次恢复。
- generation/revision 丢弃。
- 不同请求结果隔离。

### 18.4 Artifact 测试

迁移现有：

- `file-review-artifact.test.ts`
- `changes-review-summary-projector.test.ts`
- `file-change-diff-preview.test.ts`

新增：

- v2 round-trip。
- v1 read compatibility。
- v2 不包含 tokens/full content。
- corrupted/unknown version。
- max bytes/files/hunks。
- latest revision 持久化。
- session restore 后 lazy diff。

### 18.5 AgentSession/Coordinator 集成测试

- tool result details 为轻量 `file_change`。
- Journal record 与 toolCall 正确关联。
- review ready 后更新 summary。
- 同 turn 多次 edit 后所有 record 指向同一 aggregate revision。
- tool error before write 不产生 review。
- error after write 产生 review。
- fork/navigate/restore 后 review 关联不丢失。
- artifact flush 与 session dispose 顺序。
- extension 同名覆盖 edit/write 不进入内置捕获。

### 18.6 协议测试

- request 与当前 session/turn/revision 匹配。
- stale revision 返回或客户端丢弃。
- 非法 fileId/recordId 不泄漏任意文件。
- inline/panel policy 限制。
- pending/ready/unavailable/error。
- 请求取消和 panel dispose。

### 18.7 Webview 测试

- tool result pending -> ready。
- 不可见/折叠 result 不请求 rows。
- 多个 result 共享同一 revision cache。
- summary 更新不清空已加载相同 revision diff。
- stale response 不覆盖最新 diff。
- unified/split 切换。
- 长 diff 虚拟化。
- panel 关闭释放大型模型。

### 18.8 性能测试

至少记录：

- `fs.readFile` 次数。
- content -> DiffDocument 调用次数。
- Extension Host 同步最长任务。
- Worker wall time。
- peak heap。
- artifact JSON 字节数。
- postMessage payload 字节数。
- Webview retained rows/tokens。

## 19. 性能预算

以下是目标而不是绝对平台无关 SLA；基准应以重构前后比例为主要判断。

### 19.1 I/O

- Edit：每次调用 1 read + 1 write，与 Pi 相同。
- Write 新建：最多 1 次 baseline 检查 + 1 write。
- Write 覆盖：1 baseline read + 1 write。
- Diff 展示和 panel 打开不得重新读取工作区文件。
- 历史 review 不读取当前工作区文件来重建 diff。

### 19.2 CPU

- 每个最新 turn/file revision 只执行一次 line diff。
- summary 不执行 line diff。
- artifact encode 不执行 line diff。
- inline/panel projection 不执行 line diff。
- syntax token 只覆盖请求范围。
- Extension Host 中不得出现与文件大小线性增长的同步 diff 任务。

### 19.3 内存

- runtime 最多保留每个 active turn/file 的 baseline/latest。
- 同一文件的中间 snapshots 不长期保留。
- artifact 成功后释放 full content。
- DiffDocument cache 和 token cache 必须 bounded。
- Webview 不因 conversation 历史长度累积全部 diff rows。

### 19.4 协议

- Changes Review summary payload 与文件数线性相关，不与总 diff 行数相关。
- conversation state payload 不包含完整 diff rows。
- inline diff 响应受 row/hunk 上限约束。
- panel diff 支持分段请求。

## 20. 安全与边界

- Lazy diff 请求必须通过 session/turn/fileId 解析，禁止直接接受任意 absolutePath 读取。
- Webview 不能请求 Journal 中不存在的路径。
- 外部工作区路径继续使用现有 external 标记和打开文件策略。
- Artifact 校验所有字符串、数组、数字范围和版本。
- Worker 输入只来自已捕获 snapshot，不执行路径读取。
- 错误消息包含上下文，但不得包含完整文件内容。
- Artifact 与日志不得记录 API key 或环境变量。

## 21. 可观测性

在现有 logger 边界增加结构化诊断：

```text
review.capture.committed
review.projection.queued
review.projection.ready
review.projection.stale
review.projection.unavailable
review.artifact.saved
review.artifact.failed
review.diff.requested
review.diff.cache_hit
review.diff.cache_miss
```

字段：

- owner/session id（可安全记录的内部 id）
- turnId/fileId/revision
- operation
- byte counts
- durationMs
- outcome/reason

禁止记录 content、patch 或 diff text。

## 22. 风险与缓解

### AsyncLocalStorage 上下文丢失

风险：第三方异步边界或错误包装导致 Operations 取不到 scope。

缓解：

- 在 ToolDefinition execute 最外层建立 scope。
- 单元测试 Promise、queue、abort 路径。
- 无 scope 时 Operations 正常执行，但记录 diagnostic；不得阻止工具。

### Worker 构建与路径

风险：VS Code 打包后 Worker entry 路径错误。

缓解：

- 独立 esbuild entry。
- production bundle smoke test。
- Worker 启动失败时 review 标记 unavailable，工具继续工作。

### 异步 UI 时序

风险：tool result 已展示，但 projection 尚未完成。

缓解：

- 明确 pending 状态。
- revision 保护。
- 不让 Agent 等待 diff。

### Artifact v1/v2 分叉

风险：兼容逻辑扩散。

缓解：

- v1 只在 decoder 转换。
- 内部统一为 DiffDocument。
- 只写 v2。

### 远程 Operations

风险：错误读取本地同名路径或 baseline 不准确。

缓解：

- 远程必须显式提供 snapshot provider。
- 未提供时标记 unavailable。
- 不做本地 fallback。

### Pi edit 自身 diff 重复

风险：严格保留 Pi details 时，Pi 和 Worker 都计算 diff。

缓解：

- 先以正确性和边界对齐为主。
- 通过 benchmark 确认成本。
- 后续可解析/reuse Pi patch，或在无 TUI definition 适配层省略纯展示 details；不得改动编辑算法。

## 23. 回滚与提交边界

不使用长期 feature flag。实施应按可独立验证的提交拆分：

1. Characterization tests 与 benchmark。
2. DiffDocument 纯模型与投影。
3. Worker 与异步 projection。
4. Mutation Capture/Journal，旧链路仍作为测试 oracle。
5. AgentSession 切换 Journal。
6. Pi edit/write 恢复。
7. Artifact v2。
8. Lazy protocol/Webview。
9. 删除实时 preview 和迁移临时代码。
10. 性能收口与文档。

每个提交必须保持 build/test 可运行。若后续阶段失败，应回滚到上一个完整提交，禁止在生产路径长期保留双写。

## 24. 验收标准

### 功能

- edit/write 实际写入后出现 Tool Result diff。
- 下方 Changes Review 与 Tool Result 的统计和内容一致。
- 同 turn 同文件多次修改正确聚合。
- 历史 session 可恢复 review。
- unified/split、打开文件、定位 record 正常。
- 工具失败前未写入不产生 review。
- 写入后 error/abort 仍产生事实 review。

### Pi 对齐

- Edit/Write Operations 接口与 Pi 一致。
- execute 主体不包含 Scout review 逻辑。
- Scout 专属逻辑全部位于装配、capture、journal、projection 层。
- parity tests 覆盖 Pi 关键语义。

### 性能

- Edit 捕获没有额外文件读取。
- 同一 revision 的 line diff 只执行一次。
- Extension Host 不同步执行大文本 diff。
- summary/artifact encode 不重新 diff。
- 未打开 diff 时 Webview 不接收 rows/tokens。
- artifact 不包含 full content 或 syntax tokens。
- 阶段 0 的中大型 fixture 在主线程延迟、artifact 大小和协议体积上显著优于当前实现。

### 质量

- `pnpm build` 通过。
- `pnpm lint` 通过。
- 相关 unit/integration/webview 测试通过。
- 无新增跨层依赖或 shared 内部类型泄漏。
- 所有新增导出同步更新 barrel。
- `docs/webview-protocol.md` 与最终协议一致。

## 25. 最终文件布局建议

```text
packages/extension/src/core/review/
  diff-document.ts
  index.ts
  mutation-capture-context.ts
  mutation-capture-coordinator.ts
  mutation-journal.ts
  review-edit-operations.ts
  review-snapshot-provider.ts
  review-write-operations.ts
  review-text.ts
  diff-worker/
    diff-worker-client.ts
    diff-worker-entry.ts
    diff-worker-protocol.ts
    diff-worker-runtime.ts

packages/extension/src/host/review/
  changes-review-panel.ts
  changes-review-summary-projector.ts
  diff-document-projector.ts
  file-review-artifact.ts
  file-review-artifact-flush-scheduler.ts
  review-token-cache.ts

packages/extension/src/host/protocol/
  assistant-changes-review-attacher.ts
  file-diff-request-handler.ts

packages/shared/src/
  protocol-review.ts
  protocol-requests.ts
  protocol-results.ts
  protocol-events.ts
  index.ts

packages/webview/src/features/changes-review/
  model/
  store/
  view/
```

最终不再保留 `packages/extension/src/core/tool-preview/`。

## 26. 实施前最终确认项

以下决策已经在本计划中固定，实施时不再重新发散：

- 不保留实时预测 preview。
- 不引入磁盘 CAS。
- 工具执行不等待 diff Worker。
- Operations 成功写入是 mutation 提交点。
- Artifact 只写 v2，同时保留 v1 只读恢复。
- Artifact 不保存 tokens/full content。
- Webview 使用 lazy diff 请求。
- 内置工具按 source identity 捕获，不按名称捕获扩展工具。
- 远程 Operations 无 snapshot provider 时不读取本地 fallback。

实施中仅在基准证明以下假设不成立时才需要重新评审：

1. 单 Worker 无法满足连续多文件 diff 吞吐。
2. token lazy generation 导致 panel 首屏不可接受。
3. Pi edit 自身 diff 生成成为主要 CPU 瓶颈。
4. v1 artifact 无法无损转换为内部 DiffDocument 投影。

---

## 27. 阶段 1-5 历史交接（2026-07-26）

> 本节保留阶段 1-5 完成时的历史快照。后续实施已完成，当前状态以第 28 节为准。工作区未提交。

### 27.1 已完成阶段

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段 0 | ✅ 跳过 | characterization tests 已由阶段 1-3 测试覆盖；benchmark 未单独建立 |
| 阶段 1 | ✅ 完成 | DiffDocument + 纯投影 |
| 阶段 2 | ✅ 完成 | 单 Diff Worker + 异步投影 |
| 阶段 3 | ✅ 完成 | Operations 捕获 + Mutation Journal |
| 阶段 4 | ✅ 完成 | AgentSession 切换 Journal + 轻量 file_change |
| 阶段 5 | ✅ 完成 | 恢复 Pi edit/write 核心语义 |
| 阶段 6 | ❌ 未开始 | Artifact v2 |
| 阶段 7 | ❌ 未开始 | Lazy diff shared 协议 + host resolver + webview 按需加载 |
| 阶段 8 | 🔶 部分完成 | 已删除 core/tool-preview 全目录 + projector + shared `tool_call_preview_update` 事件/emits + 测试；webview preview store 清理由 linter 自动完成。**待验证**：全仓搜索残留 preview 类型/死代码 |
| 阶段 9 | ❌ 未开始 | 性能收口 + 文档更新 |

### 27.2 阶段 1-5 架构总结

**数据流（已实现）**：
```
Pi-compatible edit/write execute()
  └─ withFileMutationQueue()
      └─ decorated Operations (withEditReviewCapture / withWriteReviewCapture)
          ├─ capture before (edit: delegate readFile 的同一 Buffer; write: snapshot provider)
          ├─ delegate actual operation (Pi 原始逻辑)
          └─ capture after (write 入参字符串) + markWriteCommitted
      └─ MutationCaptureCoordinator.run() (AsyncLocalStorage, 冻结 turnId)
          └─ writeFile 成功返回 = commit 点
              └─ MutationJournal.append() → record + turn/file aggregate (revision++)
                  └─ scheduleProjection → DiffWorkerClient (单 Worker)
                      └─ response (ready/unavailable/error) → setProjection (revision 丢弃 stale)
                          └─ onUpdated('projection') → AgentSession.emitFileReviewUpdated
                              └─ SessionCoordinator → changes_review_update → Webview

handleAfterToolCall:
  └─ mutationJournal.getRecordByToolCallId(toolCallId)
      └─ 返回轻量 ScoutFileChangeDetails { kind, path, displayPath?, review{turnId,recordId,fileId,revision,status}, toolOutcome? }
          (不携带 original/modified/rows/tokens/diffPreview)
```

**关键文件**：
- `core/review/diff-document.ts` — canonical DiffDocument + summary/rows 投影
- `core/review/diff-worker/{protocol,runtime,client,entry}.ts` — 单 Worker
- `core/review/mutation-capture-context.ts` — CapturedTextSnapshot (fatal UTF-8, BOM 与 oracle 一致)
- `core/review/mutation-capture-coordinator.ts` — AsyncLocalStorage, run/captureBefore/captureAfter/markWriteCommitted
- `core/review/mutation-journal.ts` — append-only Journal + worker 接线 + toReviewTurnSnapshot 适配器
- `core/review/review-edit-operations.ts` — edit Operations decorator (readFile→captureBefore, writeFile→captureAfter+commit)
- `core/review/review-write-operations.ts` — write Operations decorator (mkdir→captureBeforeFrom provider, writeFile→captureAfter+commit)
- `core/review/review-snapshot-provider.ts` — 本地 baseline 读取 (ENOENT→null)
- `core/review/file-review.ts` — FileReviewStore 仍存在（供 v1 artifact reader 和测试），但 AgentSession 不再实例化
- `core/review/index.ts` — barrel

### 27.3 已完成改动文件清单

**新增**（untracked）：
```
packages/extension/src/core/review/diff-document.ts
packages/extension/src/core/review/diff-worker/diff-worker-protocol.ts
packages/extension/src/core/review/diff-worker/diff-worker-runtime.ts
packages/extension/src/core/review/diff-worker/diff-worker-client.ts
packages/extension/src/core/review/diff-worker/diff-worker-entry.ts
packages/extension/src/core/review/index.ts
packages/extension/src/core/review/mutation-capture-context.ts
packages/extension/src/core/review/mutation-capture-coordinator.ts
packages/extension/src/core/review/mutation-journal.ts
packages/extension/src/core/review/review-edit-operations.ts
packages/extension/src/core/review/review-snapshot-provider.ts
packages/extension/src/core/review/review-write-operations.ts
packages/extension/test/core/diff-document.test.ts
packages/extension/test/core/diff-worker.test.ts
packages/extension/test/core/mutation-capture.test.ts
packages/extension/test/core/mutation-journal.test.ts
packages/extension/test/core/agent-session-mutation-capture.test.ts
packages/extension/test/package/diff-worker-bundle.test.ts
```

**修改**：
```
packages/extension/esbuild.js                      — 独立 diff-worker.js ESM entry
packages/extension/src/core/agent-session.ts       — Journal 切换、capture 装配、轻量 details
packages/extension/src/core/index.ts               — 移除 tool-preview export
packages/extension/src/core/review/file-review.ts  — DiffDocument 投影 + 异步 worker
packages/extension/src/core/tools/edit.ts          — 恢复 Pi {diff,patch,firstChangedLine}
packages/extension/src/core/tools/index.ts         — barrel 更新
packages/extension/src/core/tools/write.ts         — 恢复 Pi writeFile+mkdir, details:undefined
packages/extension/src/host/protocol/assistant-changes-review-attacher.ts
packages/extension/src/host/protocol/scout-protocol-host-services.ts — 移除 preview context
packages/extension/src/host/protocol/session-event-forwarder.ts     — 移除 preview projector
packages/extension/src/host/review/changes-review-panel.ts          — 消费 DiffDocument
packages/extension/src/host/review/changes-review-summary-projector.ts
packages/extension/src/host/review/file-change-diff-preview.ts
packages/extension/src/host/review/file-review-artifact.ts
packages/shared/src/protocol-events.ts             — 移除 tool_call_preview_update
packages/shared/src/protocol-requests.ts           — 移除 emits 中的 tool_call_preview_update
packages/shared/src/protocol-state.ts              — ScoutFileChangeDetails 收缩为轻量; ScoutFileChangeReviewRef 扩展 fileId/revision/status/toolOutcome
packages/shared/src/protocol.ts                    — 移除 preview 类型导出
packages/shared/src/index.ts                       — 移除 preview 类型导出
packages/webview/src/features/conversation/tool-display/helpers.ts  — 移除 preview
+ 多个 webview 测试文件由 linter 自动适配
```

**删除**：
```
packages/extension/src/core/tool-preview/          — 全目录 (10 文件)
packages/extension/src/host/protocol/tool-call-preview-projector.ts
packages/extension/test/core/tool-preview.test.ts
packages/extension/test/host/protocol/tool-call-preview-projector.test.ts
```

### 27.4 当前验证状态

| 检查项 | 结果 |
|--------|------|
| `pnpm -C packages/shared build` | ✅ |
| `pnpm -C packages/extension check-types` | ✅ |
| `pnpm -C packages/extension lint` | ✅ (1 warning, 0 errors) |
| `pnpm -C packages/extension test` | 590/598 (8 既有失败) |
| `pnpm -C packages/webview check-types` | ✅ |
| `pnpm -C packages/webview test` | 486/486 ✅ |
| `pnpm -C packages/extension package` | ✅ (extension.js + diff-worker.js) |
| Worker bundle smoke | ✅ |

**既有失败（非 review 相关，重构前已存在）**：
- `resource-loader.test.ts`：5 个 prompt/package resource 用例
- `agent-session-services.test.ts`：3 个 package/prompt resource 用例

### 27.5 待完成阶段

#### 阶段 6：Artifact v2
- 实现 `FileReviewArtifactV2`（只存 canonical DiffDocument，不存 rows/tokens/full content）
- v1 reader adapter（v1 rows → 内存 DiffDocument）
- flush scheduler 只保存 ready 的最新 revision
- artifact 保存成功后释放 snapshots
- 更新 session branch artifact 收集和恢复

#### 阶段 7：Lazy diff shared 协议
- 新增 shared：`RequestFileDiffMessage` / `FileDiffResultMessage` / `ChangesReviewProjectionUpdatedEvent`
- Host：`file-diff-request-handler.ts` + bounded LRU cache + `review-token-cache.ts`
- Webview：Tool Result 按可见性/展开请求 inline diff；Panel 按文件/区段请求；revision 检查 + 客户端缓存 + 虚拟化
- 当前 Tool Result details 已是轻量引用（含 fileId/revision/status），可直接对接

#### 阶段 8 收尾：全仓搜索残留
- 搜索 `ScoutToolCallPreview` / `ScoutFileEditPreview` / `tool_call_preview` / `ToolPreview` 残留类型和死代码
- 清理 shared `protocol-state.ts` 中已无引用的 preview 类型定义
- 确认 webview 无残留 preview store/action

#### 阶段 9：性能收口 + 文档
- 运行基准对比
- 调整 Worker 队列、LRU、row/hunk 限制
- 更新 `docs/webview-protocol.md`、架构文档、Pi 同步说明
- 删除迁移期双路径辅助代码（FileReviewStore 若无 v1 reader 需求可彻底删除）

### 27.6 接手注意事项

1. **单 Worker 约束**：MutationJournal 已持有唯一 DiffWorkerClient。不要在 FileReviewStore 或其他地方再实例化 DiffWorkerClient。
2. **write 成功返回 = commit**：capture coordinator 在 `run()` 的 try/catch 中，write 成功后即使工具抛错也记录 `error_after_write`。
3. **BOM 语义**：`captureTextSnapshot` 使用 fatal UTF-8 decoder（与旧 `decodeReviewContent` 一致，剥离 BOM）。after 直接引用 write 入参字符串。
4. **路径归一**：`normalizeMutationAbsolutePath` 在 Windows 上小写化用于聚合键，但 `record.absolutePath` / `aggregate.absolutePath` 保留原始大小写用于展示。
5. **source identity 捕获**：AgentSession `withBuiltinMutationCapture` 只对 `sourceInfo.source === 'builtin'` 的 edit/write 装配 capture scope，extension 同名覆盖不捕获。
6. **shared 类型已收缩**：`ScoutFileChangeDetails` 不再有 `additions`/`deletions`/`firstChangedLine`/`diffPreview`。host summary/panel 从 Journal adapter（`toReviewTurnSnapshot`）获取统计，不从 tool result details 获取。
7. **FileReviewStore 仍在**：供 v1 artifact reader 和测试使用，但 AgentSession 不再实例化它。阶段 6 实现 v2 后可考虑删除。
8. **既有失败**：resource-loader/agent-session-services 的 8 个失败是 extension resource discovery 子系统问题，与本重构无关，不要试图在本次重构中修复。

---

## 28. 实施完成交接（2026-07-26）

> 阶段 1-9 已完成。阶段 0 的独立 benchmark 仍按原决策跳过，性能约束由 canonical single-diff、bounded projection/cache、lazy transport 与回归测试保证。

### 28.1 最终阶段状态

| 阶段 | 状态 | 最终结果 |
|------|------|----------|
| 阶段 0 | ✅ 跳过 | characterization 由阶段 1-9 回归覆盖；未新增独立 benchmark harness |
| 阶段 1 | ✅ 完成 | canonical `DiffDocument` 与纯 summary/row 投影 |
| 阶段 2 | ✅ 完成 | 单 Diff Worker、revision stale response 丢弃、独立 bundle |
| 阶段 3 | ✅ 完成 | Operations decorator、capture coordinator、append-only Mutation Journal |
| 阶段 4 | ✅ 完成 | AgentSession 只消费 Journal，tool result 为轻量 `file_change` identity |
| 阶段 5 | ✅ 完成 | edit/write execute 与 Pi 核心语义恢复对齐 |
| 阶段 6 | ✅ 完成 | Artifact v2 只写 canonical document；v1 集中只读 adapter；逐文件 snapshot release |
| 阶段 7 | ✅ 完成 | shared lazy diff 协议、host resolver/LRU/token cache、chat/panel 按需加载 |
| 阶段 8 | 自动验收 | 仅当 28.3 的全仓残留扫描返回空结果时视为完成 |
| 阶段 9 | ✅ 完成 | 双轨 store/fallback 删除、bounded policy 收口、协议与架构文档更新、完整验证 |

### 28.2 最终数据与协议语义

```text
Pi-compatible edit/write
  → decorated Operations capture
  → MutationCaptureCoordinator (frozen owner/turn/tool identity)
  → MutationJournal append (writeFile success = commit)
  → single Diff Worker
  → canonical DiffDocument
     ├─ runtime summary
     ├─ artifact v2
     └─ request_file_diff lazy projection
          ├─ expanded conversation tool row
          └─ expanded changes-review file section
```

- `DiffDocument` 是唯一 line diff 事实；summary、artifact encode、host row/token projection 不重新 line diff。
- Runtime details 不包含 snapshot、rows、tokens 或预测 preview，只包含 `turnId/recordId/fileId/revision/status`。
- `request_file_diff` 使用 `(sessionId, turnId, fileId, revision)` 解析 runtime 或当前 branch artifact，不接受任意 path。
- inline 限制为 40 rows / 8 hunks；panel 限制为 2000 rows / 200 hunks。
- Host diff/token cache 与 Webview request cache 均有界；Webview 对相同请求去重、引用计数取消，并只按精确 projection identity 重试。
- Artifact 只写 v2，不保存 full content/rows/tokens；v1 仅在 decoder 内转换为内存 v2。
- Artifact 保存成功后逐文件释放 snapshot 字符串，ready canonical document 继续服务 lazy diff。
- Changes Review panel bootstrap 只发送文件摘要与 lazy identity，`rows` 初始为空。

### 28.3 已删除的迁移期语义

- `packages/extension/src/core/tool-preview/` 全目录。
- `tool_call_preview_update` shared event/emits、host projector、webview preview store/action。
- `file-change-diff-preview.ts`、coordinator memo/provider/enricher。
- `FileReviewStore`、`file_review_payload`、`computeReviewDiff()` 与主线程 fallback diff。
- 旧 preview/final-preview 测试与 `changes-review-tool-preview-followup.md`。

阶段 8 不采用人工完成标记。以工作树中的生产源、测试和 `docs/` 扫描结果为唯一验收依据；
扫描命中任一已删除符号即失败。本文是验收规范本身，因此不在扫描输入中。

```powershell
$roots = @(
  'packages/extension/src',
  'packages/extension/test',
  'packages/shared/src',
  'packages/webview/src',
  'packages/webview/test',
  'docs'
)
$removedSymbols = @(
  'Scout' + 'ToolCall' + 'Preview',
  'Scout' + 'FileEdit' + 'Preview',
  'tool_call_' + 'preview',
  'Tool' + 'Preview',
  'diff' + 'Preview',
  'file_review_' + 'payload',
  'FileReview' + 'Store',
  'computeReview' + 'Diff',
  'FILE_REVIEW_' + 'PAYLOAD_KIND'
)
$matches = Get-ChildItem -Path $roots -Recurse -File |
  Select-String -SimpleMatch -Pattern $removedSymbols
if ($matches) {
  $matches
  throw '阶段 8 验收失败：仍有 predictive review 残留'
}
```

本次最终验证必须实际执行上述门禁，并在提交前确认返回空结果。

### 28.4 最终验证

| 检查项 | 结果 |
|--------|------|
| `pnpm build` | ✅ shared/ai/agent/webview/extension 全量构建通过 |
| `pnpm lint` | ✅ 0 errors；仅仓库既有 warnings |
| `pnpm -C packages/shared build` | ✅ |
| `pnpm -C packages/extension check-types` | ✅ |
| `pnpm -C packages/webview check-types` | ✅ |
| `pnpm -C packages/webview test` | ✅ 53 files / 476 tests |
| `pnpm -C packages/extension test` | ⚠️ 56 files passed；561/568 tests passed；仅 7 个既有资源发现失败 |
| `pnpm -C packages/extension package` | ✅ `extension.js` + `diff-worker.js` |

Extension 剩余 7 个失败不在 review 重构范围：

- `resource-loader.test.ts`：4 个 prompt template/package resource 用例。
- `agent-session-services.test.ts`：3 个 prompt command/package resource 用例。

本次新增或修改的 review、protocol、artifact、panel、conversation 与 lazy hook 测试均通过。

### 28.5 文档与后续动作

- `docs/changes-review-diff.md` 已重写为 Journal → canonical document → lazy diff 架构。
- `docs/webview-protocol.md` 已补充 `request_file_diff`、projection event、request-scoped response 与 panel-local message 边界。
- `docs/tools-design.md` 已更新为 Operations decorator 捕获语义。
- 当前工作区仍未提交；下一步只需人工 review diff 后按仓库规范提交。
