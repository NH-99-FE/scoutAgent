// ============================================================
// ResourceLoader — Scout 资源加载协调
// 负责：解析加载 Skills / Prompt Templates / 上下文文件。
// ============================================================

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { PromptTemplate } from '@scout-agent/agent';
import { loadSourcedPromptTemplates } from '@scout-agent/agent';
import { NodeExecutionEnv } from '@scout-agent/agent/node';
import { loadSkills, type ResourceDiagnostic, type Skill as ScoutSkill } from './skills.ts';
import {
  createExtensionRuntime,
  loadExtensions,
  type LoadExtensionsResult,
} from './extensions/index.ts';
import {
  ScoutPackageManager,
  type PathMetadata,
  type ResolvedResource,
  type ScoutResourceSettingsSnapshot,
} from './package-manager.ts';
import { createSourceInfo, createSyntheticSourceInfo, type SourceInfo } from './source-info.ts';
import type { AgentSessionRuntimeDiagnostic } from './agent-session-runtime.ts';

// ---------- 类型 ----------

export type SourcedPromptTemplate = PromptTemplate & { sourceInfo?: SourceInfo };

export interface DiscoveredExtensionResources {
  skillPaths: Array<{ path: string; extensionPath: string }>;
  promptPaths: Array<{ path: string; extensionPath: string }>;
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
  systemPrompt?: string;
  appendSystemPrompt: string[];
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

export interface ScoutResourceLoaderOptions {
  cwd: string;
  agentDir: string;
  resourceSettings?: ScoutResourceSettingsSnapshot;
  systemPrompt?: string;
  appendSystemPrompt?: string[];
}

interface ResolvedResourceState {
  skillPaths: string[];
  promptInputs: Array<{ path: string; source: SourceInfo }>;
  metadataByPath: Map<string, PathMetadata>;
}

// ---------- 项目上下文 ----------

const CONTEXT_FILE_CANDIDATES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];

