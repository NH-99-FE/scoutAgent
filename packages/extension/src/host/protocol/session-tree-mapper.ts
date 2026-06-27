// ============================================================
// Session tree mapper — Webview 会话树协议适配
// 负责：将 core session tree 映射为 shared webview 协议树，并解析可见 leaf。
// ============================================================

import type {
  ScoutSessionTreeNode,
  ScoutSessionTreeNodeKind,
  ScoutSessionTreeToolArgument,
  ScoutSessionTreeToolCall,
} from '@scout-agent/shared';
import type { SessionTreeEntry, SessionTreeNode } from '../../core/session/index.ts';

interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
}

type ToolCallQueuesById = Map<string, ToolCallInfo[]>;

interface SerializedValue {
  value: ScoutSessionTreeToolArgument;
  truncated: boolean;
}

export interface ScoutSessionTreeProjection {
  tree: ScoutSessionTreeNode[];
  leafId: string | null;
}

const MAX_TOOL_ARGUMENT_STRING_LENGTH = 500;
const MAX_TOOL_ARGUMENT_ARRAY_ITEMS = 20;
const MAX_TOOL_ARGUMENT_OBJECT_KEYS = 20;
const MAX_TOOL_ARGUMENT_DEPTH = 4;

export function projectSessionTreeToScout(
  nodes: SessionTreeNode[],
  rawLeafId: string | null,
): ScoutSessionTreeProjection {
  return {
    tree: mapSessionTreeToScout(nodes),
    leafId: resolveVisibleSessionLeafId(nodes, rawLeafId),
  };
}

export function mapSessionTreeToScout(nodes: SessionTreeNode[]): ScoutSessionTreeNode[] {
  const mapNode = (
    node: SessionTreeNode,
    visibleParentId: string | null,
    toolCallQueues: ToolCallQueuesById,
  ): ScoutSessionTreeNode[] => {
    const entry = node.entry;
    const { matchedToolCall, nextToolCallQueues } = advanceToolCallQueues(entry, toolCallQueues);
    const preview = extractPreview(entry);
    if (!isVisibleSessionTreeEntry(entry, preview)) {
      return node.children.flatMap((child) => mapNode(child, visibleParentId, nextToolCallQueues));
    }

    const mapped: ScoutSessionTreeNode = {
      id: entry.id,
      parentId: visibleParentId,
      timestamp: entry.timestamp,
      type: entry.type,
      kind: getNodeKind(entry),
      role: getNodeRole(entry),
      toolCall: getNodeToolCall(entry, matchedToolCall),
      stopReason: getNodeStopReason(entry),
      errorMessage: getNodeErrorMessage(entry),
      label: node.label,
      labelTimestamp: node.labelTimestamp,
      preview,
      children: node.children.flatMap((child) => mapNode(child, entry.id, nextToolCallQueues)),
    };
    return [mapped];
  };

  return nodes.flatMap((node) => mapNode(node, null, new Map()));
}

export function resolveVisibleSessionLeafId(
  nodes: SessionTreeNode[],
  leafId: string | null,
): string | null {
  if (leafId === null) return null;

  const nodeById = new Map<string, SessionTreeNode>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodeById.set(node.entry.id, node);
    stack.push(...node.children);
  }

  let currentId: string | null = leafId;
  while (currentId !== null) {
    const node = nodeById.get(currentId);
    if (!node) return null;
    if (isVisibleSessionTreeEntry(node.entry, extractPreview(node.entry))) {
      return node.entry.id;
    }
    currentId = node.entry.parentId;
  }
  return null;
}

function getNodeKind(entry: SessionTreeEntry): ScoutSessionTreeNodeKind | undefined {
  if (entry.type === 'message') {
    if (entry.message.role === 'user') return 'user';
    if (entry.message.role === 'assistant') return 'assistant';
    if (entry.message.role === 'bashExecution') return 'bashExecution';
    if (entry.message.role === 'toolResult') return 'toolResult';
    return undefined;
  }
  if (entry.type === 'compaction') return 'compaction';
  if (entry.type === 'branch_summary') return 'branchSummary';
  if (entry.type === 'custom_message') return 'custom';
  return undefined;
}

function getNodeRole(entry: SessionTreeEntry): string | undefined {
  return entry.type === 'message' ? entry.message.role : undefined;
}

