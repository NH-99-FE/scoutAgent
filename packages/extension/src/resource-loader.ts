// ============================================================
// ResourceLoader — Scout 资源加载协调
// 负责：Skills / Prompt Templates 加载、扩展发现资源合并、诊断收集。
//       形状对齐 Pi ResourceLoader，先覆盖 Scout 已启用的资源类型。
// ============================================================

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PromptTemplate } from '@scout-agent/agent';
import { loadSourcedPromptTemplates } from '@scout-agent/agent';
import { NodeExecutionEnv } from '@scout-agent/agent/node';
import { loadSkills, type Skill as ScoutSkill } from './skill-loader.ts';
import { createSyntheticSourceInfo, type SourceInfo } from './source-info.ts';
import type { AgentSessionRuntimeDiagnostic } from './agent-session-runtime.ts';

// ---------- 类型 ----------

export type SourcedPromptTemplate = PromptTemplate & { sourceInfo?: SourceInfo };

export interface DiscoveredExtensionResources {
  skillPaths: Array<{ path: string; extensionPath: string }>;
  promptPaths: Array<{ path: string; extensionPath: string }>;
  themePaths: Array<{ path: string; extensionPath: string }>;
}

export type SourcedScoutSkill = ScoutSkill & { sourceInfo?: SourceInfo };

export interface ScoutContextFile {
  path: string;
  content: string;
}

export interface LoadedScoutResources {
  skills: SourcedScoutSkill[];
  promptTemplates: SourcedPromptTemplate[];
  contextFiles: ScoutContextFile[];
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

export interface ScoutResourceLoaderOptions {
  cwd: string;
  agentDir: string;
}

// ---------- 项目上下文 ----------

const CONTEXT_FILE_CANDIDATES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];

