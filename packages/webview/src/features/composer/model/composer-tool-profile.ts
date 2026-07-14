// ============================================================
// Composer 工具模式 — 新会话可选项与选择解析
// ============================================================

import type { ScoutToolProfileInfo } from '@scout-agent/shared';

export function resolveNewSessionToolProfileId(
  explicitId: string | undefined,
  defaultId: string,
  profiles: readonly ScoutToolProfileInfo[],
): string | undefined {
  if (explicitId && profiles.some((profile) => profile.id === explicitId)) {
    return explicitId;
  }
  if (profiles.some((profile) => profile.id === defaultId)) {
    return defaultId;
  }
  return profiles[0]?.id;
}
