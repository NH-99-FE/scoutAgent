// ============================================================
// process-utils 测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { killProcessTree, waitForChildProcess } from '../../tools/shared/process-utils.ts';

describe('killProcessTree', () => {
  it('kills a spawned process without throwing', async () => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/c', 'echo hello'] : ['-c', 'echo hello'];
    const child = spawn(shell, args, { stdio: 'ignore' });

    // 给进程一点时间启动
    await new Promise((r) => setTimeout(r, 50));

    // 不应抛出异常
    expect(() => killProcessTree(child.pid!)).not.toThrow();
  });

  it('does not throw for already-exited pid', () => {
    // 使用一个不太可能存在的 PID
    expect(() => killProcessTree(999999)).not.toThrow();
  });
});

describe('waitForChildProcess', () => {
  it('resolves with exit code for quick command', async () => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/c', 'echo hello'] : ['-c', 'echo hello'];
    const child = spawn(shell, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const exitCode = await waitForChildProcess(child);
    expect(exitCode).toBe(0);
  });

  it('resolves with non-zero exit code for failing command', async () => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/c', 'exit 1'] : ['-c', 'exit 1'];
    const child = spawn(shell, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const exitCode = await waitForChildProcess(child);
    expect(exitCode).toBe(1);
  });

  it('resolves after exit even when inherited stdio handles never close', async () => {
    const child = new EventEmitter() as any;
    child.stdout = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { destroy: vi.fn() });

    const promise = waitForChildProcess(child);
    child.emit('exit', 0);

    const exitCode = await promise;
    expect(exitCode).toBe(0);
    expect(child.stdout.destroy).toHaveBeenCalled();
    expect(child.stderr.destroy).toHaveBeenCalled();
  });
});
