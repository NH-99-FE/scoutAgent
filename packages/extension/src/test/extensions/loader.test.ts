// ============================================================
// Extension Loader 测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Type } from '@sinclair/typebox';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createExtensionRuntime,
  loadExtensionFromFactory,
  loadExtensions,
  discoverAndLoadExtensions,
} from '../../extensions/loader.ts';
import type { ScoutExtensionFactory } from '../../extensions/types.ts';
import { createEventBus } from '../../extensions/event-bus.ts';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `scout-ext-loader-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

// ---------- createExtensionRuntime ----------

describe('createExtensionRuntime', () => {
  it('throws on action methods before bindCore', () => {
    const runtime = createExtensionRuntime();
    expect(() => runtime.sendMessage('test')).toThrow('not initialized');
    expect(() => runtime.sendUserMessage('test')).toThrow('not initialized');
    expect(() => runtime.getActiveTools()).toThrow('not initialized');
  });

  it('assertActive passes when not invalidated', () => {
    const runtime = createExtensionRuntime();
    expect(() => runtime.assertActive()).not.toThrow();
  });

  it('assertActive throws after invalidate', () => {
    const runtime = createExtensionRuntime();
    runtime.invalidate('stale!');
    expect(() => runtime.assertActive()).toThrow('stale!');
  });

  it('invalidate only sets message once', () => {
    const runtime = createExtensionRuntime();
    runtime.invalidate('first');
    runtime.invalidate('second');
    expect(() => runtime.assertActive()).toThrow('first');
  });

  it('refreshTools is no-op before bindCore', () => {
    const runtime = createExtensionRuntime();
    expect(() => runtime.refreshTools()).not.toThrow();
  });
});

// ---------- loadExtensionFromFactory ----------

describe('loadExtensionFromFactory', () => {
  it('loads extension from inline factory', async () => {
    const runtime = createExtensionRuntime();
    const factory: ScoutExtensionFactory = (api) => {
      api.on('tool_call', async () => undefined);
      api.registerTool({
        name: 'test-tool',
        label: 'Test Tool',
        description: 'A test tool',
        parameters: Type.Object({}),
        execute: async () => ({ content: [], details: undefined }),
      });
    };

    const extension = await loadExtensionFromFactory(factory, runtime);
    expect(extension.handlers.has('tool_call')).toBe(true);
    expect(extension.tools.has('test-tool')).toBe(true);
  });

  it('supports async factory', async () => {
    const runtime = createExtensionRuntime();
    const factory: ScoutExtensionFactory = async (api) => {
      await Promise.resolve();
      api.on('session_shutdown', async () => undefined);
    };

    const extension = await loadExtensionFromFactory(factory, runtime);
    expect(extension.handlers.has('session_shutdown')).toBe(true);
  });

  it('throws if factory calls action method before bindCore', async () => {
    const runtime = createExtensionRuntime();
    const factory: ScoutExtensionFactory = (api) => {
      api.sendMessage('should fail');
    };

    await expect(loadExtensionFromFactory(factory, runtime)).rejects.toThrow('not initialized');
  });

  it('uses provided event bus', async () => {
    const runtime = createExtensionRuntime();
    const bus = createEventBus();
    const received: unknown[] = [];
    bus.on('test-channel', (data) => received.push(data));

    const factory: ScoutExtensionFactory = (api) => {
      api.events.emit('test-channel', { hello: 'world' });
    };

    await loadExtensionFromFactory(factory, runtime, bus);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ hello: 'world' });
  });
});

// ---------- loadExtensions ----------

describe('loadExtensions', () => {
  it('returns errors for non-existent paths', async () => {
    const result = await loadExtensions(['/nonexistent/ext.ts']);
    expect(result.extensions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('Failed to load extension');
  });

  it('returns errors for modules without factory export', async () => {
    const extPath = join(tempDir, 'no-factory.js');
    writeFileSync(extPath, 'export const x = 1;');
    const result = await loadExtensions([extPath]);
    expect(result.extensions).toHaveLength(0);
    expect(result.errors[0]!.error).toContain('does not export a valid factory function');
  });

  it('loads valid extension from .js file', async () => {
    const extPath = join(tempDir, 'valid-ext.js');
    writeFileSync(
      extPath,
      `
export default function(api) {
  api.on('tool_call', async () => undefined);
  api.registerTool({
    name: 'my-tool',
    label: 'My Tool',
    description: 'A tool from extension',
    parameters: {},
    execute: async () => ({ content: [], details: undefined }),
  });
}
`,
    );
    const result = await loadExtensions([extPath]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0]!.tools.has('my-tool')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------- discoverAndLoadExtensions ----------

describe('discoverAndLoadExtensions', () => {
  it('discovers extensions from cwd/.scout/extensions/', async () => {
    const cwd = tempDir;
    const extDir = join(cwd, '.scout', 'extensions');
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, 'local-ext.js'),
      `
export default function(api) {
  api.on('session_shutdown', async () => undefined);
}
`,
    );

    const result = await discoverAndLoadExtensions([], cwd, join(tempDir, 'agent'));
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0]!.sourceInfo).toEqual(
      expect.objectContaining({
        scope: 'project',
        origin: 'top-level',
        baseDir: extDir,
      }),
    );
  });

  it('discovers extensions from agentDir/extensions/', async () => {
    const agentDir = join(tempDir, 'agent');
    const extDir = join(agentDir, 'extensions');
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, 'global-ext.js'),
      `
export default function(api) {
  api.on('session_shutdown', async () => undefined);
}
`,
    );

    const result = await discoverAndLoadExtensions([], tempDir, agentDir);
    expect(result.extensions).toHaveLength(1);
  });

  it('deduplicates by resolved path', async () => {
    const cwd = tempDir;
    const extDir = join(cwd, '.scout', 'extensions');
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, 'dedup-ext.js'),
      `
export default function(api) {
  api.on('session_shutdown', async () => undefined);
}
`,
    );

    // 同一路径在 configuredPaths 中再次出现
    const result = await discoverAndLoadExtensions(
      [join(extDir, 'dedup-ext.js')],
      cwd,
      join(tempDir, 'agent'),
    );
    expect(result.extensions).toHaveLength(1);
  });

  it('discovers from subdirectory with index.js', async () => {
    const cwd = tempDir;
    const pkgDir = join(cwd, '.scout', 'extensions', 'my-package');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'index.js'),
      `
export default function(api) {
  api.on('context', async () => undefined);
}
`,
    );

    const result = await discoverAndLoadExtensions([], cwd, join(tempDir, 'agent'));
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0]!.sourceInfo).toEqual(
      expect.objectContaining({
        scope: 'project',
        origin: 'top-level',
        baseDir: pkgDir,
      }),
    );
  });

  it('discovers from subdirectory with package.json manifest', async () => {
    const cwd = tempDir;
    const pkgDir = join(cwd, '.scout', 'extensions', 'manifest-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        scout: { extensions: ['entry.js'] },
      }),
    );
    writeFileSync(
      join(pkgDir, 'entry.js'),
      `
export default function(api) {
  api.on('tool_result', async () => undefined);
}
`,
    );

    const result = await discoverAndLoadExtensions([], cwd, join(tempDir, 'agent'));
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0]!.sourceInfo).toEqual(
      expect.objectContaining({
        scope: 'project',
        origin: 'package',
        baseDir: pkgDir,
      }),
    );
  });

  it('returns empty when no extensions found', async () => {
    const result = await discoverAndLoadExtensions([], tempDir, join(tempDir, 'agent'));
    expect(result.extensions).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
