// ============================================================
// Chat Composer — 底部输入与运行控制
// ============================================================

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ScoutQueueState } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { useCommands } from '@/store/config-store';
import {
  useComposerActions,
  useComposerDocument,
  useComposerImages,
  usePendingComposerCommandEffect,
} from '@/store/composer-store';
import { getComposerLinearText } from '@/store/composer-document';
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
import { useFileMentionMenu } from '../hooks/use-file-mention-menu';
import { AddMentionMenu } from './AddMentionMenu';
import { ComposerImagePreviewDialog } from './ComposerImagePreviewDialog';
import { ComposerImageTray } from './ComposerImageTray';
import { ComposerSuggestionPopover } from './ComposerSuggestionPopover';
import { ComposerTextarea, type ComposerEditorHandle } from './ComposerTextarea';
import { FileMentionSearchMenu } from './FileMentionSearchMenu';
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

interface SuggestionSelectionState {
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
  const [selectionStart, setSelectionStart] = useState<number | null>(0);
  const [slashSelection, setSlashSelection] = useState<SuggestionSelectionState>({
    key: null,
    index: 0,
  });
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const images = useComposerImages(sessionId);
  const document = useComposerDocument(sessionId);
  const linearText = useMemo(() => getComposerLinearText(document), [document]);
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
    document,
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
  const replaceComposerRange = useCallback(
    (...args: Parameters<ComposerEditorHandle['replaceRange']>) => {
      editorRef.current?.replaceRange(...args);
    },
    [],
  );
  const insertComposerReferencesAt = useCallback(
    (...args: Parameters<ComposerEditorHandle['insertReferencesAt']>) => {
      editorRef.current?.insertReferencesAt(...args);
    },
    [],
  );
  const replaceComposerRangeWithReferences = useCallback(
    (...args: Parameters<ComposerEditorHandle['replaceRangeWithReferences']>) => {
      editorRef.current?.replaceRangeWithReferences(...args);
    },
    [],
  );
  const fileMentionMenu = useFileMentionMenu({
    addImageFiles: imageAttachments.addImageFiles,
    insertReferencesAt: insertComposerReferencesAt,
    linearText,
    replaceRange: replaceComposerRange,
    replaceRangeWithReferences: replaceComposerRangeWithReferences,
    selectionStart,
  });
  const slashTrigger = useMemo(
    () => getSlashCommandTrigger(linearText, selectionStart),
    [linearText, selectionStart],
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
  const floatingPanelOpen = forkMenuOpen || fileMentionMenu.open || slashMenuOpen;
  const previewImage = previewImageIndex === null ? null : images[previewImageIndex];

  const openComposerAddMenu = useCallback(() => {
    closeForkMenu();
    setDismissedSlashKey(slashKey);
    fileMentionMenu.openAddMenu();
  }, [closeForkMenu, fileMentionMenu, slashKey]);

  const dismissFloatingPanel = useCallback(() => {
    if (forkMenuOpen) {
      closeForkMenu();
      return;
    }
    if (fileMentionMenu.open) {
      fileMentionMenu.dismiss();
      return;
    }
    setDismissedSlashKey(slashKey);
  }, [closeForkMenu, fileMentionMenu, forkMenuOpen, slashKey]);

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

  const setComposerDocument = (nextDocument: typeof document) => {
    if (isDraftLocked) return;
    fileMentionMenu.handleDocumentChange();
    setDismissedSlashKey(null);
    setSlashSelection({ key: null, index: 0 });
    composerActions.setDocument(sessionId, nextDocument);
  };

  const focusEditorAt = (position: number) => {
    window.setTimeout(() => {
      editorRef.current?.focusAt(position);
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
      focusEditorAt(pendingCommandEffect.text.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommandEffect, sessionId]);

  const replaceSlashToken = (replacement: string) => {
    if (!slashTrigger) return;
    editorRef.current?.replaceRange(slashTrigger.range, replacement);
  };

  const clearSlashToken = () => {
    if (!slashTrigger) return;
    editorRef.current?.replaceRange(slashTrigger.range, '');
  };

  const selectSlashItem = (item: SlashCommandMenuItem) => {
    if (item.command.source === 'skill') {
      if (!slashTrigger) return;
      editorRef.current?.replaceRange(slashTrigger.range, ' ', {
        commandName: item.command.name,
        id: item.command.name,
        kind: 'skill',
      });
      return;
    }
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

  const handleSuggestionKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    if (forkMenu.handleKeyDown(event)) return true;
    if (fileMentionMenu.handleKeyDown(event)) return true;
    if (!slashMenuOpen) return false;
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
  ) : fileMentionMenu.kind === 'add' ? (
    <AddMentionMenu
      activeIndex={fileMentionMenu.activeIndex}
      onHover={fileMentionMenu.onHover}
      onSelect={fileMentionMenu.selectComposerContent}
    />
  ) : fileMentionMenu.kind === 'search' ? (
    <FileMentionSearchMenu
      activeIndex={fileMentionMenu.activeIndex}
      error={fileMentionMenu.error}
      items={fileMentionMenu.items}
      loading={fileMentionMenu.loading}
      onHover={fileMentionMenu.onHover}
      onSelect={fileMentionMenu.selectFile}
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
            ref={editorRef}
            document={document}
            placeholder={placeholder}
            onChange={setComposerDocument}
            onKeyDownCapture={handleSuggestionKeyDown}
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
              <IconButton
                disabled={isDraftLocked}
                label="添加文件、文件夹或图片"
                onClick={openComposerAddMenu}
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
