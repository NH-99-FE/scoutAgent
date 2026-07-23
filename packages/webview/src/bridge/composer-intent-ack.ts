import type { ScoutPendingComposerIntent } from '@scout-agent/shared';
import { protocolClient } from './protocol-client';

interface PendingAcknowledgement {
  attempt: number;
  timer: ReturnType<typeof setTimeout>;
  version: string;
}

const ACK_TIMEOUT_MS = 1_500;
const MAX_RETRY_DELAY_MS = 5_000;
const pendingBySessionPath = new Map<string, PendingAcknowledgement>();

export function acknowledgeComposerIntentUntilSettled(intent: ScoutPendingComposerIntent): void {
  const sessionPath = intent.session.sessionPath;
  const current = pendingBySessionPath.get(sessionPath);
  if (current?.version === intent.version) return;
  if (current) clearTimeout(current.timer);
  sendAttempt(intent, 0);
}

export function resetComposerIntentAcknowledgements(): void {
  for (const pending of pendingBySessionPath.values()) {
    clearTimeout(pending.timer);
  }
  pendingBySessionPath.clear();
}

function sendAttempt(intent: ScoutPendingComposerIntent, attempt: number): void {
  const sessionPath = intent.session.sessionPath;
  const retry = () => {
    const current = pendingBySessionPath.get(sessionPath);
    if (!current || current.version !== intent.version) return;
    sendAttempt(intent, current.attempt + 1);
  };
  const timer = setTimeout(retry, retryDelay(attempt));
  pendingBySessionPath.set(sessionPath, { attempt, timer, version: intent.version });

  protocolClient.acknowledgeComposerIntent(
    intent.version,
    intent.session,
    () => settle(intent),
    () => {
      const current = pendingBySessionPath.get(sessionPath);
      if (!current || current.version !== intent.version) return;
      clearTimeout(current.timer);
      current.timer = setTimeout(retry, retryDelay(current.attempt));
    },
  );
}

function settle(intent: ScoutPendingComposerIntent): void {
  const current = pendingBySessionPath.get(intent.session.sessionPath);
  if (!current || current.version !== intent.version) return;
  clearTimeout(current.timer);
  pendingBySessionPath.delete(intent.session.sessionPath);
}

function retryDelay(attempt: number): number {
  return Math.min(ACK_TIMEOUT_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}
