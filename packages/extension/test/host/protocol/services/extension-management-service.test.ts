import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../../../src/config-manager.ts';
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

  it('lists project, global and configured extensions', async () => {
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
          expect.objectContaining({ name: 'project', scope: 'project', exists: true }),
          expect.objectContaining({ name: 'project-package', scope: 'project', exists: true }),
          expect.objectContaining({ name: 'entry', scope: 'project', exists: true }),
          expect.objectContaining({ name: 'global', scope: 'global', exists: true }),
          expect.objectContaining({ name: 'configured', scope: 'configured', exists: true }),
          expect.objectContaining({
            name: 'configured-package',
            scope: 'configured',
            exists: true,
          }),
        ]),
      }),
    });
    expect(extensions).not.toContainEqual(
      expect.objectContaining({ path: path.join(cwd, '.scout', 'extensions', 'ignored.mjs') }),
    );
  });

  it('lists configured directories using runtime discovery rules', async () => {
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
          scope: 'configured',
        }),
        expect.objectContaining({
          name: 'child',
          path: path.join(configuredCollection, 'child', 'index.ts'),
          scope: 'configured',
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

  function createService({
    configuredPaths = [],
    reload = vi.fn(async () => ({ cancelled: false })),
    requestCommands = vi.fn(),
    pushState = vi.fn(async () => undefined),
    pushTreeData = vi.fn(async () => undefined),
    openTextFile,
  }: {
    configuredPaths?: string[];
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
