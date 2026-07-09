// ============================================================
// Runtime Overlay Store — 本地运行态视觉投影
// ============================================================

import { create } from 'zustand';
import type { ScoutMessage, ScoutRuntimeEvent, ScoutWebviewState } from '@scout-agent/shared';
import { IDLE_BUSY_STATE, useConversationStore } from './conversation-store';

type RuntimeMessageEvent = Extract<
  ScoutRuntimeEvent,
  { type: 'message_start' | 'message_update' | 'message_end' }
>;

interface RuntimeOverlayActions {
  beginLocalAbort: () => void;
  projectRuntimeEvent: (event: ScoutRuntimeEvent) => boolean;
  projectStateSnapshot: (state: ScoutWebviewState) => ScoutWebviewState;
  reset: () => void;
}

interface RuntimeOverlayStore {
  localAbortSettling: boolean;
  sessionId: string;
  actions: RuntimeOverlayActions;
}

interface RuntimeMessageFlowState {
  ended: boolean;
  role: ScoutMessage['role'];
}

const runtimeMessageFlow = new Map<string, RuntimeMessageFlowState>();
const activeAssistantMessageIds = new Set<string>();
const locallyAbortedMessageIds = new Set<string>();
const hiddenRuntimeMessageIds = new Set<string>();
const hiddenAssistantSnapshotKeys = new Set<string>();
const visibleAssistantSnapshotKeys = new Set<string>();
let hideNextAssistantMessage = false;

function resetRuntimeGuards(): void {
  runtimeMessageFlow.clear();
  activeAssistantMessageIds.clear();
  locallyAbortedMessageIds.clear();
  hiddenRuntimeMessageIds.clear();
  hiddenAssistantSnapshotKeys.clear();
  visibleAssistantSnapshotKeys.clear();
  hideNextAssistantMessage = false;
}

function trackVisibleAssistantSnapshotKeys(messages: ScoutMessage[]): void {
  visibleAssistantSnapshotKeys.clear();
  for (const message of messages) {
    for (const key of getAssistantSnapshotKeys(message)) {
      visibleAssistantSnapshotKeys.add(key);
    }
  }
}

function findActiveAssistantMessageId(): string | undefined {
  const ids = [...activeAssistantMessageIds];
  return ids.at(-1);
}

function trackRuntimeMessageEvent(event: RuntimeMessageEvent): void {
  const flow = runtimeMessageFlow.get(event.messageId) ?? {
    ended: false,
    role: event.message.role,
  };
  flow.role = event.message.role;
  flow.ended = event.type === 'message_end';
  runtimeMessageFlow.set(event.messageId, flow);

  if (event.message.role !== 'assistant') return;
  if (event.type === 'message_end') {
    activeAssistantMessageIds.delete(event.messageId);
    return;
  }
  activeAssistantMessageIds.add(event.messageId);
}

function hideRuntimeAssistantMessage(event: RuntimeMessageEvent): void {
  hiddenRuntimeMessageIds.add(event.messageId);
  hideNextAssistantMessage = false;
  rememberHiddenAssistantSnapshot(event.message);
}

function shouldDropMessageEvent(event: RuntimeMessageEvent, localAbortSettling: boolean): boolean {
  const flow = runtimeMessageFlow.get(event.messageId);
  if (event.type === 'message_update' && flow?.ended) return true;
  if (event.message.role !== 'assistant') return false;

  if (hiddenRuntimeMessageIds.has(event.messageId)) {
    rememberHiddenAssistantSnapshot(event.message);
    if (event.type === 'message_end') {
      hiddenRuntimeMessageIds.delete(event.messageId);
      locallyAbortedMessageIds.delete(event.messageId);
    }
    return true;
  }

  if (hideNextAssistantMessage) {
    hideRuntimeAssistantMessage(event);
    return true;
  }

  if (
    event.type === 'message_update' &&
    (localAbortSettling || locallyAbortedMessageIds.has(event.messageId))
  ) {
    return true;
  }

  return false;
}

