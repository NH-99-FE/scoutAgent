// ============================================================
// Skill toggle planner — Skills 设置启停规划
// ============================================================

import * as path from 'node:path';
import type { ScoutSkillScope, ScoutSkillToggleIntent } from '@scout-agent/shared';
import type {
  ResolvedResource,
  ScoutResourceSettingsSnapshot,
} from '../../../../core/package-manager.ts';
import { normalizeResourceEntries } from '../resource-management/index.ts';
import { toScoutSkillResourceScope } from './skill-resource-mappers.ts';
import type { SkillPathResolver } from './skill-path-resolver.ts';
import type { SkillSourceClassifier, SkillSourceProjection } from './skill-source-classifier.ts';

// ---------- 类型 ----------

export interface SkillTogglePlan {
  scope: ScoutSkillScope;
  target: string;
  baseDir: string;
}

export type SkillSavePlan =
  | { ok: true; entries: string[] }
  | { ok: false; error: string; path?: string };

export interface SkillTogglePlannerOptions {
  paths: SkillPathResolver;
  sourceClassifier: SkillSourceClassifier;
  resolveResources: (resourceSettings: ScoutResourceSettingsSnapshot) => ResolvedResource[];
  getConfiguredSourceRoots: (resourceSettings: ScoutResourceSettingsSnapshot) => string[];
}

// ---------- Planner ----------

export class SkillTogglePlanner {
  private readonly paths: SkillPathResolver;
  private readonly sourceClassifier: SkillSourceClassifier;
  private readonly resolveResources: (
    resourceSettings: ScoutResourceSettingsSnapshot,
  ) => ResolvedResource[];
  private readonly getConfiguredSourceRoots: (
    resourceSettings: ScoutResourceSettingsSnapshot,
  ) => string[];

  constructor(options: SkillTogglePlannerOptions) {
    this.paths = options.paths;
    this.sourceClassifier = options.sourceClassifier;
    this.resolveResources = options.resolveResources;
    this.getConfiguredSourceRoots = options.getConfiguredSourceRoots;
  }

  createTogglePlan(
    resource: ResolvedResource,
    source: SkillSourceProjection,
  ): SkillTogglePlan | undefined {
    const scope = toScoutSkillResourceScope(resource);
    if (scope === 'temporary' || source.sourceKind === 'package') return undefined;

    const baseDir = resource.metadata.baseDir ?? this.paths.getOverrideBaseDir(scope);
    const target = getSkillOverrideTarget(resource.path, baseDir, {
      preferAbsolute: source.sourceKind === 'agents_compat',
    });
    return {
      scope,
      target,
      baseDir,
    };
  }

  createSavePlan(
    scope: ScoutSkillScope,
    entries: string[],
    toggles: ScoutSkillToggleIntent[],
    resourceSettings: ScoutResourceSettingsSnapshot,
  ): SkillSavePlan {
    let nextEntries = normalizeResourceEntries(entries);
    let nextResourceSettings = replaceScopeSkillEntries(resourceSettings, scope, nextEntries);

    for (const toggle of normalizeSkillToggleIntents(toggles)) {
      const filePath = path.resolve(toggle.path);
      const resources = this.resolveResources(nextResourceSettings);
      const resource = findResourceByPath(resources, filePath);
      if (!resource) {
        return {
          ok: false,
          error: 'Skill resource is not managed by the saved settings',
          path: filePath,
        };
      }

      const source = this.sourceClassifier.classify(
        resource,
        this.getConfiguredSourceRoots(nextResourceSettings),
      );
      const togglePlan = this.createTogglePlan(resource, source);
      if (!togglePlan || togglePlan.scope !== scope) {
        return {
          ok: false,
          error: 'Skill resource cannot be toggled from this settings scope',
          path: filePath,
        };
      }

      nextEntries = this.createToggledSkillEntries({
        currentEntries: nextEntries,
        enabled: toggle.enabled,
        resource,
        resourceSettings: nextResourceSettings,
        togglePlan,
      });
      nextResourceSettings = replaceScopeSkillEntries(nextResourceSettings, scope, nextEntries);
    }

    return { ok: true, entries: nextEntries };
  }

