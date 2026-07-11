import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ScoutCommandInfo } from '@scout-agent/shared';
import { ChatComposer } from '@/features/composer';
import { useComposerStore } from '@/store/composer-store';
import { useConfigStore } from '@/store/config-store';

const PROMPT_SOURCE_INFO = {
  path: '<test:prompt>',
  source: 'prompt',
  scope: 'temporary',
  origin: 'top-level',
} as const;

function promptCommand(name: string): ScoutCommandInfo {
  return {
    name,
    description: `Run ${name}`,
    source: 'prompt',
    sourceInfo: PROMPT_SOURCE_INFO,
  };
}

describe('ChatComposer command effects', () => {
  afterEach(() => {
    useComposerStore.getState().actions.reset();
    useConfigStore.getState().actions.reset();
  });

  it('opens slash suggestions in a portal and applies the active option from the textarea', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const textarea = screen.getByPlaceholderText('要求后续变更');
    textarea.focus();
    fireEvent.change(textarea, {
      target: { selectionStart: 3, value: '/re' },
    });

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveTextContent('review');
    expect(textarea).toHaveFocus();

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea).toHaveValue('/review ');
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
  });

  it('shares one active slash option between mouse hover and keyboard navigation', async () => {
    useConfigStore
      .getState()
      .actions.setCommands([promptCommand('review'), promptCommand('rewrite')]);
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const textarea = screen.getByPlaceholderText('要求后续变更');
    textarea.focus();
    fireEvent.change(textarea, {
      target: { selectionStart: 1, value: '/' },
    });

    const menu = await screen.findByRole('listbox', { name: 'Slash commands' });
    const options = within(menu).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');

    fireEvent.mouseEnter(options[1]);
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps suggestions open on composer interaction and dismisses them on outside pointer down', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const textarea = screen.getByPlaceholderText('要求后续变更');
    textarea.focus();
    fireEvent.change(textarea, {
      target: { selectionStart: 3, value: '/re' },
    });

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    fireEvent.pointerDown(textarea);
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
    expect(textarea).toHaveValue('/re');
  });

  it('dismisses suggestions with Escape after focus leaves the textarea', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const textarea = screen.getByPlaceholderText('要求后续变更');
    textarea.focus();
    fireEvent.change(textarea, {
      target: { selectionStart: 3, value: '/re' },
    });

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    const addImageButton = screen.getByRole('button', { name: '添加图片' });
    addImageButton.focus();
    expect(addImageButton).toHaveFocus();
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    fireEvent.keyDown(addImageButton, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
    expect(textarea).toHaveValue('/re');
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
      expect(textarea).toHaveAttribute('data-scout-suppress-focus-outline', 'true');
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
