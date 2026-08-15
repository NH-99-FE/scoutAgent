import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScoutBusyState,
  ScoutConfig,
  ScoutCustomModelsSettings,
  ScoutRuntimeSettingsState,
  ScoutPromptsSettings,
  ScoutSkillsSettings,
  ScoutWebviewState,
} from '@scout-agent/shared';
import App from '@/App';
import { routeProtocolResponse, resetProtocolTransport } from '@/bridge/transport-client';
import { useConfigStore } from '@/store/config-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';
import { SettingsApp } from '@/surfaces/settings/SettingsApp';

const postMessage = vi.fn();

function makeCustomModelsSettings(): ScoutCustomModelsSettings {
  return {
    modelsPath: 'C:\\Users\\me\\.scout\\agent\\models.json',
    providerMetadata: {
      openai: {
        provider: 'openai',
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultApi: 'openai-completions',
        supportedApis: ['openai-completions', 'openai-responses'],
      },
      anthropic: {
        provider: 'anthropic',
        defaultBaseUrl: 'https://api.anthropic.com',
        defaultApi: 'anthropic-messages',
        supportedApis: ['anthropic-messages'],
      },
    },
    providers: {
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-completions',
        models: [
          {
            id: 'qwen3.7-max',
            name: 'qwen3.7-max',
            api: 'openai-completions',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            reasoning: true,
            compat: { supportsDeveloperRole: false },
            input: ['text'],
            contextWindow: 128000,
            maxTokens: 16384,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
        modelOverrides: {},
      },
      anthropic: {
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages',
        models: [],
        modelOverrides: {},
      },
    },
  };
}

function makeRuntimeSettings(): ScoutRuntimeSettingsState {
  return {
    globalSettingsPath: 'C:\\Users\\me\\.scout\\agent\\settings.json',
    projectSettingsPath: 'E:\\scout-test\\.scout\\settings.json',
    global: {
      defaultProvider: 'openai',
      defaultModel: 'qwen3.7-max',
      steeringMode: 'one-at-a-time',
    },
    project: {},
    effective: {
      defaultProvider: 'openai',
      defaultModel: 'qwen3.7-max',
      steeringMode: 'one-at-a-time',
    },
  };
}

function makeSkillsSettings(): ScoutSkillsSettings {
  return {
    projectDir: '/workspace/.scout/skills',
    globalDir: '/home/me/.scout/agent/skills',
    agentsDirs: ['/workspace/.agents/skills'],
    globalEntries: ['../shared-skills'],
    projectEntries: ['./skills/project-skill'],
    configuredPaths: ['/workspace/.scout/skills/project-skill'],
    diagnostics: [],
    skills: [
      {
        name: 'review',
        description: 'Review code changes',
        path: '/workspace/.scout/skills/review/SKILL.md',
        scope: 'project',
        sourceKind: 'project_default',
        sourceRoot: '/workspace/.scout/skills',
        sourceInfo: {
          path: '/workspace/.scout/skills/review/SKILL.md',
          source: 'auto',
          scope: 'project',
          origin: 'top-level',
          baseDir: '/workspace/.scout',
        },
        exists: true,
        enabled: true,
        status: 'active',
        canToggle: true,
      },
    ],
  };
}

function makePromptsSettings(): ScoutPromptsSettings {
  return {
    globalDir: '/home/me/.scout/agent/prompts',
    diagnostics: [],
    prompts: [],
  };
}

function makeBootstrapConfig(): ScoutConfig {
  return {
    models: [],
    defaultModelProvider: 'openai',
    defaultModelId: 'qwen3.7-max',
    defaultToolProfileId: 'develop',
    toolProfiles: [
      {
        id: 'develop',
        name: '开发模式',
        tools: ['read', 'bash', 'edit', 'write'],
        builtin: true,
      },
      {
        id: 'review',
        name: '审查模式',
        tools: ['read', 'grep', 'find', 'ls'],
        builtin: true,
      },
    ],
    branchSummary: {
      reserveTokens: 0,
      skipPrompt: false,
    },
  };
}

function makeBootstrapState(): ScoutWebviewState {
  return {
    messages: [],
    isStreaming: false,
    busyState: { kind: 'idle', cancellable: false } as ScoutBusyState,
    modelProvider: 'openai',
    modelId: 'qwen3.7-max',
    thinkingLevel: 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: 'session-1',
    sessionName: '',
    sessionFile: '',
    cwd: 'E:\\scout-test',
  };
}

function getPostedRequests(type: string): Array<Record<string, unknown>> {
  return postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter((message) => {
      const payload = message.payload as Record<string, unknown> | undefined;
      return message.type === 'protocol_request' && payload?.type === type;
    });
}

function getLatestPostedPayload(type: string): Record<string, unknown> | undefined {
  return getPostedRequests(type).at(-1)?.payload as Record<string, unknown> | undefined;
}

function installImmediateSettingsHost(): void {
  postMessage.mockImplementation((message: unknown) => {
    const request = message as
      | {
          type?: string;
          requestId?: string;
          payload?: { type?: string };
        }
      | undefined;
    if (request?.type !== 'protocol_request' || typeof request.requestId !== 'string') return;

    if (request.payload?.type === 'ready') {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'protocol_response',
            requestId: request.requestId,
            payload: {
              type: 'bootstrap_result',
              surface: 'settings',
              config: makeBootstrapConfig(),
              state: makeBootstrapState(),
              commands: [],
            },
          },
        }),
      );
    }

    if (request.payload?.type === 'request_custom_models') {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'protocol_response',
            requestId: request.requestId,
            payload: { type: 'custom_models_result', settings: makeCustomModelsSettings() },
          },
        }),
      );
    }

    if (request.payload?.type === 'request_runtime_settings') {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'protocol_response',
            requestId: request.requestId,
            payload: { type: 'runtime_settings_result', settings: makeRuntimeSettings() },
          },
        }),
      );
    }

    if (request.payload?.type === 'request_skills') {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'protocol_response',
            requestId: request.requestId,
            payload: { type: 'skills_result', settings: makeSkillsSettings() },
          },
        }),
      );
    }

    if (request.payload?.type === 'request_prompts') {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'protocol_response',
            requestId: request.requestId,
            payload: { type: 'prompts_result', settings: makePromptsSettings() },
          },
        }),
      );
    }
  });
}

