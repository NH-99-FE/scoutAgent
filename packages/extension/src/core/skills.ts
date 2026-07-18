// ============================================================
// Skills 加载器
// 负责：扫描 SKILL.md / 根级 markdown，解析 frontmatter，生成资源诊断。
// ============================================================

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  parseSkillFrontmatter,
  prefixSkillIgnorePattern,
  SKILL_IGNORE_FILE_NAMES,
  validateSkillDescription,
  validateSkillName,
  type SkillFrontmatter as AgentSkillFrontmatter,
} from '@scout-agent/agent';
import ignore from 'ignore';
import { createSyntheticSourceInfo, type SourceInfo } from './source-info.ts';

// ---------- 类型 ----------

export type SkillFrontmatter = AgentSkillFrontmatter;

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo: SourceInfo;
  disableModelInvocation: boolean;
}

export interface ResourceCollision {
  resourceType: 'skill' | 'prompt' | 'extension';
  name: string;
  winnerPath: string;
  loserPath: string;
}

export interface ResourceDiagnostic {
  type: 'warning' | 'error' | 'collision';
  message: string;
  path?: string;
  collision?: ResourceCollision;
}

export interface LoadSkillsFromDirOptions {
  dir: string;
  source: string;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsOptions {
  cwd: string;
  agentDir: string;
  skillPaths: string[];
  includeDefaults: boolean;
}

type IgnoreMatcher = ReturnType<typeof ignore>;

// ---------- 路径与 ignore ----------

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : '';

  for (const filename of SKILL_IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename);
    if (!existsSync(ignorePath)) continue;
    try {
      const content = readFileSync(ignorePath, 'utf-8');
      const patterns = content
        .split(/\r?\n/)
        .map((line) => prefixSkillIgnorePattern(line, prefix))
        .filter((line): line is string => Boolean(line));
      if (patterns.length > 0) ig.add(patterns);
    } catch {
      // Ignore unreadable ignore files; skills discovery should remain best-effort.
    }
  }
}

function resolveKind(
  path: string,
  entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean },
): 'file' | 'directory' | undefined {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  if (!entry.isSymbolicLink()) return undefined;
  try {
    const stats = statSync(path);
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
  } catch {
    return undefined;
  }
  return undefined;
}

export function stripFrontmatter(rawContent: string): string {
  const parsed = parseSkillFrontmatter(rawContent);
  return parsed.ok ? parsed.value.body : rawContent;
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
  switch (source) {
    case 'user':
      return createSyntheticSourceInfo(filePath, {
        source: 'local',
        scope: 'user',
        baseDir,
      });
    case 'project':
      return createSyntheticSourceInfo(filePath, {
        source: 'local',
        scope: 'project',
        baseDir,
      });
    case 'path':
      return createSyntheticSourceInfo(filePath, {
        source: 'local',
        baseDir,
      });
    default:
      return createSyntheticSourceInfo(filePath, { source, baseDir });
  }
}

function loadSkillFromFile(
  filePath: string,
  source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
  const diagnostics: ResourceDiagnostic[] = [];

  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const parsed = parseSkillFrontmatter<SkillFrontmatter>(rawContent);
    if (!parsed.ok) {
      diagnostics.push({ type: 'warning', message: parsed.error.message, path: filePath });
      return { skill: null, diagnostics };
    }

    const { frontmatter } = parsed.value;
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);
    const description =
      typeof frontmatter.description === 'string' ? frontmatter.description : undefined;
    const descriptionErrors = validateSkillDescription(description);
    for (const error of descriptionErrors) {
      diagnostics.push({ type: 'warning', message: error, path: filePath });
    }

    const frontmatterName = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
    const name = frontmatterName || parentDirName;
    for (const error of validateSkillName(name)) {
      diagnostics.push({ type: 'warning', message: error, path: filePath });
    }

    if (descriptionErrors.length > 0 || description === undefined) {
      return { skill: null, diagnostics };
    }

    return {
      skill: {
        name,
        description,
        filePath,
        baseDir: skillDir,
        sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
        disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      },
      diagnostics,
    };
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      message: error instanceof Error ? error.message : 'failed to parse skill file',
      path: filePath,
    });
    return { skill: null, diagnostics };
  }
}

// ---------- 目录扫描 ----------

export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
  return loadSkillsFromDirInternal(options.dir, options.source, true);
}

