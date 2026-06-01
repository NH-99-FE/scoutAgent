// ============================================================
// ScoutExtensionRunner 测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import type { JsonlSessionMetadata } from '@scout-agent/agent';
import { ScoutExtensionRunner } from '../../extensions/runner.ts';
import { createExtensionRuntime } from '../../extensions/loader.ts';
import type {
  ScoutExtension,
  ScoutExtensionActions,
  ScoutExtensionContextActions,
} from '../../extensions/types.ts';

// ---------- 测试夹具 ----------

function makeMockSessionManager() {
  return {
    prompt: vi.fn(),
    abort: vi.fn(),
    compact: vi.fn(),
  } as any;
}

function makeMockConfigManager() {
  return {
    getApiKey: vi.fn(() => 'test-key'),
    getExtensionPaths: vi.fn(() => []),
  } as any;
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
    getContextUsage: vi.fn(() => undefined),
    newSession: vi.fn(async () => ({ cancelled: false })),
    fork: vi.fn(async () => ({ cancelled: false })),
    switchSession: vi.fn(async () => ({ cancelled: false })),
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
    expect((result[0] as any).content).toBe('second');
  });

  it('returns original messages when no handlers modify', async () => {
    const runner = makeRunner([makeExtension()]);
    runner.bindCore(makeActions(), makeContextActions());

    const original = [{ role: 'user', content: 'hello', timestamp: 0 }] as any[];
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
      preparation: {} as any,
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
      preparation: {} as any,
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
