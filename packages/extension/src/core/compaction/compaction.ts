import type {
  Api,
  AssistantMessage,
  Context,
  ImageContent,
  Model,
  SimpleStreamOptions,
  TextContent,
  Usage,
} from '@scout-agent/ai';
import { completeSimple } from '@scout-agent/ai';
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
  type AgentMessage,
  type StreamFn,
  type ThinkingLevel,
} from '@scout-agent/agent';
import { buildSessionContext, type CompactionEntry, type SessionEntry } from '../session/index.ts';
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  SUMMARIZATION_SYSTEM_PROMPT,
  serializeConversation,
} from './utils.ts';

/** 存储在生成的 compaction 条目上的文件操作详情。 */
export interface CompactionDetails {
  /** 被压缩历史中读取过的文件。 */
  readFiles: string[];
  /** 被压缩历史中修改过的文件。 */
  modifiedFiles: string[];
}

function extractFileOperations(
  messages: AgentMessage[],
  entries: SessionEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
    if (!prevCompaction.fromHook && prevCompaction.details) {
      const details = prevCompaction.details as CompactionDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) fileOps.edited.add(f);
      }
    }
  }
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }

  return fileOps;
}
function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === 'message') {
    return entry.message as AgentMessage;
  }
  if (entry.type === 'custom_message') {
    return createCustomMessage(
      entry.customType,
      entry.content as string | (TextContent | ImageContent)[],
      entry.display,
      entry.details,
      entry.timestamp,
    );
  }
  if (entry.type === 'branch_summary') {
    return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);
  }
  if (entry.type === 'compaction') {
    return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
  }
  return undefined;
}

function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === 'compaction') {
    return undefined;
  }
  return getMessageFromEntry(entry);
}

/** 生成的 compaction 数据，可直接持久化为 compaction 条目。 */
export interface CompactionResult<T = unknown> {
  /** 替换被压缩历史的摘要文本，将在后续上下文中使用。 */
  summary: string;
  /** 保留历史的起始条目 id。 */
  firstKeptEntryId: string;
  /** compaction 前的估算上下文 token 数。 */
  tokensBefore: number;
  /** 可选的实现特定详情，随 compaction 条目存储。 */
  details?: T;
}

/** compaction 阈值和保留设置。 */
export interface CompactionSettings {
  /** 启用自动 compaction 决策。 */
  enabled: boolean;
  /** 为摘要提示和输出预留的 token 数。 */
  reserveTokens: number;
  /** compaction 后保留的近似近期上下文 token 数。 */
  keepRecentTokens: number;
}

/** extension 会话编排使用的默认 compaction 设置。 */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

/** 根据供应商 usage 计算总上下文 token 数。 */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === 'assistant' && 'usage' in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (
      assistantMsg.stopReason !== 'aborted' &&
      assistantMsg.stopReason !== 'error' &&
      assistantMsg.usage
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

/** 返回 Session 条目中最后一个成功 assistant 消息的 usage。 */
export function getLastAssistantUsage(entries: SessionEntry[]): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'message') {
      const usage = getAssistantUsage(entry.message as AgentMessage);
      if (usage) return usage;
    }
  }
  return undefined;
}

