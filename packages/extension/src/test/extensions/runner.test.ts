// ============================================================
// ScoutExtensionRunner 测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import type {
  AgentMessage,
  CompactionPreparation,
  JsonlSessionMetadata,
  TreePreparation,
} from '@scout-agent/agent';
import { ScoutExtensionRunner } from '../../extensions/runner.ts';
import { createExtensionRuntime } from '../../extensions/loader.ts';
import type {
  BeforeProviderRequestEvent,
  InputEvent,
  MessageEndEvent,
  ScoutExtension,
  ScoutExtensionActions,
  ScoutExtensionContextActions,
  ScoutExtensionContext,
  ToolCallEvent,
  ToolResultEvent,
} from '../../extensions/types.ts';
import type { ConfigManager } from '../../config-manager.ts';
import type { SessionManager } from '../../session-manager.ts';

// ---------- 测试夹具 ----------

function makeMockSessionManager() {
  return {
    prompt: vi.fn(),
    abort: vi.fn(),
    compact: vi.fn(),
  } as unknown as SessionManager;
}

function makeMockConfigManager() {
  return {
    getApiKey: vi.fn(() => 'test-key'),
    getExtensionPaths: vi.fn(() => []),
  } as unknown as ConfigManager;
}

function makeExtension(
  handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {},
): ScoutExtension {
  const handlersMap = new Map<string, ((...args: unknown[]) => Promise<unknown>)[]>();
  for (const [event, handler] of Object.entries(handlers)) {
    handlersMap.set(event, [handler]);
  }
  return {
    path: '<test>',
    resolvedPath: '<test>',
    sourceInfo: {
      path: '<test>',
      source: 'test',
      scope: 'temporary',
      origin: 'top-level',
    },
    handlers: handlersMap,
    tools: new Map(),
    commands: new Map(),
  };
}

function makeExtensionWithTool(toolName: string): ScoutExtension {
  const tool = {
    name: toolName,
    label: `Tool ${toolName}`,
    description: `Description of ${toolName}`,
    parameters: Type.Object({}),
    execute: vi.fn(async () => ({ content: [], details: undefined })),
  };
  return {
    path: `<ext-with-${toolName}>`,
    resolvedPath: `<ext-with-${toolName}>`,
    sourceInfo: {
      path: `<ext-with-${toolName}>`,
      source: 'test',
      scope: 'temporary',
      origin: 'top-level',
    },
    handlers: new Map(),
    tools: new Map([
      [
        toolName,
        {
          definition: tool,
          sourceInfo: {
            path: `<ext-with-${toolName}>`,
            source: 'test',
            scope: 'temporary',
            origin: 'top-level',
          },
        },
      ],
    ]),
    commands: new Map(),
  };
}

function makeActions(): ScoutExtensionActions {
  return {
    sendMessage: vi.fn(async () => {}),
    sendUserMessage: vi.fn(async () => {}),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(async () => {}),
    refreshTools: vi.fn(async () => {}),
    appendEntry: vi.fn(async () => {}),
    setSessionName: vi.fn(async () => {}),
    getSessionName: vi.fn(async () => undefined),
    setLabel: vi.fn(async () => {}),
    getCommands: vi.fn(() => []),
  };
}

function makeContextActions(): ScoutExtensionContextActions {
  return {
    getModel: vi.fn(() => undefined),
    isIdle: vi.fn(() => true),
    abort: vi.fn(),
    getSystemPrompt: vi.fn(() => 'test prompt'),
    hasPendingMessages: vi.fn(() => false),
    getSignal: vi.fn(() => undefined),
    compact: vi.fn(),
    shutdown: vi.fn(),
    setModel: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(async () => {}),
    getContextUsage: vi.fn(async () => undefined),
    newSession: vi.fn(async () => ({ cancelled: false })),
    fork: vi.fn(async () => ({ cancelled: false })),
    switchSession: vi.fn(async () => ({ cancelled: false })),
    waitForIdle: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    navigateTree: vi.fn(async () => ({ cancelled: false })),
  };
}

function makeRunner(extensions: ScoutExtension[]): ScoutExtensionRunner {
  const runtime = createExtensionRuntime();
  const cwd = '/test/cwd';
  const sessionManager = makeMockSessionManager();
  const configManager = makeMockConfigManager();
  return new ScoutExtensionRunner(extensions, runtime, cwd, sessionManager, configManager);
}

