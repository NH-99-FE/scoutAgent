// ============================================================
// SystemPrompt 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt.ts';
import type { Skill } from '../skill-loader.ts';

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  name: 'test-skill',
  description: 'A test skill',
  content: 'Skill instructions',
  filePath: '/path/to/SKILL.md',
  baseDir: '/path/to',
  disableModelInvocation: false,
  ...overrides,
});

describe('buildSystemPrompt', () => {
  it('includes Scout identity', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read', 'bash', 'edit', 'write'],
      cwd: '/test',
    });
    expect(prompt).toContain('Scout');
    expect(prompt).toContain('coding agent');
  });

  it('includes available tools', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read', 'bash'],
      toolSnippets: { read: 'Read files', bash: 'Execute commands' },
      cwd: '/test',
    });
    expect(prompt).toContain('read: Read files');
    expect(prompt).toContain('bash: Execute commands');
  });

  it('includes current working directory', () => {
    const prompt = buildSystemPrompt({ selectedTools: ['read'], cwd: '/my/project' });
    expect(prompt).toContain('Current working directory: /my/project');
  });

  it('includes current date', () => {
    const prompt = buildSystemPrompt({ selectedTools: ['read'], cwd: '/test' });
    expect(prompt).toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
  });

  it('includes skills when read tool is available', () => {
    const skill = makeSkill();
    const prompt = buildSystemPrompt({
      selectedTools: ['read', 'bash'],
      cwd: '/test',
      skills: [skill],
    });
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('<name>test-skill</name>');
  });

  it('excludes skills when read tool is not available', () => {
    const skill = makeSkill();
    const prompt = buildSystemPrompt({ selectedTools: ['bash'], cwd: '/test', skills: [skill] });
    expect(prompt).not.toContain('<available_skills>');
  });

  it('includes project context files', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read'],
      cwd: '/test',
      contextFiles: [{ path: 'CLAUDE.md', content: 'Project guidelines' }],
    });
    expect(prompt).toContain('<project_context>');
    expect(prompt).toContain('Project guidelines');
    expect(prompt).toContain('</project_context>');
  });

  it('uses custom prompt when provided', () => {
    const prompt = buildSystemPrompt({
      selectedTools: [],
      cwd: '/test',
      customPrompt: 'You are a custom assistant.',
    });
    expect(prompt).toContain('You are a custom assistant.');
    expect(prompt).not.toContain('Scout');
  });

  it('appends appendSystemPrompt', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read'],
      cwd: '/test',
      appendSystemPrompt: 'Additional instructions',
    });
    expect(prompt).toContain('Additional instructions');
  });

  it('converts backslashes in cwd to forward slashes', () => {
    const prompt = buildSystemPrompt({ selectedTools: ['read'], cwd: 'C:\\Users\\test\\project' });
    expect(prompt).toContain('C:/Users/test/project');
  });

  it('includes guidelines for tool preferences', () => {
    const prompt = buildSystemPrompt({ selectedTools: ['bash', 'grep', 'find'], cwd: '/test' });
    expect(prompt).toContain('Prefer grep/find/ls tools over bash');
  });

  it('includes prompt guidelines', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read'],
      cwd: '/test',
      promptGuidelines: ['Always use TypeScript'],
    });
    expect(prompt).toContain('Always use TypeScript');
  });
});
