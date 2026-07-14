import {
  act,
  cleanup,
  fireEvent as testingFireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { projectTaskHistoryResult as routeTaskHistoryResponse } from '@/bridge/protocol-response-projector';
import { resetProtocolTransport } from '@/bridge/transport-client';
import { AppNotificationToaster } from '@/components/common/AppNotificationToaster';
import { ChatApp } from '@/surfaces/chat/ChatApp';
import {
  MAX_COMPOSER_IMAGE_BYTES,
  MAX_COMPOSER_IMAGE_COUNT,
} from '@/features/composer/model/composer-images';
import { useConfigStore } from '@/store/config-store';
import {
  getComposerImageObjectUrl,
  registerComposerImageFile,
} from '@/store/composer-image-registry';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import { EMPTY_COMPOSER_DOCUMENT, getComposerPlainText } from '@/store/composer-document';
import type { ComposerImageDescriptor } from '@/store/composer-store';
import { useConversationStore } from '@/store/conversation-store';
import { useRuntimeOverlayStore } from '@/store/runtime-overlay-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useUiStore } from '@/store/ui-store';
import type {
  ScoutBusyState,
  ScoutCommandInfo,
  ScoutImageContent,
  ScoutMessage,
  ScoutProtocolResponsePayload,
  ScoutTaskItem,
  ScoutWebviewState,
  SourceInfo,
} from '@scout-agent/shared';

const postMessage = vi.fn();
const fireEvent = {
  ...testingFireEvent,
  change: (element: Element, eventInit?: { target?: { value?: unknown } }) => {
    const value = eventInit?.target?.value;
    if (element instanceof HTMLElement && element.hasAttribute('data-lexical-editor')) {
      if (element.getAttribute('contenteditable') === 'true' && typeof value === 'string') {
        typeComposerText(element.getAttribute('aria-label') ?? '', value);
      }
      return true;
    }
    return testingFireEvent.change(element, eventInit);
  },
};
const TEST_IMAGE: ScoutImageContent = {
  type: 'image',
  data: 'aW1hZ2U=',
  mimeType: 'image/png',
};
let nextTestObjectUrlId = 0;
const createObjectUrl = vi.fn((file: File) => {
  nextTestObjectUrlId += 1;
  return `blob:${file.name}:${nextTestObjectUrlId}`;
});
const revokeObjectUrl = vi.fn();

function makeComposerImageDescriptor(
  overrides: { file?: File; mimeType?: string; name?: string } = {},
): ComposerImageDescriptor {
  const mimeType = overrides.mimeType ?? 'image/png';
  const file =
    overrides.file ?? new File(['image'], overrides.name ?? 'image.png', { type: mimeType });
  return registerComposerImageFile(file, file.type || mimeType);
}

const TEST_SOURCE_INFO: SourceInfo = {
  path: '<test>',
  source: 'test',
  scope: 'temporary',
  origin: 'top-level',
};
const intersectionObservers: MockIntersectionObserver[] = [];
const resizeObserverCallbacks = new Set<ResizeObserverCallback>();

class MockIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '';
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    intersectionObservers.push(this);
  }

  trigger(isIntersecting = true): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class TriggerableResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObserverCallbacks.add(callback);
  }

  disconnect = vi.fn(() => {
    resizeObserverCallbacks.delete(this.callback);
  });
}

function flushResizeObservers(): void {
  act(() => {
    for (const callback of Array.from(resizeObserverCallbacks)) {
      callback([], {} as ResizeObserver);
    }
  });
}

function makeState(
  messages: ScoutMessage[],
  overrides: Partial<
    Pick<
      ScoutWebviewState,
      | 'isStreaming'
      | 'busyState'
      | 'queueState'
      | 'sessionId'
      | 'sessionName'
      | 'sessionFile'
      | 'modelProvider'
      | 'modelId'
      | 'thinkingLevel'
      | 'parentSessionPath'
      | 'forkPointEntryId'
    >
  > = {},
): ScoutWebviewState {
  return {
    messages,
    isStreaming: overrides.isStreaming ?? false,
    busyState: overrides.busyState ?? ({ kind: 'idle', cancellable: false } as ScoutBusyState),
    queueState: overrides.queueState,
    modelProvider: overrides.modelProvider ?? 'openai',
    modelId: overrides.modelId ?? 'gpt-test',
    thinkingLevel: overrides.thinkingLevel ?? 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: overrides.sessionId ?? 'session-1',
    sessionName: overrides.sessionName ?? '检查未提交更改',
    sessionFile: overrides.sessionFile,
    parentSessionPath: overrides.parentSessionPath,
    forkPointEntryId: overrides.forkPointEntryId,
    cwd: '/workspace',
  };
}

function makeUserMessages(count: number): ScoutMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: 'user',
    content: `message ${index}`,
    timestamp: index + 1,
  }));
}

function setConversationViewportScrollMetrics(
  viewport: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    viewport.scrollTop = options.top ?? viewport.scrollTop;
  });
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    scrollTop: { configurable: true, value: metrics.scrollTop, writable: true },
    scrollTo: {
      configurable: true,
      value: scrollTo,
    },
  });
  return scrollTo;
}

function getLatestSearchTaskMessage() {
  const messages = postMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        message.type === 'protocol_request' && message.payload?.type === 'request_task_history',
    );
  return messages.at(-1) as
    | {
        type: 'protocol_request';
        payload: {
          type: 'request_task_history';
          query: string;
          limit?: number;
          offset?: number;
          purpose?: string;
        };
        requestId: string;
      }
    | undefined;
}

function routeTaskHistoryResult(
  queryToken: string,
  tasks: ScoutTaskItem[],
  overrides: Partial<{
    query: string;
    offset: number;
    hasMore: boolean;
    nextOffset: number;
  }> = {},
): void {
  routeTaskHistoryResponse(
    {
      type: 'task_history_result',
      query: overrides.query ?? '',
      purpose: 'panel',
      tasks,
      offset: overrides.offset ?? 0,
      hasMore: overrides.hasMore ?? false,
      nextOffset: overrides.nextOffset ?? tasks.length,
    },
    queryToken,
  );
}

function getPostedProtocolRequests(payloadType: string) {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message) => message.type === 'protocol_request' && message.payload?.type === payloadType,
    ) as Array<{ requestId: string; payload: Record<string, unknown> }>;
}

function getLatestPostedProtocolRequest(payloadType: string) {
  return getPostedProtocolRequests(payloadType).at(-1);
}

function getPostedControlMessages(type: string) {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === type);
}

function expectPostedPayload(payloadType: string, payload: Record<string, unknown>): void {
  expect(getLatestPostedProtocolRequest(payloadType)?.payload).toEqual(payload);
}

function getHistoryQueryToken(): string | undefined {
  return useTaskStore.getState().historyQueryToken;
}

function routeProtocolResult(
  request: { requestId: string } | undefined,
  payload: ScoutProtocolResponsePayload,
): void {
  if (!request) return;
  routeExtensionMessage({
    type: 'protocol_response',
    requestId: request.requestId,
    payload,
  });
}

function routeProtocolError(
  request: { requestId: string } | undefined,
  message = 'Protocol failed',
): void {
  if (!request) return;
  routeExtensionMessage({
    type: 'protocol_response',
    requestId: request.requestId,
    error: { code: 'handler_failed', message },
  });
}

function makeCommand(
  name: string,
  source: ScoutCommandInfo['source'],
  description?: string,
): ScoutCommandInfo {
  return {
    name,
    description,
    source,
    sourceInfo: TEST_SOURCE_INFO,
  };
}

function routeCommands(commands: ScoutCommandInfo[]): void {
  act(() => {
    routeExtensionMessage({
      type: 'commands_update',
      commands,
    });
  });
}

function routeDetailState(overrides: Partial<ScoutWebviewState> = {}): void {
  act(() => {
    routeExtensionMessage({
      type: 'state_update',
      state: makeState([{ role: 'user', content: 'hello', timestamp: 1 }], overrides),
    });
  });
}

function typeComposerText(label: string, value: string): HTMLElement {
  const sessionId =
    label === '随心输入' ? HOME_COMPOSER_SESSION_ID : useSessionStore.getState().sessionId;
  act(() => useComposerStore.getState().actions.setText(sessionId, value));
  const editor = screen.getByLabelText(label);
  const range = document.createRange();
  range.selectNodeContents(editor.querySelector('p') ?? editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.focus(editor);
  testingFireEvent(document, new Event('selectionchange'));
  return editor;
}

function moveComposerCaretToStart(editor: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(editor.querySelector('p') ?? editor);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  testingFireEvent(document, new Event('selectionchange'));
  testingFireEvent.pointerUp(editor);
}

function expectComposerText(label: string, value: string): void {
  const sessionId =
    label === '随心输入' ? HOME_COMPOSER_SESSION_ID : useSessionStore.getState().sessionId;
  const document =
    useComposerStore.getState().documentBySessionId[sessionId] ?? EMPTY_COMPOSER_DOCUMENT;
  expect(getComposerPlainText(document)).toBe(value);
}

function makeImageClipboardData(files: File[]): DataTransfer {
  return {
    files,
    getData: () => '',
    items: files.map((file) => ({
      getAsFile: () => file,
      kind: 'file',
      type: file.type,
    })),
  } as unknown as DataTransfer;
}

function makeTextClipboardData(text: string): DataTransfer {
  return {
    files: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items: [],
    types: ['text/plain'],
  } as unknown as DataTransfer;
}

function pasteComposerText(editor: HTMLElement, text: string): void {
  const originalClipboardEvent = globalThis.ClipboardEvent;
  class TestClipboardEvent extends Event {
    readonly clipboardData: DataTransfer;

    constructor(type: string, clipboardData: DataTransfer) {
      super(type, { bubbles: true, cancelable: true });
      this.clipboardData = clipboardData;
    }
  }
  Object.defineProperty(globalThis, 'ClipboardEvent', {
    configurable: true,
    value: TestClipboardEvent,
  });

  try {
    act(() => {
      testingFireEvent(editor, new TestClipboardEvent('paste', makeTextClipboardData(text)));
    });
  } finally {
    if (originalClipboardEvent) {
      Object.defineProperty(globalThis, 'ClipboardEvent', {
        configurable: true,
        value: originalClipboardEvent,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'ClipboardEvent');
    }
  }
}

const ANIMATED_GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x01, 0x00, 0x00, 0x02, 0x00, 0x3b,
]);

function makeAnimatedGifFile(name = 'animated.gif'): File {
  return new File([ANIMATED_GIF_BYTES], name, { type: 'image/gif' });
}

function makeAnimatedWebpFile(name = 'animated.webp'): File {
  return new File(
    [
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
        0x58, 0x0a, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    ],
    name,
    { type: 'image/webp' },
  );
}

function installDeferredFileReader() {
  const originalFileReader = globalThis.FileReader;
  const readers: Array<{ complete: (dataUrl: string) => void; fail: () => void }> = [];

  class DeferredFileReader {
    error: DOMException | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    result: string | ArrayBuffer | null = null;

    readAsDataURL = vi.fn(() => {
      readers.push({
        complete: (dataUrl) => {
          this.result = dataUrl;
          this.onload?.({} as ProgressEvent<FileReader>);
        },
        fail: () => {
          this.error = new DOMException('read failed', 'NotReadableError');
          this.onerror?.({} as ProgressEvent<FileReader>);
        },
      });
    });
  }

  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    value: DeferredFileReader,
  });

  return {
    readers,
    restore: () => {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        value: originalFileReader,
      });
    },
  };
}

