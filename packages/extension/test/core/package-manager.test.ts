import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScoutPackageManager, type ResolvedResource } from '../../src/core/package-manager.ts';

function isEnabled(
  resource: ResolvedResource,
  pathMatch: string,
  matchFn: 'endsWith' | 'includes' = 'endsWith',
): boolean {
  const normalizedPath = resource.path.replace(/\\/g, '/');
  const normalizedMatch = pathMatch.replace(/\\/g, '/');
  return matchFn === 'endsWith'
    ? normalizedPath.endsWith(normalizedMatch) && resource.enabled
    : normalizedPath.includes(normalizedMatch) && resource.enabled;
}

function isDisabled(
  resource: ResolvedResource,
  pathMatch: string,
  matchFn: 'endsWith' | 'includes' = 'endsWith',
): boolean {
  const normalizedPath = resource.path.replace(/\\/g, '/');
  const normalizedMatch = pathMatch.replace(/\\/g, '/');
  return matchFn === 'endsWith'
    ? normalizedPath.endsWith(normalizedMatch) && !resource.enabled
    : normalizedPath.includes(normalizedMatch) && !resource.enabled;
}

function pathEndsWith(actualPath: string, suffix: string): boolean {
  return actualPath.replace(/\\/g, '/').endsWith(suffix.replace(/\\/g, '/'));
}

function writeSkill(filePath: string, name: string, description = name): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\nContent`);
}

function writePrompt(filePath: string, description = path.basename(filePath, '.md')): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\ndescription: ${description}\n---\nPrompt body`);
}

