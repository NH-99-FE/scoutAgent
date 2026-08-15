// ============================================================
// Prompt Templates — coding-agent 层的模板加载与展开
// ============================================================

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse } from 'yaml';
import type { SourceInfo } from './source-info.ts';

export interface PromptTemplate {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
  sourceInfo: SourceInfo;
  filePath: string;
}

export interface PromptTemplateDiagnostic {
  type: 'warning';
  code: 'list_failed' | 'read_failed' | 'parse_failed';
  message: string;
  path: string;
}

export interface PromptTemplateInput {
  path: string;
  sourceInfo: SourceInfo;
}

export interface PromptTemplateResource {
  sourceInfo: SourceInfo;
  template?: PromptTemplate;
}

interface PromptTemplateFrontmatter {
  description?: string;
  'argument-hint'?: string;
  [key: string]: unknown;
}

export function loadPromptTemplates(inputs: PromptTemplateInput | PromptTemplateInput[]): {
  resources: PromptTemplateResource[];
  promptTemplates: PromptTemplate[];
  diagnostics: PromptTemplateDiagnostic[];
} {
  const resources: PromptTemplateResource[] = [];
  const diagnostics: PromptTemplateDiagnostic[] = [];
  const seenFilePaths = new Set<string>();

  for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
    const inputPath = resolve(input.path);
    if (!existsSync(inputPath)) continue;

    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(inputPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      const result = loadTemplatesFromDir(inputPath, input.sourceInfo, seenFilePaths);
      resources.push(...result.resources);
      diagnostics.push(...result.diagnostics);
    } else if (stats.isFile() && inputPath.endsWith('.md')) {
      if (seenFilePaths.has(inputPath)) continue;
      seenFilePaths.add(inputPath);
      const fileSourceInfo = { ...input.sourceInfo, path: inputPath };
      const result = loadTemplateFromFile(inputPath, fileSourceInfo);
      resources.push({ sourceInfo: fileSourceInfo, template: result.promptTemplate ?? undefined });
      diagnostics.push(...result.diagnostics);
    }
  }

  return {
    resources,
    promptTemplates: resources.flatMap((resource) =>
      resource.template ? [resource.template] : [],
    ),
    diagnostics,
  };
}

function loadTemplatesFromDir(
  dir: string,
  sourceInfo: SourceInfo,
  seenFilePaths: Set<string>,
): { resources: PromptTemplateResource[]; diagnostics: PromptTemplateDiagnostic[] } {
  const resources: PromptTemplateResource[] = [];
  const diagnostics: PromptTemplateDiagnostic[] = [];
  let entries: Dirent[];

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      code: 'list_failed',
      message: toErrorMessage(error),
      path: dir,
    });
    return { resources, diagnostics };
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.endsWith('.md')) continue;
    const filePath = resolve(dir, entry.name);
    if (seenFilePaths.has(filePath)) continue;
    try {
      if (!statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    seenFilePaths.add(filePath);
    const fileSourceInfo = { ...sourceInfo, path: filePath };
    const result = loadTemplateFromFile(filePath, fileSourceInfo);
    resources.push({ sourceInfo: fileSourceInfo, template: result.promptTemplate ?? undefined });
    diagnostics.push(...result.diagnostics);
  }

  return { resources, diagnostics };
}

function loadTemplateFromFile(
  filePath: string,
  sourceInfo: SourceInfo,
): { promptTemplate: PromptTemplate | null; diagnostics: PromptTemplateDiagnostic[] } {
  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      promptTemplate: null,
      diagnostics: [
        {
          type: 'warning',
          code: 'read_failed',
          message: toErrorMessage(error),
          path: filePath,
        },
      ],
    };
  }

  const parsed = parseFrontmatter(rawContent);
  if (parsed.error) {
    return {
      promptTemplate: null,
      diagnostics: [
        {
          type: 'warning',
          code: 'parse_failed',
          message: parsed.error,
          path: filePath,
        },
      ],
    };
  }

  const firstLine = parsed.body.split('\n').find((line) => line.trim());
  let description =
    typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description : '';
  if (!description && firstLine) {
    description = firstLine.slice(0, 60);
    if (firstLine.length > 60) description += '...';
  }

  return {
    promptTemplate: {
      name: basename(filePath).replace(/\.md$/i, ''),
      description: description || undefined,
      argumentHint:
        typeof parsed.frontmatter['argument-hint'] === 'string'
          ? parsed.frontmatter['argument-hint'].trim() || undefined
          : undefined,
      content: parsed.body,
      sourceInfo: { ...sourceInfo, path: filePath },
      filePath,
    },
    diagnostics: [],
  };
}

function parseFrontmatter(content: string): {
  frontmatter: PromptTemplateFrontmatter;
  body: string;
  error?: string;
} {
  try {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.startsWith('---')) return { frontmatter: {}, body: normalized };
    const endIndex = normalized.indexOf('\n---', 3);
    if (endIndex === -1) return { frontmatter: {}, body: normalized };
    const frontmatter = (parse(normalized.slice(4, endIndex)) ?? {}) as PromptTemplateFrontmatter;
    return { frontmatter, body: normalized.slice(endIndex + 4).trim() };
  } catch (error) {
    return { frontmatter: {}, body: '', error: toErrorMessage(error) };
  }
}

export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

export function substituteArgs(content: string, args: string[]): string {
  let result = content.replace(/\$(\d+)/g, (_, num: string) => args[parseInt(num, 10) - 1] ?? '');
  result = result.replace(
    /\$\{@:(\d+)(?::(\d+))?\}/g,
    (_, startText: string, lengthText?: string) => {
      const start = Math.max(0, parseInt(startText, 10) - 1);
      const values = lengthText
        ? args.slice(start, start + parseInt(lengthText, 10))
        : args.slice(start);
      return values.join(' ');
    },
  );
  const allArgs = args.join(' ');
  return result.replace(/\$ARGUMENTS/g, allArgs).replace(/\$@/g, allArgs);
}

export function formatPromptTemplateInvocation(
  template: Pick<PromptTemplate, 'content'>,
  args: string[] = [],
): string {
  return substituteArgs(template.content, args);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
