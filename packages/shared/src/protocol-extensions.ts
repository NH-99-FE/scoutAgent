// ============================================================
// Extension 管理协议契约
// ============================================================

export type ScoutExtensionScope = 'project' | 'global' | 'configured';
export type ScoutExtensionTemplateId = 'permission-gate';

export interface ScoutExtensionListItem {
  name: string;
  path: string;
  scope: ScoutExtensionScope;
  exists: boolean;
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
