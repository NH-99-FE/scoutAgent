// ============================================================
// Extension 管理协议契约
// ============================================================

import type { SourceInfo } from './protocol-core.ts';

export type ScoutExtensionScope = 'project' | 'global';
export type ScoutExtensionResourceScope = ScoutExtensionScope | 'temporary';
export type ScoutExtensionTemplateId = 'permission-gate';

export interface ScoutExtensionListItem {
  name: string;
  path: string;
  scope: ScoutExtensionResourceScope;
  sourceInfo: SourceInfo;
  exists: boolean;
  enabled: boolean;
}

export interface ScoutExtensionTemplateInfo {
  id: ScoutExtensionTemplateId;
  label: string;
  path: string;
  exists: boolean;
}

export interface ScoutExtensionsSettings {
  projectDir: string;
  globalDir: string;
  configuredPaths: string[];
  templates: ScoutExtensionTemplateInfo[];
  extensions: ScoutExtensionListItem[];
}
