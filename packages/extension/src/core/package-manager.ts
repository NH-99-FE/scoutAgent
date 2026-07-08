// ============================================================
// PackageManager
// 负责：解析 packages/settings/自动发现/manifest 资源路径与优先级。
// ============================================================

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { globSync } from 'glob';
import ignore from 'ignore';
import { minimatch } from 'minimatch';
import type { SourceScope } from './source-info.ts';
import { discoverExtensionsInDir, resolveExtensionEntries } from './extensions/loader.ts';

// ---------- 类型 ----------

export interface PathMetadata {
  source: string;
  scope: SourceScope;
  origin: 'package' | 'top-level';
  baseDir?: string;
}

export interface ResolvedResource {
  path: string;
  enabled: boolean;
  metadata: PathMetadata;
}

export interface ResolvedPaths {
  extensions: ResolvedResource[];
  skills: ResolvedResource[];
  prompts: ResolvedResource[];
}

export type ScoutPackageSource =
  | string
  | {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
    };

export interface ScoutResourceSettings {
  packages?: ScoutPackageSource[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
}

export interface ScoutResourceSettingsSnapshot {
  global: ScoutResourceSettings;
  project: ScoutResourceSettings;
}

interface ScoutManifest {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
}

interface ResourceAccumulator {
  extensions: Map<string, { metadata: PathMetadata; enabled: boolean }>;
  skills: Map<string, { metadata: PathMetadata; enabled: boolean }>;
  prompts: Map<string, { metadata: PathMetadata; enabled: boolean }>;
}

type ResourceType = 'extensions' | 'skills' | 'prompts';
type SkillDiscoveryMode = 'scout' | 'agents';

const RESOURCE_TYPES: ResourceType[] = ['extensions', 'skills', 'prompts'];
const IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore'];

type IgnoreMatcher = ReturnType<typeof ignore>;

// ---------- 路径/模式 ----------

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function resolvePath(input: string, baseDir: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('~/') || trimmed === '~') {
    return resolve(getHomeDir(), trimmed.slice(2));
  }
  if (trimmed.startsWith('/')) return resolve(trimmed);
  return resolve(baseDir, trimmed);
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }
  if (pattern.startsWith('/')) pattern = pattern.slice(1);

  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : '';

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename);
    if (!existsSync(ignorePath)) continue;
    try {
      const patterns = readFileSync(ignorePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => prefixIgnorePattern(line, prefix))
        .filter((line): line is string => Boolean(line));
      if (patterns.length > 0) ig.add(patterns);
    } catch {
      // Ignore unreadable ignore files.
    }
  }
}

function isPattern(value: string): boolean {
  return (
    value.startsWith('!') ||
    value.startsWith('+') ||
    value.startsWith('-') ||
    value.includes('*') ||
    value.includes('?')
  );
}

function isOverridePattern(value: string): boolean {
  return value.startsWith('!') || value.startsWith('+') || value.startsWith('-');
}

function hasGlobPattern(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

function splitPatterns(entries: string[]): { plain: string[]; patterns: string[] } {
  const plain: string[] = [];
  const patterns: string[] = [];
  for (const entry of entries) {
    if (isPattern(entry)) patterns.push(entry);
    else plain.push(entry);
  }
  return { plain, patterns };
}

function matchesAnyPattern(filePath: string, patterns: string[], baseDir: string): boolean {
  const rel = toPosixPath(relative(baseDir, filePath));
  const name = basename(filePath);
  const filePathPosix = toPosixPath(filePath);
  const isSkillFile = name === 'SKILL.md';
  const parentDir = isSkillFile ? dirname(filePath) : undefined;
  const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir!)) : undefined;
  const parentName = isSkillFile ? basename(parentDir!) : undefined;
  const parentDirPosix = isSkillFile ? toPosixPath(parentDir!) : undefined;

  return patterns.some((pattern) => {
    const normalized = normalizeExactPattern(pattern);
    if (
      minimatch(rel, normalized) ||
      minimatch(name, normalized) ||
      minimatch(filePathPosix, normalized)
    ) {
      return true;
    }
    if (!isSkillFile) return false;
    return (
      minimatch(parentRel!, normalized) ||
      minimatch(parentName!, normalized) ||
      minimatch(parentDirPosix!, normalized)
    );
  });
}

