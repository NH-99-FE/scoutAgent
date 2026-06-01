import type { JsonlSessionMetadata, Session } from '@scout-agent/agent';
import type { AgentSession } from './agent-session.ts';
import type {
  ReplacedSessionContext,
  SessionReplacementOptions,
  SessionShutdownEvent,
  SessionStartEvent,
} from './extensions/types.ts';

export interface AgentSessionRuntimeDiagnostic {
  type: 'info' | 'warning' | 'error';
  message: string;
}

export interface CreateAgentSessionRuntimeResult {
  session: AgentSession;
  diagnostics: AgentSessionRuntimeDiagnostic[];
  modelFallbackMessage?: string;
}

export type CreateAgentSessionRuntimeFactory = (options: {
  session: Session;
  activeToolNames?: string[];
  sessionStartEvent: SessionStartEvent;
}) => Promise<CreateAgentSessionRuntimeResult>;

export type AgentSessionReplacementResult = {
  cancelled: boolean;
  teardownError?: unknown;
  withSessionError?: unknown;
};

type AgentSessionReplacementOptions = SessionReplacementOptions;

interface SessionRepoLike {
  create(options?: { cwd?: string; id?: string }): Promise<Session>;
  open(metadata: JsonlSessionMetadata): Promise<Session>;
  delete(metadata: JsonlSessionMetadata): Promise<void>;
  fork(
    sourceMetadata: JsonlSessionMetadata,
    options: { cwd: string; entryId: string; position: 'before' | 'at' },
  ): Promise<Session>;
}

export class AgentSessionRuntime {
  private rebindSession?: (session: AgentSession) => Promise<void> | void;
  private beforeSessionInvalidate?: () => void;
  private _session: AgentSession;
  private readonly cwd: string;
  private readonly createRuntime: CreateAgentSessionRuntimeFactory;
  private _diagnostics: AgentSessionRuntimeDiagnostic[];
  private _modelFallbackMessage?: string;

  constructor(
    session: AgentSession,
    options: {
      cwd: string;
      createRuntime: CreateAgentSessionRuntimeFactory;
      diagnostics?: AgentSessionRuntimeDiagnostic[];
      modelFallbackMessage?: string;
    },
  ) {
    this._session = session;
    this.cwd = options.cwd;
    this.createRuntime = options.createRuntime;
    this._diagnostics = options.diagnostics ?? [];
    this._modelFallbackMessage = options.modelFallbackMessage;
  }

