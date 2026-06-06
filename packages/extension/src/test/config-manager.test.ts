// ============================================================
// ConfigManager 测试
// ============================================================

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import { describe, it, expect, vi } from 'vitest';

// ---------- Mock vscode ----------

vi.mock('vscode', () => ({
  Uri: {
    parse: vi.fn(),
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn(),
  },
  Disposable: class {
    dispose() {}
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    workspaceFolders: [],
  },
}));

import { ConfigManager } from '../config-manager.ts';

function makeMockConfiguration(config: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key in config) return config[key];
      return defaultValue;
    }),
    has: vi.fn((key: string) => key in config),
    update: vi.fn(),
    inspect: vi.fn(),
  };
}

function makeConfigManager(config: Record<string, unknown> = {}) {
  return new ConfigManager({
    cwd: '/test/workspace',
    agentDir: '/test/.scout',
    getConfiguration: () => makeMockConfiguration(config),
  });
}

describe('ConfigManager', () => {
  it('reads anthropic API key from settings', () => {
    const cm = makeConfigManager({ anthropicApiKey: 'sk-ant-test' });
    expect(cm.getApiKey('anthropic')).toBe('sk-ant-test');
  });

  it('reads openai API key from settings', () => {
    const cm = makeConfigManager({ openaiApiKey: 'sk-oai-test' });
    expect(cm.getApiKey('openai')).toBe('sk-oai-test');
  });

  it('returns undefined for unknown provider', () => {
    const cm = makeConfigManager({});
    expect(cm.getApiKey('unknown')).toBeUndefined();
  });

  it('returns undefined for empty API key', () => {
    const cm = makeConfigManager({ anthropicApiKey: '' });
    expect(cm.getApiKey('anthropic')).toBeUndefined();
  });

  it('reads shell path from settings', () => {
    const cm = makeConfigManager({ shellPath: '/bin/zsh' });
    expect(cm.getShellPath()).toBe('/bin/zsh');
  });

  it('returns undefined for empty shell path', () => {
    const cm = makeConfigManager({ shellPath: '' });
    expect(cm.getShellPath()).toBeUndefined();
  });

  it('reads default model from settings', () => {
    const cm = makeConfigManager({ defaultModel: 'claude-sonnet-4-20250514' });
    expect(cm.getDefaultModel()).toBe('claude-sonnet-4-20250514');
  });

  it('reloads project settings from disk', () => {
    const tempDir = join(tmpdir(), `scout-config-test-${Date.now()}`);
    const scoutDir = join(tempDir, '.scout');
    const settingsPath = join(scoutDir, 'settings.json');

    try {
      mkdirSync(scoutDir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify({ defaultModel: 'first-model' }));
      const cm = new ConfigManager({
        cwd: tempDir,
        agentDir: scoutDir,
        getConfiguration: () =>
          makeMockConfiguration({
            defaultModel: 'fallback-model',
          }) as vscode.WorkspaceConfiguration,
      });

      expect(cm.getDefaultModel()).toBe('first-model');

      writeFileSync(settingsPath, JSON.stringify({ defaultModel: 'second-model' }));
      cm.reload();

      expect(cm.getDefaultModel()).toBe('second-model');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reads default thinking level from settings', () => {
    const cm = makeConfigManager({ defaultThinkingLevel: 'medium' });
    expect(cm.getDefaultThinkingLevel()).toBe('medium');
  });

  it('returns undefined for empty default thinking level', () => {
    const cm = makeConfigManager({ defaultThinkingLevel: '' });
    expect(cm.getDefaultThinkingLevel()).toBeUndefined();
  });

  it('reads compaction settings with defaults', () => {
    const cm = makeConfigManager({});
    const settings = cm.getCompactionSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.reserveTokens).toBe(16384);
    expect(settings.keepRecentTokens).toBe(20000);
  });

  it('reads compaction settings from config', () => {
    const cm = makeConfigManager({
      'compaction.enabled': false,
      'compaction.reserveTokens': 8192,
      'compaction.keepRecentTokens': 10000,
    });
    const settings = cm.getCompactionSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.reserveTokens).toBe(8192);
    expect(settings.keepRecentTokens).toBe(10000);
  });

  it('finds model by id', () => {
    const cm = makeConfigManager({ anthropicApiKey: 'test-key' });
    const model = cm.findModel('claude-sonnet-4-20250514');
    expect(model).toBeDefined();
    expect(model?.id).toBe('claude-sonnet-4-20250514');
  });

  it('returns undefined for unknown model id', () => {
    const cm = makeConfigManager({ anthropicApiKey: 'test-key' });
    expect(cm.findModel('nonexistent-model')).toBeUndefined();
  });

  it('finds default model from user setting', () => {
    const cm = makeConfigManager({
      anthropicApiKey: 'test-key',
      defaultModel: 'claude-opus-4-20250514',
    });
    const model = cm.findDefaultModel();
    expect(model).toBeDefined();
    expect(model?.id).toBe('claude-opus-4-20250514');
  });

  it('falls back to built-in default model when no user setting', () => {
    const cm = makeConfigManager({ anthropicApiKey: 'test-key' });
    const model = cm.findDefaultModel();
    expect(model).toBeDefined();
  });

  it('returns first available model when no default is configured and no key for default', () => {
    const cm = makeConfigManager({ openaiApiKey: 'test-key' });
    const model = cm.findDefaultModel();
    expect(model).toBeDefined();
    expect(model?.provider).toBe('openai');
  });

  it('returns undefined when no API keys configured', () => {
    const cm = makeConfigManager({});
    expect(cm.findDefaultModel()).toBeUndefined();
  });

  it('returns available models for configured providers', () => {
    const cm = makeConfigManager({ anthropicApiKey: 'test-key' });
    const models = cm.getAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('excludes models without API key', () => {
    const cm = makeConfigManager({ anthropicApiKey: 'test-key' });
    const models = cm.getAvailableModels();
    expect(models.every((m) => m.provider !== 'openai')).toBe(true);
  });

  it('generates ScoutConfig with available models', () => {
    const cm = makeConfigManager({
      anthropicApiKey: 'test-key',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    const config = cm.getScoutConfig();
    expect(config.models.length).toBeGreaterThan(0);
    expect(config.defaultModelId).toBe('claude-sonnet-4-20250514');
  });

  it('exposes cwd and agentDir', () => {
    const cm = makeConfigManager();
    expect(cm.cwd).toBe('/test/workspace');
    expect(cm.agentDir).toBe('/test/.scout');
  });

  it('reads steering mode from settings', () => {
    const cm = makeConfigManager({ steeringMode: 'all' });
    expect(cm.getSteeringMode()).toBe('all');
  });

  it('defaults steering mode to one-at-a-time', () => {
    const cm = makeConfigManager({});
    expect(cm.getSteeringMode()).toBe('one-at-a-time');
  });

  it('reads follow-up mode from settings', () => {
    const cm = makeConfigManager({ followUpMode: 'all' });
    expect(cm.getFollowUpMode()).toBe('all');
  });

  it('defaults follow-up mode to one-at-a-time', () => {
    const cm = makeConfigManager({});
    expect(cm.getFollowUpMode()).toBe('one-at-a-time');
  });

  it('rejects invalid thinking level values', () => {
    const cm = makeConfigManager({ defaultThinkingLevel: 'invalid-value' });
    expect(cm.getDefaultThinkingLevel()).toBeUndefined();
  });

  it('reads retry settings with defaults', () => {
    const cm = makeConfigManager({});
    const settings = cm.getRetrySettings();
    expect(settings.enabled).toBe(true);
    expect(settings.maxRetries).toBe(3);
    expect(settings.baseDelayMs).toBe(2000);
  });

  it('reads retry settings from config', () => {
    const cm = makeConfigManager({
      'retry.enabled': false,
      'retry.maxRetries': 5,
      'retry.baseDelayMs': 5000,
    });
    const settings = cm.getRetrySettings();
    expect(settings.enabled).toBe(false);
    expect(settings.maxRetries).toBe(5);
    expect(settings.baseDelayMs).toBe(5000);
  });

  it('handles partial retry settings with defaults', () => {
    const cm = makeConfigManager({
      'retry.maxRetries': 10,
    });
    const settings = cm.getRetrySettings();
    expect(settings.enabled).toBe(true);
    expect(settings.maxRetries).toBe(10);
    expect(settings.baseDelayMs).toBe(2000);
  });

  it('reads provider stream options from config', () => {
    const cm = makeConfigManager({
      transport: 'sse',
      'retry.provider.timeoutMs': 120000,
      'retry.provider.maxRetries': 4,
      'retry.provider.maxRetryDelayMs': 30000,
      websocketConnectTimeoutMs: 15000,
      thinkingBudgets: {
        minimal: 512,
        low: 1024,
        medium: 4096,
        high: 8192,
      },
    });

    expect(cm.getStreamOptions()).toEqual({
      transport: 'sse',
      timeoutMs: 120000,
      maxRetries: 4,
      maxRetryDelayMs: 30000,
      websocketConnectTimeoutMs: 15000,
      thinkingBudgets: {
        minimal: 512,
        low: 1024,
        medium: 4096,
        high: 8192,
      },
    });
  });

  it('defaults provider stream options to Pi-compatible values', () => {
    const cm = makeConfigManager({});

    expect(cm.getStreamOptions()).toEqual({
      transport: 'auto',
      timeoutMs: undefined,
      maxRetries: undefined,
      maxRetryDelayMs: 60000,
      websocketConnectTimeoutMs: undefined,
      thinkingBudgets: undefined,
    });
  });
});
