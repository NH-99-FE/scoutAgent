import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentMessage } from '@scout-agent/agent';
import type { AssistantMessage, Model, Usage } from '@scout-agent/ai';
import type { Api } from '@scout-agent/ai';
import type {
  ScoutExtensionActions,
  ScoutExtensionContextActions,
} from '../../src/core/extensions/index.ts';
import { ConfigManager } from '../../src/config-manager.ts';

export function usage(input = 100, output = 50, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function userMessage(content: string): AgentMessage {
  return { role: 'user', content, timestamp: 1 };
}

export function assistantMessage(
  text: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 2,
    ...overrides,
  };
}

export function mockModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: 'mock-model',
    name: 'Mock Model',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://provider.test',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  };
}

export function createConfigManager(cwd: string): ConfigManager {
  const userConfigDir = path.join(cwd, '.test-scout-agent');
  fs.mkdirSync(userConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(userConfigDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          openai: { apiKey: 'test-key' },
          anthropic: { apiKey: 'test-key' },
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  return new ConfigManager({
    cwd,
    userConfigDir,
  });
}

export function createExtensionActions(): ScoutExtensionActions {
  return {
    sendMessage: async () => undefined,
    sendUserMessage: async () => undefined,
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: async () => undefined,
    refreshTools: async () => undefined,
    appendEntry: async () => undefined,
    setSessionName: async () => undefined,
    getSessionName: async () => undefined,
    setLabel: async () => undefined,
    getCommands: () => [],
    setModel: async () => undefined,
    getThinkingLevel: () => 'off',
    setThinkingLevel: async () => undefined,
  };
}

export function createExtensionContextActions(
  overrides: Partial<ScoutExtensionContextActions> = {},
): ScoutExtensionContextActions {
  return {
    getModel: () => undefined,
    isIdle: () => true,
    abort: () => undefined,
    getSystemPrompt: () => '',
    hasPendingMessages: () => false,
    getSignal: () => undefined,
    compact: () => undefined,
    shutdown: () => undefined,
    getContextUsage: async () => undefined,
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    waitForIdle: async () => undefined,
    reload: async () => undefined,
    navigateTree: async () => ({ cancelled: false }),
    ...overrides,
  };
}
