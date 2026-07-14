import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/core/system-prompt.ts';

describe('buildSystemPrompt', () => {
  it('includes custom tools in available tools when promptSnippet is provided', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read', 'dynamic_tool'],
      toolSnippets: {
        read: 'Read file contents',
        dynamic_tool: 'Run dynamic test behavior',
      },
      contextFiles: [],
      skills: [],
      cwd: process.cwd(),
    });

    expect(prompt).toContain('- dynamic_tool: Run dynamic test behavior');
  });

  it('omits custom tools from available tools when promptSnippet is not provided', () => {
    const prompt = buildSystemPrompt({
      selectedTools: ['read', 'dynamic_tool'],
      toolSnippets: {
        read: 'Read file contents',
      },
      contextFiles: [],
      skills: [],
      cwd: process.cwd(),
    });

    expect(prompt).toContain('- read: Read file contents');
    expect(prompt).not.toContain('- dynamic_tool:');
  });

  it('does not fall back to default tools when selected tools is empty', () => {
    const prompt = buildSystemPrompt({
      selectedTools: [],
      toolSnippets: {
        read: 'Read file contents',
        bash: 'Run shell commands',
      },
      contextFiles: [],
      skills: [],
      cwd: process.cwd(),
    });

    expect(prompt).toContain('Available tools:\n(none)');
    expect(prompt).not.toContain('- read: Read file contents');
    expect(prompt).not.toContain('- bash: Run shell commands');
  });
});
