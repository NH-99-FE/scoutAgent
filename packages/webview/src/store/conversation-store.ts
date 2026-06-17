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

interface ConversationActions {
  applyStateSnapshot: (state: ScoutWebviewState) => void;
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
  toolExecutionsById: Record<string, ToolExecutionState>;
  actions: ConversationActions;
}

const IDLE_BUSY_STATE: ScoutBusyState = {
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
  toolExecutionsById: {} as Record<string, ToolExecutionState>,
};

function getStateMessageKeys(messages: ScoutMessage[]): string[] {
  return messages.map((message, index) => message.entryId ?? `state:${index}`);
}

function createConversationItems(
  messages: ScoutMessage[],
  messageKeys: string[],
): ConversationItem[] {
  return messages.map((message, index) => ({
    key: messageKeys[index] ?? message.entryId ?? `state:${index}`,
    message,
  }));
}

function upsertProtocolMessage(
  messages: ScoutMessage[],
  messageKeys: string[],
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
      conversationItems: createConversationItems(nextMessages, nextMessageKeys),
    };
  }

  const nextMessages = [...messages];
  nextMessages[index] = message;
  return {
    messages: nextMessages,
    messageKeys,
    conversationItems: createConversationItems(nextMessages, messageKeys),
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
          toolExecutionsById: {},
        };
      }),
    applyQueueState: (queueState) => set({ queueState }),
    applyRuntimeEvent: (event) =>
      set((state) => {
        if (event.type === 'agent_start') {
          return {
            isStreaming: true,
            busyState: { kind: 'agent', label: 'Working', cancellable: true },
            toolExecutionsById: {},
          };
        }
        if (event.type === 'agent_end') {
          return {
            isStreaming: event.willRetry,
            busyState: event.willRetry
              ? { kind: 'retry', label: 'Retrying', cancellable: true }
              : IDLE_BUSY_STATE,
            toolExecutionsById: keepSettledToolExecutions(state.toolExecutionsById),
          };
        }
        if (event.type === 'auto_retry_start') {
          return {
            isStreaming: true,
            busyState: {
              kind: 'retry',
              label: 'Retrying',
              cancellable: true,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              reason: event.errorMessage,
            },
          };
        }
        if (event.type === 'auto_retry_end') {
          if (state.busyState.kind !== 'retry') return {};
          return {
            isStreaming: false,
            busyState: IDLE_BUSY_STATE,
          };
        }
        if (event.type === 'compaction_start') {
          return {
            isStreaming: true,
            busyState: {
              kind: 'compaction',
              label: 'Compacting',
              cancellable: true,
              reason: event.reason,
            },
          };
        }
        if (event.type === 'compaction_end') {
          return {
            isStreaming: event.willRetry,
            busyState: event.willRetry
              ? { kind: 'retry', label: 'Retrying', cancellable: true, reason: event.reason }
              : IDLE_BUSY_STATE,
          };
        }
        if (
          event.type === 'message_start' ||
          event.type === 'message_update' ||
          event.type === 'message_end'
        ) {
          return upsertProtocolMessage(
            state.messages,
            state.messageKeys,
            event.messageId,
            event.message,
          );
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
          return {
            toolExecutionsById: {
              ...state.toolExecutionsById,
              [event.toolCallId]: {
                ...existing,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: event.isError ? 'error' : 'done',
                result: event.result,
                isError: event.isError,
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

export const useConversationMessages = () => useConversationStore((state) => state.messages);
export const useConversationItems = () => useConversationStore((state) => state.conversationItems);
export const useConversationMessageCount = () =>
  useConversationStore((state) => state.messages.length);
export const useIsStreaming = () => useConversationStore((state) => state.isStreaming);
export const useBusyState = () => useConversationStore((state) => state.busyState);
export const useQueueState = () => useConversationStore((state) => state.queueState);
export const useQueuedFollowUps = () => useConversationStore((state) => state.queueState.followUps);
export const useContextUsage = () => useConversationStore((state) => state.contextUsage);
export const useToolExecutionsById = () =>
  useConversationStore((state) => state.toolExecutionsById);
export const useConversationActions = () => useConversationStore((state) => state.actions);
