// ============================================================
// Harness Branch Summarization 会话树摘要测试
// ============================================================

import {
  createAssistantMessageEventStream,
  registerApiProvider,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StreamFunction,
  unregisterApiProviders,
} from '@scout-agent/ai';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentHarness } from '../../src/harness/agent-harness.ts';
import {
  collectEntriesForBranchSummary,
  generateBranchSummary,
  prepareBranchEntries,
} from '../../src/harness/compaction/branch-summarization.ts';
import { NodeExecutionEnv } from '../../src/harness/env/nodejs.ts';
import { InMemorySessionStorage } from '../../src/harness/session/memory-storage.ts';
import { Session } from '../../src/harness/session/session.ts';
import type {
  BranchSummaryEntry,
  CompactionEntry,
  LabelEntry,
  MessageEntry,
} from '../../src/harness/types.ts';
import { getOrThrow } from '../../src/harness/types.ts';
import type { AgentMessage } from '../../src/types.ts';
import { createAssistantMessage, createUserMessage } from './session-test-utils.ts';

const SOURCE_ID = 'branch-summarization-test';

type TestApi = 'test-branch-summary-api';
type ResponseFactory = (
  context: Context,
  options: SimpleStreamOptions | undefined,
  model: Model<TestApi>,
) => AssistantMessage | Promise<AssistantMessage>;

let nextId = 0;

function createId(): string {
  return `entry-${nextId++}`;
}

function createModel(): Model<TestApi> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'test-branch-summary-api',
    provider: 'test-provider',
    baseUrl: 'https://example.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 4096,
  };
}

function createSummaryMessage(
  text: string,
  overrides?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test-branch-summary-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
    ...overrides,
  };
}

function registerResponses(responses: ResponseFactory[]): void {
  const streamSimple: StreamFunction<TestApi, SimpleStreamOptions> = (model, context, options) => {
    const response = responses.shift();
    if (!response) throw new Error('No test response queued');
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      const message = await response(context, options, model);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        stream.push({ type: 'error', reason: message.stopReason, error: message });
        return;
      }
      stream.push({ type: 'done', reason: message.stopReason, message });
    });
    return stream;
  };

  registerApiProvider(
    {
      api: 'test-branch-summary-api',
      stream: streamSimple,
      streamSimple,
    },
    SOURCE_ID,
  );
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createMessageEntry(message: AgentMessage, parentId: string | null = null): MessageEntry {
  return {
    type: 'message',
    id: createId(),
    parentId,
    timestamp: new Date().toISOString(),
    message,
  };
}

function createBranchSummaryEntry(parentId: string | null = null): BranchSummaryEntry {
  return {
    type: 'branch_summary',
    id: createId(),
    parentId,
    timestamp: new Date().toISOString(),
    fromId: 'branch',
    summary: 'prior branch summary',
    details: { readFiles: ['old-read.ts'], modifiedFiles: ['old-edit.ts'] },
  };
}

function createCompactionEntry(parentId: string | null = null): CompactionEntry {
  return {
    type: 'compaction',
    id: createId(),
    parentId,
    timestamp: new Date().toISOString(),
    summary: 'prior compact summary',
    firstKeptEntryId: 'kept',
    tokensBefore: 1000,
  };
}

afterEach(() => {
  nextId = 0;
  unregisterApiProviders(SOURCE_ID);
});

