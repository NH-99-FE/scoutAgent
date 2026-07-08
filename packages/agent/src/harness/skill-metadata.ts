// ============================================================
// Skill Metadata — skills frontmatter、ignore 与校验纯逻辑
// ============================================================

import { parse as yamlParse } from 'yaml';
import { toError } from './types.ts';

// ---------- 类型 ----------

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'disable-model-invocation'?: boolean;
  [key: string]: unknown;
}

export type ParseSkillFrontmatterResult<TFrontmatter extends Record<string, unknown>> =
  | { ok: true; value: { frontmatter: TFrontmatter; body: string } }
  | { ok: false; error: Error };

export interface ValidateSkillNameOptions {
  parentDirName?: string;
}

// ---------- 常量 ----------

const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

export const SKILL_IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore'] as const;

// ---------- Frontmatter ----------

export function parseSkillFrontmatter<
  TFrontmatter extends Record<string, unknown> = SkillFrontmatter,
>(content: string): ParseSkillFrontmatterResult<TFrontmatter> {
  try {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.startsWith('---')) {
      return { ok: true, value: { frontmatter: {} as TFrontmatter, body: normalized } };
    }

    const endIndex = normalized.indexOf('\n---', 3);
    if (endIndex === -1) {
      return { ok: true, value: { frontmatter: {} as TFrontmatter, body: normalized } };
    }

    const yaml = normalized.slice(4, endIndex);
    const parsed = yamlParse(yaml);
    const frontmatter =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as TFrontmatter)
        : ({} as TFrontmatter);

    return {
      ok: true,
      value: {
        frontmatter,
        body: normalized.slice(endIndex + 4).trim(),
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------- Ignore ----------

export function prefixSkillIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }
  if (pattern.startsWith('/')) pattern = pattern.slice(1);

  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

// ---------- 校验 ----------

export function validateSkillName(name: string, options: ValidateSkillNameOptions = {}): string[] {
  const errors: string[] = [];
  if (options.parentDirName && name !== options.parentDirName) {
    errors.push(`name "${name}" does not match parent directory "${options.parentDirName}"`);
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_SKILL_NAME_LENGTH} characters (${name.length})`);
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

export function validateSkillDescription(description: string | undefined): string[] {
  const errors: string[] = [];
  if (!description || description.trim() === '') {
    errors.push('description is required');
  } else if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    errors.push(
      `description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters (${description.length})`,
    );
  }
  return errors;
}
