// ============================================================
// Conversation Store — 消息流与运行状态
// ============================================================

import { create } from 'zustand';
import type {
  ScoutBusyState,
  ScoutContextUsage,
  ScoutMessage,
  ScoutQueueState,
  ScoutRuntimeEvent,
  ScoutToolCallPreview,
  ScoutToolExecutionResult,
  ScoutWebviewState,
} from '@scout-agent/shared';

export interface ConversationItem {
  key: string;
  message: ScoutMessage;
}

export interface ToolExecutionState {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  partialResult?: ScoutToolExecutionResult;
  result?: ScoutToolExecutionResult;
  isError: boolean;
}

export interface ToolCallPreviewState {
  toolCallId: string;
  toolName: string;
  preview: ScoutToolCallPreview;
}

interface ConversationActions {
  applyStateSnapshot: (state: ScoutWebviewState) => void;
  applyRuntimeState: (state: Pick<ConversationStore, 'isStreaming' | 'busyState'>) => void;
  applyQueueState: (queueState: ScoutQueueState) => void;
  applyRuntimeEvent: (event: ScoutRuntimeEvent) => void;
  setContextUsage: (contextUsage: ScoutContextUsage | undefined) => void;
  reset: () => void;
}

interface ConversationStore {
  messages: ScoutMessage[];
  messageKeys: string[];
  conversationItems: ConversationItem[];
  isStreaming: boolean;
  busyState: ScoutBusyState;
  queueState: ScoutQueueState;
  contextUsage: ScoutContextUsage | undefined;
  sessionId: string;
  sessionFile: string;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById: Record<string, ToolCallPreviewState>;
  actions: ConversationActions;
}

export const IDLE_BUSY_STATE: ScoutBusyState = {
  kind: 'idle',
  cancellable: false,
};

const EMPTY_QUEUE_STATE: ScoutQueueState = {
  messages: [],
  followUps: [],
  paused: false,
};

const initialState = {
  messages: [] as ScoutMessage[],
  messageKeys: [] as string[],
  conversationItems: [] as ConversationItem[],
  isStreaming: false,
  busyState: IDLE_BUSY_STATE,
  queueState: EMPTY_QUEUE_STATE,
  contextUsage: undefined as ScoutContextUsage | undefined,
  sessionId: '',
  sessionFile: '',
  toolExecutionsById: {} as Record<string, ToolExecutionState>,
  toolPreviewsById: {} as Record<string, ToolCallPreviewState>,
};

function getStateMessageKeys(messages: ScoutMessage[]): string[] {
  return messages.map((message, index) => message.entryId ?? `state:${index}`);
}

function createConversationItems(
  messages: ScoutMessage[],
  messageKeys: string[],
  previousItems: ConversationItem[] = [],
): ConversationItem[] {
  return messages.map((message, index) => {
    const key = messageKeys[index] ?? message.entryId ?? `state:${index}`;
    const previous = previousItems[index];
    if (previous?.key === key && previous.message === message) return previous;
    return { key, message };
  });
}

function upsertProtocolMessage(
  messages: ScoutMessage[],
  messageKeys: string[],
  conversationItems: ConversationItem[],
  messageId: string,
  message: ScoutMessage,
): Pick<ConversationStore, 'messages' | 'messageKeys' | 'conversationItems'> {
  const index = messageKeys.indexOf(messageId);
  if (index < 0) {
    const nextMessages = [...messages, message];
    const nextMessageKeys = [...messageKeys, messageId];
    return {
      messages: nextMessages,
      messageKeys: nextMessageKeys,
      conversationItems: createConversationItems(nextMessages, nextMessageKeys, conversationItems),
    };
  }

  const nextMessages = [...messages];
  nextMessages[index] = message;
  return {
    messages: nextMessages,
    messageKeys,
    conversationItems: createConversationItems(nextMessages, messageKeys, conversationItems),
  };
}

function keepSettledToolExecutions(
  toolExecutionsById: Record<string, ToolExecutionState>,
): Record<string, ToolExecutionState> {
  return Object.fromEntries(
    Object.entries(toolExecutionsById).filter(([, execution]) => execution.status !== 'running'),
  );
}

