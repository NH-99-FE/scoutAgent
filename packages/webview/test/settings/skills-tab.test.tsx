import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkillsTab } from '@/features/settings/view/SkillsTab';
import type { SkillSettingsController } from '@/features/settings/hooks/skill-settings-state';

describe('SkillsTab', () => {
  it('selects where extra skill paths are saved', () => {
    const setScope = vi.fn();
    const controller = makeController({ setScope });

    render(<SkillsTab controller={controller} />);

    fireEvent.click(screen.getByRole('combobox', { name: '保存位置' }));
    fireEvent.click(screen.getByRole('option', { name: '全局' }));

    expect(setScope).toHaveBeenCalledWith('global');
  });

  it('groups resolved skills by their protocol source root', () => {
    const controller = makeController({
      draft: {
        scope: 'project',
        settings: {
          projectDir: '/workspace/.scout/skills',
          globalDir: '/home/me/.scout/agent/skills',
          agentsDirs: [],
          globalEntries: [],
          projectEntries: ['~/.codex/skills'],
          configuredPaths: ['/home/me/.codex/skills'],
          diagnostics: [],
          skills: [
            {
              name: 'diagnosing-bugs',
              description: 'Diagnose hard bugs',
              path: '/home/me/.codex/skills/diagnosing-bugs/SKILL.md',
              scope: 'project',
              sourceKind: 'configured',
              sourceRoot: '/home/me/.codex/skills',
              sourceInfo: {
                path: '/home/me/.codex/skills/diagnosing-bugs/SKILL.md',
                source: 'local',
                scope: 'project',
                origin: 'top-level',
                baseDir: '/workspace/.scout',
              },
              exists: true,
              enabled: true,
              status: 'active',
              canToggle: true,
            },
            {
              name: 'handoff',
              description: 'Compact the current conversation',
              path: '/home/me/.codex/skills/handoff/SKILL.md',
              scope: 'project',
              sourceKind: 'configured',
              sourceRoot: '/home/me/.codex/skills',
              sourceInfo: {
                path: '/home/me/.codex/skills/handoff/SKILL.md',
                source: 'local',
                scope: 'project',
                origin: 'top-level',
                baseDir: '/workspace/.scout',
              },
              exists: true,
              enabled: true,
              status: 'active',
              canToggle: true,
            },
          ],
        },
        globalEntries: [],
        projectEntries: ['~/.codex/skills'],
      },
      currentEntries: ['~/.codex/skills'],
    });

    render(<SkillsTab controller={controller} />);

    expect(screen.getByText('~/.codex/skills')).toBeInTheDocument();
    expect(screen.getByText('额外路径')).toBeInTheDocument();
    expect(screen.getByText('diagnosing-bugs')).toBeInTheDocument();
    expect(screen.getByText('handoff')).toBeInTheDocument();
    expect(screen.queryByText('diagnosing-bugs/SKILL.md')).not.toBeInTheDocument();
    expect(screen.queryByText('handoff/SKILL.md')).not.toBeInTheDocument();
    expect(
      screen.queryByText('/home/me/.codex/skills/diagnosing-bugs/SKILL.md'),
    ).not.toBeInTheDocument();
  });

  it('renders disabled and missing skill resources with status badges', () => {
    const openSkillFile = vi.fn();
    const controller = makeController({
      openSkillFile,
      draft: {
        scope: 'project',
        settings: {
          projectDir: '/workspace/.scout/skills',
          globalDir: '/home/me/.scout/agent/skills',
          agentsDirs: [],
          globalEntries: [],
          projectEntries: ['./skills'],
          configuredPaths: ['/workspace/.scout/skills'],
          diagnostics: [
            { type: 'warning', message: 'missing description', path: '/skill.md' },
            {
              type: 'collision',
              message: 'name "disabled-skill" collision',
              path: '/workspace/.claude/skills/disabled/SKILL.md',
              collision: {
                resourceType: 'skill',
                name: 'disabled-skill',
                winnerPath: '/workspace/.scout/skills/disabled/SKILL.md',
                loserPath: '/workspace/.claude/skills/disabled/SKILL.md',
              },
            },
          ],
          skills: [
            {
              name: 'disabled-skill',
              description: 'Disabled skill',
              path: '/workspace/.scout/skills/disabled/SKILL.md',
              scope: 'project',
              sourceKind: 'configured',
              sourceRoot: '/workspace/.scout/skills',
              sourceInfo: {
                path: '/workspace/.scout/skills/disabled/SKILL.md',
                source: 'local',
                scope: 'project',
                origin: 'top-level',
                baseDir: '/workspace/.scout',
              },
              exists: true,
              enabled: false,
              status: 'disabled',
              canToggle: true,
            },
            {
              name: 'missing-skill',
              path: '/workspace/.scout/skills/missing/SKILL.md',
              scope: 'project',
              sourceKind: 'configured',
              sourceRoot: '/workspace/.scout/skills/missing/SKILL.md',
              sourceInfo: {
                path: '/workspace/.scout/skills/missing/SKILL.md',
                source: 'local',
                scope: 'project',
                origin: 'top-level',
                baseDir: '/workspace/.scout',
              },
              exists: false,
              enabled: true,
              status: 'missing',
              canToggle: false,
            },
          ],
        },
        globalEntries: [],
        projectEntries: ['./skills'],
      },
      currentEntries: ['./skills'],
    });

    render(<SkillsTab controller={controller} />);

    expect(screen.getByText('禁用')).toBeInTheDocument();
    expect(screen.getByText('缺失')).toBeInTheDocument();
    expect(screen.getByText('missing description')).toBeInTheDocument();
    expect(screen.getByText('名称冲突：disabled-skill')).toBeInTheDocument();
    expect(
      screen.getByText(
        '使用 /workspace/.scout/skills/disabled/SKILL.md，忽略 /workspace/.claude/skills/disabled/SKILL.md',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /disabled-skill/ }));
    expect(openSkillFile).toHaveBeenCalledWith('/workspace/.scout/skills/disabled/SKILL.md');
    expect(screen.getByRole('button', { name: /missing-skill/ })).toBeDisabled();
  });

  it('toggles a resolved skill through an enablement intent', () => {
    const toggleSkillEnabled = vi.fn();
    const controller = makeController({
      toggleSkillEnabled,
      draft: {
        scope: 'project',
        settings: {
          projectDir: '/workspace/.scout/skills',
          globalDir: '/home/me/.scout/agent/skills',
          agentsDirs: [],
          globalEntries: [],
          projectEntries: [],
          configuredPaths: [],
          diagnostics: [],
          skills: [
            {
              name: 'review',
              description: 'Review code changes',
              path: '/workspace/.scout/skills/review/SKILL.md',
              scope: 'project',
              sourceKind: 'project_default',
              sourceRoot: '/workspace/.scout/skills',
              sourceInfo: {
                path: '/workspace/.scout/skills/review/SKILL.md',
                source: 'auto',
                scope: 'project',
                origin: 'top-level',
                baseDir: '/workspace/.scout',
              },
              exists: true,
              enabled: true,
              status: 'active',
              canToggle: true,
            },
          ],
        },
        globalEntries: [],
        projectEntries: [],
      },
    });

    render(<SkillsTab controller={controller} />);

    fireEvent.click(screen.getByRole('switch', { name: '启用 review' }));

    expect(toggleSkillEnabled).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'review',
        path: '/workspace/.scout/skills/review/SKILL.md',
      }),
      false,
    );
  });
});

function makeController(overrides: Partial<SkillSettingsController> = {}): SkillSettingsController {
  return {
    draft: {
      scope: 'project',
      settings: {
        projectDir: '',
        globalDir: '',
        agentsDirs: [],
        globalEntries: [],
        projectEntries: [],
        configuredPaths: [],
        diagnostics: [],
        skills: [],
      },
      globalEntries: [],
      projectEntries: [],
    },
    currentEntries: [],
    isLoading: false,
    isSaving: false,
    isDirty: false,
    saved: false,
    error: '',
    load: vi.fn(),
    save: vi.fn(),
    setScope: vi.fn(),
    addEntry: vi.fn(),
    updateEntry: vi.fn(),
    removeEntry: vi.fn(),
    getSkillEnabled: (skill) => skill.enabled,
    toggleSkillEnabled: vi.fn(),
    openSkillFile: vi.fn(),
    ...overrides,
  };
}
