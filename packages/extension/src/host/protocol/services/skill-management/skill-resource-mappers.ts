// ============================================================
// Skill resource mappers — Skills 协议字段映射
// ============================================================

import * as path from 'node:path';
import type { ScoutSkillListItem, ScoutSkillResourceScope, SourceInfo } from '@scout-agent/shared';
import type { ResolvedResource } from '../../../../core/package-manager.ts';

// ---------- Scope/source ----------

export function toScoutSkillResourceScope(resource: ResolvedResource): ScoutSkillResourceScope {
  if (resource.metadata.scope === 'project') return 'project';
  if (resource.metadata.scope === 'user') return 'global';
  return 'temporary';
}

export function toScoutSkillSourceInfo(resource: ResolvedResource): SourceInfo {
  return {
    path: resource.path,
    source: resource.metadata.source,
    scope: resource.metadata.scope,
    origin: resource.metadata.origin,
    baseDir: resource.metadata.baseDir,
  };
}

// ---------- Display ----------

export function compareSkillItems(a: ScoutSkillListItem, b: ScoutSkillListItem): number {
  const scopeOrder: Record<ScoutSkillResourceScope, number> = {
    project: 0,
    global: 1,
    temporary: 2,
  };
  const scopeDiff = scopeOrder[a.scope] - scopeOrder[b.scope];
  if (scopeDiff !== 0) return scopeDiff;
  return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
}

export function getSkillDisplayName(filePath: string): string {
  const baseName = path.basename(filePath);
  if (baseName === 'SKILL.md') {
    return path.basename(path.dirname(filePath));
  }
  return path.basename(filePath, path.extname(filePath));
}
