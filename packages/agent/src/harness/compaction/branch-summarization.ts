import type { Api, Model } from '@scout-agent/ai';
import { completeSimple } from '@scout-agent/ai';
import type { AgentMessage } from '../../types.ts';
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from '../messages.ts';
import type { BranchSummaryResult, Session, SessionTreeEntry } from '../types.ts';
import { BranchSummaryError, err, ok, type Result, SessionError } from '../types.ts';
import { estimateTokens, SUMMARIZATION_SYSTEM_PROMPT } from './compaction.ts';
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from './utils.ts';

/** 存储在生成的分支摘要条目上的文件操作详情。 */
export interface BranchSummaryDetails {
  /** 在探索被摘要分支时读取的文件。 */
  readFiles: string[];
  /** 在探索被摘要分支时修改的文件。 */
  modifiedFiles: string[];
}

export type { FileOperations } from './utils.ts';

/** 用于摘要的已准备分支内容。 */
export interface BranchPreparation {
  /** 选定用于分支摘要的消息。 */
  messages: AgentMessage[];
  /** 从分支中提取的文件操作。 */
  fileOps: FileOperations;
  /** 选定消息的估算 token 数。 */
  totalTokens: number;
}

/** 选定用于分支摘要的条目。 */
export interface CollectEntriesResult {
  /** 按时间顺序排列的需要摘要的条目。 */
  entries: SessionTreeEntry[];
  /** 前一个叶节点和目标条目之间的最深公共祖先。 */
  commonAncestorId: string | null;
}

/** 生成分支摘要的选项。 */
export interface GenerateBranchSummaryOptions {
  /** 用于摘要的模型。 */
  model: Model<Api>;
  /** 转发到供应商的 API key。 */
  apiKey: string;
  /** 转发到供应商的可选请求头。 */
  headers?: Record<string, string>;
  /** 摘要请求的中止信号。 */
  signal: AbortSignal;
  /** 附加到或替换默认提示的可选指令。 */
  customInstructions?: string;
  /** 用自定义指令替换默认提示，而非追加。 */
  replaceInstructions?: boolean;
  /** 为提示和模型输出预留的 token 数。默认为 16384。 */
  reserveTokens?: number;
}

/** 收集在导航到不同 Session 树条目之前应被摘要的条目。 */
export async function collectEntriesForBranchSummary(
  session: Session,
  oldLeafId: string | null,
  targetId: string,
): Promise<CollectEntriesResult> {
  if (!oldLeafId) {
    return { entries: [], commonAncestorId: null };
  }
  const oldPath = new Set((await session.getBranch(oldLeafId)).map((e) => e.id));
  const targetPath = await session.getBranch(targetId);
  let commonAncestorId: string | null = null;
  for (let i = targetPath.length - 1; i >= 0; i--) {
    if (oldPath.has(targetPath[i].id)) {
      commonAncestorId = targetPath[i].id;
      break;
    }
  }
  const entries: SessionTreeEntry[] = [];
  let current: string | null = oldLeafId;

  while (current && current !== commonAncestorId) {
    const entry = await session.getEntry(current);
    if (!entry) throw new SessionError('invalid_session', `Entry ${current} not found`);
    entries.push(entry as SessionTreeEntry);
    current = entry.parentId;
  }
  entries.reverse();

  return { entries, commonAncestorId };
}
function getMessageFromEntry(entry: SessionTreeEntry): AgentMessage | undefined {
  switch (entry.type) {
    case 'message':
      if (entry.message.role === 'toolResult') return undefined;
      return entry.message;

    case 'custom_message':
      return createCustomMessage(
        entry.customType,
        entry.content,
        entry.display,
        entry.details,
        entry.timestamp,
      );

    case 'branch_summary':
      return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);

    case 'compaction':
      return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
    case 'thinking_level_change':
    case 'model_change':
    case 'custom':
    case 'label':
    case 'session_info':
    case 'leaf':
      return undefined;
  }
}

/** 在可选的 token 预算内准备分支条目以进行摘要。 */
export function prepareBranchEntries(
  entries: SessionTreeEntry[],
  tokenBudget: number = 0,
): BranchPreparation {
  const messages: AgentMessage[] = [];
  const fileOps = createFileOps();
  let totalTokens = 0;
  for (const entry of entries) {
    if (entry.type === 'branch_summary' && !entry.fromHook && entry.details) {
      const details = entry.details as BranchSummaryDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f);
        }
      }
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const message = getMessageFromEntry(entry);
    if (!message) continue;
    extractFileOpsFromMessage(message, fileOps);

    const tokens = estimateTokens(message);
    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        if (totalTokens < tokenBudget * 0.9) {
          messages.unshift(message);
          totalTokens += tokens;
        }
      }
      break;
    }

    messages.unshift(message);
    totalTokens += tokens;
  }

  return { messages, fileOps, totalTokens };
}

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** 为被放弃的分支条目生成摘要。 */
export async function generateBranchSummary(
  entries: SessionTreeEntry[],
  options: GenerateBranchSummaryOptions,
): Promise<Result<BranchSummaryResult, BranchSummaryError>> {
  const {
    model,
    apiKey,
    headers,
    signal,
    customInstructions,
    replaceInstructions,
    reserveTokens = 16384,
  } = options;
  const contextWindow = model.contextWindow || 128000;
  const tokenBudget = contextWindow - reserveTokens;

  const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);

  if (messages.length === 0) {
    return ok({ summary: 'No content to summarize', readFiles: [], modifiedFiles: [] });
  }
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  let instructions: string;
  if (replaceInstructions && customInstructions) {
    instructions = customInstructions;
  } else if (customInstructions) {
    instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`;
  } else {
    instructions = BRANCH_SUMMARY_PROMPT;
  }
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;

  const summarizationMessages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];
  const response = await completeSimple(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    { apiKey, headers, signal, maxTokens: 2048 },
  );
  if (response.stopReason === 'aborted') {
    return err(
      new BranchSummaryError('aborted', response.errorMessage || 'Branch summary aborted'),
    );
  }
  if (response.stopReason === 'error') {
    return err(
      new BranchSummaryError(
        'summarization_failed',
        `Branch summary failed: ${response.errorMessage || 'Unknown error'}`,
      ),
    );
  }

  let summary = response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  summary = BRANCH_SUMMARY_PREAMBLE + summary;
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  return ok({
    summary: summary || 'No summary generated',
    readFiles,
    modifiedFiles,
  });
}
