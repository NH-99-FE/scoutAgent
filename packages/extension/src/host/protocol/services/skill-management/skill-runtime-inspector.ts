// ============================================================
// Skill runtime inspector — Skills 元数据与运行态诊断
// ============================================================

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ScoutDiagnostic } from '@scout-agent/shared';
import type { ResolvedResource } from '../../../../core/package-manager.ts';
import { loadSkills, type ResourceDiagnostic, type Skill } from '../../../../core/skills.ts';

// ---------- 类型 ----------

export interface SkillRuntimeState {
  metadataByPath: Map<string, Skill>;
  activePaths: Set<string>;
  diagnostics: ScoutDiagnostic[];
}

// ---------- Inspector ----------

export class SkillRuntimeInspector {
  private readonly cwd: string;
  private readonly agentDir: string;

  constructor(options: { cwd: string; agentDir: string }) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
  }

  inspect(resources: ResolvedResource[]): SkillRuntimeState {
    const metadataByPath = this.loadMetadata(resources);
    const skillPaths = resources
      .filter((resource) => resource.enabled && existsSync(resource.path))
      .map((resource) => resource.path);
    const result = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths,
      includeDefaults: false,
    });
    const activePaths = new Set(result.skills.map((skill) => path.resolve(skill.filePath)));

    return {
      metadataByPath,
      activePaths,
      diagnostics: result.diagnostics.map(toScoutDiagnostic),
    };
  }

  private loadMetadata(resources: ResolvedResource[]): Map<string, Skill> {
    const metadata = new Map<string, Skill>();
    for (const resource of resources) {
      if (!existsSync(resource.path)) continue;
      const result = loadSkills({
        cwd: this.cwd,
        agentDir: this.agentDir,
        skillPaths: [resource.path],
        includeDefaults: false,
      });
      const skill = result.skills.find(
        (candidate) => path.resolve(candidate.filePath) === path.resolve(resource.path),
      );
      if (skill) metadata.set(path.resolve(resource.path), skill);
    }
    return metadata;
  }
}

// ---------- Projection ----------

function toScoutDiagnostic(diagnostic: ResourceDiagnostic): ScoutDiagnostic {
  return {
    type: diagnostic.type,
    message: diagnostic.message,
    path: diagnostic.path,
    collision: diagnostic.collision,
  };
}
