// ============================================================
// 工具模式 — 内置 profile 与解析辅助
// ============================================================

import { SCOUT_BUILTIN_TOOL_PROFILE_IDS } from '@scout-agent/shared';
import type {
  ScoutActiveToolSelection,
  ScoutCustomToolProfile,
  ScoutToolProfileDefinition,
  ScoutToolProfileInfo,
} from '@scout-agent/shared';

// ---------- 类型 ----------

export interface ToolProfileDefinition extends ScoutToolProfileDefinition {
  // 是否自动纳入扩展工具属于 extension runtime 策略，不得泄漏到 shared/webview 协议。
  readonly includeExtensionTools: boolean;
}

export type ActiveToolSelection = ScoutActiveToolSelection;

// ---------- 常量 ----------

export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
export const DEVELOP_TOOL_PROFILE_ID = SCOUT_BUILTIN_TOOL_PROFILE_IDS[0];
export const REVIEW_TOOL_PROFILE_ID = SCOUT_BUILTIN_TOOL_PROFILE_IDS[1];
export const BUILTIN_TOOL_PROFILES: readonly ToolProfileDefinition[] = [
  {
    id: DEVELOP_TOOL_PROFILE_ID,
    name: '开发模式',
    tools: ['read', 'bash', 'edit', 'write'],
    includeExtensionTools: true,
  },
  {
    id: REVIEW_TOOL_PROFILE_ID,
    name: '审查模式',
    tools: ['read', 'grep', 'find', 'ls'],
    includeExtensionTools: false,
  },
];

export const DEFAULT_TOOL_PROFILE_ID = DEVELOP_TOOL_PROFILE_ID;

// ---------- 辅助 ----------

export function findBuiltinToolProfile(profileId: string): ToolProfileDefinition | undefined {
  return BUILTIN_TOOL_PROFILES.find((profile) => profile.id === profileId);
}

export function findToolProfile(
  profiles: readonly ToolProfileDefinition[],
  profileId: string,
): ToolProfileDefinition | undefined {
  return profiles.find((profile) => profile.id === profileId);
}

export function resolveDefaultToolProfileId(
  profiles: readonly ToolProfileDefinition[],
  configuredProfileId?: string,
): string {
  return (
    findToolProfile(profiles, configuredProfileId ?? DEFAULT_TOOL_PROFILE_ID)?.id ??
    DEFAULT_TOOL_PROFILE_ID
  );
}

export function getConfiguredToolProfiles(
  customProfiles: readonly ScoutCustomToolProfile[],
): readonly ToolProfileDefinition[] {
  return [
    ...BUILTIN_TOOL_PROFILES,
    ...customProfiles.map((profile) => ({ ...profile, includeExtensionTools: false })),
  ];
}

export function getToolProfileInfos(
  profiles: readonly ToolProfileDefinition[],
): ScoutToolProfileInfo[] {
  return profiles.map(({ includeExtensionTools: _includeExtensionTools, ...profile }) => ({
    ...profile,
    tools: [...profile.tools],
    builtin: findBuiltinToolProfile(profile.id) !== undefined,
  }));
}

export function resolveToolProfileNames(
  profile: ToolProfileDefinition,
  availableToolNames: ReadonlySet<string>,
  extensionToolNames: readonly string[],
): string[] {
  return [
    ...new Set([
      ...profile.tools.filter((name) => availableToolNames.has(name)),
      ...(profile.includeExtensionTools ? extensionToolNames : []),
    ]),
  ];
}
