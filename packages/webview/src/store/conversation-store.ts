// ============================================================
// Conversation Store — 消息流与运行状态
// ============================================================

import { create } from 'zustand';
import type {
  ScoutBusyState,
  ScoutChangesReviewSummary,
  ScoutChangesReviewUpdateEvent,
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
  displayArgs?: Record<string, unknown>;
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
  applyChangesReviewUpdate: (event: ScoutChangesReviewUpdateEvent) => void;
  applyRuntimeEvent: (event: ScoutRuntimeEvent) => void;
  setContextUsage: (contextUsage: ScoutContextUsage | undefined) => void;
  reset: () => void;
}

interface ConversationStore {
  messages: ScoutMessage[];
  messageKeys: string[];
  messageIndexByKey: Record<string, number>;
  conversationItems: ConversationItem[];
  isStreaming: boolean;
  busyState: ScoutBusyState;
  queueState: ScoutQueueState;
  activeChangesReview: ScoutChangesReviewSummary | undefined;
  contextUsage: ScoutContextUsage | undefined;
  sessionId: string;
  sessionFile: string;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById: Record<string, ToolCallPreviewState>;
  actions: ConversationActions;
}

type ConversationMessageState = Pick<
  ConversationStore,
  'messages' | 'messageKeys' | 'messageIndexByKey' | 'conversationItems'
>;

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
  messageIndexByKey: createEmptyMessageIndexByKey(),
  conversationItems: [] as ConversationItem[],
  isStreaming: false,
  busyState: IDLE_BUSY_STATE,
  queueState: EMPTY_QUEUE_STATE,
  activeChangesReview: undefined as ScoutChangesReviewSummary | undefined,
  contextUsage: undefined as ScoutContextUsage | undefined,
  sessionId: '',
  sessionFile: '',
  toolExecutionsById: {} as Record<string, ToolExecutionState>,
  toolPreviewsById: {} as Record<string, ToolCallPreviewState>,
};

function getStateMessageKeys(messages: ScoutMessage[]): string[] {
  return messages.map((message, index) => message.entryId ?? `state:${index}`);
}

function createMessageIndexByKey(messageKeys: string[]): Record<string, number> {
  const messageIndexByKey = createEmptyMessageIndexByKey();
  messageKeys.forEach((key, index) => {
    // 协议层应保证 key 唯一；若历史快照异常重复，保留 indexOf 的首个命中语义。
    messageIndexByKey[key] ??= index;
  });
  return messageIndexByKey;
}

function createEmptyMessageIndexByKey(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function appendMessageIndex(
  messageIndexByKey: Record<string, number>,
  key: string,
  index: number,
): Record<string, number> {
  return Object.assign(createEmptyMessageIndexByKey(), messageIndexByKey, { [key]: index });
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

function createConversationMessageState(
  messages: ScoutMessage[],
  previousItems: ConversationItem[] = [],
): ConversationMessageState {
  const messageKeys = getStateMessageKeys(messages);
  return {
    messages,
    messageKeys,
    messageIndexByKey: createMessageIndexByKey(messageKeys),
    conversationItems: createConversationItems(messages, messageKeys, previousItems),
  };
}

function replaceArrayItem<T>(items: T[], index: number, item: T): T[] {
  if (items[index] === item) return items;
  const nextItems = [...items];
  nextItems[index] = item;
  return nextItems;
}

function upsertProtocolMessage(
  state: ConversationMessageState,
  messageId: string,
  message: ScoutMessage,
): ConversationMessageState | undefined {
  const index = state.messageIndexByKey[messageId];
  if (index === undefined || index < 0 || index >= state.messages.length) {
    const nextMessages = [...state.messages, message];
    const nextMessageKeys = [...state.messageKeys, messageId];
    return {
      messages: nextMessages,
      messageKeys: nextMessageKeys,
      messageIndexByKey: appendMessageIndex(
        state.messageIndexByKey,
        messageId,
        state.messages.length,
      ),
      conversationItems: [...state.conversationItems, { key: messageId, message }],
    };
  }

  if (state.messages[index] === message) return undefined;
  const previousItem = state.conversationItems[index];
  const nextItem =
    previousItem?.key === messageId && previousItem.message === message
      ? previousItem
      : { key: messageId, message };
  return {
    messages: replaceArrayItem(state.messages, index, message),
    messageKeys: state.messageKeys,
    messageIndexByKey: state.messageIndexByKey,
    conversationItems: replaceArrayItem(state.conversationItems, index, nextItem),
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
      set((current) => {
        const conversationState = createConversationMessageState(
          state.messages,
          current.conversationItems,
        );
        return {
          ...conversationState,
          isStreaming: state.isStreaming,
          busyState: state.busyState,
          queueState: state.queueState ?? EMPTY_QUEUE_STATE,
          activeChangesReview: state.activeChangesReview,
          contextUsage: state.contextUsage,
          sessionId: state.sessionId ?? '',
          sessionFile: state.sessionFile ?? '',
          toolExecutionsById: {},
          toolPreviewsById: {},
        };
      }),
    applyRuntimeState: (state) => set(state),
    applyQueueState: (queueState) => set({ queueState }),
    applyChangesReviewUpdate: (event) =>
      set((state) => {
        if (!isChangesReviewUpdateForCurrentSession(event, state)) return {};
        return { activeChangesReview: event.changesReview };
      }),
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
            toolPreviewsById: {},
          };
        }
        if (
          event.type === 'message_start' ||
          event.type === 'message_update' ||
          event.type === 'message_end'
        ) {
          const nextMessages = upsertProtocolMessage(state, event.messageId, event.message);
          // 相同 message 引用的重复 runtime update 直接复用当前 state，让 Zustand 跳过通知。
          if (!nextMessages) return state;
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
                displayArgs: event.displayArgs,
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
          const toolPreviewsById = { ...state.toolPreviewsById };
          delete toolPreviewsById[event.toolCallId];
          return {
            toolExecutionsById: nextToolExecutionsById,
            toolPreviewsById,
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
  return isEventForCurrentSession(event.sessionId, event.sessionFile, state);
}

function isChangesReviewUpdateForCurrentSession(
  event: ScoutChangesReviewUpdateEvent,
  state: ConversationStore,
): boolean {
  return isEventForCurrentSession(event.sessionId, event.sessionFile, state);
}

function isEventForCurrentSession(
  eventSessionId: string,
  eventSessionFile: string | undefined,
  state: Pick<ConversationStore, 'sessionId' | 'sessionFile'>,
): boolean {
  if (!state.sessionId) return false;
  if (eventSessionId !== state.sessionId) return false;
  if (eventSessionFile && state.sessionFile && eventSessionFile !== state.sessionFile) return false;
  return true;
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
export const useActiveChangesReview = () =>
  useConversationStore((state) => state.activeChangesReview);
export const useContextUsage = () => useConversationStore((state) => state.contextUsage);
export const useToolExecutionsById = () =>
  useConversationStore((state) => state.toolExecutionsById);
export const useToolPreviewsById = () => useConversationStore((state) => state.toolPreviewsById);
export const useConversationActions = () => useConversationStore((state) => state.actions);
