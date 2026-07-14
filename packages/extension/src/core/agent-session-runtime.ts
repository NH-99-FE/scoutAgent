// ============================================================
// AgentSessionRuntime — Pi-style session replacement owner
// 负责：持有当前 AgentSession，并统一处理 new/resume/fork/reload 替换语义。
// ============================================================

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { AgentSession } from './agent-session.ts';
import type { JsonlSessionMetadata, Session } from './session/index.ts';
import {
  SessionManager as CoreSessionManager,
  extractSessionTextContent,
} from './session/index.ts';
import type {
  NewSessionReplacementOptions,
  ReplacedSessionContext,
  SessionReplacementOptions,
  SessionStartEvent,
} from './extensions/index.ts';
import { readSessionFileInfo } from './session-file.ts';
import { assertSessionCwdExists } from './session-cwd.ts';
import type { Api, Model } from '@scout-agent/ai';
import type { ThinkingLevel } from '@scout-agent/agent';
import type { ActiveToolSelection } from './tools/index.ts';

// ---------- 类型 ----------

export interface AgentSessionRuntimeDiagnostic {
  type: 'info' | 'warning' | 'error' | 'collision';
  message: string;
  path?: string;
  collision?: unknown;
}

export interface CreateAgentSessionRuntimeOptions {
  session: Session;
  cwd?: string;
  activeToolSelection?: ActiveToolSelection;
  initialModel?: Model<Api>;
  initialThinkingLevel?: ThinkingLevel;
  sessionStartEvent?: SessionStartEvent;
}

export interface CreateAgentSessionRuntimeResult {
  session: AgentSession;
  diagnostics: AgentSessionRuntimeDiagnostic[];
  modelFallbackMessage?: string;
}

export type CreateAgentSessionRuntimeFactory = (
  options: CreateAgentSessionRuntimeOptions,
) => Promise<CreateAgentSessionRuntimeResult>;

export interface AgentSessionReplacementResult {
  cancelled: boolean;
  selectedText?: string;
}

export interface AgentSessionRuntimeNewSessionOptions extends NewSessionReplacementOptions {
  toolProfileId?: string;
}

interface AgentSessionRuntimeOptions {
  cwd: string;
  createRuntime: CreateAgentSessionRuntimeFactory;
  diagnostics?: AgentSessionRuntimeDiagnostic[];
  modelFallbackMessage?: string;
}

type ReplacementRuntimeState = Pick<
  CreateAgentSessionRuntimeOptions,
  'initialModel' | 'initialThinkingLevel'
>;

type ReloadRuntimeState = ReplacementRuntimeState &
  Pick<CreateAgentSessionRuntimeOptions, 'activeToolSelection'>;

// ---------- 辅助 ----------

function getSessionFile(session: Session): string | undefined {
  return session.getSessionFile();
}

function getSessionOpenCwdOverride(
  sessionPath: string,
  cwdOverride: string | undefined,
  fallbackCwd: string,
): string | undefined {
  if (cwdOverride) return cwdOverride;
  const sessionCwd = readSessionFileInfo(sessionPath).cwd;
  return sessionCwd?.trim() ? undefined : fallbackCwd;
}

function getReplacementRuntimeState(session: AgentSession): ReplacementRuntimeState {
  return {
    initialModel: session.model,
    initialThinkingLevel: session.thinkingLevel,
  };
}

function getReloadRuntimeState(session: AgentSession): ReloadRuntimeState {
  return {
    ...getReplacementRuntimeState(session),
    activeToolSelection: session.getActiveToolSelection(),
  };
}

export class SessionImportFileNotFoundError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'SessionImportFileNotFoundError';
    this.filePath = filePath;
  }
}

export async function createAgentSessionRuntime(
  createRuntime: CreateAgentSessionRuntimeFactory,
  options: CreateAgentSessionRuntimeOptions & { cwd: string },
): Promise<AgentSessionRuntime> {
  assertSessionCwdExists(options.session, options.cwd);
  const result = await createRuntime(options);
  return new AgentSessionRuntime(result.session, {
    cwd: options.cwd,
    createRuntime,
    diagnostics: result.diagnostics,
    modelFallbackMessage: result.modelFallbackMessage,
  });
}

// ---------- Runtime ----------

export class AgentSessionRuntime {
  private _session: AgentSession;
  private _cwd: string;
  private readonly createRuntime: CreateAgentSessionRuntimeFactory;
  private _diagnostics: AgentSessionRuntimeDiagnostic[];
  private _modelFallbackMessage?: string;
  private rebindSession?: (
    session: AgentSession,
  ) => void | AgentSessionRuntimeDiagnostic[] | Promise<void | AgentSessionRuntimeDiagnostic[]>;
  private beforeSessionInvalidate?: () => void;

