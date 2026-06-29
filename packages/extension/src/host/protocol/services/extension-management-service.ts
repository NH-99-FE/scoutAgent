// ============================================================
// Extension management service — Settings 扩展入口与文件管理
// ============================================================

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ScoutExtensionListItem,
  ScoutExtensionTemplateInfo,
  ScoutExtensionsSettings,
  ScoutExtensionScope,
  ScoutExtensionTemplateId,
} from '@scout-agent/shared';
import type { ConfigManager } from '../../../config-manager.ts';
import {
  discoverExtensionsInDir,
  resolveExtensionEntries,
  type DiscoveredExtensionEntry,
} from '../../../core/extensions/index.ts';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { getExtensionTemplate, listExtensionTemplates } from './extension-templates.ts';
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

// ---------- Service ----------

export class ExtensionManagementProtocolService {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly configManager: ConfigManager;
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly openTextFileCallback?: (filePath: string) => Promise<void>;
  private readonly pushConfig: (surface?: ScoutWebviewSurface) => void;
  private readonly requestCommandsCallback: (surface?: ScoutWebviewSurface) => void;
  private readonly pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;

  constructor(options: ExtensionManagementProtocolServiceOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this.configManager = options.configManager;
    this.sessionManager = options.sessionManager;
    this.openTextFileCallback = options.openTextFile;
    this.pushConfig = options.pushConfig;
    this.requestCommandsCallback = options.requestCommands;
    this.pushState = options.pushState;
    this.pushTreeData = options.pushTreeData;
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
    const configuredPaths = this.configManager
      .getExtensionPaths()
      .map((item) => path.resolve(item));
    const extensions = await this.listExtensions(projectDir, globalDir, configuredPaths);
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

  private async listExtensions(
    projectDir: string,
    globalDir: string,
    configuredPaths: string[],
  ): Promise<ScoutExtensionListItem[]> {
    const items = [
      ...this.listDirectoryExtensions(projectDir, 'project'),
      ...this.listDirectoryExtensions(globalDir, 'global'),
    ];
    for (const configuredPath of configuredPaths) {
      items.push(...(await this.listConfiguredExtension(configuredPath)));
    }
    return dedupeExtensions(items);
  }

  private listDirectoryExtensions(
    dir: string,
    scope: ScoutExtensionListItem['scope'],
  ): ScoutExtensionListItem[] {
    return discoverExtensionsInDir(dir)
      .map((entry) => this.toExtensionListItem(entry, scope))
      .sort(compareExtensionItems);
  }

  private async listConfiguredExtension(configuredPath: string): Promise<ScoutExtensionListItem[]> {
    const stat = await statOrUndefined(configuredPath);
    if (!stat) {
      return [
        {
          name: path.basename(configuredPath),
          path: configuredPath,
          scope: 'configured',
          exists: false,
        },
      ];
    }
    if (stat.isDirectory()) {
      const entries =
        resolveExtensionEntries(configuredPath) ?? discoverExtensionsInDir(configuredPath);
      return entries
        .map((entry) => this.toExtensionListItem(entry, 'configured'))
        .sort(compareExtensionItems);
    }
    return [
      {
        name: path.basename(configuredPath, path.extname(configuredPath)),
        path: configuredPath,
        scope: 'configured',
        exists: true,
      },
    ];
  }

  private toExtensionListItem(
    entry: DiscoveredExtensionEntry,
    scope: ScoutExtensionListItem['scope'],
  ): ScoutExtensionListItem {
    return {
      name: getExtensionDisplayName(entry),
      path: entry.path,
      scope,
      exists: true,
    };
  }

  private getTemplatePath(
    templateId: ScoutExtensionTemplateId,
    scope: Exclude<ScoutExtensionScope, 'configured'>,
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
    return this.getKnownExtensionRoots().some((root) => isPathInside(filePath, root));
  }

  private getKnownExtensionRoots(): string[] {
    return [
      this.getProjectExtensionsDir(),
      this.getGlobalExtensionsDir(),
      ...this.configManager.getExtensionPaths(),
    ].map((item) => path.resolve(item));
  }

  private async reloadAfterPersist(): Promise<{ succeeded: boolean; error?: string }> {
    try {
      const result = await this.sessionManager.reload();
      if (result.cancelled) {
        return { succeeded: false, error: 'Runtime reload cancelled after creating extension' };
      }
      return { succeeded: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        succeeded: false,
        error: `Runtime reload failed after creating extension: ${message}`,
      };
    }
  }

  private async pushAfterPersist(reloadSucceeded: boolean): Promise<void> {
    this.pushConfig();
    if (reloadSucceeded) {
      this.requestCommandsCallback();
      await this.pushState();
      await this.pushTreeData();
    }
  }
}

function dedupeExtensions(items: ScoutExtensionListItem[]): ScoutExtensionListItem[] {
  const seen = new Set<string>();
  const result: ScoutExtensionListItem[] = [];
  for (const item of items) {
    const key = path.resolve(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function compareExtensionItems(a: ScoutExtensionListItem, b: ScoutExtensionListItem): number {
  return a.path.localeCompare(b.path);
}

function getExtensionDisplayName(entry: DiscoveredExtensionEntry): string {
  const baseName = path.basename(entry.path, path.extname(entry.path));
  if (baseName === 'index') {
    return path.basename(entry.baseDir);
  }
  return baseName;
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

function isPathInside(filePath: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