// ---------- bindCore ----------

describe('ScoutExtensionRunner.bindCore', () => {
  it('replaces runtime stubs with real actions', () => {
    const runtime = createExtensionRuntime();
    const runner = new ScoutExtensionRunner(
      [],
      runtime,
      '/test',
      makeMockSessionManager(),
      makeMockConfigManager(),
    );
    const actions = makeActions();
    const contextActions = makeContextActions();

    runner.bindCore(actions, contextActions);

    // 不再 throw
    expect(() => runtime.sendMessage('hello')).not.toThrow();
    expect(actions.sendMessage).toHaveBeenCalledWith('hello');
  });

  it('returns action promises from bound runtime methods', async () => {
    const runtime = createExtensionRuntime();
    const runner = new ScoutExtensionRunner(
      [],
      runtime,
      '/test',
      makeMockSessionManager(),
      makeMockConfigManager(),
    );
    const actions = makeActions();
    const contextActions = makeContextActions();
    const error = new Error('send failed');
    vi.mocked(actions.sendMessage).mockRejectedValue(error);

    runner.bindCore(actions, contextActions);

    await expect(runtime.sendMessage('hello')).rejects.toBe(error);
  });
});

// ---------- createContext ----------

describe('ScoutExtensionRunner.createContext', () => {
  it('reflects bindCore context actions', () => {
    const runner = makeRunner([]);
    const signal = new AbortController().signal;
    const contextActions = makeContextActions();
    contextActions.isIdle = vi.fn(() => false);
    contextActions.getSignal = vi.fn(() => signal);
    runner.bindCore(makeActions(), contextActions);

    const ctx = runner.createContext();
    expect(ctx.isIdle()).toBe(false);
    expect(ctx.signal).toBe(signal);
    expect(ctx.cwd).toBe('/test/cwd');
  });

  it('exposes session replacement helpers through context actions', async () => {
    const runner = makeRunner([]);
    const contextActions = makeContextActions();
    runner.bindCore(makeActions(), contextActions);

    const ctx = runner.createContext();
    const metadata = { id: 'target', path: '/sessions/target.jsonl' } as JsonlSessionMetadata;
    const withSession = vi.fn();

    await expect(ctx.newSession({ withSession })).resolves.toEqual({ cancelled: false });
    await expect(ctx.fork('entry-1', { position: 'at', withSession })).resolves.toEqual({
      cancelled: false,
    });
    await expect(ctx.switchSession(metadata, { withSession })).resolves.toEqual({
      cancelled: false,
    });

    expect(contextActions.newSession).toHaveBeenCalledWith({ withSession });
    expect(contextActions.fork).toHaveBeenCalledWith('entry-1', { position: 'at', withSession });
    expect(contextActions.switchSession).toHaveBeenCalledWith(metadata, { withSession });
  });

  it('throws after invalidate', () => {
    const runner = makeRunner([]);
    runner.bindCore(makeActions(), makeContextActions());

    runner.invalidate('gone');
    const ctx = runner.createContext();
    expect(() => ctx.cwd).toThrow('gone');
  });

  it('invalidates captured ctx after session replacement and points to withSession', async () => {
    const runner = makeRunner([]);
    const contextActions = makeContextActions();
    contextActions.newSession = vi.fn(async () => {
      runner.invalidate();
      return { cancelled: false };
    });
    runner.bindCore(makeActions(), contextActions);

    const ctx = runner.createContext();

    await expect(ctx.newSession()).resolves.toEqual({ cancelled: false });

    expect(() => ctx.cwd).toThrow('withSession');
    expect(() => ctx.cwd).toThrow('ctx.newSession()');
    expect(() => ctx.setModel('test-model')).toThrow('withSession');
  });

  it('invalidates captured command ctx after reload', async () => {
    const runner = makeRunner([]);
    const contextActions = makeContextActions();
    contextActions.reload = vi.fn(async () => {
      runner.invalidate();
    });
    runner.bindCore(makeActions(), contextActions);

    const ctx = runner.createCommandContext();

    await expect(ctx.reload()).resolves.toBeUndefined();

    expect(() => ctx.cwd).toThrow('ctx.reload()');
    expect(() => ctx.waitForIdle()).toThrow('await ctx.reload()');
  });

  it('keeps command context getters lazy for stale checks', () => {
    const runner = makeRunner([]);
    runner.bindCore(makeActions(), makeContextActions());

    const ctx = runner.createCommandContext();
    runner.invalidate('gone');

    expect(() => ctx.cwd).toThrow('gone');
    expect(() => ctx.waitForIdle()).toThrow('gone');
  });
});

