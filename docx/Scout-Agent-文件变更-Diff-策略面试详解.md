# Scout Agent 文件变更 Diff 策略：面试详解

> 适用于高级前端、Node.js、Agent Runtime、VS Code Extension 等岗位的技术面试。

## 一、60 秒回答

我的 Diff 策略不是在 UI 层临时比较当前文件，而是在 `edit` 和 `write` 的真实写入提交点捕获修改前后的文件快照。

同一个 Agent turn 内，同一文件可能被多次修改，因此我使用 `MutationJournal` 按 turn 和文件聚合：只保留第一份 baseline 和最后一份 after，同时保留每次工具调用的轻量 record。

Diff 由单独的 Worker 计算，并生成唯一的 canonical `DiffDocument`。Summary、聊天内 Diff 和完整 Changes Review Panel 都从这个 document 投影，不会各自重新计算。

工具结果只携带 `turnId`、`fileId`、`recordId` 和 `revision` 等轻量引用，完整文件内容和 Diff rows 不会进入模型上下文。

`agent_end` 时会封口当前 turn，等待 Diff 终态化，然后通过标准 `appendEntry()` 写入一个隐藏的 session artifact。Webview 只有在用户展开文件时才按需请求 Diff rows 和语法 token。

这套设计主要解决了五个问题：

1. Diff 必须来自真实写入结果，而不是预测结果。
2. 并行修改和连续 revision 不能相互覆盖。
3. 历史会话必须能恢复当时的变更。
4. 模型上下文、JSONL、协议和 DOM 都必须有界。
5. Runtime、持久化和 UI 不能形成多个事实源。

---

## 二、为什么不能直接使用 Git Diff

Agent 的一次修改不一定对应一次 Git 操作：

- 项目可能没有初始化 Git。
- 文件可能本来就包含用户的未提交修改。
- 一个 assistant 回复可能执行多个 `edit` 和 `write`。
- 同一个文件可能在一个 turn 内被连续修改。
- 工具可能由远程 Operations 实现，而不是直接操作本地文件。

如果直接读取工作区并执行 Git Diff，就无法精确区分：

- 用户原来已经存在的修改；
- 本轮 Agent 新引入的修改；
- Agent 后续 turn 再次修改产生的变化。

因此 Scout 在工具执行时捕获本轮修改自己的 before/after，而不是把 Git 工作区当作 Diff 边界。

---

## 三、整体架构

```text
内置 edit / write
    │
    ├─ Operations Capture Decorator
    │      └─ 在真实写入提交点捕获 mutation
    ▼
MutationCaptureCoordinator
    ▼
MutationJournal ──► 单 Diff Worker ──► Canonical DiffDocument
    │                                        │
    ├─ tool_result：轻量 file_change 引用     ├─ Summary projection
    └─ agent_end：封口、终态化、持久化         └─ Lazy rows / tokens
                                             ▼
                              Chat Inline Diff / Changes Review Panel
```

分层职责如下：

- `extension/core/tools`：执行 Pi-compatible 的 `edit` 和 `write`。
- `extension/core/review`：捕获 mutation、维护 Journal、生成 DiffDocument、持久化 artifact。
- `extension/core/agent-session`：提供工具包装接入和标准 session mutation API。
- `extension/host/review`：把 canonical document 投影为 summary、rows 和 tokens。
- `extension/host/protocol`：校验并处理 Webview 的懒加载请求。
- `webview`：保存轻量状态，按需请求和展示 Diff。

---

## 四、文件修改事实如何采集

### 4.1 只捕获内置工具

Scout 只对来源为 `builtin` 的 `edit` 和 `write` 添加 capture decorator。

扩展即使注册了同名工具，也不会被误捕获，避免把不满足 Scout 文件写入语义的第三方工具纳入 Review。

### 4.2 写入成功是唯一 mutation 提交点

采集顺序是：

1. 写入前获取 before snapshot。
2. 执行真实 `writeFile`。
3. 写入成功后获取 after snapshot。
4. 将 mutation 追加到 Journal。

只有真实磁盘或远程存储已经发生改变，才会生成 mutation record。

如果文件已经写入成功，但工具随后出现异常，Scout 仍然保留这次修改，并将结果标记为：

```ts
toolOutcome: 'error_after_write'
```

这是为了避免出现“工具显示失败，但文件实际上已经被修改，Review 却没有记录”的错误。

### 4.3 edit 和 write 的 baseline 策略

