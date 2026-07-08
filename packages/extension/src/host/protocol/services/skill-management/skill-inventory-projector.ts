// ============================================================
// Skill inventory projector — Skills 列表协议投影
// ============================================================

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ScoutSkillListItem, ScoutSkillScope, ScoutSkillStatus } from '@scout-agent/shared';
import type { ResolvedResource } from '../../../../core/package-manager.ts';
import type { Skill } from '../../../../core/skills.ts';
import {
  getMissingConfiguredResourceEntries,
  type ConfiguredResourcePathEntry,
} from '../resource-management/index.ts';
import {
  compareSkillItems,
  getSkillDisplayName,
  toScoutSkillResourceScope,
  toScoutSkillSourceInfo,
} from './skill-resource-mappers.ts';
import type { SkillRuntimeState } from './skill-runtime-inspector.ts';
import type { SkillSourceClassifier } from './skill-source-classifier.ts';
import type { SkillTogglePlanner } from './skill-toggle-planner.ts';

// ---------- 类型 ----------

export type ConfiguredSkillPathEntry = ConfiguredResourcePathEntry<ScoutSkillScope>;
type InternalSkillStatus = ScoutSkillStatus | 'ignored';

// ---------- Projector ----------

export class SkillInventoryProjector {
  private readonly sourceClassifier: SkillSourceClassifier;
  private readonly togglePlanner: SkillTogglePlanner;

  constructor(options: {
    sourceClassifier: SkillSourceClassifier;
    togglePlanner: SkillTogglePlanner;
  }) {
    this.sourceClassifier = options.sourceClassifier;
    this.togglePlanner = options.togglePlanner;
  }

  listSkills({
    resources,
    configuredPathEntries,
    configuredSourceRoots,
    runtimeState,
  }: {
    resources: ResolvedResource[];
    configuredPathEntries: ConfiguredSkillPathEntry[];
    configuredSourceRoots: string[];
    runtimeState: SkillRuntimeState;
  }): ScoutSkillListItem[] {
    const missingConfiguredItems = this.getMissingConfiguredSkillItems(
      configuredPathEntries,
      resources,
    );
    return resources
      .map((resource) =>
        this.toSkillListItem(
          resource,
          runtimeState.metadataByPath.get(path.resolve(resource.path)),
          configuredSourceRoots,
          runtimeState,
        ),
      )
      .filter((skill): skill is ScoutSkillListItem => skill !== null)
      .concat(missingConfiguredItems)
      .sort(compareSkillItems);
  }

  private toSkillListItem(
    resource: ResolvedResource,
    skill: Skill | undefined,
    configuredSourceRoots: string[],
    runtimeState: SkillRuntimeState,
  ): ScoutSkillListItem | null {
    const source = this.sourceClassifier.classify(resource, configuredSourceRoots);
    const status = getSkillStatus(resource, skill, runtimeState);
    if (status === 'ignored') return null;

    const toggle = this.togglePlanner.createTogglePlan(resource, source);
    return {
      name: skill?.name ?? getSkillDisplayName(resource.path),
      description: skill?.description,
      path: resource.path,
      scope: toScoutSkillResourceScope(resource),
      sourceKind: source.sourceKind,
      sourceRoot: source.sourceRoot,
      sourceInfo: toScoutSkillSourceInfo(resource),
      exists: true,
      enabled: resource.enabled,
      status,
      disableModelInvocation: skill?.disableModelInvocation,
      canToggle: Boolean(toggle),
    };
  }

  private getMissingConfiguredSkillItems(
    configuredPathEntries: ConfiguredSkillPathEntry[],
    resources: ResolvedResource[],
  ): ScoutSkillListItem[] {
    return getMissingConfiguredResourceEntries(configuredPathEntries, resources).map((entry) => ({
      name: getSkillDisplayName(entry.path),
      path: entry.path,
      scope: entry.scope,
      sourceKind: 'configured',
      sourceRoot: entry.path,
      sourceInfo: entry.sourceInfo,
      exists: false,
      enabled: true,
      status: 'missing' as const,
      canToggle: false,
    }));
  }
}

// ---------- Status ----------

function getSkillStatus(
  resource: ResolvedResource,
  skill: Skill | undefined,
  runtimeState: SkillRuntimeState,
): InternalSkillStatus {
  const resourcePath = path.resolve(resource.path);
  if (!existsSync(resource.path)) return 'missing';
  if (!resource.enabled) return 'disabled';
  if (runtimeState.activePaths.has(resourcePath)) return 'active';
  return 'ignored';
}