// ---------- 工具收集 ----------

describe('ScoutExtensionRunner.getAllRegisteredTools', () => {
  it('collects tools from all extensions', () => {
    const ext1 = makeExtensionWithTool('tool-a');
    const ext2 = makeExtensionWithTool('tool-b');
    const runner = makeRunner([ext1, ext2]);

    const tools = runner.getAllRegisteredTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.definition.name)).toContain('tool-a');
    expect(tools.map((t) => t.definition.name)).toContain('tool-b');
  });

  it('first registration wins for same name', () => {
    const ext1 = makeExtensionWithTool('shared-tool');
    const ext2 = makeExtensionWithTool('shared-tool');
    const runner = makeRunner([ext1, ext2]);

    const tools = runner.getAllRegisteredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.sourceInfo.path).toBe('<ext-with-shared-tool>');
  });
});

// ---------- 命令收集 ----------

describe('ScoutExtensionRunner commands', () => {
  it('collects registered commands and assigns Pi-style invocation names', () => {
    const ext1 = makeExtension();
    const ext2 = makeExtension();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    ext1.commands.set('hello', {
      name: 'hello',
      description: 'first',
      sourceInfo: ext1.sourceInfo,
      handler: handlerA,
    });
    ext2.commands.set('hello', {
      name: 'hello',
      description: 'second',
      sourceInfo: ext2.sourceInfo,
      handler: handlerB,
    });
    ext2.commands.set('other', {
      name: 'other',
      sourceInfo: ext2.sourceInfo,
      handler: handlerB,
    });
    const runner = makeRunner([ext1, ext2]);

    expect(runner.getRegisteredCommands().map((command) => command.invocationName)).toEqual([
      'hello:1',
      'hello:2',
      'other',
    ]);
    expect(runner.getCommand('hello')).toBeUndefined();
    expect(runner.getCommand('hello:1')?.description).toBe('first');
    expect(runner.getCommand('hello:2')?.description).toBe('second');
    expect(runner.getCommandDiagnostics()).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        message: 'command "/hello" collision',
        path: '<test>',
        collision: expect.objectContaining({
          resourceType: 'extension',
          name: 'hello',
          winnerPath: '<test>',
          loserPath: '<test>',
        }),
      }),
    );
  });

  it('preserves command argument completion handlers', async () => {
    const ext = makeExtension();
    const getArgumentCompletions = vi.fn(async (prefix: string) => [
      { value: `${prefix}-one`, label: 'One' },
    ]);
    ext.commands.set('complete', {
      name: 'complete',
      description: 'Complete arguments',
      sourceInfo: ext.sourceInfo,
      getArgumentCompletions,
      handler: vi.fn(),
    });
    const runner = makeRunner([ext]);

    const command = runner.getCommand('complete');

    await expect(command?.getArgumentCompletions?.('arg')).resolves.toEqual([
      { value: 'arg-one', label: 'One' },
    ]);
    expect(getArgumentCompletions).toHaveBeenCalledWith('arg');
  });

  it('creates command context with wait and tree navigation helpers', async () => {
    const runner = makeRunner([]);
    const contextActions = makeContextActions();
    runner.bindCore(makeActions(), contextActions);

    const ctx = runner.createCommandContext();
    await ctx.waitForIdle();
    await ctx.reload();
    await expect(ctx.navigateTree('entry-1')).resolves.toEqual({ cancelled: false });

    expect(contextActions.waitForIdle).toHaveBeenCalled();
    expect(contextActions.reload).toHaveBeenCalled();
    expect(contextActions.navigateTree).toHaveBeenCalledWith('entry-1', undefined);
  });
});

// ---------- 事件分发 ----------