`edit` 已经需要读取文件来匹配 `oldText`，因此 Review 直接复用同一份 Buffer，不额外读取磁盘。

`write` 通过 `ReviewSnapshotProvider` 获取 baseline。远程 Operations 如果没有提供 snapshot provider，不会偷偷回退读取本地路径，否则远程文件和本地文件可能不是同一个资源。

文本使用严格 UTF-8 解码。以下情况只会让 Review 降级，不会阻止工具写入：

- 二进制文件；
- 非法 UTF-8；
- 文件内容超过 Review 上限；
- before 或 after 无法读取。

---

## 五、MutationJournal 如何聚合同一轮修改

Journal 的聚合键包含：

```text
ownerId + turnId + normalizedAbsolutePath
```

### 5.1 Record

每次工具调用都会保留一个轻量 record：

```ts
interface MutationRecord {
  recordId: string;
  turnId: string;
  toolCallId: string;
  operation: 'edit' | 'write';
  absolutePath: string;
  displayPath?: string;
  sequence: number;
  toolOutcome: 'success' | 'error_after_write';
}
```

Record 用于关联工具调用和最终 Review，但不重复保存完整 before/after。

### 5.2 File Aggregate

同一个 turn 内，同一文件被修改多次时：

- 第一份 before 作为 turn baseline；
- 最后一份 after 作为 turn 最终状态；
- 每次修改递增 revision；
- 所有 recordId 都关联到同一个文件 aggregate。

例如：

```text
file A:
  edit 1: before A0 → after A1
  edit 2: before A1 → after A2
  write 3: before A2 → after A3

最终聚合：
  baseline = A0
  latest   = A3
  records  = [edit1, edit2, write3]
```

这样既能描述整个 turn 对文件的最终影响，又不会保存三组重复快照。

---

## 六、Canonical DiffDocument

Scout 将 Diff 统一为一个 canonical document：

```ts
interface DiffDocument {
  version: 1;

  beforeFingerprint?: {
    size: number;
    sha256: string;
  };

  afterFingerprint?: {
    size: number;
    sha256: string;
  };

  beforeLineCount: number;
  afterLineCount: number;

  additions: number;
  deletions: number;
  firstChangedLine?: number;

  hunks: DiffHunk[];
  unavailableReason?: DiffUnavailableReason;
}
```

每个 hunk 保存：

```ts
interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;

  lines: Array<
    | { type: 'context'; text: string }
    | { type: 'removed'; text: string }
    | { type: 'added'; text: string }
  >;
}
```

### 6.1 为什么只计算一次 Diff

如果 Summary、聊天预览和完整 Panel 分别计算 Diff，会产生以下风险：

- 不同模块使用不同上下文行数；
- additions/deletions 统计不一致；
- 大文件被重复计算；
- UI 展开阻塞 Extension Host；
- 历史恢复时误读当前工作区文件。

因此 Diff Worker 只生成一次 `DiffDocument`，其他模块只负责投影。

### 6.2 为什么 syntax tokens 不属于 canonical 数据

语法 token 只用于展示，而且生成成本较高。它们不会影响修改事实，因此：

- 不写入 `DiffDocument`；
- 不写入工具结果；
- 不进入模型上下文；
- 只有 UI 请求时才生成；
- 生成结果进入 bounded LRU cache。

---

## 七、单 Worker、Revision 和迟到响应

每个文件 aggregate 都有 revision。

```text
revision 1 ──► Worker（较慢） ───────────────┐
revision 2 ──► Worker（较快） ──► 提交结果   │
                                               └─ revision 1 返回：丢弃
```

Worker 返回结果时必须同时匹配：

- ownerId；
- turnId；
- fileId；
- revision。

只有与当前 revision 完全一致的响应才能提交。

这避免了同一文件快速连续修改时，旧 Diff 结果覆盖新 Diff。

---

## 八、Turn 封口和终态化

一个 turn 有两个阶段：

```ts
phase: 'active' | 'finalized'
```

### active

- 可以继续追加 mutation；
- Diff revision 可能仍处于 pending；
- UI 可以展示正在生成。

### finalized

- turn 已经 seal；
- 禁止追加新的 mutation；
- 所有当前 revision 都已经 settled；
- 可以生成和持久化完整 artifact。

`agent_end` 时执行：

1. 获取当前 active turnId。
2. 清除 active pointer。
3. seal 当前 turn。
4. 等待所有当前 revision 完成。
5. 超时的 revision 降级为 `generation_failed`。
6. 生成一个完整 artifact。
7. 通过标准 `appendEntry()` 写入 session。

