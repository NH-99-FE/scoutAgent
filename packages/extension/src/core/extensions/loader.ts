// ============================================================
// 扩展加载器 — 发现 + jiti 加载 + API 构建
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti/static';
import { createEventBus, type EventBus } from './event-bus.ts';
import { createSyntheticSourceInfo, type SourceInfo, type SourceOrigin } from '../source-info.ts';
import { STALE_EXTENSION_CONTEXT_MESSAGE } from './types.ts';
import type {
  ScoutExtension,
  ScoutExtensionAPI,
  ScoutExtensionFactory,
  ScoutExtensionRuntime,
  LoadExtensionsResult,
  ScoutHandlerFn,
  SendMessageInput,
} from './types.ts';

// ---------- Aliases ----------

const _require = createRequire(import.meta.url);

let _aliases: Record<string, string> | null = null;

function findWorkspacePackagesRoot(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const packagesRoot = path.join(current, 'packages');
    if (
      fs.existsSync(path.join(packagesRoot, 'agent/package.json')) &&
      fs.existsSync(path.join(packagesRoot, 'ai/package.json')) &&
      fs.existsSync(path.join(packagesRoot, 'shared/package.json'))
    ) {
      return packagesRoot;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 获取 jiti alias 映射，将 Scout 包名解析到实际文件路径。
 * 缓存以避免重复解析。
 */
function getAliases(): Record<string, string> {
  if (_aliases) return _aliases;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packagesRoot = findWorkspacePackagesRoot(__dirname);

  const resolveWorkspaceOrImport = (workspaceRelativePath: string, specifier: string): string => {
    if (packagesRoot) {
      const workspacePath = path.join(packagesRoot, workspaceRelativePath);
      if (fs.existsSync(workspacePath)) return workspacePath;
    }
    return fileURLToPath(new URL(import.meta.resolve(specifier)));
  };

  const agentEntry = resolveWorkspaceOrImport('agent/dist/index.js', '@scout-agent/agent');
  const aiEntry = resolveWorkspaceOrImport('ai/dist/index.js', '@scout-agent/ai');
  const sharedEntry = resolveWorkspaceOrImport('shared/dist/index.js', '@scout-agent/shared');
  const typeboxEntry = _require.resolve('@sinclair/typebox');

  _aliases = {
    '@scout-agent/agent': agentEntry,
    '@scout-agent/ai': aiEntry,
    '@scout-agent/shared': sharedEntry,
    '@sinclair/typebox': typeboxEntry,
    typebox: typeboxEntry,
  };

  return _aliases;
}

// ---------- Runtime 创建 ----------

/**
 * 创建带 throwing stub 的 runtime。
 * bindCore() 会替换为真实实现。
 */
export function createExtensionRuntime(): ScoutExtensionRuntime {
  const state: { staleMessage?: string } = {};

  const notInitialized = () => {
    throw new Error(
      'Extension runtime not initialized. Action methods cannot be called during extension loading.',
    );
  };

  const assertActive = () => {
    if (state.staleMessage) {
      throw new Error(state.staleMessage);
    }
  };

  const runtime: ScoutExtensionRuntime = {
    sendMessage: notInitialized,
    sendUserMessage: notInitialized,
    getActiveTools: notInitialized,
    getAllTools: notInitialized,
    setActiveTools: notInitialized,
    appendEntry: notInitialized,
    setSessionName: notInitialized,
    getSessionName: notInitialized,
    setLabel: notInitialized,
    getCommands: notInitialized,
    setModel: notInitialized,
    getThinkingLevel: notInitialized,
    setThinkingLevel: notInitialized,
    // registerTool() 在加载期间有效；refreshTools 仅需在 bind 后触发
    refreshTools: async () => {},
    assertActive,
    invalidate: (message) => {
      if (!state.staleMessage) {
        state.staleMessage = message ?? STALE_EXTENSION_CONTEXT_MESSAGE;
      }
    },
  };

  return runtime;
}

// ---------- API 创建 ----------

/**
 * 为单个扩展创建 ScoutExtensionAPI。
 * 注册方法写入扩展实例；动作方法委托共享 runtime。
 */
function createExtensionAPI(
  extension: ScoutExtension,
  runtime: ScoutExtensionRuntime,
  _eventBus: EventBus,
): ScoutExtensionAPI {
  const api: ScoutExtensionAPI = {
    on(event: string, handler: ScoutHandlerFn): void {
      runtime.assertActive();
      const list = extension.handlers.get(event) ?? [];
      list.push(handler);
      extension.handlers.set(event, list);
    },

    registerTool(tool): Promise<void> {
      runtime.assertActive();
      extension.tools.set(tool.name, {
        definition: tool,
        sourceInfo: extension.sourceInfo,
      });
      return runtime.refreshTools();
    },

    registerCommand(name, options): void {
      runtime.assertActive();
      extension.commands.set(name, {
        name,
        sourceInfo: extension.sourceInfo,
        ...options,
      });
    },

    sendMessage<TDetails = unknown>(
      message: SendMessageInput<TDetails>,
      options?: Parameters<ScoutExtensionRuntime['sendMessage']>[1],
    ): Promise<void> {
      runtime.assertActive();
      return runtime.sendMessage(message, options);
    },

    sendUserMessage(content, options): Promise<void> {
      runtime.assertActive();
      return runtime.sendUserMessage(content, options);
    },

    setActiveTools(toolNames: string[]): Promise<void> {
      runtime.assertActive();
      return runtime.setActiveTools(toolNames);
    },

    getActiveTools(): string[] {
      runtime.assertActive();
      return runtime.getActiveTools();
    },

    getAllTools() {
      runtime.assertActive();
      return runtime.getAllTools();
    },

    appendEntry(customType, data): Promise<void> {
      runtime.assertActive();
      return runtime.appendEntry(customType, data);
    },

    setSessionName(name: string): Promise<void> {
      runtime.assertActive();
      return runtime.setSessionName(name);
    },

    getSessionName(): Promise<string | undefined> {
      runtime.assertActive();
      return runtime.getSessionName();
    },

    setLabel(entryId: string, label: string | undefined): Promise<void> {
      runtime.assertActive();
      return runtime.setLabel(entryId, label);
    },

    getCommands() {
      runtime.assertActive();
      return runtime.getCommands();
    },

    setModel(modelId: string): Promise<void> {
      runtime.assertActive();
      return runtime.setModel(modelId);
    },

    getThinkingLevel() {
      runtime.assertActive();
      return runtime.getThinkingLevel();
    },

    setThinkingLevel(level): Promise<void> {
      runtime.assertActive();
      return runtime.setThinkingLevel(level);
    },

    events: _eventBus,
  };

  return api;
}

// ---------- 扩展加载 ----------

/** jiti 加载单个扩展模块 */
async function loadExtensionModule(
  extensionPath: string,
): Promise<ScoutExtensionFactory | undefined> {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: getAliases(),
  });

  const module = await jiti.import(extensionPath, { default: true });
  const factory = module as ScoutExtensionFactory;
  return typeof factory !== 'function' ? undefined : factory;
}

