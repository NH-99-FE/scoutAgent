import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProtocolTransport } from '@/bridge/transport-client';
import { ModelStatusMenu } from '@/features/model-menu/ModelStatusMenu';
import { useConfigStore } from '@/store/config-store';
import { useSessionStore } from '@/store/session-store';
import type {
  ScoutBusyState,
  ScoutModelInfo,
  ScoutWebviewState,
  ThinkingLevel,
} from '@scout-agent/shared';

const postMessage = vi.fn();

function makeState(overrides: Partial<ScoutWebviewState> = {}): ScoutWebviewState {
  return {
    messages: [],
    isStreaming: false,
    busyState: { kind: 'idle', cancellable: false } as ScoutBusyState,
    modelProvider: 'openai',
    modelId: 'gpt-5.5',
    thinkingLevel: 'high',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: 'session-1',
    cwd: '/workspace',
    ...overrides,
  };
}

const FULL_REASONING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function makeModel(id: string, name = id, overrides: Partial<ScoutModelInfo> = {}): ScoutModelInfo {
  return {
    provider: 'openai',
    id,
    name,
    supportedThinkingLevels: FULL_REASONING_LEVELS,
    input: ['text'],
    contextWindow: 1000,
    ...overrides,
  };
}
function configureModels(): void {
  useConfigStore.getState().actions.setConfig({
    models: [
      makeModel('gpt-5.5', 'GPT-5.5'),
      makeModel('gpt-5.4', 'GPT-5.4'),
      makeModel('gpt-5.4-mini', 'GPT-5.4-Mini'),
    ],
    defaultModelProvider: 'openai',
    defaultModelId: 'gpt-5.5',
    defaultToolProfileId: 'develop',
    toolProfiles: [],
    branchSummary: { reserveTokens: 100, skipPrompt: false },
  });
  useSessionStore.getState().actions.applyState(makeState());
}

function getLatestPostedPayload(type: string): Record<string, unknown> | undefined {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === 'protocol_request' && message.payload?.type === type)
    .at(-1)?.payload;
}

function openMenu(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: '选择模型和推理强度' }), {
    button: 0,
    ctrlKey: false,
  });
}

