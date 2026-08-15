import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptsTab } from '@/features/settings/view/PromptsTab';
import type { PromptSettingsController } from '@/features/settings/hooks/prompt-settings-state';

describe('PromptsTab', () => {
  it('renders the inventory and forwards the primary prompt actions', () => {
    const createPrompt = vi.fn();
    const openPromptFile = vi.fn();
    const openPromptsDirectory = vi.fn();
    const controller = makeController({ createPrompt, openPromptFile, openPromptsDirectory });
    controller.settings.prompts[0] = { ...controller.settings.prompts[0]!, status: 'invalid' };
    render(<PromptsTab controller={controller} />);

    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(screen.getByText('<file> [focus]')).toBeInTheDocument();
    expect(screen.getByText('Review code')).toBeInTheDocument();
    expect(screen.getByText('无效')).toBeInTheDocument();

    fireEvent.click(screen.getByText('/review').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: '目录' }));

    fireEvent.click(screen.getByRole('button', { name: '新建 Prompt' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新 Prompt 名称' }), {
      target: { value: 'plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建并打开' }));

    expect(createPrompt).toHaveBeenCalledWith('plan');
    expect(openPromptFile).toHaveBeenCalledWith('/home/me/.scout/agent/prompts/review.md');
    expect(openPromptsDirectory).toHaveBeenCalledOnce();
  });
});

function makeController(
  overrides: Partial<PromptSettingsController> = {},
): PromptSettingsController {
  return {
    settings: {
      globalDir: '/home/me/.scout/agent/prompts',
      diagnostics: [],
      prompts: [
        {
          name: 'review',
          command: '/review',
          description: 'Review code',
          argumentHint: '<file> [focus]',
          path: '/home/me/.scout/agent/prompts/review.md',
          scope: 'global',
          sourceKind: 'global',
          sourceRoot: '/home/me/.scout/agent/prompts',
          sourceInfo: {
            path: '/home/me/.scout/agent/prompts/review.md',
            source: 'auto',
            scope: 'user',
            origin: 'top-level',
            baseDir: '/home/me/.scout/agent',
          },
          status: 'active',
        },
      ],
    },
    isLoading: false,
    isSaving: false,
    hasUnsavedChanges: false,
    error: '',
    load: vi.fn(),
    discard: vi.fn(),
    openPromptFile: vi.fn(),
    createPrompt: vi.fn(),
    openPromptsDirectory: vi.fn(),
    ...overrides,
  };
}