超时降级后，同 revision 的迟到 Worker 响应不能再覆盖 terminal fallback。

---

## 九、为什么使用内置扩展驱动 Review

当前 Review 生命周期由 `FileReviewExtensionController` 管理：

| 事件 | 动作 |
|---|---|
| `agent_start` | 创建新的 run/turn ID |
| `tool_result` | 添加轻量 `file_change` details |
| `agent_end` | seal、finalize 并持久化 artifact |
| `session_shutdown` | 终态化当前 turn，重试 pending artifact |
| JSONL export | 导出前刷新 pending artifact |

这种方式比 Host 层维护 debounce、idle scheduler 和 write tail 更可靠。

原因是 `agent_end` handler 是 awaited 的，artifact 写入属于 Agent 生命周期的确定完成边界。

如果 append 临时失败：

- 不会把 turn 标记为 committed；
- 不会释放唯一数据；
- `session_shutdown` 可以重试；
- JSONL 导出前也会重试。

---

## 十、工具结果为什么只保存轻量引用

工具结果中的 Review details 类似：

```ts
interface ScoutFileChangeDetails {
  kind: 'file_change';
  path: string;
  displayPath?: string;

  review: {
    turnId: string;
    recordId: string;
    fileId: string;
    revision: number;
    status: 'pending' | 'ready' | 'unavailable';
  };

  toolOutcome?: 'success' | 'error_after_write';
}
```

ToolResultMessage 会进入下一轮模型上下文。如果把完整 before/after、Diff rows 或 token 放进去，会产生：

- 模型 token 成本；
- Provider payload 膨胀；
- Session message 体积增大；
- Agent 层泄漏 UI 类型；
- Runtime 与 artifact 形成多个事实源。

因此工具结果只告诉模型“哪个文件发生了什么修改”，完整 Review 数据通过独立存储和协议访问。

---

## 十一、Artifact 持久化策略

每个完成的 turn 会写入一个隐藏 custom entry：

```text
scout.file_review_artifact
```

它属于 append-only session history，但不会作为 Webview tree 中可高亮的可见节点。

Artifact 保存：

- `sessionId`；
- `turnId`；
- `createdAt`；
- `complete`；
- record identity；
- 文件 identity；
- revision；
- canonical `DiffDocument`。

Artifact 不保存：

- 完整修改前文件；
- 完整修改后文件；
- 已投影的 `ScoutChangesReviewSummary`；
- syntax tokens；
- UI 展开和滚动状态；
- hunks 之间被省略的完整文本。

Summary 在恢复后从 artifact 动态投影，避免持久化两份可能不一致的数据。

---

## 十二、Artifact 限流与降级

当前单 turn 限制：

| 限制 | 当前值 |
|---|---:|
| 文件数量 | 100 |
| Hunk lines | 20,000 |
| Artifact 大小 | 2 MB |
| 默认上下文 | 3 行 |

超限时按以下顺序处理：

1. 对大型文件折叠 Diff hunks；
2. 标记对应文件 `diff_too_large`；
3. 如果仍然超限，删除 overflow 文件；
4. 同步过滤失去文件引用的 records；
5. 返回明确的 degraded 状态和诊断信息。

### 完整 Artifact

如果 artifact 没有被裁剪，持久化成功后可以驱逐对应 runtime turn：

- records；
- aggregate；
- DiffDocument；
- before/after snapshot。

### 降级 Artifact

如果 artifact 因 rows、bytes 或 files 上限发生降级：

- 只释放重型 before/after snapshot；
- 保留更完整的 terminal runtime DiffDocument；
- UI 优先读取 runtime；
- artifact 作为恢复后的有界 fallback。

核心原则是：

> 持久化限流不能反过来降低当前运行态 Review 的完整度。

---

## 十三、Host 和 Webview 如何懒加载

初始聊天消息和完整 Changes Review Panel 只接收文件摘要，不包含 Diff rows。

用户展开工具行或文件后，Webview 才发送：

```ts
{
  type: 'request_file_diff';
  sessionId: string;
  turnId: string;
  fileId: string;
  revision: number;
  view: 'inline' | 'panel';
  mode: 'unified' | 'split';
  includeTokens: boolean;
  range?: {
    hunkOffset: number;
    hunkLimit: number;
  };
}
```

Host Resolver 的查找顺序是：

1. 当前 runtime review；
2. 当前 session branch 中完整的 artifact。

