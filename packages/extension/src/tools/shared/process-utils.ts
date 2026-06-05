// ============================================================
// 进程管理工具 — killProcessTree + waitForChildProcess
// 从 Pi 移植，解决 Windows 进程组杀灭和 stdio 句柄挂起问题
// ============================================================

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// ---------- detached 子进程跟踪 ----------

const trackedDetachedChildPids = new Set<number>();

export function trackDetachedChildPid(pid: number): void {
  trackedDetachedChildPids.add(pid);
}

export function untrackDetachedChildPid(pid: number): void {
  trackedDetachedChildPids.delete(pid);
}

export function killTrackedDetachedChildren(): void {
  for (const pid of trackedDetachedChildPids) {
    killProcessTree(pid);
  }
  trackedDetachedChildPids.clear();
}

// ---------- killProcessTree ----------

/**
 * 杀死整个进程树。
 * Windows：使用 taskkill /F /T /PID 递归杀死子进程。
 * Unix：先尝试杀死进程组（-pid），回退到单独 pid。
 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
    } catch {
      // 忽略错误
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程已退出
    }
  }
}

// ---------- waitForChildProcess ----------

/** exit 后 stdio 句柄关闭的宽限期（毫秒） */
const EXIT_STDIO_GRACE_MS = 100;

/**
 * 等待子进程终止，处理 inherited stdio handles 导致的挂起问题。
 *
 * Windows 上，守护进程化的后代可能继承子进程的 stdout/stderr 管道句柄。
 * 此时子进程会发出 `exit` 事件，但 `close` 事件可能永远不触发，
 * 即使原始进程已经退出。此函数短暂等待 stdio 结束后强制完成。
 */
export function waitForChildProcess(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: NodeJS.Timeout | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;

    const cleanup = () => {
      if (postExitTimer) {
        clearTimeout(postExitTimer);
        postExitTimer = undefined;
      }
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      child.stdout?.removeListener('end', onStdoutEnd);
      child.stderr?.removeListener('end', onStderrEnd);
    };

    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(code);
    };

    const maybeFinalizeAfterExit = () => {
      if (!exited || settled) return;
      if (stdoutEnded && stderrEnded) {
        finalize(exitCode);
      }
    };

    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };

    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onExit = (code: number | null) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
      if (!settled) {
        postExitTimer = setTimeout(() => finalize(code), EXIT_STDIO_GRACE_MS);
      }
    };

    const onClose = (code: number | null) => {
      finalize(code);
    };

    child.stdout?.once('end', onStdoutEnd);
    child.stderr?.once('end', onStderrEnd);
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
  });
}
