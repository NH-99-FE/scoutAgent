// ============================================================
// Chat Composer — 底部输入与运行控制
// ============================================================

import type { KeyboardEvent } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { ScoutImageContent } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { markProgrammaticFocus } from '@/components/ui/focus';
import { useCommands } from '@/store/config-store';
import {
  useComposerActions,
  useComposerImages,
  useComposerText,
  usePendingComposerCommandEffect,
} from '@/store/composer-store';
import {
  useConversationForkCandidateVersion,
  useIsStreaming,
  useQueueState,
} from '@/store/conversation-store';
import {
  useRuntimeOverlayActions,
  useVisualBusyState,
  useVisualIsStreaming,
} from '@/store/runtime-overlay-store';
import { useSessionId } from '@/store/session-store';
import { useUiActions } from '@/store/ui-store';
import { ModelStatusMenu } from '@/features/model-menu/ModelStatusMenu';
import { ComposerTextarea, type ComposerSubmitDelivery } from './ComposerTextarea';
import { ForkCandidateMenu } from './ForkCandidateMenu';
import { PendingQueueSendDialog } from './PendingQueueSendDialog';
import { SendButton } from './SendButton';
import { SlashCommandMenu } from './SlashCommandMenu';
import { buildSlashCommandItems, type SlashCommandMenuItem } from './slash-command-options';
import { useForkCandidateMenu } from './use-fork-candidate-menu';
import { getSlashCommandTrigger } from './use-slash-command-trigger';

interface BaseChatComposerProps {
  draftSessionId?: string;
  onMessageSent?: () => void;
  placeholder: string;
  submitDisabled?: boolean;
}

interface CurrentSessionChatComposerProps extends BaseChatComposerProps {
  mode?: 'currentSession';
  onBeginNewSessionRequest?: never;
}

interface NewSessionChatComposerProps extends BaseChatComposerProps {
  draftSessionId: string;
  mode: 'newSession';
  submitDisabled: boolean;
  onBeginNewSessionRequest: () => void;
}

type ChatComposerProps = CurrentSessionChatComposerProps | NewSessionChatComposerProps;

interface BaseChatComposerSessionProps {
  onMessageSent?: () => void;
  placeholder: string;
  sessionId: string;
  submitDisabled: boolean;
}

interface CurrentSessionChatComposerSessionProps extends BaseChatComposerSessionProps {
  mode: 'currentSession';
  onBeginNewSessionRequest?: never;
}

interface NewSessionChatComposerSessionProps extends BaseChatComposerSessionProps {
  mode: 'newSession';
  onBeginNewSessionRequest: () => void;
}

type ChatComposerSessionProps =
  | CurrentSessionChatComposerSessionProps
  | NewSessionChatComposerSessionProps;

interface PendingSubmit {
  images?: ScoutImageContent[];
  text: string;
  deliverAs?: ComposerSubmitDelivery;
}

interface ComposerSubmitPayload {
  images?: ScoutImageContent[];
  text: string;
}

interface SlashSelectionState {
  key: string | null;
  index: number;
}

const ABORT_CONFIRM_TIMEOUT_MS = 1800;
const COMPACTION_SEND_BLOCKED_MESSAGE = '正在压缩上下文，请等待压缩完成后再发送';
const EMPTY_QUEUE_STATE = {
  messages: [],
  followUps: [],
  paused: false,
} as const;

function ChatComposerView(props: ChatComposerProps) {
  const currentSessionId = useSessionId();
  const composerSessionId = props.draftSessionId ?? currentSessionId;

  if (props.mode === 'newSession') {
    return (
      <ChatComposerSession
        key={composerSessionId}
        mode="newSession"
        placeholder={props.placeholder}
        sessionId={composerSessionId}
        submitDisabled={props.submitDisabled}
        onMessageSent={props.onMessageSent}
        onBeginNewSessionRequest={props.onBeginNewSessionRequest}
      />
    );
  }

  return (
    <ChatComposerSession
      key={composerSessionId}
      mode="currentSession"
      placeholder={props.placeholder}
      sessionId={composerSessionId}
      submitDisabled={props.submitDisabled ?? false}
      onMessageSent={props.onMessageSent}
    />
  );
}

export const ChatComposer = memo(ChatComposerView);

