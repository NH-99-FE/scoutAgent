import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutSessionTreeNode, ScoutSessionTreeNodeKind } from '@scout-agent/shared';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { resetProtocolTransport } from '@/bridge/transport-client';
import { TreeApp } from '@/surfaces/tree/TreeApp';
import { TREE_SEARCH_DEBOUNCE_MS } from '@/features/tree/hooks/use-tree-panel-controller';
import { useSessionStore } from '@/store/session-store';
import { useConfigStore } from '@/store/config-store';
import { useConversationStore } from '@/store/conversation-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';

const postMessage = vi.fn();

function makeNode(
  id: string,
  kind: ScoutSessionTreeNodeKind,
  preview: string | undefined,
  children: ScoutSessionTreeNode[] = [],
  overrides: Partial<ScoutSessionTreeNode> = {},
): ScoutSessionTreeNode {
  return {
    id,
    parentId: overrides.parentId ?? null,
    timestamp: overrides.timestamp ?? '2026-06-26T10:20:30.000Z',
    type: overrides.type ?? (kind === 'custom' ? 'custom_message' : 'message'),
    kind,
    role: overrides.role,
    toolCall: overrides.toolCall,
    stopReason: overrides.stopReason,
    errorMessage: overrides.errorMessage,
    preview,
    children,
    label: overrides.label,
    labelTimestamp: overrides.labelTimestamp,
  };
}

function makeTree(): ScoutSessionTreeNode[] {
  const branchSummary = makeNode(
    'branch-summary-1',
    'branchSummary',
    'explored old retry path',
    [],
    { type: 'branch_summary' },
  );
  const compaction = makeNode('compaction-1', 'compaction', '42k tokens', [], {
    type: 'compaction',
  });
  const tool = makeNode('tool-1', 'toolResult', undefined, [compaction], {
    toolCall: {
      id: 'read-1',
      name: 'read',
      arguments: { path: 'agent-session.ts', offset: 1360, limit: 61 },
      truncated: false,
    },
  });
  const assistant = makeNode('assistant-1', 'assistant', 'runtime context restored', [tool], {
    role: 'assistant',
  });
  const bashExecution = makeNode('bash-execution-1', 'bashExecution', 'pnpm test', [], {
    role: 'bashExecution',
  });
  const errorAssistant = makeNode('assistant-error-1', 'assistant', 'provider exploded', [], {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'provider exploded',
  });
  const custom = makeNode('custom-message-1', 'custom', '[notice]: restored from parent', [], {
    type: 'custom_message',
  });
  const user = makeNode(
    'user-1',
    'user',
    'fix retry after overflow',
    [assistant, bashExecution, errorAssistant, branchSummary, custom],
    {
      role: 'user',
      label: 'runtime fix',
      labelTimestamp: '2026-06-26T11:15:00.000Z',
    },
  );
  const secondUser = makeNode('user-2', 'user', 'try clean branch', [], { role: 'user' });
  user.children.forEach((child) => {
    child.parentId = user.id;
  });
  assistant.children.forEach((child) => {
    child.parentId = assistant.id;
  });
  tool.children.forEach((child) => {
    child.parentId = tool.id;
  });
  secondUser.parentId = 'branch-summary-1';
  branchSummary.children = [secondUser];
  return [user];
}

function getPostedProtocolRequests(payloadType: string) {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message) => message.type === 'protocol_request' && message.payload?.type === payloadType,
    ) as Array<{ requestId: string; payload: Record<string, unknown> }>;
}

function routeProtocolResult(
  request: { requestId: string } | undefined,
  payload: { type: 'label_result'; success: boolean; error?: string },
) {
  if (!request) return;
  act(() => {
    routeExtensionMessage({
      type: 'protocol_response',
      requestId: request.requestId,
      payload,
    });
  });
}

function renderTreeApp(
  tree = makeTree(),
  leafId = 'tool-1',
  options: { skipPrompt?: boolean } = {},
) {
  useConfigStore.getState().actions.setConfig({
    models: [],
    defaultModelProvider: '',
    defaultModelId: '',
    defaultToolProfileId: 'develop',
    toolProfiles: [],
    branchSummary: { reserveTokens: 16384, skipPrompt: options.skipPrompt ?? false },
  });
  useSessionStore.setState({
    sessionId: 'session-1',
    sessionFile: '/sessions/session-1.jsonl',
    sessionName: 'Retry cleanup',
  });
  useTreeStore.getState().actions.setTreeData(tree, leafId);
  return render(<TreeApp />);
}