describe('ScoutPackageManager', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-package-manager-test-'));
    process.env.HOME = tempDir;
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('expands positive glob manifest entries before collecting extensions', () => {
    const packageDir = path.join(tempDir, 'extension-glob-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'alpha.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'beta.ts'), 'export default () => {}');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { extensions: ['extensions/*.ts'] } }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'extensions/alpha.ts'))).toBe(
      true,
    );
    expect(result.extensions.some((resource) => isEnabled(resource, 'extensions/beta.ts'))).toBe(
      true,
    );
  });

  it('expands positive glob manifest entries before collecting skills', () => {
    const packageDir = path.join(tempDir, 'skill-glob-package');
    const pdfSkillDir = path.join(packageDir, 'plugins', 'pdf-to-markdown', 'skills', 'pdf');
    const docSkillDir = path.join(packageDir, 'plugins', 'docs', 'skills', 'document');
    fs.mkdirSync(pdfSkillDir, { recursive: true });
    fs.mkdirSync(docSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(pdfSkillDir, 'SKILL.md'),
      '---\nname: pdf\ndescription: PDF\n---\nContent',
    );
    fs.writeFileSync(
      path.join(docSkillDir, 'SKILL.md'),
      '---\nname: document\ndescription: Document\n---\nContent',
    );
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { skills: ['./plugins/*/skills'] } }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => isEnabled(resource, 'pdf/SKILL.md'))).toBe(true);
    expect(result.skills.some((resource) => isEnabled(resource, 'document/SKILL.md'))).toBe(true);
  });

  it('expands positive glob manifest entries before collecting prompts', () => {
    const packageDir = path.join(tempDir, 'prompt-glob-package');
    writePrompt(path.join(packageDir, 'prompts', 'review.md'), 'Review');
    writePrompt(path.join(packageDir, 'prompts', 'explain.md'), 'Explain');
    writePrompt(path.join(packageDir, 'prompts', 'nested', 'ignored.md'), 'Ignored');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { prompts: ['prompts/*.md'] } }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.prompts.some((resource) => isEnabled(resource, 'prompts/review.md'))).toBe(true);
    expect(result.prompts.some((resource) => isEnabled(resource, 'prompts/explain.md'))).toBe(true);
    expect(
      result.prompts.some((resource) => pathEndsWith(resource.path, 'nested/ignored.md')),
    ).toBe(false);
  });

  it('applies double-star exclusion patterns to nested manifest resources', () => {
    const packageDir = path.join(tempDir, 'nested-exclude-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'node_modules', 'dep', 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'local.ts'), 'export default () => {}');
    fs.writeFileSync(
      path.join(packageDir, 'node_modules', 'dep', 'extensions', 'remote.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(packageDir, 'node_modules', 'dep', 'extensions', 'skip.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        scout: {
          extensions: ['extensions', 'node_modules/dep/extensions', '!**/skip.ts'],
        },
      }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'local.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'remote.ts'))).toBe(true);
    expect(result.extensions.some((resource) => pathEndsWith(resource.path, 'skip.ts'))).toBe(
      false,
    );
  });

  it('applies package filters on top of manifest filters', () => {
    const packageDir = path.join(tempDir, 'layered-filter-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'foo.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'bar.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'baz.ts'), 'export default () => {}');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { extensions: ['extensions', '!**/baz.ts'] } }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: ['!**/bar.ts'],
              skills: [],
              prompts: [],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'foo.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isDisabled(resource, 'bar.ts'))).toBe(true);
    expect(result.extensions.some((resource) => pathEndsWith(resource.path, 'baz.ts'))).toBe(false);
  });

  it('combines include and exclude patterns in package filters', () => {
    const packageDir = path.join(tempDir, 'combo-filter-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'alpha.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'beta.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'gamma.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: ['**/alpha.ts', '**/beta.ts', '!**/beta.ts'],
              skills: [],
              prompts: [],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'alpha.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isDisabled(resource, 'beta.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isDisabled(resource, 'gamma.ts'))).toBe(true);
  });

  it('treats direct paths in package filters as includes', () => {
    const packageDir = path.join(tempDir, 'direct-filter-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'one.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'two.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: ['extensions/one.ts'],
              skills: [],
              prompts: [],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'one.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isDisabled(resource, 'two.ts'))).toBe(true);
  });

  it('treats direct prompt paths in package filters as includes', () => {
    const packageDir = path.join(tempDir, 'direct-prompt-filter-package');
    writePrompt(path.join(packageDir, 'prompts', 'one.md'), 'One');
    writePrompt(path.join(packageDir, 'prompts', 'two.md'), 'Two');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: [],
              skills: [],
              prompts: ['prompts/one.md'],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.prompts.some((resource) => isEnabled(resource, 'one.md'))).toBe(true);
    expect(result.prompts.some((resource) => isDisabled(resource, 'two.md'))).toBe(true);
  });

  it('honors force include and force exclude package filter overrides', () => {
    const packageDir = path.join(tempDir, 'force-filter-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'alpha.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'beta.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'gamma.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: [
                '!**/*.ts',
                '+extensions/beta.ts',
                'extensions/gamma.ts',
                '-extensions/gamma.ts',
              ],
              skills: [],
              prompts: [],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isDisabled(resource, 'alpha.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'beta.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isDisabled(resource, 'gamma.ts'))).toBe(true);
  });

  it('honors force include and force exclude package prompt filters', () => {
    const packageDir = path.join(tempDir, 'force-prompt-filter-package');
    writePrompt(path.join(packageDir, 'prompts', 'alpha.md'), 'Alpha');
    writePrompt(path.join(packageDir, 'prompts', 'beta.md'), 'Beta');
    writePrompt(path.join(packageDir, 'prompts', 'gamma.md'), 'Gamma');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: [],
              skills: [],
              prompts: ['!**/*.md', '+prompts/beta.md', '+prompts/gamma.md', '-prompts/gamma.md'],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.prompts.some((resource) => isDisabled(resource, 'alpha.md'))).toBe(true);
    expect(result.prompts.some((resource) => isEnabled(resource, 'beta.md'))).toBe(true);
    expect(result.prompts.some((resource) => isDisabled(resource, 'gamma.md'))).toBe(true);
  });

  it('applies top-level exclusion filters to auto-discovered skills and prompts', () => {
    const goodSkill = path.join(agentDir, 'skills', 'good-skill', 'SKILL.md');
    const badSkill = path.join(agentDir, 'skills', 'bad-skill', 'SKILL.md');
    writeSkill(goodSkill, 'good-skill', 'Good');
    writeSkill(badSkill, 'bad-skill', 'Bad');
    fs.mkdirSync(path.join(agentDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'prompts', 'review.md'), 'Review');
    fs.writeFileSync(path.join(agentDir, 'prompts', 'explain.md'), 'Explain');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {
          skills: ['skills', '!**/bad-skill'],
          prompts: ['prompts', '!explain.md'],
        },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => isEnabled(resource, 'good-skill', 'includes'))).toBe(
      true,
    );
    expect(result.skills.some((resource) => isDisabled(resource, 'bad-skill', 'includes'))).toBe(
      true,
    );
    expect(result.prompts.some((resource) => isEnabled(resource, 'review.md'))).toBe(true);
    expect(result.prompts.some((resource) => isDisabled(resource, 'explain.md'))).toBe(true);
  });

  it('applies pure override entries to auto-discovered resources', () => {
    fs.mkdirSync(path.join(agentDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'prompts', 'auto.md'), 'Auto prompt');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { prompts: ['!prompts/auto.md'] },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(result.prompts.some((resource) => isDisabled(resource, 'auto.md'))).toBe(true);
  });

  it('honors top-level force include and force exclude overrides', () => {
    const extensionsDir = path.join(agentDir, 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.writeFileSync(path.join(extensionsDir, 'keep.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(extensionsDir, 'force-back.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(extensionsDir, 'force-out.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {
          extensions: [
            'extensions',
            '!extensions/*.ts',
            '+extensions/force-back.ts',
            '+extensions/force-out.ts',
            '-extensions/force-out.ts',
          ],
        },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isDisabled(resource, 'keep.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'force-back.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isDisabled(resource, 'force-out.ts'))).toBe(true);
  });

  it('force-includes prompts from top-level overrides after exclusion', () => {
    writePrompt(path.join(agentDir, 'prompts', 'review.md'), 'Review');
    writePrompt(path.join(agentDir, 'prompts', 'explain.md'), 'Explain');
    writePrompt(path.join(agentDir, 'prompts', 'debug.md'), 'Debug');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { prompts: ['prompts', '!prompts/*.md', '+prompts/debug.md'] },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(result.prompts.some((resource) => isDisabled(resource, 'review.md'))).toBe(true);
    expect(result.prompts.some((resource) => isDisabled(resource, 'explain.md'))).toBe(true);
    expect(result.prompts.some((resource) => isEnabled(resource, 'debug.md'))).toBe(true);
  });

  it('force-includes a specifically excluded top-level extension', () => {
    fs.mkdirSync(path.join(agentDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'extensions', 'a.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(agentDir, 'extensions', 'b.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { extensions: ['extensions', '!extensions/b.ts', '+extensions/b.ts'] },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'a.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'b.ts'))).toBe(true);
  });

  it('force-excludes package resources after force include', () => {
    const packageDir = path.join(tempDir, 'force-exclude-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'alpha.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'beta.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: ['extensions/*.ts', '+extensions/alpha.ts', '-extensions/alpha.ts'],
              skills: [],
              prompts: [],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isDisabled(resource, 'alpha.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'beta.ts'))).toBe(true);
  });

  it('lets explicit settings override package resources for the same path', () => {
    const packageDir = path.join(tempDir, 'settings-override-package');
    const extensionPath = path.join(packageDir, 'extensions', 'shared.ts');
    const skillPath = path.join(packageDir, 'skills', 'shared-skill', 'SKILL.md');
    const promptPath = path.join(packageDir, 'prompts', 'shared.md');
    fs.mkdirSync(path.dirname(extensionPath), { recursive: true });
    fs.writeFileSync(extensionPath, 'export default () => {}');
    writeSkill(skillPath, 'shared-skill', 'Shared skill');
    writePrompt(promptPath, 'Shared prompt');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: ['!**/*.ts'],
              skills: ['!**/shared-skill'],
              prompts: ['!**/*.md'],
            },
          ],
          extensions: [extensionPath],
          skills: [skillPath],
          prompts: [promptPath],
        },
      },
    });

    const result = manager.resolve();
    const extension = result.extensions.find((resource) => resource.path === extensionPath);
    const skill = result.skills.find((resource) => resource.path === skillPath);
    const prompt = result.prompts.find((resource) => resource.path === promptPath);

    expect(extension).toEqual(
      expect.objectContaining({
        enabled: true,
        metadata: expect.objectContaining({
          source: 'local',
          scope: 'project',
          origin: 'top-level',
        }),
      }),
    );
    expect(skill).toEqual(
      expect.objectContaining({
        enabled: true,
        metadata: expect.objectContaining({
          source: 'local',
          scope: 'project',
          origin: 'top-level',
        }),
      }),
    );
    expect(prompt).toEqual(
      expect.objectContaining({
        enabled: true,
        metadata: expect.objectContaining({
          source: 'local',
          scope: 'project',
          origin: 'top-level',
        }),
      }),
    );
    expect(result.extensions.filter((resource) => resource.path === extensionPath)).toHaveLength(1);
    expect(result.skills.filter((resource) => resource.path === skillPath)).toHaveLength(1);
    expect(result.prompts.filter((resource) => resource.path === promptPath)).toHaveLength(1);
  });

  it('keeps manifest entries starting with tilde package-relative', () => {
    const packageDir = path.join(tempDir, 'tilde-manifest-package');
    const directExtensionPath = path.join(packageDir, '~extensions', 'main.ts');
    const slashExtensionPath = path.join(packageDir, '~', 'extensions', 'alt.ts');
    const directSkillPath = path.join(packageDir, '~skills', 'direct-skill', 'SKILL.md');
    const slashSkillPath = path.join(packageDir, '~', 'skills', 'slash-skill', 'SKILL.md');

    fs.mkdirSync(path.dirname(directExtensionPath), { recursive: true });
    fs.mkdirSync(path.dirname(slashExtensionPath), { recursive: true });
    fs.writeFileSync(directExtensionPath, 'export default () => {}');
    fs.writeFileSync(slashExtensionPath, 'export default () => {}');
    writeSkill(directSkillPath, 'direct-skill', 'Direct');
    writeSkill(slashSkillPath, 'slash-skill', 'Slash');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        scout: {
          extensions: ['~extensions/main.ts', '~/extensions/alt.ts'],
          skills: ['~skills', '~/skills'],
        },
      }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => resource.path === directExtensionPath)).toBe(true);
    expect(result.extensions.some((resource) => resource.path === slashExtensionPath)).toBe(true);
    expect(result.skills.some((resource) => resource.path === directSkillPath)).toBe(true);
    expect(result.skills.some((resource) => resource.path === slashSkillPath)).toBe(true);
  });

  it('resolves a configured extension directory through its package manifest only', () => {
    const packageDir = path.join(tempDir, 'configured-extension-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'clip.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'cost.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'helper.ts'), 'export const helper = 1;');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        scout: {
          extensions: ['./extensions/clip.ts', './extensions/cost.ts'],
        },
      }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { extensions: [packageDir] },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(
      result.extensions.some(
        (resource) =>
          resource.path === path.join(packageDir, 'extensions', 'clip.ts') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      result.extensions.some(
        (resource) =>
          resource.path === path.join(packageDir, 'extensions', 'cost.ts') && resource.enabled,
      ),
    ).toBe(true);
    expect(result.extensions.some((resource) => pathEndsWith(resource.path, 'helper.ts'))).toBe(
      false,
    );
  });

  it('stops recursing when a package skill directory contains SKILL.md', () => {
    const packageDir = path.join(tempDir, 'skill-root-package');
    const rootSkill = path.join(packageDir, 'skills', 'root-skill', 'SKILL.md');
    const nestedSkill = path.join(packageDir, 'skills', 'root-skill', 'nested-skill', 'SKILL.md');
    writeSkill(rootSkill, 'root-skill', 'Root');
    writeSkill(nestedSkill, 'nested-skill', 'Nested');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => resource.path === rootSkill && resource.enabled)).toBe(
      true,
    );
    expect(result.skills.some((resource) => resource.path === nestedSkill)).toBe(false);
  });

  it('force-includes multiple package skills by skill directory exact patterns', () => {
    const packageDir = path.join(tempDir, 'multi-force-skill-package');
    writeSkill(path.join(packageDir, 'skills', 'skill-a', 'SKILL.md'), 'skill-a', 'A');
    writeSkill(path.join(packageDir, 'skills', 'skill-b', 'SKILL.md'), 'skill-b', 'B');
    writeSkill(path.join(packageDir, 'skills', 'skill-c', 'SKILL.md'), 'skill-c', 'C');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: {},
        project: {
          packages: [
            {
              source: packageDir,
              extensions: [],
              skills: ['!**/*', '+skills/skill-a', '+skills/skill-c'],
              prompts: [],
            },
          ],
        },
      },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => isEnabled(resource, 'skill-a', 'includes'))).toBe(true);
    expect(result.skills.some((resource) => isDisabled(resource, 'skill-b', 'includes'))).toBe(
      true,
    );
    expect(result.skills.some((resource) => isEnabled(resource, 'skill-c', 'includes'))).toBe(true);
  });

  it('honors force include entries in manifest override patterns', () => {
    const packageDir = path.join(tempDir, 'manifest-force-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'one.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'two.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(packageDir, 'extensions', 'three.ts'), 'export default () => {}');
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        scout: {
          extensions: ['extensions', '!**/two.ts', '+extensions/two.ts'],
        },
      }),
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(result.extensions.some((resource) => isEnabled(resource, 'one.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'two.ts'))).toBe(true);
    expect(result.extensions.some((resource) => isEnabled(resource, 'three.ts'))).toBe(true);
  });

  it('dedupes same absolute local package across project and global with project metadata', () => {
    const packageDir = path.join(tempDir, 'shared-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'extensions', 'shared.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { packages: [packageDir] },
        project: { packages: [packageDir] },
      },
    });

    const result = manager.resolve();
    const sharedResources = result.extensions.filter((resource) =>
      pathEndsWith(resource.path, 'shared.ts'),
    );

    expect(sharedResources).toHaveLength(1);
    expect(sharedResources[0]?.metadata.scope).toBe('project');
  });

  it('keeps different local packages from global and project settings', () => {
    const globalPackageDir = path.join(tempDir, 'global-package');
    const projectPackageDir = path.join(tempDir, 'project-package');
    fs.mkdirSync(path.join(globalPackageDir, 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(projectPackageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(globalPackageDir, 'extensions', 'from-global.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(projectPackageDir, 'extensions', 'from-project.ts'),
      'export default () => {}',
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { packages: [globalPackageDir] },
        project: { packages: [projectPackageDir] },
      },
    });

    const result = manager.resolve();

    expect(
      result.extensions.some((resource) => pathEndsWith(resource.path, 'from-global.ts')),
    ).toBe(true);
    expect(
      result.extensions.some((resource) => pathEndsWith(resource.path, 'from-project.ts')),
    ).toBe(true);
  });

  it('dedupes symlinked user and project auto resources with project precedence', () => {
    const sharedDir = path.join(tempDir, 'shared-resources');
    const sharedExtensionsDir = path.join(sharedDir, 'extensions');
    const sharedSkillsDir = path.join(sharedDir, 'skills');
    const sharedPromptsDir = path.join(sharedDir, 'prompts');
    fs.mkdirSync(sharedExtensionsDir, { recursive: true });
    fs.mkdirSync(sharedSkillsDir, { recursive: true });
    fs.mkdirSync(sharedPromptsDir, { recursive: true });
    fs.writeFileSync(path.join(sharedExtensionsDir, 'shared.ts'), 'export default () => {}');
    writeSkill(path.join(sharedSkillsDir, 'shared-skill', 'SKILL.md'), 'shared-skill', 'Shared');
    fs.writeFileSync(path.join(sharedPromptsDir, 'shared.md'), 'Shared prompt');

    const projectBaseDir = path.join(cwd, '.scout');
    fs.mkdirSync(projectBaseDir, { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(sharedExtensionsDir, path.join(agentDir, 'extensions'), linkType);
    fs.symlinkSync(sharedSkillsDir, path.join(agentDir, 'skills'), linkType);
    fs.symlinkSync(sharedPromptsDir, path.join(agentDir, 'prompts'), linkType);
    fs.symlinkSync(sharedExtensionsDir, path.join(projectBaseDir, 'extensions'), linkType);
    fs.symlinkSync(sharedSkillsDir, path.join(projectBaseDir, 'skills'), linkType);
    fs.symlinkSync(sharedPromptsDir, path.join(projectBaseDir, 'prompts'), linkType);

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();

    expect(result.extensions).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
    expect(result.prompts).toHaveLength(1);
    expect(result.extensions[0]?.metadata.scope).toBe('project');
    expect(result.skills[0]?.metadata.scope).toBe('project');
    expect(result.prompts[0]?.metadata.scope).toBe('project');
  });

  it('scans .agents skills from cwd up to git root and ignores root markdown files', () => {
    const repoRoot = path.join(tempDir, 'repo');
    const nestedCwd = path.join(repoRoot, 'packages', 'feature');
    process.env.HOME = path.join(tempDir, 'home');
    fs.mkdirSync(process.env.HOME, { recursive: true });
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    fs.mkdirSync(nestedCwd, { recursive: true });
    const aboveRepoSkill = path.join(tempDir, '.agents', 'skills', 'above-repo', 'SKILL.md');
    const repoSkill = path.join(repoRoot, '.agents', 'skills', 'repo-root', 'SKILL.md');
    const nestedSkill = path.join(repoRoot, 'packages', '.agents', 'skills', 'nested', 'SKILL.md');
    writeSkill(aboveRepoSkill, 'above-repo', 'Above');
    writeSkill(repoSkill, 'repo-root', 'Repo');
    writeSkill(nestedSkill, 'nested', 'Nested');
    fs.writeFileSync(
      path.join(repoRoot, '.agents', 'skills', 'root-file.md'),
      '---\nname: root-file\ndescription: Root\n---\nContent',
    );

    const manager = new ScoutPackageManager({
      cwd: nestedCwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => resource.path === repoSkill && resource.enabled)).toBe(
      true,
    );
    expect(
      result.skills.some((resource) => resource.path === nestedSkill && resource.enabled),
    ).toBe(true);
    expect(result.skills.some((resource) => resource.path === aboveRepoSkill)).toBe(false);
    expect(result.skills.some((resource) => pathEndsWith(resource.path, 'root-file.md'))).toBe(
      false,
    );
  });

  it('scans .agents skills up to the filesystem root when cwd is not in a git repo', () => {
    const nonRepoRoot = path.join(tempDir, 'non-repo');
    const nestedCwd = path.join(nonRepoRoot, 'a', 'b');
    fs.mkdirSync(nestedCwd, { recursive: true });
    const rootSkill = path.join(nonRepoRoot, '.agents', 'skills', 'root', 'SKILL.md');
    const middleSkill = path.join(nonRepoRoot, 'a', '.agents', 'skills', 'middle', 'SKILL.md');
    writeSkill(rootSkill, 'root', 'Root');
    writeSkill(middleSkill, 'middle', 'Middle');

    const manager = new ScoutPackageManager({
      cwd: nestedCwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => resource.path === rootSkill && resource.enabled)).toBe(
      true,
    );
    expect(
      result.skills.some((resource) => resource.path === middleSkill && resource.enabled),
    ).toBe(true);
  });

  it('keeps home .agents skills user-scoped when cwd is under home outside a git repo', () => {
    process.env.HOME = tempDir;
    const nestedCwd = path.join(tempDir, 'scratch', 'nested');
    fs.mkdirSync(nestedCwd, { recursive: true });
    const homeSkill = path.join(tempDir, '.agents', 'skills', 'home-skill', 'SKILL.md');
    writeSkill(homeSkill, 'home-skill', 'Home');

    const manager = new ScoutPackageManager({
      cwd: nestedCwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();
    const matchingSkills = result.skills.filter((resource) => resource.path === homeSkill);

    expect(matchingSkills).toHaveLength(1);
    expect(matchingSkills[0]?.enabled).toBe(true);
    expect(matchingSkills[0]?.metadata.scope).toBe('user');
    expect(matchingSkills[0]?.metadata.source).toBe('auto');
  });

  it('records expected baseDir metadata for auto-discovered skill roots', () => {
    process.env.HOME = tempDir;
    const projectBaseDir = path.join(cwd, '.scout');
    const userScoutSkill = path.join(agentDir, 'skills', 'user-scout', 'SKILL.md');
    const projectScoutSkill = path.join(projectBaseDir, 'skills', 'project-scout', 'SKILL.md');
    const userAgentsBaseDir = path.join(tempDir, '.agents');
    const userAgentsSkill = path.join(userAgentsBaseDir, 'skills', 'user-agents', 'SKILL.md');
    const repoAgentsBaseDir = path.join(cwd, '.agents');
    const repoAgentsSkill = path.join(repoAgentsBaseDir, 'skills', 'repo-agents', 'SKILL.md');

    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
    writeSkill(userScoutSkill, 'user-scout', 'User Scout');
    writeSkill(projectScoutSkill, 'project-scout', 'Project Scout');
    writeSkill(userAgentsSkill, 'user-agents', 'User Agents');
    writeSkill(repoAgentsSkill, 'repo-agents', 'Repo Agents');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();

    expect(
      result.skills.find((resource) => resource.path === userScoutSkill)?.metadata,
    ).toMatchObject({
      source: 'auto',
      scope: 'user',
      baseDir: agentDir,
    });
    expect(
      result.skills.find((resource) => resource.path === projectScoutSkill)?.metadata,
    ).toMatchObject({
      source: 'auto',
      scope: 'project',
      baseDir: projectBaseDir,
    });
    expect(
      result.skills.find((resource) => resource.path === userAgentsSkill)?.metadata,
    ).toMatchObject({
      source: 'auto',
      scope: 'user',
      baseDir: userAgentsBaseDir,
    });
    expect(
      result.skills.find((resource) => resource.path === repoAgentsSkill)?.metadata,
    ).toMatchObject({
      source: 'auto',
      scope: 'project',
      baseDir: repoAgentsBaseDir,
    });
  });

  it('dedupes user skills when agent skills is a symlink to home .agents skills', () => {
    process.env.HOME = tempDir;
    const agentSkillsDir = path.join(agentDir, 'skills');
    const agentsSkillsDir = path.join(tempDir, '.agents', 'skills');
    fs.mkdirSync(agentsSkillsDir, { recursive: true });
    fs.symlinkSync(
      agentsSkillsDir,
      agentSkillsDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const skillPath = path.join(agentsSkillsDir, 'foo', 'SKILL.md');
    writeSkill(skillPath, 'foo', 'Foo');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();

    expect(
      result.skills.filter((resource) => pathEndsWith(resource.path, 'foo/SKILL.md')),
    ).toHaveLength(1);
  });

  it('respects ignore files inside skill directories', () => {
    const skillsDir = path.join(agentDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, '.gitignore'), 'venv\n__pycache__\n');
    writeSkill(path.join(skillsDir, 'good-skill', 'SKILL.md'), 'good-skill', 'Good');
    writeSkill(path.join(skillsDir, 'venv', 'bad-skill', 'SKILL.md'), 'bad-skill', 'Bad');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: {
        global: { skills: ['skills'] },
        project: {},
      },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => isEnabled(resource, 'good-skill', 'includes'))).toBe(
      true,
    );
    expect(result.skills.some((resource) => isEnabled(resource, 'venv', 'includes'))).toBe(false);
  });

  it('does not apply parent gitignore to project auto-discovery', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.scout\n');
    const skillPath = path.join(cwd, '.scout', 'skills', 'auto-skill', 'SKILL.md');
    writeSkill(skillPath, 'auto-skill', 'Auto');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolve();

    expect(result.skills.some((resource) => resource.path === skillPath && resource.enabled)).toBe(
      true,
    );
  });

  it('resolves local extension sources without package settings', () => {
    const extensionPath = path.join(tempDir, 'local-extension.ts');
    fs.writeFileSync(extensionPath, 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const result = manager.resolveExtensionSources([extensionPath]);

    expect(
      result.extensions.some((resource) => resource.path === extensionPath && resource.enabled),
    ).toBe(true);
  });

  it('resolves extension source directories with manifests and auto layouts', () => {
    const manifestPackageDir = path.join(tempDir, 'manifest-source-package');
    fs.mkdirSync(path.join(manifestPackageDir, 'src'), { recursive: true });
    writeSkill(
      path.join(manifestPackageDir, 'skills', 'manifest-skill', 'SKILL.md'),
      'manifest-skill',
      'Manifest',
    );
    writePrompt(path.join(manifestPackageDir, 'prompts', 'manifest-prompt.md'), 'Manifest prompt');
    fs.writeFileSync(path.join(manifestPackageDir, 'src', 'index.ts'), 'export default () => {}');
    fs.writeFileSync(
      path.join(manifestPackageDir, 'package.json'),
      JSON.stringify({
        scout: {
          extensions: ['./src/index.ts'],
          skills: ['./skills'],
          prompts: ['./prompts/*.md'],
        },
      }),
    );

    const autoPackageDir = path.join(tempDir, 'auto-source-package');
    fs.mkdirSync(path.join(autoPackageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(autoPackageDir, 'extensions', 'main.ts'), 'export default () => {}');

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: {} },
    });

    const manifestResult = manager.resolveExtensionSources([manifestPackageDir]);
    const autoResult = manager.resolveExtensionSources([autoPackageDir]);

    expect(
      manifestResult.extensions.some(
        (resource) => pathEndsWith(resource.path, 'src/index.ts') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      manifestResult.skills.some(
        (resource) => pathEndsWith(resource.path, 'manifest-skill/SKILL.md') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      manifestResult.prompts.some(
        (resource) => pathEndsWith(resource.path, 'manifest-prompt.md') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      autoResult.extensions.some(
        (resource) => pathEndsWith(resource.path, 'main.ts') && resource.enabled,
      ),
    ).toBe(true);
  });

  it('discovers only extension entry points from multi-file extension directories', () => {
    const packageDir = path.join(tempDir, 'multi-file-extension-package');
    fs.mkdirSync(path.join(packageDir, 'extensions', 'subagent'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'extensions', 'custom'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'extensions', 'broken'), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'standalone.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'subagent', 'index.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'subagent', 'agents.ts'),
      'export const helper = 1;',
    );
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'custom', 'package.json'),
      JSON.stringify({ scout: { extensions: ['./main.ts'] } }),
    );
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'custom', 'main.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'custom', 'utils.ts'),
      'export const util = 1;',
    );
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'broken', 'helper.ts'),
      'export const x = 1;',
    );

    const manager = new ScoutPackageManager({
      cwd,
      agentDir,
      resourceSettings: { global: {}, project: { packages: [packageDir] } },
    });

    const result = manager.resolve();

    expect(
      result.extensions.some(
        (resource) => pathEndsWith(resource.path, 'standalone.ts') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      result.extensions.some(
        (resource) => pathEndsWith(resource.path, 'subagent/index.ts') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      result.extensions.some(
        (resource) => pathEndsWith(resource.path, 'custom/main.ts') && resource.enabled,
      ),
    ).toBe(true);
    expect(
      result.extensions.some((resource) => pathEndsWith(resource.path, 'subagent/agents.ts')),
    ).toBe(false);
    expect(
      result.extensions.some((resource) => pathEndsWith(resource.path, 'custom/utils.ts')),
    ).toBe(false);
    expect(
      result.extensions.some((resource) => pathEndsWith(resource.path, 'broken/helper.ts')),
    ).toBe(false);
  });
});