  private createToggledSkillEntries({
    currentEntries,
    enabled,
    resource,
    resourceSettings,
    togglePlan,
  }: {
    currentEntries: string[];
    enabled: boolean;
    resource: ResolvedResource;
    resourceSettings: ScoutResourceSettingsSnapshot;
    togglePlan: SkillTogglePlan;
  }): string[] {
    const entriesWithoutExactOverride = currentEntries.filter(
      (entry) => !isSkillExactForceOverrideEntry(entry, resource.path, togglePlan),
    );

    if (!enabled) {
      return appendUniqueEntry(entriesWithoutExactOverride, `-${togglePlan.target}`);
    }

    const settingsWithoutExactOverride = replaceScopeSkillEntries(
      resourceSettings,
      togglePlan.scope,
      entriesWithoutExactOverride,
    );
    const resourcesWithoutExactOverride = this.resolveResources(settingsWithoutExactOverride);
    const resolvedResource = findResourceByPath(resourcesWithoutExactOverride, resource.path);
    if (resolvedResource?.enabled) {
      return entriesWithoutExactOverride;
    }

    return appendUniqueEntry(entriesWithoutExactOverride, `+${togglePlan.target}`);
  }
}

// ---------- Toggle entries ----------

function normalizeSkillToggleIntents(toggles: ScoutSkillToggleIntent[]): ScoutSkillToggleIntent[] {
  const byPath = new Map<string, ScoutSkillToggleIntent>();
  for (const toggle of toggles) {
    byPath.set(path.resolve(toggle.path), {
      path: path.resolve(toggle.path),
      enabled: toggle.enabled,
    });
  }
  return [...byPath.values()];
}

function getSkillOverrideTarget(
  filePath: string,
  baseDir: string,
  options: { preferAbsolute?: boolean } = {},
): string {
  const targetPath = path.basename(filePath) === 'SKILL.md' ? path.dirname(filePath) : filePath;
  if (options.preferAbsolute) return path.resolve(targetPath);

  const relativePath = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return toSettingsPath(relativePath);
  }
  if (relativePath === '') return '.';
  return path.resolve(targetPath);
}

function findResourceByPath(
  resources: ResolvedResource[],
  filePath: string,
): ResolvedResource | undefined {
  const resolvedPath = path.resolve(filePath);
  return resources.find((resource) => path.resolve(resource.path) === resolvedPath);
}

function appendUniqueEntry(entries: string[], entry: string): string[] {
  if (entries.some((current) => current.trim() === entry)) return entries;
  return [...entries, entry];
}

function replaceScopeSkillEntries(
  settings: ScoutResourceSettingsSnapshot,
  scope: ScoutSkillScope,
  entries: string[],
): ScoutResourceSettingsSnapshot {
  const key = scope === 'global' ? 'global' : 'project';
  const nextScopeSettings = { ...settings[key] };
  if (entries.length > 0) {
    nextScopeSettings.skills = entries;
  } else {
    delete nextScopeSettings.skills;
  }
  return {
    ...settings,
    [key]: nextScopeSettings,
  };
}

function isSkillExactForceOverrideEntry(
  entry: string,
  filePath: string,
  togglePlan: SkillTogglePlan,
): boolean {
  const trimmed = entry.trim();
  if (!trimmed.startsWith('+') && !trimmed.startsWith('-')) return false;

  const target = normalizeSkillOverrideTarget(trimmed.slice(1));
  return getSkillOverrideTargets(filePath, togglePlan).has(target);
}

function getSkillOverrideTargets(filePath: string, togglePlan: SkillTogglePlan): Set<string> {
  const targets = new Set<string>();
  targets.add(normalizeSkillOverrideTarget(togglePlan.target));
  targets.add(normalizeSkillOverrideTarget(filePath));
  targets.add(normalizeSkillOverrideTarget(getParentPath(filePath)));

  const relativePath = getRelativePath(filePath, togglePlan.baseDir);
  const relativeDir = getRelativePath(getParentPath(filePath), togglePlan.baseDir);
  if (relativePath) targets.add(normalizeSkillOverrideTarget(relativePath));
  if (relativeDir) targets.add(normalizeSkillOverrideTarget(relativeDir));

  return targets;
}

function normalizeSkillOverrideTarget(target: string): string {
  return toSettingsPath(target)
    .replace(/^\.\//, '')
    .replace(/\/SKILL\.md$/i, '')
    .replace(/\/+$/, '');
}

function getParentPath(filePath: string): string {
  const normalized = toSettingsPath(filePath).replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function getRelativePath(filePath: string, baseDir: string): string | undefined {
  const normalizedPath = toSettingsPath(filePath).replace(/\/+$/, '');
  const normalizedBase = toSettingsPath(baseDir).replace(/\/+$/, '');
  if (normalizedPath === normalizedBase) return '.';
  if (!normalizedPath.startsWith(`${normalizedBase}/`)) return undefined;
  return normalizedPath.slice(normalizedBase.length + 1);
}

function toSettingsPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
