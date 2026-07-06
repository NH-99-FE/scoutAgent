import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectContextFiles, ScoutResourceLoader } from '../../src/core/resource-loader.ts';

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
      themePaths: [],
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
