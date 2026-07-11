// ============================================================
// Chat Composer — 底部输入与运行控制
// ============================================================

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
const FLOATING_PANEL_LAYER_CLASS = 'fixed z-50 min-w-0 max-w-full';
const FLOATING_PANEL_GAP_PX = 6;

interface FloatingPanelLayout {
  bottom: number;
  left: number;
  width: number;
}

function areFloatingPanelLayoutsEqual(
  previous: FloatingPanelLayout | null,
  next: FloatingPanelLayout,
) {
  return (
    previous !== null &&
    previous.bottom === next.bottom &&
    previous.left === next.left &&
    previous.width === next.width
  );
}

function isEventFromFloatingPanel(event: Event, panel: HTMLElement | null) {
  return event.target instanceof Node && panel !== null && panel.contains(event.target);
}

function measureFloatingPanelLayout(anchor: HTMLDivElement): FloatingPanelLayout {
  const rect = anchor.getBoundingClientRect();
  return {
    bottom: Math.max(0, window.innerHeight - rect.top + FLOATING_PANEL_GAP_PX),
    left: rect.left,
    width: rect.width,
  };
}

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
  const [floatingPanelLayout, setFloatingPanelLayout] = useState<FloatingPanelLayout | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const floatingPanelRef = useRef<HTMLDivElement | null>(null);
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

  const applyFloatingPanelLayout = useCallback((layout: FloatingPanelLayout) => {
    setFloatingPanelLayout((current) =>
      areFloatingPanelLayoutsEqual(current, layout) ? current : layout,
    );
  }, []);

  const updateFloatingPanelLayout = useCallback(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor) return;
    applyFloatingPanelLayout(measureFloatingPanelLayout(anchor));
  }, [applyFloatingPanelLayout]);

  const updateFloatingPanelLayoutForExternalScroll = useCallback(
    (event: Event) => {
      if (isEventFromFloatingPanel(event, floatingPanelRef.current)) return;
      updateFloatingPanelLayout();
    },
    [updateFloatingPanelLayout],
  );

  const setComposerAnchor = useCallback(
    (anchor: HTMLDivElement | null) => {
      composerAnchorRef.current = anchor;
      if (!anchor || !floatingPanelOpen) return;
      applyFloatingPanelLayout(measureFloatingPanelLayout(anchor));
    },
    [applyFloatingPanelLayout, floatingPanelOpen],
  );

  useLayoutEffect(() => {
    if (!floatingPanelOpen) return undefined;

    const anchor = composerAnchorRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && anchor) {
      resizeObserver = new ResizeObserver(updateFloatingPanelLayout);
      resizeObserver.observe(anchor);
    }

    window.addEventListener('resize', updateFloatingPanelLayout);
    window.addEventListener('scroll', updateFloatingPanelLayoutForExternalScroll, true);
    window.visualViewport?.addEventListener('resize', updateFloatingPanelLayout);
    window.visualViewport?.addEventListener('scroll', updateFloatingPanelLayout);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateFloatingPanelLayout);
      window.removeEventListener('scroll', updateFloatingPanelLayoutForExternalScroll, true);
      window.visualViewport?.removeEventListener('resize', updateFloatingPanelLayout);
      window.visualViewport?.removeEventListener('scroll', updateFloatingPanelLayout);
    };
  }, [floatingPanelOpen, updateFloatingPanelLayout, updateFloatingPanelLayoutForExternalScroll]);

  useEffect(() => {
    if (!floatingPanelOpen) return undefined;
    const closeFloatingPanelOnOutsidePointerDown = (event: PointerEvent) => {
      const panel = floatingPanelRef.current;
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      if (forkMenuOpen) {
        closeForkMenu();
        return;
      }
      setDismissedSlashKey(slashKey);
    };
    document.addEventListener('pointerdown', closeFloatingPanelOnOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', closeFloatingPanelOnOutsidePointerDown);
    };
  }, [closeForkMenu, floatingPanelOpen, forkMenuOpen, slashKey]);

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
      onSelect={selectSlashItem}
    />
  ) : null;

  return (
    <>
      <div ref={setComposerAnchor} className="relative w-full max-w-full min-w-0">
        <ComposerFloatingLayer layout={floatingPanelLayout} panelRef={floatingPanelRef}>
          {floatingPanel}
        </ComposerFloatingLayer>
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
      </div>

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

function ComposerFloatingLayer({
  children,
  layout,
  panelRef,
}: {
  children: ReactNode;
  layout: FloatingPanelLayout | null;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  if (!children || !layout) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={FLOATING_PANEL_LAYER_CLASS}
      style={
        {
          bottom: layout.bottom,
          left: layout.left,
          width: layout.width,
        } satisfies CSSProperties
      }
    >
      {children}
    </div>,
    document.body,
  );
}