describe('TreeApp', () => {
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
    resetProtocolTransport();
    useTreeStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useConfigStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders Pi-visible tree nodes without ids, timestamps, or metric strips', () => {
    renderTreeApp();

    expect(screen.getAllByText(/用户：fix retry after overflow/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/助手：runtime context restored/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/助手：provider exploded/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('[bash] pnpm test').length).toBeGreaterThan(0);
    expect(screen.getAllByText('[read: agent-session.ts:1360-1420]').length).toBeGreaterThan(0);
    expect(document.querySelector('.lucide-square-terminal')).toBeInTheDocument();
    expect(document.querySelector('.lucide-file-text')).toBeInTheDocument();
    expect(screen.getAllByText(/\[分支摘要\]：explored old retry path/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\[压缩\] 42k tokens/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\[notice\]: restored from parent/).length).toBeGreaterThan(0);
    expect(screen.getByText('runtime fix')).toBeInTheDocument();

    expect(screen.queryByText('user-1')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-06-26T10:20:30.000Z')).not.toBeInTheDocument();
    expect(screen.queryByText('Nodes')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.queryByText('助手：无内容')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部' })).not.toBeInTheDocument();
  });

  it('filters tool results and user messages without mutating navigation state', () => {
    renderTreeApp();

    fireEvent.click(screen.getByRole('button', { name: '无工具' }));
    expect(screen.queryByText('[read: agent-session.ts:1360-1420]')).not.toBeInTheDocument();
    expect(screen.getAllByText('[bash] pnpm test').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/助手：runtime context restored/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '用户' }));
    expect(screen.getAllByText(/用户：fix retry after overflow/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/助手：runtime context restored/)).not.toBeInTheDocument();
  });

  it('debounces searches over formatted tool result text and structured tool call metadata', () => {
    vi.useFakeTimers();
    renderTreeApp();
    const search = screen.getByLabelText('搜索会话节点');

    fireEvent.change(search, { target: { value: 'agent-session.ts' } });
    expect(screen.getAllByText(/用户：fix retry after overflow/).length).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(TREE_SEARCH_DEBOUNCE_MS);
    });
    expect(screen.getAllByText('[read: agent-session.ts:1360-1420]').length).toBeGreaterThan(0);
    expect(screen.queryByText(/用户：fix retry after overflow/)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'read 1360' } });
    act(() => {
      vi.advanceTimersByTime(TREE_SEARCH_DEBOUNCE_MS);
    });
    expect(screen.getAllByText('[read: agent-session.ts:1360-1420]').length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('does not silently retarget navigation when filtering hides the selected node', () => {
    vi.useFakeTimers();
    renderTreeApp();

    fireEvent.change(screen.getByLabelText('搜索会话节点'), {
      target: { value: 'pnpm test' },
    });
    act(() => {
      vi.advanceTimersByTime(TREE_SEARCH_DEBOUNCE_MS);
    });

    expect(screen.getAllByText('[bash] pnpm test').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '切换到此节点' })).not.toBeInTheDocument();

    const bashRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText('[bash] pnpm test'));
    fireEvent.click(bashRow!);

    expect(screen.getByRole('button', { name: '切换到此节点' })).toBeInTheDocument();
  });

  it('keeps only refresh and reveal actions in the toolbar menu', () => {
    renderTreeApp();

    fireEvent.pointerDown(screen.getByRole('button', { name: '更多会话树操作' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('刷新')).toBeInTheDocument();
    expect(screen.getByText('定位当前叶子')).toBeInTheDocument();
    expect(screen.queryByText('Collapse branches')).not.toBeInTheDocument();
    expect(screen.queryByText('Expand branches')).not.toBeInTheDocument();
    expect(screen.queryByText('Show label time')).not.toBeInTheDocument();
  });

  it('keeps folded branch rows expandable', () => {
    renderTreeApp();

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();

    fireEvent.click(within(userRow!).getByLabelText('折叠分支'));
    expect(screen.queryByText(/助手：runtime context restored/)).not.toBeInTheDocument();

    const foldedUserRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(foldedUserRow).toBeDefined();
    fireEvent.click(within(foldedUserRow!).getByLabelText('展开分支'));

    expect(screen.getAllByText(/助手：runtime context restored/).length).toBeGreaterThan(0);
  });

  it('highlights the folded branch anchor', () => {
    renderTreeApp();

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();

    fireEvent.click(within(userRow!).getByLabelText('折叠分支'));

    const foldedUserRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(foldedUserRow).toHaveClass('scout-fold-anchor-highlight', 'ring-2', 'ring-primary/25');

    fireEvent.click(within(foldedUserRow!).getByLabelText('展开分支'));
    expect(foldedUserRow).not.toHaveClass('scout-fold-anchor-highlight');
  });

  it('clears folded branches when the search query changes', () => {
    renderTreeApp();

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();

    fireEvent.click(within(userRow!).getByLabelText('折叠分支'));
    expect(screen.queryByText(/助手：runtime context restored/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索会话节点'), { target: { value: 'runtime' } });

    expect(screen.getAllByText(/助手：runtime context restored/).length).toBeGreaterThan(0);
  });

  it('clears folded branches when the filter mode changes', () => {
    renderTreeApp();

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();

    fireEvent.click(within(userRow!).getByLabelText('折叠分支'));
    expect(screen.queryByText(/助手：runtime context restored/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '无工具' }));

    expect(screen.getAllByText(/助手：runtime context restored/).length).toBeGreaterThan(0);
    expect(screen.queryByText('[read: agent-session.ts:1360-1420]')).not.toBeInTheDocument();
  });

  it('does not select a row when keyboard events originate from the fold button', () => {
    renderTreeApp(makeTree(), 'tool-1', { skipPrompt: true });
    postMessage.mockClear();

    const assistantRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/助手：runtime context restored/));
    fireEvent.click(assistantRow!);

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();
    const foldButton = within(userRow!).getByLabelText('折叠分支');

    fireEvent.keyDown(foldButton, { key: 'Enter' });
    fireEvent.keyDown(foldButton, { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: '切换到此节点' }));

    expect(getPostedProtocolRequests('navigate_tree').at(-1)?.payload).toMatchObject({
      type: 'navigate_tree',
      targetId: 'assistant-1',
      summarize: false,
    });
  });

  it('selects the folded ancestor when the current selection is hidden by collapse', () => {
    const introRoot = makeNode('intro-root', 'user', 'earlier root', [], { role: 'user' });
    renderTreeApp([introRoot, ...makeTree()], 'tool-1', { skipPrompt: true });
    postMessage.mockClear();

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();

    fireEvent.click(within(userRow!).getByLabelText('折叠分支'));
    fireEvent.click(screen.getByRole('button', { name: '回到此处编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '回到此处编辑' }));

    expect(getPostedProtocolRequests('navigate_tree').at(-1)?.payload).toMatchObject({
      type: 'navigate_tree',
      targetId: 'user-1',
      summarize: false,
    });
  });

  it('selects rows without navigating, then sends navigate_tree from the inspector action', () => {
    renderTreeApp();
    postMessage.mockClear();

    const userRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/用户：fix retry after overflow/));
    expect(userRow).toBeDefined();
    fireEvent.click(userRow!);
    expect(getPostedProtocolRequests('navigate_tree')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: '回到此处编辑' }));
    expect(getPostedProtocolRequests('navigate_tree')).toEqual([]);
    expect(
      screen.getByText('继续后，聊天输入框中的现有草稿（包括图片）将被该节点内容替换。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到此处编辑' }).parentElement).toHaveClass(
      'bg-popover',
      'border-t-0',
      'pt-0',
    );

    fireEvent.click(screen.getByRole('radio', { name: '摘要被放弃的分支' }));
    fireEvent.click(screen.getByRole('button', { name: '回到此处编辑' }));

    expect(getPostedProtocolRequests('navigate_tree').at(-1)?.payload).toMatchObject({
      type: 'navigate_tree',
      targetId: 'user-1',
      summarize: true,
    });
  });

  it('does not offer navigation actions for the current leaf', () => {
    renderTreeApp();

    expect(screen.getByRole('button', { name: '当前节点' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '更多切换方式' })).not.toBeInTheDocument();
  });

  it.each([
    {
      id: 'user-current',
      kind: 'user' as const,
      overrides: { role: 'user' as const },
      preview: 'edit current user prompt',
    },
    {
      id: 'custom-current',
      kind: 'custom' as const,
      overrides: { type: 'custom_message' as const },
      preview: 'edit current custom prompt',
    },
  ])('offers editing when the current leaf is $kind', ({ id, kind, overrides, preview }) => {
    renderTreeApp([makeNode(id, kind, preview, [], overrides)], id, { skipPrompt: true });

    fireEvent.click(screen.getByRole('button', { name: '回到此处编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '回到此处编辑' }));

    expect(getPostedProtocolRequests('navigate_tree').at(-1)?.payload).toMatchObject({
      type: 'navigate_tree',
      targetId: id,
      summarize: false,
    });
  });

  it('sends custom summary instructions and label updates', () => {
    renderTreeApp(makeTree(), 'assistant-1');
    postMessage.mockClear();

    const toolRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText('[read: agent-session.ts:1360-1420]'));
    fireEvent.click(toolRow!);

    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'before retry' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(getPostedProtocolRequests('set_label').at(-1)?.payload).toEqual({
      type: 'set_label',
      session: { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' },
      entryId: 'tool-1',
      label: 'before retry',
    });

    fireEvent.click(screen.getByRole('button', { name: '切换到此节点' }));
    fireEvent.click(screen.getByRole('radio', { name: '自定义摘要' }));
    fireEvent.change(screen.getByPlaceholderText('自定义摘要指令'), {
      target: { value: 'Focus on runtime context recovery' },
    });
    fireEvent.click(screen.getByRole('button', { name: '继续切换' }));

    expect(getPostedProtocolRequests('navigate_tree').at(-1)?.payload).toMatchObject({
      type: 'navigate_tree',
      targetId: 'tool-1',
      summarize: true,
      customInstructions: 'Focus on runtime context recovery',
    });
  });

  it('skips the summary prompt when configured and locks duplicate mutations while navigating', () => {
    renderTreeApp(makeTree(), 'tool-1', { skipPrompt: true });
    postMessage.mockClear();

    const targetRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/助手：provider exploded/));
    fireEvent.click(targetRow!);

    const navigate = screen.getByRole('button', { name: '切换到此节点' });
    fireEvent.click(navigate);
    fireEvent.click(navigate);

    expect(getPostedProtocolRequests('navigate_tree')).toHaveLength(1);
    expect(getPostedProtocolRequests('navigate_tree')[0]?.payload).toMatchObject({
      type: 'navigate_tree',
      session: { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' },
      targetId: 'assistant-error-1',
      summarize: false,
    });
    expect(screen.getByRole('button', { name: '正在切换…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更多会话树操作' })).toBeDisabled();
  });

  it('explains a host-projected navigation block without sending a request', () => {
    renderTreeApp(makeTree(), 'tool-1', { skipPrompt: true });
    act(() => {
      useConversationStore.setState({
        busyState: { kind: 'agent', cancellable: true },
        treeNavigationAdmission: {
          allowed: false,
          reason: 'session_busy',
          message: '会话正在运行，请等待当前操作完成后再切换分支。',
        },
      });
    });
    const targetRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/助手：provider exploded/));
    fireEvent.click(targetRow!);
    postMessage.mockClear();

    const navigate = screen.getByRole('button', { name: '切换到此节点' });
    expect(navigate).toBeEnabled();
    fireEvent.click(navigate);

    expect(getPostedProtocolRequests('navigate_tree')).toEqual([]);
    expect(screen.getByRole('heading', { name: '暂时无法切换分支' })).toBeInTheDocument();
    expect(screen.getByText('会话正在运行，请等待当前操作完成后再切换分支。')).toBeInTheDocument();
  });

  it('keeps explicit branch-summary navigation available when skipPrompt is enabled', () => {
    renderTreeApp(makeTree(), 'tool-1', { skipPrompt: true });
    postMessage.mockClear();

    const targetRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/助手：provider exploded/));
    fireEvent.click(targetRow!);

    fireEvent.contextMenu(screen.getByRole('button', { name: '切换到此节点' }));
    fireEvent.click(screen.getByRole('radio', { name: '摘要被放弃的分支' }));
    fireEvent.click(screen.getByRole('button', { name: '继续切换' }));

    expect(getPostedProtocolRequests('navigate_tree').at(-1)?.payload).toMatchObject({
      type: 'navigate_tree',
      session: { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' },
      targetId: 'assistant-error-1',
      summarize: true,
    });
    expect(screen.getByRole('button', { name: '正在切换…' })).toBeDisabled();
    expect(document.querySelector('.lucide-loader-circle.animate-spin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止摘要' })).toBeEnabled();

    const request = getPostedProtocolRequests('navigate_tree').at(-1);
    fireEvent.click(screen.getByRole('button', { name: '停止摘要' }));
    expect(getPostedProtocolRequests('abort_tree_navigation').at(-1)?.payload).toEqual({
      type: 'abort_tree_navigation',
      navigationId: request!.payload.navigationId,
      session: { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' },
    });
    expect(screen.getByRole('button', { name: '正在停止…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在切换…' })).toBeDisabled();

    act(() => {
      routeExtensionMessage({
        type: 'protocol_response',
        requestId: request!.requestId,
        payload: {
          type: 'navigate_tree_result',
          navigationId: request!.payload.navigationId as string,
          status: 'cancelled',
        },
      });
    });

    expect(screen.getByRole('button', { name: '切换到此节点' })).toBeEnabled();
    expect(useUiStore.getState().notification).toBeUndefined();
  });

  it('uses the host phase to hide cancellation after navigation commits', () => {
    renderTreeApp(makeTree(), 'tool-1', { skipPrompt: true });
    const targetRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/助手：provider exploded/));
    fireEvent.click(targetRow!);
    fireEvent.contextMenu(screen.getByRole('button', { name: '切换到此节点' }));
    fireEvent.click(screen.getByRole('radio', { name: '摘要被放弃的分支' }));
    fireEvent.click(screen.getByRole('button', { name: '继续切换' }));
    const navigationId = getPostedProtocolRequests('navigate_tree').at(-1)!.payload
      .navigationId as string;
    expect(screen.getByRole('button', { name: '停止摘要' })).toBeEnabled();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: {
          kind: 'tree_navigation',
          operationId: navigationId,
          phase: 'reconciling',
          cancellable: false,
        },
      });
    });

    expect(screen.queryByRole('button', { name: '停止摘要' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在切换…' })).toBeDisabled();
  });

  it('shows aborting state for navigation restored from host state', () => {
    renderTreeApp();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: {
          kind: 'tree_navigation',
          operationId: 'navigation-restored',
          phase: 'preflight',
          cancellable: true,
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '停止切换' }));

    expect(getPostedProtocolRequests('abort_tree_navigation').at(-1)?.payload).toEqual({
      type: 'abort_tree_navigation',
      navigationId: 'navigation-restored',
      session: { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' },
    });
    expect(screen.getByRole('button', { name: '正在停止…' })).toBeDisabled();
  });

  it('cancels the pending tree navigation when the active session changes', () => {
    useSessionStore.setState({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
    });
    renderTreeApp(makeTree(), 'tool-1', { skipPrompt: true });
    postMessage.mockClear();

    const targetRow = screen
      .getAllByRole('treeitem')
      .find((row) => within(row).queryByText(/助手：provider exploded/));
    fireEvent.click(targetRow!);
    fireEvent.contextMenu(screen.getByRole('button', { name: '切换到此节点' }));
    fireEvent.click(screen.getByRole('radio', { name: '摘要被放弃的分支' }));
    fireEvent.click(screen.getByRole('button', { name: '继续切换' }));
    const request = getPostedProtocolRequests('navigate_tree').at(-1);

    act(() => {
      useSessionStore.setState({
        sessionId: 'session-2',
        sessionFile: '/sessions/session-2.jsonl',
      });
    });

    expect(postMessage.mock.calls.map(([message]) => message)).toContainEqual({
      type: 'protocol_cancel',
      requestId: request!.requestId,
    });
    expect(screen.queryByRole('button', { name: '停止摘要' })).not.toBeInTheDocument();
  });

  it('marks labels saved only after a successful label_result', () => {
    renderTreeApp();
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'before retry' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const failedRequest = getPostedProtocolRequests('set_label').at(-1);

    expect(document.querySelector('.lucide-message-circle-check')).not.toBeInTheDocument();

    routeProtocolResult(failedRequest, {
      type: 'label_result',
      success: false,
      error: 'Entry not found',
    });
    expect(document.querySelector('.lucide-message-circle-check')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const successfulRequest = getPostedProtocolRequests('set_label').at(-1);
    routeProtocolResult(successfulRequest, { type: 'label_result', success: true });

    expect(document.querySelector('.lucide-message-circle-check')).toBeInTheDocument();
  });
});
