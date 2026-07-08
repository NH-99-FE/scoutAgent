// ============================================================
// Skills 管理协议契约
// ============================================================

import type { ScoutDiagnostic, SourceInfo } from './protocol-core.ts';

export type ScoutSkillScope = 'project' | 'global';
export type ScoutSkillResourceScope = ScoutSkillScope | 'temporary';
export type ScoutSkillSourceKind =
  | 'project_default'
  | 'global_default'
  | 'agents_compat'
  | 'configured'
  | 'package'
  | 'temporary';
export type ScoutSkillStatus = 'active' | 'disabled' | 'missing';

export interface ScoutSkillListItem {
  name: string;
  description?: string;
  path: string;
  scope: ScoutSkillResourceScope;
  sourceKind: ScoutSkillSourceKind;
  sourceRoot: string;
  sourceInfo: SourceInfo;
  exists: boolean;
  enabled: boolean;
  status: ScoutSkillStatus;
  disableModelInvocation?: boolean;
  canToggle: boolean;
}

export interface ScoutSkillToggleIntent {
  path: string;
  enabled: boolean;
}

export interface ScoutSkillsSettings {
  projectDir: string;
  globalDir: string;
  agentsDirs: string[];
  globalEntries: string[];
  projectEntries: string[];
  configuredPaths: string[];
  diagnostics: ScoutDiagnostic[];
  skills: ScoutSkillListItem[];
}
