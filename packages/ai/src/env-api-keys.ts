// ============================================================
// 环境变量 API key 解析
// Scout 支持：Anthropic / OpenAI API key
// ============================================================

import type { KnownProvider } from './types';

// ---------- 供应商 → 环境变量映射 ----------

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
  return PROVIDER_ENV_VARS[provider];
}

/**
 * 查找供应商对应的环境变量中已配置的 API key 变量名。
 *
 * 只报告实际的 API key 变量，不包含 AWS profile、IAM 凭证、
 * Google Application Default Credentials 等隐式凭证源。
 */
export function findEnvKeys(provider: KnownProvider): string[] | undefined;
export function findEnvKeys(provider: string): string[] | undefined;
export function findEnvKeys(provider: string): string[] | undefined {
  const envVars = getApiKeyEnvVars(provider);
  if (!envVars) return undefined;

  const found = envVars.filter((envVar) => !!process.env[envVar]);
  return found.length > 0 ? found : undefined;
}

/**
 * 从环境变量获取供应商的 API key，例如 OPENAI_API_KEY。
 *
 * 仅返回 API key。
 */
export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: string): string | undefined {
  const envKeys = findEnvKeys(provider);
  if (envKeys?.[0]) {
    return process.env[envKeys[0]];
  }
  return undefined;
}
