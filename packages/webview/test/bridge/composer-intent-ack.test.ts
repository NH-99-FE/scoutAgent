import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoutPendingComposerIntent } from '@scout-agent/shared';
import {
  acknowledgeComposerIntentUntilSettled,
  resetComposerIntentAcknowledgements,
} from '@/bridge/composer-intent-ack';
import { protocolClient } from '@/bridge/protocol-client';

const INTENT: ScoutPendingComposerIntent = {
  kind: 'replace_text',
  version: 'intent-1',
  commandId: 'navigation-1',
  session: {
    sessionId: 'session-1',
    sessionPath: '/sessions/session-1.jsonl',
  },
  text: 'edit this prompt',
};

describe('composer intent acknowledgement', () => {
  afterEach(() => {
    resetComposerIntentAcknowledgements();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries an idempotent acknowledgement after a transport error', async () => {
    vi.useFakeTimers();
    const acknowledge = vi
      .spyOn(protocolClient, 'acknowledgeComposerIntent')
      .mockImplementation((_version, _session, onResult, onError) => {
        if (acknowledge.mock.calls.length === 1) {
          onError?.('offline');
        } else {
          onResult?.({ type: 'ack_composer_intent_result', status: 'acknowledged' });
        }
        return `request-${acknowledge.mock.calls.length}`;
      });

    acknowledgeComposerIntentUntilSettled(INTENT);
    expect(acknowledge).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_500);

    expect(acknowledge).toHaveBeenCalledTimes(2);
  });
});
