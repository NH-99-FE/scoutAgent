import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PromptResourceSnapshot } from '../../../../src/core/prompt-resource-catalog.ts';
import { ScoutResourceLoader } from '../../../../src/core/resource-loader.ts';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { PromptManagementProtocolService } from '../../../../src/host/protocol/services/prompt-management-service.ts';

describe('PromptManagementProtocolService', () => {
  let tempDir: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-prompt-management-test-'));
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(agentDir, 'prompts'), { recursive: true });
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it('lists global and extension prompts with global collision precedence', async () => {
    const globalPrompt = path.join(agentDir, 'prompts', 'review.md');
    const extensionPrompt = path.join(tempDir, 'extension-prompts', 'review.md');
    const invalidExtensionPrompt = path.join(tempDir, 'extension-prompts', 'invalid-extension.md');
    const invalidPrompt = path.join(agentDir, 'prompts', 'invalid.md');
    writePrompt(globalPrompt, 'Global review', '<file> [focus]');
    writePrompt(extensionPrompt, 'Extension review');
    fs.writeFileSync(invalidExtensionPrompt, '---\ndescription: [unterminated\n---\nPrompt body');
    fs.writeFileSync(invalidPrompt, '---\ndescription: [unterminated\n---\nPrompt body');
    const loader = new ScoutResourceLoader({ cwd: tempDir, agentDir });
    const resources = await loader.replaceExtensionResources({
      skillPaths: [],
      promptPaths: [{ path: path.dirname(extensionPrompt), extensionPath: '<extension>' }],
    });
    const service = createService({ promptSnapshot: resources.prompts });
    const respond = vi.fn();

    await service.requestPrompts(respond);

    const settings = respond.mock.calls[0]?.[0].settings;
    expect(settings).toMatchObject({ globalDir: path.join(agentDir, 'prompts') });
    expect(settings.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: '/review',
          description: 'Global review',
          argumentHint: '<file> [focus]',
          path: globalPrompt,
          status: 'active',
          sourceKind: 'global',
        }),
        expect.objectContaining({
          command: '/review',
          path: extensionPrompt,
          status: 'shadowed',
          sourceKind: 'extension',
        }),
        expect.objectContaining({ command: '/invalid', path: invalidPrompt, status: 'invalid' }),
        expect.objectContaining({
          command: '/invalid-extension',
          path: invalidExtensionPrompt,
          status: 'invalid',
          sourceKind: 'extension',
        }),
      ]),
    );
    expect(settings.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        collision: expect.objectContaining({
          winnerPath: globalPrompt,
          loserPath: extensionPrompt,
        }),
      }),
    );
    expect(settings.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'warning', path: invalidPrompt }),
    );
    expect(settings.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'warning', path: invalidExtensionPrompt }),
    );
  });

  it('creates a global template, reloads resources, and opens the file', async () => {
    const reload = vi.fn(async () => ({ cancelled: false }));
    const openTextFile = vi.fn(async () => undefined);
    const requestCommands = vi.fn();
    const service = createService({ reload, openTextFile, requestCommands });
    const respond = vi.fn();

    await service.createPromptTemplate({ type: 'create_prompt_template', name: 'review' }, respond);

    const filePath = path.join(agentDir, 'prompts', 'review.md');
    expect(fs.readFileSync(filePath, 'utf8')).toContain("argument-hint: '<参数> [可选参数]'");
    expect(reload).toHaveBeenCalledOnce();
    expect(openTextFile).toHaveBeenCalledWith(filePath);
    expect(requestCommands).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'create_prompt_template_result',
        success: true,
        path: filePath,
      }),
    );
  });

  it('refreshes Prompt resources before returning the latest inventory', async () => {
    const promptPath = path.join(agentDir, 'prompts', 'latest.md');
    writePrompt(promptPath, 'Latest prompt');
    const latestSnapshot = (await new ScoutResourceLoader({ cwd: tempDir, agentDir }).load())
      .prompts;
    let snapshot: PromptResourceSnapshot = {
      resources: [],
      activeTemplates: [],
      diagnostics: [],
    };
    const refreshPromptResources = vi.fn(async () => {
      snapshot = latestSnapshot;
      return true;
    });
    const requestCommands = vi.fn();
    const pushState = vi.fn(async () => undefined);
    const pushTreeData = vi.fn(async () => undefined);
    const service = createService({
      getPromptSnapshot: () => snapshot,
      refreshPromptResources,
      requestCommands,
      pushState,
      pushTreeData,
    });
    const respond = vi.fn();

    await service.refreshPrompts(respond);

    expect(refreshPromptResources).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith({
      type: 'prompts_result',
      settings: expect.objectContaining({
        prompts: [expect.objectContaining({ path: promptPath, status: 'active' })],
      }),
    });
    expect(requestCommands).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledOnce();
    expect(pushTreeData).toHaveBeenCalledOnce();
  });

  function createService(
    options: {
      getPromptSnapshot?: () => PromptResourceSnapshot;
      reload?: () => Promise<{ cancelled: boolean }>;
      refreshPromptResources?: () => Promise<boolean>;
      openTextFile?: (filePath: string) => Promise<void>;
      promptSnapshot?: PromptResourceSnapshot;
      requestCommands?: () => void;
      pushState?: () => Promise<void>;
      pushTreeData?: () => Promise<void>;
    } = {},
  ): PromptManagementProtocolService {
    return new PromptManagementProtocolService({
      agentDir,
      sessionManager: {
        reload: options.reload ?? vi.fn(async () => ({ cancelled: false })),
        refreshPromptResources: options.refreshPromptResources ?? vi.fn(async () => false),
        getPromptResourceSnapshot: vi.fn(
          () =>
            options.getPromptSnapshot?.() ??
            options.promptSnapshot ?? {
              resources: [],
              activeTemplates: [],
              diagnostics: [],
            },
        ),
      } as unknown as ExtensionSessionCoordinator,
      openTextFile: options.openTextFile,
      requestCommands: options.requestCommands ?? vi.fn(),
      pushState: options.pushState ?? vi.fn(async () => undefined),
      pushTreeData: options.pushTreeData ?? vi.fn(async () => undefined),
    });
  }
});

function writePrompt(filePath: string, description: string, argumentHint?: string): void {
  const hint = argumentHint ? `\nargument-hint: '${argumentHint}'` : '';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\ndescription: ${description}${hint}\n---\nPrompt body`);
}
