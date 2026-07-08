// ============================================================
// Resource path policy — 资源路径边界判断
// ============================================================

import * as path from 'node:path';
import type { ResolvedResource } from '../../../../core/package-manager.ts';

// ---------- Path guards ----------

export function isKnownResourcePath(
  filePath: string,
  resources: ResolvedResource[],
  knownRoots: string[],
): boolean {
  const resolvedPath = path.resolve(filePath);
  return (
    resources.some((resource) => path.resolve(resource.path) === resolvedPath) ||
    knownRoots.some((root) => isPathInside(resolvedPath, root))
  );
}

export function isPathInside(filePath: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export function findContainingRoot(filePath: string, roots: string[]): string | undefined {
  return roots
    .filter((root) => isPathInside(filePath, root))
    .sort((left, right) => path.resolve(right).length - path.resolve(left).length)[0];
}
