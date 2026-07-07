import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WEBVIEW_CSS from '../src/index.css?raw';
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
  ScoutChangesReviewModel,
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

function makeChangesReviewModel(): ScoutChangesReviewModel {
  return {
    turnId: 'turn-1',
    viewMode: 'unified',
    files: [
      {
        id: 'file-0',
        path: 'packages/webview/src/App.tsx',
        absolutePath: '/workspace/packages/webview/src/App.tsx',
        external: false,
        additions: 1,
        deletions: 0,
        recordIds: ['review-1'],
        rows: [{ type: 'added', newLineNumber: 1, text: 'export default App;' }],
      },
    ],
    totals: { fileCount: 1, additions: 1, deletions: 0 },
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
    delete window.__SCOUT_CHANGES_REVIEW__;
    document.body.style.removeProperty('height');
    document.body.style.removeProperty('overflow');
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

  it('renders the changes review surface from injected data without lifecycle bootstrap', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    window.__SCOUT_CHANGES_REVIEW__ = makeChangesReviewModel();

    render(<App />);

    expect(screen.getByText('1 个文件已更改')).toBeInTheDocument();
    expect(screen.getByText('packages/webview/src/')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('export default App;')).toBeInTheDocument();
    expect(
      postMessage.mock.calls.some(([message]) => {
        const candidate = message as { service?: string; method?: string };
        return candidate.service === 'lifecycle' && candidate.method === 'ready';
      }),
    ).toBe(false);
  });

  it('renders the changes review pending state without lifecycle bootstrap', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';

    render(<App />);

    expect(screen.getByText('正在生成文件变更')).toBeInTheDocument();
    expect(
      postMessage.mock.calls.some(([message]) => {
        const candidate = message as { service?: string; method?: string };
        return candidate.service === 'lifecycle' && candidate.method === 'ready';
      }),
    ).toBe(false);
  });

  it('hot-updates the changes review surface from host model messages', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';

    render(<App />);
    expect(screen.getByText('正在生成文件变更')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'changes_review_model_update',
            model: makeChangesReviewModel(),
          },
        }),
      );
    });

    expect(screen.queryByText('正在生成文件变更')).not.toBeInTheDocument();
    expect(screen.getByText('1 个文件已更改')).toBeInTheDocument();
    expect(screen.getByText('export default App;')).toBeInTheDocument();
  });

  it('preserves collapsed files by stable path when hot update file ids shift', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    window.__SCOUT_CHANGES_REVIEW__ = makeChangesReviewModel();
    render(<App />);

    fireEvent.click(screen.getByLabelText('Toggle file diff'));
    expect(screen.queryByText('export default App;')).not.toBeInTheDocument();

    const nextModel = makeChangesReviewModel();
    const appFile = {
      ...nextModel.files[0]!,
      id: 'file-1',
    };
    nextModel.files = [
      {
        id: 'file-0',
        path: 'packages/webview/src/other.ts',
        absolutePath: '/workspace/packages/webview/src/other.ts',
        external: false,
        additions: 1,
        deletions: 0,
        recordIds: ['review-2'],
        rows: [{ type: 'added', newLineNumber: 1, text: 'export const other = true;' }],
      },
      appFile,
    ];
    nextModel.totals = { fileCount: 2, additions: 2, deletions: 0 };

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'changes_review_model_update', model: nextModel },
        }),
      );
    });

    expect(screen.getByText('2 个文件已更改')).toBeInTheDocument();
    expect(screen.queryByText('export default App;')).not.toBeInTheDocument();
    expect(screen.getByText('export const other = true;')).toBeInTheDocument();
  });

  it('lets the changes review surface scroll when the host document locks body overflow', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    window.__SCOUT_CHANGES_REVIEW__ = makeChangesReviewModel();
    document.body.style.height = '100vh';
    document.body.style.overflow = 'hidden';

    render(<App />);

    const shell = screen.getByRole('main');
    expect(shell).toHaveClass('bg-tree-background', 'h-screen', 'overflow-y-auto');
    expect(shell).not.toHaveClass('scout-native-scrollbar');
    const topbar = screen.getByText('1 个文件已更改').closest('header');
    expect(topbar).toHaveClass('bg-tree-background');
    const fileHeader = screen.getByText('App.tsx').closest('header');
    expect(fileHeader).toHaveClass('bg-tree-background');
  });

  it('sends changes review panel messages directly to the host webview', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    window.__SCOUT_CHANGES_REVIEW__ = makeChangesReviewModel();

    render(<App />);
    fireEvent.click(screen.getByLabelText('Split diff'));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'changes_review_set_view_mode',
      mode: 'split',
    });
  });

  it('renders paired split diff changes in the same visual row', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    const model = makeChangesReviewModel();
    model.viewMode = 'split';
    const file = model.files[0];
    if (!file) throw new Error('changes review fixture file is missing');
    file.rows = [
      { type: 'removed', oldLineNumber: 1, text: 'const value = 1;' },
      { type: 'added', newLineNumber: 1, text: 'const value = 2;' },
    ];
    window.__SCOUT_CHANGES_REVIEW__ = model;

    render(<App />);

    const removedCode = screen.getByText('const value = 1;');
    const addedCode = screen.getByText('const value = 2;');
    const removedColumn = document.querySelector('[data-split-column="removed"]');
    const addedColumn = document.querySelector('[data-split-column="added"]');
    if (!(removedColumn instanceof HTMLElement)) {
      throw new Error('split diff removed column is missing');
    }
    if (!(addedColumn instanceof HTMLElement))
      throw new Error('split diff added column is missing');
    const addedLineNumber = addedColumn.querySelector(
      '[data-split-line-number-side="added"][data-line-type="added"]',
    );
    const removedLineNumber = removedColumn.querySelector(
      '[data-split-line-number-side="removed"][data-line-type="removed"]',
    );
    if (!addedLineNumber) throw new Error('split diff added gutter is missing');
    if (!removedLineNumber) throw new Error('split diff removed gutter is missing');
    expect(removedColumn).toContainElement(removedCode);
    expect(addedColumn).toContainElement(addedCode);
    const removedCodePane = removedCode.closest('[data-split-code-pane="true"]');
    const addedCodePane = addedCode.closest('[data-split-code-pane="true"]');
    if (!(removedCodePane instanceof HTMLElement)) throw new Error('removed code cell is missing');
    if (!(addedCodePane instanceof HTMLElement)) throw new Error('added code cell is missing');
    expect(removedCode).toHaveClass('scout-review-split-code');
    expect(removedCodePane).toHaveClass('bg-changes-review-removed-muted', 'overflow-hidden');
    expect(removedLineNumber).toHaveClass('border-r-[2px]', 'border-r-tree-background');
    expect(addedLineNumber).toHaveClass(
      'shadow-[inset_4px_0_0_var(--chart-2)]',
      'border-r-[2px]',
      'border-r-tree-background',
    );
    expect(addedCodePane).toHaveClass('bg-changes-review-added-muted', 'overflow-hidden');
  });

  it('keeps split diff chrome continuous while syncing both code scrollbars', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    const model = makeChangesReviewModel();
    model.viewMode = 'split';
    const file = model.files[0];
    if (!file) throw new Error('changes review fixture file is missing');
    const removedLine = `const removedValue = '${'old-'.repeat(60)}';`;
    const addedLine = `const addedValue = '${'new-'.repeat(60)}';`;
    file.rows = [
      {
        type: 'removed',
        oldLineNumber: 1,
        text: removedLine,
      },
      {
        type: 'added',
        newLineNumber: 1,
        text: addedLine,
      },
    ];
    window.__SCOUT_CHANGES_REVIEW__ = model;

    render(<App />);

    const scrollPlane = document.querySelector('[data-review-diff-scroll="split"]');
    const splitDiff = document.querySelector('[data-split-diff="true"]');
    const removedColumn = document.querySelector('[data-split-column="removed"]');
    const removedCodePane = screen.getByText(removedLine).closest('[data-split-code-pane="true"]');
    if (!(scrollPlane instanceof HTMLElement)) throw new Error('diff scroll plane is missing');
    if (!(splitDiff instanceof HTMLElement)) throw new Error('split diff container is missing');
    if (!(removedColumn instanceof HTMLElement))
      throw new Error('split diff removed column is missing');
    if (!(removedCodePane instanceof HTMLElement)) throw new Error('removed code pane is missing');

    expect(scrollPlane).toHaveClass('scout-review-diff-scroll', 'overflow-x-hidden');
    expect(scrollPlane).not.toHaveClass('scout-native-scrollbar');
    expect(splitDiff).toHaveClass(
      'min-w-full',
      'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
      '[--changes-review-split-code-scroll-left:0px]',
    );
    expect(removedColumn).toHaveClass(
      'min-w-0',
      'grid-cols-[var(--changes-review-line-gutter)_minmax(0,1fr)]',
    );
    expect(removedColumn).not.toHaveClass('w-max');
    expect(removedCodePane).toHaveClass('overflow-hidden');
    Object.defineProperty(removedCodePane, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(removedCodePane, 'scrollWidth', { configurable: true, value: 420 });

    fireEvent.wheel(splitDiff, { deltaX: 120, deltaY: 0, shiftKey: true });

    const removedScrollbar = document.querySelector('[data-split-code-scrollbar="removed"]');
    const addedScrollbar = document.querySelector('[data-split-code-scrollbar="added"]');
    if (!(removedScrollbar instanceof HTMLElement)) throw new Error('removed scrollbar is missing');
    if (!(addedScrollbar instanceof HTMLElement)) throw new Error('added scrollbar is missing');

    expect(scrollPlane.scrollLeft).toBe(0);
    expect(splitDiff.style.getPropertyValue('--changes-review-split-code-scroll-left')).toBe(
      '120px',
    );
    expect(removedScrollbar.scrollLeft).toBe(120);
    expect(addedScrollbar.scrollLeft).toBe(120);
    expect(removedScrollbar).not.toHaveClass('scout-native-scrollbar');
    expect(addedScrollbar).not.toHaveClass('scout-native-scrollbar');

    addedScrollbar.scrollLeft = 240;
    fireEvent.scroll(addedScrollbar);

    expect(splitDiff.style.getPropertyValue('--changes-review-split-code-scroll-left')).toBe(
      '240px',
    );
    expect(removedScrollbar.scrollLeft).toBe(240);
  });

  it('renders unified syntax and intraline diff token classes without token backgrounds', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    const model = makeChangesReviewModel();
    const file = model.files[0];
    if (!file) throw new Error('changes review fixture file is missing');
    file.rows = [
      {
        type: 'added',
        newLineNumber: 1,
        text: 'const value = 2;',
        tokens: [
          { text: 'const', syntaxScopes: ['hljs-keyword'] },
          { text: ' value = ' },
          { text: '2', syntaxScopes: ['hljs-number'], diff: 'added' },
          { text: ';' },
        ],
      },
    ];
    window.__SCOUT_CHANGES_REVIEW__ = model;

    render(<App />);

    expect(screen.getByText('const')).toHaveClass('scout-review-token-keyword');
    expect(screen.getByText('2')).toHaveClass(
      'scout-review-token-number',
      'scout-review-token-diff-added',
    );
    expectNoCssRule('.scout-review-token-diff-added', [
      'background: var(--changes-review-token-diff-added);',
    ]);
    expectNoCssRule('.scout-review-token-diff-removed', [
      'background: var(--changes-review-token-diff-removed);',
    ]);
  });

  it('renders split intraline diff token backgrounds inside split code columns', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    const model = makeChangesReviewModel();
    model.viewMode = 'split';
    const file = model.files[0];
    if (!file) throw new Error('changes review fixture file is missing');
    file.rows = [
      {
        type: 'removed',
        oldLineNumber: 1,
        text: 'const value = oldValue;',
        tokens: [
          { text: 'const', syntaxScopes: ['hljs-keyword'] },
          { text: ' value = ' },
          { text: 'oldValue', diff: 'removed' },
          { text: ';' },
        ],
      },
      {
        type: 'added',
        newLineNumber: 1,
        text: 'const value = newValue;',
        tokens: [
          { text: 'const', syntaxScopes: ['hljs-keyword'] },
          { text: ' value = ' },
          { text: 'newValue', diff: 'added' },
          { text: ';' },
        ],
      },
    ];
    window.__SCOUT_CHANGES_REVIEW__ = model;

    render(<App />);

    const removedToken = screen.getByText('oldValue');
    const addedToken = screen.getByText('newValue');
    expect(removedToken).toHaveClass('scout-review-token-diff-removed');
    expect(addedToken).toHaveClass('scout-review-token-diff-added');
    expect(removedToken.closest('.scout-review-split-code')).toBeInstanceOf(HTMLElement);
    expect(addedToken.closest('.scout-review-split-code')).toBeInstanceOf(HTMLElement);
    expectCssRule('.scout-review-split-code .scout-review-token-diff-added', [
      'background: var(--changes-review-token-diff-added);',
    ]);
    expectCssRule('.scout-review-split-code .scout-review-token-diff-removed', [
      'background: var(--changes-review-token-diff-removed);',
    ]);
  });

  it('renders split diff empty sides with hatched placeholders', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';
    const model = makeChangesReviewModel();
    model.viewMode = 'split';
    const file = model.files[0];
    if (!file) throw new Error('changes review fixture file is missing');
    file.rows = [
      { type: 'fold', count: 59 },
      { type: 'removed', oldLineNumber: 60, text: 'const oldValue = 1;' },
    ];
    window.__SCOUT_CHANGES_REVIEW__ = model;

    render(<App />);

    const foldBar = screen.getByText('59 unmodified lines').parentElement;
    if (!(foldBar instanceof HTMLElement)) throw new Error('split diff fold bar is missing');
    expect(foldBar).toHaveClass('bg-muted');
    const foldGutter = document.querySelector('[data-split-fold-gutter-side="removed"]');
    const addedFoldContent = document.querySelector('[data-split-fold-content-side="added"]');
    if (!(foldGutter instanceof HTMLElement)) throw new Error('split diff fold gutter is missing');
    if (!(addedFoldContent instanceof HTMLElement)) {
      throw new Error('split diff added fold content is missing');
    }
    expect(foldGutter).toHaveClass('border-r-tree-background', 'border-r-[2px]', 'rounded-l-[7px]');
    expect(addedFoldContent).toHaveClass('rounded-r-[7px]');
    const splitDiff = document.querySelector('[data-split-diff="true"]');
    if (!(splitDiff instanceof HTMLElement)) throw new Error('split diff container is missing');
    expect(splitDiff).toHaveClass('grid-cols-[minmax(0,1fr)_minmax(0,1fr)]');
    expect(splitDiff).toHaveClass('min-w-full');
    const emptySide = document.querySelector('[data-split-buffer-side="added"]');
    if (!(emptySide instanceof HTMLElement)) throw new Error('split diff added buffer is missing');
    expect(emptySide).toHaveAttribute('data-split-buffer-size', '1');
    expect(emptySide).toHaveClass(
      'col-span-2',
      'bg-[var(--changes-review-empty-split-bg)]',
      '[background-image:var(--changes-review-empty-split-pattern)]',
      '[background-size:10px_10px]',
    );
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

    expect(
      await screen.findByRole('navigation', { name: '设置分类' }, { timeout: 5000 }),
    ).toBeInTheDocument();
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

function expectCssRule(selector: string, declarations: string[]): void {
  const matchingRule = findCssRuleBodies(selector).some((body) =>
    declarations.every((declaration) => body.includes(declaration)),
  );
  expect(matchingRule).toBe(true);
}

function expectNoCssRule(selector: string, declarations: string[]): void {
  const matchingRule = findCssRuleBodies(selector).some((body) =>
    declarations.every((declaration) => body.includes(declaration)),
  );
  expect(matchingRule).toBe(false);
}

function findCssRuleBodies(selector: string): string[] {
  const bodies: string[] = [];
  let bodyStart = WEBVIEW_CSS.indexOf('{');
  while (bodyStart >= 0) {
    const bodyEnd = WEBVIEW_CSS.indexOf('}', bodyStart);
    if (bodyEnd < 0) break;
    const previousRuleEnd = WEBVIEW_CSS.lastIndexOf('}', bodyStart - 1);
    const selectorText = WEBVIEW_CSS.slice(previousRuleEnd + 1, bodyStart).trim();
    const selectors = selectorText.split(',').map((candidate) => candidate.trim());
    if (selectors.includes(selector)) {
      bodies.push(WEBVIEW_CSS.slice(bodyStart + 1, bodyEnd));
    }
    bodyStart = WEBVIEW_CSS.indexOf('{', bodyEnd + 1);
  }
  return bodies;
}