function getNodeToolCall(
  entry: SessionTreeEntry,
  matchedToolCall: ToolCallInfo | undefined,
): ScoutSessionTreeToolCall | undefined {
  if (entry.type !== 'message' || entry.message.role !== 'toolResult') return undefined;
  const serializedArgs = serializeToolArguments(matchedToolCall?.arguments ?? {});
  return {
    id: entry.message.toolCallId,
    name: matchedToolCall?.name ?? entry.message.toolName,
    arguments: serializedArgs.arguments,
    truncated: serializedArgs.truncated,
  };
}

function getNodeStopReason(entry: SessionTreeEntry): string | undefined {
  if (entry.type !== 'message' || entry.message.role !== 'assistant') return undefined;
  return entry.message.stopReason;
}

function getNodeErrorMessage(entry: SessionTreeEntry): string | undefined {
  if (entry.type !== 'message' || entry.message.role !== 'assistant') return undefined;
  return entry.message.errorMessage;
}

function isVisibleSessionTreeEntry(entry: SessionTreeEntry, preview: string | undefined): boolean {
  return (
    (entry.type === 'message' && isVisibleMessageEntry(entry, preview)) ||
    entry.type === 'compaction' ||
    entry.type === 'branch_summary' ||
    (entry.type === 'custom_message' && entry.display)
  );
}

function isVisibleMessageEntry(
  entry: Extract<SessionTreeEntry, { type: 'message' }>,
  preview: string | undefined,
): boolean {
  if (entry.message.role !== 'assistant') return true;
  return !isHiddenEmptyAssistantMessage(entry.message, preview);
}

// 对齐 Pi tree selector：无文本且非失败的 assistant 只保留在 raw history 中。
function isHiddenEmptyAssistantMessage(
  message: Extract<SessionTreeEntry, { type: 'message' }>['message'],
  preview: string | undefined,
): boolean {
  if (message.role !== 'assistant') return false;
  const hasFailureStopReason =
    Boolean(message.stopReason) &&
    message.stopReason !== 'stop' &&
    message.stopReason !== 'toolUse';
  return !preview && !hasFailureStopReason && !message.errorMessage;
}

/** 从 entry 中提取 webview 树预览文本（首行，截断到 80 字符）。 */
function extractPreview(entry: SessionTreeEntry): string | undefined {
  const MAX_PREVIEW = 80;

  if (entry.type === 'message') {
    const msg = entry.message as unknown as Record<string, unknown> | undefined;
    if (msg?.['role'] === 'toolResult') return undefined;
    if (msg?.['role'] === 'bashExecution' && typeof msg['command'] === 'string') {
      return truncatePreview(msg['command'], MAX_PREVIEW);
    }

    const content = msg?.['content'];
    if (typeof content === 'string') {
      return truncatePreview(content, MAX_PREVIEW);
    }
    if (Array.isArray(content)) {
      return extractFirstTextBlockPreview(content, MAX_PREVIEW);
    }
    return undefined;
  }

  if (entry.type === 'branch_summary') {
    return truncatePreview(entry.summary, MAX_PREVIEW);
  }

  if (entry.type === 'compaction') {
    return truncatePreview(entry.summary, MAX_PREVIEW);
  }

  if (entry.type === 'custom_message') {
    const content = entry.content;
    if (typeof content === 'string') {
      return truncatePreview(content, MAX_PREVIEW);
    }
    return extractFirstTextBlockPreview(content, MAX_PREVIEW);
  }

  return undefined;
}

function extractFirstTextBlockPreview(
  content: readonly unknown[],
  maxLength: number,
): string | undefined {
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as Record<string, unknown>;
    if (candidate['type'] !== 'text' || typeof candidate['text'] !== 'string') continue;
    const preview = truncatePreview(candidate['text'], maxLength);
    if (preview) return preview;
  }
  return undefined;
}

function advanceToolCallQueues(
  entry: SessionTreeEntry,
  toolCallQueues: ToolCallQueuesById,
): { matchedToolCall?: ToolCallInfo; nextToolCallQueues: ToolCallQueuesById } {
  if (entry.type !== 'message') return { nextToolCallQueues: toolCallQueues };
  if (entry.message.role === 'assistant') {
    return { nextToolCallQueues: enqueueToolCalls(toolCallQueues, entry.message.content) };
  }
  if (entry.message.role !== 'toolResult') return { nextToolCallQueues: toolCallQueues };
  const consumed = consumeToolCall(toolCallQueues, entry.message.toolCallId);
  return {
    matchedToolCall: consumed.toolCall,
    nextToolCallQueues: consumed.nextToolCallQueues,
  };
}

