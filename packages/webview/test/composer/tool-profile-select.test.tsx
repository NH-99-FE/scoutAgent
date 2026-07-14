import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutToolProfileInfo } from '@scout-agent/shared';
import { ToolProfileSelect } from '@/features/composer/view/ToolProfileSelect';

const postMessage = vi.fn();
const profiles: ScoutToolProfileInfo[] = [
  {
    id: 'develop',
    name: '开发模式',
    tools: ['read', 'bash', 'edit', 'write'],
    builtin: true,
  },
  {
    id: 'review',
    name: '审查模式',
    tools: ['read', 'grep', 'find', 'ls'],
    builtin: true,
  },
];

describe('ToolProfileSelect', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage,
      }),
    });
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('suppresses the pointer-restored focus outline after selecting a profile', async () => {
    render(<ToolProfileSelect profileId="review" profiles={profiles} onValueChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '工具模式' });

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const option = screen.getByRole('menuitemradio', { name: '开发模式' });
    fireEvent.blur(trigger, { relatedTarget: option });
    expect(trigger).not.toHaveAttribute('data-scout-suppress-focus-outline');

    fireEvent.click(option);

    await waitFor(() => {
      expect(trigger).toHaveAttribute('data-scout-suppress-focus-outline', 'true');
    });
  });

  it('keeps keyboard-restored focus visible after selecting a profile', async () => {
    render(<ToolProfileSelect profileId="review" profiles={profiles} onValueChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '工具模式' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = screen.getByRole('menuitemradio', { name: '开发模式' });
    fireEvent.blur(trigger, { relatedTarget: option });
    fireEvent.click(option);

    await waitFor(() => {
      expect(option).not.toBeInTheDocument();
    });
    expect(trigger).not.toHaveAttribute('data-scout-suppress-focus-outline');
  });
});
