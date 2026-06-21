import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigManager } from '../../src/config-manager.ts';

function getConfiguration(
  settings: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
) {
  return () => ({
    get<T>(key: string): T | undefined {
      return (settings[key] ?? defaults[key]) as T | undefined;
    },
    has: () => false,
    inspect<T>(key: string) {
      return {
        key,
        defaultValue: defaults[key] as T | undefined,
        globalValue: settings[key] as T | undefined,
      };
    },
    update: async () => undefined,
  });
}

describe('ConfigManager', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-config-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lets project settings override VS Code settings', () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'settings.json'),
      JSON.stringify({
        defaultModel: 'anthropic/project-model',
        steeringMode: 'all',
      }),
    );

    const manager = new ConfigManager({
      cwd,
      agentDir,
      getConfiguration: getConfiguration({
        defaultModel: 'openai/vscode-model',
        'retry.enabled': true,
      }),
    });

    expect(manager.getDefaultModel()).toBe('anthropic/project-model');
    expect(manager.getSteeringMode()).toBe('all');
  });

  it('merges nested compaction settings from project settings', () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'settings.json'),
      JSON.stringify({
        compaction: { keepRecentTokens: 1234 },
      }),
    );

    const manager = new ConfigManager({
      cwd,
      agentDir,
      getConfiguration: getConfiguration({
        'compaction.enabled': true,
        'compaction.reserveTokens': 999,
        'compaction.keepRecentTokens': 20000,
      }),
    });

    expect(manager.getCompactionSettings()).toEqual({
      enabled: true,
      reserveTokens: 999,
      keepRecentTokens: 1234,
    });
  });

  it('ignores contribution defaults when reading default thinking level', () => {
    const manager = new ConfigManager({
      cwd,
      agentDir,
      getConfiguration: getConfiguration({}, { defaultThinkingLevel: 'off' }),
    });

    expect(manager.getDefaultThinkingLevel()).toBeUndefined();
  });

  it('preserves explicit default thinking level settings', () => {
    const manager = new ConfigManager({
      cwd,
      agentDir,
      getConfiguration: getConfiguration(
        { defaultThinkingLevel: 'off' },
        { defaultThinkingLevel: 'medium' },
      ),
    });

    expect(manager.getDefaultThinkingLevel()).toBe('off');
  });

  it('loads custom OpenAI and Anthropic models but rejects unsupported providers', () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'settings.json'),
      JSON.stringify({
        openaiApiKey: 'openai-key',
        anthropicApiKey: 'anthropic-key',
        models: [
          {
            id: 'project-gpt',
            name: 'Project GPT',
            provider: 'openai',
            api: 'openai-responses',
            reasoning: true,
            thinkingLevelMap: { minimal: null, xhigh: 'max' },
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1000,
            maxTokens: 100,
          },
          {
            id: 'unsupported',
            name: 'Unsupported',
            provider: 'openrouter',
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1000,
            maxTokens: 100,
          },
        ],
      }),
    );

    const manager = new ConfigManager({
      cwd,
      agentDir,
      getConfiguration: getConfiguration({}),
    });

    expect(manager.findModelByProvider('openai', 'project-gpt')?.name).toBe('Project GPT');
    expect(manager.findModelByProvider('openrouter', 'unsupported')).toBeUndefined();
    expect(
      manager.getScoutConfig().models.find((model) => model.id === 'project-gpt')
        ?.supportedThinkingLevels,
    ).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
  });
});