function normalizeExactPattern(pattern: string): string {
  const normalized =
    pattern.startsWith('./') || pattern.startsWith('.\\') ? pattern.slice(2) : pattern;
  return toPosixPath(normalized);
}

function matchesAnyExactPattern(filePath: string, patterns: string[], baseDir: string): boolean {
  if (patterns.length === 0) return false;
  const rel = toPosixPath(relative(baseDir, filePath));
  const name = basename(filePath);
  const filePathPosix = toPosixPath(filePath);
  const isSkillFile = name === 'SKILL.md';
  const parentDir = isSkillFile ? dirname(filePath) : undefined;
  const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir!)) : undefined;
  const parentDirPosix = isSkillFile ? toPosixPath(parentDir!) : undefined;

  return patterns.some((pattern) => {
    const normalized = normalizeExactPattern(pattern);
    if (normalized === rel || normalized === filePathPosix || normalized === name) return true;
    if (!isSkillFile) return false;
    return normalized === parentRel || normalized === parentDirPosix;
  });
}

function getOverridePatterns(entries: string[]): string[] {
  return entries.filter(isOverridePattern);
}

function applyPatterns(allPaths: string[], patterns: string[], baseDir: string): Set<string> {
  const includes: string[] = [];
  const excludes: string[] = [];
  const forceIncludes: string[] = [];
  const forceExcludes: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith('+')) forceIncludes.push(pattern.slice(1));
    else if (pattern.startsWith('-')) forceExcludes.push(pattern.slice(1));
    else if (pattern.startsWith('!')) excludes.push(pattern.slice(1));
    else includes.push(pattern);
  }

  let result =
    includes.length === 0
      ? [...allPaths]
      : allPaths.filter((path) => matchesAnyPattern(path, includes, baseDir));
  if (excludes.length > 0) {
    result = result.filter((path) => !matchesAnyPattern(path, excludes, baseDir));
  }
  if (forceIncludes.length > 0) {
    for (const path of allPaths) {
      if (!result.includes(path) && matchesAnyExactPattern(path, forceIncludes, baseDir)) {
        result.push(path);
      }
    }
  }
  if (forceExcludes.length > 0) {
    result = result.filter((path) => !matchesAnyExactPattern(path, forceExcludes, baseDir));
  }

  return new Set(result);
}

function isEnabledByOverrides(filePath: string, patterns: string[], baseDir: string): boolean {
  const overrides = getOverridePatterns(patterns);
  const excludes = overrides
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
  const forceIncludes = overrides
    .filter((pattern) => pattern.startsWith('+'))
    .map((pattern) => pattern.slice(1));
  const forceExcludes = overrides
    .filter((pattern) => pattern.startsWith('-'))
    .map((pattern) => pattern.slice(1));

  let enabled = true;
  if (excludes.length > 0 && matchesAnyPattern(filePath, excludes, baseDir)) enabled = false;
  if (forceIncludes.length > 0 && matchesAnyExactPattern(filePath, forceIncludes, baseDir))
    enabled = true;
  if (forceExcludes.length > 0 && matchesAnyExactPattern(filePath, forceExcludes, baseDir))
    enabled = false;
  return enabled;
}

function resourcePrecedenceRank(metadata: PathMetadata): number {
  if (metadata.origin === 'package') return 4;
  const scopeBase = metadata.scope === 'project' ? 0 : 2;
  return scopeBase + (metadata.source === 'local' ? 0 : 1);
}

// ---------- 文件收集 ----------

