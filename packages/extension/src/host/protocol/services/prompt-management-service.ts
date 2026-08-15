// ============================================================
// Prompt management service — 全局 Prompts 协议入口
// ============================================================

import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { ScoutPromptsSettings } from '@scout-agent/shared';
import type { PromptResourceSnapshot } from '../../../core/prompt-resource-catalog.ts';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { PromptInventoryProjector } from './prompt-management/index.ts';
import { isKnownResourcePath, ResourcePersistCoordinator } from './resource-management/index.ts';
import type { ProtocolPayload, ProtocolResponder } from './types.ts';

export interface PromptManagementProtocolServiceOptions {
  agentDir: string;
  sessionManager: ExtensionSessionCoordinator;
  openTextFile?: (filePath: string) => Promise<void>;
  revealPath?: (filePath: string) => Promise<void>;
  requestCommands: (surface?: ScoutWebviewSurface) => void;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
}

export class PromptManagementProtocolService {
  private readonly globalDir: string;
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly openTextFileCallback?: (filePath: string) => Promise<void>;
  private readonly revealPathCallback?: (filePath: string) => Promise<void>;
  private readonly getPromptResourceSnapshot: () => PromptResourceSnapshot;
  private readonly inventoryProjector: PromptInventoryProjector;
  private readonly persistCoordinator: ResourcePersistCoordinator;

  constructor(options: PromptManagementProtocolServiceOptions) {
    this.globalDir = path.join(options.agentDir, 'prompts');
    this.sessionManager = options.sessionManager;
    this.openTextFileCallback = options.openTextFile;
    this.revealPathCallback = options.revealPath;
    this.getPromptResourceSnapshot = () => options.sessionManager.getPromptResourceSnapshot();
    this.inventoryProjector = new PromptInventoryProjector(
      this.globalDir,
      this.getPromptResourceSnapshot,
    );
    this.persistCoordinator = new ResourcePersistCoordinator({
      sessionManager: options.sessionManager,
      requestCommands: options.requestCommands,
      pushState: options.pushState,
      pushTreeData: options.pushTreeData,
    });
  }

  async requestPrompts(respond: ProtocolResponder): Promise<void> {
    respond({ type: 'prompts_result', settings: await this.getSettings() });
  }

  async refreshPrompts(respond: ProtocolResponder): Promise<void> {
    const runtimeUpdated = await this.sessionManager.refreshPromptResources();
    respond({ type: 'prompts_result', settings: await this.getSettings() });
    await this.persistCoordinator.pushAfterPersist(runtimeUpdated);
  }

  async openPromptFile(
    message: ProtocolPayload<'open_prompt_file'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const filePath = path.resolve(message.path);
    const promptResources = this.getPromptResourceSnapshot().resources.map(
      (resource) => resource.sourceInfo,
    );
    if (!isKnownResourcePath(filePath, promptResources, [this.globalDir])) {
      respond({
        type: 'open_prompt_file_result',
        success: false,
        error: `Prompt file is outside known prompt paths: ${filePath}`,
        path: filePath,
      });
      return;
    }

    try {
      await this.openTextFileCallback?.(filePath);
      respond({ type: 'open_prompt_file_result', success: true, path: filePath });
    } catch (error) {
      respond({
        type: 'open_prompt_file_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: filePath,
      });
    }
  }

  async createPromptTemplate(
    message: ProtocolPayload<'create_prompt_template'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const name = message.name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      respond({
        type: 'create_prompt_template_result',
        success: false,
        error: 'Prompt 名称只能包含字母、数字、下划线和连字符',
      });
      return;
    }

    const filePath = path.join(this.globalDir, `${name}.md`);
    try {
      await mkdir(this.globalDir, { recursive: true });
      await writeFile(filePath, createPromptTemplateContent(), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      respond({
        type: 'create_prompt_template_result',
        success: false,
        error:
          code === 'EEXIST'
            ? `Prompt 已存在：/${name}`
            : error instanceof Error
              ? error.message
              : String(error),
        path: filePath,
      });
      return;
    }

    const reload = await this.persistCoordinator.reloadAfterPersist({
      cancelled: 'Runtime reload cancelled after creating Prompt',
      failedPrefix: 'Runtime reload failed after creating Prompt',
    });
    try {
      await this.openTextFileCallback?.(filePath);
    } catch {
      // 模板已成功创建与加载；打开编辑器失败不回滚文件。
    }
    respond({
      type: 'create_prompt_template_result',
      success: true,
      reloadError: reload.error,
      path: filePath,
    });
    await this.persistCoordinator.pushAfterPersist(reload.succeeded);
  }

  async openPromptsDirectory(respond: ProtocolResponder): Promise<void> {
    try {
      await mkdir(this.globalDir, { recursive: true });
      await this.revealPathCallback?.(this.globalDir);
      respond({ type: 'open_prompts_directory_result', success: true, path: this.globalDir });
    } catch (error) {
      respond({
        type: 'open_prompts_directory_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: this.globalDir,
      });
    }
  }

  private getSettings(): Promise<ScoutPromptsSettings> {
    return this.inventoryProjector.getSettings();
  }
}

function createPromptTemplateContent(): string {
  return `---\ndescription: 描述这个 Prompt 的用途\nargument-hint: '<参数> [可选参数]'\n---\n\n在这里编写提示词。\n\n第一个参数：$1\n全部参数：$ARGUMENTS\n`;
}
