// ============================================================
// Chat Composer — 底部输入与运行控制
// ============================================================

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Plus, Trash2 } from 'lucide-react';
import type { ScoutQueueState } from '@scout-agent/shared';
import { acknowledgeComposerIntentUntilSettled } from '@/bridge/composer-intent-ack';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { Button } from '@/components/ui/button';
import { useCommands } from '@/store/config-store';
import {
  createComposerDraftKey,
  useComposerActions,
  useComposerDocument,
  useComposerImages,
  usePendingComposerCommandEffect,
  useRecoverableComposerDrafts,
} from '@/store/composer-store';
import { getComposerLinearText } from '@/store/composer-document';
import {
  useConversationForkCandidateVersion,
  useIsStreaming,
  useQueueState,
  useTreeNavigationAdmission,
} from '@/store/conversation-store';
import {
  useRuntimeOverlayActions,
  useVisualBusyState,
  useVisualIsStreaming,
} from '@/store/runtime-overlay-store';
import { usePendingComposerIntent, useSessionFile, useSessionId } from '@/store/session-store';
import { ModelStatusMenu } from '@/features/model-menu';
import { useComposerImageAttachments } from '../hooks/use-composer-image-attachments';
import { useComposerSubmitFlow } from '../hooks/use-composer-submit-flow';
import { useComposerToolProfile } from '../hooks/use-composer-tool-profile';
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
import { ToolProfileSelect } from './ToolProfileSelect';
import { useForkCandidateMenu } from '../hooks/use-fork-candidate-menu';
import { buildSlashCommandItems, type SlashCommandMenuItem } from '../model/slash-command-options';
import { isComposerSubmissionBlocked } from '../model/composer-submit';
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
  draftKey: string;
  sessionPath: string;
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
  const currentSessionPath = useSessionFile();
  const composerSessionId = props.draftSessionId ?? currentSessionId;
  const currentSessionDraftKey = createComposerDraftKey(currentSessionId, currentSessionPath);
  const componentKey =
    props.mode === 'newSession' ? composerSessionId : `${composerSessionId}:${currentSessionPath}`;

  if (props.mode === 'newSession') {
    return (
      <ChatComposerSession
        key={composerSessionId}
        mode="newSession"
        placeholder={props.placeholder}
        sessionId={composerSessionId}
        draftKey={composerSessionId}
        sessionPath=""
        submitDisabled={props.submitDisabled}
        onMessageSent={props.onMessageSent}
        onBeginNewSessionRequest={props.onBeginNewSessionRequest}
      />
    );
  }

  return (
    <ChatComposerSession
      key={componentKey}
      mode="currentSession"
      placeholder={props.placeholder}
      sessionId={currentSessionId}
      draftKey={currentSessionDraftKey}
      sessionPath={currentSessionPath}
      submitDisabled={props.submitDisabled ?? false}
      onMessageSent={props.onMessageSent}
    />
  );
}

export const ChatComposer = memo(ChatComposerView);

