// ============================================================
// SkillLoader 测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadSkills,
  loadSkillsFromDir,
  formatSkillsForPrompt,
  type Skill,
} from '../skill-loader.ts';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `scout-skill-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function writeSkillFile(
  dir: string,
  name: string,
  description: string,
  body: string = 'Skill instructions',
): string {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const filePath = join(skillDir, 'SKILL.md');
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`);
  return filePath;
}

describe('loadSkillsFromDir', () => {
  it('loads skills from SKILL.md files', () => {
    writeSkillFile(tempDir, 'my-skill', 'A test skill');
    const skills = loadSkillsFromDir(tempDir, 'user');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('my-skill');
    expect(skills[0]!.description).toBe('A test skill');
  });

  it('returns empty array for non-existent directory', () => {
    const skills = loadSkillsFromDir('/nonexistent', 'user');
    expect(skills).toHaveLength(0);
  });

  it('skips skills without description', () => {
    const skillDir = join(tempDir, 'no-desc');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: no-desc\n---\n\nNo description');
    const skills = loadSkillsFromDir(tempDir, 'user');
    expect(skills).toHaveLength(0);
  });

  it('uses parent directory name when name is missing', () => {
    const skillDir = join(tempDir, 'implicit-name');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\ndescription: A skill without explicit name\n---\n\nContent',
    );
    const skills = loadSkillsFromDir(tempDir, 'user');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('implicit-name');
  });

  it('reads skill content from body after frontmatter', () => {
    writeSkillFile(tempDir, 'content-skill', 'Has content', 'These are the instructions');
    const skills = loadSkillsFromDir(tempDir, 'user');
    expect(skills[0]!.content).toBe('These are the instructions');
  });
});

describe('loadSkills', () => {
  it('loads from user and project directories', () => {
    // 创建 agentDir/skills
    const agentDir = join(tempDir, 'agent');
    mkdirSync(join(agentDir, 'skills', 'global-skill'), { recursive: true });
    writeFileSync(
      join(agentDir, 'skills', 'global-skill', 'SKILL.md'),
      '---\nname: global-skill\ndescription: Global skill\n---\n\nGlobal',
    );

    // 创建 cwd/.scout/skills
    const cwd = join(tempDir, 'project');
    mkdirSync(join(cwd, '.scout', 'skills', 'project-skill'), { recursive: true });
    writeFileSync(
      join(cwd, '.scout', 'skills', 'project-skill', 'SKILL.md'),
      '---\nname: project-skill\ndescription: Project skill\n---\n\nProject',
    );

    const { skills } = loadSkills({ cwd, agentDir });
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name);
    expect(names).toContain('global-skill');
    expect(names).toContain('project-skill');
  });

  it('deduplicates by name (first wins)', () => {
    const agentDir = join(tempDir, 'agent');
    mkdirSync(join(agentDir, 'skills', 'dup-skill'), { recursive: true });
    writeFileSync(
      join(agentDir, 'skills', 'dup-skill', 'SKILL.md'),
      '---\nname: dup-skill\ndescription: First\n---\n\nFirst',
    );

    const cwd = join(tempDir, 'project');
    mkdirSync(join(cwd, '.scout', 'skills', 'dup-skill'), { recursive: true });
    writeFileSync(
      join(cwd, '.scout', 'skills', 'dup-skill', 'SKILL.md'),
      '---\nname: dup-skill\ndescription: Second\n---\n\nSecond',
    );

    const { skills } = loadSkills({ cwd, agentDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe('First');
  });

  it('loads from custom paths', () => {
    const customDir = join(tempDir, 'custom');
    mkdirSync(join(customDir, 'my-skill'), { recursive: true });
    writeFileSync(
      join(customDir, 'my-skill', 'SKILL.md'),
      '---\nname: my-skill\ndescription: Custom skill\n---\n\nCustom',
    );

    const { skills } = loadSkills({
      cwd: tempDir,
      agentDir: join(tempDir, 'agent'),
      customPaths: [customDir],
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('my-skill');
  });
});

describe('formatSkillsForPrompt', () => {
  it('returns empty string for empty skills', () => {
    expect(formatSkillsForPrompt([])).toBe('');
  });

  it('formats skills as XML block', () => {
    const skills: Skill[] = [
      {
        name: 'test-skill',
        description: 'A test skill',
        content: 'Instructions',
        filePath: '/path/to/SKILL.md',
        baseDir: '/path/to',
        disableModelInvocation: false,
      },
    ];

    const result = formatSkillsForPrompt(skills);
    expect(result).toContain('<available_skills>');
    expect(result).toContain('<name>test-skill</name>');
    expect(result).toContain('<description>A test skill</description>');
    expect(result).toContain('</available_skills>');
  });

  it('excludes skills with disableModelInvocation', () => {
    const skills: Skill[] = [
      {
        name: 'visible',
        description: 'Visible skill',
        content: '',
        filePath: '/a',
        baseDir: '/a',
        disableModelInvocation: false,
      },
      {
        name: 'hidden',
        description: 'Hidden skill',
        content: '',
        filePath: '/b',
        baseDir: '/b',
        disableModelInvocation: true,
      },
    ];

    const result = formatSkillsForPrompt(skills);
    expect(result).toContain('<name>visible</name>');
    expect(result).not.toContain('<name>hidden</name>');
  });

  it('escapes XML special characters', () => {
    const skills: Skill[] = [
      {
        name: 'xml-test',
        description: 'Has <special> & "chars"',
        content: '',
        filePath: '/a',
        baseDir: '/a',
        disableModelInvocation: false,
      },
    ];

    const result = formatSkillsForPrompt(skills);
    expect(result).toContain('&lt;special&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&quot;');
  });
});
