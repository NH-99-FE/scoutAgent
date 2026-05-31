// ============================================================
// env-api-keys 测试 — 环境变量 API key 解析
// ============================================================

import { describe, it, expect } from 'vitest';
import { getEnvApiKey, findEnvKeys } from '../src/env-api-keys';

// ---------- 保存原始环境变量 ----------

const originalEnv: Record<string, string | undefined> = {};

function saveEnv(key: string) {
  originalEnv[key] = process.env[key];
}

function restoreEnv(key: string) {
  if (originalEnv[key] === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = originalEnv[key];
  }
}

// ---------- findEnvKeys ----------

describe('findEnvKeys', () => {
  it('returns undefined for unknown provider', () => {
    expect(findEnvKeys('unknown-provider' as any)).toBeUndefined();
  });

  it('returns env var names that are set for anthropic', () => {
    saveEnv('ANTHROPIC_API_KEY');
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    try {
      const keys = findEnvKeys('anthropic');
      expect(keys).toBeDefined();
      expect(keys).toContain('ANTHROPIC_API_KEY');
    } finally {
      restoreEnv('ANTHROPIC_API_KEY');
    }
  });

  it('returns undefined when no env vars are set', () => {
    saveEnv('ANTHROPIC_OAUTH_TOKEN');
    saveEnv('ANTHROPIC_API_KEY');
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(findEnvKeys('anthropic')).toBeUndefined();
    } finally {
      restoreEnv('ANTHROPIC_OAUTH_TOKEN');
      restoreEnv('ANTHROPIC_API_KEY');
    }
  });

  it('prefers OAUTH token over API key for anthropic', () => {
    saveEnv('ANTHROPIC_OAUTH_TOKEN');
    saveEnv('ANTHROPIC_API_KEY');
    process.env.ANTHROPIC_OAUTH_TOKEN = 'oauth-token';
    process.env.ANTHROPIC_API_KEY = 'api-key';
    try {
      const keys = findEnvKeys('anthropic');
      expect(keys).toBeDefined();
      expect(keys![0]).toBe('ANTHROPIC_OAUTH_TOKEN');
    } finally {
      restoreEnv('ANTHROPIC_OAUTH_TOKEN');
      restoreEnv('ANTHROPIC_API_KEY');
    }
  });

  it('finds OPENAI_API_KEY for openai provider', () => {
    saveEnv('OPENAI_API_KEY');
    process.env.OPENAI_API_KEY = 'sk-openai-key';
    try {
      const keys = findEnvKeys('openai');
      expect(keys).toEqual(['OPENAI_API_KEY']);
    } finally {
      restoreEnv('OPENAI_API_KEY');
    }
  });

  it('finds DEEPSEEK_API_KEY for deepseek provider', () => {
    saveEnv('DEEPSEEK_API_KEY');
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek-key';
    try {
      const keys = findEnvKeys('deepseek');
      expect(keys).toEqual(['DEEPSEEK_API_KEY']);
    } finally {
      restoreEnv('DEEPSEEK_API_KEY');
    }
  });
});

// ---------- getEnvApiKey ----------

describe('getEnvApiKey', () => {
  it('returns the value of the first found env var', () => {
    saveEnv('OPENAI_API_KEY');
    process.env.OPENAI_API_KEY = 'sk-openai-key';
    try {
      expect(getEnvApiKey('openai')).toBe('sk-openai-key');
    } finally {
      restoreEnv('OPENAI_API_KEY');
    }
  });

  it('returns undefined when no env vars are set', () => {
    saveEnv('OPENAI_API_KEY');
    delete process.env.OPENAI_API_KEY;
    try {
      expect(getEnvApiKey('openai')).toBeUndefined();
    } finally {
      restoreEnv('OPENAI_API_KEY');
    }
  });

  it('returns undefined for unknown provider', () => {
    expect(getEnvApiKey('unknown-provider' as any)).toBeUndefined();
  });

  it('prefers OAUTH token for anthropic', () => {
    saveEnv('ANTHROPIC_OAUTH_TOKEN');
    saveEnv('ANTHROPIC_API_KEY');
    process.env.ANTHROPIC_OAUTH_TOKEN = 'oauth-token-value';
    process.env.ANTHROPIC_API_KEY = 'api-key-value';
    try {
      expect(getEnvApiKey('anthropic')).toBe('oauth-token-value');
    } finally {
      restoreEnv('ANTHROPIC_OAUTH_TOKEN');
      restoreEnv('ANTHROPIC_API_KEY');
    }
  });

  it('falls back to API key when OAUTH is not set', () => {
    saveEnv('ANTHROPIC_OAUTH_TOKEN');
    saveEnv('ANTHROPIC_API_KEY');
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'fallback-api-key';
    try {
      expect(getEnvApiKey('anthropic')).toBe('fallback-api-key');
    } finally {
      restoreEnv('ANTHROPIC_OAUTH_TOKEN');
      restoreEnv('ANTHROPIC_API_KEY');
    }
  });
});