function resolvePromptInput(input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (!existsSync(input)) return input;

  try {
    return readFileSync(input, 'utf-8');
  } catch {
    return input;
  }
}

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
  private readonly resourceSettings: ScoutResourceSettingsSnapshot;
  private readonly packageManager: ScoutPackageManager;
  private readonly systemPromptSource?: string;
  private readonly appendSystemPromptSource?: string[];
  private discoveredResources: DiscoveredExtensionResources = ScoutResourceLoader.emptyDiscovered();
  private baseResolvedResources: ResolvedResourceState | undefined;
  private extensionsResult: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };

  constructor(options: ScoutResourceLoaderOptions) {
    this.cwd = resolve(options.cwd);
    this.agentDir = resolve(options.agentDir);
    this.resourceSettings = options.resourceSettings ?? { global: {}, project: {} };
    this.packageManager = new ScoutPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      resourceSettings: this.resourceSettings,
    });
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = options.appendSystemPrompt;
  }

  static emptyDiscovered(): DiscoveredExtensionResources {
    return { skillPaths: [], promptPaths: [] };
  }

  static hasDiscoveredResources(resources: DiscoveredExtensionResources): boolean {
    return resources.skillPaths.length > 0 || resources.promptPaths.length > 0;
  }

  getDiscoveredResources(): DiscoveredExtensionResources {
    return {
      skillPaths: [...this.discoveredResources.skillPaths],
      promptPaths: [...this.discoveredResources.promptPaths],
    };
  }

  setDiscoveredResources(resources: DiscoveredExtensionResources): void {
    this.discoveredResources = {
      skillPaths: [...resources.skillPaths],
      promptPaths: [...resources.promptPaths],
    };
  }

  getExtensions(): LoadExtensionsResult {
    return this.extensionsResult;
  }

  async load(): Promise<LoadedScoutResources> {
    this.baseResolvedResources = await this.resolveBaseResources();
    return this.loadWithResolvedResources(this.baseResolvedResources, this.discoveredResources);
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
    });
    const baseResolved = await this.getBaseResolvedResources();
    return this.loadWithResolvedResources(baseResolved, this.discoveredResources);
  }

  async replaceExtensionResources(
    resources: DiscoveredExtensionResources,
  ): Promise<LoadedScoutResources> {
    this.setDiscoveredResources(resources);
    const baseResolved = await this.getBaseResolvedResources();
    return this.loadWithResolvedResources(baseResolved, this.discoveredResources);
  }

  private async loadWithResolvedResources(
    baseResolved: ResolvedResourceState,
    discoveredResources: DiscoveredExtensionResources,
  ): Promise<LoadedScoutResources> {
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
    const resolved = this.extendResolvedResources(baseResolved, discoveredResources);

    const skillResult = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: resolved.skillPaths,
      includeDefaults: false,
    });
    for (const diag of skillResult.diagnostics) {
      diagnostics.push(this.toRuntimeDiagnostic(diag));
    }
    const skills = skillResult.skills.map((skill) => ({
      ...skill,
      sourceInfo:
        this.findSourceInfoForPath(skill.filePath, resolved.metadataByPath) ??
        skill.sourceInfo ??
        this.getDefaultSourceInfoForPath(skill.filePath),
    }));

    const promptResult = await loadSourcedPromptTemplates(
      new NodeExecutionEnv({ cwd: this.cwd }),
      resolved.promptInputs,
      (promptTemplate, sourceInfo): SourcedPromptTemplate => ({ ...promptTemplate, sourceInfo }),
    );
    const dedupedPromptResult = this.dedupePromptTemplates(
      promptResult.promptTemplates.map((entry) => entry.promptTemplate),
    );
    for (const diag of promptResult.diagnostics) {
      diagnostics.push({
        type: 'warning',
        message: `${diag.path}: ${diag.message}`,
        path: diag.path,
      });
    }
    diagnostics.push(...dedupedPromptResult.diagnostics);

    return {
      skills,
      promptTemplates: dedupedPromptResult.promptTemplates,
      contextFiles: loadProjectContextFiles({ cwd: this.cwd, agentDir: this.agentDir }),
      systemPrompt: resolvePromptInput(this.systemPromptSource ?? this.discoverSystemPromptFile()),
      appendSystemPrompt: this.resolveAppendSystemPrompt(),
      diagnostics,
    };
  }

  private async getBaseResolvedResources(): Promise<ResolvedResourceState> {
    if (!this.baseResolvedResources) {
      this.baseResolvedResources = await this.resolveBaseResources();
    }
    return this.baseResolvedResources;
  }

  private async resolveBaseResources(): Promise<ResolvedResourceState> {
    const resolvedPaths = this.packageManager.resolve();
    const metadataByPath = new Map<string, PathMetadata>();
    const recordMetadata = (resources: ResolvedResource[]) => {
      for (const resource of resources) {
        if (!metadataByPath.has(resolve(resource.path))) {
          metadataByPath.set(resolve(resource.path), resource.metadata);
        }
      }
    };

    recordMetadata(resolvedPaths.extensions);
    recordMetadata(resolvedPaths.skills);
    recordMetadata(resolvedPaths.prompts);

    const extensionSourceInfos = new Map<string, SourceInfo>();
    const extensionPaths = resolvedPaths.extensions
      .filter((resource) => resource.enabled)
      .map((resource) => {
        const resolvedPath = resolve(resource.path);
        extensionSourceInfos.set(
          resolvedPath,
          createSourceInfo(resolvedPath, {
            ...resource.metadata,
            baseDir: resource.metadata.baseDir ?? dirname(resolvedPath),
          }),
        );
        return resolvedPath;
      });
    this.extensionsResult = await loadExtensions(extensionPaths, undefined, extensionSourceInfos);

    return {
      skillPaths: resolvedPaths.skills
        .filter((resource) => resource.enabled)
        .map((resource) => resource.path),
      promptInputs: resolvedPaths.prompts
        .filter((resource) => resource.enabled)
        .map((resource) => ({
          path: resource.path,
          source: createSourceInfo(resource.path, resource.metadata),
        })),
      metadataByPath,
    };
  }

  private extendResolvedResources(
    baseResolved: ResolvedResourceState,
    discoveredResources: DiscoveredExtensionResources,
  ): ResolvedResourceState {
    const metadataByPath = new Map(baseResolved.metadataByPath);
    const extensionSkillResources = discoveredResources.skillPaths.map(
      (entry): ResolvedResource => {
        const path = resolve(this.cwd, entry.path);
        const metadata: PathMetadata = {
          source: 'extension',
          scope: 'temporary',
          origin: 'top-level',
          baseDir: entry.extensionPath.replace(/[\\/][^\\/]*$/, ''),
        };
        metadataByPath.set(path, metadata);
        return { path, enabled: true, metadata };
      },
    );

    const extensionPromptInputs = discoveredResources.promptPaths.map((entry) => {
      const path = resolve(this.cwd, entry.path);
      const metadata: PathMetadata = {
        source: 'extension',
        scope: 'temporary',
        origin: 'top-level',
        baseDir: entry.extensionPath.replace(/[\\/][^\\/]*$/, ''),
      };
      metadataByPath.set(path, metadata);
      return {
        path,
        source: createSourceInfo(path, metadata),
      };
    });

    return {
      skillPaths: [
        ...baseResolved.skillPaths,
        ...extensionSkillResources.map((resource) => resource.path),
      ],
      promptInputs: [...baseResolved.promptInputs, ...extensionPromptInputs],
      metadataByPath,
    };
  }

  private resolveAppendSystemPrompt(): string[] {
    const discoveredAppendPrompt = this.discoverAppendSystemPromptFile();
    const sources =
      this.appendSystemPromptSource ?? (discoveredAppendPrompt ? [discoveredAppendPrompt] : []);
    return sources
      .map((source) => resolvePromptInput(source))
      .filter((source): source is string => source !== undefined);
  }

  private discoverSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, '.scout', 'SYSTEM.md');
    if (existsSync(projectPath)) return projectPath;

    const globalPath = join(this.agentDir, 'SYSTEM.md');
    if (existsSync(globalPath)) return globalPath;

    return undefined;
  }

  private discoverAppendSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, '.scout', 'APPEND_SYSTEM.md');
    if (existsSync(projectPath)) return projectPath;

    const globalPath = join(this.agentDir, 'APPEND_SYSTEM.md');
    if (existsSync(globalPath)) return globalPath;

    return undefined;
  }

  private toRuntimeDiagnostic(diagnostic: ResourceDiagnostic): AgentSessionRuntimeDiagnostic {
    if (diagnostic.type === 'collision') {
      return {
        type: 'collision',
        message: diagnostic.message,
        path: diagnostic.path,
        collision: diagnostic.collision,
      };
    }
    return {
      type: diagnostic.type === 'error' ? 'error' : 'warning',
      message: diagnostic.path ? `${diagnostic.path}: ${diagnostic.message}` : diagnostic.message,
      path: diagnostic.path,
    };
  }

  private findSourceInfoForPath(
    resourcePath: string,
    metadataByPath: Map<string, PathMetadata>,
  ): SourceInfo | undefined {
    if (!resourcePath) return undefined;
    if (resourcePath.startsWith('<')) return this.getDefaultSourceInfoForPath(resourcePath);

    const normalizedResourcePath = resolve(resourcePath);
    const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
    if (exact) return createSourceInfo(resourcePath, exact);

    for (const [sourcePath, metadata] of metadataByPath.entries()) {
      const normalizedSourcePath = resolve(sourcePath);
      if (
        normalizedResourcePath === normalizedSourcePath ||
        normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
      ) {
        return createSourceInfo(resourcePath, metadata);
      }
    }
    return undefined;
  }

  private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
    if (filePath.startsWith('<') && filePath.endsWith('>')) {
      return {
        path: filePath,
        source: filePath.slice(1, -1).split(':')[0] || 'temporary',
        scope: 'temporary',
        origin: 'top-level',
      };
    }

    const normalizedPath = resolve(filePath);
    const agentRoots = [join(this.agentDir, 'skills'), join(this.agentDir, 'prompts')];
    const projectRoots = [join(this.cwd, '.scout', 'skills'), join(this.cwd, '.scout', 'prompts')];

    for (const root of agentRoots) {
      if (this.isUnderPath(normalizedPath, root)) {
        return {
          path: filePath,
          source: 'local',
          scope: 'user',
          origin: 'top-level',
          baseDir: root,
        };
      }
    }

    for (const root of projectRoots) {
      if (this.isUnderPath(normalizedPath, root)) {
        return {
          path: filePath,
          source: 'local',
          scope: 'project',
          origin: 'top-level',
          baseDir: root,
        };
      }
    }

    return createSyntheticSourceInfo(filePath, {
      source: 'local',
      baseDir: this.defaultBaseDir(filePath),
    });
  }

  private defaultBaseDir(filePath: string): string {
    try {
      const normalizedPath = resolve(filePath);
      return statSync(normalizedPath).isDirectory()
        ? normalizedPath
        : normalizedPath.replace(/[\\/][^\\/]*$/, '');
    } catch {
      return filePath.replace(/[\\/][^\\/]*$/, '');
    }
  }

  private isUnderPath(target: string, root: string): boolean {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) return true;
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  }

  private mergeResourcePaths<T extends { path: string }>(current: T[], incoming: T[]): T[] {
    const merged = [...current];
    const seen = new Set(current.map((entry) => resolve(this.cwd, entry.path)));
    for (const entry of incoming) {
      const resolvedPath = resolve(this.cwd, entry.path);
      if (seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);
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