function collectFiles(
  dir: string,
  filePattern: RegExp,
  skipNodeModules = true,
  ignoreMatcher?: IgnoreMatcher,
  rootDir?: string,
): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (skipNodeModules && entry.name === 'node_modules') continue;

      const fullPath = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(root, fullPath));
      const ignorePath = isDir ? `${relPath}/` : relPath;
      if (ig.ignores(ignorePath)) continue;

      if (isDir) files.push(...collectFiles(fullPath, filePattern, skipNodeModules, ig, root));
      else if (isFile && filePattern.test(entry.name)) files.push(fullPath);
    }
  } catch {
    // Ignore unreadable dirs.
  }

  return files;
}

function collectSkillEntries(
  dir: string,
  mode: SkillDiscoveryMode,
  ignoreMatcher?: IgnoreMatcher,
  rootDir?: string,
): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
      if (entry.name !== 'SKILL.md') continue;

      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(root, fullPath));
      if (isFile && !ig.ignores(relPath)) {
        entries.push(fullPath);
        return entries;
      }
    }

    for (const entry of dirEntries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(root, fullPath));
      if (
        mode === 'scout' &&
        dir === root &&
        isFile &&
        entry.name.endsWith('.md') &&
        !ig.ignores(relPath)
      ) {
        entries.push(fullPath);
        continue;
      }

      if (!isDir) continue;
      if (ig.ignores(`${relPath}/`)) continue;
      entries.push(...collectSkillEntries(fullPath, mode, ig, root));
    }
  } catch {
    // Ignore unreadable dirs.
  }

  return entries;
}

function collectAutoExtensionEntries(dir: string): string[] {
  return discoverExtensionsInDir(dir).map((entry) => entry.path);
}

function collectAutoSkillEntries(dir: string, mode: SkillDiscoveryMode): string[] {
  return collectSkillEntries(dir, mode);
}

function collectAutoPromptEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const ig = ignore();
  addIgnoreRules(ig, dir, dir);
  const entries: string[] = [];

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }
      const relPath = toPosixPath(relative(dir, fullPath));
      if (isFile && entry.name.endsWith('.md') && !ig.ignores(relPath)) {
        entries.push(fullPath);
      }
    }
  } catch {
    return [];
  }

  return entries;
}

function collectResourceFiles(dir: string, resourceType: ResourceType): string[] {
  if (resourceType === 'extensions') return collectAutoExtensionEntries(dir);
  if (resourceType === 'skills') return collectSkillEntries(dir, 'scout');
  return collectFiles(dir, /\.md$/);
}

function findGitRepoRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function collectAncestorAgentsSkillDirs(startDir: string): string[] {
  const skillDirs: string[] = [];
  const resolvedStartDir = resolve(startDir);
  const gitRepoRoot = findGitRepoRoot(resolvedStartDir);

  let dir = resolvedStartDir;
  while (true) {
    skillDirs.push(join(dir, '.agents', 'skills'));
    if (gitRepoRoot && dir === gitRepoRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return skillDirs;
}

// ---------- PackageManager ----------

export interface ScoutPackageManagerOptions {
  cwd: string;
  agentDir: string;
  resourceSettings?: ScoutResourceSettingsSnapshot;
}

export class ScoutPackageManager {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly resourceSettings: ScoutResourceSettingsSnapshot;

  constructor(options: ScoutPackageManagerOptions) {
    this.cwd = resolve(options.cwd);
    this.agentDir = resolve(options.agentDir);
    this.resourceSettings = options.resourceSettings ?? { global: {}, project: {} };
  }

  resolve(): ResolvedPaths {
    const accumulator = this.createAccumulator();
    this.resolvePackageSources(accumulator);
    this.resolveSettingsResources(accumulator);
    this.addAutoDiscoveredResources(accumulator);
    return this.toResolvedPaths(accumulator);
  }

  resolveExtensionSources(
    sources: string[],
    options?: { local?: boolean; temporary?: boolean },
  ): ResolvedPaths {
    const accumulator = this.createAccumulator();
    const scope: SourceScope = options?.temporary
      ? 'temporary'
      : options?.local
        ? 'project'
        : 'user';
    for (const source of sources) {
      this.resolveLocalPackageSource(source, accumulator, undefined, {
        source,
        scope,
        origin: 'package',
      });
    }
    return this.toResolvedPaths(accumulator);
  }

  private resolvePackageSources(accumulator: ResourceAccumulator): void {
    const allPackages: Array<{ pkg: ScoutPackageSource; scope: SourceScope }> = [];
    for (const pkg of this.resourceSettings.project.packages ?? []) {
      allPackages.push({ pkg, scope: 'project' });
    }
    for (const pkg of this.resourceSettings.global.packages ?? []) {
      allPackages.push({ pkg, scope: 'user' });
    }

    for (const { pkg, scope } of this.dedupePackages(allPackages)) {
      const source = typeof pkg === 'string' ? pkg : pkg.source;
      const filter = typeof pkg === 'object' ? pkg : undefined;
      this.resolveLocalPackageSource(source, accumulator, filter, {
        source,
        scope,
        origin: 'package',
      });
    }
  }

  private resolveSettingsResources(accumulator: ResourceAccumulator): void {
    const projectBaseDir = join(this.cwd, '.scout');
    const globalBaseDir = this.agentDir;

    for (const resourceType of RESOURCE_TYPES) {
      const target = this.getTargetMap(accumulator, resourceType);
      this.resolveLocalEntries(
        (this.resourceSettings.project[resourceType] ?? []) as string[],
        resourceType,
        target,
        { source: 'local', scope: 'project', origin: 'top-level', baseDir: projectBaseDir },
        projectBaseDir,
      );
      this.resolveLocalEntries(
        (this.resourceSettings.global[resourceType] ?? []) as string[],
        resourceType,
        target,
        { source: 'local', scope: 'user', origin: 'top-level', baseDir: globalBaseDir },
        globalBaseDir,
      );
    }
  }

  private resolveLocalPackageSource(
    source: string,
    accumulator: ResourceAccumulator,
    filter: PackageFilter | undefined,
    metadata: PathMetadata,
  ): void {
    const scopeBaseDir = this.getBaseDirForScope(metadata.scope);
    const resolved = this.resolvePackageSourcePath(source, scopeBaseDir);
    if (!resolved || !existsSync(resolved)) return;

    try {
      const stats = statSync(resolved);
      if (stats.isFile()) {
        metadata.baseDir = dirname(resolved);
        this.addResource(accumulator.extensions, resolved, metadata, true);
        return;
      }
      if (!stats.isDirectory()) return;

      metadata.baseDir = resolved;
      const collected = this.collectPackageResources(resolved, accumulator, filter, metadata);
      if (!collected) {
        this.addResource(accumulator.extensions, resolved, metadata, true);
      }
    } catch {
      // Skip unreadable package sources.
    }
  }

  private resolvePackageSourcePath(source: string, baseDir: string): string | undefined {
    if (source.startsWith('npm:')) {
      const packageName = parseNpmName(source.slice('npm:'.length).trim());
      if (!packageName) return undefined;
      const managed = join(baseDir, 'npm', 'node_modules', packageName);
      return existsSync(managed) ? managed : undefined;
    }
    if (/^[a-z]+:\/\//i.test(source) || source.startsWith('git@')) {
      return undefined;
    }
    return resolvePath(source, baseDir);
  }

  private collectPackageResources(
    packageRoot: string,
    accumulator: ResourceAccumulator,
    filter: PackageFilter | undefined,
    metadata: PathMetadata,
  ): boolean {
    if (filter) {
      for (const resourceType of RESOURCE_TYPES) {
        const patterns = filter[resourceType];
        const target = this.getTargetMap(accumulator, resourceType);
        if (patterns !== undefined) {
          this.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
        } else {
          this.collectDefaultResources(packageRoot, resourceType, target, metadata);
        }
      }
      return true;
    }

    const manifest = this.readScoutManifest(packageRoot);
    if (manifest) {
      for (const resourceType of RESOURCE_TYPES) {
        this.addManifestEntries(
          manifest[resourceType],
          packageRoot,
          resourceType,
          this.getTargetMap(accumulator, resourceType),
          metadata,
        );
      }
      return true;
    }

    let hasAnyDir = false;
    for (const resourceType of RESOURCE_TYPES) {
      const dir = join(packageRoot, resourceType);
      if (!existsSync(dir)) continue;
      for (const file of collectResourceFiles(dir, resourceType)) {
        this.addResource(this.getTargetMap(accumulator, resourceType), file, metadata, true);
      }
      hasAnyDir = true;
    }
    return hasAnyDir;
  }

  private collectDefaultResources(
    packageRoot: string,
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
  ): void {
    const manifest = this.readScoutManifest(packageRoot);
    const entries = manifest?.[resourceType];
    if (entries) {
      this.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
      return;
    }

    const dir = join(packageRoot, resourceType);
    if (!existsSync(dir)) return;
    for (const file of collectResourceFiles(dir, resourceType)) {
      this.addResource(target, file, metadata, true);
    }
  }

  private applyPackageFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
  ): void {
    const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);
    if (userPatterns.length === 0) {
      for (const file of allFiles) {
        this.addResource(target, file, metadata, false);
      }
      return;
    }

    const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);
    for (const file of allFiles) {
      this.addResource(target, file, metadata, enabledByUser.has(file));
    }
  }

  private collectManifestFiles(
    packageRoot: string,
    resourceType: ResourceType,
  ): { allFiles: string[]; enabledByManifest: Set<string> } {
    const manifest = this.readScoutManifest(packageRoot);
    const entries = manifest?.[resourceType];
    if (entries && entries.length > 0) {
      const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
      const manifestPatterns = entries.filter(isOverridePattern);
      const enabledByManifest =
        manifestPatterns.length > 0
          ? applyPatterns(allFiles, manifestPatterns, packageRoot)
          : new Set(allFiles);
      return { allFiles: Array.from(enabledByManifest), enabledByManifest };
    }

    const conventionDir = join(packageRoot, resourceType);
    if (!existsSync(conventionDir)) return { allFiles: [], enabledByManifest: new Set() };
    const allFiles = collectResourceFiles(conventionDir, resourceType);
    return { allFiles, enabledByManifest: new Set(allFiles) };
  }

  private addManifestEntries(
    entries: string[] | undefined,
    root: string,
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
  ): void {
    if (!entries) return;
    const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
    const patterns = entries.filter(isOverridePattern);
    const enabledPaths = applyPatterns(allFiles, patterns, root);

    for (const file of allFiles) {
      if (enabledPaths.has(file)) {
        this.addResource(target, file, metadata, true);
      }
    }
  }

  private collectFilesFromManifestEntries(
    entries: string[],
    root: string,
    resourceType: ResourceType,
  ): string[] {
    const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
    const files: string[] = [];
    for (const entry of sourceEntries) {
      if (hasGlobPattern(entry)) {
        const matches = globSync(entry, {
          cwd: root,
          absolute: true,
          dot: false,
          nodir: false,
        }).map((match) => resolve(match));
        files.push(...this.collectFilesFromPaths(matches, resourceType));
        continue;
      }
      files.push(...this.collectFilesFromPaths([resolve(root, entry)], resourceType));
    }
    return Array.from(new Set(files.map((file) => resolve(file))));
  }

  private resolveLocalEntries(
    entries: string[],
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
    baseDir: string,
  ): void {
    if (entries.length === 0) return;
    const { plain, patterns } = splitPatterns(entries);
    const resolvedPlain = plain.map((entry) => resolvePath(entry, baseDir));
    const allFiles = this.collectFilesFromPaths(resolvedPlain, resourceType);
    const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

    for (const file of allFiles) {
      this.addResource(target, file, metadata, enabledPaths.has(file));
    }
  }

  private addAutoDiscoveredResources(accumulator: ResourceAccumulator): void {
    const globalBaseDir = this.agentDir;
    const projectBaseDir = join(this.cwd, '.scout');
    const userMetadata: PathMetadata = {
      source: 'auto',
      scope: 'user',
      origin: 'top-level',
      baseDir: globalBaseDir,
    };
    const projectMetadata: PathMetadata = {
      source: 'auto',
      scope: 'project',
      origin: 'top-level',
      baseDir: projectBaseDir,
    };

    const userOverrides = {
      extensions: this.resourceSettings.global.extensions ?? [],
      skills: this.resourceSettings.global.skills ?? [],
      prompts: this.resourceSettings.global.prompts ?? [],
    };
    const projectOverrides = {
      extensions: this.resourceSettings.project.extensions ?? [],
      skills: this.resourceSettings.project.skills ?? [],
      prompts: this.resourceSettings.project.prompts ?? [],
    };

    const userDirs = {
      extensions: join(globalBaseDir, 'extensions'),
      skills: join(globalBaseDir, 'skills'),
      prompts: join(globalBaseDir, 'prompts'),
    };
    const projectDirs = {
      extensions: join(projectBaseDir, 'extensions'),
      skills: join(projectBaseDir, 'skills'),
      prompts: join(projectBaseDir, 'prompts'),
    };

    const addResources = (
      resourceType: ResourceType,
      paths: string[],
      metadata: PathMetadata,
      overrides: string[],
      baseDir: string,
    ) => {
      const target = this.getTargetMap(accumulator, resourceType);
      for (const path of paths) {
        this.addResource(target, path, metadata, isEnabledByOverrides(path, overrides, baseDir));
      }
    };

    addResources(
      'extensions',
      collectAutoExtensionEntries(projectDirs.extensions),
      projectMetadata,
      projectOverrides.extensions,
      projectBaseDir,
    );
    addResources(
      'skills',
      collectAutoSkillEntries(projectDirs.skills, 'scout'),
      projectMetadata,
      projectOverrides.skills,
      projectBaseDir,
    );

    const userAgentsSkillsDir = join(getHomeDir(), '.agents', 'skills');
    const projectAgentsSkillDirs = collectAncestorAgentsSkillDirs(this.cwd).filter(
      (dir) => resolve(dir) !== resolve(userAgentsSkillsDir),
    );
    for (const agentsSkillsDir of projectAgentsSkillDirs) {
      const agentsBaseDir = dirname(agentsSkillsDir);
      addResources(
        'skills',
        collectAutoSkillEntries(agentsSkillsDir, 'agents'),
        { ...projectMetadata, baseDir: agentsBaseDir },
        projectOverrides.skills,
        agentsBaseDir,
      );
    }

    addResources(
      'prompts',
      collectAutoPromptEntries(projectDirs.prompts),
      projectMetadata,
      projectOverrides.prompts,
      projectBaseDir,
    );
    addResources(
      'extensions',
      collectAutoExtensionEntries(userDirs.extensions),
      userMetadata,
      userOverrides.extensions,
      globalBaseDir,
    );
    addResources(
      'skills',
      collectAutoSkillEntries(userDirs.skills, 'scout'),
      userMetadata,
      userOverrides.skills,
      globalBaseDir,
    );

    const userAgentsBaseDir = dirname(userAgentsSkillsDir);
    addResources(
      'skills',
      collectAutoSkillEntries(userAgentsSkillsDir, 'agents'),
      { ...userMetadata, baseDir: userAgentsBaseDir },
      userOverrides.skills,
      userAgentsBaseDir,
    );

    addResources(
      'prompts',
      collectAutoPromptEntries(userDirs.prompts),
      userMetadata,
      userOverrides.prompts,
      globalBaseDir,
    );
  }

  private collectFilesFromPaths(paths: string[], resourceType: ResourceType): string[] {
    const files: string[] = [];
    for (const path of paths) {
      if (!existsSync(path)) continue;
      try {
        const stats = statSync(path);
        if (stats.isFile()) {
          files.push(path);
        } else if (stats.isDirectory()) {
          if (resourceType === 'extensions') {
            const entries = resolveExtensionEntries(path);
            if (entries) files.push(...entries.map((entry) => entry.path));
            else files.push(...collectResourceFiles(path, resourceType));
          } else {
            files.push(...collectResourceFiles(path, resourceType));
          }
        }
      } catch {
        // Ignore unreadable paths.
      }
    }
    return files;
  }

  private getTargetMap(
    accumulator: ResourceAccumulator,
    resourceType: ResourceType,
  ): Map<string, { metadata: PathMetadata; enabled: boolean }> {
    switch (resourceType) {
      case 'extensions':
        return accumulator.extensions;
      case 'skills':
        return accumulator.skills;
      case 'prompts':
        return accumulator.prompts;
    }
  }

  private addResource(
    map: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    path: string,
    metadata: PathMetadata,
    enabled: boolean,
  ): void {
    if (!path) return;
    const existing = map.get(path);
    if (existing && resourcePrecedenceRank(existing.metadata) <= resourcePrecedenceRank(metadata)) {
      return;
    }
    map.set(path, { metadata: { ...metadata }, enabled });
  }

  private readScoutManifest(packageRoot: string): ScoutManifest | null {
    const packageJsonPath = join(packageRoot, 'package.json');
    if (!existsSync(packageJsonPath)) return null;

    try {
      const content = readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content) as { scout?: ScoutManifest };
      return pkg.scout ?? null;
    } catch {
      return null;
    }
  }

  private createAccumulator(): ResourceAccumulator {
    return {
      extensions: new Map(),
      skills: new Map(),
      prompts: new Map(),
    };
  }

  private toResolvedPaths(accumulator: ResourceAccumulator): ResolvedPaths {
    const mapToResolved = (
      entries: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    ): ResolvedResource[] => {
      const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
        path,
        enabled,
        metadata,
      }));
      resolved.sort(
        (a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata),
      );

      const seen = new Set<string>();
      return resolved.filter((entry) => {
        const canonicalPath = canonicalizePath(entry.path);
        if (seen.has(canonicalPath)) return false;
        seen.add(canonicalPath);
        return true;
      });
    };

    return {
      extensions: mapToResolved(accumulator.extensions),
      skills: mapToResolved(accumulator.skills),
      prompts: mapToResolved(accumulator.prompts),
    };
  }

  private getBaseDirForScope(scope: SourceScope): string {
    if (scope === 'project') return join(this.cwd, '.scout');
    if (scope === 'user') return this.agentDir;
    return this.cwd;
  }

  private dedupePackages(
    packages: Array<{ pkg: ScoutPackageSource; scope: SourceScope }>,
  ): Array<{ pkg: ScoutPackageSource; scope: SourceScope }> {
    const seen = new Map<string, { pkg: ScoutPackageSource; scope: SourceScope }>();
    for (const entry of packages) {
      const source = typeof entry.pkg === 'string' ? entry.pkg : entry.pkg.source;
      const identity = this.getPackageIdentity(source, entry.scope);
      const existing = seen.get(identity);
      if (!existing || (entry.scope === 'project' && existing.scope === 'user')) {
        seen.set(identity, entry);
      }
    }
    return Array.from(seen.values());
  }

  private getPackageIdentity(source: string, scope: SourceScope): string {
    if (source.startsWith('npm:')) {
      return `npm:${parseNpmName(source.slice('npm:'.length).trim()) ?? source}`;
    }
    if (/^[a-z]+:\/\//i.test(source) || source.startsWith('git@')) {
      return `git:${source.replace(/[#@].*$/, '')}`;
    }
    return `local:${resolvePath(source, this.getBaseDirForScope(scope))}`;
  }
}

type PackageFilter = Partial<Record<ResourceType, string[]>>;

function parseNpmName(spec: string): string | undefined {
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
  return match?.[1];
}
