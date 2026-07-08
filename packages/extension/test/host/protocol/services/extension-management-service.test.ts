import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../../../src/config-manager.ts';
import type { ScoutResourceSettingsSnapshot } from '../../../../src/core/package-manager.ts';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { ExtensionManagementProtocolService } from '../../../../src/host/protocol/services/extension-management-service.ts';

describe('ExtensionManagementProtocolService', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-extension-management-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'extensions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists project, global and settings extensions from resolved resources', async () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'project.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'ignored.mjs'),
      'export default () => {}',
    );
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions', 'project-package'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'project-package', 'index.ts'),
      'export default () => {}',
    );
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions', 'manifest-package'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'manifest-package', 'package.json'),
      JSON.stringify({ scout: { extensions: ['./src/entry.ts'] } }),
    );
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions', 'manifest-package', 'src'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'manifest-package', 'src', 'entry.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(path.join(agentDir, 'extensions', 'global.ts'), 'export default () => {}');
    const configuredPath = path.join(tempDir, 'configured.ts');
    fs.writeFileSync(configuredPath, 'export default () => {}');
    const configuredDir = path.join(tempDir, 'configured-package');
    fs.mkdirSync(configuredDir, { recursive: true });
    fs.writeFileSync(path.join(configuredDir, 'index.js'), 'export default () => {}');
    const service = createService({ configuredPaths: [configuredPath, configuredDir] });
    const respond = vi.fn();

    await service.requestExtensions(respond);

    const result = respond.mock.calls[0]?.[0];
    const extensions = result.settings.extensions;

    expect(respond).toHaveBeenCalledWith({
      type: 'extensions_result',
      settings: expect.objectContaining({
        projectDir: path.join(cwd, '.scout', 'extensions'),
        globalDir: path.join(agentDir, 'extensions'),
        configuredPaths: [configuredPath, configuredDir],
        templates: expect.arrayContaining([
          expect.objectContaining({
            id: 'permission-gate',
            label: 'Permission Gate',
            path: path.join(cwd, '.scout', 'extensions', 'permission-gate.ts'),
            exists: false,
          }),
        ]),
        extensions: expect.arrayContaining([
          expect.objectContaining({
            name: 'project',
            scope: 'project',
            exists: true,
            sourceInfo: expect.objectContaining({ origin: 'top-level', scope: 'project' }),
          }),
          expect.objectContaining({ name: 'project-package', scope: 'project', exists: true }),
          expect.objectContaining({
            name: 'entry',
            scope: 'project',
            exists: true,
            sourceInfo: expect.objectContaining({ origin: 'top-level', scope: 'project' }),
          }),
          expect.objectContaining({ name: 'global', scope: 'global', exists: true }),
          expect.objectContaining({ name: 'configured', scope: 'global', exists: true }),
          expect.objectContaining({
            name: 'configured-package',
            scope: 'global',
            exists: true,
          }),
        ]),
      }),
    });
    expect(extensions).not.toContainEqual(
      expect.objectContaining({ path: path.join(cwd, '.scout', 'extensions', 'ignored.mjs') }),
    );
  });

  it('lists settings directories using runtime discovery rules', async () => {
    const configuredRootPackage = path.join(tempDir, 'configured-root-package');
    fs.mkdirSync(configuredRootPackage, { recursive: true });
    fs.writeFileSync(
      path.join(configuredRootPackage, 'package.json'),
      JSON.stringify({ scout: { extensions: ['./src/root.ts'] } }),
    );
    fs.mkdirSync(path.join(configuredRootPackage, 'src'), { recursive: true });
    fs.writeFileSync(path.join(configuredRootPackage, 'src', 'root.ts'), 'export default () => {}');
    fs.writeFileSync(path.join(configuredRootPackage, 'sibling.ts'), 'export default () => {}');
    const configuredCollection = path.join(tempDir, 'configured-collection');
    fs.mkdirSync(path.join(configuredCollection, 'child'), { recursive: true });
    fs.writeFileSync(
      path.join(configuredCollection, 'child', 'index.ts'),
      'export default () => {}',
    );
    fs.writeFileSync(path.join(configuredCollection, 'ignored.cjs'), 'export default () => {}');
    const service = createService({
      configuredPaths: [configuredRootPackage, configuredCollection],
    });
    const respond = vi.fn();

    await service.requestExtensions(respond);

    const result = respond.mock.calls[0]?.[0];
    const extensions = result.settings.extensions;
    expect(extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'root',
          path: path.join(configuredRootPackage, 'src', 'root.ts'),
          scope: 'global',
        }),
        expect.objectContaining({
          name: 'child',
          path: path.join(configuredCollection, 'child', 'index.ts'),
          scope: 'global',
        }),
      ]),
    );
    expect(extensions).not.toContainEqual(
      expect.objectContaining({ path: path.join(configuredRootPackage, 'sibling.ts') }),
    );
    expect(extensions).not.toContainEqual(
      expect.objectContaining({ path: path.join(configuredCollection, 'ignored.cjs') }),
    );
  });

  it('lists project and global extension settings together', async () => {
    const projectConfigured = path.join(tempDir, 'project-configured.ts');
    const globalConfigured = path.join(tempDir, 'global-configured.ts');
    fs.writeFileSync(projectConfigured, 'export default () => {}');
    fs.writeFileSync(globalConfigured, 'export default () => {}');
    const service = createService({
      resourceSettings: {
        project: { extensions: [projectConfigured] },
        global: { extensions: [globalConfigured] },
      },
    });
    const respond = vi.fn();

    await service.requestExtensions(respond);

    const result = respond.mock.calls[0]?.[0];
    expect(result.settings.configuredPaths).toEqual([projectConfigured, globalConfigured]);
    expect(result.settings.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'project-configured',
          path: projectConfigured,
          scope: 'project',
        }),
        expect.objectContaining({
          name: 'global-configured',
          path: globalConfigured,
          scope: 'global',
        }),
      ]),
    );
  });

  it('preserves missing configured extension paths in the protocol list', async () => {
    const missingProject = path.join(cwd, '.scout', 'missing-project.ts');
    const missingGlobal = path.join(agentDir, 'missing-global.ts');
    const globEntry = './extensions/*.ts';
    const service = createService({
      resourceSettings: {
        project: { extensions: [missingProject, globEntry] },
        global: { extensions: [missingGlobal] },
      },
    });
    const respond = vi.fn();

    await service.requestExtensions(respond);

    const result = respond.mock.calls[0]?.[0];
    expect(result.settings.configuredPaths).toEqual([
      missingProject,
      path.join(cwd, '.scout', globEntry),
      missingGlobal,
    ]);
    expect(result.settings.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'missing-project',
          path: missingProject,
          scope: 'project',
          exists: false,
          enabled: true,
          sourceInfo: expect.objectContaining({
            path: missingProject,
            source: 'local',
            scope: 'project',
            origin: 'top-level',
            baseDir: path.join(cwd, '.scout'),
          }),
        }),
        expect.objectContaining({
          name: 'missing-global',
          path: missingGlobal,
          scope: 'global',
          exists: false,
          enabled: true,
          sourceInfo: expect.objectContaining({
            path: missingGlobal,
            source: 'local',
            scope: 'user',
            origin: 'top-level',
            baseDir: agentDir,
          }),
        }),
      ]),
    );
    expect(result.settings.extensions).not.toContainEqual(
      expect.objectContaining({ path: path.join(cwd, '.scout', globEntry) }),
    );
  });

  it('preserves disabled extension resources in the protocol list', async () => {
    const enabledExtension = path.join(tempDir, 'enabled.ts');
    const disabledExtension = path.join(tempDir, 'disabled.ts');
    fs.writeFileSync(enabledExtension, 'export default () => {}');
    fs.writeFileSync(disabledExtension, 'export default () => {}');
    const service = createService({
      resourceSettings: {
        project: {},
        global: {
          extensions: [enabledExtension, disabledExtension, `-${disabledExtension}`],
        },
      },
    });
    const respond = vi.fn();

    await service.requestExtensions(respond);

    const result = respond.mock.calls[0]?.[0];
    expect(result.settings.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'enabled',
          path: enabledExtension,
          enabled: true,
        }),
        expect.objectContaining({
          name: 'disabled',
          path: disabledExtension,
          enabled: false,
        }),
      ]),
    );
  });

  it('creates extensions from templates and reloads runtime resources', async () => {
    const reload = vi.fn(async () => ({ cancelled: false }));
    const requestCommands = vi.fn();
    const pushState = vi.fn(async () => undefined);
    const pushTreeData = vi.fn(async () => undefined);
    const service = createService({ reload, requestCommands, pushState, pushTreeData });
    const respond = vi.fn();

    await service.createExtensionFromTemplate(
      { type: 'create_extension_from_template', templateId: 'permission-gate', scope: 'project' },
      respond,
    );

    const extensionPath = path.join(cwd, '.scout', 'extensions', 'permission-gate.ts');
    const source = fs.readFileSync(extensionPath, 'utf8');
    expect(source).toContain('interface PermissionGateExtensionAPI');
    expect(source).toContain('export default function (scout: PermissionGateExtensionAPI)');
    expect(source).toContain("scout.on('tool_call'");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(requestCommands).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushTreeData).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      type: 'create_extension_from_template_result',
      success: true,
      path: extensionPath,
    });
  });

  it('lists extension templates from the project scope', async () => {
    const extensionPath = path.join(cwd, '.scout', 'extensions', 'permission-gate.ts');
    fs.writeFileSync(extensionPath, 'export default () => {}');
    const service = createService();
    const respond = vi.fn();

    await service.requestExtensions(respond);

    const result = respond.mock.calls[0]?.[0];
    expect(result.settings.templates).toEqual([
      {
        id: 'permission-gate',
        label: 'Permission Gate',
        path: extensionPath,
        exists: true,
      },
    ]);
  });

  it('opens files under known extension roots', async () => {
    const extensionPath = path.join(cwd, '.scout', 'extensions', 'project.ts');
    fs.writeFileSync(extensionPath, 'export default () => {}');
    const openTextFile = vi.fn(async () => undefined);
    const service = createService({ openTextFile });
    const respond = vi.fn();

    await service.openExtensionFile({ type: 'open_extension_file', path: extensionPath }, respond);

    expect(openTextFile).toHaveBeenCalledWith(extensionPath);
    expect(respond).toHaveBeenCalledWith({
      type: 'open_extension_file_result',
      success: true,
      path: extensionPath,
    });
  });

  it('opens package manifest extension files resolved by the package manager', async () => {
    const packageDir = path.join(tempDir, 'package-extension');
    const packageExtensionPath = path.join(packageDir, 'src', 'entry.ts');
    fs.mkdirSync(path.dirname(packageExtensionPath), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { extensions: ['./src/entry.ts'] } }),
    );
    fs.writeFileSync(packageExtensionPath, 'export default () => {}');
    const openTextFile = vi.fn(async () => undefined);
    const service = createService({
      openTextFile,
      resourceSettings: {
        project: {},
        global: { packages: [packageDir] },
      },
    });
    const respond = vi.fn();
    const listRespond = vi.fn();

    await service.requestExtensions(listRespond);

    await service.openExtensionFile(
      { type: 'open_extension_file', path: packageExtensionPath },
      respond,
    );

    expect(listRespond.mock.calls[0]?.[0].settings.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: packageExtensionPath,
          scope: 'global',
          sourceInfo: expect.objectContaining({ origin: 'package', scope: 'user' }),
        }),
      ]),
    );
    expect(openTextFile).toHaveBeenCalledWith(packageExtensionPath);
    expect(respond).toHaveBeenCalledWith({
      type: 'open_extension_file_result',
      success: true,
      path: packageExtensionPath,
    });
  });

  function createService({
    configuredPaths = [],
    resourceSettings,
    reload = vi.fn(async () => ({ cancelled: false })),
    requestCommands = vi.fn(),
    pushState = vi.fn(async () => undefined),
    pushTreeData = vi.fn(async () => undefined),
    openTextFile,
  }: {
    configuredPaths?: string[];
    resourceSettings?: ScoutResourceSettingsSnapshot;
    reload?: () => Promise<{ cancelled: boolean }>;
    requestCommands?: () => void;
    pushState?: () => Promise<void>;
    pushTreeData?: () => Promise<void>;
    openTextFile?: (filePath: string) => Promise<void>;
  } = {}) {
    return new ExtensionManagementProtocolService({
      cwd,
      agentDir,
      configManager: {
        getExtensionPaths: vi.fn(() => configuredPaths),
        getResourceSettings: vi.fn(
          () =>
            resourceSettings ?? {
              project: {},
              global: { extensions: configuredPaths },
            },
        ),
      } as unknown as ConfigManager,
      sessionManager: {
        reload,
      } as unknown as ExtensionSessionCoordinator,
      openTextFile,
      pushConfig: vi.fn(),
      requestCommands,
      pushState,
      pushTreeData,
    });
  }
});
