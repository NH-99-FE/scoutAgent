import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChatComposer } from '@/features/composer/ChatComposer';
import { useComposerStore } from '@/store/composer-store';

describe('ChatComposer command effects', () => {
  afterEach(() => {
    useComposerStore.getState().actions.reset();
  });

  it('consumes a fork prefill that targets its session', async () => {
    useComposerStore.getState().actions.setCommandEffect({
      kind: 'replace_text',
      source: 'fork',
      targetSessionId: 'session-1',
      text: 'edit this prompt',
    });

    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('要求后续变更')).toHaveValue('edit this prompt');
    });
    const textarea = screen.getByPlaceholderText('要求后续变更');
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(textarea).toHaveAttribute(
        'data-scout-suppress-focus-outline',
        'true',
      );
    });
    expect(useComposerStore.getState().pendingCommandEffect).toBeNull();
  });

  it('leaves a command effect untouched when it targets another session', async () => {
    useComposerStore.getState().actions.setCommandEffect({
      kind: 'replace_text',
      source: 'fork',
      targetSessionId: 'session-2',
      text: 'edit this prompt',
    });

    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    expect(screen.getByPlaceholderText('要求后续变更')).toHaveValue('');
    expect(useComposerStore.getState().pendingCommandEffect).toEqual({
      kind: 'replace_text',
      source: 'fork',
      targetSessionId: 'session-2',
      text: 'edit this prompt',
    });
  });
});
