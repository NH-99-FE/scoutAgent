// ============================================================
// Skills 加载器 — 从文件系统发现和加载 SKILL.md
// 等价 Pi skills.ts 的简化版（去掉扩展注册）
// ============================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';
import ignore from 'ignore';

// ---------- 类型 ----------

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'disable-model-invocation'?: boolean;
  [key: string]: unknown;
}

export interface Skill {
  /** 技能名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** 完整的技能指令 */
  content: string;
  /** 技能文件的绝对路径 */
  filePath: string;
  /** 技能目录（SKILL.md 所在目录） */
  baseDir: string;
  /** 是否对模型隐藏（只能显式调用） */
  disableModelInvocation: boolean;
}

/** 资源加载诊断信息 */
export interface ResourceDiagnostic {
  /** 出问题的文件路径 */
  filePath: string;
  /** 诊断消息 */
  message: string;
  /** 严重程度 */
  severity: 'error' | 'warning';
}

export interface LoadSkillsOptions {
  /** 工作目录（用于项目级 skills） */
  cwd: string;
  /** Agent 配置目录（用于全局 skills） */
  agentDir: string;
  /** 自定义路径 */
  customPaths?: string[];
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

// ---------- Frontmatter 解析 ----------

/**
 * 使用 yaml 包解析 YAML frontmatter。
 * 提取 `---` 之间的 YAML 内容，解析为 frontmatter 对象。
 */
function parseFrontmatter(rawContent: string): { frontmatter: SkillFrontmatter; body: string } {
  const frontmatter: SkillFrontmatter = {};
  let body = rawContent;

  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter, body };

  body = rawContent.slice(match[0].length);
  const yamlStr = match[1];

  try {
    const parsed = yamlParse(yamlStr);
    if (parsed && typeof parsed === 'object') {
      Object.assign(frontmatter, parsed);
    }
  } catch {
    // YAML 解析失败，返回空 frontmatter
  }

  return { frontmatter, body };
}

// ---------- .gitignore 支持 ----------

/**
 * 从目录及其父目录读取 .gitignore / .ignore / .fdignore 规则。
 * 返回 ignore 实例，用于过滤被忽略的路径。
 */
function loadIgnorePatterns(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore();
  const ignoreFiles = ['.gitignore', '.ignore', '.fdignore'];

  // 仅读取 rootDir 下的忽略文件
  for (const fileName of ignoreFiles) {
    const filePath = join(rootDir, fileName);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        ig.add(content);
      } catch {
        // 读取失败则跳过
      }
    }
  }

  // 始终忽略 node_modules 和 .git
  ig.add(['node_modules', '.git']);

  return ig;
}

// ---------- 验证 ----------

function validateName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)');
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push('name must not start or end with a hyphen');
  }
  if (name.includes('--')) {
    errors.push('name must not contain consecutive hyphens');
  }
  return errors;
}

function validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];
  if (!description || description.trim() === '') {
    errors.push('description is required');
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }
  return errors;
}

// ---------- XML 转义 ----------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------- 文件加载 ----------

