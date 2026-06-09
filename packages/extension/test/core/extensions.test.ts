import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Type } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../../src/core/session/index.ts';
import {
  createExtensionRuntime,
  discoverAndLoadExtensions,
  loadExtensionFromFactory,
  ScoutExtensionRunner,
  type ScoutExtension,
} from '../../src/core/extensions/index.ts';
import {
  createConfigManager,
  createExtensionActions,
  createExtensionContextActions,
  userMessage,
} from './test-utils.ts';

describe('extension loading', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-extension-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'extensions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers project and user extensions with project precedence', async () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'project.ts'),
      `export default function(scout) {
        scout.registerCommand("project", { description: "project", handler: async () => {} });
      }`,
    );
    fs.writeFileSync(
      path.join(agentDir, 'extensions', 'user.ts'),
      `export default function(scout) {
        scout.registerCommand("user", { description: "user", handler: async () => {} });
      }`,
    );

    const result = await discoverAndLoadExtensions([], cwd, agentDir);

    expect(result.errors).toEqual([]);
    expect(result.extensions.map((extension) => extension.path)).toEqual([
      path.join(cwd, '.scout', 'extensions', 'project.ts'),
      path.join(agentDir, 'extensions', 'user.ts'),
    ]);
  });

  it('captures load failures without aborting other extensions', async () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'ok.ts'),
      `export default function(scout) {
        scout.registerCommand("ok", { description: "ok", handler: async () => {} });
      }`,
    );
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'bad.ts'),
      `export default function() { throw new Error("boom"); }`,
    );

    const result = await discoverAndLoadExtensions([], cwd, agentDir);

    expect(result.extensions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('boom');
  });
});

describe('ScoutExtensionRunner', () => {
  function createRunner(extensions: ScoutExtension[], cwd = '/tmp/project'): ScoutExtensionRunner {
    const runtime = createExtensionRuntime();
    const runner = new ScoutExtensionRunner(
      extensions,
      runtime,
      cwd,
      SessionManager.inMemory(cwd),
      createConfigManager(cwd),
    );
    runner.bindCore(createExtensionActions(), createExtensionContextActions());
    return runner;
  }

  it('combines before_agent_start messages in registration order', async () => {
    const runtime = createExtensionRuntime();
    const first = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('before_agent_start', async () => ({ message: userMessage('first') }));
      },
      runtime,
      undefined,
      '<first>',
    );
    const second = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('before_agent_start', async () => ({
          message: userMessage('second'),
          systemPrompt: 'changed',
        }));
      },
      runtime,
      undefined,
      '<second>',
    );
    const runner = createRunner([first, second]);

    const result = await runner.emitBeforeAgentStart({
      type: 'before_agent_start',
      prompt: 'prompt',
      systemPrompt: 'base',
    });

    expect(result?.messages?.map((message) => (message as any).content)).toEqual([
      'first',
      'second',
    ]);
    expect(result?.systemPrompt).toBe('changed');
  });

  it('lets context handlers transform messages sequentially', async () => {
    const runtime = createExtensionRuntime();
    const first = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('context', async (event) => ({
          messages: [...(event as any).messages, userMessage('first')],
        }));
      },
      runtime,
      undefined,
      '<first>',
    );
    const second = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('context', async (event) => ({
          messages: [...(event as any).messages, userMessage('second')],
        }));
      },
      runtime,
      undefined,
      '<second>',
    );
    const runner = createRunner([first, second]);

    const messages = await runner.emitContext([userMessage('base')]);

    expect(messages.map((message) => (message as any).content)).toEqual([
      'base',
      'first',
      'second',
    ]);
  });

  it('applies message_end replacement in-place across later handlers', async () => {
    const runtime = createExtensionRuntime();
    const first = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('message_end', async () => ({ message: userMessage('first replacement') }));
      },
      runtime,
      undefined,
      '<first>',
    );
    const second = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('message_end', async (event) => ({
          message: userMessage(`${((event as any).message as any).content} then second`),
        }));
      },
      runtime,
      undefined,
      '<second>',
    );
    const runner = createRunner([first, second]);

    const message = await runner.emitMessageEnd({
      type: 'message_end',
      message: userMessage('base'),
    });

    expect(message).toMatchObject({
      role: 'user',
      content: 'first replacement then second',
    });
  });

  it('reports and ignores message_end replacements with a different role', async () => {
    const runtime = createExtensionRuntime();
    const extension = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('message_end', async () => ({
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'invalid' }],
            api: 'anthropic-messages',
            provider: 'anthropic',
            model: 'claude-test',
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp: 2,
          },
        }));
      },
      runtime,
      undefined,
      '<bad>',
    );
    const runner = createRunner([extension]);
    const errors: unknown[] = [];
    runner.onError((error) => errors.push(error));

    const message = await runner.emitMessageEnd({
      type: 'message_end',
      message: userMessage('base'),
    });

    expect(message).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('dedupes tools and assigns command invocation names on collisions', async () => {
    const runtime = createExtensionRuntime();
    const parameters = Type.Object({});
    const first = await loadExtensionFromFactory(
      async (scout) => {
        scout.registerCommand('deploy', { description: 'deploy 1', handler: async () => {} });
        await scout.registerTool({
          name: 'echo',
          label: 'Echo',
          description: 'Echo',
          parameters,
          execute: async () => ({
            content: [{ type: 'text', text: 'first' }],
            details: undefined,
          }),
        });
      },
      runtime,
      undefined,
      '<first>',
    );
    const second = await loadExtensionFromFactory(
      async (scout) => {
        scout.registerCommand('deploy', { description: 'deploy 2', handler: async () => {} });
        await scout.registerTool({
          name: 'echo',
          label: 'Echo 2',
          description: 'Echo 2',
          parameters,
          execute: async () => ({
            content: [{ type: 'text', text: 'second' }],
            details: undefined,
          }),
        });
      },
      runtime,
      undefined,
      '<second>',
    );
    const runner = createRunner([first, second]);

    expect(runner.getAllRegisteredTools()).toHaveLength(1);
    expect(runner.getRegisteredCommands().map((command) => command.invocationName)).toEqual([
      'deploy:1',
      'deploy:2',
    ]);
    expect(runner.getCommandDiagnostics()).toHaveLength(1);
  });

  it('emits handler errors without stopping later handlers', async () => {
    const runtime = createExtensionRuntime();
    const first = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('agent_start', () => {
          throw new Error('broken');
        });
      },
      runtime,
      undefined,
      '<first>',
    );
    const secondHandler = vi.fn();
    const second = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('agent_start', secondHandler);
      },
      runtime,
      undefined,
      '<second>',
    );
    const runner = createRunner([first, second]);
    const errors: unknown[] = [];
    runner.onError((error) => errors.push(error));

    await runner.emit({ type: 'agent_start' });

    expect(errors).toHaveLength(1);
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});
