// ============================================================
// Prompt Resource Catalog — 跨 Session 生命周期的权威 Prompt 快照
// ============================================================

import { join } from 'node:path';
import {
  loadPromptTemplates,
  type PromptTemplate,
  type PromptTemplateInput,
  type PromptTemplateResource,
} from './prompt-templates.ts';
import { createSourceInfo } from './source-info.ts';

export type PromptResourceDiagnostic =
  | { type: 'warning'; message: string; path: string }
  | {
      type: 'collision';
      message: string;
      path: string;
      collision: {
        resourceType: 'prompt';
        name: string;
        winnerPath: string;
        loserPath: string;
      };
    };

export interface PromptResourceSnapshot {
  resources: PromptTemplateResource[];
  activeTemplates: PromptTemplate[];
  diagnostics: PromptResourceDiagnostic[];
}

export class PromptResourceCatalog {
  private readonly globalInput: PromptTemplateInput;
  private extensionInputs: PromptTemplateInput[] = [];
  private snapshot: PromptResourceSnapshot;

  constructor(agentDir: string) {
    const globalDir = join(agentDir, 'prompts');
    this.globalInput = {
      path: globalDir,
      sourceInfo: createSourceInfo(globalDir, {
        source: 'auto',
        scope: 'user',
        origin: 'top-level',
        baseDir: agentDir,
      }),
    };
    this.snapshot = this.load();
  }

  replaceExtensionInputs(inputs: PromptTemplateInput[]): PromptResourceSnapshot {
    this.extensionInputs = inputs.map((input) => ({
      path: input.path,
      sourceInfo: { ...input.sourceInfo },
    }));
    this.snapshot = this.load();
    return this.getSnapshot();
  }

  refresh(): PromptResourceSnapshot {
    this.snapshot = this.load();
    return this.getSnapshot();
  }

  getSnapshot(): PromptResourceSnapshot {
    return {
      resources: this.snapshot.resources.map((resource) => ({
        sourceInfo: { ...resource.sourceInfo },
        template: resource.template
          ? { ...resource.template, sourceInfo: { ...resource.template.sourceInfo } }
          : undefined,
      })),
      activeTemplates: this.snapshot.activeTemplates.map((template) => ({
        ...template,
        sourceInfo: { ...template.sourceInfo },
      })),
      diagnostics: this.snapshot.diagnostics.map((diagnostic) =>
        diagnostic.type === 'collision'
          ? { ...diagnostic, collision: { ...diagnostic.collision } }
          : { ...diagnostic },
      ),
    };
  }

  private load(): PromptResourceSnapshot {
    const result = loadPromptTemplates([this.globalInput, ...this.extensionInputs]);
    const activeResult = dedupePromptTemplates(result.promptTemplates);
    const diagnostics: PromptResourceDiagnostic[] = result.diagnostics.map((diagnostic) => ({
      type: 'warning',
      message: `${diagnostic.path}: ${diagnostic.message}`,
      path: diagnostic.path,
    }));
    diagnostics.push(...activeResult.diagnostics);
    return {
      resources: result.resources,
      activeTemplates: activeResult.promptTemplates,
      diagnostics,
    };
  }
}

function dedupePromptTemplates(promptTemplates: PromptTemplate[]): {
  promptTemplates: PromptTemplate[];
  diagnostics: PromptResourceDiagnostic[];
} {
  const seen = new Map<string, PromptTemplate>();
  const diagnostics: PromptResourceDiagnostic[] = [];

  for (const promptTemplate of promptTemplates) {
    const existing = seen.get(promptTemplate.name);
    if (!existing) {
      seen.set(promptTemplate.name, promptTemplate);
      continue;
    }

    diagnostics.push({
      type: 'collision',
      message: `name "/${promptTemplate.name}" collision`,
      path: promptTemplate.sourceInfo.path,
      collision: {
        resourceType: 'prompt',
        name: promptTemplate.name,
        winnerPath: existing.sourceInfo.path,
        loserPath: promptTemplate.sourceInfo.path,
      },
    });
  }

  return { promptTemplates: [...seen.values()], diagnostics };
}
