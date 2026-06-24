// ============================================================
// Session message projector — Webview 会话消息协议投影
// 负责：将 core raw session branch 映射为 shared webview 可见消息流。
// ============================================================

import type { ScoutMessage } from '@scout-agent/shared';
import type { ImageContent, TextContent } from '@scout-agent/ai';
import type { AgentMessage } from '@scout-agent/agent';
import {
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from '@scout-agent/agent';
import type {
  CompactionEntry,
  SessionTreeEntry,
} from '../../core/session/index.ts';
import { convertMessage } from './agent-event-mapper.ts';

export function projectSessionBranchToScoutMessages(
  pathEntries: readonly SessionTreeEntry[],
): ScoutMessage[] {
  const messages: ScoutMessage[] = [];
  const latestCompactionIndex = findLatestCompactionIndex(pathEntries);
  const startIndex =
    latestCompactionIndex === -1 ? 0 : findDisplayStartIndex(pathEntries, latestCompactionIndex);

  for (let i = startIndex; i < pathEntries.length; i++) {
    const entry = pathEntries[i]!;
    if (isStaleCompactionEntry(entry, i, latestCompactionIndex)) continue;
    appendProjectedMessage(messages, entry);
  }

  return messages;
}

function findLatestCompactionIndex(pathEntries: readonly SessionTreeEntry[]): number {
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i]?.type === 'compaction') return i;
  }
  return -1;
}

function isStaleCompactionEntry(
  entry: SessionTreeEntry,
  entryIndex: number,
  latestCompactionIndex: number,
): boolean {
  return (
    latestCompactionIndex !== -1 &&
    entryIndex < latestCompactionIndex &&
    entry.type === 'compaction'
  );
}

function findDisplayStartIndex(
  pathEntries: readonly SessionTreeEntry[],
  compactionIndex: number,
): number {
  const compaction = pathEntries[compactionIndex] as CompactionEntry;
  const firstKeptIndex = pathEntries.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  if (firstKeptIndex === -1 || firstKeptIndex > compactionIndex) {
    return compactionIndex;
  }
  return (
    findNextDisplayableEntryIndex(pathEntries, firstKeptIndex, compactionIndex) ??
    findPreviousDisplayableEntryIndex(pathEntries, firstKeptIndex - 1) ??
    compactionIndex
  );
}

function findNextDisplayableEntryIndex(
  pathEntries: readonly SessionTreeEntry[],
  startIndex: number,
  compactionIndex: number,
): number | undefined {
  for (let i = startIndex; i < compactionIndex; i++) {
    const entry = pathEntries[i];
    if (!entry) break;
    if (isDisplayableSessionMessageEntry(entry)) return i;
  }
  return undefined;
}

function findPreviousDisplayableEntryIndex(
  pathEntries: readonly SessionTreeEntry[],
  startIndex: number,
): number | undefined {
  for (let i = startIndex; i >= 0; i--) {
    const entry = pathEntries[i];
    if (!entry || entry.type === 'compaction') break;
    if (isDisplayableSessionMessageEntry(entry)) return i;
  }
  return undefined;
}

function isDisplayableSessionMessageEntry(entry: SessionTreeEntry): boolean {
  if (entry.type === 'message') {
    const role = (entry.message as AgentMessage).role;
    return (
      role === 'user' ||
      role === 'assistant' ||
      role === 'toolResult' ||
      role === 'branchSummary' ||
      role === 'compactionSummary' ||
      role === 'custom'
    );
  }
  return (
    entry.type === 'branch_summary' || (entry.type === 'custom_message' && entry.display)
  );
}

function appendProjectedMessage(messages: ScoutMessage[], entry: SessionTreeEntry): void {
  const agentMessage = createAgentMessageFromEntry(entry);
  if (!agentMessage) return;
  const scoutMessage = convertMessage(agentMessage);
  if (!scoutMessage) return;
  scoutMessage.entryId = entry.id;
  messages.push(scoutMessage);
}

function createAgentMessageFromEntry(entry: SessionTreeEntry): AgentMessage | undefined {
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
