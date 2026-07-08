// ============================================================
// Skill path resolver — Skills 管理路径归属
// ============================================================

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { ScoutSkillScope } from '@scout-agent/shared';
import { dedupePaths } from '../resource-management/index.ts';

// ---------- Resolver ----------

export class SkillPathResolver {
  private readonly cwd: string;
  private readonly agentDir: string;

  constructor(options: { cwd: string; agentDir: string }) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
  }

  getProjectSkillsDir(): string {
    return path.join(this.cwd, '.scout', 'skills');
  }

  getGlobalSkillsDir(): string {
    return path.join(this.agentDir, 'skills');
  }

  getAgentsSkillDirs(): string[] {
    return dedupePaths([
      path.join(homedir(), '.agents', 'skills'),
      ...collectAncestorAgentsSkillDirs(this.cwd),
    ]);
  }

  getExistingAgentsSkillDirs(): string[] {
    return this.getAgentsSkillDirs().filter((dir) => existsSync(dir));
  }

  getKnownSkillRoots(): string[] {
    return [
      this.getProjectSkillsDir(),
      this.getGlobalSkillsDir(),
      ...this.getAgentsSkillDirs(),
    ].map((item) => path.resolve(item));
  }

  getOverrideBaseDir(scope: ScoutSkillScope): string {
    return scope === 'project' ? path.join(this.cwd, '.scout') : this.agentDir;
  }
}

// ---------- Agents compat ----------

function collectAncestorAgentsSkillDirs(startDir: string): string[] {
  const skillDirs: string[] = [];
  const resolvedStartDir = path.resolve(startDir);
  const gitRepoRoot = findGitRepoRoot(resolvedStartDir);

  let dir = resolvedStartDir;
  while (true) {
    skillDirs.push(path.join(dir, '.agents', 'skills'));
    if (gitRepoRoot && dir === gitRepoRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return skillDirs;
}

function findGitRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
