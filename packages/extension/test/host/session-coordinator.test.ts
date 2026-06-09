import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionSessionCoordinator } from '../../src/host/session-coordinator.ts';
import { ConfigManager } from '../../src/config-manager.ts';
import {
  mapSessionTreeToScout,
  resolveVisibleSessionLeafId,
} from '../../src/host/protocol/session-tree-mapper.ts';
import type { SessionTreeNode } from '../../src/core/session/index.ts';
import { assistantMessage, userMessage } from '../core/test-utils.ts';

function createOutputChannel() {
  return {
    name: 'scout-test',
    append: () => undefined,
    appendLine: () => undefined,
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  };
}

function createConfiguredConfigManager(cwd: string, agentDir: string): ConfigManager {
  const values: Record<string, unknown> = {
    anthropicApiKey: 'test-key',
    defaultModel: 'claude-sonnet-4-20250514',
  };

  return new ConfigManager({
    cwd,
    agentDir,
    getConfiguration: () =>
      ({
        get: <T>(key: string) => values[key] as T,
        has: (key: string) => key in values,
        inspect: () => undefined,
        update: async () => undefined,
      }) as never,
  });
}

describe('ExtensionSessionCoordinator lifecycle', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-session-coordinator-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves newSession options when creating the initial runtime', async () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'lifecycle.ts'),
      `export default function(scout) {
        scout.on("session_start", async (event) => {
          await scout.appendEntry("session-start", { reason: event.reason });
        });
      }`,
    );

    const parentSession = path.join(tempDir, 'parent.jsonl');
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    let setupSawParentSession: string | undefined;
    let withSessionEntries: unknown[] = [];

    const result = await coordinator.newSession({
      parentSession,
      setup: async (session) => {
        setupSawParentSession = session.getMetadata().parentSessionPath;
        session.appendMessage(userMessage('seeded setup message'));
      },
      withSession: async (ctx) => {
        withSessionEntries = ctx.sessionManager.getEntries();
      },
    });

    expect(result.cancelled).toBe(false);
    expect(coordinator.parentSessionPath).toBe(parentSession);
    expect(setupSawParentSession).toBe(parentSession);

    const seededMessage = withSessionEntries.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: string }).type === 'message' &&
        (entry as { message?: { content?: unknown } }).message?.content === 'seeded setup message',
    ) as { id: string } | undefined;
    const sessionStartEntry = withSessionEntries.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: string }).type === 'custom' &&
        (entry as { customType?: string }).customType === 'session-start',
    ) as { parentId: string | null; data?: { reason?: string } } | undefined;

    expect(seededMessage).toBeDefined();
    expect(sessionStartEntry).toMatchObject({
      parentId: seededMessage?.id,
      data: { reason: 'new' },
    });

    await coordinator.disposeAsync();
  });

  it('routes webview prompts to steer or followUp while the session is streaming', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    const prompt = vi.fn();
    const steer = vi.fn();
    const followUp = vi.fn();
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      isStreaming: true,
      prompt,
      steer,
      followUp,
    };

    await coordinator.prompt('turn now');
    await coordinator.prompt('after turn', { deliverAs: 'followUp' });

    expect(steer).toHaveBeenCalledWith('turn now');
    expect(followUp).toHaveBeenCalledWith('after turn');
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('session tree mapper', () => {
  it('hides metadata nodes and keeps visible descendants under the nearest visible parent', () => {
    const tree: SessionTreeNode[] = [
      {
        entry: {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: userMessage('root prompt'),
        },
        label: 'Root',
        children: [
          {
            entry: {
              type: 'label',
              id: 'label-meta',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              targetId: 'root',
              label: 'Root',
            },
            children: [
              {
                entry: {
                  type: 'message',
                  id: 'assistant',
                  parentId: 'label-meta',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  message: assistantMessage('assistant reply'),
                },
                children: [],
              },
            ],
          },
        ],
      },
    ];

    expect(mapSessionTreeToScout(tree)).toEqual([
      {
        id: 'root',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'message',
        label: 'Root',
        preview: 'root prompt',
        children: [
          {
            id: 'assistant',
            parentId: 'root',
            timestamp: '2026-01-01T00:00:02.000Z',
            type: 'message',
            label: undefined,
            preview: 'assistant reply',
            children: [],
          },
        ],
      },
    ]);
    expect(resolveVisibleSessionLeafId(tree, 'label-meta')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'assistant')).toBe('assistant');
  });

  it('resolves hidden session metadata leaves to the nearest visible ancestor', () => {
    const tree: SessionTreeNode[] = [
      {
        entry: {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: userMessage('root prompt'),
        },
        children: [
          {
            entry: {
              type: 'session_info',
              id: 'session-name',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              name: 'Named session',
            },
            children: [
              {
                entry: {
                  type: 'model_change',
                  id: 'model-change',
                  parentId: 'session-name',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  provider: 'openai',
                  modelId: 'gpt-test',
                },
                children: [
                  {
                    entry: {
                      type: 'thinking_level_change',
                      id: 'thinking-change',
                      parentId: 'model-change',
                      timestamp: '2026-01-01T00:00:03.000Z',
                      thinkingLevel: 'low',
                    },
                    children: [
                      {
                        entry: {
                          type: 'custom',
                          id: 'custom-meta',
                          parentId: 'thinking-change',
                          timestamp: '2026-01-01T00:00:04.000Z',
                          customType: 'extension-state',
                          data: { ready: true },
                        },
                        children: [
                          {
                            entry: {
                              type: 'message',
                              id: 'assistant',
                              parentId: 'custom-meta',
                              timestamp: '2026-01-01T00:00:05.000Z',
                              message: assistantMessage('assistant reply'),
                            },
                            children: [],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(mapSessionTreeToScout(tree)).toEqual([
      {
        id: 'root',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'message',
        label: undefined,
        preview: 'root prompt',
        children: [
          {
            id: 'assistant',
            parentId: 'root',
            timestamp: '2026-01-01T00:00:05.000Z',
            type: 'message',
            label: undefined,
            preview: 'assistant reply',
            children: [],
          },
        ],
      },
    ]);
    expect(resolveVisibleSessionLeafId(tree, 'session-name')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'model-change')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'thinking-change')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'custom-meta')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'assistant')).toBe('assistant');
  });

  it('only exposes displayable custom messages in the webview tree', () => {
    const tree: SessionTreeNode[] = [
      {
        entry: {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: userMessage('root prompt'),
        },
        children: [
          {
            entry: {
              type: 'custom_message',
              id: 'hidden-custom',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              customType: 'hidden',
              content: 'hidden content',
              display: false,
            },
            children: [
              {
                entry: {
                  type: 'custom_message',
                  id: 'visible-custom',
                  parentId: 'hidden-custom',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  customType: 'visible',
                  content: 'visible content',
                  display: true,
                },
                children: [],
              },
            ],
          },
        ],
      },
    ];

    expect(mapSessionTreeToScout(tree)).toEqual([
      {
        id: 'root',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'message',
        label: undefined,
        preview: 'root prompt',
        children: [
          {
            id: 'visible-custom',
            parentId: 'root',
            timestamp: '2026-01-01T00:00:02.000Z',
            type: 'custom_message',
            label: undefined,
            preview: 'visible content',
            children: [],
          },
        ],
      },
    ]);
    expect(resolveVisibleSessionLeafId(tree, 'hidden-custom')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'visible-custom')).toBe('visible-custom');
  });
});