function filterStateMessages(messages: ScoutMessage[]): ScoutMessage[] {
  if (hiddenAssistantSnapshotKeys.size === 0) return messages;
  return messages.filter((message) => {
    return (
      message.role !== 'assistant' ||
      !getAssistantSnapshotKeys(message).some((key) => hiddenAssistantSnapshotKeys.has(key))
    );
  });
}

function rememberHiddenAssistantSnapshot(message: ScoutMessage): void {
  const keys = getHiddenAssistantSnapshotKeys(message);
  if (keys.length === 0) return;
  if (keys.some((key) => visibleAssistantSnapshotKeys.has(key))) return;
  for (const key of keys) {
    hiddenAssistantSnapshotKeys.add(key);
  }
}

function getAssistantSnapshotKeys(message: ScoutMessage): string[] {
  if (message.role !== 'assistant') return [];
  const keys = [getAssistantFingerprintKey(message)];
  if (message.entryId) {
    keys.push(`entry:${message.entryId}`);
  }
  return keys;
}

function getHiddenAssistantSnapshotKeys(message: ScoutMessage): string[] {
  if (message.role !== 'assistant') return [];
  return message.entryId ? [`entry:${message.entryId}`] : [getAssistantFingerprintKey(message)];
}

function getAssistantFingerprintKey(message: Extract<ScoutMessage, { role: 'assistant' }>): string {
  return `fingerprint:${message.timestamp}\u0000${message.stopReason ?? ''}\u0000${
    message.errorMessage ?? ''
  }\u0000${stableStringify(message.content)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export const useRuntimeOverlayStore = create<RuntimeOverlayStore>((set, get) => ({
  localAbortSettling: false,
  sessionId: '',
  actions: {
    beginLocalAbort: () => {
      const messageId = findActiveAssistantMessageId();
      if (messageId) {
        locallyAbortedMessageIds.add(messageId);
      } else {
        hideNextAssistantMessage = true;
      }
      set({ localAbortSettling: true });
    },
    projectRuntimeEvent: (event) => {
      if (event.type === 'agent_start') {
        resetRuntimeGuards();
        set({ localAbortSettling: false });
        return true;
      }

      if (
        event.type === 'message_start' ||
        event.type === 'message_update' ||
        event.type === 'message_end'
      ) {
        if (shouldDropMessageEvent(event, get().localAbortSettling)) {
          return false;
        }
        trackRuntimeMessageEvent(event);
        if (event.type === 'message_end') {
          locallyAbortedMessageIds.delete(event.messageId);
        }
      }

      return true;
    },
    projectStateSnapshot: (state) => {
      const currentSessionId = get().sessionId;
      const nextSessionId = state.sessionId ?? '';
      if (currentSessionId && nextSessionId && currentSessionId !== nextSessionId) {
        resetRuntimeGuards();
        set({ localAbortSettling: false, sessionId: nextSessionId });
        trackVisibleAssistantSnapshotKeys(state.messages);
        return state;
      }

      set({ sessionId: nextSessionId });
      const messages = filterStateMessages(state.messages);
      trackVisibleAssistantSnapshotKeys(messages);
      return messages === state.messages ? state : { ...state, messages };
    },
    reset: () => {
      resetRuntimeGuards();
      set({ localAbortSettling: false, sessionId: '' });
    },
  },
}));

export const useVisualIsStreaming = () => {
  const localAbortSettling = useRuntimeOverlayStore((state) => state.localAbortSettling);
  const isStreaming = useConversationStore((state) => state.isStreaming);
  return localAbortSettling ? false : isStreaming;
};

export const useVisualBusyState = () => {
  const localAbortSettling = useRuntimeOverlayStore((state) => state.localAbortSettling);
  const busyState = useConversationStore((state) => state.busyState);
  return localAbortSettling ? IDLE_BUSY_STATE : busyState;
};

export function getVisualBusyStateSnapshot() {
  const localAbortSettling = useRuntimeOverlayStore.getState().localAbortSettling;
  const busyState = useConversationStore.getState().busyState;
  return localAbortSettling ? IDLE_BUSY_STATE : busyState;
}

export const useRuntimeOverlayActions = () => useRuntimeOverlayStore((state) => state.actions);