describe('ChatApp', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage,
      }),
    });
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: MockIntersectionObserver,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: TriggerableResizeObserver,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
  });

  beforeEach(() => {
    nextTestObjectUrlId = 0;
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    intersectionObservers.length = 0;
    resizeObserverCallbacks.clear();
    postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
    useConfigStore.getState().actions.reset();
    useComposerStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useRuntimeOverlayStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
    resetProtocolTransport();
  });

  it('renders the task home and starts a new session with composer text', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '中文回答' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expectPostedPayload('new_session_message', {
      type: 'new_session_message',
      text: '中文回答',
    });
    expectComposerText('随心输入', '');
  });

  it('applies the task home tool profile to the new session without changing the hidden session', () => {
    useConfigStore.getState().actions.setConfig({
      models: [],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-test',
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
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore.setState({
      activeToolSelection: { kind: 'profile', profileId: 'review' },
    });
    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '工具模式' })).toHaveAttribute('title', '开发模式');
    fireEvent.pointerDown(screen.getByRole('button', { name: '工具模式' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitemradio', { name: '审查模式' }));
    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '检查未提交更改' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expect(getPostedProtocolRequests('set_tool_profile')).toHaveLength(0);
    expectPostedPayload('new_session_message', {
      type: 'new_session_message',
      text: '检查未提交更改',
      toolProfileId: 'review',
    });
  });

  it('excludes the current session runtime-only custom profile from the task home menu', () => {
    useConfigStore.getState().actions.setConfig({
      models: [],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-test',
      defaultToolProfileId: 'develop',
      toolProfiles: [
        {
          id: 'develop',
          name: '开发模式',
          tools: ['read', 'bash', 'edit', 'write'],
          builtin: true,
        },
        {
          id: 'search-only',
          name: '只搜索',
          tools: ['read', 'grep'],
          builtin: false,
        },
        {
          id: 'review',
          name: '审查模式',
          tools: ['read', 'grep', 'find', 'ls'],
          builtin: true,
        },
      ],
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    });
    useSessionStore.setState({
      activeToolSelection: { kind: 'custom', toolNames: ['read'] },
    });
    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '工具模式' })).toHaveAttribute('title', '开发模式');
    fireEvent.pointerDown(screen.getByRole('button', { name: '工具模式' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.queryByRole('menuitemradio', { name: '自定义' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: '开发模式' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: '审查模式' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: '只搜索' })).toBeInTheDocument();
  });

  it('starts a new session from the task home send button', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '按钮发送' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expectPostedPayload('new_session_message', {
      type: 'new_session_message',
      text: '按钮发送',
    });
    expectComposerText('随心输入', '');
  });

  it('opens settings actions from the header menu', () => {
    render(<ChatApp />);

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scout 设置' }));

    expectPostedPayload('open_settings_panel', { type: 'open_settings_panel' });

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '导入会话' }));

    expectPostedPayload('pick_import_session', { type: 'pick_import_session' });
    routeProtocolResult(getLatestPostedProtocolRequest('pick_import_session'), {
      type: 'import_session_result',
      success: false,
      error: 'cancelled',
    });
    expect(useUiStore.getState().notification).toBeUndefined();
  });

  it('shows extension notifications in the chat surface', async () => {
    routeDetailState();
    render(
      <>
        <ChatApp />
        <AppNotificationToaster />
      </>,
    );

    act(() => {
      routeExtensionMessage({
        type: 'notification',
        level: 'warning',
        message: '当前没有可压缩的上下文',
      });
    });

    expect(await screen.findByText('当前没有可压缩的上下文')).toBeInTheDocument();
    await waitFor(() => {
      expect(useUiStore.getState().notification).toBeUndefined();
    });
  });

  it('opens slash commands and filters them by the typed query', () => {
    routeCommands([
      makeCommand('settings', 'builtin', 'Open Scout settings'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
      makeCommand('review', 'prompt', 'Review pending changes'),
      makeCommand('model', 'builtin', 'Change the active model'),
      makeCommand('continue', 'builtin', 'Continue the current response'),
    ]);
    routeDetailState();
    render(<ChatApp />);

    typeComposerText('要求后续变更', '/');

    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /压缩/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /model/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /continue/ })).not.toBeInTheDocument();

    typeComposerText('要求后续变更', '/co');

    expect(screen.getByRole('option', { name: /压缩/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /review/ })).not.toBeInTheDocument();
  });

  it('opens the add menu for at mention and inserts selected file references', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '@');

    const menu = screen.getByRole('listbox', { name: '添加内容' });
    expect(within(menu).getByText('添加')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('option', { name: '文件 / 图片' }));

    const request = getLatestPostedProtocolRequest('pick_composer_content');
    expect(request?.payload).toEqual({
      type: 'pick_composer_content',
      selectionKind: 'file',
    });
    expectComposerText('随心输入', '@');
    act(() => {
      routeProtocolResult(request, {
        type: 'composer_content_pick_result',
        selections: [
          {
            type: 'reference',
            item: {
              id: 'packages/webview/src/App.tsx',
              kind: 'file',
              path: 'packages/webview/src/App.tsx',
              label: 'App.tsx',
              description: 'packages/webview/src',
            },
          },
          {
            type: 'reference',
            item: {
              id: 'packages/webview/src/main.tsx',
              kind: 'file',
              path: 'packages/webview/src/main.tsx',
              label: 'main.tsx',
              description: 'packages/webview/src',
            },
          },
        ],
      });
    });

    expect(
      await screen.findByLabelText('已选择文件：packages/webview/src/App.tsx'),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText('已选择文件：packages/webview/src/main.tsx'),
    ).toBeInTheDocument();
    expect(
      useComposerStore.getState().documentBySessionId[HOME_COMPOSER_SESSION_ID]?.segments,
    ).toEqual([
      {
        reference: {
          fileKind: 'file',
          id: 'packages/webview/src/App.tsx',
          kind: 'file',
          label: 'App.tsx',
          path: 'packages/webview/src/App.tsx',
        },
        type: 'reference',
      },
      { text: ' ', type: 'text' },
      {
        reference: {
          fileKind: 'file',
          id: 'packages/webview/src/main.tsx',
          kind: 'file',
          label: 'main.tsx',
          path: 'packages/webview/src/main.tsx',
        },
        type: 'reference',
      },
      { text: ' ', type: 'text' },
    ]);

    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('new_session_message')?.payload).toEqual({
        type: 'new_session_message',
        text: '@packages/webview/src/App.tsx @packages/webview/src/main.tsx',
        document: {
          segments: [
            {
              reference: {
                fileKind: 'file',
                id: 'packages/webview/src/App.tsx',
                kind: 'file',
                label: 'App.tsx',
                path: 'packages/webview/src/App.tsx',
              },
              type: 'reference',
            },
            { text: ' ', type: 'text' },
            {
              reference: {
                fileKind: 'file',
                id: 'packages/webview/src/main.tsx',
                kind: 'file',
                label: 'main.tsx',
                path: 'packages/webview/src/main.tsx',
              },
              type: 'reference',
            },
            { text: ' ', type: 'text' },
          ],
        },
      });
    });
  });

  it('opens the at mention add menu from the composer add button', async () => {
    render(<ChatApp />);
    typeComposerText('随心输入', '查看这些内容');

    fireEvent.click(screen.getByRole('button', { name: '添加文件、文件夹或图片' }));

    const menu = await screen.findByRole('listbox', { name: '添加内容' });
    expect(within(menu).getByRole('option', { name: '文件 / 图片' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('option', { name: '文件夹' }));
    expect(getLatestPostedProtocolRequest('pick_composer_content')?.payload).toEqual({
      type: 'pick_composer_content',
      selectionKind: 'directory',
    });
    expectComposerText('随心输入', '查看这些内容');
  });

  it('adds an image selected from the composer add menu as an attachment', async () => {
    render(<ChatApp />);
    typeComposerText('随心输入', '查看截图');

    fireEvent.click(screen.getByRole('button', { name: '添加文件、文件夹或图片' }));
    fireEvent.click(
      within(await screen.findByRole('listbox', { name: '添加内容' })).getByRole('option', {
        name: '文件 / 图片',
      }),
    );
    const request = getLatestPostedProtocolRequest('pick_composer_content');
    act(() => {
      routeProtocolResult(request, {
        type: 'composer_content_pick_result',
        selections: [
          {
            type: 'image',
            fileName: 'first.png',
            image: TEST_IMAGE,
          },
          {
            type: 'image',
            fileName: 'second.png',
            image: TEST_IMAGE,
          },
        ],
      });
    });

    expect(await screen.findByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '预览图片 2' })).toBeInTheDocument();
    expectComposerText('随心输入', '查看截图');
  });

  it('does not remove a stale at range when the document changes during image validation', async () => {
    render(<ChatApp />);
    typeComposerText('随心输入', '@');

    fireEvent.click(
      within(screen.getByRole('listbox', { name: '添加内容' })).getByRole('option', {
        name: '文件 / 图片',
      }),
    );
    const request = getLatestPostedProtocolRequest('pick_composer_content');
    act(() => {
      routeProtocolResult(request, {
        type: 'composer_content_pick_result',
        selections: [{ type: 'image', fileName: 'image.png', image: TEST_IMAGE }],
      });
      useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, '继续编辑后的内容');
    });

    expect(await screen.findByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    expectComposerText('随心输入', '继续编辑后的内容');
  });

  it('applies mixed file references before asynchronous image validation finishes', async () => {
    let resolveImageBytes!: (value: ArrayBuffer) => void;
    const arrayBufferSpy = vi.spyOn(File.prototype, 'arrayBuffer').mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveImageBytes = resolve;
        }),
    );

    try {
      render(<ChatApp />);
      typeComposerText('随心输入', '@');
      fireEvent.click(
        within(screen.getByRole('listbox', { name: '添加内容' })).getByRole('option', {
          name: '文件 / 图片',
        }),
      );
      const request = getLatestPostedProtocolRequest('pick_composer_content');
      act(() => {
        routeProtocolResult(request, {
          type: 'composer_content_pick_result',
          selections: [
            {
              type: 'reference',
              item: {
                id: 'src/agent.ts',
                kind: 'file',
                path: 'src/agent.ts',
                label: 'agent.ts',
                description: 'src',
              },
            },
            {
              type: 'image',
              fileName: 'animated.gif',
              image: {
                type: 'image',
                data: btoa(String.fromCharCode(...ANIMATED_GIF_BYTES)),
                mimeType: 'image/gif',
              },
            },
          ],
        });
      });

      expect(await screen.findByLabelText('已选择文件：src/agent.ts')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '预览图片 1' })).not.toBeInTheDocument();

      act(() => {
        resolveImageBytes(new Uint8Array(ANIMATED_GIF_BYTES).buffer);
      });
      await waitFor(() => {
        expect(useUiStore.getState().notification?.message).toBe(
          '已忽略 1 张动画图片，暂不支持发送动画',
        );
      });
      expect(await screen.findByLabelText('已选择文件：src/agent.ts')).toBeInTheDocument();
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });

  it('keeps the at trigger when a selected animated image is rejected', async () => {
    render(<ChatApp />);
    typeComposerText('随心输入', '@');

    fireEvent.click(
      within(screen.getByRole('listbox', { name: '添加内容' })).getByRole('option', {
        name: '文件 / 图片',
      }),
    );
    const request = getLatestPostedProtocolRequest('pick_composer_content');
    act(() => {
      routeProtocolResult(request, {
        type: 'composer_content_pick_result',
        selections: [
          {
            type: 'image',
            fileName: 'animated.gif',
            image: {
              type: 'image',
              data: btoa(String.fromCharCode(...ANIMATED_GIF_BYTES)),
              mimeType: 'image/gif',
            },
          },
        ],
      });
    });

    await waitFor(() => {
      expect(useUiStore.getState().notification).toEqual({
        type: 'notification',
        level: 'warning',
        message: '已忽略 1 张动画图片，暂不支持发送动画',
      });
    });
    expectComposerText('随心输入', '@');
    expect(screen.queryByRole('button', { name: '预览图片 1' })).not.toBeInTheDocument();
  });

  it('searches project paths after at mention content and selects a directory result', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '');
    pasteComposerText(editor, '@agent');

    expect(await screen.findByRole('status', { name: '文件搜索' })).toHaveTextContent('搜索中');
    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('request_file_mentions')).toBeDefined();
    });
    const request = getLatestPostedProtocolRequest('request_file_mentions');
    expect(request?.payload).toEqual({
      type: 'request_file_mentions',
      query: 'agent',
      limit: 50,
    });
    act(() => {
      routeProtocolResult(request, {
        type: 'file_mentions_result',
        query: 'agent',
        items: [
          {
            id: 'packages/agent',
            kind: 'directory',
            path: 'packages/agent',
            label: 'agent',
            description: 'packages',
          },
          {
            id: 'packages/agent/src/agent.ts',
            kind: 'file',
            path: 'packages/agent/src/agent.ts',
            label: 'agent.ts',
            description: 'packages/agent/src',
          },
        ],
      });
    });

    expectComposerText('随心输入', '@agent');
    expect(editor).toHaveTextContent('@agent');
    const menu = await screen.findByRole('listbox', { name: '文件搜索' });
    const directoryOption = within(menu).getAllByRole('option')[0];
    expect(directoryOption).toHaveTextContent('agent');
    expect(directoryOption).toHaveAttribute('aria-selected', 'true');
    expect(directoryOption.querySelector('.lucide-folder')).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(await screen.findByLabelText('已选择文件夹：packages/agent')).toBeInTheDocument();
    expect(
      useComposerStore.getState().documentBySessionId[HOME_COMPOSER_SESSION_ID]?.segments,
    ).toEqual([
      {
        reference: {
          fileKind: 'directory',
          id: 'packages/agent',
          kind: 'file',
          label: 'agent',
          path: 'packages/agent',
        },
        type: 'reference',
      },
      { text: ' ', type: 'text' },
    ]);

    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('new_session_message')?.payload).toEqual({
        type: 'new_session_message',
        text: '@packages/agent',
        document: {
          segments: [
            {
              reference: {
                fileKind: 'directory',
                id: 'packages/agent',
                kind: 'file',
                label: 'agent',
                path: 'packages/agent',
              },
              type: 'reference',
            },
            { text: ' ', type: 'text' },
          ],
        },
      });
    });
  });

  it('searches project files after pasting an at mention', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '');
    pasteComposerText(editor, '@agent');

    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('request_file_mentions')?.payload).toEqual({
        type: 'request_file_mentions',
        query: 'agent',
        limit: 50,
      });
    });
    expectComposerText('随心输入', '@agent');
  });

  it('shows an empty state when project file search has no matches', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '');
    pasteComposerText(editor, '@missing-file');

    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('request_file_mentions')).toBeDefined();
    });
    const request = getLatestPostedProtocolRequest('request_file_mentions');
    act(() => {
      routeProtocolResult(request, {
        type: 'file_mentions_result',
        query: 'missing-file',
        items: [],
      });
    });

    expectComposerText('随心输入', '@missing-file');
    expect(editor).toHaveTextContent('@missing-file');
    expect(await screen.findByRole('status', { name: '文件搜索' })).toHaveTextContent('无结果');

    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('new_session_message')?.payload).toEqual({
        type: 'new_session_message',
        text: '@missing-file',
      });
    });
  });

  it('distinguishes unavailable file search from an empty result', async () => {
    render(<ChatApp />);
    pasteComposerText(typeComposerText('随心输入', ''), '@agent');

    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('request_file_mentions')).toBeDefined();
    });
    const request = getLatestPostedProtocolRequest('request_file_mentions');
    act(() => {
      routeProtocolResult(request, {
        type: 'file_mentions_result',
        query: 'agent',
        items: [],
        error: '文件搜索不可用：fd 未安装且自动下载失败',
      });
    });

    expect(await screen.findByRole('status', { name: '文件搜索' })).toHaveTextContent(
      '文件搜索不可用：fd 未安装且自动下载失败',
    );
  });

  it('submits an unmatched mention when Enter is pressed while search is loading', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '');
    pasteComposerText(editor, '@pending-file');

    expect(await screen.findByRole('status', { name: '文件搜索' })).toHaveTextContent('搜索中');
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('new_session_message')?.payload).toEqual({
        type: 'new_session_message',
        text: '@pending-file',
      });
    });
  });

  it('closes file search when the caret leaves the mention token', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '');
    pasteComposerText(editor, 'prefix @agent');
    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('request_file_mentions')).toBeDefined();
    });
    const request = getLatestPostedProtocolRequest('request_file_mentions');
    act(() => {
      routeProtocolResult(request, {
        type: 'file_mentions_result',
        query: 'agent',
        items: [
          {
            id: 'src/agent.ts',
            kind: 'file',
            path: 'src/agent.ts',
            label: 'agent.ts',
            description: 'src',
          },
        ],
      });
    });
    expect(await screen.findByRole('option', { name: /agent\.ts/ })).toBeInTheDocument();

    moveComposerCaretToStart(editor);

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: '文件搜索' })).not.toBeInTheDocument();
    });
    expectComposerText('随心输入', 'prefix @agent');
  });

  it('cancels the previous project file search when the mention query changes', async () => {
    render(<ChatApp />);
    const editor = typeComposerText('随心输入', '');
    pasteComposerText(editor, '@agent');
    await waitFor(() => {
      expect(getLatestPostedProtocolRequest('request_file_mentions')).toBeDefined();
    });
    const firstRequest = getLatestPostedProtocolRequest('request_file_mentions');

    pasteComposerText(editor, '-runtime');

    await waitFor(() => {
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === 'protocol_cancel' && message.requestId === firstRequest?.requestId,
        ),
      ).toBe(true);
      expect(getLatestPostedProtocolRequest('request_file_mentions')?.payload).toEqual({
        type: 'request_file_mentions',
        query: 'agent-runtime',
        limit: 50,
      });
    });
  });

  it('hides session-bound builtin slash commands on the task home', () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
      makeCommand('fork', 'builtin', 'Create a branch'),
      makeCommand('review', 'prompt', 'Review pending changes'),
    ]);
    render(<ChatApp />);

    typeComposerText('随心输入', '/');

    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /会话树/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /压缩/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /分叉/ })).not.toBeInTheDocument();
  });

  it('hides extension slash commands while the current session is streaming', () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('deploy', 'extension', 'Run extension command'),
      makeCommand('review', 'prompt', 'Review pending changes'),
      makeCommand('docs', 'skill', 'Use docs skill'),
    ]);
    routeDetailState({ isStreaming: true });
    render(<ChatApp />);

    typeComposerText('要求后续变更', '/');

    expect(screen.getByRole('option', { name: /会话树/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /docs/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /deploy/ })).not.toBeInTheDocument();
  });

  it('groups skill slash commands below other commands', () => {
    routeCommands([
      makeCommand('handoff', 'skill', 'Create a handoff'),
      makeCommand('review', 'prompt', 'Review pending changes'),
      makeCommand('docs', 'skill', 'Use docs skill'),
    ]);
    render(<ChatApp />);

    typeComposerText('随心输入', '/');

    const menu = screen.getByRole('listbox', { name: 'Slash commands' });
    expect(within(menu).getByText('技能')).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['reviewReview pending changes', 'handoffCreate a handoff', 'docsUse docs skill']);
  });

  it('selects slash commands with the keyboard without sending the message', async () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('review', 'prompt', 'Review pending changes'),
    ]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expectComposerText('随心输入', '/review '));
    expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
  });

  it('selects slash commands with pointer activation', async () => {
    routeCommands([makeCommand('review', 'prompt', 'Review pending changes')]);
    render(<ChatApp />);
    typeComposerText('随心输入', '/');

    const option = screen.getByRole('option', { name: /review/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    await waitFor(() => expectComposerText('随心输入', '/review '));
    expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
  });

  it('does not handle tab while slash commands are open', () => {
    routeCommands([makeCommand('tree', 'builtin', 'Open the conversation tree')]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    fireEvent.keyDown(textarea, { key: 'Tab' });

    expectComposerText('随心输入', '/');
    expect(getPostedProtocolRequests('open_tree_panel')).toHaveLength(0);
  });

  it('closes slash commands when pressing outside the floating panel', async () => {
    routeCommands([makeCommand('tree', 'builtin', 'Open the conversation tree')]);
    render(<ChatApp />);
    typeComposerText('随心输入', '/');

    expect(await screen.findByLabelText('Slash commands')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByLabelText('Slash commands')).not.toBeInTheDocument();
    });
  });

  it('closes fork candidates when pressing outside the floating panel', async () => {
    routeCommands([makeCommand('fork', 'builtin', 'Create a branch')]);
    routeDetailState();
    render(<ChatApp />);
    typeComposerText('要求后续变更', '/');

    fireEvent.click(screen.getByRole('option', { name: /分叉/ }));
    expect(await screen.findByLabelText('Fork candidates')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByLabelText('Fork candidates')).not.toBeInTheDocument();
    });
  });

  it('ignores fork candidate responses for another session', async () => {
    routeCommands([makeCommand('fork', 'builtin', 'Create a branch')]);
    routeDetailState({ sessionId: 'session-1' });
    render(<ChatApp />);
    typeComposerText('要求后续变更', '/');

    let prefetchRequest = getLatestPostedProtocolRequest('request_fork_candidates');
    await waitFor(() => {
      prefetchRequest = getLatestPostedProtocolRequest('request_fork_candidates');
      expect(prefetchRequest).toBeDefined();
    });
    expect(prefetchRequest?.payload).toEqual({
      type: 'request_fork_candidates',
      sessionId: 'session-1',
    });

    act(() => {
      routeProtocolResult(prefetchRequest, {
        type: 'fork_candidates_result',
        sessionId: 'session-old',
        candidates: [{ entryId: 'old-user', text: 'old session prompt' }],
      });
    });

    fireEvent.click(screen.getByRole('option', { name: /分叉/ }));
    expect(screen.queryByText('old session prompt')).not.toBeInTheDocument();

    const requests = getPostedProtocolRequests('request_fork_candidates');
    const forkPanelRequest = requests.at(-1);
    expect(requests).toHaveLength(2);
    act(() => {
      routeProtocolResult(forkPanelRequest, {
        type: 'fork_candidates_result',
        sessionId: 'session-1',
        candidates: [{ entryId: 'current-user', text: 'current session prompt' }],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('current session prompt')).toBeInTheDocument();
    });
  });

  it('refreshes fork candidates when the current branch gains a user message', async () => {
    routeCommands([makeCommand('fork', 'builtin', 'Create a branch')]);
    routeDetailState({ sessionId: 'session-1' });
    render(<ChatApp />);
    typeComposerText('要求后续变更', '/');

    let firstRequest = getLatestPostedProtocolRequest('request_fork_candidates');
    await waitFor(() => {
      firstRequest = getLatestPostedProtocolRequest('request_fork_candidates');
      expect(firstRequest).toBeDefined();
    });
    act(() => {
      routeProtocolResult(firstRequest, {
        type: 'fork_candidates_result',
        sessionId: 'session-1',
        candidates: [{ entryId: 'user-1', text: 'first prompt' }],
      });
    });

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState(
          [
            { role: 'user', content: 'hello', entryId: 'user-1', timestamp: 1 },
            { role: 'user', content: 'new prompt', entryId: 'user-2', timestamp: 2 },
          ],
          { sessionId: 'session-1' },
        ),
      });
    });

    const requestsBeforeReopen = getPostedProtocolRequests('request_fork_candidates').length;
    typeComposerText('要求后续变更', '/');
    fireEvent.click(screen.getByRole('option', { name: /分叉/ }));
    await waitFor(() => {
      expect(getPostedProtocolRequests('request_fork_candidates').length).toBeGreaterThan(
        requestsBeforeReopen,
      );
    });

    const refreshRequest = getLatestPostedProtocolRequest('request_fork_candidates');
    act(() => {
      routeProtocolResult(refreshRequest, {
        type: 'fork_candidates_result',
        sessionId: 'session-1',
        candidates: [
          { entryId: 'user-1', text: 'first prompt' },
          { entryId: 'user-2', text: 'new prompt' },
        ],
      });
    });

    await waitFor(() => {
      expect(
        within(screen.getByRole('listbox', { name: 'Fork candidates' })).getByText('new prompt'),
      ).toBeInTheDocument();
    });
  });

  it('resets slash command highlight to the first item when reopening from input', async () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
    ]);
    routeDetailState();
    render(<ChatApp />);
    const textarea = typeComposerText('要求后续变更', '/');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /压缩/ })).toHaveAttribute('aria-selected', 'true');

    typeComposerText('要求后续变更', '');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
    typeComposerText('要求后续变更', '/');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /会话树/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('executes supported builtin slash commands and clears the slash token', async () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
    ]);
    routeDetailState();
    render(<ChatApp />);

    let textarea = typeComposerText('要求后续变更', '/tree');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expectPostedPayload('open_tree_panel', { type: 'open_tree_panel' });
    await waitFor(() => expectComposerText('要求后续变更', ''));

    textarea = typeComposerText('要求后续变更', '/compact');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expectPostedPayload('compact', { type: 'compact', customInstructions: undefined });
    await waitFor(() => expectComposerText('要求后续变更', ''));
  });

  it('closes slash commands for arguments and escape while respecting composing input', () => {
    routeCommands([makeCommand('review', 'prompt', 'Review pending changes')]);
    render(<ChatApp />);
    typeComposerText('随心输入', '/review ');

    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();

    let textarea = typeComposerText('随心输入', '/');
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    fireEvent.keyUp(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();

    textarea = typeComposerText('随心输入', '/');
    fireEvent.keyDown(textarea, { key: 'Process' });
    expectComposerText('随心输入', '/');
    expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
  });

  it('keeps suggestions open when Escape belongs to an IME composition', () => {
    routeCommands([makeCommand('review', 'prompt', 'Review pending changes')]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    fireEvent.keyDown(textarea, { isComposing: true, key: 'Escape' });

    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
  });

  it('prevents duplicate new session submits while creation is pending', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '只创建一次' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    const newSessionMessages = getPostedProtocolRequests('new_session_message');
    expect(newSessionMessages).toHaveLength(1);
    expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();
  });

  it('clears new session pending state when the protocol request fails', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '会失败的新会话' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    const newSessionMessage = getLatestPostedProtocolRequest('new_session_message');
    expectComposerText('随心输入', '');

    act(() => {
      routeProtocolError(newSessionMessage, 'new session failed');
    });

    expect(useUiStore.getState().newSessionPending).toBe(false);
    expect(useUiStore.getState().chatView).toBe('home');
    expectComposerText('随心输入', '会失败的新会话');
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();
  });

  it('starts a new session with composer images', async () => {
    useComposerStore
      .getState()
      .actions.addImages(HOME_COMPOSER_SESSION_ID, [makeComposerImageDescriptor()]);

    render(<ChatApp />);
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    await waitFor(() => {
      expectPostedPayload('new_session_message', {
        type: 'new_session_message',
        text: '',
        images: [TEST_IMAGE],
      });
    });
  });

  it('previews composer images in an overlay', async () => {
    const image = makeComposerImageDescriptor({
      name: 'preview-image.png',
    });
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [image]);

    render(<ChatApp />);

    const previewButton = screen.getByRole('button', { name: '预览图片 1' });
    previewButton.focus();
    fireEvent.click(previewButton);

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '图片预览' })).toHaveAttribute(
      'src',
      getComposerImageObjectUrl(image),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭预览' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    await waitFor(() => {
      expectPostedPayload('download_image', {
        type: 'download_image',
        data: TEST_IMAGE.data,
        mimeType: TEST_IMAGE.mimeType,
        fileName: 'preview-image.png',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '放大图片' }));
    expect(screen.getByText('125%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(previewButton).toHaveFocus();
    });
  });

  it('keeps many composer images in a hidden horizontal scroll tray', () => {
    useComposerStore.getState().actions.addImages(
      HOME_COMPOSER_SESSION_ID,
      Array.from({ length: 8 }, (_, index) =>
        makeComposerImageDescriptor({ name: `many-${index}.png` }),
      ),
    );

    const { container } = render(<ChatApp />);

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]');
    expect(viewport).toHaveAttribute('data-scout-nested-scroll', 'horizontal');
    expect(viewport).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
    expect(container.querySelector('.flex-nowrap')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass(
      '[&_[data-slot=scroll-area-scrollbar]]:hidden',
    );
    expect(screen.getByRole('button', { name: '预览图片 8' })).toBeInTheDocument();
  });

  it('releases composer image object URLs when removing images', () => {
    const image = makeComposerImageDescriptor({ name: 'remove-me.png' });
    const objectUrl = getComposerImageObjectUrl(image);
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [image]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '移除图片 1' }));

    expect(revokeObjectUrl).toHaveBeenCalledWith(objectUrl);
    expect(screen.queryByRole('button', { name: '预览图片 1' })).not.toBeInTheDocument();
  });

  it('warns and ignores unsupported or oversized composer images', async () => {
    render(<ChatApp />);
    const textarea = screen.getByLabelText('随心输入');
    const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });
    const oversizedImage = new File([new Uint8Array(MAX_COMPOSER_IMAGE_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    const unsupportedFile = new File(['plain text'], 'note.txt', { type: 'text/plain' });

    fireEvent.paste(textarea, {
      clipboardData: makeImageClipboardData([pastedImage, oversizedImage, unsupportedFile]),
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '预览图片 2' })).not.toBeInTheDocument();
    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'warning',
      message: '已忽略 1 个不支持的图片文件；已忽略 1 张超过 2MB 的图片',
    });
  });

  it('warns and only accepts images within the composer image count limit', async () => {
    useComposerStore.getState().actions.addImages(
      HOME_COMPOSER_SESSION_ID,
      Array.from({ length: MAX_COMPOSER_IMAGE_COUNT - 1 }, (_, index) =>
        makeComposerImageDescriptor({ name: `existing-${index}.png` }),
      ),
    );

    render(<ChatApp />);
    const textarea = screen.getByLabelText('随心输入');
    const pastedImages = Array.from(
      { length: 3 },
      (_, index) => new File([`image ${index}`], `image-${index}.png`, { type: 'image/png' }),
    );

    fireEvent.paste(textarea, {
      clipboardData: makeImageClipboardData(pastedImages),
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: `预览图片 ${MAX_COMPOSER_IMAGE_COUNT}` }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: `预览图片 ${MAX_COMPOSER_IMAGE_COUNT + 1}` }),
    ).not.toBeInTheDocument();
    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'warning',
      message: `最多只能添加 ${MAX_COMPOSER_IMAGE_COUNT} 张图片`,
    });
  });

  it('does not read image bytes after composer image slots are exhausted', async () => {
    useComposerStore.getState().actions.addImages(
      HOME_COMPOSER_SESSION_ID,
      Array.from({ length: MAX_COMPOSER_IMAGE_COUNT }, (_, index) =>
        makeComposerImageDescriptor({ name: `existing-${index}.png` }),
      ),
    );

    render(<ChatApp />);
    const textarea = screen.getByLabelText('随心输入');
    const overflowImage = makeAnimatedGifFile('overflow.gif');
    const readBytes = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    Object.defineProperty(overflowImage, 'arrayBuffer', {
      configurable: true,
      value: readBytes,
    });

    fireEvent.paste(textarea, {
      clipboardData: makeImageClipboardData([overflowImage]),
    });

    await waitFor(() => {
      expect(useUiStore.getState().notification).toEqual({
        type: 'notification',
        level: 'warning',
        message: `最多只能添加 ${MAX_COMPOSER_IMAGE_COUNT} 张图片`,
      });
    });
    expect(readBytes).not.toHaveBeenCalled();
  });

  it('sends static WebP images without transcoding', async () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    const textarea = screen.getByLabelText('要求后续变更');
    const webpImage = new File(['webp image'], 'static.webp', { type: 'image/webp' });

    fireEvent.paste(textarea, {
      clipboardData: makeImageClipboardData([webpImage]),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: '看 WebP' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expectPostedPayload('user_message', {
        type: 'user_message',
        text: '看 WebP',
        deliverAs: undefined,
        images: [{ type: 'image', data: 'd2VicCBpbWFnZQ==', mimeType: 'image/webp' }],
      });
    });
  });

  it('warns and ignores animated GIF and WebP images', async () => {
    render(<ChatApp />);
    const textarea = screen.getByLabelText('随心输入');

    fireEvent.paste(textarea, {
      clipboardData: makeImageClipboardData([makeAnimatedGifFile(), makeAnimatedWebpFile()]),
    });

    await waitFor(() => {
      expect(useUiStore.getState().notification).toEqual({
        type: 'notification',
        level: 'warning',
        message: '已忽略 2 张动画图片，暂不支持发送动画',
      });
    });
    expect(screen.queryByRole('button', { name: '预览图片 1' })).not.toBeInTheDocument();
  });

  it('clears the home draft and shows the new session after creation succeeds', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '开始新的任务' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([], {
          sessionId: 'session-new',
          sessionName: '新会话',
          sessionFile: '/sessions/session-new.jsonl',
        }),
      });
      const newSessionMessage = getLatestPostedProtocolRequest('new_session_message');
      routeProtocolResult(newSessionMessage, {
        type: 'new_session_result',
        success: true,
      });
      routeExtensionMessage({
        type: 'agent_event',
        event: {
          type: 'message_start',
          messageId: 'session-new:message:1',
          message: { role: 'user', content: '开始新的任务', timestamp: 1 },
        },
      });
    });

    expect(screen.getByText('开始新的任务')).toBeInTheDocument();
    expectComposerText('要求后续变更', '');
  });

  it('keeps the home draft when clicking new session on the task home', () => {
    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '准备开始的新任务' },
    });
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '新会话' }));

    expectComposerText('随心输入', '准备开始的新任务');
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });

  it('opens a task with the session path as operation target', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /检查未提交更改/ }));

    expectPostedPayload('open_task', {
      type: 'open_task',
      taskId: 'task-1',
      sessionPath: '/sessions/session-1.jsonl',
      cwdOverride: undefined,
    });
  });

  it('clears open task pending state when the protocol request fails', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /检查未提交更改/ }));
    const openTaskMessage = getLatestPostedProtocolRequest('open_task');

    act(() => {
      routeProtocolError(openTaskMessage, 'open task failed');
    });

    expect(useUiStore.getState().openingTaskSessionPath).toBeUndefined();
    expect(useUiStore.getState().chatView).toBe('home');
  });

  it('returns to the parent session through the shared open-session flow', () => {
    routeDetailState({
      sessionFile: '/sessions/fork.jsonl',
      parentSessionPath: '/sessions/source.jsonl',
    });

    render(<ChatApp />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '返回原会话' }));

    expectPostedPayload('restore_session', {
      type: 'restore_session',
      sessionId: '',
      sessionPath: '/sessions/source.jsonl',
    });
    expect(useUiStore.getState().openingTaskSessionPath).toBe('/sessions/source.jsonl');
    expect(useUiStore.getState().chatView).toBe('home');
  });

  it('exports the current session from the detail more menu', () => {
    routeDetailState({ sessionFile: '/sessions/current.jsonl' });

    render(<ChatApp />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '导出会话' }));

    const exportMessage = getLatestPostedProtocolRequest('export_session');
    expect(exportMessage?.payload).toEqual({ type: 'export_session', format: 'jsonl' });

    act(() => {
      routeProtocolResult(exportMessage, {
        type: 'export_session_result',
        success: true,
        path: '/workspace/export.jsonl',
      });
    });

    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'success',
      message: '会话已导出：/workspace/export.jsonl',
    });
  });

  it('renames the current session from the detail more menu', () => {
    routeDetailState({
      sessionFile: '/sessions/current.jsonl',
      sessionName: '设计对话重命名方案',
    });

    render(<ChatApp />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名对话' }));

    const input = screen.getByRole('textbox', { name: '对话标题' });
    expect(input).toHaveValue('设计对话重命名方案');

    fireEvent.change(input, { target: { value: '新的对话标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const renameMessage = getLatestPostedProtocolRequest('set_session_name');
    expect(renameMessage?.payload).toEqual({ type: 'set_session_name', name: '新的对话标题' });

    act(() => {
      routeProtocolResult(renameMessage, {
        type: 'set_session_name_result',
        success: true,
      });
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
          sessionFile: '/sessions/current.jsonl',
          sessionName: '新的对话标题',
        }),
      });
    });

    expect(screen.queryByRole('dialog', { name: '重命名对话' })).not.toBeInTheDocument();
    expect(screen.getByText('新的对话标题')).toBeInTheDocument();
  });

  it('clears rename pending state when the rename request envelope fails', () => {
    routeDetailState({
      sessionFile: '/sessions/current.jsonl',
      sessionName: '设计对话重命名方案',
    });

    render(<ChatApp />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名对话' }));

    fireEvent.change(screen.getByRole('textbox', { name: '对话标题' }), {
      target: { value: '新的对话标题' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    act(() => {
      routeProtocolError(getLatestPostedProtocolRequest('set_session_name'), 'rename failed');
    });

    expect(screen.getByRole('dialog', { name: '重命名对话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).not.toBeDisabled();
    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'error',
      message: 'rename failed',
    });
  });

  it('prefills the rename input with the displayed conversation title', () => {
    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: '设计对话重命名方案', timestamp: 1 }], {
          sessionFile: '/sessions/current.jsonl',
          sessionName: '',
        }),
      });
    });

    render(<ChatApp />);
    expect(screen.getByRole('heading', { name: '设计对话重命名方案' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名对话' }));

    const input = screen.getByRole('textbox', { name: '对话标题' });
    expect(input).toHaveValue('设计对话重命名方案');
    expect(input).toHaveAttribute('placeholder', '添加标题...');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(getLatestPostedProtocolRequest('set_session_name')?.payload).toEqual({
      type: 'set_session_name',
      name: '设计对话重命名方案',
    });
  });

  it('uses the default title when the current session has no derived title', () => {
    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: '   ', timestamp: 1 }], {
          sessionFile: '/sessions/current.jsonl',
          sessionName: '',
        }),
      });
    });

    render(<ChatApp />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名对话' }));

    const input = screen.getByRole('textbox', { name: '对话标题' });
    expect(input).toHaveValue('当前会话');
    expect(input).toHaveAttribute('placeholder', '添加标题...');
  });

  it('clears parent session pending state when restore is cancelled', () => {
    routeDetailState({
      sessionFile: '/sessions/fork.jsonl',
      parentSessionPath: '/sessions/source.jsonl',
    });

    render(<ChatApp />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '返回原会话' }));
    const restoreMessage = getLatestPostedProtocolRequest('restore_session');

    act(() => {
      routeProtocolResult(restoreMessage, {
        type: 'restore_session_result',
        success: false,
        error: 'cancelled',
      });
    });

    expect(useUiStore.getState().openingTaskSessionPath).toBeUndefined();
    expect(useUiStore.getState().chatView).toBe('home');
    expect(useUiStore.getState().notification).toBeUndefined();
  });

  it('opens a task while a new session message is pending without applying stale creation results', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '会话二',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '还在创建的新会话' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();

    const newSessionMessage = getLatestPostedProtocolRequest('new_session_message');

    fireEvent.click(screen.getByRole('button', { name: /会话二/ }));

    const openTaskMessage = getLatestPostedProtocolRequest('open_task');
    expect(openTaskMessage?.payload).toEqual({
      type: 'open_task',
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
    expect(screen.getByText('任务')).toBeInTheDocument();
    expectComposerText('随心输入', '还在创建的新会话');
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();

    act(() => {
      routeProtocolResult(newSessionMessage, {
        type: 'new_session_result',
        success: true,
      });
    });

    expect(screen.getByText('任务')).toBeInTheDocument();
    expectComposerText('随心输入', '还在创建的新会话');

    act(() => {
      routeProtocolResult(openTaskMessage, {
        type: 'open_task_result',
        sessionPath: '/sessions/session-2.jsonl',
        success: true,
      });
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: '任务里的消息', timestamp: 1 }], {
          sessionId: 'session-2',
          sessionName: '会话二',
          sessionFile: '/sessions/session-2.jsonl',
        }),
      });
    });

    expect(screen.getByText('任务里的消息')).toBeInTheDocument();
    expectComposerText('要求后续变更', '');
  });

  it('expands the task list when viewing all tasks', () => {
    useTaskStore.getState().actions.setRecentTasks(
      Array.from({ length: 4 }, (_, index) => ({
        id: `task-${index + 1}`,
        sessionId: `session-${index + 1}`,
        sessionPath: `/sessions/session-${index + 1}.jsonl`,
        title: `历史任务 ${index + 1}`,
        createdAt: '2026-06-13T00:00:00.000Z',
      })),
    );

    render(<ChatApp />);

    expect(screen.queryByText('历史任务 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));

    expect(screen.getByText('历史任务 4')).toBeInTheDocument();
    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expect(screen.queryByText('本地任务')).not.toBeInTheDocument();
    expectPostedPayload('request_task_history', {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });
  });

  it('opens and closes task history from the home header action', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expectPostedPayload('request_task_history', {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
  });

  it('does not mark the current detail session in the home task history panel', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
        isCurrent: true,
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '另一个历史任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByRole('button', { name: /检查未提交更改/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens task history from the conversation header action', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
        isCurrent: true,
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '另一个历史任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);
    useConversationStore
      .getState()
      .actions.applyStateSnapshot(makeState([{ role: 'user', content: 'hello', timestamp: 1 }]));
    useSessionStore
      .getState()
      .actions.applyState(makeState([{ role: 'user', content: 'hello', timestamp: 1 }]));

    render(<ChatApp />);
    expect(screen.queryByRole('button', { name: '继续会话' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expectPostedPayload('request_task_history', {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    postMessage.mockClear();

    const currentTask = screen.getByRole('button', { name: /检查未提交更改/ });
    expect(currentTask).toHaveAttribute('aria-current', 'page');
    expect(currentTask).not.toBeDisabled();
    fireEvent.click(currentTask);
    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
    expect(getPostedProtocolRequests('open_task')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /另一个历史任务/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
    expectPostedPayload('open_task', {
      type: 'open_task',
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
  });

  it('collapses the expanded task panel when clicking outside it', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /收起/ })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /查看全部/ })).toBeInTheDocument();
    });
  });

  it('requests backend task search from the expanded task panel', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '修复 ChatComposer effect 报错',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: 'ChatComposer' },
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(screen.getByLabelText('搜索历史任务')).toHaveValue('ChatComposer');
    expect(screen.getByText('检查未提交更改')).toBeInTheDocument();
    expect(screen.getByText('修复 ChatComposer effect 报错')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const searchMessage = getLatestSearchTaskMessage();
    expect(searchMessage?.payload).toEqual({
      type: 'request_task_history',
      query: 'ChatComposer',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });
    expect(postMessage.mock.calls.some(([message]) => message.type === 'protocol_cancel')).toBe(
      true,
    );

    vi.useRealTimers();
  });

  it('ignores stale task history results for an older request', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const initialQueryToken = getHistoryQueryToken();
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '第二次' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const currentQueryToken = getHistoryQueryToken();

    act(() => {
      routeTaskHistoryResult(
        initialQueryToken ?? 'stale',
        [
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '第一次搜索结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { query: '', offset: 0, nextOffset: 1 },
      );
    });

    expect(screen.queryByText('第一次搜索结果')).not.toBeInTheDocument();

    act(() => {
      routeTaskHistoryResult(
        currentQueryToken ?? 'current',
        [
          {
            id: 'task-2',
            sessionId: 'session-2',
            sessionPath: '/sessions/session-2.jsonl',
            title: '第二次搜索结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { query: '第二次', offset: 0, nextOffset: 1 },
      );
    });

    expect(screen.getByText('第二次搜索结果')).toBeInTheDocument();
    expect(screen.queryByText('第一次搜索结果')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('keeps task history separate from recent task updates while searching', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '初始任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '目标' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const historyQueryToken = getHistoryQueryToken();

    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-old',
            sessionId: 'session-old',
            sessionPath: '/sessions/session-old.jsonl',
            title: '旧的全量结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 1,
      });
      routeTaskHistoryResult(
        historyQueryToken ?? 'history',
        [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '目标搜索结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { query: '目标' },
      );
    });

    expect(screen.getByText('目标搜索结果')).toBeInTheDocument();
    expect(screen.queryByText('旧的全量结果')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does not request a refresh when recent tasks change during a non-empty search', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '初始任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '目标' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // 此刻只应有过两次请求：打开面板的空查询 + 搜索“目标”
    postMessage.mockClear();

    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '初始任务',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 2,
      });
    });

    // 即便 recent 更新对应的 debounce 窗口完全流逝，也不应发出任何新的历史请求
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(getPostedProtocolRequests('request_task_history')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('still fires a pending non-empty search when a recent update arrives mid-debounce', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '初始任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '目标' },
    });

    // 关键：在 200ms 搜索 debounce 计时器触发之前，先推 recent 更新
    postMessage.mockClear();
    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '初始任务',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 2,
      });
    });

    // 再走完 debounce 窗口：待发的搜索请求不应被 recent 更新吞掉
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const searchRequests = getPostedProtocolRequests('request_task_history').filter(
      (request) => request.payload.query === '目标' && request.payload.offset === 0,
    );
    expect(searchRequests).toHaveLength(1);
    vi.useRealTimers();
  });

  it('refreshes an open empty task history panel when recent tasks change', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '旧任务 1',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '旧任务 2',
        createdAt: '2026-06-12T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const historyQueryToken = getHistoryQueryToken();

    act(() => {
      routeTaskHistoryResult(historyQueryToken ?? 'history', [
        {
          id: 'task-1',
          sessionId: 'session-1',
          sessionPath: '/sessions/session-1.jsonl',
          title: '旧任务 1',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
        {
          id: 'task-2',
          sessionId: 'session-2',
          sessionPath: '/sessions/session-2.jsonl',
          title: '旧任务 2',
          createdAt: '2026-06-12T00:00:00.000Z',
        },
      ]);
    });

    postMessage.mockClear();

    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '旧任务 1',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
          {
            id: 'task-2',
            sessionId: 'session-2',
            sessionPath: '/sessions/session-2.jsonl',
            title: '旧任务 2',
            createdAt: '2026-06-12T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 3,
      });
    });

    await waitFor(() => {
      expect(getLatestSearchTaskMessage()?.payload).toEqual({
        type: 'request_task_history',
        query: '',
        purpose: 'panel',
        limit: 20,
        offset: 0,
      });
    });
    const refreshedQueryToken = getHistoryQueryToken();
    expect(refreshedQueryToken).toBeDefined();
    expect(refreshedQueryToken).not.toBe(historyQueryToken);

    act(() => {
      routeTaskHistoryResult(
        refreshedQueryToken ?? 'refresh',
        [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '旧任务 1',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
          {
            id: 'task-2',
            sessionId: 'session-2',
            sessionPath: '/sessions/session-2.jsonl',
            title: '旧任务 2',
            createdAt: '2026-06-12T00:00:00.000Z',
          },
        ],
        { nextOffset: 3 },
      );
    });

    expect(screen.getByText('新会话任务')).toBeInTheDocument();
    expect(screen.getAllByText('旧任务 1')).toHaveLength(1);
  });

  it('keeps a recent task when a stale empty history result arrives later', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '旧任务 1',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const historyQueryToken = getHistoryQueryToken();
    postMessage.mockClear();

    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '旧任务 1',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 2,
      });
    });

    await waitFor(() => {
      expect(getHistoryQueryToken()).not.toBe(historyQueryToken);
      expect(getLatestSearchTaskMessage()?.payload).toEqual({
        type: 'request_task_history',
        query: '',
        purpose: 'panel',
        limit: 20,
        offset: 0,
      });
    });
    const refreshedQueryToken = getHistoryQueryToken();

    act(() => {
      routeTaskHistoryResult(historyQueryToken ?? 'history', [
        {
          id: 'task-1',
          sessionId: 'session-1',
          sessionPath: '/sessions/session-1.jsonl',
          title: '旧任务 1',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ]);
    });

    expect(screen.getByText('新会话任务')).toBeInTheDocument();
    expect(screen.getAllByText('旧任务 1')).toHaveLength(1);

    act(() => {
      routeTaskHistoryResult(
        refreshedQueryToken ?? 'refresh',
        [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '旧任务 1',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { nextOffset: 2 },
      );
    });

    expect(screen.getByText('新会话任务')).toBeInTheDocument();
    expect(screen.getAllByText('旧任务 1')).toHaveLength(1);
  });

  it('does not double-request when clearing the search back to empty after a recent update', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '旧任务 1',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));

    // 切到搜索词
    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '关键词' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // 搜索中后台推送新的最近会话（有搜索词时不应触发刷新）
    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-new',
            sessionId: 'session-new',
            sessionPath: '/sessions/session-new.jsonl',
            title: '新会话任务',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '旧任务 1',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 2,
      });
    });

    // 清空搜索词回到空查询
    postMessage.mockClear();
    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // 只应发出一次空查询第一页请求，不存在“即时 + debounce 双发”
    const emptyRequests = getPostedProtocolRequests('request_task_history').filter(
      (request) => request.payload.query === '' && request.payload.offset === 0,
    );
    expect(emptyRequests).toHaveLength(1);
    vi.useRealTimers();
  });

  it('loads the next task history page when the sentinel intersects', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '第一页任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const initialQueryToken = getHistoryQueryToken();

    act(() => {
      routeTaskHistoryResult(
        initialQueryToken ?? 'history-1',
        [
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '第一页任务',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { hasMore: true, nextOffset: 20 },
      );
    });

    await waitFor(() => {
      expect(intersectionObservers.length).toBeGreaterThan(0);
    });

    postMessage.mockClear();
    act(() => {
      intersectionObservers.at(-1)?.trigger();
    });

    const nextSearch = getLatestSearchTaskMessage();
    const nextQueryToken = getHistoryQueryToken();
    expect(nextSearch?.payload).toEqual({
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 20,
    });

    act(() => {
      routeTaskHistoryResult(
        nextQueryToken ?? 'history-2',
        [
          {
            id: 'task-2',
            sessionId: 'session-2',
            sessionPath: '/sessions/session-2.jsonl',
            title: '第二页任务',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { offset: 20, hasMore: false, nextOffset: 21 },
      );
    });

    expect(screen.getByText('第一页任务')).toBeInTheDocument();
    expect(screen.getByText('第二页任务')).toBeInTheDocument();
  });

  it('sends follow-up messages with Enter while streaming', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '现在改方向' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '现在改方向',
      deliverAs: 'followUp',
    });
  });

  it('shows a live streaming changes review summary in the composer tray', () => {
    const queueState = {
      paused: false,
      messages: [{ id: 'follow-1', delivery: 'followUp' as const, text: '111', timestamp: 4 }],
      followUps: [{ id: 'follow-1', text: '111', timestamp: 4 }],
    };
    const streamingMessages: ScoutMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tool-1',
            name: 'edit',
            arguments: { path: 'src/app.ts' },
          },
          {
            type: 'toolCall',
            id: 'tool-2',
            name: 'edit',
            arguments: { path: 'src/other.ts' },
          },
        ],
        timestamp: 2,
      },
    ];
    const makeToolResult = (
      toolCallId: string,
      path: string,
      additions: number,
      deletions: number,
      recordId: string,
      timestamp: number,
    ): Extract<ScoutMessage, { role: 'toolResult' }> => ({
      role: 'toolResult',
      toolCallId,
      toolName: 'edit',
      content: [{ type: 'text', text: 'done' }],
      details: {
        kind: 'file_change',
        path,
        displayPath: path.replace(/^\/workspace\//, ''),
        additions,
        deletions,
        review: {
          turnId: 'turn-1',
          recordId,
        },
      },
      isError: false,
      timestamp,
    });
    const settledMessages: ScoutMessage[] = [
      streamingMessages[0]!,
      {
        ...(streamingMessages[1]! as Extract<ScoutMessage, { role: 'assistant' }>),
        changesReviews: [
          {
            turnId: 'turn-1',
            fileCount: 2,
            additions: 27,
            deletions: 23,
            files: [
              {
                path: '/workspace/src/app.ts',
                displayPath: 'src/app.ts',
                additions: 19,
                deletions: 19,
              },
              {
                path: '/workspace/src/other.ts',
                displayPath: 'src/other.ts',
                additions: 8,
                deletions: 4,
              },
            ],
          },
        ],
      },
      makeToolResult('tool-1', '/workspace/src/app.ts', 19, 19, 'review-1', 3),
      makeToolResult('tool-2', '/workspace/src/other.ts', 8, 4, 'review-2', 4),
    ];
    const streamingState = makeState(streamingMessages, {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      queueState,
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
    });
    useConversationStore.getState().actions.applyStateSnapshot(streamingState);
    useSessionStore.getState().actions.applyState(streamingState);

    const { container } = render(<ChatApp />);

    expect(container.querySelector('[data-composer-changes-review-summary="true"]')).toBeNull();

    act(() => {
      routeExtensionMessage({
        type: 'tool_call_preview_update',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'edit',
        preview: {
          kind: 'file_edit',
          path: '/workspace/src/app.ts',
          displayPath: 'src/app.ts',
          diff: ' 1 const value = 1;\n-2 old\n+2 new',
          additions: 19,
          deletions: 19,
        },
      });
    });

    let summary = container.querySelector(
      '[data-composer-changes-review-summary="true"]',
    ) as HTMLElement;
    expect(summary).not.toBeNull();
    expect(within(summary).getByText('1 个文件已更改')).toBeInTheDocument();
    expect(within(summary).getByText('+19')).toBeInTheDocument();
    expect(within(summary).getByText('-19')).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: '审查' })).toBeInTheDocument();
    const liveEditTitle = screen.getByText('正在编辑 src/app.ts');
    expect(liveEditTitle).toBeInTheDocument();
    const liveEditRow = liveEditTitle.parentElement as HTMLElement;
    const liveEditMetrics = within(liveEditRow).getByText('+19').parentElement as HTMLElement;
    expect(liveEditMetrics).toHaveClass('ml-auto');
    expect(liveEditRow.lastElementChild).toBe(liveEditMetrics);
    expect(within(liveEditRow).getByText('-19')).toBeInTheDocument();
    expect(screen.queryByText('正在编辑 /workspace/src/app.ts')).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'changes_review_update',
        sessionId: 'session-1',
        changesReview: {
          turnId: 'turn-1',
          fileCount: 1,
          additions: 19,
          deletions: 19,
          files: [
            {
              path: '/workspace/src/app.ts',
              displayPath: 'src/app.ts',
              additions: 19,
              deletions: 19,
            },
          ],
        },
      });
    });

    summary = container.querySelector(
      '[data-composer-changes-review-summary="true"]',
    ) as HTMLElement;
    const queue = container.querySelector('[data-composer-follow-up-queue="true"]') as HTMLElement;
    expect(summary).not.toBeNull();
    expect(queue).not.toBeNull();
    expect(summary.parentElement).toBe(queue.parentElement);
    expect(within(summary).getByText('1 个文件已更改')).toBeInTheDocument();
    expect(within(summary).getByText('+19')).toBeInTheDocument();
    expect(within(summary).getByText('-19')).toBeInTheDocument();
    expect(within(queue).getByText('111')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Changes' })).not.toBeInTheDocument();

    fireEvent.click(within(summary).getByRole('button', { name: '审查' }));
    expectPostedPayload('open_current_changes_review', {
      type: 'open_current_changes_review',
    });

    act(() => {
      routeExtensionMessage({
        type: 'tool_call_preview_update',
        sessionId: 'session-1',
        toolCallId: 'tool-2',
        toolName: 'edit',
        preview: {
          kind: 'file_edit',
          path: '/workspace/src/other.ts',
          displayPath: 'src/other.ts',
          additions: 8,
          deletions: 4,
        },
      });
    });
    summary = container.querySelector(
      '[data-composer-changes-review-summary="true"]',
    ) as HTMLElement;
    expect(within(summary).getByText('2 个文件已更改')).toBeInTheDocument();
    expect(within(summary).getByText('+27')).toBeInTheDocument();
    expect(within(summary).getByText('-23')).toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'changes_review_update',
        sessionId: 'session-1',
        changesReview: {
          turnId: 'turn-1',
          fileCount: 2,
          additions: 27,
          deletions: 23,
          files: [
            {
              path: '/workspace/src/app.ts',
              displayPath: 'src/app.ts',
              additions: 19,
              deletions: 19,
            },
            {
              path: '/workspace/src/other.ts',
              displayPath: 'src/other.ts',
              additions: 8,
              deletions: 4,
            },
          ],
        },
      });
    });
    summary = container.querySelector(
      '[data-composer-changes-review-summary="true"]',
    ) as HTMLElement;
    expect(within(summary).getByText('2 个文件已更改')).toBeInTheDocument();
    expect(within(summary).getByText('+27')).toBeInTheDocument();
    expect(within(summary).getByText('-23')).toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState(settledMessages, {
          isStreaming: false,
          busyState: { kind: 'idle', cancellable: false },
          queueState,
          sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
        }),
      });
    });
    expect(container.querySelector('[data-composer-changes-review-summary="true"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review Changes' })).toBeInTheDocument();

    expect(screen.queryByText('已编辑的文件')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开文件变更 src\/app\.ts/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('-2 old')).not.toBeInTheDocument();
    expect(screen.queryByText('+2 new')).not.toBeInTheDocument();
  });

  it('shows retry runtime status inline in the conversation', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByText('正在重试 2/3')).toBeInTheDocument();
    expect(screen.getByText('rate limit')).toBeInTheDocument();
  });

  it('does not render an empty extension request tail row', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    const { container } = render(<ChatApp />);

    expect(
      container.querySelector('[data-message-id="conversation-extension-requests"]'),
    ).toBeNull();
  });

  it('does not surface internal agent busy labels in the header loading action', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '正在回复' })).toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();
  });

  it('projects runtime state updates to the header and conversation body', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    expect(screen.queryByRole('button', { name: '正在回复' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: { kind: 'agent', label: 'Working', cancellable: true },
      });
    });
    expect(screen.getByRole('button', { name: '正在回复' })).toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: {
          kind: 'retry',
          label: 'Retrying',
          cancellable: true,
          attempt: 2,
          maxAttempts: 3,
          reason: 'rate limit',
        },
      });
    });
    expect(screen.getByText('正在重试 2/3')).toBeInTheDocument();
    expect(screen.getByText('rate limit')).toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: {
          kind: 'compaction',
          label: 'Compacting',
          cancellable: true,
          reason: 'overflow',
        },
      });
    });
    expect(screen.getByText('正在压缩上下文')).toBeInTheDocument();
    expect(screen.queryByText('上下文溢出恢复')).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: false,
        busyState: { kind: 'idle', cancellable: false },
      });
    });
    expect(screen.queryByText('正在压缩上下文')).not.toBeInTheDocument();
  });

  it('sends current session messages with composer images', async () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);
    useComposerStore.getState().actions.addImages('session-1', [makeComposerImageDescriptor()]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '看这张图' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    await waitFor(() => {
      expectPostedPayload('user_message', {
        type: 'user_message',
        text: '看这张图',
        deliverAs: undefined,
        images: [TEST_IMAGE],
      });
    });
  });

  it('sends pasted images with the current session message', async () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    const textarea = screen.getByLabelText('要求后续变更');
    const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

    fireEvent.paste(textarea, {
      clipboardData: makeImageClipboardData([pastedImage]),
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: '看粘贴的图' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expectPostedPayload('user_message', {
        type: 'user_message',
        text: '看粘贴的图',
        deliverAs: undefined,
        images: [{ type: 'image', data: 'cGFzdGVkIGltYWdl', mimeType: 'image/png' }],
      });
    });
  });

  it('waits for pasted image encoding before sending the current session message', async () => {
    const fileReader = installDeferredFileReader();
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    try {
      render(<ChatApp />);
      const textarea = screen.getByLabelText('要求后续变更');
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

      fireEvent.change(textarea, { target: { value: '看粘贴的图' } });
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      expect(fileReader.readers).toHaveLength(0);
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(fileReader.readers).toHaveLength(1);
      expect(getPostedProtocolRequests('user_message')).toHaveLength(0);
      expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();

      await act(async () => {
        fileReader.readers[0]?.complete('data:image/png;base64,cGFzdGVkIGltYWdl');
        await Promise.resolve();
      });

      await waitFor(() => {
        expectPostedPayload('user_message', {
          type: 'user_message',
          text: '看粘贴的图',
          deliverAs: undefined,
          images: [{ type: 'image', data: 'cGFzdGVkIGltYWdl', mimeType: 'image/png' }],
        });
      });
      expect(screen.queryByRole('button', { name: '预览图片 1' })).not.toBeInTheDocument();
    } finally {
      fileReader.restore();
    }
  });

  it('locks the current draft while submit encodes images', async () => {
    const fileReader = installDeferredFileReader();
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    try {
      render(<ChatApp />);
      const textarea = screen.getByLabelText('要求后续变更') as HTMLTextAreaElement;
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });
      const ignoredImage = new File(['ignored image'], 'ignored.png', { type: 'image/png' });

      fireEvent.change(textarea, { target: { value: '发送时的文本' } });
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(fileReader.readers).toHaveLength(1);
      expect(textarea).toHaveAttribute('aria-readonly', 'true');
      expect(screen.getByRole('button', { name: '添加文件、文件夹或图片' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '移除图片 1' })).toBeDisabled();

      fireEvent.change(textarea, { target: { value: '等待期间的新文本' } });
      fireEvent.click(screen.getByRole('button', { name: '移除图片 1' }));
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([ignoredImage]),
      });
      expect(fileReader.readers).toHaveLength(1);

      await act(async () => {
        fileReader.readers[0]?.complete('data:image/png;base64,cGFzdGVkIGltYWdl');
        await Promise.resolve();
      });

      await waitFor(() => {
        expectPostedPayload('user_message', {
          type: 'user_message',
          text: '发送时的文本',
          deliverAs: undefined,
          images: [{ type: 'image', data: 'cGFzdGVkIGltYWdl', mimeType: 'image/png' }],
        });
      });
    } finally {
      fileReader.restore();
    }
  });

  it('shows an error notification when pasted image encoding fails', async () => {
    const fileReader = installDeferredFileReader();
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    try {
      render(<ChatApp />);
      const textarea = screen.getByLabelText('要求后续变更');
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(fileReader.readers).toHaveLength(1);
      await act(async () => {
        fileReader.readers[0]?.fail();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(useUiStore.getState().notification).toEqual({
          type: 'notification',
          level: 'error',
          message: '图片读取失败，请重新选择',
        });
      });
      expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    } finally {
      fileReader.restore();
    }
  });

  it('keeps the draft and does not send if compaction starts while image encoding is pending', async () => {
    const fileReader = installDeferredFileReader();
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    try {
      render(<ChatApp />);
      const textarea = screen.getByLabelText('要求后续变更');
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

      fireEvent.change(textarea, { target: { value: '压缩开始前的提交' } });
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(fileReader.readers).toHaveLength(1);

      act(() => {
        routeExtensionMessage({
          type: 'runtime_state_update',
          isStreaming: true,
          busyState: {
            kind: 'compaction',
            label: 'Compacting',
            cancellable: true,
            reason: 'manual',
          },
        });
      });
      await act(async () => {
        fileReader.readers[0]?.complete('data:image/png;base64,cGFzdGVkIGltYWdl');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(useUiStore.getState().notification).toEqual({
          type: 'notification',
          level: 'error',
          message: '正在压缩上下文，请等待压缩完成后再发送',
        });
      });
      expect(getPostedProtocolRequests('user_message')).toHaveLength(0);
      expectComposerText('要求后续变更', '压缩开始前的提交');
      expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
    } finally {
      fileReader.restore();
    }
  });

  it('does not show image encoding errors after leaving the submit context', async () => {
    const fileReader = installDeferredFileReader();

    try {
      routeDetailState();
      render(<ChatApp />);
      const textarea = screen.getByLabelText('要求后续变更');
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

      fireEvent.change(textarea, { target: { value: '切走前的失败提交' } });
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(fileReader.readers).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: '新会话' }));
      await act(async () => {
        fileReader.readers[0]?.fail();
        await Promise.resolve();
      });

      expect(getPostedProtocolRequests('user_message')).toHaveLength(0);
      expect(useUiStore.getState().notification).toBeUndefined();
    } finally {
      fileReader.restore();
    }
  });

  it('abandons delayed current session submits after leaving the session view', async () => {
    const fileReader = installDeferredFileReader();

    try {
      routeDetailState();
      render(<ChatApp />);
      const textarea = screen.getByLabelText('要求后续变更');
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

      fireEvent.change(textarea, { target: { value: '切走前的提交' } });
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(fileReader.readers).toHaveLength(1);
      expect(getPostedProtocolRequests('user_message')).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: '新会话' }));
      expect(screen.getByLabelText('随心输入')).toBeInTheDocument();

      await act(async () => {
        fileReader.readers[0]?.complete('data:image/png;base64,cGFzdGVkIGltYWdl');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(getPostedProtocolRequests('user_message')).toHaveLength(0);
    } finally {
      fileReader.restore();
    }
  });

  it('abandons delayed new session submits after opening another task', async () => {
    const fileReader = installDeferredFileReader();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '会话二',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    try {
      render(<ChatApp />);
      const textarea = screen.getByLabelText('随心输入');
      const pastedImage = new File(['pasted image'], 'pasted.png', { type: 'image/png' });

      fireEvent.change(textarea, { target: { value: '打开任务前的新会话' } });
      fireEvent.paste(textarea, {
        clipboardData: makeImageClipboardData([pastedImage]),
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument();
      });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(fileReader.readers).toHaveLength(1);
      expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: /会话二/ }));
      expectPostedPayload('open_task', {
        type: 'open_task',
        taskId: 'task-2',
        sessionPath: '/sessions/session-2.jsonl',
        cwdOverride: undefined,
      });
      expect(useUiStore.getState().openingTaskSessionPath).toBe('/sessions/session-2.jsonl');

      await act(async () => {
        fileReader.readers[0]?.complete('data:image/png;base64,cGFzdGVkIGltYWdl');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
      expect(useUiStore.getState().openingTaskSessionPath).toBe('/sessions/session-2.jsonl');
    } finally {
      fileReader.restore();
    }
  });

  it('keeps the reading position after sending while scrolled into history', () => {
    const state = makeState(makeUserMessages(160));
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    const viewport = screen.getByLabelText('会话滚动区域');
    const scrollTo = setConversationViewportScrollMetrics(viewport, {
      clientHeight: 400,
      scrollHeight: 12_000,
      scrollTop: 1_000,
    });

    fireEvent.wheel(viewport, { deltaY: -120 });
    scrollTo.mockClear();
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '继续处理' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '继续处理',
      deliverAs: undefined,
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(1_000);

    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      value: 12_064,
    });
    scrollTo.mockClear();
    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState(
          [...makeUserMessages(160), { role: 'user', content: '继续处理', timestamp: 161 }],
          {
            isStreaming: true,
            busyState: { kind: 'agent', label: 'Working', cancellable: true },
          },
        ),
      });
    });
    flushResizeObservers();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(1_000);
  });

  it('keeps the draft and shows an error instead of sending while compacting', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: {
        kind: 'compaction',
        label: 'Compacting',
        cancellable: true,
        reason: 'manual',
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '  压缩中不要丢这条\n' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expect(getPostedProtocolRequests('user_message')).toHaveLength(0);
    expectComposerText('要求后续变更', '  压缩中不要丢这条\n');
    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'error',
      message: '正在压缩上下文，请等待压缩完成后再发送',
    });
  });

  it('sends steering messages with Ctrl Enter while streaming', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '立刻引导' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), {
      key: 'Enter',
      ctrlKey: true,
    });

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '立刻引导',
      deliverAs: 'steer',
    });
  });

  it('shows streaming send shortcuts when send button is active', async () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '准备排队' },
    });
    fireEvent.focus(screen.getByRole('button', { name: '发送' }));

    expect((await screen.findAllByText('队列')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('引导').length).toBeGreaterThan(0);
  });

  it('confirms streaming abort with Escape', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Escape' });
    expect(getPostedProtocolRequests('abort')).toHaveLength(0);
    expect(getPostedControlMessages('control_abort')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '确认中断' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Escape' });
    expect(getPostedControlMessages('control_abort')).toEqual([{ type: 'control_abort' }]);
  });

  it('keeps composer drafts isolated by session id', () => {
    const sessionOne = makeState([{ role: 'user', content: 'one', timestamp: 1 }], {
      sessionId: 'session-1',
      sessionName: '会话一',
    });
    const sessionTwo = makeState([{ role: 'user', content: 'two', timestamp: 1 }], {
      sessionId: 'session-2',
      sessionName: '会话二',
    });
    useConversationStore.getState().actions.applyStateSnapshot(sessionOne);
    useSessionStore.getState().actions.applyState(sessionOne);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'session one draft' },
    });

    act(() => {
      useConversationStore.getState().actions.applyStateSnapshot(sessionTwo);
      useSessionStore.getState().actions.applyState(sessionTwo);
    });

    expectComposerText('要求后续变更', '');
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'session two draft' },
    });

    act(() => {
      useConversationStore.getState().actions.applyStateSnapshot(sessionOne);
      useSessionStore.getState().actions.applyState(sessionOne);
    });

    expectComposerText('要求后续变更', 'session one draft');
  });

  it('does not reuse the conversation draft on the task home composer', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'conversation draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expectComposerText('随心输入', '');
  });

  it('stays on the task home until the opened task state is current', () => {
    routeExtensionMessage({
      type: 'state_update',
      state: makeState([{ role: 'user', content: 'old conversation', timestamp: 1 }], {
        sessionId: 'session-1',
        sessionName: '会话一',
        sessionFile: '/sessions/session-1.jsonl',
      }),
    });
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '会话二',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'old draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /会话二/ }));

    expectPostedPayload('open_task', {
      type: 'open_task',
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.queryByText('old conversation')).not.toBeInTheDocument();
    expectComposerText('随心输入', '');

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: 'new conversation', timestamp: 1 }], {
          sessionId: 'session-2',
          sessionName: '会话二',
          sessionFile: '/sessions/session-2.jsonl',
        }),
      });
    });

    expect(screen.getByText('new conversation')).toBeInTheDocument();
    expectComposerText('要求后续变更', '');
  });

  it('aborts immediately when clicking the stop button', () => {
    const state = makeState(
      [
        { role: 'user', content: 'hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial answer' }],
          timestamp: 2,
          entryId: 'assistant-1',
        },
      ],
      {
        isStreaming: true,
        busyState: { kind: 'agent', label: 'Working', cancellable: true },
      },
    );
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    expect(screen.getByText('partial answer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    expect(getPostedControlMessages('control_abort')).toEqual([{ type: 'control_abort' }]);
    expect(screen.queryByRole('button', { name: '确认中断' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'agent_event',
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'partial answer stale queued text' }],
            timestamp: 2,
          },
        },
      });
    });

    expect(screen.getByText('partial answer')).toBeInTheDocument();
    expect(screen.queryByText('partial answer stale queued text')).not.toBeInTheDocument();
  });

  it('shows provider abort errors as a conversation row after the assistant turn', () => {
    const state = makeState([
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'working' }],
        stopReason: 'aborted',
        errorMessage: 'Request was aborted',
        timestamp: 2,
      },
    ]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    const { container } = render(<ChatApp />);

    const notice = container.querySelector('[data-manual-abort-notice="true"]');
    const assistantText = screen.getByText('working');
    expect(screen.getByText('你停止了会话')).toBeInTheDocument();
    expect(screen.queryByText('Request was aborted')).not.toBeInTheDocument();
    expect(notice).toHaveClass('justify-end', 'border-b');
    expect(notice?.querySelector('span')).toHaveClass('text-muted-foreground');
    expect(
      assistantText.compareDocumentPosition(notice as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('does not re-enable stop while an aborted run is settling', () => {
    const messages: ScoutMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'partial answer' }],
        timestamp: 2,
        entryId: 'assistant-1',
      },
    ];
    const state = makeState(messages, {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: false,
        busyState: { kind: 'idle', cancellable: false },
      });
    });
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState(messages, {
          isStreaming: true,
          busyState: { kind: 'agent', label: 'Working', cancellable: true },
        }),
      });
    });

    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
  });

  it('keeps immediate post-abort submits in the follow-up channel until runtime idle', () => {
    const messages: ScoutMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'partial answer' }],
        timestamp: 2,
        entryId: 'assistant-1',
      },
    ];
    const state = makeState(messages, {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '马上继续提问' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '马上继续提问',
      deliverAs: 'followUp',
    });
  });

  it('shows queued follow-ups and exposes promote/delete actions', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [
          { id: 'follow-1', delivery: 'followUp', text: '先继续这个', timestamp: 2 },
          { id: 'follow-2', delivery: 'followUp', text: '再处理那个', timestamp: 3 },
        ],
        followUps: [
          { id: 'follow-1', text: '先继续这个', timestamp: 2 },
          { id: 'follow-2', text: '再处理那个', timestamp: 3 },
        ],
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByText('由于你中断了当前响应，队列已暂停')).toBeInTheDocument();
    expect(screen.getByText('先继续这个')).toBeInTheDocument();

    postMessage.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: '引导' })[0]);
    expectPostedPayload('promote_follow_up', {
      type: 'promote_follow_up',
      id: 'follow-1',
      resume: true,
      preserveFollowUpQueue: true,
    });

    fireEvent.click(screen.getAllByRole('button', { name: '删除跟进' })[1]);
    expectPostedPayload('cancel_follow_up', { type: 'cancel_follow_up', id: 'follow-2' });
  });

  it('resumes the full paused follow-up queue from the queue header', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [{ id: 'follow-1', delivery: 'followUp', text: '继续排队', timestamp: 2 }],
        followUps: [{ id: 'follow-1', text: '继续排队', timestamp: 2 }],
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expectPostedPayload('continue_session', { type: 'continue_session' });
    expect(getLatestPostedProtocolRequest('continue_session')?.payload).not.toEqual(
      expect.objectContaining({ preserveFollowUpQueue: true }),
    );
  });

  it('confirms sending a new message while a paused follow-up queue exists', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: Array.from({ length: 7 }, (_, index) => ({
          id: `follow-${index}`,
          delivery: 'followUp',
          text: `排队 ${index}`,
          timestamp: index,
        })),
        followUps: Array.from({ length: 7 }, (_, index) => ({
          id: `follow-${index}`,
          text: `排队 ${index}`,
          timestamp: index,
        })),
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '发送新的消息' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expect(screen.getByText('发送消息？')).toBeInTheDocument();
    expect(screen.getByText(/之前已排队的 7 条消息/)).toBeInTheDocument();
    expect(getPostedProtocolRequests('user_message')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '清空队列' }));
    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '发送新的消息',
      deliverAs: undefined,
      clearFollowUpQueue: true,
    });
  });

  it('sends a new message without clearing a paused follow-up queue', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [
          { id: 'follow-1', delivery: 'followUp', text: '保留这个', timestamp: 1 },
          { id: 'follow-2', delivery: 'followUp', text: '也保留这个', timestamp: 2 },
        ],
        followUps: [
          { id: 'follow-1', text: '保留这个', timestamp: 1 },
          { id: 'follow-2', text: '也保留这个', timestamp: 2 },
        ],
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '保留队列发送' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '保留队列发送',
      deliverAs: undefined,
    });
    expect(getLatestPostedProtocolRequest('user_message')?.payload).not.toEqual(
      expect.objectContaining({ clearFollowUpQueue: true }),
    );
    expectComposerText('要求后续变更', '');
  });

  it('keeps the draft and does not send when closing the paused queue dialog', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [{ id: 'follow-1', delivery: 'followUp', text: '等一下处理', timestamp: 1 }],
        followUps: [{ id: 'follow-1', text: '等一下处理', timestamp: 1 }],
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '先别发' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });
    expect(screen.getByText('发送消息？')).toBeInTheDocument();
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByText('发送消息？')).not.toBeInTheDocument();
    expectComposerText('要求后续变更', '先别发');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'user_message' }));
  });

  it('keeps the stop affordance while streaming even when cancellation is unavailable', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: false },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('switches from an active conversation back to the task home locally', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    const title = screen.getByRole('heading', { name: '检查未提交更改' });
    expect(title).toHaveClass('truncate');
    expect(screen.queryByRole('button', { name: /检查未提交更改/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });

  it('opens the new session composer from the conversation header', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, '旧首页草稿');

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '新会话' }));

    expect(screen.getByText('任务')).toBeInTheDocument();
    expectComposerText('随心输入', '');
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });
});
