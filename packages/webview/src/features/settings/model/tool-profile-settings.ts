// ============================================================
// Tool Profile Settings — Profile 列表与默认值协调
// ============================================================

import { SCOUT_BUILTIN_TOOL_PROFILE_IDS } from '@scout-agent/shared';
import type {
  ScoutCustomToolProfile,
  ScoutRuntimeSettingsPath,
  ScoutSettingsScope,
} from '@scout-agent/shared';
import type { EditableRuntimeSettings } from './runtime-settings-draft';

interface ReconcileToolProfileSettingsOptions {
  scope: ScoutSettingsScope;
  settings: Pick<EditableRuntimeSettings, 'defaultToolProfile' | 'toolProfiles'>;
  inheritedDefaultToolProfile?: string;
  inheritedToolProfiles: readonly ScoutCustomToolProfile[];
  profiles: ScoutCustomToolProfile[];
}

interface ReconciledToolProfileSettings {
  patch: Partial<EditableRuntimeSettings>;
  dirtyPaths: ScoutRuntimeSettingsPath[];
}

export function reconcileToolProfileSettings({
  scope,
  settings,
  inheritedDefaultToolProfile,
  inheritedToolProfiles,
  profiles,
}: ReconcileToolProfileSettingsOptions): ReconciledToolProfileSettings {
  const currentProfiles = settings.toolProfiles ?? inheritedToolProfiles;
  const currentDefault = settings.defaultToolProfile ?? inheritedDefaultToolProfile;
  const removedCurrentDefault =
    !!currentDefault &&
    currentProfiles.some((profile) => profile.id === currentDefault) &&
    !profiles.some((profile) => profile.id === currentDefault);
  const nextProfiles = profiles.length > 0 ? profiles : undefined;

  if (!removedCurrentDefault) {
    return {
      patch: { toolProfiles: nextProfiles },
      dirtyPaths: ['toolProfiles'],
    };
  }

  // 项目 profile 整体覆盖全局数组；继承默认值被遮蔽时需固定到内置默认值。
  const profilesAfterOverride = nextProfiles ?? inheritedToolProfiles;
  const inheritedDefaultIsValid =
    !inheritedDefaultToolProfile ||
    SCOUT_BUILTIN_TOOL_PROFILE_IDS.some((id) => id === inheritedDefaultToolProfile) ||
    profilesAfterOverride.some((profile) => profile.id === inheritedDefaultToolProfile);
  const nextDefault =
    scope === 'project' && !inheritedDefaultIsValid ? SCOUT_BUILTIN_TOOL_PROFILE_IDS[0] : undefined;

  return {
    patch: {
      toolProfiles: nextProfiles,
      defaultToolProfile: nextDefault,
    },
    dirtyPaths: ['toolProfiles', 'defaultToolProfile'],
  };
}
