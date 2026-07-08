import ignore from 'ignore';
import {
  parseSkillFrontmatter,
  prefixSkillIgnorePattern,
  SKILL_IGNORE_FILE_NAMES,
  validateSkillDescription,
  validateSkillName,
  type SkillFrontmatter,
} from './skill-metadata.ts';
import { type ExecutionEnv, type FileInfo, type Skill } from './types.ts';

type IgnoreMatcher = ReturnType<typeof ignore>;

export type SkillDiagnosticCode =
  | 'file_info_failed'
  | 'list_failed'
  | 'read_failed'
  | 'parse_failed'
  | 'invalid_metadata';

/** 加载技能时产生的警告。 */
export interface SkillDiagnostic {
  /** 诊断严重级别。当前仅产生警告。 */
  type: 'warning';
  /** 稳定的诊断代码。 */
  code: SkillDiagnosticCode;
  /** 人类可读的诊断消息。 */
  message: string;
  /** 与此诊断关联的路径。 */
  path: string;
}

/** 格式化技能调用提示，可选择追加额外的用户指令。 */
export function formatSkillInvocation(skill: Skill, additionalInstructions?: string): string {
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirnameEnvPath(skill.filePath)}.\n\n${skill.content}\n</skill>`;
  return additionalInstructions ? `${skillBlock}\n\n${additionalInstructions}` : skillBlock;
}

/**
 * 从一个或多个目录加载技能。
 *
 * 递归遍历目录，加载 `SKILL.md` 文件，将根目录下的直接 `.md` 文件加载为技能，遵循 ignore 文件，
 * 并为无效的技能文件返回诊断信息。缺失的输入目录会被跳过。
 */
export async function loadSkills(
  env: ExecutionEnv,
  dirs: string | string[],
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    const rootInfoResult = await env.fileInfo(dir);
    if (!rootInfoResult.ok) {
      if (rootInfoResult.error.code !== 'not_found') {
        diagnostics.push({
          type: 'warning',
          code: 'file_info_failed',
          message: rootInfoResult.error.message,
          path: dir,
        });
      }
      continue;
    }
    const rootInfo = rootInfoResult.value;
    if ((await resolveKind(env, rootInfo, diagnostics)) !== 'directory') continue;
    const result = await loadSkillsFromDirInternal(
      env,
      rootInfo.path,
      true,
      ignore(),
      rootInfo.path,
    );
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}

/**
 * 从带有来源标记的目录加载技能。
 *
 * 来源值会被原样保留并附加到每个已加载的技能和诊断信息上。agent 包不会解释来源值；
 * 应用程序可定义自己的来源形态。
 */
export async function loadSourcedSkills<TSource, TSkill extends Skill = Skill>(
  env: ExecutionEnv,
  inputs: Array<{ path: string; source: TSource }>,
  mapSkill?: (skill: Skill, source: TSource) => TSkill,
): Promise<{
  skills: Array<{ skill: TSkill; source: TSource }>;
  diagnostics: Array<SkillDiagnostic & { source: TSource }>;
}> {
  const skills: Array<{ skill: TSkill; source: TSource }> = [];
  const diagnostics: Array<SkillDiagnostic & { source: TSource }> = [];
  for (const input of inputs) {
    const result = await loadSkills(env, input.path);
    for (const skill of result.skills) {
      skills.push({
        skill: mapSkill ? mapSkill(skill, input.source) : (skill as TSkill),
        source: input.source,
      });
    }
    for (const diagnostic of result.diagnostics)
      diagnostics.push({ ...diagnostic, source: input.source });
  }
  return { skills, diagnostics };
}

async function loadSkillsFromDirInternal(
  env: ExecutionEnv,
  dir: string,
  includeRootFiles: boolean,
  ignoreMatcher: IgnoreMatcher,
  rootDir: string,
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  const dirInfoResult = await env.fileInfo(dir);
  if (!dirInfoResult.ok) {
    if (dirInfoResult.error.code !== 'not_found') {
      diagnostics.push({
        type: 'warning',
        code: 'file_info_failed',
        message: dirInfoResult.error.message,
        path: dir,
      });
    }
    return { skills, diagnostics };
  }
  const dirInfo = dirInfoResult.value;
  if ((await resolveKind(env, dirInfo, diagnostics)) !== 'directory')
    return { skills, diagnostics };

  await addIgnoreRules(env, ignoreMatcher, dir, rootDir, diagnostics);

  const entriesResult = await env.listDir(dir);
  if (!entriesResult.ok) {
    diagnostics.push({
      type: 'warning',
      code: 'list_failed',
      message: entriesResult.error.message,
      path: dir,
    });
    return { skills, diagnostics };
  }
  const entries = entriesResult.value;

  for (const entry of entries) {
    if (entry.name !== 'SKILL.md') continue;
    const fullPath = entry.path;
    const kind = await resolveKind(env, entry, diagnostics);
    if (kind !== 'file') continue;
    const relPath = relativeEnvPath(rootDir, fullPath);
    if (ignoreMatcher.ignores(relPath)) continue;

    const result = await loadSkillFromFile(env, fullPath);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
    return { skills, diagnostics };
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = entry.path;
    const kind = await resolveKind(env, entry, diagnostics);
    if (!kind) continue;

    const relPath = relativeEnvPath(rootDir, fullPath);
    const ignorePath = kind === 'directory' ? `${relPath}/` : relPath;
    if (ignoreMatcher.ignores(ignorePath)) continue;

    if (kind === 'directory') {
      const result = await loadSkillsFromDirInternal(env, fullPath, false, ignoreMatcher, rootDir);
      skills.push(...result.skills);
      diagnostics.push(...result.diagnostics);
      continue;
    }

    if (kind !== 'file' || !includeRootFiles || !entry.name.endsWith('.md')) continue;
    const result = await loadSkillFromFile(env, fullPath);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
  }

  return { skills, diagnostics };
}

async function addIgnoreRules(
  env: ExecutionEnv,
  ig: IgnoreMatcher,
  dir: string,
  rootDir: string,
  diagnostics: SkillDiagnostic[],
): Promise<void> {
  const relativeDir = relativeEnvPath(rootDir, dir);
  const prefix = relativeDir ? `${relativeDir}/` : '';

  for (const filename of SKILL_IGNORE_FILE_NAMES) {
    const ignorePath = joinEnvPath(dir, filename);
    const info = await env.fileInfo(ignorePath);
    if (!info.ok) {
      if (info.error.code !== 'not_found') {
        diagnostics.push({
          type: 'warning',
          code: 'file_info_failed',
          message: info.error.message,
          path: ignorePath,
        });
      }
      continue;
    }
    if (info.value.kind !== 'file') continue;
    const content = await env.readTextFile(ignorePath);
    if (!content.ok) {
      diagnostics.push({
        type: 'warning',
        code: 'read_failed',
        message: content.error.message,
        path: ignorePath,
      });
      continue;
    }
    const patterns = content.value
      .split(/\r?\n/)
      .map((line) => prefixSkillIgnorePattern(line, prefix))
      .filter((line): line is string => Boolean(line));
    if (patterns.length > 0) ig.add(patterns);
  }
}

async function loadSkillFromFile(
  env: ExecutionEnv,
  filePath: string,
): Promise<{ skill: Skill | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = [];
  const rawContent = await env.readTextFile(filePath);
  if (!rawContent.ok) {
    diagnostics.push({
      type: 'warning',
      code: 'read_failed',
      message: rawContent.error.message,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const parsed = parseSkillFrontmatter<SkillFrontmatter>(rawContent.value);
  if (!parsed.ok) {
    diagnostics.push({
      type: 'warning',
      code: 'parse_failed',
      message: parsed.error.message,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const { frontmatter, body } = parsed.value;
  const skillDir = dirnameEnvPath(filePath);
  const parentDirName = basenameEnvPath(skillDir);
  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description : undefined;

  const descriptionErrors = validateSkillDescription(description);
  for (const error of descriptionErrors) {
    diagnostics.push({ type: 'warning', code: 'invalid_metadata', message: error, path: filePath });
  }

  const frontmatterName = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
  const name = frontmatterName || parentDirName;
  for (const error of validateSkillName(name, { parentDirName })) {
    diagnostics.push({ type: 'warning', code: 'invalid_metadata', message: error, path: filePath });
  }

  if (descriptionErrors.length > 0 || description === undefined) {
    return { skill: null, diagnostics };
  }

  return {
    skill: {
      name,
      description,
      content: body,
      filePath,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    },
    diagnostics,
  };
}

async function resolveKind(
  env: ExecutionEnv,
  info: FileInfo,
  diagnostics: SkillDiagnostic[],
): Promise<'file' | 'directory' | undefined> {
  if (info.kind === 'file' || info.kind === 'directory') return info.kind;
  const canonicalPath = await env.canonicalPath(info.path);
  if (!canonicalPath.ok) {
    if (canonicalPath.error.code !== 'not_found') {
      diagnostics.push({
        type: 'warning',
        code: 'file_info_failed',
        message: canonicalPath.error.message,
        path: info.path,
      });
    }
    return undefined;
  }
  const target = await env.fileInfo(canonicalPath.value);
  if (!target.ok) {
    if (target.error.code !== 'not_found') {
      diagnostics.push({
        type: 'warning',
        code: 'file_info_failed',
        message: target.error.message,
        path: info.path,
      });
    }
    return undefined;
  }
  return target.value.kind === 'file' || target.value.kind === 'directory'
    ? target.value.kind
    : undefined;
}

function joinEnvPath(base: string, child: string): string {
  return `${base.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

function dirnameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex <= 0 ? '/' : normalized.slice(0, slashIndex);
}

function basenameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

function relativeEnvPath(root: string, path: string): string {
  const normalizedRoot = root.replace(/\/+$/, '');
  const normalizedPath = path.replace(/\/+$/, '');
  if (normalizedPath === normalizedRoot) return '';
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath.replace(/^\/+/, '');
}
