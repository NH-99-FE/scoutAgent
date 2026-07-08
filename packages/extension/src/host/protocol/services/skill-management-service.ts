// ============================================================
// Skill management service — Settings Skills 协议入口
// ============================================================

import * as path from 'node:path';
import type { ScoutSkillsSettings, ScoutSkillScope } from '@scout-agent/shared';
import type { ConfigManager } from '../../../config-manager.ts';
import {
  ScoutPackageManager,
  type ResolvedResource,
  type ScoutResourceSettingsSnapshot,
} from '../../../core/package-manager.ts';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import {
  dedupeConfiguredResourcePathEntries,
  dedupePaths,
  isKnownResourcePath,
  normalizeResourceEntries,
  ResourcePersistCoordinator,
  resolveConfiguredResourcePathEntries,
  resolveConfiguredResourcePaths,
  resolveConfiguredResourceSourceRoots,
} from './resource-management/index.ts';
import {
  SkillInventoryProjector,
  SkillPathResolver,
  SkillRuntimeInspector,
  SkillSourceClassifier,
  SkillTogglePlanner,
  type ConfiguredSkillPathEntry,
} from './skill-management/index.ts';
import type { ProtocolPayload, ProtocolResponder } from './types.ts';

// ---------- 类型 ----------

export interface SkillManagementProtocolServiceOptions {
  cwd: string;
  agentDir: string;
  configManager: ConfigManager;
  sessionManager: ExtensionSessionCoordinator;
  openTextFile?: (filePath: string) => Promise<void>;
  pushConfig: (surface?: ScoutWebviewSurface) => void;
  requestCommands: (surface?: ScoutWebviewSurface) => void;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
}

// ---------- Service ----------

export class SkillManagementProtocolService {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly configManager: ConfigManager;
  private readonly openTextFileCallback?: (filePath: string) => Promise<void>;
  private readonly paths: SkillPathResolver;
  private readonly runtimeInspector: SkillRuntimeInspector;
  private readonly sourceClassifier: SkillSourceClassifier;
  private readonly togglePlanner: SkillTogglePlanner;
  private readonly inventoryProjector: SkillInventoryProjector;
  private readonly persistCoordinator: ResourcePersistCoordinator;

  constructor(options: SkillManagementProtocolServiceOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this.configManager = options.configManager;
    this.openTextFileCallback = options.openTextFile;
    this.paths = new SkillPathResolver({ cwd: options.cwd, agentDir: options.agentDir });
    this.runtimeInspector = new SkillRuntimeInspector({
      cwd: options.cwd,
      agentDir: options.agentDir,
    });
    this.sourceClassifier = new SkillSourceClassifier(this.paths);
    this.togglePlanner = new SkillTogglePlanner({
      paths: this.paths,
      sourceClassifier: this.sourceClassifier,
      resolveResources: (resourceSettings) => this.resolveSkillResources(resourceSettings),
      getConfiguredSourceRoots: (resourceSettings) =>
        this.getConfiguredSkillSourceRoots(resourceSettings),
    });
    this.inventoryProjector = new SkillInventoryProjector({
      sourceClassifier: this.sourceClassifier,
      togglePlanner: this.togglePlanner,
    });
    this.persistCoordinator = new ResourcePersistCoordinator({
      sessionManager: options.sessionManager,
      pushConfig: options.pushConfig,
      requestCommands: options.requestCommands,
      pushState: options.pushState,
      pushTreeData: options.pushTreeData,
    });
  }

  async requestSkills(respond: ProtocolResponder): Promise<void> {
    respond({ type: 'skills_result', settings: this.getSettings() });
  }

