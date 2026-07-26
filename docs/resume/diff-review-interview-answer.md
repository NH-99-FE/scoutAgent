# Agent 文件 Diff Review：面试回答

## 面试官问题

请介绍一下你这个 Diff Review 是怎么做的？其中有哪些技术难点？

## 回答示例

我做的是一套 Agent 文件变更的 Diff Review。核心目标是：Agent 一次执行里可能多次修改多个文件，但用户看到的应该是最终、可靠、可恢复展示的“净变更”，并且不能阻塞 Agent 的工具执行。

整体流程分为四层：

```text
工具生命周期采集
  → 文件变更聚合
  → Worker 异步计算 Diff
  → 持久化与 UI 懒加载展示
```

第一层是在文件工具执行前后采集快照。根据工具参数中的文件路径，执行前读取 `before`，执行后读取 `after`。同一轮里同一个文件被连续修改时，不保存每一次中间状态，而是保留第一次修改前的内容和最后一次修改后的内容，得到一次操作的净变化。

第二层是主线程的 `MutationJournal`。它按 `ownerId + turnId + fileId` 聚合文件状态，维护 `baseline`、`latest` 和递增的 `revision`。这层是事实来源，负责记录“这次 Agent 最终改了什么”；Worker 只是计算器，不拥有会话状态。

第三层是独立的 Diff Worker。主线程将 `before`、`after` 和 `revision` 发送给 Worker；Worker 进行行级 Diff、统计增删行，并生成带有限上下文的 hunk，最后回传标准化的 `DiffDocument`。将计算放在 Worker 中是为了避免大文本 Diff 的 CPU 和内存开销卡住 VS Code 扩展主线程，也避免影响工具调用和流式输出。

并发控制采用 **latest-wins**。同一文件短时间连续改动时，已经开始计算的旧任务无法强制取消，但等待队列只保留最新 revision；旧任务返回后，主线程会按 revision 丢弃过期结果。这样既避免旧 Diff 覆盖新状态，也避免重复计算每一个中间版本。

最后是持久化和展示。计算出的 canonical `DiffDocument` 会以隐藏的 custom artifact 写入 session JSONL。它不进入模型上下文，也不会作为普通消息显示在会话树中。UI 先展示轻量摘要，用户点开文件时再请求完整 hunk，实现懒加载。为了控制存储和内存，Diff 有文件数、行数和字节上限；超限或计算失败时，保留明确的不可用原因，而不是让整个 review 功能失败。

## 难点

### 1. 并发下的正确性

文件可能在 Worker 计算期间再次被修改，因此不能“谁先返回就用谁”。解决方式是以 `revision` 表示文件聚合状态的业务版本，以 `requestId` 匹配一次 Worker 请求与响应，并在 Worker 客户端和 `MutationJournal` 写回处都校验一次版本。只有仍对应当前 revision 的结果才能被采用。

### 2. 工具调用不等于最终变更

一次 Agent 操作可能连续 write、edit、删除或重命名同一个文件。直接展示每次工具调用会非常碎片化，也会重复展示中间状态。因此采用 first-before / last-after 聚合策略，将多次操作收敛为一个净 Diff。新建文件表示为 `null → content`，删除文件表示为 `content → null`。

### 3. 性能、存储与体验的平衡

完整保存文件快照、完整 Diff 和完整 UI 行数据，会使 session JSONL 与内存持续膨胀。因此：

- 在 Worker 中计算 Diff；
- 限制输入文件大小和最大 Diff 行数；
- 只持久化 canonical hunk 与必要元数据；
- UI 按需请求不同粒度的数据。

### 4. 持久化与模型上下文隔离

Review 数据需要随着 session 恢复，但不能污染 Agent 下一次请求模型的 messages，也不应成为会话树中的普通聊天节点。因此使用隐藏的持久化 artifact：它可恢复、可导出，但不进入 provider context 和 visible tree。

## 可主动说明的取舍

当前 canonical Diff 只保留变更行附近的有限上下文，因此折叠的大段未变文本不能离线展开。这是为了控制持久化体积做出的取舍。

如果产品需要展开能力，可以在用户点击时读取当前文件，并以 `afterFingerprint` 校验内容仍与该 Diff 对应，然后分页返回折叠区内容。这种方案成本较低，但只适用于当前文件仍与历史版本一致的情况。

如果要求跨机器、历史版本始终可展开，则需要额外持久化完整文件内容或 blob；代价是存储、迁移与生命周期管理明显增加。