function ChatComposerSession(props: ChatComposerSessionProps) {
  const { mode, onMessageSent, placeholder, sessionId, submitDisabled } = props;
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingSubmit | null>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [slashSelection, setSlashSelection] = useState<SlashSelectionState>({
    key: null,
    index: 0,
  });
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const floatingPanelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const submitBlockedRef = useRef(false);
  const images = useComposerImages(sessionId);
  const text = useComposerText(sessionId);
  const commands = useCommands();
  const composerActions = useComposerActions();
  const pendingCommandEffect = usePendingComposerCommandEffect();
  const runtimeOverlayActions = useRuntimeOverlayActions();
  const uiActions = useUiActions();
  const visualBusy = useVisualBusyState();
  const currentSessionStreaming = useIsStreaming();
  const currentSessionVisualStreaming = useVisualIsStreaming();
  const currentSessionQueueState = useQueueState();
  const currentSessionForkCandidateVersion = useConversationForkCandidateVersion();
  const isCurrentSessionMode = mode === 'currentSession';
  const isStreaming = isCurrentSessionMode ? currentSessionStreaming : false;
  const visualIsStreaming = isCurrentSessionMode ? currentSessionVisualStreaming : false;
  const queueState = isCurrentSessionMode ? currentSessionQueueState : EMPTY_QUEUE_STATE;
  const hasText = text.trim().length > 0;
  const hasImages = images.length > 0;
  const hasDraft = hasText || hasImages;
  const isSubmitDisabled = submitDisabled;
  const isSubmitPending = mode === 'newSession' && isSubmitDisabled;
  const canSubmit = hasDraft && !isSubmitDisabled;
  const canStop = isCurrentSessionMode && visualBusy.cancellable;
  const showStop = (visualIsStreaming || canStop) && !hasDraft;
  const hasPausedFollowUps = queueState.paused && queueState.followUps.length > 0;
  const slashTrigger = getSlashCommandTrigger(text, selectionStart);
  const slashKey = slashTrigger
    ? `${slashTrigger.range.start}:${slashTrigger.range.end}:${slashTrigger.query}`
    : null;
  const slashItems = useMemo(
    () =>
      slashTrigger
        ? buildSlashCommandItems({
            allowExtensionCommands: !isStreaming,
            allowForkCommand: isCurrentSessionMode,
            commands,
            query: slashTrigger.query,
          })
        : [],
    [commands, isCurrentSessionMode, isStreaming, slashTrigger],
  );
  const slashMenuOpen = slashTrigger !== null && slashKey !== dismissedSlashKey;
  const slashActiveIndex = slashSelection.key === slashKey ? slashSelection.index : 0;
  const boundedSlashActiveIndex =
    slashItems.length === 0 ? 0 : Math.min(slashActiveIndex, slashItems.length - 1);
  // 命令菜单里出现 fork 项时即预取候选，避免点开分叉菜单后再经历一次加载态导致高度跳变
  const forkItemVisible = slashMenuOpen && slashItems.some((item) => item.builtinAction === 'fork');
  const forkMenu = useForkCandidateMenu({
    branchVersion: isCurrentSessionMode ? currentSessionForkCandidateVersion : '',
    prefetch: forkItemVisible,
    sessionId,
  });

  useEffect(() => {
    if (!forkMenu.open && !slashMenuOpen) return undefined;
    const closeFloatingPanelOnOutsidePointerDown = (event: PointerEvent) => {
      const panel = floatingPanelRef.current;
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      if (forkMenu.open) {
        forkMenu.close();
        return;
      }
      setDismissedSlashKey(slashKey);
    };
    document.addEventListener('pointerdown', closeFloatingPanelOnOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', closeFloatingPanelOnOutsidePointerDown);
    };
  }, [forkMenu, slashKey, slashMenuOpen]);

  useEffect(() => {
    if (!confirmAbort) return undefined;
    const timer = window.setTimeout(() => setConfirmAbort(false), ABORT_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [confirmAbort]);

  useEffect(() => {
    if (showStop || !confirmAbort) return undefined;
    const timer = window.setTimeout(() => setConfirmAbort(false), 0);
    return () => window.clearTimeout(timer);
  }, [confirmAbort, showStop]);

  useEffect(() => {
    if (submitDisabled) return;
    submitBlockedRef.current = false;
  }, [submitDisabled]);

  const sendMessage = (
    payload: ComposerSubmitPayload,
    deliverAs?: ComposerSubmitDelivery,
    options?: { clearFollowUpQueue?: boolean },
  ) => {
    if (isSubmitDisabled || submitBlockedRef.current) return;
    if (isCurrentSessionMode && visualBusy.kind === 'compaction') {
      if (payload.images && payload.images.length > 0 && images.length === 0) {
        composerActions.addImages(sessionId, payload.images);
      }
      setPendingSubmit(null);
      uiActions.setNotification({
        type: 'notification',
        level: 'error',
        message: COMPACTION_SEND_BLOCKED_MESSAGE,
      });
      return;
    }
    if (props.mode === 'newSession') {
      submitBlockedRef.current = true;
      props.onBeginNewSessionRequest();
      composerActions.stagePendingDraft(sessionId, payload);
      protocolClient.newSessionMessage(payload.text, payload.images);
      composerActions.clearDraft(sessionId);
      setPendingSubmit(null);
      return;
    }
    protocolClient.userMessage(payload.text, deliverAs, {
      ...options,
      images: payload.images,
    });
    onMessageSent?.();
    composerActions.clearDraft(sessionId);
    setPendingSubmit(null);
  };

  const submit = (delivery?: ComposerSubmitDelivery) => {
    if (isSubmitDisabled || submitBlockedRef.current) return;
    const nextText = text.trim();
    if (!nextText && images.length === 0) return;
    const payload = {
      text: nextText,
      images: images.length > 0 ? images : undefined,
    };
    const deliverAs = isStreaming && !hasPausedFollowUps ? (delivery ?? 'followUp') : delivery;
    if (hasPausedFollowUps && !deliverAs) {
      setPendingSubmit(payload);
      return;
    }
    sendMessage(payload, deliverAs);
  };

  const stop = () => {
    if (!canStop) return;
    if (visualBusy.kind === 'retry') {
      protocolClient.abortRetry();
      return;
    }
    if (visualBusy.kind === 'agent') {
      runtimeOverlayActions.beginLocalAbort();
    }
    protocolClient.abort();
  };

  const requestKeyboardStop = () => {
    if (!canStop) return;
    if (visualIsStreaming && showStop && !confirmAbort) {
      setConfirmAbort(true);
      return;
    }
    setConfirmAbort(false);
    stop();
  };

  const requestButtonStop = () => {
    setConfirmAbort(false);
    stop();
  };

  const closePendingSubmitDialog = () => {
    setPendingSubmit(null);
  };

  const sendPendingSubmit = (clearFollowUpQueue: boolean) => {
    if (!pendingSubmit) return;
    sendMessage(pendingSubmit, pendingSubmit.deliverAs, { clearFollowUpQueue });
  };

  const addImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const settledImages = await Promise.allSettled(
      Array.from(files)
        .filter((file) => SUPPORTED_IMAGE_MIME_TYPES.has(file.type))
        .map(readImageFile),
    );
    const nextImages = settledImages
      .filter((result): result is PromiseFulfilledResult<ScoutImageContent> => {
        return result.status === 'fulfilled';
      })
      .map((result) => result.value);
    composerActions.addImages(sessionId, nextImages);
  };

  const setComposerText = (nextText: string) => {
    setDismissedSlashKey(null);
    setSlashSelection({ key: null, index: 0 });
    composerActions.setText(sessionId, nextText);
  };

  const focusTextareaAt = (position: number) => {
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      markProgrammaticFocus(textarea);
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
      setSelectionStart(position);
    }, 0);
  };

  // fork 完成后回填被选用户消息文本到当前激活会话的 composer
  useEffect(() => {
    if (pendingCommandEffect == null) return;
    if (pendingCommandEffect.targetSessionId !== sessionId) return;
    if (pendingCommandEffect.kind === 'replace_text') {
      composerActions.setText(sessionId, pendingCommandEffect.text);
      composerActions.consumeCommandEffect();
      focusTextareaAt(pendingCommandEffect.text.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommandEffect, sessionId]);

  const replaceSlashToken = (replacement: string) => {
    if (!slashTrigger) return;
    const nextText =
      text.slice(0, slashTrigger.range.start) + replacement + text.slice(slashTrigger.range.end);
    const nextSelectionStart = slashTrigger.range.start + replacement.length;
    composerActions.setText(sessionId, nextText);
    focusTextareaAt(nextSelectionStart);
  };

  const clearSlashToken = () => {
    if (!slashTrigger) return;
    const nextText = text.slice(0, slashTrigger.range.start) + text.slice(slashTrigger.range.end);
    composerActions.setText(sessionId, nextText);
    focusTextareaAt(slashTrigger.range.start);
  };

  const selectSlashItem = (item: SlashCommandMenuItem) => {
    if (item.command.source !== 'builtin') {
      replaceSlashToken(`/${item.command.name} `);
      return;
    }
    switch (item.builtinAction) {
      case 'tree':
        protocolClient.openTreePanel();
        clearSlashToken();
        return;
      case 'compact':
        protocolClient.compact();
        clearSlashToken();
        return;
      case 'fork':
        forkMenu.openMenu();
        clearSlashToken();
        return;
      default:
        return;
    }
  };

  const handleSlashKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (forkMenu.handleKeyDown(event)) return true;
    if (!slashMenuOpen) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissedSlashKey(slashKey);
      return true;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSlashSelection({
        key: slashKey,
        index: slashItems.length === 0 ? 0 : (boundedSlashActiveIndex + 1) % slashItems.length,
      });
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSlashSelection({
        key: slashKey,
        index:
          slashItems.length === 0
            ? 0
            : (boundedSlashActiveIndex - 1 + slashItems.length) % slashItems.length,
      });
      return true;
    }
    if (event.key === 'Enter') {
      if (slashItems.length === 0) return false;
      event.preventDefault();
      selectSlashItem(slashItems[boundedSlashActiveIndex]);
      return true;
    }
    return false;
  };

  return (
    <>
      <div className="max-w-full min-w-0">
        {forkMenu.open ? (
          <div ref={floatingPanelRef}>
            <ForkCandidateMenu
              activeIndex={forkMenu.activeIndex}
              candidates={forkMenu.candidates}
              onHover={forkMenu.onHover}
              onSelect={forkMenu.confirm}
            />
          </div>
        ) : slashMenuOpen ? (
          <div ref={floatingPanelRef}>
            <SlashCommandMenu
              activeIndex={boundedSlashActiveIndex}
              items={slashItems}
              onSelect={selectSlashItem}
            />
          </div>
        ) : null}
        <form
          className="border-border bg-background max-w-full min-w-0 overflow-hidden rounded-2xl border px-2 py-2 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ComposerTextarea
            placeholder={placeholder}
            textareaRef={textareaRef}
            value={text}
            onChange={setComposerText}
            onKeyDownCapture={handleSlashKeyDown}
            onSelectionChange={setSelectionStart}
            onSubmit={submit}
            onCancel={requestKeyboardStop}
            isStreaming={isStreaming}
            canRequestAbort={visualIsStreaming && showStop && canStop}
          />

          {images.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {images.map((image, index) => (
                <div
                  key={`${image.mimeType}:${image.data.length}:${index}`}
                  className="border-border bg-muted relative size-12 overflow-hidden rounded-md border"
                >
                  <img
                    alt=""
                    className="size-full object-cover"
                    src={`data:${image.mimeType};base64,${image.data}`}
                  />
                  <button
                    aria-label="移除图片"
                    className="bg-background/90 text-foreground hover:bg-background absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full"
                    type="button"
                    onClick={() => composerActions.removeImage(sessionId, index)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex min-h-8 max-w-full min-w-0 flex-nowrap items-center justify-between gap-2 overflow-hidden">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <input
                accept={SUPPORTED_IMAGE_INPUT_ACCEPT}
                aria-label="选择图片"
                className="hidden"
                multiple
                ref={imageInputRef}
                type="file"
                onChange={(event) => {
                  void addImageFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
              <IconButton
                label="添加图片"
                onClick={() => {
                  imageInputRef.current?.click();
                }}
              >
                <Plus />
              </IconButton>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
              <ModelStatusMenu />
              <SendButton
                canSubmit={canSubmit}
                canStop={canStop}
                confirmAbort={confirmAbort}
                isPending={isSubmitPending}
                showStop={showStop}
                showStreamingSendTooltip={isStreaming && hasDraft}
                onStop={requestButtonStop}
              />
            </div>
          </div>
        </form>
      </div>

      <PendingQueueSendDialog
        open={pendingSubmit !== null}
        queuedCount={queueState.followUps.length}
        onClose={closePendingSubmitDialog}
        onClearQueueAndSend={() => sendPendingSubmit(true)}
        onSend={() => sendPendingSubmit(false)}
      />
    </>
  );
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const SUPPORTED_IMAGE_INPUT_ACCEPT = Array.from(SUPPORTED_IMAGE_MIME_TYPES).join(',');

function readImageFile(file: File): Promise<ScoutImageContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, data = ''] = result.split(',', 2);
      resolve({
        type: 'image',
        data,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  });
}