function enqueueToolCalls(
  toolCallQueues: ToolCallQueuesById,
  content: readonly unknown[],
): ToolCallQueuesById {
  let nextQueues: ToolCallQueuesById | undefined;
  for (const block of content) {
    if (!isToolCallBlock(block)) continue;
    nextQueues ??= new Map(toolCallQueues);
    const queue = nextQueues.get(block.id) ?? [];
    nextQueues.set(block.id, [...queue, { name: block.name, arguments: block.arguments }]);
  }
  return nextQueues ?? toolCallQueues;
}

function consumeToolCall(
  toolCallQueues: ToolCallQueuesById,
  toolCallId: string,
): { toolCall?: ToolCallInfo; nextToolCallQueues: ToolCallQueuesById } {
  const queue = toolCallQueues.get(toolCallId);
  if (!queue || queue.length === 0) return { nextToolCallQueues: toolCallQueues };
  const [toolCall, ...remaining] = queue;
  const nextQueues = new Map(toolCallQueues);
  if (remaining.length > 0) {
    nextQueues.set(toolCallId, remaining);
  } else {
    nextQueues.delete(toolCallId);
  }
  return { toolCall, nextToolCallQueues: nextQueues };
}

function isToolCallBlock(block: unknown): block is {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
} {
  if (!block || typeof block !== 'object') return false;
  const candidate = block as Record<string, unknown>;
  return (
    candidate['type'] === 'toolCall' &&
    typeof candidate['id'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    Boolean(candidate['arguments']) &&
    typeof candidate['arguments'] === 'object' &&
    !Array.isArray(candidate['arguments'])
  );
}

function serializeToolArguments(args: Record<string, unknown>): {
  arguments: Record<string, ScoutSessionTreeToolArgument>;
  truncated: boolean;
} {
  const seen = new WeakSet<object>();
  const serialized = serializeToolArgumentValue(args, 0, seen);
  const value =
    serialized.value && typeof serialized.value === 'object' && !Array.isArray(serialized.value)
      ? serialized.value
      : {};
  return {
    arguments: value as Record<string, ScoutSessionTreeToolArgument>,
    truncated: serialized.truncated,
  };
}

function serializeToolArgumentValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): SerializedValue {
  if (value === null) return { value: null, truncated: false };
  if (typeof value === 'string') {
    if (value.length <= MAX_TOOL_ARGUMENT_STRING_LENGTH) {
      return { value, truncated: false };
    }
    return { value: value.slice(0, MAX_TOOL_ARGUMENT_STRING_LENGTH), truncated: true };
  }
  if (typeof value === 'number') {
    return { value: Number.isFinite(value) ? value : null, truncated: !Number.isFinite(value) };
  }
  if (typeof value === 'boolean') return { value, truncated: false };
  if (Array.isArray(value)) {
    if (depth >= MAX_TOOL_ARGUMENT_DEPTH) return { value: [], truncated: value.length > 0 };
    let truncated = value.length > MAX_TOOL_ARGUMENT_ARRAY_ITEMS;
    const items = value.slice(0, MAX_TOOL_ARGUMENT_ARRAY_ITEMS).map((item) => {
      const serialized = serializeToolArgumentValue(item, depth + 1, seen);
      truncated = truncated || serialized.truncated;
      return serialized.value;
    });
    return { value: items, truncated };
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return { value: {}, truncated: true };
    if (depth >= MAX_TOOL_ARGUMENT_DEPTH) return { value: {}, truncated: true };
    seen.add(value);
    let truncated = false;
    const result: Record<string, ScoutSessionTreeToolArgument> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_TOOL_ARGUMENT_OBJECT_KEYS) truncated = true;
    for (const [key, childValue] of entries.slice(0, MAX_TOOL_ARGUMENT_OBJECT_KEYS)) {
      const serialized = serializeToolArgumentValue(childValue, depth + 1, seen);
      result[key] = serialized.value;
      truncated = truncated || serialized.truncated;
    }
    seen.delete(value);
    return { value: result, truncated };
  }
  return { value: null, truncated: value !== undefined };
}

function truncatePreview(text: string, maxLength: number): string | undefined {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}...` : firstLine;
}
