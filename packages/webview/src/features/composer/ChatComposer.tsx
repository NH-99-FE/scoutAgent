// ============================================================
// Chat Composer — 底部输入与运行控制
// ============================================================

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { useBusyState, useIsStreaming, useQueueState } from '@/store/conversation-store';
import { ModelStatusMenu } from '@/features/model-menu/ModelStatusMenu';
import { cn } from '@/lib/utils';
import { ApprovalModeMenu } from './ApprovalModeMenu';
import { ComposerTextarea, type ComposerSubmitDelivery } from './ComposerTextarea';
import { FollowUpQueuePanel } from './FollowUpQueuePanel';
import { PendingQueueSendDialog } from './PendingQueueSendDialog';
import { SendButton } from './SendButton';

interface ChatComposerProps {
  placeholder: string;
  onSubmitMessage?: () => void;
}

interface PendingSubmit {
  text: string;
  deliverAs?: ComposerSubmitDelivery;
}

const ABORT_CONFIRM_TIMEOUT_MS = 1800;

export function ChatComposer({ placeholder, onSubmitMessage }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingSubmit | null>(null);
  const busy = useBusyState();
  const isStreaming = useIsStreaming();
  const queueState = useQueueState();
  const hasText = text.trim().length > 0;
  const canSubmit = hasText;
  const canStop = busy.cancellable;
  const showStop = (isStreaming || canStop) && !hasText;
  const hasPausedFollowUps = queueState.paused && queueState.followUps.length > 0;
  const hasQueuedFollowUps = queueState.followUps.length > 0;

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

  const sendMessage = (
    nextText: string,
    deliverAs?: ComposerSubmitDelivery,
    options?: { clearFollowUpQueue?: boolean },
  ) => {
    protocolClient.userMessage(nextText, deliverAs, options);
    setText('');
    setPendingSubmit(null);
    onSubmitMessage?.();
  };

  const submit = (delivery?: ComposerSubmitDelivery) => {
    const nextText = text.trim();
    if (!nextText) return;
    const deliverAs = isStreaming && !hasPausedFollowUps ? (delivery ?? 'followUp') : delivery;
    if (hasPausedFollowUps && !deliverAs) {
      setPendingSubmit({ text: nextText });
      return;
    }
    sendMessage(nextText, deliverAs);
  };

  const stop = () => {
    if (!canStop) return;
    if (busy.kind === 'retry') {
      protocolClient.abortRetry();
      return;
    }
    protocolClient.abort();
  };

  const requestKeyboardStop = () => {
    if (!canStop) return;
    if (isStreaming && showStop && !confirmAbort) {
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
    sendMessage(pendingSubmit.text, pendingSubmit.deliverAs, { clearFollowUpQueue });
  };

  return (
    <>
      <div>
        <FollowUpQueuePanel />
        <form
          className={cn(
            'border-border bg-background rounded-2xl border px-2 py-2 shadow-sm',
            hasQueuedFollowUps && 'rounded-t-none',
          )}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ComposerTextarea
            placeholder={placeholder}
            value={text}
            onChange={setText}
            onSubmit={submit}
            onCancel={requestKeyboardStop}
            isStreaming={isStreaming}
            canRequestAbort={isStreaming && showStop && canStop}
          />

          <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <IconButton label="添加上下文">
                <Plus />
              </IconButton>

              <ApprovalModeMenu />
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <ModelStatusMenu />
              <SendButton
                canSubmit={canSubmit}
                canStop={canStop}
                confirmAbort={confirmAbort}
                showStop={showStop}
                showStreamingSendTooltip={isStreaming && hasText}
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
