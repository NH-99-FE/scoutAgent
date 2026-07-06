import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantProcessEntry } from '@/features/conversation/conversation-view-model';

const { registerExpansionNode, setExpanded } = vi.hoisted(() => ({
  registerExpansionNode: vi.fn(),
  setExpanded: vi.fn(),
}));

vi.mock('@/store/conversation-expansion-store', () => ({
  getProcessExpansionId: (key: string, scope: string) => `process:${scope}:${key}`,
  getToolDetailExpansionId: (key: string, scope: string) => `tool:${scope}:${key}`,
  useConversationExpansionOpen: () => false,
  useConversationExpansionStore: {
    getState: () => ({ actions: { setExpanded } }),
  },
}));

vi.mock('@/features/conversation/conversation-expansion-node', () => ({
  useRegisterConversationExpansionNode: registerExpansionNode,
}));

import { AssistantProcessBlock } from '@/features/conversation/AssistantProcessBlock';

describe('AssistantProcessBlock', () => {
  beforeEach(() => {
    registerExpansionNode.mockClear();
    setExpanded.mockClear();
  });

  it('does not rerender when process props are unchanged', () => {
    const entry = makeProcessEntry();
    const { rerender } = render(
      <AssistantProcessBlock entry={entry} expansionScope="test" parentExpansionId="parent" />,
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(registerExpansionNode).toHaveBeenCalledTimes(1);

    rerender(
      <AssistantProcessBlock entry={entry} expansionScope="test" parentExpansionId="parent" />,
    );

    expect(registerExpansionNode).toHaveBeenCalledTimes(1);
  });
});

function makeProcessEntry(): AssistantProcessEntry {
  return {
    type: 'process',
    key: 'process-1',
    lifecycle: 'active',
    summary: {
      status: 'model_deciding',
      label: '正在思考',
      running: true,
      tone: 'default',
    },
    displayMode: 'status',
    activitySummary: {
      items: [],
      mixed: false,
      totalCount: 0,
    },
    defaultOpen: false,
    phases: [],
  };
}
