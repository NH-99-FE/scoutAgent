// ============================================================
// Conversation Store — 消息流与运行状态
// ============================================================

import { create } from 'zustand';
import type {
  ScoutAgentEvent,
  ScoutBusyState,
  ScoutContextUsage,
  ScoutMessage,
  ScoutQueueState,
  ScoutWebviewState,
} from '@scout-agent/shared';

interface ConversationActions {
  applyState: (state: ScoutWebviewState) => void;
  applyQueueState: (queueState: ScoutQueueState) => void;
  applyAgentEvent: (event: ScoutAgentEvent) => void;
  setContextUsage: (contextUsage: ScoutContextUsage | undefined) => void;
  setBusyState: (busyState: ScoutBusyState, isStreaming?: boolean) => void;
  reset: () => void;
}

interface ConversationStore {
  messages: ScoutMessage[];
  messageKeys: string[];
  isStreaming: boolean;
  busyState: ScoutBusyState;
  queueState: ScoutQueueState;
  contextUsage: ScoutContextUsage | undefined;
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
  isStreaming: false,
  busyState: IDLE_BUSY_STATE,
  queueState: EMPTY_QUEUE_STATE,
  contextUsage: undefined as ScoutContextUsage | undefined,
};

function getStateMessageKeys(messages: ScoutMessage[]): string[] {
  return messages.map((message, index) => message.entryId ?? `state:${index}`);
}

function upsertProtocolMessage(
  messages: ScoutMessage[],
  messageKeys: string[],
  messageId: string,
  message: ScoutMessage,
): Pick<ConversationStore, 'messages' | 'messageKeys'> {
  const index = messageKeys.indexOf(messageId);
  if (index < 0) {
    return {
      messages: [...messages, message],
      messageKeys: [...messageKeys, messageId],
    };
  }

  const nextMessages = [...messages];
  nextMessages[index] = message;
  return {
    messages: nextMessages,
    messageKeys,
  };
}

export const useConversationStore = create<ConversationStore>((set) => ({
  ...initialState,
  actions: {
    applyState: (state) =>
      set({
        messages: state.messages,
        messageKeys: getStateMessageKeys(state.messages),
        isStreaming: state.isStreaming,
        busyState: state.busyState,
        queueState: state.queueState ?? EMPTY_QUEUE_STATE,
        contextUsage: state.contextUsage,
      }),
    applyQueueState: (queueState) => set({ queueState }),
    applyAgentEvent: (event) =>
      set((state) => {
        if (event.type === 'agent_start') {
          return {
            isStreaming: true,
            busyState: { kind: 'agent', label: 'Working', cancellable: true },
          };
        }
        if (event.type === 'agent_end') {
          return {
            isStreaming: event.willRetry,
            busyState: event.willRetry
              ? { kind: 'retry', label: 'Retrying', cancellable: true }
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
        return {};
      }),
    setContextUsage: (contextUsage) => set({ contextUsage }),
    setBusyState: (busyState, isStreaming) =>
      set({ busyState, ...(typeof isStreaming === 'boolean' ? { isStreaming } : {}) }),
    reset: () => set(initialState),
  },
}));

export const useConversationMessages = () => useConversationStore((state) => state.messages);
export const useConversationMessageCount = () =>
  useConversationStore((state) => state.messages.length);
export const useIsStreaming = () => useConversationStore((state) => state.isStreaming);
export const useBusyState = () => useConversationStore((state) => state.busyState);
export const useQueueState = () => useConversationStore((state) => state.queueState);
export const useQueuedFollowUps = () =>
  useConversationStore((state) => state.queueState.followUps);
export const useContextUsage = () => useConversationStore((state) => state.contextUsage);
export const useConversationActions = () => useConversationStore((state) => state.actions);
