// ============================================================
// 系统提示构建 — 工具描述、skills、项目上下文
// ============================================================

import type { Skill } from './skills.ts';
import { formatSkillsForPrompt } from './skills.ts';

export interface BuildSystemPromptOptions {
  /** 自定义系统提示（替换默认） */
  customPrompt?: string;
  /** 活跃工具列表 */
  selectedTools: string[];
  /** 工具描述片段（工具名 → 一行描述） */
  toolSnippets?: Record<string, string>;
  /** 额外指南条目 */
  promptGuidelines?: string[];
  /** 追加到系统提示末尾的文本 */
  appendSystemPrompt?: string;
  /** 工作目录 */
  cwd: string;
  /** 项目上下文文件 */
  contextFiles?: Array<{ path: string; content: string }>;
  /** 技能列表 */
  skills?: Skill[];
}

/** 构建系统提示 */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    customPrompt,
    selectedTools,
    toolSnippets,
    promptGuidelines,
    appendSystemPrompt,
    cwd,
    contextFiles: providedContextFiles,
    skills: providedSkills,
  } = options;

  const promptCwd = cwd.replace(/\\/g, '/');

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const date = `${year}-${month}-${day}`;

  const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : '';
  const contextFiles = providedContextFiles ?? [];
  const skills = providedSkills ?? [];

  // ---------- 自定义提示 ----------

  if (customPrompt) {
    let prompt = customPrompt;

    if (appendSection) prompt += appendSection;

    if (contextFiles.length > 0) {
      prompt += '\n\n<project_context>\n\n';
      prompt += 'Project-specific instructions and guidelines:\n\n';
      for (const { path: filePath, content } of contextFiles) {
        prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
      }
      prompt += '</project_context>\n';
    }

    const customPromptHasRead = !selectedTools || selectedTools.includes('read');
    if (customPromptHasRead && skills.length > 0) {
      prompt += formatSkillsForPrompt(skills);
    }

    prompt += `\nCurrent date: ${date}`;
    prompt += `\nCurrent working directory: ${promptCwd}`;

    return prompt;
  }

  // ---------- 默认提示 ----------

  const tools = selectedTools;
  const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join('\n')
      : '(none)';

  // 指南构建
  const guidelinesList: string[] = [];
  const guidelinesSet = new Set<string>();
  const addGuideline = (guideline: string): void => {
    if (guidelinesSet.has(guideline)) return;
    guidelinesSet.add(guideline);
    guidelinesList.push(guideline);
  };

  const hasBash = tools.includes('bash');
  const hasGrep = tools.includes('grep');
  const hasFind = tools.includes('find');
  const hasLs = tools.includes('ls');
  const hasRead = tools.includes('read');

  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline('Use bash for file operations like ls, rg, find');
  } else if (hasBash && (hasGrep || hasFind || hasLs)) {
    addGuideline(
      'Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)',
    );
  }

  for (const guideline of promptGuidelines ?? []) {
    const normalized = guideline.trim();
    if (normalized.length > 0) addGuideline(normalized);
  }

  addGuideline('Be concise in your responses');
  addGuideline('Show file paths clearly when working with files');

  const guidelines = guidelinesList.map((g) => `- ${g}`).join('\n');

  let prompt = `You are an expert coding assistant operating inside Scout, a coding agent. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}`;

  if (appendSection) prompt += appendSection;

  if (contextFiles.length > 0) {
    prompt += '\n\n<project_context>\n\n';
    prompt += 'Project-specific instructions and guidelines:\n\n';
    for (const { path: filePath, content } of contextFiles) {
      prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
    }
    prompt += '</project_context>\n';
  }

  if (hasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
  }

  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}
