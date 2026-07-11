// ============================================================
// Chat Composer — 底部输入与运行控制
// ============================================================

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ScoutQueueState } from '@scout-agent/shared';
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
import { ModelStatusMenu } from '@/features/model-menu';
import { useComposerImageAttachments } from '../hooks/use-composer-image-attachments';
import { useComposerSubmitFlow } from '../hooks/use-composer-submit-flow';
import { SUPPORTED_IMAGE_INPUT_ACCEPT } from '../model/composer-images';
import { ComposerImagePreviewDialog } from './ComposerImagePreviewDialog';
import { ComposerImageTray } from './ComposerImageTray';
import { ComposerSuggestionPopover } from './ComposerSuggestionPopover';
import { ComposerTextarea } from './ComposerTextarea';
import { ForkCandidateMenu } from './ForkCandidateMenu';
import { PendingQueueSendDialog } from './PendingQueueSendDialog';
import { SendButton } from './SendButton';
import { SlashCommandMenu } from './SlashCommandMenu';
import { useForkCandidateMenu } from '../hooks/use-fork-candidate-menu';
import { buildSlashCommandItems, type SlashCommandMenuItem } from '../model/slash-command-options';
import { getSlashCommandTrigger } from '../model/slash-command-trigger';

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

interface SlashSelectionState {
  key: string | null;
  index: number;
}

const ABORT_CONFIRM_TIMEOUT_MS = 1800;
const EMPTY_QUEUE_STATE = {
  messages: [],
  followUps: [],
  paused: false,
} satisfies ScoutQueueState;

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
  const [selectionStart, setSelectionStart] = useState(0);
  const [slashSelection, setSlashSelection] = useState<SlashSelectionState>({
    key: null,
    index: 0,
  });
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const images = useComposerImages(sessionId);
  const text = useComposerText(sessionId);
  const commands = useCommands();
  const composerActions = useComposerActions();
  const pendingCommandEffect = usePendingComposerCommandEffect();
  const runtimeOverlayActions = useRuntimeOverlayActions();
  const visualBusy = useVisualBusyState();
  const currentSessionStreaming = useIsStreaming();
  const currentSessionVisualStreaming = useVisualIsStreaming();
  const currentSessionQueueState = useQueueState();
  const currentSessionForkCandidateVersion = useConversationForkCandidateVersion();
  const isCurrentSessionMode = mode === 'currentSession';
  const isStreaming = isCurrentSessionMode ? currentSessionStreaming : false;
  const visualIsStreaming = isCurrentSessionMode ? currentSessionVisualStreaming : false;
  const queueState = isCurrentSessionMode ? currentSessionQueueState : EMPTY_QUEUE_STATE;
  const imageAttachments = useComposerImageAttachments(sessionId);
  const submitFlow = useComposerSubmitFlow({
    images,
    isStreaming,
    mode,
    onBeginNewSessionRequest:
      props.mode === 'newSession' ? props.onBeginNewSessionRequest : undefined,
    onMessageSent,
    queueState,
    sessionId,
    submitDisabled,
    text,
  });
  const {
    canSubmit,
    closePendingSubmitDialog,
    hasDraft,
    isDraftLocked,
    isSubmitPending,
    pendingSubmit,
    sendPendingSubmit,
    submit,
  } = submitFlow;
  const canStop = isCurrentSessionMode && visualBusy.cancellable;
  const showStop = (visualIsStreaming || canStop) && !hasDraft;
  const slashTrigger = useMemo(
    () => getSlashCommandTrigger(text, selectionStart),
    [selectionStart, text],
  );
  const slashKey = slashTrigger
    ? `${slashTrigger.range.start}:${slashTrigger.range.end}:${slashTrigger.query}`
    : null;
  const slashItems = useMemo(
    () =>
      slashTrigger
        ? buildSlashCommandItems({
            allowExtensionCommands: !isStreaming,
            allowSessionCommands: isCurrentSessionMode,
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
  const forkMenuOpen = forkMenu.open;
  const closeForkMenu = forkMenu.close;
  const floatingPanelOpen = forkMenuOpen || slashMenuOpen;
  const previewImage = previewImageIndex === null ? null : images[previewImageIndex];

  const dismissFloatingPanel = useCallback(() => {
    if (forkMenuOpen) {
      closeForkMenu();
      return;
    }
    setDismissedSlashKey(slashKey);
  }, [closeForkMenu, forkMenuOpen, slashKey]);

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
    if (previewImageIndex === null || images[previewImageIndex]) return;
    const timer = window.setTimeout(() => setPreviewImageIndex(null), 0);
    return () => window.clearTimeout(timer);
  }, [images, previewImageIndex]);

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

  const openImagePreview = (index: number) => {
    setPreviewImageIndex(index);
  };

  const closeImagePreview = () => {
    setPreviewImageIndex(null);
  };

  const setComposerText = (nextText: string) => {
    if (isDraftLocked) return;
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

  const handleSlashKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
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

  const floatingPanel = forkMenu.open ? (
    <ForkCandidateMenu
      activeIndex={forkMenu.activeIndex}
      candidates={forkMenu.candidates}
      onHover={forkMenu.onHover}
      onSelect={forkMenu.confirm}
    />
  ) : slashMenuOpen ? (
    <SlashCommandMenu
      activeIndex={boundedSlashActiveIndex}
      items={slashItems}
      onHover={(index) => setSlashSelection({ key: slashKey, index })}
      onSelect={selectSlashItem}
    />
  ) : null;

  return (
    <>
      <ComposerSuggestionPopover
        onDismiss={dismissFloatingPanel}
        open={floatingPanelOpen}
        panel={floatingPanel}
      >
        <form
          className="border-border bg-background w-full max-w-full min-w-0 overflow-hidden rounded-2xl border px-2 py-2 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {images.length > 0 ? (
            <ComposerImageTray
              images={images}
              removeDisabled={isDraftLocked}
              onPreview={openImagePreview}
              onRemove={(index) => composerActions.removeImage(sessionId, index)}
            />
          ) : null}

          <ComposerTextarea
            placeholder={placeholder}
            textareaRef={textareaRef}
            value={text}
            onChange={setComposerText}
            onKeyDownCapture={handleSlashKeyDown}
            onPaste={(event) => {
              if (isDraftLocked) {
                event.preventDefault();
                return;
              }
              imageAttachments.handlePaste(event);
            }}
            onSelectionChange={setSelectionStart}
            onSubmit={(delivery) => void submit(delivery)}
            onCancel={requestKeyboardStop}
            readOnly={isDraftLocked}
            isStreaming={isStreaming}
            canRequestAbort={visualIsStreaming && showStop && canStop}
          />

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
                  if (isDraftLocked) {
                    event.currentTarget.value = '';
                    return;
                  }
                  void imageAttachments.addImageFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
              <IconButton
                disabled={isDraftLocked}
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
      </ComposerSuggestionPopover>

      <PendingQueueSendDialog
        open={pendingSubmit !== null}
        queuedCount={queueState.followUps.length}
        onClose={closePendingSubmitDialog}
        onClearQueueAndSend={() => sendPendingSubmit(true)}
        onSend={() => sendPendingSubmit(false)}
      />

      {previewImage ? (
        <ComposerImagePreviewDialog
          images={images}
          imageIndex={previewImageIndex ?? 0}
          onClose={closeImagePreview}
          onImageIndexChange={setPreviewImageIndex}
        />
      ) : null}
    </>
  );
}