function loadSkillsFromDirInternal(
  dir: string,
  source: string,
  includeRootFiles: boolean,
  ignoreMatcher?: IgnoreMatcher,
  rootDir?: string,
): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];

  if (!existsSync(dir)) return { skills, diagnostics };

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name !== 'SKILL.md') continue;
      const fullPath = join(dir, entry.name);
      const kind = resolveKind(fullPath, entry);
      const relPath = toPosixPath(relative(root, fullPath));
      if (kind !== 'file' || ig.ignores(relPath)) continue;

      const result = loadSkillFromFile(fullPath, source);
      if (result.skill) skills.push(result.skill);
      diagnostics.push(...result.diagnostics);
      return { skills, diagnostics };
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = join(dir, entry.name);
      const kind = resolveKind(fullPath, entry);
      if (!kind) continue;

      const relPath = toPosixPath(relative(root, fullPath));
      const ignorePath = kind === 'directory' ? `${relPath}/` : relPath;
      if (ig.ignores(ignorePath)) continue;

      if (kind === 'directory') {
        const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root);
        skills.push(...subResult.skills);
        diagnostics.push(...subResult.diagnostics);
        continue;
      }

      if (kind !== 'file' || !includeRootFiles || !entry.name.endsWith('.md')) continue;
      const result = loadSkillFromFile(fullPath, source);
      if (result.skill) skills.push(result.skill);
      diagnostics.push(...result.diagnostics);
    }
  } catch {
    // 无法读取目录时跳过，让其它资源继续加载。
  }

  return { skills, diagnostics };
}

// ---------- 公开 API ----------

export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
  const resolvedCwd = resolve(options.cwd);
  const resolvedAgentDir = resolve(options.agentDir);
  const skillMap = new Map<string, Skill>();
  const realPathSet = new Set<string>();
  const allDiagnostics: ResourceDiagnostic[] = [];
  const collisionDiagnostics: ResourceDiagnostic[] = [];

  const addSkills = (result: LoadSkillsResult) => {
    allDiagnostics.push(...result.diagnostics);
    for (const skill of result.skills) {
      const realPath = canonicalizePath(skill.filePath);
      if (realPathSet.has(realPath)) continue;

      const existing = skillMap.get(skill.name);
      if (existing) {
        collisionDiagnostics.push({
          type: 'collision',
          message: `name "${skill.name}" collision`,
          path: skill.filePath,
          collision: {
            resourceType: 'skill',
            name: skill.name,
            winnerPath: existing.filePath,
            loserPath: skill.filePath,
          },
        });
        continue;
      }

      skillMap.set(skill.name, skill);
      realPathSet.add(realPath);
    }
  };

  if (options.includeDefaults) {
    addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, 'skills'), 'user', true));
    addSkills(loadSkillsFromDirInternal(join(resolvedCwd, '.scout', 'skills'), 'project', true));
  }

  const userSkillsDir = join(resolvedAgentDir, 'skills');
  const projectSkillsDir = join(resolvedCwd, '.scout', 'skills');
  const isUnderPath = (target: string, root: string): boolean => {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) return true;
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  };

  const getSource = (resolvedPath: string): 'user' | 'project' | 'path' => {
    if (!options.includeDefaults) {
      if (isUnderPath(resolvedPath, userSkillsDir)) return 'user';
      if (isUnderPath(resolvedPath, projectSkillsDir)) return 'project';
    }
    return 'path';
  };

  for (const rawPath of options.skillPaths) {
    const resolvedPath = resolve(resolvedCwd, rawPath.trim());
    if (!existsSync(resolvedPath)) {
      allDiagnostics.push({
        type: 'warning',
        message: 'skill path does not exist',
        path: resolvedPath,
      });
      continue;
    }

    try {
      const stats = statSync(resolvedPath);
      const source = getSource(resolvedPath);
      if (stats.isDirectory()) {
        addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
      } else if (stats.isFile() && resolvedPath.endsWith('.md')) {
        const result = loadSkillFromFile(resolvedPath, source);
        if (result.skill) addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
        else allDiagnostics.push(...result.diagnostics);
      } else {
        allDiagnostics.push({
          type: 'warning',
          message: 'skill path is not a markdown file',
          path: resolvedPath,
        });
      }
    } catch (error) {
      allDiagnostics.push({
        type: 'warning',
        message: error instanceof Error ? error.message : 'failed to read skill path',
        path: resolvedPath,
      });
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    diagnostics: [...allDiagnostics, ...collisionDiagnostics],
  };
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
