// ============================================================
// Runtime Settings Schema — settings.json 运行设置归一化与校验
// ============================================================

import {
  SCOUT_MODEL_PROVIDERS,
  SCOUT_QUEUE_MODES,
  SCOUT_RUNTIME_SETTINGS_PATHS,
  SCOUT_TRANSPORTS,
  THINKING_LEVELS,
} from '@scout-agent/shared';
import type {
  ScoutQueueMode,
  ScoutRuntimeSettings,
  ScoutRuntimeSettingsPatch,
  ScoutRuntimeSettingsPatchOperation,
  ScoutRuntimeSettingsPath,
  ScoutTransport,
  ThinkingLevel,
} from '@scout-agent/shared';
import { cloneJson, isRecord } from './json-utils.ts';

const VALID_TRANSPORTS = new Set<ScoutTransport>(SCOUT_TRANSPORTS);
const VALID_QUEUE_MODES = new Set<ScoutQueueMode>(SCOUT_QUEUE_MODES);
const VALID_THINKING_LEVELS = new Set<string>(THINKING_LEVELS);
const VALID_MODEL_PROVIDER_PREFIXES = new Set<string>(SCOUT_MODEL_PROVIDERS);
const VALID_RUNTIME_SETTINGS_PATHS = new Set<string>(SCOUT_RUNTIME_SETTINGS_PATHS);
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const RUNTIME_SETTINGS_KEYS = new Set<keyof ScoutRuntimeSettings>([
  'defaultProvider',
  'defaultModel',
  'defaultThinkingLevel',
  'transport',
  'thinkingBudgets',
  'websocketConnectTimeoutMs',
  'steeringMode',
  'followUpMode',
  'compaction',
  'branchSummary',
  'retry',
  'shellPath',
  'extensions',
]);

export interface RuntimeSettingsReadResult {
  settings: ScoutRuntimeSettings;
  errors: string[];
}

export function normalizeRuntimeSettings(value: unknown): ScoutRuntimeSettings {
  return readRuntimeSettings(value).settings;
}

export function validateRuntimeSettingsForSave(settings: ScoutRuntimeSettings): string | undefined {
  return readRuntimeSettings(settings).errors[0];
}

export function validateRuntimeSettingsPatch(value: unknown): string | undefined {
  const read = readRuntimeSettingsPatch(value);
  return read.errors[0];
}

export function applyRuntimeSettingsPatch(
  value: Record<string, unknown>,
  patch: ScoutRuntimeSettingsPatch,
): Record<string, unknown> {
  const validationError = validateRuntimeSettingsPatch(patch);
  if (validationError) {
    throw new Error(validationError);
  }

  const next = cloneJson(value);
  for (const operation of patch.operations) {
    if (operation.op === 'unset') {
      unsetPathValue(next, operation.path);
      continue;
    }
    for (const normalized of normalizePatchSetOperation(operation)) {
      setPathValue(next, normalized.path, normalized.value);
    }
  }
  return next;
}

export function readRuntimeSettings(value: unknown): RuntimeSettingsReadResult {
  const errors: string[] = [];
  const record = readRecord(value, '', errors);
  const settings: ScoutRuntimeSettings = {};
  if (!record) return { settings, errors };

  const defaultProvider = readProvider(record.defaultProvider, 'defaultProvider', errors);
  if (defaultProvider) settings.defaultProvider = defaultProvider;

  const defaultModel = readNonEmptyString(record.defaultModel, 'defaultModel', errors);
  if (defaultModel) {
    const scopedModel = readScopedDefaultModel(defaultModel);
    if (scopedModel) {
      settings.defaultProvider = scopedModel.provider;
      settings.defaultModel = scopedModel.modelId;
    } else {
      settings.defaultModel = defaultModel;
    }
  }

  const defaultThinkingLevel = readThinkingLevel(
    record.defaultThinkingLevel,
    'defaultThinkingLevel',
    errors,
  );
  if (defaultThinkingLevel) settings.defaultThinkingLevel = defaultThinkingLevel;

  const transport = readTransport(record.transport, 'transport', errors);
  if (transport) settings.transport = transport;

  const thinkingBudgets = readThinkingBudgets(record.thinkingBudgets, 'thinkingBudgets', errors);
  if (thinkingBudgets) settings.thinkingBudgets = thinkingBudgets;

  const websocketConnectTimeoutMs = readIntegerRange(
    record.websocketConnectTimeoutMs,
    'websocketConnectTimeoutMs',
    { min: 0, max: MAX_TIMER_DELAY_MS },
    errors,
  );
  if (websocketConnectTimeoutMs !== undefined) {
    settings.websocketConnectTimeoutMs = websocketConnectTimeoutMs;
  }

  const steeringMode = readQueueMode(record.steeringMode, 'steeringMode', errors);
  if (steeringMode) settings.steeringMode = steeringMode;

  const followUpMode = readQueueMode(record.followUpMode, 'followUpMode', errors);
  if (followUpMode) settings.followUpMode = followUpMode;

  const compaction = readCompactionSettings(record.compaction, 'compaction', errors);
  if (compaction) settings.compaction = compaction;

  const branchSummary = readBranchSummarySettings(record.branchSummary, 'branchSummary', errors);
  if (branchSummary) settings.branchSummary = branchSummary;

  const retry = readRetrySettings(record.retry, 'retry', errors);
  if (retry) settings.retry = retry;

  const shellPath = readNonEmptyString(record.shellPath, 'shellPath', errors);
  if (shellPath) settings.shellPath = shellPath;

  const extensions = readStringArray(record.extensions, 'extensions', errors);
  if (extensions) settings.extensions = extensions;

  return { settings, errors };
}

