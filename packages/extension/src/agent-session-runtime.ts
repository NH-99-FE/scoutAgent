import type { JsonlSessionMetadata, Session } from '@scout-agent/agent';
import type { AgentSession } from './agent-session.ts';
import type { SessionShutdownEvent, SessionStartEvent } from './extensions/types.ts';

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

interface SessionRepoLike {
  create(options?: { cwd?: string; id?: string }): Promise<Session>;
  open(metadata: JsonlSessionMetadata): Promise<Session>;
  fork(
    sourceMetadata: JsonlSessionMetadata,
    options: { cwd: string; entryId: string; position: 'before' | 'at' },
  ): Promise<Session>;
}

export class AgentSessionRuntime {
  private rebindSession?: (session: AgentSession) => Promise<void> | void;
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
    await this.session.emitSessionShutdown({ type: 'session_shutdown', reason, targetSessionFile });
    this.session.dispose();
  }

  private apply(result: CreateAgentSessionRuntimeResult): void {
    this._session = result.session;
    this._diagnostics = result.diagnostics;
    this._modelFallbackMessage = result.modelFallbackMessage;
  }

  private async finishSessionReplacement(sessionStartEvent: SessionStartEvent): Promise<void> {
    await this.rebindSession?.(this.session);
    await this.session.emitSessionStart(sessionStartEvent);
  }

  async newSession(repo: SessionRepoLike): Promise<{ cancelled: boolean }> {
    const beforeResult = await this.emitBeforeSwitch('new');
    if (beforeResult.cancelled) return beforeResult;

    const previousMetadata = await this.session.getSessionMetadata();
    const targetSession = await repo.create({ cwd: this.cwd });
    const targetMetadata = (await targetSession.getMetadata()) as JsonlSessionMetadata;
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'new',
      previousSessionFile: previousMetadata.path,
    };
    const nextRuntime = await this.createRuntime({ session: targetSession, sessionStartEvent });

    await this.teardownCurrent('new', targetMetadata.path);
    this.apply(nextRuntime);
    await this.finishSessionReplacement(sessionStartEvent);
    return { cancelled: false };
  }

  async switchSession(
    repo: SessionRepoLike,
    metadata: JsonlSessionMetadata,
  ): Promise<{ cancelled: boolean }> {
    const beforeResult = await this.emitBeforeSwitch('resume', metadata.path);
    if (beforeResult.cancelled) return beforeResult;

    const previousMetadata = await this.session.getSessionMetadata();
    const targetSession = await repo.open(metadata);
    const targetMetadata = (await targetSession.getMetadata()) as JsonlSessionMetadata;
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: previousMetadata.path,
    };
    const nextRuntime = await this.createRuntime({ session: targetSession, sessionStartEvent });

    await this.teardownCurrent('resume', targetMetadata.path ?? metadata.path);
    this.apply(nextRuntime);
    await this.finishSessionReplacement(sessionStartEvent);
    return { cancelled: false };
  }

  async fork(
    repo: SessionRepoLike,
    entryId: string,
    position: 'before' | 'at',
  ): Promise<{ cancelled: boolean }> {
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
    const targetMetadata = (await targetSession.getMetadata()) as JsonlSessionMetadata;
    const sessionStartEvent: SessionStartEvent = {
      type: 'session_start',
      reason: 'fork',
      previousSessionFile: previousMetadata.path,
    };
    const nextRuntime = await this.createRuntime({
      session: targetSession,
      activeToolNames,
      sessionStartEvent,
    });

    await this.teardownCurrent('fork', targetMetadata.path);
    this.apply(nextRuntime);
    await this.finishSessionReplacement(sessionStartEvent);
    return { cancelled: false };
  }

  async dispose(): Promise<void> {
    await this.teardownCurrent('quit');
  }
}
