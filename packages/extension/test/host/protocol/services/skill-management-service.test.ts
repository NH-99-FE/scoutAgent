import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutRuntimeSettingsPatch } from '@scout-agent/shared';
import type { ConfigManager } from '../../../../src/config-manager.ts';
import type { ScoutResourceSettingsSnapshot } from '../../../../src/core/package-manager.ts';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { SkillManagementProtocolService } from '../../../../src/host/protocol/services/skill-management-service.ts';
import { applyRuntimeSettingsPatch } from '../../../../src/runtime-settings-schema.ts';

describe('SkillManagementProtocolService', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-skill-management-test-'));
    process.env.HOME = tempDir;
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'skills'), { recursive: true });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists resolved project, global, settings, and missing skill resources', async () => {
    const projectSkill = path.join(cwd, '.scout', 'skills', 'project-skill', 'SKILL.md');
    const globalSkill = path.join(agentDir, 'skills', 'global-skill', 'SKILL.md');
    const configuredSkill = path.join(tempDir, 'configured-skill', 'SKILL.md');
    const missingSkill = path.join(tempDir, 'missing-skill', 'SKILL.md');
    const agentsSkillsDir = path.join(tempDir, '.agents', 'skills');
    const agentsSkill = path.join(agentsSkillsDir, 'agents-skill', 'SKILL.md');
    writeSkill(projectSkill, 'project-skill', 'Project skill');
    writeSkill(globalSkill, 'global-skill', 'Global skill');
    writeSkill(configuredSkill, 'configured-skill', 'Configured skill');
    writeSkill(agentsSkill, 'agents-skill', 'Agents skill');

    const service = createService({
      resourceSettings: {
        project: { skills: [missingSkill] },
        global: { skills: [configuredSkill] },
      },
    });
    const respond = vi.fn();

    await service.requestSkills(respond);

    expect(respond).toHaveBeenCalledWith({
      type: 'skills_result',
      settings: expect.objectContaining({
        projectDir: path.join(cwd, '.scout', 'skills'),
        globalDir: path.join(agentDir, 'skills'),
        agentsDirs: [agentsSkillsDir],
        globalEntries: [configuredSkill],
        projectEntries: [missingSkill],
        configuredPaths: [missingSkill, configuredSkill],
        skills: expect.arrayContaining([
          expect.objectContaining({
            name: 'project-skill',
            description: 'Project skill',
            path: projectSkill,
            scope: 'project',
            sourceKind: 'project_default',
            sourceRoot: path.join(cwd, '.scout', 'skills'),
            exists: true,
            enabled: true,
            status: 'active',
            canToggle: true,
          }),
          expect.objectContaining({
            name: 'global-skill',
            description: 'Global skill',
            path: globalSkill,
            scope: 'global',
            sourceKind: 'global_default',
            sourceRoot: path.join(agentDir, 'skills'),
            exists: true,
            enabled: true,
            status: 'active',
            canToggle: true,
          }),
          expect.objectContaining({
            name: 'configured-skill',
            description: 'Configured skill',
            path: configuredSkill,
            scope: 'global',
            sourceKind: 'configured',
            sourceRoot: configuredSkill,
            exists: true,
            enabled: true,
            status: 'active',
            canToggle: true,
          }),
          expect.objectContaining({
            name: 'agents-skill',
            description: 'Agents skill',
            path: agentsSkill,
            scope: 'global',
            sourceKind: 'agents_compat',
            sourceRoot: agentsSkillsDir,
            exists: true,
            enabled: true,
            status: 'active',
            canToggle: true,
          }),
          expect.objectContaining({
            name: 'missing-skill',
            path: missingSkill,
            scope: 'project',
            sourceKind: 'configured',
            sourceRoot: missingSkill,
            exists: false,
            enabled: true,
            status: 'missing',
            canToggle: false,
          }),
        ]),
      }),
    });
  });

  it('preserves disabled skill resources, omits ignored resources, and reports diagnostics', async () => {
    const enabledSkill = path.join(tempDir, 'enabled-skill', 'SKILL.md');
    const duplicateSkill = path.join(tempDir, 'duplicate-skill', 'SKILL.md');
    const disabledSkill = path.join(tempDir, 'disabled-skill', 'SKILL.md');
    const invalidSkill = path.join(tempDir, 'invalid-skill', 'SKILL.md');
    writeSkill(enabledSkill, 'enabled-skill', 'Enabled skill');
    writeSkill(duplicateSkill, 'enabled-skill', 'Duplicate skill');
    writeSkill(disabledSkill, 'disabled-skill', 'Disabled skill');
    fs.mkdirSync(path.dirname(invalidSkill), { recursive: true });
    fs.writeFileSync(invalidSkill, '---\nname: invalid-skill\n---\nInvalid');
    const service = createService({
      resourceSettings: {
        project: {},
        global: {
          skills: [enabledSkill, duplicateSkill, disabledSkill, `-${disabledSkill}`, invalidSkill],
        },
      },
    });
    const respond = vi.fn();

    await service.requestSkills(respond);

    const settings = respond.mock.calls[0]?.[0].settings;
    expect(settings.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'enabled-skill', enabled: true, status: 'active' }),
        expect.objectContaining({
          name: 'disabled-skill',
          enabled: false,
          status: 'disabled',
        }),
      ]),
    );
    expect(settings.skills).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: duplicateSkill }),
        expect.objectContaining({ path: invalidSkill }),
      ]),
    );
    expect(settings.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'warning',
          message: 'description is required',
          path: invalidSkill,
        }),
        expect.objectContaining({
          type: 'collision',
          message: 'name "enabled-skill" collision',
          path: duplicateSkill,
          collision: {
            resourceType: 'skill',
            name: 'enabled-skill',
            winnerPath: enabledSkill,
            loserPath: duplicateSkill,
          },
        }),
      ]),
    );
  });

  it('uses glob static prefixes when projecting configured skill source roots', async () => {
    const skillPath = path.join(cwd, '.scout', 'skills', 'glob-skill', 'SKILL.md');
    writeSkill(skillPath, 'glob-skill', 'Glob skill');
    const service = createService({
      resourceSettings: {
        project: { skills: ['.', './skills/*'] },
        global: {},
      },
    });
    const respond = vi.fn();

    await service.requestSkills(respond);

    const settings = respond.mock.calls[0]?.[0].settings;
    expect(settings.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'glob-skill',
          path: skillPath,
          sourceKind: 'configured',
          sourceRoot: path.join(cwd, '.scout', 'skills'),
        }),
      ]),
    );
  });

  it('saves scoped skill entries and reloads runtime resources', async () => {
    const reload = vi.fn(async () => ({ cancelled: false }));
    const saveRuntimeSettings = vi.fn();
    const requestCommands = vi.fn();
    const pushState = vi.fn(async () => undefined);
    const pushTreeData = vi.fn(async () => undefined);
    const service = createService({
      reload,
      saveRuntimeSettings,
      requestCommands,
      pushState,
      pushTreeData,
    });
    const respond = vi.fn();

    await service.saveSkillsSettings(
      { type: 'save_skills_settings', scope: 'project', entries: [' ./skills/review ', ''] },
      respond,
    );

    expect(saveRuntimeSettings).toHaveBeenCalledWith('project', {
      operations: [{ op: 'set', path: 'skills', value: ['./skills/review'] }],
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(requestCommands).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushTreeData).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      type: 'save_skills_settings_result',
      success: true,
      settings: expect.objectContaining({ projectEntries: ['./skills/review'] }),
    });
  });

  it('applies per-skill disable intents while saving skill settings', async () => {
    const skillPath = path.join(cwd, '.scout', 'skills', 'review', 'SKILL.md');
    writeSkill(skillPath, 'review', 'Review');
    const saveRuntimeSettings = vi.fn();
    const service = createService({ saveRuntimeSettings });
    const respond = vi.fn();

    await service.saveSkillsSettings(
      {
        type: 'save_skills_settings',
        scope: 'project',
        entries: [],
        toggles: [{ path: skillPath, enabled: false }],
      },
      respond,
    );

    expect(saveRuntimeSettings).toHaveBeenCalledWith('project', {
      operations: [{ op: 'set', path: 'skills', value: ['-skills/review'] }],
    });
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      type: 'save_skills_settings_result',
      success: true,
      settings: expect.objectContaining({ projectEntries: ['-skills/review'] }),
    });
  });

  it('removes exact disable rules when saving an enable intent', async () => {
    const skillPath = path.join(cwd, '.scout', 'skills', 'review', 'SKILL.md');
    writeSkill(skillPath, 'review', 'Review');
    const saveRuntimeSettings = vi.fn();
    const service = createService({
      resourceSettings: { project: { skills: ['-skills/review'] }, global: {} },
      saveRuntimeSettings,
    });
    const respond = vi.fn();

    await service.saveSkillsSettings(
      {
        type: 'save_skills_settings',
        scope: 'project',
        entries: ['-skills/review'],
        toggles: [{ path: skillPath, enabled: true }],
      },
      respond,
    );

    expect(saveRuntimeSettings).toHaveBeenCalledWith('project', {
      operations: [{ op: 'unset', path: 'skills' }],
    });
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      type: 'save_skills_settings_result',
      success: true,
      settings: expect.objectContaining({ projectEntries: [] }),
    });
  });

  it('adds force include only when broad excludes still disable the saved skill', async () => {
    const skillPath = path.join(cwd, '.scout', 'skills', 'review', 'SKILL.md');
    writeSkill(skillPath, 'review', 'Review');
    const saveRuntimeSettings = vi.fn();
    const service = createService({
      resourceSettings: { project: { skills: ['!**/*'] }, global: {} },
      saveRuntimeSettings,
    });
    const respond = vi.fn();

    await service.saveSkillsSettings(
      {
        type: 'save_skills_settings',
        scope: 'project',
        entries: ['!**/*'],
        toggles: [{ path: skillPath, enabled: true }],
      },
      respond,
    );

    expect(saveRuntimeSettings).toHaveBeenCalledWith('project', {
      operations: [{ op: 'set', path: 'skills', value: ['!**/*', '+skills/review'] }],
    });
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      type: 'save_skills_settings_result',
      success: true,
      settings: expect.objectContaining({ projectEntries: ['!**/*', '+skills/review'] }),
    });
  });

  it('opens files under known skill roots and rejects unknown paths', async () => {
    const skillPath = path.join(cwd, '.scout', 'skills', 'review', 'SKILL.md');
    writeSkill(skillPath, 'review', 'Review');
    const openTextFile = vi.fn(async () => undefined);
    const service = createService({ openTextFile });
    const respond = vi.fn();

    await service.openSkillFile({ type: 'open_skill_file', path: skillPath }, respond);

    expect(openTextFile).toHaveBeenCalledWith(skillPath);
    expect(respond).toHaveBeenCalledWith({
      type: 'open_skill_file_result',
      success: true,
      path: skillPath,
    });

    await service.openSkillFile(
      { type: 'open_skill_file', path: path.join(tempDir, 'nope.md') },
      respond,
    );

    expect(respond.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'open_skill_file_result',
      success: false,
      error: expect.stringContaining('outside known skill paths'),
    });
  });

  function createService({
    resourceSettings,
    reload = vi.fn(async () => ({ cancelled: false })),
    saveRuntimeSettings = vi.fn(),
    requestCommands = vi.fn(),
    pushState = vi.fn(async () => undefined),
    pushTreeData = vi.fn(async () => undefined),
    openTextFile,
  }: {
    resourceSettings?: ScoutResourceSettingsSnapshot;
    reload?: () => Promise<{ cancelled: boolean }>;
    saveRuntimeSettings?: (scope: string, patch: unknown) => void;
    requestCommands?: () => void;
    pushState?: () => Promise<void>;
    pushTreeData?: () => Promise<void>;
    openTextFile?: (filePath: string) => Promise<void>;
  } = {}) {
    let settings = resourceSettings ?? { project: {}, global: {} };
    const getRuntimeSettings = () => ({
      globalSettingsPath: path.join(agentDir, 'settings.json'),
      projectSettingsPath: path.join(cwd, '.scout', 'settings.json'),
      global: settings.global,
      project: settings.project,
      effective: {},
    });
    const persistRuntimeSettings = (
      scope: 'project' | 'global',
      patch: ScoutRuntimeSettingsPatch,
    ) => {
      saveRuntimeSettings(scope, patch);
      settings = {
        ...settings,
        [scope]: applyRuntimeSettingsPatch(settings[scope] as Record<string, unknown>, patch),
      };
      return getRuntimeSettings();
    };
    return new SkillManagementProtocolService({
      cwd,
      agentDir,
      configManager: {
        getRuntimeSettings: vi.fn(getRuntimeSettings),
        getResourceSettings: vi.fn(() => settings),
        saveRuntimeSettings: persistRuntimeSettings,
      } as unknown as ConfigManager,
      sessionManager: {
        reload,
      } as unknown as ExtensionSessionCoordinator,
      openTextFile,
      pushConfig: vi.fn(),
      requestCommands,
      pushState,
      pushTreeData,
    });
  }
});

function writeSkill(filePath: string, name: string, description: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\nContent`);
}
