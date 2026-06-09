import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_TOOL_NAMES,
  createBuiltinToolDefinitionEntries,
  createDefaultTools,
  createTools,
  DEFAULT_ACTIVE_TOOL_NAMES,
} from '../../src/core/tools/index.ts';

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
});