function createExtensionSourceInfo(
  extensionPath: string,
  resolvedPath: string,
  sourceInfo?: SourceInfo,
): SourceInfo {
  if (sourceInfo) return sourceInfo;
  if (extensionPath.startsWith('<') && extensionPath.endsWith('>')) {
    const source = extensionPath.slice(1, -1).split(':')[0] || 'temporary';
    return createSyntheticSourceInfo(extensionPath, { source });
  }
  return createSyntheticSourceInfo(extensionPath, {
    source: 'local',
    baseDir: path.dirname(resolvedPath),
  });
}

/** 创建空扩展实例 */
function createExtension(
  extensionPath: string,
  resolvedPath: string,
  sourceInfo?: SourceInfo,
): ScoutExtension {
  return {
    path: extensionPath,
    resolvedPath,
    sourceInfo: createExtensionSourceInfo(extensionPath, resolvedPath, sourceInfo),
    handlers: new Map(),
    tools: new Map(),
    commands: new Map(),
  };
}

/** 加载单个扩展 */
async function loadExtension(
  extensionPath: string,
  runtime: ScoutExtensionRuntime,
  eventBus: EventBus,
  sourceInfo?: SourceInfo,
): Promise<{ extension: ScoutExtension | null; error: string | null }> {
  const resolvedPath = path.resolve(extensionPath);

  try {
    const factory = await loadExtensionModule(resolvedPath);
    if (!factory) {
      return {
        extension: null,
        error: `Extension does not export a valid factory function: ${extensionPath}`,
      };
    }

    const extension = createExtension(extensionPath, resolvedPath, sourceInfo);
    const api = createExtensionAPI(extension, runtime, eventBus);
    await factory(api);

    return { extension, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { extension: null, error: `Failed to load extension: ${message}` };
  }
}

/** 从内联工厂函数创建扩展（测试用） */
export async function loadExtensionFromFactory(
  factory: ScoutExtensionFactory,
  runtime: ScoutExtensionRuntime,
  eventBus?: EventBus,
  extensionPath = '<inline>',
): Promise<ScoutExtension> {
  const extension = createExtension(extensionPath, extensionPath);
  const resolvedEventBus = eventBus ?? createEventBus();
  const api = createExtensionAPI(extension, runtime, resolvedEventBus);
  await factory(api);
  return extension;
}

/** 从路径列表加载所有扩展 */
export async function loadExtensions(
  paths: string[],
  eventBus?: EventBus,
  sourceInfos?: Map<string, SourceInfo>,
): Promise<LoadExtensionsResult> {
  const extensions: ScoutExtension[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const resolvedEventBus = eventBus ?? createEventBus();
  const runtime = createExtensionRuntime();

  for (const extPath of paths) {
    const resolved = path.resolve(extPath);
    const { extension, error } = await loadExtension(
      extPath,
      runtime,
      resolvedEventBus,
      sourceInfos?.get(resolved),
    );

    if (error) {
      errors.push({ path: extPath, error });
      continue;
    }

    if (extension) {
      extensions.push(extension);
    }
  }

  return {
    extensions,
    errors,
    runtime,
  };
}

// ---------- 扩展发现 ----------

/** Scout manifest 结构 */
interface ScoutManifest {
  extensions?: string[];
}

export interface DiscoveredExtensionEntry {
  path: string;
  origin: SourceOrigin;
  baseDir: string;
}

function isExtensionFile(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.js');
}

function readScoutManifest(packageJsonPath: string): ScoutManifest | null {
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.scout && typeof pkg.scout === 'object') {
      return pkg.scout as ScoutManifest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从目录解析扩展入口。
 * 1. package.json 中的 "scout.extensions" 字段
 * 2. index.ts 或 index.js
 */
export function resolveExtensionEntries(dir: string): DiscoveredExtensionEntry[] | null {
  const packageJsonPath = path.join(dir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const manifest = readScoutManifest(packageJsonPath);
    if (manifest?.extensions?.length) {
      const entries: DiscoveredExtensionEntry[] = [];
      for (const extPath of manifest.extensions) {
        const resolvedExtPath = path.resolve(dir, extPath);
        if (fs.existsSync(resolvedExtPath)) {
          entries.push({
            path: resolvedExtPath,
            origin: 'package',
            baseDir: dir,
          });
        }
      }
      if (entries.length > 0) {
        return entries;
      }
    }
  }

  const indexTs = path.join(dir, 'index.ts');
  const indexJs = path.join(dir, 'index.js');
  if (fs.existsSync(indexTs)) {
    return [{ path: indexTs, origin: 'top-level', baseDir: dir }];
  }
  if (fs.existsSync(indexJs)) {
    return [{ path: indexJs, origin: 'top-level', baseDir: dir }];
  }

  return null;
}

/**
 * 在目录中发现扩展。
 *
 * 发现规则:
 * 1. 直接文件: .ts 或 .js 后缀的文件
 * 2. 子目录含 index: 子目录下的 index.ts 或 index.js
 * 3. 子目录含 package.json: scout 字段声明的路径
 *
 * 不递归超过一层。
 */
export function discoverExtensionsInDir(dir: string): DiscoveredExtensionEntry[] {
  if (!fs.existsSync(dir)) return [];

  const discovered: DiscoveredExtensionEntry[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      // 直接文件
      if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
        discovered.push({
          path: entryPath,
          origin: 'top-level',
          baseDir: dir,
        });
        continue;
      }

      // 子目录
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const subEntries = resolveExtensionEntries(entryPath);
        if (subEntries) {
          discovered.push(...subEntries);
        }
      }
    }
  } catch {
    return [];
  }

  return discovered;
}