  constructor(session: AgentSession, options: AgentSessionRuntimeOptions) {
    this._session = session;
    this._cwd = options.cwd;
    this.createRuntime = options.createRuntime;
    this._diagnostics = [...(options.diagnostics ?? [])];
    this._modelFallbackMessage = options.modelFallbackMessage;
  }

  get session(): AgentSession {
    return this._session;
  }

  get cwd(): string {
    return this._cwd;
  }

  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
    return this._diagnostics;
  }

  get modelFallbackMessage(): string | undefined {
    return this._modelFallbackMessage;
  }

  appendDiagnostics(diagnostics: AgentSessionRuntimeDiagnostic[]): void {
    if (diagnostics.length === 0) return;
    this._diagnostics = [...this._diagnostics, ...diagnostics];
  }

  setRebindSession(
    rebindSession?: (
      session: AgentSession,
    ) => void | AgentSessionRuntimeDiagnostic[] | Promise<void | AgentSessionRuntimeDiagnostic[]>,
  ): void {
    this.rebindSession = rebindSession;
  }

  setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
    this.beforeSessionInvalidate = beforeSessionInvalidate;
  }

  private async teardownCurrent(
    reason: 'new' | 'resume' | 'fork' | 'reload' | 'quit',
    targetSessionFile?: string,
  ): Promise<void> {
    await this.session.emitSessionShutdown({
      type: 'session_shutdown',
      reason,
      targetSessionFile,
    });
    this.beforeSessionInvalidate?.();
    this.session.dispose();
  }

  private apply(result: CreateAgentSessionRuntimeResult, cwd: string): void {
    this._session = result.session;
    this._cwd = cwd;
    this._diagnostics = [...result.diagnostics];
    this._modelFallbackMessage = result.modelFallbackMessage;
  }

  private async finishSessionReplacement(
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>,
  ): Promise<void> {
    const diagnostics = await this.rebindSession?.(this.session);
    if (diagnostics) {
      this.appendDiagnostics(diagnostics);
    }
    if (withSession) {
      await withSession(this.session.createReplacedSessionContext());
    }
  }

  private async replaceWith(
    session: Session,
    cwd: string,
    reason: 'new' | 'resume' | 'fork' | 'reload',
    previousSessionFile: string | undefined,
    options?: SessionReplacementOptions,
    replacementRuntimeState?: ReplacementRuntimeState,
  ): Promise<AgentSessionReplacementResult> {
    await this.teardownCurrent(reason, getSessionFile(session));
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: reason === 'reload' ? 'reload' : reason,
      previousSessionFile,
    };
    const result = await this.createRuntime({
      session,
      cwd,
      ...replacementRuntimeState,
      sessionStartEvent,
    });
    this.apply(result, cwd);
    await this.finishSessionReplacement(options?.withSession);
    return { cancelled: false };
  }

  async switchSession(
    sessionMeta: JsonlSessionMetadata,
    options?: SessionReplacementOptions & { cwdOverride?: string },
  ): Promise<AgentSessionReplacementResult> {
    const cancelled = await this.session.emitSessionBeforeSwitch('resume', sessionMeta.path);
    if (cancelled) return { cancelled: true };

    const previousSessionFile = this.session.sessionFile;
    const session = CoreSessionManager.open(
      sessionMeta.path,
      undefined,
      getSessionOpenCwdOverride(sessionMeta.path, options?.cwdOverride, this.cwd),
    );
    assertSessionCwdExists(session, this.cwd);
    return this.replaceWith(session, session.getCwd(), 'resume', previousSessionFile, options);
  }

  async newSession(
    options?: AgentSessionRuntimeNewSessionOptions,
  ): Promise<AgentSessionReplacementResult> {
    const cancelled = await this.session.emitSessionBeforeSwitch('new');
    if (cancelled) return { cancelled: true };

    const replacementRuntimeState = getReplacementRuntimeState(this.session);
    const previousSessionFile = this.session.sessionFile;
    const currentSession = this.session.sessionManager;
    const session = currentSession.isPersisted()
      ? CoreSessionManager.create(this.cwd, currentSession.getSessionDir(), {
          parentSession: options?.parentSession,
        })
      : CoreSessionManager.inMemory(this.cwd, {
          parentSession: options?.parentSession,
        });

    await this.teardownCurrent('new', getSessionFile(session));
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'new',
      previousSessionFile,
    };
    const result = await this.createRuntime({
      session,
      cwd: this.cwd,
      ...replacementRuntimeState,
      activeToolSelection: options?.toolProfileId
        ? { kind: 'profile', profileId: options.toolProfileId }
        : undefined,
      sessionStartEvent,
    });
    this.apply(result, this.cwd);
    if (options?.setup) {
      await options.setup(this.session.sessionManager);
      await this.session.syncRuntimeMessagesFromSession();
    }
    await this.finishSessionReplacement(options?.withSession);
    return { cancelled: false };
  }

  async reload(): Promise<AgentSessionReplacementResult> {
    const replacementRuntimeState = getReloadRuntimeState(this.session);
    const previousSessionFile = this.session.sessionFile;
    const currentSession = this.session.sessionManager;
    const sessionFile = currentSession.getSessionFile();
    const session =
      currentSession.isPersisted() && sessionFile && existsSync(sessionFile)
        ? CoreSessionManager.open(
            sessionFile,
            currentSession.getSessionDir(),
            currentSession.getCwd(),
          )
        : currentSession;

    return this.replaceWith(
      session,
      currentSession.getCwd(),
      'reload',
      previousSessionFile,
      undefined,
      replacementRuntimeState,
    );
  }

  async fork(
    entryId: string,
    position: 'before' | 'at',
    options?: SessionReplacementOptions,
  ): Promise<AgentSessionReplacementResult> {
    const cancelled = await this.session.emitSessionBeforeFork(entryId, position);
    if (cancelled) return { cancelled: true };

    const replacementRuntimeState = getReplacementRuntimeState(this.session);

    const selectedEntry = await this.session.sessionManager.getEntry(entryId);
    if (!selectedEntry) throw new Error(`Invalid entry ID for forking: ${entryId}`);

    let targetLeafId: string | null;
    let selectedText: string | undefined;
    if (position === 'at') {
      targetLeafId = selectedEntry.id;
    } else {
      if (selectedEntry.type !== 'message' || selectedEntry.message.role !== 'user') {
        throw new Error(`Invalid entry ID for forking before: ${entryId}`);
      }
      targetLeafId = selectedEntry.parentId;
      selectedText = extractSessionTextContent(selectedEntry.message.content);
    }

    const previousSessionFile = this.session.sessionFile;
    const currentSession = this.session.sessionManager;
    const sessionDir = currentSession.getSessionDir();
    let nextSession: Session;

    if (!targetLeafId) {
      nextSession = CoreSessionManager.create(this.cwd, sessionDir, {
        parentSession: previousSessionFile,
      });
    } else if (currentSession.isPersisted()) {
      const currentSessionFile = currentSession.getSessionFile();
      if (!currentSessionFile) {
        throw new Error('Persisted session is missing a session file');
      }
      nextSession = CoreSessionManager.open(
        currentSessionFile,
        sessionDir,
        currentSession.getCwd(),
      );
      const forkedSession = nextSession.replaceWithBranchedSession(targetLeafId);
      if (!forkedSession.sessionFile) throw new Error('Failed to create forked session');
    } else {
      nextSession = currentSession;
      nextSession.replaceWithBranchedSession(targetLeafId);
    }

    const result = await this.replaceWith(
      nextSession,
      nextSession.getCwd(),
      'fork',
      previousSessionFile,
      options,
      replacementRuntimeState,
    );
    return { ...result, selectedText };
  }

  async importFromJsonl(
    inputPath: string,
    options?: SessionReplacementOptions & { cwdOverride?: string },
  ): Promise<AgentSessionReplacementResult> {
    const resolvedPath = resolve(inputPath);
    if (!existsSync(resolvedPath)) {
      throw new SessionImportFileNotFoundError(resolvedPath);
    }

    const sessionDir = this.session.sessionManager.isPersisted()
      ? this.session.sessionManager.getSessionDir()
      : dirname(resolvedPath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const destinationPath = join(sessionDir, basename(resolvedPath));
    const cancelled = await this.session.emitSessionBeforeSwitch('resume', destinationPath);
    if (cancelled) return { cancelled: true };

    const previousSessionFile = this.session.sessionFile;
    if (resolve(destinationPath) !== resolvedPath) {
      copyFileSync(resolvedPath, destinationPath);
    }

    const session = CoreSessionManager.open(
      destinationPath,
      sessionDir,
      getSessionOpenCwdOverride(destinationPath, options?.cwdOverride, this.cwd),
    );
    assertSessionCwdExists(session, this.cwd);
    return this.replaceWith(session, session.getCwd(), 'resume', previousSessionFile, options);
  }

  async dispose(): Promise<void> {
    await this.teardownCurrent('quit');
  }
}
