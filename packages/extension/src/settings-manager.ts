// ============================================================
// SettingsManager — user/project settings.json 管理
// ============================================================

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  ScoutRuntimeSettings,
  ScoutRuntimeSettingsPatch,
  ScoutRuntimeSettingsState,
  ScoutSettingsScope,
} from '@scout-agent/shared';
import {
  cloneJson,
  isRecord,
  readJsonObjectFile,
  withFileLock,
  writeJsonFile,
} from './json-utils.ts';
import {
  applyRuntimeSettingsPatch,
  normalizeRuntimeSettings,
  readRuntimeSettings,
} from './runtime-settings-schema.ts';

export interface SettingsManagerOptions {
  cwd: string;
  userConfigDir?: string;
}

export function getDefaultUserConfigDir(): string {
  return join(homedir(), '.scout', 'agent');
}

export function getUserSettingsPath(userConfigDir = getDefaultUserConfigDir()): string {
  return join(resolve(userConfigDir), 'settings.json');
}

export function getProjectSettingsPath(cwd: string): string {
  return join(resolve(cwd), '.scout', 'settings.json');
}

export class SettingsManager {
  readonly cwd: string;
  readonly globalSettingsPath: string;
  readonly projectSettingsPath: string;
  private globalSettings: ScoutRuntimeSettings = {};
  private projectSettings: ScoutRuntimeSettings = {};
  private effectiveSettings: ScoutRuntimeSettings = {};
  private error: string | undefined;

  constructor(options: SettingsManagerOptions) {
    this.cwd = resolve(options.cwd);
    this.globalSettingsPath = getUserSettingsPath(options.userConfigDir);
    this.projectSettingsPath = getProjectSettingsPath(this.cwd);
    this.reload();
  }

  reload(): void {
    const global = readJsonObjectFile(this.globalSettingsPath, {
      errorLabel: 'Settings JSON is invalid',
      rootError: 'settings root must be a JSON object',
    });
    const project = readJsonObjectFile(this.projectSettingsPath, {
      errorLabel: 'Settings JSON is invalid',
      rootError: 'settings root must be a JSON object',
    });
    const globalSettings = readRuntimeSettings(global.ok ? global.value : {});
    const projectSettings = readRuntimeSettings(project.ok ? project.value : {});
    this.globalSettings = globalSettings.settings;
    this.projectSettings = projectSettings.settings;
    this.effectiveSettings = deepMergeSettings(this.globalSettings, this.projectSettings);
    this.error =
      [
        global.ok ? undefined : global.error,
        ...formatSettingsErrors(this.globalSettingsPath, globalSettings.errors),
        project.ok ? undefined : project.error,
        ...formatSettingsErrors(this.projectSettingsPath, projectSettings.errors),
      ]
        .filter(Boolean)
        .join('\n') || undefined;
  }

  getGlobalSettings(): ScoutRuntimeSettings {
    return cloneJson(this.globalSettings);
  }

  getProjectSettings(): ScoutRuntimeSettings {
    return cloneJson(this.projectSettings);
  }

  getEffectiveSettings(): ScoutRuntimeSettings {
    return cloneJson(this.effectiveSettings);
  }

  getSnapshot(): ScoutRuntimeSettingsState {
    const snapshot: ScoutRuntimeSettingsState = {
      globalSettingsPath: this.globalSettingsPath,
      projectSettingsPath: this.projectSettingsPath,
      global: this.getGlobalSettings(),
      project: this.getProjectSettings(),
      effective: this.getEffectiveSettings(),
    };
    if (this.error) snapshot.error = this.error;
    return snapshot;
  }

  save(scope: ScoutSettingsScope, patch: ScoutRuntimeSettingsPatch): ScoutRuntimeSettingsState {
    const path = scope === 'global' ? this.globalSettingsPath : this.projectSettingsPath;
    withFileLock(path, () => {
      const existing = readJsonObjectFile(path, {
        errorLabel: 'Settings JSON is invalid',
        rootError: 'settings root must be a JSON object',
      });
      if (!existing.ok) {
        throw new Error(
          `Cannot save ${scope} settings while settings JSON is invalid: ${existing.error}`,
        );
      }

      if (patch.operations.length > 0) {
        const next = applyRuntimeSettingsPatch(existing.value, patch);
        writeJsonFile(path, next);
      }
    });
    this.reload();
    return this.getSnapshot();
  }
}

function deepMergeSettings(
  base: ScoutRuntimeSettings,
  override: ScoutRuntimeSettings,
): ScoutRuntimeSettings {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];
    if (
      isRecord(baseValue) &&
      isRecord(overrideValue) &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      result[key] = deepMergeRecord(baseValue, overrideValue);
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue;
    }
  }
  return normalizeRuntimeSettings(result);
}

function deepMergeRecord(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];
    result[key] =
      isRecord(baseValue) && isRecord(overrideValue)
        ? deepMergeRecord(baseValue, overrideValue)
        : overrideValue;
  }
  return result;
}

function formatSettingsErrors(path: string, errors: string[]): string[] {
  return errors.map((error) => `Settings config is invalid: ${path}: ${error}`);
}