它不会接受只包含 path 的查询，也不会读取当前磁盘文件重新生成历史 Diff。

### UI 边界

| 视图 | Hunk 上限 | Row 上限 |
|---|---:|---:|
| Chat Inline Diff | 8 | 40 |
| Changes Review Panel | 200 | 2,000 |

完整 Panel 按 hunk 分批加载，避免一次性把大型 Diff 挂载到 DOM。

Webview 对相同请求进行：

- 去重；
- 引用计数；
- pending 状态重试；
- 卸载时取消 transport 请求。

---

## 十四、当前实现的主要限制

当前 canonical hunks 只保存变更附近 3 行上下文。

Host 生成 fold row 时只返回：

- old/new 起始行；
- 省略行数。

它没有省略区域的文本，因此当前折叠条不能点击展开完整中间代码。

这是保持 JSONL 较小的直接代价。

### 低成本恢复方案

可以恢复旧实现中的思路，但改成懒加载：

1. Artifact 保留 `afterFingerprint`。
2. 用户点击 fold 后，Host 读取当前文件。
3. 当前文件 fingerprint 必须与 artifact 完全一致。
4. 一致时按分页返回省略上下文。
5. 不一致时显示“文件已继续修改，历史上下文不可展开”。

这个方案不会明显增加 JSONL，但它只能展开仍然匹配当前磁盘状态的 Review，不是真正的历史归档。

如果要求跨分支、跨机器、重启后始终能够展开，就必须额外持久化 context 或内容寻址 blob。

---

## 十五、当前数据能否支持撤销

当前 hunks 已经保存 added 和 removed 文本，因此可以实现受保护的 turn 级撤销。

安全流程是：

1. 读取当前文件。
2. 校验当前 fingerprint 等于 artifact 的 `afterFingerprint`。
3. 反向应用 hunks。
4. 写入完成后校验 fingerprint 等于 `beforeFingerprint`。
5. 把撤销作为新的 mutation 记录，而不是修改旧 session history。

可以支持：

- 普通 UTF-8 文本的 turn 级撤销；
- 同一文件在一个 turn 内连续修改后的整体撤销；
- 多文件 turn 的整体撤销；
- 文件创建的撤销；
- 数据完整时的文件删除恢复。

限制包括：

- 文件继续变化后不能直接撤销；
- 不能撤销聚合 turn 中某一次单独 tool call；
- `content_too_large`、`diff_too_large` 或 artifact 被裁剪时无法保证；
- 混合换行、BOM、权限和时间戳不能保证字节级恢复；
- 多文件撤销需要先整体校验，并处理写入中途失败的回滚。

---

## 十六、为什么不选择其他实现

### 每次打开 UI 时重新读取文件并计算 Diff

问题：

- 当前文件可能已经被后续 turn 修改；
- 历史 Diff 会漂移；
- UI 展开时重复消耗 CPU；
- 无法区分用户原有修改。

当前方案：在 mutation 发生时生成 canonical document。

### 工具结果直接携带 before/after

问题：

- 模型上下文膨胀；
- Session message 过大；
- UI 类型泄漏到 Agent 层。

当前方案：Tool result 只携带 Review identity。

### 每次工具调用保存一份完整快照

问题：

- 同一文件多次修改时重复占用内存；
- Session artifact 快速膨胀。

当前方案：turn 级 baseline/latest 聚合。

### Host 使用 debounce/idle scheduler 保存 Artifact

问题：

- 生命周期分散；
- replacement、shutdown 和 export 容易漏写；
- Host 承担了 core session 职责。

当前方案：使用 awaited extension lifecycle。

### UI 持久化 rows 和 tokens

问题：

- rows 是展示格式，不是事实；
- tokens 容易随渲染器升级失效；
- 与 DiffDocument 形成双重事实源。

当前方案：按需从 canonical document 投影。

---

## 十七、3 分钟完整回答

我把文件修改 Diff 拆成事实采集、运行态聚合、canonical diff、持久化和展示五个阶段。

首先，只有内置 `edit` 和 `write` 会被包装，并且以真实 `writeFile` 成功作为 mutation commit point。这样拿到的是实际写入结果，而不是工具执行前的预测。`edit` 会复用已经读取的 Buffer，`write` 通过 snapshot provider 获取 baseline。即使写入成功后工具再报错，也会记录为 `error_after_write`。

第二层是 `MutationJournal`。它按 owner、turn 和规范化路径聚合。同一个 turn 对同一文件多次修改，只保留第一份 baseline 和最后一份 after，但每次 tool call 的轻量 record 会保留。每个 aggregate 都有 revision。