async function resolveCustomModels(settings = makeCustomModelsSettings()): Promise<void> {
  const request = getPostedRequests('request_custom_models').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: { type: 'custom_models_result', settings },
    });
  });
}

async function resolveRuntimeSettings(settings = makeRuntimeSettings()): Promise<void> {
  const request = getPostedRequests('request_runtime_settings').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: { type: 'runtime_settings_result', settings },
    });
  });
}

async function resolveSkills(settings = makeSkillsSettings()): Promise<void> {
  const request = getPostedRequests('request_skills').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: { type: 'skills_result', settings },
    });
  });
}

async function resolvePrompts(settings = makePromptsSettings()): Promise<void> {
  const request = getPostedRequests('request_prompts').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: { type: 'prompts_result', settings },
    });
  });
}

async function resolveInitialSettings(): Promise<void> {
  await resolveCustomModels();
}

async function resolveSaveCustomModels(
  settings = makeCustomModelsSettings(),
  success = true,
): Promise<void> {
  const request = getPostedRequests('save_custom_models').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: success
        ? { type: 'save_custom_models_result', success: true, settings }
        : { type: 'save_custom_models_result', success: false, error: '保存失败' },
    });
  });
}

async function resolveSaveRuntimeSettings(
  settings = makeRuntimeSettings(),
  success = true,
): Promise<void> {
  const request = getPostedRequests('save_runtime_settings').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: success
        ? { type: 'save_runtime_settings_result', success: true, settings }
        : { type: 'save_runtime_settings_result', success: false, error: '保存失败' },
    });
  });
}

async function resolveSaveSkills(settings = makeSkillsSettings(), success = true): Promise<void> {
  const request = getPostedRequests('save_skills_settings').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: success
        ? { type: 'save_skills_settings_result', success: true, settings }
        : { type: 'save_skills_settings_result', success: false, error: '保存失败' },
    });
  });
}

async function resolveSaveCustomModelsWithReloadError(message: string): Promise<void> {
  const request = getPostedRequests('save_custom_models').at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      payload: {
        type: 'save_custom_models_result',
        success: true,
        error: message,
        settings: makeCustomModelsSettings(),
      },
    });
  });
}

async function rejectLatestRequest(type: string, message = '协议失败'): Promise<void> {
  const request = getPostedRequests(type).at(-1);
  expect(request).toBeDefined();
  await act(async () => {
    routeProtocolResponse({
      type: 'protocol_response',
      requestId: request!.requestId as string,
      error: { code: 'test_error', message },
    });
  });
}