describe('ScoutExtensionRunner.emitBeforeAgentStart', () => {
  it('collects messages and last systemPrompt', async () => {
    const ext1 = makeExtension({
      before_agent_start: async () => ({
        message: { role: 'user', content: 'extra', timestamp: 0 },
      }),
    });
    const ext2 = makeExtension({
      before_agent_start: async () => ({ systemPrompt: 'modified prompt' }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitBeforeAgentStart({
      type: 'before_agent_start',
      prompt: 'test',
      systemPrompt: 'original',
    });

    expect(result?.messages).toHaveLength(1);
    expect(result?.systemPrompt).toBe('modified prompt');
  });

  it('returns undefined when no handlers modify anything', async () => {
    const runner = makeRunner([makeExtension()]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitBeforeAgentStart({
      type: 'before_agent_start',
      prompt: 'test',
      systemPrompt: 'original',
    });

    expect(result).toBeUndefined();
  });

  it('isolates handler errors', async () => {
    const errorListener = vi.fn();
    const ext1 = makeExtension({
      before_agent_start: async () => {
        throw new Error('handler boom');
      },
    });
    const ext2 = makeExtension({
      before_agent_start: async () => ({ systemPrompt: 'still works' }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());
    runner.onError(errorListener);

    const result = await runner.emitBeforeAgentStart({
      type: 'before_agent_start',
      prompt: 'test',
      systemPrompt: 'original',
    });

    expect(result?.systemPrompt).toBe('still works');
    expect(errorListener).toHaveBeenCalled();
  });

  it('chains ctx.getSystemPrompt through handler modifications', async () => {
    const seen: string[] = [];
    const ext1 = makeExtension({
      before_agent_start: async (_event: unknown, ctx: unknown) => {
        const extensionContext = ctx as ScoutExtensionContext;
        seen.push(extensionContext.getSystemPrompt());
        return { systemPrompt: 'first' };
      },
    });
    const ext2 = makeExtension({
      before_agent_start: async (_event: unknown, ctx: unknown) => {
        const extensionContext = ctx as ScoutExtensionContext;
        seen.push(extensionContext.getSystemPrompt());
        return { systemPrompt: 'second' };
      },
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitBeforeAgentStart({
      type: 'before_agent_start',
      prompt: 'test',
      systemPrompt: 'original',
    });

    expect(seen).toEqual(['original', 'first']);
    expect(result?.systemPrompt).toBe('second');
  });
});

describe('ScoutExtensionRunner.emitContext', () => {
  it('last returned messages win', async () => {
    const ext1 = makeExtension({
      context: async () => ({ messages: [{ role: 'user', content: 'first', timestamp: 0 }] }),
    });
    const ext2 = makeExtension({
      context: async () => ({ messages: [{ role: 'user', content: 'second', timestamp: 0 }] }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitContext([]);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<AgentMessage, { role: 'user' }>).content).toBe('second');
  });

  it('returns original messages when no handlers modify', async () => {
    const runner = makeRunner([makeExtension()]);
    runner.bindCore(makeActions(), makeContextActions());

    const original: AgentMessage[] = [{ role: 'user', content: 'hello', timestamp: 0 }];
    const result = await runner.emitContext(original);
    expect(result).toEqual(original);
  });
});

describe('ScoutExtensionRunner.emitToolCall', () => {
  it('returns first block=true result', async () => {
    const ext1 = makeExtension({
      tool_call: async () => ({ block: true, reason: 'not allowed' }),
    });
    const ext2 = makeExtension({
      tool_call: async () => ({ block: false }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: {},
    });

    expect(result?.block).toBe(true);
  });

  it('returns undefined when no handlers block', async () => {
    const runner = makeRunner([makeExtension()]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: {},
    });

    expect(result).toBeUndefined();
  });

  it('lets argument mutations remain visible to later handlers', async () => {
    const ext1 = makeExtension({
      tool_call: async (event: unknown) => {
        const toolCall = event as ToolCallEvent;
        toolCall.input.command = 'echo patched';
      },
    });
    const ext2 = makeExtension({
      tool_call: async (event: unknown) => {
        const toolCall = event as ToolCallEvent;
        return { block: toolCall.input.command === 'echo patched' };
      },
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: { command: 'echo original' },
    });

    expect(result?.block).toBe(true);
  });

  it('propagates handler errors so tool execution is blocked by the caller', async () => {
    const ext = makeExtension({
      tool_call: async () => {
        throw new Error('permission hook failed');
      },
    });
    const runner = makeRunner([ext]);
    runner.bindCore(makeActions(), makeContextActions());

    await expect(
      runner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'tc-1',
        toolName: 'bash',
        input: {},
      }),
    ).rejects.toThrow('permission hook failed');
  });
});

describe('ScoutExtensionRunner.emitToolResult', () => {
  it('patches merge sequentially', async () => {
    const ext1 = makeExtension({
      tool_result: async () => ({ isError: true }),
    });
    const ext2 = makeExtension({
      tool_result: async () => ({ details: { extra: true } }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitToolResult({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: {},
      content: [{ type: 'text', text: 'output' }],
      details: undefined,
      isError: false,
    });

    expect(result?.isError).toBe(true);
    expect(result?.details).toEqual({ extra: true });
  });

  it('passes prior result patches to later handlers', async () => {
    const ext1 = makeExtension({
      tool_result: async () => ({ content: [{ type: 'text', text: 'patched' }], isError: true }),
    });
    const ext2 = makeExtension({
      tool_result: async (event: unknown) => {
        const toolResult = event as ToolResultEvent;
        const firstContent = toolResult.content[0] as Extract<
          ToolResultEvent['content'][number],
          { type: 'text' }
        >;
        return {
          details: {
            sawContent: firstContent.text,
            sawIsError: toolResult.isError,
          },
        };
      },
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitToolResult({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: {},
      content: [{ type: 'text', text: 'original' }],
      details: undefined,
      isError: false,
    });

    expect(result?.details).toEqual({ sawContent: 'patched', sawIsError: true });
  });

  it('returns undefined when no handlers modify', async () => {
    const runner = makeRunner([makeExtension()]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitToolResult({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: {},
      content: [{ type: 'text', text: 'output' }],
      details: undefined,
      isError: false,
    });

    expect(result).toBeUndefined();
  });
});

describe('ScoutExtensionRunner.emitBeforeProviderRequest', () => {
  it('chains payload transformations', async () => {
    const ext1 = makeExtension({
      before_provider_request: async (event: unknown) => ({
        ...((event as BeforeProviderRequestEvent).payload as Record<string, unknown>),
        first: true,
      }),
    });
    const ext2 = makeExtension({
      before_provider_request: async (event: unknown) => ({
        ...((event as BeforeProviderRequestEvent).payload as Record<string, unknown>),
        second: true,
      }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitBeforeProviderRequest({ original: true });

    expect(result).toEqual({ original: true, first: true, second: true });
  });
});

describe('ScoutExtensionRunner.emitInput', () => {
  it('chains transform results', async () => {
    const ext1 = makeExtension({
      input: async (event: unknown) => ({
        action: 'transform',
        text: `${(event as InputEvent).text} one`,
      }),
    });
    const ext2 = makeExtension({
      input: async (event: unknown) => ({
        action: 'transform',
        text: `${(event as InputEvent).text} two`,
      }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitInput('start', undefined, 'interactive');

    expect(result).toEqual({ action: 'transform', text: 'start one two', images: undefined });
  });

  it('short-circuits on handled', async () => {
    const second = vi.fn();
    const ext1 = makeExtension({
      input: async () => ({ action: 'handled' }),
    });
    const ext2 = makeExtension({
      input: second,
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitInput('start', undefined, 'interactive');

    expect(result).toEqual({ action: 'handled' });
    expect(second).not.toHaveBeenCalled();
  });
});

describe('ScoutExtensionRunner.emitMessageEnd', () => {
  it('chains same-role message replacements', async () => {
    const ext1 = makeExtension({
      message_end: async (event: unknown) => {
        const messageEnd = event as MessageEndEvent;
        return { message: { ...messageEnd.message, content: 'first' } };
      },
    });
    const ext2 = makeExtension({
      message_end: async (event: unknown) => {
        const messageEnd = event as MessageEndEvent;
        const message = messageEnd.message as Extract<AgentMessage, { role: 'assistant' }>;
        return { message: { ...message, content: `${message.content} second` } };
      },
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitMessageEnd({
      type: 'message_end',
      message: { role: 'assistant', content: 'original', timestamp: 0 } as unknown as AgentMessage,
    });

    expect((result as Extract<AgentMessage, { role: 'assistant' }>).content).toBe('first second');
  });

  it('rejects replacements with a different role and emits an error', async () => {
    const errorListener = vi.fn();
    const ext = makeExtension({
      message_end: async () => ({
        message: { role: 'user', content: 'wrong', timestamp: 0 },
      }),
    });
    const runner = makeRunner([ext]);
    runner.bindCore(makeActions(), makeContextActions());
    runner.onError(errorListener);

    const result = await runner.emitMessageEnd({
      type: 'message_end',
      message: { role: 'assistant', content: 'original', timestamp: 0 } as unknown as AgentMessage,
    });

    expect(result).toBeUndefined();
    expect(errorListener).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'message_end',
        error: 'message_end handlers must return a message with the same role',
      }),
    );
  });
});

describe('ScoutExtensionRunner.emitResourcesDiscover', () => {
  it('aggregates paths with extension sources', async () => {
    const ext1 = makeExtension({
      resources_discover: async () => ({ skillPaths: ['skills-a'], promptPaths: ['prompts-a'] }),
    });
    ext1.path = '/ext/a.ts';
    const ext2 = makeExtension({
      resources_discover: async () => ({ skillPaths: ['skills-b'], themePaths: ['themes-b'] }),
    });
    ext2.path = '/ext/b.ts';
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitResourcesDiscover('/cwd', 'startup');

    expect(result.skillPaths).toEqual([
      { path: 'skills-a', extensionPath: '/ext/a.ts' },
      { path: 'skills-b', extensionPath: '/ext/b.ts' },
    ]);
    expect(result.promptPaths).toEqual([{ path: 'prompts-a', extensionPath: '/ext/a.ts' }]);
    expect(result.themePaths).toEqual([{ path: 'themes-b', extensionPath: '/ext/b.ts' }]);
  });
});

describe('ScoutExtensionRunner.emitSessionBeforeCompact', () => {
  it('short-circuits on cancel=true', async () => {
    const ext1 = makeExtension({
      session_before_compact: async () => ({ cancel: true }),
    });
    const ext2 = makeExtension({
      session_before_compact: async () => ({ cancel: false }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitSessionBeforeCompact({
      type: 'session_before_compact',
      preparation: {} as unknown as CompactionPreparation,
      branchEntries: [],
      signal: new AbortController().signal,
    });

    expect(result?.cancel).toBe(true);
  });
});

describe('ScoutExtensionRunner session before hooks', () => {
  it('short-circuits session_before_tree on cancel=true', async () => {
    const ext1 = makeExtension({
      session_before_tree: async () => ({ cancel: true }),
    });
    const ext2 = makeExtension({
      session_before_tree: async () => ({ cancel: false }),
    });
    const runner = makeRunner([ext1, ext2]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitSessionBeforeTree({
      type: 'session_before_tree',
      preparation: {} as unknown as TreePreparation,
      signal: new AbortController().signal,
    });

    expect(result?.cancel).toBe(true);
  });

  it('short-circuits session_before_fork on cancel=true', async () => {
    const ext = makeExtension({
      session_before_fork: async () => ({ cancel: true }),
    });
    const runner = makeRunner([ext]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitSessionBeforeFork({
      type: 'session_before_fork',
      entryId: 'entry-1',
      position: 'at',
    });

    expect(result?.cancel).toBe(true);
  });

  it('short-circuits session_before_switch on cancel=true', async () => {
    const ext = makeExtension({
      session_before_switch: async () => ({ cancel: true }),
    });
    const runner = makeRunner([ext]);
    runner.bindCore(makeActions(), makeContextActions());

    const result = await runner.emitSessionBeforeSwitch({
      type: 'session_before_switch',
      reason: 'resume',
      targetSessionFile: '/sessions/target.jsonl',
    });

    expect(result?.cancel).toBe(true);
  });
});

// ---------- hasHandlers ----------

describe('ScoutExtensionRunner.hasHandlers', () => {
  it('returns true when extension has handler for event', () => {
    const ext = makeExtension({ tool_call: async () => undefined });
    const runner = makeRunner([ext]);

    expect(runner.hasHandlers('tool_call')).toBe(true);
    expect(runner.hasHandlers('context')).toBe(false);
  });

  it('returns false for empty extensions', () => {
    const runner = makeRunner([]);
    expect(runner.hasHandlers('any')).toBe(false);
  });
});

// ---------- error handling ----------

describe('ScoutExtensionRunner.onError', () => {
  it('notifies error listeners', () => {
    const runner = makeRunner([]);
    const listener = vi.fn();
    const unsub = runner.onError(listener);

    runner.emitError({
      extensionPath: '<ext>',
      event: 'tool_call',
      error: 'boom',
    });

    expect(listener).toHaveBeenCalledWith({
      extensionPath: '<ext>',
      event: 'tool_call',
      error: 'boom',
    });

    unsub();
    runner.emitError({
      extensionPath: '<ext>',
      event: 'tool_result',
      error: 'after unsub',
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
