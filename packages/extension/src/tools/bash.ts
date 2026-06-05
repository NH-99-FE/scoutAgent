// ============================================================
// Bash 工具 — 命令执行，支持流式输出和截断
// 基于 Pi bash.ts 移植，去掉所有 TUI 渲染代码，简化本地执行
// ============================================================

import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import type { AgentTool } from '@scout-agent/agent';
import { spawn } from 'node:child_process';
import { type Static, Type } from '@sinclair/typebox';
import { OutputAccumulator } from './shared/output-accumulator.ts';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from './shared/truncate.ts';
import {
  killProcessTree,
  trackDetachedChildPid,
  untrackDetachedChildPid,
  waitForChildProcess,
} from './shared/process-utils.ts';
import { getShellConfig, getShellEnv } from './shared/shell-config.ts';

// ---------- Schema ----------

const bashSchema = Type.Object({
  command: Type.String({ description: 'Bash command to execute' }),
  timeout: Type.Optional(
    Type.Number({ description: 'Timeout in seconds (optional, no default timeout)' }),
  ),
});

// ---------- Types ----------

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

// ---------- 可插拔操作接口 ----------

/**
 * Bash 工具的可插拔操作。
 * 覆盖以委托命令执行到远程系统（例如 SSH）。
 */
export interface BashOperations {
  /**
   * 执行命令并流式输出。
   * @param command 要执行的命令
   * @param cwd 工作目录
   * @param options 执行选项
   * @returns Promise 解析为退出码（被杀死时为 null）
   */
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

/**
 * 创建基于本地 shell 的 BashOperations。
 * 解析顺序与 Pi 保持一致，默认优先使用 bash 而非平台 shell。
 */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const { shell, args } = getShellConfig(options?.shellPath);

      if (signal?.aborted) throw new Error('aborted');

      // 检查 cwd 是否存在
      try {
        await fsAccess(cwd, constants.F_OK);
      } catch {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
      }

      const child = spawn(shell, [...args, command], {
        cwd,
        detached: process.platform !== 'win32',
        env: env ?? getShellEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      if (child.pid) trackDetachedChildPid(child.pid);

      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const onAbort = () => {
        if (child.pid) killProcessTree(child.pid);
      };

      try {
        // 设置超时
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }

        // 流式输出 stdout 和 stderr
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        // 通过 abort 信号杀死整个进程树
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }

        // 使用 waitForChildProcess 等待进程结束（处理 stdio 句柄挂起）
        const exitCode = await waitForChildProcess(child);

        if (signal?.aborted) throw new Error('aborted');
        if (timedOut) throw new Error(`timeout:${timeout}`);

        return { exitCode };
      } finally {
        if (child.pid) untrackDetachedChildPid(child.pid);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

// ---------- Spawn 钩子 ----------

export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(
  command: string,
  cwd: string,
  spawnHook?: BashSpawnHook,
): BashSpawnContext {
  const baseContext: BashSpawnContext = { command, cwd, env: getShellEnv() };
  return spawnHook ? spawnHook(baseContext) : baseContext;
}

// ---------- 工具选项 ----------

export interface BashToolOptions {
  /** 自定义命令执行操作。默认：本地 shell */
  operations?: BashOperations;
  /** 命令前缀（如 shell 初始化命令） */
  commandPrefix?: string;
  /** 可选的显式 shell 路径 */
  shellPath?: string;
  /** 执行前调整 command/cwd/env 的钩子 */
  spawnHook?: BashSpawnHook;
}

// ---------- 常量 ----------

const BASH_UPDATE_THROTTLE_MS = 100;

// ---------- 创建工具 ----------

export function createBashTool(
  cwd: string,
  options?: BashToolOptions,
): AgentTool<typeof bashSchema, BashToolDetails | undefined> {
  const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
  const commandPrefix = options?.commandPrefix;
  const spawnHook = options?.spawnHook;

  return {
    name: 'bash',
    label: 'bash',
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    promptSnippet: 'Execute bash commands (ls, grep, find, etc.)',
    parameters: bashSchema,
    async execute(
      _toolCallId,
      { command, timeout }: { command: string; timeout?: number },
      signal?: AbortSignal,
      onUpdate?,
    ) {
      const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
      const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
      const output = new OutputAccumulator({ tempFilePrefix: 'scout-bash' });
      let updateTimer: NodeJS.Timeout | undefined;
      let updateDirty = false;
      let lastUpdateAt = 0;

      const emitOutputUpdate = () => {
        if (!onUpdate || !updateDirty) return;
        updateDirty = false;
        lastUpdateAt = Date.now();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        onUpdate({
          content: [{ type: 'text' as const, text: snapshot.content || '' }],
          details: {
            truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
            fullOutputPath: snapshot.fullOutputPath,
          },
        });
      };

      const clearUpdateTimer = () => {
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = undefined;
        }
      };

      const scheduleOutputUpdate = () => {
        if (!onUpdate) return;
        updateDirty = true;
        const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
        if (delay <= 0) {
          clearUpdateTimer();
          emitOutputUpdate();
          return;
        }
        updateTimer ??= setTimeout(() => {
          updateTimer = undefined;
          emitOutputUpdate();
        }, delay);
      };

      if (onUpdate) {
        onUpdate({ content: [], details: undefined });
      }

      const handleData = (data: Buffer) => {
        output.append(data);
        scheduleOutputUpdate();
      };

      const finishOutput = async () => {
        output.finish();
        clearUpdateTimer();
        emitOutputUpdate();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        await output.closeTempFile();
        return snapshot;
      };

      const formatOutput = (
        snapshot: Awaited<ReturnType<typeof finishOutput>>,
        emptyText = '(no output)',
      ) => {
        const truncation = snapshot.truncation;
        let text = snapshot.content || emptyText;
        let details: BashToolDetails | undefined;
        if (truncation.truncated) {
          details = { truncation, fullOutputPath: snapshot.fullOutputPath };
          const startLine = truncation.totalLines - truncation.outputLines + 1;
          const endLine = truncation.totalLines;
          if (truncation.lastLinePartial) {
            const lastLineSize = formatSize(output.getLastLineBytes());
            text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
          } else if (truncation.truncatedBy === 'lines') {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
          } else {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
          }
        }
        return { text, details };
      };

      const appendStatus = (text: string, status: string) =>
        `${text ? `${text}\n\n` : ''}${status}`;

      try {
        let exitCode: number | null;
        try {
          const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
            onData: handleData,
            signal,
            timeout,
            env: spawnContext.env,
          });
          exitCode = result.exitCode;
        } catch (err) {
          const snapshot = await finishOutput();
          const { text } = formatOutput(snapshot, '');
          if (err instanceof Error && err.message === 'aborted') {
            throw new Error(appendStatus(text, 'Command aborted'), { cause: err });
          }
          if (err instanceof Error && err.message.startsWith('timeout:')) {
            const timeoutSecs = err.message.split(':')[1];
            throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`), {
              cause: err,
            });
          }
          throw err;
        }

        const snapshot = await finishOutput();
        const { text: outputText, details } = formatOutput(snapshot);
        if (exitCode !== 0 && exitCode !== null) {
          throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
        }
        return { content: [{ type: 'text' as const, text: outputText }], details };
      } finally {
        clearUpdateTimer();
      }
    },
  };
}