interface RuntimeSettingsPatchReadResult {
  patch?: ScoutRuntimeSettingsPatch;
  errors: string[];
}

interface NormalizedPatchSetOperation {
  path: ScoutRuntimeSettingsPath;
  value: unknown;
}

function readRuntimeSettingsPatch(value: unknown): RuntimeSettingsPatchReadResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    errors.push('patch must be an object');
    return { errors };
  }
  if (!Array.isArray(value.operations)) {
    errors.push('patch.operations must be an array');
    return { errors };
  }

  const operations: ScoutRuntimeSettingsPatchOperation[] = [];
  value.operations.forEach((item, index) => {
    const label = `patch.operations[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (item.op !== 'set' && item.op !== 'unset') {
      errors.push(`${label}.op must be one of set, unset`);
      return;
    }
    if (typeof item.path !== 'string' || !isRuntimeSettingsPath(item.path)) {
      errors.push(`${label}.path must be one of ${SCOUT_RUNTIME_SETTINGS_PATHS.join(', ')}`);
      return;
    }
    if (item.op === 'unset') {
      operations.push({ op: 'unset', path: item.path });
      return;
    }
    if (!('value' in item)) {
      errors.push(`${label}.value is required for set`);
      return;
    }
    const valueError = validateRuntimeSettingsPatchValue(item.path, item.value);
    if (valueError) {
      errors.push(`${label}.${valueError}`);
      return;
    }
    operations.push({ op: 'set', path: item.path, value: item.value });
  });

  return errors.length > 0 ? { errors } : { patch: { operations }, errors };
}

function validateRuntimeSettingsPatchValue(
  path: ScoutRuntimeSettingsPath,
  value: unknown,
): string | undefined {
  if ((path === 'defaultModel' || path === 'shellPath') && !readNonEmptyStringValue(value)) {
    return `value for ${path} must be a non-empty string`;
  }

  const synthetic = createSyntheticRuntimeSettings(path, value);
  const result = readRuntimeSettings(synthetic);
  if (result.errors[0]) return result.errors[0];
  if (path === 'defaultModel' && typeof value === 'string' && readScopedDefaultModel(value)) {
    return undefined;
  }
  if (getPathValue(result.settings as Record<string, unknown>, path) === undefined) {
    return `value for ${path} must produce a runtime setting`;
  }
  return undefined;
}

function normalizePatchSetOperation(
  operation: Extract<ScoutRuntimeSettingsPatchOperation, { op: 'set' }>,
): NormalizedPatchSetOperation[] {
  if (operation.path === 'defaultModel' && typeof operation.value === 'string') {
    const scopedModel = readScopedDefaultModel(operation.value.trim());
    if (scopedModel) {
      return [
        { path: 'defaultProvider', value: scopedModel.provider },
        { path: 'defaultModel', value: scopedModel.modelId },
      ];
    }
  }

  const normalized = readRuntimeSettings(
    createSyntheticRuntimeSettings(operation.path, operation.value),
  ).settings as Record<string, unknown>;
  return [{ path: operation.path, value: getPathValue(normalized, operation.path) }];
}

function createSyntheticRuntimeSettings(
  path: ScoutRuntimeSettingsPath,
  value: unknown,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  setPathValue(settings, path, value);
  return settings;
}

function readCompactionSettings(
  value: unknown,
  label: string,
  errors: string[],
): ScoutRuntimeSettings['compaction'] | undefined {
  const record = readOptionalRecord(value, label, errors);
  if (!record) return undefined;
  const result: NonNullable<ScoutRuntimeSettings['compaction']> = {};
  if (record.enabled !== undefined) {
    if (typeof record.enabled === 'boolean') {
      result.enabled = record.enabled;
    } else {
      errors.push(`${settingPath(label, 'enabled')} must be a boolean`);
    }
  }
  const reserveTokens = readIntegerRange(
    record.reserveTokens,
    settingPath(label, 'reserveTokens'),
    { min: 1 },
    errors,
  );
  if (reserveTokens !== undefined) result.reserveTokens = reserveTokens;
  const keepRecentTokens = readIntegerRange(
    record.keepRecentTokens,
    settingPath(label, 'keepRecentTokens'),
    { min: 1 },
    errors,
  );
  if (keepRecentTokens !== undefined) result.keepRecentTokens = keepRecentTokens;
  return Object.keys(result).length > 0 ? result : undefined;
}

function readBranchSummarySettings(
  value: unknown,
  label: string,
  errors: string[],
): ScoutRuntimeSettings['branchSummary'] | undefined {
  const record = readOptionalRecord(value, label, errors);
  if (!record) return undefined;
  const result: NonNullable<ScoutRuntimeSettings['branchSummary']> = {};
  const reserveTokens = readIntegerRange(
    record.reserveTokens,
    settingPath(label, 'reserveTokens'),
    { min: 1 },
    errors,
  );
  if (reserveTokens !== undefined) result.reserveTokens = reserveTokens;
  if (record.skipPrompt !== undefined) {
    if (typeof record.skipPrompt === 'boolean') {
      result.skipPrompt = record.skipPrompt;
    } else {
      errors.push(`${settingPath(label, 'skipPrompt')} must be a boolean`);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readRetrySettings(
  value: unknown,
  label: string,
  errors: string[],
): ScoutRuntimeSettings['retry'] | undefined {
  const record = readOptionalRecord(value, label, errors);
  if (!record) return undefined;
  const result: NonNullable<ScoutRuntimeSettings['retry']> = {};
  if (record.enabled !== undefined) {
    if (typeof record.enabled === 'boolean') {
      result.enabled = record.enabled;
    } else {
      errors.push(`${settingPath(label, 'enabled')} must be a boolean`);
    }
  }
  const maxRetries = readIntegerRange(
    record.maxRetries,
    settingPath(label, 'maxRetries'),
    { min: 0 },
    errors,
  );
  if (maxRetries !== undefined) result.maxRetries = maxRetries;
  const baseDelayMs = readIntegerRange(
    record.baseDelayMs,
    settingPath(label, 'baseDelayMs'),
    { min: 0, max: MAX_TIMER_DELAY_MS },
    errors,
  );
  if (baseDelayMs !== undefined) result.baseDelayMs = baseDelayMs;
  const provider = readRetryProviderSettings(
    record.provider,
    settingPath(label, 'provider'),
    errors,
  );
  if (provider) result.provider = provider;
  return Object.keys(result).length > 0 ? result : undefined;
}

function readRetryProviderSettings(
  value: unknown,
  label: string,
  errors: string[],
): NonNullable<ScoutRuntimeSettings['retry']>['provider'] | undefined {
  const record = readOptionalRecord(value, label, errors);
  if (!record) return undefined;
  const result: NonNullable<NonNullable<ScoutRuntimeSettings['retry']>['provider']> = {};
  const timeoutMs = readIntegerRange(
    record.timeoutMs,
    settingPath(label, 'timeoutMs'),
    { min: 0, max: MAX_TIMER_DELAY_MS },
    errors,
  );
  if (timeoutMs !== undefined) result.timeoutMs = timeoutMs;
  const maxRetries = readIntegerRange(
    record.maxRetries,
    settingPath(label, 'maxRetries'),
    { min: 0 },
    errors,
  );
  if (maxRetries !== undefined) result.maxRetries = maxRetries;
  const maxRetryDelayMs = readIntegerRange(
    record.maxRetryDelayMs,
    settingPath(label, 'maxRetryDelayMs'),
    { min: 0, max: MAX_TIMER_DELAY_MS },
    errors,
  );
  if (maxRetryDelayMs !== undefined) result.maxRetryDelayMs = maxRetryDelayMs;
  return Object.keys(result).length > 0 ? result : undefined;
}

function readThinkingBudgets(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, unknown> | undefined {
  const record = readOptionalRecord(value, label, errors);
  if (!record) return undefined;
  const result: Record<string, number> = {};
  for (const [level, rawBudget] of Object.entries(record)) {
    const budget = readIntegerRange(rawBudget, settingPath(label, level), { min: 1 }, errors);
    if (budget !== undefined) result[level] = budget;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readProvider(
  value: unknown,
  label: string,
  errors: string[],
): ScoutRuntimeSettings['defaultProvider'] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && VALID_MODEL_PROVIDER_PREFIXES.has(value)) {
    return value as NonNullable<ScoutRuntimeSettings['defaultProvider']>;
  }
  errors.push(`${label} must be one of ${SCOUT_MODEL_PROVIDERS.join(', ')}`);
  return undefined;
}

function readTransport(
  value: unknown,
  label: string,
  errors: string[],
): ScoutTransport | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && VALID_TRANSPORTS.has(value as ScoutTransport)) {
    return value as ScoutTransport;
  }
  errors.push(`${label} must be one of ${Array.from(VALID_TRANSPORTS).join(', ')}`);
  return undefined;
}

function readThinkingLevel(
  value: unknown,
  label: string,
  errors: string[],
): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && VALID_THINKING_LEVELS.has(value)) {
    return value as ThinkingLevel;
  }
  errors.push(`${label} must be one of ${THINKING_LEVELS.join(', ')}`);
  return undefined;
}

function readQueueMode(
  value: unknown,
  label: string,
  errors: string[],
): ScoutQueueMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && VALID_QUEUE_MODES.has(value as ScoutQueueMode)) {
    return value as ScoutQueueMode;
  }
  errors.push(`${label} must be one of ${Array.from(VALID_QUEUE_MODES).join(', ')}`);
  return undefined;
}

function readNonEmptyString(value: unknown, label: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${label} must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readNonEmptyStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readStringArray(value: unknown, label: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    errors.push(`${label} must be a string array`);
    return undefined;
  }
  return value;
}

interface IntegerRange {
  min: number;
  max?: number;
}

function readIntegerRange(
  value: unknown,
  label: string,
  range: IntegerRange,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number`);
    return undefined;
  }
  if (!Number.isInteger(value)) {
    errors.push(`${label} must be an integer`);
    return undefined;
  }
  if (!Number.isSafeInteger(value)) {
    errors.push(`${label} must be a safe integer`);
    return undefined;
  }
  if (value < range.min || (range.max !== undefined && value > range.max)) {
    errors.push(`${label} ${rangeDescription(range)}`);
    return undefined;
  }
  return value;
}

