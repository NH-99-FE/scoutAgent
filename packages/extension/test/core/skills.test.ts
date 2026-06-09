import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSkillsForPrompt, loadSkills, loadSkillsFromDir } from '../../src/core/skills.ts';

describe('skills loader', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-skills-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads SKILL.md using frontmatter and body content', () => {
    const skillDir = path.join(agentDir, 'skills', 'calendar');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: calendar\ndescription: Calendar help\n---\nUse calendar APIs.`,
    );

    const result = loadSkills({ cwd, agentDir });

    expect(result.diagnostics).toEqual([]);
    expect(result.skills[0]).toMatchObject({
      name: 'calendar',
      description: 'Calendar help',
      content: 'Use calendar APIs.',
      baseDir: skillDir,
    });
  });

  it('reports invalid skills and keeps scanning valid siblings', () => {
    const validDir = path.join(agentDir, 'skills', 'valid-skill');
    const invalidDir = path.join(agentDir, 'skills', 'invalid-skill');
    fs.mkdirSync(validDir, { recursive: true });
    fs.mkdirSync(invalidDir, { recursive: true });
    fs.writeFileSync(
      path.join(validDir, 'SKILL.md'),
      `---\nname: valid-skill\ndescription: Valid skill\n---\nValid`,
    );
    fs.writeFileSync(path.join(invalidDir, 'SKILL.md'), `---\nname: invalid-skill\n---\nInvalid`);

    const result = loadSkills({ cwd, agentDir });

    expect(result.skills.map((skill) => skill.name)).toEqual(['valid-skill']);
    expect(result.diagnostics[0].message).toContain('description is required');
  });

  it('does not recurse beneath a directory that already contains SKILL.md', () => {
    const root = path.join(tempDir, 'skills-root');
    const child = path.join(root, 'nested');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'SKILL.md'),
      `---\nname: root-skill\ndescription: Root skill\n---\nRoot`,
    );
    fs.writeFileSync(
      path.join(child, 'SKILL.md'),
      `---\nname: child-skill\ndescription: Child skill\n---\nChild`,
    );

    const skills = loadSkillsFromDir(root, 'test');

    expect(skills.map((skill) => skill.name)).toEqual(['root-skill']);
  });

  it('omits disabled skills from model prompt formatting', () => {
    const prompt = formatSkillsForPrompt([
      {
        name: 'visible',
        description: 'Visible skill',
        content: '',
        filePath: '/skills/visible/SKILL.md',
        baseDir: '/skills/visible',
        disableModelInvocation: false,
      },
      {
        name: 'hidden',
        description: 'Hidden skill',
        content: '',
        filePath: '/skills/hidden/SKILL.md',
        baseDir: '/skills/hidden',
        disableModelInvocation: true,
      },
    ]);

    expect(prompt).toContain('<name>visible</name>');
    expect(prompt).not.toContain('<name>hidden</name>');
  });
});
