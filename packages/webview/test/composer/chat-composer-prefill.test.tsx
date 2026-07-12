import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ScoutCommandInfo } from '@scout-agent/shared';
import { ChatComposer } from '@/features/composer';
import { useComposerStore } from '@/store/composer-store';
import {
  EMPTY_COMPOSER_DOCUMENT,
  getComposerPlainText,
  type ComposerDocument,
} from '@/store/composer-document';
import { useConfigStore } from '@/store/config-store';
import { protocolClient } from '@/bridge/protocol-client';

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

function skillCommand(name: string): ScoutCommandInfo {
  return {
    name: `skill:${name}`,
    description: `Run ${name}`,
    source: 'skill',
    sourceInfo: {
      path: '<test:skill>',
      source: 'skill',
      scope: 'temporary',
      origin: 'top-level',
    },
  };
}

function focusEditorAtEnd(editor: HTMLElement) {
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor.querySelector('p') ?? editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}

function getDocument(): ComposerDocument {
  return useComposerStore.getState().documentBySessionId['session-1'] ?? EMPTY_COMPOSER_DOCUMENT;
}

function getText(): string {
  return getComposerPlainText(getDocument());
}

describe('ChatComposer command effects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useComposerStore.getState().actions.reset();
    useConfigStore.getState().actions.reset();
  });

  it('opens slash suggestions in a portal and applies the active option from the textarea', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    useComposerStore.getState().actions.setText('session-1', '/re');
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    focusEditorAtEnd(editor);

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveTextContent('review');
    expect(editor).toHaveFocus();

    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => {
      expect(getText()).toBe('/review ');
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
  });

  it('shares one active slash option between mouse hover and keyboard navigation', async () => {
    useConfigStore
      .getState()
      .actions.setCommands([promptCommand('review'), promptCommand('rewrite')]);
    useComposerStore.getState().actions.setText('session-1', '/');
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    focusEditorAtEnd(editor);

    const menu = await screen.findByRole('listbox', { name: 'Slash commands' });
    const options = within(menu).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');

    fireEvent.mouseEnter(options[1]);
    await waitFor(() => {
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    fireEvent.keyDown(editor, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('renders a selected skill with a separating space and removes the reference atomically', async () => {
    const openSkillFile = vi.spyOn(protocolClient, 'openSkillFile').mockReturnValue('request-1');
    useConfigStore.getState().actions.setCommands([skillCommand('request-refactor-plan')]);
    useComposerStore.getState().actions.setText('session-1', '/skill:r');
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    focusEditorAtEnd(editor);
    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter' });

    const selectedSkill = await screen.findByLabelText('已选择技能：request-refactor-plan');
    expect(selectedSkill).toHaveClass('align-bottom', 'text-reference', 'cursor-pointer');
    fireEvent.mouseDown(selectedSkill);
    fireEvent.click(selectedSkill);
    expect(openSkillFile).toHaveBeenCalledWith('<test:skill>');
    expect(screen.queryByText('要求后续变更')).not.toBeInTheDocument();
    expect(getText()).toBe(' ');
    expect(getDocument().segments).toEqual([
      {
        reference: {
          commandName: 'skill:request-refactor-plan',
          id: 'skill:request-refactor-plan',
          kind: 'skill',
          path: '<test:skill>',
        },
        type: 'reference',
      },
      { text: ' ', type: 'text' },
    ]);

    // jsdom 不执行 contenteditable 的原生文本删除；这里同步浏览器第一次退格后的文档，
    // 再验证第二次退格由引用插件一次删除整个原子节点。
    const reference = getDocument().segments.find((segment) => segment.type === 'reference');
    act(() =>
      useComposerStore
        .getState()
        .actions.setDocument('session-1', { segments: reference ? [reference] : [] }),
    );
    await waitFor(() => {
      expect(getText()).toBe('');
    });
    focusEditorAtEnd(editor);
    expect(screen.getByLabelText('已选择技能：request-refactor-plan')).toBeInTheDocument();
    expect(getDocument().segments).toEqual([
      {
        reference: {
          commandName: 'skill:request-refactor-plan',
          id: 'skill:request-refactor-plan',
          kind: 'skill',
          path: '<test:skill>',
        },
        type: 'reference',
      },
    ]);

    fireEvent.keyDown(editor, { key: 'Backspace' });

    await waitFor(() => {
      expect(screen.queryByLabelText('已选择技能：request-refactor-plan')).not.toBeInTheDocument();
      expect(getDocument()).toEqual(EMPTY_COMPOSER_DOCUMENT);
    });
  });

  it('opens a selected composer file reference', async () => {
    const openMentionedFile = vi
      .spyOn(protocolClient, 'openMentionedFile')
      .mockReturnValue('request-1');
    useComposerStore.getState().actions.setDocument('session-1', {
      segments: [
        {
          type: 'reference',
          reference: {
            fileKind: 'file',
            id: 'src/agent.ts',
            kind: 'file',
            label: 'agent.ts',
            path: 'src/agent.ts',
          },
        },
      ],
    });

    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const fileReference = await screen.findByLabelText('已选择文件：src/agent.ts');
    expect(fileReference).toHaveClass('cursor-pointer');
    fireEvent.click(fileReference);
    expect(openMentionedFile).toHaveBeenCalledWith('src/agent.ts');
  });

  it('suppresses pointer focus outlines without suppressing the next keyboard focus', () => {
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });

    fireEvent.pointerDown(editor);
    editor.focus();
    expect(editor).toHaveAttribute('data-scout-suppress-focus-outline', 'true');

    fireEvent.blur(editor, { relatedTarget: null });
    expect(editor).not.toHaveAttribute('data-scout-suppress-focus-outline');

    editor.focus();
    expect(editor).not.toHaveAttribute('data-scout-suppress-focus-outline');
  });

  it('keeps suggestions open on composer interaction and dismisses them on outside pointer down', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    useComposerStore.getState().actions.setText('session-1', '/re');
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    focusEditorAtEnd(editor);

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    fireEvent.pointerDown(editor);
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
    expect(getText()).toBe('/re');
  });

  it('dismisses suggestions when focus moves outside the composer', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    useComposerStore.getState().actions.setText('session-1', '/re');
    render(
      <>
        <button type="button">外部操作</button>
        <ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />
      </>,
    );

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    focusEditorAtEnd(editor);
    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    screen.getByRole('button', { name: '外部操作' }).focus();

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
    expect(getText()).toBe('/re');
  });

  it('dismisses suggestions with Escape after focus leaves the textarea', async () => {
    useConfigStore.getState().actions.setCommands([promptCommand('review')]);
    useComposerStore.getState().actions.setText('session-1', '/re');
    render(<ChatComposer draftSessionId="session-1" placeholder="要求后续变更" />);

    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    focusEditorAtEnd(editor);

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    const addContentButton = screen.getByRole('button', { name: '添加文件、文件夹或图片' });
    addContentButton.focus();
    expect(addContentButton).toHaveFocus();
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();

    fireEvent.keyDown(addContentButton, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
    });
    expect(getText()).toBe('/re');
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
      expect(screen.getByRole('textbox', { name: '要求后续变更' })).toHaveTextContent(
        'edit this prompt',
      );
    });
    const editor = screen.getByRole('textbox', { name: '要求后续变更' });
    await waitFor(() => {
      expect(editor).toHaveFocus();
      expect(editor).toHaveAttribute('data-scout-suppress-focus-outline', 'true');
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

    expect(screen.getByRole('textbox', { name: '要求后续变更' })).toHaveTextContent('');
    expect(useComposerStore.getState().pendingCommandEffect).toEqual({
      kind: 'replace_text',
      source: 'fork',
      targetSessionId: 'session-2',
      text: 'edit this prompt',
    });
  });
});
