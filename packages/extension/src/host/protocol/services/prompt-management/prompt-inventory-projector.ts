// ============================================================
// Prompt inventory projector — 权威资源快照的 Settings 投影
// ============================================================

import * as path from 'node:path';
import type {
  ScoutDiagnostic,
  ScoutPromptListItem,
  ScoutPromptResourceScope,
  ScoutPromptsSettings,
} from '@scout-agent/shared';
import type {
  PromptResourceSnapshot,
  PromptResourceDiagnostic,
} from '../../../../core/prompt-resource-catalog.ts';
import type { PromptTemplateResource } from '../../../../core/prompt-templates.ts';

export class PromptInventoryProjector {
  private readonly globalDir: string;
  private readonly getSnapshot: () => PromptResourceSnapshot;

  constructor(globalDir: string, getSnapshot: () => PromptResourceSnapshot) {
    this.globalDir = globalDir;
    this.getSnapshot = getSnapshot;
  }

  async getSettings(): Promise<ScoutPromptsSettings> {
    const snapshot = this.getSnapshot();
    const activePathByName = new Map(
      snapshot.activeTemplates.map((template) => [template.name, path.resolve(template.filePath)]),
    );
    const prompts = snapshot.resources
      .map((resource) => toListItem(resource, activePathByName))
      .sort(comparePromptItems);

    return {
      globalDir: this.globalDir,
      diagnostics: snapshot.diagnostics.map(toScoutDiagnostic),
      prompts,
    };
  }
}

function toListItem(
  resource: PromptTemplateResource,
  activePathByName: Map<string, string>,
): ScoutPromptListItem {
  const template = resource.template;
  const name = template?.name ?? path.basename(resource.sourceInfo.path, '.md');
  const isExtension = resource.sourceInfo.source === 'extension';
  return {
    name,
    command: `/${name}`,
    description: template?.description,
    argumentHint: template?.argumentHint,
    path: resource.sourceInfo.path,
    scope: isExtension ? 'temporary' : 'global',
    sourceKind: isExtension ? 'extension' : 'global',
    sourceRoot: isExtension
      ? (resource.sourceInfo.baseDir ?? path.dirname(resource.sourceInfo.path))
      : path.dirname(resource.sourceInfo.path),
    sourceInfo: resource.sourceInfo,
    status: !template
      ? 'invalid'
      : activePathByName.get(name) === path.resolve(resource.sourceInfo.path)
        ? 'active'
        : 'shadowed',
  };
}

function toScoutDiagnostic(diagnostic: PromptResourceDiagnostic): ScoutDiagnostic {
  return diagnostic.type === 'collision'
    ? { ...diagnostic, collision: { ...diagnostic.collision } }
    : { ...diagnostic };
}

function comparePromptItems(a: ScoutPromptListItem, b: ScoutPromptListItem): number {
  const scopeOrder: Record<ScoutPromptResourceScope, number> = { global: 0, temporary: 1 };
  return (
    scopeOrder[a.scope] - scopeOrder[b.scope] ||
    a.name.localeCompare(b.name) ||
    a.path.localeCompare(b.path)
  );
}
