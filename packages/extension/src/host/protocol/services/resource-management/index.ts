// ============================================================
// Resource management — Settings 资源管理通用出口
// ============================================================

export {
  dedupeConfiguredResourcePathEntries,
  dedupePaths,
  getMissingConfiguredResourceEntries,
  normalizeResourceEntries,
  resolveConfiguredResourcePathEntries,
  resolveConfiguredResourcePaths,
  resolveConfiguredResourceSourceRoots,
} from './configured-resource-paths.ts';
export type { ConfiguredResourcePathEntry } from './configured-resource-paths.ts';
export { findContainingRoot, isKnownResourcePath, isPathInside } from './resource-path-policy.ts';
export { ResourcePersistCoordinator } from './resource-persist-coordinator.ts';
export type {
  ResourcePersistCallbacks,
  ResourceReloadMessages,
  ResourceReloadResult,
} from './resource-persist-coordinator.ts';
