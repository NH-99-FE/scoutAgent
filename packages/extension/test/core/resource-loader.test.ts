import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoutPackageManager } from '../../src/core/package-manager.ts';
import { loadProjectContextFiles, ScoutResourceLoader } from '../../src/core/resource-loader.ts';

function writePrompt(filePath: string, description: string, body = 'Prompt body'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\ndescription: ${description}\n---\n${body}`);
}

describe('loadProjectContextFiles', () => {
  let tempDir: string;
  let agentDir: string;
  let repo: string;
  let cwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-resource-test-'));
    agentDir = path.join(tempDir, 'agent');
    repo = path.join(tempDir, 'repo');
    cwd = path.join(repo, 'packages', 'app');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads global context before ancestor project context files', () => {
    fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), 'global');
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'repo');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'app');

    const files = loadProjectContextFiles({ cwd, agentDir });

    expect(files.map((file) => file.content)).toEqual(['global', 'repo', 'app']);
  });
});

describe('ScoutResourceLoader', () => {
  let tempDir: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-resource-loader-test-'));
    agentDir = path.join(tempDir, 'agent');
    cwd = path.join(tempDir, 'project');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads user, project, and extension-discovered skills with source info', async () => {
    const userSkillDir = path.join(agentDir, 'skills', 'user-skill');
    const projectSkillDir = path.join(cwd, '.scout', 'skills', 'project-skill');
    const extensionSkillDir = path.join(tempDir, 'extension-skills', 'extension-skill');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.mkdirSync(projectSkillDir, { recursive: true });
    fs.mkdirSync(extensionSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillDir, 'SKILL.md'),
      `---\nname: user-skill\ndescription: User skill\n---\nUser body`,
    );
    fs.writeFileSync(
      path.join(projectSkillDir, 'SKILL.md'),
      `---\nname: project-skill\ndescription: Project skill\n---\nProject body`,
    );
    fs.writeFileSync(
      path.join(extensionSkillDir, 'SKILL.md'),
      `---\nname: extension-skill\ndescription: Extension skill\n---\nExtension body`,
    );

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const resources = await loader.extendResources({
      skillPaths: [{ path: path.join(tempDir, 'extension-skills'), extensionPath: '<extension>' }],
      promptPaths: [],
    });

    expect(resources.skills.map((skill) => skill.name).sort()).toEqual([
      'extension-skill',
      'project-skill',
      'user-skill',
    ]);
    expect(
      resources.skills.find((skill) => skill.name === 'extension-skill')?.sourceInfo?.source,
    ).toBe('extension');
  });

  it('replaces extension-discovered resources instead of retaining stale paths', async () => {
    const extensionSkillDir = path.join(tempDir, 'extension-skills', 'extension-skill');
    fs.mkdirSync(extensionSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(extensionSkillDir, 'SKILL.md'),
      `---\nname: extension-skill\ndescription: Extension skill\n---\nExtension body`,
    );

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const first = await loader.replaceExtensionResources({
      skillPaths: [{ path: extensionSkillDir, extensionPath: '<extension>' }],
      promptPaths: [],
    });

    expect(first.skills.map((skill) => skill.name)).toContain('extension-skill');

    const second = await loader.replaceExtensionResources(ScoutResourceLoader.emptyDiscovered());

    expect(second.skills.map((skill) => skill.name)).not.toContain('extension-skill');
    expect(loader.getDiscoveredResources()).toEqual({ skillPaths: [], promptPaths: [] });
  });

  it('reuses the base package resolution when replacing extension-discovered resources', async () => {
    const extensionSkillDir = path.join(tempDir, 'replacement-skill');
    fs.mkdirSync(extensionSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(extensionSkillDir, 'SKILL.md'),
      `---\nname: replacement-skill\ndescription: Replacement skill\n---\nBody`,
    );
    const resolveSpy = vi.spyOn(ScoutPackageManager.prototype, 'resolve');

    try {
      const loader = new ScoutResourceLoader({ cwd, agentDir });
      await loader.load();
      await loader.replaceExtensionResources({
        skillPaths: [{ path: extensionSkillDir, extensionPath: '<extension>' }],
        promptPaths: [],
      });
      await loader.replaceExtensionResources(ScoutResourceLoader.emptyDiscovered());

      expect(resolveSpy).toHaveBeenCalledTimes(1);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('replaces extension-discovered prompt templates instead of retaining stale paths', async () => {
    const extensionPromptDir = path.join(tempDir, 'extension-prompts');
    writePrompt(path.join(extensionPromptDir, 'extension-prompt.md'), 'Extension prompt');

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const first = await loader.replaceExtensionResources({
      skillPaths: [],
      promptPaths: [{ path: extensionPromptDir, extensionPath: '<extension>' }],
    });

    expect(first.promptTemplates.map((prompt) => prompt.name)).toContain('extension-prompt');
    expect(
      first.promptTemplates.find((prompt) => prompt.name === 'extension-prompt')?.sourceInfo,
    ).toMatchObject({
      source: 'extension',
      scope: 'temporary',
    });

    const second = await loader.replaceExtensionResources(ScoutResourceLoader.emptyDiscovered());

    expect(second.promptTemplates.map((prompt) => prompt.name)).not.toContain('extension-prompt');
    expect(loader.getDiscoveredResources()).toEqual({ skillPaths: [], promptPaths: [] });
  });

  it('prefers project skills over user skills on name collisions', async () => {
    const userSkillDir = path.join(agentDir, 'skills', 'deploy');
    const projectSkillDir = path.join(cwd, '.scout', 'skills', 'deploy');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.mkdirSync(projectSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillDir, 'SKILL.md'),
      `---\nname: deploy\ndescription: User deploy\n---\nUser body`,
    );
    fs.writeFileSync(
      path.join(projectSkillDir, 'SKILL.md'),
      `---\nname: deploy\ndescription: Project deploy\n---\nProject body`,
    );

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const resources = await loader.load();

    expect(resources.skills.find((skill) => skill.name === 'deploy')?.filePath).toBe(
      path.join(projectSkillDir, 'SKILL.md'),
    );
    expect(resources.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        collision: expect.objectContaining({
          resourceType: 'skill',
          name: 'deploy',
          winnerPath: path.join(projectSkillDir, 'SKILL.md'),
          loserPath: path.join(userSkillDir, 'SKILL.md'),
        }),
      }),
    );
  });

  it('discovers ancestor .agents skills up to the git root', async () => {
    const repo = path.join(tempDir, 'repo');
    const app = path.join(repo, 'packages', 'app');
    const agentsSkillDir = path.join(repo, '.agents', 'skills', 'repo-skill');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(app, { recursive: true });
    fs.mkdirSync(agentsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsSkillDir, 'SKILL.md'),
      `---\nname: repo-skill\ndescription: Repo skill\n---\nRepo body`,
    );

    const loader = new ScoutResourceLoader({ cwd: app, agentDir });
    const resources = await loader.load();

    expect(resources.skills.find((skill) => skill.name === 'repo-skill')?.sourceInfo).toMatchObject(
      {
        source: 'auto',
        scope: 'project',
        baseDir: path.join(repo, '.agents'),
      },
    );
  });

  it('loads skill paths declared in resource settings', async () => {
    const configuredSkillDir = path.join(tempDir, 'configured-skills', 'configured-skill');
    fs.mkdirSync(configuredSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(configuredSkillDir, 'SKILL.md'),
      `---\nname: configured-skill\ndescription: Configured skill\n---\nConfigured body`,
    );

    const loader = new ScoutResourceLoader({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: { skills: [path.join(tempDir, 'configured-skills')] },
      },
    });
    const resources = await loader.load();

    expect(
      resources.skills.find((skill) => skill.name === 'configured-skill')?.sourceInfo,
    ).toMatchObject({
      source: 'local',
      scope: 'project',
      origin: 'top-level',
    });
  });

  it('loads package manifest skills with package source info', async () => {
    const packageDir = path.join(tempDir, 'skill-package');
    const packageSkillDir = path.join(packageDir, 'skills', 'package-skill');
    fs.mkdirSync(packageSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { skills: ['skills/*'] } }),
    );
    fs.writeFileSync(
      path.join(packageSkillDir, 'SKILL.md'),
      `---\nname: package-skill\ndescription: Package skill\n---\nPackage body`,
    );

    const loader = new ScoutResourceLoader({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: { packages: [packageDir] },
      },
    });
    const resources = await loader.load();

    expect(
      resources.skills.find((skill) => skill.name === 'package-skill')?.sourceInfo,
    ).toMatchObject({
      source: packageDir,
      scope: 'project',
      origin: 'package',
      baseDir: packageDir,
    });
  });

  it('loads package manifest prompt templates with package source info', async () => {
    const packageDir = path.join(tempDir, 'prompt-package');
    writePrompt(path.join(packageDir, 'prompts', 'package-prompt.md'), 'Package prompt');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { prompts: ['prompts/*.md'] } }),
    );

    const loader = new ScoutResourceLoader({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: { packages: [packageDir] },
      },
    });
    const resources = await loader.load();

    expect(
      resources.promptTemplates.find((prompt) => prompt.name === 'package-prompt')?.sourceInfo,
    ).toMatchObject({
      source: packageDir,
      scope: 'project',
      origin: 'package',
      baseDir: packageDir,
    });
  });

  it('prefers project prompt templates over user prompt templates on name collisions', async () => {
    const userPromptPath = path.join(agentDir, 'prompts', 'review.md');
    const projectPromptPath = path.join(cwd, '.scout', 'prompts', 'review.md');
    writePrompt(userPromptPath, 'User review', 'User body');
    writePrompt(projectPromptPath, 'Project review', 'Project body');

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const resources = await loader.load();

    expect(resources.promptTemplates.find((prompt) => prompt.name === 'review')?.content).toBe(
      'Project body',
    );
    expect(
      resources.promptTemplates.find((prompt) => prompt.name === 'review')?.sourceInfo?.path,
    ).toBe(projectPromptPath);
    expect(resources.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        collision: expect.objectContaining({
          resourceType: 'prompt',
          name: 'review',
          winnerPath: projectPromptPath,
          loserPath: userPromptPath,
        }),
      }),
    );
  });

  it('does not load disabled prompt template resources into runtime resources', async () => {
    writePrompt(path.join(agentDir, 'prompts', 'keep.md'), 'Keep');
    writePrompt(path.join(agentDir, 'prompts', 'skip.md'), 'Skip');

    const loader = new ScoutResourceLoader({
      cwd,
      agentDir,
      resourceSettings: {
        global: { prompts: ['!prompts/skip.md'] },
        project: {},
      },
    });
    const resources = await loader.load();

    expect(resources.promptTemplates.map((prompt) => prompt.name)).toContain('keep');
    expect(resources.promptTemplates.map((prompt) => prompt.name)).not.toContain('skip');
  });

  it('discovers project SYSTEM.md before global SYSTEM.md', async () => {
    fs.writeFileSync(path.join(agentDir, 'SYSTEM.md'), 'global system');
    fs.mkdirSync(path.join(cwd, '.scout'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.scout', 'SYSTEM.md'), 'project system');

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const resources = await loader.load();

    expect(resources.systemPrompt).toBe('project system');
  });

  it('discovers APPEND_SYSTEM.md', async () => {
    fs.mkdirSync(path.join(cwd, '.scout'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.scout', 'APPEND_SYSTEM.md'), 'project append');

    const loader = new ScoutResourceLoader({ cwd, agentDir });
    const resources = await loader.load();

    expect(resources.appendSystemPrompt).toEqual(['project append']);
  });

  it('resolves explicit system prompt and append prompt sources', async () => {
    const appendPath = path.join(tempDir, 'append.md');
    fs.writeFileSync(appendPath, 'append from file');

    const loader = new ScoutResourceLoader({
      cwd,
      agentDir,
      systemPrompt: 'literal system',
      appendSystemPrompt: ['literal append', appendPath],
    });
    const resources = await loader.load();

    expect(resources.systemPrompt).toBe('literal system');
    expect(resources.appendSystemPrompt).toEqual(['literal append', 'append from file']);
  });
});