/** 消息列表的估算上下文 token 用量。 */
export interface ContextUsageEstimate {
  /** 估算的总上下文 token 数。 */
  tokens: number;
  /** 最近的 assistant usage 块报告的 token 数。 */
  usageTokens: number;
  /** 最近 assistant usage 块之后的估算 token 数。 */
  trailingTokens: number;
  /** 提供 usage 的消息索引，不存在时为 null。 */
  lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/** 使用供应商 usage（可用时）估算消息的上下文 token 数。 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/** 返回上下文用量是否超过配置的 compaction 阈值。 */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(
  content: string | Array<{ type: string; text?: string }>,
): number {
  if (typeof content === 'string') {
    return content.length;
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      chars += block.text.length;
    } else if (block.type === 'image') {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

/** 使用保守字符启发式估算单条消息的 token 数。 */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case 'user': {
      chars = estimateTextAndImageContentChars(
        (message as { content: string | Array<{ type: string; text?: string }> }).content,
      );
      return Math.ceil(chars / 4);
    }
    case 'assistant': {
      const assistant = message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === 'text') {
          chars += block.text.length;
        } else if (block.type === 'thinking') {
          chars += block.thinking.length;
        } else if (block.type === 'toolCall') {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case 'custom':
    case 'toolResult': {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case 'bashExecution': {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    case 'branchSummary':
    case 'compactionSummary': {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }

  return 0;
}
function findValidCutPoints(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    switch (entry.type) {
      case 'message': {
        const role = entry.message.role;
        switch (role) {
          case 'bashExecution':
          case 'custom':
          case 'branchSummary':
          case 'compactionSummary':
          case 'user':
          case 'assistant':
            cutPoints.push(i);
            break;
          case 'toolResult':
            break;
        }
        break;
      }
      case 'thinking_level_change':
      case 'model_change':
      case 'compaction':
      case 'branch_summary':
      case 'custom':
      case 'custom_message':
      case 'label':
      case 'session_info':
        break;
    }
    if (entry.type === 'branch_summary' || entry.type === 'custom_message') {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

/** 找到包含某个条目的回合中，用户可见的起始消息。 */
export function findTurnStartIndex(
  entries: SessionEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type === 'branch_summary' || entry.type === 'custom_message') {
      return i;
    }
    if (entry.type === 'message') {
      const role = entry.message.role;
      if (role === 'user' || role === 'bashExecution') {
        return i;
      }
    }
  }
  return -1;
}

/** compaction 选定的切割点。 */
export interface CutPointResult {
  /** compaction 后保留的第一个条目的索引。 */
  firstKeptEntryIndex: number;
  /** 当切割拆分回合时，回合起始条目的索引；否则为 -1。 */
  turnStartIndex: number;
  /** 选定的切割点是否拆分了进行中的回合。 */
  isSplitTurn: boolean;
}

/** 找到保留约请求的近期 token 预算的 compaction 切割点。 */
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== 'message') continue;
    const messageTokens = estimateTokens(entry.message as AgentMessage);
    accumulatedTokens += messageTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    if (prevEntry.type === 'compaction') {
      break;
    }
    if (prevEntry.type === 'message') {
      break;
    }
    cutIndex--;
  }
  const cutEntry = entries[cutIndex];
  const isUserMessage = cutEntry.type === 'message' && cutEntry.message.role === 'user';
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

function createSummarizationOptions(
  model: Model<Api>,
  maxTokens: number,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
  thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
  const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers };
  if (model.reasoning && thinkingLevel && thinkingLevel !== 'off') {
    options.reasoning = thinkingLevel;
  }
  return options;
}

async function completeSummarization(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  if (!streamFn) {
    return completeSimple(model, context, options);
  }
  const stream = await streamFn(model, context, options);
  return stream.result();
}

/** 生成或更新用于 compaction 的对话摘要。 */
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model<Api>,
  reserveTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
): Promise<string> {
  const maxTokens = Math.min(
    Math.floor(0.8 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const completionOptions = createSummarizationOptions(
    model,
    maxTokens,
    apiKey,
    headers,
    signal,
    thinkingLevel,
  );

  const response = await completeSummarization(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    completionOptions,
    streamFn,
  );
  if (response.stopReason === 'error') {
    throw new Error(`Summarization failed: ${response.errorMessage || 'Unknown error'}`);
  }

  const textContent = response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  return textContent;
}

/** compaction 运行的已准备输入。 */
export interface CompactionPreparation {
  /** 保留历史的起始条目 id。 */
  firstKeptEntryId: string;
  /** 被摘要进历史摘要的消息。 */
  messagesToSummarize: AgentMessage[];
  /** 当 compaction 拆分回合时，单独摘要的前缀消息。 */
  turnPrefixMessages: AgentMessage[];
  /** compaction 是否拆分了回合。 */
  isSplitTurn: boolean;
  /** compaction 前的估算上下文 token 数。 */
  tokensBefore: number;
  /** 用于迭代更新的前一次 compaction 摘要。 */
  previousSummary?: string;
  /** 从已摘要历史中提取的文件操作。 */
  fileOps: FileOperations;
  /** 用于准备 compaction 的设置。 */
  settings: CompactionSettings;
}

/** 准备 Session 条目以进行 compaction，当 compaction 不适用时返回 undefined。 */
export function prepareCompaction(
  pathEntries: SessionEntry[],
  settings: CompactionSettings,
): CompactionPreparation | undefined {
  if (pathEntries.length === 0 || pathEntries[pathEntries.length - 1].type === 'compaction') {
    return undefined;
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === 'compaction') {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    const firstKeptEntryIndex = pathEntries.findIndex(
      (entry) => entry.id === prevCompaction.firstKeptEntryId,
    );
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens;

  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return undefined;
  }
  const firstKeptEntryId = firstKeptEntry.id;

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) messagesToSummarize.push(msg);
  }
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex);
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }

  return {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  };
}

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

export { serializeConversation } from './utils.ts';

/** 从已准备的 Session 历史生成 compaction 摘要数据。 */
export async function compact(
  preparation: CompactionPreparation,
  model: Model<Api>,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  } = preparation;

  let summary: string;

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    const [historyResult, turnPrefixResult] = await Promise.all([
      messagesToSummarize.length > 0
        ? generateSummary(
            messagesToSummarize,
            model,
            settings.reserveTokens,
            apiKey,
            headers,
            signal,
            customInstructions,
            previousSummary,
            thinkingLevel,
            streamFn,
          )
        : Promise.resolve('No prior history.'),
      generateTurnPrefixSummary(
        turnPrefixMessages,
        model,
        settings.reserveTokens,
        apiKey,
        headers,
        signal,
        thinkingLevel,
        streamFn,
      ),
    ]);
    summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
  } else {
    summary = await generateSummary(
      messagesToSummarize,
      model,
      settings.reserveTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
      streamFn,
    );
  }

  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  if (!firstKeptEntryId) {
    throw new Error('First kept entry has no UUID - session may need migration');
  }

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: { readFiles, modifiedFiles } as CompactionDetails,
  };
}
async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: Model<Api>,
  reserveTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
): Promise<string> {
  const maxTokens = Math.min(
    Math.floor(0.5 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
  const summarizationMessages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const response = await completeSummarization(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel),
    streamFn,
  );
  if (response.stopReason === 'error') {
    throw new Error(
      `Turn prefix summarization failed: ${response.errorMessage || 'Unknown error'}`,
    );
  }

  return response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