  get session(): AgentSession {
    return this._session;
  }

  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
    return this._diagnostics;
  }

  get modelFallbackMessage(): string | undefined {
    return this._modelFallbackMessage;
  }

  setRebindSession(rebindSession?: (session: AgentSession) => Promise<void> | void): void {
    this.rebindSession = rebindSession;
  }

  setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
    this.beforeSessionInvalidate = beforeSessionInvalidate;
  }

  private async emitBeforeSwitch(
    reason: 'new' | 'resume',
    targetSessionFile?: string,
  ): Promise<{ cancelled: boolean }> {
    if (await this.session.emitSessionBeforeSwitch(reason, targetSessionFile)) {
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  private async emitBeforeFork(
    entryId: string,
    position: 'before' | 'at',
  ): Promise<{ cancelled: boolean }> {
    if (await this.session.emitSessionBeforeFork(entryId, position)) {
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  private async teardownCurrent(
    reason: NonNullable<SessionShutdownEvent['reason']>,
    targetSessionFile?: string,
  ): Promise<void> {
    let shutdownError: unknown;
    const teardownErrors: unknown[] = [];
    try {
      await this.session.emitSessionShutdown({
        type: 'session_shutdown',
        reason,
        targetSessionFile,
      });
    } catch (error) {
      shutdownError = error;
    } finally {
      try {
        this.beforeSessionInvalidate?.();
      } catch (error) {
        teardownErrors.push(error);
      }
      try {
        this.session.dispose();
      } catch (error) {
        teardownErrors.push(error);
      }
    }

    if (shutdownError) {
      if (
        typeof shutdownError === 'object' &&
        shutdownError !== null &&
        teardownErrors.length > 0
      ) {
        (shutdownError as { suppressed?: unknown[] }).suppressed = teardownErrors;
      }
      throw shutdownError;
    }
    if (teardownErrors.length === 1) {
      throw teardownErrors[0];
    }
    if (teardownErrors.length > 1) {
      throw new AggregateError(teardownErrors, 'Session teardown failed');
    }
  }

  private apply(result: CreateAgentSessionRuntimeResult): void {
    this._session = result.session;
    this._diagnostics = result.diagnostics;
    this._modelFallbackMessage = result.modelFallbackMessage;
  }

  private async finishSessionReplacement(
    sessionStartEvent: SessionStartEvent,
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>,
  ): Promise<unknown | undefined> {
    await this.rebindSession?.(this.session);
    await this.session.emitSessionStart(sessionStartEvent);
    if (!withSession) return undefined;
    try {
      await withSession(this.session.createReplacedSessionContext());
    } catch (error) {
      return error;
    }
    return undefined;
  }

  private attachSuppressed(error: unknown, suppressed: unknown): void {
    if (typeof error !== 'object' || error === null) return;
    (error as { suppressed?: unknown[] }).suppressed = [
      ...((error as { suppressed?: unknown[] }).suppressed ?? []),
      suppressed,
    ];
  }

  private async replaceCurrent(
    reason: NonNullable<SessionShutdownEvent['reason']>,
    targetSessionFile: string | undefined,
    nextRuntime: CreateAgentSessionRuntimeResult,
    sessionStartEvent: SessionStartEvent,
    options?: AgentSessionReplacementOptions,
  ): Promise<Pick<AgentSessionReplacementResult, 'teardownError' | 'withSessionError'>> {
    let teardownError: unknown;
    let withSessionError: unknown;
    try {
      await this.teardownCurrent(reason, targetSessionFile);
    } catch (error) {
      teardownError = error;
    }

    this.apply(nextRuntime);
    try {
      withSessionError = await this.finishSessionReplacement(
        sessionStartEvent,
        options?.withSession,
      );
    } catch (error) {
      if (teardownError) {
        this.attachSuppressed(error, teardownError);
      }
      throw error;
    }

    return { teardownError, withSessionError };
  }

  private async cleanupCreatedSession(repo: SessionRepoLike, session: Session): Promise<void> {
    const metadata = (await session.getMetadata()) as JsonlSessionMetadata;
    await repo.delete(metadata);
  }

  private async cleanupCreatedSessionAfterFailure(
    repo: SessionRepoLike,
    session: Session,
    failure: unknown,
  ): Promise<void> {
    try {
      await this.cleanupCreatedSession(repo, session);
    } catch (cleanupError) {
      this.attachSuppressed(failure, cleanupError);
    }
  }

  private disposeTargetSession(session: Session): void {
    const maybeDisposable = session as Session & { dispose?: () => void };
    try {
      maybeDisposable.dispose?.();
    } catch {
      // Preserve the runtime creation failure for the caller.
    }
  }

  async newSession(
    repo: SessionRepoLike,
    options?: AgentSessionReplacementOptions,
  ): Promise<AgentSessionReplacementResult> {
    const beforeResult = await this.emitBeforeSwitch('new');
    if (beforeResult.cancelled) return beforeResult;

    const previousMetadata = await this.session.getSessionMetadata();
    const targetSession = await repo.create({ cwd: this.cwd });
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'new',
      previousSessionFile: previousMetadata.path,
    };
    let nextRuntime: CreateAgentSessionRuntimeResult;
    let targetMetadata: JsonlSessionMetadata;
    try {
      targetMetadata = (await targetSession.getMetadata()) as JsonlSessionMetadata;
      nextRuntime = await this.createRuntime({ session: targetSession, sessionStartEvent });
    } catch (error) {
      this.disposeTargetSession(targetSession);
      await this.cleanupCreatedSessionAfterFailure(repo, targetSession, error);
      throw error;
    }

    const replacementResult = await this.replaceCurrent(
      'new',
      targetMetadata.path,
      nextRuntime,
      sessionStartEvent,
      options,
    );
    return { cancelled: false, ...replacementResult };
  }

  async switchSession(
    repo: SessionRepoLike,
    metadata: JsonlSessionMetadata,
    options?: AgentSessionReplacementOptions,
  ): Promise<AgentSessionReplacementResult> {
    const beforeResult = await this.emitBeforeSwitch('resume', metadata.path);
    if (beforeResult.cancelled) return beforeResult;

    const previousMetadata = await this.session.getSessionMetadata();
    const targetSession = await repo.open(metadata);
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: previousMetadata.path,
    };
    let nextRuntime: CreateAgentSessionRuntimeResult;
    let targetMetadata: JsonlSessionMetadata;
    try {
      targetMetadata = (await targetSession.getMetadata()) as JsonlSessionMetadata;
      nextRuntime = await this.createRuntime({ session: targetSession, sessionStartEvent });
    } catch (error) {
      this.disposeTargetSession(targetSession);
      throw error;
    }

    const replacementResult = await this.replaceCurrent(
      'resume',
      targetMetadata.path ?? metadata.path,
      nextRuntime,
      sessionStartEvent,
      options,
    );
    return { cancelled: false, ...replacementResult };
  }

  async fork(
    repo: SessionRepoLike,
    entryId: string,
    position: 'before' | 'at',
    options?: AgentSessionReplacementOptions,
  ): Promise<AgentSessionReplacementResult> {
    const beforeResult = await this.emitBeforeFork(entryId, position);
    if (beforeResult.cancelled) return beforeResult;

    if (this.session.isStreaming) {
      await this.session.abort();
    }

    const previousMetadata = await this.session.getSessionMetadata();
    const activeToolNames = this.session.getActiveToolNames();
    const targetSession = await repo.fork(previousMetadata, {
      cwd: this.cwd,
      entryId,
      position,
    });
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'fork',
      previousSessionFile: previousMetadata.path,
    };
    let nextRuntime: CreateAgentSessionRuntimeResult;
    let targetMetadata: JsonlSessionMetadata;
    try {
      targetMetadata = (await targetSession.getMetadata()) as JsonlSessionMetadata;
      nextRuntime = await this.createRuntime({
        session: targetSession,
        activeToolNames,
        sessionStartEvent,
      });
    } catch (error) {
      this.disposeTargetSession(targetSession);
      await this.cleanupCreatedSessionAfterFailure(repo, targetSession, error);
      throw error;
    }

    const replacementResult = await this.replaceCurrent(
      'fork',
      targetMetadata.path,
      nextRuntime,
      sessionStartEvent,
      options,
    );
    return { cancelled: false, ...replacementResult };
  }

  async dispose(): Promise<void> {
    await this.teardownCurrent('quit');
  }
}