describe('branch summarization', () => {
  it('collects abandoned branch entries and reports the common ancestor', async () => {
    const session = new Session(new InMemorySessionStorage());
    const rootUser = await session.appendMessage(createUserMessage('root'));
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    const abandonedUser = await session.appendMessage(createUserMessage('abandoned'));
    const abandonedAssistant = await session.appendMessage(
      createAssistantMessage('abandoned answer'),
    );
    await session.moveTo(rootAssistant);
    const targetUser = await session.appendMessage(createUserMessage('target'));

    const result = await collectEntriesForBranchSummary(session, abandonedAssistant, targetUser);

    expect(result.commonAncestorId).toBe(rootAssistant);
    expect(result.entries.map((entry) => entry.id)).toEqual([abandonedUser, abandonedAssistant]);
    expect((await session.getBranch()).map((entry) => entry.id)).toContain(rootUser);
  });

  it('prepares branch entries without tool results and carries file-operation details', () => {
    const branchSummary = createBranchSummaryEntry();
    const toolAssistantMessage: AssistantMessage = {
      ...(createAssistantMessage('tool call') as AssistantMessage),
      content: [
        { type: 'toolCall', id: 'tool-1', name: 'write', arguments: { path: 'new-file.ts' } },
      ],
    };
    const toolAssistant = createMessageEntry(toolAssistantMessage, branchSummary.id);
    const toolResult = createMessageEntry(
      {
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'write',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
        timestamp: Date.now(),
      },
      toolAssistant.id,
    );
    const compaction = createCompactionEntry(toolResult.id);

    const preparation = prepareBranchEntries([
      branchSummary,
      toolAssistant,
      toolResult,
      compaction,
    ]);

    expect(preparation.messages.map((message) => message.role)).toEqual([
      'branchSummary',
      'assistant',
      'compactionSummary',
    ]);
    expect([...preparation.fileOps.read]).toContain('old-read.ts');
    expect([...preparation.fileOps.edited]).toContain('old-edit.ts');
    expect([...preparation.fileOps.written]).toContain('new-file.ts');
  });

  it('generates branch summaries with custom instructions and file details', async () => {
    let promptText = '';
    let capturedOptions: SimpleStreamOptions | undefined;
    registerResponses([
      (context, options) => {
        const message = context.messages[0];
        const content = message?.role === 'user' ? message.content : [];
        promptText = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : '';
        capturedOptions = options;
        return createSummaryMessage('## Goal\nBranch summary');
      },
    ]);
    const assistantWithReadMessage: AssistantMessage = {
      ...(createAssistantMessage('reading') as AssistantMessage),
      content: [
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'src/index.ts' } },
      ],
    };
    const assistantWithRead = createMessageEntry(assistantWithReadMessage);

    const result = getOrThrow(
      await generateBranchSummary([assistantWithRead], {
        model: createModel(),
        apiKey: 'test-key',
        headers: { 'x-test': 'yes' },
        signal: new AbortController().signal,
        customInstructions: 'focus on branch decisions',
      }),
    );

    expect(result.summary).toContain('The user explored a different conversation branch');
    expect(result.summary).toContain('## Goal\nBranch summary');
    expect(result.readFiles).toContain('src/index.ts');
    expect(result.modifiedFiles).toEqual([]);
    expect(promptText).toContain('Additional focus: focus on branch decisions');
    expect(capturedOptions).toMatchObject({
      apiKey: 'test-key',
      headers: { 'x-test': 'yes' },
      maxTokens: 2048,
    });
  });

  it('returns branch summary error results without throwing', async () => {
    const entry = createMessageEntry(createUserMessage('summarize this'));
    registerResponses([
      () => createSummaryMessage('', { stopReason: 'error', errorMessage: 'boom' }),
    ]);

    const errorResult = await generateBranchSummary([entry], {
      model: createModel(),
      apiKey: 'test-key',
      signal: new AbortController().signal,
    });

    expect(errorResult).toMatchObject({
      ok: false,
      error: { code: 'summarization_failed', message: 'Branch summary failed: boom' },
    });

    registerResponses([
      () => createSummaryMessage('', { stopReason: 'aborted', errorMessage: 'stopped' }),
    ]);
    const abortedResult = await generateBranchSummary([entry], {
      model: createModel(),
      apiKey: 'test-key',
      signal: new AbortController().signal,
    });

    expect(abortedResult).toMatchObject({
      ok: false,
      error: { code: 'aborted', message: 'stopped' },
    });
  });

  it('navigates with a hook-provided summary and emits session_tree', async () => {
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    const oldLeaf = await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });
    const events: Array<{ fromHook?: boolean; summary?: string; oldLeafId: string | null }> = [];
    harness.on('session_before_tree', (event) => {
      expect(event.preparation.oldLeafId).toBe(oldLeaf);
      expect(event.preparation.entriesToSummarize.map((entry) => entry.id)).toHaveLength(2);
      return {
        summary: {
          summary: 'summary from hook',
          details: { source: 'hook' },
        },
      };
    });
    harness.subscribe((event) => {
      if (event.type === 'session_tree') {
        events.push({
          fromHook: event.fromHook,
          summary: event.summaryEntry?.summary,
          oldLeafId: event.oldLeafId,
        });
      }
    });

    const result = await harness.navigateTree(rootAssistant, { summarize: true });

    expect(result.cancelled).toBe(false);
    expect(result.summaryEntry).toMatchObject({
      type: 'branch_summary',
      parentId: rootAssistant,
      fromHook: true,
      summary: 'summary from hook',
      details: { source: 'hook' },
    });
    expect(events).toEqual([{ fromHook: true, summary: 'summary from hook', oldLeafId: oldLeaf }]);
    expect((await session.buildContext()).messages.map((message) => message.role)).toEqual([
      'assistant',
      'branchSummary',
    ]);
  });

  it('navigates with a generated summary when requested', async () => {
    registerResponses([() => createSummaryMessage('## Goal\nGenerated branch')]);
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
      getApiKeyAndHeaders: async () => ({ apiKey: 'test-key', headers: { 'x-auth': 'yes' } }),
    });

    const result = await harness.navigateTree(rootAssistant, { summarize: true });

    expect(result.cancelled).toBe(false);
    expect(result.summaryEntry).toMatchObject({
      type: 'branch_summary',
      parentId: rootAssistant,
      fromHook: false,
    });
    expect(result.summaryEntry?.summary).toContain('Generated branch');
    expect(result.summaryEntry?.details).toEqual({ readFiles: [], modifiedFiles: [] });
  });

  it('labels the summary entry when navigating with a summary label', async () => {
    registerResponses([() => createSummaryMessage('## Goal\nGenerated branch')]);
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
      getApiKeyAndHeaders: async () => ({ apiKey: 'test-key' }),
    });
    const leafEvents: Array<string | null> = [];
    harness.subscribe((event) => {
      if (event.type === 'session_tree') leafEvents.push(event.newLeafId);
    });

    const result = await harness.navigateTree(rootAssistant, {
      summarize: true,
      label: 'checkpoint',
    });

    expect(result.summaryEntry?.id).toBeDefined();
    expect(await session.getLabel(result.summaryEntry!.id)).toBe('checkpoint');
    expect(await session.getLabel(rootAssistant)).toBeUndefined();
    const labelEntry = (await session.getEntries()).find(
      (entry): entry is LabelEntry =>
        entry.type === 'label' && entry.targetId === result.summaryEntry!.id,
    );
    expect(labelEntry).toBeDefined();
    expect(await session.getLeafId()).toBe(labelEntry!.id);
    expect(leafEvents).toEqual([labelEntry!.id]);
  });

  it('labels the target entry when navigating without a summary', async () => {
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });
    const leafEvents: Array<string | null> = [];
    harness.subscribe((event) => {
      if (event.type === 'session_tree') leafEvents.push(event.newLeafId);
    });

    const result = await harness.navigateTree(rootAssistant, { label: 'checkpoint' });

    expect(result.summaryEntry).toBeUndefined();
    expect(await session.getLabel(rootAssistant)).toBe('checkpoint');
    const labelEntry = (await session.getEntries()).find(
      (entry): entry is LabelEntry => entry.type === 'label' && entry.targetId === rootAssistant,
    );
    expect(labelEntry).toBeDefined();
    expect(await session.getLeafId()).toBe(labelEntry!.id);
    expect(leafEvents).toEqual([labelEntry!.id]);
  });

  it('lets session_before_tree override the navigation label', async () => {
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });
    harness.on('session_before_tree', () => ({ label: 'from hook' }));

    await harness.navigateTree(rootAssistant, { label: 'from option' });

    expect(await session.getLabel(rootAssistant)).toBe('from hook');
  });

  it('does not move the leaf when aborted after branch summary generation', async () => {
    const abortController = new AbortController();
    registerResponses([
      () => {
        queueMicrotask(() => abortController.abort());
        return createSummaryMessage('## Goal\nGenerated branch');
      },
    ]);
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    const oldLeaf = await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
      getApiKeyAndHeaders: async () => ({ apiKey: 'test-key' }),
    });
    const events: string[] = [];
    harness.subscribe((event) => {
      if (event.type === 'session_tree') events.push(event.type);
    });

    const result = await harness.navigateTree(rootAssistant, {
      summarize: true,
      signal: abortController.signal,
    });

    expect(result).toEqual({ cancelled: true });
    expect(await session.getLeafId()).toBe(oldLeaf);
    expect(events).toEqual([]);
    expect((await session.getEntries()).some((entry) => entry.type === 'branch_summary')).toBe(
      false,
    );
  });

  it('treats navigation as committed once moveTo succeeds', async () => {
    const abortController = new AbortController();
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    await session.appendMessage(createAssistantMessage('abandoned answer'));
    const originalMoveTo = session.moveTo.bind(session);
    session.moveTo = (async (...args: Parameters<typeof session.moveTo>) => {
      const result = await originalMoveTo(...args);
      abortController.abort();
      return result;
    }) as typeof session.moveTo;
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });
    const events: string[] = [];
    harness.subscribe((event) => {
      if (event.type === 'session_tree') events.push(event.type);
    });

    const result = await harness.navigateTree(rootAssistant, {
      signal: abortController.signal,
    });

    expect(result).toEqual({ cancelled: false, editorText: undefined, summaryEntry: undefined });
    expect(await session.getLeafId()).toBe(rootAssistant);
    expect(events).toEqual(['session_tree']);
  });

  it('cancels navigation from session_before_tree without moving the leaf', async () => {
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    const oldLeaf = await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });
    const events: string[] = [];
    harness.on('session_before_tree', () => ({ cancel: true }));
    harness.subscribe((event) => {
      if (event.type === 'session_tree') events.push(event.type);
    });

    const result = await harness.navigateTree(rootAssistant, { summarize: true });

    expect(result).toEqual({ cancelled: true });
    expect(await session.getLeafId()).toBe(oldLeaf);
    expect(events).toEqual([]);
  });

  it('aborts in-flight navigation through the harness operation signal', async () => {
    const session = new Session(new InMemorySessionStorage());
    const rootAssistant = await session.appendMessage(createAssistantMessage('root answer'));
    await session.appendMessage(createUserMessage('abandoned'));
    const oldLeaf = await session.appendMessage(createAssistantMessage('abandoned answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });
    const enteredHook = createDeferred();
    const releaseHook = createDeferred();
    const events: string[] = [];
    let hookSignal: AbortSignal | undefined;
    harness.on('session_before_tree', async (event) => {
      hookSignal = event.signal;
      enteredHook.resolve();
      await releaseHook.promise;
      return {};
    });
    harness.subscribe((event) => {
      if (event.type === 'session_tree') events.push(event.type);
    });

    const navigatePromise = harness.navigateTree(rootAssistant, { summarize: true });
    await enteredHook.promise;

    expect(harness.getSignal()).toBe(hookSignal);

    const abortPromise = harness.abort();
    expect(hookSignal?.aborted).toBe(true);
    releaseHook.resolve();

    await expect(navigatePromise).resolves.toEqual({ cancelled: true });
    await abortPromise;
    expect(await session.getLeafId()).toBe(oldLeaf);
    expect(events).toEqual([]);
    expect(harness.getSignal()).toBeUndefined();
  });

  it('returns editor text when navigating to a user message', async () => {
    const session = new Session(new InMemorySessionStorage());
    const userId = await session.appendMessage(createUserMessage('draft text'));
    const assistantId = await session.appendMessage(createAssistantMessage('answer'));
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: createModel(),
    });

    const result = await harness.navigateTree(userId);

    expect(result).toEqual({ cancelled: false, editorText: 'draft text', summaryEntry: undefined });
    expect(await session.getLeafId()).toBeNull();
    expect((await session.getEntries()).some((entry) => entry.id === assistantId)).toBe(true);
  });
});