function ChatComposerSession(props: ChatComposerSessionProps) {
  const { mode, onMessageSent, placeholder, sessionId, draftKey, sessionPath, submitDisabled } =
    props;
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(0);
  const [slashSelection, setSlashSelection] = useState<SuggestionSelectionState>({
    key: null,
    index: 0,
  });
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const images = useComposerImages(draftKey);
  const document = useComposerDocument(draftKey);
  const recoverableDrafts = useRecoverableComposerDrafts(draftKey);
  const linearText = useMemo(() => getComposerLinearText(document), [document]);
  const commands = useCommands();
  const composerActions = useComposerActions();
  const pendingCommandEffect = usePendingComposerCommandEffect();
  const pendingComposerIntent = usePendingComposerIntent();
  const runtimeOverlayActions = useRuntimeOverlayActions();
  const visualBusy = useVisualBusyState();
  const currentSessionStreaming = useIsStreaming();
  const currentSessionVisualStreaming = useVisualIsStreaming();
  const currentSessionQueueState = useQueueState();
  const treeNavigationAdmission = useTreeNavigationAdmission();
  const toolProfile = useComposerToolProfile(mode);
  const currentSessionForkCandidateVersion = useConversationForkCandidateVersion();
  const isCurrentSessionMode = mode === 'currentSession';
  const isStreaming = isCurrentSessionMode ? currentSessionStreaming : false;
  const visualIsStreaming = isCurrentSessionMode ? currentSessionVisualStreaming : false;
  const queueState = isCurrentSessionMode ? currentSessionQueueState : EMPTY_QUEUE_STATE;
  const sendBlocked =
    isCurrentSessionMode &&
    isComposerSubmissionBlocked(visualBusy, isStreaming, treeNavigationAdmission);
  const imageAttachments = useComposerImageAttachments(draftKey);
  const submitFlow = useComposerSubmitFlow({
    draftKey,
    images,
    isStreaming,
    mode,
    newSessionToolProfileId: toolProfile.submitProfileId,
    onBeginNewSessionRequest:
      props.mode === 'newSession' ? props.onBeginNewSessionRequest : undefined,
    onMessageSent,
    queueState,
    sendBlocked,
    sessionId,
    sessionPath,
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
    composerActions.setDocument(draftKey, nextDocument);
  };

  const focusEditorAt = (position: number) => {
    window.setTimeout(() => {
      editorRef.current?.focusAt(position);
      setSelectionStart(position);
    }, 0);
  };

  useEffect(() => {
    if (pendingCommandEffect == null) return;
    if (
      pendingCommandEffect.targetSession.sessionId !== sessionId ||
      pendingCommandEffect.targetSession.sessionPath !== sessionPath
    ) {
      return;
    }
    if (pendingCommandEffect.kind === 'replace_text') {
      composerActions.setText(draftKey, pendingCommandEffect.text);
      composerActions.consumeCommandEffect();
      focusEditorAt(pendingCommandEffect.text.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, pendingCommandEffect, sessionId]);

  useEffect(() => {
    if (mode !== 'currentSession' || !pendingComposerIntent) return;
    if (
      pendingComposerIntent.session.sessionId !== sessionId ||
      pendingComposerIntent.session.sessionPath !== sessionPath
    ) {
      return;
    }
    const text =
      pendingComposerIntent.kind === 'replace_text' ? (pendingComposerIntent.text ?? '') : '';
    const applied = composerActions.applyComposerIntent(
      draftKey,
      pendingComposerIntent.version,
      text,
    );
    acknowledgeComposerIntentUntilSettled(pendingComposerIntent);
    if (applied && pendingComposerIntent.kind === 'replace_text') {
      focusEditorAt(text.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, mode, pendingComposerIntent, sessionId, sessionPath]);

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
        path: item.command.sourceInfo.path,
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
      {recoverableDrafts.length > 0 ? (
        <div
          className="border-border bg-background mb-1 flex min-h-8 items-center gap-2 rounded-xl border px-2 py-1 text-sm"
          data-recoverable-composer-draft="true"
        >
          <CircleAlert className="text-status-warning size-3.5 shrink-0" />
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {recoverableDrafts.length === 1
              ? '上一条消息发送失败'
              : `${recoverableDrafts.length} 条消息发送失败`}
          </span>
          <Button
            aria-label="恢复未发送消息"
            className="h-6 shrink-0 px-1.5"
            disabled={hasDraft || isDraftLocked}
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => composerActions.recoverFailedDraft(draftKey, recoverableDrafts[0]!.id)}
          >
            恢复
          </Button>
          <IconButton
            label="丢弃未发送消息"
            size="icon-xs"
            onClick={() => composerActions.discardFailedDraft(draftKey, recoverableDrafts[0]!.id)}
          >
            <Trash2 />
          </IconButton>
        </div>
      ) : null}

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
              onRemove={(index) => composerActions.removeImage(draftKey, index)}
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
              <ToolProfileSelect
                profileId={toolProfile.profileId}
                profiles={toolProfile.profiles}
                onValueChange={toolProfile.selectProfile}
              />
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
