// ============================================================
// Composer 工具模式 — 当前会话与新会话选择策略
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import { SCOUT_CUSTOM_TOOL_PROFILE_ID } from '@scout-agent/shared';
import type { ScoutToolProfileInfo } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { useDefaultToolProfileId, useToolProfiles } from '@/store/config-store';
import { useActiveToolSelection, useTools } from '@/store/session-store';
import type { ComposerMode } from '../model/composer-submit';
import { resolveNewSessionToolProfileId } from '../model/composer-tool-profile';

interface ComposerToolProfile {
  profileId: string;
  profiles: readonly ScoutToolProfileInfo[];
  submitProfileId?: string;
  selectProfile: (profileId: string) => void;
}

export function useComposerToolProfile(mode: ComposerMode): ComposerToolProfile {
  const [explicitNewSessionProfileId, setExplicitNewSessionProfileId] = useState<string>();
  const activeSelection = useActiveToolSelection();
  const defaultProfileId = useDefaultToolProfileId();
  const configuredProfiles = useToolProfiles();
  const tools = useTools();
  const currentProfileId =
    activeSelection?.kind === 'profile'
      ? activeSelection.profileId
      : activeSelection?.kind === 'custom'
        ? SCOUT_CUSTOM_TOOL_PROFILE_ID
        : defaultProfileId;
  const currentProfiles = useMemo(() => {
    const available = new Set(tools.map((tool) => tool.name));
    const profiles = configuredProfiles.map((profile) => ({
      ...profile,
      unavailableTools: profile.tools.filter((name) => !available.has(name)),
    }));
    if (activeSelection?.kind === 'custom') {
      profiles.push({
        id: SCOUT_CUSTOM_TOOL_PROFILE_ID,
        name: '自定义',
        tools: [...activeSelection.toolNames],
        builtin: false,
        unavailableTools: [],
      });
    }
    return profiles;
  }, [activeSelection, configuredProfiles, tools]);
  const resolvedNewSessionProfileId = resolveNewSessionToolProfileId(
    explicitNewSessionProfileId,
    defaultProfileId,
    configuredProfiles,
  );
  const selectCurrentSessionProfile = useCallback((profileId: string) => {
    protocolClient.setToolProfile(profileId);
  }, []);

  if (mode === 'currentSession') {
    return {
      profileId: currentProfileId,
      profiles: currentProfiles,
      selectProfile: selectCurrentSessionProfile,
    };
  }

  return {
    profileId: resolvedNewSessionProfileId ?? '',
    profiles: configuredProfiles,
    // 未显式选择时由 host 读取最新默认值，避免 home composer 把旧快照固化进请求。
    submitProfileId:
      explicitNewSessionProfileId === resolvedNewSessionProfileId
        ? explicitNewSessionProfileId
        : undefined,
    selectProfile: setExplicitNewSessionProfileId,
  };
}