  async saveSkillsSettings(
    message: ProtocolPayload<'save_skills_settings'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const savePlan = this.togglePlanner.createSavePlan(
      message.scope,
      message.entries,
      message.toggles ?? [],
      this.configManager.getResourceSettings(),
    );
    if (!savePlan.ok) {
      respond({
        type: 'save_skills_settings_result',
        success: false,
        error: savePlan.path ? `${savePlan.error}: ${savePlan.path}` : savePlan.error,
      });
      return;
    }

    try {
      this.saveSkillEntriesForScope(message.scope, savePlan.entries);
    } catch (error) {
      respond({
        type: 'save_skills_settings_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const reload = await this.reloadAfterPersist();
    respond({
      type: 'save_skills_settings_result',
      success: true,
      error: reload.error,
      settings: this.getSettings(),
    });
    await this.pushAfterPersist(reload.succeeded);
  }

  async openSkillFile(
    message: ProtocolPayload<'open_skill_file'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const filePath = path.resolve(message.path);
    if (!this.canOpenSkillPath(filePath)) {
      respond({
        type: 'open_skill_file_result',
        success: false,
        error: `Skill file is outside known skill paths: ${filePath}`,
        path: filePath,
      });
      return;
    }

    try {
      await this.openTextFileCallback?.(filePath);
      respond({ type: 'open_skill_file_result', success: true, path: filePath });
    } catch (error) {
      respond({
        type: 'open_skill_file_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: filePath,
      });
    }
  }

  private getSettings(): ScoutSkillsSettings {
    const runtimeSettings = this.configManager.getRuntimeSettings();
    const resourceSettings = this.configManager.getResourceSettings();
    const configuredPathEntries = this.getConfiguredSkillPathEntries(resourceSettings);
    const configuredPaths = this.getConfiguredSkillPaths(resourceSettings);
    const configuredSourceRoots = this.getConfiguredSkillSourceRoots(resourceSettings);
    const resources = this.resolveSkillResources(resourceSettings);
    const runtimeState = this.runtimeInspector.inspect(resources);
    return {
      projectDir: this.paths.getProjectSkillsDir(),
      globalDir: this.paths.getGlobalSkillsDir(),
      agentsDirs: this.paths.getExistingAgentsSkillDirs(),
      globalEntries: [...(runtimeSettings.global.skills ?? [])],
      projectEntries: [...(runtimeSettings.project.skills ?? [])],
      configuredPaths,
      diagnostics: runtimeState.diagnostics,
      skills: this.inventoryProjector.listSkills({
        resources,
        configuredPathEntries,
        configuredSourceRoots,
        runtimeState,
      }),
    };
  }

  private resolveSkillResources(
    resourceSettings = this.configManager.getResourceSettings(),
  ): ResolvedResource[] {
    return new ScoutPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      resourceSettings,
    }).resolve().skills;
  }

  private saveSkillEntriesForScope(scope: ScoutSkillScope, entries: string[]): void {
    const normalized = normalizeResourceEntries(entries);
    this.configManager.saveRuntimeSettings(scope, {
      operations:
        normalized.length > 0
          ? [{ op: 'set', path: 'skills', value: normalized }]
          : [{ op: 'unset', path: 'skills' }],
    });
  }

  private getConfiguredSkillPaths(resourceSettings: ScoutResourceSettingsSnapshot): string[] {
    return dedupePaths([
      ...resolveConfiguredResourcePaths(
        resourceSettings.project.skills,
        path.join(this.cwd, '.scout'),
      ),
      ...resolveConfiguredResourcePaths(resourceSettings.global.skills, this.agentDir),
    ]);
  }

  private getConfiguredSkillSourceRoots(resourceSettings: ScoutResourceSettingsSnapshot): string[] {
    return dedupePaths([
      ...resolveConfiguredResourceSourceRoots(
        resourceSettings.project.skills,
        path.join(this.cwd, '.scout'),
      ),
      ...resolveConfiguredResourceSourceRoots(resourceSettings.global.skills, this.agentDir),
    ]);
  }

  private getConfiguredSkillPathEntries(
    resourceSettings: ScoutResourceSettingsSnapshot,
  ): ConfiguredSkillPathEntry[] {
    return dedupeConfiguredResourcePathEntries([
      ...resolveConfiguredResourcePathEntries(
        resourceSettings.project.skills,
        path.join(this.cwd, '.scout'),
        'project',
        'project',
      ),
      ...resolveConfiguredResourcePathEntries(
        resourceSettings.global.skills,
        this.agentDir,
        'global',
        'user',
      ),
    ]);
  }

  private canOpenSkillPath(filePath: string): boolean {
    return isKnownResourcePath(
      filePath,
      this.resolveSkillResources(),
      this.paths.getKnownSkillRoots(),
    );
  }

  private async reloadAfterPersist(): Promise<{ succeeded: boolean; error?: string }> {
    return await this.persistCoordinator.reloadAfterPersist({
      cancelled: 'Runtime reload cancelled after saving skills',
      failedPrefix: 'Runtime reload failed after saving skills',
    });
  }

  private async pushAfterPersist(reloadSucceeded: boolean): Promise<void> {
    await this.persistCoordinator.pushAfterPersist(reloadSucceeded);
  }
}
