import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScoutBusyState,
  ScoutConfig,
  ScoutCustomModelsSettings,
  ScoutRuntimeSettingsState,
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

function makeBootstrapConfig(): ScoutConfig {
  return {
    models: [],
    defaultModelProvider: 'openai',
    defaultModelId: 'qwen3.7-max',
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

async function resolveInitialSettings(): Promise<void> {
  await resolveCustomModels();
  await resolveRuntimeSettings();
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

    expect(getPostedRequests('request_custom_models').length).toBeGreaterThan(1);
    expect(getPostedRequests('request_runtime_settings').length).toBeGreaterThan(1);

    await resolveInitialSettings();

    expect(screen.queryByText('C:\\Users\\me\\.scout\\agent\\models.json')).not.toBeInTheDocument();
    expect(screen.queryByText('正在读取全局模型配置')).not.toBeInTheDocument();
  });

  it('loads custom models and saves only models.json from the model tab', async () => {
    render(<SettingsApp />);

    expect(getLatestPostedPayload('request_custom_models')).toEqual({
      type: 'request_custom_models',
    });
    expect(getLatestPostedPayload('request_runtime_settings')).toEqual({
      type: 'request_runtime_settings',
    });

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

  it('adds a custom model row from the model management tab', async () => {
    render(<SettingsApp />);
    const settings = makeCustomModelsSettings();
    settings.providers.openai!.models = [];
    await resolveCustomModels(settings);
    await resolveRuntimeSettings();

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

  it('shows inherited enabled defaults and rejects provider-scoped runtime default models before saving', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
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

    await rejectLatestRequest('save_custom_models', '保存协议失败');

    expect(screen.getByText('保存协议失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('uses normalized host runtime settings after a successful save', async () => {
    render(<SettingsApp />);
    await resolveInitialSettings();

    fireEvent.click(screen.getByRole('button', { name: '运行设置' }));
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