function loadSkillFromFile(
  filePath: string,
  source: string,
  diagnostics: ResourceDiagnostic[],
): Skill | null {
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    // 验证 description
    const descErrors = validateDescription(frontmatter.description);
    if (
      descErrors.length > 0 ||
      !frontmatter.description ||
      frontmatter.description.trim() === ''
    ) {
      diagnostics.push({
        filePath,
        message: `Missing or invalid description: ${descErrors.join(', ')}`,
        severity: 'warning',
      });
      return null;
    }

    // 名称：frontmatter > 父目录名
    const name = (frontmatter.name as string) || parentDirName;
    const nameErrors = validateName(name);
    if (nameErrors.length > 0) {
      diagnostics.push({
        filePath,
        message: `Invalid skill name "${name}": ${nameErrors.join(', ')}`,
        severity: 'warning',
      });
    }

    return {
      name,
      description: frontmatter.description!,
      content: body.trim(),
      filePath,
      baseDir: skillDir,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    };
  } catch (error) {
    diagnostics.push({
      filePath,
      message: `Failed to load: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'error',
    });
    return null;
  }
}

// ---------- 目录扫描 ----------

/**
 * 从目录加载 skills。
 * 发现规则：
 * - 如果目录包含 SKILL.md，视为技能根，不再递归
 * - 否则，加载根目录的直接 .md 子文件
 * - 递归子目录查找 SKILL.md
 * - 遵循 .gitignore / .ignore / .fdignore 规则
 */
export function loadSkillsFromDir(
  dir: string,
  source: string,
  diagnostics?: ResourceDiagnostic[],
): Skill[] {
  return loadSkillsFromDirInternal(dir, source, true, diagnostics ?? []);
}

function loadSkillsFromDirInternal(
  dir: string,
  source: string,
  includeRootFiles: boolean,
  diagnostics: ResourceDiagnostic[],
): Skill[] {
  const skills: Skill[] = [];

  if (!existsSync(dir)) return skills;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    // 加载 .gitignore 规则
    const ig = loadIgnorePatterns(dir);

    // 优先检查 SKILL.md
    for (const entry of entries) {
      if (entry.name !== 'SKILL.md') continue;

      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      if (!isFile) continue;

      const skill = loadSkillFromFile(fullPath, source, diagnostics);
      if (skill) skills.push(skill);
      return skills;
    }

    // 遍历其他条目
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      // 使用 ignore 检查路径
      const relPath = entry.name;
      if (ig.ignores(relPath)) continue;

      const fullPath = join(dir, entry.name);

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      if (isDirectory) {
        const subSkills = loadSkillsFromDirInternal(fullPath, source, false, diagnostics);
        skills.push(...subSkills);
        continue;
      }

      if (!isFile || !includeRootFiles || !entry.name.endsWith('.md')) continue;

      const skill = loadSkillFromFile(fullPath, source, diagnostics);
      if (skill) skills.push(skill);
    }
  } catch {
    // 忽略读取错误
  }

  return skills;
}

// ---------- 公开 API ----------

/**
 * 从所有配置的位置加载 skills。
 * 1. 全局默认：{agentDir}/skills（source: "user"）
 * 2. 项目级：{cwd}/.scout/skills（source: "project"）
 * 3. 自定义路径
 */
export function loadSkills(options: LoadSkillsOptions): {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
} {
  const { cwd, agentDir, customPaths } = options;
  const skillMap = new Map<string, Skill>();
  const diagnostics: ResourceDiagnostic[] = [];

  function addSkills(newSkills: Skill[]) {
    for (const skill of newSkills) {
      if (!skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill);
      }
    }
  }

  // 全局 skills
  const userSkillsDir = join(agentDir, 'skills');
  addSkills(loadSkillsFromDirInternal(userSkillsDir, 'user', true, diagnostics));

  // 项目级 skills
  const projectSkillsDir = resolve(cwd, '.scout', 'skills');
  addSkills(loadSkillsFromDirInternal(projectSkillsDir, 'project', true, diagnostics));

  // 自定义路径
  for (const rawPath of customPaths ?? []) {
    const resolvedPath = resolve(cwd, rawPath);
    if (!existsSync(resolvedPath)) continue;

    try {
      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        addSkills(loadSkillsFromDirInternal(resolvedPath, 'path', true, diagnostics));
      } else if (stats.isFile() && resolvedPath.endsWith('.md')) {
        const skill = loadSkillFromFile(resolvedPath, 'path', diagnostics);
        if (skill) addSkills([skill]);
      }
    } catch {
      // 忽略
    }
  }

  return { skills: Array.from(skillMap.values()), diagnostics };
}

/**
 * 格式化 skills 为系统提示中的 XML 块。
 * 符合 Agent Skills 标准 (agentskills.io)。
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
  if (visibleSkills.length === 0) return '';

  const lines = [
    '',
    '',
    'The following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ];

  for (const skill of visibleSkills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');

  return lines.join('\n');
}
