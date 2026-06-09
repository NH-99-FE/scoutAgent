import { describe, expect, it } from 'vitest';
import {
  buildSessionContext,
  SessionManager,
  type BranchSummaryEntry,
  type CompactionEntry,
  type ModelChangeEntry,
  type SessionEntry,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
} from '../../src/core/session/index.ts';
import { assistantMessage, userMessage } from './test-utils.ts';

function messageEntry(
  id: string,
  parentId: string | null,
  message = userMessage(id),
): SessionMessageEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    message,
  };
}

function compactionEntry(
  id: string,
  parentId: string | null,
  summary: string,
  firstKeptEntryId: string,
): CompactionEntry {
  return {
    type: 'compaction',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    summary,
    firstKeptEntryId,
    tokensBefore: 1000,
  };
}

function branchSummaryEntry(
  id: string,
  parentId: string | null,
  summary: string,
  fromId: string,
): BranchSummaryEntry {
  return {
    type: 'branch_summary',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    summary,
    fromId,
  };
}

function thinkingLevelEntry(
  id: string,
  parentId: string | null,
  thinkingLevel: string,
): ThinkingLevelChangeEntry {
  return {
    type: 'thinking_level_change',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    thinkingLevel,
  };
}

function modelChangeEntry(
  id: string,
  parentId: string | null,
  provider: string,
  modelId: string,
): ModelChangeEntry {
  return {
    type: 'model_change',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    provider,
    modelId,
  };
}

describe('buildSessionContext', () => {
  it('builds a linear conversation context', () => {
    const entries: SessionEntry[] = [
      messageEntry('1', null, userMessage('hello')),
      messageEntry('2', '1', assistantMessage('hi')),
      messageEntry('3', '2', userMessage('next')),
    ];

    const context = buildSessionContext(entries);

    expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(context.model).toEqual({ provider: 'anthropic', modelId: 'claude-test' });
  });

  it('tracks model and thinking metadata without adding them to messages', () => {
    const entries: SessionEntry[] = [
      messageEntry('1', null, userMessage('hello')),
      thinkingLevelEntry('2', '1', 'high'),
      modelChangeEntry('3', '2', 'openai', 'gpt-test'),
    ];

    const context = buildSessionContext(entries);

    expect(context.messages).toHaveLength(1);
    expect(context.thinkingLevel).toBe('high');
    expect(context.model).toEqual({ provider: 'openai', modelId: 'gpt-test' });
  });

  it('uses the latest compaction as summary plus kept suffix', () => {
    const entries: SessionEntry[] = [
      messageEntry('1', null, userMessage('first')),
      messageEntry('2', '1', assistantMessage('response one')),
      messageEntry('3', '2', userMessage('second')),
      messageEntry('4', '3', assistantMessage('response two')),
      compactionEntry('5', '4', 'summary one', '3'),
      messageEntry('6', '5', userMessage('third')),
    ];

    const context = buildSessionContext(entries);

    expect(context.messages.map((message) => message.role)).toEqual([
      'compactionSummary',
      'user',
      'assistant',
      'user',
    ]);
    expect(context.messages[0]).toMatchObject({
      role: 'compactionSummary',
      summary: 'summary one',
    });
    expect(context.messages[1]).toMatchObject({ role: 'user', content: 'second' });
  });

  it('follows the requested branch leaf and includes branch summaries on that path', () => {
    const entries: SessionEntry[] = [
      messageEntry('1', null, userMessage('root')),
      messageEntry('2', '1', assistantMessage('base')),
      messageEntry('3', '2', userMessage('old branch')),
      branchSummaryEntry('4', '2', 'old branch summary', '3'),
      messageEntry('5', '4', userMessage('new branch')),
    ];

    const context = buildSessionContext(entries, '5');

    expect(context.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'branchSummary',
      'user',
    ]);
    expect(context.messages[2]).toMatchObject({
      role: 'branchSummary',
      summary: 'old branch summary',
    });
  });
});

describe('SessionManager', () => {
  it('branches from the current tree without mutating existing entries', () => {
    const session = SessionManager.inMemory('/tmp/project');
    const first = session.appendMessage(userMessage('first'));
    const second = session.appendMessage(assistantMessage('second'));
    session.appendMessage(userMessage('third'));

    session.branch(first);
    const branched = session.appendMessage(userMessage('branch'));

    expect(session.getLeafId()).toBe(branched);
    expect(session.getBranch(branched).map((entry) => entry.id)).toEqual([first, branched]);
    expect(session.getEntry(second)).toBeDefined();
  });

  it('stores labels as metadata while exposing labels on visible tree nodes', () => {
    const session = SessionManager.inMemory('/tmp/project');
    const messageId = session.appendMessage(userMessage('bookmark me'));

    const labelId = session.appendLabel(messageId, 'important');

    expect(session.getLeafId()).toBe(labelId);
    expect(session.getLabel(messageId)).toBe('important');
    expect(session.getTree()[0]).toMatchObject({ label: 'important' });
  });

  it('keeps append-only metadata as the raw leaf without adding it to LLM messages', () => {
    const session = SessionManager.inMemory('/tmp/project');
    const userId = session.appendMessage(userMessage('visible prompt'));
    const sessionInfoId = session.appendSessionName('Named session');
    const customId = session.appendCustomEntry('extension-state', { ready: true });
    const labelId = session.appendLabel(userId, 'Pinned prompt');

    expect(session.getLeafId()).toBe(labelId);
    expect(session.getBranch().map((entry) => entry.id)).toEqual([
      userId,
      sessionInfoId,
      customId,
      labelId,
    ]);

    const context = session.buildContext();
    expect(context.messages).toEqual([expect.objectContaining({ role: 'user' })]);
    expect(context.messages[0]).toMatchObject({ content: 'visible prompt' });

    const treeRoot = session.getTree()[0];
    expect(treeRoot).toMatchObject({ label: 'Pinned prompt' });
    expect(treeRoot.children[0].entry).toMatchObject({ type: 'session_info' });
    expect(treeRoot.children[0].children[0].entry).toMatchObject({ type: 'custom' });
    expect(treeRoot.children[0].children[0].children[0].entry).toMatchObject({
      type: 'label',
      targetId: userId,
    });
  });

  it('lets custom messages participate in runtime context while display only controls visibility', () => {
    const session = SessionManager.inMemory('/tmp/project');
    session.appendMessage(userMessage('root'));
    const hiddenId = session.appendCustomMessageEntry('hidden-context', 'hidden context', false);
    const visibleId = session.appendCustomMessageEntry('visible-context', 'visible context', true);

    expect(session.getLeafId()).toBe(visibleId);
    expect(session.getEntry(hiddenId)).toMatchObject({ display: false });
    expect(session.getEntry(visibleId)).toMatchObject({ display: true });

    const context = session.buildContext();
    expect(context.messages.map((message) => message.role)).toEqual(['user', 'custom', 'custom']);
    expect(context.messages[1]).toMatchObject({
      customType: 'hidden-context',
      content: 'hidden context',
      display: false,
    });
    expect(context.messages[2]).toMatchObject({
      customType: 'visible-context',
      content: 'visible context',
      display: true,
    });
  });

  it('builds model context from the current leaf', () => {
    const session = SessionManager.inMemory('/tmp/project');
    const root = session.appendMessage(userMessage('root'));
    session.appendMessage(assistantMessage('main'));
    session.branch(root);
    session.appendMessage(userMessage('branch'));

    const context = session.buildContext();

    expect(context.messages.map((message) => message.role)).toEqual(['user', 'user']);
    expect(context.messages[1]).toMatchObject({ role: 'user', content: 'branch' });
  });
});
