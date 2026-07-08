// ============================================================
// Extension management service — Settings 扩展入口与文件管理
// ============================================================

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ScoutExtensionListItem,
  ScoutExtensionResourceScope,
  ScoutExtensionTemplateInfo,
  ScoutExtensionsSettings,
  ScoutExtensionScope,
  ScoutExtensionTemplateId,
  SourceInfo,
} from '@scout-agent/shared';
import type { ConfigManager } from '../../../config-manager.ts';
import {
  ScoutPackageManager,
  type ResolvedResource,
  type ScoutResourceSettingsSnapshot,
} from '../../../core/package-manager.ts';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { getExtensionTemplate, listExtensionTemplates } from './extension-templates.ts';
import {
  dedupeConfiguredResourcePathEntries,
  dedupePaths,
  getMissingConfiguredResourceEntries,
  isKnownResourcePath,
  ResourcePersistCoordinator,
  resolveConfiguredResourcePathEntries,
  resolveConfiguredResourcePaths,
  type ConfiguredResourcePathEntry,
} from './resource-management/index.ts';
import type { ProtocolPayload, ProtocolResponder } from './types.ts';

// ---------- 类型 ----------

export interface ExtensionManagementProtocolServiceOptions {
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

type ConfiguredExtensionPathEntry = ConfiguredResourcePathEntry<ScoutExtensionScope>;

// ---------- Service ----------

export class ExtensionManagementProtocolService {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly configManager: ConfigManager;
  private readonly openTextFileCallback?: (filePath: string) => Promise<void>;
  private readonly persistCoordinator: ResourcePersistCoordinator;

  constructor(options: ExtensionManagementProtocolServiceOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this.configManager = options.configManager;
    this.openTextFileCallback = options.openTextFile;
    this.persistCoordinator = new ResourcePersistCoordinator({
      sessionManager: options.sessionManager,
      pushConfig: options.pushConfig,
      requestCommands: options.requestCommands,
      pushState: options.pushState,
      pushTreeData: options.pushTreeData,
    });
  }

  async requestExtensions(respond: ProtocolResponder): Promise<void> {
    respond({ type: 'extensions_result', settings: await this.getSettings() });
  }

  async createExtensionFromTemplate(
    message: ProtocolPayload<'create_extension_from_template'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const template = getExtensionTemplate(message.templateId);
    const filePath = this.getTemplatePath(message.templateId, message.scope);

    try {
      const exists = await pathExists(filePath);
      if (!exists || message.overwrite) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, template.render(), 'utf8');
      }

