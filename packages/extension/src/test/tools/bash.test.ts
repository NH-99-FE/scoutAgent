// ============================================================
// Bash 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createBashTool, type BashOperations } from '../../tools/bash.ts';

function makeBashOps(overrides: Partial<BashOperations> = {}): BashOperations {
  return {
    exec: vi.fn(async (command, cwd, { onData }) => {
      onData(Buffer.from('hello output\n'));
      return { exitCode: 0 };
    }),
    ...overrides,
  };
}

describe('createBashTool', () => {
  it('returns tool with name "bash"', () => {
    const tool = createBashTool('/test', { operations: makeBashOps() });
    expect(tool.name).toBe('bash');
    expect(tool.label).toBe('bash');
  });

  it('executes a command and returns output', async () => {
    const ops = makeBashOps();
    const tool = createBashTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { command: 'echo hello' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('hello output');
  });

  it('throws on non-zero exit code', async () => {
    const ops = makeBashOps({
      exec: vi.fn(async (_cmd, _cwd, { onData }) => {
        onData(Buffer.from('error message\n'));
        return { exitCode: 1 };
      }),
    });
    const tool = createBashTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { command: 'false' })).rejects.toThrow(/exited with code 1/);
  });

  it('handles abort via "aborted" error', async () => {
    const ops = makeBashOps({
      exec: vi.fn(async () => {
        throw new Error('aborted');
      }),
    });
    const tool = createBashTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { command: 'sleep 10' })).rejects.toThrow(/aborted/);
  });

  it('handles timeout error', async () => {
    const ops = makeBashOps({
      exec: vi.fn(async () => {
        throw new Error('timeout:30');
      }),
    });
    const tool = createBashTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { command: 'sleep 100', timeout: 30 })).rejects.toThrow(
      /timed out after 30/,
    );
  });

  it('supports commandPrefix', async () => {
    const ops = makeBashOps();
    const tool = createBashTool('/test', { operations: ops, commandPrefix: 'source env.sh' });
    await tool.execute('tc1', { command: 'echo hello' });
    expect(ops.exec).toHaveBeenCalledWith(
      expect.stringContaining('source env.sh'),
      '/test',
      expect.any(Object),
    );
  });

  it('calls onUpdate for streaming output', async () => {
    const ops = makeBashOps({
      exec: vi.fn(async (command, cwd, { onData }) => {
        onData(Buffer.from('streaming '));
        onData(Buffer.from('output'));
        return { exitCode: 0 };
      }),
    });
    const tool = createBashTool('/test', { operations: ops });
    const onUpdate = vi.fn();
    await tool.execute('tc1', { command: 'test' }, undefined, onUpdate);
    // onUpdate should have been called at least once (initial empty + streaming updates)
    expect(onUpdate).toHaveBeenCalled();
  });

  it('handles null exit code as success', async () => {
    const ops = makeBashOps({
      exec: vi.fn(async (_cmd, _cwd, { onData }) => {
        onData(Buffer.from('output'));
        return { exitCode: null };
      }),
    });
    const tool = createBashTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { command: 'bg-process' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('output');
  });
});
