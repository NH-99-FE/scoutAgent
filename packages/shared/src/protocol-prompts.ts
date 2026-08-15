// ============================================================
// Prompts 管理协议契约
// ============================================================

import type { ScoutDiagnostic, SourceInfo } from './protocol-core.ts';

export type ScoutPromptResourceScope = 'global' | 'temporary';
export type ScoutPromptSourceKind = 'global' | 'extension';
export type ScoutPromptStatus = 'active' | 'invalid' | 'shadowed';

export interface ScoutPromptListItem {
  name: string;
  command: string;
  description?: string;
  argumentHint?: string;
  path: string;
  scope: ScoutPromptResourceScope;
  sourceKind: ScoutPromptSourceKind;
  sourceRoot: string;
  sourceInfo: SourceInfo;
  status: ScoutPromptStatus;
}

export interface ScoutPromptsSettings {
  globalDir: string;
  diagnostics: ScoutDiagnostic[];
  prompts: ScoutPromptListItem[];
}