      const reload = await this.reloadAfterPersist();
      respond({
        type: 'create_extension_from_template_result',
        success: reload.succeeded,
        error: reload.error,
        path: filePath,
      });
      await this.pushAfterPersist(reload.succeeded);
    } catch (error) {
      respond({
        type: 'create_extension_from_template_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: filePath,
      });
    }
  }

  async openExtensionFile(
    message: ProtocolPayload<'open_extension_file'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const filePath = path.resolve(message.path);
    if (!this.canOpenExtensionPath(filePath)) {
      respond({
        type: 'open_extension_file_result',
        success: false,
        error: `Extension file is outside known extension paths: ${filePath}`,
        path: filePath,
      });
      return;
    }

    try {
      await this.openTextFileCallback?.(filePath);
      respond({ type: 'open_extension_file_result', success: true, path: filePath });
    } catch (error) {
      respond({
        type: 'open_extension_file_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: filePath,
      });
    }
  }

  private async getSettings(): Promise<ScoutExtensionsSettings> {
    const projectDir = this.getProjectExtensionsDir();
    const globalDir = this.getGlobalExtensionsDir();
    const resourceSettings = this.configManager.getResourceSettings();
    const configuredPathEntries = this.getConfiguredExtensionPathEntries(resourceSettings);
    const configuredPaths = this.getConfiguredExtensionPaths(resourceSettings);
    const extensions = this.listExtensions(resourceSettings, configuredPathEntries);
    return {
      projectDir,
      globalDir,
      configuredPaths,
      templates: await this.listTemplates(),
      extensions,
    };
  }

  private async listTemplates(): Promise<ScoutExtensionTemplateInfo[]> {
    return await Promise.all(
      listExtensionTemplates().map(async (template) => {
        const templatePath = this.getTemplatePath(template.id, 'project');
        return {
          id: template.id,
          label: template.label,
          path: templatePath,
          exists: await pathExists(templatePath),
        };
      }),
    );
  }

  private listExtensions(
    resourceSettings: ScoutResourceSettingsSnapshot,
    configuredPathEntries = this.getConfiguredExtensionPathEntries(resourceSettings),
  ): ScoutExtensionListItem[] {
    const resources = this.resolveExtensionResources(resourceSettings);
    const missingConfiguredItems = this.getMissingConfiguredExtensionItems(
      configuredPathEntries,
      resources,
    );
    return resources
      .map((resource) => this.toExtensionListItem(resource))
      .concat(missingConfiguredItems)
      .sort(compareExtensionItems);
  }

  private resolveExtensionResources(
    resourceSettings = this.configManager.getResourceSettings(),
  ): ResolvedResource[] {
    return new ScoutPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      resourceSettings,
    }).resolve().extensions;
  }

  private toExtensionListItem(resource: ResolvedResource): ScoutExtensionListItem {
    return {
      name: getExtensionDisplayName(resource.path),
      path: resource.path,
      scope: toScoutExtensionResourceScope(resource),
      sourceInfo: toScoutExtensionSourceInfo(resource),
      exists: true,
      enabled: resource.enabled,
    };
  }

  private getConfiguredExtensionPaths(resourceSettings: ScoutResourceSettingsSnapshot): string[] {
    return dedupePaths([
      ...resolveConfiguredResourcePaths(
        resourceSettings.project.extensions,
        path.join(this.cwd, '.scout'),
      ),
      ...resolveConfiguredResourcePaths(resourceSettings.global.extensions, this.agentDir),
    ]);
  }

  private getConfiguredExtensionPathEntries(
    resourceSettings: ScoutResourceSettingsSnapshot,
  ): ConfiguredExtensionPathEntry[] {
    return dedupeConfiguredResourcePathEntries([
      ...resolveConfiguredResourcePathEntries(
        resourceSettings.project.extensions,
        path.join(this.cwd, '.scout'),
        'project',
        'project',
      ),
      ...resolveConfiguredResourcePathEntries(
        resourceSettings.global.extensions,
        this.agentDir,
        'global',
        'user',
      ),
    ]);
  }

  private getMissingConfiguredExtensionItems(
    configuredPathEntries: ConfiguredExtensionPathEntry[],
    resources: ResolvedResource[],
  ): ScoutExtensionListItem[] {
    return getMissingConfiguredResourceEntries(configuredPathEntries, resources).map((entry) => ({
      name: getExtensionDisplayName(entry.path),
      path: entry.path,
      scope: entry.scope,
      sourceInfo: entry.sourceInfo,
      exists: false,
      enabled: true,
    }));
  }

  private getTemplatePath(
    templateId: ScoutExtensionTemplateId,
    scope: ScoutExtensionScope,
  ): string {
    const template = getExtensionTemplate(templateId);
    return path.join(
      scope === 'project' ? this.getProjectExtensionsDir() : this.getGlobalExtensionsDir(),
      template.fileName,
    );
  }

  private getProjectExtensionsDir(): string {
    return path.join(this.cwd, '.scout', 'extensions');
  }

  private getGlobalExtensionsDir(): string {
    return path.join(this.agentDir, 'extensions');
  }

  private canOpenExtensionPath(filePath: string): boolean {
    return isKnownResourcePath(
      filePath,
      this.resolveExtensionResources(),
      this.getKnownExtensionRoots(),
    );
  }

  private getKnownExtensionRoots(): string[] {
    return [this.getProjectExtensionsDir(), this.getGlobalExtensionsDir()].map((item) =>
      path.resolve(item),
    );
  }

  private async reloadAfterPersist(): Promise<{ succeeded: boolean; error?: string }> {
    return await this.persistCoordinator.reloadAfterPersist({
      cancelled: 'Runtime reload cancelled after creating extension',
      failedPrefix: 'Runtime reload failed after creating extension',
    });
  }

  private async pushAfterPersist(reloadSucceeded: boolean): Promise<void> {
    await this.persistCoordinator.pushAfterPersist(reloadSucceeded);
  }
}

function compareExtensionItems(a: ScoutExtensionListItem, b: ScoutExtensionListItem): number {
  return a.path.localeCompare(b.path);
}

function getExtensionDisplayName(filePath: string): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  if (baseName === 'index') {
    return path.basename(path.dirname(filePath));
  }
  return baseName;
}

function toScoutExtensionResourceScope(resource: ResolvedResource): ScoutExtensionResourceScope {
  if (resource.metadata.scope === 'project') return 'project';
  if (resource.metadata.scope === 'user') return 'global';
  return 'temporary';
}

function toScoutExtensionSourceInfo(resource: ResolvedResource): SourceInfo {
  return {
    path: resource.path,
    source: resource.metadata.source,
    scope: resource.metadata.scope,
    origin: resource.metadata.origin,
    baseDir: resource.metadata.baseDir,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  return (await statOrUndefined(filePath)) !== undefined;
}

async function statOrUndefined(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}
