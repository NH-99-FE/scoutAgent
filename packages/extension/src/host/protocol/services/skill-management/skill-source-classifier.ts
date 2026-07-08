// ============================================================
// Skill source classifier — Skills 来源分类策略
// ============================================================

import * as path from 'node:path';
import type { ScoutSkillSourceKind } from '@scout-agent/shared';
import type { ResolvedResource } from '../../../../core/package-manager.ts';
import { findContainingRoot, isPathInside } from '../resource-management/index.ts';
import type { SkillPathResolver } from './skill-path-resolver.ts';

// ---------- 类型 ----------

export interface SkillSourceProjection {
  sourceKind: ScoutSkillSourceKind;
  sourceRoot: string;
}

// ---------- Classifier ----------

export class SkillSourceClassifier {
  private readonly paths: SkillPathResolver;

  constructor(paths: SkillPathResolver) {
    this.paths = paths;
  }

  classify(resource: ResolvedResource, configuredSourceRoots: string[]): SkillSourceProjection {
    const fallbackRoot = resource.metadata.baseDir ?? path.dirname(resource.path);

    if (resource.metadata.scope === 'temporary') {
      return { sourceKind: 'temporary', sourceRoot: fallbackRoot };
    }

    if (resource.metadata.origin === 'package') {
      return { sourceKind: 'package', sourceRoot: fallbackRoot };
    }

    if (resource.metadata.source === 'local') {
      return {
        sourceKind: 'configured',
        sourceRoot: findContainingRoot(resource.path, configuredSourceRoots) ?? fallbackRoot,
      };
    }

    const agentsRoot = findContainingRoot(resource.path, this.paths.getAgentsSkillDirs());
    if (agentsRoot) {
      return { sourceKind: 'agents_compat', sourceRoot: agentsRoot };
    }

    const projectDir = this.paths.getProjectSkillsDir();
    if (isPathInside(resource.path, projectDir)) {
      return { sourceKind: 'project_default', sourceRoot: projectDir };
    }

    const globalDir = this.paths.getGlobalSkillsDir();
    if (isPathInside(resource.path, globalDir)) {
      return { sourceKind: 'global_default', sourceRoot: globalDir };
    }

    if (resource.metadata.scope === 'project') {
      return { sourceKind: 'project_default', sourceRoot: fallbackRoot };
    }

    return { sourceKind: 'global_default', sourceRoot: fallbackRoot };
  }
}
