import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { NodeInspector } from '@/surfaces/tree/NodeInspector';

function makeAssistantNode(): ScoutSessionTreeNode {
  return {
    id: 'assistant-long',
    parentId: null,
    timestamp: '2026-06-26T10:20:30.000Z',
    type: 'message',
    kind: 'assistant',
    role: 'assistant',
    preview:
      '403 The free tier of the model has been exhausted. If you wish to continue access the model on a paid basis, please disable the "use free tier only" mode in the management console.',
    children: [],
  };
}

describe('NodeInspector', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the selected node type without repeating the preview as a title', () => {
    render(
      <NodeInspector
        customInstructions=""
        labelDraft=""
        labelSaved={false}
        node={makeAssistantNode()}
        summaryMode="none"
        onCustomInstructionsChange={() => undefined}
        onLabelDraftChange={() => undefined}
        onNavigate={() => undefined}
        onSaveLabel={() => undefined}
        onSummaryModeChange={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: '助手消息' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /助手：403 The free tier/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^403 The free tier/)).toBeInTheDocument();
  });
});
