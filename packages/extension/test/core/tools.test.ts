import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TOOL_NAMES,
  createAllToolDefinitions,
  createBuiltinToolDefinitionEntries,
  createDefaultTools,
  createWriteToolDefinition,
  createToolDefinition,
  createTools,
  DEFAULT_ACTIVE_TOOL_NAMES,
} from '../../src/core/tools/index.ts';
import { MAX_REVIEW_TEXT_BYTES } from '../../src/core/review/file-review.ts';

describe('builtin tools', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-tools-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('creates definition entries for requested built-in tools with builtin source info', () => {
    const entries = createBuiltinToolDefinitionEntries(cwd, ['read', 'write']);

    expect(entries.map((entry) => entry.definition.name)).toEqual(['read', 'write']);
    expect(entries.every((entry) => entry.sourceInfo.source === 'builtin')).toBe(true);
    expect(entries.every((entry) => typeof entry.definition.execute === 'function')).toBe(true);
  });

  it('creates built-in tool definitions before wrapping them as AgentTools', () => {
    const definition = createToolDefinition('edit', cwd);
    const [tool] = createTools(cwd, ['edit']);

    expect(definition.name).toBe('edit');
    expect(definition.promptSnippet).toBe('Edit files with exact text replacement');
    expect(definition.prepareArguments).toBeTypeOf('function');
    expect(tool?.name).toBe(definition.name);
    expect(tool?.promptSnippet).toBe(definition.promptSnippet);
    expect(tool?.prepareArguments).toBe(definition.prepareArguments);
  });

  it('uses the Pi-style default active tool set', () => {
    expect(DEFAULT_ACTIVE_TOOL_NAMES).toEqual(['read', 'bash', 'edit', 'write']);
    expect(createDefaultTools(cwd).map((tool) => tool.name)).toEqual(DEFAULT_ACTIVE_TOOL_NAMES);
  });

  it('creates all registered tool names without changing the registry order contract', () => {
    const names = Array.from(ALL_TOOL_NAMES);
    const tools = createTools(cwd, names);

    expect(tools.map((tool) => tool.name)).toEqual(names);
  });

  it('creates all built-in tool definitions without wrapping metadata loss', () => {
    const definitions = createAllToolDefinitions(cwd);

    expect(Object.keys(definitions)).toEqual(Array.from(ALL_TOOL_NAMES));
    expect(definitions.read.promptGuidelines).toEqual([
      'Use read to examine files instead of cat or sed.',
    ]);
    expect(definitions.write.promptGuidelines).toEqual([
      'Use write only for new files or complete rewrites.',
    ]);
  });

  it('keeps the core edit review payload contract for AgentSession capture', async () => {
    const target = path.join(cwd, 'sample.txt');
    fs.writeFileSync(target, 'old value\n', 'utf-8');
    const definition = createToolDefinition('edit', cwd);

    const result = await definition.execute('tool-1', {
      path: 'sample.txt',
      edits: [{ oldText: 'old value', newText: 'new value' }],
    });

    expect(result.details).toMatchObject({
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'sample.txt',
      absolutePath: target,
      originalContent: 'old value\n',
      modifiedContent: 'new value\n',
    });
  });

  it('writes new and overwritten files', async () => {
    const newTarget = path.join(cwd, 'new.txt');
    const existingTarget = path.join(cwd, 'existing.txt');
    fs.writeFileSync(existingTarget, 'before\n', 'utf-8');
    const definition = createToolDefinition('write', cwd);

    await definition.execute('tool-1', {
      path: 'new.txt',
      content: 'created\n',
    });
    await definition.execute('tool-2', {
      path: existingTarget,
      content: 'after\n',
    });

    expect(fs.readFileSync(newTarget, 'utf-8')).toBe('created\n');
    expect(fs.readFileSync(existingTarget, 'utf-8')).toBe('after\n');
  });

  it('keeps write successful for unsupported existing content', async () => {
    const target = path.join(cwd, 'binary.bin');
    fs.writeFileSync(target, Buffer.from([0xff, 0x00]));
    const definition = createToolDefinition('write', cwd);

    const result = await definition.execute('tool-1', {
      path: 'binary.bin',
      content: 'text\n',
    });

    expect(fs.readFileSync(target, 'utf-8')).toBe('text\n');
    expect(result.content).toEqual([
      { type: 'text', text: 'Successfully wrote 5 bytes to binary.bin' },
    ]);
  });

  it('does not read existing write targets that exceed the review size cap', async () => {
    const target = path.join(cwd, 'large.txt');
    const readFile = vi.fn(async () => Buffer.from('should not be read'));
    const writeFile = vi.fn(async () => undefined);
    const definition = createWriteToolDefinition(cwd, {
      operations: {
        stat: vi.fn(async () => ({ size: MAX_REVIEW_TEXT_BYTES + 1 })),
        readFile,
        mkdir: vi.fn(async () => undefined),
        writeFile,
      },
    });

    const result = await definition.execute('tool-1', {
      path: 'large.txt',
      content: 'replacement\n',
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(target, 'replacement\n');
    expect(result.details).toMatchObject({
      kind: 'file_review_payload',
      operation: 'write',
      path: 'large.txt',
      absolutePath: target,
      originalContent: null,
      modifiedContent: null,
      unavailableReason: 'Diff too large to review',
    });
  });

  it('keeps write tool successful when existing content cannot be read for review', async () => {
    const target = path.join(cwd, 'locked.txt');
    const readError = Object.assign(new Error('denied'), { code: 'EACCES' });
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const definition = createWriteToolDefinition(cwd, {
      operations: {
        readFile: vi.fn(async () => {
          throw readError;
        }),
        mkdir,
        writeFile,
      },
    });

    await definition.execute('tool-1', {
      path: 'locked.txt',
      content: 'replacement\n',
    });

    expect(mkdir).toHaveBeenCalledWith(cwd);
    expect(writeFile).toHaveBeenCalledWith(target, 'replacement\n');
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      writeFile.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