function rangeDescription(range: IntegerRange): string {
  if (range.max !== undefined) return `must be between ${range.min} and ${range.max}`;
  if (range.min === 1) return 'must be greater than 0';
  return `must be greater than or equal to ${range.min}`;
}

function readRecord(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  errors.push(label ? `${label} must be an object` : 'settings must be an object');
  return undefined;
}

function readOptionalRecord(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return readRecord(value, label, errors);
}

function readScopedDefaultModel(
  value: string,
): { provider: NonNullable<ScoutRuntimeSettings['defaultProvider']>; modelId: string } | undefined {
  const slashIndex = value.indexOf('/');
  if (slashIndex <= 0) return undefined;
  const provider = value.slice(0, slashIndex);
  if (!VALID_MODEL_PROVIDER_PREFIXES.has(provider)) return undefined;
  const modelId = value.slice(slashIndex + 1).trim();
  return modelId
    ? { provider: provider as NonNullable<ScoutRuntimeSettings['defaultProvider']>, modelId }
    : undefined;
}

function settingPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function isRuntimeSettingsPath(value: string): value is ScoutRuntimeSettingsPath {
  return VALID_RUNTIME_SETTINGS_PATHS.has(value);
}

function getPathValue(value: Record<string, unknown>, path: ScoutRuntimeSettingsPath): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setPathValue(
  value: Record<string, unknown>,
  path: ScoutRuntimeSettingsPath,
  nextValue: unknown,
): void {
  const parts = path.split('.');
  let current = value;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isRecord(child)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = nextValue;
}

function unsetPathValue(value: Record<string, unknown>, path: ScoutRuntimeSettingsPath): void {
  const parts = path.split('.');
  const parents: Array<{ object: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> = value;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isRecord(child)) return;
    parents.push({ object: current, key: part });
    current = child;
  }

  delete current[parts[parts.length - 1]!];
  for (let index = parents.length - 1; index >= 0; index--) {
    const parent = parents[index]!;
    const child = parent.object[parent.key];
    if (!isRecord(child) || Object.keys(child).length > 0) return;
    delete parent.object[parent.key];
  }
}
