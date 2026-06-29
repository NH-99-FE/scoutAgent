import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { projectProtocolResponsePayload } from '@/bridge/protocol-response-projector';
import { resetProtocolTransport } from '@/bridge/transport-client';
import { useConfigStore } from '@/store/config-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';
import type {
  ScoutBusyState,
  ScoutConfig,
  ScoutProtocolRequest,
  ScoutWebviewState,
} from '@scout-agent/shared';

const postMessage = vi.fn();

function makeConfig(): ScoutConfig {
  return {
    models: [],
    defaultModelProvider: 'openai',
    defaultModelId: 'gpt-test',
    branchSummary: {
      reserveTokens: 0,
      skipPrompt: false,
    },
  };
}

function makeState(): ScoutWebviewState {
  return {
    messages: [],
    isStreaming: false,
    busyState: { kind: 'idle', cancellable: false } as ScoutBusyState,
    modelProvider: 'openai',
    modelId: 'gpt-test',
    thinkingLevel: 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: 'session-1',
    sessionName: '',
    sessionFile: '',
    cwd: '/workspace',
  };
}

function getReadyRequest(): ScoutProtocolRequest {
  const request = postMessage.mock.calls
    .map(([message]) => message as ScoutProtocolRequest)
    .find(
      (message) =>
        message.type === 'protocol_request' &&
        message.service === 'lifecycle' &&
        message.method === 'ready',
    );
  if (!request) throw new Error('ready request was not sent');
  return request;
}

describe('App bootstrap', () => {
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
    window.__SCOUT_WEBVIEW_SURFACE__ = 'chat';
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

  it('does not render the chat surface before bootstrap state arrives', () => {
    render(<App />);

    expect(screen.getByText('Scout 正在启动')).toBeInTheDocument();
    expect(screen.queryByLabelText('随心输入')).not.toBeInTheDocument();

    act(() => {
      projectProtocolResponsePayload({
        type: 'bootstrap_result',
        surface: 'chat',
        config: makeConfig(),
        state: {
          ...makeState(),
          extensionUIRequests: [
            {
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'select',
              title: '危险命令',
              options: ['Yes', 'No'],
              variant: 'danger',
              body: { kind: 'code', text: '/bin/rm -rf tmp' },
            },
          ],
        },
        commands: [],
      });
    });

    expect(screen.getByLabelText('随心输入')).toBeInTheDocument();
    expect(useUiStore.getState().extensionUIRequests).toEqual([
      expect.objectContaining({ id: 'ui-1', method: 'select', variant: 'danger' }),
    ]);
  });

  it('shows the surface skeleton before non-chat surface state arrives', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'tree';

    render(<App />);

    expect(screen.queryByText('Scout 正在启动')).not.toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does not mount non-chat surfaces before bootstrap state arrives', async () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'settings';

    render(<App />);

    expect(screen.queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument();
    expect(
      postMessage.mock.calls.some(([message]) => {
        const payload = (message as { payload?: { type?: string } }).payload;
        return (
          payload?.type === 'request_custom_models' || payload?.type === 'request_runtime_settings'
        );
      }),
    ).toBe(false);

    await act(async () => {
      projectProtocolResponsePayload({
        type: 'bootstrap_result',
        surface: 'settings',
        config: makeConfig(),
        state: makeState(),
        commands: [],
      });
    });

    expect(await screen.findByRole('navigation', { name: '设置分类' })).toBeInTheDocument();
    expect(
      postMessage.mock.calls.some(([message]) => {
        const payload = (message as { payload?: { type?: string } }).payload;
        return (
          payload?.type === 'request_custom_models' || payload?.type === 'request_runtime_settings'
        );
      }),
    ).toBe(true);
  });

  it('shows startup errors before the chat surface mounts', async () => {
    render(<App />);

    act(() => {
      useUiStore.getState().actions.setNotification({
        type: 'notification',
        level: 'error',
        message: '启动失败',
      });
    });

    expect(screen.queryByLabelText('随心输入')).not.toBeInTheDocument();
    expect(await screen.findByText('启动失败')).toBeInTheDocument();
    await waitFor(() => {
      expect(useUiStore.getState().notification).toBeUndefined();
    });
  });

  it('keeps a persistent failed state when bootstrap fails', async () => {
    render(<App />);
    const readyRequest = getReadyRequest();

    act(() => {
      routeExtensionMessage({
        type: 'protocol_response',
        requestId: readyRequest.requestId,
        error: { code: 'handler_failed', message: '启动失败' },
      });
    });

    expect(screen.queryByLabelText('随心输入')).not.toBeInTheDocument();
    expect(screen.getByText('Scout 暂时无法启动')).toBeInTheDocument();
    expect(screen.getByText('启动失败')).toBeInTheDocument();
    expect(useUiStore.getState().bootstrapStatus).toBe('failed');
  });

  it('shows the persistent failed state when a non-chat surface bootstrap fails', async () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'tree';
    render(<App />);
    const readyRequest = getReadyRequest();

    act(() => {
      routeExtensionMessage({
        type: 'protocol_response',
        requestId: readyRequest.requestId,
        error: { code: 'handler_failed', message: '树面板启动失败' },
      });
    });

    expect(screen.getByText('Scout 暂时无法启动')).toBeInTheDocument();
    expect(screen.getByText('树面板启动失败')).toBeInTheDocument();
    expect(useUiStore.getState().bootstrapStatus).toBe('failed');
  });
});
