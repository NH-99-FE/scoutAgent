import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FileDiffContextResultMessage,
  ScoutChangesReviewFile,
  ScoutChangesReviewRow,
} from '@scout-agent/shared';

const mocks = vi.hoisted(() => ({
  requestFileDiffContext: vi.fn((_options?: unknown) => ({ cancel: vi.fn() })),
  useFileDiff: vi.fn(),
}));

vi.mock('@/bridge/protocol-client', () => ({
  protocolClient: { requestFileDiffContext: mocks.requestFileDiffContext },
}));

vi.mock('@/features/changes-review/model/use-file-diff', () => ({
  useFileDiff: mocks.useFileDiff,
}));

import { ReviewFileSection } from '@/features/changes-review/view/ReviewFileSection';

const FILE: ScoutChangesReviewFile = {
  id: 'file-anchor',
  path: 'src/file.ts',
  absolutePath: '/workspace/src/file.ts',
  external: false,
  additions: 1,
  deletions: 1,
  sessionId: 'session-1',
  fileId: 'file-1',
  revision: 1,
  projectionStatus: 'ready',
  recordIds: ['record-1'],
  rows: [],
};

describe('ReviewFileSection fold context', () => {
  beforeEach(() => {
    mocks.requestFileDiffContext.mockReset();
    mocks.requestFileDiffContext.mockReturnValue({ cancel: vi.fn() });
    mocks.useFileDiff.mockReset();
    mocks.useFileDiff.mockReturnValue({
      status: 'ready',
      diff: {
        mode: 'unified',
        rows: [{ type: 'fold', count: 50, foldId: 'fold-1', foldTotal: 50 }],
        additions: 1,
        deletions: 1,
        hunkOffset: 0,
        hunkCount: 1,
        totalHunks: 1,
      },
    });
  });

  it('reveals at most 20 rows per success and retries a failed increment in place', async () => {
    const requests: Array<{
      payload: { revealHead: number; revealTail: number };
      onResult: (result: FileDiffContextResultMessage) => void;
      onError: () => void;
    }> = [];
    mocks.requestFileDiffContext.mockImplementation((options?: unknown) => {
      requests.push(options as (typeof requests)[number]);
      return { cancel: vi.fn() };
    });

    render(
      <ReviewFileSection
        expanded
        file={FILE}
        fileKey="file-1"
        onOpenFile={vi.fn()}
        onToggleFile={vi.fn()}
        turnId="turn-1"
        viewMode="unified"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开更多上下文' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.payload).toMatchObject({ revealHead: 10, revealTail: 10 });

    act(() => requests[0]?.onError());
    expect(screen.getByText('数据异常，点击重试')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开更多上下文' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.payload).toMatchObject({ revealHead: 10, revealTail: 10 });

    act(() =>
      requests[1]?.onResult(
        readyContextResult({
          headRows: contextRows(1, 10),
          tailRows: contextRows(41, 10),
          total: 50,
        }),
      ),
    );
    expect(screen.getByText('30 unmodified lines')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开更多上下文' }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]?.payload).toMatchObject({ revealHead: 20, revealTail: 20 });
  });
});

function contextRows(start: number, count: number): ScoutChangesReviewRow[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'context',
    oldLineNumber: start + index,
    newLineNumber: start + index,
    text: `line ${start + index}`,
  }));
}

function readyContextResult({
  headRows,
  tailRows,
  total,
}: {
  headRows: ScoutChangesReviewRow[];
  tailRows: ScoutChangesReviewRow[];
  total: number;
}): FileDiffContextResultMessage {
  return {
    type: 'file_diff_context_result',
    turnId: 'turn-1',
    fileId: 'file-1',
    revision: 1,
    foldId: 'fold-1',
    status: 'ready',
    headRows,
    tailRows,
    total,
  };
}