export const useConversationStore = create<ConversationStore>((set) => ({
  ...initialState,
  actions: {
    applyStateSnapshot: (state) =>
      set(() => {
        const messageKeys = getStateMessageKeys(state.messages);
        return {
          messages: state.messages,
          messageKeys,
          conversationItems: createConversationItems(state.messages, messageKeys),
          isStreaming: state.isStreaming,
          busyState: state.busyState,
          queueState: state.queueState ?? EMPTY_QUEUE_STATE,
          contextUsage: state.contextUsage,
          sessionId: state.sessionId ?? '',
          sessionFile: state.sessionFile ?? '',
          toolExecutionsById: {},
          toolPreviewsById: {},
        };
      }),
    applyRuntimeState: (state) => set(state),
    applyQueueState: (queueState) => set({ queueState }),
    applyRuntimeEvent: (event) =>
      set((state) => {
        if (event.type === 'agent_start') {
          return {
            toolExecutionsById: {},
            toolPreviewsById: {},
          };
        }
        if (event.type === 'agent_end') {
          return {
            toolExecutionsById: keepSettledToolExecutions(state.toolExecutionsById),
          };
        }
        if (
          event.type === 'message_start' ||
          event.type === 'message_update' ||
          event.type === 'message_end'
        ) {
          const nextMessages = upsertProtocolMessage(
            state.messages,
            state.messageKeys,
            state.conversationItems,
            event.messageId,
            event.message,
          );
          return {
            ...nextMessages,
          };
        }
        if (event.type === 'tool_execution_start') {
          return {
            toolExecutionsById: {
              ...state.toolExecutionsById,
              [event.toolCallId]: {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                status: 'running',
                isError: false,
              },
            },
          };
        }
        if (event.type === 'tool_execution_update') {
          const existing = state.toolExecutionsById[event.toolCallId];
          return {
            toolExecutionsById: {
              ...state.toolExecutionsById,
              [event.toolCallId]: {
                ...existing,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: 'running',
                partialResult: event.partialResult,
                isError: false,
              },
            },
          };
        }
        if (event.type === 'tool_execution_end') {
          const existing = state.toolExecutionsById[event.toolCallId];
          const status: ToolExecutionState['status'] = event.isError ? 'error' : 'done';
          const nextToolExecutionsById: Record<string, ToolExecutionState> = {
            ...state.toolExecutionsById,
            [event.toolCallId]: {
              ...existing,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status,
              result: event.result,
              isError: event.isError,
            },
          };
          return {
            toolExecutionsById: nextToolExecutionsById,
          };
        }
        if (event.type === 'tool_call_preview_update') {
          if (!isPreviewForCurrentSession(event, state)) return {};
          return {
            toolPreviewsById: {
              ...state.toolPreviewsById,
              [event.toolCallId]: {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                preview: event.preview,
              },
            },
          };
        }
        return {};
      }),
    setContextUsage: (contextUsage) => set({ contextUsage }),
    reset: () => set(initialState),
  },
}));

function isPreviewForCurrentSession(
  event: Extract<ScoutRuntimeEvent, { type: 'tool_call_preview_update' }>,
  state: ConversationStore,
): boolean {
  if (!state.sessionId) return false;
  return event.sessionId === state.sessionId && (event.sessionFile ?? '') === state.sessionFile;
}

export const useConversationMessages = () => useConversationStore((state) => state.messages);
export const useConversationItems = () => useConversationStore((state) => state.conversationItems);
export const useConversationForkCandidateVersion = () =>
  useConversationStore((state) =>
    state.messages
      .filter((message) => message.role === 'user')
      .map((message, index) => message.entryId ?? `user:${index}:${message.timestamp}`)
      .join('\n'),
  );
export const useConversationMessageCount = () =>
  useConversationStore((state) => state.messages.length);
export const useIsStreaming = () => useConversationStore((state) => state.isStreaming);
export const useBusyState = () => useConversationStore((state) => state.busyState);
export const useQueueState = () => useConversationStore((state) => state.queueState);
export const useQueuedFollowUps = () => useConversationStore((state) => state.queueState.followUps);
export const useContextUsage = () => useConversationStore((state) => state.contextUsage);
export const useToolExecutionsById = () =>
  useConversationStore((state) => state.toolExecutionsById);
export const useToolPreviewsById = () => useConversationStore((state) => state.toolPreviewsById);
export const useConversationActions = () => useConversationStore((state) => state.actions);
