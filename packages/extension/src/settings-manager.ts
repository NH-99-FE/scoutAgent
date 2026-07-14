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
  validateDefaultToolProfileReference,
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
    const globalToolProfileError = validateDefaultToolProfileReference(this.globalSettings);
    const effectiveToolProfileError = validateDefaultToolProfileReference(this.effectiveSettings);
    this.error =
      [
        global.ok ? undefined : global.error,
        ...formatSettingsErrors(this.globalSettingsPath, globalSettings.errors),
        globalToolProfileError
          ? `Settings config is invalid: ${this.globalSettingsPath}: ${globalToolProfileError}`
          : undefined,
        project.ok ? undefined : project.error,
        ...formatSettingsErrors(this.projectSettingsPath, projectSettings.errors),
        effectiveToolProfileError
          ? `Effective settings are invalid: ${effectiveToolProfileError}`
          : undefined,
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
        const scopedRead = readRuntimeSettings(next);
        if (scopedRead.errors[0]) {
          throw new Error(`Cannot save ${scope} settings: ${scopedRead.errors[0]}`);
        }
        const proposedGlobal = scope === 'global' ? scopedRead.settings : this.globalSettings;
        const proposedProject = scope === 'project' ? scopedRead.settings : this.projectSettings;
        const globalToolProfileError = validateDefaultToolProfileReference(proposedGlobal);
        if (globalToolProfileError) {
          throw new Error(`Cannot save global settings: ${globalToolProfileError}`);
        }
        const effectiveToolProfileError = validateDefaultToolProfileReference(
          deepMergeSettings(proposedGlobal, proposedProject),
        );
        if (effectiveToolProfileError) {
          throw new Error(`Cannot save effective settings: ${effectiveToolProfileError}`);
        }
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
      // toolProfiles 等数组采用 scope 整体覆盖语义；项目数组不得与全局数组隐式拼接。
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