describe('SettingsApp', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage,
      }),
    });
  });

  beforeEach(() => {
    postMessage.mockClear();
    postMessage.mockImplementation(() => undefined);
    window.__SCOUT_WEBVIEW_SURFACE__ = 'settings';
    useConfigStore.getState().actions.setConfig(makeBootstrapConfig());
  });

  afterEach(() => {
    cleanup();
    resetProtocolTransport();
    delete window.__SCOUT_WEBVIEW_SURFACE__;
    useConfigStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
    useTreeStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
  });

  it('constrains settings content to the internal scroll region', () => {
    render(<SettingsApp />);

    expect(screen.getByRole('main')).toHaveClass('min-h-0', 'overflow-hidden');
    expect(document.querySelector('[data-slot="scroll-area"]')).toHaveClass('min-h-0', 'flex-1');
  });

  it('places Skills as the second settings tab', () => {
    render(<SettingsApp />);

    const labels = Array.from(
      screen.getByRole('navigation', { name: '设置分类' }).querySelectorAll('button'),
      (button) => button.textContent?.trim(),
    );

    expect(labels).toEqual(['模型管理', 'Skills', 'Prompts', '运行设置', '扩展']);
  });

  it('confirms before discarding a dirty settings tab', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.change(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      { target: { value: 'https://proxy.example.test/v1' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/“模型管理”中还有未保存的修改/)).toBeInTheDocument();
    expect(document.querySelector('h1')).toHaveTextContent('模型管理');

    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('https://proxy.example.test/v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }));
    await resolveSkills();

    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument();
    expect(getPostedRequests('request_custom_models')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '模型管理' }));
    expect(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ).toBeInTheDocument();
  });

  it('discards Runtime and Skills drafts locally without reloading from the host', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    fireEvent.change(screen.getByDisplayValue('qwen3.7-max'), {
      target: { value: 'qwen3.7-draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }));
    await resolveSkills();
    expect(getPostedRequests('request_runtime_settings')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Skill path 1'), {
      target: { value: './skills/draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }));
    await resolvePrompts();
    expect(getPostedRequests('request_skills')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    expect(screen.getByDisplayValue('qwen3.7-max')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(screen.getByDisplayValue('./skills/project-skill')).toBeInTheDocument();
  });

  it('does not treat values changed back to their saved baseline as drafts', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    const baseUrl = screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1');
    fireEvent.change(baseUrl, { target: { value: 'https://proxy.example.test/v1' } });
    fireEvent.change(baseUrl, {
      target: { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const defaultModel = screen.getByDisplayValue('qwen3.7-max');
    fireEvent.change(defaultModel, { target: { value: 'qwen3.7-plus' } });
    fireEvent.change(defaultModel, { target: { value: 'qwen3.7-max' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await resolveSkills();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const reviewSwitch = screen.getByRole('switch', { name: '启用 review' });
    fireEvent.click(reviewSwitch);
    fireEvent.click(reviewSwitch);
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));
    await resolvePrompts();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('loads first-run settings through App bootstrap when the host responds immediately', async () => {
    installImmediateSettingsHost();

    render(<App />);

    expect(screen.queryByText('C:\\Users\\me\\.scout\\agent\\models.json')).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue('openai-key')).toBeEnabled();
    expect(screen.queryByText('正在读取全局模型配置')).not.toBeInTheDocument();
  });

  it('loads settings after React StrictMode remounts effects in dev', async () => {
    render(
      <StrictMode>
        <SettingsApp />
      </StrictMode>,
    );

    expect(getPostedRequests('request_custom_models')).toHaveLength(1);
    expect(getPostedRequests('request_runtime_settings')).toHaveLength(0);
    expect(getPostedRequests('request_skills')).toHaveLength(0);
    expect(getPostedRequests('request_prompts')).toHaveLength(0);

    await resolveInitialSettings();

    expect(screen.queryByText('C:\\Users\\me\\.scout\\agent\\models.json')).not.toBeInTheDocument();
    expect(screen.queryByText('正在读取全局模型配置')).not.toBeInTheDocument();
  });

  it('loads custom models and saves only models.json from the model tab', async () => {
    render(<SettingsApp />);

    expect(getLatestPostedPayload('request_custom_models')).toEqual({
      type: 'request_custom_models',
    });
    expect(getPostedRequests('request_runtime_settings')).toHaveLength(0);
    expect(getPostedRequests('request_skills')).toHaveLength(0);
    expect(getPostedRequests('request_prompts')).toHaveLength(0);

    await resolveInitialSettings();

    expect(screen.getByRole('heading', { name: '模型管理' })).toBeInTheDocument();
    expect(screen.queryByText('C:\\Users\\me\\.scout\\agent\\models.json')).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue('qwen3.7-max')).toHaveLength(2);
    expect(screen.getByLabelText('Context Window')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('Context Window')).not.toHaveAttribute('type', 'number');
    fireEvent.click(screen.getAllByRole('button', { name: '高级选项' })[1]!);
    expect(screen.getByLabelText('Cost Input')).toHaveAttribute('inputmode', 'decimal');
    expect(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Image Input' }));
    fireEvent.change(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      {
        target: { value: 'https://proxy.example.test/v1' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const payload = getLatestPostedPayload('save_custom_models');
    expect(payload).toMatchObject({
      type: 'save_custom_models',
      settings: {
        providers: {
          openai: {
            apiKey: 'openai-key',
            models: [
              {
                id: 'qwen3.7-max',
                input: ['text', 'image'],
                baseUrl: 'https://proxy.example.test/v1',
                contextWindow: 128000,
              },
            ],
          },
        },
      },
    });
    expect(getPostedRequests('save_runtime_settings')).toHaveLength(0);
  });

  it('loads each settings tab only when it is first opened', async () => {
    render(<SettingsApp />);

    expect(getPostedRequests('request_custom_models')).toHaveLength(1);
    expect(getPostedRequests('request_skills')).toHaveLength(0);
    await resolveCustomModels();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(getPostedRequests('request_skills')).toHaveLength(1);
    await resolveSkills();

    fireEvent.click(screen.getByRole('button', { name: '模型管理' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));

    expect(getPostedRequests('request_custom_models')).toHaveLength(1);
    expect(getPostedRequests('request_skills')).toHaveLength(1);
  });

  it('does not show a save action for the read-only prompt inventory', async () => {
    render(<SettingsApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));
    await resolvePrompts();

    expect(await screen.findByRole('heading', { name: 'Prompt 模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建 Prompt' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('adds a custom model row from the model management tab', async () => {
    render(<SettingsApp />);
    const settings = makeCustomModelsSettings();
    settings.providers.openai!.models = [];
    await resolveCustomModels(settings);

    fireEvent.click(screen.getAllByRole('button', { name: '添加模型' })[0]!);

    expect(screen.getByRole('heading', { name: '自定义模型 1' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('128000')).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('data-model-id-input', 'true');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('keeps provider advanced JSON settings collapsed until requested', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    expect(screen.queryByText('Model Overrides')).not.toBeInTheDocument();

    const advancedButton = screen.getAllByRole('button', { name: '高级选项' })[0]!;
    expect(advancedButton).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {
      fireEvent.click(advancedButton);
    });

    expect(advancedButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Model Overrides')).toBeInTheDocument();
  });

  it('saves only settings.json from the runtime tab', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    expect(screen.getAllByText('开发模式').length).toBeGreaterThan(0);
    expect(screen.getAllByText('审查模式').length).toBeGreaterThan(0);
    expect(screen.getByText('未设置（开发模式）')).toBeInTheDocument();
    expect(
      screen.queryByText('C:\\Users\\me\\.scout\\agent\\settings.json'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('E:\\scout-test\\.scout\\settings.json')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '全局设置' })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('qwen3.7-max'), {
      target: { value: 'qwen3.7-plus' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getLatestPostedPayload('save_runtime_settings')).toMatchObject({
      type: 'save_runtime_settings',
      scope: 'global',
      patch: {
        operations: [{ op: 'set', path: 'defaultModel', value: 'qwen3.7-plus' }],
      },
    });
    expect(getPostedRequests('save_custom_models')).toHaveLength(0);
  });

  it('preserves an existing project Runtime draft when global settings are saved', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    fireEvent.click(screen.getByRole('button', { name: '当前项目' }));
    fireEvent.change(screen.getByLabelText('Default Model'), {
      target: { value: 'project-draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '全局' }));
    fireEvent.change(screen.getByLabelText('Default Model'), {
      target: { value: 'global-saved' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const saved = makeRuntimeSettings();
    saved.global.defaultModel = 'global-saved';
    saved.effective.defaultModel = 'global-saved';
    await resolveSaveRuntimeSettings(saved);

    fireEvent.click(screen.getByRole('button', { name: '当前项目' }));
    expect(screen.getByLabelText('Default Model')).toHaveValue('project-draft');
  });

  it('pins the project default when project profiles hide the inherited default', async () => {
    render(<SettingsApp />);
    await resolveCustomModels();
    const settings = makeRuntimeSettings();
    settings.global = {
      ...settings.global,
      defaultToolProfile: 'custom-1',
      toolProfiles: [{ id: 'custom-1', name: '全局搜索', tools: ['read', 'grep'] }],
    };
    settings.effective = {
      ...settings.effective,
      defaultToolProfile: 'custom-1',
      toolProfiles: [{ id: 'custom-1', name: '全局搜索', tools: ['read', 'grep'] }],
    };
    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings(settings);
    fireEvent.click(screen.getByRole('button', { name: '当前项目' }));
    expect(screen.getByText('未设置（继承：全局搜索）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getLatestPostedPayload('save_runtime_settings')).toEqual({
      type: 'save_runtime_settings',
      scope: 'project',
      patch: {
        operations: [
          { op: 'set', path: 'defaultToolProfile', value: 'develop' },
          {
            op: 'set',
            path: 'toolProfiles',
            value: [{ id: 'custom-2', name: '自定义模式', tools: ['read'] }],
          },
        ],
      },
    });
  });

  it('shows the inherited builtin tool profile for an unset project override', async () => {
    render(<SettingsApp />);
    await resolveCustomModels();
    const settings = makeRuntimeSettings();
    settings.global = {
      ...settings.global,
      defaultToolProfile: 'review',
    };
    settings.effective = {
      ...settings.effective,
      defaultToolProfile: 'review',
    };
    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings(settings);
    fireEvent.click(screen.getByRole('button', { name: '当前项目' }));

    expect(screen.getByText('未设置（继承：审查模式）')).toBeInTheDocument();
    expect(screen.queryByText('未设置（开发模式）')).not.toBeInTheDocument();
  });

  it('saves only skills settings from the Skills tab', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await resolveSkills();
    expect(screen.getByRole('heading', { name: '额外 Skills 路径' })).toBeInTheDocument();
    expect(screen.getByText('Review code changes')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Skill path 1'), {
      target: { value: './skills/review' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getLatestPostedPayload('save_skills_settings')).toEqual({
      type: 'save_skills_settings',
      scope: 'project',
      entries: ['./skills/review'],
      toggles: [],
    });
    expect(getPostedRequests('save_runtime_settings')).toHaveLength(0);

    const normalized = makeSkillsSettings();
    normalized.projectEntries = ['./skills/review'];
    await resolveSaveSkills(normalized);

    expect(screen.getByDisplayValue('./skills/review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });

  it('preserves an existing project Skills draft when global Skills are saved', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await resolveSkills();
    fireEvent.change(screen.getByLabelText('Skill path 1'), {
      target: { value: './skills/project-draft' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: '保存位置' }));
    fireEvent.click(screen.getByRole('option', { name: '全局' }));
    fireEvent.change(screen.getByLabelText('Skill path 1'), {
      target: { value: '../global-saved' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const saved = makeSkillsSettings();
    saved.globalEntries = ['../global-saved'];
    await resolveSaveSkills(saved);

    fireEvent.click(screen.getByRole('combobox', { name: '保存位置' }));
    fireEvent.click(screen.getByRole('option', { name: '当前项目' }));
    expect(screen.getByDisplayValue('./skills/project-draft')).toBeInTheDocument();
  });

  it('opens resolved skill files from the Skills tab', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await resolveSkills();
    fireEvent.click(screen.getByRole('button', { name: /review/ }));

    expect(getLatestPostedPayload('open_skill_file')).toEqual({
      type: 'open_skill_file',
      path: '/workspace/.scout/skills/review/SKILL.md',
    });
  });

  it('keeps skill enablement toggles as draft until saving the Skills tab', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await resolveSkills();
    const reviewSwitch = screen.getByRole('switch', { name: '启用 review' });
    expect(reviewSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(reviewSwitch);
    expect(screen.queryByDisplayValue('-skills/review')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '启用 review' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(getPostedRequests('set_skill_enabled')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getLatestPostedPayload('save_skills_settings')).toEqual({
      type: 'save_skills_settings',
      scope: 'project',
      entries: ['./skills/project-skill'],
      toggles: [{ path: '/workspace/.scout/skills/review/SKILL.md', enabled: false }],
    });

    const disabled = makeSkillsSettings();
    disabled.projectEntries = ['./skills/project-skill', '-skills/review'];
    disabled.skills[0] = { ...disabled.skills[0]!, enabled: false, status: 'disabled' };
    await resolveSaveSkills(disabled);

    expect(screen.getByRole('switch', { name: '启用 review' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('shows inherited enabled defaults and rejects provider-scoped runtime default models before saving', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    expect(screen.getAllByText('未设置（继承开启）')).toHaveLength(2);
    fireEvent.change(screen.getByDisplayValue('qwen3.7-max'), {
      target: { value: 'openai/qwen3.7-plus' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getPostedRequests('save_runtime_settings')).toHaveLength(0);
    expect(
      screen.getByText('Default Model 只能填写模型 id，不要包含 openai/ 前缀'),
    ).toBeInTheDocument();
  });

  it('keeps model rows mounted while editing editable identity fields', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    const [modelIdInput] = screen.getAllByDisplayValue('qwen3.7-max') as HTMLInputElement[];
    modelIdInput.focus();
    fireEvent.change(modelIdInput, { target: { value: 'qwen3.7-plus' } });

    expect(document.activeElement).toBe(modelIdInput);
    expect(screen.getByDisplayValue('qwen3.7-plus')).toBeInTheDocument();
  });

  it('uses normalized host custom models after a successful save', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    const [modelIdInput] = screen.getAllByDisplayValue('qwen3.7-max') as HTMLInputElement[];
    fireEvent.change(modelIdInput!, {
      target: { value: ' qwen3.7-plus ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const normalized = makeCustomModelsSettings();
    normalized.providers.openai!.models[0] = {
      ...normalized.providers.openai!.models[0]!,
      id: 'qwen3.7-plus',
      name: 'qwen3.7-plus',
    };
    await resolveSaveCustomModels(normalized);

    expect(screen.getAllByDisplayValue('qwen3.7-plus')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });

  it('does not let a save response overwrite newer custom model draft edits', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.change(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      {
        target: { value: 'https://proxy.example.test/v1' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const [modelIdInput] = screen.getAllByDisplayValue('qwen3.7-max') as HTMLInputElement[];
    fireEvent.change(modelIdInput, { target: { value: 'qwen3.7-new' } });

    await resolveSaveCustomModels();

    expect(screen.getByDisplayValue('qwen3.7-new')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('shows reload errors without keeping successfully saved custom models dirty', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.change(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      {
        target: { value: 'https://proxy.example.test/v1' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await resolveSaveCustomModelsWithReloadError(
      'Runtime reload failed after saving settings: reload failed',
    );

    expect(
      screen.getByText('Runtime reload failed after saving settings: reload failed'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });

  it('rejects empty token limit inputs before saving custom models', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.change(screen.getByDisplayValue('128000'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getPostedRequests('save_custom_models')).toHaveLength(0);
    expect(screen.getByText('openai 模型 1 contextWindow 必须大于 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('recovers loading state when loading custom models fails', async () => {
    render(<SettingsApp />);

    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();

    await rejectLatestRequest('request_custom_models', '加载失败');

    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled();
  });

  it('recovers saving state when saving custom models fails at the protocol layer', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.change(
      screen.getByDisplayValue('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      {
        target: { value: 'https://proxy.example.test/v1' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByRole('button', { name: '保存中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skills' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(screen.getByRole('heading', { name: '模型管理' })).toBeInTheDocument();

    await rejectLatestRequest('save_custom_models', '保存协议失败');

    expect(screen.getByText('保存协议失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skills' })).toBeEnabled();
  });

  it('uses normalized host runtime settings after a successful save', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    fireEvent.change(screen.getByDisplayValue('qwen3.7-max'), {
      target: { value: 'qwen3.7-plus' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const normalized = makeRuntimeSettings();
    normalized.global.defaultModel = 'qwen3.7-plus';
    normalized.effective.defaultModel = 'qwen3.7-plus';
    await resolveSaveRuntimeSettings(normalized);

    expect(screen.getByDisplayValue('qwen3.7-plus')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });

  it('keeps the runtime saved indicator scoped to the saved settings target', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
    await resolveRuntimeSettings();
    fireEvent.change(screen.getByDisplayValue('qwen3.7-max'), {
      target: { value: 'qwen3.7-plus' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const normalized = makeRuntimeSettings();
    normalized.global.defaultModel = 'qwen3.7-plus';
    normalized.effective.defaultModel = 'qwen3.7-plus';
    await resolveSaveRuntimeSettings(normalized);

    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '当前项目' }));

    expect(screen.getByRole('heading', { name: '项目设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '全局' }));

    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });
});
