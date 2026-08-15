import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutPromptsSettings } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { usePromptSettingsController } from '@/features/settings/hooks/prompt-settings-state';

type RequestPromptsResult = NonNullable<Parameters<typeof protocolClient.requestPrompts>[0]>;
type RefreshPromptsResult = NonNullable<Parameters<typeof protocolClient.refreshPrompts>[0]>;
type CreatePromptResult = NonNullable<Parameters<typeof protocolClient.createPromptTemplate>[1]>;

describe('usePromptSettingsController', () => {
  const requestResults: RequestPromptsResult[] = [];
  const refreshResults: RefreshPromptsResult[] = [];
  const createResults: CreatePromptResult[] = [];

  beforeEach(() => {
    requestResults.length = 0;
    refreshResults.length = 0;
    createResults.length = 0;
    vi.spyOn(protocolClient, 'requestPrompts').mockImplementation((onResult) => {
      if (onResult) requestResults.push(onResult);
      return `request-${requestResults.length}`;
    });
    vi.spyOn(protocolClient, 'refreshPrompts').mockImplementation((onResult) => {
      if (onResult) refreshResults.push(onResult);
      return `refresh-${refreshResults.length}`;
    });
    vi.spyOn(protocolClient, 'createPromptTemplate').mockImplementation((_name, onResult) => {
      if (onResult) createResults.push(onResult);
      return `create-${createResults.length}`;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('refreshes the inventory after creating a prompt', () => {
    const { result } = renderHook(() => usePromptSettingsController());
    resolveRequest(requestResults[0]!, makeSettings());

    act(() => result.current.createPrompt('review'));
    expect(protocolClient.createPromptTemplate).toHaveBeenCalledWith(
      'review',
      expect.any(Function),
      expect.any(Function),
    );
    act(() =>
      createResults[0]!({
        type: 'create_prompt_template_result',
        success: true,
        path: '/home/me/.scout/agent/prompts/review.md',
      }),
    );
    resolveRequest(requestResults[1]!, makeSettings());

    expect(requestResults).toHaveLength(2);
    expect(result.current.error).toBe('');
  });

  it('reloads Prompt resources when the user explicitly refreshes', () => {
    const { result } = renderHook(() => usePromptSettingsController());
    resolveRequest(requestResults[0]!, makeSettings());

    act(() => result.current.load());

    expect(protocolClient.refreshPrompts).toHaveBeenCalledOnce();
    expect(protocolClient.requestPrompts).toHaveBeenCalledOnce();
    resolveRequest(refreshResults[0]!, {
      ...makeSettings(),
      prompts: [
        {
          name: 'latest',
          command: '/latest',
          path: '/home/me/.scout/agent/prompts/latest.md',
          scope: 'global',
          sourceKind: 'global',
          sourceRoot: '/home/me/.scout/agent/prompts',
          sourceInfo: {
            path: '/home/me/.scout/agent/prompts/latest.md',
            source: 'auto',
            scope: 'user',
            origin: 'top-level',
          },
          status: 'active',
        },
      ],
    });

    expect(result.current.settings.prompts[0]?.name).toBe('latest');
    expect(result.current.error).toBe('');
  });
});

function resolveRequest(callback: RequestPromptsResult, settings: ScoutPromptsSettings): void {
  act(() => callback({ type: 'prompts_result', settings }));
}

function makeSettings(): ScoutPromptsSettings {
  return {
    globalDir: '/home/me/.scout/agent/prompts',
    diagnostics: [],
    prompts: [],
  };
}
