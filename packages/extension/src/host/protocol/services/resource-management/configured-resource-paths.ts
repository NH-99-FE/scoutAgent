// ============================================================
// Configured resource paths — Settings 资源路径解析
// ============================================================

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { SourceInfo } from '@scout-agent/shared';
import type { ResolvedResource } from '../../../../core/package-manager.ts';

// ---------- 类型 ----------

export interface ConfiguredResourcePathEntry<Scope extends string> {
  path: string;
  scope: Scope;
  sourceInfo: SourceInfo;
}

// ---------- Settings entries ----------

export function normalizeResourceEntries(entries: readonly string[]): string[] {
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

export function resolveConfiguredResourcePaths(
  entries: string[] | undefined,
  baseDir: string,
): string[] {
  if (!entries) return [];
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry && !isResourceOverride(entry))
    .map((entry) => resolveSettingsPath(entry, baseDir));
}

export function resolveConfiguredResourceSourceRoots(
  entries: string[] | undefined,
  baseDir: string,
): string[] {
  if (!entries) return [];
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry && !isResourceOverride(entry))
    .map((entry) => resolveSettingsPath(getDirectoryPrefixBeforeGlob(entry), baseDir));
}

export function resolveConfiguredResourcePathEntries<Scope extends string>(
  entries: string[] | undefined,
  baseDir: string,
  scope: Scope,
  sourceScope: SourceInfo['scope'],
): ConfiguredResourcePathEntry<Scope>[] {
  if (!entries) return [];
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry && !isResourceOverride(entry) && !hasGlobPattern(entry))
    .map((entry) => {
      const resolvedPath = resolveSettingsPath(entry, baseDir);
      return {
        path: resolvedPath,
        scope,
        sourceInfo: {
          path: resolvedPath,
          source: 'local',
          scope: sourceScope,
          origin: 'top-level',
          baseDir,
        },
      };
    });
}

export function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of paths) {
    const key = path.resolve(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function dedupeConfiguredResourcePathEntries<Scope extends string>(
  entries: ConfiguredResourcePathEntry<Scope>[],
): ConfiguredResourcePathEntry<Scope>[] {
  const seen = new Set<string>();
  const result: ConfiguredResourcePathEntry<Scope>[] = [];
  for (const entry of entries) {
    const key = path.resolve(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

export function getMissingConfiguredResourceEntries<Scope extends string>(
  configuredPathEntries: ConfiguredResourcePathEntry<Scope>[],
  resources: ResolvedResource[],
): ConfiguredResourcePathEntry<Scope>[] {
  const resolvedPaths = new Set(resources.map((resource) => path.resolve(resource.path)));
  return configuredPathEntries
    .filter((entry) => !resolvedPaths.has(path.resolve(entry.path)))
    .filter((entry) => !existsSync(entry.path));
}

// ---------- 内部工具 ----------

function isResourceOverride(entry: string): boolean {
  return entry.startsWith('!') || entry.startsWith('+') || entry.startsWith('-');
}

function hasGlobPattern(entry: string): boolean {
  return entry.includes('*') || entry.includes('?');
}

function getDirectoryPrefixBeforeGlob(entry: string): string {
  const globIndex = findFirstGlobIndex(entry);
  if (globIndex < 0) return entry;

  const prefix = entry.slice(0, globIndex);
  if (!prefix) return '.';
  if (prefix.endsWith('/') || prefix.endsWith('\\')) return prefix;

  const separatorIndex = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
  if (separatorIndex < 0) return '.';
  return prefix.slice(0, separatorIndex + 1);
}

function findFirstGlobIndex(entry: string): number {
  const starIndex = entry.indexOf('*');
  const questionIndex = entry.indexOf('?');
  if (starIndex < 0) return questionIndex;
  if (questionIndex < 0) return starIndex;
  return Math.min(starIndex, questionIndex);
}

function resolveSettingsPath(input: string, baseDir: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return path.resolve(homedir(), input.slice(2));
  if (path.isAbsolute(input)) return path.resolve(input);
  return path.resolve(baseDir, input);
}
