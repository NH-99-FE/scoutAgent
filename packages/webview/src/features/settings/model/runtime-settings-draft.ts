// ============================================================
// Runtime Settings Draft — settings.json 表单数据与协议数据转换
// ============================================================

import {
  SCOUT_MODEL_PROVIDERS,
  SCOUT_QUEUE_MODES,
  SCOUT_RUNTIME_SETTINGS_PATHS,
  SCOUT_TRANSPORTS,
  THINKING_LEVELS,
} from '@scout-agent/shared';
import type {
  ScoutModelProvider,
  ScoutQueueMode,
  ScoutRuntimeSettings,
  ScoutRuntimeSettingsPatch,
  ScoutRuntimeSettingsPath,
  ScoutRuntimeSettingsState,
  ScoutSettingsScope,
  ScoutTransport,
  ThinkingLevel,
} from '@scout-agent/shared';
import { parseOptionalJsonObject, stringifyOptionalJsonObject } from './json-draft-utils';

const SCOUT_MODEL_PROVIDER_SET = new Set<string>(SCOUT_MODEL_PROVIDERS);
const SCOUT_TRANSPORT_SET = new Set<string>(SCOUT_TRANSPORTS);
const SCOUT_QUEUE_MODE_SET = new Set<string>(SCOUT_QUEUE_MODES);
const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

export interface EditableRuntimeSettings extends Omit<
  ScoutRuntimeSettings,
  'thinkingBudgets' | 'extensions' | 'skills'
> {
  thinkingBudgetsJson: string;
  extensionsText: string;
  skillsText: string;
}

export interface EditableRuntimeSettingsState {
  scope: ScoutSettingsScope;
  globalSettingsPath: string;
  projectSettingsPath: string;
  global: EditableRuntimeSettings;
  project: EditableRuntimeSettings;
  effective: ScoutRuntimeSettings;
  error?: string;
}

export const EMPTY_RUNTIME_SETTINGS: EditableRuntimeSettings = {
  thinkingBudgetsJson: '',
  extensionsText: '',
  skillsText: '',
};

export const EMPTY_RUNTIME_SETTINGS_STATE: EditableRuntimeSettingsState = {
  scope: 'global',
  globalSettingsPath: '',
  projectSettingsPath: '',
  global: EMPTY_RUNTIME_SETTINGS,
  project: EMPTY_RUNTIME_SETTINGS,
  effective: {},
};

type RuntimeSettingsPatchValueResult = { ok: true; value: unknown } | { ok: false; error: string };

export function toEditableRuntimeSettingsState(
  state: ScoutRuntimeSettingsState,
  previous?: EditableRuntimeSettingsState,
): EditableRuntimeSettingsState {
  return {
    scope: previous?.scope ?? 'global',
    globalSettingsPath: state.globalSettingsPath,
    projectSettingsPath: state.projectSettingsPath,
    global: toEditableRuntimeSettings(state.global),
    project: toEditableRuntimeSettings(state.project),
    effective: state.effective,
    error: state.error,
  };
}

export function toRuntimeSettingsPatch(
  settings: EditableRuntimeSettings,
  dirtyPaths: ReadonlySet<ScoutRuntimeSettingsPath>,
): ScoutRuntimeSettingsPatch | string {
  const operations: ScoutRuntimeSettingsPatch['operations'] = [];
  for (const path of SCOUT_RUNTIME_SETTINGS_PATHS) {
    if (!dirtyPaths.has(path)) continue;
    const result = readRuntimeSettingsPatchValue(settings, path);
    if (!result.ok) return result.error;
    if (result.value === undefined) {
      operations.push({ op: 'unset', path });
    } else {
      operations.push({ op: 'set', path, value: result.value });
    }
  }
  return { operations };
}

export function updateNested<TObject extends object, TKey extends keyof TObject>(
  current: TObject | undefined,
  key: TKey,
  value: TObject[TKey] | undefined,
): TObject | undefined {
  const next = { ...(current ?? {}) } as TObject;
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function readOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toTransport(value: string): ScoutTransport | undefined {
  return SCOUT_TRANSPORT_SET.has(value) ? (value as ScoutTransport) : undefined;
}

export function toQueueMode(value: string): ScoutQueueMode | undefined {
  return SCOUT_QUEUE_MODE_SET.has(value) ? (value as ScoutQueueMode) : undefined;
}

export function toThinkingLevel(value: string): ThinkingLevel | undefined {
  return THINKING_LEVEL_SET.has(value) ? (value as ThinkingLevel) : undefined;
}

function toEditableRuntimeSettings(settings: ScoutRuntimeSettings): EditableRuntimeSettings {
  return {
    ...settings,
    thinkingBudgetsJson: stringifyOptionalJsonObject(settings.thinkingBudgets),
    extensionsText: settings.extensions?.join('\n') ?? '',
    skillsText: settings.skills?.join('\n') ?? '',
  };
}

function readStringList(value: string): string[] | undefined {
  const items = value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readRuntimeSettingsPatchValue(
  settings: EditableRuntimeSettings,
  path: ScoutRuntimeSettingsPath,
): RuntimeSettingsPatchValueResult {
  if (path === 'thinkingBudgets') {
    const parsed = parseOptionalJsonObject(settings.thinkingBudgetsJson, 'thinkingBudgets');
    return typeof parsed === 'string' ? { ok: false, error: parsed } : { ok: true, value: parsed };
  }
  if (path === 'extensions') return { ok: true, value: readStringList(settings.extensionsText) };
  if (path === 'skills') return { ok: true, value: readStringList(settings.skillsText) };
  if (path === 'defaultModel' && settings.defaultModel) {
    const scopedDefaultModel = readScopedDefaultModel(settings.defaultModel);
    if (scopedDefaultModel) {
      return {
        ok: false,
        error: `Default Model 只能填写模型 id，不要包含 ${scopedDefaultModel.provider}/ 前缀`,
      };
    }
  }
  return { ok: true, value: getPathValue(settings as unknown as Record<string, unknown>, path) };
}

function getPathValue(value: Record<string, unknown>, path: ScoutRuntimeSettingsPath): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readScopedDefaultModel(
  value: string,
): { provider: ScoutModelProvider; modelId: string } | undefined {
  const slashIndex = value.indexOf('/');
  if (slashIndex <= 0) return undefined;
  const provider = value.slice(0, slashIndex);
  if (!SCOUT_MODEL_PROVIDER_SET.has(provider)) return undefined;
  const modelId = value.slice(slashIndex + 1).trim();
  return modelId ? { provider: provider as ScoutModelProvider, modelId } : undefined;
}
