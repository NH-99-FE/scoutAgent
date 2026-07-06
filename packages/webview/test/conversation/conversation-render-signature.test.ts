import { describe, expect, it } from 'vitest';
import {
  areRenderSignaturesEqual,
  createAssistantChangesReviewListSignature,
  createAssistantEntrySignature,
} from '@/features/conversation/render-model/conversation-render-signature';
import type {
  AssistantChangesReview,
  AssistantProcessActivity,
  AssistantTurnEntry,
  AssistantVisibleContent,
} from '@/features/conversation/render-model/conversation-view-model';

type EntryFactories = {
  [Type in AssistantTurnEntry['type']]: () => Extract<AssistantTurnEntry, { type: Type }>;
};

type ActivityFactories = {
  [Type in AssistantProcessActivity['type']]: () => Extract<
    AssistantProcessActivity,
    { type: Type }
  >;
};

type VisibleContentFactories = {
  [Type in AssistantVisibleContent['type']]: () => Extract<AssistantVisibleContent, { type: Type }>;
};

const VISIBLE_CONTENT_FACTORIES = {
  image: () => ({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }),
  text: () => ({ type: 'text', text: 'hello' }),
} satisfies VisibleContentFactories;

const ACTIVITY_FACTORIES = {
  status: () => ({
    type: 'status',
    key: 'status-1',
    text: '正在运行工具',
    running: true,
  }),
  thinking: () => ({
    type: 'thinking',
    key: 'thinking-1',
    content: { type: 'thinking', thinking: '分析中', redacted: false },
    isStreaming: true,
    messageKey: 'assistant-1',
  }),
  tool: () => ({
    type: 'tool',
    key: 'tool-1',
    toolCall: {
      type: 'toolCall',
      id: 'tool-1',
      name: 'edit',
      arguments: { path: 'src/app.ts' },
    },
    display: {
      kind: 'generic',
      status: 'running',
      toolName: 'edit',
      summary: { title: '正在编辑 src/app.ts' },
      icon: 'edit',
      detail: { kind: 'text', title: '输出', text: 'done', completionLabel: '成功' },
    },
  }),
} satisfies ActivityFactories;

const ENTRY_FACTORIES = {
  content: () => ({
    type: 'content',
    key: 'content-1',
    blocks: Object.values(VISIBLE_CONTENT_FACTORIES).map((factory) => factory()),
    timestamp: 1,
  }),
  process: () => ({
    type: 'process',
    key: 'process-1',
    lifecycle: 'active',
    displayMode: 'live',
    defaultOpen: true,
    summary: {
      status: 'work_processing',
      label: '正在处理',
      running: true,
      tone: 'default',
    },
    activitySummary: {
      items: [],
      mixed: false,
      totalCount: 0,
    },
    phases: [
      {
        key: 'phase-1',
        kind: 'tool_processing',
        activities: Object.values(ACTIVITY_FACTORIES).map((factory) => factory()),
      },
    ],
  }),
} satisfies EntryFactories;

describe('conversation render signatures', () => {
  it('covers every assistant entry, activity, and visible content variant', () => {
    const signatures = Object.values(ENTRY_FACTORIES).map((factory) =>
      createAssistantEntrySignature(factory()),
    );

    expect(signatures.every((signature) => signature.length > 0)).toBe(true);
  });

  it('keeps stable object key order for equivalent display payloads', () => {
    const first = ENTRY_FACTORIES.process();
    const second = ENTRY_FACTORIES.process();
    const firstTool = first.phases[0]?.activities.find((activity) => activity.type === 'tool');
    const secondTool = second.phases[0]?.activities.find((activity) => activity.type === 'tool');
    if (firstTool?.type !== 'tool' || secondTool?.type !== 'tool') {
      throw new Error('Expected tool activities');
    }

    firstTool.display = {
      ...firstTool.display,
      detail: { kind: 'text', title: '输出', text: 'done', completionLabel: '成功' },
    };
    secondTool.display = {
      ...secondTool.display,
      detail: { completionLabel: '成功', text: 'done', title: '输出', kind: 'text' },
    };

    expect(
      areRenderSignaturesEqual(
        createAssistantEntrySignature(first),
        createAssistantEntrySignature(second),
      ),
    ).toBe(true);
  });

  it('invalidates changes review signatures when display metrics change', () => {
    const firstReview = makeChangesReview({ additions: 1 });
    const secondReview = makeChangesReview({ additions: 2 });

    expect(
      areRenderSignaturesEqual(
        createAssistantChangesReviewListSignature([firstReview]),
        createAssistantChangesReviewListSignature([secondReview]),
      ),
    ).toBe(false);
  });
});

function makeChangesReview({ additions }: { additions: number }): AssistantChangesReview {
  return {
    key: 'changes-review:turn-1',
    turnId: 'turn-1',
    fileCount: 1,
    additions,
    deletions: 0,
    files: [
      {
        path: 'src/app.ts',
        displayPath: 'app.ts',
        additions,
        deletions: 0,
      },
    ],
  };
}