第三层是单 Diff Worker。Worker 生成唯一的 canonical `DiffDocument`，其中包含 before/after fingerprint、行数、增删统计以及有限上下文的 hunks。Worker 返回结果必须匹配当前 `fileId` 和 revision，旧 revision 的迟到结果不能覆盖新结果。

第四层是事件驱动持久化。`agent_end` 会封口 turn，等待 pending revision 完成，超时则原子降级，然后通过标准 `appendEntry()` 写入一个隐藏 artifact。`session_shutdown` 和 JSONL export 会重试尚未提交的 artifact，确保不会因为瞬时写入失败丢失 Review。

最后是展示层。工具结果只带 `turnId`、`fileId`、`recordId` 和 revision 等轻量引用。Webview 只有在用户展开时才请求 Diff，Host 优先查 runtime，再查当前 session branch 的完整 artifact，并按照 inline 和 panel 的策略限制 hunks、rows 和 tokens。

整套设计的核心价值是：

- 真实写入后采集；
- 同一文件按 turn 聚合；
- 一次 Diff，多处投影；
- revision 防止迟到覆盖；
- 生命周期内可靠持久化；
- 模型上下文和 UI 都保持轻量；
- 大文件和异常路径可以明确降级。

---

## 十八、高频追问

### Q1：为什么不用 Git Diff？

因为 Review 的边界是一次 Agent turn，而不是 Git 工作树。文件可能本来就有用户修改，也可能没有 Git。捕获 before/after 可以只描述本轮 Agent 引入的变化。

### Q2：两个 edit 并行修改同一文件怎么办？

工具层使用 file mutation queue 按真实路径串行化写入；Review 层再通过 revision latest-wins 聚合，旧 Worker 响应会被丢弃。

### Q3：为什么不保存每次 edit 的完整 Diff？

产品主要审查一次 turn 的最终影响。每次调用都保存完整快照会重复占用内存。Record 已经能够保留每次调用的身份和顺序。

### Q4：为什么不把 Summary 直接持久化？

Summary 可以从 canonical DiffDocument 推导。单独持久化会形成第二事实源，未来字段或投影规则变化时容易与真实 Diff 不一致。

### Q5：进程在 agent_end 前被强杀怎么办？

正常 abort、replacement、dispose 和 shutdown 都会经过 awaited 生命周期。操作系统强杀不承诺把尚未到达 hook 的内存状态落盘，这是明确的故障边界。

### Q6：历史文件后来又变化了怎么办？

已持久化的 canonical hunks 仍然准确，因为它们不依赖当前磁盘。当前没有持久化的省略上下文则不能展开，也不能使用后来文件的内容冒充历史。

### Q7：这个方案最大的缺点是什么？

为了保持 JSONL 小且有界，当前只保存有限上下文，因此不能展开 hunks 中间被省略的完整代码。

### Q8：后续怎样低成本恢复展开能力？

可以在点击 fold 时读取当前文件，并要求当前 fingerprint 与 artifact 的 `afterFingerprint` 完全一致。一致才返回上下文，不一致则明确拒绝。

### Q9：为什么 Diff 要放到 Worker？

大文件行级 Diff 属于 CPU 密集操作。放在 Worker 中可以避免阻塞 Extension Host 的消息处理、工具事件和 Webview 协议。

### Q10：为什么 artifact 要有 `complete`？

它表示 artifact 来自已经封口、所有当前 revision 都处于 terminal 状态的最终快照。Host 只把 complete artifact 当作可靠历史来源。

---

## 十九、面试表达重点

不要只回答：

> 我用 diff 库比较修改前后的文件，然后展示到页面。

这只能说明使用了一个库，没有体现系统设计。

建议主动讲清楚：

1. 为什么在真实写入提交点采集；
2. 为什么需要 turn 和文件聚合；
3. revision 如何解决并发和迟到响应；
4. 为什么 DiffDocument 是唯一事实源；
5. agent_end 如何封口和持久化；
6. 为什么工具结果只放轻量引用；
7. UI 如何懒加载并保持有界；
8. 大文件和失败场景如何降级；
9. 当前方案牺牲了什么能力；
10. 后续展开和撤销能力如何演进。

一句话收尾：

> 我解决的不是“怎么显示一个 Diff”，而是“在并行、可恢复、有资源上限的 Agent Runtime 中，如何准确记录并展示一次文件修改”。