/**
 * 从标准位置发现并加载扩展。
 *
 * 发现路径：
 * 1. 项目本地：{cwd}/.scout/extensions/
 * 2. 全局：{agentDir}/extensions/
 * 3. 显式配置路径
 */
export async function discoverAndLoadExtensions(
  configuredPaths: string[],
  cwd: string,
  agentDir: string,
  eventBus?: EventBus,
): Promise<LoadExtensionsResult> {
  const allPaths: string[] = [];
  const seen = new Set<string>();
  const sourceInfos = new Map<string, SourceInfo>();

  const addEntries = (
    entries: DiscoveredExtensionEntry[],
    sourceInfoForEntry?: (entry: DiscoveredExtensionEntry) => SourceInfo,
  ) => {
    for (const entry of entries) {
      const resolved = path.resolve(entry.path);
      if (seen.has(resolved)) {
        continue;
      }

      seen.add(resolved);
      allPaths.push(entry.path);
      if (sourceInfoForEntry) {
        sourceInfos.set(resolved, sourceInfoForEntry({ ...entry, path: resolved }));
      }
    }
  };

  // 1. 项目本地扩展
  const localExtDir = path.join(cwd, '.scout', 'extensions');
  addEntries(discoverExtensionsInDir(localExtDir), (entry) =>
    createSyntheticSourceInfo(entry.path, {
      source: 'local',
      scope: 'project',
      origin: entry.origin,
      baseDir: entry.baseDir,
    }),
  );

  // 2. 全局扩展
  const globalExtDir = path.join(agentDir, 'extensions');
  addEntries(discoverExtensionsInDir(globalExtDir), (entry) =>
    createSyntheticSourceInfo(entry.path, {
      source: 'local',
      scope: 'user',
      origin: entry.origin,
      baseDir: entry.baseDir,
    }),
  );

  // 3. 显式配置路径
  for (const p of configuredPaths) {
    const resolved = path.resolve(p);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      const entries = resolveExtensionEntries(resolved);
      if (entries) {
        addEntries(entries, (entry) =>
          createSyntheticSourceInfo(entry.path, {
            source: 'local',
            origin: entry.origin,
            baseDir: entry.baseDir,
          }),
        );
        continue;
      }
      addEntries(discoverExtensionsInDir(resolved), (entry) =>
        createSyntheticSourceInfo(entry.path, {
          source: 'local',
          origin: entry.origin,
          baseDir: entry.baseDir,
        }),
      );
      continue;
    }

    addEntries(
      [
        {
          path: resolved,
          origin: 'top-level',
          baseDir: path.dirname(resolved),
        },
      ],
      (entry) =>
        createSyntheticSourceInfo(entry.path, {
          source: 'local',
          origin: entry.origin,
          baseDir: entry.baseDir,
        }),
    );
  }

  return loadExtensions(allPaths, eventBus, sourceInfos);
}