function loadContextFileFromDir(dir: string): ScoutContextFile | null {
  for (const filename of CONTEXT_FILE_CANDIDATES) {
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;

    try {
      return {
        path: filePath,
        content: readFileSync(filePath, 'utf-8'),
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function loadProjectContextFiles(options: {
  cwd: string;
  agentDir: string;
}): ScoutContextFile[] {
  const resolvedCwd = resolve(options.cwd);
  const resolvedAgentDir = resolve(options.agentDir);
  const contextFiles: ScoutContextFile[] = [];
  const seenPaths = new Set<string>();

  const globalContext = loadContextFileFromDir(resolvedAgentDir);
  if (globalContext) {
    contextFiles.push(globalContext);
    seenPaths.add(resolve(globalContext.path));
  }

  const ancestorContextFiles: ScoutContextFile[] = [];
  let currentDir = resolvedCwd;

  while (true) {
    const contextFile = loadContextFileFromDir(currentDir);
    if (contextFile) {
      const normalizedPath = resolve(contextFile.path);
      if (!seenPaths.has(normalizedPath)) {
        ancestorContextFiles.unshift(contextFile);
        seenPaths.add(normalizedPath);
      }
    }

    const parentDir = resolve(currentDir, '..');
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  contextFiles.push(...ancestorContextFiles);
  return contextFiles;
}

// ---------- ResourceLoader ----------

export class ScoutResourceLoader {
  private readonly cwd: string;
  private readonly agentDir: string;
  private discoveredResources: DiscoveredExtensionResources = ScoutResourceLoader.emptyDiscovered();

  constructor(options: ScoutResourceLoaderOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
  }

  static emptyDiscovered(): DiscoveredExtensionResources {
    return { skillPaths: [], promptPaths: [], themePaths: [] };
  }

  static hasDiscoveredResources(resources: DiscoveredExtensionResources): boolean {
    return (
      resources.skillPaths.length > 0 ||
      resources.promptPaths.length > 0 ||
      resources.themePaths.length > 0
    );
  }

  getDiscoveredResources(): DiscoveredExtensionResources {
    return {
      skillPaths: [...this.discoveredResources.skillPaths],
      promptPaths: [...this.discoveredResources.promptPaths],
      themePaths: [...this.discoveredResources.themePaths],
    };
  }

  setDiscoveredResources(resources: DiscoveredExtensionResources): void {
    this.discoveredResources = {
      skillPaths: [...resources.skillPaths],
      promptPaths: [...resources.promptPaths],
      themePaths: [...resources.themePaths],
    };
  }

  async load(): Promise<LoadedScoutResources> {
    return this.loadWithDiscoveredResources(this.discoveredResources);
  }

  async extendResources(resources: DiscoveredExtensionResources): Promise<LoadedScoutResources> {
    this.setDiscoveredResources({
      skillPaths: this.mergeResourcePaths(
        this.discoveredResources.skillPaths,
        resources.skillPaths,
      ),
      promptPaths: this.mergeResourcePaths(
        this.discoveredResources.promptPaths,
        resources.promptPaths,
      ),
      themePaths: this.mergeResourcePaths(
        this.discoveredResources.themePaths,
        resources.themePaths,
      ),
    });
    return this.load();
  }

  private async loadWithDiscoveredResources(
    discoveredResources: DiscoveredExtensionResources,
  ): Promise<LoadedScoutResources> {
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
    const { skills: loadedSkills, diagnostics: skillDiagnostics } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      customPaths: discoveredResources.skillPaths.map((entry) => entry.path),
    });
    const skills = loadedSkills.map((skill) => ({
      ...skill,
      sourceInfo: this.getSkillSourceInfo(skill, discoveredResources),
    }));
    for (const diag of skillDiagnostics) {
      diagnostics.push({
        type: diag.severity === 'error' ? 'error' : 'warning',
        message: `${diag.filePath}: ${diag.message}`,
      });
    }

    const promptResult = await loadSourcedPromptTemplates(
      new NodeExecutionEnv({ cwd: this.cwd }),
      this.buildPromptTemplateInputs(discoveredResources),
      (promptTemplate, sourceInfo): SourcedPromptTemplate => ({ ...promptTemplate, sourceInfo }),
    );
    const dedupedPromptResult = this.dedupePromptTemplates(
      promptResult.promptTemplates.map((entry) => entry.promptTemplate),
    );
    for (const diag of promptResult.diagnostics) {
      diagnostics.push({ type: 'warning', message: `${diag.path}: ${diag.message}` });
    }
    diagnostics.push(...dedupedPromptResult.diagnostics);

    return {
      skills,
      promptTemplates: dedupedPromptResult.promptTemplates,
      contextFiles: loadProjectContextFiles({ cwd: this.cwd, agentDir: this.agentDir }),
      diagnostics,
    };
  }

  private buildPromptTemplateInputs(
    discoveredResources: DiscoveredExtensionResources,
  ): Array<{ path: string; source: SourceInfo }> {
    return [
      {
        path: join(this.agentDir, 'prompts'),
        source: createSyntheticSourceInfo(join(this.agentDir, 'prompts'), {
          source: 'user',
          scope: 'user',
          baseDir: this.agentDir,
        }),
      },
      {
        path: join(this.cwd, '.scout', 'prompts'),
        source: createSyntheticSourceInfo(join(this.cwd, '.scout', 'prompts'), {
          source: 'project',
          scope: 'project',
          baseDir: this.cwd,
        }),
      },
      ...discoveredResources.promptPaths.map((entry) => ({
        path: entry.path,
        source: createSyntheticSourceInfo(entry.path, {
          source: 'extension',
          scope: 'temporary',
          baseDir: entry.extensionPath.replace(/[\\/][^\\/]*$/, ''),
        }),
      })),
    ];
  }

  private getSkillSourceInfo(
    skill: ScoutSkill,
    discoveredResources: DiscoveredExtensionResources,
  ): SourceInfo {
    const normalizedSkillPath = this.normalizePath(skill.filePath);
    const extensionSource = discoveredResources.skillPaths.find((entry) =>
      this.isPathAtOrUnder(normalizedSkillPath, this.normalizePath(entry.path)),
    );
    if (extensionSource) {
      return createSyntheticSourceInfo(skill.filePath, {
        source: 'extension',
        scope: 'temporary',
        baseDir: extensionSource.extensionPath.replace(/[\\/][^\\/]*$/, ''),
      });
    }

    const userSkillsRoot = this.normalizePath(join(this.agentDir, 'skills'));
    if (this.isPathAtOrUnder(normalizedSkillPath, userSkillsRoot)) {
      return createSyntheticSourceInfo(skill.filePath, {
        source: 'user',
        scope: 'user',
        baseDir: userSkillsRoot,
      });
    }

    const projectSkillsRoot = this.normalizePath(join(this.cwd, '.scout', 'skills'));
    if (this.isPathAtOrUnder(normalizedSkillPath, projectSkillsRoot)) {
      return createSyntheticSourceInfo(skill.filePath, {
        source: 'project',
        scope: 'project',
        baseDir: projectSkillsRoot,
      });
    }

    return createSyntheticSourceInfo(skill.filePath, {
      source: 'skill',
      baseDir: skill.baseDir,
    });
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private isPathAtOrUnder(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}/`);
  }

  private mergeResourcePaths<T extends { path: string }>(current: T[], incoming: T[]): T[] {
    const merged = [...current];
    const seen = new Set(current.map((entry) => entry.path));
    for (const entry of incoming) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      merged.push(entry);
    }
    return merged;
  }

  private dedupePromptTemplates(promptTemplates: SourcedPromptTemplate[]): {
    promptTemplates: SourcedPromptTemplate[];
    diagnostics: AgentSessionRuntimeDiagnostic[];
  } {
    const seen = new Map<string, SourcedPromptTemplate>();
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [];

    for (const promptTemplate of promptTemplates) {
      const existing = seen.get(promptTemplate.name);
      if (!existing) {
        seen.set(promptTemplate.name, promptTemplate);
        continue;
      }

      const winnerPath = existing.sourceInfo?.path ?? `<prompt:${existing.name}>`;
      const loserPath = promptTemplate.sourceInfo?.path ?? `<prompt:${promptTemplate.name}>`;
      diagnostics.push({
        type: 'collision',
        message: `name "/${promptTemplate.name}" collision`,
        path: loserPath,
        collision: {
          resourceType: 'prompt',
          name: promptTemplate.name,
          winnerPath,
          loserPath,
        },
      });
    }

    return { promptTemplates: [...seen.values()], diagnostics };
  }
}
