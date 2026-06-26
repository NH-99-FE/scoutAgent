import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { TaskRow } from '@/features/tasks/TaskSearchPanel';
import { useConversationStore } from '@/store/conversation-store';
import { useRuntimeOverlayStore } from '@/store/runtime-overlay-store';
import { useSessionStore } from '@/store/session-store';

function makeTask(overrides: Partial<ScoutTaskItem> = {}): ScoutTaskItem {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    sessionPath: '/sessions/session-1.jsonl',
    title: '检查未提交更改',
    createdAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskRow', () => {
  beforeEach(() => {
    useConversationStore.getState().actions.reset();
    useRuntimeOverlayStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
  });

  it('replaces the time metadata with the fork marker through the row hover state', () => {
    render(
      <TaskRow
        task={makeTask({ parentSessionPath: '/sessions/source.jsonl' })}
        showCurrentState
        onOpen={vi.fn()}
      />,
    );

    const row = screen.getByRole('button', { name: /检查未提交更改/ });
    const marker = screen.getByTitle('分叉会话');
    const time = screen.getByText(/\d+\s*(分|小时|天)/);
    const metadata = time.closest('.task-row-metadata');

    expect(row.className).toContain('task-row');
    expect(row).toHaveAttribute('data-forked', 'true');
    expect(marker.className).toContain('task-row-fork-marker');
    expect(marker.className).toContain('right-0');
    expect(metadata).not.toBeNull();
    expect(marker.className).not.toContain('group-focus');
    expect(marker.parentElement).toBe(metadata?.parentElement);
  });

  it('shows a spinning loading marker after the time for the replying current session', () => {
    useSessionStore.setState({ sessionFile: '/sessions/current.jsonl' });
    useConversationStore.getState().actions.applyRuntimeState({
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });

    render(
      <TaskRow task={makeTask({ sessionPath: '/sessions/current.jsonl' })} onOpen={vi.fn()} />,
    );

    const marker = screen.getByLabelText('当前会话正在回复');
    const time = screen.getByText(/\d+\s*(分|小时|天)/);

    expect(marker).toHaveClass('animate-spin');
    expect(time.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render a fork marker for regular sessions', () => {
    const { container } = render(<TaskRow task={makeTask()} onOpen={vi.fn()} />);
    const row = screen.getByRole('button', { name: /检查未提交更改/ });

    expect(row).not.toHaveAttribute('data-forked');
    expect(container.querySelector('[title="分叉会话"]')).toBeNull();
  });

  it('keeps the task title visually truncated beside the right metadata', () => {
    render(
      <TaskRow
        task={makeTask({
          title: '这是一个非常非常非常非常长的任务标题用于确认历史记录行不会把右侧时间挤出可视区域',
          parentSessionPath: '/sessions/source.jsonl',
        })}
        onOpen={vi.fn()}
      />,
    );

    const title = screen.getByText(/这是一个非常非常/);
    const row = screen.getByRole('button', { name: /这是一个非常非常/ });

    expect(title).toHaveClass('min-w-0', 'truncate');
    expect(row.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
  });
});
