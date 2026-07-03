// ============================================================
// Display arguments projector — 工具参数展示投影
// 负责：把工具参数里的路径类字段投影为 host/core 统一 display path。
// ============================================================

import type { ToolPresentationMetadata } from '@scout-agent/shared';

// ---------- 类型 ----------

export type ToolPresentationMetadataResolver = (
  toolName: string,
) => ToolPresentationMetadata | undefined;

export interface DisplayArgumentsOptions {
  formatDisplayPath?: (path: string) => string;
  getToolPresentation?: ToolPresentationMetadataResolver;
}

export interface DisplayArgumentsContext {
  toolName?: string;
  pathArgumentKeys?: readonly string[];
}

// ---------- Projector ----------

export function createDisplayArguments(
  args: Record<string, unknown>,
  options: DisplayArgumentsOptions,
  context: DisplayArgumentsContext = {},
): Record<string, unknown> | undefined {
  if (!options.formatDisplayPath) return undefined;

  const pathArgumentKeys = resolvePathArgumentKeys(options, context);
  if (!pathArgumentKeys?.length) return undefined;

  let changed = false;
  const next = { ...args };
  for (const key of pathArgumentKeys) {
    const value = next[key];
    if (typeof value !== 'string') continue;
    const displayValue = options.formatDisplayPath(value);
    if (displayValue === value) continue;
    next[key] = displayValue;
    changed = true;
  }

  return changed ? next : undefined;
}

function resolvePathArgumentKeys(
  options: DisplayArgumentsOptions,
  context: DisplayArgumentsContext,
): readonly string[] | undefined {
  if (context.pathArgumentKeys) return context.pathArgumentKeys;
  if (context.toolName) {
    const pathArguments = options.getToolPresentation?.(context.toolName)?.pathArguments;
    if (pathArguments) return pathArguments;
  }
  return undefined;
}
