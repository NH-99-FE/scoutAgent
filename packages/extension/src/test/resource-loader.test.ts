/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// ResourceLoader 测试
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadSkills, mockLoadSourcedPromptTemplates } = vi.hoisted(() => ({
  mockLoadSkills: vi.fn(() => ({ skills: [] as any[], diagnostics: [] as any[] })),
  mockLoadSourcedPromptTemplates: vi.fn(async (..._args: any[]) => ({
    promptTemplates: [] as any[],
    diagnostics: [] as any[],
  })),
}));

vi.mock('../skill-loader.ts', () => ({
  loadSkills: mockLoadSkills,
}));

vi.mock('@scout-agent/agent', () => ({
  loadSourcedPromptTemplates: mockLoadSourcedPromptTemplates,
}));

vi.mock('@scout-agent/agent/node', () => ({
  NodeExecutionEnv: vi.fn(function (this: any) {}),
}));

import { ScoutResourceLoader } from '../resource-loader.ts';

describe('ScoutResourceLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSkills.mockReturnValue({ skills: [], diagnostics: [] });
    mockLoadSourcedPromptTemplates.mockResolvedValue({
      promptTemplates: [],
      diagnostics: [],
    });
  });

  it('loads default prompt template locations', async () => {
    const loader = new ScoutResourceLoader({ cwd: '/test/project', agentDir: '/test/agent' });

    await loader.load();

    const promptInputs = mockLoadSourcedPromptTemplates.mock.calls[0]![1];
    const promptInputPaths = promptInputs.map((entry: { path: string }) =>
      entry.path.replace(/\\/g, '/'),
    );
    expect(promptInputPaths).toEqual(
      expect.arrayContaining(['/test/agent/prompts', '/test/project/.scout/prompts']),
    );
  });

  it('extends resources with extension paths and keeps first prompt on collision', async () => {
    mockLoadSkills.mockReturnValue({
      skills: [
        {
          name: 'review',
          description: 'Review code',
          content: 'review',
          filePath: '/extension/skills/review/SKILL.md',
          baseDir: '/extension/skills/review',
          disableModelInvocation: false,
        },
      ],
      diagnostics: [],
    });
    mockLoadSourcedPromptTemplates.mockImplementation(async (...args: any[]) => {
      const mapper = args[2] as (promptTemplate: any, sourceInfo: any) => any;
      return {
        promptTemplates: [
          {
            promptTemplate: mapper(
              { name: 'dup', description: 'First prompt', content: 'first' },
              {
                path: '/test/project/.scout/prompts/dup.md',
                source: 'project',
                scope: 'project',
                origin: 'top-level',
              },
            ),
            source: {},
          },
          {
            promptTemplate: mapper(
              { name: 'dup', description: 'Second prompt', content: 'second' },
              {
                path: '/extension/prompts/dup.md',
                source: 'extension',
                scope: 'temporary',
                origin: 'top-level',
              },
            ),
            source: {},
          },
        ],
        diagnostics: [],
      };
    });
    const loader = new ScoutResourceLoader({ cwd: '/test/project', agentDir: '/test/agent' });

    const result = await loader.extendResources({
      skillPaths: [{ path: '/extension/skills', extensionPath: '/extension/index.ts' }],
      promptPaths: [{ path: '/extension/prompts', extensionPath: '/extension/index.ts' }],
      themePaths: [],
    });

    expect(mockLoadSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        customPaths: ['/extension/skills'],
      }),
    );
    expect(result.skills).toEqual([
      expect.objectContaining({
        name: 'review',
        sourceInfo: expect.objectContaining({
          path: '/extension/skills/review/SKILL.md',
          source: 'extension',
          scope: 'temporary',
          baseDir: '/extension',
        }),
      }),
    ]);
    const promptInputs = mockLoadSourcedPromptTemplates.mock.calls[0]![1];
    expect(promptInputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/extension/prompts' })]),
    );
    expect(result.promptTemplates).toEqual([
      expect.objectContaining({
        name: 'dup',
        description: 'First prompt',
        content: 'first',
      }),
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        message: 'name "/dup" collision',
        path: '/extension/prompts/dup.md',
        collision: expect.objectContaining({
          resourceType: 'prompt',
          name: 'dup',
          winnerPath: '/test/project/.scout/prompts/dup.md',
          loserPath: '/extension/prompts/dup.md',
        }),
      }),
    );
  });
});