describe('ModelStatusMenu', () => {
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
    configureModels();
  });

  afterEach(() => {
    cleanup();
    useConfigStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    resetProtocolTransport();
  });

  it('selects thinking level and expands models before selecting another model', () => {
    render(<ModelStatusMenu />);

    openMenu();

    expect(screen.getByRole('switch', { name: '推理' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: '高' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('menuitemradio', { name: 'GPT-5.4' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: '中' }));
    expect(getLatestPostedPayload('select_thinking')).toEqual({
      type: 'select_thinking',
      session: { sessionId: 'session-1', sessionPath: '' },
      level: 'medium',
    });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'GPT-5.5' }));

    expect(screen.getByText('模型')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="scroll-area"]')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'GPT-5.5' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT-5.4' }));
    expect(getLatestPostedPayload('select_model')).toEqual({
      type: 'select_model',
      session: { sessionId: 'session-1', sessionPath: '' },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });
  });
  it('filters thinking levels to the active model capabilities', () => {
    useConfigStore.getState().actions.setConfig({
      models: [
        makeModel('gpt-limited', 'GPT Limited', {
          supportedThinkingLevels: ['off', 'minimal', 'high'],
        }),
      ],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-limited',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore
      .getState()
      .actions.applyState(makeState({ modelId: 'gpt-limited', thinkingLevel: 'high' }));

    render(<ModelStatusMenu />);
    openMenu();

    expect(screen.getByRole('switch', { name: '推理' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: '高' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('menuitemradio', { name: '关闭' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: '极低' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: '中' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: '超高' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: '极低' }));
    expect(getLatestPostedPayload('select_thinking')).toEqual({
      type: 'select_thinking',
      session: { sessionId: 'session-1', sessionPath: '' },
      level: 'minimal',
    });
  });

  it('keeps reasoning switched off by default when off is supported', () => {
    useConfigStore.getState().actions.setConfig({
      models: [makeModel('gpt-reasoning', 'GPT Reasoning')],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-reasoning',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore
      .getState()
      .actions.applyState(makeState({ modelId: 'gpt-reasoning', thinkingLevel: 'off' }));

    render(<ModelStatusMenu />);
    openMenu();

    expect(screen.getByRole('switch', { name: '推理' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('menuitemradio', { name: '中' })).not.toBeInTheDocument();
  });

  it('remembers opened thinking choices while reopening the menu', () => {
    useConfigStore.getState().actions.setConfig({
      models: [makeModel('gpt-reasoning', 'GPT Reasoning')],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-reasoning',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore
      .getState()
      .actions.applyState(makeState({ modelId: 'gpt-reasoning', thinkingLevel: 'off' }));

    render(<ModelStatusMenu />);
    openMenu();

    fireEvent.click(screen.getByRole('switch', { name: '推理' }));
    expect(screen.getByRole('switch', { name: '推理' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: '中' })).toBeInTheDocument();
    expect(getLatestPostedPayload('select_thinking')).toBeUndefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    openMenu();

    expect(screen.getByRole('switch', { name: '推理' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: '中' })).toBeInTheDocument();
  });

  it('opens thinking choices without selecting a default and turns off with off', () => {
    useConfigStore.getState().actions.setConfig({
      models: [makeModel('gpt-reasoning', 'GPT Reasoning')],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-reasoning',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore
      .getState()
      .actions.applyState(makeState({ modelId: 'gpt-reasoning', thinkingLevel: 'off' }));

    render(<ModelStatusMenu />);
    openMenu();

    fireEvent.click(screen.getByRole('switch', { name: '推理' }));
    expect(getLatestPostedPayload('select_thinking')).toBeUndefined();
    expect(screen.getByRole('menuitemradio', { name: '中' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    fireEvent.click(screen.getByRole('menuitemradio', { name: '中' }));
    expect(getLatestPostedPayload('select_thinking')).toEqual({
      type: 'select_thinking',
      session: { sessionId: 'session-1', sessionPath: '' },
      level: 'medium',
    });

    act(() => {
      useSessionStore
        .getState()
        .actions.applyState(makeState({ modelId: 'gpt-reasoning', thinkingLevel: 'high' }));
    });

    openMenu();
    fireEvent.click(screen.getByRole('switch', { name: '推理' }));
    expect(getLatestPostedPayload('select_thinking')).toEqual({
      type: 'select_thinking',
      session: { sessionId: 'session-1', sessionPath: '' },
      level: 'off',
    });
  });
  it('disables thinking selection when the active model has no reasoning levels', () => {
    useConfigStore.getState().actions.setConfig({
      models: [
        makeModel('gpt-fast', 'GPT Fast', {
          supportedThinkingLevels: ['off'],
        }),
      ],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-fast',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore
      .getState()
      .actions.applyState(makeState({ modelId: 'gpt-fast', thinkingLevel: 'off' }));

    render(<ModelStatusMenu />);
    openMenu();

    expect(screen.getByText('当前模型不支持推理')).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: '高' })).not.toBeInTheDocument();
    expect(getLatestPostedPayload('select_thinking')).toBeUndefined();
  });
  it('does not fall back to the default model when the current model is unavailable', () => {
    useConfigStore.getState().actions.setConfig({
      models: [makeModel('gpt-default', 'GPT Default')],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-default',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore.getState().actions.applyState(
      makeState({
        modelProvider: 'openai',
        modelId: 'gpt-retired',
        thinkingLevel: 'high',
      }),
    );

    render(<ModelStatusMenu />);

    expect(screen.getByText('gpt-retired')).toBeInTheDocument();
    expect(screen.queryByText('GPT Default')).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByText('当前模型不可用')).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: '高' })).not.toBeInTheDocument();
  });
  it('falls back to the configured default model before showing a generic model label', () => {
    useConfigStore.getState().actions.setConfig({
      models: [],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-default',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore.getState().actions.applyState(
      makeState({
        modelProvider: '',
        modelId: '',
      }),
    );

    render(<ModelStatusMenu />);

    expect(screen.getByText('gpt-default')).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'gpt-default' })).toBeInTheDocument();
  });
  it('limits a long expanded model list with shadcn scroll area height', () => {
    useConfigStore.getState().actions.setConfig({
      models: Array.from({ length: 12 }, (_, index) => makeModel(`gpt-option-${index + 1}`)),
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-option-1',
      defaultToolProfileId: 'develop',
      toolProfiles: [],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore.getState().actions.applyState(
      makeState({
        modelProvider: 'openai',
        modelId: 'gpt-option-1',
      }),
    );

    render(<ModelStatusMenu />);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'gpt-option-1' }));

    const scrollArea = document.querySelector<HTMLElement>('[data-slot="scroll-area"]');
    expect(scrollArea).toBeInTheDocument();
    expect(scrollArea).toHaveStyle({ height: '160px' });
  });
  it('starts collapsed each time the menu opens from the trigger', () => {
    render(<ModelStatusMenu />);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'GPT-5.5' }));
    expect(screen.getByText('模型')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    openMenu();

    expect(screen.queryByText('模型')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'GPT-5.4' })).not.toBeInTheDocument();
  });
});
